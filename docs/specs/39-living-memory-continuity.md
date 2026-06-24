# 39 — Living memory & continuity

> **Status:** Approved — _last updated 2026-06-23_ (§11 resolved with the owner; see §11)
>
> SelfOS's memory **accretes but never self-heals**: reconciliation (dedup, confidence, merge,
> contradiction-avoidance) runs **only** when the user manually taps "Refresh memory" — which most
> people never do — so duplicates and contradictions pile up across months, and same-meaning insights
> from different producers (a session + a questionnaire) are never related. Separately, the coach has
> **no structured sense of goals or commitments over time**: a goal is just a `Goal: …` text fact, so
> nothing can follow up, mark it done, or notice it went stale. This spec makes memory stay **coherent
> automatically** (passive/threshold reconciliation, cross-source coherence, cleanup of orphaned
> shares and flagged-fact retraction) and gives it **continuity** via first-class tracked **goals &
> commitments**. It is the **data/coherence layer**; the proactive _acting_ on it (the coach
> following up) lives in sibling [`40`](40-proactive-coaching.md).

Part of the 2026-06 five-spec group: [`37`](37-ai-robustness.md) (AI robustness),
[`38`](38-questionnaire-lifecycle.md) (questionnaire lifecycle), **39 (this)**,
[`40`](40-proactive-coaching.md) (proactive coaching — the consumer of structured goals + a clean
memory), [`41`](41-first-run-discoverability.md) (first-run/discoverability). Builds on
[`20`](20-memory-dashboard.md) (the living insights dashboard, reconciliation, flag-as-inaccurate,
life-area taxonomy, the per-person privacy fix), [`28`](28-portrait-synthesis-optimization.md)
(per-fact `lifeArea`, topic-aware fact selection), [`18`](18-personal-onboarding.md) (the intake
portrait — the first/largest insight), and [`09`](09-session-analysis.md) (the producer that emits
Theme/Goal/Follow-up facts). References [`00`](00-architecture.md)/[`01`](01-design-system.md)/
[`06`](06-ai-usage-and-budgets.md) (metering/budgets) and [`15`](15-shareability.md) (the
shareable-vs-private boundary).

---

## 1. Overview

Memory in SelfOS is the set of **`Insight`** records (`packages/core/src/schemas.ts`
`InsightSchema`), stored per-subject at `people/<subjectPersonId>/insights/<id>.enc`, produced by
four sources (intake / session / dream / questionnaire) and read back by `summarizeForContext`
(`packages/core/src/insights/insightStore.ts`) into every coaching call's system prompt. Spec 20
made that surface a living, per-person dashboard with AI confidence, flag-as-inaccurate, and
**reconciliation**. But three structural gaps remain — each verified against the code:

**(A) Reconciliation is opt-in, so it rarely runs.** `reconcileInsights`
(`packages/core/src/insights/reconcileService.ts`) — which sets confidence + rationale, normalizes
categories, and **conservatively merges** clear duplicates while **never re-asserting a
`flaggedInaccurate` fact** — is invoked **only** by the manual `memory:refresh` (`memory.reconcile`
usage). The 20 §3.5 design folds _category-tagging_ into each producer's existing analysis call (no
extra spend), but the **full coherence pass** (dedup / contradiction resolution / confidence
recalibration) never fires automatically. The header comment is explicit: _"there is no automatic
reconciliation call … this AI pass runs only when the user taps Refresh."_ Result: over months,
duplicates and stale/contradicting facts accumulate, diluting the pinned portrait and every
downstream prompt. Same-text insights from **different producers** are also never merged —
`reconcileInsights` operates within one subject's set, but nothing relates "Goal: run a half
marathon" (from a session) to "wants to get fit / run" (from intake).

**(B) Goals are not tracked.** Session analysis (`sessionAnalysisService.ts` ~line 266) emits goals
as plain facts — `addFacts('Goal', draft.goals)` → `text: "Goal: finish the project by Friday",
shareable: false`. There is **no status, no due/horizon, no done/abandoned, no first-class entity**.
So the coach cannot follow up on a commitment, the user cannot see or close their goals, and nothing
can notice a goal went stale or was missed. This is the continuity the coach is missing and that
spec 40 needs as input.

**(C) Cleanup gaps.** Three small but real correctness leaks:

