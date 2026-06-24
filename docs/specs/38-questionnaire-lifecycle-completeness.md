# 38 — Questionnaire lifecycle completeness

> **Status:** Built (all 8 slices) + E2E green (90/90) — _last updated 2026-06-24_
>
> **E2E (2026-06-24):** the §10 flows are driven through real UI and run headlessly (Playwright-Electron):
> (1) an invalid draft shows the **Draft** badge + disabled Send with reasons, and fixing it enables Send
> (slices 2/3); (2) a submitted **Private** send raises the **`responses-arrived`** notification naming the
> responder → "View results" **deep-links to Results** → **Export CSV writes a real file outside the vault**
> with the numeric value present and the **Private prose absent** (slices 1/6, the §3.7 boundary). Re-ask,
> expiry, favorite, and the reminder are covered by unit/component/bridge tests; the remaining §10 matrix rows
> (every delivery path) are good follow-up E2E.
>
> **§11 decisions resolved with the owner (2026-06-23) — all 8 slices in scope:**
>
> 1. **Scope** — all eight slices land (build order per §13).
> 2. **"Seen" semantics** — a response stops being "new" when the sender **opens that questionnaire's
>    Results**; device-local (spec 35's model), **no vault marker / no schema change**.
> 3. **Reminders** — **in v1**; an **in-app spec-35 notification nudges the SENDER** to re-share when a
>    send is unanswered **7+ days** (never auto-messages the recipient, no scheduler). _(Built without a
>    `lastReminderAt` field — the notification's device-local dismiss already prevents re-nagging, so no
>    schema change; see slice 5.)_
> 4. **Re-ask / reshare prior link** — **auto-revoke** the prior open send's link (best-effort if the
>    relay is unreachable); surfaced, never silent.
> 5. **Templates** — **lean on Duplicate** (keep 08 §12.1's "no templates"); slice 8 = a small
>    **Favorite** flag + Duplicate polish, no new storage model.
> 6. **Draft-vs-ready prominence** — a **Draft badge + disabled Send with the `problems[]` reasons**
>    (no separate banner).
> 7. **Export** — offer **CSV and JSON**, **one file per questionnaire** (all sends); Private sends
>    contribute **numeric values only** (consistent with the trends disclosure, §3.2), never prose.
> 8. **Started-vs-finished** — sender-facing labels Sent–waiting / Started / Answered / Declined /
>    Expired / Revoked; "Started" reveals only "in progress", never the draft answers.
> 9. **Branch-validation reach** — the stricter dead-end/circular/all-hidden check **gates new edits AND
>    new sends** of any definition (immutable sent snapshots are never re-validated).
> 10. **`contextOnly` copy** — plain language that never implies owner/admin visibility (§3.8).
> 11. **AI matrix/allocation generation** — out of v1 scope (stays hand-authored; non-goal §2).
>
> The questionnaire feature ([`08`](08-questionnaires.md)) is feature-complete on the happy path but
> still has real dead-ends and missing lifecycle pieces: a sender learns answers arrived only by
> manually opening Results; re-asking for trends means re-authoring or risks a duplicate-submit on a
> stale link; there's no way to reuse a recurring questionnaire short of Duplicate; draft-vs-ready is
> ambiguous; raw answers can't be exported; some validation gaps (branch dead-ends, email/phone
> format, response size) let the user reach a broken state. This spec closes those gaps so the full
> loop — **author → send → answer → results → insight** — is complete, discoverable, and never strands
> the user.

