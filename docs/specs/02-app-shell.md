# 02 — App shell

> **Status:** Approved · **§13 chrome amendment Approved** (package E, 2026-06-14) · _last updated 2026-06-14_
>
> **2026-06 amendment (§13, package E of the app refresh):** an **integrated custom titlebar** (the brand +
> global controls share one cohesive top bar spanning the window, fixing the macOS brand-vs-traffic-lights
> collision and tuning window controls per platform); a **more consistent TopBar** (uniform control sizing +
> a curated set of useful items); and an **enriched global usage dropdown** (a quick summary + link to Usage).
> Read §13 with §3.4/§3.5/§5.1. (Desktop window chrome is Electron-only; the same header renders on iOS without
> window controls.)
>
> The skeleton every feature plugs into: the Electron window, the first-run vault-selection flow, the
> boot sequence, navigation + routing, the global state stores, the theme layer, and the layout
> regions. The shell is **feature-agnostic** — it renders whatever modules register (per
> [`00-architecture.md`](00-architecture.md) §5.2) and knows nothing about specific features.

---

## 1. Overview

The shell turns a cold launch into a ready, navigable app: create the window, find (or ask for) the
vault, load settings, apply the theme, and render a layout whose navigation and routes come entirely
from the **feature-module registry**. Adding a feature later means registering a module — never
editing the shell.

## 2. Goals / Non-goals

**Goals**

- A robust **boot sequence** with explicit phases and clear states for every failure.
- A calm **first-run** experience that gets the user to a working vault with minimal friction.
- **Registry-driven** navigation and routing (sidebar + content).
- A small set of well-bounded **Zustand stores** and a **theme layer** that applies appearance/
  density/text-size/contrast from settings without flashing.
- Correct Electron **window** behavior (state restore, single instance, safe external links, native
  menu).

**Non-goals**

- No multiple windows in v1 (single main window; multi-window is a later option).
- No auto-update in v1 (designed-for, not built).
- No feature content — Settings is the only registered module at first (see
  [`03-settings.md`](03-settings.md)).

## 3. UX & flows

### 3.1 Boot sequence (phases)

`appStore.phase`: `starting → (onboarding | vault-error | ready)`.

1. **starting** — main creates the window; renderer mounts; theme is applied pre-paint from
   device-local cache; the renderer requests boot state over IPC.
2. Main reads the **device-local** `vaultPath`:
   - **none** → `onboarding`.
   - **set but missing/inaccessible** (folder moved or cloud offline) → `vault-error`.
   - **valid** → load `config/settings.json` + `.selfos/meta.json`, run any migrations → `ready`.
3. **ready** — render the shell at the last route (or Home).

A calm splash/skeleton shows during `starting`; it never flashes the wrong theme.

### 3.2 First run (onboarding)

Minimal and reassuring:

1. **Welcome** — one line on what SelfOS is + the wellness/not-medical note.
2. **Choose your vault** — "Select a folder" (native dialog, main process) or "Create a new vault."
   Explain that the folder can live in Dropbox/iCloud to sync. Validate writability.
3. **Initialize** — create `config/`, `.selfos/meta.json` (vault id + schema version), and a default
   `config/settings.json`. Persist `vaultPath` device-local.
4. Enter the app at Home. (Optional gentle nudges — set appearance, add a Claude API key — surface
   later in Settings, not as blocking steps. See Open questions.)

### 3.3 Vault-error recovery

Clear, non-destructive screen: explain the vault can't be reached; offer **Retry**, **Relocate**
(reselect the folder), or **Choose a different vault**. Never lose or overwrite data.

### 3.4 Navigation

