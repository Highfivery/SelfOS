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

- 2026-06-11 — Build (Questionnaires **slice 2 — question images** [§13.2 last leaf; **§13.2 now
  complete**], [08-questionnaires](docs/specs/08-questionnaires.md) §4.1/§4.2/§5.1/§6/§8.6/§13.2). Asked
  first (3 Qs): storage = **shared media dir** `questionnaires/media/<id>.enc`; picker = **in-renderer
  `<input type=file>`** (base64 over IPC — portable to web/iOS, no native dialog); limits = **~5 MB,
  PNG/JPEG/WebP/GIF**. Decided (not asked): **alt text required** (a11y), one image/question, image renders
  under prompt/help in builder + form, `media` gains **`mime`** (additive, no migration), relay ZK
  re-encryption deferred to §13.6. Built: core **`imageService`** (encrypted CRUD in the shared dir) over
  **new byte-level `encryptBytes`/`decryptBytes`** — the string `encrypt`/`decrypt` now **wrap** them so the
  on-disk envelope is byte-identical (vaults stay readable; `cryptoCompat` fixture green). IPC
  `questionnaires:storeImage`/`:getImage`/`:deleteImage` gated by `questionnaires.create`, **mime + ≤5 MB
  re-validated in main** (the renderer's check isn't the trust boundary), and an **`isMediaPath` guard**
  confines reads/deletes to the media dir (a malicious renderer can't `getImage('config/recovery.enc')`).
  Builder: thumbnail + required-alt field; the shared `QuestionnaireForm` takes a **`loadImage`** prop (relay
  will supply its own decrypt). Code-reviewer **fix-first** (applied both): the attach flow no longer
  **swallows errors** (surfaces a message), and **remove no longer eagerly deletes the vault file** — it only
  clears the draft, so an unsaved "remove" discards cleanly with no dangling reference, and the orphan is
  reaped by a later GC. Live web-preview QA of the full encrypt→IndexedDB→decrypt→display round-trip at
  desktop + 390px. Gate green: typecheck/lint/format, **211 desktop** + **123 core** unit, **32 E2E** (new
  attach→alt→round-trip→preview). **Lesson: a caller-supplied vault path from the renderer is untrusted —
  any read/delete-by-path IPC must confine the path (prefix + suffix + no `..`) in MAIN, never the
  renderer.** **Deferred:** orphan-image GC + purge-on-questionnaire-delete (§3.9); image-into-send-snapshot
  - relay ZK (§13.5/§13.6); `getImage` recipient/Inbox gating (`create`-only today). Synced `08`
    §4.1/§4.2/§5.1/§6/§13.2 + changelog. **§13.2 builder follow-ups are DONE; next is §13.3 (AI generate +
    context-provider registry) or §13.4/§13.5.**
- 2026-06-11 — Build (Questionnaires **slice 2 — preview / test-on-self** [§13.2], the **shared answering
  renderer**, [08-questionnaires](docs/specs/08-questionnaires.md) §3.1/§5.1/§5.3/§8.2/§13.2). Asked first
  (4 Qs): presentation = **in-pane Edit ⇄ Preview toggle** (not a modal — the app is modal-free; avoids a
  new focus-trapped primitive); **one interactive preview** (live branching + required, nothing saved);
  **all 12 answer-type controls now**; **ephemeral "nothing was saved"** confirmation on Finish. I also
  recommended (spec-backed, §8.2) that preview **shows the crisis footer + not-medical line** — reusing the
  existing `CrisisFooter`. Built: **`QuestionnaireForm`** (the renderer the Inbox + relay will reuse) — 12
  controls (radio/checkbox choice, yes-no/this-or-that pills, rating/matrix min→max scale, slider, ranking
  with ↑/↓, allocation with a live `/100` hint, date), driven by a new **pure core helper**
  `@selfos/core/questionnaires` **`answering`** (`isQuestionVisible`/`visibleQuestions`/`isAnswered`/
  `unansweredRequired`/`allocationTotal`) so the branching/required logic is DOM-free + reused; plus
  **`QuestionnairePreview`** (Finish gating → ephemeral result) and the builder toggle. **No new IPC** —
  pure renderer + a core helper; preview persists nothing + produces no Insight. Slider/ranking **seed once
  on mount** (min / authored order) so an untouched control still reads as answered; allocation clamps to
  ≥ 0. Live web-preview visual QA of all 12 controls at desktop + 390px (matrix label stacks above its
  scale on phones — clean). Reviewer verdict **ship** (no blockers/should-fixes; applied one clamp nit). Gate
  green: typecheck/lint/format, **208 desktop** + **115 core** unit (+11 `answering`, +7 form/preview RTL,
  +1 builder toggle), **31 E2E** (new preview flow; the 390px sweep now opens Preview). **Lesson: the
  renderer can import runtime helpers from `@selfos/core/questionnaires` directly (first value-import of that
  barrel into the renderer) — it bundles via the web host + crypto is already DOM-lib-safe (`bufferSource`),
  so tree-shaking keeps just the pure `answering` fns.** **Still deferred (§13.2):** question-image attach
  editor (needs encrypted media storage + IPC). Built **in-place**; physically extracted to a shared package
  when the relay (§13.6) needs it. Synced `08` §3.1/§5.1/§5.3/§13.2 + changelog.
- 2026-06-11 — Build (Questionnaires **slice 2 — builder authoring editors** [§13.2 follow-ups],
  [08-questionnaires](docs/specs/08-questionnaires.md) §3.1/§4.1/§6/§13.2). Asked first (4 Qs): scope =
  **authoring editors only** (images + preview/test-on-self deferred to their own slices); custom types =
  **persisted registry**; sensitivity = **picker + author note, gates deferred** to send/relay; branching
  triggers = **discrete answers only** (singleChoice/yesNo). Built: a **sensitivity picker** (4
  `SensitivityTier` tiers; a sensitive tier shows a calm author note — the 18+/DOB/consent gates stay
  recipient-side at send per §3.2/§8.3, **not scaffolded here**), a **matrix** rows+scale editor, **help
  text** + **scale low/high labels**, a **branching editor** ("show this question when an earlier
  single-choice/yes-no answer = value"; **staleness-pruned** in `resolveBranch` so a branch the UI has
  hidden — trigger deleted / no longer discrete / chosen option cleared or renamed — never persists), and
  **persisted custom types**: new core **`customTypeService`** (`listCustomTypes`/`addCustomType` over the
  **plain** `config/questionnaires.json` prefs file + `QuestionnairePrefsSchema`, matching the
  `config/settings.json` plain precedent), exposed via new IPC **`questionnaires:listTypes`/`:addType`**
  through the seam (channels → coreBridge → ipc → preload → store), gated by **`questionnaires.create`**.
  Code-reviewer caught two real misses (fixed): a **test-only `noUncheckedIndexedAccess` typecheck failure
  the green Vitest run masked** (esbuild doesn't enforce the flag — **re-run `pnpm typecheck` after adding
  tests, not just `pnpm test`**), and a **branch that could persist after its trigger lost the chosen
  option** (UI hid it but `resolveBranch` still emitted it). Live web-preview visual QA at desktop + 390px
  caught + fixed a **Type-select + "New type" button overflow** (`.metaRow > * { min-width: 0 }`). Gate
  green: typecheck/lint/format, **200 desktop** + **104 core** unit (+1 staleness RTL, +1 core service, +1
  coreBridge gating test), **30 E2E** (new custom-type/sensitivity/matrix/branching round-trip; the 390px
  sweep now exercises matrix + new-type + branch). Renderer + a thin core service. **Lesson: the Vitest
  run does NOT typecheck (esbuild strips types) — `noUncheckedIndexedAccess`/strict-optional errors in
  test files slip through unless you run `pnpm typecheck` after writing tests.** **Still deferred (§13.2):**
  question-image attach editor, preview/test-on-self. Synced `08` §3.1/§5.1/§6/§13.2 + changelog.
- 2026-06-11 — Build (Questionnaires **slice 2 — the builder UI**,
  [08-questionnaires](docs/specs/08-questionnaires.md) §3/§13.2): the first renderer surface — a
  **Questionnaires** master-detail screen (list + builder pane, mirroring People), gated by
  **`questionnaires.create`**, with a **`questionnaireStore`** (Zustand: load/save/remove/validate,
  re-fetching after mutations) over the `window.selfos.questionnaires*` IPC. The **builder** authors
  title + type (taxonomy Select) + a question list — each with a prompt, an answer-type Select (11
  authorable types; matrix/branching/images deferred), a Required toggle, an **options editor** for
  choice/ranking/allocation (stable `{id,text}[]` model so edits never steal focus), and a min/max
  **scale editor** (rating/slider). "Check" runs the engine's `validate` + a client-side guard; scale
  bounds are **coerced finite at the input boundary** so a cleared field can't persist `NaN`
  (code-reviewer caught the `z.number()`-accepts-`NaN` edge). Nav entry + `/questionnaires` route in
  AppShell/Shell. Tests: 3 RTL (empty state, save-payload shape, validation surfacing) + a new E2E
  (author single-choice → option editor → validate → save → encrypted round-trip + overflow guard);
  the **responsive phone-width sweep now visits Questionnaires + opens the builder**. Gate green
  (typecheck/lint/format, **194 desktop** + 98 core unit, **29 E2E**). Synced `08` §3.1 (nav is
  `create`-only until the Inbox/answer surface ships, §13.5). \*\*Next §13 slices: builder follow-ups
  (matrix/images/branching editors, sensitivity picker, preview/test-on-self, send UI) → AI generate
  - context-provider registry → analyze→insights → send/collect (Inbox/Results) → relay.\*\*
- 2026-06-11 — Build (Questionnaires **IPC/bridge wiring** — exposing the engine to the renderer,
  [08-questionnaires](docs/specs/08-questionnaires.md) §6/§13.2): added `questionnaires:list/get/save/
delete/validate` + `assignments:create` (in-app) through the typed seam — `channels.ts` (contract +
  `SelfosBridge`) → **`coreBridge`** (host-agnostic, so the iOS host gets it free) → `ipc.ts` handlers →
  preload. All gated by **`questionnaires.create`** (`validate` is an ungated pure pre-flight check);
  `assignments:create` is **in-app/household only** for now (forces `channel: inApp` + a household-person
  recipient; the relay channel + answer/results/insights IPC land with their slices). Renderer inputs are
  Zod-validated in the bridge. Code-reviewed (added a recipient-existence check so a send can't bind a
  phantom recipient; `expiresAt` tightened to a datetime). Gate green (typecheck/lint/format, **191
  desktop** + 98 core unit tests). Synced `08` §6/§13.2.
- 2026-06-11 — Build (Questionnaires **slice 1b — the questionnaire engine backend**,
  [08-questionnaires](docs/specs/08-questionnaires.md) §4.2/§4.3/§13.1): the `Questionnaire`/`Question`
  (all answer types incl. matrix/allocation + author `media` + simple `branch`)/`Assignment`/`ResponseSet`
  Zod schemas + the new **`@selfos/core/questionnaires`** services — `questionnaireService` (CRUD +
  **version-bump-on-edit** + `validateQuestionnaire`), `assignmentService` (`createAssignment` freezes an
  **immutable snapshot** of the as-sent questionnaire + refuses an invalid send; status transitions incl.
  decline-with-note; sender-scoped list), `responseService` (encrypted response CRUD + re-ask chaining).
  Code-reviewed (no blockers; added per-answer-type validation tests + a stray-`sends/`-entry regression);
  gate green (typecheck/lint/format, **98 core unit tests**). Deferred: relay link material, the
  context-provider registry, `queryMetrics`, and the renderer (IPC + builder/inbox/results UI). Synced `08`
  §13.1.
- 2026-06-11 — Build (Questionnaires **slice 1a — the shared Insight/metrics layer foundation**,
  [08-questionnaires](docs/specs/08-questionnaires.md) §4.4/§13): added the `Insight`/`InsightFact`/
  `InsightSource` Zod schemas, the new **`@selfos/core/insights`** `insightStore` (encrypted per-subject
  CRUD + `summarizeForContext` — own approved insights + related people's shareable facts, recency-capped),
  and wired it into **`buildContext`**. Registered `questionnaires.create/answer/viewResults/sendExternal`
  (Member gets all four); **`readRaw` intentionally NOT registered** (deferred to the break-glass slice;
  ships OFF even for the Owner). Added optional `email`/`phone` to `Person`/`PersonInput`
  (additive-optional — **no `schemaVersion` bump/migration**, matching the `DeviceStateSchema` precedent);
  `upsertPerson` persists them (the code-reviewer caught it dropping them). Gate green (typecheck/lint/
  format, **83 core unit tests**). **Deferred** to consuming slices: questionnaire/assignment schemas +
  services, the context-provider registry, `readRaw` + break-glass, `queryMetrics`. Synced `04` + `08` §13.
- 2026-06-11 — Fix (**per-person session isolation — the previous account's sessions lingered in the UI
  after a switch**; user flagged). Diagnosed (not guessed): conversation **storage is correctly
  per-person** (`people/<personId>/conversations/*.enc`; `listConversations` only reads that person's dir)
  — the leak was **stale renderer state**. `sessionStore.switchTo` reloaded only the session store; the
  **person-scoped stores (`conversationStore`, `budgetStore`, `usageStore`) were never reset**, so after
  switching, the prior account's Sessions list / open transcript / usage-ring lingered until some later
  `load()` ("disappears after a little bit" — e.g. navigating to Sessions re-ran its mount-effect). Fix:
  each store gets a `reset()`, and **`AppShell` runs an effect keyed on `activePerson.id`** that
  resets all three + reloads conversations/budget — so a switch clears the UI immediately, even while the
  Sessions screen stays mounted (the bug's trigger: switching via the always-visible TopBar account menu).
  Also resets the admin's "view person X" usage filter so it can't carry into another account. Unit tests
  for the three resets + an **E2E** (owner creates a renamed session → grant a member → switch to them
  while on Sessions → the owner's session is gone, `toHaveCount(0)`). **Lesson: any renderer store holding
  PER-PERSON data must reset when `activePerson.id` changes — storage scoping alone isn't enough; stale
  client state leaks one user's data into another's view. Household-wide stores (people, settings) and
  device-scoped ones (nav) are exempt.** Gates: typecheck/lint/format, 188 desktop unit (+3), **28 E2E**
  (+1). Renderer-only. **NOTE: a concurrent agent is now editing `packages/core` (capabilities/schemas/
  peopleService/buildContext + a new `insights/` dir — their session-analysis track) — all UNCOMMITTED;
  left untouched, my commit is the 5 renderer files only.**
- 2026-06-11 — Build (**Capacitor track slice iii-b3b — live vault change feed**;
  [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.4/§13). Closes the last deferred iii item. The
  existing `VaultFs` plugin gains a private **`NSFilePresenter`** watching the vault directory →
  `notifyListeners("vaultChanged")` (fires when iCloud applies a sync from another device), plus
  `startWatch`/`stopWatch` (methods on the **already-registered** plugin — the user just rebuilds, no
  Add-Files). TS: `VaultFsPlugin` gains `startWatch`/`stopWatch`/`addListener`; `webHost`'s
  `createBridgeHost` gains an `onVaultChanged` part — `createCapacitorHost` arms the native watch from the
  active bookmark + forwards events, the web preview stays a no-op. Reviewer-driven robustness:
  **disarm on background / re-arm on foreground + `deinit`** (so a suspended app never holds a coordination
  presenter or leaks the security scope), and the TS watcher re-checks a `cancelled` flag after each await
  (no listener/watch leak if cleanup races setup). **Honesty caveat:** the only consumer (`useVaultConflicts`
  → `getConflicts`) is **still a stub on iOS** (`getConflicts` returns `[]`), so the feed is wired + correct
  but yields **no visible conflict banner on iPhone yet** — iOS conflict _detection_ is a separate deferred
  piece; the presenter is the seam for it + future live data re-fetch. Reviewer verdict **ship**. Gates:
  typecheck (node + web/DOM-lib), lint, format, **261 unit** (76 core + 185 desktop, +2 watcher tests),
  `build:web`. **Swift blind** — user rebuilds (no Add-Files) + device-tests a background→foreground cycle.
  **Lesson: an iOS `NSFilePresenter`/held security scope MUST be torn down on app-background (and re-armed
  on foreground) — a suspended app holding one can block coordinated writes + leak the scope.** **The iii
  arc is now fully done** (a/b1/b2/b3/b3b + c1/c2); only iii-d (wife's-phone install, Xcode-only) + (iv)
  distribution remain, both user-driven. (Concurrent agent's `docs/specs/0{4,5,8,9}` + `11` untouched.)
- 2026-06-11 — Fix + **Capacitor track wrap-up (iOS app layer COMPLETE, on-device verified)**;
  [07-mobile-platform](docs/specs/07-mobile-platform.md) §13. Security cleanup: **`scrubLegacyLocalStorageSecrets()`**
  (`host/webStores.ts`) removes the orphaned master key + API key the pre-iii-c1 stub left in WKWebView
  `localStorage` (now that secrets live in the Keychain — lower-protection duplicate). It runs **only in
  `installRealBridge`'s native branch** (iOS); the web preview keeps its `localStorage` secrets. Regex
  `^selfos:[^:]*:secret:` matches secret keys only (device-state/settings + non-app keys are left). +1
  test. **Decision (asked):** security cleanup + finalize, over the optional iii-b3b live-refresh polish.
  **Milestone:** the user verified the full app on a physical iPhone — shared iCloud vault (with
  download-on-demand), Keychain secrets (one-time re-unlock), and **real streamed Claude**. So the iOS app
  layer (iii-a → iii-c) is **done**: one responsive codebase running on Electron + iPhone off the **same**
  iCloud-Drive vault via `createCoreBridge` over platform hosts. Gates: typecheck/lint/format, **259 unit**
  (76 core + 183 desktop), `build:web`. (Self-reviewed — small, iOS-gated, tested cleanup.) **Remaining,
  non-blocking:** **iii-b3b** live `NSFilePresenter` change feed (`onVaultChanged` is a no-op; reads are
  fresh anyway), **iii-d** wife's-phone install (Xcode signing only, no code), **(iv)** Developer Program +
  TestFlight. (Concurrent agent's `docs/specs/0{4,5,8,9}` + `11` still untouched.)
- 2026-06-11 — Build (**Capacitor track slice iii-c2 — real Claude on iOS**;
  [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.3/§11.3/§13). Replaces the fake assistant on
  iOS with the Anthropic SDK in **browser mode**. New `host/browserClaudeClient.ts` — the
  `@anthropic-ai/sdk` with **`dangerouslyAllowBrowser: true`** running in the WKWebView, a faithful mirror
  of the Electron `anthropicClient` (adaptive thinking + `cache_control` on the system prefix, streamed
  `on('text')` deltas, usage-field mapping). `webHost`'s `createBridgeHost` gained a `claude` part:
  `createWebHost` keeps the deterministic fake (preview), `createCapacitorHost` uses the real browser
  client. **No native-HTTP fallback yet** — per spec §11.3 it's only built if WKWebView blocks CORS/SSE on
  the user's device (browser-mode tried first). **Probe result: the SDK typechecks under the DOM lib AND
  bundles into `build:web`** (151 KB gzip total, +42 KB; advisory chunk-size warning only) — so browser-mode
  is viable. Security: the API key is read from the Keychain and passed to the SDK per call; on iOS the host
  runs in the WebView, so the key is transiently in JS memory during the call (inherent to Capacitor; the
  native-HTTP fallback would keep it native). Reviewer verdict **ship** (parity with `anthropicClient`
  verified line-for-line + against the SDK 0.104.1 `Usage` type; no leaks/logging). Gates: typecheck, lint,
  format, **258 unit** (76 core + 182 desktop, +3 SDK-mocked tests), `build:web`. **The browser-mode network
  path is verified ON-DEVICE by the user** (can't unit/E2E the real API). **This completes the iii-c app
  layer — iOS now has the real iCloud FS (VaultFs) + Keychain secrets + real Claude.** **NEXT: the user's
  on-device chat test** — if it hits a WKWebView CORS/SSE error, build the native-HTTP fallback (CapacitorHttp
  or a small plugin); else **iii-b3b** (live NSFilePresenter change feed) / **iii-d** (wife's phone install).
  (Concurrent agent's `docs/specs/0{4,5,8,9}` + `11` untouched.)
- 2026-06-11 — Build (**Capacitor track slice iii-c1 — native iOS Keychain `SecretStore`**;
  [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.1/§5.3/§13). Moves the vault **master key + Claude
  API key** off the iii-b2 `localStorage` stub into the **iOS Keychain**. New `ios/App/App/Keychain.swift`
  (`CAPBridgedPlugin` `jsName "Keychain"`, registered alongside `VaultFs` in `MainViewController`):
  `get`/`set`(upsert via SecItemUpdate→Add)/`has`/`remove` over `kSecClassGenericPassword`, service = bundle
  id, **`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synced**, settle-once on every path. TS
  `host/capacitorSecretStore.ts` (`capacitorSecretStore(plugin?)` → core `SecretStore`); `webHost`'s
  `createBridgeHost` now takes a `secrets` part — `createWebHost` keeps `localStorage` (preview),
  `createCapacitorHost` uses the Keychain. **Decision (asked):** Keychain first, then real Claude (iii-c2).
  **Migration:** a device that unlocked under the old `localStorage` stub re-unlocks **once** via recovery
  phrase (gate routes `vaultInitialized && !hasMasterKey` → Unlock; no re-key, no lockout, recovery phrase
  still held) — no blind migration written (reviewer confirmed safe). Reviewer verdict **ship** (no
  blockers; Keychain query/upsert/error-handling correct, TS adapter faithful + tested). Gates: typecheck
  (node + web/DOM-lib), lint, format, **255 unit** (76 core + 179 desktop, +5 adapter tests), `build:web`.
  **Swift is blind** — user adds `Keychain.swift` to the App target + rebuilds (re-unlock once after).
  **Lesson: each new app-local Capacitor plugin needs its own `registerPluginInstance` line in
  `MainViewController.capacitorDidLoad` — that's now the established pattern (`VaultFs`, `Keychain`, and the
  iii-c2 Claude/HTTP plugin if any).** Backlog: scrub the legacy `localStorage` secret keys post-migration.
  **NEXT: iii-c2** real Claude (browser-mode SDK + native-HTTP fallback). (Concurrent agent's
  `docs/specs/0{4,5,8,9}` + `11` untouched.)
- 2026-06-11 — Fix (**iOS WebView stuck-zoom — content didn't fit, scrolled both axes**; user flagged on
  their device). Diagnosed from the device (NOT guessed): an on-device console probe showed `vw=319`
  while the page layout + every element was **393** (the iPhone's logical width) — i.e. the layout was
  correct and fit, but the WKWebView was **zoomed ~1.23×** so only 319 of the 393 showed → scroll in both
  axes, on every screen (the zoom persists across in-app navigation). **Cause:** iOS auto-zooms a WebView
  when an `<input>` with font < 16px is focused (1.23 ≈ 16/13 — the unlock PIN field), and the viewport
  meta didn't lock scaling so it never zoomed back. **Fix:** added `maximum-scale=1.0, user-scalable=no`
  to the viewport meta in `apps/desktop/index.html` (the web/iOS entry; Electron uses its own html, so it's
  unaffected). It's an app shell, not a web page — locking scale is standard for a Capacitor WebView, and
  system-level Accessibility → Zoom still works. **Lesson: the E2E 390px overflow guard can't catch this —
  it's a real-device WebView zoom behavior (insets/auto-zoom are 0/absent in jsdom + the browser preview).
  On-device, measure `window.innerWidth` vs `documentElement.scrollWidth`: a mismatch = a zoom problem, a
  match-but-too-wide = a layout overflow.** (Web-only change; rebuild via `build:web` → `cap sync` → Xcode.
  Concurrent agent's `docs/specs/0{4,5,8,9}` + `11` untouched.)
- 2026-06-11 — Fix (**iCloud download-on-demand in `VaultFs`** — user hit it doing the shared-vault test).
  Symptom: the phone pointed at the **same** iCloud `SelfOS` folder the Mac set up, but still showed
  **Setup** instead of Unlock. Cause: on a fresh device the Mac's files are iCloud **placeholders**
  (`.recovery.enc.icloud`) until downloaded, and v1 `VaultFs` checked `fileExists` on the real name →
  `false` → `read('config/recovery.enc')` returned null → `isVaultInitialized` false → Setup. (Worse,
  `initVault`'s placeholder-blind meta read had rewritten the vault's `.selfos/meta.json` + empty
  `settings.json` — cosmetic; `recovery.enc` + `people/*.enc` were never touched, so unlock still works.)
  This is the §7/Q8 edge we'd deferred — turns out it's required for the **very first cross-device read**.
  Fix (Swift, `ios/App/App/VaultFs.swift`): `read` now **materializes a not-yet-downloaded item on demand**
  — if the real file is absent but a `.<name>.icloud` placeholder exists, call
  `startDownloadingUbiquitousItem` + poll (bounded 30s, off the main thread) before the coordinated read;
  genuinely-absent (no placeholder) still → null. `list` maps `.<real>.icloud` placeholder names back to
  real names. **Lesson: on iCloud Drive, `fileExists`/`contentsOfDirectory` reflect only _downloaded_
  state — any cross-device read must trigger `startDownloadingUbiquitousItem` and handle the
  `.<name>.icloud` placeholder, or a synced-but-not-downloaded vault reads as empty.** Swift-only (TS gates
  unaffected); user rebuilds in Xcode (no `cap sync` needed — the file's already in the target). Still open
  (Q8): the richer "downloading from iCloud…" progress UX, and eviction/delete of not-downloaded files.
  (Concurrent agent's `docs/specs/0{4,5,8,9}` + `11` untouched.)
- 2026-06-11 — Fix + **iii-b3 verified on-device** (user built it in Xcode). The native `VaultFs` plugin
  was compiling but **not registered** — `Capacitor.isPluginAvailable('VaultFs')` was `false`, so
  `pickFolder()` rejected and our `selectVaultFolder` catch swallowed it to null → tapping "Choose a
  folder" did nothing. **Cause + lesson: app-local Capacitor plugins are NOT auto-discovered** — only
  plugins shipped as packages (with a podspec) are. An in-app Swift plugin must be **registered
  explicitly**. Fix: added `ios/App/App/MainViewController.swift` (a `CAPBridgeViewController` subclass)
  that calls `bridge?.registerPluginInstance(VaultFsPlugin())` in `capacitorDidLoad`, and repointed
  `Main.storyboard`'s root VC to `MainViewController`. After re-adding both Swift files to the App target
  (Reference in place) + rebuild: `isPluginAvailable` → true, the iOS folder picker presents, and setup
  writes the encrypted vault through `VaultFs` on the simulator. **So the iii-c Keychain plugin (and any
  future native plugin) needs the same `registerPluginInstance` line in `MainViewController`.** Diagnosis
  tip: the Safari Web Inspector console (Develop → simulator → the app) + `Capacitor.isPluginAvailable(...)`
  is the fastest way to tell "plugin not registered" from "plugin errored". (Native-only change; TS gates
  unaffected. Concurrent agent's `docs/specs/0{4,5,8,9}` + `11` still untouched.)
- 2026-06-11 — Build (**Capacitor track slice iii-b3 — native Swift `VaultFs` plugin + TS FS adapter**;
  [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.4/§13). The **real security-scoped iCloud-Drive
  filesystem for iOS**, so the iOS WebView shares the _same_ vault as desktop. **`ios/App/App/VaultFs.swift`**
  (`CAPBridgedPlugin`): `pickFolder` (UIDocumentPicker open-directory → a security-scoped bookmark),
  bookmark resolve, and `read`/`writeAtomic`(temp+rename via `Data(.atomic)`)/`list`/`remove` over
  `NSFileCoordinator`, each bracketed in `start/stopAccessingSecurityScopedResource` and settling its
  `CAPPluginCall` **exactly once after coordination**. TS: **`host/capacitorVaultFs.ts`**
  (`registerPlugin('VaultFs')` + `capacitorFileSystem(bookmark, plugin?)` over the core `FileSystem`, bytes
  base64-bridged via a new **`@selfos/core/encoding`** export); **`webHost` refactored** to a shared
  `createBridgeHost(parts)` used by both `createWebHost` (IndexedDB) and `createCapacitorHost` (native FS +
  picker, reusing the iii-b2 `localStorage` stores); **`installRealBridge` now picks the host by
  `Capacitor.isNativePlatform()`**. **Decisions (asked):** **defer the NSFilePresenter** change feed to a
  iii-b3b follow-up (`onVaultChanged` no-op for now); **reuse `localStorage`** for interim iOS
  device-state/secrets (only the FileSystem swaps to native; iii-c brings the Keychain). No
  iCloud-container entitlement (access is via security scope — §11.6). Reviewer verdict **ship**; applied
  the should-fixes — restructured all 4 Swift coordinated ops to **settle the call once after `coordinate`
  returns** (a hung call would freeze boot — the worst on-device failure), and made `createCapacitorHost`
  **injectable + tested** (picker→bookmark + cancel→null). Gates green: typecheck (node + web/DOM-lib), lint,
  format, **250 unit** (76 core + 174 desktop, +6 TS host tests), **27 Electron E2E** (no regression),
  `pnpm build:web` bundles `@capacitor/core`. **The Swift is BLIND-WRITTEN — I can't compile it here; the
  user builds + verifies on-device in Xcode** (`pnpm build:web` → `npx cap sync ios` → **add `VaultFs.swift`
  to the App target's Compile Sources** → run; expect to iterate on any Swift compile nits). **Lesson: for a
  blind-written native bridge method, the #1 robustness rule is "settle the platform call exactly once on
  every path" — an unsettled `CAPPluginCall`/promise hangs the JS caller (here: a frozen boot with no
  error).** **NEXT: iii-c** (iOS Keychain `SecretStore` + browser-mode Claude with a native-HTTP fallback),
  then **iii-b3b** (the live NSFilePresenter change feed). **(Concurrent agent's `docs/specs/0{4,5,8,9}` +
  `11` left untouched; this slice's doc edits are only 07 + this entry.)**
- 2026-06-10 — Build (**Capacitor track slice iii-b2 — iOS in-webview host + browser verification**;
  [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.3/§13). The real **in-webview `BridgeHost`**
  wiring the shared `createCoreBridge` factory to browser APIs, so the actual `@selfos/core` runs in a
  WKWebView/web preview (replacing the throwaway iii-a stub). New `renderer/src/host/`: **`idbFileSystem`**
  (IndexedDB `FileSystem` — vault-relative paths keyed `<vaultId>/<path>`, atomic per-tx writes + subtree
  removes), **`webStores`** (`localStorage` SecretStore + device state/settings **namespaced by a `?device=`
  id** so two tabs = two devices sharing one vault, + a deterministic fake `ClaudeClient`), **`webHost`**
  (assembles the host + boot/`useVault`/`initVault` over IDB + `installRealBridge()`). `main.web.tsx` calls
  `installRealBridge()`; **`stubBridge.ts` deleted**. `DeviceStateSchema` gained optional `vaultBookmark?`
  (the iOS vault handle; the web host uses it as the IDB vault id). **Decisions (asked):** IndexedDB-backed
  preview vault (persistent), deterministic fake Claude reply, and **yes to the `?device=` multi-device
  switch** (recommended — it's the one risky path: redeem with NO device key). **Browser-verified** the real
  app end-to-end: onboarding → real WebCrypto/scrypt `householdSetup` → people → invite → a `?device=B` tab
  reading the shared IndexedDB vault + redeeming the invite with no prior key (joins **member-only**, not
  owner) → capability-gated nav (member's nav omits People) → chat streaming, no console errors. Reviewer
  verdict **ship** (added a `webHost` boot/initVault test + made `idbFileSystem.remove` single-transaction
  per the findings). Gates green: typecheck (node + web/DOM-lib), lint, format, **244 unit** (76 core + 168
  desktop, incl. 16 new host tests via `fake-indexeddb`), **27 Electron E2E** (no regression),
  `pnpm build:web` bundles `@selfos/core` (105 KB gzip). **Lesson: `fake-indexeddb`'s tx scheduler needs
  `setImmediate` (node env, not jsdom), and a shared global IDB deadlocks across tests when a prior open
  connection blocks `deleteDatabase` — inject a fresh `IDBFactory` per test (as `idbFileSystem` already
  did).** The web host is the same one the iOS WebView will use until the native plugins land. **NEXT:
  iii-b3** — the Swift `VaultFs` Capacitor plugin (real security-scoped iCloud FS) replaces `idbFileSystem`;
  then iii-c (iOS Keychain + browser-mode Claude) replaces the `localStorage`/fake stubs. **(Concurrent
  agent's `docs/specs/0{4,5,8,9}` + `11` left untouched; this slice's only doc edits are 07 + this entry.)**
- 2026-06-10 — Build (**Capacitor track slice iii-b1 — shared `createCoreBridge(host)` factory + Electron
  migration**; [07-mobile-platform](docs/specs/07-mobile-platform.md) §5.3/§13). Extracted ONE
  platform-agnostic factory (`apps/desktop/src/shared/coreBridge.ts`, node/electron/`Buffer`-free) that
  implements the ~30 `SelfosBridge` data ops **once** over an injected **`BridgeHost`** of platform
  primitives (`vaultAndKey`/`fileSystem`/`secrets`/`claude`/device-state/device-settings/`activeModel`/
  super-admin flag/`emitChatChunk`/`appVersion` + the forwarded platform ops). Electron's `ipc.ts` now
  builds a node-backed host, calls the factory, and registers each `ipcMain.handle` as a **thin delegate**
  (via a typed `handle<F>` helper); platform-specific ops (folder picker, chokidar watcher, conflicts,
  reveal, boot-state) stay in the host, and `useVault`/`chatStream` are special-cased to capture
  `event.sender` (the chat sender is bound per-turn + reset in `finally`). Supporting moves:
  `runConnectionTest`/`mapError` → **`shared/claudeProxy.ts`** (deleted `main/claude/claudeService.ts`,
  only `anthropicClient` stays in main); `main/settings/settingsStore.ts` slimmed to **device-only** (vault
  settings now read/written in the factory over the FileSystem host — `readVaultSettingsValues`);
  `main/people/superAdmin.ts` slimmed to **just the in-memory inspect flag** (passphrase set/has/verify +
  the legacy device→vault migration moved into the factory via `@selfos/core/people`); **deleted
  `main/people/household.ts` + `session.ts`** (householdStatus/setupHousehold + active-person now in the
  factory over `host.readDeviceState`/`updateDeviceState`); core gains a `./id` export + re-exports
  `memFileSystem`. **Behavior-preserving** — the suite is the proof, and inputs are still **Zod-validated in
  the factory** so the trust boundary holds on BOTH hosts (the renderer is never the boundary); the API key
  stays host-side. Reviewer verdict **ship** (exact IPC channel parity; every moved handler logically
  identical to the old `ipc.ts`). Gates green: typecheck (incl. `tsconfig.web` DOM lib — the factory imports
  `@selfos/core/crypto`), lint, format, **228 unit** (76 core + 152 desktop, incl. a new `coreBridge.test`
  driving real `@selfos/core` over `memFileSystem` the way the iOS host will), **27 E2E**. **Lesson: the
  factory's return type is the full `SelfosBridge`, but in Electron the renderer subscriptions
  (`onVaultChanged`/`onChatChunk`) live in the PRELOAD, so the bridge's own subscription methods are
  no-ops in main — they exist for the iOS host. Keep streaming as `emitChatChunk` (host sink) + a
  per-turn-bound sender.** **NEXT: iii-b2** — the iOS in-webview host implementing `BridgeHost` + browser
  verification (in-browser FS, DeviceStore over Preferences, temp Secret/Claude stubs), then delete
  `stubBridge.ts`. **(Concurrent-agent note unchanged: left all of `docs/specs/0{4,5,8,9}` + `11`
  untouched; this slice's doc edits are only 07, 10 §5.2, and this entry.)**
- 2026-06-10 — Fix + decisions (**Capacitor track iii-b start: iOS host**). **Decisions (asked):** the
  iOS host shares logic with Electron via **one platform-agnostic `createCoreBridge(host)` factory**
  (both hosts expose the same `SelfosBridge`; ~40 data ops live once), and we **browser-verify the host
  first** (wire `@selfos/core` to an in-browser filesystem so the real app works in the web preview
  before the blind Swift plugin). Sub-slices: **iii-b1** factory + Electron migration → **iii-b2** iOS
  in-webview host + browser verify → **iii-b3** Swift `VaultFs` plugin (Xcode). **Foundational blocker
  found + fixed first:** the iOS host runs `@selfos/core` in the WKWebView, so core must typecheck under
  the renderer's **DOM lib**, but TS 5.7's `Uint8Array<ArrayBufferLike>` is incompatible with WebCrypto's
  `BufferSource` (wants `ArrayBuffer`, not `SharedArrayBuffer`) — `importKey`/`encrypt`/`decrypt` in
  `cryptoService` wouldn't compile under DOM lib. Added a `bufferSource()` copy at the `subtle.*`
  boundary; **the whole core surface (crypto/people/usage/conversations/vault/host) now typechecks under
  both `tsconfig.web` (DOM) and `tsconfig.node`.** Byte-identical (cryptoCompat fixtures + encrypted-vault
  E2E pass). **Lesson: any code destined for the WebView must be typechecked under the DOM lib early —
  the Node lib is lenient about `BufferSource`/`Uint8Array<ArrayBufferLike>` where the DOM lib is strict;
  probe with a throwaway import before building on top.** **NEXT: iii-b1 the `createCoreBridge` factory.**
  **Note: a concurrent agent renumbered its stray spec `10-relationship-tracking` → `11` (resolving the
  number collision with this 10-multi-device-vault) and is editing `04`/`05` — left untouched per the
  user; my commits exclude all of `docs/specs/0{4,5,8,9}` + `11`.**
- 2026-06-10 — Build (**Slice 2b — [10-multi-device-vault](docs/specs/10-multi-device-vault.md) Slice 2
  complete; the whole spec is now built**). The **member redeem flow**: `invites:redeem` (needs **no
  device key** — unwraps the master key from the matching invite via core `redeemInvite`, stores it
  device-local, **persists** the resolved person as `DeviceState.pendingJoinPersonId`) +
  `invites:completeJoin` (sets that member's **own PIN** + signs them in; only the redeemed person —
  never the owner — can be completed, so the renderer can't target another account). `UnlockScreen` now
  has two modes: recovery-phrase (owner) and **invite** ("Have an invite code?" → enter code → "Set
  your PIN" → Finish). **Security fix the reviewer caught:** redeem stores the key + consumes the invite
  (single-use), so a crash before the PIN was set would have dropped to an **open person picker** where
  anyone could sign in as the PIN-less member with the key already on disk. Fixed by **persisting the
  pending join device-local** and having `HouseholdGate` **resume the "Set your PIN" step** on next boot.
  Gates green: typecheck/lint/format, **223 unit** (76 core + 147 desktop), **27 E2E** (owner→member
  round trip joins **member-only** + account gains a PIN + invite consumed; an interrupted-redeem reboot;
  a 390px overflow guard on the invite surfaces). **Lesson: a two-step that persists secret material
  (key on disk) in step 1 must make step 2 resumable on crash — otherwise the interrupted state is an
  open door. Persist the pending state and re-route to it on boot.** Multi-device household is DONE:
  one owner/super-admin per directory, no re-keying, recovery-phrase device join, super-admin in the
  vault, owner PIN, and secure member invites.
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
