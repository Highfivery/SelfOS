# 56 — Answer review, edit & re-analyze

> **Status:** Approved · **Built** — _last updated 2026-07-07_ (on `feat/answer-review-edit`, PR pending)
>
> After a household recipient submits a questionnaire they hit a dead end: they can't review their own
> answers or the questions, can't edit and resend, and if they could, the sender's analysis would silently go
> stale. This spec lets an **in-app (Inbox) recipient review their submitted answers, edit them, and resend**,
> and notifies the **sender** that the answers changed so they can **re-analyze**. Household/Inbox only (the
> user's choice, 2026-07-07); external relay-link recipients stay single-submission (a deferred follow-up).

Builds on [`08-questionnaires.md`](08-questionnaires.md) (the answering + Results + analysis lifecycle, the
Inbox, the shared answer-type renderer, the Insight/metrics layer) and
[`38-questionnaire-lifecycle-completeness.md`](38-questionnaire-lifecycle-completeness.md) (the device-local
"seen" model, the `responses-arrived`/`reminder-due` notifications), and reuses
[`35-notification-system.md`](35-notification-system.md) (the registry + per-person device-local state). It
amends [`08`](08-questionnaires.md) §3.3 (answering is no longer "locked forever" for in-app sends) and §3.7
(Results gains a stale-analysis signal).

---

## 1. Overview

Today an in-app recipient's answering flow is one-way: `openAssignment` → `saveProgress` (draft) →
`submitResponse` locks the assignment to `submitted` and `isAnswerable` returns false forever, so the Inbox
detail shows a "you've submitted this" dead-end with **no way to see what they answered**, let alone change it
([`08`](08-questionnaires.md) §3.3). Meanwhile the sender analyzes a submitted response into an Insight; if the
answers ever changed, that Insight would be stale with no signal.

This spec closes both gaps for **household (in-app) sends**:

- The recipient's answered Inbox item becomes a **read-only review** of their questions + answers, with an
  **"Edit answers"** affordance that re-opens the form, pre-filled, for an **"Update answers"** resubmit.
- Each resubmit bumps a response **revision**; when a send's answers have changed since the sender last
  analyzed them, Results shows an **"Answers updated — re-analyze"** signal and the sender gets a gentle
  **`answers-updated` notification**. Re-analyzing overwrites the same Insight (already idempotent) and clears
  the signal.

**Out of scope (unchanged):** external **relay** recipients (the mailbox is purged after the sender drains it,
so re-submission needs keeping the link alive / re-minting + re-notifying by email/SMS — a separate lift) and
**compatibility** sends (editing one participant would invalidate the joint alignment report — deferred). The
edit affordance is shown only for a **standard, in-app** send.

## 2. Goals / Non-goals

**Goals**

- **Recipient review**: an answered in-app assignment shows the recipient their questions + their own answers
  read-only (reusing the shared `@selfos/answering` renderer), never a dead-end.
- **Edit & resend**: an **"Edit answers"** button re-opens the assignment (status `submitted`/`analyzed` →
  `inProgress`, keeping the existing `ResponseSet` + answers); the form is pre-filled; **"Update answers"**
  resubmits. Unlimited edits.
- **Revision tracking**: `ResponseSet.revision` (additive, default 1) increments on each resubmit;
  `Insight.provenance.analyzedRevision` records the revision an analysis was built from.
- **Stale-analysis signal + notification**: a send is **analysis-stale** when an analysis Insight exists and
  `response.revision > analyzedRevision`. Results shows a stale chip + **Re-analyze**; a new **`answers-updated`**
  notification (sender-scoped, `questionnaires.viewResults`) nudges the sender, coalesced per send, `onIncrease`
  by revision (so re-analyzing / dismissing never re-nags until the recipient edits again).
- **Respect `autoAnalyze`**: when on, a stale send is auto-re-analyzed (the existing one-at-a-time effect
  extends to stale sends); when off, the notification + manual Re-analyze.
- **Household only, trust boundary intact**: re-open/edit/resubmit are recipient actions gated by
  `questionnaires.answer` + recipient-scoped in the bridge; the answers-updated read is sender-scoped +
  `questionnaires.viewResults`. Private-send answers still never cross IPC to the sender (§8).

**Non-goals**

- **External relay edit-and-resend** — deferred (architectural: purge-on-drain).
- **Compatibility-send editing** — deferred (would invalidate the alignment report).
- **No answer history/diff UI** — we track a revision counter, not a full per-edit answer history.
- **No auto-notify of the recipient** — this never messages the recipient; it only lets them self-serve.

## 3. UX & flows

### 3.1 Recipient — review, edit, resend (Inbox)

1. Recipient answers + **Submit** as today → status `submitted`.
2. Re-opening the item from the Inbox now shows a **read-only review**: the sender/purpose header, then each
   question with the recipient's answer rendered read-only (the shared `QuestionnaireForm` in a `readOnly`
   mode / `QuestionnairePreview`-style view), plus the crisis footer + not-medical line (unchanged, §8).
