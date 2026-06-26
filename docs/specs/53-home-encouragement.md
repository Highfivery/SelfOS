# 53 — Home dashboard uplift & personalized encouragement engine

> **Status:** Slice A Built · §11 resolved · _last updated 2026-06-25_
>
> The Home dashboard ([`17`](17-home-dashboard.md)) has accreted ~10 stacked cards (crisis banner, welcome,
> onboarding, freshness, depth, discovery nudge, then a grid of continue/suggestions/goal/wellbeing/insight/
> dreams/memory/inbox) bolted on slice by slice — capable but no longer cohesive. This **capstone** spec
> redesigns Home to be sleeker, warmer, and motivating, **and** adds a per-person **recommendation /
> encouragement engine** — a "Your next step / For you" layer that surfaces and gently ENCOURAGES the right
> action from the person's real data (a coaching session, a guided/intimacy session, a self-assessment, a
> challenge, a wellbeing check-in, logging a dream, refreshing memory, answering a questionnaire) and
> **celebrates progress** when they do it. It is the motivational surface that turns "the app knows me and has
> these tools" into "I'm actually doing the work."

This **extends, reconciles, and refactors** the existing Home/proactive/discovery surfaces — it does **not**
duplicate them. It consumes and re-homes: [`17`](17-home-dashboard.md) (the Home dashboard + cards, composed
on the renderer from per-person stores), [`40`](40-proactive-coaching.md) (the `coaching.proactivity` dial,
the `GoalFollowupCard` / `InsightOfTheWeekCard` / `CrisisSupportBanner` + `aggregateCrisisSignal`),
[`41`](41-discoverability-and-empty-states.md) (`AiUnavailableNotice`, empty states,
`WelcomeOrientationCard`, `OneTimeTip`, the device-local per-person `discovery:*` dismissal seam), and
[`35`](35-notification-system.md) (the coalesced notification surface; Home stays primary, no double-notify).
It **surfaces/encourages** the new feature set the 2026-06 batch adds — [`48`](48-intimacy-guided-sessions.md)
(intimacy guided sessions), [`50`](50-self-assessments.md) (self-assessments "Tests" + the "You" hub),
[`51`](51-wellbeing-neurodivergence-reflections.md) (wellbeing/neurodivergence check-ins),
[`52`](52-challenge-sessions.md) (challenge sessions) — and the inventory backing them
([`49`](49-intimacy-activities-inventory.md)). The recommendation **registry** mirrors the context-provider
registry (`packages/core/src/questionnaires/contextProviders.ts`). References [`00`](00-architecture.md) /
[`01`](01-design-system.md) (vault/IPC/security; primitives + tokens), [`06`](06-ai-usage-and-budgets.md)
(metering), [`16`](16-guided-sessions.md) (guided sessions + `suggestGuidedSessions`),
[`08`](08-questionnaires.md) (the gap-finder), [`39`](39-living-memory-continuity.md) (goals),
[`04`](04-people-roles.md) (active person, capabilities), and [`05 §7`](05-conversations.md) (the safety
boundary) — rather than restating them (DRY).

---

## 1. Overview

SelfOS has reached a turning point: the **breadth** is here (sessions, dreams, questionnaires, guided +
intimacy sessions, tests, wellbeing check-ins, challenges, goals, memory) but the **front door** doesn't yet
help a person _choose_ and _stay motivated_. Two problems compound on Home today:

1. **The dashboard is no longer cohesive.** `Home.tsx` renders ~6 stacked cards above the grid (crisis,
   welcome, onboarding, freshness, depth, discovery) followed by an 8-card grid (continue, suggestions,
   goal-followup, wellbeing, insight-of-the-week, dreams, memory, inbox). Each landed in its own slice (17, 29,
   40, 41) and reads as an accretion, not a designed whole. There is no single, warm "what should I do next?"
   focal point — the actionable signals (resume a session, a guided suggestion, a goal check-in, the
   synthesis observation, the discovery nudge) are scattered across distinct components with overlapping
   purposes.
2. **There is no encouragement layer.** Spec 40 makes the coach proactive _inside_ a session and surfaces a
   couple of nudges; spec 41 makes empty states actionable. But nothing **draws on the person's whole data to
   recommend the single most relevant next action across all features**, and nothing **celebrates** when they
   do it. A person who finished onboarding, took one test, and has a stale goal gets no warm "here's a good
   next step for you" — they get a wall of self-hiding cards.

This spec adds two tightly-coupled things:

- **A Home visual/structural redesign** — a warm personalized greeting + a gentle **momentum reflection**
  ("you've shown up 3 times this week", "you've explored 4 areas"), a single prominent **"Your next step /
  For you"** recommendation section, the existing feature cards **reorganized into a clean hierarchy** (a
  concrete before→after card map, §3.6), warm **completion/celebration** moments, and first-run + empty states
  reconciled with spec 41. Responsive ~360px→desktop, on the SelfOS UI bar (CLAUDE.md §12).
- **A recommendation / encouragement engine** — a **recommendation registry** (each feature module registers
  its recommendable actions) + a **deterministic ranking engine** that gathers candidates, scores them by
  relevance + recency/staleness, respects the proactivity level + capabilities + the 18+ gate, dedupes, and
  renders the top N as "For you" cards. **No per-load AI spend** — recommendations are derived on the renderer
  from data Home already holds, exactly like the rest of Home (17 §4). The one AI observation
  (`InsightOfTheWeekCard`, spec 40) stays **explicit-tap** and is **woven into**, not replaced by, this layer.

**Whole-app fit.** This is the surface that makes every other feature discoverable and motivating: it is where
a session, a dream, a questionnaire, a test, a challenge, intimacy work, a goal, and memory all become a single
"here's where you are, and here's a good next move." It is also the **early UI/UX win** that lifts the app's
overall feel — which is why Slice A (the visual uplift + the engine over **existing** features) ships **before**
specs 48–52, improving discovery of current features now; as 48–52 land, each registers its recommendable
actions and the engine surfaces them automatically (Slice B, §11.1).

## 2. Goals / Non-goals

**Goals**

- **A redesigned Home** — a warm personalized greeting, a gentle momentum reflection, a single **"Your next
  step / For you"** recommendation section, the existing feature cards reorganized into a clean visual
  hierarchy (§3.6 before→after map), warm completion/celebration moments, reconciled first-run + empty states.
  Sleek, intentional, never bolted-on (CLAUDE.md §12); responsive ~360px→desktop.
- **A recommendation registry** — a `packages/core` registry (the `contextProviders.ts` pattern) where each
  feature module registers recommendable actions `{ id, label, reason, route, capabilityGate, adultGate?,
relevance(personState) }`; adding a recommendation = registering a candidate, not editing Home.
- **A deterministic ranking engine** — gathers candidates, ranks by relevance + recency/staleness, respects
  the **proactivity level** + **capabilities** + the **18+ gate**, dedupes, returns the top N "For you" cards.
  **Pure, unit-testable, no AI, no per-load spend.**
- **Light momentum, never punishing** — reflect gentle progress/momentum ("you've shown up 3 times this week",
  "you've explored 4 areas"), warm completion moments — with **NO streak-loss guilt, NO pressure mechanics**,
  especially around wellbeing. Autonomy-supportive (self-determination theory: support autonomy / competence /
  relatedness; invite, never demand).
- **Reuse the proactivity dial** — encouragement intensity tracks the existing per-person `coaching.proactivity`
  (`off` / `gentle` / `active`, spec 40 §3.6) — **no new setting**. `off` = a calm Home with no pushes;
  `gentle` = a few invitations; `active` = more.
