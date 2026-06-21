# 26 — Settings trust boundary

> **Status:** Draft · _last updated 2026-06-21_
>
> A small, focused security-hardening spec. The settings-write IPC handlers (`setSetting`/
> `resetSetting`) currently have **no capability gate**, so any signed-in person — Member or Guest —
> can write any vault-scoped (household-wide) setting over the seam, and the `adminOnly` flag is only
> _display-filtered_ in the renderer, never enforced. This spec moves settings enforcement into the
> bridge (the trust boundary per [`00-architecture.md`](00-architecture.md) §6) and establishes a
> **single shared source of truth** for which setting keys are admin-only, so display-hiding and
> server-rejection can never drift.

This spec amends [`03-settings.md`](03-settings.md) — it changes nothing about the schema-driven
settings _model_, only **who is allowed to write** a setting and **where that is enforced**.

---

## 1. Overview

SelfOS is built on a hard rule: **the bridge is the trust boundary, not the UI**
([`00-architecture.md`](00-architecture.md) §6; `CLAUDE.md` §3.4, §12). Capability checks live in
`coreBridge.ts` (`activePersonCan`), and the renderer's gating is only convenience.

Settings violate this rule today. In `apps/desktop/src/shared/coreBridge.ts` the `setSetting` and
`resetSetting` handlers (~lines 768–793) write to `config/settings.json` (vault) or device settings
with **no capability check**. Because many vault-scoped settings are **household-wide** —
`ai.enabled`, `ai.model`, `dreams.imageModel`, `dreams.imageGenerationEnabled`,
`questionnaires.intimacyTopics`, `questionnaires.defaultMessages`, `sessions.memoryEnabled`, the
relay panel, … — a Member or Guest can change them for everyone via devtools / a crafted IPC call.

The `adminOnly` flag (e.g. on `dreams.imageModel`, `questionnaires.intimacyTopics`, `relay.connection`)
is enforced **only** by the renderer's `SettingsScreen`/`SettingField`
(`!def.adminOnly || isAdmin`). The bridge does not know `adminOnly` exists. A non-admin who never
sees the control can still write its key directly.

This spec closes both gaps. It sits underneath [`03-settings.md`](03-settings.md) (the settings
system) and complements the household-AI-credential and device-registry work it explicitly does
**not** cover (see §2 Non-goals).

## 2. Goals / Non-goals

**Goals**

- **Capability-gate vault-scoped writes.** `setSetting`/`resetSetting` for a `scope:'vault'` setting
  require the `settings.manage` capability (the Owner/admin gate already used by the relay handlers,
  budgets, etc.). A non-`settings.manage` caller is **rejected at the bridge**.
- **Enforce `adminOnly` server-side.** The set of admin-only setting **keys** becomes a single shared
  module imported by **both** the renderer registry (for display-hiding) and the bridge (for
  rejection), so the two can never diverge. An `adminOnly` setting is admin-write-only regardless of
  scope.
- **Keep device-scoped writes ungated** (cosmetic/per-device), with one deliberate, documented rule
  for the shared-device case.
- **Members still _use_ AI** even though they no longer _write_ `ai.enabled` — they read the
  household value; and a member's "use my own key" override remains available (it's a **secret**
  write, not a setting write).
- One source of truth drives both the display-hide and the bridge-reject (verified by tests).

**Non-goals**

- **The AI-credential / key-sharing model itself** (household key vs per-member key, inheritance,
  the "use my own key instead" override semantics) — owned by the **household-AI-credentials spec**
  (the spec the user refers to as "spec 25"; this spec only guarantees the IPC seams that model
  relies on stay open to members, see §3.4). This spec does **not** introduce or change any
  credential.
- **Device registry / revocation** (tracking which devices hold the key, revoking a lost device) —
  owned by the **device-registry spec** ("spec 28"). The shared-device nuance is _noted_ here (§3.3)
  but its full handling is deferred there.
- No change to the setting **definition** shape, the registry, persistence, validation, or migration
  — all per [`03-settings.md`](03-settings.md).
- No new capability is introduced — `settings.manage` already exists.

## 3. UX & flows

This is primarily a **developer-facing / trust-boundary** change. The user-visible surface is
unchanged for admins and already-correct-by-display for non-admins; the fix makes the _enforcement_
real. Each flow below names the bridge behavior.

### 3.1 Admin (Owner / `settings.manage`) writes a setting