1. **Orphaned `shareableWith`.** A fact's `shareableWith: [personId]` (12 §3.4 per-person sharing) is
   **never cleaned up** when that person is deleted. `deletePerson`
   (`packages/core/src/people/peopleService.ts` line 101) removes only the person's folder; it never
   scans _other_ people's insight facts for dangling `shareableWith` references. They don't currently
   leak (the read-time re-gate via `listRelatedPeople` drops a removed relationship), but they're
   stale data that re-grants if a future person reuses the id and a confusing artifact in Memory.
2. **No retraction of a prior share.** Flagging a fact `flaggedInaccurate` (20 §3.6) excludes it from
   context immediately — but if that fact was **already shared/promoted** to a related person, the
   flag does **not** retract the prior `shareableWith`/`shareable` grant; the corrected claim keeps
   feeding the other person's coach until the next read re-gate happens to drop it.
3. **Legacy portraits dump everything.** A pre-28b portrait has **no per-fact `lifeArea`**, so
   `selectPortraitFacts` (`insightStore.ts` line 235) treats it as all-CORE and never topic-narrows —
   an old maximal portrait pushes its full (bounded) fact set into every call. 28b only re-tags on
   re-synthesis or a manual Refresh; an untouched legacy portrait stays untagged forever.

This spec closes A/B/C and surfaces the result in the Memory dashboard (20). It is the foundation
spec 40 builds on; the _acting_ (proactive follow-ups, nudges) is explicitly out of scope here.

## 2. Goals / Non-goals

**Goals**

- **Memory stays coherent without the user remembering to refresh** — a passive/automatic
  reconciliation cadence (riding analysis passes and/or a threshold/periodic trigger), with explicit
  budget guardrails, that dedups across sources, recalibrates confidence, and resolves contradictions
  (prefer newest / higher-confidence).
- **Goals & commitments are first-class, tracked entities** — extracted from sessions (and other
  producers), each with a **status** (open / in-progress / done / stale / abandoned), an optional
  **due/horizon**, **provenance**, and surfaces for the user to **see, update, and close** them — and
  a clean read API for spec 40 to follow up on.
- **Cross-source coherence** — relate/merge insights about the same thing across features (session ↔
  questionnaire ↔ intake), conservatively, without collapsing distinct nuance.
- **Cleanup** — reap orphaned `shareableWith` on deleted people; **retract prior shares** when a fact
  is flagged inaccurate; (optionally) retro-tag legacy portraits with `lifeArea` so they
  topic-narrow.
