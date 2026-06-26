# 51 — Wellbeing & neurodivergence self-reflections

> **Status:** Draft — _last updated 2026-06-25_
>
> A second battery on top of the [`50`](50-self-assessments.md) Tests engine: **non-diagnostic wellbeing &
> neurodivergence self-reflections** — mood, anxiety, ADHD-traits, and autism-traits instruments, presented as
> **gentle self-reflection check-ins, never diagnosis or screening**. Clinically these are validated screeners;
> in SelfOS they are reframed as **"reflections"/"check-ins"** that surface a gentle range, **always** beside the
> line "this is a reflection, not a medical opinion — if it resonates, consider talking to a professional." This
> is the **most safety-sensitive feature in the app**, so it gets its own spec specifically to make the safety
> design (§8) front-and-centre: **crisis routing is mandatory and never optional**, and a positive self-harm /
> suicide answer (PHQ-9 item 9) immediately surfaces crisis resources mid-check-in and feeds the existing
> cross-insight crisis aggregation.

Builds on [`50`](50-self-assessments.md) (the **Tests engine** — `TestDefinition`/`TestResult`/`scoreTest`/the
**"You" hub**/`source: 'test'` Insight bridge; these instruments are just more `TestDefinition`s with a
`wellbeing` category flag + the extra crisis + non-diagnostic handling), [`05`](05-conversations.md) §7 (the
**crisis/safety boundary** — `PERSONA` + `SAFETY` + the always-present `CrisisFooter`), [`40`](40-proactive-coaching.md)
§3.5 (the **cross-insight crisis aggregation** — `aggregateCrisisSignal` + the Home `CrisisSupportBanner`, the
`hasRecentCrisis` it supersedes), [`09`](09-session-analysis.md) §14 (the **mood signal** — `moodValence` /
`moodEnergy` + the Home `WellbeingCard`), [`08`](08-questionnaires.md) (the shared **Insight / metrics layer** +
the `@selfos/answering` answer-type renderer + the `LineChart` trend pattern), [`06`](06-ai-usage-and-budgets.md)
(every AI call metered + budget-gated), and [`00`](00-architecture.md)/[`01`](01-design-system.md) (vault, IPC,
security, primitives + tokens). References, doesn't restate.

CLAUDE.md §1 is the governing constraint: SelfOS is **wellness/self-help, NOT medical, NOT a medical device, NOT
diagnosis**. This spec is the sharpest test of that boundary — it embeds clinically-validated instruments while
**refusing to diagnose** with them.

---

## 1. Overview

### 1.1 What these reflections are (and are not)

A **wellbeing/neurodivergence reflection** is a self-administered, deterministically-scored check-in the person
takes **about themselves** — built on exactly the [`50`](50-self-assessments.md) Tests engine (a `TestDefinition`
with items + a declarative scoring spec → a per-person encrypted `TestResult` with subscale scores → a derived
`Insight` `source: 'test'`). What makes this battery different from spec-50's personality/relationship/intimacy
tests is the **content and the safety handling**, not the machinery:

| Dimension          | Spec-50 tests (Big Five / attachment / intimacy)       | This spec (51 — wellbeing reflections)                                                        |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Source instruments | public-domain personality/relationship + original kink | **clinically-validated screeners** (PHQ-9, GAD-7, ASRS, AQ-10/RAADS-R) — **free to use**      |
| Framing            | "a reflection, not a verdict" (already non-diagnostic) | **"a reflection, not a medical opinion"** — a strictly stronger non-diagnostic reframe (§8)   |
| Crisis             | the always-present `CrisisFooter`; a heuristic flag    | **mandatory, item-level crisis routing** (PHQ-9 item 9) + the §40 cross-insight aggregation   |
| Result display     | subscale bars + descriptor bands                       | a **gentle band/range in non-clinical language**, never the clinical label, never "you have"  |
| Category           | `personality` / `relationships` / `intimacy`           | a **new `wellbeing` test category** (a clearly-separated "Reflections / check-ins" hub group) |
| Re-take            | retakeable (trends)                                    | mood/anxiety **re-takeable to track over time** (the wellbeing trend); ADHD/autism: §11       |

The clinical instruments **are validated screeners**, but **SelfOS does not screen** — a screener implies a
clinical question ("does this person have depression?") with a downstream care pathway. SelfOS reframes them as a
**reflective mirror**: the same items, scored deterministically into the same bands **internally** (so trends are
meaningful), but **displayed** as gentle, non-clinical, non-pathologizing language with an always-present
nudge to a professional. We never tell a person they "have" anything, never name the diagnosis the instrument
screens for, and never present a band as a verdict.

### 1.2 The four instruments

All four are **free to use** (confirmed per-instrument in §8.1) and embedded **verbatim with attribution** where
the licence requires it (WHO/ARC instruments must **not** be modified):

- **Mood — PHQ-9** (Pfizer; free, no permission required). 9 items, 0–3 each → 0–27. **Item 9 is the
  suicidal-ideation item → the crisis trigger** (§5.2/§8.2). Clinical bands minimal/mild/moderate/moderately-severe/severe;
  **displayed** as a gentle reflective range, the band kept internally for trends.
- **Anxiety — GAD-7** (Pfizer; free). 7 items, 0–3 each → 0–21. Clinical bands minimal/mild/moderate/severe;
  displayed reflectively.
- **ADHD traits — ASRS v1.1** (WHO; **free, NO modification allowed**, cite + carry the copyright notice). The
  6-item Part-A screener (and optionally Part B); items scored against the instrument's threshold zones. Displayed
  as a reflection on attention/restlessness patterns, never "you have ADHD."
- **Autism traits — AQ-10 and/or RAADS-R** (ARC / Ritvo; **free, NO modification**, cite). **AQ-10** (short,
  10 items) and/or **RAADS-R** (long, 80 items, more sensitive) — which one(s) ship is a **§11** decision.
  Displayed as a reflection on social/sensory/communication patterns, never "you are autistic."

