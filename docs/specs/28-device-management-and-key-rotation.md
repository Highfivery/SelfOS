# 28 — Device management & key rotation (revocation by re-encryption)

> **Status:** Built (slices A–C) · _last updated 2026-06-21_ · on `feat/household-ai-credentials`
>
> **Built 2026-06-21:** **A** device registry (`config/devices/<id>.enc`, registered on every join path +
> a per-launch heartbeat; owner-gated `devices:list`/`:rename`; `devices.manage` capability). **B** the
> crash-safe `rotateMasterKey` (two-phase stage→commit, journaled; the new key held in a device-local temp
> secret, not the synced journal; idempotent resume; `enumerateEncryptedFiles` path-discovery; owner-gated
> `keys:rotate`/`:rotateStatus` with a sync-conflict pre-flight; resume-at-boot + §5.5 re-key detection in
> `householdStatus`). **C** the owner-only **Settings → Devices** section (list/rename/revoke + the serious
> Revoke-&-re-key dialog + new-phrase panel). Tests: 5 registry + 8 rotation (enumeration, full-rotation
> decrypt, Phase-1-discard/Phase-2-commit crash safety, corrupt-abort, guards) core; 2 bridge (registry
> gating, rotation + re-key sign-out); 3 Devices RTL. Gate green: typecheck, lint, format, **462 core + 542
> desktop** unit; visual QA of the Devices panel (desktop + 390px, no overflow). E2E (the cross-device
> revoke→re-key→sign-out walk) needs a local display. Placement decision: **Settings → Devices** (owner
> chose this over a standalone route). Open questions #5 (relay-link re-mint) + #4 (rotate-on-account-
> removal) remain deferred per §11.
>
> SelfOS encrypts the **whole** vault with **one** master key, and roles are an app-layer-only construct
> ([`10`](10-multi-device-vault.md) §2 — per-person crypto isolation is an explicit, permanent non-goal).
> That single key now travels onto **N devices** (the owner's machines + every member's, via the recovery
> phrase or invite codes — [`10`](10-multi-device-vault.md) §3.3/§5.4). Today there is **no way to see which
> devices have joined, revoke a lost/stolen one, or rotate the key** — `createMasterKey` _hard-guards_ against
> re-keying (re-keying would orphan all ciphertext), so a leaked key or phrase is **permanent**. For an app
> holding "highly sensitive personal data" ([`CLAUDE.md`](../../CLAUDE.md) §1) this is the single biggest
> security gap. This spec adds a **device registry**, an owner **Devices** surface, and **real cryptographic
> revocation via whole-vault re-encryption under a new master key**.

Builds directly on [`10`](10-multi-device-vault.md) (vault identity, the key-free `vaultInitialized` marker,
the three-way `HouseholdGate`, recovery-phrase unlock, invite codes) and [`14`](14-vault-relinking.md) (the
single-slot master-key model, `vault:unlink`'s clean detach + key-clearing, the `DeviceStatePatch` type, and
the "re-link an existing vault needs the recovery phrase" reality). Inherits the vault / IPC / crypto /
device-local-vs-synced boundary from [`00`](00-architecture.md) (esp. §4.1, §4.3 sync-conflict detection, §6
typed IPC, §10 `Result<T, AppError>`). Re-key also re-wraps the **shared AI credentials**
([`25`](25-household-ai-credentials.md), `config/ai-credentials.enc` — _the AI key model itself is out of
scope here_) and the relay config ([`08`](08-questionnaires.md) §5.4, `config/relay.enc`). Settings
**enforcement** of any device policy is out of scope ([`26`](26-settings-trust-boundary.md)). Per-person /
per-item encryption remains a permanent non-goal ([`10`](10-multi-device-vault.md) §2).

> **Spec group:** part of the 2026-06 multi-device / AI-credentials group —
> [`25` household AI credentials](25-household-ai-credentials.md) (the shared key this re-encrypts),
> [`26` settings trust boundary](26-settings-trust-boundary.md), and
> [`27` AI is required](27-ai-required.md). This spec is **28**. (Specs
> 21–24 are a separate, concurrent onboarding-content-redesign group.)

---

## 1. Overview

A SelfOS install is a household with one shared vault folder, opened from several devices. Each device that
joins (Setup, recovery-phrase unlock, or invite redeem) ends up with the **same** 32-byte master key in its
device-local secret store ([`14`](14-vault-relinking.md) §1.1 — one slot, `MASTER_KEY_ID`, not keyed per
vault). That key decrypts everything; capability gating is app-layer only. The consequences today:

- **No visibility.** Nobody can answer "which devices/people have this vault's key?" There is no registry.
- **No revocation.** If a member leaves, or a laptop/phone is lost or stolen, its copy of the master key keeps
  working forever. Removing the person's _account_ ([`04`](04-people-roles.md)) changes app-layer access but
  the raw key still decrypts every `.enc` file outside the app.
- **No rotation.** `createMasterKey` refuses to re-key an initialized vault ([`10`](10-multi-device-vault.md)
  §6.3, the headline non-overwrite guarantee) — correct as a _guard against accidental_ re-keying, but it
  means a deliberately-leaked key/phrase can never be invalidated.

This spec closes the gap in three build slices (§13), independently shippable:

1. **Device registry** (Slice A) — every join path registers _this_ device into the vault (encrypted under the
   master key). Valuable on its own: the owner can finally _see_ joined devices.
2. **Revocation by key rotation** (Slice B, the core) — `rotateMasterKey` generates a new master key,
   **re-encrypts the entire vault** under it, writes a new `recovery.enc` (new recovery phrase, shown once),
   invalidates all pending invites, drops the revoked device(s) from the registry, and keeps the rotating
   device working. **Every other device fails to decrypt on next sync** → routed to the [`10`](10-multi-device-vault.md)
   Unlock gate, re-admittable only by the **new** phrase or a **new** invite. That is what actually cuts off a
   revoked device.
3. **Owner Devices UI** (Slice C) — an owner-only "Devices" surface to list / rename / revoke, marked
   admin-only per [`CLAUDE.md`](../../CLAUDE.md) §12.

The honest framing throughout (§8 threat model): this prevents **future** access by a revoked device. A device
that already synced data before revocation kept local plaintext copies / could have exfiltrated — rotation
cannot retract the past.

## 2. Goals / Non-goals

**Goals**

- **A vault-stored device registry** every join path writes into, readable by all devices, surviving sync.
- **Owner visibility:** an admin-only Devices surface — label, platform, last-seen, "this device", and (best
  effort) which person last used each device.
- **Real cryptographic revocation:** `rotateMasterKey` re-encrypts the **whole** vault under a fresh key so a
  revoked device's old key decrypts nothing on next sync. This is the headline capability.
- **No data loss, ever — even mid-rotation.** Rotation rewrites the entire vault; an interrupted run
  (crash / sync / power loss) must never corrupt or half-encrypt it. Reconcile the [`10`](10-multi-device-vault.md)
  §6.3 non-overwrite guard with an _intentional_ re-key (§5.3).
- **Sync-awareness:** refuse to rotate when the vault is still downloading from iCloud or has unresolved sync
  conflicts (a partial vault would be re-encrypted incompletely → silent loss). Define how other devices tell
  "the vault was re-keyed" from "wrong key / corruption" (§7).
