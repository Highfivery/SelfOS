# 54 — Memory redesign: sharing is context, not display; + relationship insights

> **Status:** Draft — _last updated 2026-06-26_
>
> Memory today has a **conceptual privacy mistake** and a **readability problem**. It DISPLAYS a related
> person's raw shared facts/answers directly to the viewer (the [`44`](44-memory-dashboard-overhaul.md)
> "About people you relate to" section) — but sharing is meant to make a partner's data **inform the
> viewer's AI coaching**, never **show the partner's raw answers to the viewer**. And the whole page is a
> long wall of text that's hard to read and navigate. This spec **removes the raw "about people you relate
> to" display** and replaces it with AI-synthesized **relationship insights** (observations about the
> _viewer_ and their relationship with each partner), keeps the viewer's **own** data shown (it's theirs —
> redesigned to be far more scannable), and lands a bundled **test-sharing default change** (test results
> default to `partner`-scoped) so shared test facts surface as relationship _insight_, never raw.

This **amends** [`20`](20-memory-dashboard.md) (the dashboard structure) and **supersedes the raw display
half of** [`44`](44-memory-dashboard-overhaul.md) §3.1.6/§5 (the "About people you relate to" read-only
section + `listRelatedShareableInsights` feeding a _display_). It **does not** change
[`42`](42-relationship-scoped-sharing.md)'s context-feed boundary — shared facts still feed the viewer's
**coaching context** (`summarizeForContext`) exactly as today; only the **Memory display** of another
person's raw facts is removed. It introduces a new AI synthesis modelled on
[`40`](40-proactive-coaching.md)'s `coachingSynthesisService` (the bounded structured digest, meter-before-
parse, tolerant JSON, per-subject cache). It changes the [`50`](50-self-assessments.md) test-fact sharing
default. References [`00`](00-architecture.md)/[`01`](01-design-system.md),
[`06`](06-ai-usage-and-budgets.md) (metering/budgets), [`04`](04-people-roles.md) (relationship graph),
[`05`](05-conversations.md) (crisis/not-medical).

---

## 1. Overview

### 1.1 The conceptual mistake (the headline fix)

The whole sharing model ([`42`](42-relationship-scoped-sharing.md)) is built on a promise: **"shared ≠
shown."** A spouse's answers may **inform the other spouse's AI coaching**; the coach uses but **never
quotes, attributes, or reveals** them (the §3.4 confidentiality preamble enforces this in the prompt). That
guarantee is the load-bearing piece of the couples/sex-counseling use case, and it aligns with the durable
project rule (CLAUDE.md §1) that we **never make people feel surveilled** — _"never tell users an
owner/admin can see their data."_

But today's Memory **breaks the spirit of that promise to the viewer's face**. The
[`44`](44-memory-dashboard-overhaul.md) §3.1.6 dashboard renders a **read-only "About people you relate
to"** section that lists, in plain text, **every shared fact a related person owns** — sourced from
`listRelatedShareableInsights` (`insightStore.ts`), which projects a partner's shareable fact text straight
into the viewer's Memory UI. So if a partner shares "I struggle with X," the viewer **reads "I struggle with
X" verbatim** in their own Memory. That is exactly the disclosure the sharing model was designed to prevent
— "shared with my partner so it can help our couples coaching" should **not** mean "my partner can read my
raw answer in their app." Sharing was meant for **the AI**, not for **the person**.

**This spec removes that raw display.** A partner's shared data continues to **feed the viewer's coaching
context** (sessions/dreams/questionnaire generation — `summarizeForContext` is unchanged), but it is **never
shown to the viewer as raw facts or answers**. The "About people you relate to" section is **deleted**.

### 1.2 What replaces it — relationship insights (a new AI synthesis)

In its place, Memory gains a **"Relationships" view**: per-partner, AI-synthesized **relationship insights**
— gentle observations about **the viewer** and **their relationship dynamic** with each partner, _not_ a
restatement of the partner's raw answers. Examples of the register:

- "You tend to withdraw under conflict while Angel pursues — naming that pattern out loud often defuses it."
- "Your attachment styles look complementary; your steadiness can be an anchor when Angel feels anxious."
- "You and Angel both value quality time most — protecting an unhurried evening would land for both of you."

The synthesis reads **the viewer's own insights + the partner's _shared_ facts** (via the existing
[`42`](42-relationship-scoped-sharing.md) gate — the same data that's allowed to inform the viewer's coach)
as a **bounded structured digest**, and produces one warm, second-person observation **about the viewer's
side of the relationship**. It **never quotes or attributes** the partner's raw answers — same contract as
the in-coach confidentiality rule, now also applied to this surfaced text. It is **explicit-tap to generate
(no auto-spend), cached, and refreshable** — modelled exactly on [`40`](40-proactive-coaching.md)'s
`coachingSynthesisService` (the manual "What are you noticing?" path). A **new usage type
`relationship.synthesize`** meters it.

### 1.3 Your own data, redesigned (still shown — it's yours)

The viewer's **own** insights/facts stay shown — it's their data, editable / flaggable / shareable exactly
as in [`44`](44-memory-dashboard-overhaul.md) (Edit-answer for onboarding facts; "This isn't right about me"
for AI-inferred; the per-fact `RelationshipScopePicker`). The change is **readability**: instead of a wall
of text, Memory leads with a **short AI portrait line**, then **collapsible life-area cards** (each: a count

- a one-line gist; expand for the facts), with the **Intimacy** area carrying a **"private — only you"**
  lock. (The intake-portrait fact-grouping work in [`44`](44-memory-dashboard-overhaul.md) is the precedent;
  this generalizes it to the whole own view.)

### 1.4 The bundled test-sharing default (spec 50)

[`50`](50-self-assessments.md) currently writes test-result facts **own-only** (`shareable: false`; sensitive
ones also `restricted`). The user has decided test results should **default to shared with the `partner`
relationship type** (`shareableTypes: ['partner']`) — **including** the sensitive intimacy AND the
wellbeing/mental-health reflections ([`51`](51-wellbeing-neurodivergence-reflections.md)) — **scoped to `partner` ONLY**,
never parents/coworkers/etc. This is bundled **here** (not in 50) because the whole point is that those
shared test facts surface to the partner **as relationship insight, never as raw answers** — so the display
fix and the sharing default must land together. The person can still **un-share** any test result, and the
sensitive/restricted interaction is the **key technical fork** to resolve at build (§4.3 / §11) so a
`partner`-shared sensitive result still keeps its **own-context relevance-gating** intact.

### 1.5 Full visual redesign (an approved mockup)

