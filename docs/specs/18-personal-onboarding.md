# 18 — Personal onboarding ("Getting to know you")

> **Status:** Approved · _last updated 2026-06-15_ · **Amended 2026-06-15 (§14–§15, building):** the all-chat
> interview is being reworked into a **hybrid form/chat intake** — a short gated `core` of quick forms +
> `invited` deep/sensitive sections, specific questions everywhere, an explicit branched intimacy block, useful
> answers promoted to real `Person` fields, the questionnaire engine reused (§14) — plus a **self-maintaining
> profile** that detects stale answers from ongoing activity and invites updates (§15). §1–§13 describe the
> as-first-built v1; §14–§15 are the active redesign.
>
> A warm, AI-guided onboarding that helps a person tell SelfOS who they are — their life now, their
> history, family, health, what weighs on them, relationships, values, what they want to work on, and
> (opt-in) intimacy & sexuality. It runs as a **guided, adaptive interview** the person can pause and
> resume, **auto-fills the (owner-only) profile** as they go, and on synthesis produces a **comprehensive
> portrait** — the **fourth producer** into the shared Insight/metrics layer — that personalizes chat,
> dream analysis, the gap-finder, and Home everywhere. The goal: a deep, genuinely useful understanding of
> the person, captured gently and held with care.

New feature. Builds on [`05`](05-conversations.md)/[`06`](06-ai-usage-and-budgets.md) (the streaming chat +
metering it reuses), [`09`](09-session-analysis.md) (analysis → Insight pattern), [`08`](08-questionnaires.md)
(the shared Insight/metrics layer + the **restricted-fact redaction** model it reuses), [`15`](15-shareability.md)
(per-item shareability — sensitive data defaults locked), [`16`](16-guided-sessions.md) (the
guided/structured-interview machinery), and [`04`](04-people-roles.md) (people, capabilities, the
owner full-access model, `buildContext`). References [`00`](00-architecture.md) and [`01`](01-design-system.md).

---

## 1. Overview

Today a person's profile is built by hand (owner-only) and enriched indirectly via sessions, dreams, and
questionnaires. This adds a **front-door onboarding**: the person themselves answers a comprehensive,
adaptive interview about who they are. Two things come out of it:

1. **The (owner/AI-facing) profile auto-fills** — direct questions map straight to `Person` fields
   ([`04`](04-people-roles.md)/[`15`](15-shareability.md)); the member never sees those raw fields (profile
   management stays `people.manage` = owner only), so the fill is **automatic, no member review**.
2. **A comprehensive portrait** — on synthesis, AI distils the interview into an **Insight (`source:
'intake'`)** that feeds the person's **own** coaching context everywhere, plus a member-facing "here's what
   I've come to understand about you" summary.

**Who & when.** Every person does their **own** intake about **themselves** (capability `intake.own`, Member
default ON). It is the **intended first-run experience** — strongly guided and nudged — but **resumable**
across sittings and **never a hard lock** (§3.1). It's **AI-driven** (a live, adaptive interview), so it
**requires AI to be configured + online + in budget** to run (§7).

**Held with care.** This is the most sensitive data in the app. The interview is warm and trauma-informed;
heavy and intimate sections are clearly flagged, fully skippable, and gated (§8). The most sensitive
categories (trauma, sexuality) **default to the person's own context only** and are **redacted from normal
views** — shown directly only to a holder of `intake.readRestricted` (the Owner) (§8.4).

## 2. Goals / Non-goals

**Goals**

- A warm, adaptive, **resumable** self-onboarding interview covering a comprehensive picture of the person.
- **Auto-fill** the owner-only `Person` profile from answers, with **no member-facing review** (members don't
  see profile fields).
- Produce a **portrait Insight (`source: 'intake'`)** that feeds the person's own `buildContext` and a
  **member-facing closing summary**.
- **Living profile** — the person can revisit, revise, and **re-synthesize** over time (§3.6).
- **Safety-first**: not-medical framing, crisis routing, content warnings, skippability, 18+ gating for
  intimacy, and strong privacy defaults for the most sensitive data (§8).

**Non-goals (deferred / out of scope)**

- **Auto-creating People/relationships** from family/relationship answers — v1 is **self only**; populating
  the people graph (the mother/partner/ex they mention) is a clearly-flagged phase 2.
- **A member-facing view of the raw profile fields** — those stay owner only.
- **Clinical assessment, diagnosis, or treatment** — explicitly not this (§8); it's reflective self-knowledge.
- **An AI-free intake** — the interview is AI-driven by design; when AI is unavailable it can't run (§7).
- **Voice** — deferred, but nothing here precludes it.

## 3. UX & flows

### 3.1 Entry, "required", and resume

- **Members are hard-gated** (revised 2026-06-15): a Member who hasn't finished onboarding is taken straight
  into a **full-screen takeover** of the app — no sidebar, no other screens — on every login until they
  finish. "Finished" = the closing **portrait is generated** (`IntakeSession.status === 'complete'`); they may
  skip individual sections/questions, but they must work through the whole flow and produce the portrait. The
  header stays (so they can still switch person / lock), AND the onboarding screen itself carries a discoverable
  **"Switch person"** button (in its header, every state) so the gated Member can switch accounts without
  hunting in the titlebar menu; the crisis "Get help now" resources are always present, so it's a gate, not a
  dead-end. On completion the gate releases and they land on the portrait (now with the sidebar), with the
  Onboarding nav entry available to revisit it.
- **The Owner is exempt** from the gate — the Owner sets up the household + AI
  (and the intake _requires_ AI, so a gated owner with no key would be trapped). The Owner instead gets the
  **persistent nudge** (a Home card + the nav affordance + an "unfinished" dot) until they do it voluntarily.
