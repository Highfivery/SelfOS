# 06 — AI usage, cost & budgets

> **Status:** Approved · _last updated 2026-06-10_
>
> A **metering, accounting, budgeting, and prompt-caching** layer that **every** AI feature plugs
> into. Each AI call emits a typed **usage event** (tokens, cache, model, cost); usage rolls up by
> **type / model / person / period**; **budgets** (per-person and app-wide) warn and then block (with
> an owner override); **prompt caching** cuts cost from day one. Built **before** the chat so the chat
> is its first consumer.

Builds on [`03-settings.md`](03-settings.md) (AI settings), [`04-people-roles.md`](04-people-roles.md)
(active person, encryption, capabilities), and [`05-conversations.md`](05-conversations.md) (the first
emitter). The Anthropic billing model + caching mechanics come from the project's claude-api skill.

> **Visibility & budget rules (revised 2026-06-10, supersedes earlier drafts):**
>
> - **Budgets are managed by an admin only** — gated by the `budgets.manage` capability (the Owner has
>   it by default). Normal users (Member/Guest) cannot see or configure budgets. Budget _writes_ are
>   enforced in the main process, not just hidden in the UI.
> - **Cost ($) is never shown to normal users** — not in Sessions, not in their Usage view. Only
>   `budgets.manage` holders see dollar amounts and the **"Everyone"** (app-wide) usage scope.
> - **Each person's budget is a single period** — week _or_ month.
> - **Default budget = $10 / week** for any person without an explicit budget, so a budget always exists.
> - **No cost in Sessions.** A **global header bar** shows the active person's usage as a **percentage**
>   of their budget for the period (never a dollar figure).
> - **A user's Usage view shows only their own data and no cost** (sessions + token counts + breakdown
>   counts). The admin's Usage view adds cost, the Everyone scope, and the budget editors.

---

## 1. Overview

The moment SelfOS makes real Claude calls, every call is **metered**. A small accounting core records
a **usage event** per call — input/output tokens, cache-write/read tokens, the model, the **usage
type**, the person it was for, and an **estimated cost** — and stores it encrypted in the vault. From
those events we show: cost **while in chat**, a **usage dashboard** (by type, model, person, period;
averages per session and per type; cache savings; token breakdown), and **budgets** that warn as you
approach and **block** at the limit (owner-overridable). **Prompt caching** is on from the start so the
stable system prefix is billed at ~0.1× on repeat turns.

## 2. Goals / Non-goals

**Goals**

- A **UsageEvent** recorded for every AI call, via one shared accounting path.
- A **usage-type registry** features extend (`chat` is the first type).
- A maintained **per-model pricing table**; cost is computed and labeled **estimated**.
- **Prompt caching** on the stable system prefix; cache-write/read tokens + **savings** tracked.
- **Budgets**: per-person (week/month) and app-wide (all people), **warn → block with owner override**.
- **Aggregation + dashboards**: by type / model / person / period; **avg per session and per type**;
  cache savings; input/output/cache breakdown. **Live cost in chat.**
- Encrypted, per-person usage storage in the vault (aggregated for the app view).

**Non-goals (deferred)**

- User-editable prices (built-in maintained table only for v1).
- Multi-currency (USD only — Anthropic bills in USD).
- Real invoice reconciliation with Anthropic (this is an _estimate_, clearly labeled).
- Token forecasting / anomaly detection.

## 3. Concepts

- **Usage type** — what the AI was used for. A registry (`registerUsageType`) so breakdowns grow as
  features are added. v1: `chat` ("A coaching session"). Future: `questionnaire.summary`,
  `journal.reflection`, etc.
- **UsageEvent** — one record per AI call (§4.1). The single source of truth for all reporting.
- **Pricing** — `{ inputPerM, outputPerM, cacheWritePerM, cacheReadPerM }` per model (§4.3). Cache
  write = 1.25× input (5-min ephemeral); cache read = 0.1× input. Cost is an **estimate**.
- **Budget** — a USD limit over a **period** (`week` | `month`), scoped to a **person** or the **app**
  (all people). Two thresholds: a **warn** ratio (e.g. 0.8) and the **block** limit (1.0).
- **Session** (for "avg per session") — one **conversation** (05-conversations). Averages = total ÷
  distinct sessions / types in the period.

## 4. Data model

### 4.1 UsageEvent (encrypted, per person)

```ts
interface UsageEvent {
  id: string;
  schemaVersion: number;
  type: string; // usage-type key, e.g. 'chat'
  personId: string;
  sessionId?: string; // conversation id, for per-session rollups
  model: string;
  at: string; // ISO
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number; // cache_creation_input_tokens
  cacheReadTokens: number; // cache_read_input_tokens
  costUsd: number; // computed estimate at record time (price snapshot)
}
```

Stored append-only at `people/<person-id>/usage/<YYYY-MM>.jsonl.enc` (monthly shards, encrypted).
`costUsd` is snapshotted at record time so historical totals don't drift when the price table changes.

### 4.2 Budget config

```ts
interface Budget {
  limitUsd: number;
  period: 'week' | 'month';
  warnRatio: number; // 0..1, default 0.8
}
// App budget lives in app settings; per-person budgets in a vault config file keyed by personId.
```

### 4.3 Pricing (maintained constant)

A `PRICING: Record<string, ModelPricing>` table in main (USD per 1M tokens), seeded from the
claude-api skill — e.g. `claude-sonnet-4-6` = `{input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30}`,
`claude-opus-4-8` = `{input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.50}`. Unknown models fall
back to a conservative default and are flagged. **All displayed cost is labeled "estimated."**

