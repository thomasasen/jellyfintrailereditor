const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'web', 'trailer-editor.js'), 'utf8');
const movieId = 'ee5f250e-ae5e-4bca-903e-8c22cf9c8aa8';

function harness(movieOnly = true) {
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
        if (itemEndpoint && !movieOnly) return { ok: false, status: 404, json: async () => ({}) };
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
        ApiClient: { accessToken() { return 'test-token'; } },
        addEventListener() {},
        requestAnimationFrame(callback) { callback(); },
        setTimeout(callback) { callback(); },
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
    assert.ok(app.getField(), 'the outgoing metadata-info request must rescan existing forms');
    const input = app.getInput();
    assert.ok(input, 'should render an input rather than a textarea');
    assert.equal(input.type, 'url');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(input.value, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(input.disabled, false);
    const get = app.calls.find(x => x.url.includes('/TrailerEditor/Items/'));
    assert.equal(get.opts.headers['X-Emby-Token'], 'test-token');
});

test('changes trailer by sending a single URL before native submit', async () => {
    const app = harness();
    new app.env.XMLHttpRequest().open('GET', '/Items/' + movieId + '/MetadataEditor');
    await new Promise(resolve => setImmediate(resolve));
    const input = app.getInput();
    input.value = 'https://youtu.be/9bZkp7q19f0';
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
