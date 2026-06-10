# 07 — Mobile platform (Capacitor + iCloud-Drive vault)

> **Status:** Draft · _last updated 2026-06-10_
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

## 11. Open questions

1. **Claude streaming on iOS** — (a) Anthropic SDK in **browser mode** (`dangerouslyAllowBrowser`,
   fetch + SSE) — simplest, reuses the SDK, but relies on `WKWebView` CORS/SSE to `api.anthropic.com`;
   (b) a **native HTTP plugin** (no CORS) — but SSE streaming over the Capacitor bridge needs a
   streaming-capable plugin. _Proposed: try (a); fall back to (b)._ Your call.
2. **Crypto unification** — OK to rewrite `cryptoService`/`masterKey`/`pin` off `node:crypto` to
   **WebCrypto + `scrypt-js`** (one impl, both platforms, existing vaults stay readable — proven by
   fixtures)? It's load-bearing, so it gets its own slice + thorough tests.
3. **Code organization** — extract to **`packages/@selfos/core`** and **reuse the existing
   `apps/desktop` renderer** for the iOS build, vs. a separate `apps/mobile`. \_Proposed: `@selfos/core`
   - one shared renderer.\_
4. **Custom native FS plugin** — confirm building a small **Swift Capacitor plugin** for
   security-scoped iCloud access + coordinated FS. (Required to share the _same_ iCloud folder as
   desktop; the app-sandbox iCloud _container_ would be a different folder and break the shared vault.)
5. **iCloud download-on-demand UX** — how much to build now for not-yet-downloaded files: a simple
   blocking "downloading…" state, or a richer affordance?
6. **Project specifics** — minimum **iOS version** (e.g. iOS 16+?) and the **bundle id / Apple
   Developer team** for `capacitor.config` + signing (you provide).
7. **Sequencing** — this is several slices, and only the first two are verifiable in this environment:
   (i) **crypto unification**; (ii) **extract `@selfos/core` + re-wire Electron through the host
   interfaces** (no behavior change, fully testable on desktop — and it cleans up the seams now);
   (iii) **Capacitor shell + iOS plugins + binding**; (iv) **iOS build/signing** (you, in Xcode).
   _Proposed: land (i)+(ii) first; they stand on their own even before any iOS work._

## 12. Changelog

- 2026-06-10 — created (draft) per the confirmed iPhone direction (Capacitor, iCloud-Drive vault,
  platform-adapter behind the existing seams, iOS-only, code-ready build). Open questions in §11.
