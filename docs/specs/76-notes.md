# 76 — Notes (owner-authored, AI-drafted, sent as SelfOS)

> **Status:** Built — _last updated 2026-08-21_
>
> An owner-only surface for writing a note to **one** household member. The owner picks the person
> first, types a rough intent, and Claude drafts the note from **everything SelfOS knows about that
> person** — including private material. It lands in the recipient's Inbox as the record and emails
> them as the reach layer, **in SelfOS's own voice with no sender**. The owner sees delivery, opens,
> clicks and any tapped answer.

---

## 1. Overview

SelfOS has eight [`67`](67-email-engagement.md) email families and every one of them is
**system-triggered**. There is no way for the owner to say a specific thing to a specific person at a
specific moment — to announce a feature, ask one question, or point someone at something worth trying.

This spec adds that. It is deliberately **narrow**: one recipient, one note, no campaign machinery. The
send/log spine ([`67`](67-email-engagement.md) §5.2), the tap layer ([`67`](67-email-engagement.md) §3.5),
the Inbox registry ([`08`](08-questionnaires.md) §35.3) and the AI harness
([`08`](08-questionnaires.md) §13.3) are all reused unchanged; almost nothing here is new machinery.

Related: [`67`](67-email-engagement.md) (email spine, families, activity log), [`08`](08-questionnaires.md)
§35 (Inbox registry) and §17 (recipient-bound authoring — the pattern this copies),
[`63`](63-auto-checkins.md) (the reconcile cadence), [`04`](04-people-roles.md) (capabilities),
[`42`](42-relationship-scoped-sharing.md) (the sharing boundary this deliberately bypasses).

### 1.1 What this reverses

Three shipped rules change. They are listed here rather than buried because the amendments must land in
**the same change** as the code (CLAUDE.md §8, living docs).

| Rule                                                         | Where                                                                 | Change                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Never surface that an owner/admin can see a member's content | CLAUDE.md §1, [`67`](67-email-engagement.md) §8.4                     | A note may state what the record shows ("you've journalled most nights this month"). Amend both to scope the rule to _unsolicited disclosure of the access relationship_, not to content the system legitimately holds. |
| Crisis suppresses engagement email                           | [`67`](67-email-engagement.md) §8.1                                   | Removed app-wide (§8.2). Notes are never crisis-suppressed because there is no crisis system left.                                                                                                                      |
| A person controls what feeds another person's view of them   | [`15`](15-shareability.md), [`42`](42-relationship-scoped-sharing.md) | The draft reads the recipient's full record, `restricted` and `privateFields` included. The sharing model is **untouched for every other surface**; this is a single named exception (§8.1).                            |

---

## 2. Goals / Non-goals

**Goals**

- **One person, chosen first.** Single-select, before a word is written — the
  [`08`](08-questionnaires.md) §17 recipient-bound pattern, for the same reason: everything downstream
  is written for them.
- **AI drafts from the whole record.** No picker, no toggles, no shareability filter. The owner types a
  rough intent; Claude writes subject + body (+ answers, by type).
- **Sent as SelfOS.** No sender, no signature, no first person, on both surfaces. It reads as something
  the app noticed.
- **Inbox is the record, email is the reach layer.** The note always lands in the recipient's Inbox; the
  email is what reaches someone who hasn't opened SelfOS.
- **Real delivery metrics.** Delivered / opened / clicked timestamps plus the tapped answer, per note.
- **Type drives the payload.** Announcement → nothing to tap. Question → AI-written tappable answers.
  Suggestion → I'm game / Maybe later / Not for me.

**Non-goals**

- **Multi-recipient sends, segments, campaigns, A/B tests, drip sequences.** Single-recipient by
  construction (§4.2) — the model cannot express a multi-send.
- **A campaign record.** Rows are ordinary `EmailActivityEntry`s filtered by family; display grouping
  rides the existing `sourceKey`.
- **A reply channel.** Taps only. Free-text reply is a one-question questionnaire if it is ever wanted
  ([`08`](08-questionnaires.md)) — never a second inbound path ([`67`](67-email-engagement.md) §2).
