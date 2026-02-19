#if UNITY_EDITOR
using System;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles log-related messages: get_logs, get_errors, clear_logs, ping.
/// </summary>
internal static class LogHandlers
{
    internal static async Task HandlePing(string requestId, JToken body)
    {
        await MessageRouter.SendResponse(requestId, "pong", new
        {
            serverTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
    }

    internal static async Task HandleGetLogs(string requestId, JToken body)
    {
        int limit = body?["limit"]?.ToObject<int>() ?? 0;
        string filter = body?["filter"]?.ToString();

        ConsoleLogBuffer.LogEntry[] logs;

        if (!string.IsNullOrEmpty(filter))
        {
            logs = ConsoleLogBuffer.GetLogs(filter);
        }
        else
        {
            logs = ConsoleLogBuffer.GetLogs();
        }

        // Apply limit after filtering — returns the most recent N
        if (limit > 0 && logs.Length > limit)
        {
            var limited = new ConsoleLogBuffer.LogEntry[limit];
            Array.Copy(logs, logs.Length - limit, limited, 0, limit);
            logs = limited;
        }

        await MessageRouter.SendResponse(requestId, "logs_response", new
        {
            count = logs.Length,
            logs
        });
    }

    internal static async Task HandleGetErrors(string requestId, JToken body)
    {
        var errors = ConsoleLogBuffer.GetLogs("Error");
        var exceptions = ConsoleLogBuffer.GetLogs("Exception");

        var allErrors = new ConsoleLogBuffer.LogEntry[errors.Length + exceptions.Length];
        errors.CopyTo(allErrors, 0);
        exceptions.CopyTo(allErrors, errors.Length);

        await MessageRouter.SendResponse(requestId, "errors_response", new
        {
            count = allErrors.Length,
            logs = allErrors
        });
    }

    internal static async Task HandleClearLogs(string requestId, JToken body)
    {
        ConsoleLogBuffer.Clear();
        await MessageRouter.SendResponse(requestId, "clear_response", new { success = true });
    }
}
#endif
