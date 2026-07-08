# 09 — Session analysis (the coach's memory)

> **Status:** **Approved** (core + 2026-06 lifecycle amendment, §14) · _last updated 2026-06-14_
>
> When a coaching session ends, AI can **analyze and summarize** it into a durable **Insight** so the
> coach remembers across sessions instead of re-reading transcripts. Session analysis is the **second
> producer** into the shared Insight / metrics layer defined in
> [`08-questionnaires.md`](08-questionnaires.md) §1.1/§4.4 (questionnaires is the first). It also emits a
> **2D mood signal** (valence + energy) as metrics, which the relationship/wellbeing dashboard
> ([`11`](11-relationship-tracking.md)) charts. This is the "cross-conversation long-term memory" that
> [`05-conversations.md`](05-conversations.md) §2 deferred.
>
> **2026-06 amendment (§14, package B of the app refresh):** the binary open/ended model gains an explicit
> **lifecycle status** — _in&nbsp;progress / on&nbsp;hold / complete_ — that the user sets and the AI can
> **suggest** (never silently flip); marking a session **complete** is the natural moment "End & summarize"
> is offered (AI-assisted, user-confirmed). Each session also shows its **accumulated AI cost** ($ for
> admins only, a budget-relative indicator for everyone else). Read §14 together with §3–§6.

Builds on [`05-conversations.md`](05-conversations.md) (the Sessions surface + transcripts + crisis/
not-medical safety — **amended here** to add an explicit session "end" + analysis),
[`08-questionnaires.md`](08-questionnaires.md) (the shared `Insight`/`metrics` model, `insightStore`, the
`buildContext` extension, the shareable-vs-private split), [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md)
(metering + budgets), and [`04-people-roles.md`](04-people-roles.md) (active person, encryption,
shareable context).

---

## 1. Overview

Today a session ([`05`](05-conversations.md)) is an open-ended encrypted transcript with no memory beyond
the model's context window. This spec adds an explicit **"End & summarize"** action: AI reads the full
transcript **once** and produces a structured **`SessionInsight`** (`source: 'session'`) — summary, key
themes, goals/commitments, people mentioned, follow-ups, a **2D mood signal** (`moodValence` +
`moodEnergy`) written into the shared **metrics** map, and a **crisis flag** if warranted. The Insight
auto-enters the **subject's own** coaching context and is fully **viewable, editable, and deletable**
afterward. The stored Insight — not the raw transcript — is what later sessions, the questionnaire
**gap-finder** ([`08`](08-questionnaires.md)), and the wellbeing trend ([`11`](11-relationship-tracking.md))
reuse, which is cheaper and more private.

## 2. Goals / Non-goals

**Goals**

- An explicit **"End & summarize"** action that produces a `SessionInsight` into the shared Insight/metrics
  layer (`08`), budget-gated and metered (`06`).
- **Long-term memory**: the subject's recent Session Insights feed their own `buildContext`, giving the
  coach continuity across sessions.
- **Reopenable/versioned**: continuing an ended session marks its Insight **stale**; the next end
  **re-analyzes** (versioned), so memory never silently drifts from the transcript.
- A **2D mood signal** (`moodValence` + `moodEnergy`) emitted as metrics, powering a **wellbeing trend**
  (charted in `11`, alongside questionnaire metric trends).
- **Per-fact opt-in sharing**: derived facts default **private to the subject**; the user can promote a
  specific fact to **shareable** (same model as `04`/`08`) to enrich a related person's context.
- A **"session memory" master toggle** (privacy control) and an **auto-summarize-on-end** option.

**Non-goals (deferred)**

- **Auto-summarize on inactivity** — v1 trigger is the explicit "End & summarize" (+ the opt-in
  auto-on-end); no inactivity timer.
- **Approve-step for own Insights** — session Insights **auto-enter** the subject's own context (low
  friction); editing/deleting after the fact is the control. (Questionnaire Insights keep their approve-step
  in `08`.)
- **Auto-pushing facts into other people's profiles** — promotion is per-fact and **opt-in**; the "add to
  their profile?" enrichment affordance is a later enhancement.
- **Relationship "about us" session analysis** — follows once per-relationship chats exist (`05` §2).
- **The Insight/metrics schema, store, `buildContext` plumbing, and the trend dashboards** — owned by `08`
  (layer) and `11` (dashboards); this spec only **produces** into the layer.