- **Reconcile, don't duplicate** — the spec-40 goal-followup / synthesis cards + the spec-41 discovery nudge +
  the spec-29 freshness/depth cards are **absorbed into the engine's "For you" section** under one coherent
  ranking (§3.6), so the same concern never appears twice and Home stops being a stack of overlapping cards.
- **Safety-first encouragement** — encouragement **de-escalates** when the person is struggling: a recent
  crisis flag / low-wellbeing signal (spec 40 `aggregateCrisisSignal`) suppresses pushy nudges and leads with
  support (`CrisisSupportBanner` always supersedes). `proactivity:off` ⇒ no pushes at all. The not-medical line
  stays. **Challenges (spec 52) own the consent-bound "push"; Home only invites.**
- **Additive & safe** — no new vault schema if avoidable (momentum/recommendations are **derived**); only
  device-local celebration/dismissal state, reusing the spec-41 `discovery:*` seam. No new AI spend. Per-person
  isolation; the bridge stays the trust boundary.

**Non-goals (deferred / owned elsewhere)**

- **A new AI pass / new spend.** Recommendation ranking + momentum are deterministic. The one AI observation
  (spec-40 synthesis, `coaching.synthesize`) is reused unchanged and stays explicit-tap; no new usage type.
- **Producing the underlying signals.** This spec **surfaces** goals (39), insights/mood (09/20), dream
  patterns (12), inbox (08), test profiles (50), challenges (52). It defines no new producer, no new analytics
  metric — it reads what those specs emit (the 17 discipline).
- **The consent-bound behavioral push.** Challenge sessions (52) own "propose a stretch action + accountability
  - check-ins." Home only **invites** a person to start one; it never imposes a challenge.
- **Streaks / gamification / scores.** No streak counters, no streak-loss, no points, no leaderboards, no
  badges that can be "lost," no daily-goal pressure. Momentum is a gentle reflection, never a target (§8).
- **OS-level / push / scheduled nudges.** In-app only (35 non-goal). Any cadence is renderer-driven on app
  events (the spec-36/40 pattern) — never a main-process cron.
- **Configurable / rearrangeable cards** (drag-to-reorder, hide-a-card) — a designed, sensible hierarchy for
  v1 (17 non-goal carries forward); user customization is a later enhancement.
- **Cross-person / household rollups on Home** — Home is the active person's own overview (17 non-goal). The
  engine is single-subject; per-person isolation throughout.
- **Re-architecting the shell/settings/notifications.** Reuses the existing chrome (02/03/35); adds Home
  content + a core registry, not new chrome.

## 3. UX & flows

> Naming ("For you" / "Your next step" / "Momentum" / "Your path"), how many recommendations to show at once,
> whether phrasing gets any AI personalization, exactly how momentum is reflected, whether celebration is
> transient or persists, and how aggressively to suppress after a crisis are **open** (§11). This section
> describes the intended experiences so the open questions are concrete; working names are placeholders.

### 3.1 The redesigned Home, top to bottom

Home is the active person's own overview at `/`. The redesign keeps the per-person, renderer-composed,
each-card-self-hides model (17 §1) but imposes a clear vertical hierarchy instead of a stack of peers:

1. **Header — a warm personalized greeting + momentum reflection.** The existing time-of-day + name greeting
   (`greeting.ts`) stays, and the one-line status line (`buildStatusLine`) is **upgraded into a gentle
   momentum reflection** (§3.3): "Good evening, Ben — you've shown up 3 times this week" / "you've explored 4
   areas of yourself so far." Degrades to just the greeting when there's nothing notable. **Never** a streak,
   a target, or a "you missed a day."
2. **Crisis / support (supersedes everything).** When `aggregateCrisisSignal` reports recurring distress (40
   §3.5), the **`CrisisSupportBanner`** leads, resources-first — above any greeting flourish, any "For you"
   section, any celebration. Pushy nudges are suppressed (§8). This is unchanged spec-40 behaviour, just given
   the explicit top slot.
3. **"Your next step / For you" — the recommendation section (the new focal point).** A small, prominent
   section of the **top N ranked recommendations** (§3.4/§5) — the single most relevant next actions drawn from
   the person's data across all features. Each is a calm, inviting card with a **reason** ("Your 'finish the
   project' goal has been quiet for a while", "You took the Big Five — a guided session could build on it",
   "It's been a couple of weeks since a wellbeing check-in"), one **primary action** (a real route/CTA), and a
   gentle invitation tone. This section **absorbs** the scattered actionable cards (goal-followup, synthesis,
   discovery nudge, freshness/depth — §3.6) into one ranked place. **Hidden entirely when `proactivity:off`**
   or when there's nothing worth recommending (§7).
4. **The overview grid — "where you are."** The remaining feature cards, reorganized into a clean,
   density-aware grid (§3.6): Continue (resume a session), Wellbeing (the mood trend), Dreams (recent + a
   pattern highlight), Memory (what the coach knows), the "You" hub highlight (recent test results, when 50
   lands), Inbox. These are **status/overview** surfaces (look at where I am), distinct from the **actionable**
   "For you" section (do a next thing). Each self-hides when empty.
5. **Celebration (transient or a brief card — §11).** When the person completes something meaningful (finishes
   onboarding, completes a session + summary, takes a test, finishes a challenge, marks a goal done), a warm
   **completion moment** acknowledges it (§3.5). It celebrates **effort and growth**, never a streak.
6. **Getting-started (brand-new person).** A brand-new active person sees the warm **getting-started** state
   (a few primary actions) instead of a grid of empties (17 §3.2 / 41), reconciled so the engine doesn't also
   push "For you" cards on top of it (§3.6/§7).
7. **First-run orientation + footer.** The `WelcomeOrientationCard` (41 §3.5) appears once and the
   `CrisisFooter` + not-medical line are always present (the wellbeing-surface rule, 17 §7 / 05 §7).

### 3.2 The "For you" recommendation card

Each ranked recommendation renders as one calm card with a consistent shape:

- An **icon** for its domain (session / guided / intimacy / test / challenge / wellbeing / dream / memory /
  questionnaire), a short **label** ("Continue your guided session", "Try the attachment reflection", "Get a
  challenge idea", "A gentle wellbeing check-in"), a one-line **reason** drawn from the person's real state
  (the registry's `reason`, §5.1) so it reads as _for them_, and **one** primary action (route/CTA).
- **Invitation tone, never a demand.** Copy is warm and low-pressure ("when you're ready", "if it feels
  right", "no rush") — autonomy-supportive (§8). A recommendation is a suggestion the person takes or ignores;
  ignoring it is fine and never produces guilt or a "you skipped this" signal.
- **Dismissible (gentle).** A person can dismiss a "For you" card ("not now"); it suppresses that
  recommendation for a quiet period and doesn't re-nag (the device-local per-person dismissal, §4 / 41 §3.2
  precedent). Dismissal is calm, never framed as a loss.
- **Capability + 18+ gated.** A recommendation for a feature the person lacks the capability for (e.g.
  `questionnaires.create`) or hasn't acknowledged 18+ for (intimacy/sexual challenges, 16 §8.3 / 48 / 52) is
  **never shown** — the ranking engine filters it out (§5.2), so there are no dead CTAs and no surfacing of an
  18+ affordance to someone who hasn't opted in.

### 3.3 Momentum reflection (gentle, never a streak)

Momentum is a **reflection**, not a metric or a target. It is derived deterministically from data Home already
holds (sessions, dreams, test results, goals, insights — §5.3) and surfaced as a single warm line (and
optionally a small at-a-glance element, §11). Candidate reflections (final phrasing + exact set are §11):

- **Showing up** — "you've shown up 3 times this week" (count of sessions/check-ins/dreams in a rolling
  window). **Never** "you missed 4 days," never a streak count that can break.
- **Breadth/exploration** — "you've explored 4 areas of yourself" (distinct life-areas / feature domains the
  person has engaged). A growth reflection, not a completion target.
- **Progress on commitments** — "2 goals moving forward" (open/in-progress goals touched recently, 39). Never
  "1 goal overdue" as a guilt line — a stale goal becomes a gentle "For you" check-in invitation (§3.6), not a
  red badge.
- **Quiet weeks are fine** — when there's been little activity, momentum **degrades to nothing** (just the
  greeting) or a warm, pressure-free line ("good to see you"). It **never** scolds, counts a gap, or implies
  the person fell behind. This is a hard constraint (§8).

**CONFIRM (open, §11): no streaks, no loss, no targets.** Momentum reflects what _has_ happened positively; it
never tracks or displays what _didn't_ happen.

### 3.4 The "For you" section content & ordering

The section shows the **top N** ranked recommendations (N is §11; candidate 1–3). Ordering is the engine's
deterministic ranking (§5.2):

- **Relevance** — how well the recommendation fits the person's current state (a stale goal scores higher than
  a generic "try a test"; a test result that unlocks an intimacy exercise scores higher than an untargeted
  guided suggestion). The registry's `relevance(personState)` returns a score; higher = more relevant.
