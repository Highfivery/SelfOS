# 14 — Vault relinking: unlink & switch the vault folder

> **Status:** **Approved** · _last updated 2026-06-12_
>
> SelfOS picks its vault folder once at onboarding and has no way to change it afterward. This spec adds a
> guided **"Change vault…"** action in Settings → Vault that cleanly **detaches this device from the current
> vault** and drops the user back into the existing onboarding "Choose a folder" flow to pick a different
> one. Unlinking and switching are the **same** underlying operation — detach, then re-onboard. No data is
> ever deleted from disk; the old folder stays intact and re-openable (with its recovery phrase).

Extends [`10-multi-device-vault.md`](10-multi-device-vault.md) (vault identity, device join & recovery — the
key-free `vaultInitialized` marker and the three-way boot gate this feature relies on) and
[`02-app-shell.md`](02-app-shell.md) §3 (the boot gate / onboarding "Choose a folder" flow it re-enters).
Inherits the vault/IPC/crypto/device-local-vs-synced boundary from
[`00-architecture.md`](00-architecture.md) (esp. §4.1) and the dialog/token standards from
[`01-design-system.md`](01-design-system.md). No restatement of those here.

---

## 1. Overview

A SelfOS install points at exactly one vault folder, chosen at onboarding via the OS folder picker
(`selectVaultFolder()` → `useVault(path)`, `apps/desktop/src/renderer/src/stores/appStore.ts`). Today there is
**no path back**: once `userData/state.json → vaultPath` is set, the only ways to change it are quitting and
hand-editing state, or a vault error forcing re-selection. Users legitimately need to move: they set up against
a local folder and want to switch to an iCloud-Drive one (so the iPhone, `07`, can share it); they pointed at
the wrong folder; or they want to start a fresh, separate vault.

This feature adds **one** affordance — a **"Change vault…"** control in Settings → Vault — that opens a calm
confirmation dialog explaining what will happen, then performs a clean **unlink** and returns the user to the
existing onboarding "Choose a folder" screen. From there everything is **existing behavior**: the onboarding
flow + the `10` three-way `HouseholdGate` route the next folder correctly — a fresh folder → first-run
**Setup**, an already-initialized SelfOS vault → the **UnlockScreen** (recovery phrase or invite).

**Unlink == switch.** There is no separate "just unlink, don't pick a new one" mode. Detaching always lands the
user on onboarding's folder picker, which they can complete (pick a folder) or sit on (the app is in its
`onboarding` phase — the same state as a brand-new install). "Unlink and re-point" is the whole operation.

### 1.1 The single hard requirement: clearing the master key

The master key lives in **one** device-local slot — `userData/secrets.json → 'selfos.masterKey'`, a single
key, **not keyed per vault** (`packages/core/src/crypto/masterKey.ts`: `MASTER_KEY_ID`, `loadMasterKey`,
`storeMasterKey`; `SecretStore.clear(id)` in `packages/core/src/host/secretStore.ts`). The three signals that
drive boot routing are:

- **Active vault path** — `userData/state.json → vaultPath` (device-local, **not** synced;
  `apps/desktop/src/main/state/deviceStore.ts` `readDeviceState`/`writeDeviceState`/`updateDeviceState`).
- **Master key** — the single `secrets.json` slot above (device-local, Electron `safeStorage`).
- **"Vault initialized?"** — presence of `config/recovery.enc` in the vault (key-free;
  `isVaultInitialized`, `packages/core/src/crypto/masterKey.ts:45`).

Because the master key is one slot, **unlink must clear it** (`secrets.clear('selfos.masterKey')`). This is a
correctness requirement, not a preference — leaving a stale key behind produces broken boot states (§7.1, the
critical safety trap). Once the key is gone, the **existing** `HouseholdGate` logic (`vaultInitialized ×
hasMasterKey × hasOwner × activePersonId/pendingJoinPersonId`,
`apps/desktop/src/renderer/src/app/HouseholdGate.tsx`) routes the next folder correctly with **zero new routing
code**. This is precisely why unlink and switch are the same operation.

### 1.2 Decisions already made (not re-opened here)

These product decisions are **decided** and stated as such throughout:

1. **Master key is always cleared on unlink.** Re-opening the old vault on this device afterward requires the
   recovery phrase. Required for correctness (§1.1 / §7.1), not optional.
2. **Flow is a guided "Change vault…" action.** One button in Settings → Vault → a confirmation/explainer
   dialog → the existing onboarding "Choose a folder" screen → the existing `HouseholdGate` routes the picked
   folder (fresh → Setup, existing SelfOS vault → UnlockScreen).
3. **Any signed-in person can do it** — **not** admin-only. The vault path is a device-local choice, like
   onboarding itself (which has no auth gate). No `AdminOnlyBadge`.
4. **Spec first** (this document), then implementation in slices (§13).
5. **Device API keys are kept on unlink** — `anthropic.apiKey` / `openai.apiKey` are personal device
   configuration, not vault data; switching vaults does not force re-entering them (§7.4).