- **Surface coherence in Memory (20)** — a Goals section; a calm "memory is being kept tidy" signal;
  user **confirm/dismiss for merges** (per §11's decision).
- **Additive & safe** — additive-optional schema fields (the §18/§20/§28 precedent), Zod-first,
  per-person isolation, the shareable-vs-private boundary unchanged (the bridge is the trust
  boundary), tolerant model-JSON parsing.

**Non-goals (deferred / out of scope)**

- **The coach acting on goals/memory** — proactive follow-ups, "you said you'd…" nudges, check-ins:
  all spec [`40`](40-proactive-coaching.md). This spec only **produces + maintains** the structured
  data and surfaces it for the user.
- **A separate "one canonical brain" knowledge store** — we keep reconciling per-source insights
  (adjust / merge / supersede), as 20 decided; we do not build a distinct deduped knowledge graph.
- **Authoring metric taxonomies / a goals analytics dashboard** — Goals are listed + closable here;
  charts/trends stay 20 §3.4 / 11 territory.
- **Background OS-level scheduling / a daemon** — any "periodic" trigger is renderer-driven on app
  events (launch / focus), like the update-check cadence (spec 36), never a main-process cron.
- **Cross-person goals** (a shared "us" commitment) — single-subject goals only in v1.
- **Re-architecting `summarizeForContext`'s related-people path** — `MAX_SHARED_FACTS_PER_PERSON` and
  the privacy filters are untouched.

## 3. UX & flows

This spec is mostly a **data/coherence layer** (developer-facing); the user-perceived surfaces are
(1) Goals in Memory, (2) a calm "kept tidy" signal, and (3) confirm/dismiss for merges. The acting
on goals is spec 40.

### 3.1 Goals & commitments in Memory (`/memory`, gated by `memory.own`)

A new **"Goals & commitments"** section in the Memory dashboard (20 §3.1), above or alongside the
life-area groups:

1. Each goal shows its **text**, **status** (a labelled, non-color-only chip: Open / In progress /
   Done / Stale / Abandoned), an optional **due/horizon** ("by Fri" / "this month" / no date), and
   **provenance** ("From a session on <date> →", deep-linking like 20 §3.3).
2. **Actions** the user can take: set status (a labelled control — mark **in progress**, **done**,
   **abandoned**), edit the text/due, or delete. Marking **done/abandoned** moves it to a collapsed
   "Completed & closed" subsection (kept for history; the coach can reference "you finished X").
3. **Stale** is a _derived_ display state (§4.3 / §11) — a goal past its due, or untouched for a
   threshold with no due, surfaces gently ("This has been open a while — still working on it?") with
   one-tap **Still on it / Mark done / Let it go**. (The _proactive surfacing of this elsewhere_ —
   Home, a session opener — is spec 40; here it's a Memory affordance.)

Empty state: a warm "Goals you mention in sessions show up here so SelfOS can help you follow
through." The crisis footer + not-medical line are always present (§8).

### 3.2 The "kept tidy" signal

When automatic reconciliation runs (§3.3), Memory shows an unobtrusive, calm indicator — e.g. a
"Memory last tidied <relative-date>" line near the header (reusing `lastReconciledAt`), and, if a
pass merged/recalibrated anything, a small "N updates" affordance opening the review (§3.4). It is
**informational, never alarming** — no "your memory was messy" framing.

### 3.3 Automatic reconciliation cadence

Reconciliation runs **without the user tapping Refresh** (the central change). Exact cadence +
trigger + opt-out are **§11 open questions** (do not assume); the candidate shape:

- **Ride producer passes (zero extra spend) for the cheap parts** — category tagging + per-fact
  `lifeArea` already fold into each producer's existing analysis call (20 §3.5 / 28). Keep that.
- **Threshold/periodic full pass for the coherence parts** — the dedup/contradiction/confidence pass
  (which is a real AI call, `memory.reconcile`) runs automatically when warranted: e.g. after the
  Nth new insight since the last reconcile, or on a long-enough gap, triggered on a renderer app
  event (launch/focus) — **budget-gated**, throttled, and skippable (it falls back to today's manual
  Refresh when AI is off / over budget). The manual **Refresh memory** stays as a force.
- **Guardrails** — never more than one automatic pass per throttle window; never auto-spend when over
  budget; honor an opt-out setting if §11 chooses one. It operates on insight summaries/facts (small),
  not transcripts, so cost is low (the existing `memory.reconcile` characterization).

### 3.4 Confirm/dismiss for merges (per §11)

Today reconciliation **applies merges directly** (`reconcileService.ts` applies `merges` then
deletes the source). For automatic reconciliation, whether merges/contradiction-resolutions are
**auto-applied** or **proposed for confirm-before-apply** is a §11 decision. If confirm-before-apply
is chosen: merges become **proposals** surfaced in Memory's "Needs your review" region (20 §3.1) with
**Merge / Keep both**, and the confidence/category recalibration (low-risk) still auto-applies.

### 3.5 Cross-source coherence (developer-facing)

When reconciliation considers a subject's insights, it sees **all sources** (intake / session /
dream / questionnaire) in one digest and may relate/merge across them (e.g. a session "Goal: get
fit" related to an intake "wants to be healthier"). The conservative-merge rule (only clearly the
same thing; prefer adjusting confidence over merging) is unchanged (20 §11). Goals get special
handling so the _same commitment_ mentioned twice doesn't become two goals (§4.3).

## 4. Data model (vault files & schemas)

Additive-optional throughout — the §18/§20/§28 precedent (`Insight.schemaVersion` stays **1**, no
migration, existing insights parse byte-for-byte). All reads/writes go through the vault + crypto
service (`@selfos/core/vault`, `00` §4.3); no direct `fs`.

### 4.1 Goals & commitments — the entity model (a §11 decision)

The central modelling choice (**§11 Q2 — do not assume**) is whether a goal is:

- **(a) a typed Insight subtype** — reuse `InsightSchema` with a new `source`-adjacent discriminator
  and goal-specific optional fields (status/due), stored in the same per-subject `insights/` dir; or
- **(b) a new first-class store** — `people/<id>/goals/<id>.enc`, a dedicated `GoalSchema`, produced
  by the same analysis passes and **referenced from** the insight it came from.

A candidate `GoalSchema` (whichever home §11 picks) — illustrative, Zod-first:

```ts
export const GoalStatusSchema = z.enum(['open', 'inProgress', 'done', 'stale', 'abandoned']);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const GoalSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1), // per-person isolation — the goal's owner
  text: z.string(), // the commitment in the person's terms
  status: GoalStatusSchema, // open by default; `stale` is derived for display, persisted on confirm
  due: z.string().optional(), // ISO date or null — a hard deadline if named
  horizon: z.string().optional(), // a soft horizon when no date ("this month", "someday")
  lifeArea: z.string().optional(), // from LIFE_AREAS, normalized server-side (mirrors InsightFact)
  provenance: InsightProvenanceSchema, // which session/source named it (reuse the existing schema)
  contributingSources: z.array(InsightProvenanceSchema).optional(), // re-mentions folded in
  insightId: z.string().optional(), // the Insight this goal was extracted from (back-reference)
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTouchedAt: z.string().optional(), // last time the person or coach engaged it (staleness basis)
});
export type Goal = z.infer<typeof GoalSchema>;
```

**`stale` semantics (§11 Q2/Q3).** `stale` is a _derived_ display state computed from `due` /
`lastTouchedAt` against a threshold; it is only **persisted** when the user confirms (or, per §11, an
automatic pass marks it). The exact detection rule (past-due vs N-days-untouched) is §11.

If **(a) the Insight subtype** is chosen, the equivalent fields ride `Insight` (additive-optional:
`goalStatus?`, `goalDue?`, `goalHorizon?`, `lastTouchedAt?`) on an insight whose facts are goal
facts, rather than a separate file — fewer new seams, but mixes lifecycle state into a record that's
also context-grounding. §11 weighs this.

### 4.2 `Insight` / `InsightFact` additions (cleanup, additive-optional)

- **Retraction marker** — flagging a fact inaccurate (20 §3.6, `flagInsightFact` in `insightStore.ts`)
  must also **strip its prior shares**: clear `shareable` → false and remove all `shareableWith`
  entries on that fact when it's flagged. No new field is strictly required (we mutate the existing
  `shareable`/`shareableWith`), but a `retractedShareAt?: string` audit stamp on the fact is a
  candidate (§11 Q4) so Memory can show "sharing withdrawn."
