# Jellyfin Trailer Editor

A Jellyfin server plugin that adds a **YouTube trailer** field to the **existing movie metadata editor** in Jellyfin Web. Enter or remove a trailer URL, then click Jellyfin's normal **Save** button. No separate editor, database, sidecar script, web-root write or additional injector plugin is required.

**Supported targets:** Jellyfin Server **10.11.x** (.NET 9) and **12.x** (.NET 10), with separate plugin packages. Both builds are produced by CI. Web integration is intended for **Jellyfin Web served by your Jellyfin server** (including clients that actually embed it); native third-party clients are not modified.

## What it does

- Adds a multiline YouTube trailer field to **Edit metadata** for movies.
- Loads existing YouTube trailer links from Jellyfin's `RemoteTrailers` metadata, including Kodi-style NFO URLs.
- Supports `youtube.com/watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/` and Kodi-style URLs.
- Accepts multiple trailer URLs (one per line); removes YouTube trailers when left blank; deduplicates URLs.
- Saves **only trailer URLs** using an admin-authorized Jellyfin API endpoint. Existing non-YouTube trailers and all other movie metadata remain intact.
- Uses the normal Jellyfin metadata-save pipeline. If **NFO saver** is enabled for the library and Jellyfin can write to its folder, Jellyfin can also persist the trailers to the movie's NFO.
- Adds the field to the original Jellyfin Web dialog by injecting a JavaScript reference into the served `index.html` **in memory**, without editing on-disk web files.

## Installation through the plugin catalog

1. Open **Dashboard → Plugins → Repositories**, add a repository named `Trailer Editor` with this URL:
   `https://raw.githubusercontent.com/thomasasen/jellyfintrailereditor/main/manifest.json`
2. After a successful GitHub Actions build/release, the manifest includes downloadable, checksum-verified packages. Open **Catalog**, select **Trailer Editor**, and install the compatible version.
3. **Restart Jellyfin**.
4. Open a movie in Jellyfin Web, select **Edit metadata**, and look for **YouTube-Trailer**.

**Release status:** If `manifest.json` contains `"versions": []`, the release workflow has not yet published an installable package. In that case, use the manual build below. Do not expect an empty catalog entry to install successfully.

## Manual installation / build

Requires the corresponding .NET SDK (9 for Jellyfin 10.11, 10 for Jellyfin 12). For Jellyfin 10.11:

```bash
dotnet publish src/Jellyfin.Plugin.TrailerEditor.csproj -c Release -p:TargetJellyfin=10.11 -p:Version=0.1.0.0 -o dist/10.11
```

For Jellyfin 12:

```bash
dotnet publish src/Jellyfin.Plugin.TrailerEditor.csproj -c Release -p:TargetJellyfin=12 -p:Version=0.1.0.12 -o dist/12
```

Stop Jellyfin, create a folder under its plugin directory, copy **only** `Jellyfin.Plugin.TrailerEditor.dll` from the matching build into it, then restart Jellyfin. Common Linux path: `/var/lib/jellyfin/plugins/TrailerEditor_0.1.0/`. Docker installations typically use `/config/plugins/` within the container's configured data volume. **Do not install the .NET 9 assembly on Jellyfin 12, or vice versa.**

Alternatively download the matching ZIP from [Releases](https://github.com/thomasasen/jellyfintrailereditor/releases), once one exists.

## How to use

1. Sign in to Jellyfin Web as an **administrator**.
2. Open any **movie** → **Edit metadata**.
3. In **YouTube-Trailer**, paste one or more URLs, one per line.
4. Click the dialog's normal **Save** button. The plugin first validates and writes changed trailer URLs, then allows Jellyfin's native metadata Save to complete.
5. Reopen the dialog to verify the stored URLs. To remove a YouTube trailer, delete its line and save.

The plugin does not download trailers. Whether external YouTube trailers play depends on the **Jellyfin client** and its external-video support.

## NFO behavior / NAS permissions

The plugin **does not edit `.nfo` files directly**. Jellyfin writes NFO files only when its **NFO saver** is enabled in the library's metadata settings, and when the Jellyfin service has write permissions on that movie directory. This also applies to NFS mounts: a read-only export/mount cannot persist NFO changes. A successful API update can still be stored in Jellyfin's database without an NFO being written. Back up existing NFO files before changing library metadata settings.

## Compatibility, security and constraints

- Only movies (`Movie`) are editable. Series, episodes and other media types are intentionally unsupported.
- The GET and PUT endpoints require Jellyfin's **RequiresElevation** authorization policy. The public JavaScript asset contains no credentials. No YouTube URL is fetched server-side.
- Only recognized YouTube hostnames with a valid 11-character video ID are accepted. Non-YouTube remote trailers are kept unchanged.
- Jellyfin's native `POST /Items/{id}` does not persist `RemoteTrailers`; the plugin deliberately provides its own targeted endpoint instead of posting an incomplete metadata DTO.
- The UI relies on Jellyfin Web's current metadata-dialog markup and its metadata-info network request. Jellyfin Web updates may require UI-selector changes.
- The script observes the page's DOM and catches the metadata-info request to identify the open movie. If a custom web client bypasses these paths, the field may not appear.
- Web caches or reverse proxies may cache `index.html`; clear them and hard-refresh after installing.
- Do not assume that a NFO was written until you verify it on disk.

## API

Admin-authenticated endpoints:

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/TrailerEditor/Items/{guid}` | Returns `{"urls": ["https://www.youtube.com/watch?v=..."]}`. |
| PUT | `/TrailerEditor/Items/{guid}` | Accepts `{"urls": ["https://youtu.be/..."]}`; only YouTube entries are replaced. |
| GET | `/TrailerEditor/ClientScript` | Serves the browser script. |

For `GET` and `PUT`, use the same Jellyfin authentication mechanism as the native web client. IDs are GUIDs. A blank `urls` array removes only YouTube trailers. An invalid URL returns HTTP 400.

## Tests and releases

```bash
node --check web/trailer-editor.js
node --test tests/trailer-editor.test.cjs
```

GitHub Actions builds both DLL targets and creates ZIP artifacts. On main pushes it creates the `v0.1.0` release, uploads the two ZIPs, computes MD5 checksums for Jellyfin's plugin catalog and updates `manifest.json`. Release creation depends on GitHub Actions having **Contents: write** permission.

## Troubleshooting

- **Field missing:** restart Jellyfin, hard-refresh Jellyfin Web, confirm your browser loads `/TrailerEditor/ClientScript`, and check the plugin is active. Native third-party clients do not receive the modified Web UI.
- **403 on save:** use a Jellyfin administrator account.
- **Trailer shown but no NFO update:** enable NFO saver, then check Jellyfin write permissions on your NAS/NFS mount and server logs.
- **Trailer won't play:** the client may not support external YouTube playback; use a local trailer video as an alternative.
- **Plugin not offered by catalog:** verify `manifest.json` has published `versions` entries for your Jellyfin ABI, and check the GitHub Actions build status.

## Implementation

`src/` contains the Jellyfin C# plugin, ASP.NET Core middleware and protected API controller. `web/` contains the injected browser UI; `tests/` covers URL parsing and validation; `scripts/` creates checksummed manifest entries; `.github/workflows/` builds and publishes packages.

License: [MIT](LICENSE).
