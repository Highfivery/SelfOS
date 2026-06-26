# 52 — Challenge / experiment sessions

> **Status:** Draft — _last updated 2026-06-25_
>
> A new **Challenge / experiment** session type: grounded in the person's own data (insights, goals, test
> profiles), the AI coach **proposes a stretch action**, the person and coach **co-define it
> conversationally**, and the agreed challenge becomes a **tracked `Challenge` entity** with a lifecycle and
> **follow-up check-ins** — "did you try it? how did it go?" — whose reflection feeds memory (an Insight) and
> can seed the next challenge. Challenges deliberately push comfort zones across overcoming current/past
> issues, building/breaking habits, broadening horizons, trying new things, and (behind the 18+ gate)
> sexual/explicit experiments. It is the **behavioral / accountability** layer that turns what the app knows
> into action.

Builds directly on [`16-guided-sessions.md`](16-guided-sessions.md) (a guided session is an ordinary
[`05`](05-conversations.md) Conversation carrying a `guideId`; the `[[SELFOS:STEP:n]]`/wrap-up marker
convention; `guidedSessionService.startGuided`; the per-person 18+ acknowledgement),
[`39-living-memory-continuity.md`](39-living-memory-continuity.md) (the `Goal` entity, `goalService`,
`summarizeOpenCommitments`, and the **goal-followup plumbing** this spec mirrors),
[`40-proactive-coaching.md`](40-proactive-coaching.md) (`goalRaiseInstruction`, the
`coachingSynthesisService` suggester, the `goal-followup` notification kind + Home `GoalFollowupCard`, the
per-person `CoachingPrefs`), and [`09-session-analysis.md`](09-session-analysis.md) (End & summarize →
`SessionInsight`, the meter-before-parse rule). Consumes the intimacy arc — [`48`](48-intimacy-guided-sessions.md)
(intimacy guided sessions), [`49`](49-intimacy-activities-inventory.md) (the expanded intimacy inventory), and
[`50`](50-self-assessments.md) (the kink/sexuality test results) — as **sources** for sexual/intimacy
challenges, but depends on **none** of them (every other challenge domain works standalone today). References
[`00`](00-architecture.md)/[`01`](01-design-system.md) (vault/IPC/security; primitives/tokens),
[`06`](06-ai-usage-and-budgets.md) (metering/budgets), [`04`](04-people-roles.md) (context, the
shareable-vs-private split), [`35`](35-notification-system.md) (the notification surface), and
[`17`](17-home-dashboard.md) (Home cards) — rather than restating them (DRY).

---

## 1. Overview

SelfOS today **knows** a great deal about a person (the onboarding portrait `18`; session/dream/questionnaire
Insights `08`/`09`/`12`; first-class goals `39`; soon test profiles `50`) and even **reflects** on it
proactively (`40`). What it does **not** yet do is help the person **act** — to turn "the app understands me"
into "the app helps me grow." A **challenge** (working title; see §11) is the missing behavioral primitive: a
small, deliberately stretching experiment the person commits to **between** sessions, with accountability built
in.

The mechanism reuses the guided-session insight that **a guided session is just a Conversation carrying a
`guideId`** (`16` §4.2). A **challenge session** is similar — an ordinary conversation whose system prompt is
steered (by an addendum appended **after** PERSONA + SAFETY + context, the established `promptBuilder.ts` rule)
to **propose** a grounded stretch action, **negotiate** it with the person, and (when they agree) emit a
private `[[SELFOS:CHALLENGE:…]]` marker capturing the agreed challenge — exactly mirroring the `16` wrap-up /
step markers (`guidedSteps.ts`). The captured challenge becomes a tracked **`Challenge` entity** (a sibling of
the `39` `Goal`, not a `Goal` itself) with a lifecycle (proposed → active → done / abandoned), a **check-in**
cadence, and a **reflection** that — like session analysis (`09`) — produces an `Insight` feeding the
person's own context and seeding the next challenge.

Two things initiate a challenge (both confirmed, §11):

- **The person** launches a **Challenge session** any time, from the Sessions launcher (`16` §3.1) — "give me
  a challenge."
- **The app** surfaces a **suggested challenge** drawn from the person's data + tests, as an
  **explicit-first-tap** card (a metered `challenge.suggest` pass, no silent spend — mirroring the
  guided-session suggester `suggestGuidedSessions` / the `40` synthesis pass).

It deliberately spans:

- **Overcoming current/past issues** — a graded exposure step toward an avoided situation; a small repair
  attempt after a rupture; a "do the thing you've been putting off" experiment.
- **Building/breaking habits** — start a tiny keystone habit; interrupt a pattern for a week.
- **Broadening horizons** — try a new place/activity/idea; talk to someone outside the usual circle.
- **Trying new things** — a one-off novelty experiment.
- **Sexual / explicit experiments** (behind the 18+ gate, `16` §8.3) — try a "Maybe" from a Yes/No/Maybe list
  (`48`), bring a fantasy to a partner, a sensate/aftercare practice — grounded in the intimacy inventory
  (`49`) and the kink/sexuality test results (`50`), within the consensual-adult / within-Anthropic-policy
  boundary, and **strictly respecting hard-nos** (the intimacy matrix hard-no ratings, `27`/`46`) and partner
  consent.

Because a challenge session is a normal `05`/`09` session, it inherits streaming, metering/budgets (`06`),
per-person isolation, the always-present CrisisFooter, and memory — no new chat machinery.

## 2. Goals / Non-goals

**Goals**

- A **Challenge session type** — a guided-style conversation that **proposes a grounded stretch action**,
  **negotiates** it with the person (difficulty/comfort is dialable by them), and on agreement **captures** it
  into a tracked `Challenge` via a private `[[SELFOS:CHALLENGE:…]]` marker (no extra Claude call — the capture
  rides the chat turn, the `16`/`09` marker precedent).
- A first-class **`Challenge` entity** (NOT an extension of `Goal`): status (`proposed`/`active`/`done`/
  `abandoned`), action text, a **comfort/difficulty** level, a **domain/life-area**, `agreedAt`, a
  `checkInAt`, a **reflection**, provenance, and `insightId` — stored encrypted per-person.
- **Follow-up check-ins** — the app gently asks "did you try it? how did it go?" (a check-in **session** _or_
  an **inline** quick reflection), and the reflection **feeds an Insight** (and can **seed the next**
  challenge), **reusing the `40` goal-followup notification/nudge plumbing** (a new `challenge-followup` kind
  - a Home `ChallengeCard`), not a new framework.
- **Two initiators** — the person launches a Challenge session any time, AND proactive coaching surfaces a
  **suggested** challenge from their data/tests as an **explicit-tap** card (metered `challenge.suggest`,
  never silent), mirroring the guided-session suggester and the `40` synthesis pass.
- **Grounded in real data** — the proposer reads `summarizeForContext` (`04`/`08`) + `summarizeOpenCommitments`
  (`39`) + (when `50` lands) test profiles, so challenges fit the person; the per-person 18+ ack gates
  sexual/explicit challenges (`16` §8.3).
- **Push the comfortable-uncomfortable, never the unsafe (the heart of §8)** — respect consent, hard-nos,
  trauma boundaries, and crisis safety; the coach **proposes and negotiates, never coerces**; a challenge is
  always the person's choice.
- **Closes the loop into Goals** — a completed challenge may **inform/seed a `39` `Goal`** (a habit-building
  challenge → an ongoing goal), but a challenge is **not** a goal and does not reuse the `Goal` schema.
- **Additive & safe** — additive-optional schema (the `18`/`20`/`28`/`39` precedent), Zod-first, per-person
  isolation, the shareable-vs-private boundary unchanged (the bridge is the trust boundary), tolerant
  model-JSON parsing (`37`), budget-gated + metered (`06`).

**Non-goals (deferred / owned elsewhere)**

- **A scheduler / reminders / OS push** — check-in cadence is **renderer-driven** on app events
  (launch/focus), like the `36` update cadence + the `40` synthesis cadence; never a main-process cron. Push
  notifications are out (a `35` non-goal; in-app only).
