---
name: sync-docs
description: After code changes, detect drift between the code and the docs (docs/specs/, CLAUDE.md, skills) and propose the concrete edits to bring them back in lockstep. Use as part of finishing a slice, before committing, or when the user asks to "update the docs / sync the spec / check the docs are current". The proactive half of SelfOS's living-docs loop.
---

# sync-docs

SelfOS keeps documentation in lockstep with code. After any change that affects behavior, structure,
settings, or architecture, check whether the docs still tell the truth — and fix them.

## Steps

1. **Get the diff.** `git diff main...HEAD` (or the staged/working diff for an in-progress slice).
2. **Delegate the audit.** Invoke the **`doc-auditor`** agent with the diff. It returns a list of
   specific drift items: `{ file, what's stale, proposed edit }`.
3. **Review & apply.** For each item, apply the proposed edit (or refine it). Typical targets:
   - `docs/specs/NN-*.md` — the spec for the feature/area that changed.
   - `CLAUDE.md` — if a standard, command, or principle changed.
   - `.claude/skills/*` — if a workflow changed.
   - `README.md` — if setup, stack, or structure changed.
4. **Changelog.** If a `CLAUDE.md` rule changed, add a dated entry to its `## Changelog`.
5. **Report** what was updated and why, and flag anything you couldn't resolve.

## Heuristics for drift

- New/changed setting → `03-settings.md` and any feature spec that owns it.
- New IPC channel, file format, or schema → `00-architecture.md`.
- New design token or component → `01-design-system.md`.
- New feature module → its own `NN-*.md` spec must exist (the `pre-commit` doc-drift check warns
  when a module changes with no spec staged).

Be precise: propose the smallest correct edit, not a rewrite. Don't invent detail the code doesn't
support — if the code and intent are unclear, ask.
