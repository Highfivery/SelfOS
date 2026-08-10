# 70 — Adaptive Exploration surface — "what's next," not "what's done"

> **Status:** Built (all 4 phases) · _last updated 2026-08-09_
>
> Reimagines the [`69 §3.4`](69-questionnaire-intelligence.md) "Explored" tab from a backward-looking,
> binary coverage report ("this area is Explored ✓") into a **forward-first, dynamic** surface that shows
> **what SelfOS is curious about next** for this person — concrete, curatable candidate questions drawn from
> their real data and the gaps — over an honest "how well I know you" overview that never implies completion.
> Adds a **"Explore with your partner"** wishlist that lets a person steer the questions their connected
> partner receives. Exploration is never finished; the surface should make that true and useful.

This **amends** [`69 §3.4`](69-questionnaire-intelligence.md) (the Explored tab + the Personalization Profile

- the coverage model) and **reuses, does not duplicate**, its machinery: the coverage map
  (`coverageModel.ts`/`coverageService.ts`), the profile store (`personalizationProfile.ts`), the shared
  gatherers + steering (`recipientHistory.ts`), and the `questionnaire.profile` metered cadence. It feeds and is
  fed by [`63`](63-auto-checkins.md) (auto check-ins), [`08`](08-questionnaires.md) (generation + the gap-finder
- the 18+ gates), [`58`](58-together-couples-sessions.md) (couples sessions), [`42`](42-relationship-scoped-sharing.md)/[`43`](43-relationship-scoped-onboarding-sharing.md)
- the [`69 §5.4`](69-questionnaire-intelligence.md) reciprocity model, [`49`](49-intimacy-activities-inventory.md)
  (the intimacy inventory), [`39`](39-living-memory-continuity.md) (the reconcile cadence), and [`06`](06-ai-usage-and-budgets.md)
  (metering). It references [`00`](00-architecture.md) and [`01`](01-design-system.md) rather than restating them.

---

## 1. Overview

### 1.1 The problem (from the user, verified against the live surface)

The `69 §3.4` Explored tab shipped as a v1 skeleton and is conceptually wrong in four ways:

- **"Explored" is a false binary.** Each life area shows a single `depth` (0..1) rolled up to an
  `explored / lightly-touched / not-yet` status. The AI placement pass (`coverageService.refreshCoverage`)
  scores depth **generously** — the [`69 §26.3`](69-questionnaire-intelligence.md) live tuning showed an active
  person's areas all land ≥ 0.5 — so a real user sees **every area green "Explored,"** which reads as
  _"we're done here, nothing more to ask."_ That is never true: every area always has new angles, deeper
  follow-ups on what was said, and whole threads never touched.
- **It breaks its own promise.** The intro says "…and where it's steering next," but the panel shows only
  current coverage. It never shows what's **next**.
- **It isn't dynamic.** The topics are a fixed 10 `LIFE_AREAS` (+ intimacy categories). The user asked for
  topics that adapt to _them_ — what's been explored, what's new, what could go deeper.
- **Intimacy is mis-framed.** The row is read-only and (post-[`#386`](69-questionnaire-intelligence.md)) links
  to "your onboarding intimacy answers," implying intimacy exploration is _limited to onboarding_ — but it
  grows from intimacy questionnaires + sessions too, and the person should be able to steer it.

### 1.2 The shape of the fix

Flip the surface from **backward + binary** to **forward + dynamic + honest**, and add a way to steer a
partner's exploration:

1. **A "What SelfOS is curious about next" feed** (§3.2) — dynamic candidate questions/topics generated from
   the person's own data + the coverage gaps, each tagged **new ground** or **go deeper**, **curatable**
   (Ask-me-this / Not-this / Go-deeper). These candidates **are the pool generation draws from** — what you
   see is what gets asked.
2. **An honest area overview** (§3.3) — a recalibrated, never-"done" read of how well SelfOS knows each area,
   with the area-level Explore-more / Leave-alone steers retained.
3. **Intimacy as a first-class, steerable, 18+-gated area** (§3.4) — sourced from all intimacy signals.
4. **An "Explore with your partner" wishlist** (§3.5) — what a person wants explored _with_ their connected
   partner, which **silently** steers that partner's auto check-ins, questionnaires, and Together prompts.

All of §3.2–§3.4 stays **own-scoped** — the read never surfaces another person's data ([`69 §6/§8`](69-questionnaire-intelligence.md)).
The partner wishlist (§3.5) is the person's **own** input about a partner they're connected to; it is silent
(the partner never sees "you requested X").

## 2. Goals / Non-goals

**Goals**

- **Never imply "done."** Kill the binary "Explored." Coverage reads as a getting-to-know-you gradient that
  always leaves room to learn more.
- **Lead with what's next.** Surface concrete, dynamic candidate questions the app is curious about, tagged
  new vs. go-deeper, refreshed on the existing daily cadence and cached (instant + free to view).
- **Make the person a curator.** Ask-me-this / Not-this / Go-deeper on candidates, and keep area-level steers,
  so what generation asks is genuinely shaped by the person.
