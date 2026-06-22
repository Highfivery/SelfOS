---
name: ship-slice
description: Run the full end-to-end cadence to finish a slice of SelfOS work — quality gate, self code-review, doc sync, and a Conventional Commit. Use when the user says "ship it", "finish this slice", "wrap up", or when an implementation slice is code-complete and ready to land.
---

# ship-slice

Orchestrates SelfOS's Definition of Done so a slice lands clean. Run only when the work is
code-complete (implementation + tests written).

## Sequence

1. **Branch check.** Ensure you're on a `<type>/<slug>` branch off `main`, not `main` itself. (If you're on
   `main`, branch first — `main` is only ever updated via a merged PR.)
2. **`quality-gate`.** Run it. Fix any failures before continuing. (typecheck · lint · format · unit
   tests · E2E when present.)
3. **Self code-review.** Invoke the **`code-reviewer`** agent on `git diff main...HEAD`. Address
   every finding, or explicitly note why one is accepted. Re-run `quality-gate` if you changed code.
4. **`sync-docs`.** Detect and apply doc/spec/skill drift (via the `doc-auditor` agent). Update the
   `CLAUDE.md` Changelog if a rule changed.
5. **`commit`.** Create the Conventional Commit(s) with the co-author trailer (on the branch).
6. **Push + open a PR.** `git push -u origin HEAD` then `gh pr create` with a Conventional Commit title (this
   title becomes the squash commit on `main`, so it drives the changelog + version bump). Wait for **CI to go
   green**.
7. **Squash-merge.** `gh pr merge --squash --delete-branch`. `main` now has one clean commit. Never push to
   `main` directly or merge locally; never `git merge origin/main` into a branch (rebase onto it).
8. **Offer to release.** Now the slice is on `main`, ask the user: _"Tag & publish vX.Y.Z now, or batch with the
   next change?"_ If yes, run the **`release`** skill. (A `docs:`/`chore:`/`test:`-only slice cuts no release —
   say so.)
9. **Report.** Summarize: what shipped, checks status, review findings, docs updated, the PR link, and the
   release decision.

## Principles

- Never declare done with a red gate or unaddressed review finding.
- `main` moves **only** through a merged PR — never a direct push or a local merge.
- Keep documentation true at every step — code and docs land together, never separately.
- If anything is ambiguous (intent, an accepted risk, a spec conflict), pause and ask rather than
  assume.
