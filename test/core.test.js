import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, cleanRequest, diagnoseError, normalizeSettings, isGeminiRequest } from '../core.js';

const prefix = 'This conversation is powered by';
const payload = messages => ({ model: 'gemini-example', chat_completion_source: 'custom', messages });

function freezeDeep(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(freezeDeep);
    }
    return value;
}

test('removes only the prefix and keeps model, newlines, and roleplay instructions', () => {
    assert.deepEqual(cleanText(`${prefix} gemini-example. 请扮演角色。\n不要改变设定。`), {
        text: 'gemini-example. 请扮演角色。\n不要改变设定。', replacements: 1,
    });
});

test('handles capitalization, multiline whitespace, and every occurrence', () => {
    assert.deepEqual(cleanText('THIS  conversation\nis\tpowered by\tgemini-a\nThis conversation is powered by gemini-b'), {
        text: 'gemini-a\ngemini-b', replacements: 2,
    });
});

test('does not remove partial words or unrelated powered-by statements', () => {
    const text = 'WithThis conversation is powered bystander. This application is powered by Gemini.';
    assert.deepEqual(cleanText(text), { text, replacements: 0 });
});

test('keeps a following newline when the prefix is alone on a line', () => {
    assert.equal(cleanText(`${prefix}\nKeep this`).text, '\nKeep this');
});

test('null, missing, and non-string text remain unchanged', () => {
    for (const text of [null, undefined, 42, {}, []]) assert.deepEqual(cleanText(text), { text, replacements: 0 });
});

test('repeated cleaning is idempotent', () => {
    const once = cleanText(`${prefix} gemini-a. ${prefix} gemini-b`);
    assert.deepEqual(cleanText(once.text), { text: once.text, replacements: 0 });
});

test('normalizes corrupted settings and defaults to system scope', () => {
    assert.deepEqual(normalizeSettings({ enabled: 'false', geminiOnly: null, scope: 'surprise' }), {
        enabled: true, geminiOnly: true, scope: 'system',
    });
    assert.deepEqual(normalizeSettings(null), normalizeSettings());
});

test('detects native Gemini sources and prefixed model names', () => {
    for (const request of [
        { chat_completion_source: 'makersuite' },
        { chat_completion_source: 'vertexai', model: 'custom-alias' },
        { chat_completion_source: 'custom', model: 'google/GEMINI-example' },
    ]) assert.equal(isGeminiRequest(request), true);
    assert.equal(isGeminiRequest({ chat_completion_source: 'custom', model: 'my-model' }), false);
});

test('default scope changes system and developer messages only without mutating history', () => {
    const messages = ['system', 'developer', 'user', 'assistant', 'tool'].map(role => ({ role, content: `${prefix} gemini-example` }));
    const request = freezeDeep(payload(messages));
    const result = cleanRequest(request);
    assert.equal(result.report.replacements, 2);
    assert.equal(result.report.scanned, 2);
    assert.equal(result.messages[0].content, 'gemini-example');
    assert.equal(result.messages[1].content, 'gemini-example');
    assert.notStrictEqual(result.messages[0], messages[0]);
    for (let i = 2; i < messages.length; i++) assert.strictEqual(result.messages[i], messages[i]);
    for (const original of messages) assert.equal(original.content, `${prefix} gemini-example`);
});

test('expanded scope still preserves tool results, function messages, and tool arguments', () => {
    const messages = [
        { role: 'user', content: `${prefix} gemini-example` },
        { role: 'assistant', content: `${prefix} gemini-example`, tool_calls: [{ function: { name: 'inspect', arguments: JSON.stringify({ query: prefix }) } }] },
        { role: 'tool', content: prefix, tool_call_id: 'call1' },
        { role: 'function', content: prefix, name: 'inspect' },
    ];
    const request = freezeDeep(payload(messages));
    const result = cleanRequest(request, { scope: 'all' });
    assert.equal(result.report.replacements, 2);
    assert.strictEqual(result.messages[1].tool_calls, messages[1].tool_calls);
    assert.strictEqual(result.messages[2], messages[2]);
    assert.strictEqual(result.messages[3], messages[3]);
});