Unchanged. The control is shown; `setSetting`/`resetSetting` succeed. (The relay/dream/intimacy
admin controls already only render for admins via `SettingsScreen`'s `adminOnly` filter.)

### 3.2 Non-admin (Member / Guest) — the controls they should not touch

- **Display:** `adminOnly` settings are already filtered out of `SettingsScreen` for non-admins
  (`!def.adminOnly || isAdmin`) — unchanged.
- **Enforcement (new):** if a non-`settings.manage` person calls `setSetting`/`resetSetting` for **any
  vault-scoped setting** (whether or not it's `adminOnly`), or for **any `adminOnly` setting** (even
  a device-scoped one, should one ever exist), the bridge **rejects** with `Error('Not permitted')`
  — matching the relay handlers' rejection style (`coreBridge.ts` ~2547). Nothing is written; the
  vault file is untouched.
- The renderer never normally issues such a call; the reject defends against devtools / a crafted IPC
  message / a future UI bug. The renderer **should not** surface a vault/`adminOnly` control to a
  non-admin (it already doesn't), but the bridge is the boundary.

### 3.3 Device-scoped settings (appearance, sidebar, resume-to-last-route, …)

- **Rule:** device-scoped writes (`scope:'device'`, written to `userData`, not synced) are
  **ungated**, with one exception: a setting that is **also** `adminOnly` (none today) is still
  admin-only regardless of scope.
- **Justification:** device settings are cosmetic/local and per-device — they do not affect anyone
  else and are not synced into the shared vault. Gating them would block the common, correct case
  (each person tuning their own appearance/text-size) for no security benefit; there is no
  household-wide blast radius.
- **Shared-device nuance (noted, not fully solved here):** when multiple personas use **one physical
  machine**, the device settings file is shared by the device, so persona A changing appearance
  affects what persona B sees on that device. This is accepted for v1 (it's cosmetic and local; the
  appearance is re-tunable by anyone, and it never leaves the device or touches the vault). Making
  device settings _per-persona_ (or attributing device writes to a logged-in device identity) is a
  **device-registry** concern and is **deferred to that spec ("spec 28")**. This spec's rule is the
  clear, defensible default until then: device-scoped = ungated; vault-scoped + adminOnly = gated.

### 3.4 AI for members — inherit, don't toggle (interplay with the household-AI-credentials spec)

Once `ai.enabled` (and `ai.model`) require `settings.manage`, **members no longer toggle AI**. The
Owner enables AI **once**, household-wide; members **inherit** it.

This spec guarantees the seams members rely on stay open to them **without** `settings.manage`:

- **Reading the setting is not a write.** `getSettings` returns the vault values to any signed-in
  person (it is a read, not gated by `settings.manage`). Members read `ai.enabled`/`ai.model` to know
  AI is on and which model to use — they never call `setSetting` for it.
- **Using AI is gated by the AI/feature capabilities** (e.g. `sessions.own`, `questionnaires.create`,
  `dreams.generateImage`, `memory.own`), **not** by `settings.manage`. Gating settings-writes does
  **not** gate AI _usage_.
- **The "use my own key instead" member override is a _secret_ write, not a _setting_ write.** A
  member supplying their own API key calls `secretSet` (per-device keychain), which is **not** routed
  through `setSetting` and is **not** gated by `settings.manage`. That path stays available to members
  on their own device. The full override semantics (when it applies, precedence vs the household key)
  are owned by the **household-AI-credentials spec** — this spec only commits to **not** closing the
  `secretSet` path when it gates `setSetting`.

> Cross-check on review: confirm `ai.enabled` / `ai.model` are `scope:'vault'` (household-wide) so
> the gate applies, and that no member flow writes them. The member key override must remain a
> `secretSet` call, never a `setSetting('ai.enabled', …)` call.

## 4. Data model (vault files & schemas)

No new files; no schema-version bump. This spec adds **one shared constant module**, not persisted
data.

### 4.1 The shared admin-only key list (single source of truth)

A new shared module under `apps/desktop/src/shared/` (importable by both the bridge in
`src/shared/coreBridge.ts` **and** the renderer registry in
`src/renderer/src/settings/builtins.tsx` — `@shared/channels` is already imported by
`renderer/src/settings/types.ts`, confirming `src/shared/` is reachable from the renderer):

```ts
// apps/desktop/src/shared/settingsPolicy.ts  (no React, no renderer deps)

/**
 * Setting KEYS that only a `settings.manage` admin may write — enforced in the bridge AND used to
 * hide the control in the renderer. ONE source so display-hiding and server-rejection never drift.
 * Keep in sync with the `adminOnly` settings declared in renderer/src/settings/builtins.tsx
 * (a test asserts the two agree — §10).
 */
export const ADMIN_ONLY_SETTING_KEYS = [
  'dreams.imageModel',
  'dreams.imageApiKey',
  'questionnaires.intimacyTopics',
  'relay.connection',
  // …any future adminOnly key is added HERE, then referenced from its SettingDefinition.
] as const;

export type AdminOnlySettingKey = (typeof ADMIN_ONLY_SETTING_KEYS)[number];

const adminOnlyKeySet: ReadonlySet<string> = new Set(ADMIN_ONLY_SETTING_KEYS);

/** True if writing `key` requires `settings.manage` because it is flagged admin-only. */
export function isAdminOnlySettingKey(key: string): boolean {
  return adminOnlyKeySet.has(key);
}
```

- **Renderer consumes it for display.** The `defineSetting` declarations stop hard-coding
  `adminOnly: true` inline; instead the registry derives each definition's `adminOnly` from
  `isAdminOnlySettingKey(def.key)` (or asserts `adminOnly === isAdminOnlySettingKey(key)` so the two
  agree — see §5.1). `SettingsScreen`/`SettingField` keep using `def.adminOnly` exactly as today.
- **Bridge consumes it for enforcement.** `setSetting`/`resetSetting` call `isAdminOnlySettingKey`.

The list is **keys**, not the full `SettingDefinition`, so it carries no React/control/component
imports and is safe in the host/main bundle.

### 4.2 Ownership

All settings reads/writes continue to go through the vault service / device-settings host as in
[`03-settings.md`](03-settings.md) §4.2. This spec only inserts capability checks _before_ the
existing write; the persistence path is unchanged.

## 5. Architecture & modules

### 5.1 New / changed

- **New:** `apps/desktop/src/shared/settingsPolicy.ts` — `ADMIN_ONLY_SETTING_KEYS` +
  `isAdminOnlySettingKey` (§4.1). The single source of truth.
- **Changed — bridge (`apps/desktop/src/shared/coreBridge.ts`, `setSetting`/`resetSetting`):**
  add gating before any write (§6).
- **Changed — renderer registry (`renderer/src/settings/builtins.tsx` / `registry.ts`):** derive or
  validate `def.adminOnly` against `isAdminOnlySettingKey(def.key)` so a definition flagged
  `adminOnly` in the renderer is also in the shared list (and vice-versa). The display path
  (`SettingsScreen`, `SettingField`) is otherwise unchanged.

### 5.2 Enforcement logic (precise)

For both `setSetting` and `resetSetting`, after parsing `{ key, scope }` and **before** any write:

```
needsAdmin = (scope === 'vault') || isAdminOnlySettingKey(key)
if needsAdmin:
    ctx = host.vaultAndKey()
    if !ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')):
        throw new Error('Not permitted')      // nothing written
# device-scoped, non-adminOnly: proceed ungated (existing behavior)
```

- `scope:'vault'` ⇒ always requires `settings.manage` (every vault setting is household-wide).
- An `adminOnly` key requires `settings.manage` even if device-scoped (future-proofing; none today).
- `scope:'device'` + not `adminOnly` ⇒ ungated (§3.3).
- The reject is thrown (matching relay handlers), so the typed IPC surface returns a rejected promise;
  the existing `getSettings` read is **not** gated.

## 6. IPC / API contracts

No channel signatures change ([`03-settings.md`](03-settings.md) §6 stands):

- `setSetting({ key, value, scope })` → now **rejects** (`Error('Not permitted')`) when
  `needsAdmin` (§5.2) and the active person lacks `settings.manage`; otherwise unchanged.
- `resetSetting({ key, scope })` → same gate.
- `getSettings()` → **unchanged and ungated** (a read; members must read vault values incl.
  `ai.enabled`/`ai.model`, per §3.4).
- `secretSet`/`secretHas`/`secretClear` → **unchanged and ungated** — the member "own key" override
  rides `secretSet` (§3.4), so this spec must not gate it.

Claude API: N/A — no model call in this spec.

## 7. States & edge cases

- **Member/Guest writes a vault setting** → rejected; vault file byte-unchanged; no partial write.
- **Member/Guest writes an `adminOnly` device setting** (none today, future-proof) → rejected.
- **Anyone writes a device-scoped, non-`adminOnly` setting** (appearance, etc.) → succeeds (§3.3).
- **No vault unlocked / no active person** (`!ctx`) on a `needsAdmin` write → rejected (`Not
permitted`) — fail-closed, same as the relay handlers.
- **Owner / `settings.manage`** on any setting → succeeds (unchanged).
- **Concealed-super-admin removed (2026-06-15):** the Owner is the full-access role; `activePersonCan`
  already returns true for the Owner, so the Owner writes everything. No separate bypass.
- **`getSettings` for a member** → returns vault + device values unchanged (read path not gated).
- **Drift between the shared list and the renderer flags** → caught by the §10 sync test, not at
  runtime; the bridge is correct regardless because it reads the shared list directly.
- **A new `adminOnly` setting added later** → the author adds the key to `ADMIN_ONLY_SETTING_KEYS`;
  display + enforcement both follow from that one edit (and the §10 test fails if they forget the
  `SettingDefinition` flag).
- **Sync conflict on `settings.json`** → unchanged from [`03-settings.md`](03-settings.md) §7; gating
  happens before the write, conflict handling after.

## 8. Safety

N/A for wellbeing/crisis content — this is a pure access-control hardening with no conversation or
generated content. It does, however, **strengthen** a privacy/safety-adjacent boundary: household-wide
toggles (e.g. `sessions.memoryEnabled`, `dreams.imageGenerationEnabled` which consents to sending a
dream description to OpenAI, the intimacy-topics list) can no longer be flipped by a non-admin, so a
Member or Guest cannot silently change what the household shares or how AI behaves for everyone.

## 9. Accessibility

N/A — no new UI. The existing admin-only controls already carry the "Admin only" badge
(`SettingField`, [`03-settings.md`](03-settings.md) §5.4) and are filtered for non-admins; both are
unchanged. No control is added or restyled.

## 10. Testing strategy

**Unit (Vitest) — the policy module:**

- `isAdminOnlySettingKey` returns true for each listed key, false for an unlisted one.

**Unit (Vitest) — the bridge (`coreBridge` against the in-memory host, the established pattern):**

- A **Member** (no `settings.manage`) calling `setSetting` for a **vault** setting (e.g.
  `sessions.memoryEnabled`) is **rejected** and the vault settings file is **unchanged** (decrypt/read
  to assert no write).
- A **Member** calling `setSetting` for an **`adminOnly`** setting (e.g. `dreams.imageModel`,
  `questionnaires.intimacyTopics`) is **rejected**.
- A **Member** calling `resetSetting` for a vault/`adminOnly` setting is **rejected**.
- The **Owner** (`settings.manage`) calling the same `setSetting`/`resetSetting` **succeeds** and the
  value round-trips.
- A **Member** writing a **device-scoped, non-`adminOnly`** setting (appearance) **succeeds** (§3.3).
- A **Member** calls `getSettings` and **reads** `ai.enabled`/`ai.model` (read path ungated, §3.4).
- A **Member** calls `secretSet` for their own key and it **succeeds** (the override path stays open,
  §3.4) — assert `secretSet` is not routed through the settings gate.

**Sync / single-source test (the DoD anchor):**

- A test asserts the renderer's `adminOnly` declarations and `ADMIN_ONLY_SETTING_KEYS` **agree
  exactly** — every `SettingDefinition` with `adminOnly: true` is in the shared list, and every key
  in the shared list maps to a definition flagged `adminOnly`. This proves the one-source rule:
  display-hide and bridge-reject are driven by the same set.

**Component (RTL):** no new UI; existing `SettingsScreen`/`SettingField` adminOnly-filter tests stand.

**E2E (Playwright):**

- Sign in as a Member; assert the `adminOnly` controls are absent in Settings (existing behavior),
  and that a direct bridge `setSetting('dreams.imageModel', …)` / a vault setting **rejects** (driven
  through the bridge in the E2E harness) — the user-facing surface plus the trust boundary, per
  `CLAUDE.md` §7.
- Sign in as the Owner; the same write **succeeds** and persists across relaunch.

Vault and host are mocked per the existing `coreBridge` test/host harness; no Claude mock needed.

## 11. Open questions

- **Reject vs silent no-op for `resetSetting`.** Today `resetSetting`/`setSetting` silently return
  when there's no vault. This spec specifies a **throw** (`Not permitted`) for a denied write to match
  the relay handlers and give the renderer a clear signal. Confirm throwing (vs returning a `Result`
  / silent no-op) is the desired contract for a denied settings write. _(Recommendation: throw, for
  parity with relay/budget handlers.)_
- **Device-scoped per-persona (shared device).** §3.3 keeps device settings ungated + shared-per-
  device for v1 and defers per-persona device settings to the device-registry spec. Confirm that's
  acceptable, i.e. that one persona changing appearance on a shared machine affecting another persona
  on **that machine only** is fine for now.
- **Should `ai.enabled`/`ai.model` scope be re-confirmed as `vault`?** The gate assumes they're
  household-wide vault settings. If the household-AI-credentials spec ("spec 25") later makes any AI
  setting device-scoped (e.g. a per-device key marker), revisit which AI settings are gated here.

## 12. Changelog

- 2026-06-21 — created (Draft). Security-hardening spec: capability-gate vault/`adminOnly` settings
  writes in the bridge + a shared `ADMIN_ONLY_SETTING_KEYS` single source of truth. Amends
  [`03-settings.md`](03-settings.md) §4.1/§6 (vault-setting writes are now `settings.manage`-gated in
  main and `adminOnly` is enforced server-side). Cross-refs [`00-architecture.md`](00-architecture.md)
  §6; defers the AI-credential model and device registry to their own specs.
