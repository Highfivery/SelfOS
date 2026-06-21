# 29 — Progressive profile building (depth invitations)

> **Status:** Draft · _last updated 2026-06-21_
>
> Instead of front-loading a long onboarding intake, SelfOS establishes a **tight core intake** (specs
> [`26`](26-intake-catalog-redesign.md)/[`27`](27-intimacy-redesign.md) trim the catalog) and then
> **builds the deeper profile progressively, in context, over time**. When a person's ongoing activity keeps
> landing on a topic they haven't filled in — an unstarted/skipped `invited` intake section, or a thin
> life-area — the coach gently **invites them to go deeper** ("we keep coming back to your dad — want to tell
> me a bit about your family?"), rather than asking everything up front. This is the **sibling** of spec
> [`18`](18-personal-onboarding.md) §15's profile-freshness system: §15 says "this answer looks **stale** —
> update it"; §29 says "this **area is unexplored** — want to fill it in?" Both ride the metered analysis
> passes that already run, so neither spends extra AI.

New feature. Builds directly on [`18`](18-personal-onboarding.md) (the intake catalog/sections/tiers/gate,
the §15 freshness model + `@selfos/core/profile` service it extends, §14.7 go-deeper chat, §14.11
relevance-gated surfacing) and reuses the **"one marker, free signal"** producer-output pattern from
[`09`](09-session-analysis.md) (`wrapUpSuggested`) / [`08`](08-questionnaires.md) (`analyzeAssignment`) /
[`13`](13-dream-images.md) and the metering in [`06`](06-ai-usage-and-budgets.md). It surfaces through
[`16`](16-guided-sessions.md)'s in-session affordances, [`17`](17-home-dashboard.md)'s cards, and the
[`18`](18-personal-onboarding.md) Onboarding "Go deeper" grid. References [`00`](00-architecture.md) and
[`01`](01-design-system.md).

> **Dependency / sequencing.** This spec is built **after** specs 26 (non-intimacy intake catalog redesign),
> 27 (intimacy block redesign), and 28 (portrait synthesis / context optimization), in its own session. §29
> **assumes 21's trimmed catalog** — a tight `core` gate plus `invited` depth sections that are acquired
> over time — and 23's synthesis contract (it extends that contract, §5.2). Nothing here changes 21/22's
> question wording; it changes **how** the deeper sections get filled (progressively, by invitation, instead
> of all at once).

---

## 1. Overview

A long intake is a bad trade: people skip-spam through 40-question sections to escape the Member gate, and the
profile comes out hollow (spec [`18`](18-personal-onboarding.md) §14.2). The user chose a different shape —
**"tighter intake + progressive follow-on"**: keep the gate to a few quick `core` forms (spec 26), and let
SelfOS earn the rest of the profile **over time, in the flow of real use**. When the coach notices a topic that
keeps coming up but is **unfilled** in the person's profile, it offers a calm, relevant, opt-in invitation to
go deeper — which, when accepted, opens exactly that `invited` intake section (or its go-deeper chat) prefilled
and scoped.

This is more humane (depth is invited when it's relevant, never demanded up front) and yields **better data**
(a person who chose to talk about their family right after a session that surfaced family answers more richly
than one grinding through a wall of forms on day one).

**Where it sits.** §29 is the **depth** half of the living-profile system; [`18`](18-personal-onboarding.md)
§15 is the **freshness** half. Both are by-products of the analysis passes that already run:

| System                    | Signal                                         | Says                                               |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| **18 §15** (freshness)    | a known answer **contradicts** recent activity | "this looks out of date — **update** it"           |
| **29** (depth, this spec) | a recurring topic maps to an **unfilled** area | "this area is unexplored — want to **go deeper**?" |

They share the `@selfos/core/profile` service, the producer-output-contract pattern, and the
confirm/opt-in/own-scoped/restricted rules — so this spec stays DRY by extending §15 rather than restating it.

## 2. Goals / Non-goals

**Goals**

- **Progressive depth.** Build the deeper (`invited`) profile **over time**, by relevant invitation, instead
  of front-loading it behind the gate.
- **No extra AI spend.** Detect depth opportunities as a **by-product** of the metered analysis passes that
  already run (sessions/dreams/questionnaires + intake synthesis), exactly like §15 (§5.2).
- **Calm, opt-in surfacing.** Invitations are gentle nudges (a Home/Onboarding card, an optional in-session
  offer) — **never an interrupt, never a block**. Accepting opens the right intake section/chat, prefilled and
  scoped; **dismiss is durable** (no re-nag).
- **A relationship to the gate.** With progressive building, the `core` gate (spec 26) stays minimal; invited
  depth is acquired afterward. §29 only ever invites `invited` sections — it never re-gates a finished core.
- **Safety & privacy first.** Own-scoped; `restricted`-derived invitations inherit `restricted` (owner-visible,
  everyone-else redacted); the not-medical/crisis framing is unchanged; intimacy/trauma depth is gated behind
  the 18+ ack and relevance, per [`18`](18-personal-onboarding.md) §14.10/§14.11.

**Non-goals (deferred / out of scope)**

- **Asking everything up front** — that's the model §29 replaces; the gate stays tight (spec 26).
- **A new AI call to "scan for gaps."** Detection **rides the existing passes** — no dedicated periodic scan
  (the §15.8 decision, inherited).
- **Auto-filling the deeper sections.** §29 **invites**; the person still answers (the existing §14.7 form /
  go-deeper flow does the filling). Nothing is written without the person.
- **Auto-creating People/relationships** from what's mentioned — still self-only (spec [`18`](18-personal-onboarding.md) §2; phase 2).
- **Re-asking a completed/skipped section unprompted** beyond the durable-dismiss + cooldown rules in §3.4.
- **Voice** — deferred; nothing precludes it.

## 3. UX & flows

### 3.1 The detection moment (invisible to the user)

When a producer's analysis pass runs (a session ends + summarizes [`09`](09-session-analysis.md), a dream is
analyzed [`13`](13-dream-images.md), a questionnaire is analyzed [`08`](08-questionnaires.md), or the intake
synthesizes), the model **already has** the transcript/content **and** the person's profile context. §29 hands
that same pass one extra piece of context — **which `invited` intake sections are unfilled (notStarted/skipped)
and which `LIFE_AREAS` are thin** — and asks it, _in the same output_, to optionally name **one** area the
conversation keeps circling that the person hasn't explored. A pass that finds nothing emits nothing. No user
sees this step.

### 3.2 Surfacing — calm, opt-in, never an interrupt

A pending depth invitation surfaces in (at most) three calm places — none of which block:

- **Home dashboard ([`17`](17-home-dashboard.md)).** A gentle card — e.g. **"Want to go deeper on Family?"**
  with the recurring theme as the subtitle ("we've touched on your family a few times") and **Go deeper** /
  **Not now** actions. Self-hides when there's none pending. This sits alongside §15's "Keep your profile
  fresh" card (depth vs. freshness — distinct copy, §1).
- **Onboarding "Go deeper" grid ([`18`](18-personal-onboarding.md) §3.1).** The invited section's card is
  highlighted (a gentle "suggested" treatment + the theme line), so the living-profile surface and the
  invitation are the same place — review and add in one spot, matching §15.3.
- **In session (optional, opt-in — §3.5).** The coach may weave **one** gentle depth question into a relevant
  session, prompt-level — never derailing.

### 3.3 Acceptance — opens the right place, prefilled & scoped

Accepting a depth invitation:

- For an **`invited` intake section** → opens **that section's form** (the §14.7 flow) at the top, scrolled and
  ready; if a relevant theme exists, the section's **go-deeper chat** is offered seeded with a one-line scoping
  note ("you mentioned your dad a few times — want to tell me about your family?"). It re-uses the existing
  intake render/submit path — §29 adds **no new answering surface**.
- For a **thin life-area** with no single owning section, it routes to the **closest `invited` section**
  (a code mapping `LifeArea → sectionId`, §5.3) — or, if none, to the section's go-deeper chat.
- Adding the section **re-synthesizes the portrait** on the existing §14.8 enrichment path (same `insightId`,
  shareable choices carried forward). §29 triggers nothing new here.

Acceptance never blocks the app: the person can open it now, later, or never.

### 3.4 Dismissal, dedup & cadence (no nagging)

- **Dismiss is durable.** "Not now" marks the invitation `dismissed`; the same area won't re-fire for a
  **cooldown** window (§11) — and a section the person **explicitly skipped** in onboarding is treated as a
  standing dismissal (don't keep inviting a thing they declined).
- **One per area, newest wins.** A new invitation for the same section/area **supersedes** a prior `pending`
  one (don't stack three "go deeper on Family" cards) — the §15.2 dedup rule, applied to the depth kind.
- **Throttle the surface.** At most **one** depth invitation is shown at a time on Home (and a small global
  cap, §11), so the app never feels like a checklist of things you haven't done.
- **Accepting closes it.** Once the section is started/completed, its pending invitation resolves to
  `accepted`/cleared (it has served its purpose).

### 3.5 In-session asks (optional, prompt-level, guarded)

Optionally (a setting, §6/§11), the coach itself may **weave a single gentle depth question into a relevant
session** rather than only surfacing a card. This is a **prompt-level** instruction with hard guardrails:

- **One ask, then drop it.** The coach offers the depth question at most once per session and, if the person
  doesn't bite or says no, **drops it** and continues — it never derails the session's real purpose.
- **Relevance only.** It asks only when the session is _about_ that area (a relationship session may invite the
  Relationships section; a budgeting chat never does) — the [`18`](18-personal-onboarding.md) §14.11
  relevance-gating, reused.
- **Restricted depth is doubly gated.** A trauma- or intimacy-area in-session ask only happens when the topic
  is **clearly relevant** _and_ the person has completed the **18+ acknowledgement** (intimacy) — never a cold
  invitation into the heaviest sections ([`18`](18-personal-onboarding.md) §14.10).
- **Never instead of safety.** Crisis/distress disclosure always takes precedence — the coach drops any depth
  ask and routes to support ([`05`](05-conversations.md) §7, §8 below).

### 3.6 Happy path (end-to-end)

1. A new Member finishes the tight `core` gate (spec 26) and generates the starter portrait — the gate
   releases ([`18`](18-personal-onboarding.md) §3.1).
2. Over the next days they do a few sessions; two of them keep landing on their father.
3. The session-analysis pass (already running, [`09`](09-session-analysis.md)) notices "Family" is an unfilled
   `invited` section that the activity keeps circling and emits **one** depth invitation — no extra spend.
4. A calm Home card appears: **"Want to go deeper on Family?"** They tap **Go deeper**.
5. The Family section opens at the top, its go-deeper chat seeded ("you've mentioned your dad — want to tell me
   about your family?"). They fill some of it and re-synthesize; the portrait grows.
6. Later they dismiss a different invitation ("Work & money") — it doesn't re-nag.

## 4. Data model (vault files & schemas)

**Decision pending (§11):** §29 may either **extend** the §15 `ProfileUpdateSuggestion` with a `kind:
'depth'`, or add a **sibling `ProfileDepthInvitation`**. This section specs the **schema extension** (the
DRYer default, reusing the §15 service/IPC/store nearly wholesale); §11 lists the trade-off. The fields below
apply either way.

### 4.1 Files (vault) — all per-person, encrypted

- **`people/<id>/profile-suggestions/<id>.enc`** — reuses §15's directory and the
  `ProfileUpdateSuggestion`/`profileSuggestionService` storage (`writeEncryptedJson`/`readEncryptedJson`, no
  direct `fs`). A depth invitation is the same persisted record with `kind: 'depth'`. (If §11 resolves to a
  separate model, it lives at `people/<id>/profile-invitations/<id>.enc` with an analogous service.)
- **No new owned files** otherwise. The intake itself (`people/<id>/intake/session.enc`), the portrait Insight,
  and the producers' files are unchanged — §29 only **reads** the intake's section status and **writes**
  invitation records.

All reads/writes go through the vault/crypto service ([`00`](00-architecture.md) §4.3).

### 4.2 Schema (Zod — source of truth)

Extend the existing §15 schemas (`packages/core/src/schemas.ts`) **additively** (the `email`/`phone`
precedent — **no `schemaVersion` bump**; existing `kind: 'field' | 'intakeSection'` suggestions parse
unchanged):

```ts
// ProfileUpdateSuggestion.kind gains 'depth' (additive enum widen).
ProfileUpdateSuggestionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1),
  // 'field' / 'intakeSection' = the §15 FRESHNESS kinds; 'depth' = the §29 DEPTH invitation.
  kind: z.enum(['field', 'intakeSection', 'depth']),
  field: PersonFieldKeySchema.optional(), // §15 'field'
  // For 'depth' (and §15 'intakeSection'): the invited section this opens.
  sectionId: z.string().optional(),
  // For 'depth': the thin life-area the activity kept circling (when it routes via an area, §5.3).
  lifeArea: z.string().optional(),
  // For 'depth': the recurring theme that triggered it ("we keep coming back to your dad").
  theme: z.string().optional(),
  observed: z.string().min(1), // §15 reuse; for 'depth' = the theme/area the model named
  current: z.string().optional(),
  rationale: z.string(), // a short human reason, surfaced as the card subtitle
  sourceInsightId: z.string().min(1),
  sourceKind: z.enum(['session', 'dream', 'questionnaire', 'intake']),
  restricted: z.boolean(), // a restricted-area invitation is itself restricted (own-scoped, owner-visible)
  status: z.enum(['pending', 'accepted', 'dismissed']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// The raw shape the analysis pass emits for a DEPTH delta (model output → validated before trust, §5.2).
RawDepthInvitationSchema = z.object({
  sectionId: z.string().optional(), // the invited section, if the model named one
  lifeArea: z.string().optional(), // OR the thin life-area (mapped to a section host-side, §5.3)
  theme: z.string().min(1), // the recurring topic ("your father", "money stress")
  rationale: z.string().default(''),
});
```

The producers' analysis result types gain an optional **`depthInvitations?: RawDepthInvitation[]`** alongside
the existing §15 `profileSuggestions?` (additive). Types are `z.infer`red.

### 4.3 Ownership & migration

- **Migration is a no-op for existing data.** Widening the `kind` enum and adding optional fields is additive;
  pre-§29 suggestion records parse unchanged (no `schemaVersion` bump — the §15.6 / §14.9 additive precedent).
- All persistence goes through `@selfos/core/profile` (extended), never direct `fs`.

## 5. Architecture & modules

### 5.1 Extend `@selfos/core/profile` (not a new package)

The §15 **`profileSuggestionService`** gains depth-aware helpers — the DRY choice, since acceptance/dismissal,
dedup, own-scoping, and the IPC/store already exist:

- **`recordDepthInvitationsFromAnalysis(fs, key, personId, raw, sourceKind, sourceInsightId, now)`** — the
  sibling of `recordSuggestionsFromAnalysis`. Validates each `RawDepthInvitation`, resolves it to a real
  `invited` `sectionId` (via the model's `sectionId`, else the `lifeArea → sectionId` map, §5.3), **drops**
  invitations that target a `core` section, an already-filled section, or an explicitly-skipped section
  (§3.4), dedups against pending/dismissed (the §15.2 rule), and **inherits `restricted`** from the target
  section's catalog flag (server-side from the trusted catalog, **never the model** — the §14.8 invariant).
- **`acceptSuggestion` / `dismissSuggestion`** — reused. For `kind: 'depth'`, **accept does not write a field**;
  it returns the resolved `sectionId` so the renderer can open that intake section (the renderer/IPC carries
  the routing — §6). Dismiss is the same durable record.
- **`listPendingSuggestions`** already returns all pending records; the renderer filters by `kind` to show the
  depth vs. freshness cards separately.

### 5.2 Producer wiring — the same "free signal" pass

Each producer's analysis service (`sessionAnalysisService`, the dream analysis service, `analyzeAssignment`,
and the intake's own `synthesizeIntake`) gets two small additions — **no new AI call, no new metering event**
(the [`09`](09-session-analysis.md) `wrapUpSuggested` precedent, identical to how §15 was wired):

1. **Prompt:** the analysis prompt is handed the **unfilled-`invited`-sections + thin-life-areas** context and
   a one-line instruction — _"if the conversation keeps circling a profile area the person hasn't explored,
   optionally name ONE in `depthInvitations`; omit when nothing recurs."_ The set of unfilled sections is
   computed host-side from the person's `IntakeSession` (catalog `tier === 'invited'` ∧ status ∈
   {notStarted, skipped}) and passed in.
2. **Output:** the validated `depthInvitations` are handed to `recordDepthInvitationsFromAnalysis` right beside
   the existing `recordSuggestionsFromAnalysis(... profileSuggestions ...)` call.

This rides the metered pass that already happened, so it costs nothing extra — and it's **gated to the subject's
own process** (the producer already runs as that person).

### 5.3 Mapping & catalog reads (pure, tested)

- A pure **`LifeArea → sectionId`** map (`packages/core/src/profile/depthRouting.ts`, e.g.
  `'Family' → 'family'`, `'Intimacy' → 'intimacy'`, `'Work & purpose' → 'work-money'`) routes an area-only
  invitation to the closest `invited` section. `LIFE_AREAS` is the existing `schemas.ts` list; the map only
  covers areas an invited section owns (others are ignored).
- **`unfilledInvitedSections(session)`** — a pure helper over the `IntakeSession` returning the invited
  sections not yet filled, used to build the analysis context and to validate an incoming invitation.

### 5.4 Renderer

- **Surfaces (no new answering UI):** a depth-invitation **card** on Home ([`17`](17-home-dashboard.md)) and a
  "suggested" treatment on the Onboarding "Go deeper" cards ([`18`](18-personal-onboarding.md) §3.1) — both
  read pending depth invitations from the per-person profile-suggestions store. Accepting routes to the
  existing intake section/go-deeper via the router (the §14.7 path); §29 adds no new route.
- **In-session offer (optional):** rendered by the existing Sessions composer/coach turn — it's a normal coach
  message, not a new component; the guardrails (§3.5) are prompt-level.
- **Store:** reuse the §15 profile-suggestions store (per-person, reset on `activePerson.id` change — the
  per-person-isolation rule). The depth cards filter `kind === 'depth'`.
- **No new nav.** Depth invitations live in Home + Onboarding, which already exist.

## 6. IPC / API contracts

Reuses the §15 channels — all **own-scoped + gated `intake.own`** in the bridge (the trust boundary), the
Claude key stays in main:

- **`profile:suggestions`** — list the subject's own pending suggestions (now including `kind: 'depth'`). The
  renderer splits them into freshness vs. depth.
- **`profile:acceptSuggestion({ id })`** — for a `depth` invitation, marks it `accepted` and returns the
  resolved `{ sectionId }` so the renderer opens that intake section (it does **not** write a `Person` field).
  For a `field`/`intakeSection` suggestion, unchanged (§15).
- **`profile:dismissSuggestion({ id })`** — durable dismissal, unchanged.

No new producer IPC — depth invitations are recorded **inside** each producer's existing analysis IPC handler
(`sessions:endAndSummarize`, the dream-analysis op, `assignments:analyze`, `intake:synthesize`), which already
runs own-scoped in main.

**Claude API:** §29 never makes its own call. It only **extends the prompt + output contract** of the
producers' existing analysis passes ([`06`](06-ai-usage-and-budgets.md) metering unchanged); a depth invitation
is validated (`RawDepthInvitationSchema`) before it's trusted, so a malformed/hallucinated section id is
dropped (§5.1).

**Setting (in-session ask):** a vault-scoped, schema-driven setting ([`03`](03-settings.md)) toggles the §3.5
in-session ask (default pending — §11). When off, depth invitations only surface as cards; when on, the coach
may also weave the one gentle question (prompt-level).

## 7. States & edge cases

- **No recurring area / nothing unfilled** → the pass emits no `depthInvitations`; no card. (The common case.)
- **AI offline / over budget** → no analysis pass runs, so no detection — exactly like §15 and the producers
  themselves; nothing is lost, partial progress preserved ([`18`](18-personal-onboarding.md) §7).
- **Target section already filled / completed between detection and surfacing** → the invitation resolves/clears
  on next read (`unfilledInvitedSections` no longer includes it); never invite a finished section.
- **Target section was explicitly skipped** → treated as a standing dismissal (§3.4); not re-invited within the
  cooldown.
- **Model names a `core` section or a non-existent/`field` target** → dropped at validation (§5.1); §29 only
  invites `invited` sections.
- **Duplicate/stacked invitations** → superseded by the §15.2 dedup (one per area, newest wins, §3.4).
- **Restricted area (trauma/intimacy) before the 18+ ack** → the **card** may still appear (a gentle "want to
  explore this?"), but accepting routes through the existing 18+ gate; the **in-session ask** is suppressed
  until the ack ([`18`](18-personal-onboarding.md) §14.10). A restricted-derived invitation is itself
  `restricted` — own-scoped, owner-visible, redacted for everyone else (§8).
- **Per-person isolation** → the store resets on `activePerson.id` change; one person's depth invitations never
  leak into another's view ([`18`](18-personal-onboarding.md) §7).
- **Crisis disclosure during a session with a pending in-session ask** → the coach drops the ask and routes to
  support (§3.5, §8); the always-present `CrisisFooter` remains.
- **Migration / corrupt file** → additive parse; a corrupt suggestion record degrades to "no card," never a
  crash and never a silent share of a restricted theme (standard vault behaviour, [`00`](00-architecture.md)).
- **Concurrent external edit / sync conflict** → standard vault behaviour; the suggestions are independent
  per-record files, so a conflict touches at most one invitation.

## 8. Safety, privacy & honesty

§29 inherits the [`18`](18-personal-onboarding.md) §8/§14.10/§15.5 safety model wholesale; the additions are
about **what the coach proactively asks**.

- **Not medical.** Depth invitations are an offer of **reflective self-knowledge**, never assessment, diagnosis,
  or treatment (CLAUDE.md §1). The in-session ask is appended **after** the non-negotiable PERSONA + SAFETY and
  cannot override them. Copy is an invitation ("want to tell me about…?"), never an evaluation.
- **Crisis takes precedence.** Crisis/self-harm/abuse routing is unchanged and non-negotiable
  ([`05`](05-conversations.md) §7): any depth ask is **dropped** the moment distress is disclosed, and the
  coach responds with warmth + professional/emergency resources. The "Get help now" footer is always present.
- **Own-scoped.** Invitations derive from the person's **own** activity about themselves; they live in the
  person's own context. The cross-person leak rules ([`18`](18-personal-onboarding.md) §8.4) are unchanged.
- **Restricted inherits restriction.** An invitation toward a `restricted` area (trauma/intimacy) is itself
  `restricted` — owner-visible (the full-access Owner per [`04`](04-people-roles.md) §8), redacted for everyone
  else, and its `theme`/`rationale` text is held under the same redaction (so a "want to talk about your
  trauma?" theme never surfaces in another person's view).
- **18+ & relevance gating for sensitive depth.** Trauma/intimacy depth is only ever _invited in-session_ when
  the topic is clearly relevant **and** the 18+ ack is complete (intimacy); the card-level invitation routes
  through the existing 18+ gate on accept (§3.5, §7).
- **Never silently changes anything.** Like §15, §29 only **proposes**. Accepting opens a section the person
  then fills; nothing is written without them. **Dismiss is durable** (no nagging); a skipped section is a
  standing decline.
- **No dark patterns.** At most one invitation surfaces at a time; "Not now" is always a first-class, equal
  action; the cooldown + dedup prevent a checklist-of-shame.
- **Transparency.** The card's subtitle states _why_ ("we've touched on family a few times"), so the
  invitation is legible, not magic.

## 9. Accessibility

Per [`01`](01-design-system.md) §9, inheriting the Home/Onboarding surfaces:

- The depth card is a labelled region with real **Go deeper** / **Not now** buttons (keyboard-operable, visible
  focus); the theme/rationale is text (not color-only).
- Accepting moves focus into the opened intake section (the §14.7 form's existing focus flow).
- The "suggested" treatment on a Go-deeper card is conveyed with text/icon, **not color alone**.
- The in-session ask is an ordinary coach message in the existing live-region transcript (announced politely).
- Reduced-motion respected; responsive ~360px→desktop within the [`02`](02-app-shell.md) shell; control
  geometry stable (the §7 DoD control-geometry guard).

## 10. Testing strategy

Vault + Claude mocked as established (`SELFOS_FAKE_CLAUDE`); run `pnpm typecheck` after tests (memory
`vitest-does-not-typecheck`).

- **Unit (core):**
  - `recordDepthInvitationsFromAnalysis` records a depth invitation for an **unfilled `invited`** section;
    **drops** one targeting a `core`, already-filled, or skipped section; **dedups** (one per area, newest
    supersedes pending; a dismissed area doesn't re-fire within cooldown); **inherits `restricted`** from the
    catalog (never the model); validates/ignores a malformed/hallucinated section id.
  - A producer analysis pass that surfaces a recurring unfilled area emits a `depthInvitation`; one that
    doesn't emits none; **no extra metering event** is recorded for it.
  - `unfilledInvitedSections` + the `LifeArea → sectionId` routing are pure and correct.
  - `acceptSuggestion(kind:'depth')` does **not** write a `Person` field and returns the resolved `sectionId`;
    dismiss is durable.
- **Redaction / privacy (core + bridge):** a `restricted`-derived invitation is `restricted` and own-scoped —
  owner-visible, redacted for a member; never appears in another person's store.
- **Component (RTL):** the Home depth card shows the theme + Go deeper / Not now; the Onboarding "Go deeper"
  card shows the suggested treatment; accepting routes to the section; dismiss removes the card and doesn't
  re-show; a `restricted` invitation shows for the owner, not a member.
- **E2E (Playwright):** a Member finishes the `core` gate → does sessions that keep circling an unfilled
  `invited` area → a depth card appears (assert via decrypt that a `kind:'depth'` record exists) → **Go deeper**
  opens that intake section → fill + re-synthesize enriches the portrait (decrypt) → dismiss a second
  invitation and confirm it doesn't re-nag. 390px overflow + control-geometry guards. The in-session ask path
  (if shipped on by default) gets its own case: a relevant session offers one gentle depth question; an
  irrelevant (budgeting) session never does; a crisis disclosure drops the ask.

## 11. Open questions

- **Model shape — extend or sibling?** Does §29 **extend** `ProfileUpdateSuggestion` with `kind: 'depth'` (the
  DRY default this draft specs — reuses §15's service/IPC/store), or add a **separate `ProfileDepthInvitation`
  model + service**? Extending is less code and one review surface; a sibling keeps freshness and depth
  cleanly distinct. **Recommend extend** unless the user wants strict separation.
- **In-session ask — on or off by default?** Should the §3.5 coach-weaves-a-depth-question behaviour ship
  **on** (richer, more humane) or **off** (cards-only, most conservative) by default, with the
  [`03`](03-settings.md) toggle either way? This is a product/tone call.
- **Invitation cadence / throttle.** The **cooldown** before a dismissed area can re-fire (e.g. 30 / 60 / 90
  days?), the **global cap** on simultaneous pending depth invitations, and how many recurrences before the
  model should offer one (the analysis prompt's "keeps circling" threshold — 2? 3?).
- **Surfacing priority vs. §15 freshness.** When both a depth card and a "Keep your profile fresh" card are
  pending, which leads on Home (or do they coexist as one combined "your profile" section)? — a small UX call.
- **Skipped-section policy.** Is an **explicitly-skipped** invited section a _permanent_ decline (never
  re-invited), or does it re-open after a long cooldown if activity strongly recurs? (This draft treats it as a
  standing decline within the cooldown — confirm.)
- **Area routing coverage.** Which `LIFE_AREAS` map to an `invited` section vs. have no owning section (and so
  are never invited)? Finalize the `LifeArea → sectionId` map at build, against spec 26's trimmed catalog.

## 12. Resolved decisions

Confirmed by the user's direction for this onboarding-redesign group (2026-06-21):

- **Shape** — **tighter intake + progressive follow-on**: a tight `core` gate (spec 26), with the deeper
  `invited` profile **built progressively over time, in context, by relevant invitation** — not front-loaded.
- **Mechanism** — detection **rides the existing metered analysis passes** (sessions/dreams/questionnaires +
  intake synthesis); **no new AI call, no new metering** (the §15 / [`09`](09-session-analysis.md) "one marker,
  free signal" precedent).
- **It is §15's sibling** — a distinct **depth** invitation ("this area is unexplored — go deeper?") vs. §15's
  **freshness** update ("this answer is stale — update it"), sharing the `@selfos/core/profile` service.
- **Surfacing** — calm, opt-in cards (Home + the Onboarding "Go deeper" grid) and, optionally, one gentle
  in-session ask; **never an interrupt, never a block**; **dismiss is durable**.
- **Acceptance** — opens the right `invited` intake section / go-deeper chat, prefilled & scoped (the §14.7
  path); §29 adds **no new answering surface** and never writes without the person.
- **Gate relationship** — §29 only invites `invited` sections; it **never re-gates** a finished `core`; §29
  **assumes spec 26's trimmed catalog**.
- **Privacy/safety** — own-scoped; restricted-derived invitations inherit `restricted` (owner-visible,
  everyone-else redacted); not-medical/crisis framing unchanged; intimacy/trauma depth gated by 18+ ack +
  relevance.
- **Additive + migration-safe** — extend the §15 schemas additively, no `schemaVersion` bump.

_Build-time tunings (final section wording, the `LifeArea → sectionId` map, cooldown/throttle constants, and
the §11 model-shape + in-session-default calls) are resolved when this is built, after specs 26–23._

## 13. Changelog

- 2026-06-21 — created (Draft). The progressive-profile-building / **depth-invitation** spec — the sibling of
  [`18`](18-personal-onboarding.md) §15's freshness system: a calm, opt-in invitation to go deeper on an
  unexplored `invited` intake section / thin life-area, detected as a **free by-product** of the producers'
  metered analysis passes ([`09`](09-session-analysis.md)/[`08`](08-questionnaires.md)/[`13`](13-dream-images.md)
  - intake synthesis) and surfaced through [`17`](17-home-dashboard.md) Home + the [`18`](18-personal-onboarding.md)
    Onboarding "Go deeper" grid, with an optional one-question in-session ask. Extends the §15
    `@selfos/core/profile` service additively. Built in its own session, **after** specs 26 (intake catalog),
    22 (intimacy block), 28 (portrait synthesis) — and **assumes** 21's trimmed `core`-gate-plus-`invited`-depth
    catalog.
