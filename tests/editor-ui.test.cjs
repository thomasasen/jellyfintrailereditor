const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'web', 'trailer-editor.js'), 'utf8');
const movieId = 'ee5f250e-ae5e-4bca-903e-8c22cf9c8aa8';

function harness(movieOnly = true, options = {}) {
    let field = null;
    let formSubmitted = 0;
    let nativeSubmit = 0;
    const calls = [];
    const listeners = [];
    const sortAnchor = { after(element) { field = element; } };
    const footer = { before(element) { field = element; } };
    const form = {
        querySelector(selector) {
            if (selector === '.formDialogFooter') return footer;
            if (selector === '#txtSortName') return { closest() { return sortAnchor; } };
            return null;
        },
        addEventListener(type, callback, capture) {
            if (type === 'submit') listeners.push({ callback, capture });
        },
        dispatchEvent(event) {
            formSubmitted++;
            for (const listener of listeners.filter(x => x.capture)) listener.callback(event);
            nativeSubmit++;
        }
    };
    function element(tag) {
        return {
            tagName: tag.toUpperCase(),
            style: {},
            children: [],
            append(...children) { this.children.push(...children); },
            setAttribute() {},
            addEventListener(type, listener) { (this.listeners ||= {})[type] = listener; },
            fire(type) { if (this.listeners?.[type]) this.listeners[type](); },
            remove() { if (field === this) field = null; },
            focus() {},
        };
    }

    const doc = {
        currentScript: { src: 'http://jellyfin.local/TrailerEditor/ClientScript' },
        documentElement: {},
        createElement: element,
        querySelectorAll(selector) {
            return selector === 'form.editItemMetadataForm' ? [form] : [];
        }
    };
    const fetch = async (url, opts) => {
        calls.push({ url: String(url), opts });
        const itemEndpoint = String(url).includes('/TrailerEditor/Items/' + movieId);
        if (itemEndpoint && options.legacyAuthDisabled &&
            !/^MediaBrowser Token="[A-Za-z0-9._~-]+"$/.test(opts.headers.Authorization || '')) {
            return { ok: false, status: 401, json: async () => ({}) };
        }
        if (itemEndpoint && !movieOnly) return { ok: false, status: 404, json: async () => ({}) };
        if (itemEndpoint && opts.method === 'GET' && options.getStatus) {
            return { ok: false, status: options.getStatus, json: async () => ({}) };
        }
        return {
            ok: true,
            status: 200,
            json: async () => itemEndpoint
                ? { urls: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'] }
                : { success: true }
        };
    };
    class XMLHttpRequest {
        open() { return undefined; }
        setRequestHeader() { return undefined; }
    }
    class MutationObserver {
        observe() {}
    }
    class Event {
        constructor(type, params) { this.type = type; this.bubbles = params.bubbles; this.cancelable = params.cancelable; }
        preventDefault() {}
        stopImmediatePropagation() {}
    }

    const env = {
        document: doc,
        fetch,
        XMLHttpRequest,
        MutationObserver,
        Event,
        URL,
        location: { href: 'http://jellyfin.local/web/#/dashboard' },
        ApiClient: options.noGlobalApiClient ? undefined : { accessToken() { return 'test-token'; } },
        addEventListener() {},
        requestAnimationFrame(callback) { setImmediate(callback); },
        setTimeout(callback) { setImmediate(callback); },
        console
    };
    env.globalThis = env;
    vm.runInNewContext(code, env, { filename: 'trailer-editor.js' });
    return {
        env,
        calls,
        form,
        getField() { return field; },
        getInput() { return field && field.children.find(child => child.tagName === 'INPUT'); },
        getListeners() { return listeners; },
        getSubmissions() { return { formSubmitted, nativeSubmit }; }
    };
}

test('mounts a one-line input after editor-info XHR, even when form existed first', async () => {
    const app = harness();
    assert.equal(app.getField(), null, 'form existed at page start but item ID was unknown');
    new app.env.XMLHttpRequest().open('GET', '/Items/' + movieId + '/MetadataEditor');
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(app.getField(), 'the outgoing metadata-info request must rescan existing forms');
    const input = app.getInput();
    assert.ok(input, 'should render an input rather than a textarea');
    assert.equal(input.type, 'url');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(input.value, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(input.disabled, false);
    const get = app.calls.find(x => x.url.includes('/TrailerEditor/Items/'));
    assert.equal(get.opts.headers.Authorization, 'MediaBrowser Token="test-token"');
    assert.equal(get.opts.headers['X-Emby-Token'], undefined);
});

test('changes trailer by sending a single URL before native submit', async () => {
    const app = harness();
    new app.env.XMLHttpRequest().open('GET', '/Items/' + movieId + '/MetadataEditor');
    await new Promise(resolve => setImmediate(resolve));
    const input = app.getInput();
    input.value = 'https://youtu.be/9bZkp7q19f0';
    input.fire('input');
    const listener = app.getListeners().find(x => x.capture).callback;
    const event = {
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; }
    };
    await listener(event);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    const put = app.calls.find(x => x.opts.method === 'PUT');
    assert.ok(put);
    assert.deepEqual(JSON.parse(put.opts.body), {
        urls: ['https://www.youtube.com/watch?v=9bZkp7q19f0']
    });
    assert.equal(app.getSubmissions().formSubmitted, 1, 'native form should be resumed after success');
});

test('hides the field on unsupported content (HTTP 404)', async () => {
    const app = harness(false);
    new app.env.XMLHttpRequest().open('GET', '/Items/' + movieId + '/MetadataEditor');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.getField(), null);
});

