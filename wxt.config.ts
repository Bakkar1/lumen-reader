import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// E2E builds swap Kokoro for the deterministic FakeTtsEngine (design §10)
// and go to their own output directory so they never overwrite a real build.
// LUMEN_FAKE_TTS=1 defaults to the fake voice with word events; =nowords to the one without.
const fakeTtsFlag = process.env.LUMEN_FAKE_TTS;
const fakeTts = fakeTtsFlag === '1' || fakeTtsFlag === 'nowords';

export default defineConfig({
  outDir: fakeTts ? '.output-e2e' : '.output',
  vite: () => ({
    plugins: [
      preact(),
      {
        // ONNX Runtime references its .wasm next to itself, so Vite emits a copy;
        // the Kokoro worker loads the one under public/kokoro/ort instead.
        name: 'lumen-drop-ort-wasm',
        generateBundle(_, bundle) {
          for (const file of Object.keys(bundle)) if (/^assets\/ort-wasm.*\.wasm$/.test(file)) delete bundle[file];
        },
      },
    ],
    define: {
      __LUMEN_FAKE_TTS__: JSON.stringify(fakeTts),
      __LUMEN_FAKE_WORD_EVENTS__: JSON.stringify(fakeTtsFlag !== 'nowords'),
      __LUMEN_E2E__: JSON.stringify(fakeTts),
    },
  }),
  manifest: {
    name: 'Lumen Reader',
    description: 'Reads web pages aloud with sentence and word highlighting.',
    // Design §10: exactly these permissions, nothing else. `offscreen` hosts the
    // bundled Kokoro model and plays its audio (the service worker cannot).
    permissions: ['offscreen', 'storage', 'contextMenus', 'alarms', 'activeTab', 'scripting'],
    host_permissions: ['<all_urls>'],
    // Kokoro runs on ONNX Runtime's WebAssembly build; WASM compilation must be allowed explicitly.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // Cross-origin isolation gives extension pages SharedArrayBuffer, so ONNX
    // Runtime can synthesise on several threads (single-threaded is slower than real time).
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
    action: {
      default_title: 'Lumen Reader',
    },
    // Design §8: rebindable at chrome://extensions/shortcuts. Alt is Option on macOS.
    commands: {
      'toggle-reading': {
        suggested_key: { default: 'Alt+Shift+L' },
        description: 'Play or pause; when idle, read the selection or the page',
      },
    },
  },
});