- **Legacy retro-tag** — no schema change; legacy portrait facts simply gain `lifeArea` via the same
  `normalizeFactLifeArea` path when retro-tagging runs (§4.5 / §11 Q5).

### 4.3 Cross-source / de-dup of goals

A new commitment mentioned again (same session-thread or a later one) must not spawn a duplicate
goal: extraction looks up an existing **open/in-progress** goal for the subject with a clearly-equal
text (the `reconcileService` `norm()` normalization precedent) and **folds the re-mention into it**
(append provenance to `contributingSources`, bump `lastTouchedAt`) rather than creating a new one.
This mirrors the conservative merge already in `reconcileService`.

### 4.4 Usage / metering

- The automatic full reconcile pass meters under the **existing `memory.reconcile`** usage type
  (`usageTypes.ts`) — no new type for the coherence pass; it's the same operation, just sometimes
  auto-triggered. (Whether automatic vs manual passes are distinguished for the usage breakdown is a
  §11 nicety, not required.)
- Goal extraction folds into each producer's **existing** analysis call (the §20/§28 "no extra spend"
  precedent — the analysis already returns `goals`; we structure them instead of stringifying), so
  there is **no new AI spend for goal tracking** beyond what session analysis already costs.

### 4.5 Cleanup operations (pure / cheap, no AI)

- **`reapOrphanShares(fs, key, deletedPersonId)`** — on `deletePerson`, scan every _other_ person's
  insight facts and remove the deleted id from any `shareableWith` (and re-save). Pure file I/O, no
  AI. (See §5.3.)
- **`retractFactShares(fact)`** — invoked by `flagInsightFact` when flagging: clears the fact's
  `shareable`/`shareableWith` (§4.2).
- **Legacy retro-tag (optional, §11 Q5)** — a one-time, no-AI best-effort tag of a legacy portrait's
  facts from `SECTION_LIFE_AREA` (the 28 fallback map), run lazily on first read or during a refresh;
  only worth it if §11 says so.