test('input stays editable if loading existing trailers fails with HTTP 401', async () => {
    const app = harness(true, { getStatus: 401 });
    const xhr = new app.env.XMLHttpRequest();
    xhr.open('GET', '/Items/' + movieId + '/MetadataEditor');
    await new Promise(resolve => setImmediate(resolve));
    const input = app.getInput();
    assert.ok(input);
    assert.equal(input.disabled, false);
    const errorLabel = app.getField().children.find(child => child.tagName === 'DIV' && child.textContent?.includes('401'));
    assert.ok(errorLabel, 'must show a useful message instead of silently disabling the field');

    // With no user change, never overwrite unknown trailers.
    const listener = app.getListeners().find(x => x.capture).callback;
    await listener({ preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(app.calls.filter(x => x.opts.method === 'PUT').length, 0);
});

test('captures Jellyfin authorization header on XHR before plugin GET and PUT', async () => {
    const app = harness();
    const xhr = new app.env.XMLHttpRequest();
    xhr.open('GET', '/Items/' + movieId + '/MetadataEditor');
    xhr.setRequestHeader('X-Emby-Authorization', 'MediaBrowser Client="Jellyfin Web", Token="secret"');
    await new Promise(resolve => setImmediate(resolve));
    const get = app.calls.find(x => x.opts.method === 'GET');
    assert.equal(get.opts.headers.Authorization, 'MediaBrowser Token="test-token"');
    assert.equal(get.opts.headers['x-emby-authorization'], undefined);
    assert.equal(get.opts.headers['X-Emby-Token'], undefined);

    const input = app.getInput();
    input.value = 'https://youtu.be/9bZkp7q19f0';
    input.fire('input');
    await app.getListeners().find(x => x.capture).callback({
        preventDefault() {}, stopImmediatePropagation() {}
    });
    const put = app.calls.find(x => x.opts.method === 'PUT');
    assert.equal(put.opts.headers.Authorization, 'MediaBrowser Token="test-token"');
    assert.equal(put.opts.headers['x-emby-authorization'], undefined);
});

test('unchanged first of multiple trailers preserves the complete trailer list', async () => {
    const app = harness();
    const xhr = new app.env.XMLHttpRequest();
    xhr.open('GET', '/Items/' + movieId + '/MetadataEditor');
    await new Promise(resolve => setImmediate(resolve));
    const input = app.getInput();
    assert.equal(input.disabled, false);
    const listener = app.getListeners().find(x => x.capture).callback;
    await listener({ preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(app.calls.filter(x => x.opts.method === 'PUT').length, 0);
});

test('Jellyfin 10.11 with disabled legacy auth accepts modern GET and PUT', async () => {
    const app = harness(true, { legacyAuthDisabled: true });
    const xhr = new app.env.XMLHttpRequest();
    xhr.open('GET', '/Items/' + movieId + '/MetadataEditor');
    xhr.setRequestHeader('X-Emby-Token', 'legacy-token');
    await new Promise(resolve => setImmediate(resolve));

    const input = app.getInput();
    assert.equal(input.disabled, false);
    assert.equal(input.value, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    input.value = 'https://youtu.be/9bZkp7q19f0';
    input.fire('input');
    await app.getListeners().find(x => x.capture).callback({
        preventDefault() {}, stopImmediatePropagation() {}
    });

    const editorCalls = app.calls.filter(x => x.url.includes('/TrailerEditor/Items/'));
    assert.equal(editorCalls.length, 2, 'GET and PUT must both succeed');
    for (const call of editorCalls) {
        assert.equal(call.opts.headers.Authorization, 'MediaBrowser Token="test-token"');
        assert.equal(call.opts.headers['X-Emby-Token'], undefined);
        assert.equal(call.opts.headers['x-emby-authorization'], undefined);
    }
    assert.equal(app.getSubmissions().formSubmitted, 1);
});

test('captured old X-Emby-Authorization is converted if global client is unavailable', async () => {
    const app = harness(true, { legacyAuthDisabled: true, noGlobalApiClient: true });
    const xhr = new app.env.XMLHttpRequest();
    xhr.open('GET', '/Items/' + movieId + '/MetadataEditor');
    xhr.setRequestHeader('X-Emby-Authorization', 'MediaBrowser Client="Jellyfin Web", Token="session-token-abc"');
    await new Promise(resolve => setImmediate(resolve));
    const get = app.calls.find(x => x.opts.method === 'GET');
    assert.equal(get.opts.headers.Authorization, 'MediaBrowser Token="session-token-abc"');
    assert.equal(app.getInput().disabled, false);
});

test('modern auth with Client before Token also works without global API client', async () => {
    const app = harness(true, { legacyAuthDisabled: true, noGlobalApiClient: true });
    const xhr = new app.env.XMLHttpRequest();
    xhr.open('GET', '/Items/' + movieId + '/MetadataEditor');
    xhr.setRequestHeader('Authorization', 'MediaBrowser Client="Jellyfin Web", Token="session-token-abc", Device="browser"');
    await new Promise(resolve => setImmediate(resolve));
    const get = app.calls.find(x => x.opts.method === 'GET');
    assert.equal(get.opts.headers.Authorization, 'MediaBrowser Token="session-token-abc"');
    assert.equal(app.getInput().disabled, false);
});

test('missing auth fails locally instead of sending unauthorized GET or PUT', async () => {
    const app = harness(true, { legacyAuthDisabled: true, noGlobalApiClient: true });
    const xhr = new app.env.XMLHttpRequest();
    xhr.open('GET', '/Items/' + movieId + '/MetadataEditor');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.calls.length, 0, 'no anonymous or legacy-header request must be made');
    assert.equal(app.getInput().disabled, false);
    const status = app.getField().children.find(c => String(c.textContent).includes('Anmeldetoken'));
    assert.ok(status, 'show actionable error');
});
