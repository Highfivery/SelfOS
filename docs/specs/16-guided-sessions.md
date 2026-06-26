# 16 — Guided sessions (starters & structured exercises)

> **Status:** Approved · **Built** · _last updated 2026-06-14_
>
> A session ([`05`](05-conversations.md)) starts from a blank page today. This spec turns the Sessions
> start screen into a **launcher**: the user can still free-start ("think out loud"), or pick a **guided
> session** — a curated, framework-informed exercise SelfOS walks them through, personalized to their
> profile — from a grouped catalog, plus an AI **"Suggested for you"** row. Most guided sessions are a
> tailored prompt steering a normal chat; a few are **structured, multi-step exercises**. Guided sessions
> are ordinary [`05`](05-conversations.md) conversations under the hood, so they complete, summarize, and
> feed memory exactly like any session ([`09`](09-session-analysis.md)).

Package **C** of the 2026-06 app refresh (memory: `app-refresh-plan-2026-06`). Builds on
[`05-conversations.md`](05-conversations.md) (Sessions surface, chat, persona/safety),
[`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (metering/budgets),
[`09-session-analysis.md`](09-session-analysis.md) (session lifecycle status + End&summarize — a guided
session completes/summarizes through it), [`08-questionnaires.md`](08-questionnaires.md) (the
**context-provider registry / gap-finder** reused as one shared recommender), and
[`04-people-roles.md`](04-people-roles.md) (context, shareable-vs-private). References
[`00-architecture.md`](00-architecture.md) and [`01-design-system.md`](01-design-system.md) rather than
restating them.

---

## 1. Overview

Free-form sessions are powerful but blank-page-intimidating, and they don't surface the _kinds_ of work
SelfOS can help with. This spec adds a **launcher** as the Sessions start/new-session experience:

1. **Free start** — the existing open chat, with framing that sets expectations.
2. **Guided sessions** — a curated, **built-in** catalog of exercises grouped by intent (Therapy-style ·
   Coaching · Intimacy & Sex), each informed by a recognised framework (CBT, ACT, GROW, …) but delivered as
   **self-guided wellness exercises, not clinical therapy** (§8). Picking one starts a session pre-steered
   toward that exercise and personalized to the user's profile/context.
3. **Suggested for you** — an AI row that reads the user's own data + relationships (the §08 context-provider
   registry) and recommends a few catalog exercises that fit right now.

Guided sessions are **ordinary conversations** carrying a `guideId`, so everything downstream — streaming,
cost metering (`06`), status/complete/summarize and the SessionInsight that feeds context (`09`) — works
with no new machinery.

## 2. Goals / Non-goals

**Goals**

- Redesign the **Sessions start screen into the launcher** (free-start + catalog + suggestions) — one
  coherent entry point, no new nav (resolved in the refresh plan).
- A **built-in curated catalog** of guided exercises, grouped, each with metadata + the steering it applies.
- **Hybrid depth:** most exercises are **guided chats** (a tailored system-prompt addendum + an opening
  message steer a normal streaming chat); a **few** are **structured multi-step exercises** with explicit
  steps the AI walks through (e.g. a CBT Thought Record, GROW).
- **"Suggested for you"** — **on-demand, cached, refreshable** AI recommendations over the catalog + the
  user's context, **reusing the gap-finder / context-provider engine** as one shared recommender.
- Guided sessions are normal `05` conversations (carry `guideId`) → they **complete/summarize/feed memory**
  via `09` and **meter** via `06` with no special-casing.
- Safety-first framing for therapy- and sex-informed exercises (§8).

**Non-goals (deferred / out of scope)**

- **User-authored guided sessions** — v1 is the built-in curated catalog; a user authoring surface for custom
  exercises is a clearly-flagged future follow-up (no scaffolding now).
- **A separate "exercise result" data type** — a guided session's output is its transcript + (via `09`) its
  SessionInsight; structured exercises keep their step state lightweight (§4).
- **Voice/audio**, **scheduling/reminders** of exercises, **multi-session programs/courses** — later.
- **Clinical assessment or treatment** — explicitly not this (§8); exercises are wellness self-help.

## 3. UX & flows

### 3.1 The launcher (Sessions start screen)

When the user opens Sessions with no active session (or taps **New session**), the right pane shows the
launcher (the conversation **list** stays in the left pane as today):

- **Free-start block** (top): the framing + a prominent composer / "Start talking" CTA.
  > **What do you want to work through?** Think out loud. SelfOS listens, notices patterns, and pushes back
  > when it helps.
  > _Or start a guided session — a structured, coach- or therapist-informed exercise SelfOS walks you
  > through, personalized to you._
- **Suggested for you** (§3.4): a row/cards of 2–4 AI-recommended exercises (or a calm "turn on AI" / "add
  more about yourself" state). Each card → starts that guided session.
- **The grouped catalog** (§3.2): collapsible groups — **Reflective & therapy-informed**, **Coaching**,
  **Intimacy & connection** — each a grid of exercise cards (title + framework tag + one-line blurb). The
  Intimacy & connection group is gated (§8.3). (Group titles are deliberately non-clinical; the recognisable
  framework lives in each card's tag — §8.1.)

Picking an exercise (or free-start) opens a normal session thread; the launcher returns whenever there's no
active session.

### 3.2 The catalog (built-in, curated)

Each exercise is a built-in definition (§4.1) with a title, group, framework tag, blurb, and the steering it
applies. **Group titles are non-clinical; the framework is a per-card tag** (§8.1). The **initial catalog**
(groups shown with their internal id → display title; **structured** exercises marked ⚙):

- **`therapy` → "Reflective & therapy-informed"** — Reflective Session (Integrative) · Thought Record ⚙ (CBT) ·
  Worry Decatastrophizing (CBT) · Behavioral Activation Plan (Behavioral Activation) · Values Clarification
  (ACT) · Self-Compassion Break (Self-Compassion) · Grief & Loss Check-in (Grief work).
- **`coaching` → "Coaching"** — Life Coaching Session (Integrative) · GROW Goal-Setting ⚙ (GROW) · Weekly
  Review & Reset ⚙ (Reflective practice) · Decision Clarifier ⚙ (Values-based) · Hard Conversation Prep
  (DEAR MAN) · Boundary Setting (Assertiveness) · Burnout & Energy Audit.
- **`intimacy` → "Intimacy & connection"** (18+, §8.3) — Sensate Focus (Masters & Johnson) · Desire
  Discrepancy · Talking About Sex. (Expanded to 20 entries — relational through explicit, plus the structured
  Yes/No/Maybe builder — by [`48`](48-intimacy-guided-sessions.md).)

Card titles avoid the bare word "Therapy" (e.g. "Reflective Session", not "Therapy Session"); the framework tag
(CBT/ACT/…) carries the recognisability. Each exercise leads with "a self-help exercise inspired by X — not
therapy" (§8.1). Final per-card wording is tuned at build.

### 3.3 Starting & running a guided session

- **Guided chat (most)** — picking the exercise creates a conversation stamped with its `guideId`; the AI
  opens with the exercise's **opening message** and the turn's system prompt carries the exercise's
  **addendum** (the method/steps the coach should move through) on top of PERSONA + SAFETY + the user's
  context (§5). It then flows as a normal streaming chat — the user can go off-script anytime; the addendum
  steers, it doesn't lock.
- **Structured exercise (a few)** — e.g. Thought Record / GROW: alongside the chat, a lightweight **stepper**
  shows the exercise's named steps (e.g. Situation → Thoughts → Evidence → Reframe). The AI walks them
  through each; the current step is tracked (`guideStep`, §4.2). The user can still type freely; the stepper
  is orientation, not a hard gate. Completing the last step naturally leads into the §3.5 wrap-up.

### 3.4 Suggested for you

- **On-demand, cached, refreshable.** Suggestions generate when the launcher first needs them (no cache yet)
  and are **cached per person** (§4.3); revisiting the launcher reuses the cache (no spend). A **Refresh**
  action regenerates (spends budget). A subtle "updated <when>" line sets expectations.
- **Engine** — `suggestGuidedSessions` mirrors the questionnaire **gap-finder** (`08` §13.3): it gathers
  structured context from the **shared context-provider registry** (profiles, relationships, approved
  Insights, and — once `09` ships — session insights), asks Claude to pick + briefly justify 2–4 **catalog**
  exercises, validates against the catalog (drops anything not in it), and meters as **`guided.suggest`**
  (`06`). Never sends raw transcripts — structured context only (the §08/§13.3 boundary).
- **Calm states (no dead UI):** AI off / no key → suggestions hidden, the catalog still works, with a quiet
  "Turn on AI in Settings to get personalized suggestions." Over budget → the cache (if any) shows with a
  note; otherwise hidden. Thin profile → "Add more about yourself and the people in your life for better
  suggestions."

### 3.5 Completion & memory

A guided session **is** a `05`/`09` session: it carries a lifecycle status (`09 §14`), can be marked
complete, and **End & summarize** produces a SessionInsight that notes the exercise (`guideId`) and feeds the
user's own context. No separate "exercise outcome" store. Per-session cost shows per `09 §14.3`.

## 4. Data model

### 4.1 The catalog (code, not vault)

The curated catalog is **built-in data in code** (like the capability registry / settings builtins) — it is
not user data and is the same for everyone, so it does not live in the vault:

```ts
interface GuidedExercise {
  id: string; // stable, e.g. 'cbt-thought-record'
  group: 'therapy' | 'coaching' | 'intimacy';
  title: string; // 'Thought Record'
  framework: string; // tag shown on the card, e.g. 'CBT'
  blurb: string; // one line
  kind: 'chat' | 'structured';
  openingMessage: string; // the AI's first message, framed + personalized at runtime
  systemPromptAddendum: string; // method/steps steering, appended after PERSONA+SAFETY+context
  steps?: string[]; // structured exercises only — named steps for the stepper
  adult?: boolean; // intimacy group → age/consent gating (§8.3)
}
```

A small `guidedCatalog.ts` (`@selfos/core/conversations`) exports the array + `getExercise(id)`. The
display metadata (`id`/`group`/`title`/`framework`/`blurb`/`kind`/`steps`/`adult`) is importable by the
renderer; the `systemPromptAddendum`/`openingMessage` are used **host-side** in prompt assembly (§5).

### 4.2 Conversation amendment (`05` §4.1 / `09` §4)

```ts
interface Conversation {
  // …existing + the 09 §14 status fields…
  guideId?: string; // the guided exercise that seeded this session; absent = free session
  guideStep?: number; // structured exercises only — current step index
}
```

Additive-optional, folds into the **same** `Conversation.schemaVersion` bump `09 §14` already makes (no
separate migration). Absent `guideId` ⇒ a free session (today's behaviour).

### 4.3 Suggestions cache

`people/<person-id>/guidance/suggestions.enc` — `{ schemaVersion, generatedAt, suggestions: [{ guideId,
reason }] }`, encrypted like all per-person data, **reset on `activePerson.id` change** (the per-person
isolation rule). Device-vs-vault location is §11; proposed **vault** (suggestions are per-person, not
per-device). All reads/writes through the vault service.

## 5. Architecture & modules

- **Core (`@selfos/core/conversations`)**
  - `guidedCatalog.ts` — the built-in catalog + `getExercise`.
  - `buildSystemPrompt` (extended) — accepts the conversation (or its `guideId`); when set, appends the
    exercise's `systemPromptAddendum` after PERSONA + SAFETY + `buildContext`. The addendum is steering, not a
    replacement — PERSONA/SAFETY always lead.
  - `guidedSessionService.startGuided({ personId, guideId })` — creates a conversation stamped with `guideId`
    (+ `guideStep: 0` for structured), seeds the **opening message** as the first assistant turn (no model
    call needed for a static opener, or a cheap first turn if personalized), returns the conversation id.
  - `suggestGuidedSessions` — the recommender (mirrors `gapFinderService`): `gatherGenerationContext` →
    Claude → validate against the catalog → cache → meter `guided.suggest`. Budget-gated.
- **Metering (`06`)** — new usage type **`guided.suggest`** (label "Session suggestions"); guided **chat
  turns** meter as the existing `chat` type (no change). Charged to the active person.
- **Renderer** — the **launcher** replaces the Sessions empty/new state: the free-start framing block, a
  `SuggestedSessions` panel, a grouped `GuidedCatalog`, and (for structured exercises) a `GuidedStepper`
  beside the thread. Reuses design-system primitives (Card/Stack/…); new card/stepper patterns → `/gallery`
  (DoD §12). `conversationStore` carries `guideId`/`guideStep`; a small `guidanceStore` holds cached
  suggestions, reset on person switch.
- **No new nav/route** — this extends the existing Sessions module (`05`); the launcher is the start state of
  `/sessions`.

## 6. IPC / API contracts

- **Catalog** — no IPC; the display metadata is imported directly by the renderer from `@selfos/core`
  (static, non-secret), the gap-finder precedent.
- `sessions:startGuided({ guideId })` → `{ conversationId }` (creates + seeds the conversation; gated
  `sessions.own`, scoped to the active person; validates `guideId` against the catalog).
- `guided:suggest({ refresh?: boolean })` → cached or freshly-generated suggestions, or a typed
  `NO_KEY` / `BUDGET` / `AI_OFF` envelope; gated `sessions.own` + `ai.enabled`; reads cache, regenerates on
  `refresh`. The Claude call + key stay in main (`00` §6.2).
- Guided chat turns use the existing `chat:stream` (the conversation already carries `guideId`, so the
  host-side prompt assembly picks up the addendum) — no new streaming channel.

## 7. States & edge cases

- **AI off / no key** — the launcher + catalog work fully; starting a guided **chat** that needs a model
  shows the existing not-configured state; **Suggested for you** hides with a calm hint (§3.4). A static
  opening message can still render offline.
- **Over budget** — starting any session hits the existing budget gate (`06`); suggestions show cache-or-hide.
- **Unknown / removed `guideId`** — a conversation referencing a retired exercise still opens as a normal
  session (the addendum is simply absent); `startGuided` rejects an unknown id.
- **Structured exercise, user goes off-script** — allowed; the stepper reflects best-effort progress; never
  blocks free input.
- **Suggestions referencing a gated exercise** — an intimacy exercise is only suggested if the user is
  eligible (§8.3); otherwise filtered out.
- **Migration / old transcripts** — `guideId`/`guideStep` absent ⇒ free session; covered by the `09` §14
  Conversation migration.
- **Per-person isolation** — the suggestions cache + any guided state reset on `activePerson.id` change.
- **Sync conflict / offline** — unchanged vault behaviour (`00`).

## 8. Safety, privacy & honesty

This feature is **safety-critical** — it names clinical frameworks and includes sex-therapy-informed content.

### 8.1 Not therapy, not medical (the boundary)

SelfOS guided sessions are **self-guided wellness exercises informed by** well-known frameworks — **not
therapy, diagnosis, or treatment**, and not a substitute for professional care (CLAUDE.md §1). Concretely:

- **Framing in copy (resolved §11.1)** — **group titles are non-clinical** ("Reflective & therapy-informed",
  "Coaching", "Intimacy & connection") and card titles avoid the bare word "Therapy"; the recognisable
  framework lives in a small **per-card tag** (CBT/ACT/GROW) for discoverability. The launcher, each
  exercise's intro, and the `systemPromptAddendum` make explicit these are reflective **self-help exercises
  inspired by** those approaches, delivered by an AI companion — **not therapy, diagnosis, or treatment**, and
  not received from a clinician.
- **The persona/safety prompt always leads** — the exercise addendum is appended _after_ PERSONA + SAFETY and
  cannot override them; SAFETY's crisis instruction stands.
- **The always-present CrisisFooter** (`05` §7) shows on every session, guided or not.

### 8.2 Crisis routing

Guided exercises — especially Grief & Loss, Self-Compassion, Behavioral Activation — may surface distress.
Crisis handling is unchanged and non-negotiable (`05` §7 / `09` §7): warmth, take it seriously, route to
professional/emergency help, never manage a crisis alone. The exercise addenda reinforce, never weaken, this.

### 8.3 Intimacy & Sex group — adult gating

The Intimacy & connection exercises are **adult content**. Gating (resolved §11.3): a one-time **18+
acknowledgement** for the group (these are reflective/relational exercises, not explicit media, so no DOB/
consent step), and the group is **excluded from "Suggested for you"** until acknowledged. Content stays within
Anthropic's usage policy; refusals are handled gracefully, never circumvented. The `adult: true` flag (§4.1)
drives the gate.

### 8.4 Privacy

A guided session is the user's own data (their transcript, their context), encrypted like any session. The
**recommender** sends only **structured context** (the registry's shareable summary) to Claude — never raw
transcripts (the `08`/`09` boundary). Suggestions are cached per-person and reset on switch.

## 9. Accessibility

Per `01` §9: the launcher's free-start CTA, exercise cards (real buttons with accessible names = title +
framework + blurb), the grouped catalog (collapsible regions with proper headings), the structured stepper
(current step announced; not color-only), and the suggestions row are keyboard-operable and screen-reader
friendly. Responsive ~360px→desktop — the catalog grid reflows to one column on phones; the launcher works in
the master-detail Sessions layout (`02` §3.4). Reduced-motion respected.

## 10. Testing strategy

- **Unit (core):** `guidedCatalog` integrity (unique ids, valid groups, structured exercises have steps);
  `buildSystemPrompt` appends the addendum for a guided conversation and not for a free one, with PERSONA +
  SAFETY still leading; `startGuided` stamps `guideId`/seeds the opener/rejects unknown ids;
  `suggestGuidedSessions` gathers context, validates against the catalog (drops non-catalog ids), caches,
  meters `guided.suggest`, and filters gated exercises; budget/no-key/AI-off envelopes.
- **Component (RTL):** the launcher renders free-start + groups + cards; picking a card calls `startGuided`;
  the suggestions panel shows AI-off/over-budget/thin-profile calm states + a refresh; the stepper reflects
  `guideStep`; the intimacy group shows the age gate.
- **E2E (Playwright, `SELFOS_FAKE_CLAUDE`):** open Sessions → launcher → start a guided chat → the opener +
  steered reply stream → mark complete → summarize (the `09` path) → the Insight notes the exercise; refresh
  suggestions; the intimacy group is gated; 390px overflow + control-geometry guards on the launcher.

## 11. Resolved decisions (2026-06-12)

1. **Naming (§8.1)** — **soft group titles + per-card framework tags**: "Reflective & therapy-informed" ·
   "Coaching" · "Intimacy & connection"; card titles avoid the bare word "Therapy"; every exercise leads with
   "self-help inspired by X, not therapy."
2. **Structured set** — **a few high-value ones** are `structured` (with a stepper): **Thought Record (CBT)**,
   **GROW Goal-Setting**, **Weekly Review & Reset**, **Decision Clarifier**. Everything else is a steered
   `chat`. ([`48`](48-intimacy-guided-sessions.md) adds a fifth structured exercise — the Yes/No/Maybe
   builder — to this set.)
3. **Intimacy gating** — **18+ acknowledgement only** for the group (no DOB/consent); excluded from
   suggestions until acknowledged.
4. **Opening message** — **static opener** per exercise; personalization comes from the first real turn (no
   extra model call).
5. **Suggestions cache** — **vault** (`people/<id>/guidance/suggestions.enc`), per-person, reset on switch.

_All open questions resolved; the spec is build-ready pending final approval. Per-card copy/blurbs are tuned at
build (not a blocking decision)._

## 12. Changelog

- 2026-06-12 — created (Draft). Package C of the 2026-06 app refresh; decisions captured in memory
  `app-refresh-plan-2026-06`. Hybrid depth, built-in curated catalog, on-demand cached AI suggestions reusing
  the gap-finder engine, launcher = Sessions start screen — all pre-resolved in the planning session.
- 2026-06-12 — Review. Resolved §11: soft group names + framework tags; structured set = Thought Record / GROW
  / Weekly Review / Decision Clarifier; intimacy = 18+ ack only; static opener; suggestions cached in vault.
  Build-ready pending final approval.
- 2026-06-14 — **Approved + FULLY BUILT** (Package C). Three build-time forks **asked + confirmed**: suggestions
  are **explicit-first-tap** (no silent spend on launcher open — `guided:getState` reads the cache, `guided:suggest`
  spends); structured steps advance via an **AI-embedded `[[SELFOS:STEP:n]]` marker** (turn-free, stripped from
  saved + streamed text, clamped, best-effort — never blocks free input, mirroring the wrap-up marker); the 18+
  intimacy ack is stored **per-person in the vault** (`people/<id>/guidance/prefs.enc`, reset on switch). **Core:**
  `guidedCatalog.ts` (17 built-in exercises across 3 groups; non-clinical group titles + per-card framework tags;
  every addendum + opener leads with "self-help inspired by X, not therapy"); `guidedSteps.ts` (marker parse/strip/
  `stripCoachMarkers`); `buildSystemPrompt(…, guideId?)` appends the addendum **after** PERSONA+SAFETY+context (+ the
  step-marker convention for structured); `chatService` advances `guideStep` + strips both markers;
  `guidedSessionService.startGuided` (stamps `guideId`/`guideStep:0`, seeds the **static opener** — no model call,
  works offline); `guidanceService` (recommender reusing the questionnaire **gap-finder context-provider registry** —
  structured context only, never transcripts — + cache + 18+ ack); `endAndSummarize` notes the exercise
  (`provenance.guideId` + a leading "Exercise: …" fact). **Schema:** additive-optional `Conversation.guideId`/
  `guideStep` + `InsightProvenance.guideId` (no schemaVersion bump/migration); `Guided*` cache/prefs/view schemas;
  `guided.suggest` usage type. **Seam:** `sessions:startGuided` / `guided:getState` / `guided:suggest` /
  `guided:acknowledgeAdult` — all gated `sessions.own` + active-person-scoped in the bridge (the trust boundary);
  the Claude call + key stay in main. **Renderer:** the launcher replaces the Sessions start state (free-start
  framing + composer, `SuggestedSessions` explicit-first-tap row with calm AI-off/over-budget/thin-profile states,
  grouped collapsible `GuidedCatalog` with the per-person-gated Intimacy group); `GuidedStepper` beside structured
  threads; `guidanceStore` (per-person, reset in AppShell); `conversationStore` guide fields + `startGuided`;
  `/gallery` gains the card + stepper. Code-reviewer **ship** (safety/privacy/gating/spend boundaries all verified;
  applied the a11y nit — the catalog group title is a styled span in a labelled `<section>`, not a heading nested in
  the `<summary>` button). Gate green: typecheck (node + web/DOM-lib), lint, format, **336 core + 389 desktop + 8
  relay** unit (+ guidedCatalog/guidedSteps/guidedSessionService/guidanceService, promptBuilder addendum-ordering,
  chatService step-advance/clamp, endAndSummarize guideId-note, the bridge guided round-trip + guest-denial, the
  SessionLauncher/SuggestedSessions/GuidedStepper RTL), **+1 E2E** (start a structured guided exercise → opener +
  stepper → steered reply → complete & summarize → the Insight notes the exercise [`provenance.guideId`] + the goal
  feeds a later `buildContext`; the Intimacy group is 18+-gated; explicit-first-tap suggestions; 390px overflow guard).
  Visual QA via the web preview at desktop + 390px (the launcher, the grouped catalog with framework tags, the 18+
  gate → reveal, the structured stepper + not-therapy opener; 0 overflow, no console errors). On
  `feat/guided-sessions` off `main`. **Lesson: a guided session needs NO new machinery — it's an ordinary
  Conversation carrying `guideId`, so streaming/metering/lifecycle/summarize all work unchanged; the only additive
  pieces are a code-only catalog, an addendum appended after (never before) PERSONA+SAFETY, and two turn-embedded
  markers (wrap-up + step) that cost nothing extra.**
