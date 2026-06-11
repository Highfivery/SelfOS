# 12 — Dreams (guided dream journaling, analysis & patterns)

> **Status:** **Approved** · _last updated 2026-06-11_
>
> Dreams lets a person capture dreams in seconds, then — when they choose — work through a **guided AI
> analysis** that ends in a structured, readable write-up. Once the person approves it, that analysis
> becomes a durable **Insight** (`source: 'dream'`) that makes the coach smarter **everywhere** (chat,
> questionnaire generation, the gap-finder…). Dreams is the **third producer** into the shared **Insight /
> metrics layer** defined in [`08-questionnaires.md`](08-questionnaires.md) §1.1/§4.4 (questionnaires is the
> first, session analysis [`09`](09-session-analysis.md) the second). Cross-dream **patterns** (recurring
> symbols, people, emotions, themes) are in scope from v1, built on the same metrics mechanism. **AI image
> generation of a dream is explicitly deferred to its own companion spec** (§2, §11).

Builds on [`00-architecture.md`](00-architecture.md) (vault, IPC, security, feature-module registry),
[`01-design-system.md`](01-design-system.md), [`03-settings.md`](03-settings.md) (settings registry),
[`04-people-roles.md`](04-people-roles.md) (people, relationships, capabilities, encryption,
`buildContext`, shareable-vs-private, super-admin honesty model),
[`05-conversations.md`](05-conversations.md) (the streaming chat engine + crisis/not-medical safety this
reuses), [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (every AI call is metered +
budget-gated), and **`08`/`09`** (the shared Insight/metrics layer + the per-fact shareable promotion model
this mirrors).

---

## 1. Overview

A dream evaporates within minutes of waking, so the feature is built **capture-first**: a frictionless
brain-dump always works, even offline and with AI disabled — journaling has standalone value. When the
person has time, they open a **guided analysis**: a dream-scoped chat where the coach asks a few focused,
one-at-a-time reflective questions, then — on the person's cue — **synthesizes** a structured, readable
analysis (summary, emotional landscape, possible waking-life connections, notable images/symbols,
reflective questions). The person edits it and **approves** it; only then does it distill into an
**Insight** that feeds `buildContext` like every other approved Insight — so the coach gains dream-informed
understanding **with no new context plumbing**. The same analysis emits **structured tags** (emotions,
symbols, settings, themes, people) onto the dream, which power **cross-dream patterns** (deterministic
stats + charts) plus a periodic AI "what I'm noticing across your recent dreams" narrative.

The feature is four loosely-coupled parts, kept separate so each can grow independently:

1. **Capture** — fast narrative dump + optional quick fields (waking mood, vividness, lucid/nightmare
   flags, sleep context, tags, people present). No AI required.
2. **Guided analysis** — a dream-scoped reflective chat (reusing `05`'s engine) culminating in a
   schema-validated **structured analysis** the person edits and approves.
3. **Assimilation** — the approved analysis becomes an **Insight** (`source: 'dream'`) feeding the coach;
   specific facts can be **shared per-dream** into a related person's context (off by default).
4. **Patterns** — recurring symbols/people/emotions/themes over time (computed from structured tags) plus
   a periodic AI narrative; surfaces a gentle, non-clinical nudge to professional resources when recurring
   nightmares / trauma signals warrant it.

### 1.1 Relationship to the shared Insight / metrics layer

Dreams does **not** define new long-term-memory infrastructure. It **produces** `Insight` records into the
layer `08` §4.4 owns (and `09` already builds on): same `insightStore`, same `approved` gate, same
`metrics` map, same `buildContext` consumption, same "what the coach knows" management surface. The only
shared-schema changes are **additive**: `'dream'` joins the `InsightSource` enum and `provenance` gains an
optional `dreamId` (§4). These amend `08` and are synced there via `sync-docs` — the same pattern by which
`09` amended `Conversation` and `08` amended `Person`.

## 2. Goals / Non-goals

**Goals**

- **Capture-first journaling**: a frictionless narrative dump + optional quick fields, working **offline /
  AI-off**, encrypted per-person.
- **Guided → synthesized analysis**: a dream-scoped reflective chat (reusing `05`) that ends in a
  **structured, editable, schema-validated** analysis; budget-gated + metered (`06`).
- **Blended, honest analytical voice**: evidence-based reflection (cognitive-experiential dream work,
  the continuity hypothesis, content-analysis description) **interwoven** with symbolic/archetypal
  readings, the latter always framed as **imaginative reflection, not decoded fact** — never clinical
  interpretation or diagnosis (§8.1).
- **Approve → context**: nothing reaches the coach until the person approves it; on approval the analysis
  becomes an **Insight** (`source: 'dream'`) feeding `buildContext` (the primary product goal). Fully
  editable/deletable/sourced afterward; a "remove from context" un-approves it.
- **Per-dream sharing**: specific dream-insight facts can be promoted to **shareable** into a related
  person's context (default **off**), mirroring `09` §3.3's per-fact promotion.
- **Cross-dream patterns in v1**: deterministic stats + charts (recurring symbols, people frequency,
  emotion/theme recurrence, lucid/nightmare rates, mood/vividness trends) from per-dream **structured
  tags**, **plus** a periodic AI narrative; the chart primitives land in `/gallery`.
- **Strong privacy**: dreams are the most sensitive content — dreamer-only in normal use, with a per-dream
  **sensitivity tier** (reusing the existing `SensitivityTier`) that keeps intimate dreams out of shared
  context (§8.3/§8.4).
- **Full metering**: every AI call (`dream.analyze`, `dream.patterns`) is budget-gated and recorded
  through `06`, charged to the dreamer.

**Non-goals (deferred / owned elsewhere)**

- **AI image generation of a dream** — explicitly its **own future companion spec**. It introduces a
  _second AI provider_ (OpenAI), a third-party consent flow, **binary-blob vault storage the vault does not
  support today** (text/`.enc`-only), per-image (flat-fee) cost the token-based budget model doesn't yet
  represent, content-policy refusal handling, and real-person likeness concerns. Its open sub-questions are
  parked in §11 so nothing is lost, but **no image scaffolding ships in this spec** (CLAUDE.md §12: no
  scaffolding for unbuilt features).
- **The Insight/metrics schema, store, and `buildContext` plumbing** — owned by `08`; this spec only
  produces into the layer (with the two additive amendments in §4).
- **Voice capture** — deferred per the stack; the capture model is voice-ready (a single narrative field)
  but v1 is text. No architectural choice precludes it.
- **Scheduled morning reminders / notifications** — out of scope (the user opted out for v1; would need
  Electron + iOS notification plumbing).
- **Dream-access break-glass auditing** — v1 relies on the existing super-admin inspect reveal with **no
  audit log** (§8.4); extending `08`'s `raw-access-audit.enc` infrastructure to dream access is a future
  enhancement.

## 3. UX & flows

A new **Dreams** feature module registers a nav entry (gated by `dreams.own`) and the route tree
`/dreams`. Every screen is responsive (~360px→desktop) per CLAUDE.md §12.

- **Dream Journal** (`/dreams`) — a **master–detail** list (mirroring People/Sessions, `02`/`04`/`05`): a
  chronological list of dreams (title or first line + date + small lucid/nightmare/analyzed markers) beside
  a detail pane. A prominent **"Log a dream"** action is always one tap away.
- **Dream detail** — the narrative + quick fields; an **Analyze** / **Resume analysis** / **View analysis**
  action depending on state; the analysis (once present); sharing + delete controls.
- **Patterns** (`/dreams/patterns`) — cross-dream stats, charts, and the AI narrative.

### 3.1 Capture (fast-first)

1. **Log a dream** opens a lightweight composer with the narrative field focused immediately — a person can
   type (later: speak) the dream and **Save** in seconds. Nothing else is required.
2. **Optional quick fields** (collapsed by default so they never slow capture):
   - **Waking mood** + **vividness** — quick pickers stored as normalized values (chartable; see §4.2).
   - **Lucid** and **Nightmare** flags — toggles (feed patterns + the recurring-nightmare nudge, §8.2).
   - **Sleep context** — the **date the dream occurred** (defaults to "last night," may differ from when
     logged) + an optional rough **sleep quality**.
   - **Tags** + **people present** — free-text tags and who appeared, the latter linkable to the **People
     graph** (`04`) or left as a free name. Powers per-dream sharing (§3.4) and people-frequency patterns.
3. **Sensitivity** — a per-dream **sensitivity tier** (reusing `SensitivityTier`), default `standard`; a
   sensitive tier keeps the dream out of shared context (§8.3/§8.4). It **never blocks the person analyzing
   their own dream**.
4. A saved, un-analyzed dream is a complete, useful journal entry. Analysis is always a later, explicit
   choice.

### 3.2 Guided analysis

1. From a dream's detail, **Analyze** opens a **dream-scoped reflective chat** (reuses `05`'s streaming
   engine + crisis footer; budget-checked first, §6). The transcript is stored **with the dream** and
   **never appears in the main Sessions list** (§4.1/§5).
2. The coach opens with the dream in context and asks a **few focused, one-at-a-time** reflective questions
   (felt emotions, waking-life echoes, the images that stood out). The person can answer as much or as
   little as they like, or skip ahead.
3. When ready, **"Create analysis"** runs the **synthesis**: the coach produces a schema-validated
   **structured analysis** (§4.3) — summary, emotional landscape, possible waking-life connections, notable
   images/symbols (honestly framed), and 2–3 reflective questions / a gentle coaching prompt — **and**
   structured tags for patterns. A `crisisFlag` is raised if the dream/dialogue discloses risk (§8.2).
4. The analysis renders as a clean, scannable card. The person can **edit any section** before approving.

### 3.3 Approve → context

- **Approve** moves the analysis into the coach's memory: it becomes an **Insight** (`source: 'dream'`,
  `provenance.dreamId` set) and, once approved, feeds the dreamer's own `buildContext` like any other
  approved Insight (`08` §4.4). Nothing reaches the coach before approval.
