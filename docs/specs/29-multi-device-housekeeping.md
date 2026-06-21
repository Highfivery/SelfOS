# 29 — Multi-device housekeeping & polish

> **Status:** Draft · _last updated 2026-06-21_
>
> A small, mixed hardening/cleanup spec that gathers four **independent** loose ends from the
> multi-device / AI-credentials work into one document so a build session can ship any subset in any
> order. The four: **(A)** prune spec 10's stale super-admin documentation to match the
> Owner-is-full-access reality; **(B)** give the OpenAI (dream-image) key a "Test connection" flow like
> Claude's; **(C)** detect iCloud-Drive sync conflicts on **iOS** (today `getConflicts` is a stub, so the
> conflict Banner never shows on iPhone); **(D)** defensive sync-safety checks at folder-selection / boot
> so a second device doesn't mistake a still-downloading iCloud folder for a fresh, un-set-up vault.

Part of the 2026-06 multi-device / AI-credentials spec group:
[`25` household AI credentials](25-household-ai-credentials.md),
[`26` settings trust boundary](26-settings-trust-boundary.md),
[`27` onboarding offline resilience](27-onboarding-offline-resilience.md),
[`28` device management & key rotation](28-device-management-and-key-rotation.md). (Specs 21–24 are a
separate, concurrent onboarding-content-redesign group — untouched here.) Builds on
[`07-mobile-platform.md`](07-mobile-platform.md) (the iOS `VaultFs` host + `onVaultChanged`),
[`10-multi-device-vault.md`](10-multi-device-vault.md) (vault identity, the `isVaultInitialized` marker,
the `createMasterKey` non-overwrite guard), [`13-dream-images.md`](13-dream-images.md) (the OpenAI key),
and inherits the vault / IPC / crypto / sync-conflict boundary from
[`00-architecture.md`](00-architecture.md) (esp. §4.1 device-local-vs-synced, §4.3 sync-conflict
detection, §6 typed IPC) — not restated here.

> **Each of A–D is its own slice with its own scope + DoD; a build session may ship any one without the
> others.** Marked **docs-only** vs **code**. iOS/Swift items are **blind-written** (no Mac in the build
> loop) and the user verifies on-device — the project's established pattern (07 `VaultFs`, the relay
> Worker, etc.).

---

## 1. Overview

Four small problems, each surfaced by the multi-device work, none big enough for its own spec:

- **A — Stale super-admin docs.** The concealed "super-admin" was removed on 2026-06-14 and its powers
  folded into the **Owner** (the single full-access role — see the header amendments in
  [`10`](10-multi-device-vault.md) and [`04`](04-people-roles.md), and CLAUDE.md). Spec 10's **header**
  says so, but its **body** still extensively documents `config/superadmin.enc`, the super-admin
  passphrase, its device→vault migration, and `superadmin:*` routing **as if live** (§4.1 / §4.2 / §4.3 /
  §5.1 / §5.2 / §6.4 / §7 rows #10/#11/#16 / §8 / §10 / §11 / §12). A reader who skips the header is
  badly misled. This slice specifies the exact edits to prune or clearly mark-obsolete those passages.
  **Docs-only.**

- **B — OpenAI key has no verify path.** Claude's key has a one-tap "Test connection" (`aiControls.tsx`
  `TestConnectionControl` → `claudeTest` → `claudeProxy.ts runConnectionTest`). The OpenAI key
  (`OpenAiKeyControl`, dream images — [`13`](13-dream-images.md) §6) has **none**: a bad key only
  surfaces as a failed image generation, after the user has set everything up. This slice adds a parallel
  `openaiTest` with the same error taxonomy. **Code.**

- **C — iOS never shows the conflict Banner.** The desktop detects sync-provider conflict copies
  (`main/vault/conflicts.ts` → `getConflicts` → the `useVaultConflicts` Banner). On iOS, `getConflicts`
  returns `[]` (the web/Capacitor host stub), so the Banner can never appear on iPhone even though iCloud
  Drive **does** produce conflicts. This slice specifies how the iOS `VaultFs` plugin enumerates iCloud
  conflict versions and feeds the **same** renderer Banner. **Code (incl. blind-written Swift).**

- **D — First-run / setup sync-safety.** [`10`](10-multi-device-vault.md) §7 #7 flags two race edges: a
  second device that runs **Setup before iCloud has finished syncing** sees an (apparently) empty folder
  and offers first-run Setup; and two devices both running Setup before sync produce a last-writer-wins
  conflict on `config/recovery.enc`. The `isVaultInitialized` marker + the `createMasterKey` non-overwrite
  guard already prevent the **worst** data loss, but the user still gets a confusing "this is a fresh
  vault, let's set it up" instead of "wait for sync." This slice adds a pragmatic **warning + re-check**
  at folder selection / boot when the chosen folder is still downloading or mid-sync. **Code.**

## 2. Goals / Non-goals

**Goals**

- **A:** Spec 10's body reads consistently with the Owner-is-full-access model; no live-sounding
  super-admin documentation remains; cross-spec stray references are inventoried.