- **Honest depth.** Recalibrate the coverage placement so it reads truthfully (most areas partially known,
  rarely "deeply"), and drive the strong-new-ground bias from a truthful map.
- **Intimacy, un-limited + steerable.** A full gated area sourced from every intimacy signal.
- **Steer a partner's exploration.** Let a person express what they want explored with their partner, silently
  feeding that partner's questionnaires + auto check-ins + Together prompts.

**Non-goals** (see §14)

- No new generation/answering engine — everything still routes through `generateQuestions` + `createAssignment`
  - the [`69`](69-questionnaire-intelligence.md) engine. The candidate feed is a **surfacing + curation** layer
    over the existing gap-finder/coverage machinery, not a parallel generator.
- No cross-person data leak — the Explored read stays own-scoped; the partner wishlist is silent, never a
  window into the partner's own coverage/answers.
- No change to the consent/age gates or `SAFETY`.
- No recipient-consent handshake — the partner's existing [`63 §3.3a`](63-auto-checkins.md) see-and-stop
  controls still apply to anything the wishlist steers.

## 3. UX & flows

The Explored tab (the [`59`](59-questionnaires-dashboard.md)/[`69 §3.4`](69-questionnaire-intelligence.md)
4th tab, gated `questionnaires.own`) is rebuilt top-to-bottom:

### 3.1 Layout (hybrid: feed over overview)

```
Explored
├─ "What SelfOS is curious about next"        ← the dynamic candidate FEED (§3.2), leads the surface
│    • [new ground]  <candidate question>      Ask me this · Not this · Go deeper
│    • [go deeper]   <candidate question>      Ask me this · Not this · Go deeper
│    • … (bounded; a calm "refreshes daily" note; a manual "Look for more" when stale)
├─ "How well I know you"                        ← the honest area OVERVIEW (§3.3), compact
│    • Relationships   ·  Getting to know you   Explore more · Leave alone
│    • Intimacy (18+)  ·  Knows you well        Explore more · Leave alone   (§3.4)
│    • …
└─ "Explore with <partner>"                     ← one card per connected partner (§3.5), when present
     a wishlist input + the current entries
```

### 3.2 The "what's next" candidate feed (dynamic, curatable)

- **Content.** A bounded list (default ≤ 10) of concrete candidate questions/topics SelfOS could ask this
  person next, each carrying its **life area** and a **type tag**: `new` (unaddressed ground) or `go-deeper`
  (a follow-up on something already said). Generated by an AI pass over the person's data + coverage gaps
  (§5.3), cached in the profile (§4.2), refreshed on the daily cadence (§5.4).
- **These are the real pool.** Generation (manual builder, auto check-ins, dream, story) preferentially draws
  from the surfaced candidates so "what you see is what gets asked" (§5.5). A candidate that has been asked
  (an assignment minted from it) drops off the feed.
