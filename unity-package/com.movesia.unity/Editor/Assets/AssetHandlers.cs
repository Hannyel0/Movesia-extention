#if UNITY_EDITOR
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

/// <summary>
/// Handles asset operations: search_assets, get_asset_labels, get_type_aliases, delete_assets.
/// </summary>
internal static class AssetHandlers
{
    internal static async Task HandleSearchAssets(string requestId, JToken body)
    {
        string type = body?["type"]?.ToString();
        string nameFilter = body?["name"]?.ToString();
        string label = body?["label"]?.ToString();
        string folder = body?["folder"]?.ToString();
        int limit = body?["limit"]?.ToObject<int>() ?? 100;
        string extension = body?["extension"]?.ToString();

        var result = AssetSearch.Search(type, nameFilter, label, folder, limit, extension);
        await MessageRouter.SendResponse(requestId, "assets_found", result);
    }

    internal static async Task HandleGetAssetLabels(string requestId, JToken body)
    {
        var labels = AssetSearch.GetAllLabels();
        await MessageRouter.SendResponse(requestId, "asset_labels", new { count = labels.Length, labels });
    }

    internal static async Task HandleGetTypeAliases(string requestId, JToken body)
    {
        var aliases = AssetSearch.GetTypeAliases();
        await MessageRouter.SendResponse(requestId, "type_aliases", aliases);
    }

    internal static async Task HandleDeleteAssets(string requestId, JToken body)
    {
        var result = await DeletionManager.HandleDeleteRequest(requestId, body);

        // If result is null, domain reload is happening and response will be sent after reload
        if (result != null)
        {
            await MessageRouter.SendResponse(requestId, "assets_deleted", result);
        }
    }
}
#endif