3. Below the review: an **"Edit answers"** button (shown only for a **standard, in-app** send that is
   `submitted` or `analyzed`; hidden for compatibility + relay). A short line sets expectations: _"You can
   update your answers and resend — the person who asked will be able to review the update."_
4. **Edit answers** → the assignment re-opens (`inProgress`), the form renders **pre-filled** with the current
   answers, editable; the primary button reads **"Update answers"**. A **Cancel** returns to the review without
   changing anything (the assignment stays `inProgress` with the same answers — re-submitting is not forced, but
   the sender sees "Started" until they do; see §7).
5. **Update answers** → validate (required questions, as on first submit) → resubmit → `revision += 1` → back to
   the read-only review with a subtle "Updated · <when>" confirmation.

### 3.2 Sender — the stale signal & re-analyze (Results)

- In **Results**, a send whose answers changed since the last analysis shows an **"Answers updated since your
  last analysis"** chip and an enabled **Re-analyze** action (the existing Analyze button; on a non-stale
  analyzed send it stays "Re-analyze" but without the chip). Re-analyzing overwrites the same Insight and
  stamps the new `analyzedRevision`, clearing the chip.
- A **`answers-updated` notification** (bell + toast) fires for each analysis-stale send: title e.g.
  _"Angel updated their answers to 'Our week'"_, body _"Re-analyze to refresh what SelfOS learned."_, action =
  deep-link to that questionnaire's Results (`/questionnaires?focus=<id>&view=results`). `onIncrease` by
  revision: dismissing, or re-analyzing, stops it re-popping until the recipient edits again.
- When `autoAnalyze` is on, the Results auto-analyze effect (§08/§38) also re-runs for stale sends, so the
  Insight refreshes without a click; the notification still records the change (and is cleared once caught up).

**Happy path.** Angel answers Ben's "Our week" and submits. Ben analyzes it. Angel realizes she misjudged a
question, opens it in her Inbox, taps **Edit answers**, changes it, taps **Update answers**. Ben's Results now
shows "Answers updated since your last analysis" on that send and his bell shows a notification; he taps
**Re-analyze**, the Insight refreshes, the chip + notification clear.

## 4. Data model (vault files & schemas)

- **`ResponseSet.revision?: number`** (additive-optional, `.default(1).catch(1)`) — 1 on first submit,
  incremented on each resubmit. No `schemaVersion` bump (the `submittedAt`-optional precedent, §08/§38).
- **`InsightProvenance.analyzedRevision?: number`** (additive-optional) — the `ResponseSet.revision` an
  analysis was built from; absent on pre-56 insights → treated as `1` (so an un-edited pre-56 send is never
  falsely stale).
- **No new vault file.** Re-open mutates the existing `Assignment.status` + `ResponseSet` (through the vault
  service); analysis reuses the existing per-subject Insight. The sender's "seen"/stale state is **derived**,
  device-local (spec 35/38 model) — no vault marker.
- **One additive notification kind:** `'answers-updated'` in the core `NOTIFICATION_KINDS` enum. Its
  read/dismissed signature persists in the existing device-local, per-person `PersonNotificationState`.

## 5. Architecture & modules

- **Core `@selfos/core/questionnaires`:**
  - `answerService`: `ANSWERABLE_STATUSES` unchanged; add **`reopenAssignment(fs, key, assignmentId,
recipientPersonId, now)`** — permitted only from `submitted`/`analyzed`, recipient-scoped, sets status
    `inProgress` (keeps the `ResponseSet` + answers, keeps `submittedAt` until the next submit overwrites it).
    `submitResponse` bumps `revision` (`(prev.revision ?? 1) + 1` on a resubmit; `1` on first).
  - `analysisService.analyzeAssignment`: stamp `provenance.analyzedRevision = response.revision ?? 1` on the
    Insight; add a pure **`isAnalysisStale(response, insight)`** + a `listUpdatedSends(...)`-style helper the
    Results + notification source reuse (single definition, no drift).
