# 28 — Portrait synthesis & context-budget optimization

> **Status:** Draft · **Slice 28a built** 2026-06-21 (`feat/portrait-optimization`) · _last updated 2026-06-21_
>
> **Build split (decided 2026-06-21).** This spec ships in two slices: **28a — the safe wins (BUILT):** the
> slider-seed fix (an untouched optional slider records nothing) + a **synthesis fact cap** (the portrait
> stores at most **60** facts — user-chosen "fuller", from an unbounded 80–150) + a reworked prompt
> (prioritized, not "thorough dump") + `maxTokens` 8000→6000. **28b — topic-relevance selection (DEFERRED,
> its own slice):** the additive `InsightFact.lifeArea`, `selectPortraitFacts`, `ContextTopic` threaded
> through `summarizeForContext`/`buildContext` and the Session/Dream/Questionnaire callers — the
> privacy-critical part. 28a alone already bounds the pinned, every-call portrait to ≤60 facts; 28b further
> narrows it by topic. **Decisions for 28b (recorded):** synthesis cap 60 (done in 28a); the always-on CORE
> set is the **broader** option — identity (Values/identity), Goals & growth, Emotions & patterns,
> Relationships, Health & body, **plus any crisis-flagged fact** (never narrowed away).
>
> The onboarding portrait (the `source: 'intake'` Insight from [18-personal-onboarding](18-personal-onboarding.md))
> is PINNED into the system prompt of **every** Session, Dream analysis, and Questionnaire-generation call —
> emitting **all** of its facts with no per-fact cap, on the user's own paid Claude key. This spec makes the
> portrait **smaller and sharper**: it caps and prioritizes the synthesized fact set, tags each fact with a
> `LifeArea` so callers can pull only the **relevant** subset per call, fixes the optional-slider auto-seed that
> pollutes the portrait with false-neutral signals, and bounds re-synthesis cost. It is **additive and
> migration-safe** — existing portraits/insights parse unchanged, and an untagged fact is treated as core/always
> relevant.

This belongs to the onboarding-redesign spec group: **26** (non-intimacy intake catalog redesign), **27**
(intimacy block redesign), **28** (this — portrait synthesis & context budget), **29** (progressive
profile-building). It builds on [18](18-personal-onboarding.md) (the intake + portrait), and touches the
context paths shared by [16-guided-sessions](16-guided-sessions.md), [08-questionnaires](08-questionnaires.md),
[12-dreams](12-dreams.md), [15-shareability](15-shareability.md), [20-memory-dashboard](20-memory-dashboard.md),
and the metering of [06-ai-usage-and-budgets](06-ai-usage-and-budgets.md).

---

## 1. Overview

SelfOS's "memory" of a person is, foundationally, the **onboarding portrait** — one auto-approved Insight with a
`facts: InsightFact[]` array, produced by `synthesizePortrait` in
[`packages/core/src/intake/intakeService.ts`](../../packages/core/src/intake/intakeService.ts). It is **PINNED**
into context: in [`summarizeForContext`](../../packages/core/src/insights/insightStore.ts) the intake insight is
sorted first and the `MAX_OWN_INSIGHTS = 12` cap limits the **number of insights**, but the portrait emits **every
one of its facts** with **no per-fact cap**. `MAX_SHARED_FACTS_PER_PERSON = 5` bounds only **related people's**
facts.

Every coaching surface assembles context through
[`buildContext`](../../packages/core/src/people/buildContext.ts) → `summarizeForContext`:

- **Sessions** — `buildSystemPrompt` ([`promptBuilder.ts`](../../packages/core/src/conversations/promptBuilder.ts)).
- **Dream analysis** — `buildDreamPrompt` ([`dreamAnalysisService.ts`](../../packages/core/src/dreams/dreamAnalysisService.ts)).
- **Questionnaire generation** — the context-provider registry
  ([`questionnaires/contextProviders.ts`](../../packages/core/src/questionnaires/contextProviders.ts)).

