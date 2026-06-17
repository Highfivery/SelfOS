# 20 — Memory: the living insights dashboard

> **Status:** Approved — building (slice 1 of 3 built) · _last updated 2026-06-16_
>
> Memory is meant to be the person's window into **what SelfOS has learned about them** — yet today it
> (1) **leaks every household member's insights to whoever is logged in** (a serious privacy bug), and
> (2) is a flat, static list with no grouping, search, confidence, provenance, or feedback. This spec
> rebuilds Memory as a **per-person, living insights dashboard**: strictly scoped to the active person +
> their relationships, organized by life-area with filtering/search, showing an **AI-generated confidence
> that updates over time**, with the ability to **edit, delete, see where each insight came from, and flag
> it as inaccurate** — and it **self-reconciles** as new sessions, dreams, questionnaires, and onboarding
> come in. No backward-compatibility or legacy support is required (pre-release).

New feature spec; **supersedes** the questionnaire-era Memory surface (08 §13.4). Reworks the shared Insight
layer ([`08`](08-questionnaires.md) §1.1/§4.4) consumed by [`05`](05-conversations.md)/[`09`](09-session-analysis.md)
(sessions), [`12`](12-dreams.md)/[`13`](13-dream-images.md) (dreams), [`08`](08-questionnaires.md)
(questionnaires/compatibility), and [`18`](18-personal-onboarding.md) (intake) — the four producers. Honors the
per-item shareability of [`15`](15-shareability.md) and the per-person isolation rule. References
[`00`](00-architecture.md)/[`01`](01-design-system.md)/[`06`](06-ai-usage-and-budgets.md).

---

## 1. Overview

### 1.1 The privacy bug (fixed here, first-class)

