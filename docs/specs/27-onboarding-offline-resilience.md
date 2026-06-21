# 27 — Onboarding offline resilience (let the forms work without AI)

> **Status:** Draft · _last updated 2026-06-21_
>
> Personal onboarding ([`18`](18-personal-onboarding.md)) is a **hard full-screen gate** for Members until
> their AI portrait is generated — but the **whole** onboarding flow is AI-gated: a member with no working
> Claude key hits a "Connect AI to begin" dead-end and is **completely locked out of the app**, including the
> parts that need no AI at all. This spec **decouples the structured FORM sections from AI availability** (they
> already spend nothing — `submitSectionForm` makes no Claude call) so a member can complete them offline, and
> **re-defines gate release** so completing the forms unlocks the app, deferring only the AI chat sections and
> the portrait synthesis behind a calm, non-blocking "available once AI is on" state and a persistent
> "finish your portrait when AI is ready" nudge.

Amends [`18`](18-personal-onboarding.md) **§3.1** (the hard gate + the all-or-nothing "connect AI to begin"
takeover) and **§7** (the "the intake _cannot run_ without AI" framing). The producer / synthesis / safety
model of `18` is otherwise unchanged. Builds on [`00`](00-architecture.md) (vault, IPC, additive-migration
precedent), [`18`](18-personal-onboarding.md) (intake catalog, `intakeService`, the Member gate), and
references [`21`](21-intake-catalog-redesign.md) (the lean catalog this degrades just as gracefully) and the
**shared not-configured component** the AI-credentials work introduces (see §11.2). Out of scope: the AI key
**sharing / inheritance** model (so members usually _have_ a working key) → the household-AI-credentials spec;
settings **enforcement** of who may toggle AI → the settings-enforcement spec (§2 non-goals).

> **Spec-number note (resolve before approval).** The task named this file `23-onboarding-offline-resilience.md`,
> but `23-portrait-synthesis-optimization.md` already exists (a Draft in the **21–24 onboarding-redesign
> group**: 21 catalog redesign · 22 intimacy redesign · 23 portrait/context budget · 24 progressive profile).
> 22 and 24 are **reserved** by that group (referenced, not yet filed). To avoid clobbering an in-flight spec
> this was filed as **25**. Confirm the number (and whether this belongs _in_ the 21–24 group) in §11.

---

## 1. Overview

A person's profile is built front-door by **personal onboarding** ([`18`](18-personal-onboarding.md)): an
AI-guided self-interview that auto-fills the owner-only `Person` profile and synthesizes a **portrait Insight**
(`source: 'intake'`). Since 2026-06-15 it is a **hard full-screen gate** for Members — a Member is taken over
by onboarding on every login until `IntakeSession.status === 'complete'` (defined as "the portrait is
generated"), with no sidebar and no other screens ([`18`](18-personal-onboarding.md) §3.1).

The intake is a **hybrid** of two kinds of section ([`18`](18-personal-onboarding.md) §14):

- **`form` sections** — structured questions (single/multi-select, scale, short/long text, date, roster, …)
  rendered through `@selfos/answering`. Submitting one calls `intakeService.submitSectionForm`, which fills
  mapped `Person` fields and persists the answers **with no Claude call** — instant, free, **offline-capable**.
  (Confirmed in code: `submitSectionForm` makes no `client.stream` call; `intakeSubmitForm` in the bridge reads
  no API key.)
- **AI-dependent surfaces** — the optional per-section **"Tell me more →" go-deeper chat** (`runIntakeTurn`,
  meters `intake.interview`), the light **per-section reflection**, and the **portrait synthesis**
  (`synthesizeIntake` → `synthesizePortrait`, meters `intake.synthesize`). These require a key + budget.

**The bug.** `Onboarding.tsx` short-circuits the **entire** flow when `state.aiAvailable` is false (key
configured **and** AI enabled, computed host-side as `Boolean(apiKey) && aiEnabled`): it renders a
"Connect AI to begin" card and nothing else (`Onboarding.tsx`, the `if (!state.aiAvailable)` branch, ~line
136). Combined with the AppShell hard gate (`intakeGated`, `AppShell.tsx` ~line 142, releases only on
`status === 'complete'`), a member with **no working AI key** can do **nothing** — not even the no-AI forms
that gate release should accept. They're stuck on a dead-end with no path forward (members can't reach AI
Settings, [`18`](18-personal-onboarding.md) §3.1).

