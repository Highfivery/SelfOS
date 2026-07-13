# 59 — Questionnaires dashboard section (Home)

> **Status:** **Built** (on `feat/questionnaires-dashboard`, not merged) — _last updated 2026-07-13_
>
> **As-built deviations (see §13):** (1) the "latest insight" card shipped; the sibling **trend-forming** line
> is **deferred** (it needs a per-questionnaire `assignments:trends` read — a follow-up). (2) The `questionnaire-gap`
> "For you" provider was **left in place but gated OFF** (`questionnaireGapHint: false` in Home) rather than
> deleted — removing it cascaded through `RecommendationItem`'s state/imports + shared engine tests, so gating it
> off is the low-risk absorption (no duplicate nudge fires). (3) The **fun/spicy** "Ideas" cards seed the builder's
> **type + sensitivity** (not a prefilled AI brief) — the user taps "Draft with AI" there (which now uses the
> §22 explicit framing); a prefilled brief is a small follow-up. (4) "Go deeper" navigates to `/questionnaires`
> (the Suggested panel), where generation spends on tap.
>
> A dedicated, engaging **Questionnaires** section on the Home dashboard that turns questionnaires from a
> buried tool into a living loop: at-a-glance stats, the few things that need the person now, their latest
> questionnaire insight/trend, and smart, personal ideas for what to create, send, and answer next — across
> every type, including fun and (18+) spicy ones. It composes entirely from data SelfOS already has (no new
> IPC, no per-load AI spend) and complements — never duplicates — the "For you" engine ([`53`](53-home-encouragement.md))
> and the `/questionnaires` page ([`08`](08-questionnaires.md)).