`coreBridge.insightsList` calls `listAllInsights` (every subject's insights across the household) and gates
**only** on `questionnaires.viewResults` — a **default Member capability** — and never scopes to the active
person. `redactRestrictedFacts` strips only _restricted_ facts, never filters by _subject_. So **any signed-in
member sees every member's onboarding portraits + session/dream/questionnaire insights.** Every sibling list
(`conversationsList`, `dreamsList`) correctly scopes to `activePersonId` in the bridge; insights is the lone
exception. Secondary leak: `useInsightStore` is missing from the AppShell per-person reset, so insights linger
across a person switch.

**This spec makes correct scoping the foundation:** Memory shows the **active person's own insights** plus
**only the shareable facts about the people they relate to** — for **every** user including the Owner (the
Owner's broader access to a specific person stays in People, not Memory). This is exactly the boundary
`summarizeForContext` already enforces for `buildContext`; Memory reads through the same gate.

### 1.2 The living dashboard

Beyond the fix, Memory becomes a real dashboard: a per-person view of everything AI has analyzed, organized by
**life-area**, searchable/filterable, where each insight carries an **AI-generated confidence** that **updates
as new evidence arrives**. The person can **edit**, **delete**, **jump to the source**, and **flag as
inaccurate** (which immediately stops it informing the coach and corrects future analysis). A **compact trends
section** charts the metrics AI has tracked (mood/energy, questionnaire signals). It **self-reconciles** on
every analysis pass (no extra spend) and offers a manual **"Refresh memory."**

## 2. Goals / Non-goals

**Goals**

- **Strict per-person scope** — own insights + relationships' _shareable_ facts only; never other members'.
  The leak is closed in the bridge (the trust boundary) + the store resets per person.
- A **modern dashboard**: life-area grouping, filters (source · subject · confidence · flagged), full-text
  search, a distinct **"Needs your review"** section for pending drafts, and a **trends** section.
- **Living, AI-generated confidence** that updates as new analyses corroborate/contradict, with a
  human-readable rationale ("based on N sources · updated <date>").
- **Reconciliation** that rides each analysis pass (no extra AI spend): a new analysis re-evaluates the
  subject's existing insights — adjusting confidence, merging duplicates — and a manual **Refresh memory**
  forces it on demand.
- Per-insight/fact **edit, delete, provenance navigation, and flag-as-inaccurate** (drops from the coach
  instantly + feeds the correction into future analysis).
- **Insights persist** even when an originating source is deleted (memory isn't gutted by cleanup).

**Non-goals (deferred / out of scope)**

- **A household oversight view for the Owner** — Memory is self+relationships for everyone; cross-person
  visibility is not reintroduced here.
- **A separate consolidated "one canonical brain" knowledge layer** — we reconcile _per-source_ insights
  (adjust/merge/supersede), not build a distinct deduped knowledge store.
- **Background/scheduled reconciliation** — reconciliation rides analysis passes + the manual refresh; no
  cron/daemon.
- **Authoring metrics taxonomies** (spec 11 territory) — Memory _charts_ the metrics producers already emit.
- **Relationship-scoped insights** about a pair (deferred elsewhere).

## 3. UX & flows

### 3.1 The dashboard (`/memory`, gated by the new `memory.own`)

Top to bottom:

1. **Header** — "Memory — what SelfOS understands about you," a **search** box (full-text over summaries +
   facts), a **Refresh memory** action (§3.5), and **filters**: source (Onboarding/Sessions/Dreams/
   Questionnaires), subject (You / each related person), confidence (Low/Med/High), and a **Flagged** toggle.
2. **Needs your review** (only if any) — pending **draft** insights (questionnaire/compatibility, `approved:
false`) with **Approve / Edit / Discard**, clearly separated from what's already informing the coach.
3. **Trends** (§3.4) — a compact metrics-over-time section (collapsible).
4. **Insights, grouped by life-area** — themed sections (Relationships, Family, Work & purpose, Health & body,
   Emotions & patterns, Values & beliefs, Intimacy, Goals & growth, Money, Faith, Other — final taxonomy §11),
   each holding the active person's insight cards. Related people's **shareable** facts appear under their own
   subject (filterable), never their private/restricted content.

Empty state: a warm "As you have sessions, log dreams, and answer questionnaires, what SelfOS learns shows up
here." The crisis footer + not-medical line are always present (§8).

### 3.2 The insight card

- **Summary** + its **facts** (each fact: text, a **share** toggle [15], a **flag-inaccurate** toggle [§3.6],
  and a "sensitive" tag for the user's own restricted facts).
- **Confidence indicator** — Low/Med/High (text + a non-color-only visual) with a tooltip rationale: "based on
  N sources · last updated <date>."
- **Provenance** — "From a session on <date> →" / "From onboarding →" / "From a dream →" / "From a
  questionnaire →" that **navigates to the source** (§3.3); after a merge, "From N moments →" lists them.
- **Subject** — "About you" or "About <related person>."
- **Actions** — Edit (summary/facts), Delete, Flag, per-fact Share. Crisis-flagged insights **lead with
  resources** (§8).

### 3.3 Provenance navigation ("where it came from")

Each insight's `provenance` deep-links to its origin: a session opens that conversation; a dream opens the
dream; a questionnaire opens its Results; onboarding opens that intake section. If the source was **deleted**,
the link shows **"original source removed"** (the insight persists — §3.7/§7).

### 3.4 Trends

A collapsible section charting the **metrics** AI already emits over time for the active person — mood valence
& energy (sessions), and any questionnaire metric signals — using existing chart primitives
(`LineChart`/`TrendLine`). Home keeps its at-a-glance wellbeing trend; Memory is the deeper view. Framed gently
(§8), never clinical.

### 3.5 Refresh memory + self-update

- **Automatic (no extra spend):** every time a source is analyzed (end-&-summarize a session, analyze a dream,
  analyze a questionnaire, synthesize intake), the **reconciliation step rides that pass** (§5.2) — adjusting
  the subject's existing insights' confidence and merging duplicates, alongside producing the new insight.
- **Manual:** a **Refresh memory** action re-runs reconciliation over the active person's insights on demand
  (budget-gated, metered `memory.reconcile`) — for when the user wants to force a re-evaluation. Calm states
  when AI is off / over budget (the dashboard still renders existing insights).

### 3.6 Flag as inaccurate (the feedback loop)

Flagging a fact (or whole insight) as inaccurate:

- **Immediately** excludes it from `summarizeForContext`, so the coach stops using it at once.
- **Records the correction** (`flaggedInaccurate` on the fact) so the **next analysis/reconciliation is told**
  "the person says this is wrong — don't re-assert it; correct course."
- Stays **visible in Memory, marked "flagged,"** and **unflaggable** (reversible). It is not deleted (so the
  correction signal persists); reconciliation may drop or rewrite it over time.

### 3.7 Source deletion

Deleting a source (session/dream/questionnaire) **no longer deletes its insight** (today it cascades). The
insight persists as the coach's memory; its provenance link shows the source is gone. The person removes
insights deliberately from Memory (Delete). This also fits merged cross-source insights that no longer map 1:1
to one source.

## 4. Data model

Clean changes (pre-release; no migration/back-compat). All reads/writes through the vault/crypto service.

### 4.1 Schema additions (`packages/core/src/schemas.ts`)

- **`InsightFact`** gains:
  - `flaggedInaccurate?: boolean` + `flaggedAt?: string` — the user's correction signal (§3.6).
- **`Insight`** gains:
  - `categories: string[]` — life-area themes from a fixed taxonomy (§3.1; AI-assigned, rides analysis).
  - `lastReconciledAt?: string` — when reconciliation last touched it.
  - `contributingSources?: Provenance[]` — extra source provenances folded in on merge (the primary
    `provenance` stays the origin); powers "from N moments."
  - `confidenceRationale?: string` — a short, human-readable basis ("corroborated by 3 sessions").
  - `confidence` is unchanged in shape (`low|medium|high`) but is now **genuinely set + updated** by AI, not a
    fixed default.
- Storage path is unchanged: `people/<subjectPersonId>/insights/<id>.enc` (already per-subject).

### 4.2 Capability

Add **`memory.own`** (Member default ON) gating the Memory dashboard + the insight read/edit/flag/refresh
operations for one's own memory. The questionnaire **Results** surface keeps `questionnaires.viewResults`;
Memory no longer borrows it. (`questionnaires.viewResults` no longer implies seeing all insights.)

### 4.3 Reconciliation contract

Reconciliation (AI) takes, for one subject: the **new analysis** (when riding a pass) or nothing (manual
refresh), plus the subject's **existing active insights** (summaries, facts, confidence, categories, and which
facts are **flaggedInaccurate**). It returns operations: set each insight's `confidence` (+ `rationale`),
**merge** insight A into B (fold A's facts into B, append A's provenance to B's `contributingSources`, delete
A), assign `categories`, and **must not re-assert** any `flaggedInaccurate` fact. It only ever sees/affects the
**one subject's own** insights (never cross-subject) — a privacy invariant of the prompt assembly.

## 5. Architecture & modules

### 5.1 The privacy fix (foundational)

- **Bridge** — rewrite `coreBridge.insightsList` to resolve `activePersonId()` and return **the active
  person's own insights** (`listInsightsForPerson`) **+ related people's shareable, non-restricted facts**
  (the `summarizeForContext` rule, reusing `listRelatedPeople`), gated by `memory.own`. Never `listAllInsights`
  for the dashboard. Own restricted facts show to the user (their own data); related people's restricted facts
  never appear. (`listAllInsights` stays only for legitimate cross-cutting internal uses, never the dashboard.)
- **Renderer** — add `useInsightStore` to the AppShell per-person reset effect; the store loads the scoped
  list and resets on `activePerson.id` change. The Memory component never receives other subjects' data.

### 5.2 Reconciliation engine (`@selfos/core/insights`)

- A `reconcileInsights` core function implementing §4.3, invoked (a) by each producer's analysis pass after it
  saves the new insight (passing the new insight + the subject's existing ones; metered under the producer's
  existing usage type — **no new spend**), and (b) by the manual **Refresh** (metered `memory.reconcile`).
- Reuses the budget→call→record pattern; **meter before parse** (09 precedent). Honors flagged facts. Cheap:
  it operates on insight summaries/facts (small), not raw transcripts.
- Producers (`intake`/`session`/`dream`/`questionnaire` analysis) gain a post-save reconciliation hook +
  category assignment. `summarizeForContext` already excludes restricted-from-others; extend it to **exclude
  `flaggedInaccurate` facts** from everyone's context.

### 5.3 Renderer

- Rebuild `routes/memory/Memory.tsx` into the dashboard (§3): header/search/filters, Needs-your-review,
  Trends, life-area groups, the redesigned insight card. New small components (group, card, confidence chip,
  filter bar, trends panel) on the design system; any new primitive → `/gallery` (DoD §12). `insightStore`
  gains scoped load, search/filter selectors, flag, refresh. Responsive ~360px→desktop.

### 5.4 Deletion behavior

Remove the insight-cascade from source deletion across the producers/`deletionService` (§3.7): deleting a
session/dream/questionnaire leaves its insight intact (provenance shows the source gone). Memory's own Delete
is the way to remove an insight.

## 6. IPC / API contracts

All gated by **`memory.own`** + **active-person-scoped in the bridge** (the trust boundary); the Claude key
stays in main.

- `insights:list` — **rescoped** (§5.1): active person's own + relationships' shareable/non-restricted facts.
- `insights:update` / `insights:approve` / `insights:delete` — as today, scoped to the active person's own
  insights (a person can't edit another's).
- `insights:flag({ insightId, factId?, flagged })` — set/clear `flaggedInaccurate` (own insights); excludes
  from context immediately.
- `memory:refresh()` — runs the manual reconciliation pass for the active person; budget-gated; typed
  `NO_KEY`/`BUDGET`/`AI_OFF` envelopes.
- `memory:trends()` (or compose from the scoped list) — the metrics-over-time series for the active person.
- Provenance navigation uses existing per-source routes (no new IPC).

## 7. States & edge cases

- **No insights** → warm empty state (§3.1).
- **AI off / over budget** → the dashboard fully renders existing insights; Refresh + analysis-time
  reconciliation degrade calmly (no dead buttons).
- **Flagged fact the model re-derives anyway** → the **user's flag wins**: a flagged fact is excluded from
  context and the analysis prompt is told not to re-assert it; if a new analysis still produces an equivalent
  fact, reconciliation maps it onto the flagged one rather than resurrecting it silently (build detail).
- **Relationship removed** → related-person facts drop from Memory immediately (re-gated at read, like
  context).
- **Source deleted** → insight persists; provenance shows "source removed" (§3.7).
- **Merge** → A folds into B (facts deduped, provenances combined); the card shows "from N moments"; no
  orphan.
- **Drafts** (`approved:false`) → only in "Needs your review"; never feed context until approved.
- **Restricted (own intake) facts** → visible to the user in their own Memory, tagged sensitive; never shown
  for a related person.
- **Per-person switch** → store reset; no carryover (the secondary leak, fixed §5.1).
- **Large memory** → grouped + filterable + searchable; lazy-render long groups.
- **Crisis-flagged insight** → leads with resources (§8).

## 8. Safety, privacy & honesty

- **Privacy is the headline** (§1.1/§5.1): the bridge scopes to the active person; related people contribute
  only shareable, non-restricted facts; the reconciliation prompt only ever sees one subject's own insights.
  The fix is asserted by an explicit cross-user E2E (§10) so it can't silently regress again.
- **Not medical / crisis** ([`05`](05-conversations.md) §7): crisis-flagged insights and the trends framing
  lead with concern + resources, never diagnosis; the "Get help now" footer + not-medical line are always
  present.
- **Honest confidence** — confidence + rationale reflect real corroboration, never inflated; flagging is a
  first-class correction the system visibly respects.
- **Restricted intake data** — own-context-only invariant unchanged; never surfaced for others, never fed to
  others' context; `flaggedInaccurate` facts excluded from everyone's context.

## 9. Accessibility

Per [`01`](01-design-system.md) §9: semantic headings per life-area group; the filter bar + search + Refresh +
flag/share toggles are labelled, keyboard-operable, with visible focus; confidence is conveyed as **text**, not
color alone; trends charts carry text equivalents; the "Needs your review" region is announced. Responsive
~360px→desktop (groups stack; filters collapse to a sensible control, never a horizontal scroll). Reduced-motion
respected.

## 10. Testing strategy

- **Privacy (the regression guard):** an E2E + a bridge unit test asserting **member A cannot see member B's
  insights** (sign in as A → `insights:list` returns only A's own + A's relationships' shareable facts; B's
  onboarding portrait is **absent**) — decrypt the vault to verify; and the per-person store **reset** on
  switch (A's insights gone after switching to B).
- **Unit (core):** `reconcileInsights` adjusts confidence, merges duplicates (folds facts + provenance,
  deletes the dup), assigns categories, and **never re-asserts a `flaggedInaccurate` fact**; `summarizeForContext`
  **excludes flagged facts** from own + others' context; reconciliation only sees one subject; source deletion
  **keeps** the insight; flag excludes from context immediately.
- **Component (RTL):** the dashboard renders grouped/filtered/searched insights; Needs-your-review shows only
  drafts; the confidence chip + rationale; provenance link (incl. "source removed"); flag/unflag; trends;
  AI-off/over-budget calm states.
- **E2E (Playwright):** analyze a session → an insight appears under a life-area with a confidence; flag a fact
  → it's marked + (decrypt) absent from a later `buildContext`; provenance opens the source; delete the source
  → the insight persists; Refresh memory runs; 360px + control-geometry guards.
- Use the established fakes (`SELFOS_FAKE_CLAUDE`); decrypt the vault to assert data, not just the UI. Run
  `pnpm typecheck` after tests (memory `vitest-does-not-typecheck`).

## 11. Resolved decisions (build-time, 2026-06-16)

All resolved:

- **Life-area taxonomy** — the fixed set: Relationships, Family, Work & purpose, Health & body, Emotions &
  patterns, Values & beliefs, Intimacy, Goals & growth, Money, Faith, Other; each insight tagged with **1–2**
  categories.
- **Confidence** — keep **3 levels** (Low/Med/High) + the rationale text (no 0–100% false precision).
- **Merge** — **conservative**: merge only clearly-identical facts; prefer adjusting confidence over merging,
  to avoid collapsing distinct nuances.
- **Refresh-memory cost** — **normal budget**, no per-period cap (it operates on insight text, not
  transcripts).
- **Intake provenance** — deep-link to the **specific onboarding section** when available (else the onboarding
  surface).

The spec is build-ready pending final approval.

## 12. Resolved decisions (2026-06-16)

- **Scope** — Memory shows the active person's **own insights + relationships' shareable facts only**, for
  **everyone including the Owner** (no household oversight view in Memory). Fixed in the bridge + a per-person
  store reset; guarded by a cross-user E2E.
- **Architecture** — **living, reconciled per-source insights** (adjust confidence / merge / supersede), not a
  separate consolidated knowledge layer.
- **Confidence updates** — **ride each analysis pass** (no extra spend) **+ a manual "Refresh memory"** action.
- **Flag-as-inaccurate** — **immediately drops the fact from the coach** + feeds the correction into future
  analysis; stays visible, marked, reversible (not deleted).
- **Organization** — **by life-area/theme** (AI-tagged), with source/subject/confidence/flagged filters +
  full-text search.
- **Trends** — Memory **includes a compact metrics/trends section**; Home keeps its at-a-glance version.
- **Pending review** — a **distinct "Needs your review"** section for drafts.
- **Source deletion** — **keep the insight** (provenance notes the source is gone); remove the cascade.
- **Capability** — new **`memory.own`** (Member default ON) gates Memory; Results keeps `questionnaires.viewResults`.
- **Taxonomy/confidence/merge/provenance** (§11) — fixed life-area set, 1–2 categories per insight; 3-level
  confidence + rationale; conservative merge; manual Refresh on normal budget; intake provenance deep-links to
  the section.

## 13. Changelog

- 2026-06-16 — **Slice 1 built (the privacy fix, §1.1/§5.1/§6).** Added the `memory.own` capability (Member
  default ON); rewrote `coreBridge.insightsList` to gate on `memory.own` + scope to the active person's OWN
  insights + their relationships' **shareable, non-restricted** facts (new core
  `listRelatedShareableInsights`, mirroring the `summarizeForContext` boundary — strips the related summary
  **and** projects out `metrics`/`crisisFlag`/precise `provenance`/`relationshipId`/a fact's `shareableWith`
  so only the shareable fact text crosses the IPC seam; excludes drafts/restricted/dream-muted; drops empty);
  **never** `listAllInsights` for the dashboard. Locked `insights:approve`/`update`/`delete` to `memory.own`
  - `subjectPersonId === activePersonId`. Added `useInsightStore` to the AppShell per-person reset (+ a store
    `reset()`); re-pointed the Memory nav + Home MemoryCard gating to `memory.own`. The current
    (questionnaire-era) Memory surface shows only the person's OWN insights for now (related display lands with
    the §5.3 dashboard, slice 3) — no half-built related cards or dead controls. Cross-user **regression guard**:
    a bridge unit test + an E2E (member A's `insights:list` returns only A's own; B's portrait is absent;
    decrypt the vault to prove B's insight exists but is withheld; switching to B flips the view). Status →
    Approved. **Follow-up flagged:** `redactRestrictedFacts` + the `intake.readRestricted` capability are now
    dead (their only consumer was the removed leak path) — a separate cleanup, not folded into the privacy fix.
    **NEXT: slice 2** (the living insights engine) → **slice 3** (the dashboard UI).
- 2026-06-16 — created (Review). Decisions resolved ask-first across two rounds. Fixes the cross-user insight
  leak (bridge scoping + per-person reset) and rebuilds Memory as a living, life-area-organized insights
  dashboard with AI confidence that self-updates, flag-as-inaccurate feedback, provenance navigation, trends,
  and source-deletion-keeps-insight. Build-ready pending final approval. Supersedes 08 §13.4's Memory surface.
