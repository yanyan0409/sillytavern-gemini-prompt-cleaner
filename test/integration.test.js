import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { attachRequestCleaner } from '../integration.js';

// The production emitter awaits listeners in registration order.
class TestEvents {
    listeners = new Map();
    on(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
    makeLast(name, fn) { this.removeListener(name, fn); this.on(name, fn); }
    removeListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(value => value !== fn)); }
    async emit(name, payload) { for (const fn of [...(this.listeners.get(name) ?? [])]) await fn(payload); }
}

function setup() {
    return { eventSource: new TestEvents(), eventTypes: { CHAT_COMPLETION_SETTINGS_READY: 'ready' } };
}

const prefix = 'This conversation is powered by';
const makePayload = stream => ({
    model: 'gemini-example',
    chat_completion_source: 'custom',
    messages: [{ role: 'system', content: `${prefix} gemini-example` }, { role: 'user', content: '你好' }],
    stream,
    temperature: 0.8,
    max_tokens: 100,
    tools: [{ type: 'function', function: { name: 'inspect', description: prefix, parameters: { type: 'object' } } }],
    proxy_password: 'do-not-log-this',
});

for (const stream of [true, false]) {
    test(`changes the serialized request, preserves original messages and parameters (stream=${stream})`, async () => {
        const ctx = setup();
        const reports = [];
        attachRequestCleaner(ctx, () => ({}), report => reports.push(report));
        const request = makePayload(stream);
        const history = request.messages;
        const before = structuredClone(request);
        await ctx.eventSource.emit('ready', request);
        const serialized = JSON.parse(JSON.stringify(request));
        assert.equal(serialized.messages[0].content, 'gemini-example');
        assert.equal(history[0].content, `${prefix} gemini-example`);
        assert.deepEqual({ ...serialized, messages: before.messages }, before);
        assert.equal(reports.length, 1);
        assert.equal(reports[0].replacements, 1);
        assert.doesNotMatch(JSON.stringify(reports), /do-not-log-this|powered by|gemini-example/);
    });
}

test('cleans content inserted by an earlier extension listener', async () => {
    const ctx = setup();
    ctx.eventSource.on('ready', request => { request.messages[0].content = `${prefix} gemini-late`; });
    attachRequestCleaner(ctx, () => ({}));
    const request = makePayload(false);
    await ctx.eventSource.emit('ready', request);
    assert.equal(request.messages[0].content, 'gemini-late');
});

test('reads changed settings on every request and unsubscribe removes the listener', async () => {
    const ctx = setup();
    let enabled = true;
    const detach = attachRequestCleaner(ctx, () => ({ enabled }));
    enabled = false;
    const first = makePayload(false);
    await ctx.eventSource.emit('ready', first);
    assert.match(first.messages[0].content, /powered by/);
    enabled = true;
    const second = makePayload(false);
    await ctx.eventSource.emit('ready', second);
    assert.equal(second.messages[0].content, 'gemini-example');
    detach();
    const third = makePayload(false);
    await ctx.eventSource.emit('ready', third);
    assert.match(third.messages[0].content, /powered by/);
});

test('falls back to ordinary event registration on older clients', async () => {
    const ctx = setup();
    ctx.eventSource.makeLast = undefined;
    attachRequestCleaner(ctx, () => ({}));
    const request = makePayload(false);
    await ctx.eventSource.emit('ready', request);
    assert.equal(request.messages[0].content, 'gemini-example');
});

test('fails clearly if the required ST event is unavailable', () => {
    assert.throws(() => attachRequestCleaner({}, () => ({})), /缺少发送前事件/);
});

test('manifest entry points exist and package version matches', async () => {
    const root = new URL('../', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
    assert.equal(manifest.version, pkg.version);
    for (const file of [manifest.js, manifest.css, 'settings.html', 'core.js', 'integration.js', 'LICENSE']) {
        assert.ok((await readFile(new URL(file, root), 'utf8')).length > 0);
    }
});