Builds on [`08-questionnaires.md`](08-questionnaires.md) (the questionnaire/Insight data surfaces, the
gap-finder, the "no pre-built templates" rule, sensitivity gating), [`17-home-dashboard.md`](17-home-dashboard.md)
(the per-active-person, derived-only Home composition), [`53-home-encouragement.md`](53-home-encouragement.md)
(the ranking engine + the status-vs-push distinction + crisis suppression + the per-person proactivity dial),
[`04-people-roles.md`](04-people-roles.md) (capabilities, the shareable boundary), and
[`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (AI only on explicit tap, metered).

---

## 1. Overview

**Problem.** Home has **no dedicated questionnaires surface**. Questionnaires appear only as (a) the `InboxCard`
(a bare count of things awaiting you) and (b) one coarse, generic "For you" nudge (`questionnaire-gap`, fires
merely when `configured && inboxCount === 0`). Nothing surfaces response rates, new replies to analyze, the
insights questionnaires produced, or _personal_ reasons to send the next one. The owner wants Home to
**encourage and entice** creating, sending, and answering questionnaires — of every type — with a smart,
interactive, insightful section: flag "you haven't sent this kind yet," suggest new questionnaires from recent
data (sessions, dreams, Together, prior answers), show the latest insights, and promote fun **and** sexy
questionnaires.

**Where it sits.** A new **`QuestionnairesSection`** on Home (a labelled section like `ForYou`), self-hiding when
there's genuinely nothing to show. It **absorbs** the `InboxCard` and the generic `questionnaire-gap` "For you"
provider (§5.4 of 53 — move where/how, not what), so there's exactly one home for questionnaire encouragement and
no duplicate weak nudge.

## 2. Goals / Non-goals

**Goals**

- A dedicated, self-hiding **Questionnaires** section on Home, capability-gated (`questionnaires.create` **or**
  `questionnaires.answer`), that reads as sleek and intentional (§12 of CLAUDE.md).
- **Cross-questionnaire rollup stats** (sent · response rate · new replies · insights) — a pure derivation over
  existing reads, each stat clickable to where it lives.
- **"Needs you"** — the few actionable items, ranked: answer an inbox questionnaire; analyze new responses;
  re-analyze answers a recipient edited; resend a link to someone still unanswered past the reminder window.
- **Latest insight + a trend forming** — the most recent questionnaire-derived Insight excerpt (deep-linking to
  Memory) and, when present, a rating trend across re-asks.
- **"Ideas for you"** — personal, tap-to-act suggestions: (a) _go deeper from your data_ (the recipient-first
  gap-finder), (b) a _variety_ nudge ("you haven't sent a **fun** / **appreciation** / **scenario** one yet"),
  and (c) **AI-draft-on-tap** chips for **fun** and **spicy** (18+) questionnaires — personalized, nothing stored.
- Encourage **all** types, including fun and (18+, gated) sexy — SelfOS's questionnaires should feel inviting and
  playful, not clinical.

**Non-goals**

- **No pre-built templates.** The [`08`](08-questionnaires.md) "no templates" rule stands — "fun" and "spicy" are
  **AI-drafts on tap** (a brief + type/tier seed → the existing "Draft with AI" path), never a stored library.
  (Owner decision, 2026-07-13.)
- **No new IPC channels.** The section composes from existing reads (§6). New logic is pure, testable derivations.
- **No per-load AI spend.** The gap-finder and the fun/spicy drafts run only on an explicit tap (the 53 §6 rule);
  cached gap-finder suggestions may be _shown_ on load (no spend), but never _generated_ on load.
- **Not a replacement** for the `/questionnaires` page (authoring, results, full lists) or the "For you" engine —
  it complements both.
- No cost/$ surfaced (admin-only elsewhere; this section shows none).

## 3. UX & flows

The section (top → bottom), matching the approved 2026-07-13 mockup:

1. **Header** — "Questionnaires" + a quiet "Create" affordance (→ the builder). Present whenever the section shows.
2. **Stat strip** — up to four compact metric tiles, each a link:
   - **Sent** — distinct questionnaires you've sent (≥1 send). → `/questionnaires` (Sent).
   - **Response rate** — answered ÷ total sends across all your questionnaires (a rounded %). → Results.
   - **New replies** — submitted-but-un-analysed sends (accent-tinted when > 0). → the first analyzable send.
   - **Insights** — questionnaire-derived approved Insights. → Memory (questionnaire responses).
     A tile with a zero value is omitted (never a wall of zeros).
3. **"Needs you"** — 0–3 ranked action rows, each an icon + one line + an inline action (self-hides when empty):
   - **Analyze new responses** — "Angel answered '…'" → **Analyse** (reuses the existing one-tap analyze).
   - **Answer** — "N waiting for you to answer" → **Answer** (→ `/inbox`), from the inbox count.
   - **Re-analyze** — "Angel edited their answers" → **Re-analyze** (the [`56`](56-answer-review-edit-reanalyze.md)
     `answers-updated` signal).
   - **Resend** — "Still waiting on Dad — sent 9 days ago" → **Resend link** (the [`38`] reminder-due signal).
4. **Latest insight + trend** — a two-up row (each self-hiding): the most recent questionnaire Insight excerpt
   ("View in Memory →", deep-linked by `insightId`), and, when a rating trend exists, a one-line "a trend forming"
   with "See trends →".
5. **"Ideas for you"** — up to three tap-to-act cards (a **push** surface — §7):
   - **Go deeper (from your data)** — a recipient-first gap-finder idea ("Ask Angel about the move — it came up in
     two sessions this week"). Tapping opens the builder's knowledge-aware "Draft with AI" for that recipient (the
     existing [`18`](18-personal-onboarding.md)/§08 path; spends on tap, not on load). When cached suggestions
     exist they're shown; otherwise a "let the coach suggest one" tap.
   - **Variety** — "You haven't sent a **fun** one yet" (or appreciation / scenario / …), derived from the types
     you _have_ sent vs the starter taxonomy. → the builder seeded to that type.
   - **Spicy (18+)** — a playful intimacy draft, shown **only** after the per-person 18+ ack (`adultAcknowledged`).
     → the builder seeded `type: intimacy`, an appropriate tier, "Draft with AI".

**Empty / near-empty.** A brand-new person still sees `GettingStarted` (Home owns that, §17). When the person has
capability but nothing yet, the section shows a single warm invitation ("Learn what someone thinks — send your
first questionnaire") rather than an empty grid; it self-hides entirely only when the person can neither create
nor answer.

## 4. Data model (vault files & schemas)

**No new vault files, no new schemas, no new IPC.** The section is a **derived-only** surface, exactly like the
rest of Home (§17). New code is **pure derivations** over existing view types:

- A pure module (renderer route helper, the `resultsSummary.ts`/`sentGrouping.ts` precedent — or `@selfos/core`
  if it proves reusable) computing:
  - `rollupStats(sentOverview, insights)` → `{ sentCount, responseRate, newReplies, insightCount }` across **all**
    the person's questionnaires (today's `summarizeSends` is per-questionnaire only — this aggregates).
  - `needsYou(sentOverview, inboxItems, answersUpdated, reminderDue)` → the ranked action rows.
  - `unsentTypes(questionnaires, sentOverview)` → the starter types the person has **authored+sent none of**
    (drives the variety nudge). Data exists (`Questionnaire.type` + which are sent) but nothing derives it today.
  - `ideas(state)` → the ranked "Ideas for you" (go-deeper / variety / spicy), respecting the 18+ ack + crisis
    suppression + proactivity (§7).
    All pure + unit-tested; **no** persisted format, so no `schemaVersion`/migration.

## 5. Architecture & modules

- **Renderer composition only.** A new `QuestionnairesSection` under `apps/desktop/src/renderer/.../routes/home/`,
  mounted by `Home.tsx`. It reads stores Home already loads (`questionnaireStore.sentOverview`, `inboxStore`,
  `insightStore` filtered to `source === 'questionnaire'`, and — for the trend/analyze targets — the existing
  results/aggregate reads on demand). Per-person isolation is inherited (Home resets + reloads on
  `activePerson.id`, §17).
- **Absorb, don't duplicate (53 §5.4).** Remove the coarse `questionnaire-gap` provider from the "For you" engine
  and the standalone `InboxCard`; their intent moves into this section verbatim (answer count → the Answer row;
  the gap nudge → the go-deeper idea). One home for questionnaire encouragement.
- **"Ideas" spend on tap only.** Cached gap-finder suggestions (`questionnaireSuggestionsList`, per recipient) are
  _shown_ with no spend; generating a fresh one, or an AI-draft fun/spicy questionnaire, navigates into the
  builder's existing metered "Draft with AI" (never auto-runs on Home load — the 53 §6 invariant).
- **The recommendation engine stays the general one.** This section is questionnaire-specific and richer than a
  single ranked card; it does **not** re-implement the engine. (If, in build, a lighter approach is preferred,
  the fallback is registering additional questionnaire-domain providers — but the owner chose a dedicated
  section, so the section is primary.)

## 6. IPC / API contracts

**None new.** Reuses: `questionnaires:sentOverview` (`viewResults`-gated), `assignments:inbox`, `insights:list`,
`assignments:trends` / `assignments:aggregate` / `assignments:results` (as needed for the trend + analyze
targets), `notifications:answersUpdated` / the reminder-due read (already derived in the bridge for [`35`]/[`38`]),
`gapfinder:suggest` + `questionnaireSuggestions:*` (on tap), `questionnaires:list` / `:listTypes`. All existing,
all gated as today (the bridge remains the trust boundary; nothing new crosses it).

## 7. States & edge cases

- **Status vs push (the 53 split).** The **stats** + **"Needs you"** + **latest insight** are **status** surfaces
  — shown regardless of the proactivity dial (like `InboxCard`), because they reflect real state the person
  should see. The **"Ideas for you"** cards are **pushes** — suppressed when `proactivity === 'off'`, during a
  recurring-distress moment (lead with support, never nudge — 53 §8), and for a brand-new person (GettingStarted
  owns the screen).
- **18+ gating.** The spicy idea appears **only** after the per-person `adultAcknowledged` ack — never a premature
  sexual push (mirrors the `intimacy-exercise` provider). Before the ack, it's simply absent.
- **AI off / no key / over budget.** Stats + Needs-you + insight work offline (deterministic reads). The
  AI-bearing ideas (go-deeper generate, fun/spicy draft) show the calm `AiUnavailableNotice` (role-aware, [`41`])
  instead of a dead button — never a spend-that-can't-happen.
- **Privacy.** Stats never expose raw private answers: response-rate/counts are status counts; the "At a glance"
  aggregate (if referenced) is **Standard-only** by construction ([`08`] §21); the latest-insight excerpt is the
  **sender's own derived Insight** (not raw answers). No cost/$ shown.
- **Self-hide.** Each block self-hides when empty; the whole section hides when the person can neither create nor
  answer, or (for a brand-new person) when GettingStarted is showing.

## 8. Safety, privacy & honesty

- Fun/spicy framing stays tasteful and **within the [`08`] consensual-adult boundary**; the spicy idea is
  18+-gated (§7) and routes into the same gated builder path — it never generates explicit content on Home.
- No surface implies an owner/admin can read someone's answers (durable rule; CLAUDE.md §1).
- The section is honest about state: "N new replies" reflects real un-analysed submissions; "you haven't sent a
  fun one" is a true coverage fact, not a manufactured urgency.

## 9. Accessibility

A labelled `<section aria-label="Questionnaires">`; each stat tile and action row is a real link/button with a
descriptive name; counts/percentages are text (not colour-only); the section reflows to one column and never
horizontally scrolls at ~360px (CLAUDE.md §12). Icons are decorative (`aria-hidden`).

## 10. Testing strategy

- **Unit** — the pure derivations: `rollupStats` (response rate across multiple questionnaires; zero-omit),
  `needsYou` ranking (analyze > answer > re-analyze > resend; caps at 3), `unsentTypes` (excludes types you've
  sent), `ideas` (18+ ack gates the spicy idea; proactivity-off/crisis suppress pushes).
- **RTL** — the section renders each block from seeded stores; the AI-off calm state on the ideas; the spicy idea
  is absent before the ack and present after; status blocks show with proactivity off while pushes don't.
- **E2E** — seed sent + inbox + a questionnaire insight → the section shows the stat strip, a "Needs you" analyze
  row that runs, the latest insight deep-links to Memory; the spicy idea is gated by the 18+ ack; a 360px
  no-overflow guard (incl. inner scrollers). Decrypt where asserting data.
- Run `pnpm typecheck` after tests (memory `vitest-does-not-typecheck`). `/gallery` updated only if a new
  design-system primitive is introduced (aim to reuse existing Card/Stat/Button primitives).

## 11. Open questions (for review)

1. **Placement on Home.** Proposed: its own labelled section **after** "For you" and the OnboardingCard, replacing
   the InboxCard's slot (so questionnaires get a real presence above the generic status grid). Alternative: inside
   the status grid as one wide card. (Recommend the dedicated section.)
2. **Absorb the `questionnaire-gap` "For you" provider + the `InboxCard`?** Proposed **yes** (one home, no
   duplicate nudge). If you'd rather keep a questionnaire card in "For you" too, say so.
3. **Variety nudge scope.** "You haven't sent a _fun_ one" — do you want it across the **whole** starter taxonomy
   (general/appreciation/scenario/intimacy/…), or only a curated inviting subset (fun + appreciation + spicy)?
4. **"Go deeper" cross-feature sources.** The gap-finder today reads profiles/relationships/prior Insights. The
   mockup teases "it came up in two sessions this week" — do you want the go-deeper idea to also cite **recent
   sessions / dreams / Together** as the _reason_ (surfacing the trigger), or keep the gap-finder's existing
   structured-context basis and a generic reason? (Citing the trigger is more enticing but touches the reason
   copy; the gap-finder never reads raw transcripts, only structured context — §08 §5.)

## 12. Resolved decisions (2026-07-13)

- **Dedicated Home section** (not "For you"-only, not a hub page) — owner's choice.
- **Fun/spicy = AI-drafts on tap** (no curated templates; the "no templates" rule stands) — owner's choice.
- **Spec-first**, then build slice by slice — owner's choice.

## 13. Proposed build slices (after approval)

1. **Derivations + stats + Needs-you (status core).** The pure module + the section's stat strip and "Needs you"
   rows; absorb the `InboxCard`. No AI. Unit + RTL + E2E.
2. **Latest insight + trend.** The insight excerpt (deep-link) + the trend-forming line.
3. **Ideas for you (pushes).** Go-deeper (gap-finder on tap), the variety nudge, and the 18+ spicy + fun AI-draft
   chips; absorb + remove the `questionnaire-gap` provider; the AI-off/crisis/proactivity gating.
4. **Polish + visual QA** at desktop + 360px; `/gallery` if a primitive was added.

## 14. Changelog

- 2026-07-13 — **Built** (on `feat/questionnaires-dashboard`). A pure `questionnaireDashboard.ts` (rollupStats /
  questionnaireInsights / needsYou / unsentTypes) + a `QuestionnairesSection` on Home: stat strip (Sent · response
  rate · new replies · insights, zero-tiles omitted), ranked "Needs you" rows (analyze / answer / re-analyze /
  resend), the latest questionnaire insight (deep-link to Memory), and the "Ideas for you" pushes (go-deeper /
  variety / 18+ spicy / fun) gated by `showEncouragement` + the 18+ ack. Absorbed the `InboxCard` (deleted) + gated
  off the generic `questionnaire-gap` nudge; a person who has SENT a questionnaire is no longer "brand new" so the
  section shows (the Together precedent). `BuilderSeed` gained optional `sensitivity` for the spicy card. No new
  IPC, no new vault schema, no per-load AI spend. Tests: 8 derivation units, 4 section RTL, the updated Home test,
  and an E2E (self-send → answer → the section shows real stats + a needs-you analyze row + a 360px overflow guard;
  real-Electron visual QA at desktop). Deviations recorded in the header + §13.
- 2026-07-13 — Spec drafted. Motivated by the owner's ask to make Home encourage and entice creating/sending/
  answering questionnaires (all types, incl. fun + sexy) with stats, insights, things-to-do, and smart
  suggestions. Direction confirmed via an interactive mockup + an `AskUserQuestion` round (dedicated section;
  fun/spicy = AI-drafts on tap; spec-first). All data surfaces verified to already exist (no new IPC).
