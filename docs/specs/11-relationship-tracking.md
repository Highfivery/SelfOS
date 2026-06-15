# 11 — Relationship & intimacy tracking

> **Status:** **Approved** · _last updated 2026-06-11_
>
> A per-relationship **dashboard** that turns the shared **metrics** layer into longitudinal insight for
> couples and close relationships — connection, satisfaction, desire (incl. **desire-discrepancy**),
> appreciation, conflict, and wellbeing over time — plus a frictionless **intimacy check-in** (a short
> tap-log with optional encounter detail). It is the first big **consumer** of the Insight/metrics layer
> defined in [`08-questionnaires.md`](08-questionnaires.md) §4.4 and fed by [`09-session-analysis.md`](09-session-analysis.md)'s
> mood signal. This is the most sensitive surface in SelfOS and is treated accordingly.

Builds on [`08-questionnaires.md`](08-questionnaires.md) (the `Insight`/`metrics` layer, questionnaire
engine, trend primitives, compatibility/both-answer model, owner-access privacy),
[`09-session-analysis.md`](09-session-analysis.md) (`moodValence`/`moodEnergy`),
[`04-people-roles.md`](04-people-roles.md) (people, relationships, encryption, capabilities, shareable-vs-private),
and [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (metering + budgets).

---

## 1. Overview

SelfOS is used by couples for closeness, intimacy, and sex — areas where patterns matter and are rarely
tracked honestly. This feature gives a **relationship** (especially a partner) a **dashboard** of
**metric trends over time** — drawn from questionnaire answers (`08`), session mood (`09`), and a new
lightweight **intimacy check-in** — so the coach (and the couple) can see how things are actually going:
is connection rising, is desire diverging, is appreciation flowing, is conflict spiking.

Everything here rides on the **shared metrics layer** (`08` §4.4): there is no bespoke "libido chart" —
metrics like `connection`, `desire`, `sexualSatisfaction` are just named signals, so the vocabulary grows
without schema changes. Comparative couple metrics (e.g. **desire-discrepancy**) use the **both-answer /
both-consent** model from `08` §3.6 — each partner logs **their own** perception; nothing is tracked
covertly about the other.

## 2. Goals / Non-goals

**Goals**

- A **per-relationship dashboard** (esp. partner relationships): **metric trends over time**, recent
  Insights, a **strengths/weaknesses digest**, and (when both consent + log) **desire-discrepancy** and
  other comparative views.
- A frictionless **intimacy check-in** — a 1–3 tap log of a few metrics (e.g. `desire`,
  `sexualSatisfaction`, `connection`) **+ optional detail** (date, who initiated, notes) — forming an
  **encounter log** over time. Built on the questionnaire/metrics layer.
- A **relationship metric vocabulary** (starter set, extensible) that questionnaires and check-ins populate.
- An optional, budget-gated **AI relationship summary** that distills recent trends/check-ins into an
  Insight the coach can use (and the couple can read).
- **Consent, safety, and lockability** appropriate to the most sensitive data in the app.

**Non-goals (deferred / owned elsewhere)**

- **Recurring / scheduled check-ins + reminders** — deferred (per `08`); check-ins and re-asks are **manual**
  in v1 (the schema is time-stamped + re-ask-ready, so a scheduler is a later additive slice).
- **The metrics _mechanism_ and the Insight layer** — owned by `08`; this spec defines the **vocabulary +
  dashboards + check-in**, not the storage primitive.
- **Session analysis** — owned by `09`; this spec **charts** its mood signal.
- **360°/group relationship analytics** — single-relationship focus in v1.
- **Any medical/diagnostic function** — see §8.

## 3. UX & flows

A **Relationship** detail (from `04`'s People/relationship screens) gains a **Tracking** tab (capability-
gated, §5; **lockable**, §8). For partner relationships it presents the **intimacy dashboard**:

### 3.1 The dashboard

- **Metric trends** — line/area charts over time for the relationship's tracked metrics (connection,
  satisfaction, desire, appreciation, conflict, communication, plus the **wellbeing/mood** trend from `09`).
  Each metric has a text-equivalent summary (not color-only).