An interactive mockup was approved by the user. The redesign (described as §3): a **compact summary strip**
("47 things known · 2 relationships · updated today"), a **two-view switch** ("About you" / "Relationships"),
**search**, **collapsible life-area cards** (own view), and **per-partner relationship-insight cards**
(relationships view). Sleek, scannable, much less text on screen at once — every section reads as
intentional, not a dumped list.

### 1.6 Whole-app fit

- **Honesty about the sharing model.** This makes Memory _honest_: sharing is **context, not surveillance**.
  A viewer never reads a partner's raw answer; a partner is never made to feel watched. It aligns with the
  CLAUDE.md §1 durable rule and the [`42`](42-relationship-scoped-sharing.md) §3.4 confidentiality preamble
  (the coach uses but never discloses) — now extended so even the _surfaced_ relationship insight never
  discloses the partner's raw words.
- **Reuses existing machinery.** The relationship synthesis is the [`40`](40-proactive-coaching.md)
  `coachingSynthesisService` pattern (bounded digest, `digestableInsights` boundary, tolerant parse,
  meter-before-parse, per-subject cache) — no new AI infrastructure, one new usage type.
- **Lands the test-sharing default cleanly.** Because shared test facts now appear only as _insight_, the
  partner-default sharing of even sensitive/wellbeing tests can't leak raw text — the §1.1 fix is the
  prerequisite that makes it safe.

## 2. Goals / Non-goals

**Goals**

- **Remove the raw "about people you relate to" display** from Memory — a partner's shared facts/answers are
  **never shown to the viewer as raw text**, while continuing to **feed the viewer's coaching context**
  (`summarizeForContext` unchanged).
- **Relationship insights** — a new per-partner AI synthesis (`relationshipSynthesisService`) producing one
  warm, second-person observation about **the viewer + the relationship dynamic**, reading the viewer's own
  insights + the partner's _shared_ facts as a bounded digest; **explicit-tap, cached, refreshable**;
  metered `relationship.synthesize`; tolerant-parse + honest failure ([`37`](37-ai-output-robustness.md)).
- **Own data, redesigned** — keep the viewer's own insights shown + fully editable/flaggable/shareable, but
  far more scannable: a short AI portrait line + collapsible life-area cards (count + gist) + the Intimacy
  "private" lock.
- **A full visual redesign** (the approved mockup): summary strip, "About you" / "Relationships" view
  switch, search, collapsible life-area cards, per-partner relationship-insight cards.
- **Test-sharing default change** ([`50`](50-self-assessments.md)) — test-result facts default to
  `shareableTypes: ['partner']` (incl. sensitive intimacy + wellbeing), `partner`-only, un-shareable by the
  person; resolving the `restricted`-vs-`shareableTypes` interaction so sensitive results both (a) share
  with the partner AND (b) keep own-context relevance-gating (§4.3 / §11).
- **Privacy/safety first** — the synthesis never quotes/attributes a partner's raw answers; restricted +
  flagged facts excluded from the synthesis digest; the test-default scoped to `partner` only; the
  wellbeing-sharing consideration surfaced (§8). Additive-optional schema (no `schemaVersion` bump). Strict
  per-person scope and the bridge-as-trust-boundary unchanged.

**Non-goals (deferred / out of scope)**

- **Changing the context-feed model.** [`42`](42-relationship-scoped-sharing.md)'s `factSharedWithViewer` /
  `summarizeForContext` / `buildSharedIntakeAnswerLines` are **unchanged** — shared data still informs the
  viewer's coach. This spec only removes the **display** of that data and adds a synthesis _over_ it.
- **A new sharing model / scope mechanism.** Relationship-type scoping, the presets, the picker, the
  transparency read (`listOutboundSharing` / `memory:outboundSharing`) all stay
  ([`42`](42-relationship-scoped-sharing.md)/[`44`](44-memory-dashboard-overhaul.md)). The "what you share &
  with whom" transparency surface (§3.5 of 44) **stays** — it's the person's view of their **own** outbound
  sharing, which is honest and wanted.
- **A household oversight view for the Owner** — Memory stays self + relationships for everyone
  ([`20`](20-memory-dashboard.md) §2).
- **Relationship insights for non-partner relations (v1).** Recommended `partner`-type first; other types
  are a §11 open question (the synthesis is least meaningful and most privacy-fraught for ex/coworker).
- **A mutual/shared "couple" record.** The relationship insight is the **viewer's** per-person cached
  observation (single-subject), not a joint artifact both partners co-own. (Per-person isolation holds.)
- **Auto-spend / a background cadence for the synthesis.** Explicit-tap + cache only (the
  [`40`](40-proactive-coaching.md) manual path), to keep cost predictable and avoid surprising the user
  (§11 recommends this; a cadence is a possible later additive slice).
- **New metrics taxonomies / trends changes** — Memory still charts what producers emit
  ([`44`](44-memory-dashboard-overhaul.md) §3.3); trends are unchanged.

## 3. UX & flows

The redesigned **Memory** dashboard (`/memory`, gated `memory.own`). Responsive ~360px→desktop
([`01`](01-design-system.md) §9). The crisis footer + not-medical line are always present (§8).

### 3.1 The layout (the approved mockup)

Top to bottom:

