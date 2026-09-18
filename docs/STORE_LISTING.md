# Chrome Web Store 上架资料

## 发布包与素材

运行 `node scripts/package.cjs`（Node.js 20+，系统需有 zip/unzip）。脚本先运行测试，再只打包运行文件并逐项核对内容。输出：`dist/x-grok-dabaihua-v0.3.0.zip` 和 SHA-256 校验文件。不要上传仓库根目录旧的 0.2.0 ZIP。

- 图标：`docs/store/store-icon-128.png`
- 截图：`docs/store/screenshot-1280x800.png`
- 小宣传图：`docs/store/promo-440x280.jpg`
- 当前条目 ID：`oaacbjibinjgboghddmbmapennjcglbe`，更新已有草稿，不新建重复条目。

## 基本信息

名称：X 大白话 · Grok 解读增强

简介：悬停 X 推文或文章，用 Grok 获取大白话中文解读，支持卡片内多轮追问和转入 Grok 继续。需登录 X 并具备 Grok 使用权限。

类别：生产力工具（选择后台中对应的具体分类）

语言：中文（简体）

主页：https://github.com/nodlles/x-grok-dabaihua

支持：https://github.com/nodlles/x-grok-dabaihua/issues

隐私政策：https://github.com/nodlles/x-grok-dabaihua/blob/main/docs/PRIVACY.md

## 中文详细描述

悬停 X（Twitter）上的推文或长文「文章」，用 Grok 获取口语化中文解读，在当前页面的卡片里读懂内容。有不明白的地方，可以直接追问。

功能：
• 悬停解读：停留到设定时长自动触发，也可点击进度环立即触发。
• 流式回答：逐步显示 Grok 的回答和返回的来源引用。
• 卡片内追问：结合原文、解读与之前的问答继续提问。
• 在 Grok 中继续：将对话背景填入原生输入框，编辑后自行发送。
• 本地缓存：再次查看同一篇内容时复用近期解读。
• 可调整主题、悬停时长和解读指令，另有 UI 演示与学习模式。

使用条件：
需要登录 X，且账号可以使用 X 内置的 Grok。解读和追问使用你自己的 Grok 额度，不提供额外额度，也不绕过 X 的访问限制。功能依赖 X 的页面和接口，可能受到其更新、地区和账号权限的影响。AI 解读可能出错，请结合原文判断。

数据与隐私：
解读与追问会把当前帖子文本、链接和相关问答发送给 X/Grok。设置和初次解读缓存保存在本机。没有开发者数据接收服务器、广告或分析 SDK。请求捕获默认关闭，仅在学习模式中手动开启时保存本地调试记录；这些记录可能包含聊天内容，可在设置中清空。详见隐私政策。

非官方第三方工具，与 X / xAI 无隶属关系。

## 隐私实践

单一用途：使用 X 内置 Grok 解释当前 X 帖子或文章，并围绕同一内容在卡片内追问或转入原生 Grok 继续。

storage 理由：在本机保存设置、自定义指令、初次解读缓存，以及用户明确启用的学习模式调试记录；设置页提供捕获记录清除操作，卸载可清除所有扩展本地数据。

主机权限理由（https://x.com/*、https://twitter.com/*）：仅在 X 页面读取当前帖子或文章，显示解读与追问卡片，并改写页面原有 Grok 请求的提示内容、读取回答。无需访问其他网站，不申请所有网站或子域名通配权限。

远程代码：否。所有 JavaScript 随扩展打包；网络返回的模型文本仅作为内容渲染，不作为代码执行。

数据类型需按后台实际定义核对，不能一律选择“不收集”：
- 网站内容：帖子、文章、解读、来源引用。
- 个人通信：用户问题、Grok 回答和可选的聊天调试样本。
- 网络记录：功能涉及的当前帖子链接和 Grok 请求地址；不读取浏览器的全站历史。
- 用户活动：悬停、点击和输入用于触发解读与追问，不做行为分析。
- 身份验证信息：复用原有 X 请求所携带的认证信息；不另行收集密码，捕获记录会打码已知敏感请求头。
- 内容可能含个人身份信息；申报时应覆盖实际处理的内容，不能因没有开发者服务器而省略。

用途仅为提供上述用户功能；不出售，不用于广告或无关用途，不用于信用资格评估。隐私声明、后台勾选项和代码必须保持一致。

## 审核测试说明（可粘贴到后台）

1. Install the extension and sign in to X at https://x.com with an account that can use the built-in Grok feature. The extension does not provide a separate account, API key or additional Grok quota.
2. Open extension Settings. Enable it and select 大白话 mode. Visit a post with text and a native Grok action. Hover until the progress indicator completes (or click the indicator). The extension triggers the native Grok explanation and displays its streamed answer in a card.
3. After the answer completes, enter a question in the card and send it. A new answer should appear using the original post and previous turns as context.
4. Choose 在 Grok 中继续. The native Grok input should contain an editable context draft. This action does not automatically send that draft.
5. UI 演示 mode can preview card styling without a live model request, but does not verify live Grok integration. Learning-mode request capture is off by default and must be enabled explicitly. Captures can be cleared in Settings; uninstalling removes all extension storage.
6. If Grok is unavailable, check the account's native Grok access/quota first. The extension depends on X's current UI and does not bypass its restrictions.

不要在公开仓库或文案中写审核账号密码。若审核要求专用测试账号，在后台私有测试说明中另行提供。

## 提交前检查

- 运行打包脚本并核对 ZIP 版本与运行文件。
- 已登录的真实 X 页面验证解读、连续追问和「在 Grok 中继续」；本地模拟测试不能替代这一步。
- 确认公开隐私政策 URL 已显示本次版本内容。
- 上传素材，保存商店详情、隐私、分发和审核测试说明。
- 提交审核后以后台状态为准，不把“草稿已保存”称作“已上架”。

参考：[发布流程](https://developer.chrome.com/docs/webstore/publish/)、[素材要求](https://developer.chrome.com/docs/webstore/images/)、[用户数据说明](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)。
