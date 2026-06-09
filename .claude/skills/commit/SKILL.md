---
name: commit
description: Create a Conventional Commit for SelfOS with the required co-author trailer, after verifying the quality gate passes. Use when the user asks to "commit", or as the final step of shipping a slice. Refuses to commit on main or when checks are failing.
---

# commit

Creates clean, standards-compliant commits.

## Preconditions (do not skip)

1. **Not on `main`.** If `git branch --show-current` is `main`, stop and create/switch to a feature
   branch first. We never commit directly to `main`.
2. **Quality gate green.** Run the `quality-gate` skill (or confirm it just passed). Do not commit
   with failing checks.

## Steps

1. **Review the diff** (`git diff` / `git status`) and stage the logically-related changes. Split
   unrelated work into separate commits.
2. **Write a Conventional Commit message:**
   - Subject: `type(scope): summary` — imperative, ≤ ~72 chars. Types: `feat fix docs style refactor
perf test build ci chore revert`.
   - Body (optional): wrapped at **≤ 100 chars/line**, explaining the _why_.
   - Trailer (required): `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
3. **Commit.** For multi-line/wrapped messages, write the message to a temp file and use
   `git commit -F <file>` (avoids line-length and quoting issues).
4. The `commit-msg` hook (commitlint) and `pre-commit` hook will validate; if they reject, fix the
   message or the code and retry — never bypass with `--no-verify`.

## Example

```
feat(settings): add schema-driven registry for boolean settings

Introduce SettingDefinition and a Zod-backed registry so settings UI and
persistence derive from one declaration. Covers boolean controls; more types
follow.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