- **Gamification — streaks, points, badges (§11).** Deferred pending the user's call (motivating vs
  pressuring, and it cuts against the gentle/not-naggy register). No streak data is modelled v1.
- **Multi-step "programs" / challenge courses** — one challenge at a time; a sequence is a future enhancement.
- **Cross-person / "couple" challenges as a shared entity** — a challenge is **single-subject** (the person's
  own). A sexual challenge that involves a partner is still **the person's** challenge; partner coordination
  is conversational + the existing relationship-scoped sharing (`42`/`44`), not a shared challenge object
  (§11).
- **A new notification framework or a new Home dashboard** — reuse `35` + `17`; this spec adds **kinds** +
  **content**, not chrome (the `40` precedent).
- **Re-implementing the `Goal` entity, reconciliation, or the goal-followup card** — owned by `39`/`40`; this
  spec **reuses** the followup plumbing and the `goalService` patterns, and only **reads/seeds** `Goal`s.
- **A second AI provider / images** — N/A; the only AI is the chat turn, the suggester, and the reflection
  analysis, all on the existing Anthropic path.

## 3. UX & flows

The user-perceived surfaces are: (1) launching a Challenge session from the Sessions launcher, (2) the
co-create conversation, (3) the agreed challenge captured into a **tracked card**, (4) a Home/Sessions
**ChallengeCard** (active / done) with the difficulty dial, (5) the **check-in** flow (a follow-up session or
inline), and (6) **proactive suggested challenges** as an explicit-tap card. Every surface is responsive
(~360px→desktop, `01` §9) and carries the always-present CrisisFooter + not-medical line (§8). Genuinely-open
product/UX decisions (naming, push intensity, streaks, cadence default, seed-a-goal, partner coordination) are
in **§11** — do not assume.

### 3.1 Launching a Challenge session (the person initiates)

On the Sessions **launcher** (`16` §3.1), alongside free-start, the guided catalog, and "Suggested for you", a
**"Take on a challenge"** entry (a card or a launcher block — placement is a §11/build nicety) starts a
challenge session:

> **Ready to stretch a little?** SelfOS will suggest a small experiment based on what it knows about you — you
> decide together how far to push. _You're always in control: nothing happens that you don't choose._

Tapping it calls `challenges:start` (§6) → creates a Conversation stamped with the challenge `guideId` (a
reserved built-in `challenge-coach` guide, §4.1/§5.2), seeds a **static opening message** (no model call — the
`16` §11.4 opener precedent: "I'd love to suggest something to try this week. Want it grounded in something
specific — a habit, a fear you've mentioned, something new — or shall I surprise you?"), and opens the thread.
The first real turn (which the person pays for) is where the model proposes, grounded in their context.

Optionally the person can **seed a domain** (overcome an issue · habit · broaden horizons · try something new ·
intimacy) up front — a light chooser in the opener, not a hard branch — so a person who knows what they want
isn't given a random challenge.

### 3.2 The co-create conversation (propose → negotiate → agree)

Each turn's system prompt = PERSONA + SAFETY + the person's context + the **challenge addendum** (+ FORMATTING),
assembled host-side by `buildSystemPrompt` (`16` §5, `promptBuilder.ts`); the addendum is appended **after**
PERSONA + SAFETY + context so the not-therapy / consent / safety boundary always leads (§8). The addendum
(§5.2) steers the coach to:

1. **Propose ONE grounded stretch action** — drawn from the person's own context (an avoided situation, an
   open goal, a stated value, a "Maybe" item), framed as an **invitation**: small, specific, time-boxed,
   achievable-but-stretching, and **the person's choice** ("Here's one idea — totally fine to tweak it or pick
   something else.").
2. **Negotiate it** — adjust scope/difficulty to the person's comfort (the **dial**, §3.6): make it smaller if
   it feels too big, bigger if too easy; clarify _what_ exactly, _when_, and _what counts as done_; surface
   what might get in the way and a tiny if-then plan. **Never pressure** — if the person hesitates, the coach
   shrinks it or offers a different one; if they say no, it lets go.
3. **Confirm + capture** — when the person clearly agrees to a concrete action, the coach reflects it back in
   one or two crisp sentences and **silently appends** a private `[[SELFOS:CHALLENGE:{...}]]` marker (§4.2)
   carrying the agreed `action`, a `comfort` level (1–5, the person's chosen stretch), a `lifeArea`/`domain`,
   and an optional `checkInDays` — exactly like the `16` step / wrap-up markers (`guidedSteps.ts`: stripped
   from the saved + streamed text, never shown, best-effort, free input never blocked). The orchestrator
   parses the marker, creates the `Challenge` (`status: 'active'`, `agreedAt = now`, `checkInAt = now +
checkInDays`), and the thread shows a small "**Challenge set** ✓" confirmation inline (the `09` wrap-up-card
   precedent) linking to the ChallengeCard.

The conversation then continues normally if the person wants to talk it through; it is a normal `05` session.
The person can decline the whole thing at any point (no marker → no `Challenge`).

### 3.3 The agreed challenge as a tracked card

A captured challenge surfaces as a **ChallengeCard** in two places (reusing existing surfaces, no new nav):

- **Home (`17`)** — a small presentational card for the **current active** challenge ("Your challenge: _strike
  up one conversation with a stranger this week._ Due Fri.") with quick actions **I did it / Not yet /
  Reflect** and a **Check in** affordance once `checkInAt` passes (§3.5). Self-hides when there's no active
  challenge.
- **Sessions surface** — a slim "active challenge" indicator/section so a challenge is visible where the work
  happens (placement a build nicety). (A dedicated `/challenges` list of history is a §11/future nicety — v1
  surfaces the **current** one + closed ones in a collapsed "Past challenges" affordance, the `39` Goals
  "Completed & closed" precedent.)

The card shows the action, status (a labelled, non-color-only chip: Active / Done / Let go), the comfort/
difficulty level, the domain/life-area, and provenance ("From a challenge session on <date> →", deep-linking
like `20` §3.3 / `39` §3.1). Marking **Done / Let go** moves it to the collapsed closed section (kept for
history; the coach can reference "you took on X").

### 3.4 The difficulty / comfort dial

Difficulty is **dialable by the person**, never set unilaterally by the coach:

- **In conversation** (§3.2) — the person negotiates the stretch; the coach shrinks/grows it on request.
- **On the card** — a small comfort indicator (1–5, "gentle nudge → big leap") the person can adjust; lowering
  it can prompt a "want me to make it smaller?" re-open (a fresh challenge turn), raising it a "ready for
  more?" (build nicety). The stored `comfort` is the person's chosen level at agreement; the dial is the
  durable signal a future suggester reads to calibrate (§5.3).

A global per-person **push intensity** (how hard the coach pushes by default) is a **§11 open question** —
candidate: fold it into the existing `40` `coaching.proactivity` (`off`/`gentle`/`active`, `CoachingPrefs`),
rather than a new setting.

### 3.5 The check-in flow (did you try it? how did it go?)

After `checkInAt` passes for an `active` challenge, the app **gently** prompts a check-in — **never a nag**
(§8): at most one open check-in nudge at a time (coalesced by `challenge-followup`), and acting on or
dismissing it suppresses it until the challenge's state changes (the `35` `onChange` re-surface rule, the `40`
goal-followup precedent). Two ways to check in (resolved at build; both supported):

- **Inline (quick)** — from the ChallengeCard / the `challenge-followup` notification: **I did it / Not yet /
  Let it go** + an optional one-line reflection. "I did it" + a reflection runs the **reflection analysis**
  (§5.4) and marks the challenge `done`; "Not yet" keeps it `active` (and may offer to shrink it or push
  `checkInAt` out); "Let it go" marks it `abandoned` so it never returns (the `39` "let it go" precedent).
- **A check-in session** — "Talk about how it went" opens a short challenge **reflection session** (a normal
  conversation, the same `guideId` lineage with a reflection addendum) where the coach asks how it went, what
  was learned, what to try next — and **on completion summarizes** into an Insight (the `09` End & summarize
  path), then optionally proposes the **next** challenge (seeding, §3.7).

Either way the **reflection feeds memory**: it produces an `Insight` (§5.4) so the coach remembers the
experiment and its outcome.

### 3.6 (Reserved — see §3.4 for the dial.)

### 3.7 Proactive suggested challenges (the app initiates)

Separate from the person launching a session, proactive coaching surfaces a **suggested challenge** drawn from
the person's data — an **explicit-first-tap** card (no silent spend, the `16` suggester + `40` synthesis
precedent):