- **Member-to-member notes.** Owner-only. Revisit if the asymmetry proves uncomfortable.
- **External (non-member) recipients.** Household people only in v1.
- **An opt-out.** Owner-decided (§8.3). Deliverability consequences recorded there.
- **A new secret store, relay, cadence or AI harness.** All four are reused.

---

## 3. UX & flows

A new **owner-only top-level nav entry, "Notes"**, gated on the Owner ROLE — hidden entirely from
members, like Roles and Devices. Mockup: the six-screen review approved 2026-08-21.

### 3.1 The Notes surface

Header (`AdminOnlyBadge`) + "Write a note". A four-tile stat strip (Sent / Delivered / Opened /
Answered) over a list of past notes, newest first. Each row: recipient avatar, subject, type chip +
stripe hue (state as **form**, not colour alone, §9), timestamp, and a rail carrying delivery, open time
and the tapped answer.

A note to someone with no email address shows **"In SelfOS only"** and states why — not a failure.

### 3.2 Step 1 — who is it for

A **radio** list of household people (`isSubject`, excluding the owner), each showing name, address and
relationship, with a reachability chip. A person with no `Person.email` shows "SelfOS only" and an
inline **add-address** affordance writing to their People profile.

Single-select is structural, not a validation rule (§4.2). The selected row carries a filled **radio
dot** as well as a tint — selection must read as form, never colour alone (§9).

### 3.3 Step 2 — compose

Header names the recipient ("A note for Angel") with a "Change person" escape.

**Two modes**, so the AI boundary is a shape rather than a rule to remember:

- **Draft something** (default) — Claude writes it.
- **Write it myself** — a blank composer, AI off. For anything the owner should say in their own words.

A banner states plainly what the draft is built from: _everything SelfOS knows about them — sessions,
dreams, goals, memory, questionnaire answers, private notes. No selection, no toggles._

Then: the **type** picker (announcement / question / suggestion), a free-text **intent** box, and
**Draft it for `<name>`** with the AI-spend note (admin-only `$`, per the app-wide money rule).

The draft renders as editable subject + body (+ answer labels for question/suggestion), with **Try
again**. A banner restates the voice rule: _goes out as SelfOS — no sender, no signature, no first
person._

**Starting a second note resets the mode and type, not just the draft.** Carrying them forward is what
made a note written by hand leave the surface on `self` with the draft cleared — matching neither the AI
card nor the editor, so the compose step opened on nothing at all. The editor renders whenever the owner
is writing it themselves _or_ a draft exists, so it can never be gated on state a button click alone
seeds.

### 3.4 Step 3 — preview & send

Two panes side by side: the email exactly as rendered by the existing `emailComposer.shell()`, and the
Inbox entry. One action: **Send to `<name>`** — named, never a count.

**As built, the other two actions in the original draft are deliberately NOT there** (§12 forbids
scaffolding a control before it earns its place):

- **Send a test to me** — the preview pane already renders the email through the real composer, so a
  test copy shows the owner nothing new about the content; the only thing it would prove is that Resend
  is configured, which Settings → Email's **Test connection** already answers. It would also mail one
  person's private material to a second inbox for no gain.
- **Schedule** — `scheduledAt` and `cancelScheduled` already exist so it is nearly free to wire, but at
  one recipient per note there is no use case that "write it when you mean it" does not cover. Left
  unbuilt rather than shipped as a control with nothing behind it.

### 3.5 How it landed

A **timeline, not a dashboard** — at one recipient a rate is meaningless. Three events with times
(Delivered / Opened / Tapped `<answer>`), plus a standing caveat that "opened" is approximate (§7.4).

**One answer, two doors.** A question or suggestion is answerable from the email (a relay tap) _and_ from
the Inbox, and both write the SAME `EmailResponse` under the note's AUTHOR via `recordNoteAnswer`. One
record shape means "what they answered" has one definition regardless of which surface they used, and the
owner's list reads one place. Filed under the author for the same reason the delivery row is (§5.3): the
email reconcile is active-person-scoped, so tokens or responses filed under the recipient would only ever
drain when THEY signed in — and the answer would never reach the person who asked.

