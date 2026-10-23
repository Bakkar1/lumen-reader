// Listening test for task 2.8: plays each voice aloud at 2×, 2.5× and 3×
// through the built extension's chrome.tts and asks whether it sounded OK.
// The answers become the per-voice cap table in lib/tts/caps.ts.
//
//   npm run build
//   node scripts/voice-listen.mjs                      # all English voices
//   node scripts/voice-listen.mjs --voices "Samantha,Daniel"
//
// Keys after each sample: g = good, d = distorted/too fast, r = replay,
// s = skip this voice, q = save and quit.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const lang = opt('--lang', 'en');
const only = opt('--voices', null)?.split(',').map((s) => s.trim());
const outFile = path.resolve(import.meta.dirname, '../docs/demo/voice-listen.json');

const ext = path.resolve(import.meta.dirname, '../.output/chrome-mv3');
if (!existsSync(ext)) {
  console.error('No production build found. Run `npm run build` first.');
  process.exit(1);
}

const SAMPLE =
  'The lighthouse keeper climbed the stairs at dusk. Each step was worn smooth by a century of boots.';
const RATES = [2, 2.5, 3];

// Resume where a previous run stopped.
const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};

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
voices = voices.filter((v) =>
  only ? only.includes(v.voiceName) : v.voiceName && v.lang?.toLowerCase().startsWith(lang),
);

const speak = (voiceName, rate) =>
  worker.evaluate(
    ({ voiceName, rate, text }) =>
      new Promise((resolve) => {
        chrome.tts.speak(text, {
          voiceName,
          rate,
          onEvent: (e) => {
            if (['end', 'error', 'interrupted', 'cancelled'].includes(e.type)) resolve(e.type);
          },
        });
      }),
    { voiceName, rate, text: SAMPLE },
  );

const save = () => {
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(results, null, 2) + '\n');
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const todo = voices.filter((v) => !results[v.voiceName]);
console.log(`${todo.length} voice(s) to test (${voices.length - todo.length} already done). Results: ${outFile}\n`);

outer: for (const [n, v] of todo.entries()) {
  console.log(`[${n + 1}/${todo.length}] ${v.voiceName} (${v.lang})`);
  const verdicts = {};
  for (const rate of RATES) {
    for (;;) {
      process.stdout.write(`  ${rate}× … `);
      await speak(v.voiceName, rate);
      const answer = (await rl.question('g/d/r/s/q? ')).trim().toLowerCase();
      if (answer === 'r') continue;
      if (answer === 's') {
        results[v.voiceName] = { lang: v.lang, skipped: true };
        save();
        continue outer;
      }
      if (answer === 'q') break outer;
      verdicts[rate] = answer === 'd' ? 'distorted' : 'good';
      break;
    }
    // Once a rate is distorted, faster ones will be too.
    if (verdicts[rate] === 'distorted') break;
  }
  const good = RATES.filter((r) => verdicts[r] === 'good');
  results[v.voiceName] = { lang: v.lang, verdicts, cap: good.length ? Math.max(...good) : '<2' };
  save();
}

rl.close();
await context.close();
save();
console.log(`\nSaved to ${outFile}`);
