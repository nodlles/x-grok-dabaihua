# Chrome Web Store 上架资料（复制到开发者后台）

> 打包文件：仓库根目录 `x-grok-dabaihua-v0.2.0.zip`（仅含运行时文件 + 图标）。
> 商店图标：`docs/store/store-icon-128.png`（128×128）。
> 截图：`docs/store/screenshot-1280x800.png`（1280×800，至少需要 1 张）。

---

## 基本信息

- **名称 (Name)**：X 大白话 · Grok 解读增强
- **简介 (Summary, ≤132 字符)**：悬停 X 推文/长文「文章」，用大白话口语化中文解释。复用 X 自己的 Grok，不碰签名、不存凭证。
- **类别 (Category)**：生产力工具 (Productivity)
- **语言 (Language)**：中文（简体）
- **官网/支持页**：https://github.com/nodlles/x-grok-dabaihua

## 详细描述（中文，粘贴到 Description）

```
悬停 X（Twitter）上的任意推文或长文「文章」，自动用大白话、口语化的中文解释它在讲什么——结果以一张炫酷卡片就地展示。

【特点】
• 悬停即解读：鼠标停在推文上，进度环转完自动触发，也可点环立即触发。
• 真·大白话：接管 X 内置的 Grok「解读」，把官方分析改写成口语化中文，流式输出，带来源引用。
• 支持 X 长文「文章」：时间线卡片与文章详情页都能总结。
• 三种模式：大白话 / UI 演示 / 学习模式。
• 结果缓存、多主题（石墨/浅色/海洋/霓虹/跟随系统）。

【隐私】
本扩展不收集、不上传任何个人数据，没有任何外部服务器或统计。它复用 X 自己已签名的 Grok 请求，只在本地把内容改写成「说人话」的指令；所有设置与缓存仅保存在你本机浏览器中。

【说明】
非官方第三方工具，与 X / xAI 无关。需在已登录 X 的浏览器中使用。
```

## 详细描述（English，可选第二语言）

```
Hover any tweet or long-form Article on X (Twitter) and it's explained in plain, conversational Chinese, rendered right there in a slick card.

• Hover to explain — a progress ring fills then auto-triggers.
• Real plain language — reuses X's built-in Grok "explain", rewrites it into conversational Chinese, streamed with citations.
• Supports X long-form Articles (timeline cards and article detail pages).
• Three modes: plain-language / UI demo / learn.
• Result cache, multiple themes.

Privacy: collects and transmits NO personal data, no external servers, no analytics. It reuses X's own already-signed Grok request and only rewrites the message locally; all settings and cache stay in your browser.

Unofficial third-party tool, not affiliated with X / xAI. Use in a browser logged in to X.
```

---

## 隐私实践（Privacy practices 标签页，逐项填写）

**单一用途 (Single purpose)**：
```
用 X 内置的 Grok 把当前 X 页面上的推文/文章解释成大白话口语化中文，并以卡片展示。
```

**权限理由 (Permission justifications)**：

- `storage`：
  ```
  保存用户设置（模式、主题、悬停时长、自定义 prompt）和解读结果缓存，全部存于本机 chrome.storage.local。
  ```
- 主机权限 `*://x.com/*`, `*://twitter.com/*`（含 `*.x.com`，为 grok.x.com）：
  ```
  扩展只在 X 上运行：读取当前页面的推文/文章文本以构建解读指令，并拦截改写 X 自己发出的 Grok 请求、读取其流式回答用于渲染。仅限这些域名。
  ```

**远程代码 (Remote code)**：否（所有代码随扩展打包，不加载任何外部脚本）。

**数据用途 (Data usage) —— 全部勾「不收集」**：
- 不收集个人身份信息、不收集用户活动、不收集网页内容用于外发。
- 推文/文章文本仅在页面内处理，作为 X 自身既有 Grok 请求的一部分发往 X，不发往开发者或任何第三方。
- 「学习模式」（可选）捕获的 Grok 请求结构存于本机，敏感请求头自动打码。
- 勾选三项声明：不将数据售卖给第三方 / 不用于无关用途 / 不用于判定信用资格。

**隐私政策 URL**：可用仓库的隐私说明页，例如：
```
https://github.com/nodlles/x-grok-dabaihua/blob/main/docs/PRIVACY.md
```
（若后台要求必填，需先补一个 PRIVACY.md，见下方提示。）