The household-AI-credentials work largely removes the **trigger** (members inherit a working key), but
onboarding must still **degrade gracefully** whenever AI is **genuinely** unavailable — first run before the
owner configures AI, offline, key cleared/invalid, over budget, or a transient stream error. This spec makes
that degradation correct: **the forms always work; only the AI-only parts wait for AI; the gate releases on the
forms; the portrait is finished when AI is ready.**

## 2. Goals / Non-goals

**Goals**

- **Forms work offline.** Every `form` section renders, accepts answers, and persists (filling `Person` fields)
  with **no key** — never blocked by `aiAvailable`.
- **No dead-end.** Replace the all-or-nothing "Connect AI to begin" takeover with a flow where forms are always
  available and AI-dependent surfaces (go-deeper, reflection, portrait) show a **calm, non-blocking** "available
  once AI is on" state.
- **A gate a keyless member can clear.** Re-define gate release so completing the **form** sections (the
  required set) releases the Member hard gate even when AI is unavailable, instead of gating forever on a
  portrait that can't be generated.
- **The portrait is still produced** — as soon as AI is available, a persistent, dismissible nudge (and the
  Onboarding surface) prompt the synthesis; once generated it feeds context exactly as in `18`.
- **Accurate, role-aware messaging** — owner vs member, "AI is provided by your household" vs "add a key",
  reusing the shared not-configured component (§11.2).
- **Every `18` safety boundary preserved** — crisis footer + not-medical line always present; restricted
  (intimacy/trauma) sections + their fields stay own-context-only; the 18+ ack unchanged; restricted facts
  never leak.

**Non-goals (out of scope, referenced)**

- **AI key sharing / inheritance** (so members usually have a working key) — the **household-AI-credentials**
  spec. This spec assumes AI may still be absent and degrades for that case.
- **Settings enforcement** of who may enable AI / change the key — the **settings-enforcement** spec.
- **An AI-free portrait.** The portrait is genuinely AI-synthesized; we never fabricate one offline. We only
  defer it, and unlock the app on the forms instead.
- **Reworking the catalog content** — that's [`21`](21-intake-catalog-redesign.md)/22. This spec is about the
  AI-availability behavior of whatever catalog is present.
- **A new schema file or `schemaVersion` bump** — the status change is expressed with additive-optional fields
  (§4), per the project's additive-field precedent.

## 3. UX & flows

The shell, surfaces, and copy below replace [`18`](18-personal-onboarding.md) §3.1's all-or-nothing AI gate.

### 3.1 The form-first walk (works offline)

The gated first-run (and the post-gate "Go deeper" surface) is **unchanged in structure** from `18` §3.1/§14 —
a section navigator, a "next pending core section" walk, the "See my portrait" step — **except**:

- **`form` sections render and submit regardless of `aiAvailable`.** A keyless member walks the core forms,
  answers (or skips) each, and continues. Each submit fills `Person` fields + persists (the existing
  `intake:submitForm` path; no key read). The crisis footer + not-medical line are present on every step.
- The **optional "Tell me more →" go-deeper** on a form section is shown but, when AI is unavailable, renders a
  **calm inline "available once AI is on"** affordance instead of the chat composer (§3.3) — the form is
  complete without it (it always was, `18` §14.7), so this is non-blocking.

### 3.2 Gate release when AI is unavailable (the core change)

**The completion definition splits into two milestones** (§4):

- **`formsComplete`** — every **required** section (the `core` form sections that gate first-run, plus any
  `chat`-mode required section that has been skipped or worked through — see §7 for the chat-required edge) is
  **resolved** (`complete` or `skipped`). This is structural and needs **no AI**.
