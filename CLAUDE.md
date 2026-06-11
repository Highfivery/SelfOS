# CLAUDE.md — SelfOS

Project rules for Claude Code. Read this every session. It is the source of truth for **how**
we build SelfOS; the **what** lives in [`docs/specs/`](docs/specs).

---

## 1. What SelfOS is

SelfOS is an **AI therapist + life coach** desktop app. It is powered by the **Claude API** and
stores everything as plain files the user owns.

### Positioning & safety (non-negotiable)

- SelfOS is a **wellness / self-help** tool. It is **NOT medical**, **NOT a medical device**, and
  **NOT a substitute for professional care**. Never describe it as therapy in the clinical sense,
  diagnosis, or treatment.
- Any feature that touches the user's wellbeing must keep this boundary visible and must route
  crisis/self-harm situations to professional resources (e.g., emergency services, crisis lines)
  rather than attempting to handle them alone. When we build conversational features, this becomes
  a hard requirement with its own spec section.
- Treat all user content as **highly sensitive personal data**. It never leaves the device except
  in explicit Claude API calls the user has consented to. The API key lives **only** in the
  Electron main process and is never logged, committed, or exposed to the renderer.

---

## 2. Tech stack

| Area             | Choice                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| Platform         | Electron + React + **TypeScript (strict)**                             |
| Data             | Plain-file **vault**: Markdown (content) + JSON (state/config)         |
| Vault location   | User-chosen folder (local / Dropbox / iCloud / Drive). **No backend.** |
| AI               | Claude API — key in the **main process only**                          |
| Build / package  | electron-vite (dev/build) + electron-builder (distribution)            |
| Styling          | CSS custom properties (design tokens) + CSS Modules                    |
| State            | Zustand                                                                |
| Validation       | **Zod** — single source of truth; TS types are inferred from schemas   |
| Routing          | React Router                                                           |
| Unit / component | Vitest + React Testing Library                                         |
| E2E              | Playwright (Electron)                                                  |
| Repo             | pnpm monorepo (`apps/desktop`, `packages/*`)                           |

Defer voice/interaction modality, but never make an architectural choice that precludes it.

---

## 3. Architecture principles

1. **Feature-module registry.** Each feature is a self-contained module that _registers_ what it
   contributes (nav entry, routes, settings, data schemas). The app shell knows nothing about
   specific features — adding a feature is adding a module, not editing the shell.
2. **Schema-driven everything.** Settings (and content types) are declared as typed, Zod-backed
   definitions; UI and persistence derive from the declaration. Add a setting = add one declaration.
3. **Vault is the only storage.** All file I/O goes through the main-process vault service: atomic
   writes (temp-file + rename), file-watching, sync-conflict detection, per-format schema
   validation + migration. The renderer never touches `fs`.
4. **Hard process boundaries.** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
   strict CSP, no remote module. Renderer ↔ main only through a **typed IPC layer** (contextBridge
   preload + typed channel contracts). Secrets and network access stay in main.
5. **DRY, typed seams.** Shared types/schemas live in one place and are imported across
   main/preload/renderer. No duplicated shapes; no `any`.

> These are summarized here; the authoritative detail is [`docs/specs/00-architecture.md`](docs/specs/00-architecture.md).

---

## 4. Coding standards

- **TypeScript strict**, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`; prefer
  `unknown` + narrowing. No non-null `!` to silence the compiler — fix the type.
- **Zod first.** Define a Zod schema, then `z.infer` the type. Validate at every boundary (files,
  IPC, Claude API responses).
- **Named exports** only (no default exports). **One component per file.** Co-locate
  `Component.module.css` next to `Component.tsx`.
- **No magic values.** Colors, spacing, etc. come from design tokens — never hard-coded.
- **Errors are typed and handled**, never swallowed. User-facing failures degrade gracefully.
- **Accessibility is not optional** — semantic HTML, keyboard support, visible focus, sufficient
  contrast.
- Match the style of surrounding code. Keep modules small and cohesive.

---

## 5. Spec-driven workflow

**No feature code without an approved spec in `docs/specs/`.** The spec is written first, reviewed,
and perfected; then code follows it. If implementation reveals the spec is wrong, update the spec in
the same change (see Living docs).

Specs are numbered and inherit [`docs/specs/_TEMPLATE.md`](docs/specs/_TEMPLATE.md).

---

## 6. How we work — the methodical cadence

We move **slowly and deliberately**, perfecting one slice before starting the next.

For every slice:

1. **Branch** off `main` (`feat/…`, `fix/…`, `chore/…`, `docs/…`). Never commit directly to `main`.
2. **Spec** → review with the user → perfect → approve.
3. **Implement** with tests (see Definition of Done).
4. Run the **`ship-slice`** skill: `quality-gate` → `code-reviewer` agent → `sync-docs` → commit.
5. Confirm Definition of Done, then merge to `main` (locally for now) and move on.

**ALWAYS ask — NEVER assume or guess.** Before implementing anything with an unstated product, UX,
visibility, permission, or behavior decision (defaults, who-sees-what, scope, placement, period),
**stop and ask detailed clarifying questions** (`AskUserQuestion`). Do not fill gaps with your own
defaults. The user has stated this forcefully and repeatedly; guessing has produced rework. Only
proceed without asking when the choice is genuinely unambiguous from the request or already answered.

---

## 7. Definition of Done

A slice is **not** done until **all** of these pass:

- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean (ESLint) and Prettier-formatted
- [ ] Unit/component tests for new logic (Vitest); meaningful, not trivial
- [ ] E2E tests for **every** new user-facing surface/section, not just the happy path (Playwright);
      include a no-horizontal-overflow / layout guard for content-heavy screens, and a geometry guard
      for fixed-size controls (e.g. a toggle must not shrink in a flex row — assert computed
      `flex-shrink` / thumb position)
- [ ] **Docs in lockstep** — relevant spec / `CLAUDE.md` / skills updated (`sync-docs`)
- [ ] **Self code-review** passed (`code-reviewer` agent); findings fixed or explicitly accepted
- [ ] Accessibility check for any UI
- [ ] **Responsive** — every UI works and looks intentional from ~360px (phone) to desktop; include a
      mobile-width layout guard (see §12)
- [ ] **Visual QA pass (not just functional)** — screenshot every touched/new surface and look
      critically: alignment (buttons bottom-aligned with the inputs beside them, not floating
      mid-height), even spacing/rhythm, nothing clipped, and each element looks intentional and
      cohesive with its neighbours. Fix bad-looking UI before it ships — don't rely on "the test
      passed" (see §12).
- [ ] **`/gallery` updated** when a design-system primitive is added or changed (it must showcase all of them)
- [ ] **Admin-only UI is marked** — any control/section visible only to an Owner / super-admin carries a
      consistent "admin only" indicator (see §12)
- [ ] **Conventional Commit** on a feature branch

The `quality-gate` skill runs the automatable subset. The git hooks
(`.husky/pre-commit`, `commit-msg`, `pre-push`) and CI enforce the hard gates so they can't be
bypassed.

---

## 8. Living docs & the feedback loop (keep everything up to date)

Docs, rules, and skills must always match reality. Two loops:

- **Reactive — when the user gives feedback or a durable preference:** use the **`capture-feedback`**
  skill to persist it to the right place (this file, a skill, settings, or a spec) and append a dated
  entry to the Changelog below. Don't just remember it for the session — write it down.
- **Proactive — after any change in behavior:** use the **`sync-docs`** skill (backed by the
  `doc-auditor` agent) to detect drift between code and `docs/specs/` / `CLAUDE.md` / skills, and
  propose the concrete edits. The `pre-commit` doc-drift warning is the deterministic backstop.

If you notice a rule here is stale or contradicted by how we actually work, **propose updating it**.

---

## 9. Git & commit standards

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`,
  `build:`, `ci:`, `chore:`, `revert:`). Enforced by commitlint; body lines ≤ 100 chars.
