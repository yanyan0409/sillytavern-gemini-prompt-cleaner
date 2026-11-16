import { cleanText, diagnoseError, normalizeSettings } from './core.js';
import { attachRequestCleaner } from './integration.js';

const SETTINGS_KEY = 'gemini_prompt_cleaner';
const PANEL_ID = 'gemini_prompt_cleaner_settings';
let panel;
let detach;
let latestReport;
let requestCount = 0;
let totalReplacements = 0;

function context() {
    return globalThis.SillyTavern.getContext();
}

function getSettings() {
    return normalizeSettings(context().extensionSettings[SETTINGS_KEY]);
}

function updateStatus() {
    if (!panel) return;
    const output = panel.querySelector('[data-gpc="status"]');
    if (!getSettings().enabled) {
        output.textContent = '已关闭：请求将保持原样。';
        return;
    }
    if (!latestReport) {
        output.textContent = '已启用，等待下一次聊天补全请求。';
        return;
    }
    const labels = {
        cleaned: `最近一次：已删除 ${latestReport.replacements} 处前缀，涉及 ${latestReport.messages} 条消息。`,
        'no-match': `最近一次：已检查 ${latestReport.scanned} 条消息，未发现该前缀。`,
        'other-model': '最近一次：模型名称未包含 Gemini，且不是 Google AI Studio / Vertex AI 来源，已跳过。若使用模型别名，可取消“仅对 Gemini 生效”。',
        unsupported: '最近一次：请求格式不受支持。此扩展处理酒馆标准聊天补全请求。',
        disabled: '最近一次请求时扩展未启用。',
    };
    output.textContent = `${labels[latestReport.status] ?? '等待请求。'} 本页已观察 ${requestCount} 次请求，累计清理 ${totalReplacements} 处。`;
}

function receiveReport(report) {
    latestReport = report;
    requestCount++;
    totalReplacements += report.replacements;
    updateStatus();
}

function saveOption(key, value) {
    context().extensionSettings[SETTINGS_KEY] = normalizeSettings({ ...getSettings(), [key]: value });
    context().saveSettingsDebounced();
    latestReport = undefined;
    updateStatus();
}

async function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const folder = new URL('.', import.meta.url).pathname.split('/').filter(Boolean).slice(-2).join('/');
    const html = await context().renderExtensionTemplateAsync(decodeURIComponent(folder), 'settings');
    const target = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!target) throw new Error('找不到酒馆扩展设置面板。');
    target.insertAdjacentHTML('beforeend', html);
    panel = document.getElementById(PANEL_ID);
    if (!panel) throw new Error('扩展设置模板加载失败。');

    const settings = getSettings();
    for (const key of ['enabled', 'geminiOnly']) {
        const control = panel.querySelector(`[data-gpc="${key}"]`);
        control.checked = settings[key];
        control.addEventListener('change', () => saveOption(key, control.checked));
    }
    const scope = panel.querySelector('[data-gpc="scope"]');
    scope.value = settings.scope;
    scope.addEventListener('change', () => saveOption('scope', scope.value));

    panel.querySelector('[data-gpc="previewButton"]').addEventListener('click', () => {
        const input = panel.querySelector('[data-gpc="previewInput"]').value;
        const result = cleanText(input);
        panel.querySelector('[data-gpc="previewOutput"]').value = result.text;
        panel.querySelector('[data-gpc="previewStatus"]').textContent = `规则预览：删除 ${result.replacements} 处前缀。预览不受总开关、模型或消息范围限制，不会发送请求。`;
    });
    panel.querySelector('[data-gpc="diagnoseButton"]').addEventListener('click', () => {
        const input = panel.querySelector('[data-gpc="errorInput"]').value;
        panel.querySelector('[data-gpc="diagnosis"]').textContent = diagnoseError(input);
    });
    panel.querySelector('[data-gpc="clearButton"]').addEventListener('click', () => {
        for (const name of ['previewInput', 'previewOutput', 'errorInput']) {
            panel.querySelector(`[data-gpc="${name}"]`).value = '';
        }
        panel.querySelector('[data-gpc="previewStatus"]').textContent = '';
        panel.querySelector('[data-gpc="diagnosis"]').textContent = '';
    });
    updateStatus();
}

function showError(error) {
    console.error('[Gemini Prompt Cleaner] 初始化失败：', error instanceof Error ? error.message : 'unknown error');
    globalThis.toastr?.error('Gemini 提示词清理加载失败，请刷新或检查酒馆版本。', 'Gemini 提示词清理');
}

try {
    const ctx = context();
    ctx.extensionSettings[SETTINGS_KEY] = getSettings();
    // Register synchronously so the first generation is covered even while UI loads.
    detach = attachRequestCleaner(ctx, getSettings, receiveReport);
    const ready = () => mountPanel().catch(showError);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
    else void ready();
    globalThis.addEventListener('pagehide', event => {
        if (!event.persisted) detach?.();
    });
} catch (error) {
    showError(error);
}
