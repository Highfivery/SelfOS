# 03 — Settings

> **Status:** Approved · _last updated 2026-06-09_
>
> The v1 centerpiece: a **schema-driven settings system**. Every setting is one declarative,
> Zod-backed definition; the Settings UI, persistence, validation, and typed access are all derived
> from those definitions. Adding a setting = adding one declaration, anywhere in the app — no UI or
> storage code to touch. This is the pattern that makes SelfOS "infinitely configurable."

Settings is itself a **feature module** (per [`00-architecture.md`](00-architecture.md) §5.2) — it
registers its own nav entry and route, and it owns the registry that other modules contribute to.

---

## 1. Overview

A **setting definition** is the single source of truth for one setting: its key, label, type
(Zod schema), default, the control to render, where it persists, and when it's visible. Features
register definitions; the system:

- **generates the Settings UI** (sections → controls) automatically,
- **persists** values to the right place (synced vault vs device-local),
- **validates** on read/write and supplies defaults/migrations,
- exposes **typed access** (`useSetting('appearance.theme')`) with full inference.

Nothing about a setting is written twice.

## 2. Goals / Non-goals

**Goals**

- One declaration per setting; **zero** bespoke UI/persistence per setting.
- A small, extensible set of **control types** mapped to design-system primitives.
- **Type-safe** get/set by key.
- Correct **scope** handling (synced preference vs device-local/secret).
- A clean **registration** API features use; resilient load with defaults, validation, migration.

**Non-goals**

