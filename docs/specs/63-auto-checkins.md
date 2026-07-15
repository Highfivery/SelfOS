# 63 — Auto check-ins (autonomous questionnaire generation)

> **Status:** Built (slices A–C) · §11 resolved · _last updated 2026-07-15_
>
> An opt-in, per-person engine that once a day looks at everything SelfOS has learned about a person
> (sessions, memory/insights, goals, dreams, Together, questionnaire history, onboarding) and — if that
> person's queue isn't already full — **generates and delivers fresh, personalized questionnaires on its
> own**, never re-asking what it already knows, mixing _go deeper_ / _expand_ / _explore new_, and always
> reserving 1–2 slots for **completely unfiltered intimacy** (18+-gated; partner-only when targeting others).
> It promotes the existing **gap-finder** from "suggest, wait for a tap" to autopilot, wrapped in a
> self-regulating queue, an adaptive cadence, and a small per-person configuration surface.

This **reuses, does not duplicate**, the questionnaire AI stack. It consumes:
[`08`](08-questionnaires.md) — `generateQuestions` + the recipient-aware de-dup (fuzzy + semantic), the
gap-finder `suggestQuestionnaires` + saved-suggestion store, the sensitivity tiers +
`explicitFraming` + `INTIMACY_TOPICS`/`coveredIntimacyActs`, the assignment lifecycle
(`createAssignment`, the Inbox, `isAnswerable`), and the analysis→Insight loop;
[`06`](06-ai-usage-and-budgets.md) — metering + the person/app budget gates;
[`40`](40-proactive-coaching.md) — the per-person `CoachingPrefs`/proactivity pattern +
`aggregateCrisisSignal` crisis suppression;
[`39`](39-living-memory-continuity.md) — the once-a-day launch/focus cadence with a device-local
per-person throttle (`shouldAutoReconcile` + `useMemoryReconcile`) and goals;
[`53`](53-home-encouragement.md) — the recommendation registry + "For you" surface;
[`35`](35-notification-system.md) — the coalesced notification surface;
[`18`](18-personal-onboarding.md) / [`50`](50-self-assessments.md) / [`58`](58-together-couples-sessions.md)
— the Insight producers whose facts drive both tailoring and de-dup;
[`42`](42-relationship-scoped-sharing.md) / [`43`](43-relationship-scoped-onboarding-sharing.md) — the
relationship graph + shareable/relationship-type boundary; and
[`04`](04-people-roles.md) (active person, roles/capabilities), [`00`](00-architecture.md) (vault/IPC/
security), [`01`](01-design-system.md) (primitives/tokens). References them rather than restating (DRY).

---

## 1. Overview

SelfOS learns a great deal about a person — but the person has to _remember to ask it to ask_. The
gap-finder ([`08 §13.3`](08-questionnaires.md)) already reads a person's structured context and proposes
questionnaire ideas with rationales, and the "Suggested" panel surfaces them — but nothing is created until
the person taps **Create from this**, edits, and sends. In practice that means the app's ability to keep
_learning_ about someone stalls the moment they stop manually authoring questionnaires.

**Auto check-ins** closes that loop. When enabled for a person, once a day (on launch/focus, no backend —
§3.4) the engine:

1. **Plans** what would be most valuable to ask next — a mix of _deepening_ a recent signal (a session
   theme, a stale goal, a notable dream), _expanding_ into an adjacent area, and _exploring_ something never
   touched — plus a mandatory **unfiltered intimacy** slot or two.
2. **Generates** each questionnaire with the existing `generateQuestions` + full recipient-aware de-dup, so
   it never re-asks what the app already knows, goes deeper on what it does, and explores what it doesn't.
3. **Delivers** it into the recipient's Inbox, tagged **"Auto check-in"** with a one-line _why_.
4. **Learns** — answers → analysis → Insight → Memory → the next run knows more and asks something new.

A person can configure this for **themselves** and/or for **other people** they care about (e.g. a partner).
Each configured **target** is its own _stream_ with its own settings (enabled, include-intimacy, an
"exploration focus", a base cadence) and its own self-regulating queue. The engine is **opt-in and per
person** (default off), spends the author's AI budget, and is bounded by a per-stream queue cap, a crisis
gate, and the budget gate.

**Where it sits.** It is a new **feature module** that registers: a config panel on the Questionnaires page,
a per-person prefs file + IPC, a core planner/scheduler service, a cadence hook, provenance on the generated
questionnaires, a notification kind, and a "For you" recommendation provider. It writes **nothing new** to
the questionnaire/assignment engine except an additive-optional provenance field.

## 2. Goals / Non-goals

**Goals**

- A person can turn on **Auto check-ins** for themselves and/or for specific other people, from the
  Questionnaires page, with an optional per-target **"what I'd like to explore"** focus.
- Once a day (app open), for each enabled, due stream under its queue cap and out of crisis, the engine
  **generates + delivers** 1–N fresh questionnaires that **never re-ask** known facts, and mix _deepen /
  expand / explore new_ against the latest data.
- **Always reserve 1–2 unfiltered intimacy** slots per stream when eligible (18+-gated; self always;
  partner-only for other-targets), rotating the topic inventory so intimacy coverage _progresses_.
