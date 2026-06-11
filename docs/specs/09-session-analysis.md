# 09 — Session analysis (the coach's memory)

> **Status:** **Approved** · _last updated 2026-06-11_
>
> When a coaching session ends, AI can **analyze and summarize** it into a durable **Insight** so the
> coach remembers across sessions instead of re-reading transcripts. Session analysis is the **second
> producer** into the shared Insight / metrics layer defined in
> [`08-questionnaires.md`](08-questionnaires.md) §1.1/§4.4 (questionnaires is the first). It also emits a
> **2D mood signal** (valence + energy) as metrics, which the relationship/wellbeing dashboard
> ([`11`](11-relationship-tracking.md)) charts. This is the "cross-conversation long-term memory" that
> [`05-conversations.md`](05-conversations.md) §2 deferred.

Builds on [`05-conversations.md`](05-conversations.md) (the Sessions surface + transcripts + crisis/
not-medical safety — **amended here** to add an explicit session "end" + analysis),
[`08-questionnaires.md`](08-questionnaires.md) (the shared `Insight`/`metrics` model, `insightStore`, the
`buildContext` extension, the shareable-vs-private split), [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md)
(metering + budgets), and [`04-people-roles.md`](04-people-roles.md) (active person, encryption,
shareable context).

---

## 1. Overview

Today a session ([`05`](05-conversations.md)) is an open-ended encrypted transcript with no memory beyond
the model's context window. This spec adds an explicit **"End & summarize"** action: AI reads the full
transcript **once** and produces a structured **`SessionInsight`** (`source: 'session'`) — summary, key
themes, goals/commitments, people mentioned, follow-ups, a **2D mood signal** (`moodValence` +
`moodEnergy`) written into the shared **metrics** map, and a **crisis flag** if warranted. The Insight
auto-enters the **subject's own** coaching context and is fully **viewable, editable, and deletable**
afterward. The stored Insight — not the raw transcript — is what later sessions, the questionnaire
**gap-finder** ([`08`](08-questionnaires.md)), and the wellbeing trend ([`11`](11-relationship-tracking.md))
reuse, which is cheaper and more private.

## 2. Goals / Non-goals

**Goals**

- An explicit **"End & summarize"** action that produces a `SessionInsight` into the shared Insight/metrics
  layer (`08`), budget-gated and metered (`06`).
- **Long-term memory**: the subject's recent Session Insights feed their own `buildContext`, giving the
  coach continuity across sessions.
- **Reopenable/versioned**: continuing an ended session marks its Insight **stale**; the next end
  **re-analyzes** (versioned), so memory never silently drifts from the transcript.
- A **2D mood signal** (`moodValence` + `moodEnergy`) emitted as metrics, powering a **wellbeing trend**
  (charted in `11`, alongside questionnaire metric trends).
- **Per-fact opt-in sharing**: derived facts default **private to the subject**; the user can promote a
  specific fact to **shareable** (same model as `04`/`08`) to enrich a related person's context.
- A **"session memory" master toggle** (privacy control) and an **auto-summarize-on-end** option.

**Non-goals (deferred)**

- **Auto-summarize on inactivity** — v1 trigger is the explicit "End & summarize" (+ the opt-in
  auto-on-end); no inactivity timer.
- **Approve-step for own Insights** — session Insights **auto-enter** the subject's own context (low
  friction); editing/deleting after the fact is the control. (Questionnaire Insights keep their approve-step
  in `08`.)
- **Auto-pushing facts into other people's profiles** — promotion is per-fact and **opt-in**; the "add to
  their profile?" enrichment affordance is a later enhancement.
- **Relationship "about us" session analysis** — follows once per-relationship chats exist (`05` §2).
- **The Insight/metrics schema, store, `buildContext` plumbing, and the trend dashboards** — owned by `08`
  (layer) and `11` (dashboards); this spec only **produces** into the layer.

## 3. UX & flows

Amends the Sessions surface (`05` §3):

### 3.1 End & summarize

- The thread gains an **"End & summarize"** action. It runs analysis (budget check first, §5), then shows a
  **wrap-up card**: summary, themes, mood, goals/commitments, follow-ups, and (if flagged) **crisis
  resources first** (§7). The resulting `SessionInsight` auto-enters the subject's own context.
- A session **setting `sessions.autoSummarizeOnEnd`** (default **OFF**) runs this automatically whenever a
  session is ended, for users who want it hands-off (no surprise spend by default).

### 3.2 Reopen / continue / re-run