This is **spec 38 of a 5-spec group** that hardens the post-MVP product: [`37`](37-questionnaire-ai-robustness.md)
(AI robustness), **38 (this)**, [`39`](39-living-memory.md) (living memory), [`40`](40-proactive-coaching.md)
(proactive coaching), [`41`](41-first-run-and-discoverability.md) (first-run / discoverability). It builds
directly on [`08-questionnaires.md`](08-questionnaires.md) (the questionnaire model, relay, Insight layer)
and [`35-notification-system.md`](35-notification-system.md) (the unified notification framework). It
references [`00-architecture.md`](00-architecture.md) (vault, typed IPC, capabilities, feature-module
registry), [`01-design-system.md`](01-design-system.md) (primitives, tokens), [`03-settings.md`](03-settings.md)
(the settings registry), [`04-people-roles.md`](04-people-roles.md) (people, `email`/`phone`, capabilities,
the Owner full-access rule), and [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (metering /
budget gating). It does **not** restate any of those — read them for the shared model.

---

## 1. Overview

Spec 08 delivered authoring, AI generation, in-app + external (relay) delivery, analysis → Insight, and
compatibility mode. In daily use, several lifecycle seams remain rough or absent. This spec is the
"finish the lifecycle" pass: it closes dead-ends, makes the loop discoverable (notifications), reduces
re-authoring friction (reuse + re-ask), and tightens the validation/guards that currently let the user
reach a broken or surprising state.

### 1.1 Ground truth (verified against the code, 2026-06-23)

Several items in the original task framing were **already partly or fully built** — this spec must
_reconcile_, not re-build. Verified state:

- **`autoAnalyze` is wired** — `QuestionnaireResults.tsx` (`StandardResults`) has a working effect
  (an `autoAttempted` ref + a re-fire on `results`) that analyzes new responses one-at-a-time when the
  setting is on and AI is ready. The real gap is **not** that it does nothing; it's that it only runs
  **while the Results view is open** and there's **no signal** telling the sender to open it (§3.1, §3.2).
- **Resend / re-mint a link exists** — `assignmentsReshare` is implemented in both `StandardResults`
  and `CompatibilityResults`, and a stable "Share link" reconstruction (`readRelayLink`) exists in
  `relayService`. So the SendPanel error copy that promises "Resend link" is **not** a dead-end today.
  The remaining problem is **semantic**: every reshare **mints a fresh link + PIN but the OLD link is
  not revoked** until expiry (default 60 days), so an old emailed link can still be opened — and re-asks
  mint a _new_ assignment with a _new_ link while the prior send's link may still be answerable
  (duplicate-response risk) (§3.3, §3.6).
- **First-submission-wins, single-submission, revoke, 60-day expiry, image GC, recipient-binding** —
  all present (`drainRelaySend` skips an already-submitted/declined send; `revokeRelaySend`;
  `DEFAULT_RELAY_EXPIRY_DAYS`). This spec **does not** re-invent them; it surfaces and extends them
  (e.g. revoke-on-reshare, expiry visibility — §3.6).
- **Drafts persist but are invisible to the sender as a state** — `answerService.saveProgress` stores an
  unsubmitted `ResponseSet` and moves the assignment to `inProgress`; the Results status map shows
  "In progress" but offers no distinction between _started-then-paused_ and _finished-reviewing_, and
  the sender's own draft questionnaire (unsent definition) isn't clearly marked as not-yet-sendable (§3.4, §3.5).
- **Real validation gaps** — `validateQuestionnaire` checks that a `branch.whenQuestionId` _exists_ but
  **not** for dead-ends (a branch that can never show, all-questions-hidden, or a self/circular ref);
  `email`/`phone` are **free-text with no format check** in `RelayLinkDelivery`, so a typo builds a dead
  `mailto:`/`sms:`; there's **no response-size guard** before encryption, while the relay caps single
  submissions at ~256 KB (§3.7, §7).
- **AI generation never produces `matrix`/`allocation`** — `GeneratedQuestionSchema` omits them by
  design; the author must hand-add those types. Documented as a known limit (§2, §11).
- **`contextOnly` compatibility visibility is in code but under-documented** — it lives in
  `schemas.ts` / `alignmentService.ts` / `disclosure.ts` but 08 §3.6 only lists three modes. This spec
  documents it as a first-class fourth mode in-product and in 08 (§3.8).

### 1.2 The shape of the work

Ten gaps, grouped (and sliced in §13). Which land in v1 vs deferred is an **open question** (§11) — do
not assume.

## 2. Goals / Non-goals

**Goals**

- **Discoverable results** — a sender learns responses arrived without manually polling, via a spec-35
  **`responses-arrived` notification**, and `autoAnalyze` is clarified to run from both the
  notification-driven visit and the manual Analyze.
- **Re-ask without re-authoring** — re-send the same questionnaire for a longitudinal trend in one
  action, with the prior link handled safely (revoke or warn — §11), plus an **optional follow-up
  reminder** (minimum-viable; mechanism is §11).
- **Reuse** — a way to keep a recurring questionnaire (a template/favorite model **or** lean on
  Duplicate — §11) so it isn't rebuilt monthly.
- **Draft-vs-ready clarity** — a half-built questionnaire never looks sendable; a recipient's
  _started-but-paused_ vs _finished_ state is distinguishable to the sender.
- **No-strand link lifecycle** — revoke / unsend after a recipient opened (close the link); guarantee an
  old emailed link can't double-submit (first-submission-wins is already present; this spec makes
  re-ask + reshare _revoke the prior link_ per the §11 decision, and surfaces link expiry).
- **Export** — the sender can export a questionnaire's raw answers / results (CSV/JSON — format is §11).
- **Honest, real Resend** — reconcile the SendPanel/CompatibilitySendPanel link-mint-failure copy with
  the actual Resend action so the promised action exists and is reachable from Results (it does today;
  this spec audits the copy and the _path_ end-to-end, never assuming).
- **Tighter guards** — recipient-bound enforcement at the bridge; **email/phone format validation**;
  **branch dead-end / circular validation**; a **response-size guard before encryption** (relay ≤256 KB).
- **Document `contextOnly`** — surface and spec the compatibility "both answer, no report, own-context-only
  insight" mode.

**Non-goals (deferred / owned elsewhere)**

- **AI generation of `matrix`/`allocation`** — remains hand-authored (a known limit, §11); could become
  a later additive generation slice.
- **Full recurring/scheduled check-ins with a background scheduler** — 08 §2 keeps this deferred; this
  spec proposes only the **minimum-viable** re-ask + reminder (in-app, no background network beyond
  spec-36's tick), not a cron.
- **OS-level / push notifications** — spec 35 keeps notifications in-app only.
- **Respondent file uploads, multi-recipient 360°, broad i18n** — still 08 non-goals.
- **New relay channels / a new crypto model** — unchanged from 08; this spec only refines lifecycle on
  top of the existing relay.

## 3. UX & flows

All surfaces are responsive (~360px→desktop) and follow CLAUDE.md §12 (no horizontal scrollbars, admin-only
markers, etc.). The relay page changes are minimal and keep its independent WCAG bar (08 §9).

### 3.1 Responses-arrived notification (discoverability)

The single biggest discoverability gap: a sender today has no signal that a recipient answered. Per
[`35`](35-notification-system.md) §3.5/§3.6, this spec wires the **`responses-arrived`** kind end-to-end
for questionnaires:

1. **When it's raised** — when a check (NOT new background network) finds an active person's send that
   has a newly-received-and-not-yet-seen response. The check rides existing trigger points: app
   launch/focus (the spec-36 visibility tick), a manual drain ("Check for responses"), and opening the
   Questionnaires/Results views. There is **no new polling loop** (CLAUDE.md hard rule + spec 35 §3.6).
2. **Source read** — spec 35 already defines `notifications:responsesArrived` (gated
   `questionnaires.viewResults`, sender-scoped in the bridge, local-only). This spec defines the
   **signature** the source returns so the notification coalesces and re-surfaces correctly (§4.2): the
   count of submitted-but-unseen responses per send (so resolving some never re-pops; a _new_ response
   re-surfaces — the `onIncrease` rule, spec 35 §11).
3. **What it says** — a calm info notification (toast + center row): the questionnaire title + recipient
   ("Angel answered _Our week_"), never any answer content (spec 35 §8). Action: **navigate → Results**
   for that questionnaire.
4. **"Seen" semantics** — the notification's read/dismissed state is per-person device-local (spec 35
   §4). Confirm (§11) whether "seen" is _opened Results_ vs _dismissed the notification_ vs _analyzed_.