- Because the intake is **AI-driven**, it checks **AI availability** (key configured + online + budget). If AI
  isn't ready, onboarding shows a clear **"connect AI to begin"** state: the **owner** is routed to Settings →
  AI; a gated **member** (who can't configure AI) is told their household owner needs to enable AI first and
  stays gated (no progress is lost). The owner enables AI in their own (ungated) session.
- **Save & resume** is first-class: progress is saved continuously (per answer + per section); the person can
  leave anytime and return to exactly where they were, across days. A progress indicator shows sections done /
  remaining and an estimate. The **last-opened section is remembered device-local** (per person), so a reload
  or app restart reopens that section rather than bouncing back to the first unfinished core step; reopening a
  section with an in-progress go-deeper chat shows that transcript directly.
- **The "Go deeper" section navigator is shown at the bottom of EVERY section** (core steps AND any opened
  invited section) — the grid of all the deeper sections (Health & wellbeing, Relationships, Family, Your
  story, What weighs on you, Intimacy & sexuality, each with an Add/Skipped/done/**Current** state). From any
  section the person can jump **straight** to another without going Back first; switching scrolls the new
  section to the top.

### 3.2 The interview (hybrid: structured sections + live AI depth)

Onboarding is organized into **sections** (§4.2). Within a section, the AI conducts an **adaptive interview**
(reusing the [`05`](05-conversations.md) streaming machinery + an "interviewer" persona addendum, §5):

- It asks **one question at a time**, warmly; some questions are **direct/structured** (mapped 1:1 to a
  `Person` field — e.g. occupation, location, languages) and are captured immediately; others are **open**,
  and the AI **probes deeper** with adaptive follow-ups to draw out a rich picture.
- The person can **answer, skip a question, or skip the whole section** at any time; "I'd rather not" is
  always honored without pushback. A **"go deeper" / "that's enough on this"** control lets the person steer
  how far each topic goes.
- The interview transcript is stored under the person (not in the Sessions list, like dream-analysis chats),
  so it never clutters Sessions.

### 3.3 Sensitive sections (heavy + intimate)

- **Heavy topics** ("what weighs on you" — trauma, grief, struggles) open with a brief, kind **content
  note** ("we can go as light or deep as you want, and skip anything"), are fully skippable, and are handled
  trauma-informed (validating, never probing for detail the person doesn't offer, watching for crisis, §8.2).
- **Intimacy & sexuality** is a **separate, opt-in block** gated behind a one-time **18+ acknowledgement**
  (reusing the [`16`](16-guided-sessions.md) per-person adult-ack pattern). It is entirely skippable; entering
  it is a deliberate choice. Individual questions remain skippable.

### 3.4 Auto-fill (silent, owner/AI-facing)

As the person answers, **direct questions write straight to the `Person` profile** (owner-only).
The member sees **no** profile fields and **no** "review the extracted fields" step. Inferred fields (values,
communication style, goals) are filled by the **synthesis** pass (§3.5). Sensitive-category outputs follow the
privacy defaults in §8.3/§8.4.

### 3.5 Synthesis & the closing portrait

When a section (and ultimately the whole intake) completes, a **synthesis pass** distils the interview into:

- a **portrait Insight (`source: 'intake'`)** — a rich summary + structured **facts** + **metrics** (e.g.
  communication/attachment leanings, core values) — auto-approved into the person's **own** context; sensitive
  facts default **non-shareable** (own-context-only), restricted ones excluded from owner views (§8.4);
- **inferred `Person` field** fills (values, communicationStyle, goals, faith, …);
- a warm, member-facing **"Here's what I've come to understand about you"** summary the person can read — a
  payoff and a feeling of being seen (distinct from the raw profile fields they don't see).

### 3.6 Living profile (revisit, revise, re-synthesize)

After completion the intake is **not frozen**: the person can reopen any section, add to or revise their
answers, and **re-run synthesis** — which updates the portrait Insight (reusing the same insight id, carrying
shareable choices forward, like [`09`](09-session-analysis.md)'s re-analysis) and refreshes inferred fields.
People change; the portrait keeps up.

## 4. Data model

### 4.1 Vault files & schemas

All per-person, encrypted, via the vault/crypto service (no direct `fs`).

- **`people/<person-id>/intake/session.enc`** — the `IntakeSession`: the interview transcript + structured
  answers + per-section status (notStarted/inProgress/skipped/complete) + which sections are `restricted`
  (heavy/intimate). Resume reads this.
- **The portrait** is an **`Insight` (`source: 'intake'`)** stored in the existing
  `people/<id>/insights/…` (the [`08`](08-questionnaires.md) layer), `approved: true`, `provenance` carrying
  an `intakeSection?`. Its facts carry the existing `shareable`/`shareableWith` ([`15`](15-shareability.md))
  - a new **`restricted?: boolean`** marking `intake.readRestricted`-only facts (§8.4).
- **Profile fills** write to the existing `Person` (no new file). Sensitive direct fields (e.g. health) are
  auto-added to `Person.privateFields` (own-context-only) per §8.3.

```ts
// InsightSourceSchema gains 'intake' (the 4th producer) — additive; existing Insights parse unchanged.
InsightSource = 'questionnaire' | 'session' | 'dream' | 'intake';

interface IntakeSection {
  id: string; // e.g. 'family', 'intimacy'
  status: 'notStarted' | 'inProgress' | 'skipped' | 'complete';
  restricted: boolean; // heavy/intimate → only a holder of intake.readRestricted (the Owner) sees it (§8.4)
  messages: ChatMessage[]; // the adaptive interview transcript for this section
  answers: Record<string, unknown>; // structured/direct answers (field-mapped)
}
interface IntakeSession {
  id: string;
  schemaVersion: number;
  personId: string;
  status: 'inProgress' | 'complete';
  sections: IntakeSection[];
  adultAck?: boolean; // 18+ ack for the intimacy block (per-person)
  insightId?: string; // the portrait Insight
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

`InsightFact` gains `restricted?: boolean`; `Insight.provenance` gains `intakeSection?: string`. All
additive-optional; the only enum touch is `InsightSource += 'intake'` — **no schemaVersion bump** for existing
shapes (the additive precedent).

### 4.2 Section catalog (built-in, code — not vault)

A curated, code-defined catalog (like [`16`](16-guided-sessions.md)'s exercises), each section with seed
questions, which are **direct field-mapped** vs **open/probed**, and a `restricted`/`adult` flag. Proposed
sections:

1. **The basics** — pronouns, gender, birthday, location, languages, ethnicity, occupation _(direct → fields)_.
2. **Your life now** — daily life, work, living situation, rhythms.
3. **Family & upbringing** — family of origin, parents/siblings, how you were raised, culture, faith growing up.
4. **Your story** — key chapters, milestones, formative experiences, losses.
5. **Health & wellbeing** — physical/mental-health context, sleep, energy _(→ `healthNotes`, locked private)_.
6. **What weighs on you** _(restricted)_ — struggles, grief, traumas, stuck patterns, "what you carry."
7. **Relationships** — current/past relationships, patterns, attachment, conflict style, what you need.
8. **Values & identity** — what matters, beliefs, faith, identity, communication style _(→ `values`/`faith`/
   `communicationStyle`)_.
9. **What you want** — goals, growth areas, hopes _(→ `goals`)_.
10. **Intimacy & sexuality** _(opt-in, 18+, restricted)_ — desires, preferences, kinks, turn-ons, boundaries,
    what intimacy means to you.

Final per-section wording + the exact direct-field map are tuned at build (§11).

## 5. Architecture & modules

- **Core (`@selfos/core`)** — a new **`intakeService`** (sibling of `sessionAnalysisService`/dream services):
  `getState` (resume), `runTurn` (one adaptive interview turn — reuses the [`05`](05-conversations.md) chat
  stream + budget/metering; stores into the section transcript), `skipSection`, `synthesize` (the section/full
  portrait pass → `Insight` + inferred field fills; meters before parse, [`09`](09-session-analysis.md)
  pattern), `acknowledgeAdult`. The **interviewer persona** is a `promptBuilder` addendum **after**
  PERSONA + SAFETY + the person's own context (warm, trauma-informed, one-question-at-a-time, honors skips,
  watches for crisis). The **section catalog** is code (`intakeCatalog.ts`). Field-mapping + sensitive-lock
  logic is pure + tested.
- **Metering ([`06`](06-ai-usage-and-budgets.md))** — interview turns meter as a new **`intake.interview`**
  type; synthesis as **`intake.synthesize`**. Normal budget rules apply (no special cap, §round-3); over
  budget pauses the interview gracefully (resume later).
- **Restricted-fact gating ([`08`](08-questionnaires.md) reuse)** — a new **EXPLICIT_GRANT_ONLY** capability
  **`intake.readRestricted`** (ships OFF for non-owner roles; the **Owner always has it**) gates
  viewing `restricted` sections/facts in owner surfaces; a holder sees them directly via `insights:list`,
  redacted for everyone else — **no reveal ceremony, no audit log** (§8.4).
- **Renderer** — an onboarding **flow surface** (the sectioned interview: streamed Q&A via the [`05`](05-conversations.md)
  `Composer`/stream + the `CrisisFooter`; section progress; skip/deeper controls; the 18+ gate; the closing
  portrait), a persistent **nudge** (Home card + nav), and a per-person **`intakeStore`** (reset on
  `activePerson.id` change). No member-facing profile editor (unchanged: owner-only). The owner's
  People/Memory views render `restricted` content only to a holder of `intake.readRestricted` (the Owner),
  redacted otherwise.
- **No new nav for the profile** — profile stays in People (owner). A new `/onboarding` route (or the Home
  nudge) hosts the member's intake.

## 6. IPC / API contracts

All gated by **`intake.own`** + **active-person-scoped in the bridge** (the trust boundary); the Claude key
stays in main.

- `intake:getState()` → the `IntakeSession` (resume) + AI-availability.
- `intake:runTurn({ sectionId, userText })` → streams the interviewer reply ([`05`](05-conversations.md)
  streaming), persists the turn + any direct field fills; typed `NO_KEY`/`BUDGET`/`AI_OFF` envelopes.
- `intake:skipSection({ sectionId })`, `intake:acknowledgeAdult()`.
- `intake:synthesize({ sectionId? })` → runs the portrait pass (consented by doing it), returns the
  member-facing summary; updates the Insight + fields.
- Restricted facts are redacted from `insights:list` for callers **without** `intake.readRestricted`; a
  holder (the Owner) receives them directly. There is **no** `intake:revealRestricted` channel and no audit
  entry (both removed 2026-06-14).

## 7. States & edge cases

- **AI not configured / offline / over budget** — the intake **cannot run** (it's AI-driven). Owner → Settings
  → AI; member → "owner must enable AI." Not hard-locked; the nudge persists; partial progress is preserved.
  Over budget mid-interview pauses gracefully → resume when budget refreshes.
- **Resume** — returns to the exact section/turn; sections keep their own status.
- **Skip** — a skipped section/question never blocks completion; "complete" = the person worked through (or
  skipped) every section.
- **Crisis disclosure mid-interview** — the interviewer leads with warmth + resources (§8.2); never a cold
  metric; the always-present `CrisisFooter` remains.
- **Re-synthesis** — updating answers + re-running synthesis reuses the insight id, carries shareable choices
  forward, refreshes fields ([`09`](09-session-analysis.md) precedent).
- **Per-person isolation** — `intakeStore` + the adult-ack reset on `activePerson.id` change; one person's
  intake never leaks into another's view.
- **Migration** — `InsightSource += 'intake'`, `InsightFact.restricted?`, `Insight.provenance.intakeSection?`
  are additive; existing data parses unchanged.
- **Sync conflict / corrupt file** — standard vault behaviour ([`00`](00-architecture.md)); a corrupt intake
  file degrades to "start/continue," never silently shares restricted content.

## 8. Safety, privacy & honesty

This is the most safety- and privacy-critical surface in SelfOS.

### 8.1 Not medical

Onboarding is **reflective self-knowledge, not clinical intake, assessment, diagnosis, or treatment**
(CLAUDE.md §1). The interviewer persona is appended **after** the non-negotiable PERSONA + SAFETY and cannot
override them. Copy frames it as "helping SelfOS understand you," never "evaluating" or "treating" you.

### 8.2 Crisis & trauma-informed conduct

- Heavy sections open with a kind content note; **everything is skippable**; the interviewer **never pressures**
  for detail and validates "I'd rather not."
- **Crisis routing** is unchanged and non-negotiable ([`05`](05-conversations.md) §7): if the person discloses
  self-harm/suicide/abuse risk, the AI responds with warmth, takes it seriously, and routes to professional/
  emergency help — never managing a crisis alone. The "Get help now" footer is always present.
- Trauma content is held as the person offers it; the interviewer does not dig for specifics.

### 8.3 Privacy defaults (sharing into others' context)

Per [`15`](15-shareability.md), every produced item is individually lockable. The intake **applies defaults
automatically** (the member doesn't manage sharing — they never see the toggles): **trauma & sexuality
categories default own-context-only** (their Insight facts `shareable: false`; mapped `Person` fields added to
`privateFields`); everything else follows the app's "shared" default. The **owner can fine-tune per-item** in
the People editor afterward.

### 8.4 Owner visibility of the most sensitive data

The **restricted** sections (§4.2: "what weighs on you", "intimacy & sexuality") and their derived facts are
**redacted from normal Memory/People views** for anyone **without** the `intake.readRestricted` capability.
They live in the encrypted intake + the person's **own** coaching context. The **EXPLICIT_GRANT_ONLY
`intake.readRestricted`** capability gates them: it ships **OFF for non-owner roles**, and a holder (the
**Owner**, who has full access) sees the restricted facts **directly** in Memory (marked "sensitive") via the
normal `insights:list` — there is **no reveal ceremony and no audit log** (the audited break-glass was
removed 2026-06-14). (Consistent with [`04`](04-people-roles.md) §8: the vault isn't zero-knowledge from the
owner; restriction is enforced at the app/UX layer, like all RBAC.)

**Two structural invariants enforce this (verified in code review):** (1) a `restricted` fact is **always
own-context-only** — `summarizeForContext`/`buildLinkedPeopleContext` exclude it from any **other** person's
context regardless of `shareable`/`shareableWith`, so it can never broadcast even if a flag is toggled; and
(2) editing/approving a fact in Memory **carries the `restricted` flag (and `shareableWith`) forward** —
`updateInsight` merges the renderer's `{id,text,shareable}` patch onto the stored fact by id, so a Memory
edit can never silently strip the restriction and surface it in the owner's normal view.

### 8.5 Transparency & consent

The intake opens with a plain note: what it's for, that it's AI-guided (answers are processed by Claude to
build the profile), that it's encrypted and theirs, that they can skip anything and stop anytime, and that the
most sensitive topics stay private to their own coaching. Doing the AI-driven interview **is** the consent;
the note makes it informed.

## 9. Accessibility

Per [`01`](01-design-system.md) §9: the streamed interview (a polite live region), one-question focus flow,
skip/deeper controls (real buttons, labelled), the 18+ gate, the progress indicator (not color-only), and the
closing portrait are keyboard-operable + screen-reader friendly. Responsive ~360px→desktop within the
[`02`](02-app-shell.md) shell. Reduced-motion respected. Content warnings are text, not color alone.

## 10. Testing strategy

- **Unit (core):** `intakeService` resume/skip/turn; **direct answers fill the mapped `Person` field**;
  **sensitive direct fields are auto-added to `privateFields`**; synthesis produces an `Insight` (`source:
'intake'`) with **sensitive facts `shareable: false` and restricted facts flagged**; re-synthesis reuses the
  id + carries shareable choices forward; metering emits `intake.interview`/`intake.synthesize`; budget/no-key
  envelopes; the interviewer addendum is appended **after** PERSONA + SAFETY.
- **Redaction (core/bridge):** `restricted` facts are **redacted** from `insights:list` for a caller without
  `intake.readRestricted`; a holder (the Owner) receives them directly (marked "sensitive"); a normal
  owner without the grant cannot read them.
- **Component (RTL):** the sectioned flow (stream, skip, go-deeper), the AI-unavailable state (owner vs member
  copy), the 18+ gate on the intimacy block, the persistent nudge, the closing portrait, resume.
- **E2E (Playwright, `SELFOS_FAKE_CLAUDE`):** new person → onboarding nudge → run an interview turn → a direct
  answer fills a profile field (decrypt to assert) → skip the intimacy block → synthesize → the portrait
  Insight feeds a later session's `buildContext` (decrypt) → a restricted fact is redacted from a non-owner's
  Memory view but shown directly to the Owner; resume mid-intake; 390px + control-geometry guards.
- Vault + Claude mocked as established; run `pnpm typecheck` after tests (memory `vitest-does-not-typecheck`).

## 11. Open questions

_All major product decisions resolved across the 2026-06-14 planning rounds (see §12). The build-time
tunings below were resolved at build (2026-06-14, see §12 "Build-time decisions"):_

1. **Section wording + the exact direct-field map** — RESOLVED. The catalog (`intakeCatalog.ts`) defines the
   final 10 sections, each with a static opener, a `directFields` map (which `PersonFieldKey` each captures
   1:1, with a `private` flag for sensitive ones), and `restricted`/`adult` flags. Direct fields are filled
   immediately during the interview via an AI-embedded `[[SELFOS:FIELD:key=value]]` marker (the wrap-up /
   step-marker precedent), stripped from saved + streamed text; inferred fields are filled at synthesis.
2. **Restricted-fact capability shape** — RESOLVED (amended 2026-06-14): a `restricted` fact is **redacted
   from `insights:list`** for a caller without `intake.readRestricted`; a holder (the Owner) receives it
   directly (no `intake:revealRestricted` op, no `RawAccessAuditEntry`, no `auditService` — the audited
   reveal was removed).
3. **Closing-portrait depth** — RESOLVED: a **light per-section reflection** auto-runs when a section
   completes (a small `intake.synthesize` spend, the per-section payoff) **and** a **richer final portrait**
   the person taps once to generate (the explicit, bigger `intake.synthesize` pass that builds the Insight +
   inferred fills). The final portrait is never auto-run (honors the guided-sessions "never auto-spend" rule).
4. **Nudge persistence** — RESOLVED: derived from `IntakeSession.status` (vault), correct across devices.

## 12. Resolved decisions (2026-06-14)

- **Format** — hybrid: structured sections with **live AI probing** throughout (AI-driven interview).
- **Auto-fill** — writes to the **owner-only** profile automatically as answered; **no member review** (members
  never see profile fields).
- **Scope** — **self only**; auto-creating the people graph is phase 2.
- **Sensitive sharing default** — trauma/sexuality/kinks default **own-context-only**; rest shared; applied
  automatically; owner adjusts later.
- **Intimacy block** — **opt-in, 18+ acknowledgement, fully skippable**.
- **Required** — the **intended first-run path, strongly nudged, resumable, not hard-locked**.
- **AI availability** — the intake **requires AI configured/online/in-budget** to run (no AI-free fallback);
  when unavailable, a clear "connect AI" state + persistent nudge, never a dead-end.
- **Budget** — **normal budget rules**, no special cap; over-budget pauses → resume.
- **Living profile** — **editable + re-synthesizable** over time.
- **Owner visibility of intimate/trauma data** — gated by `intake.readRestricted` (the Owner has it;
  redacted for everyone else); shown directly in Memory marked "sensitive", **no audit log**.
- **Closing portrait** — a **member-facing** warm summary.

### Build-time decisions (2026-06-14, at implementation)

- **Synthesis cadence** — light per-section reflection auto-runs on section completion; the richer final
  portrait is explicit (tap to generate). Both meter `intake.synthesize` (§11.3).
- **18+ acknowledgement** — **shared** with guided sessions (`16`): the existing per-person
  `guidance/prefs.enc` `adultAcknowledged` flag gates both the intimacy guided exercises **and** the intimacy
  intake block; `intake:acknowledgeAdult` writes the same flag. Acking once anywhere unlocks both.
- **First-run entry** — _superseded 2026-06-15:_ originally a dismissible auto-route-once. Now a **hard gate
  for Members** (full-screen takeover until the portrait is generated) + a **nudge for the exempt Owner** (see
  §3.1). The auto-route was removed.
- **Insight-fact sharing default** — **all** intake Insight facts default `shareable: false` (own-context-only),
  matching the session/dream precedent; restricted-section facts are additionally `restricted: true`. §8.3's
  "shared default for everything else" governs the **mapped `Person` fields** (not locked → shared); the owner
  can still promote individual facts per-person in Memory. This is the safe reading (no surprise broadcast of a
  person's intake into others' coaching).

## 13. Changelog

- 2026-06-14 — created (Review). Decisions resolved ask-first across four question rounds; build-ready pending
  final approval. The fourth Insight producer; reuses [`05`](05-conversations.md)/[`09`](09-session-analysis.md)
  chat+analysis, [`15`](15-shareability.md) shareability, [`16`](16-guided-sessions.md) interview machinery, and
  [`08`](08-questionnaires.md) break-glass/audit.
- 2026-06-14 — **Approved + built** (`feat/personal-onboarding`). Build-time tunings resolved (§11 / §12
  Build-time decisions). Core `intakeService` + `intakeCatalog`; `InsightSource += 'intake'`,
  `InsightFact.restricted?`, `Insight.provenance.intakeSection?`, generalized `RawAccessAuditEntry` (all
  additive); `intake.own` (Member ON) + `intake.readRestricted` (EXPLICIT_GRANT_ONLY); `intake.interview` /
  `intake.synthesize` metering. IPC `intake:getState/runTurn/skipSection/acknowledgeAdult/synthesize/
revealRestricted` (gated + active-person-scoped; restricted facts redacted from the owner's normal Memory
  reads, revealed only via the audited break-glass). Renderer onboarding flow + nudge + auto-route.
  Code-reviewer **fix-first** (one blocker resolved): a Memory edit→save dropped the `restricted`/`shareableWith`
  flags off facts (the renderer patch carries only `{id,text,shareable}`) — `updateInsight` now **merges by id**
  to carry them forward, and `summarizeForContext`/`buildLinkedPeopleContext` now **exclude restricted facts
  from every other person's context** regardless of `shareable` (defense in depth, §8.4). Gate green: typecheck
  (node + web/DOM-lib), lint, format, **362 core + 442 desktop + 8 relay** unit, **63 E2E**; visual QA at
  desktop + 390px (0 overflow, no console errors).
- 2026-06-15 — **Onboarding made a hard requirement for Members** (user feedback: the dismissible
  auto-route felt buggy; "a person MUST go through it first"). Replaced the auto-route-once + nudge with a
  **full-screen gate** in `AppShell`: a Member (`intake.own`, not the Owner) is taken over by
  onboarding on every login until `status === 'complete'` (the portrait is generated). The header stays
  (switch person / lock) + crisis resources are always present (not a dead-end); `AppHeader` gained a
  `hideNav` prop to drop the hamburger during the takeover. The **Owner is exempt** (the
  Owner sets up AI, which the intake requires) and gets the existing nudge. On completion the gate releases
  and the finish navigates to `/onboarding` so the just-written portrait stays on screen (now with the
  sidebar). §3.1 / §12 first-run-entry updated. Gate green: typecheck, lint, format, **442 desktop** unit,
  **64 E2E** (+1: a Member is hard-gated [no app nav] → finishes → the gate releases).
- 2026-06-14 — **super-admin removed; restricted-fact reveal de-ceremonied.** With the concealed super-admin
  and the break-glass audit log gone (see [`04`](04-people-roles.md) §8), `restricted` intake facts are now
  **redacted from `insights:list`** for callers without `intake.readRestricted` and shown **directly** (marked
  "sensitive") to a holder (the **Owner**, full-access) — no `intake:revealRestricted` op, no `RawAccessAuditEntry`,
  no `auditService`. The defense-in-depth exclusion of restricted facts from every other person's context
  (`summarizeForContext`/`buildLinkedPeopleContext`) is unchanged. Synced §3/§5/§6/§8.4/§10/§11.
- 2026-06-15 — **Hybrid form/chat redesign added (§14, Review).** User feedback: the all-chat interview is slow
  for simple facts, the open prompts are too generic (people abandon them), and the single free-text intimacy
  question gets skipped. §14 restructures the intake into **quick forms** (factual/structured, no AI) — each
  with an optional section-level **"Tell me more →"** chat — and **AI chat** reserved for the deep open topics
  (family, story, what weighs on you), with **specific concrete questions everywhere** and an **explicit
  structured intimacy block**.
  Four design decisions resolved ask-first (§14.13): a **short `core` gates first-run** while deep/sensitive
  sections are **`invited` anytime** (completion + trust); **promote** useful answers to real `Person` fields;
  the **Owner can see** intimacy data; **reuse the questionnaire engine** (answer-branching for the sensitive
  block). Plus **§15 — a self-maintaining profile**: a drift-detection system that piggybacks on the existing
  session/dream/questionnaire analysis passes (no extra AI spend) to **notice likely-stale answers and invite
  updates** (confirm-before-apply). Amends §3.1/§3.2/§4.1/§4.2; build in 3 slices (core → renderer → freshness).
- 2026-06-15 — **§14/§15 BUILT (3 slices, on `feat/onboarding-redesign`).** Slice 1 (core): the rewritten
  catalog (~180 questions — quick `core` forms + `invited` deep/sensitive sections incl. the explicit branched
  18+ intimacy block; reuses the questionnaire `Question` shape), `submitSectionForm` (fills mapped
  `Person` fields, no AI), the 5 promoted additive `Person` fields, synthesis weaving in form answers
  (restricted sections → restricted facts via a trusted-catalog lookup), `intake:submitForm` IPC (adult-gate
  enforced in the bridge). Slice 2 (renderer): `IntakeFormPanel` (forms via `@selfos/answering`), the
  core-then-invited Onboarding surface (gated walk → "See my portrait" → "Go deeper" grid), the section-level
  go-deeper chat on every form, the People-editor surfacing of the promoted fields. Slice 3 (§15 freshness): the
  `ProfileUpdateSuggestion` model + `@selfos/core/profile` service + the session-analysis producer (emits
  `profileSuggestions`, no extra spend) + the `profile:*` IPC + the Home "Keep your profile fresh" card; dreams/
  questionnaires producers follow the same pattern (deferred). Gate green: typecheck (node + web/DOM-lib), lint,
  format, **371 core + 447 desktop + 8 relay** unit, **61 E2E** (the 3 onboarding E2E reworked for the form
  flow). Visual QA at desktop + 390px (forms, the explicit intimacy form, the Go deeper grid; 0 overflow, no
  console errors). Not merged (awaiting user review).

---

## 14. 2026-06-15 redesign — specific, hybrid form/chat intake

Layers on §1–§13 (the producer/synthesis/safety model is unchanged). This replaces the "every section is an
AI chat" model (§3.2) with a **hybrid**: most sections are **fast structured forms**, AI chat is **reserved
for the few deep open topics**, and **every** question is **specific and concrete** rather than broad.

### 14.1 Why

- **Speed for facts.** "What are your pronouns / birthday / languages?" should be a tap or a field, not a
  back-and-forth. Today they're asked conversationally (the AI emits a `[[SELFOS:FIELD]]` marker) — slow and
  spendy for zero added insight.
- **Generic prompts get abandoned.** "What matters most to you?" as an open box is daunting; a pick-list of
  values with an optional "anything else" is finished in seconds and yields cleaner data.
- **The intimacy block gets skipped.** One blank "tell me what intimacy means to you" box is awkward and
  exposing. Concrete, opt-in multiple-choice (orientation, turn-ons, kinks, …) with optional notes is easier to
  engage and produces **far richer** personalization — the whole point of the intake.
- **More specific data ⇒ better coaching.** The guiding principle for the rewrite (the user's words): **the
  more concrete the questions, the more personalized SelfOS can be.** Broad questions are out, everywhere.

### 14.2 Required core vs. invited deep (the gate)

The biggest risk isn't tone, it's **completion**: a long, heavy intake behind a hard Member gate makes people
skip-spam to escape, yielding a hollow profile. So sections carry a **`tier`**:

- **`core` (gates first-run).** A **short, fast, non-threatening** set of mostly-form sections — enough for a
  useful starter portrait. The Member gate (§3.1) releases once the **core** sections are worked through
  **and the starter portrait is generated**. Proposed core (tunable): **The basics**, **Your life now**,
  **Values & identity**, **What you want**.
- **`invited` (anytime, never gates).** Everything richer or more sensitive — surfaced **after** the gate
  releases, as cards on the Onboarding surface + a gentle Home nudge, each addable when the person is ready and
  **re-synthesizing** the portrait when added. Ordered easy→sensitive: **Health & wellbeing**, **Relationships**,
  **Family & upbringing**, **Your story**, **What weighs on you**, **Intimacy & sexuality**.

This protects **completion** (the gate is a few quick forms) and **trust** (trauma + intimacy are never sprung
on a first-run stranger — they're an invitation, on the person's terms). The portrait is a **living document**:
a starter portrait from core, enriched each time an invited section is added.

### 14.3 Section modes

Every section is a **`form`** — **structured questions** (single/multi-select, scale, short/long text, date),
rendered as a quick form. **No AI call** → instant and free. Answer (or skip) → **Continue**. Every section
also offers an optional **section-level "Tell me more →"** (§14.7): a brief AI chat to elaborate on anything
in that section in the person's own words — purely optional, the form is complete without it.

The deep open topics (**Family & upbringing**, **Your story**, **What weighs on you**) are forms with gentle
structured prompts **and** keep a `focus` so their go-deeper chat stays well-guided (and trauma-informed where
restricted). They used to be pure AI-chat sections; they're now form + go-deeper so every section is uniform.

A form section spends **nothing** to fill out and works offline; only the optional go-deeper chat and synthesis
call Claude. **Net effect: the gated first-run is mostly free + fast.** (The `mode` field still admits a
`chat` value for future use, but no section in the catalog uses it.)

### 14.4 The restructured catalog (specific questions)

Code-defined (`intakeCatalog.ts`). Indicative set (wording tuned at build). "→field" promotes the answer to a
real owner-only `Person` field (§14.6); unmapped answers feed synthesis; `restricted` answers feed only the
person's own context. **Every `form` section offers an optional section-level "Tell me more →" go-deeper**
(§14.7) — there is no per-question deepen flag.

| Section                                      | Tier    | Mode | Specific questions                                                                                                                                                         |
| -------------------------------------------- | ------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The basics**                               | core    | form | pronouns→`pronouns`, gender→`gender`, birthday(date)→`birthday`, location→`location`, languages(multi)→`languages`, ethnicity→`ethnicity`, occupation→`occupation`.        |
| **Your life now**                            | core    | form | living situation→`livingSituation`, relationship status→`relationshipStatus`, children→`parentalStatus`, "what fills your days"(text).                                     |
| **Values & identity**                        | core    | form | core values(multi)→`values`, faith(single+other)→`faith`, communication style→`communicationStyle`, identity descriptors(multi, optional).                                 |
| **What you want**                            | core    | form | growth areas(multi)→`goals`, "a specific goal"(text).                                                                                                                      |
| **Health & wellbeing** _(private)_           | invited | form | sleep/energy/stress(scales), movement(single), "anything to keep in mind"(text)→`healthNotes`(private).                                                                    |
| **Relationships**                            | invited | form | attachment pattern(single), conflict style(single), what you need(multi), "how you show up when it's hard"(text); infers `communicationStyle`.                             |
| **Family & upbringing**                      | invited | form | who raised you, siblings, closeness with each parent(scale), affection/conflict style, faith/culture, family history, family now, "gifts and wounds"(text) + go-deeper.    |
| **Your story**                               | invited | form | chapters, a turning point, something you're proud of, a hard time you came through, biggest life lesson, who you're becoming (text) + go-deeper.                           |
| **What weighs on you** _(restricted)_        | invited | form | gentle, all skippable: what's weighing on you(multi), how heavy(scale), inner critic(single), a recurring worry / stuck pattern / grief(text) + trauma-informed go-deeper. |
| **Intimacy & sexuality** _(18+, restricted)_ | invited | form | see §14.5.                                                                                                                                                                 |

### 14.4a Full per-section question bank (non-intimacy)

The comprehensive set to build (terse; `single`/`multi`/`scale`/`yesNo`/`date`/`text`; "→field" promotes to a
`Person` field). Each is **optional/skippable**; `core` sections stay quick (the gate), `invited` go deep.
Wording tuned at build.

**The basics** _(core, form)_ — preferred name / nickname (text) · pronouns(single+other)→`pronouns` ·
gender identity(single+other)→`gender` · birthday(date)→`birthday` · where you live(text)→`location` ·
where you grew up(text) · languages you speak(multi)→`languages` · cultural / ethnic background(text)→`ethnicity` ·
what you do for work(text)→`occupation` · education level(single) · morning person or night owl(single).

**Your life now** _(core, form)_ — living situation(single)→`livingSituation` ·
relationship status(single)→`relationshipStatus` · children / parental status(single)→`parentalStatus` ·
pets(multi) · what a typical weekday looks like(text) · how you spend your free time / hobbies
(multi)→`interests` · how satisfied with work(scale) · financial situation / money stress(scale) ·
how socially connected you feel(scale) · biggest current stressor(multi: work/money/relationship/health/family/
purpose/loneliness/other) · biggest current source of joy(text) · a recent big life change(text) ·
what a perfect day looks like for you(text) · overall mood lately(scale).

**Values & identity** _(core, form)_ — core values(multi)→`values` · what gives your life meaning(text) ·
faith / spirituality(single+other)→`faith` · how important faith is to you(scale) · spiritual practices(multi,
optional) · personality(multi: introvert↔extrovert, planner↔spontaneous, thinker↔feeler, optimist↔realist,
…) · risk tolerance(scale) · how you'd describe yourself in a few words(text) · how you like to communicate
(single)→`communicationStyle` · what you're most proud of(text) · what you're most insecure about(text) ·
what you'd never compromise on(text) · who you look up to / a role model(text) · what you want to be remembered
for(text) · a belief or principle that guides you(text).

**What you want** _(core, form)_ — growth areas(multi)→`goals` · one specific goal right now(text) · what a good life looks like to you(text) · where you want to be in 5 years(text) · a habit you
want to build(text) · a habit you want to break(text) · what's holding you back(multi/text) · what you keep
avoiding(text) · what would you do with unlimited time & money(text) · your biggest fear about the future(text) ·
how you want SelfOS to support you(multi: accountability / reflection / advice / just listen / challenge me /
track progress) · how you like to be coached(single: gently / directly / challenged / data-driven).

**Health & wellbeing** _(invited, form, private)_ — sleep quality(scale) · usual sleep schedule(single) ·
energy through the day(scale) · stress level(scale) · how you move / exercise(single) · eating patterns(single) ·
caffeine(single) · alcohol(single) · smoking / vaping(single) · recreational substances(single, optional,
private) · in therapy now or in the past(single) · diagnosed physical conditions(text, optional, private) ·
mental-health diagnoses(text, optional, private) · neurodivergence — ADHD / autism / etc.(multi, optional,
private) · medications that affect mood or energy(text, optional, private) · chronic pain or illness(text,
optional, private) · disability or accessibility needs(text, optional, private) · relationship with food /
any eating-disorder history(text, optional, private) · relationship with your body(scale) · anything else to
keep in mind(text)→`healthNotes`(private).

**Relationships** _(invited, form)_ — attachment style(single: secure / anxious / avoidant / mixed, with
a plain-language helper) · how you handle conflict(single: avoid / accommodate / confront / collaborate) ·
what you need most from others(multi) · how you express love(multi: words / touch / time / gifts / acts) · how
you best receive love(multi) · how easily you trust(scale) · how easily you open up(scale) · how you handle
jealousy(single/text) · your relationship deal-breakers(text) · number of close friends(single) · satisfaction
with your friendships(scale) · who you turn to in a crisis(text) · loneliness(scale) · how you show up as a
partner / friend / parent(text) · a recurring pattern you notice in your relationships(text) ·
your biggest relationship challenge(text).

**Family & upbringing** _(invited, form + go-deeper)_ — who raised you(single+other) · siblings / birth
order(single+other) · family faith / culture growing up(text) · closeness with your mother figure(scale) ·
closeness with your father figure(scale) · how affection was shown(single) · how conflict was handled(single) ·
any family mental-health or addiction history(yesNo) · your relationship with family now(single) · the gifts and
wounds you took from your upbringing(text). Then the **"Tell me more →"** go-deeper for what your upbringing was
really like, secrets, inherited patterns, chosen family, and (if a parent) what you do the same or differently —
crisis footer present.

**Your story** _(invited, form + go-deeper)_ — your life in a few chapters(text) · a turning point(text) ·
something you're proud of(text) · a hard time you came through(text) · the biggest lesson life has taught
you(text) · who you're becoming(text). Then the go-deeper for lowest moments, regrets, defining relationships,
what you've survived, and how you've changed.

**What weighs on you** _(invited, form + go-deeper, restricted — trauma-informed)_ — all gentle and skippable:
what's weighing on you most right now(multi+other: work / money / a relationship / family / health / loneliness
/ grief / the future / the past / my own thoughts / nothing much) · how heavy it's felt lately(scale) · how you
talk to yourself when things go wrong(single) · a worry that keeps coming back(text) · a pattern you feel stuck
in(text) · any grief or loss you're carrying(text). Then the trauma-informed go-deeper (lets the person set the
depth, never digs for specifics) — with crisis routing always present (§8.2).

### 14.5 The intimacy & sexuality block (explicit, structured, branched, opt-in)

Replaces the single free-text box with a **comprehensive, concrete, explicit, branched** set of structured
intake questions — direct and graphic where the person wants depth, handled as the most sensitive data (18+ ack,
`restricted`, owner-visible / everyone-else-redacted, excluded from the dream-image depiction, §14.10). It is
**`invited`** (never first-run-gated) and **opt-in** behind the shared 18+ acknowledgement; **every question is
optional and skippable**. **Smart branching** keeps it relevant and gender/orientation/anatomy-aware (the
anatomy, oral, and "where do you like your partner to cum" questions appear only by who you're drawn to and what
fits; the partner group appears only if you have a partner). The free-text prompts invite as much graphic detail
as the person wants to give.

**Scope boundary (the only one):** questions cover the person's own **consensual adult** sexuality — including
explicit acts, kinks, and **taboo _fantasies_** (CNC / "ravishment" roleplay, etc., framed as fantasy/roleplay
with real limits captured in group H). It does **not** present minors, real non-consent, or other illegal acts
as activities to pursue. Within that line it is fully explicit and unfiltered.

The full inventory (grouped; `single`=singleChoice, `multi`=multiChoice, `scale`=rating, `text`=longText). All
optional/skippable:

**A. Orientation & identity** — sexual orientation (multi → `sexualOrientation` field, private) · romantic
orientation if different (single) · who you're drawn to (multi: men / women / non-binary people / everyone) ·
relationship style (single → `relationshipStyle` field, private) · currently exclusive/monogamous (yesNo) ·
how big a part of life intimacy is (scale) · sex drive / libido (single: very low → very high) · describe your
sexuality in a word or phrase (text).

**B. Your sexual story** _(reflective, all optional)_ — age you first masturbated (single ranges +
"prefer not to say") · age of your first orgasm (single) · age of your first partnered experience (ranges +
"haven't yet") · age of first intercourse (single) · number of sexual partners so far (ranges) · how you first
discovered masturbation (text) · your first sexual experience, in your words (text) · your best / most memorable
experience (text) · your most awkward or embarrassing moment (text) · anything you regret (text) · how your
sexuality has changed over time (text) · messages about sex you absorbed growing up (text) · any sexual shame or
hang-ups you carry (text). _(An adult reflecting on their own history — standard in sex-therapy intake; never
solicits graphic detail the person doesn't volunteer.)_

**C. Your current partner & sex life** _(branch on "Do you have a sexual partner right now?" yesNo)_ —
satisfaction with your sex life (scale) · how often you're intimate now (single) · how often you'd like to be
(single) · who usually initiates (single) · how often you orgasm together (single) · how easily you can talk
about sex with them (scale) · have you shared your fantasies with them (yesNo) · something you want but haven't
asked for (text) · what's working well (text) · what you wish were different (text) · what you find most
attractive about them (text).

**D. Arousal & what you like** — turn-ons (multi + note) · turn-offs (multi + note) · what gets you in the mood
(multi: touch, words, anticipation, visuals, scent, romance, …) · where you most like to be touched (multi body
areas) · favorite positions (multi: missionary / doggy / on top / spooning / standing / oral giving / oral
receiving / 69 / other + note) · preferred pace & intensity (single: slow & sensual ↔ rough & intense) ·
dominant or submissive (single: dominant / submissive / switch / vanilla) · **into it** (multi, explicit
consensual-adult checklist: oral (giving), oral (receiving), deepthroat, anal (giving), anal (receiving),
rimming (giving), rimming (receiving), fingering, butt plugs / anal toys, vibrators / dildos, bondage,
blindfolds, spanking (giving), spanking (receiving), choking (giving), choking (receiving), hair-pulling,
biting, BDSM / dom-sub play, role-play, dirty talk, sexting, face-sitting, squirting, threesomes (MFM/FFM),
group sex / orgies, swinging, public / semi-public sex, exhibitionism, voyeurism, …) · **curious to try**
(multi, same list) · **hard limits / not for you** (multi, same list + note) · how you feel about dirty talk
(single) · toys you own or want (multi: vibrator, dildo, butt plug, cock ring, restraints, …) · quickies vs.
long sessions (single) · kinks or fetishes in your own words (text).

**D2. Acts & specifics** _(direct, explicit; each branched so it's only asked when it fits the person's
anatomy/orientation/configuration, via yes/no anatomy + activity gates)_ — _(if they give oral on a penis)_
when you give a blowjob, do you swallow or spit? (single: swallow / spit / either / depends) · does swallowing
turn you on? (yesNo/scale) · _(if a partner ejaculates)_ where do you like your partner to cum? (multi: in my
mouth, on my face, on my chest/body, on my ass, in my pussy, in my ass, wherever they want, I don't have a
preference) · do you like having your ass fingered or played with during sex? (single: love it / sometimes /
not for me / curious) · how do you feel about anal? (single: give / receive / both / not for me / curious) ·
do you like being choked or choking a partner? (single: being choked / doing the choking / both / neither /
curious) · how rough do you like it? (scale: gentle ↔ very rough) · do you like to be degraded or praised?
(single: degradation / praise / both / neither) · loud or quiet (single) · lights on or off (single) · do you
squirt / are you into squirting? (single, branched) · describe your ideal sexual encounter start to finish, in
as much detail as you like (text).

**E. Body & physical preferences** _(branched on attraction via yes/no gates)_ — _(if drawn to partners with a
penis)_ size you prefer (single: no preference → very large) · _(if drawn to partners with a vulva/breasts)_
breast preference (single) · body type you're drawn to (multi) · pubic hair you prefer on a partner (single:
shaved / trimmed / natural / no preference) · how you keep your own grooming (single, optional) · how confident
you feel in your own body (scale) · your erogenous zones (multi) · anything about your body you love or feel
self-conscious about sexually (text).

**F. Fantasies & media** — your wildest fantasy, in as much detail as you like (text) · fantasies you want to
actually try (text) · common fantasies that appeal (multi: threesome / group, voyeurism, exhibitionism,
domination, submission, **CNC / "ravishment" roleplay**, bondage, being watched, watching, strangers / one-night
roleplay, age-gap roleplay, boss/employee, teacher/student roleplay, cheating roleplay, gangbang, …) · a fantasy
you'd love but would never actually do (text) · **do you have any consensual-non-consent (CNC) / "rape-fantasy"
roleplay interest?** (single: yes / curious / no — _framed as consensual roleplay, with a one-line note that it's
fantasy/roleplay and real limits are set in §H_) · do you watch porn (single: never → daily) · _(branch: not
"never")_ what kind / genres you like (multi + note) · how porn fits into your life (text) · do you read or
listen to erotica (single) · do you sext / share nudes (single) · **are you into recording yourselves having
sex or you masturbating?** (single: love it / sometimes / curious / not for me) · **would you ever
broadcast / livestream (cam) yourself?** (single: do it already / want to / curious / no) · do you like watching
yourself in a mirror or on camera (single) · any recurring sexual dreams (text).

**G. Sexual wellbeing** _(sensitive, optional, private)_ — any difficulties you'd want support with (multi:
arousal, reaching orgasm, pain, erectile, dryness, mismatched desire, none — optional) · performance anxiety
(scale) · how your mood affects your libido (text) · how sex affects your overall wellbeing (text).

**H. Boundaries, consent & meaning** — consent / safety / boundaries SelfOS should always hold (text) · a
safeword or signal you use (text) · what makes you feel safe and present during sex (text) · what great intimacy
or closeness means to you (text) · what you most want SelfOS to understand about your sexuality (text).

Everything except orientation (`sexualOrientation`) and relationship style (`relationshipStyle`, both
private-by-default fields) becomes a **`restricted` Insight fact** feeding **only the person's own**
`buildContext` — never another person's context, never an image prompt; the coach surfaces these **only in
clearly relevant contexts** (§14.11). Stored **encrypted** + **18+-gated**; the not-medical line + crisis
footer remain. _(The exact wording + option lists are tuned at build; this inventory is the review target.)_

### 14.6 Form engine reuse, field promotion & new `Person` fields

- **Reuse the questionnaire engine.** Form sections define their questions as the existing **`Question`** shape
  and render through the shared **`@selfos/answering` `QuestionnaireForm`** — so we inherit multi-select / scale
  / date / **answer-branching** / validation / the crisis footer with little new code. A small **code-side
  mapping** (`questionId → { field?, list?, private?, restricted? }`) layers the intake semantics on top; the
  questionnaire vault/Assignment machinery is **not** used (intake answers live in the intake, §14.9).
- **Promote the useful answers to real `Person` fields** (decision: more usable than prose). New
  **additive-optional** fields on `PersonSchema`/`PersonInputSchema` (no `schemaVersion` bump — the
  `email`/`phone` precedent): `relationshipStatus`, `parentalStatus`, `livingSituation` (shareable like other
  profile facts) + `sexualOrientation`, `relationshipStyle` (**private-by-default** → added to `privateFields`
  when filled). They flow through `buildContext` (the shareable set feeds related people; the private two feed
  only own context), the People editor (owner view/edit + per-field share toggles, `15`), and stay **out of**
  `buildDepictionNote` (never an image input). The **granular sexual data** (turn-ons/kinks/positions/fantasies/
  porn/masturbation) is **not** a profile field — it stays a `restricted` Insight fact (too granular + too
  sensitive for the profile schema).
- **Field fill on submit.** `submitSectionForm` validates the answers against the catalog, **fills mapped
  `Person` fields directly** (no AI marker — markers were only for chat; multi → list fields; `private` →
  `privateFields`), persists unmapped answers, and marks the section complete.

### 14.7 Go-deeper (every form section)

Every **form** section shows a **"Tell me more →"** affordance below its questions → a short AI chat **scoped
to that section** (the `chat` machinery + `05` `Composer`/stream). **Optional** (the form is complete without
it) — the person can elaborate on anything in their own words wherever they like, not only on pre-chosen
questions. Meters `intake.interview` per turn.

### 14.8 Synthesis — a living portrait

- **Starter portrait** — when the **core** sections are done, the person taps to generate the portrait
  (`intake.synthesize`), which **releases the Member gate** (§3.1). Built from core's structured `answers` +
  any go-deeper transcripts.
- **Enrichment** — each time an **invited** section is later added, it offers to **re-synthesize** (reusing the
  same `insightId`, carrying shareable choices forward, §3.6) so the portrait grows over time. Per-section
  reflections (auto, light) are unchanged. Sexual/trauma facts stay `restricted`.

### 14.9 Schema & service changes (additive)

- **New `Person` fields** (§14.6): `relationshipStatus` / `parentalStatus` / `livingSituation` /
  `sexualOrientation` / `relationshipStyle` — all optional, **no `schemaVersion` bump**; added to
  `PERSON_FIELD_KEYS`; the latter two default into `privateFields` when filled from intake.
- **`IntakeSectionMeta`** gains `tier: 'core' | 'invited'`, `mode: 'form' | 'chat'`, and for form sections a
  `questions: Question[]` (+ the per-question intake mapping) — renderer-facing, derived from the code catalog.
- **`IntakeSession`/`IntakeSection`** — `answers` already exists (additive use). The gate-release predicate
  becomes "**core** sections resolved **and** portrait generated" (was: all sections); pre-redesign sessions
  still parse (a tier-less section is treated as `invited`, so an in-flight one isn't suddenly re-gated — TBD
  reconcile at build, the `reconcileRole` precedent).
- **`intakeService`** gains `submitSectionForm(sectionId, answers)`; `runTurn` now serves `chat` sections +
  go-deeper; `skipSection`/`synthesize` unchanged. **IPC** adds `intake:submitForm`.

### 14.10 Safety (explicit content)

- **18+ gate** (shared `adultAcknowledged`, §12), **`restricted`** + **owner-visible / everyone-else-redacted**,
  **excluded from `buildDepictionNote`** — unchanged from §8.4; the structured sexual answers ride the **same**
  rails as the old free-text one.
- **Not medical / crisis** — the not-medical line + `CrisisFooter` stay on every onboarding surface; the
  `weighs`/intimacy `chat`/deepen turns keep the trauma-informed + crisis-routing guidance (§8.1/§8.2).
- **Consent & skippability** — every question optional + skippable; the intimacy block opt-in; no dark patterns.

### 14.11 How the data is used, living profile & versioning

- **Relevance-gated surfacing.** The coach references intimacy/trauma facts **only in clearly relevant
  contexts** (an intimacy or relationship session, not a budgeting chat) — a prompt-level instruction, never
  unprompted. Restricted facts are own-context-only regardless.
- **Living, editable profile.** Because most answers are structured, the Onboarding surface doubles as an
  **editable profile** the person can revisit and update anytime (re-synthesize to refresh the portrait) —
  unlike a write-once chat transcript.
- **Versioning by invitation.** When we add new questions/sections later, they appear as gentle **"want to add
  this?"** invitations (a new card / nudge), **never a forced redo** of a completed intake.

### 14.12 Testing

- **Unit (core):** form questions validate; `submitSectionForm` fills mapped `Person` fields (incl. the new
  ones; `private` → `privateFields`), persists unmapped answers, runs **no AI** for a pure form; intimacy detail
  → `restricted` facts; orientation/style → private fields; branch hides irrelevant Qs; the gate predicate keys
  on **core** only; `buildContext` carries the new shareable fields but not the private/restricted ones to
  others.
- **Component (RTL):** a core form renders its controls + Continue/Skip; every form section shows the optional
  "Tell me more" go-deeper; the invited intimacy block is 18+-gated → branched structured controls; the
  Onboarding surface shows core-then-invited; a `chat` section is unchanged.
- **E2E:** finish the **core** forms (no AI) → fields decrypt onto the `Person` → starter portrait → **gate
  releases**; later add the invited intimacy block (18+) → a `restricted` fact is owner-visible but redacted for
  a member, orientation lands as a private field, re-synthesis enriches the portrait. 390px guard.

### 14.13 Resolved decisions (2026-06-15)

- **First-run scope** — a **short `core` gates**; deep/sensitive sections are **`invited` anytime** (protects
  completion + trust). Core = basics / life-now / values / what-you-want (tunable).
- **Data model** — **promote** the useful structured answers to real `Person` fields (relationship status,
  parental status, living situation, orientation, relationship style); granular sexual data stays `restricted`
  facts.
- **Intimacy visibility** — the **Owner can see it** (consistent with the full-access model, `04` §8); redacted
  for everyone else.
- **Form engine** — **reuse** the questionnaire `Question` schema + `@selfos/answering` renderer (gets
  answer-branching for the sensitive block) rather than bespoke forms.
- **Design notes adopted** — coach surfaces sensitive facts only in relevant contexts; the intake doubles as a
  living editable profile; new questions arrive as invitations, never a forced redo.

---

## 15. Keeping the profile fresh — drift detection & update invitations

> **Built 2026-06-15 (sessions producer):** the model (`ProfileUpdateSuggestion`), the
> `@selfos/core/profile` service (record/list/accept/dismiss with dedup + no-re-nag), the **session-analysis**
> producer wiring (it emits `profileSuggestions` on the pass that already runs — no extra AI spend), the
> `profile:suggestions`/`acceptSuggestion`/`dismissSuggestion` IPC (own-scoped, gated `intake.own`), and the
> Home **"Keep your profile fresh"** card. The **dreams + questionnaires producers** follow the same pattern
> (deferred, §15.8).

A profile is only useful if it stays **current**. As the person does sessions, dreams, and questionnaires,
life changes — a new job, a breakup, a goal that shifts, a mood trend — and the intake answers silently go
stale. §15 adds a **smart, low-cost system that notices likely-stale answers from ongoing activity and invites
the person to update them** (never silently rewriting). This makes §14.11's "living profile" **self-maintaining**.

### 15.1 Mechanism — piggyback on the analysis already running (no extra spend)

Every producer already runs a **metered AI analysis pass with the person's profile in context**: sessions
(`09 endAndSummarize`), dreams (`13` analysis), questionnaires (`08 analyzeAssignment`), and the intake's own
synthesis. We **extend that same pass's output contract** to optionally emit **profile-update suggestions**
when the conversation contains a fact that **contradicts or extends a known profile/intake answer** — the
model already has both the transcript and the current profile, so it just reports the delta. **No new AI call,
no new metering** — the suggestion rides the pass that already happened (the `09` "one marker, free signal"
precedent, like `wrapUpSuggested`). A pass that finds nothing emits nothing.

The suggestion is a **proposal, never an edit**: the field/answer changes only when the person confirms.

### 15.2 The suggestion model

A new per-person **`ProfileUpdateSuggestion`** (stored under the person, encrypted): `{ id, kind: 'field' |
'intakeSection', field?: PersonFieldKey, sectionId?, observed: string (what the activity implies),
current?: string (the known value), rationale: string, sourceInsightId, sourceKind: 'session'|'dream'|
'questionnaire', restricted: boolean, status: 'pending'|'accepted'|'dismissed', createdAt }`.

- **Dedup** — a new suggestion for the same `field`/`sectionId` supersedes a prior `pending` one (don't stack
  three "update occupation" cards); a `dismissed` signal for the same observed delta doesn't immediately
  re-fire (no nagging).
- **Restricted** — a suggestion derived from a `restricted` fact (intimacy/trauma) is itself `restricted`
  (own-context-only; owner-visible per `04` §8) and never surfaces in another person's view.

### 15.3 Surfacing & review

- **A gentle nudge** — a Home card ("**Keep your profile fresh** — N things may be out of date") + a count on
  the Onboarding nav, shown only when ≥1 `pending`. Calm, never a blocking interrupt.
- **Review** — each pending suggestion shows _what changed_ + _the current value_ with one-tap **Update**
  (applies to the `Person` field, or opens the intake question prefilled with the observed value to confirm/edit)
  or **Dismiss** (sticks — won't re-nag for the same delta). Accepting a field update re-uses the §14.6 fill
  path; accepting an intake-section update re-opens that section's form/question.
- **Living-profile home** — the Onboarding surface (the editable profile, §14.11) shows pending suggestions
  inline beside the relevant section, so "review" and "edit" are the same place.

### 15.4 A periodic checkup (light)

Beyond event-driven detection, a gentle time-based **"profile checkup"** nudge (e.g. it's been a while since
you reviewed your profile) invites a glance — derived from the intake's `updatedAt`, **no AI**. Dismissable;
never nags.

### 15.5 Privacy & safety

- **Own-scoped** — suggestions derive from the person's **own** activity about themselves; they live in the
  person's own context, and `restricted`-derived ones inherit `restricted` (owner-visible, everyone-else
  redacted). The cross-person leak rules (§8.4) are unchanged.
- **Confirm-before-apply** — the system **never** silently changes a profile field or intake answer; it only
  proposes. Dismiss is durable (no nagging). Not-medical/crisis framing unchanged.

### 15.6 Schema, service & IPC

- **Schema** — add `ProfileUpdateSuggestionSchema` (per-person, encrypted at
  `people/<id>/profile-suggestions/<id>.enc`). The producers' analysis **result types gain an optional
  `profileSuggestions?: RawProfileSuggestion[]`** (additive); the analysis prompt contract gains the
  "report deltas vs. the known profile" instruction.
- **Service** — a small **`profileSuggestionService`** (`list`/`accept`/`dismiss`/`recordFromAnalysis`),
  consumed by each producer's analysis path (which already runs in the subject's own process). Accept routes to
  the §14.6 field-fill or re-opens the intake section.
- **IPC** — `profile:suggestions` (list, own-scoped + gated `intake.own`) / `profile:acceptSuggestion` /
  `profile:dismissSuggestion`.

### 15.7 Testing

- **Unit (core):** an analysis pass that observes a changed fact emits a `profileSuggestion`; one that doesn't,
  emits none; **no extra metering event** is recorded for the suggestion; accept applies to the field /
  re-opens the section; dismiss is durable + dedups; a `restricted`-derived suggestion is `restricted` and
  own-scoped.
- **Component (RTL):** the Home "keep fresh" card shows the count; review accepts/dismisses; a `restricted`
  suggestion shows for the owner, not a member.
- **E2E:** do a session that implies a new occupation → a pending suggestion appears → **Update** writes the
  `Person` field (decrypt to assert) → dismiss a second one and confirm it doesn't re-nag. 390px guard.

### 15.8 Resolved / defaults

- **Detection rides the existing analysis passes** (no new AI spend) — the chosen mechanism over a dedicated
  periodic scan.
- **Always confirm** — suggestions never auto-apply; dismiss is durable.
- **Surfacing** — a calm Home card + Onboarding nudge + inline on the living-profile surface.
- **Scope note** — wiring every producer (`08`/`09`/`13`) to emit suggestions is its own **slice 3** (after the
  core + renderer slices); the model + one producer (sessions) land first, the rest follow the same pattern.
