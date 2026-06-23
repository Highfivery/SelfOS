# 17 — Home dashboard (your overview)

> **Status:** Approved · _last updated 2026-06-14_
>
> The Home route (`/`) is a static placeholder today. This spec replaces it with a **living, per-person
> overview** — what's going on right now: sessions to continue, suggested next steps, a gentle wellbeing
> trend, recent dreams and their patterns, what the coach has learned (memory), anything in the inbox, and
> usage at a glance. It's the **consumer** surface that ties the rest of the app together, so it's built
> **last** — after the shareability ([`15`](15-shareability.md)) and session-lifecycle ([`09 §14`](09-session-analysis.md))
> work land, so its mood/trend/suggestion content is real.

Package **G** of the 2026-06 app refresh (memory: `app-refresh-plan-2026-06`). Consumes
[`05`](05-conversations.md)/[`09`](09-session-analysis.md) (sessions + status + mood metrics),
[`12`](12-dreams.md)/[`13`](13-dream-images.md) (dreams + patterns + images),
[`08`](08-questionnaires.md) (inbox + the shared Insight/metrics layer + the recommender),
[`16`](16-guided-sessions.md) (the guided-session recommender for "suggested next steps"),
[`06`](06-ai-usage-and-budgets.md) (usage), [`04`](04-people-roles.md) (active person, capabilities,
shareable context). UI uses the existing design system + chart primitives
([`01`](01-design-system.md)); the shell/TopBar is [`02 §13`](02-app-shell.md). References, doesn't restate.

---

## 1. Overview

Home should answer, at a glance: _"What's going on with me, and what could I do next?"_ — scoped to the
**active person** (the per-person isolation rule). It is composed of **cards**, each fed by an existing data
source, each **self-hiding when empty or unavailable** so the page is always honest and never shows dead
sections. Because several of its richest cards depend on features that may be off or not-yet-used (mood needs
analyzed sessions; suggestions need AI; dreams need dream entries), the dashboard is designed to **degrade
gracefully** from a brand-new empty state up to a full overview.

## 2. Goals / Non-goals

**Goals**

- A **per-active-person** card-based dashboard at `/` that surfaces: continue-a-session, suggested next
  steps, a wellbeing trend, recent dreams + a pattern highlight, memory highlights, inbox, and usage at a
  glance.
- **Graceful degradation** — every card self-hides (or shows a calm prompt) when its source is empty, the
  feature is off, or AI is unavailable; a brand-new user sees a friendly **getting-started** state, not a
  wall of empties.
- **Reuse, don't reinvent** — composes existing stores/IPC + existing design-system primitives
  (Card/Stack/LineChart/FrequencyBars/ProportionBar/TrendLine); no new chart types.
- **Safety-aware** — it's a wellbeing surface; the not-medical line + crisis footer are present, and the
  wellbeing trend is framed gently (§7).
- **Responsive + accessible** — a reflowing card grid, ~360px→desktop.

**Non-goals (deferred)**

- **Cross-person / household rollups** on Home — Home is the active person's own overview (admin household
  views live in Usage/People). A future "household pulse" is out of scope.
- **Configurable/rearrangeable cards** (drag-to-reorder, hide cards) — a fixed, sensible order for v1; user
  customization is a later enhancement.
- **New analytics** — Home only _surfaces_ data other specs produce; it adds no new metrics.
- **Notifications/digests** — no push/scheduled summaries here.

## 3. UX & flows

### 3.1 Layout

