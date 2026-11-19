using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.TrailerEditor;

/// <summary>Strict YouTube URL parsing; never dereferences user-supplied links.</summary>
public static partial class YouTubeUrl
{
    [GeneratedRegex("^[A-Za-z0-9_-]{11}$", RegexOptions.CultureInvariant)]
    private static partial Regex VideoIdPattern();

    [GeneratedRegex(@"(?:[?&](?:video_id|videoid)=)([A-Za-z0-9_-]{11})(?:[&#]|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex KodiVideoIdPattern();

    public static bool TryNormalize(string? raw, out string? normalized)
    {
        normalized = null;
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 2048)
        {
            return false;
        }

        var input = raw.Trim();
        if (input.StartsWith("plugin://plugin.video.youtube/", StringComparison.OrdinalIgnoreCase))
        {
            var match = KodiVideoIdPattern().Match(input);
            if (!match.Success)
            {
                return false;
            }

            normalized = "https://www.youtube.com/watch?v=" + match.Groups[1].Value;
            return true;
        }

        if (!Uri.TryCreate(input, UriKind.Absolute, out var url)
            || (url.Scheme != Uri.UriSchemeHttps && url.Scheme != Uri.UriSchemeHttp)
            || !string.IsNullOrEmpty(url.UserInfo)
            || url.Port != (url.Scheme == Uri.UriSchemeHttps ? 443 : 80))
        {
            return false;
        }

        var host = url.IdnHost.ToLowerInvariant();
        var isShort = host is "youtu.be" or "www.youtu.be";
        var isYoutube = host is "youtube.com" or "www.youtube.com" or "m.youtube.com"
            or "music.youtube.com" or "youtube-nocookie.com" or "www.youtube-nocookie.com";
        if (!isShort && !isYoutube)
        {
            return false;
        }

        var parts = url.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        string? id = null;
        if (isShort && parts.Length == 1)
        {
            id = parts[0];
        }
        else if (isYoutube && parts.Length == 1 && parts[0] == "watch")
        {
            id = ParseQueryValue(url.Query, "v");
        }
        else if (isYoutube && parts.Length == 2
            && (parts[0] is "embed" or "shorts" or "live" or "v"))
        {
            id = parts[1];
        }

        if (id is null || !VideoIdPattern().IsMatch(id))
        {
            return false;
        }

        normalized = "https://www.youtube.com/watch?v=" + id;
        return true;
    }

    private static string? ParseQueryValue(string query, string key)
    {
        foreach (var section in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var index = section.IndexOf('=');
            if (index < 0 || !string.Equals(section[..index], key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return Uri.UnescapeDataString(section[(index + 1)..]);
        }

        return null;
    }
}
