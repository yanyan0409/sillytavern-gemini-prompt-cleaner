# SillyTavern Gemini 提示词清理

一个无需编译、无第三方运行依赖的酒馆扩展。在正常「聊天补全」请求发送前，删除文本中的固定前缀 `This conversation is powered by`。提供中文设置、命中统计、本地预览，以及 403 / 429 错误解读。

**这是针对特定多余提示词的清理工具，不是通用 403 / 429 修复器。** 文章中的个案不能证明所有 429 都是提示词指纹拦截；本项目也没有验证上游是否使用这种机制。403 的具体原因须看错误详情，只有明确的停用信息才能按账号停用处理。

## 用 URL 安装

在 SillyTavern 打开 **扩展 → 安装扩展**，粘贴以下 Git 仓库 URL：

```text
https://github.com/yanyan0409/sillytavern-gemini-prompt-cleaner
```

安装后刷新页面，在扩展设置中找到 **Gemini 提示词清理**。默认已启用，仅处理 Gemini 的系统 / 开发者消息。无需填写新的 API Key，无需安装 Extras 或服务端插件。更新时可在酒馆「管理扩展」中手动检查更新。

最低声明版本为 SillyTavern 1.13.0；开发验证使用当前官方 release。扩展会检查实际事件接口是否可用。

## 如何使用

1. 沿用你在酒馆中的 Gemini / OpenAI 兼容反代连接配置。
2. 打开扩展设置，使用「本地规则预览」确认清理行为。
3. 正常发送一次聊天，查看「最近一次」是否显示已删除前缀。
4. 如果提示模型不匹配，且你确认当前反代模型是 Gemini 的别名，取消「仅对 Gemini 生效」。
5. 默认只处理 `system` / `developer`。如果你的预设把自述放进用户或助手消息，可手动扩大消息范围；这也会改变相同的引用文本。

示例：

```text
清理前：This conversation is powered by gemini-example. 请继续扮演角色。
清理后：gemini-example. 请继续扮演角色。
```

规则忽略英文字母大小写，支持单词之间的多个空白或换行；只删除固定前缀及紧接的横向空白，不删除整行、模型名或后续角色设定。没有命中时原样发送。

## 功能边界

- 仅改本次请求中的消息副本；不改聊天记录、角色卡、世界书、预设或已有历史消息。
- 支持标准字符串消息及多模态消息中的 `text` / `input_text` 内容块。图片、音频、工具定义、工具调用参数、工具返回消息、签名思考块均不处理。
- 支持标准聊天补全的流式与非流式请求；不读取或替换响应流。
- 覆盖酒馆调用 `CHAT_COMPLETION_SETTINGS_READY` 的生成路径。文字补全 API，以及第三方扩展绕过此事件直接发出的请求，不在覆盖范围内。
- 如果反代在酒馆请求发出之后添加这个前缀，本扩展无法移除后加内容。须在你管理的反代服务端检查提示词注入配置。
- 其他扩展若在本扩展之后修改请求，或自定义请求体覆盖 `messages`，也可能重新添加内容。以实际反代收到的请求为准。
- 不清理 `custom_include_body` 等任意配置字符串，不改变 API 地址、密钥、模型名或系统网络配置。
- 没有自动重试、并发请求、账号轮换、额度探测或账号解封功能。

## 403 / 429 应怎样处理

| 情况 | 下一步 |
| --- | --- |
| 403，只有 `PERMISSION_DENIED` | 核查凭证、项目权限、服务可用性及完整错误详情；不能直接断言封号。 |
| 明确出现 `TOS_VIOLATION` / 账号因条款停用 | 停止使用受影响凭证，通过服务商官方渠道核实或申诉。扩展不能恢复权限。 |
| 429 / `RESOURCE_EXHAUSTED` | 先查请求/Token 速率、配额、并发及 `Retry-After` / `RetryInfo`。遵循等待建议，避免连续重试。 |
| 怀疑存在本文所述自述前缀 | 检查扩展是否命中；仅在正常配额内做清理前后对比。一次成功不能证明上游拦截机制。 |
| 扩展命中为 0 | 酒馆发送的受检消息中没有该前缀，或范围 / 模型过滤不匹配；也可能是反代服务端后加。 |

## 隐私

扩展不发起推理请求，不读取 API 密钥，不收集遥测。仅借用酒馆的模板加载和设置保存接口。设置保存三个选项；统计仅保存在本页内存，不含提示词。预览和错误输入仅留在当前页面，可一键清空，刷新后消失。

## 开发与检查

```sh
npm test
npm run check
```

测试使用 Node.js 内置测试运行器，不需要 `npm install`。安装到酒馆也不需要 Node.js 构建步骤。

- `core.js`：固定前缀清理、消息副本变换、错误解释。
- `integration.js`：酒馆发送前事件订阅。
- `index.js` / `settings.html` / `style.css`：设置、预览与命中统计。

## 参考

- [SillyTavern 扩展安装](https://docs.sillytavern.app/extensions/)
- [SillyTavern 扩展开发接口](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [官方聊天补全请求实现](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/openai.js)
- [Google Gemini API 排错指南](https://ai.google.dev/gemini-api/docs/troubleshooting)

License: MIT.
