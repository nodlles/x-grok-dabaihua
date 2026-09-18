# 隐私政策 · Privacy Policy

_最后更新 / Last updated: 2026-09-18_

## 简体中文

「X 大白话 · Grok 解读增强」是一个纯本地运行的浏览器扩展。

- **不收集、不上传任何个人数据。** 没有任何开发者服务器、第三方服务或统计/分析。
- **数据去向：** 扩展读取你当前浏览的 X 页面上的推文/文章文本，仅用于构建「说大白话」的解读指令，并复用 X 自己已签名的 Grok 请求发送给 **X（grok.x.com）**。除此之外不向任何方发送数据。
- **本地存储：** 用户设置与解读结果缓存仅保存在你浏览器的 `chrome.storage.local` 中；请求捕获默认关闭，仅在插件启用、选择「学习模式」且手动开启捕获开关时生效（已有开关设置会保留）。最多保存 30 条请求正文、响应样本及相关调试信息，仅存于本机；敏感请求头（授权、Cookie、CSRF 等）会自动打码，正文和响应样本不会自动脱敏，可能包含聊天内容。可在设置页清空，复制分享前请检查。
- **追问：** 卡片中的问题及已完成问答仅保存在当前页面内存中，关闭卡片后清除，不写入解读缓存。发送追问时，原文、解读、引用来源及已完成问答会作为背景发送给 X/Grok。「在 Grok 中继续」将相同背景填入原生输入框，由你编辑并发送。
- **不出售数据，不用于广告或与扩展核心功能无关的用途。**
- 卸载扩展即清除其全部本地数据。

本扩展为非官方第三方工具，与 X / xAI 无关。

## English

"X Dabaihua · Grok Explainer Enhancer" is a fully local browser extension.

- **Collects and transmits NO personal data.** No developer servers, no third parties, no analytics.
- **Where data goes:** the extension reads tweet/article text on the X page you are viewing, solely to build the plain-language instruction, and reuses X's own already-signed Grok request to send it to **X (grok.x.com)**. No data is sent anywhere else.
- **Local storage:** settings and result cache live only in your browser's `chrome.storage.local`; request capture is off by default and only active when the extension is enabled, learning mode is selected, and the capture switch is enabled (existing switch preferences are preserved). Up to 30 records containing request bodies, response samples, and debugging metadata are stored locally. Sensitive headers (authorization, cookie, CSRF, etc.) are redacted; bodies and response samples are not automatically sanitized and may contain chat content. Records can be cleared in Settings; check them before copying or sharing.
- **Follow-ups:** Questions and completed turns are kept in the current page’s memory, cleared when the card closes, and not written to the explanation cache. Sending a follow-up includes the original post, explanation, citation sources, and completed turns as context sent to X/Grok. Continue in Grok places the same context into the native input for you to edit and send.
- **No selling of data, no advertising, no unrelated use.**
- Uninstalling the extension removes all of its local data.

Unofficial third-party tool, not affiliated with X / xAI.

## 联系 / Contact

Issues: https://github.com/nodlles/x-grok-dabaihua/issues