### 3.6 What the recipient sees

Both surfaces carry **no sender**. The email is SelfOS-branded, in the app's voice, with the type's
affordance. The Inbox entry omits `fromName` and shows title + snippet + Open / Dismiss — and the row
must render **nothing** where a sender would go, rather than falling back to "From someone", which
asserts a person sent it and is strictly worse than naming one.

Opening it goes to **`/inbox/note/:authorPersonId/:noteId`** — its own route, not the Inbox's detail
pane, which is hard-wired to the questionnaire answering form. There the person reads the note and taps
one of its answers. Tapping again replaces the answer; a note asks one question and a person may change
their mind.

---

## 4. Data model (vault files & schemas)

All reads/writes go through the vault service. No new vault file is introduced.

### 4.1 Reused, unchanged

| Path                                          | What                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `people/<owner>/email/activity/<YYYY-MM>.enc` | `EmailActivityEntry[]` — one row per note (logged under the **owner**, §5.3) |
| `people/<owner>/email/content/<entryId>.enc`  | `EmailContentSnapshot` — the rendered note                                   |
| `people/<owner>/email/tokens/<token>.enc`     | `EmailToken` — a minted tap and what it means                                |
| `people/<owner>/email/responses/<id>.enc`     | `EmailResponse` — the answer, under the AUTHOR (§3.5)                        |
| `people/<recipient>/inbox/dismissals.enc`     | existing Inbox dismissals                                                    |

### 4.2 Additive schema changes

```ts
// schemas.ts — a ninth family. Drives per-family filtering, the activity log and the composer.
export const EmailFamilySchema = z.enum([
  'questionnaire-delivery', 'transactional', 'digest', 're-engagement',
  'ai-suggestion', 'ai-suggestion-intimacy', 'milestone', 'welcome',
  'note',                                   // NEW
]);

export const NoteTypeSchema = z.enum(['announcement', 'question', 'suggestion']);

// EmailActivityEntry gains ONE field. Additive-optional — no schemaVersion bump, no migration
// (the `Person.email` / `Insight.dreamId` precedent).
recipientPersonId: z.string().optional(),   // NEW — who it was for; the row is logged under the sender

// EmailTokenKind gains a fifth kind, and both the token and the response gain the note they belong to.
// Additive-optional throughout; an existing token or response is unaffected.
export const EmailTokenKindSchema = z.enum([
  'reaction', 'intimacy-reaction', 'checkin-answer', 'tuning',
  'note-answer',                            // NEW
]);
noteId: z.string().optional(),              // NEW — on EmailToken AND EmailResponse
source: z.enum(['relay-tap', 'deep-link', 'in-app']),  // 'in-app' is NEW — a tap made inside SelfOS
```

The recipient's view is a projection carrying **no author name** — the field does not exist on it, rather
than existing and being hidden by every consumer:

```ts
export interface NoteForRecipient {
  id: string;
  authorPersonId: string; // only because the note lives in the author's folder
  subject: string;
  body: string;
  answers: NoteAnswer[];
  createdAt: string;
  answered?: string; // so the choice reads as made, not still open
}
```

`Person.email` is **not** a schema change — it already exists and is parsed. It has simply never had a
writer (§5.5).

Single-recipient is expressed in the **input type**, so no downstream code has to defend against a list:

```ts
export const NoteSendInputSchema = z.object({
  recipientPersonId: z.string().min(1), // exactly one, by construction
  type: NoteTypeSchema,
  subject: z.string().min(1),
  body: z.string().min(1),
  answers: z
    .array(z.object({ label: z.string().min(1), stance: EmailAnswerStanceSchema }))
    .default([]),
  scheduledAt: z.string().datetime().optional(),
});
```

---

## 5. Architecture & modules

### 5.1 Core — `packages/core/src/notes/`