- A Home **SuggestedChallengeCard** (and/or a `challenge-suggested` notification, coalesced — §11/§3.8) appears
  when warranted (e.g. the person has open goals/insights and no active challenge, throttled like the `40`
  cadence). It shows a **"Get a challenge idea"** button — tapping spends `challenge.suggest` (metered,
  budget-gated, §6) to produce **one** grounded candidate (action + why-it-fits, drawn from **structured
  context only** — insights summaries/facts + open goals + test profiles — **never raw transcripts**, the
  gap-finder/`40` rule). The candidate is shown for the person to **accept (→ starts a challenge session
  pre-seeded on it), tweak, or dismiss** — accepting it, not the suggestion, is what creates a `Challenge`.
- The suggestion is **cached** (view-only re-display costs nothing, the dream-patterns/`40` synthesis
  precedent) and **not** auto-promoted into the coach's grounding context.
- Sexual/intimacy challenge suggestions are **gated by the 18+ ack** (§8.3) and only drawn once acknowledged
  (the suggester filters them, like `suggestGuidedSessions(..., { adultAllowed })`).

### 3.8 Coordination (no spam)

All challenge nudges (`challenge-followup`, the suggested-challenge prompt) flow through the **one** `35`
notification registry + the `17` Home self-hide, coalesced with the existing kinds (goal-followup,
profile-freshness, coaching-synthesis) per `40` §3.7 — so the same concern never appears twice (e.g. a
suggested-challenge prompt is suppressed while a challenge is already active; a goal-followup and a
challenge-followup about the same commitment coalesce or one yields). At most one open challenge nudge at a
time.

### 3.9 Completion & memory

A challenge's reflection produces an `Insight` (`source: 'session'` with `provenance.challengeId`, §4.4) that
feeds the person's **own** context — so a later session knows "you tried X, here's how it went." A completed
challenge may **seed the next one** (§3.7) and, per §11, **inform/seed a `39` `Goal`** (e.g. a habit
challenge that worked → an ongoing goal). Per-session cost shows per `09` §14.3 (admin-only $).

## 4. Data model (vault files & schemas)

Additive-optional throughout (the `18`/`20`/`28`/`39` precedent — existing records parse byte-for-byte). All
reads/writes go through the vault + crypto service (`@selfos/core/vault`, `00` §4.3); no direct `fs`.
Per-person isolation (every file under `people/<subjectPersonId>/…`).

### 4.1 Vault layout (additions)

```
vault/
  people/<person-id>/
    challenges/<challenge-id>.enc   # a Challenge (encrypted; one per agreed challenge)
    challenges/suggestion.enc       # the cached proactive suggestion (one current; overwritten) — §3.7
    conversations/<id>.enc          # existing — the challenge session is an ordinary conversation (guideId)
    insights/<insight-id>.enc       # existing — a challenge reflection's derived Insight (source:'session')
    guidance/prefs.enc              # existing — the shared 18+ `adultAcknowledged` gates sexual challenges
    coaching/prefs.enc              # existing — the 40 CoachingPrefs (proactivity level) governs push intensity
```

The **challenge catalog/coach prompt is code, not vault** — the `challenge-coach` guide (the addendum + opener)
ships in `guidedCatalog.ts` (or a sibling `challengeCoach.ts`) like the curated guided catalog (`16` §4.1).
Only the person's **agreed challenges + the cached suggestion** are persisted (encrypted, own folder). This
feature stores **no per-device state** beyond what `35`/`40` already use for cadence/dismissal.

### 4.2 `Challenge` (per-person, encrypted) — a new entity, NOT a Goal

```ts
// @selfos/core/schemas.ts — illustrative, Zod-first
export const ChallengeStatusSchema = z.enum(['proposed', 'active', 'done', 'abandoned']);
export type ChallengeStatus = z.infer<typeof ChallengeStatusSchema>;

export const ChallengeSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1), // per-person isolation — the challenge's owner (always self)
  action: z.string(), // the agreed stretch action, in the person's terms ("strike up one conversation…")
  status: ChallengeStatusSchema, // 'active' on capture; 'proposed' if a suggestion not yet agreed (§3.7)
  comfort: z.number().int().min(1).max(5), // the person's chosen stretch (1 gentle nudge … 5 big leap) — the dial
  lifeArea: z.string().optional(), // from LIFE_AREAS, normalized server-side (mirrors InsightFact/Goal)
  domain: z.string().optional(), // the challenge family ('habit' | 'horizons' | 'overcome' | 'novelty' | 'intimacy') for filtering/suggestion
  adult: z.boolean().optional(), // a sexual/explicit challenge → 18+-gated surfaces + sensitive reflection
  conversationId: z.string().optional(), // the challenge session this was agreed in (back-reference)
  provenance: InsightProvenanceSchema, // reuse the existing schema (carries conversationId + at)
  agreedAt: z.string().optional(), // set when status → 'active' (the person committed)
  checkInAt: z.string().optional(), // when the app should gently ask "how did it go?" (§3.5)
  reflection: z.string().optional(), // the person's outcome reflection (on check-in)
  outcome: z.enum(['did', 'partly', 'didnt']).optional(), // a light structured outcome from the check-in
  insightId: z.string().optional(), // the reflection's derived Insight (source:'session', §4.4)
  seededGoalId: z.string().optional(), // if completing seeded a 39 Goal (§11) — the back-link
  seededFromChallengeId: z.string().optional(), // the prior challenge this was seeded from (§3.7 chain)
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Challenge = z.infer<typeof ChallengeSchema>;
```

A `Challenge` is intentionally **its own entity, not a `Goal` subtype** (locked, §11/§2): a goal is a standing
commitment with an open-ended status set (`39` `GoalStatusSchema` = `open`/`inProgress`/`done`/`stale`/
`abandoned`); a challenge is a **time-boxed experiment** with a `comfort` dial and a check-in. They relate
(`seededGoalId`) but do not share a schema — mirroring how dreams/sessions are distinct producers into the same
Insight layer. The cached suggestion (§3.7) is a `Challenge` with `status: 'proposed'` written at
`challenges/suggestion.enc` (overwritten each suggest; promoted to `active` + moved to its own file when the
person accepts), or a slimmer `ChallengeSuggestion` shape (`{action, why, comfort?, domain?, adult?, computedAt}`)
— the exact persisted shape of the suggestion is a build detail; the agreed challenge is the `ChallengeSchema`
above.

### 4.3 De-dup / one-active rule

There is normally **one active challenge at a time** (§3.3 / the not-naggy register): the marker-capture path
checks for an existing `active` challenge and, if one exists, the coach is steered to either complete the prior
one first or replace it on the person's say-so (so two markers in close succession don't spawn two competing
active challenges). This mirrors the `39` `extractGoals` de-dup discipline (fold/avoid duplicates), adapted to
"one active experiment."

### 4.4 Shared Insight / metrics layer additions (additive)

- **`InsightProvenanceSchema`** (`packages/core/src/schemas.ts:654`) gains an optional **`challengeId?:
string`** alongside `conversationId` / `dreamId` / `guideId` / `intakeSection`, so a challenge-reflection
  Insight deep-links to its `Challenge` and Memory's provenance can show "From a challenge." **Additive-optional
  → no `schemaVersion` bump** (the established additive-provenance precedent — `dreamId`/`guideId`/`intakeSection`
  were all added this way).