- Every commit ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Feature branches only**; merge to `main` after review. The **`commit`** skill writes compliant
  messages; it refuses to commit if the quality gate hasn't passed.

---

## 10. Commands

```bash
pnpm install        # install deps + set up git hooks (husky)
pnpm lint           # ESLint across the monorepo
pnpm lint:fix       # ESLint --fix
pnpm format         # Prettier write
pnpm format:check   # Prettier check
pnpm typecheck      # TypeScript per-package (--if-present)
pnpm test           # Vitest unit/component (delegates to each package)
pnpm test:watch     # Vitest watch

# Desktop app (apps/desktop)
pnpm --filter @selfos/desktop dev     # electron-vite dev (HMR)
pnpm --filter @selfos/desktop build   # build main/preload/renderer to out/
pnpm --filter @selfos/desktop e2e     # build, then Playwright-Electron E2E
```

Tests are **per-package** (`pnpm -r test`): the desktop app runs Vitest with a jsdom environment for
component tests. E2E (Playwright + Electron) runs on demand / in CI, not on every push (it builds the
app first).

---

## 11. Skills & agents available

**Skills** (`.claude/skills/`): `write-spec`, `quality-gate`, `capture-feedback`, `sync-docs`,
`commit`, `ship-slice`. (`add-setting` and `new-feature-module` are added once the settings registry
and feature-module architecture are built.)

**Agents** (`.claude/agents/`): `code-reviewer`, `test-author`, `spec-writer`, `doc-auditor`.

---

## 12. UI/UX principles (non-negotiable)

Every UI change is designed **as part of the whole** — sleek, modern, and intentional. Nothing should
look bolted-on or like an afterthought; consider the overall layout and likely future additions before
placing anything. Specifically:

- **Responsive, one codebase.** SelfOS is a single responsive app (no separate mobile UI). Every screen
  must look and work great from ~360px (phone) to desktop, adapting purely by screen size. Treat this
  like accessibility — always. (Electron is desktop-only; the iPhone path is **Capacitor** — see the
  platform memory and the Capacitor track.)
- **Admin-only visibility marker.** Anything visible **only** to an Owner / super-admin (cost, budgets,
  the Everyone scope + person picker + by-person breakdown, the Roles screen, etc.) carries a clear,
  consistent indicator (e.g. a small "Admin only" / lock badge) so admins know normal users don't see
  it. Apply to **all** current and future admin-gated UI.
- **Global controls live in the `TopBar`** (a slot-based header): the usage ring, the appearance
  (light/dark) toggle, logout, and future global items — integrated seamlessly, not as separate add-ons.
- **`/gallery` is the living component catalog** — update it whenever a design-system primitive is
  added or changed (DoD item).
- **No scaffolding for unbuilt features.** Don't pre-create capabilities/schemas/settings/routes for
  features that aren't specced and built (see the "never assume" rule in §6).
- **Visual QA is part of testing.** When testing a change, scrutinize the rendered UI for alignment,
  spacing, vertical rhythm, and polish — not only "does it work." Screenshot every touched surface and
  look critically (e.g. buttons must bottom-align with the labelled fields beside them, not float
  mid-height). Catch bad-looking UI before the user does. (DoD §7.)
- **"Improve" means redesign, not relocate.** When asked to improve or move a component, actually
  redesign it for its new context — fit, density, space-conservation, cohesion with neighbours — don't
  just move the existing component. (E.g. the appearance control became a compact icon→popover in the
  TopBar, not the old wide segmented control; the brand mark sits in an app-icon tile, not a loose glyph.)

---

## Changelog

A running log of durable decisions and feedback captured into the project config. Newest first.

- 2026-06-10 — Build (**Slice 2a of [10-multi-device-vault](docs/specs/10-multi-device-vault.md)** — the
  owner side of **member invite codes**). **Decisions (asked):** code = **word phrase** (6 words from a
  curated 128-word `inviteWords` list, ~2⁴²); **7-day** expiry; the **member sets their own PIN** on
  redeem (owner never knows it); generated from the member's **Access tab**; QR deferred; invites
  cancelable. Core `@selfos/core/people/inviteService`: `generateInviteCode`, `createInvite` (wraps the
  master key under the code's scrypt KEK into a **key-free-readable** `config/invites/<id>.enc` — the
  redeeming device has no key yet, like `recovery.enc`), `listInvitesForPerson` (GCs expired),
  `cancelInvite`, `redeemInvite` (single-use: deletes on redeem). IPC `invites:create/list/cancel` are
  **owner-only (`people.manage`) AND member-scoped, enforced in main** — `create` rejects a missing/owner
  target and supersedes any prior pending invite (the reviewer flagged closing the UI↔main trust gap).
  Owner UI: `DeviceInviteControl` on the Access tab (generate → code shown **once** + copy + warning;
  pending list + cancel/regenerate). Reviewer: crypto sound (2⁴² + scrypt + 7-day + single-use beats a
  brute-force racing a pending invite; master key never plaintext on disk/IPC). Gates green: typecheck/
  lint/format, **220 unit** (76 core + 144 desktop), visual QA desktop + 390px. **NEXT: Slice 2b** — the
  member **redeem** flow (UnlockScreen "Have an invite code?" → enter code → set own PIN → join) + the
  owner-generate→member-redeem E2E round-trip. **Lesson: enforce member-scoping in MAIN, not just by
  rendering the control for non-owners — the renderer isn't the trust boundary.**