## 3. UX & flows

Amends the Sessions surface (`05` §3):

### 3.1 End & summarize

- The thread gains an **"End & summarize"** action. It runs analysis (budget check first, §5), then shows a
  **wrap-up card**: summary, mood, and the facts **grouped into scannable sections** — Goals & commitments
  (your takeaways, a checklist, first), Themes (chips), Follow-ups for next time (collapsed by default), and
  People mentioned (chips) — rather than one flat bullet list. Long lists condense (themes past ~6 collapse
  behind a "+N more"; an unrecognized fact never drops — it falls to an "Also noted" group). If the analysis
  flagged a concern, **crisis resources lead** (§7). The resulting `SessionInsight` auto-enters the subject's
  own context. The card renders **inside the thread's scroll container**, so a long summary scrolls with the
  conversation and never overflows onto the pinned crisis footer below.
- A session **setting `sessions.autoSummarizeOnEnd`** (default **OFF**) runs this automatically whenever a
  session is ended, for users who want it hands-off (no surprise spend by default).

### 3.2 Reopen / continue / re-run

- Ending does **not** lock the session — the subject can reopen and keep talking. Continuing marks the prior
  Insight **stale**; **"End & summarize"** re-runs analysis and writes a **new version** (the Insight's
  `provenance.at` + `updatedAt` advance; the stale one is replaced).

### 3.3 Insight management & wellbeing trend

- Session Insights appear in the shared **"What the coach knows"** surface (`08` §3.7): view, **edit**,
  **delete**, with **provenance** (which conversation, when).
- **Per-fact sharing** — in the wrap-up/Insight detail, toggle an individual `InsightFact` to **shareable**;
  a fact about a related person can then feed **that** person's coaching (and later, an opt-in "add to their
  profile" prompt).
- **Wellbeing trend** — the `moodValence`/`moodEnergy` metrics across sessions render as a trend (a
  `/gallery` chart primitive), shown alongside questionnaire metric trends; the aggregated view lives in
  `11`.

### 3.4 Disabling memory

- A **master toggle `sessions.memoryEnabled`** (default **ON**) disables session summarization entirely: no
  analysis runs, no Session Insights are produced or fed to context. Existing Insights remain
  editable/deletable.

## 4. Data model

No new file types — session analysis **produces `Insight`** records (`08` §4.4) with `source: 'session'`,
stored at `people/<person-id>/insights/<insight-id>.enc` (and, when a fact is promoted to a relationship,
`relationships/<rel-id>/insights/…`). The mood signal is written into the shared **`Insight.metrics`** map
as `moodValence` (−1..1) and `moodEnergy` (−1..1). Session Insights set `approved: true` on creation
(auto-enter); `provenance.conversationId` set.

The **`Conversation`** schema (`05` §4.1) is amended:

```ts
interface Conversation {
  // …existing fields…
  status?: SessionStatus; // 'inProgress' (default) | 'onHold' | 'complete' — see §14.1
  endedAt?: string; // set when status → 'complete'; absent = not yet completed
  insightId?: string; // the current SessionInsight for this conversation
  insightStale?: boolean; // true after continuing past an end → re-run on next end
}
// SessionStatusSchema = z.enum(['inProgress', 'onHold', 'complete'])
```

`status` (§14.1) and `endedAt` move together: completing a session sets both; reopening a completed session
returns it to `inProgress` and marks the Insight stale. Absent `status` ⇒ `inProgress` (additive-optional).

All four new fields are **additive-optional** — an existing transcript with none of them reads as an
`inProgress`, never-summarized session (`conversationStatus(c)` normalizes absent ⇒ `inProgress`). As built,
this matches the project's additive-field precedent (dream `image`, person `email`/`phone`): **no
`schemaVersion` bump and no transform are needed**, since nothing about the persisted shape changes
destructively. (The original draft proposed a version bump + migration; reconciled here in lockstep with the
implementation.) All reads/writes go through the vault + crypto service (`04` §5).

## 5. Architecture & modules

- **sessionAnalysisService** (`@selfos/core/conversations`) — `endAndSummarize(conversationId)`: budget
  check → read transcript → `ClaudeClient` analysis (**adaptive thinking**, a **safety pass**) → build a
  `SessionInsight` (facts + `moodValence`/`moodEnergy` metrics) → `insightStore.save` (`08`) → record usage
  → set `endedAt`/`insightId` on the conversation. `reanalyze` for the stale path.