So the **entire** portrait fact list is re-sent in the system prompt of every one of those calls. Today's synthesis
prompt (`PORTRAIT_INSTRUCTION`, ~line 480) explicitly tells the model to produce a "THOROUGH set" and to "Prefer
many precise facts over a few vague ones" at `maxTokens: 8000`. The redesign in specs 26/27 cuts question
**volume**, but a comprehensive intake can still yield **80–150 facts**. Pinned on every call, that is:

1. **A large fixed token tax** the user pays on their own key, on every Session, Dream, and Questionnaire-generation
   turn, forever — independent of whether those facts are relevant to the topic at hand.
2. **A diluted signal** — the coach can't prioritize: a budgeting chat is handed the person's full sexual history,
   childhood, dream symbols, and faith alongside their money facts, and a relationship session is handed their work
   schedule. Fewer, **relevant** facts are both **cheaper** and **sharper**.

This spec solves (1) and (2) without weakening the portrait's role as the foundational, always-on picture of the
person, and without touching the `restricted`-fact (18 §8.4) or shareable-vs-private (15) privacy invariants.

## 2. Goals / Non-goals

**Goals**

- **Bound the portrait.** Introduce a **portrait-fact budget** (a cap on the synthesized fact count) and rework
  `PORTRAIT_INSTRUCTION` to favour **fewer, higher-signal** facts (reversing "prefer many"). A small **always-on
  core** of identity facts is always in context; the rest is topical.
- **Per-fact life-area tagging.** Tag each `InsightFact` with a `LifeArea` (additive-optional). The synthesis call
  assigns them (no extra spend — folded into the one existing call, the §18/§20 precedent).
