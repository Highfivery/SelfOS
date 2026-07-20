# 60 — Home dashboard redesign (Hybrid: bento + AI companion + cross-feature feed)

> **Status:** Slices 1 + 2 MERGED (#187) · Slice 3 (polish) in progress · _last updated 2026-07-14_
>
> A **complete redesign of the Home dashboard** now that the app's breadth is built (sessions, dreams,
> Together, questionnaires, memory, tests, wellbeing, challenges, goals, sharing). Home becomes a **highly
> visual, engaging, cross-feature command center**: a quick-action dock, a warm greeting + momentum, a
> **daily AI reflection** (budget-capped, auto-generated once/day, cached) beside a **smart next action**, a
> **bento of feature cards each carrying a real graph**, a **life-rings** whole-life glance, a
> **cross-feature activity feed**, and **sharing highlights** — all with **loading skeletons**, light/dark,
> and responsive ~360px→desktop. This spec **supersedes the Home UX of [`53`](53-home-encouragement.md) and
> [`17`](17-home-dashboard.md)** and **amends 53's non-goals** on gamification and per-load AI spend per the
> owner's explicit decisions (§11.0). It **keeps and extends** 53's deterministic recommendation engine.

This **extends and refactors** — it does not duplicate. It consumes the existing renderer-composed,
per-person, self-hiding-card model (17 §1) and 53's `@selfos/core/recommendations` engine (registry + ranking

- momentum + celebration), and surfaces every feature's **free/cached** reads (the data inventory is exhaustive
  and every feature exposes a deterministic `load()` — no per-load AI needed for the graphs/stats). References:
  [`00`](00-architecture.md)/[`01`](01-design-system.md) (vault/IPC/security; tokens + primitives),
  [`04`](04-people-roles.md) (active person, capabilities, admin `$`-redaction), [`06`](06-ai-usage-and-budgets.md)
  (metering + budgets), [`40`](40-proactive-coaching.md) (`coaching.proactivity`, `aggregateCrisisSignal`, the
  `coaching.synthesize` observation), [`35`](35-notification-system.md) (Toast, coalesced notifications),
  [`41`](41-discoverability-and-empty-states.md) (`discovery:*` device-local dismissals, `AiUnavailableNotice`),
  [`12`](12-dreams.md) (dream patterns), [`20`](20-memory-dashboard.md)/[`44`](44-memory-dashboard-overhaul.md)
  (insights + trends + outbound sharing), [`50`](50-self-assessments.md)/[`51`](51-wellbeing-neurodivergence-reflections.md)
  (tests + wellbeing), [`52`](52-challenge-sessions.md) (challenges), [`58`](58-together-couples-sessions.md)
  (Together summaries/pulse), [`08`](08-questionnaires.md)/[`59`](59-questionnaires-dashboard-section.md)
  (questionnaire overview), [`39`](39-living-memory-continuity.md) (goals) — rather than restating them (DRY).

---

## 1. Overview

