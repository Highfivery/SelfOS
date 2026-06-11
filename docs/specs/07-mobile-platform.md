# 07 — Mobile platform (Capacitor + iCloud-Drive vault)

> **Status:** Approved · _last updated 2026-06-10_
>
> Bring SelfOS to iPhone as **one codebase**: the same responsive React UI runs inside a native iOS
> shell via **Capacitor**, reading and writing the **same shared vault** as desktop — on **iCloud
> Drive**. To make that work, we introduce a **platform-adapter** layer so the business logic that
> today lives in the Electron _main_ process runs unchanged on both hosts. iOS-only for now (Android
> designed-for, not built); the iOS build/signing is run by the user in Xcode.

Builds on [`00-architecture.md`](00-architecture.md) (the process/IPC seams, the vault service),
[`02-app-shell.md`](02-app-shell.md) (onboarding + vault selection), [`04-people-roles.md`](04-people-roles.md)
(master-key crypto), and [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (the Claude proxy).

---

## 1. Overview

Electron is desktop-only and **cannot run on iPhone**. The realistic one-codebase path is
**Capacitor**: the existing React renderer runs in a `WKWebView` inside a thin native iOS app, and
native capabilities are reached through **Capacitor plugins** instead of an Electron main process.

The architectural problem this spec solves: today, everything that isn't pure UI — all vault `fs`,
the API-key keychain, the Claude proxy, and the at-rest crypto — lives in the Electron **main**
process and is reached over typed IPC (`window.selfos`, see [`00`](00-architecture.md) §3/§6). On iOS
there is no main process. So we define a small set of **platform host interfaces** (filesystem,
secret storage, Claude client); the business logic depends only on those interfaces; and each
platform supplies an implementation:

- **Desktop (Electron):** the host wires the interfaces to Node `fs`, `safeStorage`, and the Anthropic
  SDK — in main, behind the existing IPC. **No renderer change.**
- **iPhone (Capacitor):** the host wires the interfaces to Capacitor/native plugins (iCloud-Drive FS,
  iOS Keychain, mobile HTTP) and runs the same business logic **in the webview** (no IPC).

The renderer keeps talking to the same `SelfosBridge` contract; only the binding behind it differs.

## 2. Goals / Non-goals

**Goals**

- SelfOS runs on iPhone from the **same codebase** and the **same responsive UI** (no separate mobile
  app; see the responsive pass in [`02`](02-app-shell.md) §3.4 and [`01`](01-design-system.md) §5.5).
- The iOS app reads/writes the **same iCloud-Drive vault folder** as desktop — a genuinely shared
  vault, same Markdown/JSON format and Zod schemas.
- A clean **platform-adapter boundary** so business logic is written once and runs on both hosts.
- A **code-ready** iOS project (Capacitor config + plugins + build pipeline) that the user builds and
  signs in Xcode with their Apple Developer account.

**Non-goals (now)**

- **Android.** Keep the adapter platform-agnostic so Android can follow (its shared-folder story is
  the Storage Access Framework, not iCloud), but don't scaffold it yet.
- **App Store / TestFlight distribution.** Designed-for; the user drives signing and submission.
- **Background sync, push notifications, widgets, Apple-Watch, Siri.**
- **iPad-bespoke layouts** — the responsive UI already covers tablet widths.
- **Re-architecting desktop behavior** — Electron stays functionally identical; it's only re-wired
  through the new host interfaces (a refactor, not a redesign).

## 3. UX & flows

The UI is **identical** to desktop (it's the same responsive renderer). Only the platform touchpoints
differ — all on iOS:

1. **First-run vault selection (iOS).** Instead of a native folder dialog, present the iOS **Files
   picker** (`UIDocumentPickerViewController` in open-directory mode), guiding the user to pick — or
   create — a `SelfOS` folder **inside iCloud Drive**. Copy: _"Choose a folder in iCloud Drive so
   SelfOS stays in sync with your other devices."_ A user who already uses SelfOS on desktop picks the
   **same** iCloud `SelfOS` folder.
2. **Persisting access.** On selection, iOS returns a security-scoped URL; the app creates a
   **security-scoped bookmark** and stores it **device-local** (the path string alone does not grant
   access on a later launch). Subsequent launches resolve the bookmark to regain access.
3. **Resume / recovery.** On launch, resolve the saved bookmark. If it's **stale** (folder moved,
   renamed, deleted, or iCloud signed out), show the same calm vault-error recovery as desktop
   ([`02`](02-app-shell.md) §3.3), adapted: _"Re-select your SelfOS folder."_
4. **Everything else** — onboarding (owner + super-admin passphrase + recovery phrase), Sessions,
   People, Usage, Settings, the lock screen — is the shared UI, unchanged.

## 4. Data model (vault files & schemas)

- **Vault files & schemas are unchanged.** Same Markdown (`gray-matter` frontmatter) + JSON, same Zod
  schemas, same layout (`config/`, `.selfos/`, per-feature folders). Sharing one format across
  platforms is the entire point — desktop and iPhone read each other's files.
- **New device-local state (iOS):** instead of a plain `vaultPath`, iOS persists a **security-scoped
  bookmark** (a base64 blob) plus a display name. Device-local, never synced (mirrors desktop's
  `vaultPath`). `DeviceStateSchema` gains an optional `vaultBookmark?: string` used on iOS; desktop
  continues to use `vaultPath`. (The boot logic picks whichever the platform provides.)
- **Secrets (the Claude API key):** stored in the **iOS Keychain** on iPhone (never synced),
  mirroring desktop's `safeStorage` model. Never in the vault, never in the renderer.
- **Ownership unchanged:** every vault read/write still flows through the vault service — now via the
  injected `FileSystem` host — never direct `fs`/plugin calls scattered through features.

## 5. Architecture & modules

### 5.1 Platform host interfaces (the seams, abstracted)

Small capability interfaces, defined in shared core and injected into the business logic:

```ts
interface FileSystem {
  ensureAccess(): Promise<void>; // resolve the bookmark / acquire security scope (iOS); no-op on desktop
  read(path: string): Promise<Uint8Array | null>; // vault-relative
  writeAtomic(path: string, data: Uint8Array): Promise<void>; // temp-file + rename / coordinated write
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  watch(onChange: (path: string) => void): () => void; // returns an unsubscribe
}

interface SecretStore {
  get(id: string): Promise<string | null>;
  set(id: string, value: string): Promise<void>;
  has(id: string): Promise<boolean>;
  clear(id: string): Promise<void>;
}

// ClaudeClient is ALREADY an injectable streaming interface today (real SDK + offline fake).
```

**Crypto is unified, not abstracted.** Rewrite `cryptoService` / `masterKey` / `pin` off `node:crypto`
to **WebCrypto** (`globalThis.crypto.subtle`, AES-256-GCM — available in Node ≥20 _and_ `WKWebView`)
plus **`scrypt-js`** (matching the current scrypt params `N=16384,r=8,p=1`). One implementation runs on
both platforms, and existing desktop vaults stay byte-for-byte readable (proven by tests against
fixtures encrypted by the current `node:crypto` code).

### 5.2 Extract the business logic to `packages/@selfos/core`

Move the platform-agnostic services out of `apps/desktop/src/main` into a shared package depending
**only** on the host interfaces (no `node:*`, no `electron`):

- vault read/write/migrations/conflict-detection, crypto, people/access, conversations, usage,
  budgets, the prompt builder, pricing/metering.
- The shared Zod schemas/types in `src/shared` fold in (or stay as `@selfos/shared`).

The renderer, design system, and settings UI are untouched.

### 5.3 Two hosts, one contract

- **Electron host** (`apps/desktop`): `FileSystem` over Node `fs` (atomic temp-file + rename + the
  existing `chokidar` watcher), `SecretStore` over `safeStorage`, `ClaudeClient` over the Anthropic
  SDK. Wires the `@selfos/core` services **in main**, exposed to the renderer via the **existing typed
  IPC** (`window.selfos`). The renderer is unchanged.
- **Capacitor host** (the same renderer, built for iOS): `FileSystem` over a **custom Swift Capacitor
  plugin** (security-scoped bookmark + `NSFileCoordinator` coordinated read/write/list + presenter
  change events), `SecretStore` over an **iOS Keychain** plugin, `ClaudeClient` over mobile HTTP
  (see §6/§11). The `@selfos/core` services run **in the webview**; a host object implements the same
  `SelfosBridge` surface, so the renderer is platform-agnostic.
- **Binding:** at startup the renderer binds `window.selfos` (or a `host` provider) to the Electron IPC
  bridge or the in-webview Capacitor host, detected via Capacitor's platform check. `SelfosBridge`
  stays the single renderer-facing contract.

### 5.4 The Capacitor iOS shell

- `@capacitor/core` + `@capacitor/ios`; `capacitor.config.ts` (appId, `webDir` = the built renderer,
  scheme). Build pipeline: `vite build` (renderer) → `cap copy ios` → open/run in Xcode.
- Custom native plugin(s) in Swift under `ios/App/.../plugins`: a `VaultFs` plugin (document picker,
  bookmarks, coordinated FS, change presenter) and a Keychain plugin (or a vetted community one).
- **Safe-area insets:** the shell (TopBar, drawer, content) honors `env(safe-area-inset-*)` so content
  clears the status bar, notch, and home indicator.

## 6. IPC / API contracts

- **Electron:** unchanged typed IPC ([`00`](00-architecture.md) §6; the `SelfosBridge`).
- **Capacitor:** no IPC — the host implements `SelfosBridge` in-process. New **native plugin method
  contracts** (TS ↔ Swift), each typed + validated: `VaultFs.pickFolder() → { bookmark, name }`;
  `read/writeAtomic/exists/list/remove/mkdir` (all coordinated); `startWatch/stopWatch → change
events`; Keychain `get/set/remove`.
- **Claude:** the key stays in secure storage on both platforms and is never in renderer state. On
  Electron the Anthropic SDK runs in main; on iOS the client must **preserve streaming** (the Sessions
  UI streams deltas) — see §11 Q1 for the browser-mode-SDK vs native-HTTP decision.

## 7. States & edge cases (iOS, on top of [`00`](00-architecture.md) §7)

- **iCloud signed out / iCloud Drive disabled** → can't reach the vault; recovery screen
  ("Sign in to iCloud and enable iCloud Drive, or choose a local folder").
- **Stale security-scoped bookmark** (folder moved/renamed/deleted) → resolve fails → vault-error
  recovery → re-pick (§3.3).
- **Ubiquitous (not-yet-downloaded) iCloud files** → files may be placeholders; the FS host triggers
  download (`startDownloadingUbiquitousItem`) and surfaces a brief "downloading from iCloud" state;
  reads await materialization.
- **Coordinated-access + cross-device edits** → `NSFileCoordinator` for reads/writes; the existing
  sync-conflict detection (provider conflict copies + optimistic concurrency on `updatedAt`/hash;
  [`00`](00-architecture.md) §4.3) still applies when desktop and phone edit the same vault.
- **App backgrounded / security scope** → start/stop accessing the security-scoped resource around
  operations; re-acquire on foreground.
- **Offline** → non-AI features work against the local iCloud cache; Claude features degrade with the
  same messaging as desktop.

## 8. Safety

- Unchanged not-medical boundary + crisis routing (same UI; [`CLAUDE.md`](../../CLAUDE.md) §1, the
  Sessions crisis footer in [`05`](05-conversations.md)).
- **Privacy:** content lives in the **user's own iCloud Drive** (not a SelfOS server); the API key
  lives in the **iOS Keychain** (never synced); logs redact content and secrets, as on desktop
  ([`00`](00-architecture.md) §8).

## 9. Accessibility

Same design-system bar ([`01`](01-design-system.md) §9), already met by the responsive UI. iOS
additions: **safe-area insets**, **Dynamic Type** respected (helped by the existing text-scale + rem
tokens), VoiceOver labels (already present), ≥44px touch targets (from the responsive pass), and
reduced-motion honored (already global).

## 10. Testing strategy

- **`@selfos/core`** keeps **platform-agnostic** unit/integration tests (a temp-dir `FileSystem` fake +
  the Claude fake) — written once, valid for both platforms. Crypto gets fixtures proving cross-impl
  compatibility (current `node:crypto` output decrypts under the new WebCrypto path and vice-versa).
- **Electron:** the existing Playwright-Electron E2E is unchanged.
- **iOS host + plugins:** require a simulator/device — manual smoke + optional XCUITest. **Cannot run
  in headless CI** (and not in this build environment); the iOS build/signing/run is verified by the
  user locally. CI stays lint/typecheck/unit and gains the `@selfos/core` test project.

## 11. Resolved decisions & open questions

**Resolved with the user (2026-06-10):**

1. **Sequencing** — land the two desktop-verifiable refactors first, in order: **(i) crypto
   unification**, then **(ii) extract `@selfos/core` + re-wire Electron through the host interfaces**
   (no behavior change, fully tested on desktop). Then the iOS-only work: **(iii) Capacitor shell +
   iOS plugins + binding**, **(iv) iOS build/signing** (the user, in Xcode).
2. **Crypto** — **unify on WebCrypto + `scrypt-js`** (one implementation on both platforms; existing
   desktop vaults stay byte-for-byte readable — proven by fixtures). Not a per-platform interface.
3. **Claude streaming on iOS** — try the **Anthropic SDK in browser mode** (`dangerouslyAllowBrowser`,
   fetch + SSE) first; **fall back to a native HTTP plugin** if `WKWebView` blocks CORS/SSE.
4. **Code organization** — extract services to **`packages/@selfos/core`** and **reuse the existing
   `apps/desktop` renderer** for the iOS build (one UI, one place). No separate `apps/mobile`.
5. **Platform direction** — **iOS only** for now (Android designed-for, not built); **code-ready**
   build (the user runs Xcode build + signing with their Apple Developer account).
6. **Custom native FS plugin** — confirmed: build a small **Swift Capacitor plugin** for
   security-scoped iCloud access + coordinated FS (required to share the _same_ iCloud folder as
   desktop; the app-sandbox iCloud _container_ would be a different folder and break the shared vault).
7. **Project specifics (resolved 2026-06-10 for slice iii):** **bundle id `com.highfivery.selfos`**;
   **minimum iOS 18**; the user has a **Mac**. **Distribution: free personal signing first** (install on
   the user's own iPhone via Xcode + a free Apple ID; 7-day re-sign), **migrating to the Apple Developer
   Program + TestFlight** when ready for the wife's phone / public beta — that migration is **only a
   Signing-Team switch in Xcode + Archive→upload**, no code/project changes, so building now doesn't lock
   anything in.

**Open (deferred to the iOS-shell slices (iii)/(iv)):**

8. **iCloud download-on-demand UX** — how much to build for not-yet-downloaded files: a simple
   blocking "downloading…" state vs. a richer affordance.

## 12. Changelog

- 2026-06-10 — created (draft) per the confirmed iPhone direction (Capacitor, iCloud-Drive vault,
  platform-adapter behind the existing seams, iOS-only, code-ready build).
- 2026-06-10 — resolved §11 (sequencing = crypto → core → iOS shell → build; crypto unified on
  WebCrypto + scrypt-js; iOS Claude = browser-mode SDK with a native-HTTP fallback; code org =
  `@selfos/core` + one renderer; custom Swift FS plugin confirmed) after review; marked **Approved**.
  iCloud download-on-demand UX and the iOS bundle-id/version remain open for the iOS-shell slices.
- 2026-06-10 — **slice (i) landed (§5.1):** `cryptoService`/`masterKey`/`pin` rewritten off
  `node:crypto` onto WebCrypto (AES-256-GCM) + `scrypt-js` (`N=16384,r=8,p=1`), one shared `deriveScrypt`
  KDF. On-disk envelope + params unchanged (the appended GCM tag is split back to `{iv,tag,data}`);
  byte-for-byte compatibility proven by `cryptoCompat.test` against fixtures captured from the legacy
  code. The crypto layer is now async (awaits rippled to callers/tests/e2e). `Buffer`,
  portable-base64, and the `randomUUID` call sites are intentionally deferred to **slice (ii)** (the
  `@selfos/core` extraction, "no `node:*`"). Gates green: typecheck/lint/format, 183 unit, 23 E2E.
- 2026-06-10 — **slice (iii-a) landed (§5.3/§5.4):** first iOS step — a standalone **web build** of the
  renderer (`vite.web.config.ts` → `dist-web/`; `index.html`→`main.web.tsx`) + **Capacitor** scaffold
  (`@capacitor/core`+`ios`+`cli`, `capacitor.config.ts`: `com.highfivery.selfos`, webDir `dist-web`). A
  **temporary stub `window.selfos`** (`host/stubBridge.ts`) renders the UI in the WKWebView to validate
  the Capacitor→Xcode→device toolchain before the real native hosts (iii-b/c/d); it's throwaway. Verified:
  the full shell renders at 375px; Electron untouched (23 E2E); 193 unit green. The user runs `pnpm
build:web` then `cap add ios` + Xcode on their Mac (free signing first; §11.7). Next: iii-b VaultFs.
- 2026-06-10 — **`masterKey` relocated into `@selfos/core/crypto` (§5.1/§5.2):** the master-key
  generate/store/recover flow now lives in core (returns `Uint8Array` via the core base64 helpers),
  closing the last `Buffer` bridge — the app threads `Uint8Array` for the master key end-to-end. recovery.enc
  - the stored key are byte-identical (existing vaults restore). The iOS host (§5.4) gets the master-key
    flow for free.
- 2026-06-10 — **relocation slice 3 landed — `@selfos/core` extraction COMPLETE (§5.2):** moved
  `pricing`/`usageStore`/`budgetService` → `@selfos/core/usage` and `promptBuilder`/`chatService` →
  `@selfos/core/conversations` (verbatim; `Uint8Array` keys; portable `uuid()`). The `UsageSummary`/
  `BudgetState`/`BudgetStateKind`/`ChatTurnResult` view types moved into core `schemas.ts` (crypto-free,
  re-exported by `channels.ts`). **All platform-agnostic business logic now lives in `@selfos/core`**
  behind the FileSystem/SecretStore/ClaudeClient host interfaces; the app's `main/` is just the Electron
  host impls + `claudeService` proxy + `masterKey` (Buffer bridge) + device-local state + vault
  bootstrap/watcher + ipc + renderer. Gates: 193 unit, 23 E2E. **Remaining work is iOS-only: §5.4 the
  Capacitor shell + plugins + binding (iii), then build/signing (iv) — needs a Mac/Xcode + the user's
  Apple Developer team + bundle id.**
- 2026-06-10 — **relocation slice 2 landed (§5.2):** moved the people/access domain
  (`peopleService`/`relationshipService`/`accessService`/`buildContext` + tests) into `@selfos/core/people`
  — verbatim, `Uint8Array` keys, portable `uuid()` (no `node:crypto`). `AccessView` moved into core
  `schemas.ts` so `channels.ts` imports it from the crypto-free schemas shim (keeps `core/crypto` out of
  the renderer/web tsconfig). Moved tests use the `memFileSystem` fake; new export `./people`. The app's
  `people/` is now just household/session/superAdmin. No behavior/contract change. Gates: 193 unit, 23 E2E.
- 2026-06-10 — **relocation slice 1 landed (§5.2):** began physically moving the platform-agnostic
  services into core — this slice relocates **`encryptedStore` → `@selfos/core/vault`** and
  **`conversationService` → `@selfos/core/conversations`** (verbatim; no behavior change). The moved files
  type keys as `Uint8Array` (core is Buffer-free); the app keeps threading `Buffer` (assignable) with
  `masterKey` as the bridge. Added a core `memFileSystem` test fake + exports `./vault`/`./conversations`.
  Format/paths byte-identical (23 E2E). Remaining relocations: people/access (peopleService/relationship/
  access/buildContext + AccessView) then usage/budgets/chat (usageStore/budget/chat/pricing/promptBuilder
  - UsageSummary/BudgetState/ChatTurnResult), each switching `Buffer`→`Uint8Array` + portable `uuid()`.
- 2026-06-10 — **slice (ii-c) landed (§5.1/§5.3):** added the **`SecretStore`** (get/set/has/clear) and
  **`ClaudeClient`** (moved out of the app's `claudeService`) host interfaces to `@selfos/core/host`, and
  rewired the remaining node/electron-coupled logic onto them (DI, no behavior change). The Electron
  `createNodeSecretStore(userDataDir, encryptor)` is the old `secretStore` logic moved verbatim; the
  `Encryptor` interface moved to `secrets/encryptor.ts`. `masterKey` now takes
  `(secrets: SecretStore[, fs: FileSystem])` (recovery.enc via `fs`) → fully node/electron-free.
  recovery.enc + secrets.json formats are byte-identical (existing vaults still restore/decrypt). All
  three host interfaces (FileSystem / SecretStore / ClaudeClient) now exist; the platform-agnostic service
  files still physically live in `apps/desktop` and **relocate into core in the next (mechanical) slice**.
  Gates green: 189 unit, 23 E2E.
- 2026-06-10 — **slice (ii-b) landed (§5.1/§5.3):** introduced the **`FileSystem`** host interface
  (`@selfos/core/host` — `read`/`writeAtomic`/`list`/`remove`, vault-relative paths) and refactored the
  encrypted vault-data layer (`encryptedStore` + people/relationship/access/usage/budget/conversation
  services + buildContext/promptBuilder/chatService) to thread `fs` instead of `node:fs`/`node:path` — a
  pure I/O abstraction, no behavior change. The Electron impl `createNodeFileSystem(vaultDir)` (node fs
  rooted at the vault + atomic write + `notifyWrite` echo-suppression) lives in the app; `ipc.ts`'s
  `vaultAndKey()` returns `{ fs, key }`. Services stay in the app (keep `Buffer` + `randomUUID`) and
  relocate into core in a follow-up. On-disk format/paths byte-identical; the host treats `ENOTDIR` like
  `ENOENT` so stray synced files (`.DS_Store`) don't break listings. Gates green: 189 unit, 23 E2E.
  Next: **(ii-c)** SecretStore + ClaudeClient hosts (masterKey/secrets/claude/chatService), then relocate
  the platform-agnostic service files into core.
- 2026-06-10 — **slice (ii-a) landed (§5.2):** created the source-only **`@selfos/core`** package
  (`exports`→`.ts`, bundled into Electron `main` via electron-vite `externalizeDepsPlugin({exclude})`).
  Moved the shared schemas/types (`schemas`/`capabilities`/`usageTypes`/`appearance`) and crypto
  (`cryptoService`/`pin`) into it; `apps/desktop/src/shared/*` are re-export shims so the renderer + IPC
  contract are untouched. Crypto completed its **`Buffer`→`Uint8Array` + portable-base64** (`btoa`/`atob`)
  migration → core is `node:*`/`Buffer`-free (enforced by an ESLint override on `packages/core`); the app
  bridges back to `Buffer` at `masterKey`. Byte-compat fixtures moved into core, still green. Decisions:
  sub-slices = incremental; injection = thread the host objects; schemas = into core + shim. Gates green:
  typecheck/lint/format, 183 unit (22 core + 161 desktop), 23 E2E. Next: **(ii-b)** FileSystem host +
  vault/atomic + the file-using services (people/conversations/usage).
- 2026-06-10 — **slice iii-b1 landed (§5.3):** extracted the shared **`createCoreBridge(host)` factory**
  (`apps/desktop/src/shared/coreBridge.ts`, node/electron-free) — one `BridgeHost` interface + the ~30
  `SelfosBridge` data ops implemented **once** over injected platform primitives (`vaultAndKey`/`fileSystem`/
  `secrets`/`claude`/device-state/device-settings/`activeModel`/super-admin flag/`emitChatChunk`/`appVersion`
  - the forwarded platform ops). Electron's `ipc.ts` now builds a node-backed host, calls the factory, and
    registers each `ipcMain.handle` as a thin delegate; platform-specific ops (folder picker, chokidar
    watcher, conflicts, reveal, boot-state) stay in the host, and `useVault`/`chatStream` are special-cased to
    capture `event.sender`. Supporting moves: `runConnectionTest`/`mapError` → **`shared/claudeProxy.ts`**
    (deleted `main/claude/claudeService.ts`); `main/settings/settingsStore.ts` slimmed to device-only (vault
    settings handled in the factory via the FileSystem host); `main/people/superAdmin.ts` slimmed to the
    in-memory inspect flag (passphrase set/has/verify + the device→vault migration moved into the factory);
    **deleted `main/people/household.ts` + `session.ts`** (logic → factory); core gains a `./id` export +
    re-exports `memFileSystem`. Behavior-preserving — inputs are still Zod-validated **in the factory** so the
    trust boundary holds on both hosts; the API key stays host-side. Gates green: typecheck/lint/format,
    **228 unit** (76 core + 152 desktop, incl. a new factory test exercising real `@selfos/core` over
    `memFileSystem`), **27 E2E**. The factory is iOS-ready; **iii-b2** wires the in-webview host to it.

## 13. Implementation roadmap & status

The full arc, so no session loses the thread. Update the status boxes as slices land; the Changelog
(§12) holds the detail. The renderer is shared; the only per-platform difference is who provides
`window.selfos` (Electron preload+IPC vs. the iOS in-webview host) — see §5.3.

- [x] **(i) Crypto unification** — at-rest crypto on WebCrypto + `scrypt-js`, vaults byte-compatible.
- [x] **(ii) Extract `@selfos/core` + rewire Electron** — all platform-agnostic logic behind the
      FileSystem/SecretStore/ClaudeClient host interfaces (ii-a/b/c + relocation slices 1–3).
- [x] **(iii-a) Capacitor shell + web build** — `vite.web.config.ts`→`dist-web/`, `capacitor.config.ts`,
      the tracked `ios/` Xcode project; UI renders on the simulator via a **temporary `stubBridge.ts`**.
- [x] **iii-b prerequisite — WebView crypto/DOM-lib compat** — `@selfos/core` now typechecks under the
      renderer's DOM lib (a `bufferSource()` copy at the WebCrypto boundary in `cryptoService.ts`), so it
      can run in the WKWebView. Verified under both `tsconfig.web` and `tsconfig.node`.
- [x] **iii-b1 — shared `createCoreBridge(host)` factory + Electron migration.** Extracted one
      platform-agnostic factory (`apps/desktop/src/shared/coreBridge.ts`, node/electron-free) implementing
      the ~30 `SelfosBridge` data ops over an injected `BridgeHost`; migrated Electron's `ipc.ts` to delegate
      to it (platform-specific ops — folder picker, conflicts, reveal, chokidar watcher, boot-state — stay
      in the host). Behavior-preserving: 228 unit + 27 E2E green. _(Decided: shared factory; browser-verify
      before Swift.)_
- [ ] **iii-b2 — iOS in-webview host + browser verification.** Implement `BridgeHost` for the WebView:
      an in-browser FileSystem (for the web preview), a DeviceStore over Capacitor Preferences/localStorage,
      **temporary** SecretStore + ClaudeClient stubs. Add `vaultBookmark?: string` to `DeviceStateSchema`
      (iOS persists a security-scoped bookmark, not a path — §4). Build `installRealBridge()`, **delete
      `stubBridge.ts`**, and verify the real app (onboarding → setup → people → invites → multi-device) in
      the web preview against real `@selfos/core` + a real in-browser filesystem.
- [ ] **iii-b3 — Swift `VaultFs` Capacitor plugin + TS FS adapter.** `UIDocumentPicker` open-directory
      (iCloud folder), security-scoped bookmark create/resolve (handle stale → re-pick), `NSFileCoordinator`
      coordinated read/writeAtomic(temp+rename)/list/remove on vault-relative paths, a presenter for change
      events. Blind-written; user runs `build:web` → `npx cap sync ios` → Xcode. No iCloud-container
      entitlement needed (access is via security scope — §11.6).
- [ ] **iii-c — iOS Keychain + Claude.** Real Keychain `SecretStore` (replace iii-b2's stub:
      `kSecClassGenericPassword`, accessible-after-first-unlock-this-device-only, not synced; holds master
      key + API key) + Claude via the Anthropic **browser-mode SDK** (`dangerouslyAllowBrowser`) with a
      **native-HTTP fallback** for WKWebView CORS (§11.3).
- [ ] **iii-d — free-signing install** on the user's + wife's physical iPhones (personal team; trust the
      cert on-device; 7-day provisioning expiry — §11.7).
- [ ] **(iv) Distribution (later)** — Apple Developer Program + TestFlight (free signing first; a
      signing-team switch in Xcode, no code changes — §11.7).

**Cross-cutting dependency:** [`10-multi-device-vault.md`](10-multi-device-vault.md) (vault identity,
device join & recovery, member invites) is **fully built** and shares the same `@selfos/core` flows, so
it comes along to iOS for free once the host (iii-b) lands.
