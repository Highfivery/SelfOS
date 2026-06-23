# 35 — Unified in-app notification system

> **Status:** **Approved** — _last updated 2026-06-22_
>
> SelfOS surfaces alerts ad-hoc today — a sync-conflict `Banner` in content, a "keep your profile
> fresh" Home card, no signal at all when a questionnaire recipient responds, and (with spec 36) a
> pending "update available" notice. This spec introduces ONE shared notification system: a
> **notification center** (a bell in the TopBar with a dismissible list) plus brief **toasts** for
> fresh/important items, and migrates the scattered alerts into it.

---

## 1. Overview

As SelfOS has grown, "things the user should know about" have accumulated with no common home. The
result is inconsistent (a banner here, a card there, nothing elsewhere) and easy to miss. This spec
adds a single, cohesive notification layer:

- A **notification center** — a bell control in the `AppHeader` cluster (beside the usage ring /
  appearance / account) opening a list of current notifications, each dismissible, with an unread
  count badge.
- **Toasts** — brief, non-blocking pop-ups for newly-arrived or high-salience notifications, which
  then live on in the center until dismissed.
- A typed registry so any feature raises a notification the same way, and the existing ad-hoc alerts
  (§3.5) migrate in.

This is foundational UX infrastructure. Spec 36 (update awareness) is its **first external consumer**.
Related: `02-app-shell.md` (the TopBar slot model), `01-design-system.md` (`Banner`, tokens, the
`TitlebarControl` pattern), `29-progressive-profile-building.md` + `17-home-dashboard.md` (the
profile-freshness nudge being migrated), `08-questionnaires.md` (responses-arrived), the vault
sync-conflict detector (`14`/`02`).

## 2. Goals / Non-goals

