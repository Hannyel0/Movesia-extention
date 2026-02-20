#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using System;
using System.Collections.Generic;
using System.Reflection;

/// <summary>
/// Buffers Unity console logs for on-demand retrieval.
/// Backfills existing console entries on initialization so logs that
/// arrived before this class loaded (e.g. compilation warnings) are captured.
/// </summary>
[InitializeOnLoad]
public static class ConsoleLogBuffer
{
    // --- Configuration ---
    private const int MAX_BUFFER_SIZE = 100;

    // --- Storage ---
    private static readonly Queue<LogEntry> logBuffer = new Queue<LogEntry>();
    private static readonly object bufferLock = new object();

    // --- Data Structure ---
    [Serializable]
    public struct LogEntry
    {
        public string message;
        public string stackTrace;
        public string type;
        public long timestamp;
    }

    // --- Initialize on Editor Load ---
    static ConsoleLogBuffer()
    {
        // Backfill any logs already in the Unity console before we subscribed
        BackfillFromConsole();

        // Now subscribe to capture all future logs
        Application.logMessageReceived += OnLogReceived;

        Debug.Log("📋 ConsoleLogBuffer initialized");
    }

    // --- Backfill existing console entries via reflection ---
    private static void BackfillFromConsole()
    {
        try
        {
            var assembly = Assembly.GetAssembly(typeof(Editor));
            var logEntriesType = assembly.GetType("UnityEditor.LogEntries");
            if (logEntriesType == null) return;

            var getCountMethod = logEntriesType.GetMethod("GetCount",
                BindingFlags.Static | BindingFlags.Public);
            var getEntryMethod = logEntriesType.GetMethod("GetEntryInternal",
                BindingFlags.Static | BindingFlags.Public);

            if (getCountMethod == null || getEntryMethod == null) return;

            int totalCount = (int)getCountMethod.Invoke(null, null);
            if (totalCount == 0) return;

            var logEntryType = assembly.GetType("UnityEditor.LogEntry");
            if (logEntryType == null) return;

            var messageField = logEntryType.GetField("message",
                BindingFlags.Instance | BindingFlags.Public);
            var modeField = logEntryType.GetField("mode",
                BindingFlags.Instance | BindingFlags.Public);

            if (messageField == null || modeField == null) return;

            var entry = Activator.CreateInstance(logEntryType);

            // Only backfill the most recent entries up to our buffer size
            int startIndex = Math.Max(0, totalCount - MAX_BUFFER_SIZE);
            long backfillTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            lock (bufferLock)
            {
                for (int i = startIndex; i < totalCount; i++)
                {
                    getEntryMethod.Invoke(null, new object[] { i, entry });

                    int mode = (int)modeField.GetValue(entry);
                    string message = (string)messageField.GetValue(entry);
                    string logType = ModeToLogType(mode);

                    var logEntry = new LogEntry
                    {
                        message = message ?? "",
                        stackTrace = "",  // Internal API doesn't expose stack traces per entry
                        type = logType,
                        timestamp = backfillTimestamp
                    };

                    if (logBuffer.Count >= MAX_BUFFER_SIZE)
                    {
                        logBuffer.Dequeue();
                    }
                    logBuffer.Enqueue(logEntry);
                }
            }
        }
        catch (Exception ex)
        {
            // Silently fail — backfill is best-effort, live capture still works
            Debug.LogWarning($"ConsoleLogBuffer: backfill failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Maps Unity's internal LogEntry mode bitfield to a LogType string.
    /// Mode flags: 1=Error, 2=Assert, 4=Log, 8=Fatal, 16=DontPreprocessCondition,
    ///             32=AssetImportWarning, 64=ScriptingWarning, 128=ScriptingLog,
    ///             256=ScriptingError, 512=StickyLog, 1024=MayIgnoreLineNumber,
    ///             2048=Scripting, 4096=AssetImportError, ...
    /// Warnings don't have a single bit — they show up as various combos.
    /// </summary>
    private static string ModeToLogType(int mode)
    {
        // Check error-class bits first (Error=1, Fatal=8, ScriptingError=256, AssetImportError=4096)
        if ((mode & (1 | 8 | 256 | 4096)) != 0)
            return "Error";

        // Check assert (2)
        if ((mode & 2) != 0)
            return "Assert";

        // Check warning-class bits (AssetImportWarning=32, ScriptingWarning=64)
        if ((mode & (32 | 64)) != 0)
            return "Warning";

        // Everything else is a regular log
        return "Log";
    }

    // --- Capture Logs ---
    private static void OnLogReceived(string message, string stackTrace, LogType type)
    {
        var entry = new LogEntry
        {
            message = message,
            stackTrace = stackTrace,
            type = type.ToString(),
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        lock (bufferLock)
        {
            if (logBuffer.Count >= MAX_BUFFER_SIZE)
            {
                logBuffer.Dequeue();
            }
            logBuffer.Enqueue(entry);
        }
    }

    // --- Public API ---

    /// <summary>
    /// Get all buffered logs.
    /// </summary>
    public static LogEntry[] GetLogs()
    {
        lock (bufferLock)
        {
            return logBuffer.ToArray();
        }
    }

    /// <summary>
    /// Get logs filtered by type (Error, Warning, Log, etc.)
    /// </summary>
    public static LogEntry[] GetLogs(string filterType)
    {
        lock (bufferLock)
        {
            var filtered = new List<LogEntry>();
            foreach (var entry in logBuffer)
            {
                if (entry.type.Equals(filterType, StringComparison.OrdinalIgnoreCase))
                {
                    filtered.Add(entry);
                }
            }
            return filtered.ToArray();
        }
    }

    /// <summary>
    /// Get the most recent N logs.
    /// </summary>
    public static LogEntry[] GetRecentLogs(int count)
    {
        lock (bufferLock)
        {
            var logs = logBuffer.ToArray();
            if (logs.Length <= count)
                return logs;

            var recent = new LogEntry[count];
            Array.Copy(logs, logs.Length - count, recent, 0, count);
            return recent;
        }
    }

    /// <summary>
    /// Clear the log buffer.
    /// </summary>
    public static void Clear()
    {
        lock (bufferLock)
        {
            logBuffer.Clear();
        }
    }

    /// <summary>
    /// Get current buffer count.
    /// </summary>
    public static int Count
    {
        get
        {
            lock (bufferLock)
            {
                return logBuffer.Count;
            }
        }
    }
}
#endif