- **`InsightSource` stays `['questionnaire','session','dream','intake']` — recommended (§11): a challenge
  reflection is `source: 'session'` carrying `provenance.challengeId`, NOT a new `'challenge'` source.** A
  challenge reflection **is** a session-shaped reflection on a conversation (`09`), and every Insight consumer
  (`summarizeForContext`/`feedableInsights`/the gap-finder/Memory) reads `source` only for display/provenance —
  so adding a fifth enum value would force a touch of every consumer for no behavioural gain, where
  `provenance.challengeId` gives the deep-link + filtering for free. (Spec `50` independently proposes a
  `'test'` source for a genuinely different producer; a challenge is not — it's a session. §11 confirms.)
- A challenge reflection's facts use the existing `Insight` machinery; a **sexual/intimacy** challenge's
  reflection facts are **`restricted`** (the `18` §8.4 own-context-only rule, like the intimacy intake/test
  facts) so they never broadcast.

### 4.5 Capability & settings

- **Capability** — add **`challenges.own`** to `CAPABILITIES` (`packages/core/src/capabilities.ts`), **Member
  default ON** (added to the Member `capabilityMap`), `CAPABILITY_LABELS['challenges.own'] = 'Take on their own
challenges'`. The Owner has it via the full-access bypass (`roleAllows`); a Guest does not. It is **not**
  `EXPLICIT_GRANT_ONLY` — taking on a challenge about yourself is ordinary. (A sexual/explicit challenge is
  additionally gated by the **18+ ack**, not a capability.)
- **Settings** — **no new setting v1 (recommended, §11):** push intensity folds into the existing `40`
  per-person `coaching.proactivity` (`CoachingPrefs`) — `off` disables the proactive suggested-challenge card +
  the in-session push register; `gentle`/`active` tune cadence + how present the coach is. (Self-initiated
  Challenge sessions still work at any level — `off` only stops the **proactive** surfacing, the `40` precedent
  where `off` never disables a person-initiated action.) The deterministic check-in nudge is governed the same
  way. _(N/A — no new schema-driven settings declaration beyond what `06`/`40` own.)_

### 4.6 Ownership

All reads/writes go through the vault/crypto service — the renderer never touches `fs` (`00` §3). `Challenge`s +
the cached suggestion are encrypted under the master key in the taker's own folder; the challenge-coach prompt
is code (never written).

## 5. Architecture & modules

No new feature module in the shell sense — this is `@selfos/core` services + additions to the existing Sessions
launcher (`16`), the `35` notification registry, the `17` Home cards, the prompt builder (`05`/`16`), and the
`challenges.own` capability. Changes by area.

### 5.1 The challenge session service (`@selfos/core/conversations` or `@selfos/core/challenges`)

- **`challengeService.startChallenge({ fs, key, personId, domain?, now })`** — mirrors
  `guidedSessionService.startGuided`: creates an ordinary `Conversation` stamped with the `challenge-coach`
  `guideId` (+ an optional seeded `domain`), seeds the **static opener** (no model call — works offline, the
  `16` §11.4 precedent), returns the conversation id. The first real turn proposes, grounded in context.
- **Marker capture in the chat orchestrator** — extend the `chatService` turn handling (where it already
  strips/acts-on the `16` `[[SELFOS:STEP:n]]` + the `09` wrap-up markers via `guidedSteps.ts`
  `stripCoachMarkers`) to additionally parse a `[[SELFOS:CHALLENGE:{json}]]` marker, **strip it from saved +
  streamed text** (a `parseChallengeMarker`/`stripChallengeMarker` pair in `guidedSteps.ts`, tolerant of a
  partial mid-stream marker exactly like `stripStepMarkers`), and — when present + the JSON validates —
  **create the `Challenge`** (`status:'active'`, `agreedAt`, `checkInAt`) via `challengeService`. **No extra
  Claude call** — the capture rides the paid turn (the `16`/`09` marker precedent). A malformed marker is
  ignored (no challenge created; the conversation is unaffected) — the tolerant-parse rule (`37`).
- **`buildSystemPrompt` (reused, `16` §5)** — picks up the `challenge-coach` addendum from `guideId` with no
  code change (it already appends an exercise addendum after PERSONA + SAFETY + context). For a **check-in /
  reflection** session, the same guide lineage carries a reflection addendum (or a `?phase=reflect` variant —
  build detail). The addendum **leads** with the not-therapy / consent / safety boundary (§8) and the
  challenge proposer's context-grounded steering (§5.2).
- **`challengeService`** also owns `listChallenges(personId)`, `getChallenge`, `setChallengeStatus`,
  `recordCheckIn` (writes `reflection`/`outcome`, sets status, triggers the reflection Insight §5.4),
  `activeChallenge(personId)` (the one-active read), and `markStaleCheckIns(now)` (the derived "check-in due"
  set) — the `39` `goalService` shape, adapted.

### 5.2 The challenge-coach prompt (code)

A reserved built-in guide (`challenge-coach`) in `guidedCatalog.ts` (or `challengeCoach.ts`) with:

- a **static `openingMessage`** (§3.1) — invitational, doesn't assume a partner or a domain;
- a **`systemPromptAddendum`** that **leads** with `frame('a small experiment to try, not therapy')` (the
  shared `guidedCatalog.ts` not-therapy preamble) + the SAFETY/consent boundary, then steers the coach to
  **propose ONE grounded stretch action, negotiate scope/difficulty to the person's comfort, never coerce,
  respect a no/hard-no/pause immediately, and on agreement append the `[[SELFOS:CHALLENGE:{action,comfort,
lifeArea,checkInDays}]]` marker** (the marker convention taught in-prompt exactly like
  `buildStepInstruction`). The intimacy/sexual register, **only when the person steers there and the 18+ ack
  is present**, adopts the `08` §16.5 consensual-adult sexual-wellness framing (`intimacyExplicitFraming`),
  with the hard-no / consent / partner-buy-in instructions of §8 stated verbatim in intent.
- The marker's `lifeArea`/`domain` are **normalized server-side** against `LIFE_AREAS` (never trusted raw,
  the `goalService.normalizeLifeArea` precedent); `comfort` is clamped 1–5; `checkInDays` is clamped to a sane
  range (default ~7).

### 5.3 The proactive suggester (`@selfos/core/challenges/challengeSuggestService.ts`)

`suggestChallenge(deps)` — mirrors `coachingSynthesisService.synthesize` (`40`) + the guided
`suggestGuidedSessions`:

- **Budget-gated** (`checkBudget` person + app, the override path) → assembles a **bounded, structured,
  transcript-free digest** from the existing readers — `feedableInsights`/`listInsightsForPerson` (summaries +
  non-restricted/non-flagged facts), `summarizeOpenCommitments` (`39` open goals), and (when `50` lands) the
  **test-profile context provider** — framed `PERSONA + SAFETY + CHALLENGE_SUGGEST_GUIDANCE` → **one Claude
  call** → **meter `challenge.suggest` BEFORE parse** → **tolerant parse** (`37`: require only `action`,
  `.catch` the rest, honest `EMPTY`/`REFUSED`/`TRUNCATED`/`MALFORMED`/`ERROR` reasons) → cache the suggestion
  (`challenges/suggestion.enc`, overwrites).
