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
- [ ] E2E tests for **every** new user-facing surface/section, not just the happy path (Playwright);
      include a no-horizontal-overflow / layout guard for content-heavy screens, and a geometry guard
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
      mobile-width layout guard (see §12)
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
