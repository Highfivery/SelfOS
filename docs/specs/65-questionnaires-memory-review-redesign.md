# 65 — Questionnaires & Memory: review queue, per-item insight cards, humanized trends

> **Status:** **Approved** — _last updated 2026-07-17_
>
> **Decisions (2026-07-17, user):** the review queue goes **straight to "all caught up"** after the last item —
> **no** separate "here's what you shared" recap (sharing is already confirmed per-item at each Keep & save).
> Defaults confirmed: review order = **drafts newest-first, then merge proposals**; **"Close family"** reuses the
> existing `CLOSE_FAMILY` preset set; **custom per-type scopes** (beyond the four cycle presets) live in **Edit
> mode** (the read-view chip cycles the four presets only). "Discard new" stays the two-write reuse
> (`resolveProposal('keepBoth')` + `insights:remove(fromId)`) with error handling — no new channel.
>
> Two user-reported problem areas, redesigned. **(1) The Questionnaires landing** (`/questionnaires`) buries the
> one actionable group ("Answered · ready to analyze") beneath a freshly-floated "Analyzed" group, and its cards
> look ragged because a reserved two-line title leaves a void under one-line titles. **(2) The Memory page**
> (`/memory`) turns unusable under real, text-heavy data: drafts render as a grid of tall, uneven cards that open
> in **full edit mode by default** (a wall of textareas), approved cards vary wildly in height with paragraph-long
> facts, the trends legend shows **machine names** (`emotionalIntensity`), and the responses band is mostly empty
> space in a 50/50 grid. This redesign lands a **focused one-at-a-time review queue** (with a per-item sharing
> step), **compact summary-first insight cards** (collapsible facts, per-fact tap-to-change sharing), **humanized
> trends** (every legend label + a selectable series set + a richer chart), and a **compact responses strip**.
> **Renderer + view-layer only — no new persisted schema** (per-fact `InsightFact.shareableTypes` already exists).
> The approved interactive mockup is the visual contract.

Amends [`08`](08-questionnaires.md) §3.1 (the Sent/Received/Auto landing — group ordering + card layout) and
[`62`](62-memory-insights-redesign.md) (the `InsightCard`, the "needs your review" surface, the trends + responses
surfaces). Builds on [`42`](42-relationship-scoped-sharing.md) / [`44`](44-memory-dashboard-overhaul.md) / `62`
(the per-fact relationship-scoped sharing model — `InsightFact.shareableTypes`, `RelationshipScopePicker`,
`factSharedWithViewer`, `SHARING_PRESETS`; **shared-with-partner by default**, 62 §13.4),
[`39`](39-living-memory-continuity.md) (the reconcile drafts + merge proposals the queue reviews),
[`57`](57-memory-overview-redesign.md) (the "knows you" read), and [`06`](06-ai-usage-and-budgets.md) (AI only on
explicit tap, metered). References [`00`](00-architecture.md), [`01`](01-design-system.md),
[`04`](04-people-roles.md) (`memory.own` / `questionnaires.viewResults` capabilities, the shareable boundary),
[`34`](34-rich-text-rendering.md) (the safe `<Markdown>` renderer), and [`05`](05-conversations.md)
(crisis / not-medical).

---

## 1. Overview

Memory and the Questionnaires landing are two of the most data-heavy surfaces in SelfOS, and both were designed
against thin seed data. Under a real vault — long AI summaries with markdown, dozens of paragraph-length facts, a
handful of metric series, several recipients — they degrade:

- **Questionnaires landing.** The Sent tab groups cards into fixed lifecycle subgroups (Drafts → Awaiting →
  Answered · ready to analyze → Analyzed), then `orderSentGroups` (`sentGrouping.ts`, 08 §3.1) floats the group
  carrying the current sort's date to the top. So the moment you analyze something, "Analyzed" floats above
  "Answered · ready to analyze" — hiding the **one group that needs your action**. Separately, `.cardTitleButton`
  reserves two lines (`-webkit-line-clamp: 2; min-height: 2.6em`) and top-aligns, so a one-line title leaves a
  ~22px void beneath it while a two-line title doesn't; the status/meta/CTA rows then start at different heights
  down a row. Cards read as ragged.

- **Memory.** The "needs your review" callout (62 §3.1) expands into a multi-column grid of `InsightCard`s that
  open in **full edit mode by default** (`cardEditing = isDraft`) — a `<Textarea>` per fact. With real data
  (a long summary + many paragraph-length facts) this is an undifferentiated wall of inputs, one per draft, all
  on screen at once. The approved cards (62 §3.3 + §grid) each render a summary + a fact list + per-fact controls;
  a long portrait groups its facts, but a card with 8 paragraph facts is still tall, and `auto-fill,
minmax(320px,1fr)` + `align-items: start` staggers ragged heights across the grid. The trends legend
  (`trends.ts`) only maps `moodValence`→"Mood" and `moodEnergy`→"Energy"; every other key
  (`emotionalIntensity`, `connection`, `desire`, `satisfaction`, author-defined questionnaire `metricKey`s)
  renders raw camelCase. The responses band ("From questionnaires you sent") is a full padded panel wrapping
  1–2 thin recipient rows, forced into a 50/50 `.duo` grid beside the chart — mostly empty space.

This spec is a **presentation + interaction redesign**. The `Insight` / `InsightFact` schema, the
reconcile/flag/approve/scope engine, the privacy gates, and `summarizeForContext` are all unchanged. It touches the
Questionnaires landing route, the Memory route + its components, the `LineChart` primitive, and one derivation
helper (`trends.ts`).

## 2. Goals / Non-goals

**Goals**

