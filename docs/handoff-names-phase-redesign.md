# Handoff — redesign "What do you call each other" (the pet-name phase)

**Written 2026-08-19.** The Tests landing redesign is finished and merged (#530, #531, #532). This is the next
piece: a **complete redesign of the pet-name register grid** inside the Dirty Talk take, plus a **confirmed
bug** on the same screen.

---

## 1. How the owner wants this done

Said forcefully, more than once, across several sessions. Not suggestions.

1. **Do NOT write code first.** Review what is there, ask questions **one at a time** and wait for each
   answer, offer suggestions, then **mock it up** for approval. Build only after he approves.
2. **"Improve the UI/UX" means DESIGN** — palette, layout, hierarchy, component choice. A previous session was
   pulled up hard for answering a UI/UX request with a copy edit: _"WHEN I SAY IMPROVE SOMETHING FROM THE
   UI/UX, THAT MEANS DESIGN, NOT A LINE OF TEXT."_
3. **Ask, never assume.** Any unstated product/UX/visibility/behaviour decision gets a question first.
4. **Never claim something is fixed until you have verified it yourself**, on his machine, against his real
   data. "The tests pass" is not verification.
5. **Fix what you find in the same change.** No follow-ups, no deferrals.
6. The mockup should be an **Artifact in the app's real design tokens** — that is the established pattern and
   what got approved for the last three rounds.
7. **Lucide icons only.** Never emoji or unicode glyphs, including in mockups.

---

## 2. What he asked for, verbatim in substance

> We need to greatly improve the UI/UX of this page and there's also a bug currently where when a user goes
> through a section and then comes back after answering all or even some, it still shows Not Opened even
> though there are saved answers.

Improvements he explicitly wants considered:

- a **progress bar** on each register with a **percentage complete** for all its names
- a **clear total**, **how many answered**
- how many marked **love it**, how many **it's okay**, how many **never**
- **clear indication and sorting** of complete / some answered / none answered
- anything else useful — and it must be **sleek, modern, easy to navigate, easy to understand, engaging,
  interactive and visual**

---

## 3. The bug — diagnosed, not guessed

**Symptom:** a register you have marked still reads `NOT OPENED` when you come back to the grid.

**Cause.** Each register's `marked` count is computed **server-side** and fetched **once**:

- `apps/desktop/src/shared/coreBridge.ts` ~line 4390 — `testsNames` builds each
  `AdaptiveNameRegisterView` and sets
  `marked: own.filter(e => byKey.get(e.key)?.hearState !== undefined || …sayState !== undefined).length`
- `adaptiveTestStore.ts` `flush()` writes the marks via `testsAdaptiveNames({ marks, cleared, autosave })`
  and sets `saveState: 'saved'` — **it never re-fetches the names view.**

So marking names updates only local `store.nameMarks`; the grid keeps rendering the `marked` value from the
mount-time fetch. `NamesPhase.tsx:49` gates the card's state on `register.marked > 0`, so a register marked in
this sitting still reads "Not opened".

**Why some registers show a count anyway:** those were marked in an **earlier** sitting, so their count was
already baked into the mount-time fetch. That is why his screenshot shows `warm & sweet 133 MARKED` beside a
wall of `NOT OPENED`.

**The fix direction.** The renderer already holds the authoritative marks — `NamesPhase.tsx:115` derives
`markedHere` from `store.nameMarks` for the register that is open. Derive every register's counts from
`store.nameMarks` (falling back to the fetched `marked` for names not touched this sitting) rather than
re-fetching: it is instant, needs no round-trip, and removes the two-sources-of-truth problem entirely. A
refetch-after-flush would also work but leaves the stale window and the duplication.

**This is also what makes his requested stats possible.** `love / okay / never` counts are not in
`AdaptiveNameRegisterView` at all — they only exist per name in `store.nameMarks` (and in the lexicon). So the
same local derivation that fixes the bug is what supplies the numbers he wants on each card.

---

## 4. Constraints that are load-bearing

- **A pet name is marked in TWO directions** — what you like being **called** (`hear`) and what you like
  **calling them** (`say`). A card's "answered" count must be honest about that: a name answered one way is
  not fully answered. Decide with him how to count it, and ask.
- **`never` is a boundary, not a rating.** It suppresses that word app-wide and only lifts by an explicit act
  (74 §3.2). Do not present it as just another bucket in a chart.
- **Never show anything as COMPLETE** — no ratio, no percentage toward done, no meter filling to full
  (CLAUDE.md §12, narrowed 2026-08-19: a **count** is fine, a **denominator** is not). ⚠️ **This directly
  collides with his request for "a progress bar with a percentage of complete".** Unlike the instrument
  catalog, a register IS a finite, genuinely completable list of names — so the rule may well not apply here.
  **Ask him explicitly and record the answer**; do not silently pick either way.
- **No horizontal scrollbars anywhere**, including inner controls. Wrapping a control cluster is not a design.
- **Responsive ~360px → desktop**, with a 390px overflow guard in the E2E.
- **Content fills the width** — no `max-width` cap on a page container.
- The crisis footer stays on every take surface.

---

## 5. Questions worth asking (one at a time)

1. **Does a progress percentage belong here at all**, given the never-show-complete rule? (See above — this
   one gates the whole design.)
2. **What counts as "answered"** for a two-direction name — either side, or both?
3. **Sorting**: his ask implies grouping by completion state. Should partially-answered come first (resume
   where you were) or last (finish what's untouched)?
4. **Does the `never` count belong on the card**, given a boundary is not a preference? It may be better shown
   as a quiet marker than a third number in a row of three.
5. **Do the 24 registers need filters/search** the way the catalog got them, or is grouping enough?

---

## 6. Useful paths

|                  |                                                                            |
| ---------------- | -------------------------------------------------------------------------- |
| The screen       | `apps/desktop/src/renderer/src/app/routes/you/NamesPhase.tsx` (+ its test) |
| Its styles       | `apps/desktop/src/renderer/src/app/routes/you/Adaptive.module.css`         |
| The store        | `apps/desktop/src/renderer/src/stores/adaptiveTestStore.ts` (`flush`)      |
| The view builder | `apps/desktop/src/shared/coreBridge.ts` (`testsNames`, ~4380)              |
| View types       | `packages/core/src/schemas.ts` — `AdaptiveNameRegisterView`                |
| The name bank    | `packages/core/src/tests/adaptive/instruments/dirtyTalkNames.ts`           |
| Spec             | `docs/specs/74-adaptive-tests.md` §3.6.8                                   |
| Design tokens    | `apps/desktop/src/renderer/src/design-system/tokens.css`                   |

---

## 7. State of the tree

- `main` is current. **#530** (Tests landing redesign), **#531** (unrated-is-not-a-no + per-instrument card
  readings), **#532** (a started adaptive take stays featured) are merged or merging.
- Gate at handoff: typecheck ×4, lint, format, **2396 core + 13 relay + 1723 desktop** unit, **218 E2E**.
- Known flake, **not** a regression: `questionnaires: author a single-choice questionnaire` drops a keystroke
  under full-suite load ("Not at al") and passes in isolation.
- Release PR **#494** is open at 0.58.0 and carries all of the above.

---

## 8. Verification notes, and traps that cost real time this session

- **Rebuild before every E2E run**, and confirm the `✓ built` line. Twice a revert-check "passed" against a
  **stale bundle** — once because `electron-vite build` hit the 2-minute command timeout and the run silently
  used the previous build. A revert-check that passes is meaningless unless you saw the build succeed.
- **Grep the file after reverting**, not just before. One revert silently did not apply because prettier had
  reformatted the line being matched; the test passed and would have been recorded as proof.
- **Two independent fixes mask each other.** #531 fixed the same bug at score time and at read time; reverting
  either alone still produced correct output. Revert **both** to prove a guard bites.
- **Playwright and RTL substring-match accessible names.** "Retake" matches `{ name: 'Take' }`; an absence
  assertion without `exact: true` is worse than none, because it passes.
- **Adding a badge changes a nav link's accessible name**, breaking every `exact: true` locator for it.
- The owner's dev app holds a **single-instance lock** on `SelfOS Dev` userData — pass a temp
  `--user-data-dir` for any throwaway Electron script, and never kill his app.
- **Reading his real vault needs a Keychain unlock** and will block headlessly. It was attempted this session
  and abandoned. Ask him to run anything that needs decryption.
- `packages/core` is bundled into the main process, so any change there needs a **FULL `pnpm dev` restart** —
  a hot reload serves stale code.
