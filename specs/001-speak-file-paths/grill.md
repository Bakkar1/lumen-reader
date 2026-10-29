---
feature: 001-speak-file-paths
artifact: grill
status: draft
updated: 2026-10-29
---

# Grill — Speak file paths without pausing

## Idea

I would like that the reader do not stop or pause when reading a file.
example:  
docs/agents/issue-tracker.md
now the reader pause and do not read loud the . but it should beacuse this is a file path on how we now that their is no space after the .

## Findings

- The pause comes from the Kokoro chunker: `SENTENCE` in `lib/tts/kokoro/chunks.ts` ends a chunk at every `.`, space after it or not, so `docs/agents/issue-tracker.md` is synthesised as two clips, `docs/agents/issue-tracker.` and `md`, with silence between them.
- The page-level sentence splitter (`Intl.Segmenter` in `lib/text/segment.ts`) does not break there, so sentence highlighting and skipping are unaffected.
- The dot is never voiced because kokoro-js's normaliser rewrites letter`.`letter to letter`-`letter (`/(?<=[A-Z])\.(?=[A-Z])/gi`) before phonemising. kokoro-js also already reads decimals as "point" (`3.14` → "3 point 1 4") and turns dotted acronyms followed by a lowercase word into hyphens.
- Kokoro is the only real engine (en-us / en-gb voices only).

## Rounds

### Round 1

#### Q0 — Slug

- Options: speak-file-paths (Recommended) / inline-dots
- Recommendation: speak-file-paths: names the user-visible outcome.
- Answer: speak-file-paths

#### Q1 — Which dots are read as "dot"

A dot followed by a space, or at the end of the text, still ends the sentence.

- Options: Any dot followed by a character (Recommended) / Only things that look like files / Only paths containing '/'
- Recommendation: Any dot followed by a character: the user's own rule ("no space after the dot"), simple and predictable.
- Answer: Any dot followed by a character
- Notes: covers paths, bare filenames, domains, emails, code names (Node.js). Exceptions settled in round 2.

#### Q2 — How '/' is spoken

- Options: Say "slash" (Recommended) / Silent, no pause / Leave it to the voice
- Recommendation: Say "slash": how people read paths aloud; keeps the structure audible.
- Answer: Say "slash"

#### Q3 — How '-' and '_' in paths and filenames are spoken

- Options: Silent word break (Recommended) / Say "dash" / "underscore" / Leave as today
- Recommendation: Silent word break: natural, and what the voice already does for hyphens.
- Answer: Silent word break

### Round 2

#### Q4 — Dotted abbreviations (e.g., i.e., U.S.A.)

- Options: Keep as today (Recommended) / Say "dot" too
- Recommendation: Keep as today: single letters separated by dots are an abbreviation, not a path.
- Answer: Keep as today

#### Q5 — Dots between digits (3.14, 1.2.3, 192.168.0.1)

- Options: One dot "point", several "dot" (Recommended) / Always "point" / Always "dot"
- Recommendation: One dot "point", several "dot": keeps Kokoro's decimal reading; versions and IPs read as people say them.
- Answer: One dot "point", several "dot"

#### Q6 — Leading dot (.env, .gitignore, ./scripts, ../lib)

- Options: Say "dot" (Recommended) / Only dotfiles, not ./ or ../ / Keep as today
- Recommendation: Say "dot": same no-space-after rule.
- Answer: Say "dot"
- Notes: "../lib" is "dot dot slash lib". Two dots directly before a '/' are a path, not an ellipsis (see Q7).

#### Q7 — Ellipsis with no space after it ("wait...what", "so…yes")

- Options: Keep as a pause (Recommended) / No pause, no words
- Recommendation: Keep as a pause: an ellipsis is never "dot dot dot".
- Answer: Keep as a pause

#### Q8 — Where '/' is said as "slash"

- Options: Only in path-like words (Recommended) / Every '/'
- Recommendation: Only in path-like words: and/or, 24/7 and km/h must not change.
- Answer: Only in path-like words
- Notes: path-like means the word starts with / ./ ../ ~/, has two or more slashes, or has a slash plus a dot.

#### Q9 — Full URLs (https://github.com/acme/repo)

- Options: Drop the scheme, read the rest (Recommended) / Read everything / Only the domain
- Recommendation: Drop the scheme: "https://" adds nothing for a listener.
- Answer: Drop the scheme, read the rest

#### Q10 — Word-highlight drift from the extra spoken words

- Options: Yes, a small drift is fine (Recommended) / Account for the spoken words
- Recommendation: A small drift is fine: the sentence highlight stays exact and the word estimate re-syncs every sentence.
- Answer: Yes, a small drift is fine

### Round 3

#### Q11 — Pronouncing extensions (.md, .ts, .json)

- Options: Leave it to the voice (Recommended) / Spell short ones letter by letter / A small dictionary
- Recommendation: Leave it to the voice: no dictionary to maintain.
- Answer: Leave it to the voice

#### Q12 — '@' in emails

- Options: Say "at" (Recommended) / Leave it to the voice
- Recommendation: Say "at": explicit, so it doesn't depend on the voice.
- Answer: Say "at"

#### Q13 — Windows backslash paths

- Options: Out of scope (Recommended) / Say "backslash"
- Recommendation: Out of scope: only the dot rule applies to them.
- Answer: Out of scope

## Shared understanding

**Goal.** Paths, filenames, domains, URLs and emails are read straight through with no pause, and their dots are spoken. Example: `docs/agents/issue-tracker.md` → "docs slash agents slash issue tracker dot md", with no gap.

**Dot rule.** A dot directly followed by a character (no space) is not a sentence end. It is spoken as "dot" and never splits the text into separate audio chunks. A dot followed by whitespace or at the end of the text still ends the sentence as today (`See docs/x.md.` → "… dot md", then the sentence ends). A leading dot counts too: `.env` → "dot env", `./scripts` → "dot slash scripts", `../lib` → "dot dot slash lib". Covers bare filenames (`README.md`), domains, emails and code names (`Node.js`).

**Exceptions, kept as today:**
- Dotted abbreviations of single letters (e.g., i.e., U.S.A.): no "dot".
- A single dot between digits is a decimal: `3.14` → "3 point 1 4". Two or more dots between digit groups are spoken as "dot": `1.2.3`, `192.168.0.1`.
- An ellipsis (three dots or `…`), even with no space after it, is a pause, never "dot dot dot". Two dots directly before `/` are a path (`../`).

**Slash.** Spoken as "slash", but only in path-like words: a word that starts with `/`, `./`, `../` or `~/`, has two or more slashes, or has a slash plus a dot. Prose such as and/or, 24/7 and km/h is unchanged.

**Hyphen and underscore** in paths and filenames are silent word breaks ("issue tracker", "my file dot py").

**URLs.** The scheme is dropped: `https://github.com/acme/repo` → "github dot com slash acme slash repo".

**Emails.** '@' is spoken as "at": "name at example dot com".

**Out of scope:** pronouncing extensions (left to the voice, so `md`, `json` etc. sound however Kokoro says them); Windows backslash paths (only the dot rule applies to them); any change to the displayed text, sentence segmentation, sentence highlighting, skipping or click-to-jump.

**Highlighting.** The spoken text is longer than the displayed text. Word-highlight drift within a sentence that contains a path is acceptable; the sentence highlight stays exact.

**Where it applies.** Kokoro is the only real engine and its voices are English only, so "dot", "slash" and "at" are English words. Two things must change: the Kokoro chunker must stop splitting at a dot with no space after it, and the text must be rewritten before it reaches Kokoro, whose own normaliser otherwise turns `letter.letter` into a silent hyphen.