A responsive grid of cards under a short header. Header: a **context-aware greeting** — a time-of-day + name
line plus a light status line drawn from the same data the cards use (e.g. "Good evening, Ben — 2 sessions in
progress"), kept to one short, non-noisy sentence (degrades to just the greeting when there's nothing notable).
Below, the cards in a sensible default order; each links into its full surface. Proposed order (final tuning at
build, §11):

1. **Continue** — sessions that are **in progress** or **on hold** (`09 §14` status), newest first, with a
   Resume action. Hidden if none.
2. **Suggested next steps** — 2–4 recommendations from the **shared recommender**: **guided sessions** (reuse
   `16`) **and a questionnaire worth sending** (`08` gap-finder), clearly labelled, capped ~4 total. Each card
   starts/opens the thing. Calm state if AI off (§3.3). Cached + refreshable, reusing `16`'s suggestions.
3. **Wellbeing trend** — the `moodValence`/`moodEnergy` signal (`09`) across recent completed sessions as a
   gentle `TrendLine`/`LineChart`, with a one-line plain-language read ("steadier than last week"). Hidden
   until there are ≥2 analyzed sessions.
4. **Recent dreams** — the latest 2–3 dreams (title/snippet + thumbnail if an image exists, `13`) + a
   **pattern highlight** (a top recurring symbol/theme via `FrequencyBars`, `12 §3.5`). Links to Dreams /
   Patterns. Hidden if no dreams.
5. **What the coach knows (memory)** — the most recent approved Insights (`08`/`09`) — a couple of lines —
   linking to the Memory surface. Hidden if none.
6. **Inbox** — unanswered questionnaires count + a CTA (mirrors the nav badge). Hidden if zero.

(No Usage card — usage now lives in the TopBar dropdown, `02 §13.4`; duplicating it on Home was redundant.)

### 3.2 Getting-started (empty) state

A brand-new active person (no sessions, dreams, insights) sees a **warm getting-started** card instead of a
grid of empties: a short welcome + 2–3 primary actions ("Start a session", "Log a dream", and — if they
manage people — "Add someone to your circle"). As they use the app, real cards replace it.

### 3.3 Calm / unavailable states

- **AI off / no key** — Suggested next steps and the wellbeing-trend's narrative read show a quiet "Turn on
  AI in Settings" or simply hide; deterministic cards (recent dreams, inbox, usage) still render.
- **Feature off** — e.g. dream memory disabled → the dreams card still lists entries but no insight line;
  session memory disabled → no wellbeing trend.
- **Over budget** — no Home action spends budget on load (suggestions use the cache); nothing breaks.

### 3.4 Refresh & freshness

Home loads from the existing per-person stores on mount and on `activePerson.id` change (resetting like every
per-person surface). Suggestions reuse `16`'s cached recommendations (a manual refresh there). No Home action
triggers a model call on load.

## 4. Data model

**No new persisted data.** Home is a pure **read/compose** surface over existing sources:

| Card                    | Source                                                               |
| ----------------------- | -------------------------------------------------------------------- |
| Continue                | `conversationStore` list + the `09 §14` `status` field               |
| Suggested next steps    | `16` `guided:suggest` cache (+ optionally `08` gap-finder)           |
| Wellbeing trend         | approved session Insights' `moodValence`/`moodEnergy` metrics (`09`) |
| Recent dreams + pattern | `dreamStore` + `dreamPatternStore` (`12`)                            |
| Memory                  | `insightStore` approved Insights (`08`/`09`)                         |
| Inbox                   | `inboxStore` unanswered count (`08`)                                 |

**Resolved:** Home composes on the **renderer from the existing per-person stores** (no new IPC). If load ever
feels chatty, an optional **`home:overview`** bridge aggregator (slim, capability-aware, admin-$ redacted) can
be added later. Either way, no new vault files, no schema changes.

## 5. Architecture & modules

- **Renderer** — replace `routes/Home.tsx` (static) with a composed dashboard: a `Home` container + small
  presentational card components (`ContinueCard`, `SuggestionsCard`, `WellbeingCard`, `DreamsCard`,
  `MemoryCard`, `InboxCard` — **no `UsageCard`**, §11), each self-hiding on empty. Reuse design-system primitives + the
  existing chart primitives (`LineChart`/`TrendLine`/`FrequencyBars`/`ProportionBar`); any genuinely-new card
  pattern goes to `/gallery` (DoD §12). A `homeStore` (or direct use of the existing per-person stores) loads
  what's needed, reset on `activePerson.id` change.
- **No new nav/route** — Home is already `/`; this is a content replacement.
- **Optional bridge** — `home:overview` aggregator if chosen (§11), capability-aware, admin-$ redacted at the
  bridge (the trust boundary).
- **Reuse the recommender** — Suggested next steps calls `16`'s `guided:suggest` (and optionally `08`'s
  gap-finder) rather than a new engine.

## 6. IPC / API contracts

- Primarily **no new IPC** — Home reads existing channels (`conversations:list`, `dreams:*`, `insights:list`,
  `assignments:inbox`, `usage:summary`, `guided:suggest`).
