/** Pure request transforms. No networking, storage, or access to chat history. */
export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    geminiOnly: true,
    scope: 'system',
});

export function normalizeSettings(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    return {
        enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
        geminiOnly: typeof value.geminiOnly === 'boolean' ? value.geminiOnly : DEFAULT_SETTINGS.geminiOnly,
        scope: value.scope === 'all' ? 'all' : 'system',
    };
}

/** Remove only the fixed prefix, leaving the model name and all later instructions. */
export function cleanText(value) {
    if (typeof value !== 'string') return { text: value, replacements: 0 };
    let replacements = 0;
    const text = value.replace(/\bThis\s+conversation\s+is\s+powered\s+by\b[^\S\r\n]*/gi, () => {
        replacements++;
        return '';
    });
    return { text, replacements };
}

export function isGeminiRequest(payload) {
    const source = String(payload?.chat_completion_source ?? '').toLowerCase();
    return source === 'makersuite' || source === 'vertexai'
        || /gemini/i.test(String(payload?.model ?? ''));
}

function cleanContent(content) {
    if (typeof content === 'string') {
        const result = cleanText(content);
        return { content: result.text, replacements: result.replacements, fields: result.replacements ? 1 : 0 };
    }
    if (!Array.isArray(content)) return { content, replacements: 0, fields: 0 };

    let replacements = 0;
    let fields = 0;
    const parts = content.map(part => {
        // Never traverse image URLs, audio, files, tool JSON, or signed thinking blocks.
        if (!part || !['text', 'input_text'].includes(part.type) || typeof part.text !== 'string') return part;
        const result = cleanText(part.text);
        if (!result.replacements) return part;
        replacements += result.replacements;
        fields++;
        return { ...part, text: result.text };
    });
    return { content: replacements ? parts : content, replacements, fields };
}

/**
 * Copy only changed messages/parts. The original request and shared history stay intact.
 * report deliberately contains no prompt text, endpoint, headers, or credentials.
 */
export function cleanRequest(payload, value = DEFAULT_SETTINGS) {
    const settings = normalizeSettings(value);
    const report = { status: 'no-match', replacements: 0, fields: 0, messages: 0, scanned: 0 };
    const unchanged = status => ({ messages: payload?.messages, report: { ...report, status } });
    if (!settings.enabled) return unchanged('disabled');
    if (!payload || !Array.isArray(payload.messages)) return unchanged('unsupported');
    if (settings.geminiOnly && !isGeminiRequest(payload)) return unchanged('other-model');

    const allowedRoles = settings.scope === 'all'
        ? ['system', 'developer', 'user', 'assistant']
        : ['system', 'developer'];
    const messages = payload.messages.map(message => {
        if (!message || !allowedRoles.includes(message.role)) return message;
        report.scanned++;
        const result = cleanContent(message.content);
        if (!result.replacements) return message;
        report.replacements += result.replacements;
        report.fields += result.fields;
        report.messages++;
        return { ...message, content: result.content };
    });
    if (report.replacements) report.status = 'cleaned';
    return { messages: report.replacements ? messages : payload.messages, report };
}

/** Local interpretation of pasted errors; status codes alone cannot prove a ban/fingerprint. */
export function diagnoseError(value) {
    const text = String(value ?? '');
    if (!text.trim()) return '请粘贴 HTTP 状态或错误正文。内容仅在当前页面分析，不会保存或发送。';
    if (/TOS_VIOLATION|disabled[^\n]{0,200}violation of Terms of Service/i.test(text)) {
        return '错误正文明确提到服务条款停用。提示词清理不能解除停用；请停止使用受影响凭证，并通过服务商官方渠道核实、申诉。';
    }
    if (/\b403\b|PERMISSION_DENIED|permission_denied/i.test(text)) {
        return '检测到权限错误。403 本身不等于封号：请核查 API Key、项目权限、服务启用状态和错误详情。若详情明确写出 TOS_VIOLATION，按停用处理；不要依靠重复请求解决。';
    }
    if (/\b429\b|RESOURCE_EXHAUSTED|rate_limit_exceeded|quota_exceeded|too_many_requests/i.test(text)) {
        return '检测到 429 / 资源耗尽。先核查配额、请求速率、并发和 Retry-After / RetryInfo；遵循服务端等待建议。缺少这些字段也不能证明是提示词指纹。若怀疑冗余自述，查看本扩展是否命中，再在正常配额内比较清理前后的结果。';
    }
    if (/\b401\b|UNAUTHENTICATED/i.test(text)) {
        return '检测到认证错误。请在酒馆连接配置或服务商后台核查凭证，不要把 API Key 粘贴到聊天或公开日志中。';
    }
    return '无法仅凭这段内容确定原因。请检查酒馆后端和反代返回的完整错误状态及详情；本扩展只清理固定自述前缀，不修改权限、配额或网络设置。';
}