- **Desire-discrepancy & comparative views** — when **both partners have logged + consented**, show both
  partners' lines and the **gap**, framed non-judgmentally ("desire has felt more aligned this month").
  Until both have logged, comparative views are hidden (not inferred).
- **Strengths / weaknesses digest** — a summarized view from appreciation + role-feedback questionnaire
  Insights (`08`).
- **Recent Insights** — the relationship-scoped Insights ("what the coach knows"), editable/deletable with
  provenance (`08` §3.7).
- **Encounter log** — the history of intimacy check-ins (metrics + any optional detail), most recent first.

### 3.2 Intimacy check-in (the quick log)

- A prominent **"Check in"** action opens a **short** form: a few metric sliders/ratings (default `desire`,
  `sexualSatisfaction`, `connection`) — designed for **1–3 taps** — with an **optional "Add detail"**
  expansion (date, who initiated [me/partner/mutual], notes/tags). Saving writes a `CheckIn` (§4).
- Each partner logs **their own** check-ins for the relationship; comparative metrics derive only from both
  partners' self-logs.
- The form is intentionally tiny so it's sustainable; long-form intimacy questionnaires remain the `08`
  path.

### 3.3 AI relationship summary (optional)

- A **"Summarize trends"** action (budget-gated, §6) distills recent check-ins + relationship Insights +
  metric movement into a short **relationship Insight** (with a fresh aggregate metric snapshot), which the
  coach can use and the user can read/edit/delete. Patterns only — never diagnosis (§8).

## 4. Data model

Reuses the shared `Insight`/`metrics` layer (`08` §4.4). One new encrypted, relationship-scoped entity:

```ts
type Initiation = 'me' | 'partner' | 'mutual';

interface CheckIn {
  id: string;
  schemaVersion: number;
  relationshipId: string; // the relationship this check-in is about
  loggerPersonId: string; // who logged it (their OWN perception)
  at: string; // ISO — the check-in / encounter moment
  metrics: Record<string, number>; // the quick taps, e.g. { desire, sexualSatisfaction, connection }
  encounter?: { initiation?: Initiation; notes?: string; tags?: string[] }; // optional detail
  createdAt: string;
  updatedAt: string;
}
```