- **promptBuilder (extended)** — a session-analysis prompt (summary + themes + mood + goals + people +
  follow-ups + crisis assessment) returning **schema-validated** structured output; `cache_control` on the
  stable instruction prefix.
- **contextProviderRegistry (`08`)** — registers a **session-insight provider** so the questionnaire
  gap-finder can use session memory as context.
- **Metering (`06`)** — a new usage type **`session.analyze`** (label "Session summary"); `checkBudget →
analyze → recordUsage`, charged to the **subject**. Gated by `sessions.own` + `ai.enabled` +
  `sessions.memoryEnabled`.
- **`buildContext`** — already reads approved Insights (`08` §4.4); Session Insights flow in automatically
  for the subject's own context, prioritized/capped with questionnaire Insights.
- **Renderer** — the "End & summarize" action + wrap-up card in the Sessions screen; Insight management +
  the trend reuse `08`/`11` surfaces; the two new settings via the schema-driven registry (`03`).

## 6. IPC / API contracts

- `sessions:endAndSummarize({ conversationId })` → runs analysis (or a typed `BUDGET` / `NO_KEY` /
  `MEMORY_DISABLED` / `NOT_FOUND` / `ERROR` envelope) and returns the wrap-up Insight + usage. **As built,
  this one channel also serves the re-run (stale) path** — when the conversation already links an Insight, the
  same call reuses that id and carries each fact's `shareableWith` forward, so a separate `sessions:reanalyze`
  channel was unnecessary (folded in here to avoid a redundant seam).
- Insight read/edit/delete/promote-fact reuse `08`'s `insights:*` channels (the Memory surface — session
  Insights are ordinary `Insight`s, so per-fact shareable promotion + edit/delete come for free there).
- The Claude call + key stay in main (`00` §6.2); only the decrypted Insight crosses to the active person.

## 7. Safety

- **Not medical / crisis** (`05` §7) — unchanged and extended: session analysis **assesses for crisis
  signals** and, when flagged, the wrap-up **leads with resources** (warm, routing to professional help),
  never a clinical judgment or diagnosis. The always-visible "Get help now" footer remains.
- **Privacy** — session content is the most sensitive data; Session Insights are **private to the subject by
  default** and only feed that subject's own coach. Cross-person sharing happens **only** via explicit
  per-fact promotion (§3.3). The master **memory toggle** lets a user opt out entirely. Raw transcripts are
  read by analysis **in the subject's own process** (their own data) and never sent to the coach wholesale —
  the derived Insight is.
- **Honesty** — encryption protects against file-browsing/other members/cloud, not the device
  Owner (`04` §8); no new exposure beyond the existing model.

## 8. Accessibility

Per `01` §9: the "End & summarize" action, the wrap-up card (a polite live region for the produced summary),
Insight editing, and the wellbeing trend (text equivalents, not color-only) are keyboard-operable and
screen-reader friendly. Responsive ~360px→desktop.

## 9. Testing strategy

- **Unit (core, node):** `sessionAnalysisService` with the **fake `ClaudeClient`** — produces a valid
  `SessionInsight` incl. `moodValence`/`moodEnergy` metrics; budget block; `recordUsage` emits
  `session.analyze`; crisis flag path; stale → reanalyze writes a new version; `memoryEnabled=false`
  short-circuits; `Conversation` migration; `buildContext` includes the subject's approved Session Insights
  and excludes others' private facts; the registered session-insight context provider is gathered by the
  gap-finder.
- **Component (RTL):** the "End & summarize" action + wrap-up card; per-fact shareable toggle; the wellbeing
  trend; the two settings persist; not-configured/over-budget/memory-disabled states.
- **E2E (Playwright):** with `SELFOS_FAKE_CLAUDE`, hold a session → End & summarize → wrap-up appears → the
  Insight shows in a **later** session's grounding; continue past end → stale → re-run updates it; disable
  memory → no analysis. No-overflow + control-geometry + mobile-width guards on the new surfaces.

## 10. Open questions

1. **Insight token budget interplay** — how Session vs questionnaire Insights share the per-person context
   cap (`08` §4.4); confirm weighting (recency vs source) during slice work.