Empty/edge: no relay + no in-app responses → no notification (never a false signal). Offline → the check
fails silently; existing notifications still show (spec 35 §7).

### 3.2 autoAnalyze, clarified

`questionnaires.autoAnalyze` (08, default OFF) already auto-runs analysis for new responses while Results
is open. This spec:

- Documents the **two analyze paths** unambiguously: **manual** (the per-send "Analyze" button, always
  available when AI is ready and the send is submitted-and-not-analyzed) and **auto** (the setting,
  one-at-a-time, never retried after a failure in the same session — the `autoAttempted` ref).
- Ties auto-analyze to the **notification-driven visit**: when a `responses-arrived` notification's
  "View results" navigates to Results and `autoAnalyze` is on, the existing on-open effect handles it —
  no new trigger, no new spend path.
- **Never silently re-spends** — already-`analyzed` sends are skipped; over-budget surfaces the calm
  `06` warn→block state and is not retried.
- States the budget/AI-off behavior: AI off or no key → the calm "Turn on AI in Settings" banner, no
  Analyze button (no dead control).

### 3.3 Re-ask / reminders / minimum-viable scheduling

08 §2 keeps scheduling deferred; the schema is re-ask-ready (`ResponseSet.reAskOf`,
`Question.metricKey` → trends). This spec proposes the **minimum** that makes re-asking usable for trends:

1. **Re-ask in one action** — from a sent questionnaire (builder header or My Questionnaires row), a
   **"Ask again"** action re-sends the _same definition_ to the _same recipient(s)_ without re-authoring.
   It creates a new send (and links the new `ResponseSet` via `reAskOf` to the chain — wired so the
   §3.7-trends pick it up). A re-send cooldown already exists (`resendStatus`/`RESEND_COOLDOWN_DAYS`); this
   spec reuses it (the "Ready to re-send" badge already shows in the list + builder).