- **Storage** — `relationships/<rel-id>/checkins/<check-in-id>.enc` (encrypted; per logger). Zod-backed,
  versioned, vault-routed (`00`/`04`). **In the vault → cross-device** (per `08` §4.1's single-vault model).
- **Metric vocabulary (starter, extensible)** — declared in core so questionnaires (`metricKey`), check-ins,
  and session analysis share keys: _relationship_ `connection`, `satisfaction`, `appreciation`, `conflict`,
  `communication`, `trust`; _intimacy_ `desire`, `sexualSatisfaction`, `frequencySatisfaction`,
  `initiationBalance`, `boundariesRespected`, `fantasyAlignment`; _individual_ `moodValence`, `moodEnergy`,
  `stress`, `energy`. Adding a metric is a vocabulary entry, **not** a schema change.
- **Trends** — the dashboard queries `CheckIn.metrics` + relationship/person `Insight.metrics` over a range;
  comparative views require entries from **both** `loggerPersonId`s.
- **No new Insight shape** — the AI relationship summary writes an ordinary relationship-scoped `Insight`
  (`08` §4.4).

## 5. Architecture & modules

- **checkInService** (`@selfos/core`) — encrypted CRUD over `CheckIn`; `queryRange(relationshipId, from, to)`.
- **trendService** (`@selfos/core`) — assembles metric series from `CheckIn` + `insightStore.queryMetrics`
  (`08`); computes comparative series (per-logger) + discrepancy; gated so comparative output needs both
  loggers.
- **relationshipSummaryService** (`@selfos/core`) — optional AI distillation → a relationship `Insight`;
  budget-gated, metered (`06`).
- **Capability** — a new `relationships.intimacy` (default ON for the relationship's own subjects; this is
  personal-to-the-relationship data). The **Tracking tab is lockable** (§8).
- **Renderer** — the relationship **Tracking** tab: dashboard (trend charts → `/gallery` primitives), the
  quick **Check-in** form, the encounter log, the comparative/discrepancy view, and the lock. Reuses `08`'s
  Insight-management + chart primitives.
- **Feature module** — registers the Tracking tab, the `relationships.intimacy` capability, the `CheckIn`
  schema, the metric vocabulary, and the IPC handlers (`08` §5.5 pattern). It also **registers a
  context-provider** (`08` §5.1) so the coach/gap-finder can use recent relationship metrics/summaries.

## 6. IPC / API contracts

Typed channels (`src/shared`, Zod-validated both sides):

- `checkins:create` / `:list({relationshipId, from?, to?})` / `:update` / `:delete`.
- `tracking:trends({relationshipId, metrics, range})` → series (+ comparative/discrepancy when both logged).
- `tracking:summarize({relationshipId})` → the `06` path: `checkBudget → call → recordUsage` with type
  **`relationship.summary`** (registered in `usageTypes`), charged to the active person; writes a
  relationship Insight. Caching on the stable prefix.
- The API key never crosses to the renderer; only decrypted domain objects do, per the active person's
  capabilities.

## 7. States & edge cases

Per `00` §7: loading / empty / error / offline everywhere. Specifically:

- **Empty** — no check-ins yet → a calm "log your first check-in" state; trends show once there's data.
- **One-sided comparative** — only one partner has logged → comparative/discrepancy views stay hidden with a
  gentle "both partners need to log for a shared view" note (never inferred from one side).
- **Locked** — the Tracking tab requires unlock (§8) before any sensitive data renders.
- **AI off / over budget** — trends + check-ins (structured, no AI) work fully; only "Summarize trends"
  degrades with the `06` state.
- **Sync conflict / migration** — `CheckIn` files follow the vault's conflict + migration handling (`00`),
  never auto-deleted.
- **Relationship deleted/archived** — its check-ins + relationship Insights archive with it (`08` §3.9
  semantics); Owner purge cascades.

## 8. Safety, privacy & honesty

This is the most sensitive surface in SelfOS.

- **Not medical.** Libido and sexual function can have medical causes. SelfOS **notices patterns** ("desire
  has felt lower this month") but **never diagnoses, scores clinically, or treats**, and routes health or
  distress signals (pain, significant distress, persistent conflict) to **professional resources** (a
  doctor, a sex/relationship therapist). The not-medical line is present on the surface (CLAUDE.md §1).
- **Consent, not covert tracking.** Comparative metrics use the **both-answer / both-consent** model — each
  partner logs **their own** perception; one partner can never build a hidden record of the other's
  desire/behavior. A comparative view appears only once **both** have logged and consented.
- **Lockable.** The Tracking tab is **lockable** behind the active person's PIN (the Owner bypasses), so an
  unlocked device doesn't expose intimate data; it never renders until unlocked.
- **Encryption + owner access.** `CheckIn`s and relationship Insights are encrypted at rest (`04` §5). The
  same honesty as `08` §8.4 applies: not zero-knowledge from the device owner (the Owner is the full-access
  role and holds the master key). **No raw-access audit log** (removed 2026-06-14).
- **Coercion awareness.** Framing is non-judgmental and pressure-free; the feature is for mutual insight, not
  scorekeeping. No streaks/nagging that could weaponize the data.

## 9. Accessibility

Per `01` §9: the dashboard charts have **text equivalents** (not color-only); the check-in sliders/ratings
expose value/min/max and are keyboard-operable; the lock and the comparative views are labelled and
screen-reader friendly. Responsive ~360px→desktop. Motion respects reduced-motion.

## 10. Testing strategy

- **Unit (core, node):** `checkInService` encrypted round-trip + range query; `trendService` series assembly
  from CheckIns + Insight metrics; comparative/discrepancy **hidden until both loggers present**;
  `relationshipSummaryService` (fake client) budget-gated + writes a relationship Insight + emits
  `relationship.summary`; metric-vocabulary keys shared; migration.
- **Component (RTL):** the Tracking tab lock; the quick check-in (1–3 tap path + optional detail); trend
  charts + text equivalents; empty + one-sided-comparative states; admin-only/lock markers.
- **E2E (Playwright):** log a check-in → it appears in the encounter log + moves a trend; both partners log →
  the comparative/discrepancy view appears (and is absent with one side); lock gates the tab; "Summarize
  trends" (with `SELFOS_FAKE_CLAUDE`) writes a readable Insight. No-overflow + control-geometry + mobile-width
  guards on the dashboard.

## 11. Open questions

1. **Lock mechanism** — confirm the Tracking lock reuses the person PIN (`04`) vs a dedicated app-lock; and
   whether the whole tab or only the intimate metrics are gated.
2. **Default check-in metrics** — confirm the default 3 (`desire`, `sexualSatisfaction`, `connection`) and the
   optional-detail fields' exact set/wording.
3. **AI summary cadence** — manual-only in v1 (confirmed deferral of scheduling); confirm no auto-summary.
4. **Comparative consent UX** — exact wording of the both-consent affordance shown before any comparative
   view renders.
5. **Metric normalization** — confirm the −1..1 vs 0..1 convention per metric for consistent charting.

## 12. Resolved decisions

Confirmed with the user (2026-06-10):

1. **Scope** — a per-relationship **intimacy/relationship dashboard** + **metric trends** (incl.
   desire-discrepancy) + a **short intimacy/encounter check-in with optional detail**, built on `08`'s
   metrics layer; **its own spec (11)**.
2. **Check-in granularity** — a **short 1–3 tap** check-in **+ optional** detail (date, initiation, notes);
   frictionless to keep longitudinal data flowing.
3. **Comparative metrics** — **both-answer / both-consent**; each partner logs their own perception; no covert
   tracking; comparative views hidden until both have logged.
4. **Metrics layer** — reuses `08`'s shared, extensible `metrics` map + a starter relationship/intimacy
   vocabulary; mood (`09`) is part of the same trend space.
5. **Recurring/scheduling** — **deferred**; check-ins + re-asks are **manual** in v1 (schema time-stamped +
   re-ask-ready).
6. **Safety** — most-sensitive surface: **not medical** (notice patterns, never diagnose; route health/distress
   to professionals), **lockable**, encrypted + owner-access honesty (`08` §8.4), coercion-aware framing.

## 13. Proposed build slices (after approval)

1. **Check-in + metric vocabulary + trends** — `CheckIn` schema/service, the metric vocabulary, `trendService`
   (incl. gated comparative/discrepancy), the context-provider registration. Backend + minimal UI.
2. **The Tracking dashboard** — the relationship Tracking tab: trend charts, the quick check-in form, the
   encounter log, the lock, empty/one-sided states.
3. **AI relationship summary** — the optional budget-gated `relationship.summary` distillation into an Insight.

(Depends on `08` slice 1 — the Insight/metrics layer — and reads `09`'s mood metrics when present.)

## 14. Changelog

- 2026-06-10 — created (Draft) as the companion tracking spec split out of `08`: the relationship/intimacy
  dashboard, metric trends (incl. desire-discrepancy), and the short intimacy check-in + optional encounter
  log, all on `08`'s shared metrics layer with the both-consent + not-medical model. Awaiting review/approval
  before any code.
- 2026-06-10 — **renumbered `10` → `11`**: the concurrently-built multi-device spec took `10`
  (`10-multi-device-vault.md`). Content unchanged.
- 2026-06-11 — **Approved** alongside `08`/`09`. Builds on `08`'s Insight/metrics layer (slice 1).