- **Relevance-based selection.** A new selector chooses the portrait fact subset per call from the **call-type/topic
  signal** (the guide/session type, the questionnaire target type, the dream's linked life-areas) plus the always-on
  core — instead of dumping all facts. The **PINNED foundational portrait summary** is always emitted.
- **Slider-seed fix.** An untouched **optional** slider is **UNANSWERED** (commits no value), so the portrait is not
  polluted with false-neutral midpoint signals. Touches `@selfos/answering` + the intake's `isAnswered`/`answerToString`
  handling.
- **Bounded, metered re-synthesis.** Re-synthesis cost scales with answer volume; bound the synthesis input and keep
  it metered under the existing `intake.synthesize` usage type.
- **Additive + migration-safe.** Existing portraits/insights parse unchanged; per-fact `lifeArea` absent ⇒ treated as
  **core / always-relevant**; the legacy "emit everything" behaviour is the fallback when no facts are tagged.

**Non-goals**

- **No new Insight producer or schema rewrite.** The portrait stays one `source: 'intake'` Insight (18 §4.1); we add
  one optional field to `InsightFact`, not a new file type.
- **Not a re-architecture of `summarizeForContext`'s related-people path.** `MAX_SHARED_FACTS_PER_PERSON` and the
  shareable-vs-private boundary are unchanged; this spec changes only how the **own** intake portrait facts are
  selected.
- **Not a UI feature.** There is no new screen and (by default) no new setting; the budget numbers are constants
  surfaced as open questions (§11), not user-facing controls. (One optional Settings toggle is raised in §11.)
- **Not a change to which surfaces feed.** Sessions, Dreams, Questionnaire-generation still feed; we change **how
  much** and **which** facts each receives.
- **Does not redesign the intake catalog** (specs 26/27) — it consumes their reduced question set.

## 3. UX & flows

This is a **foundational/core spec** — its surface is developer-facing (the context-builder API, the synthesis
prompt, and the answering control). The two things a **user** perceives:

1. **Sharper, cheaper coaching.** A Session/Dream/Questionnaire reply is grounded in the facts relevant to that
   topic, and the per-turn token cost (visible in the usage ring / Usage dashboard, 06) is lower. No interaction
   changes.
2. **The slider fix.** During onboarding (and any `@selfos/answering` form), an **optional** rating/slider the
   person never touches now records **nothing** — it does not pre-fill a midpoint that later reads as a deliberate
   "neutral" answer. A **required** scale is unchanged (already not auto-seeded — see the SliderControl comment in
   [`QuestionnaireForm.tsx`](../../packages/answering/src/QuestionnaireForm.tsx) ~line 99). Visually, an untouched
   optional slider shows its thumb at the midpoint as a **starting position** but the value stays uncommitted until
   moved.

### 3.1 Selection flow (the core mechanism)

When any surface builds context:

```
caller (Session guideId / Questionnaire targetType / Dream linked life-areas)
   │  passes a ContextTopic { lifeAreas?: LifeArea[] }   (optional — absent ⇒ no topical filtering)
   ▼
buildContext(fs, key, personId, topic?)
   ▼
summarizeForContext(fs, key, personId, related, topic?)
   ▼
selectPortraitFacts(intakeInsight, topic)   ← the new selector
   • always include the always-on CORE facts (tagged a core life-area or untagged)
   • include topical facts whose lifeArea ∈ topic.lifeAreas
   • cap total at PORTRAIT_FACT_CONTEXT_BUDGET
   • ALWAYS emit insight.summary (the PINNED foundational portrait)
```

**No topic ⇒ graceful default:** when a caller passes no topic (the legacy call shape), the selector returns the
**core facts + a recency/priority-ordered fill up to the budget** — never silently the whole list. This keeps every
existing caller working while still bounding the payload (§7).

## 4. Data model (vault files & schemas)

This spec adds **one optional field** to an existing schema. No new files; all reads/writes stay through the vault
service / the `@selfos/core` insight + intake stores (no direct `fs`).

### 4.1 `InsightFact.lifeArea` (additive-optional)

In [`packages/core/src/schemas.ts`](../../packages/core/src/schemas.ts), extend `InsightFactSchema`:

```ts
export const InsightFactSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  shareable: z.boolean(),
  shareableWith: z.array(z.string()).optional(),
  restricted: z.boolean().optional(),
  flaggedInaccurate: z.boolean().optional(),
  flaggedAt: z.string().optional(),
  // 23 — the fact's life-area, from the fixed LIFE_AREAS taxonomy (same set the Insight-level `categories`
  // uses). Drives per-call relevance selection. Additive-optional: a pre-28 fact has none ⇒ treated as CORE
  // (always relevant). The value is normalized to LIFE_AREAS server-side, never trusted raw from the model.
  lifeArea: z.string().optional(),
});
```

- **Why a string, not the `LifeArea` enum** — consistency with `Insight.categories` (also `z.array(z.string())`,
  normalized via `normalizeCategories`); the model may echo a near-miss and we normalize it, never reject the fact.
- **`schemaVersion`** — `Insight.schemaVersion` stays **1**. The field is additive-optional, so existing portraits,
  session/dream/questionnaire insights, and `cryptoCompat` fixtures parse byte-for-byte unchanged. **No migration
  function.** (The §18 / §20 additive precedent.)

### 4.2 The fact-budget constants (code, not vault)

New constants in [`insightStore.ts`](../../packages/core/src/insights/insightStore.ts) (proposed values — see §11):

```ts
/** Max intake-portrait facts emitted into ANY single coaching context (the per-call budget). Replaces the
 *  current "emit every portrait fact" behaviour. Recency/priority/topical-relevance ordered. */
const PORTRAIT_FACT_CONTEXT_BUDGET = 30; // §11 Q1 — tunable

/** Facts always present regardless of topic — the person's identity/foundational set (core life-areas or
 *  untagged). Counts toward the budget; the remainder of the budget is filled by topical facts. */
const PORTRAIT_CORE_FACT_BUDGET = 12; // §11 Q2 — tunable
```

And the **synthesis cap** in [`intakeService.ts`](../../packages/core/src/intake/intakeService.ts):

```ts
/** Max facts the synthesis call should PRODUCE for the portrait (the prompt asks for "the most important",
 *  not "everything"). The selector still budgets at context time; this keeps the stored portrait sharp. */
const PORTRAIT_FACT_SYNTHESIS_BUDGET = 60; // AS BUILT (28a) — user chose "fuller" (was proposed 40)
```

### 4.3 The relevance topic type (a view type, crypto-free)

A small input type carried through `buildContext` → `summarizeForContext` (defined in `schemas.ts`, the crypto-free
shim, so the renderer/IPC may reference it):

```ts
/** 23 — the call-type/topic signal a caller passes so context selects the relevant portrait facts. All
 *  fields optional: an empty/absent topic ⇒ core + priority-fill (no topical narrowing). */
export const ContextTopicSchema = z.object({
  lifeAreas: z.array(z.string()).optional(), // the LifeAreas relevant to this call
});
export type ContextTopic = z.infer<typeof ContextTopicSchema>;
```

### 4.4 Mapping a caller to life-areas

The topic signal comes from data the caller already holds — no new persisted state:

| Caller                     | Signal source                                                                              | → `lifeAreas`                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Session (guided)**       | The `GuidedExercise.group` (`therapy`/`coaching`/`intimacy`) + `framework` (16 §3.2)       | A static `GUIDE_LIFE_AREAS` map in `guidedCatalog.ts` (e.g. intimacy group → `Intimacy`, `Relationships`) |
| **Session (free-start)**   | None at start                                                                              | `undefined` ⇒ core + priority-fill                                                                        |
| **Dream analysis**         | The dream's linked-people relationships + dream tags (12), and any reconciled `categories` | Map dream tags/linked relationships → life-areas; else `undefined`                                        |
| **Questionnaire generate** | The questionnaire `type` taxonomy (08 §3.1 — e.g. intimacy/relationship/general)           | A static `QUESTIONNAIRE_TYPE_LIFE_AREAS` map                                                              |

Each map is a **pure, code-only constant** co-located with its caller (DRY: the life-area taxonomy is the single
`LIFE_AREAS` in `schemas.ts`). A caller with no clear signal passes no topic — the safe default.

## 5. Architecture & modules

No new feature module (this is core + one shared answering control). Changes by file:

### 5.1 `packages/core/src/intake/intakeService.ts` — synthesis

- **Rework `PORTRAIT_INSTRUCTION`** (~line 480): reverse "Prefer many precise facts over a few vague ones" →
  request **"the most important, highest-signal facts — at most `PORTRAIT_FACT_SYNTHESIS_BUDGET`"**, and ask the
  model to assign **each fact a `lifeArea`** from `LIFE_AREAS` (alongside the existing `section`). The portrait
  `summary` stays comprehensive (it's the PINNED foundational paragraph, cheap relative to the fact list).
- **`PortraitDraftSchema`** — add `lifeArea: z.string().optional()` to the per-fact object.
- **`synthesizePortrait`** — when building each `InsightFact`, set `lifeArea: normalizeFactLifeArea(f.lifeArea, f.section)`
  (a new helper: normalize the model's value against `LIFE_AREAS`; if absent, derive a best-effort life-area from the
  `section` id via a static `SECTION_LIFE_AREA` map; else leave undefined ⇒ core). **Cap stored facts** at
  `PORTRAIT_FACT_SYNTHESIS_BUDGET` (truncate after the model returns, keeping the model's own ordering).
- **Re-synthesis carry-forward** — the existing `priorByText` map (carries `shareable`/`shareableWith`) also carries
  `lifeArea` forward so a re-synthesis doesn't lose a reconciled tag. **`restricted` is still decided server-side**
  from the trusted catalog (`sectionRefRestricted`) — never the model, never the new field.
- **`maxTokens`** — lower from `8000` toward a bounded value sized for `PORTRAIT_FACT_SYNTHESIS_BUDGET` facts +
  summary (e.g. `~4000`; §11 Q4). Keeps the adaptive-thinking budget honest (the `[[adaptive-thinking-shares-maxtokens]]`
  lesson — synthesis already uses `extendedThinking` off via the bounded structured-JSON call).
- **Re-synthesis input bound (§4 cost)** — `transcriptMessages` + `formAnswersMessages` are the synthesis input;
  with specs 26/27 trimming questions this shrinks, but to bound the worst case, **truncate per-section transcript
  length** to a cap (keep the most recent N turns per chat section) before sending. The form answers are already
  compact key:value lines. Metering is unchanged (`intake.synthesize`, metered **before** parse).

### 5.2 `packages/core/src/insights/insightStore.ts` — selection

- **New `selectPortraitFacts(intakeInsight, topic?, now?)`** (pure, exported, unit-tested):
  1. Partition the intake insight's live facts (already filtered for `flaggedInaccurate`) into **core**
     (`lifeArea` ∈ `CORE_LIFE_AREAS` **or** untagged) and **topical**.
  2. Take core facts up to `PORTRAIT_CORE_FACT_BUDGET`.
  3. If `topic.lifeAreas` is present, add topical facts whose `lifeArea` ∈ `topic.lifeAreas`.
  4. If still under `PORTRAIT_FACT_CONTEXT_BUDGET`, fill with remaining facts in priority order (recency of the
     insight + stable fact order). Cap the total at `PORTRAIT_FACT_CONTEXT_BUDGET`.
  5. **Legacy fallback:** if **no** fact has a `lifeArea` (a pre-28 portrait), return the first
     `PORTRAIT_FACT_CONTEXT_BUDGET` facts in order — bounded, but no narrowing (we can't narrow what isn't tagged).
- **`summarizeForContext`** gains an optional `topic?: ContextTopic` parameter. The PINNED portrait branch now:
  always pushes `insight.summary` (unchanged), then pushes **`selectPortraitFacts(...)`** instead of all facts. The
  related-people path (`MAX_SHARED_FACTS_PER_PERSON`) and the privacy filters (`restricted`/`flaggedInaccurate`/
  `shareable`) are **untouched** — selection happens **after** the existing privacy filtering, never around it. The
  non-intake `rest` insights still use `MAX_OWN_INSIGHTS` and emit all their facts (they're already small).
- **`CORE_LIFE_AREAS`** — a small constant subset of `LIFE_AREAS` deemed always-relevant identity (e.g.
  `['Values & beliefs', 'Goals & growth', 'Emotions & patterns']`; §11 Q3 leaves the exact set open). Anything
  untagged is also treated as core (safe default — never hide an unclassified fact).

### 5.3 `packages/core/src/people/buildContext.ts` — threading the topic

- `buildContext(fs, key, personId, topic?)` accepts and forwards `topic` to `summarizeForContext`. All existing
  callers that pass no topic compile unchanged (optional param).
- `intakeService.synthesizePortrait` calls `buildContext(fs, key, personId)` (no topic) — correct, since the portrait
  synthesis isn't topic-scoped.

### 5.4 Callers (thread the signal)

- `promptBuilder.buildSystemPrompt` — derive `topic` from the `guideId`'s `GUIDE_LIFE_AREAS`; pass it into
  `buildContext`.
- `dreamAnalysisService.buildDreamPrompt` — derive `topic` from the dream's linked life-areas / tags.
- `questionnaires/contextProviders.ts` — derive `topic` from the questionnaire type.

These are the only behavioural changes to the consuming surfaces; their prompts otherwise stay identical (16/12/08).

### 5.5 `packages/answering/src/QuestionnaireForm.tsx` + `packages/core/src/questionnaires/answering.ts` — slider fix

- **`SliderControl`** — remove the `useEffect` that commits `middle` on mount for an **optional** question
  (~lines 99–101). The thumb still **displays** at `middle` as a starting position (`current` fallback unchanged),
  but the value stays **uncommitted** until the person moves the slider. A **required** scale is already not seeded —
  unchanged.
- **`isAnswered`** (already correct: `rating`/`slider` answered only when the value is a finite number — line 88) —
  no change needed, but add a test asserting an **untouched optional** slider reports **unanswered**.
- **Intake `answerToString`** ([`intakeService.ts`](../../packages/core/src/intake/intakeService.ts)) — already skips
  `undefined`; confirm a never-touched optional slider contributes **no `formAnswersMessages` line** (so no
  false-neutral fact reaches synthesis). Add a test.

## 6. IPC / API contracts

- **No new IPC channel.** The new `ContextTopic` is derived **host-side** in `buildContext`'s callers (which already
  run in `@selfos/core`, invoked by the bridge); the renderer never constructs it. The Claude calls are unchanged in
  shape — only the **system-prompt content** (fewer portrait facts) and the synthesis prompt/`maxTokens` differ.
- **Claude — synthesis (`intake.synthesize`):** same call site, reworked `PORTRAIT_INSTRUCTION`, the per-fact
  `lifeArea` added to the returned JSON, `maxTokens` lowered (§5.1). Bounded structured-JSON, `extendedThinking` off,
  metered **before** parse (unchanged; the `[[adaptive-thinking-shares-maxtokens]]` rule). A malformed/over-budget
  synthesis degrades exactly as today (`NO_KEY`/`BUDGET`/`ERROR`).
- **Claude — coaching surfaces (Sessions/Dreams/Questionnaire-gen):** unchanged channels; the system prompt they
  build is now **smaller**. No retry/limit changes.

## 7. States & edge cases

- **Pre-23 portrait (no `lifeArea` on any fact).** Legacy fallback in `selectPortraitFacts`: emit the first
  `PORTRAIT_FACT_CONTEXT_BUDGET` facts in order — **bounded**, no narrowing. A re-synthesis (or the next "Refresh
  memory", 20) re-tags facts, enabling topical selection thereafter.
- **No topic passed (free-start session, untyped questionnaire, dream with no linked life-areas).** Core +
  priority-fill up to the budget; **never the whole untagged list**.
- **Portrait smaller than the budget.** Emit all of it (the cap is a ceiling, not a target). Behaviour matches today
  for small portraits.
- **All facts in one life-area** (e.g. a very intimacy-heavy portrait). Core + topical selection still applies; if the
  budget can't fit all relevant facts, priority order decides — no crash, no overflow.
- **A `restricted` fact (18 §8.4).** Selection runs **after** the existing privacy filters in `summarizeForContext`;
  a restricted fact still feeds **only the subject's own** context (own path keeps them) and is **never** broadcast to
  related/linked people. The selector never lifts a restriction — it can only **omit** a fact, never **add** one past
  the filters. (Verified by §10 boundary tests.)
- **A `flaggedInaccurate` fact (20 §3.6).** Already excluded before selection — the selector operates on the live
  set, so a flagged fact is never selected.
- **Re-synthesis loses a reconciled tag.** Prevented: `lifeArea` is carried forward by text in `priorByText`
  (§5.1), so a manual edit/reconcile tag survives re-synthesis.
- **Model returns an unknown/blank `lifeArea`.** `normalizeFactLifeArea` falls back to the `section`-derived area, or
  leaves it undefined ⇒ the fact is **core** (always relevant — safe, never hidden).
- **Slider — required question untouched.** Unchanged: stays unanswered (already not auto-seeded), so a required
  intimacy rating can't silently default to the midpoint.
- **Slider — optional question moved then cleared.** Once committed, the value is a real number; the person can move
  it. (We only stop the **auto-commit on mount**.)
- **Sync conflict / corrupt insight file.** Handled by the vault service exactly as today (00 §4.3); selection is a
  pure transform over an already-validated `Insight`. A corrupt insight surfaces a typed error before selection.
- **Migration:** none required (§4.1). A pre-28 insight read alongside a post-23 one mixes fine — the selector treats
  untagged facts as core.

## 8. Safety

This touches wellbeing/conversation context, so the boundary is explicit:

- **The not-medical boundary is unchanged.** `PERSONA` + `SAFETY` lead every system prompt (promptBuilder); we only
  reduce the **portrait facts** appended after them. Crisis routing is unaffected — `crisisFlag` lives on the Insight,
  and the Session/Dream surfaces keep their crisis handling (05/12).
- **Restricted & private facts (18 §8.4, 15).** The selector **cannot weaken** these invariants: it runs **after**
  the `restricted`/`shareable`/`flaggedInaccurate` filters and can only **drop** facts. A restricted intimacy/trauma
  fact still feeds **only the subject's own** coaching and **never** another person's context — selection narrowing
  must never become a path that surfaces a withheld fact (a §10 test asserts the boundary holds with and without a
  topic). This is **defense in depth**: the privacy filter is the trust boundary; selection is a budget on top of it.
- **Crisis facts are core.** A `crisisFlag`-bearing portrait, and any fact in `Emotions & patterns` (a `CORE_LIFE_AREA`),
  is always-on — a topical narrowing never **hides** a distress signal from the coach. (§11 Q3 confirms the core set
  includes the emotional/safety life-area.)
- **Sensitive content.** The slider fix **removes** false-neutral data; it never adds sensitive content. No new
  content is sent to Claude — strictly less.

## 9. Accessibility

- **Slider control.** The change is value-commit timing only; the existing `SliderControl` markup, labels
  (start/mid/end tri-labels, 18 §14.5), keyboard operation (native `<input type="range">`), and focus behaviour are
  unchanged. The visible thumb still starts at the midpoint as an orientation cue; screen-reader value announcement is
  unaffected (the input's `value` still reflects the displayed position). No new contrast/motion concerns. Ties to
  [01-design-system](01-design-system.md) standards.
- **No new UI** otherwise — the context-selection and synthesis changes are non-visual.

## 10. Testing strategy

Vault is exercised via the core in-memory `memFileSystem` fake; Claude via the deterministic fake `ClaudeClient`
(00 §11). Key cases:

**Unit (Vitest, node)**

- `selectPortraitFacts`:
  - returns core facts + topical facts for a given topic, capped at `PORTRAIT_FACT_CONTEXT_BUDGET`.
  - **no topic** ⇒ core + priority-fill, never the whole list.
  - **legacy (no `lifeArea` on any fact)** ⇒ first-N bounded fallback.
  - a topical fact for a **non-matching** topic is **omitted**; an untagged fact is **always** included (core).
  - **boundary:** a `restricted`/`flaggedInaccurate` fact is never selected (operates on the pre-filtered set).
- `summarizeForContext` with a `topic`: the PINNED `summary` is always emitted; the portrait fact lines are the
  selected subset; related-people facts (`MAX_SHARED_FACTS_PER_PERSON`) and the shareable-vs-private filtering are
  **unchanged** (regression test against 15 §10 truth-table).
- `normalizeFactLifeArea`: model value normalized to `LIFE_AREAS`; unknown ⇒ section-derived; blank ⇒ undefined/core.
- `synthesizePortrait`:
  - stores ≤ `PORTRAIT_FACT_SYNTHESIS_BUDGET` facts, each with a normalized `lifeArea`.
  - **re-synthesis carries `lifeArea` (and `shareable`/`shareableWith`) forward** by text.
  - `restricted` still decided from the catalog, never the model's `lifeArea`.
  - metered (`intake.synthesize`) **before** parse even when the draft fails validation.
  - **migration-safe:** a pre-28 stored portrait (facts without `lifeArea`) parses and feeds context via the legacy
    fallback.
- `isAnswered` / `answerToString`: an **untouched optional** slider ⇒ unanswered ⇒ contributes **no**
  `formAnswersMessages` line.

**Component (Vitest + RTL)**

- `SliderControl`: mounting an **optional** scale commits **no** value (no `onChange` fired on mount); moving it
  commits a number. A **required** scale stays unseeded (unchanged) and gates Finish via `unansweredRequired`.

**E2E (Playwright + Electron)**

- Onboarding: skip past an optional intimacy slider without touching it → finish → **decrypt the vault** and assert
  the portrait Insight has **no** false-neutral fact from that slider, and the synthesized facts carry `lifeArea`
  tags.
- Sessions/Dreams/Questionnaire-gen: start an **intimacy** guided session vs a **money/coaching** one and assert (via
  the fake Claude capturing the system prompt) that each receives the **relevant** portrait subset + the core set,
  and that the portrait **summary** is always present. (Content-correctness check, per §7 DoD.)
- A cross-user privacy guard (20 slice-1 style): a topical narrowing never surfaces another person's restricted/
  withheld fact — decrypt-assert the boundary holds with a topic set.

## 11. Open questions

These are the genuinely-tunable numbers and signal-source choices — **do not assume**; resolve with the user before
building.

1. **The portrait-fact budgets.** Proposed: `PORTRAIT_FACT_CONTEXT_BUDGET = 30` (per-call ceiling) and
   `PORTRAIT_FACT_SYNTHESIS_BUDGET = 40` (stored ceiling). Are these the right magnitudes, or do you want
   smaller/larger? Should the context budget be **fixed** or scale with the topic count?
2. **The always-on core size.** Proposed `PORTRAIT_CORE_FACT_BUDGET = 12`. How many identity facts should ride on
   **every** call regardless of topic?
3. **Which life-areas are `CORE_LIFE_AREAS`** (always-on)? Proposed `['Values & beliefs', 'Goals & growth',
'Emotions & patterns']` (so a distress/emotional signal is never narrowed away). Confirm the set — especially that
   the **emotional/safety** life-area is included.
4. **Synthesis `maxTokens`.** Proposed lowering `8000 → ~4000` to match the smaller fact target. Confirm, or keep
   headroom?
5. **The relevance-selection source.** Confirmed sources: guided-session `group`/`framework` (16), questionnaire
   `type` (08), dream linked life-areas/tags (12). **For a free-start (unguided) Session there is no topic signal at
   start** — accept the core+fill default, or should we **infer** a topic from the first user message (an extra
   classification step / cost)? (Recommendation: accept the default; no extra spend.)
6. **An optional Settings toggle?** Should there be a (default-on) `memory.relevantFactsOnly` setting so a user can
   force the full portrait into every call, or is the bounded/relevant behaviour always-on with no toggle?
   (Recommendation: always-on, no toggle — fewer knobs; the budget is generous.)
7. **Re-synthesis transcript truncation cap** (§5.1) — how many recent turns per chat section to keep when bounding
   the synthesis input? (Recommendation: a generous per-section turn cap; specs 26/27 already cut volume.)

## 12. Changelog

- 2026-06-21 — created (Draft). Part of the onboarding-redesign spec group (26–29).
- 2026-06-21 — **Slice 28a built** (`feat/portrait-optimization`, stacked on 26/27, NOT merged). The two
  low-risk "safe wins": (1) **slider-seed fix** — `@selfos/answering` `SliderControl` no longer auto-commits
  the midpoint for an untouched optional slider (the thumb still shows at middle as a starting position, but
  the value stays uncommitted until moved), so an untouched "energy/stress/…" slider records **nothing** and
  never becomes a false-neutral portrait fact; required scales were already never seeded. (2) **synthesis fact
  cap** — `PORTRAIT_FACT_SYNTHESIS_BUDGET = 60` (user chose "fuller"): the prompt was reworked from "a THOROUGH
  set… prefer many facts" → "the MOST IMPORTANT, highest-signal facts, AT MOST 60… prefer fewer sharp facts",
  the stored portrait is hard-capped at 60 keeping the model's ordering (so a model that ignores the cap can't
  bloat the pinned, every-call portrait), and `maxTokens` dropped 8000→6000. The portrait **summary** stays
  comprehensive. **Code-reviewer caught a blocker (fixed):** lowering `maxTokens` while adaptive thinking was
  still ON (the synthesis call never passed `extendedThinking`) would shrink the COMBINED thinking+output
  budget → portrait-JSON truncation the offline fake can't catch (the `[[adaptive-thinking-shares-maxtokens]]`
  trap). Now the bounded synthesis call passes **`extendedThinking: false`** (the generationService/
  reconcileService precedent), so 6000 is a true output ceiling; a test pins it. **Deferred to 28b** (its own slice): `InsightFact.lifeArea`, `selectPortraitFacts`, the
  `ContextTopic` threading + caller maps, and the per-call context budget — the privacy-critical
  `summarizeForContext` change. Tests: +core fact-cap (80 facts → stored 60, order preserved), +RTL
  untouched-optional-slider-commits-nothing/commits-on-move. Gate: typecheck (node + web), lint, format,
  **446 core + 534 desktop + 11 relay** unit, onboarding E2E green. Same group-numbering note as 26/27.
