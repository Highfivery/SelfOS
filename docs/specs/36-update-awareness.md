# 36 — Update awareness (notify-only)

> **Status:** **Built** — _last updated 2026-06-23_
>
> SelfOS has no way to tell a user a newer version exists; they'd have to check GitHub manually. This
> spec adds a **notify-only** update check: the main process polls the public GitHub Releases API,
> compares to the running version, and raises an in-app notification (spec 35) that links to the
> public Releases page to download. It does **not** auto-install — the app is unsigned and we are not
> pursuing code signing / `electron-updater` (see §2).

---

## 1. Overview

Releases are automated (release-please builds + publishes the macOS `.dmg` to GitHub Releases —
`19-distribution.md`). The repo is now **public** (see `repo-now-public` memory; correct the stale
"private" notes in spec 19 / `CLAUDE.md` / `README.md` as part of this work), so the latest release is
readable with no auth. This spec closes the loop: the app learns when it's behind and tells the user,
unobtrusively, how to get the new version.

- **Check** in the main process (the renderer has no network) against the public GitHub Releases API.
- **Compare** the latest tag to the running `__APP_VERSION__`.
- **Notify** via spec 35 (an `update-available` notification + a sticky toast) with an action that
  opens the Releases page externally.
- **Manual** "Check for updates" in Settings → About, with up-to-date / checking / error states.

Related: `19-distribution.md` (release pipeline, versioning, unsigned state), `35-notification-system.md`
(the surface this raises), `02-app-shell.md` (About/Settings, the version display), `buildInfo.ts`
(`__APP_VERSION__`).

## 2. Goals / Non-goals

- **Goals**
  - Detect a newer published release and surface it in-app without nagging.
  - Check **on launch + periodically while open + on a manual button** (the chosen cadence).
  - Link out to the **public Releases page** to download; no token, no proxy (repo is public).
  - Robust, silent failure when offline / rate-limited; never block the app.
  - A Settings → About "Check for updates" affordance with clear states.
  - Respect a per-version "skip / already saw this" so the same release doesn't re-toast forever
    (coalesce via spec 35).
- **Non-goals**
  - **Auto-download / auto-install / relaunch** (`electron-updater`) — explicitly NOT built; requires
    code signing + notarization (Apple Developer ID) which the user has declined for now. If that
    changes, it's a future spec amending `19`.
  - Code signing / notarization / removing the Gatekeeper warning — out of scope.
  - Windows/Linux update feeds — macOS-only, matching current distribution.
  - In-app download of the `.dmg` — we link to GitHub, the user installs manually (and does the
    one-time Gatekeeper bypass, documented in the README).

## 3. UX & flows

### 3.1 Automatic

1. On launch (after boot, non-blocking) and every few hours while open, main checks the latest
   release.
2. If `latest > current`, raise (or coalesce) an `update-available` notification (spec 35): title
   "SelfOS {X.Y.Z} is available", body a short line (e.g. "You're on {current}."), action **"View
   release"** → opens the public Releases (or that tag's) page via `shell.openExternal`. Per spec 35
   it's a gentle but **sticky/persistent** item (no auto-update, so it shouldn't silently vanish).
3. If already current, do nothing (no notification).

### 3.2 Manual (Settings → About)

- A **"Check for updates"** button near the version line (`AboutVersion`). States: idle → checking
  (spinner/`aria-busy`) → **"You're up to date (vX.Y.Z)"** OR **"Update available: vX.Y.Z — View
  release"** OR a calm **"Couldn't check right now"** on failure. The manual check also raises the
  same notification when behind.

### 3.3 Coalescing / not nagging

- One `update-available` per latest version (coalesce key = the version). Re-checks that find the
  same version update in place, don't re-toast. A newer version supersedes. Dismissing it hides it
  until a still-newer version appears (per spec 35 re-surfacing rules).

## 4. Data model (vault files & schemas)

