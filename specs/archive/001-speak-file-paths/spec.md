---
feature: 001-speak-file-paths
artifact: spec
status: approved
updated: 2026-10-30
---

# Spec — Speak file paths without pausing

## Summary

The reader speaks file paths, filenames, domains, URLs and emails straight through, without pausing, and voices the symbols in them: "dot", "slash", "at". For example, `docs/agents/issue-tracker.md` is read as "docs slash agents slash issue tracker dot md" with no gap. Prose punctuation, the displayed text and sentence handling stay as they are today.

## Why

Today the Kokoro chunker ends a chunk at every `.`, even when no space follows it. So `docs/agents/issue-tracker.md` is synthesised as two clips with silence between them. Kokoro's own normaliser also turns letter`.`letter into a silent hyphen, so the dot is never heard. A listener can't tell a path from two sentences.

## In scope

- Dot rule: a dot directly followed by a letter, a digit, `/`, or a path-continuing dot (`../`) is not a sentence end. It is spoken as "dot", and the text is not split into separate audio chunks there. This includes a leading dot.
- Exceptions to the dot rule: dotted single-letter abbreviations, single-dot decimals and ellipses.
- "slash" for `/` in path-like words only.
- "home" for a leading `~` in `~/`.
- Hyphen and underscore become silent word breaks inside paths and filenames.
- URL schemes (`https://` etc.) are dropped.
- "at" for `@` in emails.
- Rewriting the text before it reaches Kokoro, and changing the Kokoro chunker so it doesn't split at these dots.

## Out of scope

- Pronouncing extensions (`md`, `json`, …): left to the voice.
- Other URL symbols (`:`, `?`, `=`, `&`, `#`): left to the voice.
- Windows backslash paths: only the dot rule applies, and `\` is not spoken.
- Any change to the displayed text, page-level sentence segmentation, sentence highlighting, skipping or click-to-jump.
- Making word highlighting account for the extra spoken words. Some drift within a sentence that contains a path is acceptable.
- Non-English voices: Kokoro is the only real engine and its voices are English only.

## Acceptance criteria

Definitions used below:

- A **path-like word** is a whitespace-delimited word that does one of the following:
  - starts with `/`, `./`, `../` or `~/`
  - contains two or more `/`
  - contains a `/` and a dot
- A **spoken dot** is a dot that the dot rule (AC-2) voices as "dot".

Acceptance criteria:

- AC-1: WHEN the text contains `docs/agents/issue-tracker.md` THE SYSTEM SHALL speak it as "docs slash agents slash issue tracker dot md" within a single audio chunk.
- AC-2: WHEN a dot is directly followed by a letter, a digit, a `/`, or a dot that is itself followed by `/` THE SYSTEM SHALL NOT end an audio chunk at that dot. Unless AC-5, AC-6 or AC-8 applies, it SHALL speak that dot as "dot" (e.g. `README.md` → "README dot md", `Node.js` → "Node dot js", `example.com` → "example dot com").
- AC-3: IF a dot is followed by whitespace, by closing punctuation (a quote, bracket or other punctuation mark), or by the end of the text THEN THE SYSTEM SHALL treat it as a sentence end as today and SHALL NOT speak it as "dot". For example, `See docs/x.md.` is read as "… dot md" and then the sentence ends, and `He said "stop." Then` contains no "dot".
- AC-4: WHEN a word starts with a dot (with no character before it in the word) THE SYSTEM SHALL apply the dot rule to it: `.env` → "dot env", `./scripts` → "dot slash scripts", `../lib` → "dot dot slash lib".
- AC-5: WHEN the text contains a dotted abbreviation of single letters (e.g., i.e., U.S.A.) THE SYSTEM SHALL NOT speak "dot" for its dots.
- AC-6: WHEN a single dot stands between two digit groups (e.g. `3.14`) THE SYSTEM SHALL read it as a decimal, as today ("3 point 1 4").
- AC-7: WHEN two or more dots separate digit groups in one word (e.g. `1.2.3`, `192.168.0.1`) THE SYSTEM SHALL speak each of those dots as "dot" ("1 dot 2 dot 3").
- AC-8: WHEN the text contains an ellipsis (`...` or `…`) THE SYSTEM SHALL keep it as a pause and SHALL NOT speak "dot", even with no space after it (e.g. `wait...what`, `so…yes`). Two dots directly before a `/` are not an ellipsis (AC-4).
- AC-9: WHEN a `/` occurs in a path-like word THE SYSTEM SHALL speak it as "slash" (e.g. `/usr/bin` → "slash usr slash bin").
- AC-10: IF a `/` occurs in a word that is not path-like THEN THE SYSTEM SHALL speak it as today (e.g. `and/or`, `24/7`, `km/h` are unchanged).
- AC-11: WHEN a path-like word starts with `~/` THE SYSTEM SHALL speak the `~` as "home" (`~/notes/todo.md` → "home slash notes slash todo dot md").
- AC-12: WHEN a `-` or `_` occurs in a path-like word or in a word containing a spoken dot THE SYSTEM SHALL speak it as a silent word break (`issue-tracker.md` → "issue tracker dot md", `my_file.py` → "my file dot py").
- AC-13: WHEN a word starts with a URL scheme (`<scheme>://`) THE SYSTEM SHALL drop the scheme and read the rest under these rules (`https://github.com/acme/repo` → "github dot com slash acme slash repo").
- AC-14: WHEN an email address is read THE SYSTEM SHALL speak `@` as "at" (`name@example.com` → "name at example dot com").
- AC-15: WHEN a word contains a backslash THE SYSTEM SHALL apply only the dot rule to it and SHALL NOT speak "slash" or "backslash" for `\`.
- AC-16: WHEN text containing any of the above is displayed and read THE SYSTEM SHALL leave the displayed text, sentence segmentation, sentence highlighting, skipping and click-to-jump the same as today.

## Open questions

None.
