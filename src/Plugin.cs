using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;

namespace Jellyfin.Plugin.TrailerEditor;

/// <summary>Registers the Trailer Editor plugin.</summary>
public sealed class Plugin : BasePlugin
{
    public static readonly Guid PluginId = Guid.Parse("56e9d5a8-b42c-4eb7-9e8e-d09bd15a4f08");

    public Plugin(IApplicationPaths applicationPaths)
    {
        var assembly = GetType().Assembly;
        var location = assembly.Location;
        SetAttributes(
            location,
            Path.Combine(applicationPaths.PluginsPath, Path.GetFileNameWithoutExtension(location)),
            assembly.GetName().Version);
    }

    public override string Name => "Trailer Editor";

    public override string Description => "Edit YouTube trailer URLs inside Jellyfin's existing movie metadata dialog.";

    public override Guid Id => PluginId;
}