- **Interplay handled:** re-key re-wraps the shared AI credentials (spec 25) + relay config; pending invites
  die and must be re-issued; the recovery phrase changes and the owner re-records it; a revoked member loses
  shared-AI-key access too.
- **Platform-agnostic:** registry + rotation live in `@selfos/core` behind the existing `SelfosBridge` /
  `BridgeHost` so Electron and the iOS host ([`07`](07-mobile-platform.md)) share one implementation.

**Non-goals**

- **Per-person / per-item cryptographic isolation** — _permanent_ non-goal ([`10`](10-multi-device-vault.md)
  §2). One key still decrypts the whole vault; rotation swaps that _one_ key for everyone who's still admitted.
  Revocation is "rotate so the revoked device's key is dead", **not** "give each member their own key".
- **Retroactive secrecy.** Rotation cannot un-leak data a revoked device already read/synced (§8). We state
  this plainly; we do not over-claim.
- **A live encrypted-data sync engine / server.** Sync is still the folder provider's ([`00`](00-architecture.md)
  §2). Rotation is a local whole-vault rewrite that then syncs as ordinary file changes.
- **Remote wipe / kill-switch on the revoked device.** We cannot reach another device; we can only make its key
  useless for _future_ reads. No push, no remote command.
- **Automatic / scheduled rotation, or rotation-on-every-member-removal.** v1 rotation is an explicit owner
  action. (Tying it to account removal is a possible future policy — §11.)