- Approved dream analyses appear in the shared **"what the coach knows"** surface (`08` §3.7): view,
  **edit**, **delete**, with provenance (which dream, when). **"Remove from context"** un-approves.
- A **master toggle `dreams.memoryEnabled`** (default **ON**, parallel to `sessions.memoryEnabled`)
  disables dream→coach memory entirely: analyses can still be created + read, but no dream Insight feeds
  context.

### 3.4 Per-dream sharing (default off)

- In the analysis/Insight detail, the dreamer can mark a **specific fact** shareable into a **related
  person's** context (relationship-scoped `InsightFact.shareable`, `08` §4.4 / `09` §3.3). Default **off** —
  dreams are private; sharing is a deliberate per-fact act, gated by **`dreams.shareContext`**.
- Sensitive-tier dreams (§3.1) are **excluded from sharing** to avoid leaking intimate content.

### 3.5 Patterns

- **Deterministic stats + charts** (computed live from each analysis's structured tags + the dream
  metadata) — four v1 visualizations, each a `/gallery` chart primitive: (1) **recurring symbols &
  themes** (a recurrence/frequency list), (2) **people frequency** (who appears most, linked to the People
  graph where known), (3) **emotions over time** (dominant emotions trending across dreams), and (4)
  **lucid/nightmare rates + mood/vividness trends** over time.
