---
feature: 001-speak-file-paths
artifact: verify
status: approved
updated: 2026-10-30
---

# Verify — Speak file paths without pausing

## Review

`code-review` was run on `lib/tts/kokoro/{spoken,chunks,player}.ts`, `tests/unit/spoken.test.ts` and `tests/unit/kokoro.test.ts`.

| # | Finding | File | Decision |
|---|---|---|---|
| R1 | The chunk caps (300, and 80 for the first chunk) were measured on the displayed text, but Kokoro reads the longer spoken form. A path-heavy 297-char sentence became 677 spoken chars, which risks the 510-token truncation. | `lib/tts/kokoro/player.ts:170` | applied: `splitChunks` and `breakPoint` now measure `spokenText(...).length` (`spokenFit`) |
| R2 | `wordTimings` placed words by their displayed position, so the highlight drifted after a path, URL or email. | `lib/tts/kokoro/chunks.ts:78` | applied: words are placed by their offset in the spoken text |
| R3 | Dates such as `10/30/2026` are read "10 slash 30 slash 2026", because a word with two or more `/` is path-like by the spec's definition. | `lib/tts/kokoro/spoken.ts:69` | skipped: the spec requires this; moved to Follow-ups |
| R4 | `Ph.D.`, `No.5` and `U.S.-based` are read with "dot". AC-5 only exempts abbreviations made of single letters. | `lib/tts/kokoro/spoken.ts:15` | skipped: the spec requires this; moved to Follow-ups |
| R5 | A word that is only a scheme (`https://`) was rewritten to `''`, so it was dropped from speech and could make an empty synthesis request. | `lib/tts/kokoro/spoken.ts:25` | applied: the scheme is only dropped when something readable follows it; `https://` alone is now read "https: slash slash" |
| R6 | A missing space after a full stop (`He left.She came.`) is read "left dot She" and stays in one chunk. | `lib/tts/kokoro/spoken.ts:12` | skipped: AC-2 requires this; moved to Follow-ups |
| R7 | A long URL or path with no spaces was hard-cut mid-word at the limit. | `lib/tts/kokoro/chunks.ts:53` | applied: `breakPoint` falls back to the last `/` before a hard cut. This softens the problem but doesn't remove it (see Follow-ups). |
| R8 | The inside-word-dot regex was copied 3 times across `chunks.ts` and `spoken.ts`, and the opening-punctuation class 5 times. | `lib/tts/kokoro/spoken.ts:70` | applied: `INSIDE_WORD_DOT` is exported from `spoken.ts` and builds `SENTENCE`, `SPOKEN_DOT` and `HAS_SPOKEN_DOT`; `OPENING` builds the other regexes |
| R9 | No test checked that chunk limits hold once the text is expanded for speech. | `tests/unit/kokoro.test.ts:156` | applied: added `splitChunks` › "measures the limit on the spoken form…" |

Tests added during review: `splitChunks` › "measures the limit on the spoken form, which is longer than the displayed text for paths" (R1/R9), `splitChunks` › "breaks a path or URL longer than the limit after a slash" (R7), `wordTimings` › "places words by their position in the spoken text" (R2), `spokenText` › "reads a scheme with nothing after it instead of dropping it" (R5).

## Test & build results

