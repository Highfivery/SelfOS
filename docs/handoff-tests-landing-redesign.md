# Handoff — redesign the Tests landing page

**Written 2026-08-18.** The Dirty Talk take (spec 74) is finished, verified live, and merged. This is the
next piece of work: a **complete redesign of the Tests landing page** (`/tests`).

---

## 1. Read this first — how the owner wants this done

He has said all of the following, forcefully, more than once. They are not suggestions.

1. **Do NOT write code yet.** Review what is there, ask questions **one at a time** and wait for each answer,
   offer suggestions and enhancements, then **mock it up** for review. Only build after he approves.
2. **"Improve the UI/UX" means DESIGN, not a copy edit.** A previous session was pulled up hard for this:
   _"WHEN I SAY IMPROVE SOMETHING FROM THE UI/UX, THAT MEANS DESIGN, NOT A LINE OF TEXT."_ Palette, layout,
   hierarchy, component choice — not reworded labels.
3. **Ask, never assume.** Any unstated product/UX/visibility/behaviour decision gets a question first.
4. **Never claim something is fixed until you have verified it yourself**, on his machine, against his real
   data. Not "the tests pass".
5. **Fix what you find in the same change.** No follow-ups, no deferrals.
6. The mockup should be an **Artifact in the app's real design tokens** — that is the established pattern here
   and it is what got approved for the take's redesign.

---

## 2. What is there now

`apps/desktop/src/renderer/src/app/routes/you/You.tsx` (266 lines) + `You.module.css`.

**Structure, top to bottom:**

|                     |                                                                 |
| ------------------- | --------------------------------------------------------------- |
| Header              | `<h1>` "You — how you see yourself" + a line pointing at Memory |
| Banner              | Shown only when nothing has been taken                          |
| **Your profiles**   | A flat grid of `ProfileCard` — one per taken test               |
| **Available tests** | Four groups, each a flat grid of `CatalogCard`                  |
| Crisis footer       | Always present (§8.2 — non-negotiable)                          |

**`ProfileCard`** (taken): instrument eyebrow + a privacy tag, title, then either a wellbeing band phrase or up
to N `SubscaleBar`s, then "Taken · date", an optional re-check nudge, and **Open** / **Retake**.

**`CatalogCard`** (untaken): instrument eyebrow, title, blurb, "N questions · about M min", a framing line, and
one **Take / Start / Check in** button.

**The four groups** (`GROUP_ORDER` in `You.tsx`, labels in `packages/core/src/tests/types.ts`):
`personality` · `relationships` · `intimacy` (18+ gated) · `wellbeing` ("Reflections & check-ins").

**The instruments:** Big Five (IPIP-120), ECR-R, Kinsey/Klein, kink inventory, PHQ-9, GAD-7, ASRS, AQ-10,
RAADS-R, and **Dirty Talk** — the adaptive one, which is a different animal from all the others.

---

## 3. What I noticed while reading it — starting points, not conclusions

Verify each yourself before repeating it to him.

- **Two card types that look nearly identical** but mean opposite things (a result you own vs an invitation to
  spend 15–30 minutes). The visual weight is the same.
- **Both grids are flat.** With ~10 instruments the page is a long, undifferentiated scroll. Nothing tells you
  where to start, what is quick, what is heavy, or what you last did.
- **A taken test disappears from "Available"** and reappears above — so the page reshapes as you use it, and
  there is no single place that shows the whole catalog and your position in it.
- **Wildly different weights are presented identically.** RAADS-R is 80 items; AQ-10 is 10; Dirty Talk is an
  adaptive multi-step take with its own map and rail. The card gives them the same footprint.
- **Dirty Talk is the flagship and reads like a row in a list.** It is the only adaptive instrument, the only
  one with a seven-step map, and the only one that feeds a partner's coach.
- **The 18+ gate is a whole card** in the flow of a group rather than a property of that group.
- **"Reflections & check-ins" carries a safety framing line** the other groups don't — correct, but it makes
  the group headers structurally inconsistent.
- **No sense of time or history.** Nothing shows when you last took something, what changed, or that several
  of these are meant to be re-taken (PHQ-9/GAD-7 have a ~14-day re-check window; `staleForRetake` exists).
- **The header line points at Memory** — a good instinct, but it's a text link in a paragraph.

---

## 4. Constraints the redesign must honour

These are load-bearing. Breaking any of them is a regression.

- **The crisis footer stays on this page** (spec 51 §8, CLAUDE.md §1). Non-negotiable.
- **Wellbeing instruments are non-diagnostic reflections.** Never a clinical band, never a diagnosis, never a
  score presented as a verdict. The internal `clinicalKey` is firewalled from every user surface — see
  spec 51 §8.1. The gentle display band + the always-present professional-help line stay.
- **NEVER show a topic/area as COMPLETE**, and no progress meter toward "done" (durable owner rule,
  2026-08-13). Show what happened, not what is left.
- **The 18+ gate is real.** The intimacy group is withheld **in the bridge**, not just the UI, until the
  shared `adultAcknowledged` ack. Do not surface gated instruments before it.
