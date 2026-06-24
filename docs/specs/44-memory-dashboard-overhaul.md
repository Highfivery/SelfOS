# 44 — Memory dashboard overhaul (read it, get it, trust it)

> **Status:** Built (2026-06-24) · _last updated 2026-06-24_ · **Depends on [`42`](42-relationship-scoped-sharing.md).**
>
> The Memory dashboard ([`20`](20-memory-dashboard.md)) works but is hard to **read, consume, and trust**:
> no at-a-glance summary or stats, trends buried in a collapsed `<details>`, and a per-fact **"flag as
> inaccurate"** affordance that is confusing — flagging _your own onboarding answer_ as inaccurate makes no
> sense (you gave it). This spec overhauls Memory for **clarity + trust**: a **stats summary header**
> (overview counts · confidence breakdown · **sharing summary**), **trends promoted to the top**, a
> **split-by-source correction model** (onboarding-answer facts → _edit the answer_ / delete; AI-inferred
> facts → _"this isn't right about me"_), and a **"what you share & with whom" transparency surface** built on
> [`42`](42-relationship-scoped-sharing.md).

Amends [`20`](20-memory-dashboard.md) (the dashboard, insight card, flag/confidence/provenance, trends) and
builds on [`42`](42-relationship-scoped-sharing.md) (the relationship-type sharing model, `listOutboundSharing`,
`RelationshipScopePicker`). References [`00`](00-architecture.md), [`01`](01-design-system.md),
[`18`](18-personal-onboarding.md) (intake provenance / edit-the-answer deep-link), [`05`](05-conversations.md) (crisis/not-medical).

---

## 1. Overview

**The problem.** Memory is the person's window into _what SelfOS has learned about them_, but:

- **It doesn't summarize.** It opens straight into filters + a long list. There's no "here's what SelfOS
  knows, at a glance" — no counts, no sense of how confident it is, no view of what's flowing to other
  people. Hard to consume; impossible to _trust_ without seeing the sharing picture.
- **Trends are hidden** in a collapsed `<details>` near the bottom — the most scannable, reassuring content
  is the least visible.
- **The flag affordance is confusing.** Every fact gets a tiny **flag icon** whose meaning is unclear, and
  for facts derived from _the person's own onboarding answers_ "flag as inaccurate" is nonsensical — the
  fix is to **edit the answer** (or delete), not flag it. "Flag" only makes sense for things SelfOS
  **inferred** ("you seem avoidant"), which the person can legitimately push back on.

**The change.**

1. **A stats summary header** (the four the user chose, 2026-06-23): **overview counts** (total + by source
   - last updated), **confidence breakdown** (high/med/low), **sharing summary** (what you share, per
     relationship type, with a link to manage), and **trends promoted to the top** (mood/energy at a glance).
2. **Split-by-source corrections** — onboarding-answer facts get **"Edit answer"** (deep-link to that intake
   question, which provenance already supports) + **Delete**; AI-inferred facts (session/dream/questionnaire)
   keep a clearly-labelled **"This isn't right about me"** (the existing flag mechanism, relabelled + only
   where it makes sense).
3. **A transparency / sharing-management surface** — "what you share & with whom," powered by
   [`42`](42-relationship-scoped-sharing.md)'s `listOutboundSharing`, with the
   `RelationshipScopePicker` to adjust scope per fact (replacing the broadcast `ShareToggle`).
4. **Readability polish** — clearer grouping, scannable cards, the stats up top, responsive.

## 2. Goals / Non-goals

**Goals**

- A **stats summary** at the top: overview counts, confidence breakdown, sharing summary, trends.
- A **correction model split by source**: edit-the-answer + delete for onboarding facts; "this isn't right
  about me" for AI-inferred facts — each clearly labelled so the affordance is self-explanatory.
- A **"what you share & with whom"** transparency surface (per [`42`](42-relationship-scoped-sharing.md)),
  with per-fact relationship-type scope editing (replacing the broadcast toggle).
- **Readability & consumption** — promote trends, scannable grouped cards, clear empty/low states,
  responsive ~360px→desktop.