- **Goals**
  - One way to raise, display, persist, and dismiss a notification.
  - A TopBar **bell + count + dropdown center** (persistent) and **toasts** (transient) — the
    chosen "center + toasts" form factor.
  - Migrate four existing/near-future alerts in v1: **update-available** (spec 36),
    **profile-freshness nudges**, **questionnaire-responses-arrived**, **sync conflicts**.
  - **Per-person, device-local** notification state (each persona sees their own; nothing sensitive
    leaves the device or the active person's scope).
  - Notifications carry a **kind**, **severity**, **title/body**, an optional **action**
    (navigate in-app, or open-external for the update link), and **dedupe/coalesce** keys so the same
    thing doesn't stack.
  - Accessible: keyboard-navigable center, `aria-live` for toasts, focus management.
  - `/gallery` showcases the toast + center.
- **Non-goals**
  - **OS-level / push notifications** (Notification Center, badges on the dock) — in-app only for v1.
  - A notification **history/archive** beyond current items (dismiss = gone; not a log).
  - Cross-device sync of read/dismiss state (device-local; revisit if multi-device demand appears).
  - Replacing crisis UI — crisis routing stays its own always-present, resources-first surface, NOT a
    dismissible notification (§8).

## 3. UX & flows

### 3.1 The bell (notification center)

- A `TitlebarControl`-styled **bell** sits in `AppHeader`'s `.items` cluster (with `UsageRing`,
  `AppearanceMenu`, `AccountMenu`). It shows an **unread count** badge when >0 (the `flex:none`
  geometry rule from CLAUDE.md §12 applies so it can't shrink).
- Clicking opens a **dropdown panel** (same menu/popover pattern as the account menu; must not be
  clipped by an `overflow` ancestor, must stay on-screen — CLAUDE.md §12): a list of current
  notifications, newest first, grouped by unread/read.
- Each row: an icon for its **kind**, title, one-line body, relative time, an optional **action**
  button/link, and a per-row **dismiss** (×). A header action: **"Mark all read"** + **"Dismiss
  all"**.
- Empty state: a calm "You're all caught up."
- Opening the center marks shown items **read** (the badge clears) but does not dismiss them.

### 3.2 Toasts

- When a new notification arrives while the app is open (or a high-severity one), a **toast** appears
  (bottom or top corner — confirm in §11), `role="status"`/`alert` by severity, auto-dismissing after
  a few seconds (longer/﻿sticky for high severity), with the same action + a manual close. It does not
  block interaction. After it fades, the item remains in the center.
- Toasts **stack** politely (cap visible count; overflow folds into the center).

### 3.3 Severity & kinds

- **Severity:** `info` | `success` | `warning` (drives icon/accent + toast persistence; reuse
  `Banner` tones/tokens — no new colors).
- **Kind** (extensible registry): `update-available`, `profile-freshness`, `responses-arrived`,
  `sync-conflict`, plus future kinds. Each kind declares its icon, default severity, action, and
  coalesce key.

### 3.4 Actions

- **Navigate** — `{ to: '/memory' }`-style in-app route (e.g. responses-arrived → Results;
  profile-freshness → the suggestion). Closes the center, navigates, and dismisses (or marks read).
- **Open external** — for the update link (spec 36), opens the Releases page via the existing
  `shell.openExternal` path (renderer never opens URLs directly).
- **Reveal vault** — the sync-conflict "Resolve" affordance opens the vault folder (a shell op, not a
  route or URL), via the existing `revealVault` path.
- **None** — purely informational.

### 3.5 Migrations (what moves into the system in v1)

| Today                                                                   | Becomes                                                                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Sync-conflict in-content `Banner` (+ AccountMenu "Resolve N conflicts") | a `sync-conflict` notification (warning) with a "Resolve" action; the in-content Banner MAY remain as a deep affordance — confirm in §11 |
| Home "Keep your profile fresh" card / depth invitations (spec 29)       | a `profile-freshness` notification (info) with a "Review" action; the Home card MAY remain or be replaced — confirm in §11               |
| (none today) Questionnaire recipient submits answers                    | a `responses-arrived` notification (info → sender) with a "View results" action                                                          |
| (spec 36) Update available                                              | an `update-available` notification (info) with an "open Releases" external action                                                        |

### 3.6 When notifications are raised

- **Sync-conflict** — when the existing conflict detector reports >0 (already computed in the
  AppHeader path).
- **Profile-freshness** — when a session/dream/questionnaire analysis pass produces a
  `ProfileUpdateSuggestion`/depth invitation (spec 29 already computes these).
- **Responses-arrived** — when a drain/poll discovers a newly-submitted response to one of the
  active person's sends (this requires a check on launch/visit — see §7; do **not** add background
  network beyond what spec 36's update poll establishes; reuse existing drain points).
- **Update-available** — fed by spec 36's GitHub Releases check (a renderer `updateStore` → the
  `useNotificationSources` candidate); its read/dismissed state is app-global, not per-person.

## 4. Data model (vault files & schemas)

- **State:** notification **read/dismissed** state is **device-local + per-person** (like nav
  collapse / active person) — NOT in the vault (it's ephemeral UI state, and dismissals shouldn't
  sync or leak across personas). Stored via the existing device-state store, keyed by person id.
- **Schemas (Zod, in `@selfos/core` view types):**
  - `NotificationKind` (string-literal union, extensible).
  - `NotificationSeverity` = `'info' | 'success' | 'warning'`.
  - `Notification` = `{ id, kind, severity, title, body?, action?, createdAt, coalesceKey, signature,
read, dismissed }` where `action` = `{ type: 'navigate'; to } | { type: 'external'; url } | { type:
'reveal-vault' } | undefined`. (`signature` is the current condition value — conflict count, version,
    suggestion-id set — that the per-kind re-surface rule compares against the persisted one.)
  - Most notifications are **derived** (computed from live state: conflicts, suggestions, update
    check) rather than persisted; only **read/dismissed** flags persist (keyed by `coalesceKey`/`id`)
    so a dismissed item stays dismissed until its underlying condition recurs.
- No new vault files. No migration (additive device-state key).

## 5. Architecture & modules