- 2026-06-10 — Build (**Slice 1 of [10-multi-device-vault](docs/specs/10-multi-device-vault.md) complete**
  — sub-slices 1b + 1c shipped on top of 1a). **1b: super-admin secret → the vault.** New
  `@selfos/core/people/superAdmin` writes a salted scrypt hash, encrypted under the master key, to
  `config/superadmin.enc` (the same at-rest pipeline as the rest of the vault); the app module is now a
  thin host wrapper owning a **one-time idempotent device-local→vault migration** (legacy
  `superAdminPassphraseHash` in deviceStore is read once to seed the vault, then unused). `verify`
  degrades to `false` (never throws) on a corrupt file; `has` is **presence-based** so the migration
  can't clobber a corrupt copy. So the super-admin is now **one-per-directory** and works on any device
  holding the key. **1c: owner PIN required at Setup.** A "Your PIN" + "Confirm PIN" field (min
  `MIN_OWNER_PIN_LENGTH`=4) threads through `householdSetup` into the owner account, so a leaked
  recovery phrase alone can't sign in as the owner on a joined device. Reviewer verdicts: 1b **ship**
  (hash never plaintext on disk/logs; migration idempotent + can't fail-open), 1c **ship** (validation
  parity front-to-back; the Confirm-PIN was added per the reviewer's typo-lockout flag). Also **fixed a
  pre-existing flaky E2E**: the concealed super-admin long-press now dispatches `pointerdown`/`up`
  directly on the version element (deterministic; 8/8 under `--repeat-each`) instead of
  `click({delay})`. Gates green: typecheck/lint/format, **210 unit** (69 core + 141 desktop), **25 E2E**.
  **NOTE (flag): three spec files appeared untracked in the tree mid-session — `08-questionnaires.md`,
  `09-session-analysis.md`, and `10-relationship-tracking.md` (a number-10 collision with this spec) —
  created by something outside this work; left untracked, not committed. Needs the user to decide.**
- 2026-06-10 — Spec approved + **Slice 1a built**: **[10-multi-device-vault](docs/specs/10-multi-device-vault.md)**
  (multi-device household — vault identity, device join & recovery). User flagged: only **one owner +
  one super-admin per directory** — a second person opening the same shared (iCloud) folder must NOT
  become owner/super-admin; a **member** should install on their own device and do member things.
  Investigation found it's worse than that: the boot gate decided "first-run setup" from whether **this
  device** held the master key, so a 2nd device re-ran Setup → `createMasterKey` **overwrote
  `config/recovery.enc`** (orphaning all ciphertext) **+ minted a second owner** — a data-loss bug.
  **Decisions (asked):** super-admin hash moves **into the vault**; **phased** delivery — Slice 1
  (safety fix: detection + guards + super-admin→vault + recovery-phrase unlock) then Slice 2 (one-time
  member **invite/pairing codes** — chosen over PIN-wrapping the master key, which is offline-
  brute-forceable from the synced file); owner **PIN required** at Setup; recovery-phrase unlock allows
  **any persona** (it's the owner's secret; members onboard via Slice 2). Slice 1 ships in 3 sub-slices:
  **1a (done)** = key-free `vaultInitialized` (recovery.enc presence) + a hard `createMasterKey` guard
  that **never overwrites** an existing recovery.enc + a resume-aware `setupHousehold` (finishes an
  interrupted setup without re-keying, refuses a second owner) + the **three-way `HouseholdGate`**
  (Setup / `UnlockScreen` / Shell-or-picker) + `household:unlockWithRecoveryPhrase` IPC + the
  recovery-phrase `UnlockScreen`; **1b** = super-admin → `config/superadmin.enc` (+ migration); **1c** =
  owner PIN at Setup. Reviewer verdict: the re-key guard is airtight (recovery.enc byte-identical after
  a blocked 2nd setup; phrase never logged; renderer never sees the key). Gates green: typecheck/lint/
  format, **203 unit** (64 core + 139 desktop), **25 E2E** (incl. 2nd-device-unlocks-no-second-owner +
  interrupted-setup-resume). **Lesson: "is the vault set up?" is a property of the VAULT (a key-free
  file marker), not of the device's keychain — conflating them re-keys shared vaults.**
- 2026-06-10 — Fix (responsive Settings + Roles — user flagged from the iOS simulator): two screens
  failed the responsive DoD at phone width. **Settings** crammed the 176px section rail beside the
  content, crushing field descriptions to one-word-per-line; now below `--bp-md` the layout is one
  column, the section nav is a **horizontal scrollable pill row** (44px tap targets) above the content,
  and each `SettingField` **stacks** the label/description above a full-width control. Desktop keeps the
  sticky side rail + two-column rows (unchanged). **Roles** was a 4-column `role × capability` `<table>`
  that needed horizontal scroll and clipped the Guest column + left labels; redesigned into **per-role
  cards** (Owner/Member/Guest) — a 3-up `auto-fit minmax(240px,1fr)` grid on desktop that **stacks** on
  phones, so there's never a horizontal scroll. Owner card is locked all-on with a "Full access" marker.
  Per-toggle `aria-label`s (`"{role}: {capability}"`) are preserved; the visible capability label is
  `aria-hidden` to avoid a double SR announcement. **Decisions (asked):** Settings nav = pill row; Roles
  = card-per-role. Tests: Roles unit asserts the Full-access marker; the **390px E2E guard now walks
  Settings** (+ a per-section-pill sub-walk) and asserts the **Roles cards stack** (shared left edge).
  doc-auditor: specs say "matrix" conceptually (not `<table>`) so **no spec edits** needed. Gates green:
  typecheck/lint/format, 193 unit, 23 E2E. **Lesson (again): desktop-fine ≠ phone-fine — these only
  surfaced on the simulator; screenshot every touched surface at 390px.**
- 2026-06-10 — Fix (iOS deployment target → **18.0**) + note: the **generated `ios/` Xcode project is now
  tracked** in the repo (`apps/desktop/ios/`). `cap add ios` (run while iterating on the simulator) scaffolds
  the project at Capacitor's default **iOS 14.0**; corrected the `Podfile` (`platform :ios, '18.0'`) and all
  four `IPHONEOS_DEPLOYMENT_TARGET` build settings in `App.xcodeproj/project.pbxproj` to **18.0** to match the
  approved [07-mobile-platform](docs/specs/07-mobile-platform.md) decision (§ resolved questions). The project
  is the **code-ready iOS shell** the spec calls for, so it belongs in source: tracked = the project, Swift
  (`AppDelegate`), `Info.plist`, storyboards, asset metadata, `Podfile`/`Podfile.lock`; **gitignored** =
  `Pods/`, `App/public/` (the synced web build), `DerivedData/` (build artifacts — regenerated by
  `cap sync` / Xcode). Bundle id `com.highfivery.selfos`, display name SelfOS (both correct). **Note: the
  safe-area commit (890bc63) swept the freshly-generated `ios/` in via `git add` without naming it — content
  is right (source tracked, artifacts ignored), only the message was silent; recording it here.**
- 2026-06-10 — Fix (iOS safe-area — user flagged from the simulator): on iPhone the shell drew under the
  status bar / notch, tucking the TopBar hamburger up where it was hard to tap (and content ran under the
  home indicator). Applied **`env(safe-area-inset-*)`** (enabled by the `viewport-fit=cover` from iii-a):
  TopBar `padding-top`/`-right`, the off-canvas sidebar drawer `padding-top`/`-bottom`, and `contentInner`
  `padding-bottom` — all `calc(base + env(..., 0px))`, so **0 on desktop/Electron** (no notch → unchanged;
  23 E2E + the 390px responsive guard green) and correct on iOS. Implements 07-mobile-platform §5.4
  (safe-area insets). **Lesson: the desktop browser can't show this (env insets are 0 without a real
  notch) — iOS chrome issues like this surface only on the device/simulator.**
