# 10 — Multi-device household: vault identity, device join & recovery

> **Status:** **Approved** · _last updated 2026-06-10_
>
> The same household opens one shared vault folder (local / iCloud / Dropbox / Drive) from multiple
> devices, yet today the boot gate decides "first-run setup" from whether **this device's** keychain
> holds the master key. So a second device pointed at an already-initialized vault re-runs Setup —
> which **overwrites `config/recovery.enc` with a brand-new master key** (making all existing
> ciphertext undecryptable) and **mints a second owner + a second super-admin**. This spec makes
> "is this vault initialized?" a key-free property of the **vault**, fixes the boot gate, hard-guards
> against re-keying, moves the super-admin secret into the vault, and adds a recovery-phrase unlock so
> a device can safely join an existing vault.

Modifies the household/crypto/super-admin model in [`04-people-roles.md`](04-people-roles.md) (§5
encryption, §8 super-admin) and the boot/onboarding flow in [`02-app-shell.md`](02-app-shell.md) §3.
It is the data-integrity prerequisite for the shared iCloud-Drive vault in
[`07-mobile-platform.md`](07-mobile-platform.md) §5: the same detection + flows must run on Electron
and the iOS WKWebView, so they live in `@selfos/core` behind the existing `SelfosBridge`. Inherits
the vault/IPC/crypto boundary from [`00-architecture.md`](00-architecture.md) (esp. §4.1's
device-local-vs-synced split).

---

## 1. Overview

A SelfOS install is a household with **one shared vault folder**. That folder may be opened from the
owner's laptop, their iPhone (07), and a partner's machine — all syncing the same files. The vault
already encodes the household's identity: `config/recovery.enc` is the master key wrapped by the
recovery-phrase KEK, and `people/` + the access config hold who exists and who may do what.

What the app gets wrong today is **whose state answers "is this set up?"**. `HouseholdGate.tsx`
routes to `Setup` when `!status.hasMasterKey || !status.hasOwner`, and `householdStatus()` derives
`hasMasterKey` from **this device's** secret store (`loadMasterKey(createNodeSecretStore(...))`). A
second, freshly-installed device has no master key in its keychain, so it shows Setup against a vault
that is already a fully-formed household. Completing Setup runs `setupHousehold` →
`createMasterKey(secrets, fs)`, which unconditionally `fs.writeAtomic(RECOVERY_PATH, ...)` — silently
replacing the household's real wrapped key with a new one. The old data is now orphaned.

This spec separates two questions that were conflated:

- **Is the vault initialized?** — a property of the **vault** (does `config/recovery.enc` exist?),
  answerable with **no key**.
- **Does this device hold the master key?** — a property of the **device** (is the key in this
  keychain / `safeStorage`?).

From those two booleans the boot gate routes three ways: first-run **Setup** (uninitialized vault,
no device key — the **only** path that mints the owner + super-admin), **Unlock / join this device**
(initialized vault, no device key), or the existing person-picker / app (device key present). A
recovery-phrase unlock lets a device cross from the second state to the third without ever re-keying.

**Phasing.** Both phases are now **built**, in independently-shipped sub-slices for the methodical cadence:

- **Slice 1** — the safety fix + foundation: key-free `vaultInitialized` detection, the three-way boot
  gate, hard guards against overwriting `recovery.enc` / re-running setup, the super-admin secret moved
  into the vault (with migration), and a recovery-phrase **unlock** UI.
  - **1a** — `vaultInitialized` detection + the `createMasterKey`/`setupHousehold` overwrite guards +
    the three-way `HouseholdGate` + the recovery-phrase `UnlockScreen` (the data-loss fix + device join).
  - **1b** — super-admin secret moved into `config/superadmin.enc` (+ the device-local migration, §6.4).
  - **1c** — the required owner PIN at Setup (§3.2).
- **Slice 2** — one-time, member-scoped **invite / pairing codes** so a non-owner can join a new device
  without ever seeing the recovery phrase (§5.4).
  - **2a** — the core invite service + the owner's Generate-UI on the Access tab.
  - **2b** — the member redeem flow (`UnlockScreen` invite mode → set own PIN), with a persisted pending
    join so a crash mid-redeem resumes the "Set your PIN" step instead of an open picker.

## 2. Goals / Non-goals

**Goals**

- **No data loss, ever.** A device opening an already-initialized vault can never re-key it. This is
  the headline guarantee.
- **One owner + one super-admin per vault**, established once at vault creation — a property of the
  **vault**, not of the device/install.
- **Key-free initialized-vault detection** via the presence of `config/recovery.enc`, so the boot
  gate can route correctly before any key exists on the device.
- **A safe device-join / recovery path**: a recovery-phrase **unlock** that restores the master key
  into this device's secret store via the existing core `restoreFromRecoveryPhrase` — permanently
  useful as the owner's disaster recovery and own-second-device path.
- **Super-admin in the vault** (`config/superadmin.enc`), so it's one household-wide secret rather
  than a per-device one — with a migration for vaults whose hash is currently device-local only.
- **Platform-agnostic**: detection + flows live in `@selfos/core` and surface through the same
  `SelfosBridge`, so Electron and the iOS WKWebView (07) share one implementation.

