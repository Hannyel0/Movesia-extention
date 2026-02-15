#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

/// <summary>
/// Provides asset deletion APIs using AssetDatabase.
/// Defaults to MoveAssetToTrash (OS recycle bin) for safe, recoverable deletion.
///
/// When deleting .cs or .asmdef files, Unity triggers a domain reload.
/// This class persists the pending request and sends the response after reload,
/// mirroring the pattern in CompilationManager.
/// </summary>
[InitializeOnLoad]
public static class DeletionManager
{
    // --- Data Structures ---

    [Serializable]
    public class DeletionResult
    {
        public bool success;
        public string error;
        public int requestedCount;
        public int deletedCount;
        public int failedCount;
        public string[] deletedPaths;
        public string[] failedPaths;
        public bool triggeredRecompile;
    }

    // --- Persistence ---

    private static readonly string PendingRequestFile =
        Path.Combine(Application.dataPath, "../Temp/movesia_pending_deletion.json");

    private const int MAX_RECONNECT_ATTEMPTS = 150;
    private const int RECONNECT_INTERVAL_MS = 200;

    [Serializable]
    private class PendingDeletionRequest
    {
        public string requestId;
        public string sessionId;
        public long timestamp;
        public DeletionResult result;
    }

    // File extensions that trigger domain reload when deleted
    private static readonly string[] RecompileExtensions = { ".cs", ".asmdef", ".asmref" };

    // --- Static Constructor: Runs after every domain reload ---

    static DeletionManager()
    {
        EditorApplication.update += OnEditorUpdate;
    }

    private static bool _pendingCheckDone = false;

    private static void OnEditorUpdate()
    {
        if (!_pendingCheckDone)
        {
            _pendingCheckDone = true;
            CheckAndResumePendingRequest();
        }
    }

    // =========================================================================
    // PUBLIC API - Called by MessageHandler
    // =========================================================================

    /// <summary>
    /// Handles the "delete_assets" request from the agent.
    /// If deleting .cs/.asmdef files, saves pending request and defers response until after domain reload.
    /// Otherwise responds immediately.
    /// Returns null when deferring (MessageHandler should NOT send a response).
    /// </summary>
    public static Task<object> HandleDeleteRequest(string requestId, JToken body)
    {
        try
        {
            string[] paths = body?["paths"]?.ToObject<string[]>();

            if (paths == null || paths.Length == 0)
            {
                return Task.FromResult<object>(new DeletionResult
                {
                    success = false,
                    error = "No asset paths provided",
                    requestedCount = 0,
                    deletedCount = 0,
                    failedCount = 0,
                    deletedPaths = Array.Empty<string>(),
                    failedPaths = Array.Empty<string>(),
                    triggeredRecompile = false
                });
            }

            // Check if any paths are scripts that will trigger domain reload
            bool willRecompile = paths.Any(p =>
                RecompileExtensions.Any(ext => p.EndsWith(ext, StringComparison.OrdinalIgnoreCase)));

            // Perform the deletion
            var result = DeleteAssets(paths);
            result.triggeredRecompile = willRecompile && result.deletedCount > 0;

            // If scripts were deleted successfully, defer the response
            if (result.triggeredRecompile)
            {
                Debug.Log($"🗑️ Deleted {result.deletedCount} asset(s) including scripts — deferring response for domain reload");

                SavePendingRequest(new PendingDeletionRequest
                {
                    requestId = requestId,
                    sessionId = WebSocketClient.SessionId,
                    timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    result = result
                });

                return Task.FromResult<object>(null);
            }

            // No scripts deleted — respond immediately
            return Task.FromResult<object>(result);
        }
        catch (Exception ex)
        {
            Debug.LogError($"❌ HandleDeleteRequest failed: {ex.Message}");
            ClearPendingRequest();

            return Task.FromResult<object>(new DeletionResult
            {
                success = false,
                error = ex.Message,
                requestedCount = 0,
                deletedCount = 0,
                failedCount = 0,
                deletedPaths = Array.Empty<string>(),
                failedPaths = Array.Empty<string>(),
                triggeredRecompile = false
            });
        }
    }

    // --- Delete Assets ---

