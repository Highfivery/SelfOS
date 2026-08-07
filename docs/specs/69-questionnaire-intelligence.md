# 69 — Questionnaire Intelligence — the adaptive, evolving generation engine

> **Status:** Approved · _last updated 2026-08-07_
>
> A per-person **Personalization Profile** and a single **generation engine** that make SelfOS's AI
> questionnaires genuinely smart, dynamic, and evolving: they learn what a person doesn't want asked
> (skips/declines, differentiated by reason), notice when a person has _changed their mind_, keep a
> living map of which life areas are covered vs. unexplored (so they steer to new ground and never
> re-mine), personalize from the recipient's whole self (their own data — and, for self/auto sends, a
> partner's shared facts, including reciprocity between two people), and route **every** generation
> path — the manual builder, auto check-ins, Your Story's biographer, dream questionnaires, and email
> embedded check-ins — through one shared topic-selection + de-dup + feedback layer instead of five
> divergent ones. It is the intelligence layer that consolidates and completes the long
> [`08 §16–§28`](08-questionnaires.md) generation history.

This **amends and consolidates** [`08`](08-questionnaires.md) (the generation stack, de-dup, gap-finder,
context providers, analysis → Insight, the skip/decline model §25, intimacy coverage §27, the covered-topics
lever §28) and **reuses, does not duplicate**, its machinery. It feeds and is fed by
[`63`](63-auto-checkins.md) (the autonomous engine), [`64`](64-your-story.md) (the biographer gap pass),
[`67`](67-email-engagement.md) (email suggestions / embedded check-ins), [`49`](49-intimacy-activities-inventory.md)
(the categorized intimacy inventory), [`50`](50-self-assessments.md) (test subscales), [`58`](58-together-couples-sessions.md)
(couples dynamics), and [`42`](42-relationship-scoped-sharing.md)/[`43`](43-relationship-scoped-onboarding-sharing.md)
(the shareable / relationship-type boundary). It references [`06`](06-ai-usage-and-budgets.md) (metering +
budgets), [`39`](39-living-memory-continuity.md) (the reconcile cadence + change signals), [`00`](00-architecture.md)
(vault/IPC/security), and [`01`](01-design-system.md) (primitives/tokens) rather than restating them (DRY).
Much of this spec is **developer-facing** (a core artifact + a shared engine); the one user-facing surface
is a light transparency panel (Phase 5, §3.4).

---

## 1. Overview

### 1.1 Background — the problem, from a deep code audit

SelfOS's questionnaire generation is not smart, dynamic, personalized, or evolving _enough_. It has been
patched a dozen times ([`08 §16–§28`](08-questionnaires.md)) — each fix improving the DATA fed to one path,
none addressing the structural gaps below. Concretely:

- **Skip/decline is a black hole.** A per-question decline
  (`DeclinedAnswer = { declined: true; reason? }`, an `Answer.value` arm —
  `packages/core/src/questionnaires/answering.ts`) carries three differentiated presets
  (`SKIP_REASON_PRESETS`): **"Not clear — needs more context"** (`UNCLEAR_SKIP_REASON`),
  **"Doesn't apply to me"** (not right about me), **"Prefer not to say"**, plus free text. But **generation
  never reads them.** Every consumer only _excludes_ declines — `recipientHistory.ts`
  (`gatherRecipientPriorAnswersByAssignment` drops `isDeclined`), `aggregate.ts`/`trends.ts` (dropped from
  distributions), `analysisService.ts` and `alignmentService.ts` (never inferred into a fact).
  [`08 §25.5`](08-questionnaires.md) documents that "Not clear" _should_ feed the de-dup/learning bundle —
  **it was never wired.** The system cannot learn what a person doesn't want asked, or that a question
  landed wrong.
- **No "changed their mind" detection.** The raw material exists — numeric re-ask trends
  (`ResponseSet.reAskOf`/`revision` → `buildQuestionTrends` in `trends.ts`), `InsightFact.flaggedInaccurate`
  corrections, and superseded facts across re-analyzed insights — but **nothing computes "used to say X, now
  Y,"** and none of it reaches generation. A person who has plainly shifted (their desire, their goals, their
  stance) is never asked _"you've moved on this — what changed?"_.
- **De-dup rests on one fail-open AI call.** Layer 1 (`isNearDuplicate`, `dedup.ts`) compares candidate
  **prompts** vs. previously-asked **prompts** only — never the person's **answers** or **insight facts**.
  Layer 2 (`semanticDedup.ts`, `semanticDedupFilter`) is the only layer that catches a reworded re-ask of
  prior answers, and it is **fail-open** (keeps everything on AI-off / over-budget / unparseable-after-retry /
  empty-`[]`) and sets a `degraded` flag that (until [`08 §28.4`](08-questionnaires.md), partially) nothing
  consumed. Its reference is hard-truncated (`buildDedupReference` in `recipientHistory.ts`: onboarding 14k /
  prior answers 4k / insight facts 3k / prompts 2k / covered-topics 2k; overall ceiling
  `MAX_REFERENCE_CHARS = 24000`, top-15 insights, 5 facts each), so a **long-history person's later material
  silently drops out and gets re-asked.**
- **No topic-coverage / novelty model outside intimacy.** Only `intimacy/coverage.ts`
  (`buildIntimacyCoverage`) structurally forces new ground — a map over the 14 `INTIMACY_CATEGORIES` with
  `SATURATION_ASKS = 3` and four re-open signals — and it is keyword-fragile (`CATEGORY_KEYWORDS`).
  **General / relationship / scenario / feedback / etc. types have NO per-topic memory**; novelty depends only
  on the soft prompt + the fail-open semantic pass. The Home gap-finder (`suggestQuestionnaires`,
  `gapFinderService.ts`) passes **no history and no avoid-list at all**.