- A persistent **left sidebar**, starting **below the window-spanning `AppHeader` titlebar** (§13): the
  primary nav items (from each module's `nav`, sorted by `order`), a spacer, then a footer with
  **Settings** and a **collapse toggle**. _(The brand lockup moved out of the sidebar into the titlebar
  in the §13 amendment; the sidebar no longer owns it.)_
- **Collapsible to an icon rail** on desktop: the toggle hides the labels (and the wordmark), leaving
  a narrow rail of icons with tooltips/`aria-label`s; the collapsed state is persisted device-local.
- **Off-canvas drawer below `--bp-md` (768px):** the sidebar slides in over the content (overlay +
  scrim) from a **hamburger** in the TopBar's left slot, and closes on nav-select, Esc, scrim-tap, or
  a resize back to desktop. The rail-collapse toggle is desktop-only. Two-pane feature screens
  (Sessions, People) collapse to a **master–detail** at this width (list → detail with a back
  affordance). See [`01-design-system.md`](01-design-system.md) breakpoints.
- Selecting a nav item routes to that module's primary route; the active item is highlighted.

### 3.5 Global controls & session (the TopBar)

Global, feature-agnostic controls (not per-route) live in the right of the **`AppHeader` titlebar**
(§13 — this replaced the old in-content TopBar strip), every one rendered through the shared
`TitlebarControl` primitive so they align exactly:

- a **vault/sync status chip** — a calm "all synced" check; on a sync conflict it turns warning-toned
  with a count and opens the vault folder (the in-content Banner stays as the detailed explainer),
- the **appearance menu** — a compact icon button (the active theme) opening a System/Light/Dark
  popover,
- the AI-usage **ring** (06) opening an **enriched dropdown** (§13.4: % of allowance, session count,
  top usage by type, admin-only $ with the AdminOnlyBadge, and a "View usage details →" link), and
- an **account menu** — the active person (avatar + name) opening: **Switch person** (the "Who's
  here?" picker), **Lock** (logout — see §3.6), and, only while the concealed super-admin is active,
  **Lock inspect mode** plus a visible "Super-admin" badge.

New global items drop into the cluster without reworking the shell. Admin-only controls carry the
"Admin only" marker (CLAUDE.md §12). See §13 for the per-platform window chrome.

### 3.6 Lock / logout

**Logout locks the app to a full-screen person picker** (the lock screen): the active person is
cleared from view and the user must re-pick someone — entering their PIN if they have one (PIN-less
people resume immediately) — to continue. This is a **UI reveal-gate**, not data re-encryption: the
master key stays in the keychain (mirroring the concealed super-admin lock, 04-people-roles §8).
Locking also drops any super-admin elevation.

## 4. Data model (vault & device-local)

The shell owns small amounts of state, split by sync semantics (per `00-architecture.md` §4.1):

| Data                                   | Location     | Notes                             |
| -------------------------------------- | ------------ | --------------------------------- |
| `vaultPath`                            | device-local | Which folder is the active vault  |
| Window bounds + sidebar-collapsed      | device-local | Restored on launch                |
| Last route                             | device-local | For "resume where you were"       |
| `.selfos/meta.json` (vault id, schema) | vault        | Created on init; Zod-validated    |
| `config/settings.json`                 | vault        | Owned by the settings system (03) |

All reads/writes go through the vault service / a device-local store in main — never direct `fs` in
the renderer.

## 5. Architecture & modules

### 5.1 Window (main process)

- A single `BrowserWindow` with the security baseline from `00-architecture.md` §3
  (`contextIsolation`, `sandbox`, `nodeIntegration:false`, CSP).
- **macOS** `titleBarStyle: 'hiddenInset'` (traffic lights over a draggable sidebar header); default
  chrome elsewhere. Sensible `minWidth`/`minHeight`.
- **Window-state** persistence (bounds) device-local, restored on launch (clamped to a visible
  display).
- **Single-instance lock** (`app.requestSingleInstanceLock`); second launch focuses the existing
  window.
- **External links** open in the OS browser (`setWindowOpenHandler` + block in-app navigation to
  remote origins).
- A minimal **native application menu** (app/edit/view/window) with standard roles + an "Open vault
  folder" item.
- A shell-level **error boundary**; uncaught renderer errors show a recoverable error view, not a
  white screen.

### 5.2 Routing (renderer)

- **React Router** using a hash router (robust under `file://` in production). A root **layout route**
  renders the sidebar + content `<Outlet/>`; its children are assembled from the registry:
  module routes + `/settings/*` + Home (`/`) + a 404.
- Route → component mapping comes from `module.routes`; nav comes from `module.nav`. The shell
  contains **no hard-coded feature routes**.

### 5.3 State stores (Zustand)

Small, single-responsibility stores in `renderer/shared/stores`:

- `appStore` — boot `phase`, fatal errors.
- `vaultStore` — current `vaultPath`, status, `meta`.
- `settingsStore` — the settings values (source of truth; see 03).
- `themeStore` — derives the resolved theme/density/text-scale/contrast from settings + OS and applies
  them to `<html>`.
- `navStore` — sidebar collapsed, active route.

Persistence flows through IPC (debounced); stores never touch `fs`.

### 5.4 Theme layer

- On boot, a tiny inline script sets `data-theme` (and density/text-scale attributes) from a
  device-local cache **before first paint** to avoid flashes; once settings load, `themeStore`
  reconciles.
- Subscribes to OS `prefers-color-scheme`/reduced-motion changes when Appearance/Reduce-motion =
  System. Applies tokens per [`01-design-system.md`](01-design-system.md).

### 5.5 Layout regions

- **Sidebar** (nav) · **Content** (routed `<Outlet/>`, with an optional per-route header) ·
  **Overlay roots** for modals/toasts. No `position: fixed` traps; content scrolls, not the chrome.

## 6. IPC / API contracts

New typed channels (declared in `src/shared`, validated both sides):

- `app:getBootState` → `{ phase, vaultPath?, hasSettings }`.
- `vault:selectFolder` → opens the native dialog; returns `{ path }` or cancel.
- `vault:initialize(path)` → creates structure; returns `meta` or a typed error.
- `vault:setActive(path)` / `vault:getStatus` → `Result`-typed.
- `window:getState` / `window:setState` (bounds) — device-local.
- `ui:getSidebarCollapsed` / `ui:setSidebarCollapsed(boolean)` — the sidebar rail state, device-local.
- Events: `vault:changed` (from the watcher), `os:appearanceChanged`.

Lock/logout and person-switching reuse the session channels in
[`04-people-roles.md`](04-people-roles.md) (`session:setActive`, `superadmin:lock`); locking is a
renderer-side state with no new channel.

No Claude API usage in the shell itself.

## 7. States & edge cases

- **First run** (no vault) → onboarding.
- **Vault missing/offline** at boot or at runtime → `vault-error` / a non-blocking banner; retry or
  relocate.
- **Second app instance** → focus existing window.
- **Display removed** (saved bounds off-screen) → clamp to a visible display.
- **OS theme/reduced-motion change** → live apply when set to System.
- **Renderer crash** → error boundary with reload, not a blank window.
- **Empty registry** (only Settings) → Home shows a calm placeholder; nav still works.
- **Slow vault** (cloud cold) → boot shows progress; never blocks indefinitely (timeout → guidance).

## 8. Safety

Surfaces the wellness/not-medical line subtly in Welcome and About. No conversational surface here, so
no crisis handling at this layer (that lives in feature specs).

## 9. Accessibility

Per [`01-design-system.md`](01-design-system.md) §9: full keyboard navigation of the sidebar and
routes, visible focus, landmark roles (`nav`, `main`), focus moves to the content heading on route
change, Esc closes overlays, and the window respects OS text-size/reduced-motion.

## 10. Testing strategy

- **Component (Vitest + RTL):** sidebar renders registry nav and routes; active-state; collapse;
  onboarding steps; vault-error actions; the app-level error boundary.
- **Store tests:** boot phase transitions for each branch (none / missing / valid vault); theme
  derivation from settings + OS.
- **Integration:** vault initialization against a temp dir (structure + `meta.json` + default
  settings); window-state clamp logic.
- **E2E (Playwright + Electron):** launch with no vault → complete onboarding into a temp vault →
  land on Home; relaunch → resumes; simulate a missing vault → recovery. Claude is not involved.

## 11. Resolved decisions

Confirmed with the user (2026-06-09):

1. **Onboarding depth** — vault selection only; appearance + Claude API key are configured later in
   Settings via gentle, non-blocking nudges.
2. **Router** — hash router (robust under `file://`).
3. **Window** — a single main window for v1 (multi-window later).
4. **macOS titlebar** — `hiddenInset` custom-chrome look.
5. **Resume behavior** — reopen to the last route.

Confirmed with the user (2026-06-10) for the shell-chrome modernization:

6. **Branding** — a **sprout** mark (dusty-blue) + "SelfOS" wordmark as the sidebar lockup (and the
   future app/dock icon).
7. **Sidebar collapse** — desktop collapses to an **icon rail** (labels hidden, tooltips); persisted
   device-local. The mobile off-canvas drawer is the responsive pass (Slice D).
8. **Logout** — **lock to a full-screen person picker**; PIN-less people resume immediately. A UI
   reveal-gate, not data re-encryption.
9. **Global controls in the TopBar** — appearance toggle + usage ring + a single **account menu**
   (Switch person / Lock / super-admin Lock-inspect). Removed from the sidebar footer.

_No open questions remain. New questions that arise during implementation are appended here._

## 12. Changelog

- 2026-06-09 — created (draft) per the approved foundation plan.
- 2026-06-09 — resolved open questions (vault-only onboarding, hash router, single window, hiddenInset
  titlebar, resume to last route) after review; marked Approved.
- 2026-06-10 — Shell-chrome modernization: sprout brand lockup; the appearance toggle, usage ring, and
  a new account menu moved into the slot-based **TopBar**; the sidebar footer reduced to Settings + a
  **collapse toggle** (desktop icon rail, persisted device-local via `ui:get/setSidebarCollapsed`); and
  **logout = lock to a full-screen person picker** (§3.6). Updated §3.4–3.6, §4, §6, and §11.
- 2026-06-10 — Responsive pass (Slice D): below `--bp-md` (768px) the sidebar becomes an **off-canvas
  drawer** (overlay + scrim) opened by a TopBar hamburger; two-pane screens (Sessions, People) collapse
  to a **master–detail**; content padding tightens and tap targets are ≥44px. Breakpoint tokens added
  to `tokens.css`. A 390px mobile-width E2E guard walks every screen (asserting no horizontal overflow
  on the content scroll container, not just `main`). Updated §3.4.
- 2026-06-12 — **2026-06 chrome amendment added (§13, package E of the app refresh; Review).** An integrated
  custom titlebar (brand + global controls in one window-spanning bar; macOS `trafficLightPosition` inset,
  Windows `titleBarOverlay`), TopBar consistency + a curated item set, and an enriched global usage dropdown.
  Decisions in memory `app-refresh-plan-2026-06`. Mostly renderer + a small `window.ts`/platform-flag change.
- 2026-06-14 — **§13 amendment BUILT + Approved (package E).** Replaced the in-content TopBar strip + the
  sidebar brand header with one window-spanning **`AppHeader`** titlebar (brand left, controls right,
  sidebar+content below) and a shared **`TitlebarControl`** primitive (`/gallery`) so the sync chip · usage ·
  appearance · account cluster aligns exactly. New **`SyncStatusChip`** (calm check / warning+count → opens the
  vault folder; collapses first below `--bp-sm`; in-content Banner kept). **Enriched the UsageRing dropdown**
  (% allowance, session count, top usage by type, admin-only $ + AdminOnlyBadge, "View usage details →").
  Brand is now a Home link (presentational `Brand` + a `Link` wrapper) collapsing to a tile-only mark below
  `--bp-sm`. **Per-platform window chrome** in `window.ts`: macOS `hiddenInset` + centered
  `trafficLightPosition` + a reserved `--titlebar-traffic-width` inset (fullscreen reclaim via a new
  `window:fullscreenChanged` event); Windows `titleBarOverlay` + Linux default-frame are **blind/best-effort**
  (verified on-device later, like iOS). New bridge surface `readonly platform: AppPlatform` +
  `onFullscreenChanged()` threaded through preload (`process.platform`), coreBridge/webHost (Capacitor →
  `'ios'`/`'web'`), the Electron host, and the test mock. New tokens `--titlebar-height` /
  `--titlebar-traffic-width` / `--titlebar-window-controls-width` / `--control-height`. macOS fully designed +
  verified (geometry E2E + a real-window capture). Resolved §13.6 build forks: the sync chip opens the vault
  folder + the Banner stays; the brand links Home. Code-reviewer fix-first (the calm chip label now names its
  action; initial fullscreen pushed once on load). 411 desktop unit (+10) · 59 E2E (+2). Updated §3.4/§3.5/§13.6.

---

## 13. 2026-06 amendment — integrated titlebar, TopBar consistency & usage dropdown

Layers on §1–§12 (which remain accurate). Covers app-refresh items **14** (brand vs. window controls), **13**
(TopBar consistency + more items), and **5** (global usage dropdown). Per-session cost display (item 4) lives in
[`09 §14`](09-session-analysis.md), not here. **Desktop-only window chrome** (Electron); the same header
component renders on iOS (`07`) without the window-control zone, respecting safe-area insets.

### 13.1 The problem (item 14)

macOS uses `titleBarStyle: 'hiddenInset'` ([`window.ts`](../../apps/desktop/src/main/window.ts)), so the
traffic-light buttons float at the top-left **over** the sidebar's brand header with no reserved space — the
brand "butts right against" them and reads as bolted-on. The current TopBar is a separate strip inside the
content column, so the brand (sidebar) and the global controls (TopBar) live in two disconnected places.

### 13.2 Integrated custom titlebar (resolves items 13 + 14)

Restructure the top of the app into **one cohesive, window-spanning titlebar** — a single `AppHeader` row across
the full width, above the sidebar+content split:

```
┌─────────────────────────────────────────────────────────────────────┐
│ [⬤⬤⬤]  🌱 SelfOS        (drag region)        ◷usage  ☼theme  ◑account │  ← AppHeader (titlebar)
├───────────────┬─────────────────────────────────────────────────────┤
│  sidebar nav  │  content (routed Outlet)                             │
└───────────────┴─────────────────────────────────────────────────────┘
```

- The **brand moves out of the sidebar header into the titlebar's left** (after the window-control zone). The
  sidebar starts **below** the titlebar, so it no longer owns the brand and there's no collision.
- The titlebar's empty middle is the **drag region** (`-webkit-app-region: drag`); every interactive control is
  `no-drag`. This is the one place `drag` lives (today it's awkwardly on the sidebar brand).
- **Global controls** (usage, appearance, account — §3.5) sit at the titlebar's **right**, consistently sized
  and aligned (§13.3). The mobile nav **hamburger** moves to the titlebar's left (next to the brand) below
  `--bp-md`.

**Per-platform window chrome** (`window.ts` + a `platform` flag exposed to the renderer):

- **macOS** — keep `titleBarStyle: 'hiddenInset'`; set **`trafficLightPosition`** to vertically center the
  lights within the titlebar height, and reserve a left inset (~`var(--titlebar-traffic-width)`) before the
  brand so they never overlap. The titlebar height becomes a token (`--titlebar-height`, ≥ the traffic-light
  cluster).
- **Windows** — `titleBarStyle: 'hidden'` + **`titleBarOverlay`** (native min/max/close drawn into the custom
  bar, colored to match the theme); brand at far left, controls right, native buttons far right.
- **Linux** — `titleBarOverlay` where supported, else default frame; the `AppHeader` still renders (brand +
  controls), just without the overlaid window buttons.
- On **iOS** (`07`) there are no window controls; `AppHeader` renders brand + controls and pads for the
  safe-area/notch (the existing `env(safe-area-inset-*)` treatment moves here).

### 13.3 TopBar consistency + items (item 13)

- **Consistent control sizing.** All titlebar controls share one **control primitive** — same height
  (`--control-height`, e.g. 32px), hit area, radius, hover/focus treatment, vertically centered — so the
  appearance icon, usage ring, account control (and any future item) line up exactly (extending the earlier
  2px-misalignment fix into a single shared component, not per-control CSS).
- **A curated, useful item set** (item 13 — "add more things … more helpful, informative"). The right cluster,
  in order: a **vault/sync status chip** (surfaces the sync-conflict state as a small icon+tooltip instead of
  only the content banner, and a calm "all synced" otherwise); the **usage dropdown** (§13.4); **appearance**;
  **account**. (Resolved §13.6: **no** section-title/breadcrumb and **no** global new-session button — the
  guided-session launcher in package C owns "start a session"; kept deliberately uncluttered.) New items still
  drop into the slot without reworking the shell (§3.5).

### 13.4 Global usage dropdown (item 5)

The usage **ring** stays the at-a-glance affordance; clicking it opens an **enriched dropdown** (the current
popover, expanded) with a quick summary + a link to the full Usage page:

- **This period** (week/month per the user's setting) — the ring + **% of allowance**, **sessions count**, and
  **top usage by type** (1–2 lines, e.g. "Sessions · Dream images").
- **Admins** (`budgets.manage`) additionally see **$ spent / budget** (AdminOnlyBadge); non-admins never see $
  (the established rule — memory `selfos-usage-budget-rules`).
- A small **recent-usage sparkline** (reusing the `TrendLine` primitive) is a nice-to-have.
- **"View usage details →"** links to `/usage`.

This is mostly enriching the existing `UsageRing` popover (already ~80% there) — no new IPC; it reads the
existing `usage:summary` + budget state.

### 13.5 Architecture & states

- **Renderer** — a new `AppHeader` component (replaces the in-content `TopBar` strip + the sidebar brand
  header); a shared `TitlebarControl` primitive (→ `/gallery`, DoD §12); the sidebar loses its brand block and
  starts below the header. On the smallest widths (iOS/≤~360px) the brand renders as a **compact tile-only mark**
  (no wordmark), keeping the hamburger + essential controls.
- **Main (`window.ts`)** — set `trafficLightPosition` (macOS) / `titleBarOverlay` (Windows); expose `platform`
  to the renderer so `AppHeader` adapts padding/controls. `--titlebar-height`, `--titlebar-traffic-width`,
  `--control-height` tokens (`01`).
- **States/edge cases** — fullscreen on macOS hides traffic lights → the brand reclaims the inset (listen for
  enter/leave-fullscreen); very narrow widths (≤ ~360px) collapse the sync chip + brand wordmark first (brand →
  tile-only mark), keeping the essential controls; the drag region never swallows control clicks (`no-drag` on
  every control); reduced-motion respected for any header transitions.
- **A11y** — `AppHeader` is a `<header>` with labelled controls; the usage dropdown is a proper
  menu/disclosure with managed focus + Escape; window-control overlay colors meet contrast; keyboard reaches
  every control. Responsive ~360px→desktop with the documented collapse order.
- **Tests** — RTL: `AppHeader` renders brand + the control set (sync chip · usage · appearance · account),
  controls share computed height (a geometry guard, like the existing TopBar alignment test), the usage dropdown
  shows admin $ vs non-admin no-$. E2E: traffic-light inset present on macOS (brand not overlapping — measure
  geometry), the usage dropdown opens + links to `/usage`, 390px guard (brand collapses to tile-only).
  (Windows/iOS chrome verified by the user on-device, like other platform-specific work.)

### 13.6 Resolved decisions (2026-06-12)

- **TopBar item set** — **sync/vault status chip · usage dropdown · appearance · account**. **No**
  section-title/breadcrumb and **no** global new-session quick action (the package-C launcher owns "start a
  session"); kept deliberately uncluttered.
- **Mobile brand** — **compact tile-only mark** at the smallest widths (iOS/≤~360px).
- **Cross-platform** — **macOS fully designed + verified now**; **Windows (`titleBarOverlay`) / Linux fallback
  best-effort**, blind-written and verified on-device later (like the iOS work).

Confirmed at build time (2026-06-14):

- **Sync/vault status chip behavior** — when conflicts exist the chip is **warning-toned and opens the vault
  folder** (`revealVault`); the existing in-content warning **Banner stays** as the detailed explainer. When
  there are no conflicts the chip is a calm "All synced" check.
- **Brand** — the titlebar brand lockup is **clickable → Home** (a `<Link>` with its own `no-drag` + accessible
  name, inside the drag region).

_All resolved; the amendment is **Approved** (package E)._