- Preserve [`20`](20-memory-dashboard.md)'s correctness: strict per-person scope, the privacy guard,
  reconciliation/Refresh, drafts ("Needs your review"), provenance, crisis-lead.

**Non-goals (deferred / out of scope)**

- **The sharing model/resolver/`listOutboundSharing`/picker** — those are
  [`42`](42-relationship-scoped-sharing.md); this spec **consumes** them.
- **The onboarding per-question sharing UI** — that's [`43`](43-relationship-scoped-onboarding-sharing.md).
- **A household oversight view for the Owner** — Memory stays self + relationships
  ([`20`](20-memory-dashboard.md) §2).
- **New metrics taxonomies** (spec 11 territory) — Memory _charts_ what producers emit.
- **Changing reconciliation/confidence semantics** — unchanged from [`20`](20-memory-dashboard.md).

## 3. UX & flows

### 3.1 The dashboard (`/memory`, gated `memory.own`) — new top-to-bottom

1. **Header** — "Memory — what SelfOS understands about you," search, **Refresh memory**, filters (source ·
   subject · confidence · flagged) — as today.
2. **Stats summary** (new, §3.2) — a compact card row: overview counts · confidence breakdown · sharing
   summary.
3. **Trends** (promoted, §3.3) — the mood/energy (+ questionnaire) chart, **expanded by default** at the top
   (was a collapsed `<details>` at the bottom). Still collapsible; gentle framing ([`05`](05-conversations.md) §7).
4. **Needs your review** (drafts) — unchanged.
5. **Insights grouped by life-area** — the redesigned card (§3.4).
6. **About people you relate to** — read-only shared facts from relationships (unchanged scope).

Empty/low states warmer and clearer (§7). Crisis footer + not-medical line always present (§8).

### 3.2 Stats summary (the four chosen)

A row of compact stat cards (stack on mobile):

- **Overview** — "SelfOS knows **N** things about you," broken down by source (Onboarding / Sessions /
  Dreams / Questionnaires), and **"Updated <date>."**
- **Confidence** — a small distribution (High / Med / Low counts, text + a non-colour-only bar) with a
  one-line "how well SelfOS feels it knows you" framing — honest, never a score of the person.
- **Sharing** — "You're sharing **M** things — Partner (k) · Family (j) · …" with a **"Manage sharing →"**
  link to the transparency surface (§3.5). Built from `listOutboundSharing`
  ([`42`](42-relationship-scoped-sharing.md)). When nothing is shared: "You're not sharing anything yet."

### 3.3 Trends at the top

The existing `LineChart` mood/energy series, rendered **prominently** above the insight groups (open by
default, collapsible), with the gentle "a reflection, not a measure" framing and a text equivalent (§9).
Questionnaire metric series included where present.

### 3.4 The insight card — split-by-source corrections

Per [`20`](20-memory-dashboard.md) §3.2, plus the correction redesign:

- **Onboarding-answer facts** (`source: 'intake'`): replace the flag with **"Edit answer →"** (deep-links to
  that intake section/question via the existing provenance target — [`18`](18-personal-onboarding.md)) +
  **Delete**. Copy: editing the source answer is how you correct what you told SelfOS; a tooltip explains
  re-synthesizing updates the fact.
- **AI-inferred facts** (`source: 'session' | 'dream' | 'questionnaire'`): keep the flag mechanism but
  **relabel** it **"This isn't right about me"** (a clear toggle, not a bare flag icon) — it still excludes
  the fact from the coach immediately + feeds the correction into future analysis
  ([`20`](20-memory-dashboard.md) §3.6). Flagged facts stay visible, marked, reversible.
- **Per-fact sharing** — replace the broadcast `ShareToggle` with the
  `RelationshipScopePicker` ([`42`](42-relationship-scoped-sharing.md)) so a fact is scoped to relationship
  types, not broadcast. A `restricted` fact shows a clear "sensitive — own coaching only; tap to share with a
  type" affordance that un-restricts + scopes deliberately (the [`42`](42-relationship-scoped-sharing.md) §8
  two-step).
- Confidence chip, category tags, provenance, crisis-lead — unchanged.

### 3.5 "What you share & with whom" (transparency surface)

