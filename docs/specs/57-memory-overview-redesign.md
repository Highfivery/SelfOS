# 57 — Memory overview redesign: a portrait of you, with Goals & Relationships moved out

> **Status:** **Approved** — _last updated 2026-07-08_
>
> Memory is still one long, text-heavy scroll that's hard to understand, navigate, and use — even after
> [`54`](54-memory-redesign.md). Four concerns compete for one vertical scroll ("what it knows about you,"
> drafts to review, **goals**, and **partners/sharing**), and the "about you" half opens straight into a wall
> of dense insight cards with no overview. This spec is a **complete rethink of Memory as an overview-first
> "portrait of you"**: a landing that shows _what SelfOS understands about you at a glance_ (a short portrait
>
> - a **life-area map**), which you **drill into** — a life area, then a single insight — with the heavy
>   edit/correct/share controls tucked into the per-insight detail. **Goals move to their own top-level page**;
>   **Relationships (the partner synthesis) and the Sharing transparency surface move out of Memory entirely**,
>   so Memory becomes purely _"what SelfOS knows about you."_ An interactive mockup was approved by the user.

This **supersedes the Memory _structure_ of** [`20`](20-memory-dashboard.md) /
[`44`](44-memory-dashboard-overhaul.md) / [`54`](54-memory-redesign.md) (the single long page, the "About
you / Partners" two-view toggle, the flat life-area sections). It **relocates** [`54`](54-memory-redesign.md)'s
per-partner **relationship synthesis** and [`44`](44-memory-dashboard-overhaul.md) §3.5's **sharing
transparency** surface out of Memory (reusing their services + IPC unchanged), and gives
[`39`](39-living-memory-continuity.md)'s **Goals** their own page. It **does not** change any data model,
context-feed boundary, AI spend, or the [`42`](42-relationship-scoped-sharing.md) sharing mechanics — it is
an **information-architecture + presentation** redesign that reuses the existing schemas, services, and IPC.
References [`00`](00-architecture.md)/[`01`](01-design-system.md) (tokens, responsive, a11y),
[`02`](02-app-shell.md) (nav), [`05`](05-conversations.md) (crisis/not-medical),
[`06`](06-ai-usage-and-budgets.md) (metering, admin-`$` redaction), [`50`](50-self-assessments.md)/[`51`](51-wellbeing-neurodivergence-reflections.md)
(sensitive facts).

---

## 1. Overview

### 1.1 The problem (the user's words)

Memory is _"extremely text-heavy, hard to understand, navigate, and use… very confusing. Things are poorly
grouped together, it's one huge long page."_ Two structural faults underlie it:

- **No overview.** Memory opens straight into a stack of full insight cards grouped by life-area. There is no
  "what does SelfOS understand about me, at a glance?" landing you can scan and then drill into. Every insight
  competes at the same level, with its summary + facts + tags + confidence chip + inline share/correct
  controls all on screen at once.
- **Four unrelated concerns share one scroll.** "What it knows about you," **drafts to review**, **Goals &
  commitments**, and **Partners + Sharing** are all stacked on `/memory`. Goals are a follow-through tool, not
  "memory"; the partner synthesis + the outbound-sharing view are a _relationships/privacy_ concern. Mixing
  them makes the page long and muddled.

### 1.2 The redesign — overview-first, drill-down (an approved mockup)

Memory becomes a **portrait of you** you navigate, not a wall you scroll:

1. **A portrait landing.** A short, warm **portrait** (a few sentences of "who you are" — the existing
   onboarding-portrait summary, no new AI spend) + a calm **"how well it knows you"** read (derived from the
   existing confidence stats — no spend). A slim **"N new insights to review"** callout (drafts + merge
   proposals) instead of a full section competing at the top.
2. **A life-area map.** A grid of **tiles**, one per life-area present in your own insights: an icon, the area
   name, a **count**, a **one-line gist**, and a **confidence read** (dots + label, never colour-only). The
   tiles _are_ the navigation — they replace the long stack of per-area sections.
3. **Drill into a life area.** Clicking a tile opens that area: clean, readable **insight rows** (summary +
   source + date + a confidence read), nothing else competing.
4. **Drill into a single insight.** Clicking a row opens the **insight detail** — and _only there_ do the
   heavy controls live: Edit / Delete (or "Edit answer" for onboarding facts), "This isn't right about me"
   (AI-inferred), the per-fact scope control, confidence + rationale, and the provenance deep-link. The
   overview stays calm and scannable.
5. **A secondary row** keeps two own-data pieces that belong with "about you": a compact **mood & energy**
   trend and a **"From questionnaires you sent"** tile (the [`08`](08-questionnaires.md) §13.4 / issue #129
   "responses about others" that inform _your_ coaching — kept distinct from "about you," reachable but not
   in the life-area cards).

### 1.3 Goals & Relationships & Sharing leave Memory

- **Goals → their own top-level page** (`/goals`, a new nav entry). Goals are a distinct
  follow-through/commitment tool; they get room to breathe (active goals, gentle stale nudges, a completed/
  closed history) and stop competing with "what it knows about you." **No data change** — this reuses the
  [`39`](39-living-memory-continuity.md) `Goal` schema, `goalStore`, `GoalCard`, and the `goals:*` IPC
  verbatim; only the **page + nav entry** are new.
- **Relationships + Sharing → a new "Sharing & relationships" page.** [`54`](54-memory-redesign.md)'s
  per-partner **relationship-insight cards** (the `relationship.synthesize` reflection about _you_ and your
  dynamic with a partner) and the [`44`](44-memory-dashboard-overhaul.md) §3.5 **sharing transparency** surface
  ("what you share & with whom") **both move to one new top-level "Sharing & relationships" page**, reusing the
  `relationshipSynthesisService` / `RelationshipInsightsCard` / `relationships:synthesize`/`:getSynthesis` and
  the `SharingPanel` / `memory:outboundSharing` IPC **unchanged**. (People is for _defining_ accounts +
  relationships, not for insights into them — so these relationship/privacy _insights_ get their own home
  rather than living under People.) The **per-fact scope control stays available in the Memory insight detail**
  (setting a fact's own share scope is part of editing your own fact); only the aggregate transparency _view_
  relocates.

The result: **Memory is purely "what SelfOS knows about you,"** and each of the moved concerns gets a home
that fits it.

### 1.4 Whole-app fit

- **Reuses everything.** No new schema, no new AI spend, no new (or removed) context-feed behaviour, and the
  moved surfaces reuse their existing services + IPC. The work is **presentation + routing** — an IA
  redesign, the lowest-risk kind. (A concurrent agent session is active; §5.5 notes the coordination.)
- **Consistent with the app's patterns.** Overview→detail mirrors Sessions/People/Dreams master-detail and
  the [`17`](17-home-dashboard.md) card dashboard; a dedicated Goals page mirrors the [`50`](50-self-assessments.md)
  "You" hub as a focused destination; nav entries follow [`02`](02-app-shell.md).
- **Honesty + safety unchanged.** The [`54`](54-memory-redesign.md) "shared ≠ shown" fix stands (a partner's
  raw shared facts are still never displayed); the crisis footer + not-medical line stay on Memory and the
  new Goals page; sensitive-fact handling in the data is untouched (§8).

## 2. Goals / Non-goals

**Goals**

- **Overview-first Memory** — a portrait landing (portrait summary + a "how well it knows you" read + a slim
  drafts-to-review callout) → a **life-area tile map** → a **life-area detail** (clean insight rows) → a
  **single-insight detail** (where Edit / correct / scope / provenance live). Memory becomes scannable, not a
  wall of cards.
- **Memory is purely "what SelfOS knows about you"** — Goals, the partner synthesis, and the sharing
  transparency surface all leave; the "responses to your questionnaires" own-coaching data stays (distinct).
- **A dedicated Goals page** (`/goals` + nav) — reusing the [`39`](39-living-memory-continuity.md) schema /
  store / `GoalCard` / IPC; active goals, stale "still on it?" nudges, and a completed/closed history, with
  room to grow.
- **Relocate Relationships + Sharing** to a new top-level **"Sharing & relationships"** page (reusing their
  services + IPC unchanged).
- **Reuse-first, low-risk** — no new schema (no `schemaVersion` bump), no new AI spend, no context-feed
  change, no new IPC channels (beyond wiring the reused surfaces into their new homes); primarily renderer +
  routing. Full responsive + a11y + visual-QA pass (§9, DoD).

**Non-goals (deferred / out of scope)**

- **Any data-model, context-feed, or sharing-mechanic change.** [`42`](42-relationship-scoped-sharing.md)'s
  `factSharedWithViewer` / `summarizeForContext`, the [`54`](54-memory-redesign.md) test-sharing default, the
  `relationshipSynthesisService`, the `Insight`/`Goal`/`RelationshipSynthesis` schemas — all **unchanged**.
- **New AI features / spend.** The portrait line + the life-area gist are **deterministic reuses** of existing
  insights (no new call). The relationship synthesis keeps its existing explicit-tap + `relationship.synthesize`
  metering; it just renders in a new home.
- **A household/Owner oversight view.** Memory stays self-scoped for everyone ([`20`](20-memory-dashboard.md)
  §2).
- **Removing the per-fact share control.** It stays in the insight detail (editing your own fact's scope). Only
  the aggregate transparency _view_ relocates.
- **Changing what a "life area" is or the `LIFE_AREAS` taxonomy** ([`44`](44-memory-dashboard-overhaul.md) §3.1).
- **A Goals redesign beyond the extraction.** V1 = move the existing Goals UI to its own page + light polish
  (active / stale nudge / completed history — which Memory already renders). Deeper goal features (reminders,
  sub-tasks, linking to sessions) are later.
- **Deep-linkable routes for every drill level** — recommended in-page view state for the area/insight
  drill-down (provenance deep-links from Home/other surfaces keep working, §3.6); dedicated `/memory/:area`
  routes are a §11 tuning call, not required for v1.

## 3. UX & flows

The redesigned **Memory** (`/memory`, gated `memory.own`) + the new **Goals** page (`/goals`). Responsive
~360px→desktop ([`01`](01-design-system.md) §9). The crisis footer + not-medical line are present on both (§8).
Wireframe reference: the approved interactive mockup (overview → life-area → insight; the new **Goals** nav
entry; Relationships/Sharing absent from Memory).

### 3.1 Memory — the overview landing (default view)

Top to bottom:

1. **Header** — "Memory" + "What SelfOS understands about you." + a quiet "Last tidied `<relative date>`"
   ([`39`](39-living-memory-continuity.md) `lastReconciledAt` signal).
2. **Portrait hero** — a short (1–3 sentence) **portrait summary** of who you are, rendered with `<Markdown>`,
   drawn from the existing **onboarding-portrait `Insight`'s `summary`** (a graceful fallback line when no
   portrait exists yet). Alongside it, a **"how well it knows you"** read: a calm qualitative label (e.g.
   "Getting to know you" / "Getting there" / "Knows you well") + a small segmented meter, **derived from the
   existing `confidenceStats` + volume** (`stats.ts`) — **no AI, no spend**. It reuses the intake portrait; it
   is **not** a new call.
3. **"Needs your review" callout** — a slim banner when there are draft insights and/or merge proposals: "**N
   new insights** to review" (+ "**M pairs** that look like duplicates"), with a **Review** button. It opens
   the review flow (§3.4) rather than dumping a full section at the top. Hidden when there's nothing to review.
4. **"By life area" — the tile map.** A responsive grid (`auto-fill minmax(~230px)`, [`01`](01-design-system.md))
   of **life-area tiles**, one per `LIFE_AREAS` entry present in your own approved insights:
   - an area **icon** (the [`44`](44-memory-dashboard-overhaul.md) `LIFE_AREA_ICON` map), the **area name**, a
     **count** (facts/insights in the area), a **one-line gist** (2-line clamp), and a **confidence read**
     (dots + label — text, never colour-only).
   - The **gist** is deterministic (no spend): the salient fact / summary line of the area's
     highest-confidence insight (exact derivation a build detail; deterministic).
   - The tile is a **button**; clicking opens the life-area detail (§3.2). Hover/focus lifts it (reduced-motion
     respected). Sensitive areas (Intimacy) render **identically** to any other tile — no lock, no "private"
     badge (the whole app is private; the user removed that treatment). The underlying `restricted` own-context
     data gating is **unchanged** (§8) — it's just not surfaced as a tile decoration.
5. **A secondary row** (two compact panels):
   - **Mood & energy** — the existing trends `LineChart` ([`44`](44-memory-dashboard-overhaul.md) §3.3),
     compact, with its "a gentle reflection, not a measure" framing. Shown only when there are ≥2 points.
   - **"From questionnaires you sent"** — the issue-#129 own-coaching insights derived from questionnaires you
     sent to others (their answers inform _your_ coaching). A compact tile grouped by recipient; clicking opens
     that recipient's responses (§3.5). Distinct from "about you"; kept in Memory (it's your coaching data).
6. **Search** in the header filters across your own insights (summary + fact text); a match surfaces the
   relevant areas (auto-open, or filter the tile grid — a build detail).
7. **Crisis footer + not-medical line** (§8), always present.

**Empty state:** a warm "As you have sessions, log dreams, answer questionnaires, and take a few tests, what
SelfOS learns about you shows up here" + a "Start a session" affordance (as today).

### 3.2 Memory — the life-area detail (drill-down)

Reached by clicking a tile. An **in-page view** (or a `/memory/:area` route — §11):

- A **back affordance** ("← Memory"), the area **icon + name**, and a one-line meta ("`N` things SelfOS knows ·
  `<confidence label>`").
- A clean, readable list of **insight rows** — each: the insight **summary** (lead), a **meta line** (source ·
  date · a small confidence read), and a chevron. No inline edit/share controls (they live in the insight
  detail). Rows are buttons → the insight detail (§3.3).
- Loading / empty (an area can't be empty if it's shown, but handle a filtered-to-empty search) handled calmly.

### 3.3 Memory — the single-insight detail

Reached by clicking an insight row (or the "Review" callout for a draft). An **in-page view** with a back
affordance to the life area. This is where the **existing `InsightCard` affordances** live (relocated from the
overview, not rebuilt):

- **Eyebrow** (source · "About you", or "From `<name>`'s answers" for a response insight), the **summary**, and
  the **facts** — each fact with its text, the per-fact **scope control** (`RelationshipScopePicker` /
  `FactSharingControl`, AI-inferred facts) and **"This isn't right about me"** correction; onboarding facts
  show no per-fact chip (their scope is share-by-default via the answer, [`44`](44-memory-dashboard-overhaul.md)
  §3.4).
- **Confidence** chip + rationale, the **category** tags, and the **provenance** deep-link (§3.6).
- **Actions:** Edit / Delete (AI-inferred) or **Edit answer** (onboarding — deep-links to the source section);
  for a **draft**: **Approve / Discard / Edit first** (the review flow, §3.4).
- **Crisis-flagged** insights lead with resources (§8).

The `InsightCard` is reused; the change is _where_ it renders (a focused detail view, one insight at a time)
rather than stacked by the dozen on the overview.

### 3.4 Memory — the review flow (drafts + merge proposals)

The "Needs your review" callout (§3.1) opens the drafts/proposals: draft insights (each the InsightCard in
review mode — Approve / Discard / Edit) and merge proposals (the [`39`](39-living-memory-continuity.md)
"combine these two?" cards). Presented as a focused review list/view (a build detail — a dedicated view or an
overview section that only appears when there's something to review), never a permanent wall on the landing.

### 3.5 Memory — responses to your questionnaires

The "From questionnaires you sent" tile (§3.1) opens a per-recipient view of the issue-#129 insights (grouped
by who answered; the InsightCard eyebrow reads "From `<name>`'s answers"). This is the existing behaviour
([`08`](08-questionnaires.md) §13.4 / [`54`](54-memory-redesign.md) §3.2), relocated behind the tile so it
doesn't compete on the landing. Content-correctness (the insight is about the recipient, not the viewer) is
unchanged.

### 3.6 Provenance & deep-links (unchanged behaviour)

A fact's provenance deep-links to its source (session / dream / questionnaire / onboarding section /
`/you/:testId` / a challenge) exactly as [`20`](20-memory-dashboard.md) §3.3 /
[`44`](44-memory-dashboard-overhaul.md). **Inbound** deep-links _to_ Memory (e.g. Home's MemoryCard, a
notification) must still land somewhere sensible — recommended: the overview (or, if an insight id is carried,
the insight detail). The in-page drill-down must not break existing `navigate('/memory', { state })` callers
(§7).

### 3.7 The new Goals page (`/goals`)

A dedicated top-level page (nav entry "Goals"), reusing the [`39`](39-living-memory-continuity.md) data +
`GoalCard`:

- **Header** — "Goals & commitments" + a one-line framing ("Things you're working toward — SelfOS helps you
  follow through").
- **Active goals** (open / in-progress / stale) as `GoalCard`s (status chip, due/horizon, provenance
  deep-link to the source session, set-status, edit, delete; a **stale** goal shows the gentle "still working
  on it?" prompt — [`39`](39-living-memory-continuity.md) §3.1).
- **Completed & closed** history in a collapsible section (as Memory renders today).
- **Empty state** — "Goals you mention in sessions show up here so SelfOS can help you follow through."
- Crisis footer + not-medical line present.
- Reachable also from Home ([`53`](53-home-encouragement.md) goal-followup recommendations already deep-link;
  they retarget `/goals` — §5.4).

### 3.8 The new "Sharing & relationships" page (`/sharing`)

Both relocated surfaces live on **one new top-level page** ("Sharing & relationships", a new nav entry),
gated `memory.own`:

- **Relationship reflections** (per partner) — the [`54`](54-memory-redesign.md) §3.3 cards (the framing line
  - the `relationship.synthesize` observation about _you_ + generate/refresh/AI-off/EMPTY states), reusing
    `RelationshipInsightsCard` + `relationships:synthesize`/`:getSynthesis` **unchanged**.
- **What you share** — the [`44`](44-memory-dashboard-overhaul.md) §3.5 outbound-sharing transparency
  ("what you share & with whom," editable in place), reusing `SharingPanel` + `memory:outboundSharing`
  **unchanged**.

Neither is redesigned here — only rehomed onto one page (the two read as complementary: what you share, and
what SelfOS reflects about your relationships). The per-fact scope control remains in the Memory insight
detail (§3.3). The page carries the crisis footer + not-medical line (§8).

## 4. Data model (vault files & schemas)

**No schema changes. No `schemaVersion` bump. No migration.** This spec reuses existing persisted data:

- **`Insight`** ([`schemas.ts`](packages/core/src/schemas.ts), [`20`](20-memory-dashboard.md)/[`44`](44-memory-dashboard-overhaul.md))
  — read as today; the overview groups by `categories[0]` (life area) and reads `confidence`, `summary`,
  `facts`, `provenance` exactly as the current dashboard.
- **`Goal`** ([`39`](39-living-memory-continuity.md) §4.1) — reused verbatim by the new `/goals` page.
- **`RelationshipSynthesis`** ([`54`](54-memory-redesign.md) §4.1) — reused verbatim by the relocated
  relationship cards.
- **`OutboundSharingItem` / `OutboundSharing`** ([`42`](42-relationship-scoped-sharing.md) §5.3) — reused
  verbatim by the relocated sharing surface.

**Derived (renderer-only, no persistence, no spend):**

- The **"how well it knows you"** label + meter — a pure function of the existing `confidenceStats` + insight
  volume (`stats.ts`). Deterministic.
- The **life-area gist** — a pure selection from the area's insights (highest-confidence insight's salient
  fact/summary). Deterministic.

**Ownership** — unchanged; all reads via the vault/crypto service + the existing IPC ([`00`](00-architecture.md)
§3). Per-person isolation holds (`people/<subjectPersonId>/…`).

## 5. Architecture & modules

Primarily **renderer + routing**; the moved surfaces are relocations of existing components/services.

### 5.1 Memory renderer (`routes/memory`) — restructured

- **`Memory.tsx`** restructured into the §3.1 overview: header, portrait hero, "needs review" callout, the
  life-area **tile map**, the secondary row (trend + responses tile), search, crisis footer. It **stops
  rendering**: the flat per-life-area insight sections, the Goals section, the "Partners" view + the
  About-you/Partners `SegmentedControl`, and the sharing summary/StatsSummary "Sharing" card + "Manage
  sharing" link (those concerns leave — §5.2/§5.3).
- **New `LifeAreaTile.tsx`** — the overview tile (icon, name, count, gist, confidence read; a button).
- **New `LifeAreaDetail` view** (in-page, or a routed sub-view — §11) — the clean insight-row list for one
  area; a new lightweight **`InsightRow.tsx`** (summary + meta + chevron; a button).
- **New `InsightDetail` view** — renders the **existing `InsightCard`** for one insight (reused, not rebuilt),
  with a back affordance. The `InsightCard`'s inline affordances are unchanged; they simply render one-at-a-time
  in the detail rather than stacked on the overview.
- **The drafts/proposals review** (§3.4) reuses the existing draft `InsightCard` + proposal cards, behind the
  callout.
- **Stores** — `insightStore` (own-scoped, per-person reset — unchanged), `goalStore` (no longer loaded here —
  moves to `/goals`), the trends derivation (unchanged). The `relationshipSynthesisStore` is **no longer loaded
  by Memory** (moves with the relationship cards). People/relationships still load for the "responses" recipient
  names.
- Deletes/relocates the "Partners" view wiring, the `StatsSummary` "Sharing" card, and the "Manage sharing"
  link from `Memory.tsx`.

### 5.2 New Goals page (`routes/goals`)

- **New `Goals.tsx`** — the §3.7 page, composing the existing `goalStore` + `GoalCard` (+ its
  `GoalCard.module.css`) verbatim (active list, completed/closed collapsible, empty state, crisis footer).
  `GoalCard` **moves** from `routes/memory/` to `routes/goals/` (or a shared location) since Memory no longer
  uses it.
- **Route + nav** — a new `{ path: 'goals', capability: 'memory.own', element: <Goals /> }` in `Shell.tsx`
  (reusing the `memory.own` gate — goals are own-data, no new capability; a `goals.own` capability is a §11
  minor call), and a **"Goals" nav entry** (a flag/target icon) in `AppShell.tsx` between Memory and Dreams.
- `goalStore` resets per-person in the AppShell active-person effect (already wired) — unchanged.

### 5.3 New "Sharing & relationships" page (`routes/sharing`)

- **New `SharingAndRelationships.tsx`** — the §3.8 page, composing (a) the relocated **relationship reflection**
  cards (`RelationshipInsightsCard` + `relationshipSynthesisStore`, moved from `routes/memory/`) and (b) the
  **sharing transparency** panel (`SharingPanel` + `stats.ts` `sharingStats`, moved from `routes/memory/`),
  reusing `relationships:synthesize`/`:getSynthesis` + `memory:outboundSharing` **unchanged**. The service,
  IPC, schema, metering, and the §8 "shared ≠ shown" guarantees are untouched — only the render location
  changes.
- **Route + nav** — a new `{ path: 'sharing', capability: 'memory.own', element: <SharingAndRelationships /> }`
  in `Shell.tsx` (the old `memory/sharing` route is **removed/redirected**), and a **"Sharing & relationships"
  nav entry** (a share/users icon) in `AppShell.tsx`. `relationshipSynthesisStore` resets per-person (moved
  with the surface).
- Memory's old "Partners" view + the "Manage sharing →" link + the `StatsSummary` "Sharing" card are
  **removed** from `Memory.tsx`; the entry point to sharing is now the new nav page (and, if useful, a small
  contextual link from the insight detail's per-fact scope control — a build nicety).

### 5.4 Cross-surface touch-ups

- **Home** — the [`53`](53-home-encouragement.md) goal-followup recommendation + the `MemoryCard` deep-links:
  a goal action now routes `/goals` (not `/memory`); MemoryCard's "Open Memory" still lands on the overview.
  Verify the [`53`](53-home-encouragement.md) providers that reference `/memory` still resolve.
- **Notifications** — any `navigate('/memory')` consumer ([`35`](35-notification-system.md), e.g. the
  goal-followup notification action) that meant "goals" retargets `/goals`; the rest keep landing on the
  overview.

### 5.5 Concurrency note (implementation)

A concurrent agent session is active. This spec touches shared files (`Shell.tsx`, `AppShell.tsx`, possibly
`channels.ts` if a route/label constant is shared). Build in a **git worktree** (the established pattern) and
coordinate the nav/route edits to avoid a collision; the data/services are untouched, minimizing overlap.

## 6. IPC / API contracts

**No new IPC channels, no changed contracts.** Every surface reuses its existing, already-gated IPC:

- **`insights:list` / `:approve` / `:update` / `:delete` / `:flag`** — unchanged (own-scoped, `memory.own`,
  active-person-scoped; the [`54`](54-memory-redesign.md) own-only scoping stands).
- **`insights:refresh` / `:reconcileState` / `:resolveProposal`** — unchanged (the review flow).
- **`goals:list` / `:setStatus` / `:update` / `:delete`** — unchanged; now consumed by `/goals`.
- **`relationships:synthesize` / `:getSynthesis`** — unchanged; now consumed by the relocated relationship
  cards. Gated `memory.own`, partner-relationship-scoped in the bridge (the [`54`](54-memory-redesign.md) §6
  trust boundary) — **unchanged**.
- **`memory:outboundSharing`** — unchanged; now consumed by the relocated sharing surface.
- **`intake:setAnswerSharing`** (per-fact/answer scope, [`44`](44-memory-dashboard-overhaul.md) §6) — unchanged;
  the per-fact scope control stays in the insight detail.
- **Claude** — the only AI call remains `relationships:synthesize` (unchanged: bounded JSON,
  `extendedThinking: false`, meter-before-parse, tolerant parse — [`37`](37-ai-output-robustness.md)). The
  portrait line + life-area gist are deterministic reuses (**no call**). Admin-`$` redaction at the bridge is
  unchanged ([`06`](06-ai-usage-and-budgets.md)).

## 7. States & edge cases

Per [`00`](00-architecture.md) §7 — every surface handles loading / empty / error / offline.

- **Empty memory** → the warm empty state (§3.1); no tiles; the portrait falls back to a gentle line; the
  Goals page shows its own empty state.
- **A life area with one insight** → a valid tile (count 1, its gist) → a one-row detail. No degenerate layout.
- **Draft-only / proposals-only** → the "needs review" callout appears; the tile map may be empty (only drafts
  exist) → the empty-ish landing still shows the callout + portrait fallback.
- **AI off / no key / over budget** → the **entire Memory overview + drill-down renders fully** (no AI needed
  — portrait + gist + tiles + insights are all existing local data). Only the relocated relationship card
  (in its new home) needs AI and shows its calm state there.
- **Provenance / inbound deep-link** → `navigate('/memory', { state })` still lands on the overview; a
  session/dream deep-link _from_ a Memory provenance link still works (§3.6). The in-page drill-down must
  reset to the overview on a fresh navigation to `/memory`.
- **Per-person switch** → `insightStore` resets (own insights reload); the Memory view resets to the overview;
  `goalStore` resets for the `/goals` page; the relocated relationship store resets in its home (per-person
  isolation, [`20`](20-memory-dashboard.md) §5.1).
- **Sensitive (restricted) facts** → the data gating is unchanged (own-context only; never shown raw to a
  partner). The tile shows no special treatment (§3.1); the insight detail shows the fact as today. A sensitive
  area is **not** collapsed/locked at the tile level (the user removed that) — but its facts' `restricted`
  own-context behaviour ([`50`](50-self-assessments.md)/[`54`](54-memory-redesign.md)) is intact.
- **Crisis-flagged insight** → leads with resources in its InsightCard (detail view); the overview tile/gist
  for that area does not surface crisis text on the landing (the resources appear when you open the insight) —
  a build nuance: a crisis-flagged area could carry a gentle indicator (§11).
- **Large memory** → the tile map + drill-down keep it scannable at any size; search narrows; long expanded
  lists lazy-render.
- **Goals: many / stale / all-closed** → active list + a collapsed completed/closed history; a stale goal shows
  the gentle prompt; all-closed shows the active-empty state + the history.
- **Sync conflict / corrupt file** → standard vault behaviour ([`00`](00-architecture.md) §4.3); a corrupt
  insight/goal is skipped, never crashes the view.
- **Migration** → none (no schema change). A pre-57 vault renders in the new IA immediately; a user's existing
  goals appear on the new `/goals` page; existing relationship syntheses + sharing appear on the new
  "Sharing & relationships" page (`/sharing`). Old bookmarks to `/memory/sharing` (unlikely) 404 gracefully /
  are redirected (a build detail).

## 8. Safety, privacy & honesty

Memory touches the most sensitive content; the boundary is paramount (CLAUDE.md §1, [`05`](05-conversations.md)
§7, [`42`](42-relationship-scoped-sharing.md) §8, [`54`](54-memory-redesign.md) §8).

- **"Shared ≠ shown" is unchanged and preserved.** This spec does **not** re-introduce any raw display of a
  partner's shared data. The [`54`](54-memory-redesign.md) removal of the "about people you relate to" raw
  section stands; the relocated relationship cards still show only the AI **observation about you**, never the
  partner's raw answers, with the same framing + the same `RELATIONSHIP_SYNTHESIS_GUIDANCE` confidentiality
  contract. An E2E re-asserts a partner's shared fact text is **absent** from every Memory surface (§10).
- **Sensitive facts.** The `restricted` own-context gating ([`50`](50-self-assessments.md) §3.4 /
  [`54`](54-memory-redesign.md) §4.3) is **untouched** — sensitive facts still feed only the owner's own,
  topic-relevant context and are never shown raw to others. The redesign removes the tile-level "private" badge
  (the whole app is private; the user's call) but changes **no data behaviour**; the fact still renders in the
  owner's own insight detail as today.
- **No surveillance framing.** No copy on any surface implies an owner/admin can see a person's content (the
  durable CLAUDE.md §1 rule). Memory remains the viewer's own portrait.
- **Not medical / not therapy.** The portrait + insights are reflective, never assessments; the not-medical
  line + the "Get help now" crisis footer are present on **both** Memory and the new Goals page
  ([`05`](05-conversations.md) §7). A crisis-flagged insight leads with resources (§3.3).
- **No new AI spend or content exposure.** The portrait line + gist are deterministic reuses; no new prompt,
  no new call, no new data leaves the device.

## 9. Accessibility

Per [`01`](01-design-system.md) §9 + CLAUDE.md §12:

- **Life-area tiles** are real buttons (keyboard-operable, visible focus, an accessible name incl. the area +
  count + confidence); the count + confidence label + gist are **text**, never colour-only; hover-lift respects
  `prefers-reduced-motion`.
- **Drill-down navigation** — the back affordances are real buttons with clear labels; focus moves sensibly
  on view change; the overview→area→insight flow is keyboard-traversable.
- **The insight detail** reuses the [`44`](44-memory-dashboard-overhaul.md) `InsightCard` a11y (per-fact
  scope picker [`42`](42-relationship-scoped-sharing.md) §9, confidence chip, correction control, crisis-lead).
- **Trend** keeps its text equivalent ([`44`](44-memory-dashboard-overhaul.md) §3.3 — the LineChart aria-label,
  direction-aware). **Confidence reads** are dots **plus** a text label everywhere.
- **Goals page** reuses the `GoalCard` / `GoalStatusChip` a11y ([`39`](39-living-memory-continuity.md) §9).
- **Responsive ~360px→desktop, no horizontal scrollbars anywhere** (incl. inner controls — the §12 guard at
  the real container widths): the tile grid reflows to one column; the drill-down views stack; no element
  scrolls-x. **Full surface renders to the bottom** (§7 DoD): no default-collapsed group hides own facts
  unreachably (the drill-down is explicit navigation, not a collapsed accordion — this structurally satisfies
  the guard, but the overflow + full-render E2E guards still run at the narrow widths).

## 10. Testing strategy

Per the DoD (CLAUDE.md §7). Decrypt the vault to assert data; run `pnpm typecheck` after tests
(`vitest-does-not-typecheck`); the standing §16.7 questionnaire matrix + the privacy guards are unaffected.

- **Component (RTL) — Memory overview:** renders the portrait hero (from the intake-portrait insight; the
  fallback when none) + the "how well it knows you" read (from confidence stats); the life-area tile map (one
  tile per present area, with count + gist + confidence text); the "needs review" callout appears only with
  drafts/proposals; the trend + responses tiles; **no** Goals section, **no** Partners view, **no** sharing
  card/StatsSummary "Sharing" — those are gone from Memory.
- **Component (RTL) — drill-down:** clicking a tile shows the life-area detail (insight rows for that area);
  clicking a row shows the insight detail (the InsightCard with edit/correct/scope/provenance); back
  affordances return; search auto-surfaces a matching area.
- **Component (RTL) — Goals page:** `/goals` renders active `GoalCard`s + the completed/closed history + the
  empty state; set-status / stale-prompt / delete work (reusing the existing goal tests, moved).
- **Privacy (decrypt E2E — the headline guard stands):** relate A↔B as partners; B shares a fact with A. Sign
  in as A → walk the **whole** Memory (overview → each area → each insight) → assert B's shared fact text is
  **ABSENT** everywhere in Memory, and there is **no** relationship/partner section in Memory; then assert the
  **same fact still feeds A's `buildContext`** (decrypt) — the [`54`](54-memory-redesign.md) boundary is
  preserved by the relocation.
- **E2E (Playwright) — the flow:** seed a person with insights across several life areas + a draft + a goal →
  overview shows the portrait + tiles + the review callout → drill into an area → open an insight → Edit /
  correct / scope work → back to overview; the **Goals** nav entry opens `/goals` and the goal is there (not in
  Memory); the relationship card + sharing surface are reachable from the new **"Sharing & relationships"**
  page (`/sharing`) and **absent** from Memory. **No-horizontal-overflow / inner-scrollbar guard at ~360px** on the overview, the drill-down
  views, and the Goals page; **full-surface-renders-to-the-bottom** on each. Visual QA at desktop + 360px (the
  portrait hero, the tile map, the drill-down, the insight detail, the Goals page — each reads clean +
  intentional, matching the approved mockup).
- **Cross-surface:** the Home goal-followup recommendation + notification now route `/goals`; the MemoryCard
  "Open Memory" lands on the overview; provenance deep-links from Memory still open their source.

## 11. Open questions

**Resolved with the user (2026-07-08):**

- **Relationships + Sharing → a new top-level "Sharing & relationships" page** (`/sharing`), holding both the
  per-partner relationship reflections AND the outbound-sharing transparency panel — **not** sections of
  People (People is for _defining_ accounts + relationships, not insights into them). Reuses their services +
  IPC unchanged (§3.8/§5.3).
- **The "how well it knows you" read → a qualitative label + a small segmented meter** (e.g. "Getting there" /
  "Knows you well"), derived from the existing confidence stats + volume — no number/percentage (avoids reading
  as a score on a wellbeing surface). Exact labels + thresholds are a build detail (§3.1).

Accepted the recommended answers (user, 2026-07-08 — spec **Approved**):

1. **Life-area drill-down → in-page view state** for v1 (provenance deep-links keep working); dedicated
   `/memory/:area` / `/memory/insight/:id` routes are a later additive nicety.
2. **Sensitive areas → identical tile treatment** (no lock, no collapse, no special signal); the underlying
   `restricted` own-context data gating is unchanged.
3. **Goals page → reuse the `memory.own` gate** (goals are own-data; no new capability); nav entry between
   Memory and Dreams.
4. **"Responses to your questionnaires" → stays in Memory** (the viewer's own coaching data; subject = the
   viewer), grouped separately behind its §3.5 tile.
5. **Parked (out of scope):** whether intimacy/sensitive facts stay **un-shareable to others by default**
   (`restricted` today) — [`54`](54-memory-redesign.md) §11 Q1 remains the owner; this spec changes no sharing
   default.

## 12. Changelog

- 2026-07-08 — created (Draft). A complete rethink of Memory as an **overview-first "portrait of you"**: a
  portrait landing (portrait summary + a "how well it knows you" read + a slim drafts callout) → a **life-area
  tile map** → a **life-area detail** → a **single-insight detail** (where Edit / correct / scope / provenance
  live). **Goals move to their own top-level `/goals` page** (reusing the [`39`](39-living-memory-continuity.md)
  schema/store/`GoalCard`/IPC); **Relationships (the [`54`](54-memory-redesign.md) partner synthesis) and the
  [`44`](44-memory-dashboard-overhaul.md) Sharing transparency surface move out of Memory** to a new top-level
  **"Sharing & relationships"** page (reusing their services + IPC unchanged), so Memory is purely _"what
  SelfOS knows about you."_ **No schema change, no new AI spend, no context-feed change, no new IPC** — an
  information-architecture + presentation redesign. Supersedes the Memory _structure_ of
  [`20`](20-memory-dashboard.md)/[`44`](44-memory-dashboard-overhaul.md)/[`54`](54-memory-redesign.md);
  relocates their relationship/sharing surfaces; gives [`39`](39-living-memory-continuity.md)'s Goals a page.
  An interactive mockup was approved by the user. **Resolved with the user:** the new "Sharing & relationships"
  page as the home for both moved surfaces, and a qualitative label + meter for the "how well it knows you"
  read. Remaining §11 open questions — drill-down routing, sensitive-tile treatment, the Goals gate, and
  whether "responses to your questionnaires" stays in Memory — to confirm before/at build.
