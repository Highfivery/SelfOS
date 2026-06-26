# 50 — Self-assessments ("Tests") & the personalization profile layer

> **Status:** Built — _last updated 2026-06-26_ (on `feat/self-assessments-tests`; §11 resolved; PR pending)
>
> A new **Self-assessments ("Tests")** engine + a first battery of four self-administered, **deterministically-scored**
> standardized instruments (Big Five personality, attachment style, sexuality/orientation spectrum, and an
> original kink & intimacy-interests inventory). Each test produces a structured **result profile** that
> personalizes Sessions, Dreams, Questionnaires, guided-session suggestions, and Challenges **app-wide**. Tests
> are the **personalization backbone**: unlike questionnaires ([`08`](08-questionnaires.md)) they are self-only,
> formula-scored (no AI needed to score — scoring is deterministic and free), produce normalized subscale
> scores + a profile, and are retakeable over time (trends). Results become **Insights** (`source: 'test'`)
> via the shared Insight/metrics layer, surfaced in a dedicated **"You" hub**.

Builds on [`00-architecture.md`](00-architecture.md) (vault, IPC, security, feature-module registry),
[`01-design-system.md`](01-design-system.md) (primitives + tokens + `LineChart`),
[`04-people-roles.md`](04-people-roles.md) (people, capabilities, encryption, `buildContext`, the
shareable-vs-private split), [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (every AI call is
metered + budget-gated), [`08-questionnaires.md`](08-questionnaires.md) (the shared **Insight / metrics
layer** §1.1/§4.4, the **answer-type renderer**, the **context-provider registry**, the 18+ ack), and the
intimacy work of [`18`](18-personal-onboarding.md)/[`27`](27-intimacy-redesign.md)/[`46`](46-intimacy-matrix-accuracy.md)
plus the shared intimacy topic inventory (`@selfos/core/intimacy/topics`). It **consumes** the tiered intimacy
inventory that **spec 49** is to formalize (the kink test's items + subscales); see §11.

Memory ([`20`](20-memory-dashboard.md)/[`44`](44-memory-dashboard-overhaul.md)) is the AI's **inferred** facts;
the **"You" hub** here is the **tests you took** — deliberately distinct surfaces (§3.1).

---

## 1. Overview

### 1.1 What a test is (and how it differs from a questionnaire)

A **self-assessment** ("Test") is a self-administered, standardized instrument the person takes **about
themselves**. The person answers a fixed (or conditionally-revealed) set of items — mostly Likert grids — and a
**deterministic scoring function** turns the raw answers into named, normalized **subscale scores** and a
**result profile**. No model call is needed to score; scoring is pure arithmetic (free, offline, instant).

This is a different shape from a questionnaire ([`08`](08-questionnaires.md)):

| Dimension       | Questionnaire (08)                                  | Test (this spec, 50)                                    |
| --------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Audience        | sent to **other people** (household/external relay) | **self-only** — you take it about yourself              |
| Scoring         | answers → AI **analysis** Insight (metered)         | answers → **deterministic formula** scores (free)       |
| Output          | free-text Insight + optional metrics                | structured **subscale scores** + a **result profile**   |
| Lifecycle       | one-shot send + (manual) re-ask                     | **retakeable** → a new dated result + a **trend point** |
| Definition home | created per-send (no templates)                     | **curated code** (`TestDefinition`, like guidedCatalog) |
| AI              | required to analyze                                 | **optional** "what this means" narrative only           |

Both **feed the coach** through the same Insight/metrics layer, so a test result and a questionnaire Insight are
consumed identically by `buildContext`, the gap-finder, and trends — only the **producer** differs.

### 1.2 The personalization profile layer

Tests are the **deliberate, durable** way a person tells SelfOS who they are along well-known axes, so the rest
of the app can personalize without guessing:

- **Big Five** (IPIP, public-domain) → coaching **tone** (e.g. high-neuroticism → gentler reframes; high-openness
  → more exploratory prompts).
- **Attachment** (ECR-R, public-domain) → **relationship & intimacy** framing (anxious/avoidant dynamics).
- **Sexuality & orientation** (Kinsey/Klein-style spectrum) → orientation-aware intimacy work.
- **Kink & intimacy interests** (original SelfOS instrument) → per-category intimacy interests, surfaced only when
  relevant.

A test result becomes an **Insight** (`source: 'test'`, auto-approved into the person's **own** context) +
`Insight.metrics` for trends. Sensitive results (kink/sexuality) are written as **`restricted`** facts —
relevance-gated, owner-visible, never broadcast — mirroring restricted intake facts ([`18`](18-personal-onboarding.md) §8.4).
Non-sensitive results (Big Five, attachment) feed context normally.

### 1.3 Whole-app fit (where test profiles flow)

- **Sessions ([`05`](05-conversations.md))** — Big Five shapes coaching **tone**; attachment shapes relationship
  framing; both ride the person's own `buildContext` (§5.5).
- **Dreams ([`12`](12-dreams.md)/[`13`](13-dream-images.md))** — attachment + intimacy results inform dream
  analysis of relationship/intimacy themes (own-context only; the restricted gate applies).
- **Questionnaires ([`08`](08-questionnaires.md))** — the test-profile **context provider** (§5.5) feeds AI
  generation + the gap-finder, so the next questionnaire is tailored to the person's traits.
- **Guided sessions ([`16`](16-guided-sessions.md))** — suggestions can prefer exercises matching the profile
  (e.g. attachment-aware connection exercises).
- **Challenges** (future) — challenge suggestions can prefer prompts matching the profile.

The test result is **structured signal**, not raw answers — exactly the boundary every other producer honors.

## 2. Goals / Non-goals

**Goals**

- A reusable **`TestDefinition` engine** (instrument metadata + items + a declarative **scoring spec**) shipped as
  **curated code** (like `guidedCatalog`), plus a per-person encrypted **`TestResult`** record (scores + answers +
  `takenAt`), and a **deterministic scoring engine** (per-instrument scoring functions).
- A **first battery of four**: Big Five (IPIP), attachment (ECR-R), sexuality/orientation (Kinsey/Klein-style),
  and an **original** kink & intimacy-interests inventory (built on spec 49's tiered intimacy inventory).
- A dedicated **"You" hub** (its own nav route): the list of available tests, take/retake, a **result profile**
  screen (subscale bars + retake **trends**), and an **optional** AI "what this means for you" narrative
  (explicitly user-triggered, metered `test.narrate`, never auto-spent).
- **Result → Insight (+ metrics) → `buildContext`**, auto-approved into the person's **own** context; sensitive
  results written as **`restricted`** + relevance-gated (intimacy sessions/challenges).
- A **test-profile context provider** registered into [`08`](08-questionnaires.md)'s registry so results feed
  generation/coaching automatically, with **no generator changes**.
- **Per-person, encrypted** storage; a new **`tests.own`** capability (Member default ON); the kink/sexuality
  test gated behind the **shared 18+ ack** (`guidance/prefs.enc adultAcknowledged`).
- **Retakes over time** → a new dated result + a trend point (reusing the `LineChart` + metrics/trends pattern,
  [`20`](20-memory-dashboard.md)/[`44`](44-memory-dashboard-overhaul.md)).

**Non-goals (deferred / owned elsewhere)**

- **Sending a test to someone else / 360°** — tests are self-only; the "ask others about you" surface is
  [`08`](08-questionnaires.md) (questionnaires/compatibility). A test result may later be **share-scoped** to a
  partner's coaching (relationship-scoped, [`42`](42-relationship-scoped-sharing.md)) — that's an open question
  (§11), not v1.
- **Clinical / diagnostic instruments** — explicitly out (PHQ-9, GAD-7, etc.). SelfOS is **wellness, not
  medical** (§8); even personality is framed **non-diagnostically** ("a reflection, not a verdict").
- **Proprietary instruments** — Love Languages, Erotic Blueprint, bdsmtest, MBTI, the proprietary Enneagram
  questionnaires are **not** reproduced. We embed **public-domain** instruments (IPIP, ECR-R) and an **original**
  kink inventory.
- **A second AI provider / images** — N/A; the only AI here is the optional text narrative.
- **The relationship/intimacy dashboard + metric vocabulary** — owned by [`11`](11-relationship-tracking.md); 50
  emits the metrics, not the dashboards.
- **Scheduled re-take reminders** — deferred; retake is manual (the result chain is re-take-ready).

## 3. UX & flows

A new **Self-assessments** feature module registers a nav entry **"You"** (gated by `tests.own`) and the route
tree `/you`. Every screen is responsive (~360px→desktop) per [`01`](01-design-system.md). The crisis footer +
not-medical line are present on every test/result surface (§8).

### 3.1 The "You" hub (`/you`)

The home of "the tests you took," **distinct from Memory** (Memory = the AI's inferred facts; the You hub = your
deliberate self-assessments). A short header explains the difference and links Memory ("What SelfOS has _learned_
about you lives in **Memory**"). Top to bottom:

1. **Header** — "You — how you see yourself," a one-line not-medical framing ("These are reflections, not
   verdicts"), and a link to Memory.
2. **Your profiles** (only if any results exist) — one **profile card per instrument the person has taken**: the
   instrument name, a compact **subscale summary** (the top 1–2 dimensions as labelled bars), `takenAt`/"taken N
   times," and **Open** (→ §3.3) / **Retake** (→ §3.2). Sensitive instruments (kink/sexuality) show their card
   only to the person themselves (own data) and carry a small **"private — only you"** marker.
3. **Available tests** — a grouped catalog of the four instruments (Personality · Relationships · Intimacy &
   sexuality), each a card: name, what it measures, item count + estimated time, a **non-diagnostic** one-liner,
   and **Take**. The Intimacy & sexuality group cards are **18+-gated** (§3.5).

Empty state: a warm "Take a test to see how SelfOS understands you — and to make your coach, dreams, and
questionnaires fit you better." (`tests.own` is on for Members, so the catalog is always reachable; the
18+ group reveals after the ack.)

### 3.2 Taking / retaking a test

1. **Intro** — the instrument's purpose, the **non-diagnostic** framing, item count + time, and (sensitive tiers)
   the **18+ gate** (§3.5). For a retake, a calm note: "This creates a new dated result and adds a point to your
   trend — your previous results are kept."
2. **Answer** — the items render with the **questionnaire answer-type renderer** (`@selfos/answering`,
   [`08`](08-questionnaires.md) §5.3) — mostly **Likert** (a `matrix` grid of items on one 1–5/1–7 scale, or
   per-item `rating`), with `singleChoice`/`slider` where an instrument needs it (Kinsey/Klein). **Conditional
   reveals** reuse the engine's branching (`isQuestionVisible`/`visibleQuestions`) — e.g. the kink inventory only
   shows a category's depth items once the person opts into that category. Required gating is the engine's
   (`unansweredRequired`); a **required Likert item is NOT auto-seeded** (it stays unanswered until the person
   moves it, so a midpoint is never silently assumed — the [`27`](27-intimacy-redesign.md)/§16 precedent).
   Progress is **saved + resumable** (§7) so a long instrument isn't lost.
3. **Finish** — when all required items are answered, **Score** (deterministic, instant, free). The person lands
   on the **result profile** (§3.3). A test **never** spends budget to score.

The full battery renders **to the bottom** with no default-collapsed item group (the DoD "full surface renders"
rule, CLAUDE.md §7): every item is visible (no `<details>` defaulting closed) and the Finish/Score affordance is
reachable.

### 3.3 The result profile screen (`/you/:testId`)

- **Header** — instrument name, `takenAt`, a **non-diagnostic** preamble ("A snapshot of how you answered today —
  not a label or a diagnosis").
- **Subscale bars** — each subscale as a labelled bar (text **and** a non-color-only bar; the value shown as
  text), e.g. Big Five's five dimensions, ECR-R's anxiety/avoidance, the kink inventory's per-category interest
  scores. Each bar has a short, plain, **non-pathologizing** descriptor band (e.g. "leans toward …"), never a
  verdict.
- **Trends** (only with ≥2 results) — a collapsible per-subscale **`LineChart`** of that subscale over retakes
  (reusing the [`20`](20-memory-dashboard.md)/§44 metrics-over-time pattern + the `LineChart` primitive). Framed
  gently — "how this has shifted," never clinical.
- **"What this means for you" (optional AI)** — a **button**, not auto-run: tapping spends `test.narrate` (metered
  - budget-gated, §6) to generate a short, warm, **non-diagnostic** narrative from the deterministic scores. Calm
    AI-off / over-budget states (the deterministic profile + bars always render without AI). For a **sensitive**
    instrument, how much the narrative may reference the restricted scores is bounded (§8, §11).
- **History** — a list of prior dated results (each openable; the current one highlighted).
- **Manage** — **Retake** (→ §3.2) and **Delete this result** / **Delete all results for this test** (removes the
  result(s) + their derived Insight, §5.4).

### 3.4 Result → context (what feeds the coach)

A scored result **auto-feeds the person's own context** (like session/dream/intake — no separate review step;
recommended, see §11): it becomes an Insight (`source: 'test'`, `approved: true`, `subjectPersonId` = the taker)
whose facts summarize the salient subscales and whose `metrics` carry the normalized scores. **Non-sensitive**
results (Big Five, attachment) feed normally; **sensitive** results (kink/sexuality) write **`restricted`** facts,
which are **relevance-gated** — surfaced only when the active session/challenge is about intimacy (the
[`28`](28-portrait-synthesis-optimization.md) topic-selection + [`18`](18-personal-onboarding.md) §8.4 precedents)
— **owner-visible**, never broadcast, never in another person's context. The result is **reviewable + editable in
Memory** ([`20`](20-memory-dashboard.md)) like any other Insight (so a person can correct or delete it there too).

### 3.5 The 18+ gate (intimacy/sexuality tests)

The **Intimacy & sexuality** group (kink inventory + the sexuality/orientation spectrum) is gated behind the
**shared adult acknowledgement** already used by guided sessions + the intimacy intake
(`people/<id>/guidance/prefs.enc` `adultAcknowledged`, [`16`](16-guided-sessions.md) §8.3 /
[`18`](18-personal-onboarding.md)). Acking once anywhere unlocks all three. Before the ack the group's cards show
a calm "18+ — acknowledge to view" affordance; the items, results, and the catalog cards are withheld **in the
bridge**, not just the UI (the trust boundary). The consensual-adult boundary on the kink inventory follows the
existing rule (enforced in content + the model, never a keyword filter) — `@selfos/core/intimacy/topics` already
states it; nothing here is about minors, real non-consent, or illegal acts.

### 3.6 Admin-only surfaces

A test result's **cost** (the optional narrative's `$`) follows the established **admin-only-`$`** rule
([`06`](06-ai-usage-and-budgets.md); memory `selfos-usage-budget-rules`) — surfaced via the usage ring, never a
new metering surface, with the standard **AdminOnlyBadge** where a dollar figure shows. There are no other
admin-only surfaces here (tests are own-data, own-context).

## 4. Data model

All persisted formats are **Zod-backed** (`z.infer` types), written through the vault/crypto service (`00` §4 /
`04` §5). Types live in `@selfos/core` so the renderer + IPC contract share one source.

### 4.1 Vault layout (additions)

```
vault/
  people/<person-id>/
    tests/<result-id>.enc        # a TestResult (encrypted; one per take; retakes add new files)
    guidance/prefs.enc           # existing — the shared `adultAcknowledged` flag (16/18) gates intimacy tests
    insights/<insight-id>.enc    # existing — a test result's derived Insight (source: 'test')
```

A **`TestDefinition`** is **code, not vault** (a curated catalog, like `guidedCatalog`), so no vault file holds
instrument metadata/items/scoring. Only the person's **answers + scores** are persisted (under their own folder,
encrypted). This feature stores **no per-device state**.

### 4.2 `TestDefinition` (curated code — instrument metadata + items + scoring spec)

Lives at `@selfos/core/tests/testCatalog.ts` (the `guidedCatalog` pattern: display metadata is importable by the
renderer; scoring is used by the engine). **Items reuse the questionnaire `Question` shape** (`AnswerType` enum,
`@selfos/answering` renderer, branching) so we don't fork a second item model.

```ts
type TestGroupId = 'personality' | 'relationships' | 'intimacy';

interface SubscaleSpec {
  key: string; // stable metric key, e.g. 'bigfive.neuroticism', 'ecr.anxiety', 'kink.impact'
  label: string; // human label, e.g. 'Neuroticism'
  /** How to combine the item scores for this subscale into a raw value (§5.1). */
  aggregate: 'sum' | 'mean';
  /** Item ids contributing to this subscale; a `-` prefix means the item is REVERSE-scored (§5.1). */
  items: string[]; // e.g. ['o1', '-o2', 'o3'] — '-o2' is reverse-keyed
  /** Normalization for charts/Insight metrics: the raw range maps onto a normalized 0..1 (or −1..1). */
  normalize: { min: number; max: number; out?: 'unit' | 'signed' }; // default 'unit' (0..1)
  /** Short, non-pathologizing descriptor bands keyed by normalized thresholds (§3.3). */
  bands?: { upTo: number; label: string }[];
}

interface ScoringSpec {
  /** The deterministic scorer to run (§5.1). 'subscales' covers IPIP + ECR-R + the kink inventory;
   *  'klein'/'kinsey' are the spectrum scorers. No AI is ever involved. */
  method: 'subscales' | 'kinsey' | 'klein';
  /** The Likert range these items use (e.g. 1..5 for IPIP, 1..7 for ECR-R). */
  scale: { min: number; max: number };
  subscales: SubscaleSpec[];
}

interface TestDefinition {
  id: string; // stable, e.g. 'bigfive-ipip-50', 'ecr-r', 'kinsey-klein', 'kink-interests'
  group: TestGroupId;
  title: string; // e.g. 'Big Five personality'
  /** The recognised instrument family, shown as a tag (e.g. 'IPIP', 'ECR-R'). */
  instrument: string;
  blurb: string; // one-line card description
  /** Non-diagnostic framing line shown on intro + result (§8). */
  framing: string;
  estimatedMinutes: number;
  /** 18+ acknowledgement required (kink + sexuality) → gated by the shared ack (§3.5). */
  adult?: boolean;
  /** Sensitive results are written as `restricted` facts + relevance-gated (§3.4/§8). */
  sensitive?: boolean;
  /** The instrument's items — the questionnaire Question shape (08 §4.2). Mostly Likert (matrix/rating);
   *  Kinsey/Klein use singleChoice/slider. Branching reuses the engine (08 §5.1). */
  items: Question[];
  scoring: ScoringSpec;
}
```

Custom user-authored tests are **out of scope** (the catalog is curated code, like the capability registry +
guidedCatalog); adding an instrument is a code change + new scoring vectors, not a vault edit.

### 4.3 `TestResult` (per-person, encrypted)

```ts
interface TestSubscaleScore {
  key: string; // matches a SubscaleSpec.key
  raw: number; // the aggregated raw value (sum/mean)
  normalized: number; // 0..1 (or −1..1 for signed subscales) — what charts/metrics use
  band?: string; // the resolved descriptor band label at score time (§3.3)
}

interface TestResult {
  id: string;
  schemaVersion: number;
  testId: string; // the TestDefinition.id
  testVersion: number; // the definition's content version at score time (so a re-scored old result is honest)
  subjectPersonId: string; // the taker (always self — there is no other recipient)
  answers: {
    questionId: string;
    value: string | number | boolean | string[] | Record<string, number>;
  }[];
  scores: TestSubscaleScore[]; // the deterministic result
  reTakeOf?: string; // prior TestResult id → the longitudinal chain (trends)
  insightId?: string; // the derived Insight this result produced (source: 'test')
  takenAt: string;
  createdAt: string;
  updatedAt: string;
}
```

`answers.value` reuses the questionnaire `Answer.value` union ([`08`](08-questionnaires.md) §4.3), so the
`@selfos/answering` renderer round-trips test items unchanged (matrix → `Record<string, number>`).

### 4.4 Shared Insight / metrics layer additions (additive — no schemaVersion bump where avoidable)

- **`InsightSourceSchema`** (`packages/core/src/schemas.ts:550`) gains **`'test'`**:
  `z.enum(['questionnaire', 'session', 'dream', 'intake', 'test'])`. This is an **additive enum widening** — every
  consumer reads `source` for display/provenance only, and `summarizeForContext`/`feedableInsights` don't branch
  on it (a test insight feeds context exactly like a session/intake one). **No `schemaVersion` bump** (the
  established additive-enum precedent: `'dream'`/`'intake'` were added additively).
- **`InsightProvenanceSchema`** (`schemas.ts:654`) gains an optional **`testId?: string`** + **`testResultId?:
string`** so Memory's provenance can deep-link to the result (`/you/:testId`), mirroring `conversationId` /
  `dreamId` / `intakeSection`. Additive-optional → no bump.
- A test result's facts use the existing **`restricted`** flag ([`18`](18-personal-onboarding.md) §8.4) for
  sensitive instruments and the existing **`metrics`** map for subscale scores (chartable). No new `Insight`
  field is required.

### 4.5 Capability & settings

- **Capability** — add **`tests.own`** to `CAPABILITIES` (`packages/core/src/capabilities.ts`), Member default ON
  (added to the Member `capabilityMap`), `CAPABILITY_LABELS['tests.own'] = 'Take their own self-assessments'`. The
  Owner has it via the full-access bypass (`roleAllows`). It is **not** `EXPLICIT_GRANT_ONLY` — taking a test
  about yourself is ordinary. (The intimacy/kink test is additionally gated by the **18+ ack**, not a capability.)
- **Settings** — no new settings are required v1 (scoring needs no config; the narrative reuses the global AI
  enablement + budget). The only relevant existing setting is **`ai.enabled`** + budgets ([`06`](06-ai-usage-and-budgets.md));
  the deterministic engine works regardless. _(N/A — no schema-driven settings declarations beyond what `06`
  owns.)_

### 4.6 Ownership

All reads/writes go through the vault/crypto service — the renderer never touches `fs` (`00` §3). `TestResult`s
are encrypted under the master key in the taker's own folder; `TestDefinition`s are code (never written).

## 5. Architecture & modules

A standard `defineFeature` (`00` §5.2): the **You** nav entry + `/you` routes + the `tests.own` capability + the
`TestResult` schema + the test IPC handlers + the **test-profile context-provider** registration. The shell is
untouched.

### 5.1 The deterministic scoring engine (`@selfos/core/tests/scoring.ts`)

Pure, **AI-free**, exhaustively unit-tested — the heart of this spec. Given a `TestDefinition` + an answers map,
`scoreTest(def, answers): TestSubscaleScore[]`:

1. **Resolve each item's contribution.** For a Likert item, the contribution is the answer value on the
   definition's `scoring.scale`. For a **reverse-keyed** item (a `-` prefix in `SubscaleSpec.items`, e.g.
   `'-o2'`), the contribution is `(scale.min + scale.max) − value` (so a 1↔5 / 1↔7 flip). Reverse-scoring is the
   classic IPIP/ECR-R correctness pitfall — it is computed centrally here and has dedicated tests (§10).
2. **Aggregate per subscale** (`SubscaleSpec.aggregate`): `sum` (IPIP raw subscale sums) or `mean` (ECR-R
   anxiety/avoidance means).
3. **Normalize** (`SubscaleSpec.normalize`) onto `0..1` (`'unit'`, default) or `−1..1` (`'signed'`) for charts +
   `Insight.metrics`.
4. **Resolve a descriptor band** (`SubscaleSpec.bands` against the normalized value) — a plain, non-pathologizing
   label, never a verdict.

Per-instrument scorers (`scoring.method`) — all deterministic:

- **`subscales`** — IPIP Big Five (five subscale sums w/ reverse-scoring), ECR-R (anxiety + avoidance means w/
  reverse-scoring), and the **kink inventory** (per-category interest aggregation, §5.3). One generic engine, the
  per-instrument behaviour is all data (`SubscaleSpec`s).
- **`kinsey`** — a single 0–6 Kinsey value from the orientation item (a `singleChoice`/`slider`), surfaced as one
  signed/normalized subscale.
- **`klein`** — the Klein Sexual Orientation Grid: several dimensions (attraction / behaviour / fantasy / …) ×
  (past / present / ideal), each a 0–6 value, scored per cell into named subscales. The instrument is the
  public-domain grid **structure**; the item phrasings are SelfOS-original (no proprietary text reproduced, §8.1).

`scoreTest` is **total** (never throws): a missing/out-of-range answer is clamped or omitted from its subscale,
so a partial mis-entry degrades gracefully rather than failing the whole score (§7).

### 5.2 The instruments (first battery — structure, not reproduced text)

The catalog ships four `TestDefinition`s. We embed **public-domain** instruments (IPIP, ECR-R) directly as items;
where an instrument family is proprietary or only a published **structure** exists, the items are **SelfOS-original
phrasings** mapped onto the recognised scoring model (§8.1):

1. **Big Five — IPIP** (`bigfive-ipip-50` or `-120`, §11): public-domain IPIP items, five subscales
   (Openness/Conscientiousness/Extraversion/Agreeableness/Neuroticism), `sum` aggregation with reverse-keyed
   items. Likert 1–5 `matrix`.
2. **Attachment — ECR-R** (`ecr-r` full 36 or `ecr-rs` short, §11): public-domain ECR-R items, two subscales
   (Anxiety + Avoidance), `mean` aggregation with reverse-keyed items. Likert 1–7 `matrix`.
3. **Sexuality & orientation — Kinsey / Klein** (`kinsey-klein`): the Kinsey scale + Klein-grid **structure** with
   original item phrasings; `kinsey`/`klein` scorers. **18+ + sensitive.**
4. **Kink & intimacy interests** (`kink-interests`): an **original** SelfOS instrument (Love Languages / Erotic
   Blueprint / bdsmtest are proprietary and not reproduced) built on **spec 49's tiered intimacy inventory** + the
   existing `@selfos/core/intimacy` topics, scored into **per-category subscales** (§5.3). **18+ + sensitive.**

### 5.3 The kink inventory's subscale model (§5.2 item 4)

The original instrument groups the spec-49 tiered intimacy inventory (and the existing `INTIMACY_ACTIVITIES`/
`INTIMACY_FANTASIES`) into **interest categories** — each a `SubscaleSpec` whose items are the per-act/theme
Likert ratings, aggregated (`mean`) into a normalized **per-category interest score** (e.g. `kink.sensation`,
`kink.power`, `kink.bondage`, `kink.exhibition`, `kink.roleplay`, …). The **exact category→item mapping ties to
spec 49** (the open dependency, §11) so the two stay one source of truth; until 49 lands, the inventory uses the
current intimacy topics grouped provisionally. Branching (`08` §5.1) shows a category's depth items only once the
person opts into that category (so the instrument isn't an overwhelming wall). Every kink result is \*\*`restricted`

- sensitive\*\* (§3.4/§8).

### 5.4 The result → Insight bridge (`@selfos/core/tests/testService.ts`)

`takeTest` / `scoreTestResult` (deterministic) → persist the `TestResult` → **bridge to an Insight**:

- Build an `Insight` (`source: 'test'`, `approved: true`, `subjectPersonId` = the taker), with:
  - **facts** summarizing salient subscales in plain language (`shareable: false` by default; **`restricted: true`**
    for a `sensitive` instrument — the [`18`](18-personal-onboarding.md) §8.4 own-context-only rule);
  - **`metrics`** = each subscale's `{key: normalized}` (so trends + `11` can chart them);
  - **provenance** `{ testId, testResultId, at }` (§4.4) so Memory deep-links to `/you/:testId`.
- A **retake** reuses the prior result's `insightId` (carries forward each fact's sharing as the session/intake
  re-run paths do), so the person's "personality/attachment" Insight is **updated**, not duplicated; the new
  `TestResult` is a **new file** (`reTakeOf` set) and a **new trend point**.
- A **crisis-adjacent** signal (e.g. an extreme distress/self-harm answer that an intimacy/attachment item could
  surface) sets the Insight's `crisisFlag` and makes the result + any narrative **lead with resources** (§8.2).
  This is a heuristic flag on the **answer**, not a deterministic clinical score (we never diagnose).

Deletion ([`20`](20-memory-dashboard.md) §3.7 spirit): deleting a `TestResult` removes the file; deleting **all**
results for a test removes its derived Insight too (the result is the source). Memory's own Delete also works on a
test Insight (it's an ordinary Insight).

### 5.5 The test-profile context provider (`@selfos/core/tests/testContextProvider.ts`)

Register a provider into [`08`](08-questionnaires.md)'s `contextProviderRegistry`
(`registerContextProvider({ id: 'tests', label: 'Self-assessments', gather })`) so AI generation + the gap-finder
pull test profiles automatically — **no generator changes**. Because test results are ordinary Insights
(`source: 'test'`, own-approved), they **already** flow into the person's own `buildContext` via
`summarizeForContext` (the existing pin/cap path) and into the relevance selection ([`28`](28-portrait-synthesis-optimization.md)) — so:

- **Sessions / Dreams** get the profile for free (own context). Big Five → tone, attachment → relationship
  framing, surfaced through the normal Insight emit.
- **Sensitive** test facts are `restricted`, so they only surface for an **intimacy-topic** context (the §28
  topic gate + §18 §8.4 own-only rule) — an intimacy session/challenge sees the kink/sexuality profile; a money
  chat does not.
- The dedicated provider adds a compact, generation-friendly summary line per profile so questionnaire generation
  can tailor to traits even where the raw Insight emit is capped.

### 5.6 Renderer

- **Stores (Zustand):** `testStore` (catalog list + the active person's results; load/score/take/delete; **resets
  on `activePerson.id`** — the per-person isolation rule). `testProfileStore` may compose results for the hub from
  `testStore` (no extra IPC), mirroring the Home-dashboard composition pattern ([`17`](17-home-dashboard.md)).
- **Screens:** the **You hub** (`/you` — catalog + profiles), **Take** (`/you/:testId/take` — the answering form
  over `@selfos/answering`), the **result profile** (`/you/:testId` — subscale bars + trends + the optional
  narrative + history). The catalog cards + the subscale bar reuse design-system primitives; any new primitive →
  `/gallery` (DoD §12). The subscale **trend** reuses `LineChart` (no new chart primitive expected).
- **Shared answering renderer** — reuse the `@selfos/answering` `QuestionnaireForm` for items (over the core
  `answering` helper for branching/required), passing the Sessions `CrisisFooter` so behaviour is byte-identical
  ([`08`](08-questionnaires.md) §5.3).

## 6. IPC / API contracts

Typed channels (`src/shared`, Zod-validated both sides). All gated by **`tests.own`** + **active-person-scoped in
the bridge** (the trust boundary — a person can only take/read their own tests; a sensitive test's items/results
are withheld for an un-acked person in the bridge, §3.5). The **only metered call is the narrative**; scoring is
free.

- **`tests:list`** → the curated `TestDefinition` display metadata (catalog) the active person may take, **with the
  18+ group filtered out unless `adultAcknowledged`** (resolved in the bridge). No request body.
- **`tests:get({ testId })`** → one definition's items + metadata for the Take screen; **withheld (typed
  `NOT_AVAILABLE`) for a sensitive test when not acked**.
- **`tests:take({ testId, answers })`** → **deterministically score** (`scoreTest`), persist a `TestResult`,
  bridge the Insight (§5.4), return the result; **no AI, no budget check** (free). Validates answers + the testId
  in the bridge.
- **`tests:score({ testId, answers })`** → a **pure preview** scorer (no persistence) for the in-form live
  preview, if needed; deterministic + free. (Optional; `tests:take` may serve both.)
- **`tests:result({ testId })`** → the active person's **latest** result for a test (+ the chain summary for
  trends), or null.
- **`tests:listResults({ testId })`** → all dated results for a test (the history + trend series), newest first.
- **`tests:narrate({ testId, resultId })`** → the **optional** AI "what this means for you" narrative. Runs the
  [`06`](06-ai-usage-and-budgets.md) path: `checkBudget → call → recordUsage` with `type: 'test.narrate'`, charged
  to the **active person**, caching on the stable prefix. Typed envelopes `NO_KEY` / `BUDGET` / `AI_OFF` /
  `ERROR` (the established robustness taxonomy, [`37`](37-ai-output-robustness.md)). The deterministic profile is
  returned regardless; only the narrative needs AI.
- **`tests:deleteResult({ testId, resultId })`** / **`tests:deleteAll({ testId })`** → remove a result / all
  results + (for `deleteAll`) the derived Insight; sender-scoped (own only).
- **18+ ack** reuses the existing channel that writes `guidance/prefs.enc adultAcknowledged`
  ([`16`](16-guided-sessions.md)/[`18`](18-personal-onboarding.md)) — **no new ack channel**.

**Claude (the narrative only).** Input: the **deterministic subscale scores + bands** (never the raw item
answers) + the instrument's framing → a short, warm, **non-diagnostic** narrative; for a sensitive instrument the
prompt is bounded on how it may reference restricted scores (§8, §11). The key stays in main; only the produced
narrative (and, for admins, its `$`) crosses to the renderer. **Metering display** follows `06`: admin-only `$`,
post-hoc, via the usage ring — no new metering surface.

## 7. States & edge cases

Per `00` §7, every surface handles loading / empty / error / offline. Specifically:

- **Empty** — no results → the warm hub empty state (§3.1); a test with no prior result → the catalog card's
  "Take," the result screen is unreachable until taken.
- **Incomplete test / resume** — a partially-answered take is **saved + resumable** (re-entering restores answers
  via the engine); the Score affordance stays disabled until `unansweredRequired` is empty.
- **Retake** — creates a **new dated `TestResult`** (`reTakeOf` set) + a **new trend point**, and **updates** the
  single derived Insight (reuses `insightId`, carries fact sharing forward, §5.4); prior results are **kept**
  (never overwritten) so trends are honest.
- **AI off / no key / over budget** — **scoring still works** (deterministic, free): the profile + bars + trends
  all render. **Only the narrative** needs AI — its button shows a calm "enable AI in Settings" / "budget reached"
  state (the [`37`](37-ai-output-robustness.md)/[`06`](06-ai-usage-and-budgets.md) calm-state pattern), never a
  dead control, never a blocked result.
- **18+ not acked** — the intimacy/sexuality group's catalog cards, items, and results are withheld in the bridge
  (§3.5); the cards show the calm "acknowledge to view" affordance.
- **Crisis-adjacent answer** — an extreme distress/self-harm answer sets the result's `crisisFlag`; the result +
  any narrative **lead with resources** (§8.2). The instrument never "diagnoses" the signal — it's a heuristic
  flag that routes to help.
- **Out-of-range / corrupt answer** — `scoreTest` clamps or omits the bad item from its subscale (total, never
  throws, §5.1); a corrupt `TestResult` file degrades like any vault read (Zod-validated; a malformed file is
  skipped, not crashed).
- **Definition changed after a result** — `TestResult.testVersion` records the definition version at score time;
  a re-scored or re-displayed old result stays honest (the [`08`](08-questionnaires.md) immutable-snapshot
  spirit). We don't silently re-score old results under a new definition.
- **Sync conflict** on a `TestResult`/Insight — vault conflict detection (`00`); never auto-deleted/overwritten;
  surfaced like every other vault file.
- **Per-person switch** — `testStore` resets on `activePerson.id` change; no carryover (the per-person isolation
  rule; the regression that bit insights/conversations, [`20`](20-memory-dashboard.md) §1.1).
- **Large battery** — a long instrument (IPIP-120) renders to the bottom (§3.2), grouped only for tidiness with
  **every group open by default** (CLAUDE.md §12 — no default-collapsed item group hides items).
- **Schema migration** — additive only (`InsightSource += 'test'`, provenance `testId`/`testResultId`); no
  destructive migration. `TestResult` is a new type (no prior format).

## 8. Safety, privacy & honesty

### 8.1 Wellness boundary — NON-DIAGNOSTIC, even for personality

SelfOS remains **wellness/self-help, not medical** (CLAUDE.md §1). Tests **never diagnose, label, or score
diagnostically** — even personality. Every test's intro + result carry the framing **"a reflection of how you
answered today, not a verdict or a diagnosis."** Descriptor bands are plain and **non-pathologizing** ("leans
toward …"), never clinical categories. We **never pathologize**: an attachment "anxious" lean, a high-neuroticism
score, or a kink interest is framed as **self-knowledge**, not a problem. Clinical instruments (PHQ-9, GAD-7, …)
are explicitly out of scope (§2). We embed **public-domain** instruments (IPIP, ECR-R) and **original** items
elsewhere — we **do not reproduce proprietary or copyrighted instrument text** (Love Languages, Erotic Blueprint,
bdsmtest, MBTI, proprietary Enneagram questionnaires); where only a published **structure** exists (Klein grid),
the item phrasings are SelfOS-original. The not-medical line is visible on every test/result surface and in any
narrative.

### 8.2 Crisis routing

Every test/result/answer surface shows the always-present **"Get help now"** crisis footer + curated resources
(static; consistent with [`05`](05-conversations.md)/[`08`](08-questionnaires.md) — no model call needed). A
**crisis-adjacent** answer (an extreme distress/self-harm response an attachment/intimacy item could surface)
sets the result's `crisisFlag` so the **result + any AI narrative lead with concern + resources**, warm and
routing to professional help — never a clinical judgment. The optional narrative prompt is instructed to lead
with resources when the result is crisis-flagged.

### 8.3 Sensitive content, age & restricted results

The **kink** and **sexuality/orientation** tests are **18+** (gated by the shared `adultAcknowledged`, §3.5) and
**sensitive**: their results are written as **`restricted`** Insight facts, which are **relevance-gated** (only
surfaced for an intimacy-topic context, the [`28`](28-portrait-synthesis-optimization.md) selection + §18 §8.4
own-only rule), **owner-visible** (the Owner is the full-access role, [`04`](04-people-roles.md) §8), and **never
broadcast** or fed to anyone else's context. The consensual-adult boundary on the kink inventory is enforced in
content + the model (never a keyword filter), per `@selfos/core/intimacy/topics`. Any AI narrative over a
sensitive result is bounded on how explicitly it may reference the restricted scores (§11 — pending a decision).

### 8.4 Privacy & honesty

- **Self-only + own-context.** A test is about the taker, stored encrypted under their own folder, feeding only
  their own context by default. The bridge is the trust boundary (active-person scope + the 18+ gate).
- **Results never shared without consent.** A non-sensitive result feeds the person's own coach automatically;
  it is **not** shared with anyone else unless the person deliberately scopes it (relationship-scoped sharing,
  [`42`](42-relationship-scoped-sharing.md) — an open question, §11, **not** v1). A sensitive result is never
  shareable.
- **Never surface owner/admin visibility to the person** (the durable rule, 2026-06-15): no copy tells the taker
  an owner/admin can read their results.
- **Honest scores.** Scoring is deterministic + transparent (the same answers always give the same scores); the
  narrative is clearly labelled as an **optional interpretation**, never presented as the "true" you.

## 9. Accessibility

Per [`01`](01-design-system.md) §9:

- The catalog cards, Take form, Score/Retake/Delete actions, the narrative button, and the 18+ acknowledgement are
  **keyboard-operable** with **visible focus** and proper labels/roles. The answering form reuses the
  `@selfos/answering` renderer's a11y (the questionnaire-answering precedent — a non-`<legend>` heading per item,
  per-control `aria-label`, no double-label collision; Likert as a labelled scale).