2. **Prior-link handling on re-ask** — a re-ask must not leave a stale answerable link for the same
   recipient. The decision (revoke the prior open send's link automatically vs warn the sender) is an
   **open question** (§11). Whichever, the behavior **surfaces** (never a silent fallback — CLAUDE.md).
3. **Optional follow-up reminder** — a gentle, **in-app-only** reminder that a sent send is still
   unanswered after N days, delivered as a spec-35 notification (NOT an email/SMS auto-send, NOT a
   background scheduler). The exact mechanism + default N is **open** (§11). For an external (relay)
   recipient there is no in-app inbox to nudge — the reminder, if any, prompts the _sender_ to re-share
   the link, it does not message the recipient.

### 3.4 Draft-vs-ready clarity (the sender's own definitions)

A questionnaire definition can be saved incomplete (validity is enforced at _send_, by design). Today a
half-built questionnaire offers a "Send" affordance that then fails validation. This spec makes the state
legible:

- A definition that fails `validateQuestionnaire` is shown as a **Draft** (a clear badge/state in My
  Questionnaires + the builder header) with a **disabled Send** and an inline summary of what's missing
  (the existing `validate` → `problems[]`). Send only enables when valid.
- The exact prominence (a badge, a banner, a disabled-with-tooltip Send) is an **open question** (§11) —
  do not assume.

### 3.5 Started-vs-finished (the recipient's response state, sender-facing)

The Results status map collapses several lifecycle states. This spec distinguishes, for the sender:

- **Sent — waiting** (no open/answer yet), **Started** (an `inProgress` draft exists — the recipient
  opened and saved progress but hasn't submitted), **Answered** (submitted), **Declined**, plus the
  terminal **Expired/Revoked**. "Started" is derived from `inProgress` + a draft `ResponseSet` present
  (a draft has no `submittedAt`); the sender sees only that a response is _in progress_, never the draft
  answers (the recipient may still edit; privacy boundary holds — Standard would reveal only on submit).
- This is a labeling/derivation change (the data already exists); no schema change for the distinction
  itself.

### 3.6 Link lifecycle: revoke / unsend / no-double-submit

- **Revoke an open link** — already present (`revokeRelaySend` + the Results "Revoke" affordance on an
  open relay-linked send). This spec keeps it and ensures it's reachable on **every** relay-linked send
  (one-person external, one-person household-with-link, compatibility household/external).
- **No double-submit** — first-submission-wins is enforced in `drainRelaySend` (it skips an already
  submitted/declined send) and the relay caps to single-submission-per-link (08 §11.3). This spec adds:
  on **re-ask** and on **reshare** (per the §11 decision) the **prior link is revoked** so an old
  emailed link cannot be reopened to submit a second time against the chain. The behavior is surfaced
  (e.g. "The previous link no longer works" — copy already exists in the reshare delivery note).
- **Expiry visibility** — a send carries `expiresAt` (default 60 days). The Results card surfaces the
  expiry ("Link expires in N days" / "Expired") so the sender knows when to re-share; today expiry is
  invisible until the recipient hits a dead link.

### 3.7 Export raw answers / results

A sender can **export** a questionnaire's results for their own use (analysis outside SelfOS, a record):

- From Results, an **Export** action produces a file (CSV and/or JSON — format(s) are §11) containing
  the questionnaire's prompts and, per submitted send, the recipient (or "Someone" if anonymous), the
  status, the submit time, and the **answers** — only for sends whose raw answers the sender is allowed
  to see (Standard sends, or any send the Owner / a `readRaw` holder may reveal). **Private** sends'
  prose answers are excluded exactly as in the Results view; their numeric values MAY be included only if
  the §3.2/§8.4 trends-disclosure already covers them (confirm in §11).
- The file is written **outside the encrypted vault** via the existing platform `saveImageFile`-style
  host save op (the [`13`](13-dream-images.md) export precedent — a save-dialog write, gated, with a
  "leaves the encrypted vault" note). The renderer never touches `fs`.
- Gated by `questionnaires.viewResults`; the per-send privacy boundary is re-enforced in the bridge
  (the export builder runs host-side over the same `SendResult` shape Results uses, so a Private send's
  prose can't be exported).

### 3.8 Document & finish `contextOnly` compatibility

`contextOnly` is a fourth compatibility visibility mode already in code (both answer; **no shared
report, no raw sharing either way**; each participant's answers distill into an auto-approved,
own-context-only Insight feeding only their own coach — sender-triggered from Results). This spec:

- Documents it as a first-class option in the builder's compatibility visibility picker with **plain
  copy** (no "break-glass" jargon — per the durable rule, never implying owner visibility) and a clear
  description ("You each answer; no one sees the other's answers; each of your coaches learns from your
  own answers").
- Surfaces it in Results (the sender's "Update both coaches" action — already in code) and reconciles the
  recipient disclosure (`disclosure.ts` already derives it) so the relay/Inbox copy matches.
- Adds the §13.5d note in 08 §3.6 so 08 lists all four modes (`sharedReport` / `senderSeesAll` /
  `eachSeesOwn` / `contextOnly`).

### 3.9 Recipient-bound enforcement & input validation

- **Recipient-bound** — a questionnaire is bound to one recipient at authoring (08 §17). This spec
  confirms the send path **re-validates** recipient kind/identity in the bridge (not the renderer), so a
  wrong-kind send is rejected at the trust boundary.
- **Email/phone format** — validate before building delivery links: `RelayLinkDelivery`'s email/phone
  inputs (and the Person record) get format validation; an invalid value disables the `mailto:`/`sms:`
  action with a quiet inline hint instead of building a dead link. Copy + Native-share + the link itself
  stay available.
- **Branch dead-end / circular validation** — `validateQuestionnaire` is extended to flag: a branch that
  references a _later_ question (can't be answered before it gates), a branch whose chain hides **all**
  questions (an empty answerable form), and a self/circular reference. These become `problems[]` entries
  surfaced in the builder and blocking send.
- **Response size guard** — before encrypting/uploading a relay submission, guard the serialized payload
  against the relay's ~256 KB cap with a clear recipient-facing message ("This response is too long to
  send — please shorten your answers") rather than an opaque relay rejection. The cap is a relay
  constant; the guard mirrors it client-side in the shared answering renderer.

## 4. Data model (vault files & schemas)

This spec is mostly **lifecycle + UI + validation** over the existing 08 model; it adds little persisted
data. All formats stay Zod-backed, versioned, written through the vault service (`00` §4). Types live in
`@selfos/core`.

### 4.1 Reused (no change)

- `Questionnaire` / `Question` / `BranchRule` / `Assignment` / `ResponseSet` / `Insight` / `RelayConfig`
  / `ConsentReceipt` — all from 08 §4. Re-ask uses `ResponseSet.reAskOf`; trends use `Question.metricKey`.
- The relay material (`Assignment.relay` with `pinWrapped` / `contentKeyWrapped`) — already supports the
  stable "Share link" reconstruction and outcome write-back; reused as-is.
- `SendResult` / `QuestionTrend` (the derived IPC view types) — Export and the started-vs-finished
  labeling read these; the privacy boundary (Private sends carry no prose `answers`) is unchanged.

### 4.2 Notification signature (spec 35 integration, no vault file)

Per [`35`](35-notification-system.md) §4, notifications are **derived** and only read/dismissed
_signatures_ persist (device-local, per-person, via `notifications:getState`/`:setState`). This spec
defines the `responses-arrived` signature for questionnaires:

```ts
// Returned by notifications:responsesArrived (spec 35 §6), per the active sender:
interface ResponsesArrivedItem {
  questionnaireId: string;
  title: string;
  // Newly-received responses across this questionnaire's sends not yet "seen" by the sender.
  // The COUNT is the coalesce signature: re-surface on increase (a new response), never on decrease.
  newResponseCount: number;
  // For the action target + body:
  latestRecipientName: string; // or "Someone" if anonymous
  at: string; // newest response time
}
```

No new vault file, no migration (the count is computed from existing `Assignment.status` +
`ResponseSet.submittedAt`; "seen" is the per-person device-local read/dismissed state).

### 4.3 Possible additive fields (confirm in §11 before adding)

Two items _might_ need a small additive field; flagged here so we don't silently add schema:

- **Reminder bookkeeping** — if a follow-up reminder needs "last reminded at" to avoid re-nagging, that
  is an additive-optional field on `Assignment` (e.g. `lastReminderAt?`). Whether reminders are in v1 at
  all is §11; if deferred, no field is added (no scaffolding — CLAUDE.md §12).
- **"Seen" beyond notification dismissal** — if "seen" must be authoritative across devices (not just
  device-local), it would need a vault-side marker. Spec 35's model is device-local; keeping it
  device-local means **no** schema change. Confirm in §11.

Any field added bumps the owning schema's `schemaVersion` with a read-time migration (08/04 precedent).

## 5. Architecture & modules

Extends the existing Questionnaires feature module (`00` §5.2) — no new module. The shell is untouched.

### 5.1 Core (`@selfos/core/questionnaires`)

- **`validateQuestionnaire` (extended)** — add branch dead-end / circular / all-hidden checks (§3.9). A
  pure function; new cases are pure logic over the `questions` array (reuse the `answering` helper's
  `visibleQuestions` reasoning where possible to detect "all hidden").
- **`responseSizeGuard`** — a pure helper that estimates the serialized response payload size and
  compares it to the relay cap constant (shared with the relay package so the number can't drift); used
  by the shared answering renderer before submit.
- **Re-ask** — a thin `reAskAssignment` (or reuse `createAssignment` / `createRelaySend` with a
  `reAskOf` link) that re-sends the same snapshot to the same recipient and, per §11, revokes the prior
  open send's link. No new questionnaire definition is created.
- **Export builder** — a pure `buildResultsExport(sends, format)` producing CSV/JSON text from the
  derived `SendResult[]` (so it inherits the privacy boundary; no raw decrypt of Private prose). The
  host writes the bytes out via the save op.
- **`contextOnly`** — already in `alignmentService` / `disclosure`; no core change beyond documentation
  - ensuring the disclosure copy and the "Update both coaches" trigger are consistent.

### 5.2 Desktop main (host)

- Wire the export save op (the `13` `saveImageFile`-style host file write, gated, outside the vault).
- The `notifications:responsesArrived` read already exists (spec 35); this spec only supplies the
  questionnaire signature shape (§4.2).
- Re-ask, revoke-prior-link, and email/phone validation are core/renderer; the host change is just the
  export write.

### 5.3 Renderer

- **`QuestionnaireResults` / `CompatibilityResults`** — add Export, surface expiry, the started-vs-finished
  labels, and ensure Revoke/Resend reach every relay-linked send. (autoAnalyze + Resend already present —
  audit, don't rebuild.)
- **`QuestionnaireBuilder` / `Questionnaires` (list)** — the Draft-vs-ready badge + disabled-Send-with-
  reasons; the "Ask again" action (reusing `resendStatus`).
- **`RelayLinkDelivery`** — email/phone format validation gating the `mailto:`/`sms:` actions.
- **Shared answering renderer (`@selfos/answering`)** — the response-size guard before submit (so both
  the in-app Inbox and the relay page enforce it).
- **Notification wiring** — the questionnaire `responses-arrived` source feeds the spec-35
  `notificationStore` via `useNotificationSources` (no new store; spec 35 owns the framework).
- **`/gallery`** — no new design-system primitive expected (reuses `Banner`, `Button`, `LineChart`,
  the spec-35 `Toast`). If a "draft/ready" status pill becomes a shared primitive, add it to `/gallery`
  (DoD).

### 5.4 Relay (`apps/relay`)

- The relay already caps submissions at ~256 KB and enforces single-submission. No relay behavior change
  is required; **if** the size cap constant is centralized into the shared package for the client-side
  guard (§5.1), that's the only relay-adjacent edit. Any change to relay routes/behavior bumps
  `RELAY_VERSION` (CLAUDE.md changelog 2026-06-17 standing rule). If no route changes, **no bump**.

## 6. IPC / API contracts

Typed channels (`src/shared`, Zod-validated both sides; the API key + Cloudflare token never cross to the
renderer; the bridge is the trust boundary). Most of this rides existing 08/35 channels.

- **Reused (08)** — `questionnaires:validate` (now returns the new branch/all-hidden problems),
  `assignments:results` / `:trends` / `:reshare` / `:revoke` / `:drain` / `:delete`, `insights:analyze`.
- **Reused (35)** — `notifications:responsesArrived` (sender-scoped, gated `questionnaires.viewResults`,
  local-only) — this spec supplies its questionnaire item shape (§4.2); `notifications:getState`/`:setState`
  (per-person read/dismissed).
- **New / changed**
  - `assignments:reAsk({ questionnaireId, recipient })` → re-send the same snapshot to the same recipient,
    linking the new `ResponseSet` via `reAskOf`, and (per §11) revoking the prior open send's link.
    Sender-scoped + gated `questionnaires.create`; recipient-kind re-validated in the bridge.
  - `assignments:exportResults({ questionnaireId, format })` → host-side builds the export over
    `SendResult[]` (privacy boundary re-enforced) and writes a file via the save op outside the vault.
    Gated `questionnaires.viewResults`, sender-scoped. Returns the written path (or a cancel).
  - (If reminders ship, §11) `assignments:remindersDue` or a derived source feeding spec 35 — local,
    no network; defined only once the reminder mechanism is decided.
- **Validation at the boundary** — email/phone format is a pure renderer-side guard (UX), but the send
  path's recipient binding is re-validated in the bridge; an invalid send is rejected with a typed error
  the renderer surfaces (never a silent success).
- **Claude API** — no new AI call in this spec. Re-ask does not re-generate (it re-sends the existing
  snapshot). autoAnalyze reuses the existing `questionnaire.analyze` metered path (`06`). matrix/allocation
  generation stays out of scope (§2).

## 7. States & edge cases

Per `00` §7 — every surface handles loading / empty / error / offline. Specifically:

- **No responses yet** — Results empty state (already present); no notification raised.
- **Response arrives while app closed** — surfaced on next launch/focus via the `responses-arrived`
  check (no background network); offline at launch → silent, retried on the next focus.
- **autoAnalyze + over budget** — the calm `06` warn→block state on the failing send; never retried in a
  loop (the `autoAttempted` ref); manual Analyze still offered when budget allows.
- **autoAnalyze + AI off / no key** — no auto-run; the "Turn on AI" banner; no dead Analyze control.
- **Re-ask with a prior open link** — the prior link is revoked (or the sender is warned) per §11; the
  outcome is shown. If the relay is unreachable, revoke is best-effort and the mailbox expires on its own
  (existing `revokeRelayForDeletion` pattern) — surfaced, not silently swallowed.
- **Re-ask with no relay (external recipient)** — the same no-relay hint as a first send ("connect a
  relay in Settings → Relay"); never silently invisible (CLAUDE.md hard rule).
- **Reminder for an external recipient** — no in-app inbox to nudge; the reminder (if any) prompts the
  _sender_ to re-share, never auto-messages the recipient.
- **Draft questionnaire** — Send disabled with the `problems[]` listed; a draft can still be saved,
  duplicated, and deleted (creator-while-unsent / Owner rules, 08 §3.9).
- **Started (paused) response** — the sender sees "Started", not the draft answers; the recipient can
  still edit/submit; if the link expires mid-draft, the recipient sees "no longer available" and the
  sender's send shows "Expired".
- **Branch dead-end on save vs send** — `validate` flags it live in the builder; send is blocked until
  fixed; an _already-sent_ snapshot is immutable and unaffected (it was valid when sent, or the new check
  only blocks new sends — confirm migration of the stricter check in §7-migration below).
- **Oversized response** — the size guard blocks submit with a recipient-facing "too long" message
  before any encrypt/upload; the relay's own cap remains the backstop.
- **Invalid email/phone** — the `mailto:`/`sms:` action is disabled with a quiet hint; Copy + Native
  share + the raw link stay usable, so delivery is never blocked outright.
- **Export of a Private send** — prose answers excluded (privacy boundary); the file notes the send was
  private (and shows numeric values only if §3.2/§8.4 already discloses them — §11).
- **Export write cancelled / fails** — a calm error; nothing partial claims success; no vault write.
- **Sync conflict** on any questionnaire/assignment/response file — vault conflict detection (`00`);
  never auto-deleted; surfaced as the existing sync-conflict notification (spec 35).
- **Schema migration** — if any additive field is added (§4.3), it migrates on read. The **stricter
  branch validation** must NOT retroactively invalidate already-sent immutable snapshots; it gates only
  new sends and live builder editing.
- **Concurrent drains across devices** — idempotent (existing `drainRelaySend` behavior); the
  responses-arrived count derives from current state, so two devices converge.
- **Crisis content in a free-text answer** — unchanged from 08 §8.2: analysis raises `crisisFlag` and
  the result leads with resources; an export of such an answer is the sender's own data (no new surface).

## 8. Safety, privacy & honesty

Inherits 08 §8 in full and adds nothing that loosens it.

- **Not medical** — unchanged; the wellness/self-help boundary stays visible on every surface and the
  relay page (08 §8.1). Notifications carry no clinical framing.
- **Crisis routing** — unchanged: the relay page + Inbox always show curated crisis resources + the
  not-medical line (static; no Claude on the relay, 08 §8.2). A `responses-arrived` notification is
  neutral info and never restates answer content (spec 35 §8); crisis stays its own always-present,
  non-dismissible surface (spec 35 §8, CLAUDE.md §1).
- **Sensitive content & age** — unchanged (08 §8.3). Export of explicit-tier answers stays the sender's
  own data; the size guard and validation don't bypass the age/consent gates.
- **Privacy boundary on Export** — the export builder runs over the derived `SendResult[]`, so a Private
  send's prose answers physically cannot be exported (the boundary is the bridge/derivation, not the UI),
  mirroring the Results view (08 §8.4). Whether Private numeric values are exportable follows the existing
  trends disclosure (§3.2) — confirm in §11.
- **Never disclose owner/admin access** — the durable rule (CLAUDE.md §1, 08 §8.4): no notification,
  reminder, disclosure, draft/ready, or `contextOnly` copy implies an owner/admin can read someone's
  answers. The `contextOnly` description says "no one sees the other's answers" — and that must stay
  true to the _recipient_ exactly as the existing modes do (it states what the **sender** sees).
- **No double-submit / coercion** — first-submission-wins + revoke-on-reask/reshare prevent a stale link
  from being reused; the recipient's frictionless Decline + withdraw-before-drain are unchanged (08 §8.5).
- **Relay zero-knowledge** — unchanged (08 §8.6); no new data crosses to the Worker; the response-size
  guard runs client-side before encryption.

## 9. Accessibility

Per `01` §9 and 08 §9. Specifically for the new/changed surfaces:

- **Notifications** — accessible per spec 35 §9 (labeled bell with unread count in the name; `aria-live`
  toasts; keyboard-navigable center; not color-only). This spec adds no new notification chrome.
- **Draft/ready + status labels** — conveyed as **text**, not color alone (a "Draft" badge reads as
  text; "Started"/"Answered"/"Expired" are words). The disabled Send has an accessible reason
  (`aria-describedby` → the `problems[]` summary), not just a visual disabled state.
- **Export** — a labeled action; the save dialog is the OS-native dialog; the "leaves the encrypted
  vault" note is read by screen readers.
- **Email/phone validation** — the disabled `mailto:`/`sms:` action carries an inline, programmatically
  associated error/hint; the field uses `type="email"`/`type="tel"` + `aria-invalid` on a bad value.
- **Response-size guard** — the "too long" message is a polite live-region error tied to the submit
  control; submit is not silently inert.
- **Re-ask / Revoke / expiry** — keyboard-operable, labeled (e.g. "Ask Angel again", "Revoke the link
  sent to Angel", "Link expires in 3 days"); reduced-motion respected for any toast/transition.
- Responsive ~360px→desktop on every changed surface, no horizontal scrollbars (CLAUDE.md §12).

## 10. Testing strategy

What proves it works (vault + Claude faked; `SELFOS_FAKE_CLAUDE` / `SELFOS_FAKE_RELAY`). Per the CLAUDE.md
hard rules this feature has repeatedly tripped: **drive the COMPLETE flow through real UI** (a bridge test
≠ the button exists), **verify EVERY delivery path** (one-person AND compatibility; household AND external;
relay-connected AND not), **surface failures** (never a silent fallback), and **test with the prerequisite
ABSENT** (no relay → a hint).

- **Unit (core, node):**
  - `validateQuestionnaire` — new cases: branch references a later question; branch chain hides all
    questions; self/circular branch; valid branch still passes; an already-valid def is unaffected.
  - `responseSizeGuard` — under cap passes; at/over cap fails with the right message; shares the relay
    constant (a drift test asserting the client cap === the relay cap).
  - `buildResultsExport` — CSV + JSON shapes; a Private send's prose is excluded; anonymous → "Someone";
    declined/expired rows render; numeric-only inclusion follows the §11 decision.
  - re-ask — re-sends the same snapshot, links `reAskOf`, revokes the prior open link (per §11);
    no new definition created; the trends chain picks up the new point.
- **Component (RTL):**
  - Results — Export action renders + calls the host op; expiry surfaced ("expires in N days" / "Expired");
    started-vs-finished labels; Revoke/Resend present on every relay-linked send shape; autoAnalyze
    on-open behavior + the AI-off banner (no dead control).
  - Builder/list — Draft badge + disabled Send with the `problems[]` reasons; "Ask again" reachable +
    cooldown-gated; valid questionnaire enables Send.
  - `RelayLinkDelivery` — invalid email disables `mailto:` with a hint; invalid phone disables `sms:`;
    Copy/native-share stay enabled; a valid value re-enables.
  - Notification — a `responses-arrived` item renders a toast + center row, "View results" navigates to
    the right Results; coalesces on count; never shows answer content.
- **E2E (Playwright) — the complete flow through real UI, all paths:**
  1. **One-person household, relay connected** — send → recipient answers in Inbox → a `responses-arrived`
     notification appears → click "View results" → autoAnalyze (or manual Analyze) drafts an Insight →
     Export writes a real file outside the vault (assert the file + its contents; Private send's prose
     absent) → Re-ask → the prior link is revoked (assert it's no longer answerable) → a trend appears
     after the second answer.
  2. **One-person household, NO relay** — the no-relay hint shows on send AND on reshare (never silent);
     in-app answering + responses-arrived still work.
  3. **One-person external (relay)** — send → answer via the relay page → drain → responses-arrived →
     Results → Export → Revoke closes the link (assert "no longer available"); an oversized relay
     submission is blocked client-side with the "too long" message before upload.
  4. **Compatibility household + external** — both answer → responses-arrived for the sender → align →
     `contextOnly` mode updates both coaches (assert each participant's own-context Insight, neither sees
     the other's answers — decrypt to verify) → reshare/revoke reach the right per-member links.
  - A mint failure surfaces (never a silent Inbox-only fallback) on each send path.
  - Draft questionnaire: Send disabled with reasons; fixing the branch dead-end enables it.
  - ~360px overflow guard + control-geometry guard on every changed surface, including the Results
    expiry/Export row and the relay page size-guard message.
- **Mocking** — the relay (`SELFOS_FAKE_RELAY`), Claude (`SELFOS_FAKE_CLAUDE`), and the export save op
  (a `SELFOS_FAKE_SAVE_DIR`-style hook, the `13` precedent) are faked; **decrypt the vault** to assert
  data (per the §16.7 matrix discipline + the content-correctness DoD rule), don't assert on the fake's
  canned output.
- **Questionnaires §16.7 matrix** — any new delivery/send behavior (re-ask, revoke-on-reask, export
  gating) adds an end-to-end case to the standing matrix in `08-questionnaires.md` (CLAUDE.md DoD).

## 11. Open questions

Every genuinely-open product/UX decision — do **not** assume any of these; resolve with the user before
building each slice.

1. **v1 scope** — which of the ten gaps land in v1 vs deferred? (Recommended grouping in §13, but the
   cut line is the user's call. E.g. notifications + draft/ready + validation guards + export feel
   high-value-low-risk; reminders + templates are heavier.)
2. **Responses-arrived "seen" semantics** — does a response stop being "new" when the sender _opens
   Results_, _dismisses the notification_, or _analyzes it_? And is "seen" device-local (spec 35's model,
   no schema change) or authoritative across devices (needs a vault marker, §4.3)?
3. **Reminder mechanism** — in-app notification only (recommended, no background network)? Default N
   days before a reminder? Does an external recipient ever get a relay-side reminder, or only the sender
   gets "re-share" nudged? Is a reminder in v1 at all?
4. **Re-ask: prior-link handling** — does "Ask again" **auto-revoke** the prior open send's link
   (recommended, prevents duplicate submit) or **warn** the sender and let them choose? Same question for
   reshare (today reshare mints a fresh link but leaves the old one live until expiry).
5. **Template / favorites model** — a real "save as template / favorite" model, or is **Duplicate**
   (already present) sufficient for reuse? If templates: where do they live, who can manage them, and how
   does that interact with the "no templates" decision in 08 §12.1?
6. **Draft-vs-ready prominence** — a badge, a banner, a disabled-Send-with-tooltip, or all three? How
   loud should "this isn't ready to send" be?
7. **Export format(s)** — CSV, JSON, or both? One file per questionnaire (all sends) or one per send?
   Does the export include numeric values from **Private** sends (consistent with trends, §3.2), or
   exclude Private sends entirely?
8. **Started-vs-finished** — confirm the exact sender-facing labels and that "Started" reveals nothing
   beyond "in progress" (no draft answers), for both Standard and Private sends.
9. **Branch-validation strictness on existing definitions** — should the stricter dead-end/circular
   check block re-sending an _existing_ questionnaire that predates the check (forcing a fix), or only
   gate new edits/sends? (Immutable sent snapshots are never re-validated regardless.)
10. **`contextOnly` copy + placement** — final plain-language description in the builder picker and the
    recipient disclosure; confirm it's worded so it never implies owner/admin visibility.
11. **AI matrix/allocation generation** — leave hand-authored (recommended for v1), or schedule a later
    additive generation slice? (Out of v1 scope as written.)
12. **Reconcile the SendPanel/CompatibilitySendPanel copy** — the panels reference "Resend link"; confirm
    the exact wording and that the _path from a failed mint → Results → Resend_ is walked end-to-end in
    E2E (the action exists today; this is an audit decision, not a rebuild).

## 12. Changelog

- 2026-06-23 — created. Drafted as spec 38 of the 5-spec post-MVP hardening group (37–41), building on
  08 (questionnaires) + 35 (notifications). Grounded against the live code: reconciled the framing's
  stale assumptions (`autoAnalyze` is wired; Resend/reshare + first-submission-wins + revoke + 60-day
  expiry + recipient-binding already exist) against the real gaps (no responses-arrived signal;
  re-ask/reshare don't revoke the prior link; no started-vs-finished distinction; no draft-vs-ready
  clarity; no export; branch dead-end/circular + email/phone + response-size validation missing;
  `contextOnly` under-documented). All product/UX forks left open in §11.

## 13. Proposed build slices (after approval — slice, don't ship at once)

This is a **large** spec; it must be sliced (each slice its own session, spec-first per the §11
decisions). Recommended order, smallest-risk first:

1. **Discoverability — responses-arrived notification + autoAnalyze clarity.** ✅ **Built (2026-06-23).**
   The `responses-arrived` source now names the latest responder + carries the response time
   (`ResponsesArrivedSummary.latestRecipientName`/`at`); the notification reads "Angel answered _Our week_"
   (single) or "New responses to _…_" (many) and its "View results" deep-links to
   `/questionnaires?focus=<id>&view=results` — opening that questionnaire's Results directly (a new
   `initialView` builder prop + a `focus`/`view` query handoff in the list). Opening Results marks the slot
   **read** ("seen" = opens Results, §11 #2); a higher count re-surfaces (the onIncrease rule). autoAnalyze
   already runs on the Results-open visit — the two analyze paths (manual button + the setting) are
   unchanged. No vault file / no migration (device-local "seen").
2. **Validation guards.** ✅ **Built (2026-06-23).** `validateQuestionnaire` now flags a branch on a
   **later** question or **itself** (a dead-end that can never appear) and a form where **every question
   is conditional** (could render empty) — the backward-only branch rule also makes a cycle structurally
   impossible (one branch per question, pointing earlier). It gates new edits + new sends; immutable sent
   snapshots are never re-validated (§11 #9). `RelayLinkDelivery` validates email/phone format: a
   non-empty malformed value **disables that one delivery action** with an inline `aria-invalid` hint
   while Copy / Share / the raw link stay usable (empty is allowed). A pure `responseSizeGuard` (in
   `@selfos/core/questionnaires`) estimates the **sealed** size (base64 ~4/3 + envelope) and shares the
   relay's `MAX_RESPONSE_BYTES` — centralized into a leaf `relay/relayLimits.ts` so client + server can't
   drift — and the relay page blocks an over-cap submit with "too long" before sealing (the relay's own
   413 stays the backstop). No AI/relay behavior change; no `RELAY_VERSION` bump.
3. **Draft-vs-ready + started-vs-finished labeling.** ✅ **Built (2026-06-23).** A questionnaire that fails
   `validateQuestionnaire` shows a **Draft** badge in the builder header and a `· Draft` cue in the list,
   with **Send disabled** and the missing-pieces reasons attached (`aria-describedby`, no separate banner —
   §11 #6). The builder now validates **synchronously** in the renderer (the same pure `validateQuestionnaire`
   the bridge runs), so the Draft state + Send-disable react instantly. The sender-facing status label for an
   in-progress draft is now **"Started"** (the recipient opened + saved a draft but hasn't submitted — never
   the draft answers; §11 #8). Renderer + derivation only; expiry surfacing lands in slice 4.
4. **Link lifecycle: revoke-on-reask/reshare + expiry surfacing.** ✅ **Built (2026-06-23).** Verified
   reshare **already auto-revokes** the prior mailbox before minting a fresh link (`reshareLink` →
   `revokeRelayForDeletion` → `relay.revoke`), so an old emailed link stops working on reshare (§11 #4 —
   the §1.1 ground-truth note was stale). `SendResult` now carries `expiresAt` (bridge-included only for a
   still-open relay-linked send), and Results shows a **"Link expires in N days" / "today" / "Link expired"**
   countdown so the sender knows when to re-share before the recipient hits a dead link (§3.6). Revoke
   already reaches every relay-linked open send (gated on `relayLinked && isOpen`, not `channel`).
   **Revoke-on-re-ask lands with re-ask in slice 5.**
5. **Re-ask in one action (+ reminder).** ✅ **Built (2026-06-23).** `assignments:reAsk({ questionnaireId })`
   re-sends the same questionnaire to the same bound recipient in one action — household in-app (+ a unified
   link when a relay is connected) or an external relay link, mirroring the original delivery — and
   **auto-revokes every still-open prior link** (§11 #4) so an old emailed link can't double-submit. A new
   send simply adds to the questionnaire's sends, which trends already aggregate (no `reAskOf` threading
   needed). The builder's sent-locked "Send again" became a one-action **"Ask again"** (non-compat;
   compatibility re-ask is **deferred** — its paired frozen variants need cloning, not regenerating — so
   compat keeps the panel re-walk). **Reminder:** a new spec-35 **`reminder-due`** notification nudges the
   **sender** (never the recipient) when a send is unanswered past **7 days**, derived host-side
   (`notifications:remindersDue`, no network/scheduler) and re-surfacing on `onIncrease`. **No
   `lastReminderAt` field after all** — the notification framework's device-local dismiss already prevents
   re-nagging (the §4.3 "device-local = no schema change" path), so no migration.
6. **Export raw answers / results.** ✅ **Built (2026-06-23).** `assignments:exportResults({ questionnaireId,
format })` builds the export **host-side** (the privacy boundary lives in the bridge, not the UI: a
   Standard send exports all answers; a **Private send exports only its numeric values** — rating/slider/
   matrix/allocation — never prose, §11 #7) via a pure `buildResultsExport` (CSV long-form with RFC-4180
   escaping, or JSON), then writes it **outside the encrypted vault** through the existing `saveImageFile`
   host save op (the spec-13 precedent; dialog title genericized to "Save file"). Results offers **Export
   CSV / Export JSON** once there's a submitted send, with a "outside your encrypted vault" confirmation.
   Gated `questionnaires.viewResults`, sender-scoped.
7. **Document & finish `contextOnly`.** ✅ **Built (2026-06-23).** The mode was already wired in code (the
   builder picker option "No report — just inform each coach" / "The most private option", the
   `disclosure.ts` recipient copy, and the Results "Update both coaches" action) — this slice **verified
   the copy never implies owner/admin visibility** (the durable rule, §11 #10) and **documented it as a
   first-class fourth mode in 08 §3.6** (the modes list + the `compatibility.visibility` union), plus a
   builder test asserting the option is offered with the most-private copy and no owner/admin language.
8. **Favorites (reuse via Duplicate).** ✅ **Built (2026-06-23).** Per §11 #5 we kept 08's "no templates"
   decision and added a lightweight **Favorite (pin)** instead: an additive-optional `Questionnaire.favorite`
   flag, toggled by a **star** on each list row (`questionnaires:setFavorite`, gated `questionnaires.create`)
   — set **without bumping the content `version`** (it's a list convenience, not an edit), preserved across
   edits by `saveQuestionnaire`, and **sorted to the top** of the list. Reuse a recurring questionnaire via
   the existing **Duplicate**; no new storage model. (No migration — additive-optional, absent = not pinned.)
