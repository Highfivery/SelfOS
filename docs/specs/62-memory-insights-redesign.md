# 62 — Memory insights redesign (flatten, edit-in-place, obviously editable)

> **Status:** **Approved** — _last updated 2026-07-14_
>
> The Memory page reads as "a bunch of text boxes that make the page very long, and it isn't clear you
> can edit them" (user, 2026-07-14). This redesign flattens the tile → area → single-card drill-down into
> **collapsible life-area sections you edit in place**, makes every insight **obviously editable** (per-card
> and per-line affordances, inline editing — not a hidden mode toggle), and redesigns the three top surfaces
> (portrait hero, "how you've been" trends, questionnaire-responses band) for density. Renderer + view-layer
> only — **no new persisted schema**. Supersedes the Memory presentation in [57](57-memory-overview-redesign.md)
> (amends it); builds on the [20](20-memory-dashboard.md)/[44](44-memory-dashboard-overhaul.md) engine.

---

## 1. Overview

Memory (`/memory`) is where a person sees + corrects **what SelfOS understands about them** — the approved
`Insight`s produced by onboarding (portrait), sessions, dreams, questionnaires, self-assessments, and
Together. Spec 57 made it "about you"-only and organized the overview into a portrait hero + a "knows you"
meter + life-area **tiles** that drill into an **area list** (`InsightRow`s) that drill into a **single
`InsightCard`**. In practice this has two problems the user named:

1. **Editing isn't discoverable.** The `InsightCard` shows read-only prose + a fact list; editing is a
   `useState` mode flipped by one low-emphasis "Edit" button at the card's bottom. Read and edit are
   entirely separate modes. Nothing on the summary or a fact says "you can change this."
2. **It reads as a long wall of text boxes.** The heavy card renders the summary as full-width flowing
   prose above an undifferentiated fact list; the portrait (one intake insight with ~40 facts) is
   especially tall; and the multi-level drill-down means correcting one fact is several clicks deep.

This redesign makes Memory **scannable and directly editable**: the page opens with a compact summary
(stats + portrait + trends + responses), then **collapsible life-area sections** whose insights are
**editable in place**. It is a presentation/interaction redesign — the `Insight`/`InsightFact` schema,
the reconcile/flag/approve engine, and the privacy gates are unchanged.

## 2. Goals / Non-goals

**Goals**

- **Flatten** browsing: replace tile → area → single-card navigation with **collapsible life-area
  sections** that list their insights inline. Correcting an insight is: expand a section → click a line →
  edit → Save. No page-to-page drill-down.
- **Obvious editability**: every own insight shows a **card-level pencil** and a **per-line pencil**
  (hover/focus-revealed, keyboard-reachable); clicking a fact or the summary edits it **inline in place**;
  read and edit are no longer separate screens.
- **Density**: a stats strip up top; compact cards (tight padding, one-line meta, distinct fact rows, the
  sharing scope as a **chip per fact**); sections **collapsed by default** so the page opens short.
- **Redesign the three top surfaces**: the **portrait hero** (narrative summary + "knows you" read +
  edit-answers link), the **"How you've been" trends** (mood/energy over a 30d/90d/all window + a text
  read), and the **"From questionnaires you sent" responses** band (per-recipient → their response
  insights).
- **Safety**: sensitive areas (Intimacy / any `restricted`-bearing insight) **always start collapsed**;
  restricted facts stay hidden from normal Memory views (unchanged); the crisis footer + not-medical line
  stay present.
- **No new persisted schema** — the `Insight`/`InsightFact` model already carries `categories` (life
  areas), `lifeArea`, `confidence`/`confidenceRationale`, `provenance`, `source`, per-fact `shareable`/
  `shareableTypes`/`restricted`/`flaggedInaccurate`. This is renderer + view-layer only.

**Non-goals**

- **Changing the memory engine** — reconciliation, merge proposals, flag-as-inaccurate, approve/discard,
  the sharing model + relationship-scope gates, and `summarizeForContext` are all unchanged (20/39/42/44).
- **Changing what feeds coaching context** — display only.
- **Editing another person's insights** — Memory is own-only (the related-people/sharing surfaces live at
  `/sharing`, spec 57 — untouched).
- **New AI spend** — no new model calls; "Refresh memory" (the existing metered reconcile) is unchanged.
- **Reworking `/goals` or `/sharing`** — those moved out of Memory in 57 and stay put.

## 3. UX & flows

### 3.1 Page structure (top → bottom)

`/memory` renders one full-width column (no `max-width` cap), in order:

1. **Header** — "Memory" + "What SelfOS understands about you — edit anything that isn't right." + the
   "Memory last tidied `<rel date>`" line.
2. **Stats strip** — a compact metric row (auto-fit): **things known** (fact/insight count), **overall
   confidence** (High/Medium/Low from the distribution), **life areas** (count with content), **since
   tidied**. Self-hides its zero state for a brand-new person (they see the getting-started hint instead).
