# 18 — Personal onboarding ("Getting to know you")

> **Status:** Review · _last updated 2026-06-14_
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
(the shared Insight/metrics layer + the **break-glass/audit** model it reuses), [`15`](15-shareability.md)
(per-item shareability — sensitive data defaults locked), [`16`](16-guided-sessions.md) (the
guided/structured-interview machinery), and [`04`](04-people-roles.md) (people, capabilities, the
owner/super-admin model, `buildContext`). References [`00`](00-architecture.md) and [`01`](01-design-system.md).

---

## 1. Overview

Today a person's profile is built by hand (owner-only) and enriched indirectly via sessions, dreams, and
questionnaires. This adds a **front-door onboarding**: the person themselves answers a comprehensive,
adaptive interview about who they are. Two things come out of it:

1. **The (owner/AI-facing) profile auto-fills** — direct questions map straight to `Person` fields
   ([`04`](04-people-roles.md)/[`15`](15-shareability.md)); the member never sees those raw fields (profile
   management stays `people.manage` = owner/super-admin only), so the fill is **automatic, no member review**.
2. **A comprehensive portrait** — on synthesis, AI distils the interview into an **Insight (`source:
'intake'`)** that feeds the person's **own** coaching context everywhere, plus a member-facing "here's what
   I've come to understand about you" summary.

**Who & when.** Every person does their **own** intake about **themselves** (capability `intake.own`, Member
default ON). It is the **intended first-run experience** — strongly guided and nudged — but **resumable**
across sittings and **never a hard lock** (§3.1). It's **AI-driven** (a live, adaptive interview), so it
**requires AI to be configured + online + in budget** to run (§7).

**Held with care.** This is the most sensitive data in the app. The interview is warm and trauma-informed;
heavy and intimate sections are clearly flagged, fully skippable, and gated (§8). The most sensitive
categories (trauma, sexuality) **default to the person's own context only** and are **not shown in the
owner's normal views** — reachable only via an **audited break-glass** (§8.4).

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
- **A member-facing view of the raw profile fields** — those stay owner/super-admin only.
- **Clinical assessment, diagnosis, or treatment** — explicitly not this (§8); it's reflective self-knowledge.
- **An AI-free intake** — the interview is AI-driven by design; when AI is unavailable it can't run (§7).
- **Voice** — deferred, but nothing here precludes it.

## 3. UX & flows

### 3.1 Entry, "required", and resume

- A new person is taken straight into onboarding and **strongly guided** to do it, with a **persistent nudge**
  (a Home banner/card + a nav affordance) until it's complete. They are **not hard-locked** out of the app —
  they can use it, but the nudge stays. ("Required" = the intended, prominent first path, not a wall.)
