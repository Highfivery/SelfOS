# 47 — Onboarding intake quality pass

> **Status:** Built · _last updated 2026-06-25_
>
> A holistic **audit-and-remediate** pass over the personal-onboarding intake ([`18`](18-personal-onboarding.md)),
> after several user-reported onboarding bugs. It does **not** redesign the producer/synthesis/safety model or
> the intimacy content (the anatomy/label correctness is [`46`](46-intimacy-matrix-accuracy.md)); it
> systematically walks **every section and question** at the real rendered widths and fixes four locked
> problem areas: **(1) question clarity & wording**, **(2) branching correctness**, **(3) the intimacy
> section overall** (length, tone, ordering, skip-ability, coherence — _not_ the anatomy correctness), and
> **(4) pacing & length** (core-vs-invited gating, motivation, resume). The output is a concrete fix list +
> verification matrices + regression tests, not a new feature.

Amends [`18`](18-personal-onboarding.md) §14 and the `intakeCatalog.ts` it specifies. Builds on
[`26`](26-intake-catalog-redesign.md) (the non-intimacy catalog it polishes), [`27`](27-intimacy-redesign.md)
(the intimacy block it reviews for flow), and [`29`](29-progressive-profile-building.md) (progressive depth,
which this pass keeps intact). Cross-references [`46`](46-intimacy-matrix-accuracy.md) (the intimacy
**content/anatomy** correctness — the boundary is stated in §2). The questionnaire `Question` shape +
`@selfos/answering` branching engine ([`08`](08-questionnaires.md)) and [`15`](15-shareability.md)
per-question sharing are reused unchanged. References [`00`](00-architecture.md) and [`01`](01-design-system.md).

---

## 1. Overview

The intake is SelfOS's deepest data-capture surface and its hardest UX problem: ~184 questions across 12
sections ([`26`](26-intake-catalog-redesign.md)/[`27`](27-intimacy-redesign.md)), a hard Member gate
([`18`](18-personal-onboarding.md) §3.1), heavy/intimate sections, conditional branching, and resume across
sittings. It has grown through many incremental passes (the share-by-default backfill, the placeholders rule,
the kids/pets `roster`, the collapsible portrait, the 5-point intimacy matrix). Each fixed a point problem;
**none audited the whole flow as a coherent experience.** The user has hit several onboarding bugs and asked
for a holistic quality pass.

This spec is a **review-and-remediate** spec, not a new capability. It defines:

1. an **audit methodology** — exactly how to walk every section/question at real rendered widths, run the
   CLAUDE.md §7 coherence walk, and decrypt-to-verify content; and
