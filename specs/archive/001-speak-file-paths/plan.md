---
feature: 001-speak-file-paths
artifact: plan
status: approved
updated: 2026-10-30
---

# Plan — Speak file paths without pausing

## Approach

Two changes, both in the Kokoro path only. Nothing in `lib/text`, `lib/highlight` or `lib/navigation` changes.

1. **Chunker** (`lib/tts/kokoro/chunks.ts`): `SENTENCE` stops ending a chunk at a `.` that is directly followed by a letter, a digit, `/` or `./`, unless that dot is part of an ellipsis (`...`, `…`). A dot followed by whitespace, closing punctuation or the end of the text still ends a chunk, as today. Chunk text and offsets stay slices of the displayed text, so word timings and events keep pointing into it.
2. **Spoken form** (new `lib/tts/kokoro/spoken.ts`): a pure function `spokenText(text)` rewrites each whitespace-delimited word under the spec's rules before Kokoro sees it:
   - drop a URL scheme
   - classify the word: abbreviation, decimal, ellipsis, path-like, email, or has spoken dots
   - replace spoken dots with " dot ", `/` with " slash " (path-like words only), a leading `~/` with "home slash", `@` with " at " (emails), and `-`/`_` with a space (path-like words or words with a spoken dot)
   - leave everything else unchanged, so Kokoro's own handling (decimals, abbreviations, prose) stays as today
3. **Wiring** (`lib/tts/kokoro/player.ts`): the player sends `spokenText(chunk.text)` to the synthesiser instead of `chunk.text`. The `Chunk` it schedules, and so every `word`/`end` event, stays on the displayed text. Rewriting here rather than in the worker keeps the worker a thin model host and makes the wiring testable with the existing fake synthesiser.

## Files touched

- `lib/tts/kokoro/spoken.ts` (new): `spokenText(text: string): string`.
- `lib/tts/kokoro/chunks.ts`: sentence-end rule in `SENTENCE` (or a small scan replacing it).
- `lib/tts/kokoro/player.ts`: synthesise `spokenText(chunk.text)`.
- `tests/unit/spoken.test.ts` (new): `spokenText` cases.
- `tests/unit/kokoro.test.ts`: new `splitChunks` and `KokoroPlayer` cases.

## Risks