- **Pure `shouldSuggestChallenge(state, now)`** (the cadence/throttle decision, unit-tested — keyed on "no
  active challenge" + a throttle window + the `CoachingPrefs` level; `off` → never), so the renderer cadence
  hook fires it only when warranted, and a **proactivity-specific cap** (the `40` `SYNTHESIS_WEEKLY_CAP`
  precedent) stops a manual "give me another idea" from running away on cost.
- **Never raw transcripts** — structured context only (the `08`/`09`/`40` boundary). Sexual/intimacy
  candidates are excluded until the 18+ ack (the `adultAllowed` filter). The API key stays in main.

### 5.4 The reflection → Insight bridge (the `09` model)

When a check-in records a reflection (inline or via a reflection session), `challengeService.recordCheckIn`
produces an `Insight` — the `09` `sessionAnalysisService` pattern:

- **Inline reflection** — a lightweight analysis (or the deterministic "the person did/partly/didn't + their
  note" with the coach's framing) → an `Insight` (`source: 'session'`, `approved: true`, `subjectPersonId` =
  the taker, `provenance.challengeId`) whose facts summarize the outcome/learning; **meter before parse** if it
  spends; a sexual/intimacy challenge's facts are **`restricted`** (§4.4). A re-check-in reuses the
  `insightId` (carries fact sharing forward, the `09`/`39` re-run precedent).
- **Reflection session** — End & summarize (`09`) already produces a `SessionInsight`; the challenge link is
  added via `provenance.challengeId` so it deep-links + filters as the challenge's reflection.
- **Crisis-adjacent reflection** (distress surfaced doing the challenge) → the Insight's `crisisFlag` is set
  and the surface **leads with resources** (§8.2), never a clinical judgment.
- **Seeding the next challenge** — after a reflection, the suggester (§5.3) / the reflection session may
  propose the next one (`seededFromChallengeId` set); a completed habit/standing challenge may **seed a `39`
  `Goal`** via `goalService.extractGoals` (`seededGoalId` back-link) — §11.

Deletion (the `20` §3.7 / `39` keep-the-insight spirit): deleting a `Challenge` removes its file; its derived
Insight follows the existing Memory delete (it's an ordinary Insight, deletable there) — exact cascade is a
build detail mirroring `09`/`39`.

### 5.5 Surfacing (renderer — `35` + `17` + the Sessions launcher)

- **Notification kinds** — register **`challenge-followup`** (info; the check-in nudge) and (per §11/§3.7)
  **`challenge-suggested`** in the `35` registry (icon/severity/action/coalesce + per-kind re-surface),
  **reusing the `40` goal-followup machinery** (`notificationKinds.ts`, `goalFollowup.ts`,
  `useNotificationSources.ts`, the Home `GoalFollowupCard.tsx`) as the template — a `challengeFollowup.ts`
  source computing the derived nudge from the active-challenge `checkInAt`. Crisis is **not** a kind (`40`
  §3.5).
- **Home cards (`17`)** — a **`ChallengeCard`** (current active challenge + I-did-it / Not-yet / Reflect + the
  comfort dial + Check-in once due) and a **`SuggestedChallengeCard`** (explicit-tap "Get a challenge idea" →
  the cached/fresh suggestion → Accept/Tweak/Dismiss), both reusing existing primitives (Card/Stack + the `17`
  seed-handoff to start the session). Self-hiding on empty; per-person via the existing Home load (`17` §3.4).
  A new labelled status chip / comfort control → `/gallery` if a genuinely new primitive (DoD §12); otherwise
  reuse `GoalStatusChip` patterns.
- **Sessions launcher (`16`)** — the "Take on a challenge" entry (§3.1); the active-challenge indicator (§3.3).
- **Cadence hook** — an AppShell hook (`useChallengeCadence`, mirroring `useUpdateChecks` / `40`'s
  `useCoachingSynthesis`) that computes the check-in nudge + fires `shouldSuggestChallenge` on launch/focus
  (throttled, per-person, budget/setting-gated). Never a background cron.
- **Stores** — a per-person `challengeStore` (Zustand: catalog of the active person's challenges + the cached
  suggestion; load/start/setStatus/checkIn/suggest) that **resets on `activePerson.id` change** in the AppShell
  reset (the per-person isolation rule, the `20` §5.1 fix). Responsive ~360px→desktop.

### 5.6 What stays shared / unchanged

`@selfos/core/conversations` (`guidedSessionService.ts`, `guidedSteps.ts`, `promptBuilder.ts`,
`chatService.ts`) gains the challenge guide + the `[[SELFOS:CHALLENGE:…]]` marker handling; everything else
(streaming, metering, the 18+ ack, the suggester engine pattern) is reused. The `39` `goalService` +
`summarizeOpenCommitments`, the `40` `coachingSynthesisService` + `CoachingPrefs` + `goal-followup` plumbing,
and the `09` analysis path are **consumed**, not re-implemented.

## 6. IPC / API contracts

Typed channels (`apps/desktop/src/shared`, Zod-validated both sides). All gated by **`challenges.own`** +
**active-person-scoped in the bridge** (the trust boundary — a person can only start/read/act on their own
challenges; a sexual/intimacy challenge's surfaces are withheld for an un-acked person in the bridge, §8.3).
The Claude key stays in main (`00` §6.2). The **metered calls are `challenge.suggest` and any reflection
analysis**; starting a session + status changes + inline outcome are free.

- **`challenges:start({ domain? })`** → `{ conversationId }` — creates the challenge-coach session
  (`startChallenge`), seeds the static opener; gated `challenges.own`, active-person-scoped. (Sexual domain
  requires the 18+ ack, enforced in the bridge.) The co-create then flows over the existing **`chat:stream`**
  (the conversation carries the challenge `guideId`, so host-side prompt assembly + the marker handling pick
  up — **no new streaming channel**; the `Challenge` is created in-process when the marker arrives).
- **`challenges:list()`** → the active person's challenges (own only; the current active + closed), newest
  first. Zod-validated.
- **`challenges:get({ challengeId })`** → one challenge (own only).
- **`challenges:setStatus({ challengeId, status })`** → set `active`/`done`/`abandoned` (the card's I-did-it /
  Let-it-go), own only, scoped in the bridge.
- **`challenges:checkIn({ challengeId, outcome, reflection? })`** → records the inline check-in (§3.5):
  writes `reflection`/`outcome`, sets status, and runs the **reflection → Insight** bridge (§5.4) — metered
  only if it spends (a deterministic outcome-only check-in costs nothing; an AI reflection is `checkBudget →
call → recordUsage`). Typed envelopes for the AI path (`NO_KEY`/`BUDGET`/`AI_OFF`/`ERROR`, the `37`
  taxonomy); the status/outcome always persist regardless.
- **`challenges:suggest({ override? })`** → `ChallengeSuggestionResult` — the proactive suggester (§5.3):
  budget-gated, metered `challenge.suggest`, tolerant-parsed; typed `{ ok: true, suggestion } | { ok: false,
reason: 'NO_KEY'|'BUDGET'|'AI_OFF'|'EMPTY'|'REFUSED'|'TRUNCATED'|'MALFORMED'|'CAPPED'|'ERROR', message }`.
  The renderer cadence hook calls it only when `shouldSuggestChallenge` + budget allow; the explicit-tap "Get a
  challenge idea" forces it (past the throttle, under the per-period cap).
- **`challenges:getSuggestion()`** → the cached `ChallengeSuggestion | null` (no spend) — for re-display.
- **`challenges:delete({ challengeId })`** → remove a challenge (own only); its derived Insight follows the
  Memory delete (`20`/`39`).
- **18+ ack** reuses the existing channel that writes `guidance/prefs.enc adultAcknowledged` (`16`/`18`) — **no
  new ack channel**. **Notification read/dismissed** rides `35`'s `notifications:getState`/`:setState` (the new
  kinds' signatures persist there, per-person/device-local). **Goal seeding** (§11) reuses `39`'s `goals:*` —
  **no new goal channel here.**

**Claude.** Three call sites: (1) the **co-create chat turn** (meters as the existing `chat` type — no new
type; the marker capture is free); (2) **`challenge.suggest`** (a NEW usage type added to `usageTypes.ts`
`USAGE_TYPE_LABELS`, label e.g. "Challenge suggestion") — bounded structured JSON, `extendedThinking: false`
(the `[[adaptive-thinking-shares-maxtokens]]` rule), meter-before-parse, tolerant parse + honest reasons
(`37`); (3) the **reflection analysis** on a check-in — **reuse `session.analyze`** (`09`) rather than adding a
`challenge.analyze`, since a challenge reflection is a session-shaped analysis (recommended, §11; an explicit
`challenge.analyze` is the alternative if the user wants it broken out in the usage dashboard). Admin-$
redaction at the bridge is unchanged (`06`).

## 7. States & edge cases

Per `00` §7, every surface handles loading / empty / error / offline. Specifically:

- **No active challenge / fresh person** → no ChallengeCard, no check-in nudge; the launcher's "Take on a
  challenge" still starts a session; the suggester returns `EMPTY` (silent no-op) if there isn't enough
  material to ground a candidate.
- **AI off / no key / offline** — the **static opener** of a challenge session renders offline; the first
  model-needing turn shows the existing not-configured state (`16` §7). The **suggester** hides/calm-states
  (`AI_OFF`/`NO_KEY`); **status changes + an inline outcome-only check-in still work** (no AI). Per `31` (AI
  required) this is a setup prompt, never a faked experience — a challenge is never silently invented offline.
- **Over budget** — starting a session hits the existing budget gate (`06`); the suggester skips (budget-gated,
  cache shows if any); an AI reflection skips with a calm note (the outcome/status still persist). In-session
  proposing is part of the paid chat turn, unaffected.
- **The person declines / negotiates down to nothing** — no `[[SELFOS:CHALLENGE:…]]` marker → **no `Challenge`
  created**; the conversation is a normal session. This is the expected, common case (a challenge must be the
  person's choice, §8) and must be tested.
- **Challenge abandoned** — "Let it go" → `status:'abandoned'`; it never re-surfaces a check-in (the `39` "let
  it go" precedent).
- **Overdue check-in** — past `checkInAt` surfaces a **gentle** check-in nudge (≤1 open, coalesced, suppressed
  until state changes — §3.5/§3.8), **never a nag**; "Not yet" may shrink the challenge or push `checkInAt`
  out rather than guilt-trip. The cadence is renderer-driven on launch/focus (no cron).
- **Two markers in close succession / an existing active challenge** — the one-active rule (§4.3): the second
  capture doesn't silently spawn a competing active challenge; the coach is steered to complete/replace on the
  person's say-so.
- **Malformed `[[SELFOS:CHALLENGE:…]]` marker** — ignored (tolerant parse, `37`); no `Challenge`, the
  conversation is unaffected; the marker never appears in the visible text (stripped like the `16` step
  marker, partial-mid-stream-safe).
- **Sexual/intimacy challenge when 18+ not acknowledged (the common first state)** — the challenge-coach steers
  away from sexual content (and the suggester filters sexual candidates) until the ack; the
  SuggestedChallengeCard's sexual candidates and any intimacy-challenge surfaces are **withheld in the bridge**,
  not just the UI. Acknowledging once (shared with `16`/`18`/`50`) unlocks them. This **must** be tested with
  the gate **un-acked** (the DoD "test the prerequisite absent" rule), not just post-ack.
- **A challenge that surfaces distress** — the coach + the reflection **lead with care + resources** (§8.2),
  drop the push, and route to professional help; a `crisisFlag` is set on the reflection Insight; the push
  register always yields to safety.
- **Hard-no collision** — if a proposed (or person-floated) sexual challenge touches an item the person rated a
  **hard no** (the `27`/`46` intimacy matrix) or a stated boundary, the coach **never proposes or pushes it**
  (§8.3); the suggester excludes hard-no items from candidate sources.
- **Person switch** — `challengeStore` resets on `activePerson.id` change; a suggestion in flight is discarded;
  the new person's challenges + cached suggestion load (the per-person isolation rule; the `20`/`35`/`17` race
  guard — guard async loads with the active id).
- **Sync conflict / corrupt `Challenge` / suggestion file** — handled by the vault service as today (`00`
  §4.3); a malformed file is Zod-skipped, never crashed/auto-overwritten; surfaced like every other vault file.
- **Migration** — additive-only (`InsightProvenance += challengeId`; `Challenge` + the cached suggestion are
  new types with no prior format); no destructive migration. A pre-52 vault simply has no challenges.

## 8. Safety (required — this feature deliberately PUSHES people)

This is the safety-critical heart of the spec: a coach with **"push and challenge" energy** must challenge the
**comfortable-uncomfortable, never the unsafe**. The boundaries are the established SelfOS ones (CLAUDE.md §1,
`05` §7, `16` §8, `39` §8, `40` §8); the challenge register applies them with extra force, and they **lead
every prompt** (the addendum is appended **after** PERSONA + SAFETY + context).

### 8.1 Not therapy, not medical — and a challenge is always the person's choice

- SelfOS is **wellness/self-help, not medical** — challenges are reflective experiments, **never** a treatment
  plan, exposure-therapy protocol, prescription, or assessment. The challenge-coach addendum **leads** with the
  shared `frame(...)` not-therapy preamble (`guidedCatalog.ts`), and the always-present **CrisisFooter** + the
  not-medical line show on every challenge surface.
- **The coach proposes and negotiates; it never coerces.** A challenge is **always an invitation the person
  accepts, tweaks, or declines** (the `40`/`29`/`15` confirm-before-apply principle). The addendum forbids
  pressure: offer once, shrink/swap on hesitation, respect a "no" or "not now" **immediately**, and never guilt
  or push past a stated boundary. Difficulty is **dialable by the person** (§3.4) — the coach calibrates to
  their comfort, it does not dictate it. No autonomous action is ever taken on the person's behalf (a challenge
  is created only on the person's clear agreement, captured by the marker).
- A challenge that points at something **clinical** (a phobia, addiction, an eating pattern, persistent
  distress) is framed gently and **routes to professional support** (a therapist / appropriate clinician),
  never positioned as treatment — and the coach does **not** design a graded-exposure or recovery protocol.

### 8.2 Crisis routing (unchanged, non-negotiable)

Pushing into discomfort can surface acute distress. Crisis handling is unchanged (`05` §7 / `09` §7): warmth,
take it seriously, route to professional/emergency help, never manage a crisis alone — and the push **always
yields** to it. Specifically: if the person expresses distress while co-creating or reflecting, the coach
**drops the challenge entirely and responds with care**; a crisis-adjacent reflection sets the Insight's
`crisisFlag` and makes the surface **lead with resources**; the SAFETY crisis instruction leads every prompt
and the challenge addendum **reinforces, never weakens** it. A challenge is **never** proposed as a way to
"push through" a crisis.

### 8.3 Sexual / explicit challenges — consent, hard-nos, partner buy-in, in-policy

Sexual/intimacy challenges are **adult content** and the most safety-sensitive. The boundary (stated **verbatim
in intent** in the addendum, gated by the existing 18+ ack `16` §8.3, never a keyword filter):

- **Consensual adults only, within Anthropic's usage policy.** Taboo content **only** as fantasy/roleplay
  (e.g. consensual non-consent as pre-agreed roleplay); **NEVER** minors, real (non-roleplay) non-consent, or
  illegal acts (the `27` §14.5 / `08` §16.5 boundary). The shared `SAFETY` prefix is **not** loosened; only the
  addendum gains the explicit register, in the `08` §16.5 sexual-wellness framing. A model refusal degrades to
  the normal chat handling (`05`/`37`) — never circumvented, never a canned-explicit fallback.
- **Respect hard-nos absolutely.** The coach **never proposes or pushes** anything the person rated a **hard
  no** on the intimacy matrix (`27`/`46`) or has stated as a boundary; the suggester **excludes hard-no items**
  from candidate sources (it draws from a person's interests/"Maybe" items `48`/`50`, not their nos). A "Maybe"
  may be **gently invited** as a challenge; a "No"/hard-no is off-limits.
- **Trauma-aware.** Sexual challenges commonly intersect shame, trauma, or assault history. If that surfaces,
  the coach **slows down, validates, stops pushing, and routes to professional support** (a sex therapist /
  therapist / crisis line) — never frames trauma as kink, never treats a disclosed assault as an erotic topic
  (§8.2).
- **Partner buy-in for partnered acts.** A sexual challenge that **involves a partner** (initiating, trying a
  new act, sharing a fantasy) is framed to **require the partner's consent + enthusiasm** — the coach steers
  toward conversation, negotiation, and a real yes, **never** pressuring either person, and never assumes a
  partner who isn't there (a single person gets a solo/self-understanding framing, the `48` §7 fallback). How
  the partner actually coordinates (in-app vs offline) is a §11 open question; v1 it is conversational +
  existing relationship-scoped sharing (`42`/`44`), with sensitive facts excluded from others' context.

### 8.4 Privacy & honesty

- **Self-only + own-context.** A challenge is the person's own data (the conversation, the `Challenge`, the
  reflection Insight), encrypted under their own folder, feeding only their **own** context. The bridge is the
  trust boundary (active-person scope + the 18+ gate). The **suggester** sends only **structured context**
  (insight summaries/facts + open goals + test profiles, behind the shareable/restricted/flagged filters) to
  Claude — **never raw transcripts** (the `08`/`09`/`40` boundary).
- **Sexual challenge facts are `restricted`** (§4.4) — own-context-only, relevance-gated, **never broadcast**,
  never in another person's context (the `18` §8.4 / `50` §8.3 rule).
- **Never naggy, never surveilling.** A coach that nudges you to change must never feel like a taskmaster or a
  watcher: ≤1 open challenge nudge, a gentle check-in register ("totally fine — want to make it smaller?"), a
  real **off** switch (the `40` `coaching.proactivity`), warm low-pressure copy. Tie to the wellness
  positioning. **No copy may imply an owner/admin can see a person's challenges** (the durable rule, CLAUDE.md
  §1).
- **Honest, calm signals** — a failed suggester pass is a silent no-op (a background nicety); tolerant-parse +
  honest reasons (`37`) mean we never blame the user's data for a model hiccup. A challenge is offered as an
  invitation, never a verdict on the person.

## 9. Accessibility

Per [`01`](01-design-system.md) §9 and inheriting `16`/`35`/`17`:

- The launcher's "Take on a challenge" entry, the ChallengeCard actions (I did it / Not yet / Reflect / Check
  in), the comfort dial, the suggested-challenge card (Get a challenge idea / Accept / Tweak / Dismiss), and
  the inline check-in are **real buttons/controls** with accessible names, keyboard-operable, with **visible
  focus**. The challenge **status** is conveyed as **text + a non-color-only chip** (not color alone, the `39`
  `GoalStatusChip` precedent); the **comfort** level is text + a non-color-only control.
- The co-create + reflection conversations reuse the Sessions chat a11y (`05`); the produced "Challenge set ✓"
  confirmation and any reflection summary are a **polite live region** (`role="status"`); the crisis-lead is
  announced.
- The new notification kinds inherit `35` a11y (keyboard-navigable center, `aria-live` toasts, labelled
  actions, non-color-only icons, reduced-motion); Home cards inherit `17` a11y (labelled regions, logical
  heading order).
- Responsive ~360px→desktop: cards/nudges reflow, the launcher works in the master-detail Sessions layout
  (`02` §3.4), **no horizontal scroll** (CLAUDE.md §12 — a status filter is a full-width control, not a
  scrolling chip row; tested §10). Reduced-motion respected. Any genuinely-new primitive (a comfort dial) →
  `/gallery` (DoD §12).

## 10. Testing strategy

Per the DoD (CLAUDE.md §7). Vault via the in-memory `memFileSystem` fake; Claude via the deterministic fake
`ClaudeClient` (`SELFOS_FAKE_CLAUDE`) — **made imperfect where it must exercise salvage/markers** (the
fakes-must-exercise-the-real-path rule); **decrypt the vault** to assert data, not just the UI; run `pnpm
typecheck` after tests (memory `vitest-does-not-typecheck`).

**Unit (core)**

- **`challengeService` lifecycle:** `startChallenge` stamps the `challenge-coach` `guideId` + seeds the static
  opener + rejects an unknown domain; `setChallengeStatus`/`recordCheckIn` transition status + write
  `reflection`/`outcome`; `activeChallenge` returns the one active; the **one-active de-dup** (a second capture
  with an active challenge doesn't spawn a competing one, §4.3); `markStaleCheckIns` derives "check-in due"
  from `checkInAt`.
- **Marker capture (`guidedSteps.ts`):** `parseChallengeMarker` extracts the agreed `{action,comfort,lifeArea,
checkInDays}`; `stripChallengeMarker` removes it (and a **partial mid-stream** marker) from saved + streamed
  text so it never flashes; a **malformed** marker yields no challenge (tolerant, `37`); `lifeArea` is
  normalized to `LIFE_AREAS`, `comfort` clamped 1–5.
- **Reflection → Insight (§5.4):** a check-in produces an `Insight` (`source:'session'`, `approved:true`,
  `provenance.challengeId`); a **sexual** challenge's reflection facts are **`restricted`** (assert restricted +
  own-only); a re-check-in reuses `insightId`; **meter-before-parse** on the AI reflection path.
- **The suggester (`challengeSuggestService`):** `suggestChallenge` gathers a transcript-free digest (assert the
  prompt carries summaries/facts/goals, **never a transcript**), validates the candidate (`37` tolerant: only
  `action` required), meters `challenge.suggest`, caches; `shouldSuggestChallenge` triggers only with no active
  challenge + within the cadence/cap + level ≠ `off`; **sexual candidates are filtered until the 18+ ack** and
  **hard-no items are excluded** from candidate sources; `EMPTY`/`NO_KEY`/`BUDGET`/`AI_OFF`/`CAPPED` reasons.
- **The followup-plumbing reuse:** the `challenge-followup` derived source computes a nudge from `checkInAt`
  (≤1 open, `onChange` re-surface), mirroring the `40` `goal-followup` source — assert it coalesces and
  suppresses after an action (the `35`/`40` re-surface rule).
- **Privacy regression** (the `20` slice-1 / `15` §10 style): a challenge never surfaces another subject's
  data; the suggester runs behind `feedableInsights`'s restricted/flagged/muted boundary; sexual reflection
  facts are absent from any other person's `buildContext` (decrypt-assert).

**Component (Vitest + RTL)**

- The launcher renders the "Take on a challenge" entry; the **ChallengeCard** renders an active challenge with
  status chip + comfort dial + I-did-it/Not-yet/Reflect (and Check-in once due); the **SuggestedChallengeCard**
  explicit-tap → AI-off/over-budget calm states (no dead button) + Accept/Tweak/Dismiss; the inline check-in
  records an outcome; the closed/"Past challenges" section; the **18+ gate** hides sexual challenge surfaces
  un-acked.

**E2E (Playwright + Electron, `SELFOS_FAKE_CLAUDE`)**

- **The full loop:** open Sessions → start a Challenge session → the static opener renders → a steered turn
  proposes (fake coach) → the person agrees → the fake coach's `[[SELFOS:CHALLENGE:…]]` marker is **stripped
  from the visible text** and a `Challenge` is **created** (decrypt the vault: `status:'active'`, the agreed
  `action`/`comfort`, `provenance.challengeId` wiring) → it **appears tracked** on the ChallengeCard → **check
  in** ("I did it" + a reflection) → a reflection **Insight feeds a later session's `buildContext`** (decrypt)
  and the challenge moves to `done`.
- **The person declines** → no marker → **no `Challenge`** (the common, expected path).
- **The 18+ gate** (the §7 prerequisite-absent case): with the ack un-acked, sexual challenge surfaces /
  suggestions do **not** render and are **not** suggested; acknowledging reveals them.
- **The proactive suggester** fires on the trigger condition (seed insights/goals → app event →
  `challenge.suggest` usage event recorded), skips over budget, and the explicit-tap forces it under the cap.
- **The safety/consent guardrail in the addendum is asserted** — a core test on the `challenge-coach`
  `systemPromptAddendum` confirms it states the **not-therapy boundary**, the **consent/never-coerce/respect-a-
  no** instruction, the **hard-no** instruction (the intimacy matrix), the **partner-buy-in** instruction for
  partnered sexual acts, and that crisis/distress **drops the challenge and routes to resources** — and that
  `buildSystemPrompt` appends it **after** PERSONA + SAFETY + context (the boundary leads, reusing the `16`
  addendum-ordering assertion with the challenge `guideId`).
- **Layout** — a **~360px no-overflow / inner-scrollbar guard** on the launcher (with the challenge entry), the
  ChallengeCard, and the SuggestedChallengeCard, + the comfort-dial control geometry, so the surfaces don't
  overflow a narrow pane.

## 11. Open questions

LIST — never silently assumed; resolve with the user before building. (The locked decisions — tracked entity
with follow-up, both initiators, a new `Challenge` entity reusing the goal-followup plumbing — are recorded in
§12 and are **not** re-opened here.)

1. **Naming.** **Challenges** (working title) vs **Experiments** vs **Practices** vs **Quests** vs **Missions**
   (or another). This is the user-facing word on the launcher, the cards, the notification, and the entity — it
   sets the whole register (playful "Quests/Missions" vs grounded "Experiments/Practices" vs the neutral
   "Challenges"). _Recommendation: "Challenges" (clear, motivating, not gamified-sounding) — confirm._
2. **Reflection Insight source.** **`source: 'session'` + `provenance.challengeId`** (recommended, §4.4 — a
   challenge reflection is a session-shaped reflection; no consumer branches on `source`, so a new enum value
   buys nothing) **vs a new `'challenge'` `InsightSource`** (a cleaner provenance label but touches every
   consumer + the enum-widening migration, for display only). _Recommendation: reuse `'session'` + the
   provenance — confirm._
3. **How aggressively the coach pushes — a tone/intensity dial.** Fold push intensity into the existing `40`
   per-person `coaching.proactivity` (`off`/`gentle`/`active`, recommended §4.5) — or a **separate**
   challenge-specific intensity control (some want a quiet tool that never challenges but a chatty coach, or
   vice-versa)? And what's the **default** (candidate: `gentle`)?
4. **Streaks / gamification.** Do challenges get **streaks / points / badges / a completion count** (motivating
   for some, pressuring/anxiety-inducing for others and at odds with the gentle, not-naggy register)? v1
   models **no** streak data (§2 non-goal) — confirm we keep it out, or add a light, opt-in completion count.
5. **Check-in cadence default.** What's the default `checkInDays` when the coach doesn't set one from the
   conversation (candidate: **7 days**)? And the cadence-hook throttle for the **proactive** suggested-challenge
   card (candidate: the `40` weekly-ish window + per-period cap)?
6. **Does a completed challenge auto-seed a `39` `Goal`?** A successful habit/standing challenge naturally
   becomes an ongoing goal (`seededGoalId`, §5.4) — **auto-seed** (low friction, but creates a goal the person
   didn't explicitly ask for), **offer to** ("turn this into an ongoing goal?"), or **never** (keep challenges
   and goals fully separate)? _Recommendation: **offer to** (confirm-before-create, the SelfOS pattern)._
7. **How a sexual challenge coordinates with a partner.** v1 it's **conversational + existing relationship-
   scoped sharing** (`42`/`44`), with sensitive facts excluded from others' context (§8.3). Is that enough, or
   is there an explicit **in-app** partner-coordination surface wanted later (e.g. a shared "we agreed to try
   X" — which would make a challenge cross-person, a §2 non-goal)? _Recommendation: conversational/own-only
   v1; an in-app couple-challenge is a future spec._
8. **Build slices.** _Recommendation:_ **Slice A** — the session + entity + co-create + marker capture +
   commit + the tracked ChallengeCard (the core loop works end-to-end; person-initiated only). **Slice B** —
   the follow-up/check-in flow + the reflection → Insight + the proactive `challenge.suggest` suggester + the
   `challenge-followup`/suggested nudges + coordination. (Slice A is independently shippable and valuable;
   Slice B adds accountability + the app-initiated path. Confirm the split.)

## 12. Changelog

- 2026-06-25 — created (Draft). Defines a **Challenge / experiment** session type: the AI proposes a grounded
  stretch action, the person + coach co-define it conversationally, it becomes a tracked **`Challenge`** entity
  (new, not a `Goal`) with a lifecycle + follow-up check-ins + a reflection that feeds an Insight and seeds the
  next. **Locked decisions (§2/§5/§6):** (1) **tracked with follow-up** — a co-created challenge persists with
  a lifecycle and the app checks in later, **reusing the spec-40 goal-followup notification/nudge plumbing**;
  (2) **both initiators** — the person launches a Challenge session any time AND a metered, explicit-tap
  `challenge.suggest` surfaces a suggested challenge from their data/tests (no silent spend, the
  guided-suggester precedent); (3) a **new `Challenge` entity** (reuse the followup plumbing, not the `Goal`
  schema; a completed challenge may inform/seed a `39` Goal). Grounded against `guidedSessionService.startGuided`
  - `guidedSteps.ts` (the `[[SELFOS:STEP:n]]`/wrap-up marker convention reused for `[[SELFOS:CHALLENGE:…]]`),
    `goalService` + `summarizeOpenCommitments` (`39`), `goalRaiseInstruction` + `coachingSynthesisService` + the
    `goal-followup` kind/`GoalFollowupCard` (`40`), and `sessionAnalysisService` (`09`, the reflection → Insight
    model). Additive schema only (`Challenge` + `InsightProvenance.challengeId`; `InsightSource` unchanged —
    challenge reflections are `source:'session'` with a challengeId). Strong §8 safety core: push the
    comfortable-uncomfortable, never the unsafe — consent, hard-nos (the `27`/`46` intimacy matrix), trauma
    boundaries, partner buy-in, crisis-yields, the coach proposes-never-coerces. Open questions (§11): naming,
    the reflection Insight source, push-intensity dial, streaks/gamification, check-in cadence default,
    auto-seed-a-goal, partner coordination, and the A/B build slices — to resolve with the user before building.

---

## Relationship to other specs / whole-app fit

Challenges are the **behavioral / accountability** layer that **closes the loop** from "the app knows me" to
"the app helps me change" — the action surface the rest of SelfOS has been building toward:

- **Consumes Goals (`39`)** — open commitments (`summarizeOpenCommitments`) are a prime source for a grounded
  challenge ("you've wanted to finish X — here's one small step this week"), and a completed habit challenge can
  **seed a Goal** (§11), so the two are complementary, not redundant: a goal is a standing intention, a
  challenge is a time-boxed experiment toward it.
- **Consumes proactive coaching (`40`)** — it **reuses the goal-followup notification/nudge plumbing** (a new
  `challenge-followup` kind + a Home `ChallengeCard`), the `coachingSynthesisService` suggester pattern (the
  `challenge.suggest` pass), and the per-person `CoachingPrefs` (push intensity), so challenges coalesce with
  goal/synthesis/freshness nudges through one coherent surface (`35`/`17`) and never spam.
- **Consumes the intimacy arc (`48`/`49`/`50`)** — sexual/intimacy challenges draw on the intimacy guided
  sessions (`48`, e.g. a Yes/No/Maybe "Maybe" or a completed exercise's Insight), the expanded intimacy
  inventory (`49`), and the kink/sexuality **test profiles** (`50`) — within the consensual-adult boundary,
  behind the **shared 18+ ack** (`16`/`18`/`48`/`50`), and **strictly respecting hard-nos** (the `27`/`46`
  matrix) + partner consent. Because a test result and a guided-session Insight are ordinary Insights, the
  suggester reads them as structured signal with no special plumbing.
- **Is a normal `05`/`09` session under the hood** — so a challenge session inherits **everything**: per-person
  isolation, metering/budgets (`06`), the living-memory loop (`39`), the always-present CrisisFooter + the
  not-medical boundary, relationship-scoped sharing of any derived fact (`42`/`44`, sensitive facts excluded),
  and rich-text rendering (`34`). The only additive machinery is the `Challenge` entity, one provenance field,
  a code-only challenge-coach prompt, a `[[SELFOS:CHALLENGE:…]]` marker that costs nothing extra, the
  `challenge.suggest` pass, and the reused followup plumbing — keeping with the SelfOS discipline of **adding a
  feature, not expanding the machinery**.