- **Device-local state** (not vault): `lastUpdateCheckAt`, `latestKnownVersion`, and the spec-35
  dismissed flag (keyed by version). Stored via the existing device-state store. No vault files, no
  migration.
- **Schemas (Zod):** `UpdateCheckResult` = `{ current, latest, isUpdateAvailable, releaseUrl,
publishedAt?, checkedAt }` (a view type; the raw GitHub payload is parsed/validated in main and
  never passed through wholesale).

## 5. Architecture & modules

- **Main:** an `updateService` that calls the public GitHub Releases API
  (`GET https://api.github.com/repos/Highfivery/SelfOS/releases/latest`) with `globalThis.fetch`
  (already used in main), a short timeout, a descriptive `User-Agent`, validates the response with
  Zod, and computes semver comparison against `__APP_VERSION__`. Scheduling: a launch check + an
  interval timer (cleared on quit). All network + parsing stays in main.
- **IPC:** `updates:check` (manual/force) → `UpdateCheckResult`; `updates:getState` (cached last
  result for the About panel). The "open release page" reuses the existing external-open path
  (`shell.openExternal`), not a renderer URL open.
- **Renderer:** the About "Check for updates" control (`settings/customRows.tsx` near `AboutVersion`)
  - wiring the result into the spec-35 notification store (raise/coalesce `update-available`).
- **Reuse:** the notification surface is entirely spec 35; this spec only produces the data and the
  manual control.

## 6. IPC / API contracts

- **`updates:check`** (renderer→main, invoke): no args (or `{ force?: boolean }`) → `UpdateCheckResult`.
- **`updates:getState`** (renderer→main, invoke): → last `UpdateCheckResult | null`.
- **GitHub API:** unauthenticated `GET /repos/Highfivery/SelfOS/releases/latest`. Handle: 200 (parse
  `tag_name`, `html_url`, `published_at`), 404 (no releases yet → treat as up-to-date), 403/rate-limit
  (fail silently, cached state unchanged), network error/timeout (silent). The API key/secret model is
  irrelevant here (public, unauthenticated); **never** embed a token.

## 7. States & edge cases

- **Offline / DNS fail / timeout** → silent; About manual shows "Couldn't check right now"; no toast.
- **Rate-limited (403)** → silent; rely on cached state; periodic interval is conservative enough to
  avoid hitting the unauthenticated limit (a check every few hours is far under 60/hr).
- **No releases / pre-release only** → `latest` absent → treat as up-to-date (the `/releases/latest`
  endpoint already excludes drafts/prereleases).
- **Tag parsing** → tags are `vX.Y.Z` (release-please, `include-component-in-tag:false`); strip the
  `v`, parse semver; a malformed tag → ignore that release (don't crash).
- **Dev build** (`__APP_VERSION__` from package.json, sha `dev`) → still checks; a dev version equal
  to/ahead of latest shows up-to-date.
- **Downgrade / equal** → never notify.
- **Quit during a check** → interval/timer cleared; no dangling handles.

## 8. Safety

N/A — purely technical (no wellbeing/conversation content). One privacy note: the check is an
**outbound request to GitHub from the main process only**; it sends no vault data, no personal data,
only a standard API GET (with a generic User-Agent). The renderer never makes the request and never
receives a token. Document in the privacy posture that the app contacts GitHub for update checks (and
that this is the only non-Claude/non-relay outbound call), and consider a settings toggle to disable
update checks (see §11).

## 9. Accessibility

The manual "Check for updates" button: labeled, `aria-busy` while checking, results announced via a
live region; states are text (not icon-only). The notification surface accessibility is owned by
spec 35.

## 10. Testing strategy

- **Unit (main):** semver compare (newer/older/equal/malformed); response parsing/validation; 404 →
  up-to-date; 403/network → silent + cached; timeout handling. `fetch` mocked.
- **Component (RTL):** the About control's idle/checking/up-to-date/available/error states; clicking
  "View release" triggers the external-open path (mocked).
- **E2E (Playwright):** with a fake update endpoint, a launch check finds a newer version → the
  spec-35 `update-available` notification appears with a working "View release" action (external open
  intercepted); a manual check when current shows "up to date"; offline shows the calm error. (Gate
  the real network behind the fake, like the existing relay/openai fakes — e.g. `SELFOS_FAKE_UPDATE`.)
- **Mocking:** a `SELFOS_FAKE_UPDATE` hook returning a canned latest version so E2E is deterministic
  and offline.

## 11. Resolved decisions

- **Settings toggle to disable update checks:** **yes** — a Settings → About boolean, default **on**.
- **Cadence:** check on launch, then **every 6 hours** while open, plus re-check on window
  focus/resume, plus the manual button.
- **Link target:** the **specific tag's** release page (`html_url`, shows that version's changelog),
  falling back to the repo Releases page if absent.