- Ending does **not** lock the session — the subject can reopen and keep talking. Continuing marks the prior
  Insight **stale**; **"End & summarize"** re-runs analysis and writes a **new version** (the Insight's
  `provenance.at` + `updatedAt` advance; the stale one is replaced).

### 3.3 Insight management & wellbeing trend

- Session Insights appear in the shared **"What the coach knows"** surface (`08` §3.7): view, **edit**,
  **delete**, with **provenance** (which conversation, when).
- **Per-fact sharing** — in the wrap-up/Insight detail, toggle an individual `InsightFact` to **shareable**;
  a fact about a related person can then feed **that** person's coaching (and later, an opt-in "add to their
  profile" prompt).
- **Wellbeing trend** — the `moodValence`/`moodEnergy` metrics across sessions render as a trend (a
  `/gallery` chart primitive), shown alongside questionnaire metric trends; the aggregated view lives in
  `11`.

### 3.4 Disabling memory

- A **master toggle `sessions.memoryEnabled`** (default **ON**) disables session summarization entirely: no
  analysis runs, no Session Insights are produced or fed to context. Existing Insights remain
  editable/deletable.

## 4. Data model

No new file types — session analysis **produces `Insight`** records (`08` §4.4) with `source: 'session'`,
stored at `people/<person-id>/insights/<insight-id>.enc` (and, when a fact is promoted to a relationship,
`relationships/<rel-id>/insights/…`). The mood signal is written into the shared **`Insight.metrics`** map
as `moodValence` (−1..1) and `moodEnergy` (−1..1). Session Insights set `approved: true` on creation
(auto-enter); `provenance.conversationId` set.

The **`Conversation`** schema (`05` §4.1) is amended:

```ts
interface Conversation {
  // …existing fields…
  endedAt?: string; // set by "End & summarize"; absent = open
  insightId?: string; // the current SessionInsight for this conversation
  insightStale?: boolean; // true after continuing past an end → re-run on next end
}
```

Bumps `Conversation.schemaVersion` with a migration (existing transcripts: `endedAt`/`insightId` absent,
`insightStale` false). All reads/writes through the vault + crypto service (`04` §5).

## 5. Architecture & modules

- **sessionAnalysisService** (`@selfos/core/conversations`) — `endAndSummarize(conversationId)`: budget
  check → read transcript → `ClaudeClient` analysis (**adaptive thinking**, a **safety pass**) → build a
  `SessionInsight` (facts + `moodValence`/`moodEnergy` metrics) → `insightStore.save` (`08`) → record usage
  → set `endedAt`/`insightId` on the conversation. `reanalyze` for the stale path.
- **promptBuilder (extended)** — a session-analysis prompt (summary + themes + mood + goals + people +
  follow-ups + crisis assessment) returning **schema-validated** structured output; `cache_control` on the
  stable instruction prefix.
- **contextProviderRegistry (`08`)** — registers a **session-insight provider** so the questionnaire
  gap-finder can use session memory as context.
- **Metering (`06`)** — a new usage type **`session.analyze`** (label "Session summary"); `checkBudget →
analyze → recordUsage`, charged to the **subject**. Gated by `sessions.own` + `ai.enabled` +
  `sessions.memoryEnabled`.
- **`buildContext`** — already reads approved Insights (`08` §4.4); Session Insights flow in automatically
  for the subject's own context, prioritized/capped with questionnaire Insights.
- **Renderer** — the "End & summarize" action + wrap-up card in the Sessions screen; Insight management +
  the trend reuse `08`/`11` surfaces; the two new settings via the schema-driven registry (`03`).

## 6. IPC / API contracts

- `sessions:endAndSummarize({ conversationId })` → runs analysis (or a typed `BUDGET_EXCEEDED` / `NO_KEY` /
  `MEMORY_DISABLED` envelope) and returns the wrap-up + Insight id.
- `sessions:reanalyze({ conversationId })` → re-run on the stale path.
- Insight read/edit/delete/promote-fact reuse `08`'s `insights:*` channels.
- The Claude call + key stay in main (`00` §6.2); only the decrypted Insight crosses to the active person.

## 7. Safety

- **Not medical / crisis** (`05` §7) — unchanged and extended: session analysis **assesses for crisis
  signals** and, when flagged, the wrap-up **leads with resources** (warm, routing to professional help),
  never a clinical judgment or diagnosis. The always-visible "Get help now" footer remains.