- **Recency / staleness** — a quiet-for-a-while goal, an analysis that's gone stale, a wellbeing check-in
  that's overdue _by the gentle window_ (not a deadline) score up; something just done scores down (so the
  person isn't immediately re-nudged about it).
- **Variety** — the top N shouldn't be three of the same kind; a light de-dup keeps the set varied (e.g. one
  goal nudge + one growth invitation + one wellbeing check-in, not three goal nudges — §5.2).
- **Proactivity-scaled count** — `gentle` shows fewer (candidate 1–2), `active` shows more (candidate up to 3);
  `off` shows the section not at all (§3.7).

### 3.5 Celebration / completion moments

When the person completes something meaningful, Home acknowledges it warmly — celebrating **effort and growth**,
never a streak or a score:

- **What counts** — finishing onboarding (the portrait), completing & summarizing a session (09 §14), taking a
  test (50), finishing a challenge (52), marking a goal done (39). (The exact set is §11.)
- **Form (§11)** — either a **transient toast** ("Nice — you completed your first guided session" via the
  spec-35 `Toast` primitive / success severity) or a **brief, dismissible card** at the top of Home that fades
  as the next visit's recommendations take over. The trade-off (transient = lighter, won't linger; persistent =
  more visible, can feel like a to-do) is a §11 decision.
- **Tone** — warm, specific to what they did, forward-looking ("that's a real step"), and it may gently hand
  off to a next "For you" recommendation ("want to build on it?") — but never demands one.
- **De-escalates with crisis.** A celebration **never** shows above or instead of the `CrisisSupportBanner`
  (§8) — during a distress moment Home leads with support, not confetti.
- **Once, per-person, per-device.** A given completion is celebrated **once** (its signature recorded in the
  device-local per-person dismissal store, §4 / 41 §3.2), so re-visiting Home doesn't re-celebrate.

### 3.6 Card reconciliation — the concrete before → after map

Home today renders these (from `Home.tsx`); the redesign re-homes each into the new hierarchy so nothing
duplicates. **This is the load-bearing reconciliation** — the engine must absorb the scattered actionable
cards, not sit alongside them.

| Today (component)                         | Role          | After (in the redesign)                                                                                                                              |
| ----------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CrisisSupportBanner` (40)                | safety        | **Unchanged**, given the explicit top slot (§3.1.2) — always supersedes everything.                                                                  |
| greeting + `buildStatusLine` (17)         | header        | **Upgraded** into greeting + momentum reflection (§3.3).                                                                                             |
| `GoalFollowupCard` (40)                   | actionable    | **Absorbed** into a "For you" recommendation candidate (`goal-followup` source) — ranked, ≤1, coalesced.                                             |
| `InsightOfTheWeekCard` (40 synthesis)     | actionable/AI | **Surfaced in "For you"** as the one AI observation (explicit-tap to generate; cached re-display). §3.8.                                             |
| `DiscoveryNudge` (41)                     | actionable    | **Absorbed** — its "explore X" items become recommendation candidates (guided/dreams/questionnaire).                                                 |
| `ProfileFreshnessCard` (29)               | actionable    | **Absorbed** into a "For you" candidate ("refresh your portrait") when the portrait is stale.                                                        |
| `DepthInvitationCard` (29)                | actionable    | **Absorbed** into a "For you" candidate ("go deeper on X") — coalesced with synthesis for the same area.                                             |
| `OnboardingCard` (18 §15)                 | status/action | **Stays as a status surface** while onboarding is incomplete (a "continue your intake" recommendation when stale); self-hides when complete + fresh. |
| `ContinueCard` (17)                       | status/action | **Stays in the overview grid** (resume a session) **and** seeds a top "For you" item when a session is open.                                         |
| `SuggestionsCard` (17/16 + 08 gap-finder) | actionable/AI | **Folded into "For you"** — guided suggestions + a questionnaire-worth-sending become candidates (explicit-tap to (re)generate; cached on load).     |
| `WellbeingCard` (09 mood trend)           | status        | **Stays in the overview grid** (the mood trend / "where you are").                                                                                   |
| `DreamsCard` (12)                         | status        | **Stays in the overview grid** (recent dreams + pattern highlight).                                                                                  |
| `MemoryCard` (20)                         | status        | **Stays in the overview grid** (what the coach knows). A "refresh memory" reconcile prompt → a "For you" candidate when memory is stale (39).        |
| `InboxCard` (08)                          | status/action | **Stays in the overview grid** (unanswered count + CTA).                                                                                             |
| `WelcomeOrientationCard` (41)             | first-run     | **Unchanged** (shown once; never above the crisis banner).                                                                                           |
| `GettingStarted` (17/41)                  | brand-new     | **Unchanged**; when shown, the "For you" section is **suppressed** so a brand-new person sees one warm path, not both (§7).                          |
| _(future)_ `ChallengeCard` (52)           | status/action | Overview grid (active challenge) **+** a "For you" candidate ("get a challenge idea", explicit-tap). Slice B.                                        |
| _(future)_ "You" hub highlight (50/51)    | status        | Overview grid (recent test/check-in results) **+** "For you" candidates ("try the attachment reflection", "a wellbeing check-in"). Slice B.          |

The principle: **two zones** — an **actionable "For you"** zone (ranked recommendations, what to _do_ next) and
a **status overview grid** (where you _are_). The actionable cards that today float as peers collapse into the
ranked "For you" zone; the status cards form a clean grid. This both reduces visual noise and gives the
recommendation engine one place to own.

### 3.7 Proactivity scaling (reuse the spec-40 dial)

Encouragement intensity tracks the existing per-person `coaching.proactivity` (40 §3.6, read in the bridge via
`coaching:getPrefs`; per-person `CoachingPrefs`). **No new setting.**

- **`off`** — a **calm Home**: the "For you" recommendation section is **not rendered at all**, no momentum
  pushiness (a bare greeting + the status overview grid only), no celebration nudge-to-next-step. The status
  cards still show (they're not pushes — they reflect existing data). **Crisis support is unaffected** — it's
  safety, never governed by this dial (§8 / 40 §3.6).
- **`gentle`** (default) — the "For you" section shows a **small** number (candidate 1–2), a gentle momentum
  line, warm celebrations. The default tone of the app.
- **`active`** — a **slightly more present** Home: more "For you" cards (candidate up to 3), a momentum line
  that surfaces a bit more, the synthesis observation a touch more prominent. Still invitation-only, never
  demanding.

### 3.8 The one AI voice stays explicit-tap

The single AI observation is the spec-40 cross-feature synthesis (`InsightOfTheWeekCard` / `coaching.synthesize`).
This spec **does not add AI** and **does not make recommendation phrasing AI-generated** in v1 (recommended,
§11): the registry's `reason` strings are deterministic and free. The synthesis observation is **surfaced
within the "For you" section** (as the one AI-voiced recommendation) but keeps its existing rules: cached
re-display costs nothing; generating/refreshing is an **explicit tap** (no per-load spend, the 17 §13 / 40
§3.4 precedent); it's metered + budget-gated + tolerant-parsed (40/37). The recommendation engine treats the
cached synthesis as just another candidate to rank; it never triggers a synthesis on load.

## 4. Data model (vault files & schemas)

**No new vault files. No vault schema change if avoidable** — momentum and recommendations are **derived** on
the renderer from data Home already loads (the 17 model). The only persisted state is **device-local +
per-person**, reusing the spec-41 `discovery:*` dismissal seam.

- **Recommendation dismissals + celebration-seen signatures** — **device-local + per-person**, stored as small
  signatures in the existing **`DeviceState.discoveryDismissals`** blob (41 §4 / §6, the spec-35 device-state
  precedent), keyed by the active person **in the bridge** (the trust boundary). A dismissed "For you"
  recommendation and an already-celebrated completion are recorded by a stable key (e.g.
  `rec:<id>` / `celebrate:<signature>`). **Not synced, not in the vault.** **CONFIRM (§11): reuse `discovery:*`**
  rather than add a new seam (recommended — it's the established device-local per-person mechanism). If a new
  device-state field is ever warranted it is additive-optional (no migration), per the `DeviceStateSchema`
  precedent.
- **The recommendation candidate + ranked-result types** are **Zod view types** in `@selfos/core` (not
  persisted) — see §5.1.
- **Momentum** is a **pure derivation** over the per-person stores (sessions/dreams/tests/goals/insights), not
  a stored value; recomputed on each Home load. No persistence, no metric.
- **Everything else is read** from existing sources (the 17 §4 table, extended): `conversationStore` (+ status),
  approved session/dream/questionnaire/test Insights + `moodValence`/`moodEnergy` (09/20/50), `dreamStore` +
  `dreamPatternStore` (12), `inboxStore` (08), `goalStore` (39), `guidanceStore` (16 cached suggestions),
  `synthesisStore` (40 cached observation), and (Slice B) test results (50) + challenges (52).

All device-state reads/writes go through the existing device-state IPC (no direct `fs`); the bridge keys
everything under the active person (per-person isolation).

## 5. Architecture & modules

A small **`@selfos/core`** recommendation registry + ranking engine (pure, testable, reusable across hosts),
plus a **renderer** Home redesign that composes it from the existing per-person stores. No new feature module,
no new nav/route (Home is already `/`), and — by intent — **no new IPC** (§6).

### 5.1 The recommendation registry (`@selfos/core/recommendations`)

Modelled on the context-provider registry (`packages/core/src/questionnaires/contextProviders.ts`): each
feature module **registers** its recommendable actions; the engine gathers candidates from all registered
providers with no changes to Home. Illustrative, Zod-first:

```ts
// @selfos/core/recommendations — illustrative; Zod-first view types (not persisted)
export const RecommendationDomainSchema = z.enum([
  'session',
  'guided',
  'intimacy',
  'test',
  'challenge',
  'wellbeing',
  'dream',
  'memory',
  'questionnaire',
]);