- **Questionnaires landing (A):** pin **"Answered · ready to analyze" first**, always, regardless of sort; keep the
  other groups' lifecycle/sort order below it. Fix card spacing so titles hug their eyebrow consistently and the
  status/privacy/meta footer aligns across a row.
- **Memory review queue (C):** replace the drafts grid with a **focused, one-at-a-time review queue** — a
  card-stack with progress, a clamped summary, scrolling facts, per-fact tap-to-drop, and a **per-item sharing
  step** before Keep & save. Merge proposals (39) join the same queue as a distinct card variant. Inline on
  Memory, keyboard-navigable, ends on "all caught up."
- **Memory approved cards (D):** compact, uniform, **summary-first**; heavy fact lists **collapse** behind a
  disclosure; per-fact **tap-to-change sharing** lives in the read view; edit-text + flag move to Edit mode; a
  **balanced confidence · date footer**; a single, properly-sized edit pencil; a **2-column / List** layout.
- **Memory trends (E):** **humanize every legend label** (a proper map + a camelCase prettifier for unknown keys);
  default the chart to **Mood + Energy** with the other series **selectable**; richer chart (area fill + emphasized
  latest point); keep the §9 text equivalent.
- **Memory responses (F):** a **compact, full-width strip** of small recipient cards, out of the 50/50 duo.
- **Whole-page order (B):** lead with a **"needs you" banner** → stats strip → portrait hero → trends → compact
  responses strip → life-area sections.
- **No new persisted schema** — everything renders/writes through the existing `Insight`/`InsightFact` model
  (per-fact `shareableTypes`, `flaggedInaccurate`, `confidence`, `provenance`, `categories`) and the existing
  channels. View-layer types are crypto-free renderer types.

**Non-goals**

- **Changing the memory/questionnaire engines** — reconciliation, merge proposals, flag-as-inaccurate,
  approve/discard, the relationship-scope gates, `summarizeForContext`, questionnaire analysis, and the
  shared-with-partner-default producers/backfill (62 §13.4) are all unchanged.
- **New AI spend** — the review queue, cards, trends, and responses are **derived reads / local edits**. Analysis
  (`insights:analyze`) and reconcile (`memory:refresh`) stay the existing **explicit-tap, metered** paths (06).
- **Editing another person's insights / re-working `/sharing` or `/goals`** — Memory is own-only; those surfaces
  are untouched (57).
- **Re-opening the settled design** — the interactive mockup is approved; this spec captures it.
- **Broadening the Questionnaires landing beyond A** — the Received/Auto tabs, toolbar, pagination, nav badge, and
  privacy chips (08 §3.1) are unchanged except the Sent group ordering + shared card spacing.

## 3. UX & flows

All copy below is the intended user-facing wording. Every surface is responsive (~360px→desktop, §12), modal-free
(the review queue is an inline focused region, not a dialog), and preserves the crisis footer + not-medical line
where Memory already shows them.

### 3.1 (A) Questionnaires landing — group ordering + card spacing

Amends [`08`](08-questionnaires.md) §3.1. Renderer + CSS only; no data, IPC, or capability change.

**"Answered · ready to analyze" pinned first (the ordering fix).** Today `Questionnaires.tsx` builds the Sent
groups from `SENT_GROUPS` and passes them through `orderSentGroups(groups, sentSort)` (`sentGrouping.ts`), which
ranks each group by the max sort value among its entries — so a just-analyzed card floats the **Analyzed** group
above the actionable **Answered · ready to analyze** group. The fix: **hoist the `answered` group to the front
before the generic ranking**, unconditionally, for every sort. Concretely, `orderSentGroups` (or the caller)
partitions out the `status === 'answered'` group, keeps it first, and applies the existing recency/lifecycle
ordering to the remainder (`draft`, `awaiting`, `analyzed`) below it. The "Title" sort still keeps lifecycle order
for the remainder. Rationale: "ready to analyze" is the **only group that needs the user's action**; it must never
be pushed down by activity elsewhere. This is a pure change to `sentGrouping.ts` + its unit tests.

**Consistent card spacing (the ragged-cards fix).** Root cause is in `Questionnaires.module.css`:
`.cardTitleButton { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height:
2.6em }` reserves two lines and top-aligns, so a one-line title leaves a void beneath it (plus the uniform 12px
`.card` flex gap), while a two-line title fills it — and the status/privacy/meta/CTA rows then begin at different
heights across a row. The fix:

1. **Title takes its natural height** — keep the 2-line clamp (long titles still truncate) but **drop the reserved
   `min-height: 2.6em`**, so a one-line title hugs its eyebrow with no void.
2. **Pin the status/privacy/meta footer to the card bottom** — the `.cardFoot` (status pill + privacy chip + meta)
   gets `margin-top: auto` (the pattern `.rcta` already uses for the Received CTA), so footers align across a row
   regardless of title/body height. `.card` is already `display: flex; flex-direction: column`, so this works with
   no structural change.
3. **Reconcile the two existing negative-margin hacks** — `.from` and `.cardMeta` currently pull up with
   `margin-top: calc(-1 * var(--space-2))` to visually group the meta with the pills. With the footer pinned to the
   bottom, re-evaluate these pulls so the pill + meta still read as one status cluster without a double gap (prefer
   grouping the pills + meta inside one bottom-pinned `.cardFoot` region rather than compensating with negative
   margins). SentCard and ReceivedCard share `.card`, so both get the fix.

**Acceptance:** across a row of mixed one-/two-line titles, every card's title hugs its eyebrow, and the status
pill + privacy chip + meta line up along a shared bottom edge; the Answered · ready-to-analyze group sits first
under any sort. No horizontal overflow at 360px (the grid already reflows to one column via `auto-fit`).