- **`noteDraftService.ts`** — `draftNote(deps: AiDeps, input)`. One `runClaude(deps, system, intent,
'note.draft', 2000)` call: budget-gated, metered, `extendedThinking:false`, continuation-safe,
  tolerant parse ([`37`](37-ai-output-robustness.md)). Returns `{subject, body, answers}` or an honest
  failure.
- **`noteContext.ts`** — assembles the recipient digest (§5.2).
- **`noteSendService.ts`** — composes via a new `buildNoteEmail()` in `emailComposer.ts` and routes
  through the existing send tail (§5.3).
- **`inboxProvider.ts`** — registers a `note` kind on the Inbox registry.
- **`recordNoteAnswer` / `noteAnswerOf`** (in `email/emailResponse.ts`, where the record lives) — the
  single writer + reader for an answer, whichever surface it came from (§3.5).

### 5.2 The draft context — deliberately unfiltered

`buildNoteContext(fs, key, recipientPersonId)` reads the recipient's **full** record: insights (own-subject,
approved, **not** `ownSubjectInsights`-filtered for sharing), goals, intake portrait incl. `restricted`
facts, dream stats, questionnaire history, `Person` profile incl. `privateFields`, usage/feature signals.

It bypasses `factSharedWithViewer` **by design** (§8.1) and is the **only** caller permitted to. Every
other cross-person path keeps the sharing gate.

### 5.3 The send path

Reuses `performSend` via a **new sibling** of `sendQuestionnaireDeliveryEmail`, because a note shares
family A's gating profile, not the engagement families':

- goes to the recipient's **`Person.email`** contact address, not `EmailPrefs.address`;
- is **not** gated on a per-family opt-in or `paused` (§8.3);
- is **not** crisis-suppressed (there is no crisis system, §8.2);
- logs the `EmailActivityEntry` **under the owner** with `recipientPersonId` stamped.

Logging under the owner is what makes metrics work: `emailScheduleReconcile` is active-person-scoped, so
the owner's own reconcile polls their own rows. Logging under the recipient would mean opens never
refresh until that person opened the app.

**The Inbox entry is written first and unconditionally.** A missing address, a Resend failure or a
not-configured household reduces reach; it must never lose the note.

### 5.4 Voice enforcement

The system prompt is `PERSONA` + `SAFETY` + a note addendum requiring SelfOS's own register: no
signature, no sender, **no first-person singular**. Belt and braces — a `containsFirstPerson()` check on
the returned subject and body rejects the draft rather than sending it. One "I thought you'd like this"
breaks the framing completely, so it is checked in code, not merely instructed.

Subject, body and every answer label also run `violatesBoundary` against the recipient's lexicon
([`74`](74-adaptive-tests.md) §5.8a) before sending — unrelated to this change, and it stays.

**Writing it by hand produces an announcement.** There is no editor for answer labels — they are written
_for_ a specific body by the model — so a self-written note carries none, and a note with nothing to tap
IS an announcement. Sending it as a question would put a type on the record its content cannot support.

### 5.5 Renderer

- Route `notes` in `GUARDED_ROUTES` gated `'owner'`; nav entry likewise.
- `noteStore` (Zustand), reset on active-person change (the per-person-state rule).
- **`Person.email` gains its missing input** on the People profile — it is a dead field today.
- The Step-1 picker uses a **name/address projection**, not `peopleList`, which currently returns full
  profiles ungated (§11.2).

### 5.6 Capability

**No capability.** The gate is the **Owner ROLE** (`activePersonIsOwner` in the bridge, `isOwner()` in
the renderer). A `notes.manage` capability shipped first and was removed: §8.1 permits the note pass to
read the recipient's private and `restricted` record — the single exception in the app — and justifies it
solely by the Owner already being able to read all of it. That justification does not survive one flip of
a Roles-matrix toggle, which renders a `Switch` for every capability on every non-owner role and would
have handed a Member an unfiltered cross-person read that `factSharedWithViewer` / `isPersonFieldShared` /
`summarizeForContext` otherwise forbid.

---

## 6. IPC / API contracts

All gated on the Owner ROLE and enforced **in the bridge**, not the renderer.