2. **Re-run cost control** — whether frequent reopen→end cycles need a debounce/confirm to avoid repeated
   analysis spend (default: explicit action each time; revisit if noisy).

## 11. Resolved decisions

Confirmed with the user (2026-06-10):

1. **Trigger** — explicit **"End & summarize"** (reopenable; continuing marks stale → re-run on next end,
   versioned); an optional **auto-summarize-on-end** setting (**default OFF**).
2. **Own-context entry** — Session Insights **auto-enter** the subject's own context, **editable/deletable**
   (no approve-step, unlike questionnaire Insights).
3. **Sharing** — facts are **private to the subject by default**; the user can **promote specific facts to
   shareable** to enrich related people's context.
4. **Memory toggle** — a **`sessions.memoryEnabled`** master switch (**default ON**) can disable
   summarization entirely.
5. **Mood signal** — **2D: valence + energy** (`moodValence`/`moodEnergy`), emitted as metrics into the
   shared layer; powers the wellbeing trend.
6. **Metering** — new **`session.analyze`** usage type, charged to the subject, budget-gated, adaptive
   thinking, caching on the stable prefix.
7. **Spec scoping** — the shared Insight/metrics layer is defined in **`08`**; this companion adds the
   feature and **amends `05`** (Conversation gains `endedAt`/`insightId`/`insightStale`); the trend
   dashboards live in **`11`**.
8. **Crisis** — session analysis assesses for crisis and the wrap-up **leads with resources** when flagged.

## 12. Proposed build slices (after approval)

1. **Analysis backend** — `sessionAnalysisService` + the analysis prompt + `session.analyze` metering + the
   `Conversation` migration + the session-insight context provider; produces Insights/metrics into the `08`
   layer. Unit-tested with the fake client.
2. **End & summarize UI + settings** — the action, wrap-up card, the two settings, memory-disabled/over-budget
   states.
3. **Sharing** — per-fact shareable promotion (reusing `08`'s Insight management). _(The wellbeing-trend
   chart ships with `11`'s dashboard.)_

(Depends on `08` slice 1 — the Insight/metrics layer — being in place first.)

## 13. Changelog

- 2026-06-10 — created (Draft) alongside `08`; decisions resolved with the user (§11). Revised same day: the
  mood signal became **2D (valence + energy)** expressed through `08`'s shared **metrics** map (resolving the
  prior mood-shape open question), and the trend dashboards were scoped to companion **`11`**. Awaiting
  review/approval before any code.
- 2026-06-11 — **Approved** alongside `08`/`11` (companion refs renumbered to `11`). Builds after `08`
  slice 1 lands the Insight/metrics layer.
- 2026-06-14 — **Approved + BUILT** (package B of the 2026-06 app refresh; `feat/session-analysis`). The
  whole spec — End & summarize → auto-approved `SessionInsight` (`source: 'session'`, mood metrics
  `moodValence`/`moodEnergy`) feeding `buildContext` — **plus** the §14 lifecycle amendment: `Conversation.status`
  (in-progress / on-hold / complete, additive-optional, **no schemaVersion bump** [reconciled §4]); a
  turn-embedded `wrapUpSuggested` hint (private marker the coach may append; stripped from saved + streamed
  text — no extra Claude call); per-session cost ($ admin-only, bridge-redacted, else a budget-relative bar);
  Sessions list status pills + All/In-progress/On-hold/Complete filter + per-item kebab; an inline wrap-up card
  - "View in Memory" link; the two settings (`sessions.memoryEnabled` default ON, `sessions.autoSummarizeOnEnd`
    default OFF). Three build-time UX forks were **asked**: wrap-up card = inline + Memory link; status setter =
    per-row kebab; the AI suggestion re-surfaces on a later hint. Session Insights flow through the existing
    shared insight provider, so the gap-finder + Memory surface pick them up with no new plumbing. Code-reviewed;
    gate green (typecheck node + web/DOM, lint, format, **308 core + 382 desktop + 8 relay** unit, **55 E2E** incl.
    the admin-$-vs-member-bar bridge redaction + complete→summarize→Insight-feeds-a-later-session decrypt +
    reopen-flips-stale + memory-off-blocks + 390px guards). `sessions:reanalyze` folded into `endAndSummarize`
    (§6). NEXT package: C (`16-guided-sessions`).