- No remote/cloud settings sync (it rides the vault's file sync).
- No settings import/export in v1 (designed-for; see Open questions).
- The API **key value** is never stored in settings files (handled via the keychain — see §6).

## 3. UX & flows

- **Settings screen** (`/settings`): a left list of **sections** (Appearance, General, Vault, AI,
  About) + a content pane that renders that section's settings in order. A **search** field filters
  across labels/descriptions/tags. Each control shows label, optional help text, validation error,
  and a per-setting **reset-to-default**.
- **Live apply:** changing a setting updates state immediately (e.g. theme switches instantly); the
  value is persisted in the background (debounced, atomic).
- **Conditional settings:** a setting can hide until a condition holds (e.g. "Model" appears only when
  "Enable AI" is on).

## 4. Data model

### 4.1 The setting definition

```ts
type SettingControl =
  | { type: 'switch' }
  | { type: 'text'; placeholder?: string; multiline?: boolean }
  | { type: 'number'; min?: number; max?: number; step?: number; variant?: 'input' | 'slider' }
  | {
      type: 'select';
      options: ReadonlyArray<{ value: string; label: string }>;
      variant?: 'dropdown' | 'segmented' | 'radio';
    }
  | { type: 'multiselect'; options: ReadonlyArray<{ value: string; label: string }> }
  | { type: 'color' }
  | { type: 'path'; kind: 'folder' | 'file' } // opens a native dialog via IPC
  | { type: 'secret' } // masked; stored in the keychain, not in files
  | { type: 'custom'; component: SettingComponentId }; // escape hatch for bespoke controls

interface SettingDefinition<T = unknown> {
  key: string; // namespaced, e.g. 'appearance.theme'
  section: string; // section id this belongs to
  label: string;
  description?: string;
  schema: z.ZodType<T>; // source of truth for value type + validation
  default: T;
  control: SettingControl;
  scope?: 'vault' | 'device'; // default 'vault' (synced). 'device' = userData (not synced)
  order?: number;
  visibleWhen?: (values: SettingsValues) => boolean;
  tags?: string[]; // search keywords
  requiresRestart?: boolean;
}

interface SettingsSection {
  id: string;
  title: string;
  description?: string;
  icon: IconName;
  order: number;
}
```

A `defineSetting<T>()` helper preserves `T` from the schema so `default` and `useSetting` are checked
against it.

### 4.2 Persistence

- **Vault-scoped** values → `config/settings.json` in the vault (synced):
  `{ "schemaVersion": 1, "values": { "appearance.theme": "system", ... } }`.
- **Device-scoped** values → an equivalent file in `userData` (not synced).
- **Secrets** (API key) → the OS keychain via `safeStorage` (main); settings files store at most a
  non-sensitive `configured: true` marker. The key value never appears in any file.
- Writes are **debounced + atomic** through the vault service (per `00-architecture.md` §4.3).

### 4.3 Load, validate, migrate

- On load, for each **registered** key: validate the stored value against its `schema`; on
  missing/invalid → use `default` (and log a redacted warning for invalid). **Unknown** keys (from a
  newer version) are **preserved untouched** for forward-compatibility, not dropped.
- File-level `schemaVersion` drives migrations (per-file, like all vault formats).

## 5. Architecture & modules

### 5.1 The registry

- `registerSettingsSection(section)` and `registerSettings(defs: SettingDefinition[])` collect
  contributions at startup. The registry **enforces unique keys** and known sections.
- It builds a runtime map `key → definition` and a derived **master Zod schema** (`z.object` over all
  keys) used to validate the whole settings object.
- **End-to-end type safety:** features extend a declaration-merged `interface SettingsTypeMap { 'appearance.theme': Theme; … }` (via module augmentation). `SettingsValues = SettingsTypeMap`, so
  `useSetting(key)` infers the exact value type by key.

### 5.2 Typed access

```ts
const [theme, setTheme] = useSetting('appearance.theme'); // theme: Theme
getSetting('ai.model'); // typed read (non-React)
setSetting('appearance.density', 'compact'); // validated, persisted, applied
resetSetting('appearance.theme'); // back to default
```

`setSetting` validates via the definition's `schema`, updates `settingsStore`, persists via IPC
(debounced), and notifies subscribers (e.g. `themeStore` applies appearance live).

### 5.3 Auto-generated UI

- The Settings screen reads the registry: render sections (by `order`), then each section's
  visible settings (by `order`), each as a `Field` + a control resolved from `control.type` →
  a design-system primitive. `visibleWhen` controls visibility; search filters by label/description/
  tags.
- A `controlRegistry` maps `control.type → React component`, so adding a new control type is one
  entry — keeping the UI generator DRY and extensible.

### 5.4 Initial settings (validates the system end-to-end in v1)

| Section    | Settings                                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appearance | theme (select), accent (select), density (segmented), text size (slider), reduce motion (switch), high contrast (switch) — drive [`01-design-system.md`](01-design-system.md)                                                       |
| General    | resume to last route (switch) — see [`02-app-shell.md`](02-app-shell.md)                                                                                                                                                            |
| Vault      | current location (read-only path), change vault (path), reveal in file manager (action)                                                                                                                                             |
| AI         | enable AI (switch), API key (`secret`, device scope), model (select; default `claude-sonnet-4-6`, `claude-opus-4-8` option) — model/key hidden unless AI enabled                                                                    |
| Relay      | **`adminOnly`** Cloudflare relay panel (`custom` control): connect (account id + scoped token) → provision + deploy the zero-knowledge Worker, status, update, teardown — the token never crosses IPC (08-questionnaires §3.8/§5.2) |
| About      | version, the wellness/not-medical statement                                                                                                                                                                                         |

The `custom`-control `SettingField` renders the **"Admin only"** badge alongside the label for an
`adminOnly` setting (so a bespoke admin panel like Relay is marked the same as a switch), and the Settings
screen filters `adminOnly` settings out entirely for non-admins.

## 6. IPC / API contracts

Typed channels (declared in `src/shared`, validated both sides):

- `settings:getAll` → `{ vaultValues, deviceValues }` (validated, defaults applied).
- `settings:set({ key, value, scope })` → persists; returns `Result`.
- `settings:reset({ key })`.
- `secret:set({ id, value })` / `secret:has({ id })` / `secret:clear({ id })` → keychain via
  `safeStorage`; values never returned to the renderer in plaintext beyond use.
- Reuses `vault:selectFolder` (app-shell) for the `path` control.

## 7. States & edge cases

- **Missing/invalid value** → default substituted; user can still edit; redacted warning logged.
- **Unknown keys** (older app, newer file) → preserved on round-trip; never deleted.
- **Conditional control** whose dependency changes → appears/disappears live without losing other
  values.
- **Secret set/cleared** → UI reflects "configured/not configured"; the value is never displayed.
- **Scope correctness** → device-scoped settings (and secrets) never written to the synced vault.
- **Concurrent external edit** of `settings.json` (sync from another device) → `vault:changed`
  reloads and reconciles; in-flight local edits use optimistic-concurrency handling.
- **Reset** → per-setting and (future) per-section/all.

## 8. Safety

The AI section makes the not-medical positioning and data-sharing implications visible at the point
the user enables AI / enters a key (consent + minimization per `00-architecture.md` §6.2 / §8).

## 9. Accessibility

Per [`01-design-system.md`](01-design-system.md) §9: every control is a labeled, keyboard-operable
primitive; sections are navigable landmarks; search is reachable; errors are announced; the
`secret` control supports show/hide with proper labeling.

## 10. Testing strategy

- **Unit:** the registry (unique-key enforcement, master-schema build); load/validate/migrate
  (missing/invalid/unknown keys); `setSetting` validation + persistence + scope routing; secret IPC
  never leaks plaintext.
- **Component (RTL):** the UI generator renders each control type; `visibleWhen` toggling; search
  filter; reset; error display; live theme apply.
- **Integration:** round-trip persistence to a temp vault (vault scope) and temp userData (device
  scope); unknown-key preservation; concurrent-edit reload.
- **E2E (Playwright):** open Settings, change appearance (see it apply), set/clear a (fake) API key,
  toggle a conditional setting, relaunch and confirm persistence.

## 11. Resolved decisions

Confirmed with the user (2026-06-09):

1. **Type-safety mechanism** — declaration-merged `SettingsTypeMap` (end-to-end inference).
2. **Unknown-key handling** — preserve untouched on save (forward-compatible).
3. **Settings layout** — sectioned list + content pane.
4. **Import/export** — deferred to a later version.

_No open questions remain. New questions that arise during implementation are appended here._

## 12. Changelog

- 2026-06-09 — created (draft) per the approved foundation plan.
- 2026-06-09 — resolved open questions (SettingsTypeMap typing, preserve unknown keys, sectioned
  layout, defer import/export) after review; marked Approved.