- **Subscale bars** convey value as **text**, not color alone (a labelled value + a non-color-only bar); the
  descriptor band is text. **Trends** charts carry a text equivalent (a direction-aware label), never color-only
  ([`20`](20-memory-dashboard.md)/§44 precedent).
- The result's produced narrative is a **polite live region** (`role="status"`); the crisis-lead banner is
  announced.
- Responsive ~360px→desktop: the catalog grid + profile cards stack on phones; the subscale bars + trends never
  cause a **horizontal scrollbar** (CLAUDE.md §12 — tested, §10), the long Take form renders to the bottom with no
  default-collapsed group. Reduced-motion respected (no auto-animating bars/charts beyond tokens).

## 10. Testing strategy

Per the DoD (CLAUDE.md §7). Use the established fakes (`SELFOS_FAKE_CLAUDE`) for the narrative; **decrypt the
vault** to assert data, not just the UI; run `pnpm typecheck` after tests (memory `vitest-does-not-typecheck`).

- **Unit (core, the heart — deterministic scoring per instrument):**
  - `scoreTest` **reverse-scoring** correctness: a reverse-keyed item (`'-o2'`) flips on the definition's scale
    (`min+max−value`); a **known-input → known-score vector** per instrument (a hand-computed answers map →
    exact subscale scores) for **IPIP** (five subscale sums), **ECR-R** (anxiety + avoidance **means**),
    **Kinsey/Klein** (the 0–6 values per cell), and the **kink inventory** (per-category aggregation from the
    spec-49 categories).
  - Normalization (raw → 0..1 / −1..1) + band resolution; `scoreTest` is **total** on a missing/out-of-range
    answer (clamps/omits, never throws).