- **Curation (cheap, no AI per tap; writes the profile):**
  - **Ask me this** — prioritize this candidate; the next generation for the person leads with it.
  - **Not this** — skip this specific candidate (regenerate a different one next refresh). **Not** a topic ban
    (that's the area-level Leave-alone); it just declines _this_ phrasing/candidate.
  - **Go deeper** — mark the underlying thread for a deeper follow-up next time.
- **States.** Empty/new person → the feed is onboarding-first ("Let's start with the basics — <candidates>").
  Pre-first-refresh (no cached candidates) → a calm "SelfOS is still getting to know you; check back after
  your next check-in," plus a `Look for more` button (spends, budget-gated) to generate on demand.

### 3.3 The honest area overview (never "done")

- One compact row per life area with a **getting-to-know-you** signal — a 3-step, never-complete scale:
  **New** (nothing yet) · **Getting to know you** (some) · **Knows you well** (a lot, _but still more to
  learn_). Shown as **text + a subtle meter** (never color-only; §9). No "Explored/done" language anywhere.
- Retains the area-level steers: **Explore more** (lean into this area) / **Leave alone** (back off), the
  [`69 §3.4`](69-questionnaire-intelligence.md) mechanism, kept alongside candidate-level curation.
- The row's depth is the recalibrated placement (§5.2) — honest, so "Knows you well" is reserved for areas
  genuinely explored from many angles.

### 3.4 Intimacy as a first-class, gated area

- Intimacy is a normal overview row **and** contributes candidates to the feed — sourced from **all** intimacy
  signals (intimacy questionnaires + sessions + onboarding + the [`49`](49-intimacy-activities-inventory.md)
  inventory + the [`69 §5.7`](69-questionnaire-intelligence.md) intimacy coverage engine), not onboarding
  alone. The [`#386`](69-questionnaire-intelligence.md) "onboarding-only" link/text is removed.
- **Gating.** The Intimacy row + its candidates render only once the person has done the shared **18+
  acknowledgement** ([`08 §8.3`](08-questionnaires.md) / the guidance-prefs `adultAcknowledged`); otherwise the
  area is omitted (§11 decision — "hide until 18+" was **not** chosen; instead: shown but its explicit
  candidates are 18+-gated). Explicit-tier candidates obey the existing consent/tier gates; the register is
  unchanged.
- Steerable like any area (Explore more / Leave alone + candidate curation).

### 3.5 "Explore with <partner>"

- **Availability.** A distinct card per **connected partner** (a live `partner` relationship edge), for **any
  member** — you steer exploration with _your_ partner (§11 decision). Absent when no partner edge exists.
- **Input.** A short free-text add ("something you'd like to explore together") building a small list of
  entries. Each entry is the person's own wish; edit/remove supported.
- **Effect (silent steering).** The entries feed the partner's generation across **auto check-ins,
  questionnaires the person sends the partner, and Together couples-session prompts** (§5.6) — tactfully and
  self-contained ([`69 §5.4`](69-questionnaire-intelligence.md) reciprocity register: never quoting the raw
  wish, presenting the question on its own terms). The partner **never sees** "your partner requested X."
- **Respecting the partner's controls.** Anything this steers still obeys the partner's existing
  [`63 §3.3a`](63-auto-checkins.md) see-and-stop opt-out + blocks; an intimacy wish only steers intimacy
  questions when **both** partners have the 18+ ack (§8).

## 4. Data model (vault files & schemas)

All state lives in the existing **Personalization Profile**
(`people/<personId>/questionnaires/personalizationProfile.enc`, [`69 §4`](69-questionnaire-intelligence.md)) —
**additive fields, no `schemaVersion` bump** (the [`69`](69-questionnaire-intelligence.md) tolerant-parse
precedent). All reads/writes go through the vault service.

### 4.1 New/changed schema (Zod — source of truth; `personalizationProfile.ts`)

```ts
// A cached candidate question the app is curious about next (spec 70 §3.2).
const NextCandidate = z.object({
  id: z.string(), // stable per candidate (for curation + "asked" tracking)
  lifeArea: z.string(), // from the coverage map
  topicId: z.string().optional(), // the thread it belongs to (for go-deeper)
  prompt: z.string(), // the candidate question text
  kind: z.enum(['new', 'go-deeper']),
  curation: z.enum(['asked', 'skipped', 'go-deeper', 'none']).default('none'),
  mintedAssignmentId: z.string().optional(), // set once generation actually asked it → drops off the feed
  at: z.string(),
});

// One entry in "explore with your partner" (spec 70 §3.5) — stored in the REQUESTER's profile.
const PartnerWish = z.object({
  id: z.string(),
  partnerPersonId: z.string(), // who to explore WITH (a live partner edge, resolved at read time)
  note: z.string(), // the person's own words
  intimacy: z.boolean().default(false), // an intimacy wish → double-18+-gated to steer intimacy questions
  at: z.string(),
});

// Added to PersonalizationProfileSchema (additive-optional):
//   candidates: z.array(NextCandidate).default([]),
//   candidatesRefreshedAt: z.string().optional(),
//   relational: { …existing reciprocity…, partnerWishes: z.array(PartnerWish).default([]) }
```

- **Bounded** (rolling caps, the [`69`](69-questionnaire-intelligence.md) precedent) so the doc stays economical.
- Candidate `curation` state + the `mintedAssignmentId` are how "asked → drops off" + "Not this → regenerate"
  work without a separate store.

### 4.2 What feeds it

- **Candidates** — the AI "next-topics" pass (§5.3), fed the person's own answers + insight facts + the
  recalibrated coverage map + the feedback ledger, so it proposes genuinely-new + go-deeper questions and
  honors the ledger (avoid `not-applicable`, reword `unclear`, respect `Not this`).
- **Coverage depth** — the recalibrated placement pass (§5.2).
- **Partner wishes** — the person's own free-text, read at generation time and gated by the live edge +
  (for intimacy) both 18+ acks.

## 5. Architecture & modules

### 5.1 New/changed modules

- `packages/core/src/questionnaires/coverageService.ts` — **recalibrate** `COVERAGE_SYSTEM` (honest depth,
  §5.2) and add the **next-topics pass** `refreshNextCandidates` (§5.3), riding the same cadence as
  `refreshCoverage`.
- `packages/core/src/questionnaires/personalizationProfile.ts` — candidate + partner-wish schema; pure
  `applyCandidateCuration` / `markCandidateAsked` / `addPartnerWish` / `removePartnerWish`; a
  `buildPartnerWishGuidance` reader (the reciprocity-register block for a partner's generation).
- `packages/core/src/questionnaires/transparencyView.ts` — extend the projection: the candidate feed
  (own-scoped), the honest area overview, and (own) the partner-wish list per connected partner.
- Renderer `ExploredPanel.tsx` — the forward-first rebuild (feed + overview + partner cards); `coverageStore`
  gains candidate curation + partner-wish actions.

### 5.2 Honest depth (recalibrate the placement pass)

`COVERAGE_SYSTEM` is retuned so depth reads truthfully: reserve high depth for areas explored **from many
angles over time**, not "a fact or two." The display scale maps depth → New / Getting to know you / Knows you
well with a **high bar** for the top. Generation's strong-new-ground bias ([`69 §5.2`](69-questionnaire-intelligence.md))
is unchanged in mechanism — it just reads a more honest map. (Live-model re-tuning is a §10 on-device DoD
item, the [`69 §26.3`](69-questionnaire-intelligence.md) precedent.)

### 5.3 The next-topics pass (`refreshNextCandidates`)

- One metered `questionnaire.profile` AI call (or folded into the coverage-refresh call to save a round-trip),
  fed a bounded digest of the person's data + the coverage gaps + the feedback ledger, returning a bounded set
  of `{ lifeArea, prompt, kind, topicId? }` candidates. Tolerant-parsed (`jsonSalvage`); budget-gated;
  fail-safe (a failed pass leaves the last-good candidates, sets `degraded`).
- Author-blind + own-data ([`69 §8`](69-questionnaire-intelligence.md)) — it reads the person's own data into
  their own profile; nothing crosses to another person.
- Merges with existing curation: `asked`/`skipped` candidates aren't re-proposed identically; `Ask-me-this`
  pins carry forward.

### 5.4 Cadence + metering

Rides the [`39`](39-living-memory-continuity.md) reconcile / [`69 §5.6`](69-questionnaire-intelligence.md)
coverage cadence (launch/focus, 24h throttle, ≥N-new-signals gate) — the same pass that already refreshes
coverage now also refreshes candidates. Metered `questionnaire.profile`; budget-gated. The manual `Look for
more` forces a refresh (spends). Viewing + curating are free.

### 5.5 Candidates → generation (what you see is what gets asked)

`planGeneration` / the shared gatherers gain the candidate set as a **positive** input: pinned (`Ask me this`)
candidates lead; `skipped` are excluded; `go-deeper` threads bias toward depth. When generation mints an
assignment from a candidate, `markCandidateAsked` stamps `mintedAssignmentId` so it drops off the feed. This
keeps the panel and the actual questions in lockstep.

### 5.6 Partner wishes → the partner's generation

`buildPartnerWishGuidance(requesterId, partnerId)` returns a reciprocity-register block for the **partner's**
generation, read wherever a person authors/auto-sends to the partner or a Together session runs:

- **Auto check-ins** ([`63`](63-auto-checkins.md)) — the partner's `runAutoCheckins` folds in the wishes aimed
  at them (in addition to the owner's per-target exploration focus, which stays as an override — the two merge,
  they don't diverge).
- **Questionnaires** the person sends the partner — the manual/gap-finder path folds them in.
- **Together** ([`58`](58-together-couples-sessions.md)) — the couples-session prompt builder folds them into
  the shared topic steering (both partners' wishes may apply; the couples register keeps it mutual).
- **Gating.** Read only for a **live partner edge** (re-checked each read; a removed edge drops it, the
  [`69 §8`](69-questionnaire-intelligence.md) re-gate); an `intimacy` wish steers intimacy questions only when
  **both** partners hold the 18+ ack. Silent (never quoted; the reciprocity register).

## 6. IPC / API contracts

Extends the [`69 §6`](69-questionnaire-intelligence.md) own-scoped seam (gated `questionnaires.own`,
active-person-scoped in the bridge — the trust boundary). No raw partner data crosses.

- `questionnaires:personalizationProfile` (existing) — its returned view gains the candidate feed + the
  honest area overview + the per-connected-partner wish list (own data only).
- `questionnaires:curateCandidate` (new) — `{ candidateId, action: 'ask' | 'not-this' | 'go-deeper' | 'clear' }`
  → the refreshed view. Own-scoped.
- `questionnaires:addPartnerWish` / `:removePartnerWish` (new) — `{ partnerPersonId, note, intimacy? }` /
  `{ wishId }` → the refreshed view. Gated `questionnaires.own` **and** re-checked against a live partner edge
  in the bridge (a person may only add a wish for a partner they're actually connected to).
- `questionnaires:refreshNextCandidates` (new) — the manual `Look for more`; budget-gated; metered
  `questionnaire.profile`; the key stays in main.

## 7. States & edge cases

- **No candidates yet / AI off / over budget** — the feed shows the calm "still getting to know you" state +
  the free deterministic gaps; curation + partner wishes still work (cheap, no AI). Consistent with
  [`31`](31-ai-required.md).
- **Everything "known"** — impossible by construction now: the feed always has candidates (there's always a
  new angle / a go-deeper), and the overview never says "done."
- **Degraded next-topics pass** — keep the last-good candidates; surface honestly ([`69 §5.5`](69-questionnaire-intelligence.md)).
- **A candidate was asked** — `mintedAssignmentId` drops it off; the next refresh proposes fresh ones.
- **No partner edge** — the partner card is absent; a wish whose edge is later removed stops steering (re-gate).
- **Intimacy not acked** — the Intimacy area's explicit candidates are withheld; an intimacy partner-wish is
  inert until both 18+ acks.
- **Corrupt/partial profile** — tolerant parse degrades a bad candidate/wish to default; never crashes a read
  or a generation ([`69 §7`](69-questionnaire-intelligence.md)).
- **Sync conflict** — the small profile follows the vault service's handling; last-writer-wins is acceptable
  (candidates are regenerable; wishes are re-addable).

## 8. Safety, privacy & boundaries

- **Own-scoped read (unchanged).** The Explored read only ever returns the active person's own coverage +
  candidates + their own partner-wish list — never the partner's coverage/answers/feedback ([`69 §6/§8`](69-questionnaire-intelligence.md)).
- **Silent partner steering.** A partner wish shapes the partner's questions via the reciprocity register
  (tactful, self-contained, never quoted); the partner never sees the raw wish or that a request was made
  (§11 decision). It obeys the partner's see-and-stop opt-outs/blocks.
- **Restricted never crosses.** The partner-wish path is the requester's own free text about a topic to explore
  _together_ — it never reads the partner's restricted facts; the [`42`](42-relationship-scoped-sharing.md)
  boundary is untouched.
- **Intimacy gates unchanged.** 18+ ack (both partners for a shared intimacy wish), consent/tier gates, and
  the Anthropic-policy boundary are all unchanged ([`08 §8.3`](08-questionnaires.md)).
- **Not-medical / crisis** — unchanged; the surface is topic memory + curation, not clinical; crisis routing is
  never suppressed ([`08 §8.1/§8.2`](08-questionnaires.md)).
- **Never disclose owner/admin access** — no surface tells anyone an owner/admin can read answers (the durable
  2026-06-15 rule).

## 9. Accessibility

Per [`01 §9`](01-design-system.md). The feed + overview + partner cards are keyboard-operable, labelled, and
screen-reader friendly; coverage is **text + icon/meter, never color-only**; curation + steer controls are
ordinary buttons with clear accessible names; visible focus; responsive ~360px→desktop (§12 full-width, no
`max-width` cap, no horizontal scroll — including the tab strip, the [`69 §3.4`](69-questionnaire-intelligence.md)
≤480px precedent). No motion-required affordance.

## 10. Testing strategy

- **Assert the PROMPT reaches the model, not just outcome counts** (the durable lesson) — the next-topics pass +
  the partner-wish register must be asserted in the assembled prompt on every path (`SELFOS_FAKE_PROMPT_DIR`).
- **Offline fakes imperfect** — the fake returns a non-trivial candidate set + drops a curated one, so curation
  - "asked drops off" are exercised.
- **Unit (core):** candidate apply-functions (ask/not-this/go-deeper/asked-drops-off); `addPartnerWish` /
  `buildPartnerWishGuidance` (gated by a live edge; intimacy double-18+-gated; silent/never-quoted); the honest
  depth mapping.
- **coreBridge (two-persona, decrypt-level):** the own-scoped read never surfaces a partner's coverage; a
  partner wish steers the PARTNER's generation prompt (reciprocity framing, not quoted) and a restricted fact
  never crosses; curation persists.
- **Component (RTL):** the forward-first panel renders the feed + honest overview + partner card; curation +
  add-wish call the bridge.
- **E2E (Playwright):** curate a candidate → decrypt the profile; a partner wish → the partner's next
  generation prompt reflects it (decrypt-level); 360px overflow guard.
- **Named follow-up:** live-model tuning of the next-topics + honest-depth prompts (a real key; the
  [`69 §26.3`](69-questionnaire-intelligence.md) on-device precedent).

## 11. Resolved decisions

Settled with the owner (2026-08-09) before this spec:

1. **Forward-first** — the panel leads with "what SelfOS is curious about next," not a done/not-done status.
2. **Cached AI, daily cadence** — candidates generated on the throttled coverage-refresh cadence + cached
   (instant + free to view); a manual `Look for more` forces a refresh.
3. **Curatable candidates** — Ask-me-this / Not-this / Go-deeper; generation draws from what's kept.
4. **Honest depth** — recalibrate the placement pass; never "done"; a New → Getting to know you → Knows you
   well scale with a high bar for the top.
5. **Intimacy = first-class steerable area** — sourced from all intimacy signals, 18+ gated; drop the
   onboarding-only framing.
6. **Hybrid structure** — a candidate feed over a compact honest area overview.
7. **Keep both steer levels** — candidate-level curation **and** area-level Explore-more / Leave-alone.
8. **Partner wishlist** — any member with a live partner edge; a distinct card on the Explored tab; **silent**
   steering; feeds the partner's auto check-ins + questionnaires + Together prompts.

## 12. Build phases

Each phase is one reviewable, shippable slice with its own DoD (typecheck/lint/format, unit + coreBridge + RTL

- E2E where a surface exists, prompt-assertion tests, visual QA). Branch off `origin/main`.

* **P1 — Model + generation core.** Recalibrate `COVERAGE_SYSTEM` (honest depth); add `refreshNextCandidates`
  (cached, on the daily cadence) + the candidate schema + curation apply-functions; wire candidates into
  `planGeneration` (pinned lead, skipped excluded, asked-drops-off). _No new user surface yet._
* **P2 — The forward-first panel.** Rebuild `ExploredPanel` — the candidate feed (curatable) over the honest
  area overview (never "done", area steers retained); the `curateCandidate` + `refreshNextCandidates` IPC.
* **P3 — Intimacy as a first-class gated area.** Fold all intimacy signals into the map + feed; 18+ gating;
  remove the onboarding-only framing.
* **P4 — "Explore with your partner."** The wishlist card + `addPartnerWish`/`removePartnerWish` +
  `buildPartnerWishGuidance`, wired into the partner's auto check-ins + questionnaires + Together; two-persona
  privacy tests (silent, gated, restricted-never-crosses).

## 13. Finer points — for the owner

_Proposed defaults; flag any to change before build._

- **Candidate counts** — a feed of ≤ 10; per-area ≤ 3 contributing. **Default:** start at these, tune with
  live output.
- **"Not this" semantics** — declines _that candidate_ (a different one next refresh), NOT a topic ban.
  **Default:** as stated (the area-level Leave-alone is the topic ban).
- **Owner auto-checkin "exploration focus" vs the partner wishlist** — they **merge** (both feed the partner's
  auto check-ins); the wishlist is the member-facing source, the owner focus an override. **Default:** merge,
  don't replace.
- **Together + both partners' wishes** — a Together session may fold in **both** partners' wishes (mutual);
  the couples register keeps it balanced. **Default:** mutual.

## 14. Non-goals / out of scope

- **No parallel generator** — the candidate feed surfaces + curates the existing gap-finder/coverage output; it
  does not add a second generation engine.
- **No cross-person read** — the Explored read is own-scoped; the partner wishlist never exposes the partner's
  own coverage/answers.
- **No recipient-consent handshake** — the partner's [`63 §3.3a`](63-auto-checkins.md) see-and-stop applies to
  anything the wishlist steers; no accept-before-asking step is added.
- **No non-partner wishlist (v1)** — the wishlist targets **partners** only (a live `partner` edge); extending
  to family/friends is a later slice if wanted.
- **No change to consent/age gates or `SAFETY`.**
- **No new pricing model** — reuses the metered `questionnaire.profile` key; the person + app budgets
  ([`06`](06-ai-usage-and-budgets.md)) apply unchanged.

## 15. Changelog

- 2026-08-09 — **P4 (the silent "Explore with your partner" wishlist) BUILT — SPEC 70 IS NOW COMPLETE (all 4
  phases)** (§12). The final phase: a person steers what their connected partner is asked, silently. (1)
  `personalizationProfile.ts` — `PartnerWish` in `relational.partnerWishes` (additive, tolerant, no
  `schemaVersion` bump) + pure `addPartnerWish`/`removePartnerWish` (trim/dedup/cap). (2) New `partnerWishes.ts`
  — `buildPartnerWishGuidance(requesterId, partnerId, bothAdultAcked)` reads the REQUESTER's OWN wishes aimed at
  the partner, **re-gates on a LIVE `partner` edge** (a removed edge drops the steer — the §8 re-gate), filters
  intimacy wishes unless **both** partners hold the 18+ ack, and returns a **SILENT reciprocity-register block**
  (the model weaves the topics in as its own questions, on their own terms, and is told to **NEVER attribute or
  say someone requested them**) — it **never reads the partner's own data**. (3) `transparencyView.ts` — the
  Explored read gains `partners: PartnerWishGroupView[]` (one card per live-partner edge, the person's OWN wishes
  - the partner's display name — never the partner's coverage/answers) + `addPartnerWishAndRead`/
    `removePartnerWishAndRead`. (4) Two own-scoped IPC channels `questionnaires:addPartnerWish` (re-checked against
    a **live partner edge in the bridge** — a person may only wish for a partner they're connected to) +
    `:removePartnerWish`. (5) **Three generation-path wirings** — the manual send (`assembleRecipientBundle`,
    author→partner), auto check-ins (`runAutoCheckins`, owner→target, merging with the per-target exploration
    focus), and Together (`buildTogetherSystemPrompt`, **both** partners' wishes, mutual) — each folds the silent
    guidance in, each resolving both 18+ acks for the intimacy gate. (6) Renderer — the "Explore with <partner>"
    card (free-text add + list + remove; an intimacy toggle only when the person has acked 18+; the "they never
    see that you asked" reassurance). Own-scoped throughout; the partner's [`63 §3.3a`](63-auto-checkins.md)
    see-and-stop controls still apply to anything steered. Gate green: typecheck/lint/format, 1948 core + full
    desktop unit (partner-wish apply-fns; `buildPartnerWishGuidance` gating — live-edge / intimacy-both-acked /
    self / silent-never-attributed; a **two-persona coreBridge test** — a wish steers the PARTNER's generation
    prompt SILENTLY [prompt-assertion: the topic reaches the prompt, the "never say these came from anyone"
    framing is present, no raw attribution], live-edge gated [a non-partner wish is a no-op], own-scoped [the wish
    lives in the requester's profile; the partner has none]; RTL card add/remove) + a decrypt-level E2E (seed a
    partner → add a wish through the real UI → decrypt the OWNER's profile → 360px) + real-Electron visual QA (the
    card reads clean, with the silent-steering reassurance). **Spec 70 is complete — the Explored tab is now a
    forward-first candidate feed + honest overview + first-class gated Intimacy + the silent partner wishlist.**
- 2026-08-09 — **P3 (Intimacy as a first-class, 18+-gated area) BUILT** (§12). The last two intimacy pieces —
  P2 had already gated intimacy **candidates** in the feed behind the 18+ ack and removed the
  [`#386`](69-questionnaire-intelligence.md) onboarding-only framing, so P3 makes the Intimacy overview **row**
  first-class. **Owner decision (asked, §3.4 left it open):** the panel offers an **inline "I'm 18+" unlock** on
  the Intimacy row — confirming does the SHARED `adultAcknowledged` acknowledgement (the same guidance-prefs gate
  as guided sessions / Together, via a new own-scoped `questionnaires:acknowledgeAdult` channel) and unlocks
  steering + surfaces intimacy candidates right there; once acked the row is fully steerable (Explore more / Leave
  alone) like any area. Core `transparencyView.ts`: the Intimacy row is `steerable` only once `adultAcknowledged`
  (a general area always is), steers at a stable **area-level** `topicId: 'Intimacy'` (never a single category, so
  the per-category intimacy coverage engine is untouched), and carries `adultGated`; the view gains
  `adultAcknowledged`. The panel's `AreaRow` shows the "18+" badge (always for intimacy) + the inline unlock when
  not acked, else the steers; `coverageStore` gains `acknowledgeAdult`. All the intimacy signals were already
  sourced by the existing `buildIntimacyCoverage` (onboarding + intimacy questionnaires + sessions), so no new
  backend sourcing was needed. Own-scoped throughout (the ack acks only the active person). code-reviewer
  **ship** (consent parity + own-scoping + the area-level topicId verified sound); applied the one defense-in-depth
  nit — an Intimacy "explore more" (leaning in) is now re-gated on the 18+ ack **in the bridge** (not just the UI —
  the bridge is the trust boundary, §8), so a crafted un-acked intimacy explore-more is a no-op ("Leave alone" +
  "clear" stay allowed — backing off never adds exposure) + a two-persona test asserts the owner's ack never leaks
  to another person's gate. Gate green:
  typecheck/lint/format, 1940 core + full desktop unit (core intimacy-gated-steerable + area-level topicId + the
  panel unlock RTL; a two-persona coreBridge test — the intimacy candidate + steering are withheld until
  `questionnaires:acknowledgeAdult`, then surface) + a decrypt-level E2E (intimacy candidate withheld → inline
  unlock → surfaces + row steerable → decrypt the guidance prefs `adultAcknowledged`) + real-Electron visual QA
  (the Intimacy row with its 18+ badge + steers after acking). **Remaining:** P4 (silent partner wishlist).
- 2026-08-09 — **P2 (the forward-first Explored panel + curation IPC) BUILT** (§12; mockup approved first).
  Rebuilds the [`69 §3.4`](69-questionnaire-intelligence.md) Explored tab top-to-bottom into the §3.1 hybrid:
  the **candidate feed leads**, over an **honest area overview**. (1) Core `transparencyView.ts` — recalibrated
  the display scale to the honest, never-"done" **New → Getting to know you → Knows you well** (§3.3), with a
  HIGH bar for the top (`KNOWS_WELL_DEPTH = 0.7`, matching the P1 `COVERAGE_SYSTEM` anchor, so a 0.5 area is
  still only "getting to know you"); added `CandidateFeedItem` + pure `projectCandidateFeed` (own active
  candidates — not minted, not skipped — pinned-first, then go-deeper, then new, feed-capped) + `curateCandidate`
  - `CandidateCurateInput`; extended `QuestionnaireCoverageView` with `candidates` + `candidatesRefreshedAt`. (2)
    Two new **own-scoped** IPC channels — `questionnaires:curateCandidate` (Ask me this / Not this / Go deeper /
    clear; cheap, no AI) and `questionnaires:refreshNextCandidates` (the manual **"Look for more"** — budget-gated,
    metered `questionnaire.profile` via `aiDeps('questionnaires.own')`, fail-safe: a no-key/over-budget pass leaves
    the last-good feed) — both gated `questionnaires.own` + active-person-scoped in the bridge (the trust boundary;
    no partner/reciprocity data ever crosses — the view has no such field). (3) Renderer — `ExploredPanel` rebuilt
    (feed cards with the `new ground` / `go deeper` tag + curation buttons + pinned state, the "Look for more" +
    "refreshes daily" note, the pre-first-refresh calm state; the honest overview with a **text + meter** status
    [never color-only, §9] + the retained Explore-more / Leave-alone; a `prefers-reduced-motion`-aware spinner);
    `coverageStore` gains `curate` + `lookForMore`. The **Intimacy row stays read-only in P2** ("Sourced from every
    intimacy signal") — P3 makes it first-class + 18+-gated and removes the [`#386`](69-questionnaire-intelligence.md)
    onboarding-only framing. **code-reviewer fix-first:** the one safety should-fix — an `Intimacy`-area candidate
    could surface in the feed before the shared 18+ ack — is fixed now (`projectCandidateFeed` withholds
    intimacy-area candidates unless the ack is present, threaded from the bridge; fail-safe default is gated-on),
    plus the honest-failure should-fix (the manual "Look for more" now surfaces a calm "AI unavailable / over
    budget" note via a `refreshDegraded` flag instead of a silent no-op) and the DRY/no-op nits (a shared empty-view
    factory, an exported `isActiveCandidate`, and skipping the vault write on a no-op curate/steer). Verified: core
    (`projectCandidateFeed` ordering/exclusions + the intimacy-18+ gate, honest-scale mapping,
    `curateCandidate` own round-trip) + a two-persona coreBridge test (curate persists own-scoped + per-person
    isolation, a member's tap never touches the owner) + RTL (feed leads, curation + Look-for-more + steer call the
    bridge) + a decrypt-level E2E (seed the feed → "Not this" drops a candidate + "Ask me this" pins one + a Leave-
    alone steer → reopen persists → decrypt the profile → 360px overflow guard). Visual QA at desktop + 360px
    (real-Electron capture — matches the approved mockup). Gate green: typecheck/lint/format, 1939 core + desktop
    unit. **Remaining:** P3 (Intimacy first-class gated area), P4 (silent partner wishlist).
- 2026-08-09 — **P1 (model + generation core) BUILT** (§12). The forward-first candidate feed's engine, no user
  surface yet (the panel is P2). (1) The `NextCandidate` schema + `candidates`/`candidatesRefreshedAt` fields on
  the Personalization Profile — **additive-optional, tolerant-parsed, no `schemaVersion` bump** (the
  [`69 §4.1`](69-questionnaire-intelligence.md) precedent; an absent field on a pre-70 profile derives an empty
  feed). (2) Pure `applyCandidateCuration` (ask/not-this/go-deeper/clear → the persisted curation state),
  `markCandidateAsked` (stamp a candidate whose prompt was actually asked → drops off + stops steering),
  `mergeCandidates` (carry pins forward, drop asked, never re-propose a `skipped` phrasing, per-area +
  total caps that never drop a pin), and `buildCandidateGuidance` (the positive prompt block — pinned ★ leads,
  new vs. go-deeper split, skipped/minted excluded). (3) `buildCandidateGuidance` folded into the shared
  `gatherRecipientFeedbackGuidance` seam, so candidates steer all five generation paths (manual/auto/dream/email/
  story) with zero per-path wiring — "what you see is what gets asked". (4) `refreshNextCandidates` — a separate
  metered `questionnaire.profile` pass (owner-confirmed over folding into the coverage call: each independently
  fail-safe + testable), riding the daily reconcile cadence right after `refreshCoverage`, fed the CHEAP reads
  (distilled insight facts + intake + the freshly-placed coverage map + the feedback ledger — not a second full
  re-decrypt of every response); tolerant-parsed, budget-gated, fail-safe (a degraded pass leaves the last-good
  candidates). (5) `COVERAGE_SYSTEM` recalibrated for honest depth (§5.2) — a conservative, round-down scale that
  reserves 0.7+ for sustained multi-angle exploration, so the map reads truthfully (the display New/Getting/Knows-
  you-well relabel is P2). (6) Wired into the bridge: `refreshNextCandidates` on the `memoryRefresh` cadence
  (best-effort), and `markCandidateAsked` at the manual `assignmentsCreate` path (immediate own-scoped drop-off;
  the daily refresh self-heals as the backstop). Own-scoped throughout (a person's own data → their own profile;
  no cross-person crossing). Verified: core units (curation/asked-drops-off/merge caps/guidance excludes
  skipped+minted; `refreshNextCandidates` populate + fail-safe + pin-carry-forward, asserting the steering
  reaches the model) + a two-persona coreBridge test (the cadence refreshes the feed, candidates steer
  generation, and an asked candidate drops off — decrypt-level). No RTL/E2E (P1 has no surface, §12). Gate green:
  typecheck/lint/format, 1935 core + 1544 desktop unit. **§13 defaults kept as written** (≤10 feed / ≤3 per area;
  "Not this" declines that candidate, not a topic ban). **Remaining:** P2 (forward-first panel + curation IPC),
  P3 (Intimacy first-class gated area), P4 (partner wishlist).
- 2026-08-09 — created + Approved. The forward-first Adaptive Exploration surface (candidate feed + honest
  overview + first-class gated Intimacy) + the silent "Explore with your partner" wishlist; amends
  [`69 §3.4`](69-questionnaire-intelligence.md); 8 owner decisions recorded; 4 build phases.