Each scores **deterministically** into bands (e.g. PHQ-9's five severity bands), **kept internally** on the
`TestResult` for trends, while the **result screen shows non-clinical reflective language** (§3.3/§8.1).

### 1.3 Whole-app fit

Wellbeing check-ins **strengthen the existing mood/crisis signal** and let the coach be more attuned — within the
hard not-medical boundary:

- **The mood signal already exists** — session analysis emits `moodValence`/`moodEnergy` (`09` §14) charted on
  the Home **`WellbeingCard`**. A **mood (PHQ-9) or anxiety (GAD-7) check-in result feeds the SAME wellbeing
  surface + trend** (§5.3, reusing `LineChart`), so a deliberate check-in and the inferred session mood live on
  one coherent picture of how someone's been doing.
- **Crisis aggregation** — a check-in result's `crisisFlag` feeds `aggregateCrisisSignal` (`40` §3.5) exactly
  like a session/dream flag, so recurring distress across check-ins + sessions + dreams surfaces the supportive
  `CrisisSupportBanner` (resources-first, non-dismissible).
- **Proactive coaching** — wellbeing results are own-context `Insight`s, so the coach (Sessions, `05`) is gently
  more attuned ("you mentioned your mood's been low") and the §40 synthesis can connect a low-mood check-in to a
  session theme — **never** as a diagnosis, always as a reflection routed to professional help when it matters.
- **Distinct hub group** — these live in the "You" hub under a clearly-labelled **"Reflections / check-ins"**
  group, visually separated from spec-50's personality tests, so a person never confuses a non-diagnostic mood
  check-in with a "test result."

The check-in result is **structured signal** (a band + a normalized score), not a clinical conclusion — the same
boundary every producer honours.

## 2. Goals / Non-goals

**Goals**

- Add **four wellbeing/neurodivergence instruments** (PHQ-9, GAD-7, ASRS v1.1, AQ-10 and/or RAADS-R) as
  [`50`](50-self-assessments.md) `TestDefinition`s flagged `category: 'wellbeing'`, scored **deterministically**
  into clinically-defined bands **kept internally**, and **displayed as non-diagnostic reflective ranges**.
- An **opt-in entry** with the not-medical framing **first** (before any item), a **check-in flow** the person
  can **stop anytime**, and a **gentle band result** with the **always-present professional-help line**.
- **Mandatory crisis routing**: a positive self-harm/suicide answer (PHQ-9 item 9) or a high overall band surfaces
  the existing `CrisisFooter`/`CrisisSupportBanner` + 988/Samaritans **immediately** (mid-check-in for item 9),
  feeds the `40` `aggregateCrisisSignal`, and is **never gated behind a setting**.
- **Feed the existing wellbeing surface + trend** (mood/anxiety re-takes → the Home `WellbeingCard` picture and a
  per-instrument trend), reusing `LineChart`, with a **recurring re-take cadence** for mood/anxiety.
- **Reuse the spec-50 engine wholesale** — the same `TestResult`, `scoreTest`, IPC channels, "You" hub, and
  `source: 'test'` Insight bridge; this spec adds **content** (instruments) + a **`wellbeing` flag** + the **extra
  crisis + non-diagnostic handling**, not a new engine.
- **Deterministic + free scoring** — no AI needed to score or to route crisis (both work offline / AI-off); the
  optional AI narrative reuses `test.narrate` but is **extra-careful** (non-diagnostic, supportive) over wellbeing
  results.

**Non-goals (deferred / owned elsewhere)**

- **Diagnosis, screening, a risk score, or a care plan** — explicitly out. SelfOS reframes the instruments as
  reflections; it never diagnoses, never screens, never produces a clinical severity verdict to the person (§8).
- **A new Tests engine, "You" hub, or scoring framework** — all reused from [`50`](50-self-assessments.md); this
  spec is a **content + safety** layer on it.
- **Sending a wellbeing check-in to someone else / 360°** — these are **self-only** (the spec-50 rule); a
  wellbeing result is **never** shareable to anyone else's coaching (§8.4) — stronger than spec-50's "own-only v1"
  default for personality results.
- **A second AI provider / images** — N/A; the only AI here is the optional, bounded text narrative.
- **Scheduled OS-level / push reminders** — any re-take cadence is **renderer-driven on app events** (the
  spec-36/40 cadence precedent), never a main-process cron; whether mood/anxiety re-takes are **nudged** vs
  passive is a §11 decision.
- **Clinical follow-up, referral integration, or telehealth** — out of scope; the boundary routes to **public
  crisis/professional resources**, it does not connect to care.

## 3. UX & flows

These instruments register **into the existing [`50`](50-self-assessments.md) "You" feature module** as more
`TestDefinition`s — **no new nav entry, no new routes** beyond what spec 50 owns (`/you`, `/you/:testId`,
`/you/:testId/take`). The change is a **new catalog group** ("Reflections / check-ins"), the `wellbeing` flag's
extra handling, and the mandatory crisis behaviour. Every check-in/result surface shows the always-present
`CrisisFooter` + not-medical line (§8, inherited from spec 50).

### 3.1 Entry — the "Reflections / check-ins" group in the You hub (`/you`)

The You hub (`50` §3.1) gains a **distinct group** under the personality/relationship/intimacy groups: a
clearly-labelled **"Reflections & check-ins"** section with its own one-line framing — _"Gentle check-ins on how
you've been feeling and how your mind works — reflections, not diagnoses."_ Each instrument is a card: the
instrument's **reflective name** (e.g. **"Mood check-in"**, **"Anxiety check-in"**, **"Focus & attention
reflection"**, **"Social & sensory reflection"** — never the clinical instrument name as the headline; the family
tag e.g. "based on PHQ-9" is shown small for transparency), what it reflects on, item count + estimated time, the
**non-diagnostic** one-liner, and **Take / Check in**. There is **no 18+ gate** on this group (these are
wellbeing, not intimacy) — but they are **adult-framed** (§8.3 / §11 age-gating).

For **mood/anxiety** the person has taken before, the card shows a compact "last checked in N days ago" + a tiny
trend sparkline (or just "Open" → the result with its trend). The group is reachable to any `tests.own` Member;
crisis surfaces regardless of any setting (§8.2).

### 3.2 Opt-in & the check-in flow