- **Optional** `home:overview()` → a slim, capability-aware composite (admin-$ redacted) if the multi-store
  approach is too chatty; gated `sessions.own`, scoped to the active person. Claude calls only ever happen via
  the reused recommender (key stays in main).

## 7. Safety

Home is a **wellbeing surface** (it shows mood, dreams, what the coach knows), so:

- The **not-medical line** and the always-present **CrisisFooter** (`05` §7) appear on Home.
- The **wellbeing trend is framed gently** — plain, non-clinical language ("steadier than last week"), never a
  diagnosis, score, or alarming framing; it's a reflection aid, not an assessment. A crisis-flagged recent
  Insight (`09`) surfaces **supportively, leading with resources**, never as a cold metric.
- **Privacy** — Home only shows the **active person's own** data; nothing about related people beyond what
  already feeds their own context. Admin-$ stays admin-only (the established rule). Per-person reset on switch.

## 8. Accessibility

Per `01` §9: a single `<main>` with a logical heading order (greeting `h1`, card titles `h2`); each card is a
labelled region; charts carry text equivalents (not color-only) per the existing chart primitives; links/CTAs
are real, keyboard-operable, visible focus. Responsive ~360px→desktop — the grid reflows to one column on
phones; works within the `02 §3.4` responsive shell. Reduced-motion respected.

## 9. Testing strategy

- **Component (RTL):** each card renders with data and **self-hides when empty**; the getting-started state
  shows for a brand-new person; AI-off hides/calms the suggestions + trend narrative; admin sees $ in the
  usage card, non-admin doesn't; the wellbeing trend renders its text equivalent.
- **E2E (Playwright):** seed a person with an in-progress session + a couple of analyzed sessions + a dream +
  an approved Insight → Home shows Continue, the wellbeing trend, recent dreams, and memory, and links into
  each; a brand-new person shows getting-started; AI-off path; admin-vs-member $ visibility; 390px overflow +
  layout guards.
- Vault + Claude mocked as established; `pnpm typecheck` after tests (memory: `vitest-does-not-typecheck`).

## 10. Dependencies & sequencing