| Channel            | Request                             | Response          | Notes                                                                                                |
| ------------------ | ----------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `notes:recipients` | —                                   | `NoteRecipient[]` | `{personId, displayName, email?, relationshipLabel?, reachable}` — a projection, never full `Person` |
| `notes:draft`      | `{recipientPersonId, type, intent}` | `NoteDraftResult` | One metered `note.draft` pass; honest failure taxonomy                                               |
| `notes:send`       | `NoteSendInput`                     | `EmailSendResult` | Writes the Inbox entry, then sends                                                                   |
| `notes:list`       | `{from?, to?}`                      | `NoteRow[]`       | Owner's `note`-family activity + `recipientPersonId` resolved to a name                              |
| `notes:delete`     | `{noteId}`                          | `void`            | Scoped to the active person's own folder                                                             |
| `people:setEmail`  | `{personId, email}`                 | `Person`          | Owner-gated; writes the contact address                                                              |

Two more are **not** owner-gated, because they belong to the person a note was written FOR. Both resolve
the active person and require them to BE the recipient, so an author id + note id in a payload can never
open or answer someone else's note:

| Channel          | Request                           | Response            | Notes                                            |
| ---------------- | --------------------------------- | ------------------- | ------------------------------------------------ |
| `notes:getForMe` | `{authorPersonId, noteId}`        | `NoteForRecipient?` | `null` unless the active person is the recipient |
| `notes:answer`   | `{authorPersonId, noteId, label}` | `NoteForRecipient?` | The label must be one the AUTHOR offered         |

The Resend and Claude keys are resolved host-side and **never cross IPC**
([`00`](00-architecture.md) §6.2).

`note.draft` is registered in `USAGE_TYPE_LABELS` as _"Note — AI draft"_.

---

## 7. States & edge cases

| State                                            | Behaviour                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| No household member with an address              | Step 1 still lists everyone; notes land in SelfOS only                                      |
| Recipient has no `Person.email`                  | Inbox entry written; no email; row reads "In SelfOS only"                                   |
| Email not configured (no Resend key / from-line) | Inbox entry written; row reads "In SelfOS only"; Settings → Email linked                    |
| AI off / over budget / refused / truncated       | Honest failure per [`37`](37-ai-output-robustness.md); **Write it myself** always available |
| Draft uses first person                          | Rejected before send, with a retry (§5.4)                                                   |
| Draft violates the recipient's lexicon           | Refused, never sent (§5.4)                                                                  |
| Resend send fails                                | Activity row logged `failed`; Inbox entry already landed; retryable                         |
| Scheduled note, recipient answers first          | No cancel semantics — a note has no "answered" state to obsolete                            |
| Recipient dismisses the Inbox entry              | Recorded in their own `inbox/dismissals.enc`; the owner's metrics are unaffected            |
| Recipient deleted                                | `recipientPersonId` no longer resolves; the row shows the stored address                    |
| Corrupt activity shard                           | Quarantined, never crashes the view ([`67`](67-email-engagement.md) §7)                     |
| Concurrent sends                                 | Append-only shards; last-write-wins is acceptable at this volume                            |
| **Open never registers**                         | Common and expected — see §7.4                                                              |

### 7.4 "Opened" is approximate, and the product says so

Resend open tracking is a 1×1 pixel enabled as a **domain-level toggle** in the Resend dashboard (not an
API parameter), so switching it on affects **every** SelfOS email. Apple Mail Privacy Protection and
Gmail's image proxy pre-fetch that pixel, so an open can register with no human involvement, and on an
Apple-centric household will likely register almost immediately, every time.

Click tracking rewrites links into per-recipient redirects and is meaningfully more reliable; a **tap**
through the relay is a deliberate act and is the only engagement signal treated as real.

The "How it landed" view therefore carries a standing caveat. This is a product requirement, not a
footnote: an unqualified 100% open rate would be read as attention it does not represent.

---

## 8. Safety

### 8.1 The unfiltered read is a single named exception