1. **Intro (the framing comes FIRST).** Before any item, a calm intro screen states, **prominently and first**:
   the **not-medical reframe** ("This is a reflection to help you notice how you've been — **not** a diagnosis, a
   screening, or medical advice"), what the check-in reflects on, the item count + time, the instrument
   attribution (small, for transparency), and a clear **"you can stop anytime"** affordance. The person taps
   **Begin** to proceed — these are **opt-in**, never auto-started.
2. **Answer.** Items render with the **`@selfos/answering`** renderer (`08` §5.3 / `50` §3.2) over the same
   `TestDefinition.items` (the questionnaire `Question` shape) — typically a **Likert grid** (PHQ-9/GAD-7's "Not
   at all → Nearly every day" 0–3 scale; ASRS/AQ's frequency scales). The verbatim instrument items are embedded
   **unmodified** (§8.1). A **required item is NOT auto-seeded** (it stays unanswered until the person moves it —
   the `27`/§16 precedent — so a midpoint is never silently assumed). Progress is **saved + resumable** (§7). A
   persistent **"Stop check-in"** affordance lets the person leave at any point (their partial answers are kept,
   resumable; nothing is scored until they finish).
3. **Mid-check-in crisis interception (§5.2/§8.2).** The moment the person answers **PHQ-9 item 9** (the
   suicidal-ideation item) with **any positive response**, the crisis surface appears **immediately, inline** —
   the `CrisisFooter` is already always present, but a positive item-9 answer **escalates** it to a prominent,
   warm, resources-first banner ("It sounds like you've been having a really hard time — please reach out to
   someone who can help right now") shown **before** the person even finishes the check-in. The person can still
   finish (or stop); the crisis surface persists.
4. **Finish → score (deterministic, instant, free).** When all required items are answered, **Score** runs the
   deterministic scorer (§5.1) — **no model call, no budget check**. The person lands on the **result** (§3.3). A
   check-in **never** spends budget to score or to route crisis.

The check-in renders **to the bottom** with no default-collapsed item group (the DoD "full surface renders" rule,
CLAUDE.md §7): every item visible, no `<details>` defaulting closed, Score reachable.

### 3.3 The result — a gentle band, the help line always, crisis when triggered

On `/you/:testId` (the spec-50 result screen, with the wellbeing handling):

- **Header** — the reflective name (e.g. "Your mood check-in"), `takenAt`, and a **non-diagnostic preamble**:
  _"A snapshot of how you answered today — a reflection, not a diagnosis."_
- **The gentle range (NOT the clinical label).** Instead of "moderately severe depression," the result reads as a
  warm, plain-language band: e.g. _"Your responses suggest you've been carrying a lot of low mood lately"_ /
  _"…a fair amount of worry recently"_ / _"…patterns of restlessness and distraction you might relate to"_ /
  _"…some social/sensory experiences that may resonate."_ The **internal clinical band** (minimal…severe) drives
  the trend + the crisis routing but is **never shown as a clinical category**. A single value bar may show
  "where today's answers landed" on a gentle low→high spectrum (non-color-only, value as text), with **no clinical
  axis labels**.
- **The ALWAYS-PRESENT professional-help line.** Every wellbeing result carries, prominently:
  _"This is a reflection, not a medical opinion. If this resonates, it can really help to talk to a professional —
  a doctor or therapist can offer support a self-help tool can't."_ This line is **not optional and not
  dismissible** — it is part of every wellbeing result render (§8.1).
- **Crisis lead when flagged.** If the result is `crisisFlag` (a positive item-9 answer or a high overall band,
  §5.2), the result **leads with concern + resources** (the `CrisisSupportBanner` register + 988/Samaritans),
  **above** the band/range — warm, routing to professional help, never a clinical judgment.
- **Trend (mood/anxiety; ≥2 results).** A collapsible per-instrument **`LineChart`** of the gentle score over
  re-takes (reusing the `20`/`44` metrics-over-time pattern + the `LineChart` primitive), framed gently — "how
  this has shifted lately," never clinical — and contributing to the Home wellbeing picture (§5.3). For
  ADHD/autism, retake vs one-time is a **§11** decision (traits are stable).
- **"What this means for you" (optional AI, extra-careful).** A **button**, not auto-run: tapping spends
  `test.narrate` (`50` §6; metered + budget-gated) to generate a short, warm, **strictly non-diagnostic,
  supportive** reflection from the **deterministic band** (never the raw answers). The prompt is **extra
  bounded for wellbeing** (§8.1/§8.2): it must **never** name a diagnosis, never say "you have," lead with
  resources if crisis-flagged, and end with the professional-help nudge. Calm AI-off / over-budget states (the
  deterministic band + the help line + crisis routing **always** render without AI — §7).
- **History** — prior dated results (each openable; the current one highlighted).
- **Manage** — **Check in again** (→ §3.2; mood/anxiety) and **Delete this result** / **Delete all results**
  (removes the result(s) + their derived Insight, `50` §5.4) — so a person can clear a sensitive wellbeing record
  entirely.

### 3.4 Recurring re-take to track over time

Mood/anxiety check-ins are designed to be **re-taken** so the person can watch how they've been over weeks: each
re-take creates a **new dated `TestResult`** (`reTakeOf` set) + a **new trend point**, and **updates** the single
derived Insight (the spec-50 retake path). A gentle prompt to "check in again" may surface on the result + the You
hub card ("It's been a while since your last mood check-in"); **whether a worsening trend proactively nudges (via
[`40`](40-proactive-coaching.md)) vs stays passive is a §11 decision** — the default must be **gentle and never
alarmist** (§8.2). ADHD/autism reflections measure **stable traits**, so retake/one-time is **§11**.

### 3.5 Result → context (what feeds the coach)

A scored result **auto-feeds the person's own context** (the spec-50 default; `source: 'test'`, `approved: true`,
`subjectPersonId` = the taker) so the coach is gently more attuned. A wellbeing result's facts are plain,
non-pathologizing (e.g. "Has been experiencing low mood lately (a self-reflection, not a diagnosis)"), the
`metrics` carry the normalized gentle score (for the trend + the Home picture), and the provenance deep-links to
the result. A `crisisFlag` result sets the Insight's `crisisFlag` so it feeds `aggregateCrisisSignal` (`40` §3.5).
The result is reviewable/editable/deletable in **Memory** (`20`) like any Insight. **Wellbeing facts are never
broadcast / never shared with anyone else's context** (§8.4) — stronger than spec-50's personality default.

### 3.6 Admin-only surfaces

The optional narrative's **cost** follows the established **admin-only-`$`** rule (`06`; memory
`selfos-usage-budget-rules`) via the usage ring + the standard `AdminOnlyBadge` — no new metering surface. There
are no other admin-only surfaces (these are own-data, own-context). **No copy ever tells the person an owner/admin
can read their wellbeing answers** (the durable rule, CLAUDE.md §1) — wellbeing data is the most sensitive case of
it.

## 4. Data model (vault files & schemas)

All persisted formats are **Zod-backed** (`z.infer` types), written through the vault/crypto service (`00` §4 /
`04` §5); the renderer never touches `fs`. This spec **reuses [`50`](50-self-assessments.md)'s `TestResult`**
unchanged — wellbeing check-ins produce ordinary `TestResult`s — and adds only **content** (the four
`TestDefinition`s) + small **additive** flags on `TestDefinition` for the wellbeing/crisis handling.

### 4.1 Vault layout (no new files)

Reuses spec 50's layout exactly:

```
vault/
  people/<person-id>/
    tests/<result-id>.enc        # a TestResult (50 §4.3) — one per check-in; re-takes add new files
    insights/<insight-id>.enc    # the derived Insight (source: 'test') — 50 §5.4
```

A wellbeing **`TestDefinition` is code, not vault** (the curated catalog, like `guidedCatalog`) — so the verbatim
instrument items + scoring live in `@selfos/core/tests/wellbeingCatalog.ts`, not a vault file. Only the person's
**answers + bands** persist (encrypted, own folder). **No per-device state** is added by this spec (a re-take
cadence marker, if §11 chooses one, rides the device-state store like the §40 throttle).

### 4.2 `TestDefinition` additions (additive — flags on the spec-50 type)

The spec-50 `TestDefinition` (`50` §4.2) is extended with **optional** fields for the wellbeing handling. All
additive; a spec-50 personality test (without them) is unchanged.

```ts
// @selfos/core/tests/testCatalog.ts — extends the spec-50 TestGroupId + TestDefinition (additive)
type TestGroupId = 'personality' | 'relationships' | 'intimacy' | 'wellbeing'; // + 'wellbeing'

interface TestDefinition {
  // …all spec-50 fields (id, group, title, instrument, blurb, framing, estimatedMinutes,
  //   adult?, sensitive?, items, scoring)…

  /** This instrument is a wellbeing/neurodivergence reflection (51). Drives: the "Reflections / check-ins"
   *  hub group, the stronger non-diagnostic result copy (§3.3/§8.1), and the always-present professional-help
   *  line. Personality/relationship/intimacy tests leave it unset. */
  wellbeing?: boolean;

  /** Item ids that, when answered with a value at/above {@link crisisItem.atOrAbove}, raise the result's
   *  `crisisFlag` IMMEDIATELY (mid-check-in, §5.2/§8.2). PHQ-9's item 9 (suicidal ideation) is the canonical
   *  case. Deterministic + AI-free. Multiple items allowed. Omitted ⇒ no item-level crisis trigger (only the
   *  overall-band trigger, if any, applies). */
  crisisItems?: { questionId: string; atOrAbove: number }[];

  /** The internal clinical band thresholds (kept on the result, NEVER shown clinically). Each band maps a raw
   *  total range → an INTERNAL clinical key (e.g. 'moderately-severe') AND a non-diagnostic DISPLAY copy + a
   *  normalized 0..1 the trend uses. The display copy is what the person sees (§3.3/§8.1). The highest band(s)
   *  may set `crisis: true` to raise `crisisFlag` on a high overall score (§5.2). */
  bands?: WellbeingBand[];

  /** The required instrument licence attribution shown on intro + result for transparency (§8.1). For WHO/ARC
   *  instruments (ASRS/AQ/RAADS) this carries the mandatory copyright notice verbatim. */
  attribution: string;
}

interface WellbeingBand {
  upToRaw: number; // inclusive upper bound of the raw total for this band
  clinicalKey: string; // INTERNAL only — e.g. 'minimal' | 'mild' | 'moderate' | 'moderately-severe' | 'severe'
  display: string; // the NON-diagnostic, plain-language copy shown to the person (§3.3/§8.1)
  normalized: number; // 0..1, the gentle score the trend + Insight metrics use
  crisis?: boolean; // a high overall band that should also raise `crisisFlag` (§5.2) — e.g. PHQ-9 'severe'
}
```

`crisisItems` + `bands` are evaluated by the **deterministic** scorer (§5.1/§5.2) — **no AI is ever involved** in
scoring or crisis detection. The verbatim items live in `TestDefinition.items` (the questionnaire `Question`
shape) **unmodified** for WHO/ARC instruments (§8.1).

### 4.3 `TestResult` — reused, with the band kept internally

No new `TestResult` shape — wellbeing check-ins use spec-50's `TestResult` (`50` §4.3). The deterministic result
populates:

- **`scores`** — one `TestSubscaleScore` for the instrument's total (the gentle normalized value), `band` set to
  the **internal `clinicalKey`** (kept for trends; the **display** copy is resolved from the definition's
  `WellbeingBand.display` at render, never persisted as the shown label — so changing the wording later doesn't
  rewrite history). For multi-subscale instruments (RAADS-R has subscales) each subscale is its own
  `TestSubscaleScore`.
- **`crisisFlag`** — _As a heuristic, the result-level crisis decision (item-level or band-level, §5.2) is carried
  to the bridge so the Insight is `crisisFlag`._ (Stored on the derived Insight, not a new `TestResult` field —
  `Insight.crisisFlag` already exists, `schemas.ts:707`.)

### 4.4 Shared Insight / metrics layer — reused from spec 50

- **`InsightSourceSchema`** already gains `'test'` in [`50`](50-self-assessments.md) §4.4 — wellbeing results use
  it (no further change). A wellbeing `Insight` is an ordinary `source: 'test'` insight with `crisisFlag` set when
  appropriate (the existing optional `Insight.crisisFlag`, `schemas.ts:707`) and `categories` including
  **`'Emotions & patterns'`** / **`'Health & body'`** (the existing `LIFE_AREAS`) so it groups sensibly in
  Memory and is treated as distress-adjacent by the existing never-narrow-distress rules.
- **Provenance** reuses spec-50's `testId` / `testResultId` (`50` §4.4) for the Memory deep-link to `/you/:testId`.
- **No new `Insight` field** is required (`crisisFlag`, `metrics`, `categories` all exist). **No `schemaVersion`
  bump** beyond what spec 50 already makes (additive enum + optional provenance).

### 4.5 Capability & settings

- **Capability** — reuses spec-50's **`tests.own`** (Member default ON; the Owner via the full-access bypass).
  Taking a wellbeing check-in about yourself is ordinary; it is **not** `EXPLICIT_GRANT_ONLY`. **Whether wellbeing
  reflections additionally want their own explicit opt-in setting beyond `tests.own`** (given their sensitivity)
  is a **§11** decision — the recommendation is the framing-first intro (§3.2) is the opt-in, with **no extra
  setting** (an extra toggle to "enable" a safety-routed reflection risks a person turning off the very thing that
  routes them to help). **Crisis routing is never behind any setting** (§8.2).
- **Settings** — no new settings required v1 (scoring + crisis routing need no config; the narrative reuses the
  global AI enablement + budgets, `06`). _(N/A — no schema-driven settings declarations beyond what `06`/`50`
  own, pending the §11 opt-in decision.)_

### 4.6 Ownership

All reads/writes go through the vault/crypto service (`00` §3). `TestResult`s are encrypted under the master key
in the taker's own folder; `TestDefinition`s (the verbatim instrument items + scoring + attribution) are code.

## 5. Architecture & modules

These instruments register **into [`50`](50-self-assessments.md)'s "You" feature module** — no new feature module,
nav entry, or routes. The additions are: the wellbeing catalog (content), the deterministic crisis-detection hook
in scoring, the wellbeing-trend feed, and the extra-careful narrative bounding. The shell is untouched.

### 5.1 The wellbeing catalog + deterministic scoring (`@selfos/core/tests`)

- **`@selfos/core/tests/wellbeingCatalog.ts`** ships the four `TestDefinition`s — verbatim PHQ-9 / GAD-7 items,
  the WHO ASRS v1.1 items + copyright notice, and the AQ-10 and/or RAADS-R items (per §11) — each with
  `category: 'wellbeing'`, its `bands`, its `crisisItems` (PHQ-9: item 9), its `attribution`, and a `scoring`
  spec. They merge into the spec-50 catalog (`tests:list` returns all groups; the renderer groups by
  `TestGroupId`).
- **Scoring reuses spec-50's `scoreTest`** (`50` §5.1) — the wellbeing instruments are summative (a raw total →
  a band), which the existing `subscales`/`sum` path covers (a single subscale = the instrument total). A small
  **band-resolution step** maps the raw total → the internal `WellbeingBand` (the `clinicalKey` + `normalized` +
  `crisis`). `scoreTest` stays **total** (never throws): a missing/out-of-range answer clamps/omits (`50` §5.1).
  **All scoring + band resolution + crisis detection is AI-free** — pure arithmetic, free, offline, instant.