Reached from the Sharing stat's "Manage sharing →". A focused view listing every item the person shares
(facts + intake answers, via `listOutboundSharing`): the item text, its scope (the relationship-type chips),
and the **concrete people currently receiving it** ("Partner — Sam"). Each row has the
`RelationshipScopePicker` to change scope or set `Private`. A clear header explainer reuses the
[`42`](42-relationship-scoped-sharing.md) §3.2 "informs their AI, never shown to them" copy. This is the one
place to audit and control all outbound sharing.

## 4. Data model (vault files & schemas)

- **No new schema** beyond what [`42`](42-relationship-scoped-sharing.md) adds (`shareableTypes` on facts;
  `answerSharing` on intake sections) — this spec is **read/UX** over them. The existing
  [`20`](20-memory-dashboard.md) `InsightFact.flaggedInaccurate`/`flaggedAt` powers the "this isn't right
  about me" toggle (now scoped to AI-inferred facts in the UI).
- All reads via the vault/crypto service; the bridge stays the trust boundary.

## 5. Architecture & modules

- **Renderer (`routes/memory`)** —
  - `Memory.tsx`: add the **stats summary** row (compute counts/confidence locally from the loaded scoped
    list; sharing summary from `memory:outboundSharing`); **promote Trends** above the groups (open by
    default); keep filters/search/drafts/groups.
  - `InsightCard.tsx`: branch the correction affordance on `insight.source` — `intake` → Edit-answer +
    Delete; others → the relabelled "This isn't right about me." Swap the per-fact `ShareToggle` for the
    `RelationshipScopePicker`.
  - New `SharingPanel` (the §3.5 transparency surface), reachable from the stats card (a route or an in-page
    panel — a `/memory/sharing` sub-route is cleanest).
  - New small `StatsSummary` components (overview / confidence / sharing). Any new design-system primitive →
    `/gallery` (DoD §12); the `RelationshipScopePicker` + `ConfidenceChip` already exist.
- **Stores** — `insightStore` already scoped/per-person-reset ([`20`](20-memory-dashboard.md) §5.1); add an
  `outboundSharing` load (own-scoped) + a `setFactScope(insightId, factId, types)` action (via
  `insights:update` carrying `shareableTypes`). Reset on `activePerson.id` change (the per-person rule).
- **Core** — `listOutboundSharing` + the scope read live in [`42`](42-relationship-scoped-sharing.md); this
  spec consumes them. "Edit answer" reuses the existing intake provenance deep-link
  ([`20`](20-memory-dashboard.md) §3.3 / [`18`](18-personal-onboarding.md)).

## 6. IPC / API contracts

- **`insights:update`** — carries `shareableTypes` on facts (the scope edit); gated `memory.own`,
  active-person-scoped (unchanged channel, additive field).
- **`insights:flag`** — unchanged; the UI now only surfaces it for AI-inferred sources (relabelled).
- **`memory:outboundSharing`** — consumed (defined in [`42`](42-relationship-scoped-sharing.md)); own-scoped,
  gated `memory.own`.
- **`intake:setAnswerSharing`** (built 2026-06-24) — changes ONE already-answered intake question's
  `answerSharing` scope without re-doing onboarding (the transparency surface's per-answer picker). Gated
  `intake.own`, active-person-scoped; empty `types` ⇒ Private. (Resolved the §3.5-vs-§6 gap: intake answers are
  scope-editable in place, not just shown — owner decision, 2026-06-24.)
- **No Claude call** added (Refresh-memory reconciliation is unchanged, [`20`](20-memory-dashboard.md) §5.2).
  The key stays in main.

## 7. States & edge cases

- **No insights** → warm empty state (as today); stats hidden/omitted when empty.
- **Nothing shared** → the Sharing stat reads "You're not sharing anything yet" + a hint about how sharing
  works; the transparency surface shows an empty, explained state.
- **Intake fact with a removed source section** → "Edit answer" still routes to the section (or shows
  "original source removed" if the section/answer is gone, [`20`](20-memory-dashboard.md) §3.7); Delete
  always works.
- **AI-inferred fact flagged** → excluded from coach immediately; stays visible/marked/reversible.
- **Restricted fact** → shown as sensitive/own-only; scoping requires the deliberate un-restrict + type
  choice ([`42`](42-relationship-scoped-sharing.md) §8).
- **Scope edit on a related person's read-only card** → not offered (you can't change another person's
  sharing — the bridge rejects it anyway).