The draft context (§5.2) reads `restricted` facts and locked `privateFields`. This is a deliberate
owner decision (2026-08-21) and is confined to **this one code path**. `factSharedWithViewer`,
`summarizeForContext`, `ownSubjectInsights` and every cross-person surface are unchanged, and their
tests must stay green.

The residual exposure is bounded by what already ships: the Owner is the full-access role and can read
all of this directly today. What is new is that it can now reach a _generated message_.

### 8.2 There is no crisis system

> **Superseded 2026-08-22 — the crisis system was removed app-wide** (owner decision; `CLAUDE.md` §1).
> `aggregateCrisisSignal`, both `CrisisFooter`s, the `CrisisSupportBanner`, every `crisisFlag` /
> `distressSignal` field, the PHQ-9 item-9 trigger, the nightmare nudge and email crisis suppression are
> gone. The section below is kept for history; **do not implement it**. The not-medical boundary is a
> separate rule and still applies.

Per the owner's decision (2026-08-21) the distress/crisis system is being removed app-wide as a separate
change: `aggregateCrisisSignal`, the Home `CrisisSupportBanner`, the `CrisisFooter`, insight
`crisisFlag` handling, the PHQ-9 item-9 trigger, the nightmare nudge and email crisis suppression.

Notes therefore have no crisis gate and no crisis footer. **This spec does not itself remove anything.**

**Corrected 2026-08-21:** this section previously said Notes "must not land before that change". That was
an assumption, and it was wrong — the two are not coupled. `sendNoteEmail` calls `performSend` **directly**
rather than routing through `sendFamilyEmail`, so the note family never passed through the
`crisisSuppressed` gate at all and has nothing there to remove; and no note surface renders a
`CrisisFooter`. Notes shipped first, and the removal is its own change.

> **Open (§11.1):** whether the PHQ-9 item-9 trigger survives. It is independent of everything else in
> the removal.

### 8.3 No opt-out

A note reaches the recipient regardless of their per-family opt-ins or `paused` flag, and carries no
unsubscribe. Owner-decided.

Consequence, recorded so it is not rediscovered later: a note is the only mail in SelfOS a household
member cannot refuse, and a broadcast-shaped email is the most spam-filter-prone thing the app sends. A
single spam complaint degrades the reputation of the household's sending domain for **all** SelfOS mail.

### 8.4 The not-medical boundary

Unchanged. Every note carries the standing not-medical footer from `emailComposer.shell()`.

---

## 9. Accessibility

Per [`01`](01-design-system.md). Specifically: the recipient list is a labelled radio group with visible
focus; type is conveyed by chip **text** plus stripe, never colour alone; the timeline states each event
in words with its time; the compose flow's step indicator is text (`Step 2 of 3`); the draft area is a
labelled textarea; every icon-only control carries an accessible name; no motion beyond token defaults.

---

## 10. Testing strategy

**Unit (core)** — `draftNote` happy path + each failure reason; the first-person rejection; the
`violatesBoundary` refusal; `buildNoteContext` **includes** restricted/private material (the exception is
intentional, so it is pinned); `buildNoteEmail` renders no sender/signature; `NoteSendInput` rejects a
list of recipients.

**coreBridge (two-persona)** — a member is denied every `notes:*` channel; the owner's send writes an
activity row under the **owner** with `recipientPersonId` stamped, and an Inbox entry in the
**recipient's** vault; a send with no `Person.email` still writes the Inbox entry; `notes:recipients`
returns a projection carrying no profile fields.

**RTL** — Step 1 is single-select; compose blocks on an empty intent; the draft renders editable; the
recipient's Inbox entry shows **no sender**.

**E2E (decrypt-level)** — the full walk: pick a person → draft (fake Claude) → preview → send → decrypt
the owner's activity shard and the recipient's Inbox → switch to the recipient and assert the entry shows
no sender → tap an answer → drain → assert the response. Plus a 390px overflow guard on every new surface
and the standing no-inner-scroller assertion.

**Guards verified by reverting** — the first-person check, the no-sender render, and the
Inbox-entry-always-lands behaviour must each be shown to fail when their fix is reverted.