The app has crossed a threshold: the **features are built**, but Home hasn't kept up. Today's Home (17 + 53

- 59. is a competent but restrained single-column stack — a greeting, a "For you" list, an onboarding card, a
      questionnaires section, and a 4-card status grid — that under-uses the screen, shows few graphs, and doesn't
      convey the richness of what the app now knows and can do. The owner's goal for this redesign is explicit:
      make Home **way more visual, insightful, engaging, and smart** — a dashboard that shows useful things **across
      every feature**, encourages the person to **start / continue / complete** work (sessions, dreams, Together,
      questionnaires, challenges), surfaces **stats, graphs, memory + sharing highlights, quick actions**, and uses
      **AI + available data** to promote doing things and offer ideas.

This redesign (the **Hybrid** direction, chosen from three full mockups the owner reviewed) delivers:

- A **quick-action dock** (one-tap: start a session, log a dream, ask someone, check in).
- A warm **greeting + momentum + rhythm streak**.
- A **"For you today" band**: a **daily AI reflection** (companion voice — auto-generated once/day within a
  budget cap, cached the rest of the day, explicitly refreshable) beside the **smart next action** (53's
  top-ranked recommendation, elevated).
- A **bento grid of feature cards, each carrying a real graph/stat**: a large **wellbeing mood/energy
  area-chart**, **Together** (turn/unread + pulse rings + alignment), **Questionnaires** (response-rate ring +
  needs-you + who-you-haven't-asked), **Dreams** (recurring-symbol bars + nightmare rate), **Memory** (a
  highlight insight), **Challenge** (comfort + progress), **Sharing** (what you share + insights ready to
  share), plus **stat tiles** (sessions, insights, dreams) with deltas.
- A **right rail**: a **life-rings** whole-life glance (wellbeing / connection / reflection / growth) and a
  **cross-feature activity feed** ("recent across everything").
- **Full-engagement motivation** (the owner's choice): visible **streak/rhythm**, ring **levels/scores**,
  challenge **progress**, and **milestone badges** — with a **hard safety guardrail**: all of it is
  **suppressed/softened during a crisis or recurring-distress signal** (the crisis banner supersedes, and a
  struggling person is never streak-shamed — §8).
- **Loading skeletons** so opening Home is never a blank flash, light/dark, per-person isolation, responsive.

Every stat/graph is fed by an existing **free, deterministic `load()`** — the only new AI spend is the one
capped **daily reflection** (§11.0/§6.2).

## 2. Goals / Non-goals

**Goals**

- **A complete Home visual redesign — the Hybrid layout (§3).** A bento/graph-rich dashboard with an AI
  companion band and a cross-feature feed, replacing the current single-column stack. Sleek, modern,
  intentional (CLAUDE.md §12); full-width (no page `max-width` cap); responsive ~360px→desktop with **no
  horizontal scrollbars**; **loading skeletons** for every async region.
- **Surface every feature with a graph/stat** from its existing free read — wellbeing trend, dream patterns,
  Together pulse, questionnaire response rates, memory highlight, challenge progress, sharing, plus stat tiles.
- **Four new cross-feature elements** (the owner's picks): a **quick-action dock**, a **life-rings** summary, a
  **cross-feature activity feed**, and a **sharing highlights** card.
- **A daily AI reflection** — one **budget-capped** `coaching.synthesize` pass auto-generated **once per day**
  (or on a ≥N-new-signal cadence), cached the rest of the day, with an explicit **Refresh**. This **relaxes**
  53's "no per-load AI spend" rule to a **controlled, capped exception** (§11.0, amends 53 §2/§3.8).
- **Full-engagement motivation** — visible streak/rhythm, ring levels, challenge progress, and milestone
  badges (the owner's choice; **amends** 53's no-streaks/no-gamification non-goal, §11.0) — bounded by the
  crisis guardrail (§8).
- **Keep and extend 53's engine** — reuse `@selfos/core/recommendations` (registry, `rankRecommendations`,
  `computeMomentum`, `pendingCelebration`, the `discovery:*` dismissal seam) for the "smart next action",
  momentum, and celebrations; add pure derivations for the feed, life-rings, and streak.
- **Zero new spend for everything except the daily reflection** — all graphs/stats/feed/rings/streak are
  **pure derivations** over already-loaded stores; only the one daily reflection spends (capped).
- **Additive & safe** — no new vault schema; device-local per-person state (dismissals, celebration + badge
  signatures, last-reflection date) reuses/extends the `discovery:*` / device-state seam; the bridge stays the
  trust boundary; admin-only `$`-redaction preserved.

**Non-goals (deferred / owned elsewhere)**

- **New producers / analytics.** This spec **surfaces** existing signals; it defines no new insight/metric
  producer (the 17/53 discipline). Life-rings + streak are **derivations** of existing data, not new stored
  metrics.
- **Uncapped or per-interaction AI.** The only new AI is the **one capped daily reflection**; recommendation
  ranking, momentum, feed, rings, and streak stay deterministic. No AI on every load, no AI per card.
- **Drag-to-reorder / user-customizable layout.** A single well-designed hierarchy for v1 (17/53 non-goal
  carries forward); customization is a later enhancement.
- **Cross-person / household rollups.** Home is the active person's own overview; per-person isolation
  throughout (single-subject engine).
- **OS/push/scheduled nudges or a main-process cron.** The daily-reflection cadence is **renderer-driven** on
  app events (the 36/40 pattern), throttled device-locally — never a background timer.
- **Re-architecting shell/settings/notifications.** Reuses the chrome (02/03/35); adds Home content + core
  derivations + one settings toggle for the daily reflection.
- **Producing the underlying feature data.** The feed/rings/graphs read what sessions/dreams/Together/
  questionnaires/memory/tests/challenges already emit.

## 3. UX & flows

Home is the active person's overview at `/`, per-person, renderer-composed, each region **self-hides when
empty**, and **skeleton-loads** while its stores resolve. The layout is the reviewed-and-approved **Hybrid**
(see the mockup artifact). Full-width content, no page `max-width` cap (CLAUDE.md §12).

### 3.1 Top to bottom (desktop)

1. **Header — greeting + momentum + rhythm.** Time-of-day + name greeting; a gentle **momentum reflection**
   ("you showed up 4 times this week · explored 6 life areas · 2 goals moving"); and a **rhythm streak** pill
   ("🔥 12-day rhythm"). The streak is a **positive, never-shaming** count of consecutive days with _any_
   activity (§3.7 / §8). During a crisis signal the streak pill is hidden (§8).
2. **Quick-action dock.** A row of one-tap starters, each capability-gated (so it never shows a dead action):
   **Start a session** (`sessions.own`), **Log a dream** (`dreams.own`), **Ask someone** (send a questionnaire,
   `questionnaires.create`), **Check in** (a mood check-in, `tests.own`). Each routes into the right surface.
3. **Crisis / support (supersedes everything).** When `aggregateCrisisSignal` reports recurring distress (40
   §3.5), the **`CrisisSupportBanner`** leads (resources-first), above the band and all pushes; the streak,
   life-rings scores, badges, and the "For you" band are suppressed/softened (§8). Unchanged 40 behaviour.
   3a. **"Needs attention" (§3.1.2a) — the waiting-on-you queue.** A scannable list of the concrete things awaiting
   the person, **split by intent** from the growth-oriented "For you" band so the same item never nags in two
   places (the overlapping recommendation ids — `stale-goal` / `wellbeing-checkin` / `together-session` /
   `questionnaire-gap` — are filtered OUT of "For you" and surfaced here instead). Ordered by urgency: a
   **Together turn** / **invite** (someone's waiting) → a **response to analyze** (`newResponses`) → **insights to
   review** (draft insights) → **standing Together agreements** (spec 61) → **your goals** → the **weekly mood
   check-in** reminder (≥7 days, the owner's "at least once a week" — only for someone who has checked in before)
   → a soft **"ask someone"** send-a-questionnaire nudge (a prior send ≥30 days old). Each row deep-links to where
   the action happens. Leads **above** "For you"; self-hides when clear; per-person. **Your goals** (every ACTIVE
   goal — framed "needs a check-in" when stale, else "in progress") and **Together agreements** are GENUINE
   (non-nudge) items — your own concrete commitments, so they **ALWAYS show**: neither a proactivity-off dial NOR
   a recurring crisis signal hides them (updated 2026-07-14 on repeated user feedback — a crisis signal was
   silently suppressing them, the exact bug the user hit; they're grounding, not AI pushes, and the crisis banner
   - resources already lead Home with support, so there is no need to hide the person's own gentle commitments).
     They clear as goals/agreements are marked done. Only the **check-in** and **"ask someone"** are gentle
     **nudges**, dropped under recurring crisis OR proactivity-off (§8), along with the "For you" growth band. The
     truly-pending items (turn / invite / responses / review) always show. Pure derivation (`needsAttention`).
4. **"For you today" band** — two cards side by side:
   - **Daily reflection (AI companion).** The cached `coaching.synthesize` observation in a warm companion
     voice ("Rest and self-worth keep circling each other for you this week — and you came back to Angel,
     which matters."). **Auto-generated once/day** when AI is configured + budget allows + there are ≥N new
     signals (§6.2); cached + shown the rest of the day; an explicit **Refresh** re-generates (metered). The
     cost figure is **admin-only** (members never see `$`). AI-off/over-budget → the reused `AiUnavailableNotice`
     (never a dead button).
   - **Smart next action.** 53's top-ranked recommendation, elevated into a focal card ("Continue 'Boundaries
     with Dad'" with its reason + one primary CTA + a calm "Not now" dismiss).
5. **Overview bento (the left column) — "where you are", each with a graph/stat:**
   - **Stat tiles** — Sessions (7d, Δ), Insights (Δ + "N need review"), Dreams (30d, Δ). Compact,
     `tabular-nums`, delta chips (up = success tone, never a "you're down" scold).
   - **Wellbeing** (hero) — a **mood + energy area line-chart** (the existing `LineChart` / a token-driven area
     chart) over recent sessions' `moodValence`/`moodEnergy` + PHQ-9 check-in points, a gentle "lifting/steady"
     read, and "next check-in suggested in N days" (never "overdue").
   - **Together** (hero, when a live partner edge exists) — turn/unread status, a **connection pulse ring**, and
     **desire alignment** ("aligned" only under dual consent, 58), one CTA. Self-hides with no partner.
   - **Questionnaires** (hero) — a **response-rate ring**, "N new answers · needs you", "haven't asked: <names>",
     and an **idea** ("Send Angel a 'fun' check-in") — reusing the 59 section's data. Reconciled with the 59
     section (§3.6).
   - **Dreams** — recurring-symbol **frequency bars** (`FrequencyBars`) + nightmare-rate + lucid chips.
   - **Memory** — a **highlight insight** (a recent high-confidence fact) + confidence chip.
   - **Challenge** — the active challenge, **comfort dial** + **progress bar** (day N of M) + a check-in CTA.
   - **Goals** (§3.1.3) — encourages a person to SET, SEE, MOVE, and COMPLETE goals from Home: a completion
     `ProportionBar`, the active goals that most want attention (stale-first) each with a one-tap **Done** /
     **Still on it**, an inline **+ New goal** (`goalsCreate`), and — AI-configured — a metered **Suggest goals**
     tap (`goalsSuggest`, `goal.suggest`) that proposes 2-3 tailored goals to accept/dismiss (explicit tap only,
     no per-load spend, persists nothing). Empty state invites the first goal; "See all" opens Memory. Crisis
     hides the completion bar + AI suggest (§8), keeping the calm list + create.
   - **You** (§3.1.4) — a window into the self-assessments hub (50/51): **profile highlights** (a signature
     subscale from the latest results — nothing else on Home shows these) and **take-a-test** invites (the lead
     when no results). The mood/anxiety **check-in reminder lives in "Needs attention"** (§3.1.2a) — highlighted
     in one place, not nagged twice. Deep-links straight to the take flow / hub; self-hides when there's nothing
     to say.
   - **Sharing** — "sharing N things — Angel (4) · Mom (2)" + "1 new insight ready to share" (from
     `memoryOutboundSharing`, 44).
6. **Right rail:**
   - **Life-rings** (§3.1.6) — a whole-life glance of a few derived rings (**Wellbeing / Connection / Reflection**,
     and optionally **Growth**), each a shared **SVG progress ring** (`Ring` — a visible track + a rounded arc,
     the % inside) with a text level word below (Quiet / Warming / Steady / Active / Thriving) so meaning is never
     color-only (§9). Framed as "a reflection of your check-ins, sessions & Together — not a score to chase."
     Softened during crisis (§8): the arc is dropped and a soft **heart** sits in the ring with only the
     supportive level word — a calm, intentional snapshot, **never an empty circle** (the SVG replaced a
     low-contrast conic-gradient that read as blank on the cream ground). The **Together pulse ring shares
     `Ring`** and shows the connection **%** inside (a narrow numeric that fits, not a squished level word),
     with the trend in the label below.
   - **Activity feed** — "recent across everything": a time-sorted, deduped stream of cross-feature events
     (Angel replied · Mom answered your check-in · new insight needs review · challenge check-in due · logged a
     dream · mood check-in). Actionable items are visually marked and route on click; the feed scrolls **inside
     its own card** (capped height, `overflow-y:auto`), never the page (§9/§12).
7. **Celebration + milestone badges.** A completion (finished onboarding, wrapped a session, took a test,
   finished a challenge, completed a goal, **hit a rhythm/breadth milestone**) shows a warm **once-only**
   celebration (spec-35 Toast or a brief card) and may award a **milestone badge** (full engagement). Never
   above the crisis banner; never a "you lost X".
8. **Getting-started (brand-new person)** — a warm one-path getting-started replaces the bento; the band,
   momentum, streak, rings, and feed are suppressed until there's real data (§7).
9. **First-run orientation + footer.** `WelcomeOrientationCard` (shown once) + the always-present `CrisisFooter`
   - not-medical line (the wellbeing-surface rule, 17 §7 / 05 §7).

### 3.2 Loading skeletons

Every async region renders a **skeleton** placeholder (shimmer blocks matched to the card's footprint) while
its store resolves, so opening Home is never a blank flash and never a layout jump when data lands. Skeletons
respect `prefers-reduced-motion` (a static muted block, no shimmer). Regions skeleton **independently** (the
band, each bento card, the rings, the feed) so fast reads paint immediately and slow ones fill in. Once a
region's store reports loaded + empty, it self-hides (no skeleton lingering).

### 3.3 Responsive

- **≥ ~1160px:** the left bento + right rail sit side by side; the bento is a 2-col dense grid with a
  full-width wellbeing hero.
- **~720–1160px:** the right rail (rings + feed) drops **below** the bento as a wrapping row; the bento stays
  2-col.
- **≤ ~720px (phone):** one column; the quick-dock actions stack; the band stacks (reflection over next
  action); every card full-width; the feed keeps its internal scroll. No horizontal scrollbars anywhere; tap
  targets ≥44px.

### 3.4 Empty / satisfied states

Each card self-hides on empty; the "For you" band's next-action shows a calm satisfied line ("you're all set
for now") rather than a forced suggestion when nothing ranks; the feed hides when there's no recent activity;
life-rings hide until there's at least one contributing signal. Never a nagging empty state.

### 3.5 Interaction details

Quick-dock + card CTAs route into the owning surface (or seed a handoff, e.g. the reflection's "Talk it
through" seeds a session — the 53 precedent). The next-action "Not now" dismisses per-person (device-local,
re-surfaces only when its signal changes). The daily-reflection **Refresh** is the one interaction that can
spend (metered, budget-gated). Nothing else on Home spends.

### 3.6 Reconciliation with the existing Home (53/59)

The current `Home.tsx` composes: `MomentumLine`, `CrisisSupportBanner`, `ForYou`, `OnboardingCard`,
`QuestionnairesSection`, `GettingStarted`/(grid of `ContinueCard`/`WellbeingCard`/`DreamsCard`/`MemoryCard`),
`WelcomeOrientationCard`, `CelebrationMoment`, `CrisisFooter`. The redesign **re-homes** each into the Hybrid
layout — nothing is dropped, several are elevated:

| Today (component)                                                  | After (in the Hybrid)                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| greeting + `MomentumLine`                                          | Header greeting + momentum **+ rhythm streak** (§3.1.1)                                                                                        |
| `CrisisSupportBanner` (40)                                         | **Unchanged**, explicit top slot; suppresses pushes/streak/badges (§3.1.3/§8)                                                                  |
| `ForYou` (53 ranked recs)                                          | **Split**: the top rec → the band's **smart next action**; remaining recs → a compact "more for you" strip under the band (proactivity-scaled) |
| synthesis observation (40)                                         | The band's **daily reflection** — now **auto-daily + capped**, not just cached-on-tap (§6.2)                                                   |
| `OnboardingCard` (18 §15)                                          | **Stays** as a status surface while intake is incomplete/stale (self-hides when done)                                                          |
| `QuestionnairesSection` (59)                                       | **Folded** into the bento's **Questionnaires hero card** (its stats/needs-you/ideas), so it isn't a separate full-width band                   |
| `ContinueCard`/`WellbeingCard`/`DreamsCard`/`MemoryCard`           | The **bento** (each gains a graph/stat, §3.1.5)                                                                                                |
| `CelebrationMoment`                                                | **Stays** + **milestone badges** (§3.1.7)                                                                                                      |
| `GettingStarted` / `WelcomeOrientationCard` / `CrisisFooter`       | **Unchanged** (getting-started suppresses the bento; orientation once; footer always)                                                          |
| _(new)_ quick-action dock, life-rings, activity feed, sharing card | New (§3.1.2/§3.1.6/§3.1.5)                                                                                                                     |

## 4. Data model (vault files & schemas)

**No new vault files. No vault schema change.** Everything visual is **derived** on the renderer from data
Home already loads (the 17/53 model). Persisted state is **device-local + per-person**, reusing the
`discovery:*` seam / `DeviceState`:

- **Dismissals + celebration + badge signatures** — device-local per-person, in `DeviceState.discoveryDismissals`
  (41 §4, keyed by the active person in the bridge). Keys: `rec:<id>`, `celebrate:<signature>`, and (new)
  `badge:<milestoneId>` so a milestone badge is awarded/celebrated **once**. Additive keys in the same blob —
  no schema bump, no migration (pre-60 vaults simply have none).
- **Last daily-reflection date + signal-count** — a device-local per-person marker so the reflection
  auto-generates **at most once per day** and only when ≥N new signals since the last one (§6.2). Stored as an
  additive-optional device-state field (or a `reflection:<date>` discovery key) — additive, no migration.
- **View types** in `@selfos/core` (not persisted): the existing `Recommendation`/`PersonRecommendationState`/
  `MomentumReflection`/`Completion` (53) **plus** new pure view types `ActivityEvent`, `LifeRing`, `StreakInfo`,
  `MilestoneBadge` (§5). Zod-first where they cross a boundary; plain interfaces for pure-renderer derivations.
- **Everything else is read** via existing free IPC (§6.1) and stores (the inventory): `conversationStore`
  (+status +costs), `insightStore` (+ `memoryOutboundSharing`), `dreamStore` + `dreamPatternStore`, `inboxStore`,
  `questionnaireStore` (`sentOverview`/`sendStates`), `goalStore`, `challengeStore`, `testStore`
  (`resultsByTest`), `togetherStore` (+ `togetherPulse`), `guidanceStore`, `synthesisStore`, `budgetStore`.

All device-state reads/writes go through the existing device-state IPC; the bridge keys everything under the
active person (per-person isolation).

## 5. Architecture & modules

A **renderer** Home redesign composing existing stores, plus a handful of **pure `@selfos/core`** derivations
(testable, host-agnostic). No new feature module, no new nav/route (Home is `/`). One new spend path (the
daily reflection cadence, §6.2). One new settings toggle (§6.3).

### 5.1 New pure core derivations (`@selfos/core`)

Added alongside 53's `@selfos/core/recommendations` (or a sibling `@selfos/core/home` module — §11.1), each
**pure, synchronous, no AI, no I/O**, deriving from state the renderer already assembled:

- **`buildActivityFeed(input): ActivityEvent[]`** — merges recent cross-feature events into one time-sorted,
  deduped, capped list. Sources: session updated/wrapped (conversations), dream logged (dreams), insight
  ready/needs-review (insights), questionnaire answered / new response (sentOverview + inbox), Together
  your-turn/reply (together summaries), challenge check-in due / done (challenges), goal done (goals), mood
  check-in (test results). `ActivityEvent = { id, domain, icon, title, detail?, at, route?, actionable }`.
  Bounded window (e.g. 14d) + top-N.
- **`computeLifeRings(input): LifeRing[]`** — a few whole-life rings from existing signals. `LifeRing = { key:
'wellbeing'|'connection'|'reflection'|'growth', label, value: 0..1, levelLabel, tone }`. Wellbeing ← mood
  trend direction/level; Connection ← Together activity + pulse (or people breadth); Reflection ← session/dream
  cadence; Growth ← distinct life-areas + goals moving. **Full engagement** surfaces `value` as a level/score;
  a text `levelLabel` is always present (§9). Crisis softens (§8).
- **`computeStreak(input): StreakInfo`** — `{ days, since }` consecutive days with any activity (sessions,
  dreams, check-ins, questionnaire answers, together, challenge check-ins). **Positive-only**: no "broken",
  no "you missed", no gap count. A quiet day simply ends the current run; the UI never shames it (§8).
- **`activeMilestones(input, awarded): MilestoneBadge[]`** — pure milestone detection (e.g. first week of
  rhythm, 10 sessions, 5 areas explored, first challenge done). Returns newly-earned, un-awarded badges to
  celebrate once (the caller records `badge:<id>` — §4).
- **`quickActions(capabilities): QuickAction[]`** — the capability-gated dock config (label, icon, route,
  gate), so the dock never renders a dead action.

53's existing `rankRecommendations` / `computeMomentum` / `pendingCelebration` are reused unchanged for the
band's next-action, the momentum line, and celebrations. **Full-engagement note:** `computeMomentum`'s
positive-only type is preserved; the **streak/badges are the additive gamification layer** (opt-in by the
owner's choice) and live in these new derivations, keeping momentum's no-gap guarantee intact.

### 5.2 Renderer — the Hybrid Home

`Home.tsx` is restructured into the §3.1 hierarchy. It keeps the existing single per-active-person load
effect (loads every store; resets on `activePerson.id` change — the isolation rule) and adds the new pure
derivations over the assembled state. New presentational components (reusing `Card`/`Stack`/`Inline`/`Text`/
`Button`/`LineChart`/`FrequencyBars`/`TrendLine`/`ProportionBar`/`SubscaleBar`/`ComfortDial`/`Toast` +
`ConfidenceChip`/`ChallengeStatusChip`/`ScopeBadge`):

- `QuickActionDock`, `RhythmStreak`, `ForYouBand` (reflection + next action), `DailyReflectionCard`,
  `StatTile`, `WellbeingChartCard`, `TogetherCard`, `QuestionnairesCard` (folds the 59 data), `DreamsCard`,
  `MemoryHighlightCard`, `ChallengeCard`, `SharingCard`, `LifeRings`, `ActivityFeed`, `MilestoneBadge`, and a
  shared `CardSkeleton` (§3.2).
- Genuinely-new visual primitives (e.g. an **area line-chart** variant, a **life-ring** component, a
  **milestone badge**, a **card skeleton**) are added to `/gallery` (DoD §12). Prefer reusing/extending
  existing primitives; only truly new patterns get catalogued.
- Admin `$` stays **bridge-redacted** — the reflection cost + any session cost render only for
  `budgets.manage`, with an `AdminOnly` marker; everyone else sees `budgetRatio`/tokens or nothing (04).
- **Per-person isolation** — new device-local dismissal/celebration/badge/reflection state is read
  per-active-person via the existing `discovery:*` bridge (keyed in the bridge).

### 5.3 The daily-reflection cadence (renderer-driven, capped)

A small renderer hook (the 36/40 pattern, no cron): on Home load, when AI is configured, `proactivity !==
'off'`, budget is OK, there is **no cached reflection for today**, and there are **≥N new signals** since the
last reflection, it calls the existing metered `coaching.synthesize` **once**, stamps the device-local
last-reflection date, and caches. Any other launch that day re-displays the cache for free. **Refresh** is an
explicit re-generate (metered, budget-gated). All the guards (AI-off, over-budget, distress) short-circuit to
"no auto-generate; show cache or the calm unavailable notice" — never a silent repeated spend. This is the
**only** new spend and is bounded to ≤1 auto-pass/day (+ explicit refreshes) — §6.2/§11.0.

## 6. IPC / API contracts

### 6.1 Reused reads (no new channels for the visual layer)

All graphs/stats/feed/rings/streak/sharing compose from existing **free** IPC + stores (the inventory):
`conversations:list` (+status, +`usageSessionCosts`), `dreams:list`, `dreamPatternStats`, `insights:list` +
`memoryOutboundSharing`, `assignments:inbox`, `questionnaires:sendStates`/`sentOverview`, `goals:list`
(+`goals:setStatus` for the next-action's preserved actions), `challenges:list` + `challengesGetSuggestion`,
`tests:list`/`tests:results`, `together:list` + `together:pulse`, `guided:getState`, `coaching:getSynthesis`/
`getPrefs`, `budget:status`. Recommendation/celebration/badge dismissals reuse the `discovery:getDismissals`/
`setDismissals` seam (device-local, per-person, keyed in the bridge). The visual redesign needs **no new IPC**.

### 6.2 Claude API — the one new spend (daily reflection)

Reuses the **existing** `coaching:synthesize` (40) — model, prompt, streaming, metering (`coaching.synthesize`
usage type), budget gate, and tolerant parse are **unchanged**. What's new is only the **cadence**: an
auto-trigger at most **once/day per person**, gated on AI-configured + `proactivity !== 'off'` + budget-OK +
≥N-new-signals + no-crisis, tracked by a device-local last-reflection marker (§4). No new usage type, no new
channel; the key stays in main. A hard per-day cap (1 auto + explicit refreshes) prevents runaway cost. **This
amends 53 §3.8's "no synthesis on load" to "≤1 auto-synthesis/day on load, capped."** (§11.0.)

### 6.3 One new setting

`home.dailyReflection` (boolean, **default on**, per-person or vault-scoped — §11.4) gates the auto-generate
cadence (§6.2). When off, the reflection card shows the last **cached** value + explicit Refresh only (53's
original behaviour) — no auto-spend. Admin-visible cost note reused from 06. Added via the settings registry
(one declaration).

## 7. States & edge cases

- **Loading** — each region shows a **skeleton** until its store resolves (§3.2); no blank flash, no layout
  jump. The whole page has a `ready` gate for the derivations that need multiple stores.
- **Brand-new person** → getting-started only; band/streak/rings/feed/badges suppressed (§3.1.8/§7).
- **Proactivity off** → no band pushes (the next-action + more-for-you strip hidden), no auto-reflection, no
  streak-pushiness; the status bento + rings (as a calm reflection) + feed still render. Crisis unaffected.
- **Crisis / recurring distress** → `CrisisSupportBanner` leads; the band's pushes, streak pill, milestone
  badges, and celebration are **suppressed**; life-rings **soften** to a supportive, score-free presentation;
  status cards (mood trend etc.) still render (they reflect reality, don't push). §8.
- **AI off / over budget / offline** → all deterministic content (graphs, feed, rings, streak, stats, next
  action) renders; the daily-reflection card shows its **cached** value or the role-aware `AiUnavailableNotice`
  (owner → Settings → AI; member → ask the owner) — never a dead button, never an auto-spend attempt.
- **Capability / 18+ gated** → quick-dock actions, bento cards, and recommendations for a missing capability or
  un-acked 18+ **never render** (bridge returns empty + the reactive `can(...)` filter); a grant/ack makes them
  appear live.
- **Empty per card / satisfied** → each card self-hides; the next-action shows a calm satisfied line; the feed
  hides with no recent activity; rings hide with no signal (§3.4).
- **Admin `$`** → cost figures render only for `budgets.manage` with an AdminOnly marker; members see
  `budgetRatio`/tokens or nothing (04 redaction, verified at the bridge, not just the UI).
- **Person switch** → Home resets + reloads per-active-person; derivations recompute; prior-person in-flight
  celebration/reflection state cleared (the isolation + async-race guard).
- **Dismissed next-action / celebrated completion / awarded badge** → recorded device-local per-person;
  re-surfaces only when its underlying signal changes; a badge/celebration fires once.
- **Corrupt/missing device-local state** → treated as "nothing dismissed/celebrated/awarded, no reflection
  yet" (fails open to harmless defaults), never crashes a Home render.
- **Concurrent edits / sync conflicts** — N/A for new persisted content (only device-local, non-synced state);
  vault sync conflicts surface via the existing 35 notification unchanged.
- **Migration** — none (no vault schema change; device-state fields additive-optional; pre-60 vaults default).
- **360px** — no element with `overflow-x:auto|scroll` exceeds its client width; the full surface (dock →
  band → bento → rings → feed → footer) renders to the bottom; the feed's internal scroll is the only scroll
  region (CLAUDE.md §7/§12).

## 8. Safety

A wellbeing surface that now leans into **engagement + gamification**, on an app holding mood/anxiety/intimacy
data — so the safety design is paramount (CLAUDE.md §1, 05 §7, 40 §8, 51 §8, 53 §8). The owner chose full
engagement; these guardrails make that safe:

- **The crisis guardrail (hard, non-negotiable).** When `aggregateCrisisSignal` reports recurring distress (40
  §3.5): the **`CrisisSupportBanner` leads** (resources-first, never dismissible, never governed by the
  proactivity dial); **all pushes are suppressed** (band next-action, more-for-you, daily auto-reflection,
  celebrations); the **streak pill, milestone badges, and ring scores are hidden/softened** — a struggling
  person is **never** shown a streak, a score, or a "you're behind." Growth is never pushed at someone in
  crisis; Home offers support and routes to professional help. Enforced in the pure derivations (a crisis flag
  short-circuits streak/rings/badges) + tested (§10).
- **Full engagement, but never punishing.** Even outside crisis: the streak is **positive-only** (no
  broken-streak shaming, no "you lost your streak", no missed-day count); ring scores are framed as "a
  reflection, not a score to chase" with reflective (not competitive) language; badges celebrate **effort +
  growth**, are never revocable, and there are no leaderboards or social comparison. `computeMomentum` keeps
  its no-gap type. Ignoring any invitation produces **no** consequence.
- **Wellbeing check-ins stay gentle invitations, never a schedule.** The check-in quick-action + the wellbeing
  card's "next check-in suggested in N days" are soft (51 §3.4) — never "overdue", never escalating, never a
  watcher. A person who doesn't check in is never nudged harder.
- **Not medical / not therapy.** The not-medical line + `CrisisFooter` stay always-present (17 §7). The daily
  reflection is a reflective observation, not a treatment plan/score/assessment; the AI voice inherits the 05
  §7 / 40 §8 safety persona + crisis routing unchanged.
- **Privacy is sacred + per-person.** Home reads only the **active person's own** state; feed/rings/sharing
  reasons reveal nothing cross-person and **never imply an owner/admin can see a person's content** (the
  durable rule, CLAUDE.md §1). The Sharing card surfaces the person's **own** outbound sharing (what _they_
  share), framed honestly (44), never "who can see you". 18+/intimacy recommendations + Together cards stay
  gated by the person's own ack + a live partner edge. Admin `$` stays redacted. The bridge is the trust
  boundary for all device-local state.
- **Honest, calm signals.** No fake urgency, no manufactured scarcity, no dark patterns; a satisfied/empty
  state reads as calm, not as failure.

## 9. Accessibility

Per [`01 §9`](01-design-system.md), inheriting 17/35/40/41/53:

- **Heading order** — one `<main>`: greeting `h1`; the band, each bento card, rings, and feed titled `h2`;
  labelled regions. Skeletons carry `aria-busy`/`aria-hidden` so SR users aren't read shimmer.
- **Every stat/graph has a text equivalent** — charts (`LineChart`/area/`FrequencyBars`/`TrendLine`/rings)
  carry an `aria-label` + on-screen text (the value/direction as text), never color-only (§8 rings always show
  a `levelLabel`; deltas show the number + direction word, not just a colored arrow). Streak + badges are text.
- **Cards are keyboard-operable** — every CTA is a real button/link with a clear accessible name (domain
  context, not "Open"); visible focus; icons `aria-hidden`. Dismiss controls keyboard-reachable + named.
- **Activity feed** — a list with keyboard-reachable actionable items; its internal scroll region is
  keyboard-scrollable and doesn't trap focus.
- **Motion** — card entrances, skeleton shimmer, celebration/badge animations respect
  `prefers-reduced-motion` (static, content fully present without motion); a celebration toast follows 35's
  `aria-live` + pausable rules.
- **Responsive ~360px→desktop** — reflows to one column; no horizontal scrollbars (CLAUDE.md §12); tap targets
  ≥44px. New primitives → `/gallery`.

## 10. Testing strategy

Vault + Claude mocked as established; `pnpm typecheck` after tests (`vitest-does-not-typecheck`). Drive
complete flows through the rendered UI, not bridge calls (CLAUDE.md §7). E2E is written **and run** (memory:
`always-run-e2e`).

- **Unit (Vitest) — the pure derivations:**
  - `buildActivityFeed` merges/sorts/dedupes/caps; maps each source to the right domain/route; excludes
    stale/empty; an actionable item is flagged.
  - `computeLifeRings` derives each ring's value/level from the right signals; a missing signal → ring absent;
    **crisis softens** (no numeric score exposed). `computeStreak` counts consecutive active days;
    **never returns a gap/broken/miss**; a quiet day ends the run without a negative field (type-enforced).
  - `activeMilestones` returns only newly-earned, un-awarded milestones; already-awarded are not re-emitted.
  - `quickActions` filters by capability (a missing gate ⇒ action absent).
  - **Crisis guardrail:** with a crisis flag, streak/rings-scores/badges/pushes are all suppressed by the pure
    layer (the safety-critical test).
  - 53's engine reused: `rankRecommendations`/`computeMomentum` behaviour unchanged (no regression).
- **Component (Vitest + RTL):**
  - `Home` renders the Hybrid hierarchy; each region **skeletons** while loading then paints; empty regions
    self-hide; the next-action + more-for-you come from the ranked recs; the daily reflection shows cached +
    Refresh; the questionnaires card folds the 59 data.
  - Proactivity-off ⇒ no band pushes, no auto-reflection, rings/feed still render. Crisis ⇒ banner leads +
    streak/badges/scores hidden + no celebration + rings softened.
  - Admin sees the reflection `$` + AdminOnly marker; a member does not (redaction).
  - Charts/rings/deltas render a **text equivalent** (assert the text, not color).
  - A `CardSkeleton` renders with `aria-busy` and is replaced on load; reduced-motion → no shimmer.
- **E2E (Playwright):**
  - A person with rich state lands on Home → sees the dock, band (reflection + next action), wellbeing chart,
    Together/questionnaires heroes, dreams/memory/challenge/sharing, life-rings, and the activity feed; a
    dock/CTA routes into the right surface; the feed's actionable item routes.
  - **Skeleton path:** with slowed reads, skeletons show first, then real content (no blank flash) — asserted.
  - **Crisis seed:** banner leads; streak/badges/ring-scores/pushes absent; rings softened; no celebration.
  - **Proactivity-off:** band pushes + auto-reflection absent; rings/feed/status present.
  - **Daily reflection cadence:** first load auto-generates once (one metered call) + caches; a second same-day
    load does **not** re-spend (shows cache); Refresh re-generates; AI-off shows the notice, no spend.
  - **Admin vs member `$`** on the reflection cost (redaction).
  - **360px guards:** no `overflow-x` element exceeds client width on Home at 360px; the full surface renders
    to the bottom; only the feed scrolls internally. **Visual-QA** Home at desktop + 360px, light + dark —
    reads as one designed whole.

## 11. Open questions

### 11.0 Resolved by the owner (2026-07-13) — this spec's founding decisions

- **Direction = Hybrid** (Atlas bento + graphs + Pulse AI companion + cross-feature feed). ✔
- **AI = one budget-capped auto-reflection/day**, cached + explicitly refreshable — **amends 53 §2/§3.8's
  "no per-load AI spend"** to a controlled ≤1/day exception. ✔
- **New elements = all four**: cross-feature activity feed, life-rings, quick-action dock, sharing highlights. ✔
- **Hero = all four**: smart next action, wellbeing graphs, Together, questionnaires. ✔
- **Engagement = full** (streaks, ring levels/scores, challenge progress, milestone badges) — **amends 53's
  no-streaks/no-gamification non-goal** — **bounded by the crisis guardrail** (§8). ✔
- **Loading skeletons** required. ✔ · **Replaces** the current Home wholesale. ✔

### 11.1 Still to confirm (proposed defaults in brackets — resolve during review/build)

- **Module home for the new derivations** — RESOLVED (Slice 1): a new **`@selfos/core/home`** module
  (`quickActions` / `computeStreak` / `computeLifeRings` / `buildActivityFeed` + view types); 53's engine
  (`rankRecommendations` / `computeMomentum` / `pendingCelebration`) is reused unchanged.
- **Life-rings set** — RESOLVED: **four** (Wellbeing / Connection / Reflection / Growth), each present only
  when it has a contributing signal.
- **New visual components — `/gallery`?** RESOLVED (Slice 1): the new visuals (life-rings, activity feed,
  stat tile, rhythm streak, quick-dock, card skeleton, daily-reflection card) are kept **route-local** under
  `routes/home/` — matching the existing home-card pattern (`WellbeingCard`/`DreamsCard`/… are route-local, not
  `/gallery` primitives). No visual was promoted to a shared design-system primitive, so **no `/gallery`
  change** this slice; if one graduates to a shared primitive later, it's catalogued then.
- **Ring scale semantics** — RESOLVED (owner, 2026-07-13): **both** — a level word headline (Dormant→Thriving)
  **plus** the % underneath, on a filled ring.
- **Streak definition** — RESOLVED: **any meaningful action** (session update / dream / mood check-in /
  questionnaire answer / Together message / challenge check-in); a live run of **≥2** consecutive days shows
  the pill; positive-only, crisis-suppressed.
- **Milestone badge set** — which milestones, and are they shown anywhere persistent (a badges shelf) or just
  celebrated once? [**celebrate once on Home** for v1; a persistent badges shelf (maybe on `/you`) is a later
  enhancement — flag, don't build.]
- **`home.dailyReflection` scope + cadence N** — per-person vs vault; how many "new signals" trigger an
  auto-reflection; the per-day cap. [**per-person, default on; N≈3 new signals; ≤1 auto/day + explicit
  refreshes.**]
- **Slice plan** — see §11.2; confirm the ordering.
- **Anything the owner wants added/removed** from the bento or the feed's event set.

### 11.2 Proposed slice plan (each a shippable PR, gate-green + E2E)

- **Slice 1 — the Hybrid shell + skeletons + all deterministic content.** Restructure `Home.tsx` into the
  Hybrid layout; the quick-dock, greeting + momentum + **streak**, the band (next action + **cached**
  reflection), the bento with every graph/stat (wellbeing chart, Together, questionnaires-folded, dreams,
  memory, challenge, sharing, stat tiles), the right rail (**life-rings** + **activity feed**), loading
  **skeletons**, responsive, crisis guardrail. New pure core derivations (`buildActivityFeed`/`computeLifeRings`/
  `computeStreak`/`quickActions`) + components + `/gallery`. **No new spend** (reflection is cache-only this
  slice). Delivers the entire visual redesign.
- **Slice 2 — the daily-reflection cadence + setting + badges. BUILT.** The daily auto-`synthesize` cadence
  (§5.3/§6.2 — reused the existing `useCoachingSynthesis` hook + bridge gate, amended `CADENCE` to a 1-day
  window), the per-person `CoachingPrefs.dailyReflection` toggle + crisis suppression, and `activeMilestones` +
  milestone badges via the existing celebration flow. The one new-spend slice.
- **Slice 3 (optional polish) — full-engagement refinements** surfaced during review (ring interactions,
  badge visuals, feed depth) if not absorbed into Slice 1.

## 12. Changelog

- 2026-07-14 — **Follow-up 4 (a recurring crisis signal was silently hiding your goals + agreements — the real
  root cause; on `fix/needs-attention-crisis-shows-commitments`).** After Follow-up 3 shipped in v0.24.0, the user
  (on the fresh build — confirmed by the new "It's your turn with Angel" queue item) STILL saw only "It's your turn"
  - "6 insights to review", with their Goals card clearly showing a Together commitment + two in-progress goals.
    **Diagnosed by elimination (not assumed):** `together-turn` and `review-insights` (not crisis-gated) rendered,
    while the `agreement` and `goals` items — the ONLY two gated on `!input.crisis` — did not, despite the data
    existing. So `aggregateCrisisSignal(...).recurring` was true for them, and the `!crisis` gate I'd added (in #198,
    extended to goals in Follow-up 3) was suppressing exactly what they asked to see. **Fix:** the person's OWN
    commitments (goals + Together agreements) now **always show** — the `!input.crisis` gate is removed from both, and
    the now-unused `crisis` `AttentionInput` field is dropped (crisis still suppresses the true nudges via
    `suppressNudges` + the "For you" band). They're grounding, not AI pushes, and the crisis banner already leads Home
    with support. Tests: attention + Home units inverted (goal/agreement now VISIBLE under crisis) and a new E2E seeds
    a recurring crisis + a standing agreement + an active goal and asserts the support banner leads AND both
    commitments render in "Needs attention" (For-you suppressed). Real-Electron screenshot verified. Gate green:
    typecheck, lint, format, 96 home unit, affected E2E (crisis-shows-commitments, spec-61, proactivity-off,
    crisis-banner, stale-goal). **Lesson: "lead with support during a crisis" means suppress AI PUSHES (the growth
    band + gentle nudges), NOT the person's own gentle commitments — hiding someone's goals/agreements behind a crisis
    flag reads as the app erasing their stuff exactly when they look for grounding; the crisis banner + resources are
    the support, the commitments are allowed to stay.**
- 2026-07-14 — **Follow-up 3 (goals + Together reflections must show in "Needs attention" — user-reported,
  escalating; on `fix/needs-attention-goals-agreements`).** The user (furious) kept seeing ONLY "N insights to
  review" in the queue — no goals, no Together agreements — because their **proactivity dial is off**, which
  drops every nudge-tier item, and goals only reached the queue as a `stale-goals` **nudge** (so even a stale
  goal was hidden, and an in-progress goal never surfaced at all). Fix (§3.1.2a): **your goals are now a genuine
  (non-nudge) `goals` item** — every ACTIVE goal (open / in-progress / already-stale), framed "needs a check-in"
  when stale else "in progress", showing the goal text — so they stay **top of mind regardless of the
  proactivity dial**, matching the spec-61 agreement item (both suppressed only under recurring crisis). The
  `stale-goals` kind → `goals`; the block moved above the check-in nudge; the `stale-goal` For-you rec is still
  filtered out so nothing double-nags. Tests: attention unit (active/stale framing, non-nudge, crisis-suppressed,
  done/abandoned excluded), Home + proactivity-off unit inverted (goal now STAYS), and the spec-61 E2E extended
  to seed a personal goal + assert **both** the agreement AND the goal render in "Needs attention" together. Gate
  green: typecheck, lint, format, home unit (96), affected E2E (spec-61 follow-through, proactivity-off, stale-goal
  queue). **Lesson: a "genuine commitment" (a goal, a couple's agreement) belongs in the waiting-on-you queue as a
  non-nudge item — gating it behind the proactivity dial (the AI-suggestion opt-out) hides exactly the user's own
  stuff they asked to keep top of mind; only AI-generated prompts (check-in, ask-someone) are true nudges.**
- 2026-07-14 — **Slice 3 (polish) — the Challenge bento card**, on `feat/home-slice3-polish` off the merged
  `main`. A self-hiding `ChallengeCard` shows the one ACTIVE challenge as a STATUS surface (agreed action +
  `ComfortDial` + a gentle "Day N" marker + a reflect entry) — visible the whole time you're on it, not only
  when a check-in is due (the actionable "how did it go?" nudge stays owned by the `challenge-checkin` "For
  you" recommendation, so no duplicate CTA). **[PARTLY SUPERSEDED 2026-07-20 — see 52 §3.3: the card is
  status-only ONLY while a check-in is due. Because that recommendation fires exclusively when one IS due,
  making the card wholly passive left Home with no way to act beforehand (and made the Together tile's
  "check in on Home" pointer a dead end), so the inline quick actions are restored for the not-due state.
  The no-duplicate-CTA rule is preserved by the card hiding its action row once due.]** Placed in the left bento between Memory and Sharing. RTL-covered
  (active/self-hide/check-in-due), matching the Slice-1 home-card pattern (SharingCard/TogetherHomeCard are
  RTL-covered, not separately E2E-seeded). **Deferred (a smaller follow-up):** the Together **pulse ring +
  desire alignment** on `TogetherHomeCard` — it needs an async per-partner `togetherPulse` read (the store
  doesn't wrap it yet), so it's left for a focused follow-up rather than bundled here.
- 2026-07-14 — Slices 1 + 2 **MERGED** to `main` as **#187** (squash `7f45fdd`), CI green.
- 2026-07-14 — **Slice 2 BUILT** (the daily reflection cadence + its setting + milestone badges — the one new
  spend), on the same branch. The auto-cadence already existed (spec-40 `useCoachingSynthesis` → the bridge's
  `shouldSynthesize`); Slice 2 **amends the cadence to daily** (`CADENCE` window 7/3-day → 1-day, keeping the
  ≥3/≥2-new-insight threshold + the rolling 7/week cap) so the Home reflection is "≤1/day, gated on new
  material". Added a per-person **`CoachingPrefs.dailyReflection`** toggle (default ON; a settings Switch on
  `ProactivityControl`) that gates the auto pass without turning off proactivity, and **crisis suppression** of
  the auto reflection (the bridge skips the auto pass when `aggregateCrisisSignal` is recurring — §8). Milestone
  **badges** via a pure `activeMilestones` (rhythm-week / ten-sessions / five-areas / first-challenge) mapped
  into the existing celebration flow (each celebrated once via the device-local `celebrate:badge:<id>`
  signature). **Fixed a latent celebration flash-vanish** (`CelebrationMoment` now holds the shown completion in
  state, so recording its dismissal-signature re-render doesn't clear the toast — benefits every celebration).
  `DailyReflectionCard` regained the §3.3 **"Talk it through"** seed-a-session handoff. Gate green: typecheck,
  lint, format, **1135 desktop + core** unit (+`shouldSynthesize` daily, +`activeMilestones`, +the bridge
  daily-reflection-off / crisis-suppression gate, +the `ProactivityControl` toggle, +a Home milestone-celebration
  test), Home + proactive-coaching **E2E** green. §11.1 badge item resolved (celebrate-once, no shelf).
- 2026-07-13 — **Slice 1 BUILT** (the full Hybrid visual redesign, no new spend), on `feat/home-dashboard-redesign`
  (worktree off `origin/main`). New pure `@selfos/core/home` (`quickActions`/`computeStreak`/`computeLifeRings`/
  `buildActivityFeed` + view types; 23 unit tests, crisis guardrail baked into streak/rings). `Home.tsx`
  restructured into the Hybrid layout (quick-dock → greeting + momentum + rhythm streak → "For you today" band
  [cached reflection + focal next action] → graph-rich bento [stat tiles, wellbeing chart, Together,
  questionnaires, dreams, memory, sharing] → right rail [life-rings + activity feed]) with loading skeletons,
  reusing the existing feature cards + 53's engine. Life-rings show a level word **+** % (the owner's choice).
  Gate green: typecheck (all), lint, format, **1121 core + 1132 desktop** unit (8 new home-component RTL files +
  the 23 core-derivation tests; `Home.test` updated for the band/reflection structure), Home **E2E** green
  (incl. a new `home (60)` test: dock + life-rings + activity feed + a dock route + 360px overflow guard).
  Real-app visual QA at desktop (light + dark) + 360px. **code-reviewer: ship** (privacy/per-person isolation,
  the crisis guardrail, and admin-`$` redaction verified adversarially airtight); applied the one should-fix
  (the activity feed now filters to the active person's own insights — defense-in-depth) + nits (DST-safe streak
  day-math, streak counts only your OWN Together messages, dropped a route cast, + a renderer test proving Home
  suppresses the rhythm streak under crisis). Slices 2 (daily auto-reflection + badges) + 3 pending.
- 2026-07-14 — **Follow-up 2 (Needs-attention card + pulse-ring un-squish; on `feat/home-goals-you-rings`).** The
  owner flagged the Together pulse ring's "Steady" text felt squished, and asked for a "Needs attention / important
  tasks" card (highlight the weekly check-in; goal reminders; send-a-questionnaire-if-it's-been-a-while; responses
  needing analysis; your Together turn). **Pulse ring:** shows the connection **%** inside the ring (narrow, fits)
  with the trend in the label — mirroring the life-rings; `levelFor` retired. **Needs attention (§3.1.2a):** a new
  pure `needsAttention` derivation + `NeedsAttentionCard`, leading above "For you"; **split by intent** (the
  owner's pick) — the waiting-on-you recommendation kinds (`stale-goal` / `wellbeing-checkin` / `together-session`
  / `questionnaire-gap`) are filtered OUT of the "For you" band and surfaced here, so nothing double-nags. Items:
  Together turn/invite · responses to analyze · insights to review · weekly (7-day) check-in nudge · stale goals ·
  soft "ask someone" (≥30d). Genuinely-pending items always show; the nudges suppress under crisis/proactivity-off
  (§8). The mood-check-in reminder **moved out of the You card** into this one (one place, not two). Reviewer fixes
  from Follow-up 1 applied (suggestion buttons name their goal; dropped `!` in YouCard). Gate green: typecheck,
  lint, format, **1144 desktop** unit (+attention/NeedsAttentionCard, −the 2 YouCard check-in tests; the For-you
  Home tests updated to assert the moved items now surface in "Needs attention"), Home + Together **E2E** green
  (the spec-40 goal, home-53 ranking, Slice-B, proactivity-off, and Together-H1 tests updated for the split).
- 2026-07-14 — **Follow-up (Goals card + You card + life-rings redesign; on `feat/home-goals-you-rings`).** After
  the redesign merged, the owner flagged: the life-rings "just look blank", and asked for a proper **Goals** surface
  (set / update / complete / see progress / suggest / create) + a **You**-page surface on Home. **Rings fix:** the
  conic-gradient rings read as blank (low-contrast on cream, and empty when crisis-softened) — replaced with a shared
  **SVG `Ring`** (visible track + rounded arc + % inside; softened → a soft heart, never an empty circle); the
  Together pulse ring adopts it too. **Goals card (§3.1.3, owner chose AI-suggest-on-tap):** completion bar + top
  active goals with one-tap Done/Still-on-it + inline create (new core `createGoal` + `goals:create`) + a metered
  **Suggest goals** tap (new `goalSuggestService` + `goal.suggest` usage + `goals:suggest`, mirroring the gap-finder:
  budget-gated, meter-before-parse, tolerant salvage, persists nothing). **You card (§3.1.4, owner chose profile +
  check-in + tests):** profile highlights from latest results + a stale mood/anxiety check-in nudge + take-a-test
  invites; deep-links into the take flow / hub; self-hides when empty. Both cards per-person + capability-gated
  (`memory.own` / `tests.own`); goal actions name their goal for a11y (no ambiguous "Mark done"). Gate green:
  typecheck (all), lint, format, **1162 core + 1134 desktop** unit (+goalSuggest/createGoal/goalsSummary core,
  +goalsCreate/goalsSuggest bridge, +GoalsCard/YouCard RTL, +LifeRings arc/heart guards), Home **E2E** green (the
  `home (60)` test seeds a goal, asserts both cards + a real SVG ring arc, and creates a goal end-to-end; 360px clean).
- 2026-07-13 — created (Draft). Founding decisions in §11.0 resolved by the owner from a three-direction mockup
  review; Hybrid direction, capped daily AI reflection, four new cross-feature elements, all-four hero, full
  engagement (with the §8 crisis guardrail), loading skeletons. Amends [`53`](53-home-encouragement.md) §2/§3.8/§8
  (gamification + per-load-spend) and re-homes its Home UX; folds [`59`](59-questionnaires-dashboard-section.md)
  into the bento.
