# Record — the crisis / distress system, removed app-wide

**Written 2026-08-22 as a handoff; the work was then completed in the same session and ships in the same
commit, so this is now a RECORD, not a to-do.** Notes (spec 76) had just been released as **v0.61.0**; this
was the last thing outstanding from that arc, and it is done.

Sections 1–5 are the analysis the change was built from and are still true — the decision and its exact
boundary, the working rules, the measured map, the four traps, and what dangled. §6 is what was actually
done. Keep this file: the traps in §4 are the reason the removal did not take the not-medical boundary with
it, and §1 is the standing answer to "should we add crisis handling back?" (no — see `CLAUDE.md` §1).

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

## 6. What was done

Built in the order below, each step typechecking and leaving the suite green before the next — which is
what kept the not-medical boundary intact through a 252-file change.

1. **`resolveWellbeingBand` moved out** of `wellbeingCrisis.ts` into a new `tests/wellbeingBands.ts`
   **before** anything was deleted (§4.1). It builds the gentle non-diagnostic band; it is not crisis
   machinery, and deleting its host file first would have taken it with it.
2. **Both `CrisisFooter` components deleted** outright, with all render sites, imports and CSS (§4.2).
   No replacement — the owner's call was "remove it entirely too". The 43 footer slots lose the
   not-medical line; the ~29 files that carry it as separate copy keep it.
3. **Prompts** — `SAFETY`, `CRISIS_LEAD`, the crisisFlag contract lines in the 8 analysis instructions,
   the 2 guided-catalog entries. Every "not therapy" frame kept.
4. **Email** — the gate, the aggregation, and the 5 hardcoded `crisisSuppressed: false`.
   **Stated plainly: email has no crisis gate at all now** — digests, suggestions and notes send
   regardless of state. That is inherent to the decision, not an oversight.
5. **Producers** — the 11 services that set `crisisFlag` / `distressSignal`.
6. **Renderer** — the 3 components, the 10 inline conditional banners, the `TestTake` mid-take escalation.
7. **Schemas + everything in §5** — the 5 fields, the 3 union members, the dangling params and outputs.
8. **PHQ-9 item 9**, and the remainder of `wellbeingCrisis.ts`.
9. **Tests** — 3 whole files deleted, the incidental references updated, the crisis E2E tests **deleted,
   not skipped**.
10. **Docs** — `CLAUDE.md` §1 (rewritten, and it now says explicitly that the previous text asserted the
    opposite, so a stale spec line reads as stale rather than as an instruction), the 18 spec sections,
    the agents/skills/README/CONTRIBUTING, `site/index.html`.

---

## 7. Verified, not assumed

- `grep -rn "crisisSignal|wellbeingCrisis|CrisisFooter|CrisisSupportBanner|adaptive/distress"` over
  `packages` + `apps` → **no matches**. No reference to a deleted module survives.
- `grep -rln "crisisFlag|distressSignal"` → **no files**.
- No hotline, emergency number or crisis-line copy anywhere in source.
- The not-medical boundary still present in **29** files.
- Full gate green: typecheck ×4, lint, format, **2551 core + 13 relay + 1795 desktop** unit, full E2E.

**One deliberate exception to the original grep-must-be-empty check.** `intakeCatalog.ts` keeps the
onboarding question **"Who do you turn to in a crisis?"** (`crisisPerson`). It sits between "How many close
friends do you have?", "How lonely do you feel?" and the social-battery slider, its placeholder is
_"e.g. my sister, my best friend, my partner"_, and **nothing reads it** — it is support-network context
feeding the portrait like any other intake answer, not distress machinery. It is the same category as the
professional-referral scope limits that were kept (§4.3). The original checklist said the grep must return
nothing; that was written before this was measured, and a grep is a proxy for the rule, not the rule.
Deleting a real onboarding question to make a proxy clean would be the tail wagging the dog.

---

## 8. What this does NOT do

- It does not touch the **not-medical positioning boundary**. That is a different thing and it stays
  (`CLAUDE.md` §1).
- It does not remove the **consent boundary** in the intimacy registers (never minors, never real
  non-consent, never illegal). That is a content rule, not a distress pathway.
- It does not remove **professional-referral scope limits** — lines that say a topic is for a
  professional rather than a self-guided exercise. Those bound what the app claims to be; they are not
  triggered by distress. (One of these was over-removed mid-build and restored:
  `challengeCoach.ts`'s "pointed toward a professional".)