- **Release notes in-app:** out of scope for v1 (we link out); the `body` is available to revisit
  later.
- **Per-person vs. app-global:** **app-global** — an update concerns the whole install. Raised on a
  non-person-scoped notification channel (spec 35) so it isn't duplicated per persona and survives a
  person switch.

## 12. Changelog

- 2026-06-22 — created (notify-only; repo is public so the check uses the unauthenticated GitHub
  Releases API and links out; auto-update/signing explicitly excluded per the user).
- 2026-06-22 — **Approved.** Resolved: settings toggle (default on), launch + 6h + focus + manual
  cadence, link to the specific tag page, release notes out for v1, app-global notification channel.
- 2026-06-23 — **Built** (on `feat/update-awareness`). A pure `@selfos/core/updates` `checkForUpdate({fetch,
currentVersion, now})` does the unauthenticated GitHub `releases/latest` GET (descriptive User-Agent, ~8s
  `AbortController` timeout, Zod-validated, semver-compared, **no token**) and returns `UpdateCheckResult | null`
  (`null` = couldn't check → never overwrites the cache; 404 / malformed tag → up to date; 403 / network /
  timeout / unparseable → null). The network call is a **host primitive** (`BridgeHost.checkForUpdate`, wired to
  `globalThis.fetch` in main, faked under `SELFOS_FAKE_UPDATE`); `coreBridge.updatesCheck` caches a successful
  result device-local (`lastUpdateCheckResult`/`latestKnownVersion`/`lastUpdateCheckAt`) and `updatesGetState`
  reads it. **Cadence is renderer-driven** (a `useUpdateChecks` AppShell hook: launch + 6h interval + focus/
  visibility, gated by the `updates.autoCheck` device toggle [default on], throttled ~30min for non-forced; the
  manual button forces) rather than a main timer — simpler, and "cleared on quit" = effect cleanup on the
  renderer teardown. A renderer `updateStore` (app-global, never per-person reset) holds the result + drives both
  the Settings → About control (idle/checking[`aria-busy`]/up-to-date/available[+ View release]/calm error,
  `role=status`) AND the spec-35 `update-available` notification candidate (sticky warning toast, action `external`
  → the tag's `html_url` via `shell.openExternal`). **App-global dismiss** (§11): `APP_GLOBAL_NOTIFICATION_KEYS`
  - a `globalNotificationState` device blob the bridge splits/merges, so dismissing the update is shared across
    personas and survives a person switch (spec 35 was per-person only). Tests: core semver/parse/404/403/timeout/
    malformed units (fetch mocked); bridge cache + app-global-split integration; RTL for the About states + View
    release; an `updateStore` throttle/dedupe unit; E2E (launch finds newer → notification + working Open external
    [intercepted] + dismiss persists across reload; manual up-to-date; offline calm error). Also corrected the
    now-stale "repo is private" notes in spec 19 + the README (downloads are public; still unsigned).