- **Generation context is narrower than coaching context.** Generation uses profile + relationship register +
  distilled insight _summaries_ (`contextProviders.ts` — `profilesProvider`/`relationshipsProvider`/
  `insightsProvider`). For **self / auto** check-ins it does **not** reach a partner's shared facts (only when
  the partner _directly_ authors for the person). Test subscale **numbers** ([`50`](50-self-assessments.md)),
  **Together** couples-dynamics ([`58`](58-together-couples-sessions.md)), and prior **raw answers as positive
  personalization** are gathered-but-unused (answers are treated as dedup fodder, never "build on what they
  said").
- **Fragmentation — four (really five) divergent topic-selection mechanisms.** The questionnaire gap-finder
  (`suggestQuestionnaires`), Your Story's McAdams biographer gap pass (`runGapPass`,
  `story/storyInterviewService.ts`), dream-synthesis proposals (`mintDreamQuestionnaires`,
  `dreams/dreamQuestionnaireService.ts`), and email's own one-sentence composer (`generateSuggestion`,
  `email/emailSuggestionService.ts` — which wraps a hard-coded Yes/Somewhat/Not-really check-in with its own
  `buildAvoidSet` de-dup universe). "Covered topics" ([`08 §28.3`](08-questionnaires.md)) de-dup only works in
  the manual builder — auto check-ins, story, and dreams silently ignore it, and email is a **fully siloed**
  de-dup universe. Improving one path does not improve the others.

### 1.2 The shape of the fix

This spec introduces **one artifact and one engine**:

1. A **per-person Personalization Profile** (§4) — a persisted, encrypted per-person record that _every_
   generation path reads and _every_ answer/skip/insight-change updates. It holds a **coverage map** (all life
   areas, generalized from `intimacy/coverage.ts`), a **feedback ledger** (skips/declines keyed by topic and
   reason), a **change log** (numeric + semantic shifts, tagged explored/unexplored), and **relational
   signals** (partner-shared facts relevant to this person + reciprocity candidates).
2. A **unified generation engine** (§5) — one shared topic-selection + de-dup + feedback layer
   (`planGeneration`) that all five paths route through, before drafting via the existing `generateQuestions`.