3. **Needs your review** (only when drafts/proposals exist) — an accent callout ("2 new insights to
   review, 1 possible duplicate") that **expands inline** into the draft `InsightCard`s (open in edit
   mode) + the merge `proposal` cards (Merge / Keep both). Replaces the separate `review` view.
4. **Search** — a full-width text input; a query filters to matching insights (across summary + facts),
   rendered as a flat result list of the same cards (sections/hero hidden while searching).
5. **Portrait hero** (§3.4).
6. **How you've been** + **From questionnaires you sent** (§3.5, §3.6) — a responsive two-up that stacks
   on narrow widths; each self-hides when empty.
7. **Life-area sections** (§3.2) — the collapsible, edit-in-place sections.
8. **Crisis footer** + the not-medical line (always).

The `area`, `insight`, and `responses` **views are removed** (their content is now inline); a
`provenance` deep-link from Sessions/Dreams/etc. **opens the relevant section expanded and scrolls/focuses
the target card** (replacing the old "open the single-insight view").

### 3.2 Life-area sections (the core change)

Own approved insights are grouped by their `categories` (life area; an insight with none → "Other"). Each
life area renders a **collapsible section**:

- **Header** (a full-width `button`, `aria-expanded`): an area icon + the area name + a fact/insight
  **count** + a chevron. A section holding any `restricted`-bearing or Intimacy insight shows a small
  **lock** marker.
- **Default state**: **all sections collapsed**; **sensitive sections** (Intimacy, or any section
  containing a `restricted` fact) are **always collapsed** on load (decided 2026-07-14). Expanded/collapsed
  state is ephemeral (not persisted) except a deep-link forces one open.
- **Body** (when open, with clear spacing from the header — §12): the section's insights as **compact
  `InsightCard`s** (§3.3), newest-first.

### 3.3 The redesigned `InsightCard` (read + inline edit)

**Read state** (compact):

- **Eyebrow row**: a source pill (`SOURCE_EYEBROW[source]` — Onboarding / Session / Dream / Questionnaire /
  Self-assessment / Together) + a relative date + a `ConfidenceChip` (text + dots, with the rationale on
  hover). Never lets the title fight a tag for the same line (§12).