- **AI off / over budget** → the dashboard fully renders; Refresh + scope reads still work (no AI needed for
  stats/sharing).
- **Per-person switch** → store reset; no carryover.
- **Large memory** → grouped + filtered + searchable; stats computed over the scoped list; lazy-render long
  groups.
- **Sync conflict / corrupt** → standard vault behaviour; a corrupt fact degrades, never silently shares.

## 8. Safety, privacy & honesty

- **The [`20`](20-memory-dashboard.md) §8 privacy headline holds** — per-person scope; related people
  contribute only shareable, non-restricted facts; restricted own-intake facts are owner-visible/redacted as
  before. The sharing surface shows only the person's **own** outbound sharing.
- **Trust through transparency** — the sharing summary + the "what you share & with whom" surface make
  outbound sharing **legible and controllable**; replacing the broadcast toggle with relationship-type
  scoping removes a real over-share footgun.
- **Honest corrections** — "Edit answer" (you change what you told us) vs "This isn't right about me" (you
  correct what we inferred) are distinct, self-explanatory, and respected (the flag still drops the fact from
  the coach + feeds future analysis).
- **Not-medical / crisis** ([`05`](05-conversations.md) §7) — crisis-flagged insights lead with resources;
  the footer + not-medical line are always present; trends framed gently, never clinical.

## 9. Accessibility

Per [`01`](01-design-system.md) §9: the stats cards are semantic, with text equivalents (confidence as
text, not colour-only; the bar is decorative); Trends carries a text equivalent + an `aria-label`; the
correction affordances are labelled buttons ("Edit answer", "This isn't right about me — toggle"); the
sharing surface + per-fact `RelationshipScopePicker` reuse [`42`](42-relationship-scoped-sharing.md)'s a11y.
Responsive ~360px→desktop — stats stack, filters never horizontally scroll, no inner scrollbars (the §12 DoD
guard at the real container widths). Reduced-motion respected.

## 10. Testing strategy

- **Component (RTL):** the stats summary renders correct counts/by-source/confidence-breakdown from a seeded
  scoped list, and a sharing summary from a mocked `outboundSharing`; Trends renders **above** the groups,
  open by default; an `intake` fact shows **Edit answer + Delete** (no flag), a `session` fact shows **"This
  isn't right about me"** (no edit-answer); the per-fact `RelationshipScopePicker` sets `shareableTypes` via
  `insights:update`; the transparency surface lists items + recipients + lets you change scope; empty/nothing-
  shared states.
- **Unit (core):** the stats derivations (counts/by-source/confidence buckets) are pure + correct;
  `listOutboundSharing` integration (covered in [`42`](42-relationship-scoped-sharing.md)).
- **E2E (Playwright):** seed onboarding + a session insight; open Memory → stats show the right totals +
  confidence + sharing summary; **Edit answer** on an intake fact deep-links to the onboarding section;
  **"This isn't right about me"** on a session fact → (decrypt) absent from a later `buildContext`; open
  "Manage sharing," scope a fact to `partner` → (decrypt) it reaches the partner's context; the broadcast
  toggle is gone. 360px overflow + inner-scrollbar guards (the §12 narrow-container check).
- Vault + Claude mocked as established; decrypt to assert. Run `pnpm typecheck` after tests.

## 11. Open questions

_Resolved ask-first (2026-06-23):_

- **Stats to surface** → overview counts · confidence breakdown · sharing summary · **trends at the top**
  (all four).
- **Flag affordance** → **split by source** — Edit-answer + Delete for onboarding facts; relabelled "This
  isn't right about me" for AI-inferred facts.
- **Sharing control in Memory** → the [`42`](42-relationship-scoped-sharing.md) `RelationshipScopePicker`
  (relationship-type scoping), replacing the broadcast `ShareToggle`; a dedicated "what you share & with
  whom" surface.