### 5.2 The crisis-detection hook in scoring (`@selfos/core/tests/wellbeingCrisis.ts`)

A pure, deterministic, **AI-free** helper — the heart of this spec's safety:

```ts
// Pure: given a definition's crisisItems/bands + the person's answers (+ the resolved band), decide whether the
// result is crisis-flagged. NEVER throws, NEVER calls a model. Two independent triggers (either ⇒ flag):
//   (1) ITEM-LEVEL: any `crisisItems` question answered at/above its `atOrAbove` (PHQ-9 item 9 positive).
//   (2) BAND-LEVEL: the resolved band has `crisis: true` (a high overall score, e.g. PHQ-9 'severe').
export function detectWellbeingCrisis(
  def: TestDefinition,
  answers: AnswerMap,
  band?: WellbeingBand,
): boolean;

// For the MID-CHECK-IN interception (§3.2 step 3) — evaluated by the renderer as each item is answered, BEFORE
// the whole check-in is finished/scored, so a positive item-9 surfaces crisis resources immediately. Pure.
export function answerTriggersCrisis(
  def: TestDefinition,
  questionId: string,
  value: number,
): boolean;
```

- **`tests:take`** (`50` §6) runs `scoreTest` → resolves the band → `detectWellbeingCrisis` → sets the derived
  **Insight's `crisisFlag`** (so the result + any narrative lead with resources, and the Home aggregation picks
  it up). This rides the existing free `tests:take` path — **no AI, no budget**.