/** A concrete, ranked recommendation the renderer renders as a "For you" card. */
export const RecommendationSchema = z.object({
  id: z.string().min(1), // stable, for dismissal signatures + dedup
  domain: RecommendationDomainSchema,
  label: z.string().min(1), // the card's short title ("Try the attachment reflection")
  reason: z.string().min(1), // deterministic, person-specific ("You took the Big Five — build on it")
  route: z.string().min(1), // an in-app route the primary action navigates to (or a seed-handoff key)
  score: z.number(), // the engine's relevance score (filled by ranking)
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/** What a provider needs to decide relevance — the active person's derived state (no AI, no I/O). */
export interface PersonRecommendationState {
  capabilities: Set<string>; // can(...) snapshot
  adultAcknowledged: boolean; // the per-person 18+ ack (16 §8.3)
  proactivity: 'off' | 'gentle' | 'active';
  now: Date;
  openGoals: { id: string; title: string; staleSince?: string }[]; // 39
  openSessions: number; // 09 status
  recentSessionCount: number; // rolling window (momentum + recency)
  dreamCount: number;
  inboxUnanswered: number;
  approvedInsights: { source: string; createdAt: string; lifeArea?: string }[];
  portraitStale: boolean; // 29/18 §15
  memoryStale: boolean; // 39 reconcile
  testResults: { instrument: string; takenAt: string }[]; // 50 (Slice B)
  activeChallenge: boolean; // 52 (Slice B)
  // …extended additively as features register; absent fields default safely.
}

/** A feature registers one of these per recommendable action (the contextProviders pattern). */
export interface RecommendationProvider {
  id: string;
  domain: Recommendation['domain'];
  /** Required capability to even consider this (filtered before relevance). */
  capabilityGate?: string;
  /** True if this needs the 18+ ack (intimacy/sexual). Filtered when not acknowledged. */
  adultGate?: boolean;
  /**
   * Return a candidate (with `reason` + `route` + a base `score` ≥ 0) if relevant to this person now,
   * or `null` to contribute nothing. PURE — derives from `state` only; no AI, no I/O, no spend.
   * Higher score = more relevant; recency/staleness factored in here or by the engine.
   */
  relevance: (state: PersonRecommendationState) => Omit<Recommendation, 'domain'> | null;
}

export function registerRecommendationProvider(p: RecommendationProvider): void; // idempotent by id
export function listRecommendationProviders(): RecommendationProvider[];
export function resetRecommendationProviders(): void; // → built-ins (for tests)
```

Built-in providers (Slice A — over **existing** features), each a pure `relevance`:

- **`continue-session`** (domain `session`) — an open/on-hold session → "Pick up where you left off."
- **`stale-goal`** (domain `session`/`challenge`) — a quiet-for-a-while open goal (39) → "Your '<goal>' has
  been quiet — still on it?" (the goal-followup signal). ≤1, coalesced.
- **`synthesis-observation`** (domain `memory`) — a cached spec-40 synthesis exists → surface it; or an
  explicit-tap "see what I'm noticing" when warranted (no load spend).
- **`refresh-portrait`** (domain `memory`) — the onboarding portrait is stale (29/18 §15) → "Refresh your
  portrait."
- **`depth-invitation`** (domain `session`) — a pending depth invitation (29) → "Go deeper on <area>" —
  coalesced with synthesis for the same life-area (40 §3.7).
- **`guided-suggestion`** (domain `guided`) — a cached guided suggestion (16) or "explore a guided session"
  for a light-activity person → start/suggest (explicit-tap to regenerate).
- **`questionnaire-gap`** (domain `questionnaire`, gate `questionnaires.create`) — the gap-finder cache / "a
  questionnaire worth sending" → builder (explicit-tap to generate).
- **`refresh-memory`** (domain `memory`, gate `memory.own`) — memory has drifted (39 reconcile threshold) →
  "Tidy up memory."

Slice B providers register from their own modules (no Home edits): **`take-a-test`** / **`wellbeing-checkin`**
(50/51, the latter gated gently — §8), **`intimacy-exercise`** (48, `adultGate: true`), **`get-a-challenge`**
(52, explicit-tap). Sexual/intimacy candidates carry `adultGate: true` and are filtered until the 18+ ack.

### 5.2 The ranking engine (pure)

A pure `rankRecommendations(providers, state, opts)` (unit-tested, no AI, no I/O):

1. **Filter** — drop any provider whose `capabilityGate` isn't in `state.capabilities`, and any `adultGate`
   provider when `!state.adultAcknowledged`. (So a gated/18+ action is **never** even a candidate — no dead
   CTA, no premature 18+ exposure, §3.2/§7.)
2. **Gather** — call each remaining provider's `relevance(state)`; keep non-null candidates.
3. **Crisis de-escalation** — if `state` carries a recurring-crisis signal (passed in; computed by
   `aggregateCrisisSignal`, §5.4), **suppress pushy candidates entirely** (return `[]` for the "For you"
   section) so Home leads with support, not nudges (§8). _Status_ cards (separate) are unaffected.
4. **Proactivity gate** — if `proactivity === 'off'`, return `[]` (the section isn't rendered, §3.7). Else cap
   the count by level (`gentle` → small N, `active` → larger N).
5. **Apply dismissals** — drop candidates the person dismissed within the quiet window (the device-local
   per-person signatures, §4).
6. **Rank** — sort by `score` (relevance + recency/staleness), then **variety-dedup** (avoid N of the same
   `domain`; prefer a varied top set), then take the top N. Deterministic + stable for the same `state`.

The engine is **pure and synchronous** — it operates on `state` the renderer assembles from stores it already
loaded; it never calls the bridge, never spends, never reaches the model.

### 5.3 Momentum (pure)

A pure `computeMomentum(state, now)` → a small `{ line?: string; showedUp?: number; areas?: number }`-style
reflection (final shape §11), derived from rolling-window counts of sessions/dreams/check-ins, distinct
engaged life-areas/domains, and recently-touched goals (§3.3). **It never computes or returns a gap, a streak,
a miss, or an overdue count** (a hard constraint enforced by the type + tests, §8/§10). Degrades to `{}`
(just the greeting) on a quiet week.

### 5.4 Renderer — the Home redesign

- **`Home.tsx`** is restructured into the §3.1 hierarchy: header (greeting + momentum) → `CrisisSupportBanner`
  (when `crisis`) → a new **`ForYou`** section (the ranked recommendations) → the **overview grid** (status
  cards) → celebration → getting-started (brand-new) → orientation + `CrisisFooter`. It assembles
  `PersonRecommendationState` from the stores it already loads, calls `rankRecommendations` + `computeMomentum`
  (pure, synchronous), and reads `coaching.proactivity` (via the existing `coaching:getPrefs` /
  `synthesisStore`/`coachingStore` already on Home's load) for the scaling.
- **New presentational components:** `ForYou` (the section) + `RecommendationCard` (one ranked card) +
  `MomentumLine` (the gentle reflection) + `CelebrationMoment` (the completion acknowledgement — a toast via
  the spec-35 `Toast`, or a brief card, per §11). Reuse `Card`/`Stack`/`Inline`/`Text`/`Button` + the spec-35
  `Toast`; if a genuinely new pattern emerges it goes to `/gallery` (DoD §12). The preference is to reuse
  existing primitives, so likely **no new `/gallery` primitive** beyond what spec 35 already added.
- **Absorbing the old cards:** `GoalFollowupCard` / `DiscoveryNudge` / `ProfileFreshnessCard` /
  `DepthInvitationCard` / `InsightOfTheWeekCard` / `SuggestionsCard`'s actionable role become recommendation
  **providers/candidates** rendered by `RecommendationCard` (§3.6). Their existing actions (e.g. spec-40
  `goals:setStatus` Still on it / Mark done / Let it go; the synthesis seed-handoff; the freshness refresh) are
  **preserved** on the resulting recommendation card — the engine changes _where/how_ they're surfaced and
  ranked, not _what they do_. The status cards (`ContinueCard`/`WellbeingCard`/`DreamsCard`/`MemoryCard`/
  `InboxCard`/`OnboardingCard`) stay as the overview grid.
- **`aggregateCrisisSignal`** (40, already renderer-computed on Home) feeds the engine's crisis de-escalation
  (§5.2) and the `CrisisSupportBanner` (unchanged).
- **Per-person isolation** — Home already loads + resets on `activePerson.id` change (17 §3.4); any recommendation
  dismissal/celebration state is read per-active-person (the existing `discovery:*` per-person reads). A new
  store, if any, resets in the AppShell active-person effect (the established rule).

### 5.5 Where features register (the extensibility seam)

Each feature module that wants to recommend an action calls `registerRecommendationProvider` from its own core
module (the `registerContextProvider` precedent), so **adding a recommendation is adding a provider, not
editing Home**:

- Slice A registers the built-ins (§5.1) from `@selfos/core/recommendations` (and from the existing
  guided/questionnaire/goal/memory cores where the data lives).
- Slice B: spec 50/51 register `take-a-test` / `wellbeing-checkin`; spec 48 registers `intimacy-exercise`
  (`adultGate`); spec 52 registers `get-a-challenge`. None touch `Home.tsx` — they appear in "For you"
  automatically when relevant + permitted.

## 6. IPC / API contracts

- **No new IPC channels expected.** The redesign + engine are **renderer-composed** from existing channels +
  stores (the 17 model), and recommendation/celebration dismissals **reuse the spec-41 `discovery:getDismissals`
  / `:setDismissals` seam** (device-local, per-person, keyed in the bridge — the trust boundary). **CONFIRM
  (§11): reuse `discovery:*`** (recommended) vs a dedicated `recommendations:*` seam (default: reuse).
- **No new Claude API usage.** Recommendation ranking + momentum are deterministic. The one AI call is the
  reused spec-40 `coaching:synthesize` (explicit-tap, metered, budget-gated, tolerant-parsed) — unchanged; the
  engine only ranks its **cached** result and never triggers it on load. The key stays in main; the renderer
  never sees it.
- **Reused reads** (all existing): `conversations:list` (+ status), `dreams:*`, `insights:list`,
  `assignments:inbox`, `goals:list` (+ `goals:setStatus` for the goal recommendation's actions),
  `guided:getState` (cached suggestions), `coaching:getSynthesis` / `getPrefs`, and (Slice B) `tests:*` (50) /
  `challenges:*` (52). The AI-unavailable copy reuses the spec-41 `AiUnavailableNotice` (no IPC).
- If §11 ever chooses a dedicated channel for dismissals, it's added through the full typed seam (channels →
  coreBridge → ipc → preload → test mock), gated to the active person in the bridge. **Default: no new
  channel.**

## 7. States & edge cases

- **Loading** — the "For you" section + momentum + celebration render only after Home reports `ready` (the
  existing `ready`-gate, 17 §13), so nothing flashes before data arrives and no empty grid flickers.
- **Brand-new person** → the **getting-started** state shows (one warm path), and the "For you" section + the
  momentum line + celebration are **suppressed** so a new person isn't hit with both a getting-started card and
  ranked recommendations (§3.6). As data appears, getting-started self-replaces and "For you" activates.
- **Proactivity off** → the "For you" section is **not rendered at all**; Home is a calm greeting + the status
  overview grid; no momentum pushiness, no celebration nudge-to-next. **Crisis support still shows** (§8).
- **Everything done / nothing to recommend** → the "For you" section renders an **empty branch that is calm and
  satisfied, not nagging** — a brief "you're all set for now" rather than a forced suggestion or a dead-end.
  The status grid still reflects where they are. The engine returns `[]` and the section either self-hides or
  shows the satisfied line (§11 picks; default: a warm satisfied line at `gentle`/`active`, nothing at `off`).
- **Recent crisis / low-wellbeing signal** → `aggregateCrisisSignal` recurring ⇒ the engine **suppresses pushy
  recommendations** (returns `[]` for "For you"), no celebration, and `CrisisSupportBanner` **leads** (§3.1.2 /
  §8). Status cards (mood trend, etc.) still render — they reflect reality without pushing.
- **A recommended feature the person lacks the capability / 18+ for** → filtered out **before ranking** (§5.2);
  it is never a candidate, so there is no dead CTA and no premature 18+ exposure. A capability/ack change
  re-runs the pure engine on the next render and the recommendation appears/disappears live (reactive `can(...)`
  - the 18+ ack).
- **Dismissed recommendation** → suppressed for its quiet window (device-local per-person); it re-surfaces only
  when its underlying signal **changes** (e.g. a goal touched again, a new synthesis, the portrait re-staled) —
  the spec-35/41 condition-change re-surface discipline, applied to recommendations. Never re-nags on the same
  signal.
- **Already-celebrated completion** → the celebration signature is recorded; re-visiting Home doesn't
  re-celebrate the same completion (§3.5). A new completion celebrates once.
- **Offline / AI off / over budget** → deterministic recommendations + momentum + status cards all still render
  (no AI needed); the synthesis-observation candidate shows its **cached** value or an explicit-tap that, when
  unavailable, shows the spec-41 role-aware `AiUnavailableNotice` (owner → Settings → AI; member → ask the
  owner) — never a dead button (41 §3.3 / 31).
- **Person switch** → Home resets + reloads per-active-person (17 §3.4); the engine recomputes for the new
  person; a celebration/in-flight state for the prior person is cleared (the per-person isolation + async-race
  guard, 17/35).
- **Large data** — N/A for new content (none produced); the engine ranks over already-loaded, bounded store
  data and takes the top N.
- **Concurrent edits / sync conflicts** — N/A for new persisted content (the only persistence is device-local
  dismissal/celebration state, which doesn't sync). Vault sync conflicts surface via the existing notification
  (35) unchanged.
- **Corrupt/missing dismissal state** → treated as "nothing dismissed / nothing celebrated yet" (fails open to
  showing the harmless recommendation/celebration), never crashes a Home render (41 §7 precedent).
- **Migration** → none (no vault schema change; device-state fields additive-optional). A pre-53 vault simply
  has no dismissals/celebrations recorded (defaults apply).
- **360px** → the header, the "For you" section, the overview grid, and any celebration fit with **no
  horizontal overflow** and render to the bottom (the full-surface guard, CLAUDE.md §7/§12); the grid reflows
  to one column on phones.

## 8. Safety

This is a **wellbeing surface** that **encourages action** on an app holding mood/anxiety/intimacy data, so the
safety design is paramount (CLAUDE.md §1, 05 §7, 40 §8, 51 §8). Encouragement that nags or guilts would be
actively harmful here.

- **Not medical / not therapy.** The not-medical line stays on Home (17 §7); the orientation states it (41
  §3.5). Recommendations and momentum are **reflective invitations / gentle reflections**, never a treatment
  plan, a target, a score, or an assessment. A wellbeing **check-in** recommendation (51) is offered as "a
  gentle reflection if it'd help," never "you're overdue for your depression screen."
- **Never nag, never guilt, never pressure — especially wellbeing.** Hard constraints:
  - **No streaks, no streak-loss, no missed-day counts, no overdue badges, no daily targets** (§2 non-goal,
    §3.3 CONFIRM). Momentum reflects what _did_ happen positively; it **never** displays a gap, a miss, or a
    falling-behind signal (enforced by the `computeMomentum` return type + tests, §10).
  - **Wellbeing check-ins are invitations on a gentle window, never a schedule.** A mood/anxiety check-in is
    recommended softly and infrequently; SelfOS never pressures a person to log their mood, and a person who
    doesn't is never nudged harder (no escalation). It must never feel like a watcher.
  - **At most a small number of "For you" cards** (proactivity-scaled), warm low-pressure copy ("when you're
    ready", "no rush", "totally fine to skip"), a real **off** switch (the `coaching.proactivity` dial). Ignoring
    a recommendation produces **no** consequence or follow-up guilt.
  - **Autonomy-supportive by design** (self-determination theory): support **autonomy** (everything is an
    invitation the person chooses), **competence** (celebrate effort + growth, reflect progress), and
    **relatedness** (warm, personal tone) — never controlling, coercive, or shaming language.
- **De-escalate when struggling.** When `aggregateCrisisSignal` reports recurring distress (40 §3.5) **or** a
  low-wellbeing signal is present, the engine **suppresses pushy recommendations** and **no celebration shows**;
  Home **leads with the resources-first `CrisisSupportBanner`** (which always supersedes, never dismissible,
  never governed by the proactivity dial, 40 §3.6 / 35 §8). SelfOS does not push growth at someone in crisis —
  it offers support and routes to professional help. **How aggressively to suppress** (any crisis flag? a
  sustained low mood? for how long?) is §11 — default: suppress all pushes while the crisis signal is present
  and lead with support.
- **Challenges own the "push"; Home only invites.** The consent-bound, comfort-zone-pushing behavior lives in
  spec 52 (which negotiates, respects hard-nos + partner consent, never coerces). Home's role is only to
  **invite** a person to start a challenge ("get a challenge idea", explicit-tap) — it never imposes one,
  never escalates, and the 18+ ack gates any sexual/intimacy challenge recommendation (16 §8.3 / 52 §8).
- **Privacy is sacred.** Everything is **per-person** (single-subject). The engine reads only the **active
  person's own** state; recommendation reasons reveal nothing cross-person and **never imply an owner/admin can
  see a person's content** (the durable rule, CLAUDE.md §1). 18+ / sexual recommendations are filtered until
  the person's own ack and never surface another person's intimacy data. The bridge stays the trust boundary
  for the device-local dismissal state.
- **Honest, calm signals.** No fake urgency, no manufactured "limited-time" framing, no dark patterns. A
  satisfied/empty state reads as calm ("you're all set for now"), not as a failure to act.

## 9. Accessibility

Per [`01 §9`](01-design-system.md), inheriting specs 17 / 35 / 40 / 41:

- **Heading order** — a single `<main>` with a logical order: greeting `h1`, the "For you" section + each
  overview card titled `h2` (the 17 a11y model). The "For you" section is a labelled region.
- **Recommendation cards** — each primary action is a **real, keyboard-operable** button/link with a clear
  accessible name (including the domain context, not just "Open"), visible focus; icons are `aria-hidden` with
  text labels. The dismiss ("not now") control is keyboard-reachable with an accessible name.
- **Momentum + celebration must not be color-only or motion-dependent.** The momentum reflection is **text**
  (not a color bar / ring alone); any at-a-glance momentum element carries a text equivalent. A celebration is
  conveyed in **text** (the message), not via animation/confetti alone — reduced-motion users get the message
  with no motion, and a celebration toast follows the spec-35 `aria-live` + pausable rules. **No meaning is
  carried by color or motion alone.**
- **Reduced motion** — any card entrance / celebration animation respects `prefers-reduced-motion` (no
  slide/bounce/confetti when set); the content is fully present without motion.
- **Crisis surface** — the `CrisisSupportBanner` + `CrisisFooter` resources are real, focusable links (already
  accessible); never color/motion-only.
- **AI-unavailable** — the reused `AiUnavailableNotice` keeps its `role="status"` + role-aware semantics (41
  §9).
- **Responsive ~360px→desktop** — the section + grid reflow to one column on phones; no horizontal scrollbars
  anywhere (CLAUDE.md §12); tap targets ≥44px at mobile width. Any genuinely-new primitive → `/gallery`.

## 10. Testing strategy

Vault + Claude mocked as established; `pnpm typecheck` after writing tests (memory: `vitest-does-not-typecheck`).
Drive complete flows through the rendered UI, not bridge calls (CLAUDE.md §7).

- **Unit (Vitest) — the engine + momentum (the core proof):**
  - `rankRecommendations` **relevance/staleness ordering**: a stale goal + an open session + a generic guided
    suggestion rank in the expected order; recency pushes a just-done thing down; **variety-dedup** keeps the
    top N from being N of one domain.
  - **Proactivity-off suppresses pushes**: `proactivity:'off'` ⇒ `rankRecommendations` returns `[]` (the
    section won't render); `gentle` caps to the small N; `active` to the larger N.
  - **Crisis suppresses nudges**: with a recurring-crisis signal, the engine returns `[]` for "For you" (no
    pushes) regardless of available candidates; status candidates are unaffected.
  - **Capability + 18+ gating hides actions**: a `capabilityGate` provider is dropped when the capability is
    absent; an `adultGate` provider is dropped when `adultAcknowledged` is false — neither is ever a candidate
    (no dead CTA, no premature 18+ exposure).
  - **`computeMomentum` never returns a gap/streak/miss/overdue** (assert the shape can only carry positive
    reflections; a quiet week → `{}`); the registry is idempotent by id; `reason` strings are deterministic
    (no AI).
- **Component (Vitest + RTL):**
  - The redesigned `Home` renders the new hierarchy (greeting + momentum → "For you" → overview grid); the
    "For you" section shows ranked `RecommendationCard`s with their reasons; a brand-new person shows
    getting-started and **no** "For you" section.
  - Proactivity-off ⇒ no "For you" section, no momentum pushiness, status cards present; crisis ⇒
    `CrisisSupportBanner` leads + no "For you" + no celebration.
  - A `RecommendationCard`'s primary action navigates / triggers the preserved underlying action (e.g. the
    goal recommendation's Still on it / Mark done / Let it go still call `goals:setStatus`); dismiss ("not now")
    suppresses it and it doesn't re-render on remount; dismissal is per-person (a different active person sees
    it un-dismissed).
  - `CelebrationMoment` shows once for a completion and not again on remount (signature recorded); never above
    the crisis banner.
  - The "everything done" empty branch reads calm/satisfied, not nagging; the AI-unavailable path on the
    synthesis-observation candidate shows the role-aware notice (owner vs member), no dead button.
  - Momentum + celebration convey meaning in **text** (assert the text equivalent), not color/motion alone.
- **E2E (Playwright):**
  - A person with **stale areas** (a quiet open goal + a stale portrait + a couple of analyzed sessions) lands
    on Home → sees relevant **"For you"** steps (the goal check-in + a refresh-portrait + a guided suggestion),
    each with a reason → clicking one routes into the right surface; **proactivity-off hides the "For you"
    section entirely** (the status grid remains).
  - A **brand-new** person sees **getting-started** and **no** "For you" section / momentum pushiness.
  - A **recurring-distress** seed → the `CrisisSupportBanner` leads, "For you" is suppressed, no celebration
    (resources-first).
  - A capability-/18+-gated recommendation does **not** appear for a person lacking the capability/ack, and
    **appears** once granted/acknowledged (the prerequisite-absent + prerequisite-present paths, §7 DoD).
  - **360px guards:** no element with `overflow-x:auto|scroll` has `scrollWidth > clientWidth` on Home at 360px;
    the full surface (header → "For you" → grid → footer) renders to the bottom with no inner scrollbar.
  - **Visual-QA** Home at desktop + 360px (light + dark): the new hierarchy reads as **one designed whole** (a
    warm focal "For you" zone above a clean status grid), recommendation cards are aligned + intentional, the
    momentum line + any celebration are warm and non-nagging, nothing clipped (DoD §7).

## 11. Resolved decisions (2026-06-25)

> All the §11 product/UX/tone questions were resolved with the user before building Slice A (all the
> recommended defaults). The resolutions are recorded here; the original question text is kept below each as
> rationale. **Built decisions — do not re-litigate.**

- **Q1 Naming →** the section is **"For you"** (heading + concept); momentum is a header line (not its own
  branded zone).
- **Q2 Count →** the top N is **scaled 1–3 by proactivity** (`off` = section not rendered; `gentle` ≤2;
  `active` ≤3 — `COUNT_BY_PROACTIVITY`).
- **Q3 Phrasing →** **deterministic / free** `reason` strings in v1 (NO AI-personalized copy; the spec-40
  synthesis card stays the one AI voice).
- **Q4 Momentum →** a **single warm header line** + the three reflections (showed-up / explored-areas /
  goals-moving). **CONFIRMED: no streaks, no streak-loss, no missed-day/overdue counts, no targets** — the
  `MomentumReflection` type can carry only positive counts (enforced by `computeMomentum` + tests).
- **Q5 Celebration →** a **transient success toast** (`CelebrationMoment` via the spec-35 `Toast`), celebrated
  **once** per completion per-person/per-device (signature in the `discovery:*` store). Counted completions:
  onboarding finished, a session wrapped up, a goal marked done.
- **Q6 Crisis suppression →** while `aggregateCrisisSignal` is **recurring**, suppress **all** pushes ("For
  you" + momentum + celebration) and lead with `CrisisSupportBanner`; a **single** low-mood reading does NOT
  suppress.
- **Q7 Card reconciliation →** the **§3.6 two-zone map is confirmed** — the actionable cards (goal-followup,
  synthesis, discovery nudge, freshness, depth, guided/questionnaire suggestions) become "For you" providers;
  the status cards (Continue/Wellbeing/Dreams/Memory/Inbox/Onboarding) stay the grid; the synthesis observation
  lives **inside** "For you".
- **Q8 Proactivity mapping →** **reuse `coaching.proactivity`** (no new setting); `off` = a **status-grid-only**
  calm Home (suppress pushes), `gentle` = a few, `active` = more; crisis support is never governed by the dial.

The original questions, for rationale:

1. **Naming.** What does the recommendation section + the engine concept get called — **"For you"**, **"Your
   next step"**, **"Momentum"**, **"Your path"**, or something else? (Affects copy + headings throughout. The
   spec uses "For you / Your next step" as placeholders.)
2. **How many recommendations at once.** The top **N** in the "For you" section — candidate **1 (a single
   focal next step)** vs **2–3**, scaled by proactivity (`gentle` fewer, `active` more)? A single card is the
   calmest/most focal; 2–3 surfaces more but risks reading as a to-do list.
3. **Recommendation phrasing — AI or deterministic?** v1 the registry's `reason` strings are **deterministic /
   free** (**recommended** — the spec-40 synthesis card already provides the one AI voice, and per-load AI
   spend is a non-goal). Confirm we do **not** AI-personalize the recommendation copy in v1.
4. **Exactly how momentum is reflected — and CONFIRM no streaks/loss.** Which reflections ship ("showed up N
   times this week" / "explored N areas" / "N goals moving forward" / a quiet-week warm line)? Is it just a
   header line, or also a small at-a-glance element? **Confirm the hard constraint: no streaks, no streak-loss,
   no missed-day/overdue counts, no daily targets** — momentum reflects only what positively happened (§3.3/§8).
5. **Celebration — transient or persistent?** Is a completion celebrated as a **transient toast** (lighter,
   won't linger — the spec-35 `Toast`) or a **brief dismissible card** on Home (more visible, can feel like a
   to-do)? And which completions count (onboarding done, session summarized, test taken, challenge finished,
   goal marked done)?
6. **How aggressively to suppress after a crisis / low-wellbeing signal.** When does encouragement step back —
   **any** recent crisis flag, a **sustained** low mood, the recurring-distress threshold only — and for how
   long after? (Default proposed: suppress **all** pushes while `aggregateCrisisSignal` is recurring, lead with
   support; confirm whether a single low-wellbeing reading also suppresses, and the recovery window.)
7. **The before→after card reconciliation (§3.6).** Confirm the concrete map — specifically: which of the
   spec-40/41/29 cards become **"For you" recommendations** (goal-followup, synthesis, discovery nudge,
   freshness, depth) vs which stay as **status cards** (continue, wellbeing, dreams, memory, inbox, onboarding);
   and whether the **synthesis observation** lives inside "For you" or stays a distinct card. (The spec proposes
   the two-zone model; the user signs off on the exact placement so nothing duplicates and no card is orphaned.)
8. **Does `coaching.proactivity` cleanly map to encouragement intensity, or need a tweak?** The dial was
   designed for coaching proactivity (in-session raising + synthesis cadence + goal nudges). Reusing it for
   Home encouragement intensity (`off` = calm Home / no "For you"; `gentle` = a few; `active` = more) is
   **recommended** (no new setting), but confirm the mapping reads right — e.g. should `off` still allow the
   _status_ grid (yes, proposed) and only suppress _pushes_? Does anyone want encouragement intensity
   independent of coaching proactivity (a new setting — **not** recommended)?

### 11.1 Sequencing note (Slice A early, Slice B grows)

- **Slice A ships EARLY — before specs 48–52 land.** It delivers (a) the Home visual/structural redesign (the
  §3.1 hierarchy, the momentum reflection, the two-zone reconciliation §3.6), (b) the recommendation registry +
  ranking engine (`@selfos/core/recommendations`, §5.1/§5.2), (c) the built-in providers over **existing**
  features (continue-session, stale-goal, synthesis-observation, refresh-portrait, depth-invitation,
  guided-suggestion, questionnaire-gap, refresh-memory — §5.1), and (d) light momentum + celebration over
  existing completions. This is the **early UI/UX win** that immediately improves discovery + motivation for
  the features that exist **today** — it does not wait on 48–52.
- **Slice B grows the engine as 48–52 land.** Each new feature **registers its own recommendation provider**
  from its own core module (the `registerContextProvider` precedent) — `take-a-test` / `wellbeing-checkin`
  (50/51), `intimacy-exercise` (48, `adultGate`), `get-a-challenge` (52, explicit-tap) — and appears in "For
  you" automatically when relevant + permitted, with **no edits to `Home.tsx`**. This is the payoff of the
  registry: the motivational front door extends itself as the app grows, instead of Home accreting another
  hand-wired card per feature (the very problem this spec fixes).

## 12. Changelog

- 2026-06-25 — created (Draft). The **capstone** Home redesign + personalized recommendation/encouragement
  engine: a sleeker, warmer Home (greeting + gentle momentum reflection + a focal "Your next step / For you"
  recommendation section + a clean two-zone status/actionable hierarchy + warm celebration moments) and a
  deterministic recommendation **registry + ranking engine** (`@selfos/core/recommendations`, modelled on the
  context-provider registry) drawing the right next action from the person's real data across sessions, dreams,
  questionnaires, tests, challenges, intimacy work, goals, and memory. Locked: one capstone spec; **light
  momentum, no punishing streaks** (autonomy-supportive / SDT); **reuse `coaching.proactivity`** (no new
  setting); **Slice A early** (before 48–52, over existing features) then **Slice B grows** as 48–52 register
  their providers. Renderer-composed + deterministic (no per-load AI spend; the spec-40 synthesis stays the
  one explicit-tap AI voice); device-local per-person dismissals/celebrations reuse the spec-41 `discovery:*`
  seam (no new vault schema, no new IPC expected). Reconciles + absorbs the spec-17/40/41/29 Home cards into
  one ranked hierarchy (the §3.6 before→after map) rather than adding another bolted-on card. Strong safety
  core (§8): never nag/guilt/pressure (especially wellbeing), de-escalate to support during distress
  (`CrisisSupportBanner` always supersedes), challenges own the consent-bound push — Home only invites. Open
  product/UX/tone decisions (naming · count · phrasing AI-vs-deterministic · momentum shape + the no-streaks
  CONFIRM · celebration transient-vs-persistent · crisis suppression aggressiveness · the exact card
  reconciliation · the proactivity→intensity mapping) in §11 — to resolve with the user before building.
- 2026-06-25 — **§11 resolved + Slice A BUILT** (on `feat/home-encouragement-engine`). Built
  **`@selfos/core/recommendations`** — a Zod-first recommendation **registry** (`registerRecommendationProvider`
  / `list` / `reset` / `registerBuiltIn`, the `contextProviders.ts` pattern) + **8 built-in providers**
  (continue-session, stale-goal, refresh-portrait, depth-invitation, synthesis-observation, guided-suggestion,
  questionnaire-gap, refresh-memory) + the pure **`rankRecommendations`** engine (filter gated/18+ → gather →
  crisis-/off-/new-suppress → dismissals → score → variety-dedup → top-N) + pure **`computeMomentum`** (positive
  reflections only, no streak/gap by type) + **`pendingCelebration`** (newest recent uncelebrated, once); added
  `./recommendations` to `packages/core/package.json`. **Home restructured** into the §3.1 hierarchy (greeting +
  `MomentumLine` → `CrisisSupportBanner` → **`ForYou`** → `OnboardingCard` status → status grid /
  `GettingStarted` → `WelcomeOrientationCard` → `CelebrationMoment` toast → `CrisisFooter`). New renderer
  components `ForYou` / `RecommendationCard` / `RecommendationItem` / `MomentumLine` / `CelebrationMoment`.
  **Deleted** the absorbed Home cards — `GoalFollowupCard` + `InsightOfTheWeekCard` (40), `DiscoveryNudge` +
  `SuggestionsCard` (41/17), `ProfileFreshnessCard` + `DepthInvitationCard` (29) — folding their actions into the
  engine (goal Still on it / Mark done / Let it go, synthesis run + "Talk it through", guided start/regenerate,
  questionnaire gap-finder, depth go-deeper, freshness/memory refresh all preserved); removed `buildStatusLine`
  from `greeting.ts`. **Reuses** the spec-41 `discovery:*` device-local per-person seam for `rec:<id>` dismissals
  - `celebrate:<key>` signatures (**no new IPC, no new vault schema, no new AI spend**) and the spec-40
    `coaching.proactivity` dial for intensity (`off` = status-grid-only). §11 resolved (recommended defaults).
    Gate green: typecheck (all packages), lint, format, **790 core + 799 desktop** unit (+ engine
    rank/momentum/celebration/registry units, Home/ForYou/RecommendationCard/CelebrationMoment RTL), **E2E +2**
    (the "For you" zone ranks/reflects-momentum/dismisses + 360px guard; proactivity-off hides the zone but keeps
    the grid). Visual QA at desktop (the focal "For you" zone leads above a clean status grid). Synced specs
    17 / 29 / 40 / 41 (as-built amendments). **Slice B (48–52 providers) deferred** — each registers its own
    provider with no `Home.tsx` edit. **Lesson: absorbing N hand-wired Home cards into one ranked engine means
    moving WHERE/HOW each is surfaced, never WHAT it does — keep each absorbed card's action verbatim inside the
    uniform `RecommendationCard`; and a deterministic `MomentumReflection` type that can only hold positive counts
    makes "no streaks/no overdue" a compile-time guarantee, not a code-review hope.**