- **Renderer:**
  - `NotificationBell` (`TitlebarControl`) + `NotificationCenter` (dropdown) + `NotificationToast` +
    `ToastViewport` — in the design-system or `app/` chrome alongside `AppHeader`.
  - A **`notificationStore`** (Zustand) holding the current derived list + read/dismissed state;
    **per-person reset** wired into the AppShell active-person effect (the established per-person
    isolation rule). Providers register/contribute notifications into it.
  - A small **registry**: each kind declares icon/severity/action/coalesce. Features call
    `notify(kind, payload)` or the store recomputes derived kinds on the relevant store changes.
- **Main:** none new for the framework itself (the update poll + responses check live in spec 36 /
  existing drain). Read/dismissed persistence rides the existing device-state IPC.
- **`/gallery`:** add Notification toast + center examples (DoD).

## 6. IPC / API contracts

- **Persistence** rides device-state (per-person, like `sidebarCollapsed`) via two channels:
  `notifications:getState` / `notifications:setState`, carrying a `PersonNotificationState`
  (`{ read, dismissed }` signature maps, keyed by `coalesceKey`). The bridge resolves the active person
  and keys the state under it — per-person isolation is enforced in the bridge, not the renderer.
- **`notifications:responsesArrived`** — a consumer read returning the active person's sends with ≥1
  received response (the `responses-arrived` source); local, no network, gated by
  `questionnaires.viewResults` + sender-scoped in the bridge.
- **`shell:openExternal`** — opens a URL via the main-process shell (the `external` action; the renderer
  never opens URLs directly; only http(s) accepted).
- Other consumers (spec 36 update check) own their own data IPC; this spec only standardizes how the
  result becomes a notification.

## 7. States & edge cases

- **Empty** — bell shows no badge; center shows the caught-up state.
- **Many notifications** — center scrolls (vertical only — never horizontal, CLAUDE.md §12); toasts
  cap and fold the rest into the center.
- **Coalescing** — re-raising the same `coalesceKey` (e.g. update-available for the same version,
  conflicts still N) updates in place; it does not stack or re-toast every check.
- **Dismiss persistence** — a dismissed item with an ongoing condition (e.g. conflicts still present)
  does NOT immediately re-appear; it returns only when the condition changes (count changes / new
  version / new suggestion). Confirm exact re-surfacing rules per kind in §11.
- **Person switch** — the center resets to the new active person's notifications (no leakage); a
  toast in flight is cleared.
- **Offline** — the update/response checks fail silently; existing notifications still show.
- **Race** — center load resolving after an AppShell person-reset must not show the prior person's
  items (same async-after-sync-reset pattern as the Home dashboard; guard with the active id).

## 8. Safety

Crisis handling is explicitly **out** of this system — crisis stays an always-present, resources-first
surface that cannot be dismissed or buried in a list (CLAUDE.md §1, `05`/`08` safety sections). A
`warning` toast must never read as alarming for wellbeing content; severities map to neutral
design-system tones. Nothing in a notification body should restate sensitive content beyond what the
target surface already shows (a `responses-arrived` notice names the questionnaire, not answers).
Per the durable rule, no notification copy implies an owner/admin can see a person's content.

## 9. Accessibility

- Bell is a labeled button with the unread count in its accessible name ("Notifications, 2 unread").
- Center is a keyboard-navigable menu/dialog with focus trap + Esc to close + visible focus; not
  clipped/off-screen.
- Toasts use `aria-live` (`polite` for info/success, `assertive`/`role=alert` for warning), are
  pausable on hover/focus, and are reachable/dismissible by keyboard.
- Count badge is not color-only (number text). Respects reduced-motion (no slide/bounce when set).

## 10. Testing strategy

- **Unit:** the registry (kind → icon/severity/action); coalescing; read/dismissed persistence;
  per-person scoping; the derived-list recompute.
- **Component (RTL):** bell badge count; opening marks read; per-row + bulk dismiss; toast appears
  on a new item and the item persists in the center; empty state.