6. **The dialog is hand-rolled, not a new design-system primitive** — it follows the existing
   LockScreen/Switcher `role="dialog"` pattern; no shared `Dialog`/`Modal` primitive is introduced (§5.3).
7. **The VaultError boot screen gets the same "Use a different vault" affordance in this build** (not deferred)
   — it reuses `vault:unlink` and, in doing so, fixes a latent stale-key bug in that screen's existing
   "Choose a different folder" path (§7.7).

## 2. Goals / Non-goals

**Goals**

- A discoverable, reversible-feeling way to **unlink the current vault and select a different one**, from
  Settings → Vault, after onboarding.
- A **clean detach**: stop the watcher, clear the device-local master key, clear `vaultPath` +
  `activePersonId` + `pendingJoinPersonId`, reset the in-memory super-admin inspect flag, reset all
  person-scoped renderer stores, and route back to the onboarding folder picker — **without touching any bytes
  inside the vault on disk**.
- **No data loss, ever.** The old vault folder (including `config/recovery.enc`, `people/`, all `.enc` content)
  is left **byte-for-byte intact** and re-linkable later via its recovery phrase. This mirrors `10`'s headline
  non-overwrite guarantee.
- **Reuse, not reinvent.** Re-point through the existing onboarding flow + the existing three-way
  `HouseholdGate` — no new Setup/Unlock/routing screens. The only genuinely new backend logic is one
  main-process op (`vault:unlink`); the only genuinely new UI is the Settings control + its confirmation
  dialog.
- **Platform-consistent.** The op is wired through the typed `SelfosBridge` seam so the iOS host (`07`) gets it
  for free via `createCoreBridge`, except the watcher start/stop, which is platform-specific and stays in
  `ipc.ts` (like `useVault`).
- **A correct escape hatch from a broken vault path.** The **VaultError** boot screen (recorded `vaultPath`
  unreachable) gains a "Use a different vault" action backed by the same `vault:unlink`, so a user whose vault
  folder moved/disappeared can cleanly switch — and that path is **key-safe** (§7.7).

**Non-goals**

- **Per-vault key storage / multi-vault key retention.** We do not keep a stash of master keys keyed by vault
  so the old vault re-opens without its recovery phrase. The single-slot model stands; re-linking an old vault
  is a recovery-phrase unlock (the `10` path). A future "recent vaults" convenience is out of scope.
- **Deleting or moving vault data.** Unlink never deletes, moves, or rewrites anything inside the vault folder.
  "Forget this vault and erase it" is explicitly not offered.
- **Migrating / copying data between vaults.** Switching folders does not copy content from the old vault to
  the new one. Each vault is independent.
- **Clearing the user's personal device secrets** (the Claude / OpenAI API keys). They are the user's
  device-level configuration, not vault data; **recommendation: keep them** on unlink (§7.4 — open question
  flagged in §11).
- **A new Dialog/Modal design-system primitive.** The app has no Modal primitive and hand-rolls
  `role="dialog"` overlays; this spec follows that pattern (§5.3). Introducing a shared `Dialog` primitive is
  optional and out of scope unless the user wants it (§11).
