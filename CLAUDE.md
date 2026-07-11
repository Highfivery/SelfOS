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
- **Never tell users an owner/admin can see their data.** No user-facing copy — to answerers/recipients
  **or** to authors — may state that a household owner or administrator can access someone's answers/content
  (durable product rule, 2026-06-15: the questionnaire `discloseAdminAccess` setting + admin-access
  disclosure line were removed for this reason). The owner's full-access reality (RBAC at the app layer) is
  real, but we do not surface it as a disclosure that could make people feel surveilled.

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

For every slice (the **PR-based flow** — `main` only ever moves through a merged PR):

1. **Branch** off the latest `main` — `git switch main && git pull` first, then
   `git switch -c <type>/<slug>` (`feat/…`, `fix/…`, `chore/…`, `docs/…`, `refactor/…`). **Never commit
   to `main` directly, and never `git merge origin/main` into a branch — rebase onto it** (`git rebase
origin/main`) so history stays linear and the release manifest never carries a stale value forward.
2. **Spec** → review with the user → perfect → approve.
3. **Implement** with tests (see Definition of Done).
4. Run the **`ship-slice`** skill: `quality-gate` → `code-reviewer` agent → `sync-docs` → commit (on the
   branch).
5. **Push the branch and open a PR** (`git push -u origin HEAD && gh pr create`). Let **CI go green**.
6. **Squash-merge the PR on GitHub** with a Conventional Commit title (`gh pr merge --squash`); delete the
   branch. One clean commit lands on `main` — never a direct push, never a local merge.
7. **Offer to release** (the **`release`** skill): once the slice is on `main`, ask the user
   _"Tag & publish vX.Y.Z now, or batch with the next change?"_ Releasing = **merging the open
   release-please PR** (which auto-bumps the version, writes `CHANGELOG.md`, tags `vX.Y.Z`, and builds +
   publishes the `.dmg`). **Never hand-bump a version or hand-tag** — release-please owns it (spec
   [`19`](docs/specs/19-distribution.md)).

**ALWAYS ask — NEVER assume or guess.** Before implementing anything with an unstated product, UX,
visibility, permission, or behavior decision (defaults, who-sees-what, scope, placement, period),
**stop and ask detailed clarifying questions** (`AskUserQuestion`). Do not fill gaps with your own
defaults. The user has stated this forcefully and repeatedly; guessing has produced rework. Only
proceed without asking when the choice is genuinely unambiguous from the request or already answered.

**NEVER fix a bug whose cause you have only ASSUMED — diagnose the real root cause FIRST, then fix.**
(2026-06-16, after a costly violation.) When something fails, do NOT pattern-match to a plausible cause and
start changing code — **reproduce/verify the actual cause against the real system before touching anything.**
Specifically:

- **Never assume a Claude/model failure is a content-policy refusal.** "No output / unparseable" is far more
  often a mechanical cause — **token-budget starvation (adaptive `thinking` shares `max_tokens` → truncated/
  empty output), truncation, a parse/validation drop, a wrong model, a transport error**. A real example cost
  the user a lot of tokens: I assumed intimacy generation was a refusal and rewrote the prompt to a weaker
  "wellness" register — the real bug was the thinking budget; the prompt was fine and my change was reverted.
- **The offline fakes (`SELFOS_FAKE_CLAUDE`, etc.) HIDE this class of bug** — they always return canned valid
  output, so every test passes while the live app fails. When a model call fails only in the real app,
  **diagnose against the LIVE model** (reconstruct the exact prompt from the real builders, call the API, read
  `stop_reason` + the raw text) BEFORE changing the prompt or anything else.
- If you cannot verify the cause yourself, **say so and ask** — do not ship a speculative fix. A fix premised
  on an unverified guess is a guess.
- See memory [[adaptive-thinking-shares-maxtokens]] and [[always-ask-never-assume]].

---

## 7. Definition of Done

A slice is **not** done until **all** of these pass:

- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean (ESLint) and Prettier-formatted
- [ ] Unit/component tests for new logic (Vitest); meaningful, not trivial
- [ ] E2E tests for **every** new user-facing surface/section, not just the happy path (Playwright).
      **ALWAYS WRITE _AND RUN_ THE E2E — never defer it as "pending on-machine verification" or skip it on a
      worktree/"needs a display" excuse (2026-06-24, forceful).** E2E runs headlessly here: `pnpm --filter
@selfos/desktop exec electron-vite build` once, then `pnpm exec playwright test [-g "<name>"]` — the
      `_electron.launch` harness needs no visible display. A slice is NOT done until its E2E is green.
      Include a no-horizontal-overflow / layout guard for content-heavy screens, and a geometry guard
      for fixed-size controls (e.g. a toggle must not shrink in a flex row — assert computed
      `flex-shrink` / thumb position). **The overflow guard must catch INNER scrollbars too** — assert NO
      element has `scrollWidth > clientWidth` with computed `overflow-x: auto|scroll` (not just `main`);
      and test at the **actual rendered container widths** (e.g. the narrow Sessions sidebar, ~240px),
      not only the 390px page width — a `main`-only check missed a scrolling filter + a clipped sidebar.
      **Assert the FULL surface renders to the bottom — not just "no overflow".** For any content
      form/section, scroll to the end and assert the LAST element actually shows: every question is visible
      (no input hidden in a default-collapsed accordion — assert no `<details>` is `!open`), and the trailing
      affordances (e.g. the onboarding "Tell me more" go-deeper + Continue/Skip) are visible. A passing
      overflow guard does **not** prove the content is present — a collapsed accordion silently swallowed the
      last group's questions and every prior check (overflow, screenshots of the top) missed it.
- [ ] **Docs in lockstep** — relevant spec / `CLAUDE.md` / skills updated (`sync-docs`)
- [ ] **Self code-review** passed (`code-reviewer` agent); findings fixed or explicitly accepted
- [ ] Accessibility check for any UI
- [ ] **Responsive** — every UI works and looks intentional from ~360px (phone) to desktop; include a
      mobile-width layout guard (see §12). **AND: the screen FILLS the available width — the top-level
      content container has NO `max-width` cap (only dialogs/overlays, ellipsizing text, and fixed-aspect
      charts may cap; chat bubbles may use a % — never a fixed px page cap). Verify at desktop width, not
      just 360px.** (§12 durable rule.)
- [ ] **Visual QA pass (not just functional)** — screenshot every touched/new surface and look
      critically: alignment (buttons bottom-aligned with the inputs beside them, not floating
      mid-height), even spacing/rhythm, nothing clipped, and each element looks intentional and
      cohesive with its neighbours. Fix bad-looking UI before it ships — don't rely on "the test
      passed" (see §12).
- [ ] **Whole-flow coherence walk (not just "tests pass")** — actually walk the COMPLETE user flow
      end-to-end (the real app / preview, every step in order) and judge whether it **makes sense as a
      whole**, not just that each screen works. Specifically hunt for: **the same thing asked/picked more
      than once** (e.g. selecting a person at creation AND again in a sub-panel AND at send), **labels that
      collide or confuse** across steps (two different controls that read like the same question), **dead or
      now-redundant controls** left behind by a model change, and steps that no longer belong. A green E2E
      suite proves each step _functions_ — it does **not** prove the flow is coherent or non-redundant. When a
      change alters a flow's shape (e.g. moving recipient selection to the front), **re-walk every screen that
      touched that concept** and reconcile it. (2026-06-16: after recipient-selection moved to a start step, a
      stale "About a specific person?" picker in the AI panel still re-asked who it's for — caught by the user,
      not by the passing tests.)
- [ ] **Content-correctness check for personalized/generated content (not just "it rendered")** — when a
      surface shows content tailored to a specific viewer (a compatibility variant, a per-person prompt, a
      generated question), **assert the CONTENT is correct for that viewer**, not merely that the screen
      renders. Decrypt/inspect the actual text. (2026-06-16: a compatibility recipient was asked questions
      about THEMSELVES instead of the OTHER participant — every screen functioned, the suite was green, but the
      content was wrong; the offline fake returned canned output that hid it. The fakes now echo the
      `aboutName`, and the test asserts the recipient's variant names the OTHER person, not themselves.)
- [ ] **Test the feature when its PREREQUISITE is ABSENT (the common real state), not just the happy path** —
      if a feature only works once something is set up (a relay connected, a key added, AI enabled, a person
      granted access), write a test for the **not-set-up** path too: assert the graceful fallback AND that the
      UI tells the user how to enable it (it must never be silently invisible). (2026-06-16: the unified-relay
      link only mints with a connected relay; the happy-path E2E connected one first, so it never caught that —
      with no relay — the link feature was completely silent. The user sent a household questionnaire, saw no
      link, no explanation. Now the send panel hints "connect a relay in Settings → Relay," with a test.)
- [ ] **Drive the COMPLETE user-facing flow through the actual UI — never let a bridge-only test stand in for a
      missing screen.** For any feature with a multi-step lifecycle (create → see its state → act on it →
      delete), the E2E must walk **every step through the rendered UI**: the control that triggers each step
      must be **present, reachable, and clicked** — not invoked by calling `window.selfos.*`/the bridge directly.
      A coreBridge/integration test that drives the backend proves the _backend_ works; it says **nothing** about
      whether the button that calls it exists. (2026-06-16: a household relay link could be drained by a
      coreBridge test that called `assignmentsDrain()` directly — green — while the Results UI gated the "Check
      for responses" button on `channel === 'relay'`, so for a household send the button **never rendered** and
      the response was unretrievable. The user hit a dead end the passing suite couldn't see. Also surface state
      the user relies on: after an action (send), the entity's state must be **visibly reflected** where they
      look next — a "Sent · <date>" badge in the list + builder, not a form that looks untouched. Bridge tests
      complement UI walks; they do not replace them.)
- [ ] **`/gallery` updated** when a design-system primitive is added or changed (it must showcase all of them)
- [ ] **Admin-only UI is marked** — any control/section visible only to an Owner / super-admin carries a
      consistent "admin only" indicator (see §12)
- [ ] **The Questionnaires E2E matrix is extended** — any **new questionnaire option** (answer type,
      questionnaire type, sensitivity tier, privacy/visibility mode, delivery channel, capability gate, …) must
      add an end-to-end case to the standing §16.7 matrix in `08-questionnaires.md` (the regression suite a
      whole-feature mismatch once slipped past). Not "happy path only" — decrypt the vault to assert data.
- [ ] **A change to questionnaire SENDING/DELIVERY is verified across EVERY type × recipient × relay-state —
      not one path.** A send goes out through more than one code path: **one-person** (`assignmentsCreate`) AND
      **compatibility** (`assignmentsCreateCompatibility`), each to a **household** OR **external** recipient,
      each **with** a relay connected OR **without** one. Fixing/testing ONE path (e.g. one-person household
      with a relay) says NOTHING about the others — the user tests the path you didn't. For any delivery change,
      run E2E for **all** of: one-person household (relay → link + Email/Text delivery; no relay → the
      "connect a relay" hint, never silent), one-person external, compatibility household (relay), compatibility
      external; assert the **link + the Email/Text/Copy delivery actually render** (or the hint), and that a
      mint failure **surfaces** (never a silent Inbox-only fallback). (2026-06-17: a household COMPATIBILITY
      send minted no link + showed no hint — the unified-delivery work was wired only into `assignmentsCreate`,
      and the compat path's `catch` silently swallowed the failure; verifying compat-with-a-relay live would
      have caught it. Twice the user hit "no link" on a path the tests never drove.)
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
  `build:`, `ci:`, `chore:`, `revert:`). Enforced by commitlint; body lines ≤ 100 chars. The squash-merge
  **PR title** is what lands on `main`, so it must be a valid Conventional Commit (it drives the changelog +
  the version bump). `feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE` → major (pre-1.0: breaking →
  minor); `docs:`/`chore:`/`test:`/`ci:`/`build:` don't cut a release.
- Every commit ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Branches → PRs → squash-merge.** Work on a `<type>/<slug>` branch off `main`; land it by **squash-merging
  a PR on GitHub** (§6). **`main` is never pushed to directly and is never updated by a local merge.** **Never
  `git merge origin/main` into a branch — rebase onto it** (a hand-merge once carried a stale release manifest
  forward and looped release-please). The **`commit`** skill writes compliant messages and refuses if the
  quality gate hasn't passed.
- **Versioning, tags, and `CHANGELOG.md` are owned by release-please — never hand-edit them.** Don't bump a
  `version`, don't `git tag`, don't write `CHANGELOG.md` by hand, and **never add a `Release-As:` commit** (the
  footer lingers in history and forces backward version proposals). `.release-please-manifest.json` is the
  source-of-truth current version and **must match the latest git tag**; a `bootstrap-sha` floor keeps the
  commit scan above old release-config commits. If it drifts (a release-PR loop), fix the manifest to the
  latest tag — see spec [`19`](docs/specs/19-distribution.md) §7 + the **`release`** skill.
- **Git hooks need Node ≥ 20** (`.nvmrc` pins **24**). If a push/commit fails with a `pnpm requires … Node`
  error, run `nvm use` first. The hooks fail fast with this hint.

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
pnpm --filter @selfos/desktop release:build  # electron-builder --mac --publish always (manual release build)
```

Tests are **per-package** (`pnpm -r test`): the desktop app runs Vitest with a jsdom environment for
component tests. E2E (Playwright + Electron) runs on demand / in CI, not on every push (it builds the
app first).

**Releases are automated** (spec [`19-distribution`](docs/specs/19-distribution.md)): merged Conventional
Commits drive **release-please** → a "Release vX.Y.Z" PR → on merge it bumps the version, writes the root
`CHANGELOG.md`, and creates a draft GitHub Release; a macOS Actions job builds + attaches the `.dmg`, then
publishes it. Maintainers never hand-edit a version or tag. macOS-only + unsigned for now.

---

## 11. Skills & agents available

**Skills** (`.claude/skills/`): `write-spec`, `quality-gate`, `capture-feedback`, `sync-docs`,
`commit`, `ship-slice`, `release`. (`add-setting` and `new-feature-module` are added once the settings
registry and feature-module architecture are built.)

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
- **Content FILLS the available width — NEVER cap a page/content container with `max-width` (durable
  rule, the user has flagged this repeatedly and forcefully).** The content area (right of the sidebar)
  is the canvas; every route's top-level container must FILL it (`width: 100%`, no cap). **Do NOT** put
  `max-width` + `margin: 0 auto` on a route's page/content wrapper — that centers a narrow column and
  wastes the horizontal space, and it is a recurring UX failure. The screens are laid out with grids/
  flex that use the full width; a fixed reading-width cap is wrong for this app. **The ONLY things that
  may cap width:** (a) a **modal/overlay dialog** (centered + capped, e.g. `max-width: 460px`), (b) text
  that **ellipsizes** (a truncation cap on a label/chip), (c) a **fixed-aspect visualization** (a chart).
  A chat/message **bubble** may use a **percentage** (~80%) for readability — never a fixed `px` cap.
  When you build OR review ANY screen, confirm the top-level content container has **no `max-width`**;
  when in doubt, fill. (2026-07-11: removed content caps on Together/Settings/Home/Questionnaires/You/
  Onboarding/Gallery after the user flagged it yet again.)
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
- **NO horizontal scrollbars — anywhere, ever.** Not page-level and **not inner controls**. A filter row,
  toolbar, tab strip, or `SegmentedControl` that scrolls-x to fit is a UX failure. Test it (see §7).
- **Don't solve "it doesn't fit" by WRAPPING — wrapping a control row is lazy, not a design.** When options
  don't fit a narrow pane, pick a **space-filling component**, not a wrapping pile of chips: a full-width
  `Select` for a status filter, a full-width control, or a genuinely compact control — something that fills
  the space and scales to any label length. (The Sessions status filter is a full-width `Select`, not chips;
  catalog cards fill the row via an `auto-fit` grid.) Reserve wrapping for genuinely free-flowing content
  (tags on a detail page), never for a primary control cluster.
- **Design for density — cards must not waste vertical space.** A long catalog of cards must be compact and
  scannable: tight padding, clamp blurbs (`-webkit-line-clamp`), fold secondary metadata onto one line, and
  use a denser `auto-fit` grid so more fit per row. Don't ship tall, sparse cards (the guided-session cards
  were 5 lines tall → compacted to ~3 with a clamped blurb + an eyebrow that carries the tag + a "Steps"
  marker on one line).
- **Cards & rows: never let a title fight a tag/badge for the same line.** A title + framework tag on one
  line wraps the title a word-per-line at narrow widths — ugly. Put the tag as an **eyebrow above** the
  title (or below); give the title the full width. Likewise, don't cram many controls into one narrow row —
  collapse secondary actions (rename/delete) into a **kebab menu** rather than a wrapping icon cluster.
- **Flex truncation:** any text in a flex row that should ellipsize needs `min-width: 0` on the flex item
  (and the container) or it overflows its pane — the classic flexbox footgun. Verify narrow panes don't
  overflow.
- **Dropdown menus must not be clipped** by an `overflow: auto/scroll` ancestor, and a right-aligned menu
  must not render off-screen — pin its trigger so the menu stays in view (don't let the trigger wrap to a
  left-aligned line under a `right: 0` menu).
- **Collapsible/accordion** content needs clear spacing between the summary and its body when open (never
  let the first item butt up against the title). **Never default-COLLAPSE form inputs** — accordion grouping
  on a form/intake is for optional tidying only, so every group renders **open by default** (still
  user-collapsible). A group collapsed by default silently hides the questions inside it at the bottom of a
  section, so a person never sees or answers them (the onboarding "Your circle" group hid four questions; the
  shared `@selfos/answering` form now opens all groups). Grouped-content forms get the §7 "full surface
  renders to the bottom" E2E guard.
- **"Improve" means redesign, not relocate.** When asked to improve or move a component, actually
  redesign it for its new context — fit, density, space-conservation, cohesion with neighbours — don't
  just move the existing component. (E.g. the appearance control became a compact icon→popover in the
  TopBar, not the old wide segmented control; the brand mark sits in an app-icon tile, not a loose glyph.)

---

## Changelog

A running log of durable decisions and feedback captured into the project config. Newest first.

- 2026-07-11 — **Change + durable decision (Together pre-screen REMOVED at the owner's request; spec 58 §8.2;
  on `fix/together-remove-prescreen`).** The user asked to remove the couples "A private check-in, just for you"
  pre-screen. Because it was the app's **couples safety gate** (the AI-free, per-partner screen for
  safe-being-honest / afraid-of-partner / coerced signals that held an at-risk person from a first session and
  surfaced crisis resources — a documented non-negotiable per CLAUDE.md §1 / spec 58 §8.2), I **flagged the
  safety trade-off + asked** (AskUserQuestion, 3 options: one-tap-skippable / remove-entirely / lighten) rather
  than silently delete an IPV/coercion safety net. The owner chose **remove entirely**, informed. Surgical full
  removal: `PreScreenForm`, `preScreen.ts`/`.test`, the `PreScreenResult`/`TogetherPreScreenView`/`Result`/
  `SubmitSchema` schemas + `people/<id>/together/prescreen.enc` storage, the `together:prescreenGet`/`Submit` seam
  (channels/ipc/preload/test-utils/coreBridge), the gate on `together:create`/`accept`/`sendMessage`/`retry`, the
  `PRESCREEN` failure-reason union member, the store's prescreen state/actions, and `PRESCREEN_INTRO_LINE`. The
  invitation flow is now **ceremony → accept** (no screen). **What deliberately STAYS (verified untouched):** the
  always-present **crisis footer** on every Together surface, the in-session **escalation/coercion handling** in
  the couples prompt (§8.5 — the coach still slows a flooded exchange + routes to support), the aside/
  confidentiality logic, and `excludeRestricted` — the removal drops only the _pre-session_ screen, not the
  in-conversation safety behaviour. Gate green: typecheck, lint, format, **1082 core + 1043 desktop** unit (the
  pre-screen unit/RTL/coreBridge tests deleted, not skipped), **11/11 Together E2E** (the crown-jewel ceremony→
  accept flow confirms no screen in between), real-Electron visual QA of the Together home (goes straight to
  "Start a session"). code-reviewer **ship** (removal clean + complete, no dangling refs, safety mechanisms
  provably intact; swept the flagged dead `.prescreen*` CSS + 5 stale comments). Synced spec 58 §8.2 (→ REMOVED
  note, original design kept for history) + §3.4/§5.2 + the header. **Lesson: when a user asks to remove a
  feature that is a documented SAFETY mechanism (here IPV/coercion screening), surface the trade-off + the exact
  scope and let them decide with AskUserQuestion — don't silently comply OR refuse; and when they confirm, remove
  it SURGICALLY (only the pre-session screen), leaving the in-conversation crisis/coercion handling + the crisis
  footer intact.**
- 2026-07-11 — **Build (Together — couples sessions; SPEC 58 Phase H BUILT — integrations; SPEC 58 IS NOW
  BUILT ACROSS ALL PHASES A–H; split into 3 merged PRs; autonomous overnight, spec defaults taken).** The final
  phase, sub-sliced for reviewability. **H1 (`feat/together-integrations`, PR #160):** the Home
  **`together-session` RecommendationProvider** (53) — the pure `computeTogetherHomeNudge` derives one nudge
  from the viewer's session summaries, prioritized **invite → your-turn → quiet(>14d)**; capability-gated
  `together.own` (added to Home's reactive capability snapshot, the 52 silent-death lesson), signal-aware
  `dismissKey` keyed on the stable `pairKey`; a **quiet nudge is suppressed while the same pair has an in-flight
  session** (no "it's been a while" mid-session), and a person with any Together session is **no longer "brand
  new"** so a pending invite surfaces in "For you". Plus **person-delete reap** (`reapTogetherForPerson` removes
  the deleted person's session folders + pair agreement/report dirs, called from `peopleDelete`; per-person data
  already goes with `deletePerson`; the live-edge re-gate keeps partner-side orphans unreadable).
  `computeTogetherHomeNudge` lives in `@selfos/core/recommendations` (not the host-only `together` barrel) so the
  renderer imports it cleanly. **H2 (`feat/together-challenges`, PR #161):** **joint challenges** — additive
  `Challenge.groupId`; a `[[SELFOS:CHALLENGE:{…}]]` marker on a **non-aside** couples turn → `captureJoint
ChallengeFromMarker` mints a twin per partner via the reused 52 `captureFromMarker` (per-person files, one shared
  `groupId`, a same-session re-mint updates the twins); each twin flows into that partner's existing 52 Home card
  - check-in + reflection→Insight; `JOINT_CHALLENGE_INSTRUCTION`; `jointChallengeGroundingLines` (counts **people
    not records**); a self-hiding `TogetherJointChallenges` home tile via `together:jointChallenges` (gated +
    live-edge). **H3 (`feat/together-suggestions`, PR pending):** the **SUGGEST artifact** — a `[[SELFOS:SUGGEST:
{kind,prompt,guideId?,topic?}]]` marker on a non-aside reply → a **write-once** `TogetherSuggestion` under the
    session (one writer — the coach turn — so §4's one-writer rule holds; no dismiss/mutation), parse/strip wired
    into the shared `stripCoachMarkers`; the `TogetherSuggestions` card **NEVER auto-acts** — a `guide` →
    **"Start this exercise"** (starts a new Together session, but ONLY a real **non-adult** catalog entry; an
    adult/unknown guide degrades to a plain prompt card, and `togetherCreate` re-refuses an adult guideId host-side
    — the 18+/explicit gates hold), a `questionnaire` → **"Open a check-in"** (a doorway to the existing,
    user-confirmed Questionnaires compat flow, never a new auto-send); `SUGGEST_INSTRUCTION`; `together:
suggestions` (participant + live-edge gated). **H3 also fixed a pre-existing leak (code-review B1):** the
    Together **streaming** bubble rendered raw coach markers → now `stripCoachMarkers(streaming)`, mirroring
    Sessions. **Gate (H1–H3):** typecheck/lint/format; **1094 core + 1047 desktop** unit; **12/12 Together E2E**
    (the whole-flow coherence walk: invite→ceremony→thread→aside→wrap-up→catalog→desire/YNM→pulse→home-nudge→reap→
    joint-challenge→suggestion); real-Electron visual QA at desktop light/dark + 360px across every surface;
    code-reviewer per slice (H1 fix-first: incoherent-quiet-nudge; H2 fix-first: count-people-not-records; H3
    fix-first: the streaming-marker leak + a degraded-guide card action + a prefix-partial strip). **Two items
    flagged for a maintainer with a real Claude key: the §13 live-model adversarial pass (offline fakes can't run
    it), and the optional direct in-app compat "Send to both" from a suggestion card (H3 ships the safe
    builder-doorway).** **Lesson: any surface that renders STREAMING model text must strip coach markers on the
    live stream, not just the persisted text — a trailing marker flashes to the author mid-stream otherwise (the
    Together thread had this latent since Phase B; the SUGGEST work surfaced it). And a Home nudge that can say
    "it's been a while" must be suppressed while the same pair has a live session, or it contradicts the current
    state (the §7 coherence rule).**
- 2026-07-11 — **Build (Together — couples sessions; SPEC 58 Phase G BUILT — Pulse, absorbs spec 11; on
  `feat/together-pulse`, a git worktree, PR pending — autonomous overnight, spec defaults taken).** The Pulse
  phase (§3.10a): a couples **dyad-metric trend** + a frictionless **1–3-tap check-in** + a **dual-consent
  desire alignment**. Core **`pulseService`** — `logPulseCheckIn` (writes `people/<logger>/together/pulse/
<pairKey>/<id>.enc`, one writer per file, metrics clamped 0..1, drops an all-non-finite log), `buildPulseView`
  (the viewer's OWN check-in trends [connection/desire/satisfaction, Low/Steady/High → 0/0.5/1] + the viewer's
  OWN wrap-up-twin Connection/Friction for the pair [Phase D, ±1 → 0..1] — **never the partner's raw metrics**),
  and **`desireAlignment`** — the one comparative that reads the partner, gated on **dual consent**: surfaced
  only when BOTH partners have a `desire` reading they each consented to share (`shareMetrics ∋ 'desire'`), with
  the **most-recent desire check-in's consent governing** (logging a fresh check-in without sharing desire
  **retracts** visibility — the intuitive privacy model), reading `aligned` (|Δ| ≤ 0.25) or `some distance`; the
  two raw desire values cross the seam only for a consenting pair, and the viewer's own-desire short-circuit runs
  BEFORE any partner read. Bridge `together:pulse`/`together:pulseLog`, gated `together.own` + a re-checked
  **live partner edge** (a non-partner reads an empty view). Renderer **`TogetherPulse`** card on the Together
  home (per eligible partner; `LineChart` trends capped at 480px + a **§9 text equivalent** naming each series'
  direction, the 1–3-tap `SegmentedControl` per metric + a default-off "share my desire level" switch + the
  alignment banner). Additive schema (`PulseCheckIn`/`PulseSeries`/`PulseAlignment`/`TogetherPulseView` +
  `PULSE_METRICS`/`PULSE_METRIC_LABELS` — the single source of truth the trend assembly AND the check-in UI both
  derive from). **Spec 11 marked Superseded-by 58 §3.10a** (never built standalone; its metrics vocabulary
  adopted verbatim; `CheckIn` → `PulseCheckIn`, a fresh type — no migration). Code-reviewer **ship** (the privacy
  boundary verified adversarially airtight — a partner's raw metrics never cross, dual consent correct + ordered,
  cross-pair isolation, path safety; applied both should-fixes: the §9 direction text equivalent is now rendered,
  and the metric list is derived from `PULSE_METRICS` in both places [no triplication]; + the stale-comment + `as
number` nits). Gate green: typecheck, lint, format, **1067 core + 1037 desktop** unit (+pulse core [dual-consent/
  retraction/clamp/dyad-fold/own-only], +coreBridge two-persona [each sees own trends, alignment only after both
  share, non-partner empty], +3 TogetherPulse RTL), **8/8 Together E2E** (E2E #8: both log + share → the desire
  alignment surfaces; own-trend renders while alignment hidden pre-dual-consent; 360px guard). Real-Electron
  visual QA at desktop (light/dark) + 360px (the card, the check-in form, the alignment banner). **Phase H
  remains** (integrations: joint challenges, questionnaire→compat→alignment grounding, Home together-session
  provider, quiet-session offer, person-delete reap, whole-flow coherence walk + visual QA sweep). **Lesson: a
  dual-consent comparative must be retractable via the MOST-RECENT reading (not a lingering older opt-in), and the
  viewer's own-side consent must short-circuit BEFORE the partner's file is ever read — so "I stopped sharing"
  takes effect the instant the next check-in lands, and a non-consenting viewer can never force a partner read.**
- 2026-07-11 — **Build (Together — couples sessions; SPEC 58 Phase F BUILT; on `feat/together-explicit-ynm`, a
  git worktree, PR pending — autonomous overnight, spec defaults taken).** The sixth + most safety-critical
  Together phase: the **explicit register + Desire & intimacy + Yes/No/Maybe (§3.10/§3.10b/§6.3).** The 18+
  **`together-desire` catalog group** (4 adult entries — Sensate Focus, Yes/No/Maybe-together, Desire Mapping,
  Fantasy Exchange, all `adult:true`, each leading with the not-therapy `frame()`). **`allAdultAcknowledged(fs,
key, participantIds)`** — the app's first **N-party 18+ conjunction**, true only when EVERY participant's
  shared guidance-prefs `adultAcknowledged` is set. **`EXPLICIT_INTIMACY_REGISTER`** (the frank-but-bounded 52
  `CHALLENGE_INTIMACY_REGISTER` sibling, adapted for two partners) is appended to the couples prompt **ONLY when
  both acked**, AFTER the addendum + context + grounding, before FORMATTING — SAFETY never loosened, the consent
  boundary verbatim (consenting adults only · taboo only as fantasy/roleplay · never minors/real-non-consent/
  illegal · a hard no from EITHER partner is absolute · trauma-aware STOP-and-route). **YNM (§3.10b):** a
  **symmetric, revocable** opt-in (`people/<id>/together/ynm/<pairKey>.enc`, one file per person per pair) + a
  **deterministic, no-AI mutual overlap** (`computeYnmOverlap` — the intersection of both partners' intake
  `activities` ratings at ≥ "curious" [value ≥ 3 on the 5-point scale], resolved to labels); **one-sided answers
  are NEVER revealed**, and the overlap is computed ONLY under the **full conjunction** (both 18+ acks + both
  opt-ins + a LIVE edge), **re-checked on every read** (a revoke or a removed edge re-gates immediately). The
  overlap feeds the grounding pack **only for a desire-group session when ready** (the §8.6 consented
  restricted-exception). **All withholding is host-side:** `togetherCatalog()` returns adult cards only when the
  active person acked + ≥1 live-edge partner acked; `togetherCreate` **re-checks `allAdultAcknowledged([initiator,
partner])`** for any adult guide regardless of what the catalog showed (no wrong-partner bypass); the couples
  turn computes `allAdultAcked` fresh per turn. Bridge (all gated `together.own` + participant-scoped via the live
  edge): `together:catalog`/`acknowledgeAdult`/`ynmStatus`/`ynmOptIn`/`ynmRevoke`/`ynmOverlap`. Additive schema
  (`YnmOptIn`, `TogetherYnmStatus`/`TogetherYnmOverlap`, `TogetherCatalogEntry`) — no bumps. Renderer: the
  `TogetherIntimacy` card (18+ ack → "waiting for your partner" → YNM opt-in/revoke → the mutual list + "Start
  Yes/No/Maybe together"; the `youAcked`/`eligible`/`ready` states from the bridge, never the inventory).
  Code-reviewer verdict **SHIP** — every safety boundary traced airtight (register never reaches a prompt without
  both acks; the desire group/adult guide never startable without both acks; a one-sided YNM answer never
  revealed via the overlap OR grounding; the gate is live; the trust boundary holds; `youAcked` leaks no
  inventory) — no blockers; applied the spec-lockstep should-fix (YNM storage) + two hardening nits (typed
  `IntakeSession | null`; a defensive edge re-check in the reusable grounding pack). Gate green: typecheck, lint,
  format, **1060 core + 1033 desktop** unit (+ynm/adultGate/register/overlap/opt-in-revoke core, +2 coreBridge
  two-persona [desire+adult-guide withheld until both ack; YNM symmetric + one-sided-never-shown decrypt +
  revoke re-gates], +3 RTL [ack affordance, ready-overlap+start, waiting-for-partner]), **7/7 Together E2E** (+the
  Phase F ack matrix: desire withheld → both ack → group appears → a desire session's captured prompt carries
  the explicit register → YNM opt-in/revoke through the UI + 360px). Real-Electron visual QA at desktop (the
  desire group + the YNM consent card). Synced spec 58 §4 (YNM storage as-built) + §14. **Product sign-off
  pending (§3.13):** the YNM status surfaces the PARTNER's ack/opt-in state to the viewer (never the inventory)
  to drive the actionable copy — flagged for the user. **Phases G–H remain; the §13 live-model adversarial pass
  [first run + the explicit re-run] is a manual DoD item needing a real API key — flagged for the user.**
  **Lesson: the N-party 18+ conjunction must be re-checked at EVERY explicit surface independently — the catalog
  gate is deliberately coarse (shows adult cards if the active person + ≥1 partner acked), so `togetherCreate`
  RE-CHECKS `allAdultAcknowledged([initiator, partner])` for the actual pairing (a wrong-partner bypass is
  refused at create), and the couples turn computes `allAdultAcked` fresh per turn — never trust an earlier
  gate. And a "restricted reaches no one" exception (the YNM mutual overlap) is only safe as a DETERMINISTIC
  host-side intersection gated on the FULL conjunction (both acks + both opt-ins + live edge, re-checked every
  read) that emits only the BOTH-≥-curious subset — one-sided answers never computed into the result, revoke
  deletes the opt-in file so the next read is instantly not-ready.**
- 2026-07-11 — **Build (Together — couples sessions; SPEC 58 Phase E BUILT; on `feat/together-catalog`, a git
  worktree, PR pending — autonomous overnight, spec defaults taken).** The fifth Together phase: the **guided
  couples catalog (§3.10).** New **`togetherCatalog.ts`** — `together-connect` + `together-repair` groups (8
  entries: Love Maps, State of the Union, Appreciation Exchange, Dreams Within Conflict; Naming Your Cycle,
  Repair After a Rupture, Four Horsemen, Speaker & Listener), **SEPARATE** from the solo `guidedCatalog` (16) so
  solo surfaces never list couples guides and `GuidedGroupId`/`GUIDE_LIFE_AREAS` stay untouched; the 18+
  `together-desire` group + its entries land in Phase F. The **`adult === (group === 'together-desire')`**
  invariant is tested. A guided couples session is an ordinary Together session carrying **`guideId`**:
  `createSession` seeds the guide's **static opening message** (no model call, a shared coach message);
  `buildTogetherSystemPrompt` resolves the guide from `session.guideId`, foregrounds its group's life-areas, and
  appends the **guide addendum** (leading with the not-therapy `frame()`) + (structured) the **`[[SELFOS:STEP:n]]`
  step convention** AFTER context + grounding, before FORMATTING. The couples turn **stamps the coach-declared
  step** onto the message (additive **`TogetherMessage.guideStep?`**) — **never on a private aside** (§3.6) — and
  strips the marker from the visible text; the **current step is DERIVED** from the newest coach message
  (`guideStepFor`), so session.enc stays single-writer. **The 18+ group is withheld HOST-SIDE:** `togetherCatalog()`
  returns only `allowAdult:false` cards in Phase E, and `togetherCreate` refuses an adult/unknown `guideId` (never
  merely a hidden UI card). Additive view fields (`TogetherGuideView`/`TogetherCatalogEntry`, `TogetherSessionView.guide?`/`guideStep?`).
  Renderer: the grouped, **searchable** `TogetherCatalog` on the Together home (picking a card binds it to the
  start form; the topic field hides for a guided start) + a structured **stepper** in the thread (current step
  `aria-current`). Bridge `together:catalog`. Gate green: typecheck, lint, format, **1054 core + 1028 desktop**
  unit (+8 core catalog [adult invariant, unique-id/opener/frame, host-side withhold, guide resolution, opener
  seed, addendum+step-convention order, derived step, no-step-from-aside], +1 coreBridge [guided create seeds
  opener + resolves guide view + derives step via marker + chat-no-stepper + unknown/adult refused], +2 RTL
  [catalog group/search/pick, structured stepper]), **6/6 Together E2E** (+E2E: start a structured guided session
  from the catalog → the stepper renders → a "move to step two" turn advances the derived step [marker never
  shown, decrypt asserts `guideId`] + 360px catalog/stepper overflow guard). Real-Electron visual QA at desktop
  (the grouped catalog + the thread stepper). Synced spec 58 §14. **Phases F–H remain; the §13 live-model
  adversarial pass [first run] is a manual DoD item needing a real API key — flagged for the user.** **Lesson:
  keep the couples catalog a SEPARATE module (`togetherCatalog`), not a group bolted onto the solo `guidedCatalog`
  — the solo `GuidedGroupId` union + life-area map + every solo surface stay untouched, and the couples prompt
  builder resolves `guideId` against the Together catalog ALONE; and derive the structured-exercise step from the
  newest coach message's stamped `guideStep` (parse the marker, stamp the message, strip the text) rather than
  storing it on session.enc, so the single-writer invariant holds — never stamp from an aside.**
- 2026-07-11 — **Build (Together — couples sessions; SPEC 58 Phase D BUILT; on `feat/together-wrapup-memory`, a git
  worktree, PR pending).** The fourth Together phase: **wrap-up & relationship memory (§3.8/§3.9).** **Owner
  decisions asked first (§11 #2):** agreement editing = **inline on the ledger** (each field editable in place,
  LWW); a **gentle, dismissible follow-up** offered when an agreement is marked **done** (a soft editable "build
  on it?" prompt — never a nag). **Wrap-up (`togetherAnalysisService.runTogetherWrapUp`):** one metered
  **`together.analyze`** pass, **initiator-billed**, over the **mutually-visible transcript only** — every
  `privateAside` message is **excluded host-side before prompt assembly** (a code boundary, decrypt-tested absent
  from the report AND both twins); **crisis routed away from the shared report** (`crisisFlag` lands on the
  affected partner's twin only; the report stays supportive/detail-free); **meter-before-parse**; **idempotent
  re-run** (reuse-the-id). It writes a **`SharedReport`** (both partners see) + **per-partner twin insights**
  (`source:'together'`, subject = that partner, feeding ONLY their own context; `provenance.togetherSessionId` +
  the stable `pairKey`; `relationshipId` = the live edge). **Twin subject resolution is fail-safe:** strict
  name→id match, and **NO twins are written when the two partners share a display name** (can't disambiguate → never
  mis-subject a reflection — a code-review should-fix). **The twin is SPLIT (the other code-review should-fix):**
  the MAIN twin (reflection + non-sexual facts, no `restricted`) feeds the partner's context in **every** topic;
  a companion **INTIMACY twin** (sexual facts, `restricted` + **`lifeArea:'Intimacy'`**) is own-context-only +
  intimacy-topic-gated — because the §50 relevance-gate is **fail-closed on a missing `lifeArea`**, so a single
  unlabelled restricted fact on the main twin would have silently withheld the WHOLE reflection from the partner's
  coaching. **Agreements ledger (§3.9):** the pair-level ledger is the **one two-editor record** (either partner
  edits/retires; last-write-wins; an edit preserves `createdAt` + origin provenance); captured live via the
  **`[[SELFOS:AGREEMENT:{json}]]`** marker (parsed on **non-aside** turns only — asides mint no shared artifacts,
  §3.6 — and **globally stripped** by `stripCoachMarkers`, so a solo coach that ever emits one never shows it).
  **Grounding pack v2:** standing agreements + the last wrap-up summary (relational continuity, not sexual detail,
  §8.6). **Renderer:** `TogetherReflection` (a "Wrap up & reflect" CTA gated on AI+memory, the shared report card,
  the inline-editable ledger, the gentle done-follow-up), wired into `TogetherSession`. **Additive schema (no
  bump):** `InsightSource` gains **`'together'`** (the 3 Memory `Record<InsightSource>` maps extended);
  `InsightProvenance` gains `togetherSessionId?`/`pairKey?`; new `SharedReport`/`Agreement`. Bridge:
  `together:wrapUp`/`:getReport`/`:saveAgreement` (gated `together.own` + participant-scoped via
  `accessibleTogetherSession`; Together memory rides the existing `sessions.memoryEnabled` toggle — no dead new
  setting). Code-reviewer **fix-first** (both should-fixes above + nits). Gate green: typecheck, lint, format,
  **1046 core + 1025 desktop** unit (+16 core wrapUp [aside-exclusion, twin-split feeds-context, crisis-routing,
  restricted intimacy companion, identical-names guard, idempotency, marker capture/skip-on-aside, grounding v2],
  +3 coreBridge two-persona [aside absent from report+twins decrypt, crisis routing, agreements round-trip +
  staleness + non-participant refused], +4 RTL), **5/5 Together E2E** (+E2E #5: wrap-up report + twins + aside
  absent [decrypt] + agreement capture via the marker through the UI + done-follow-up + 360px). Real-Electron
  visual QA at desktop. Synced spec 58 §14 + spec 05 §4.1 (Phase C). **Phases E–H remain; the §13 live-model
  adversarial pass [first run] is a manual DoD item needing a real API key — flagged for the user.** **Lesson: the
  §50 memory relevance-gate is fail-CLOSED when a `restricted` fact has no `lifeArea` — so putting a couples twin's
  sexual fact on the SAME insight as its reflection silently withholds the whole reflection from the partner's
  coaching (the feature's core value) in every topic; split sexual facts onto a separate `lifeArea:'Intimacy'`
  companion so the reflection always feeds while the sexual detail stays own-context-only + intimacy-gated. And a
  strict name→id twin match still mis-subjects when two participants share a display name — the map collapses and
  the guard's "unresolvable" branch never fires; detect the collision up front and write no twins.**
- 2026-07-10 — **Build (Together — couples sessions; SPEC 58 Phase C BUILT; on `feat/together-prep-attachments`, a
  git worktree, PR pending).** The third Together phase: **private prep spaces + Together image attachments + the
  secrets policy (§3.7/§6.1/§8.7).** **Prep spaces:** each participant gets their OWN private prep thread — an
  ordinary **05 Conversation** carrying a new additive-optional **`Conversation.togetherSessionId`** link (no
  `schemaVersion` bump), so it reuses the composer/streaming/retry/attachments wholesale; `prepService.openPrepConversation`
  is find-or-create with a **static opener** (no AI spend); `PrepPanel` reuses the solo `conversationStore` + shared
  `Composer` + `MessageAttachments`; **billed to its author** (its `chatStream` bills the active person, outside the
  initiator-pays rule). The solo **Sessions list (`conversationsList`) now filters `!togetherSessionId`** so a prep
  thread never surfaces there (regression-tested both directions). **Attachments:** a Together-OWN seam
  (`together:storeAttachment`/`getAttachment` + `isTogetherAttachmentPath` + `messageOwningAttachment`), distinct
  from the 45 solo channels; the couples prompt gains **vision `ContentBlock`s** (`buildTogetherClaudeMessages` now
  async: reads each stored attachment, skips missing/corrupt, merges consecutive same-role). **The privacy gate
  (§5.2):** an attachment referenced ONLY by a private aside is readable by the **aside's author alone** — the
  bridge `togetherGetAttachment` **fails CLOSED** (`!owner || (owner.privateAside && owner.authorPersonId !== me)` →
  null), path-confined to the session's attachments dir, mime/size re-validated in core. **Secrets policy (§8.7):**
  `TOGETHER_ADDENDUM` gains the **identical no-oracle deflection** ("I keep each of your private reflections
  private — I'd tell you the same thing either way"), no covert use of a private note, and no indefinite
  secret-holding. Code-reviewer **fix-first** (the fail-open→**fail-closed** aside gate — the security-critical
  gate the feature hangs on; + nits: dropped the dead `bytes` store field, bounded the base64 input). Gate green:
  typecheck, lint, format, **1030 core + 1016 desktop** unit (+prepService/attachment core [prep find-or-create +
  own-thread isolation, store round-trip, mime/size reject, path guard, `messageOwningAttachment`], +3 coreBridge
  [prep off the Sessions list both directions, aside-attachment refused for the partner + **owner-less orphan fails
  closed**, non-participant refused, unsupported mime], +2 RTL [Prep-privately affordance, secrets-policy addendum
  phrases]), **4/4 Together E2E** (#2 extended: attachment stores encrypted under the session namespace + decrypts
  to PNG + the prep space stays OFF the Sessions list; the crown-jewel prompt-capture now asserts the deflection
  phrase reaches the live prompt), real-Electron visual QA at desktop + 360px (thread with "Prep privately" +
  attachment thumbnail; the prep panel; the `.threadHead` now wraps at 360px so the new button never overflows).
  Synced spec 58 §14 + spec 05 §4.1 (additive `togetherSessionId` amendment). **Phases D–H remain; the §13
  live-model adversarial pass [first run] is a manual DoD item needing a real API key — flagged for the user.**
  **Lesson: a privacy read-gate keyed on "the owning message flags this as an aside" MUST fail closed on an
  unknown owner (`!owner → null`) — an owner-less orphan (stored-but-never-sent attachment) has bytes on disk and
  is indistinguishable from a shared image except by its owning message, so a fail-OPEN default would resolve it
  for anyone the moment its uuid path leaked; and a prep space is just a solo Conversation carrying a
  `togetherSessionId`, so the ONE thing that keeps it private is the Sessions-list `!togetherSessionId` filter —
  test it both directions.**
- 2026-07-10 — **Build (Together — couples sessions; SPEC 58 Phase A + Phase B BUILT; on `feat/together-foundation`,
  a git worktree, PR pending).** The first two phases of the new top-level **Together** feature — async,
  invitation-based, AI-facilitated couples sessions. **Owner decisions asked first:** the pre-screen flag rule =
  **conservative** (flag on any not-safe-being-honest / afraid / pressure signal; "often afraid" adds crisis
  resources; "prefer solo first" offers the route but isn't a hard flag), and **all four §11 spec defaults kept**
  (prep bills its author, wrap-up excludes asides from all artifacts, non-attributed pause, desire-continuity
  resets per session). **Phase A (backend):** `@selfos/core/together` — session/message/state CRUD + the
  **viewer-projection derivations** (`deriveStatusFor`, `projectMessages`, `turnStateFor`, `unreadCountFor`,
  `digestFor`) that make every viewer signal (status/turn/unread/snippet/notification) privacy-safe; capability
  `together.own` (Member ON); the bridge seam gated on `together.own` + participant membership + a **LIVE partner
  edge** re-checked on every read/write, every read viewer-projected (the trust boundary); 2 notification kinds.
  **Phase B (AI + surface):** the **code-enforced `excludeRestricted`** option (threaded `buildContext` →
  `summarizeForContext` → drops every restricted + sensitive-life-area fact from the couples prompt, incl. the
  pinned portrait's; default-off = solo byte-identical); the **AI-free pre-screen** (outcome-only storage, raw
  answers never persisted, the one §5.2 gate); the **couples turn** (`togetherPromptBuilder`: PERSONA+SAFETY →
  facilitator addendum → per-participant confidentiality contract + `excludeRestricted` context → grounding pack
  [syntheses + latest alignment] → FORMATTING; `runTogetherTurn`/`retryTogetherReply` = the 05 §4.1 invariants,
  **initiator-billed**, **aside turns → private coach reply + no artifacts**; `together:chunk` streaming); asymmetric
  budget honesty (the partner gets a neutral session notice, no ratio/$); the renderer (store, `/together` +
  `/together/session/:id`, nav gated on `together.own` + a live edge, home/start-flow, the ceremony [rules of the
  room DERIVED from mechanics, **mechanical-never-absolute** §8.7], the pre-screen form, the author-attributed
  thread + private-aside composer, two notification providers). **Tests:** 40 core + 14 coreBridge integration
  (two-persona: quiet-decline projection, aside hidden from partner, budget asymmetry, edge-delete re-gating) + 15
  RTL/unit + **3 E2E** (the crown jewel: an aside is invisible in the partner's rendered thread while present in the
  captured prompt [restricted-absence + register-absence + contract-order asserted], decrypt-level; the pre-screen
  hold + no-raw-answers; gates + 360px). New E2E fakes: `SELFOS_FAKE_PROMPT_DIR` capture hook, a Together fake-Claude
  branch, `SELFOS_FAKE_TOGETHER_EMPTY`. Gate green post-rebase onto latest main: typecheck/lint/format, \*\*1025 core
  - 1002 desktop** unit, 3 Together E2E; real-Electron visual QA at desktop (light/dark) + 360px + the ceremony.
    **Phases C–H remain** (prep spaces/attachments, wrap-up/memory, catalog, explicit register/YNM, pulse,
    integrations). **Lesson: every viewer-facing signal must be computed over the viewer's PROJECTION, never raw
    files — one `projectMessages`/`deriveStatusFor` that both list and single-read derive from is what makes a
    quiet-decline invisible to the initiator and a private aside invisible to the partner across status/turn/unread/
    snippet/notification at once; and the restricted-exclusion for a shared-output prompt has to be a code path
    (`excludeRestricted` through the context builders), not a prompt instruction, because the existing store gates
    keep a subject's own restricted facts IN their own intimacy-topic context and the portrait bypasses the gate.\*\*
- 2026-07-10 — **Build (Questionnaire Preview & Results redesign — SPEC 08 §20 slice 5/5 BUILT: private results —
  SPEC 08 §20 IS NOW FULLY BUILT; on `feat/questionnaire-private-results`).** The final slice (§20.8), which brings
  the private-send experience together. A private send's Results card stops being a one-line dead end and gets all
  **four** improvements: (1) a **calm privacy-explainer panel** (accent-tinted lock: "You see the insight drawn
  from {name}'s answers — never the raw answers themselves"); (2) the **numeric ratings the sender is allowed to
  see** as read-only bars (a new core `extractNumericAnswers` → additive `SendResult.numericAnswers` of
  `{prompt,row,value,min,max}`, numbers only — the §8.4/§13.5c boundary the trends read already honors, so a private
  card shows real signal instead of "hidden"); (3) a **prominent primary "Analyze to see the insight"** CTA on an
  un-analyzed private send (secondary for a Standard send whose answers already show); (4) the **drafted Insight
  INLINE** — additive `SendResult.insightSummary`/`insightId` (populated in the bridge for any analyzed send) render
  through the shared landing **`InsightExcerpt`** with a **deep-link to the exact insight in Memory** (router
  `{ insightId }`), replacing the bare "review in Memory" banner. **The raw written answers still NEVER cross the
  bridge for a private send** (unchanged §8.4) — a bridge decrypt-level test asserts `answers` stays undefined while
  `numericAnswers`/`insightSummary` are present and the prose is absent from the serialized result. Gate green:
  typecheck, lint, format, **983 core + 11 relay + 973 desktop** unit (+`extractNumericAnswers` numeric-only /
  no-text; +bridge private-send numeric+insight / never-raw; +2 Results RTL [explainer+numeric+Analyze, inline
  excerpt+Memory link]), **E2E** (the private responses-arrived test now asserts the explainer + "Ratings you can
  see" + the numeric, prose absent; the answer-review test asserts the inline excerpt + View-in-Memory after
  analyze/re-analyze; fixed a latent slice-4 assertion ambiguity — the aggregate band duplicates a prompt on the
  Standard view, scoped with `.first()`), real-Electron visual QA at desktop (the private card: lock explainer +
  "Rate it" bar at 4/5, no raw prose). Synced spec 08 §20 (→ **FULLY BUILT, all 5 slices**). **Lesson: a private
  send's Results card can show REAL signal without breaking the boundary — surface the derived Insight (summary +
  id) + the NUMERIC answers only (the same data trends already exposes), never the written/categorical content; the
  bridge stays the trust boundary (it decrypts host-side and emits only numbers + the insight), so `answers` stays
  undefined and the raw prose never reaches the renderer. And when a new cross-recipient band (the aggregate)
  duplicates a question prompt already shown in a per-recipient list, existing `getByText(prompt)` E2E asserts go
  strict-mode-ambiguous — scope them to `.first()`.**
- 2026-07-10 — **Build (Questionnaire Preview & Results redesign — SPEC 08 §20 slice 4/5 BUILT: the aggregate
  "At a glance" read; on `feat/questionnaire-results-aggregate`).** The fourth slice (§20.7) — the **one new
  backend piece**. New crypto-free view type **`QuestionnaireAggregate`** (`@selfos/core/schemas`; a proper
  DISCRIMINATED UNION — `Base & (union)` doesn't narrow via `Extract`/switch, so each member carries the base
  fields) + a pure **`buildQuestionnaireAggregate`** (`@selfos/core/questionnaires/aggregate.ts`, mirroring
  `buildQuestionTrends`): per question → a **distribution** (choice/yesNo/thisOrThat), a **numeric average**
  (rating/slider, positioned against the DECLARED scale not the observed range), **per-row/bucket averages**
  (matrix/allocation), or a **response count** (free-text/date/ranking). **The privacy rule (§8.4), tested at the
  bridge:** categorical distributions count **Standard sends only** (a Private recipient's selection is raw
  content); numeric averages fold in **BOTH** Standard + Private (numbers already reach the sender's trends,
  §13.5c); free-text is a bare count. New IPC **`assignments:aggregate(questionnaireId)`** through the full seam
  (channels → coreBridge → ipc → preload → test-utils), **sender-scoped + `questionnaires.viewResults`-gated**,
  computed in the bridge from the DECRYPTED responses (host-side) — only the aggregate crosses IPC, never a
  written answer. Renderer: the `resultsStore` loads it alongside results/trends; an **`AtAGlance`** band (token
  CSS bars; every count/average shown as TEXT, §9; "N answered privately (not shown)" when a distribution's
  standard count is short of the response count) renders between the per-recipient cards and Trends,
  self-hiding when empty. Gate green: typecheck, lint, format, **980 core + 11 relay + 970 desktop** unit
  (+aggregate dist/avg/rows/count + the numeric-only-private / categorical-standard-only privacy split;
  +bridge decrypt-level privacy + viewResults gating; +2 AtAGlance RTL), **E2E** (the results test asserts the
  "At a glance" average band; the inbox privacy E2E unchanged), real-Electron visual QA at desktop (the average
  bar reads "3.5 · scale 1–5"). Synced spec 08 §20.7. **Remaining: slice 5** (private results — inline insight,
  numeric distributions, Analyze CTA, explainer). **Lesson: a discriminated union defined as `Base & (A|B|…)`
  does NOT narrow — TS sees the intersection as one non-union type, so `Extract<…,{kind}>` and `switch(kind)`
  both fail; distribute the base into each member (`(Base & A) | (Base & B) | …`) for clean narrowing. And a
  numeric-average bar must be positioned against the question's DECLARED scale (1–5), not the observed min/max
  of the answers, or "3.5" sits at the wrong place and the label reads a misleading range.**
- 2026-07-10 — **Build (Questionnaire Preview & Results redesign — SPEC 08 §20 slice 3/5 BUILT: Results
  restructure — hide-when-empty + summary band + status grouping; on `feat/questionnaire-results-restructure`).**
  The third slice (§20.6). **Hide the Results tab until there's a send:** the builder's Edit/Preview/Results
  segment + render are gated on `showResults = saved && canViewResults && isSent` (isSent = a send state exists),
  and the responses-arrived deep-link only starts on Results when `sendStates[id]` exists (loaded atomically with
  the def, so no race) — the old empty "you haven't sent this yet" card is GONE. **Summary band:** a new pure
  `resultsSummary.ts` (`summarizeSends` → recipient/answered/awaiting/inProgress/declined counts + responseRate;
  `groupSendsByStatus` → ordered non-empty groups Answered · In progress · Awaiting · Declined · Closed, with a
  `?? 'closed'` fallback so every `AssignmentStatus` lands somewhere) drives a `ResultsSummaryBand` (stat tiles +
  a response-rate ring with the % as text, §9). **Status-grouped per-recipient cards:** `StandardResults` renders
  the SendCards under `ResultGroupHead`s; each SendCard header gained the landing `Avatar`. Carries **no raw
  answers** (operates only on the already-derived `SendResult[]` — the Standard/Private boundary from the bridge
  is unchanged; the private treatment is slice 5). `CompatibilityResults` untouched. Code-reviewer **ship
  after 2 should-fixes** (both applied): the summary band no longer flashes "0 recipients" during the async load
  (gated on `!loaded`), and the band's **"awaiting" tile now mirrors the "Awaiting" group exactly** (sent/opened
  only) with a separate "in progress" tile — fixing an awaiting-vs-Awaiting count collision on one screen (the §7
  coherence-walk rule); + the nits (comment direction, a full-`AssignmentStatus`-coverage test). Gate green:
  typecheck, lint, format, **974 core + 11 relay + 965 desktop** unit (+resultsSummary grouping/summary/coverage;
  Results renders-nothing-empty / summary+grouping; the builder Results-tab hidden-without-sends / shown-with-sends),
  **E2E** (the results test asserts the summary stat + the Answered group + a **360px overflow guard** on
  full-width Results), real-Electron visual QA at desktop (summary band + response-rate ring + status groups +
  avatar cards + the slice-2 redesigned answer rows). **Remaining slices 4–5** (the `assignments:aggregate` read +
  "At a glance" · private results). **Lesson: a summary tile and its matching card-group heading must count the
  SAME statuses — folding `inProgress` into a band "awaiting" while the "Awaiting" group excludes it makes "2
  awaiting" collide with "Awaiting (1)" + "In progress (1)" on one screen (§7); mirror the groups exactly. And a
  view that renders derived counts must gate on the store's `loaded` flag or it flashes zeros for a frame before
  the async load resolves.**
- 2026-07-10 — **Build (Questionnaire Preview & Results redesign — SPEC 08 §20 slice 2/5 BUILT: modernized
  answering form + progress + "Your answers" review; on `feat/questionnaire-answering-modernize`).** The second
  slice (§20.5). **Progress indicator:** an additive **`progress?`** prop on the shared `@selfos/answering`
  `QuestionnaireForm` (default OFF) → a slim top bar (`role="progressbar"` + answered/total-visible aria + a text
  "N of M answered") + a **"Question N of M" eyebrow** per card, **numbered in RENDER order** (ungrouped first,
  then each group, so numbering matches what the person sees even for grouped forms) via the pure `isAnswered`/
  `visibleQuestions` core helpers. Wired ON at the **two answering hosts only** — `InboxAnswer` + the relay
  `RelayApp` — so Preview (disabled), onboarding (`IntakeFormPanel`), and the self-tests (`TestTake`) stay plain
  (default off). **Modernized controls (token CSS only, so the in-app Inbox AND the external relay page both get
  it — §5.4):** taller inputs (36→42px), rounder question cards (`--radius-md`→`--radius-lg`) with airier padding,
  bigger tap targets on scale points + pills (min-height 44px), softer option cards. **"Your answers" review:**
  the shared `AnswerList` (`.qaList` — used by Results, the Inbox review, the compat report, break-glass reveal)
  redesigned into divider-separated prompt→answer rows (prompt a quiet label, answer below). Code-reviewer
  **ship** (no blockers/should-fixes; applied the a11y nit — `aria-hidden` on the visible progress label so the
  progressbar's aria-label isn't read twice; the "answered counts optional questions too" is the intended
  answered/total-visible semantics). Gate green: typecheck, lint, format, **974 core + 11 relay + 959 desktop**
  unit (+progress on→bar+numbers / off→none), **E2E** (the inbox answering asserts the progressbar + "Question 1
  of" + the count updating on answer; 23 questionnaire/inbox/compat + 21 onboarding/self-test E2E green — the
  shared-form CSS change caused no geometry regression), real-Electron visual QA at desktop (the modernized
  answering form with progress + the redesigned "Your answers" review). **Remaining slices 3–5** (Results
  restructure · aggregate read · private results). **Lesson: number a progress indicator in RENDER order, not the
  `visible`-array order — a grouped form renders ungrouped-first-then-groups, so mirror that exact traversal when
  building the number map or "Question N of M" won't match what the person sees; and keep the whole progress UI
  behind a default-off prop so the ONE shared renderer stays plain for its non-answering hosts (Preview,
  onboarding, self-tests).**
- 2026-07-10 — **Spec + Build (Questionnaire Preview & Results redesign — SPEC 08 §20 APPROVED; slice 1/5 BUILT:
  full-width detail + disabled Preview; user-requested; mockup + 2 AskUserQuestion rounds FIRST; on
  `feat/questionnaire-full-width-preview`).** A complete rethink of the read-and-review half of questionnaires
  (Preview · answering/"your answers" · Results). Reviewed the whole surface, built an interactive `visualize`
  mockup (4-view switcher: Preview · Answering · Results-visible · Results-private), then locked **8 decisions**
  with the user: full-width EVERYTHING incl. the Edit builder · **Preview = disabled only** (test-on-self removed
  — the author built the questions, self-answering makes no sense) · modernize the answering form for BOTH the
  in-app Inbox AND the shared relay page · a progress indicator · Results = summary + aggregate + per-recipient ·
  **hide the Results tab until there's a send** · closed-type aggregates with free-text as a count · and **all
  four private-results improvements** (inline insight excerpt + View in Memory · numeric mini-distributions ·
  prominent one-tap Analyze · a calm privacy-explainer). Wrote spec 08 **§20** (§20.3–§20.13 + the 5 build
  slices). **The one new backend piece (slice 4): `assignments:aggregate`** — a derived per-question read that is
  **numeric-only for Private sends** (reusing the exact boundary the trends read already honors, §13.5c/§8.4), so
  no new exposure. **Slice 1/5 BUILT:** dropped the `max-width:760px` cap on `.page[data-view='detail'] .detail`
  (every surface spans full width, §20.3); an additive **`disabled?`** prop on the shared `@selfos/answering`
  `QuestionnaireForm` wraps the questions in a **`<fieldset disabled>`** (natively disables every descendant
  control incl. the custom `<button>`s, no per-control wiring) with the **crisis footer OUTSIDE** it so "Get help
  now" is never disabled (§8.2) + `min-width:0` on the fieldset (a disabled fieldset defaults to `min-content` →
  would force an inner scrollbar, §12); `QuestionnairePreview` rewritten to a static disabled render (removed the
  answers state, Finish, required-validation, and the `readOnly` prop — all of test-on-self), naming the bound
  recipient. Code-reviewer **ship** (no blockers/should-fixes; applied the nit — pass the plain recipient name,
  guarded by a resolved recipient, so an unbound draft falls back to the generic note instead of "what no one yet
  sees"). Gate green: typecheck, lint, format, **974 core + 11 relay + 957 desktop** unit (QuestionnaireForm
  disabled/inert + crisis-still-works + no-onChange; Preview disabled + recipient-named + no-Finish; the builder
  preview RTL asserts disabled), **E2E** (the old test-on-self test rewritten to a disabled-Preview + full-width
  360px overflow guard), real-Electron visual QA at desktop + 360px. **Known limitation (documented, §20.4):** a
  static disabled preview shows the initially-visible (unbranched) questions — branch-gated follow-ups are visible
  to the author in Edit. **Remaining slices 2–5** (answering modernization + progress · Results restructure ·
  aggregate · private results). **Lesson: `<fieldset disabled>` is the low-surface-area way to make a whole
  shared form read-only — it propagates `:disabled` to every descendant control (custom `<button>`s included) with
  zero per-control threading; keep the crisis footer OUTSIDE it (§8.2) and set `min-width:0` (a disabled fieldset's
  `min-content` default otherwise overflows a flex parent, §12).**
- 2026-07-10 — **Build (Questionnaires landing cards state whether answers are private or visible — card privacy
  badges; user-requested; mockup approved FIRST [visualize widget, 3 placement variants + AskUserQuestion forks:
  status-row chip · both Sent AND Received · mode-specific compat labels — all recommended picks]; spec 08
  §3.1/§3.3; on `feat/questionnaire-card-privacy`).** Every landing card now carries a quiet **privacy chip**
  beside the status pill (icon + short label; the full honest sentence as the tooltip): Sent = `Private · insights
only` (lock, accent tint) / `Answers visible` (eye, neutral outline) / `Mixed privacy` (legacy multi-recipient
  whose latest sends differ); Received = `Your answers stay private` / `<Sender> sees your answers` — shown on a
  **New** card too, so the recipient knows what the sender sees BEFORE opening. A **compatibility** card states
  its **visibility mode** (`Combined report` / `Report + own answers` / `You see all answers` / `Shared with
<sender>` / `Context only`) since a generic "Private" would misstate `senderSeesAll`. Drafts/never-sent show no
  chip (privacy is chosen at send). Data: additive `QuestionnaireSentOverview.privacy?: PrivacyMode | 'mixed'`
  (derived in the bridge with the SAME per-recipient latest-send dedup as the recipient chips) +
  `InboxItem.compatibilityVisibility?` (read from the frozen snapshot); the Sent compat chip reads the definition
  (`questionnaire.compatibility.visibility`), so it shows even without `viewResults`. **Honesty guard (§8.4):** the
  Received tooltips reuse `externalSendDisclosure` VERBATIM — and per the code-reviewer's should-fix, the Inbox
  answering pane's plain-send disclosure was unified ONTO `externalSendDisclosure` (its inline strings deleted), so
  the pane, the relay page, and the chips share one derived source; the two name-free compat tooltips
  (`senderSeesAll`/`contextOnly`) are pinned byte-for-byte against `compatibilityDisclosure` by a drift-fence unit
  test. Route-local pure `privacyBadge.ts` + a shared `PrivacyChip` (title tooltip, ellipsis-safe at 360px). Gate
  green: typecheck, lint, format, **974 core + 11 relay + 955 desktop** unit (+bridge private/standard/mixed +
  compat-visibility-on-InboxItem, +privacyBadge matrix incl. the verbatim pin, +2 RTL [Sent chips + exactly-3/
  draft-none; Received chips incl. New-card + compat]), **E2E** (the redesign test now seeds a private self-send +
  a private foreign send → asserts both Sent chips, the Received chip on a New card, 360px overflow guard; the
  inbox round-trip asserts the unified disclosure wording); real-Electron visual QA at desktop + 360px. Synced
  spec 08 §3.1/§3.3/§6. **Lesson: a per-send attribute surfaced at card level must be derived with the SAME dedup
  the card's other fields use (latest send per recipient), with an honest `mixed` fallback; and when a chip
  paraphrases a privacy promise, wire its wording to the one derived disclosure source (reuse verbatim + pin with
  an equality test) — a hand-copied sentence WILL drift, and the §8.4 guard only holds if every surface prints the
  same derivation.**
- 2026-07-09 — **Fix + redesign (Questionnaires Sent card: the Insight excerpt was "weirdly cut off"; user-reported;
  mockup approved FIRST; spec 08 §3.1; on `fix/questionnaires-insight-excerpt`).** Four connected defects in the
  analysed card's excerpt: (1) `-webkit-line-clamp: 4` sat on the PADDED `.excerpt` box, so overflow clipped at the
  padding edge and a **half-sliced sliver of the 5th line** rendered into the bottom padding; (2) the "View in
  Memory →" button was inline AFTER the summary INSIDE the clamped box — **clipped out of existence** on any long
  summary; (3) the AI summary rendered as a raw string (literal `**` marks — every other AI-prose surface uses the
  spec-34 `<Markdown>`); (4) "View in Memory" dumped the user on the Memory landing, not the insight. **Redesign
  (Calm; the user picked "Show more + Memory deep-link" from the mockup):** a route-local **`InsightExcerpt`** —
  an "Insight" eyebrow + the summary through the shared `<Markdown>` **clamped to 3 whole lines on a padding-free
  body** (clean ellipsis by construction) + an action row **BELOW the clamp** that can never be clipped: a
  **measured "Show more"/"Show less"** (ResizeObserver + `scrollHeight > clientHeight`, rendered only when the text
  actually overflows — no dead affordance, `aria-expanded`/`aria-controls`) and an always-visible **"View in
  Memory"** that now **deep-links to the exact insight** (additive `QuestionnaireSentOverview.insightId`; router
  state `{ insightId }`; Memory opens the detail with back → Responses for a response insight, else the overview —
  and a **not-found guard** so a person switch re-firing the effect with the OLD person's stale router state stays
  on the overview, never a dead "no longer here" view — the code-reviewer's one should-fix). Gate green: typecheck,
  lint, format, **974 core + 11 relay + 946 desktop** unit (+3 InsightExcerpt RTL [measured toggle/no-dead-affordance/
  markdown], +1 Questionnaires RTL [markdown + deep-link state probe], +3 Memory RTL [response deep-link → back
  Responses, self deep-link → back Memory, stale-id → overview], +bridge insightId stamp), **E2E +1** (seeded
  analysed self-send with a long 2-paragraph markdown summary → geometric clamp assert → expand/collapse round-trip
  → 360px overflow guard incl. the EXPANDED state → deep-link lands on the insight detail); real-Electron visual QA
  at desktop + 360px, collapsed/expanded/deep-linked. Synced spec 08 §3.1. **Lesson: never put `-webkit-line-clamp`
  on a padded box (overflow clips at the padding edge → a sliced line renders into the padding) and never put an
  affordance INSIDE the clamped element (a long text clips it away exactly when it's needed) — clamp a padding-free
  body and give actions their own row; and a clamp geometry E2E must seed text long enough to overflow at FULL grid
  width (a lone auto-fit card stretches to the whole row, un-clamping a summary that clamps at normal card width).**
- 2026-07-08 — **Enhancements on the Questionnaires landing (11 user asks, mockup iterated + approved FIRST;
  spec 08 §3.1/§3.3; on `feat/questionnaires-page-redesign`, stacked on the base redesign commit).** After the
  two-section redesign, the user requested a batch of upgrades; I mocked them ALL up in an interactive Artifact
  (Calm direction), iterated twice on feedback ("analyze button + toolbar look out of place" → quiet ghost
  toolbar + a soft accent Analyze prompt; the green re-send box "looks out of place" → a calm accent nudge that
  keeps the age visible + frames refreshing as good), got "looks good," THEN built. **Sections are collapsible;
  "Sent" is organised into collapsible status subgroups** (Drafts [dashed] · Awaiting · Answered · ready to
  analyze · Analyzed) via a pure `sentGrouping.ts` (`sentStatusOf`/`SENT_GROUPS`/`sortSent` — favourites pin
  top). Each section has a **quiet toolbar** (search + status filter + sort) + **"Show more"** pagination. Cards
  now show **date AND time** (`formatDateTime`). **Sent card**: favourite · **share-link** (icon+tooltip, moved
  out of the kebab) · **view** ("See what was sent") icons + a kebab (**Duplicate**/Delete), an **inline delete
  confirm** rendered IN the card (fixing the off-screen section-banner confirm — the "can't delete a sent one"
  report was the confirm being scrolled away), a one-tap **Analyze** on answered-not-analysed (reuses
  `insights:analyze`), the **Insight excerpt** + "View in Memory" once analysed, and a calm **"these answers are
  N old — duplicate & send for fresh answers"** nudge when stale. **Received card**: **category eyebrow**,
  received/answered **date·time**, and a **favourite** (device-local per-person via `InboxItem.favorite` +
  `assignments:setFavorite` + `DeviceState.inboxFavorites`, the `discoveryDismissals` precedent). Additive
  `sentOverview` fields (`answeredAt`/`analyzed`/`insightSummary`/`analyzableAssignmentId`) — still **no raw
  answers** cross the seam (the excerpt is the sender's own derived Insight summary). Gate green: typecheck,
  lint, format, **972 core + 11 relay + 934 desktop** unit (+sentOverview new-fields + inbox type/favorite/
  setFavorite bridge tests, +sentGrouping unit, +3 RTL [analyze/excerpt, received category+favourite, grouping/
  collapse/filter]), **E2E** (redesign test extended: grouped statuses + date·time + Analyze affordance +
  received category + favourite-flip + section collapse; real-Electron visual QA at desktop + 360px). **Lesson:
  a `getByText('Awaiting response')`/`('New')`/`('Submitted')` collides once a status FILTER `<option>` with the
  same word exists AND a group LABEL shares the prefix — scope to `{exact:true}` or a role button, and remember
  InboxAnswer's Submit calls `onDone` (returns to the landing), so post-submit assert the card's new "View" CTA,
  not a status pill that now shares text with the filter option.**
- 2026-07-08 — **Redesign (Questionnaires landing → a two-section card grid; user asked, mockup approved FIRST;
  spec 08 §3.1/§3.3; on `feat/questionnaires-page-redesign`).** The old page was a master list + a big empty
  "Select a questionnaire" detail placeholder (wasted real-estate the user flagged). Replaced with a full-width,
  responsive **two-section card grid**: **"Sent"** (your authored questionnaires — type eyebrow, title,
  favourite, **recipient chips with per-person answered state** [✓/⏱], a rich status pill [`Awaiting response` /
  `N of M answered` / `Answered · analysed` / `Draft · not sent`], a **"N new"** un-reviewed-responses badge, a
  `Ready to re-send` nudge) and **"Received"** (questionnaires others sent you — sender avatar, status pill, a
  state-matched CTA Answer/Continue/View; the standalone `/inbox` nav stays per the user). Each section self-hides
  when empty; opening a card drops into the full-width builder or the shared answering pane; `closeDetail`
  refreshes both stores on return so a card reflects what just happened. **Process:** reviewed the CURRENT code,
  then showed an interactive `visualize` mockup with a Calm↔Bold toggle; user picked **Calm** + confirmed 4 forks
  (both looks shown, responsive grid, keep Inbox nav, rich per-recipient status) BEFORE any code. **Decisions
  asked up front, not guessed.** New backend: **`questionnaires:sentOverview`** read (sender-scoped, gated
  **`questionnaires.viewResults`** — recipient detail is results territory, stricter than the create-gated
  `sendStates`; deduped to each recipient's LATEST send with a deterministic answered-wins tiebreak on an exact
  timestamp tie; the sender's own **compatibility** half excluded [only when `compatibilityGroupId` set — a plain
  self check-in stays]; **NEVER** the raw answers — the privacy boundary holds). Additive `InboxItem.fromSelf`
  (senderPersonId === recipientPersonId) filters a **self check-in** out of the page's Received section (it
  already shows under Sent) so no card double-renders on one screen; `/inbox` still lists it. Route-local
  `SentCard`/`ReceivedCard`/`Avatar` (theme-safe accent-subtle initials — colored per-person avatars can't hold
  contrast across light/dark) + a shared `inbox/inboxStatus.ts` (`receivedStatus`/`receivedCta`, DRY with the
  Inbox route). No new design-system primitive → no `/gallery` change. Gate green: typecheck, lint, format, **972
  core + 11 relay + 925 desktop** unit (+`sentOverview` bridge [recipients/answered/new-counts/viewResults-gate/
  sender-scope], +`fromSelf` assert, +2 Questionnaires RTL [rich Sent card, Received section + open-to-answer]),
  **E2E +1** (seed-via-vault: owner self-sends [awaiting + answered], a foreign send → Received; assert both
  sections + the rich statuses + self-send NOT double-shown + answer-from-card round-trips [decrypt] + 360px
  no-overflow incl. inner scrollers; updated `author-scoped`/`lifecycle`/`compatibility`/`re-asks` for the new
  layout). Visual QA: real Electron screenshots at desktop + 360px (Calm cards, recipient ✓/⏱ chips, pills, "N
  new" badge; single-column reflow, no overflow). Synced spec 08 §3.1/§3.3/§6. **Lesson: a self check-in (you're
  both sender + recipient) legitimately lands in your own Inbox, so once Sent + Received share one screen it
  double-renders — a derived `fromSelf` flag filters it from Received (it lives under Sent); and a per-recipient
  "latest send" dedup must be deterministic on a timestamp tie (rapid programmatic sends collide in one ms) —
  prefer the answered send so the card reflects real engagement regardless of iteration order.**
- 2026-07-08 — **Fix (Memory: a questionnaire YOU sent a partner was mislabelled "About you"; GitHub issue #129;
  user-reported with a screenshot; specs 08 §13.4 + 54 §3.2; on `fix/memory-questionnaire-responses-section`).**
  An analysis Insight from a questionnaire the viewer **sent to someone else** keeps `subjectPersonId` = the
  **sender** (it correctly informs the sender's coaching), but its facts describe the **recipient's** answers —
  so Memory's "About you" life-area cards showed it with the eyebrow "Questionnaire · About you" (the user:
  "it's obviously about my partner"). **Decisions asked first (2 forks, user-chosen):** a dedicated **"Responses
  to your questionnaires"** section (not the Partners tab, not just a relabel); scope = **all sent + any
  recipient** (standard sends AND compatibility alignments; household + external). **Display-only fix — subject
  stays the sender, `summarizeForContext`/`buildContext` untouched.** Added additive-optional
  `InsightProvenance.aboutPersonId` (household recipient) / `aboutName` (external) — **no `schemaVersion` bump**;
  stamped by `analyzeAssignment` (from `assignment.recipient`) + `generateAlignment` (the other participant),
  **never for a self check-in** (recipient = sender). A shared **`aboutResolver`** (`aboutFromRecipient` +
  `resolveInsightAbout`) also resolves it **read-time** in `coreBridge.insightsList` for pre-#129 insights (join
  the assignment / compat group), so the user's EXISTING confusing insight moves without a re-analyze. Memory
  groups these by recipient in their own labelled section (out of the life-area cards); the `InsightCard` eyebrow
  reads **"From `<name>`'s answers."** **Also fixed a pre-existing §12 overflow the new prominent card surfaced:**
  a broadcast fact's sharing chip listed all 8 relationship types in a non-wrapping row → `describeScope` now
  returns "everyone you relate to" for the full set (matches the SharingPanel copy), the `.factItem` row wraps,
  and the `RelationshipScopePicker` chip caps + ellipsizes. Gate green: typecheck (all), lint, format, \*\*972 core
  - 11 relay + 922 desktop** unit (+aboutResolver [self/person/external/legacy-resolve/compat-group], +analysis
    about-stamp [recipient/self-none/external], +compat about-stamp, +describeScope full-set, +bridge legacy-enrich,
    +Memory RTL Responses-grouping), **E2E +1** (send→analyze→approve → Memory groups it under "Responses · Angel"
    with the "From Angel's answers" eyebrow, absent from life-area cards; a legacy insight resolved read-time; 360px
    overflow guard). Visual QA: real Electron screenshot of the Responses section — grouped by recipient, eyebrow
    fixed, compact sharing chip. Synced spec 08 §13.4 + spec 54 §3.2. **Lesson: an insight can belong to person A's
    memory (`subjectPersonId`) yet be ABOUT person B — the Insight model has no "about" field, so a sent-questionnaire
    insight's facts (about the recipient) read as "about you" unless you stamp/resolve the recipient
    (`provenance.aboutPersonId`) and group by it; keep it display-only (subject + context unchanged). And a new,
    prominently-rendered card can surface a latent §12 overflow living in a shared control (a chip listing all 8
    types) — fix the intrinsic width at the source (concise label), since `max-width`/ellipsis can't shrink
    max-content.\*\*
- 2026-07-08 — **Fix + redesign (Sessions wrap-up card: a crisis-footer OVERLAY bug + a flat bullet-wall summary;
  user-reported with a screenshot; mockup approved first; spec 09 §3.1; on `feat/sessions-wrapup-redesign`).**
  **(1) The overlay bug (diagnosed from the layout, not assumed):** `WrapUpCard` rendered as a sibling AFTER the
  scrollable `.thread` inside `.main` (grid row 1). A tall summary overflowed the 1fr row and painted OVER the
  pinned crisis footer (`.crisisWrap`, grid row 2) — the "Get help now" + not-medical line floated mid-card. Fix:
  render the card **inside** the `.thread` scroll container (a `.wrapCardSlot`), so it scrolls with the
  conversation + is clipped by `overflow-y:auto` and can never overflow onto the footer; a `scrollIntoView` on
  appear brings its heading to the top. **(2) The redesign:** the card showed `insight.facts` as ONE flat
  `<ul>` (Themes/Goals/Follow-ups/People all mixed with their `Theme:`/`Goal:`/… prefixes) — an unscannable
  wall (the user's session had 10 themes, 4 goals, 6 follow-ups, 4 people). Now a pure `groupWrapUpFacts` routes
  each fact to a section by its code prefix (display-only; stored facts untouched; an unknown prefix → an "Also
  noted" group so nothing drops), rendered as **grouped sections**: Goals & commitments (a checklist, first),
  Themes (chips), Follow-ups (collapsible), People (chips). **Decisions asked + approved (2 forks):** condense
  long lists (themes past 6 → "+N more"; follow-ups collapsed by default); Goals-first order. Gate green:
  typecheck (all), lint, format, **961 core + 920 desktop + 11 relay** unit (+`groupWrapUpFacts` [prefix routing/
  strip/substring-safety/other-fallback], +WrapUpCard RTL [grouped sections, +N-more reveal, collapse toggle,
  Also-noted, section-omitted-when-empty, crisis-leads]; updated the 2 prefixed-text assertions to the stripped
  display text + the group header), **E2E** (the complete+summarize test asserts the grouped "Goals & commitments"
  header + a **geometric overlay guard**: `thread.bottom ≤ crisisFooter.top`, via a new `data-testid=session-thread`).
  **Visual QA:** real Electron screenshot of the rendered card — grouped, scannable, card scrolls inside its own
  region with the crisis footer pinned below (bug gone). Synced spec 09 §3.1. **Lesson: a grid child with no
  `overflow` clip will paint over a sibling row when its content exceeds its 1fr cell — a tall transient card
  belongs INSIDE the scroll container, not as a sibling after it; and grouping a flat fact list is a
  display-only transform keyed off the code-stamped prefixes (`Goal:`/`Theme:`/…), with an `other` catch-all so
  a prefix change never silently swallows a fact.**
- 2026-07-08 — **Build (Sessions: clear the composer on send + a "Wrap up & reflect" button below it; mockup
  approved first; spec 05 §3 + 09 §14.2; on `feat/sessions-clear-field-and-wrap-up`).** Two user asks, mockup
  shown + approved before building (the `visualize` tool — send before/after + the end-button demo). **(1) Bug —
  composer cleared too late.** `Composer.submit()` only cleared the textarea AFTER `onSend` resolved, but `onSend`
  awaits the WHOLE chat turn → the sent text sat in the disabled field the entire time the coach was "thinking,"
  duplicated with the bubble above (user: "confusing"). Fix: **snapshot then clear immediately** on send (the
  message lives in the thread); restore the text + pending attachments only if the send can't even start (a total
  attachment-store failure → `false`). **(2) Feature — a first-class "end + analyze" control.** "Complete &
  summarize" only lived in the per-session ⋯ menu + the proactive AI wrap-up chip, so there was no obvious "I'm
  done, analyze this" affordance. Added a **"Wrap up & reflect"** button centered below the composer running the
  SAME `completeAndSummarize` (setStatus('complete') → summarize) — a relocation, not a second action. **Decisions
  asked (2 forks, user-chosen):** label = "Wrap up & reflect"; AI/memory-off = **hide it** (matches the existing
  summarize gating). Gated `summarizeReady && activeId && messages.length>0 && status!=='complete' && !showSuggestion`
  (never two wrap-up controls at once). Gate green: typecheck (all), lint, format, **961 core + 910 desktop + 11
  relay** unit (+Composer: clears the instant you Send [pending-promise onSend] + restores text on `false`; +Sessions
  RTL: button ends+summarizes on demand + disappears once complete + hidden when memory off), **E2E +1** (send →
  field `toHaveValue('')` → "Wrap up & reflect" → Session summary + Insight written + button gone; the base send E2E
  asserts the clear too). Synced spec 05 §3 + 09 §14.2. **Lesson: a composer that clears only after the send promise
  resolves leaves the message stuck in a disabled field for the whole turn — clear optimistically on send + restore
  on a can't-start failure; and when adding an "end/analyze" affordance, RELOCATE the existing action (the ⋯-menu
  complete-&-summarize) to where users look, don't add a redundant second control (gate it so it never co-exists
  with the proactive wrap-up suggestion).**
- 2026-07-08 — **Fix (Sessions retry made ZERO difference for a session created BEFORE the fix — the LEGACY
  blank-reply ghost; user-reported (furious) with a screenshot; spec 05 §4.1 amended; on
  `fix/sessions-legacy-blank-reply-retry`).** The v0.14.3 retry only appeared when the transcript's last message
  was the **user's**. But the **pre-fail-safe code persisted an empty `{role:'assistant', content:''}` bubble**
  when a reply came back empty (verified against `v0.14.1` — the old `messages.push({role:'assistant', content:
stripCoachMarkers(result.text)})` had NO empty guard). So every session that dead-ended BEFORE the fix ends on
  that **ghost** (`last.role === 'assistant'`), not on the user's message → the retry never fired, and the ghost
  rendered as a blank coach bubble. That's why the user saw no change. **Diagnosed against the code + git history
  (not assumed)** — confirmed the exact legacy persisted state, then **reproduced it FIRST** (an E2E seeding a
  conversation ending in `[user, assistant('')]`) before fixing. **Fix: (1)** `retryReply` now **strips any
  trailing blank assistant message(s)** before the `last.role === 'user'` check, then regenerates (the cleanup
  persists on the success save; legitimate replies always have content, so only ghosts are removed). **(2)** new
  pure renderer helpers `isBlankReply()` + **`awaitingReply(messages)`** (the last REAL message is the user's,
  ignoring trailing blank ghosts) — the store `retry()` guard + the Sessions "Try again" banner now key off
  `awaitingReply`, and the render **skips blank assistant bubbles** (no more ghost bubble). **(3)** defensive:
  `send()`/`retry()` wrap the IPC in try/catch so a THROWN turn always resolves to an honest error (never leaves
  "thinking" stuck forever — the other half of "we need fail-safe measures"). Gate green: typecheck (all), lint,
  format, **961 core + 906 desktop + 11 relay** unit (+core: retryReply recovers a `[user, assistant('')]` legacy
  session → clean `[user, assistant]`; +RTL: a legacy blank-reply session renders no ghost + offers a working Try
  again; the E2E now covers empty-turn, re-opened, AND legacy-ghost), **E2E +1** (seed `[user, assistant('')]` →
  open → ghost absent + Try again → reply → decrypt asserts clean `[user, assistant]`, non-empty). All 13
  Sessions/guided E2E green. Synced spec 05 §4.1. **Lesson: "handle the failure" must include the DATA the OLD
  buggy code already wrote — a fix that only guards the new happy path leaves every pre-fix record stuck; check
  what state the previous version persisted (here, a blank assistant bubble via git), reproduce THAT exact record,
  and make recovery key off the transcript's last REAL message (ignoring ghosts), not a raw `last.role`.**
- 2026-07-08 — **Fix (Sessions retry STILL a dead-end on a RE-OPENED unanswered session — the v0.14.2 fix was
  incomplete; user-reported with a screenshot "im still unable to resend or retry"; spec 05 §4.1 amended; on
  `fix/sessions-reopen-retry`).** The v0.14.2 fix only showed "Try again" while a live `error` was set (cleared
  on `open()`), and it retried by **re-sending the user's text via `chatStream`** — which would DUPLICATE the
  persisted user message. The user's real case: a turn that never got a reply, then the session re-opened —
  transcript ends on their message, no error state → **no retry affordance at all** (a silent dead-end the
  screenshot showed). **Reproduced FIRST** (an E2E that seeds a conversation ending on a user message, re-opens
  it, and asserts the dead-end) before the fix. **Three-part fix: (1)** `chatService` now **persists the user's
  message BEFORE generating the reply** (05 §4.1) — a failed/interrupted turn never loses it; the transcript
  simply ends on the user's message. **(2)** extracted a shared `generateCoachReply()` (system prompt → stream →
  meter-first → empty-check → append+save → guided-step/challenge) used by both `runChatTurn` and a new
  **`retryReply()`** — which re-generates a reply for a conversation whose LAST message is an unanswered user
  message (**never adds a new user message → can't duplicate**), budget-gated + metered, reopens a completed
  session like a continuation. New `chat:retry` IPC through the full seam (channels → coreBridge → ipc [chatSender
  binding] → preload → test-utils). **(3)** the store `retry()` calls `chatRetry` (not re-sending text); the UI
  shows "Try again" whenever **`!sending && the last message is the user's`** — covering both a live failure (with
  its `error`) AND a re-opened unanswered session (a gentle "hasn't been answered yet" prompt). The optional
  in-session nudges (depth-ask 29, goal-raise 40) are intentionally omitted on a recovery turn. Gate green:
  typecheck (all), lint, format, **960 core + 905 desktop + 11 relay** unit (chatService: the empty test now
  asserts the user message IS persisted; +`retryReply` empty→retry→[user,assistant] no-duplication + no-op-when-
  answered; Sessions RTL: failed-turn retries via `chatRetry` not re-`chatStream`, + a re-opened-session prompt
  → Try again → reply), **E2E +1** (seed a session ending on a user message → re-open → "Try again" → reply →
  decrypt asserts exactly `[user, assistant]`, no duplicate; the existing empty→retry E2E now drives `chatRetry`).
  All 12 Sessions E2E green. Synced spec 05 §4.1. **Lesson: a "retry" that re-SENDS the user's input duplicates
  it — persist the user's message on send and make retry a REPLY-ONLY op (`retryReply` on the existing
  transcript); and a recovery affordance gated on a transient `error` flag misses the durable case (a re-opened
  session that ended on the user's message), so gate it on the transcript shape (`last.role === 'user'`), not on
  the in-memory error.**
- 2026-07-08 — **Fix (Sessions "thinking then nothing" — a silent empty-reply dead end; fail-safe error + retry;
  SPEC 05 §4.1; user-reported w/ screenshot; on `fix/sessions-empty-reply-failsafe`, PR pending).** A user sent
  a long message, saw "Coach is thinking…", then it stopped with NO response and NO error. **Diagnosed as a
  VERIFIED code bug (not assumed — a transport error WOULD have shown the banner):** chat turns ran with
  `maxTokens: 1024` (too small for a coaching reply) AND adaptive thinking (chat keeps it on, by design) which
  **shares** that budget → the model returned empty/truncated text (`stop_reason: max_tokens`), and the empty
  reply was **swallowed at every layer** (`anthropicClient` → `{text:''}`; `runChatTurn` persisted a blank
  assistant message + returned `ok:true`; the store cleared "thinking" with no error). The recurring
  [[adaptive-thinking-shares-maxtokens]] trap, this time in the CHAT turn. **Fix (fail-safe, the user's ask —
  "retry, resend, show error messages"):** (1) raised the chat ceiling to `CHAT_MAX_TOKENS=4096` (a ceiling, not
  a target — no normal-turn cost bump — so replies aren't starved/truncated); (2) a blank/whitespace reply is now
  an honest `{ok:false, reason:'EMPTY'}` (new `ChatTurnResult` reason) that is **never persisted** as a blank
  turn, with the billed call **metered first** (meter-before-bail); (3) the store's `error` surfaces on every
  failure + a **"Try again"** button (Sessions error Banner) re-runs the last turn (re-sending the last user
  message + its already-stored attachments, no second bubble, only when the last message is the user's — the
  typed message is preserved since a failed turn saves nothing). Extracted `successPatch` (shared by send +
  retry) + `buildChatUsage`. **Also fixed a pre-existing FLAKY E2E** (`intimacy guided sessions: Yes/No/Maybe
builder advances steps`) — its reply assertion lacked `.first()`, so during the stream→persist handoff it
  matched BOTH the streaming bubble + the saved message (a strict-mode violation) → the "load flake" flagged in
  earlier sessions was actually a missing-`.first()` bug; +`.first()` → 4/4 green. Gate green: typecheck (all),
  lint, format, **958 core + 904 desktop** unit (+empty→EMPTY/not-persisted/still-metered/budget-raised, +Sessions
  RTL error+Try-again re-sends same text, +the retry store path), **E2E +1** (real UI via a narrow
  `SELFOS_FAKE_CHAT_EMPTY` hook gated `!haiku` so the topic-classifier stream — which precedes the chat turn —
  doesn't consume the one-shot: empty → error + Try again → success). Code-reviewer: pending. Synced spec 05 §3.3
  (→ §4.1 fail-safe turn handling). **Lessons: (1) any bounded model `stream` (chat too) needs an empty-reply
  guard that returns an honest failure + never persists a blank turn — silence is the worst failure; a small
  max_tokens ceiling + adaptive thinking sharing it starves the reply. (2) A streaming-reply E2E assertion MUST
  use `.first()` (the stream bubble + saved message both match mid-handoff). (3) The topic classifier streams
  BEFORE the chat turn on haiku and lands in the fake's default branch — a "first stream" test hook must exclude
  it.**
- 2026-07-07 — **Fix (the Questionnaires edit/authoring list was NOT author-scoped — a questionnaire someone
  SENT you showed in your edit list; user-reported "that doesnt make any sense"; on
  `fix/questionnaire-list-author-scope`, PR pending).** Diagnosed: `questionnairesList` (bridge) returned core
  `listQuestionnaires` (ALL defs in the shared `questionnaires/defs/` dir) gated only on the
  `questionnaires.create` capability — never by author — so every person saw every household questionnaire,
  including ones others authored + **sent to them** (which belong in the **Inbox**, not the edit list). Fix (one
  scoping filter at the bridge, the trust boundary): the list now returns only defs the active person authored
  (`creatorPersonId === activePersonId`), plus a **legacy creator-less def** (pre-38, no author recorded) stays
  visible to the **Owner** so it isn't orphaned (matches §3.9's "legacy → Owner-deletable-only"). Core
  `listQuestionnaires` stays a low-level list-all (its only caller is the bridge). No schema/IPC change. Gate
  green: typecheck (all), lint, format, **956 core + 903 desktop** unit (+2 bridge: author-scoping [a member
  sees own not the owner's send-to-them, and it IS in their Inbox; the owner sees own not the member's] +
  legacy-creator-less-visible-to-Owner-hidden-from-members), **E2E +1** (seed a foreign-authored questionnaire
  sent to the owner + an owner-authored one → the edit list shows only the owner's, the friend's is absent, and
  the friend's IS in the Inbox). Synced spec 08 §6 (`questionnaires:list` is author-scoped). **Lesson: a list
  read over a SHARED store (`questionnaires/defs/` is household-wide, not per-person) must scope by the owning
  field (`creatorPersonId`) at the bridge, or every person sees everyone's — the `questionnaires.create`
  capability gates WHO can author, not WHICH defs are theirs; and legacy rows lacking the owning field need a
  fallback owner (the Owner) so scoping doesn't orphan them.**
- 2026-07-07 — **Build (Questionnaire answer review / edit / resend + sender re-analyze — SPEC 56 BUILT; on
  `feat/answer-review-edit`, PR pending).** User: after someone answers a questionnaire there's no way to review
  their answers/questions, no way to edit + resend, and the sender isn't told answers changed so their analysis
  goes stale. **Scope asked first (one genuine fork): household (Inbox) ONLY** — external relay recipients
  (purge-on-drain mailbox) + compatibility sends (dual-answer alignment) are explicitly deferred; the edit
  affordance is hidden for them. **Recipient (Inbox):** a submitted send is no longer a dead end — it shows a
  **read-only review** of their questions + answers (`AnswerList` + `formatAnswerForDisplay`) with **"Edit
  answers"** → an editable pre-filled form → **"Update answers"** (reopen THEN submit; Cancel is a true no-op —
  reopen is lazy). **Sender (Results):** each resubmit bumps **`ResponseSet.revision`** (additive-optional,
  `(existing ?? 0) + 1`; `saveProgress` carries it forward during an edit); `analyzeAssignment` stamps
  **`Insight.provenance.analyzedRevision`**; a pure **`isAnalysisStale`** (insight exists AND `revision >
analyzedRevision`, pre-56 defaults to 1 so an un-edited send is never falsely stale) drives an **"Answers
  updated — re-analyze"** chip + a new **`answers-updated`** notification (sender-scoped, `onIncrease` by
  revision). Re-analyzing overwrites the same Insight (idempotent) + catches `analyzedRevision` up → chip +
  nudge clear; `autoAnalyze` re-runs for stale sends (guard keyed `${assignmentId}:${revision}`). **Trust
  boundary:** `assignments:reopen` is recipient-scoped + rejects compatibility (NOT relay — an Inbox item is
  always the household-person recipient, and its relay mailbox was already revoked at first submit);
  `notifications:answersUpdated` is `viewResults`-gated + **carries no raw answers**, so a Private send's boundary
  holds. **No new AI spend** (re-analyze = the existing metered `questionnaire.analyze`); additive schema only
  (no `schemaVersion` bump), one new notification kind. Code-reviewer: pending. Gate green: typecheck (all),
  lint, format, **956 core + 901 desktop** unit (+reopen/revision/reopenable, +analyzedRevision/isAnalysisStale,
  +bridge reopen recipient-scoping + full stale-loop with a decrypt + no-raw-answers-for-Private, +Inbox
  review/edit/compat-hidden RTL, +Results stale-chip RTL, +answers-updated candidate RTL), **E2E +1** (a self
  check-in: answer → analyze → review → Edit → Update → Results stale chip → decrypt `revision===2` → Re-analyze
  clears it + decrypt `analyzedRevision===2`; 360px review guard). Synced specs 56 (Approved→Built) + 08 §3.3
  (amended). **Lesson: the `answers-updated` bell is a one-shot per-person read (no mid-session polling), so it
  surfaces on NEXT LAUNCH, not instantly after an in-session edit — the E2E asserts the Results stale chip
  (which DOES refresh on navigation) + a decrypt, and leaves the bell to the bridge + RTL tests; and the reopen
  guard must reject compatibility but NOT relay-linked in-app sends (the mailbox is already dead post-submit),
  or the common household-send-with-a-link case can't be edited.**
- 2026-07-07 — **Build (Onboarding attention indicator — SPEC 55 BUILT; closes #109; on `feat/onboarding-attention`,
  PR pending) + Fix (#95 hide taken tests, PR [#110]).** Two GitHub issues from the member (amarshall1011).
  **#95** (small You-hub fix, `fix/hide-taken-tests`): a test the person has taken now drops out of "Available
  tests" (it already lives at the top under "Your profiles" with Retake / Check in again); a group with no untaken
  tests, and the whole section once everything's taken, self-hides; the 18+ intimacy gate still shows for untaken
  intimacy tests. **#109** (spec 55): a gentle, dismissible **attention indicator** — a `onboarding-updated`
  **notification (bell + toast)**, the Home **`OnboardingCard`** attention branch, and the **Onboarding nav dot** —
  when a person's **completed** onboarding has genuinely-new content or an unfinished section. **All decisions asked
  first (2 rounds):** what counts + where (all three surfaces); then, on surfacing a material consequence, the
  aggressiveness. **The key restraint:** the deep `invited` intake catalog is left `notStarted` by design after
  completion (only `core` is required), so "count every unanswered question" would keep the card + dot lit for
  **every** user forever (always-on). So the rule (pure `onboardingAttention` helper in `routes/onboarding/progress.ts`,
  reusing `visibleQuestions`/`isAnswered`) flags a visible unanswered question only when it is **NEW** (its
  `sectionId.questionId` ∉ a per-person **completion snapshot**) **OR** its section is **`inProgress`** (started, not
  finished) — a `complete` section's remaining optional blanks are deliberate skips and are never nagged about; a
  new chat section un-started counts 1; `adult` sections excluded until the 18+ ack; fires only when
  `session.status === 'complete'`. The snapshot is additive-optional `IntakeSession.knownSectionIds` /
  `knownQuestionKeys` (no `schemaVersion` bump, `.catch(undefined)`), written at portrait synthesis via
  `intakeCatalogSnapshot()` and **baselined for pre-55 complete sessions in `ensureIntakeSession`** (write-once, so
  existing users aren't retroactively nagged and future app updates ARE detectable). **No AI, no spend, no new IPC
  channel, no new vault file** — one additive `'onboarding-updated'` core enum literal; the bell uses `onIncrease`
  (dismiss stays quiet until MORE appears). Gate green: typecheck (all), lint, format, **951 core + 893 desktop**
  unit (+onboardingAttention rule matrix, +snapshot write/baseline core, +OnboardingCard attention branch RTL,
  +useNotificationSources candidate RTL, +the #95 You-hub RTL), **E2E** (#109: a completed session whose snapshot
  omits a real section → card + nav dot + bell → dismiss persists across relaunch + 360px guard; #95: the ECR-R
  flow now asserts the taken test is absent from Available). Synced specs 55 (Approved→Built), 18 §15 (amended), 50
  §3.1. **Lesson: a "flag unanswered onboarding questions" feature is naggy-by-default because intake questions are
  ALL optional and the deep catalog is `notStarted` by design — so "unanswered" ≈ "everyone, forever." The
  non-naggy signal is a per-person COMPLETION SNAPSHOT (detect genuinely-new content) + the `inProgress` status
  (a section left unfinished), never "any blank"; surface that always-on consequence to the user before building.**
- 2026-07-01 — **Fix (dream "Analyze this dream" → "The analysis was cut off before it finished"; the recurring
  adaptive-thinking budget bug, this time in the DREAM + SESSION syntheses; on `fix/dream-analysis-truncation`,
  after the §15 reflection redesign shipped in v0.12.0).** User hit the TRUNCATED message on the live app.
  **Diagnosed from the code (NOT assumed — the message is the honest TRUNCATED parse-outcome, not a refusal):**
  `anthropicClient` enables adaptive `thinking` unless a caller passes `extendedThinking: false`, and adaptive
  thinking **shares the `maxTokens` budget** with the visible output. `dreamAnalysisService.synthesizeAnalysis`
  streamed with `maxTokens: 1500` and **no `extendedThinking: false`**, so thinking starved the 5-section JSON →
  truncated/unclosed → `classifyParseOutcome` → the "cut off" error. **Latent since the original dream synthesis
  (2026-06-11)** — surfaced now the §15 redesign makes analysis easy to reach. The offline fake Claude **hid it**
  (always returns valid JSON), so every E2E stayed green (the [[adaptive-thinking-shares-maxtokens]] +
  fakes-hide-model-bugs traps, both documented). A blast-radius audit of every core `client.stream` found the
  **same defect** in the JSON-producing `sessionAnalysisService` (`maxTokens: 1500`, no flag — would be hit next
  on "End & summarize") and the `dreamPatternService` narrative (bounded prose starved to empty). Fix (the intake
  portrait / generation reference pattern): **disable adaptive thinking** on all three bounded syntheses — dream
  synthesis (`extendedThinking:false` + `maxTokens` 1500→4000), session wrap-up (`false` + 2500), pattern
  narrative (`false`, 800). Unit guards **capture the stream options** and assert `extendedThinking===false` + a
  generous budget for the dream + session syntheses, so the fake can't hide a regression again. Gate green:
  typecheck (node + web/DOM), lint, format, **949 core** unit (+2). No renderer change. **Lesson (again): a
  bounded structured-JSON `client.stream` MUST pass `extendedThinking:false` or adaptive thinking starves the
  output to a truncation — audit EVERY JSON-producing stream call for the flag, not just the reported one, since
  the offline fakes make the whole suite green while the live app truncates.**
- 2026-06-26 — **Fix #3 (onboarding sharing STILL didn't save — `answerSharing` was written for ANSWERED questions
  only; SPEC 43 re-amended again; on `fix/intimacy-sharing-instant-save`).** Third report, with a screenshot: on a
  fresh **intimacy** section the user clicks "share with Partner" on the whole section and it doesn't save. **My
  prior two fixes never tested the intimacy section OR the share-before-answer case** — both my E2Es used `basics`
  with an answer present. **Reproduced FIRST (decrypt E2E driving the exact screenshot):** fresh intimacy section,
  ack 18+, open section sharing → Partner, NO answer → `answerSharing` came back **empty** on the current build →
  proving the bug before any change. **Root cause:** `submitSectionForm`'s `nextSharing` loop iterated
  `Object.keys(section.answers)` — ANSWERED questions only — so a section with nothing answered persisted no scope.
  **Fix (core):** iterate the **union** of answered questions **and** the questions the renderer explicitly scoped
  (`Object.keys(sharing)`), so a fresh-section bulk-share persists for every question (safe: an unanswered question
  has no derived fact, so the scope shares nothing until it IS answered, at which point the pre-set choice is
  honored instead of reverting to the category default). **Fix (panel, "right away"):** a sharing change now saves
  **immediately** (`saveScopesNow` → `autoSaveForm` on the click, `complete:false`), not on the ~600ms debounce —
  only answer TYPING stays debounced (the effect deps dropped `scopes`). Extracted a module-level `cleanAnswers`
  shared by both. Gate green: typecheck (all), lint, **940 core + 855 desktop** unit (+core: persists a scope for
  an UNANSWERED question without inventing an answer; the existing draft test), **E2E +1** (the screenshot repro:
  fresh intimacy section → share Partner with nothing answered → every question's scope persists to the vault; the
  prior first-time + edit-a-completed E2Es still green). **Lessons: (1) test the EXACT surface the user is on — all
  three of my fixes used `basics`; the bug lived on the 18+-gated INTIMACY section + the share-BEFORE-answer path I
  never drove. (2) `answerSharing` keyed off answers means sharing can't precede answering — key it off what the
  user explicitly SCOPED (the renderer sends a scope per question), so "share this whole section" sticks on the
  click. (3) "save right away" means on the CLICK — a debounce that's correct for typing is wrong for a discrete
  sharing tap.**

- 2026-06-26 — **Fix #2 (onboarding STILL didn't save — auto-save was scoped to COMPLETED sections only; SPEC 43
  re-amended; on `fix/onboarding-autosave-all-sections`).** The v0.11.1 fix shipped but the user came back
  (rightly angry): "YOURE OBVIOUSLY NOT PROPERLY TESTING — onboarding questions arent being saved when selected
  and when changing the private status its not saving automatically." **My failure:** I "verified" with an E2E I
  wrote to pass (it tested a COMPLETED section) instead of reproducing the user's REAL scenario (first-time
  onboarding). **This time I reproduced against the running app FIRST:** wrote a decrypt-level E2E driving a
  first-time section → it FAILED on v0.11.1 (`occupation` stayed `null` after filling + changing sharing, no
  Continue) — proving the bug, before touching the fix. **Root cause:** the auto-save effect was gated
  `if (!complete || locked) return` — so it only fired on already-COMPLETED sections; while filling out
  onboarding (every section `notStarted`/`inProgress`), nothing auto-saved. **Fix:** auto-save now fires for
  **every** section, persisting a **DRAFT** — `submitSectionForm` gained a `markComplete` param (default `true`);
  `autoSaveForm` passes **`complete: false`** so a draft persists answers + `answerSharing` but only nudges
  `notStarted`→`inProgress`, NEVER completing the section (only the explicit Continue/Done does, so no premature
  portrait). Added a **flush-on-unmount** (a `flushRef` → latest closure) so a quick Back/section-switch inside the
  ~600ms debounce doesn't drop the last edit, and **cancel-on-explicit-submit** (`cancelAutoSave()` in the
  Continue/Done/Skip handlers) so a debounced draft can't race in AFTER the completing submit and revert it.
  Gate green: typecheck (all), lint, **939 core + 855 desktop** unit (the stale "first-time does NOT auto-save"
  RTL INVERTED to assert it DOES, as `complete:false`; +a core `submitSectionForm` draft test:
  persists-without-completing then an explicit submit completes), **E2E** (the new first-time decrypt test — fill
  - change sharing with NO Continue → both the answer AND the scope persist to the vault, section not complete;
    the existing edit-a-completed-section test still green). **Lessons: (1) NEVER claim verified from a test you
    wrote to pass — reproduce the user's ACTUAL path (first-time vs editing) against the running app, watch it FAIL,
    then fix. (2) An auto-save gated on a state the user isn't in yet (`complete`) is no auto-save — onboarding is
    spent in not-complete sections, so that's exactly where save-on-select had to work. (3) A draft save (a
    `markComplete:false` flag) is how you persist-as-you-go without the side effects of "submit" (completion +
    portrait).**

- 2026-06-26 — **Fix (onboarding sharing didn't save — one-tap + auto-save; SPEC 43 amended; on
  `fix/onboarding-share-autosave`, PR pending).** User: "in intimacy & sexuality I click _share with partner all_
  and Save, and it doesn't save — and let's save right away when clicked, same with all answers." **Diagnosed
  (not assumed):** traced the code — intake sharing was written ONLY by the "Save changes" button
  (`submitForm`→`submitSectionForm`). On a sensitive section the bulk "share all" didn't apply on the pick: it
  popped an inline **confirm** (§8) that REPLACED the picker, so a person who clicked Save without first clicking
  "Share it" silently lost the choice (Save persisted the old Private scopes). The single-scope `intake:setAnswerSharing`
  channel existed but the form never called it. **Owner decisions (asked first, both forks):** **one tap, no confirm**
  - **auto-save sharing AND answers**. Fix: **(1)** removed the §3.1/§8 sensitive-share confirm — `applyScope`/`applyBulk`
    apply directly on one tap (safety preserved by the **default**: a sensitive answer still STARTS Private, so sharing
    is still an explicit choice; the confirm machinery — `pendingShare`/`renderConfirm`/`SECTION_BULK` — is gone). **(2)**
    new silent `intakeStore.autoSaveForm` (re-runs `intake:submitForm` WITHOUT the `busy` toggle, so controls don't
    flicker) + a debounced (600ms) auto-save effect in `IntakeFormPanel` that fires on any answer or scope change **for a
    COMPLETED section** (i.e. being edited); the primary button becomes **"Done"** (a flush + advance). A **first-time
    section is unchanged** — it still uses the explicit **Continue** (which marks it complete; auto-save never completes
    a section being filled the first time, so no premature portrait). Gate green: typecheck (all), lint, **855 desktop**
    unit (3 reworked IntakeFormPanel RTL: per-question one-tap+auto-save, bulk share-all auto-save [the reported bug],
    first-time-does-NOT-auto-save; removed the two confirm tests), **E2E** (the existing per-question-sharing decrypt
    test extended: re-open the now-complete basics section → widen to +Sibling → it persists to the vault with NO Save
    click). Visual QA (real Electron screenshot): the section reads clean — honest explainer, one-tap sharing chips, no
    confirm clutter. Synced spec 43 (amendment). **Lesson: a confirm that REPLACES the control it guards is a silent
    data-loss trap — a user reads the picker as "done" and the pending choice evaporates on the next click; and
    per-question intake sharing must be writable on its own (`setAnswerSharing`) OR auto-saved, never gated solely behind
    a section-level Save the user may not reach. ALSO (repeated my own footgun): `git checkout <file>` reverts UNCOMMITTED
    work — and I started this fix on `main` without branching; commit/branch BEFORE injecting throwaway screenshots.**

- 2026-06-26 — **Build (owner AI intimacy-topic suggester — SPEC 08 §16.5a AI-assist; on `feat/ai-intimacy-topics`,
  PR pending).** The last item of the 2026-06-26 batch. The owner-only Intimacy Topics settings control gains a
  **"Suggest with AI"** affordance. **All 3 product/UX forks asked first (user-chosen):** lives **in the existing
  owner control** (not a separate panel); driven by a **subject box that falls back to a general varied batch when
  blank** ("Both"); suggestions are added via a **pick-and-edit checklist** ("tick + edit, then Add selected"). Core
  `@selfos/core/intimacy/suggestService.ts` (`suggestIntimacyTopics`) — one metered **`intimacy.suggestTopics`** pass
  (budget-gated, meter-BEFORE-parse, tolerant `extractJsonObject` + honest failures, `extendedThinking:false`) that
  proposes consensual-adult **activity + fantasy** topics and **dedupes** them case-insensitively against the merged
  inventory (built-in + custom; an all-dupes result is an honest EMPTY). **Persists nothing** — the owner reviews +
  the existing `addCustomIntimacyTopic` path commits the chosen ones. The consensual-adult boundary lives in the
  prompt + the model (never a keyword filter); the Owner is the full-access role so the seam is gated `people.manage`
  (owner-only), and **AI-off is a calm state** (no dead button). IPC `questionnaires:suggestIntimacyTopics` through
  the full seam + the offline fake-Claude branch (returns a set incl. an existing built-in, so the dedupe is
  exercised offline). Renderer: the control gains a subject `Textarea` + "Suggest with AI" → a checklist of
  checkbox+editable rows → "Add selected (N)". Additive schema (`IntimacyTopicSuggestResult` + the usage type) — no
  migration. Gate green: typecheck (all), lint, **938 core + 854 desktop** unit (4 core suggester [dedup/meter/ground,
  no-subject, NO_KEY, EMPTY] + 6 control RTL [suggest/pick/edit/add, EMPTY surface, non-owner hidden] + a coreBridge
  test [owner deduped, member denied, AI-off calm]), **E2E** (the Settings flow: Suggest → checklist → a built-in
  deduped out → uncheck one → Add selected → persisted across both kinds). Visual QA (real Electron screenshot): the
  subject box + the pick-and-edit checklist + "Add selected (3)" read clean + cohesive with Settings. Synced spec 08
  §16.5a. **Lesson: a "suggest then add" feature is cheapest as an EPHEMERAL pass (persist nothing) layered on the
  existing add path — the suggester only computes deduped candidates, the owner's checklist drives the existing
  per-topic add, so there's no new persistence, no migration, and the dedupe is the one real guarantee (the prompt's
  avoid-list just nudges the model).**

- 2026-06-26 — **Build (guided-sessions expansion — fuller therapy/coaching + a Family group + catalog search;
  on `feat/guided-sessions-expansion`, PR pending).** Additive content + one small UI feature (an extension of
  spec 16/48, no new machinery, no schema/IPC). **New `family` group "Family & relationships"** (12
  family-dynamics chat sessions — family role, a parent, siblings, boundaries, in-laws, inherited patterns,
  repairing a rift, aging parents, your parenting, co-parenting, estrangement, gathering prep), and the
  **Reflective** + **Coaching** groups grow to a fuller ~12 each (+worry time, thinking traps, three good
  things, name the feeling, urge surfing; +habit builder, getting unstuck, time & priorities, strengths,
  future self). Plumbing: `GuidedGroupId += 'family'`, `GUIDED_GROUPS`, `GUIDE_LIFE_AREAS.family`. Every entry
  leads with the shared `frame()` not-therapy boundary; **family is never adult-gated** (the `adult ===
(group === 'intimacy')` catalog invariant holds — a unit asserts it). With ~56 browsable sessions now, a
  **catalog search** filters across every group by name/framework/topic (non-matching groups collapse away, a
  calm empty state when nothing matches, and the **18+ intimacy group is never surfaced via search before the
  ack** — the no-leak guard). Gate green: typecheck (all), lint, **934 core + 851 desktop** unit (the new
  family group + fuller-set assertions; 4 GuidedCatalog RTL incl. the no-leak guard), **E2E +1** (browse the
  Family group + filter across groups + empty state + clear). Visual QA (real Electron screenshots): the
  search sits cleanly above the catalog; filtering to "boundaries" shows only the matching Family cards —
  sleek + intentional. Synced spec 16 §3.1/§3.2. **Lesson: `git checkout <file>` reverts UNCOMMITTED changes
  too — injecting a throwaway screenshot into an uncommitted E2E then `git checkout`-ing to revert the
  screenshot wipes the whole new test; commit the test first, then inject/revert screenshots over the committed
  baseline.**

- 2026-06-26 — **Build (Memory redesign — sharing is context not display + relationship insights + test-sharing
  default; SPEC 54 BUILT; on `feat/memory-redesign`, PR pending).** Two user-reported problems: Memory DISPLAYED a
  partner's raw shared answers, and it was a wall of text. **The concept fix (the core):** a partner's shared data
  feeds the viewer's AI context but is **NEVER shown raw** — the spec-44 "about people you relate to" section is
  GONE. **The redesign:** a summary strip + an **"About you" / "Partners" toggle** (renamed from "Relationships" to
  avoid colliding with the "Relationships" life-area). "About you" = own data (search/filters [subject filter
  dropped], drafts, goals, trends, insights by life-area). "Partners" = a per-partner **`RelationshipInsightsCard`**
  showing a **new AI relationship-insights synthesis** (`relationshipSynthesisService` — reads the viewer's own
  digest + the partner's SHARED facts via `factSharedWithViewer`, emits gentle observations about the viewer + the
  dynamic; explicit-tap "Reflect on us" / Refresh, cached per `(viewer, partner)`, budget-gated + weekly-capped,
  metered `relationship.synthesize` before parse; the prompt forbids quoting the partner's raw answers), with the
  explicit "used as insight for your coach, never shown as their raw answers" footer. **The test-sharing default
  (bundled):** test results (incl. sensitive intimacy + wellbeing) now default-share with the **`partner`**
  relationship type. **The privacy-critical fork, resolved the SAFE way:** sensitive (kink/sexuality) facts are no
  longer `restricted` (so they can reach a partner) — `restricted` stays reserved for break-glass **intake**
  trauma/intimacy facts (UNCHANGED, reach no one) — and the own-context relevance gate now keys off the sensitive
  **life-area** (`SENSITIVE_CONTEXT_LIFE_AREAS = {'Intimacy'}`) in both `summarizeForContext` and `digestableInsights`,
  so kink still surfaces only in intimacy contexts and never the topic-free digests. Proven: every existing
  intake/cross-person privacy test still passes + new tests (a sensitive test reaches a PARTNER never a sibling; the
  synthesis digest sees only shared facts). Schemas additive (`RelationshipSynthesis`, `relationship.synthesize`
  usage type); IPC `relationships:synthesize`/`:getSynthesis` gated `memory.own` + partner-only. Gate green:
  typecheck (all), lint, **932 core + 847 desktop** unit (+relationship synthesis [5], +Memory RTL "never displays
  related raw" + Partners-view card/generate, +the updated kink-partner-shareable bridge test), **E2E +1** (decrypt-
  level: a partner's shared/private facts never show raw, the Partners view shows AI insights, the synthesis caches,
  360px clean). Visual QA (real Electron screenshots, desktop): the summary strip + toggle read sleek/scannable; the
  Partners card shows insight-bullets + the "never their raw answers" footer. **Lesson: keep `restricted` as the
  pure break-glass "never broadcast-shared" flag (intake trauma/intimacy) and drive own-context relevance-gating off
  a SENSITIVE life-area set instead — that lets a sensitive test result be partner-shareable AND still intimacy-only
  in the viewer's own context, without touching the gate that keeps intake facts private (every existing privacy
  test stayed green, the empirical proof the gate change was safe).**

- 2026-06-26 — **Build (Home encouragement engine — SPEC 53 SLICE B BUILT; on `feat/home-encouragement-slice-b`,
  PR pending).** The Slice-A engine (the deterministic "For you" recommendation ranker) grows to cover the
  2026-06 feature batch by adding **3 providers as engine built-ins** (`BUILT_IN_RECOMMENDATION_PROVIDERS`), with
  **no `Home.tsx` card-wiring** — the §5.5 payoff: **`take-a-test`** (50, gate `tests.own`) invites a first
  personality/relationships self-assessment when none is taken; **`wellbeing-checkin`** (51, gate `tests.own`, NOT
  18+) gently invites a mood/anxiety re-check only when a prior PHQ-9/GAD-7 check-in has gone **≥14 days quiet** (a
  soft invitation on the §51 §3.4 window — **never** for someone who never checked in, **never** escalating, §8) with
  a signal-aware `wellbeing-checkin:<lastAt>` dismissKey; **`intimacy-exercise`** (48, gate `sessions.own` +
  `adultGate: true`) invites a guided intimacy exercise **only** once the per-person 18+ ack exists AND an
  intimacy-group test was taken (so it reads "for them", never a premature/unsolicited sexual push — triple-gated:
  the engine's adultGate filter, the engagement signal, AND the adult-test catalog withholding). The shared
  mood/anxiety re-check window (`RECHECK_AFTER_DAYS`/`RECHECKABLE_INSTRUMENTS`/`daysSince` + a new `wellbeingCheckin`
  aggregate) was extracted into `home/wellbeing.ts` and **You.tsx refactored onto it (DRY)**. Home now loads the
  `testStore` in its per-person effect (**consolidating** the previously-separate PHQ-9 fetch — the WellbeingCard
  sibling series now reads `resultsByTest['phq9']`) and assembles `testResults` (instrument + **group** + when),
  `wellbeingCheckinDue`, `lastWellbeingCheckinAt` into `PersonRecommendationState`; refined the Slice-B state
  placeholders (added `group` to `testResults`; removed the unused `intimacyExerciseAvailable`; added
  `lastWellbeingCheckinAt`). **Also fixed a latent spec-52 wiring bug:** Home's reactive capability snapshot omitted
  `challenges.own` (and `tests.own`), so the challenge providers were filtered out and **never surfaced** — both added
  to the set. No new IPC, no new vault schema, no new AI spend (§6 holds). Code-reviewer **ship** (no blockers; the
  18+ triple-gate, wellbeing never-escalating/never-on-never-checked-in, per-person isolation, the testStore
  consolidation not breaking the sibling series, and the DRY refactor all verified; 2 optional tuning nits). Gate
  green: typecheck (all packages), lint, format, **918 core + 844 desktop** unit (the 3 providers'
  relevance/gating/scoring/dismiss-signal + the `wellbeingCheckin` due/calm/never-checked-in cases + Home RTL for each
  new card incl. the 18+ gate hiding the intimacy card even when the profile exists), **E2E +2** (self-assessment +
  wellbeing recs surface + take-a-test routes to You; intimacy exercise only after the 18+ ack + 360px clean). Synced
  spec 53 (→ Built Slice A+B, §5.1/§11.1 + changelog). NOTE: the heavy spec-52 challenge two-flow E2E (`co-create a
challenge…`) times out at 30s when run as the ~5th test in a batch — a **pre-existing accumulated-load flake**
  (verified: it fails 5th after four UNRELATED session tests that never touch Home, passes reliably in isolation; my
  changes touch no path it exercises). **Lesson: adding a provider changes WHAT competes for the capped "For you"
  slots, so an existing For-you test that asserts a specific runner-up must seed the new provider's satisfied state to
  stay focused — the ranking is the contract, not a fixed card set; and a renderer capability snapshot that gates the
  engine must list EVERY provider's gate (the spec-52 challenge providers were silently dead because `challenges.own`
  was missing — they passed their unit test, which put the gate in the state set, while the real app filtered them
  out).**

- 2026-06-26 — **Build (Wellbeing & neurodivergence self-reflections — SPEC 51 BUILT; on
  `feat/wellbeing-reflections`, PR pending).** The most safety-sensitive feature in the app — clinically-validated
  instruments embedded as **non-diagnostic reflections**, reusing the spec-50 Tests engine wholesale (no new engine,
  hub, or routes; a new `wellbeing` test group). **All 4 material §11 decisions asked first:** autism = **both**
  AQ-10 + RAADS-R; mood/anxiety re-take = **passive card prompt only** (NO §40 nudge, even on a worsening trend);
  Home = a **sibling "Your check-ins" series** on the `WellbeingCard`; copy = **proceed with the proposed gentle
  wording**. Recommendation-takes for the rest (no extra opt-in setting — the framing-first intro IS the opt-in;
  ADHD/autism retake-allowed-not-nudged; adult-framed, no extra age gate). **Four instruments** as spec-50
  `TestDefinition`s flagged `wellbeing`: **PHQ-9** (mood; item 9 = the crisis trigger), **GAD-7** (anxiety), **ASRS
  v1.1 Part A** (focus), **AQ-10 + RAADS-R** (social/sensory). **The safety core (§8):** a pure, AI-free
  `@selfos/core/tests/wellbeingCrisis.ts` (`detectWellbeingCrisis`/`answerTriggersCrisis`/`crisisItemPositive`/
  `resolveWellbeingBand`) flags a positive PHQ-9 item 9 **or** a high `crisis` band → sets `crisisFlag` on **both**
  the `TestResult` and the derived Insight → feeds the §40 `aggregateCrisisSignal` + Home `CrisisSupportBanner`
  unchanged; the renderer escalates a prominent `role="alert"` banner **mid-check-in, before scoring** (client-
  evaluable from the definition); crisis routing is **independent of every setting + works AI-off**. **The
  non-diagnostic reframe (§8.1):** the internal clinical band (`clinicalKey`) is kept on the result for trends/crisis
  ONLY and **never shown** — the person sees a gentle `WellbeingBand.display` range + a low→high bar (no clinical
  axis) + the **always-present professional-help line**; the optional `test.narrate` is extra-bounded **and never
  receives the clinical key** (`scoreDigest` maps it to the gentle display). **Privacy (§8.4):** wellbeing facts are
  `shareable:false` with no `shareableWith`/`shareableTypes`, own-context only. **Additive schema** (`TestDefinition`
  gains `wellbeing`/`crisisItems`/`bands`/`attribution`/`lifeArea`; `TestGroupId += 'wellbeing'`; `TestSummary`
  display fields) — no migration. `deleteResult` now **re-derives** the Insight from the latest remaining take so a
  partial delete never leaves a stale trend/crisis flag. Renderer: the You-hub "Reflections & check-ins" group, the
  framing-first intro + Stop affordance, the gentle-band result, the Home sibling check-in series (read from dated
  PHQ-9 results), a passive ~14-day "check in again" prompt. `Banner` gained an additive `role` prop. Code-reviewer
  **ship-after-one-should-fix** (the narrative clinical-key leak — fixed; + the partial-delete re-derivation +
  dead-compute nit). Gate green: typecheck, lint, format, **863 core + 823 desktop** unit (the crisis hook +
  per-instrument band vectors + the bridge + the partial-delete re-derive + the narrative gentle-band-only guard +
  RTL for hub/take/result/Home) + **2 E2E** (mood check-in → gentle result + help line + retake trend + Home sibling
  - 360px; PHQ-9 item-9 mid-check-in crisis + decrypt own-only `crisisFlag` + Home aggregation, AI off; spec-50 E2E
    no-regression). Visual QA at desktop + 360px (real web-preview screenshots — the wellbeing group, framing-first
    intro, the mid-check-in crisis banner, the gentle result; no overflow, no console errors). Synced spec 51
    (→ Built, §11 resolved) + spec 17 drift (the WellbeingCard sibling series). **Instrument-items note:**
    PHQ-9/GAD-7/ASRS/AQ-10 embed the actual items with attribution; RAADS-R's 80 items are register-faithful
    adaptations (not verbatim) with the Ritvo citation, scored as a single summative total into gentle bands —
    mirroring the spec-50 precedent. **Lesson: the internal clinical band must be firewalled from EVERY user/model
    surface — the result render gates on `test.wellbeing` (not on the band resolving) so a degenerate result can't
    fall through to clinical bars, and the narrative digest maps the clinicalKey→gentle display before the prompt;
    and a per-instrument derived Insight only keeps the LATEST take, so a Home trend "sibling series" must read the
    dated RESULTS, not the single Insight's metric.**

- 2026-06-26 — **Build (Self-assessments / "Tests" engine + the "You" hub — SPEC 50 BUILT; on
  `feat/self-assessments-tests`, PR pending).** The personalization backbone: deterministically-scored standardized
  instruments that produce a structured profile feeding the coach app-wide. **All 4 material §11 decisions asked
  first:** hub = **"You"** (`/you`); depth = **fuller** (Big Five **IPIP-120** + Attachment **ECR-R 36**); **one
  slice**; the AI narrative **may name specifics**. Recommendation-takes for the rest (auto-feed own-context +
  reviewable in Memory; kink subscales = spec 49's 14 `INTIMACY_CATEGORIES`; non-sensitive results own-only v1;
  conservative crisis flagging — no v1 item flags, mechanism retained). **Core `@selfos/core/tests`:** a pure,
  AI-free **`scoreTest`** (reverse-scoring `-`-prefix → `min+max−value`; `sum`/`mean` aggregate; normalize unit
  0..1 / signed −1..1; descriptor bands; **total — never throws**, clamps/omits bad cells) + four `TestDefinition`s
  (Big Five IPIP-120, ECR-R 36, Kinsey/Klein sexuality, and the **kink inventory GENERATED from spec 49's
  `intimacyActivitiesByCategory()`** — 14 category subscales, a branched per-category opt-in, so the two stay one
  source of truth). **The result→Insight bridge (`testService`):** scores → an encrypted `TestResult` (retake =
  NEW file + `reTakeOf`, trends keep every take) → an Insight (`source:'test'`, `approved:true`, retake **reuses
  `insightId`** [UPDATE not duplicate] + preserves `createdAt`); **sensitive (kink/sexuality) results write
  `restricted` facts tagged `lifeArea:'Intimacy'`**; the **only metered call** is the optional `test.narrate`
  (admin-only `$`, meter-before-return); a context provider registers into 08's registry. **Privacy (the central
  guarantee):** a new relevance gate in `summarizeForContext` (insightStore) feeds a sensitive test insight to the
  taker's OWN intimacy-topic context **only** — never a money chat, never another person's context; **fail-closed**
  when a restricted fact has no life-area, and a `sensitive ⇒ adult` catalog invariant (both code-reviewer
  hardenings). **Seam:** `tests:list/get/take/results/narrate/acknowledgeAdult/deleteResult/deleteAll`, all gated
  `tests.own` + active-person-scoped + the 18+ group withheld in the bridge (not just the UI); `tests.own`
  capability (Member ON, not EXPLICIT_GRANT_ONLY); reuses the shared `adultAcknowledged` ack. **Renderer:** the
  "You" hub (`/you` — catalog grouped Personality/Relationships/Intimacy & sexuality, 18+-gated; profile cards) +
  Take (`/you/:testId/take`, the `@selfos/answering` form, required-Likert not auto-seeded, renders-to-the-bottom)
  - the result profile (`/you/:testId` — `SubscaleBar` primitive [→ `/gallery`], per-subscale `TrendLine` trends,
    the optional narrative + calm AI-off/budget states, history, Retake/Delete), a per-person `testStore` (reset on
    `activePerson.id`). **Additive schema** (`InsightSource += 'test'`, provenance `testId`/`testResultId`,
    `TestResult`) — no version bump; the 3 Memory `Record<InsightSource>` maps extended. Code-reviewer **ship** (the
    privacy boundary verified airtight end-to-end; both fail-closed hardenings applied). Gate green: typecheck, lint,
    format, **840 core + 816 desktop** unit (scoring engine incl. reverse/midpoint-neutral integrity, bridge
    take/restricted/retake/18+/Guest-denial/narrate-metered, You-hub + result-screen + SubscaleBar RTL, the new
    relevance-gate + fail-closed insightStore units) + **2 E2E** (full ECR-R take→profile→retake→trends + AI-off calm
    narrate + 360px guard; the kink 18+ gate → restricted-fact decrypt → own-vs-non-intimacy context) + visual QA at
    desktop + 360px (real Electron screenshots — clean, intentional, responsive; caught + fixed a misleading
    itemCount that counted matrix CONTAINERS not rows → "36 questions"). Synced spec 50 (→ Built, §11 resolved) +
    drift fixes into 08 §1.1/§4.4, 20, 44, 49. **Lesson: a sensitive own insight's SUMMARY also feeds own context
    (not just its facts), so relevance-gating restricted content means gating the WHOLE insight on the call topic —
    per-fact lifeArea gating alone leaks the summary into a money chat; and the gate must fail CLOSED when a
    restricted fact carries no life-area. The user-facing "N questions" count must be answerable LEAF items (matrix
    rows), never the matrix-container count.**
- 2026-06-25 — **Build (Intimacy activities inventory — categorized, tiered expansion — SPEC 49 BUILT; on
  `feat/intimacy-activities-inventory`, PR pending).** Restructured the shared `INTIMACY_ACTIVITIES` from a flat
  ~30-string list into a **categorized, tiered** inventory `INTIMACY_ACTIVITIES_FULL` (~94 entries `{key, label,
category, tier}` across **14 categories**, tiers 1 gentle→5 extreme, sensual→extreme) — the foundational shared
  content the kink test (`50`) consumes as subscales. **All 4 §11 decisions asked first (all recommended
  defaults):** ship the proposed ~94 starter list as-is; **all categories, grouped, open by default** (no
  pick-categories step); **5 tiers**; **fold the two relationship dynamics into `power-exchange`** (slugs preserved
  as stable keys → no-loss carry-forward). Two minor §11 calls took the spec recommendation: keep `INTIMACY_ACTIVITIES`
  as the **flat label list** (least churn — generation reads it byte-unchanged) + add `INTIMACY_ACTIVITIES_FULL`;
  `INTIMACY_FANTASIES` left flat. **Builds on 46's stable-key `MatrixRow` model:** `activityRows.ts` iterates the
  categorized inventory in display order, matches the two oral rows by stable key, and the extended
  `LEGACY_ACTIVITY_KEY_MAP` carries every pre-49 split/rename (`'Bondage'`→`light-bondage-cuffs-ties`, `'Choking
(giving)'`→`breath-play-choking-giving`, `'BDSM / dom-sub play'`→`switching`, …) forward read-time (`'Squirting'`
  intentionally orphan-preserved — no close entry, no data loss); **no `schemaVersion` bump** (additive). New core
  `grouping.ts` (`groupMatrixRowsByCategory`/`matrixGroupsForRows`/`resolvedActivityMatrix`); additive
  `Question.matrix.groups` (`{label, rowKeys}[]`, intake-only); the `@selfos/answering` matrix renders **category
  headers** (plain `<h4>` headings — every group **open by construction**, never a collapsed `<details>`, so the
  full surface renders to the bottom — CLAUDE.md §7/§12) when `groups` present, **flat byte-identically** otherwise
  (questionnaire matrices pass none → unchanged). Catalog + `activityContext` + `IntakeFormPanel` pass the grouped
  matrix. **Safety (§8):** every entry stays in the 18+/`restricted`/owner-visible intimacy matrix; `taboo-fantasy`
  worded strictly as fantasy/roleplay (a forbidden-substring unit guard); no minors/real-non-consent/illegal as
  entries; boundary in the prompt + model, never a keyword filter. Code-reviewer **ship** (no blockers/should-fixes;
  carry-forward audited entry-by-entry, key-uniqueness verified, the grouped/flat render split + the partition
  invariant confirmed; applied the one nit — a defensive dedupe guard in the grouped render). Gate green: typecheck,
  lint, format (the pre-existing `site/index.html` prettier-unclean left untouched), **817 core + 801 desktop** unit
  (inventory integrity: unique keys/exhaustive category labels/~60–100 band/oral stable keys/taboo wording; grouping
  - ordering; pre-49 carry-forward incl. the `Squirting` orphan; synthesis label mapping; generation-still-reads-flat;
  - IntakeFormPanel grouped-render RTL), **E2E** (the onboarding intimacy flow now asserts grouped headers +
    renders-to-the-bottom + no-overflow at 390 **and** 360px; the anatomy-edit test doubles as the carry-forward proof
    — seeds a pre-49 `bondage` key → migrates to `light-bondage-cuffs-ties` on decrypt; the questionnaire matrix E2E
    stays green as the flat regression). Synced spec 49 (→ Built, §11 resolved) + cross-refs into 27 §5 and 08 §16.5a.
    **Sequencing: 46 (Built) → 49 (Built) → 50.** NOTE: a pre-existing, unrelated E2E failure (`progressive profile:
… depth invitation → Go deeper (29)`) fails identically on clean `main` (verified by stash+rebuild) — not caused
    by this change. **Lesson: when an inventory's display LABEL changes but the persisted KEY must stay stable, a flat
    list → categorized one is safe ONLY if `INTIMACY_ACTIVITIES` keeps pointing at the labels (generation is
    label-driven) and `LEGACY_ACTIVITY_KEY_MAP` maps every renamed old label/slug to the closest new stable key; and
    a long grouped matrix's "open by default" is best a plain heading (open by construction), never a `<details>`,
    so the §7 renders-to-the-bottom guard can't regress. A decrypt-the-persisted-value E2E that reads ONCE after an
    async Continue submit is racy under batch load — poll it.**
- 2026-06-25 — **Build (Intimacy & connection guided sessions — SPEC 48 BUILT; on `feat/intimacy-guided-sessions`,
  PR pending).** Greatly expanded the `16` guided-session **Intimacy & connection** group from 3 → **20 entries**
  (17 new: 16 chat + 1 structured `yes-no-maybe-builder`), spanning relational connection → explicit
  consensual-adult sexual wellness (sensual → kink/power-exchange). **All 4 §11 decisions asked first (all
  recommended defaults):** ship all 17 as proposed; explicitness **graded per session** (graphic where the topic
  calls for it — dirty-talk/kink/fantasy/exploring-an-act/edging/sexting/the builder; warm-but-non-explicit for
  `feeling-desirable`/`intimacy-after-change`); the Yes/No/Maybe builder is **conversation-only** (transcript +
  SessionInsight, persistence deferred to spec 50); **every entry stays in the 18+-gated intimacy group**
  (preserving the `adult === (group === 'intimacy')` invariant). **Purely additive content + the one structured
  exercise — NO schema, IPC, capability, or nav change:** a guided session is already an ordinary `05`/`09`
  Conversation carrying `guideId` (`16` §4.2), so streaming/metering/lifecycle/summarize/the 18+ ack all reuse
  unchanged; the builder reuses the existing `[[SELFOS:STEP:n]]` machinery (`kind:'structured'` + `steps`), no new
  step mechanism. **Safety (§8):** every addendum **leads** with the shared `frame()` not-therapy boundary
  (appended AFTER PERSONA + SAFETY by `buildSystemPrompt`); every **explicit** addendum states the consensual-adult
  / within-Anthropic-policy boundary in-prompt (consensual adults only; taboo only as fantasy/roleplay; never
  minors/real non-consent/illegal); the four trauma-intersecting entries (`sexual-shame`, `feeling-desirable`,
  `kink-power-exchange`, `exploring-an-act`) carry the §8.4 watch-for-distress → slow-down → validate →
  route-to-support clause (the code-reviewer's one should-fix: `exploring-an-act` was missing it; added, + a parity
  clause on kink); partnered entries carry a solo-framing fallback so the coach never presumes a partner who isn't
  there (§7). The **fake Claude** gained a builder-step branch gated strictly on the builder's unique addendum
  phrase (`'Yes/No/Maybe model'`, so it can't collide with the existing structured Thought Record E2E), streaming a
  real `[[SELFOS:STEP:1]]` marker so the stepper-advance E2E exercises genuine marker stripping. Code-reviewer
  **fix-first** (safety clause + spec-count reconcile applied; all mechanics — the 18+ invariant, structured
  reuse, fake-Claude isolation, content-correctness — verified). Gate green: typecheck, lint, format, **796 core +
  800 desktop** unit (catalog integrity + updated structured-set assertion + explicit-boundary + builder-steps;
  `promptBuilder`/`guidanceService` extended for a new intimacy id; SessionLauncher RTL), **E2E +2** (a new
  explicit card runs + summarizes [asserts `provenance.guideId` by decrypt] + 18+ gate + 390px overflow; the
  builder advances the stepper via a marker stripped from visible text). Visual QA at desktop (clean 3-up card
  grid with the 18+ badge + ⚙ Steps marker) + 390px (no overflow). Synced specs 48 (→ Built; §11 resolved; the
  spec's 16/19 arithmetic reconciled to 17/20) + 16 (intimacy-group + structured-set cross-refs). **Lesson: an
  all-in-one E2E that chains TWO full session flows (explicit card + summarize AND the builder + step-advance) +
  an overflow guard blew the 30s per-test budget under load (2/3 failed on `--repeat-each=3`) — split into two
  focused tests (~1.5s each, reliably green); each guided-session E2E should cover ONE lifecycle, not two.**
- 2026-06-25 — **Build (Home dashboard uplift + personalized encouragement engine — SPEC 53 Slice A BUILT; on
  `feat/home-encouragement-engine`, PR pending).** The capstone Home redesign + a deterministic recommendation
  engine. **All 8 §11 product decisions asked first (all recommended defaults):** section named **"For you"**;
  count **scaled 1–3 by proactivity** (off=hidden, gentle ≤2, active ≤3); recommendation phrasing
  **deterministic** (no per-load AI); momentum = **one warm header line** + 3 reflections (showed-up / explored-
  areas / goals-moving), **CONFIRMED no streaks/targets/gaps**; celebration = **transient success toast**; crisis
  suppression = **suppress all pushes while `aggregateCrisisSignal` recurring** (a single low-mood reading does
  not); the §3.6 **two-zone card map confirmed**; **reuse `coaching.proactivity`** (off = status-grid-only).
  **Core `@selfos/core/recommendations`:** a Zod-first **registry** (`registerRecommendationProvider`/`list`/
  `reset`/`registerBuiltIn` — the `contextProviders.ts` pattern) + **8 built-in providers** (continue-session,
  stale-goal, refresh-portrait, depth-invitation, synthesis-observation, guided-suggestion, questionnaire-gap,
  refresh-memory) + the pure **`rankRecommendations`** (filter gated/18+ → gather → crisis/off/new-suppress →
  dismissals → score → variety-dedup → top-N) + pure **`computeMomentum`** (positive counts only — `no streak/gap`
  is a TYPE-LEVEL guarantee) + **`pendingCelebration`** (newest recent uncelebrated, once). **Home restructured**
  into the §3.1 hierarchy: greeting + `MomentumLine` → `CrisisSupportBanner` → **`ForYou`** (the focal zone) →
  `OnboardingCard` (status) → status grid (`ContinueCard`/`WellbeingCard`/`DreamsCard`/`MemoryCard`/`InboxCard`)
  or `GettingStarted` → `WelcomeOrientationCard` (moved to the bottom so For-you leads) → `CelebrationMoment` toast
  → `CrisisFooter`. New components `ForYou`/`RecommendationCard`/`RecommendationItem`/`MomentumLine`/
  `CelebrationMoment`. **DELETED** the 6 absorbed cards — `GoalFollowupCard` + `InsightOfTheWeekCard` (40),
  `DiscoveryNudge` + `SuggestionsCard` (41/17), `ProfileFreshnessCard` + `DepthInvitationCard` (29) — folding
  their actions into `RecommendationItem` **verbatim** (goal Still on it / Mark done / Let it go, synthesis run +
  "Talk it through", guided start/regenerate, questionnaire gap-finder, depth go-deeper); removed `buildStatusLine`.
  **No new IPC, no new vault schema, no new AI spend:** reuses the spec-41 `discovery:*` device-local per-person
  seam for `rec:<dismissKey>` dismissals + `celebrate:<key>` signatures, and the spec-40 `coaching.proactivity`
  dial. Code-reviewer **fix-first** (all applied): the dismissal `dismissKey` is now **signal-aware** (e.g.
  `stale-goal:<goalId>:<lastTouchedAt>`) so a dismissed rec **re-surfaces when its signal changes** instead of
  dying forever (§7) — the reviewer's blocker-adjacent should-fix; removed dead `buildStatusLine`; deduped
  `stalestGoal` into one exported core `stalestOpenGoal` (the notification + the "For you" card can't diverge);
  fixed a stale test comment. Gate green: typecheck (all packages), lint, format, **791 core + 799 desktop** unit
  (engine rank/momentum/celebration/registry + re-surface-on-signal-change; Home/ForYou/RecommendationCard/
  CelebrationMoment RTL), **E2E +2** (the "For you" zone ranks/reflects-momentum/dismisses + 360px guard;
  proactivity-off hides the zone, keeps the grid). Visual QA at desktop (the focal "For you" zone leads above a
  clean status grid; warm, non-nagging). Synced specs 53 (→ Slice A Built, §11 resolved) + as-built amendments to
  17/29/40/41. **Slice B (48–52 providers) deferred** — each registers its own provider with NO `Home.tsx` edit.
  **Lesson: absorbing N hand-wired Home cards into one ranked engine means moving WHERE/HOW each is surfaced,
  never WHAT it does — keep each absorbed action verbatim inside the uniform `RecommendationCard`. A dismissal
  signature must carry the SIGNAL identity (the goal id + touch stamp), not just the provider id, or "Not now"
  silently kills the feature forever; and a `MomentumReflection` type that can only hold positive counts makes
  "no streaks/no overdue" a compile-time guarantee, not a review hope.**
- 2026-06-25 — **Build (onboarding intake quality pass — SPEC 47 BUILT; on `feat/onboarding-quality-pass`, a
  worktree, PR pending).** A holistic audit-and-remediate pass over the personal-onboarding intake (spec 18), after
  several user-reported bugs. **Owner decisions (asked first):** **Conservative** trim (fix wording/collisions/
  branching/layout + the synthesis bug; **cut nothing**), **keep section order**, **non-empty** placeholder guard,
  and scope = **onboarding intake AND the questionnaire builder** (the user overrode the spec's onboarding-only
  recommendation). 46 is already merged, so the sequencing question was moot. **Audit findings:** the catalog is
  clean — no two questions share an identical prompt (167 Qs), no id reused across sections, every branch trigger is
  earlier/same-section/discrete and can actually produce its match value (no stranded follow-ups), intimacy flows
  low→high with safety always before the `getSpecific` gate. **One real engine defect (audit-proven, §5/§7):**
  orphaned answers for branch-**hidden** questions (a trigger cleared after answering its follow-up) fed synthesis/
  analysis as if chosen. The **relay** answering page already filtered visible answers; the **Inbox**
  (`toAnswerList`) and the **intake** (synthesis `formAnswersMessages` + `factScopeForSection`) did not. Fix: one
  shared `visibleAnswers(questions, answers)` in `@selfos/core/questionnaires/answering` — Inbox + relay (refactored
  DRY) filter at submit, intake filters at synthesis (keeps the stored answer so a re-toggle restores it),
  `analyzeAssignment` defensively filters against the snapshot for pre-fix drafts. **Wording fixes (ids preserved):**
  `coachStyle` reframed to TONE ("What coaching tone do you respond to best?") dropping the "Challenge me" option that
  duplicated `supportStyle`; `appearanceDescription` "…how you look?" → "…your appearance?"; `importantDates` "Any
  important dates to remember?" → "Any dates you'd like me to remember?". **No schema/IPC change.** Tests: catalog
  collision + branching truth-table + cleared-trigger + coachStyle-distinct units, a `visibleAnswers` unit, intake +
  questionnaire-analysis drop-orphan units, and the intimacy conditional-reveal E2E extended with the cleared-trigger
  hide; updated the E2E's reworded labels + made 4 intake-synthesis tests realistic (they set the branch trigger the
  new filter requires). Gate green: typecheck, lint, format, **764 core + 803 desktop + 11 relay** unit; onboarding
  (13) + questionnaire/inbox/relay/compatibility (20) E2E green. Synced spec 47 (→ Built). **Lesson: a "submit/analyze
  the answers" path must filter to currently-VISIBLE questions or a cleared-trigger orphan feeds the model as if
  chosen — the relay had it right and the Inbox/intake didn't; centralize the rule (`visibleAnswers`) so surfaces
  can't drift. And a test that submits a branch-gated answer WITHOUT its trigger is an impossible-in-UI setup — a
  correct visibility filter exposes it, so make the setup realistic rather than weaken the filter.**
- 2026-06-25 — **Build (intimacy activity-matrix accuracy — SPEC 46 BUILT; GitHub issue #62; on
  `feat/intimacy-matrix-accuracy`).** The onboarding intimacy activity matrix showed a sexual-act oral row that
  was **wrong** for some people because the oral labels were **inferred** (own anatomy from `gender`, partner
  anatomy from `drawnTo`/orientation) — conflating who-you-date with what-they-have and giving trans/non-binary
  people generic fallbacks; worse, the resolved **label WAS the answer key**, so editing gender/orientation
  orphaned prior ratings. **Decisions (asked, owner-confirmed):** proceed with the redesign (diagnosis gate §1
  could not be met — the reporter's vault is encrypted behind the app Keychain, unreachable from the build env;
  the redesign fixes both the model flaw and the read-path regardless, so I did NOT ship an unverified
  single-cause guess); **Option A** matrix key model; anatomy questions live **inside the `getSpecific`** opt-in
  group; **casual/euphemistic wording** (not clinical "genitals"). Built: **`MatrixRowSchema`** (`string | {key,
label}`) + `matrixRowKey`/`matrixRowLabel` in core `schemas.ts` — questionnaire matrices keep plain-string rows
  (key === label, byte-identical); a rewritten anatomy-driven `activityRows.ts` (`ActivityRowContext` =
  `{ownAnatomy, partnerAnatomy}`, returns `MatrixRow[]` with **stable keys** `oral-receiving`/`oral-giving-penis`
  /`-vulva`/`oral-giving` + a `slugifyActivity` key per universal act/dynamic; `LEGACY_ACTIVITY_KEY_MAP`/
  `legacyKeyFor`/`migrateActivityMatrixValue` for pre-46 carry-forward, idempotent, no-data-loss, no
  `schemaVersion` bump); two **18+/`restricted`** catalog questions — `ownAnatomy` single _"What are you packing
  down there?"_ (Cock (penis) / Pussy (vulva) / Both or intersex / Rather not say) + `partnerAnatomy` multi
  _"What do you like a partner to have down there?"_ (Cock (penis) / Pussy (vulva) / Don't mind); wired through
  `activityContext` (reads anatomy from the intimacy section, not cross-section gender), `formatAnswerForSynthesis`
  (legacy-migrate scoped to the `activities` matrix, then key→label), core `answering.ts`
  (`isAnswered`/`formatAnswerForDisplay` by stable key), `questionnaires/trends.ts`, the `@selfos/answering` matrix
  render, `IntakeFormPanel` (live re-resolve from the anatomy answers + migrate the seeded value; dropped
  `profileGender`), `Onboarding.tsx` (dropped the gender read), `QuestionnaireBuilder` (edits rows by label).
  Anatomy is a `restricted` intake answer only — never a `Person` field, never in `buildDepictionNote`, never
  broadcast-shareable; `gender` stays a basics identity field, `drawnTo` standalone coaching context.
  Code-reviewer **ship** (privacy rails, migration idempotency/no-loss, Option-A additivity verified; applied the
  one nit — scope the legacy re-key to the `activities` matrix so a future intake matrix can't be silently
  re-keyed). Gate green: typecheck, lint, format, **757 core + 11 relay + 803 desktop** unit (+resolver truth
  table incl. the trans/nb-erasure regression + drawnTo-decoupling, +stable-key/slug/migration units, +synthesis
  stable-key & legacy carry-forward, +`IntakeFormPanel` live-resolve & no-orphan RTL), full E2E (the comprehensive
  onboarding flow drives the anatomy answers → asserts the #62 wrong row is absent → decrypts the matrix value
  keyed by STABLE keys; + a focused **edit-anatomy-without-orphaning** regression with the 390px matrix guard).
  Synced specs 46 (→ Built), 27 §4.2/§5/§7, 18 §14.5, 08 (`Question.matrix` rows). NOTE: `site/index.html` is
  prettier-unclean on `main` already (no CI format job; lint-staged only checks staged files) — pre-existing,
  left untouched. **Lesson: when a feature uses the resolved display LABEL as the persisted answer KEY, any
  re-resolution (an anatomy/gender edit) orphans prior ratings — split a stable `{key}` from the `{label}` and
  migrate legacy label-keyed answers read-time; and asking anatomy DIRECTLY (a `restricted` question) beats
  inferring it from gender/orientation, which both conflates concepts and erases trans/non-binary users.**
- 2026-06-25 — **Build (Session image attachments — SPEC 45 BUILT; on `feat/session-attachments`, a worktree,
  PR pending).** Lets a person attach images to a Session message so the AI coach can SEE them (Claude vision) —
  the issue-#63 "show the coach a screenshot" affordance. **§11 decisions asked first (all confirmed):** 5
  images/message + ~1568px downscale + no session cap; **store-on-send** (no orphans); **export, guided sessions,
  AND the iOS picker INCLUDED** (dream-analysis chat NOT). Built: a reusable **`@selfos/core/media`** core
  (`storeMedia`/`getMedia`/`deleteMedia` behind a caller-supplied path guard + `sniffImageMime` +
  `ALLOWED_IMAGE_MIME`/`MAX_IMAGE_BYTES`, the 08 §13.2 `encryptBytes` envelope generalized — surfaced only in
  Sessions, §12); additive `ChatMessage.attachments` (`AttachmentRefSchema`, **no schemaVersion bump**); widened
  `ClaudeMessage.content` to `string | ContentBlock[]` + a `flattenContent` helper, with BOTH transports
  (`anthropicClient` + the iOS `browserClaudeClient`) mapping image blocks to the SDK; `chatService`'s async
  vision mapper that **re-reads stored bytes host-side every turn** (Claude is stateless) and **skips a
  missing/corrupt attachment** so the turn still completes; metered as the existing `chat` event (no new usage
  type); `deleteConversation` purges the sibling attachments folder. IPC seam
  (`conversation:storeAttachment`/`:getAttachment`/`:exportAttachment` + `chatStream attachments?`), gated
  `sessions.own` + **path-scoped to the active person's named conversation in the bridge** (a path can't reach
  another person's/conversation's attachment); mime+size re-validated in main; the 5-cap re-enforced server-side.
  Renderer: client-side `downscaleImage` (canvas re-encode also strips EXIF), an **opt-in** `Composer`
  (`allowAttachments`) with paste/drop/file-picker + pending thumbnails + calm 5-cap/unsupported errors (so the
  shared Composer stays text-only on dream/intake surfaces), `MessageAttachments` grid, the `AttachmentThumb` +
  `Lightbox` design-system primitives (→ `/gallery`), `conversationStore` store-on-send + an attachment-url cache
  - "Save image" export. Code-review fixes applied. Gate green: typecheck (all packages), lint, format, **740
    core + 794 desktop** unit (+media core, +conversation attachments, +vision mapping both clients + fake flatten,
    +chatService vision/re-supply/missing-skip, +`scaledDimensions`, +Composer/AttachmentThumb/Lightbox/
    MessageAttachments RTL), + an E2E (attach → AES-GCM envelope on disk + PNG-magic decrypt → bubble thumbnail →
    lightbox + export-outside-vault → delete-purges-folder → 390px guard); sessions/guided E2E green. Synced spec
    45 (→ Built) + 05 (ChatMessage/ClaudeMessage amendment) + 01 (Lightbox/AttachmentThumb). Did the work in a
    `git worktree` since a concurrent agent is touching the shared IPC seam files (§11.1). **Lesson: widening a
    shared host type (`ClaudeMessage.content` → a union) ripples into every inline test fake that read `.content`
    as a string — a `flattenContent(content)` helper fixes them all; Electron's `createImageBitmap` rejects some
    hand-picked 1×1 PNG blobs, so build a real PNG (zlib IDAT + CRC32) for an attachment E2E; and the strict CSP
    blocks `fetch('data:…')` but `img-src 'self' data:` lets data-URL thumbnails render.**
- 2026-06-24 — **Fix (Questionnaires AI "Suggested" STILL hit "The suggestion set came back in an unexpected
  shape" — a SECOND root cause spec 37's fix missed; user-reported; on `fix/gap-finder-suggestion-shape`).**
  Diagnosed (not assumed) by tracing the parse path: the MALFORMED message fires when the gap-finder's Claude
  call SUCCEEDS but zero usable suggestions survive parsing — two compounding causes. **(1)** the prompt bug —
  `GAP_FINDER_SYSTEM` said _"Use the same answer types as generation"_ but never listed them (the model never
  sees the generation prompt in that call), so the live model guessed invalid `AnswerType` values
  ("text"/"scale"/"open"); **(2)** the INNER `questions` array on `QuestionnaireSuggestionSchema` was still
  strict (spec 37 only loosened `required` + the OUTER array), so one off-spec sample `type` failed the whole
  suggestion → with every suggestion losing one question the batch went empty → MALFORMED. Fix: one shared
  `SUGGESTABLE_ANSWER_TYPES` constant (`schemas.ts`) feeds the generation guide, the gap-finder prompt (now
  names the exact enum values), AND the parse (`SuggestionQuestionSchema.type` = the suggestable subset, so an
  authoring-only `matrix`/`roster` sample drops rather than seeding a broken builder draft); the gap-finder
  parses with a per-element-tolerant inner `questions` array (37 §3.1) so a bad sample question drops only
  itself + a suggestion with one good + one bad question survives; `type`/`rationale` tolerate omission (only
  a `title` + ≥1 usable question are required). Both offline fakes made imperfect (a mixed valid/off-spec
  sample question, 37 §10) so the E2E exercises the salvage. Tests: a regression where 3 suggestions each mix
  a valid + an off-spec `type` → all 3 kept (was 0), a prompt-lists-the-types guard, a missing-`type`/
  `rationale` tolerance case, and the Suggested E2E asserts the off-spec sample question is dropped while its
  sibling + the suggestion survive. Code-reviewer **ship**. Gate green: typecheck, lint, format, **727 core +
  769 desktop** unit, questionnaire E2E green. Synced spec 37 §12. **Lesson: a prompt that references a list
  it doesn't include ("same types as generation") leaves the model guessing invalid enum values — inline the
  enum; and the spec-37 tolerance must reach NESTED arrays (the inner `questions`), not just the top-level
  batch, or one bad child still sinks the whole parent.**
- 2026-06-24 — **Fix — collapsible life-area portrait (user-reported "IT LOOKS EXACTLY THE SAME"; on
  `fix/onboarding-sharing-ux`).** My flat grouping (faint gray uppercase headers + dividers) was too subtle to
  register as an improvement — the user still saw a wall of gray facts. **This time I showed an interactive
  MOCKUP (the `visualize` tool) of a bolder direction and got explicit sign-off BEFORE building** — the right
  move after repeated misses. Built: the long portrait now renders **collapsible life-area sections** — each a
  button header with a per-area icon, fact count, a "private" badge when it holds restricted facts, and a
  chevron — that expand on demand; **sensitive sections (any restricted fact) start COLLAPSED by default**
  (user-confirmed) so intimacy/trauma isn't on screen at a glance. Short insights stay a flat list. Verified
  with real Playwright screenshots (collapsed + expanded). Gate green: typecheck, lint, format, 724 core + 11
  relay + 769 desktop unit, full E2E. **Lesson: when "improve the UI/UX" feedback recurs, stop iterating
  blindly — show a concrete visual mockup and get the user to pick the DIRECTION before coding. A subtle
  restyle reads as "no change"; the user wanted a structural rethink (collapse the wall into navigable
  sections), which a mockup surfaces in one round instead of three failed PRs.**
- 2026-06-24 — **Fix — UX redesign of the Memory portrait + onboarding sharing (user-reported "greatly
  improve the UI/UX", twice; on `fix/onboarding-sharing-ux`).** The prior fix removed the chips but the
  surfaces were still poor and I'd done NO visual QA — the user (rightly) called it out. **Memory portrait
  card** was an unreadable wall of ~40 tiny gray facts with "sensitive" tags floating on their own
  right-aligned "blank" lines (`.factControls margin-left:auto` + `flex-wrap` wrapped the tag onto a new
  line). Redesigned: a long multi-area insight (the portrait) now **groups facts by life-area** with small
  uppercase headers (`groupFactsByArea`); facts are a clean **list with hairline dividers** + readable text;
  tags flow **inline right after the text**. **Onboarding sharing control** floated top-right of the prompt
  (`.sharingSlot margin-left:auto`), leaving a big empty gap, and the inline sensitive-confirm rendered there
  too; moved it to its **own line directly under the prompt, left-aligned**. **Verified with real Playwright
  screenshots** (seed a 24-fact portrait → screenshot Memory; open onboarding → screenshot the form) — the
  visual QA I'd skipped. Gate green: typecheck, lint, format, **724 core + 11 relay + 768 desktop** unit, full
  E2E. **Lesson: "greatly improve the UI/UX" is not satisfied by removing a control — it means LOOKING at the
  rendered result and redesigning for readability (grouping, dividers, typography, inline-not-floating tags).
  Do real visual QA (a seeded Playwright screenshot you actually open and judge), not just "tests pass" — a
  green suite says the data is right, not that the screen is readable.**
- 2026-06-24 — **Fix (onboarding sharing was broken end-to-end — user-reported; on
  `fix/onboarding-sharing-end-to-end`).** The user (rightly frustrated) found three connected bugs the
  "comprehensive" sharing E2E had MISSED — because it seeded `Insight`s with `shareableTypes` already set and
  asserted the gate, never driving the real onboarding→synthesis→Memory path. **(1) Share-by-default never
  reached EXISTING portraits.** `factScopeForSection` (+ the answer readers) returned `[]` for any section
  with no `answerSharing`, and `answerSharing` is only written on (re-)submit — so a portrait synthesized
  before per-question sharing showed **everything "Private"** in Memory, the Sharing card said "not sharing
  anything yet," and nothing flowed to a partner. Fix (user chose **auto-backfill**): a new pure
  `effectiveAnswerScope(sectionId, qid, answerSharing)` resolves a **missing** entry for an _answered_
  question to its **category default** (an explicit choice, incl. an explicit `[]` = Private, still wins;
  restricted answers default `[]`), wired into `factScopeForSection`, `buildSharedIntakeAnswerLines`, and
  `listOutboundSharing` — so existing portraits share by default (answers immediately, facts on the next
  refresh). **(2) The onboarding picker "did nothing"** on a sensitive question — the opt-in confirm rendered
  as a Banner at the **top of the section**, far off-screen from the popover; now it renders **inline in the
  question's (or bulk) sharing slot**, replacing the picker. **(3) Memory clutter** — onboarding facts carried
  a read-only "Private" chip on _every_ line (a wall); removed (clean cards), while AI-inferred facts keep a
  discreet `FactSharingControl` (you still need to share a session/dream insight). Sharing is otherwise seen +
  controlled in the "Manage sharing" panel (now populated by the backfill). **E2E that would have caught it:**
  a new test seeds a **pre-spec portrait** (answers, NO `answerSharing`, facts with no `shareableTypes`) →
  asserts the partner's context gets the answer (decrypt), the Sharing summary reflects it, and cards are
  clean. Gate green: typecheck, lint, format, **724 core + 11 relay + 768 desktop** unit, **106 E2E**.
  **Lesson: an E2E that SEEDS the post-state (insights with `shareableTypes` set) tests the gate, not the
  feature — drive the real producer path (onboarding form → submit → synthesis → Memory) AND the existing-data
  path (a portrait from before the feature), or a whole class of "it doesn't work for real users" bugs slips
  through green. And "share by default" must backfill EXISTING data, not just newly-submitted sections.**
- 2026-06-24 — **Audit + fix (relationship-scoped sharing specs 42–44 post-merge review; on
  `fix/relationship-sharing-audit-followups`, PR pending).** A complete audit of the merged 42/43/44 work
  (privacy gate, context-assembly, trust boundary, E2E) — the core boundary (`factSharedWithViewer` +
  `relationshipTypesFromSubjectToViewer`, reused by `summarizeForContext`/`listRelatedShareableInsights`)
  is airtight: restricted/flagged short-circuit, fail-closed, partner-vs-sibling guarded by a decrypt-level
  E2E. The `code-reviewer` agent + an independent read found **3 should-fixes**, all fixed: **(1)**
  `buildLinkedPeopleContext` (the **dreams** linked-people context) bypassed the centralized gate — it now
  routes through `factSharedWithViewer` (honoring `shareableTypes`, excluding `flaggedInaccurate` — a
  **pre-existing** leak on the dreams surface) **and emits the §3.4 confidentiality preamble**, so "shared ≠
  shown" holds on dreams too. **(2)** Memory's per-fact scope picker was editable for **onboarding** facts,
  whose scope is **derived from `answerSharing`** and recomputed on re-synthesis → a Memory edit silently
  reverted (could **re-widen** a narrowed scope); intake facts are now **read-only** in the card + SharingPanel
  (change via "Edit answer", the single source of truth). **(3)** a corrupt scope now **fails closed** —
  `InsightFact.shareableTypes` + `IntakeSection.answerSharing` gained `.catch(undefined)`, so a malformed
  value degrades to own-only instead of throwing out of a related viewer's whole `buildContext`. Plus nits:
  removed a non-null `!` (CLAUDE.md §4) and deduped the inverse-type map into a single
  `INVERSE_RELATIONSHIP_TYPE` in `@selfos/core/sharing`. Gate green: typecheck, lint, format, **719 core + 11
  relay + 768 desktop** unit (+4), **105 E2E**. **Lesson: when a feature centralizes a privacy gate into one
  function, grep EVERY context-assembly caller and migrate them all — `buildLinkedPeopleContext` was left on
  the old inline filter, so the new relationship-type scoping AND the confidentiality rule silently didn't
  apply on the dreams surface; and a derived value (an intake fact's scope, from `answerSharing`) must not get
  an independent editable control that a recompute silently reverts.**
- 2026-06-24 — **Build (Memory dashboard overhaul — SPEC 44 BUILT; on `feat/memory-dashboard-overhaul`, PR
  pending).** The Memory half of the relationship-sharing group (consumes spec 42, amends spec 20) — making
  Memory **readable, consumable, and trustworthy**. **(1) Stats summary header** (`StatsSummary` + pure
  `stats.ts` derivations — `overviewStats`/`confidenceStats`/`sharingStats`): "SelfOS knows N things" by source +
  last-updated · a confidence distribution (text + a non-colour-only bar) · "you're sharing M things — Partner
  (k) …" with a **Manage sharing →** link (from `memory:outboundSharing`); shown only when there's something to
  summarize. **(2) Trends promoted to the top**, open by default (was a collapsed `<details>` at the bottom).
  **(3) Split-by-source corrections** in `InsightCard`: an ONBOARDING (`intake`) insight gets **Edit answer**
  (deep-links to the originating section via `provenance.intakeSection` → onboarding `openSection`) + Delete and
  **no flag** (you fix what you told us by editing the answer); an AI-INFERRED insight keeps the correction
  toggle, **relabelled "This isn't right about me"** (clear `aria-label`, not a bare flag icon). **(4) Per-fact
  sharing** swaps the broadcast `ShareToggle` for the spec-42 `RelationshipScopePicker` (`FactSharingControl`) —
  a legacy broadcast fact reads as "shared with all your relationship types," narrowable; a `restricted`
  sensitive fact shows a sensitive chip + the **deliberate two-step** (confirm → choose a type) that un-restricts
  AND scopes in one write (the 42 §8 "two explicit acts," never a default). **(5) `/memory/sharing` transparency
  surface** (`SharingPanel`) — every shared item + its scope + the concrete recipients ("Shared with Partner ·
  reaching Pat"), each editable in place. **Owner decision (asked, 2026-06-24): intake answers are scope-editable
  in place** (resolving the spec's §3.5↔§6 gap) → new **`intake:setAnswerSharing`** channel + `setIntakeAnswerSharing`
  core fn (gated `intake.own`, active-person-scoped; empty ⇒ Private). Extended the `insights:update` facts
  contract with additive `shareableTypes`/`restricted` (merged by id server-side, so a normal edit preserves
  them — a sensitive fact can ONLY be un-restricted by the explicit two-step). Extracted a shared
  `availableRelationshipTypesFor` helper (Memory/SharingPanel/onboarding — DRY). Code-reviewer **fix-first**
  (privacy boundary verified airtight; applied: hide the sharing picker on a flagged fact [it can't reach anyone
  anyway] + a store-level multi-fact `setFactScope` unit test). Gate green: typecheck, lint, format, **715 core +
  11 relay + 768 desktop** unit (+stats, +StatsSummary, +FactSharingControl, +SharingPanel, +insightStore
  setFactScope, +setIntakeAnswerSharing core, +2 coreBridge: scope-to-partner/un-restrict + answer scope),
  **105 E2E** (+1: stats header → type-scope a fact to partner [decrypt reaches partner, not the sibling] →
  "not right" [decrypt absent from own context] → Manage sharing surface → Edit answer deep-link; 360px guards on
  Memory + the sharing panel). Visual QA at desktop + 360px (real Electron screenshots: stats row, trends-at-top,
  the sharing panel with scope chips + recipients). Synced spec 44 (→ Built) + 20 (amended). **Lesson:
  `updateInsight` REPLACES the facts array with the patch, so a per-fact scope edit must send EVERY fact (the
  changed one + the rest minimal, preserved by merge-by-id) or it silently drops the siblings; and a still-open
  `RelationshipScopePicker` popover overlays a sibling row's control — an E2E must close it (Escape) before the
  next click or the click times out (the trace's last action localized it).**
- 2026-06-24 — **Build (onboarding per-question sharing — SPEC 43 BUILT; on `feat/onboarding-scoped-sharing`,
  PR pending).** The onboarding half of the relationship-sharing group (consumes spec 42's model). Each intake
  **form question now carries a relationship-type sharing chip** (the spec-42 `RelationshipScopePicker`),
  **shared-by-default** per category presets (restricted intimacy/trauma ⇒ Private), with a **per-section bulk
  control** (+ "Mixed"), the honest **"informs their AI, never shown to them"** explainer, a **sensitive-opt-in
  confirm**, and a one-tap **"refresh your portrait"** after an edit — so the marriage/sex-counseling case
  ("my partner's AI can use this, not my coworker's") is expressible in the flow. **Core:** new pure
  `@selfos/core/intake/sharingCategory.ts` (`SECTION_SHARING_CATEGORY` + `defaultScopeForQuestion`/
  `questionCategory`/`questionDefaultsPrivate`; `IntakeFormQuestion.category?` additive); `submitSectionForm(…,
sharing?)` writes `IntakeSection.answerSharing` (defaulting every answered question from its preset);
  `synthesizePortrait` tags each fact's `shareableTypes` via `factScopeForSection` — the **most-restrictive
  INTERSECTION** of the section's per-question scopes, read **only** from explicit `answerSharing` (a pre-spec
  section merely re-synthesized stays own-only — no surprise broadcast), with the normal-vs-"(sensitive)"
  candidate split mirroring `formAnswersMessages`; a `restricted` fact stays restricted unless its answers are
  opted in (then non-restricted + type-scoped). Intake facts still **never broadcast** (`shareable:false`) —
  `shareableTypes` is the only share path. **IPC:** `intake:submitForm` carries `sharing` (Zod-validated +
  active-person-scoped in the bridge). **`@selfos/answering`** gains an optional **render-prop** `sharing:
{ renderControl(questionId) }` (the package stays free of the app design-system; the host renders the picker),
  rendered in a `flex-wrap` question header row (no inner scrollbar at 360px) — **questionnaires pass nothing →
  unchanged**. Code-reviewer **fix-first** (one should-fix: the per-section **bulk** control bypassed the §8
  sensitive confirm for a restricted question inside a non-restricted section [health/substances] — now confirms
  when sharing any sensitive default-private question; +RTL test; +documented the bounded model-attribution
  residual in §8). Gate green: typecheck, lint, format, **714 core + 751 desktop + 11 relay** unit, **104 E2E**
  (+1: scope basics → Partner → decrypt `answerSharing` + the fact's `shareableTypes` → the partner's context
  has the fact behind the confidentiality preamble, the sibling's has neither; 360px overflow guard). Synced
  spec 43 (→ Built) + 18 (§8.3 default is now per-question). **Lesson: the promoted PROFILE field (e.g.
  `occupation`) keeps its independent spec-15 field-share (shared to all related by default) — spec 43 only
  governs the intake ANSWER + the derived FACT, so the spec-43 E2E signal is the fact text + the confidentiality
  preamble, never the bare promoted value (which leaks to all relatives via spec 15); and the picker chip's
  accessible name starts with the question prompt, so a `getByLabel('<prompt>')` collides — target the textbox
  role or use `{exact:true}` (the recurring substring-collision footgun).**
- 2026-06-24 — **Audit + fixes (specs 37–41 post-merge review; on `fix/audit-37-41-followups`, PR open).** A
  deep audit of the five merged specs (one code-reviewer per spec) surfaced **1 BLOCKER + several should-fixes**,
  all now fixed with tests on a branch (full gate green: typecheck, lint, format, **700 core + 11 relay + 745
  desktop** unit; E2E 103/103 — the lone `dreams: link a household person` failure is a pre-existing
  Playwright-Electron timing flake that passes in isolation, unrelated to these changes). Fixes: **(spec 40
  BLOCKER — privacy leak)** the cross-feature synthesis digest never ran insights through the context-feed
  boundary, so a **muted dream** (`informsContext:false`) and **wholly-flagged** insights leaked into the AI
  pass — it now filters via the newly-exported `feedableInsights` + skips wholly-flagged summaries, mirroring
  `summarizeForContext` exactly (the docstring already CLAIMED this; the code didn't). **(spec 41)** the Claude +
  OpenAI **API keys rendered "Synced across devices"** — they're device-local secrets; added `scope:'device'` to
  `ai.apiKey`/`ai.test`/`dreams.imageApiKey`/`dreams.imageTest` (+ a `__resetBuiltins()` test hook + regression
  test — the gap that let it ship). **(spec 37 — safety)** a **TRUNCATED** session-analysis reply was salvaged to
  a summary-only insight, silently dropping the trailing `crisisFlag`; it now reports `TRUNCATED` (a retry) so the
  flag can surface, matching the dream path — a complete-but-malformed reply still salvages (`classifyParseFailure`
  gate); also escaped the field name in `salvageJsonObjectField`. **(spec 39)** auto-reconcile **stamped its 24h
  throttle before the AI/budget gate**, so a transient AI-off/over-budget/**stream-ERROR** launch suppressed the
  cadence for 24h — the stamp moved to AFTER the pass and is skipped for the no-spend reasons (AI_OFF/BUDGET/ERROR)
  while a billed-but-unparseable pass still stamps (no re-spend). **(spec 38 — test gap)** added a bridge test
  proving **re-ask auto-revokes the prior relay link** (the old link → 404, the anti-double-submit §3.6 claim that
  was previously asserted only by a comment). **Then fixed the two items first flagged for a decision (owner: "fix
  anything that needs to be addressed"):** (39 §4.4) goals were **double-grounded** into coaching context — once as
  legacy `Goal:` insight facts AND via the new "Open commitments" line; now the `Goal:` facts are EXCLUDED from the
  subject's own-context emit (a shared `GOAL_FACT_PREFIX` in insightStore), so a goal reaches the coach once (the
  structured line, which carries status/due/staleness) — the facts stay on the insight for the Sessions wrap-up
  card + per-fact sharing, and a goal SHARED with another person still reaches their context. (40 §3.4/§11-Q4) added
  the resolved **proactivity-specific per-week synthesis cap** (`SYNTHESIS_WEEKLY_CAP=7`, rolling 7-day count of
  `coaching.synthesize` events, new `CAPPED` reason, owner-override bypass) so the manual "Look again" path can't run
  away on cost. +tests for both (no double-ground in assembled context + a goal still reaches a sharee; the 8th
  weekly pass is CAPPED with no spend). **Lesson: a digest/grounding
  builder that reads insights directly must run them through the SAME `feedableInsights` boundary as
  `summarizeForContext`, or muted/flagged content leaks into an AI pass — a docstring claiming the boundary isn't
  the boundary; and a throttle/cooldown must be stamped only after a pass that actually SPENT, never before the
  availability gate, or a transient blip silences the cadence for the whole window.**
- 2026-06-24 — **Build (discoverability, empty states & first-run polish — SPEC 41 BUILT, all 5 slices; on
  `feat/discoverability-empty-states`, PR pending).** A renderer-only UX polish pass to make the app
  self-explaining. **§11 resolved with the owner first (recorded in spec 41 §11):** full empty-state audit;
  one-time tips ship (gap-finder + depth invitations); proposed role-aware AI copy; a small text scope badge;
  orientation = a dismissible Home card + an account-menu re-open; nav left as-is; dismissals per-person +
  per-device. **Slice 1 (highest-value):** one `AiUnavailableNotice` component + `aiUnavailableMessage` helper
  — the single source of truth for role-aware AI-unavailable copy (owner → "Set up Claude in **Settings → AI**"
  link; member → "ask the person who set up this household to turn it on" — generic, never names the owner,
  never implies a key; offline → a connection line for both; unknown role → the **safer member** copy) — swapped
  onto **every** AI surface (Sessions launcher + composer, SuggestedSessions, the Draft-with-AI + Suggested
  panels, Memory refresh note, compatibility send + both Results, dream analysis + patterns, onboarding, and
  DreamImagePanel's member case). **Slice 2:** actionable, capability-gated empty states — Inbox (→ Create a
  questionnaire), Memory (→ "insights appear after analysis" + Start a session), Dreams-no-image (a calm "No
  image yet" distinct from the REFUSED/ERROR banners), Home (`DiscoveryNudge` for a near-empty person + a richer
  `GettingStarted` that also points at a guided session / dreams / a questionnaire), Dreams journal, People, and
  the Questionnaires list (the header-action surfaces use a differently-worded in-card CTA — "Add your first
  person" / "Log your first dream" — to avoid a duplicate-label collision). **Slice 3:** the `ScopeBadge`
  device-vs-synced signal on every setting (a borderless ghost label, visually + a11y-distinct from the bordered
  "Admin only" pill; both can sit on one row; `/gallery`). **Slice 4:** the first-run orientation
  (`WelcomeOrientationCard` "How SelfOS works" + the account-menu `AboutSelfOsDialog`, sharing `OrientationBody`
  - the not-medical line) and one-time `OneTimeTip`s on the gap-finder + depth invitations — backed by a new
    device-local, per-person `discovery:getDismissals`/`:setDismissals` seam (additive `DeviceState.discoveryDismissals`,
    keyed by the active person in the bridge — the trust boundary; the spec-35 precedent) + a `discoveryStore`
    reset/loaded in the AppShell per-person effect. **Slice 5:** 360px geometry guards. Gate green: typecheck,
    lint, format, **697 core + 754 desktop** unit (+ `AiUnavailableNotice`, `ScopeBadge`, discovery store/components,
    the per-person discovery coreBridge test, and updated empty-state/AI-copy assertions across ~10 suites), **E2E
    +4** (role-aware AI-unavailable owner-vs-member, Inbox → builder, the scope signal, orientation
    appears→dismiss→re-open→relaunch-gone). Visual QA at desktop (orientation card + not-medical line, the Synced /
    This device badges, the discovery nudge). Synced spec 41 (→ Built), 01 (`ScopeBadge`/`OneTimeTip`), 02 (the
    account-menu items), 03 (the scope-signal note). **Lesson: a "fix the AI-unavailable copy everywhere" task is
    really a centralization task — one role-aware component swapped onto every surface beats N hand-rolled strings,
    and the owner/member split must be the trust-aware one (a member never sees a key prompt or owner-naming, and
    an unknown role falls to the safer member copy). The macOS traffic-light inset makes the titlebar wider than a
    360px window in E2E, but that inset doesn't exist on the real 360px target (iOS), so the established 360px guard
    is the `overflow-x:auto|scroll` element scan (excluding the intentional settings section-nav pill row) + a
    `main`-width check, NOT a document-width assertion.**

- 2026-06-24 — **Build (proactive coaching — SPEC 40 BUILT, all 5 slices; on `feat/proactive-coaching`, PR
  pending).** The behaviour layer that ACTS on what spec 39's memory/goals know. **§11 resolved with the owner
  first (all decisions recorded in spec 40 §11):** a single per-person `coaching.proactivity` enum
  (off/gentle/active, **default gentle**, depth-ask kept separate); nudges live **in-session + Home cards +
  spec-35 notifications, coalesced**; synthesis on a **weekly throttle + ≥3-new-insight** launch/focus cadence
  (active = 3d/≥2) + a manual "What are you noticing lately?"; cross-insight crisis at **≥2 crisis flags in 14d
  OR the nightmare nudge** → the Home supportive banner (never a notification, never disabled by the setting); a
  synthesis observation **yields** to a same-area depth/freshness nudge. **Slice 1 (in-session, free):**
  `@selfos/core/coaching` `goalRaiseInstruction` (the `depthAskInstruction` sibling, appended AFTER
  persona+safety+context) + per-person `CoachingPrefs` read in the bridge; `coaching:getPrefs/setPrefs`; a
  **member-visible Coaching settings section** (per-person via a `CoachingPrefs` file, NOT the household
  registry) + `ProactivityControl`. **Slice 2 (crisis, no-AI):** `aggregateCrisisSignal` (renderer-computed,
  the `hasRecentCrisis` precedent — no IPC channel) + a Home `CrisisSupportBanner` (non-dismissible,
  resources-first, independent of the mood chart; supersedes the WellbeingCard's session-only banner). **Slice 3
  (the one extra AI spend):** `coachingSynthesisService` (`synthesize`/`getSynthesis`/pure
  `shouldSynthesize`/`countNewInsights`) + `CoachingSynthesis` cache + `coaching.synthesize` usage type +
  per-person device-state throttle marker; tolerant-parse + **meter-before-parse**; digest is structured-only
  (own insights' summaries + **non-restricted/non-flagged** facts + dream stats, never transcripts); a cadence
  hook + `synthesisStore` + Home `InsightOfTheWeekCard` ("Talk it through" seeds a session via a Composer
  `initialText` handoff). **Slice 4 (goal nudges):** the `goal-followup` notification kind + source (≤1,
  stalest-first, onChange) + Home `GoalFollowupCard` (Still on it / Mark done / Let it go → `goals:setStatus`;
  a tracked goal now counts toward "not new"). **Slice 5 (coordination):** the `coaching-synthesis` notification
  kind + the same-area yield to depth/freshness; phone-width overflow polish (`.cardHead` flex-wrap + `Inline`
  wrap). Code-reviewer **ship after one should-fix** (the synthesis EMPTY gate now counts RECENT in-window
  insights so an all-stale history can't bill an empty digest; +per-person setting scope `device`; honest
  `AI_OFF`). Gate green: typecheck, lint, format, **697 core + 11 relay + 715 desktop** unit, **99 E2E** (+4).
  Synced spec 40 (→ Built; the two as-built deviations recorded). **Lesson: a synthesis/EMPTY gate must use the
  SAME recency window the digest does (counting all-time approved insights let an all-stale history pay for an
  empty pass); and a per-person preference belongs in a `CoachingPrefs` file read in the bridge, not the
  household/device settings registry — its `vault`/`device` scopes can't express per-active-person, so the
  registry entry stays inert while the custom control owns the real state via `coaching:get/setPrefs`.**
- 2026-06-24 — **Feedback — HARD RULE (forceful): ALWAYS create _AND RUN_ E2E to verify work — never defer or
  skip it.** I shipped spec 38's PR with E2E "pending on-machine verification" on a bogus "needs a display"
  excuse. The user corrected this firmly. E2E **runs headlessly here**: `pnpm --filter @selfos/desktop exec
electron-vite build` once, then `pnpm exec playwright test [-g "<name>"]` (the `_electron.launch` harness needs
  no visible display — proven by running the existing suite + 2 new spec-38 tests, **90/90 green**). Sharpened
  CLAUDE.md §7 DoD (the E2E item now leads with "ALWAYS WRITE AND RUN; a slice is NOT done until its E2E is
  green"). Wrote the missing spec-38 E2E (draft-vs-ready + branch validation through the real builder UI; and the
  full discoverability→export flow: seed a submitted **Private** send → the `responses-arrived` notification names
  the responder → "View results" deep-links to Results → **Export CSV writes a real file outside the vault** and
  the assertion confirms the numeric value is present but the **Private prose is absent**). On
  `feat/questionnaire-lifecycle` (PR [#47]). **Lesson: E2E is runnable in this environment — the "no display"
  claim was wrong; build once then `playwright test`, and treat green E2E as a non-negotiable gate, not a TODO.**

- 2026-06-23 — **Build (living memory & continuity — SPEC 39 BUILT, all 5 slices; on
  `feat/living-memory-continuity`, PR open).** Memory **accreted but never self-healed** (reconciliation ran
  only on a manual "Refresh"), goals were just `Goal: …` text facts (no follow-through), and two share-cleanup
  leaks existed. **§11 resolved with the owner first (all recommendations confirmed):** auto-reconcile on
  threshold(≥5 new insights)+gap(>14d) at launch/focus, 24h device-local per-person throttle,
  `memory.autoReconcile` opt-out (default on); **confirm-before-apply merges** (propose-only → "Needs your
  review"); a **new `@selfos/core/goals` store** + `GoalSchema` (open/inProgress/done/stale/abandoned); stale =
  past-due OR ≥21d untouched (derived, persisted on confirm); flag strips share + `retractedShareAt`; legacy
  retro-tag via no-AI `SECTION_LIFE_AREA`/keyword map during reconcile; a bounded "open commitments" grounding
  line in `summarizeForContext`. **Slice 1 (cleanup):** `reapOrphanShares` on `people:delete` + share-retraction
  on `flagInsightFact` (closes §1 C1/C2). **Slice 2 (goals backend):** `goalService` (extract/de-dup/setStatus/
  update/delete + pure `isGoalStale`/`effectiveGoalStatus`), wired into `sessionAnalysisService` (no extra
  spend), `goals:*` IPC gated `memory.own` + active-person scoped. **Slice 3 (goals UI):** the Memory **Goals &
  commitments** section + `GoalCard` + `GoalStatusChip` (→ `/gallery`) + per-person `goalStore`; a gentle stale
  "still working on it?" prompt. **Slice 4 (auto-reconcile):** `shouldAutoReconcile` + `useMemoryReconcile`
  cadence + `memory:refresh({auto})` (calm `SKIPPED` no-op when not warranted) + `MergeProposal` store +
  `memory:reconcileState`/`memory:resolveProposal` + the "Memory last tidied …" signal; reconciliation now
  **queues** merge proposals instead of silently folding (confidence/category still auto-applies). **Slice 5
  (retro-tag):** `retroTagLegacyPortraits` rides any reconcile pass — **prefers `Emotions & patterns`** when a
  legacy distress fact also matches an earlier-ordered keyword (the §28/§8 never-narrow-distress invariant, the
  code-reviewer's one should-fix). All schemas additive-optional (no migration). Code-reviewer **ship** (privacy/
  trust-boundary, confirm-before-apply, flag-retraction, metering-before-parse all verified; applied the retro-tag
  distress fix). Gate green: typecheck, lint, format, **633 core + 11 relay + 670 desktop** unit (+goals/cadence/
  proposals/retro-tag/retraction/reap), **92/92 E2E** (+4: goals lifecycle, share-retraction decrypt, reap-on-
  delete decrypt, auto-reconcile usage event). Visual QA at desktop + 360px. Synced spec 39 (→ Built) + spec 20
  §3.5/§4.3 (amended: reconciliation is cadence-gated + confirm-before-apply). **Lesson: a no-AI keyword
  retro-tagger picks the FIRST taxonomy match, which silently demotes a distress fact off the always-on CORE
  guarantee if an earlier-ordered area (Work/Money) also matches — mirror the emotions-first safety rule
  (`selectPortraitFacts`) and prefer `Emotions & patterns` whenever it's among the matches; and "confirm-before-
  apply" means reconciliation must NEVER fold/delete an insight inline — queue a `MergeProposal` and delete the
  source only on the user's accept.**
- 2026-06-23 — **Build (AI output robustness & honest failures — SPEC 37 BUILT; on `feat/ai-output-robustness`,
  PR open).** A whole class of bugs came from brittle handling of Claude's JSON: an all-or-nothing `safeParse`
  that drops a good batch over one bad element, a strict `.parse` that nukes an otherwise-perfect result over one
  off-spec field, and messages that **blame the user's data** when the real cause was a parse failure / truncation
  / refusal. **Fixed the reported gap-finder bug** end-to-end ("No suggestions… add more about the people" fired
  AFTER a successful call because `QuestionnaireSuggestionSchema.questions[].required` was `z.boolean()` [the model
  omits it] + an all-or-nothing array parse + a data-blame message). Built ONE shared `@selfos/core/ai/jsonSalvage`
  utility (the §11 "centralize" decision): non-throwing `extractJsonObject`/`extractJsonArray`, a string-aware
  balanced-brace `salvageJsonArray`/`salvageJsonObjectArrayField` (generalizing the gold-standard portrait
  salvage) + `salvageJsonObjectField` (recover a leading essential string from a truncated object), a
  `tolerantArray(element, sentinel, keep)` Zod helper (per-element `.catch` → drop the bad, keep the rest), and
  `classifyParseFailure`/`aiFailureMessage`/`classifyParseOutcome` — an **honest taxonomy**: `TRUNCATED` (empty/
  unclosed → "cut off, try again"), `REFUSED` (refusal-prose, no JSON — **last-resort, never assumed first**),
  else `MALFORMED` ("unexpected shape"). Widened `AiFailureReason` (+`TRUNCATED`/`MALFORMED`) + the inline result
  unions; loosened the suggestion schema's `required` → optional; converted the strict draft schemas to tolerant
  (require only the essential field, `.catch` optionals, `tolerantArray` batches) and adopted the shared
  parse+classify across **gap-finder, generation, improve, variant, analysis, alignment, context-only distill,
  session analysis, dream synthesis, reconcile, the guided-suggest twin, and the portrait** (migrated onto the
  shared helpers). **Owner decisions (asked first, all recommendations):** proposed wording approved; show any
  partial (≥1); NO one-retry on TRUNCATED (no surprise spend); empty-context kept as a **PRE-CALL** check
  (`isThinContext` — the gap-finder hint fires without spending; a post-call zero is now an honest parse-outcome,
  never a data blame). **Invariants verified:** meter-before-parse preserved everywhere; `crisisFlag`/
  `distressSignal` preserved with `.catch(undefined)` (never coerced, never dropped by per-element salvage, §8);
  privacy boundaries untouched (salvage operates only on the reply). Offline fakes made **imperfect by default**
  (gap-finder fake omits `required`) so the suite exercises real salvage. Code-reviewer **ship** (meter-before-
  parse, crisis-signal, privacy, variant option-count safety all verified; applied the 2 nits — fixed a split
  comment + "suggestion set" noun so the message reads cleanly). Gate green: typecheck, lint, format, **599 core +
  11 relay + 660 desktop** unit (+27 shared-helper, +gap-finder regression [3 `required`-less → 3 shown, was 0],
  +per-service salvage/truncation/refusal cases, +`SuggestedPanel` RTL), **88/88 E2E** (+1 driving Suggested with
  an imperfect fake → suggestions appear, no data blame). Synced spec 37 (→ Built). **Lesson: a strict `.parse` on
  a model reply is the wrong contract — one off-spec optional field or one bad batch element must never discard an
  otherwise-usable result, and the parse boundary must own a balanced-brace salvage for truncation; classify a
  "no usable output" as TRUNCATED/MALFORMED first and REFUSED only on detected refusal-prose (never assume a
  refusal); and offline fakes that return flawless JSON HIDE this class of bug — make them imperfect by default.**
- 2026-06-23 — **Build (relationship-scoped sharing — the FOUNDATIONAL sharing model; SPEC 42 BUILT; on
  `feat/relationship-scoped-sharing`, PR open).** Sharing was all-or-nothing — a fact was broadcast to EVERY related
  person (`shareable:true`) or one person id (`shareableWith`), and ALL intake data was hardcoded own-context-only —
  so "share with my partner but never my parent/coworker" (the marriage/sex-counseling case) was inexpressible. Built
  the **read + model** (the producers/surfaces are specs 43/44): a fact/intake-answer now names the **relationship
  types** whose people's AI may use it, resolved against the **live graph at buildContext time**. Schema (additive,
  **no schemaVersion bump**): `InsightFact.shareableTypes` + `IntakeSection.answerSharing`. ONE pure gate
  `factSharedWithViewer(fact, viewer, grantedTypes)` in `schemas.ts` (broadcast ∨ per-person ∨ type-scope, **AND**
  not-`restricted` **AND** not-`flaggedInaccurate`) + a pure resolver `relationshipTypesFromSubjectToViewer`
  (parent↔child **inverse derivation**) + `scopeGrants` (`@selfos/core/people/relationshipScope`). `summarizeForContext`
  / `listRelatedShareableInsights` rewired onto the gate — the CALLER resolves `grantedTypes` + passes them in, so
  `insights` never imports `people`/`intake` (the cycle-avoidance pattern); shared **intake answers** read into a
  related person's context via `buildSharedIntakeAnswerLines` (imports the catalog by its **direct path**, not the
  barrel, to dodge the people↔intake cycle). The §3.4 **confidentiality preamble** prefixes any cross-shared block —
  "shared ≠ shown": the recipient's coach may USE but never quote/attribute/reveal it (the load-bearing
  couples-counseling guarantee). `SHARING_PRESETS` constant (partner=all; close family/friends=all-but-intimacy/trauma;
  coworker=basics/work/values; ex/other=nothing; intimacy/trauma=partner-only). Transparency: `listOutboundSharing` +
  the **own-scoped, `memory.own`-gated `memory:outboundSharing`** IPC (what you share + the concrete people receiving
  it). Renderer: a reusable **`RelationshipScopePicker`** (collapsed chip → popover checkbox list + "Private (only me)"
  - the honest explainer; `flex:none`, text/icon not colour-only, §12 dropdown handling) + shared copy
    (`describeScope`, `confidentialityPreamble`) in `@selfos/core/sharing` + `/gallery`. **Safety invariant (exhaustively
    tested):** a partner-scoped fact reaches the PARTNER, never a sibling/parent/coworker; a `restricted` fact reaches NO
    one even when type-scoped; a corrupt scope fails **closed**; removing the edge re-gates at read. Code-reviewer
    **ship** (privacy boundary + trust boundary + cycle safety all verified airtight; applied the one nit — name the
    author in the questionnaire-generation preamble). Gate green: typecheck, lint, format, **582 core + 11 relay + 663
    desktop** unit (resolver/`scopeGrants` truth table, partner-vs-sibling/restricted guard, transparency read,
    `RelationshipScopePicker` RTL, `memory:outboundSharing` gating) + a decrypt-level E2E privacy guard. **Lesson: when a
    shared file in a SHARED working tree holds BOTH your hunks and a concurrent agent's (here `schemas.ts` — they added a
    `TRUNCATED` `AiFailureReason` for spec 37), a whole-file `git diff` patch drags their half across; do feature work in
    a `git worktree`, and if a patch already captured a foreign hunk, `git checkout --` the file and re-apply ONLY your
    hunks. And keep the sharing gate as ONE pure predicate (`factSharedWithViewer`) the caller feeds resolved types into,
    so `insights` stays cycle-free and the boundary is defined exactly once.**
- 2026-06-23 — **Build (onboarding intimacy-matrix redesign — 5-point + gender/orientation-aware; spec 27 §4.2 +
  18 §14.5; on `feat/intimacy-matrix-redesign`, PR open).** Owner-approved decisions (implemented, not re-asked).
  The intake `activities` matrix went from a 3-state scale (Hard limit · Curious · Into it) to a **5-point ordered
  feeling scale — Hard no · Not interested · Curious · Like it · Love it** (one mutually-exclusive choice per row;
  **"Hard no" rendered as a BOUNDARY** with a distinct danger tone, the other four as feelings — a hard no is the
  strongest "no", not an extra toggle). Engine, all **additive** (no migration): `Question.matrix` gains
  **`pointLabels: string[]`** (N-label scale; wins over the legacy 3-label `min/mid/maxLabel`, existing numbered
  questionnaire matrices untouched) + **`limitLabels: string[]`** (boundary tone); `@selfos/answering`'s
  `ScalePicker` renders them (new `.scalePointLimit` style + a `--color-danger-subtle-bg` token, which the relay
  page already defined); `formatAnswerForSynthesis` maps points → `pointLabels`. The acts are
  **gender/orientation-aware at the RENDER layer only** via a pure `resolveIntakeActivityRows({ gender, drawnTo })`
  (`@selfos/core/intimacy/activityRows.ts`): **only the oral rows** are relabelled/split by anatomy — own anatomy
  → receiving label; partner anatomy from `drawnTo` → giving rows; **a straight man never sees the blowjob-giving
  variant**, a bi person sees both; **everything else stays universal** (no over-filtering). **Never erase on
  uncertainty:** any ambiguity in gender (non-binary/trans/PNTS/other/unset) OR `drawnTo`
  (everyone/non-binary/trans\*/other/empty) → the FULL list with neutral oral labels. The shared
  `INTIMACY_ACTIVITIES` inventory is **NOT** mutated (questionnaire generation/spec 08 reads the same list);
  synthesis **re-resolves with the same `(gender, drawnTo)`** from the session (`activityContext.ts`) so stored
  matrix keys map back to labels, and **appends any orphaned stored keys verbatim** so a later gender/drawnTo edit
  never silently drops a prior rating. **Also fixed a real bug:** the onboarding renderer's `toSubmit` dropped the
  matrix (an object answer) so activity ratings never persisted — it now passes the row→point record through.
  Code-reviewer **ship** (resolver rules, render↔synthesis key consistency, inventory immutability, additive
  schema compat, and the privacy boundary all verified; applied the one should-fix — the orphaned-key hardening).
  Gate: typecheck, lint, format, **523 core + 11 relay + 650 desktop** unit; onboarding **E2E** drives the real UI
  (gender → drawnTo → 18+ gate → fill the gender-aware matrix → Continue → **decrypt** the persisted matrix value;
  asserts the blowjob-giving row is absent for a straight man) + a 390px no-overflow guard while the matrix renders;
  visual QA at desktop + 390px (the 5 points wrap cleanly, "Hard no" reads as a red boundary). Synced spec 27 +
  18 §14.5 + 08's `Question.matrix` interface. **Lesson: keep a per-person row tailoring at the RENDER layer (a
  pure resolver), never by mutating a SHARED inventory another feature reads; make render + synthesis resolve from
  the SAME persisted inputs so a relabelled row's answer key still maps back — and append orphaned keys so a later
  edit can't silently drop a rating. The matrix-as-display-string keying meant the renderer's object-dropping
  `toSubmit` had been silently discarding every activity rating — a "tests pass, data lost" trap a decrypt-the-
  value E2E catches where a render-only assertion didn't.**
- 2026-06-23 — **Build (update awareness, notify-only — SPEC 36 BUILT; on `feat/update-awareness`, PR open).** SelfOS
  had no way to tell a user a newer version exists. Built a notify-only check (NO auto-download/install, no
  electron-updater, no signing — the app stays unsigned): a pure `@selfos/core/updates` `checkForUpdate({fetch,
currentVersion, now})` does the **unauthenticated** GitHub `releases/latest` GET (the repo is now **public** — no
  token, ever; descriptive User-Agent, ~8s `AbortController` timeout, Zod-validated, semver-compared) → returns
  `UpdateCheckResult | null` where **null = couldn't check** and NEVER overwrites the cache (404/malformed tag → up
  to date; 403/network/timeout/unparseable → null). The network call is a **host primitive**
  (`BridgeHost.checkForUpdate`, `globalThis.fetch` in main, faked under `SELFOS_FAKE_UPDATE`); `coreBridge.updatesCheck`
  caches a SUCCESSFUL result device-local + `updatesGetState` reads it. **Cadence is renderer-driven** (a
  `useUpdateChecks` AppShell hook: launch + 6h + focus/visibility, gated by the `updates.autoCheck` device toggle
  [default ON], ~30min throttle for non-forced; manual button forces) rather than a main timer — simpler, and
  "cleared on quit" = the renderer effect cleanup. An app-global `updateStore` (NOT per-person reset) drives both the
  Settings → About control (idle/checking[`aria-busy`]/up-to-date/available[+ View release]/calm error, `role=status`)
  AND the spec-35 `update-available` notification (sticky warning toast; `external` action → the tag's `html_url` via
  `shell.openExternal`). **App-global dismiss** (§11): `APP_GLOBAL_NOTIFICATION_KEYS` + a `globalNotificationState`
  device blob the bridge splits/merges, so an update dismissal is shared across personas + survives a person switch
  (spec 35 was per-person-only). Corrected the now-stale "repo is private" notes in spec 19 + README (downloads are
  public; still unsigned → Gatekeeper bypass stays) + documented the GitHub update-check as the only non-Claude/
  non-relay outbound call. Gate green: typecheck, lint, format, **513 core + 647 desktop** unit; **83/83 E2E** (the
  default E2E env pins `SELFOS_FAKE_UPDATE=0.0.0` so no test hits real GitHub or raises a phantom update). Synced
  spec 36 (→ Built) + spec 35 (update-available un-stubbed). **Lesson: an update notice is app-GLOBAL, but spec 35's
  notification state is per-person — bridge a single `globalNotificationState` blob keyed by a known
  `APP_GLOBAL_NOTIFICATION_KEYS` set so dismiss is shared + survives a switch, rather than bolting global state onto
  the per-person store; and a default-on launch check that surfaces "You're up to date (vX.Y.Z)" collides with a
  bare `getByText(version)` E2E assert — anchor version matchers (`^v0\.4\.0`) so the new line doesn't break them.**
- 2026-06-23 — **Build (unified in-app notification system — SPEC 35 BUILT; on `feat/notification-system`).** SelfOS
  surfaced alerts ad-hoc (a sync-conflict `Banner`, a Home "keep your profile fresh" card, no signal when a
  questionnaire recipient responded). Built ONE framework — a `TitlebarControl` **bell** + unread badge → a
  **NotificationCenter** dropdown + corner **toasts** — and migrated four kinds: **sync-conflict**,
  **responses-arrived**, **profile-freshness** (all live) + **update-available** (registered but **stubbed** — no
  checker yet; spec 36 raises it). Notifications are **derived** in the renderer from live state (conflicts already
  on the AppHeader path; one-shot profile-suggestion + responses-arrived reads on mount/person-change — NO background
  polling); only read/dismissed **signatures** persist — **device-local + per-person** — via two device-state-backed
  channels `notifications:getState`/`:setState` (mirroring `sidebarCollapsed`), keyed by the active person IN THE
  BRIDGE (the trust boundary). A pure `resolveNotifications` registry coalesces to one item per `coalesceKey` and
  re-surfaces a dismissed item only when its condition CHANGES (`onIncrease` for conflicts/responses so resolving
  some never re-pops; set-gains-a-new-id for profile-freshness so a shrinking set never re-nags; `onChange` for
  update-available). **New seam beyond the spec:** a `reveal-vault` **action** for the sync-conflict "Resolve" (a
  shell op, not a route/URL — alongside navigate/external/none), a `notifications:responsesArrived` consumer read
  (gated `questionnaires.viewResults`, sender-scoped — counts submitted **and** analyzed so the tally is monotonic),
  and a `shell:openExternal` channel (http(s)-only) for the external action. Added a design-system **`Toast`**
  primitive (severity tones from `Banner` tokens, sticky-or-auto-dismiss with hover/focus pause, `aria-live`/
  `role=alert`; toasts clear once read/dismissed so a sticky one never lingers) + the bell/center/viewport chrome +
  a per-person-reset `notificationStore`; showcased in `/gallery`. Tightened `AppHeader` gaps + edge padding at phone
  width so the larger cluster (now incl. the bell) fits with **no horizontal scrollbar** (§12) — the fix had to sit
  AFTER the `767px` block to win at 390px, and stays less specific than the `win32` control-inset rule. Crisis stays
  OUT (untouched `CrisisFooter`); the in-content sync-conflict Banner + Home freshness card REMAIN as deep
  affordances. Code-reviewer **ship** (privacy/per-person/re-surface/a11y verified; applied both should-fixes —
  count analyzed responses + the profile-freshness set-gains-id comparator — and the viewResults-denial nit test).
  Gate green: typecheck, lint, format, **637 desktop + core** unit; **81/81 E2E** (the prior household-AI-key flake
  now passes). Synced spec 35 (§3.4/§4/§6 + Built changelog) + spec 01 §5.6 (`Toast`). **Lesson: keep notifications
  DERIVED (recompute from live state) and persist only read/dismissed SIGNATURES per coalesce key — so dismissals
  survive a reload, never sync or leak across personas, and a per-kind re-surface rule (`onIncrease` /
  set-gains-id / `onChange`) decides re-popping with no stored notification log; and adding a control to the titlebar
  means re-checking the phone-width fit (the §12 overflow guard caught it).**
- 2026-06-23 — **Build (AI rich-text rendering — SPEC 34 BUILT; on `feat/rich-text-rendering`, PR opened).** Every
  AI-generated string was rendered as a plain text node, so the Markdown the model naturally writes (`**bold**`,
  `-`/`1.` lists, `###`, `>` quotes, `` `code` ``) showed as literal characters on the onboarding **portrait**,
  **coaching sessions**, and a dozen more surfaces. Built ONE shared **`<Markdown>`** primitive — a hand-rolled,
  dependency-free parser (`markdownParser.ts`, an AST → semantic elements) + the component — in **`@selfos/answering`**
  (so the relay Worker page + iOS reuse it), re-exported from the Electron design-system. **Safe by construction
  (the whole point):** the parser NEVER emits raw HTML (`<script>`/`<img onerror>` → literal text), DROPS image
  syntax, and the `link` AST node carries **no URL field** so a neutered link renders as a styled non-navigating
  `<span>` with no `href`/scheme ever — protecting the renderer-is-offline guarantee; it's **total** (never throws)
  and **streaming-safe** (incomplete markdown degrades to literal text, resolves on completion). A `FORMATTING`
  contract is appended **AFTER** persona+safety in `buildSystemPrompt` (chat/guided/depth-ask), the intake
  interviewer, and the dream-analysis chat (boundary still leads), with light-Markdown notes added to the
  JSON-prose calls (portrait/reflection, dream synthesis, questionnaire analysis + alignment) — prose may use it,
  **facts stay plain**. Switched all ~16 §3.4 render sites to `<Markdown>` (block) / `<Markdown inline>` (facts) —
  onboarding portrait + reflections + go-deeper chat, session messages (saved + streaming), wrap-up, dream
  synthesis + dream chat, memory insight (+ Home card), the alignment report (incl. the **relay page**) — with
  **markers stripped BEFORE rendering** (order matters) and **user input left plain**; removed redundant
  `white-space: pre-wrap` where `<Markdown>` owns layout, plus the §3.5 portrait/insight readability pass + a
  `/gallery` showcase. The offline fake Claude (both Electron + web hosts) now returns markdown so tests exercise
  real rendering (asserted substrings kept in uninterrupted text runs). Tests: parser units + DOM **security**
  units (no live `<script>`/`<img>`/`<a>`/`href`, no network) + streaming-degradation; per-surface RTL (portrait,
  session, wrap-up, insight, alignment render real `<strong>`/`<li>`, not literal `**`); E2E (session reply +
  portrait render structured). Code-reviewer **ship** (security boundary verified airtight). **Live-preview
  verified** the Sessions reply renders as a real bulleted list with bold. Gate green: typecheck, lint, format,
  **501 core + 11 relay + 598 desktop** unit; **78/79 E2E** (the 1 failure — household-AI-key sharing — is
  **pre-existing**, fails identically on clean `main`, unrelated to this change). Synced spec 34 + spec 01 §5.6
  (the `Markdown` primitive added to the catalog). **Lesson: a curated-Markdown renderer for untrusted model
  output should be safe by CONSTRUCTION, not sanitization — make the parser structurally incapable of emitting
  raw HTML, images, or an href (give the link AST node no URL field at all), so `javascript:`/`data:`/`<script>`
  have nowhere to live; and keep it a pure AST parser so the security + streaming invariants are unit-testable
  without a DOM.**
- 2026-06-23 — **Fix (a stale E2E that timed out on `main` — the auto-share UI change left it behind; on
  `fix/household-ai-key-e2e`).** The `household AI key (25): owner shares a key → a keyless device inherits it`
  E2E timed out at 30s on clean `main`. **Diagnosed, not assumed:** the auto-share feature (spec 25 §5.6) had
  merged, which **removed the manual "Share with the household" button** (an owner's key now auto-mirrors to
  `config/ai-credentials.enc` in `coreBridge.secretSet`); the test still `click`ed that deleted button, so it
  hung until the test timeout. Product behavior is correct (the coreBridge auto-share unit test passes) — only
  the E2E was stale. Fix: drop the manual-share click; after **Save key** the test now asserts the auto-share
  confirmation ("Shared with your household") directly. The vault-decrypt assertions, the device-key Clear →
  `source:'shared'`, and the no-"connect Claude" check are unchanged. Gate: lint, format, **79/79 E2E** (was
  78/79). **Lesson: when a feature removes/renames a control, grep the E2E for the old label — a `click` on a
  vanished button doesn't fail fast, it hangs to the full test timeout, reading as a mysterious flake.**
- 2026-06-23 — **Fix — PERMANENT (the release-please re-proposal loop is GONE; root cause was draft-release
  tag-timing, not the ancient footer; spec 19 amended, on `chore/fix-release-please-permanently`).** Every
  release for weeks needed 2 extra PRs (advance `bootstrap-sha` + close a spurious "release X.Y.(Z+1)" PR).
  **Diagnosed the REAL mechanism** (not the assumed "Release-As footer" story): the spurious PRs always
  re-proposed the **latest release's** commit (0.3.2→0.3.3, 0.3.3→0.3.4…), NEVER 0.1.0 — so it was **not** the
  footer. The config had **`draft: true`** (draft-until-asset), and **a draft GitHub release has no git tag
  until published**. So when release-please re-ran on the release-PR merge, the new tag didn't exist yet → it
  saw the PRIOR tag as latest → re-proposed the just-released commit as a phantom next patch. The macOS build
  published (creating the tag) ~3 min later, but the spurious PR was already open. Advancing `bootstrap-sha`
  (the scan floor) every release just MASKED it. **Permanent fix:** **`draft: false`** (release-please
  publishes immediately → tag exists when it re-checks → proposes nothing) + **drop `bootstrap-sha`** (with
  tag-detection working, release-please never scans back past the latest tag, so the ancient `Release-As:
0.1.0` footer in `36c3dff` is unreachable — the only reason the floor existed) + electron-builder
  **`publish.releaseType: release`** (upload the `.dmg` to the already-published release, not a draft).
  **Trade-off (accepted):** a release is visible for the ~3 min the build runs before its `.dmg` attaches —
  draft-until-asset is gone, but so is the loop. Synced spec 19 (amendment) + the `release.yml` comments.
  **Lesson: a draft GitHub release does NOT create its git tag until published — so any tool that detects "the
  last release" by tag (release-please) will re-propose the just-released commit when it re-runs before
  publish. Publish non-draft so the tag exists immediately; `bootstrap-sha` is a FIRST-release-only baseline
  and must be removed afterward (a kept floor overrides tag-detection and forces the re-scan). The
  spurious-PR's PROPOSED VERSION is the tell: re-proposing the latest (not 0.1.0) = a tag-timing problem, not
  the footer.** NOTE: validated end-to-end on the NEXT real release (the config-merge run itself must open NO
  release PR; the dmg-attach to a published release is proven on the next `feat`/`fix`).
- 2026-06-23 — **Fix (portrait STILL truncating on v0.3.2 — the distinct message CONFIRMED the cause; salvage
  partial JSON + bigger budget so onboarding never dead-ends; issue #19, spec 28, on
  `fix/portrait-truncation-salvage`).** The 2026-06-22 hardening shipped in v0.3.2 and the user came back with a
  NEW message: **"The portrait was cut off before it finished"** — exactly the distinct truncation message I'd
  added. So the self-diagnosing messages PAID OFF: the cause is confirmed **output truncation**, not the
  off-spec-field path. Verified the real Electron client DOES honor `extendedThinking:false` (omits `thinking`),
  so it's genuine output volume — a maximal intake (Angel: every section, 36/40 intimacy…) drove the portrait
  JSON past even 8000 tokens and it got cut off mid-`facts`. Fix: **(1) maxTokens 8000→16000** (a compliant
  portrait is ~5-6k; you only pay for tokens generated); **(2) `salvageTruncatedPortrait`** — if the full parse
  still fails, recover the `portrait` summary (it comes FIRST, almost always intact) + every COMPLETE fact object
  (a balanced-brace scan that skips the truncated trailing one), so the portrait completes instead of
  dead-ending. The "cut off" error now fires ONLY when even the summary didn't arrive. Tests: a truncated reply
  (summary + 1 complete fact + 1 cut-off fact) now SALVAGES to a valid portrait with the complete fact, dropping
  the truncated one; a reply cut off before the summary still reports "cut off". Gate green: typecheck, lint,
  format, **500 core + 11 relay + 565 desktop** unit. **Lesson: building the DISTINCT failure message in the
  prior fix is what made THIS one a 5-minute confirmed diagnosis instead of another guess — self-diagnosing
  errors are worth the extra branch. And for a structured-JSON call whose output can legitimately be large
  (driven by input richness), a strict all-or-nothing parse is the wrong contract: give generous budget AND
  salvage a partial result (the summary leads, so it survives truncation), because the user's onboarding must
  never hinge on the model fitting an exact ceiling.**
- 2026-06-22 — **Fix (onboarding portrait synthesis failed with "came back in an unexpected shape" — hardened
  BOTH plausible mechanical causes since the live call couldn't be reproduced; spec 28, on
  `fix/portrait-synthesis-robust`).** A member (Angel) finished a MAXIMAL intake (every section answered:
  36/40 intimacy, 15/16 health, 17/17 relationships…) and "See my portrait" failed every time. **Diagnosed,
  not assumed** (per §6 — and NOT a refusal): traced the code — synthesis already disables adaptive thinking
  (the §17.10 fix), so the generic error funnels TWO mechanical causes into one message: (a) **output
  truncation** — a "rich, comprehensive" summary + ~60 detailed facts on a huge intake can approach/exceed the
  6000-token ceiling → incomplete JSON → `extractJson`'s `JSON.parse` throws; (b) **one off-spec field** — a
  single non-numeric `metric` or malformed fact makes the STRICT `PortraitDraftSchema.parse` reject an
  otherwise-perfect portrait. **Could not reproduce Angel's exact call** (her answers + the key are encrypted
  on-device behind the Keychain/master-key), so rather than guess ONE cause, hardened **both**: (1) the schema
  is now **tolerant** (`.catch` on every field — only `portrait` is hard-required; a bad metric/fact/`values`
  degrades to a safe default, malformed facts drop as empty-text downstream); (2) **maxTokens 6000→8000** for
  headroom (a compliant response is ~3k); (3) the failure now **distinguishes "cut off" (truncated JSON, retry)
  from "unexpected shape"** so any residual case is self-diagnosing. Tests: an off-spec reply (non-numeric
  metric + malformed fact) now SALVAGES to a valid portrait; a truncated reply reports "cut off". Gate green:
  typecheck, lint, format, **499 core + 11 relay + 565 desktop** unit. **Lesson: a STRICT structured-JSON
  `.parse` on a model response is brittle — one off-spec optional field nukes an otherwise-perfect result;
  parse model JSON TOLERANTLY (`.catch`/salvage, require only the essential field) and give bounded JSON calls
  real output headroom. When the live call can't be reproduced (encrypted on-device), harden every
  code-identified failure surface + make the residual self-diagnosing (distinct messages) — don't ship a
  speculative single-cause guess.** (Follow-up: session/dream analysis use the same strict-`.parse` shape and
  could get the same tolerant treatment.)
- 2026-06-22 — **Process (enforce PR-only `main` client-side; on `chore/block-direct-push-to-main`).** Tried to
  add GitHub branch protection / a ruleset to enforce the new PR-only rule, but **both require GitHub Pro on a
  private repo** (HTTP 403: "Upgrade to GitHub Pro or make this repository public"). So enforcement is
  client-side: a **`pre-push` hook blocks a direct `git push origin main`** (reads the ref list on stdin;
  emergency override `git push --no-verify`). PR merges happen server-side on GitHub, so the guard only ever
  stops a local direct push — it doesn't impede the flow. Documented in CONTRIBUTING.md (+ how to add a real
  ruleset if the repo ever goes Pro or public: require the `Lint · Typecheck · Test` check + linear history + a
  PR, admin bypass). **Lesson: branch protection + rulesets are paid features for private repos — on the free
  plan, enforce PR-only with a client-side `pre-push` guard (a backstop, not a wall, since `--no-verify` and
  non-hooked clients bypass it).**
- 2026-06-22 — **Process (adopt a PR-based workflow + a real release step; durable, user-chosen; on
  `chore/dev-workflow-and-release-process`).** After a run of release-please pain (a manifest-drift loop, the
  version going backwards, duplicate draft releases, a `merge:` commitlint rejection, Node-v15 hook failures) —
  all caused by **how** we landed work, not the code — the user chose to formalize the recommended flow.
  Decisions (all "recommended" options, asked via AskUserQuestion): **(1) strict PR-based** — every change on a
  `<type>/<slug>` branch → push → PR → CI green → **squash-merge on GitHub**; `main` is **never** pushed to
  directly, **never** updated by a local merge, and you **never `git merge origin/main` into a branch** (rebase
  onto it); **(2) squash-merge** with a Conventional Commit PR title (that title drives the changelog + bump);
  **(3) offer a release after every merged slice** — _"Tag & publish vX.Y.Z now, or batch?"_; **(4) full
  implementation.** Built: rewrote CLAUDE.md §6 (cadence → branch/PR/squash/release steps) + §9 (git: squash
  titles, release-please owns versioning/tags/`CHANGELOG.md`, never hand-bump/tag, never `Release-As:`, manifest
  == latest tag + `bootstrap-sha` floor, Node ≥20 for hooks); added the **`release` skill** (safe release-please
  flow: sync + clean → health pre-flight catching manifest drift/duplicate PRs/backward versions → confirm
  version + changelog → `gh pr merge --squash` → watch the build → verify the published `.dmg` + no loop);
  updated **`ship-slice`** to push + open a PR + squash-merge + offer the release; expanded **CONTRIBUTING.md**
  (Workflow + Releases + a Node-version prereq); and added **`scripts/require-node.sh`** wired into the pre-commit
  - pre-push hooks (fails fast with "run `nvm use`" instead of a cryptic pnpm error — the v15 footgun). This very
    change was landed via the new flow (branch → PR → squash-merge) to dogfood it. **Lesson: most release pain is a
    workflow problem — keep `main` PR-only + squash-merged, let release-please own every version/tag/changelog, and
    make "release" a deliberate, pre-flighted step (the `release` skill), not an ad-hoc merge.**
- 2026-06-22 — **Release ops (v0.3.1 shipped the auto-share fix; CI Actions bumped off Node 20; release-please
  re-proposal loop fixed again — on `main`).** After merging the auto-share fix, cut **v0.3.1** (release-please
  PR #10 → tag + the macOS job published `SelfOS-0.3.1-arm64.dmg`, 108 MB). Then two CI/release housekeeping
  items: **(1)** the GitHub **Node-20 deprecation** — bumped `actions/checkout@v4→v7`, `actions/setup-node@v4→v6`,
  `pnpm/action-setup@v4→v6` in both `ci.yml` + `release.yml` (inputs unchanged; pnpm reads `packageManager` from
  package.json; CI verified green with the new actions). `googleapis/release-please-action@v4` is **left** (it
  drives the fragile release flow — a v5 major bump needs careful testing; it's force-run on Node 24 for now, a
  flagged follow-up). **(2)** Merging the v0.3.1 PR triggered a **spurious "release 0.3.2" PR (#11)** re-proposing
  the already-shipped fix — the manifest-drift loop again. Root cause this time: **`bootstrap-sha` was STALE at
  v0.3.0 (573c634)**, so release-please re-scanned from v0.3.0 each run and re-found the v0.3.1 commit. Fix:
  **advance `bootstrap-sha` to the v0.3.1 commit (e5562a6)** + close PR #11; verified the next release-please run
  opened **no** PR. **Lesson (sharpened): with this repo's `bootstrap-sha` setup, the sha MUST be advanced to each
  new release commit — it's a floor, not a "last release" marker, so leaving it at the prior release makes
  release-please re-propose the just-shipped commits as the next patch. It exists only to fence off an ancient
  `Release-As: 0.1.0` footer (commit 36c3dff); the real permanent fix is to neutralize that footer so
  `bootstrap-sha` can be dropped entirely (the manifest is already the source of truth) — a follow-up.**
- 2026-06-22 — **Fix + durable decision (AI auto-shares to the household by default — the recurring "member
  sees AI not set up on the shared vault" trap, FINALLY root-caused against the REAL vault; spec 25 §5.6, on
  `fix/ai-credentials-autoshare` off `main`, NOT merged).** A member (Angel) on the freshly-installed **released**
  app (v0.3.0) still hit "Connect AI to begin." **Diagnosed, not assumed** (per §6): (1) confirmed the spec-25 fix
  IS in v0.3.0 (`git tag --contains c639dab` → v0.3.0) — NOT a release-lag; (2) traced the code —
  `aiAvailable = resolveAiKey() && ai.enabled`, both correct, no bug; (3) **inspected the actual iCloud vault**
  (`~/.../Family/SelfOS`): `ai.enabled: true` synced ✓, owner has `anthropic.apiKey` device-local ✓, but
  **`config/ai-credentials.enc` was ABSENT** — the owner **never clicked "Share with the household"** (spec 25
  made sharing OPT-IN). So Angel correctly resolved "no key." Root cause = the opt-in itself is the trap. **Owner
  decision: sharing is the DEFAULT, with an explicit opt-out.** Built: vault setting **`ai.shareCredentials`**
  (default **true**, admin-only, in `ADMIN_ONLY_SETTING_KEYS`); **auto-share on `secretSet`** (an OWNER saving a
  Claude/OpenAI key mirrors it into the vault unless opted out — a member's own-key override stays device-local via
  the `settings.manage` guard); an idempotent **boot migration** (`ensureSharedAiCredentials` in `householdStatus`)
  so an EXISTING owner key auto-shares on next launch with no tap; the **opt-out is live** (toggle off withdraws,
  on re-shares). Removed the redundant manual "Share"/"Stop sharing" buttons (the `ai:shareDeviceKey`/`:clearSharedKey`
  ops stay — idempotent). Gate green: typecheck, lint, format, **497 core + 11 relay + 565 desktop** unit (+4 bridge
  auto-share/opt-out/member-stays-local; +RTL copy/no-button). **Immediate unblock (no release needed):** the owner
  clicks "Share with the household" in their CURRENT v0.3.0 app → `config/ai-credentials.enc` syncs to the member.
  This branch makes it automatic going forward (needs a release to ship). **Lesson: a "released fix that still
  fails" is a cue to inspect the REAL data, not the code — the fix was present and correct, but built an OPT-IN the
  owner never exercised; the actual vault (`ai.enabled: true` synced + `ai-credentials.enc` absent) gave the answer
  in one `ls`. When the expected behavior is "owner sets up X → household has X," make sharing the DEFAULT with an
  opt-out, not an opt-in the owner must discover.**
- 2026-06-21 — **Build (spec 33 multi-device housekeeping — FULLY BUILT, slices A–D; on
  `feat/household-ai-credentials`).** Four independent loose ends. **A** (docs) pruned spec 10's stale
  super-admin documentation so its body matches the 2026-06-14 Owner-is-full-access amendment (deleted the
  `SuperAdminFileSchema` block, the §6.4 `superadmin:*` subsection, the `config/superadmin.enc` table row +
  §7 rows; the append-only changelog stays); a doc agent did the surgery + flagged that spec 14's body still
  has live-sounding super-admin detach steps (left — it already carries a 2026-06-14 amendment note). **B**
  the OpenAI dream-image key gets a "Test connection" like Claude's: `ImageClient.verify(apiKey)` is a
  NON-generative `GET /v1/models` probe (bills nothing, never an image generation), `openaiProxy` maps the
  same NO_KEY/AUTH/RATE_LIMIT/NETWORK/API_ERROR taxonomy, bridge `openaiTest` resolves the key host-side
  (spec-25 resolver, never crosses IPC), `OpenAiTestConnectionControl` under the OpenAI key in Settings →
  Dreams. **C** iOS finally shows the conflict Banner: `isConflictCopy` moved to `@selfos/core/vault` (shared
  by both hosts); blind Swift `VaultFs.findConflicts` (`NSFileVersion.unresolvedConflictVersions` + the name
  pattern) feeds the EXISTING Banner via a new `HostParts.getConflicts` part; the web preview still returns
  `[]`. **D** sync-safety: a `vault:syncReadiness` check + a host `hasPendingDownloads` (Electron `.icloud`
  placeholder scan; iOS blind Swift) makes `HouseholdGate` show a "this folder is still syncing from iCloud"
  warning (Check again / Set up anyway) before fresh-vault Setup — advisory over the unchanged
  `createMasterKey` non-overwrite data-loss backstop. Tests: openaiProxy taxonomy + RTL; capacitor
  getConflicts/hasPendingDownloads wiring; bridge readiness; HouseholdGate warning RTL. Gate green:
  typecheck, lint, format, **462 core + 551 desktop** unit. iOS Swift is blind-written, user-verified.
  **Lesson: a non-generative auth probe (`GET /v1/models`) verifies an image key without billing an image;
  and a "still syncing" warning at the boot gate is a cheap UX layer over the real data-loss guard
  (`createMasterKey` refuses to overwrite an already-synced `recovery.enc`), not a substitute for it.**
- 2026-06-21 — **Build (spec 32 device management & key rotation — FULLY BUILT, slices A–C; on
  `feat/household-ai-credentials`).** Closes the biggest security gap: one master key on N devices with no way
  to see, revoke, or rotate it. **A** device registry (`config/devices/<id>.enc`, one file per device,
  registered on every join path + a per-launch heartbeat; key-free `deviceId` cached device-local for "this
  device"; owner-gated `devices:list`/`:rename`; `devices.manage` capability). **B** the cryptographic
  revocation core — `rotateMasterKey` re-encrypts the WHOLE vault under a fresh key + new recovery phrase,
  deletes invites, drops revoked device entries; **crash-safe** via a two-phase stage→commit journaled for
  resume (the new key sits in a **device-local temp secret**, never the synced journal, so a revoked device
  can't read it mid-rotation; Phase-1 crash discards [vault stays old-key], Phase-2 crash resumes idempotently
  to fully-new-key); `enumerateEncryptedFiles` is path-discovery over the content roots (not a per-feature
  list); owner-gated `keys:rotate` (sync-conflict pre-flight) + `keys:rotateStatus`; **resume-at-boot + §5.5
  re-key detection** in `householdStatus` (an old-key device whose key can't decrypt the access config is
  signed out → Unlock, not a corruption error). **C** the owner-only **Settings → Devices** section (the
  owner's placement choice over a standalone route) — list/rename/revoke + a deliberately-serious Revoke-&-
  re-key dialog (5 consequences) + the new-recovery-phrase panel shown once. Honest threat model (§8):
  prevents FUTURE access by a revoked device; can't retract the past; one shared key, so revoking one device
  signs out ALL (no per-member isolation — permanent non-goal). Tests (real crypto over memFileSystem): 5
  registry + 8 rotation (incl. the crash-safety + corrupt-abort, the spec's heart) + 2 bridge + 3 RTL. Gate
  green: typecheck, lint, format, **462 core + 542 desktop** unit; visual QA of the Devices panel at desktop +
  390px (fixed a narrow-card row-crush: rowMain `flex-basis: 200px` so the action buttons wrap below the device
  name instead of squeezing it to a word-per-line). E2E (cross-device revoke→re-key→sign-out) needs a local
  display. **Lesson: crash-safe whole-vault re-encryption = stage everything first (originals untouched →
  Phase-1 crash is a no-op) then swap from a complete staged set under a `committing` journal (idempotent →
  Phase-2 crash resumes); keep the new key in a DEVICE-LOCAL temp secret, never the synced journal, or a
  revoked device syncing mid-rotation reads the very key meant to lock it out.**
- 2026-06-21 — **Build + durable UX/permission decisions (on `feat/household-ai-credentials`).** Three
  owner-requested access/UX changes: **(1)** the **AI, Sessions, Questionnaires, Dreams + Relay settings
  sections are owner-only** — whole sections hidden from non-`settings.manage` users (added `adminOnly` to
  `SettingsSection`; `SettingsScreen` filters sections, not just individual settings). Non-owners see only
  Appearance / Vault / About. (Consequence: the spec-25 member key-override UI is no longer surfaced —
  members rely on the inherited shared key.) **(2)** The **dev-only `/gallery` is owner-gated** (nav link +
  route, on top of dev-only). **(3)** The header **vault/sync "checkbox" (the `SyncStatusChip`, a check-circle
  that opened the vault folder and read as an unclear checkbox) moved into the account dropdown** as an
  "Open vault folder" item; a sync conflict now shows on the account control + as a "Resolve N sync
  conflicts" item (the in-content Banner still surfaces conflicts). Deleted `SyncStatusChip`. Also finished
  **spec 25's E2E** (owner shares via UI → decrypt the vault → keyless device resolves `source:'shared'`).
  Gate green: typecheck, lint, format, **449 core + 537 desktop** unit/RTL/bridge. E2E + visual QA need a
  local display (the standing Electron-E2E constraint). **Lesson: hide whole owner-only SECTIONS at the
  section level (a `SettingsSection.adminOnly` flag the screen filters on), not just per-setting — and when a
  control's icon (a check-circle) reads as an interactive checkbox, it belongs in a labelled menu item, not a
  bare titlebar chip.**
- 2026-06-21 — **Durable policy + Build (multi-device specs 25–29 group).** Audited the reported multi-device
  bug — a member installing on their own machine + selecting the shared vault saw "AI hasn't been set up"
  though the owner had set it up — and root-caused it: the **API key is a device-local secret** (00 §6.2,
  never synced) while `ai.enabled` is a **vault setting** (synced), so a joined member inherited `ai.enabled`
  but had **no key** → every AI surface (and the AI-hard-gated onboarding) locked them out. Created a 5-spec
  group ([`25` household-ai-credentials](docs/specs/25-household-ai-credentials.md) · [`30` settings trust
  boundary](docs/specs/30-settings-trust-boundary.md) · [`31` AI-required policy](docs/specs/31-ai-required.md)
  · [`32` device management & key rotation](docs/specs/32-device-management-and-key-rotation.md) ·
  [`33` housekeeping](docs/specs/33-multi-device-housekeeping.md); renumbered around a concurrent
  onboarding-redesign group at 21–24). **Built + committed on `feat/household-ai-credentials`:** **25**
  (owner shares one key, stored **encrypted under the master key** in `config/ai-credentials.enc` — the relay
  precedent — so members inherit it; device override wins; one `resolveAiKey` replaces every `secrets.get`
  AI call site; booleans-only `ai:keyStatus` replaces 11 renderer `secretHas` readiness checks; role-aware
  `SharedKeyControl`; `00` §4.1/§6.2 amended) and **26** (settings-write trust boundary enforced in the
  bridge: vault-scoped or admin-only writes require `settings.manage`, via a shared `settingsPolicy.ts` source
  anchored by a drift test). Gate green: typecheck, lint, format, **449 core + 538 desktop** unit.
  **DURABLE POLICY (the owner, explicit, 2026-06-21): "AI is required by the app and requires online, period."**
  There is **no offline / degraded / works-without-AI mode** — that reversed spec 31's original "onboarding
  offline resilience" draft (repurposed → [`31-ai-required`](docs/specs/31-ai-required.md)). When AI is
  unavailable (no key / AI off / offline) surfaces show a **clear role-aware setup/connectivity prompt**, never
  a faked experience; the onboarding hard gate (18 §3.1, portrait required) **stays** and is never relaxed; the
  Owner is exempt from the gate so they can reach setup (no chicken-and-egg). **Remaining (drafted, not built):**
  25 Playwright E2E + visual QA; 28 (device registry + revocation by whole-vault re-encryption — large, its own
  session) and 29 (super-admin doc cleanup, OpenAI test-connection, iOS conflict detection, setup sync-safety).
  **Lesson: a credential that's device-local-by-design but whose _enablement_ is vault-synced creates a
  multi-device trap — the synced half says "on" while the device half is empty; either sync both (the chosen
  fix: opt-in shared key, encrypted in the vault like the relay token) or gate readiness on the resolved
  credential, never on the synced flag alone.**
- 2026-06-17 — Fix (**release-please opened a new release PR after every merge — manifest drift loop**; spec 19,
  on `fix/release-please-manifest`). Audit (facts, not guesses — checked open PRs, releases, git tags, the
  manifest on `origin/main`, and the release-please run logs): `.release-please-manifest.json` on `main` was
  stuck at **`0.1.0`** while the real latest tag was **`v0.2.1`**. release-please trusts the manifest as "current
  version", so every push it recomputed "next after 0.1.0" → re-proposed `0.2.0` endlessly; a stale "release
  0.1.0" PR even merged AFTER 0.2.1 shipped, **resetting the manifest backward** (the self-reinforcing part). Two
  things seeded it: (a) the **`Release-As: 0.1.0` empty commit** I'd added to force the first version lingered in
  the scan range and dragged proposals back to 0.1.0; (b) **interleaving manual `git merge origin/main` + pushes
  with the release-PR merges** repeatedly carried an old manifest value forward. Fix: point the manifest at
  **`0.2.1`** (the real latest tag, published with its `.dmg`) + drop the now-spent `bootstrap-sha`; release-please
  then scanned from `v0.2.1` forward, found only chore/merge commits, and logged "No user facing commits found …
  skipping" — loop broken. Cleanup: closed the stale loop PR, deleted 3 duplicate **draft** releases (drafts carry
  no git tags, so the real v0.1.0/v0.2.0/v0.2.1 tags + published releases were untouched). The build pipeline was
  never the problem (v0.2.1 shipped its dmg fine). **Lesson: in release-please manifest mode the
  `.release-please-manifest.json` IS the source of truth for the current version and MUST match the latest git
  tag — if it drifts below the latest tag, release-please re-proposes already-shipped versions in a loop. NEVER
  use a `Release-As:` commit to set the first version (it lingers and forces backward proposals — let the manifest
  baseline + bump flags decide), remove `bootstrap-sha` after the first release, and don't hand-merge `origin/main`
  into a local branch while release PRs are also merging (it carries stale manifest values forward).**
- 2026-06-17 — Fix (**dev vs installed app share `userData` → fresh install skips setup**; on
  `fix/dev-userdata-separation`). User noticed the **built** app booted straight into their dev vault instead of
  first-run setup. Cause (diagnosed): the vault pointer + master key + settings live device-local in Electron's
  `userData`, whose path derives from the app **name**; `index.ts` called `app.setName('SelfOS')`
  unconditionally and electron-builder's `productName` is also `SelfOS`, so dev and the packaged app resolved to
  the **same** `~/Library/Application Support/SelfOS` — the packaged app read the dev session's device state and
  skipped setup. (Real end-users are unaffected — no dev env writes there.) Fix:
  `app.setName(app.isPackaged ? 'SelfOS' : 'SelfOS Dev')` so a dev run gets its own `userData`, independent of
  the installed app. One-line Electron-runtime change (no meaningful unit test). **Note:** after this a dev run
  uses `SelfOS Dev` (re-links the vault once — data is safe); the packaged app keeps `SelfOS`, so to see its true
  first-run, clear the leftover `~/Library/Application Support/SelfOS` once. **Lesson: Electron `userData` is
  keyed by the app NAME — if dev and the packaged build share a name they share device state (vault pointer,
  master key), so a fresh install on a dev machine silently inherits the dev vault; gate the name on
  `app.isPackaged`.**
- 2026-06-17 — Fix (**relay Worker bundle missing in the packaged macOS app**; spec 19 §5/§13, on
  `fix/relay-bundle-packaging`). User hit "The relay Worker bundle is missing. Build it first: pnpm --filter
  @selfos/relay build" connecting the Cloudflare relay in the **built** app. Root cause (diagnosed, not
  assumed): the release workflow only ran `pnpm --filter @selfos/desktop build` so `apps/relay/dist/worker.js`
  was **never built** in CI; electron-builder's `files` packaged only `out/**` + `package.json` (the relay dist
  lives at `apps/relay/dist`, outside `out/`); and `loadRelayBundle`'s candidate paths assumed the repo layout,
  which doesn't exist inside a packaged `.app`. Fix (3 parts): (1) **build the relay in CI** — a
  `pnpm --filter @selfos/relay build` step in `release.yml` before packaging (+ the `release:build` script
  builds it first for local parity); (2) **package it** — electron-builder `extraResources` copies
  `../relay/dist` → `Contents/Resources/relay`; (3) **find it at runtime** — `loadRelayBundle` checks
  `process.resourcesPath/relay` as the highest-priority candidate (dev still falls through to the
  workspace/repo-relative candidates). Also ignore the `release/` electron-builder output in eslint + prettier,
  and `CHANGELOG.md` in prettier (release-please owns it — otherwise format:check fights the generated file).
  **Verified end-to-end** by running `electron-builder --mac --dir` and confirming `worker.js` (479 KB) +
  `meta.json` land in `SelfOS.app/Contents/Resources/relay/`. Code-reviewer **ship**. Gate green: typecheck
  (node + web), lint, format, **441 core + 11 relay + 532 desktop** unit (+1 relayBundle resourcesPath test).
  Rolls into the pending `0.2.0` release. **Lesson: an electron-builder app only ships what's in `files` /
  `extraResources` — a separately-built sibling-package artifact (the relay Worker `worker.js`) must be built
  in CI _before_ packaging AND copied in via `extraResources`, then located at runtime via
  `process.resourcesPath`, never a repo-relative path that exists only in the dev tree.**
- 2026-06-17 — Build (**onboarding: kids & pets conditional rosters — a new shared `roster` answer type; spec 18
  §14.6/§14.9**, landed on `main` via a worktree). User: "if they mark they have kids, a conditional field should
  option to select how many, the names and genders. Same with pets." **Asked first** (4 forks): trigger = when
  they have kids (have-young/grown-kids; the liveWith→Children auto-fill flows in too); per child = **name +
  gender + age**; per pet = **name + species + gender**; storage = **portrait/context only** (no Person field).
  Built a generic **`roster` `AnswerType`** — `Question.roster` declares the per-row columns
  (`{key,label,type:'text'|'select',options?,placeholder?}`), value is `Record<string,string>[]`. Rendered by
  `@selfos/answering` as **stacked per-row cards** (fields stack vertically, so a roster row can NEVER overflow
  horizontally — the dateRow lesson taken further). Two rosters in **Your life now**: `children` (branched on the
  Children single-choice) + `petsDetail` (branched on a pet in the "Any pets?" multi, via array-includes
  branching). `answerToString` now formats object-row arrays ("Emma, Girl, 7; Liam, Boy, 4") — also fixed a latent
  dateList "[object Object]" in the portrait. Widened `IntakeAnswerValue` + `Answer.value` + added
  `RosterColumnSchema`. Roster **text** columns also carry placeholders (the placeholder guard now covers them).
  Gate green (worktree): typecheck, lint, format, **438 core + 11 relay + 514 desktop** unit (+roster isAnswered/
  format, +roster-persists-no-PersonField-and-feeds-portrait, +roster RTL add/fill/remove), **73 E2E** (the
  life-now test now adds a child [name/gender/age] + reveals the pets roster, with a roster no-overflow geometry
  check). Visual QA caveat: the web preview gates the onboarding form behind `aiAvailable`, so the roster is
  verified by the E2E (real Chromium: reveal + fill + geometry) + RTL rather than a screenshot; the stacked-card
  layout is overflow-safe by construction. On `feat/kids-pets-roster` off `main`, merged. **Lesson: a generic
  `roster` answer type (configurable columns) is the clean way to capture repeatable structured sub-data (kids,
  pets) without per-feature controls; render rows as STACKED cards so they're overflow-safe at any width, and
  teach `answerToString` to format object-row arrays or the portrait gets "[object Object]".**
- 2026-06-17 — Fix + feedback (**onboarding: ALL free-text questions must have placeholders + drop a redundant
  decisionStyle option; spec 18 §14.6**, landed on `main` via a worktree). User (frustrated, repeat): "im STILL
  seeing text fields with no placeholders, THEY MUST ALL HAVE PLACEHOLDERS." Audited the catalog — **57** of 211
  shortText/longText questions had only `(id, prompt)` and no placeholder; added a meaningful example/help
  placeholder to **every one** (e.g. occupation → "e.g. nurse, teacher, software engineer"; proudOf → "A moment,
  a relationship, something you built…"). **Added a unit guard** (`intakeCatalog.test.ts`): every shortText/
  longText question MUST have a non-empty `placeholder` — so this can't silently regress (the "should've caught
  it in testing" lesson, made a test). Also: per the user, removed **"The data"** from `decisionStyle` ("You make
  big decisions mostly with your…") — it overlapped "Head" (both the analytical pole); now a clean Head/Heart/Gut.
  **Durable rule: every intake free-text question carries a placeholder (enforced by the catalog test).** Gate
  green (worktree): typecheck, lint, format, 435 core + 11 relay + 513 desktop unit (+the placeholder guard), 73
  E2E (1 unrelated spec-20 memory test flaked, passed in isolation). On `fix/placeholders-decisionstyle` off
  `main`, merged. (The kids/pets structured-roster request is a separate slice — asked the user first.)
- 2026-06-17 — Fix + build (**two onboarding-form follow-ups from a user screenshot; spec 18 §14.6**, landed on
  `main` via worktrees while a concurrent agent held the shared tree). **(1) Important-dates row was visually
  broken** (user flagged: label collapsed to nothing, the × remove button shoved outside the card). Cause: the
  shared `.input { width: 100% }` beat the date input's `flex: 0 0 auto`, so the date input ate the whole row.
  Fix: `.dateRow input[type='date'] { width: auto; min-width: 0 }` so it sizes to content and the label fills.
  Added an **E2E geometry guard** (label box wider than the date box + no page overflow) and **proved it FAILS on
  the old CSS, passes on the fix** — the test that should have caught it. **(2) "Your cultural or ethnic
  background"** changed from a free-text field to a **multi-select** (White/European, Black/African,
  Hispanic/Latino, East/South/Southeast Asian, MENA, Indigenous, Pacific Islander, Mixed, Other write-in,
  Prefer-not-to-say) → the picks join into the string `ethnicity` field via `fillPersonFields` (a multi → joined
  string, like a contact's free text; NOT a list). **Asked first** (single vs multi → user chose multi for mixed
  heritage). Gate green (in the worktree): typecheck, lint, format, unit (+ethnicity-joins-to-string in the
  field-fill test), E2E (+ ethnicity multi-pick in the onboarding field-fill test → decrypts the vault, asserts
  the joined string). **Process lesson (recurred): a concurrent agent switched the SHARED working tree onto their
  branch with uncommitted WIP — committing there would land my work on their branch + risk staging their files.
  The fix is a `git worktree add -b <branch> /tmp/x main` (pnpm install in the worktree is ~4s on a warm store),
  do + gate + commit + merge entirely in the isolated worktree, then revert my stray edits in the shared tree so
  the agent's branch stays clean. Don't `git checkout main` in the shared tree — it would drag the agent's
  uncommitted WIP onto main.**
- 2026-06-17 — Fix (**no "Finish" button in the sent/locked questionnaire preview; 08 §17.14f**; on
  `fix/questionnaire-delete-draft-sentstate-relay`, **merged to `main`** at the user's explicit instruction
  "commit all changes to main"). User: the read-only preview of a sent questionnaire still showed the
  test-on-yourself "Finish" button + "Answer the N required questions to finish" — confusing, since a sent
  questionnaire is shown for reference only. `QuestionnairePreview` gains a `readOnly` prop that drops the
  Finish button + required-validation and shortens the intro banner to "This is exactly what your recipient
  sees."; the builder passes `readOnly` from the **locked (sent)** branch only — the **unsent** Preview mode
  keeps the real dry-run Finish. Verified live in the web preview (sent questionnaire → no Finish). Gate green:
  typecheck (node + web/DOM-lib), lint, format, **437 core + 11 relay + 530 desktop** unit (+1 lock-view assert
  for no-Finish), **77 E2E**. Synced 08 §17.14f. **This is the close-out of the questionnaire send-lifecycle
  branch — now merged to `main`.**
- 2026-06-17 — Fix (**compatibility variant pronoun safety (options rewritten with gender) + a sleek Share
  card; 08 §17.14e**; on `fix/questionnaire-delete-draft-sentstate-relay`, NOT merged). User: a compat
  question for HIM about his FEMALE partner showed options with "him" (answers read as if she were
  answering). Root cause: `generateVariant` only rewrote PROMPTS, never OPTIONS, and was never told either
  participant's gender. Fix: `generateVariant` now takes `forGender`/`aboutGender` (from `Person.gender`,
  passed at all 3 compat call sites); the prompt names each participant with pronouns ("Ben (he/him)",
  "Angel (she/her)"), forbids the wrong-gender pronoun for the other person, and rewrites each prompt **AND
  each option** — the model returns `[{prompt, options}]`; options are applied only when the count is
  preserved (else canonical kept — alignment safety). New `pronounHint` (female→she/her, male→he/him,
  non-binary→they/them, else name). The offline fakes + all 3 fake-Claude hosts updated to the object shape.
  Also: the sent-preview **Share card** redesigned (accent icon tile + heading + explainer + "Get the link",
  link/PIN/Refresh/delivery inside) instead of a loose banner+button. Gate: typecheck (node + web/DOM-lib),
  lint, format, **437 core + 11 relay + 530 desktop** unit (+ option-rewrite/no-wrong-pronoun, count-mismatch
  keeps canonical, gender-plumbing message), **77 E2E**; share card verified live (screenshots).
  **Lesson: personalizing a compatibility question means BOTH the prompt AND the options — gendered pronouns
  live in the options, so rewriting only the prompt leaves answers in the wrong person's voice; pass both
  participants' genders explicitly and rewrite options too. NOTE (relay-link staleness, carried from §17.14c/d):
  the user's EXISTING sends predate `pinWrapped`, so the FIRST "Get the link" on an old send mints once (the
  PIN was unrecoverable), then it's stable; new sends are stable from the first view.**
- 2026-06-17 — Fix (**"Share link" re-shows the EXISTING link (stable) + a manual Refresh to regenerate; 08
  §17.14d**; on `fix/questionnaire-delete-draft-sentstate-relay`, NOT merged). User: Share link shouldn't
  regenerate a fresh link+PIN on every click — it should re-show the existing one (to copy/email), with a
  Refresh next to the Secure link to regenerate manually. Required STORING the PIN (it was hash-only): added
  **`Assignment.relay.pinWrapped`** (PIN encrypted under the master key; the relay still only holds `pinHash`),
  set in `mintRelay`; new core **`readRelayLink`** reconstructs the existing link (token + wrapped content key)
  - PIN with no mint/relay call. **`questionnaires:shareLink` gains `regenerate?`** — default re-shows the
    existing (mints only if the send predates `pinWrapped`); `regenerate:true` (the manual **Refresh**) mints
    fresh + revokes old. `RelayLinkDelivery` got a **Refresh** button beside the Secure link (only on the share
    view, not the already-fresh send-time confirmation); the "we don't keep the PIN, share it now" copy →
    "you can find this link again from Share a link" everywhere. **VERIFIED LIVE** (bridge: 2× Share link →
    identical link+PIN; Refresh → different; screenshot of Refresh-beside-link). Gate: typecheck (node +
    web/DOM-lib), lint, format, **434 core + 11 relay + 530 desktop** unit, **77 E2E**. Synced 08 §17.14d.
    **Lesson: "re-share" ≠ "regenerate" — re-showing a stable artifact must READ stored material (store the PIN
    encrypted), not re-mint; make regenerate an explicit action.**
- 2026-06-17 — Fix (**THE relay-link root cause: stale deployed Worker (404) + bump version + link reachable
  after sending; 08 §17.14c**; on `fix/questionnaire-delete-draft-sentstate-relay`, NOT merged). The §17.14b
  "loud failure" surfaced the actual bug: a real-Cloudflare **404 on `POST /api/admin/mailbox`** — the user's
  **deployed Worker was stale** (older code under the same `relayVersion '1'` label), missing the upload route.
  The current `dist/worker.js` HAS the route, but nothing prompted a redeploy because
  `updateAvailable = config.relayVersion !== currentVersion` and BOTH were '1'. Fix: **bump RELAY_VERSION 1→2**
  (build.mjs + relayBundle.ts, kept in sync) + rebuild the bundle → an already-deployed v1 relay now shows the
  **"Update relay"** button (one click re-uploads the current Worker, reusing KV + secret → fixes the 404, no
  re-provision). **Standing rule: bump RELAY_VERSION on EVERY Worker route/behaviour change**, or an old deploy
  reads as current + silently 404s new routes. **Link reachable after sending** (user: "see it still after sent
  at the top of preview + under the 3 dots"): new **`questionnaires:shareLink`** IPC re-mints the latest open
  send's RECIPIENT link (factored with reshare into one `reshareLink` helper), surfaced as a **"Share a link"**
  button at the **top of the sent (locked) preview** + a **"Share link"** kebab item (above Delete, sent-only)
  that opens + auto-fetches it → the shared `RelayLinkDelivery` (link + PIN + message + Email/Text/Copy).
  **VERIFIED LIVE with screenshots** (sent compat → Share a link → Secure link `…workers.dev/q/…` + PIN +
  prefilled message + Email/Text/Copy; kebab shows "Share link"). Gate: typecheck (node + web/DOM-lib), lint,
  format, **434 core + 11 relay + 530 desktop** unit (+ shareLink coreBridge, 2 Share RTL), **77 E2E**. Synced
  08 §17.14c. **Lesson: a deploy-version constant that doesn't bump when the deployed CODE changes is a
  silent-staleness trap — the "update available" prompt never fires, so the user's stale Worker keeps 404ing
  new routes; bump it on every change. The §17.14b loud-failure change is what made this diagnosable at all.**
- 2026-06-17 — Fix (**relay-mint failures made LOUD + sent questionnaires LOCKED; 08 §17.14b**; on
  `fix/questionnaire-delete-draft-sentstate-relay`, NOT merged). User STILL saw no link on a compat household
  send **with a relay connected** — root cause: both `assignmentsCreate` AND `assignmentsCreateCompatibility`
  **silently swallowed** a `putMailbox` failure in a `catch` and returned the Inbox-only result, so a
  connected-but-unreachable/stale relay looked like "the feature is broken." Both result types gain
  **`linkError?`**; a mint failure now surfaces ("We couldn't create the link ({reason}) — open Results →
  Resend") distinct from the no-relay hint; a coreBridge test forces the relay unreachable and asserts
  `linkError` (proven). **Asked first** the 2 forks: relay-status (user: connected → it's a real bug; this
  surfacing is the fix + diagnosis) and the lock behavior. **Lock (user: "once sent it should just show the
  preview"):** a SENT questionnaire opens **read-only Preview** (no Edit, frozen questions, "use Duplicate to
  change it" notice) + a footer of Send-again / Duplicate / Delete / Close; **Send again is disabled until a
  re-send cooldown** (`RESEND_COOLDOWN_DAYS=7`) with a notice, and the list row shows **"Ready to re-send"** once
  due. **Full delivery E2E matrix** (the user's "test ALL types" demand → new §7 DoD rule): one-person household
  (relay → link + Email/Text; no relay → connect-a-relay hint, no link), one-person external, compat household,
  compat external — assert the link + Email/Text/Copy delivery render (or the hint). **Verified LIVE** (preview:
  compat household with a relay → link + editable message + Email/Text; sent questionnaire → locked read-only,
  Send-again disabled "Ask again in 7 days", Duplicate/Delete, no Edit). Gate green: typecheck (node +
  web/DOM-lib), lint, format, **526 desktop + 434 core + 11 relay** unit (+ linkError-surfaced, lock view, cooldown,
  delivery-matrix), **77 E2E** (+2 delivery matrix; the re-asks trend E2E now seeds its 2nd send via the bridge,
  since the in-UI re-send is cooldown-gated). Synced 08 §17.14b. **NEW HARD RULE (§7 DoD): a SENDING/DELIVERY
  change is verified across EVERY type × recipient × relay-state — one-person AND compatibility, household AND
  external, relay AND none — never one path; a `catch` that falls back to a "still works" state MUST record WHY
  (surface the error), because a silent fallback on a connected relay is indistinguishable from broken.** **Lesson:
  the "unified delivery" feature had a third hidden gap beyond the two send paths — the `catch` that hid the
  real-relay failure; the user's bug was the swallowed error, not a logic bug, and only surfacing it (+ testing
  the failure path) makes it diagnoseable.**
- 2026-06-17 — Build (**Compatibility unified delivery + re-publish/resend — the COMPAT path the prior fix never
  touched; 08 §17.14a**; on `fix/questionnaire-delete-draft-sentstate-relay`, NOT merged). The user (furious) was
  testing a **compatibility** send (you + Angel) — a separate path from the standard household send fixed in
  §17.14 — and it minted **no link**, appended the "Sent" confirmation **below** the still-visible editor + Send
  button (tall empty void), and offered no re-share. Root cause: "unified delivery" (§17.13) was only wired into
  `assignmentsCreate`, never `assignmentsCreateCompatibility`. **Asked first** the 3 forks (household compat gets
  the SAME link + email/SMS as external; sending REPLACES the editor; re-publish RE-MINTS a fresh link+PIN since
  the PIN is never stored). Built: **(1)** household `assignmentsCreateCompatibility` now `attachRelayLink`s the
  RECIPIENT's variant (sender answers their own in-app — no self link) when sendExternal + relay connected,
  returning `{link,pin}`; `CompatibilityMember += relayLinked/isSelf`. **(2)** extracted **`RelayLinkDelivery`**
  (link + PIN + editable message from the `defaultMessages` Settings templates + editable email/phone +
  Email/Text/Copy/Share) — now used by the external, standard-household, compat, AND Results surfaces, so a
  household partner finally gets the prefilled email/SMS, not just a copy-link row. **(3)** the builder renders the
  send→delivery step **instead of** the editor while `sendId` is set (kills the lingering Send + empty void).
  **(4)** new **`assignments:reshare`** mints a fresh link+PIN for an open send (revokes the old), surfaced as
  Results **"Resend link"** / **"Create a link"** + a compat group drain. **VERIFIED LIVE** in the web preview
  (compat household send → link + editable message + Email/Text; Results drain + resend). Gate: typecheck (node +
  web/DOM-lib), lint, format, unit (+coreBridge compat-household-mints-recipient-link + reshare-fresh + self-member
  refused; +Results RTL standard reshare + compat drain/resend), E2E (+1 walking a household compat send through
  the UI → link + Email/Text delivery → Results drain + resend; +decrypt asserts the compat assignment carries
  relay material). Synced 08 §17.14a. **Lesson: a "unified" feature with TWO entry paths
  (`assignmentsCreate` AND `assignmentsCreateCompatibility`) is only half-done if you wire one — the user tests the
  path you didn't; verify the ACTUAL path they're on (compatibility), LIVE, before claiming a fix.**
- 2026-06-17 — Build (**Questionnaire send-lifecycle fixes — 4 user-reported gaps the passing tests missed; 08
  §17.14**; on `fix/questionnaire-delete-draft-sentstate-relay`, NOT merged). The user hit four lifecycle gaps
  and (rightly) demanded the rules change so "glaringly obvious" things stop slipping past green suites. **Asked
  first** the 3 UX forks: draft saving = **save anytime, validate at send**; delete = **list row + builder**;
  sent-state = **list badge + builder header**. Built: **(#3, the serious one)** relay affordances in
  `QuestionnaireResults` now gate on a new **`SendResult.relayLinked`** (`Boolean(assignment.relay)`), NOT
  `channel === 'relay'` — a household send is `channel:'inApp'` even with a minted link (§17.13), so the **"Check
  for responses" drain button never rendered** and a relay response was unretrievable; a coreBridge test that
  drained the link by calling the bridge **directly** had stayed green while the BUTTON was missing. **(#4)** new
  sender-scoped **`questionnaires:sendStates`** IPC → a **"Sent · <date>"** chip on the list row + the builder
  header ("Sent <date> (N times)"); sending refreshes the store so it shows on return. **(#1)** a list-row kebab
  (`QuestionnaireRowMenu`) → Delete → inline confirm (bridge re-enforces Owner-any-stage / creator-own-unsent).
  **(#2)** `canSave` needs only a title; `input()` drops blank-prompt drafts so a half-built questionnaire
  persists; **Send still validates** completeness. **Verified the COMPLETE flow live** (web preview: list chips +
  kebab confirm + the household-send drain button + "Sent (2 times)" header). Gate green: typecheck (node +
  web/DOM-lib), lint, format, **420 core + 520 desktop + 11 relay** unit, **74 E2E** (a new test walks the whole
  flow through the UI: connect relay → draft-save → send → Sent badge → Results drain button → list-row delete).
  Synced 08 §17.14. **NEW HARD RULE (CLAUDE.md §7 DoD): drive the COMPLETE user-facing flow through the actual
  rendered UI — a bridge/integration test proves the backend, NOT that the button that calls it exists; a
  household relay drain was bridge-tested-green while the UI gated the button on the wrong condition so it never
  showed. Also surface state where the user looks next (a Sent badge), not a form that looks untouched.** **Lesson
  (the §17.13 root cause): a feature flag/affordance must key off what actually enables it (relay material
  present), not a sibling display value (the channel) — gating on `channel === 'relay'` silently disabled the
  whole link-retrieval path for the new household-link case.**
- 2026-06-16 — Build (**Memory dashboard — SLICE 3: the dashboard UI; SPEC 20 FULLY BUILT**;
  [20-memory-dashboard](docs/specs/20-memory-dashboard.md) §3/§8/§9, on `feat/memory-dashboard` **worktree**,
  NOT merged). Rebuilt `routes/memory/Memory.tsx` into the living dashboard: header (search + Refresh memory +
  filters source/subject/confidence/flagged), a "Needs your review" drafts section, a collapsible Trends section
  (reuses `LineChart`), the person's own insights grouped by **life-area**, and a read-only "About people you
  relate to" section. New `InsightCard.tsx` — own = interactive (per-fact flag-inaccurate toggle + `ShareToggle`,
  confidence chip + rationale, provenance link that **deep-links to the source**, sensitive tag, edit/approve/
  delete, crisis-lead); related = read-only. New **`ConfidenceChip`** primitive (text + non-colour-only dots +
  rationale → exported, `/gallery`, tested). `provenance.ts` + `trends.ts` helpers; wired `Sessions`/`Dreams` to
  open the referenced item from router state. **Code-reviewer fix-first (2 should-fixes):** (a) the Dreams
  per-person-reset effect (declared AFTER the deep-link focus effect) clobbered the deep-link on mount → now
  skips its first run via a ref; (b) a related card rendered a navigable provenance link to the WRONG route
  (related provenance is scrubbed to `{at}`) → related provenance is now a plain non-link label. Nits: filter
  `<select>`s get `width:100%;min-width:0`; the inert "Flagged only" `<label>` → `<span>`. Gate green: typecheck
  (node + web/DOM-lib), lint, format, **432 core + 510 desktop** unit (Memory dashboard RTL, `ConfidenceChip`,
  `provenanceTarget`; reworked the slice-1 Memory tests), **72 E2E** (+2: dashboard groups/flags[decrypt]/source-
  removed/390px, and a **live dream provenance deep-link** that catches the reset-clobber). **Visual QA** via
  real-Electron screenshots at desktop + 390px (clean/intentional; filters stack on mobile; no overflow — the
  web preview can't be used from a worktree, it serves the main tree's build). **SPEC 20 IS FULLY BUILT** —
  slices 1 (cross-user privacy fix) + 2 (living engine: reconcile/flag/categories/keep-on-delete) + 3 (dashboard
  UI), all on `feat/memory-dashboard`, **NOT merged** (awaiting the user's confirm). **Lesson: a provenance
  deep-link (router state read in a mount effect) must survive the target component's OWN mount-time effects — a
  per-person-reset effect declared after the focus effect runs last on mount and clobbers it (guard the first
  run); and a "view source" link on a record whose source id was deliberately scrubbed for privacy (a related
  person's insight) must be a plain label, never a wrong-destination link a green suite won't catch unless a
  test actually CLICKS a live provenance link.**
- 2026-06-16 — Build (**Memory dashboard — SLICE 2: the living insights engine**;
  [20-memory-dashboard](docs/specs/20-memory-dashboard.md) §3.5–§3.7/§4/§5.2/§5.4, on `feat/memory-dashboard`
  **worktree**, NOT merged). **Decision asked (cost-material, spec self-contradicted):** automatic reconciliation
  **folds 1–2 life-area `categories` into each producer's EXISTING analysis call** (no extra AI spend — the §18
  profile-suggestion precedent), and the full AI reconcile (confidence/rationale/merge) runs **only** on a manual
  **"Refresh memory"** (`memory:refresh`, metered `memory.reconcile`). Schema (additive, no migration):
  `InsightFact += flaggedInaccurate?/flaggedAt?`; `Insight += categories[](.default([]))/confidenceRationale?/
lastReconciledAt?/contributingSources?`; named `InsightProvenanceSchema` + `LIFE_AREAS` taxonomy. Built
  `reconcileInsights` (one subject's own approved insights → set confidence+rationale, normalize categories,
  CONSERVATIVELY merge a clear duplicate [fold non-flagged facts + append provenance to `contributingSources` +
  delete the dup], NEVER re-assert a flagged fact; meter-before-parse, `extendedThinking:false`). **Flag-as-
  inaccurate:** `flagInsightFact` + `insights:flag` immediately excludes a fact from EVERY context path
  (`summarizeForContext` own+related, `listRelatedShareableInsights`) yet keeps it visible-but-marked in the
  person's OWN Memory. **Source-deletion keeps the insight (§3.7):** removed the cascade across deletionService
  (`deleteSend`/`purgeQuestionnaire`), compatibility (`purgeCompatibilityGroup`→`deleteCompatibilityReport` —
  report folder only), and dreams (bridge `dreamDelete`→`deleteDream`; `purgeDream` removed). **Code-reviewer
  fix-first (1 should-fix):** a WHOLE-insight flag dropped its facts from context but not its `summary` (which
  restates the corrected claim) — now a wholly-flagged insight is dropped entirely from context; +test. Gate
  green: typecheck (node + web/DOM-lib), lint, format, **431 core + 501 desktop** unit (reconcile [4], flag +
  wholly-flagged + flagged-context-exclusion, `normalizeCategories`, a bridge flag→context + refresh round-trip +
  guest-denial; the deletion/compat/dream tests updated off the old cascade), **70 E2E** (no new surface this
  slice — the dashboard UI is slice 3). **Lesson: when the spec self-contradicts on a cost-material point
  ("rides each pass, no extra spend" vs "a second call metered under the producer's type"), ASK — the user chose
  folding categories into the one existing analysis call (the §18 profile-suggestion precedent) over a second
  per-analysis AI call; and flag-as-inaccurate must suppress the insight SUMMARY too on a whole-insight flag, not
  just the facts, or the corrected claim still reaches the coach.** **NEXT: slice 3** (the dashboard UI).
- 2026-06-16 — Build (**Memory dashboard — SLICE 1: the cross-user privacy fix; SPEC 20 Approved**;
  [20-memory-dashboard](docs/specs/20-memory-dashboard.md) §1.1/§5.1/§6, on `feat/memory-dashboard` off `main`
  **in an isolated git worktree**, NOT merged). Closed a **serious live leak**: `coreBridge.insightsList` called
  `listAllInsights` (EVERY household subject) gated only on `questionnaires.viewResults` (a default Member cap)
  and never scoped to the active person — so **any signed-in member saw every member's** onboarding portraits +
  session/dream/questionnaire insights; plus `useInsightStore` was missing from the AppShell per-person reset
  (insights lingered across a switch). Fix: new **`memory.own`** capability (Member ON); `insightsList` rewritten
  to gate on `memory.own` + return the active person's **OWN** insights (full — incl. their own restricted facts,
  their own data) **+** their relationships' **shareable, non-restricted** facts via a new core
  **`listRelatedShareableInsights`** (mirrors the `summarizeForContext` boundary; **never `listAllInsights`** for
  the dashboard). `insights:approve`/`update`/`delete` locked to `memory.own` + `subjectPersonId ===
activePersonId`. Added a store `reset()` + wired `useInsightStore` into the AppShell per-person reset; re-pointed
  the Memory nav + Home MemoryCard gating to `memory.own`. The current questionnaire-era Memory surface shows only
  the person's **own** insights for now (related display lands with the §5.3 dashboard, slice 3) — no half-built
  related cards / dead controls (§12). **Code-reviewer fix-first caught a real residual leak (BLOCKER, fixed):**
  `listRelatedShareableInsights` first spread the whole Insight, so a related person's private `metrics`,
  `crisisFlag` (the Memory UI **renders** it as a distress banner), precise `provenance` (`intakeSection`/
  `conversationId`/`dreamId`), and a fact's `shareableWith` (who-ELSE-has-it) crossed the IPC seam — now it
  projects an **explicit minimal shape** (only the shareable fact text + a stripped `{at}` provenance), matching
  `summarizeForContext` exactly; + a unit test asserting the scrub, + the `memory.own` capability test, + the
  stale "only an owner sees it here" copy reconciled. Gate green: typecheck (node + web/DOM-lib), lint, format,
  **421 core + 500 desktop** unit (+ `listRelatedShareableInsights` [4: shareable-only/summary-stripped/scrub/
  targeting], `memory.own` caps [2], a Memory own-only-scope RTL, the per-person bridge regression, updated the
  contextOnly/intake/gating bridge tests off the old "owner-sees-all" assumption), **70 E2E** (+1 HARD-GATE
  cross-user guard: member A's Memory shows only A's portrait, B's is absent + **decrypt** proves B's insight
  exists-but-withheld, switching to B flips the view). **Follow-up flagged (NOT done):** `redactRestrictedFacts` +
  the `intake.readRestricted` capability are now dead (their only consumer was the removed leak path) — a separate
  cleanup. **NEXT: slice 2** (living insights engine — schema + `reconcileInsights` + flag-as-inaccurate + the
  producer hooks) → **slice 3** (the dashboard UI). **Lesson: a "structured sibling" of a context-builder must
  project an EXPLICIT minimal shape, never spread the whole record — `summarizeForContext` emits only a related
  person's shareable fact TEXT, so the Memory equivalent leaks `metrics`/`crisisFlag`/`provenance`/`shareableWith`
  if it spreads; the bridge is the trust boundary, so "the UI doesn't render it yet" is no defense.**
- 2026-06-16 — Fix (**unified-relay link was invisible without a connected relay**; user: "I'm not seeing
  anything in the UI for a relay link"). **Diagnosed against the live app (not assumed):** reproduced in the web
  preview — `assignmentsCreate` returns `{ assignment }` (no link) when **no relay is connected**, and
  `{ assignment, link, pin }` (the panel shows the link + PIN, screenshot-verified) when one **is**. So the code
  was correct — a link literally requires a relay (a server) — but the feature was **silently invisible** with
  no relay: the panel just said "it's in their Inbox", no hint a link was possible or how to enable it. The
  happy-path E2E connected a relay first, so it never covered the **common real no-relay state** the user hit.
  Fix: the send panel reads `relayStatus()` and, when **not connected**, shows a hint before AND after sending —
  admin → "connect a relay in Settings → Relay to also give them a link"; member → "ask an admin." +RTL for the
  no-relay hint; **new §7 DoD rule: test a feature with its PREREQUISITE absent (the common real state), not just
  the happy path — assert the graceful fallback AND that the UI says how to enable it (never silently
  invisible).** Gate green: typecheck (node + web/DOM-lib), lint, format, **417 core + 501 desktop + 11 relay**
  unit. Synced 08 §17.13. On `feat/questionnaire-unified-relay` off `main`. **Lesson: an offline fake / a
  happy-path E2E that SETS UP the prerequisite hides what the user actually experiences without it — reproduce
  the no-prerequisite path against the live app.**
- 2026-06-16 — Build (**unified questionnaire delivery — a household send ALSO mints a relay link; SPEC 08
  §17.13 BUILT** on `feat/questionnaire-unified-relay` off `main`, NOT merged). The 6th of the user's reported
  issues (the first 5 merged separately): the same answering workflow for internal + external, so a household
  recipient can answer in their **Inbox** OR via a **link** anywhere — whichever they reach first. **Decision
  (user-chosen): a link for every send + keep the Inbox; first-submission wins; Inbox-only fallback when no
  relay is connected.** **Core:** extracted a shared `mintRelay` helper from `createRelaySend` and added
  **`attachRelayLink`** (mints relay material for an existing in-app send + uploads the mailbox); `drainRelaySend`
  now **skips an already-submitted/declined send** (first-wins guard). **Bridge:** `assignmentsCreate` returns
  **`InAppSendResult { assignment, link?, pin? }`** — it mints a link ONLY when the sender can `sendExternal`
  AND a relay is connected (else Inbox-only, the graceful no-Cloudflare fallback; the send stays `channel:
'inApp'`); an in-app submit/decline best-effort **revokes the mailbox** (closes the link); the drain filter now
  covers **any** send with relay material, not just `channel: 'relay'`. **UI:** the send panel surfaces the link
  - PIN (copy rows). **Tests:** core (attach round-trip + first-wins drain), coreBridge integration (household
    send → in Inbox AND link-answerable → drains in; in-app submit → unlock 404), send-panel RTL, + a Playwright
    E2E (connect relay → household send → panel shows link/PIN → decrypt: in-app assignment carries relay
    material). Gate green: typecheck (node + web/DOM-lib), lint, format, **417 core + 500 desktop + 11 relay**
    unit, **70 E2E**; visual QA of the send panel. **Lesson: the relay-minting is reusable — one `mintRelay` helper
    serves both an external send and a household link; the link is an ADDITIONAL surface on an in-app send (not a
    channel change), and first-wins is two cheap guards (revoke-the-mailbox on in-app submit + skip-if-submitted
    on drain), not a distributed transaction.** **All 6 user-reported questionnaire issues are now addressed.**
- 2026-06-16 — Fixes (**questionnaire answering UI/UX + compatibility variant bug**, on
  `fix/questionnaire-answering-and-relay` off the merged `main`; user-reported after testing). Six issues; the
  plan was approved before coding (no backward-compat needed). **Slice 1 (answering renderer, `@selfos/answering`):**
  (a) long question prompts were **bisected by the card border** — a `<fieldset>`/`<legend>` renders the legend
  ON the border; replaced with a plain card + a `<p>` heading (each control keeps its own aria-label, so no
  double-label collision). (b) **Scale questions render as a slider** — `rating` now renders the `SliderControl`
  (labelled 1…N), no number-button grids; a **required** scale is NOT auto-seeded (stays unanswered until moved,
  so a required intimacy rating can't silently default to the midpoint). (c) **Choice options are left-aligned,
  full-width cards** (single/multi/this-or-that) that stack — long option text reads cleanly; multi options are
  now `role=checkbox` (was an implicit button). Verified live at desktop + 390px. **Slice 2 (builder layout):**
  the builder was cramped beside a tall mostly-empty master list with an orphaned empty band below — now opening
  a questionnaire shows a **centered full-width focused editor** (the list hides, returns via the "← Questionnaires"
  back link, at every width). E2E updated for the focus flow (reopen via the list after going back; Suggested/New
  reached from the list). **Slice 3 (THE serious bug — compatibility variants):** a compatibility recipient was
  asked questions **about themselves instead of the other participant** (Angel, answering Ben's send, saw "…with
  Angel"). `generateVariant` only personalized tone and kept the same meaning; it now takes an explicit
  **`aboutName`** (the other participant) + a perspective instruction, and the bridge passes the right pairing —
  the sender's variant is **about the recipient**, the recipient's (household OR external) is **about the sender**.
  Gate green: typecheck (node + web/DOM-lib), lint, format, **415 core + 498 desktop + 11 relay** unit, **69 E2E**.
  **Lesson (now a §7 DoD item): for personalized/generated content, assert the CONTENT is correct for the viewer
  — not just that the screen renders. A green flow + the offline fake's canned output hid a recipient being asked
  about themselves; the fakes now echo the `aboutName` and the coreBridge integration test + a Playwright E2E
  decrypt each participant's frozen variant and assert it names the OTHER person, not themselves.** **NEXT
  (slice 4): unify the relay so a household recipient can answer in the Inbox OR via a link.**
- 2026-06-16 — Fix + feedback (**People editor: actually REMOVE the duplicated profile questions** — user was
  angry the About tab still showed all the fields after the prior "slim" pass; spec 18 §14.6, on
  `feat/people-editor-cleanup`, NOT merged). The prior slice made onboarding _cover_ the People fields but left
  them sitting in the People → About tab — the user (correctly) called that out as not the cleanup they asked
  for. **Asked first** (2 forks — the genuine ambiguity is **contacts**: the People editor edits both Subjects
  [who onboard] and non-Subject contacts [who never do, so the fields are their only input]): user chose **(1)**
  "Remove it, keep dream-image fields for contacts" + **(2)** "dreams use onboarding data now." Result:
  - a **Subject** has **NO About tab** (and Profile loses Pronouns + Birthday) — a note says their profile comes
    from onboarding;
  - a **non-Subject contact** keeps an About tab with **only** the visual/dream-image fields (gender, appearance,
    ethnicity) + Notes; occupation/relationship status/children/living situation/interests/location/important
    dates/pronouns/birthday + the deep self fields are gone.
    The `about` tab is conditionally absent (`!isSubject`); a `useEffect` falls back to Profile if a person is
    flipped to Subject while About is open. **Data-safety:** `save()` **carries every non-edited field through from
    the loaded person** (incl. now-also email/phone) since `upsertPerson` rebuilds from the input — removing the UI
    never wipes onboarding-collected data; `VISIBLE_FIELD_KEYS` (bulk Share/Lock scope) narrowed to
    gender/appearanceDescription/ethnicity/notes so hidden fields keep their lock state. Deleted the
    `ImportantDatesEditor` + its CSS; dropped now-unused imports. Gate green: typecheck (node + web/DOM-lib), lint,
    format, **498 desktop** unit (reworked the 5 People About RTL tests: Subject hides About + carries fields
    through; contact keeps only the 3 visual fields, the rest absent; single-lock + Lock-all + Share-all on the
    reduced visible set), **69 E2E** (the People + shareability tests now use a contact for the About tab and the
    3 visual fields; the responsive sweep checks a Subject's Notes tab since About is gone). **Visual QA in the web
    preview** (People needs no AI, unlike onboarding): a Subject shows Profile·Notes·Relationships·Access (no
    About) + the onboarding note; a contact's About shows only Gender/Appearance/Ethnicity + Share-all/Lock-all,
    no console errors. **Lesson: "clean up the People page" meant REMOVE the duplicated questions from the editor,
    not make onboarding mirror them — when one surface "owns" data, the other should stop showing it; the only
    nuance is a second audience (contacts) that has no other input, so gate the removal on the audience
    (`isSubject`) and carry every removed field through on save so nothing is wiped.**

- 2026-06-16 — Build (**Onboarding ↔ People-editor field reconciliation; spec 18 §14.4a/§14.6/§14.9** on
  `feat/onboarding-field-coverage`, off `main`, NOT merged). Made onboarding cover **every** People-editor About
  field (+ Pronouns/Birthday) so the self's profile has one home (onboarding), no gaps, no double-asks. Cross-ref
  found 3 gaps + 1 duplicate. **Asked first** (4 forks; user delegated the open ones to me — "no legacy/back-compat
  needed, what do you suggest"): (1) **appearance** → added a basics `appearanceDescription` longText (feeds coaching
  - the self's dream images); (2) **interests** → mapped Joy & play's existing `passions` "What are you into?" →
    `{ field: 'interests', list: true }` (the old `hobbies`→interests question was removed in the trim — reuse, don't
    re-add, so no overlap); (3) **importantDates** → the user asked to **let onboarding capture structured data**, so
    built a **new shared `dateList` answer type** (value `{label,date}[]`, a `DateEntry`): added to `AnswerTypeSchema`,
    widened `IntakeAnswerValue` + questionnaire `Answer.value`, a `DateListControl` (add/type/remove rows) in
    `@selfos/answering`, and a basics `importantDates` question → `Person.importantDates`; the questionnaire builder
    does NOT expose it as authorable (§12, no half-built surface); (4) **healthNotes double-write** (physicalConditions
  - the "anything else" catch-all both targeted it → last-write clobber) → **fixed the proper way**: replaced
    `applyFormField` (per-question, last wins) with **`fillPersonFields`** that **groups answers by target field** —
    string fields JOIN contributors in question order, list fields concat+dedupe, a `dateList` fills importantDates;
    **idempotent** on re-submit (rebuilds from current answers, never appends), and a field locks `private` if ANY
    contributor is private. `isQuestionVisible` already handles array triggers; `isAnswered`/`formatAnswerForDisplay`
  - an `isDateEntryList` guard handle `dateList`. Code-reviewer **ship** (idempotency / join-order / privacy-lock /
    trust-boundary / schema-valid importantDates / widened-union-doesn't-break-relay all verified airtight; applied the
    one should-fix — `:focus-visible` rings on the new date buttons — + a precedence-caveat docstring; left index-key
  - cleared-field-doesn't-clear [pre-existing] as nits). Gate green: typecheck (node + web/DOM-lib), lint, format,
    **415 core + 11 relay + 498 desktop** unit (+ dateList isAnswered/format, field-coverage [appearance/importantDates/
    passions→interests], healthNotes-join-idempotent, DateListControl RTL), **69 E2E** (the onboarding field-fill test
    now also enters a structured date + appearance → decrypts the vault and asserts `Person.importantDates` +
    `appearanceDescription` round-trip). Visual QA blocked in the web preview (its fake host gates the onboarding form
    behind `aiAvailable` even with a key set) — the new control is instead proven by the real-Electron E2E round-trip +
    RTL. **Lesson: when onboarding owns the self's profile, every editable People field needs exactly ONE promoting
    question — and multiple questions targeting one field must be GROUPED + joined (idempotent), never filled in a
    per-question loop that clobbers (last-write-wins); reuse an existing question (passions→interests) before adding a
    new one to avoid re-introducing overlap.**

- 2026-06-16 — Build (**Distribution — versioning, release builds & the README; SPEC 19 BUILT** on
  `feat/distribution`, off `main`, **NOT merged** — the user cuts the first real release to verify the pipeline).
  CI/packaging/docs only, no app features. **release-please** (manifest mode): `release-please-config.json` +
  `.release-please-manifest.json`, package keyed at the repo **root** (`.`, `release-type: node`,
  `package-name: SelfOS`) so the changelog lands at **root `CHANGELOG.md`** while `apps/desktop/package.json`
  (what About + electron-builder read) is bumped via an `extra-files` JSON updater — the root `package.json`
  bumps in lockstep (NOT pinned at `0.0.0`); `include-component-in-tag: false` → `vX.Y.Z` tags;
  `bump-minor-pre-major: true` and **NOT** `bump-patch-for-minor-pre-major` so a `feat` → minor → first release
  **0.1.0**; `draft: true` (draft-until-asset); `bootstrap-sha` = current `main` HEAD (clean first changelog).
  **`.github/workflows/release.yml`**: job1 release-please (ubuntu) → job2 build-macos (`if releases_created`)
  checks out **`github.sha`** (a _draft_ release has no real git tag yet — created on publish), builds, runs
  `electron-builder --mac --publish always` (GITHUB_TOKEN as GH_TOKEN, `SELFOS_BUILD_SHA: github.sha`), then
  `gh release edit <tag> --draft=false`. **No extra secret, no API key/vault in the build.**
  **electron-builder.yml**: `publish` github block (Highfivery/SelfOS) + a `release:build` script. **About
  enrichment**: a shared `buildInfo.ts` injects `__APP_VERSION__`/`__BUILD_SHA__`/`__BUILD_DATE__` via `define`
  across the electron-vite, web (`vite.web.config`), and `vitest` configs; `AboutVersion` shows
  `v{version} · {sha} · {date}` (omitting a `dev`/empty SHA — **not** over IPC). **README** rewritten
  non-technical (about + "your data is yours" + macOS install incl. the unsigned Gatekeeper bypass +
  bring-your-own-Claude-key cost note + the crisis line verbatim); old technical README → **CONTRIBUTING.md**
  (refreshed Status + a release-process section). **macOS-only, unsigned** for now (signing/notarization,
  auto-update, win/linux = later phases). Code-reviewer **ship**; **doc-auditor caught a real config bug** —
  `bump-patch-for-minor-pre-major: true` would have made the first `feat` → `0.0.1` not `0.1.0`; removed. Gate
  green: typecheck (node + web), lint, format, **411 core + 11 relay + 497 desktop** unit (+2: the
  `__APP_VERSION__`↔`package.json` drift guard + the enriched `AboutVersion` render); a real Electron build
  confirmed the SHA/date land in the renderer bundle. The release pipeline can only be validated by a **real
  first release** — after merge the user merges the release-please PR to confirm the `.dmg` builds/uploads + the
  About version matches. **Lesson: a `define`-injected build global is the clean way to enrich the About version
  (SHA/date) without growing the IPC payload — one shared `buildInfo.ts` keeps the Electron/web/vitest builds +
  the drift-guard test on the same value; and release-please's pre-1.0 bump flags are a footgun
  (`bump-patch-for-minor-pre-major` silently demotes `feat` to a patch — leave it off so `feat` → minor).**
- 2026-06-16 — Build (**Onboarding intake + People-editor consolidation; SPEC 18 §14 amended** on
  `feat/onboarding-people-consolidation`, off `main`, NOT merged awaiting confirm). Six user-flagged cleanups,
  all forks **asked first** (3 AskUserQuestion rounds): (1) **all 63 `rating` 1–5 button-scale questions → 3-label
  sliders** (start/middle/end anchors, like the intimacy ones — authored a neutral mid-label for each via a
  scripted transform; the `rating` helper is deleted, so the intake has NO button scales left); (2) the
  **multi-"Other" write-in space bug** — `MultiChoiceControl` committed (`.split(',').map(trim)`) on every
  keystroke, stripping a trailing space before the next char so multi-word entries ("rock climbing") were
  impossible; now it holds the **raw input text in local state** and renders from that, trimming only the
  committed array; (3) **substances split** — one `multi` "which do you use" + a **per-substance frequency**
  `single` for each (cannabis/cocaine/MDMA/psychedelics/ketamine/Rx), revealed only when selected — which
  required extending `isQuestionVisible` so a **multiChoice branch trigger matches when the selected array
  CONTAINS the value** (`@selfos/core/questionnaires` answering); (4) **livingSituation+liveWith merged** into one
  `multi` "Who do you live with?" (→`livingSituation`); picking **"Children" auto-fills the Children question**
  (in `IntakeFormPanel.onChange`, only when blank, still editable); (5) **repetition audit across ALL sections** —
  trimmed LIFE-NOW to a 5-question identity snapshot (removed hobbies/connected/mood/workSchedule/typicalWeekend/
  workSatisfaction/moneyStress/topStressor/joy/recentChange/perfectDay — all duplicated the deep sections),
  removed exact/near dups (grewUpWhere, dreamDestination, closestExtendedFamily, topPriority) + Health
  anxietyLevel/lowMood (dup of Weighs reflective versions); (6) **People-editor About tab slimmed to
  contact-context** — dropped the editing UI for the 8 deeply-personal self fields (sexualOrientation/
  relationshipStyle/faith/healthNotes/goals/communicationStyle/values/languages) now owned by onboarding, keeping
  the contact-descriptive set + Notes/Relationships/Access/Budget. **Data-loss guard:** `upsertPerson` rebuilds
  the Person from the input, so the slimmed `save()` **carries those 8 fields through from the existing person**
  (omitting would wipe onboarding-collected self data). Code-reviewer **fix-first** (one real **privacy
  regression** it created + I fixed: "Share all"/"Lock all" flipped the ENTIRE `PERSON_FIELD_KEYS` set incl. the
  now-hidden private fields — so "Share all" would silently un-privatize a subject's sexual orientation/health/
  faith with no visible toggle to counter it; now scoped to a `VISIBLE_FIELD_KEYS` subset, preserving hidden
  keys' lock state — +test). Clarified the reviewer's 2nd finding: intake facts are **hardcoded `shareable:false`**
  at synthesis, so the non-restricted substance facts are own-context-only (NOT a leak); the dormant per-question
  `restricted` flag (synthesis only honors section-level) is filed as a follow-up task. Gate green: typecheck
  (node + web/DOM-lib), lint, format, **410 core + 11 relay + 495 desktop** unit (+ multi-branch [answering core +
  QuestionnaireForm RTL], multi-Other space RTL, People carry-through + Share-all-preserves-hidden-lock RTL),
  **69 E2E** (+1: liveWith→Children auto-fill + substance reveals its frequency; updated the People About +
  shareability E2E for the slimmed editor; intimacy-conditionals + grouped-form still green). Visual QA via the
  web preview (the slimmed People About tab — contact-context fields only, Share/Lock-all, per-field toggles, no
  overflow, no console errors); the slider rendering is the unchanged proven intimacy path (catalog data only).
  Synced spec 18 §14.3/§14.4/§14.4a/§14.6. **Lesson: removing a field's editing UI while it stays in
  `PERSON_FIELD_KEYS` makes a bulk "Share all" silently un-privatize it (no toggle to counter) — scope bulk
  share/lock controls to the VISIBLE keys and preserve hidden keys' state; and since `upsertPerson` rebuilds from
  the input, any field you stop editing must be carried through from the existing record or it's wiped.**
- 2026-06-16 — Build (**External-compat relay-page outcome write-back — external compatibility is now COMPLETE
  end-to-end; 08 §17.12-D**; on `feat/questionnaire-explicit-gen`, NOT merged). After both have answered + the
  sender generated the alignment report, the sender pushes it back to the external recipient from Results, and
  the recipient sees it on their relay link. Built in 3 committed parts: **(2a) crypto/mailbox/client** — the
  content key (which decrypts everything for the recipient, normally only in their link fragment) is now ALSO
  stored **wrapped under the master key** (`Assignment.relay.contentKeyWrapped`) so the sender can re-seal an
  outcome the recipient opens with that same fragment key; a sealed **`RelayResult`** (`report`/`thanks`) +
  `sealResult`/`openResult`; a drain-secret-authed Worker `POST /api/admin/result` (`putResult` patches the
  mailbox in place; `unlock` releases `sealedResult`). **(2b) relay page** — a returning, already-answered
  recipient sees the **report** (decrypted client-side) or a **"waiting for results"** state (a compatibility
  submit lands there, not the plain thank-you). **(2c) bridge + UI** — `assignments:publishCompatResult` (sender-
  scoped, needs the report, pushes to every external member) + a **"Share results"** action shown only when the
  group has an external member + a report. **Real fix the end-to-end test caught:** `generateAlignment` had
  hard-required **both** members to be `recipient.kind === 'person'`, so it **rejected any group with an external
  participant — external compatibility could never align at all**; it now names an external participant from
  their relay `displayName`. **Coverage:** the relay round-trip (mint→answer-via-relay→drain→align→publish→
  recipient-unlock-decrypts-report) is the **coreBridge integration test** (the renderer can't reach the in-main
  fake relay — the same reason existing compat/relay answer flows are coreBridge-tested, not Playwright); both UI
  surfaces are RTL (the Share button + confirmation + its absence for a household group; the relay page report /
  waiting states). Gate green: typecheck (node + web/DOM-lib), lint, format, **408 core + 491 desktop + 11 relay**
  unit. Synced 08 §17.12-D + §16.7 matrix §H. **Lesson: a feature where the recipient's only key lives in their
  link fragment can still get a server-pushed update IF you also wrap that key under the master key at send time
  — then the sender re-seals; the relay still only ever holds ciphertext. And a guard written for the common case
  (`recipient.kind === 'person'`) silently disables the whole feature for the new case — the end-to-end test
  caught what the unit tests, scoped to person-pairs, structurally couldn't.**
- 2026-06-16 — Flow-coherence fixes (**08 §17.12 — remove duplicate person-pickers; the user caught them, not
  the tests**). A whole-flow walk found two redundant person selections left by the recipient-first model.
  **(A)** Dropped the "About a specific person?" picker + toggles from Draft with AI — it re-asked "who is this
  for?"; generation now auto-tailors to the bound recipient's shareable context (+ their history for de-dup),
  the author's own data still always feeds; the generate IPC drops `targetPersonId`/`includeTarget`/
  `includeRelationship` (the bridge derives them). **(B)** Compatibility joined the recipient-first model — it's
  always **you + the one recipient chosen at the start step**; the Send panel's "Who's being compared?" toggle +
  both person-pickers + the "two other people" mode are gone; `assignmentsCreateCompatibility` takes only
  `{ questionnaireId }`. **External-recipient compatibility is the NEXT slice** (household-only for now): the
  external recipient answers via relay, the sender answers in-app, then once both are in the sender pushes the
  sealed outcome (per visibility — thanks / the joint report) back to the recipient's relay page from Results;
  contextOnly hidden for external. Gate: typecheck/lint/format, 402 core + 486 desktop unit, 68 E2E; visual QA
  of the compat start step + send panel (one clean "Compare you with" picker, no duplicate). **Lesson (now §7
  DoD): a green test suite proves each screen FUNCTIONS, not that the FLOW is coherent — walk the complete flow
  end-to-end and hunt for the same thing asked twice, colliding labels, and controls left stale by a change.**
- 2026-06-16 — **REVERT + hard rule (I violated "never assume" and it cost the user real tokens).** I assumed
  the intimacy "No usable questions" failure was a Claude content-policy **refusal** and twice rewrote the
  generation prompt (ending in a weak "sexual-wellness register"), when the real cause was a **thinking-token
  budget bug** (§17.10) — the prompt was always fine. The user (rightly furious) had me **revert the §17.2
  prompt reframe**: `intimacyExplicitFraming` is restored to the genuinely-explicit §16.5 framing ("Write
  genuinely explicit, specific questions… frank, plain language…"), and the `topics.test.ts`/`aiServices.test.ts`
  assertions restored. **Kept:** the §16.5b fallback removal, the §17.10 thinking fix, all of §17.3/§17.4/§17.5.
  **New HARD rule (CLAUDE.md §6 + memory [[always-ask-never-assume]] + [[adaptive-thinking-shares-maxtokens]]):
  NEVER fix a cause you only ASSUMED — diagnose the real root cause against the LIVE system first; never assume
  a model failure is a content refusal (suspect token starvation/truncation/parse-drop/wrong-model first); the
  offline fakes HIDE model-call bugs (always return canned JSON) so verify against the live model before
  touching the prompt; if you can't verify, say so and ASK — a fix on an unverified guess IS a guess.** Gate:
  typecheck/lint/format, 402 core + 487 desktop unit. On `feat/questionnaire-explicit-gen`.
- 2026-06-16 — Fix (**intimacy generation "No usable questions" was a thinking-budget bug, NOT a refusal**; 08
  §17.10, on `feat/questionnaire-explicit-gen`). User still hit "No usable questions came back" for intimacy
  explicit/unfiltered **every time** after the §17.2 wellness reframing. Diagnosed against the **live** API (the
  user supplied a key — **flagged it as now-exposed-in-transcript, rotate it**): the model does NOT refuse — it
  returns good explicit JSON. The bug: `anthropicClient.stream` uses `thinking:{type:'adaptive'}` and
  **`max_tokens` is the COMBINED thinking + output budget**; on **sonnet** (default) the long intimacy prompt's
  adaptive thinking consumed the whole 1500-token budget → `stop_reason:max_tokens`, **empty output** → parse
  fails → REFUSED. (General = short prompt → little thinking → worked; opus thinks less → worked; that's why
  only intimacy/sonnet failed.) **Fix:** `ClaudeStreamOptions` gains `extendedThinking?` (default on — chat keeps
  adaptive thinking); the Electron + iOS stream clients omit `thinking` when false; `runClaude`
  (generate/improve/variant/gap-finder) disables it + generation budget → 2500; a cut-off/empty reply now reports
  "draft was cut off, try again" distinctly from a no-JSON refusal. Verified live (sonnet, both tiers, thinking
  off → `end_turn` + valid JSON). User chose to **skip** the earlier-requested admin-editable-prompt Settings
  feature (its premise — "the prompt is the problem" — was wrong). Gate: typecheck/lint/format, 400 core + 487
  desktop unit (+2). **Lesson: adaptive `thinking` shares the `max_tokens` budget — a bounded structured-JSON
  call MUST disable it (or reserve a big budget), or heavy thinking silently truncates the JSON to empty; a
  symptom that looks like a content refusal can be pure token starvation; and the offline fake Claude hides this
  class of bug (always returns canned JSON) — diagnose against the LIVE model before touching the prompt.** (See
  memory `adaptive-thinking-shares-maxtokens`.)
- 2026-06-15 — Spec + Build (**Questionnaires SPEC 08 §17 — recipient-bound questionnaires + in-policy explicit
  framing + recipient-aware de-dup**; APPROVED + BUILT on `feat/questionnaire-explicit-gen`, NOT merged). User
  rejected my guessed §16.5b fallback ("NEVER assume… ALWAYS ASK"): I removed it, wrote a spec amendment (§17),
  and asked every decision before coding. **Decisions (all user-confirmed):** (1) fix intimacy refusals by
  **reworking the per-tier prompt**, not a fallback — recast `explicit`/`unfiltered` as a **sexual-wellness
  self-assessment** (health register, not erotica) so the live model complies in-policy; a refusal now surfaces
  the calm error (no canned questions). (2) **Every questionnaire is bound to ONE recipient, chosen FIRST** (a
  new `NewQuestionnaireStart` step — full-width Selects, never a scrolling SegmentedControl §12); never several;
  household OR external; **Duplicate** re-targets; **compatibility is exempt** (its two participants are chosen
  at send). The recipient picker LEFT the send panels (the bridge derives the recipient from the def + rejects a
  wrong-kind send). (3) **Recipient-aware de-dup** — generation feeds the bound household recipient's **full**
  answered content (profile + their Insights [intake/sessions/dreams/questionnaires] + the exact prompts of
  questionnaires already asked of them), assembled **host-side**, to Claude as **avoid-only** grounding; the
  author **never** sees it (only generated questions return), and the prompt **forbids the model from quoting/
  referencing** it ("steer clear, NOT mention"). User **knowingly relaxed** the own-context-only rule for this
  generation path (output boundary preserved). External/compat skip de-dup; the "about a person" context
  defaults to the recipient (overridable). 5 slices, each gated. **Lesson: the recipient-required rule belongs
  at the AUTHORING boundary (the start step) + the SEND path, NOT in the structural `validateQuestionnaire` that
  `createAssignment` calls — putting it there breaks every core send of a recipient-less compat snapshot. And a
  long-labelled SegmentedControl ("Compatibility (two people)") scrolls-x at 390px (a §12 failure) → use
  full-width Selects.** Code-reviewer **ship** (privacy boundary verified airtight at the output seam — the
  recipient's private content never returns to the author; +1 stale-comment nit fixed). Gate green: typecheck
  (node + web/DOM-lib), lint, format, **400 core + 8 relay + 487 desktop** unit, **68 E2E** (recipient-bound
  decrypt + Duplicate + 390px start-step guard; all questionnaire flows re-pointed through the start step). Visual
  QA via real-app screenshots (start step desktop + 390px, the "For:" builder header). Synced spec 08 §17 +
  §16.7 matrix §H. **NOT merged — user reviews the explicit-prompt wording (§17.2/§16.5) before merge.**
- 2026-06-15 — Build (**Questionnaires §16 slice-4 follow-ups — 4 feedback fixes + the §16.5b explicit-starter
  fallback** [SUPERSEDED by §17 — the fallback was removed]; on `feat/questionnaire-explicit-gen`, NOT merged).
  Four user-flagged fixes: (1) the "Draft with AI" Four user-flagged fixes: (1) the "Draft with AI"
  panel shows a **live elapsed-time progress block** (`role="status"` animated bar + "Drafting your questions… Ns")
  while drafting, not just a disabled button; (2) `appendGenerated` drops the **leading blank** generated question;
  (3) **§16.5b** — when the live Claude model **still declines** an intimacy explicit/unfiltered draft (the §16.5
  context-first framing doesn't always work — a model-side policy call I can't reproduce against the offline fake),
  `intimacyStarterQuestions(topics, tier, count)` (new `packages/core/src/questionnaires/intimacyStarters.ts`)
  seeds **editable, frank starter questions from the merged topic inventory** instead of stranding the Owner on
  "No usable questions came back" — fallback fires **only** on the intimacy explicit/unfiltered REFUSED path
  (NO_KEY/BUDGET/ERROR + any other type/tier still surface the calm error; returns `ok:true` + a "the AI held back,
  so I added explicit starter questions" note); (4) the Settings + inline topic-add controls are **textareas that
  add ONE topic at a time** (user was explicit: "should NOT be one per line!!! … add one at a time"; owner-only,
  `people.manage`). Gate green: typecheck (node + web/DOM-lib), lint, format, **399 core + 8 relay + 480 desktop**
  unit (+2 core: intimacy refusal → fallback ok:true with topic-seeded options; standard-tier refusal still
  REFUSED), **67 E2E** (intimacy-topics flow re-pointed to the "Add an activity" label). Synced spec 08 §16.5b +
  §16.10 build status. **Lesson: the §16.5 explicit-context framing reduces but doesn't eliminate model refusals
  for graphic sexual content — pair the prompt with a deterministic, inventory-seeded fallback so an explicit
  intimacy questionnaire never dead-ends, and gate the fallback to the intimacy/explicit REFUSED path so a real
  NO_KEY/BUDGET/ERROR or a non-intimacy refusal still surfaces honestly.**
- 2026-06-15 — Build (**Questionnaires §16 slice 4b — owner-extensible intimacy-topics UI; SPEC 08 §16 is now
  FULLY BUILT**; on `feat/questionnaire-explicit-gen`, NOT merged). The owner manages the shared
  `INTIMACY_TOPICS` inventory two ways (spec 08 §16.5a): an **owner-only Settings surface**
  (`questionnaires.intimacyTopics`, **admin-only**, 18+, vault-scoped → `IntimacyTopicsControl` — built-ins
  read-only + the Owner's custom activities/fantasies as removable chips + an add field each) **and** an
  **inline "add a topic"** in the intimacy builder's "Draft with AI" panel (shown only to an owner authoring an
  intimacy questionnaire at the explicit/unfiltered tier). Both write the SAME shared custom lists. **IPC seam:**
  `questionnaires:intimacyTopics` (read = `questionnaires.create`, returns built-in + custom split) /
  `:addIntimacyTopic` / `:removeIntimacyTopic` (add/remove = **owner-only, `people.manage`** — the lists are
  household-wide); the consensual-adult boundary is enforced by the generation prompt + the model (trusted
  owner, the full-access role), **not** a keyword filter. Reused existing primitives (Banner/Field/TextInput/
  Button + chips) → no new `/gallery` primitive. Gate green: typecheck (node + web/DOM-lib), lint, format, 397
  core + 8 relay + **478 desktop** unit (+bridge owner-adds/member-reads-only gating, +`IntimacyTopicsControl`
  RTL [3]), **67 E2E** (+1: owner adds a topic in Settings + via the inline builder add → both persist to the
  plain `config/questionnaires.json` [decrypt-free read]). **Visual QA** via the web preview (the admin-only
  18+ control: chips + add rows, the inline panel add) — 0 overflow (the only x-scroll is the by-design
  narrow-width settings section nav). **Lesson: a household-wide owner-managed list = read gated on the author
  capability (so any author's builder/AI can use it) but add/remove gated on `people.manage` (owner-only); the
  inline builder affordance hides for non-owners, and the boundary lives in the prompt + model, never a filter.
  Spec 08 §16 (the 2026-06-15 audit fixes) is COMPLETE — §16.1–§16.7 all built.**
- 2026-06-15 — Build (**Questionnaires §16 slice 4a — explicit generation + shared `INTIMACY_TOPICS`
  foundation**; spec 08 §16.5/§16.5a, on `feat/questionnaire-explicit-gen` off the **merged** `main`, NOT
  merged). After slices 1–3+5+§16.6 merged (`d4ee441`) and the concurrent `feat/intimacy-questions` work
  landed, built the previously-paused slice 4: **(§16.5) tier-distinct explicit generation** — a new
  `intimacyExplicitFraming(tier, topics)` in `aiPrompts.ts` **positively requests** genuinely explicit,
  specific questions for an **intimacy** questionnaire at the `explicit`/`unfiltered` tiers (unfiltered = most
  graphic, explicit a notch below), seeds the in-policy topic inventory, and states the **consensual-adult
  boundary in-prompt** (taboo only as fantasy/roleplay; NEVER minors/real-non-consent/illegal; within Anthropic
  policy) — fixing the user's complaint that "unfiltered" produced tame emotional-closeness questions. The
  shared `SAFETY` prefix is **not** loosened, and non-intimacy types/tiers keep the conservative note.
  **(§16.5a foundation)** extracted the intimacy `ACTIVITIES`/`commonFantasies` out of `intakeCatalog.ts` into
  ONE shared `@selfos/core/intimacy` constant (`INTIMACY_TOPICS` = `INTIMACY_ACTIVITIES` + `INTIMACY_FANTASIES`)
  imported by **both** the intake block (spec-18 sync — intake now imports it + appends `'Other'`, behaviour
  unchanged) **and** questionnaire generation; `mergedIntimacyTopics(custom)` combines built-ins + the Owner's
  **custom additions** (vault prefs `customIntimacyActivities`/`customIntimacyFantasies` in
  `config/questionnaires.json`, additive-optional — no schemaVersion bump; `read`/`add`/`removeCustomIntimacyTopic`).
  Generation reads the **merged** inventory. Gate green: typecheck (node + web/DOM-lib), lint, format, **397
  core + 8 relay + 474 desktop** unit (+`intimacy/topics` [7: built-in/merge/dedup + the per-tier explicit
  framing], +customTypeService intimacy [3], +an aiServices capture test proving the explicit framing + merged
  inventory reach the model). **Slice 4b remaining:** the owner-only Settings surface (18+, admin-only) + the
  inline builder "add a topic" to manage the custom lists, + the explicit-tier E2E rows. **Lesson: a shared
  owner-extensible inventory is one `@selfos/core` constant + a `merged…(custom)` helper reading vault prefs —
  the static intake catalog imports the BUILT-IN list directly (behaviour-preserving), and only the AI-generation
  path (which already reads the vault) merges in the owner's custom additions.**
- 2026-06-15 — Build (**Questionnaires audit fixes — SPEC 08 §16 slices 1–3 + 5 BUILT** on
  `feat/questionnaire-audit-fixes` **in an isolated git worktree**, NOT merged; **slice 4 paused**). The audit
  (memory `questionnaire-audit-fixes-2026-06-15`) found real bugs + the user's enhancements. **§16 marked
  Approved.** Built: **(1, §16.1) compat participant model** — compatibility now supports **you + someone else**
  (the sender IS a participant — the default; pickers exclude the sender) AND **two other people**; the only
  invalid pairing is the same person twice (the old "sender can't be a participant" rejection is gone).
  `compatibilityDisclosure` reworked to take participant context (`otherParticipantName`/`senderName`/
  `viewerIsSender`) and name the **real other participant**, never the sender-as-third-party (it's shown to
  recipients — honesty guard held); the send panel got a full-width-`Select` mode toggle (§12 — NOT a scrolling
  SegmentedControl), sender pre-selected + locked. **(2, §16.2) `contextOnly` visibility** — a 4th mode: both
  answer, **NO report, no raw sharing**; each participant's OWN answers distill into an **auto-approved,
  own-context-only Insight** (subject = that participant, `shareable:false`) feeding their own coach;
  **sender-triggered from Results** ("Update both coaches", explicit spend §3.4). `distillContextOnly`
  pre-validates both submitted **before any spend** (code-reviewer fix). **(3, §16.3/§16.4) Save→Send + Title**
  — the builder's **Save now keeps you on the saved questionnaire** (no close); **Send appears only once saved**
  (create → then send, no strand); **Title moved below "Draft with AI"**; AI generation returns a `{title,
questions}` object and the title **fills only when the field is empty** (never clobbers). **(5, §16.7) the E2E
  matrix** for the built features — contextOnly with a **vault-decrypt** assertion (per-participant own-context
  insights, no report, no cross-exposure), you+someone-else send-panel toggle, AI-title + Save→Send two-step;
  **fixed every existing questionnaire E2E** for the new flow (Create→"Create draft"; Send-after-Save; footer
  "Done"→"Close" to disambiguate from the send-panel "Done"). **Decisions (asked):** contextOnly = auto-approve
  into each own context + sender-triggers-from-Results; **slice 4 PAUSED** (user chose) until the concurrent
  `feat/intimacy-questions` work merges (it rewrites `intakeCatalog.ts`, which §16.5a must extract `INTIMACY_TOPICS`
  from). Gate green each slice: typecheck (node + web/DOM-lib), lint, format, **385 core + 8 relay + 474 desktop**
  unit, **65 E2E**; code-reviewer per slice (slice-1 ship +3 nits, slice-2 fix-first [pre-validation + disclosure
  copy], slice-3 ship). Visual QA via the web preview (compat mode toggle, contextOnly builder option,
  Title-below-AI, Save→Send) — 0 overflow. **Lesson 1: a concurrent agent sharing the working tree can hijack the
  single HEAD (it switched to `feat/intimacy-questions` mid-session) — do feature work in a `git worktree` and
  commit only your files there; when a shared file (`schemas.ts`) holds both sides' hunks, stage your hunk with a
  `git apply --cached` patch. Lesson 2: a Playwright `click` on a button that flips to a busy state ("Drafting…")
  hangs the default post-click wait 30s — use `{noWaitAfter:true}`; and a generated questionnaire with a still-
  blank Question 1 leaves `canSave` false, so "Create draft" stays disabled and the next click hangs.**
- 2026-06-15 — Build (**onboarding intake redesign — hybrid form/chat + self-maintaining profile; SPEC 18
  §14–§15 BUILT** on `feat/onboarding-redesign`, NOT merged). User: the all-chat intake is slow for simple
  facts, the open prompts are too generic (people abandon), the intimacy question gets skipped — and "the more
  info the AI has the better." Reworked into a **hybrid**: a short gated **`core`** of quick structured **forms**
  - **`invited`** deeper/sensitive sections, with **AI `chat`** reserved for family / your story / what weighs on
    you. **~180 specific questions** (broad prompts gone), incl. a **comprehensive, explicit, branched 18+ intimacy
    block** (orientation, full sexual history, current partner, acts & specifics, body/grooming, fantasies/porn,
    wellbeing, boundaries). **Asked-first** (2 deep rounds): the 4 forks (§14.13 — short-core-gates / promote-useful-
    answers-to-real-fields / owner-sees-intimacy / reuse-the-questionnaire-engine) + the comprehensive question
    inventory reviewed before coding. **Boundary held:** consensual-adult sexuality only — taboo _fantasies_ (CNC,
    etc.) are in as fantasy/roleplay; minors / real non-consent / illegal are never presented as activities. Reuses
    the questionnaire `Question` shape + `@selfos/answering` renderer (branching). **5 promoted additive `Person`
    fields** (relationshipStatus/parentalStatus/livingSituation shared; sexualOrientation/relationshipStyle private-
    by-default). **§15 self-maintaining profile:** drift detection **rides the session/dream/questionnaire analysis
    passes (no extra AI spend)** → confirm-before-apply `ProfileUpdateSuggestion`s + a Home "Keep your profile
    fresh" card (sessions producer built; dreams/questionnaires deferred, same pattern). 3 slices (core → renderer →
    freshness) + 2 follow-ups (go-deeper chat, People-editor fields). Gate green each slice: typecheck (node +
    web/DOM-lib), lint, format, **371 core + 447 desktop + 8 relay** unit, **61 E2E** (the 3 onboarding E2E reworked
    for the form flow); visual QA at desktop + 390px. **Lesson: `submitSectionForm` fills fields from forms with NO
    AI — the old chat `[[SELFOS:FIELD]]` marker machinery is gone; a form section spends nothing, so the gated
    first-run is fast + cheap. Restricted (intimacy/trauma) facts are flagged at synthesis from the TRUSTED catalog
    (`sectionRefRestricted`), never the model, so a sensitive fact can't leak past §8.4 by a model mislabel.**
- 2026-06-14 — Refactor + bug fixes (**super-admin removed → the Owner is the full-access role; +
  per-person login & onboarding-gate fixes**; user flagged 4 issues). **(#3, the big one)** The concealed
  **super-admin** (passphrase + in-memory inspect flag + the long-press-version unlock + `config/superadmin.enc`
  - `superadmin:*` IPC) and the **break-glass raw-access audit log** (`auditService`, the
    `RawAccessAuditEntry`/`RawAccessAuditLog` schemas + `config/raw-access-audit.enc`, the `/audit` route+nav+viewer,
    `audit:list` + `intake:revealRestricted`, the reveal "ceremony") are **deleted**. `roleAllows(role, cap)` now
    returns `true` for **any** capability (incl. the `EXPLICIT_GRANT_ONLY` `questionnaires.readRaw` /
    `intake.readRestricted`) when `role.id === 'owner'` — the **Owner is the super admin**; the Owner column in the
    Roles matrix is locked all-on; `EXPLICIT_GRANT_ONLY` caps still ship OFF for non-owner roles and need an explicit
    toggle. Restricted intake facts + `senderSeesAll` raw answers now surface **directly** to the Owner (via the
    normal `insights:list` / `assignments:revealRaw`, no audit) and stay **redacted** for everyone else — and the
    defense-in-depth exclusion of restricted facts from every _other_ person's `buildContext` is unchanged. Decisions
    (AskUserQuestion): "Full access" for the Owner + "remove the audit log entirely" (reconciled to no-ceremony,
    no-log) + "auto-give each person a Member login." **(#3 also)** The **Owner switches to any person with no PIN**
    (`session:setActive` skips PIN when leaving the Owner; returning _to_ the Owner still needs the Owner's PIN).
    **(#1 + #2)** Two bugs that motivated this: a previously-created person wasn't gated into onboarding and a
    newly-created person didn't appear in the switcher — both root-caused to (a) **stale built-in role maps** (vaults
    freeze role→capability at creation, so `intake.own` added later wasn't granted) → fixed with read-time
    **`reconcileRole`** in `getAccessConfig`, and (b) **no login account** for new subjects → fixed with
    **`ensureMemberAccounts`** (idempotent no-PIN Member accounts, in `peopleSave` for new + `accessGet` backfill).
    **(#4)** The `basics` intake section now asks each profile field one at a time (pronouns/gender/birthday/location/
    languages/ethnicity/occupation) so onboarding auto-fills the profile. New test helper `elevateToOwner()` replaces
    the removed `superAdmin:true` renderer-test bypass. **Code-reviewer fix-first** (2 should-fixes: the
    owner-PIN-free switch was implemented at the bridge but not wired into the **`PersonPicker`** UI — now it
    skips the PIN prompt when the active person is the Owner **and not on the LockScreen** (`locked` is a
    deliberate re-auth gate, so PINs always apply there); + a no-op `DreamImagePanel` test `afterEach`; plus nits:
    dropped the dead `superAdminPassphraseHash` schema field, collapsed the now-redundant `roleAllows` branch,
    freshened stale "audited" comments). Gate green: typecheck (node + web/DOM-lib), lint, format,
    **361 core + 437 desktop + 8 relay** unit (incl. a new bridge test: a non-owner `senderSeesAll` sender reveals
    ONLY with granted `readRaw`; owner-PIN-free-switch bridge + Switcher UI tests; owner full-access), **61 E2E**
    (all green, incl. the owner→member switch, the LockScreen still requires the owner's PIN, + the Member
    onboarding hard-gate). Synced specs `04` (the model rewrite) / `08` / `18` / `02` /
    `10` (+ `06`/`07`/`09`/`11`/`12`/`13`/`14` incidental). On `refactor/owner-full-access` off `main`; NOT merged
    (awaiting user confirm). **Lesson: a vault freezes each built-in role's capability map at creation, so a
    capability added to code defaults later is NOT granted to existing non-owner roles — reconcile built-in roles at
    READ time (fill missing default keys, preserve explicit toggles) rather than migrating; and storage scoping isn't
    enough for a person to be switch-to-able — they need an actual login account, so auto-create one for every subject.**
- 2026-06-15 — Change + feedback (**onboarding is now a HARD requirement for Members**, spec 18 §3.1; user:
  the dismissible auto-route "felt buggy" — "a person MUST go through it first… directed to fill it out").
  Replaced the auto-route-once + nudge with a **full-screen onboarding gate** in `AppShell`: a Member
  (`intake.own`, **not** the Owner, **not** super-admin) is taken over by onboarding on every login until
  `IntakeSession.status === 'complete'` (the portrait is generated; sections may be skipped but the flow must
  be worked through). **Asked first** the 3 forks (full-screen w/ AI-escape; done = portrait generated;
  Members-only). The header stays (switch person / lock) + the crisis footer is always present (a gate, not a
  dead-end); `AppHeader` gained `hideNav` to drop the hamburger. The **Owner + super-admin are exempt** (the
  Owner sets up AI, which the intake requires — gating them would trap a keyless first-run owner); they keep
  the voluntary nudge. On completion the finish navigates to `/onboarding` so the just-written portrait stays
  on screen (now with the sidebar); Members keep the Onboarding nav entry to revisit. Removed the auto-route
  effect + `autoRoutedToOnboarding`. Gate green: typecheck (node + web/DOM-lib), lint, format, **442 desktop**
  unit, **64 E2E** (+1: a Member is hard-gated [no app nav, crisis present] → finishes → the gate releases;
  the 7 member-switch/join tests now seed a **completed** intake so they exercise the real member experience
  instead of passing vacuously under the gate — `seedCompletedIntake`/`completeIntakeFor` helpers). On
  `feat/personal-onboarding` (merged to `main`). **Lesson: a hard full-screen gate keyed on a per-person
  status quietly breaks/voids EVERY E2E that signs in as that persona to test other features — they must seed
  the gate-release state (completed onboarding) or they fail (assert a feature is reachable) or pass for the
  wrong reason (a "nav is absent" check is vacuously true when the gate hides ALL nav).**
- 2026-06-14 — Build (**Personal onboarding — the "getting to know you" intake; SPEC 18 BUILT**;
  [18-personal-onboarding](docs/specs/18-personal-onboarding.md)). The **4th Insight producer** — an AI-guided,
  resumable self-interview across 10 sections that **auto-fills the owner-only `Person` profile** as the person
  answers and synthesizes a member-facing **portrait `Insight` (`source:'intake'`)** feeding their OWN
  `buildContext`. Reuses `05` streaming + `06` metering, the `09` analysis→Insight + meter-before-parse pattern,
  `15` per-field shareability, the `16` 18+ ack, and the `08` break-glass/audit. **Asked first** the 3 build
  forks: (1) synthesis cadence = **light per-section reflection (auto on section complete) + an explicit final
  portrait** (tap to generate, never auto-spend); (2) the intimacy block's 18+ ack is **SHARED** with guided
  sessions (`guidance/prefs.enc adultAcknowledged` — acking once anywhere unlocks both); (3) a brand-new person
  is **auto-routed once** to `/onboarding`, dismissible, with a persistent Home nudge + nav dot until complete.
  **Core** `@selfos/core/intake`: `intakeCatalog` (10 sections, static openers, a `directFields` map, the
  interviewer addendum appended **AFTER** PERSONA+SAFETY+context, §8.1) + `intakeService` (runTurn streams +
  meters `intake.interview`; direct answers fill the owner-only profile mid-interview via an embedded
  **`[[SELFOS:FIELD:key=value]]`** marker — stripped from saved+streamed text, **only catalog-declared keys
  honored**, sensitive ones → `privateFields`; synthesize = section reflection or the full portrait, metering
  `intake.synthesize` before parse, re-synth reuses the insight id + carries shareable choices forward).
  **Schema** (all additive, **no schemaVersion bump**): `InsightSource += 'intake'`, `InsightFact.restricted?`,
  `Insight.provenance.intakeSection?`, generalized `RawAccessAuditEntry` (action enum + optional
  `assignmentId`/`subjectPersonId`/`subjectName`), new `IntakeSession`/`IntakeSection`. **Capabilities:**
  `intake.own` (Member ON) + `intake.readRestricted` (**EXPLICIT_GRANT_ONLY** — off even for the Owner).
  **Seam:** `intake:getState/runTurn(stream)/skipSection/acknowledgeAdult/synthesize/revealRestricted` — gated
  `intake.own` + active-person-scoped in the bridge; the **restricted sections** ("what weighs on you" +
  intimacy) and their facts are **redacted from the owner's normal Memory reads** (`insightsList`) and
  reachable only via the **audited `intake:revealRestricted`** (writes the audit entry **before** returning,
  super-admin OR `intake.readRestricted` only). API key host-side; dedicated `intake:chunk` stream.
  **Renderer:** the sectioned onboarding flow (reuses Sessions `Composer`+`CrisisFooter`, skip/"go deeper"
  controls, the 18+ gate, per-section reflection, the closing portrait, resume), the per-person `intakeStore`
  (reset on `activePerson.id`), the Home `OnboardingCard` nudge, the auto-route, the AuditLog `revealRestricted`
  row, and the Memory **audited reveal** affordance for intake insights. Code-reviewer **fix-first** (one
  **blocker**): a Memory edit→save dropped `restricted`/`shareableWith` off facts (the renderer patch carries
  only `{id,text,shareable}`) → `updateInsight` now **merges by id** to carry them forward, AND
  `summarizeForContext`/`buildLinkedPeopleContext` now **exclude restricted facts from EVERY other person's
  context** regardless of `shareable` (defense in depth) — so a restricted fact is structurally own-context-only
  and can't be un-restricted by an edit. Gate green: typecheck (node + web/DOM-lib), lint, format, **362 core +
  442 desktop + 8 relay** unit (+intakeService/intakeCatalog, +bridge intake round-trip incl. break-glass,
  +Onboarding/OnboardingCard RTL, +audit `revealRestricted`), **63 E2E** (+2: new person → nudge → turn →
  direct-answer-fills-a-field [decrypt] → skip the 18+ intimacy block → portrait feeds a later `buildContext`
  [decrypt] → restricted fact absent from the owner's Memory but reachable via audited break-glass [audit row
  written]; resume mid-intake; 390px overflow guard). **Visual QA** via the web preview at desktop + 390px
  (onboarding flow, chat bubbles, section chips, the Home nudge — 0 overflow, no console errors). On
  `feat/personal-onboarding` off `main`; NOT merged (awaiting user confirm). **Lesson: a fact's break-glass
  `restricted` flag is a server-owned invariant — a renderer edit payload only carries `{id,text,shareable}`, so
  `updateInsight` MUST merge by id to preserve `restricted`/`shareableWith`, and the context builders must
  exclude `restricted` facts from others' context independently of `shareable`, or one Memory edit silently
  re-opens the §8.4 leak.**
- 2026-06-14 — Build (**App-refresh package G — the Home dashboard; SPEC 17 APPROVED + BUILT — the 2026-06
  app refresh (A–G) is COMPLETE**; [17-home-dashboard](docs/specs/17-home-dashboard.md) §13). Replaced the
  static `routes/Home.tsx` with a **per-active-person card dashboard** under `routes/home/` (a `Home`
  container + `ContinueCard` / `SuggestionsCard` / `WellbeingCard` / `DreamsCard` / `MemoryCard` /
  `InboxCard` / `GettingStarted` + pure `wellbeing.ts` / `greeting.ts` + one CSS module), **composed on the
  renderer from the existing per-person stores — NO new IPC** (conversation/dream/dreamPattern/insight/inbox
  /guidance). Each card **self-hides when empty**; a brand-new person sees a warm **getting-started** state
  instead of a wall of empties; loads run on mount + `activePerson.id` change (the per-person rule). **Asked
  first** the two genuine build forks (spec §13): (1) the Suggested card shows 16's **cached** guided
  suggestions on load (NO spend) and the guided generate/refresh **and** the `08` questionnaire gap-finder
  are **explicit-tap only** (spend on tap, never on load — honoring §3.4); (2) the Continue card shows
  per-session `$` via the existing **`SessionCostIndicator`** (admin `$` + `AdminOnlyBadge`, member a
  dollar-free budget bar — the established redaction-at-the-bridge rule). The **wellbeing read is
  deterministic** ("steadier/heavier/lifting", computed from the metric points, no AI → always works, no
  spend); a context-aware **greeting** (time-of-day + name + one status line). **Safety (§7):**
  `CrisisFooter` + the not-medical line are always present; the wellbeing trend is framed gently; a **recent**
  crisis-flag (bounded to the latest 3 analyzed sessions) surfaces a supportive resources-first Banner.
  Reuses `LineChart` (mood + energy, −1..1) + `FrequencyBars` (the dream pattern highlight) + the launcher's
  `GuidedExerciseCard` — **no new design-system primitive, so no `/gallery` change**. Threaded a Home→builder
  handoff: exported `toSeed` from `SuggestedPanel` + a **router-state seed pickup** in `Questionnaires`.
  Code-reviewer **ship** (per-person isolation, no-spend-on-load, and admin-$ redaction all verified airtight;
  applied: bound `hasRecentCrisis` to the latest 3 sessions [was unbounded → a stale flag stuck forever];
  removed dead CSS; `overflow-wrap` on the dream snippet; a `ready`-gate to kill the empty-grid flash; dropped
  the InboxCard head icon; the §5 `UsageCard` doc drift). Gate green: typecheck (node + web/DOM-lib), lint,
  format, **340 core + 430 desktop + 8 relay** unit (+greeting/wellbeing pure-helper tests, +5 Home RTL —
  getting-started, self-hide, the ≥2-session wellbeing gate, admin-vs-member $, AI-off hides Suggested),
  **61 E2E** (+2: brand-new → getting-started; a seeded person sees the cards + Resume opens the session +
  390px inner-scrollbar guard). **Visual QA** via the web preview at desktop (light + dark — the 3-up card
  reflow with Continue/Suggested full-width) + 390px (single column, 0 overflow, no console errors). On
  `feat/home-dashboard` off `main`; NOT merged (awaiting user confirm). **Lesson: when one card's data lives
  in an all-people store (`insightStore`, no per-person `reset()`), per-person isolation is the CONSUMER's
  `subjectPersonId` filter, not a store reset — and it holds across the AppShell-reset-vs-Home-load effect
  race because Home's async `load()`s resolve AFTER AppShell's synchronous resets. Also: a "recent" crisis
  surface must be bounded (latest N sessions), or a single old flag keeps the supportive banner up forever.**
- 2026-06-14 — Build (**App-refresh package F — richer dream image style; SPEC 13 §15 APPROVED + BUILT**;
  [13-dream-images](docs/specs/13-dream-images.md) §15, amends §5.3/§6). Renderer + settings + one core
  prompt-builder param — **no schema, IPC, provider, or metering change**. Nothing was unstated (all forks
  resolved in §15.5), so no new questions. **Expanded `dreams.imageStyle`** from a 4-value enum to **~20
  family-grouped presets** (Painted / Drawn / Stylized / Photographic-ish) sharing **ONE
  `IMAGE_STYLE_PRESETS` constant** (new `app/routes/dreams/imageStyles.ts`) used by **both** the Settings
  select and the `DreamImagePanel` picker — both render native `<optgroup>`s; the schema field stays a **free
  string** (the four original values retained, so pre-expansion dreams still resolve to a label), and a
  legacy/unknown stored value renders as a **fallback option** in both surfaces (§15.4). **Added Settings-only
  `dreams.imageStyleNotes`** (textarea, max 300, default empty) — the dreamer's free-text style direction —
  threaded through `buildImagePromptInput`'s new optional **`styleNotes`** param (appends
  `Additional style direction: …` after the style line, before the framing; **blank ⇒ no line**) and read
  host-side in `coreBridge.dreamGenerateImage`. **NO per-image notes** — the `dreams:generateImage` IPC is
  unchanged. **Softened** the baseline `DREAMLIKE_FRAMING` + `DISTILLATION_INSTRUCTION` to **"evocative,
  non-photorealistic"** so it blends with a non-dreamlike preset (cinematic/realistic = filmic /
  painterly-realistic) while keeping the §8.2 **never-a-photoreal-likeness** guarantee — applied to **every**
  prompt regardless of preset; the name-free / no-private-field privacy boundary is unchanged (style notes are
  visual direction only, through the same distillation). **Added a reusable `textarea` settings control type**
  - a **grouped `select`** variant to the registry (`settings/types.ts` + `SettingField.tsx`; textarea reuses
    the design-system `Textarea`, renders full-width/stacked with a reset; **no new `/gallery` primitive** —
    `Textarea` is already catalogued). Code-reviewer **ship** (applied the one nit: the Settings grouped-select
    now renders a legacy/unknown value as a fallback option, matching the panel's §15.4 handling). Gate green:
    typecheck (node + web/DOM-lib), lint, format, **340 core + 417 desktop + 8 relay** unit (+ prompt
    include/omit-direction-line + always-keeps-framing, a distillation-input capture asserting notes reach the
    Claude pass, textarea-persists + grouped-optgroups + legacy-fallback RTL, panel expanded-preset + legacy
    RTL), **59 E2E** (settings reveal sets an expanded preset + notes → both persist to `settings.json`;
    visualize stamps the chosen preset on `Dream.image.style`; 390px guard). **Visual QA** via the web preview
    at desktop + 390px (grouped Default-image-style select [4 families, 21 options], full-width style-notes
    textarea, the panel picker — 0 overflow, no console errors). On `feat/dream-image-style` off `main`; NOT
    merged (awaiting user confirm). **Lesson: one shared `IMAGE_STYLE_PRESETS` constant keeps a grouped picker
    identical across Settings and a feature panel — render it via native `<optgroup>` children (the design-system
    `Select` already takes children), and since the stored value is a free string, both surfaces must render a
    fallback `<option>` for an unlisted value or a controlled select silently shows the wrong one.**
- 2026-06-14 — Fix (**`budget:status` $-redaction — close the own-budget-$-over-IPC leak**; on `feat/shell-titlebar`,
  the package-E follow-up the code-reviewer flagged + the user asked to do now). The renderer already gated the $
  DISPLAY behind `budgets.manage`, but `budget:status` returned raw `spentUsd`/`limitUsd` to ALL callers (a
  non-admin could read their own spend over IPC via devtools). Now `BudgetState` always carries a **`budgetRatio`**
  (0..1, clamped; computed in core `checkBudget`) and `spentUsd`/`limitUsd` are **optional + bridge-redacted**:
  `budgetStatus` returns the dollars only to `budgets.manage` callers, a member gets `{state, budgetRatio, period}`
  for their own budget and a neutral `none` for the household **app** budget (the Everyone scope is admin-only too).
  The **UsageRing** now renders its % from `budgetRatio` + shows whenever `state !== 'none'` (was keyed on
  `limitUsd`), so it still works on redacted data; the admin $ line is guarded on `limitUsd != null`. Mirrors the
  established `usage:summary` / `usage:sessionCosts` redaction (memory `selfos-usage-budget-rules` updated: **the $
  boundary is the bridge, not the UI**). Gate green: typecheck (node + web/DOM-lib), lint, format, **412 desktop**
  unit (+1 coreBridge: admin sees $, member gets ratio-only + no app $; UsageRing gains a redacted-status [ratio
  only, no $] render test), **59 E2E** (the member-bar-no-$ / admin-$ / usage-dashboard paths all still green).
  Updated 02 §13.4. **Lesson: a renderer display-gate is NOT a trust boundary — any cost/$ field must be redacted
  in the bridge for non-`budgets.manage` callers (return a `budgetRatio`, never the dollars), or it leaks over IPC.**
- 2026-06-14 — Build (**App-refresh package E — shell, TopBar & usage visibility; SPEC 02 §13 BUILT + Approved**;
  [02-app-shell](docs/specs/02-app-shell.md) §13, amends §3.4/§3.5; references 06). Replaced the in-content
  **TopBar** strip + the sidebar brand header with **ONE window-spanning `AppHeader` titlebar** (brand left,
  global controls right, sidebar+content below) — fixing the macOS brand-vs-traffic-lights collision and putting
  brand + controls in one cohesive bar. **Asked first** the 2 unstated UX forks (both confirmed): the **sync chip
  opens the vault folder** on click + the in-content **Banner stays**; the **brand links Home**. **Renderer:** a
  shared **`TitlebarControl`** primitive (one `--control-height`/hit-area/hover/focus, `no-drag`; → `/gallery`)
  that the appearance menu, usage ring, account menu + the new **`SyncStatusChip`** all render through, so the
  cluster (sync · usage · appearance · account) aligns exactly; the **enriched UsageRing dropdown** (% allowance,
  session count, **top usage by type**, **admin-only $ + AdminOnlyBadge**, "View usage details →"); `Brand` is now
  **presentational** + an `AppHeader` `Link` wrapper (so the lock screen still uses it inert), collapsing to a
  **tile-only mark below `--bp-sm`**; the mobile hamburger moved into the titlebar; **`AppShell`** restructured to
  header-over-(sidebar+content). **NO breadcrumb, NO global new-session button** (§13.6). **Main (`window.ts`):**
  **per-platform window chrome** — macOS keeps `hiddenInset` + a centered **`trafficLightPosition`** + a reserved
  **`--titlebar-traffic-width`** inset before the brand (**fullscreen reclaim** via a new **`window:fullscreenChanged`**
  event, pushed once on load for OS-restored-fullscreen); **Windows `titleBarOverlay`** + **Linux default-frame**
  are **blind/best-effort** (verified on-device later, like iOS). **Seam:** added `readonly platform: AppPlatform`
  - `onFullscreenChanged()` to `SelfosBridge`, threaded through preload (`process.platform`), coreBridge + webHost
    (Capacitor → `'ios'`/`'web'`), the Electron `ipc.ts` host, the coreBridge-test host, and the test-utils mock.
    New tokens `--titlebar-height`/`--titlebar-traffic-width`/`--titlebar-window-controls-width`/`--control-height`.
    Code-reviewer **fix-first** (applied both should-fixes: the **calm "all synced" chip label now names its action**
    since it's a button that opens the folder; **initial fullscreen state is pushed once on `did-finish-load`** so an
    OS-restored-fullscreen window doesn't reserve a dead 80px inset; deferred the pre-existing `budget:status`
    own-$-to-non-admin-over-IPC redaction as a follow-up task — display is already gated). Gate green: typecheck
  (node + web/DOM-lib), lint, format, **411 desktop unit** (+10: TitlebarControl [3], SyncStatusChip [3], AppHeader
  [3], UsageRing admin-$/top-types [1]; updated Brand [now presentational/Router-free]), **59 E2E** (+2: the macOS
    traffic-light inset measured [brand left ≥72px, skipped off-darwin] + the usage dropdown → /usage; the brand
    collapses to tile-only at 390px; the geometry guard now covers the **whole** sync · usage · appearance · account
    cluster). **Visual QA**: the web preview at desktop (light+dark) + 390px (tile-only brand, sync chip collapsed,
    enriched dropdown with admin-$ + "Top usage", no overflow, no console errors) **and a real macOS Electron window
    capture** confirming the reserved traffic-light gap clears the brand. Deleted the old `TopBar`. On
    `feat/shell-titlebar` off `main`; NOT merged (awaiting user confirm). **Lesson: the brand's accessible name
    must NOT contain a word another control uses — "SelfOS, Home" collided with every `getByRole('link',{name:'Home'})`
    in the suite (Playwright substring-matches aria-labels), and the sync chip's "Vault: …" label collided with the
    Settings "Vault" button; name the brand link just "SelfOS" (title="Home") and scope colliding queries with
    `{exact:true}`. Also: on macOS the 80px traffic-light inset + a full control cluster overflows at phone width —
    the sync chip + brand wordmark must collapse first (§13.5 order), and platform-native window chrome (traffic
    lights) isn't in a Playwright page capture, so verify the inset by geometry + a real-window screenshot.** **NEXT:
    package F (`13 §15` dream image style) or G (`17` Home — build last).**
- 2026-06-14 — Build (**App-refresh package D — questionnaire authoring UX; SPEC 08 §15 BUILT**;
  [08-questionnaires](docs/specs/08-questionnaires.md) §15, amends §3.1/§3.6/§13.3). Renderer-heavy authoring
  refinements, **no new capabilities/IPC channels** (one IPC **field removal**). All four items: (1) a **General**
  type added to the starter taxonomy + made the **default for new questionnaires**; (2) **sensitivity is
  intimacy/scenario-only** via a new pure single-source-of-truth module `questionnaireTypes.ts` (`SENSITIVITY_TYPES`):
  **intimacy** shows the tiers only (no Standard, seeds `intimacyGeneral`), **scenario** shows Standard default +
  escalatable tiers, **every other type hides the picker and forces `standard`** — `effectiveSensitivity(type,tier)`
  clamps on display **and on save** (so a stale/seeded non-standard tier on a non-sensitivity type or existing
  questionnaire can't leak), `seedSensitivityForType` (a delegate of the same clamp) reseeds on type-change/custom-type-add;
  the `.metaRow[data-cols]` grid collapses Type to full-width when the picker is hidden; (3) **reworded the
  compatibility "who sees what" copy** — dropped "break-glass"/"audited" jargon, "Each sees their own" →
  **"Shared report + your own answers"**, plus a plain **"A record is kept each time you open their answers"** line for
  `senderSeesAll` (the `readRaw` + audit mechanism is **unchanged**); light pass on core `disclosure.ts` ("shared
  compatibility report" → "combined report"); (4) **removed the "Use my information" AI toggle** — author context is
  always used, so `includeAuthor` was **dropped from the renderer-facing `questionnairesGenerate` IPC** (channels +
  `GenerateSchema`) and **hardcoded `true` in `coreBridge`**, while the **core context-provider registry KEEPS
  `includeAuthor`** (compatibility/target-context legitimately passes `false` — the §13.3 shareable-only boundary is
  intact); (5) a **live inline per-question preview** (`QuestionPreview.tsx`) reusing the shared **`@selfos/answering`**
  `QuestionnaireForm` — byte-identical to the recipient view, **expanded for the focused question, collapsed for the
  rest** (`onFocusCapture` sets the open id; per-card "Show/Hide preview" toggle), non-interactive (local throwaway
  answers), crisis footer suppressed inline (the full Preview mode still shows it). Code-reviewer **ship** (sensitivity
  clamp airtight on save + existing/seeded questionnaires; the `includeAuthor` IPC narrowing keeps the author-always /
  target-optional boundary; the inline toggle's `aria-label="Show/Hide preview"` overrides its visible "Preview" text so
  it never collides with the mode "Preview" button — fixed the 3 E2E mode clicks to `{exact:true}`; applied the DRY nit
  — `seedSensitivityForType` now delegates to `effectiveSensitivity`). Gate green: typecheck (node + web/DOM-lib), lint,
  format, **336 core + 402 desktop + 8 relay** unit (+`questionnaireTypes` [6], +6 RTL §15, updated the compat-label +
  sensitive-note tests), **57 E2E** (+1: General default [no picker] → inline rating preview matches full Preview →
  Intimacy tiers + note → save/reopen round-trip + 390px inner-scrollbar guard). **Visual QA** via the web preview at
  390px (General full-width Type/no picker, Intimacy tiers + consent note, inline preview live-updating shortText→Yes/No,
  reworded visibility copy — 0 overflow, no console errors). **Deferred (captured in §15.8):** "break-glass" still
  appears in `RelaySendPanel` + the admin disclosure setting (out of §15.3 scope — a future light copy pass). On
  `feat/questionnaire-authoring-ux` off `main`; NOT merged (awaiting user confirm). **Lesson: when a build serves a
  prebuilt `dist-web` (hashed assets) rather than live `/src`, source edits won't appear in the web preview until you
  re-run `build:web` — and the inline-preview reuse of `@selfos/answering` duplicates a question's accessible elements
  (img alt, "Preview"), so scope E2E queries (`.first()`, `{exact:true}`) accordingly.**
- 2026-06-14 — Polish round 2 + **rules update** (user: "wrapping is LAZY, not design; cards waste vertical
  space"). Replaced the wrapping pill-chip status filter with a **full-width `Select`** (fills the sidebar,
  scales to any label, never wraps — `combobox` "Filter sessions by status"); **redesigned the guided cards
  to be compact** (~5 lines → ~3: tight padding, a single eyebrow row carrying the framework tag + a "Steps"
  marker, a **2-line-clamped blurb**, a hover go-arrow, and a denser `auto-fit` minmax(190px) grid that
  fills the row). Rules updated: CLAUDE.md §12 + memory `selfos-ui-conventions` now say **don't solve
  "doesn't fit" by wrapping a control row — use a space-filling component (full-width `Select`/control)** and
  **design cards for density** (clamp blurbs, fold metadata, denser grid). E2E updated for the Select filter
  (`selectOption` instead of clicking chips) and status assertions target the pill's `data-status` (not the
  text, which now also matches the hidden `<option>`). Gate green: typecheck/lint/format, 336 core + 389
  desktop unit, **56 E2E**. Visual QA at 390/900/1280px (full-width Select, 3-up compact cards at desktop /
  1-up at phone, no scrollbars, no console errors). **Lesson: when a control row doesn't fit, the answer is a
  different COMPONENT (a Select that fills the space), never `flex-wrap` — and a text assertion like
  `getByText('In progress')` silently starts matching a `<select>`'s hidden `<option>` once you swap to a
  Select, so assert status pills by a stable hook (`[data-status]`), not their label text.**
- 2026-06-14 — Polish + **rules update** (Sessions launcher UI/UX pass; user flagged avoidable flaws). Fixed:
  (1) the status filter was a `SegmentedControl` that **scrolled-x** in the narrow sidebar → replaced with
  **wrapping pill chips** (no scrollbar); (2) guided-session cards put the title + framework tag on one line
  → title wrapped a word-per-line at narrow widths → **tag is now an eyebrow ABOVE a full-width title**;
  (3) the Intimacy accordion butted its content against the title → **`details[open]` summary margin-bottom**;
  (4) a **pre-existing flexbox bug** — the conversation title lacked `min-width:0` so it overflowed the sidebar
  (horizontal scrollbar) → fixed; (5) the row crammed 3 pills + 3 action icons → **rename/delete collapsed into
  the kebab menu**, leaving one clean `⋯` (also fixed a real **dropdown-clipping** bug: the wrapped lone kebab
  went left-aligned and its `right:0` menu rendered off the sidebar's edge where `overflow` clipped it). **Rules
  updated** per the user: CLAUDE.md **§12** (no horizontal scrollbars anywhere incl. inner controls; title never
  shares a line with a tag; flex `min-width:0`; dropdowns not clipped; accordion spacing) + **§7 DoD** (the E2E
  overflow guard must catch INNER scrollbars — assert no element has `scrollWidth>clientWidth` with
  `overflow-x:auto|scroll` — and test at the ACTUAL container widths, e.g. the ~240px sidebar, not just 390px);
  memory `selfos-ui-conventions` synced. The guided E2E now asserts **no inner scrollbar at 390px AND 900px**;
  session kebab E2E interactions **scoped to the Conversations sidebar** (fixes a flaky race where the thread-head
  kebab — which has no Rename — was grabbed by `.first()` before the sidebar row rendered). Gate green:
  typecheck/lint/format, 336 core + 389 desktop unit, **56 E2E** (incl. 5 session tests ×2 for flakiness). Visual
  QA at desktop + 390px (filter chips wrap, eyebrow-tag cards, decluttered rows, no scrollbars, no console
  errors). **Lesson: a `main`-only overflow guard misses inner scrollbars (a scrolling SegmentedControl) and
  pane-specific overflow (a `min-width:0`-less flex title) — the guard must scan ALL elements for
  `overflow-x:auto|scroll` + `scrollWidth>clientWidth` and run at the real narrow container widths; and a
  `right:0` dropdown whose trigger can wrap to a left-aligned line will render off-screen and get clipped.**
- 2026-06-14 — Build (**App-refresh package C — guided sessions; SPEC 16 FULLY BUILT**;
  [16-guided-sessions](docs/specs/16-guided-sessions.md), builds on `05`/`06`/`09`/`08`/`04`). The Sessions start
  screen is now a **launcher**: free-start ("What do you want to work through?") + an AI **"Suggested for you"** row
  - a grouped curated **catalog** (Reflective & therapy-informed · Coaching · Intimacy & connection). A guided
    session is an **ordinary `05` Conversation carrying `guideId`** (+ `guideStep` for structured) — so streaming,
    metering (`06`), lifecycle + End&summarize (`09`) all work with **no new machinery**. **Asked first** the three
    unspecced build forks (all confirmed): suggestions are **explicit-first-tap** (no silent spend — `guided:getState`
    reads the cache, `guided:suggest` spends `guided.suggest`); structured steps advance via an **AI-embedded
    `[[SELFOS:STEP:n]]` marker** (turn-free, stripped from saved + streamed text, clamped, best-effort — never blocks
    free input, mirroring the `09` wrap-up marker); the **18+ intimacy ack is per-person in the vault**
    (`people/<id>/guidance/prefs.enc`, reset on switch). **Core:** `guidedCatalog.ts` (17 built-in exercises, code not
    vault; **non-clinical group titles + per-card framework tags**; every addendum + opener leads with "self-help
    inspired by X, **not therapy**"); `guidedSteps.ts`; `buildSystemPrompt(…, guideId?)` appends the addendum
    **AFTER** PERSONA+SAFETY+context (boundary always leads) + the step convention for structured; `chatService`
    advances `guideStep` + `stripCoachMarkers`; `guidedSessionService.startGuided` (stamps `guideId`, seeds the
    **static opener** — no model call, works offline); `guidanceService` (recommender **reusing the questionnaire
    gap-finder context-provider registry** — structured context only, **never transcripts** — + cache + ack);
    `endAndSummarize` notes the exercise (`provenance.guideId` + a leading "Exercise: …" fact). **Schema:**
    additive-optional `Conversation.guideId`/`guideStep` + `InsightProvenance.guideId` (**no schemaVersion bump/
    migration**); `Guided*` cache/prefs/view schemas; `guided.suggest` usage type. **Seam:** `sessions:startGuided` /
    `guided:getState` / `guided:suggest` / `guided:acknowledgeAdult` — gated `sessions.own` + active-person-scoped
    **in the bridge** (the trust boundary; intimacy is excluded from suggestions host-side until acked, not just in
    the UI); the Claude call + key stay in main. **Renderer:** the launcher (free-start composer + `SuggestedSessions`
    explicit-first-tap row with calm AI-off/over-budget/thin-profile states + grouped collapsible `GuidedCatalog`
    with the per-person-gated Intimacy group), `GuidedStepper` beside structured threads, `guidanceStore` (per-person,
    reset in AppShell), `conversationStore` guide fields + `startGuided`; `/gallery` gains the card + stepper.
    Code-reviewer **ship** (safety/privacy/gating/spend boundaries all verified airtight; applied the a11y nit — the
    catalog group title is a styled span in a labelled `<section>`, not a heading nested in the `<summary>` button).
    Gate green: typecheck (node + web/DOM-lib), lint, format, **336 core + 389 desktop + 8 relay** unit, **+1 E2E**
    (start a structured guided exercise → opener + stepper → steered reply → complete & summarize → the Insight notes
    the exercise + the goal feeds a later `buildContext`; the Intimacy group is 18+-gated; explicit-first-tap
    suggestions; 390px overflow guard). **Visual QA** via the web preview at desktop + 390px (launcher, grouped
    catalog with framework tags, the 18+ gate → reveal, the structured stepper + not-therapy opener; 0 overflow, no
    console errors). On `feat/guided-sessions` off `main`. **Lesson: a guided session needs NO new machinery — it's
    an ordinary Conversation carrying `guideId`; the only additive pieces are a code-only catalog, an addendum
    appended AFTER (never before) PERSONA+SAFETY, and two turn-embedded markers (wrap-up + step) that cost nothing
    extra. Every affordance that would SPEND (suggestions) is explicit-first-tap, never auto-run on view.** **NEXT
    package: D (questionnaire UX) — per the app-refresh plan.**
- 2026-06-14 — Build (**App-refresh package B — session lifecycle & analysis; SPEC 09 FULLY BUILT** [core +
  the §14 lifecycle amendment]; [09-session-analysis](docs/specs/09-session-analysis.md), amends `05` §4.1).
  Coaching sessions now have an explicit **lifecycle** + **memory**. **Asked first** the three unspecced UX
  forks (all confirmed): the wrap-up card is **inline + a "View in Memory" link** (not persisted on the
  session); status is set from a **per-row kebab**; the AI completion suggestion **re-surfaces on a later hint**
  after dismiss. **Schema:** `Conversation.status` (`inProgress`/`onHold`/`complete`) + `endedAt`/`insightId`/
  `insightStale` — all **additive-optional, NO schemaVersion bump** (reconciled the spec's draft "bump+migration"
  to the dream/person additive precedent; `conversationStatus(c)` normalizes absent ⇒ `inProgress`); `wrapUpSuggested?`
  on `ChatTurnResult`; `SessionSummaryResult`/`SessionCost` view types; `session.analyze` usage type. **Core:**
  `sessionAnalysisService` — `endAndSummarize` reads the transcript ONCE in the subject's own process → an
  auto-approved `Insight` (`source:'session'`, mood metrics `moodValence`/`moodEnergy` clamped −1..1, facts =
  Theme/Goal/Follow-up/Person-mentioned), **meters BEFORE parse** (a failed-parse paid call is still billed),
  and the **re-run/stale path reuses the insightId + carries each fact's `shareableWith` forward by text**;
  `setSessionStatus`; `rollupSessionCosts`. The **`wrapUpSuggested` hint is turn-embedded** (no extra Claude
  call): the coach may append a private `[[SELFOS:WRAPUP]]` marker that `chatService` strips from BOTH the saved
  - streamed text (`stripWrapUpMarker`, partial-marker-safe), and **continuing a `complete` session flips it back
    to `inProgress` + marks the insight stale**. Session Insights flow through the **existing** shared insight
    provider, so the gap-finder + Memory surface pick them up with no new plumbing. **Bridge (trust boundary):**
    `sessions:setStatus`/`:endAndSummarize` gated by `sessions.own` + active-person-scoped; `usage:sessionCosts`
    returns per-session `{tokens, costUsd?, budgetRatio}` where **`costUsd` is included ONLY for `budgets.manage`
    admins** (redacted in the bridge, mirroring `usage:summary`) — everyone else gets a dollar-free `budgetRatio`.
    **Settings:** a new **Sessions** section with `sessions.memoryEnabled` (default ON — the master memory toggle)
  - `sessions.autoSummarizeOnEnd` (default OFF — completing **asks** before spending; declining still completes).
    **Renderer:** status pills + an All/In-progress/On-hold/Complete filter, the per-row kebab status setter, a
    per-session cost indicator (admin `$`+`AdminOnlyBadge` else a budget bar), the inline `WrapUpCard`
    (crisis-first if flagged, mood chips, facts, Memory link) + the dismissible `WrapUpSuggestion` chip near the
    composer. Code-reviewer **ship** (privacy boundary + admin-$ redaction verified airtight; metering-before-parse,
    re-run carry-forward, marker-never-persisted-or-shown all confirmed; applied both should-fixes — **every
    summarize affordance is now gated on `sessions.memoryEnabled` so memory-off never offers a button that can only
    fail, and the kebab "Complete & summarize" is hidden on an already-complete session** so it can't silently
    re-spend — and the nit: wired the discarded `people` field into Person-mentioned facts). `sessions:reanalyze`
    folded into `endAndSummarize` (the re-run path is the same call when an insight already exists — no redundant
    seam). Gate green: typecheck (node + web/DOM-lib), lint, format, **308 core + 382 desktop + 8 relay** unit (+
    sessionAnalysisService [13], wrapUp [3], chatService marker/reopen [3], bridge admin-$/memory-off/gating [4],
  Sessions RTL [5], sessions-settings [3]), **+2 E2E** (complete→summarize→**decrypt the real `buildContext` and
  assert the goal feeds a later session** + filter + reopen-flips; member sees the bar with **no $** + memory-off
  offers no summarize affordance + no Insight). **Visual QA** via the web preview at 571px + 390px (status pills,
  admin-$ badge, kebab menu, wrap-up card all clean; 0 overflow, no console errors). On `feat/session-analysis`
    off `main`. **Lesson: a turn-embedded `wrapUpSuggested` hint (a private marker the coach may append, stripped
    from saved + streamed text) gets an AI completion signal for FREE on the turn the user already paid for — no
    second call — but every UI affordance that would SPEND on the back of it (summarize) must be gated on BOTH AI
    config AND the memory toggle, or you ship a button whose only outcome is a calm error.** **NEXT package: C
    (`16-guided-sessions`) — leans on B.**
- 2026-06-14 — Build (**App-refresh package A — the unified shareability model; SPEC 15 FULLY BUILT**;
  [15-shareability](docs/specs/15-shareability.md), amends `04`/`12`/`13`). Replaced People's fixed
  shareable/private buckets AND Dreams' silent "sensitive = excluded" with **one per-item control**. **Asked
  first** the two unspecced UX forks (both confirmed): `pronouns`/`birthday` get inline `ShareToggle`s on the
  Profile tab too, and ONE "Share all / Lock all" lives in the About header flipping **every** controllable
  field. **Schema:** `Person.privateFields` (opt-out list of locked field keys; absent ⇒ shared) +
  `PersonFieldKeySchema`/`PERSON_FIELD_KEYS` + the single gate `isPersonFieldShared`; **merged**
  `publicNotes`+`privateNotes` → one `notes` on **both Person AND Relationship** (+ `Relationship.notesShared`)
  — the **one schemaVersion bump** (v1→v2) with an **idempotent read-time migration**
  (`people/migrations.ts`, wired into `getPerson`/`listRelationships`); `Dream.informsContext` (default on)
  replacing the sensitivity exclusion. **Default = everything shared, literal flip, no grandfathering**
  (pre-release). **Core:** `buildContext` refactored to `profileLines(person, audience)` (own = all fields;
  others = only `isPersonFieldShared`); `buildDepictionNote` gates **each** depiction part (so a locked
  appearance/gender/ethnicity/birthday is withheld from the image too); **`insightFeedsContext`**
  (insights/insightStore) suppresses a **dream-sourced insight from ALL context** when its dream's
  `informsContext` is off — reads the dream file **directly** to dodge the insights↔dreams cycle (the
  `listAllInsights` precedent), **fail-closed** on a malformed dream (§7 "not silently shared"); health/faith
  - relationship notes + questionnaire `contextProviders` all moved onto the per-field gate;
    `dreamInsightService` dropped the SENSITIVE guard (sensitive dreams now shareable when `informsContext` on).
    **Renderer:** a new **`ShareToggle`** primitive (icon + text, `aria-pressed`, state-as-text — added to
    `/gallery`); a `Field.labelAction` slot; `PersonEditor` per-field toggles + bulk Share/Lock-all + merged
    Notes + dissolved About/Private split; `RelationshipsEditor` merged Notes + share toggle; `DreamComposer`
    informsContext switch + revised sensitivity help; `DreamAnalysisPane` gates share controls on
    `informsContext` (not tier). Code-reviewer **ship** (privacy invariant verified airtight on **every** traced
    path; migration idempotent + lossless; cycle-free gate; applied both nits — future-proofed the relationship
    notes-save to not drop `closeness`/`since`/`label`, and made the malformed-dream gate fail-closed). Gate
    green: typecheck (node + web/DOM-lib), lint, format, **289 core + 370 desktop + 8 relay** unit (+ the §10
    per-key privacy-boundary truth table, the notes-merge migration [person+relationship], `informsContext`
    on/off exclusion, sensitive-now-shares, `ShareToggle` RTL, PersonEditor toggle/Lock-all/removed-copy,
    DreamComposer switch), **+1 E2E** (UI-driven lock of `healthNotes` on a related person → **decrypt the real
    assembled `buildContext` and assert the locked note is ABSENT while a shared field is PRESENT** + an
    informsContext round-trip + a 390px About-editor overflow guard). **Visual QA** via the web preview at
    desktop + 390px (toggles end-aligned with labels, Share/Lock-all in the header, the §3.1 inline explainer,
    Lock-all → Private state distinct by icon+text not colour, merged Notes, the dream switch + revised
    sensitivity help; 0 overflow, no console errors). Synced the amended specs (`04` §3.4/§4.1/§4.2/§8, `12`
    §3.1/§3.4/§8.3, `13` §3.7/§4.6/§8.2) to cross-reference 15. On `feat/shareability` off `main`. **Lesson: a
    ShareToggle's accessible name containing "may inform PEOPLE you relate to" collides with Playwright's
    substring `getByRole('button', {name:'People'})` and `getByLabel('Occupation')` (Playwright matches
    aria-label substrings; Testing-Library getByLabelText doesn't) — use `{exact:true}` on label/role matchers
    that share a word with a toggle's verbose accessible name.** **Package A is the foundational privacy refactor
    the rest of the 2026-06 refresh (B–G) builds on.**
- 2026-06-14 — Build (**Vault relinking slice 3 — the VaultError "Use a different vault" affordance; SPEC 14
  IS NOW FULLY BUILT**; [14-vault-relinking](docs/specs/14-vault-relinking.md) §7.7/§13 slice 3). The boot
  **VaultError** screen's second action changed from a direct `chooseVault()` ("Choose a different folder") to
  an **unlink-backed "Use a different vault"** (`appStore.unlink()`) — **fixing a latent stale-key bug**: the
  old path re-pointed via `useVault(newPath)` while the previous vault's master key was still on the device, so
  switching to a _different_ vault would have desync'd (fresh folder → UnlockScreen dead-end) or hit wrong-key
  decrypt failures. Routing through `unlink` clears the key + pointer first → onboarding "Choose a folder", so
  the switch is **key-safe**. **Retry is unchanged** (re-checks the SAME folder; the key is still valid for a
  temporarily-offline vault, so it must NOT unlink). **Visual-QA caught a real responsive bug** the 390px guard
  then locked: a long absolute vault path in the error message didn't wrap → horizontal overflow at phone
  width; fixed with `overflow-wrap: anywhere` on the description (the preview missed it because it used a short
  bookmark — the E2E's real tmpdir path surfaced it). Code-reviewer **ship** (the unlink-vs-refresh split
  verified; `unlink` is key-safe on an unreachable vault since it touches no vault bytes; applied the one nit —
  the spec-named 390px guard, which then found the overflow). Gate green: typecheck (node + web/DOM-lib), lint,
  format, **269 core + 361 desktop** unit (+3 `VaultError` RTL: renders both actions, Retry→refresh-not-unlink,
  the new button→unlink), **+1 E2E** (boot to VaultError on a missing path → "Use a different vault" →
  onboarding + device pointer cleared + a 390px overflow guard). **Visual QA** of the VaultError screen at
  desktop + 390px via the web preview (clean, buttons aligned; the web path clears `vaultBookmark` → onboarding
  with no console errors). On `feat/vault-relinking-slice-3` off `main`. **Lesson: a vault path is a long
  unbreakable string — any UI that renders it must `overflow-wrap: anywhere`, and a 390px guard that uses a
  REAL (long) path catches it where a short fixture wouldn't.** **Spec 14 (vault relinking) is COMPLETE — all 3
  slices on `main`: the `vault:unlink` backend op + seam (1), the Settings "Change vault…" control + dialog +
  cross-platform `vaultBookmark` clearing (2), and the VaultError affordance (3). Users can now unlink the
  current vault and switch to a different one, from Settings or the error screen, on both Electron and web/iOS,
  with no data loss and a key-safe re-link.**
- 2026-06-14 — Build (**Vault relinking slice 2 — the Settings "Change vault…" control + dialog + route-back**;
  [14-vault-relinking](docs/specs/14-vault-relinking.md) §3/§5.3/§5.4/§13 slice 2). The first user-facing
  surface: a **`vault.change`** custom row in Settings → Vault (no admin gate — any signed-in person, decision
  #3) opening a hand-rolled **`ChangeVaultDialog`** (`role="dialog"`, mirrors LockScreen/SuperAdminUnlock — no
  new design-system primitive, decision #6; Esc/scrim/Cancel = no-op, `aria-busy` on Continue, calm danger
  Banner on failure). On Continue → **`appStore.unlink()`**: calls `unlinkVault()`, resets `sessionStore`
  (new `reset()`) + **every** per-person store (the AppShell list **+ `resultsStore`**), then `apply(boot)` →
  onboarding; the Shell unmounts and the existing "Choose a folder" + `HouseholdGate` take over (no new
  routing). **Cross-platform fix found in visual QA:** the web/iOS host keys the active vault on
  **`vaultBookmark`**, not `vaultPath`, so the factory now clears **both** pointers — added a sound
  **`DeviceStatePatch`** type (lets the optional `vaultBookmark` be cleared to `undefined`; required-nullable
  `vaultPath` still takes `null`) threaded through `BridgeHost.updateDeviceState` + the node & web device
  stores. **Also closed a pre-existing gap:** `resultsStore` (sender-scoped Results/trends) now resets on an
  active-person switch in `AppShell` too. Code-reviewer **ship** (master key still cleared first, no vault
  bytes touched, API keys preserved, no import cycle, `DeviceStatePatch` sound; applied both should-fixes —
  `aria-busy` + the `resultsStore` AppShell reset — and the web-host clear test). Gate green: typecheck (node +
  web/DOM-lib), lint, format, **269 core + 358 desktop** unit (+`appStore` unlink/rethrow, +`ChangeVaultDialog`
  6, +`customRows` 1, +`webStores` vaultBookmark-clear, +bridge vaultBookmark assertion), **+1 E2E** (Settings →
  Change vault → Continue → onboarding; vault A `recovery.enc` **byte-identical** + device pointer cleared +
  **re-linkable** via the recovery-phrase UnlockScreen; a 390px dialog overflow guard). **Visual QA** via the
  web preview at desktop + 390px (the dialog reads calm/reversible — bold-led points, the amber recovery-phrase
  caveat, bottom-aligned Continue/Cancel; the new Settings row sits cohesively under Location/Reveal; the full
  web flow Change vault → onboarding verified end-to-end with no console errors — proving the iOS/web host gets
  unlink via the shared factory). On `feat/vault-relinking-slice-2` off `main`. **Lesson: the active-vault
  pointer is platform-specific — Electron `vaultPath` vs web/iOS `vaultBookmark` — so any detach must clear
  BOTH; a fix that only cleared `vaultPath` left the web/iOS app stuck (key gone but bookmark present).**
  **NEXT: slice 3** — the VaultError "Use a different vault" affordance (unlink-backed, key-safe; fixes the
  latent stale-key bug in that screen's "Choose a different folder").
- 2026-06-14 — Build (**Vault relinking slice 1 — the `vault:unlink` backend op + IPC seam**;
  [14-vault-relinking](docs/specs/14-vault-relinking.md) §5/§6/§13 slice 1). The first slice of the approved
  spec 14 (let users unlink the current vault folder + select a different one). **Backend only, no UI** — the
  Settings "Change vault…" control + dialog (slice 2) and the VaultError "Use a different vault" affordance
  (slice 3) follow. New `vault:unlink` op through the full typed seam (`channels.ts` `IpcChannels.unlinkVault =
'vault:unlink'` + `SelfosBridge.unlinkVault(): Promise<BootState>` → **`coreBridge.ts` host-agnostic detach**
  → **`ipc.ts` platform wrapper** → preload → `test-utils/bridge` mock). The detach (host-agnostic half):
  **clear the single-slot master key FIRST** (`secrets.clear(MASTER_KEY_ID)`) → clear device-local
  `vaultPath`/`activePersonId`/`pendingJoinPersonId` → reset super-admin inspect → `refreshBootState()` →
  onboarding. **Touches NO vault bytes** (the folder stays byte-intact + re-linkable via its recovery phrase).
  The watcher-stop (`stopVaultWatcher()`) is the platform wrapper in `ipc.ts`, exactly mirroring `useVault`'s
  `startVaultWatcher` (iOS has no chokidar → that step is a no-op; the shared factory is correct for both).
  Improved the shared `coreBridge.test` host so `getBootState`/`refreshBootState` derive from `device.vaultPath`
  (like the real `computeBootState`), so unlink recomputes to onboarding in tests instead of a frozen `ready`.
  Code-reviewer verdict **ship** (detach order + clear-key-first safety verified; key never crosses IPC; no
  vault writer invoked; typed seam complete across all 5 layers; applied the one nit — a partial-failure
  ordering test). Gate green: typecheck (node + web/DOM-lib), lint, format, **348 desktop + 269 core** unit (+4
  bridge: detach-clears-everything, vault-byte-untouched, idempotent-when-detached, clear-key-before-write-
  failure-stays-recoverable). On `feat/vault-relinking-slice-1` off `main`. **Why clear the key:** it's a single
  device slot, not keyed per vault — a stale key would mis-route the next folder (fresh → desync UnlockScreen;
  different existing vault → wrong-key decrypt failures, §7.1). Clearing it lets the existing `HouseholdGate`
  route the next folder with zero new routing code — which is why **unlink == switch**. **NEXT: slice 2** — the
  Settings "Change vault…" control + hand-rolled confirmation dialog + renderer store-reset/route-back + RTL +
  the full switch-round-trip E2E + visual QA.
- 2026-06-12 — Build (**Dream-images slice 5 — export + per-dream image sharing; SPEC 13 IS NOW FULLY BUILT**;
  [13-dream-images](docs/specs/13-dream-images.md) §3.5/§3.6/§13.1 slice 5). The final slice. **Asked first**
  the §11.4 placement: the recipient's **"Shared with you"** lives as a **section at the top of the Dreams
  journal** (self-hides when empty). **Export:** `dreams:exportImage` decrypts the image and a new
  **`saveImageFile` platform host op** writes the bytes **OUTSIDE the encrypted vault** (Electron save dialog +
  `writeFile`, with a `SELFOS_FAKE_SAVE_DIR` E2E hook; a Blob download on web/iOS); gated `dreams.generateImage`,
  dreamer-scoped; the panel's "Save image…" shows a "leaves the encrypted vault" note. **Sharing (mirrors the
  `12` §13.5 fact-share):** core `setDreamImageShare` (toggle `Dream.image.shareableWith`; refuses sensitive +
  non-related target), `getSharedDreamImage` + `listImagesSharedWith` with the **read-time re-gate** — both
  re-validate relationship + `shareableWith` + standard-tier on **every read**, so **un-share OR removed
  relationship OR a sensitive tier denies with no stale access** (no `shareableWith` cleanup needed —
  `listRelatedPeople` is the symmetric gate). Seam: `dreams:setImageShare` (gated **`dreams.shareContext`**,
  dreamer-scoped — a recipient can't re-share another's image) / `:getSharedImage` / `:listSharedImages`
  (viewer-scoped — the share itself is the grant). Renderer: the `DreamImagePanel`'s **Save image…** + **Share**
  controls (a per-related-person `Switch` list; shown only standard-tier + `dreams.shareContext` + has
  relations; a "kept out of shared context" note otherwise), and the recipient's **`SharedDreamImages`** gallery
  at the top of Dreams. **Also fixed a pre-existing per-person leak** the 390px QA surfaced: `Dreams.tsx` now
  **resets its `selection` on `activePersonId` change** — a switch had left another person's dream selected,
  hiding the mobile list (incl. "Shared with you"). Images still **never feed AI coaching context** — sharing
  only makes them viewable. Code-reviewer **ship** (the read-time re-gate verified airtight on every path —
  no path lets a non-recipient read another's image; export writes a decrypted file only by the dreamer's
  gated action; sharing scoped to `dreams.shareContext` + the active person; two optional nits, no change).
  Gate green: typecheck (node + web/DOM-lib), lint, format, **269 core + 344 desktop + 8 relay** unit (+3 core
  sharing [share→read→un-share-denies, relationship-removal-denies, sensitive+non-related-refused], +1 bridge
  export→share→recipient round-trip, +4 RTL), **+1 E2E** (`SELFOS_FAKE_IMAGE`+`SELFOS_FAKE_SAVE_DIR`: export
  writes a **real PNG outside the vault** [magic-byte assert — decrypted, not ciphertext] + share → switch to
  the partner → the image appears in their "Shared with you"). Visual QA at desktop + 390px (the Share controls
  - cost/Admin-only badge + the recipient gallery all read clean; the per-person reset fixed the mobile
    recipient view). Built in the **`feat/dream-images-slice-5`** worktree off `main`. **Lesson: a per-person
    read-time re-gate (relationship + share + sensitivity re-checked on EVERY read) means a share auto-revokes
    when any of those changes — no separate revocation or `shareableWith` cleanup is needed, and a removed
    relationship drops the share for free.** **Spec 13 (AI dream images) is COMPLETE — all 5 slices on `main`;
    the People-profile descriptive fields, the OpenAI second provider, generation, metering, settings, the
    capability, the panel, export, and per-dream sharing are all built + tested. The only remaining Dreams work
    is the user's real on-device OpenAI/Cloudflare verification (blind-written like the relay/iOS bits).**
- 2026-06-12 — Build (**Dream-images slice 4 — the `DreamImagePanel` renderer + generate E2E**;
  [13-dream-images](docs/specs/13-dream-images.md) §3/§13.1 slice 4). The user-facing surface: a shared
  **`DreamImagePanel`** rendered in BOTH the dream detail/composer (`DreamComposer`, on a saved dream) and the
  analysis card (`DreamAnalysisPane`, beside the synthesis), bound to the dream id. **Self-contained local
  state + a `reqId` request-guard** (chose this over threading image state through the stores — per-person
  isolation already holds because the panel remounts per dream and `dreamStore.reset()` fires on a person
  switch; the reviewer verified no path renders one dream's bytes under another). **States** (resolved in
  priority order, no dead controls): capability-absent → **hidden** (`!can('dreams.generateImage')` → null,
  the bridge stays the trust boundary); calm consent-off / AI-off / no-key → a Settings link; entry (style
  picker + "Visualize this dream"); the **sensitive-tier warning-before-send** (any non-standard tier confirms
  before any provider call); loading; success (the `<img>` from a base64 data URL + Regenerate + "Delete
  image" + **admin-only cost**); REFUSED/BUDGET/ERROR calm messages; triggers hide while a confirm is open.
  **Admin-only cost double-gated:** a new admin-gated `costUsd` on `DreamImageResult` (the bridge includes it
  only when the active person can `budgets.manage`) AND the panel only renders it when `isAdmin` — a non-admin
  never sees a $ figure. `Dreams.module.css` gained `.imagePanel` + a square `.dreamImage` (max-width 420,
  object-fit cover). Code-reviewer **fix-first** (applied the one should-fix: the no-key calm state flashed for
  a frame before the async `secretHas` resolved on the happy path → now gated on `!loading && !hasKey`; the
  per-dream/person isolation, the double-gated cost, the capability boundary, the sensitive-tier warning, and
  a11y [meaningful `<img>` alt — never the raw prompt; `aria-live` loading; cost text equivalent] all verified
  clean). Gate green: typecheck (node + web/DOM-lib), lint, format, **266 core + 339 desktop + 8 relay** unit
  (+8 RTL: every calm state, generate+cost, sensitive warning, existing-image+delete, refusal), **+1 E2E**
  (`SELFOS_FAKE_IMAGE`+`SELFOS_FAKE_CLAUDE`: a sensitive dream → warning → generate → **assert `image.enc` is
  an AES-GCM envelope on disk, not the raw PNG** → regenerate → delete → image.enc gone). Visual QA at desktop
  - 390px (the panel sits below the dream fields / beside the analysis card; square image, clean Regenerate/
    Delete actions; no overflow). Built in the **`feat/dream-images-slice-4`** worktree off `main`. **Lesson: a
    panel whose readiness depends on an ASYNC check (`secretHas`) must gate that calm state on the initial load
    completing (`!loading && !hasKey`) — otherwise the common happy path flashes the wrong "add a key" state for
    a frame before the check returns; `findBy*` RTL waits for the settled state, so it won't catch the flash.**
    **NEXT: slice 5 (the LAST) — export (`dreams:exportImage` save dialog, bytes leave the encrypted vault) +
    per-dream image sharing (`Dream.image.shareableWith` + `dreams:imageShareTargets`/`:setImageShare`/
    `:getSharedImage`, gated `dreams.shareContext`, sensitive-excluded, read-time re-gate) + the recipient's
    "Shared with you" surface (ASK the user where it lives) + export/share E2E.**
- 2026-06-12 — Build (**Dream-images slice 3 — IPC seam + settings + capability**;
  [13-dream-images](docs/specs/13-dream-images.md) §6/§13.1 slice 3). Wires slice 2's `dreamImageService`
  through the renderer-facing seam. New **`dreams.generateImage`** capability (Member default ON; **not**
  EXPLICIT_GRANT_ONLY, so the Owner auto-grants it; Guest denied). IPC `dreams:generateImage`/`:getImage`/
  `:deleteImage` through the full seam (`channels.ts` + the slim `DreamImageResult` → **`coreBridge.ts` (the
  trust boundary)** → `ipc.ts` thin delegates + `image: defaultImageClient()` host wiring → `preload` →
  `test-utils/bridge` mock), all **gated by `dreams.generateImage` + dreamer-scoped**, with **both API keys
  read host-side** (`ANTHROPIC_API_KEY_ID` + `OPENAI_API_KEY_ID`) and **never crossing IPC**. `dreamGenerateImage`
  reads consent/model/style from vault settings and maps the rich result → the slim `DreamImageResult` (usage
  events stay host-side); `dreamGetImage` returns base64 (the `08` §13.2 pattern). **Settings** (Dreams
  section): `dreams.imageGenerationEnabled` (the one-time consent, default OFF), `dreams.imageModel`
  (**admin-only** `gpt-image-2`/`gpt-image-1` select), `dreams.imageStyle` (default-style select), and an
  **admin-only `OpenAiKeyControl`** — `aiControls.tsx` refactored to a shared **write-only `SecretKeyControl`**
  so the Claude + OpenAI key controls share one impl (secretSet/secretHas/secretClear, **never a get**);
  model/style/key `visibleWhen` consent on. The **`image` host part** added to `BridgeHost` — Electron uses
  `defaultImageClient`, the web preview `webFakeImageClient`, and iOS a new **`browserImageClient`**
  (browser-mode OpenAI `fetch`, the `browserClaudeClient` mirror, so iOS gets image-gen via `createCoreBridge`
  for free). Code-reviewer **ship** (trust boundary airtight — keys never returned; all 3 ops re-enforce the
  capability + scope in the bridge, not the UI; settings defaults match the service; `browserImageClient`
  line-for-line faithful to `openaiImageClient`; the `SecretKeyControl` refactor preserves `ApiKeyControl`'s
  exact behavior; two intentional nits noted, no change). Gate green: typecheck (node + web/DOM-lib), lint,
  format, **266 core + 331 desktop + 8 relay** unit (+2 bridge: a consent/key/capability-gated
  generate→read→delete encrypted round-trip + a Guest denial; +1 RTL `OpenAiKeyControl` saves under the OpenAI
  id), **+1 E2E** (the dream-image settings reveal + the "Admin only" marker; the section-overflow + 390px
  responsive sweeps now also cover the new settings). Visual QA at desktop + 390px (the Dreams settings
  section: consent toggle → model [Admin only] + style + OpenAI key reveal cleanly, no overflow). Built in the
  **`feat/dream-images-slice-3`** worktree off `main`. **Lesson: a second provider's key control is just the
  same write-only `SecretKeyControl` parametrized by a different `SecretStore` id — secretSet/secretHas/
  secretClear are generic, so no new secret IPC is needed; the key is read host-side in the bridge and never
  returned to the renderer.** \*\*NEXT: slice 4 — the shared `DreamImagePanel` (dream detail/composer + analysis
  card) with the generate/loading/success/refusal/calm states + the sensitive-tier warning + Regenerate/Delete
  - admin-only cost; the `dreamStore`/`dreamAnalysisStore` image lifecycle; the generate E2E + visual QA.\*\*
- 2026-06-12 — Build (**Dream-images slice 2 — the image core backend**;
  [13-dream-images](docs/specs/13-dream-images.md) §13.1 slice 2). SelfOS's **second AI provider** (OpenAI,
  images only — text stays Anthropic), core-only (no IPC/renderer — slice 3). **Asked first** the §11.1/§11.2
  build-time confirmations: ship **`gpt-image-2` (default) + `gpt-image-1`** at **~$0.17** flat. New
  **`ImageClient`** host interface (`@selfos/core/host`, the `ClaudeClient` mirror; a `REFUSED` [content-policy,
  uncharged] vs `ERROR` [transport] outcome) + a main-side **OpenAI impl + offline fake**
  (`apps/desktop/src/main/image/openaiImageClient.ts`, gated by `SELFOS_FAKE_IMAGE`; `=refuse` mode for the
  slice-4 refusal E2E; blind-written like the relay/iOS bits — user verifies on-device) +
  `OPENAI_API_KEY_ID = 'openai.apiKey'`. **The privacy core:** `buildDepictionNote` + `ageFromBirthday`
  (`@selfos/core/people`) is the single, **name-free + private-free** depiction source (appearance + gender +
  exact age from `birthday` + ethnicity; structurally never reads displayName/notes/private), and the pure
  `buildImagePromptInput` assembles the name-free distillation input. **Two-call flow** in
  `dreamImageService.generateDreamImage`: consent + both keys + budget gates → **Claude distillation** (records
  token `dream.imagePrompt`; the name-stripping pass) → **OpenAI render** → validate bytes/mime → `encryptBytes`
  → `people/<id>/dreams/<id>/image.enc` → stamp additive-optional `Dream.image` → record **flat** `dream.image`.
  `getDreamImage`/`deleteDreamImage` + the `isDreamImagePath` guard (the `08` §13.2 `isMediaPath` mirror).
  Pricing: `IMAGE_PRICING` + a flat-image branch in `costOf` (zero-token image events cost the per-image price,
  not $0). Code-reviewer **ship** (privacy boundary verified structurally airtight — **OpenAI only ever sees
  the Claude-distilled prompt, never the narrative or a name**; metering correct on the refused-vs-billed-vs-
  pre-gen split; a failed regenerate keeps the prior image; the path-guard confines I/O; applied the nit —
  dropped two unused pricing exports per §12). Gate green: typecheck (node + web/DOM-lib), lint, format, **266
  core + 328 desktop + 8 relay** unit (+18 core: full distill→render→encrypt→stamp→meter round-trip, the
  name/private-never-reaches-distillation security units, REFUSED-not-metered, billed-error-metered,
  regenerate non-destructive + shareableWith carried, the path guard, the pure prompt builder, `buildDepictionNote`
  - `ageFromBirthday`, the flat-cost pricing; +2 desktop fake-image-client). Built in the
    **`feat/dream-images-slice-2`** worktree off `main`. **Lesson: a two-provider privacy boundary is enforced
    by making OpenAI's ONLY input the Claude-distilled output — never the raw narrative/depiction — and by
    assembling the depiction in ONE name-free/private-free function (`buildDepictionNote`), so the name-exclusion
    is structural, not a filter that can be bypassed.** **NEXT: slice 3 — the IPC seam (`dreams:generateImage`/
    `:getImage`/`:deleteImage`) + settings (consent toggle, admin OpenAI key control + model select, default
    style) + the `dreams.generateImage` capability + the `image` host part in `createCoreBridge`.**
- 2026-06-12 — Build (**Dream-images slice 1 — the People-profile amendment**;
  [13-dream-images](docs/specs/13-dream-images.md) §4.6/§13.1, [04-people-roles](docs/specs/04-people-roles.md)
  §4.1). The first slice of the approved spec 13 (AI dream-image generation), but **independently valuable and
  imageless** — new descriptive `Person` fields used as coaching context **app-wide**. **Asked first** (the one
  open §11.3 build-time confirmation): `gender` = **Female / Male / Non-binary / Prefer not to say + free-text
  "Other…"** (user confirmed the spec proposal). **Schema:** additive-optional fields on
  `PersonSchema`/`PersonInputSchema` — SHAREABLE (`gender`, `appearanceDescription`, `ethnicity`, `occupation`,
  `interests[]`, `location`, `goals`, `communicationStyle`, `values[]`, `languages[]`,
  `importantDates[{label,date}]`) + PRIVATE (`healthNotes`, `faith`); **no `schemaVersion` bump, no migration**
  (the `email`/`phone` precedent); **`birthday` reused** for age, not duplicated. Threaded through
  `upsertPerson` (conditional spreads — a cleared field drops, doesn't linger). **Context:** two new pure
  helpers `shareableProfileLines`/`privateProfileLines` in `buildContext.ts` — the shareable set feeds the
  person's **own AND related/linked** people's context (the `publicNotes` "may feed others' AI" bucket), the
  private set feeds **only** the person's own block (the `privateNotes` boundary). `buildContext` (related
  loop) + `buildLinkedPeopleContext` both surface only the shareable set. **Renderer:** `PersonEditor` gained
  a Profile-tab **birthday** input (previously unreachable in the UI — the depiction's age source) and a new
  **About** tab — a shared group (gender = preset Select + free-text "Other…" reveal; `ChipEditor` for
  interests/values/languages; a label+date `importantDates` row editor) and a Private group (health/faith,
  marked "never shared with anyone else's AI, never sent to an image provider"). Code-reviewer verdict **ship**
  (privacy boundary verified airtight on every path — health/faith reach only the person's own block, never a
  related/linked person; applied the one nit: a clear-on-edit drop test). Gate green: typecheck (node +
  web/DOM-lib), lint, format, **248 core + 326 desktop** unit (+5 core: shareable/private context split,
  linked-person private exclusion, descriptive round-trip, clean-absence, clear-on-edit; +2 RTL: About save +
  gender-Other reveal), **E2E** (+1 encrypted About round-trip; the 390px sweep now walks the About tab incl.
  the densest important-dates row). Visual QA at desktop + 390px (the important-dates row stays single-line
  inline at desktop via a small flex CSS module, wraps cleanly at phone width; the Private card reads as
  intentional). Built in the **`feat/dream-images-slice-1`** worktree off `main`. **Lesson: a date-row whose
  fields flex-grow will push a trailing remove button to wrap below even at desktop — pin the label to
  `flex:1 1 0; min-width:0` and the date/remove to `flex:0 0 auto` so the row stays inline wide and wraps only
  when it must.** **NEXT: slice 2 — the image core backend** (`ImageClient` host interface + OpenAI impl +
  offline fake; `buildDepictionNote`/`buildImagePromptInput` name-free; `dreamImageService`; the `dream.image`
  flat + `dream.imagePrompt` token usage types).
- 2026-06-11 — Build (**Dreams amendment — link "people present" to the People graph**, finishing the §13.2
  deferral; [12-dreams](docs/specs/12-dreams.md) §3.1/§4.2/§5.1/§8.4 + §13 item 6). A dream's "people
  present" can now be **linked to a real household person** so the AI dream analysis draws on that person's
  **shareable** context. **Asked first (3 forks, all confirmed):** which people are selectable = **all
  household people** (the dreamer excluded); how much linked-person context feeds = the **full shareable
  set** (display name + relationship type + relationship/public notes + shareable insight facts); picker UX
  = **hybrid pick-or-type**. **Core:** new **`buildLinkedPeopleContext`** (`@selfos/core/people`, a sibling
  of `buildContext`) — the shareable-only context block for a set of linked `personId`s, **never** their
  private notes/non-shareable facts (the §8.4 boundary — byte-identical to `summarizeForContext`'s
  `shareable || shareableWith.includes(viewer)` rule), holding **even for a linked non-relation** (public
  notes are the "may feed others' AI" bucket — they feed; private data never does). `buildDreamPrompt` now
  takes the `Dream` and appends this for the dream's linked people, foregrounded as "People from your life
  who appeared in this dream." `DreamPersonRef` already carried `personId` (**no schema change, no
  migration**). **Renderer:** a new **`DreamPeopleEditor`** (link a household person from a dropdown —
  already-linked + the dreamer filtered out — or type a free name; linked chips carry a link icon + accent
  "linked" badge) replaces the free-text-only people `ChipEditor` in `DreamComposer` (now stores
  `DreamPersonRef[]`, loads the household via `peopleStore`, excludes the active dreamer; re-exported
  `DreamPersonRef` through `channels`). **Patterns follow-on:** people-frequency now resolves linked figures
  to real people (`personId` carried through `tallyPeople`). Code-reviewer **ship** (no blockers/should-fix;
  privacy boundary verified airtight on every path incl. non-relations + tampered ids; applied the one UX
  nit — a free name that duplicates an already-linked person's display name is rejected). Gate green:
  typecheck (node + web/DOM-lib), lint, format, **239 core + 315 desktop + 8 relay** unit (+4
  `buildLinkedPeopleContext`, +1 prompt-private-never-leaks core; +6 `DreamPeopleEditor` RTL, +1 composer
  linked-payload RTL), **37 E2E** (+1: link a household person → save → reopen → the `personId` resolves
  back to the household name, both chip styles, 390px no-overflow). **Visual QA** at desktop + 390px (linked
  vs free chips read as distinct + intentional; the picker self-hides when no one's left to link). Built in
  the isolated **`feat/dreams-people-link`** worktree off `main`. **Lesson: any household person is
  linkable, but the shareable-vs-private boundary still holds without a relationship — `publicNotes` +
  `shareable`/`shareableWith` facts feed, private data never does; the relationship graph only _labels_ the
  link.** **NEXT (the other half of this work): the deferred AI dream-image-generation companion spec
  (§11.2) — spec-first.**
- 2026-06-11 — Build + decision (Questionnaires **close-out — QR cut, recipient image-gating fixed, editable
  delivery templates**, [08-questionnaires](docs/specs/08-questionnaires.md) §3.2/§4.5/§6/§13.2). **User
  decision: QR delivery removed from the spec entirely** (decision #17 + §3.2) — copy/mailto/SMS/native-share
  cover delivery; QR would need a local QR encoder to keep the link off a third-party service. **Bug fix:**
  the `questionnaires:getImage` IPC was gated by `questionnaires.create` only, so an in-app recipient
  (`answer`, not `create` — only reachable via a custom role, since default Member has both) saw **null** for
  author images in the Inbox. Now a non-`create` person may read an image **only if it's referenced by a
  questionnaire sent to THEM** (the bridge scans the active person's recipient assignments) — so the Inbox
  shows author images without letting an answerer enumerate the household's media (the bridge is the trust
  boundary, not the renderer). **Built `questionnaires.defaultMessages`** (the deferred "editable in Settings"
  piece): a vault-scoped setting in the Questionnaires section holding `{ emailSubject, emailBody, smsBody }`
  with **`{sender}`/`{link}` placeholders** + a custom control (`RelayMessagesControl`, three fields + reset);
  the external send panel sources its email/SMS defaults from it (PIN appended/omitted by the per-send
  toggle) and stays tweakable per send (the panel + control fall back to `DEFAULT_RELAY_MESSAGES` when the
  vault value is unseeded). Gate green: typecheck (node + web/DOM-lib), lint, format, **238 core + 317 desktop
  unit, 45 E2E** (+9: relayMessages builders, the control RTL incl. edit-persists + reset, and a bridge
  recipient-reads-only-their-own-assigned-image test); web-preview visual QA of the templates control at
  desktop + 390px (no console errors). Synced `08` §3.2/§13.2 + changelog. **Lesson: a media-read IPC shared
  by an author (`create`) and a recipient (`answer`) must SCOPE the recipient's reads to media referenced by
  THEIR assignments — a blanket loosen-to-`answer` would let any answerer read by path; the recipient-scoping
  pattern (already used across §13.5) is the trust boundary.** **The Questionnaires feature (spec 08) is now
  fully built with no deferred image/delivery items; only the user's real Cloudflare deploy + the iOS
  worker-bundle wiring + two product/policy calls (explicit-tier App Store stance §11.2, starter-taxonomy
  wording §11.8) remain.**

- 2026-06-11 — Build (Questionnaires **§13.2 image follow-ups — orphan GC + purge-on-delete**,
  [08-questionnaires](docs/specs/08-questionnaires.md) §3.9/§13.2). Closes the two deferred question-image
  cleanups. Core **`imageGc.garbageCollectImages`** (`@selfos/core/questionnaires`) reaps every stored
  image (`questionnaires/media/<id>.enc`) referenced by **no live definition AND no send snapshot**; run
  after **`purgeQuestionnaire`/`deleteSend`** (purge-on-delete) and, in the bridge `questionnairesSave`
  handler, after an edit that **drops** an image (the draft-remove orphan the §13.2 builder leaves behind —
  "remove" only clears the draft). **Key correctness rule (the whole reason GC scans snapshots, not just
  defs):** an image removed from a definition may **still be frozen in an already-sent snapshot** the
  recipient/Results need — so it's kept until that send is also deleted. Dependency-light (inlines the def
  scan; no `questionnaireService` import) to avoid an import cycle. Gate green: typecheck (node + web/DOM-lib),
  lint, format, **238 core + 309 desktop unit** (+5: core `imageGc` orphan/keep/snapshot-keeps-it/shared-image
  - a bridge edit-removes-image-reaps test), affected E2E (image round-trip + the re-ask→delete→purge flow)
    re-run green. Synced `08` §3.9/§13.2. **Lesson: GC over a SHARED store decoupled from one entity's lifecycle
    must scan EVERY referrer (here both live defs and frozen send snapshots) — reaping by the live def alone
    would delete an image a sent snapshot still needs.** **The only remaining image follow-up is `getImage`
    recipient/Inbox gating (currently `create`-only); the Questionnaires feature is otherwise fully built.**
- 2026-06-11 — Build (Questionnaires **slice §13.6 — the external Cloudflare relay; the Questionnaires
  feature is now FULLY BUILT** except the deferred §13.2 image follow-ups + the AI image-gen companion spec;
  [08-questionnaires](docs/specs/08-questionnaires.md) §3.2/§3.4/§3.5/§3.8/§3.9/§4.1/§4.5/§5.1/§5.2/§5.4/§6/
  §8.3/§8.6/§11/§13.6). **The whole relay on ONE branch** (the user chose this over sub-slicing — the pieces
  are coupled). All decisions **asked first** (2 rounds, all recommendations confirmed): fake Worker/Cloudflare
  now (`SELFOS_FAKE_RELAY`) + user deploys/verifies later (blind-written like the iOS bits); **image ZK
  included**; spec **§11 retention/domain/crisis defaults confirmed**; relay page mirrors the SelfOS look,
  English v1. **Extraction:** the shared answering renderer → a new **`@selfos/answering`** package
  (`QuestionnaireForm` + `QuestionImage` + `CrisisFooter`, self-contained — plain elements + design-token CSS,
  no app design-system) so Electron + the relay page render ONE implementation (in-app callers pass the
  Sessions `CrisisFooter` so behaviour is byte-identical; the suite is the proof). **Relay crypto
  (`@selfos/core/relay`):** per-send **ECDH P-256** (responses sealed to the public key in the browser, opened
  with the private key wrapped under the master key), a symmetric **content key** in the URL **fragment**
  sealing questions + images (never seen by the server), a 6-digit **PIN**, and the pure **mailbox ops** the
  Worker calls — all through ONE shared PIN gate (5 attempts → 15-min lockout). **`relayService`** mints
  `Assignment.relay` at send (re-encrypting question images into the snapshot), drains + decrypts + purges,
  revokes. **`apps/relay` Worker** — a zero-knowledge mailbox + a branded WCAG responsive **static answering
  page** (bundles `@selfos/answering` + `@selfos/core/relay` → one `dist/worker.js` the app uploads; strict CSP;
  ≤256 KB single submissions; serves the derived disclosure + static crisis resources + the privacy notice +
  the trust line; drain/revoke authed by `drainSecret`). **Host:** `cloudflareDeployer` (provision KV + deploy/
  update/teardown via the Cloudflare REST API) + `relayHttpClient` + `relayConfig` (`config/relay.enc` —
  endpoint + drainSecret + **encrypted CF token**, host-side only, **never crossing IPC**); deployer + transport
  are interfaces with fakes. **Renderer:** the admin-only **Settings → Relay** panel (with the "Admin only"
  marker — also fixed the `custom`-control `SettingField` to render that badge), the external send + delivery
  (link + PIN, Copy / mailto / SMS / native share, PIN-included default + sensitive opt-out), the drain flow,
  and external delivery + revoke in Results. **Sensitive gates on the relay page** (18+ ack / DOB+consent →
  `ConsentReceipt`) + **revoke-on-deletion** (§3.9). Code-reviewer **fix-first**: **a blocker** — the PIN
  rate-limit had guarded only `unlock`, leaving `respond`/`withdraw` as **unthrottled brute-force oracles**;
  now all three share one `pinGate` so a wrong PIN on ANY endpoint counts toward the lockout (+ a cross-endpoint
  test); should-fixes applied (the IPC contract carries `privacy`; drain skips already-drained sends). Gate
  green: typecheck (node + web/DOM-lib), lint, format, **234 core + 308 desktop + 8 relay unit, 45 E2E**. Live
  web-preview visual QA (admin Relay connect → connected; external send → delivery; desktop + 390px; no console
  errors). Synced `08`/`00`/`03`. **Lesson: a rate-limit that lives on ONE endpoint is no rate-limit — every
  endpoint that checks the same secret (PIN) must share one gate that increments on each failure, or an
  unthrottled sibling endpoint (`respond`/`withdraw`) becomes a brute-force oracle for it.** **Deploy-time
  verification (the real Cloudflare provision/deploy + shipping `worker.js` into the iOS bundle) is the only
  remaining user-driven step.**

- 2026-06-11 — Build (Questionnaires **slice §13.5d — COMPATIBILITY mode; §13.5 COMPLETE — the
  Questionnaires feature is fully built** except the deferred §13.6 relay; [08-questionnaires](docs/specs/08-questionnaires.md)
  §3.6/§3.9/§4.1/§4.3/§4.4/§4.5/§6/§8.4/§13.5d). **The whole compatibility feature on ONE branch, merged
  once** (its pieces are tightly coupled — authoring → AI variants → dual-send → alignment — so shipping them
  separately would leave dead controls, §12). All product/UX decisions were **pre-made** (no re-asking).
  **Capability:** `questionnaires.readRaw` registered as an **`EXPLICIT_GRANT_ONLY`** capability — ships OFF
  even for the Owner (`roleAllows` special-cases it BEFORE the Owner's full-access bypass; the Roles matrix
  leaves the Owner column toggleable for exactly these). **Authoring:** a builder compatibility toggle +
  visibility picker (`sharedReport`/`eachSeesOwn`/`senderSeesAll`; the last selectable only with `readRaw`) +
  per-question `canonicalId` stamping. **Variants + dual-send:** core **`generateVariant`** (AI personalizes
  each answerer's variant — same answer type + `canonicalId`; target **shareable-facts-only** context, the
  §13.3 boundary) + **`createCompatibilitySend`** (two paired **Private** assignments sharing an additive
  **`Assignment.compatibilityGroupId`**, each freezing its own variant snapshot); blocked when AI is off.
  **Alignment:** **`alignmentService`** (both submitted → align by `canonicalId` → an **`AlignmentReport`** at
  `questionnaires/compat/<groupId>/report.enc` + a draft Insight, subject = sender, `approved:false`,
  deduped by `provenance.compatibilityGroupId`; budget-gated `questionnaire.analyze`); the sender's
  **`CompatibilityResults`** view + the answerer's **joint report on their answered Inbox item** (per
  visibility; `eachSeesOwn` also shows their own answers). **Break-glass + audit:** **`auditService`**
  (encrypted cross-device `config/raw-access-audit.enc`); IPC **`assignments:revealRaw`** (permits ONLY the
  super-admin (any send) **or** a `senderSeesAll` sender holding `readRaw`; **writes the audit entry BEFORE
  returning answers**) + **`audit:list`** (super-admin only) + a super-admin **`/audit`** viewer surface.
  **Honest disclosure:** **`disclosure.ts`** (`compatibilityDisclosure` per visibility, shared by send panel
  - Inbox) + the **`questionnaires.discloseAdminAccess`** admin-only setting (a new `adminOnly`
    `SettingDefinition` flag — filtered + marked "Admin only"; default OFF). Deletion tears down the compat
    report + group Insight. Code-reviewer **ship** (no blockers; applied the should-fixes: collapsed a double
    snapshot-decrypt in `revealRaw`, added the readRaw-sender-vs-non-`senderSeesAll`-group denial test, guarded
    a sender from being their own recipient; the reveal/`readRaw`/audit boundaries verified airtight). Gate
    green: typecheck (node + web/DOM-lib), lint, format, **213 core + 294 desktop unit, 44 E2E**. Live
    web-preview visual QA (compat authoring toggle + visibility picker [`senderSeesAll` gated "needs
    permission"] + derived disclosure + the admin-only setting with the "Admin only" marker; desktop + 390px;
    no console errors). Synced `08` + `capabilities`. **Lesson: an `EXPLICIT_GRANT_ONLY` capability must be
    special-cased in `roleAllows` BEFORE the Owner full-access bypass (else the Owner auto-grants the very thing
    meant to ship off), and a break-glass reveal must WRITE THE AUDIT ENTRY BEFORE returning the answers so a
    mid-reveal crash still leaves the trail.** **NEXT (the only remaining questionnaire work): §13.6 — the
    external Cloudflare relay.**
- 2026-06-11 — Build (Questionnaires **slice §13.5c — per-question trends + deletion/purge**,
  [08-questionnaires](docs/specs/08-questionnaires.md) §3.7/§3.9/§4.2/§6/§8.4/§13.5; design-system
  [01](docs/specs/01-design-system.md) §5.3/§5.6). **Scope decision (asked, twice):** the user chose "all
  three together" (trends + compatibility + deletion) **and** all 3 compatibility visibility modes (which
  pulls in the deferred break-glass `readRaw` + audit). After building the tractable two-thirds I **flagged
  the true size honestly + asked again** — the user chose to **ship trends + deletion now as §13.5c** and do
  **compatibility as a focused §13.5d**. **Privacy call (asked, with a clear warning):** trends **include
  Private sends' numeric values** — which contradicts the "they won't see your raw responses" promise; the
  user chose to **reconcile by updating the Private disclosure** (send panel + Inbox now say numeric ratings
  may appear in the sender's trends), so the app stays honest to recipients (§3.2). **Trends:** core
  **`buildQuestionTrends`** (rating-over-time across re-asks; rating/slider + matrix/allocation per
  row/bucket; one series per recipient; ≥2 points) + the **`assignments:trends`** IPC (sender-scoped, gated
  `viewResults`; numbers only, never prose); `QuestionTrend`/`TrendSeries`/`TrendPoint` view types; a
  **token-driven, theme-aware `LineChart`** primitive (+ `--color-chart-1..4` tokens) in `/gallery`; a Trends
  section in Results. **Deletion/purge (§3.9):** core **`purgeQuestionnaire`** (def + all sends + responses +
  derived Insights) + `deleteSend` + `hasSends`; a **main-stamped `Questionnaire.creatorPersonId`**
  (additive-optional, create-only, **never back-filled** onto a legacy def); **role-aware
  `questionnaires:delete`** (Owner/super-admin purge any stage; a non-owner creator deletes their own **only
  while unsent**) + a per-send **`assignments:delete`** (sender/admin-only); inline "Are you sure?" confirms
  in the builder + each Results send card. Live web-preview QA: the trend chart renders cleanly (2→4 line +
  legend), the delete confirms work, no console errors, no 390px overflow. Code-reviewer **ship** (2
  should-fixes applied: a forbidden delete surfaces a **calm inline error** instead of an unhandled throw;
  editing a legacy creator-less def **no longer transfers authorship** to the editor — which would have let a
  Member delete an Owner's def). Gate green: typecheck/lint/format, **243 desktop + 159 core unit, 38 E2E**
  (a coreBridge test proving Private numbers reach trends + per-send delete is sender/admin-only, deletion +
  trends core tests, a `LineChart` RTL test, and an E2E re-ask→chart→delete-send→purge with a 390px guard).
  Synced `08` + `01`. **Lesson: turning a silent no-op (the old `questionnaires:delete`) into a throw means
  every caller must handle the rejection — `void onRemove()` in the renderer would otherwise swallow it into
  an unhandled rejection with no user feedback. When a gate newly throws, audit its callers.** **Next:
  §13.5d** (compatibility: AI variants + dual-send + alignment report + Insight + the 3 visibility modes +
  the `readRaw` capability + audit), then **§13.6** (the external relay).
- 2026-06-11 — Build (Questionnaires **slice §13.5b — the sender's Results view + live Analyze + autoAnalyze**,
  [08-questionnaires](docs/specs/08-questionnaires.md) §3.7/§4.5/§6/§13.5). **This lights up the analysis loop**
  the §13.4 Memory surface was waiting on — a sender can now see a send's outcome and turn a response into a
  draft Insight. **Decisions (asked, all 4):** Results lives as an **Edit ⇄ Preview ⇄ Results** toggle in the
  questionnaire detail (only on a saved questionnaire + `questionnaires.viewResults`); **Standard = raw Q&A
  shown, Private = Analyze-only** (raw hidden; break-glass `readRaw` stays deferred); after Analyze, an inline
  **"Insight drafted — review it in Memory →"** confirmation (the Memory approve-step stays the one review
  place); **`autoAnalyze` default OFF**, and when ON it **auto-runs on opening Results** for new responses
  (spends the sender's AI allowance). Core **`formatAnswerForDisplay`** (read-only display per answer type incl.
  ranking/matrix/allocation) + derived **`SendResult`/`SendAnswer`** view types. IPC
  **`assignments:results(questionnaireId)`** — **sender-scoped + gated by `questionnaires.viewResults`**, with
  the **privacy boundary enforced in the bridge** (raw `answers` only for a Standard + submitted send; a Private
  send carries none — the reviewer verified airtight). Live **Analyze** reuses `insights:analyze` (the sender
  pays + reviews in Memory). New **`questionnaires.autoAnalyze`** setting (boolean, default OFF, `visibleWhen`
  AI on) + a **Questionnaires** settings section; the Results view auto-runs analysis one-at-a-time via a
  `useRef` guard that never retries a failed/over-budget attempt. Calm "Turn on AI in Settings" state when AI
  is off (no dead Analyze button). Code-reviewer verdict **ship** (nits applied: a Standard-but-unreadable
  response no longer mislabels as private; a store `loaded` flag removes a one-frame empty-state flash).
  Live web-preview visual QA of all three send states (Standard raw, Private locked, Sent waiting) + the calm
  Analyze degradation + the settings toggle, desktop + 390px, no console errors. Gate green:
  typecheck/lint/format, **236 desktop + 149 core unit, 37 E2E** (a coreBridge Results privacy/analyzed test,
  RTL for the Results states + the builder Results tab, an E2E send→answer→submit→Results raw round-trip with a
  390px guard). Synced `08` §3/§4.5/§6/§13.5. **Lesson: a derived "view" type at the IPC seam is how you keep a
  privacy promise — `SendResult` carries answers only for Standard sends, so a Private send's raw answers
  physically cannot reach the sender's renderer (the boundary is the bridge, not the UI).** **Next: §13.5c**
  (per-question trends + compatibility + deletion/purge), then **§13.6 relay** (external delivery).
- 2026-06-11 — Build (Questionnaires **slice §13.5a — the in-app send + answer core loop**,
  [08-questionnaires](docs/specs/08-questionnaires.md) §3.2/§3.3/§6/§13.5). **This finally lights up the loop:**
  a sender can send a questionnaire in-app and a recipient can answer it. **Decisions (asked):** scope =
  **the core loop** (send + Inbox + answer; Results/Analyze deferred to §13.5b, trends/compat/deletion to
  §13.5c); Inbox = a **separate `/inbox` nav** gated by **`questionnaires.answer`** (unanswered badge);
  Send = **from the builder** (a "Send" button beside Save → validate + save first, then a recipient +
  privacy panel that freezes the immutable snapshot); privacy default = **Private (break-glass)** — the
  recipient is told their answers personalize the sender's coaching and the raw responses stay hidden.
  Core **`@selfos/core/questionnaires/answerService`** (`openAssignment`/`saveProgress`/`submitResponse`/
  `declineAssignment` + an `isAnswerable` guard — locked after submit); `listAssignments` gains a
  **`recipientPersonId`** filter (the Inbox side); **`ResponseSet.submittedAt` → optional** (a saved-but-
  unsubmitted draft persists; status is the lifecycle marker) and **`Answer.value` widened to
  `Record<string,number>`** (matrix/allocation answers now persist) — both additive, **no migration**.
  New **derived** `InboxItem`/`InboxAssignmentDetail` view types — the **raw answers never cross IPC to the
  sender** (privacy honesty). IPC `assignments:inbox/get/open/saveProgress/submit/decline` gated by
  `questionnaires.answer` **AND recipient-scoped in the bridge** (the trust boundary — a non-recipient can't
  read or mutate another person's send; super-admin inspect still can't answer-as-someone-else because it
  doesn't change `activePersonId`). Renderer: a builder **Send panel** + a separate **Inbox** master-detail
  reusing `QuestionnaireForm` (save/resume, decline silent/with-note, submit; crisis footer on every state);
  per-person **`inboxStore`** resets on `activePerson.id` change (the per-person-state rule); the nav badge
  carries `flex: none` (the Switch-shrink rule — the reviewer's preview caught it compressed). Code-reviewed
  **fix-first** (should-fix: **`analyzeAssignment` now guards on `submittedAt`** so a draft can't be analyzed
  or burn budget — drafts are newly reachable as `ResponseSet`s; + crisis footer on locked/declining/missing).
  Gate green (typecheck/lint/format, **227 desktop + 147 core unit, 36 E2E** — incl. a coreBridge inbox-flow/
  recipient-gating test, RTL Inbox + builder-send tests, and an E2E send→answer→submit encrypted round-trip;
  the 390px sweep now walks the Inbox). Synced `08` §3/§4.3/§6/§13.5. **Lesson: relaxing a "required" schema
  field (`submittedAt`) makes a previously-unreachable state (a draft `ResponseSet`) reachable — re-check
  every consumer that assumed the old invariant (here, `analyzeAssignment`).** **Next: §13.5b** (Results +
  the live Analyze trigger + `autoAnalyze` — lights up Memory), then §13.5c, then §13.6 relay.
- 2026-06-11 — Build (Questionnaires **slice 4 — analyze → Insights → Memory** [§13.4 engine + surface],
  [08-questionnaires](docs/specs/08-questionnaires.md) §3.7/§4.4/§6/§8.2/§13.4). **Surfaced a real
  dependency + asked:** §13.4 analyzes a recipient's submitted answers, but the Inbox that collects them is
  §13.5 — so there's no live response source yet. Decisions: **build §13.4 now** (engine + surface,
  seeded-tested, live trigger with §13.5); a **top-level "Memory" nav**; an **inline review panel** for the
  approve-step; crisis flags **lead with concern + resources**. Built: core **`analysisService`**
  (`analyzeAssignment` → an Insight saved **`approved:false`**, `subjectPersonId` = the **sender**;
  budget-gated + metered `questionnaire.analyze`; model **crisisFlag**; **idempotent** — dedup by
  `provenance.assignmentId`); `insightStore` **`listAllInsights`** (+ `updateInsight` for approve);
  IPC `insights:list/analyze/approve/update/delete` gated by **`questionnaires.viewResults`** (analyze via
  a capability-parametrized `aiDeps`). The **Memory** surface lists every Insight, drafts open in an inline
  review (edit summary, choose **shareable** facts, Approve/Discard), crisis-flagged lead with 988 +
  resources + the crisis footer. **Privacy (reviewer-verified airtight):** the surface/IPC only carry the
  **derived Insight**, never the raw answers; unapproved Insights don't feed `buildContext`. Code-reviewer
  **fix-first** (3 applied): the Approve card now **collapses** to the read view (a `useEffect` syncs
  `editing` to `approved` — `useState` doesn't re-run on `key` reuse); approve/update/remove failures
  surface a **calm inline error** (no swallow); analysis **dedups**. Gate green: typecheck/lint/format,
  **219 desktop** + **140 core** unit, **35 E2E** (Memory empty-state + the 390px sweep now walks Memory).
  Visual QA of the empty Memory surface (the insight-card/approve form is RTL-covered — no live insight in
  the preview, since none exist until §13.5). **DELIBERATELY DEFERRED (no dead code, §12):** the
  **`autoAnalyze`** setting + the live `Analyze` trigger → **§13.5** (where responses arrive), and
  **`queryMetrics`** → **§11** (its consumer) — flagged rather than ship a dead toggle. **NEXT: §13.5
  send/collect + Inbox** (reuses `QuestionnaireForm`; produces the responses that finally light up
  Analyze/Memory), then **§13.6 relay.** Synced `08` §6/§13.4 + changelog.
- 2026-06-11 — Build (Questionnaires **slice 3 — AI generate + gap-finder** [the FULL §13.3],
  [08-questionnaires](docs/specs/08-questionnaires.md) §3.1/§3.7/§5.1/§6/§8.1/§13.3). Asked first (4 Qs):
  scope = **everything** (registry + generate + per-question assists + the gap-finder surface); generate
  context = **configurable sources** (the user's words — pick one or more of **own data / a target person /
  the relationship between them**); generated questions = **append as editable** (AI-marked); safety =
  **prompt-embedded + schema-validate** (no separate judge). Built: the **context-provider registry**
  (`registerContextProvider` + built-in profiles/relationships/insights — the extensibility backbone `09`
  will extend) + `gatherGenerationContext`; **generationService** (`generateQuestions` brief+context → JSON
  → Zod-validate → mint ids → de-dup; `improveQuestion`) + **gapFinderService** (`suggestQuestionnaires`,
  structured context only — **never raw transcripts**), each mirroring `chatService`'s **budget→call→record**
  (gated by `questionnaires.create`, metered `questionnaire.generate`/`.suggest`; refusals degrade to a calm
  `REFUSED`, still charged). **Privacy boundary (airtight, reviewer-verified):** a **target person's data is
  shareable-facts-only** — their private notes never reach Claude (the §04/§8.4 split, like `buildContext`);
  the author's own private data does feed. The API key stays in main. IPC `questionnaires:generate`/
  `:improveQuestion`/`gapfinder:suggest`. Renderer: a builder **"Draft with AI"** panel (brief + target
  picker + context toggles), per-question **reword** assists, the **"Suggested"** surface; AI-off /
  over-budget show calm states. Code-reviewer **fix-first** (all 4 should-fixes applied): a denial now
  returns a distinct **`DENIED`** (not `NO_KEY`); the per-question reword is **gated on AI-ready + debounced**
  (no double-charge); a test asserts **usage is recorded even on REFUSED**; a **390px guard** exercises the
  AI panel + Suggested. Gate green: typecheck/lint/format, **215 desktop** + **133 core** unit, **34 E2E**.
  Visual QA of the calm states (the AI-ready UI is RTL-covered — the web preview couldn't reach `aiReady`
  without a real key). **Lesson: at 390px the nav is a hidden drawer — E2E that navigates must do so at
  desktop width (or open the hamburger first), then resize only to measure layout.** **Deferred:** the
  analyze→Insight pipeline + `autoAnalyze` (§13.4). **NEXT: §13.4 analyze→Insights/metrics, then §13.5
  send/Inbox, §13.6 relay.** Synced `08` §3.1/§5.1/§6/§13.3 + changelog.
- 2026-06-11 — Build (**Dreams slice 5b — the sharing UI; §13.5 COMPLETE — the Dreams feature is fully
  built**; [12-dreams](docs/specs/12-dreams.md) §3.4/§8.3/§13.5). A **`DreamShareControls`** section on the
  approved analysis card: a **related-person picker** + a `Switch` **per insight fact** (on = shared with
  the selected person) + a **"Shared with X" line** per fact. It renders only when `analysis.insightId &&
can('dreams.shareContext') && sensitivity === 'standard'` and the dreamer has related people — but the
  **bridge re-enforces the capability + sensitivity + target-is-related + fact-exists server-side, so the
  UI gate is convenience, not the trust boundary**. A **sensitive-tier dream shows a one-line "kept out of
  shared context" note** instead. `dreamAnalysisStore` gained `insight`/`shareTargets` +
  `loadSharing`/`setFactShare` (loaded after approve / re-approve-on-edit / open-when-approved; cleared on
  remove + reset). **Fixed a real footgun the reviewer caught (should-fix → applied):** editing an approved
  analysis used to **silently wipe all per-person sharing** (`approveAnalysis` rebuilt facts with fresh
  `uuid()`s) — facts now use a **stable per-field id** (`<insightId>:waking`/`:emotional`) and **carry
  `shareableWith` forward** on re-approval, so re-wording a section **keeps** its shares with the updated
  text (re-_synthesizing_ a wholly new analysis still resets sharing, correctly). Applied the two nits
  (surface an `error` if a share toggle is refused; reconcile a stale selected person so the controls never
  point at a removed relation). Gate green: typecheck (node + web/DOM-lib), lint, format, **164 core + 249
  desktop** unit (+1 core carry-forward, +6 RTL: component toggles/already-shared/empty + pane integration /
  sensitive note / capability-hide), **36 E2E** (+1 full capture→analyze→approve→**share** flow that
  decrypts the vault to assert the shared fact reaches the related person's `summarizeForContext` grounding
  - a 390px guard). **Visual QA** at desktop (the share section — picker + per-fact toggles + the "Shared
    with Partner" chip — renders cleanly, no overflow). On `feat/dreams-slice-5b` (in the Dreams worktree).
    **Lesson: any derived record (a distilled Insight's facts) that the user can attach state to (sharing
    toggles) must carry that state across regeneration via STABLE ids — rebuilding with fresh uuids silently
    drops the user's choices.** **The Dreams feature (spec 12, §13.1–§13.5) is now FULLY BUILT** — capture →
    guided analysis → patterns → per-dream sharing. Only the deferred AI dream-image-generation companion
    spec remains. (Concurrent questionnaire session's main-tree work untouched.)
- 2026-06-11 — Build (**Dreams slice 5a — per-dream sharing backend + IPC seam**;
  [12-dreams](docs/specs/12-dreams.md) §3.4/§8.3/§8.4/§6/§13.5). The **per-person** dream-insight sharing
  mechanism. **Asked first (2 forks, both confirmed):** the shareable unit = the **distilled insight facts**
  (the emotional-landscape + waking-life-connection facts approval produces); the control = **pick a related
  person, tick which facts**. Added an **additive-optional `InsightFact.shareableWith: string[]`** (the
  person ids a fact is targeted at, alongside the broadcast `shareable` boolean — **no migration**, existing
  questionnaire/session facts unaffected); **`summarizeForContext`** now surfaces a related person's fact
  when `shareable` **OR** `shareableWith.includes(thatPerson)` (the boolean broadcast path unchanged). New
  **`dreamInsightService`** (`@selfos/core/dreams`): `listDreamShareTargets` (the dreamer's relationship-
  graph relations — via a new exported **`listRelatedPeople`**), `getDreamInsight` (the dream's approved
  Insight + its facts/sharing), **`setDreamFactShare`** (toggles a person in a fact's `shareableWith`;
  **refuses sensitive-tier dreams** [`SENSITIVE`] + a **non-related/unknown target** [`NOT_FOUND`]; drops the
  prop when empty). IPC seam: `dreams:shareTargets` + `:getInsight` gated by **`dreams.own`**;
  `dreams:setFactShare` gated by the privileged **`dreams.shareContext`** (a Member has both by default; a
  Guest neither). New crypto-free view types `DreamShareTarget`/`DreamShareResult`. Code-reviewer verdict
  **ship** — the **privacy boundary verified airtight on every path** (a targeted fact reaches ONLY its
  target, never other related or unrelated people; the **relationship graph re-gates at read time** so
  deleting a relationship drops the share — no stale `shareableWith` leak; sensitive tiers excluded;
  others'-private + the boolean paths unchanged). Applied the two nits (a dedup-divergence doc note on
  `listRelatedPeople` vs `buildContext`'s inline traversal; a broadcast-path regression test). Gate green:
  typecheck (node + web/DOM-lib), lint, format, **162 core + 243 desktop** unit (+7 core sharing/targeting,
  +1 bridge round-trip/gating). On `feat/dreams-slice-5a` (in the Dreams worktree). **Lesson: per-person
  sharing rides on an additive `InsightFact.shareableWith` checked in `summarizeForContext` (`shareable ||
shareableWith.includes(reader)`) — and the relationship graph re-gates at READ time, so a shared fact
  auto-revokes when the relationship is removed; no separate revocation needed.** **No user-facing surface,
  so no E2E/visual-QA** — the share UI on the approved, non-sensitive analysis card (a related-person picker
  - per-fact ticks + "shared with X" chips) lands in **5b**. (Concurrent questionnaire session's main-tree
    work untouched.)
- 2026-06-11 — Build (**Dreams slice 4b — the Patterns UI; §13.4 COMPLETE**;
  [12-dreams](docs/specs/12-dreams.md) §3.5/§5.3/§8.2/§9/§13.4). The **`/dreams/patterns`** screen + three
  **new `/gallery` chart primitives**. Built bespoke SVG/bars on tokens (**no chart library** — matching
  the hand-rolled usage ring) with the **count/figure always rendered as text** (not colour-only, §9):
  **`FrequencyBars`** (recurring symbols/themes/people/emotions), **`ProportionBar`** (lucid/nightmare
  rates), **`TrendLine`** (mood/vividness over time, a direction-aware `role="img"` label) — all exported
  from the design-system + **showcased in `/gallery`** (DoD). **`DreamPatterns`** composes the four §3.5
  visualizations into cards + a **30d / 90d / All-time** `SegmentedControl` + the **gentle recurring-
  nightmare nudge** Banner (when `nightmareNudge`) + the **on-demand** AI narrative card (Generate →
  Approve/Remove + the "in your coaching context" badge; disabled+hinted when `dreams.memoryEnabled` is off;
  a calm connect-Claude state when AI is off — **the deterministic charts still render offline**) + the
  not-medical line + the reused `CrisisFooter`. Reached via a **"Patterns" button in the Dreams header**.
  A per-person **`dreamPatternStore`** (reset wired into AppShell's active-person effect). The §8.2 nudge
  **also surfaces in the dream detail** — a gentle `distressSignal` banner on the synthesis card. All four
  product/UX forks were **asked + user-confirmed** (nudge = 3-in-14-days; the window toggle; on-demand
  generation; the header-button entry). Code-reviewer **fix-first** (should-fix: a `load()` late-resolve
  **window guard** so a fast toggle can't show stale stats; nits: the `!`→guarded-access §4 fix, a
  direction-aware TrendLine label, `title` on truncated bars). Gate green: typecheck (node + web/DOM-lib),
  lint, format, **156 core + 242 desktop** unit (+4 chart RTL, +7 Patterns RTL), **35 E2E** (+1: seeds 3
  nightmares + an analyzed dream → the charts render, the nudge fires, generate+approve the narrative, a
  390px overflow guard). **Visual QA** at desktop + 390px via real Electron screenshots (charts legible,
  the grid stacks). On `feat/dreams-slice-4b` (in the Dreams worktree). **Lesson: build in-app charts as
  bespoke token-driven SVG/bars (the usage-ring precedent) — no chart-lib dependency — and give every chart
  a TEXT equivalent (the count/figure as text + a direction-aware aria-label), since §9 forbids colour-only
  data.** **Slice 4 (Patterns) is COMPLETE; NEXT: §13.5 per-dream sharing** (per-fact shareable promotion
  into a related person's context, gated by `dreams.shareContext`, excluded for sensitive tiers).
  (Concurrent questionnaire session's main-tree work untouched.)
- 2026-06-11 — Build (**Dreams slice 4a — patterns backend + IPC seam**;
  [12-dreams](docs/specs/12-dreams.md) §3.5/§4.4/§8.2/§6/§13.4). **Asked first (4 product/UX forks, all
  recommendations confirmed):** recurring-nightmare nudge threshold = **3 nightmares in 14 days** (the
  deterministic backstop; the AI distress signal fires independently); patterns window = a **30d / 90d /
  All-time toggle**; the AI narrative = **on-demand "Generate"** (cached + regenerable, never auto-spends
  budget); Patterns entry = a **"Patterns" button in the Dreams header** → `/dreams/patterns`. Built the
  backend: `@selfos/core/dreams` **`dreamPatternService`** — **`computePatternStats`** (a PURE aggregation
  over `{dream, analysis}[]` → recurring symbols/themes/people/emotions counts, lucid+nightmare counts,
  mood & vividness trend series) + the **`nightmareNudge`** (3-in-14-days OR an AI `distressSignal`,
  computed over the FULL set on a **fixed 14-day window** so a longer view window never dilutes the safety
  signal); `getPatternStats`; **`generatePatternNarrative`** (the budget-gated `dream.patterns` pass over a
  bounded recent-dreams digest → cached as `DreamPatternSummary` at `people/<id>/dreams/patterns.enc`;
  meters before caching; re-gen drops the prior approved Insight); `approvePatternNarrative` (→ a
  **cross-dream `Insight`** `source:'dream'` with **no `dreamId`**, gated by injected `memoryEnabled`);
  `removePatternNarrativeFromContext`. New **crypto-free** view types (`DreamPatternWindow`
  `'30d'|'90d'|'all'`, `DreamPatternStats`, `DreamNarrativeResult`) in `@selfos/core/schemas`;
  `dream.patterns` usage type. IPC seam (gated **`dreams.own`**, dreamer-scoped):
  `dreams:patternStats`/`:getPatternSummary`/`:patternNarrative`/`:approvePatternNarrative`/
  `:removePatternNarrative` (a denied `patternStats` read returns **zeroed stats**, never throws). The API
  key stays host-side. Code-reviewer verdict **ship** (no blockers/should-fixes — nudge decoupling,
  no-`dreamId` Insight, re-gen+remove dropping the Insight, metering-before-cache, and key-host-side all
  verified; applied the one nit so the cached `windowFrom/To` match the digest Claude actually saw). Gate
  green: typecheck (node + web/DOM-lib), lint, format, **156 core + 231 desktop** unit (+11 core
  `dreamPatternService` incl. the windowing + nudge paths, +1 bridge patterns round-trip/gating). On
  `feat/dreams-slice-4a` (in the Dreams worktree). **No user-facing surface, so no E2E/visual-QA** — the
  four `/gallery` chart primitives + the `/dreams/patterns` screen (window toggle, on-demand narrative +
  approve, the nightmare nudge) land in **4b**. (Concurrent questionnaire session's main-tree work
  untouched.)
- 2026-06-11 — Build (**Dreams slice 3c — the guided-analysis UI; §13.3 COMPLETE**;
  [12-dreams](docs/specs/12-dreams.md) §3.2/§3.3/§13.3). The in-pane **Dream ⇄ Analysis** surface.
  **Asked first (3 UX forks, all recommendations confirmed):** presentation = **in-pane mode switch**
  (modal-free, mirroring the questionnaire Edit⇄Preview toggle); post-synthesis = **lead with the card**
  (chat tucks behind a "Continue the conversation" disclosure); editing = **read-first + Edit toggle**.
  A status-aware **Analyze / Resume analysis / View analysis** entry on a saved dream opens
  **`DreamAnalysisPane`** — a guided reflective chat (reuses the Sessions **`Composer` + `CrisisFooter`**
  over a new per-person **`dreamAnalysisStore`** subscribing to `onDreamChunk`) → **"Create analysis"**
  synthesis → the **`DreamSynthesisCard`** (5 read-first sections; Edit → **`DreamAnalysisEditor`** → Save
  via `dreamUpdateAnalysis`). The store **re-approves an already-approved analysis on edit** so the
  coaching context stays in sync (approve is a cheap, **unmetered** local distillation). **Approve** → the
  "in your coaching context" badge + **Remove from context**; Approve is **disabled + hinted when
  `dreams.memoryEnabled` is off**. **Safety:** a `crisisFlag` makes the card **lead with resources**; the
  not-medical line + crisis footer are on every analysis state; symbolic readings stay framed as
  imaginative reflection; AI-off shows a calm connect state, but an **existing** analysis stays
  viewable/editable/approvable offline (only the chat + synthesis need AI). `dreamAnalysisStore.reset()`
  wired into AppShell's active-person effect (per the per-person rule). Both offline fake Claude clients
  (Electron + web preview) now emit a valid synthesis JSON for the "JSON object" turn. Code-reviewer
  **fix-first** (both should-fixes applied: closed a **mobile back-button dead-end** if the selected dream
  vanishes mid-analysis — the list-back now hides only while the pane actually renders; added the missing
  **re-approve-on-edit** test; + an `aria-controls` a11y nit). Gate green: typecheck (node + web/DOM-lib),
  lint, format, **145 core + 230 desktop** unit (+9 RTL: entry label, calm AI-off, guided turn, synthesize,
  edit, approve+badge, remove, memory-off, re-approve-on-edit), **34 E2E** (+1 full
  capture→analyze→synthesize→edit→approve flow that decrypts the vault to assert the dream Insight feeds
  `summarizeForContext` **grounding** + the transcript is **absent from the Sessions list** + a 390px
  no-overflow guard on the analysis surface). **Visual QA** at desktop + 390px via real Electron
  screenshots (the card, entry bar, actions, and crisis footer all clean + intentional). On
  `feat/dreams-slice-3c` (in the Dreams worktree). **Lesson: the shared web-preview MCP server is rooted
  at the MAIN tree, so it serves the OTHER worktree's build — for worktree visual QA, capture screenshots
  inside the Playwright run (`w.screenshot`) from the worktree's own build instead.** **Slice 3 (guided
  analysis) is COMPLETE; NEXT: §13.4 Patterns** (deterministic stats + four `/gallery` chart primitives +
  the `dream.patterns` narrative + the recurring-nightmare nudge). (Concurrent questionnaire session's
  main-tree work untouched.)
- 2026-06-11 — Build (**Dreams slice 3b — the analysis IPC seam**;
  [12-dreams](docs/specs/12-dreams.md) §6/§13.3). Wired the slice-3a guided-analysis ops through the typed
  seam (`channels` → `coreBridge` → `ipc` → preload → `test-utils/bridge`), all **gated by `dreams.own`** +
  scoped to the active dreamer (the **bridge is the trust boundary** — inputs Zod-validated; the API key is
  read host-side and **never crosses to the renderer**): `dreams:analyzeTurn` (streams on a **new
  `dreams:chunk` event** via a dedicated `emitDreamChunk`/`onDreamChunk` sink — **separate from the Sessions
  `chat:chunk` stream** so the two never cross; `ipc.ts` binds `event.sender` per turn and resets in
  `finally`, exactly like `chatStream`), `dreams:getAnalysis`/`:getConversation` (resume the chat),
  `dreams:synthesize`, `dreams:updateAnalysis` (save section edits → `edited:true`), `dreams:approve` (the
  host reads `dreams.memoryEnabled` from vault settings — **default ON unless explicitly `false`** — and
  passes it to `approveAnalysis`), `dreams:removeFromContext`. Added a new core **`updateAnalysis`** that
  overwrites only the supplied readable sections (conditional spreads under `exactOptionalPropertyTypes`),
  preserving the AI-owned tags/metrics/flags + `insightId` so re-approval refreshes the **same** Insight.
  The two result view types (`DreamSynthesisResult`/`DreamApproveResult`) + the `DreamAnalysisEdits` input
  schema live in the **crypto-free `@selfos/core/schemas`** (the `ChatTurnResult` precedent), so
  `channels.ts` imports them without dragging crypto into the renderer/web tsconfig; the iOS/web `webHost`
  gained the parallel `emitDreamChunk`/`onDreamChunk`. Code-reviewer verdict **ship** (no blockers/
  should-fixes; dreamer-scoping, key-host-side, sender-reset parity, and the `memoryEnabled` default all
  verified). Gate green: typecheck (node + web/DOM-lib), lint, format, **145 core + 221 desktop** unit (+2
  core `updateAnalysis`, +3 bridge: a full analyze→synthesize→edit→approve→remove round-trip, the
  memory-off refusal, and a capability denial). On `feat/dreams-slice-3b` (in the Dreams worktree).
  **No new user-facing surface**, so no E2E/visual-QA this slice — the guided-analysis chat + synthesis
  card + approve UI + the E2E land in **3c**. (The concurrent questionnaire session's `08`/main-tree work
  left untouched; my commit is the 10 seam/test/doc files only.)
- 2026-06-11 — Build (**Dreams slice 3a — core guided-analysis backend**;
  [12-dreams](docs/specs/12-dreams.md) §13.3). The first AI-bearing Dreams code (no IPC/UI yet). New
  **`@selfos/core/dreams` `dreamAnalysisService`**: `runAnalysisTurn` (a **dream-scoped** reflective
  chat — reuses the `05` chat / `06` budget+stream+metering pattern but stores the transcript **under the
  dream** at `dreams/<id>/conversation.enc`, so the Sessions surface never lists it; metered
  **`dream.analyze`**); `synthesizeAnalysis` (one `client.stream` w/ a no-op `onDelta` to get token usage
  → fence-stripping `extractJson` + a Zod-validated **`DreamAnalysisDraftSchema`** → a `DreamAnalysis`;
  marks the dream `analyzed`; **records usage BEFORE parsing** so a paid call whose JSON fails validation
  is still metered; re-synth drops the prior analysis's stale Insight); `approveAnalysis` (→ `Insight`
  `source:'dream'`, `provenance.dreamId`; gated by an **injected `memoryEnabled`** — host reads
  `dreams.memoryEnabled` in 3b; refuses when off); `removeFromContext`; and **`purgeDream`** (delete the
  dream **and** its linked Insight). The blended-**honest** voice lives in `DREAM_ANALYSIS_GUIDANCE` + the
  synthesis contract, reusing `PERSONA`/`SAFETY` (symbolic readings framed as reflection-not-fact;
  `crisisFlag`/`distressSignal`, §8.1/§8.2). Registered the `dream.analyze` usage type; added
  dream-conversation persistence to `dreamService`. Code-reviewer verdict **fix-first** — both
  should-fixes resolved: (#1) the slice-2 bridge delete path orphaned an approved dream Insight (it lives
  OUTSIDE the dream folder, under `people/<id>/insights/`) → now routed through **`purgeDream`**; (#2) a
  paid synthesis call that failed JSON/Zod validation wasn't metered → **`recordUsage` moved ahead of the
  parse**. Nits applied (reuse `DreamTagsSchema`, request `metrics` in the prompt, fence-strip the
  extractor). Gate green: typecheck/lint/format, **143 core + 218 desktop** unit (10 new analysis-service
  tests: transcript-not-in-Sessions, approve→Insight-feeds-context, memory-off refusal, re-synth-drops-
  stale, purge-removes-insight, meter-on-parse-failure, …). On `feat/dreams-slice-3`. **Lesson: when a
  feature stores derived data OUTSIDE the entity's own folder (an `Insight` under `people/<id>/insights/`,
  not under the dream), the entity's delete path must explicitly clean it up — a folder purge alone
  orphans it, and an approved source-discriminated Insight keeps feeding `buildContext` forever.** Next:
  **3b** (IPC seam) → **3c** (guided-chat + synthesis card + approve UI + E2E).
- 2026-06-11 — Build (**Dreams slice 2 — capture + journal UI + nav + settings**;
  [12-dreams](docs/specs/12-dreams.md) §13.2). The first Dreams **renderer** surface (no AI yet — pure
  journaling works offline). IPC seam `dreams:list/get/save/delete` through the typed seam
  (`channels` → `coreBridge` → `ipc` → preload), **gated by `dreams.own`** + **scoped to the active
  dreamer** (mirrors conversations); main owns id/`schemaVersion`/`personId`/`status`/timestamps and
  merges over an existing dream on edit (preserves `createdAt`/analysis link). New `DreamInputSchema`
  (renderer-supplied; booleans/collections default so a narrative-only dump is valid). Renderer: a
  `dreamStore` with a per-person **`reset()`** wired into AppShell's active-person reset+reload effect
  (the per-person-isolation rule — dreams must not leak across a switch); a **Dreams** master–detail
  journal; a narrative-first **`DreamComposer`** (lucid/nightmare `Switch` toggles + optional
  mood/vividness/sleep/date + tags/people via a reusable **`ChipEditor`** + sensitivity; Save gated on a
  non-empty narrative; delete behind a confirm); the `/dreams` nav entry (moon icon, `dreams.own`-gated)
  - route; and the **`dreams.memoryEnabled`** vault setting in a new Dreams settings section.
    **People-graph linking of "people present" deferred** (free-name chips for now); the **Analyze** entry
    point + all AI land in slice 3 (no scaffolding here, §12). Tests: +1 coreBridge dreams test
    (CRUD + per-dreamer scoping + Guest-denied), 5 Dreams RTL (empty/list/capture-payload/save-gating/
    delete-confirm), +1 E2E (capture → encrypted round-trip → reopen + overflow guard) + Dreams added to
    the **390px sweep**. Visual QA done from the live app at desktop + 390px (master–detail; the
    optional-details grid stacks on phones). Gate green: typecheck/lint/format, **133 core + 217 desktop**
    unit, E2E. Built on **`feat/dreams-slice-2`** (stacked on slice 1) in the isolated worktree — the
    concurrent questionnaires session (`feat/questionnaire-ai-generate`, §13.3) untouched. **NOTE: the
    shared seam files (`channels`/`coreBridge`/`ipc`/preload) + `CLAUDE.md` will conflict-merge with that
    session's work — both append; trivial to resolve.** Next: **slice 3** (guided analysis → approve →
    context).
- 2026-06-11 — Spec + Build (**Dreams** — new spec [12-dreams](docs/specs/12-dreams.md) drafted, approved,
  and **slice 1 built**; §13.1). Dreams = guided AI dream journaling + analysis + cross-dream patterns; the
  **third producer** into `08`'s shared Insight/metrics layer (a dream's **approved** analysis becomes an
  `Insight` `source:'dream'` feeding `buildContext` — no new context plumbing). Spec written ask-first (16
  decisions / 4 rounds + a 5-Q review): blended **honest** voice (evidence + symbolic, framed as reflection
  not fact), **guide→synthesize** chat (reuses `05`, stored **under the dream**, kept OUT of the Sessions
  list), structured 5-section analysis, **approve-gate** before context, per-dream sharing (off by default),
  per-dream `SensitivityTier`, dreamer-only + super-admin break-glass (**no audit log v1**), **full
  cross-dream patterns in v1** (hybrid stats + view-only AI narrative w/ opt-in add-to-context),
  recurring-nightmare nudge (**count OR AI distress signal**). **Image generation deferred to a future
  companion spec** (2nd provider/OpenAI, consent, **binary-blob vault storage**, per-image cost) — no
  scaffolding here. UX reviewed via interactive mockups of the 4 surfaces before approval. **Slice 1
  (backend/core):** the `Dream`/`DreamPersonRef`/`DreamStatus`/`DreamTags`/`DreamAnalysis`/
  `DreamPatternSummary` schemas; the **additive** `Insight` `source:'dream'` + `provenance.dreamId`
  amendment (**no migration** — additive-optional, `schemaVersion` stays 1; synced into `08`);
  `dreams.own`/`dreams.shareContext` capabilities (Member default; **no view-others'-dreams** capability);
  and **`@selfos/core/dreams`** `dreamService` (encrypted per-dream-folder CRUD over Dream+DreamAnalysis;
  **delete purges the folder**; listing skips non-dream sidecars like `patterns.enc` + enforces dreamer
  scoping, mirroring `insightStore`). Code-reviewed (verdict **ship**; fixed: `DreamPersonRef` now forbids
  an empty `{}` ref; added a populated round-trip + a Zod-bounds-rejection test). Gate green:
  typecheck/lint/format, **133 core + 211 desktop** unit (no E2E — backend-only, no new surface).
  **Process:** the approved spec committed (`99e3264`) but **landed on `main`** because a concurrent
  questionnaires session switched the shared HEAD mid-session (moving it onto a branch is deferred per the
  user); slice 1 was then built in an **isolated git worktree** (`feat/dreams-slice-1` off the spec commit)
  so the live questionnaires session (`feat/questionnaire-ai-generate`, doing §13.3) was untouched.
  **Lesson: with a concurrent agent in a SHARED working tree, switching branches moves the one shared HEAD
  — use a separate `git worktree` for feature work to avoid disrupting the other session, and re-check
  `git branch --show-current` immediately before any commit.** **Next §13 slices:** capture + journal UI +
  settings + nav (2) → guided analysis (3) → patterns (4) → per-dream sharing (5).
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
