# Open-risk coverage (task 7.2)

How each acceptance risk in `openspec/changes/lumen-reader-extension/design.md` ("Risks / Trade-offs") is covered. Test results are from the clean run on 2026-10-22: `tsc` clean, Vitest 212/212, Playwright 44/44.

| Risk | Covered by | Status |
|---|---|---|
| Voices with no word-boundary events | E2E `tests/e2e/highlight.spec.ts` "sentence and word highlights follow the estimate (voice without word events)". Unit `tests/unit/highlight.test.ts` "no word timing: the estimate advances and re-syncs at the next sentence" and "a voice that should send word events but stays silent falls back to the estimate". Unit `tests/unit/session-controller.test.ts` "learns that a voice sends no word events after its first sentence". | Covered (passing tests) |
| MV3 service worker suspension | E2E `tests/e2e/playback.spec.ts` "after the service worker is stopped mid-read, the state is paused at the last sentence". Unit `session-controller.test.ts` "restores a playing snapshot as paused at its sentence and resumes from there". | Covered (passing tests) |
| Speed caps of browser voices | Clamping logic: unit `session-controller.test.ts` "clamps to the voice cap and reports the effective speed" and "applies the per-voice cap". **The cap table `VOICE_CAPS` in `lib/tts/caps.ts` is still empty**, while `docs/demo/voice-listen.json` marks every voice tested by ear as distorted at 2×. | **Open: needs owner decision** |
| Speechify sign-in wall | `SPEC.md` header: the study ran signed in with the owner's own free account, so no fallback was needed. The owner approved `SPEC.md` (task 1.8). | Covered (documented owner acceptance) |
| Untrusted REA content and prompt injection | `SPEC.md` §16: no directives found in target content. The package, evidence and screenshots are kept outside the repo, under `~/rea-work/speechify-2026-10-22/`. | Covered (documented in the owner-approved `SPEC.md`) |
| Clean-room drift | `SPEC.md` §16 clean-room statement. E2E `tests/e2e/player-isolation.spec.ts`. **The slice 3 clean-room checklist sign-off (task 4.6) is not recorded in the repo.** | **Open: owner sign-off to be recorded** |
| Dynamic or SPA DOM | Unit `tests/unit/live-mapping.test.ts` "a paragraph replaced by an identical copy…" and "the paragraph being read is removed…". | Covered (passing tests) |

Other risks listed in `design.md`:

- **Gaps between sentences:** the measured gap is 1–2 ms per voice (`gapMs` in `docs/demo/voice-probe.json`). No switch to paragraph-level utterances is needed.
- **Heuristic detection:** covered by the body fallback and the read-selection escape hatch. See `tests/unit/locator.test.ts` and the selection tests in `tests/e2e/navigation.spec.ts`.
- **`<all_urls>`:** accepted for personal use (D1). Revisit before any distribution.