    /// <summary>
    /// Move one or more assets to the OS trash (recycle bin) in a single batch operation.
    /// Uses MoveAssetsToTrash for performance, especially with version control integration.
    /// </summary>
    /// <param name="assetPaths">Array of asset paths to delete</param>
    public static DeletionResult DeleteAssets(string[] assetPaths)
    {
        try
        {
            if (assetPaths == null || assetPaths.Length == 0)
            {
                return new DeletionResult
                {
                    success = false,
                    error = "No asset paths provided",
                    requestedCount = 0,
                    deletedCount = 0,
                    failedCount = 0,
                    deletedPaths = Array.Empty<string>(),
                    failedPaths = Array.Empty<string>()
                };
            }

            // Normalize all paths
            var normalizedPaths = new string[assetPaths.Length];
            for (int i = 0; i < assetPaths.Length; i++)
            {
                var p = assetPaths[i];
                normalizedPaths[i] = p.StartsWith("Assets") ? p : "Assets/" + p.TrimStart('/');
            }

            // Validate all paths exist before attempting deletion
            var validPaths = new List<string>();
            var preFailedPaths = new List<string>();

            foreach (var path in normalizedPaths)
            {
                string guid = AssetDatabase.AssetPathToGUID(path);
                if (string.IsNullOrEmpty(guid))
                {
                    preFailedPaths.Add(path);
                }
                else
                {
                    validPaths.Add(path);
                }
            }

            if (validPaths.Count == 0)
            {
                return new DeletionResult
                {
                    success = false,
                    error = "None of the provided asset paths were found",
                    requestedCount = assetPaths.Length,
                    deletedCount = 0,
                    failedCount = assetPaths.Length,
                    deletedPaths = Array.Empty<string>(),
                    failedPaths = normalizedPaths
                };
            }

            // Batch move to trash
            var outFailedPaths = new List<string>();
            AssetDatabase.MoveAssetsToTrash(validPaths.ToArray(), outFailedPaths);

            // Combine pre-validation failures with batch operation failures
            var allFailedPaths = new List<string>(preFailedPaths);
            allFailedPaths.AddRange(outFailedPaths);

            // Determine which paths succeeded
            var failedSet = new HashSet<string>(outFailedPaths);
            var deletedPaths = validPaths.Where(p => !failedSet.Contains(p)).ToArray();

            return new DeletionResult
            {
                success = allFailedPaths.Count == 0,
                error = allFailedPaths.Count > 0 ? $"{allFailedPaths.Count} asset(s) failed to delete" : null,
                requestedCount = assetPaths.Length,
                deletedCount = deletedPaths.Length,
                failedCount = allFailedPaths.Count,
                deletedPaths = deletedPaths,
                failedPaths = allFailedPaths.ToArray()
            };
        }
        catch (Exception ex)
        {
            return new DeletionResult
            {
                success = false,
                error = ex.Message,
                requestedCount = assetPaths?.Length ?? 0,
                deletedCount = 0,
                failedCount = assetPaths?.Length ?? 0,
                deletedPaths = Array.Empty<string>(),
                failedPaths = assetPaths ?? Array.Empty<string>()
            };
        }
    }

    // =========================================================================
    // PERSISTENCE - Survives domain reload
    // =========================================================================

    private static void SavePendingRequest(PendingDeletionRequest request)
    {
        try
        {
            string json = JsonConvert.SerializeObject(request, Formatting.Indented);

            string tempDir = Path.GetDirectoryName(PendingRequestFile);
            if (!Directory.Exists(tempDir))
            {
                Directory.CreateDirectory(tempDir);
            }

            File.WriteAllText(PendingRequestFile, json);
            Debug.Log($"💾 Saved pending deletion request: {request.requestId}");
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to save pending deletion request: {ex.Message}");
        }
    }

    private static PendingDeletionRequest LoadPendingRequest()
    {
        try
        {
            if (!File.Exists(PendingRequestFile))
                return null;

            string json = File.ReadAllText(PendingRequestFile);
            return JsonConvert.DeserializeObject<PendingDeletionRequest>(json);
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Failed to load pending deletion request: {ex.Message}");
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
                Debug.Log("🧹 Cleared pending deletion request");
            }
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Failed to clear pending deletion request: {ex.Message}");
        }
    }

    // =========================================================================
    // POST-RELOAD HANDLING
    // =========================================================================

    private static async void CheckAndResumePendingRequest()
    {
        var pending = LoadPendingRequest();

        if (pending == null)
            return;

        Debug.Log($"🔍 Found pending deletion request: {pending.requestId}");

        // Validate session
        if (pending.sessionId != WebSocketClient.SessionId)
        {
            Debug.LogWarning($"⚠️ Pending deletion request from different session, ignoring");
            ClearPendingRequest();
            return;
        }

        // Check if request is too old (> 5 minutes)
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (now - pending.timestamp > 300)
        {
            Debug.LogWarning($"⚠️ Pending deletion request is too old ({now - pending.timestamp}s), ignoring");
            ClearPendingRequest();
            return;
        }

        // Clear immediately to prevent duplicate handling
        ClearPendingRequest();

        // Wait for WebSocket to reconnect
        bool connected = await WaitForWebSocketConnection();

        if (!connected)
        {
            Debug.LogError("❌ Failed to reconnect WebSocket after deletion reload");
            return;
        }

        // Send the deferred response with the saved result
        try
        {
            Debug.Log($"📤 Sending deferred deletion_complete for request {pending.requestId}");
            await WebSocketClient.Send("assets_deleted", pending.result, pending.requestId);
            Debug.Log("✅ Deferred deletion response sent");
        }
        catch (Exception ex)
        {
            Debug.LogError($"❌ Failed to send deferred deletion response: {ex.Message}");
        }
    }

    private static async Task<bool> WaitForWebSocketConnection()
    {
        return await Task.Run(async () =>
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
        });
    }
}
#endif