- **Unit (the bridge):** `tests:take` → a `TestResult` is persisted **and** a derived **Insight** (`source:
'test'`, `approved: true`) is written; a **sensitive** test's facts are **`restricted`** (assert restricted +
  own-only); a **retake** reuses `insightId` + sets `reTakeOf` + adds a metric trend point; the **18+ gate** —
  `tests:list`/`:get`/`:take` withhold the sensitive test until `adultAcknowledged`; `tests.own` denial (a Guest
  is refused). The **narrative is the only metered call** — assert `tests:narrate` records `test.narrate` and
  `tests:take` records **nothing**.
- **Component (RTL):** the **You hub** renders the catalog + profile cards (empty + populated); the Take form
  renders Likert items + branching reveals + required gating (Score disabled until complete); the **result
  profile** renders subscale bars (text + non-color-only) + trends (≥2 results); the optional narrative button +
  its AI-off/over-budget calm states; the 18+ gate hides the intimacy group until acked; crisis-lead.
- **E2E (Playwright):** take a test → score → **profile renders** with subscale bars; a **retake** adds a trend
  point; **decrypt** the vault to assert the sensitive **kink** result's Insight facts are **`restricted`** +
  reach the taker's **own** intimacy-topic `buildContext` but are **absent** from a non-intimacy context **and**
  from any other person's context; the deterministic profile renders with **AI off** (only the narrative button is
  gated). Include the **no-horizontal-overflow / inner-scrollbar** guard at ~360px on the hub + Take + result
  surfaces, and the **full-surface-renders-to-the-bottom** guard on the long Take form (every Likert item visible,
  no default-collapsed group, Score reachable).

