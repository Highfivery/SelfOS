# 02 — App shell

> **Status:** Approved · _last updated 2026-06-09_
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

- A persistent **left sidebar**: the **brand lockup** (the SelfOS sprout mark + wordmark; a draggable
  region on macOS), the primary nav items (from each module's `nav`, sorted by `order`), a spacer,
  then a footer with **Settings** and a **collapse toggle**.
- **Collapsible to an icon rail** on desktop: the toggle hides the labels (and the wordmark), leaving
  a narrow rail of icons with tooltips/`aria-label`s; the collapsed state is persisted device-local.
  Below the `md` (768px) breakpoint the sidebar instead becomes an off-canvas drawer (the responsive
  pass — Slice D; see [`01-design-system.md`](01-design-system.md) breakpoints).
- Selecting a nav item routes to that module's primary route; the active item is highlighted.

### 3.5 Global controls & session (the TopBar)

The **TopBar** is a slot-based header holding global, feature-agnostic controls (not per-route):

- the **appearance** (System/Light/Dark) toggle,
- the AI-usage **ring** (06; admin-only $ in its popover), and
- an **account menu** — the active person (avatar + name) opening: **Switch person** (the "Who's
  here?" picker), **Lock** (logout — see §3.6), and, only while the concealed super-admin is active,
  **Lock inspect mode** plus a visible "Super-admin" badge.

New global items drop into the slot without reworking the shell. Admin-only controls carry the
"Admin only" marker (CLAUDE.md §12).

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