- **The privacy tags are a promise.** An adaptive intimacy profile says "yours", not "private — only you",
  because what you love travels silently into a partner's coach (74 §8.4). A spec-50 sensitive result really
  is own-context-only and keeps the stronger wording. Do not flatten these into one badge.
- **Content fills the width** — no `max-width` cap on the page container (CLAUDE.md §12).
- **No horizontal scrollbars anywhere**, including inner controls. Wrapping a control row is not a design —
  use a space-filling component.
- **Responsive ~360px → desktop**, and every screen gets a 390px E2E overflow guard.
- **Always lucide icons**, never emoji or unicode glyphs.

---

## 5. Questions worth asking him (one at a time, in roughly this order)

Do not batch these. Each answer changes the mockup.

1. **What is this page FOR?** A library you browse, a dashboard of what you know about yourself, or a
   next-action surface that tells you what to do? The current page tries all three.
2. **Is Dirty Talk first-class or one of the list?** It is the only adaptive instrument and the deepest thing
   in the app. Does it get a hero, or does the page stay egalitarian?
3. **Taken and untaken — one list or two?** Today they are separate sections and items move between them.
   A single catalog with state on each card is the alternative.
4. **Should the page show history/trends** (last taken, what moved), or stay a launcher with all of that
   living inside each report?
5. **Do the four groups survive?** They could become filters, tabs, a sidebar, or go away entirely in favour
   of sorting by depth/time.
6. **How prominent should the re-check nudge be** for PHQ-9/GAD-7 — a passive line as now, or something the
   page leads with when one is due?

---

## 6. How to verify anything, on his machine

He insists on this and unit tests do not satisfy it.

- Dev userData: `~/Library/Application Support/SelfOS Dev`
- Vault: `~/Library/Mobile Documents/com~apple~CloudDocs/Family/SelfOS`
- His person id: `728df9a6-1855-46cc-aaee-40979bf98494`
- Ask him for an **API key** for live runs — do not reuse one from a transcript.

A working live harness pattern (built and used this session): an Electron entry that calls
`app.setName('SelfOS Dev')`, reads `secrets.json` from `app.getPath('userData')` and decrypts with
`safeStorage.decryptString` (secrets sit under a `secrets` key; master key id `selfos.masterKey`, API key
`anthropic.apiKey`), builds a `BridgeHost` and calls **`createCoreBridge(host)`** so you exercise the real
handlers, with a `fetch`-based `ClaudeClient` that captures prompts. Bundle with esbuild
(`--bundle --platform=node --format=cjs --external:electron`, aliases for `@shared` → `apps/desktop/src/shared`
and `@main` → `apps/desktop/src/main`, plus explicit aliases for any `@selfos/core/*` subpath you import from
outside the repo), run with `apps/desktop/node_modules/.bin/electron`.

### Two traps that cost real damage this session

1. **`testsAdaptiveAbandon` is NOT cleanup.** It is the disclosed, confirm-gated "start fresh" and it wipes
   every mark **and every hard no** in the person's lexicon. I called it to tidy up a scratch draft and
   destroyed 132 marks and 245 boundaries. **Read any destructive op before calling it.**
2. **A harness faking a host type must use the APP's field names.** Mine used the SDK's raw usage fields, so
   cost computed to `NaN`, `JSON.stringify` wrote it as `null`, and the poisoned event made every budget check
   for that person throw — taking AI down app-wide until the shard was repaired. The real names are
   `cacheWriteTokens` / `cacheReadTokens` (`packages/core/src/host/claudeClient.ts`).

---

## 7. State of the tree

- `main` is current; PRs **#527** (the take's fixes) and **#528** (the fold arrow) are merged.
- Full gate green at handoff: typecheck ×3, lint, format, **2390 core + 1684 desktop** unit, **216 E2E**.
  One known flake, **not** a regression: `first-time setup creates the owner` fails under full-suite load and
  passes 3/3 in isolation on a clean tree.
- **His lexicon is seeded test data**, not real answers — 132 marks / 245 boundaries generated from the bank
  so the AI steps had a realistic shape to run against. He knows. Clear it before a real take.
- Release PR **#494** is still open — none of this is in a `.dmg` yet.

## 8. Useful paths

|                              |                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| The page                     | `apps/desktop/src/renderer/src/app/routes/you/You.tsx` + `You.module.css`                  |
| Its tests                    | `You.test.tsx`                                                                             |
| Catalog types + group labels | `packages/core/src/tests/types.ts`                                                         |
| Instruments                  | `packages/core/src/tests/instruments/`                                                     |
| Adaptive take (the flagship) | `AdaptiveTake.tsx`, `AdaptiveReport.tsx`, `takeSteps.ts`, `TakeRail.tsx`, `TakeMap.tsx`    |
| Specs                        | `docs/specs/50-self-assessments.md`, `51-wellbeing-reflections.md`, `74-adaptive-tests.md` |
| Design tokens                | `apps/desktop/src/renderer/src/design-system/tokens.css`                                   |