## 5. Architecture & modules

### 5.1 Main process

- **pricing.ts** — `PRICING` table + `costOf(model, tokens)` and `cacheSavingsOf(model, cacheReadTokens)`
  (= readTokens × (input − cacheRead) ÷ 1e6). Pure + unit-tested.
- **usageStore.ts** — `recordUsage(event)` (encrypted append) + `queryUsage({ from, to, personId?, type? })`
  → events, and `summarize(...)` → rollups (by type/model/person, totals, averages, cache savings).
- **budgetService.ts** — `getBudgets()` / `setBudget(...)`, and `checkBudget({ personId, type })` →
  `{ state: 'ok' | 'warn' | 'over', spent, limit, period }`. Enforcement: **over** blocks unless an
  **owner override** is active (super-admin or `users.manage`).
- **The AI proxy path** (claudeService, extended in 05) — before a call: `checkBudget`; if `over` and
  no override → return a typed `BUDGET_EXCEEDED` error. After a call: `recordUsage` from the SDK's
  `usage` (input/output/cache tokens). Sets `cache_control` on the stable system prefix.
- **usage-type registry** (shared) — `registerUsageType(key, label)`; `chat` registered by 05.

### 5.2 Renderer

- **usageStore** (Zustand) — dashboard summaries + budget state; live conversation cost from stream
  events.
- **Usage dashboard** (`/usage`, gated by `settings.manage` for app-wide; a person sees their own) —
  period switch (week/month), totals, **by type / model**, **avg per session & per type**, **cache
  savings**, token breakdown, and **budget progress** bars.
- **Budget settings** — per-person budgets (in the person editor or the dashboard) + the app budget
  (in Settings → AI).
- **Cost-in-chat** — a quiet running total (conversation cost + tokens) updated each turn; a warn chip
  when near budget; a clear blocked state with the override path for the owner.

## 6. IPC / API contracts

- `usage:summary({ period, scope })` → rollups for the dashboard (scope: `person` | `app`).
- `budget:get()` / `budget:setApp(budget)` / `budget:setPerson({ personId, budget })`.
- `budget:check({ type })` → current state for the active person + app (drives chat warnings/blocks).
- Usage is **recorded inside main** on each AI call — never written from the renderer. The renderer
  never sees raw prices it can tamper into stored cost; cost is computed + snapshotted in main.

## 7. Prompt caching

The chat's system prefix (persona + safety + `buildContext`) is **stable within a conversation**, so it
gets `cache_control: {type: "ephemeral"}`. Repeat turns read it at ~0.1× input price. The proxy reads
`usage.cache_creation_input_tokens` / `cache_read_input_tokens` into the UsageEvent; the dashboard shows
**cache savings**. (Caching guidance + the silent-invalidator caveats come from the claude-api skill;
the prefix must stay byte-stable — no timestamps in the system prompt.)

## 8. Safety, privacy & honesty

- **Cost is an estimate**, always labeled — the source of truth is the user's Anthropic bill.
- **Usage events carry no message content** — only token counts, model, type, person, cost. They're
  still encrypted at rest (consistent with all People data).
- **Budgets protect the user from surprise spend** — the block is real but owner-overridable, so it
  never strands the owner.
- The metering must never alter the wellness/not-medical behavior of the chat itself (05 §7).

## 9. Accessibility

Per [`01-design-system.md`](01-design-system.md) §9: dashboard figures have text equivalents (not
color-only); budget bars expose value/min/max; the in-chat cost is a polite, non-intrusive live region.

## 10. Testing strategy

- **Unit (node):** `costOf` / `cacheSavingsOf` (known tokens → known $), usageStore record+summarize
  (encrypted round-trip; rollups by type/model/person; averages; cache savings), budgetService
  (`ok`/`warn`/`over` thresholds; period windows; owner override).
- **Component (RTL):** dashboard renders rollups + budget bars; budget settings persist; in-chat cost
  updates and shows the warn/blocked states.
- **E2E (Playwright):** with `SELFOS_FAKE_CLAUDE` returning a fixed `usage`, a chat turn records usage →
  the dashboard reflects it and the in-chat cost updates; setting a tiny budget triggers the warn then
  block, and the owner override unblocks. No-overflow + control-geometry guards on new screens.

## 11. Build slices (after approval) — foundation first

1. **Metering core** — pricing + usageStore + budgetService + usage-type registry + IPC. Backend,
   unit-tested with the fake client. No UI.
2. **Usage dashboard + budget settings** — the reporting UI and budget config.
3. **Then conversations (05)** — the streaming chat emits usage, enables caching, enforces budgets,
   and shows cost live.

## 12. Resolved decisions

Confirmed with the user (2026-06-10):

1. **Budget enforcement** — warn as you approach, **block at the limit**, with an **owner/super-admin
   override** so the owner is never stranded.
2. **Pricing** — a **built-in maintained** per-model table; displayed cost is labeled **estimated**.
3. **Usage storage** — in the **vault, encrypted, per person**; aggregated across people for the app
   view.
4. **Sequencing** — build this **metering/budget/caching foundation first**, then the chat consumes it.

## 13. Changelog

- 2026-06-10 — created; open questions resolved with the user (block-with-override, maintained pricing,
  encrypted per-person storage, foundation-first); marked Approved.
