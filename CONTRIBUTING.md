# Contributing to SelfOS

Thanks for your interest in SelfOS — a calm, private **AI therapist &amp; life coach** desktop app
(**wellness / self-help, not medical**). This guide covers how SelfOS is built, how to run it, and how
work lands. The product itself is introduced on the **[website](https://highfivery.github.io/SelfOS/)**
and in the [README](README.md).

> [!IMPORTANT]
> SelfOS is a wellness and self-help tool. It is **not** a medical device and **not** a substitute for
> professional care. Any feature touching a user's wellbeing must keep that boundary visible and route
> crisis situations to professional resources. If you are in crisis, contact local emergency services
> or a crisis line.

## How we build

SelfOS is **local-first and privacy-first by architecture**, and built deliberately:

- **Spec-driven.** No feature code without an approved spec in [`docs/specs/`](docs/specs). The spec is
  written and reviewed first; code follows it. If implementation reveals the spec is wrong, the spec is
  updated in the same change.
- **Slice by slice.** We move one well-tested slice at a time, perfecting it before the next.
- **Schema-first, typed end to end.** [Zod](https://zod.dev) schemas are the single source of truth;
  TypeScript types are inferred from them and validated at every boundary (files, IPC, AI responses).
- **Privacy is non-negotiable.** All user content is treated as highly sensitive. It never leaves the
  device except in explicit, consented Claude API calls. The API key lives only in the Electron **main**
  process and is never logged, committed, or exposed to the renderer.

The authoritative "how we work" rules live in [`CLAUDE.md`](CLAUDE.md); the cross-cutting technical
foundation is [`docs/specs/00-architecture.md`](docs/specs/00-architecture.md).

## Tech stack

| Area            | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Platform        | Electron + React + TypeScript (strict)                       |
| AI              | Claude API (key lives in the Electron main process only)     |
| Data            | Plain-file **vault** (Markdown + JSON), encrypted at rest    |
| Vault location  | A folder the user chooses (local / iCloud / Dropbox / Drive) |
| Build / package | electron-vite (dev/build) + electron-builder (distribution)  |
| Styling         | CSS custom properties (design tokens) + CSS Modules          |
| State           | Zustand · Validation: Zod · Routing: React Router            |
| Testing         | Vitest + React Testing Library (unit) · Playwright (E2E)     |
| Mobile          | Capacitor (iOS), sharing the same vault over iCloud Drive    |
| Tooling         | pnpm monorepo · ESLint + Prettier · Conventional Commits     |

## Architecture in brief

Three processes with hard boundaries (full detail in
[`00-architecture.md`](docs/specs/00-architecture.md)):

- **main** (Node) — window lifecycle, the vault service (the _only_ code that touches `fs`), the Claude
  proxy, the OS keychain, and IPC handlers. Secrets and network access stay here.
- **preload** — a tiny, typed `contextBridge` exposing a minimal API to the renderer. No Node leakage.
- **renderer** (sandboxed React) — the UI. No `fs`, no secrets; it talks only through the typed IPC seam.

Everything is a **feature module** that registers what it contributes (nav, routes, settings, vault
schemas), so the app shell knows nothing about specific features — adding a feature is adding a module,
not editing the shell.

## Repository layout

```
apps/desktop      Electron app (main / preload / React renderer) + the iOS Capacitor shell
apps/relay        Per-household zero-knowledge Cloudflare Worker + its static answering page
packages/core     Platform-agnostic domain logic (crypto, vault I/O, people, conversations, usage…)
packages/answering  The shared questionnaire-answering renderer (used by the app + the relay page)
docs/specs        Feature-set specifications — the source of truth for what we build
site              The marketing landing page (deployed to GitHub Pages)
.claude           Claude Code rules, skills, and sub-agents
```

## Getting started

**Prerequisites:** **Node ≥ 20** (`.nvmrc` pins **24** — run `nvm use`) and **pnpm** (via Corepack or
the `packageManager` field). The git hooks fail fast with a clear message if your active Node is too old;
if a commit/push errors with a `pnpm requires … Node` message, run `nvm use` and retry.

```sh
pnpm install        # install dependencies and set up git hooks (husky)

pnpm lint           # ESLint across the monorepo
pnpm format         # Prettier write  (format:check to verify)
pnpm typecheck      # TypeScript per-package (--if-present)
pnpm test           # Vitest unit/component tests (per-package)
```

### Running the desktop app

```sh
pnpm --filter @selfos/desktop dev     # run the app with electron-vite + HMR
pnpm --filter @selfos/desktop build   # build main/preload/renderer to out/
pnpm --filter @selfos/desktop e2e     # build, then run the Playwright-Electron E2E suite
```

The Claude client is an interface with a real and a deterministic **fake** implementation, selected by
environment, so tests never hit the network.

## Definition of Done

A slice isn't done until **all** of these pass (the full checklist is in [`CLAUDE.md`](CLAUDE.md) §7):

- `pnpm typecheck`, `pnpm lint`, and Prettier are clean.
- Meaningful unit/component tests (Vitest) for new logic.
- **Playwright E2E for every new user-facing surface** (it runs headlessly), including responsive and
  no-overflow guards.
- Docs in lockstep — the relevant spec / `CLAUDE.md` updated.
- A self code-review pass, an accessibility check, and a visual-QA pass at desktop **and** ~360px.

The `quality-gate` skill runs the automatable subset; git hooks (`pre-commit`, `commit-msg`, `pre-push`)
and CI enforce the hard gates.

## Workflow (branch → PR → squash-merge)

`main` is only ever updated through a **merged pull request** — never a direct push, never a local merge.
A **`pre-push` git hook blocks direct pushes to `main`** locally (emergency override: `git push --no-verify`).

1. **Branch off the latest `main`:** `git switch main && git pull`, then `git switch -c <type>/<slug>`
   where `<type>` is `feat` / `fix` / `chore` / `docs` / `refactor`.
2. **Commit** as you go. Every commit follows
   [Conventional Commits](https://www.conventionalcommits.org/) and is gated by git hooks (lint-staged +
   commitlint + a full typecheck on commit; full typecheck + unit suite on push). Commits carry the
   trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
3. **Keep up to date by rebasing, not merging:** `git fetch origin && git rebase origin/main`.
   **Never `git merge origin/main` into your branch** — a hand-merge once carried a stale release
   manifest forward and put release-please into a release-PR loop.
4. **Open a PR:** `git push -u origin HEAD && gh pr create`. CI (lint · typecheck · unit tests) mirrors
   the local gates and must be green.
5. **Squash-merge** with a **Conventional Commit title** (`gh pr merge --squash --delete-branch`). That
   title is the single commit that lands on `main`, so it drives the changelog and the version bump:
   `feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE` → major (pre-1.0: breaking → minor);
   `docs:`/`chore:`/`test:`/`ci:`/`build:` cut no release.

> Server-side branch protection isn't enabled because it requires GitHub Pro for the rules we'd want; if
> that changes, add a ruleset requiring the **Lint · Typecheck · Test** check + linear history + a PR,
> with admin bypass.

## Releases

Versioning and releases are automated (see [`docs/specs/19-distribution.md`](docs/specs/19-distribution.md))
via [release-please](https://github.com/googleapis/release-please). As Conventional Commits land on `main`,
it keeps a **"Release vX.Y.Z" PR** open. **Merging that PR is how you cut a release:** it bumps the
version, writes [`CHANGELOG.md`](CHANGELOG.md), tags `vX.Y.Z`, and creates the GitHub Release; a macOS
Actions job then builds and attaches the `.dmg`, then publishes it.

**Rules (don't fight the tool):**

- **Never hand-edit a version, `git tag`, or write `CHANGELOG.md` by hand** — release-please owns all three.
- **Never add a `Release-As:` commit.** The footer lingers in history and forces backward version proposals.
- `.release-please-manifest.json` is the source-of-truth current version and **must match the latest git tag**.
  If it drifts below the latest tag, release-please re-proposes already-shipped versions in a loop — fix the
  manifest to the latest tag, close stale release PRs, and delete any duplicate **draft** releases (drafts
  carry no tag, so the real tags are safe). See [`19-distribution.md`](docs/specs/19-distribution.md) §7.
- Don't interleave direct `main` pushes / local merges with release-PR merges.

Builds are currently **macOS-only and unsigned** — first launch needs a one-time Gatekeeper bypass
(`xattr -cr /Applications/SelfOS.app`). Code signing + notarization, auto-update, and Windows/Linux
installers are later phases.

## The landing page

The marketing site is a single self-contained file at [`site/index.html`](site/index.html) (no build
step). A GitHub Actions workflow ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)) deploys
`site/` to GitHub Pages on changes to `main`. To preview locally, open the file or serve the folder
(`cd site && python3 -m http.server`).

## Security &amp; privacy principles

- All user content is highly sensitive: never logged, redacted from logs and errors.
- The Claude API key lives in main only (device-local, or — at the owner's choice — encrypted under the
  household master key in the vault); the resolved key value never crosses IPC or appears in logs.
- The renderer is sandboxed (`contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP) and reaches
  the outside world only through the typed IPC seam.

If you find a security issue, please report it privately rather than opening a public issue.

---

_SelfOS — calm, private, and entirely yours._