Build **last**: the Continue card and wellbeing trend need `09 §14` (status + mood) live; Suggested next steps
needs `16` (and benefits from `08`'s gap-finder); the dreams/memory cards already have data today. Home can be
implemented incrementally (deterministic cards first), but the spec targets the **full** dashboard once
A/B/C have landed. It reads through the per-item shareability of `15` automatically (no special handling).

## 11. Resolved decisions (2026-06-12)

1. **Cards** — six cards (Continue · Suggested next steps · Wellbeing trend · Recent dreams · Memory · Inbox);
   **no Usage card** (the TopBar dropdown owns usage). Order per §3.1, tuned at build.
2. **Data approach** — **compose on the renderer from existing stores** (no new IPC); add a `home:overview`
   aggregator only if load feels chatty.
3. **Suggested next steps** — **both** guided sessions (`16`) **and** a questionnaire suggestion (`08`
   gap-finder), clearly labelled, capped ~4.
4. **Greeting** — **context-aware**: time-of-day + name + one short status line, degrading to just the
   greeting when nothing's notable.

_All resolved; the spec is build-ready pending final approval (and the A/B/C dependencies landing — §10)._

## 13. Build decisions (2026-06-14)

Two tensions surfaced at build (the spec's §3.3/§3.4 no-spend-on-load rule vs §11.3's gap-finder, which
has **no cache** and always spends; and the DoD's "admin-vs-member $" with **no Usage card**). Resolved with
the user:

1. **Suggested card spend** — Home shows the **cached** guided suggestions on load (no spend). Generating /
   refreshing guided suggestions, **and** the `08` questionnaire gap-finder (for people who can create
   questionnaires), are **explicit-tap** affordances that spend **only on a deliberate tap** — never on load.
   This satisfies decision #3 (both kinds, clearly labelled) without violating "no model call on load".
2. **Dollars on Home** — the **Continue** card shows a per-session cost via the existing
   `SessionCostIndicator` (09 §14.3): the `$` for `budgets.manage` admins (with `AdminOnlyBadge`), a
   dollar-free budget bar for members. No other `$` on Home (the TopBar dropdown still owns usage totals).
3. **Wellbeing read is deterministic** — the trend's plain-language read ("steadier than last week") is
   computed from the metric points, **not** an AI call, so it always renders (no spend) and works AI-off.
   The card self-hides until there are ≥2 analyzed session Insights; a crisis-flagged recent Insight surfaces
   supportively, leading with resources (§7).
4. **Cards are feature compositions, not new design-system primitives** — they reuse existing primitives
   (Card/Stack/LineChart/FrequencyBars + `GuidedExerciseCard`/`SessionCostIndicator`/`CrisisFooter`), so no
   new `/gallery` entry is required (the charts are already catalogued).

## 12. Changelog

- 2026-06-12 — created (Draft). Package G of the 2026-06 app refresh; decisions captured in memory
  `app-refresh-plan-2026-06`. Built last (consumes `09 §14` + `16`); composes existing stores + chart
  primitives; graceful degradation + getting-started state are first-class.
- 2026-06-12 — Review. Resolved §11: six cards (no Usage card — TopBar owns it); compose from existing stores
  (aggregator later if needed); suggestions = guided sessions + questionnaires; context-aware greeting.
  Build-ready pending final approval + the A/B/C dependencies.
- 2026-06-14 — **Approved + BUILT** (Package G; on `feat/home-dashboard`, off `main`). Replaced the static
  `routes/Home.tsx` with a per-active-person card dashboard under `routes/home/` (container + `ContinueCard` /
  `SuggestionsCard` / `WellbeingCard` / `DreamsCard` / `MemoryCard` / `InboxCard` / `GettingStarted` + pure
  `wellbeing.ts` / `greeting.ts`), composed **on the renderer from existing stores — no new IPC**. Two build
  forks resolved with the user (§13): the Suggested card shows **cached** guided suggestions on load and the
  guided generate/refresh **and** the `08` questionnaire gap-finder are **explicit-tap only** (spend on tap,
  never on load); the Continue card shows per-session `$` via the existing `SessionCostIndicator` (admin `$` +
  badge, member budget bar). The wellbeing read is **deterministic** (no AI). Each card self-hides on empty; a
  brand-new person sees the warm getting-started state; `CrisisFooter` + not-medical line always present; a
  recent crisis-flag surfaces supportively. Exported `toSeed` from `SuggestedPanel` + a router-state seed
  pickup in `Questionnaires` so a Home gap-finder suggestion hands off to the builder. Code-reviewer **ship**
  (applied: bound `hasRecentCrisis` to the latest 3 sessions; removed dead CSS; `overflow-wrap` on the dream
  snippet; ready-gate to avoid an empty-grid flash; dropped the InboxCard head icon; §5 doc drift). Gate green:
  typecheck (node + web/DOM-lib), lint, format, **340 core + 430 desktop + 8 relay** unit (+greeting/wellbeing
  pure helpers, +5 Home RTL), **61 E2E** (+2: getting-started for a new person; a seeded person sees the cards,
  Resume opens the session, 390px inner-scrollbar guard). Visual QA via the web preview at desktop (light +
  dark, the 3-up card reflow) + 390px (single column, no overflow, no console errors). NOT merged (awaiting
  user confirm). **This completes the 2026-06 app refresh (packages A–G).**
- 2026-06-23 — **Enriched the `OnboardingCard`** (an 18 §3.1/§15 surface that, alongside `ProfileFreshnessCard`,
  also renders on Home; gated `intake.own`, per-person, not admin-gated). In progress it now shows scannable
  stats — branch-aware answered/total questions (**excluding intentionally-skipped sections**), sections done
  (complete + skipped), last updated — beside Continue. Once complete it's a calm portrait-health summary that
  nudges a refresh **only when the portrait is stale** (`portraitStaleness` — answers changed since; % changed +
  when updated), and **self-hides when complete and fresh** — **never a calendar clock** (no nagging, matches
  `29`; 18 §15.4). Pending §15 suggestions stay owned solely by `ProfileFreshnessCard` (the OnboardingCard does
  not re-surface them, so the two Home cards don't duplicate). Home-card only (not mirrored to the Onboarding
  page). Pure `intakeQuestionTotals` added to `onboarding/progress.ts`. Renderer-only (no IPC/schema/token).
  Gate green: typecheck, lint, format, unit (+OnboardingCard RTL per state, +`intakeQuestionTotals`), **E2E**
  (+2 home: in-progress stats + 390px overflow guard; complete-stale review). Visual QA at desktop + 360px. On
  `feat/onboarding-card-stats`.