### 3.2 (B) Memory — whole-page order

Amends [`62`](62-memory-insights-redesign.md) §3.1. `/memory` renders one full-width column (no `max-width`), in
order:

1. **Header** — "Memory" + "What SelfOS understands about you — edit anything that isn't right." + the "Memory last
   tidied `<rel date>`" line (unchanged).
2. **"Needs you" banner** (only when drafts/proposals exist) — an accent callout ("2 new insights to review · 1
   possible duplicate") whose primary action **opens the review queue** (§3.3). This **replaces** the current
   `Collapsible` callout that expands inline into a drafts grid (`Memory.tsx`, the `reviewOpen` region). The count is
   `drafts.length + proposals.length` (the same `memoryReviewCount`, `navCounts.ts`, that drives the sidebar badge).
3. **Stats strip** — the compact metric row (things known · confidence · areas · since tidied); self-hides its
   zero state for a brand-new person. Unchanged (`StatsStrip`).
4. **Search** — full-width; a query filters to matching insights as a flat card grid (hero/trends/responses/sections
   hidden while searching). Unchanged.
5. **Portrait hero** (`PortraitHero`) — unchanged.
6. **Humanized trends** (§3.5) — full-width (out of the 50/50 duo).
7. **Compact responses strip** (§3.6) — full-width (out of the duo).
8. **Life-area sections** (`LifeAreaSection`) — the collapsible, edit-in-place sections (62 §3.2), whose cards are
   the redesigned `InsightCard` (§3.4). Unchanged in structure.
9. **Crisis footer** + the not-medical line (always).

The change from 62 §3.1 is: the review callout becomes a **banner that opens the queue** (not an inline drafts
grid), and **trends + responses leave the `.duo` grid** and stack full-width (each self-hiding when empty).

### 3.3 (C) Memory — the review queue

Replaces the "Insights to review" drafts grid (62 §4 / `Memory.tsx` `reviewOpen` region). The problem: drafts open
in **full edit mode by default** (`cardEditing = isDraft`) as a multi-column grid of tall, uneven cards — with
real data (long summaries + many paragraph-length facts) it's an unusable wall of textareas. The redesign is a
**focused, one-at-a-time review queue, inline on Memory** (not a separate route, not a modal — an inline focused
region opened from the banner, consistent with the app's modal-free convention).

**Queue contents & order.** The queue holds the active person's **draft insights** (`!approved` own insights) and,
as a distinct card variant, the **merge/duplicate proposals** (39; `proposals` in `insightStore`). Order (decided,
§11): **drafts newest-first, then the merge proposals** at the end.

**Chrome.** One item at a time, with:

- A **card-stack visual** behind the active card (2–3 offset ghost cards) conveying how many remain.
- A **progress indicator** — "2 of 5" (text; §9) + optionally a thin progressbar.
- **Prev / Next** navigation to move without deciding (keyboard: arrows; the queue is a keyboard-navigable region).

**Draft review card.**

- **Header** — the source pill (`SOURCE_EYEBROW[source]`) + the **about-chip** ("About you" / "About `<name>`",
  62 §context, `aboutSelf`/`aboutOther`) + a `ConfidenceChip` + the **provenance link** ("From "`<title>`" ↗ ·
  `<date>`", `provenanceTarget`). The linked source shows on drafts too (62 §context already moved it into the
  header).
- **Summary** — rendered through the safe `<Markdown>` (34; summaries carry `**bold**`/`*italic*`), **clamped to
  ~4 lines with "Read more"** (expands in place; a measured toggle that only appears when the summary actually
  overflows).
- **Facts** — the paragraph-length facts **scroll inside the card** (a capped-height region, ~`30vh`, `overflow-y:
auto`) so the actions stay pinned in view no matter how many facts. Each fact row: the fact text (`<Markdown
inline>`) + a tap-to-drop **"✕ not right"** (drops the fact from this insight before saving — the review-time
  analogue of the approved-card flag). This capped-height fact scroll is the **one intentional inner scroll** on
  the page (§12); it must never be a horizontal scroll.
- **Per-item sharing step** — **each fact carries its OWN share chip** (§3.4a), defaulting to the insight's
  produced default (**Partner**, per the shared-with-partner default, 62 §13.4). Sharing is chosen **per item,
  before Keep & save**, with a context-aware note that names the subject — e.g. "Partner lets `<name>`'s coach use
  that item — never shown to `<name>` as raw answers." (`<name>` = the partner-type relationship's person, or the
  generic "your partner" when unresolved.) Setting the chips writes each fact's `shareableTypes` **at approval**
  (the approve edit carries `{ id, text, shareable, shareableTypes }` per fact — already supported by
  `InsightFactEdit`; §6). A **`restricted`** fact is never offered a share chip (it stays own-only, structurally
  blocked by `factSharedWithViewer`).
- **Actions** (pinned below the fact scroll): **Keep & save** (primary — `insights:approve` with the edited
  facts + chosen scopes; auto-advances to the next item) · **Edit** (opens full inline edit — summary `<Textarea>`
  - per-fact text inputs, the 62 §3.3 editor) · **Discard** (`insights:remove` on the draft; auto-advances).

**Merge-proposal card variant.** A proposal (39) shows the two summaries it would combine ("These two look like the
same thing") with three actions: **Merge into one** (`memory:resolveProposal(id, 'merge')`) · **Keep both**
(`resolveProposal(id, 'keepBoth')`) · **Discard new** (drop the folded-away insight). The current backend supports
two actions (`'merge' | 'keepBoth'`); **"Discard new" reuses existing channels** — `resolveProposal(id,
'keepBoth')` followed by `insights:remove({ id: proposal.fromId })` (the `fromId` is the insight that would fold
away) — so **no new schema/channel**. Whether "Discard new" should instead become a first-class atomic
`resolveProposal` action is an implementation/atomicity question — see §11.

**Auto-advance & completion.** Keep & save / Discard / any proposal resolution **advances to the next item**. When
the queue empties it shows an **"all caught up"** state ("Nothing to review right now — SelfOS will surface new
insights here as it learns.") and the banner disappears; the sidebar badge (`memoryReviewCount`) drops to 0.

### 3.4 (D) Memory — the approved `InsightCard`

Amends [`62`](62-memory-insights-redesign.md) §3.3. Make cards compact + uniform under real, text-heavy data.

- **Summary-first** — lead with the plain-language summary via `<Markdown>`; long summaries **clamp to ~4 lines
  with "Read more"** (expand in place, measured toggle). Markdown bold/italic renders (34). The portrait keeps its
  `hideSummary` behavior (the hero owns its narrative, 62 §3.4).
- **Collapsible heavy facts** — facts collapse behind a **"N things SelfOS noted ▾"** disclosure
  (`Collapsible`, 62's primitive) so every card is a compact, uniform height regardless of fact count. A **short**
  insight (≤ `FACT_INLINE_THRESHOLD`, propose **3**) shows its facts inline (no disclosure). The long-portrait
  grouped-by-life-area rendering (`groupFactsByArea`, threshold 8) is retained inside the disclosure.
- **(a) Per-fact tap-to-change sharing in the read view** — every AI-inferred fact shows its **own share chip**
  directly in the read view (not hidden behind Edit; the user chose tap-to-change inline, **not** view-only). The
  chip is a **simplified preset cycle** — tap to cycle **Just me → Partner → Close family → Everyone** — each stop
  emitting a `RelationshipType[]` written via `insightStore.setFactScope` (which preserves the other facts via the
  server merge-by-id, `insightStore.ts`):
  - **Just me** → `[]` (private)
  - **Partner** → `['partner']`
  - **Close family** → `['partner', ...CLOSE_FAMILY]` intersected with the graph's `availableTypes`
    (`SHARING_PRESETS`/`CLOSE_FAMILY`, `packages/core/src/people/sharingPresets.ts`)
  - **Everyone** → the full `availableTypes` (falling back to `RELATIONSHIP_TYPE_ORDER`)

  The chip reads its current value the same way `FactSharingControl` does (a legacy broadcast `shareable: true`
  fact reads as **Everyone**; otherwise from `fact.shareableTypes`). A `restricted` intake fact shows the read-only
  "private" tag instead of a chip (unchanged). Fine-grained per-type control (the existing checkbox
  `RelationshipScopePicker`) remains available in **Edit mode** for a custom scope the four presets don't express;
  whether it should also be reachable from the read view is an open question (§11).

- **Edit-text + flag in Edit mode only** — editing a fact's **text** and **flagging** it ("This isn't right about
  me", `insights:flag`) move into **Edit mode** (opened by the header pencil), keeping the read view scannable. The
  read view no longer carries the per-line edit pencil or the flag button (the current 62 §3.3 read row put share
  chip + edit pencil + flag all inline — this splits them: share = read view, edit/flag = Edit mode).
- **No card-level share footer** — remove any single "Shared with Partner" / "Sharing set per item" card-level
  chip; it wrongly implies top-level (whole-card) sharing when sharing is per-fact. Rebalance the footer to
  **confidence (left) · date (right)**, moving the date **down from the header** (header row 2 declutters to the
  linked source only). So: header = source pill · about-chip · single edit-pencil (row 1) + linked source (row 2);
  footer = `ConfidenceChip` left, date right.
- **One aligned edit pencil** — a single, properly-sized, header-aligned pencil is the card's edit affordance
  (fixes the current two inconsistent pencils: a 16px bordered `secondary` header pencil floated top-right against
  multi-line text, plus a 14px ghost per-fact pencil). The single pencil opens Edit mode; the per-fact pencils
  exist only inside Edit mode.
- **Layout: 2-column grid + List toggle** — the card grid defaults to **`grid-template-columns: repeat(2, 1fr)`**
  (was `repeat(auto-fill, minmax(320px,1fr))`), collapsing to **1 column** at ≤560px, with a **List toggle** on the
  section/page for a scannable single-column view. The portrait still spans the full row (`.fullSpanCard`). Ragged
  heights are far less of a problem once facts collapse; `align-items: start` may stay.

Correction model split by source is unchanged (44 §3.4): an intake (`source: 'intake'`) card offers **Edit answer**
(deep-link) + delete, no inline flag; AI-inferred cards get inline edit + flag (now in Edit mode) + the read-view
share chip.

### 3.5 (E) Memory — humanized trends

Amends [`62`](62-memory-insights-redesign.md) §3.5 and the `LineChart` primitive (01). Deterministic — no AI.

- **Humanize every legend label.** `trends.ts` (`buildTrendSeries`) currently maps only
  `{ moodValence: 'Mood', moodEnergy: 'Energy' }`; every other key renders raw camelCase. Replace with a proper
  **`METRIC_LABELS`** map covering the known keys (`moodValence`→"Mood", `moodEnergy`→"Energy",
  `emotionalIntensity`→"Emotional intensity", `valence`→"Emotional tone", `connection`→"Connection",
  `desire`→"Desire", `satisfaction`→"Satisfaction", …) **plus a fallback** `prettifyMetricKey(key)` that turns any
  unknown camelCase key into a readable label — split camelCase → words, capitalize the first
  (`"emotionalIntensity"` → "Emotional intensity") — so author-defined questionnaire `metricKey`s are never shown
  as machine names. The label function is pure + unit-tested.
- **Default Mood + Energy; other series selectable.** `buildTrendSeries` still returns every eligible series (a
  metric present on ≥2 approved insights). `TrendsCard` renders only the **selected** subset, defaulting to
  **Mood + Energy** (when present), with a small **series picker** (checkbox chips / a multi-toggle) to add the
  others — so the chart stays calm/readable instead of overlaying many unrelated series at once. The §9 text read
  reflects only the shown series.
- **Richer chart.** The `LineChart` primitive gains an **area fill under each line** (a translucent fill from the
  line to the baseline, per-series color) and an **emphasized latest point** (a larger/ringed final marker), so the
  current moment reads at a glance. These are additive, opt-in render options (e.g. `fill?: boolean`,
  `emphasizeLast?: boolean`) so existing `LineChart` callers are unaffected; **update `/gallery`** to showcase them
  (DoD). The §9 text equivalent (direction per shown series — "Mood rising · energy steady") is kept.

### 3.6 (F) Memory — compact responses strip

Amends [`62`](62-memory-insights-redesign.md) §3.6 / [`44`](44-memory-dashboard-overhaul.md). Today "From
questionnaires you sent" (`ResponsesBand`) is a full padded panel wrapping 1–2 thin recipient rows, forced into the
50/50 `.duo` grid beside the chart — mostly empty space. Redesign as a **compact, full-width strip of small
recipient cards** (out of the duo, §3.2):

- Each recipient is a **small card**: an avatar (initial) · the recipient name · a one-line meta ("N insights ·
  last `<date>`") · a **view affordance** (opens that recipient's response insights — inline expand, or scroll to
  their cards). The recipient grouping (by `provenance.aboutPersonId`/`aboutName`, #129) is unchanged.
- The strip lays out as a responsive row/grid of these small cards (`auto-fill, minmax(...)`), staying tidy whether
  there are 1 or 6 recipients — no giant empty panel. It self-hides when there are no response insights.

### 3.7 States summary

The empty / getting-started state (brand-new person, no approved insights) and the search-results state are
unchanged from 62 §3.7 / §3.1. Full state coverage is in §7.

## 4. Data model (vault files & schemas)

**No new persisted files or schema.** Everything renders/writes through the existing `Insight` / `InsightFact`
model (`packages/core/src/schemas.ts`): `source`, `subjectPersonId`, `summary`, `facts[]` (`text`, `shareable`,
`shareableTypes`, `restricted`, `flaggedInaccurate`, `lifeArea`, `retractedShareAt`), `categories`, `confidence`,
`confidenceRationale`, `provenance` (`at`, `aboutPersonId`/`aboutName`, `sourceTitle`/`sourceQuestionnaireId`),
`approved`, `crisisFlag`, `metrics`. Merge proposals use the existing `MergeProposal`
(`fromId`/`intoId`/`fromSummary`/`intoSummary`, stored at `people/<id>/memory-proposals/<id>.enc`).

- The **per-item sharing step** writes each fact's `shareableTypes` at approval — the approve edit already accepts
  `InsightFactEdit` (`{ id, text, shareable, shareableTypes? }`), so this is a straightforward extension of the
  current approve payload (which today sends only `{ id, text, shareable }`); the server merges by id and preserves
  `restricted`. The **shared-with-partner default** (62 §13.4) is produced by the analysis/reconcile producers,
  unchanged — the queue chip just reflects and lets the user change it before saving.
- New **view-layer types** (a review-queue item union, a small responses-recipient view, the metric-label map)
  are crypto-free renderer types derived on the renderer.
- **Ownership** — all reads/writes go through the existing IPC channels + `insightStore`; the renderer never
  touches `fs`.

## 5. Architecture & modules

Renderer + one design-system primitive. No main-process change; no new IPC.

**Questionnaires (A)** — `apps/desktop/src/renderer/src/app/routes/questionnaires/`:

- `sentGrouping.ts` — `orderSentGroups` hoists the `answered` group first, then applies the existing ranking to the
  remainder. Pure; unit-tested.
- `Questionnaires.module.css` — `.cardTitleButton` drops `min-height`; `.cardFoot` gets `margin-top: auto`; the
  `.from`/`.cardMeta` negative-margin pulls are reconciled. `SentCard.tsx` / the Received card share `.card`.

**Memory (B–F)** — `apps/desktop/src/renderer/src/app/routes/memory/` + `stores/insightStore.ts`:

- `Memory.tsx` — reorders the page (§3.2): the review callout becomes a **banner** that opens the new review queue;
  trends + responses move out of `.duo` to full-width. Adds the review-queue state (active index, prev/next,
  auto-advance).
- **New `ReviewQueue.tsx`** — the one-at-a-time queue (card stack + progress + prev/next + auto-advance + "all
  caught up"), rendering a **`ReviewCard`** (draft) and a **`MergeProposalCard`** variant. Consumes `insightStore`
  drafts + `proposals` and the existing `approve` / `remove` / `resolveProposal` actions.
- `InsightCard.tsx` — reworked (§3.4): summary-first + clamp/Read-more; collapsible facts disclosure; **read-view
  share chip** (the new preset-cycle control) with edit-text + flag moved into Edit mode; single header pencil;
  confidence·date footer; no card-level share chip.
- **New `SharePresetChip.tsx`** — the simplified tap-to-cycle sharing control (Just me / Partner / Close family /
  Everyone → `RelationshipType[]`), used by `ReviewCard` and `InsightCard`'s read view. The existing
  `RelationshipScopePicker` (checkbox popover) is retained for custom scopes in Edit mode.
- `TrendsCard.tsx` — the series picker + default Mood+Energy selection; reads humanized labels.
- `trends.ts` — `METRIC_LABELS` + `prettifyMetricKey`; `buildTrendSeries` returns all eligible series (unchanged
  filtering).
- `ResponsesBand.tsx` — redesigned into the compact small-card strip (§3.6).
- `Memory.module.css` — `.cardGrid` → `repeat(2, 1fr)` (1 col ≤560px) + a List-view variant; the review-queue
  chrome; the responses strip; footer rebalance; remove the `.duo` for trends/responses.

**Design-system (01)** — `LineChart.tsx`/`.module.css` gain the additive `fill` + `emphasizeLast` render options
(area fill + emphasized latest point); `/gallery` updated (DoD). `SharePresetChip` is route-local (Memory-specific
vocabulary), not a design-system primitive, unless a second consumer appears.

**Stores** — `insightStore` contract is unchanged; the queue consumes `insights`/`proposals`/`load`/`approve`/
`update`/`remove`/`flag`/`setFactScope`/`resolveProposal`. The approve payload is extended to carry per-fact
`shareableTypes` (already typed on `InsightFactEdit`).

## 6. IPC / API contracts

**No new IPC channels.** Reuses (all own-scoped + gated `memory.own`, established in 20/44):

- `insights:list` / `:approve` / `:update` / `:flag` / `:remove` — the queue's Keep & save (`approve`, now carrying
  per-fact `shareableTypes`), Edit (`update`), Discard (`remove`), and read-view flag (`flag`); the read-view share
  chip goes through `setFactScope` → `insights:update` (merge-by-id).
- `memory:reconcileState` / `:resolveProposal` — the merge-proposal card (`merge` / `keepBoth`; "Discard new" =
  `keepBoth` then `insights:remove({ id: fromId })`).
- `memory:refresh` — unchanged (the metered reconcile that produces proposals; explicit "Refresh memory" tap).
- Questionnaires landing (A) reuses `questionnaires:sentOverview` (gated `questionnaires.viewResults`) and
  `insights:analyze` (the one-tap Analyze on an answered card, metered `questionnaire.analyze`, 06) — no change.

**Claude API:** none added. The queue/cards/trends/responses are derived reads + local edits; the only AI paths
(analysis, reconcile) are the existing metered, explicit-tap channels (06). The key stays in main.

## 7. States & edge cases

- **No drafts/proposals** — the "needs you" banner is absent; the sidebar badge reads 0; opening the (now hidden)
  queue is not possible. Approving the last item transitions the open queue to **"all caught up."**
- **Single item** — the queue shows "1 of 1", no ghost stack; resolving it closes to "all caught up."
- **Very long summary** — clamps to ~4 lines with a measured "Read more" (only shown when it actually overflows);
  markdown renders (34).
- **Many / paragraph-length facts** — the review card's fact region scrolls inside a capped height (~30vh); the
  approved card collapses facts behind the disclosure. The capped scroll is the **only** intentional inner scroll
  (never horizontal, §12).
- **A `restricted` fact** — never rendered raw in these views (unchanged); no share chip in the queue/read view;
  it keeps the read-only "private" tag. It can't be broadcast (`factSharedWithViewer`).
- **Sharing with no partner in the graph** — "Partner"/"Close family"/"Everyone" still emit the type arrays;
  `availableTypes` (the graph) narrows what actually reaches anyone, and the note falls back to "your partner" when
  no partner-type person resolves. A person with **no relationships** effectively shares with no one regardless of
  the chosen preset (the read-time relationship-scope gate, 42).
- **Merge proposal whose insight changed** — the proposal snapshots `from/intoSummary` for display (39), so the
  card still reads; resolving applies to the live ids. A stale proposal (an id already gone) is skipped/removed by
  the existing reconcile state read.
- **Deep-link from a Sent card's "View in Memory"** — unchanged (62 §context): opens the target section/recipient
  expanded + scrolls the card; a stale/not-found id falls back to the collapsed overview (never a dead view).
- **Trends: unknown / author metric key** — `prettifyMetricKey` humanizes it; a metric with <2 points is dropped
  (unchanged). A window that thins the selected series to <2 points shows the calm "not enough in this window yet."
- **Concurrent edit / sync** — last-write-wins via the store; `load`/`refresh` re-reads. An item resolved on
  another device disappears from the queue on the next `load`.
- **Offline (no AI)** — the whole redesign is deterministic reads/local edits and works offline; only "Refresh
  memory" (reconcile) needs AI and shows its existing connect-Claude state. The queue reviews already-produced
  drafts/proposals offline.
- **Questionnaires (A): freshly analyzed card** — with the hoist, the Analyzed group sinks below Answered · ready
  to analyze even immediately after an analyze; a mixed one-/two-line title row aligns footers via `margin-top:
auto`. No horizontal overflow at 360px.
- **Migration** — none (no persisted-schema change; per-fact `shareableTypes` already exists and defaults are
  already produced/backfilled per 62 §13.4).

## 8. Safety

Memory touches wellbeing content; the not-medical + crisis boundaries are unchanged (05/20/44/62):

- **Restricted (break-glass) facts** never render raw in these views and are never offered a share chip — they
  stay own-only (`factSharedWithViewer` blocks any type share). The redesign adds **no new data exposure** —
  display + own-only edits.
- **A `crisisFlag` insight** leads with the concern + resources banner (existing `InsightCard` behavior); a
  crisis-flagged item in the **review queue** likewise leads with that banner before the summary/facts.
- **Sensitive life areas** (Intimacy / any `restricted`-bearing section) keep their lock marker + start collapsed
  (62 §3.2); the review queue does not force-reveal restricted content.
- **The crisis footer + not-medical line** stay present on Memory (unchanged).
- **Sharing honesty** — the per-item sharing note states plainly that sharing informs the other person's coach and
  is **never shown to them as raw answers** (the 42/44 confidentiality wording). **No admin-access disclosure copy**
  (durable rule): copy never states that an owner/admin can see someone's answers.
- **Questionnaires (A)** is grouping/spacing only — no change to what a recipient sees or to the privacy chips
  (08 §3.1).

## 9. Accessibility

- **Review queue** is a **keyboard-navigable** inline region: prev/next are buttons (also arrow keys); the active
  card's controls are in tab order; the capped-height fact scroll is keyboard-scrollable; progress ("2 of 5") is
  real text + an `aria`-labelled progressbar; auto-advance moves focus to the next card's first action. Escape /
  a close control returns to the page. It is **not** a focus-trapping modal.
- **Share preset chip** is a real `button` announcing its current scope in its accessible name (e.g. "Sharing:
  Partner — activate to change"); state is text + a distinct icon, never colour alone (§9).
- **Disclosures** ("N things SelfOS noted", Read more) are `button`s with `aria-expanded`; the `Collapsible`
  primitive already bakes in header spacing (§12).
- **Trends** — the `LineChart` stays `role="img"` with a descriptive label + a legend; the **§9 text read**
  ("Mood rising · energy steady") is the non-visual equivalent; the series picker toggles are labelled checkboxes;
  area fill + emphasized point are decorative (the data is in the label + text read).
- **Cards / footer** — the single edit pencil, the flag, and the "✕ not right" are icon buttons with explicit
  `aria-label`s naming the fact; the confidence chip carries its rationale; the date is text. Flex text items
  carry `min-width: 0`; **no horizontal overflow** at any width (§12); reduced-motion is respected on the queue's
  card-stack transitions + deep-link scroll.

## 10. Testing strategy

Renderer-heavy, per the DoD (CLAUDE.md §7). The vault + Claude are mocked per the standard harness.

**Unit (Vitest)**

- `sentGrouping.ts` — `orderSentGroups` puts the `answered` group first for **every** sort (recent / answered /
  analyzed / title), including immediately after an analyze; the remaining groups keep their existing
  recency/lifecycle order below it.
- `trends.ts` — `METRIC_LABELS` maps every known key; `prettifyMetricKey` turns unknown camelCase into a readable
  label (`"emotionalIntensity"` → "Emotional intensity", single-word keys, already-spaced keys); `buildTrendSeries`
  still drops <2-point series.
- The **review-queue reducer/order** (active index, advance, prev/next, empties → all-caught-up) as a pure helper.
- The **share-preset mapping** (Just me / Partner / Close family / Everyone → the correct `RelationshipType[]`
  against a given `availableTypes`; current-value read for a legacy broadcast fact vs a `shareableTypes` fact).

**Component (Vitest + RTL)**

- `ReviewQueue` / `ReviewCard`: renders one item with progress ("2 of 5"); a long summary clamps + Read more; the
  fact region scrolls; "✕ not right" drops a fact; **setting a fact's share chip then Keep & save calls
  `insights:approve` with that fact's `shareableTypes`** (and preserves `restricted`); Discard calls `remove` +
  advances; a `crisisFlag` draft leads with the crisis banner; empties → "all caught up."
- `MergeProposalCard`: Merge → `resolveProposal('merge')`; Keep both → `resolveProposal('keepBoth')`; Discard new →
  `resolveProposal('keepBoth')` + `insights:remove(fromId)`.
- `InsightCard` (approved): summary-first + clamp/Read more; **facts collapse** behind the disclosure (a ≤3-fact
  insight shows facts inline, no disclosure); the **read-view share chip** cycles presets + writes via
  `setFactScope`; edit-text + flag appear **only in Edit mode**; footer = confidence left / date right; no
  card-level share chip; the single header pencil opens Edit.
- `TrendsCard`: defaults to Mood + Energy; the picker adds another series; the text read reflects only shown
  series; an unknown metric key renders humanized.
- `ResponsesBand`: renders the compact recipient cards (avatar · name · "N insights · last date" · view); self-hides
  when empty.
- Questionnaires card spacing: a one-line-title card leaves no reserved void; footers share a bottom edge across a
  mixed row (assert via computed geometry / `margin-top: auto`).

**E2E (Playwright)** — seed a person with: ≥2 draft insights (one long summary + many paragraph facts, one
`crisisFlag`) + a merge proposal + approved insights across ≥2 life areas (incl. Intimacy/`restricted`) + a
session-mood metric + a response insight; and a Sent questionnaire with an "Answered · ready to analyze" + an
"Analyzed" card.

- **Review flow:** open the "needs you" banner → the queue shows "1 of N" with the card stack → set an item's
  per-fact sharing (e.g. Partner) → **Keep & save → decrypt the vault** and assert the persisted fact's
  `shareableTypes` includes `partner` (and a `restricted` fact was never given a chip / stays own-only) → auto-advance
  → resolve the merge proposal → reach "all caught up"; the sidebar badge drops.
- **Approved cards:** a heavy card is compact (facts collapsed); expand the disclosure; cycle a fact's share chip
  in the read view → decrypt asserts the new scope; edit-text + flag are reachable only after the header pencil;
  toggle List view.
- **Trends:** the legend shows humanized labels (no camelCase); default is Mood + Energy; add a series via the
  picker.
- **Questionnaires landing:** after analyzing a card, the **Answered · ready to analyze** group stays first (assert
  order); a mixed row's footers align.
- **Mobile guard (360px):** no horizontal overflow anywhere (the capped fact scroll is the only inner scroll, and
  it's vertical); the card grid is one column; the queue chrome fits.

**Visual QA** — real-Electron screenshots at desktop + 360px of: the Questionnaires Sent tab (answered-first,
aligned footers); the review queue (card stack + per-item sharing); a compact approved card (collapsed facts,
read-view share chip, balanced footer); the 2-col + List layouts; the humanized trends chart (area fill + emphasized
point); the compact responses strip. Scrutinize density, alignment, that editability + sharing read at a glance.

## 11. Resolved decisions

All open questions were resolved with the user (2026-07-17):

- **No final recap.** The queue goes **straight to "all caught up"** after the last item — sharing is already
  confirmed per-item at each Keep & save, so a separate "here's what you shared" recap would be redundant.
- **Review-queue order.** **Drafts newest-first, then merge proposals** (proposals are a small cleanup after the
  bulk of drafts). Tunable, but this is the shipped default.
- **"Discard new"** stays the two-write reuse (`resolveProposal('keepBoth')` + `insights:remove(fromId)`) with
  error handling so a failed second write surfaces (no partial state silently). Not promoted to a new channel — no
  persisted-schema change.
- **Custom per-type scopes in Edit mode.** The read-view chip cycles the **four presets only** (Just me / Partner /
  Close family / Everyone); a custom relationship-type scope uses the full `RelationshipScopePicker` in **Edit mode**.
- **"Close family"** reuses the existing **`CLOSE_FAMILY`** preset set (`['partner', ...CLOSE_FAMILY]` ∩ the graph's
  `availableTypes`) — consistent with the intake sharing presets (DRY), not a bespoke subset.

## 12. Changelog

- 2026-07-17 — **All four slices BUILT** (one branch `feat/questionnaires-memory-redesign`, landing together as
  one PR per the user). Slice 1 (Questionnaires landing: `orderSentGroups` pins Answered-ready-to-analyze first +
  the card-spacing fix). Slice 2 (Memory trends humanized `METRIC_LABELS`/`prettifyMetricKey` + series picker +
  `LineChart` `fill`/`emphasizeLast` + the compact responses strip out of `.duo`). Slice 3 (`InsightCard`
  redesign: summary-first + measured Read-more, collapsible heavy facts, read-view `SharePresetChip`
  tap-to-change, edit-text + flag in Edit mode, balanced footer, single pencil, 2-col/List). Slice 4 (the
  "needs you" banner opens a one-at-a-time `ReviewQueue` — card-stack + `N of M` progress + prev/next + ← / →
  keys + auto-advance + all-caught-up; a compact `DraftReviewCard` with a capped-height fact scroll, inline
  "✕ not right" drop, and a LOCAL-mode share chip whose scopes are written at Keep & save; a `ProposalReviewCard`
  with Merge / Keep both / Discard-new [the two-write reuse]; the whole page reordered). Renderer-only, no schema/
  IPC change. Gate: typecheck + lint + format clean; 53 memory unit + 17 memory E2E green; real-Electron visual QA
  at desktop + 360px.
- 2026-07-17 — created + **Approved**. Design + interactive mockup approved by the user as the visual contract;
  the §11 open questions resolved with the user (no recap; drafts-then-proposals order; four-preset read-view
  chip with custom in Edit mode; `CLOSE_FAMILY` reuse; two-write "Discard new"). Captures: (A) Questionnaires landing — "Answered · ready to analyze" pinned first + card-spacing fix;
  (B) Memory whole-page reorder behind a "needs you" banner; (C) a focused one-at-a-time review queue with a
  per-item sharing step + a merge-proposal variant + all-caught-up; (D) compact summary-first insight cards
  (collapsible facts, read-view tap-to-change sharing, edit/flag in Edit mode, balanced footer, single pencil,
  2-col/List); (E) humanized trend labels (map + camelCase prettifier) + selectable series + area-fill/endpoint
  chart; (F) a compact responses strip. Renderer + view-layer only — **no new persisted schema**; builds on
  42/44/62's per-fact sharing, 39's proposals, 06's metering. Phased build plan in §13.

## 13. Build plan — phased, independently-shippable slices

Each slice is a separate branch → PR → squash-merge, testable on its own, per the methodical cadence (CLAUDE.md §6).

- **Slice 1 — Questionnaires landing (A).** Small, independent. `orderSentGroups` hoists "Answered · ready to
  analyze" first; the card-spacing fix (drop `min-height` on `.cardTitleButton`, pin `.cardFoot` with `margin-top:
auto`, reconcile the `.from`/`.cardMeta` pulls). Unit tests for `sentGrouping`; RTL/E2E for group order + footer
  alignment. Amends 08 §3.1.
- **Slice 2 — Memory trends + responses (E, F).** Humanize trend labels (`METRIC_LABELS` + `prettifyMetricKey`) +
  the series picker (default Mood + Energy); the `LineChart` area-fill + emphasized-endpoint options (+ `/gallery`);
  the compact responses strip out of the `.duo`. Amends 62 §3.5/§3.6, 44, 01.
- **Slice 3 — Memory `InsightCard` redesign (D).** Summary-first + clamp/Read more; collapsible facts; the
  read-view `SharePresetChip` (tap-to-change) writing via `setFactScope`; move edit-text + flag into Edit mode;
  balanced confidence·date footer; single aligned pencil; 2-col + List layout. Amends 62 §3.3.
- **Slice 4 — Memory review queue (C) + whole-page order (B).** The "needs you" banner opens the one-at-a-time
  queue (card stack + progress + prev/next + auto-advance + all-caught-up), the per-item sharing step (approve
  carries per-fact `shareableTypes`), and the merge-proposal card variant; reorder the page (trends/responses
  full-width). Amends 62 §3.1/§4 / 39.
