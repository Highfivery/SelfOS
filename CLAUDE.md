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

When in doubt, **ask** — never assume or guess. (The user has asked for this explicitly.)

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

## Changelog

A running log of durable decisions and feedback captured into the project config. Newest first.

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