_Build-time tuning:_ whether the transparency surface is a `/memory/sharing` sub-route or an in-page panel
(sub-route recommended for focus); exact stat-card copy + the confidence framing wording; whether to also
show a tiny per-group count on each life-area header (recommended, cheap).

## 12. Changelog

- 2026-06-24 — **Fix — clean cards** (`fix/onboarding-sharing-end-to-end`, user-reported). The per-fact
  read-only "Private/Shared" chip on **onboarding** facts produced a wall of "Private" chips on a portrait
  (cluttered, misaligned). Removed: onboarding facts now carry **no per-fact sharing chip** (a restricted one
  keeps a small informational "sensitive" tag); their sharing is share-by-default + managed via the answer and
  the **Manage sharing** panel (now populated by the spec-43 backfill). **AI-inferred** facts keep the discreet
  `FactSharingControl` (you still need a way to share a session/dream insight). The Sharing summary + Manage
  sharing panel are the one place to see/control what's shared.
- 2026-06-24 — **Audit follow-up** (`fix/relationship-sharing-audit-followups`): the per-fact
  `RelationshipScopePicker` was editable for **onboarding (`source: 'intake'`)** facts, but an intake fact's
  scope is **derived from its answer's `answerSharing`** (spec 43 §4) and **recomputed on every
  re-synthesis** — so a direct Memory edit silently reverted (and could re-widen a narrowed scope). Intake
  facts now show their scope **read-only** in both the insight card (a "Set by your onboarding answer" chip)
  and the SharingPanel; you change their sharing via **Edit answer** / the answer's scope control (the single
  source of truth). AI-inferred facts stay directly editable. +RTL assertion (no editable picker on an
  intake fact). Gate green with spec 42's audit fixes.
- 2026-06-24 — **Built.** Stats summary header (`StatsSummary` — overview/confidence/sharing, pure `stats.ts`
  derivations), **Trends promoted to the top** (open by default), **split-by-source corrections** in
  `InsightCard` (onboarding facts → **Edit answer** deep-link + Delete, no flag; AI-inferred → the relabelled
  **"This isn't right about me"** toggle), the broadcast `ShareToggle` replaced by the per-fact
  `RelationshipScopePicker` (`FactSharingControl`, incl. the [`42`](42-relationship-scoped-sharing.md) §8
  deliberate un-restrict two-step for a sensitive own fact), and a **`/memory/sharing` transparency surface**
  (`SharingPanel`) listing every shared item + recipients with in-place scope editing. Owner decision
  (2026-06-24): intake answers are scope-editable in place → new **`intake:setAnswerSharing`** channel +
  `setIntakeAnswerSharing` core fn (resolving the §3.5↔§6 gap). Extended the `insights:update` facts contract
  with additive `shareableTypes`/`restricted` (merged by id server-side, so a normal edit preserves them).
  Extracted the shared `availableRelationshipTypesFor` helper (Memory/SharingPanel/onboarding). Gate green:
  typecheck, lint, format, **715 core + 767 desktop** unit (+stats, +StatsSummary, +FactSharingControl,
  +SharingPanel, +setIntakeAnswerSharing core, +2 coreBridge: scope-a-fact-to-partner/un-restrict + answer
  scope), **E2E +1** (stats header → type-scope a fact to partner [decrypt reaches partner], "not right"
  [decrypt absent from own context], Manage sharing surface, Edit answer deep-link, 360px guards). **Lesson:
  `updateInsight` REPLACES the facts array with the patch, so a per-fact scope edit must send EVERY fact (the
  changed one + the rest minimal, preserved by merge-by-id) or it silently drops the others; and a still-open
  picker popover overlays a sibling row's control — close it (Escape) before the next click.**
- 2026-06-23 — created (Draft). The Memory half of the relationship-sharing group; depends on
  [`42`](42-relationship-scoped-sharing.md), independent of [`43`](43-relationship-scoped-onboarding-sharing.md).
  Decisions resolved ask-first (2026-06-23): the four stats (overview/confidence/sharing/trends-at-top),
  split-by-source corrections, and relationship-type per-fact scoping + a transparency surface. Amends
  [`20`](20-memory-dashboard.md). Build-ready pending final approval.
