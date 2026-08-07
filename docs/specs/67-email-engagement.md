# 67 — Email engagement & re-engagement (Resend)

> **Status:** **Phases 0–4 Built** (of 7 phases) · _last updated 2026-08-07_
>
> SelfOS's first real outbound email. Today the only "email" is a `mailto:` hand-off for questionnaire
> links — SelfOS has **never actually sent a message**. This spec adds a household-provisioned
> **Resend** sending path and builds a full engagement layer on it: branded questionnaire delivery,
> transactional alerts, a weekly digest, re-engagement nudges, milestone/welcome mails, and the crown
> jewel — an **AI Coach Suggestions** engine that emails genuinely-new, non-repetitive, personalized
> (and, when consented, explicit intimacy) suggestions. Emails are **tap-to-respond** via one-click
> tokens routed through the existing zero-knowledge relay, so a tap is drained + mapped back to a
> `(suggestion, answer)` locally in the encrypted vault and feeds the coach — closing an engagement loop
> without a backend.

This is a **large, foundational** spec delivered in phases (§5). It reuses, rather than duplicates,
established machinery. It builds on and references (DRY — see linked specs rather than restating):
[`00`](00-architecture.md) (vault/IPC/security, main-only secrets + network, the `BridgeHost` + typed
IPC seam), [`08 §13.6`](08-questionnaires.md) (the zero-knowledge Cloudflare relay — token/mailbox/PIN,
mint + drain, the `apps/relay` Worker), [`25`](25-household-ai-credentials.md) (the shared-secret
precedent: a master-key-encrypted `config/*.enc` + a device-override resolver, keys never crossing IPC),
[`35`](35-notification-system.md) (the derived notification kinds this maps to email), [`63`](63-auto-checkins.md)
(the launch/focus cadence + throttle marker + the gap-finder/de-dup/coverage this suggestion engine
reuses), [`06`](06-ai-usage-and-budgets.md) (metering + budget gates), [`40`](40-proactive-coaching.md)
(`aggregateCrisisSignal` + the coaching synthesis), [`53`](53-home-encouragement.md) +
[`60`](60-home-dashboard-redesign.md) (the recommendation providers + activity feed / rings / streaks
that supply digest + suggestion material), the intimacy stack (`packages/core/src/intimacy/*` coverage +
explicit register, the Together Yes/No/Maybe overlap in `packages/core/src/together/*`),
[`42`](42-relationship-scoped-sharing.md)/[`44`](44-memory-dashboard-overhaul.md) (the shared-vs-restricted
data boundary), [`04`](04-people-roles.md) (Owner full-access + capabilities), and
[`19`](19-distribution.md) (macOS-only, unsigned, per-user, **no backend**).

---

## 1. Overview

**The problem.** SelfOS learns a lot and does a lot, but everything happens **inside the app**. If a
person doesn't open it, nothing reaches them — no reminder that a check-in is waiting, no "you're both
up for a date night," no weekly reflection, no nudge back after a quiet week. And the app has **never
sent a real email**: questionnaire "delivery" is a `mailto:` that opens the sender's mail client
(`RelayLinkDelivery.tsx`).

**The feature.** A household connects their **own Resend** account (BYO — a verified sending domain +
an API key). SelfOS then sends real, branded email across eight **families** (§3.2), from transactional
alerts to a weekly digest to AI-authored coaching suggestions. Every non-trivial email is
**tap-to-respond**: its buttons are one-click links that route a tap through the existing
zero-knowledge **relay**; the relay learns only that an opaque token was tapped and when, and on next
app open SelfOS **drains** the taps and maps each back — locally, in the encrypted vault — to a
`(suggestion, answer, timestamp)` that feeds the coach, de-dup, and mutual-green-light logic. There is
**no backend and no always-on scheduler**: immediate emails send while the app is open; scheduled ones
use Resend's native `scheduledAt` (up to 30 days ahead) so they reach a **closed** app, reconciled on
each launch (the [`63`](63-auto-checkins.md) cadence pattern).

**Where it sits.** A new **feature module** (`email`) registering: a Settings → Email panel, an
owner-only Email-activity view, per-person email preferences, a core Resend client (a `BridgeHost`
part), a scheduling/reconcile cadence hook, an AI-suggestion engine, a per-person response store, and
an extension to the relay Worker for one-click taps. It writes to Person-scoped vault files and to the
shared `config/email.enc`; it adds **no** always-running process.

**Explicitly not a substitute for the app.** Email is an engagement surface, not a second product.
Sensitive content is minimized (§8): crisis suppresses **all** email; restricted (trauma/intimacy)
content is never emailed unless explicitly opted in; and the durable rule — never surface that an
owner/admin can see a member's content — governs all member-facing copy.

## 2. Goals / Non-goals

**Goals**

- **Real sending, BYO Resend.** Each household provisions their own Resend account + verified domain +
  API key; SelfOS sends branded HTML email through it. The key lives device-local (`safeStorage`) with
  an optional household-shared, master-key-encrypted copy — the [`25`](25-household-ai-credentials.md)
  posture; the renderer never sees a key value.
- **Boost engagement + re-engagement** across eight families (§3.2): richer questionnaire delivery,
  time-sensitive transactional alerts, a weekly digest, re-engagement nudges, an AI-suggestion engine,
  milestones, and welcome.