- **Periodic AI narrative** ("what I'm noticing across your recent dreams") — a budget-gated
  `dream.patterns` pass over recent dreams + analyses, cached (§4.4) and regenerable on demand. It is
  **view-only by default**; an explicit per-narrative **"add to my coaching context"** action approves the
  chosen narrative into context as a cross-dream dream Insight (no `dreamId`).
- Patterns are **dreamer-only**. The recurring-nightmare nudge (§8.2) surfaces here and in the dream detail.

### 3.6 Re-analysis & deletion

- **Re-analysis** — a dream has **one canonical analysis**; editing the dream or continuing the chat lets
  the person **re-create** it (the transcript is retained; the prior analysis + its Insight are replaced /
  re-versioned, mirroring `09` §3.2's stale→re-run).
- **Deletion** — deleting a dream **purges everything** for it (dream + analysis + the dream-scoped
  transcript) and **removes its Insight** from context, after a clear confirmation.

## 4. Data model

All persisted formats are **Zod-backed** (`z.infer` types), versioned (`schemaVersion` + migrations), and
written through the vault + crypto service (`00` §4, `04` §5) — **no direct `fs`**. Types live in
`@selfos/core` so the renderer and IPC contract share one source.

### 4.1 Vault layout (additions)

```
vault/
  people/<person-id>/
    dreams/
      <dream-id>/
        dream.enc          # Dream — narrative + quick fields + tags + people + sensitivity + status
        analysis.enc       # DreamAnalysis — structured sections + structured tags (present once analyzed)
        conversation.enc   # the dream-scoped guided-analysis transcript (a Conversation, 05 §4.1)
      patterns.enc         # DreamPatternSummary — cached AI narrative + computed-at (regenerable)
    insights/<insight-id>.enc   # Insight (source: 'dream') — present once approved (08 §4.4)
```

The dream-scoped transcript lives **under the dream**, not in `people/<id>/conversations/`, so the Sessions
surface (`05`, which lists only `conversations/`) **never shows it** — satisfying the "only inside Dreams"
decision with no filtering. All dream data lives in the vault (no per-device state); multi-device sharing is
automatic per `08` §4.1 / `10`.

### 4.2 Dream

```ts
interface DreamPersonRef {
  personId?: string; // linked to the People graph (04) when known…
  name?: string; //     …or a free-text name when not
}

interface Dream {
  id: string;
  schemaVersion: number;
  personId: string; // the dreamer (owner of this data)
  title?: string;
  narrative: string; // the brain-dump (voice-ready later)
  dreamDate?: string; // when it occurred (defaults to "last night"); may differ from createdAt
  mood?: number; // waking mood, normalized valence −1..1 (chartable; quick picker maps to it)
  vividness?: number; // 1..5
  lucid: boolean;
  nightmare: boolean;
  sleepQuality?: number; // 1..5
  tags: string[];
  people: DreamPersonRef[];
  sensitivity: SensitivityTier; // reused from 08 §4.2; default 'standard'
  status: 'captured' | 'analyzing' | 'analyzed';
  analysisId?: string; // the canonical DreamAnalysis, once created
  createdAt: string;
  updatedAt: string;
}
```

### 4.3 DreamAnalysis

The synthesized artifact: **human-readable sections** + the **structured coding** that powers patterns.

```ts
interface DreamAnalysis {
  id: string;
  schemaVersion: number;
  dreamId: string;
  personId: string;

  // readable, editable sections (§3.2)
  summary: string;
  emotionalLandscape: string;
  wakingLifeConnections: string;
  notableImages: string; // symbolic/archetypal reflection — honestly framed (§8.1)
  reflectiveQuestions: string[];
  coachingPrompt?: string;

  // structured coding (the patterns substrate, §3.5) — content-analysis style
  tags: {
    emotions: string[];
    symbols: string[];
    settings: string[];
    themes: string[];
    people: string[]; // names/roles surfaced by analysis (not necessarily People-graph ids)
  };
  metrics?: Record<string, number>; // normalized signals, e.g. emotionalIntensity, valence (chartable)

  lensesApplied?: string[]; // transparency, e.g. ['reflective','continuity','symbolic']
  crisisFlag?: boolean; // self-harm/crisis risk → result leads with crisis resources (§8.2)
  distressSignal?: boolean; // milder trauma/distress signal → feeds the recurring-nightmare nudge (§8.2)
  edited: boolean; // the person edited the AI output before approving
  insightId?: string; // the Insight produced on approval (08 §4.4)
  generatedAt: string;
  updatedAt: string;
}
```

### 4.4 Patterns cache & the shared-Insight amendments

```ts
interface DreamPatternSummary {
  // people/<person-id>/dreams/patterns.enc — cached AI narrative (deterministic stats are computed live)
  schemaVersion: number;
  personId: string;
  narrative: string; // "what I'm noticing across your recent dreams"
  windowFrom: string; // range covered
  windowTo: string;
  computedAt: string;
  insightId?: string; // set if the person approved the narrative into context
}
```

**Amendments to the shared `Insight` (`08` §4.4)** — additive only:

```ts
type InsightSource = 'questionnaire' | 'session' | 'dream'; // + 'dream'
// Insight.provenance gains an optional dreamId:
//   provenance: { assignmentId?: string; conversationId?: string; dreamId?: string; at: string }
```

These bump the shared `Insight.schemaVersion` (additive-optional; existing Insights migrate trivially —
absent `dreamId`, never `source: 'dream'`) and are **synced into `08`** via `sync-docs`. The `Conversation`
schema (`05`/`09`) is **reused unchanged** for the dream-scoped transcript.

## 5. Architecture & modules

### 5.1 Core (`@selfos/core`) — platform-agnostic

- **dreamService** (`@selfos/core/dreams`) — encrypted CRUD over `Dream` + `DreamAnalysis` (per-dream
  folder layout, §4.1); list/get/save/delete; delete **purges** the dream folder + removes the linked
  Insight.
- **dreamAnalysisService** — the guided-analysis orchestration. Reuses `05`'s streaming/turn + budget +
  usage plumbing and `promptBuilder`, but (a) persists the transcript to the **dream folder** (kept out of
  Sessions), (b) uses a **dream-analysis system prompt** (PERSONA + SAFETY + the blended honest dream-work
  instructions + `buildContext(personId)`), and (c) on **synthesis** returns a schema-validated
  `DreamAnalysis` (structured output, **adaptive thinking**, `cache_control` on the stable prefix). Charges
  usage type **`dream.analyze`** to the dreamer (§6).
- **dreamInsightService** — on **approve**, distills a `DreamAnalysis` into an `Insight` (`source: 'dream'`,
  `provenance.dreamId`) via `insightStore` (`08`); supports edit/delete/un-approve and per-fact shareable
  promotion (`08`/`09` model). Gated by `dreams.shareContext` for cross-person sharing.
- **dreamPatternService** — **deterministic** aggregation over `DreamAnalysis.tags` + `Dream` metadata
  (recurrence counts, frequencies, rate-over-time, trend series) — pure, cheap, testable; **plus** the
  budget-gated AI narrative (`dream.patterns`) cached as `DreamPatternSummary`, approvable into context.
  Computes the **recurring-nightmare** signal (§8.2).
- **context-provider registration** — when the `08` context-provider registry lands, Dreams registers a
  **dream-insight provider** so dream-derived structured context can inform questionnaire generation + the
  gap-finder. Until then, dream Insights already reach the coach via `buildContext`'s approved-Insight read
  (`08` §4.4) — the primary path needs no registry.

### 5.2 Desktop main (host)

Wires the core dream services to `nodeFileSystem` / `nodeSecretStore` / `anthropicClient` and registers the
IPC handlers (§6). No new host capabilities — image generation (which would add a provider/host) is the
deferred companion spec. The iOS host (`07`) gets the feature for free via `createCoreBridge`.

### 5.3 Renderer

- **Stores (Zustand):** `dreamStore` (journal + capture + analysis lifecycle, resetting on
  `activePerson.id` change per the per-person isolation rule), reusing `insightStore` for the management
  surface.
- **Screens:** Dream Journal (master–detail), Dream detail + capture composer, the guided-analysis chat +
  synthesis card, Patterns (stats + charts + narrative), and the Dreams settings section. Reuses the
  streaming chat components from `05` for the guided session and the "what the coach knows" surface from
  `08`/`09` for Insight management.
- **New design-system primitives:** the patterns charts (a small frequency/bar chart, a trend line, a
  recurrence list) — added to **`/gallery`** (DoD).

### 5.4 Feature-module registration

Standard `defineFeature` (`00` §5.2): nav + `/dreams` routes + the `dreams.*` capabilities + the new vault
schemas + IPC handlers + the Settings declarations (+ the context-provider registration when available).
The shell is untouched.

## 6. IPC / API contracts

Typed channels (`src/shared`, Zod-validated both sides; the API key never crosses to the renderer), all
gated by **`dreams.own`** unless noted:

- **Journal** — `dreams:list` / `:get` / `:save` / `:delete` (delete purges the dream folder + its Insight).
- **Analysis** — `dreams:analyzeTurn({ dreamId, userText })` (streams via `dreams:chunk`, reusing `05`'s
  streaming pattern; the transcript persists to the dream folder) / `dreams:synthesize({ dreamId })`
  (produces the `DreamAnalysis`) / `dreams:updateAnalysis` / `dreams:approve({ dreamId, edits?,
shareableFactIds?, shareWithPersonId? })` (→ Insight; sharing requires `dreams.shareContext`) /
  `dreams:removeFromContext({ dreamId })`.
- **Patterns** — `dreams:patternStats({ window })` (deterministic; no Claude) / `dreams:patternNarrative()`
  (the `dream.patterns` AI pass) / `dreams:approvePatternNarrative()`.
- **Insights** — reuse `08`'s `insights:list/update/delete` for management; dream Insights are just
  `source: 'dream'` rows.
- **Claude** — analysis/synthesis/patterns run the `06` path: `checkBudget → call → recordUsage` with
  `type` ∈ {`dream.analyze`, `dream.patterns`}; cost charged to the **dreamer**; caching on the stable
  prefix; **adaptive thinking** on synthesis + the narrative. New labels registered in `usageTypes`.
- **Metering display** — follows `06`: admin-only `$`, post-hoc, via the existing usage ring; reuses the
  chat warn→block budget UX. No new metering surfaces.

## 7. States & edge cases

Per `00` §7, every surface handles loading / empty / error / offline:

- **No Claude key / AI disabled** — **capture + journaling fully work**; Analyze + Patterns-narrative show
  calm "enable AI in Settings" states; no analysis or Insight is produced. (Deterministic pattern stats
  still render if there are prior analyses.)
- **Offline** — capture works (local vault write); analysis/narrative require the network and surface a
  clear retry, never data loss of the dream.
- **Over budget** — Analyze/synthesize/narrative block with the `06` warn→block UX (owner override); the
  dream itself is unaffected.
- **Empty** — no dreams yet → an inviting "log your first dream" empty state; no analysis yet → the dream
  detail shows the Analyze entry point; not enough dreams for patterns → a friendly "patterns appear as you
  log more" state.
- **Crisis content** — analysis raises `crisisFlag`; the synthesis card **leads with resources** (§8.2).
- **Large narrative** — long dumps are accepted; synthesis summarizes; the transcript streams.
- **Concurrent edits / sync conflict** on a `dream.enc` / `analysis.enc` / `conversation.enc` / `Insight` /
  `patterns.enc` file — vault conflict detection (`00`); never auto-deleted; surfaced, not overwritten.
- **Corrupt / missing files** — a corrupt analysis degrades to "couldn't read this analysis — re-analyze?"
  without losing the dream; a missing transcript lets analysis restart.
- **Schema migration** — `Dream`/`DreamAnalysis` bumps migrate on read; the additive `Insight`
  `source`/`dreamId` amendment migrates trivially (§4.4).
- **Re-analysis** — continuing the chat / editing the dream marks the analysis re-creatable; re-synthesis
  replaces the prior analysis + re-versions its Insight (no silent drift, `09` §3.2).
- **memoryEnabled OFF** — analyses are created/read but no dream Insight feeds context; existing dream
  Insights remain editable/deletable.

## 8. Safety, privacy & honesty

### 8.1 Wellness boundary & analytical honesty

SelfOS remains **wellness/self-help, not medical** (CLAUDE.md §1). Dream analysis is **reflection, never
clinical interpretation, diagnosis, or treatment** — it does not decode fixed "meanings," diagnose sleep
disorders, or pathologize. The **blended** voice (§2) leads with evidence-based reflection (cognitive-
experiential dream work, the continuity hypothesis, descriptive content analysis) and **may** offer
symbolic/archetypal readings, but those are always framed as **imaginative reflection to explore, not fact
or science** — the honesty framing lives in the system prompt so it is applied consistently to every
analysis. The not-medical line is visible on the analysis surfaces.

### 8.2 Crisis routing & the recurring-nightmare nudge

- The guided-analysis chat carries the always-visible **"Get help now"** crisis footer + not-medical line
  (reused from `05` §7). During synthesis a model-based **crisis flag** (no keyword interstitial, consistent
  with `05`/`09`) makes the result **lead with concern + resources**, never a clinical judgment.
- **Recurring-nightmare / trauma nudge** — triggered by **either** a frequency threshold of
  `nightmare`-flagged dreams in a recent window **or** an AI-detected trauma/distress signal during analysis
  (whichever fires first — the wider safety net). `dreamPatternService` computes the frequency signal;
  analysis sets the AI signal (`DreamAnalysis.distressSignal`, §4.3). The Patterns view + dream detail then
  surface a **gentle, non-clinical** suggestion that persistent distressing dreams are worth discussing with
  a professional, with resources. It **never diagnoses** (e.g. PTSD, a sleep disorder). The exact frequency
  count + window are tuned during build (§11).

### 8.3 Sensitive content

Dreams can be intimate, sexual, or traumatic. Each dream carries a **sensitivity tier** (reusing
`SensitivityTier`, `08` §4.2). A sensitive tier (a) drives honest handling, and (b) **excludes the dream
from per-dream sharing** (§3.4) so intimate content can't leak into another person's context. The
sensitivity tier **never blocks a person analyzing their own dream**. Trauma/nightmare content is a
**separate, orthogonal** dimension captured by the `nightmare` flag + crisis routing (§8.2), not the
intimacy-oriented sensitivity tier. All AI runs **within Anthropic's usage policy** (graceful refusal
handling, never circumvented).

