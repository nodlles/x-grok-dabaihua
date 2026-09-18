# X Dabaihua · Grok Explainer Enhancer

English · [简体中文](./README.md)

Hover any tweet or long-form **Article** on X (Twitter) and it's automatically explained in **plain, conversational Chinese** ("大白话") — rendered right there in a slick card.

<p align="center">
  <img src="./docs/demo.gif" alt="Demo: card streaming a plain-language explanation" width="360">
  &nbsp;&nbsp;
  <img src="./docs/screenshot.png" alt="Plain-language card shown next to the article body" width="600">
</p>

> The clever bit: the extension **never touches any signature and never stores any credentials**. It reuses X's own already-signed Grok request, rewriting only the message into a "speak plainly" instruction before it goes out, then reads back Grok's streamed answer and renders it.

## Features

- **Hover to explain**: rest the cursor on a tweet; a progress ring fills and auto-triggers — or click the ring to fire instantly.
- **Real plain language**: hijacks X's built-in Grok "explain", rewrites that official analysis into conversational Chinese, streams it in, with citation markers `[n]`.
- **X long-form Articles supported**:
  - Article cards in the timeline — keeps X's analysis context so the backend reads the article body as usual;
  - Article detail pages (no inline Grok button) — grabs the full text from the page and drives the Grok drawer to summarize it.
- **Three modes**:
  - `grok` real plain-language (default)
  - `demo` pure UI preview, no Grok call
  - `learn` learning mode, saves debugging records after capture is explicitly enabled (sensitive request headers are redacted)
- **Result cache**: the same tweet shows instantly; hit "Re-explain" to force a refresh.
- **Themes**: graphite / light / ocean / neon / follow system.
- **Hide native drawer**: moves X's own Grok drawer off-screen only while explaining; restores its original inline styles on completion, error, timeout, or card close.

## Install (load unpacked)

1. Clone this repo locally:
   ```bash
   git clone https://github.com/nodlles/x-grok-dabaihua.git
   ```
2. Open `chrome://extensions/` and turn on "Developer mode" (top right).
3. Click "Load unpacked" and select this repo's directory.
4. Open [x.com](https://x.com) and hover over any tweet.

> Use it in a browser already logged in to X (the Grok explanation relies on your own session). The extension declares only the `storage` permission, with host access limited to `x.com` / `twitter.com`.

## Settings

Click the extension icon or open "Options" from `chrome://extensions` to configure: on/off, mode, hover delay, theme, custom prompt, whether to hide the native drawer, and (if auto-detection misses) a manual drawer selector.

Request capture is off by default. It requires the extension to be enabled, learning mode selected, and the capture switch enabled. Existing switch preferences are preserved, but capture is inactive in plain-language and demo modes. Up to 30 records are stored locally, including request bodies and response samples that may contain chat content. View, copy, or clear them in Settings. Check records before sharing: header redaction does not sanitize the entire record.

Closing the card, re-explaining, or changing modes stops the old task's automated clicks, waits, and card reader. Requests already sent by X may continue and consume quota; the extension does not abort X's own requests. Waiting ends after 10 seconds without an initial response or 120 seconds overall.

## Development checks

Use Node.js 20 or newer; no dependencies are required:

```bash
node --test tests/*.test.cjs
```

Tests execute the actual scripts with simulated DOM, storage, and timers. They cover cancellation, drawer restoration, capture settings, and streaming. They do not replace compatibility checks against live X buttons, drawers, and APIs. After editing, reload the extension in `chrome://extensions/` and refresh X.

## How it works

| File | World | Responsibility |
|---|---|---|
| `inject.js` | MAIN | Wraps `fetch`/`XHR`, detects the Grok `add_response` by **request-body shape**; once armed, rewrites the message into the plain-language instruction and parses the NDJSON stream back |
| `content.js` | ISOLATED | Hover progress ring, card UI, extracting tweet/article text, locating and clicking the Grok entry point, receiving main-world messages to render |
| `render.js` / `cardui.js` / `cache.js` / `card.css` | ISOLATED | Rich-text rendering, card interaction, caching, styles |
| `options.html` / `options.js` | — | Settings page |

The two worlds talk via `window.postMessage`. When rewriting:
- Normal tweets (text present in the DOM) → embed the text into the prompt, switch to a plain chat message;
- Articles / image / video posts (no text in the DOM) → **keep** `promptMetadata` so X's backend supplies the body, and only append the "speak plainly" style requirement.

## Disclaimer

Unofficial third-party tool, not affiliated with X / xAI. For personal study and research only; please comply with X's Terms of Service.

## License

[MIT](./LICENSE) © 2026 nodlles
