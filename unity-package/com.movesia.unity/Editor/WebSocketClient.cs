#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using NativeWebSocket;
using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;

[InitializeOnLoad]
public static class WebSocketClient
{
    // --- Connection State ---
    private static WebSocket ws;
    private static volatile bool isConnecting;
    private static int reconnectingFlag = 0;
    private static CancellationTokenSource cts;
    private static readonly System.Random rng = new System.Random();
    
    // --- Heartbeat ---
    private static DateTime nextHeartbeatAt = DateTime.MinValue;
    private const int HEARTBEAT_INTERVAL_SEC = 25;
    private const int HEARTBEAT_JITTER_SEC = 10;
    
    // --- Reconnection ---
    private static int connectionSequence = 0;
    private static int currentSequence = 0;
    private const int MAX_BACKOFF_MS = 5000;
    
    // --- Configuration ---
    private const string WS_URL = "ws://127.0.0.1:8765/ws/unity";
    private const string SESSION_ID_KEY = "Movesia_SessionId";
    
    // --- Session ---
    public static string SessionId
    {
        get => EditorPrefs.GetString(SESSION_ID_KEY, null);
        set => EditorPrefs.SetString(SESSION_ID_KEY, value);
    }
    
    public static void EnsureSession()
    {
        if (string.IsNullOrEmpty(SessionId))
        {
            SessionId = Guid.NewGuid().ToString();
            Debug.Log($"🆕 Created new SessionId: {SessionId}");
        }
    }
    
    // --- Public State ---
    public static bool IsConnected => ws != null && ws.State == WebSocketState.Open;
    public static event Action OnConnected;
    public static event Action OnDisconnected;
    public static event Action<string> OnMessageReceived;

    // --- Auto-start on Editor load ---
    static WebSocketClient()
    {
        EnsureSession();
        Debug.Log($"🔑 SessionId on load: {SessionId}");

        EditorApplication.update += OnEditorUpdate;
        AssemblyReloadEvents.beforeAssemblyReload += () => _ = CloseSocket("domain-reload");
        EditorApplication.quitting += () => _ = CloseSocket("editor-quit");

        // Don't connect immediately - use delayCall to let domain reload settle
        EditorApplication.delayCall += () =>
        {
            if (!IsConnected && !isConnecting)
            {
                CreateWebSocket();
                _ = ConnectWithRetry();
            }
        };
    }

    // --- WebSocket Setup ---
    private static void CreateWebSocket()
    {
        cts?.Cancel();
        cts = new CancellationTokenSource();
        
        var mySeq = ++connectionSequence;
        currentSequence = mySeq;

        // Include session and conn in URL so middleware can track connections
        var url = $"{WS_URL}?session={SessionId}&conn={mySeq}";
        ws = new WebSocket(url);

        ws.OnOpen += () =>
        {
            Debug.Log($"✅ WebSocket connected (seq={mySeq})");
            isConnecting = false;
            Interlocked.Exchange(ref reconnectingFlag, 0);
            ScheduleNextHeartbeat();
            OnConnected?.Invoke();
        };

        ws.OnMessage += bytes =>
        {
            var msg = Encoding.UTF8.GetString(bytes);
            Debug.Log($"📨 Received: {msg}");
            OnMessageReceived?.Invoke(msg);

            // Route to handler
            _ = MessageHandler.HandleMessage(msg);
        };

        ws.OnError += async err =>
        {
            Debug.LogWarning($"⚠️ WebSocket error (seq={mySeq}): {err}");
            if (mySeq != currentSequence) return;
            await ReconnectSoon();
        };

        ws.OnClose += async code =>
        {
            Debug.LogWarning($"🔌 WebSocket closed (seq={mySeq}): {code}");
            if (mySeq != currentSequence) return;
            
            // Don't reconnect if superseded (custom close code 4001)
            if ((int)code == 4001)
            {
                Debug.Log("Connection superseded - not reconnecting");
                return;
            }
            
            OnDisconnected?.Invoke();
            await ReconnectSoon();
        };
    }