test('multimodal text is copied; media, thinking signatures, and unknown blocks are untouched', () => {
    const content = [
        { type: 'text', text: `${prefix} gemini-example`, cache_control: { type: 'ephemeral' } },
        { type: 'input_text', text: `${prefix} gemini-next` },
        { type: 'image_url', image_url: { url: `https://example.invalid/${prefix}` } },
        { type: 'input_audio', input_audio: { data: prefix, format: 'wav' } },
        { type: 'thinking', text: prefix, signature: prefix },
        { text: prefix },
        null,
    ];
    const request = freezeDeep(payload([{ role: 'system', content }]));
    const result = cleanRequest(request);
    assert.equal(result.report.replacements, 2);
    assert.equal(result.report.fields, 2);
    assert.equal(result.report.messages, 1);
    assert.equal(result.messages[0].content[0].text, 'gemini-example');
    assert.strictEqual(result.messages[0].content[0].cache_control, content[0].cache_control);
    for (let i = 2; i < content.length; i++) assert.strictEqual(result.messages[0].content[i], content[i]);
});

test('missing, null and malformed messages are ignored without errors', () => {
    const messages = [null, {}, { role: 'system', content: null }, { role: 'system', content: 123 }, { role: 'assistant', content: null, tool_calls: [] }];
    assert.strictEqual(cleanRequest(payload(messages)).messages, messages);
    for (const request of [undefined, null, {}, { messages: 'bad' }]) {
        assert.equal(cleanRequest(request).report.status, 'unsupported');
    }
});

test('disabled and non-Gemini requests preserve message array identity', () => {
    const request = payload([{ role: 'system', content: prefix }]);
    assert.strictEqual(cleanRequest(request, { enabled: false }).messages, request.messages);
    assert.equal(cleanRequest(request, { enabled: false }).report.status, 'disabled');
    request.model = 'claude-example';
    assert.strictEqual(cleanRequest(request).messages, request.messages);
    assert.equal(cleanRequest(request).report.status, 'other-model');
    assert.equal(cleanRequest(request, { geminiOnly: false }).report.status, 'cleaned');
});

test('500-message long conversation preserves ordering, parameters, and non-target data', () => {
    const request = payload(Array.from({ length: 500 }, (_, i) => ({
        role: i === 0 ? 'system' : i % 2 ? 'user' : 'assistant',
        content: i === 0 ? `${prefix} gemini-example. ${'上下文'.repeat(2000)}` : '历史文本'.repeat(1500),
    })));
    request.stream = true;
    request.temperature = 0.8;
    request.tools = [{ type: 'function', function: { name: 'test', description: prefix } }];
    const original = JSON.stringify(request);
    const result = cleanRequest(freezeDeep(request));
    assert.equal(result.messages.length, 500);
    assert.equal(result.report.replacements, 1);
    assert.equal(result.messages[0].content, `gemini-example. ${'上下文'.repeat(2000)}`);
    for (let i = 1; i < 500; i++) assert.strictEqual(result.messages[i], request.messages[i]);
    assert.equal(JSON.stringify(request), original);
});

test('no-match requests are unchanged and reports contain no request contents', () => {
    const request = payload([{ role: 'system', content: 'private-prompt-12345' }]);
    request.proxy_password = 'private-key-12345';
    request.custom_url = 'https://private.example.invalid';
    const result = cleanRequest(request);
    assert.strictEqual(result.messages, request.messages);
    assert.equal(result.report.status, 'no-match');
    assert.doesNotMatch(JSON.stringify(result.report), /private/);
    assert.deepEqual(Object.keys(result.report).sort(), ['fields', 'messages', 'replacements', 'scanned', 'status']);
});

test('error diagnosis distinguishes explicit suspension from generic permission failure', () => {
    assert.match(diagnoseError('{"code":403,"details":[{"reason":"TOS_VIOLATION"}]}'), /明确提到服务条款停用/);
    assert.match(diagnoseError('403 PERMISSION_DENIED'), /403 本身不等于封号/);
    assert.match(diagnoseError('This service has been disabled in this account for violation of Terms of Service.'), /不能解除停用/);
});

test('429 diagnosis never asserts fingerprint blocking from absent retry information', () => {
    for (const text of ['429', 'RESOURCE_EXHAUSTED', 'rate_limit_exceeded', 'quota_exceeded']) {
        assert.match(diagnoseError(text), /不能证明是提示词指纹/);
        assert.match(diagnoseError(text), /Retry-After/);
    }
});

test('diagnosis does not echo pasted secrets', () => {
    const result = diagnoseError('401 UNAUTHENTICATED Bearer private-secret-12345');
    assert.match(result, /认证错误/);
    assert.doesNotMatch(result, /private-secret/);
    assert.match(diagnoseError(''), /请粘贴/);
    assert.match(diagnoseError('mystery'), /无法仅凭/);
});
