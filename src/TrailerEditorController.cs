using Jellyfin.Data.Enums;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.TrailerEditor;

/// <summary>Serves the editor script and updates only a movie's YouTube trailer URLs.</summary>
[ApiController]
[Route("TrailerEditor")]
public sealed class TrailerEditorController : ControllerBase
{
    private static readonly SemaphoreSlim WriteLock = new(1, 1);
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<TrailerEditorController> _logger;

    public TrailerEditorController(ILibraryManager libraryManager, ILogger<TrailerEditorController> logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    // Lightweight installation diagnostic. Does not expose item metadata or credentials.
    [HttpGet("Status")]
    [AllowAnonymous]
    public IActionResult Status() => Ok(new
    {
        plugin = "Trailer Editor",
        version = typeof(TrailerEditorController).Assembly.GetName().Version?.ToString(),
        loaded = true,
        editor = "Jellyfin Web"
    });

    [HttpGet("ClientScript")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    public IActionResult ClientScript()
    {
        var stream = typeof(TrailerEditorController).Assembly
            .GetManifestResourceStream("Jellyfin.Plugin.TrailerEditor.web.trailer-editor.js");
        if (stream is null)
        {
            return NotFound();
        }

        Response.Headers["Cache-Control"] = "no-store";
        return File(stream, "application/javascript; charset=utf-8");
    }

    [HttpGet("Items/{itemId:guid}")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public IActionResult GetTrailers(Guid itemId)
    {
        if (_libraryManager.GetItemById(itemId) is not Movie movie)
        {
            return NotFound();
        }

        return Ok(new TrailerResponse(
            movie.RemoteTrailers
                .Select(t => t.Url)
                .Where(url => YouTubeUrl.TryNormalize(url, out _))
                .Select(url => { YouTubeUrl.TryNormalize(url, out var result); return result!; })
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray()));
    }

    [HttpPut("Items/{itemId:guid}")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public async Task<IActionResult> SaveTrailers(Guid itemId, [FromBody] TrailerRequest request, CancellationToken cancellationToken)
    {
        if (request?.Urls is null || request.Urls.Length > 32)
        {
            return BadRequest(new { message = "Supply an array of up to 32 YouTube URLs." });
        }

        var canonical = new List<string>();
        foreach (var raw in request.Urls)
        {
            if (!YouTubeUrl.TryNormalize(raw, out var url))
            {
                return BadRequest(new { message = "An invalid YouTube URL was supplied." });
            }

            if (!canonical.Contains(url!, StringComparer.OrdinalIgnoreCase))
            {
                canonical.Add(url!);
            }
        }

        await WriteLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_libraryManager.GetItemById(itemId) is not Movie movie)
            {
                return NotFound();
            }

            // Retain all non-YouTube remote trailers. Never modify other metadata.
            var keep = movie.RemoteTrailers
                .Where(x => !YouTubeUrl.TryNormalize(x.Url, out _))
                .ToList();

            var desired = keep
                .Concat(canonical.Select(url => new MediaUrl { Url = url, Name = "YouTube" }))
                .ToList();

            var originalUrls = movie.RemoteTrailers.Select(x => x.Url).ToArray();
            var desiredUrls = desired.Select(x => x.Url).ToArray();
            if (!originalUrls.SequenceEqual(desiredUrls, StringComparer.OrdinalIgnoreCase))
            {
                movie.RemoteTrailers = desired;
                movie.OnMetadataChanged();
                await movie.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit, cancellationToken).ConfigureAwait(false);
                // Jellyfin's configured metadata savers (including the optional NFO saver)
                // run through the standard library metadata-edit persistence pipeline.
                _logger.LogInformation("Updated YouTube trailers for movie {MovieId}: {Count} URLs", itemId, canonical.Count);
            }

            return Ok(new TrailerResponse(canonical.ToArray()));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Unable to save trailers for movie {MovieId}", itemId);
            return Problem("Jellyfin could not save the trailer metadata. Check server logs and NFO permissions.");
        }
        finally
        {
            WriteLock.Release();
        }
    }

    public sealed record TrailerRequest(string[]? Urls);

    public sealed record TrailerResponse(string[] Urls);
}
