#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using UnityEditor.Compilation;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Threading.Tasks;

/// <summary>
/// Manages script compilation requests from the agent.
/// Persists pending requests across domain reloads and signals completion.
/// 
/// Flow:
/// 1. Agent creates/modifies .cs files via filesystem
/// 2. Agent calls "refresh_assets" to trigger compilation
/// 3. Unity compiles, domain reloads (WebSocket drops, memory wiped)
/// 4. After reload, this class detects pending request and signals completion
/// 5. Agent resumes from interrupt with compilation result
/// </summary>
[InitializeOnLoad]
public static class CompilationManager
{
    // --- Persistence ---
    private static readonly string PendingRequestFile = 
        Path.Combine(Application.dataPath, "../Temp/movesia_pending_compilation.json");
    
    // --- Retry Configuration ---
    private const int MAX_RECONNECT_ATTEMPTS = 50;      // ~10 seconds max wait
    private const int RECONNECT_INTERVAL_MS = 200;
    
    // --- Pending Request Data ---
    [Serializable]
    private class PendingCompilationRequest
    {
        public string requestId;
        public string sessionId;
        public long timestamp;
        public string[] watchedScripts;  // Optional: specific scripts to verify
    }
    
    // --- Static Constructor: Runs after every domain reload ---
    static CompilationManager()
    {
        // Use update loop instead of delayCall - runs even without focus
        EditorApplication.update += OnEditorUpdate;

        // Subscribe to compilation events for better error detection
        CompilationPipeline.compilationFinished += OnCompilationFinished;
    }

    // --- State for update-based checks ---
    private static bool _pendingCheckDone = false;
    private static bool _compilationCheckPending = false;
    private static float _compilationCheckStartTime = 0;

    /// <summary>
    /// Runs continuously even without editor focus.
    /// Handles pending request checks after domain reload.
    /// </summary>
    private static void OnEditorUpdate()
    {
        // Only run the pending request check once after domain reload
        if (!_pendingCheckDone)
        {
            _pendingCheckDone = true;
            CheckAndResumePendingRequest();
        }

        // Handle compilation check (replaces delayCall in CheckIfCompilationStarted)
        if (_compilationCheckPending)
        {
            float elapsed = (float)(EditorApplication.timeSinceStartup - _compilationCheckStartTime);
            if (elapsed >= 0.1f) // 100ms delay
            {
                _compilationCheckPending = false;
                ProcessCompilationCheck();
            }
        }
    }

    /// <summary>
    /// Tracks compilation results for the current compilation cycle.
    /// </summary>
    private static bool lastCompilationHadErrors = false;
    private static List<string> lastCompilationErrors = new List<string>();
    
    private static void OnCompilationFinished(object obj)
    {
        // Check for compilation errors
        lastCompilationHadErrors = EditorUtility.scriptCompilationFailed;
        lastCompilationErrors.Clear();
        
        if (lastCompilationHadErrors)
        {
            // Capture error messages from console
            lastCompilationErrors = GetCompilationErrorsFromConsole();
        }
    }
    
    // =========================================================================
    // PUBLIC API - Called by MessageHandler
    // =========================================================================
    