- Because the intake is **AI-driven**, the first thing it checks is **AI availability** (key configured +
  online + budget). If AI isn't ready, onboarding shows a clear **"connect AI to begin"** state: the **owner**
  is routed to Settings → AI; a **member** (who can't configure AI) is told their household owner needs to
  enable AI first. The nudge persists; nothing is lost.
- **Save & resume** is first-class: progress is saved continuously (per answer + per section); the person can
  leave anytime and return to exactly where they were, across days. A progress indicator shows sections done /
  remaining and an estimate.

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

As the person answers, **direct questions write straight to the `Person` profile** (owner/super-admin-only).
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
  - a new **`restricted?: boolean`** marking break-glass-only facts (§8.4).
- **Profile fills** write to the existing `Person` (no new file). Sensitive direct fields (e.g. health) are
  auto-added to `Person.privateFields` (own-context-only) per §8.3.

```ts
// InsightSourceSchema gains 'intake' (the 4th producer) — additive; existing Insights parse unchanged.
InsightSource = 'questionnaire' | 'session' | 'dream' | 'intake';

interface IntakeSection {
  id: string; // e.g. 'family', 'intimacy'
  status: 'notStarted' | 'inProgress' | 'skipped' | 'complete';
  restricted: boolean; // heavy/intimate → break-glass-only in owner views (§8.4)
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
- **Break-glass/audit ([`08`](08-questionnaires.md) reuse)** — a new **EXPLICIT_GRANT_ONLY** capability
  **`intake.readRestricted`** (ships OFF even for the Owner; super-admin break-glass always works) gates
  viewing `restricted` sections/facts in owner surfaces; every reveal writes to the existing **`auditService`**
  log (§8.4).
- **Renderer** — an onboarding **flow surface** (the sectioned interview: streamed Q&A via the [`05`](05-conversations.md)
  `Composer`/stream + the `CrisisFooter`; section progress; skip/deeper controls; the 18+ gate; the closing
  portrait), a persistent **nudge** (Home card + nav), and a per-person **`intakeStore`** (reset on
  `activePerson.id` change). No member-facing profile editor (unchanged: owner-only). The owner's
  People/Memory views render `restricted` content only behind the break-glass.
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
- Owner break-glass reuses the [`08`](08-questionnaires.md) `assignments:revealRaw`-style audited path,
  generalized for intake (`intake.readRestricted` / super-admin) → writes the audit entry **before** returning.

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

### 8.4 Owner visibility & audited break-glass (the most sensitive data)

The **restricted** sections (§4.2: "what weighs on you", "intimacy & sexuality") and their derived facts are
**not shown in the owner's normal People/Memory views**. They live only in the encrypted intake + the person's
**own** coaching context. An owner/super-admin can reach them only via an **explicit, audited break-glass**
(the [`08`](08-questionnaires.md) §8.4 model, generalized): the **EXPLICIT_GRANT_ONLY `intake.readRestricted`**
capability (off even for the Owner) **or** the concealed super-admin, each writing a **vault-stored audit
entry before** the content is returned. So the most intimate data is **accessible but accountable**, never
casually browsable. (Consistent with [`04`](04-people-roles.md) §8 / [`10`](10-multi-device-vault.md): the
vault isn't zero-knowledge from the owner; restriction is enforced at the app/UX layer + audit, like all RBAC.)

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
- **Break-glass (core/bridge):** `restricted` facts are **excluded** from the owner's normal Insight/profile
  reads; `intake.readRestricted`/super-admin reveal returns them **and writes the audit entry first**; a normal
  owner without the grant cannot read them.
- **Component (RTL):** the sectioned flow (stream, skip, go-deeper), the AI-unavailable state (owner vs member
  copy), the 18+ gate on the intimacy block, the persistent nudge, the closing portrait, resume.
- **E2E (Playwright, `SELFOS_FAKE_CLAUDE`):** new person → onboarding nudge → run an interview turn → a direct
  answer fills a profile field (decrypt to assert) → skip the intimacy block → synthesize → the portrait
  Insight feeds a later session's `buildContext` (decrypt) → a restricted fact is absent from the owner's
  normal Memory view but reachable via audited break-glass (audit row written); resume mid-intake; 390px +
  control-geometry guards.
- Vault + Claude mocked as established; run `pnpm typecheck` after tests (memory `vitest-does-not-typecheck`).

## 11. Open questions

_All major product decisions resolved across the 2026-06-14 planning rounds (see §12). Remaining are
build-time tunings, not blockers:_

1. **Section wording + the exact direct-field map** — final per-section questions and which map 1:1 to which
   `Person` field (vs. inferred at synthesis). Tuned at build.
2. **Break-glass capability shape** — reuse a generalized `assignments:revealRaw` path vs. a parallel
   `intake:revealRestricted` + the shared `auditService`. Proposed: a shared audited-reveal helper both use.
3. **Closing-portrait depth** — a single end-of-intake portrait vs. a short per-section reflection too.
   Proposed: a per-section reflection + a richer final portrait.
4. **Nudge persistence** — device-local vs. vault for "intake incomplete." Proposed: derive from the
   `IntakeSession.status` (vault), so it's correct across devices.

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
- **Owner visibility of intimate/trauma data** — **audited break-glass only** (not in normal owner views);
  reuses the [`08`](08-questionnaires.md) readRaw/audit model via `intake.readRestricted` / super-admin.
- **Closing portrait** — a **member-facing** warm summary.

## 13. Changelog

- 2026-06-14 — created (Review). Decisions resolved ask-first across four question rounds; build-ready pending
  final approval. The fourth Insight producer; reuses [`05`](05-conversations.md)/[`09`](09-session-analysis.md)
  chat+analysis, [`15`](15-shareability.md) shareability, [`16`](16-guided-sessions.md) interview machinery, and
  [`08`](08-questionnaires.md) break-glass/audit.
