/* Jellyfin Trailer Editor: injected into the existing metadata dialog. */
(function (root) {
    'use strict';

    const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
    const GUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i;

    function canonicalYouTube(input) {
        if (typeof input !== 'string' || !input.trim() || input.length > 2048) return null;
        const value = input.trim();
        if (value.toLowerCase().startsWith('plugin://plugin.video.youtube/')) {
            const match = value.match(/[?&](?:video_id|videoid)=([A-Za-z0-9_-]{11})(?:[&#]|$)/i);
            return match ? 'https://www.youtube.com/watch?v=' + match[1] : null;
        }
        let url;
        try { url = new URL(value); } catch (_) { return null; }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        if (url.port && !['80', '443'].includes(url.port)) return null;
        const host = url.hostname.toLowerCase();
        const short = ['youtu.be', 'www.youtu.be'].includes(host);
        const normal = ['youtube.com', 'www.youtube.com', 'm.youtube.com',
            'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host);
        if (!short && !normal) return null;
        const parts = url.pathname.split('/').filter(Boolean);
        let id = null;
        if (short && parts.length === 1) id = parts[0];
        else if (normal && parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v');
        else if (normal && parts.length === 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
        return id && VIDEO_ID.test(id) ? 'https://www.youtube.com/watch?v=' + id : null;
    }

    function parseList(text) {
        const result = [];
        const seen = new Set();
        for (const raw of text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
            const url = canonicalYouTube(raw);
            if (!url) throw new Error('Ungültige YouTube-URL: ' + raw.slice(0, 100));
            if (!seen.has(url)) { seen.add(url); result.push(url); }
        }
        return result;
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { canonicalYouTube, parseList };
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    if (root.__jellyfinTrailerEditorLoaded) return;
    root.__jellyfinTrailerEditorLoaded = true;

    const scriptUrl = document.currentScript && document.currentScript.src;
    if (!scriptUrl) return;
    const apiRoot = new URL('./', scriptUrl);
    const mounted = new WeakSet();
    let lastEditorId = null;

    // The editor's XHR often starts *after* its form has already been inserted.
    // Updating lastEditorId without rescanning leaves the field permanently missing.
    function scheduleScan() {
        // Wait for XMLHttpRequest.setRequestHeader(), which usually follows open()
        // synchronously. An immediate scan would send the plugin GET without auth.
        Promise.resolve().then(scan);
        if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(scan);
        else root.setTimeout(scan, 0);
    }

    // Capture only authentication already attached to Jellyfin's own *same-origin*
    // metadata-editor request. The client may not expose its ApiClient globally.
    // Never log, store persistently or return these values to the page.
    const authHeaders = Object.create(null);
    const authHeaderNames = new Set([
        'authorization', 'x-emby-authorization', 'x-emby-token', 'x-mediabrowser-token'
    ]);
    const metadataRequests = new WeakSet();

    function captureHeader(name, value) {
        const lower = String(name).toLowerCase();
        if (authHeaderNames.has(lower) && typeof value === 'string' && value) {
            authHeaders[lower] = value;
        }
    }

    function captureHeaders(headers) {
        if (!headers) return;
        if (typeof headers.forEach === 'function') {
            headers.forEach((value, key) => captureHeader(key, value));
        } else if (Array.isArray(headers)) {
            for (const pair of headers) if (Array.isArray(pair)) captureHeader(pair[0], pair[1]);
        } else if (typeof headers === 'object') {
            for (const [key, value] of Object.entries(headers)) captureHeader(key, value);
        }
    }

    // Jellyfin's metadata editor keeps currentItem private to its JS module.
    function inspectRequest(url, headers) {
        const match = String(url).match(/\/Items\/([0-9a-f-]{32,36})\/MetadataEditor(?:[?#]|$)/i);
        if (!match || !GUID.test(match[1])) return false;
        let absolute;
        try { absolute = new URL(String(url), root.location.href); }
        catch (_) { return false; }
        if (absolute.origin !== apiRoot.origin) return false;
        captureHeaders(headers);
        lastEditorId = match[1];
        scheduleScan();
        return true;
    }

    const nativeFetch = root.fetch;
    if (typeof nativeFetch === 'function') {
        root.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : input && input.url;
            const headers = init && init.headers || input && input.headers;
            inspectRequest(url, headers);
            return nativeFetch.apply(this, arguments);
        };
    }
    if (root.XMLHttpRequest && root.XMLHttpRequest.prototype) {
        const nativeOpen = root.XMLHttpRequest.prototype.open;
        const nativeSetHeader = root.XMLHttpRequest.prototype.setRequestHeader;
        root.XMLHttpRequest.prototype.open = function (method, url) {
            if (inspectRequest(url)) metadataRequests.add(this);
            else metadataRequests.delete(this);
            return nativeOpen.apply(this, arguments);
        };
        if (typeof nativeSetHeader === 'function') {
            root.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
                if (metadataRequests.has(this)) captureHeader(name, value);
                return nativeSetHeader.apply(this, arguments);
            };
        }
    }

    function routeId() {
        const href = root.location && root.location.href || '';
        const match = href.match(/[?&]id=([0-9a-f-]{32,36})(?:[&#]|$)/i);
        return match ? match[1] : null;
    }

    function token() {
        const api = root.ApiClient || (root.ServerConnections
            && root.ServerConnections.currentApiClient && root.ServerConnections.currentApiClient());
        return api && typeof api.accessToken === 'function' ? api.accessToken() : null;
    }

    async function request(path, method, body) {
        const headers = { Accept: 'application/json' };
        for (const [name, value] of Object.entries(authHeaders)) headers[name] = value;
        if (!Object.keys(authHeaders).length) {
            const auth = token();
            if (auth) headers['X-Emby-Token'] = auth;
        }
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await nativeFetch.call(root, new URL(path, apiRoot).toString(), {
            method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (!response.ok) {
            let problem = '';
            try {
                const data = await response.json();
                problem = data.message || data.detail || data.title || '';
            } catch (_) { /* no JSON response */ }
            const error = new Error(problem || 'HTTP ' + response.status);
            error.status = response.status;
            throw error;
        }
        return response.json();
    }

    function message(el, value, error) {
        el.textContent = value;
        el.style.color = error ? '#ff7777' : '';
    }

    async function mount(form, itemId) {
        if (mounted.has(form)) return;
        const footer = form.querySelector('.formDialogFooter');
        const sortName = form.querySelector('#txtSortName');
        const anchor = sortName && sortName.closest('.inputContainer');
        if (!footer && !anchor) return;
        mounted.add(form);

        const field = document.createElement('div');
        field.className = 'inputContainer jte-field';
        field.style.marginBottom = '1.5em';

        const label = document.createElement('label');
        label.className = 'inputLabel inputLabelUnfocused';
        label.htmlFor = 'jteTrailers';
        label.textContent = 'YouTube-Trailer';
        const input = document.createElement('input');
        input.type = 'url';
        input.id = 'jteTrailers';
        input.className = 'emby-input';
        input.autocomplete = 'off';
        // Always editable, even when the first metadata GET fails.
        input.disabled = false;
        input.placeholder = 'https://www.youtube.com/watch?v=...';
        input.style.width = '100%';
        input.style.boxSizing = 'border-box';

        const help = document.createElement('div');
        help.className = 'fieldDescription';
        help.textContent = 'Ein Trailer-Link pro Film. Leer lassen, um YouTube-Trailer zu entfernen.';
        const status = document.createElement('div');
        status.className = 'fieldDescription';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        field.append(label, input, help, status);
        if (anchor) anchor.after(field);
        else footer.before(field);

        let original = [];
        let loaded = false;
        let dirty = false;
        input.addEventListener('input', () => { dirty = true; });
        try {
            const response = await request('Items/' + itemId, 'GET');
            original = response.urls || response.Urls || [];
            if (!dirty) input.value = original[0] || '';
            loaded = true;
            message(status, original.length > 1
                ? 'Mehrere vorhandene Trailer: Beim Ändern wird nur der angezeigte übernommen.'
                : 'Trailer-Feld bereit', false);
        } catch (error) {
            if (error.status === 404) {
                // Movie-only feature: never show the editor field for Series/Episodes.
                field.remove();
            } else {
                // Keep the field editable. If the user explicitly changes it,
                // retrying the write is safe; a failed GET must not silently lose edits.
                message(status, 'Vorhandener Trailer konnte nicht geladen werden ('
                    + error.message + '). Eingabe möglich; Speichern wird erneut versucht.', true);
            }
        }

        // Runs BEFORE Jellyfin's native onSubmit. Save trailers first and only
        // dispatch to the native handler after our write was acknowledged.
        // Jellyfin's native item-update endpoint does not update RemoteTrailers.
        let passThrough = false;
        let busy = false;
        form.addEventListener('submit', async function (event) {
            if (passThrough) {
                passThrough = false;
                return;
            }
            // A failed GET is not permission to clear unknown existing trailers.
            if (!loaded && !dirty) return;
            let proposed;
            try {
                const raw = input.value.trim();
                const canonical = raw ? canonicalYouTube(raw) : null;
                if (raw && !canonical) throw new Error('Bitte eine gültige YouTube-Trailer-URL eingeben.');
                proposed = canonical ? [canonical] : [];
            } catch (error) {
                event.preventDefault();
                event.stopImmediatePropagation();
                message(status, error.message, true);
                input.focus();
                return;
            }
            // With multiple saved trailers the single-line control displays only
            // the first one; an unchanged field must not delete the others.
            if (!dirty || (loaded && proposed[0] === original[0] &&
                proposed.length === (original.length ? 1 : 0))) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            if (busy) return;
            busy = true;
            input.disabled = true;
            message(status, 'Trailer werden gespeichert …', false);
            try {
                await request('Items/' + itemId, 'PUT', { urls: proposed });
                original = proposed;
                loaded = true;
                dirty = false;
                message(status, 'Trailer gespeichert', false);
                passThrough = true;
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            } catch (error) {
                message(status, 'Speichern fehlgeschlagen: ' + error.message, true);
            } finally {
                busy = false;
                input.disabled = false;
            }
        }, true);
    }

    function scan() {
        for (const form of document.querySelectorAll('form.editItemMetadataForm')) {
            if (mounted.has(form)) continue;
            const id = lastEditorId || routeId();
            if (id) mount(form, id);
        }
    }
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    root.addEventListener('hashchange', scheduleScan);
    root.addEventListener('popstate', scheduleScan);
    scheduleScan();
})(globalThis);