1. **Header + summary strip** — "Memory — what SelfOS understands about you," plus a **compact summary
   strip**: e.g. "**47** things known · **2** relationships · updated **today**." (Counts from the loaded
   scoped own-insight list + the count of partners with a relationship insight available; the "updated"
   stamp is the most-recent own insight's `updatedAt` / the `lastReconciledAt` signal.) Search + Refresh
   sit in the header (as today).
2. **A two-view switch** — a `SegmentedControl` (full-width on phones, never a horizontal scroll — §9):
   **"About you"** (default) and **"Relationships"**. Stacked-sections vs a toggle is a §11 tuning call;
   the mockup uses a toggle.
3. **"About you" view** (§3.2) — the viewer's own data, redesigned: a short AI **portrait line**, then
   **collapsible life-area cards**.
4. **"Relationships" view** (§3.3) — one **relationship-insight card per partner**.

The **"Needs your review"** drafts section, **Trends** (promoted, open by default), and the **"Manage
sharing →"** transparency link ([`44`](44-memory-dashboard-overhaul.md) §3.5) are preserved; whether they
live above the switch (always visible) or inside "About you" is a §11 tuning call (recommended: above the
switch, since they're own-data concerns).

Empty state: a warm "As you have sessions, log dreams, answer questionnaires, and take a few tests, what
SelfOS learns shows up here."

### 3.2 "About you" — own data, scannable

- **Portrait line** — a short one-to-two-sentence AI portrait summary at the top (the onboarding portrait
  Insight's `summary`, or a graceful fallback when no portrait exists yet). It is **not** a new AI call —
  it reuses the existing intake-portrait insight; **no spend**.
- **Collapsible life-area cards** — one card per life-area present in the viewer's own approved insights
  (the `LIFE_AREAS` taxonomy, [`44`](44-memory-dashboard-overhaul.md) precedent). Each **collapsed** card
  shows: the area name, a **count** of facts/insights, and a **one-line gist** (the most salient fact or a
  short summary line). **Expanding** reveals the full insight cards for that area — the existing
  `InsightCard` ([`44`](44-memory-dashboard-overhaul.md) §3.4) with all its affordances: Edit-answer /
  Delete (onboarding facts), "This isn't right about me" (AI-inferred), the per-fact
  `RelationshipScopePicker`, confidence chip, provenance deep-link, crisis-lead.
- **The Intimacy area** carries a **"private — only you"** lock badge (its restricted facts are own-context
  only; this makes that explicit on the card). Any area holding a `restricted` fact is **collapsed by
  default** (the [`44`](44-memory-dashboard-overhaul.md) sensitive-collapse precedent — intimacy/trauma is
  not on screen at a glance); non-sensitive areas may be expanded by default (a §11 tuning call —
  recommended: collapsed by default for density, with the count + gist visible).
- **Search** filters across the own insights (summary + fact text); a matching area auto-expands.
- Drafts, Trends, and "Manage sharing" stay (§3.1).

### 3.3 "Relationships" — per-partner insight cards

For each person the viewer relates to **as a partner** (`partner` type from the live graph,
[`42`](42-relationship-scoped-sharing.md) §5.1):

- **A relationship-insight card** — the partner's name + a clear framing line: _"What SelfOS notices about
  **you** and your relationship with Angel — based on your own reflections and what Angel has chosen to
  share. **You're never shown Angel's raw answers** — this is about your side of the dynamic."_ Then the
  **synthesized observation(s)** (the `relationship.synthesize` output — one to a few gentle, second-person
  observations about the viewer's pattern / the dynamic), rendered with `<Markdown>` (block).
- **States** (no dead controls):
  - **Not yet generated** → an explicit **"Reflect on this relationship"** button (the synthesis is
    explicit-tap, never auto-run — like [`40`](40-proactive-coaching.md) §3.3's manual path). A calm one-line
    explainer of what it does + that it costs an AI reflection.
  - **Generating** → a polite `role="status"` loading state.
  - **Generated** → the observation(s) + a **Refresh** action (re-runs the pass) + a "reflected `<date>`"
    stamp (cached read, re-display is free).
  - **AI off / no key / over budget** → a calm "enable AI in Settings" / "budget reached" state (the
    [`37`](37-ai-output-robustness.md)/[`06`](06-ai-usage-and-budgets.md) calm-state pattern), never a dead
    button. The viewer's **own** data still renders fully (only this card's synthesis needs AI).
  - **No shared data + thin own data** → a gentle "there isn't enough yet to reflect on this relationship —
    as you and Angel share more and you reflect more, this fills in" (an `EMPTY`-style state, no spend).
- **The framing is explicit and repeated**: the card always states it is about the **viewer**, drawn from
  **their** reflections + what the partner **chose to share**, and that the partner's **raw answers are
  never shown**. This is the honesty contract made visible (§8).

### 3.4 The bundled test-sharing default (no new UX here)

Test results ([`50`](50-self-assessments.md)) now default to `partner`-shared (§4.3). The **only** UX
consequence in Memory is that a partner-shared test fact (e.g. an attachment lean) feeds the **relationship
synthesis** (§3.3) and the viewer's context — it is **never displayed raw** (the §1.1 fix). The person
**un-shares** a test result via the existing per-fact `RelationshipScopePicker` in the "About you" view
(set scope to Private) or the "Manage sharing" transparency surface ([`44`](44-memory-dashboard-overhaul.md)
§3.5) — **no new control**. (Sensitive/wellbeing tests appear in the **Intimacy** / **Emotions** areas of
"About you," with the §3.2 lock; their per-fact scope shows the partner chip + the deliberate un-restrict
note where restricted — §4.3.)

### 3.5 Provenance & deep-links

Unchanged from [`20`](20-memory-dashboard.md) §3.3 / [`44`](44-memory-dashboard-overhaul.md): a fact's
provenance deep-links to its source (session / dream / questionnaire / onboarding section /
`/you/:testId`). A relationship-insight card is **not** provenance-linked to the partner's data (the
partner's records are never the viewer's to open) — it carries only the framing + the observation.

## 4. Data model (vault files & schemas)

All persisted formats are Zod-backed (`z.infer`), written through the vault/crypto service ([`00`](00-architecture.md)
§4); the renderer never touches `fs`. Per-person isolation (`people/<subjectPersonId>/…`). Changes are
**additive-optional — no `schemaVersion` bump** (the [`40`](40-proactive-coaching.md)/[`42`](42-relationship-scoped-sharing.md)
additive precedent).

### 4.1 `RelationshipSynthesis` (new — cached, per-(viewer, partner))

A per-partner cached observation, modelled on `CoachingSynthesisSchema`
([`40`](40-proactive-coaching.md) §4.1):

```ts
// @selfos/core/schemas.ts — illustrative, Zod-first; tolerant-parse per spec 37
export const RelationshipSynthesisSchema = z.object({
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1), // the VIEWER (per-person isolation — it's their cached reflection)
  partnerPersonId: z.string().min(1), // the partner the observation is about (the relationship)
  observation: z.string(), // the one+ gentle observation(s) about the viewer + the dynamic (only required field)
  computedAt: z.string(),
  windowFrom: z.string().optional(),
  windowTo: z.string().optional(),
});
export type RelationshipSynthesis = z.infer<typeof RelationshipSynthesisSchema>;
```

- **Storage path** — keyed by the partner so multiple partners each cache:
  `people/<viewerId>/relationships/<partnerPersonId>/synthesis.enc`. (Using `partnerPersonId` directly as
  the folder key — a stable person id — rather than a relationship-edge id, since the observation is
  about a person and a viewer may relate to them through several edges. Final key choice is a §11 build
  detail; the partner person id is recommended.)
- Re-running **overwrites** it (one current observation per partner; it's a suggestion, not history). It is
  **NOT** an `Insight`, **NOT** displayed raw, and **NOT** promoted into `summarizeForContext` (it's a
  surfaced reflection, not coach grounding — the [`40`](40-proactive-coaching.md) §4.1 rule).
- It contains **only the viewer-facing observation text** — never the partner's raw shared facts (those are
  the _input_ to the model, never persisted into this record).

### 4.2 Cadence state — none

The synthesis is **explicit-tap only** (§3.3). There is **no** auto-cadence and therefore **no
`lastSynthesizedAt` throttle state** (unlike [`40`](40-proactive-coaching.md) §4.2). The `computedAt` on the
cached record powers the "reflected `<date>`" stamp + the Refresh affordance. (A future auto-cadence would
add a device-local throttle then, per §11.)

### 4.3 The test-fact sharing default ([`50`](50-self-assessments.md) `testService.buildFacts`)

`buildFacts` (`packages/core/src/tests/testService.ts`) currently sets non-wellbeing facts
`shareable: false` (+ `restricted: true` for sensitive) and wellbeing facts `shareable: false` with **no**
`shareableTypes` ever. The change:

- **Non-sensitive tests** (Big Five, attachment) → facts default to **`shareableTypes: ['partner']`**
  (instead of own-only). They are not `restricted`, so `factSharedWithViewer` shares them to a `partner`
  viewer normally.
- **Sensitive tests** (kink, sexuality) AND **wellbeing reflections**
  ([`51`](51-wellbeing-neurodivergence-reflections.md)) → also default to **`shareableTypes: ['partner']`** — the user's
  explicit call.

**THE KEY TECHNICAL FORK (the `restricted`-vs-`shareableTypes` interaction).** `factSharedWithViewer`
([`schemas.ts:609`](packages/core/src/schemas.ts)) **short-circuits**: `if (fact.restricted === true …)
return false` — a `restricted` fact is **never** shared by type, by design ([`42`](42-relationship-scoped-sharing.md)
§8, [`18`](18-personal-onboarding.md) §8.4). And `summarizeForContext` ([`insightStore.ts`](packages/core/src/insights/insightStore.ts))
uses `restricted` + `lifeArea` to **relevance-gate** sensitive results to an **intimacy-topic** context
(spec 50 §3.4). So a sensitive test fact **cannot** be both `restricted` (for own-context relevance-gating)
AND `partner`-shared (the new default) as the model stands — `restricted` wins and it shares with nobody.

The spec must resolve **how** a sensitive/wellbeing result is (a) shareable with the partner AND (b) keeps
its own-context relevance gate. Two candidate mechanisms (the build session picks one against the **real**
gate — §11 lists this as the key open question):

- **Option A — make sensitive test facts NOT `restricted`, but keep `lifeArea` for relevance gating, AND
  generalize the `summarizeForContext` relevance gate to use `lifeArea` (not `restricted`) as its trigger.**
  Today the own-context relevance gate fires on "any restricted fact" + matches `lifeArea` to the topic. If
  sensitive test facts drop `restricted` (so they can be `partner`-shared), the gate must instead fire on
  the **life-area** (e.g. `Intimacy` facts are intimacy-topic-gated regardless of `restricted`). This keeps
  own-context relevance AND lets the fact reach a `partner` viewer (whose context block is, of course, also
  about a relevant topic). **Risk:** changing the gate's trigger from `restricted` to `lifeArea` is a
  cross-cutting change touching every restricted intake/test fact's own-context behaviour — must be verified
  against the spec-50 E2E (a kink fact reaches the taker's intimacy context but not a money chat).
- **Option B — add a new fact flag (e.g. `partnerShareable` / `relationshipShared`) that grants a `partner`
  viewer EVEN when `restricted`, bypassing the `restricted` short-circuit ONLY for the `partner` type, while
  `restricted` still governs own-context relevance-gating + withholding from the owner's normal view.** This
  keeps `restricted`'s existing meaning intact and adds a narrow, explicit partner exception. **Risk:** a
  second sharing axis on top of `restricted`/`shareableTypes` adds complexity to `factSharedWithViewer`; the
  exception must be **partner-only** and never widen to other types, and must still respect the
  confidentiality preamble.

**Recommendation to the build session:** evaluate both against the live `factSharedWithViewer` +
`summarizeForContext` gates and the spec-50/51 E2E. Option A is cleaner (one fewer flag) **if** the gate can
move to `lifeArea` without weakening any other restricted-fact guarantee; Option B is safer if `restricted`
must keep doing exactly what it does. **Do not silently pick one** — this is the load-bearing privacy
mechanic and is §11's primary open question.

**The person can always un-share.** Whichever mechanism, the per-fact `RelationshipScopePicker` (in "About
you," §3.4) lets the person set any test result back to **Private** (clear `shareableTypes` / the flag),
including the sensitive/wellbeing ones — the deliberate, reversible control. The default is `partner`; the
person retains control.

### 4.4 Usage / metering

- **One new usage type**: **`relationship.synthesize`** added to `usageTypes.ts` `USAGE_TYPE_LABELS` (label
  e.g. "Relationship — reflection"). It is the **only new AI spend** this spec introduces. Metered **before
  parse** (§6), included in the usage dashboard + budgets ([`06`](06-ai-usage-and-budgets.md)) like every
  other type; the admin-`$` redaction at the bridge is unchanged.
- **No new spend** for the test-sharing default change (it's a data-default change), the "About you"
  redesign (the portrait line reuses an existing insight), or the removal of the raw display.

### 4.5 No other persisted data

No other vault content files beyond `relationships/<partnerId>/synthesis.enc`. The dismissed/cached state is
the cached record itself. No device-local state (no throttle — §4.2). All other Memory data
(`Insight`s, `OutboundSharingItem`s) is unchanged.

### 4.6 Ownership

All reads/writes via the vault/crypto service ([`00`](00-architecture.md) §3). `RelationshipSynthesis`
records are encrypted under the master key in the **viewer's** own folder. The synthesis input (the
partner's shared facts) is read **at generation time** through the existing
[`42`](42-relationship-scoped-sharing.md) gate and is **never persisted** into the viewer's record.

## 5. Architecture & modules

### 5.1 Remove the raw display (the foundational change)

- **Renderer (`routes/memory`)** — delete the **"About people you relate to"** section from `Memory.tsx`
  (lines ~444–463 in the current file: the `filteredRelated` section + the `InsightCard … isOwn={false}`
  rendering). The `related` / `filteredRelated` / `relatedSubjects` derivations + the subject filter's
  related-person options are removed (the subject filter becomes own-only, or is dropped if it no longer
  earns its place — a §11 tuning call). `InsightCard`'s `isOwn={false}` (read-only related) rendering path
  is **removed** (it has no other caller).
- **Bridge / core** — `insights:list` ([`coreBridge`](apps/desktop/src/main/coreBridge.ts)) **stops
  including** related people's shareable facts for the **display** (it currently returns the active person's
  own insights **+** `listRelatedShareableInsights`). It returns **only the active person's own insights**.
  `listRelatedShareableInsights` ([`insightStore.ts`](packages/core/src/insights/insightStore.ts)) is **no
  longer a Memory-display feed**; it remains available as a building block but its only consumer was the
  removed display — so it is **either removed or repurposed** as the synthesis input reader (§5.2). **Crucially,
  `summarizeForContext` is UNCHANGED** — shared facts still feed the viewer's coaching context; only the
  Memory _display_ stops carrying them. (This is the inverse of the [`20`](20-memory-dashboard.md) §1.1
  privacy fix: there we _scoped_ the list to stop leaking other members' data; here we _stop displaying_
  related partners' shared facts that were intentionally surfaced but shouldn't be shown raw.)

### 5.2 The relationship synthesis (`@selfos/core` — new `relationshipSynthesisService`)

A new service modelled **directly** on `coachingSynthesisService`
([`coachingSynthesisService.ts`](packages/core/src/coaching/coachingSynthesisService.ts)):

- **`synthesizeRelationship(deps)`** — given `{ fs, key, client, apiKey, model, viewerId, partnerPersonId,
now, override? }`:
  1. Resolve the partner's display name + the **viewer→partner relationship type(s)** via the existing
     [`42`](42-relationship-scoped-sharing.md) resolver (`relationshipTypesFromSubjectToViewer`,
     `@selfos/core/people`) — the bridge passes the resolved types in, so `insights`/`coaching` stays
     cycle-free (the established pattern).
  2. **Gate `EMPTY`** when there isn't enough material (the viewer's own insights + the partner's shared
     facts are too thin) — no spend.
  3. **Budget-gate** (person + app `checkBudget`) — over budget / AI off / offline → typed envelopes, no
     spend (the [`40`](40-proactive-coaching.md) pattern).
  4. **Build a bounded structured digest** (§5.3): the viewer's own approved insights' **summaries + facts**
     (filtered through `digestableInsights` — wholly-flagged/wholly-restricted excluded
     ([`insightStore.ts`](packages/core/src/insights/insightStore.ts))) **+** the partner's **shared** facts
     (via `factSharedWithViewer(fact, viewerId, grantedTypes)` — the same gate that lets them feed the
     viewer's coach). **Never raw transcripts.**
  5. **One Claude call** (`PERSONA + SAFETY + RELATIONSHIP_SYNTHESIS_GUIDANCE`, `extendedThinking: false`,
     bounded `maxTokens`), **meter `relationship.synthesize` BEFORE parse**, **tolerant parse** via
     `@selfos/core/ai/jsonSalvage` (`extractJsonObject` + a `.catch`-tolerant Zod schema +
     `classifyParseOutcome` for honest `TRUNCATED`/`MALFORMED`/`REFUSED`/`ERROR` reasons).
  6. **Cache** the `RelationshipSynthesis` (overwrites the prior one). The key stays in main.
- **`getRelationshipSynthesis(fs, key, viewerId, partnerPersonId)`** — the cached read (no spend), for
  re-display + the "reflected `<date>`" stamp.
- **The guidance prompt (`RELATIONSHIP_SYNTHESIS_GUIDANCE`)** instructs the model: produce **one (or a few)
  gentle, second-person observation(s) about the VIEWER and the relationship dynamic** — their patterns,
  how their styles interact — **NEVER quoting, attributing, or revealing the partner's specific shared
  answers** (the [`42`](42-relationship-scoped-sharing.md) §3.4 confidentiality contract, applied to the
  surfaced output too); never a finding/diagnosis/assessment; if there's nothing genuine to say, say so
  honestly; if anything suggests crisis, encourage real support, don't offer an observation. The shared
  facts are background that _shapes_ the observation about the viewer, never repeated back.

### 5.3 The digest (privacy-bounded)

- **Viewer side** — `digestableInsights(listInsightsForPerson(viewer))` (approved + feedable), summaries +
  non-restricted/non-flagged facts (the `buildDigest` shape from `coachingSynthesisService`), bounded
  (recency-capped, the `MAX_INSIGHTS` pattern).
- **Partner side** — the partner's approved, feedable insights, reduced to **only the facts
  `factSharedWithViewer` grants the viewer** — i.e. exactly what already informs the viewer's coach. **This
  is the input, never persisted, never echoed verbatim** into the observation. (A natural building block is
  the existing `listRelatedShareableInsights` shape — but the synthesis needs only the **fact text**, not a
  display projection; the digest builder reads the shared facts directly through the gate.)
- The digest is the **only** thing the model sees; the privacy boundary is that (a) only **shared** partner
  facts enter, (b) restricted/flagged are excluded both sides, and (c) the prompt forbids verbatim
  repetition / attribution.

### 5.4 Renderer

- **`Memory.tsx`** restructured into the §3 layout: header + summary strip; the "About you" / "Relationships"
  `SegmentedControl`; the "About you" view (portrait line + collapsible life-area cards reusing the existing
  `InsightCard`); the "Relationships" view (per-partner `RelationshipInsightCard`). The drafts, Trends, and
  "Manage sharing" link are preserved. The **"About people you relate to"** section is **deleted**.
- **New `RelationshipInsightCard.tsx`** — the per-partner card (§3.3): framing line, the synthesis
  observation(s) via `<Markdown>`, and the generate/loading/generated+refresh/AI-off/EMPTY states. Reuses
  Card/Stack/Button/Banner; if a genuinely new primitive emerges → `/gallery` (DoD §12) — none expected.
- **New `LifeAreaCard.tsx`** (or extend the existing grouping) — the collapsible "About you" area card
  (count + gist; expands to `InsightCard`s); the Intimacy lock + sensitive-collapse-by-default.
- **Stores** — a new per-(viewer) **`relationshipSynthesisStore`** (per-partner cached observation + a
  generate/refresh action over the new IPC), **reset on `activePerson.id` change** in the AppShell reset
  (the per-person isolation rule — [`20`](20-memory-dashboard.md) §5.1). `insightStore` keeps its scoped
  load (now own-only, §5.1) + per-person reset. People + relationships load as today (the partner list).
- The **`/memory/sharing` transparency surface** ([`44`](44-memory-dashboard-overhaul.md) §3.5) is
  **unchanged** (own outbound sharing — kept).

### 5.5 The test-fact sharing default (`@selfos/core/tests/testService.ts`)

`buildFacts` sets `shareableTypes: ['partner']` per §4.3, with the chosen restricted-interaction mechanism
(§4.3 Option A or B, resolved at build). The `takeTest` → `buildInsightForResult` → `buildFacts` path is
otherwise unchanged; a **retake** carries the sharing forward (reuses `insightId`, the §5.4 spec-50
carry-forward) — confirm the carry-forward preserves the new default + any user un-share (the
`updateInsight` merge-by-id rule already preserves per-fact `shareableTypes`).

## 6. IPC / API contracts

All gated by **`memory.own`** + **active-person-scoped + relationship-scoped in the bridge** (the trust
boundary — a person can only synthesize/read a relationship **they're a participant in**; the Claude key
stays in main). Renderer payloads Zod-validated both sides.

- **`insights:list`** — **rescoped** (§5.1): returns **only the active person's own insights** (no longer
  related people's shareable facts). Gated `memory.own`, active-person-scoped. (`insights:update`,
  `:approve`, `:delete`, `:flag` unchanged — own insights only.)
- **`relationships:synthesize({ partnerPersonId, override? })`** → `RelationshipSynthesisResult` — runs the
  pass (budget-gated, metered `relationship.synthesize`, tolerant-parsed). Typed envelopes
  `{ ok: true, synthesis } | { ok: false, reason: 'NO_KEY' | 'BUDGET' | 'AI_OFF' | 'EMPTY' | 'NOT_PARTNER'
| 'REFUSED' | 'TRUNCATED' | 'MALFORMED' | 'ERROR', message }` (the [`37`](37-ai-output-robustness.md)
  honest taxonomy; `EMPTY` = not enough material; `NOT_PARTNER` = the bridge rejects a non-partner target).
  The bridge **re-verifies** the active person relates to `partnerPersonId` as a `partner` (the trust
  boundary — not the UI), resolves the granted types, and reads the partner's shared facts through the gate.
- **`relationships:getSynthesis({ partnerPersonId })`** → the cached `RelationshipSynthesis | null` (no
  spend) — for re-display. Same gating.
- **`memory:outboundSharing()`** — **unchanged** (own-scoped, gated `memory.own`,
  [`42`](42-relationship-scoped-sharing.md)/[`44`](44-memory-dashboard-overhaul.md) §3.5).
- **Test-sharing default** — **no new IPC**; `tests:take` ([`50`](50-self-assessments.md) §6) writes the
  `partner`-default facts via `buildFacts`. Un-sharing a test fact rides the existing `insights:update`
  (carrying `shareableTypes`, [`44`](44-memory-dashboard-overhaul.md) §6).
- **Claude** — only `relationships:synthesize` makes a call: bounded structured JSON,
  `extendedThinking: false` (the `[[adaptive-thinking-shares-maxtokens]]` rule), **meter-before-parse**,
  tolerant parse + honest reasons ([`37`](37-ai-output-robustness.md)). The digest is structured (summaries
  - shared facts), **never raw transcripts**. The key stays in main; only the produced observation (and, for
    admins, its `$`) crosses to the renderer.

## 7. States & edge cases

Per [`00`](00-architecture.md) §7 — every surface handles loading / empty / error / offline. Specifically:

- **No partner** → the "Relationships" view shows a gentle empty state ("Add a partner in People to see
  relationship reflections" / "you don't have a partner relationship yet"); no relationship card, no synthesis
  offered.
- **Partner shares nothing + thin own data** → the partner's card shows the `EMPTY` state ("not enough yet to
  reflect on this relationship — fills in as you both share/reflect"); the generate button still appears but
  returns `EMPTY` (no spend) if tapped. (The synthesis can run on the **viewer's own** material about the
  relationship even with no partner-shared facts, if there's enough — a §11 nuance; recommended: allow it,
  the observation is still about the viewer.)
- **AI off / no key / over budget** → the **own** "About you" view renders fully (no AI needed); the
  relationship card shows a calm connect/budget state, never a dead button. Generating skips silently / shows
  the typed reason.
- **Synthesis not yet generated** → explicit-tap "Reflect on this relationship" (no auto-spend); nothing is
  computed until the user asks.
- **Synthesis cached** → re-display is free; **Refresh** re-runs (a spend). A stale cache simply re-displays
  until refreshed.
- **Multiple partners** → one card + one cached record per partner (keyed by `partnerPersonId`, §4.1); the
  bridge synthesizes the requested partner only. (How prominently to surface several partners — stacked
  cards — is §11; recommended: one card each, in graph order.)
- **Relationship removed / type changed** → the cached record for a no-longer-partner is **ignored** (the
  card isn't shown — the partner list re-resolves from the live graph at read); a stale `synthesis.enc` is
  harmless (never displayed, never fed to context). The partner's **shared facts** re-gate at read for the
  synthesis input (a removed partner contributes nothing).
- **Test result shared then un-shared** → setting a test fact to Private (§3.4) clears its `partner` scope;
  the next relationship synthesis no longer sees it (the digest re-reads the gate live); the viewer's own
  view still shows it (own data).
- **Restricted/sensitive test fact** → never displayed raw to a partner (the §1.1 fix); fed to the synthesis
  **only** via the resolved §4.3 mechanism (which keeps own-context relevance-gating). Its own-view card
  shows the Intimacy lock (§3.2).
- **Crisis-flagged insight** (own) → leads with resources in its `InsightCard` (§8); the relationship
  synthesis prompt is instructed to defer to real support rather than offer an observation when anything
  suggests crisis.
- **Per-person switch** → `insightStore` + `relationshipSynthesisStore` reset; an in-flight synthesis is
  discarded; the new person's own insights + their own partners load (the per-person isolation rule).
- **Large memory** → the "About you" view is collapsible life-area cards (count + gist), so it stays
  scannable regardless of size; search narrows it; lazy-render long expanded groups.
- **Sync conflict / corrupt synthesis file** → standard vault behaviour ([`00`](00-architecture.md) §4.3); a
  corrupt `RelationshipSynthesis` is treated as absent (recompute on next tap), never crashes the view. The
  pass is a pure transform over already-validated records.
- **Migration** → none (additive-optional, §4); a pre-54 vault has no `relationships/<id>/synthesis.enc`
  (the cards show "not yet generated"); existing test results keep their old own-only facts until **re-taken**
  (a §11 note — whether to retro-apply the `partner` default to existing test facts; recommended: new takes
  only, the additive-default precedent, so we never silently widen sharing on data the person already has).

## 8. Safety, privacy & honesty

This is a wellbeing/relationship feature touching the most sensitive content, so the boundary is paramount
(CLAUDE.md §1, [`05`](05-conversations.md) §7, [`42`](42-relationship-scoped-sharing.md) §8,
[`40`](40-proactive-coaching.md) §8).

- **THE HEADLINE: shared data feeds the AI, is NEVER displayed raw to the viewer.** The "About people you
  relate to" raw display is **removed** (§1.1/§5.1). A partner's shared facts continue to **inform the
  viewer's coaching context** (unchanged) and now also feed the **relationship synthesis** — but the viewer
  **never reads the partner's raw answers**. This realigns Memory with the [`42`](42-relationship-scoped-sharing.md)
  §3.4 "shared ≠ shown" promise and the CLAUDE.md §1 durable rule (never make people feel surveilled). An
  E2E asserts the partner's shared fact text is **absent** from the viewer's Memory UI yet **present** in
  the viewer's `buildContext` and as **input** to the synthesis (§10).
- **The synthesis is about the VIEWER, never a disclosure of the partner.** `RELATIONSHIP_SYNTHESIS_GUIDANCE`
  forbids quoting, attributing, or revealing the partner's specific shared answers — the same confidentiality
  contract as the in-coach preamble, now applied to surfaced text. The card's framing repeats this to the
  user ("you're never shown Angel's raw answers — this is about your side"). The model gets only the bounded
  digest (shared facts + own insights); restricted + flagged facts are excluded both sides
  (`digestableInsights` + `factSharedWithViewer`).
- **The test-sharing default is `partner`-ONLY, and reversible.** Test results default to
  `shareableTypes: ['partner']` — **never** parents/coworkers/ex/etc. — including sensitive intimacy + the
  wellbeing/mental-health reflections (the user's explicit call). Because shared facts surface only as
  _insight_ (never raw), even a sensitive/wellbeing result can't leak its raw text to the partner. **The
  wellbeing-sharing consideration (called out explicitly):** auto-sharing a mood/anxiety reflection
  ([`51`](51-wellbeing-neurodivergence-reflections.md)) with a partner is a deliberate, sensitive choice. What flows is the
  **gentle, non-diagnostic display text** ([`51`](51-wellbeing-neurodivergence-reflections.md) §8.1 — never the internal
  clinical band/key), `partner`-scoped, and **only as relationship insight**, never the partner reading "PHQ-9
  said X." The person can **un-share** any wellbeing/sensitive result at any time (§3.4). The
  always-present crisis routing ([`51`](51-wellbeing-neurodivergence-reflections.md) §8 / [`40`](40-proactive-coaching.md)
  §3.5) is **unchanged and independent** of sharing — a crisis signal routes to professional resources
  regardless, and is never something a partner is shown.
- **Not medical / not therapy.** The relationship insight is a **reflective invitation**, never an
  assessment, score, or verdict about the viewer's relationship. `PERSONA + SAFETY` lead the synthesis
  prompt. The not-medical line + the "Get help now" crisis footer are present on every Memory surface
  ([`05`](05-conversations.md) §7).
- **Privacy is per-person + bridge-enforced.** The relationship synthesis is the **viewer's** cached
  reflection (single-subject), stored under the viewer's folder, fed only by the viewer's own data + the
  partner's **shared** facts (through the existing gate). The bridge re-verifies the `partner` relationship
  and resolves granted types (the trust boundary — not the UI). No copy implies an owner/admin can see a
  person's content (the durable rule). The cached record never persists the partner's raw facts.
- **Honest, calm signals.** A failed synthesis is a calm typed reason ([`37`](37-ai-output-robustness.md)),
  never a data-blame; the tone is warm and low-pressure; the observation is offered as "something to wonder
  about," never a judgment of the relationship.

## 9. Accessibility

Per [`01`](01-design-system.md) §9:

- The **view switch** is a real `SegmentedControl` (keyboard-operable, `aria-pressed`/roles, visible focus),
  **full-width on phones — never a horizontal scroll** (CLAUDE.md §12; the long-label-scrolls footgun is
  avoided by a 2-option switch + full-width).
- **Collapsible life-area cards** are real disclosure widgets (button summary + region, `aria-expanded`),
  with clear spacing between summary and body when open ([`01`](01-design-system.md)/CLAUDE.md §12); the
  count + gist + lock badge are **text**, not colour-only. Sensitive areas start collapsed (the count/gist
  still visible) so intimacy isn't on screen at a glance.
- The **relationship-insight card** states its framing as text; the generate/refresh buttons are labelled,
  keyboard-operable, visible focus; the loading state is a polite `role="status"`; the AI-off/EMPTY states
  are real text, never colour-only.
- Reuses the [`44`](44-memory-dashboard-overhaul.md) a11y for the `InsightCard`, the per-fact
  `RelationshipScopePicker` ([`42`](42-relationship-scoped-sharing.md) §9), confidence chip, trends text
  equivalent, and the crisis-lead.
- Responsive ~360px→desktop: cards stack; **no horizontal scrollbars anywhere** (incl. inner controls — the
  §12 DoD guard at the real container widths); no inner element scrolls-x; the collapsible cards keep the
  full surface reachable. Reduced-motion respected.

## 10. Testing strategy

Per the DoD (CLAUDE.md §7). Use the established fakes (`SELFOS_FAKE_CLAUDE` — made imperfect by default per
[`37`](37-ai-output-robustness.md)); **decrypt the vault** to assert data, not just the UI; run
`pnpm typecheck` after tests (memory `vitest-does-not-typecheck`).

- **Privacy (the headline guard — a decrypt-level E2E):** relate A↔B as **partners**; B shares a fact (or a
  `partner`-default test result) with A. Sign in as **A** → open Memory → assert B's shared fact text is
  **ABSENT** from the rendered "About you" **and** there is no "About people you relate to" raw section;
  then assert the **same fact text DOES feed A's `buildContext`** (decrypt the assembled context) **and** is
  passed as **input to the relationship synthesis** (the digest the fake Claude received). The boundary is
  asserted both ways so it can't silently regress (mirrors [`20`](20-memory-dashboard.md) §10 +
  [`42`](42-relationship-scoped-sharing.md) §10).
- **Test-sharing default reaches the partner (decrypt):** A takes a Big Five test; relate A↔B as partners →
  decrypt B's `buildContext` and assert A's test fact reaches it (the new `partner` default works); a
  **sensitive** test (kink) result and a **wellbeing** result default `partner`-shared too, and — via the §4.3
  mechanism — reach a partner's relevant context while still being **own-context relevance-gated** (the kink
  fact reaches A's own intimacy context but NOT A's money chat, AND reaches B as input only via the gate,
  never as raw display). **Un-share** a test result → it no longer reaches the partner's context/synthesis.
- **Unit (core):** `relationshipSynthesisService.synthesizeRelationship` — meters `relationship.synthesize`
  **before** parse (a billed-but-unparseable call still records usage); tolerant-parses (a `.catch`-tolerant
  schema salvages an off-spec field; `classifyParseOutcome` yields honest `TRUNCATED`/`MALFORMED`/`REFUSED`);
  the digest **excludes restricted + flagged facts** both sides (`digestableInsights` + `factSharedWithViewer`)
  and **never includes a non-shared partner fact**; `EMPTY` when material is thin (no spend); budget-gate
  skips over budget; `NOT_PARTNER` rejection for a non-partner target; `getRelationshipSynthesis` re-reads
  the cache. The §4.3 mechanism's truth table (the chosen Option A or B): a sensitive test fact is
  `partner`-shared **and** own-context relevance-gated, verified against the **real** `factSharedWithViewer`
  - `summarizeForContext`.
- **Component (RTL):** Memory renders the summary strip + the "About you"/"Relationships" switch; "About
  you" renders the portrait line + collapsible life-area cards (count + gist; expand → `InsightCard`s; the
  Intimacy lock; sensitive areas collapsed by default); the relationship card renders the framing +
  generate / loading / generated+refresh / AI-off / EMPTY states; **no "About people you relate to" section
  exists**; search auto-expands a matching area.
- **E2E (Playwright):** the privacy guard above; generate a relationship insight (fake Claude) → it renders
  - caches → Refresh re-runs → AI-off shows the calm state while own data still renders; the no-horizontal-
    overflow / inner-scrollbar guard at ~360px on the redesigned Memory (the view switch full-width, the
    collapsible cards, the relationship card); the full-surface-renders-to-the-bottom guard (no
    default-collapsed group hides own facts unreachably — a sensitive area is collapsed but its count/gist are
    visible and it's expandable). Visual QA at desktop + 360px (the summary strip, the two views, the
    collapsible cards, the relationship card all read clean + intentional).

## 11. Open questions

Genuinely-open decisions — **do not assume**; resolve with the user (or against the real gate at build)
before building.

1. **THE KEY TECHNICAL FORK — the `restricted`-vs-`shareableTypes` interaction (§4.3).** How does a
   sensitive/wellbeing test fact become `partner`-shared **AND** keep its own-context relevance-gating, given
   that `factSharedWithViewer` short-circuits on `restricted` and `summarizeForContext` uses `restricted` +
   `lifeArea` to relevance-gate? **Option A** (drop `restricted` on sensitive test facts + move the
   own-context relevance gate's trigger from `restricted` to `lifeArea`) vs **Option B** (a new partner-only
   `partnerShareable`/`relationshipShared` flag that bypasses the `restricted` short-circuit for the
   `partner` type only). **This must be evaluated against the live `factSharedWithViewer` +
   `summarizeForContext` + the spec-50/51 E2E at the start of the build session — it is the load-bearing
   privacy mechanic, not a guess.** _Recommendation: prefer A if the gate can move to `lifeArea` without
   weakening any other restricted-fact guarantee; else B (narrow, partner-only, explicit)._
2. **Relationship insights for non-partner relations?** Offer the synthesis only for `partner` (v1), or also
   for parent/child/sibling/friend? _Recommendation: `partner`-type first — it's where the dynamic is most
   meaningful and the data richest; other types are a later additive slice (and most privacy-fraught for
   ex/coworker)._
3. **Multiple partners** — how to surface several partner cards (stacked in graph order? a partner picker?),
   and may the synthesis ever consider more than one partner at once? _Recommendation: one independent card +
   cached record per partner (keyed by `partnerPersonId`), single-partner synthesis only — per-person/
   per-partner isolation, no cross-partner blending._
4. **The two Memory views — a toggle vs stacked sections?** The mockup uses a `SegmentedControl` switch
   ("About you" / "Relationships"). Stacked sections (both always visible, scroll between) is the
   alternative. And where do drafts / Trends / "Manage sharing" live — above the switch (always visible) or
   inside "About you"? _Recommendation: the toggle (cleaner, less on screen); drafts/Trends/Manage-sharing
   above the switch (own-data concerns)._
5. **Synthesis cadence** — explicit-tap + cache only (the [`40`](40-proactive-coaching.md) manual path), or
   also an auto-cadence (a renderer-driven launch/focus trigger + throttle, [`40`](40-proactive-coaching.md)
   §3.4)? _Recommendation: **explicit-tap + cache only** for v1 (predictable cost, no surprise spend on a
   sensitive surface); an auto-cadence is a later additive slice (it would add the §4.2 throttle state then)._
6. **Retro-apply the `partner` test default to EXISTING test results, or new takes only?** Re-applying would
   widen sharing on data the person already has (without an explicit act); new-takes-only preserves the
   additive-default precedent. _Recommendation: **new takes only** — never silently widen sharing on existing
   data; existing results pick up the default when re-taken (or the person shares them deliberately)._
7. **Storage key for the cache** — `relationships/<partnerPersonId>/synthesis.enc` (recommended, a stable
   person id) vs a relationship-edge id. _Recommendation: the partner person id (the observation is about a
   person; a viewer may relate through several edges)._
8. **Does the subject filter survive the redesign?** With the raw related display gone, the "subject" filter
   (You / each related person) loses its related options. Keep it (own-only / area filters), fold its role
   into the view switch, or drop it? _Recommendation: drop the subject filter; the view switch + search +
   life-area cards cover navigation._

## 12. Changelog

- 2026-06-26 — created (Draft). The Memory redesign: removes the raw "about people you relate to" display
  (sharing feeds the viewer's AI context, is never shown raw — realigning Memory with the
  [`42`](42-relationship-scoped-sharing.md) §3.4 "shared ≠ shown" promise + the CLAUDE.md §1 durable rule);
  adds AI-synthesized per-partner **relationship insights** (about the viewer + the dynamic, modelled on the
  [`40`](40-proactive-coaching.md) `coachingSynthesisService` pattern — bounded digest, meter-before-parse,
  tolerant parse, per-(viewer,partner) cache, explicit-tap, a new `relationship.synthesize` usage type);
  keeps the viewer's own data shown but redesigned for scannability (portrait line + collapsible life-area
  cards + the Intimacy lock); and bundles the [`50`](50-self-assessments.md) test-sharing default change
  (test facts default `shareableTypes: ['partner']`, incl. sensitive intimacy + wellbeing — the user's
  explicit call — `partner`-only + un-shareable) so shared test facts surface as relationship insight, never
  raw. Amends [`20`](20-memory-dashboard.md); supersedes the raw-display half of
  [`44`](44-memory-dashboard-overhaul.md). Open questions in §11 — the **`restricted`-vs-`shareableTypes`
  interaction** (the key technical fork) to resolve against the live gate at build; non-partner relations,
  multiple partners, the view layout, cadence, retro-apply, the cache key, and the subject filter to confirm
  with the user.