- **`portraitComplete`** — the portrait Insight has been generated (today's `status === 'complete'`).

**Gate-release rule (replaces `18` §3.1's "complete = portrait generated"):**

| AI availability    | Member hard gate releases when…                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI available**   | `portraitComplete` (unchanged — the forms flow naturally into "See my portrait").                                                                  |
| **AI unavailable** | `formsComplete` — the member finishes the required forms and is let into the app, with a persistent "finish your portrait when AI is ready" nudge. |

So a keyless member is **never gated forever**: they complete the quick forms, the app unlocks, and the
portrait is finished later. When AI is on, behavior is identical to `18` (the member naturally reaches "See my
portrait" and that completes them).

**Proposed default (confirm in §11): a member who reaches `formsComplete` with AI available is still nudged but
NOT forced to generate the portrait to use the app** — i.e. the gate releases on `formsComplete` **or**
`portraitComplete`, and the portrait becomes a strong nudge rather than a hard lock, for everyone. The tradeoff:

- **Release on `formsComplete` for everyone (recommended).** Simpler and consistent; the member is never
  trapped by an AI hiccup mid-flow (e.g. over budget at the "See my portrait" tap). The portrait is a nudge.
  Risk: some members never generate the portrait, so their coaching is form-only until they do.
- **Keep `portraitComplete` as the release when AI is available (status-quo for the keyed path).** Maximizes
  portrait-generation rate, but a transient AI failure at the final step re-traps a member who has answered
  everything — the exact dead-end class this spec exists to remove.

This is the one genuinely product-shaped decision and is listed as an **Open question** (§11.1) — the build
session confirms it; **the spec does not assume an answer.** Everything else in §3 holds under either choice.

### 3.3 The AI-dependent surfaces (calm "available once AI is on", never a dead-end)

Wherever AI is needed and unavailable, the surface shows a **calm, secondary, non-blocking** state — never the
full-screen takeover, never a blocked-button-only screen:

- **Per-section go-deeper** — instead of the chat composer, a small inline panel: a lock/sparkle icon, "Add this
  in your own words once AI is on", and (owner) an "Open Settings" link / (member) the household-provided copy
  (§3.4). The form's Continue/Skip remain fully usable.
- **The portrait step ("See my portrait" / "Refresh my portrait")** — the button is shown but, when AI is
  unavailable, is **disabled with an adjacent explanation** ("Your portrait is written by AI — it'll be ready
  once AI is on. Everything you've shared is saved.") plus the role-aware enable affordance (§3.4). It is **not**
  a takeover; the rest of the Onboarding surface (the section grids, progress) renders normally.
- **The per-section reflection** is best-effort already (`synthesizeSection` records completion without a
  reflection when AI is off — confirmed in code); no UX change needed beyond not surfacing an error.

These states reuse the **shared not-configured component** (§11.2) for the enable affordance so copy stays
consistent with Sessions/Dreams/etc.

### 3.4 Role-aware messaging

Copy is driven by whether the viewer can enable AI (`settings.manage` — today's `canManageAi` in
`Onboarding.tsx`) and by the household-AI-credentials model:

- **Owner / can manage AI** → "Add your Claude API key and turn on AI in Settings." → **Open Settings**.
- **Member, household provides AI** (per the credentials spec) → "AI is provided by your household — it'll be
  ready shortly. Everything you've shared is saved." (No Settings link; nothing to do.)
- **Member, no household AI configured** → "Ask your household owner to turn on AI, then come back — nothing
  you've done is lost."

The exact wording is owned by the shared not-configured component (§11.2); this spec specifies the **three
audiences** and that **nothing is lost** is always present.

### 3.5 The "finish your portrait" nudge (reuse the Home OnboardingCard)

When a member has released the gate on `formsComplete` but the portrait isn't generated, the existing Home
**`OnboardingCard`** ([`18`](18-personal-onboarding.md) §3.1/§15) surfaces a persistent, **dismissible** nudge —
"**Finish your portrait** — you've told SelfOS the essentials; generate your portrait when AI is ready so your
coaching gets richer." Tapping it opens `/onboarding`. The card:

- self-hides once `portraitComplete` (it already self-hides on `complete` + up-to-date);
- when AI is **unavailable**, frames the nudge as "when AI is ready" (not "do it now"), with the role-aware
  affordance from §3.4;
- when AI **becomes** available, the same card prompts generating the portrait directly.

"Dismissible" here means the **card** can be dismissed for the session (it's a nudge, not a gate); the
underlying `pending` state persists in the vault (correct across devices, the `18` §11.4 precedent).

### 3.6 Becoming available later

When AI turns on (owner adds a key, household credential arrives, budget refreshes, the device comes online),
`intake:getState` returns `aiAvailable: true` on the next load and the Onboarding surface + Home card switch
from the calm state to the active "Generate my portrait" affordance with no extra step. No data is migrated —
the forms and answers were already saved.

## 4. Data model (vault files & schemas)

No new vault file, **no `schemaVersion` bump** — all additions are **additive-optional** on the existing
`IntakeSession` (`people/<person-id>/intake/session.enc`), per the `email`/`phone` / `Dream.image` additive
precedent ([`00`](00-architecture.md) §4.4; [`18`](18-personal-onboarding.md) §4.1). Existing intake sessions
parse unchanged.

The completion split is **derived, not a new persisted enum** where possible. Proposed shape:

```ts
// 18 §4.1 IntakeSession is unchanged except for two additive-optional fields:
interface IntakeSession {
  // …existing fields (id, schemaVersion, personId, status, sections, insightId, …)…
  status: 'inProgress' | 'complete'; // UNCHANGED — 'complete' STILL means the portrait was generated.
  formsCompletedAt?: string; // NEW (additive-optional): set when every REQUIRED section first resolves.
  // (No new persisted "portraitDeferred" enum — deferral is a function of formsCompletedAt && status !== 'complete'.)
}
```

- **`status`** keeps its exact `18` meaning (`'complete'` ⇔ portrait generated), so every existing consumer of
  `status === 'complete'` (the AI-available release, the OnboardingCard self-hide, context-feeding) is
  unaffected.
- **`formsCompletedAt?`** is the new structural milestone. It is **set once** (idempotently) the first time the
  required-section predicate becomes true; it is not cleared if the member later reopens a section (the gate,
  once released, stays released — re-trapping a member who's in the app would be a worse bug).
- **Derived predicates** (pure helpers in `@selfos/core/intake`, unit-tested):
  - `requiredSectionsResolved(session, catalog)` — every required section `complete | skipped`.
  - `gateReleased(session, aiAvailable)` — `status === 'complete'` **OR** (`formsCompletedAt != null`
    **and** the §11.1 policy permits form-only release). This is the single source of truth the AppShell gate
    and the OnboardingCard consult (replacing the inline `status !== 'complete'` checks).

**Which sections are "required"** is the existing **gate set** ([`18`](18-personal-onboarding.md) §14.2/§14.8 —
the `core` sections; `invited` sections never gate). This spec does not change which sections are required; it
only changes the **release trigger** from "portrait" to "required forms resolved" when AI is unavailable.

`IntakeState` (the IPC view, §6) already carries `aiAvailable`. It gains an additive-optional
**`formsComplete: boolean`** + **`gateReleased: boolean`** (derived host-side) so the renderer and AppShell
don't re-derive the predicate (and so the trust boundary — "is this member allowed into the app?" — is computed
in the bridge, not the renderer).

All reads/writes go through the vault/crypto service (no direct `fs`) exactly as `intakeService` does today.

## 5. Architecture & modules

A small, surgical change set — no new feature module, no new nav, no new IPC channel.

- **Core (`@selfos/core/intake`)**
  - Add the pure predicates `requiredSectionsResolved` / `gateReleased` (and a tiny `markFormsComplete`
    helper invoked by `submitSectionForm` / `skipIntakeSection` when the predicate first flips, setting
    `formsCompletedAt`). `submitSectionForm` and `skipIntakeSection` are **unchanged otherwise** — they already
    spend no AI; they now additionally stamp `formsCompletedAt` when the required set first resolves.
  - `synthesizeIntake` is **unchanged** (it already returns `NO_KEY`/`BUDGET` envelopes; `synthesizeSection`
    already completes a section without a reflection when AI is off).
- **Bridge (`coreBridge.ts`)** — `buildIntakeState` adds `formsComplete` + `gateReleased` to `IntakeState`
  (derived from the session + `aiAvailable`). The gate decision the AppShell consumes is thus computed at the
  trust boundary. `intakeSubmitForm` / `intakeSkipSection` need no change (they already call the core services
  that now stamp `formsCompletedAt`).
- **Renderer — `AppShell.tsx`** — the `intakeGated` predicate changes from
  `intakeState?.session.status !== 'complete'` to **`!intakeState?.gateReleased`** (using the host-derived
  flag). Everything else about the takeover (header stays, `hideNav`, crisis footer, Switch person) is
  unchanged.
- **Renderer — `Onboarding.tsx`** — remove the **`if (!state.aiAvailable) return <dead-end>`** early return.
  Instead:
  - `form` sections render unconditionally;
  - go-deeper and the portrait button consult `state.aiAvailable` and render the **calm inline state** (§3.3)
    via the shared not-configured component (§11.2) instead of blocking the whole screen.
- **Renderer — `OnboardingCard.tsx` (Home)** — extend its copy/branches for "forms done, portrait deferred,
  AI off" per §3.5 (it already keys on `state.session.status` + `portraitStaleness`; it gains a "forms done,
  portrait pending" branch and the AI-off framing).
- **Shared not-configured component** — reused, not created here (§11.2). If the credentials spec hasn't landed
  it yet, this spec falls back to the existing role-aware copy in `Onboarding.tsx`, factored into a small local
  component so the three surfaces (go-deeper, portrait button, Home card) share one source.

No store shape change beyond the additive `IntakeState` fields; `intakeStore` continues to hold `state`.

## 6. IPC / API contracts

**No new channel.** The existing `intake:*` contract ([`18`](18-personal-onboarding.md) §6) is reused; only the
**`IntakeState`** response shape grows (additive):

- `intake:getState()` → `IntakeState` now additionally carries `formsComplete: boolean` and
  `gateReleased: boolean` (derived host-side from the session + `aiAvailable`). All other fields unchanged.
- `intake:submitForm({ sectionId, answers })` → unchanged signature; the underlying `submitSectionForm` now
  stamps `formsCompletedAt` when the required set first resolves, so the returned `IntakeState` reflects
  `formsComplete: true` / `gateReleased` accordingly. **Still gated by `intake.own` + active-person-scoped + the
  18+ ack for adult sections, all enforced in the bridge** (unchanged trust boundary). **Still reads no API
  key.**
- `intake:skipSection`, `intake:synthesize`, `intake:runTurn`, `intake:acknowledgeAdult` — unchanged. `runTurn`
  and `synthesize` keep their typed `NO_KEY`/`BUDGET`/`ERROR` envelopes; the renderer now surfaces those as the
  calm inline state (§3.3) rather than letting AI-off remove the whole screen.

**Claude API:** unchanged. The key stays in main; forms never touch it; go-deeper/synthesis use it exactly as
`18` does.

## 7. States & edge cases

- **No key / AI disabled (first run, common)** — forms render + submit; go-deeper + portrait show the calm
  state; gate releases on `formsComplete` (§3.2). Owner → Settings; member → household/owner copy (§3.4).
- **Offline (key present, network down)** — `aiAvailable` may read true (key configured + enabled) but a
  `runTurn`/`synthesize` call fails transport → typed `ERROR` envelope → the surface shows "AI couldn't respond,
  try again" inline, **not** a takeover. Forms unaffected. The gate is already released (forms) or releasable.
- **Over budget mid-flow** — `synthesize` returns `BUDGET`; the portrait button shows "AI budget reached for
  this period — your portrait will be ready when it refreshes." Forms + gate-release unaffected (a member who
  hit budget at "See my portrait" is **not** re-trapped — exactly the dead-end this removes).
- **Key cleared / becomes invalid after `status: 'complete'`** — already complete ⇒ gate stays released
  (`status === 'complete'` path); refresh-portrait simply shows the calm state until AI returns. No regression.
- **A required section is a `chat` section (no form).** Today's catalog uses only `form` for the gate set, but
  the schema admits `chat` ([`18`](18-personal-onboarding.md) §14.3). A **required `chat` section** can't be
  completed offline. Resolution: such a section counts toward `requiredSectionsResolved` when **skipped** (the
  member can always skip it, `18` §3.2) — so `formsComplete` is still reachable offline. (If the build chooses
  to make any chat section required-and-unskippable, that re-introduces a dead-end; flagged in §11.3 — the
  recommendation is **no required chat sections**, which the current catalog honors.)
- **AI turns on after a form-only release** — next `getState` flips `aiAvailable`; the OnboardingCard + portrait
  button switch to "generate now"; generating sets `status: 'complete'` as in `18`. The gate stays released
  throughout.
- **Member completes forms, generates portrait, then edits answers** — `portraitStaleness` ([`18`](18-personal-onboarding.md)
  §15) already drives the "X% out of date — refresh" nudge; unchanged. Gate stays released.
- **Pre-existing in-flight session (migration)** — a session written before this spec has no `formsCompletedAt`.
  On the next `submitSectionForm`/`skipIntakeSection` (or a `getState` that recomputes), the predicate is
  evaluated and `formsCompletedAt` is stamped if already satisfied — so a member who'd already answered the
  required forms but was stuck on the AI dead-end is **released on their next interaction**, with no data change.
  A session already `status: 'complete'` is unaffected. Additive fields ⇒ no `schemaVersion` migration.
- **Sync conflict / corrupt intake file** — standard vault behavior ([`00`](00-architecture.md) §7); a corrupt
  file degrades to "start/continue," never silently shares restricted content and never auto-releases the gate
  on garbage (a parse failure leaves `gateReleased` false → the member re-walks, losing nothing on disk).
- **Per-person isolation** — `intakeStore` + the device-local "last opened section" reset on `activePerson.id`
  change (unchanged, `18` §7); `formsCompletedAt` is per-person in the per-person intake file.

## 8. Safety

This surface is wellbeing-adjacent (it collects the most sensitive personal data and includes trauma + intimacy
sections), so the [`18`](18-personal-onboarding.md) §8 safety model is **preserved in full** — and the changes
here **only remove a lockout**, never loosen a boundary:

- **Not medical** — the not-medical line stays on every onboarding surface and in the calm AI-off states.
  Onboarding remains reflective self-knowledge, never assessment/diagnosis/treatment.
- **Crisis routing** — the **`CrisisFooter` ("Get help now") is present on every state**, including the calm
  AI-off go-deeper/portrait states and the form-first walk. Removing the dead-end actually **improves** safety:
  a gated keyless member previously saw a single "connect AI" card; they now keep the crisis resources and a
  working flow. The trauma-informed go-deeper conduct ([`18`](18-personal-onboarding.md) §8.2) is unchanged
  (and is simply unavailable, calmly, when AI is off — never a blank dead-end).
- **Restricted (intimacy/trauma) data** — unchanged. The 18+ ack still gates the intimacy block and is still
  enforced **in the bridge** (`intakeSubmitForm` no-ops an adult section without `adultAcknowledged` — confirmed
  in code). Restricted sections + their derived facts stay **own-context-only**, owner-visible /
  everyone-else-redacted ([`18`](18-personal-onboarding.md) §8.4), and `restricted` facts are
  **never broadcast-shareable** (`shareable: false` at synthesis). Letting forms run offline does **not** change
  what's restricted: the restriction is decided server-side from the trusted catalog at synthesis
  (`sectionRefRestricted`), and synthesis still only runs when AI is available — so an offline form-only release
  produces **no portrait facts at all yet** (nothing to leak), and the portrait, when generated, applies the
  same restriction rules.
- **No new exposure path** — the new `formsCompletedAt` / `gateReleased` are non-content booleans; they carry no
  answer text and cross IPC as plain flags. Restricted answer content never enters the gate computation.

## 9. Accessibility

Per [`01`](01-design-system.md) §9 and inheriting [`18`](18-personal-onboarding.md) §9:

- The calm AI-off states are real, focusable, labelled regions (a `role="status"`/`aria-live="polite"` note +
  real `<button>`/link affordances), not color-only — the "available once AI is on" message is **text**, and
  the disabled portrait button has an adjacent, programmatically-associated explanation (`aria-describedby`), so
  the disabled state isn't conveyed by appearance alone.
- The form-first walk is keyboard-operable end to end (it already is via `@selfos/answering`); removing the
  dead-end **adds** reachable content rather than removing it.
- Focus management: when AI becomes available and a surface swaps from the calm state to the active affordance,
  focus is not yanked; the change is announced via the polite live region.
- Responsive ~360px→desktop within the [`02`](02-app-shell.md) shell; the calm states must fit the full-screen
  gated takeover at phone width with no overflow (the §10 / DoD 360px guard).

## 10. Testing strategy

Vault + Claude mocked as established (`SELFOS_FAKE_CLAUDE`, encrypted temp vault); run `pnpm typecheck` after
tests (memory `vitest-does-not-typecheck`).

**Unit (core, Vitest):**

- `requiredSectionsResolved` true only when every required section is `complete | skipped`; false otherwise.
- `submitSectionForm` / `skipIntakeSection` stamp `formsCompletedAt` exactly when the required set first
  resolves; idempotent (re-submitting a section doesn't re-stamp or clear it); reopening a resolved section
  later does **not** clear `formsCompletedAt`.
- `submitSectionForm` records **no usage event** and makes **no Claude call** (assert the fake client is never
  invoked) — the offline guarantee.
- `gateReleased`: `status: 'complete'` ⇒ released regardless of `aiAvailable`; `formsCompletedAt` set + AI off
  ⇒ released per the §11.1 policy; neither ⇒ not released.
- A pre-spec session (no `formsCompletedAt`) that already satisfies the predicate gets stamped on next
  interaction; one already `status: 'complete'` is untouched.

**Component (RTL):**

- `Onboarding` with `aiAvailable: false` renders the **form** controls + Continue/Skip (NOT the old "Connect AI
  to begin" dead-end), and shows the calm inline go-deeper + disabled portrait button with role-aware copy
  (owner Settings link vs member household copy).
- The crisis footer + not-medical line are present in the AI-off state.
- `AppShell`: a member with `gateReleased: true` (form-only) renders the app (sidebar back); with
  `gateReleased: false` stays in the takeover.
- `OnboardingCard`: "forms done, portrait pending, AI off" branch shows the "when AI is ready" framing and
  self-hides once `status: 'complete'`.

**E2E (Playwright, `SELFOS_FAKE_CLAUDE` with AI disabled / key absent):**

- A **member with no AI** is hard-gated → walks + **completes the required form sections** → **decrypt the vault**
  to assert the mapped `Person` fields persisted (e.g. an offline-filled field) → the **hard gate releases**
  (the app nav appears) → the Home **portrait nudge** shows.
- **Enable AI** → open Onboarding → **synthesize the portrait** → it sets `status: 'complete'` and the portrait
  Insight **feeds a later session's `buildContext`** (decrypt to assert) → the nudge self-hides.
- The AI-only surfaces (go-deeper, portrait button) show the **calm state**, never a dead-end (assert the form
  is still interactive while AI is off).
- **360px responsive** guard on the gated takeover + Onboarding surface (no horizontal overflow, no inner
  scrollbars) and the **§7 full-surface-renders-to-the-bottom** guard (every required question is visible — no
  question hidden in a default-collapsed accordion — and the trailing Continue/See-my-portrait affordances are
  reachable).

## 11. Open questions

1. **Form-only release for the AI-available path too (§3.2).** Should the Member gate release on
   `formsComplete` **OR** `portraitComplete` for **everyone** (recommended — never re-trap on a transient AI
   failure at the final step; portrait becomes a strong nudge), or keep `portraitComplete` as the release
   whenever AI is available (maximizes portrait-generation, but reintroduces a final-step dead-end on an AI
   hiccup)? The spec is written so either choice slots into `gateReleased`; **the build session must confirm —
   no default is assumed here.**
2. **Shared not-configured component (§3.4/§5).** The task says "coordinate with the AI-credentials spec's
   shared not-configured component." Has that component landed, and what is its API (audiences, copy, the
   enable affordance)? If not yet, this spec factors the existing `Onboarding.tsx` role-aware copy into a local
   component now and swaps to the shared one when it lands — confirm that's acceptable.
3. **Required `chat` sections (§7).** Confirm the gate set will remain **forms only** (the current catalog
   honors this). If any required section is `chat`-mode, confirm it stays **skippable** so `formsComplete` is
   reachable offline — otherwise it re-creates a dead-end.
4. **Spec number / grouping (header note).** Confirm this should be **25** (filed to avoid clobbering the
   existing `23-portrait-synthesis-optimization.md` in the 21–24 onboarding-redesign group), or whether it
   belongs renumbered into that group.
5. **Persisted `formsCompletedAt` vs purely-derived (§4).** Proposed: persist `formsCompletedAt` (so a released
   gate stays released even if a later section reopen would make `requiredSectionsResolved` momentarily false).
   Confirm we want the **sticky** release (recommended) over recomputing release live each load.

## 12. Changelog

- 2026-06-21 — created (Draft). Amends [`18`](18-personal-onboarding.md) §3.1 (the hard gate + the
  all-or-nothing "connect AI to begin" takeover) and §7 (the "intake cannot run without AI" framing): decouples
  the no-AI **form** sections from `aiAvailable`, releases the Member gate on **required forms resolved** when
  AI is unavailable (additive `formsCompletedAt` + derived `gateReleased`, no `schemaVersion` bump), and
  replaces the dead-end with calm "available once AI is on" states + a persistent portrait nudge. Cross-refs
  [`00`](00-architecture.md), [`18`](18-personal-onboarding.md), [`21`](21-intake-catalog-redesign.md), and the
  out-of-scope household-AI-credentials + settings-enforcement specs.