- **The AI key model** (spec 25) and **settings enforcement** (forthcoming) — referenced, not defined here.
- **Conflict-free concurrent rotation across the sync gap.** Two devices rotating while offline from each other
  is a last-writer-wins edge we detect and recover from (§7 #9), not a distributed transaction we prevent.

## 3. UX & flows

Foundational/security work: §3 covers both the **owner-facing UX** and the **developer-facing API**.

### 3.1 The Devices surface (Slice C — owner-only)

A new **Devices** surface. **Placement (open question §11):** either its own route `/devices` (nav gated by
`devices.manage`) or a **Settings → Devices** section. Either way it is **owner-only** and carries an
`AdminOnlyBadge` ([`CLAUDE.md`](../../CLAUDE.md) §12; the established pattern for the Roles screen / Everyone
scope). Non-owners never see it.

Each device row shows:

- **Label** — human name (default derived from platform + hostname; owner-renameable). e.g. "Ben's MacBook
  Pro", "iPhone 15".
- **Platform** — `macos` / `ios` / `web` (from `BridgeHost.platform`, [`02`](02-app-shell.md) §13 / 07).
- **Last seen** — relative ("2 hours ago"), from `lastSeenAt`.
- **This device** — a clear "This device" marker on the row matching the local `deviceId` (so the owner never
  revokes the machine they're sitting at by accident, and the UI can disable/confirm that action specially).
- **Last used by** (best effort) — the display name of the person who last signed in on that device, _if_
  derivable (§4.2, `lastActivePersonId`). Shown as "—" when unknown; never guessed.

**Actions per row:**

- **Rename** — inline edit → `devices:rename` (§6.3). Cosmetic; no rotation.
- **Revoke** — opens a **deliberately serious** confirmation dialog (unlike the calm [`14`](14-vault-relinking.md)
  unlink dialog — this one _is_ consequential). It must state, in plain language:
  1. **This re-encrypts your entire vault** under a new key. It may take a moment on a large vault.
  2. **Your recovery phrase will change** — you'll see a new one and must save it; the old phrase stops working.
  3. **All other devices will be signed out** and must rejoin with the new phrase or a new invite — not just
     the revoked one. (We rotate _one_ shared key, so everyone re-admits; §8.)
  4. **Pending invites are cancelled** and must be re-issued.
  5. **It does not erase data the revoked device already had** (honest §8 framing — a short, plain caveat).

  Actions: **Cancel** (secondary; Esc / scrim) and **Revoke & re-key** (primary, danger tone). The button shows
  a busy/progress state while rotation runs (§3.3).

### 3.2 Revoking your own current ("this") device

Disallowed as a no-op-or-worse: revoking the device you're on would rotate, then immediately leave _you_ unable
to decrypt with the brand-new key unless we special-case it. Decision (§11 — recommend): **the rotating device
is always the surviving device.** "Revoke" on the "this device" row is **disabled** with a tooltip ("You can't
revoke the device you're using — switch to another device, or unlink this one from Settings → Vault"
([`14`](14-vault-relinking.md))). Unlinking _this_ device (14) is the right tool for "stop using SelfOS here";
revocation is for cutting off a _different_ device.

### 3.3 The rotation progress / result flow (Slice B+C)

Rotation is a long, all-or-nothing operation. The flow:

1. Owner confirms **Revoke & re-key** (or calls `keys:rotate` for non-revoking rotation, §3.5).
2. **Pre-flight checks (refuse early, before any write)** — §5.4: vault fully downloaded (no iCloud
   placeholders), no unresolved sync conflicts ([`00`](00-architecture.md) §4.3), this device holds the
   current master key, this device is the surviving device. On failure → a clear inline error in the dialog
   ("Your vault is still syncing — wait until it finishes, then try again" / "Resolve the sync conflicts
   first"); **nothing is changed**.
3. **Progress** — a determinate-ish progress region (`role="status"`, `aria-busy`) with stages: "Preparing…",
   "Re-encrypting your vault… (N of M files)", "Finishing…". The dialog is **non-dismissible** while in flight.
4. **Success** — the dialog swaps to a **"Save your new recovery phrase"** panel showing the new phrase **once**
   (copyable, with the same gravity as Setup's recovery-phrase step), a confirmation that the device was
   revoked + invites cancelled + other devices signed out, and a **Done** button. The owner's session continues
   on the new key (no re-login).
5. **Failure mid-rotation** — see §5.3 (staging + journal + resume). The user sees "Rotation didn't finish —
   your vault is unchanged and safe. [Resume] [Cancel]" and the vault is in a consistent state (either fully
   old or, after resume, fully new — never half).

### 3.4 First-run / no-other-devices

If only the rotating device is registered (single-device household), rotation still works (re-keys + new
phrase) but the "other devices will be signed out" copy is suppressed ("No other devices are joined"). Revoking
a device requires ≥1 _other_ registered device; otherwise the Revoke action isn't offered (there's nothing to
revoke).

### 3.5 Developer-facing API (summary)

- `window.selfos.devicesList(): Promise<DeviceView[]>` — owner-only (§6.2).
- `window.selfos.devicesRename({ deviceId, label }): Promise<void>` — owner-only (§6.3).
- `window.selfos.keysRotate({ revokeDeviceIds?: string[] }): Promise<RotateResult>` — owner-only; re-encrypts
  the vault, returns the **new recovery phrase** (shown once) + a summary (§6.4). `revokeDeviceIds` is the set
  of registry entries to drop; omit/empty for a plain rotation with no specific revocation.
- `window.selfos.keysRotateStatus(): Promise<RotationJournalStatus | null>` — surfaces an in-progress /
  resumable rotation found at boot (§5.3 / §6.5).
- Registration is **not** a renderer call — each join path registers the device host-side as part of
  Setup / unlock / redeem (§5.2).

## 4. Data model (vault files & schemas)

All vault reads/writes go through the `FileSystem` host (`@selfos/core/host`); the registry payloads are
encrypted under the master key via the existing `cryptoService` (`encrypt`/`decrypt` AES-256-GCM envelope, the
same at-rest pipeline as `encryptedStore`). The device **id** + **label** are also mirrored device-local (the
id is needed key-free at boot to mark "this device"; see §4.3). No direct `fs` anywhere.

### 4.1 Files

| Path (vault-relative)             | Synced | Key-free? | Owner / writer             | Holds                                                                                       |
| --------------------------------- | ------ | --------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `config/devices/<deviceId>.enc`   | yes    | no        | `deviceRegistry` (core)    | One device's registry entry, encrypted under the master key                                 |
| `config/keyrotation.journal.json` | yes    | **yes**   | `keyRotation` (core)       | Transient rotation marker/journal for crash-resume (§5.3)                                   |
| `.selfos/rotation-staging/**`     | yes\*  | no        | `keyRotation` (core)       | Re-encrypted files staged before the atomic swap (§5.3)                                     |
| `config/recovery.enc`             | yes    | yes       | `masterKey.ts` (existing)  | Master key wrapped by the recovery-phrase KEK — **rewritten** by rotation with a NEW phrase |
| `config/invites/*.enc`            | yes    | yes       | `inviteService` (existing) | Pending invites — **deleted** by rotation (10 §5.4)                                         |

\* The staging directory is _inside_ the synced vault (it can't live device-local; the re-encrypted files must
land in the vault on swap). Its presence mid-rotation is a normal transient; the journal (§5.3) and the
`.selfos/` hidden prefix keep it out of the user's content view. Cleaned up on success/abort.

**Decision on registry layout — one-file-per-device, not one combined `config/devices.enc`.** Per-device files
**avoid a concurrent-write clobber** (00 §4.3): two devices booting near-simultaneously each write _their own_
`<deviceId>.enc` (different paths → no atomic-write collision, no last-writer-wins over the whole registry).
A single combined file would force read-modify-write of a shared file across the sync gap — exactly the race
[`10`](10-multi-device-vault.md) fights. The cost is a `list('config/devices')` + N reads to render the
surface; trivial for household scale. The file-watcher (00 §4.3) emits `vault:changed` so the Devices surface
refreshes when another device registers/heartbeats.

### 4.2 Schemas

```ts
// @selfos/core — config/devices/<deviceId>.enc (decrypted payload)
export const DeviceRecordSchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string(), // uuid(), generated once per install
  label: z.string(), // human, owner-renameable; default from platform + hostname
  platform: z.enum(['macos', 'ios', 'web']),
  createdAt: z.string().datetime(), // when this device first joined
  lastSeenAt: z.string().datetime(), // updated on boot + heartbeat
  /** Best-effort: who last signed in on this device. May be stale/absent; the surface shows "—" if unknown. */
  lastActivePersonId: z.string().nullable().optional(),
  /** Set by rotation when this entry was the target of a revoke (audit; the file is then removed). */
  revokedAt: z.string().datetime().optional(),
});
export type DeviceRecord = z.infer<typeof DeviceRecordSchema>;

// The renderer-facing projection (no raw personId leakage beyond what the surface needs).
export const DeviceViewSchema = DeviceRecordSchema.pick({
  deviceId: true,
  label: true,
  platform: true,
  createdAt: true,
  lastSeenAt: true,
}).extend({
  isThisDevice: z.boolean(),
  lastActivePersonName: z.string().nullable(), // resolved owner-side; null when unknown
});
export type DeviceView = z.infer<typeof DeviceViewSchema>;
```

```ts
// @selfos/core — config/keyrotation.journal.json (PLAINTEXT JSON — must be readable key-free, like recovery.enc)
export const RotationJournalSchema = z.object({
  schemaVersion: z.literal(1),
  rotationId: z.string(), // uuid for this rotation attempt
  startedAt: z.string().datetime(),
  rotatingDeviceId: z.string(), // the surviving device
  phase: z.enum(['staging', 'committing']), // §5.3 two-phase
  /** Files enumerated for re-encryption (vault-relative). Lets a resume know the complete set. */
  files: z.array(z.string()),
  /** Files already written into staging (re-encrypted), for resume idempotency. */
  staged: z.array(z.string()),
  revokeDeviceIds: z.array(z.string()),
});
export type RotationJournal = z.infer<typeof RotationJournalSchema>;
```

```ts
// keys:rotate response (the new phrase shown ONCE)
export const RotateResultSchema = z.object({
  recoveryPhrase: z.string(), // NEW — show once, never persisted beyond config/recovery.enc
  reencryptedFileCount: z.number().int().nonnegative(),
  revokedDeviceIds: z.array(z.string()),
  cancelledInviteCount: z.number().int().nonnegative(),
});
export type RotateResult = z.infer<typeof RotateResultSchema>;
```

`DeviceStateSchema` (core `schemas.ts`) gains **two device-local fields** (additive-optional → no
`schemaVersion` bump, mirroring the `vaultBookmark` precedent):

```ts
deviceId: z.string().optional(),     // this install's stable id (key-free at boot → "this device")
deviceLabel: z.string().optional(),  // a cached copy of the label (so the UI can label "this device" pre-key)
```

`deviceId` is the **key-free anchor**: it's generated once at install (or first boot) and stored device-local,
so the boot gate / Devices surface can identify "this device" before the master key is loaded. The vault
`DeviceRecord` is the synced, key-encrypted source of truth; the device-local copy is a non-authoritative
cache + the key-free id.

### 4.3 Device-local vs in-vault (the split that matters here)

- **Device-local** (`userData`, never synced): the master key (the rotation _moves the whole household_ to a
  new value of this single slot — on the rotating device), `vaultPath`/`activePersonId`/`pendingJoinPersonId`
  (10/14), and the **new** `deviceId` + cached `deviceLabel`.
- **In-vault** (synced): `config/devices/*.enc` (the registry), `config/recovery.enc` (rewrapped on rotate),
  `config/invites/*` (deleted on rotate), the rotation journal + staging (transient), and **all** the
  encrypted content rotation re-encrypts (§5.1).

### 4.4 Ownership

Registry + journal + staging I/O go through the `FileSystem` host; encryption through `cryptoService`; the
master key through the `SecretStore` host. The renderer never touches `fs`, never sees the key, and receives
only the `DeviceView` / `RotateResult` projections (the new phrase is the one secret that crosses IPC — by
necessity, to show it once — and is never logged, 00 §8).

## 5. Architecture & modules

### 5.1 The file classes rotation must re-encrypt (enumerate — completeness is correctness)

Rotation must re-encrypt **every** vault file that is encrypted under the master key. Missing a class = a file
that stays readable only by the _old_ key → broken after rotation. The op enumerates the vault and re-encrypts
each `.enc` payload (decrypt-under-old → encrypt-under-new), plus the special-cased key-derived files. The
classes (cross-referencing the owning specs):

- **People / relationships / access config** — `people/**` (`04`): profiles, relationships, the access config
  (accounts, roles, PIN hashes). _Note:_ PIN hashes are encrypted under the master key, so they re-encrypt
  too — re-key does **not** invalidate members' PINs.
- **Conversations / sessions** — `people/<id>/conversations/**` (`05`).
- **Insights / memory** — `people/<id>/insights/**` (`08`/`09`/`20`).
- **Dreams + dream analysis + images** — `people/<id>/dreams/**` incl. `image.enc` binary blobs (`12`/`13`).
  (Image bytes use `encryptBytes`/`decryptBytes` — the same envelope; re-encrypt as bytes, not strings.)
- **Intake** — the onboarding intake session + portrait insights (`18`/`21`).
- **Questionnaires** — definitions, sends/assignments, responses, compatibility reports, media
  (`questionnaires/**`, incl. `media/*.enc` binary), and **assignment relay material** (`08` §13.5/§13.6 —
  `Assignment.relay` wrapped keys, `contentKeyWrapped`, `pinWrapped`). **Relay-link consequence (§7 #11):** a
  re-key changes the master key these were wrapped under; already-minted external relay links that depend on
  master-key-wrapped material may need re-minting. Enumerate + re-encrypt; flag the relay-link staleness.
- **Usage / budgets** — `people/<id>/usage/*.enc` monthly shards, budget config (`06`).
- **Settings** — `config/settings.json` is **plaintext** (00 §4.1, portable) → **not** re-encrypted (nothing
  to do). _Confirm none of its values are secrets;_ they aren't today.
- **Relay config** — `config/relay.enc` (`08` §5.4 — endpoint + drain secret + the encrypted Cloudflare token).
  Re-encrypt under the new key. A revoked member loses relay access along with everything else.
- **Shared AI credentials** — the forthcoming spec-25 shared AI key, **if** it lands as a vault file encrypted
  under the master key. Re-encrypt it. **A revoked member loses shared-AI-key access** — this is a feature, not
  an afterthought. (If spec 25 keeps the AI key device-local-only, there's nothing to re-encrypt; this spec
  must stay decoupled and re-encrypt whatever master-key-wrapped AI material exists at build time — §11.)
- **`config/devices/*.enc`** — the registry entries themselves are master-key-encrypted → re-encrypt the
  survivors, **delete** the revoked ones.
- **`config/recovery.enc`** — **rewrapped** with a brand-new recovery phrase + salt (NOT just re-encrypted; the
  whole point is a new phrase). Old phrase is dead.
- **`config/invites/*.enc`** — **deleted** (the master key they wrap is now stale; 10 §5.4 single-use anyway).
- **`config/superadmin.enc`** — _removed entirely_ (10 amendment 2026-06-14; the super-admin folded into the
  Owner). If a legacy file exists, treat as ordinary content (re-encrypt or drop per the 14 amendment); the
  Owner-is-full-access model has no separate SA secret to re-wrap.

> **DRY safeguard against future drift:** the enumeration must be **path-discovery based** (walk the vault,
> re-encrypt every `.enc` payload + the known key-derived special files), **not** a hand-maintained list of
> feature folders — otherwise a future feature's `.enc` files silently survive rotation under the old key. The
> known special cases (`recovery.enc` rewrap, `invites/*` delete, `keyrotation.journal.json` skip, staging
> skip, plaintext `settings.json` skip) are the only path-name exceptions. Tests assert that a seeded vault
> containing one file of **every** feature's `.enc` ends up decryptable **only** by the new key (§10).

### 5.2 Where the logic lives (core, shared by both hosts)

- `@selfos/core/people/deviceRegistry.ts` (new) — `registerThisDevice(fs, key, record)`,
  `heartbeat(fs, key, deviceId)`, `listDevices(fs, key)`, `renameDevice(fs, key, deviceId, label)`,
  `removeDevice(fs, deviceId)` (file delete; no key needed). `defaultDeviceLabel(platform, hostname)`.
- `@selfos/core/crypto/keyRotation.ts` (new) — `rotateMasterKey(fs, secrets, opts)`: the §5.3 two-phase
  re-encryption + new-phrase generation + invite/registry cleanup + journal lifecycle; `resumeRotation(fs,
secrets)` and `readRotationJournal(fs)` for crash-resume; the **enumeration** (`enumerateEncryptedFiles(fs)`).
- `@selfos/core/crypto/masterKey.ts` (amended) — `createMasterKey` keeps its `VAULT_ALREADY_INITIALIZED`
  guard (§5.3 reconciliation: rotation does **not** call `createMasterKey`; it writes `recovery.enc` through a
  dedicated `rewrapRecovery(fs, newKey)` that is the _intentional_ re-key path, used only inside the journaled
  rotation). The accidental-re-key guard stays intact for Setup.
- Heartbeat / "this device" identity wiring lives in the shared `createCoreBridge` factory (`07` iii-b1) so
  Electron + iOS share it; the chokidar `vault:changed` echo is the existing Electron watcher.

### 5.3 Crash-safe rotation: two-phase staging + a journal (the hardest part)

Rotation rewrites the entire vault. A crash, sync interruption, or power loss mid-write must leave the vault
**fully consistent** — either entirely old-key or entirely new-key, never a mix that no single key can read.
Approach: **stage everything, then atomically commit, journaled for resume.**

**Phase 1 — stage (no destructive writes yet):**

1. Pre-flight (§5.4). Generate the new master key + new recovery phrase + salt **in memory** (don't store yet).
2. Enumerate every encrypted file (§5.1). Write a `RotationJournal` (`phase: 'staging'`, the full `files`
   list, empty `staged`) to `config/keyrotation.journal.json` (plaintext, key-free readable — so a resuming
   device can find it without a key, like `recovery.enc`).
3. For each file: read → decrypt with the **old** key → encrypt with the **new** key → write to
   `.selfos/rotation-staging/<same relative path>`. Append to the journal's `staged` list periodically
   (resume idempotency). The **original files are untouched** through all of Phase 1 — the vault is still fully
   readable by the old key, so a crash here = "no rotation happened", just orphaned staging to clean.

**Phase 2 — commit (the destructive part, made atomic-ish + idempotent):**

4. Write the new `config/recovery.enc` (the new phrase wraps the new key) **into staging**. Flip the journal to
   `phase: 'committing'`. _From this point the journal's existence means "a new-key vault is being installed"._
5. **Swap:** move each staged file over its original (atomic per-file temp+rename via `writeAtomic`). Then
   **store the new master key** into this device's `SecretStore` (`storeMasterKey`). Then delete the revoked
   `config/devices/*.enc` + re-write survivors' registry entries under the new key, and delete
   `config/invites/*`.
6. **Finalize:** delete the staging dir + the journal. Rotation complete.

**Resume (`resumeRotation`, run from the boot path when a journal is found):**

- `phase: 'staging'` found at boot → the swap never began; the vault is still old-key-consistent. **Discard**:
  delete staging + journal, return to normal. (A partially-staged rotation is safe to abandon — nothing
  destructive happened.) The owner is told "the previous re-key didn't finish; your vault is unchanged" and may
  retry.
- `phase: 'committing'` found at boot → the swap was in progress. The journal + staging hold the complete
  new-key set, so **re-run the swap idempotently**: for each `file`, if its staged copy exists, re-apply the
  temp+rename (already-swapped files are a harmless no-op because staging mirrors them); ensure the new master
  key is stored; finish the invite/registry cleanup; delete staging + journal. The new-key vault is fully
  installed. **This is why staging holds _everything_ including `recovery.enc` before the destructive phase
  begins** — a `committing` resume can always reconstruct the target state.

**The single hardest correctness invariant:** at no point is a file overwritten with new-key ciphertext while
another file remains old-key-only **without** the journal+staging being able to complete the rest. Phase 1
never overwrites; Phase 2 only overwrites from a complete staged set under a `committing` journal. So any crash
leaves the vault recoverable to a single consistent key by resume (00 §10 `Result`/recovery; §10 tests this).

**Reconciling the [`10`](10-multi-device-vault.md) §6.3 guard:** `createMasterKey` _must_ keep refusing to
overwrite `recovery.enc` (it protects Setup against accidental re-key). Rotation does **not** go through
`createMasterKey`; it writes `recovery.enc` via the dedicated, journaled `rewrapRecovery` inside Phase 2 — the
**only** sanctioned re-key path. The guard and the intentional rotation coexist because they're different code
paths with different preconditions (rotation requires holding the _current_ key + a `committing` journal).

### 5.4 Sync-awareness: refuse to rotate on a partial / conflicted vault

A rotation over a vault that isn't fully present would re-encrypt an **incomplete** set — files still
downloading from iCloud would be missed (left old-key) or, worse, a placeholder read as empty and re-written as
empty ciphertext (silent loss). So pre-flight **refuses** (typed `Result` error, nothing written) when:

- **iCloud download-on-demand pending** — the vault has `.icloud` placeholders / not-yet-downloaded items
  (07's `VaultFs` already surfaces this; on Electron, a best-effort check). Message: "Your vault is still
  downloading from iCloud. Wait until it finishes, then re-key."
- **Unresolved sync conflicts** — the conflict detector (00 §4.3, the conflict banner) reports any conflicted
  copies. Message: "Resolve the sync conflicts in your vault first." Re-keying a vault with conflicted copies
  could re-encrypt the wrong version and orphan the resolution.
- **This device lacks the current master key** — can't decrypt to re-encrypt; refuse.
- **A rotation journal already exists** — a prior rotation is mid-flight/resumable; route to resume, don't
  start a second.

These are **pre-flight only** (before Phase 1's journal). After Phase 1 starts, new sync activity is handled by
the resume logic, not re-checked.

### 5.5 How other devices detect "re-keyed" vs "wrong key / corruption" (§7 detail)

After rotation syncs, another device still holds the **old** master key. It must not mistake "the vault was
re-keyed" for "my files are corrupt". The signal chain:

- The other device's old key fails to decrypt `recovery.enc`-derived content **and** every `.enc` file
  (uniform decrypt failure across the whole vault), **and** `config/recovery.enc` is **present but doesn't
  unwrap with the locally-stored key**. Uniform, total decrypt failure = "re-keyed", not "one corrupt file".
- **Detection rule:** if `isVaultInitialized(fs)` is true (recovery.enc present) but the **device's stored
  master key fails to decrypt a known canary** (e.g. the access config or a re-encryptable marker), treat it as
  **"this vault was re-keyed elsewhere — this device was signed out"** → clear the stale device key and route
  to the [`10`](10-multi-device-vault.md) **UnlockScreen** (recovery phrase / invite), exactly the §1.1 / §7.1
  stale-key handling [`14`](14-vault-relinking.md) already reasons about. This is a graceful "you were signed
  out; rejoin" — **not** a scary corruption error.
- Contrast: a **single** corrupt file with the rest decrypting fine is the ordinary `FILE_CORRUPT` path
  (00 §7), surfaced per-file, not a re-key. The discriminator is **uniform total** decrypt failure vs an
  **isolated** one.

This means a small change to the boot/decrypt path: when the held key can't decrypt the vault wholesale,
**clear it and route to Unlock** (the re-key recovery) rather than throwing a vault-corruption error. (Define
the canary precisely in build; the access config is the natural choice.)

### 5.6 Modules touched (summary)

| Layer            | File                                                         | Change                                                                                              |
| ---------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Core (registry)  | `packages/core/src/people/deviceRegistry.ts` (new)           | register/heartbeat/list/rename/remove + `defaultDeviceLabel`                                        |
| Core (rotation)  | `packages/core/src/crypto/keyRotation.ts` (new)              | `rotateMasterKey`, `resumeRotation`, `enumerateEncryptedFiles`, `rewrapRecovery`, journal lifecycle |
| Core (schemas)   | `packages/core/src/schemas.ts`                               | `DeviceRecord`/`DeviceView`/`RotationJournal`/`RotateResult` + `DeviceState.deviceId`/`deviceLabel` |
| Core (caps)      | `packages/core/src/capabilities.ts`                          | `devices.manage` (Owner-only)                                                                       |
| Shared factory   | `apps/desktop/src/shared/coreBridge.ts`                      | `devices:*` + `keys:rotate*` handlers; register/heartbeat on boot; the §5.5 re-key detection        |
| Shared contract  | `apps/desktop/src/shared/channels.ts`                        | new channels + `SelfosBridge` methods + the view/result types                                       |
| Main (platform)  | `apps/desktop/src/main/ipc.ts`                               | sync-conflict / iCloud-pending probe wiring; resume-at-boot hook                                    |
| Preload          | preload bridge                                               | expose `devicesList/devicesRename/keysRotate/keysRotateStatus`                                      |
| Renderer (store) | new `deviceStore` (renderer)                                 | list/rename/rotate; reset on active-person change (per-person-isolation rule)                       |
| Renderer (UI)    | `/devices` route **or** Settings → Devices section + dialogs | the surface + the serious revoke/rotate dialog + the new-phrase panel; `AdminOnlyBadge`             |

## 6. IPC / API contracts

Renderer ↔ main only through the typed layer (00 §6.1); payloads Zod-validated both sides; **all `devices:*` /
`keys:*` channels are owner-gated _in the bridge_** (the trust boundary, not the renderer — the established
pattern), scoped to the active person being the Owner.

### 6.1 Device registration / heartbeat (no renderer channel)

Host-side only, run inside the join paths + on boot:

- On **Setup / unlock / invite-redeem** completing (the device now holds the key), call
  `registerThisDevice(fs, key, …)` with a generated `deviceId` (persisted device-local) + default label.
- On **each boot** (key present), `heartbeat(fs, key, deviceId)` updates `lastSeenAt` (+ `lastActivePersonId`
  when an active person signs in). Throttled to avoid thrashing the synced file.

### 6.2 `devices:list` — new

- Direction: renderer → main (`invoke`/`handle`). **Owner-only** (`devices.manage`).
- Request: none. Response: `DeviceView[]` (with `isThisDevice` from the local `deviceId`, `lastActivePersonName`
  resolved owner-side). Non-owner → typed `FORBIDDEN` (the surface isn't rendered for them anyway, but the
  bridge re-enforces).

### 6.3 `devices:rename` — new

- Request: `z.object({ deviceId: z.string(), label: z.string().min(1).max(80) })`. Owner-only. Updates that
  device's `DeviceRecord.label` (+ the device-local cache if it's "this device"). Response: `void`.

### 6.4 `keys:rotate` — new (the core)

- Request: `z.object({ revokeDeviceIds: z.array(z.string()).default([]) })`. Owner-only.
- Response: `RotateResult` — the **new recovery phrase** (shown once) + counts (§4.2).
- Behavior: pre-flight (§5.4) → two-phase journaled rotation (§5.3) → cleanup. The new phrase crosses IPC once
  (unavoidable, to display it); **never logged** (00 §8).
- Errors (typed `Result`/`AppError`, nothing half-applied):
  - `SYNC_NOT_READY` (iCloud pending) / `SYNC_CONFLICT_UNRESOLVED` — refused, vault untouched.
  - `NO_MASTER_KEY` — this device can't decrypt; refused.
  - `ROTATION_IN_PROGRESS` — a journal exists; route to resume.
  - `CANNOT_REVOKE_THIS_DEVICE` — `revokeDeviceIds` includes the local `deviceId` (§3.2).
  - On a mid-rotation failure the response is a typed error and the journal is left for resume (§5.3) — the
    renderer surfaces "didn't finish; vault safe; [Resume]".

### 6.5 `keys:rotateStatus` — new

- Request: none. Response: `RotationJournalStatus | null` — `{ phase, staged: n, total: m }` when a journal
  exists (so the UI can offer **Resume**), else `null`. Surfaced at boot + when the Devices surface mounts.

### 6.6 Claude / AI API

**N/A — this feature makes no model calls.** It re-wraps the (forthcoming spec-25) AI **credential** as part of
re-encryption (§5.1) but never invokes a model.

## 7. States & edge cases

| #   | Condition                                                       | Intended behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Owner revokes device B** (the happy path)                     | Pre-flight passes → two-phase rotation re-encrypts the vault under a new key → new phrase shown once → B's entry deleted, invites cancelled, A (rotating) keeps working. On next sync B's old key fails wholesale → §5.5 → Unlock.                                                                                                                                                                                                                                                                           |
| 2   | **Rotation crashes during Phase 1 (staging)**                   | Vault is still entirely old-key (no destructive write happened). Boot finds a `staging` journal → discard staging + journal → vault unchanged. Owner may retry. **No data loss.**                                                                                                                                                                                                                                                                                                                            |
| 3   | **Rotation crashes during Phase 2 (committing)**                | Staging holds the complete new-key set incl. `recovery.enc`. Boot finds a `committing` journal → idempotent resume re-applies the swap + stores the new key + finishes cleanup → fully new-key vault. **No half-state.**                                                                                                                                                                                                                                                                                     |
| 4   | **iCloud still downloading the vault**                          | Pre-flight `SYNC_NOT_READY` → refuse, nothing written. Clear message to wait for sync.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | **Unresolved sync conflict present**                            | Pre-flight `SYNC_CONFLICT_UNRESOLVED` → refuse. Re-keying a conflicted vault could re-encrypt the wrong copy. Owner resolves conflicts first (00 §4.3), then rotates.                                                                                                                                                                                                                                                                                                                                        |
| 6   | **Revoked device B comes online after rotation**                | B's stored old key decrypts nothing; `recovery.enc` present but doesn't unwrap with B's key → §5.5 detection → B is "signed out", routed to Unlock. B can only rejoin with the **new** phrase or a **new** invite (which it lacks unless the owner re-issues).                                                                                                                                                                                                                                               |
| 7   | **A non-revoked but offline device C comes online**             | Same as B mechanically — C also holds the old key, so C is also signed out and must rejoin. This is the honest cost (§8): rotating one shared key signs out **everyone**, not just the revoked device. The owner re-admits C with the new phrase / a fresh invite.                                                                                                                                                                                                                                           |
| 8   | **Owner tries to revoke "this device"**                         | `CANNOT_REVOKE_THIS_DEVICE`; the action is disabled in the UI with guidance to unlink (14) instead (§3.2).                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | **Two devices rotate concurrently (offline from each other)**   | Last-writer-wins on the synced files; the provider may also drop conflicted copies (00 §4.3). The window is narrow (two owners rotating at once). On reconcile, one new-key set wins; the losing rotation's devices (incl. possibly the other rotator) are signed out → Unlock with whichever phrase ended up in the synced `recovery.enc`. Detected as a conflict; **no silent corruption** (uniform decrypt failure → §5.5). Documented mitigation, not a distributed-transaction guarantee (§2 non-goal). |
| 10  | **Single-device household rotates**                             | Works (re-key + new phrase); "other devices signed out" copy suppressed. Revoke action not offered (nothing else to revoke).                                                                                                                                                                                                                                                                                                                                                                                 |
| 11  | **Pending external relay links after rotation**                 | Already-minted relay links whose material was wrapped under the master key (`08` §13.5/§13.6) may need re-minting; rotation re-encrypts the stored material but link staleness must be **surfaced** (a note in the result + a Results-surface hint), not silently broken. Flagged for the relay spec's re-mint path (§11).                                                                                                                                                                                   |
| 12  | **Forthcoming spec-25 AI key is device-local-only**             | Nothing to re-encrypt for AI; the device API key (`anthropic`/`openai`) is personal device config kept across re-key (14 §7.4 precedent). A revoked member's **own** device key is theirs; revocation cuts **shared/vault** AI material only. Stay decoupled — re-encrypt whatever master-key-wrapped AI file exists at build time, else no-op.                                                                                                                                                              |
| 13  | **Corrupt single file encountered during enumeration**          | Re-encryption decrypt of one file fails (genuine corruption, not re-key) → abort the rotation **before** any destructive write (still in Phase 1) with `FILE_CORRUPT`; vault untouched; owner restores the file (00 §7) and retries. Never re-encrypt around a corrupt file (would orphan it under no key).                                                                                                                                                                                                  |
| 14  | **`config/settings.json` (plaintext)**                          | Skipped (not master-key-encrypted). Confirmed it holds no secrets.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 15  | **Empty / loading Devices surface**                             | While `devices:list` resolves, show a skeleton/spinner. Empty (only this device) → a single "This device" row, no revoke offered.                                                                                                                                                                                                                                                                                                                                                                            |
| 16  | **iOS host (07)**                                               | Identical: registry + rotation run in core over `VaultFs` + Keychain. iCloud-pending check is 07's `VaultFs` download-on-demand state. A revoked iPhone is signed out on next sync exactly like a desktop.                                                                                                                                                                                                                                                                                                   |
| 17  | **Member (non-owner) opens the app on a still-admitted device** | Unaffected by rotation (their device re-encrypted along with everyone's; they keep working on the new key, transparently — they never see the phrase). They never see the Devices surface (owner-only).                                                                                                                                                                                                                                                                                                      |
| 18  | **Registry write races (two devices boot together)**            | Each writes its own `config/devices/<deviceId>.enc` (distinct paths) → no clobber (§4.1). The file-watcher refreshes the owner's open Devices surface as entries appear.                                                                                                                                                                                                                                                                                                                                     |

## 8. Safety & threat model (required — data-integrity & key-handling spec)

This is foundational/security work; it does **not** touch wellbeing or conversation content, so there is **no
crisis-routing or not-medical surface here** — those remain owned by the conversational specs (`05`/`09`) per
[`CLAUDE.md`](../../CLAUDE.md) §1. The standing "wellness tool — not medical" line on LockScreen/About is
unchanged. The safety surface here is **data integrity, key handling, and an honest threat model.**

### 8.1 What rotation/revocation **does** protect against

- **Future access by a revoked or lost device.** After rotation, a revoked device's stored master key decrypts
  nothing in the (re-keyed) vault. It cannot read new content, and it cannot read the existing content as it
  re-syncs in new-key ciphertext. This is the real, cryptographic cut-off — strictly stronger than today's
  "remove the account" (which leaves the raw key working).
- **Catastrophic data loss during the rewrite.** The two-phase staging + journal (§5.3) guarantees the vault is
  always recoverable to a single consistent key. Enforced in code + proven by interruption/resume tests (§10).
- **Re-keying a partial/conflicted vault.** The sync-aware pre-flight (§5.4) refuses rather than silently
  re-encrypting an incomplete set.

### 8.2 What it **cannot** protect against (state this plainly — do not over-claim)

- **The past.** A device that synced data before revocation **kept local plaintext copies** in memory / app
  state / exported files, and could have exfiltrated anything it had access to. Rotation prevents **future**
  decryption; it **cannot retract data already read or copied.** The revoke dialog says this in plain language
  (§3.1 point 5). Revocation is "stop the bleeding", not "undo the breach".
- **Per-member isolation.** Rotation swaps the **one** shared key — it does **not** give members separate keys
  (permanent non-goal, 10 §2). Consequently revoking _one_ device signs out **all** other devices, who must
  rejoin. This is inherent to a single-key model and is surfaced honestly (§3.1 point 3, §7 #7).
- **A device we can't reach.** No remote wipe. We make the old key useless for future reads; we don't touch the
  revoked device.
- **An attacker who has the recovery phrase _and_ acts before rotation.** They can mint their own access. The
  recovery phrase is the household master secret (10 §11); protect it. Rotation + a new phrase is the response
  _after_ a phrase leak, not a guarantee against one.

### 8.3 Key-handling invariants (unchanged from 04/10/14, restated)

- The master key never crosses IPC unencrypted and never enters the vault unencrypted; only wrapped/encrypted
  material is stored. The renderer never sees the key.
- The **new recovery phrase** crosses IPC exactly once (to display it once) and is **never logged or persisted**
  beyond `config/recovery.enc` (00 §8). Rotation generates it in memory and discards it after display.
- The registry payload is encrypted under the master key like all content; the **device id** (key-free,
  device-local) and **label** are the only registry data readable without the key — and they're non-sensitive.

## 9. Accessibility

Defers to [`01-design-system.md`](01-design-system.md). The Devices surface + dialogs meet those standards:

- **Devices list** — a semantic list/table; each row's actions are real `<button>`s with clear accessible names
  ("Rename Ben's MacBook", "Revoke iPhone 15"); the `AdminOnlyBadge` is icon + text (never colour-alone); the
  "This device" marker is text, not colour. ≥44px tap targets; responsive ~360px→desktop (rows stack on
  phones — no horizontal overflow; §10 guard).
- **Revoke / rotate dialog** — `role="dialog"` `aria-modal="true"`, labelled by heading + described by the
  explainer (the five points), focus-trapped, Esc/Cancel returns focus to the trigger. The danger tone is not
  colour-alone. The in-flight **progress region** is `role="status"` + `aria-busy`, announcing stage changes
  ("Re-encrypting your vault, file N of M"); non-dismissible while running.
- **New-phrase panel** — the phrase is selectable text with a copy button; a clear "save this now, it won't be
  shown again" instruction associated with the region (matching Setup's recovery-phrase step).
- **Reduced-motion / contrast** — tokens only; no colour-only state; respects reduced-motion.

## 10. Testing strategy

Vault exercised against a temp dir / `memFileSystem`; no Claude client involved. Per DoD: E2E covers every new
surface + the 390px overflow guard + admin-only-marker checks.

**Unit (Vitest, core):**

- **Registry round-trip across two simulated devices** — device A registers (`config/devices/A.enc`), device B
  registers (`B.enc`); `listDevices` on either returns both; distinct paths → no clobber. Rename persists;
  remove deletes the file.
- **Enumeration completeness** — a seeded vault with one `.enc` of **every** feature class (people, sessions,
  insights, dreams + an image binary, intake, questionnaires + media + relay material, usage, relay config, an
  AI-credential file if present, registry entries) → `enumerateEncryptedFiles` returns all of them and **none**
  of the exceptions (plaintext `settings.json`, the journal, staging). The drift-guard test.
- **Full rotation, decrypt assertion** — rotate → assert **every** content file now decrypts with the **new**
  key and **fails** with the **old** key; `recovery.enc` unwraps with the **new** phrase, not the old;
  `config/invites/*` are gone; revoked `config/devices/<B>.enc` is gone, survivors re-encrypted.
- **Interruption / resume safety** — inject a failure (a) mid-Phase-1 (staging) → on resume the vault is
  byte-identical to pre-rotation (old key still works, staging+journal discarded); (b) mid-Phase-2 (committing)
  → on resume the vault is fully new-key (every file decrypts with the new key, none with the old), idempotent
  if resume itself is re-run. **The most important tests in this spec.**
- **Sync-not-ready / conflict refusal** — pre-flight refuses with `SYNC_NOT_READY` / `SYNC_CONFLICT_UNRESOLVED`
  and the vault is **byte-identical** afterward (nothing written).
- **Corrupt-file abort** — a corrupt file in the set aborts in Phase 1 with `FILE_CORRUPT`; vault untouched.
- **`createMasterKey` guard intact** — still refuses to overwrite `recovery.enc` (10 regression), while
  `rewrapRecovery` inside rotation does write it.
- **Re-key detection (§5.5)** — a device holding the old key against a re-keyed vault: the canary fails to
  decrypt → "re-keyed, signed out" classification (not `FILE_CORRUPT`); a single corrupt file with the rest
  fine → `FILE_CORRUPT` (not re-key).

**Component (Vitest + RTL, mock bridge):**

- **Devices surface** — renders rows (label/platform/last-seen), marks "this device", `AdminOnlyBadge` present;
  a non-owner persona sees nothing (owner-gated). Rename inline. Revoke on "this device" disabled.
- **Revoke/rotate dialog** — shows all five explainer points; Cancel/Esc no-op; "Revoke & re-key" calls
  `keysRotate`; busy/progress region; the success panel shows the new phrase once + copy.
- **Resume prompt** — when `keysRotateStatus` returns a journal, the surface offers **Resume** / explains the
  prior rotation didn't finish.

**E2E (Playwright + Electron — the headline cross-device scenario):**

- **Two simulated devices, revoke + re-key cuts off B.** Seed vault with device A (rotating) + device B
  registered. As owner on A: open Devices → see A + B → revoke B → confirm → rotation runs → new phrase shown.
  **Decrypt-the-vault assertions:** content files now decrypt with the new key only; `config/devices/<B>` gone;
  invites gone. Then **simulate B**: point a fresh device-state holding B's _old_ key at the re-keyed vault →
  assert it's **signed out** and routed to the [`10`](10-multi-device-vault.md) **UnlockScreen** (not the
  Shell, not a corruption error) → entering the **new** recovery phrase re-admits it; the **old** phrase fails.
  A (rotating) still reads its data without re-login.
- **Interruption/resume** — kill the app mid-`committing` (a `SELFOS_ROTATION_FAIL_AT` test hook), relaunch →
  the boot path resumes → the vault is fully new-key + readable; assert no half-state.
- **Sync-not-ready refusal** — with a faked iCloud-pending / conflict state, the revoke pre-flight refuses with
  a clear message and the vault is byte-unchanged.
- **Guards** — 390px no-horizontal-overflow on the Devices surface + dialogs; the `AdminOnlyBadge` present;
  a non-owner cannot reach the surface.

**Mocking:** the offline fakes never exercise crypto — these tests use the **real** `cryptoService` over
`memFileSystem` / a temp dir so the re-encryption + key-swap are genuinely verified (per the "fakes hide
crypto/key bugs" lesson). A `SELFOS_ROTATION_FAIL_AT=<phase>` hook injects the interruption deterministically.

## 11. Open questions

Resolve in this spec's dedicated refinement session — **do not assume**:

1. **Surface placement** — a standalone `/devices` route vs a **Settings → Devices** section? (Recommend its
   own route, gated by `devices.manage`, given the gravity of revoke.)
2. **Dependencies** — this spec re-encrypts the shared AI credentials from [`25`](25-household-ai-credentials.md)
   and coordinates with the settings boundary in [`26`](26-settings-trust-boundary.md) (§5.1, §7 #12). It stays
   **decoupled**: it re-encrypts whatever master-key-wrapped AI material exists at build time, or no-ops if `25`
   hasn't landed / the AI key is device-local-only.
3. **Revoke "this device" policy** — confirm the §3.2 decision (the rotating device is always the survivor;
   "revoke this device" is disabled in favour of unlink-from-14). Alternative: allow it but require choosing
   another device to become the survivor first.
4. **Rotate-on-account-removal** — should removing a member's **account** ([`04`](04-people-roles.md)) _offer_
   to rotate (since their device(s) still hold the key)? v1 keeps rotation explicit/separate; confirm we don't
   auto-prompt. (A clear future policy candidate.)
5. **Relay-link re-mint on rotation** (§7 #11) — exactly how already-minted external links recover after a
   re-key: auto-re-mint on next Results open, an explicit "links changed, re-share" prompt, or silent
   acceptance that pending links die? Needs the relay spec's input.
6. **Heartbeat cadence** — how often `lastSeenAt` writes (per boot only, vs a periodic heartbeat while running),
   balancing freshness against synced-file churn / conflict risk. Recommend per-boot + a coarse (hourly) ceiling.
7. **`lastActivePersonId` privacy** — surfacing "which person last used device X" to the Owner is consistent
   with Owner-full-access ([`memory: owner-full-access`]), but confirm it's wanted on the Devices surface (vs
   showing only device label/platform/last-seen). Never disclose this to non-owners (it never renders for them).
8. **Re-key detection canary** (§5.5) — confirm the access config as the canary, or define a dedicated tiny
   `config/keycanary.enc` re-encryptable marker for an unambiguous, content-independent "wrong key" signal.
9. **Staging location** — `.selfos/rotation-staging/**` inside the synced vault means the staging files sync
   mid-rotation (extra churn). Acceptable for household scale? Alternative: a device-local staging dir, swapped
   into the vault at commit (avoids syncing staging but the commit copies across the device-local↔vault
   boundary). Decide on the churn-vs-locality tradeoff.

## 12. Changelog

- 2026-06-21 — created (Draft). Device registry + revocation-by-key-rotation. Slices: A device registry
  (vault-stored `config/devices/<id>.enc`, registered on every join path, owner-listable), B `rotateMasterKey`
  (two-phase staged + journaled whole-vault re-encryption under a new key, new recovery phrase, invite
  invalidation, registry revoke, sync-aware pre-flight, §5.5 re-key detection on other devices), C the
  owner-only Devices UI (list/rename/revoke + the serious re-key dialog + new-phrase panel). Honest threat model
  (§8): prevents **future** access by a revoked device; cannot retract the past; one shared key, so revoking one
  device signs out all (no per-member isolation — permanent non-goal). Builds on 10/14; re-wraps spec-25 AI
  credentials + relay config; references 00/21. Nine open questions for the refinement session.

## 13. Build plan / slices

Each slice ships green-gated with tests + visual QA (CLAUDE.md §6/§7). Slices are ordered so registry (A) is
independently valuable before the hard rotation (B), and the UI (C) lands last on a proven backend.

### Slice A — Device registry (independent, valuable on its own)

- `@selfos/core/people/deviceRegistry.ts` + the `DeviceRecord`/`DeviceView` schemas + `DeviceState.deviceId`/
  `deviceLabel` + `defaultDeviceLabel`.
- Wire `registerThisDevice` into **every** join path (Setup, recovery-phrase unlock, invite redeem) host-side
  in the `createCoreBridge` factory; `heartbeat` on boot.
- `devices:list` / `devices:rename` IPC (owner-gated in the bridge); the `devices.manage` capability.
- **Tests:** registry round-trip across two simulated devices (distinct files, no clobber), rename/remove,
  owner-gating, "this device" identification via the key-free `deviceId`. No rotation yet.
- Ships a backend + the list IPC; the **UI is Slice C** (so no dead UI — but the registry is real and testable).

### Slice B — Revocation by key rotation (the core, hardest)

- `@selfos/core/crypto/keyRotation.ts`: `enumerateEncryptedFiles` (path-discovery, §5.1), the two-phase staged
  - journaled `rotateMasterKey`, `rewrapRecovery`, `resumeRotation`, `readRotationJournal`; reconcile the
    `createMasterKey` guard (§5.3).
- The §5.4 sync-aware pre-flight (iCloud-pending + conflict probes — host-provided) and the §5.5 re-key
  detection on the boot/decrypt path (clear stale key → route to Unlock, not a corruption error).
- `keys:rotate` / `keys:rotateStatus` IPC (owner-gated); the `RotateResult`/`RotationJournal` types; re-encrypt
  the relay config + (if present) the spec-25 AI credential; delete invites; revoke registry entries.
- **Tests (the spec's heart):** enumeration completeness drift-guard, full-rotation decrypt assertions (new key
  works / old key fails everywhere), **interruption + idempotent resume** (Phase-1 discard, Phase-2 finish),
  sync-not-ready/conflict refusal (byte-identical vault), corrupt-file abort, the `createMasterKey`-guard
  regression, and an **E2E**: revoke device B → re-key → B signed out → UnlockScreen → new phrase re-admits / old
  phrase fails; A keeps reading; an interruption/resume E2E.
- No new user surface beyond what an existing trigger needs for the E2E (a temporary owner-only action button is
  acceptable if Slice C isn't built yet — or fold B+C if cleaner; prefer B's correctness proven by E2E first).

### Slice C — The owner Devices UI

- The Devices surface (route or Settings section per §11 #1), owner-only + `AdminOnlyBadge`: list rows
  (label/platform/last-seen/"this device"/last-used-by), inline rename, revoke action.
- The serious **Revoke & re-key** dialog (five explainer points, danger tone, focus-trapped), the in-flight
  progress region, the **new-phrase** result panel (shown once), and the **Resume** affordance when
  `keysRotateStatus` finds a journal.
- A renderer `deviceStore` (reset on active-person change, per the per-person-isolation rule).
- **Tests:** RTL for the surface (rows, this-device marker, admin badge, non-owner sees nothing), the dialog
  (five points, cancel no-op, rotate call, progress, new-phrase panel), the resume prompt; **E2E** walks the
  full owner flow through the rendered UI (open Devices → revoke B → confirm → progress → new phrase → Done),
  with the §10 decrypt-the-vault assertions, plus the 390px overflow guard + admin-only-marker check.
- **Visual QA** at desktop + 390px: rows read cleanly, the revoke dialog feels appropriately serious (not the
  calm 14-unlink tone), the new-phrase panel matches Setup's gravity, nothing clipped.
