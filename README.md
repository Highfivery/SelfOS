# SelfOS

An AI therapist + life coach desktop app — **wellness / self-help, not medical**. SelfOS is
designed to be calm, private, and entirely yours: your data lives in plain Markdown and JSON
files in a folder _you_ choose (local, Dropbox, iCloud, …), and the AI is powered by the
Claude API.

> ⚠️ SelfOS is a wellness and self-help tool. It is **not** a medical device and **not** a
> substitute for professional care. If you are in crisis, contact local emergency services or
> a crisis line.

## Status

**Build phase — slice 1 landed.** All four foundation specs are approved (see
[`docs/specs/`](docs/specs)), and the first build slice is in: a secure Electron window that boots a
calm, themed (light/dark) shell with the design tokens and a working preload → IPC pipeline. We build
slice by slice, perfecting each before the next; the app-shell, design-system primitives, and the
settings registry come in subsequent slices.

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

### Workflow

Work happens on feature branches off `main`. Every commit is gated by git hooks
(lint-staged + commitlint + typecheck) and follows
[Conventional Commits](https://www.conventionalcommits.org/). CI mirrors the local gates.