- **Mid-check-in** the renderer calls `answerTriggersCrisis` on each item change (the Take form already tracks
  answers) and, on `true`, **immediately escalates the always-present `CrisisFooter` to a prominent
  resources-first banner** (§3.2 step 3) — no IPC round-trip needed (pure, client-evaluable from the definition;
  the definition is already in the renderer for rendering items). The bridge **still** authoritatively sets the
  result's `crisisFlag` at score time (the renderer surface is a safety convenience, the bridge is the record).

### 5.3 Feeding the wellbeing surface + the §40 aggregation

- **The Home wellbeing picture** (`WellbeingCard`, `09` §14) currently charts the session mood metrics
  (`moodValence`/`moodEnergy`). A mood/anxiety check-in result is an own-context Insight carrying a normalized
  gentle score in `metrics`; the Home composition (`17`) **folds wellbeing check-in points into the same picture**
  (a check-in mood point alongside session mood points, or a sibling "your check-ins" series — the exact blend is
  a small §11 refinement), so a deliberate check-in and inferred session mood read as one coherent trend. The
  per-instrument trend on the result screen (§3.3) reuses `LineChart` directly.
- **The crisis aggregation** — a wellbeing result's `crisisFlag` makes its Insight crisis-flagged, so the existing
  **`aggregateCrisisSignal`** (`40` §3.5, over the person's own insights) counts it toward "recurring distress,"
  surfacing the supportive `CrisisSupportBanner`. **No change to `aggregateCrisisSignal`** — it already reads any
  `source` insight's `crisisFlag`; a `source: 'test'` wellbeing insight feeds it for free.

### 5.4 The result → Insight bridge (reused, with wellbeing facts)

Reuses spec-50's **`@selfos/core/tests/testService.ts`** bridge (`50` §5.4): `takeTest` → persist the
`TestResult` → build/update the `Insight`. For a wellbeing instrument:

- **Facts** are plain + non-pathologizing, **explicitly framed as a self-reflection, not a diagnosis** (e.g.
  "Reflected that their mood has been low lately (self-reflection, not a clinical finding)"). `shareable: false`,
  and **never `shareableWith`/`shareableTypes`** (wellbeing facts are never shared — §8.4).
- **`metrics`** = the gentle normalized score(s) (for the trend + the Home picture).
- **`crisisFlag`** set per `detectWellbeingCrisis` (§5.2).
- **`categories`** include `'Emotions & patterns'` / `'Health & body'` (existing `LIFE_AREAS`) so the never-narrow-distress
  rules (`28`/§39) keep it in context.
- **Retake** reuses the prior result's `insightId` (the single "mood reflection" Insight is updated, not
  duplicated); the new `TestResult` is a new file + a new trend point (`50` §5.4).
- **Deletion** (`50` §5.4 / `20` §3.7): deleting a result removes the file; deleting all results removes the
  derived Insight — so a person can fully clear a sensitive wellbeing record.

### 5.5 The optional narrative — extra-careful wellbeing bounding

Reuses spec-50's `tests:narrate` (`50` §6) but the **prompt is extra-bounded for a `wellbeing` instrument** (§8):
its input is the **deterministic band + the instrument's framing** (never the raw item answers, never a
diagnosis), and it is instructed to (a) **never name a diagnosis or say "you have,"** (b) stay warm + reflective,
(c) **lead with resources when the result is crisis-flagged**, and (d) **end with the professional-help nudge**.
The API key stays in main; only the produced narrative (and, for admins, its `$`) crosses to the renderer. The
deterministic band + the help line + crisis routing **always** render regardless of the narrative (§7).

### 5.6 Renderer

- Reuses spec-50's `testStore` + the You hub + Take form + result screen (resets on `activePerson.id` — the
  per-person isolation rule, `50` §5.6). This spec adds: the **"Reflections / check-ins" group** rendering in the
  hub, the **mid-check-in crisis escalation** (the prominent banner on `answerTriggersCrisis`, §5.2), the
  **gentle-band result copy** + the **always-present professional-help line** + the **crisis lead** (§3.3), and
  **folding wellbeing points into the Home wellbeing picture** (§5.3).
- No new design-system primitive is expected (the crisis banner reuses `Banner` / the `CrisisSupportBanner`
  register; bars + trends reuse spec-50's). If a genuinely new primitive emerges → `/gallery` (DoD §12).
- The answering form reuses `@selfos/answering` (passing the Sessions `CrisisFooter` so behaviour is
  byte-identical, `08` §5.3) — verbatim items, a non-auto-seeded Likert (§3.2).

## 6. IPC / API contracts

**Reuses [`50`](50-self-assessments.md)'s channels unchanged** — wellbeing check-ins are ordinary tests. All
gated by **`tests.own`** + **active-person-scoped in the bridge** (the trust boundary — a person can only take/read
their own check-ins). Specifically:

- **`tests:list`** → the catalog including the **wellbeing group** (no 18+ filtering applies to wellbeing — it is
  not adult-gated, §3.1). No request body.
- **`tests:get({ testId })`** → a wellbeing definition's verbatim items + metadata (bands/crisisItems are needed
  by the renderer for the mid-check-in interception, §5.2).
- **`tests:take({ testId, answers })`** → **deterministically score** (`scoreTest`), resolve the band, run
  `detectWellbeingCrisis`, persist the `TestResult`, bridge the Insight with `crisisFlag` set as appropriate
  (§5.4); **no AI, no budget check** (free). **A crisis-flagging result is reflected in the returned result** so
  the renderer leads with resources (§3.3). Answers + testId Zod-validated in the bridge.
- **`tests:result({ testId })`** / **`tests:listResults({ testId })`** → the latest / all dated wellbeing results
  (the history + the trend series), newest first.