- **B:** The owner (or a member with their own OpenAI key) can verify the OpenAI key with one tap and get
  a clear NO_KEY / AUTH / RATE_LIMIT / NETWORK / API_ERROR result — without generating (and paying for) an
  image.
- **C:** A real iCloud-Drive sync conflict on the iPhone surfaces the **same** conflict Banner the desktop
  shows, via the **existing** renderer surface (`useVaultConflicts`) — no new UI.
- **D:** A device pointed at a still-downloading / mid-sync iCloud vault folder is **warned and re-checks**
  rather than silently treated as fresh; the existing data-loss guards stay the backstop.
- Throughout: keep it **pragmatic** — a warning + a re-check, not a distributed lock (§2 non-goals of 10).

**Non-goals**

- **No new conflict-_resolution_ UX.** Both desktop and iOS only **surface** conflicts; the user resolves
  them in their file manager (00 §4.3). This spec does not add merge/resolve tooling.
- **No distributed lock / true conflict-free concurrent setup** (10 §2 non-goal). D shrinks the window and
  warns; it does not eliminate the two-fully-offline-devices race (the `createMasterKey` guard remains the
  hard backstop).
- **No key-rotation / device registry** — that's [`28`](28-device-management-and-key-rotation.md).
- **B does not** add usage metering for the test call (it's a tiny free/cheap probe; see §6.2) and does
  **not** change which key is resolved — it tests the **resolved** key (§6.2, coordinating with
  [`25`](25-household-ai-credentials.md)).
- **A** changes documentation only — **no code** is removed (the code was already removed 2026-06-14).

## 3. UX & flows

### 3.A Slice A — super-admin doc cleanup (no UX)

Developer/reader-facing only. N/A as a user flow. See §4.A / §5.A for the exact edits.

### 3.B Slice B — OpenAI "Test connection"

In **Settings → Dreams**, beside `OpenAiKeyControl` (the existing write-only key field), add a
**`OpenAiTestConnectionControl`** mirroring the Claude `TestConnectionControl`:

- A secondary **"Test connection"** button. While running: "Testing…", disabled.
- **Success** → an accent "Connected" line (matches the Claude control).
- **Failure** → a calm secondary-text line with the mapped message (NO_KEY / AUTH / RATE_LIMIT / NETWORK /
  API_ERROR), e.g. "That OpenAI key was rejected. Check it and try again."
- It tests the **resolved** OpenAI key — a member who has only the household-shared key (25) can verify it
  too; a member with a device override tests their override (the resolver's precedence, §6.2).

No new placement decision: it sits directly under the existing `OpenAiKeyControl`, exactly as the Claude
test sits under `ApiKeyControl` in Settings → AI.

### 3.C Slice C — iOS conflict Banner

No new UI. The existing **`useVaultConflicts`** hook already fetches on mount + refreshes on the
`onVaultChanged` event (which iOS now fires via the `VaultFs` `NSFilePresenter`, 07 §5.4). Once iOS
`getConflicts` returns real paths, the existing conflict Banner (the desktop surface) renders on the
iPhone with no renderer change. The flow:

1. Another device's edit produces an iCloud conflict version in the shared folder.
2. iCloud syncs it; the iOS `VaultFs` presenter fires `vaultChanged` → `useVaultConflicts` re-fetches.
3. iOS `getConflicts` enumerates the conflict versions (§5.C) → returns their identifying paths/labels.
4. The existing Banner shows "We found N conflicting copies in your vault…" — identical copy to desktop.

### 3.D Slice D — sync-safety warning at folder selection / boot

After the user **selects a vault folder** (and at **boot** when re-pointing at a synced folder), before
the boot gate decides "fresh → Setup," a **sync-readiness check** runs:

- If the folder **is still downloading from iCloud** (it contains `.icloud` placeholders, or the
  recovery-marker check is inconclusive because the folder is mid-materialize) **and** it doesn't yet have
  a present, downloaded `config/recovery.enc`, surface a **warning** instead of routing to Setup:

  > **"This folder is still syncing from iCloud."** Wait until it finishes downloading before setting up
  > SelfOS here — otherwise we might not see your existing vault. **[Check again]** **[Set up anyway]**

- **Check again** re-runs the readiness check (and, on iOS, triggers download-on-demand for the recovery
  marker, §5.D) — when sync completes and `recovery.enc` materializes, the gate routes correctly to
  **Unlock** (the existing 10 §3.3 device-join path), not Setup.
- **Set up anyway** is an explicit escape hatch (some folders legitimately have no `.icloud` files — a
  brand-new local folder). It proceeds to the existing Setup wizard; the `createMasterKey` non-overwrite
  guard (10 §6.3) is still the hard backstop if a real `recovery.enc` later syncs in.

The warning is advisory, not a lock: a genuinely-fresh folder (no placeholders, no marker) skips the
warning entirely and goes straight to Setup as today.

## 4. Data model (vault files & schemas)

### 4.A Slice A — no schema change

**N/A — documentation only.** Spec 10's §4.1 table row for `config/superadmin.enc`, the
`SuperAdminFileSchema` block (§4.2), and the device-local `superAdminPassphraseHash` note are the **stale
documentation** this slice prunes; the corresponding code was already removed 2026-06-14. No vault file or
schema exists or changes.

### 4.B Slice B — no schema change

**N/A.** Reuses the existing device-local `OPENAI_API_KEY_ID` secret + (when 25 has landed) the shared
vault credential. The test result is a transient IPC value, not persisted.

### 4.C Slice C — no schema change

**N/A.** `getConflicts` already returns `string[]` (absolute paths / identifying labels). iOS produces the
same shape from `NSFileVersion` (§5.C). The Banner consumes `string[]` unchanged.

### 4.D Slice D — no persisted schema change

**N/A.** The sync-readiness result is a transient boot/selection check. It may add a **device-local**,
non-persisted "set up anyway" intent (held in renderer state for the current selection only), not a vault
file. The `isVaultInitialized` marker (`config/recovery.enc` presence) is unchanged and remains the
authoritative initialized-vault signal (10 §4.1).

### 4.E Ownership

All vault reads go through the `FileSystem` host (`@selfos/core/host`) — `createNodeFileSystem` on
Electron, the Capacitor `VaultFs` plugin on iOS. No direct `fs`. The OpenAI/Claude keys stay host-side
(never cross IPC to the renderer). (00 §4.4 / §6.2.)

## 5. Architecture & modules

### 5.A Slice A — exact spec-10 edits (docs-only)

Edit `docs/specs/10-multi-device-vault.md` so the **body** matches the **header amendment** (lines 3–7:
"super-admin removed entirely; powers fold into the Owner; `config/superadmin.enc` and `superadmin:*` no
longer exist"). The approach: **prune** the now-fictional mechanism and **mark-obsolete** the passages
where pruning would leave a dangling reference, with a one-line note pointing at the header amendment.
Concretely:

| Spec-10 location (≈line)                   | Stale content                                                                                             | Edit                                                                                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §1 (≈50)                                   | "the **only** path that mints the owner + super-admin"                                                    | → "mints the owner" (drop "+ super-admin").                                                                                                                              |
| §1 phasing (≈57, ≈61)                      | "the super-admin secret moved…", **1b** bullet "super-admin secret → vault"                               | Mark **1b SUPERSEDED** inline (it already is in the header) — strike the 1b bullet's substance, keep a one-line "superseded" note.                                       |
| §2 Goals (≈75)                             | "One owner + **one super-admin** per vault"                                                               | → "One owner per vault" (drop the SA half).                                                                                                                              |
| §2 Goals (≈82)                             | "**Super-admin in the vault** (`config/superadmin.enc`)…" bullet                                          | **Delete** the bullet (the mechanism no longer exists).                                                                                                                  |
| §3.1 table (≈116)                          | "mints owner **+ SA**"                                                                                    | → "mints owner".                                                                                                                                                         |
| §4.1 table (≈177)                          | `config/superadmin.enc` row                                                                               | **Delete** the row.                                                                                                                                                      |
| §4.1 (≈185)                                | "(Contrast `superadmin.enc`, whose payload is encrypted…)"                                                | **Delete** the parenthetical.                                                                                                                                            |
| §4.2 (≈205–227)                            | `SuperAdminFileSchema` block + the `superAdminPassphraseHash` deprecation note                            | **Delete** the schema block + the deprecation note (or mark the whole §4.2 SA sub-block "Removed 2026-06-14").                                                           |
| §4.3 (≈235, ≈236, ≈239)                    | device-local `superAdminPassphraseHash`; in-vault `config/superadmin.enc`; "Moving the super-admin hash…" | **Delete** these lines; the device-local-vs-vault split stands on its own without the SA example.                                                                        |
| §5.1 (≈259–263)                            | "core super-admin module (new)…" bullet                                                                   | **Delete** the bullet.                                                                                                                                                   |
| §5.2 (≈271, ≈273, ≈275–281)                | SA write switch; `superAdmin.ts` slim; `ipc.ts superadminUnlock`; the relocation note                     | **Delete** the SA-specific lines; keep the `householdStatus`/`setupHousehold`/migration relocation note minus SA.                                                        |
| §6.3 (≈374)                                | "mint a second owner / super-admin"                                                                       | → "mint a second owner".                                                                                                                                                 |
| **§6.4 (≈376–390)** entire subsection      | `superadmin:*` read/write + migration                                                                     | **Delete the whole §6.4** (and renumber, or leave a "§6.4 — Removed 2026-06-14 (super-admin folded into Owner)" stub).                                                   |
| §7 rows (≈405, ≈406, ≈411)                 | rows #10 (SA migration), #11 (SA on fresh device), #16 (corrupt `superadmin.enc`)                         | **Delete** these three rows (renumber the table).                                                                                                                        |
| §8 (≈428, ≈434)                            | "`superadmin.enc` hold only wrapped material"; "Moving the (hashed…) super-admin secret…"                 | Drop the `superadmin.enc` mention; **delete** the "Moving the super-admin secret" sentence.                                                                              |
| §10 tests (≈463, ≈470–475, ≈496–500)       | the SA-in-vault + migration unit/E2E test bullets                                                         | **Delete** these test bullets (the tests were removed with the code).                                                                                                    |
| §11 (≈511)                                 | "Super-admin storage format → encrypted `config/superadmin.enc`" resolved Q                               | Mark **obsolete** (super-admin removed) — keep a one-line note, not the live resolution.                                                                                 |
| §12 changelog (≈554–559, ≈565, ≈567, ≈571) | the 1b "super-admin → vault" changelog entries                                                            | **Keep as historical record** (changelog is append-only history) but ensure each already reads as past-tense; **no edits** unless one is phrased as a current invariant. |

> Note: the §12 **changelog is history and stays** (it records what was built then superseded). The
> `Super-admin · Lock` inspect-mode UI is an **app/main session concern**, not a vault concept — out of
> spec 10's scope and already removed; no spec-10 edit needed for it.

**Cross-spec stray-reference inventory (report, don't necessarily edit):**

- [`04-people-roles.md`](04-people-roles.md) — **already** has a header amendment (lines 4–6) + body notes
  at ≈75 / ≈333 + a 2026-06-14 changelog entry. Spot-check the body for any **live-sounding** SA mention
  the build session should also prune; the header makes it consistent today, so likely **no change needed**
  beyond a read-through.
- [`07-mobile-platform.md`](07-mobile-platform.md) — the three `superAdmin` mentions (≈290, ≈333, ≈339)
  are **historical changelog/relocation notes about a code module name**, not live SA documentation —
  **no change needed** (they describe the factory extraction as it happened).
- [`08`](08-questionnaires.md), [`14`](14-vault-relinking.md), [`18`](18-personal-onboarding.md),
  [`26`](26-settings-trust-boundary.md), [`28`](28-device-management-and-key-rotation.md) — grep hits
  exist; the build session should **read each hit in context** and confirm it's either (a) a historical
  changelog note (leave) or (b) a live-sounding claim (prune). 28 §5.1 (≈343) explicitly handles a legacy
  `config/superadmin.enc` correctly already (treat as ordinary content). The deliverable is a short list of
  any (b) cases found.

The build session must **re-grep** `super-admin|superadmin|superAdmin` at edit time (line numbers drift)
and apply the table above by content, not by line number.

### 5.B Slice B — `openaiTest` (code)

Mirror the Claude connection-test seam exactly:

- **Core/shared proxy** — add an `runOpenAiConnectionTest(client, apiKey, model)` next to
  `runConnectionTest` (`apps/desktop/src/shared/claudeProxy.ts` or a sibling `openaiProxy.ts`). It maps
  HTTP status → the **same** taxonomy: `401/403 → AUTH`, `429 → RATE_LIMIT`, no-status → `NETWORK`, else
  `API_ERROR`; `null key → NO_KEY`. Reuse a shared `mapError` (extract the status→code mapping so both
  providers share it; the messages name the provider — "OpenAI"/"Anthropic").
- **The probe call must NOT generate an image.** Prefer a tiny **`GET https://api.openai.com/v1/models`**
  (or a `HEAD`/cheap list) — it exercises auth without the per-image cost. Add a `verify(apiKey)` method to
  the `ImageClient` host interface (or a sibling `OpenAiClient`) implemented in
  `apps/desktop/src/main/image/openaiImageClient.ts`, with the offline fake (`SELFOS_FAKE_IMAGE`) returning
  a deterministic `ok: true` (and `SELFOS_FAKE_IMAGE=refuse`/an auth-fail mode for the failure test). **Do
  not** fall back to `images/generations` for the probe (it would bill an image).
- **Bridge** — `openaiTest()` in `coreBridge.ts`, resolving the OpenAI key host-side via the **§6.2
  resolver** (the device override → shared vault key precedence; coordinate with 25), then calling
  `client.verify(resolvedKey)`. Returns a `ClaudeTestResult`-shaped result (rename the shared type to a
  provider-neutral `KeyTestResult`, or reuse `ClaudeTestResult` if the build prefers minimal churn — §11).
  Owner/member gating: the test is available to whoever can see the key control (Settings → Dreams);
  resolving the key is host-side and no key value crosses IPC.
- **Channels + preload + mock** — `openaiTest` through the full typed seam, mirroring `claudeTest`.
- **Renderer** — `OpenAiTestConnectionControl` in `aiControls.tsx` (a near-copy of `TestConnectionControl`
  calling `window.selfos.openaiTest()`), placed under `OpenAiKeyControl` in Settings → Dreams
  (`settings/builtins.tsx`).

### 5.C Slice C — iOS conflict detection (code, incl. blind-written Swift)

Two parts: enumerate conflict versions natively, return them through the existing `getConflicts` path.

**Native (`VaultFs.swift`, blind-written — user verifies on-device):**

- Add a `findConflicts(bookmark)` plugin method that walks the security-scoped vault directory (the same
  `start/stopAccessingSecurityScopedResource` + recursion as `list`) and, for each file, queries
  **`NSFileVersion.unresolvedConflictVersionsOfItem(at:)`** — iCloud's API for "this item has conflicting
  versions that need resolution." For any file with unresolved conflict versions, emit an identifying
  string (the file's vault-relative path, optionally with a per-version label from
  `NSFileVersion.localizedNameOfSavingComputer` / `modificationDate`). Return `{ conflicts: [String] }`.
  - Belt-and-suspenders: **also** match iCloud's conflict-copy **naming** where it appears (some providers
    drop a renamed conflict file alongside; iCloud's primary mechanism is `NSFileVersion`, but the
    desktop's name-pattern approach is a cheap second signal — reuse the `isConflictCopy` patterns from
    `conflicts.ts` as a shared core helper so both hosts apply the **same** name rules, §5.E).
  - Settle the `CAPPluginCall` exactly once after coordination (the established Swift rule in this file —
    an unsettled call hangs the JS promise / boot, per the 07 lesson).

**TS host wiring:**

- Extend the `VaultFsPlugin` TS interface (`host/capacitorVaultFs.ts`) with `findConflicts(bookmark)`.
- In the Capacitor host (`createCapacitorHost`, `host/webHost.ts`), replace the
  `getConflicts: () => Promise.resolve([])` stub with a call to `plugin.findConflicts(bookmark)`, mapping
  to the `string[]` the renderer expects. The **web preview** host keeps returning `[]` (no real sync
  there).

**No renderer change** — `useVaultConflicts` + the Banner already consume `getConflicts(): Promise<string[]>`
(§3.C). The `onVaultChanged` refresh trigger is the existing `NSFilePresenter` feed (07 §5.4).

**Honesty:** the Swift is blind-written; the user verifies on a physical iPhone (induce a conflict by
editing the same vault file on two devices while offline, then sync) per the project pattern. The TS
wiring + the shared name-pattern helper are unit-tested without a device.

### 5.D Slice D — sync-safety check (code)

A small, host-aware **`checkVaultSyncReadiness(fs, host)`** helper, surfaced at folder-selection and boot:

- **iCloud-pending detection.** On iOS, the `VaultFs` `list` already maps `.icloud` placeholder names back
  to real names (so a cloud-only folder isn't seen as empty) and `read` does download-on-demand (07 §7,
  Q8). Add a `VaultFs` `hasPendingDownloads(bookmark)` (or have `list` optionally report which entries are
  placeholders) so the readiness check can tell "this folder still has not-yet-downloaded items." On
  Electron, a best-effort check for `.icloud` placeholder files in the chosen folder (the macOS iCloud
  placeholder naming) — best-effort only; non-iCloud local folders simply have none.
- **The decision rule** (additive to the existing boot gate, 10 §3.1):
  - `recovery.enc` **present + downloaded** → route as today (Unlock if no device key, Shell if key).
    Never warn — the vault is clearly initialized.
  - `recovery.enc` **absent** AND the folder **has pending iCloud downloads / placeholders** → **WARN**
    (§3.D), because "absent marker" might just mean "not downloaded yet." Offer **Check again** (re-run,
    triggering download-on-demand for the recovery marker) and **Set up anyway**.
  - `recovery.enc` **absent** AND **no** pending downloads (a genuinely empty/fresh folder) → route to
    Setup as today (no warning).
- **`createMasterKey` non-overwrite guard stays the hard backstop** (10 §6.3): even if the user picks
  "Set up anyway" and a real `recovery.enc` later syncs in, `createMasterKey` refuses to overwrite it (it
  re-checks `isVaultInitialized` at write time) — so D is a UX improvement layered over an existing
  data-loss guarantee, never the sole defense.
- Lives in the shared `createCoreBridge` / boot path so Electron + iOS share it; the placeholder probe is
  the host-specific part.

### 5.E Shared helper (slices C + D)

The conflict **name-pattern** matcher (`isConflictCopy`, today in `main/vault/conflicts.ts`) should move to
a small `@selfos/core` helper so **both** the desktop `findConflicts` and the iOS belt-and-suspenders path
apply identical rules (DRY). The `.icloud`-placeholder helper (D) likewise lives in core and is fed by the
host's directory listing. Neither requires new persisted state.

### 5.F Modules touched (summary)

| Slice | Layer         | File                                                                             | Change                                                                              |
| ----- | ------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A     | Docs          | `docs/specs/10-multi-device-vault.md` (+ a read-through of 04/07/08/14/18/26/28) | Prune/mark-obsolete the SA passages per the §5.A table.                             |
| B     | Shared proxy  | `apps/desktop/src/shared/claudeProxy.ts` (+ `openaiProxy.ts`?)                   | `runOpenAiConnectionTest` + a shared `mapError`.                                    |
| B     | Image host    | `apps/desktop/src/main/image/openaiImageClient.ts`                               | `verify(apiKey)` (models-list probe) + the offline fake's verify branch.            |
| B     | Bridge + seam | `coreBridge.ts`, `channels.ts`, preload, `test-utils/bridge`                     | `openaiTest` (resolves the key host-side, §6.2); typed result.                      |
| B     | Settings UI   | `settings/aiControls.tsx`, `settings/builtins.tsx`                               | `OpenAiTestConnectionControl` under `OpenAiKeyControl` in Settings → Dreams.        |
| C     | iOS native    | `apps/desktop/ios/App/App/VaultFs.swift`                                         | `findConflicts` via `NSFileVersion` (+ name-pattern); settle-once.                  |
| C     | TS host       | `host/capacitorVaultFs.ts`, `host/webHost.ts`                                    | `findConflicts` plugin method; Capacitor `getConflicts` → real call.                |
| C+D   | Core          | `@selfos/core` (new `vault/conflicts` / `vault/sync`)                            | shared `isConflictCopy` + `.icloud`-placeholder helpers; `checkVaultSyncReadiness`. |
| D     | iOS native    | `apps/desktop/ios/App/App/VaultFs.swift`                                         | `hasPendingDownloads` (or placeholder-flagged `list`).                              |
| D     | Boot/gate     | `createCoreBridge` boot path, `HouseholdGate` (renderer)                         | sync-readiness check + the warning state (Check again / Set up anyway).             |

## 6. IPC / API contracts

Renderer ↔ main only through the typed seam (00 §6.1); inputs Zod-validated. No key value crosses IPC.

### 6.A Slice A — none

**N/A — docs-only.**

### 6.B `openaiTest` — new

- **Channel:** `ai:openaiTest` (mirroring `claudeTest`). Direction: renderer → main (`invoke`/`handle`).
- **Request:** none (the model is read host-side from the Dreams `imageModel` setting; the key is
  resolved host-side).
- **Response:** `KeyTestResult` (the `ClaudeTestResult` shape — `{ ok: true, text? } | { ok: false, code,
message }`) with `code ∈ NO_KEY | AUTH | RATE_LIMIT | NETWORK | API_ERROR`.
- **Behavior:** `resolveOpenAiKey(host, fs)` (25) → if no key, `NO_KEY`; else `client.verify(key)` (a
  models-list GET, **never** an image generation) → `mapError` on failure. **The key never leaves main.**
- **Errors:** transport/auth map per the taxonomy; never throws to the renderer.

### 6.C `getConflicts` — unchanged contract, iOS impl

- **Channel:** existing `vault:getConflicts`. Response shape unchanged (`string[]`). Only the **iOS host
  implementation** changes (stub → real, §5.C). The desktop impl is unchanged.

### 6.D Vault sync-readiness — new host check (not a renderer channel)

- The readiness check runs **host-side** in the boot/selection path; its result drives the renderer gate
  state, not a standalone channel. If a channel is cleaner, add `vault:syncReadiness(): Promise<{ ready:
boolean; reason?: 'icloud-pending' }>` (Zod-validated), consumed by `HouseholdGate` to show the §3.D
  warning. (Build session picks: fold into boot-state vs a dedicated channel — §11.)
- **iOS native:** `VaultFs.hasPendingDownloads(bookmark): { pending: boolean }` (or placeholder-flagged
  `list`). Settle-once; no key needed.

### 6.E Claude / OpenAI API

- **B** makes a **non-generative** OpenAI API call (a models list) solely to verify auth — no prompt, no
  image, no streaming; mapped to the standard taxonomy. The key is host-side; the renderer sees only
  booleans/messages. **C/D** make no model calls. **A** is docs.

## 7. States & edge cases

| #   | Slice | Condition                                                      | Intended behavior                                                                                                                                                                                      |
| --- | ----- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | B     | No OpenAI key resolved                                         | `openaiTest` → `NO_KEY`; the control shows "Add your OpenAI key first." (no network call).                                                                                                             |
| 2   | B     | Bad/revoked key                                                | `AUTH` → "That OpenAI key was rejected. Check it and try again."                                                                                                                                       |
| 3   | B     | Rate-limited                                                   | `RATE_LIMIT` → "Rate limited by OpenAI. Try again shortly."                                                                                                                                            |
| 4   | B     | Offline / unreachable                                          | `NETWORK` → "Couldn’t reach OpenAI. Check your connection."                                                                                                                                            |
| 5   | B     | Other 5xx / unexpected body                                    | `API_ERROR` with the status. Never throws to the renderer.                                                                                                                                             |
| 6   | B     | Member tests the **shared** (25) key                           | Resolves the shared key host-side → tests it; a member can confirm the household key works. (Override wins if set.)                                                                                    |
| 7   | B     | Offline-fake host (`SELFOS_FAKE_IMAGE`)                        | Deterministic `ok: true` (or a forced failure mode for the failure test) — no network in unit/E2E.                                                                                                     |
| 8   | C     | iCloud conflict version present on iPhone                      | `findConflicts` reports it → the existing Banner shows (refreshed via the `onVaultChanged` presenter feed).                                                                                            |
| 9   | C     | No conflicts                                                   | `[]` → no Banner (unchanged).                                                                                                                                                                          |
| 10  | C     | Conflict file still a not-downloaded placeholder               | `NSFileVersion` query may not see an undownloaded version; the name-pattern fallback (§5.C) catches a renamed conflict copy if present. Best-effort, honest.                                           |
| 11  | C     | Web preview host                                               | Keeps returning `[]` (no real sync) — unchanged.                                                                                                                                                       |
| 12  | D     | Folder still downloading from iCloud, no `recovery.enc` yet    | **Warn** (§3.D), don't route to Setup. Check again re-probes (+ download-on-demand for the marker).                                                                                                    |
| 13  | D     | Genuinely fresh folder (no placeholders, no marker)            | No warning → Setup as today.                                                                                                                                                                           |
| 14  | D     | User picks "Set up anyway," real `recovery.enc` syncs in later | `createMasterKey` non-overwrite guard (10 §6.3) refuses to re-key; surfaces as a vault-error / Unlock per 10 §7 #8/#9. **No data loss.**                                                               |
| 15  | D     | Two devices both "Set up anyway" while fully offline           | Last-writer-wins on `recovery.enc` (10 §7 #7) — D shrinks the window + warns; the guard prevents silent overwrite of an already-synced marker. Documented mitigation, not eliminated (10 §2 non-goal). |
| 16  | D     | Electron (non-iCloud local / Dropbox folder)                   | Placeholder probe finds none → no warning → normal routing. (Dropbox/Drive partial-sync is best-effort; the marker-presence gate is the real signal.)                                                  |
| 17  | A     | Reader lands mid-spec-10 after the cleanup                     | Body no longer documents a live super-admin; any unavoidable historical reference is in the (append-only) changelog, clearly past-tense.                                                               |

## 8. Safety

Foundational/infra work — **no wellbeing or conversation content**, so **no crisis-routing / not-medical
surface here** (owned by the conversational specs per [`CLAUDE.md`](../../CLAUDE.md) §1). The standing
"wellness tool — not medical" line on LockScreen/About is untouched. The relevant safety surface is
**secret handling + data integrity**, inherited from 00/04/10:

- **B — the OpenAI key never crosses IPC and is never logged.** The test resolves the key host-side and
  returns only a boolean + a mapped message; the key value stays in main (00 §6.2 / §8). The probe is a
  read-only models-list call — it neither generates content nor sends user data.
- **C — read-only.** Conflict detection only **enumerates** version metadata; it never reads, writes,
  resolves, or deletes a conflicted file (00 §4.3 — surface, don't touch). No content leaves the device.
- **D — the data-loss guard is the safety property.** D never weakens the `createMasterKey` non-overwrite
  guarantee (10 §6.3) — it only adds an advisory warning _before_ the user can blunder into Setup on a
  mid-sync folder. Even the "Set up anyway" path can't orphan an already-synced vault (the guard re-checks
  at write time).
- **A — documentation honesty.** Removing fictional super-admin documentation makes the security posture
  accurately stated (no over- or mis-stated mechanism), consistent with 00/04/10's honesty mandate.

## 9. Accessibility

Defers to [`01-design-system.md`](01-design-system.md):

- **B:** the **`OpenAiTestConnectionControl`** is a real `<button>` with a clear accessible name, visible
  focus, ≥44px target; the "Testing…" busy state sets `aria-busy`; success/failure are meaningful text
  (never colour-alone), associated with the control. Mirrors the Claude `TestConnectionControl` exactly.
- **C:** no new UI — the existing conflict Banner's a11y (icon + text, semantic role) applies unchanged on
  iOS.
- **D:** the sync-warning is a `Banner`/card with icon + text (never colour-alone); **Check again** /
  **Set up anyway** are real keyboard-reachable buttons with distinct accessible names; the warning is
  programmatically announced (polite live region) when it appears at folder selection.
- **A:** docs-only — N/A.
- Responsive ~360px→desktop; no horizontal overflow at 390px on the Dreams Settings test control + the D
  warning (DoD guards, §10).

## 10. Testing strategy

Per CLAUDE.md DoD: E2E covers every new user-facing surface; iOS/Swift parts are verified on-device (can't
be unit/E2E'd here) but their **TS wiring + shared helpers are unit-tested**.

**Slice A (docs-only):**

- A **re-grep gate**: after the edits, `grep -i 'super-admin|superadmin|superAdmin'` over
  `docs/specs/10-multi-device-vault.md` returns **only** the append-only §12 changelog lines (and any
  explicit "Removed 2026-06-14" stubs) — no live-sounding body reference. (A doc-auditor / `sync-docs`
  check, not an automated test, but the slice's DoD asserts it.)
- The cross-spec stray-reference list (04/07/08/14/18/26/28) is produced and each item classified
  history-vs-live.

**Slice B (Vitest + RTL + E2E):**

- **Unit:** `runOpenAiConnectionTest` maps `401→AUTH`, `429→RATE_LIMIT`, no-status→`NETWORK`,
  `5xx→API_ERROR`, `null key→NO_KEY`; the shared `mapError` produces provider-correct messages. The fake
  `ImageClient.verify` returns deterministic ok / a forced failure.
- **Bridge unit:** `openaiTest` resolves the key host-side (override → shared, per 25) and **never returns
  the key value** in the response.
- **RTL:** `OpenAiTestConnectionControl` — idle → testing (`aria-busy`) → "Connected" on ok; the mapped
  failure message on each code; disabled while busy.
- **E2E:** in Settings → Dreams, with `SELFOS_FAKE_IMAGE`, click **Test connection** → "Connected"; with
  the no-key state → "Add your OpenAI key first"; a 390px overflow guard on the Dreams Settings section.

**Slice C:**

- **Unit:** the shared `isConflictCopy` name-pattern helper (moved to core) keeps its desktop cases green;
  the Capacitor host maps `plugin.findConflicts` output → `string[]` (and the web host still returns `[]`).
- **On-device (user-verified, not automatable here):** induce an iCloud conflict on two devices → the
  Banner appears on the iPhone. Documented as the manual verification step (project pattern).

**Slice D:**

- **Unit:** `checkVaultSyncReadiness` — `recovery.enc` present → `ready`; absent + pending placeholders →
  `not ready (icloud-pending)`; absent + no placeholders → `ready` (route to Setup). The `.icloud`
  placeholder helper detects placeholder names; the `createMasterKey` non-overwrite guard regression (10
  §6.3) stays green.
- **Component (RTL):** `HouseholdGate` shows the warning state when readiness is `icloud-pending` + no
  marker; **Check again** re-probes; **Set up anyway** proceeds to Setup.
- **E2E:** point at a folder seeded with `.icloud` placeholders + no `recovery.enc` → the warning shows
  (not Setup); simulate the marker arriving → Check again routes to Unlock; a 390px overflow guard on the
  warning.
- **On-device (user-verified):** a real mid-sync iCloud folder triggers the warning on the iPhone.

**Mocking:** vault against a temp dir / `memFileSystem`; the OpenAI/image client is the injectable fake
(`SELFOS_FAKE_IMAGE`); iCloud placeholder + conflict states are seeded as fixtures (placeholder filenames /
faked `findConflicts` output) since the real iCloud behavior is only reproducible on-device.

## 11. Open questions

Resolve in the build session — none silently assumed:

1. **B — result type name.** Reuse `ClaudeTestResult` for the OpenAI result, or rename it to a
   provider-neutral `KeyTestResult` (and re-point the Claude control)? (Recommendation: rename to
   `KeyTestResult` + share `mapError`; minor churn, cleaner.)
2. **B — OpenAI probe endpoint.** `GET /v1/models` (cheap, auth-only) vs another minimal call. Confirm
   `/v1/models` is the right zero-cost auth probe and that a valid image-only key can list models (if not,
   pick the cheapest endpoint that the image key is authorized for). **Must not** generate an image.
3. **B — coordination with [`25`](25-household-ai-credentials.md).** If 25 has landed, `openaiTest`
   resolves via `resolveOpenAiKey` (override → shared); if 25 hasn't landed, it tests the device secret
   directly. Confirm the interim path. (The resolver is the target.)
4. **C — primary detection mechanism.** `NSFileVersion.unresolvedConflictVersionsOfItem(at:)` as the
   primary iOS signal, with the name-pattern as belt-and-suspenders — confirm, and decide what identifying
   string to return per conflict (vault-relative path only, or path + a per-version label). The desktop
   returns absolute paths; should iOS return vault-relative paths and the renderer just count them
   (the Banner shows a count, not the paths)?
5. **D — channel vs boot-state.** Fold the sync-readiness signal into the existing boot-state / `HouseholdStatus`,
   or add a dedicated `vault:syncReadiness` channel? (Recommendation: extend the boot path so the gate has
   it without an extra round-trip.)
6. **D — Electron iCloud placeholder detection.** macOS iCloud uses `.icloud` placeholder files in some
   sync states but not all; confirm a reliable best-effort signal for the Electron side (it may be weaker
   than iOS's `VaultFs` knowledge). For non-iCloud providers (Dropbox/Drive), D relies on the
   marker-presence gate + the `createMasterKey` guard, not placeholder detection — confirm that's
   acceptable.
7. **Scope/sequencing.** These four are independent; confirm whether any should be split into separate
   PRs/sessions or shipped together. A is docs-only (fast); B is self-contained code; C+D share the core
   `vault/sync` helpers and both touch `VaultFs.swift` (blind-written) — pairing C+D may be efficient.

## 12. Changelog

- 2026-06-21 — created (Draft). Four independent multi-device housekeeping slices: **A** prune spec 10's
  stale super-admin documentation to match Owner-is-full-access (docs-only); **B** add an OpenAI key
  "Test connection" (`openaiTest`, a non-generative models-list probe, same NO_KEY/AUTH/RATE_LIMIT/NETWORK/
  API_ERROR taxonomy as Claude, resolving via spec-25's key resolver); **C** real iOS iCloud sync-conflict
  detection (`NSFileVersion` in `VaultFs` → the existing conflict Banner, blind-written Swift + user-verified);
  **D** sync-safety warning at folder-selection/boot so a still-downloading iCloud folder isn't mistaken for
  a fresh vault (advisory over the existing `createMasterKey` non-overwrite guard). Cross-references 07/10/13
  and the 25–28 group. To be refined in its own session.