**Non-goals**

- **Cryptographic per-person / per-item isolation.** One master key decrypts the **whole** vault;
  roles/capabilities are enforced at the **app/UX layer** (capability gating in main +
  `buildContext`'s shared-vs-private-notes split), **not** by encryption. A key-holder could read raw
  `.enc` files outside the app. This is an explicit, accepted non-goal for a trusted household — it is
  **not** cryptographic RBAC, and nothing here should be read as making it so. (Consistent with 04 §8:
  not zero-knowledge from the owner/app.)
- **Slice 2 invites** are designed, not implemented (§5.4).
- **Conflict-free concurrent setup across the sync gap.** We shrink the race window and pick a
  deterministic loser-recovery, but two devices that both complete first-run Setup while fully offline
  from each other is a last-writer-wins edge (§7) we mitigate, not eliminate.
- **Per-device person access / device management UI** (which devices are joined, revoke a device) —
  a later concern once Slice 2 lands.
- No new server, account system, or live encrypted-data sync engine (00 §2 holds; sync is still the
  folder provider's).

## 3. UX & flows

This is foundational/security work, so §3 describes both the **boot routing** the user experiences
and the developer-facing API where relevant.

### 3.1 Three-way boot routing (the fix)

`HouseholdGate` is rebuilt to route on **two** signals from `HouseholdStatus`: the new key-free
`vaultInitialized` (vault property) and the existing `hasMasterKey` (device property):

| `vaultInitialized` | `hasMasterKey` | Route                               | Meaning                                                  |
| ------------------ | -------------- | ----------------------------------- | -------------------------------------------------------- |
| `false`            | `false`        | **Setup** (existing first-run)      | Brand-new vault. The **only** path that mints owner + SA |
| `true`             | `false`        | **Unlock** (new — §3.3)             | Initialized vault, this device hasn't joined yet         |
| `true`             | `true`         | existing lock / person-picker → app | This device holds the key — resume as today              |
| `false`            | `true`         | **Unlock**, treated as desync (§7)  | Device key but no `recovery.enc` (re-key / sync glitch)  |

The fourth row should not occur given the overwrite guard; if observed it is treated as a desync and
routed to Unlock (the device key likely decrypts nothing useful → real failure surfaces as
vault-error, §7).

`computeBootState` in `boot.ts` is unchanged in shape — its `ready` phase still means "a usable vault
is mounted"; the new three-way decision lives **after** boot-ready, inside `HouseholdGate`, exactly
where today's two-way Setup-vs-Shell decision lives.

### 3.2 First-run Setup (unchanged behavior, now guarded)

The existing `Setup.tsx` wizard (name the owner → set the super-admin passphrase → show the recovery
phrase once) is unchanged for the user. Behind it, `setupHousehold` now **refuses** to run if the
vault is already initialized (§6.3), so it can no longer mint a second owner or overwrite the key.
Per the §11 recommendation we also **require the owner to set a PIN** here (defense for §3.3).

### 3.3 Unlock / join this device (new)

Shown when `vaultInitialized && !hasMasterKey`. A boot-screen (`UnlockScreen`, on `BootLayout` like
`Setup`) that explains: "This SelfOS vault is already set up. Enter your recovery phrase to use it on
this device." States:

- **Idle** — heading + explanation + a recovery-phrase input (multiline / space-tolerant `Textarea`),
  an "Unlock" primary button (disabled until non-empty), and a quiet "Where's my recovery phrase?"
  helper linking to the same copy shown at Setup.
- **Submitting** — button shows "Unlocking…", input disabled, `aria-busy`.
- **Error (bad phrase)** — a `Banner tone="danger"`: "That recovery phrase didn't match this vault.
  Check for typos and try again." Input retains focus; no lockout/throttle in Slice 1 (the wrapped
  key is offline-bruteforceable from the synced file regardless — throttling the UI buys nothing;
  noted in §7).
- **Success** — the master key is restored into this device's secret store; the gate re-evaluates and
  routes to the existing person-picker (`LockScreen` / `PersonPicker`). **No owner is created.**

After a successful unlock the user signs in **as any persona that has an account** via the existing
person-picker. The recovery phrase is documented as the **owner's secret** (§11): in the phased plan,
members join via Slice 2 invites, not by being handed the recovery phrase. We do not technically
restrict which persona is picked post-unlock (the picker already gates on PIN), but the product
framing is owner/admin recovery.

### 3.4 Developer-facing API

- `window.selfos.householdStatus()` now returns `vaultInitialized` (see §6.1).
- `window.selfos.unlockWithRecoveryPhrase(phrase)` (new, §6.2) restores the device-local master key.
- `setupHousehold` and `createMasterKey` are guarded (§6.3); callers must handle the typed refusal.

### 3.5 Slice 2 preview (not built)

Owner generates a one-time invite code for a specific member; the member enters it on a new device to
unwrap the key and set a local PIN, joining member-only. Full flow in §5.4.

## 4. Data model (vault files & schemas)

### 4.1 Files

| Path (vault-relative)     | Synced | Key-free readable? | Owner / writer           | Holds                                                       |
| ------------------------- | ------ | ------------------ | ------------------------ | ----------------------------------------------------------- |
| `config/recovery.enc`     | yes    | **yes** (marker)   | `masterKey.ts` (core)    | Master key wrapped by the recovery-phrase KEK (existing)    |
| `config/superadmin.enc`   | yes    | no (key-encrypted) | `superAdmin` (core, new) | Salted scrypt hash of the SA passphrase, encrypted under MK |
| `config/invites/<id>.enc` | yes    | no                 | _Slice 2 only_           | Pending, expiring invite: MK wrapped by an invite-code KEK  |

**`config/recovery.enc` is key-free readable and is the canonical "vault initialized" marker.** The
bundle JSON (`{ schemaVersion, salt, wrapped: { v, alg, iv, tag, data } }`, see
`RecoveryBundleSchema` in `masterKey.ts`) is **plaintext JSON**; only the `wrapped` master key inside
is ciphertext. So `vaultInitialized` is just "does `config/recovery.enc` **exist**?" — presence only,
no parse, no key required. A present-but-corrupt file deliberately still counts as initialized (§7 #5):
parsing would risk treating a corrupt vault as fresh and re-keying it. (Contrast `superadmin.enc`,
whose payload is encrypted under the master key and is only verifiable **after** the key is loaded.)

### 4.2 Schemas

`HouseholdStatus` (in `apps/desktop/src/shared/channels.ts`) gains one field:

```ts
export interface HouseholdStatus {
  vaultInitialized: boolean; // NEW: config/recovery.enc present (key-free)
  hasMasterKey: boolean; // this device holds the master key
  hasOwner: boolean; // an account with OWNER_ROLE_ID exists (requires the key to read)
  activePersonId: string | null;
}
```

`hasOwner` still requires the key (it reads the encrypted access config); when `hasMasterKey` is
false it is reported `false` and the gate routes on `vaultInitialized` alone (§3.1) — that is correct,
because an un-joined device should never be asked to read encrypted access data.

New super-admin bundle (core), encrypted under the master key — a `SuperAdminFile` validated after
decryption:

```ts
// @selfos/core
export const SuperAdminFileSchema = z.object({
  schemaVersion: z.literal(1),
  passphraseHash: z.string(), // salted scrypt hash (the existing hashPin/verifyPin format)
});
export type SuperAdminFile = z.infer<typeof SuperAdminFileSchema>;
```

`SuperAdminFile` is serialized to JSON, encrypted with the existing core `cryptoService`
(AES-256-GCM, the same envelope used by `encryptedStore`), and written to `config/superadmin.enc` via
the `FileSystem` host — so it reuses the at-rest pipeline rather than inventing a new one.

`DeviceStateSchema` (core `schemas.ts`): `superAdminPassphraseHash` is **deprecated** but **kept
optional** so migration can read it from old installs (§7 / §6.4). No new device-local field is added
in Slice 1.

`SuperAdminFileSchema.schemaVersion` is its own version; `recovery.enc`'s `RecoveryBundleSchema`
already carries `schemaVersion` and is unchanged. Migrations follow 00 §4.4.

### 4.3 Device-local vs in-vault (the split that matters here)

Per 00 §4.1 and 04's "Device-local … never synced" note, this spec makes the split explicit because
it's the whole subject:

- **Device-local** (`userData`, never synced): the **master key** (keychain / `safeStorage`),
  `activePersonId`, `vaultPath` + the iOS security-scoped bookmark (07). The deprecated
  `superAdminPassphraseHash` lingers here only until migrated.
- **In-vault** (synced): `config/recovery.enc`, the **new** `config/superadmin.enc`, all
  `people/` + relationships + the access config.

Moving the super-admin hash into the synced vault is acceptable: it's a **salted, one-way scrypt
hash**, then **encrypted under the master key**, gated behind a concealed break-glass UI (04 §8). A
key-holder could already read everything (the §2 non-goal); the hash leaks nothing further.

### 4.4 Ownership

All vault reads/writes go through the `FileSystem` host (`@selfos/core/host`) — `createNodeFileSystem`
on Electron, the Capacitor `VaultFs` plugin on iOS (07). The renderer never touches `fs`. The master
key is read/written only through the `SecretStore` host. No direct `fs` anywhere in this spec.

## 5. Architecture & modules

### 5.1 Where the logic lives (core, shared by both hosts)

The detection + guards + unlock are platform-agnostic and live in `@selfos/core`, consumed by the
Electron `main` host today and the iOS host in 07:

- `@selfos/core/crypto` `masterKey.ts` — **`createMasterKey` gains an overwrite guard** (§6.3);
  `restoreFromRecoveryPhrase` already exists and is reused verbatim for unlock; a new key-free
  `isVaultInitialized(fs)` reads/parses `config/recovery.enc`.
- `@selfos/core` super-admin module (new) — `setSuperAdminPassphrase(fs, key, …)`,
  `hasSuperAdminPassphrase(fs, key)`, `verifySuperAdminPassphrase(fs, key, …)`, reading/writing
  `config/superadmin.enc`. This is the existing `apps/desktop/src/main/people/superAdmin.ts` logic
  relocated and re-pointed from `deviceStore` to the vault. The in-memory inspect-mode
  (`setSuperAdminActive` / `isSuperAdminActive`) stays an **app/main** concern (device-session state,
  not portable).

### 5.2 Electron `main` changes

- `household.ts` — `householdStatus` computes `vaultInitialized` via `isVaultInitialized(fs)`
  **before** trying to load the key, and short-circuits (no key read needed for the un-joined case).
  `setupHousehold` calls the guarded `createMasterKey` and itself refuses on an initialized vault
  (§6.3). The super-admin write switches from `setSuperAdminPassphrase(userDataDir, …)` (device) to
  the core vault writer `(fs, key, …)`.
- `superAdmin.ts` (app) — slims to the inspect-mode flags + thin wrappers delegating set/has/verify to
  the core vault functions (passing the resolved `fs` + `key`). The migration runs here (§6.4).
- `ipc.ts` — `superadminUnlock` now verifies against the **vault** (`fs` + `key`) instead of
  `deviceStore`. A new `household:unlockWithRecoveryPhrase` handler (§6.2) restores the device key.

### 5.3 Renderer changes

- `HouseholdGate.tsx` — replaces the two-way `!hasMasterKey || !hasOwner ? Setup : Shell` with the
  three-way routing of §3.1 (`Setup` / `UnlockScreen` / lock-or-Shell), driven by `vaultInitialized`
  - `hasMasterKey`.
- New `app/boot/UnlockScreen.tsx` (+ `.module.css`) — the recovery-phrase unlock UI (§3.3), built on
  `BootLayout` + existing primitives (`Card`, `Field`, `Textarea`, `Button`, `Banner`). One component
  per file; no default export.
- `sessionStore.ts` — a `unlock(phrase)` action calling `window.selfos.unlockWithRecoveryPhrase`,
  then `load()` to re-evaluate the gate.
- Setup's "Create profile" step gains a **required owner PIN** field (per §11 recommendation, pending
  confirmation) wired into the existing access-account creation.

### 5.4 Slice 2 — invite / pairing codes (designed, not built)

**Why not just wrap the master key under a PIN.** A member's natural credential is a short PIN
(4–6 digits). But the wrapped key would live in `config/invites/...` inside a **synced folder**
(iCloud / Dropbox). Anyone who can read that folder — the sync provider, another household member,
a backup — gets the wrapped blob and can **brute-force it offline**: 4–6 digits is only 10^4–10^6
guesses, which scrypt slows but does not stop. Wrapping the whole-vault master key under a PIN is
therefore insecure. The fix is to wrap it under a **high-entropy, single-use, member-scoped** secret
instead — the device-pairing pattern Signal and 1Password use.

**Resolved design (decided 2026-06-10).** The code is a **word phrase** (6 words from a curated
~128-word list, dash-joined, e.g. `amber-tide-fox-quill-river-stone` — ~2⁴² entropy; case- and
separator-insensitive via `normalizeRecoveryPhrase`); it **expires after 7 days**; the **member sets
their own PIN** on redeem (the owner never knows it); the owner generates it from the **member's
Access tab**; a QR variant is deferred. The whole-master-key-under-a-word-phrase tradeoff is acceptable
because the wrap is **single-use** (deleted on redeem), **7-day-expiring**, **member-scoped**, behind
scrypt, and the threat (an attacker with the synced folder brute-forcing a _pending_ invite before it
expires) is narrow for a trusted household — far stronger than a 4–6 digit PIN.

**Flow.**

1. The owner (with `people.manage`) first creates the member as a Person and grants them a Member
   login on the Access tab (existing UI), then clicks **Generate invite code**. The code is shown
   **once** (copyable) and never stored; a pending invite shows its expiry with **Cancel** /
   **Regenerate**.
2. Main derives a KEK from the code (`deriveKeyFromPhrase`, scrypt) and writes `config/invites/<id>.enc`
   — a **key-free-readable** bundle `{ schemaVersion, id, personId, createdAt, expiresAt, salt, wrapped }`
   where `wrapped` is the master key wrapped by that KEK (the redeeming device has no master key yet, so
   the file must be readable without it, like `recovery.enc`). The plain code is never persisted.
3. The member installs SelfOS, points at the shared folder (→ `vaultInitialized`, no key → Unlock), and
   chooses **"Have an invite code?"**. Main tries the entered code against each pending invite's salt;
   the one that unwraps (and isn't expired) is the match → the master key is stored in this device's
   secret store, the invite file is **deleted** (single-use), and main remembers the redeemed `personId`.
4. The member then **sets their own PIN**; main writes it to that account (`setAccount`) and activates
   them. They're in as their own persona, **member-only** — they never see the recovery phrase. (Main
   only lets the freshly-redeemed `personId` set its PIN, so the renderer can't target another account.)

**Properties.** One-time (deleted on use), **expiring** (ignored past `expiresAt`; expired files are
GC'd on next list), **member-scoped** (bound to a `personId`), and it **never shares the owner's
recovery phrase**. Delivered in **2a** (core invite service + owner Generate-UI) then **2b** (member
redeem flow).

## 6. IPC / API contracts

Renderer ↔ main only through the typed layer (00 §6.1); payloads Zod-validated both sides.

### 6.1 `household:status` — extended

- **Direction:** renderer → main (`invoke`/`handle`), existing channel.
- **Response:** `HouseholdStatus` now including `vaultInitialized: boolean` (§4.2).
- **Compute:** `vaultInitialized` from `isVaultInitialized(fs)` (key-free, parses `recovery.enc`).
  When no vault is mounted (`vaultDir === null`): `{ vaultInitialized: false, hasMasterKey: <device>,
hasOwner: false, activePersonId: null }`.
- **Errors:** filesystem read errors on `recovery.enc` are treated as **not initialized** only when
  genuinely absent; a present-but-**corrupt** `recovery.enc` returns `vaultInitialized: true` and
  surfaces as a vault-error / unlock failure (§7) — we must not treat "corrupt" as "fresh," or we'd
  re-key (the very bug this spec fixes).

### 6.2 `household:unlockWithRecoveryPhrase` — new

- **Channel:** `household:unlockWithRecoveryPhrase`.
- **Direction:** renderer → main (`invoke`/`handle`).
- **Request:** `z.object({ phrase: z.string().min(1) })`.
- **Response:** `{ ok: boolean }` — `ok: true` when `restoreFromRecoveryPhrase(secrets, fs, phrase)`
  returns true (master key now in this device's secret store), `false` on a non-matching/garbled
  phrase or absent/corrupt `recovery.enc`.
- **Errors:** no throw on a bad phrase (returns `{ ok: false }`); unexpected fs/secret-store failures
  cross as the standard `AppError` envelope (00 §10). The phrase is **never logged** (00 §8).
- **Bridge:** `SelfosBridge.unlockWithRecoveryPhrase(input: { phrase: string }): Promise<{ ok: boolean }>`.

### 6.3 Hard guards (the safety mechanism)

- **`createMasterKey(secrets, fs)`** — refuses if `config/recovery.enc` already exists: it
  `await isVaultInitialized(fs)` first and returns a typed refusal (`Result` error code
  `VAULT_ALREADY_INITIALIZED`) instead of writing. **It must never overwrite an existing
  `recovery.enc`.** This is the single most important change in the spec.
- **`setupHousehold(...)`** — refuses (typed error) if the vault is already initialized, so it can't
  mint a second owner / super-admin even if reached. Defense in depth with the boot-gate routing.

### 6.4 `superadmin:*` — read/write the vault, plus migration

- **`superadmin:unlock`** (`{ passphrase }`) — verifies against `config/superadmin.enc`
  (`verifySuperAdminPassphrase(fs, key, passphrase)`) **post-unlock** (the master key is loaded by
  then). On success sets in-memory inspect mode (unchanged app behavior). On a vault with no
  `superadmin.enc` **and** a device-local hash still present, it runs the migration (below) first,
  then verifies.
- **`setSuperAdminPassphrase` at Setup** — writes `config/superadmin.enc` (core `(fs, key, …)`),
  no longer `deviceStore`.
- **Migration (one-time, idempotent):** on load, if `config/superadmin.enc` is **absent** but the
  device-local `superAdminPassphraseHash` **exists** (old single-device install), copy that hash into
  a fresh `config/superadmin.enc` (encrypted under the master key) and **leave the device-local field
  in place** (harmless; a later cleanup may clear it). This means the very device that set the
  passphrase seeds the vault copy; other devices then read it from the vault. If `superadmin.enc`
  exists, it wins (no migration). Covered by 00 §4.4's migration conventions.

## 7. States & edge cases

| #   | Condition                                                                                                          | Intended behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Fresh vault, fresh device** (`!vaultInitialized && !hasMasterKey`)                                               | First-run **Setup**. The only path that creates owner + super-admin + `recovery.enc`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | **Initialized vault, fresh device** (`vaultInitialized && !hasMasterKey`)                                          | **UnlockScreen** (§3.3) — never Setup. This is the headline bug fixed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | **Initialized vault, device has key**                                                                              | Existing lock / person-picker → app. Unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | **Wrong / garbled recovery phrase** at Unlock                                                                      | `restoreFromRecoveryPhrase` returns false → `{ ok: false }` → inline danger banner, input keeps focus, retry. No master key stored, no data touched. No lockout (the synced wrapped key is offline-bruteforceable regardless, §3.3).                                                                                                                                                                                                                                                                                                                                                                             |
| 5   | **Corrupt `recovery.enc`** (present but unparsable / failed auth-tag on unwrap)                                    | `vaultInitialized: true` (file present) so we **never re-key**; unlock fails with the bad-phrase banner. Treated as a vault-integrity problem → the user restores the folder from sync history or re-selects the vault (00 §7 corrupt-file handling); surfaces via vault-error if it blocks boot. We do **not** offer "start over" here (that would re-key and orphan data).                                                                                                                                                                                                                                     |
| 6   | **Missing `recovery.enc`**                                                                                         | `vaultInitialized: false`. If the rest of the vault is empty → legitimately fresh → Setup. If `people/` etc. exist but `recovery.enc` is gone (partial sync / user deletion) → see #9.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7   | **Two devices both first-run before the folder syncs** (offline race)                                              | Each sees `!vaultInitialized` and may complete Setup, each writing its own `recovery.enc` + owner. On sync this is a **last-writer-wins** conflict on `config/recovery.enc` (the provider may also drop a conflicted copy, surfaced by 00 §4.3's conflict detection). The recovery.enc presence check **shrinks** the window to "both offline simultaneously during initial setup" — far narrower than today's "every new device." Documented mitigation, not a full fix; true conflict-free setup is a §2 non-goal. The losing device's key won't decrypt the winning data → manifests as decrypt failure (#8). |
| 8   | **Device holds a stale master key after the vault was re-keyed elsewhere**                                         | Should not happen given the §6.3 overwrite guard (we never re-key an initialized vault). If it does (race #7, or a hand-edited vault), the stale key fails to decrypt the access config / content → typed decrypt error → **vault-error** recovery (00 §7): re-select the vault or unlock with the correct recovery phrase. We do not silently re-key.                                                                                                                                                                                                                                                           |
| 9   | **Initialized-looking vault missing `recovery.enc`** (people exist, marker gone)                                   | `vaultInitialized: false` would route to Setup → **dangerous** (would re-key). Mitigation: `setupHousehold`/`createMasterKey` also refuse if **any** household artifacts exist (e.g. the access config or `people/` is non-empty) — defense in depth beyond the `recovery.enc` check — and surface a vault-error explaining the recovery file is missing, prompting restore-from-sync.                                                                                                                                                                                                                           |
| 10  | **Pre-existing vault, super-admin hash device-local only** (old install)                                           | The §6.4 migration writes `config/superadmin.enc` from the device-local hash on next load; thereafter all devices verify against the vault copy. Idempotent; existing single-device behavior is unchanged on that device.                                                                                                                                                                                                                                                                                                                                                                                        |
| 11  | **Super-admin unlock on a freshly-joined device** (vault has `superadmin.enc`, this device never set a passphrase) | Works: verification reads the vault copy post-key-unlock — the whole point of moving the hash into the vault.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 12  | **`vaultInitialized && hasMasterKey === true` but `recovery.enc` later deleted while running**                     | The running session keeps working (key is in memory/keychain); a `vault:changed` event (00 §4.3) may flag the loss. Next boot routes per #9. No auto-recovery; never re-key.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 13  | **iOS host (07) — same vault opened via iCloud**                                                                   | Identical routing: detection + unlock run in core through the Capacitor `VaultFs` `FileSystem` + Keychain `SecretStore`. A 2nd device that is the user's iPhone joins via recovery phrase (Slice 1) exactly like a 2nd desktop.                                                                                                                                                                                                                                                                                                                                                                                  |
| 14  | **No vault mounted** (boot phase `onboarding`/`vault-error`)                                                       | `household:status` is not the gate yet — boot (`computeBootState`) handles vault selection/errors first (00 §7, 02 §3). The three-way gate runs only at boot-`ready`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 15  | **Empty / loading**                                                                                                | While `householdStatus` resolves, `HouseholdGate` shows `Splash` (existing `!loaded` path). UnlockScreen has its own submitting state (§3.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 16  | **Corrupt `config/superadmin.enc`**                                                                                | `verifySuperAdminPassphrase` catches the decrypt/parse error and returns `false` (the concealed unlock stays a generic "didn't match", never an exception to the renderer). `hasSuperAdminPassphrase` is **presence-based**, so a corrupt file still counts as "set" and the §6.4 migration never clobbers it by mistaking corrupt for absent. Restore the file from sync history to recover the break-glass.                                                                                                                                                                                                    |

## 8. Safety

This is a foundational/security spec; it does **not** touch wellbeing or conversation content, so
there is **no crisis-routing or not-medical surface here** — those remain owned by the conversational
specs ([`05-conversations.md`](05-conversations.md), [`09-session-analysis.md`](09-session-analysis.md))
per [`CLAUDE.md`](../../CLAUDE.md) §1. (The `LockScreen` already carries the standing "wellness tool —
not medical care" line; nothing changes that.)

It **does**, however, sit squarely on CLAUDE.md §1's other mandate — _treat all user content as
highly sensitive personal data_ — so the safety surface here is **data integrity and key handling**:

- **The non-overwrite guarantee is the core safety property.** `createMasterKey` refusing to replace
  an existing `recovery.enc` (§6.3) is what prevents catastrophic, irreversible loss of every
  encrypted record. It is enforced in code (a guard, not a convention) and proven by tests (§10).
- **The master key never crosses IPC or enters the vault unencrypted.** It is stored only in the
  device secret store; `recovery.enc` and `superadmin.enc` hold only wrapped/encrypted material
  (04 §6 / §7). The renderer never sees the key or ciphertext.
- **The recovery phrase is never logged or persisted** (00 §8); it exists only transiently in the
  unlock request and is consumed by `restoreFromRecoveryPhrase`.
- **Explicit trust-model honesty (§2 non-goal):** one key decrypts the whole vault; this is **not**
  cryptographic isolation between household members. We state it plainly so the security posture is
  not over-claimed. Moving the (hashed, encrypted) super-admin secret into the synced vault does not
  weaken this — a key-holder's capabilities are unchanged.

## 9. Accessibility

Defers to [`01-design-system.md`](01-design-system.md); the UnlockScreen + the new Setup PIN field
meet those standards:

- **UnlockScreen** uses semantic boot layout: a single labelled `Field` wrapping the recovery-phrase
  input (`Textarea` — space/newline tolerant), an `aria-busy` region during submit, and the error as
  a `Banner tone="danger"` that is programmatically associated with the input (so SR users hear it).
  The error is never colour-alone (icon + text, per the design system).
- **Focus management:** focus lands on the recovery-phrase input on mount; on error, focus returns to
  it; on success, the gate transitions and focus moves to the person-picker's first option.
- **Keyboard:** fully operable — Enter submits from the input (Shift+Enter newline), the button is a
  real `<button>`, visible focus throughout. The new owner-PIN field at Setup follows the existing
  Setup field pattern (labelled, masked, keyboard-first).
- **Contrast / motion:** tokens only; respects reduced-motion (no new animation introduced).

## 10. Testing strategy

Vault is exercised against a temp dir (real `fs`); the Claude client is irrelevant here. Per
CLAUDE.md DoD: E2E covers **every** new surface, plus the responsive + geometry guards.

**Unit (Vitest, node — mostly in `@selfos/core`):**

- `createMasterKey` **overwrite guard** — given an existing `config/recovery.enc`, it refuses (typed
  error) and the on-disk bundle is **byte-identical** afterwards (proves no re-key). The single most
  important test in this spec.
- `setupHousehold` **setup guard** — refuses on an initialized vault; no second owner / super-admin /
  `recovery.enc` write occurs.
- `isVaultInitialized` — true when `recovery.enc` is present + parses; false when absent; **true (not
  false)** when present-but-corrupt (must not be mistaken for fresh, §7 #5).
- `restoreFromRecoveryPhrase` — round-trips a real recovery phrase from `createMasterKey` into a fresh
  (empty) secret store and the restored key decrypts existing fixtures; returns false on a wrong/
  garbled phrase and on missing/corrupt `recovery.enc`.
- **Super-admin in the vault** — `setSuperAdminPassphrase` writes `config/superadmin.enc` (encrypted),
  `verifySuperAdminPassphrase` accepts the right passphrase / rejects wrong ones, reading the vault
  copy; a freshly-restored device (key only, never set the passphrase) verifies successfully.
- **Migration** — a vault with **no** `superadmin.enc` but a device-local `superAdminPassphraseHash`
  produces a `superadmin.enc` matching that hash on load; idempotent (re-running is a no-op); when
  `superadmin.enc` already exists it is **not** overwritten.

**Component (Vitest + RTL, via the mock bridge):**

- `HouseholdGate` **three-way routing** — `{vaultInitialized:false,hasMasterKey:false}` → Setup;
  `{true,false}` → UnlockScreen; `{true,true}` → lock/Shell. (Table-driven over the §3.1 matrix,
  incl. the desync 4th row → Unlock.)
- `UnlockScreen` — idle → submit (`unlockWithRecoveryPhrase` called with the entered phrase) → success
  re-routes; bad phrase shows the danger banner + keeps focus; button disabled while empty/submitting;
  `aria-busy` during submit.
- Setup with the new **required owner PIN** — submit blocked until a valid PIN; the created owner
  account carries it.

**E2E (Playwright + Electron):**

- **Initialized vault + empty device keychain ⇒ Unlock, not Setup.** Seed a fully-formed encrypted
  vault (existing e2e seed helpers, e.g. `launch.spec.ts`'s household seeding) but leave the device
  secret store empty → assert the **UnlockScreen** renders (and **not** the Setup wizard).
- **Enter the recovery phrase ⇒ reach the person picker**, signing in resumes the existing data; assert
  **no second owner** was created (the access config still has exactly one `OWNER_ROLE_ID` account)
  and `config/recovery.enc` is **byte-unchanged** after unlock.
- **Super-admin verify works post-unlock on a fresh device** — after a recovery-phrase unlock, the
  concealed super-admin unlock succeeds against the **vault** `superadmin.enc` (a device that never
  set the passphrase).
- **Migration path** — boot a seeded vault whose super-admin hash is **device-local only** (no
  `superadmin.enc`); after load, `config/superadmin.enc` exists and the super-admin unlock works.
- **Guards** — a layout/no-horizontal-overflow guard for the UnlockScreen at 390px (CLAUDE.md DoD)
  and at desktop width; the boot screens have no fixed-size controls needing a geometry guard, but the
  primary button is asserted full-height-aligned with its field.

## 11. Open questions

All Slice-1 questions are **resolved** (2026-06-10):

- **Require an owner PIN at Setup? → Yes.** Setup requires the owner to set a PIN (§3.2 / §5.3), so a
  leaked recovery phrase alone can't sign in as the owner on a new device.
- **Super-admin storage format → encrypted `config/superadmin.enc`** (salted scrypt hash encrypted
  under the master key, §4.1), consistent with the at-rest pipeline.
- **Post-unlock persona scope → any persona.** The recovery phrase is documented as the owner's master
  secret; after unlock the user may pick any persona in the existing person-picker (no technical
  per-persona restriction in Slice 1). Members onboard via Slice 2 invites rather than being handed the
  phrase. This also lets the owner use the phrase as a stopgap to bootstrap a member's device before
  Slice 2 ships.

**Deferred to the Slice 2 build (not needed for Slice 1):**

- **Invite code details** — code length/entropy, expiry window, single-use confirmation, and whether
  to offer a QR variant. Decided when Slice 2 is specced into an implementation.

## 12. Changelog

- 2026-06-10 — **Slice 2b built (Slice 2 complete).** The member redeem flow: `invites:redeem` (no
  device key required — unwraps the master key from the invite via `redeemInvite`, stores it
  device-local, and **persists** the resolved `personId` as `DeviceState.pendingJoinPersonId`) +
  `invites:completeJoin` (sets that member's OWN PIN via `setAccount` and signs them in — only the
  redeemed person can be completed, never the owner, so the renderer can't target another account).
  `UnlockScreen` gains an invite mode ("Have an invite code?" → enter code → "Set your PIN" → Finish),
  alongside the recovery-phrase mode. **Security fix (reviewer-caught):** because redeem stores the key
  - consumes the invite, a crash before the PIN was set would have dropped to an **open person picker**
    where anyone could sign in as the PIN-less member. So the pending join is **persisted device-local**
    and the boot gate **resumes the "Set your PIN" step** on next launch (`HouseholdGate`), closing the
    window. Full owner-generate→member-redeem E2E (member joins **member-only**, account gains a PIN,
    invite consumed) + an interrupted-redeem-reboot E2E + a 390px overflow guard on the invite surfaces.
- 2026-06-10 — **Slice 2a built** (owner side of the invite codes). Core `@selfos/core/people/inviteService`:
  `generateInviteCode` (6 words from a 128-word `inviteWords` list, ~2⁴²), `createInvite` (wraps the
  master key under the code's KEK → key-free-readable `config/invites/<id>.enc`), `listInvitesForPerson`
  (GCs expired), `cancelInvite`, and `redeemInvite` (unit-tested round-trip; wired in 2b). IPC
  `invites:create/list/cancel`, owner-only (`people.manage`) and **member-scoped enforced in main** —
  `invites:create` rejects a missing/owner target and supersedes any prior pending invite for that
  person (not just the UI). Owner UI: `DeviceInviteControl` on the member's Access tab (generate → code
  shown once + copy + warning; pending list + cancel/regenerate). The owner-generate→member-redeem
  **E2E lands with 2b** (the round trip naturally exercises the generate path).
- 2026-06-10 — **Slice 1c built (Slice 1 complete).** Setup now requires the owner to set a login PIN
  (min `MIN_OWNER_PIN_LENGTH` = 4, with a Confirm-PIN field to avoid a typo lockout): the PIN is
  threaded through `householdSetup` (`HouseholdSetupSchema.pin`) into the owner account
  (`setAccount({…, pin})`), so a leaked recovery phrase alone can't sign in as the owner on a joined
  device (§3.2). E2E proves the owner then requires the PIN at the picker. Also hardened the concealed
  super-admin long-press E2E (dispatch pointerdown/up directly on the element) — removes a pre-existing
  Electron-timing flake.
- 2026-06-10 — **Slice 1b built.** The super-admin passphrase moved out of device-local state into the
  vault: a new `@selfos/core/people/superAdmin` module writes a salted scrypt hash, encrypted under the
  master key, to `config/superadmin.enc`; the app module is now a thin host wrapper that owns the
  one-time, idempotent device-local→vault migration (§6.4) and the in-memory inspect-mode flag. `verify`
  degrades to `false` (never throws) on a corrupt file; `has` is presence-based so the migration can't
  clobber a corrupt copy (§7 #16). `superadmin:unlock` + Setup now read/write the vault copy.
- 2026-06-10 — **Slice 1a built.** `isVaultInitialized` + the `createMasterKey`/`setupHousehold`
  overwrite guards (no re-key, ever), `HouseholdStatus.vaultInitialized`, the three-way `HouseholdGate`
  (with the `!hasOwner` interrupted-setup → Setup resume that finishes a half-built household without
  re-keying), the `household:unlockWithRecoveryPhrase` IPC, and the recovery-phrase `UnlockScreen`.
  Clarified §4.1: `vaultInitialized` is **presence-only** (a corrupt `recovery.enc` still counts as
  initialized). 1b (super-admin → vault + migration) and 1c (owner PIN) follow.
- 2026-06-10 — **Approved.** Resolved the four §11 questions: owner PIN **required** at Setup;
  super-admin stored as the **encrypted** `config/superadmin.enc`; recovery-phrase unlock allows
  **any persona** post-unlock (recovery phrase = the owner's secret; members onboard via Slice 2);
  Slice 2 invite-code details deferred to its build.
- 2026-06-10 — created (draft). Slice 1 = the data-loss safety fix (key-free `vaultInitialized`
  detection, three-way boot gate, overwrite/setup guards, super-admin moved into the vault +
  migration, recovery-phrase unlock UI). Slice 2 (member invite/pairing codes) designed, not built.