- **`tests:narrate({ testId, resultId })`** → the **optional** AI reflection — the spec-50 `06` path
  (`checkBudget → call → recordUsage` with `type: 'test.narrate'`), with the **extra wellbeing bounding** (§5.5).
  Typed envelopes `NO_KEY` / `BUDGET` / `AI_OFF` / `ERROR` (`37`). The deterministic band + help line + crisis
  routing return regardless; only the narrative needs AI. **`tests:take` records NO usage** (scoring is free) —
  the narrative is the only metered call.
- **`tests:deleteResult` / `tests:deleteAll`** → remove a result / all results (+ the derived Insight) — own only.
- **Crisis aggregation** rides the existing renderer-computed `aggregateCrisisSignal` (`40` §3.5) — **no new
  channel** (a wellbeing Insight's `crisisFlag` feeds it like any other).

**Claude (the narrative only).** Input: the **deterministic band + framing** (never the raw answers, never a
diagnosis) → a short, warm, **non-diagnostic, supportive** reflection that leads with resources when crisis-flagged
and ends with the professional-help nudge (§5.5/§8). `extendedThinking: false` (the bounded-JSON rule, memory
`[[adaptive-thinking-shares-maxtokens]]`), meter-before-parse, tolerant parse + honest reasons (`37`). The key
stays in main; metering display follows `06` (admin-only `$`, post-hoc, via the usage ring).

## 7. States & edge cases

Per `00` §7 — every surface handles loading / empty / error / offline. Specifically:

- **Empty** — no wellbeing results → the hub group's "Check in" cards; a result screen is unreachable until taken.
- **Incomplete / resume** — a partially-answered check-in is **saved + resumable** (the engine restores answers);
  Score stays disabled until `unansweredRequired` is empty. The **"Stop check-in"** affordance leaves with answers
  kept (nothing scored).
- **PHQ-9 item 9 positive (mid-check-in)** — the moment item 9 is answered with any positive value,
  `answerTriggersCrisis` fires and the **crisis resources surface immediately, inline** (§3.2 step 3 / §5.2),
  **before** the check-in is finished. The person can finish or stop; the surface persists. At score time the
  result's `crisisFlag` is set authoritatively in the bridge (the renderer surface is the safety convenience).
- **High overall band** — a `crisis: true` band (e.g. PHQ-9 'severe') also raises `crisisFlag`; the result leads
  with resources (§3.3/§5.2).
- **AI off / no key / over budget** — **scoring + band resolution + crisis routing all still work** (deterministic,
  free, AI-free): the gentle band, the professional-help line, and the crisis surface **always** render. **Only
  the narrative** needs AI — its button shows a calm "enable AI in Settings" / "budget reached" state (the
  `37`/`06` calm-state pattern), **never** a dead control, **never** a blocked result, **never** a blocked crisis
  surface (the safety path is independent of AI — the single most important edge case here).
- **Worsening trend** — a declining mood/anxiety trend may surface a **gentle** "want to check in?" prompt and (if
  §11 chooses) a §40-coordinated nudge — **never alarmist, never a diagnosis** (§8.2). The default is **passive +
  gentle** pending §11; a worsening trend never auto-spends and never implies a clinical conclusion.
- **Repeated low scores** — multiple low-mood check-ins make the Insight + the aggregation surface the supportive
  banner (recurring distress, `40` §3.5); the coach is gently more attuned (§5.4). Still framed as reflection +
  routed to professional help, never as escalating diagnosis.
- **Out-of-range / corrupt answer** — `scoreTest` clamps/omits the bad item (total, never throws, `50` §5.1); a
  corrupt `TestResult` degrades like any vault read (Zod-validated; a malformed file is skipped, not crashed).
- **Definition changed after a result** — `TestResult.testVersion` records the definition version at score time
  (`50` §4.3); we don't silently re-score old results. The internal `clinicalKey` is kept on the result; the
  **display** copy is resolved from the current definition (so improving the wording later doesn't rewrite a
  stored "label" — there is no stored shown-label).
- **Sync conflict** on a `TestResult`/Insight — the vault conflict detection (`00`) applies; never auto-deleted/overwritten;
  surfaced like every other vault file.
- **Per-person switch** — `testStore` resets on `activePerson.id` (`50` §5.6); no carryover (the per-person
  isolation rule); a crisis surface for one person never shows for another.
- **Long instrument (RAADS-R, 80 items)** — renders to the bottom (§3.2), grouped only for tidiness with **every
  group open by default** (CLAUDE.md §12 — no default-collapsed item group hides items, especially not item-9-bearing
  groups; PHQ-9's item 9 must never sit inside a collapsed accordion).
- **Schema migration** — additive only (the `wellbeing`/`crisisItems`/`bands`/`attribution` `TestDefinition`
  flags are code, not persisted; `TestResult`/`Insight` are reused). No destructive migration.

## 8. Safety, the non-diagnostic reframe & crisis routing

**This is the largest, most important section.** SelfOS embeds clinically-validated instruments while **refusing
to diagnose** with them. Everything here is a hard requirement, not a preference (CLAUDE.md §1; `05` §7; `40` §8).

### 8.1 Licensing, attribution & the non-diagnostic reframe (the heart)

**Licensing (confirm in the build; embed VERBATIM with attribution where required):**

- **PHQ-9** — developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues; an
  educational grant from **Pfizer Inc.** **No permission required to reproduce, translate, display, or
  distribute.** Embed the items verbatim with a "developed by … / no permission required" attribution.
- **GAD-7** — same authorship/grant (Pfizer); **no permission required.** Embed verbatim with attribution.
- **ASRS v1.1** — the **WHO Adult ADHD Self-Report Scale.** **Free to use, but the instrument must NOT be
  modified**, and the WHO **copyright notice must be reproduced** with it. Embed the items verbatim and carry the
  WHO copyright notice in `TestDefinition.attribution` (shown on intro + result).
- **AQ-10 / AQ / RAADS-R** — the **Autism Research Centre (ARC)** AQ instruments and the **Ritvo Autism Asperger
  Diagnostic Scale-Revised (RAADS-R, Ritvo et al.)** are **free for use but must NOT be modified** and must be
  **cited**. Embed verbatim, unmodified, with the required citation in `attribution`.

→ **We do not modify the items** of any WHO/ARC instrument (a licence condition and a validity requirement). The
attribution (and WHO/ARC copyright notice) is shown on the intro + result for transparency.

**The non-diagnostic reframe — rules (every wellbeing surface):**

1. **Never a diagnosis, never "you have X."** The result **never** shows the clinical instrument's diagnosis name
   (depression, GAD, ADHD, autism) as the headline, **never** says "you have / you are," and **never** presents a
   band as a clinical category. The internal clinical band (minimal…severe) is **kept internally** for trends +
   crisis routing only.
2. **Gentle ranges, not labels.** Results are shown as warm, plain-language ranges ("your responses suggest you've
   been carrying a lot of low mood lately"), with **non-pathologizing** descriptor copy.
3. **The always-present professional-help line.** Every wellbeing result carries, prominently and non-dismissibly:
   _"This is a reflection, not a medical opinion. If this resonates, it can really help to talk to a professional."_
4. **"Reflection / check-in," not "test / screen / assessment."** The hub group, card names, intro, and result use
   reflective language; the clinical instrument name appears only as a small transparency tag (e.g. "based on
   PHQ-9").
5. **The narrative obeys the same rules** (§5.5): no diagnosis, no "you have," resources-first if crisis-flagged,
   ends with the help nudge.

**Regulatory / positioning rationale.** A diagnosis or a clinical severity verdict delivered to a user, with a
care pathway, is the kind of claim that makes a tool a medical device. SelfOS deliberately stays a **reflective
mirror**: the same validated items, scored deterministically and transparently, but **reframed as self-reflection**
and **always routed to a professional** — so it never claims to diagnose, screen, treat, or assess. This is the
boundary CLAUDE.md §1 mandates; this spec makes it concrete for the highest-risk content.

### 8.2 Crisis routing — mandatory, never optional

Crisis routing is the **non-negotiable** core of this feature (CLAUDE.md §1; `05` §7; `40` §3.5):

- **Always-present resources.** Every check-in/result/answer surface shows the always-present **"Get help now"**
  `CrisisFooter` + curated static resources (988 / text HOME to 741741 / Samaritans 116 123 / findahelpline.com) —
  **no model call needed** (`05`/`08` precedent), consistent app-wide.
- **Item-level (PHQ-9 item 9).** **Any positive response to the self-harm/suicide item raises `crisisFlag`** and,
  **mid-check-in** (the moment it's answered, before scoring), **escalates** the footer to a prominent,
  resources-first banner (§3.2 step 3 / §5.2). The person can still finish or stop; the surface persists. This is
  the single most important behaviour in the spec.
- **Band-level (high overall).** A high overall band (e.g. PHQ-9 'severe', `WellbeingBand.crisis`) also raises
  `crisisFlag`, so the result **leads with concern + resources** above the gentle range.
- **Result + narrative lead with resources** when crisis-flagged — warm, routing to **professional help /
  emergency services**, never a clinical judgment, never an attempt by SelfOS to "manage" the crisis. The optional
  narrative prompt is instructed to lead with resources on a crisis-flagged result (§5.5).
- **Feeds the §40 aggregation.** A crisis-flagged wellbeing Insight feeds `aggregateCrisisSignal` (`40` §3.5), so
  recurring distress across check-ins + sessions + dreams surfaces the supportive `CrisisSupportBanner` (Home,
  resources-first, non-dismissible).
- **NEVER gated behind a setting.** Crisis routing — the always-present footer, the item-9 escalation, the
  band-level lead, the §40 aggregation — is **independent of every setting** (`tests.own`, the AI toggle, the §40
  proactivity level, any §11 opt-in). It works **offline / AI-off** (deterministic). A person can never turn it
  off, and it never requires AI.

### 8.3 Sensitive content & age-appropriateness

- These reflections are **adult-framed** — written for an adult reflecting on their own wellbeing. They are **not**
  18+ intimacy content, so there is **no `adultAcknowledged` gate** on the wellbeing group (§3.1). Whether they
  need a separate **age gate** (these are adult-framed mental-health instruments; a minor should arguably reach a
  youth-appropriate resource instead) is a **§11** decision — the recommendation is to keep the content adult-framed,
  ensure the crisis resources are appropriate, and revisit a youth path later.
- A wellbeing result is **sensitive personal data** — encrypted, own-folder, own-context, never broadcast (§8.4).
  It is **not** marked `restricted` (it's not intimacy/trauma), so it surfaces in the person's own Memory normally;
  but it is **never shared with anyone else** (§8.4).

### 8.4 Privacy & honesty

- **Self-only + own-context.** A check-in is about the taker, stored encrypted under their own folder, feeding only
  their own context. The bridge is the trust boundary (active-person scope).
- **Never shared with anyone else.** A wellbeing result is **never broadcast and never relationship-scope-shareable**
  — stronger than spec-50's "own-only v1, partner-shareable later" for personality results. Mental-health
  reflections do not become a partner's coaching signal (§3.5/§5.4). Wellbeing facts are written `shareable: false`
  with **no** `shareableWith`/`shareableTypes` ever.
- **Never surface owner/admin visibility to the person** (the durable rule, CLAUDE.md §1) — no copy tells a person
  an owner/admin can read their wellbeing answers; this is the most sensitive instance of that rule.
- **Honest, transparent scoring.** Scoring + band resolution + crisis detection are **deterministic** (the same
  answers always give the same result) and **AI-free**; the narrative is clearly an **optional interpretation**,
  never the "true" you. The instrument attribution is shown for transparency.

## 9. Accessibility

Per [`01`](01-design-system.md) §9 (inheriting spec 50 + the `@selfos/answering` renderer's a11y):

- The check-in form, Score/Check-in-again/Delete actions, the narrative button, and the **"Stop check-in"**
  affordance are **keyboard-operable** with **visible focus** and proper labels/roles; the verbatim Likert items
  render as labelled scales (a non-`<legend>` heading per item, per-control `aria-label`, no double-label collision —
  the questionnaire-answering precedent).
- **The gentle range** conveys its value as **text** (a labelled value + a non-color-only bar); the descriptor band
  is text. The mood/anxiety **trend** chart carries a text equivalent (a direction-aware label), never color-only
  (`20`/`44` precedent).
- **The crisis surface** — the escalated item-9 banner + the result crisis lead are announced (`role="alert"` /
  the `CrisisSupportBanner` register); the always-present `CrisisFooter` resources are real, focusable links. The
  professional-help line is part of the result's accessible content.
- **The narrative** is a polite live region (`role="status"`).
- Responsive ~360px→desktop: the hub group + result reflow on phones; the gentle bar + trends never cause a
  **horizontal scrollbar** (CLAUDE.md §12 — tested, §10); the long check-in (RAADS-R) renders to the bottom with
  **no default-collapsed group** (item 9 is never hidden in a collapsed accordion). Reduced-motion respected.

## 10. Testing strategy

Per the DoD (CLAUDE.md §7). Use the established fakes (`SELFOS_FAKE_CLAUDE`) for the narrative; **decrypt the
vault** to assert data, not just the UI; run `pnpm typecheck` after tests (memory `vitest-does-not-typecheck`).

- **Unit (core — deterministic band scoring, per instrument):** a **known-input → known-band vector** per
  instrument: **PHQ-9** (each of minimal/mild/moderate/moderately-severe/severe at its raw threshold + the
  display copy resolved), **GAD-7** (its four bands), **ASRS v1.1** (the Part-A threshold zones), and **AQ-10 /
  RAADS-R** (its cut-off(s)/subscales). Assert `scoreTest` is **total** on a missing/out-of-range answer
  (clamps/omits, never throws) and that the **internal `clinicalKey` is kept** while the shown copy comes from the
  band's `display`.
- **Unit (the crisis hook — the heart):** **`answerTriggersCrisis`** returns `true` the instant PHQ-9 item 9 is
  answered positive and `false` for a non-positive / non-crisis item; **`detectWellbeingCrisis`** flags on
  item-level (item 9 positive) **and** band-level (a `crisis: true` band) and **not** on a benign result; the
  hook is **AI-free** (no model dependency). A `tests:take` bridge test asserts a positive-item-9 result writes an
  Insight with **`crisisFlag: true`** and that **scoring works with AI off** (deterministic, free — `tests:take`
  records **no** usage; only `tests:narrate` records `test.narrate`).
- **Unit (the wellbeing-trend feed):** a mood/anxiety result produces an Insight whose `metrics` carry the gentle
  normalized score; a **retake** reuses `insightId` + sets `reTakeOf` + adds a trend point; a crisis-flagged
  wellbeing Insight is **counted by `aggregateCrisisSignal`** (`40` §3.5) — proving the existing aggregation
  picks it up with no change.
- **Component (RTL):** the hub renders the **"Reflections / check-ins"** group distinctly from spec-50's tests;
  the intro shows the **not-medical framing FIRST** + the **Stop** affordance; the check-in form renders verbatim
  Likert items (non-auto-seeded); answering **PHQ-9 item 9 positive surfaces the crisis banner inline**; the
  result renders the **gentle range (NOT the clinical label)** + the **always-present professional-help line** +
  the crisis lead when flagged; the narrative button's AI-off/over-budget calm states; **the deterministic band +
  help line + crisis surface render with AI off**. **Non-diagnostic copy assertions:** the result **never**
  contains "you have," the diagnosis name as a headline, or "depression/anxiety disorder/ADHD/autism" as a verdict;
  the professional-help line is present.
- **E2E (Playwright):** take a mood check-in → score → the **gentle-range result** renders with the help line; a
  **retake** adds a trend point + folds into the Home wellbeing picture; answering **item 9 positive surfaces
  crisis resources mid-check-in**; **decrypt** the vault to assert the result's Insight is **`crisisFlag: true`**,
  is **own-context only and never shared** with another person, and feeds the Home `CrisisSupportBanner` via the
  aggregation; the **deterministic band + crisis routing work with AI off** (only the narrative button is gated).
  Include the **no-horizontal-overflow / inner-scrollbar** guard at ~360px on the hub + check-in + result, and the
  **full-surface-renders-to-the-bottom** guard on a long instrument (every item visible, **no default-collapsed
  group hiding item 9**, Score reachable).

## 11. Open questions

LIST — never silently assumed:

1. **Autism instrument(s)** — ship **AQ-10** (short, 10 items, lighter), **RAADS-R** (long, 80 items, more
   sensitive), or **both** (AQ-10 as a quick reflection + RAADS-R as a deeper one)? A trade-off of completion vs
   depth. _Need a call (the catalog ids encode it)._
2. **An extra explicit opt-in setting beyond `tests.own`?** Given their sensitivity, do wellbeing reflections want
   their own enable toggle, or is the framing-first intro (§3.2) the opt-in with **no extra setting**?
   _Recommendation: **no extra setting** — the intro is the opt-in; an "enable" toggle risks a person disabling a
   safety-routed reflection. **Crisis routing is never behind any setting regardless** (§8.2)._
3. **Exact non-diagnostic result copy** — the gentle band wording per instrument/band (e.g. PHQ-9 'moderately-severe'
   → _"your responses suggest you've been carrying a lot of low mood lately"_) and the always-present
   professional-help line. _Proposed in §3.3/§8.1 — **flag for the user's review/sign-off** (this is the
   highest-stakes copy in the app)._
4. **Re-take cadence / reminders for mood-anxiety** — how often to gently invite a re-check (passive card prompt
   vs a §40-coordinated nudge), and **whether a worsening trend should proactively nudge (via [`40`](40-proactive-coaching.md))
   or stay passive**. _Recommendation: **gentle + passive by default** (a card prompt), with any proactive nudge
   never alarmist + never a diagnosis (§8.2); confirm whether to wire the §40 nudge at all._
5. **ADHD/autism: retakeable vs one-time** — these reflect **stable traits**, so a trend is less meaningful than
   for mood/anxiety. One-time (a single reflection, retake allowed but not encouraged) vs retakeable like
   mood/anxiety? _Recommendation: **retake allowed, not nudged**; no proactive re-check for traits._
6. **Age-gating** — these are **adult-framed** mental-health instruments. Keep them adult-framed with appropriate
   crisis resources (no explicit age gate), or add an age affordance / a youth-appropriate path? _Recommendation:
   **adult-framed, no extra gate v1**; ensure crisis resources are appropriate; revisit a youth path later._
7. **The Home wellbeing-picture blend** — fold mood/anxiety check-in points into the **same** `WellbeingCard`
   series as the session mood metrics, or show a **sibling** "your check-ins" series? _A small §5.3 refinement —
   recommendation: a sibling series so a deliberate check-in reads distinctly from inferred session mood; confirm._

## 12. Changelog

- 2026-06-25 — created (Draft). Adds **wellbeing & neurodivergence self-reflections** on top of the
  [`50`](50-self-assessments.md) Tests engine: PHQ-9 (mood, item-9 crisis trigger), GAD-7 (anxiety), ASRS v1.1
  (ADHD traits, WHO — unmodified + cited), and AQ-10 and/or RAADS-R (autism traits, ARC/Ritvo — unmodified +
  cited), all reframed as **non-diagnostic reflections/check-ins** (gentle ranges, never a diagnosis, never "you
  have," always beside the professional-help line). The safety design (§8) is the largest section: **mandatory,
  never-optional crisis routing** — a positive PHQ-9 item-9 answer surfaces crisis resources **immediately
  mid-check-in** and raises `crisisFlag`, a high overall band raises it too, and the flag feeds the
  [`40`](40-proactive-coaching.md) `aggregateCrisisSignal` + the Home `CrisisSupportBanner`; deterministic scoring
  - crisis routing work **AI-off / offline**. Reuses the spec-50 `TestResult`/`scoreTest`/"You" hub/`source: 'test'`
    Insight bridge with a new **`wellbeing` test category** + additive `crisisItems`/`bands`/`attribution`
    `TestDefinition` flags; mood/anxiety re-takes feed the existing Home `WellbeingCard` picture + a `LineChart`
    trend; the optional `test.narrate` narrative is extra-bounded (non-diagnostic, resources-first). Locked
    decisions in §1/§2 (all four topics under the non-diagnostic reframe; reuse the spec-50 engine; crisis-routed).
    Open questions (AQ-10 vs RAADS-R vs both; an extra opt-in setting; the exact non-diagnostic copy [flag for
    review]; mood/anxiety re-take cadence + whether a worsening trend nudges via 40; ADHD/autism retakeable vs
    one-time; age-gating; the Home wellbeing-picture blend) in §11.
