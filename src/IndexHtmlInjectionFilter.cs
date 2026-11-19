using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.TrailerEditor;

/// <summary>
/// Inserts a same-origin script reference into Jellyfin Web's index page.
/// It does not modify any on-disk Jellyfin assets or rely on other plugins.
/// </summary>
public sealed class IndexHtmlInjectionFilter : IStartupFilter
{
    private const string Marker = "<!-- Jellyfin Trailer Editor -->";
    private readonly ILogger<IndexHtmlInjectionFilter> _logger;

    public IndexHtmlInjectionFilter(ILogger<IndexHtmlInjectionFilter> logger) => _logger = logger;

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) =>
        app =>
        {
            app.Use(InjectAsync);
            next(app);
        };

    private async Task InjectAsync(HttpContext context, RequestDelegate next)
    {
        if (!IsWebIndex(context.Request.Path))
        {
            await next(context).ConfigureAwait(false);
            return;
        }

        // We need uncompressed HTML to rewrite the short index document.
        context.Request.Headers.Remove("Accept-Encoding");

        var original = context.Response.Body;
        await using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await next(context).ConfigureAwait(false);
        }
        catch
        {
            context.Response.Body = original;
            throw;
        }

        context.Response.Body = original;
        buffer.Position = 0;
        if (context.Response.StatusCode != StatusCodes.Status200OK
            || context.Response.ContentType?.Contains("text/html", StringComparison.OrdinalIgnoreCase) != true
            || context.Response.Headers.ContainsKey("Content-Encoding"))
        {
            await buffer.CopyToAsync(original, context.RequestAborted).ConfigureAwait(false);
            return;
        }

        using var reader = new StreamReader(buffer, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
        var html = await reader.ReadToEndAsync(context.RequestAborted).ConfigureAwait(false);
        if (!html.Contains(Marker, StringComparison.Ordinal)
            && html.Contains("</body>", StringComparison.OrdinalIgnoreCase))
        {
            // Relative to /web/index.html or /web/, including deployments with Base URL.
            // No inline JavaScript, so common CSP rules can permit it.
            const string snippet = "\n    " + Marker +
                "\n    <script src=\"../TrailerEditor/ClientScript\" defer></script>\n</body>";
            html = html.Replace("</body>", snippet, StringComparison.OrdinalIgnoreCase);
            _logger.LogDebug("Injected Trailer Editor into Jellyfin Web response");
        }

        context.Response.Headers.Remove("Content-Length");
        context.Response.Headers.Remove("ETag");
        context.Response.Headers.Remove("Content-Encoding");
        context.Response.Headers["Cache-Control"] = "no-store";
        context.Response.ContentLength = null;
        await context.Response.WriteAsync(html, context.RequestAborted).ConfigureAwait(false);
    }

    private static bool IsWebIndex(PathString path)
    {
        var value = path.Value ?? string.Empty;
        return value.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase)
            || value.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
            || value.EndsWith("/web", StringComparison.OrdinalIgnoreCase);
    }
}