2. four **remediation categories** (the user's locked scope, §2) with concrete deliverables:
   a **clarity/wording fix list**, a **branching-correctness verification matrix**, an **intimacy-section
   restructure proposal**, and **pacing/length recommendations**.

It sits **after** [`46`](46-intimacy-matrix-accuracy.md) in the build order (§11): 46 changes the
intimacy questions (anatomy/label correctness), then 47 polishes the wording/flow/length **around** the
corrected set, so 47 never re-touches content 46 is mid-flight on.

The four areas are the user's explicit, **locked** priorities — all four are in scope; none is optional.

## 2. Goals / Non-goals

**Goals (the four locked areas)**

- **Area 1 — Question clarity & wording.** Every intake question reads clearly and unambiguously: no
  confusing phrasing, no labels that **collide** across questions/sections (the CLAUDE.md §7 "two controls
  that read like the same question" failure), helpful **placeholders** on every free-text question (extending
  the existing catalog guard), and option lists that are mutually-exclusive-where-they-should-be and
  exhaustive-enough (an "Other" write-in where the set can't be closed).
- **Area 2 — Branching correctness.** Every conditional/branch shows the right follow-ups in the right place,
  never **strands** (a follow-up whose trigger can never be set), never **double-asks** (two questions
  capturing the same fact), and never **hides** a question that should show — including the edge where a
  trigger answer is later **cleared/changed** (the follow-up must hide; the orphaned answer must not feed
  synthesis as if it were chosen).
- **Area 3 — Intimacy section overall.** Review the whole 18+ intimacy block as an experience: **length**
  (is it too long even after [`27`](27-intimacy-redesign.md)'s trim?), **sensitivity/tone** (graphic-but-warm,
  no clinical coldness, no dark patterns), **ordering** (low-exposure → high-exposure; the `getSpecific`
  opt-in gate placed so a casual user isn't fronted with the most graphic items), **skip-ability** (every
  question + the whole section skippable; the 18+ ack a deliberate choice), and **coherence** (the
  `getSpecific` gate, the `hasPartner` branch, the porn follow-ups, and the activity matrix read as one
  considered flow, not accreted layers). **Boundary:** the **anatomy/label correctness** of the intimacy
  questions (which oral row a straight man sees, gendered option wording, etc.) is owned by
  [`46`](46-intimacy-matrix-accuracy.md) — this spec does **not** decide it; where 47's flow review
  touches a row 46 owns, 47 defers to 46's decision.
- **Area 4 — Pacing & length.** The whole flow should feel **motivating, not exhausting**: the `core` gate
  stays short and finishable (so first-run isn't a wall behind the hard Member gate); `invited` sections are
  clearly optional, skippable, and resumable cleanly; section length is right-sized; and the resume UX
  ([`18`](18-personal-onboarding.md) §3.1) returns the person exactly where they were.

**Cross-cutting goal**

- **No regressions, with tests that lock the fixes in.** Every wording/branch/length change is covered by an
  extended catalog audit test + a branching truth-table test + a full-surface E2E (renders to the bottom, no
  horizontal overflow at real container widths incl. ~360px), so the class of bug can't silently return
  (CLAUDE.md §7).

**Non-goals (out of scope / why)**

- **The intimacy anatomy/label correctness** — [`46`](46-intimacy-matrix-accuracy.md) owns it (§11
  sequences 46 before 47). 47 reviews intimacy **flow/length/tone/order**, not which gendered label is right.
- **A schema/engine redesign.** This is a **content + flow + wording** pass over the existing `Question`
  shape, `@selfos/answering` branching, the `IntakeFormQuestion` mapping, and the catalog. Any engine change
  (e.g. a new answer type, a branch-on-cleared-trigger fix in the renderer) is scoped narrowly here only if
  the audit proves it's needed (§5), and stays additive.
- **The producer/synthesis/safety model.** [`18`](18-personal-onboarding.md) §8/§14.8/§14.10 (restricted
  facts, 18+ gate, own-context-only defaults, crisis routing) is unchanged; 47 must not weaken any of it.
- **The questionnaire-authoring flow.** The §11.4 recommendation was onboarding-only, but the **owner chose to
  include the questionnaire builder too** (2026-06-25). In practice the only cross-over the audit found is the
  **shared branching engine**: the cleared-trigger orphan bug (§5/§7) affected the in-app Inbox answer/analysis
  path the same way it affected intake, so the one shared `visibleAnswers` fix is applied to both surfaces (the
  relay page already did it). No catalog/wording work applies to the builder (its questions are user-authored,
  not a fixed catalog).
- **Progressive depth / freshness** ([`29`](29-progressive-profile-building.md) / [`18`](18-personal-onboarding.md)
  §15) — kept intact; 47 must not break the depth-invitation routing or the staleness nudge.
- **Auto-creating the people graph** from family/relationship answers — still phase 2
  ([`18`](18-personal-onboarding.md) §2).
- **Voice** — deferred; nothing here precludes it.

## 3. UX & flows

This is an audit spec, so §3 has two halves: **3.1 the audit methodology** (how to find the problems
systematically) and **3.2–3.5 the remediation deliverables** (the concrete fixes, one subsection per locked
area). The user-facing flow itself is **unchanged** ([`18`](18-personal-onboarding.md) §3): core gate →
starter portrait → "Go deeper" grid of invited sections → re-synthesize. 47 changes **wording, branching,
intimacy flow, and length**, not the shell, controls, routes, or nav.

### 3.1 Audit methodology (how to find the problems)

The audit is run **before** any fix and produces the deliverables in §3.2–§3.5. It is concrete and repeatable:

1. **Enumerate the full catalog from the source of truth.** Walk every `IntakeSectionDef` in
   `INTAKE_CATALOG` in order, and within each, every `IntakeFormQuestion` (`id`, `prompt`, `type`, `options`,
   `placeholder`, `branch`, `group`, `field`/`private`/`restricted`/`category`). The catalog — not the spec
   tables — is the source of truth ([`26`](26-intake-catalog-redesign.md) §4.2). Produce a flat inventory
   (section → ordered questions) as the audit's working document.
2. **Render every section at real container widths.** Drive the **actual onboarding renderer** (the built
   app via Playwright + `SELFOS_FAKE_CLAUDE`), opening **every** section (core and invited; the intimacy
   block after the 18+ ack), at **~360px** (phone), a mid width, and desktop. For each: scroll to the
   **bottom** and confirm the **last** question renders (CLAUDE.md §7 "full surface renders to the bottom" —
   a default-collapsed accordion group silently swallowing the last questions is the exact bug to catch), and
   assert **no element** has `scrollWidth > clientWidth` with computed `overflow-x: auto|scroll` (inner
   scrollbars included), not just `main`. The intimacy 5-point matrix is the highest-risk overflow surface
   ([`27`](27-intimacy-redesign.md) §9).
3. **Run the CLAUDE.md §7 whole-flow coherence walk.** Walk the **complete** flow in order and judge it **as
   a whole**, not screen-by-screen. Specifically hunt for: the same fact **asked twice** (a question in two
   sections, or a question + a roster capturing the same thing); **labels that collide or confuse** across
   sections (two controls that read like the same question); **dead/redundant** controls left by an earlier
   model change; and steps that no longer belong. A green test suite proves each screen _functions_, not that
   the flow is _coherent_.
4. **Trace every branch against the engine.** For every question with a `branch`, locate its
   `whenQuestionId` trigger, confirm the trigger is an **earlier** discrete question in the **same** section
   (the answer is keyed per-section; the existing catalog test asserts earlier-and-known), confirm the
   trigger's `options`/type can actually produce the `equals`/`equalsAny` value (no stranded follow-up whose
   trigger value was renamed/removed), and confirm the follow-up sits **directly beneath** its gate
   ([`18`](18-personal-onboarding.md) §14.5). Build the §3.3 verification matrix from this trace.
5. **Decrypt-to-verify content, not just rendering.** A passing render proves the screen draws, not that the
   stored/synthesized content is correct. For representative answers (a roster, a matrix, a private field, a
   restricted intimacy fact, a branched follow-up), **decrypt the vault** and assert the persisted value +
   the synthesized portrait fact read correctly (the established `answerToString`/`formatAnswerForSynthesis`
   path) — this is how the "tests pass, data wrong/lost" traps (the matrix `toSubmit` drop; a collapsed group
   hiding answers) are caught.
6. **Cross-check the spec tables vs. the catalog.** Where the [`18`](18-personal-onboarding.md) §14.4a /
   [`26`](26-intake-catalog-redesign.md) §4.3 / [`27`](27-intimacy-redesign.md) §4.2 tables disagree with
   `INTAKE_CATALOG`, the **catalog wins** (the documented caveat); flag drifts so the specs are reconciled in
   the same change (CLAUDE.md §8 living-docs).

The audit's output is the four deliverables below, each a concrete list of changes that the remediation
implements and the tests lock in.

### 3.2 Deliverable A — clarity & wording fix list (Area 1)

A concrete, per-question fix list, produced by §3.1 steps 1+3 and applied to `intakeCatalog.ts`:

- **Confusing/ambiguous prompts** rewritten to plain, warm, specific phrasing (the
  [`26`](26-intake-catalog-redesign.md) "structured-over-open, one owner per topic" principle). Each rewrite
  preserves the question **`id`** (answers are keyed by id; a rename would orphan stored answers) and its
  `field`/`restricted`/`private` mapping.
- **Colliding labels resolved.** Where two questions (across or within sections) read like the same
  question, one is reworded or removed so a person never feels re-asked (the CLAUDE.md §7 collision failure).
  The audit lists each collision pair and the resolution.
- **Placeholders on every free-text question.** The existing catalog guard requires a non-empty `placeholder`
  on every `shortText`/`longText` and every `roster` `text` column (`intakeCatalog.test.ts`); the audit
  additionally requires each placeholder to be a **meaningful example or gentle "only what you want to
  share" prompt**, not a restatement of the prompt. (The guard already exists; 47 raises the quality bar and
  the test asserts non-emptiness — see §10 for the optional quality assertion.)
- **Option-list hygiene.** Single-choice option sets are mutually exclusive; multi-choice sets are
  non-overlapping; any set that can't be closed carries an "Other" write-in (the catalog convention). A
  slider's three anchors (start/mid/end) read as a sensible ordered scale.
- **Group headings** read clearly and **never default-collapse the trailing questions** — every accordion
  group renders **open by default** on a form (CLAUDE.md §12; the onboarding "Your circle" regression), so no
  question is hidden at the bottom of a section.

### 3.3 Deliverable B — branching-correctness verification matrix (Area 2)

A matrix, one row per branched question, produced by §3.1 step 4 and asserted by the §10 branching
truth-table test. Each row records:

| Column                | What it captures                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| **Follow-up id**      | the conditional question                                                                         |
| **Section**           | its section (trigger must be in the **same** section)                                            |
| **Trigger id**        | `branch.whenQuestionId` (must be an **earlier** question in the section)                         |
| **Trigger type**      | `singleChoice` / `yesNo` / `multiChoice` (a multi matches when its array **includes** the value) |
| **Match rule**        | `equals` value(s) **or** `equalsAny` list                                                        |
| **Trigger can match** | the trigger's `options`/type can actually produce the match value (no **stranded** follow-up)    |
| **Placement**         | the follow-up sits **directly beneath** its trigger (18 §14.5)                                   |
| **Shown set**         | for each representative trigger answer, the exact set of questions that should be visible        |

The remediation fixes every row that fails: a stranded follow-up (trigger value renamed/removed) is re-pointed
or removed; a follow-up placed away from its gate is moved beneath it; a double-ask (two questions capturing
the same fact, one gating the other redundantly) is collapsed. The **cleared-trigger** edge (§7) is an
explicit matrix concern: when a trigger answer is changed/cleared, the follow-up must hide (the engine
re-filters via `isQuestionVisible`, so this holds in the UI), **and** the orphaned follow-up answer must not
be treated as chosen by synthesis (§5 / §7).

### 3.4 Deliverable C — intimacy-section restructure proposal (Area 3)

A proposal for the whole 18+ intimacy block, reviewed as a flow (not content correctness — that's
[`46`](46-intimacy-matrix-accuracy.md)). It covers:

- **Ordering** — sections proceed **low-exposure → high-exposure**: orientation/identity → reflective story
  → current sex life (the relational, always-visible core) → the `getSpecific` opt-in gate → the explicit
  specifics (activity matrix, turn-ons, fantasies, porn) → wellbeing/consent/meaning. The audit confirms the
  most graphic items sit **behind** `getSpecific` so a casual user (the ~28-question core,
  [`27`](27-intimacy-redesign.md) §4.3) is never fronted with them, and that safety/consent/meaning is
  **never** behind the specifics gate.
- **Length** — judge whether the ~42-question block (incl. ~14 behind `getSpecific`) still feels long; the
  proposal may recommend further consolidation **without** softening the explicit register
  ([`27`](27-intimacy-redesign.md) keeps it graphic). Any cut is recorded with the same anti-rebloat band
  guard the catalog test already enforces.
- **Tone & sensitivity pacing** — the content note + not-medical line + `CrisisFooter` open every intimacy
  surface; the wording stays casual-not-clinical; the gentle pointer to **What weighs on you** for
  non-consensual experience stays ([`27`](27-intimacy-redesign.md) §4.2); no dark patterns (every question
  - the section skippable; the 18+ ack a deliberate, reversible-by-skipping choice).
- **Skip-ability & coherence** — the 18+ gate, the `getSpecific` opt-in, the `hasPartner` branch, and the
  porn follow-ups (`watchPorn ≠ Never`) read as one considered flow (the §3.1 step-3 coherence walk applied
  to the block). The activity **matrix** is the section's anchor control; its rows are owned by
  [`46`](46-intimacy-matrix-accuracy.md) — 47 reviews only its **placement, label clarity, and mobile
  layout** (no horizontal scroll at ~360px; stacked per-row).
- **Explicit boundary deferral** — wherever the restructure touches a row's gendered/anatomical wording, 47
  **defers to [`46`](46-intimacy-matrix-accuracy.md)** and notes it, so the two specs don't fight over the
  same row.

### 3.5 Deliverable D — pacing & length recommendations (Area 4)

A recommendation set on the overall flow:

- **Core gate size** — confirm the `core` gate (basics / life-now / values / want; ~25 visible after the
  conditional rosters, [`26`](26-intake-catalog-redesign.md) §4.2) is short enough to finish without
  skip-spam behind the hard Member gate ([`18`](18-personal-onboarding.md) §3.1). If first-run still feels
  long, recommend a specific trim (e.g. drop `importantDates` from the gate, or move a question to an invited
  section) — recorded as an **open question** for the user (§11), not silently decided.
- **Invited-section length** — flag any invited section that reads as a wall; recommend pushing narrative
  depth into the per-section go-deeper chat ([`18`](18-personal-onboarding.md) §14.7) rather than long-text
  sprawl (the [`26`](26-intake-catalog-redesign.md) method), and right-size against the anti-rebloat band.
- **Motivation & progress** — the `ProportionBar` (by section) + per-card answered/total counts
  ([`18`](18-personal-onboarding.md) §3.1) make the intake feel finishable; the audit confirms they read
  correctly at every width and that "Go deeper" cards show the right `Add`/`Skipped`/`Current`/done-`Update`
  state.
- **Resume cleanliness** — the last-opened section is remembered device-local; resume returns there (not the
  first unfinished core step); reopening a section with an in-progress go-deeper chat shows that transcript
  ([`18`](18-personal-onboarding.md) §3.1). The audit confirms resume mid-section, after a skip, and after a
  reload all return correctly.
- **Section reordering** — whether to reorder the `invited` sections (easy→sensitive is the current intent)
  is recorded as an open question (§11), not decided here.

## 4. Data model (vault files & schemas)

**No new files and no `schemaVersion` bump.** 47 is a **content + flow + wording** pass over the existing
`INTAKE_CATALOG` (`packages/core/src/intake/intakeCatalog.ts`) and the onboarding renderer. It owns no vault
file of its own — the intake lives in `people/<id>/intake/session.enc` and the portrait is an
`Insight (source: 'intake')` ([`18`](18-personal-onboarding.md) §4.1), both **unchanged**.

- **Schemas** — unchanged. The same `IntakeSectionDef` / `IntakeFormQuestion` / `Question` shapes
  ([`intakeCatalog.ts`](../../packages/core/src/intake/intakeCatalog.ts)), the same `PersonFieldKey` set, the
  same `IntakeAnswerValue` union, and the same `restricted`/`private`/`field`/`list`/`category` mapping
  ([`26`](26-intake-catalog-redesign.md) §4.1). Reworded prompts keep their `id`; reordered questions keep
  their mapping; removed questions leave their stored answers as harmless orphans (§7).
- **Migration** — additive/no-op for persisted data. Reworded prompts and reordered questions don't change
  the on-disk answer keys (keyed by `id`), so **existing answers parse unchanged**. Any **removed** question
  id leaves an orphaned answer in `IntakeSession.answers` that the new catalog ignores (the established
  `ensureIntakeSession` reconcile, [`26`](26-intake-catalog-redesign.md) §5). The `portraitAnswerSig`
  staleness signature ([`18`](18-personal-onboarding.md) §3.6) recomputes if any answered id is removed,
  surfacing the standard "refresh your portrait" nudge ([`26`](26-intake-catalog-redesign.md) §7) — never a
  forced redo.
- **The only schema touch 47 may make** is **additive and audit-driven**: if the branching audit proves a
  genuine engine gap (e.g. an orphaned-answer-after-cleared-trigger problem at synthesis), the fix is scoped
  in §5 and stays additive-optional with the `email`/`phone`/no-bump precedent. The default expectation is
  **zero schema change.**
- **Ownership** — all reads/writes go through the vault/crypto service ([`00`](00-architecture.md) §4.3); the
  renderer never touches `fs`. Unchanged.

## 5. Architecture & modules

- **`packages/core/src/intake/intakeCatalog.ts`** — the primary surface. The remediation edits prompts,
  placeholders, option sets, group headings, branch placement, and (where the §3.5 trim is approved) section
  membership/length. The builders (`single`/`multi`/`yesno`/`shortText`/`longText`/`dateQ`/`dateList`/
  `roster`/`slider`/`when`/`whenAny`/`f`/`grouped`) and the shared `INTIMACY_ACTIVITIES`/`INTIMACY_FANTASIES`/
  `TOYS` / `resolveIntakeActivityRows` are **unchanged** (intimacy content/anatomy is
  [`46`](46-intimacy-matrix-accuracy.md)). `getIntakeSection` / `intakeSectionMeta` /
  `buildInterviewerAddendum` are unchanged.
- **`@selfos/core/questionnaires/answering.ts`** — the branching engine (`isQuestionVisible` /
  `visibleQuestions` / `isAnswered`). 47 **does not** change it unless the §3.3 audit proves a defect.
  Note the established behaviour the audit relies on: branches are evaluated by **re-filtering** the question
  list against the current answer map, so a **cleared/changed trigger** hides its follow-up live in the UI —
  but the follow-up's prior answer **remains in the answer map** (an orphan). The audit must confirm that
  **synthesis only reads `visibleQuestions`/`isAnswered`-true answers** (so an orphaned, now-hidden follow-up
  answer doesn't feed the portrait as if chosen). If it doesn't, the fix is a **synthesis-side filter**
  (drop answers for currently-hidden questions before building portrait facts) — scoped here, additive, in
  `intakeService`/`formatAnswerForSynthesis`, with a unit test.
- **`intakeService`** — `submitSectionForm` / `synthesize` / `fillPersonFields` / the "(sensitive)"
  sub-block routing ([`18`](18-personal-onboarding.md) §14.8) operate on the catalog and need no edits for a
  pure content/wording pass. The only candidate change is the synthesis-side hidden-answer filter above (if
  the audit requires it).
- **Renderer (`apps/desktop/src/renderer/src/app/routes/onboarding/`)** — `Onboarding.tsx`,
  `IntakeFormPanel.tsx`, `IntakeSectionPanel.tsx`, `ClosingPortrait.tsx`. 47 changes the renderer **only**
  if the audit surfaces a layout/overflow/collapse/resume bug (e.g. a group collapsed by default at the
  bottom of a section, an inner scrollbar on the matrix at 360px, a resume that bounces to the wrong
  section). Those are the bugs the audit is designed to catch; each is a small, targeted CSS/state fix, not a
  redesign. No new components, routes, nav, IPC, or stores.
- **No shared-package extraction** — 47 introduces nothing new to share; it polishes existing modules.

## 6. IPC / API contracts

**No IPC changes.** The intake seam is unchanged ([`18`](18-personal-onboarding.md) §6): `intake:getState`,
`intake:submitForm`, `intake:runTurn` (stream + `intake:chunk`), `intake:skipSection`,
`intake:acknowledgeAdult`, `intake:synthesize` — all gated by `intake.own` + active-person-scoped in the
bridge (the trust boundary), with the Claude key host-side. `intakeSectionMeta()` returns the (reworded,
re-ordered) catalog; the renderer renders whatever it's given.

**Claude API.** 47 makes no new calls. The go-deeper chat (`intake:runTurn`) and synthesis
(`intake:synthesize`) prompts are unchanged except for any **wording** the audit recommends in the synthesis
contract (e.g. tightening how a reworded question maps to a portrait fact) — no model/streaming/budget change.
If the §5 synthesis-side hidden-answer filter is added, it runs **before** the existing metered synthesis
pass (it's pure pre-processing of the answer map), so metering is unchanged ([`06`](06-ai-usage-and-budgets.md)).

## 7. States & edge cases

The audit must reproduce and verify each of these (most are the bugs the pass exists to catch):

- **A branch trigger is later cleared/changed.** The follow-up hides immediately (the engine re-filters via
  `isQuestionVisible`). Verify the orphaned follow-up answer does **not** feed synthesis as if chosen (§5) —
  decrypt the portrait facts to confirm the hidden answer is absent.
- **A default-collapsed accordion group hides trailing questions.** Every form group renders **open by
  default** (CLAUDE.md §12); the §10 full-surface E2E scrolls to the bottom and asserts the **last** question
  - the trailing affordances ("Tell me more →" go-deeper + Continue/Skip) render, and that **no** `<details>`
    is `!open`. (This is the exact "every prior check passed but the last group's questions were swallowed"
    failure.)
- **A section answered out of order.** A person jumps from a core step straight to an invited section (the
  "Go deeper" grid allows it, [`18`](18-personal-onboarding.md) §3.1); answers persist per-section and the
  gate predicate keys on **core resolved + portrait generated** ([`26`](26-intake-catalog-redesign.md) §7),
  not section order. Verify no out-of-order navigation strands a section or loses answers.
- **Resume mid-section / after a reload / after a skip.** The last-opened section is remembered device-local;
  resume returns there with answers seeded and (if present) the go-deeper transcript shown
  ([`18`](18-personal-onboarding.md) §3.1). Verify a reload mid-intimacy returns to intimacy (still
  18+-acked), not the first core step.
- **Portrait hard-gate interactions.** The Member gate releases only on "core resolved + portrait generated";
  a reworded/reordered core question must not break the predicate. After completion, editing a core answer
  marks the portrait stale (`portraitStaleness`) and surfaces the one-tap refresh
  ([`18`](18-personal-onboarding.md) §3.6) — verify a wording/branch change doesn't falsely flip staleness.
- **No horizontal overflow at real container widths.** No element has `scrollWidth > clientWidth` with
  computed `overflow-x: auto|scroll` at ~360px (the intimacy matrix is the highest risk), a mid width, and
  desktop — inner scrollbars included (CLAUDE.md §7).
- **AI offline / over budget.** The form sections (the bulk of the intake) need no AI and work offline
  ([`18`](18-personal-onboarding.md) §14.3); only the go-deeper chat + synthesis need Claude. An
  AI-unavailable state shows the role-aware `AiUnavailableNotice` ([`41`](41-discoverability-and-empty-states.md)),
  never a dead end. Wording changes must not introduce an AI dependency into a form section.
- **Existing person, mid- or post-intake (migration).** Reworded/reordered questions parse existing answers
  unchanged (keyed by id); a **removed** id's stored answer is an ignored orphan; the standard "we streamlined
  onboarding — refresh your portrait?" staleness nudge applies ([`26`](26-intake-catalog-redesign.md) §7). No
  data loss, no forced redo.
- **Sync conflict / corrupt intake file.** Standard vault behaviour ([`00`](00-architecture.md)); a corrupt
  intake degrades to "continue," never silently sharing a restricted answer.
- **Per-person isolation.** The `intakeStore` + adult-ack reset on `activePerson.id` change
  ([`18`](18-personal-onboarding.md) §7); one person's intake never leaks into another's view — a wording
  change must not touch this.

## 8. Safety (wellbeing & sensitive content)

The intake is SelfOS's most safety-critical surface; 47 must **preserve every guarantee** and weaken none.

- **Not medical.** Onboarding is **reflective self-knowledge, not clinical intake, assessment, diagnosis, or
  treatment** (CLAUDE.md §1; [`18`](18-personal-onboarding.md) §8.1). The not-medical line stays on every
  onboarding surface; no wording rewrite may drift toward an evaluative/diagnostic register (esp. Health and
  What-weighs). The interviewer addendum stays appended **after** PERSONA + SAFETY.
- **Crisis routing.** Unchanged and non-negotiable ([`05`](05-conversations.md) §7;
  [`18`](18-personal-onboarding.md) §8.2): the go-deeper chat (esp. the restricted **What weighs on you** and
  intimacy sections) leads with warmth + professional/emergency resources on any self-harm/abuse disclosure;
  the always-present `CrisisFooter` ("Get help now") stays on **every** onboarding surface — the gate is never
  a dead-end ([`18`](18-personal-onboarding.md) §3.1). A wording/length change to **What weighs on you** keeps
  it gentle, all-skippable, and trauma-informed (never digs for specifics).
- **The 18+ gate.** The intimacy block stays opt-in behind the shared `adultAcknowledged` ack
  ([`18`](18-personal-onboarding.md) §12); enforced in the bridge before the section's questions are served.
  No intimacy restructure (§3.4) may surface a question before the ack or behind a weaker gate.
- **Restricted facts & privacy defaults.** Intimacy/trauma answers stay `restricted` (own-context-only,
  owner-visible, redacted for everyone else, excluded from `buildDepictionNote`, never broadcast-shareable),
  decided **server-side from the trusted catalog, never the model** ([`18`](18-personal-onboarding.md)
  §14.8/§14.10). The catalog test invariant ("every intimacy answer is `restricted` or a private field")
  must keep passing after any wording/reorder/trim. Health's per-question `restricted`/`private` items
  (substances, diagnoses, medications, `healthNotes`) keep their flags and the "(sensitive)" sub-block routing.
- **Sensitive sharing confirm.** The per-question relationship-scope sharing ([`43`](43-relationship-scoped-onboarding-sharing.md))
  keeps its share-by-default presets and the deliberate sensitive-share confirm; a wording change must not
  change a question's `category`/default scope without recording it.
- **No dark patterns.** Every question + every section stays skippable; "Skip this section" stays a
  first-class action; the portrait confirmation nudges but never blocks ([`18`](18-personal-onboarding.md)
  §3.5). The pacing changes (§3.5) make the flow **less** exhausting, never more coercive.

## 9. Accessibility

Per [`01`](01-design-system.md) §9 and CLAUDE.md §12, inheriting the onboarding surfaces ([`18`](18-personal-onboarding.md) §9):

- **Every form group open by default** — accordion grouping is for optional tidying only; a form never
  default-collapses inputs, so no question is hidden from a keyboard/SR user at the bottom of a section
  (CLAUDE.md §12; the §7 full-surface guard).
- **Full surface renders to the bottom** — the §10 E2E scrolls every section to the end and asserts the last
  question + the trailing affordances are present (not just "no overflow").
- **No horizontal scroll at ~360px** — anywhere, including inner controls (the intimacy matrix stacks per-row
  on narrow widths, [`27`](27-intimacy-redesign.md) §9). Verified at the real rendered container widths.
- **Keyboard & focus** — every control (single/multi/slider/matrix/roster/date/dateList/go-deeper composer,
  the 18+ ack, Continue/Skip) is keyboard-operable with visible focus; reworded prompts keep their accessible
  label association; a slider/matrix point announces its label, not just a number; an unseeded optional slider
  announces "not set" ([`26`](26-intake-catalog-redesign.md) §9).
- **Semantic content** — content warnings, the not-medical line, and progress are conveyed by **text** (not
  color alone); reduced-motion respected; responsive ~360px→desktop within the [`02`](02-app-shell.md) shell.
- **No double-labelling** — a reworded prompt that shares a substring with a `RelationshipScopePicker` label
  must not create an SR label collision (the established `getByLabel` substring footgun; use precise labels).

## 10. Testing strategy

Vault + Claude mocked as established (`SELFOS_FAKE_CLAUDE`); run `pnpm typecheck` after writing tests (memory
`vitest-does-not-typecheck`). The tests **lock the fixes in** so the bug class can't silently return
(CLAUDE.md §7).

- **Catalog audit unit (extend `intakeCatalog.test.ts`):**
  - **Placeholders** — every `shortText`/`longText` and every `roster` `text` column has a non-empty
    placeholder (the existing guard, kept). Optionally assert each placeholder is **not** a verbatim copy of
    its prompt (the §3.2 quality bar) — recorded as an open question if it proves too strict (§11).
  - **No colliding prompts** — no two questions share an **identical** prompt string across the catalog
    (catches an accidental duplicate); the audit's known intentional id-reuse-across-sections (e.g.
    `boundaries` in relationships vs. the removed intimacy one) is allowed, but identical _prompts_ are
    flagged.
  - **Counts in band** — the existing anti-rebloat guards (non-intimacy ≤ 150, core gate ≤ 30, intimacy
    30–50) still pass after any trim; any approved §3.5 trim tightens, never loosens, the band.
  - **Structure invariants kept** — the 12 sections, the 4 core ids, every `→field` maps to a real
    `PersonFieldKey`, `restricted`/`private` flags on the expected items, the intimacy "(every answer
    restricted or private)" invariant, the family parent-figures roster columns — all still pass.
- **Branching truth-table unit (the §3.3 matrix as a test):** for every branched question, assert its
  trigger is an **earlier**, **same-section**, discrete question (the existing guard) **and** that the
  trigger's `options`/type can **produce** the `equals`/`equalsAny` value (no stranded follow-up); and for a
  set of representative trigger answers, assert `visibleQuestions(section, answers)` equals the expected
  shown set (the matrix's "Shown set" column). Include the **cleared-trigger** case: set a trigger, set its
  follow-up, then clear the trigger → the follow-up is no longer in `visibleQuestions`, and (if the §5
  synthesis filter lands) the orphaned answer is dropped before portrait facts are built.
- **Synthesis content unit (if the §5 filter is added):** an answer to a now-hidden (branch-cleared) question
  does **not** become a portrait fact; `formatAnswerForSynthesis` still formats a matrix/roster correctly.
- **Component (RTL):** a core form renders its controls + Continue/Skip with every group **open**; the
  intimacy block is 18+-gated then shows the `getSpecific` gate with the explicit specifics hidden until
  opted in and consent/wellbeing always visible; a branched follow-up appears under its trigger and
  disappears when the trigger is cleared; the go-deeper "Tell me more →" affordance is present on every form
  section.
- **E2E (Playwright) — the full-surface + coherence guards:**
  - **Full surface renders to the bottom** at **~360px**, a mid width, and desktop, for the core sections
    **and** the invited sections **and** the intimacy block (after the 18+ ack): scroll to the end, assert
    the **last** question + the "Tell me more →" go-deeper + Continue/Skip render, assert **no** `<details>`
    is `!open`, and assert no element has `scrollWidth > clientWidth` with `overflow-x: auto|scroll` (inner
    scrollbars included) — at the **real** container widths.
  - **Branching reveal** (extend the existing conditional-reveal E2E): a follow-up reveals under its trigger,
    and **disappears** when the trigger is cleared; decrypt the vault to assert the orphaned answer didn't
    persist as a portrait fact.
  - **Intimacy-flow coherence E2E:** 18+ ack → the relational core is visible without `getSpecific` → toggle
    `getSpecific` → the explicit specifics + the activity matrix appear → fill the matrix + a branched
    explicit question → synthesize → a `restricted` intimacy fact is **owner-visible but redacted for a
    member** (decrypt both), orientation lands as a **private** field, the matrix value decrypts correctly;
    390px (matrix stacks, no overflow) + control-geometry guards.
  - **Resume & gate:** finish the 4 core forms (no AI) → fields decrypt onto the `Person` → starter portrait
    → gate releases; reload mid-invited-section → returns there with answers seeded.
- **Regression-safety:** the existing onboarding E2E suite (catalog redesign, intimacy matrix, kids/pets
  roster, share-by-default) stays green; any section-title or count change is reconciled in the **same**
  change (CLAUDE.md §8), not left to drift (the [`29`](29-progressive-profile-building.md) §13 stale-E2E
  lesson).

## 11. Open questions

Decisions for the user — **not** silently assumed:

1. **How aggressively to cut length / which sections become optional.** §3.5 recommends keeping the `core`
   gate short and pushing depth into go-deeper, but the **specific trims** (e.g. drop `importantDates` from
   the gate; further-consolidate an invited section; cut N from the intimacy block) need the user's call on
   how lean to go vs. how much signal to keep.
2. **Whether to reorder sections.** The `invited` sections are currently ordered easy→sensitive. Should any
   reorder (within invited, or core ordering)? Default: keep the current order unless the user wants a change.
3. **Specific contested wording.** Any prompt the audit flags as ambiguous where there's a genuine choice
   between two phrasings (rather than an obvious fix) — list each for the user, don't pick silently.
4. **Scope: onboarding intake only, or also the questionnaire-authoring flow?** Both reuse the `Question`
   shape. **Recommendation: strictly the personal onboarding intake** (the questionnaire builder is a
   separate surface with its own UX and isn't the source of the reported bugs) — confirm.
5. **Sequencing relative to [`46`](46-intimacy-matrix-accuracy.md).** **Recommendation: build 46 first**
   (it changes the intimacy questions/anatomy), then 47 polishes wording/flow/length around the corrected
   set — so 47 never re-touches content 46 is mid-flight on. Confirm the order.
6. **Placeholder-quality test strictness.** §10 proposes optionally asserting a placeholder is not a verbatim
   copy of its prompt. Keep that assertion, or leave the existing non-empty guard as the bar (to avoid
   over-constraining wording)?
7. **Synthesis-side hidden-answer filter.** §5 makes the engine change **conditional on the audit proving the
   defect**. If the audit finds synthesis already ignores hidden-question answers, no change ships. Confirm
   the user is fine with this audit-driven, "fix only if real" stance (vs. pre-committing to the change).

## 12. Changelog

- 2026-06-25 — **Built.** Owner decisions (asked first): **Conservative** trim (fix wording/collisions/
  branching/layout + the synthesis bug, **cut no questions**), **keep the section order**, **non-empty**
  placeholder guard (no verbatim-copy assertion), and scope is **both the onboarding intake AND the
  questionnaire builder** (the user overrode the §11.4 onboarding-only recommendation). Sequencing vs
  [`46`](46-intimacy-matrix-accuracy.md) is moot — 46 is already merged to `main`.
  **Audit outcome (the four deliverables):**
  - **A (clarity/wording):** the catalog is clean — **no two questions share an identical prompt** (167
    questions) and **no id is reused across sections** (both now locked by tests). One genuine collision fixed:
    `want.coachStyle` ("How do you like to be coached?") read like its neighbour `want.supportStyle` and shared
    the literal option **"Challenge me"** → reframed to **"What coaching tone do you respond to best?"** with
    "Challenge me" → "Push me hard" (TONE vs the support MODES). Two clarity rewords (ids preserved):
    `basics.appearanceDescription` "How would you describe how you look?" → "…your appearance?" (dropped the
    double-"how"); `basics.importantDates` "Any important dates to remember?" → "Any dates you'd like me to
    remember?". Every free-text placeholder is meaningful (guard kept); every form group already renders
    `<details open>` (no default-collapse).
  - **B (branching correctness):** **no defects** — every branch trigger is an earlier, same-section, discrete
    question whose `options`/type can actually produce the match value (no stranded follow-up), now asserted by a
    truth-table test (+ a cleared-trigger case).
  - **C (intimacy flow):** reviewed, **sound** — low→high exposure (orientation → story → current sex life →
    body → consent/safety/meaning [always visible] → the `getSpecific` opt-in → the explicit specifics), safety
    never behind the gate, the matrix stacks at ~360px, in band (~42). No content change (anatomy/labels are
    [`46`](46-intimacy-matrix-accuracy.md)).
  - **D (pacing):** Conservative — core gate stays ~27 (≤30 guard), resume/progress intact, no cuts.
    **The one engine defect found & fixed (§5/§7, audit-proven):** orphaned answers for branch-**hidden**
    questions (a trigger cleared after the follow-up was answered) reached synthesis/analysis as if chosen. The
    relay answering page already filtered visible answers; the in-app **Inbox** (`toAnswerList`) and the **intake**
    (synthesis `formAnswersMessages` + `factScopeForSection`) did not. Added one shared `visibleAnswers(questions,
answers)` to `@selfos/core/questionnaires/answering` (it **iterates to a fixed point**, so a multi-level branch
    chain — e.g. the intimacy `getSpecific → watchPorn → pornGenres` — drops the deeper orphan too, not just the
    direct one); the Inbox + the relay (refactored, DRY) filter at submit,
    intake filters at synthesis (keeps the stored answer so a re-toggle restores it — the §5 preferred shape), and
    `analyzeAssignment` defensively filters against the snapshot for pre-fix drafts. **No schema/IPC change.**
    Tests: catalog collision + branching truth-table + cleared-trigger + coachStyle-distinct units; a
    `visibleAnswers` unit; intake synthesis drops-orphan unit; questionnaire analysis drops-orphan unit; the
    intimacy conditional-reveal E2E extended with the cleared-trigger hide. Gate green: typecheck, lint, format,
    **764 core + 803 desktop + 11 relay** unit; onboarding (13) + questionnaire/inbox/relay/compatibility (20) E2E
    green. Four existing intake-synthesis tests submitted a branch-gated answer without its trigger (an
    impossible-in-UI setup the new filter correctly drops) — made realistic (set the trigger) in the same change.
- 2026-06-25 — created (Draft). A holistic audit-and-remediate pass over the personal-onboarding intake
  ([`18`](18-personal-onboarding.md)), after several user-reported onboarding bugs. Four locked areas
  (clarity/wording · branching correctness · intimacy section flow/length/tone · pacing & length), an audit
  methodology (full-catalog walk at real widths + the CLAUDE.md §7 coherence walk + decrypt-to-verify), and
  four concrete deliverables (clarity fix list · branching verification matrix · intimacy restructure
  proposal · pacing recommendations). Strictly the onboarding intake; intimacy **anatomy/label correctness**
  is deferred to [`46`](46-intimacy-matrix-accuracy.md) (recommended to build first). No schema/IPC
  change expected; one audit-driven additive engine fix possible (hidden-answer synthesis filter).