- _(No deferral of the VaultError affordance — it is **in scope** this build per decision #7, §7.7.)_

## 3. UX & flows

### 3.1 Entry point — Settings → Vault

Today the Vault settings section (`apps/desktop/src/renderer/src/settings/builtins.tsx`, section id `vault`)
holds two rows, both custom controls in `apps/desktop/src/renderer/src/settings/customRows.tsx`:

- `vault.location` → `VaultLocationValue` (the current path, read-only text).
- `vault.reveal` → `RevealVaultRow` (a "Reveal in file manager" button).

This feature adds a **third** custom row, `vault.change`, rendered after the existing two:

- **Label:** "Change vault" / "Move or switch vault folder" (final copy in implementation).
- **Control:** a secondary `Button` "Change vault…" (the ellipsis signals "opens a dialog, more steps
  follow"). No `AdminOnlyBadge` — any signed-in person may use it (decision #3).

### 3.2 The confirmation / explainer dialog (happy path)

Clicking "Change vault…" opens a hand-rolled `role="dialog"` `aria-modal="true"` overlay (the
LockScreen/Switcher pattern, §5.3), built from existing primitives (`Card`, `Stack`, `Text`, `Button`, and a
`Banner` for the key caveat). It must plainly, calmly explain — in plain language, no jargon:

1. **Your data stays safe.** Nothing is deleted. Your current vault folder and everything in it are left
   untouched and can be re-opened later.
2. **This device will need your recovery phrase to re-open this vault.** Because SelfOS forgets the key for the
   current vault when you switch, re-opening it on this device later means entering the recovery phrase
   (surfaced as a `Banner` so it reads as the one thing to note).
3. **You'll choose a new folder next.** After confirming, you'll be taken to the "Choose a folder" screen to
   pick the vault you want — a fresh folder to start over, or an existing SelfOS vault to open it here.

Actions: a **Cancel** (secondary; also Esc and scrim-click) and a **Continue** primary button. The dialog is
deliberately reassuring and reversible-feeling; it is **not** a scary "destructive action" red-alert, because
nothing is destroyed.

**Happy path, step by step:**

1. User opens Settings → Vault, clicks **Change vault…**.
2. The dialog opens; focus moves to the dialog (first focusable / the dialog container), focus trapped.
3. User reads the explainer and clicks **Continue** (or Cancel → §3.4 no-op).
4. The renderer calls `window.selfos.unlinkVault()` (§6.1). The button shows a brief busy state.
5. Main detaches: stops the watcher, clears the master key, clears `vaultPath` + `activePersonId` +
   `pendingJoinPersonId`, resets the super-admin inspect flag, **touches nothing in the vault**, and returns
   the recomputed `BootState` (`phase: 'onboarding'`).
6. On success the renderer resets `sessionStore` + every person-scoped store (§5.4) and calls
   `appStore.apply(bootState)`, flipping `phase` → `onboarding`. The Shell unmounts.
7. The user lands on the **existing** Onboarding "Choose a folder" screen.
8. They pick a folder via the existing `chooseVault()` (`selectVaultFolder()` → `useVault(path)`). The existing
   `HouseholdGate` then routes:
   - **Fresh / empty folder** → first-run **Setup** (mints a new owner + recovery phrase for the new vault).
   - **Existing SelfOS vault** (`config/recovery.enc` present) → **UnlockScreen** (recovery phrase or invite).

No new screens are introduced in steps 7–8; they are the onboarding + `10` flows verbatim.

### 3.3 What "the same as onboarding" means concretely

After unlink, `appStore.phase === 'onboarding'` and `vaultPath === null` — **identical** to a brand-new
install. The Onboarding component already renders "Choose a folder" and wires `chooseVault()`. So a returning
user who unlinks is indistinguishable, from the boot machinery's perspective, from a first-time user. This is
the reuse the design hinges on.

### 3.4 Cancelling the dialog

Cancel / Esc / scrim-click closes the dialog and is a **pure no-op**: no IPC call, no state change, the user
stays in Settings → Vault exactly as before. Focus returns to the "Change vault…" button.

### 3.5 Developer-facing API (summary)

- `window.selfos.unlinkVault(): Promise<BootState>` (new, §6.1) — detaches this device and returns the
  recomputed onboarding boot state. The renderer applies it via `appStore.apply` and resets stores.
- No other contract changes; the post-unlink folder pick reuses the existing `selectVaultFolder` / `useVault`
  / `householdStatus` channels and the existing `HouseholdGate`.

## 4. Data model (vault files & schemas)

**N/A — no new vault files, no schema changes.** This feature owns **no** persisted vault format. It only
mutates **device-local** state that already exists, and it deliberately leaves the vault on disk untouched:

- **Device-local mutations** (`userData/state.json`, via `updateDeviceState`,
  `apps/desktop/src/main/state/deviceStore.ts`): `vaultPath` → `null`, `activePersonId` → `null`,
  `pendingJoinPersonId` → `null` (cleared if present). These fields already exist in `DeviceStateSchema`
  (`packages/core/src/.../schemas.ts`); no field is added, so **no `schemaVersion` bump and no migration**.
- **Device-local secret cleared** (`userData/secrets.json`, via the `SecretStore` host):
  `secrets.clear('selfos.masterKey')` (`MASTER_KEY_ID`). The personal API-key secrets (`anthropic.apiKey`,
  `openai.apiKey`) are **not** cleared (recommendation §7.4; open question §11).
- **In-vault files:** **none read, none written, none deleted.** `config/recovery.enc`,
  `people/**`, all `.enc` content remain byte-identical. The detach must not call any vault writer.
  _(Amended 2026-06-14: the super-admin inspect flag was removed; the detach no longer resets it, and
  `config/superadmin.enc` no longer exists.)_

**Ownership:** the device-local reads/writes go through `deviceStore`/the `SecretStore` host as today; no
direct `fs` is introduced. There is nothing the renderer persists; it only triggers the op and applies the
returned `BootState` (00 §4.1 device-local-vs-synced split is respected exactly).

## 5. Architecture & modules

### 5.1 The one new main-process op: `vault:unlink`

The only genuinely new backend logic. It performs, in order:

1. **Stop the vault watcher** — `stopVaultWatcher()` (`apps/desktop/src/main/vaultWatcherManager.ts`), so no
   chokidar handle keeps watching the folder we're leaving.
2. **Clear the master key** — `secrets.clear(MASTER_KEY_ID)` via the `SecretStore` host. **The critical step**
   (§1.1 / §7.1).
3. **Clear device-local pointers** — `updateDeviceState({ vaultPath: null, vaultBookmark: undefined,
activePersonId: null, pendingJoinPersonId: null })`. **Both** vault pointers are cleared: Electron keys the
   active vault on `vaultPath`, but the **web/iOS host keys it on `vaultBookmark`** (07-mobile-platform) — each
   host reads only its own, so clearing both keeps the detach correct on every platform. Clearing an
   **optional** field to `undefined` needs the `DeviceStatePatch` type (a `Partial<DeviceState>` that lets
   `vaultBookmark` be `undefined`; required-nullable `vaultPath` still takes `null`), threaded through
   `BridgeHost.updateDeviceState` and both the node + web device stores.
4. **Reset super-admin inspect mode** — `setSuperAdminActive(false)` /
   `host.setSuperAdminActive(false)` (`apps/desktop/src/main/people/superAdmin.ts`), so a leftover break-glass
   session can't bleed into the next vault.
5. **Touch nothing in the vault** — no call into any `FileSystem`-host writer. The vault on disk is untouched.
6. **Return the recomputed `BootState`** — recompute via `computeBootState` (`apps/desktop/src/main/boot.ts`),
   which now reads `vaultPath: null` → `{ phase: 'onboarding', vaultPath: null, hasSettings: false }`.

### 5.2 Where the logic lives (host split)

Most of `vault:unlink` is host-agnostic (clear a secret, clear device state, reset a flag, recompute boot) and
belongs in the shared `createCoreBridge` factory (`apps/desktop/src/shared/coreBridge.ts`), reusing existing
`BridgeHost` parts (`secrets`, device-state read/write, `setSuperAdminActive`). **One step is
platform-specific** — stopping the chokidar watcher (`stopVaultWatcher`) — exactly like `useVault`'s
**starting** the watcher. So, mirroring the existing `useVault` special-casing in `ipc.ts`:

- the **shared factory** exposes the host-agnostic detach (clear key + device state + inspect flag + recompute
  boot), and
- the Electron `ipc.ts` handler wraps it to **also** call `stopVaultWatcher()` before/around the shared op (a
  thin platform wrapper, not the host-agnostic factory). iOS has no chokidar watcher; its host's
  watcher-stop is a no-op, so the same factory call is correct there.

`ipc.ts` registers `vault:unlink` as the platform wrapper (alongside the `useVault` and `chatStream`
special-cased handlers), not a plain `handle(...)` delegate.

### 5.3 Renderer: the Settings control + dialog

- **`vault.change` setting** (`builtins.tsx`) — a third custom row in the `vault` section, `control: { type:
'custom', render: ChangeVaultRow }`, `order: 3`.
- **`ChangeVaultRow`** (new, in `customRows.tsx` or its own file under `settings/`) — renders the secondary
  "Change vault…" `Button` and owns the dialog open/close state.
- **`ChangeVaultDialog`** (new component, one per file, `.module.css` co-located) — a hand-rolled
  `role="dialog"` `aria-modal="true"` overlay following the **LockScreen / Switcher / SuperAdminUnlock**
  pattern (those four are the existing hand-rolled dialogs: `apps/desktop/src/renderer/src/app/{LockScreen,
Switcher,UsageRing,SuperAdminUnlock}.tsx`). Built from `Card`, `Stack`, `Text`, `Button`, `Banner` — **no
  new design-system primitive** (01 tokens only; no magic colors/spacing). Responsive ~360px→desktop;
  focus-trapped; Esc cancels; scrim-click cancels; visible focus throughout.

The dialog calls `appStore.unlink()` (a new action, §5.4) on Continue and closes itself either way.

### 5.4 Renderer: reset + route back

On `vault:unlink` success the renderer must drop **all** per-person + session state before the phase flips, so
no prior vault's data lingers for a frame. A new `appStore` action `unlink()`:

1. `const boot = await window.selfos.unlinkVault();`
2. Reset `sessionStore` (clears `status`/`activePerson`/`capabilities`/super-admin flag) and every
   person-scoped store — the **same reset list** AppShell already runs on an active-person change
   (`apps/desktop/src/renderer/src/app/AppShell.tsx` ~lines 76–82): `conversationStore`, `budgetStore`,
   `usageStore`, `inboxStore`, `dreamStore`, `dreamAnalysisStore`, `dreamPatternStore`. (If `resultsStore` /
   any newer person-scoped store exists by build time, include it — the rule is "every store holding
   per-person data resets," per the per-person-isolation CLAUDE.md lesson.)
3. `apply(boot)` → `phase: 'onboarding'`, `vaultPath: null`. The `HouseholdGate`/Shell unmounts; Onboarding
   mounts.

No new routing screens; the existing boot gate + onboarding take over. The user lands on "Choose a folder."

### 5.5 Modules touched (summary)

| Layer            | File                                                            | Change                                                                                                                             |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Shared contract  | `apps/desktop/src/shared/channels.ts`                           | `IpcChannels.unlinkVault = 'vault:unlink'`; `SelfosBridge.unlinkVault(): Promise<BootState>`                                       |
| Shared factory   | `apps/desktop/src/shared/coreBridge.ts`                         | Host-agnostic detach (clear key + device state + inspect flag + recompute boot)                                                    |
| Main (platform)  | `apps/desktop/src/main/ipc.ts`                                  | `vault:unlink` wrapper adding `stopVaultWatcher()`                                                                                 |
| Preload          | preload bridge                                                  | Expose `unlinkVault`                                                                                                               |
| Test mock        | `apps/desktop/src/renderer/src/test-utils/bridge`               | Mock `unlinkVault` returning an onboarding `BootState`                                                                             |
| Renderer (store) | `apps/desktop/src/renderer/src/stores/appStore.ts`              | `unlink()` action: call op, reset stores, `apply(boot)`                                                                            |
| Renderer (UI)    | `settings/builtins.tsx`, `settings/customRows.tsx` + new dialog | `vault.change` row + `ChangeVaultRow` + `ChangeVaultDialog`                                                                        |
| Renderer (boot)  | `apps/desktop/src/renderer/src/app/boot/VaultError.tsx`         | "Use a different vault" → `appStore.unlink()` (replaces the direct-`useVault` "Choose a different folder"; Retry unchanged) — §7.7 |

## 6. IPC / API contracts

Renderer ↔ main only through the typed layer (00 §6.1); payloads Zod-validated where there is input.

### 6.1 `vault:unlink` — new

- **Channel:** `vault:unlink`.
- **Direction:** renderer → main (`invoke` / `handle`).
- **Request:** none (`void`). No input → nothing to validate.
- **Response:** `BootState` (`packages/.../shared/schemas` `BootStateSchema`) — always
  `{ phase: 'onboarding', vaultPath: null, hasSettings: false }` after a clean unlink.
- **Behavior:** the §5.1 sequence (stop watcher → clear master key → clear device pointers → reset inspect
  flag → recompute boot). **Idempotent / safe-if-already-detached:** if no vault is currently linked
  (`vaultPath === null`), it still returns the onboarding `BootState` without error (clearing already-absent
  state is a no-op).
- **Errors:** an unexpected secret-store or device-state write failure crosses as the standard `AppError`
  envelope (00 §10); the renderer surfaces a calm inline error in the dialog and **stays linked** (does not
  partially detach the UI). The op clears the key **before** clearing device pointers, so the worst partial
  failure (key cleared, device write fails) still yields a recoverable state on next boot (no key → the gate
  routes to Setup/Unlock for the still-recorded path — itself a clean, non-data-losing state).
- **Bridge:** `SelfosBridge.unlinkVault(): Promise<BootState>`.

### 6.2 Reused channels (unchanged)

The post-unlink folder pick reuses the existing contracts verbatim — no changes:

- `vault:selectFolder` (`selectVaultFolder`), `vault:use` (`useVault`), `household:status`
  (`householdStatus`), `household:unlockWithRecoveryPhrase` (`unlockWithRecoveryPhrase`).

### 6.3 Claude / OpenAI API

**N/A — this feature makes no model calls.** It is pure local state management. (It does, however, decide
whether the device-local API-key **secrets** are cleared — see §7.4; recommendation: keep them.)

## 7. States & edge cases

### 7.1 The critical safety trap — the master-key single slot (motivates decision #1)

The master key is **one** device-local slot, **not keyed per vault**
(`packages/core/src/crypto/masterKey.ts`). If we naively changed `vaultPath` while the OLD vault's key still
sat in `secrets.json`, the next folder would route on a **stale, wrong** key:

- **Point at a FRESH empty folder** → `vaultInitialized === false` (no `recovery.enc`) but `hasMasterKey ===
true` (stale key). `HouseholdGate` takes the `hasMasterKey === true` + `!vaultInitialized` branch → the
  **desync UnlockScreen** — a confusing dead-end asking for a recovery phrase, when the user just wanted a
  clean Setup.
- **Point at a DIFFERENT existing SelfOS vault** → `vaultInitialized === true` **and** `hasMasterKey === true`,
  but the key is the **WRONG** one. `HouseholdGate` routes straight to the Shell as if joined — then **every
  decrypt fails** (the wrong key can't unwrap the new vault's content), surfacing as corruption-looking errors
  across People / Sessions / Dreams.

**The fix / design principle:** unlink **must** `secrets.clear('selfos.masterKey')`. Once the stale key is
gone, `hasMasterKey === false`, and the existing `HouseholdGate` matrix routes the next folder correctly with
**zero new routing code** — fresh → Setup, existing SelfOS vault → UnlockScreen. This is the whole reason
**unlink == switch** and the whole reason decision #1 ("always clear the key") is mandatory rather than
optional.

### 7.2 Cancel the dialog

Pure no-op (§3.4): no IPC, no state change, focus returns to the trigger button. The vault stays linked.

### 7.3 Unlink while a sync conflict exists

The vault may currently have detected sync conflicts (00 §4.3, surfaced via the conflict banner). Unlink is
still safe: it touches **nothing** in the vault, so any conflicted files are left exactly as-is for the
provider / a future re-link to resolve. We do **not** attempt to resolve or block on conflicts; the dialog copy
("your data stays untouched") remains accurate. The renderer's conflict state is dropped along with the other
per-vault state on the phase flip.

### 7.4 Unlink while AI / relay is configured (the API-key decision)

The device holds personal secrets independent of any vault: `anthropic.apiKey` and (if dream-images is set up,
`13`) `openai.apiKey`, plus the relay config (`config/relay.enc` is **in the vault**, so it is left untouched
like all vault data). The API keys are **device-level personal configuration**, not vault data.

**Decided (decision #5): keep the API keys on unlink** — do **not** clear them. They are the user's own device
setup, not vault data, and re-entering them after every vault switch would be hostile. The next vault's
Settings → AI simply finds the key already present. (Note: AI **enablement** and model selection are **vault
settings**, so they reset naturally with the new vault — only the raw key secret persists, by design. A user
"handing the device off" who wants a clean wipe can clear the key from Settings → AI separately; that is not
this feature's job.)

### 7.5 Picking a folder that isn't a SelfOS vault but already has files

Unchanged, pre-existing onboarding behavior: selecting a non-SelfOS folder that contains unrelated files causes
the existing onboarding/`useVault` path to **claim** the folder (it writes `.selfos/meta.json` and treats it as
the vault root). This spec does **not** change that behavior; the chosen folder simply becomes a fresh vault
(routing to Setup). This is noted so the dialog copy ("choose a fresh folder to start over") sets the right
expectation; the claim-the-folder behavior is owned by onboarding (02 §3), not here.

### 7.6 Offline (no Claude/OpenAI)

Irrelevant — unlink makes no network calls. It works fully offline. (The sync provider being offline is also
irrelevant: we touch no vault bytes, so there is nothing to sync.)

### 7.7 The VaultError boot screen — "Use a different vault" (in scope; fixes a latent bug)

When boot lands on `vault-error` (the recorded `vaultPath` is missing / unreadable —
`computeBootState`/`getVaultStatus`), the screen (`apps/desktop/src/renderer/src/app/boot/VaultError.tsx`)
currently offers **Retry** (`refresh()`) and **"Choose a different folder"** (`chooseVault()` →
`selectVaultFolder()` → `useVault(newPath)`).

That existing "Choose a different folder" button has the **same stale-key trap as §7.1**: the old vault's
master key is still in `secrets.json`, so picking a _different_ folder mis-routes (fresh folder → desync
UnlockScreen; different existing vault → wrong-key decrypt failures). This is a **pre-existing latent bug** in
that screen — harmless only because no one re-points to a _different_ vault today; this spec surfaces and fixes
it.

**Decision #7 — in scope this build.** The fix: the screen's "choose a different vault" intent must route
through **`vault:unlink`** (which clears the stale key + path) rather than calling `useVault` directly. Concretely:

- **Retry** stays as-is — `refresh()` re-checks the _same_ recorded path. The key is still correct for that
  vault (it may just be temporarily offline, e.g. iCloud not yet synced), so Retry must **not** unlink.
- **"Use a different vault"** (the renamed/repurposed second action) calls `appStore.unlink()` → clears the key
  - path → drops to the onboarding "Choose a folder" screen, where the user picks the new folder and the
    `HouseholdGate` routes it **key-safely**. This replaces the old direct-`useVault` "Choose a different folder"
    behavior so the switch can never run on a stale key.

So VaultError reuses the exact same op and route-back as the Settings flow — no extra backend, just a corrected,
unlink-backed action on that screen (slice 3, §13).

### 7.8 Unlink-then-immediately-relink the same vault

A user who unlinks and then re-selects the **same** folder gets the correct behavior: `vaultInitialized ===
true`, `hasMasterKey === false` → **UnlockScreen**, where the recovery phrase (or an invite) restores the key.
The vault's data is intact (we never touched it). This is decision #1's accepted cost: re-opening on this
device needs the recovery phrase.

### 7.9 Loading / busy

The Continue button shows a brief busy state while `unlinkVault()` resolves; the dialog is non-dismissible
during the in-flight call (or dismissal is ignored until it settles) to avoid a half-applied UI. On success the
phase flips and the Shell unmounts immediately, so there is no lingering "between vaults" UI state.

### 7.10 iOS (07)

Identical detach via the shared factory: clear the Keychain master key, clear device state, reset the inspect
flag, recompute boot → onboarding (the iOS "Choose a folder" is the `VaultFs` picker). The watcher-stop step
is a no-op on iOS (no chokidar). No platform-specific divergence beyond that.

## 8. Safety

This is a foundational/local-state feature; it does **not** touch wellbeing or conversation content, so there
is **no crisis-routing or not-medical surface here** — those remain owned by the conversational specs (`05`,
`09`) per [`CLAUDE.md`](../../CLAUDE.md) §1. (The standing "wellness tool — not medical care" line on the
LockScreen / About is unchanged.)

It **does** sit on CLAUDE.md §1's other mandate — _treat all user content as highly sensitive personal data_ —
so the safety surface here is **data integrity and key handling**:

- **No transmission, no deletion.** Unlink never sends any vault content anywhere and never deletes or rewrites
  any vault byte. The old folder is left intact and re-openable. The user's data stays exactly where they put
  it.
- **Clearing the master key is security-positive.** After unlink the device **forgets** the vault's key — a
  device that no longer points at a vault cannot decrypt it. This is a security improvement, not a risk:
  switching away genuinely detaches the device.
- **The master key never crosses IPC, never enters the vault unencrypted, and the recovery phrase is never
  logged** (00 §8). The renderer only receives a `BootState`; it never sees the key or any secret.
- **Honest framing in the dialog.** The copy states plainly that re-opening this vault on this device later
  needs the recovery phrase — we do not over-promise frictionless return, because the single-slot key model
  (a deliberate §2 non-goal of `10`'s isolation model) makes the recovery phrase the correct re-entry
  credential.

## 9. Accessibility

Defers to [`01-design-system.md`](01-design-system.md); the new control + dialog meet those standards:

- **Trigger:** the "Change vault…" control is a real `<button>` with a clear accessible name, keyboard
  focusable, visible focus, ≥44px tap target (CLAUDE.md §12 responsive).
- **Dialog:** `role="dialog"` + `aria-modal="true"`, labelled by its heading (`aria-labelledby`) and described
  by its explainer (`aria-describedby`); **focus is trapped** within the dialog while open and **returns to the
  trigger** on close (the LockScreen/Switcher pattern). **Esc cancels.** The scrim is click-to-cancel but is
  `aria-hidden`. The key caveat `Banner` is icon + text (never colour-alone) and is in the described region so
  SR users hear it.
- **Busy/error states:** the in-flight Continue uses `aria-busy`; an error surfaces as a `Banner tone="danger"`
  programmatically associated with the dialog so it is announced.
- **Responsive:** the dialog works ~360px→desktop (the `Card` content stacks; no horizontal overflow at
  390px — covered by the DoD guard, §10).
- **Contrast / motion:** tokens only; respects reduced-motion (no new animation; any scrim fade honors the
  existing reduced-motion handling).

## 10. Testing strategy

Vault is exercised against a temp dir (real `fs`); no Claude/OpenAI client is involved. Per CLAUDE.md DoD: E2E
covers **every** new surface, plus the responsive (390px) + control-geometry guards where applicable.

**Unit (Vitest — the bridge factory + device-state, via the mock host):**

- **`vault:unlink` clears the right things** — after the op: the `SecretStore` no longer has `MASTER_KEY_ID`
  (`secrets.has(...)` → false), device state has `vaultPath`/`activePersonId`/`pendingJoinPersonId` all
  `null`, `setSuperAdminActive(false)` was called, and the returned `BootState` is the onboarding state. The
  **single most important assertion of this spec.**
- **`vault:unlink` leaves the vault untouched** — given a seeded encrypted vault, after unlink
  `config/recovery.enc` is **byte-identical** and the `people/**` files are unchanged (no writer was called).
  Proves "no data loss."
- **Idempotent when already detached** — calling `vault:unlink` with `vaultPath` already `null` returns the
  onboarding `BootState` and does not throw.
- **Partial-failure ordering** — (if practical to fake) a device-state write failure after the key is cleared
  still leaves a recoverable state (no key) and surfaces the `AppError`.

**Component (Vitest + RTL, via the mock bridge):**

- **`ChangeVaultRow`** — renders the "Change vault…" button; clicking opens the dialog; **no `AdminOnlyBadge`**
  is present (decision #3) even for a non-owner persona.
- **`ChangeVaultDialog`** — shows the three explainer points + the recovery-phrase `Banner`; **Cancel / Esc**
  closes it as a no-op (no `unlinkVault` call); **Continue** calls `appStore.unlink()`; focus is trapped and
  returns to the trigger on close; `aria-busy` during the in-flight call; an error surfaces a danger banner.
- **`appStore.unlink()`** — on success it resets `sessionStore` + every person-scoped store (assert each
  `reset` was invoked) and applies the onboarding `BootState` (`phase: 'onboarding'`, `vaultPath: null`).

**E2E (Playwright + Electron):**

- **Full switch round-trip** — set up vault **A** (seed/complete onboarding → owner + content); open Settings →
  Vault → **Change vault…** → **Continue**; assert the app lands on the **onboarding "Choose a folder"** screen
  (not the Shell, not an error). Then pick a **fresh folder B** and assert it routes to **Setup** (a new
  vault). Finally assert **A's files are untouched on disk** (`config/recovery.enc` byte-unchanged, `people/**`
  intact) and that **A is re-linkable**: re-select A → **UnlockScreen** → enter A's recovery phrase → reach the
  person picker with A's data intact.
- **Cancel is a no-op** — open the dialog, Cancel, assert still on Settings → Vault and still linked to A (the
  usage ring / Sessions list unchanged).
- **Guards** — a no-horizontal-overflow guard for the dialog at **390px** and at desktop width (CLAUDE.md DoD);
  the dialog's primary/secondary buttons are asserted aligned (no mid-height float). No fixed-size toggle here,
  so no `flex-shrink` geometry guard is required.

**Mocking:** the mock bridge (`test-utils/bridge`) returns an onboarding `BootState` from `unlinkVault`; unit
tests drive the real factory over the in-memory host (`memFileSystem` + a fake `SecretStore`) the way other
`coreBridge` tests do.

## 11. Open questions

All product/scope questions are **resolved** (decisions #5–#7, §1.2):

- **Clear the device-local API keys on unlink? → No, keep them** (decision #5, §7.4). They are personal device
  configuration, not vault data.
- **Shared `Dialog`/`Modal` primitive vs hand-rolled? → Hand-rolled** (decision #6, §5.3), matching the
  existing LockScreen/Switcher pattern; no `/gallery` change.
- **VaultError "Use a different vault" affordance — defer or include? → Include this build** (decision #7,
  §7.7), which also fixes a latent stale-key bug in that screen.

Remaining (non-blocking, settled in implementation):

- **Final dialog copy + the control label / VaultError button label.** The substance is fixed (data safe /
  recovery phrase needed / pick a folder next); exact wording is finalized in implementation and reviewed in
  the visual QA pass.

## 12. Changelog

- 2026-06-12 — created (Draft). Vault relinking: a guided Settings → Vault "Change vault…" action that cleanly
  unlinks this device (stop watcher, **clear the single-slot master key**, clear `vaultPath`/`activePersonId`/
  `pendingJoinPersonId`, reset super-admin inspect) **without touching vault bytes**, then re-enters the
  existing onboarding "Choose a folder" flow + the `10` three-way `HouseholdGate`. Unlink == switch. One new op
  `vault:unlink`; one new Settings control + hand-rolled confirmation dialog; renderer store-reset + route-back.
- 2026-06-12 — **Approved.** Decisions locked: key always cleared (#1); guided dialog flow (#2); any signed-in
  person (#3); spec-first (#4); **keep device API keys on unlink (#5)**; **hand-rolled dialog, no new primitive
  (#6)**; **VaultError "Use a different vault" included this build (#7)** — reusing `vault:unlink` and fixing a
  latent stale-key bug in that screen's existing "Choose a different folder" path. Three slices (§13). Only
  non-blocking item left: final dialog/button copy (settled in build + visual QA).

## 13. Build plan / slices

Three small, methodical slices (CLAUDE.md §6 cadence). Each ships green-gated with tests + visual QA.

### Slice 1 — the `vault:unlink` backend op + IPC seam (no UI)

- The host-agnostic detach in `coreBridge.ts` (clear master key, clear `vaultPath`/`activePersonId`/
  `pendingJoinPersonId`, reset super-admin inspect, recompute `BootState`) + the platform wrapper in `ipc.ts`
  that also calls `stopVaultWatcher()`.
- Full typed seam: `channels.ts` (`IpcChannels.unlinkVault = 'vault:unlink'` + `SelfosBridge.unlinkVault():
Promise<BootState>`) → `coreBridge.ts` → `ipc.ts` → preload → `test-utils/bridge` mock.
- **Unit tests:** clears key/path/person + resets inspect + returns onboarding `BootState`; leaves
  `config/recovery.enc` **byte-identical** and `people/**` untouched; idempotent when already detached.
- No UI; nothing user-facing yet (so no E2E this slice).

### Slice 2 — the Settings "Change vault…" control + dialog + route-back

- The `vault.change` setting row + `ChangeVaultRow` + the hand-rolled `ChangeVaultDialog` (explainer + recovery
  -phrase `Banner` + Cancel/Continue), built from existing primitives + tokens; focus-trapped, Esc-cancel,
  responsive.
- `appStore.unlink()`: call the op, reset `sessionStore` + every person-scoped store (the AppShell reset list),
  `apply(boot)` → onboarding.
- **RTL tests:** dialog open/cancel-no-op/continue-calls-unlink, focus management, no `AdminOnlyBadge`,
  store-reset on success.
- **E2E:** set up vault A → Change vault → Continue → onboarding "Choose a folder" → pick fresh folder B →
  Setup; assert A's files are byte-untouched on disk and **re-linkable** via the recovery phrase; a Cancel
  no-op case; a 390px overflow guard on the dialog.
- **Visual QA** at desktop + 390px: the dialog reads calm/reversible, buttons aligned, nothing clipped; the new
  Settings row sits cohesively beneath Location / Reveal.
- No `/gallery` change (the dialog is hand-rolled — decision #6; no new design-system primitive).

### Slice 3 — the VaultError "Use a different vault" affordance (§7.7)

- Repurpose `VaultError.tsx`'s second action to **"Use a different vault"** backed by `appStore.unlink()`
  (clears the stale key + path → onboarding "Choose a folder"), replacing the direct-`useVault` "Choose a
  different folder" so a switch from the error screen is **key-safe**. **Retry** is unchanged (re-checks the
  same path; key stays valid for a temporarily-offline vault).
- **RTL test:** VaultError renders Retry + "Use a different vault"; the latter calls `appStore.unlink()` (not
  `useVault` directly); Retry calls `refresh()` and does **not** unlink.
- **E2E:** boot with a recorded `vaultPath` pointing at a now-missing folder → land on VaultError → "Use a
  different vault" → onboarding "Choose a folder" → pick a fresh folder → Setup; assert the move ran through
  unlink (no stale-key desync/decrypt failure). A 390px guard on the VaultError screen.
- **Visual QA** at desktop + 390px: the two actions read clearly (Retry vs switch), aligned, nothing clipped.
