# 00 — Architecture

> **Status:** Approved · _last updated 2026-06-09_
>
> The cross-cutting technical foundation for SelfOS: the plain-file vault storage model, the
> Electron process/security boundaries and typed IPC, the Claude API integration, the
> feature-module registry that lets the app scale infinitely, and the error-handling, state, and
> testing strategies every feature inherits. This spec is referenced by every feature spec; keep it
> DRY by linking here instead of restating.

This is a foundational spec, so it adapts the feature template: §3 describes the **runtime topology**
rather than user flows, and §9 (accessibility) defers to [`01-design-system.md`](01-design-system.md).

---

## 1. Overview

SelfOS is a local, single-user desktop app. There is **no backend**: the only network calls are to
the Claude API, made from the Electron main process. All user data lives as **human-readable files**
in a folder the user chooses (local, Dropbox, iCloud, Drive, …); sync is delegated to that folder's
provider. The architecture's job is to make this safe, scalable, and pleasant to build on:

- **Own your data** — plain Markdown + JSON, portable and inspectable.
- **Private by default** — sensitive content never leaves the device except in consented Claude
  calls; the API key is device-local by default (an Owner may opt to share it with the household,
  encrypted under the master key — see [`25`](25-household-ai-credentials.md) §8).
- **Scale infinitely** — features are self-contained modules that register into the shell; adding
  one never requires editing the shell.

## 2. Goals / Non-goals

**Goals**

- A robust **vault service** (the only storage): atomic writes, file-watching, sync-conflict
  detection, schema validation, and versioned migrations.
- Strict **Electron security**: isolated, sandboxed renderer; a typed IPC seam; secrets confined to
  main.
- A **feature-module registry** contract that the shell, settings, and vault all consume.
- Clear **error-handling, logging, state, and testing** conventions shared by all features.

**Non-goals**

- No server, account system, or cloud database (sync is the user's file provider).
- No real-time multi-user collaboration.
- v1 implements the **framework**, not feature content (journaling, sessions, etc. arrive as modules
  later, following the patterns here).

## 3. Runtime topology (processes & security)

Three processes, hard boundaries between them:

| Process      | Runs      | Owns                                                                                                              |
| ------------ | --------- | ----------------------------------------------------------------------------------------------------------------- |
| **main**     | Node.js   | Window lifecycle, the **vault service** (all `fs`), the **Claude proxy**, the OS keychain, logging, IPC handlers. |
| **preload**  | isolated  | A tiny `contextBridge` that exposes a **typed, minimal API** to the renderer. No Node leakage.                    |
| **renderer** | sandboxed | The React UI. **No** Node, **no** `fs`, **no** secrets. Talks only through the bridge.                            |

**Security baseline (non-negotiable, enforced in `BrowserWindow` config):**

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- A strict **Content-Security-Policy** (no remote code; `script-src 'self'`). No `<webview>`, no
  `allowRunningInsecureContent`, no remote module.
- Block in-app navigation to external origins and route external links to the OS browser.
- The renderer can reach the outside world **only** via typed IPC to main.

```
┌────────────┐  typed IPC (invoke/handle + events)  ┌──────────────────────────────┐
│  renderer  │  ───────────────────────────────────▶│  main                        │
│  (React)   │◀────────  push events (watch) ─────── │  vault · claude · keychain   │
└────────────┘        via preload contextBridge      └──────────────┬───────────────┘
                                                                     │ fs          │ https
                                                          ┌──────────▼──────┐  ┌────▼─────────┐
                                                          │  Vault folder    │  │  Claude API  │
                                                          │ (user-chosen)    │  │ (Anthropic)  │
                                                          └──────────────────┘  └──────────────┘
```

## 4. Data model — the vault

### 4.1 What lives where

Two storage locations with **different sync semantics** — this distinction is foundational:

| Location                                     | Synced?                      | Holds                                                                               |
| -------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| **Vault** (user-chosen folder)               | Yes (by the user's provider) | Human-readable content + portable preferences.                                      |
| **Device-local** (`app.getPath('userData')`) | No                           | The **Claude API key** (encrypted), window/session state, logs, regenerable caches. |

Proposed vault layout (a _pattern_; feature folders are added by their modules):

```
<vault root>/
  config/
    settings.json        # schema-driven settings registry persists here (portable, synced)
  .selfos/
    meta.json            # vault id, app schemaVersion, created/updated
  journal/  sessions/  … # added later by feature modules, e.g. journal/2026/06/2026-06-09.md
```

Rationale: keep content human-friendly at sensible top-level folders (Obsidian-style); keep portable
**preferences** in `config/`; keep a small amount of app metadata in a hidden `.selfos/`. The API key
and other device-bound state are **not** in the vault (it may sync to the cloud).

### 4.2 File formats

- **Markdown content** — YAML **frontmatter** (`id`, `schemaVersion`, `type`, `createdAt`,
  `updatedAt`, …) + Markdown body. Parsed/serialized via **`gray-matter`**.
- **JSON state/config** — an object with a top-level `schemaVersion` plus data.
- Every persisted format is defined by a **Zod schema** (the single source of truth); TS types are
  `z.infer`red. Validate on read and before write.

### 4.3 The vault service (main process)

The only code that touches `fs`. Responsibilities:

- **Atomic writes** — write to a temp file then `rename` over the target (atomic on the same
  filesystem). Serialize writes per path with a small queue to avoid interleaving.
- **Reads with validation** — parse, validate against the Zod schema, and run **migrations** if the
  file's `schemaVersion` is behind (see 4.4). Surface a typed error on corruption.
- **File-watching** — `chokidar`, debounced, **ignoring the app's own recent writes** (echo
  suppression) so external/synced changes emit `vault:changed` events to the renderer while our own
  saves don't loop.
- **Sync-conflict detection** — recognize provider conflict copies (Dropbox `… (conflicted copy …)`,
  iCloud / Drive variants) and the app's own optimistic-concurrency conflicts (on-disk `updatedAt`/
  hash changed unexpectedly before a write). **Never auto-delete**; surface for user resolution.

