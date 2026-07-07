# 55 — Onboarding attention (new & unfinished questions)

> **Status:** Approved — _last updated 2026-07-07_
>
> After a person finishes onboarding, the intake catalog keeps growing (app updates add questions and whole
> sections). Today nothing tells them. This spec adds a gentle, dismissible **attention indicator** — a
> notification (bell + toast), a Home card, and a sidebar nav dot — that draws attention when their **completed**
> onboarding has **genuinely-new questions/sections** (added by a later update) or a section they **started but
> didn't finish**. Closes issue **#109**.

Builds on [`18-personal-onboarding.md`](18-personal-onboarding.md) (the intake catalog, `IntakeSession`,
per-section `answers`/`status`, the §15 self-maintaining profile + the §3.1 progress math), amends its §15,
and reuses [`35-notification-system.md`](35-notification-system.md) (the notification registry, the
device-local per-person read/dismissed state, toasts) and [`17`](17-home-dashboard.md)'s Home `OnboardingCard`.
It is a **sibling** of [`29-progressive-profile.md`](29-progressive-profile.md) (depth invitations) and the
§15 portrait-freshness nudge: those surface AI-noticed drift and go-deeper invitations; this one surfaces the
plain fact that the **catalog itself** grew.

---

## 1. Overview

The onboarding intake ([`18`](18-personal-onboarding.md)) is a catalog of sections, each with form questions
(and a few AI-chat topics). A person completes onboarding once (the required `core` sections + a generated
portrait), which releases the Member gate; the deep `invited` sections are optional and left `notStarted` (the
flow offers them afterward via "Go deeper"). Because the catalog is **code, not data**, every app update can add
questions to existing sections or append whole new sections — which `ensureIntakeSession` silently reconciles
into the person's session as `notStarted`. There is currently **no signal** that any of this happened.

This spec surfaces that signal, gently and dismissibly, in the three places the user asked for (#109): the
**notification bell + a toast**, a **Home card**, and a **dot on the Onboarding nav entry**. All three are
driven by one pure, deterministic computation over the person's session + a tiny per-person snapshot of what the
catalog looked like when they last completed/refreshed — **no AI, no new spend, no new IPC channel**.

**The key restraint (why a snapshot):** the deep invited catalog is large and intentionally left un-started, so
"any unanswered question" would keep the card + dot lit for essentially every user forever. So the persistent
surfaces flag only what genuinely warrants attention — content that's **new since they finished** (∉ the
snapshot) or a section they left **`inProgress`** (started, not finished). A `complete` section's remaining
optional blanks are deliberate skips and are never nagged about.

## 2. Goals / Non-goals

**Goals**

- A pure, tested **`onboardingAttention(...)`** helper that, for a **completed** session, flags a
  currently-visible unanswered question when it is either **new** (its `sectionId.questionId` is not in the
  completion snapshot — covers new questions in finished sections AND whole new sections) or **a blank in a
  section left `inProgress`** (started but not finished). A **new** chat section (no questions) that's un-started
  counts as one topic.
