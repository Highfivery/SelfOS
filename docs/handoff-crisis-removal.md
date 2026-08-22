# Handoff — remove the crisis / distress system, app-wide

**Written 2026-08-22.** Notes (spec 76) is finished, reviewed, merged and released as **v0.61.0**. This is
the next piece of work, and it is the last thing outstanding from that arc.

---

## 1. The decision, and its exact boundary

The owner decided (2026-08-21, confirmed four times, most recently _"clean-up and completely remove the
crisis stuff"_) that the distress/crisis system **is removed app-wide**. Not softened, not gated — removed.

**"Completely" settles the two questions a previous session had flagged as open:**

1. **PHQ-9 item 9 goes too.** Spec 76 §11.1 had left it independently decidable. It is not being kept.
2. **The not-medical boundary STAYS.** It is a different thing — a positioning rule, not a self-harm
   pathway — and it is its own bullet in `CLAUDE.md` §1. Everything that says _"wellness support, not
   medical care"_ / _"not therapy, diagnosis, or treatment"_ survives.

That second point is the whole difficulty of this change. See §4.

---

## 2. Read this first — how the owner wants work done

Not suggestions. All of these have been said forcefully, more than once:

1. **Ask, never assume.** Any unstated product/UX/visibility/behaviour decision gets a question first.
2. **Fix what you find, in the same change.** No follow-ups, no "out of scope for this PR".
3. **Never state a fact about his system you have not just verified.** Print it, measure it, screenshot it.
   "The tests pass" is not a statement about what he sees.
4. **Never fix a cause you only assumed.** Reproduce it first.
5. **A guard that passes against its own reverted fix is not a guard.** Revert, watch it fail, restore.
6. **Leave the tree testable and say so unprompted** — a branch containing everything, `0` behind
   origin/main, verified by grepping rather than assuming.
7. **Never run the Playwright E2E while `pnpm dev` is up.** Every test dies as a silent 30s timeout,
   including ones you never touched. Close the dev app first. (Control test: `-g "boots straight to the
shell"`. If that fails too, it is the environment.)

---

## 3. The map — measured 2026-08-21, not estimated

An earlier session guessed "~120 files" and was wrong by half. The exhaustive count:

| Category                                      | Files                                         |
| --------------------------------------------- | --------------------------------------------- |
| Core modules existing **only** for crisis     | **3**                                         |
| Crisis-only components                        | **3**                                         |
| Production source referencing crisis/distress | **113**                                       |
| Test files (unit/component)                   | **55** (3 wholly crisis, 52 incidental)       |
| E2E (`launch.spec.ts`)                        | 15 test names, **4 wholly crisis**            |
| `docs/specs/*.md` with any mention            | **73** (18 with a dedicated crisis §-section) |
| Other docs + marketing                        | **10**                                        |
| **Distinct files total**                      | **≈252**                                      |

### 3.1 The three core modules

- `packages/core/src/coaching/crisisSignal.ts` — 100% crisis. `aggregateCrisisSignal`,
  `CRISIS_RECUR_COUNT`, `CRISIS_WINDOW_DAYS`. Re-exported by `coaching/index.ts:3`.
  **7 importers:** `email/emailMilestones.ts`, `email/emailSchedule.ts`, `coreBridge.ts` (6 call sites),
  `home/Home.tsx`, `books/StudioLayout.tsx`, + 2 tests.
- `packages/core/src/tests/adaptive/distress.ts` — 100% crisis. `readsAsDistress`,
  `takeCarriesDistress`, `DISTRESS_MARKERS`. Callers: `coreBridge.ts:5118`, `adaptiveService.ts:504`.
- `packages/core/src/tests/wellbeingCrisis.ts` — **NOT 100% crisis. See §4.1.**

### 3.2 Schema fields

`crisisFlag` is declared **5 times** (`InsightSchema`, `TestResultSchema`, `AlignmentReportSchema`,
`DreamAnalysisSchema`, `StoryMemorySchema`). `distressSignal` **once** (`DreamAnalysisSchema`).
`crisisSuppressed` is **never** a schema field — only a dependency-object parameter.

Crisis-only union members: `AutoCheckinRunResult` reason `'CRISIS'`, `EmailSendResult` reason `'CRISIS'`,
`StoryInterviewOutcome` member `'crisis'`, and `nightmareNudge` on the dream pattern stats.

The **only** place `Insight.crisisFlag` is aggregated is `crisisSignal.ts:47`.

### 3.3 Already dead — delete without ceremony

- `answerTriggersCrisis` (`wellbeingCrisis.ts:82`) — **zero** production callers, test-only.
- `CrisisSignal.count` / `.nightmare` / `.since` — never read in production, only in two tests.
- `hasRecentCrisis` — gone from code already; still named in 6 doc lines.

---

## 4. The four traps. Read these before touching anything.

### 4.1 `resolveWellbeingBand` lives in `wellbeingCrisis.ts` and is NOT crisis machinery

`packages/core/src/tests/wellbeingCrisis.ts:55` builds the **gentle, non-diagnostic band display**, and
`testService.ts:109` + `:206` depend on it. Deleting the file wholesale breaks the wellbeing result
screen. **Move `resolveWellbeingBand` (and `WellbeingBand.display`) somewhere sane FIRST**, then delete
the rest of the file.

### 4.2 `CrisisFooter` also carries the not-medical line — on 43 surfaces

Both footers state _"SelfOS is wellness support, not medical care"_ alongside the crisis copy:
`apps/desktop/.../sessions/CrisisFooter.tsx:13` and `packages/answering/src/CrisisFooter.tsx:15`.

They render at **36 desktop sites across 22 files** and **7 answering/relay sites** — every one of them
**unconditional**, which is deliberate (`CLAUDE.md`: "a crisis affordance belongs outside the pane that
changes, or a restructure silently drops it").

Deleting the component therefore **silently removes a kept rule from 43 surfaces.**

**DECIDED 2026-08-22 (owner): both footers are removed entirely.** No replacement component. The
not-medical line survives only where it already exists as separate copy (~21 files, listed in §4.3 and
below). The boundary therefore disappears from Sessions, Together, Dreams, Memory, Goals, Books, Inbox,
Sharing, Onboarding and the relay answering page. That is the owner's call, made with the surface count
in front of him — it is not an oversight, and it should not be "fixed" by a later session.

### 4.3 Four strings MIX kept and removed copy in one sentence

These need surgery, not deletion:

| File:line                                          | What it mixes                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/core/src/email/emailComposer.ts:8-10`    | `NOT_MEDICAL` — line 10 is the crisis-line sentence. Used at **9 sites**. |
| `apps/desktop/.../app/OrientationBody.tsx:23-24`   | not-medical + "if you're in distress, reach out to a crisis line"         |
| `apps/desktop/.../settings/customRows.tsx:130-131` | `AboutDisclaimer`, same mix                                               |
| `site/index.html:1933-1934` and `:2058-2059`       | marketing copy, same mix (twice)                                          |

`SAFETY` in `promptBuilder.ts:18` is the same shape but cleanly separable: the not-medical sentence is
`:18-19`, the crisis routing is `:20-23`. It is composed into **22 assembly sites** — change the constant,
not the sites.

### 4.4 Eighteen specs have dedicated crisis sections, several titled "non-negotiable"

`08` §8.2 · `12` §8.2 · `16` §8.2 · `18` §8.2 · `40` §3.5 · `48` §8.2 · `50` §8.2 · `51` §5.2 **and**
§8.2 · `52` §8.2 · `58` §8.5 · `63` §8.1 · `67` §8.1 · `72` §8.2 · `73` §8.4 · `74` §8.3 · `75` §8.4 ·
`76` §8.2 (already written against the post-removal state).

**`CLAUDE.md` §1 lines 18-21 must be rewritten in the same change.** Leaving it saying crisis routing is
non-negotiable while the code has none is exactly the drift the living-docs rule exists to prevent — and
worse, a future session will dutifully "restore" the code from it.

Also: `_TEMPLATE.md:59`, `.claude/agents/code-reviewer.md:29`, `.claude/agents/spec-writer.md:28`,
`.claude/skills/write-spec/SKILL.md:23`, `CONTRIBUTING.md:11-12`, `README.md:29,30,129`.

---

## 5. What dangles after removal

Fields that become write-only-then-unread, params threaded for crisis alone, and store slices with no
reader. **Remove these too — a field with no writer is scaffolding (§12).**

- **Params:** `emailSend.ts:208` + `emailSchedule.ts:638` (`crisisSuppressed`) ·
  `autoCheckins/service.ts:84` (`crisis`) · `storyInterviewService.ts:759` + `storyRefreshService.ts:66` ·
  `home/schemas.ts:38` (`StreakInput.crisis`) · `home/schemas.ts:77` (`RingsInput.crisis`) ·
  `recommendations/schemas.ts:71` · `home/GoalsCard.tsx:42,45`
- **Outputs that become permanently false:** `home/schemas.ts:51` (`suppressed`), `:70` (`softened`)
- **Partly survives:** `home/attention.ts:49` `suppressNudges` — `Home.tsx:515` is
  `crisis || proactivity === 'off'`; the proactivity half stays.
- **Renderer state:** `StudioLayout.tsx:157-166` (the `insights` fetch exists only for `crisisQuiet`;
  note `:261` reuses `activePersonIdForCrisis` for an unrelated dyad split — that reference survives and
  the variable name becomes a misnomer, so rename it) · `Home.tsx:262-266` (the `crisis` memo; `:264` is
  the only renderer consumer of `patternStats.nightmareNudge`)
- **Not a category:** there is **no** crisis settings key and **no** crisis notification kind.

---

## 6. Suggested order

Each step should typecheck and leave the suite green before the next. Do **not** try this in one commit.

1. **Move `resolveWellbeingBand` out of `wellbeingCrisis.ts`** (§4.1). Nothing else changes.
2. **Delete both `CrisisFooter` components** and all 43 render sites, imports and CSS (§4.2). No
   replacement — decided.
3. **Prompts** — `SAFETY` (`promptBuilder.ts:20-23`), `CRISIS_LEAD`, the crisisFlag contract lines in the
   8 analysis instructions, the 2 guided-catalog entries. Keep every "not therapy" frame.
4. **Email** — `emailSend.ts:216`, `emailSchedule.ts:753`, `emailMilestones.ts:47`, the 5 hardcoded
   `crisisSuppressed: false`, the bridge aggregation at `coreBridge.ts:6493` + `:6611`.
   **Consequence to state plainly in the PR:** email loses its crisis gate entirely — digests,
   suggestions and notes will send regardless of state. That is inherent to the decision.
5. **Producers** — the 11 services that set `crisisFlag`/`distressSignal`.
6. **Renderer** — the 3 components, the 10 inline conditional banners, `TestTake` mid-take escalation.
7. **Schemas + dangling** — the 5 fields, the 3 union members, everything in §5.
8. **PHQ-9 item 9** — `phq9.ts:70` + `:98`, `types.ts:78,85-90,109,156,194`, the rest of
   `wellbeingCrisis.ts`, `testService.ts:203-208,230,269,279-292`, `TestTake.tsx:4,50-58,152-158`.
9. **Tests** — 3 whole files deleted, 52 incidental references, 4 E2E tests deleted + 11 edited.
10. **Docs** — `CLAUDE.md` §1, the 18 spec sections, the agents/skills/README/CONTRIBUTING, `site/index.html`.

---

## 7. Definition of done

Beyond the standing gate (typecheck ×4, lint, format, full unit, full E2E):

- [ ] `grep -ri "crisis\|distressSignal\|readsAsDistress" packages apps --include=*.ts --include=*.tsx`
      returns **nothing** outside `CHANGELOG.md` and the dated `CLAUDE.md` build log.
- [ ] The not-medical line still renders wherever it exists as **separate** copy (~21 files). The 43
      footer slots deliberately lose it (§4.2) — do not re-add.
- [ ] `CLAUDE.md` §1 no longer claims crisis routing is required.
- [ ] No spec §-section describes a system that no longer exists.
- [ ] The E2E tests that asserted crisis behaviour are **deleted**, not skipped.

---

## 8. State of the tree as of this handoff

- `main` is at **v0.61.0**, released, `.dmg` attached (105 MB), manifest == latest tag, no loop PR.
- Notes (76) is complete: core, seam, surface, the recipient's answering route, and the fixes from a
  code review + a visual-QA pass.
- Nothing else is outstanding.
