---
name: capture-feedback
description: Persist user feedback, corrections, or durable preferences into the project's config so they aren't forgotten. Use whenever the user corrects your approach, states a standing preference ("from now on…", "always/never…"), or makes a decision that should outlive this session. The reactive half of SelfOS's living-docs loop.
---

# capture-feedback

When the user gives durable guidance, write it down in the right place — don't just remember it for
the session. This keeps the project config a living, compounding source of truth (auditable in git).

## Decide where it belongs

| Kind of feedback                                | Where it goes                           |
| ----------------------------------------------- | --------------------------------------- |
| How we build / a standing rule or preference    | `CLAUDE.md` (the relevant section)      |
| A repeatable procedure / new automation         | a skill in `.claude/skills/`            |
| A product/architecture decision                 | the relevant `docs/specs/*` file        |
| Permissions, hooks, env                         | `.claude/settings.json`                 |
| Behavior the harness must enforce automatically | a hook (settings.json) — see note below |

## Steps

1. **Confirm the intent** in one sentence if there's any ambiguity. Never invent a preference.
2. **Apply the change** to the correct file (above). Keep it concise and consistent with existing
   style.
3. **Log it.** Append a dated bullet to the `## Changelog` in `CLAUDE.md`:
   `- YYYY-MM-DD — <what changed and why>.`
4. **Confirm** back to the user what you captured and where.

## Notes

- "Always/whenever/from now on, do X automatically" usually means a **hook** (deterministic), not
  just a rule — because the harness, not the model's memory, must run it. Prefer a hook or git-hook
  for anything that must be guaranteed.
- Prefer updating an existing rule over adding a duplicate. If a rule turns out wrong, remove it.
- The proactive counterpart is the `sync-docs` skill (drift detection after code changes).
