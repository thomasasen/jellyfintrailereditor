# Jellyfin Trailer Editor

A Jellyfin server plugin that adds a **single-line YouTube trailer URL** field to the **existing movie metadata editor** in Jellyfin Web. Enter or remove a trailer URL, then click Jellyfin's normal **Save** button. No separate editor, database, sidecar script, web-root write or additional injector plugin is required.

**Supported targets:** Jellyfin Server **10.11.x** (.NET 9) and **12.x** (.NET 10), with separate plugin packages. Both builds are produced by CI. Web integration is intended for **Jellyfin Web served by your Jellyfin server** (including clients that actually embed it); native third-party clients are not modified.

## What it does

- Adds a single-line URL input directly below **Sort title** near the top of **Edit metadata** for movies.
- Loads existing YouTube trailer links from Jellyfin's `RemoteTrailers` metadata, including Kodi-style NFO URLs.
- Supports `youtube.com/watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/` and Kodi-style URLs.
- Accepts one trailer URL per movie in the interface; leaving it blank removes YouTube trailers. The API continues to accept multiple URLs for compatibility.
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
dotnet publish src/Jellyfin.Plugin.TrailerEditor.csproj -c Release -p:TargetJellyfin=10.11 -p:Version=0.1.2.0 -o dist/10.11
```

For Jellyfin 12:

```bash
dotnet publish src/Jellyfin.Plugin.TrailerEditor.csproj -c Release -p:TargetJellyfin=12 -p:Version=0.1.2.12 -o dist/12
```

Stop Jellyfin, create a folder under its plugin directory, copy **only** `Jellyfin.Plugin.TrailerEditor.dll` from the matching build into it, then restart Jellyfin. Common Linux path: `/var/lib/jellyfin/plugins/TrailerEditor_0.1.0/`. Docker installations typically use `/config/plugins/` within the container's configured data volume. **Do not install the .NET 9 assembly on Jellyfin 12, or vice versa.**

Alternatively download the matching ZIP from [Releases](https://github.com/thomasasen/jellyfintrailereditor/releases), once one exists.

## How to use

1. Sign in to Jellyfin Web as an **administrator**.
2. Open any **movie** → **Edit metadata**.
3. In **YouTube-Trailer** (below **Sort title**, near the top), paste a single YouTube URL.
4. Click the dialog's normal **Save** button. The plugin first validates and writes changed trailer URLs, then allows Jellyfin's native metadata Save to complete.
5. Reopen the dialog to verify the stored URLs. To remove a YouTube trailer, delete its line and save.

If the movie already has multiple YouTube trailers, the input displays the first one; saving without editing keeps all existing URLs, while changing the URL replaces the YouTube trailer list with the single new link. The plugin does not download trailers. Whether external YouTube trailers play depends on the **Jellyfin client** and its external-video support.

## NFO behavior / NAS permissions

The plugin **does not edit `.nfo` files directly**. Jellyfin writes NFO files only when its **NFO saver** is enabled in the library's metadata settings, and when the Jellyfin service has write permissions on that movie directory. This also applies to NFS mounts: a read-only export/mount cannot persist NFO changes. A successful API update can still be stored in Jellyfin's database without an NFO being written. Back up existing NFO files before changing library metadata settings.

## Compatibility, security and constraints

- Only movies (`Movie`) are editable. Series, episodes and other media types are intentionally unsupported.
- The GET and PUT endpoints require Jellyfin's **RequiresElevation** authorization policy. The public JavaScript asset contains no credentials. No YouTube URL is fetched server-side.
- Only recognized YouTube hostnames with a valid 11-character video ID are accepted. Non-YouTube remote trailers are kept unchanged.
- Jellyfin's native `POST /Items/{id}` does not persist `RemoteTrailers`; the plugin deliberately provides its own targeted endpoint instead of posting an incomplete metadata DTO.
- The UI relies on Jellyfin Web's current metadata-dialog markup and its metadata-info network request. Jellyfin Web updates may require UI-selector changes.
- The script observes the page's DOM and catches the metadata-info request. It **rescans immediately when the request starts**, so it also works when the metadata form was inserted before the item ID became available. If a custom web client bypasses these paths, the field may not appear.
- Web caches or reverse proxies may cache `index.html`; clear them and hard-refresh after installing.
- Do not assume that a NFO was written until you verify it on disk.

## API

Admin-authenticated endpoints:

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/TrailerEditor/Items/{guid}` | Returns `{"urls": ["https://www.youtube.com/watch?v=..."]}`. |
| PUT | `/TrailerEditor/Items/{guid}` | Accepts `{"urls": ["https://youtu.be/..."]}`; only YouTube entries are replaced. |
| GET | `/TrailerEditor/ClientScript` | Serves the browser script. |\n| GET | `/TrailerEditor/Status` | Anonymous installation diagnostic, no user data. |