Fakes: `SELFOS_FAKE_CLAUDE`, `SELFOS_FAKE_RESEND`, `SELFOS_FAKE_RELAY`. `SELFOS_FAKE_PROMPT_DIR` asserts
the unfiltered context actually reaches the model.

---

## 11. Open questions

1. **PHQ-9 item 9** — does that single crisis trigger survive the app-wide removal (§8.2)? Independent
   of everything else; ~20 lines either way.
2. **RESOLVED — the pre-existing bugs found during the 2026-08-21 review**, none caused by this feature.
   The first six were fixed before the feature was built ([#553] key rotation, [#555] the rest); the last
   two remain open and belong to their own pass:
   - 🔴 **Key rotation destroys data.** `ROTATION_ROOTS = ['people','config','questionnaires']` omits
     `relationships/`, `together/` and `story/contributions/`, all master-key encrypted. Rotation
     promotes the new key and the old one is gone. Reachable from Settings → Devices. **Owner already
     approved fixing this as part of this work.**
   - 🟠 `peopleList` has no capability gate and returns full `Person` records (`healthNotes`, `faith`,
     `sexualOrientation`, `notes`, `birthday`) to any caller. §5.5 avoids it; it should still be narrowed.
   - 🔴 **The three access WRITES had no gate at all** — found while building, fixed here.
     `accessSaveRole` / `accessSetAccount` / `accessRemoveAccount` checked only that a vault existed, so
     a hand-crafted IPC call could rewrite the role matrix or hand the caller the Owner role, making every
     capability check downstream decorative. Now gated `roles.manage` / `users.manage`, with two
     invariants the ungated version could not hold: nobody may mint a SECOND Owner (there is exactly one,
     minted at setup), and nobody may revoke the first (it would leave the household with no full-access
     role and no way back).
   - 🟠 `EmailSettingsPanel.tsx:180` tells members their tapped responses are _"Only you…"_ while the
     owner activity view shows exactly what was clicked. Already false today.
   - `clickedAt` / `clicks[]` are rendered but written by nothing (this spec wires them).
   - Appearance settings are vault-scoped, so a non-Owner cannot change their own theme.
   - `settingsStore.set` has no `catch`; a rejected write leaves the UI showing an unsaved value.
   - The Inbox's shared-book `openPath` targets a route that does not exist.
   - `resendClient.ts` has no test file.
   - E2E runs in neither CI nor the pre-push hook.
3. **RESOLVED — schedule is not in v1.** See §3.4: nearly free to wire, no use case at single-recipient
   scale, so it is not shipped as an empty control.
4. **Does "Write it myself" still go out as SelfOS?** As built, **yes** — §5.4 applies to both modes, so
   there is exactly one voice on both surfaces and no path that reintroduces a sender. An owner writing in
   their own words may eventually expect their own voice; changing that is a product decision, not a bug.

---

## 12. Changelog

- 2026-08-21 — created. Records fourteen owner decisions taken 2026-08-21: owner-only; single recipient
  chosen first; AI drafts from the complete record including private material; no signal picker; sent as
  SelfOS with no sender; type drives the recipient's affordance; owner sets contact addresses; opens +
  clicks + delivery tracked; Inbox is the record and email the reach layer; AI for informational
  registers with a blank composer for personal ones; no opt-out; no campaign record; crisis system
  removed app-wide; key-rotation fix bundled.
- 2026-08-21 — **BUILT.** Core ([#556] `noteStore`, `noteContext`, `noteDraft`), the seam (the owner gate,
  six channels, the ninth `EmailFamily`, the Inbox provider) and the surface. Two open questions resolved
  against what shipped: **schedule is not in v1** and **"Send a test to me" is not built** (§3.4 — neither
  earns a control at single-recipient scale); "Write it myself" goes out as SelfOS like every other note.
  The six pre-existing defects the design review found landed first ([#553], [#555]). Three more were found
  by **visual QA after the suite was green** — a second note opened on a blank compose step, the person
  row's name and address ran together on one line, and selection read as colour alone (§9); all three are
  fixed and guarded, with the regression test verified to fail against the original component.