### 4.4 Schema versioning & migrations

- Each file type has a current `schemaVersion` and an ordered list of **migration functions**
  (`vN → vN+1`, pure). On read, migrations run in sequence to the current version; the migrated file
  is written back on next save.
- A small **migration registry** maps `type → migrations[]`. Migrations are unit-tested with fixtures
  of each prior version.

## 5. Architecture & modules

### 5.1 Layering

```
apps/desktop/src/
  main/         window, ipc handlers, services/{vault,claude,keychain}, logger
  preload/      contextBridge bridge (generated from the IPC contract)
  renderer/
    app/            shell: layout, router, theme provider, nav
    design-system/  tokens + primitive components (see 01-design-system.md)
    settings/       schema-driven registry + auto-generated UI (see 03-settings.md)
    features/       feature modules (empty in v1)
    shared/         renderer types, hooks, stores (Zustand), utils
  shared/       cross-process contract: IPC channel + Zod schemas + types (imported by all 3)
```

Shared code that outgrows one app is extracted to `packages/*` (e.g. `@selfos/design-system`,
`@selfos/core`, and **`@selfos/answering`** — the one questionnaire-answering renderer shared by the
Electron renderer and the relay page). A second app, **`apps/relay`** (08-questionnaires §5.4), is the
per-household **zero-knowledge Cloudflare Worker** + its static answering page: it builds to a single
self-contained `dist/worker.js` (the page bundle inlined) that the desktop app uploads via the Cloudflare
REST API; it stores only ciphertext (questions decrypt via a URL-fragment key, responses seal to a per-send
public key — neither key ever reaches the Worker). The relay's encrypted config (endpoint + drain secret +
Cloudflare token) lives in the vault at `config/relay.enc`, host-side only, never crossing the IPC boundary.

### 5.2 Feature-module registry (the "scale infinitely" backbone)

A feature is a self-contained module that **registers** what it contributes. The shell renders
whatever is registered and knows nothing about specific features.

```ts
// renderer-side registration
interface FeatureModule {
  id: string; // unique kebab-case
  title: string;
  nav?: { label: string; icon: IconName; order: number; path: string };
  routes?: Array<{ path: string; element: React.ComponentType }>;
  settings?: SettingDefinition[]; // merged into the settings registry (see 03-settings.md)
  vaultSchemas?: VaultSchemaId[]; // file types this feature owns (defined in shared/)
}
```

- Features that need **main-process logic** (custom file ops, external calls) register a coordinated
  **main-side half** (IPC handlers + vault schemas) sharing types from `src/shared`. The two halves
  are wired by a `defineFeature` helper so a feature is added in one place.
- The shell imports an explicit **array of enabled modules** at startup (static for now; could become
  user-toggleable later). Order and nav come from the registrations.

This contract is defined here and exercised first by the **Settings** feature in
[`03-settings.md`](03-settings.md).

### 5.3 State management

- **Zustand**, several small stores by concern (e.g. `settingsStore`, `themeStore`, `vaultStore`,
  `navStore`) — no mega-store. Stores hold UI/session state; **persistence flows through IPC** to the
  vault (debounced), never direct `fs`.

## 6. IPC / API contracts

### 6.1 Typed IPC layer

- Channels are declared once in `src/shared` as a **contract**: channel name + **request/response Zod
  schemas** (+ event payload schemas). The preload bridge is generated/derived from the contract so
  there's a single source of truth (DRY).
- **Request/response:** `ipcRenderer.invoke` ↔ `ipcMain.handle`. **Push events** (e.g.
  `vault:changed`, Claude streaming tokens): `webContents.send` ↔ a typed subscription exposed by
  preload.
- **Validate payloads with Zod on both sides** (defense in depth). On failure, return a typed error.
- **Errors cross IPC as a serializable envelope** `{ code, message, details? }`; the renderer rehydrates
  it into a typed error and handles it (see §7 / §10).

### 6.2 Claude API boundary

