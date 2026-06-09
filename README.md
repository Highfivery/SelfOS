# SelfOS

An AI therapist + life coach desktop app — **wellness / self-help, not medical**. SelfOS is
designed to be calm, private, and entirely yours: your data lives in plain Markdown and JSON
files in a folder _you_ choose (local, Dropbox, iCloud, …), and the AI is powered by the
Claude API.

> ⚠️ SelfOS is a wellness and self-help tool. It is **not** a medical device and **not** a
> substitute for professional care. If you are in crisis, contact local emergency services or
> a crisis line.

## Status

**Foundation phase.** No application code yet — we are deliberately building the skeleton,
design system, and a schema-driven settings system first, perfecting each slice before moving
on. See [`docs/specs/`](docs/specs) for the specifications.

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
pnpm test           # Vitest unit/component tests
```

### Workflow

Work happens on feature branches off `main`. Every commit is gated by git hooks
(lint-staged + commitlint + typecheck) and follows
[Conventional Commits](https://www.conventionalcommits.org/). CI mirrors the local gates.