- **Kokoro mispronounces the rewritten text.** Mitigation: the output is plain English words and digits only. After M3, listen with `npm run dev` on a page containing the spec's examples.
- **Kokoro voices `\` itself** (AC-15 says it must not be spoken). Mitigation: T16 asserts that `spokenText` adds no "slash"/"backslash". If the manual listen hears one, replace `\` with a space in that word.
- **The spoken form is longer than the chunk.** The `MAX_CHUNK_CHARS` limit is measured on the displayed text, so a long, path-heavy sentence could near Kokoro's 510-token limit. Mitigation: accepted; 300 chars leaves headroom, and the limit can be applied to the spoken length if truncation is ever heard.
- **Words wrapped in opening punctuation** (`(~/notes)`, `"./scripts"`). Assumption: leading opening quotes and brackets are ignored when checking a "starts with `/`, `./`, `../`, `~/`" rule. This mirrors how AC-3 treats closing punctuation.
- **Mid-word dots no longer split chunks anywhere** (`Hi.There`, the inner dots of `e.g.`, `3.14`). This is required by AC-2. The existing `splitChunks` tests still hold because their dots are followed by spaces.
- **Word-highlight drift** in sentences with paths: accepted by the spec (out of scope).

## Test seams

<!-- Only seams listed here may be tested. -->

- S1: `spokenText(text)` (`lib/tts/kokoro/spoken.ts`) — catches: every word-level rewrite rule and its exceptions (dot, slash, home, separators, scheme, at, backslash, abbreviations, decimals, ellipses, prose left unchanged) / misses: chunk boundaries, whether the player uses it, how Kokoro actually pronounces the words.
- S2: `splitChunks(text, …)` (`lib/tts/kokoro/chunks.ts`) — catches: where audio chunks begin and end, and that offsets still slice the displayed text / misses: the spoken words.
- S3: `KokoroPlayer.speak` with the fake synthesiser and fake audio (`tests/unit/kokoro.test.ts`) — catches: end-to-end wiring, i.e. the synthesiser receives the spoken form in a single request while `word`/`end` events still index the displayed text / misses: real Kokoro audio and its normaliser.

## Tasks

<!-- One task = one red→green vertical slice at one seam. Tracer bullets first.
  - [ ] Tn: <behaviour to test> — Sx (AC-a, AC-b)
  - [ ] Tn: <change> [no-test: <reason>] (AC-c)
  Milestones group ~3–7 tasks into an increment that leaves the suite green. M1 is the tracer bullet.
  Small plans (~5 tasks or fewer) use a single M1. Task ids stay global.
-->

### M1: Tracer bullet: `docs/agents/issue-tracker.md` read straight through (AC-1, AC-2, AC-3, AC-16)

- [x] T1: `splitChunks` keeps `See docs/agents/issue-tracker.md now. Next.` as two chunks, with the path inside the first; a dot followed by a space still ends a chunk — S2 (AC-1, AC-2, AC-3)
- [x] T2: `spokenText('docs/agents/issue-tracker.md')` is "docs slash agents slash issue tracker dot md" — S1 (AC-1)
- [x] T3: speaking a sentence containing the path sends one synthesis request with the spoken form, while `word` and `end` events still point into the displayed text — S3 (AC-1, AC-16)

### M2: Dot rule and its exceptions (AC-2 – AC-8)

- [x] T4: a dot before a letter or digit is spoken as "dot" (`README.md`, `Node.js`, `example.com`); a dot before whitespace, a closing quote/bracket or the end is left alone (`See docs/x.md.`, `He said "stop." Then`) — S1 (AC-2, AC-3)
- [x] T5: leading dots are spoken: `.env` → "dot env", `./scripts` → "dot slash scripts", `../lib` → "dot dot slash lib" — S1 (AC-4)
- [x] T6: `splitChunks` does not split inside `.env`, `../lib` or `Node.js`, but still splits after an ellipsis with no space (`wait...what`, `so…yes`) — S2 (AC-2, AC-4, AC-8)
- [x] T7: dotted single-letter abbreviations (`e.g.`, `i.e.`, `U.S.A.`) and single-dot decimals (`3.14`) are left unchanged — S1 (AC-5, AC-6)
- [x] T8: two or more dots between digit groups are spoken: `1.2.3` → "1 dot 2 dot 3", `192.168.0.1` → "192 dot 168 dot 0 dot 1" — S1 (AC-7)
- [x] T9: ellipses never become "dot" (`wait...what`, `so…yes`, `Well... ok`) — S1 (AC-8)

### M3: Slash, home, separators, URLs, emails, backslash (AC-9 – AC-15)

- [x] T10: `/` is spoken as "slash" in path-like words (`/usr/bin` → "slash usr slash bin", `a/b/c`, `src/x.ts`) — S1 (AC-9)
- [x] T11: `/` in words that are not path-like is left unchanged (`and/or`, `24/7`, `km/h`) — S1 (AC-10)
- [x] T12: a leading `~/` is spoken as "home": `~/notes/todo.md` → "home slash notes slash todo dot md" — S1 (AC-11)
- [x] T13: `-` and `_` become word breaks in path-like words and words with a spoken dot (`issue-tracker.md`, `my_file.py`); prose such as `well-known` is unchanged — S1 (AC-12)
- [x] T14: a URL scheme is dropped: `https://github.com/acme/repo` → "github dot com slash acme slash repo" — S1 (AC-13)
- [x] T15: `@` in an email is spoken as "at": `name@example.com` → "name at example dot com" — S1 (AC-14)
- [x] T16: a backslash path gets only the dot rule: `C:\Users\me\notes.txt` speaks "notes dot txt", with no "slash" or "backslash" added — S1 (AC-15)

<!-- Coverage: every AC is covered by at least one task. AC-16 is covered by T3 (events still index the displayed text). Segmentation, highlighting, skipping and click-to-jump live in lib/text, lib/highlight and lib/navigation, which this plan does not touch; their existing tests stay as the guard. -->