- The **API key is device-local by default**, encrypted via Electron **`safeStorage`** (OS keychain),
  under `userData`. **Amended by [`25-household-ai-credentials`](25-household-ai-credentials.md):** the
  household Owner may **opt in** to sharing the key — it is then stored **encrypted under the master key**
  in the vault (`config/ai-credentials.enc`, the same posture as the relay token in `config/relay.enc`), so
  member devices inherit it; a device-local override always takes precedence. Whether device-local or
  shared, the **resolved key value is never logged and never sent to the renderer** (readiness crosses IPC
  as booleans only).
- Main exposes IPC such as `claude:sendMessage` that proxies to the Anthropic API (official SDK),
  with **streaming** delivered to the renderer as push events. The renderer passes message content;
  the key and HTTP live in main only.
- **Model** is a user setting (see 03-settings), defaulting to **`claude-sonnet-4-6`** (fast,
  cost-effective, strong for conversation) with **`claude-opus-4-8`** selectable for more depth. Token
  limits, rate limits, network failures, and timeouts produce typed, user-friendly errors and a retry
  path.
- **Consent & minimization:** the user explicitly enables AI; we send only what a feature needs.

## 7. States & edge cases (cross-cutting)

The intended behavior for conditions every feature must handle:

- **No vault selected** (first run) → the shell shows vault selection before anything else (see
  [`02-app-shell.md`](02-app-shell.md)).
- **Vault path missing/unmounted** (e.g. cloud folder offline) → clear recoverable error; offer to
  relocate/reselect; never lose data.
- **Offline / no Claude key** → AI features degrade gracefully and explain; non-AI features keep
  working fully.
- **Corrupt or invalid file** → typed error; quarantine the bad file (don't crash), surface to user.
- **Schema behind** → migrate transparently on read; write back on next save.
- **Sync conflict** → detect, never auto-delete, present a resolution affordance.
- **Concurrent external edit** (another device synced a change) → `vault:changed` event refreshes the
  UI; if mid-edit, detect the optimistic-concurrency conflict and prompt.
- **Large data** → reads are streamed/paginated where size warrants; no synchronous mega-reads on the
  UI thread.

## 8. Safety & sensitive data (technical)

- All user content is treated as **highly sensitive**. It is never logged; logs **redact** content
  and secrets. The API key never appears in logs, errors, the vault, or the renderer.
- Crisis/wellbeing handling is a **feature-level** requirement (defined in each conversational
  feature's spec per [`CLAUDE.md`](../../CLAUDE.md)); this layer guarantees the data-handling
  substrate.

## 9. Accessibility

Defers to [`01-design-system.md`](01-design-system.md) (focus, contrast, keyboard, reduced-motion).
The shell and all primitives must meet those standards; no architectural blockers here.

## 10. Error handling & logging

- A typed **`AppError`** with a `code` enum (e.g. `VAULT_NOT_FOUND`, `FILE_CORRUPT`,
  `SCHEMA_INVALID`, `CLAUDE_UNAVAILABLE`, `IPC_INVALID_PAYLOAD`) and an optional `cause`.
- **Expected, recoverable** outcomes (missing file, conflict) are modeled as **`Result<T, AppError>`**
  returns; **unexpected** failures (programmer errors) throw and are caught at the boundary.
- **Logger** in main writes leveled logs to `userData/logs` (rotated), with redaction. Renderer logs
  route through IPC in production; dev console only otherwise.

## 11. Testing strategy

- **Unit (Vitest, node):** schemas, migrations, vault-service helpers, IPC payload validation, the
  module registry.
- **Component (Vitest + jsdom + RTL):** renderer components/hooks/stores.
- **Integration (Vitest, node):** the vault service against a **temp directory** (real `fs` in
  `os.tmpdir()`), covering atomic writes, watching (echo suppression), conflicts, and migrations.
- **E2E (Playwright + Electron):** launch the built app against a **throwaway temp vault**, with the
  Claude client replaced by an injectable **fake** (deterministic, offline). Covers first-run vault
  selection and the settings flows.
- The Claude client is an **interface** with a real and a fake implementation, selected by
  environment, so tests never hit the network.

## 12. Resolved decisions

Confirmed with the user (2026-06-09):

1. **Storage split** — portable preferences (`config/settings.json`) live in the synced vault; the
   **API key + window state stay device-local** (encrypted via `safeStorage`, never synced). Proposed
   folder layout (`config/`, `.selfos/`, per-feature content folders) accepted.
2. **Default Claude model** — `claude-sonnet-4-6` by default; `claude-opus-4-8` selectable in Settings.
3. **Error model** — `Result<T, AppError>` for expected/recoverable outcomes; throw for unexpected
   (programmer) errors.
4. **Markdown frontmatter** — use `gray-matter`.

_No open questions remain. New questions that arise during implementation are appended here._

## 13. Changelog

- 2026-06-09 — created (draft) per the approved foundation plan.
- 2026-06-09 — resolved all open questions (storage split, default model, error model, frontmatter
  lib) after review; folded decisions into the spec.