- **Never repetitive AI suggestions.** The AI Coach Suggestions engine sends at most **2×/week per
  person, only when genuinely-new data has accrued**, de-dup'd against a persisted sent-suggestion
  history (reusing [`08`](08-questionnaires.md)'s fuzzy + semantic de-dup), one metered Claude call,
  budget-gated, crisis-suppressed, **shared-data-only** for couple suggestions.
- **Tap-to-respond that feeds the coach.** Every interactive email carries one-click tokens through the
  relay; taps drain back into the encrypted vault as responses that drive de-dup, resurface, a
  **mutual green light** ("you're both up for this"), a soft intimacy-inventory-update offer, and a
  more/less tuning signal — all fed into coaching context and an in-app response history.
- **No backend, no always-on scheduler.** Immediate emails send while open; scheduled emails ride
  Resend `scheduledAt`, reconciled on launch/focus with a 24h throttle marker (the [`63`](63-auto-checkins.md)
  pattern).
- **Owner transparency.** A per-person, encrypted **Email-activity log** (sent/delivered/opened/clicked
  - delivery health), surfaced in an **owner-only** Email-activity view with full member visibility —
    consistent with SelfOS's existing Owner full-access model — while member-facing copy never implies
    they're watched.
- **Safe by construction.** Crisis suppresses all email; wellbeing/mood email never carries distress
  content; restricted content is never emailed unless opted; the informed-consent copy states plainly
  that an email inbox is **outside SelfOS's encryption** (permanent plaintext).

**Non-goals (deferred / owned elsewhere)**

- **A hosted/shared sending domain.** BYO Resend only; SelfOS ships no sender account (no backend to
  own one, per [`19`](19-distribution.md)).
- **SMS / push / OS notifications.** Email only. In-app notifications stay [`35`](35-notification-system.md);
  SMS delivery stays the existing `sms:` hand-off.
- **Inbound email parsing** (replying by writing an email back). Interactivity is one-click taps through
  the relay + `selfos://` deep links, not IMAP.
- **A new AI generation/answering engine.** The suggestion engine reuses the gap-finder +
  `generateQuestions` + the intimacy register; the check-in email reuses the [`08`](08-questionnaires.md)
  answer types.
- **A new secret-storage mechanism, a new relay, or a new cadence framework.** All three are reused.
- **Changing who an insight's coaching informs.** Couple suggestions read **shared** data only; the
  cross-person Memory/answer boundaries ([`42`](42-relationship-scoped-sharing.md)/[`44`](44-memory-dashboard-overhaul.md))
  are untouched.

## 3. UX & flows

### 3.1 Settings → Email (connect + configure)

A new **Email** section in Settings (mirroring Settings → Relay, `RelaySettingsPanel.tsx`, and its
registry precedent in `builtins.tsx`). Two tiers of control:

**Household connection (admin-only, `AdminOnlyBadge`).**

1. **Connect Resend** — a write-only API-key field (the `SecretKeyControl` posture, [`25`](25-household-ai-credentials.md)):
   the owner pastes their Resend API key; it is stored (device-local by default, optionally shared —
   §4.1) and **never returned to the renderer**. A **"Test connection"** verifies the key against
   Resend (a non-sending API call — list domains) and reports domain-verification status.
2. **Sending domain + from-address** — the verified domain and the `From:` name/address emails are sent
   as (e.g. `SelfOS <hello@yourfamily.example>`), stored in `config/email.enc` (§4.1). A calm banner
   shows the verification state ("Verified" / "Add these DNS records in Resend, then re-check").
3. **Until Resend is connected, every per-person email toggle shows a calm "Connect Resend to turn this
   on"** (the [`41`](41-discoverability-and-empty-states.md) `AiUnavailableNotice` posture) — never a
   dead toggle.

**Per-person preferences (each person edits their own; §4.2).**

- **"Email me at"** — a **separate, opt-in engagement address** SelfOS sends engagement email to, set by
  the person when they opt into email. It is **distinct from `Person.email`**, which stays the
  delivery-only **contact** address used to send a questionnaire to a recipient (family A). So a person's
  contact address and their engagement-email address can differ, and a person can be a questionnaire
  recipient without ever opting into engagement email. If this field is empty, no engagement email
  (families B–G) is sent to them, even with a family toggle on (fail-closed). The engagement address has
  its **own unsubscribe** (§4.2) independent of the contact address.
- **Per-family opt-in toggles** — one `Switch` per emailable family (§3.2). Sensible defaults
  (transactional + questionnaire-delivery on; digest/re-engagement/AI-suggestions on for the active
  person's own streams; milestones on; intimacy **off**). Turning a family off suppresses that family's
  sends for this person.
- **Content richness** — `Brief` (a teaser + a link into the app) vs `Full` (the full detail in the
  email). Per §"Content posture": _Full_ means richer in-email content **only** for a family the person
  has opted into.
- **Intimacy emails (18+)** — a **distinct** opt-in `Switch` (separate from "adult content enabled in
  the app"), shown only when the person is eligible (§3.5), with **informed-consent copy**: wanting
  explicit content in-app is not the same as wanting it in your inbox; your email inbox is **outside
  SelfOS's encryption** and stays there permanently. Off by default; hard-gated (§8.2).
- **Unsubscribe** — a working one-click unsubscribe token (§4.2) is embedded in every email; the panel
  also exposes a "pause all email" master toggle.

### 3.2 The eight email families

Each family has a **trigger**, **content**, **cadence/scheduling**, and **gating**. Families map to an
`EmailFamily` enum (§4) that drives per-family opt-in, the activity log, and delivery scheduling.

| #         | Family (`EmailFamily`)   | Trigger                                                                                           | Content                                                                                                                                                     | Cadence / delivery                                                                             | Gating                                                                                                     |
| --------- | ------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **A**     | `questionnaire-delivery` | Sender delivers an external (or linked household) questionnaire (upgrades the `mailto:` hand-off) | Branded email: secure relay link + PIN + a friendly note; an optional recipient **reminder** if unanswered                                                  | **Immediate** when app open; reminder **scheduled**                                            | Needs the relay provisioned + a recipient address; the existing [`08`](08-questionnaires.md) send flow     |
| **B**     | `transactional`          | A time-sensitive/other-person notification kind fires (§3.3)                                      | Teaser + a deep link into the app                                                                                                                           | **Immediate** when app open                                                                    | Per-family opt-in; recipient scoping per the source notification                                           |
| **C**     | `digest`                 | Weekly                                                                                            | Insight-of-the-week (coaching synthesis if present), momentum, a life-rings glance, the 14-day activity feed, a jump-back-in CTA. **Deterministic, no AI.** | **Scheduled** weekly — default **Sunday evening, local time**, per-person configurable (§3.2a) | Per-family opt-in; suppressed by crisis                                                                    |
| **D**     | `re-engagement`          | The person is away (no app open in N days) with something waiting                                 | A waiting check-in / a stale goal / a biographer question / a quiet Together pair / a due pulse — one focused nudge                                         | **Scheduled**                                                                                  | Per-family opt-in; suppressed by crisis; rate-limited (never nag)                                          |
| **E**     | `ai-suggestion`          | New data accrued + ≤2/week (§3.4)                                                                 | An AI-authored suggestion (Together-topic + opening line · a check-in to send · a something-to-try · a question to sit with), **tap-to-respond**            | **Scheduled** (≤2/week)                                                                        | Per-family opt-in; budget-gated; crisis-suppressed; new-data-gated; de-dup'd                               |
| **E-int** | `ai-suggestion-intimacy` | Same engine, intimacy slot                                                                        | Explicit, act-specific suggestions built from **shared** intimacy data (§3.5), tap-to-respond                                                               | **Scheduled** (within the E budget)                                                            | ALL of: both 18+-acked · adult enabled · the distinct intimacy-email opt-in · shared-data-only · in-policy |
| **F**     | `milestone`              | A streak / a finished Story book ("ready to read") / a goal reached                               | A short celebration + a link                                                                                                                                | **Immediate** when open (or scheduled next window)                                             | Per-family opt-in                                                                                          |
| **G**     | `welcome`                | First run / a new person joins                                                                    | Orientation + a getting-started CTA                                                                                                                         | **Immediate**                                                                                  | Sent once                                                                                                  |

**Family B — which notification kinds email.** Only the genuinely time-sensitive or **reaches another
person** kinds ([`35`](35-notification-system.md) `NOTIFICATION_KINDS`): `responses-arrived`,
`answers-updated`, `together-invite`, `together-turn` (a teaser only — never the message), `story-shared`,
`auto-checkin-incoming`, and a **new-insight-ready** signal (deferred until such a `NotificationKind`
exists — the other six are the built `EMAILABLE_TRANSACTIONAL_KINDS`). Kinds that are purely
local/housekeeping — `sync-conflict`, `update-available` — **stay in-app** (never email).

**§3.2a Digest cadence.** The weekly digest (family C) defaults to **Sunday evening, in the person's local
time**, and is **per-person configurable** (day + rough time-of-day) in Settings → Email (§3.1). The
chosen day/time drives the `scheduledAt` the reconcile computes for the coming window (§3.4). A person
with the digest family off receives none.

### 3.3 AI Coach Suggestions (family E) — the crown jewel

For each opted-in person, at most **2×/week**, **only when genuinely-new data has accrued** since the
last suggestion email, SelfOS composes one suggestion email with a single metered Claude call and
delivers it (scheduled). Flow:

1. **New-data gate.** A pure `hasNewSuggestionData(input)` (§5.4) is true only if, since the last sent
   suggestion, there are new approved insights, new completed sessions, new intimacy/coverage gaps
   ([`63`](63-auto-checkins.md) coverage), or new pulse/Together signals. No new data → **no email**
   (never "just to send one" — the [`63 §13`](63-auto-checkins.md) lesson).
2. **De-dup against history (per-family).** The candidate suggestion is filtered against the persisted
   **sent-suggestion history** (§4.4) using [`08`](08-questionnaires.md)'s fuzzy + semantic de-dup, so a
   suggestion is **never** a re-phrasing of a recent one, and a response of "not for me" (§3.6) removes
   its subject from future suggestions. The de-dup history + avoid-set are **kept per-family** — the
   intimacy family (`ai-suggestion-intimacy`) and the non-intimacy family (`ai-suggestion`) maintain
   **separate** avoid-sets, so a "not for me" in one never suppresses the other, and each family's
   novelty is judged only against its own history.
3. **One metered call, budget-gated, crisis-suppressed.** The engine runs a single `generateSuggestion`
   Claude call metered under a new `email.suggest` usage type ([`06`](06-ai-usage-and-budgets.md)),
   blocked when over budget, and **skipped entirely under crisis** (`aggregateCrisisSignal.recurring`,
   [`40`](40-proactive-coaching.md)).
4. **Shared-data-only for couples.** A Together/couple suggestion reads **only** shared facts (the exact
   boundary `relationshipSynthesisService` + grounded Together coaching already enforce — never a
   partner's restricted/own-context data). **Both partners each get their OWN copy** (each personalized,
   each de-dup'd against their own history, sharing a stable `sharedSuggestionKey` so a mutual response
   is pairable — §3.6).

**Suggestion types** (one per email; the engine picks by freshest signal):

- **A Together-topic + opening line** — a conversation to have + a first sentence to send (couple; shared-data).
- **A check-in to send** — a small questionnaire idea with **2–3 example questions** (reuses the
  gap-finder + `generateQuestions`), one-tap to send from the email or to open the builder.
- **A something-to-try** — surfaced from the recommendation providers ([`53`](53-home-encouragement.md);
  they already carry person-specific copy + `dismissKey`s).
- **A question to sit with** — a single reflective prompt, tap to react.
- **The gated intimacy suggestion** (E-int, §3.5).

### 3.4 Delivery & scheduling (no backend)

The hard part with no server. Two paths:

- **Immediate (families A/B/F/G):** sent the moment their trigger fires **while the app is open**, via
  `email:send`. If the app is closed when the trigger would fire, the transactional signal is still
  in-app ([`35`](35-notification-system.md)); the email simply isn't sent retroactively (it's a
  time-sensitive nudge, not a log).
- **Scheduled (families C/D/E):** use **Resend's native `scheduledAt`** (up to 30 days ahead) so a
  weekly digest / a re-engagement nudge / an AI suggestion reaches a person even if SelfOS is **never
  opened** in the interim. While the app is open, a cadence hook **enqueues the coming window** and
  **reconciles**: cancel any now-obsolete scheduled email (Resend cancel), schedule the newly-due ones.

**The cadence hook** `useEmailScheduler()` (the [`63`](63-auto-checkins.md) `useAutoCheckins` /
[`39`](39-living-memory-continuity.md) `useMemoryReconcile` template exactly): fires on **launch +
`focus` + `visibilitychange`**, a device-local **24h per-person throttle marker**
(`DeviceState.emailScheduledAt`), re-arm on active-person change. Each run: (1) **poll Resend for status**
of recently-sent emails via its email-retrieval API — **no webhook, no backend** — recording
`delivered`/`opened`/`bounced`/`complained` into the activity log (this is what fills the owner view's
"Opened" column, §3.7, and informs re-engagement, §3.2 D); (2) **drain tapped tokens** into responses
(§3.5); (3) **reconcile the schedule** — compute what C/D/E should be scheduled for the coming window,
cancel obsolete, schedule new. There is **NO always-on scheduler** — `scheduledAt` is what bridges the
closed-app gap; the app only ever _polls + reconciles_ when open.

### 3.5 Interactive layer — tap-to-respond

Email buttons are **links** (email clients don't run JS), so every interactive button is a **unique,
opaque one-click token URL** pointing at the zero-knowledge relay: `<relay>/t/<token>`. Tapping it:

- The relay records only **that token `T-xxxx` was tapped, and when** — it never learns the suggestion,
  the answer's meaning, or the person (the [`08 §13.6`](08-questionnaires.md) zero-knowledge posture).
- On next app open, `useEmailScheduler` **drains** tapped tokens (like it drains questionnaire
  responses) and maps each **locally** (§4.5) back to a `(suggestion, answer, timestamp)` in the
  encrypted vault.

A tap is a `GET` (a bare link the email client follows), so it's **no-PIN / one-click** and recording it
is a state change. **Accepted risk:** a mail-client link prefetch (Gmail proxy, Outlook SafeLinks) could
record a tap with no user intent — the spec deliberately chose one-click for these low-stakes signals;
recording is idempotent (first-tap-wins), and a mistaken response is editable in the in-app history.

Because it rides the relay, **interactive emails REQUIRE the relay provisioned** — exactly like external
questionnaire delivery (family A). A plain email (a digest with only a "open SelfOS" link) does not.
There is also a **same-Mac fast path**: a `selfos://` deep-link button; when clicked on the machine
running SelfOS, it's logged locally with no relay round-trip.

**Four interactive elements** (all in scope):

1. **Intimacy reactions** — on an E-int suggestion: e.g. _I'm game_ / _Maybe later_ / _Not for me_.
2. **AI-suggestion reactions** — same three on any E suggestion.
3. **An embedded one-question check-in** — tappable answer options (multiple-choice / scale / yes-no;
   **free-text opens the app**). This can **deliver an auto check-in** ([`63`](63-auto-checkins.md)) as a
   one-tap email — the answer drains back and is analyzed exactly as an in-app answer.
4. **A more/less tuning signal** — _more like this_ / _less like this_, training the suggestion engine
   (§3.6).

### 3.6 What taps do — the response loop

A drained tap becomes an `EmailResponse` (§4.5) and feeds five things:

- **De-dup** — a _Not for me_ removes that subject from future suggestions (added to the avoid-set the
  §3.3 de-dup reads).
- **Resurface** — a _Maybe later_ returns the subject in a few weeks (a scheduled resurface).
- **Mutual green light** — when **both** partners tap _I'm game_ on the **same** shared suggestion
  (matched by `sharedSuggestionKey`), SelfOS surfaces **"you're both up for this"** to both — in
  Together and/or the next email.
- **Intimacy responses are a soft signal** — they feed suggestions/context/de-dup **and offer, in-app**,
  to update the intimacy inventory / Yes-No-Maybe overlap (`packages/core/src/intimacy/*`,
  `packages/core/src/together/*`) — **never silently overwriting** (an explicit in-app confirm).
- **More/less tuning** — trains the suggestion engine's weighting.

**Response history (in-app).** Each person has an in-app **"Your email responses"** history — they see
only their own, and can **edit** an entry (the [`44`](44-memory-dashboard-overhaul.md) editable-memory
posture). Sensitive responses are stored at the `restricted`/`intimacy` tier, own-context by default,
partner-shared only via the existing sharing model. All responses feed general AI coaching context.

### 3.7 Owner Email-activity view

An **owner-only Email-activity subsection of Settings → Email** (not a top-level nav entry), carrying the
`AdminOnlyBadge`, with **full visibility for all members** — consistent with SelfOS's existing Owner
full-access model (the Owner already sees members' restricted Memory facts,
[`44`](44-memory-dashboard-overhaul.md)). It shows every sent email's **family, subject, recipient, exact
content, exactly what was clicked, and sent/delivered/opened/clicked timestamps** (the "opened" column is
filled by the Resend status poll, §3.4), plus delivery health (bounces/complaints), filterable by
member / family / date, and **exportable**.

- **Member-facing copy never implies they're watched** (the durable rule): a member's own Settings and
  emails say nothing about owner visibility.
- **An optional intimacy carve-out (deferred, default OFF).** **Full visibility is the shipped default**
  (the owner confirmed "everything"): the Owner sees intimacy-family content like any other family. A
  future opt-in (deferred, not built in v1) could let a cautious owner narrow their _own_ view — show
  intimacy content only when the Owner is one of the two partners, else a count-only summary — but it is
  never a member-facing disclosure and the default stays full.

## 4. Data model (vault files & schemas)

All reads/writes go through the vault service (no direct `fs`); all schemas are **Zod** (source of
truth, `z.infer` for types). Person-scoped data is encrypted per-person; the household config is
encrypted under the master key. New IPC view types (renderer-safe, secret-free) live in
`@selfos/core/schemas` (the `RelayStatus` / `AiKeyStatus` precedent).

### 4.1 Household email config — `config/email.enc` (new)

Encrypted under the master key (the `config/relay.enc` / `config/ai-credentials.enc` precedent — the
cloud only ever holds ciphertext; read host-side only, never crossing IPC).

```ts
export const EmailConfigSchema = z.object({
  schemaVersion: z.literal(1),
  sendingDomain: z.string().optional(), // the verified Resend domain
  fromAddress: z.string().optional(), // e.g. hello@yourfamily.example
  fromName: z.string().optional(), // e.g. "SelfOS"
  domainVerified: z.boolean().default(false),
  /** The household-shared Resend key (like relay.enc's cloudflare token) — plaintext INSIDE the encrypted
   *  envelope; a device-local `resend.apiKey` override always wins (25 §4.4). Absent ⇒ no shared key. */
  resendApiKey: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

/** Renderer-safe status (no key value) for Settings → Email. */
export const EmailStatusSchema = z.object({
  configured: z.boolean(),
  domainVerified: z.boolean(),
  sendingDomain: z.string().optional(),
  fromAddress: z.string().optional(),
  hasSharedKey: z.boolean(),
  hasDeviceOverride: z.boolean(),
  resolvedReady: z.boolean(),
  source: z.enum(['device', 'shared', 'none']),
});
export type EmailStatus = z.infer<typeof EmailStatusSchema>;
```

- The Resend key is resolved host-side by a **`resolveResendKey(secrets, fs, key)`** (the
  [`25`](25-household-ai-credentials.md) `resolveKey` sibling): device-local `resend.apiKey`
  (`RESEND_API_KEY_ID`, `safeStorage`, exactly like `openai.apiKey`) → the shared `resendApiKey` in
  `config/email.enc` → none. **The value never reaches the renderer** (booleans-only `EmailStatus`).

### 4.2 Per-person email preferences — `people/<id>/email/prefs.enc` (new)

```ts
export const EmailFamilySchema = z.enum([
  'questionnaire-delivery',
  'transactional',
  'digest',
  're-engagement',
  'ai-suggestion',
  'ai-suggestion-intimacy',
  'milestone',
  'welcome',
]);
export type EmailFamily = z.infer<typeof EmailFamilySchema>;

export const EmailPrefsSchema = z.object({
  schemaVersion: z.literal(1),
  /**
   * The SEPARATE, opt-in engagement address SelfOS sends engagement email (families B–G) to — set by the
   * person when they opt in. DISTINCT from `Person.email`, which stays the delivery-only CONTACT address
   * used to send a questionnaire to a recipient (family A). Absent ⇒ no engagement email is sent (fail-
   * closed), even with a family toggle on. Has its own `unsubscribeToken` (below), independent of the
   * contact address, so unsubscribing from engagement email never affects being a questionnaire recipient.
   */
  address: z.string().optional(),
  /** Per-family opt-in. Absent family ⇒ its default (transactional/questionnaire/digest/etc. on; intimacy off). */
  families: z.record(EmailFamilySchema, z.boolean()).default({}),
  /** Richer in-email detail when 'full' (§ content posture); 'brief' teasers + a link otherwise. */
  richness: z.enum(['brief', 'full']).default('brief'),
  /** The DISTINCT intimacy-email opt-in (§3.1/§8.2) — never inferred from in-app adult settings. */
  intimacyEmailOptIn: z.boolean().default(false),
  /** Global pause (the master unsubscribe). */
  paused: z.boolean().default(false),
  /** Opaque one-click unsubscribe token embedded in every email. */
  unsubscribeToken: z.string().min(1),
  updatedAt: z.string().datetime().optional(),
});
export type EmailPrefs = z.infer<typeof EmailPrefsSchema>;
```

Conservative defaults (fail-closed: intimacy off; an absent/corrupt prefs file ⇒ no sends). The `families`
defaults are applied by a helper, not the schema, so the effective-default is one source of truth.

### 4.3 Email activity log — `people/<id>/email/activity/<yyyy-mm>.enc` (new, sharded)

Monthly shards (the `usageStore` precedent). Owner-visible (§3.7); the person's own reads see their own.

```ts
export const EmailDeliveryStatusSchema = z.enum([
  'queued',
  'scheduled',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'failed',
  'canceled',
]);

export const EmailActivityEntrySchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  personId: z.string().min(1),
  family: EmailFamilySchema,
  subject: z.string(),
  toAddress: z.string(),
  resendMessageId: z.string().optional(), // Resend's id, for status polling + cancel
  scheduledAt: z.string().datetime().optional(),
  status: EmailDeliveryStatusSchema,
  sentAt: z.string().datetime().optional(),
  deliveredAt: z.string().datetime().optional(),
  openedAt: z.string().datetime().optional(),
  clickedAt: z.string().datetime().optional(),
  /** Per-token click records drained from the relay (§4.5) — the "exactly what was clicked" (§3.7). */
  clicks: z.array(z.object({ token: z.string(), at: z.string().datetime() })).default([]),
  /** The interactive tokens minted into this email (so the owner view + drain can resolve them). */
  tokens: z.array(z.string()).default([]),
  /** Encrypted rendered content snapshot for the owner view ("each email's content", §3.7). */
  contentSnapshotPath: z.string().optional(), // people/<id>/email/content/<id>.enc
});
export type EmailActivityEntry = z.infer<typeof EmailActivityEntrySchema>;
```

### 4.4 Sent-suggestion history — `people/<id>/email/suggestions/<id>.enc` (new)

Drives the E de-dup + mutual green light. `text` is the fuzzy/semantic de-dup key; `sharedSuggestionKey`
pairs a couple suggestion's two copies.

```ts
export const SentSuggestionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  family: z.enum(['ai-suggestion', 'ai-suggestion-intimacy']),
  suggestionType: z.enum([
    'together-topic',
    'check-in',
    'something-to-try',
    'question-to-sit-with',
    'intimacy',
  ]),
  text: z.string(), // for de-dup (08 fuzzy + semantic)
  subjectKey: z.string().optional(), // a normalized subject (e.g. an intimacy act key) for avoid-set removal
  partnerPersonId: z.string().optional(), // couple suggestion
  sharedSuggestionKey: z.string().optional(), // both partners' copies share this — mutual green light pairing
  tokens: z.array(z.string()).default([]), // the interactive tokens minted for it
  sentAt: z.string().datetime(),
});
export type SentSuggestion = z.infer<typeof SentSuggestionSchema>;
```

### 4.5 Interactive tokens + responses (new)

- **Token map** — `people/<id>/email/tokens/<token>.enc`, mapping an opaque relay token back to what a
  tap means (the relay never sees this):

  ```ts
  export const EmailTokenSchema = z.object({
    token: z.string().min(1),
    schemaVersion: z.literal(1),
    interactionId: z.string().min(1), // groups the option-set tokens minted for ONE email (a tap spends its siblings)
    family: EmailFamilySchema,
    suggestionId: z.string().optional(),
    questionId: z.string().optional(), // for an embedded check-in
    kind: z.enum(['reaction', 'intimacy-reaction', 'checkin-answer', 'tuning']),
    answer: z.string(), // 'im-game'|'maybe-later'|'not-for-me'|'more'|'less'|<value>
    sharedSuggestionKey: z.string().optional(), // carried through for mutual green light
    mintedAt: z.string().datetime(),
  });
  ```

- **Responses** — `people/<id>/email/responses/<id>.enc`, produced on drain (a tapped token → a response):

  ```ts
  export const EmailResponseSchema = z.object({
    id: z.string().min(1),
    schemaVersion: z.literal(1),
    family: EmailFamilySchema,
    suggestionId: z.string().optional(),
    questionId: z.string().optional(),
    kind: z.enum(['reaction', 'intimacy-reaction', 'checkin-answer', 'tuning']),
    answer: z.string(),
    sensitivity: z.enum(['standard', 'restricted', 'intimacy']).default('standard'),
    respondedAt: z.string().datetime(),
    source: z.enum(['relay-tap', 'deep-link']),
    edited: z.boolean().default(false), // in-app edited (44 posture)
  });
  ```

### 4.6 Device-local throttle marker (additive)

`DeviceState` gains an additive-optional `emailScheduledAt?: z.record(z.string(), z.string())` (per-person
id → ISO), mirroring `autoCheckinCheckedAt` / `memoryReconcileCheckedAt`. **Device-local, does not sync.**

### 4.7 Relay Worker extension (one-click taps)

The `apps/relay` Worker + `packages/core/src/relay/relayMailbox.ts` gain a **one-click tap** op: a
`GET /t/<token>` records `tapped:<token> = <iso>` in KV and returns a friendly "Got it — open SelfOS to
see it" HTML page; a drain-secret-authed `drainTaps(tokens)` returns the tapped set + timestamps; `purge`
clears them (purge-on-drain). This is a **new Worker route**, so it **bumps `RELAY_VERSION`** and requires
a re-deploy/update (the [`08`](08-questionnaires.md) precedent — the Settings → Relay "Update relay"
button). The relay still stores **only** ciphertext + opaque tap markers (it never learns a token's
meaning).

### 4.8 What is reused unchanged

The relay crypto/mailbox ([`08`](08-questionnaires.md)), the `Question`/`Assignment`/`ResponseSet`/`Insight`
schemas ([`08`](08-questionnaires.md)/[`09`](09-session-analysis.md)), the intimacy coverage + explicit
register + YNM overlap, the recommendation providers + activity feed / rings / streaks
([`53`](53-home-encouragement.md)/[`60`](60-home-dashboard-redesign.md)), the coaching synthesis + crisis
signal ([`40`](40-proactive-coaching.md)), budgets ([`06`](06-ai-usage-and-budgets.md)), the notification
kinds ([`35`](35-notification-system.md)), and `Person.email`.

## 5. Architecture & modules

A new **feature module** `email` — mostly orchestration over existing machinery. Implementation is
**phased** (below). All schemas are additive; no existing `schemaVersion` bumps beyond the new files' own.

### 5.1 The Resend client — a `BridgeHost` part (`email.send`)

A new host part on `BridgeHost` (the `checkForUpdate` / `image` precedent — a network primitive wired to
`globalThis.fetch` in `ipc.ts`, with a `SELFOS_FAKE_RESEND` offline fake so tests never hit Resend):

```ts
// BridgeHost gains:
email: {
  /** Send (or schedule) one email via Resend. `scheduledAt` uses Resend's native scheduling (≤30 days). */
  send(input: EmailSendInput): Promise<EmailSendResult>;         // { id } | { error }
  /** Cancel a previously-scheduled Resend email. */
  cancel(messageId: string): Promise<void>;
  /** Poll delivery status for sent/scheduled messages (Resend email retrieval — no webhook). */
  status(messageIds: string[]): Promise<EmailStatusPoll[]>;
  /** Verify the API key + list verified domains (the "Test connection"). */
  verify(): Promise<EmailVerifyResult>;
}
```

The resolved Resend key is read host-side (`resolveResendKey`) in the bridge and passed to `email.send`;
it **never crosses to the renderer**. On iOS/web hosts (`webHost`), `email.send` is a native-fetch or fake
implementation (the `browserImageClient` precedent) — desktop is the first target.

### 5.2 Core services (`@selfos/core`)

- **`emailConfigService`** (`apps/desktop/src/shared/email/emailConfig.ts`, the `relayConfig.ts` sibling):
  read/write `config/email.enc` + `resolveResendKey` + `emailStatusOf` (the renderer-safe status).
- **`emailPrefsService`**: read/write `people/<id>/email/prefs.enc`; `effectiveFamilyEnabled(prefs,
family)`; `ensureUnsubscribeToken`.
- **`emailComposer`** (`packages/core/src/email/`): pure builders that render each family's **HTML** (+ a
  plaintext alt) from structured inputs — deterministic for C/D/F/G, AI-fed for E. Emits the interactive
  token URLs. Alt text on every image; **no reliance on inline SVG** (§9).
- **`emailSendService`**: the send-and-log orchestrator — gate on config + per-person prefs + `paused` +
  crisis; render via `emailComposer`; `email.send`; write an `EmailActivityEntry` + a content snapshot;
  mint + persist any `EmailToken`s. One place that every family routes through, so logging + gating can't
  be bypassed.
- **`emailSchedule`**: the C/D/E reconcile (`reconcileEmailSchedule`) — compute the coming window's due emails, diff against
  the activity log's `scheduled` entries, `email.cancel` obsolete + `email.send` (with `scheduledAt`) new.
- **`emailSuggestionService`** (family E): `hasNewSuggestionData` (the new-data gate) → gap-finder /
  synthesis / recommendation inputs → one metered `generateSuggestion` Claude call → de-dup against the
  **per-family** `SentSuggestion` history ([`08`](08-questionnaires.md) fuzzy + semantic; the intimacy and
  non-intimacy families keep separate avoid-sets, §3.3) → persist a `SentSuggestion` + schedule the email.
  Couple suggestions read **shared** facts only and emit both partners' copies with a shared
  `sharedSuggestionKey`. Intimacy slot gated by §8.2.
- **`emailResponseService`**: `drainEmailTaps` (drain the relay tap markers, map each token → an
  `EmailResponse` via the token map, purge) + `recordDeepLinkTap`; the mutual-green-light matcher
  (both partners' `im-game` on one `sharedSuggestionKey`); the de-dup avoid-set + resurface scheduler; the
  intimacy-inventory-update **offer** (never a silent write).

### 5.3 Renderer

- **`emailStore`** (Zustand) — config/status + per-person prefs + the activity/response reads; **reset on
  active-person change** (the per-person-state rule).
- **`useEmailScheduler()`** cadence hook in `AppShell` (§3.4), alongside the other cadence hooks.
- **Settings → Email panel** (`EmailSettingsPanel`) — admin connect (§3.1) + per-person prefs (incl. the
  separate "Email me at" engagement address, §4.2, and the digest day/time, §3.2a); the intimacy opt-in
  with informed-consent copy; the "Connect Resend to turn this on" empty state.
- **Owner Email-activity subsection** (`EmailActivityView`) — an admin-only subsection **within the
  Settings → Email panel** (not a top-level nav entry), `AdminOnlyBadge`, filter/export (§3.7).
- **In-app "Your email responses" history** (`EmailResponses`) — own-only, editable (§3.6); plus the
  intimacy-inventory-update offer surface + the mutual-green-light "you're both up for this" surface (in
  Together and/or Home).
- **Family A** — `RelayLinkDelivery.tsx` gains a real **"Send email"** (Resend) path beside the existing
  `mailto:` (which stays as a fallback when Resend isn't connected).

### 5.4 IPC / bridge

Full typed seam per the 6-step recipe (channels → `coreBridge` Zod-validated + gated → `ipc` host →
preload → renderer store; + the `test-utils/bridge` mock). Active-person-scoped in the bridge (the trust
boundary); admin-gated for household config + the owner-activity read (§6). The Resend key is read
host-side and never returned.

### 5.5 Capability

Register **`email.own`** (Member default on — governs a person's own prefs + own responses/activity) and
gate the **household connect** + the **owner Email-activity view** on `settings.manage` / `people.manage`
(owner). Not `EXPLICIT_GRANT_ONLY`.

### 5.6 Implementation phases

Small, methodical, each green-gated with tests + visual QA (CLAUDE.md §6). Each phase is independently
valuable.

- **Phase 0 — Infra + connect + the first send (family G).** The `email` `BridgeHost` part +
  `SELFOS_FAKE_RESEND`; `config/email.enc` + `resolveResendKey`; device-local `resend.apiKey`; the
  booleans-only `EmailStatus` seam; Settings → Email **connect** (admin) + the "Connect Resend…" empty
  state; `EmailPrefs` + per-person prefs UI; `emailSendService` + the activity log; **family G welcome**
  as the pipeline proof. **E2E:** connect via the fake → send a welcome → decrypt an `EmailActivityEntry`.
- **Phase 1 — Family A (real questionnaire delivery). BUILT.** Upgraded `RelayLinkDelivery` from `mailto:`
  to a real Resend send (link + PIN) when the household email is connected + ready, keeping the `mailto:`
  fallback otherwise. The optional recipient reminder was **deferred to Phase 3** (where the scheduling/
  cancel substrate is built) — an owner-confirmed decision. Reuses the relay flow.
- **Phase 2 — Family B (transactional). BUILT.** Maps the §3.2 emailable notification-kind subset
  (`EMAILABLE_TRANSACTIONAL_KINDS`) to immediate sends when the app is open, one teaser per fresh candidate,
  via `sendTransactionalEmail` (routes through `sendFamilyEmail` — engagement address + `transactional`
  opt-in + pause; **not** crisis-suppressed per §7; idempotent on `sourceKey` = the notification's
  `coalesceKey#signature`). The §3.2-named **`new-insight-ready`** signal is **deferred** (no such
  `NotificationKind` exists yet — owner-confirmed). Driven by the `useEmailTransactional` cadence hook.
- **Phase 3 — Scheduling substrate + families C (digest) + D (re-engagement). BUILT.** `emailSchedule` +
  `useEmailScheduler` (reconcile via `scheduledAt`/cancel; poll delivery status); the deterministic
  digest builder; the re-engagement nudges; the family-A recipient reminder deferred from Phase 1 (§3.2)
  is now built.
- **Phase 4 — Interactive layer. BUILT.** The relay Worker `/t/<token>` tap extension (idempotent
  first-tap-wins, no PIN) + drain-secret-authed `POST /api/admin/drainTaps` (**`RELAY_VERSION` bumped 2→3**
  — an existing deploy must be re-deployed); token mint/drain/map (`emailResponse.ts` —
  `mintEmailToken`/`drainEmailTaps` map a tap → an `EmailResponse` in the vault, consume every sibling token
  sharing an `interactionId`, and TTL-prune stale tokens); the reconcile drains taps at step 0; a `pause`
  reaction one-click-unsubscribes the re-engagement family; the in-app response history (own-only, editable,
  in Settings → Email). **Deferred to Phase 5:** the embedded one-question check-in / auto-checkin delivery,
  the `EmailResponse` → `buildContext` coaching wiring, and the richer tap effects (resurface, de-dup
  avoid-set, more/less tuning) beyond the built `pause`. Accepted risk (§3.5): `GET /t/` is a destructive
  side effect a mail-client link prefetch could trigger — the spec chose one-click/no-PIN for low-stakes
  signals.
- **Phase 5 — Family E (AI Coach Suggestions) + E-int (intimacy).** `emailSuggestionService` (new-data
  gate, de-dup, one metered call, shared-data-only couples, both-partners' copies); mutual green light;
  the intimacy family (all gates + the inventory-update offer); more/less tuning.
- **Phase 6 — Owner Email-activity view + delivery health + family F (milestones).** The full owner view
  (filter/export), delivery-health (bounces/complaints via status polling), and milestone/celebration
  emails.

## 6. IPC / API contracts

Renderer ↔ main only through the typed seam ([`00 §6.1`](00-architecture.md)); inputs Zod-validated;
active-person-scoped in the bridge. **No channel ever returns the Resend key.**

- **`email:status` → `EmailStatus`** — host-side, from `resolveResendKey` + config; booleans + enums only.
- **`email:setConfig({ sendingDomain?, fromAddress?, fromName? })` / `email:setSharedKey({ value })` /
  `email:clearSharedKey`** — **owner-gated** (`settings.manage`), enforced in the bridge (not the UI). The
  key value crosses renderer→main only to be sealed into `config/email.enc`; never returned, never logged.
- **`email:verify` → `EmailVerifyResult`** — the "Test connection" (verify key + list domains).
- **`email:getPrefs` / `email:setPrefs(patch)` → `EmailPrefs`** — gated `email.own`, active-person-scoped;
  an intimacy opt-in is coerced off if the person is ineligible (§8.2).
- **`email:send(EmailSendInput)` → `EmailSendResult`** — an internal-facing op the send services call;
  gated `email.own`; runs `emailSendService` (config + prefs + crisis gate → render → `email.send` → log).
- **`email:scheduleReconcile({ auto })` → `EmailReconcileResult`** — the cadence op (§3.4): status poll +
  tap drain + schedule reconcile; `auto:true` applies the 24h throttle + stamps `emailScheduledAt`.
- **`email:activity({ personId?, family?, from?, to? })` → `EmailActivityEntry[]`** — the owner view read,
  **admin-gated** (`people.manage`) for another person; a member reads only their own.
- **`email:responses` → `EmailResponse[]`** / **`email:editResponse` / `email:updateInventoryFromResponse`**
  — the in-app history (own-only) + the explicit intimacy-inventory-update offer.
- **Relay tap drain** rides the existing relay transport (drain-secret authed): the bridge calls
  `drainEmailTaps` during `email:scheduleReconcile`; no new renderer channel.

**Claude usage.** Family E's `generateSuggestion` is one metered call under a new **`email.suggest`**
usage type ([`06`](06-ai-usage-and-budgets.md); admin cost visibility is unchanged — the usage dashboard
already breaks down by type); budget-gated + crisis-suppressed. C/D/F/G are deterministic (no AI).

## 7. States & edge cases

- **Resend not connected** → every per-person toggle shows "Connect Resend to turn this on"; no send is
  attempted; family A falls back to the existing `mailto:` (never a dead end).
- **Relay not provisioned** → **interactive** emails aren't sent (or send a non-interactive variant with
  an "open SelfOS" link) with a hint to connect a relay in Settings → Relay; plain emails still send. Same
  as [`63`](63-auto-checkins.md)/[`08`](08-questionnaires.md) — never silently invisible.
- **Domain unverified** → sends fail at Resend; the activity log records `failed`; Settings shows the DNS
  banner. No retries that could spam.
- **App closed at trigger time (immediate families)** → the in-app signal remains ([`35`](35-notification-system.md));
  the email isn't sent retroactively.
- **App never opened for weeks (scheduled families)** → the pre-scheduled `scheduledAt` emails still
  arrive (the whole point); on next open, the reconcile catches up (one window, not N batches — the
  [`63 §3.4`](63-auto-checkins.md) "once per launch" rule).
- **Over budget (family E)** → no suggestion generated/scheduled; retry next window; admin sees the spend.
- **Crisis** (`aggregateCrisisSignal.recurring`) → **all** email suppressed (C/D/E/F), the cadence stamps
  nothing, retry when the signal clears. Never overridden by a family toggle (§8).
- **No new data (family E)** → **no email** (§3.3). Silence is correct.
- **De-dup exhausts ideas** → no suggestion that window; the engine backs off (never an empty/repetitive
  send).
- **A tapped token that maps to nothing** (a stale/expired suggestion, a deleted token) → dropped on
  drain, logged, never crashes.
- **Both partners tap different answers / one taps twice** → mutual green light fires only on a matched
  pair of `im-game`; duplicate taps are idempotent on the token id.
- **Person deleted** → their email prefs/activity/responses/tokens/suggestions go with `deletePerson`;
  any scheduled Resend emails to them are canceled on the next reconcile (or expire).
- **Relay Worker not updated** to the tap version → `GET /t/<token>` 404s; the Settings → Relay "Update
  relay" prompt shows; interactive emails degrade to non-interactive until updated (the [`08`](08-questionnaires.md)
  stale-Worker lesson — bump `RELAY_VERSION`).
- **Sync conflict on `config/email.enc` / `email/prefs.enc`** → the standard [`00 §4.3`](00-architecture.md)
  conflict banner; last-write-wins on the small human-edited config; the throttle marker is device-local
  (never conflicts).
- **Corrupt/absent files** → prefs absent ⇒ no sends (fail-closed); a corrupt config ⇒ status `none`
  (never send on a parse error); a corrupt activity shard is quarantined, never crashes the view.
- **Migration** — all new files; no existing-schema migration. Additive `DeviceState.emailScheduledAt`.

## 8. Safety

This feature **sends a person's wellbeing-adjacent content to an unencrypted inbox and can reach another
human unprompted**, so the safety envelope is central.

### 8.1 Not-medical + crisis

Emails carry the standard wellness/not-medical framing ([`05 §7`](05-conversations.md)). **Crisis
suppresses the scheduled/AI families C/D/E/F** (§7): `aggregateCrisisSignal.recurring` → no digest, no
re-engagement, no suggestion, no milestone. The **transactional (B)** and **questionnaire-delivery (A)**
families are time-sensitive relays of an existing in-app signal and are **not** crisis-suppressed.
**Wellbeing/mood email never carries distress content** — a mood dip routes the
person to **in-app** support ([`40`](40-proactive-coaching.md)/[`51`](51-wellbeing-reflections.md) crisis
routing), **never** an email about a crisis. Email is never a crisis-routing channel.

### 8.2 Intimacy — gated, shared-data-only, in-policy

An E-int email is sent **only** when **all** hold: both partners have completed the 18+ ack
([`16 §8.3`](16-guided-sessions.md)), adult content is enabled, the recipient has the **distinct
intimacy-email opt-in** on (§3.1 — wanting explicit content in-app ≠ wanting it in the inbox), the
suggestion is built from **shared** intimacy data only (a MUTUAL "into it/curious" signal from the
inventory ratings + YNM overlap + sessions/Together — `packages/core/src/intimacy/*`,
`packages/core/src/together/*`), and it respects the same **consensual-adult / in-policy** boundary the
app's explicit register already enforces (never minors / real non-consent / illegal; taboo only as
fantasy/roleplay — [`08 §16.5`](08-questionnaires.md)/[`48`](48-intimacy-guided-sessions.md)). Re-checked
against the live relationship graph + acks every run (a partner→ex change or a removed opt-in revokes it
immediately). Intimacy responses are stored at the `restricted`/`intimacy` tier.

### 8.3 Restricted content, the inbox, and informed consent

- **Restricted (trauma/intimacy break-glass) content is never emailed** unless explicitly opted in.
- **The email inbox is outside SelfOS's encryption** — permanent plaintext on a third-party mail
  provider. The informed-consent copy for the intimacy family (and any richer sensitive content) states
  this plainly before the person opts in.
- **Content richness** (`full`) surfaces full detail **only** for a family the person opted into; a
  not-opted-in family never receives detail.

### 8.4 The durable "never surface owner access" rule

No **member-facing** copy — in Settings, in any email, in the response history — may state or imply that
a household owner/admin can see the member's content, answers, or activity (CLAUDE.md §1). The Owner
Email-activity view (§3.7) is real (Owner full-access), but it is **owner-facing only**; members are
never told they're watched. The deferred, default-OFF intimacy carve-out (§3.7) exists precisely to let a
cautious owner narrow their own view — it is never a member-facing disclosure.

### 8.5 Secret handling

The Resend key is a secret of the same class as the Claude/relay secrets: device-local by default,
optionally master-key-encrypted in the vault, **never returned to the renderer, never logged**
([`00 §6.2`](00-architecture.md)/[`25 §8`](25-household-ai-credentials.md)). The relay stays
zero-knowledge — a tap marker is an opaque token + a timestamp; the token→meaning map lives only in the
encrypted vault.

## 9. Accessibility

- **In-app** surfaces (Settings → Email, the owner Email-activity view, the response history) defer to
  [`01`](01-design-system.md): keyboard-operable, visible focus, ≥44px targets, semantic
  `Switch`/`Select`/labels, the `AdminOnlyBadge` (text+icon, never colour-alone), responsive ~360px→desktop
  with no horizontal overflow (CLAUDE.md §12). Icons are **lucide-react** (the app's icon language).
- **Emails** are HTML with a plaintext alternative, semantic headings, sufficient contrast, and **alt
  text on every image**. Note the medium difference: **email clients (Gmail/Outlook) strip inline SVG**,
  so where the in-app UI uses lucide-react SVG, the email uses **PNG renders of the same lucide icons**
  (lucide is the icon language, rendered per medium). Interactive buttons are real links with descriptive
  text (a tap target, not an icon alone). Reduced-motion is moot in email (no animation).

## 10. Testing strategy

Vault is exercised against `memFileSystem` (real crypto); Resend is the injectable **`SELFOS_FAKE_RESEND`**
fake (deterministic, offline — the `SELFOS_FAKE_UPDATE`/`SELFOS_FAKE_IMAGE`/`SELFOS_FAKE_RELAY`
precedent); the relay is the existing `SELFOS_FAKE_RELAY`; Claude is the existing fake (imperfect by
default, [`37`](37-ai-output-robustness.md)). Per DoD, E2E covers every new surface + the responsive
guards. The approved mockup is the visual contract (referenced conceptually).

**Unit (core / bridge over the fake host):**

- **New-data gate** — `hasNewSuggestionData` true only with genuinely-new insights/sessions/coverage/pulse
  since the last suggestion; false otherwise.
- **De-dup (per-family)** — a candidate re-phrasing a recent `SentSuggestion` is dropped (fuzzy +
  semantic); a `not-for-me` subject is removed from that family's avoid-set; assert the intimacy and
  non-intimacy avoid-sets are **independent** (a suppression in one doesn't affect the other).
- **Cadence throttle** — `email:scheduleReconcile({auto})` stamps only on a run that actually
  scheduled/spent; a same-day second launch no-ops; `auto:false` skips the throttle.
- **`scheduledAt` reconcile** — computes the coming window (digest at the person's configured day/time,
  default Sunday evening local), cancels obsolete, schedules new; idempotent across re-runs.
- **Status poll** — the reconcile polls Resend (fake) for recently-sent emails and records
  `delivered`/`opened`/`bounced` into the activity log (fills the "opened" column; no webhook).
- **Token loop** — mint tokens → simulate a relay tap → `drainEmailTaps` maps each back to the right
  `EmailResponse` (decrypt-level) → purge; a stale/unknown token is dropped.
- **Mutual green light** — both partners' `im-game` on one `sharedSuggestionKey` fires "you're both up
  for this"; a single tap / mismatched answers does not.
- **Owner-activity read** — an owner reads any member's entries; a member reads only their own (bridge
  scoping); the `resendMessageId`/status/clicks round-trip.
- **`resolveResendKey`** — device override → shared → none; `EmailStatus` carries **no** key value.
- **Config/prefs** — round-trip; fail-closed on corrupt/absent; effective per-family defaults; unsubscribe
  token minted once.

**Component (RTL):**

- **Settings → Email** — connect (admin) writes config/key; the "Connect Resend…" empty state when
  unconfigured; per-person prefs persist; the intimacy opt-in shows the informed-consent copy + is hidden
  when ineligible; a non-admin sees no connect controls.
- **Owner Email-activity view** — `AdminOnlyBadge`; filter by member/family/date; renders content +
  exactly-what-was-clicked + timestamps; export.
- **Response history** — own-only; editable; the intimacy-inventory-update **offer** (never silently
  writes); the mutual-green-light surface.

**E2E (Playwright, decrypting the vault):**

- **Send + log (fake Resend)** — connect via the fake → send a welcome → **decrypt an `EmailActivityEntry`**
  (family/subject/status/toAddress).
- **Interactive loop** — send an AI-suggestion email (fake) → simulate a relay tap on a token → next-open
  reconcile drains it → **decrypt an `EmailResponse`** mapped to the right `(suggestion, answer)`; assert
  the de-dup avoid-set updates.
- **Gating** — every intimacy gate (18+ ack, adult enabled, the distinct intimacy-email opt-in, live
  partner edge) individually blocks an E-int send; **crisis suppresses all email**; over-budget skips E.
- **Guards** — no horizontal overflow at 390px on Settings → Email + the owner view + the response
  history.

## 11. Resolved decisions

All open questions were resolved with the owner (2026-08-06) and folded into the sections above. Recorded
here for traceability:

- **"Email me at" address → a SEPARATE opt-in engagement address.** `EmailPrefs.address` (§4.2) is set
  when a person opts into engagement email and is **distinct from `Person.email`**, which stays the
  delivery-only **contact** address for questionnaire recipients (family A). Absent ⇒ no engagement email
  (fail-closed); it has its **own** unsubscribe, independent of the contact address (§3.1).
- **Open tracking → poll Resend for status.** The cadence hook polls Resend's email-retrieval API on each
  open for `delivered`/`opened`/`bounced`/`complained` and records it into the activity log — **no
  webhook, no backend** (§3.4). This fills the owner view's "Opened" column and informs re-engagement.
  Click-intent for interactive emails is additionally captured natively via the relay token drain (§3.5).
- **Owner Email-activity view → a Settings → Email subsection** (not a top-level nav entry), admin-only
  with `AdminOnlyBadge` (§3.7/§5.3).
- **Digest cadence → default Sunday evening, local time, per-person configurable** (§3.2/§3.2a).
- **De-dup history scope → per-family** — the intimacy (`ai-suggestion-intimacy`) and non-intimacy
  (`ai-suggestion`) families keep **separate** avoid-sets (§3.3/§5.2).
- **Intimacy owner carve-out → deferred, default OFF; full visibility is the shipped default** (the owner
  confirmed "everything"). A future opt-in to narrow the owner's own intimacy view may be added later, is
  never member-facing, and does not ship in v1 (§3.7).
- **`ai-suggestion-intimacy` → its own distinct `EmailFamily`** (as drafted), for clean per-family opt-in,
  gating, and owner-activity filtering (§3.2/§4.2).

No open questions remain.

## 12. Changelog

- 2026-08-07 — **Phase 4 BUILT** (interactive tap layer — one-click email responses via the zero-knowledge
  relay). Relay Worker gained `GET /t/<token>` (records a tap — `tapKey` / `TAP_TTL_SECONDS`=30d, idempotent
  first-tap-wins, no PIN, strict-CSP page) + drain-secret-authed `POST /api/admin/drainTaps`; **`RELAY_VERSION`
  bumped 2→3** (`build.mjs` + `relayBundle.ts`) so an existing deploy shows "Update relay" — re-deploy required.
  Core `relayMailbox.ts` gained `recordTap`/`drainTaps` (revoke deletes the tapKey); `RelayClient` /
  `relayHttpClient` / `fakeRelay` gained `drainTaps`. New `@selfos/core/email/emailResponse.ts`:
  `mintEmailToken` (opaque token → `people/<id>/email/tokens/<token>.enc`), `listEmailResponses` /
  `editEmailResponse` (own-only history, stamps `edited`), `drainEmailTaps` (list tokens → `relay.drainTaps` →
  map each tap → an `EmailResponse` in the vault → `applyResponseEffect` → delete every sibling token sharing
  `interactionId`; **prunes tokens older than the 30d TTL** so the local store + drain payload stay bounded),
  `TapDrainer` interface. `applyResponseEffect`: a `pause` reaction on `re-engagement` turns that family off,
  reading current prefs + passing `intimacyEmailOptIn` as eligibility so it **does not strip a legitimately-true
  intimacy opt-in** (the Phase-5 landmine caught in review). Additive schema `EmailToken` (+`interactionId`,
  `mintedAt`) / `EmailResponse` / `EmailTokenKind` — no `schemaVersion` bump. `reconcileEmailSchedule` threads
  `relay?: TapDrainer` + drains taps at reconcile step 0 (the bridge resolves the relay config host-side — the
  Cloudflare token + drain secret never cross IPC). New IPC `email:responses` / `email:editResponse`
  (`email.own`-gated, own-scoped — a foreign id path-misses → null). Renderer `ResponsesSection` in
  `EmailSettingsPanel` ("Your email responses", self-hides when empty, inline edit). code-reviewer **ship after
  two should-fixes** — both applied (the intimacy-opt-in preservation + the token TTL prune) with tests; the
  `GET /t/` prefetch is a conscious accepted risk (§3.5). Gate green: typecheck (4 pkgs), lint, format, core
  (`emailResponse` 7) + relay-worker (tap/drainTaps) + desktop (coreBridge two-persona interactive round-trip +
  own-scoping denial; `EmailSettingsPanel` history+edit RTL) unit + a decrypt-level P4 E2E (response history
  renders → edit round-trips to the vault). **Phases 5–6 remain.**
- 2026-08-07 — **Phase 3 BUILT** (scheduling substrate + families C [weekly digest] + D [re-engagement] +
  the deferred family-A recipient reminder). New core `emailSchedule.ts`: `reconcileEmailSchedule` (poll
  Resend status via `mapResendStatus`; schedule/cancel the digest + re-engagement via `scheduledAt`/cancel;
  cancel a reminder once its questionnaire is answered), `gatherDigestContent`/`gatherReEngagement`
  (host-side, deterministic, no AI), `nextDigestAt`, `scheduleQuestionnaireReminder`, `updateEmailActivity`
  (in-place status/cancel), constants `RE_ENGAGEMENT_AWAY_DAYS=7` / `RE_ENGAGEMENT_MIN_GAP_DAYS=14` /
  `QUESTIONNAIRE_REMINDER_DAYS=3` / `RECONCILE_THROTTLE_MS=24h`. New composers `buildDigestEmail`,
  `buildReEngagementEmail`, `buildQuestionnaireReminderEmail`. Families **A/B are NOT** crisis-suppressed;
  **C/D ARE** (§7, owner-confirmed). Additive schema: `EmailPrefs.digestDay`/`digestTime` (default
  Sunday/evening), `DeviceState.emailScheduledAt` (24h throttle marker), `EmailReconcileResult` view type;
  no `schemaVersion` bump. New IPC channel `email:scheduleReconcile({auto})` (full seam, `email.own`-gated,
  24h throttle + stamp, key never crosses); `email:sendQuestionnaireDelivery` gained an optional
  `assignmentId` that schedules the 3-day reminder. New renderer hook `useEmailScheduler` (launch/focus,
  mirrors `useAutoCheckins`), wired in `AppShell`; Settings → Email gained digest day/time selects +
  transactional/digest/re-engagement family toggles; `RelayLinkDelivery` threads `assignmentId` from the
  send panels. Tests: core (`emailSchedule.test.ts`), coreBridge P3 (throttle + stamp + decrypt), settings
  RTL, + a Playwright E2E (launch → decrypt a scheduled digest activity entry). **Phases 4–6 remain.**
- 2026-08-07 — **Phase 2 BUILT** (family B — transactional). The emailable notification kinds (35) also
  send a transactional teaser: new core `EMAILABLE_TRANSACTIONAL_KINDS` + `isEmailableTransactionalKind`
  (`responses-arrived`, `answers-updated`, `together-invite`, `together-turn` [teaser only], `story-shared`,
  `auto-checkin-incoming`; **`new-insight-ready` deferred** — no such `NotificationKind` exists yet,
  owner-confirmed) in `@selfos/core/schemas`. New `buildTransactionalEmail` composer +
  `sendTransactionalEmail` orchestrator — routes through `sendFamilyEmail` (engagement address +
  `transactional` opt-in + pause), **`crisisSuppressed: false`** (§7 scopes crisis suppression to C/D/E/F
  — the "ALL email" headers are rhetorical), idempotent on `sourceKey`. Additive `EmailActivityEntry.sourceKey`
  (= the notification's `coalesceKey#signature`) threaded through `performSend`/`sendFamilyEmail`; no
  `schemaVersion` bump. New IPC channel `email:sendTransactional` (full seam, `email.own`-gated,
  allowlist-validated, key never crosses). New renderer hook `useEmailTransactional` (one teaser per fresh
  emailable candidate, de-duped), wired in `AppShell`. Tests: core (composer, allowlist,
  idempotency/retry/opt-in), coreBridge two-persona decrypt-level, hook RTL, + a Playwright E2E (external
  answered send → launch → decrypt a transactional activity entry). **Phases 3–6 remain.**
- 2026-08-07 — **Phase 1 BUILT** (family A — real questionnaire delivery). `RelayLinkDelivery`'s Email
  button is now a real Resend **"Send email"** when the household email is connected + ready (with the
  `mailto:` fallback otherwise + a success/failure banner). New core `buildQuestionnaireDeliveryEmail`
  composer + `sendQuestionnaireDeliveryEmail` orchestrator (a family-A sibling of `sendFamilyEmail`, sharing
  an extracted `performSend` tail). Family A sends to the **recipient's** contact address (not the sender's
  engagement `EmailPrefs.address`), is logged under the **sender**, and is **NOT** gated on the recipient's
  opt-in/pause and **NOT** crisis-suppressed (crisis suppresses only C/D/E/F, §7); its only gates are
  configured (key + from-line) + a recipient address. New IPC channel `email:sendQuestionnaireDelivery`
  through the full seam (channels → coreBridge Zod-validated + `email.own`-gated → ipc → preload →
  test-utils) — the Resend key never crosses it. The optional recipient reminder was **deferred to Phase 3**
  (owner-confirmed). Tests: core unit (composer + family-A gating), coreBridge two-persona decrypt-level, RTL,
  - a Playwright E2E decrypting a `questionnaire-delivery` activity entry. **Phases 2–6 remain.**
- 2026-08-07 — **Phase 0 BUILT** (infra + connect + the first send). The `email` `BridgeHost` part
  (`EmailClient` — send/cancel/status/verify) wired to `fetch` as `resendClient()` with a
  `SELFOS_FAKE_RESEND` offline fake + a `webFakeEmailClient` web/iOS stub; `RESEND_API_KEY_ID` device
  secret. New `@selfos/core/email`: `emailConfig` (`config/email.enc` + `resolveResendKey` [device →
  shared → none, the [`25`](25-household-ai-credentials.md) precedent] + `emailStatusOf` — booleans-only,
  no key value; readiness needs a key AND a from-address), `emailPrefs` (per-person `people/<id>/email/
prefs.enc`, fail-closed, unsubscribe token minted once, intimacy opt-in coerced off when ineligible),
  `emailComposer` (pure welcome HTML + plaintext, HTML-escaped, no inline SVG), `emailSend` (the ONE gated
  send-and-log orchestrator: crisis → configured → address → per-family opt-in → pause; monthly activity
  shards). New additive schemas (`EmailConfig`/`EmailStatus`/`EmailFamily`/`EmailPrefs`/`EmailActivityEntry`/
  `EmailSendInput`/`EmailSendResult`/`EmailVerifyResult`) — no `schemaVersion` bump on existing files. New
  **`email.own`** capability (Member default on); the household connect + owner-activity read are
  `settings.manage`/`people.manage`-gated in the bridge. Full IPC seam (`email:status`/`verify`/`setConfig`/
  `setSharedKey`/`clearSharedKey`/`getPrefs`/`setPrefs`/`send`/`activity`) — **the Resend key never crosses
  it**. Settings → Email panel (admin connect via `SecretKeyControl` + Test connection + sending domain/
  from-address; per-person engagement address + welcome toggle + pause; the "Connect Resend to turn this
  on" empty state) + a `useEmailWelcome` cadence hook (welcome sent once per person, idempotent via a bridge
  "sent once" guard). Family G (welcome) is the pipeline proof; `emailSend` rejects every other (unbuilt)
  family. Gate green: typecheck (4 pkgs), lint, format, **1795 core + 1506 desktop** unit (+email core [10:
  resolver/prefs/composer/orchestrator gates], +2 coreBridge two-persona [connect→prefs→welcome→decrypt an
  activity entry, key never returned + ciphertext on disk; a non-owner can't connect / read another's
  activity], +3 EmailSettingsPanel RTL), + a decrypt-level E2E (seed a connected config + address → launch →
  the welcome auto-sends → decrypt an `EmailActivityEntry` → the Settings → Email UI + a 360px guard). Visual
  QA of the panel at desktop. code-reviewer **ship** (security envelope verified airtight — key never leaves
  main, gating in the bridge, fail-closed, crisis-first; applied the should-fix restricting `emailSend` to the
  one built family + the readiness/`domainVerified`/shard-path nits). **Phases 1–6 remain** (A questionnaire
  delivery → B transactional → C/D digest+re-engagement → interactive taps → E AI suggestions + intimacy →
  owner activity view + milestones). **Lesson: an email feature's whole risk surface is "the secret must never
  reach the renderer" — resolve the Resend key host-side in the bridge and return only a booleans-only
  `EmailStatus`/`EmailVerifyResult`, exactly the [`25`](25-household-ai-credentials.md) posture; and route
  EVERY family through one gated send-and-log orchestrator so gating (crisis/opt-in/pause/fail-closed) +
  logging can't be bypassed by adding a family later.**
- 2026-08-06 — created (Draft). SelfOS's first real email, via BYO Resend: eight email families
  (questionnaire delivery, transactional, weekly digest, re-engagement, AI Coach Suggestions +
  intimacy, milestones, welcome) on a no-backend delivery model (immediate when open + Resend
  `scheduledAt` reconciled on the [`63`](63-auto-checkins.md) launch cadence). Tap-to-respond via
  one-click tokens routed through the zero-knowledge relay, drained + mapped back locally into the
  encrypted vault to feed de-dup, resurface, mutual green light, an intimacy-inventory-update offer, and
  coaching context. Shared Resend secret on the [`25`](25-household-ai-credentials.md)
  `config/*.enc` + device-override-resolver precedent; per-person `EmailPrefs`; an owner-only
  Email-activity view (Owner full-access, member copy never implies watching). Implementation phased
  (§5.6). Decisions from the owner are encoded; §11 lists the genuine remaining forks.
- 2026-08-06 — reviewed with the owner; separate engagement address, Resend-poll open tracking, activity
  view as a Settings subsection, remaining questions resolved; **Approved.**
