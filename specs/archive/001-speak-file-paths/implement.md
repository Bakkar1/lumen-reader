# Implementation log — Speak file paths without pausing

## M1: Tracer bullet: `docs/agents/issue-tracker.md` read straight through — done 2026-10-30

- Commands: `npx vitest run` (unit suite, under 1 s), `npx vitest run tests/unit/spoken.test.ts -t "<name>"` for one case, `npx tsc --noEmit` for types. E2E (`npm run test:e2e`) was not needed and not run.
- `SENTENCE` in `chunks.ts` now has the `u` flag and treats a single `.` followed by `[\p{L}\p{N}/]` as part of the sentence body. The `./` continuation (`../lib`) is deliberately NOT in yet, so T6 has a real red. Ellipses already end chunks because the terminator `[.!?…]+` swallows the whole dot run greedily; T6's ellipsis cases will likely pass at once.
- `spokenText` maps each `\S+` word through `spokenWord`; currently only path-like words (two or more `/`, or a `/` plus a dot) are rewritten, and only for `.`→"dot", `/`→"slash", `-`/`_`→space. Leading-`/`/`./`/`~/` path-like rules, non-path words with spoken dots (`README.md`), and the exceptions all still need adding in M2/M3.
- The rewrite collapses doubled spaces and trims inside the word, so words never gain leading or trailing spaces; keep that so expected strings stay single-spaced.
- Player tests: the fake synthesiser makes one audio sample per character of the *spoken* text, so durations follow the spoken length while `word`/`end` charIndex values follow the displayed text. Assert on `synth.requests` and event charIndex/length, not timings, for path sentences.

## M2: Dot rule and its exceptions — done 2026-10-30

- `spokenWord` now applies the dot rule to every word (`SPOKEN_DOT`: a dot before a letter, digit, `/` or `./`), via a `replace` callback that keeps the dot when it is a lone decimal (`isDecimalDot` + exactly one digit`.`digit in the word) or part of an ellipsis run (`isInEllipsis`: run of 2+ dots, except `..` right before `/`). Slash and `-`/`_` rewrites still run only for `isPathLike` words, so `README.md`/`my_file.py` separators are NOT yet spaced: that is T13's red.
- `isPathLike` still lacks the "starts with `/`, `./`, `../`, `~/`" rule; `./scripts` and `../lib` only pass because they hold a `/` and a dot. `/usr/bin` (one slash, no dot) is not path-like yet: T10's red. Remember the plan's assumption to ignore leading opening quotes/brackets for the starts-with check.
- Abbreviations are skipped as a whole word via `ABBREVIATION` (single letters each followed by a dot, trailing dot required, optional wrapping punctuation like `(`, `,`, `)`). `e.g` without the final dot is treated as a spoken-dot word; fine for now.
- The dot callback inspects the ORIGINAL word by index; keep any new per-character rules (`@`, `~/`, scheme) either before this step on a fresh string or after it on `spoken`, not mixed, or the indexes break. Dropping a URL scheme (T14) is easiest as a first step that produces the word the dot rule then sees.
- `SENTENCE` in `chunks.ts` now also continues the body at a dot followed by `./`; ellipses (with or without a space) still end a chunk. No chunker work is expected in M3.

## M3: Slash, home, separators, URLs, emails, backslash — done 2026-10-30

- Order inside `spokenWord`: abbreviation early return, then URL scheme strip (`URL_SCHEME` produces the `word` every later rule sees), then the dot rule (which also sets `hasSpokenDot`), then `~/`→"home" and `/`→"slash" for path-like words, then `@`→"at" for `EMAIL` words, then `-`/`_`→space if path-like or `hasSpokenDot`. Keep new rules in this pipeline, not mixed into the dot callback.
- Choice the spec left implicit: in the "contains a `/` and a dot" path-like test, only a dot the dot rule would voice counts. A sentence-ending dot does not count, so `km/h.` stays unchanged (AC-3 + AC-10). The starts-with check skips leading opening quotes and brackets, as the plan assumed.
- The final tidy-up also removes a space just inside wrapping punctuation (`(slash etc)`, not `( slash etc)`). Expected strings in tests should never have such spaces.
- T16 (backslash) passed on its first run. Backslash words are never path-like, so only the dot rule applies. Gap that is not covered: `C:\my_docs\x.txt` has a spoken dot, so AC-12 turns `_` into a space, while AC-15 says "only the dot rule". The two ACs conflict here, and no test pins either reading.
- Plan risk still open: listen with `npm run dev` to the spec's examples to check Kokoro's pronunciation and that `\` is not voiced. Not done here (no audio in this environment).
