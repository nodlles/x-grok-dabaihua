# 隐私政策 · Privacy Policy

最后更新 / Last updated: 2026-09-19

## 简体中文

「X 大白话 · Grok 解读增强」在 X 页面提供中文解读和追问。它是非官方第三方扩展，与 X / xAI 无隶属关系。

### 处理的数据与用途

- 解读时，扩展读取当前帖子或文章的文本与链接，构建中文解读指令，并通过页面原有的 X/Grok 请求发送给 X/Grok。悬停达到设定时长或点击触发按钮会发起解读；这会使用你的 Grok 额度。
- 追问时，原文、链接、初次解读、引用来源、已完成问答和新问题会作为背景发送给 X/Grok。回答用于在卡片中显示。「在 Grok 中继续」将背景填入 X 的原生输入框，由你编辑并发送。
- 扩展复用 X 页面已有的登录请求，不要求你向开发者提供密码或 API 密钥，不建立独立的登录系统。页面请求可能携带 X 的认证信息；扩展不会把这些信息发送给开发者。
- 扩展根据悬停、点击和输入来提供功能，不记录跨网站浏览历史，没有分析或广告 SDK，没有开发者的数据接收服务器。帖子和问答本身可能含有姓名、账号或其他个人信息，请按你愿意提供给 X/Grok 的范围使用。

### 本地保存与删除

设置、自定义指令以及以帖子链接为索引的初次解读缓存保存在浏览器的 `chrome.storage.local`。缓存最多保留 80 条，超过 24 小时不再作为有效解读使用；这不是定时从磁盘删除的承诺。卸载扩展可清除缓存及其他扩展本地数据。追问对话保存在当前页面内存中，关闭卡片时清除，不写入解读缓存。

请求捕获默认关闭，只有扩展启用、选择学习模式并手动开启捕获时才运行。它最多在本机保存 30 条 Grok 请求/响应调试记录，可包含请求地址、请求正文、响应样本、时间及请求头。已知敏感请求头（如 Authorization、Cookie、CSRF）会打码，但正文、响应及其他字段不会自动脱敏，可能包含个人聊天内容。可在设置页清空捕获记录。记录不会自动发给开发者；复制或主动分享前请检查并删除敏感内容。

本地存储不是扩展额外加密的保险箱。同一浏览器配置文件的使用者可能访问这些数据。卸载扩展会移除其本地存储；X/Grok 已收到的数据不会因此被删除，应通过 X/Grok 的设置和相关政策管理。

### 数据接收方与有限使用

功能所需的内容通过 X 页面原有的 HTTPS 请求发送给 X/Grok，其后续处理受 X/xAI 的政策约束。扩展不向开发者服务器传输帖子、聊天或凭证，不出售数据，不用于广告、信用评估或与解读及追问无关的用途。开发者不会通过扩展自动获取或人工查看你的内容。你主动在支持渠道提交的信息仅用于处理该支持请求，请勿提交密码或未脱敏日志。

本扩展对用户数据的使用遵守 Chrome Web Store 用户数据政策，包括 Limited Use（有限使用）要求。

## English

X Dabaihua · Grok Explainer Enhancer provides Chinese explanations and follow-up questions on X. It is an unofficial third-party extension, not affiliated with X or xAI.

### Data and purpose

The extension reads the current post/article text and URL and sends an explanation instruction to X/Grok through the page's existing requests. Hovering for the configured duration or clicking the trigger starts this request and uses your Grok allowance. Follow-ups send the original content, URL, explanation, citations, completed turns and new question as context. Responses are displayed in the card. “Continue in Grok” fills the native input for you to edit and send.

The extension reuses X's existing authenticated requests, which may carry X authentication information. It does not ask you to give the developer a password or API key or send credentials to the developer. Hover, click and input interactions enable the visible features; there is no cross-site browsing-history log, analytics/advertising SDK or developer-operated data collection server. Posts and conversations may themselves contain names, usernames or other personal information.

### Local storage and deletion

Settings, custom instructions and initial explanations indexed by post URL are saved in `chrome.storage.local`. The cache holds up to 80 entries; entries older than 24 hours are not reused, but are not necessarily deleted from disk at that moment. Uninstall the extension to remove the cache and other extension storage. Follow-up conversations stay in page memory, are cleared when the card closes and are not written to the explanation cache.

Request capture is off by default. It runs only when the extension is enabled, learning mode is selected and capture is explicitly enabled. Up to 30 local Grok debugging records may contain request URLs, bodies, response samples, timestamps and headers. Known sensitive headers such as Authorization, Cookie and CSRF are redacted, but bodies, responses and other fields are not automatically sanitized and may contain personal conversations. Clear these records in Settings. They are not automatically sent to the developer; review and redact them before copying or voluntarily sharing them.

Local storage is not additionally encrypted by this extension and may be accessible to users of the same browser profile. Uninstalling removes extension storage, but does not delete data already received by X/Grok. Manage that data through X/Grok and their policies.

### Recipients and limited use

Data necessary for the features is sent to X/Grok through the X page's existing HTTPS requests. X/xAI policies govern their subsequent processing. The extension does not transmit posts, chats or credentials to developer servers, sell data, or use it for advertising, credit assessments or unrelated purposes. The developer does not automatically receive or manually inspect your content through the extension. Information you voluntarily submit for support is used to handle that request; do not submit passwords or unredacted logs.

The extension's use of user data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## 联系 / Contact

[GitHub Issues](https://github.com/nodlles/x-grok-dabaihua/issues)
