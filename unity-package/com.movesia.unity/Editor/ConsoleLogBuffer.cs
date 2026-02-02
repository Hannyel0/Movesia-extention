#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using System;
using System.Collections.Generic;

/// <summary>
/// Buffers Unity console logs for on-demand retrieval.
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
        Application.logMessageReceived += OnLogReceived;
        AssemblyReloadEvents.afterAssemblyReload += Clear;
        Debug.Log("📋 ConsoleLogBuffer initialized");
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