Both preserve the durable [`08 §24.5`](08-questionnaires.md) privacy override (tailoring may use ALL of the
recipient's **own** data, scoped strictly to generation) and the [`08 §17.4`](08-questionnaires.md)
author-blind **output** boundary (the model never gratuitously quotes raw sensitive facts; only generated
questions come back). Restricted facts belonging to _other_ people never cross (§8).

## 2. Goals / Non-goals

**Goals**

- **Learn from skips/declines.** Persist and _read_ the differentiated skip/decline signal into generation, so
  the engine stops asking what a person can't parse, doesn't apply to them, or won't share.
- **Notice change.** Detect numeric shifts (re-ask deltas) and semantic contradictions (a newer answer/insight
  supersedes an earlier fact), and turn an _unexplored_ shift into a "you moved on X — what changed?" question.
- **Always cover new ground.** A persisted, AI-assisted coverage map over all life areas drives a **strong-new
  bias**: mostly brand-new topics, a minority of purposeful deeper follow-ups, and depth **only when justified**
  (a detected change, a genuine gap, or an explicit request). Never re-mine.
- **Personalize from the whole self.** Feed the recipient's rich profile + insight facts + test subscale
  numbers + Together dynamics as **positive** signal; for self/auto sends, reach a partner's **shared**
  (non-restricted) facts and generate **reciprocal** questions between two people.
- **Unify.** Route all five generation paths (manual builder, auto check-ins, biographer, dream questionnaires,
  email embedded check-ins) through one engine + one "covered/asked" universe, so a fix reaches every path.
- **Make de-dup reliable + observable.** Consume the `degraded` flag (retry, then fall back to a stricter
  deterministic filter / smaller batch, and surface honestly), and stop truncating a long-history person's
  authoritative material.
- **Evolve.** A throttled periodic profile refresh, question-quality self-selection, live-model prompt tuning,
  and a light user-facing "what SelfOS has explored / steer it" transparency surface.

**Non-goals** — see §14 for the full out-of-scope list. In brief: no new answering/delivery engine (routes
through `generateQuestions` + `createAssignment`), no recipient-consent handshake (that stays the
[`63 §3.3a`](63-auto-checkins.md) see-and-stop model), no change to the consent/age gates or `SAFETY`, no
cross-partner sharing beyond the existing model (restricted never crosses), and no automatic editing of a
person's structured data from free text.

## 3. UX & flows

This is primarily a **developer-facing** capability (a core artifact + a shared engine consumed by five
paths). The user experience is largely _invisible and better_ — the same surfaces, smarter output. The
enumerated flows below are the developer-facing API usage; §3.4 is the one new user-facing surface.

### 3.1 The engine as the single seam (developer-facing)

Every path that generates questions calls **one** function instead of assembling its own bundle:

```
planGeneration(deps, { recipientPersonId, authorPersonId, intent, type, sensitivity, focus? })
  → GenerationPlan { topics[], dedupReference, recipientAskedPrompts, feedbackLedger,
                     positiveContext, intimacyCoverage?, reciprocityCandidates?, degradedInputs? }
```

The caller then passes the plan into the existing `generateQuestions` (`generationService.ts`). The engine:

1. reads the recipient's **Personalization Profile** (§4);
2. **selects topics** from the coverage map with a strong-new bias (§5.2), honoring the feedback ledger's
   per-reason rules and any detected-but-unexplored change;
3. assembles the **de-dup reference** (via the shared `buildDedupReference`, extended, §5.3) + the hard
   `recipientAskedPrompts` filter list;
4. assembles the **positive personalization** context (rich profile, insight facts, test subscales, Together
   dynamics, partner-shared facts, reciprocity candidates — §5.4);
5. runs the **hardened de-dup** (§5.5) that consumes `degraded`.

`suggestQuestionnaires` (the topic selector) gains the profile's coverage map + covered-topics + prior-sent
titles as its `avoidSuggestions`/positive inputs for **every** caller — including the Home gap-finder, which
today passes nothing.

### 3.2 The five paths, after unification

| Path                          | Today                                                                  | After                                                                   |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Manual builder** (08 §3.1)  | `generateQuestions` + `buildDedupReference` via the bridge             | `planGeneration` → `generateQuestions`; profile updates on send/answer  |
| **Auto check-ins** (63)       | `runAutoCheckins` assembles its own bundle (`assembleRecipientBundle`) | `runAutoCheckins` → `planGeneration`; coverage/feedback shared          |
| **Your Story** (64)           | `runGapPass` / `mintStoryCheckInFromTodo` build their own de-dup ref   | biographer topic pass → `planGeneration`; story gaps ↔ coverage map     |
| **Dream questionnaires** (12) | `mintDreamQuestionnaires` builds its own de-dup ref                    | `mintDreamQuestionnaires` → `planGeneration` for the resolved recipient |
| **Email embedded** (67)       | `generateSuggestion` + siloed `buildAvoidSet`; hard-coded 1-Q check-in | full rewrite onto `planGeneration`; email de-dup joins the one universe |

Each path keeps its own **cadence, delivery, and framing** (auto check-ins its queue/cadence, story its
McAdams register, email its embedded-answer link) — only the topic-selection + de-dup + feedback + positive
context become shared.

### 3.3 The answer/skip/change feedback loop (developer-facing)

On every **submit** (in-app Inbox, relay drain, or email embedded response), **skip**, and **insight change**
(analysis / reconcile), the engine updates the recipient's profile (§4.4): a decline records a feedback entry
keyed by topic + reason; a numeric re-ask delta or a contradicting fact records a change entry (unexplored);
answered-richly vs. bailed records engagement. A **throttled periodic refresh** (§5.6) re-runs the AI coverage
placement + change detection, mirroring the [`39`](39-living-memory-continuity.md) reconcile cadence (a
device-local per-person throttle; metered like the reconcile pass).

### 3.4 The light transparency surface (user-facing, Phase 5)

A calm, optional panel — **"What SelfOS has explored with you"** — surfaced on the Questionnaires page (per
[`59`](59-questionnaires-dashboard.md)) and/or per auto-check-in stream (§13 open question): a life-area
coverage read (explored / lightly touched / not yet), the topics the person has marked off (from the feedback
ledger + the [`08 §28`](08-questionnaires.md) covered-topics lever), and a **steer** control — "explore more
of X," "leave Y alone" — that writes to the profile. This is transparency + agency, never a required setup
step (no scaffolding for a feature nobody enables). Reuses `01` primitives; no color-only signals (text +
icon).

## 4. Data model (vault files & schemas)

### 4.1 File — the Personalization Profile

- **Path:** `people/<personId>/questionnaires/personalizationProfile.enc` — one per person, encrypted under
  the master key, alongside the existing `suggestions.enc` / `coveredTopics.enc` / `autoCheckins.enc`
  precedents. All reads/writes go through the vault service (`FileSystem` host), never `fs`.
- **Additive:** this is a **new** file with its own `schemaVersion: 1`; it introduces **no `schemaVersion`
  bump** to any existing persisted format. The only touches to existing schemas are additive-optional (a new
  `questionnaire.profile` usage type — data, not a schema change — and optional profile-provenance fields on
  entries). Absent-file ⇒ a fresh, all-uncovered profile is derived on read (the correct starting state).

### 4.2 Schema (Zod — source of truth)

```ts
// packages/core/src/questionnaires/personalizationProfile.ts

const ReopenSignal = z.enum(['new-material', 'profile-edit', 'explicit-request', 'dormant']);

const CoverageTopic = z.object({
  topicId: z.string(), // stable: `${lifeArea}:${slug}` (intimacy topics reuse the 49 category keys)
  lifeArea: z.string(), // from LIFE_AREAS ∪ the 49 INTIMACY_CATEGORIES
  label: z.string(),
  explored: z.boolean(), // any answer/insight covers it
  depth: z.number().min(0).max(1), // AI-scored richness of coverage
  askedCount: z.number().int().min(0),
  saturated: z.boolean(), // askedCount >= SATURATION_ASKS and not re-opened
  lastAskedAt: z.string().optional(),
  reopenedBy: ReopenSignal.optional(),
});

const FeedbackKind = z.enum([
  'unclear', // "Not clear — needs more context" → reword / re-approach differently
  'not-applicable', // "Doesn't apply to me" / not right about me → stop mining this topic
  'prefer-not-to-say', // boundary → back off long-term, rare gentle re-approach much later
  'skipped', // reasonless / unclassified free-text skip → weak signal (don't re-ask, mild de-prioritize)
  'answered-richly', // strong engagement → this vein is productive
  'bailed', // opened, abandoned → treat as low-engagement signal
]);

const FeedbackEntry = z.object({
  topicId: z.string().optional(),
  questionPrompt: z.string().optional(),
  kind: FeedbackKind,
  reason: z.string().optional(), // the free-text reason when given (never surfaced to another author)
  assignmentId: z.string().optional(),
  at: z.string(),
});

const ChangeEntry = z.object({
  topicId: z.string().optional(),
  metricKey: z.string().optional(), // for numeric shifts (ResponseSet.reAskOf → buildQuestionTrends)
  label: z.string().optional(), // a human-readable label for the changed thing (e.g. the question prompt)
  kind: z.enum(['numeric-shift', 'contradiction']),
  from: z.string(),
  to: z.string(),
  detectedAt: z.string(),
  explored: z.boolean(), // has a "what changed?" question been asked yet?
});

const ReciprocityCandidate = z.object({
  fromPartnerId: z.string(), // the partner whose shared fact prompts this
  topicId: z.string().optional(),
  note: z.string(), // e.g. "partner wants X during intimacy" (shared, non-restricted)
  at: z.string(),
  explored: z.boolean(),
});

export const PersonalizationProfileSchema = z.object({
  schemaVersion: z.number().default(1),
  personId: z.string(),
  updatedAt: z.string(),
  coverage: z.object({
    topics: z.array(CoverageTopic).default([]),
    lastPlacementAt: z.string().optional(), // last AI coverage-placement pass
  }),
  feedback: z.array(FeedbackEntry).default([]),
  changes: z.array(ChangeEntry).default([]),
  relational: z.object({ reciprocity: z.array(ReciprocityCandidate).default([]) }).optional(),
});
export type PersonalizationProfile = z.infer<typeof PersonalizationProfileSchema>;
```

Entries are **bounded** (rolling caps per array, mirroring the reconcile/change-log precedents) so the file
stays economical. Tolerant parse (`.catch`/`.default`) so a malformed entry degrades to a safe default rather
than throwing out of a whole generation.

### 4.3 What feeds it (all existing reads)

- **Coverage** — the deterministic taxonomy structure (`LIFE_AREAS` ∪ the [`49`](49-intimacy-activities-inventory.md)
  `INTIMACY_CATEGORIES`) plus an **AI placement pass** (§5.6) that classifies which topics the recipient's prior
  answers (`gatherRecipientPriorAnswersByAssignment`) and insight facts (`gatherRecipientInsightFacts`,
  `listInsightsForPerson`) cover, and scores `depth`. Intimacy coverage is folded in from `buildIntimacyCoverage`
  (its `uncovered`/`open`/`saturated` sets become coverage topics; §5.7).
- **Feedback** — the `DeclinedAnswer` value arm read at submit/skip (the signal [`08 §25.5`](08-questionnaires.md)
  promised), keyed by resolved topic + `reason`.
- **Changes** — numeric re-ask deltas from `buildQuestionTrends` (`ResponseSet.reAskOf`), and semantic
  contradictions surfaced by `analysisService`/the [`39`](39-living-memory-continuity.md) reconcile pass
  (`InsightFact.flaggedInaccurate`, superseded facts).
- **Relational** — a partner's shared facts, read **read-time re-gated** via `factSharedWithViewer` /
  `scopeGrants` (`people/relationshipScope.ts`) so restricted never crosses; reciprocity candidates derived
  from a partner's shared desire/need facts (§5.4).

### 4.4 Update triggers

Event-driven (cheap, no AI) on **submit / skip / decline / insight-change**, plus a **throttled periodic AI
refresh** (§5.6) for the coverage placement + change detection (which need a model). The event-driven writes
are pure host-side updates to the profile file; the periodic refresh is metered (`questionnaire.profile`) and
throttled device-local per person like the reconcile cadence.

## 5. Architecture & modules (the core "How it works")

### 5.1 New modules

- **`packages/core/src/questionnaires/personalizationProfile.ts`** — the store: `readProfile` /
  `writeProfile` / pure `applyAnswerFeedback` / `applyDecline` / `applyChange` / `applyReciprocity`, plus the
  deterministic `deriveCoverageSkeleton(lifeAreas, intimacyCoverage)`. Pure where it can be; I/O confined to
  read/write.
- **`packages/core/src/questionnaires/engine.ts`** — `planGeneration(deps, request): GenerationPlan`, the one
  seam §3.1. It composes the existing gatherers (`recipientHistory.ts`), `buildIntimacyCoverage`
  (`intimacy/coverage.ts`), the profile, and the shared `buildDedupReference`, and returns the plan every path
  feeds into `generateQuestions`.
- **`packages/core/src/questionnaires/coverageService.ts`** — the AI coverage-placement + change-detection
  passes (metered `questionnaire.profile`), fed a bounded digest, tolerant-parsed (`jsonSalvage`), fail-safe
  (a failed pass leaves the last good coverage; `degraded` surfaced).

> **Cycle caveat (real, from `intimacy/coverage.ts`'s module note):** `questionnaires/aiPrompts` imports
> `intimacy/coverage`, so a module that both drives prompts and reads intimacy coverage risks an
> `intimacy → questionnaires → intimacy` cycle — the trap that forced `autoCheckins` to live top-level. If a
> cycle arises, the engine relocates to a top-level `packages/core/src/questionnaireIntelligence/` module (the
> `autoCheckins` precedent), importing from `questionnaires` one-way. The store + coverage service are
> cycle-safe (pure/read helpers).

### 5.2 Topic selection — strong new bias, some depth

`planGeneration` selects topics from the coverage map:

1. **Uncovered / lightly-covered life areas lead** — the engine picks mostly **brand-new** topics
   (`explored: false` or low `depth`), ordered by relevance to the `intent`/`type`.
2. **A minority of purposeful deeper follow-ups** — a topic is deepened **only when justified** by a real
   reason: a **detected-but-unexplored change** (§5.8 → "what changed?"), a **genuine gap** (high-value but
   thin `depth`), or an **explicit request** (the author's focus / the transparency-panel steer). Never depth
   for its own sake, never re-mining.
3. **Feedback ledger governs, differentiated by reason** (§5.9):
   - `unclear` → the topic is still wanted; **reword / re-approach it differently** (feed the prior wording as
     "asked this way, landed unclear — ask it a different, concrete way").
   - `not-applicable` → **stop mining that topic** (avoid-list).
   - `prefer-not-to-say` → **back off long-term**, with a **rare gentler re-approach much later** (tunable
     `PREFER_NOT_COOLDOWN_DAYS`, not never — §11 decision 9).
   - `answered-richly` → a productive vein; deepening here is _justified_.
   - `bailed` → low engagement; de-prioritize length/complexity there.
4. **Saturated topics are off-limits** (deterministically stated in the prompt), re-openable by the four
   `intimacy/coverage.ts` signals generalized to all life areas: new material, profile edit, explicit request,
   dormancy.

`suggestQuestionnaires` (the topic **selector**) receives the covered topics + prior-sent titles +
not-applicable topics as its hard `avoidSuggestions`, for **every** caller (the Home gap-finder finally gets
one).

### 5.3 De-dup reference — complete, never truncated for the authoritative material

The shared `buildDedupReference` (`recipientHistory.ts`) is extended: the profile's coverage + feedback ledger
join the reference (so a covered/marked topic is visible to both the hard fuzzy filter and the semantic pass),
and the per-section budgeting is tuned so a long-history person's **authoritative "already answered" material
is never truncated away** (the recurring [`08 §23.5b`](08-questionnaires.md) bug at scale). The hard
`recipientAskedPrompts` filter (`isNearDuplicate`) is unchanged as the deterministic backstop.

### 5.4 Positive personalization — build on the whole self

The plan assembles **positive** context (split from de-dup: "here's what they told us, build on it" vs. "avoid
re-asking"):

- **Rich profile** (`profilesProvider`) — unchanged, [`08 §24.5`](08-questionnaires.md) (own data, private
  included, generation-scoped).
- **Insight facts + summaries** (`gatherRecipientInsightFacts`) as build-on signal.
- **Test subscale numbers** ([`50`](50-self-assessments.md)) — the recipient's own test-source insight metrics
  (e.g. attachment, kink subscales), so questions match their measured profile.
- **Together couples dynamics** ([`58`](58-together-couples-sessions.md)) — the distilled alignment, when
  present.
- **Partner-shared facts (self / auto sends).** For a self or auto check-in, the engine reaches the person's
  partner's **shared (non-restricted)** facts — the same facts the person's coach already sees — via
  `factSharedWithViewer` / `scopeGrants`. Restricted facts **never** cross.
- **Reciprocity candidates.** When a partner reveals a shared desire/need (e.g. partner **B** says what they
  want during intimacy), the engine generates a **reciprocal** question to the other (person **A**: how do you
  feel about doing that?). The model is instructed to be **tactful and self-contained** ([`08 §25.4`](08-questionnaires.md)) —
  it presents the reciprocal question on its own terms, never quoting the partner's raw disclosure, and stays
  within the existing partner-sharing model (§8).

### 5.5 Hardened de-dup — consume `degraded`, don't just report it

`generateQuestions` already surfaces `dedupDegraded` ([`08 §28.4`](08-questionnaires.md)); the engine now
**acts** on it: on a degraded semantic pass it (a) has already retried once (`semanticDedup.ts`), then (b)
falls back to a **stricter deterministic filter** (a lower `isNearDuplicate` threshold over the full reference)
and/or a **smaller batch** (regenerate fewer, higher-confidence-new questions), and (c) surfaces the degrade
honestly (the [`08 §28.4`](08-questionnaires.md) calm note in the manual panel; a `degradedInputs` flag on the
plan for auto/email/story so they can log/skip rather than send a possibly-repetitive set). The offline fakes
are **imperfect by default** so this path is actually exercised (§10).

### 5.6 The periodic profile refresh (metered, throttled)

A `questionnaire.profile` pass, run on the [`39`](39-living-memory-continuity.md) launch/focus cadence with a
device-local per-person throttle (default daily; §13 open question): it (1) re-runs the **AI coverage
placement** (classify prior answers + insight facts into coverage topics, score `depth`) and (2) **change
detection** (numeric re-ask deltas + semantic contradictions). Budget-gated + metered like the reconcile pass;
fail-safe (a failed pass leaves the last-good coverage, sets `degraded`). Smarter behavior is worth the token
cost (§11 decision 8).

### 5.7 Fold intimacy coverage in

`buildIntimacyCoverage` (`intimacy/coverage.ts`) stays the source of truth for the 14 intimacy categories; the
engine **maps** its `uncovered`/`open`/`saturated` sets + `deepenableActs` into coverage topics (topicId =
the 49 category key), so intimacy and non-intimacy coverage live in one map and one selection algorithm. The
existing `SATURATION_ASKS`/`DORMANT_DAYS`/re-open logic is reused verbatim; §5.2's four re-open signals are the
same four generalized.

### 5.8 Change → "what changed?"

A `ChangeEntry` with `explored: false` is a first-class topic-selection input: the engine may generate a
single, tactful "you've shifted on X — what changed?" question, then marks the change `explored: true` so it
isn't re-asked. Numeric shifts come from `buildQuestionTrends` (`reAskOf`); contradictions come from analysis /
reconcile (`flaggedInaccurate` + superseded facts). This is the "changed their mind" detection the raw material
always supported but nothing computed.

### 5.9 Feedback → behavior (the differentiated rules)

The three decline presets map to three distinct behaviors (§11 decision 3/9), applied by the engine at
selection time and recorded in the ledger at answer time. This is what turns "skip → smarter next time" from a
promise ([`08 §25.5`](08-questionnaires.md)) into behavior.

## 6. IPC / API contracts

The generation paths already run **host-side** (in the bridge / core cadence services); the engine is core, so
most of this needs **no new renderer-facing IPC** — the bridge's existing `questionnaires:generate` /
`gapfinder:suggest` / auto-cadence / story / dream / email seams call `planGeneration` internally. The
additions:

- **Core → nothing new over IPC for generation.** `planGeneration` and the profile store are consumed
  host-side.
- **The transparency panel (Phase 5)** adds thin, own-scoped read/write channels:
  `questionnaires:personalizationProfile` (read the active person's coverage read; gated `questionnaires.own`,
  active-person-scoped in the bridge — the trust boundary) and `questionnaires:steerTopic` (write a
  steer/leave-alone into the profile; own-scoped). Zod-validated both sides. No raw partner data crosses — the
  read returns the viewer's own coverage/feedback view only.
- **Claude:** the coverage-placement + change-detection passes use the standard main-side client (the key stays
  in main); metered as `questionnaire.profile`; tolerant-parsed; fail-safe.

## 7. States & edge cases

- **No profile file yet** → derive a fresh all-uncovered profile on read; the first generation is
  new-ground-by-default (correct).
- **AI off / over budget** → the periodic refresh is skipped (no spend); event-driven feedback/change writes
  still happen (cheap, no AI); generation degrades to the deterministic de-dup + last-good coverage. Consistent
  with [`31`](31-ai-required.md) — surfaces prompt setup, never fakes.
- **Semantic pass degraded** → §5.5 fallback; honest surface.
- **Long-history person** → §5.3 budgeting keeps the authoritative material; the periodic refresh keeps
  `depth` current.
- **Corrupt/partial profile file** → tolerant parse degrades a bad entry to default; a wholly-corrupt file is
  quarantined and re-derived (never crashes a generation).
- **Concurrent edits / sync conflict** → the profile follows the vault service's conflict handling (`00` §4.3);
  last-writer-wins on the small profile is acceptable (it's regenerable from the underlying answers/insights on
  the next refresh).
- **A partner removes a relationship / un-shares** → the read-time re-gate (`factSharedWithViewer`) drops the
  partner-shared facts + reciprocity candidates on the next read (no stale access; §8).
- **Migration from an old schema** → none for existing files (additive-only); the profile is new at v1.

## 8. Safety, privacy & boundaries

- **The [`08 §24.5`](08-questionnaires.md) override, scoped.** Questionnaire **tailoring** may use ALL of the
  **recipient's own** data (private/restricted included) — the owner's informed override — **scoped strictly to
  questionnaire generation**. `buildContext` (coaching), Memory's cross-user gate, Together `excludeRestricted`,
  and every other surface are **unchanged**.
- **Author-blind output ([`08 §17.4`](08-questionnaires.md)).** De-dup material + partner-shared facts +
  reciprocity notes are assembled host-side and fed to the model **only** to steer; the author never sees the
  raw content, and the prompt forbids the model from quoting or alluding to it. Only generated questions (and
  keep/drop indices) come back.
- **Restricted never crosses (other people).** A **partner's** facts reach self/auto generation **only** through
  `factSharedWithViewer` / `scopeGrants` — restricted / non-shared / wrong-relationship-type facts are
  structurally excluded, re-gated on **every** read. Reciprocity stays within the existing partner-sharing model
  (§11 decision 11): the reciprocal question is derived from a **shared** fact, presented tactfully and
  self-contained, never a leak of the partner's raw disclosure.
- **Crisis handling unchanged.** Analysis still flags crisis and leads with resources ([`08 §8.2`](08-questionnaires.md));
  the profile never suppresses or overrides crisis routing.
- **Not-medical.** Original, evidence-informed questions in the SelfOS voice; the coverage map is a topic
  memory, not a clinical instrument ([`08 §8.1`](08-questionnaires.md)).
- **Intimacy gates unchanged.** 18+ acknowledgement / DOB + consent for explicit tiers, ConsentReceipt, and
  the Anthropic-policy boundary are all unchanged ([`08 §8.3`](08-questionnaires.md)); intimacy coverage feeds
  steering within those gates.
- **Never disclose owner/admin access.** No surface (author- or recipient-facing) tells anyone an owner/admin
  can read answers (the durable 2026-06-15 rule).

## 9. Accessibility

Per `01` §9. The one user-facing surface (§3.4) is keyboard-operable, labelled, screen-reader friendly, with
coverage shown as **text + icon (never color-only)**, visible focus, and responsive ~360px→desktop. The steer
controls are ordinary buttons/toggles with clear accessible names. No motion-required affordance.

## 10. Testing strategy

Stressing the durable SelfOS lessons:

- **Assert the PROMPT reaches the model, not just outcome counts.** A fix that changes what the model is _told_
  (coverage steering, feedback rules, reciprocity) must assert the assembled prompt on **every** path — a
  count-only assertion once let a neutered fix pass 368 green tests. Capture the prompt (`SELFOS_FAKE_PROMPT_DIR`)
  and assert the coverage/feedback/reciprocity blocks are present.
- **Offline fakes must be imperfect** so de-dup + coverage are actually exercised (the [`08 §26`](08-questionnaires.md)
  linchpin): the fake Claude drops a reference-covered candidate and returns a non-trivial coverage placement,
  so a silent no-op is catchable.
- **Unit (core):** `personalizationProfile` apply-functions (decline → the right differentiated behavior;
  change → unexplored then explored; reciprocity from a shared fact); `deriveCoverageSkeleton`; `planGeneration`
  strong-new bias + depth-only-when-justified; `buildDedupReference` never truncates authoritative material;
  the `degraded` fallback path.
- **coreBridge (two-persona, decrypt-level):** cross-partner **reciprocity** — partner B's shared desire fact
  produces a reciprocal question for A, and A's own private facts never leak to another author; a **restricted**
  partner fact is **absent** from the plan (privacy boundary); the persisted profile decrypts to the expected
  coverage/feedback/change entries.
- **Component (RTL):** the transparency panel renders coverage + steer; a steer writes the profile.
- **E2E (Playwright):** answer → skip "Doesn't apply" → next generation avoids that topic (decrypt the
  profile); a re-ask numeric shift produces a "what changed?" question; the offline fake's coverage/dedup
  branches drive it.
- **Named follow-up:** **live-model prompt tuning** (coverage placement, change detection, reciprocity
  register) needs a real API key and is a Phase 5 on-device DoD item — the offline fake proves the plumbing +
  a reference-driven drop, not the live model's judgment ([`08 §26.3`](08-questionnaires.md) precedent).

## 11. Resolved decisions

Settled with the owner before this spec (do not re-open):

1. **Full phased vision** — the whole adaptive engine, not a slice or bug-fixes-only.
2. **Generation reaches partner-shared facts for self/auto** — restricted never crosses.
3. **Skip reasons differentiated** — `unclear` / `not-applicable` / `prefer-not-to-say` drive distinct
   behavior.
4. **Unify all FIVE paths** — including a **full email rewrite** onto the engine.
5. **Coverage = AI-assisted hybrid, persisted** — deterministic taxonomy + a metered placement pass.
6. **Change detection = numeric + semantic** — re-ask deltas AND contradicting facts.
7. **Balance = strong new bias, some depth** — depth only when justified (a change, a gap, or an explicit
   request).
8. **Cost** — smarter behavior is always worth the metered token cost.
9. **`prefer-not-to-say`** — back off long-term with a **rare gentler re-approach much later** (tunable), not
   never.
10. **A light user-facing transparency/steer surface** ships in Phase 5.
11. **Reciprocity stays within the partner-sharing model** — the model is tactful + self-contained; no leak of
    a partner's raw disclosure.

## 12. Build phases

Each phase is one reviewable, shippable slice with its own DoD (typecheck/lint/format, unit + coreBridge +
RTL + E2E where a surface exists, prompt-assertion tests, visual QA for any UI). **Branch off `origin/main`;
rebase after the concurrent email-phase-6 work lands** — `schemas.ts` + the IPC seam are the only overlap;
keep additions additive.

- **Phase 0 — this spec + cross-amendments.** Land `69`, plus pointers: a new `08 §32` ("Questionnaire
  Intelligence — see 69"), and notes in [`63`](63-auto-checkins.md), [`64`](64-your-story.md),
  [`67`](67-email-engagement.md), [`49`](49-intimacy-activities-inventory.md) that topic-selection + de-dup +
  feedback route through `69`.
- **Phase 1 — Feedback loop + concrete fixes (fastest visible win).** Persist + **read** skips/declines into
  generation, differentiated by reason, across manual / auto / story / dream; **consume** `degraded` (§5.5);
  give the Home gap-finder its avoid-list; make covered-topics consistent across all paths. Delivers "skip →
  smarter next time" + change-detection-lite (numeric re-ask deltas). _No new user surface (the profile is
  written/read host-side)._
- **Phase 2 — Coverage/knowledge model.** The persisted coverage map + hybrid AI placement + strong-new-bias
  selection; fold `intimacy/coverage.ts` in (§5.7). Delivers "always new topics, no re-mining" for all types.
- **Phase 3 — Broader data + reciprocity.** Partner-shared facts into self/auto generation; Together dynamics;
  test subscale numbers; the reciprocal-question driver (§5.4). Two-persona coreBridge + decrypt tests for the
  privacy boundary. Delivers partner cross-referencing.
- **Phase 4 — Full unification.** Route email embedded check-ins fully onto `planGeneration` (retiring the
  siloed `buildAvoidSet` universe); wire the story biographer topic pass into the shared coverage/feedback; one
  shared "asked/covered" universe so email ↔ questionnaires ↔ story stop overlapping.
- **Phase 5 — Evolution & quality polish.** Periodic profile refresh (§5.6); question-quality self-selection
  (favor veins that answered richly, retire ones that bail/skip); **live-model prompt tuning** (the deferred
  [`08 §26.3`](08-questionnaires.md) follow-up); the light user-facing transparency/steer surface (§3.4).

## 13. Finer points — resolved

_These finer points were resolved with the owner (2026-08-07); the defaults below are settled alongside the
§11 decisions._

- **Taxonomy granularity.** **Resolved:** start **coarse** (one topic per `LIFE_AREA`) and let the AI placement
  pass mint sub-topics **only** where a life area has genuinely multi-strand coverage.
- **Refresh cadence / throttle.** **Resolved:** **daily** (mirroring the [`39`](39-living-memory-continuity.md)
  reconcile throttle) **and** gated on **≥N new signals** since the last pass, so a quiet day spends nothing.
- **Transparency surface scope.** **Resolved:** a **global** "what SelfOS has explored" panel for the person's
  own coverage, plus a **compact per-stream read** where an auto-stream targets someone else.
- **`PREFER_NOT_COOLDOWN_DAYS`** — the "much later" gentle re-approach interval (decision 9). **Resolved:**
  **long (~180d)** and only from a **fresh angle**, never the same wording.

## 14. Non-goals / out of scope

- **No new answering, delivery, or analysis engine** — everything routes through the existing
  `generateQuestions` + `createAssignment` + the Inbox/relay + `analyzeAssignment`. If generation/de-dup needs
  a fix, it lands here or in [`08`](08-questionnaires.md), not a parallel engine.
- **No recipient-consent handshake** — targeting stays the [`63 §3.3a`](63-auto-checkins.md) see-and-stop
  model; this spec does not add an accept-before-asking step.
- **No cross-partner sharing beyond the existing model** — restricted facts never cross; reciprocity is derived
  only from **shared** facts.
- **No automatic editing of structured data from free text** — a wrong profile/onboarding fact is still routed
  to the person to fix ([`08 §29`](08-questionnaires.md)); the engine reads, never silently rewrites, a
  person's record.
- **No change to consent/age gates or `SAFETY`** — the intimacy tiers and their gates are unchanged.
- **No compatibility-variant de-dup** — aligning compatibility variants would break `canonicalId` alignment
  ([`08 §24.7`](08-questionnaires.md)); compatibility generation de-dups against the bound recipient only.
- **No always-on background process** — the periodic refresh is renderer-driven on launch/focus like the
  existing cadences; the app must be open.
- **No new pricing model** — reuses the existing metered usage types plus one additive `questionnaire.profile`
  key; the person + app budget gates ([`06`](06-ai-usage-and-budgets.md)) apply unchanged.

## 15. Changelog

- 2026-08-07 — **Phase 3 core BUILT** — partner-shared facts + reciprocity (the "partner said X → how do you
  feel?" example). `gatherRecipientPartnerContext` (`partnerContext.ts`) surfaces a partner's **shared**
  (non-restricted) facts to a person via the ONE `scopeGrants` gate — a **restricted / flagged / wrong-relationship-type
  fact NEVER crosses** — and marks Intimacy/Relationships desires as reciprocity candidates → a `partnerContext`
  prompt block that reflects a partner's stated desire back tactfully ("how do YOU feel about it?"), never
  quoting it. Wired into the manual bridge + auto self check-ins, gated strictly to **self-sends** (author ==
  recipient) so an other-person send never surfaces a third party's context to the author. Proven: a core
  gate test (shared crosses; restricted/private/wrong-type never do) + a two-persona bridge test (a partner's
  shared desire reaches the self-send prompt with the reciprocity framing; a restricted fact never does).
  **Phase-3 follow-ons** (minor): feed the recipient's own test subscale NUMBERS, and a persistent
  reciprocity-candidate ledger (the profile field exists; the live block already delivers the behaviour).
- 2026-08-07 — **Phase 2 BUILT** (coverage / novelty engine). The per-person coverage map
  (`coverageModel.ts`: one coarse topic per general `LIFE_AREA` + the Intimacy categories folded in from the
  existing `intimacy/coverage` engine; `buildCoverageGuidance` leads with unexplored/low-depth ground and marks
  explored areas deepen-only) + the metered `questionnaire.profile` AI placement pass (`coverageService.ts`
  `refreshCoverage` — bounded digest → per-area depth 0..1 + optional emergent sub-topics; budget-gated;
  fail-safe, never wipes the last-good map). The coverage guidance is combined with the skip/decline feedback in
  `gatherRecipientFeedbackGuidance`, so all four generation paths get the strong-new bias through the existing
  thread. The refresh **rides the living-memory reconcile cadence** (`memoryRefresh` — launch/focus, 24h
  throttle, ≥N-new-signals gate; §5.6). Verified end-to-end at the bridge (reconcile → coverage populated →
  generation leads with the unexplored ground). Slices 2a–2d. No new user surface (§12).
- 2026-08-07 — **Phase 1 BUILT** (feedback loop + concrete fixes). The Personalization Profile store
  (`personalizationProfile.ts`: feedback ledger + change log, module-local schema, tolerant/bounded); capture of
  per-question declines at every submit channel (`captureResponseFeedback` in `submitResponse` + `drainRelaySend`,
  household-only, best-effort) + numeric "what changed?" detection (`detectRecipientNumericShifts`, scale-aware);
  `buildFeedbackGuidance` (differentiated avoid / boundary / reword + a fresh-window change hint) threaded into all
  four read paths (manual/auto/story/dream) via a new `feedbackGuidance` request/prompt field; `degraded`
  consumed (stricter 0.45 fallback); the Home gap-finder given its avoid-list; covered-topics parity across
  auto/story/dream. Added a `skipped` FeedbackKind and a change `label`. Verified: core+desktop unit + a
  bridge-level assert-the-prompt test (author-blind). No new user surface (§12). Slices 1a–1e.
- 2026-08-07 — created (Approved). The per-person Personalization Profile + the unified `planGeneration` engine
  consolidating the [`08 §16–§28`](08-questionnaires.md) generation history; 5 build phases; owner's 11
  resolved decisions recorded.