- 2026-06-10 — Build (Capacitor track **slice (iii-a): iOS scaffold + web build** —
  [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.3/§5.4): first iOS step — the React renderer
  now has a **standalone web build** (`vite.web.config.ts` → `dist-web/`, `pnpm build:web`) separate from
  the electron-vite build, entered via `index.html`→`main.web.tsx`. Added **Capacitor** (`@capacitor/
core`+`ios`+`cli`) + `capacitor.config.ts` (`com.highfivery.selfos`, webDir `dist-web`). A **temporary
  stub `window.selfos`** (`host/stubBridge.ts`, full `SelfosBridge`, no-op/empty data) lets the UI render
  in the iOS WKWebView so we can validate the Capacitor→Xcode→device toolchain BEFORE the real native
  hosts (iCloud FS / Keychain / Claude) land in iii-b/c/d — it's clearly throwaway and gets deleted then.
  Verified here: `build:web` produces a valid SPA, the full shell renders at 375px (served + screenshotted),
  Electron is untouched (23 E2E green), 193 unit green, typecheck/lint/format clean. **Decisions (asked):**
  Mac yes; **free personal signing first → Developer Program + TestFlight later** (a trivial Xcode signing-
  team switch, no code changes); bundle id `com.highfivery.selfos`; **min iOS 18**. **NOTE: `pnpm build:web`
  must run before `cap add ios` / `cap sync`.** Next: **iii-b** the Swift VaultFs plugin (iCloud-Drive
  picker + bookmarks + coordinated FS) + the real in-webview host wiring `@selfos/core`.
- 2026-06-10 — Build (cleanup: **`masterKey` → `@selfos/core/crypto`**, closing the last `Buffer` bridge):
  moved `masterKey.ts` (master-key generate/store/recover flow) out of `apps/desktop/src/main/crypto/`
  into core so the future iOS host gets the flow too. It was already node/electron-free; the only thing
  pinning it to the app was its `Buffer` return. Now it returns/uses **`Uint8Array`** (via the core
  `toBase64`/`fromBase64` helpers), so the app threads `Uint8Array` for the master key **end-to-end** —
  no Buffer bridge left. `ipc.vaultAndKey()`/`activePersonCan` key types → `Uint8Array`; household + e2e
  import masterKey from `@selfos/core/crypto`. **recovery.enc + the stored master key are byte-identical**
  (the reviewer fuzz-verified `toBase64`/`fromBase64` == `Buffer` base64 across all 0–255 bytes), so
  existing vaults still restore. The app's `main/crypto/` dir is gone. Gates green: typecheck/lint/format,
  **193 unit** (61 core + 132 desktop), 23 E2E (one clean run; a transient people-CRUD e2e timeout under a
  loaded run passed on isolation + re-run — pre-existing Playwright/Electron timing flakiness, not a
  regression, per reviewer). **The `@selfos/core` extraction is now fully complete incl. masterKey.**
- 2026-06-10 — Fix (red CI build — user flagged): `apps/desktop/src/main/host/nodeSecretStore.test.ts`
  value-imported `passthroughEncryptor` from `secrets/encryptor.ts`, which **top-level-imports
  `electron`** (`safeStorage`). CI runs the Vitest unit tests **without the Electron binary**, so loading
  `electron` threw `Electron failed to install correctly`. Fixed by injecting an **inline fake `Encryptor`**
  in the test (the established pattern — the old secret-store test + the e2e both do this) and importing
  `Encryptor` as a **type-only** import (erased at build → no `electron` load). **Lesson: unit tests must
  not transitively import `electron`; my local `pnpm test` masked it because electron IS installed locally
  but CI's isn't. When a unit test needs a host dependency that pulls electron (`encryptor`, ipc, window,
  menu, …), inject a fake and `import type` only — never value-import the electron-pulling module.** (This
  test was introduced in ii-c; it had been failing CI since then.)
- 2026-06-10 — Build (Capacitor track **relocation slice 3 (final): move usage/budgets/chat into core**
  — [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.2): relocated `pricing`/`usageStore`/
  `budgetService` → **`@selfos/core/usage`** and `promptBuilder`/`chatService` → **`@selfos/core/conversations`**
  (+ tests) — verbatim, **no behavior change**. Moved files take `key: Uint8Array`; chatService's
  `node:crypto randomUUID` → core `uuid()`. The 4 IPC view types (`UsageSummary`/`BudgetState`/
  `BudgetStateKind`/`ChatTurnResult`) moved into core **`schemas.ts`** (same crypto-free rule as
  `AccessView`) so `channels.ts` imports them from the schemas shim and the renderer/web tsconfig never
  pulls `core/crypto`. New export `./usage`. Moved tests use the `memFileSystem` fake. **This completes
  the `@selfos/core` extraction** — ALL platform-agnostic business logic (crypto, vault I/O, people/access,
  conversations, usage/budgets, prompt builder, pricing) now lives in core behind the host interfaces; the
  app's `main/` is just host impls (`nodeFileSystem`/`nodeSecretStore`/`anthropicClient`/`encryptor`), the
  `claudeService` proxy, **`masterKey`** (the app's `Buffer` bridge), device-local state (`deviceStore`/
  `session`/`superAdmin`/`settings`), `vault` bootstrap/watcher/conflicts, `ipc`, and the renderer. Fixed a
  latent Playwright strict-mode flake in the chat e2e (`.first()` — the streaming bubble + persisted message
  both match during the stream→save handoff). Gates green: typecheck/lint/format, **193 unit** (58 core +
  135 desktop), 23 E2E. **NEXT: the iOS-only work — (iii) Capacitor shell + iOS plugins + binding, (iv)
  build/signing — needs a Mac/Xcode + the user's Apple Developer team + bundle id (ASK).**
- 2026-06-10 — Build (Capacitor track **relocation slice 2: move the people/access domain into
  `@selfos/core/people`** — [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.2): relocated
  `peopleService`/`relationshipService`/`accessService`/`buildContext` (+ tests) into core — verbatim,
  **no behavior change**. Moved files take `key: Uint8Array` (app passes `Buffer`, assignable) and use a
  new portable **`uuid()`** (`globalThis.crypto.randomUUID`, core `id.ts`) instead of `node:crypto`. The
  **`AccessView`** view type moved into core **`schemas.ts`** (not accessService) on purpose: `channels.ts`
  keeps importing it from the crypto-free schemas shim, so the renderer/web tsconfig never pulls
  `core/crypto` (importing it via `@selfos/core/people` would drag crypto under the DOM lib and trip a
  TS5.7 `BufferSource` error). The IPC `SelfosBridge` contract is unchanged. Moved tests use the core
  **`memFileSystem`** fake (the host-level `ENOTDIR` case stays covered by `nodeFileSystem.test`). New
  export `./people`. The app's `people/` is now just `household`/`session`/`superAdmin` (device-local
  orchestration; household keeps `randomUUID` as an app-host detail). Gates green: typecheck/lint/format,
  **193 unit** (41 core + 152 desktop), 23 E2E. Next relocation: **usage/budgets/chat** (usageStore/
  budgetService/pricing/promptBuilder/chatService + the UsageSummary/BudgetState/ChatTurnResult view
  types), then decide whether masterKey moves (full `Uint8Array`) or stays the app Buffer bridge.
- 2026-06-10 — Build (Capacitor track **relocation slice 1: move the vault-data I/O into `@selfos/core`**
  — [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.2): began physically moving the
  now-platform-agnostic service files (abstracted behind host interfaces in ii-b/ii-c) into core. This
  slice relocates **`encryptedStore` → `@selfos/core/vault`** and **`conversationService` →
  `@selfos/core/conversations`** (verbatim moves; **no behavior change**). Core can't use `Buffer`, so the
  moved files type keys as **`Uint8Array`**; the app still threads `Buffer` (a `Uint8Array` subclass —
  assignable), so `masterKey` stays the app's `Buffer` bridge and the 5 staying app services
  (people/relationship/access/usage/budget) pass `Buffer` into core's `Uint8Array` params unchanged. Added
  a core **`memFileSystem`** in-memory test fake (the moved conversation test + a new `encryptedStore`
  round-trip test run with no node/disk) and new package exports `./vault` + `./conversations`. On-disk
  format/paths byte-identical (23 E2E seed+read through the relocated core). Gates green: typecheck/lint/
  format, **193 unit** (28 core + 165 desktop), 23 E2E. Next relocation slices: the **people/access**
  domain (peopleService/relationshipService/accessService/buildContext + the `AccessView` view type), then
  **usage/budgets/chat** (usageStore/budgetService/chatService/pricing/promptBuilder + UsageSummary/
  BudgetState/ChatTurnResult); each moved service switches `Buffer`→`Uint8Array` + portable `uuid()`.
- 2026-06-10 — Build (Capacitor track **slice (ii-c): SecretStore + ClaudeClient host interfaces** —
  [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.1/§5.3): added the last two platform host
  interfaces to **`@selfos/core/host`** — **`SecretStore`** (`get`/`set`/`has`/`clear`) and
  **`ClaudeClient`** (moved verbatim out of the app's `claudeService`) — and rewired the remaining
  node/electron-coupled business logic onto them (structural DI, **no behavior change**). The Electron
  **`createNodeSecretStore(userDataDir, encryptor)`** (app `main/host/`) is the old `secrets/secretStore`
  logic (secrets.json + `safeStorage` encryptor) moved verbatim; the `Encryptor` interface now lives in
  `secrets/encryptor.ts`. **`masterKey`** now takes `(secrets: SecretStore[, fs: FileSystem])` and reads/
  writes `config/recovery.enc` via `fs` → it is **fully node/electron-free** (only `@selfos/core` + zod).
  `ipc.ts` got a `secretStore()` helper; household builds `secrets`+`fs` internally. **recovery.enc and
  secrets.json on-disk formats are byte-identical** (existing vaults still restore + decrypt — verified
  by the reviewer + 23 E2E that seed/read through the new path). masterKey.test now uses an in-memory
  `SecretStore` fake. Gates green: typecheck/lint/format, **189 unit** (22 core + 167 desktop), 23 E2E.
  Next: a **relocation slice** — physically move the now-platform-agnostic service files (people / usage /
  conversation / buildContext / encryptedStore / masterKey) into `@selfos/core` (+ `Buffer`→`Uint8Array`,
  portable uuid, mem-fake tests). That completes the desktop-verifiable extraction; then (iii) the
  Capacitor iOS shell + (iv) build/signing need a Mac/Xcode.
- 2026-06-10 — Build (Capacitor track **slice (ii-b): FileSystem host + the encrypted vault-data layer**
  — [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.1/§5.3): introduced the **`FileSystem`
  host interface** (`@selfos/core/host`: `read`/`writeAtomic`/`list`/`remove`, **vault-relative** POSIX
  paths) and refactored the encrypted data layer to depend on it instead of `node:fs`/`node:path` — a
  **pure I/O abstraction, no behavior change**. `encryptedStore` + the 6 data services (people /
  relationship / access / usage / budget / conversation) + buildContext/promptBuilder/chatService now
  thread `fs: FileSystem`; the Electron impl **`createNodeFileSystem(vaultDir)`** (app
  `main/host/`) is node `fs` rooted at the vault + atomic temp-file→rename + `notifyWrite` echo-
  suppression. `ipc.ts` `vaultAndKey()` → `{ fs, key }`. Services **stay in the app** for now (still use
  `key: Buffer` + `randomUUID`); they **relocate into core** in a later slice. On-disk format/paths are
  byte-identical (proven: 23 E2E seed+read real encrypted vaults; encrypted-at-rest unit assertions read
  the real `.enc`). Gates green: typecheck/lint/format, **189 unit** (22 core + 167 desktop), 23 E2E.
  **Lesson (code-reviewer caught a real regression): the old `listPeople` filtered `isDirectory()`; the
  fs version `getPerson`s every entry, so a stray `people/.DS_Store` (common in iCloud/Dropbox-synced
  vaults) made `read('people/.DS_Store/profile.enc')` throw `ENOTDIR` and cascade into Usage + chat
  context. Fixed in the host — `read`/`list` treat `ENOTDIR` like `ENOENT` (absent → null/[]) — + a
  `nodeFileSystem` contract test and a stray-file `listPeople` regression test.**
- 2026-06-10 — Build (Capacitor track **slice (ii-a): scaffold `@selfos/core` + extract crypto + shared
  schemas** — [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.2): created the platform-agnostic
  **`@selfos/core`** workspace package (source-only; `exports` map → `.ts`; bundled into Electron `main`
  by excluding it from electron-vite's `externalizeDepsPlugin`). Moved the shared Zod schemas/types
  (`schemas`, `capabilities`, `usageTypes`, `appearance`) and the at-rest crypto (`cryptoService`, `pin`)
  into core; `apps/desktop/src/shared/*` are now **thin re-export shims** so the renderer + IPC
  `channels.ts` are **untouched**. Completed the deferred **`Buffer`→`Uint8Array` + portable-base64**
  (`btoa`/`atob` in `encoding.ts`) migration so core is `node:*`/`Buffer`-free; the app keeps threading
  `Buffer` and **bridges at `masterKey.ts`**. Portability is enforced by an **ESLint override** on
  `packages/core` (no `Buffer`, no `node:*`/`electron`). Byte-compat fixtures moved into core and still
  pass (vaults stay readable). Decisions (asked): **incremental sub-slices**, **thread the host objects**
  (next slices), **schemas into core + shim**. Gates green: typecheck/lint/format, **183 unit** (22 core
  - 161 desktop), **23 E2E** (the built app bundles core + seeds/reads encrypted vaults). Next: **(ii-b)**
    FileSystem host + the file-using services.
- 2026-06-10 — Build (Capacitor track **slice (i): crypto unification** —
  [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.1): the at-rest crypto is rewritten **off
  `node:crypto` onto WebCrypto (`globalThis.crypto.subtle`, AES-256-GCM) + `scrypt-js`** so one
  implementation runs on both Electron (Node ≥20) and the future iOS WKWebView. `cryptoService`,
  `masterKey`, and `pin` no longer touch `node:crypto`; the scrypt KDF is one shared `deriveScrypt`
  (params `N=16384,r=8,p=1`), PIN compare is a hand-rolled constant-time check. **The on-disk envelope
  `{v:1,alg,iv,tag,data}` and all params are unchanged** — WebCrypto's appended 16-byte GCM tag is split
  back out — so **existing vaults stay byte-for-byte readable**. WebCrypto/scrypt are async, so `await`
  rippled through `encryptedStore`/`accessService`/`superAdmin`/`masterKey` + tests + the e2e seeds.
  Proof: a new **`cryptoCompat.test`** asserts the new code decrypts/derives/verifies **real fixtures
  captured from the old `node:crypto` code** (not a self round-trip); 183 unit + 23 E2E green (the e2e
  seeds _and_ boots an encrypted vault). Decision: **`Buffer` stays** this slice; the `Buffer→Uint8Array`
  - portable-base64 + `randomUUID` migration is slice (ii) ("extract `@selfos/core`, no `node:*`").
- 2026-06-10 — Spec approved: **[07-mobile-platform](docs/specs/07-mobile-platform.md)** (Capacitor +
  iCloud-Drive vault). SelfOS comes to iPhone as one codebase: the same responsive renderer in a
  WKWebView, sharing the same iCloud-Drive vault as desktop, via a **platform-adapter** (FileSystem /
  SecretStore / ClaudeClient host interfaces) so the Electron-main business logic runs on both hosts.
  Resolved: sequencing = **(i) crypto unification → (ii) extract `@selfos/core` + re-wire Electron →
  (iii) Capacitor shell + iOS plugins → (iv) user builds/signs**; crypto **unified on WebCrypto +
  scrypt-js** (one impl, existing vaults stay readable); iOS Claude = **browser-mode SDK with a
  native-HTTP fallback**; **iOS-only**, **code-ready** build. Slices (i)+(ii) are desktop-verifiable
  here; (iii)+(iv) need a Mac/Xcode. GitHub: repo live at `Highfivery/SelfOS`, CI (lint/typecheck/unit)
  green; E2E stays local (needs a display).
- 2026-06-10 — Fix (TopBar alignment + usage-ring visibility — user flagged): the appearance toggle,
  usage ring, and account control now share a fixed **32px height** and align to the same top edge
  (the ring's wrapper was `display:block`, a line-box gap that floated it ~2px high; now `inline-flex`
  like its siblings). The usage ring's track moved from the near-invisible `--color-surface-alt` to
  `--color-border-strong` so the ring actually reads. Added an **E2E geometry guard** asserting the
  three TopBar controls share a top edge + height (≤1px). **Lesson (again): measure geometry in
  testing — I missed a 2px vertical misalignment + an invisible ring by not screenshotting/measuring
  the TopBar.**
- 2026-06-10 — UI polish + feedback (user flagged three shipped-but-unpolished things): (1) **buttons
  in rows of labelled fields now bottom-align** with the inputs (`Inline align="end"` in the budget
  editors) instead of floating mid-height; (2) the **appearance toggle was redesigned** for the
  TopBar — a compact single theme-icon button opening a System/Light/Dark popover (matching the
  usage-ring/account menus, conserving horizontal space), replacing the relocated 3-segment control;
  (3) the **sidebar brand was redesigned** — the sprout sits in a soft accent app-icon tile + a tighter
  wordmark, so it reads as intentional, not an afterthought. New standing rules: **visual QA is part of
  testing** (DoD §7 + §12) and **"improve" means redesign, not relocate** (§12). **Lesson: my earlier
  "move the toggle" / "add an icon" did the minimum; screenshot-and-scrutinize alignment + polish every
  time, and treat "improve X" as a redesign brief.**

- 2026-06-10 — Build (Slice D — responsive pass): SelfOS is now **one responsive codebase**
  (~360px→desktop). Breakpoint tokens (480/768/1024/1280) in `tokens.css`; below 768px the sidebar
  becomes an **off-canvas drawer** (overlay + scrim) from a TopBar hamburger (closes on nav-select /
  Esc / scrim / resize); two-pane screens (**Sessions**, **People**) collapse to a **master–detail**
  with a back affordance; the Sessions **crisis footer** was pulled out of the thread pane so it stays
  present in both list and detail views; `SegmentedControl` scrolls-x when it can't fit (the 5 person
  tabs on a phone); content padding tightens; tap targets ≥44px; the account name hides <480px. A
  **390px mobile-width E2E guard** walks every screen + opens the People editor, asserting no
  horizontal overflow on the content scroll container (not just `main` — caught a clipped People pane
  a `main`-only check missed). **Lesson: an E2E overflow guard that only checks `main` misses inner
  scroll containers; verify with a real screenshot at mobile width.**
- 2026-06-10 — Build (admin-only marker): a reusable **`AdminOnlyBadge`** design-system primitive (a
  "🔒 Admin only" pill, icon + text, never colour-alone) now marks every admin-gated surface so admins
  know normal users don't see it (§12) — applied to the Usage cost figure, the person picker, the
  by-person card, and the overall-cap editor; the person **Budget** tab; and the **Roles** screen.
  Added to `/gallery`. Tests: a component test + Usage/Roles unit assertions (present for admins,
  absent for users) + E2E (Budget-tab badge, none on a member's Usage, markers appear on super-admin
  unlock). This is the standing convention for all current and future admin-gated UI.
- 2026-06-10 — Build (app-shell chrome): sprout brand lockup; appearance toggle + usage ring + a new
  account menu (Switch person / Lock / super-admin Lock-inspect) in the slot-based **TopBar**; sidebar
  footer reduced to Settings + a **collapse toggle** (desktop icon rail, persisted device-local);
  **logout = lock to a full-screen person picker** (a UI reveal-gate). Added Textarea to `/gallery`.
  Updated [02-app-shell](docs/specs/02-app-shell.md) §3.4–3.6, §4, §6, §11.
- 2026-06-10 — Correction landed: **removed the `questionnaires.answer` / `questionnaires.assign`
  capabilities** (unbuilt-feature scaffolding flagged in the prior entry). Stripped from
  `shared/capabilities.ts` (CAPABILITIES, labels, default Member/Guest roles) and synced
  [04-people-roles](docs/specs/04-people-roles.md). **Member** now defaults to own relationships + own
  sessions; **Guest** now has **no capabilities** (a login slot until a Guest purpose is specced).
  Questionnaires stays on the roadmap; its capabilities return when specced.
- 2026-06-10 — **Session decisions confirmed (ask-first) for the app-shell modernization + responsive
  pass:** brand mark = a **Sprout** (dusty-blue, with a "SelfOS" wordmark → sidebar lockup + app icon);
  **Logout = lock to a full-screen person picker** (PIN-less people resume immediately; a UI
  reveal-gate like the super-admin lock); **desktop sidebar collapse = icon rail** (drawer below
  768px); **admin-only marker = a "lock + 'Admin only'" pill** primitive (section-level by default);
  **breakpoint tokens = 480 / 768 / 1024 / 1280** (mobile-width E2E guard at 390px). TopBar gains the
  appearance toggle + logout (out of the sidebar footer) and the mobile hamburger.
- 2026-06-10 — Captured UI/UX conventions (new §12) + DoD items from user feedback: the app must be
  **fully responsive** (one codebase, ~360px→desktop); **admin-only UI must be visibly marked**;
  **global controls (usage ring, appearance toggle, logout) live in the TopBar**; **`/gallery` must
  stay current** with every primitive; and **no scaffolding for unbuilt features**. Also flagged: the
  `questionnaires.*` capabilities were an unspecced assumption and must be **removed** until the
  feature is specced. These feed the next session (Slice D + app-shell modernization + Capacitor track).
- 2026-06-09 — Initial CLAUDE.md established. Stack, architecture principles, Definition of Done,
  living-docs loops, and git standards set per the approved foundation plan.
- 2026-06-09 — Build slice 1 landed: electron-vite app scaffold (secure window, design tokens, themed
  shell, typed IPC). Tests are now per-package (jsdom for the renderer); lint-staged runs lint+format
  only (tests run on pre-push/CI); Playwright-Electron E2E harness added.
- 2026-06-09 — Build slice 2: design-system primitives (Stack, Inline, Heading, Text, Button,
  IconButton, Card, Field, TextInput, Select, Switch, Slider, SegmentedControl) on tokens + CSS
  Modules, plus a dev-only `/gallery` route. AppearanceToggle refactored onto SegmentedControl.
- 2026-06-09 — Build slice 3: vault service (initialize/status + atomic JSON writes), device-local
  state store, real boot-state computation + IPC, and the boot gate (Splash / Onboarding /
  VaultError / Ready). Deferred to a follow-up: file-watching, sync-conflict detection, migrations,
  window-state persistence, native menu.
- 2026-06-09 — Build slice 3b (vault hardening): schema-migration runner + registries (wired into
  reads), window-state persistence (clamp to a visible display), sync-conflict detection (detector +
  IPC + warning Banner), and file-watching (chokidar v3, echo-suppression, `vault:changed`). Note:
  the watcher currently starts only when the app boots already-ready; starting it after onboarding
  and the native menu remain follow-ups.
- 2026-06-09 — Polish: centralized the vault-watcher lifecycle so it (re)starts right after
  onboarding (not only on a ready boot), and added a native application menu (standard roles + Open
  Vault Folder). Resolves the slice-3b follow-ups.
- 2026-06-09 — Dev ergonomics: added root `dev`/`build` scripts (so `pnpm dev` runs the desktop app)
  and set an explicit Electron app name (`app.setName('SelfOS')`) so dev `userData` is `SelfOS`,
  avoiding a single-instance-lock collision with other scaffolded `@selfos/desktop` apps.
- 2026-06-09 — Build slice 4 (v1 centerpiece): the schema-driven settings system. Registry +
  control registry + typed `useSetting` (declaration-merged `SettingsTypeMap`), vault-scoped
  persistence + IPC, and an auto-generated Settings UI (sections, search, per-setting reset). Working
  Appearance settings (theme/density/text-size/reduce-motion) applied via tokens; Vault + About
  sections. `ThemeProvider` now reads from settings. Added a shared mock-bridge test helper. Deferred:
  accent options, high-contrast, the AI/secret settings + keychain (slice 5), and the broader
  feature-module registry abstraction.
- 2026-06-09 — Build People-2c (switcher + access + capability gating): grant/update/revoke a
  person's login (role + optional PIN) in the person editor; a "Who's here?" switcher (from the shell
  footer) changes the active person with PIN verification; `sessionStore` gains `capabilities` +
  `can()`, and the People nav is gated by `people.manage`. IPC: `access:get` (redacted — no PIN
  hashes), `access:setAccount`, `access:removeAccount`, `session:setActive`. Tests + an E2E (grant,
  switch, nav gated). Known v1 limits: only the nav (not the route) is gated, and a PIN-less owner is
  switchable by anyone on the device — the super-admin passphrase is the real gate. The roles×capability
  matrix editor, the concealed super-admin unlock, and shareable context are People-3.
- 2026-06-10 — Build Metering-2 (usage dashboard + budgets UI for
  [06-ai-usage-and-budgets](docs/specs/06-ai-usage-and-budgets.md)): a **Usage** screen (nav gated by
  `sessions.own`) with scope (Mine / Everyone — app gated by `settings.manage`) + period (week/month)
  toggles, totals (estimated cost, sessions, avg per session/type, input/output/cache tokens, cache
  savings), by-type + by-model breakdowns, and per-person + app budget editors with accessible
  `<progress>` bars. IPC: `usage:summary`, `budget:get`/`setApp`/`setPerson`/`status` (computed in
  main; `UsageSummary`/`BudgetState` moved to shared). Tests + an E2E (seeded usage → dashboard +
  budget save + no-overflow guard). v1 limit: app-scope is UI-gated, not IPC-enforced.
- 2026-06-10 — Fix (Roles matrix display): the role × capability matrix now renders each toggle via
  `roleAllows` instead of the raw stored map, so the **Owner column shows all-on** — including
  capabilities added after the vault was created (e.g. `budgets.manage`). Pairs with the owner
  full-access fix below; a test covers a stale stored owner map rendering all-on.
- 2026-06-10 — Fix (Owner full access — the real bug): `roleAllows` now grants the **Owner every
  capability**, not just those in its stored map. Setup persists the owner role's capability map frozen
  at that moment, so a vault created before a capability existed (e.g. `budgets.manage`, added in
  Metering-3) left the Owner without it — denying budget/usage/cost/config. Now the Owner has full
  access regardless of when the vault was made or what capabilities are added later. Unit tests for the
  stale-map case + an E2E that boots a pre-`budgets.manage` vault and confirms the Owner sees cost + the
  person picker + by-person and can set a budget. **Lesson: my earlier "fix" + E2E only seeded FRESH
  vaults (which pick up current capabilities), so they never exercised a real persisted vault and the
  bug survived three reports — verify against the actual persisted state, not an idealized seed.**
- 2026-06-10 — Fix (super-admin parity): the concealed super-admin's inspect mode now bypasses
  capability gating in the **main** process, not just the renderer. Main tracks super-admin active
  state (set on `superadmin:unlock`, cleared by a new `superadmin:lock`), so `activePersonCan` returns
  true while it's active — a super-admin signed in as a non-admin gets full budget/usage/cost access
  (writes, the Everyone scope, by-person), matching the Owner. Before, main still checked the active
  person's role, so the admin UI showed but the data was silently redacted/blocked. The Usage view
  reloads when admin status flips. Tests + an E2E (a Member unlocks → cost + Everyone + by-person).
- 2026-06-10 — Build Slice C (admin usage by person): `usage:summary` now accepts an arbitrary
  `personId` (admin-only, enforced in main) and the summary gained a **`byPerson`** breakdown. The
  Usage dashboard replaces the Mine/Everyone toggle with a **person picker** (Everyone + each person)
  and adds a **"By person"** card in the Everyone view (names resolved via `peopleList`). Tests + E2E
  (pick a person; by-person card).
- 2026-06-10 — Build Slice B (compact top-bar usage ring): replaced the full-width usage header with a
  small circular **usage ring** (SVG donut that recolors at warn/over) inside a new **slot-based
  `TopBar`** (ready for more items as the app grows). Clicking opens a popover with quick stats —
  period, % of allowance, sessions; **$ for admins only** — and a "View usage details" link to
  `/usage`. Added a `--shadow-overlay` token (first elevation in the otherwise-flat design). Tests +
  E2E (ring → popover → link).
- 2026-06-10 — Build Slice A (per-person budgets on a tabbed, scalable person page): `PersonEditor`
  rebuilt into **tabs** (Profile / Notes / Relationships / Access / Budget) so person-scoped settings
  grow without one long page; shared + private notes are now **textareas** (new `Textarea` primitive);
  **per-person budgets** move to a `budgets.manage`-gated **Budget tab** via `budget:getPerson` +
  `budget:setPerson({personId,budget})` (admin-enforced in main, $10/week default); the Usage view now
  keeps only the **optional overall app cap**. Tests + E2E (budget-tab round-trip).
- 2026-06-10 — Build Metering-3 (admin-only budgets + a usage header + cost hidden from users — user
  correction to [06](docs/specs/06-ai-usage-and-budgets.md)): a `budgets.manage` capability (Owner by
  default) gates budget editing, cost ($) display, and the "Everyone" scope; budget _writes_ and the
  Everyone scope are enforced in main. A **$10/week default budget** applies to anyone unset. **Cost is
  removed from Sessions**; a **global header bar** shows the active person's usage as a percentage of
  their budget (no $). The Usage view is role-aware — users see only their own usage with no dollar
  amounts; admins keep cost, the Everyone scope, and the budget editors. **Lesson: ask, don't assume** —
  these visibility rules were originally guessed.
- 2026-06-10 — Rename the chat surface to **"Sessions"** across the UI (user request): nav, the
  `/sessions` route, the `Sessions` component + `routes/sessions/` folder, and visible copy ("This
  session", "New session", "Session title", "begin a session"). Internal names (the `conversation*`
  services/store, `chat:*` IPC channels, `chatService.runChatTurn`) are unchanged — a "session" is one
  conversation, matching the metering's avg-per-session.
- 2026-06-10 — Build Chat-6c (chat polish): conversation **rename** (inline edit; `conversations:rename`
  IPC), a "Coach is thinking…" indicator while awaiting the first chunk, an **Open Settings** shortcut
  in the not-configured state, and an accessibility pass (`aria-busy` on the thread, composer
  autofocus). Tests + an E2E that renames a conversation. Completes the chat surface.
- 2026-06-10 — Build Chat-6b (the chat UI for [05-conversations](docs/specs/05-conversations.md)):
  a **Chat** screen (nav gated by `sessions.own`) with a conversation list (new/open/delete), a
  streaming message thread, a composer (Enter sends / Shift+Enter newline), a running **cost-in-chat**
  - budget warn/over chip, an always-present crisis **"Get help now"** footer, and a not-configured
    state pointing to Settings → AI. Streaming IPC: `chat:stream` invoke + `chat:chunk` events +
    `onChatChunk` subscribe; `conversations:list/get/delete` (scoped to the active person); the key
    stays in main. Tests + an E2E (send → streamed reply → cost + crisis, no overflow). **SelfOS can
    now hold a conversation.**
- 2026-06-10 — Build Chat-6a (streaming chat backend for
  [05-conversations](docs/specs/05-conversations.md)): `conversationService` (encrypted per-person
  transcript CRUD); `promptBuilder` (PERSONA + SAFETY + `buildContext` → system prompt); a streaming
  `ClaudeClient` (real SDK impl with **adaptive thinking** + `cache_control` on the system prefix for
  prompt caching, plus an offline fake); and `chatService.runChatTurn` — the orchestrator: budget
  check (person + app, owner override) → stream deltas → persist the transcript → record a usage event
  (Metering-1). Upgraded `@anthropic-ai/sdk` 0.68→0.104 for adaptive thinking. Backend only — the IPC
  - chat UI are Chat-6b. Tests cover transcripts, the system prompt, and the full turn (stream/persist/
    usage/budget-block/override/continuity).
- 2026-06-10 — Build Metering-1 (usage/pricing/budget core for
  [06-ai-usage-and-budgets](docs/specs/06-ai-usage-and-budgets.md)): a maintained per-model pricing
  table + `costOf`/`cacheSavingsOf`; an encrypted per-person `usageStore` (record → monthly `.enc`
  shards; query by range/person/type; pure `summarize` → totals, by-type, by-model, avg-per-session,
  cache savings); a `budgetService` (per-person + app budgets, `checkBudget` warn→over with an owner
  override, calendar week/month windows); `UsageEvent`/`Budget` schemas + usage-type labels. Backend
  only — the dashboard + budget UI (Metering-2) and the chat consumer come next. Cost is always an
  estimate; events carry token counts only (no message content).
- 2026-06-09 — Build People-3c (shareable-vs-private context) — **completes the People feature
  ([04-people-roles](docs/specs/04-people-roles.md))**: the person editor splits notes into **Shared**
  (`publicNotes`, may feed others' AI) and **Private** (`privateNotes`, never shared); a main-process
  `buildContext(personId)` assembles a session context block — the person's own full profile + the
  shareable facts about the people they relate to (others' `publicNotes` + relationship `publicNotes`),
  **excluding other people's private notes**. Tests prove the exclusion + that both notes persist
  encrypted. `buildContext` is consumed by the AI chat slice (next).
- 2026-06-09 — Build People-3b (concealed super-admin unlock): a hidden long-press on the version in
  About opens a deliberately generic passphrase prompt; the super-admin passphrase (set at setup) is
  verified in main (scrypt, `superadmin:unlock`) and, on success, enters an in-memory inspect-all mode
  where `sessionStore.can()` bypasses all gating (all nav/screens) with a subtle "Super-admin · Lock"
  badge that only shows when active. Tests + an E2E. Note: this is a UI-reveal gate (the app already
  holds the master key); surfacing private _data_ comes with shareable context (People-3c).
- 2026-06-09 — Build People-3a (roles × capability matrix): a **Roles** screen (nav gated by
  `roles.manage`) where the owner toggles each non-owner role's capabilities; the owner column is
  locked all-on. New `access:saveRole` IPC + bridge + `CAPABILITY_LABELS`. Tests + an E2E (owner
  toggles a member capability). People-3b (concealed super-admin unlock) and 3c (shareable context)
  are next.
- 2026-06-09 — Fix: the `Switch` thumb was pushed flush against the right edge when on, because the
  fixed-size control had no `flex-shrink: 0` and got compressed inside content-tight flex rows (e.g.
  the Subject toggle in the person editor). Added `flex: none` to `.switch`; added an E2E geometry
  guard (computed `flex-shrink === '0'` + thumb gaps ≥ 2px) verified to fail without the fix; added a
  DoD rule for control-geometry guards.
- 2026-06-09 — Build People-2b (people + relationship management UI): a **People** screen (list of
  subjects/contacts) with add/edit/delete and a relationship editor (typed links between people),
  backed by people/relationship CRUD IPC (`upsert` owns id + timestamps in main) + a `peopleStore`,
  plus a nav "People" entry. Tests + an E2E that adds a person and links a relationship. The
  "Who's here?" switcher, granting others access (roles/PINs), and capability-gating the nav are
  People-2c.
- 2026-06-09 — Build People-2a (onboarding setup + active person): first run now creates the owner
  (Person #1), sets the super-admin passphrase (device-local scrypt hash), and shows the recovery
  phrase once via `household:setup`; a `HouseholdGate` between boot-ready and the app routes to a
  `Setup` wizard until a master key + owner exist; session/household IPC + bridge
  (`householdStatus`/`householdSetup`/`getActivePerson`) + a "Signed in as …" indicator in the shell.
  E2E seeds an encrypted household so existing tests still boot, plus a new setup-flow E2E. UI to
  add/manage people + the "Who's here?" switcher is People-2b.
- 2026-06-09 — Build People-1 (crypto + data foundation for
  [04-people-roles](docs/specs/04-people-roles.md)): AES-256-GCM at-rest encryption (`cryptoService`)
  with a device-keychain **master key** (`masterKey`) + recovery-phrase wrap/unwrap; encrypted vault
  I/O; Person/Relationship/Role/Account/AccessConfig schemas + a capability registry + default roles
  (Owner/Member/Guest); people/relationship/access services (encrypted, Zod-validated) + scrypt PIN
  hashing. Backend only — IPC/bridge + UI land in People-2. New tests cover crypto round-trip/tamper,
  recovery restore, encrypted-at-rest, and pins.
- 2026-06-09 — Build slice 5 (AI plumbing): encrypted API-key storage via Electron `safeStorage`
  (device-local `secrets.json`, injectable encryptor + test passthrough; the key is write-only to the
  renderer — no `getSecret`), a Claude proxy with an injectable client (`@anthropic-ai/sdk` + an
  offline fake) and a "Test connection", and the AI settings section (enable + model select [default
  `claude-sonnet-4-6`, `claude-opus-4-8` option] + secret key control), gated by `visibleWhen`. The
  chat surface is a later slice. E2E uses `SELFOS_FAKE_SECRETS`/`SELFOS_FAKE_CLAUDE` for determinism.
- 2026-06-09 — Fix + test hardening: the Vault/About settings sections overflowed and overlapped
  because long custom content (the vault path, the disclaimer) sat in the fixed control column —
  custom rows now render full-width and wrap. Version showed Electron's version; now injected at build
  time via electron-vite `define` (`__APP_VERSION__`). E2E now walks **every** settings section with a
  no-horizontal-overflow visual guard, and `SettingField` has component tests. (Lesson: E2E must cover
  every surface, not just the happy-path one.)
