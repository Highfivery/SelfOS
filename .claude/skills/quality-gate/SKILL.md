---
name: quality-gate
description: Run the automatable subset of SelfOS's Definition of Done (typecheck, lint, format check, unit tests, and E2E when present) and report pass/fail. Use before committing, before declaring a slice done, or when the user asks to "run the checks / quality gate / verify it's clean".
---

# quality-gate

Runs the automated quality checks that gate every slice. Reports clearly; fixes or surfaces
failures — never reports green when something failed.

## Run, in order

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

When the desktop app and Playwright exist, also:

```bash
pnpm --filter @selfos/desktop run e2e
```

## Rules

- If any step fails, **stop and fix it** (or report precisely what failed and why). Do not proceed to
  commit.
- `format:check` failing means files aren't Prettier-clean — run `pnpm format` to fix.
- Lint errors are fixed properly, not silenced with disable comments (unless genuinely justified and
  commented).
- Report a short summary: each check and ✅/❌, plus what was fixed.

## Relationship to the hard gates

This skill is the convenience layer. The deterministic backstop is the git hooks
(`pre-commit`, `commit-msg`, `pre-push`) and CI — they enforce the same checks so nothing slips
through even if this skill isn't run.