- **E2E (Playwright):** raise each migrated kind (seed a sync conflict, a profile suggestion, a
  submitted response, an update-available) → assert the badge, the center row, the action navigates /
  opens external, dismiss sticks across a reload; person-switch isolation (person A's notifications
  absent for person B); ~360px overflow guard on the center.
- **Mocking:** device-state + the consumer checks faked; no real network.

## 11. Resolved decisions

- **Toast placement:** **top-right**. Auto-dismiss: `info`/`success` after ~5s; `warning` is sticky
  (manual dismiss). Hover/focus pauses dismissal.
- **Migrated source surfaces stay AND get a notification:** keep the in-content sync-conflict `Banner`
  and the Home "keep your profile fresh" card as the deep, in-context affordances; ADD the
  notification as the cross-app signal. Revisit only if it reads as duplicative.
- **Re-surfacing rules:** a dismissed notification returns only when its underlying condition
  **changes** — sync-conflict re-surfaces when the count increases; profile-freshness on a
  brand-new suggestion; update-available on a still-newer version (spec 36). Same condition → stays
  dismissed.
- **Responses-arrived trigger:** reuse existing drain/Results points + the spec-36 launch/periodic
  tick. **No new background network.**
- **`update-available` is sticky:** gentle but persistent (warning-style sticky toast, stays unread
  until acted on or a newer version supersedes) since there's no auto-update.

## 12. Changelog

- 2026-06-22 — created (user opted into a unified notification system; form factor = center +
  toasts; v1 migrates update-available, profile-freshness, responses-arrived, sync-conflicts).
- 2026-06-22 — **Approved.** Resolved: top-right toasts (info/success ~5s, warning sticky); keep deep
  affordances AND add notifications; condition-change re-surfacing; reuse drain + spec-36 tick (no new
  background network); update-available is sticky.
- 2026-06-23 — **Update-available un-stubbed** (spec [`36`](36-update-awareness.md), on `feat/update-awareness`).
  Spec 36 now feeds the registered `update-available` kind from a real GitHub Releases check via a renderer
  `updateStore` → the `useNotificationSources` candidate (sticky warning toast, `external` action → the release
  page). Its read/dismissed state is **app-global** (not per-person): `APP_GLOBAL_NOTIFICATION_KEYS` +
  a `globalNotificationState` device blob the bridge splits out of `getNotificationState`/`setNotificationState`,
  so an update dismissal is shared across personas and survives a person switch (the rest stay per-person).
- 2026-06-23 — **Built** (on `feat/notification-system`). The framework + bell/center/toasts shipped with
  four kinds wired: `sync-conflict` + `responses-arrived` + `profile-freshness` live, and
  `update-available` registered but **stubbed** (no checker — spec 36 raises it). Notifications are
  **derived** in the renderer from live state; only read/dismissed **signatures** persist, device-local +
  per-person, via `notifications:getState`/`:setState` (mirroring `sidebarCollapsed`). Added a
  `reveal-vault` action (the sync-conflict "Resolve" shell op — beyond the spec's navigate/external/none),
  the `notifications:responsesArrived` consumer read (gated `questionnaires.viewResults`, sender-scoped),
  and a `shell:openExternal` channel (http(s)-only) for the `external` action. A new design-system `Toast`
  primitive (+ `/gallery`) + the bell/center/viewport chrome, a per-person-reset `notificationStore`, and
  the pure `resolveNotifications` registry (coalesce + per-kind re-surfacing: `onIncrease` for
  conflicts/responses, set-gains-a-new-id for profile-freshness, `onChange` for update-available). Also
  tightened `AppHeader` gaps/padding at phone width so the larger cluster (now incl. the bell) fits with no
  horizontal scrollbar. Tests: registry/coalescing/re-surfacing units, bell/center/toast/coreBridge
  component + integration, an E2E across the migrated kinds + person-switch isolation + a ~360px overflow
  guard.