### 8.4 Privacy & the owner/super-admin honesty model

- **Dreamer-only in normal use** — a person's dreams, transcripts, and analyses are theirs; there is **no
  "view others' dreams" capability**. They feed only **that** person's coach (cross-person sharing is the
  explicit, off-by-default per-fact promotion in §3.4).
- **Break-glass (v1)** — consistent with `04` §8 and `08` §8.4, the vault is **not zero-knowledge from the
  device owner / super-admin** (one master key decrypts the whole vault; RBAC is an app-layer concern).
  The concealed **super-admin inspect** mode can therefore reach dreams. **v1 ships no dream-access audit
  log** — a deliberate simplification (the user's call). The `08` `raw-access-audit.enc` infrastructure
  exists and could be extended to dream access later (§11); this is recorded so the privacy posture is
  documented, not silently assumed.
- **Encryption** protects against file-browsing, other household members, and the cloud — not the device
  owner; no new exposure beyond the existing model.

## 9. Accessibility

Per `01` §9. The capture composer, the guided-analysis chat (a polite live region for the streamed
synthesis), the editable analysis sections, Insight management, and the Patterns charts are
keyboard-operable, labelled, and screen-reader friendly; **charts have text equivalents (not color-only)**.
Responsive ~360px→desktop everywhere, with the mobile-width (390px) layout guard + a geometry guard on the
chart/toggle controls (DoD §7).

## 10. Testing strategy

- **Unit (core, node):** `dreamService` encrypted CRUD + purge-on-delete; `dreamAnalysisService` with the
  **fake `ClaudeClient`** — synthesis returns a valid `DreamAnalysis` incl. structured tags + metrics;
  budget block; `recordUsage` emits `dream.analyze`; crisis-flag path; the transcript persists to the dream
  folder and **does not appear in `listConversations`**; `dreamInsightService` approve → `Insight`
  (`source: 'dream'`, `provenance.dreamId`); `buildContext` includes the dreamer's approved dream Insights
  and **excludes** others' private facts + non-approved analyses; per-fact sharing promotes to a related
  person and is **blocked for sensitive-tier dreams**; `dreamPatternService` deterministic stats from tags
  - the recurring-nightmare threshold; `memoryEnabled=false` short-circuits context; `Dream`/`DreamAnalysis`
  - the additive `Insight` migration.
- **Component (RTL):** capture composer (fast path + optional fields); guided-analysis chat + synthesis
  card; edit + approve + remove-from-context; per-dream sharing toggle (and its absence on sensitive tiers /
  without `dreams.shareContext`); Patterns charts + narrative; the settings persist; not-configured /
  over-budget / memory-disabled states.
- **E2E (Playwright):** with `SELFOS_FAKE_CLAUDE` — log a dream → guided analysis → synthesize → edit →
  approve → the dream Insight shows up in a **later chat session's** grounding; the dream-analysis
  conversation is **absent from the Sessions list**; Patterns view renders; the recurring-nightmare nudge
  appears past threshold; delete purges + removes the Insight. No-overflow + control-geometry + mobile-width
  (390px) guards on every new surface incl. the charts.
- The Claude client is an **interface with a fake** (no real network).

## 11. Open questions

1. **Build-time tuning (non-blocking):** the exact recurring-nightmare frequency count + window (§8.2), and
   the precise waking-mood picker control that maps to normalized valence (§4.2) — settled during slice
   work, not before approval.
2. **Image generation (deferred companion spec) — parked sub-questions:** OpenAI provider + model + an
   image-style picker, configurable in Settings; the **second API key** as a new secret in the
   main/Keychain `SecretStore`; the **third-party consent** flow for sending dream content to OpenAI;
   **binary-blob vault storage** (extend `FileSystem` + crypto with bytes, across all three hosts) vs.
   base64-in-JSON vs. don't-persist; **per-image (flat-fee) cost** in the token-based budget model;
   **content-policy refusals** (violent/sexual/nightmare imagery) handled gracefully; **real-person
   likeness** concerns when a dream features family. None of this ships in `12`.

## 12. Resolved decisions

Confirmed with the user (2026-06-11):

1. **Analytical voice** — evidence-based reflection **+ optional lenses + symbolic interpretation, all
   available**, **blended automatically** by the AI into one analysis with honesty framing woven throughout
   (§8.1).
2. **Flow** — **guide, then synthesize**: a dream-scoped reflective chat that ends in a stored, structured,
   **editable** analysis.
3. **Analysis output** — **structured sections** (summary, emotional landscape, waking-life connections,
   notable images/symbols, reflective questions / coaching prompt), editable before approval.
4. **Context entry** — **approve-step required**: the analysis feeds the coach only after the dreamer
   approves it; "remove from context" un-approves. (Like questionnaire Insights, unlike auto-entering
   session Insights.)
5. **Patterns** — **full cross-dream patterns in v1**, via a **hybrid**: structured per-analysis tags →
   deterministic stats/charts **plus** a periodic AI narrative.
6. **Capture** — **fast dump + optional structure**: narrative-first, with optional waking mood + vividness,
   lucid & nightmare flags, sleep context (occurred-date + sleep quality), and tags + people present (People-
   graph-linkable).
7. **People & privacy** — dreams are **private to the dreamer by default**; the dreamer can **share a
   specific dream's insight per-person** into a related person's context (off by default).
8. **Sensitivity** — a **per-dream sensitivity tier** (reusing `SensitivityTier`); drives honest handling +
   keeps sensitive dreams out of shared context; never blocks analyzing one's own dream.
9. **Break-glass** — Owner/super-admin can reach dreams via the existing inspect mode; **no audit log in
   v1**.
10. **Sessions list** — dream-analysis conversations live **only inside Dreams**, never in the main Sessions
    list.
11. **Image generation** — a **separate, later companion spec** (not this one); its open questions parked
    (§11.2).
12. **Reminders** — **no** morning reminders/notifications in v1.

Confirmed in review (2026-06-11):

13. **Pattern narrative** — **view-only by default**, with an explicit per-narrative **"add to my coaching
    context"** action (approvable into context only when the person chooses).
14. **Recurring-nightmare nudge** — triggered by **a frequency count OR an AI-detected trauma signal**
    (whichever fires; `DreamAnalysis.distressSignal`; exact count + window tuned in build).
15. **Pattern charts (v1)** — **all four** ship as new `/gallery` primitives: recurring symbols & themes,
    people frequency, emotions over time, and lucid/nightmare rates + mood/vividness trends.
16. **Quick-field scales** — waking mood → normalized **valence (−1..1)**, **vividness 1–5**, **sleep
    quality 1–5**.
17. **Capabilities** — a single **`dreams.own`** (capture + analyze + view own) + **`dreams.shareContext`**
    (per-dream sharing), both **default-ON for Member**; **no "view others' dreams" capability**.
18. **Naming / placement** — **"Dreams,"** a top-level nav entry with a **moon icon**, route `/dreams`.

## 13. Proposed build slices (after approval)

1. **Schema + dreamService + capabilities + Insight amendment** — `Dream`/`DreamAnalysis`/
   `DreamPatternSummary` Zod models + the §4.1 vault layout; the additive `Insight`
   `source: 'dream'` + `provenance.dreamId` amendment (synced into `08`); the `dreams.own` /
   `dreams.shareContext` capabilities (default-ON for Member). Mostly core/backend.
2. **Capture + journal UI + settings + nav** — the Dreams master–detail journal, the fast capture composer
   - optional quick fields, the `dreamStore`, the `dreams.memoryEnabled` setting, and the `/dreams` nav
     entry. No AI yet — pure journaling works offline.
3. **Guided analysis → structured analysis → approve → context** — `dreamAnalysisService` (reusing `05`'s
   engine, dream-folder transcript, blended honest prompt, `dream.analyze` metering), the guided chat +
   synthesis card, edit + approve → `Insight`, remove-from-context, crisis routing.
4. **Patterns** — `dreamPatternService` deterministic stats + the new `/gallery` chart primitives + the
   `dream.patterns` AI narrative (approvable) + the recurring-nightmare nudge.
5. **Per-dream sharing** — per-fact shareable promotion into a related person's context (reusing `08`/`09`),
   gated by `dreams.shareContext`, excluded for sensitive tiers.

_(Future companion spec: **AI dream-image generation** — the deferred §2 / §11.9 work, when the core is
proven.)_

## 14. Changelog

- 2026-06-11 — created (Draft) after an extended design brainstorm; all foundational decisions resolved with
  the user (§12). Dreams is scoped as the **third producer** into `08`'s Insight/metrics layer; image
  generation split out to a future companion spec. Awaiting review/approval before any code.
- 2026-06-11 — review round resolving the §11 open questions (§12 items 13–18): pattern narrative is
  **view-only by default + opt-in "add to context"** (§3.5); the recurring-nightmare nudge fires on **a
  frequency count OR an AI distress signal** (`DreamAnalysis.distressSignal`, §4.3/§8.2); **all four**
  pattern charts ship (§3.5); the quick-field scales, the `dreams.own`/`dreams.shareContext` capabilities,
  and the "Dreams"/moon-icon naming are confirmed. Only build-time tuning + the deferred image-gen
  sub-questions remain open (§11).
- 2026-06-11 — **Approved.** UX reviewed against interactive mockups of the four core surfaces (journal,
  capture, guided analysis, patterns); §3 flows match. Cleared for slice 1 (schema + `dreamService` +
  capabilities + the additive `Insight` amendment).