## 11. Open questions

### Resolved (2026-06-26 — asked the owner before building)

1. **Naming** → **"You"** (`/you`). The hub reads as distinct from Memory (the AI's _inferred_ facts).
2. **Item counts** → **fuller**: Big Five **IPIP-120** (5 domains × 24 items) + Attachment **full ECR-R (36)**.
3. **Auto-feed vs review** → **auto-feed own-context** (recommended): a scored result becomes an `approved: true`
   Insight feeding the taker's own context, reviewable/editable/deletable in Memory.
4. **Kink subscale model** → use **spec 49's 14 `INTIMACY_CATEGORIES`** (`@selfos/core/intimacy/topics`, now built)
   as the kink subscales; the inventory's items are **generated from `intimacyActivitiesByCategory()`** so the two
   stay one source of truth (no hand-authored row list to drift). A per-category branching opt-in reveals each
   category's depth items (`equalsAny` on a multiChoice).
5. **Narrative sensitivity bound** → the optional narrative **may name specifics** (interests/orientation). It still
   leads with the not-medical framing + (when crisis-flagged) resources, and the consensual-adult boundary holds.
6. **Partner-shareability of non-sensitive results** → **own-only v1** (relationship-scoped sharing is a later
   additive slice; sensitive results are never shareable).
7. **Crisis-adjacent flagging** → **conservative**: the four shipped instruments contain **no** distress/self-harm
   items, so no item raises `crisisFlag` in v1. The mechanism (`TestResult`/`Insight.crisisFlag` + a lead-with-
   resources result/narrative) is retained for future instruments; the always-present crisis footer + not-medical
   line are on every surface regardless.

### Original list (LIST — never silently assumed):

1. **Feature / hub naming** — **"You"** (the working title) vs **"Discover"** vs **"Profiles"** (or another). The
   nav label + route (`/you`) hinge on this; it must read as distinct from **Memory** (the AI's inferred facts).
   _Recommendation: "You" (own, deliberate self-knowledge) — confirm._
2. **Exact item counts per instrument** — Big Five **IPIP-120** (richer, ~20 min) vs **IPIP-50** (faster, ~10
   min); Attachment **full ECR-R (36)** vs **short ECR-RS (~12)**. A trade-off of fidelity vs completion. _Need a
   call per instrument (the catalog ids encode the choice, e.g. `bigfive-ipip-50`)._
3. **Auto-feed vs review step** — do scored results **auto-feed** the person's own context (like
   session/dream/intake), reviewable in Memory, **or** require an explicit approve step (like questionnaire
   Insights)? _Recommendation: **auto-feed own-context** (low friction; it's the person's own deliberate
   self-report), reviewable/editable/deletable in Memory — confirm._
4. **The kink inventory's exact subscale model** — the per-category → item mapping **ties to spec 49** (the tiered
   intimacy inventory), which **does not exist yet** (it's referenced as a dependency). Until 49 lands we group the
   current `@selfos/core/intimacy` topics provisionally. _Need spec 49 (or a decision to define the categories
   here) before the kink scorer is final._
5. **How much the AI narrative may reference sensitive results** — the optional "what this means" narrative over a
   **kink/sexuality** result: may it name specific interests/orientation, or stay high-level ("you have clear
   preferences worth honoring")? _Need a boundary — default conservative (high-level), given the restricted nature._
6. **Shareability of non-sensitive results to a partner's coaching** — should **Big Five / attachment** results be
   **relationship-scope-shareable** to a partner's coaching ([`42`](42-relationship-scoped-sharing.md)), or
   **own-only** in v1? _Recommendation: **own-only v1**, with relationship-scoped sharing as a later additive
   slice (sensitive results never shareable)._
7. **Crisis-adjacent flagging** — confirm which instruments/items can raise the heuristic `crisisFlag` (e.g.
   an extreme attachment-anxiety or distress answer) and the exact threshold, so it routes to help without
   over-flagging a normal answer.

## 12. Changelog

- 2026-06-26 — **BUILT** on `feat/self-assessments-tests` (PR pending). The whole feature: the deterministic
  `@selfos/core/tests` engine (`scoreTest` — reverse-scoring/sum/mean/normalize unit|signed/bands, total/
  never-throws) + four `TestDefinition`s (Big Five IPIP-120, Attachment ECR-R 36, Kinsey/Klein sexuality, the
  **kink inventory generated from spec 49's `intimacyActivitiesByCategory()`** — 14 category subscales, branched
  opt-in); the result→Insight bridge (`source:'test'`, `approved:true`, retake reuses `insightId` + `reTakeOf`,
  sensitive results write `restricted` facts tagged `lifeArea:'Intimacy'`); the optional metered narrative
  (`test.narrate`, admin-only `$`); the `tests.own` capability (Member ON) + the shared 18+ ack; the
  test-profile context provider; the IPC seam (`tests:list/get/take/results/narrate/acknowledgeAdult/
deleteResult/deleteAll`, gated + active-person-scoped + 18+-withheld in the bridge); and the "You" hub
  (`/you`, `/you/:testId/take`, `/you/:testId`) with the new `SubscaleBar` primitive (→ `/gallery`). **Privacy:**
  a new relevance gate in `summarizeForContext` (insightStore) feeds a sensitive test insight to the taker's OWN
  intimacy-topic context only — never a money chat, never another person's context (fail-closed when a restricted
  fact lacks a life-area). Additive schema (`InsightSource += 'test'`, provenance `testId`/`testResultId`,
  `TestResult`) — no version bump. Gate green: typecheck/lint/format, **840 core + 816 desktop** unit + a
  coreBridge integration block + 2 E2E (full ECR-R take→profile→retake→trends + AI-off calm narrate + 360px; the
  kink 18+ gate + restricted-fact decrypt + own-vs-non-intimacy context). Code-reviewer **ship** (privacy boundary
  airtight; applied two fail-closed hardenings — `sensitive ⇒ adult` catalog invariant + the no-life-area gate).
- 2026-06-26 — §11 resolved (owner-confirmed) + status → Building on `feat/self-assessments-tests`: hub = **"You"**
  (`/you`); battery = **IPIP-120 + ECR-R 36** + Kinsey/Klein + the kink inventory; results **auto-feed** own context
  (reviewable in Memory); the kink subscales = spec 49's **14 `INTIMACY_CATEGORIES`** with items **generated** from
  `intimacyActivitiesByCategory()`; the narrative **may name specifics**; non-sensitive results **own-only v1**;
  conservative crisis flagging (no v1 item flags; mechanism retained).
- 2026-06-25 — created (Draft). Defines the Self-assessments ("Tests") engine + a first battery of four
  deterministically-scored instruments (Big Five/IPIP, attachment/ECR-R, sexuality/Kinsey-Klein, an original
  kink & intimacy-interests inventory), a dedicated **"You" hub**, the result → Insight (`source: 'test'`) bridge
  with restricted relevance-gating for sensitive results, an optional metered AI narrative (`test.narrate`), the
  `tests.own` capability + the shared 18+ ack, and the test-profile context provider. Locked decisions in §1/§5;
  open questions (naming, item counts, auto-feed vs review, the spec-49 kink subscale tie, narrative sensitivity
  bound, partner-shareability, crisis flagging) in §11.