For `GET` and `PUT`, use the same Jellyfin authentication mechanism as the native web client. IDs are GUIDs. A blank `urls` array removes only YouTube trailers. An invalid URL returns HTTP 400.

## Tests and releases

```bash
node --check web/trailer-editor.js
node --test tests/trailer-editor.test.cjs
```

GitHub Actions builds both DLL targets and creates ZIP artifacts. On main pushes it creates the `v0.1.2` release, uploads the two ZIPs, computes MD5 checksums for Jellyfin's plugin catalog and updates `manifest.json`. Release creation depends on GitHub Actions having **Contents: write** permission.

## Quick check: is the browser integration loaded?\n\n1. In a browser, open `https://YOUR-JELLYFIN-SERVER/TrailerEditor/Status` (include your Jellyfin Base URL if configured). You should get JSON with `loaded: true`. That verifies the server plugin is installed, **not** the browser integration.\n2. Open `/web/index.html` and use **View source**. It should include `<!-- Jellyfin Trailer Editor -->` and `../TrailerEditor/ClientScript`.\n3. Open `/TrailerEditor/ClientScript`. JavaScript should be returned, not a 404.\n4. Hard refresh Jellyfin Web with **Ctrl+Shift+R**. Then open a movie's **Edit metadata** and look immediately after **Sort title**.\n\nIf the plugin status works but the script tag is absent from the HTML response, your Jellyfin Web may be hosted separately or a reverse proxy may be serving a cached `index.html`. In this case the plugin cannot automatically change the separately hosted web frontend; use the frontend hosted by Jellyfin Server, or configure the frontend to include the script.\n\n## Authentication and editing diagnostics

If the Trailer Editor URL field appears but cannot be used, update to **0.1.2** or later, then restart Jellyfin and hard refresh Jellyfin Web. Unlike earlier versions, the input remains editable even if reading existing trailer metadata fails. Any GET error is displayed immediately below the field. Jellyfin Web may use a non-global API client; this version captures the authentication header from Jellyfin's own metadata-editor request so that the trailer API can authenticate without asking for credentials.

A trailer is only written if the value has changed. If loading existing trailers fails and the field is left untouched, the native metadata editor can still save without inadvertently deleting trailer links. An explicit new URL triggers a write attempt and errors are displayed without closing the dialog. Browser developers can inspect GET/PUT failures in the Network tab; do not copy access tokens into public issues.

## Troubleshooting

- **Field missing:** use the four diagnostics above; restart Jellyfin, hard-refresh Jellyfin Web, and verify you use Jellyfin Server's own hosted frontend. Native third-party clients do not receive this Web UI.
- **403 on save:** use a Jellyfin administrator account.
- **Trailer shown but no NFO update:** enable NFO saver, then check Jellyfin write permissions on your NAS/NFS mount and server logs.
- **Trailer won't play:** the client may not support external YouTube playback; use a local trailer video as an alternative.
- **Plugin not offered by catalog:** verify `manifest.json` has published `versions` entries for your Jellyfin ABI, and check the GitHub Actions build status.

## Implementation

`src/` contains the Jellyfin C# plugin, ASP.NET Core middleware and protected API controller. `web/` contains the injected browser UI; `tests/` covers URL parsing and validation; `scripts/` creates checksummed manifest entries; `.github/workflows/` builds and publishes packages.

License: [MIT](LICENSE).
