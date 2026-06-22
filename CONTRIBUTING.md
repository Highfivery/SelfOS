# Contributing to SelfOS

An AI therapist + life coach desktop app — **wellness / self-help, not medical**. SelfOS is
designed to be calm, private, and entirely yours: your data lives in plain Markdown and JSON
files in a folder _you_ choose (local, Dropbox, iCloud, …), and the AI is powered by the
Claude API.

> ⚠️ SelfOS is a wellness and self-help tool. It is **not** a medical device and **not** a
> substitute for professional care. If you are in crisis, contact local emergency services or
> a crisis line.

## Status

SelfOS is in active build phase. The foundation (secure Electron shell, design system, vault, the
schema-driven settings system, AI plumbing) plus AI **sessions**, **memory/insights**,
**questionnaires**, **dreams**, **onboarding**, and the **home dashboard** are all built. We build
slice by slice, spec-first — see [`docs/specs/`](docs/specs) and the `CLAUDE.md` changelog for the
current state.

## Tech stack

| Area            | Choice                                                     |
| --------------- | ---------------------------------------------------------- |
| Platform        | Electron + React + TypeScript (strict)                     |
| Data            | Plain-file "vault" (Markdown + JSON); user-chosen location |
| AI              | Claude API (key lives in the Electron main process only)   |
| Build / package | electron-vite + electron-builder                           |
| Styling         | CSS custom properties (tokens) + CSS Modules               |
| State           | Zustand · Validation: Zod · Routing: React Router          |
| Testing         | Vitest + React Testing Library (unit) · Playwright (E2E)   |
| Tooling         | pnpm monorepo · ESLint + Prettier · Conventional Commits   |

## Repository layout

```
apps/desktop      Electron app (Electron main / preload / React renderer)
packages/*        Shared code, extracted as needs emerge (design-system, core, vault)
docs/specs        Feature-set specifications (the source of truth for what we build)
.claude           Claude Code rules, skills, and sub-agents
```

## Development

**Prerequisites:** **Node ≥ 20** (`.nvmrc` pins **24** — run `nvm use`) and **pnpm** (via Corepack or the
`packageManager` field). The git hooks fail fast with a clear message if your active Node is too old, so if a
commit/push errors with a `pnpm requires … Node` message, run `nvm use` and retry.

```bash
pnpm install        # install dependencies and set up git hooks
pnpm lint           # ESLint across the monorepo
pnpm format         # Prettier write
pnpm typecheck      # TypeScript (per-package, --if-present)
pnpm test           # Vitest unit/component tests (per-package)

# Desktop app (apps/desktop)
pnpm --filter @selfos/desktop dev     # run the app with electron-vite + HMR
pnpm --filter @selfos/desktop build   # build main/preload/renderer to out/
pnpm --filter @selfos/desktop e2e     # build, then Playwright-Electron E2E
```

### Workflow (branch → PR → squash-merge)

`main` is only ever updated through a **merged pull request** — never a direct push, never a local merge. A
**`pre-push` git hook blocks direct pushes to `main`** locally (emergency override: `git push --no-verify`).
Server-side branch protection isn't enabled because it requires GitHub Pro on a private repo — if that changes
(upgrade, or make the repo public), add a ruleset requiring the **Lint · Typecheck · Test** check + linear
history + a PR, with admin bypass.

1. **Branch off the latest `main`:** `git switch main && git pull`, then
   `git switch -c <type>/<slug>` where `<type>` is `feat` / `fix` / `chore` / `docs` / `refactor`.
2. **Commit** as you go. Every commit follows
   [Conventional Commits](https://www.conventionalcommits.org/) and is gated by git hooks
   (lint-staged + commitlint + a full typecheck on commit; full typecheck + unit suite on push).
3. **Keep up to date by rebasing, not merging:** if `main` has moved, `git fetch origin && git rebase
origin/main`. **Never `git merge origin/main` into your branch** — a hand-merge once carried a stale release
   manifest forward and put release-please into a release-PR loop.
4. **Open a PR:** `git push -u origin HEAD && gh pr create`. CI (lint · typecheck · unit tests) mirrors the
   local gates and must be green.
5. **Squash-merge** with a **Conventional Commit title** (`gh pr merge --squash --delete-branch`). That title
   is the single commit that lands on `main`, so it drives the changelog and the version bump:
   `feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE` → major (pre-1.0: breaking → minor);
   `docs:`/`chore:`/`test:`/`ci:`/`build:` cut no release.

### Releases

Versioning and releases are automated (see [`docs/specs/19-distribution.md`](docs/specs/19-distribution.md))
via [release-please](https://github.com/googleapis/release-please). As Conventional Commits land on `main`, it
keeps a **"Release vX.Y.Z" PR** open. **Merging that PR is how you cut a release:** it bumps the version,
writes [`CHANGELOG.md`](CHANGELOG.md), tags `vX.Y.Z`, and creates the GitHub Release; a macOS Actions job then
builds and attaches the `.dmg`, then publishes it.

**Rules (don't fight the tool):**

- **Never hand-edit a version, `git tag`, or write `CHANGELOG.md` by hand** — release-please owns all three.
- **Never add a `Release-As:` commit.** The footer lingers in history and forces backward version proposals.
- `.release-please-manifest.json` is the source-of-truth current version and **must match the latest git tag**.
  If it drifts below the latest tag, release-please re-proposes already-shipped versions in a loop — fix the
  manifest to the latest tag, keep the `bootstrap-sha` floor above old release-config commits, close stale
  release PRs, and delete any duplicate **draft** releases (drafts carry no tag, so the real tags are safe).
  See [`docs/specs/19-distribution.md`](docs/specs/19-distribution.md) §7.
- Don't interleave direct `main` pushes / local merges with release-PR merges.

Builds are currently **macOS-only and unsigned** — first launch needs a one-time Gatekeeper bypass
(`xattr -cr /Applications/SelfOS.app`). Code signing + notarization, auto-update, and Windows/Linux installers
are later phases.
