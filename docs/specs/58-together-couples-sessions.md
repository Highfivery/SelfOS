# 58 — Together: couples sessions

> **Status:** **BUILT (Phases A–H)**; **Phase I in progress** — _last updated 2026-07-13_
>
> **All phases A–H are built + merged to `main`** (A+B PR #148 · C #155 · D #156 · E #157 · F #158 ·
> G #159 · H1 #160 · H2 #161 · H3 pending). Per-phase build notes are inline (search "BUILT (Phase …)").
> **Phase I — grounded coaching & private clarifications (§3.14):** a post-A follow-up in two slices
> (I1 prompt grounding + self-verification; I2 the coach-initiated `[[SELFOS:PRIVATE]]` channel).
> **Two items remain for a maintainer with a real Claude API key:** the §13 live-model adversarial pass
> over the explicit register (the offline fakes always return canned output, so it can't run here), and
> the optional direct in-app "Send to both" compat-send from a questionnaire suggestion card (H3 ships
> the safe builder-doorway instead). Product sign-off flagged: the YNM status surfaces a partner's
> ack/opt-in state (never their inventory) — see the §3.10b note.
>
> A new top-level feature: **async, invitation-based, AI-facilitated sessions between connected
> partners** — a shared transcript both partners contribute to, coached by an expert relationship &
> intimacy coach (informed by Gottman, EFT, and Masters & Johnson — **not therapy**), deeply
> personalized from both partners' data under a strict confidentiality contract, with private
> asides, solo prep spaces, a deterministic safety pre-screen, a persistent **relationship memory**
> (agreements, shared reports, pulse), and an 18+ explicit register gated on **both** partners'
> acknowledgements. Interactive mockups were approved by the owner on 2026-07-10 (8 screens,
> including the per-partner privacy-projection demo). This draft has passed a 4-lens adversarial
> review (decision fidelity · architecture fit · safety/privacy · testability); all findings are
> incorporated.

Builds on [`05-conversations.md`](05-conversations.md) (the turn pipeline, PERSONA/SAFETY, markers,
fail-safes), [`16-guided-sessions.md`](16-guided-sessions.md) (guide addenda, structured steps, the
18+ ack), [`09-session-analysis.md`](09-session-analysis.md) (wrap-up → Insight),
[`04-people-roles.md`](04-people-roles.md) (the relationship graph — `partner` edges — capabilities,
accounts), [`42-relationship-scoped-sharing.md`](42-relationship-scoped-sharing.md) /
[`54-memory-redesign.md`](54-memory-redesign.md) (the sharing gates + `confidentialityPreamble` +
relationship synthesis), [`08-questionnaires.md`](08-questionnaires.md) (compatibility sends +
alignment reports + the shared-artifact storage precedent), [`52-challenge-sessions.md`](52-challenge-sessions.md)
(the challenge marker + tracked entity + the gated explicit register precedent),
[`39-living-memory-continuity.md`](39-living-memory-continuity.md) (Goals, commitments grounding),
[`35-notification-system.md`](35-notification-system.md) and [`53-home-encouragement.md`](53-home-encouragement.md)
(notification kinds + Home providers), and [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md)
(metering/budgets). It **absorbs** the approved-but-unbuilt
[`11-relationship-tracking.md`](11-relationship-tracking.md) (its dashboard + intimacy check-in land
here as the **Pulse** phase; spec 11 gains a superseded-by note when Phase G ships). References
[`00-architecture.md`](00-architecture.md) / [`01-design-system.md`](01-design-system.md) rather than
restating them (DRY).

---

## 1. Overview

SelfOS coaches each person individually and already lets partners _inform_ each other's coaching
through relationship-scoped sharing (42/43/44/54) and compare perspectives through compatibility
questionnaires (08 §16/§17). What it cannot do is the thing couples actually need most: **work
through something together, with a skilled facilitator, in one shared conversation.**

**Together** adds that. From a new top-level surface (visible only when the active person has a
connected partner), a person starts a session with their partner. The partner receives an
**invitation** whose acceptance is a real consent ceremony (the "rules of the room"). The session is
a **shared, asynchronous conversation**: both partners write as themselves, from their own devices,
whenever they can; the AI coach replies to every message but deliberately **holds space** — staying
brief until both partners have weighed in, then facilitating like an expert couples coach:
naming cycles (EFT), enforcing fair turns, proposing repair moves (Gottman), and — when both
partners have acknowledged adult content — coaching sex and desire **frankly and explicitly**.

Three design commitments distinguish it:

1. **Deep personalization, honest confidentiality.** The coach draws on each partner's **full own
   context** (portrait, insights, tests, goals — everything their solo coach knows, **except**
   `restricted` break-glass facts, which a new code-enforced filter excludes — §6.3) — but its
   output is visible to both partners, so a **couples confidentiality contract** (§6.3) governs
   what it may _use_ versus _say_. The residual risk of a prompt-level guarantee is documented,
   not hidden (§8.7).
2. **Private channels inside a shared room.** Either partner can send an **invisible private aside**
   to the coach, and each has a **solo prep space** per session. The _capability_ is disclosed to
   both at join (the rules of the room); the _instances_ are invisible — mirroring how experienced
   couples facilitators run disclosed-policy individual check-ins alongside joint work (§3.6, §8.4).
3. **A relationship memory that compounds.** Sessions produce **twin per-partner insights**, a
   **shared wrap-up report**, captured **agreements**, and **pulse** metrics — so every session
   starts already knowing the relationship (§3.9, §4).

## 2. Goals / Non-goals

**Goals**

- A **Together** top-level surface (nav + `/together` route, capability `together.own`), shown only
  when the active person has a live `partner` relationship (multiple partners → a partner picker;
  sessions are per-pair in v1).
- **Async shared sessions**: invitation → accept ceremony → turn-taking from each partner's own
  device; author-attributed messages; "your turn" badges + notifications; near-live refresh via the
  existing vault watcher.
- The **couples coach**: full-context personalization per participant, the confidentiality contract,
  hold-space cadence, research-informed facilitation, and (both acks) the full explicit register.
- **Private channels**: invisible per-message asides + per-partner solo prep spaces, with the
  rules-of-the-room disclosure, the coach's no-sabotage secrets stance, and consistent
  non-confirming deflection.
- The **full safety layer**: a private, deterministic, AI-free pre-screen before each partner's
  first session; in-prompt coercion awareness; non-attributed pause + cheap exits; per-partner
  crisis privacy (§8).
- **Relationship memory**: twin insights (a new `'together'` insight source + the dormant
  `Insight.relationshipId`), a shared report, an agreements ledger (`[[SELFOS:AGREEMENT]]` marker),
  and the session-start grounding pack.
- **Pulse** (absorbing spec 11): dyad metric trends from session analysis + 1–3-tap check-ins +
  dual-consent comparative views (desire alignment).
- **Integrations**: joint challenges, mid-session compatibility-questionnaire suggestions, the
  Yes/No/Maybe mutual-overlap exercise (symmetric, revocable opt-in), a Together guided catalog,
  notification kinds, and a Home recommendation provider.
- **Billing**: the initiator's budget pays for every AI spend in the session (prep spaces are solo
  spend — §6.2).

**Non-goals (explicit, with reasons)**

- **Couch mode** (both partners at one device, live) — deferred by owner decision (2026-07-10). The
  data model must not preclude it (speaker attribution is already per-message), but no v1 UI,
  no PIN-join ceremony, no speaker toggle.
- **Live remote co-presence** — there is no realtime transport (00 §4; the vault is file-synced);
  building relay-grade infrastructure for live sessions is out of scope. Async + watcher refresh is
  the honest v1.
- **N>2 group sessions** — v1 sessions are exactly two partners. The schema uses `participantIds[]`
  and per-participant records from day one so 3+ (poly households — already representable in the
  graph) is a later additive slice, not a rework.
- **External (non-household) partners** — the relay's zero-knowledge mailbox model doesn't extend to
  an evolving shared transcript; household members only in v1.
- **Restricted break-glass facts in the coach's context** — excluded under every circumstance in v1
  by a **code-enforced filter** (§6.3 — the existing store gates alone do NOT deliver this: they
  exclude restricted facts from _others'_ context but relevance-gate them **into** the subject's
  own intimacy-topic context, and the pinned portrait is exempt entirely). A per-session opt-in is
  a possible future amendment, not v1. Consequence (deliberate): desire-topic continuity **resets
  each session** in v1, since twin sexual facts are also stored restricted (§3.9, §8.6).
- **Topic rename after create** — the topic is immutable in v1 (it lives on the single-writer
  `session.enc`; a rename affordance would add a second writer — §4).
- **Split billing** — one payer (the initiator); `UsageEvent` has one `personId` (06).
- **Scheduling/reminders for sessions or pulse** — manual v1, consistent with 11's deferral.

## 3. UX & flows

Approved mockups (2026-07-10) are the visual source of truth: Together home · Invitation ·
Pre-screen · Session · Solo prep · Wrap-up · Catalog · Pulse, with the Ben/Angel perspective toggle
demonstrating the privacy projection. Flows below are normative. **Every derived signal a viewer
sees — status, turn state, unread counts, snippets, updated-at, notification signatures — is
computed over that viewer's projection (§5.2), never over raw files.** This single rule underpins
the privacy behavior of §3.5, §3.6, and §3.11.

### 3.1 Entry & visibility

- **Nav**: a "Together" entry (interwoven-lines mark), gated on `together.own` **and** the active
  person having ≥1 live `partner` relationship edge (resolved read-time via
  `relationshipTypesFromSubjectToViewer` — deleting the edge removes the surface). The nav badge
  counts sessions **waiting on you** (invitations + your-turn sessions), derived over your
  projection.
- **No partner edge** → no nav entry (never a dead surface). People/relationship editing remains the
  place to connect a partner; the Home recommendation provider (§3.12) never fires without an edge.
- **Partner without a login account**: `ensureMemberAccounts` (04) auto-creates accounts for
  subjects, so household partners are addressable; a partner who is a non-subject contact (no
  account) cannot participate — the picker shows them **disabled** with an explainer ("Angel needs
  a SelfOS login in this household to join — make her a subject in People").

### 3.2 Together home (`/together`)

Per the mockup: page title + the honest frame line ("Informed by research-backed approaches like
Gottman and EFT. Not therapy, and not a substitute for professional care."), a **Start a session**
CTA, the **relationship memory strip** (Agreements · Pulse trend · Latest alignment · Joint
challenge — each tile deep-links), the **sessions list** (status pills: `Your turn` /
`Waiting for <partner>` / `Invited` / `Ended` / `Completed`; avatar pair; last-message snippet;
updated-at — all projection-derived), the guided-catalog entry row, and the standard crisis footer.
With >1 partner, a partner switcher scopes the page to one pair at a time.

**Progressive assembly across phases (normative — no dead controls, §12):** the catalog row is
**absent until Phase E**; memory-strip tiles land with their feature (Agreements + Latest alignment
in D, Pulse in G, Joint challenge in H) and **every tile self-hides when its data source is empty**.
Each phase's E2E asserts no unbuilt tile/row renders.

### 3.3 Starting a session

1. **Start a session** → pick the partner (pre-selected when only one) → optional topic (free text
   or, from Phase E, a guided catalog entry §3.10) → **Send invitation**. "New session" and every
   catalog / Desire & intimacy practice card open the same **centered start modal** (`TogetherStartDialog`
   — a hand-rolled `role="dialog"` overlay, the app's ChangeVaultDialog pattern; no auto-send), with the
   optional topic box for a free session or the guide's blurb for a practice. Esc / the scrim / Cancel
   close it. It replaced an inline "start bar" that rendered near the top of the home, so opening it from
   a card lower down left it off-screen — a modern, always-in-view overlay (issue #207).
2. The session is created in `invited` status with the initiator as first participant (creating
   requires the initiator's own pre-screen — §8.2). The initiator can write opening messages
   immediately (the coach replies normally but observes the hold-space rule — it will not go deep
   before the partner joins).
3. The partner sees it: nav badge + a `together-invite` notification (§3.11) + the session card
   ("Ben invited you") on their Together home.
4. Invitations **expire after 30 days** un-accepted (computed on read; the initiator's card shows
   "Invitation expired — send again?"; send-again mints a **fresh session**, the old one stays
   expired).

### 3.4 The invitation & consent ceremony (the partner's first open)

Opening an invited session shows the **rules of the room** (mockup: Invitation screen) — the copy is
**derived from mechanics** (the `compatibilityDisclosure` single-source-of-truth pattern, 08 §16.2)
so it can never drift from behavior. The statements are **mechanical, never absolute** (§8.7):

- **You both see the conversation.** Everything either of you writes in the session appears for
  both of you.
- **The coach knows you both.** What SelfOS knows about each of you shapes its support — and it is
  designed never to quote, share, or hint at what it knows about one of you to the other.
- **Private notes exist.** Either of you can mark a note "private to the coach" at any time. A
  private note doesn't appear in the shared conversation — though the coach may encourage you to
  bring something up yourself when the moment is right.
- **Nothing new is shared between you.** Joining doesn't show your partner anything of yours — it
  lets the coach support you both, privately informed.
- **You can step away.** Pause or leave any session at any time, no reason needed.

Plus: the **18+ line** ("You've both turned on adult content — intimacy topics can be explored
frankly") **only when both acks exist** (bridge-checked). Actions: **Continue** (→ the session) ·
**Not right now** (leaves it invited) · **Decline quietly** (§3.5). _(The pre-screen step was removed
— §8.2.)_

Accepting writes the partner's **consent record** (their per-participant state file: `rulesAckAt`) —
the load-bearing consent moment for full-context personalization. **Per the durable product rule
(CLAUDE.md §1), no copy anywhere in this flow may state or imply that a household owner/admin can
access anyone's data** — and no copy anywhere may make absolute-secrecy claims (§8.7).

### 3.5 Declining

- **Not right now** — closes the screen; the invitation stays pending (re-openable).
- **Decline quietly** — writes `declinedAt` to the partner's state file. **Status is
  viewer-projected (§4.3): the decliner's own list drops the session entirely; every other
  participant's projection ignores a foreign `declinedAt` and keeps deriving `invited` →
  `expired`.** The initiator is never notified and never sees "declined" — their card shows
  "Invited" until the 30-day expiry ("expired — send again?"). This is a deliberate soft exit for
  someone who doesn't feel able to say no directly (§8.3), and it is asserted at the bridge level
  in E2E (§10 #6).

### 3.6 The session thread

Per the mockup: header (topic, avatar pair + coach, status pill, **Prep privately** button, kebab),
the message thread, the composer, and the pinned crisis footer.

- **Messages are author-attributed** (avatar + name; your own right-aligned). The coach's messages
  render via the shared `<Markdown>` (34).
- **The coach replies to every message** but **holds space** (owner decision): while one partner
  hasn't yet weighed in on the current thread of discussion, it stays brief — acknowledges, asks
  small clarifying questions, and explicitly defers big moves ("I'd like to hear Angel on this
  before we go further"). Full facilitation (cycle-naming, exercises, agreements) engages once both
  have contributed. This is a prompt contract (§6.3), not turn-blocking — either partner can always
  write.
- **Private asides**: the composer's "🔒 Private to the coach" toggle restyles the whole composer
  (dashed accent border) + shows the hint ("Only the coach sees this note in the conversation.
  Angel won't see it here — or that you wrote one."). A sent aside renders **only in its author's
  view** (dashed border + lock tag). **The partner's projection omits it entirely — no placeholder,
  no count, no timing signal** (owner decision; rationale + mitigations §8.4). **An aside turn is
  private end-to-end (normative):** the coach's reply to a `privateAside` message is persisted
  **itself `privateAside: true` with the aside author's `authorPersonId`** (so the existing
  projection hides the whole exchange); shared-artifact markers (AGREEMENT / SUGGEST / CHALLENGE)
  and structured-step advancement are **suppressed on aside turns** (the coach instead responds
  privately and, when an artifact would help, encourages raising it in the open thread);
  `replyToMessageId` referencing an aside never crosses into the partner's projection. And because
  every derived signal is projection-computed (§3 intro), an aside **never** flips the partner's
  turn badge, unread count, snippet, updated-at, or notification signature.
- **Attachments** (from Phase C): images the coach can see, via Together's own seam (§6.1 — the 45
  channels are hard path-scoped to solo conversations and cannot serve a shared folder). Visible to
  both partners; an attachment referenced only by a `privateAside` message is readable **solely by
  the aside's author** (bridge-gated, §5.2).
- **In-thread artifacts** (rendered as cards, minted by coach markers §6.4): captured
  **Agreements** (green-edged card, "You can both see and edit this in Together") and
  **suggestions** (violet-edged: a compatibility questionnaire "Send to both" / a guided exercise /
  a joint challenge). Artifact actions are one-tap and always confirmable before anything sends.
- **Kebab**: pause for me (§8.3) · leave session (§8.3) · wrap up & reflect (either partner; §3.8).
- **Turn state**: a session is "your turn" when the newest human message **in your projection**
  isn't yours. It's a nudge, never a lock — both partners can write at any time, in any order. When the
  session is **wrapped up** (`complete`, §3.8), the pill reads **"Wrapped up"** and the composer
  collapses behind **"Reopen to keep talking"** — a shared message reopens it.
- **Freshness**: the Together stores subscribe to the existing `vault:changed` watcher event
  (debounced re-fetch of the open session + the list) — the first data consumer of that event — so a
  partner's synced message appears without a manual reload ("live-ish": bounded by provider sync
  latency; expectation-set in copy, never promised as instant). Nav/focus refresh still works with
  the watcher absent (§7).

### 3.7 Solo prep spaces

Per the mockup: **Prep privately** opens the person's own prep thread for this session — an
**ordinary `05` Conversation** under their own `people/<id>/conversations/` carrying a
`togetherSessionId` link (full reuse of composer/streaming/retry/attachments). It is excluded from
the main Sessions list by a **new `togetherSessionId` filter** in the Sessions list read (new
behavior — dream-analysis chats achieve the same outcome by living outside `conversations/`, so
there is no existing filter to reuse; the filter gets its own unit + a solo-Sessions regression
test, §10). The coach's prep persona helps the person find words and **encourages them to bring
what matters into the shared session**. Prep content **never** appears in the shared transcript or
the couples prompt as text; it reaches the couples prompt only as the author's own-context insight
(a prep wrap-up insight is own-subject, feeding their side of the couples context like any insight).
Prep is **solo spend billed to its author** (§6.2).

### 3.8 Reflect & wrap-up

Two entry points run the **same** metered `together.analyze` pass (`mode: 'reflect' | 'wrapUp'`;
initiator-billed, `extendedThinking: false`), so the analysis, artifacts, and de-dup are identical:

- **Reflect & note action items** — a **mid-session checkpoint**. Creates/refreshes the reflection +
  action items and leaves the session **open** (it does NOT mark it done). Doubles as "refresh" once a
  report exists (the button reads "Reflect again & note actions").
- **Wrap up & reflect** — the same analysis, and it marks the session **done** (sets `report.wrappedUp`,
  so the session derives `complete`, §4.3). Also reachable via the coach's `[[SELFOS:WRAPUP]]` hint.

Both are **idempotent** (reuse the report + twin ids) and **de-dup action items** against the pair
ledger, so running one then the other (or either twice) **never doubles** the report, twins, or action
items. The pass runs over the **mutually-visible transcript only — every `privateAside` message (and
its attachments) is structurally excluded from the analyze input host-side, before prompt assembly** (a
code boundary, not a prompt instruction; v1 excludes asides from _all three_ artifacts including the
author's own twin — the author's private material still reaches their solo coaching via prep/own
sessions). It produces:

1. The **shared report** (both see; mockup Wrap-up screen): themes, "what you worked through,"
   agreements made, joint challenge started, pulse line. Stored in the session folder. **The
   analyze contract routes crisis content away from the report** (§8.5): the report stays
   supportive and detail-free; crisis signals land only on the affected partner's twin.
2. **Twin insights** — one per partner (`source: 'together'`, `subjectPersonId` = that partner,
   `relationshipId` = the live partner edge id at wrap-up time (best-effort linkage),
   `provenance.togetherSessionId` + `provenance.pairKey` — the pairKey is the **stable** queryable
   relationship dimension, since edges can be deleted/re-created), each feeding **only that
   partner's** own coaching context; a personal reflection written for them ("you each see only
   your own"). **Sexual-topic facts are stored `restricted: true`** (the 52 `recordCheckIn`
   precedent) so they can never cross to anyone else's context — including future Together prompts
   (the §2 continuity trade-off).
3. **Dyad metrics** on both twins (e.g. `connectionValence`, `frictionLevel`, clamped ±1) — the
   pulse series source (§3.10a).
4. **Action items** — concrete next steps the couple named are extracted and written as **standing
   pair agreements** (the same ledger as `[[SELFOS:AGREEMENT]]` markers, §3.9), **deduped** by
   normalized text against the existing ledger (chat markers + prior reflect/wrap-up runs) — and the
   prompt is fed the existing items as an "already captured, don't repeat" list (soft de-dup) with the
   normalized-text filter as the deterministic backstop. This is why reflect-then-wrap-up never doubles
   them. The report references the pair's session action items via `agreementIds`.

**Staleness is derived, never stored** (consistent with derived status): the report and twins are
stale when any human message in the session is newer than `report.updatedAt` (the last time the
reflection was generated — so a fresh reflect/refresh clears staleness). Continuing a wrapped-up
session simply means writing a new message — the session derives back to `active` and the report
derives stale; re-running overwrites idempotently (the 09 reuse-the-insightId pattern). Only an
**explicit wrap-up** (`report.wrappedUp` → `report.wrappedUpAt`) makes the session derive `complete`;
a mid-session reflect never sets it — **and never clears it either**: a `reflect` pass **carries
forward** an existing report's `wrappedUp`/`wrappedUpAt`, so "Reflect again" on a wrapped-up session
refreshes the reflection **without** silently un-wrapping it. The invariant holds: **only a new shared
message reopens a session** (issue #206).

**A wrapped-up (`complete`) session closes out in place** (renderer, §5.3; issue #206): the session
detail leads with a **"This session is wrapped up · <date>"** completion banner (`role="status"`,
scrolled into view on the complete transition), the reflection report + action-items/agreements ledger
**above** the thread, the thread's turn pill reading **"Wrapped up"**, and the message composer
**collapsed behind a "Reopen to keep talking"** button. The terminal **"Wrap up & reflect"** button
drops from the reflection panel once complete (**"Reflect again & note actions"** stays — it refreshes,
never un-wraps, per above). Revealing the composer and sending a shared message reopens the session —
the derive-back-to-`active` soft-complete model above, made visible.

### 3.9 Relationship memory & the grounding pack

- **Agreements / action-items ledger**: agreements captured in any session — via
  `[[SELFOS:AGREEMENT:{json}]]` markers **or** extracted as **action items** by the reflect/wrap-up
  pass (§3.8, deduped) — live at the **pair** level, each with text, timeframe, status (standing / done
  / retired), and provenance (which session). Either partner can edit/retire (the one deliberate
  two-writer record — last-write-wins accepted, §7). **No duplicates (issue #206):** both capture paths
  de-dup by normalized text — the marker path (`captureAgreementFromMarker`) returns an existing
  non-retired twin instead of minting a copy (the coach can repeat the same marker across turns / on a
  retry), and the wrap-up action-item path already de-dups against the ledger; a read-time
  `dedupeAgreements` (preferring the most-actionable twin) collapses any legacy duplicates on display.
- **Where the ledger surfaces (issue #206):** the **per-session** reflection panel + top strip show
  **only that session's** agreements (`provenance.sessionId === session.id`) — never the pair's whole
  history. The **pair-wide** view (every standing commitment across the pair) lives on **Home**
  ("needs attention") and **Goals** ("Together commitments", `togetherMyAgreements` / spec 61), which
  also de-dup.
- **The grounding pack** (zero extra AI spend — all cached/deterministic reads): every couples
  prompt opens with the pair's standing agreements, the latest compatibility `AlignmentReport` (if
  any), open joint challenges, each partner's cached relationship synthesis (54), and recent pulse
  movement — so the coach "already knows the relationship" (§6.3). **Known v1 limit:** because twin
  sexual facts are restricted (§3.8), desire-topic continuity deliberately resets each session; the
  grounding pack carries relational continuity, not sexual detail (§8.6).
- **Twin insights** carry `provenance.pairKey` (stable) + `relationshipId` (best-effort edge
  linkage), giving insightStore a queryable relationship dimension (display stays per-person per
  spec 57; relationship-level artifacts surface on Together, not Memory).

### 3.10 The Together guided catalog

Per the mockup: a catalog of **couples guided sessions** in three groups —

- **Connect**: Love Maps (structured turn-taking quiz) · State of the Union (weekly ritual,
  structured) · Appreciation exchange · Dreams within conflict.
- **Repair**: Naming your cycle (EFT, structured) · Repair after a rupture (structured) · The Four
  Horsemen & antidotes · Speaker & listener (structured, coach-enforced turns).
- **Desire & intimacy (18+)**: Sensate focus (structured multi-week program) · Yes/No/Maybe —
  together (structured; §3.10b) · Desire mapping · Fantasy exchange.

The couples entries live in their **own catalog** (`togetherCatalog.ts` — groups
`together-connect` / `together-repair` / `together-desire`), **separate from the solo
`guidedCatalog`**: solo surfaces never list couples guides, `GuidedGroupId` and `GUIDE_LIFE_AREAS`
are untouched, and `togetherPromptBuilder` resolves a Together session's `guideId` against the
Together catalog only. The Together catalog ships its **own invariant test**:
`adult === (group === 'together-desire')`. Each entry is a Together session carrying a `guideId`
(the 16 pattern: addendum + optional `[[SELFOS:STEP:n]]` steps — **the current step is derived from
the newest coach message's step marker**, never stored, keeping `session.enc` single-writer),
opening with the `frame()` not-therapy line. The 18+ group is **withheld in the bridge** unless
**both** partners' acks exist (never merely hidden in the UI).

### 3.10a Pulse (absorbs spec 11)

Per the mockup: a Pulse view on Together — the dyad-metric trend chart (existing `LineChart`;
Connection/Friction series from twin-insight metrics + check-ins, text-equivalent summary), a
**quick check-in** (1–3 taps: connected today? optional desire/satisfaction detail — the 11 §3.2
model, stored per logger), and **comparative views (desire alignment) only when both partners have
logged AND both consented to share that metric** — never inferred, hidden until then (11 §3.1).

**BUILT (Phase G, `feat/together-pulse`).** As-built decisions (autonomous, spec defaults):

- **Metric set** (§11 Q4, confirmed): `connection` · `desire` · `satisfaction` from the 1–3-tap
  check-in (Low/Steady/High → 0 / 0.5 / 1, clamped 0..1), plus `connectionValence`/`frictionLevel`
  from D's wrap-up twins (normalized ±1 → 0..1). Each series carries a `direction`
  (`rising`/`steady`/`dipping`/`flat`) for the text equivalent.
- **Card redesign ("Two clean charts", user-chosen from mockups).** The original single chart
  overlaid the self check-ins and the session-derived metrics on ONE up-is-good 0..1 axis — a name
  collision ("Connection" vs "Connection (sessions)") and an inverted Friction (high friction is
  _bad_ but read as good). The view now returns TWO groups — `checkInSeries` (self
  Connection/Desire/Satisfaction) and `sessionSeries` (the dyad metrics) — rendered as **separate,
  clearly-labelled cards** ("Your check-ins" / "From your sessions together"), so they never share one
  axis or collide. **Friction is reframed as `Calm = 1 - friction`** so every metric reads up-is-good.
  Each group draws a `LineChart` (with optional Low/High axis labels) only once there are **≥2
  points**; with a single reading it shows a **current-value read** (Low/Steady/High rows) instead of
  a lone floating dot. The desire alignment is a **you-vs-partner comparison** (two dots on a Low↔High
  desire track + legend + plain-language read), not a bare banner. Renderer + view-shape only — no new
  persisted schema, and the privacy/dual-consent boundaries below are unchanged.
- **Storage:** `people/<logger>/together/pulse/<pairKey>/<checkInId>.enc` — one writer per file (the
  logger's own perception; a partner's raw metrics are **never** shown). `PulseCheckIn` is a fresh
  type (11's `CheckIn` was never built — no migration).
- **The desire-alignment dual-consent gate:** surfaced only when **both** partners have a `desire`
  reading they **consented to share** (`shareMetrics` includes `'desire'`). The **most-recent**
  desire check-in's consent governs — logging a fresh check-in _without_ sharing desire **retracts**
  visibility (the intuitive privacy model, not a stale opt-in lingering). Reads `aligned` (|Δ| ≤
  0.25) or `some distance`; the two raw values cross the seam only for a consenting pair. Bridge:
  `together:pulse` / `together:pulseLog`, gated `together.own` + a re-checked **live partner edge**
  (§5.2) — a non-partner reads an empty view.
- **Placement:** the Pulse card renders on the Together home per eligible partner (not a separate
  `/together/pulse` route — no dead nav). The memory-strip Pulse tile (§3.6) is a Phase-H
  whole-flow-polish item (the strip aggregates D+G+H artifacts).

### 3.10b Yes/No/Maybe — together (mutual overlap)

A deterministic, host-side intersection of both partners' intimacy inventories (the 49/50
stable-keyed activity data): items where **both** partners are at/above "curious" form the mutual
list. **One-sided answers are never revealed.** This is a **deliberate, consented exception to the
"restricted reaches no one" invariant** (§8.6): the underlying inventory data is restricted intake
material, so revealing even the mutual subset requires an explicit **symmetric opt-in** (each
partner consents; both consent or neither sees anything — `NOT_READY`), is **revocable at any time**
(`together:ynmRevoke` — the overlap immediately returns `NOT_READY` and drops from all subsequent
grounding/prompts; live re-gate on every read), and is additionally gated on **both 18+ acks** and
the live partner edge, all host-side. The mutual list feeds the coach and the structured
YNM-together guided session. No AI is involved in computing the overlap.

### 3.11 Notifications & badges

Three additive notification kinds (35): **`together-invite`** ("Ben invited you to a Together
session" → navigate), **`together-turn`** ("Your turn with Ben — 'Feeling disconnected lately'" →
navigate; coalesced per session, `onChange` by the latest message **in the recipient's projection**
— an aside never changes the partner's signature), and **`together-private`** (Phase I2, §3.14 Part
B: "The coach has a private note for you" → navigate; coalesced per session, `onChange` by the
latest private-coach message in the recipient's projection). Bridge reads are one-shot,
capability-gated, **carry names/counts, never message content** (a `together-private` notification
never carries the coach's private text — only that one exists). The nav badge (Inbox pattern) is the
always-visible affordance; notifications surface at launch/focus/switch (35's cadence —
expectation-set, not push).

### 3.12 Home presence

A `together-session` RecommendationProvider (53): capability-gated (`together.own` — **added to
Home's reactive capability snapshot**, the 52 silent-death lesson), relevance = live partner edge +
(pending invite ∨ your-turn session ∨ >14 days since the last completed session — the §11 quiet
figure), signal-aware `dismissKey` (`together:<sessionId>:<updatedAt>`), crisis-suppressed like
every provider. The explicit-register variant of the copy never appears here — Home copy stays
relational.

**BUILT (Phase H1, `feat/together-integrations`).** The pure `computeTogetherHomeNudge(summaries,
viewerId, now)` (relocated into `@selfos/core/recommendations` so the renderer imports it without the
host-only `together` barrel) derives the one nudge, prioritized **invite → turn → quiet**: a pending
invitation the viewer was SENT (`status==='invited' && initiator !== viewer`), an active session where
it's their turn, else a `complete`/`ended` pair gone >14 days quiet (routes to `/together`, not a
session). Fed into `PersonRecommendationState.togetherNudge`; the `together-session` provider renders
relational copy per kind (score invite 88 / turn 84 / quiet 52) with dismissKey
`together:<kind>:<sessionId|partnerName>:<stamp>`. Home adds `together.own` to its capability snapshot

- loads the Together sessions in its per-person effect, and — because a pending invite is a real,
  actionable relationship cue — **a person with any Together session is no longer treated as "brand
  new"** (so the invite surfaces in "For you" even for an otherwise-empty invitee). `HeartHandshake` is
  the `together` domain icon. **Person-delete reap (§5.6):** `reapTogetherForPerson` (in
  `togetherService`, called from the bridge's `peopleDelete` after `deletePerson`) removes every
  `together/sessions/<id>/` the deleted person participated in + every `together/pairs/<pairKey>/`
  naming them; their own per-person Together data (pulse/YNM/pre-screen/prep) already went with
  `deletePerson`, and the live-edge re-gate keeps any partner-side orphan unreadable. Tests: 10
  provider/nudge units + a reap core test + a coreBridge reap-on-delete test + a Home RTL (invite
  surfaces) + 2 E2E (an invite surfaces on the invitee's Home; delete reaps the session, decrypt).

### 3.13 Empty/gating states (never silent)

Every prerequisite-absent state gets a calm, actionable explanation (41): no partner edge → no nav
(People is the path); partner not a subject → disabled picker + explainer (§3.1); **AI off/no key**
→ the role-aware `AiUnavailableNotice` on start/reply (31: no degraded mode); **initiator over
budget** → §6.2's neutral session-scoped notice; partner hasn't accepted → the session shows
"Invited · waiting"; pre-screen incomplete/flagged → the private "not right now" hold (§8.2).

### 3.14 Grounded coaching & private clarifications (Phase I)

The coach already receives each partner's own context (portrait/insights via `buildContext`), the
grounding pack (§3.9), and the alignment/agreement history — but the confidentiality contract (§6.3
step 3) tells it to use that context _only to silently steer_ and never surface it. In practice it
never checks its inferences, so it can act on stale or wrong assumptions and reads as if it ignores
what SelfOS knows. Phase I makes the couples coach **actively ground in that data and always verify
its assumptions**, and gives it a **private channel to clarify sensitive things with one partner** —
without ever weakening the never-reveal-one-partner's-data-to-the-other boundary (§8.4).

**Part A — Grounded, self-verifying coaching (prompt only; slice I1).** A new instruction block in
the couples prompt (§6.3, appended with the addendum, inside the confidentiality frame):

- **Draw actively** on what SelfOS knows (each partner's background, their relationship reflections,
  standing agreements, past wrap-ups) — inform every reply; don't coach as if it knows nothing.
- **Treat every inference as an assumption to verify, never a settled fact.** Before building on
  something it believes about a partner, confirm it — in the shared conversation with a **natural,
  source-blind question** ("when things get tense, do you tend to pull back?"), NEVER "your profile
  says…". (Owner decision 2026-07-13: verify by asking naturally, never citing the source.)
- **Sensitive** assumptions (intimacy, past hurt, anything that could embarrass a partner in front
  of the other) are **never tested in the open room** — the coach holds them, and either follows the
  person's lead if they raise it privately, or (slice I2) checks privately.
- Never present an unverified guess as established; **never reveal one partner's private background
  to the other — not even to confirm it** (§8.4, reaffirmed).

No new mechanism — prompt text on every couples turn.

**Part B — Coach-initiated private clarification (slice I2).** The coach may append, to any turn, a
marker to send a message visible to **one named partner only**:
`[[SELFOS:PRIVATE:{"to":"<partner display name>","text":"…"}]]`.

- **Host-side handling** (§6.4): parse + strip the marker; resolve `to` to a **participant** by
  display-name (case-insensitive); if it resolves to no participant — or to **more than one** (an
  ambiguous shared display name, the wrap-up-twin precedent) — **drop it** (no message — no leak).
  Create a coach message `role:'assistant'`, `privateAside:true`, `authorPersonId:<target
participant>`, `coachInitiated:true`, so the existing viewer-projection (§5.2) scopes it to that
  partner **only** — the other partner never sees it or knows it exists. It **mints no shared
  artifact** (like an aside), and is honored **only on an open turn** (an aside reply is already
  private).
- **Purpose, bounded by the disclosure rule** (owner decision 2026-07-13, "coach never discloses"):
  verify a sensitive assumption, ask for clarification/insight, or — for something that belongs in
  the shared work — **encourage that partner to raise it themselves** ("would you be willing to bring
  this up? I'll help"). The coach **never discloses** one partner's private info to the other, even
  after they confirm it. A private note to B may only concern **B's own context or the shared
  dynamic**, never anything private about A.
- **Surfacing:** a "**Private — from the coach, just for you**" bubble in the thread (target-only via
  projection), and a new **`together-private`** notification (§3.11) — "The coach has a private note
  for you" — to that partner (bell + toast + nav badge). The notification is driven by an additive
  `TogetherSessionSummary.lastPrivateCoachAt` signal (the ts of the newest coach-initiated note in the
  viewer's projection), keyed on **`coachInitiated`** so it fires ONLY for an unprompted note — never
  for an ordinary §3.6 aside coach reply (which is also `assistant` + `privateAside` + authored-for-
  viewer). Used **sparingly** (only when a genuinely sensitive ambiguity is blocking good support —
  not a routine side-channel).
- **No extra AI spend:** the private note rides the same reply (marker appended, initiator-billed as
  today). The only schema touch is two **additive-optional** fields (no `schemaVersion` bump):
  `TogetherMessage.coachInitiated` (the discriminator above) and `TogetherSessionSummary.lastPrivateCoachAt`
  (the notification signal); it otherwise reuses `TogetherMessage`'s existing `privateAside`/`authorPersonId`.

## 4. Data model (vault files & schemas)

All encrypted via the vault service (00 §4.3); **additive-optional** Zod schemas, no
`schemaVersion` bumps to existing types; every new file type versioned `schemaVersion: 1`.
**One-writer-per-file is the design rule for everything mutable — with exactly one deliberate
exception (`Agreement`, two editors, last-write-wins accepted, §7)**: two devices syncing one file
produce provider conflict copies (00 §4.3), so no other file is ever written by two people. The
fields that would have needed second writers are **derived instead of stored**: session status,
guided step, staleness, turn state, unread counts, expiry, the YNM overlap, pulse trends.

### 4.1 The pair + session roots

**Pair identity**: `pairKey = sorted([personIdA, personIdB]).join('~')` — stable across relationship
edge deletion/re-creation (edges gate _access_ read-time; the pairKey names _storage_).

```
together/
  pairs/<pairKey>/
    agreements/<agreementId>.enc      # Agreement (the one two-editor record — LWW, §7)
    checkins/<checkInId>.enc          # PulseCheckIn (writer: the logger only)
  sessions/<sessionId>/
    session.enc                       # TogetherSession (writer: initiator, once at create; immutable)
    state/<personId>.enc              # ParticipantState (writer: that person ONLY)
    messages/<millis>-<personId>-<uuid>.enc   # TogetherMessage (write-once by its author's device)
    attachments/<uuid>.enc            # encrypted images (45 media core; write-once; §5.2 read gate)
    report.enc                        # SharedReport (writer: whoever runs wrap-up; idempotent re-run)
people/<personId>/together/
    prescreen.enc                     # PreScreenResult (private; writer: that person)
people/<personId>/conversations/<id>.enc  # prep threads = ordinary Conversations + togetherSessionId
```

### 4.2 Schemas (Zod, source of truth; TS inferred)

```ts
// together/sessions/<id>/session.enc — created once by the initiator, then IMMUTABLE.
interface TogetherSession {
  id: string;
  schemaVersion: 1;
  pairKey: string;
  participantIds: string[]; // exactly 2 in v1; N-ready by design
  initiatorPersonId: string; // the payer (§6.2)
  topic?: string; // immutable in v1 (§2 non-goal)
  guideId?: string; // Together catalog entry (§3.10); current STEP is derived from messages
  createdAt: string;
  // status/staleness/step are DERIVED on read (§4.3, §3.8, §3.10) — no second writer, ever.
}

// together/sessions/<id>/state/<personId>.enc — each participant's own state. One writer.
interface ParticipantState {
  schemaVersion: 1;
  personId: string;
  rulesAckAt?: string; // accepting the rules of the room (the consent record)
  declinedAt?: string; // decline quietly — honored only in the DECLINER's projection (§4.3)
  pausedAt?: string; // pause-for-me — visible only in the pauser's own view (§8.3)
  leftAt?: string; // ends the session for both, neutrally (§4.3, §8.3)
  lastReadMessageAt?: string; // drives the unread/turn badges (projection-derived)
  updatedAt: string;
}

// AS BUILT (Phase F): the §3.10b symmetric YNM opt-in is stored PAIR-scoped, one file per person per pair, at
// `people/<personId>/together/ynm/<pairKey>.enc` (a `YnmOptIn` = { schemaVersion, personId, pairKey, optedInAt }),
// NOT on ParticipantState. Pair-scoped fits the consent model (it persists across sessions + the pair, stays
// one-writer-per-file, and re-gates by pairKey) and `together:ynmRevoke` DELETES the file. The mutual overlap
// is a deterministic (no-AI) intersection of both partners' intake `activities` ratings (≥ curious), computed
// only under the full conjunction (both 18+ acks + both opt-ins + a live edge), re-checked on every read.

// together/sessions/<id>/messages/<millis>-<personId>-<uuid>.enc — write-once.
interface TogetherMessage {
  id: string;
  schemaVersion: 1;
  authorPersonId: string; // the human author; a coach msg carries the turn-runner's id
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  privateAside?: boolean; // §3.6 — the whole aside EXCHANGE (incl. the coach reply) carries this
  replyToMessageId?: string; // coach msgs: the triggering message; never crosses a projection
  //                            that omits its target (§3.6)
  attachments?: AttachmentRef[]; // 45's ref shape; stored under the session's attachments/ (§4.1)
}

// together/sessions/<id>/report.enc — staleness DERIVED (§3.8), not stored.
interface SharedReport {
  id: string;
  schemaVersion: 1;
  sessionId: string;
  summary: string;
  themes: string[];
  workedThrough: string[];
  agreementIds: string[];
  challengeGroupId?: string;
  metrics?: Record<string, number>; // dyad metrics mirror (chart source of truth stays the twins)
  createdAt: string;
  updatedAt: string;
}

// together/pairs/<pairKey>/agreements/<id>.enc — the one two-editor record (LWW, §7).
interface Agreement {
  id: string;
  schemaVersion: 1;
  pairKey: string;
  text: string;
  timeframe?: string;
  status: 'standing' | 'done' | 'retired';
  provenance: { sessionId: string; at: string };
  createdAt: string;
  updatedAt: string;
}

// together/pairs/<pairKey>/checkins/<id>.enc — the 11 §4 CheckIn, pair-scoped.
interface PulseCheckIn {
  id: string;
  schemaVersion: 1;
  pairKey: string;
  loggerPersonId: string; // their OWN perception; one writer
  at: string;
  metrics: Record<string, number>; // e.g. { connection, desire, satisfaction } normalized 0..1
  shareMetrics?: string[]; // which metric keys this logger consents to comparative views for
  createdAt: string;
  updatedAt: string;
}

// people/<id>/together/prescreen.enc — PRIVATE to that person (§8.2). DATA-MINIMIZED:
// raw answers are evaluated AI-free at submit and NEVER persisted — only the outcome.
interface PreScreenResult {
  schemaVersion: 1;
  personId: string;
  flagged: boolean; // computed AI-free at submit; the only thing retained
  itemCatalogVersion: number; // which item set was evaluated (re-offer logic)
  completedAt: string;
}
```

**Amendments to existing schemas (all additive-optional, no version bumps):**

- `Conversation.togetherSessionId?: string` — marks a prep thread (§3.7); a **new** filter in the
  Sessions list read excludes these (no existing precedent — §3.7).
- `InsightSource` gains the literal **`'together'`** (the enum is closed — this is a deliberate,
  listed amendment) + the renderer's `Record<InsightSource, …>` maps extend accordingly (the
  historical ripple, checked by typecheck).
- `Insight.relationshipId` — **already exists (dormant)**; Together wrap-up sets it on the twins
  (best-effort edge linkage; the stable dimension is `provenance.pairKey`).
- `InsightProvenance.togetherSessionId?: string` + `InsightProvenance.pairKey?: string` — the
  `aboutPersonId` additive precedent.
- `Challenge.groupId?: string` — links twin joint challenges (§5.6; the `compatibilityGroupId`
  linkage pattern).
- New usage types registered in `USAGE_TYPE_LABELS`: `together.chat`, `together.analyze` (06).
- New notification kinds: `together-invite`, `together-turn` (35); `together-private` lands with
  Phase I2 (§3.14 Part B).
- New capability: `together.own` (Member default **ON**; `reconcileRole` delivers it to existing
  vaults read-time).
- A new **`excludeRestricted`** option threaded through `buildContext` → `summarizeForContext` →
  `selectPortraitFacts` (§6.3 — code-enforced restricted exclusion for Together prompts).

### 4.3 Derived, viewer-projected session status

Status is computed **per viewer V** on read from `session.enc` + all `state/*.enc` + `report.enc` +
the newest message timestamps — never stored, never global:

1. `V.declinedAt` set → the session is **omitted from V's list entirely**.
2. Any participant's `leftAt` set → **`ended`** for every viewer — a neutral, non-attributed
   terminal state ("This session has ended"; §8.3).
3. A **foreign** `declinedAt` is **ignored** (derived as if absent) → the quiet decline never
   surfaces to anyone else (§3.5).
4. Any participant missing `rulesAckAt` → **`invited`** (older than 30 days → **`expired`**). The
   initiator's own state file is written with `rulesAckAt` at create — starting is consenting.
5. The report is explicitly wrapped up (`report.wrappedUp`) and no shared human message is newer than
   `report.wrappedUpAt` → **`complete`** (a mid-session `reflect` never sets `wrappedUp`, so it never
   reaches `complete`; §3.8).
6. `V.pausedAt` set → **`onHold` in V's own view only** (the partner's view is unaffected — §8.3).
7. Else → **`active`**.

### 4.4 Migration

No migrations: every schema is new (`schemaVersion: 1`) or an additive-optional field on an
existing type (`.catch(undefined)` where corruption must fail closed — the 42 precedent). Spec 11's
`CheckIn` was never built, so `PulseCheckIn` is a fresh type, not a migration.

## 5. Architecture & modules

### 5.1 Core (`@selfos/core/together`)

New package dir, mirroring `conversations/`:

- `togetherService.ts` — session/message/state CRUD over the §4 layout (encryptedStore; path
  guards on every id segment, the `isMediaPath` pattern; a Together-scoped
  `isTogetherAttachmentPath` guard for the attachments dir); `deriveStatusFor(viewer)`,
  `projectionFor(viewer)` (the single function every list/read/signal derives from),
  `turnStateFor`, `listSessionsFor(personId)` (scans `together/sessions/*/session.enc`, filters
  `participantIds.includes`), invitation expiry.
- `togetherChatService.ts` — `runTogetherTurn` (the couples turn): the `05` §4.1 invariants
  verbatim — **budget gate (initiator) → persist the author's message FIRST (write-once file) →
  stream → meter-first (`together.chat`, `personId: initiator`) → EMPTY fail-safe → strip/parse
  markers → persist the coach message**; aside turns produce `privateAside` coach replies and
  suppress shared-artifact markers + step advancement (§3.6); `retryTogetherReply` (reply-only
  regeneration for a transcript whose newest message is human — multi-author-aware, ghost-stripping,
  §7).
- `togetherPromptBuilder.ts` — §6.3: PERSONA + SAFETY lead (non-negotiable), then the Together
  addendum, per-participant context blocks (via `buildContext(…, { excludeRestricted: true })` per
  participant + the couples confidentiality contract), the grounding pack, the guide addendum
  (resolved against the **Together** catalog only), the explicit register (both acks only),
  FORMATTING.
- `togetherAnalysisService.ts` — wrap-up (§3.8): **filters `privateAside` messages out of the
  analyze input host-side**, then one metered pass (`together.analyze`, `extendedThinking: false`,
  meter-before-parse, tolerant `jsonSalvage` parsing, crisisFlag preserved per twin, crisis content
  routed away from the report) → SharedReport + twin insights (`source:'together'`) + dyad metrics
  - agreement/challenge stamps; staleness derived, idempotent re-run.
- `agreementService.ts`, `pulseService.ts` (check-ins + trend derivation + the dual-consent
  comparative gate), `ynmOverlap.ts` (pure, deterministic; gated on symmetric current opt-ins +
  both acks + live edge; revocation-aware), `preScreen.ts` (the item catalog + AI-free
  `evaluatePreScreen` — the `wellbeingCrisis.ts` pattern; raw answers never persisted),
  `togetherCatalog.ts` (the couples guided entries + its own adult-invariant test),
  `agreementMarker.ts` (`[[SELFOS:AGREEMENT:{json}]]` + `[[SELFOS:SUGGEST:{json}]]` parse/strip —
  added to the single `stripCoachMarkers` path, with solo-chat regression tests §10).

### 5.2 Bridge (the trust boundary)

Every `together:*` handler in `coreBridge` authorizes by `together.own` + **participant
membership** (`session.participantIds.includes(activePersonId)`, or **pairKey containment** for
pair-level ops: agreements, check-ins, pulse, YNM) **+ the live partner edge, re-checked on every
read and write** (the live-graph rule — deleting the edge instantly re-gates everything; §7).
Additionally:

- **Per-viewer projection**: every read (`together:get`, `together:list`, and every derived
  signal/notification read) flows through `projectionFor(activePersonId)` — a `privateAside`
  message (coach replies included) appears **only** when `authorPersonId === activePersonId`;
  foreign `declinedAt`/`pausedAt` are masked per §4.3. The projection builds an explicit minimal
  shape (the spec-20 rule); **coreBridge integration tests read the projected payload directly**
  (two personas against the real bridge) and the E2E asserts the rendered absence (§10).
- **Attachment reads are message-gated**: `together:getAttachment` resolves the owning message; if
  that message is a `privateAside`, only its author may read the bytes. Store/read ops are guarded
  by `isTogetherAttachmentPath` + session-prefix (never the 45 solo guard, which is person-scoped
  by construction).
- **Start gate**: creating a session requires a live `partner` edge to every other participant
  (the `relationshipsSynthesize` refusal pattern) + each participant being a subject with an
  account.
- **The N-party 18+ conjunction**: every explicit-register surface — the `together-desire` catalog
  group, the register block in prompts, **and all three YNM channels** — is gated host-side on
  **every** participant's `adultAcknowledged` via core `allAdultAcknowledged(fs, key,
participantIds)` (the first multi-person ack check in the app; never the UI-only
  `sessions:startGuided` pattern).
- **Pre-screen gate — REMOVED** (owner decision 2026-07-11, §8.2): `together:create`/`accept`/turns
  no longer carry a pre-screen gate. The `PRESCREEN` failure state is gone. The invitation flow is
  ceremony → accept.
- **Budget privacy**: the initiator's `budgetRatio`/state never crosses the seam to the partner —
  the non-initiator receives only a boolean session-paused signal (§6.2), asserted in a bridge
  test.
- Pre-screen results, prep threads, and aside content **never cross the seam to anyone but their
  owner** in any channel, list, notification, or error message.

### 5.3 Renderer

- Routes: `/together` (home), `/together/session/:id`, `/together/catalog` (Phase E),
  `/together/pulse` (Phase G) — registered + gated like every feature (02); nav entry with badge.
- Stores (all joining the AppShell per-person reset): `togetherStore` (sessions list + open
  session + projection-aware messages; **subscribes to `onVaultChanged`** with a debounced
  re-fetch — the first data consumer of the watcher; nav/focus loads unchanged), `agreementStore`,
  `pulseStore`.
- Components (route-local, composing existing primitives — Composer, `<Markdown>`, Banner,
  CrisisFooter, SegmentedControl, LineChart, Avatar pattern): `TogetherHome`, `MemoryStrip`,
  `SessionCard`, `InvitationCeremony`, `PreScreenForm`, `TogetherThread` (author-attributed
  bubbles + artifact cards), `AsideComposer` (the private toggle restyling), `PrepPanel`,
  `SharedReportCard`, `TogetherCatalog`, `PulseView`, `YnmOptIn`.
- No new design-system primitives anticipated (→ no `/gallery` change unless one emerges; if one
  does, `/gallery` is updated per DoD).

### 5.4 Coach cadence & streaming

Streaming reuses the `chat:chunk`-style single-sink pattern via a dedicated `together:chunk` event
(the `dreams:chunk` precedent — a separate sink so solo-chat and couples streams can never
cross-wire). A turn streams only on the device that sent the message; the partner receives the
persisted result via sync + watcher (no cross-device streaming — honest async).

### 5.5 What is deliberately reused unchanged

Budgets/metering (06), `resolveAiKey` (25), `jsonSalvage`/failure taxonomy (37),
`AiUnavailableNotice` (41), `<Markdown>` (34), the 45 media core (encrypt/decrypt + `AttachmentRef`
shape — with Together's own path guard + channels, §5.2), the challenge marker/entity (52), compat
questionnaire seeding + `getAlignmentReport` (08), relationship synthesis caches (54), notification
framework (35), recommendation engine (53).

### 5.6 Integrations

- **Joint challenges**: the couples coach can mint challenges (the 52 marker; open-thread turns
  only, §3.6) for **both** partners — twin `Challenge` records linked by `groupId`, each partner
  keeping their own check-in cadence/Home card/reflection; "both checked in" is surfaced in the
  next session's grounding pack.
  **BUILT (Phase H2, `feat/together-challenges`).** Additive `Challenge.groupId?`. The couples turn
  parses a `[[SELFOS:CHALLENGE:{…}]]` marker on a **non-aside** reply (asides mint nothing, §3.6) →
  `captureJointChallengeFromMarker` mints a twin for each participant via the reused 52
  `captureFromMarker` (per-person `people/<id>/challenges/…` files, so per-person isolation holds),
  all sharing one `groupId`; a re-mint in the same session **updates** the twins (stable groupId), no
  competing group. Each twin flows into that partner's existing 52 Home challenge card + check-in +
  reflection→Insight, unchanged. `JOINT_CHALLENGE_INSTRUCTION` teaches the convention (appended after
  AGREEMENT, before context). Grounding: `jointChallengeGroundingLines` (over `listJointChallenges`,
  which groups the twins + derives `checkedInCount`/`allCheckedIn` from each twin's outcome) adds a
  line per open joint challenge to the pack. A Together-home **`TogetherJointChallenges`** tile
  (self-hiding) reads the pair's status via the new `together:jointChallenges` bridge read (gated
  `together.own` + a re-checked live edge). An **adult** joint challenge inherits the 52 restricted-
  reflection + 18+ gating on each partner's own surfaces; the couples coach only proposes one in the
  explicit register, which itself requires both 18+ acks (Phase F).

  **AMENDED 2026-07-20 (`feat/joint-challenge-actions`) — the tile is ACTIONABLE, not a status
  mirror.** The original split above ("each partner keeping their own check-in cadence/Home card")
  made the Together tile display-only, with copy that told the reader to _"Track your own check-in on
  Home."_ That punt was a dead end: Home's 52 `ChallengeCard` was itself reduced to a passive
  navigate by 60 §3.1.5, so the real actions lived a third hop away in the Sessions
  `ChallengeSection` — a §7 whole-flow coherence failure (Together → Home → Sessions, with the first
  instruction factually wrong). It also contradicts the durable CLAUDE.md §12 rule: **surface a
  control WHERE the work happens.** The tile now carries the check-in itself:
  - **One-tap, then expand.** Each open joint challenge shows a primary **"Check in"**; tapping
    expands the 52 §4 `ChallengeOutcome` row (**I did it / Partly / Not this time**) plus an optional
    one-line note, with **Not yet** (snooze) and **Let it go** (abandon) behind a kebab so the row
    stays dense (§12). Deterministic — an outcome-only check-in spends nothing; only the AI
    reflection path does.
  - **The state is NAMED, not counted.** "You've checked in · waiting on `<partner>`" /
    "`<partner>` checked in · your turn" / "Neither of you has checked in yet", replacing the
    neutral "N of M". Shared accountability is the point of a joint challenge, and a bare count
    doesn't say whose court the ball is in.
  - **NO new schema, IPC, or bridge widening.** `JointChallengeStatus` stays a pure aggregate; the
    viewer's OWN twin is matched **client-side** by `groupId` against the existing per-person
    `challengeStore` (picking the newest twin per group, mirroring `listJointChallenges`'s
    collapse), and acted on through the existing person-scoped `challenges:checkIn`/`snooze`/
    `setStatus`. The partner's state is **derived** as `checkedInCount − (mine ? 1 : 0)`.
    **This preserves the §8 boundary by construction:** the aggregate comes from the gated bridge
    read, the viewer's own record from their own store, and a partner's `reflection`/`outcome` text
    is never in reach of the renderer — only a count ever crosses.
  - **Closed joint challenges persist** in a collapsed **"Completed & closed"** `Collapsible` group on
    the tile (the Goals precedent), instead of silently dropping off — the shared record of what the
    pair actually did. **Open vs closed is keyed on `active` ALONE, never on `allCheckedIn`:** a pair
    who let a challenge go leaves every twin `abandoned` (`active: false, allCheckedIn: false`), so an
    `allCheckedIn` test would strand that row in the open list forever — un-actionable (no live twin ⇒
    no buttons) with no way to clear it. Each closed row reports its own ending ("You both did it" /
    "Let go"). For the same reason `jointChallengeGroundingLines` now filters on `active` alone, so an
    abandoned challenge stops being fed to the couples coach as a live commitment.
  - **Freshness:** acting refreshes BOTH the `challengeStore` (own twin) and the
    `together:jointChallenges` read (partner side), so the strip can't show a stale count after a
    check-in — the previous fetch-on-mount-only behaviour left it stale until remount.
  - **Adult joint challenges** are unchanged: the inline note still yields the 52 **restricted**
    reflection facts, and "Talk it through" stays hidden for an adult challenge (52 §3.5).

- **Questionnaire suggestions**: a coach suggestion artifact carries a compat-questionnaire seed;
  "Send to both" drives the existing `toSeed()`/builder or direct compat-send path (user-confirmed
  before anything sends); the resulting `AlignmentReport` joins the grounding pack.
  **BUILT (Phase H3, `feat/together-suggestions`).** A `[[SELFOS:SUGGEST:{kind,prompt,guideId?,
topic?}]]` marker on a **non-aside** couples reply → `captureSuggestionFromMarker` writes a
  **write-once** `TogetherSuggestion` artifact under the session (`together/sessions/<id>/
suggestions/…`; one writer — the coach turn — so the §4 one-writer rule holds; no dismiss/mutation
  path). Parse/strip live in `suggestMarker.ts`, wired into the shared `stripCoachMarkers` (so a solo
  coach that ever emits one strips clean too); tolerant-parse. **It NEVER auto-acts.** The renderer
  `TogetherSuggestions` card (in the session view, re-fetched on each new message, self-hiding) offers
  an explicit action: a **`guide`** suggestion → **"Start this exercise"** (creates a new Together
  session with that `guideId` — but ONLY a real, **non-adult** catalog entry is startable this way; an
  adult guide degrades to a plain prompt card, keeping the 18+/explicit gates, §3.10); a
  **`questionnaire`** suggestion → **"Open a check-in"** which navigates to the Questionnaires builder
  — the **existing, already-verified, user-confirmed compat-send flow** (a doorway, never a new
  auto-send path). The resulting `AlignmentReport` already joins the pack via `latestAlignmentSummary`
  (Phase D). `SUGGEST_INSTRUCTION` teaches the convention. Bridge `together:suggestions` (participant +
  live-edge gated). **NOTE for the maintainer:** the direct in-app "Send to both" compat-send from the
  suggestion card (vs. the builder doorway) + the §13 live-model adversarial pass over the explicit
  register are the two items to verify with a real API key — see the manual DoD note.
- **Prep ↔ solo coaching**: prep threads are ordinary conversations; their insights feed the
  author's own context (nothing new to build beyond the link + list filtering).

## 6. IPC / API contracts

### 6.1 Channels (all Zod-validated in the bridge; renderer never sees keys)

| Channel                                                                                   | Direction                        | Purpose / gates                                                                                                                      |
| ----------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `together:list`                                                                           | invoke                           | Sessions for the active person (projection-derived summaries + turn state). `together.own` + edge.                                   |
| `together:get`                                                                            | invoke                           | One session, **viewer-projected** messages + status (§5.2). Participant + edge.                                                      |
| `together:create`                                                                         | invoke                           | `{partnerPersonId, topic?, guideId?}` → invited session. Edge + subject + pre-screen gates.                                          |
| `together:accept` / `together:decline`                                                    | invoke                           | Writes the caller's ParticipantState (`rulesAckAt` / `declinedAt`). Participant + pre-screen (accept).                               |
| `together:sendMessage` (stream)                                                           | invoke + `together:chunk` events | The couples turn (§5.1). Participant + edge; pre-screen + budget gates; `privateAside?` flag.                                        |
| `together:retry`                                                                          | invoke                           | Reply-only regeneration. Participant + edge + pre-screen.                                                                            |
| `together:setPaused` / `together:leave` / `together:markRead`                             | invoke                           | Caller's own state file. Participant.                                                                                                |
| `together:wrapUp`                                                                         | invoke                           | §3.8 analysis (aside-excluded input). Participant + edge; initiator-billed.                                                          |
| `together:storeAttachment` / `together:getAttachment`                                     | invoke                           | Together's own attachment seam (§5.2): `isTogetherAttachmentPath` guard; reads message-gated (an aside's attachment is author-only). |
| `together:agreements` / `together:saveAgreement`                                          | invoke                           | Pair-scoped ledger. pairKey containment + edge.                                                                                      |
| `together:pulse` / `together:checkIn`                                                     | invoke                           | Trends (dual-consent comparative gate host-side) + the caller's own check-in. pairKey + edge.                                        |
| `together:prescreenGet` / `together:prescreenSubmit`                                      | invoke                           | The caller's own pre-screen only (outcome-only storage, §8.2).                                                                       |
| `together:catalog`                                                                        | invoke                           | Together guided entries; `together-desire` withheld unless **all** participants acked (§5.2).                                        |
| `together:ynmStatus` / `together:ynmOptIn` / `together:ynmRevoke` / `together:ynmOverlap` | invoke                           | Symmetric, revocable opt-in + the mutual list (both current opt-ins + both acks + edge, else `NOT_READY`).                           |
| `together:prepOpen`                                                                       | invoke                           | Creates/returns the caller's prep Conversation for a session. Participant.                                                           |

`channels.ts` stays **zod-free at the preload seam** (the standing preload rule) — types via the
schemas shim.

### 6.2 Billing & budgets

Every `together.chat` / `together.analyze` usage event carries `personId = initiatorPersonId`
(owner decision: initiator pays everything **in the shared session**). `checkBudget` runs against
the **initiator** before every turn regardless of who is writing — the partner's own budget never
gates a turn (unit-tested). An over-budget initiator pauses AI replies for both, with **asymmetric
honesty**: the initiator sees their own standard budget state (ratio, no `$` unless admin — 06);
the **non-initiator sees only a neutral, session-scoped notice** ("AI replies are paused for this
session until next week") — no ratio, no bar, no `$`, no naming of whose budget (bridge-asserted,
§5.2). Reading/prep-reading is unaffected. **Prep threads are ordinary solo conversations and bill
their author** (outside the initiator-pays rule — recorded for owner review in §11). Costs are
higher than solo chat (two contexts); the usage dashboard attributes session spend to the initiator
like any session.

### 6.3 The couples prompt (Claude)

Assembled by `togetherPromptBuilder` in this order (order is load-bearing):

1. **PERSONA + SAFETY** (05, verbatim — always lead).
2. **TOGETHER_ADDENDUM** — the facilitator persona: `frame()`-style not-therapy line; hold-space
   cadence rules; speaker-balance duties; Gottman/EFT-informed facilitation vocabulary; escalation
   handling (suggest a pause when flooded, §8.5); **the coercion-awareness clauses** (§8.5); **the
   secrets policy** (§8.4): never quote/attribute/reveal any private context or aside, the
   consistent non-confirming deflection line, the no-sabotage stance, "encourage the author to
   share it themselves when the moment is right"; **the aside-turn rule** (a reply to a private
   note stays in the private channel and mints no shared artifacts).
   - **`GROUNDED_COACHING_INSTRUCTION`** (§3.14 Part A / Phase I, appended with the addendum): draw
     actively on the context that follows; treat every inference as an **assumption to verify** —
     confirm it in the shared chat with a **natural, source-blind** question (never "your profile
     says…"), and **hold sensitive checks out of the open room** (Phase I2 adds the private channel);
     never present an unverified guess as fact, never reveal one partner's background to the other.
3. **Per-participant context blocks** — for each participant, the **couples confidentiality
   contract** ("The following is private background about Ben. Use it to shape your support. Never
   quote, reference, attribute, or reveal it — to anyone, including Ben himself in front of Angel…")
   followed by that person's **`buildContext(fs, key, personId, topic, { excludeRestricted: true })`**
   output. `excludeRestricted` is a **new, code-enforced option** threaded through
   `buildContext` → `summarizeForContext` → `selectPortraitFacts`: it drops every
   `restricted` fact — including the portrait's (which is otherwise exempt from relevance gating)
   and the subject's own intimacy-topic-gated facts (which otherwise DO feed their own context).
   Without it, a Desire & intimacy session would feed break-glass trauma/intimacy facts into a
   prompt whose output the partner reads. Verified by prompt-capture unit + E2E asserts (§10).
4. **The grounding pack** (§3.9) + the guide addendum/step instruction when `guideId` (resolved
   against the Together catalog; step derived from the transcript).
5. **EXPLICIT_INTIMACY_REGISTER** — only when `allAdultAcknowledged(participants)`: the full frank
   register (the 52 `CHALLENGE_INTIMACY_REGISTER` sibling) — explicit, specific sexual coaching
   language welcomed; **in-prompt boundary verbatim from the established pattern**: consenting
   adults only; taboo only as fantasy/roleplay; never minors, real non-consent, or illegal acts;
   any hard no is absolute. SAFETY is never loosened.
6. **FORMATTING** (34).

The transcript sent per turn: the bounded most-recent window (§7), each message prefixed with its
author's name; asides prefixed `[PRIVATE from Ben — only you can see this]`. Chat turns keep
adaptive thinking (05); the analyze pass sets `extendedThinking: false` + a generous `maxTokens`
(the standing truncation-trap rule). Model = the configured `ai.model`; failures follow 37's
taxonomy (EMPTY / TRUNCATED / MALFORMED / REFUSED + honest messages).

### 6.4 Coach markers (private, stripped from saved + streamed text)

Existing: `[[SELFOS:WRAPUP]]` (wrap-up hint), `[[SELFOS:STEP:n]]` (structured exercises; the
derived-step source), `[[SELFOS:CHALLENGE:{json}]]` (joint challenges — parse condition extended to
Together guides, minting twins per §5.6). New: `[[SELFOS:AGREEMENT:{json}]]` (`{text, timeframe?}`
→ an Agreement in the pair ledger + the in-thread artifact card) and `[[SELFOS:SUGGEST:{json}]]`
(`{kind: 'questionnaire' | 'guide', …}` → a suggestion artifact card; **never auto-sends** — every
suggestion requires an explicit user tap). Phase I2: `[[SELFOS:PRIVATE:{"to","text"}]]` — a
coach-initiated private clarification to ONE named partner (§3.14 Part B): `to` resolves to a
participant (else the marker is dropped — no leak); it mints a coach message scoped to that partner
via `privateAside` + `authorPersonId`, mints no shared artifact, and fires a `together-private`
notification. All markers strip partial-safe via the single
`stripCoachMarkers` path — which solo chat also calls, so the new markers ship with **solo-chat
regression tests** (a solo reply carrying AGREEMENT/SUGGEST strips clean and mints nothing; the
partial-marker streaming guard covers the new long-JSON shapes — §10). Shared-artifact markers are
ignored on aside turns (§3.6).

## 7. States & edge cases

| State                                                                      | Behavior                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No partner edge                                                            | No nav entry; Home provider silent; direct route → calm redirect to People.                                                                                                                                                                                                                                                                                                                    |
| Partner edge deleted mid-flight                                            | **Every handler re-checks the edge on read/write (§5.2)**: sessions/pulse/agreements for that pair become inaccessible to both; data remains in the vault; restoring the edge restores access. Copy: "Together with Angel isn't available right now." UI-level E2E: delete the edge via People → nav gone, direct route redirects; restore → back (§10).                                       |
| Partner is not a subject / no account                                      | Disabled picker + the §3.1 explainer (named E2E, §10 #4).                                                                                                                                                                                                                                                                                                                                      |
| Invitation pending / expired                                               | §3.3/§3.5; expiry derived (30d); "send again" mints a fresh session (new id; the old stays expired — bridge-asserted).                                                                                                                                                                                                                                                                         |
| Decline quietly                                                            | §3.5/§4.3 — viewer-projected: the initiator's bridge read returns `invited` (then `expired`), never `declined`.                                                                                                                                                                                                                                                                                |
| Pre-screen incomplete / flagged                                            | Create + accept + turns held with the calm private "not right now" state for the affected person only; partner sees `invited`/"waiting" — never the reason (§8.2). A flagged re-take holds turns identically.                                                                                                                                                                                  |
| AI off / no key / offline                                                  | `AiUnavailableNotice` (role-aware) on start/reply; reading the transcript still works (31: no fake mode).                                                                                                                                                                                                                                                                                      |
| Initiator over budget                                                      | Turns blocked for **both**; asymmetric honest states per §6.2 (the partner never sees whose budget or any ratio). Reading/prep unaffected.                                                                                                                                                                                                                                                     |
| Partner's own budget exhausted                                             | Does **not** gate the shared session (initiator pays); their solo prep IS gated by their own budget (§6.2). Unit-tested both ways.                                                                                                                                                                                                                                                             |
| EMPTY / thrown turn                                                        | 05 §4.1 verbatim: honest error + "Try again"; the user message is already persisted; retry is reply-only.                                                                                                                                                                                                                                                                                      |
| Multi-author retry                                                         | `retryTogetherReply` regenerates when the newest message (in the caller's projection) is human-authored — regardless of which human; never duplicates or overwrites a human message; blank-assistant ghosts stripped (the 05 legacy lesson). Unit: partner-authored newest message; aside-authored newest message (retries privately).                                                         |
| Concurrent turns (both partners send near-simultaneously from two devices) | Message files are write-once → no data loss. Each turn's coach reply cites `replyToMessageId`; UI orders by `ts`; the later reply's prompt already contains the earlier exchange after sync. A visibly odd interleave is acceptable and self-heals next turn (unit-tested ordering).                                                                                                           |
| Sync conflict copies                                                       | Impossible by construction for session/messages/state/report/check-ins (one writer per file). `Agreement` is the one two-editor record: `updatedAt` + last-write-wins accepted; the standard conflict-copy banner (00) surfaces provider copies.                                                                                                                                               |
| Stale turn / abandonment                                                   | "Your turn" badge persists; `together-turn` notification re-surfaces `onChange` (projection signature); after 14 quiet days the session card offers "wrap up or let it rest" (no auto-anything).                                                                                                                                                                                               |
| Partner never accepts but initiator keeps writing                          | Allowed; coach stays in hold-space mode (acknowledge, don't run ahead — §3.6); the card keeps the invited pill so the state is legible. E2E #1 covers a pre-accept initiator turn.                                                                                                                                                                                                             |
| Session left                                                               | Any `leftAt` → the neutral `ended` state for both (no who/why in copy — though in a dyad, leaving is attributable by elimination; the point is cheapness, not anonymity — §8.3); turns refused; wrap-up still available to either participant; a fresh session is the re-engage path.                                                                                                          |
| Pause                                                                      | Pauser's own view shows `onHold` + muted nudges; the **partner's view is unchanged** (the session simply goes quiet) — pause is non-attributed by construction (§4.3, §8.3).                                                                                                                                                                                                                   |
| Corrupt/missing files                                                      | Tolerant reads (`.catch` where fail-closed matters), unit truth-table: a corrupt **state** file ⇒ treated as **not consented** (fail-closed: no join, no projection widening, asides stay author-only); a corrupt **message** file is skipped with a thread notice; a corrupt **report** ⇒ session derives active + re-wrap offered; a corrupt **prescreen** ⇒ treated as missing (re-screen). |
| Person deleted (04)                                                        | `people:delete` reaps their Together participation: sessions with them become inaccessible (membership check fails); pair storage is orphan-reaped (the `reapOrphanShares`/GC precedent) in the same pass. Decrypt-level E2E in Phase H.                                                                                                                                                       |
| Large sessions                                                             | The prompt transcript window is bounded (most-recent-N + the report/grounding summary of older content — the 05 context precedent; unit-tested); the thread virtualizes/paginates past ~200 messages.                                                                                                                                                                                          |
| Vault watcher unavailable (degraded)                                       | Data still refreshes on nav/focus (the standing load points); watcher is an enhancement, never a dependency (unit: subscription absent ⇒ loads still fire).                                                                                                                                                                                                                                    |
| Owner reality                                                              | The Owner is full-access at the app layer (04) and can switch into any member PIN-free. Nothing in Together's copy discloses or implies this (the durable rule); no copy makes absolute-secrecy claims (§8.7); the design accepts it silently (consent records are person-scoped either way).                                                                                                  |

## 8. Safety (required — this is the most relationally sensitive feature in the app)

### 8.1 The not-therapy boundary

The surface never uses "therapy," "therapist," "counseling," or "treatment" as labels — and the
spec/prompt vocabulary stays on "coach"/"facilitator" (never "practitioner"-as-clinician). The
frame line appears on Together home, the invitation, the catalog, and leads every prompt addendum
("self-guided practice for the two of you, informed by Gottman/EFT/Masters & Johnson — not therapy,
and not a substitute for professional care"). The **CrisisFooter + not-medical line** are pinned on
every conversational surface (thread, prep, pre-screen, catalog), exactly as on Sessions.

### 8.2 The private pre-screen — REMOVED (2026-07-11, owner decision)

> **The private couples pre-screen has been removed at the owner's explicit request.** It was the
> AI-free, per-partner safety screen (safe-being-honest / fear-of-reactions / own-choice / prefer-solo)
> that ran once before a person's first session and held an at-risk/coerced person from starting while
> surfacing crisis resources. The owner was informed of what it did and its safety trade-off (it was the
> couples intimate-partner-violence / coercion safety net) and chose to remove it entirely. All of it is
> gone: the `PreScreenForm`, the `together:prescreenGet`/`Submit` seam, the gate on
> `together:create`/`accept`/turns, the `preScreen.ts` service, the `PreScreenResult` schema +
> `people/<id>/together/prescreen.enc` storage, and the `PRESCREEN` failure reason. The invitation flow
> now goes ceremony → accept with no screen.
>
> **What still stands (unchanged):** the always-present **crisis footer** ("Get help now" + the
> not-medical line) on every Together surface; the in-session **escalation/coercion handling** in the
> couples prompt (§8.5, the coach still slows a flooded exchange + routes to support); and the general
> app-wide crisis routing. The removal drops the _pre-session_ screen only, not the in-conversation
> safety behaviour.
>
> _The original design is preserved below (struck through in intent) for history._
>
> ~~Before a person's first session, they completed a short private check (4 gentle items); evaluation
> was pure + AI-free; only the outcome was persisted (never raw answers); a flag held Together for that
> person + surfaced resources, while the partner only ever saw "invited"/"waiting".~~

### 8.3 Exit, pause, and the soft decline

Every exit is **cheap and unexplained** — in a coercive dynamic that is a safety property, not a
convenience:

- **Pause for me** — sets the pauser's own `pausedAt`; their view shows `onHold` and their nudges
  mute. **The partner's view does not change** (the session simply goes quiet) — pause is
  non-attributed by construction (§4.3). Un-pausing is one tap.
- **Leave** — ends the session for both with a neutral "This session has ended" (no who/why in
  copy; leaving in a dyad is attributable by elimination — the affordance's value is that it needs
  no confrontation or justification, not anonymity). Turns refuse; wrap-up remains available; a
  fresh session is the re-engage path.
- **Decline quietly** (§3.5) — the initiator only ever sees `invited` → `expired`.

### 8.4 The secrets policy (asides + prep)

- **Disclosed at the room level, invisible at the instance level** (owner decision 2026-07-10):
  the rules of the room announce that private notes exist; individual asides leave **no trace** in
  the partner's projection — no placeholder, no count, no timing signal, no badge/notification
  movement, and **no visible coach reply** (the aside's coach reply is itself private — §3.6).
  Timing itself is sensitive: a visible marker would show a controlling partner the exact moment
  the other reached for help.
- **In-prompt stance** (§6.3): never quote/attribute/reveal/hint; use private material for pacing
  and safety, never to covertly steer the other partner; won't indefinitely hold a secret that
  sabotages the joint work — instead works with the author (aside/prep) toward sharing it or
  naming that it belongs in individual work.
- **Consistent non-confirming deflection**: asked whether the other partner shared something
  privately, the coach answers identically whether or not anything exists ("I keep each of your
  private reflections private — I'd tell you the same thing either way").
- **Prep threads** are per-person conversations (storage-scoped private); prep content reaches the
  couples prompt only as the author's own-context insight, never as text.
- **Wrap-up cannot leak asides**: the analyze input structurally excludes them (§3.8) — the shared
  report and both twins derive from mutually-visible content only.

### 8.5 Escalation, coercion, and crisis in a shared room

- **Flooding/escalation**: the addendum instructs the coach to slow down, validate both sides, and
  propose a structured pause (the Gottman flooding protocol) when exchanges escalate — never to
  adjudicate a winner.
- **Coercion awareness**: the addendum carries watch-for clauses (pressure to participate, to
  escalate explicitness, to "consent"; fear-tinged language) → the coach de-escalates privately
  (replying in the affected person's aside channel — a private reply the partner never sees, §3.6 —
  and suggesting individual support) and never names a suspicion in front of the other partner.
  Never framed as abuse-as-kink (the standing clause); consent language is absolute.
- **Crisis**: `crisisFlag` from the wrap-up twins stays **per-person** and feeds each person's own
  `aggregateCrisisSignal`/Home banner (40) — **the analyze contract routes crisis content to the
  affected partner's twin only; the shared report stays supportive and detail-free** (E2E-asserted,
  §10 #5). Mid-session, the coach follows SAFETY (leads with concern + resources) but directs
  crisis routing to the affected person's private channels (aside reply + their own Home); the
  shared thread stays supportive without exposing details. Crisis routing is independent of every
  setting and works AI-off (the footer + deterministic surfaces).
- A recurring crisis signal on the **active person** suppresses Together recommendations (53's
  standard suppression); the partner's crisis state is never readable through recommendation
  behavior.

### 8.6 The explicit register and its bounds

Available **only** when every participant's `adultAcknowledged` is true (bridge-enforced
conjunction — catalog group, prompt register, AND the YNM channels, §5.2). The in-prompt boundary
is the established one (48/52): consenting adults; taboo strictly as fantasy/roleplay; never
minors, real non-consent, or illegal acts; hard nos absolute; watch-for-distress → slow down →
validate → route to support. SAFETY is never loosened; the boundary lives in the prompt + model,
never a keyword filter. **Sexual-topic facts in twin insights are `restricted: true`** — they feed
only their subject's own intimacy-gated context, and (deliberate v1 trade-off) **not** future
Together prompts, so desire-topic continuity resets each session (§2, §3.9). **The YNM mutual
overlap is the one consented exception to the restricted invariant** — symmetric, revocable,
both-acked, mutual-items-only (§3.10b).

### 8.7 Honest limits (documented, not implied away)

The never-reveal contract is **prompt-level** — unlike every code-enforced boundary (bridge
projections, sharing gates, the restricted filter, the aside exclusions). The spec commits to:
(a) live-model adversarial testing of the contract in the DoD (§10 — the offline fakes cannot
exercise it); (b) copy that is **mechanical, never absolute** ("doesn't appear in the shared
conversation," "designed never to quote" — not "never revealed"/"only the coach will ever see");
(c) the never-disclose-owner-access rule holding everywhere. Residual risks, named for the record
(internal documentation only, never user copy, per the durable rule): a coach that knows more can
act like it; one household master key + app-layer-only access control mean bridge projections are
the privacy boundary, and the Owner's full-access reality (04) applies to Together data as to all
data. The disclosed room rules — not false promises — are the mitigation.

## 9. Accessibility

Standard 01 rules apply; specifics: author attribution is text + avatar (never color-only);
private-aside state is announced (`aria-pressed` on the toggle, the dashed border pairs with the
lock icon + text tag); turn pills carry text (never color-only); the thread is `aria-busy` while
streaming; artifact cards are labeled regions with real buttons; the invitation rules are a
semantic list readable by SR; pre-screen choices are real radio groups with visible focus; charts
carry `role="img"` + text-equivalent summaries (the 11/13 chart precedent); every dialog-free flow
keeps keyboard reachability; full functionality from ~360px (no horizontal scroll — §12 rules,
E2E-guarded).

## 10. Testing strategy

The largest E2E surface of any feature to date; under-testing one cell is how multi-path features
shipped broken before (the compat-send lesson). **Every E2E drives the real UI as BOTH
participants** (seed two subjects with completed intakes + a partner edge — `seedCompletedIntake`;
switch via the real Switcher) with decrypt-level asserts; **projection asserts additionally run as
coreBridge integration tests** (two personas against the real bridge, reading the projected
payloads — projections are runtime filters, so vault decryption alone cannot prove them).

**Fakes & capture hooks (enumerated — both fake-Claude hosts, imperfect by default per 37):**

- **`SELFOS_FAKE_PROMPT_DIR`** (new; the `SELFOS_FAKE_SAVE_DIR` precedent): the fake writes each
  received system prompt + transcript to a file the E2E reads — the mechanism behind every
  "captured prompt" assert (restricted-absence, register-absence, contract order, deflection
  phrase, alignment-report grounding).
- **Chat branch** keyed on a unique Together-addendum phrase (distinct from the solo
  yes-no-maybe-builder phrase); echoes both participants' names so content-correctness asserts
  bite.
- **Analyze branch** keyed on its JSON contract phrase; derives each twin's text from the
  participant names in the prompt (a canned reply would make the twin-correctness assert vacuous —
  the #129 lesson); **imperfect by default** (omits an optional field to exercise `jsonSalvage`).
- **Marker-emitting branches** behind env hooks (`SELFOS_FAKE_AGREEMENT`, `SELFOS_FAKE_SUGGEST`,
  the existing challenge-marker pattern) or message-text keys; a STEP-emitting branch for the
  structured exercises keyed to Together addenda (no collision with the solo builder branch).
- **`SELFOS_FAKE_TOGETHER_EMPTY`** for the EMPTY fail-safe path (the solo hook is one-shot +
  haiku-gated; Together needs its own).

**Unit/component (Vitest + RTL)** — per module: viewer-projected derive-status truth table (incl.
foreign-declinedAt masking, leftAt → ended, own-pausedAt-only); projection (aside + aside-coach-
reply included for author, absent for partner, present in prompt assembly; replyToMessageId never
dangling in a projection); turn-state/unread/notification-signature over projections (A's aside
changes nothing for B); prompt-order + `excludeRestricted` (capture-the-stream-options: a seeded
restricted fact absent even on an intimacy topic; register present only when both acked);
`evaluatePreScreen` matrix + outcome-only persistence + 180-day re-offer; aside-turn artifact/step
suppression; AGREEMENT/SUGGEST marker parse/strip (partial-safe, long-JSON streaming) + **solo-chat
regression** (a solo reply carrying the new markers strips clean and mints nothing); YNM overlap
(mutual-only, one-sided never present, `NOT_READY` until both current opt-ins, revocation re-gates,
acks + edge gates); pulse dual-consent gate; analyze: meter-before-parse + EMPTY-not-persisted +
`extendedThinking:false` capture + **aside-exclusion from the analyze input** + crisis-routing
(flag on the affected twin only); billing (`personId === initiator` on every event; the partner's
own budget never gates); `allAdultAcknowledged` conjunction; the Together catalog's own adult
invariant; `listConversations` prep filter (+ solo list regression); `retryTogetherReply`
(partner-authored newest, aside-authored newest, ghost strip); concurrent-interleave ordering;
corrupt-file truth table (state → not consented; message → skipped; report → active; prescreen →
missing); transcript-window bound; watcher subscription (debounced re-fetch; loads still fire
without it); notification candidate units for both kinds (coalesce per session, projection
signature, dismissed-stays-quiet, names-never-content); the Home provider unit (gate/relevance/
dismissKey re-surface/crisis suppression/capability in the snapshot); RTL for ceremony, thread
projection, aside composer, report card, catalog gating, pulse, disabled partner picker.

**E2E (Playwright-Electron, headless, per the standing rule) — the matrix:**

1. **Lifecycle**: A creates + invites (writes a pre-accept opening message → hold-space reply) →
   B's badge/notification → B accepts (ceremony asserts the derived copy + 18+ line present only
   when both acked) → both converse via real person switching → decrypt: message files
   author-attributed, one file per message.
2. **Privacy projection (the crown jewel)**: A sends an aside (with an image attachment) → B's
   rendered thread lacks the aside AND the coach's private reply; B's turn badge + notification
   state unchanged; B's attachment read refused at the bridge; the prompt file
   (`SELFOS_FAKE_PROMPT_DIR`) contains the aside; vault decrypt proves the aside is stored; A still
   sees the whole exchange. (Bridge-level: the coreBridge two-persona projection test.) Prep: B's
   prep thread absent from A everywhere AND from B's own solo Sessions list, while B's pre-existing
   solo sessions still list.
3. **Pre-screen**: flagged answers → the flagged person's calm hold + resources; the partner's view
   shows only invited/waiting; a clear re-take unlocks; decrypt: no raw answers persisted.
4. **Gates absent** (prerequisite-absent rule): no partner edge → no nav/route; edge deleted
   mid-flight via People → nav gone, direct route redirects, restore → back; partner-not-subject →
   disabled picker + explainer; partner un-acked → `together-desire` absent from the catalog
   payload + no register phrase in the prompt file + YNM channels refuse; AI off → calm notices;
   initiator over budget → both composers blocked, the partner's notice carries no ratio/$.
5. **Wrap-up**: complete + summarize → decrypt twin insights (each `subjectPersonId` correct +
   named correctly — the #129 content-correctness lesson; `source:'together'`; `provenance.pairKey`
   - `relationshipId`; sexual facts `restricted`; each partner's Memory shows only their own) +
     shared report visible to both + agreement in the ledger + dyad metrics present. **A seeded
     aside's distinctive fact appears nowhere in report.enc or either twin. A seeded crisis signal
     flags only the affected twin; the report carries no crisis detail.** Continuing after wrap-up
     derives the report stale; re-wrap overwrites idempotently.
6. **Failure paths**: EMPTY turn (`SELFOS_FAKE_TOGETHER_EMPTY`) → honest error + retry (no
   duplicate, no ghost); decline-quietly → the initiator's **bridge read** returns invited →
   expired (never declined) → send-again mints a fresh session id.
7. **Integrations**: agreement marker → ledger + card; challenge marker → twin challenges linked by
   groupId (decrypt); then each partner checks in from their own tile (decrypt-asserts the outcome
   landed on that partner's twin only) and the pair's finished challenge moves to the collapsed
   "Completed &amp; closed" group; questionnaire suggestion → seeded compat builder → alignment report in the
   next session's prompt file; YNM (one opts in → `NOT_READY`; both → mutual-only list,
   decrypt-asserts a one-sided item absent; revoke → `NOT_READY` again).
8. **Pulse**: check-ins both sides → trend renders with text equivalent; comparative view hidden
   until both consent.
9. **Freshness**: with A's session open, the test writes B's message file directly into the vault
   (an external write — chokidar fires, no echo suppression) → the thread shows it without
   navigation.
10. **Geometry**: 360px overflow guards (home, ceremony, thread incl. an expanded artifact card,
    catalog, pulse) + render-to-bottom on the ceremony + pre-screen forms.
11. **Person deleted** (Phase H): `people:delete` a participant → sessions inaccessible + pair
    storage reaped (decrypt).

**Live-model adversarial pass (manual, DoD-listed; first run in Phase C, re-run in Phase F with
explicit content)**: with a real key, attempt to extract a partner's private context / an aside
through direct questions, indirect elicitation, and roleplay — verify never-reveal + the
non-confirming deflection (the offline fakes structurally cannot test this; the standing
fakes-hide-model-bugs rule).

**Visual QA**: real-Electron screenshots of every surface at desktop + 360px, both themes, judged
against the approved mockups. Plus the §7-DoD whole-flow coherence walk each phase.

## 11. Open questions

Resolved by the owner (2026-07-10) during the design brainstorm: async-only v1 (couch deferred) ·
full-context personalization under never-reveal (restricted excluded — now code-enforced §6.3) ·
Inbox-style invitation + accept ceremony · 2-partner v1 on an N-ready model · invisible asides +
room-rules disclosure + solo prep · full relationship memory · "Together" naming · the full safety
layer · initiator pays · both-acks → full register · all four enhancements (YNM overlap, catalog,
pulse/spec-11 absorption, grounding pack) · coach cadence = reply-always-hold-space.

Defaults chosen during spec revision (flagged for the owner's review, not re-decided):

1. **Prep billing** — prep threads bill their author (solo spend), outside the initiator-pays rule
   (§6.2).
2. **Wrap-up aside handling** — v1 excludes asides from ALL wrap-up artifacts including the
   author's own twin (§3.8) — simplest structurally-safe rule; revisit if prep/aside continuity
   proves insufficient.
3. **Pause semantics** — non-attributed "pause for me" (partner's view unchanged) rather than a
   partner-visible onHold (§8.3).
4. **Desire-continuity trade-off** — restricted twin facts mean sexual-topic continuity resets per
   session in v1 (§3.9/§8.6); a both-acked Together-only intimacy grounding is the reserved future
   amendment.

Remaining (build-time; ask before the relevant phase):

1. **Pre-screen item wording + flag rule** — the four items + choices are drafted (mockup); final
   wording + the exact flag combinations need a review pass before Phase B ships.
2. **Agreement editing UX** — **RESOLVED (owner, 2026-07-11, Phase D):** **inline edit on the
   ledger** (each field — text/timeframe/status — editable in place, last-write-wins), AND a **gentle,
   dismissible follow-up** offered when an agreement is marked **done** (a soft "build on this?" prompt
   that can seed a next agreement or a Together session — never a nag; §8 restraint).
3. **Prompt transcript window size** — the most-recent-N bound + summary handoff (tune at build
   with real token counts).
4. **Pulse metric starter set** — proposed: `connection`, `desire`, `satisfaction` for check-ins +
   `connectionValence`/`frictionLevel` from analysis; confirm at Phase G.
5. **Quiet-session nudge timing** — 14 days is proposed (§7, §3.12); confirm.

## 12. Changelog

- 2026-07-10 — Created after a three-round design brainstorm + an approved 8-screen interactive
  mockup; all primary forks resolved by the owner (recorded in §11). Revised same day after a
  4-lens adversarial review (46 findings incorporated — the load-bearing ones: code-enforced
  `excludeRestricted`, viewer-projected status/signals, private aside-turns end-to-end,
  aside-excluded wrap-up, mechanical secrecy copy, derived guideStep/staleness, Together-scoped
  attachment seam, YNM ack-gating + revocation, outcome-only pre-screen storage, non-attributed
  pause, defined leave, the `SELFOS_FAKE_PROMPT_DIR` capture hook, catalog-before-register phase
  order, and a separate `togetherCatalog`).

## 13. Relationship to other specs / whole-app fit

- **Absorbs [`11`](11-relationship-tracking.md)** — Pulse (Phase G) delivers 11's dashboard +
  intimacy check-in against Together's pair storage; on shipping, spec 11 gains a
  "superseded by 58 §3.10a" amendment (its metrics vocabulary is adopted verbatim).
- **Extends [`05`](05-conversations.md)/[`09`](09-session-analysis.md)/[`16`](16-guided-sessions.md)**
  without modifying their solo behavior: the couples turn service is a sibling, not a change to
  `runChatTurn`; the touches to solo machinery are exactly three, each with regression tests —
  `Conversation.togetherSessionId` + the new Sessions-list filter (§3.7), the two new markers in
  the shared `stripCoachMarkers` (§6.4), and the `excludeRestricted` option (default off —
  solo behavior byte-identical) threaded through the context builders (§6.3).
- **Respects [`42`](42-relationship-scoped-sharing.md)/[`54`](54-memory-redesign.md)**: partner
  sharing gates keep governing what flows between the partners' own solo coaches; Together's
  full-context feed is scoped to Together prompts only and rides the new consent ceremony.
- **Consumes [`08`](08-questionnaires.md)** (compat seeding + alignment reports),
  [`52`](52-challenge-sessions.md) (joint challenges), [`50`](50-self-assessments.md)/[`49`](49-intimacy-activities-inventory.md)
  (the YNM inventories), [`35`](35-notification-system.md)/[`53`](53-home-encouragement.md)
  (surfacing), [`45`](45-session-attachments.md) (the media core — with Together's own path guard +
  channels).
- **Deliberately does NOT touch** the solo `guidedCatalog`/its invariant test (the couples catalog
  is separate, with its own invariant — §3.10). Home's capability snapshot gains `together.own`
  (§3.12).

## 14. Build order — phases (each independently shippable, gated, and E2E-tested)

> **Build status (2026-07-10):** **Phase A + Phase B BUILT + released (0.17.0)** on `feat/together-foundation`
> (one PR — A has no surface): the projection core + bridge seam + `together.own` (A); `excludeRestricted`, the
> pre-screen, the couples turn + streaming, and the renderer (nav/home/ceremony/pre-screen/thread + the two
> notifications) (B). **Phase C BUILT** on `feat/together-prep-attachments`: solo prep spaces (additive
> `Conversation.togetherSessionId` + the Sessions-list filter + `PrepPanel`, author-billed, find-or-create with a
> static opener), the Together attachment seam (`together:storeAttachment`/`getAttachment`, `isTogetherAttachmentPath`,
> the **fail-closed** aside-gated read + vision ContentBlocks), and the secrets-policy prompt additions (§8.7 —
> identical no-oracle deflection, no covert use, no indefinite-secret-holding). Owner-confirmed: conservative
> pre-screen flag rule + all four §11 defaults kept. **Phase D BUILT** on `feat/together-wrapup-memory`: wrap-up
> (`runTogetherWrapUp` — initiator-billed `together.analyze`, aside-excluded input host-side, crisis routed away
> from the shared report, meter-before-parse, idempotent re-run) → a `SharedReport` both partners see +
> **per-partner twins** (`source:'together'`, strict name→id match, **NO twin when the two partners share a
> display name** — the wrong-subject guard); the pair **agreements ledger** (the one two-editor LWW record + the
> `[[SELFOS:AGREEMENT]]` marker, captured on non-aside turns only + globally stripped) with **inline edit + a
> gentle done-follow-up** (owner: inline · gentle follow-up, §11 #2); grounding pack v2 (standing agreements +
> last wrap-up summary); the `TogetherReflection` renderer. **As-built refinement (§3.8):** a twin is **SPLIT** —
> the MAIN twin (reflection + non-sexual facts, no `restricted`) feeds the partner's context in every topic; a
> companion **INTIMACY twin** (sexual facts, `restricted` + `lifeArea:'Intimacy'`) is own-context-only +
> intimacy-topic-gated (the §50 relevance-gate is fail-closed on a missing `lifeArea`, so a single unlabelled
> restricted fact would otherwise withhold the whole reflection). **Phase E BUILT** on `feat/together-catalog`:
> the **Together guided catalog** (`togetherCatalog.ts` — `together-connect` + `together-repair` groups, 8
> entries; the 18+ `together-desire` group + its entries land in Phase F) — SEPARATE from the solo
> `guidedCatalog`; the `adult === (group === 'together-desire')` invariant is tested. A guided couples session is
> an ordinary Together session carrying `guideId`: `createSession` seeds the guide's **static opener** (no model
> call); `buildTogetherSystemPrompt` appends the guide addendum + (structured) the `[[SELFOS:STEP:n]]` step
> convention AFTER context/grounding; the couples turn **stamps the declared step** onto the coach message
> (`TogetherMessage.guideStep?`, additive) — never on an aside — and the **current step is DERIVED** from the
> newest coach message (`guideStepFor`), keeping session.enc single-writer. The 18+ group is **withheld
> host-side** (`togetherCatalog()` bridge + `togetherCreate` refuses an adult/unknown `guideId`). Renderer: the
> grouped, searchable `TogetherCatalog` on the Together home (binds a guide to the start form) + a structured
> **stepper** in the thread. **Phase F BUILT** on `feat/together-explicit-ynm`: the 18+ **`together-desire`
> catalog group** (4 adult entries — Sensate Focus, Yes/No/Maybe-together, Desire Mapping, Fantasy Exchange);
> **`allAdultAcknowledged(participants)`** (the N-party conjunction — true only when EVERY participant's
> guidance-prefs ack is set); **`EXPLICIT_INTIMACY_REGISTER`** appended to the couples prompt **only when both
> acked** (after the addendum, before FORMATTING; SAFETY never loosened; boundary verbatim from the 52 sibling);
> and **YNM (§3.10b)** — a symmetric, **revocable** opt-in + a deterministic (no-AI) **mutual overlap** of both
> partners' intake `activities` ratings (≥ curious), where **one-sided answers are never revealed**, gated on
> both acks + both opt-ins + a live edge (all re-checked on every read), feeding the grounding pack only for a
> desire session when ready (the §8.6 consented restricted-exception). The desire group + adult guides + the
> register are **withheld host-side** (`togetherCatalog` allowAdult, `togetherCreate` re-check). Bridge:
> `together:catalog`/`acknowledgeAdult`/`ynmStatus`/`ynmOptIn`/`ynmRevoke`/`ynmOverlap`. Renderer: the
> `TogetherIntimacy` card (18+ ack → waiting-for-partner → YNM opt-in/revoke → the mutual list + start).
> Code-reviewer verdict **SHIP** (safety boundaries airtight, no blockers; applied the spec-lockstep + two
> hardening nits). **Product sign-off pending (§3.13):** the status surfaces the PARTNER's ack/opt-in state to
> the viewer (never the inventory) to drive actionable copy ("Waiting for Angel to turn it on") — flagged for
> the user. **The live-model adversarial pass (§13 first run + the Phase F explicit re-run) is a manual DoD item
> that needs a real API key — flagged for the user; the offline suite is green.** **Phases G–H remain.**

Each phase lands via the standard slice workflow (branch → implement + tests → quality-gate →
code-reviewer → sync-docs → PR → squash-merge), meets the full §7-CLAUDE.md DoD (E2E written AND
run, visual QA, whole-flow coherence walk), and leaves the app coherent — **no dead controls: §3.2's
progressive-assembly rule governs what renders each phase.** Phases A+B ship together as the first
user-visible release (A alone has no surface). Schemas land with their consuming phase (no
scaffolding): A carries `TogetherSession`/`ParticipantState`/`TogetherMessage`/`PreScreenResult`;
`Agreement`/`SharedReport` land in D; `PulseCheckIn` in G.

| Phase                                                       | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Key tests (beyond the §10 unit/RTL blocks for the phase's modules)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Foundation (backend-only)**                           | Phase-A schemas + storage roots + path guards; `togetherService` (CRUD, `projectionFor`, viewer-derived status, turn state, listing, expiry); capability `together.own`; bridge seam for list/get/create/accept/decline/state ops with membership **+ live-edge re-check** + subject gates; notification kinds registered (inert). No UI, no AI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | coreBridge two-persona integration: full invite lifecycle incl. **quiet-decline projection (initiator's read = invited → expired, never declined)** + send-again-new-id + membership denial + edge-deleted re-gating + the corrupt-file truth table.                                                                                                                                                                                                                                           |
| **B — The session (first user-visible slice)**              | Nav/route/home (sessions list + start flow **only** — no strip, no catalog row) + invitation ceremony (derived, mechanical copy) + **pre-screen** (catalog, AI-free eval, outcome-only storage, private hold, the one §5.2 gate rule) + the couples turn (prompt §6.3 incl. **`excludeRestricted`** + contract + hold-space + grounding v1 [syntheses + alignment report] + coercion clauses) + **private asides end-to-end** (toggle + projection + private coach replies + suppressed artifacts + projection-derived signals) + author-attributed thread + `together:chunk` streaming + watcher refresh + turn badges + both notifications + billing (initiator; asymmetric budget states) + AI-off/budget/empty states + crisis footer. Text-only composer (attachments arrive in C).                                                                                                                                                                                                                                                      | E2E #1 (incl. pre-accept hold-space turn), #2 (aside core: rendered + bridge-projection + prompt-file + unchanged badges), #3 (pre-screen incl. no-raw-answers decrypt), #4 (no-edge, edge-deleted UI, disabled picker, AI-off, budget asymmetry), #6 (EMPTY via `SELFOS_FAKE_TOGETHER_EMPTY`; decline at bridge level), #9 (freshness/watcher external-write), #10 (geometry); prompt-file asserts (order, contract, **restricted-absence**, register-absence); notification candidate units. |
| **C — Prep spaces + attachments + the secrets policy**      | Solo prep spaces (`togetherSessionId` conversations, the **new** Sessions-list filter + solo regression, PrepPanel, author-billed); Together attachment seam (`together:storeAttachment`/`getAttachment`, `isTogetherAttachmentPath`, aside-gated reads); secrets-policy prompt additions (no-sabotage, non-confirming deflection).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | E2E #2 extended (prep invisibility both directions + solo-list regression; aside attachment refused at the bridge); deflection phrase in the prompt file. **Live-model adversarial pass, first run.**                                                                                                                                                                                                                                                                                          |
| **D — Wrap-up & relationship memory**                       | `Agreement` + `SharedReport` schemas; `togetherAnalysisService` (**aside-excluded input**, crisis routing, twins: `source:'together'` + `pairKey` + `relationshipId` + restricted sexual facts + dyad metrics, derived staleness, idempotent re-run); the AGREEMENT marker + pair ledger + ledger UI; memory strip (Agreements + Latest-alignment tiles, self-hiding); grounding pack v2 (agreements + report).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | E2E #5 (full decrypt matrix incl. **aside-absence from report + twins**, crisis-routing, twin content-correctness, stale-derivation) + agreement round-trip; **solo-chat marker regression suite** (the markers land here).                                                                                                                                                                                                                                                                    |
| **E — The Together guided catalog (Connect + Repair)**      | `togetherCatalog.ts` (+ its own adult-invariant test) + catalog UI + search + the home catalog row; structured entries via `[[SELFOS:STEP]]` with the **derived** step; guide-steered sessions end-to-end (addendum resolution against the Together catalog).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | E2E: a structured couples exercise advances steps via marker (stripped; derived step) driven by both partners; catalog 360px; home row appears only now.                                                                                                                                                                                                                                                                                                                                       |
| **F — The explicit register + Desire & intimacy + YNM**     | `allAdultAcknowledged` (core + bridge); EXPLICIT_INTIMACY_REGISTER; the `together-desire` group added to the existing catalog (withheld host-side); YNM (symmetric opt-in + **revoke** + pure overlap + the structured YNM-together exercise), all ack-gated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | E2E #4 ack matrix (none/one/both × catalog + prompt file + YNM channels) + #7 YNM (symmetric consent, one-sided-absent decrypt, revoke re-gates). **Live-model adversarial re-run incl. explicit content.**                                                                                                                                                                                                                                                                                    |
| **G — Pulse (absorbs spec 11)**                             | `PulseCheckIn` schema + `pulseService` (check-ins, trend derivation, dual-consent comparative gate), Pulse view (LineChart trends + check-in + desire alignment), dyad-metric wiring from D's twins, the Pulse strip tile; spec 11 superseded-by amendment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | E2E #8 (trends + dual-consent hiding) + text-equivalents + geometry.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **H — Integrations & whole-app polish** — **BUILT (H1–H3)** | Split into 3 merged PRs. **H1**: the Home `together-session` provider (+ capability snapshot + `computeTogetherHomeNudge` invite/turn/quiet-14d) + person-delete reap (`reapTogetherForPerson`). **H2**: joint challenges (CHALLENGE marker → twin `Challenge` records + `groupId` + grounding + the home tile). **H3**: the SUGGEST artifact (guide → "Start this exercise"; questionnaire → the Questionnaires-builder doorway) + `together:suggestions`. The whole-flow coherence walk = the 12-test Together E2E suite; visual QA at desktop light/dark + 360px. **Deferred to a maintainer with a real key:** the direct in-app compat-send from the suggestion card (vs. the builder doorway), and the §13 live-model adversarial pass.                                                                                                                                                                                                                                                                                                 | E2E: Home nudge + reap (decrypt) + joint-challenge (twin mint + tile, decrypt) + suggestion (card → Start); plus a coreBridge two-persona gating test for each new read.                                                                                                                                                                                                                                                                                                                       |
| **I — Grounded coaching & private clarifications**          | Two slices (§3.14). **I1 (prompt-only)**: `GROUNDED_COACHING_INSTRUCTION` in `togetherPromptBuilder` (draw on the context that follows; treat inferences as assumptions to verify with natural, source-blind questions; hold sensitive checks out of the open room; never present a guess as fact, never reveal one partner's background to the other). No schema/seam/UI change. **I2 (private channel)**: `[[SELFOS:PRIVATE:{to,text}]]` marker → a coach message scoped to one partner (`privateAside` + `authorPersonId` + `coachInitiated`, resolve-or-drop incl. ambiguous names, open-turn only, no shared artifact) + `together-private` notification (driven by an additive `lastPrivateCoachAt` summary signal, keyed on `coachInitiated` so an ordinary aside reply never trips it) + the "Private — from the coach, just for you" bubble + the prompt instruction to use it for sensitive verification. No extra AI spend; two additive-optional schema fields (`coachInitiated`, `lastPrivateCoachAt`), no `schemaVersion` bump. | I1: prompt-content unit tests (grounding + verify phrasing present; source-blind; never-reveal). I2: two-persona coreBridge (B sees the private coach note, A doesn't — decrypt-level; the `together-private` notification fires for B only; the marker mints no shared artifact) + E2E (marker → private bubble for the target, absent for the partner) + geometry.                                                                                                                           |

Sequencing rationale: safety (pre-screen) and the aside projection ship **with** the first
user-visible phase — the rules-of-the-room copy is true from day one (a consent ceremony must never
describe a capability that doesn't exist yet); wrap-up (D) lands after the projection exists so the
aside-exclusion rule is testable from its first version; the catalog (E) precedes the explicit
register (F) so the `together-desire` group lands into a reachable surface (no dead entries); the
explicit register (F) lands only after the adversarial pass exists (C); integrations last because
every one hangs off artifacts from D–G.