| Command | Outcome |
|---|---|
| `npm test` (`vitest run`) | pass: 20 files, 274 tests |
| `npm run compile` (`tsc --noEmit`) | pass: no errors |
| `npm run build` (`wxt build`) | pass: built `.output/chrome-mv3` |
| `npm run test:e2e` (build + e2e build + Playwright) | 44 passed, 1 failed: `player-a11y.spec.ts:14` "the player is fully operable with the keyboard alone" (the player didn't move up within 5 s after ArrowUp) |
| `npx playwright test tests/e2e/player-a11y.spec.ts --repeat-each=3` | pass: 6 of 6. The failure is flaky, and the test exercises the player panel position, which no file in this feature touches. |

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| AC-1 | pass | `spokenText` › "reads a file path straight through, voicing its slashes and dot"; `splitChunks` › "does not end a chunk inside a file path…"; `KokoroPlayer` › "synthesises a sentence with a file path as one spoken request…" (one request: `See docs slash agents slash issue tracker dot md now.`) |
| AC-2 | pass | `spokenText` › "speaks a dot before a letter or digit, but not one that ends a sentence" (`README.md`, `Node.js`, `example.com`); `splitChunks` › "does not end a chunk at a leading or inner dot of a word…" |
| AC-3 | pass | `spokenText` › "speaks a dot before a letter or digit, but not one that ends a sentence" (`See docs/x.md.`, `He said "stop." Then`, `(See README.md.)`); `splitChunks` › "…but still ends one at a dot followed by a space" |
| AC-4 | pass | `spokenText` › "speaks leading dots" (`.env`, `./scripts`, `../lib`); `splitChunks` › "does not end a chunk at a leading or inner dot…" |
| AC-5 | pass | `spokenText` › "leaves dotted single-letter abbreviations and single-dot decimals unchanged" (`e.g.`, `i.e.`, `U.S.A.`, `(i.e., this)`) |
| AC-6 | pass | Same test (`3.14`, `$0.99.` reach Kokoro unchanged, so its normaliser reads them as today). Not confirmed by listening. |
| AC-7 | pass | `spokenText` › "speaks every dot when two or more separate digit groups" (`1.2.3`, `192.168.0.1.`) |
| AC-8 | pass | `spokenText` › "never speaks an ellipsis as a dot" (`wait...what`, `so…yes`, `Well... ok`); `splitChunks` › "…but does after an ellipsis" |
| AC-9 | pass | `spokenText` › "speaks a slash in path-like words" (`/usr/bin`, `a/b/c`, `src/x.ts`, `(/etc)`) |
| AC-10 | pass | `spokenText` › "leaves a slash alone in words that are not path-like" (`and/or`, `24/7`, `km/h.`) |
| AC-11 | pass | `spokenText` › "speaks a leading ~/ as home" (`~/notes/todo.md`, `(~/notes)`) |
| AC-12 | pass | `spokenText` › "turns - and _ into word breaks in paths and dotted words, but not in prose" (`issue-tracker.md`, `my_file.py`; `well-known`, `snake_case` unchanged) |
| AC-13 | pass | `spokenText` › "drops a URL scheme and reads the rest" (`https://github.com/acme/repo`, `(see http://example.com)`) |
| AC-14 | pass | `spokenText` › "speaks @ in an email as at" (`name@example.com.`; `@alice` unchanged) |
| AC-15 | pass | `spokenText` › "applies only the dot rule to a backslash path" (`C:\Users\me\notes.txt` → `C:\Users\me\notes dot txt`, with no "slash" or "backslash" added). Whether Kokoro voices `\` itself has not been confirmed by listening. |
| AC-16 | pass | `KokoroPlayer` › "synthesises a sentence with a file path…" (`word`/`end` charIndex values index the displayed text); `git diff` shows `lib/text`, `lib/highlight`, `lib/navigation` and `entrypoints` untouched; the e2e suite (highlighting, skipping, click-to-jump) passes, apart from the flaky panel test above, which passes on re-run. |

## Follow-ups

- **Dates read with "slash"** (R3): `10/30/2026` and `1/2/3` are path-like under the spec's "two or more `/`" rule. Consider leaving words made only of digit groups and slashes alone. Changing this needs a follow-up grill round.
- **Mixed-case and multi-letter abbreviations** (R4): `Ph.D.`, `No.5`, `U.S.-based`, `I.B.M.'s` and `i.e` (with no final dot) are read with "dot". Widening AC-5 needs a follow-up grill round.
- **Missing space after a full stop** (R6): `He left.She came.` is read "left dot She" and isn't split. Consider not voicing a dot between a lowercase word and a capitalised one when nothing else looks like a domain or path. This needs a follow-up grill round.
- **Pieces of a hard-cut path are classified separately** (R7): when a space-free path or URL is longer than the spoken limit, it now breaks after a `/`. Each piece then goes through `spokenText` on its own, so a short tail with one `/` and no dot (e.g. `bbbb/cccc`) isn't path-like and its slash is not voiced. This only matters for words longer than about 300 spoken chars (80 for the first chunk).
- **AC-12 and AC-15 conflict** (from `implement.md`): in `C:\my_docs\x.txt` the spoken dot turns `_` into a space, while AC-15 says "only the dot rule". No test pins either reading.
- **Manual listen still pending** (plan risk): run `npm run dev` on a page with the spec's examples to check Kokoro's pronunciation, that `3.14` is still "3 point 1 4", and that `\` is not voiced.
- **Flaky e2e test**: `tests/e2e/player-a11y.spec.ts:72` (a 5 s poll on the player moving after ArrowUp) failed once in the full run and passed 3 out of 3 times on its own. It isn't related to this feature.
