import { cleanRequest } from './core.js';

/** Attach to the normal ST Chat Completion path, immediately before serialization. */
export function attachRequestCleaner(context, getSettings, onReport = () => {}) {
    const source = context?.eventSource;
    const event = context?.eventTypes?.CHAT_COMPLETION_SETTINGS_READY;
    if (!source?.on || !event) {
        throw new Error('当前酒馆缺少发送前事件接口，请升级 SillyTavern。');
    }

    const handler = payload => {
        const result = cleanRequest(payload, getSettings());
        if (result.report.replacements) payload.messages = result.messages;
        onReport(result.report);
    };
    if (typeof source.makeLast === 'function') source.makeLast(event, handler);
    else source.on(event, handler);

    return () => {
        if (typeof source.removeListener === 'function') source.removeListener(event, handler);
        else source.off?.(event, handler);
    };
}
