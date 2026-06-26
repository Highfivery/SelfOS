# 40 — Proactive coaching

> **Status:** Built — _last updated 2026-06-24_
>
> **As-built amendment (2026-06-25, [`53`](53-home-encouragement.md) Slice A):** the Home `GoalFollowupCard`
> and `InsightOfTheWeekCard` were **absorbed into the §53 "For you" recommendation engine** (the `stale-goal`
> and `synthesis-observation` providers). Their actions are unchanged — the goal nudge still calls
> `goals:setStatus` (Still on it / Mark done / Let it go) and the synthesis observation stays explicit-tap
> (`coaching:synthesize`, cached re-display + "Talk it through" seed) — only the surface moved from a hand-wired
> Home card into the ranked engine. The `coaching.proactivity` dial, `aggregateCrisisSignal`, the
> `goal-followup` / `coaching-synthesis` notifications, and the in-session goal-raise are all unchanged.
>
> Today SelfOS **remembers** but never **acts** on what it knows: it is a reactive, user-initiated
> coach. Session analysis already extracts goals, depth-invitations, and profile-suggestions — but
> these are **recorded, not surfaced into the coach's behaviour**; the live coaching prompt is never
> told to gently raise a stale goal or a prior thread; cross-feature signals (a recurring dream theme +
> last week's session + an intake note about the same thing) are never synthesized; and crisis flags
> are per-insight with no aggregation. This spec makes the coach **proactive** — it follows up on open
> goals, surfaces cross-feature patterns, and gently nudges toward next steps — while keeping the
> wellness (not-medical) boundary leading and proactivity fully **tunable/opt-out**. It is the
> **behaviour** layer that consumes the data layer in sibling [`39`](39-living-memory-continuity.md).

Part of the 2026-06 five-spec group: [`37`](37-ai-output-robustness.md) (AI robustness — every new
AI pass adopts its tolerant-parse + honest-failure pattern), [`38`](38-questionnaire-lifecycle-completeness.md)
(questionnaire lifecycle), [`39`](39-living-memory-continuity.md) (living memory — first-class tracked
**goals/commitments** + a coherent, deduped memory to act on), **40 (this)**,
[`41`](41-first-run-discoverability.md) (first-run/discoverability). Depends on **39** for structured
goals + clean memory; consumes [`05`](05-conversations.md)/[`09`](09-session-analysis.md) (where
in-session proactivity is injected and where suggestions/depth-invitations already ride analysis),
[`12`](12-dreams.md) (dream patterns), [`08`](08-questionnaires.md)/[`18`](18-personal-onboarding.md)
(the other insight producers), [`28`](28-portrait-synthesis-optimization.md) (topic-aware fact
selection). Surfaces through [`35`](35-notification-system.md) (the bell/center/toasts) and
[`17`](17-home-dashboard.md) (Home cards). References [`00`](00-architecture.md)/[`01`](01-design-system.md)
and [`06`](06-ai-usage-and-budgets.md) (metering/budgets). References, doesn't restate.

---

## 1. Overview

SelfOS's coaching value is bounded by the fact that **it only ever responds when asked**. The data to
be proactive already exists or is about to (spec 39):

- **Session analysis** (`packages/core/src/conversations/sessionAnalysisService.ts`) emits `goals`,
  `followUps`, `depthInvitations`, and `profileSuggestions` each time a session is summarized. Verified
  (line ~265–329): goals/follow-ups become plain `Goal:`/`Follow-up:` facts; depth-invitations + profile
  suggestions are persisted as `ProfileUpdateSuggestion` records via
  `recordDepthInvitationsFromAnalysis` / `recordSuggestionsFromAnalysis`. **None of these is fed back
  into the coach's in-session prompt** — they are passive, awaiting the user to open Memory or a Home
  card. Spec 39 turns goals into first-class tracked entities; this spec makes the coach act on them.
- **The system prompt** (`promptBuilder.ts` `buildSystemPrompt`) assembles `PERSONA + SAFETY + context
(+ guided addendum) (+ depthAsk) + FORMATTING`. There is already a precedent for prompt-level
  proactivity — the §29 **in-session depth-ask** (`intake.inSessionDepthAsk`, default on, assembled in
  `coreBridge.ts` ~line 1538 and appended **after** persona+safety+context so the boundary always
  leads). But the coach is **never** told to proactively raise a relevant **stale/open goal** or a
  **prior thread**; `buildContext` (`buildContext.ts`) grounds it with facts but gives no behavioural
  instruction to follow through.
- **Dream patterns** (`dreams/dreamPatternService.ts`) exist (recurring symbols/themes/people/emotions,
  the nightmare nudge, an opt-in AI narrative) but are **not woven into coaching**: a cross-feature
  synthesis that connects a recurring dream theme to a session topic to an intake note **never
  happens**. There is no engine that reads across sources to produce one coherent observation.
- **Crisis flags** are per-insight (`Insight.crisisFlag`, set by each analysis pass). There is **no
  cross-insight aggregation** — e.g. distress recurring across the last few sessions + a nightmare run —
  and no supportive escalation surface beyond what each individual analysis already does.

This spec adds the **proactive behaviour layer**: (1) **goal follow-through**, (2) a **cross-feature
synthesis** AI pass, (3) **proactive nudges** coordinated through specs 35/17 without spam, (4)
**in-session proactivity** (a cheap prompt instruction riding the paid turn), (5) **cross-insight
crisis awareness** (resources-first, never dismissible), and (6) **user control** (opt-out / intensity
levels). The user has explicitly approved a **fully proactive** direction — extra AI passes / higher
spend are acceptable **within budget guardrails** (spec 06).

## 2. Goals / Non-goals

**Goals**

- **Goal follow-through** — the coach proactively checks in on a person's **open / due / stale** goals
  (the spec-39 `Goal` entities): in-session (a relevance-gated prompt instruction to gently raise one)
  and/or as a Home card / notification (the surface is a §11 decision).
- **Cross-feature synthesis** — a periodic/triggered AI pass that connects signals across **sessions +
  dreams + questionnaires + intake** into ONE coherent, gentle observation ("a theme keeps recurring
  across your dreams and last week's session"), surfaced as a dismissible insight/nudge the user can act
  on. This is an **extra AI pass** with a defined cadence, budget cap, metering (a new usage type, spec
  06), and opt-out.
- **Proactive nudges, coherent not spammy** — surface depth-invitations, profile-suggestions,
  recurring-pattern observations, and goal check-ins through spec-35 notifications and/or spec-17 Home
  cards, **coordinated** with the existing dedup/coalescing so the same thing never appears twice.
- **In-session proactivity (cheap)** — an optional, small instruction in the coaching system prompt so
  the **live** coach can naturally raise a past goal/thread when relevant, riding the turn the user
  already pays for (no extra call). **PERSONA + SAFETY lead** — the boundary always comes first (the
  established `buildSystemPrompt` rule).
- **Cross-insight crisis awareness** — aggregate crisis signals across recent insights and surface
  **supportively, resources-first**, never alarmingly; coordinate with the always-present crisis
  surfaces — **never** a dismissible notification.
- **Tunable / opt-out** — proactivity is a setting (intensity / off) so a person who wants a quiet tool
  gets one. Per-person (a §11 decision).
- **Additive & safe** — additive-optional schema (the §18/§20/§28/§39 precedent), Zod-first,
  per-person isolation, the shareable-vs-private boundary unchanged (the bridge is the trust boundary),
  **tolerant model-JSON parsing per spec 37**, budget-gated + metered per spec 06.

**Non-goals (deferred / out of scope)**

- **Producing/maintaining structured goals + coherent memory** — that is sibling spec [`39`](39-living-memory-continuity.md).
  This spec **consumes** spec-39 goals + reconciled insights; it does not define the goal entity model,
  reconciliation cadence, or cleanup. If 39 lands after this, the goal-consuming pieces here are gated
  on 39 (§10).
- **OS-level / push / scheduled notifications** — in-app only (spec 35 non-goal). Any "periodic"
  trigger is **renderer-driven on app events** (launch / focus / visibility), like the spec-36
  update-check cadence — never a main-process cron/daemon.
- **A new notification framework or new Home dashboard** — reuse specs 35 + 17; this spec adds **kinds**
  and **content**, not chrome.
- **Autonomous actions** — the coach never edits the profile, closes a goal, sends a questionnaire, or
  takes any action **on the user's behalf**; proactivity is always an invitation the user acts on or
  dismisses (the §29/§15 confirm-before-apply precedent).
- **A clinical assessment / care plan / risk score** — SelfOS is **not medical** (CLAUDE.md §1); no
  diagnoses, scores, or alarming framing. Cross-insight crisis awareness routes to **professional
  resources**, it does not "handle" a crisis.
- **Cross-person proactivity** — single-subject only (no "you and your partner both…" nudges); per-person
  isolation holds throughout.
- **Re-architecting `summarizeForContext`** — its bounds + privacy filters are untouched; any goal/thread
  grounding rides **behind** them.

## 3. UX & flows

This spec is partly a behaviour/engine layer (developer-facing) and partly UX (nudges + in-session
tone). The user-perceived surfaces are: (1) the live coach raising a relevant goal/thread, (2)
proactive nudges in the notification center / Home, (3) the cross-feature synthesis observation, (4) a
supportive cross-insight crisis surface, and (5) a proactivity setting. The **default proactivity
level**, **where** nudges live, the **synthesis cadence/cap**, and **whether check-ins are in-session
vs push vs both** are genuinely-open, cost- and tone-sensitive decisions in **§11** — do not assume.

### 3.1 In-session proactivity (the live coach)

When a session is **not** a guided exercise (and even when it is, behind safety), the coaching system
prompt gains a small, optional **proactivity instruction** — assembled in the bridge alongside the
existing `depthAsk` and appended **after** `PERSONA + SAFETY + context` so the boundary always leads
(the established rule). It tells the coach, in the same guarded register as `depthAskInstruction`:

- It knows the person's **open commitments** (their spec-39 open/in-progress/stale goals, bounded, in
  their words) and recent **threads** (recent follow-ups). **If — and only if** — the conversation is
  naturally relevant, it may gently raise **one** ("last time you mentioned wanting to finish X — how's
  that going?"), at most once, then let it go if the person doesn't pick it up. It **never derails** the
  session, never lectures, and **safety always takes precedence** (any distress → drop the nudge,
  respond with care).
- This is **free** — it rides the turn the user already pays for (no extra Claude call), exactly like
  the §29 depth-ask. The goals/threads come from spec 39's `goals:list` (open commitments) read in the
  bridge.

The instruction is **suppressed** when proactivity is off (the §11 setting), when there are no
open/stale goals, and is naturally crowded out by crisis or a heavy topic (the prompt says so).

### 3.2 Goal follow-through nudges

A person's **stale / due** goals (spec 39's derived-stale state) can also surface **outside** a session
— as a calm nudge. Whether this is a **spec-35 notification**, a **spec-17 Home card**, the
**in-session** raise (§3.1), or a combination is **§11**. The candidate shape:

- A new notification **kind** `goal-followup` (info severity) and/or a Home **GoalFollowupCard**: "You
  set a goal a while back: _finish the project_. Still working on it?" with one-tap **Still on it /
  Mark done / Let it go** (the spec-39 `goals:setStatus` actions). It deep-links to the goal in Memory
  (spec 39 §3.1).
- **Never naggy:** at most one open goal-followup nudge at a time per person (coalesce by `goal-followup`);
  acting on or dismissing it suppresses it until the goal's state **changes** (the spec-35 re-surface
  rule — `onChange` of the goal's status/`lastTouchedAt`). A "let it go" marks it abandoned (39), so it
  never returns.

### 3.3 Cross-feature synthesis

A periodic/triggered **AI pass** (`coaching.synthesize`, a NEW usage type — §4.4) reads a **bounded,
structured digest** across the active person's recent **session insights + dream patterns +
questionnaire insights + intake portrait** (insight summaries/facts + dream pattern stats — **never raw
transcripts**, the gap-finder/dream-patterns precedent) and produces **one** coherent, gentle
observation, e.g. "Connection has come up across a few recent dreams and your last session — is that
something you'd like to explore?" Surfaced as:

- A **dismissible nudge** — a spec-35 `coaching-synthesis` notification (info) and/or a Home
  **InsightOfTheWeekCard** (§11) with an action that **opens a session seeded** on the observation
  (the Home→builder seed-handoff precedent, 17 §13) or links to the relevant surface (Memory / Dreams).
- **Cached + view-only until acted on** — like the dream-patterns narrative, the latest synthesis is
  cached (`people/<id>/coaching/synthesis.enc`, §4.1) so re-display costs nothing; it is **not**
  auto-promoted into the coach's grounding context (that would re-spend / risk staleness) — it's a
  surfaced suggestion the user engages with.
- **Explicit budget guardrails (§3.4)** — this is the one **extra** AI spend this spec introduces.

### 3.4 Synthesis cadence, cost & guardrails

The synthesis pass is the cost-bearing part; its exact cadence + cap + opt-out are **§11** (do not
assume). The candidate shape, modelled on spec 36's renderer-driven cadence + spec 39's auto-reconcile
guardrails:

- **Renderer-driven trigger** — a hook on launch / focus (mirroring `useUpdateChecks`), gated by a
  setting (the §11 proactivity level), firing **at most once per throttle window** (candidate: weekly,
  §11) and **only when warranted** (e.g. ≥ N new insights since the last synthesis, via a pure
  `shouldSynthesize(state, now)` helper — unit-testable, keyed on `lastSynthesizedAt` + an insight-count
  delta). Never a background cron.
- **Budget-gated** — checks the person + app budget (the `checkBudget` pattern) before the call; **over
  budget / AI off / offline → skips silently** (no dead UI, no alarming log), falling back to the
  cached synthesis. A new **per-period cap** specific to proactivity may be wanted (§11) so it can never
  dominate the budget.
- **Metered** — records `coaching.synthesize` **before** parsing (a paid call whose JSON fails is still
  billed — the meter-before-parse rule, spec 06 / `sessionAnalysisService`).
- **Tolerant parse, honest failure** — the pass adopts spec 37's pattern: require only the essential
  field, `.catch` optional fields, salvage truncation, and distinct `REFUSED`/`TRUNCATED`/`MALFORMED`/
  `ERROR` reasons (a failed synthesis is a silent no-op for the user — it's a background nicety, not a
  surface they requested).

### 3.5 Cross-insight crisis awareness

Separate from the cheerful nudges, a **deterministic** (no-AI) aggregation reads the **recent**
insights' `crisisFlag` (+ the dream nightmare nudge, 12 §8.2) and, when distress **recurs** across a
bounded recent window (candidate: ≥ N crisis-flagged insights in the last M days OR the nightmare
nudge, §11), surfaces a **supportive, resources-first** affordance — reusing the **always-present
crisis surfaces** (`CrisisFooter`, the Home crisis-supportive banner 17 §7), **leading with concern +
professional resources**, never a metric, score, or alarm. It is **NEVER a dismissible notification**
(spec 35 §8 keeps crisis out of the dismissible system). The tone is gentle ("you've been carrying a
lot lately — it might help to talk to someone"), and it routes to emergency services / a crisis line,
**not** an attempt by SelfOS to manage it.

### 3.6 Proactivity setting

A setting lets the user **tune or turn off** proactivity (some want a quiet tool). **Resolved (§11):** a
single `coaching.proactivity` enum (`off` | `gentle` | `active`, **default gentle**), **per-person**
(each persona tunes their own coach) — stored in a per-person `CoachingPrefs` file
(`people/<id>/coaching/prefs.enc`, §4.1a, the guidance-prefs precedent) and read in the bridge with
`personId` (the trust boundary), **not** the household-wide schema-driven settings registry (whose
`vault`/`device` scopes can't express per-active-person). Surfaced as a **custom control** in the
**Sessions** settings section, with copy that makes clear it is gentle reflection, never surveillance:

- `off` — no in-session goal-raising, no synthesis pass, no goal-followup nudges. (Cross-insight crisis
  awareness, §3.5, is **safety** and is **not** disabled by this — it's never naggy and never spends.)
- `gentle` (default candidate) — in-session goal-raising + synthesis on a slow cadence + at most one
  open nudge.
- `active` — a faster synthesis cadence + a slightly more present in-session coach.

The §29 `intake.inSessionDepthAsk` setting stays its own (depth invitations are a distinct concept);
§11 decides whether to fold both under one "how proactive should SelfOS be?" control.

### 3.7 Coordination (no spam)

All four nudge sources (depth-invitations, profile-suggestions, recurring-pattern/synthesis
observations, goal check-ins) flow through **one** coherent surface layer — the spec-35 notification
registry's **coalesce/re-surface** rules + the existing Home cards' self-hiding — so the same concern
never appears twice (e.g. a synthesis observation about "family" and a depth-invitation for the family
section coalesce or one yields). The §29 profile-freshness Home card + spec-35 `profile-freshness`
notification already coexist (17 §11); this spec adds its kinds **into the same coalescing**, and Home
cards self-hide when the corresponding notification owns the signal (the rule §11 must pin per kind).

## 4. Data model (vault files & schemas)

Additive-optional throughout (the §18/§20/§28/§39 precedent — no `schemaVersion` bump, no migration,
existing records parse byte-for-byte). All reads/writes go through the vault + crypto service
(`@selfos/core/vault`, `00` §4.3); no direct `fs`. Per-person isolation (every file under
`people/<subjectPersonId>/…`).

### 4.1 The cross-feature synthesis (cached, per-person)

A new per-subject cached record (mirrors `DreamPatternSummary`):

```ts
// @selfos/core/schemas.ts — illustrative, Zod-first; tolerant-parse per spec 37
export const CoachingSynthesisSchema = z.object({
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1), // per-person isolation
  observation: z.string(), // the one gentle cross-feature observation (the only required field)
  sources: z.array(z.string()).default([]), // which surfaces fed it ("dreams", "session 2026-06-20"), for provenance/dedup
  lifeArea: z.string().optional(), // from LIFE_AREAS, normalized server-side — drives coalescing with depth/freshness
  computedAt: z.string(),
  windowFrom: z.string().optional(), // the recency window the digest covered
  windowTo: z.string().optional(),
});
export type CoachingSynthesis = z.infer<typeof CoachingSynthesisSchema>;
```

- Stored at `people/<id>/coaching/synthesis.enc`. Re-running **overwrites** it (one current observation
  per person; it is a suggestion, not history). It is **not** an `Insight` and **not** promoted into
  `summarizeForContext` (§3.3) — to avoid re-spend / staleness; it's a surfaced nudge.
- The dismissed/acted state of the **nudge** for this synthesis is **device-local + per-person** read/
  dismissed signature in the spec-35 notification store (35 §4) — keyed by `coalesceKey` (the synthesis
  `computedAt`/`lifeArea`), so dismissal sticks until a new synthesis supersedes it.

### 4.1a Per-person proactivity preference (`CoachingPrefs`)

The proactivity level (§3.6) is a **per-person** preference, stored alongside the cached synthesis:

```ts
// @selfos/core/schemas.ts — additive-optional
export const ProactivityLevelSchema = z.enum(['off', 'gentle', 'active']);
export const CoachingPrefsSchema = z.object({
  schemaVersion: z.number().int().positive(),
  proactivity: ProactivityLevelSchema.optional(), // absent ⇒ default 'gentle'
});
export type CoachingPrefs = z.infer<typeof CoachingPrefsSchema>;
```

- Stored at `people/<id>/coaching/prefs.enc` (the `GuidancePrefs` precedent). Read in the bridge with
  `personId` (the trust boundary) wherever proactivity gates a behaviour (in-session raise §3.1,
  synthesis cadence §3.4, goal-followup nudges §3.2). Absent ⇒ `'gentle'`. The cross-insight crisis
  surface (§3.5) does **not** read this — it is safety and is never disabled.

### 4.2 Cadence/throttle state (device-local)

`lastSynthesizedAt` (per-person) drives `shouldSynthesize` and the throttle. It rides the **device-state
store** (per-person, like nav-collapse / the spec-36 update-cache / spec-39's auto-reconcile state) —
**not** the vault (it's ephemeral, device-scoped UI cadence state, and must not sync). No new vault file.

### 4.3 Goals & threads — consumed, not owned

Goal entities (`Goal`, status, due/horizon, `lastTouchedAt`) are **defined and owned by spec 39**
(§4.1). This spec **reads** them (`goals:list`, the open/stale set) for §3.1 in-session raising and
§3.2 follow-up nudges, and calls spec-39's `goals:setStatus` from the nudge actions. **No goal schema
lives here.** Recent **follow-ups/threads** are read from session insights' `Follow-up:` facts (or,
post-39, structured) — also read-only.

### 4.4 Usage / metering

- **One new usage type** for the extra pass: **`coaching.synthesize`** (added to
  `usageTypes.ts` `USAGE_TYPE_LABELS`, label e.g. "Coaching — weekly synthesis"). It is the **only new
  AI spend** this spec introduces. Metered before parse (§3.4), included in the usage dashboard +
  budgets (spec 06) like every other type; the admin-$ redaction at the bridge is unchanged.
- **No new spend** for in-session goal-raising (§3.1 rides the existing chat turn), goal-followup nudges
  (read existing data), or cross-insight crisis awareness (§3.5 is deterministic, no AI).

### 4.5 No other persisted data

Proactive **nudges** are **derived** (computed from live state: open/stale goals, the cached synthesis,
recent crisis flags) — the spec-35 model. Only the cached synthesis (§4.1), the device-local cadence
state (§4.2), and read/dismissed **signatures** (in spec 35's store) persist. No new vault content
files beyond `coaching/synthesis.enc`.

## 5. Architecture & modules

No new feature module — this is `@selfos/core` services + additions to the existing notification
registry (35), Home cards (17), the prompt builder (05), and a settings section. Changes by area:

### 5.1 In-session proactivity (`@selfos/core/conversations` + the bridge)

- A pure **`goalRaiseInstruction(ctx)`** (sibling of `depthAskInstruction` in `profile/depthInvitations.ts`)
  — given the bounded open/stale goals + recent threads, returns the guarded, relevance-gated
  invitation, or `''` when there's nothing/proactivity is off. Appended in `buildSystemPrompt` **after**
  `PERSONA + SAFETY + context`, before `FORMATTING` (like `depthAsk`). The boundary always leads.
- The bridge (`coreBridge.ts` chat handler) assembles it — reads the proactivity setting + `goals:list`
  (open/stale set, bounded) — exactly where it already assembles `depthAsk` (~line 1538), so it's one
  more optional prompt part, no new call.

### 5.2 Cross-feature synthesis (`@selfos/core`)

- A new **`coachingSynthesisService`** (`@selfos/core/coaching` or under `insights`): `synthesize(deps)`
  (budget-gated → bounded cross-source digest → one Claude call → tolerant parse [spec 37] → meter
  [`coaching.synthesize`] → cache `CoachingSynthesis`), `getSynthesis(personId)` (cached read, no
  spend), and a pure **`shouldSynthesize(state, now)`** (the cadence/throttle decision, unit-tested).
  The digest reuses the existing readers — `listInsightsForPerson` (summaries/facts only),
  `getPatternStats`/`getPatternSummary` (dreams), questionnaire insights — and the
  `PERSONA + SAFETY + guidance` framing (no raw transcripts; structured context only, the gap-finder
  rule). The API key stays in main.
- A pure **`aggregateCrisisSignal(insights, dreamStats, now)`** (no AI) for §3.5 — bounded recent
  window, returns a `{ recurring: boolean, since }`-style signal the renderer surfaces supportively.

### 5.3 Surfacing (renderer — specs 35 + 17)

- **Notification kinds** — register `goal-followup`, `coaching-synthesis` in the spec-35 registry
  (icon/severity=info/action/coalesce + per-kind re-surface rule). Their derived sources (open/stale
  goals, the cached synthesis) feed `useNotificationSources` (the spec-35 `resolveNotifications`
  pattern). **Crisis is NOT a kind** (§3.5 / 35 §8).
- **Home cards (if §11 chooses Home)** — small presentational cards reusing existing primitives (Card/
  Stack + the §17 seed-handoff): `GoalFollowupCard`, `InsightOfTheWeekCard` (the synthesis). Self-hiding
  on empty; per-person via the existing Home load (17 §3.4). No new design-system primitive unless a
  genuinely new pattern emerges (then `/gallery`, DoD §12).
- **Cadence hook** — an AppShell hook (`useCoachingSynthesis`, mirroring `useUpdateChecks`) firing the
  synthesis on launch/focus when `shouldSynthesize` + budget + setting allow; throttled, per-person.
- **Stores** — any new per-person store (a `synthesisStore`, if not folded into the notification/Home
  store) **resets on `activePerson.id` change** in the AppShell reset (the per-person isolation rule).

### 5.4 Settings

- A **per-person** `coaching.proactivity` preference (§3.6 / §4.1a) surfaced as a **custom control**
  (a select: Off / Gentle / Active) in the Sessions settings section, with non-surveilling copy. It is
  stored per-person (`CoachingPrefs`) and **enforced at the bridge** (the trust boundary), not the
  schema-driven settings registry (which is household/device-scoped). New IPC `coaching:getPrefs` /
  `coaching:setPrefs` (gated `sessions.own`, active-person-scoped) back the control.

## 6. IPC / API contracts

All gated by **`sessions.own`** + **active-person-scoped in the bridge** (the trust boundary); the
Claude key stays in main (`00` §6.2). Renderer payloads Zod-validated both sides.

- **`coaching:synthesize({ override? })`** → `CoachingSynthesisResult` — runs the cross-feature pass
  (budget-gated, metered `coaching.synthesize`, tolerant-parsed); typed envelopes `{ ok: true, synthesis
} | { ok: false, reason: 'NO_KEY' | 'BUDGET' | 'AI_OFF' | 'EMPTY' | 'REFUSED' | 'TRUNCATED' |
'MALFORMED' | 'ERROR', message }` (the spec-37 honest taxonomy; `EMPTY` = not enough recent material).
  The renderer cadence hook calls this only when `shouldSynthesize` + budget allow; a manual "What are
  you noticing?" affordance (if §11 adds one) forces it.
- **`coaching:getSynthesis()`** → the cached `CoachingSynthesis | null` (no spend) — for re-display.
- **Cross-insight crisis signal (no IPC channel — renderer-computed).** _As built:_ the deterministic
  `aggregateCrisisSignal` (no AI, no spend) runs in the **renderer** (Home), over the per-person insights +
  dream pattern stats Home already loads — exactly like the existing `hasRecentCrisis` it supersedes. No
  `coaching:crisisSignal()` bridge channel was added (it would only re-fetch data the renderer already holds
  per-person); the pure helper lives in `@selfos/core/coaching` and is unit-tested. Resources-first; carries
  no diagnosis.
- **`coaching:getPrefs()`** / **`coaching:setPrefs({ proactivity })`** → the per-person `CoachingPrefs`
  (§4.1a). Gated `sessions.own`, active-person-scoped in the bridge. Backs the §5.4 settings control.
- **Goal nudges reuse spec 39's IPC** — `goals:list` (read open/stale), `goals:setStatus` (the nudge's
  Still on it / Mark done / Let it go). **No new goal channel here.**
- **Notification read/dismissed** rides spec 35's `notifications:getState` / `:setState` (the new kinds'
  signatures persist there, per-person/device-local). No new persistence channel.
- **Settings** rides the existing settings channels (spec 03); the proactivity setting is one
  declaration.
- **Claude** — only `coaching:synthesize` makes a call: bounded structured JSON, `extendedThinking:
false` (the `[[adaptive-thinking-shares-maxtokens]]` rule), meter-before-parse, tolerant parse +
  honest reasons (spec 37). In-session raising adds **no** call (rides the chat turn).

## 7. States & edge cases

- **No goals / fresh person** → no in-session raising, no goal-followup nudge, synthesis returns
  `EMPTY` (silent no-op); nothing surfaces.
- **Not enough material for synthesis** (< N recent insights) → `shouldSynthesize` false / `EMPTY`; the
  cached synthesis (if any) still re-displays until superseded.
- **AI off / no key / offline** → synthesis **skips silently** (cached one still shows); in-session
  raising simply isn't added (the prompt is built without it); goal-followup nudges + crisis awareness
  (both no-AI) still work. No dead buttons, no alarming logs (the spec-31 calm-state rule + 35 §7).
- **Over budget** → synthesis skips (budget-gated); a manual force respects the override path
  (`checkBudget` override), like other passes. In-session raising is free, unaffected.
- **Throttled** → at most one automatic synthesis per window; a manual force overrides the throttle.
- **Proactivity off (§3.6)** → no in-session raising, no synthesis, no goal-followup nudges; crisis
  awareness (§3.5) **still on** (it's safety, never naggy, never spends).
- **Duplicate/coalescing** → a synthesis observation about an area + a depth-invitation/freshness nudge
  for the same area coalesce or one yields (§3.7); the same goal never produces two open nudges
  (coalesce by `goal-followup`).
- **Goal acted-on/dismissed** → the nudge suppresses until the goal's state changes (`onChange`
  re-surface, 35 §11); "let it go" abandons it (39) so it never returns.
- **Stale synthesis** → re-running overwrites the cached record; the prior nudge's signature is
  superseded (35 dedup), so the user never sees two synthesis nudges.
- **Crisis recurs** → §3.5 surfaces supportively, resources-first, **non-dismissible**; it never
  becomes a notification; in-session raising/synthesis nudges yield to it (the prompt + the renderer
  prioritize the crisis surface).
- **Person switch** → all proactive stores reset; a synthesis in flight is discarded; the new person's
  cached synthesis + their own goals/crisis signal load (the per-person isolation rule, the 17/35 race
  guard — guard async loads with the active id).
- **Spec 39 not yet landed** → the goal-consuming pieces (§3.1 raise, §3.2 nudge) are gated on 39;
  cross-feature synthesis (§3.3) + crisis awareness (§3.5) can ship without goals (they read insights/
  dream patterns), so this spec degrades gracefully if sliced ahead of 39 (§10/§12).
- **Sync conflict / corrupt synthesis file** → handled by the vault service as today (`00` §4.3); a
  corrupt cached synthesis surfaces a typed error and is simply not displayed (recompute on next
  cadence). The pass is a pure transform over already-validated records.
- **Migration** → none (additive-optional, §4); a pre-40 vault has no cached synthesis + no proactivity
  setting (defaults apply) — both handled by the fallbacks above.

## 8. Safety

This is a wellbeing/conversation feature that **acts** on the user, so the boundary is paramount
(CLAUDE.md §1, `05` §7, `35` §8, `39` §8):

- **Not medical / not therapy.** Proactive nudges and the in-session coach are **reflective
  invitations**, never a treatment plan, assessment, or risk score. The synthesis observation is offered
  as "something to wonder about," never a finding. `PERSONA + SAFETY` **lead** every prompt (the
  in-session instruction is appended after them, like `depthAsk`); the synthesis pass reuses
  `PERSONA + SAFETY + guidance`.
- **Never naggy, never surveilling.** A proactive coach that nudges about feelings must never feel like
  a checklist or a watcher. Guardrails: at most one open goal nudge; relevance-gated in-session
  (raise once, then let go); a slow default synthesis cadence; a real **off** switch (§3.6). Copy is
  warm and low-pressure ("totally fine to let it go"). Tie to the wellness positioning.
- **Crisis is sacred and always-present.** §3.5 aggregates distress **supportively, resources-first**,
  routing to professional help — it is **never a dismissible notification** (35 §8) and **never disabled
  by the proactivity setting** (§3.6). Any nudge/in-session raise **yields** to a crisis surface. SelfOS
  does not attempt to manage a crisis itself.
- **Privacy is sacred.** Everything is **per-person** (single-subject). The synthesis digest sees only
  the **active person's own** insights/dream-patterns/goals — never another subject's data; it runs
  **behind** `summarizeForContext`'s restricted/shareable/flagged filters (a restricted/flagged fact
  never feeds it). The bridge is the trust boundary for every new channel. **No proactive copy may imply
  an owner/admin can see a person's content** (the durable rule, CLAUDE.md §1) — a goal-followup or
  synthesis nudge is addressed only to the person whose data it is, and reveals nothing cross-person.
- **Honest, calm signals.** A failed synthesis is a silent no-op (it's a background nicety); the "what
  I'm noticing" tone is gentle; nudges never imply judgment. Tolerant-parse + honest reasons (spec 37)
  mean we never blame the user's data for a model hiccup.

## 9. Accessibility

Per [`01`](01-design-system.md) §9 and inheriting specs 35 + 17:

- The new notification kinds inherit spec-35 a11y (keyboard-navigable center, `aria-live` toasts, labeled
  actions, non-color-only icons, reduced-motion). Goal-followup actions (Still on it / Mark done / Let it
  go) are labeled buttons, keyboard-operable, visible focus.
- Home cards (if chosen) inherit spec-17 a11y (labeled regions, logical heading order, real keyboard CTAs).
- The cross-insight crisis surface reuses the existing always-present `CrisisFooter` / supportive banner
  (already accessible) — resources are real, focusable links; nothing color-only or motion-dependent.
- The proactivity setting reuses the schema-driven settings UI a11y (spec 03). Responsive ~360px→desktop
  (cards/nudges reflow; no horizontal scroll — CLAUDE.md §12). Any genuinely-new primitive → `/gallery`.

## 10. Dependencies & sequencing

- **Hard dependency: spec 39** for first-class goals (§3.1/§3.2) and a clean, deduped memory for the
  synthesis digest. If 39 lands first (recommended), the goal-consuming pieces build directly on
  `goals:*`. If this spec is sliced ahead of 39, ship the **goal-free** parts (cross-feature synthesis
  §3.3 + crisis awareness §3.5, which read insights/dream-patterns) first, and add goal follow-through
  when 39 lands (§12 slice order reflects this).
- **Spec 37** — every new AI-JSON producer (the synthesis pass) adopts the tolerant-parse + honest-failure
  pattern from day one (a §2 requirement). Coordinate the shared utility if 37 lands it.
- **Spec 35** — the nudge surface (new kinds + coalescing). **Spec 17** — the Home-card surface. **Spec
  06** — the new `coaching.synthesize` usage type + budgets. **Spec 05/09** — the in-session injection
  point + the producers. All are on `main`; this spec adds content, not chrome.
- Built **after** the data layer it consumes is real (like 17 was built last); incremental slicing in §12.

## 11. Open questions

**RESOLVED with the user 2026-06-24** (all decisions below are final; the spec body is written against
them). Summary of the resolutions:

1. **Proactivity setting & default (Q1)** — a **single `coaching.proactivity` enum**
   (`off` | `gentle` | `active`), **default `gentle`**. The §29 `intake.inSessionDepthAsk` stays its
   **own separate setting** (depth invitations are a distinct concept; not folded in).
2. **Where nudges live (Q2/Q3)** — **all three, coalesced**: the live coach raises a goal/thread
   **in-session** (free) **AND** a Home **GoalFollowupCard**; the cross-feature synthesis surfaces as
   **both** a Home **InsightOfTheWeekCard** **and** a spec-35 `coaching-synthesis` notification. Every
   kind flows through the spec-35 coalesce/dedup + Home self-hide so nothing appears twice.
3. **Goal check-ins (Q3)** — both in-session (relevance-gated, **raise at most once** then let go) and
   the out-of-session nudge (**≤1 open `goal-followup` at a time**, coalesced).
4. **Synthesis cadence/cap/opt-out (Q4)** — renderer-driven on **launch/focus** (mirroring
   `useUpdateChecks`); fires **at most once per 7-day window** AND **only when ≥3 new insights since the
   last synthesis** (pure `shouldSynthesize`). **Budget-gated + a proactivity-specific per-period cap**
   so it can never dominate spend. `coaching.proactivity === 'off'` **disables it entirely**. `active`
   uses a faster window (candidate 3 days / ≥2 new insights).
5. **Tone guardrails (Q5)** — ≤1 open nudge at a time, a slow default cadence, warm low-pressure copy
   ("totally fine to let it go"), a real **off** switch; tied to the wellness/not-medical positioning;
   never implies an owner/admin can see a person's data.
6. **Per-person scope (Q6)** — the proactivity setting is **per-person** (each persona tunes their own
   coach), stored in a per-person `CoachingPrefs` file (`people/<id>/coaching/prefs.enc`, the
   guidance-prefs precedent) and **read in the bridge with `personId`** (the trust boundary). The
   cross-insight crisis surface (§3.5) stays **on regardless** of this setting and is **never** a
   dismissible notification.
7. **Crisis thresholds & placement (Q7)** — supportive surface when **≥2 crisis-flagged insights in the
   last 14 days OR the dream nightmare nudge** (deterministic, no AI); appears as the **Home
   WellbeingCard supportive banner** (resources-first) alongside the always-present `CrisisFooter`.
   Never a metric/score/alarm, never a notification.
8. **Manual affordance (Q8)** — **yes**, add a manual **"What are you noticing lately?"** explicit-tap
   affordance (forces a synthesis past the throttle) **in addition to** the automatic cadence.
9. **Coalescing per kind (Q9)** — a synthesis observation **yields** to a depth-invitation /
   profile-freshness nudge for the **same life-area** (the more specific, actionable nudge wins). _As
   built:_ the synthesis **Home card (the persistent action surface) and its notification (the transient
   alert) coexist** — the established profile-freshness card+notification pattern (17 §11) — rather than the
   card self-hiding; the substantive dedup is the cross-kind same-area yield above, so the user never sees
   two prompts about the same area.

---

_Original open questions (now resolved above), retained for traceability:_

Genuinely-open product/UX/cost/tone decisions — **do not assume**; resolve with the user before
building. These are material, cost-bearing, and tone-sensitive.

1. **How proactive, and the default level (§3.6).** A single `coaching.proactivity` enum
   (`off` / `gentle` / `active`) or independent per-surface toggles? What is the **default** (candidate:
   `gentle`)? Should it fold the §29 `intake.inSessionDepthAsk` under one "how proactive should SelfOS
   be?" control, or keep them separate?
2. **Where do nudges live (§3.2/§3.3)?** Goal check-ins and the cross-feature synthesis observation —
   **spec-35 notification**, **spec-17 Home card**, **in-session only**, or a combination per kind? (The
   §35 model + §17 cards both exist; the user picks the mix so it's coherent, not duplicative.)
3. **Goal check-ins: in-session, push, or both (§3.1/§3.2)?** Is goal follow-through the live coach
   raising it (free, contextual), a notification/Home nudge (proactive even when not in a session), or
   both? How aggressively (the in-session "raise at most once" + the nudge cap)?
4. **Synthesis cadence, cap & opt-out (§3.4).** How often does the cross-feature synthesis pass run —
   weekly, every Nth new insight, a gap, app-launch/focus, or a combination? What's N / the gap / the
   throttle window? Is there a **proactivity-specific per-period budget cap** so it can never dominate
   spend? Does the proactivity `off` setting disable it entirely (recommended yes)?
5. **Tone guardrails (§8).** What concrete limits keep it from feeling naggy or surveilling — max open
   nudges at once, minimum quiet period after a dismissal, copy register? Tie to the wellness/not-medical
   positioning and the "never imply an owner can see your data" rule. (Recommendation: ≤1 open nudge,
   slow default cadence, warm low-pressure copy, a real off switch.)
6. **Per-person scope & the not-medical boundary (§3.6/§8).** Is the proactivity setting **per-person**
   (each persona tunes their own coach) or household? (Recommendation: per-person, like
   `intake.inSessionDepthAsk` reads.) Reconfirm the cross-insight crisis surface stays **on regardless of
   the proactivity setting** and is **never** a dismissible notification.
7. **Cross-insight crisis detection thresholds (§3.5).** How many crisis-flagged insights in how many
   days (and/or the nightmare nudge) constitute "recurring distress" worth the supportive surface? Where
   exactly does it appear (Home banner, a Memory line, an in-session lead) — without ever alarming?
8. **Synthesis as a manual affordance too (§6).** Besides the automatic cadence, do we add a manual
   "What are you noticing lately?" button (explicit-tap spend, the 17 §13 explicit-spend precedent), or
   keep synthesis purely automatic + cached?
9. **Coalescing rules per kind (§3.7).** When a synthesis observation about an area AND a
   depth-invitation/freshness nudge for the same area both exist, which wins / how do they coalesce so
   the user sees one coherent prompt? And do the Home cards self-hide when the notification owns the
   signal (or vice-versa)?

## 12. Proposed build slices (after approval)

Each slice is independently shippable, gated, and tested (DoD §7); sequence after §11 is resolved (and
after spec 39's goals land for the goal-consuming slices).

1. **In-session proactivity (cheap, no new spend):** `goalRaiseInstruction` + the bridge assembly
   (alongside `depthAsk`) + the proactivity setting (§3.6). Gated on spec-39 goals. Unit (the pure
   instruction builder) + a prompt-builder integration test + an E2E (a session raises a relevant open
   goal once; proactivity-off omits it; safety yields).
2. **Cross-insight crisis awareness (deterministic, no AI):** `aggregateCrisisSignal` +
   `coaching:crisisSignal` + the supportive surface (reuse `CrisisFooter`/the Home banner). Non-dismissible,
   not disabled by the setting. Unit + RTL + E2E (recurring distress → supportive resources-first surface).
3. **Cross-feature synthesis (the extra AI pass):** `coachingSynthesisService` (`synthesize` +
   `getSynthesis` + `shouldSynthesize`) + `coaching.synthesize` usage type + tolerant parse (spec 37) +
   budget/throttle guardrails + the cadence hook + the cached record. Surfaced first as one nudge (per
   §11 Q2). Unit (digest/cadence/budget-skip) + RTL + E2E (synthesis fires on the trigger, records the
   usage event, skips over budget, surfaces a dismissible nudge; decrypt the cached record).
4. **Goal follow-through nudges:** the `goal-followup` kind + (if §11) the Home `GoalFollowupCard`, the
   Still on it / Mark done / Let it go actions (spec-39 `goals:setStatus`), coalescing/no-spam (§3.7).
   RTL + E2E (a stale goal surfaces a nudge → Mark done closes it → it doesn't re-surface).
5. **Coordination & polish:** dedup/coalesce the new kinds with depth/freshness across 35 + Home
   (§3.7); the manual synthesis affordance if §11 Q8 chooses one; 360px overflow + a11y guards across
   every surface.

(Depends on specs 35/17/06/05/09 — all on `main` — and on spec 39's goals for slices 1 & 4. Slices 2
& 3 can ship ahead of 39.)

## 13. Changelog

- 2026-06-24 — **BUILT (all 5 slices).** On `feat/proactive-coaching`. **Slice 1 (in-session + setting):**
  `@selfos/core/coaching` `goalRaiseInstruction` (pure, the `depthAskInstruction` sibling) + `CoachingPrefs`
  (per-person `coaching.proactivity`, off/gentle/active, default gentle) read in the bridge; `buildSystemPrompt`
  threads an optional goal-raise appended AFTER persona+safety+context; `coaching:getPrefs/setPrefs`; a
  member-visible **Coaching** settings section + `ProactivityControl`. **Slice 2 (crisis, no-AI):**
  `aggregateCrisisSignal` (≥2 crisis flags in 14d OR the nightmare nudge) computed in the renderer; a Home
  `CrisisSupportBanner` (non-dismissible, resources-first, not governed by the setting) that supersedes the
  WellbeingCard's session-only banner (`hasRecentCrisis` removed). **Slice 3 (synthesis pass):**
  `coachingSynthesisService` (`synthesize`/`getSynthesis`/pure `shouldSynthesize`/`countNewInsights`),
  `CoachingSynthesis` cache + `coaching.synthesize` usage type + a per-person device-state throttle marker;
  tolerant-parse + meter-before-parse; `coaching:synthesize({auto?})`/`getSynthesis`; a renderer cadence hook +
  `synthesisStore` + Home `InsightOfTheWeekCard` ("Talk it through" seeds a session via a Composer
  `initialText` handoff) + a manual run. **Slice 4 (goal nudges):** the `goal-followup` notification kind +
  source (≤1, stalest, onChange) + Home `GoalFollowupCard` (Still on it / Mark done / Let it go →
  `goals:setStatus`). **Slice 5 (coordination):** the `coaching-synthesis` notification kind + source with the
  same-area yield to depth/freshness; phone-width overflow polish. Code-reviewer **ship after one should-fix**
  (the synthesis EMPTY gate now counts RECENT in-window insights so an all-stale history can't bill an empty
  digest; +per-person setting scope `device`; honest `AI_OFF`). Gate green: typecheck, lint, format, **697
  core + 11 relay + 715 desktop** unit, **99 E2E** (+4: per-person Coaching setting decrypt round-trip,
  recurring-distress banner, synthesis card + seed-handoff, stale-goal nudge + Mark-done decrypt). **As-built
  deviations from §6/§3.7 (recorded above):** (a) NO `coaching:crisisSignal()` channel — the deterministic
  signal is renderer-computed over data Home already holds per-person (the `hasRecentCrisis` precedent); (b)
  the synthesis Home card + notification **coexist** (the 17 §11 pattern) rather than the card self-hiding —
  the cross-kind same-area yield is the dedup. **Lesson: a synthesis/EMPTY gate must use the SAME recency
  window the digest does — counting all-time approved insights let an all-stale history pass the gate and pay
  for an empty digest; and a per-person preference belongs in a `CoachingPrefs` file read in the bridge, not
  the household/device settings registry (whose scopes can't express per-active-person — the registry entry
  stays inert).**
- 2026-06-24 — **Approved.** All §11 open questions resolved with the user (recorded at the top of §11):
  single `coaching.proactivity` enum (off/gentle/active, default **gentle**, **per-person** via a
  `CoachingPrefs` file — §4.1a — read in the bridge, depth-ask kept separate); nudges live **in-session +
  Home cards + spec-35 notifications, coalesced**; synthesis on a **weekly throttle + ≥3-new-insight**
  launch/focus cadence with a proactivity-specific per-period cap, disabled by `off`; a **manual "What
  are you noticing lately?"** affordance in addition; cross-insight crisis surface at **≥2 crisis flags
  in 14 days OR the nightmare nudge** → the Home supportive banner (never a notification, never disabled
  by the setting); a synthesis observation **yields** to a same-area depth/freshness nudge and Home cards
  self-hide when a notification owns the signal. Body (§3.6/§4.1a/§5.4/§6) updated to match.
- 2026-06-23 — created (Draft). Part of the 2026-06 five-spec group (37–41); the **behaviour** layer
  consuming spec 39's structured goals + coherent memory. Grounded against
  `sessionAnalysisService.ts` (goals/depth/profile-suggestions are recorded but NOT fed into the
  in-session prompt), `promptBuilder.ts`/`buildContext.ts` (the coach gets no proactive instruction;
  the §29 `depthAsk` is the in-session-injection precedent, assembled in `coreBridge.ts` ~1538),
  `dreams/dreamPatternService.ts` (patterns exist but aren't woven into coaching; no cross-feature
  synthesis), per-insight `crisisFlag` (no aggregation), and `usageTypes.ts` (the metering pattern).
  Defines goal follow-through (in-session + nudge), a metered cross-feature synthesis AI pass with
  budget guardrails, coordinated proactive nudges via specs 35/17, in-session proactivity (PERSONA +
  SAFETY leading), cross-insight crisis awareness (resources-first, non-dismissible), and a tunable/
  opt-out proactivity setting. Open product/UX/cost/tone decisions (how proactive + default; where
  nudges live; synthesis cadence/cap/opt-out; tone guardrails; per-person scope + not-medical boundary;
  crisis thresholds; manual affordance; coalescing) in §11 — to resolve with the user before building.