- 2026-06-12 — **2026-06 lifecycle amendment** added (§14, package B of the app refresh; Review): explicit
  `status` lifecycle (in&nbsp;progress / on&nbsp;hold / complete) the user sets and the AI can suggest;
  "complete" becomes the summarize trigger (AI-assisted, user-confirmed); per-session accumulated cost
  ($ admin-only, budget-relative indicator otherwise). Decisions in memory `app-refresh-plan-2026-06`.

---

## 14. 2026-06 amendment — session lifecycle, AI-assisted completion & per-session cost

Layers on top of §1–§13 (which remain accurate). Covers app-refresh items **3** (status + AI-set status +
summarize-on-complete feeding context) and **4** (per-session cost). Nothing here changes the Insight/metrics
model; it changes **when** analysis is offered and **what the Sessions surface shows**.

### 14.1 Lifecycle status

A session carries an explicit **`status`** — `SessionStatusSchema = z.enum(['inProgress','onHold','complete'])`,
default `inProgress`:

- **In progress** — the normal active state. New sessions start here.
- **On hold** — the user has paused this thread (something they intend to return to). Purely a user signal; no
  analysis is triggered. It keeps a half-finished session out of the "active" mental bucket without completing it.
- **Complete** — the user (or an accepted AI suggestion) considers the work wrapped. Completing sets `endedAt`
  and is the moment **"End & summarize"** is offered (§14.2). Reopening a completed session (continuing to type)
  returns it to `inProgress` and marks its Insight **stale** (the existing §3.2 reopen rule, now expressed
  through status).

**Who sets it.** The user sets status manually from the Sessions surface (§14.5). The **AI may _suggest_** a
status — specifically, that a session "looks complete" — but **never sets it silently** (the "AI-assisted, user
confirms" decision). The suggestion surfaces as a gentle, dismissible affordance (a chip/prompt: _"This feels
wrapped up — mark complete and summarize?"_) that the user accepts or ignores. `onHold` and reopen are
user-only; AI only ever suggests `complete`.

**How the AI completion signal is produced (no extra spend).** Rather than a separate Claude call, the
**existing chat turn** carries the signal: the assistant response includes a lightweight structured hint
(e.g. a `wrapUpSuggested: boolean` in the turn result) assessed as part of the turn the user already paid for.
The renderer shows the suggestion when the hint is set and the session isn't already complete. (Resolved: the
turn-embedded hint, no extra call — §14.7.)

### 14.2 Completion ⇄ summarize reconciliation

Completing a session is the trigger point for §3.1's **"End & summarize"**:

- With **`sessions.autoSummarizeOnEnd` ON** — completing auto-runs analysis (budget-gated) and shows the wrap-up.
- With it **OFF (default)** — completing **offers** summarize ("Summarize this session?"), the user confirms
  before any budget is spent. Declining still completes the session (status `complete`, no Insight) — a user can
  mark something done without summarizing it.

So "complete" is the lifecycle state; "summarize" is the optional, confirmed AI step attached to it. The
resulting `SessionInsight` feeds the subject's own context (and, per §3.3, can be shared) exactly as already
specified — this is the path that makes a completed session reusable across Dreams, the questionnaire gap-finder,
and the Home dashboard (memory `app-refresh-plan-2026-06`, packages C/G depend on it).