- **Privacy** — session content is the most sensitive data; Session Insights are **private to the subject by
  default** and only feed that subject's own coach. Cross-person sharing happens **only** via explicit
  per-fact promotion (§3.3). The master **memory toggle** lets a user opt out entirely. Raw transcripts are
  read by analysis **in the subject's own process** (their own data) and never sent to the coach wholesale —
  the derived Insight is.
- **Honesty** — encryption protects against file-browsing/other members/cloud, not the device owner/
  super-admin (`04` §8); no new exposure beyond the existing model.

## 8. Accessibility

Per `01` §9: the "End & summarize" action, the wrap-up card (a polite live region for the produced summary),
Insight editing, and the wellbeing trend (text equivalents, not color-only) are keyboard-operable and
screen-reader friendly. Responsive ~360px→desktop.

## 9. Testing strategy

- **Unit (core, node):** `sessionAnalysisService` with the **fake `ClaudeClient`** — produces a valid
  `SessionInsight` incl. `moodValence`/`moodEnergy` metrics; budget block; `recordUsage` emits
  `session.analyze`; crisis flag path; stale → reanalyze writes a new version; `memoryEnabled=false`
  short-circuits; `Conversation` migration; `buildContext` includes the subject's approved Session Insights
  and excludes others' private facts; the registered session-insight context provider is gathered by the
  gap-finder.
- **Component (RTL):** the "End & summarize" action + wrap-up card; per-fact shareable toggle; the wellbeing
  trend; the two settings persist; not-configured/over-budget/memory-disabled states.
- **E2E (Playwright):** with `SELFOS_FAKE_CLAUDE`, hold a session → End & summarize → wrap-up appears → the
  Insight shows in a **later** session's grounding; continue past end → stale → re-run updates it; disable
  memory → no analysis. No-overflow + control-geometry + mobile-width guards on the new surfaces.

## 10. Open questions

1. **Insight token budget interplay** — how Session vs questionnaire Insights share the per-person context
   cap (`08` §4.4); confirm weighting (recency vs source) during slice work.
2. **Re-run cost control** — whether frequent reopen→end cycles need a debounce/confirm to avoid repeated
   analysis spend (default: explicit action each time; revisit if noisy).

## 11. Resolved decisions

Confirmed with the user (2026-06-10):

1. **Trigger** — explicit **"End & summarize"** (reopenable; continuing marks stale → re-run on next end,
   versioned); an optional **auto-summarize-on-end** setting (**default OFF**).
2. **Own-context entry** — Session Insights **auto-enter** the subject's own context, **editable/deletable**
   (no approve-step, unlike questionnaire Insights).
3. **Sharing** — facts are **private to the subject by default**; the user can **promote specific facts to
   shareable** to enrich related people's context.
4. **Memory toggle** — a **`sessions.memoryEnabled`** master switch (**default ON**) can disable
   summarization entirely.
5. **Mood signal** — **2D: valence + energy** (`moodValence`/`moodEnergy`), emitted as metrics into the
   shared layer; powers the wellbeing trend.
6. **Metering** — new **`session.analyze`** usage type, charged to the subject, budget-gated, adaptive
   thinking, caching on the stable prefix.
7. **Spec scoping** — the shared Insight/metrics layer is defined in **`08`**; this companion adds the
   feature and **amends `05`** (Conversation gains `endedAt`/`insightId`/`insightStale`); the trend
   dashboards live in **`11`**.
8. **Crisis** — session analysis assesses for crisis and the wrap-up **leads with resources** when flagged.

## 12. Proposed build slices (after approval)

1. **Analysis backend** — `sessionAnalysisService` + the analysis prompt + `session.analyze` metering + the
   `Conversation` migration + the session-insight context provider; produces Insights/metrics into the `08`
   layer. Unit-tested with the fake client.
2. **End & summarize UI + settings** — the action, wrap-up card, the two settings, memory-disabled/over-budget
   states.
3. **Sharing** — per-fact shareable promotion (reusing `08`'s Insight management). _(The wellbeing-trend
   chart ships with `11`'s dashboard.)_

(Depends on `08` slice 1 — the Insight/metrics layer — being in place first.)

## 13. Changelog

- 2026-06-10 — created (Draft) alongside `08`; decisions resolved with the user (§11). Revised same day: the
  mood signal became **2D (valence + energy)** expressed through `08`'s shared **metrics** map (resolving the
  prior mood-shape open question), and the trend dashboards were scoped to companion **`11`**. Awaiting
  review/approval before any code.
- 2026-06-11 — **Approved** alongside `08`/`11` (companion refs renumbered to `11`). Builds after `08`
  slice 1 lands the Insight/metrics layer.