- Surface it in **three places** (user's choice, #109): a **`onboarding-updated` notification** (bell + toast),
  the Home **`OnboardingCard`**, and the **sidebar nav dot** on Onboarding.
- A lightweight per-person **completion snapshot** (`IntakeSession.knownSectionIds` / `knownQuestionKeys`),
  written at portrait synthesis and baselined for pre-55 sessions, so "new" is precisely detected without a full
  catalog-versioning system.
- Only for a **completed** onboarding (`session.status === 'complete'`) — first-run is already gated into the
  flow, so a separate nudge would be noise.
- **Dismissible & non-nagging**: the bell/toast dismisses and stays quiet until **more** appears (a later update)
  — `onIncrease` on the outstanding count. The Home card + nav dot reflect live state until the person acts.
- Reuse everything: the §3.1 progress math (`visibleQuestions`/`isAnswered`, branch-aware), the §35 notification
  registry + device-local per-person read/dismissed state, and the already-per-person-loaded `intakeStore`.

**Non-goals**

- **Not nagging about the un-started invited catalog.** A deep section the person simply hasn't gotten to (its
  questions all known, section not `inProgress`) is **not** flagged — only genuinely-new or in-progress items are
  (the user's explicit "new + left-blank, not never-started" choice, 2026-07-07).
- **No full catalog-versioning UI / diff history.** The snapshot is a flat set of ids captured at completion; it
  is not a migration log or a per-question changelog.
- **No AI, no metering, no generated copy** — the copy is static; the count is arithmetic.
- **No forcing.** This never re-gates a completed person back into full-screen onboarding (that gate stays
  first-run-only, [`18`](18-personal-onboarding.md) §3.1). It is an invitation, always skippable.
- **Not nagging about 18+ content the person hasn't unlocked** — an `adult` section is excluded until the shared
  18+ ack is given (§7).

## 3. UX & flows

**Who sees it.** The active person, when their own onboarding `session.status === 'complete'` **and**
`onboardingAttention(...).total > 0`. Gated by the existing `intake.own` capability (Members have it; the Owner
too). A person mid-first-run (`inProgress` session) is unaffected — the existing in-progress `OnboardingCard` +
first-run gate already own that state.

**What "needs attention" means** (branch-aware over the person's live answers, 18+-aware):

- a **new question** added by a later app update (∉ the completion snapshot) — whether in a section they finished
  or in a whole new section — that is currently visible + unanswered;
- a **new chat section** appended by an update, still un-started (1 topic);
- a **blank in a section left `inProgress`** — one they started but didn't finish.

Explicitly **not** flagged: an optional question left blank in a `complete` section (a deliberate skip), or a
deep `notStarted`/`skipped` section whose questions already existed at completion (not gotten to / declined).

The **headline is area-based** ("questions in N areas of your profile"), never a raw question total — calm, not
"137 unanswered questions."

### 3.1 The three surfaces

1. **Notification (bell + toast) — `onboarding-updated`.** One coalesced slot (`coalesceKey:
'onboarding-updated'`). Title: **"More of your profile to fill in"**; body: e.g. _"You have unanswered
   onboarding questions in 3 areas — including anything added in recent updates."_ (singular "1 area" when one).
   Action: **navigate to `/onboarding`**. Severity `info` (a calm Banner tone; no new colors). It lives in the
   bell center; **dismissing it silences it until the count increases** (`onIncrease`, signature = the
   outstanding total) — answering some never re-pops it; a later app update that adds more does.

2. **Home `OnboardingCard`.** For a completed session, the card gains an **attention** branch that takes
   precedence over the §15 staleness ("refresh your portrait") branch: heading **"A few more things to tell
   SelfOS"**, a line naming the number of areas, and a **"Continue onboarding →"** button to `/onboarding`. When
   there's no attention but the portrait is stale, the existing refresh card shows; when neither, self-hides.

3. **Sidebar nav dot.** The Onboarding `NavLink` already shows `styles.navDot` while onboarding is incomplete
   (`intakeIncomplete`). The dot's condition is extended to **also** show when the session is complete and
   `onboardingAttention(...).total > 0`. The `aria-label` becomes "Onboarding, questions to answer" so the dot
   isn't color-only (§9 / accessibility).

**Happy path.** Angel (a Member) finished onboarding weeks ago. An app update adds a new question to a section
she finished and a whole new "Community" section. On next launch: her Onboarding nav shows a dot; Home shows the
attention card ("unanswered questions in 2 areas"); the bell shows one unread. She clicks through to
`/onboarding` and answers what she wants. Refreshing her portrait re-baselines the snapshot, so the answered-away
"new" items stop counting; the dismissed bell stays quiet unless a future update adds still more.

## 4. Data model (vault files & schemas)

- **No new vault file.** The computation is derived from the existing `IntakeSession`
  ([`18`](18-personal-onboarding.md) §4) — per-section `answers` + `status` + the catalog metas
  (`IntakeSectionMeta[]` with `questions`/`adult`/`mode`).
- **Additive `IntakeSession` fields (no `schemaVersion` bump, matching the `portraitAnswerSig` precedent):**
  - `knownSectionIds?: string[]` — the section ids that existed at the last completion/refresh.
  - `knownQuestionKeys?: string[]` — the `sectionId.questionId` form-question keys that existed then.
  - Both `.optional().catch(undefined)` so a malformed value degrades to "no snapshot" (only in-progress blanks
    count) rather than throwing.
- **When written:** at portrait synthesis (`synthesizeIntake`), alongside `portraitAnswerSig`, via
  `intakeCatalogSnapshot()` (reads the live `INTAKE_CATALOG`). Refreshing the portrait re-baselines it.
- **Baseline for pre-55 sessions:** `ensureIntakeSession` seeds the snapshot to the current catalog for a
  `complete` session that lacks one (write-once, "from now on") — so existing users are never retroactively
  nagged and future additions are detectable. A fresh/in-progress session gets its snapshot at synthesis.
- **One additive notification kind:** `'onboarding-updated'` in the core `NOTIFICATION_KINDS` enum
  ([`35`](35-notification-system.md) §4). Its read/dismissed signature persists in the existing device-local,
  per-person `PersonNotificationState`. All reads go through the vault service; nothing new is directly written
  by the renderer.

## 5. Architecture & modules

- **Pure helper (`onboardingAttention`)** in the renderer's `app/routes/onboarding/progress.ts` (home of the
  §3.1 progress math), reusing `visibleQuestions` + `isAnswered`. Signature: `(metas, sectionFor, { adultAcknowledged,
knownSectionIds?, knownQuestionKeys? })`. Rules per section (excluding `adult` until acked):
  - `engaged = status === 'inProgress'`; `hasSnapshot = knownQuestionKeys !== undefined`.
  - **form** section: for each visible unanswered question, count it when `engaged` OR (`hasSnapshot` and its key
    ∉ `knownQuestionKeys`, i.e. NEW).
  - **chat** section: count 1 when `hasSnapshot`, its id ∉ `knownSectionIds`, and status is `notStarted`/`skipped`.
  - `areas` = section ids with a nonzero count; `total` = sum.
- **Core:** `intakeCatalogSnapshot()` in `intakeCatalog.ts`; the synthesis write + the `ensureIntakeSession`
  baseline in `intakeService.ts`; the two additive schema fields in `schemas.ts`.
- **Nav dot** — `AppShell` already has the per-person `intakeState`; compute attention there and OR it into the
  existing dot condition + `aria-label`.
- **Home card** — `OnboardingCard` gains the completed-session attention branch (precedes the staleness branch).
- **Notification source** — `useNotificationSources` reads the already-per-person-loaded `intakeStore` state and
  pushes an `onboarding-updated` candidate when the session is complete and `total > 0`; registry entry in
  `notificationKinds.ts` with `resurfaces: onIncrease`.
- **No new store, no main-process service, no package extraction, no new IPC channel.**

## 6. IPC / API contracts

- **No new IPC channel.** The nav/card/notification all read state the renderer already has (`intakeStore` /
  `intake:getState`, loaded + reset per active person in `AppShell`).
- **No Claude API.** This feature makes no model calls.

## 7. States & edge cases

- **First-run (`inProgress` session)** — no attention surface; the in-progress `OnboardingCard` + gate own it.
- **Complete, nothing new, nothing in-progress** — `total === 0` → no notification, card, or dot (all self-hide).
- **Complete, a deep invited section never started** — its known questions are NOT flagged (no nagging).
- **Complete, a section left `inProgress`** — its visible blanks are flagged (started, not finished).
- **App update adds a question/section** — its keys are ∉ the snapshot → flagged as new; a dismissed bell
  re-surfaces (the count increased).
- **Pre-55 completed session (no snapshot)** — baselined to the current catalog on load, so nothing reads as new
  until a later update; only an in-progress section's blanks count meanwhile.
- **18+ intimacy section, not acknowledged** — excluded entirely; acknowledging later includes its new/blank items.
- **Branch-hidden follow-ups** — never counted (not visible), matching `visibleQuestions`.
- **Person switch** — `intakeStore`, `notificationStore`, and the sources reset per active person (existing
  AppShell effect + the §35 per-person guard); one person's outstanding count never leaks into another's view.
- **Owner who never completes onboarding** — no attention surface (gated on `status === 'complete'`).
- **AI off / offline** — irrelevant; the computation is pure arithmetic.
- **Malformed snapshot value** — `.catch(undefined)` degrades it to "no snapshot" (only in-progress blanks count).

## 8. Safety

N/A for crisis routing (this feature shows no conversation content and makes no model call). It **preserves**
[`18`](18-personal-onboarding.md)'s boundaries: it never re-gates a completed person into full-screen onboarding,
never surfaces 18+ content before the ack, and touches no restricted/sensitive answer text — it only counts
unanswered questions. The not-medical framing of onboarding itself is unchanged.

## 9. Accessibility

- The nav dot is **not color-only**: the Onboarding `NavLink` `aria-label` changes to "Onboarding, questions to
  answer"; the dot itself is `aria-hidden`.
- The notification uses the existing accessible toast/center (role, dismissable, keyboard) — no new primitive.
- The Home card is ordinary headings + a labelled button; count/areas are text, never color alone.

## 10. Testing

- **Unit (pure helper)** — `onboardingAttention`: a new question (∉ snapshot) counts even in a `notStarted`
  section; a whole new section counts; a blank counts only in an `inProgress` section (a `complete` section's old
  blank does NOT); a new chat section un-started counts 1, an old one 0; branch-hidden follow-ups don't count; an
  `adult` section is excluded until acked; with no snapshot only in-progress blanks count; `total === 0` when
  nothing new/in-progress.
- **Core** — `intakeCatalogSnapshot()` matches the live catalog; synthesis writes the snapshot; `ensureIntakeSession`
  baselines a pre-55 complete session (and leaves in-progress ones alone).
- **RTL** — `OnboardingCard`: the attention branch renders (areas + Continue), takes precedence over staleness,
  and self-hides at `total === 0`. `useNotificationSources`: an `onboarding-updated` candidate only when complete
  - `total > 0`; not for an in-progress session.
- **E2E** — seed a **completed** session whose snapshot omits a real section (simulating an update that added it)
  → launch → assert the Home attention card, the Onboarding nav dot (via `aria-label`), and the bell; dismiss →
  relaunch → the bell stays dismissed (device-local, per-person) while the card/dot persist; a 360px no-overflow
  guard.

## 11. Open questions

_All resolved with the user (2026-07-07, #109):_ (1) what counts = new questions in finished sections · new
sections · left-blank/skipped; where = all three surfaces (bell + toast · Home card · nav dot). (2) On the
follow-up realization that the deep invited catalog is left un-started by design, the user chose **"new +
left-blank only"** — never nag about deep sections not yet gotten to — which this spec implements via the
completion snapshot ("new") + the `inProgress` rule ("left unfinished"), since every intake question is optional
so a `complete` section's blanks are deliberate and must not nag.
