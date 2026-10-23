# Lumen Reader

A Chrome extension (Manifest V3) that reads web pages aloud with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), an open-weight speech model that runs inside the extension. It highlights the current sentence and word, and has a floating player, click-to-jump, sentence skipping and per-page resume. Nothing leaves your device: the model ships with the extension, and there are no accounts, no network requests and no cloud voices.

## Requirements

- Node.js 22.12 or later (not 23 or 25, which Vitest does not support), with npm
- Google Chrome or Chromium, for using the extension
- For the end-to-end tests: Playwright's Chromium (`npx playwright install chromium`)

## Build

```sh
npm install        # also runs `wxt prepare` and `npm run kokoro`
npm run build      # production build → .output/chrome-mv3/
```

`npm run kokoro` puts the Kokoro model (about 90 MB, downloaded once from Hugging Face), its voices and the ONNX Runtime WASM files in `public/kokoro/`. That folder is not committed, and existing files are skipped. The built extension is about 130 MB.

`npm run dev` starts WXT in watch mode, with a browser that reloads the extension on change.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `.output/chrome-mv3` folder.
4. Pin Lumen Reader from the puzzle-piece menu if you want its toolbar button.

After a rebuild, click the reload icon on the extension's card. To remove the extension and all its stored data, click **Remove**.

## Using it

- **Floating player:** it appears at the right edge of any page with at least 100 characters of readable text. Hover or click it to expand the controls (play/pause, previous and next sentence, speed 0.5×–3×, voice). Drag it up or down the edge. The close button hides it in that tab until you click the toolbar button or load a new page.
- **Keyboard shortcut:** `Alt+Shift+L` (`Option+Shift+L` on macOS). When nothing is playing, it reads the selected text, or the page if nothing is selected. While reading, it pauses and resumes. Change the key at `chrome://extensions/shortcuts`.
- **Context menu:** right-click and choose **Listen with Lumen Reader**. It reads the selection, or the page from the start of its main content.
- **Paragraph buttons:** hover a paragraph and click its play icon to start reading there.
- **Click to jump:** while reading, click any word to jump to the start of its sentence. Links still navigate normally.
- **Resume:** if you leave a page part-way through, Lumen Reader offers to resume there on your next visit. Positions are kept on this device for 30 days.
- **Toolbar popup:** play/pause, voice, speed and theme for the active tab.

## Tests

```sh
npm run compile    # type check
npm test           # unit tests (Vitest, happy-dom)
npm run test:e2e   # builds both variants, then runs Playwright
```

`npm run test:e2e` makes two builds:

- `.output/chrome-mv3`: the production build. Only the real Kokoro smoke test uses it.
- `.output-e2e/chrome-mv3`: a build with a deterministic fake speech engine (`LUMEN_FAKE_TTS=1`), so highlight and navigation timing is reproducible. Every other E2E test uses it.

Playwright loads the unpacked extension into its own Chromium (headless, one browser per test) and serves the pages in `tests/fixtures/` from a local server on port 4317.

Two helper scripts measured the voice speed caps for the slice 1 demo. They need a production build:

- `node scripts/voice-probe.mjs`
- `node scripts/voice-listen.mjs`

Their results are in `docs/demo/`.

## Project layout

| Path | What |
|---|---|
| `entrypoints/background.ts` | Service worker: the reading session, the Kokoro engine, context menu, shortcut, storage |
| `entrypoints/content/` | Content script: text extraction, highlighting, auto-scroll and the floating player (closed shadow root) |
| `entrypoints/popup/` | Toolbar popup |
| `lib/text/` | Main-content detection, DOM walker, sentence and word segmentation, offset ↔ DOM mapping |
| `lib/highlight/` | CSS Custom Highlight rendering, estimated word timing, auto-scroll, DOM-change re-mapping |
| `lib/tts/` | `TtsEngine` interface, the Kokoro engine (`kokoro/`: chunking, player, model worker), the fake engine and the speed caps |
| `lib/session.ts`, `lib/messages.ts`, `lib/storage/` | Session controller, typed messages, settings and positions |
| `tests/unit`, `tests/e2e`, `tests/fixtures` | Vitest, Playwright and the saved test pages |

## Known gaps

- **Iframes** are read one frame at a time. Starting a read picks the frame with the selection, otherwise the frame with the most text (so course players such as SCORM read the lesson, not the outer header). Paragraph play icons and resume offers only appear for text in the top frame, and the player shows no time remaining while reading a frame.
- **Shadow-DOM page content** is not read. Text that a site renders inside its own web components' shadow roots is skipped.
- **Canvas-rendered text** is not read.
- **Out-of-scope sites:** Google Docs, Gmail, PDFs in Chrome's viewer, and image text (no OCR). Chrome does not let extensions run on `chrome://` pages or the Chrome Web Store, so Lumen Reader is unavailable there.
- **Late-loaded content** (infinite scroll, "load more") is not appended to a reading that has already started. Start again to include it.
- **Unusual layouts:** main-content detection is a heuristic. If it picks the wrong part of a page, select the text you want and use the shortcut or context menu.
- **Browser support:** Chromium-based browsers only, because highlighting relies on the CSS Custom Highlight API.
- **Voices:** only browser and system voices. Some voices send no word timing; the word highlight is then estimated and re-synced at every sentence.