**A first-class "Wrap up & reflect" button below the composer (2026-07-08).** Completing + summarizing on demand
previously lived only in the per-session ⋯ menu (plus the proactive AI wrap-up suggestion), so a person had no
obvious way to say "I'm done — analyze this." A **"Wrap up & reflect"** button now sits centered just below the
composer. It runs the exact same action as the menu's "complete & summarize" (`setStatus('complete')` → summarize)
— it is a relocation, not a second action. It's shown only when it can actually analyze: hidden when AI or session
memory is off, when the session has no messages yet, once the session is already complete, and while the proactive
wrap-up suggestion is on screen (so there's never two wrap-up controls at once). Reopening a completed session by
typing again works unchanged.

### 14.3 Per-session cost (item 4)

Each session shows its **accumulated AI cost** — the sum of all `UsageEvent`s whose `sessionId` equals the
conversation id (chat turns + any `session.analyze`). Cost visibility follows the **existing admin-only-$ rule**
(`06`; memory `selfos-usage-budget-rules`): the **dollar figure is computed and returned only for users who can
`budgets.manage`** (admins), enforced in the **bridge** (the trust boundary), never the renderer. Everyone else
sees a **budget-relative indicator** instead — the session's token usage as a small bar (its share of the
person's period allowance), with **no dollar amount**. This keeps the "no $ for regular users" rule intact while
still giving every user a felt sense of a session's weight.

### 14.4 IPC additions

- **`sessions:setStatus({ conversationId, status })`** → persists `status` (and `endedAt` when → `complete`),
  scoped to the active person, gated by `sessions.own`. Reopening (a new chat turn on a `complete` session)
  flips it back to `inProgress` + `insightStale` in the chat-turn handler, not a separate call.
- **`usage:sessionCosts()`** (or a field added to the conversations list) → `Record<conversationId, { tokens:
number; costUsd?: number }>` for the active person; **`costUsd` present only for admins** (bridge-gated, like
  the existing `usage:summary` cost redaction). The Sessions list/header reads this to annotate each session.
- `sessions:endAndSummarize` (§6) unchanged; completing simply calls `setStatus('complete')` then (per §14.2)
  may invoke `endAndSummarize` (which also handles the stale re-run — see §6).

### 14.5 UX placement

- **Sessions list** — each item shows a small **status pill** (In progress / On hold / Complete) and the
  **per-session cost/usage indicator** (§14.3). A per-item menu lets the user set status. The list includes a
  **status filter / grouping** (All · In progress · On hold · Complete) so completed/paused sessions don't
  clutter the active view — built in this amendment (default view: All, newest-first).
- **Thread header** — the active session shows its status (settable here) and its running cost/usage indicator.
  When the AI completion hint is set, a dismissible **"mark complete & summarize?"** prompt appears near the
  composer (non-blocking; never auto-acts).
- The wrap-up card (§3.1) appears on confirmed summarize, unchanged.
- All new controls are token-driven, responsive ~360px→desktop, and admin-only $ carries the standard
  **AdminOnlyBadge** where a dollar figure is shown (UI conventions, memory `selfos-ui-conventions`).

### 14.6 Edge cases & testing additions (extend §7/§9)

- **Status migration** — existing transcripts (no `status`) read as `inProgress`; covered by the §4 migration.
- **Complete without summarize** — allowed; no Insight produced; re-completing later can still summarize.
- **Reopen a complete+summarized session** — status → `inProgress`, Insight marked stale; next complete offers
  re-summarize (the existing stale/reanalyze path).
- **Cost for a session with zero turns** — shows `$0.00` / empty indicator, never errors.
- **Non-admin never receives a $ value** — assert `usage:sessionCosts` omits `costUsd` for non-admins at the
  bridge (a unit/bridge test mirroring the existing `usage:summary` redaction test).
- **Tests:** unit — status transitions + reopen-flips-to-inProgress+stale; per-session cost rollup sums only
  matching `sessionId`; the admin-only-$ bridge redaction. Component — status pill + setter, the AI
  completion-suggestion chip shows only when hinted and not already complete, cost indicator renders admin $
  vs non-admin bar, the status filter narrows the list. E2E — hold a session → mark complete → confirm summarize
  → wrap-up → later session sees the Insight; filter to Complete shows it; an admin sees per-session $, a member
  sees the usage bar with no $; 390px + control-geometry guards.

### 14.7 Resolved decisions (2026-06-12)

- **Status model** — three states (`inProgress` / `onHold` / `complete`); default `inProgress`.
- **AI & status** — AI may **suggest `complete`** (assisted, user-confirmed); it never silently sets status, and
  never sets `onHold`/reopen.
- **Summarize trigger** — completing is the trigger; with `autoSummarizeOnEnd` off (default) it **asks** before
  spending budget; declining still completes without an Insight.
- **Per-session cost** — shown per session; **$ admin-only** (bridge-gated), budget-relative indicator for
  everyone else (keeps the established no-$-for-users rule).
- **AI completion signal** — a lightweight **`wrapUpSuggested`** hint embedded in the existing chat-turn result
  (no extra Claude call); the turn result schema gains the optional flag.
- **List filtering** — the Sessions list ships a **status filter / grouping** (All · In progress · On hold ·
  Complete) in this amendment.

### 14.8 Open questions (amendment)

_All resolved (2026-06-12) — see §14.7. The amendment is build-ready pending final approval._