## 5. Architecture & modules

No new feature module — this is `@selfos/core` (insights/goals/people) + a Memory dashboard section
(reuses the 20 surface). Changes by area:

### 5.1 Reconciliation cadence (`@selfos/core/insights` + the bridge / renderer)

- **`reconcileInsights`** (`reconcileService.ts`) is reused as-is for the AI pass; its digest already
  spans all sources and honors flagged facts. The new work is **when** it runs: a renderer-driven
  trigger (an AppShell hook on launch/focus, mirroring spec 36's `useUpdateChecks` cadence) calls
  `memory:refresh` automatically when a threshold/gap condition holds and budget allows — throttled,
  per-person. The decision logic (a pure `shouldAutoReconcile(state, now)` helper) is unit-testable
  and keyed on `lastReconciledAt` + an insight-count delta.
- If confirm-before-apply merges are chosen (§11 Q1), `reconcileInsights` gains a "propose only" mode
  that returns merge **proposals** instead of applying them; the bridge persists proposals into the
  20 "Needs your review" queue.

### 5.2 Goal extraction & store (`@selfos/core`)

- A **`goalService`** (new, in `@selfos/core/insights` or a new `@selfos/core/goals` per §11) —
  `extractGoals` (folds the producer's `goals` into structured `Goal`s with de-dup §4.3),
  `listGoals(personId)`, `setGoalStatus`, `updateGoal`, `deleteGoal`, and `markStaleGoals(now)` (the
  derived-stale computation). Producers (`sessionAnalysisService` first; others later) call
  `extractGoals` after saving the insight. No extra AI call.
- `summarizeForContext` may optionally surface a compact "open commitments" line so the coach is
  aware of them (the _grounding_; the _follow-up_ is spec 40). Bounded like the other context, behind
  the same privacy filters.

### 5.3 Cleanup (`@selfos/core/people` + `insights`)

- **`deletePerson`** (`peopleService.ts`) gains a follow-on `reapOrphanShares` call (in the bridge's
  delete handler, to avoid a people↔insights import cycle — the `listAllInsights`/`insightFeedsContext`
  precedent of reading across folders from the seam layer).
- **`flagInsightFact`** (`insightStore.ts`) strips the flagged fact's shares (§4.2) in the same write.

### 5.4 Renderer (Memory dashboard, 20 §5.3)

- A **Goals & commitments** section + a **`GoalCard`** (status chip via the existing `ConfidenceChip`
  / a new labelled status chip → `/gallery` if a new primitive, DoD §12), the "kept tidy" signal, and
  (if §11 chooses) merge-proposal review reusing the "Needs your review" region. A `goalStore`
  (Zustand) scoped + reset per active person (the per-person isolation rule — added to the AppShell
  reset like `useInsightStore`). Responsive ~360px→desktop.

## 6. IPC / API contracts

All gated by **`memory.own`** + **active-person-scoped in the bridge** (the trust boundary); the
Claude key stays in main (`00` §6.2).

- **`goals:list()`** → the active person's goals (own only). Zod-validated.
- **`goals:setStatus({ goalId, status })`** / **`goals:update({ goalId, text?, due?, horizon? })`** /
  **`goals:delete({ goalId })`** — own goals only, scoped in the bridge.
- **`memory:refresh({ auto?: boolean })`** — extend the existing channel (20 §6) with an `auto` flag
  (so the renderer cadence can call it; `auto` passes are throttled + budget-aware, and report a
  no-op envelope when skipped). Typed `NO_KEY`/`BUDGET`/`AI_OFF`/`NOTHING_TO_DO` envelopes (as today).
- **`memory:reconcileState()`** (or a field on the existing list) → `{ lastReconciledAt?, pending?:
number }` for the "kept tidy" signal + any merge proposals.
- **No new IPC for cleanup** — `reapOrphanShares` runs inside the existing `people:delete` handler;
  share-retraction rides the existing `insights:flag` handler.
- **Claude** — the reconcile pass is unchanged in shape (`reconcileService.ts` — bounded structured
  JSON, `extendedThinking: false`, metered **before** parse, the `[[adaptive-thinking-shares-maxtokens]]`
  rule). Goal extraction adds **no** new Claude call (rides existing analysis). Coordinate with
  [`37`](37-ai-robustness.md): the reconcile/analysis JSON parsing must stay **tolerant** (the spec
  28b / 37 lesson — salvage a partial result, never all-or-nothing).

## 7. States & edge cases

- **No goals** → warm empty state (§3.1).
- **No insights / fresh person** → reconciliation no-ops (`NOTHING_TO_DO`, as today); no goal
  surfaces.
- **AI off / over budget** → automatic reconcile **skips silently** (logs nothing alarming); category
  tagging still rides analysis when AI is on; the dashboard fully renders existing goals + insights;
  manual Refresh degrades calmly (no dead button). Goal status changes are pure (no AI) and always
  work.
- **Auto-reconcile throttle** → at most one automatic pass per window; a manual Refresh always
  overrides the throttle.
- **Duplicate goal re-mentioned** → folded into the existing open goal (§4.3), never a second card.
- **Goal's source deleted** → the goal persists (the 20 §3.7 keep-the-insight precedent); provenance
  shows "source removed."
- **Person with `shareableWith` references deleted** → `reapOrphanShares` removes the dangling ids
  from others' facts; if the reap is interrupted, the read-time re-gate (`listRelatedPeople`) still
  prevents any leak — the reap is **cleanup, not the trust boundary**.
- **Flagged fact that was previously shared** → flag strips its `shareable`/`shareableWith`
  immediately (§4.2), so the related person's coach stops receiving it on the next read; Memory shows
  "sharing withdrawn" if the audit stamp (§11 Q4) is adopted.
- **Legacy untagged portrait** → without retro-tag it stays bounded-but-not-narrowed (28b fallback —
  correct, just not topic-sharp); with retro-tag (§11 Q5) it gains `lifeArea` and narrows like a
  fresh portrait.
- **Contradiction (newer insight contradicts older)** → reconciliation prefers newest / higher
  confidence (per §11 Q1's auto-vs-confirm choice); a `flaggedInaccurate` fact is never re-asserted
  (the existing invariant).
- **Sync conflict / corrupt insight or goal file** → handled by the vault service as today (`00`
  §4.3); a corrupt record surfaces a typed error before reconciliation/selection; reconciliation is a
  pure transform over already-validated records.
- **Per-person switch** → `goalStore` (and `insightStore`) reset; no carryover (the 20 §5.1 fix).
- **Migration** → none (additive-optional, §4); a pre-39 vault has no goals + untagged legacy
  portraits, both handled by the fallbacks above.

## 8. Safety

This touches wellbeing/memory that feeds the coach, so the boundary is explicit (`05` §7 / `20` §8):

- **Not medical / crisis** — goals are reflective commitments, never a treatment plan; the coach's
  follow-up tone (spec 40) and any "stale goal" prompt are gentle, never pressuring ("still working
  on it? totally fine to let it go"). The "Get help now" footer + not-medical line are always present
  in Memory.
- **Crisis is never narrowed away** — reconciliation and goal extraction never touch the 28
  invariant: a `crisisFlag` portrait stays bounded-but-never-topically-narrowed; an `Emotions &
patterns` fact stays always-on. A goal that surfaces distress routes to resources, never a
  diagnosis.
- **Privacy is sacred (the headline).** Reconciliation only ever sees **one subject's own** insights
  (the `reconcileService` privacy invariant — it loads only that person's folder; the prompt never
  sees another subject). Goals are per-subject, never cross-person. The cleanup operations only ever
  **reduce** sharing (reap orphans, retract on flag) — they can never **add** a share or surface a
  withheld fact. `summarizeForContext`'s restricted/shareable/flagged filters are untouched; goal
  grounding (if added to context, §5.2) runs **behind** those same filters. The bridge is the trust
  boundary for every new channel.
- **Honest signals** — the "kept tidy" indicator is informational, never anxiety-inducing; confidence
  reflects real corroboration (20 §8); flagging visibly retracts.

## 9. Accessibility

Per [`01`](01-design-system.md) §9: the Goals section uses semantic headings; status is conveyed as
**text + a non-color-only chip** (not color alone); status setters, edit/close, and merge-proposal
controls are labelled, keyboard-operable, with visible focus; the "kept tidy" line and any
"N updates" affordance are announced (a polite live region) without being noisy. Responsive
~360px→desktop (Goals stack on phones; no horizontal scroll — a status filter is a full-width
control, not a scrolling chip row, per the §12 UI rule). Reduced-motion respected. Any new
design-system primitive (a status chip) is added to `/gallery`.

## 10. Testing strategy

Vault via the in-memory `memFileSystem` fake; Claude via the deterministic fake `ClaudeClient`
(`SELFOS_FAKE_CLAUDE`); decrypt the vault to assert data, not just the UI. Run `pnpm typecheck` after
tests (memory `vitest-does-not-typecheck`).

**Unit (core, node)**

- `goalService`: `extractGoals` structures a producer's `goals` into `Goal`s; a re-mentioned goal is
  **folded** (provenance appended, no duplicate); `setGoalStatus`/`update`/`delete`; `markStaleGoals`
  derives stale from due/`lastTouchedAt` against the threshold.
- `shouldAutoReconcile`: triggers on the count-delta/gap condition, respects the throttle window, and
  is false when AI is off / over budget.
- `reconcileInsights` (regression): still merges conservatively across sources, sets confidence +
  rationale, **never re-asserts a `flaggedInaccurate` fact**, only sees one subject; if "propose-only"
  mode is added, it returns proposals without deleting.
- **Cleanup boundary:** `reapOrphanShares` removes a deleted person's id from every other person's
  `shareableWith` and nowhere else; `flagInsightFact` **strips** the flagged fact's
  `shareable`/`shareableWith` (a previously-shared, now-flagged fact is **absent** from the related
  person's `summarizeForContext` after flagging — decrypt-assert).
- **Privacy regression (20 slice-1 style):** reconciliation/goals never surface another subject's
  data; the cross-person filters in `summarizeForContext` are unchanged (the 15 §10 truth-table holds
  with goals present).

**Component (Vitest + RTL)**

- The Goals section renders goals grouped by status with labelled chips; set-status / close / edit;
  the empty state; the "kept tidy" signal; (if chosen) the merge-proposal review.
- AI-off / over-budget calm states (no dead Refresh; goal edits still work).

**E2E (Playwright + Electron)**

- Hold a session that names a goal → End & summarize → the goal appears in Memory's Goals section
  with status Open and provenance → mark it Done → it moves to closed.
- Flag a previously-shared fact inaccurate → decrypt the vault and assert the related person's
  `buildContext` no longer carries it (retraction).
- Delete a person who had a fact shared with → decrypt and assert the dangling `shareableWith` id is
  gone from the other person's facts.
- Automatic reconcile fires on the trigger condition (seed N insights → app event → a
  `memory.reconcile` usage event recorded), and is throttled / skipped when over budget. (The offline
  fake returns canned reconcile ops so the seam runs end-to-end.)
- 360px no-overflow + control-geometry guards on the Goals section.

## 11. Open questions — RESOLVED (owner, 2026-06-23)

All seven were resolved with the owner before building (every recommendation confirmed). Recorded here
as the build contract; the body above is read in light of these.

1. **Reconciliation cadence, triggers & cost guardrails (§3.3).** **Threshold + gap, on app
   launch/focus.** The full coherence AI pass auto-fires when **≥5 new insights** since the last
   reconcile **OR** a **>14-day gap**, triggered on a renderer launch/focus hook (mirroring spec 36's
   `useUpdateChecks`). **Throttled to at most one automatic pass per 24h**; never auto-spends over
   budget / with AI off (skips silently). An **opt-out setting `memory.autoReconcile` (default ON)**.
   The manual **Refresh memory** always forces (ignores the throttle). The cheap category/`lifeArea`
   tagging keeps riding producer passes for free.
2. **Merge handling (§3.4 / §5.1).** **Confirm-before-apply.** Merges + contradiction-resolutions
   become **proposals** in Memory's existing **"Needs your review"** region (Merge / Keep both); the
   low-risk **confidence + category recalibration auto-applies**. `reconcileInsights` gains a
   **propose-only mode** that returns merge proposals instead of applying + deleting. (Q6 below
   folds into this: proposals live in the existing 20 "Needs your review" region — no separate area.)
3. **The goal entity model (§4.1).** **A new `goals/` store + `GoalSchema`** at
   `people/<id>/goals/<id>.enc` (clean separation). Status set: **`open` / `inProgress` / `done` /
   `stale` / `abandoned`**.
4. **"Stale / missed" detection (§3.1 / §4.3).** **Stale = past `due` OR (no `due`) untouched ≥21
   days** (`STALE_AFTER_DAYS = 21`). `stale` is **derived for display**; only **persisted when the
   user confirms** a status. Proactive surfacing elsewhere (Home / a session opener) stays **spec 40**;
   Memory shows stale **passively** with the gentle Still-on-it / Mark-done / Let-it-go affordance.
5. **Flagged-fact retraction detail (§4.2).** **Strip the share + a visible "sharing withdrawn"
   marker.** Flagging a fact inaccurate clears its `shareable`/`shareableWith` **and** stamps
   **`retractedShareAt`** so Memory can show "sharing withdrawn." An intake/portrait fact (not
   normally re-shareable) just has nothing to strip — same code path, no special case.
6. **Legacy-portrait retro-tagging (§4.5 / §1 C3).** **Yes — no-AI `SECTION_LIFE_AREA` fallback, run
   lazily during a reconcile pass.** A legacy untagged portrait's facts gain `lifeArea` from the 28
   fallback map (free, rougher) the next time reconciliation runs, so it topic-narrows like a fresh
   portrait. No extra AI spend.
7. **Goals in context (§5.2).** **Yes — a small bounded "open commitments" grounding line** in
   `summarizeForContext` so the coach is **aware** of open goals (grounding only; the proactive
   follow-up/nudging stays spec 40). Behind the same privacy filters, bounded like the rest of context.

## 12. Proposed build slices (after approval)

Each slice is independently shippable, gated, and tested (DoD §7); sequence after §11 is resolved.

1. **Cleanup (no AI, lowest risk):** `reapOrphanShares` on `deletePerson` + share-retraction on
   `flagInsightFact`, with the boundary E2E (delete-person reap; flag-retracts-share). Closes §1 C1/C2.
2. **Goals — backend:** `goalService` (extract + de-dup + status + stale) + the schema (per §11 Q2),
   wired into `sessionAnalysisService` (no new spend); `goals:*` IPC, gated + scoped. Unit-tested.
3. **Goals — UI:** the Memory Goals section + `GoalCard` + `goalStore` (per-person reset) + the
   status/close/edit flows; `/gallery` for any new chip. RTL + E2E + 360px guards.
4. **Automatic reconciliation:** `shouldAutoReconcile` + the renderer cadence (launch/focus hook) +
   `memory:refresh({auto})` + the "kept tidy" signal + (if §11 Q1 chooses) confirm-before-apply merge
   proposals. Budget/throttle guardrails; coordinate parsing tolerance with spec 37.
5. **(Optional, §11 Q5):** legacy-portrait retro-tagging.

(Depends on spec 20's reconciliation + Insight layer being in place — it is, on `main`. Spec 40
consumes slices 2–4's structured goals + clean memory.)

## 13. Changelog

- 2026-06-23 — §11 resolved with the owner (all recommendations confirmed) → **Approved**; build
  begins on `feat/living-memory-continuity`. Decisions: auto-reconcile on threshold(≥5)+gap(>14d) at
  launch/focus, 24h throttle, `memory.autoReconcile` opt-out (default on); confirm-before-apply merges
  (propose-only mode → "Needs your review"); a new `goals/` store + `GoalSchema`
  (open/inProgress/done/stale/abandoned); stale = past-due OR ≥21d untouched (derived, persist on
  confirm); flag strips share + `retractedShareAt`; legacy retro-tag via no-AI `SECTION_LIFE_AREA`
  during reconcile; bounded "open commitments" grounding line in `summarizeForContext`.
- 2026-06-23 — created (Draft). Part of the 2026-06 five-spec group (37–41). Grounded against
  `insightStore.ts` (`summarizeForContext`, `selectPortraitFacts`, `flagInsightFact`),
  `reconcileService.ts` (manual-only reconciliation, conservative merge, flagged-fact invariant),
  `sessionAnalysisService.ts` (goals emitted as plain `Goal:` facts), and `peopleService.deletePerson`
  (no `shareableWith` cleanup). Defines passive/automatic reconciliation, first-class tracked goals,
  cross-source coherence, and cleanup of orphaned shares + flagged-fact retraction. Open product/UX
  decisions (cadence, goal entity model, stale detection, retro-tagging, merge review, goals-in-context)
  in §11 — to resolve with the user before building.