    // --- Connection Logic ---
    private static async Task ConnectWithRetry()
    {
        if (ws == null || isConnecting) return;
        isConnecting = true;

        try
        {
            int attempt = 0;
            while (!cts.IsCancellationRequested && ws != null && ws.State != WebSocketState.Open)
            {
                try
                {
                    Debug.Log($"→ Connecting... (attempt {attempt + 1})");
                    await ws.Connect();
                    
                    if (ws.State == WebSocketState.Open)
                    {
                        isConnecting = false;
                        Interlocked.Exchange(ref reconnectingFlag, 0);
                        return;
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"Connect failed: {ex.Message}");
                }

                attempt++;
                int backoff = CalculateBackoff(attempt);
                int jitter = rng.Next(50, 200);
                
                try
                {
                    await Task.Delay(backoff + jitter, cts.Token);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
            }
        }
        finally
        {
            isConnecting = false;
            if (ws == null || ws.State != WebSocketState.Open)
                Interlocked.Exchange(ref reconnectingFlag, 0);
        }
    }

    private static int CalculateBackoff(int attempt)
    {
        return attempt switch
        {
            1 => 100,   // Fast first retry
            2 => 500,   // Second retry
            _ => Math.Min(1000 * (1 << Math.Min(attempt - 2, 3)), MAX_BACKOFF_MS)
        };
    }

    private static async Task ReconnectSoon()
    {
        // Atomic check-and-set to prevent race condition between OnError and OnClose
        if (Interlocked.CompareExchange(ref reconnectingFlag, 1, 0) != 0)
            return;  // Someone else is already reconnecting

        try
        {
            await CloseSocket("reconnect");
            CreateWebSocket();
            await ConnectWithRetry();
        }
        finally
        {
            Interlocked.Exchange(ref reconnectingFlag, 0);
        }
    }

    private static async Task CloseSocket(string reason)
    {
        try
        {
            cts?.Cancel();
            if (ws != null && (ws.State == WebSocketState.Open || ws.State == WebSocketState.Connecting))
            {
                await ws.Close();
            }
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"CloseSocket({reason}) error: {ex.Message}");
        }
        finally
        {
            ws = null;
            isConnecting = false;
        }
    }

    // --- Heartbeat ---
    private static void ScheduleNextHeartbeat()
    {
        nextHeartbeatAt = DateTime.UtcNow + TimeSpan.FromSeconds(HEARTBEAT_INTERVAL_SEC + rng.Next(0, HEARTBEAT_JITTER_SEC));
    }

    private static async Task SendHeartbeat()
    {
        await Send("hb", new { ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds() });
        ScheduleNextHeartbeat();
    }

    // --- Editor Update Loop ---
    private static void OnEditorUpdate()
    {
        ws?.DispatchMessageQueue();

        if (ws != null && ws.State == WebSocketState.Open)
        {
            if (DateTime.UtcNow >= nextHeartbeatAt)
            {
                _ = SendHeartbeat();
            }
        }
    }

    // --- Public API ---
    public static async Task Send(string type, object body, string requestId = null)
    {
        if (ws == null || ws.State != WebSocketState.Open)
        {
            Debug.LogWarning("Cannot send - WebSocket not connected");
            return;
        }

        try
        {
            Debug.Log($"📨 WebSocketClient.Send: using id={requestId ?? "(null)"} for type={type}");

            var envelope = new
            {
                source = "unity",
                type,
                ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                id = requestId,  // null if not a response
                body
            };
            string json = JsonConvert.SerializeObject(envelope);

            Debug.Log($"📡 WS SEND: type={type}, id={requestId ?? "(null)"}");
            await ws.SendText(json);
            Debug.Log($"📤 Sent: {json}");
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Send failed: {ex.Message}");
        }
    }

    [MenuItem("Tools/WebSocket/Reconnect")]
    public static void MenuReconnect() => _ = ReconnectSoon();

    [MenuItem("Tools/WebSocket/Disconnect")]
    public static void MenuDisconnect() => _ = CloseSocket("user-disconnect");

    [MenuItem("Tools/WebSocket/Send Test Message")]
    public static void MenuSendTest() => _ = Send("test", new { message = "Hello from Unity!" });
}
#endif