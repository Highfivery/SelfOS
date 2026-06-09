---
name: ship-slice
description: Run the full end-to-end cadence to finish a slice of SelfOS work — quality gate, self code-review, doc sync, and a Conventional Commit. Use when the user says "ship it", "finish this slice", "wrap up", or when an implementation slice is code-complete and ready to land.
---

# ship-slice

Orchestrates SelfOS's Definition of Done so a slice lands clean. Run only when the work is
code-complete (implementation + tests written).

## Sequence

1. **Branch check.** Ensure you're on a feature branch off `main`, not `main` itself.
2. **`quality-gate`.** Run it. Fix any failures before continuing. (typecheck · lint · format · unit
   tests · E2E when present.)
3. **Self code-review.** Invoke the **`code-reviewer`** agent on `git diff main...HEAD`. Address
   every finding, or explicitly note why one is accepted. Re-run `quality-gate` if you changed code.
4. **`sync-docs`.** Detect and apply doc/spec/skill drift (via the `doc-auditor` agent). Update the
   `CLAUDE.md` Changelog if a rule changed.
5. **`commit`.** Create the Conventional Commit(s) with the co-author trailer.
6. **Report.** Summarize: what shipped, checks status, review findings, docs updated. If the user is
   merging locally, offer to merge the branch into `main`.

## Principles

- Never declare done with a red gate or unaddressed review finding.
- Keep documentation true at every step — code and docs land together, never separately.
- If anything is ambiguous (intent, an accepted risk, a spec conflict), pause and ask rather than
  assume.