- **IPC (`channels.ts` + `coreBridge.ts` + `ipc.ts` + preload):**
  - `assignments:reopen` — recipient, gated `questionnaires.answer`, recipient-scoped in the bridge.
  - `notifications:answersUpdated` — sender-scoped, gated `questionnaires.viewResults`; returns
    `AnswersUpdatedSummary[]` (mirrors `ResponsesArrivedSummary`: questionnaireId, title, recipientName, revision,
    at). Computed in the bridge (never carries raw answers — a Private send's boundary holds).
  - `SendResult` (Results) gains an additive **`analysisStale: boolean`** so the chip renders.
- **Renderer:**
  - `InboxAnswer.tsx`: the read-only review + "Edit answers" (reopen via `inboxStore`) + "Update answers"
    (resubmit) + Cancel; gated on standard + in-app + `submitted`/`analyzed`.
  - `QuestionnaireResults.tsx`: the stale chip + Re-analyze; the autoAnalyze effect includes stale sends.
  - `notificationKinds.ts`: registry entry `answers-updated` (`resurfaces: onIncrease`); `useNotificationSources.ts`
    fetches `notifications:answersUpdated` (gated `questionnaires.viewResults`) and pushes candidates.
- **No new store, no new package.**

## 6. IPC / API contracts

- `assignments:reopen(assignmentId) → InboxAssignmentDetail` — recipient re-opens their submitted send;
  rejects a non-recipient, a non-`submitted`/`analyzed` status, or a compatibility/relay send.
- `notifications:answersUpdated() → AnswersUpdatedSummary[]` — sender-scoped, `viewResults`; the stale sends.
- `assignments:results` unchanged shape except the additive `analysisStale` on each `SendResult`.
- **No Claude API changes.** Re-analysis is the existing `analyzeAssignment` metered pass (`questionnaire.analyze`).

## 7. States & edge cases

- **Never analyzed, then edited** — no analysis Insight → not "stale" → no `answers-updated` notification (the
  still-unread `responses-arrived` already nudges the sender to look; Results shows the current answers). The
  chip/notification are strictly "you analyzed; they changed it."
- **Re-opened but not resubmitted** — status `inProgress`, answers unchanged, `revision` unchanged; Results
  shows "Started" (accurate). The recipient can Cancel (no-op) or resume. No stale signal until a resubmit
  raises the revision past `analyzedRevision`.
- **Edited again after re-analyze** — `revision` climbs past the new `analyzedRevision` → stale again → a fresh
  `answers-updated` candidate (onIncrease by the higher revision).
- **Private send** — the recipient reviews/edits their **own** answers (their data); the sender's Results +
  the `answers-updated` summary still carry **no raw answers** (only the fact + count + name), preserving §08
  §3.2's Private boundary. Re-analysis distills into the Insight as before.
- **`responses-arrived` vs `answers-updated`** — first submit → `responses-arrived` (count of submitted+analyzed,
  unchanged by a re-open→resubmit cycle, so it doesn't double-fire); a post-analysis edit → `answers-updated`.
- **autoAnalyze on** — a stale send is auto-re-analyzed one-at-a-time; a failed attempt isn't retried (existing
  guard); the notification is cleared once `analyzedRevision` catches up.
- **Per-person isolation / switch** — recipient actions are recipient-scoped; the sender's stale reads are
  sender-scoped; notification + inbox stores reset per active person (existing AppShell effect).
- **Pre-56 data** — a submitted response with no `revision` reads as 1; an insight with no `analyzedRevision`
  reads as 1 → an un-edited existing send is never falsely flagged stale.
- **Compatibility / relay send** — the edit affordance is hidden; behavior unchanged.

## 8. Safety

The crisis footer + not-medical line remain on every recipient answering/review state (unchanged, §08 §8).
This spec touches no crisis logic. **Privacy:** the recipient only ever sees/edits **their own** answers; the
sender-facing `answers-updated` summary and Results carry **no raw answers for a Private send** (the boundary
is the bridge, §08 §3.2/§3.7) — only "who/which/when/that-it-changed." Re-open/edit/resubmit are gated
`questionnaires.answer` + recipient-scoped; the stale read is `questionnaires.viewResults` + sender-scoped.

## 9. Accessibility

- The review renders as ordinary labelled read-only fields (the shared renderer's read-only mode); "Edit
  answers"/"Update answers"/"Cancel" are labelled buttons.
- The Results stale signal is a text chip ("Answers updated since your last analysis"), not colour-only.
- The notification uses the existing accessible toast/center.

## 10. Testing

- **Core** — `reopenAssignment` (allowed from submitted/analyzed, rejected otherwise + non-recipient);
  `submitResponse` revision bump (1 → 2 → 3 across resubmits, keeps the ResponseSet id); `analyzeAssignment`
  stamps `analyzedRevision`; `isAnalysisStale` truth table (no insight → false; revision==analyzed → false;
  revision>analyzed → true; pre-56 defaults).
- **Bridge** — `assignments:reopen` recipient-scoped + status-gated + rejects compatibility/relay;
  `notifications:answersUpdated` sender-scoped, `viewResults`-gated, carries no raw answers for a Private send;
  `SendResult.analysisStale` correct.
- **RTL** — InboxAnswer: read-only review of submitted answers; "Edit answers" → editable pre-filled form →
  "Update answers"; the affordance hidden for a compatibility/relay send. Results: the stale chip + Re-analyze.
  useNotificationSources: an `answers-updated` candidate only for a stale send, `onIncrease`.
- **E2E** — a household member answers + submits → the sender analyzes → the member re-opens, edits, and
  resubmits → the sender's Results shows the stale chip + the bell shows `answers-updated` → Re-analyze clears
  it (decrypt the vault to assert the response `revision` incremented + the Insight's `analyzedRevision`
  caught up); a Private send's `answers-updated` summary carries no prose; a 360px guard on the review.

## 11. Open questions

_Resolved with the user (2026-07-07):_ scope = **household (Inbox) only** (external relay + compatibility
deferred). Remaining defaults chosen (not blocking): unlimited edits; re-analysis respects the existing
`autoAnalyze` setting; the stale signal + notification fire only when a **prior analysis** exists (matching the
request's "they should re-analyze"); revision is a monotonic counter, not a full answer-history/diff.
