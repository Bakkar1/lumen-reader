// Measures, for each English voice, how long a fixed sentence takes at
// 1×, 2×, 2.5× and 3×, and the gap between two enqueued sentences (task 2.8).
// A voice whose duration stops shrinking has hit its cap. Runs muted
// (volume 0); distortion still has to be judged by ear.
//
//   npm run build && node scripts/voice-probe.mjs [--lang en] [--json out.json]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const lang = opt('--lang', 'en');
const jsonOut = opt('--json', null);

const ext = path.resolve(import.meta.dirname, '../.output/chrome-mv3');
const SENTENCE = 'The lighthouse keeper climbed the stairs at dusk, and the lens began to turn.';
const RATES = [1, 2, 2.5, 3];

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

let voices = [];
for (let i = 0; i < 20 && voices.length === 0; i++) {
  voices = await worker.evaluate(() => chrome.tts.getVoices());
  if (!voices.length) await new Promise((r) => setTimeout(r, 250));
}
voices = voices.filter((v) => v.voiceName && v.lang?.toLowerCase().startsWith(lang));

const results = [];
for (const v of voices) {
  const row = await worker.evaluate(
    async ({ voiceName, text, rates }) => {
      const speak = (rate, enqueue = false) =>
        new Promise((done) => {
          const t = { start: 0, end: 0, words: 0 };
          // Some voices never finish (or never start) when muted; give up after 20 s.
          const timer = setTimeout(() => {
            chrome.tts.stop();
            done(null);
          }, 20_000);
          const resolve = (value) => {
            clearTimeout(timer);
            done(value);
          };
          chrome.tts.speak(text, {
            voiceName,
            rate,
            volume: 0,
            enqueue,
            onEvent: (e) => {
              if (e.type === 'start') t.start = performance.now();
              if (e.type === 'word') t.words++;
              if (e.type === 'end') resolve({ ...t, end: performance.now() });
              if (e.type === 'error' || e.type === 'interrupted' || e.type === 'cancelled') resolve(null);
            },
          });
        });
      const durations = {};
      let words = 0;
      for (const r of rates) {
        const t = await speak(r);
        durations[r] = t ? Math.round(t.end - t.start) : null;
        if (t) words = Math.max(words, t.words);
      }
      // Gap: two sentences, the second enqueued while the first plays (as SessionController does).
      const first = speak(1);
      const second = speak(1, true);
      const [a, b] = await Promise.all([first, second]);
      const gapMs = a && b ? Math.round(b.start - a.end) : null;
      return { durations, wordEvents: words > 0, gapMs };
    },
    { voiceName: v.voiceName, text: SENTENCE, rates: RATES },
  );
  const base = row.durations[1];
  const speedup = Object.fromEntries(
    RATES.map((r) => [r, base && row.durations[r] ? Math.round((base / row.durations[r]) * 100) / 100 : null]),
  );
  // Highest requested rate that still gave at least 90 % of the expected speed-up.
  const reached = RATES.filter((r) => speedup[r] !== null && speedup[r] >= r * 0.9);
  const cap = reached.length ? Math.max(...reached) : 1;
  results.push({ voiceName: v.voiceName, lang: v.lang, remote: !!v.remote, ...row, speedup, cap });
  console.log(
    `${v.voiceName.padEnd(36)} ${String(v.lang).padEnd(6)} words=${row.wordEvents ? 'yes' : 'no '} ` +
      `speed-up ${RATES.map((r) => `${r}×→${speedup[r] ?? '–'}`).join(' ')}  cap≈${cap}×  gap=${row.gapMs ?? '–'}ms`,
  );
}

await context.close();
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