- **Self-regulating volume:** top each stream up to a target depth (~3 waiting), hard-pause at 5 unanswered.
- **Adaptive cadence:** back off automatically when a stream's check-ins go unanswered; re-engage when the
  person answers again — never nag.
- **Safe by default:** crisis pauses everything; intimacy toward others is partner + double-18+-gated; other-
  targets must be adults with data; the recipient always sees (on open) that the check-in is auto-generated
  and how their answers are used; budget-gated with a per-run volume backstop.
- **~90% reuse** — the generation, de-dup, intimacy tiers, assignment/Inbox lifecycle, analysis, budget, and
  cadence machinery already exist; this adds only a thin planner + scheduler + config + provenance layer.

**Non-goals**

- **No new answering/generation engine.** Everything routes through `generateQuestions` + the existing
  de-dup + `createAssignment`. If de-dup/generation needs a fix, that's an [`08`](08-questionnaires.md) change.
- **No recipient consent handshake** (owner's decision, §11): targeting another person does not require that
  person to opt in. The compensating controls are: **owner-only** to configure other-targets, the partner+
  18+ intimacy gate, adults-with-data-only targets, and the always-visible auto-generated disclosure on open.
- **No author review step, and no "see what's queued" preview, in v1** (owner's decisions): sends are
  **fully automatic** once configured; the Inbox "Auto check-in" tag + rationale are the transparency
  surface. A queued preview may be a fast-follow.
- **No always-on background process.** Cadence is renderer-driven on launch/focus (§3.4); the app must be
  open. It never batches missed days.
- **No new AI usage type / pricing.** Reuses `questionnaire.generate`/`.dedup`/`.suggest`/`.analyze`
  metering and the existing person+app budget gate ([`06`](06-ai-usage-and-budgets.md)).
- **Not compatibility mode.** Auto check-ins are ordinary single-recipient sends; the two-participant
  compatibility path ([`08 §16.1`](08-questionnaires.md)) is out of scope.

## 3. UX & flows

### 3.1 The configuration surface — "Auto check-ins" on the Questionnaires page

A new collapsible **Auto check-ins** section on `/questionnaires` (below the Sent/Received grid,
[`59`](59-questionnaires-dashboard.md)), gated by the `questionnaires.autoCheckin` capability.

- **Master toggle** (`Switch`): "Let SelfOS create check-ins for me automatically." **On by default once a
  person completes onboarding** (seeded, §5.1 — with a one-time "Auto check-ins is now on" notice so it's
  never a surprise); a person can turn it off anytime. Off → the whole engine is inert for this author; the
  target list is disabled with an explainer.
- **A short honest explainer** under the toggle: what it does, that it uses the author's AI allowance, that
  it never re-asks what the app knows, and (when the app is closed) that it runs once per day the app is
  open. Not-medical / wellness framing consistent with [`05 §7`](05-conversations.md).
- **Target list** — one row per configured stream:
  - **"Yourself"** — always present (cannot be removed), enable `Switch`.
  - **A person row** per other-target: avatar + name + relationship, enable `Switch`, a kebab to remove.
  - Each row expands to: **"Include unfiltered intimacy"** `Switch` (see gating §3.5), an **exploration
    focus** `Textarea` ("Anything specific you'd like to explore?" — free text, ≤ 500 chars, feeds the
    generation FOCUS/brief), and a base **cadence** `Select` (Daily · Every few days · Weekly; adaptive
    back-off may stretch it, §3.7).
- **"Add a person"** — **owner-only** (§3.6). Opens a person picker listing only **eligible other-targets**:
  adult household people (≥ 18 via `birthday`, [`46`](46-intimacy-matrix-accuracy.md)/onboarding) who have
  **completed onboarding** (so there's data to work from) and are not Guests. Not eligible → not listed, with
  a one-line reason on hover.
- **"Run now"** (`Button`): triggers a run immediately (skips the 24h throttle, `run({ auto:false })`) so a
  person can pull a check-in on demand or verify the feature — still bounded by the queue cap, crisis, and
  budget gates.

Uses existing primitives (`Switch`/`Textarea`/`Select`/`Card`/`Avatar`/`Banner`, [`01`](01-design-system.md));
the owner-only "Add a person" affordance carries the **`AdminOnlyBadge`** (CLAUDE.md §12).

### 3.2 The recipient's experience (self-target — the common case)

The active person has Auto check-ins on for themselves. On a day the engine runs (§3.4) and their self-stream
is due and under cap, 1–N new questionnaires appear:

1. **In the Inbox** — each tagged an **"Auto check-in"** eyebrow + a one-line rationale ("Because you've been
   reflecting on work stress"). The unanswered badge ticks up.
2. **A notification** — a gentle `auto-checkin-ready` toast + bell entry ("A new reflection is ready"),
   coalesced (§6.4), respecting the proactivity dial + crisis suppression.
3. **A Home "For you" card** — the `auto-checkin` recommendation provider surfaces "You have a reflection
   waiting" → the Inbox ([`53`](53-home-encouragement.md)).

Answering is the **existing Inbox flow** ([`08 §13.5`](08-questionnaires.md), the `@selfos/answering` form)
unchanged: open → answer (progress + branching) → submit → the answer is analyzed into an Insight
([`08 §13.4`](08-questionnaires.md), auto-analyze if on) → Memory. **Decline** and **skip** work as today;
declines feed the avoid-list + adaptive back-off (§3.7).

### 3.3 The other-target experience (e.g. a partner)

The owner has configured an Auto check-ins stream toward **Angel**. From **Angel's** point of view, the
generated questionnaires arrive in **her** Inbox exactly like any questionnaire sent to her — with the same
"Auto check-in" eyebrow + rationale, **plus the honest disclosure on open** ([`08 §8.4`](08-questionnaires.md),
`disclosure.ts`, §8.3 below): the check-in was created automatically, and her answers help personalize the
_sender's_ coaching. Intimacy content only reaches her if she is a partner-type relationship with a completed
18+ ack **and** intimacy is enabled for that target (§3.5). The **author** sees only status ("Sent · awaiting")
in **Sent/Results** ([`59`](59-questionnaires-dashboard.md)); the recipient's private data still never crosses
back to the author (the de-dup boundary, §8.4). Angel can **decline** any check-in.

### 3.4 The daily loop (cadence mechanics)

Renderer-driven, no backend — the [`39`](39-living-memory-continuity.md) `useMemoryReconcile` /
[`36`](36-update-awareness.md) `useUpdateChecks` template exactly:

- A new `useAutoCheckins()` hook wired into `AppShell` (alongside the other cadence hooks) fires on \*\*launch
  - window `focus` + `visibilitychange`\*\*, with an in-memory `FOCUS_THROTTLE_MS = 30 min` and re-arm on
    active-person change.
- It calls the store `run()` → bridge `autoCheckinRun({ auto: true })`, gated on the author's master toggle.
- The bridge reads the **device-local per-person throttle** `DeviceState.autoCheckinCheckedAt?.[personId]`
  and the pure `shouldRunAutoCheckins(...)` gate (24h min gap). It **stamps** the marker only on a run that
  actually **evaluated + spent** (never on `AI_OFF`/`BUDGET`/`SKIPPED`/`ERROR`, which retry next launch —
  the reconcile precedent).
- **"Once a day" = once per day the app is launched/focused.** Closed for N days → one run on next launch, not
  N batches. Surfaced in the §3.1 explainer.

### 3.5 Intimacy handling

- **Self-stream:** whenever `includeIntimacy` is on for the self-target **and** the person has completed the
  18+ ack (`adultAcknowledged`, [`16 §8.3`](16-guided-sessions.md) guidance prefs), every batch reserves
  **1–2 unfiltered intimacy** slots (type `intimacy`, tier `unfiltered`, `explicitFraming` +
  `mergedIntimacyTopics`), rotating **least-covered topics** from `INTIMACY_ACTIVITIES_FULL`/`INTIMACY_FANTASIES`
  (derived from the recipient's rated acts + prior intimacy questionnaires) so the stream _progresses_ rather
  than repeats. `coveredIntimacyActs` reframes already-rated acts as "go deeper", de-dup drops re-asks.
- **Other-target:** the intimacy slot is included **only** when **all** hold: the author↔target relationship
  is **partner-type** ([`42`](42-relationship-scoped-sharing.md) relationship types), **both** the author and
  the target have completed the 18+ ack, and `includeIntimacy` is enabled for that target. Otherwise the
  intimacy switch is disabled with a reason and that stream generates only non-intimate check-ins.
- The **"always 1–2"** rule never pushes a stream over its cap or its per-run allotment (§3.7); if a stream
  already has an unanswered intimacy check-in waiting, a batch need not add another.

### 3.6 Who can configure what

- **Self-stream:** any person with `questionnaires.autoCheckin` (Member default on) may enable their own.
- **Other-targets:** **owner-only** (`people.manage`) — the compensating control for the no-consent model
  (§8). Enforced in the bridge (the trust boundary), not just the UI. A non-owner sees no "Add a person".

### 3.7 Volume, queue, and adaptive back-off

Per **stream** (an author→recipient pair), all derived from data — no mutable scheduler state stored:

- **Queue depth** (`currentUnanswered`) = auto-generated assignments for this stream in an answerable status
  (`sent`/`opened`/`inProgress`, [`08`](08-questionnaires.md) `isAnswerable`).
- **Top-up:** each run, generate `clamp(TARGET_DEPTH − currentUnanswered, 0, MAX_PER_RUN)`
  (`TARGET_DEPTH = 3`, `MAX_PER_RUN = 2` initial constants, §11). Skip the stream if `currentUnanswered ≥
HARD_CAP` (`HARD_CAP = 5`) or top-up ≤ 0.
- **Intent allocation** of the top-up slots: reserve intimacy first when eligible (§3.5, at most keep 1
  waiting); fill the rest from the gap-finder, preferring a **mix** across _deepen / expand / explore_ over
  repeating one intent.
- **Due?** A stream runs at most once per its **effective interval** = `baseInterval(cadence) ×
backoffMultiplier`. `lastRunAt` is **derived** from the newest auto assignment's `createdAt` in the stream.
- **Adaptive back-off** (derived, deterministic, no stored state): inspect the last `K = 3` auto assignments
  in the stream — if all went **unanswered past expiry or declined**, raise the back-off tier (stretch the
  interval: daily → few-days → weekly → soft-paused-with-a-nudge); the most recent being **answered** resets
  to base. This is the "never nag."
- **Per-run backstop:** total auto assignments created across all of an author's streams in one run ≤
  `MAX_PER_AUTHOR_PER_RUN` (initial `4`, §11), on top of the per-stream cap + the budget gate.

## 4. Data model (vault files & schemas)

All reads/writes go through the vault service (no direct `fs`). All schemas are **Zod** (source of truth,
`z.infer` for types). Config is **encrypted** per-author.

### 4.1 Auto check-ins config (new)

- **File:** `people/<authorId>/questionnaires/autoCheckins.enc` (the [`40`](40-proactive-coaching.md)
  `CoachingPrefs` precedent — a per-person prefs file, not the settings registry).

```ts
export const AutoCheckinTargetKindSchema = z.union([
  z.object({ kind: z.literal('self') }),
  z.object({ kind: z.literal('person'), personId: z.string().min(1) }),
]);

export const AutoCheckinCadenceSchema = z.enum(['daily', 'few-days', 'weekly']);

export const AutoCheckinTargetSchema = z.object({
  id: z.string().min(1), // stable per target (uuid)
  target: AutoCheckinTargetKindSchema,
  enabled: z.boolean().default(true),
  includeIntimacy: z.boolean().default(false), // gated at runtime (§3.5), never trusted alone
  explorationFocus: z.string().max(500).default(''),
  cadence: AutoCheckinCadenceSchema.default('daily'),
});

export const AutoCheckinConfigSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean().default(false), // author master toggle, default OFF
  targets: z.array(AutoCheckinTargetSchema).default([]),
});
export type AutoCheckinConfig = z.infer<typeof AutoCheckinConfigSchema>;
```

**No mutable scheduler state** is stored here (last-run, back-off tier, engagement) — all derived from the
stream's assignments (§3.7), the single-source-of-truth ethos ([`09`](09-session-analysis.md) derived status,
[`39`](39-living-memory-continuity.md) derived goal staleness).

**Defaults & seeding.** The schema defaults are conservative (fail-closed: `enabled:false`, empty targets,
`includeIntimacy:false`) so an absent/corrupt config never auto-generates. The **on-by-default** behavior
(§3.1) is realized by a **write-once seed** (§5.1) at onboarding completion (plus a boot backfill for
already-onboarded people): it writes `enabled:true` + an enabled **self** target with `includeIntimacy:true`
(still runtime-gated on the 18+ ack, §3.5) + fires a one-time notice. Other-target streams are **never**
seeded — they are only ever created by an owner explicitly (§3.6). An explicit off overrides the seed (the
file records the person's choice) and is never re-seeded.

### 4.2 Provenance on the generated questionnaire (additive)

An **additive-optional** field on the existing `QuestionnaireSchema` ([`08 §4`](08-questionnaires.md)) — **no
`schemaVersion` bump, no migration** (the `email`/`phone` additive precedent):

```ts
export const AutoCheckinProvenanceSchema = z.object({
  targetId: z.string().min(1), // which stream produced it
  intent: z.enum(['deepen', 'expand', 'explore', 'intimacy']),
  rationale: z.string().max(280), // the shown "why"
  generatedAt: z.string(), // ISO
});
// Questionnaire gains:  autoCheckin: AutoCheckinProvenanceSchema.optional()
```

It rides into the **immutable send snapshot** at `createAssignment`, so the "Auto check-in" tag + rationale +
stream membership are readable from the frozen assignment (used for the Inbox tag, the notification, and the
per-stream queue/back-off derivation). A questionnaire with `autoCheckin` present is an auto check-in; absent
= manually authored.

### 4.3 Device throttle marker (additive)

`DeviceState` ([`schemas.ts`](../../packages/core/src/schemas.ts)) gains an additive-optional
`autoCheckinCheckedAt?: z.record(z.string(), z.string())` (per-person id → ISO), mirroring
`memoryReconcileCheckedAt`/`coachingSynthesizedAt`. **Device-local, does not sync.**

### 4.4 What is reused unchanged

The `Questionnaire`/`Question`, `Assignment`, `ResponseSet`, and `Insight` schemas
([`08`](08-questionnaires.md)/[`09`](09-session-analysis.md)); the `GuidancePrefs.adultAcknowledged`
([`16`](16-guided-sessions.md)); budgets ([`06`](06-ai-usage-and-budgets.md)); relationship types
([`42`](42-relationship-scoped-sharing.md)).

## 5. Architecture & modules

A new **feature module**, `auto-checkins`, ~90% orchestration over existing code.

### 5.1 Core (`packages/core/src/questionnaires/autoCheckinService.ts` + prefs)

- **Prefs service** (`autoCheckinPrefsService.ts`): `getAutoCheckinConfig(fs, key, authorId)`,
  `setAutoCheckinConfig(fs, key, authorId, patch)` (merge, validate; default off/empty), and
  `seedDefaultConfigIfAbsent(fs, key, authorId)` — the **write-once** onboarding-completion seed (§4.1):
  enables the self-stream (intimacy-on, ack-gated) for an onboarding-complete person with no config yet, and
  returns whether it seeded (so the caller fires the one-time notice). Idempotent; never overwrites an
  existing config (an explicit off stays off).
- **Pure gate** `shouldRunAutoCheckins(input: { config; lastCheckedAt?; now }): boolean` — false when the
  master toggle is off, throttled (< 24h since `lastCheckedAt`), or no enabled targets. The
  `shouldAutoReconcile` sibling.
- **Pure planner** `planStreams(input: { config; assignmentsByStream; now }): StreamPlan[]` — for each
  enabled target, compute `currentUnanswered`, `due(effective interval + derived lastRunAt)`, `topUp`, the
  back-off tier, and the **intent budget** (how many deepen/expand/explore + intimacy slots). Deterministic;
  no AI. Emits per-stream `{ targetId, slots: SlotSpec[] }` where a `SlotSpec` = `{ intent, ...seed }`.
- **Orchestrator** `runAutoCheckins(deps, authorId)` — the AI-bearing top-level:
  1. Gate on `ai.enabled`, `shouldRunAutoCheckins`, and **crisis** (`aggregateCrisisSignal` over the author's
     approved insights → skip everything, "support comes first", [`40`](40-proactive-coaching.md)).
  2. `planStreams`.
  3. For each slot: build the seed (topical slots run the **gap-finder** `suggestQuestionnaires` per stream
     once and classify/pick by intent + freshness; intimacy slots pick least-covered topics) → call
     **`generateQuestions`** with the target's `explorationFocus` as the FOCUS/brief, the recipient's
     de-dup bundle (`recipientKnownData` — onboarding + prior answers + insight facts + asked prompts),
     `recipient`, and (intimacy) tier `unfiltered` + `coveredIntimacyActs`.
  4. Persist the questionnaire with `autoCheckin` provenance (§4.2) → `createAssignment(recipient, inApp)`.
  5. Respect `MAX_PER_AUTHOR_PER_RUN`, per-stream `HARD_CAP`, and the budget gate (each `runClaude` already
     blocks on `over`).
     Returns `{ ok, created: AutoCheckinCreated[], skipped: {targetId, reason}[], usage } | { ok:false, reason }`.

### 5.2 Renderer

- **Cadence hook** `useAutoCheckins()` in `AppShell` (§3.4). On mount it first runs the **write-once seed**
  backfill (§5.1) for an onboarding-complete active person, firing the one-time `auto-checkin-enabled` notice
  if it seeded, then proceeds to the throttled run.
- **Store** `autoCheckinStore` (Zustand) — config load/save + `run({auto})`; **reset on active-person
  change** (the per-person-state rule).
- **Config UI** `AutoCheckinsPanel` on `/questionnaires` (§3.1) + `AutoCheckinTargetRow` + the owner-only
  add-person picker + a **"Run now"** button (`run({ auto:false })`, §3.1). The master toggle uses the
  [`40`](40-proactive-coaching.md) `ProactivityControl` pattern (self-managing control backed by the
  per-person prefs IPC), not a `scope:'vault'` registry entry.
- **Surfacing:** the `auto-checkin-ready` notification source (§6.4) + an `auto-checkin` recommendation
  **provider** ([`53`](53-home-encouragement.md), gate `questionnaires.answer`, surfaces when the active
  person has an unanswered auto check-in). Inbox items already show the eyebrow from `autoCheckin` provenance.

### 5.3 Capability

Register **`questionnaires.autoCheckin`** ([`04`](04-people-roles.md) capability registry) — Member default
**on** (governs the self-stream). Other-target configuration is gated on `people.manage` (owner) in the
bridge (§3.6). Not `EXPLICIT_GRANT_ONLY`.

## 6. IPC / API contracts

All channels renderer↔main through the typed seam (`channels.ts` → `coreBridge.ts` → `ipc.ts` → preload →
`test-utils/bridge`), Zod-validated, **active-person-scoped in the bridge** (the trust boundary). The API key
stays in main.

### 6.1 `autoCheckins:getConfig` → `AutoCheckinConfig`

Gated `questionnaires.autoCheckin`; returns the active person's config (default off/empty when absent).

### 6.2 `autoCheckins:setConfig(patch)` → `AutoCheckinConfig`

Gated `questionnaires.autoCheckin`. Adding/enabling an **other-target** additionally requires `people.manage`
(else the whole patch is rejected). Validates each other-target is an **eligible adult household person** with
completed onboarding (§3.1); `includeIntimacy` on an ineligible target is coerced off. Returns the saved config.

### 6.3 `autoCheckins:run({ auto })` → `AutoCheckinRunResult`

Gated `questionnaires.autoCheckin`. `auto: true` applies the §3.4 throttle + stamps
`autoCheckinCheckedAt[personId]` only on a spending pass; a manual "Run now" (§11) passes `auto:false` and
skips the throttle. Runs `runAutoCheckins` for the active author. Each generate/dedup/analyze goes through the
existing metered `runClaude`; over budget → `{ ok:false, reason:'BUDGET' }` (retry next launch), crisis →
`{ ok:false, reason:'CRISIS' }`, AI off → `'AI_OFF'`, nothing due → `'SKIPPED'`.

### 6.4 Notification source `autoCheckins:pending` → `{ count, newest }`

Recipient-scoped read (gated `questionnaires.answer`) feeding a `auto-checkin-ready` notification candidate
(coalesce key `auto-checkin-ready`, `onIncrease` by count) + the "For you" provider. **Carries no answers** —
just the count + newest title/rationale ([`35`](35-notification-system.md) derived-not-polled model).

### 6.5 Claude usage

No new model prompt shapes — it calls the existing `suggestQuestionnaires` + `generateQuestions` (+ their
`semanticDedupFilter`) with existing prompts/streaming/model. Usage recorded under the existing
`questionnaire.suggest` / `questionnaire.generate` / `questionnaire.dedup` types
([`06`](06-ai-usage-and-budgets.md)); admin cost visibility is unchanged (the usage dashboard already breaks
down by type). Volume is bounded by §3.7, not a new usage type.

## 7. States & edge cases

- **Master toggle off / no targets:** engine inert; the hook no-ops; the panel shows the disabled explainer.
- **First activation (seed):** when the onboarding-completion seed flips a person on, exactly one
  `auto-checkin-enabled` notice fires; re-launches never re-notify (write-once), and an explicit off is never
  re-seeded. A pre-onboarding person is never seeded.
- **AI off / no key:** `run` → `AI_OFF`, no stamp, retry next launch; the panel shows the standard
  `AiUnavailableNotice` ([`41`](41-discoverability-and-empty-states.md)); an already-generated check-in is
  still answerable offline (answering is local).
- **Over budget:** `BUDGET`, no stamp, retry next launch; nothing generated. Admin sees the spend in Usage.
- **Crisis** (`aggregateCrisisSignal.recurring`): **skip all streams**, intimacy first; no stamp; retry when
  the signal clears. Never overridden by the toggle.
- **Onboarding incomplete** (author or an other-target): that stream is skipped (no data / the person is in
  the onboarding hard-gate, [`18 §3.1`](18-personal-onboarding.md)); the other-target isn't even listable.
- **Queue full (≥ 5 unanswered) / not due:** stream skipped this run.
- **18+ not acked:** the intimacy slot is dropped for that stream (self or other); the switch is disabled with
  a reason; **non-intimate** check-ins still generate.
- **Relationship changed:** a partner→ex change (or the edge removed) at run time drops that other-target's
  intimacy eligibility (re-checked every run against the live graph, [`42`](42-relationship-scoped-sharing.md));
  a removed person / deleted onboarding → the stream is skipped and the target flagged stale in the panel.
- **De-dup exhausts ideas** (the app knows "everything" already): `generateQuestions` returns few/no novel
  questions (the fail-safe keeps what survives, [`37`](37-ai-output-robustness.md)); the engine simply
  creates fewer/none that run and backs off — never sends an empty questionnaire.
- **Generation truncated / malformed:** the shared tolerant-parse + honest-failure taxonomy
  ([`37`](37-ai-output-robustness.md)) — a failed generate produces nothing for that slot, is still metered,
  and retries next cadence; it never blocks the other slots.
- **Person switch mid-run / concurrent runs:** the bridge is active-person-scoped; the store resets per
  person; a second launch's `run` re-reads the throttle and no-ops if a run already stamped today.
- **Sync conflict on `autoCheckins.enc`:** last-write-wins on the config (small, human-edited) surfaced by
  the standard conflict banner; the throttle marker is device-local (never conflicts).
- **Corrupt/absent config:** absent → default off; a corrupt file → fail-closed to off (never auto-generate
  on a parse error), surfaced in the panel.

## 8. Safety

This feature **acts on the person's wellbeing data and can send content to another human unprompted**, so
the safety envelope is central, not incidental.

### 8.1 Not-medical + crisis (unchanged boundary, enforced here)

Every generated questionnaire carries the standard not-medical/wellness framing + the crisis footer on the
answering surface ([`05 §7`](05-conversations.md)/[`08 §8.2`](08-questionnaires.md)). **Crisis suppresses the
whole engine** (§7): `aggregateCrisisSignal.recurring` over the author's insights → no generation, intimacy
first, never overridden by the toggle ([`40`](40-proactive-coaching.md)). Analysis of answers preserves the
`crisisFlag` → the Home `CrisisSupportBanner`, unchanged.

### 8.2 Intimacy — gated, never to the wrong person

Unfiltered intimacy content is **only** generated when: (self) the person's own 18+ ack; (other) a
**partner-type** relationship **and both** parties' 18+ acks **and** the per-target `includeIntimacy`. A
non-partner, a minor, an un-acked person, or an ineligible target **never** receives auto intimacy content.
Re-checked against the live relationship graph + acks **every run** (a partner→ex change revokes it
immediately, §7). The `SAFETY` prefix + consensual-adult/never-minors/never-illegal boundary of
`explicitFraming` is unchanged ([`08 §16.5`](08-questionnaires.md), [`48`](48-intimacy-guided-sessions.md)).

### 8.3 No-consent, but not covert — the compensating controls

The owner chose **no recipient-consent handshake** and **fully automatic** sends (§11). Because auto-targeting
another person could otherwise become covert data-gathering, these floors are **non-negotiable** and hold
regardless:

- **Owner-only** to configure other-targets (§3.6, enforced in the bridge).
- **Always disclosed on open:** every auto check-in shows, when the recipient opens it, that it was generated
  automatically and that their answers help personalize the sender's coaching — the existing honest
  disclosure ([`08 §8.4`](08-questionnaires.md) `disclosure.ts`), extended with an auto-generated line. It
  **must not** state that an owner/admin can access the recipient's data (durable rule — the disclosure is
  about how _their answers_ are used, not about admin access).
- **Adults with data only** as other-targets (§3.1).
- **The de-dup boundary is preserved (arguably stronger):** generation reads the target's data host-side to
  avoid re-asking (the [`08 §24.5`](08-questionnaires.md) owner override — private fields feed tailoring
  author-blind); only **questions** are produced, and in full-auto mode the author does not even review them
  before send, so **no** additional recipient data crosses back to the author. The recipient's raw answers
  reach the author only under the send's standard visibility, exactly as a manual send
  ([`08`](08-questionnaires.md)), never for a Private send.
- **The recipient can always decline**, and repeated declines back the stream off (§3.7).

### 8.4 Data boundaries

Self-stream tailoring uses the person's own data (own context). Other-target tailoring uses the target's data
under the existing generation boundary ([`08 §24.5`](08-questionnaires.md)): the model sees it to de-dup +
personalize; the author receives only generated questions. Cross-person Memory/answer boundaries
([`42`](42-relationship-scoped-sharing.md)/[`44`](44-memory-dashboard-overhaul.md)) are untouched.

## 9. Accessibility

- The config panel is keyboard-operable end to end (toggles/selects/textarea/kebab), visible focus, semantic
  `Switch`/`Select`/`Textarea` with labels; the owner-only add-person carries a text+icon `AdminOnlyBadge`
  (not colour alone). Section is a `<section>` with a heading; targets are a list.
- The "Auto check-in" eyebrow + rationale are real text (screen-reader legible), not colour-coded.
- Notifications/toasts follow [`35`](35-notification-system.md) (`role`/`aria-live`, dismissible, motion-
  reduced). The "For you" card follows [`53`](53-home-encouragement.md).
- Reduced-motion honored on any toast/card entrance. Full ~360px→desktop responsiveness; no horizontal
  overflow (CLAUDE.md §12); the target rows and focus textarea stack cleanly at phone width.

## 10. Testing strategy

Vault + Claude are faked per the existing harness (`memFileSystem`, the offline fake Claude / gap-finder /
generation fakes; a new `SELFOS_FAKE_AUTOCHECKIN`-style hook only if needed). Fakes are **imperfect by
default** ([`37`](37-ai-output-robustness.md)).

**Unit / core**

- `shouldRunAutoCheckins`: off/throttled/no-targets → false; enabled + due → true.
- `planStreams`: top-up math (target 3 / cap 5 / per-run max), due/not-due from derived `lastRunAt`, back-off
  tier from the last-K engagement, intent allocation prefers a mix, intimacy slot reservation.
- Intimacy gating: self needs own ack; other needs partner + both acks + enabled + live edge; an ineligible
  target coerces `includeIntimacy` off; a partner→ex change revokes at run time.
- `runAutoCheckins`: generates via `generateQuestions` with the focus brief + de-dup bundle; writes
  `autoCheckin` provenance; `createAssignment` to the right recipient; crisis → skips all; over budget →
  BUDGET no-stamp; `MAX_PER_AUTHOR_PER_RUN` respected; a truncated/empty generate produces nothing + is
  metered + doesn't block siblings.
- Prefs service round-trip; config fail-closed on corrupt.
- Seeding: `seedDefaultConfigIfAbsent` enables the self-stream once (intimacy-on, ack-gated), is idempotent,
  never re-seeds after an explicit off, and doesn't seed a pre-onboarding person.

**Component (RTL)**

- `AutoCheckinsPanel`: master toggle persists via the per-person IPC; a self row + intimacy switch (disabled
  when un-acked, with the reason); the exploration focus + cadence persist; **owner** sees "Add a person",
  **non-owner** does not; the ineligible-target reason.
- Inbox item renders the "Auto check-in" eyebrow + rationale; the `auto-checkin-ready` notification candidate;
  the "For you" card.

**E2E (Playwright)** — the crown-jewel flows, decrypting the vault:

1. **Self loop + seed:** completing onboarding seeds the self-stream **on** + fires exactly one
   `auto-checkin-enabled` notice → **Run now** → assert 1–2 questionnaires land in the Inbox with
   `autoCheckin` provenance (decrypt) + the "Auto check-in" tag + a notification + the "For you" card;
   answer one → Insight written; the throttle marker set; a second **auto** launch same-day generates nothing
   (Run now still can).
2. **Never re-ask / top-up / cap:** seed onboarding + prior answers → assert generated questions avoid known
   facts (de-dup) and the stream tops up to 3 then pauses at 5.
3. **Intimacy gating:** with the 18+ ack, a self batch includes an `unfiltered` `intimacy` questionnaire
   (decrypt tier/type); without the ack, none, and non-intimate ones still generate.
4. **Other-target (owner):** owner configures a **partner** target with intimacy → run → the partner's Inbox
   shows the check-in (incl. an intimacy one) with the auto-generated disclosure on open (decrypt the
   snapshot); a **non-partner** target never gets intimacy; a **non-owner** cannot add a person.
5. **Crisis + budget gates:** a recurring crisis signal → a run generates nothing; over budget → nothing +
   no stamp.
6. **Adaptive back-off:** a stream whose last K auto check-ins expired unanswered stretches its interval; an
   answer resets it.
7. **Layout guards:** the panel at ~360px — no horizontal overflow, no inner scrollbars, the target rows +
   focus textarea render fully (CLAUDE.md §7).

## 11. Open questions

Resolved via two decision rounds (2026-07-15) — recorded here, to be confirmed at spec review:

- **Recipient model** — configurable **self and/or other-person targets**, each a stream with its own
  settings + a "what to explore" focus. ✅
- **Volume** — **top-up to ~3 waiting per stream, hard cap 5.** ✅
- **Intimacy** — **always 1–2 unfiltered per eligible stream, 18+-gated, rotating topics**; partner-only for
  other-targets. ✅
- **Surfacing** — **Inbox badge + a gentle notification + a Home "For you" card.** ✅
- **Recipient consent** — **none** (owner controls it); compensated by owner-only other-targeting + the
  partner/18+ gate + the always-visible disclosure. ✅
- **Author review** — **fully automatic**, no per-send review. ✅
- **Cadence** — **daily, adaptive back-off** when ignored. ✅

Resolved (2026-07-15, round 2):

1. **Default state** — **on once a person completes onboarding** (seeded, §3.1/§4.1/§5.1), with a one-time
   notice + always turn-off-able. ✅
2. **Name** — **"Auto check-ins".** ✅
3. **Tuning constants** — ship as **internal defaults** (`TARGET_DEPTH = 3`, `HARD_CAP = 5`,
   `MAX_PER_RUN = 2`, `MAX_PER_AUTHOR_PER_RUN = 4`, back-off `K = 3` + the daily→few-days→weekly
   multipliers); the only user-facing knob is per-target **cadence**. ✅
4. **"See what's queued" peek** — **cut from v1** (possible fast-follow). ✅
5. **Manual "Run now"** — **included** (§3.1, `run({ auto:false })`). ✅
6. **Intent mix** — lean on the **gap-finder's ranking** + a light "prefer variety" rule + the reserved
   intimacy slot; no hard-coded ratio. ✅

No open questions remain — ready for review/approval.

## 12. Changelog

- 2026-07-15 — created (Draft). Decisions from two AskUserQuestion rounds folded into §11.
- 2026-07-15 — §11 resolved (round 2): default **on after onboarding** (seeded + one-time notice), name
  **Auto check-ins**, **Run now** included, queued-peek cut, constants internal, intent-mix via the
  gap-finder. Updated §2/§3.1/§4.1/§5/§7/§10 accordingly.
- 2026-07-15 — **BUILT, slices A–C** on `feat/auto-checkins` (PR pending). **A** — the core engine
  (`@selfos/core/auto-checkins`: pure planner, prefs + write-once seed, `runAutoCheckins` orchestrator);
  38 units + code-reviewed (2 fixes: unguarded `createAssignment` → pre-validate + wrap; de-dup reference
  now mirrors the manual path's per-section caps). **B** — the IPC seam (`autoCheckins:getConfig/setConfig/
ensureSeed/run`, owner-gated other-targets, crisis + throttle stamp), the per-person store + `useAutoCheckins`
  cadence hook + the `AutoCheckinsPanel` config UI on the Questionnaires landing (master toggle, per-target
  stream, exploration focus, cadence, intimacy sub-toggle, owner-only add-person, Run now — which forces a
  top-up past the per-stream due-time); 3 bridge + 5 RTL + the crown-jewel self-loop E2E (decrypt-verified) +
  panel visual QA. **C** — surfacing: an additive `InboxItem.autoCheckin` → the "Auto check-in" eyebrow +
  rationale on the Received card / Inbox row, and an `auto-checkin` "For you" provider on Home (signal-aware
  dismissKey); the Inbox badge counts them for free. Gate green throughout (typecheck all, lint, format,
  1221 core + 1176 desktop unit, E2E). **Two documented fast-follows** remain: a standalone
  `auto-checkin-ready` notification + the one-time "Auto check-ins is now on" seed notice (the badge +
  For-you card cover discovery meanwhile). \*\*Lesson: a cross-feature orchestrator that consumes questionnaires
  - intake + guidance (which already import questionnaires) must live in its OWN top-level core module, not
    inside `questionnaires/`, or it forms an import cycle; and its de-dup assembly must MIRROR the manual path's
    per-section caps (not a single global cap) or a heavy onboarding truncates away the later sources.\*\*