- **Summary**: one tight `<Markdown>` line/block.
- **Facts**: each fact is a **distinct row** (not a bulleted paragraph) — the fact text + inline tags
  ("marked not right" / "sharing withdrawn" / a `restricted` "private" tag) + the **sharing scope as a
  compact chip** (`RelationshipScopePicker` for an AI-inferred fact; a read-only "Private"/scope chip for
  an intake fact) + a **per-line pencil** (hover/focus-revealed; opens that line's inline editor).
- **Card actions**: a **card-level pencil** (top-right) to edit the whole card; a "View `<source>`"
  provenance deep-link; a "This isn't right" flag (AI-inferred) or "Edit answer" deep-link (intake).

**Edit state** (inline, in place — replaces the mode-toggle):

- Clicking the card pencil, a per-line pencil, or a fact/summary turns the relevant field into an input
  **where it sits**: the summary → a `Textarea`; each fact → a text input with its scope chip beside it;
  Save / Cancel + a quiet delete. Editing one line may open just that line (a lightweight per-fact edit) or
  the whole card — **both resolve to the same `insights:update` write**.
- **Drafts** (`!approved`) open in edit mode with **Approve / Discard** (unchanged semantics).
- The redesign keeps the existing grouped-vs-flat fact rendering for a **very long portrait** insight
  (the intake portrait still groups its facts by life area within the card), but the card now lives inside
  its life-area section rather than a separate detail page.

**Editability is enforced by affordance, not a hidden toggle** — the pencils + click-to-edit are always
visible/reachable; the user's "not clear you can edit them" complaint is the acceptance bar.

### 3.4 Portrait hero (redesigned)

A compact card at the top of "about you":

- An initial/avatar tile + "Your portrait" + a "from onboarding · updated as SelfOS learns" eyebrow + a
  **"knows you" read** (a short text + a small progress read derived from coverage/confidence — text, not
  colour alone, §9).
- The portrait **narrative summary** (the intake insight's `summary`) as `<Markdown>`, **clamped** to a few
  lines with "Read your full portrait" (expands in place) + an **"Edit your answers"** deep-link to
  onboarding.
- The hero shows the portrait's **narrative only**; its individual **facts still live in the life-area
  sections** (the portrait renders as a section card with its **summary hidden** — the hero owns the
  narrative, so it's never duplicated). Intake facts are corrected at the source via **"Edit your answers"**
  (the onboarding deep-link) — not inline-flagged (44 §3.4's intake model). So the portrait facts stay
  viewable + searchable in Memory, while the AI-learned insights (session/dream/questionnaire/test/Together)
  are the ones you correct in place.

### 3.5 "How you've been" (trends, redesigned)

A compact card (from session-insight mood/energy metrics, deterministic — no AI, no spend):

- A **30d / 90d / All** window toggle (a `SegmentedControl`); a small mood + energy `LineChart` (−1..1);
  and a **text read** ("Mood rising · energy steady") — the §9 text equivalent, never colour alone.
- Self-hides when there aren't ≥2 points. Reuses the existing `trends.ts` series builder.

### 3.6 "From questionnaires you sent" (responses, redesigned)

Replaces the separate `responses` view with an inline band (only when there are response insights, #129):

- Per-recipient rows (avatar + name + "N insights" + a chevron) that **expand inline** into that
  recipient's response `InsightCard`s (grouped by `provenance.aboutPersonId`/`aboutName`), edited in place
  like any other card. No separate page.

### 3.7 Empty / getting-started

A brand-new person (no approved insights) sees a warm getting-started hint ("Insights appear here after a
session or onboarding…") instead of the stats strip + empty sections (the existing empty pattern, kept).

## 4. Data model (vault files & schemas)

**No new persisted files or schema.** Everything the redesign renders already exists on `Insight` /
`InsightFact` (`packages/core/src/schemas.ts`): `source`, `subjectPersonId`, `summary`, `facts[]` (text,
`shareable`, `shareableTypes`, `restricted`, `flaggedInaccurate`, `lifeArea`), `categories` (life areas),
`confidence`, `confidenceRationale`, `provenance`, `approved`, `crisisFlag`, `metrics` (trends). The
edit/flag/approve/scope writes reuse the existing `insights:update` / `:flag` / `:approve` /
`intake:setAnswerSharing` channels + `insightStore` actions (20/44). Any new **view types** (e.g. a
grouped `MemorySection` shape) are crypto-free renderer-facing types derived on the renderer.

## 5. Architecture & modules

Renderer only (`apps/desktop/src/renderer/src/app/routes/memory/`):

- **`Memory.tsx`** — rewritten from a 5-view (`overview`/`area`/`insight`/`review`/`responses`) switch to a
  single scrolling composition (§3.1): header + stats + review callout + search + portrait hero + trends +
  responses + life-area sections. The `area`/`insight`/`responses` views + their state are removed;
  provenance deep-links open the relevant section + focus the card.
- **`InsightCard.tsx`** — reworked to the compact read + **inline per-line/whole-card edit** (§3.3); keeps
  the grouped-fact rendering for the long portrait; keeps crisis-lead + the flag/approve/scope controls.
- **New route-local components**: `LifeAreaSection` (the collapsible section wrapping `InsightCard`s),
  `PortraitHero`, `TrendsCard` (wrapping `LineChart`), `ResponsesBand`. `LifeAreaTile` + the old
  single-view scaffolding are removed (or repurposed).
- **Helpers**: reuse `overview.ts` (area summaries → now section headers), `stats.ts` (the strip),
  `trends.ts`, `provenance.ts`, `lifeAreaIcons.ts`. A small `sections.ts` builds the ordered
  `MemorySection[]` (life area → its insights, sensitive flag, count) + the default-collapsed rule.
- **`insightStore`** unchanged in contract; the redesign consumes `insights`, `proposals`,
  `lastReconciledAt` and the existing `update`/`approve`/`flag`/`setFactScope`/`refresh`/`resolveProposal`
  actions.

**Design-system**: the collapsible section is a hand-rolled `<button aria-expanded>` + body (the existing
accordion pattern) — **unless** we extract a reusable `Collapsible` primitive, in which case it goes in the
design-system + `/gallery` (§11). The `RelationshipScopePicker`, `ConfidenceChip`, `Markdown`, `LineChart`,
`SegmentedControl`, `Banner`, `Textarea`, `TextInput` primitives are reused as-is.

## 6. IPC / API contracts

**No new IPC channels.** Reuses `insights:list` / `:update` / `:approve` / `:flag` / `:remove` /
`memory:refresh` / `memory:reconcileState` / `memory:resolveProposal` / `intake:setAnswerSharing` (all
own-scoped + gated by `memory.own`, established in 20/44). No Claude calls added.

## 7. States & edge cases

- **Empty** — getting-started hint (§3.7); each top surface + section self-hides when empty.
- **All collapsed on load** — the page opens short; the counts let the person choose what to open.
  Sensitive/Intimacy sections stay collapsed even when everything else is toggled open.
- **Very long portrait** — its narrative is clamped in the hero (read-more); its facts group by life area
  within their section cards, so no single wall.
- **Deep-link from a source** (Sessions/Dreams/questionnaire/test/Together `provenance`) — opens the target
  insight's section expanded + scrolls/focuses the card; a stale/not-found id falls back to the collapsed
  overview (never a dead view) — the #129 not-found-guard pattern.
- **Concurrent edit / sync** — last-write-wins via the existing store; `refresh`/reconcile re-reads.
- **Restricted facts** — never rendered in these views (unchanged); their presence only sets a section's
  lock marker + keeps it collapsed.
- **Search** — filters to matching insights; empty result → a calm "nothing matches" note; clearing
  restores the sections.
- **Offline (no AI)** — the whole page is deterministic reads/edits; only "Refresh memory" (reconcile)
  needs AI and shows its existing connect-Claude state.

## 8. Safety

Memory touches wellbeing content. Unchanged from 20/44/57: restricted (break-glass) facts never render in
normal views; a `crisisFlag` insight leads with concern + resources; sensitive life areas start collapsed
so intimacy/trauma isn't on screen at a glance; the crisis footer + not-medical line are always present;
sharing changes stay explicit two-step for sensitive facts (42 §8). No admin-access disclosure copy
(durable rule). This spec adds no new data exposure — display only, own-only.

## 9. Accessibility

- Section headers are `button`s with `aria-expanded` + accessible names (area + count); bodies have clear
  spacing from the header (§12); reduced-motion respected on expand + deep-link scroll.
- Edit affordances are **keyboard-reachable** (the per-line/card pencils are real buttons; click-to-edit
  also has a focus path); an open editor traps nothing and Escape cancels.
- The confidence read, the trend direction, and the "knows you" read are **text**, never colour/shape
  alone (§9). Scope chips carry text labels. Every icon-only control has an `aria-label`.
- No horizontal overflow at any width; flex text items carry `min-width: 0` (§12).

## 10. Testing strategy

**Component (Vitest + RTL)** — the bulk, since this is renderer-only:

- `Memory` composition: renders the stats strip + collapsed sections; a section expands on click and its
  cards render; a sensitive section stays collapsed on load; search filters; the review callout expands
  into drafts + proposals; empty → getting-started.
- `InsightCard`: read state shows the pencils + per-fact scope chips; clicking the card pencil / a per-line
  pencil / a fact opens inline edit **in place**; Save calls `insights:update` with the merged facts
  (preserving `restricted`/`shareableTypes` — the 44 merge-by-id guard); "This isn't right" flags;
  Approve/Discard on a draft; the long-portrait grouped-fact rendering.
- `PortraitHero` (clamp + read-more + edit-answers link), `TrendsCard` (window toggle + text read + hides
  <2 points), `ResponsesBand` (per-recipient expand), `LifeAreaSection` (header/count/lock + spacing).
- A provenance deep-link opens the right section + focuses the card; a stale id falls back to the overview.

**E2E (Playwright)** — seed a person with insights across ≥2 life areas incl. an Intimacy (restricted)
insight + a draft + a session-mood metric + a response insight. Assert: the page opens with sections
**collapsed** (Intimacy collapsed + locked); expand a section → an insight → **edit a fact inline → Save →
decrypt the vault** to assert the change persisted with its scope/restricted preserved; the review callout
approves a draft; the portrait hero read-more; the trends text read; a **360px overflow guard** (no inner
scrollbars, at real widths). Vault/Claude mocked per the standard harness.

**Visual QA** — real-Electron screenshots at desktop + 360px of: the opened (collapsed) page, an expanded
section with a card mid-edit, the portrait hero, trends, responses. Scrutinize density, alignment, that
editability reads at a glance.

## 11. Open questions

_All resolved 2026-07-14._

1. **Reusable `Collapsible` primitive?** RESOLVED — **extract one** small `Collapsible` design-system
   primitive (header slot + body + `aria-expanded` + spacing baked in), used by the life-area sections,
   the responses band, the review callout, and the portrait read-more; add it to `/gallery` (DoD).
2. **Click-to-edit granularity.** RESOLVED — clicking a **fact** opens an inline editor for **just that
   line**; the card-level pencil opens the **whole card** (summary + all facts). Both write via
   `insights:update` (merge-by-id, preserving `restricted`/`shareableTypes`).
3. **"Knows you" read source.** RESOLVED — **reuse** spec 57's existing "how well it knows you"
   derivation (coverage + confidence), just restyled into the new hero. No behaviour change.

## 12. Changelog

- 2026-07-14 — created + **Approved**. Redesign from two approved `visualize` mockups (cards + top
  surfaces). Decisions: **flatten** to collapsible edit-in-place life-area sections; **redesign all three
  top surfaces** (portrait/trends/responses); **all sections collapsed by default, sensitive always
  collapsed**; extract one `Collapsible` primitive; click-a-fact edits just that line (card pencil = whole
  card); reuse 57's knows-you formula. No new persisted schema; renderer + view-layer only. Follows spec 61.