    /// <summary>
    /// Handles the "refresh_assets" request from the agent.
    /// Saves pending request and triggers AssetDatabase.Refresh().
    /// Response is ALWAYS sent asynchronously via:
    /// 1. CheckAndResumePendingRequest (if domain reload happens)
    /// 2. CheckIfCompilationStarted (if no compilation needed)
    /// </summary>
    public static Task<object> HandleRefreshRequest(string requestId, JToken body)
    {
        try
        {
            // Extract optional parameters
            string[] watchedScripts = body?["watchedScripts"]?.ToObject<string[]>();

            // Save the pending request BEFORE triggering refresh
            SavePendingRequest(new PendingCompilationRequest
            {
                requestId = requestId,
                sessionId = WebSocketClient.SessionId,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                watchedScripts = watchedScripts
            });

            Debug.Log($"🔄 Triggering asset refresh for request {requestId}");
            Debug.Log($"📁 Pending request saved to: {PendingRequestFile}");

            // Trigger the refresh - this will cause domain reload if scripts changed
            // ImportAssetOptions.ForceUpdate ensures scripts are recompiled
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);

            // Schedule a check after a brief delay to see if compilation started
            _compilationCheckPending = true;
            _compilationCheckStartTime = (float)EditorApplication.timeSinceStartup;

            // Never return a response here - it will come asynchronously via:
            // 1. CheckAndResumePendingRequest (if domain reload happens)
            // 2. CheckIfCompilationStarted (if no compilation needed)
            return Task.FromResult<object>(null);
        }
        catch (Exception ex)
        {
            Debug.LogError($"❌ RefreshAssets failed: {ex.Message}");
            ClearPendingRequest();

            return Task.FromResult<object>(new
            {
                success = false,
                error = ex.Message,
                errorType = ex.GetType().Name
            });
        }
    }

    /// <summary>
    /// Called after delay via OnEditorUpdate to check if compilation started.
    /// If not compiling, sends response immediately since no domain reload will happen.
    /// </summary>
    private static async void ProcessCompilationCheck()
    {
        // If file still exists and not compiling, no domain reload will happen
        if (File.Exists(PendingRequestFile) && !EditorApplication.isCompiling)
        {
            var pending = LoadPendingRequest();
            if (pending == null) return;

            ClearPendingRequest();

            var response = new
            {
                success = true,
                recompiled = false,
                message = "No script changes detected",
                availableTypes = GetAvailableMonoBehaviours()
            };

            Debug.Log($"📦 No compilation needed, responding immediately");
            Debug.Log($"📤 Sending to agent:\n{JsonConvert.SerializeObject(response, Formatting.Indented)}");

            await WebSocketClient.Send("compilation_complete", response, pending.requestId);
        }
        // If compiling, domain reload will happen and CheckAndResumePendingRequest handles it
    }
    
    /// <summary>
    /// Gets compilation status without triggering a refresh.
    /// Useful for checking if there are pending errors.
    /// </summary>
    public static object GetCompilationStatus()
    {
        return new
        {
            isCompiling = EditorApplication.isCompiling,
            hasErrors = EditorUtility.scriptCompilationFailed,
            errors = GetCompilationErrorsFromConsole(),
            availableTypes = GetAvailableMonoBehaviours(customOnly: true, filter: null, limit: 50)
        };
    }
    
    // =========================================================================
    // PERSISTENCE - Survives domain reload
    // =========================================================================
    
    private static void SavePendingRequest(PendingCompilationRequest request)
    {
        try
        {
            string json = JsonConvert.SerializeObject(request, Formatting.Indented);
            
            // Ensure Temp directory exists
            string tempDir = Path.GetDirectoryName(PendingRequestFile);
            if (!Directory.Exists(tempDir))
            {
                Directory.CreateDirectory(tempDir);
            }
            
            File.WriteAllText(PendingRequestFile, json);
            Debug.Log($"💾 Saved pending request: {request.requestId}");
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to save pending request: {ex.Message}");
        }
    }
    
    private static PendingCompilationRequest LoadPendingRequest()
    {
        try
        {
            if (!File.Exists(PendingRequestFile))
            {
                return null;
            }
            
            string json = File.ReadAllText(PendingRequestFile);
            return JsonConvert.DeserializeObject<PendingCompilationRequest>(json);
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Failed to load pending request: {ex.Message}");
            return null;
        }
    }
    
    private static void ClearPendingRequest()
    {
        try
        {
            if (File.Exists(PendingRequestFile))
            {
                File.Delete(PendingRequestFile);
                Debug.Log("🧹 Cleared pending compilation request");
            }
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Failed to clear pending request: {ex.Message}");
        }
    }
    
    // =========================================================================
    // POST-RELOAD HANDLING
    // =========================================================================
    
    private static async void CheckAndResumePendingRequest()
    {
        var pending = LoadPendingRequest();
        
        if (pending == null)
        {
            // No pending request - normal editor startup
            return;
        }
        
        Debug.Log($"🔍 Found pending compilation request: {pending.requestId}");
        
        // Validate session - don't respond to stale requests
        if (pending.sessionId != WebSocketClient.SessionId)
        {
            Debug.LogWarning($"⚠️ Pending request from different session, ignoring");
            ClearPendingRequest();
            return;
        }
        
        // Check if request is too old (> 5 minutes)
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (now - pending.timestamp > 300)
        {
            Debug.LogWarning($"⚠️ Pending request is too old ({now - pending.timestamp}s), ignoring");
            ClearPendingRequest();
            return;
        }
        
        // Clear immediately to prevent duplicate handling
        ClearPendingRequest();
        
        // Wait for WebSocket to reconnect
        bool connected = await WaitForWebSocketConnection();
        
        if (!connected)
        {
            Debug.LogError("❌ Failed to reconnect WebSocket after compilation");
            return;
        }
        
        // Build the compilation result
        var result = BuildCompilationResult(pending);
        
        // Send the completion signal
        await SendCompilationComplete(pending.requestId, result);
    }
    
    private static async Task<bool> WaitForWebSocketConnection()
    {
        for (int attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++)
        {
            if (WebSocketClient.IsConnected)
            {
                Debug.Log($"✅ WebSocket reconnected after {attempt * RECONNECT_INTERVAL_MS}ms");
                return true;
            }
            
            await Task.Delay(RECONNECT_INTERVAL_MS);
        }
        
        Debug.LogWarning($"⏱️ WebSocket reconnection timeout after {MAX_RECONNECT_ATTEMPTS * RECONNECT_INTERVAL_MS}ms");
        return false;
    }
    
    private static object BuildCompilationResult(PendingCompilationRequest pending)
    {
        bool hasErrors = EditorUtility.scriptCompilationFailed;
        var errors = hasErrors ? GetCompilationErrorsFromConsole() : new List<string>();

        // Only return custom types by default, with reasonable limit
        var availableTypes = GetAvailableMonoBehaviours(customOnly: true, filter: null, limit: 50);
        
        // If watching specific scripts, verify they're available
        List<string> missingScripts = new List<string>();
        List<string> foundScripts = new List<string>();
        
        if (pending.watchedScripts != null && pending.watchedScripts.Length > 0)
        {
            foreach (var scriptName in pending.watchedScripts)
            {
                // Check if type exists (with or without namespace)
                bool found = availableTypes.Any(t => 
                    t.Equals(scriptName, StringComparison.OrdinalIgnoreCase) ||
                    t.EndsWith("." + scriptName, StringComparison.OrdinalIgnoreCase));
                
                if (found)
                {
                    foundScripts.Add(scriptName);
                }
                else
                {
                    missingScripts.Add(scriptName);
                }
            }
        }
        
        return new
        {
            success = !hasErrors && missingScripts.Count == 0,
            recompiled = true,
            hasErrors,
            errors,
            availableTypes,
            watchedScripts = new
            {
                found = foundScripts,
                missing = missingScripts
            },
            compilationTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
        };
    }
    
    private static async Task SendCompilationComplete(string requestId, object result)
    {
        try
        {
            Debug.Log($"📤 Sending compilation_complete for request {requestId}");
            Debug.Log($"📤 Response body:\n{JsonConvert.SerializeObject(result, Formatting.Indented)}");
            await WebSocketClient.Send("compilation_complete", result, requestId);
            Debug.Log("✅ Compilation complete signal sent");
        }
        catch (Exception ex)
        {
            Debug.LogError($"❌ Failed to send compilation complete: {ex.Message}");
        }
    }
    
    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    /// <summary>
    /// Gets available MonoBehaviour types.
    /// By default only returns custom scripts (Assembly-CSharp), not Unity internals.
    /// </summary>
    /// <param name="customOnly">If true, only return user-created scripts</param>
    /// <param name="filter">Optional name filter</param>
    /// <param name="limit">Max number of results (0 = no limit)</param>
    private static List<string> GetAvailableMonoBehaviours(bool customOnly = true, string filter = null, int limit = 50)
    {
        try
        {
            var query = TypeCache.GetTypesDerivedFrom<MonoBehaviour>()
                .Where(t => !t.IsAbstract && !t.IsGenericType);

            // Filter to custom scripts only (Assembly-CSharp)
            if (customOnly)
            {
                query = query.Where(t =>
                    t.Assembly.GetName().Name == "Assembly-CSharp" ||
                    t.Assembly.GetName().Name == "Assembly-CSharp-firstpass");
            }

            // Apply name filter if provided
            if (!string.IsNullOrEmpty(filter))
            {
                query = query.Where(t =>
                    t.Name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    t.FullName.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0);
            }

            // Order and limit
            var results = query
                .OrderBy(t => t.Name)
                .Select(t => t.FullName);

            if (limit > 0)
            {
                results = results.Take(limit);
            }

            return results.ToList();
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Failed to get MonoBehaviour types: {ex.Message}");
            return new List<string>();
        }
    }
    
    /// <summary>
    /// Gets all available ScriptableObject types.
    /// </summary>
    private static List<string> GetAvailableScriptableObjects()
    {
        try
        {
            return TypeCache.GetTypesDerivedFrom<ScriptableObject>()
                .Where(t => !t.IsAbstract && !t.IsGenericType)
                .Where(t => t.IsPublic || t.Assembly.GetName().Name == "Assembly-CSharp")
                .Select(t => t.FullName)
                .OrderBy(t => t)
                .ToList();
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Failed to get ScriptableObject types: {ex.Message}");
            return new List<string>();
        }
    }
    
    /// <summary>
    /// Extracts compilation errors from the Unity console.
    /// </summary>
    private static List<string> GetCompilationErrorsFromConsole()
    {
        var errors = new List<string>();
        
        try
        {
            // Use reflection to access console entries (Unity doesn't expose this directly)
            var assembly = System.Reflection.Assembly.GetAssembly(typeof(Editor));
            var logEntriesType = assembly.GetType("UnityEditor.LogEntries");
            
            if (logEntriesType != null)
            {
                var getCountMethod = logEntriesType.GetMethod("GetCount", 
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Public);
                var getEntryMethod = logEntriesType.GetMethod("GetEntryInternal",
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Public);
                
                if (getCountMethod != null)
                {
                    int count = (int)getCountMethod.Invoke(null, null);
                    
                    // Get LogEntry type
                    var logEntryType = assembly.GetType("UnityEditor.LogEntry");
                    
                    if (logEntryType != null && getEntryMethod != null)
                    {
                        var entry = Activator.CreateInstance(logEntryType);
                        var modeField = logEntryType.GetField("mode", 
                            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public);
                        var messageField = logEntryType.GetField("message",
                            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public);
                        
                        for (int i = 0; i < Math.Min(count, 50); i++) // Limit to 50 entries
                        {
                            getEntryMethod.Invoke(null, new object[] { i, entry });
                            
                            int mode = (int)modeField.GetValue(entry);
                            string message = (string)messageField.GetValue(entry);
                            
                            // Mode flags: 1 = Error, 2 = Assert, 4 = Log, 8 = Fatal, etc.
                            // Check if it's a compiler error (mode includes error flag)
                            if ((mode & 1) != 0 && message.Contains("error CS"))
                            {
                                // Extract just the relevant part of the error
                                string cleanError = CleanCompilationError(message);
                                if (!string.IsNullOrEmpty(cleanError) && !errors.Contains(cleanError))
                                {
                                    errors.Add(cleanError);
                                }
                            }
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Failed to get compilation errors: {ex.Message}");
        }
        
        // Fallback: If we couldn't get errors but compilation failed, add generic message
        if (errors.Count == 0 && EditorUtility.scriptCompilationFailed)
        {
            errors.Add("Compilation failed. Check Unity console for details.");
        }
        
        return errors;
    }
    
    /// <summary>
    /// Cleans up a compilation error message for readability.
    /// </summary>
    private static string CleanCompilationError(string rawError)
    {
        if (string.IsNullOrEmpty(rawError))
        {
            return null;
        }
        
        // Take first line only (errors can be multi-line)
        int newlineIndex = rawError.IndexOf('\n');
        if (newlineIndex > 0)
        {
            rawError = rawError.Substring(0, newlineIndex);
        }
        
        // Limit length
        if (rawError.Length > 500)
        {
            rawError = rawError.Substring(0, 500) + "...";
        }
        
        return rawError.Trim();
    }
    
    // =========================================================================
    // MENU ITEMS FOR TESTING
    // =========================================================================
    
    [MenuItem("Tools/Movesia/Compilation/Check Status")]
    public static void MenuCheckStatus()
    {
        var status = GetCompilationStatus();
        Debug.Log($"📊 Compilation Status:\n{JsonConvert.SerializeObject(status, Formatting.Indented)}");
    }
    
    [MenuItem("Tools/Movesia/Compilation/Clear Pending Request")]
    public static void MenuClearPending()
    {
        ClearPendingRequest();
    }
    
    [MenuItem("Tools/Movesia/Compilation/List MonoBehaviours")]
    public static void MenuListMonoBehaviours()
    {
        var types = GetAvailableMonoBehaviours();
        Debug.Log($"📜 Available MonoBehaviours ({types.Count}):\n{string.Join("\n", types.Take(50))}");
        if (types.Count > 50)
        {
            Debug.Log($"... and {types.Count - 50} more");
        }
    }
    
    [MenuItem("Tools/Movesia/Compilation/Test Refresh")]
    public static void MenuTestRefresh()
    {
        _ = HandleRefreshRequest("test-" + Guid.NewGuid().ToString().Substring(0, 8), null);
    }
}
#endif