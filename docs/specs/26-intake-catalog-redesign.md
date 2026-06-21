# 26 — Intake catalog redesign (non-intimacy)

> **Status:** Approved · **Built** 2026-06-21 (`feat/intake-catalog-redesign`) · _last updated 2026-06-21_
>
> The onboarding intake ([`18`](18-personal-onboarding.md)) grew to **~492 questions across 12 sections**,
> many repetitive or near-identical — slow to finish, expensive to synthesize, and diluting the coach's
> signal. This spec **rewrites the non-intimacy catalog** (everything except the intimacy block, which is
> [`27`](27-intimacy-redesign.md)) into a **lean, high-signal 126-question set** with one clear owner per
> topic, structured-over-open where a list will do, and narrative depth pushed into the existing go-deeper
> chat. Pairs with [`27`](27-intimacy-redesign.md) (intimacy ~55–60) for a **~184-question total** intake,
> [`28`](28-portrait-synthesis-optimization.md) (so the smaller intake also produces a leaner, relevance-
> selected portrait), and [`29`](29-progressive-profile-building.md) (depth acquired over time, not all up
> front).

Amends [`18`](18-personal-onboarding.md) §14.4/§14.4a (and the `intakeCatalog.ts` it specifies). The
producer/synthesis/safety model of `18` is unchanged; this is a **content + structure** redesign of the
question bank (the merged/de-duplicated sections); the slider-seed engine fix is deferred to
[`28`](28-portrait-synthesis-optimization.md). Builds on
[`08`](08-questionnaires.md) (the `Question` shape + `@selfos/answering` renderer the intake reuses),
[`15`](15-shareability.md), [`04`](04-people-roles.md) (`Person` fields, `buildContext`). References
[`00`](00-architecture.md)/[`01`](01-design-system.md).

---

## 1. Overview

Today the intake asks ~492 questions. The **goal of the intake** ([`18`](18-personal-onboarding.md) §1) is a
deep, genuinely useful understanding of the person that personalizes Sessions, Dream analysis,
Questionnaires, and Home — captured **gently**. The current catalog works against that goal in three ways:

1. **Completion.** The "short, fast, non-threatening" core gate ([`18`](18-personal-onboarding.md) §14.2) is
   actually **52 questions** (Values alone is 17, several open-ended). A long wall behind a hard Member gate
   ([`18`](18-personal-onboarding.md) §3.1) invites skip-spam → a hollow portrait.
2. **Repetition.** Whole concepts are asked 3–5×: meaning/purpose/legacy (Values + What-you-want + Story),
   energy (3 sliders in Health), de-stress (4×), inner critic (4×), money (~20 Qs), career future (~5),
   travel (~5), friendship (twice within Relationships). Health (64) and the non-intimacy invited sections
   (40–60 each) are bloated.
3. **Downstream cost & dilution.** Every answered question tends to become a portrait **fact**, and the
   portrait is **pinned with no per-fact cap** ([`insightStore.ts` `summarizeForContext`](../../packages/core/src/insights/insightStore.ts)),
   so the **entire** fact list is injected into the system prompt of **every** Session/Dream/Questionnaire
   call — on the user's own paid Claude key. Fewer, higher-signal questions ⇒ a smaller, sharper portrait
   ⇒ cheaper and better coaching on every call. (The fact-budget/relevance side of this is
   [`28`](28-portrait-synthesis-optimization.md); this spec reduces the **input**.)

This redesign cuts the non-intimacy catalog from ~392 → **126** questions: a tight ~27-question core gate +
seven de-duplicated invited deep-dives of ~10–17 each, each with a single home and its narrative material
delegated to the section's go-deeper AI chat ([`18`](18-personal-onboarding.md) §14.7).

## 2. Goals / Non-goals

**Goals**

- A **lean, high-signal** non-intimacy catalog (126 Qs) replacing the ~392 today, with **one clear owner
  per topic** and the duplicate clusters removed.
- A **fast core gate** (~27 Qs, mostly structured) that yields a real starter portrait without skip-spam.
- **Preserve coverage of what matters** for coaching (identity, goals, how-to-coach-me, relationships,
  health, work/money, family, story, joy, what-weighs) — by **consolidating**, not dropping topics; push
  narrative depth into the per-section **go-deeper chat** rather than 40 long-text boxes.
- **Keep every promotion to a real `Person` field** and every `restricted`/`private` flag intact.
- **Merge** the now-thin/overlapping sections (done in this slice). _(The related **slider-seed fix** — an
  untouched optional slider must be *unanswered*, not a false "neutral" fact — is **deferred to
  [`28`](28-portrait-synthesis-optimization.md)** §pillar-3, since it changes shared `@selfos/answering`
  behaviour across questionnaires too; this slice is pure catalog content.)_
- **Migration-safe**: existing answers/portraits parse unchanged; orphaned answers for removed question ids
  are ignored; a gentle "we've streamlined onboarding — refresh your portrait?" nudge.

**Non-goals**

- **The intimacy block** — [`27`](27-intimacy-redesign.md) owns it (rebalanced, still explicit, ~55–60).
- **Portrait fact-budget / relevance selection / cost controls** — [`28`](28-portrait-synthesis-optimization.md).
- **Progressive / in-context depth acquisition** — [`29`](29-progressive-profile-building.md).
- **New answer types or renderer work** — reuses the existing `@selfos/answering` controls; no engine change
  in this slice (the slider-seed fix lands with [`28`](28-portrait-synthesis-optimization.md) §pillar-3).
- **Auto-creating the people graph** from family/relationship answers — still phase 2
  ([`18`](18-personal-onboarding.md) §2).

## 3. UX & flows

The onboarding flow itself is **unchanged** ([`18`](18-personal-onboarding.md) §3): core gate → starter
portrait → "Go deeper" grid of invited sections → re-synthesize. This spec changes **which sections exist and
what they ask**. Net flow effects:

- **Core gate is shorter** — 4 quick form sections, ~27 Qs total (was 52). The Member gate
  ([`18`](18-personal-onboarding.md) §3.1) still releases on "core done + portrait generated."
- **"Your life now" merges into "The basics"** for new sections? No — kept as a distinct quick snapshot, but
  **trimmed**. (See §4.2 for the exact 4 core + 7 invited section list.)
- **Every invited section is ~10–17 Qs** and offers its **"Tell me more →"** go-deeper
  ([`18`](18-personal-onboarding.md) §14.7) — the narrative material that used to be 30–45 long-text
  questions now lives there, well-guided by each section's `focus`.
- **Progress reads faster** — the `ProportionBar` (by section) and per-card answered/total counts
  ([`18`](18-personal-onboarding.md) §3.1) now show a finishable intake.

No new screens, controls, or nav. The not-medical line + `CrisisFooter` stay on every surface.

## 4. Data model (catalog content)

### 4.1 What changes in the schema

- **No schema changes.** Same `IntakeSectionDef` / `IntakeFormQuestion` / `Question` shapes
  ([`intakeCatalog.ts`](../../packages/core/src/intake/intakeCatalog.ts)), same `PersonFieldKey` set, same
  `IntakeAnswerValue` union, same `restricted`/`private`/`field`/`list` mapping. This is a **content rewrite
  of `INTAKE_CATALOG`** (the slider-seed engine fix is deferred to [`28`](28-portrait-synthesis-optimization.md)).
- **`portraitAnswerSig` migration** — the staleness signature ([`18`](18-personal-onboarding.md) §3.6) is
  computed from answered question ids; removing ids shifts it. Existing portraits stay valid; the change
  surfaces a one-time "refresh your portrait" nudge (§7), not a forced redo.

### 4.2 The new section structure (4 core + 7 invited)

| #   | Section                  | id              | Tier          | Restricted          | Qs (as built)                   |
| --- | ------------------------ | --------------- | ------------- | ------------------- | ------------------------------- |
| 1   | The basics               | `basics`        | core          | no                  | 10                              |
| 2   | Your life now            | `life-now`      | core          | no                  | 7                               |
| 3   | What matters             | `values`        | core          | no                  | 5                               |
| 4   | What you want            | `want`          | core          | no                  | 5                               |
| 5   | Health & body            | `health`        | invited       | no¹                 | 22 (16 + 6 conditional)         |
| 6   | Relationships            | `relationships` | invited       | no                  | 17                              |
| 7   | Work & money             | `work-money`    | invited       | no                  | 14                              |
| 8   | Family & roots           | `family`        | invited       | no                  | 13                              |
| 9   | Your story               | `story`         | invited       | no                  | 10                              |
| 10  | Joy & play               | `joy-play`      | invited       | no                  | 12                              |
| 11  | What weighs on you       | `weighs`        | invited       | **yes**             | 11                              |
| —   | **Intimacy & sexuality** | `intimacy`      | invited (18+) | **yes** (unchanged) | [`27`](27-intimacy-redesign.md) |

¹ Health is a non-restricted section with **per-question `restricted`/`private`** items (the established
[`18`](18-personal-onboarding.md) §14.8 "(sensitive)" sub-block routing — unchanged); the 6 conditional
per-substance frequencies are each shown only when that substance is selected.

**Non-intimacy total: 126** (from 392). Core gate: ~27 (basics 10 + life-now 7 + values 5 + want 5; the
life-now children/pets rosters are conditional, so ~25 visible) — down from 52. The big consolidations vs.
today: Values 17→5 (meaning/legacy moved to Story go-deeper); Health 64→22; Relationships 52→17; Work&money
51→14; Family 48→13; Story 45→10; Joy 43→12; Weighs 37→11. No separate "values/legacy" invited section
(folded into Story's go-deeper). Intimacy stays at 100 until [`27`](27-intimacy-redesign.md) trims it to ~58,
so the **total is 226 after this slice → ~184 after 27**. The retired question ids are simply absent — their
stored answers are ignored (§7).

### 4.3 The question bank (terse; `→field` promotes to a `Person` field)

Notation: `single`/`multi`/`yesNo`/`text`(short)/`longtext`/`date`/`dateList`/`roster`/`slider`(3-anchor,
**not seeded** §5) · `(R)` = `restricted` fact (own-context-only, owner-visible) · `(P)` = `private` field
(→`privateFields`). Every question is optional/skippable. Wording is **final-intent** but tunable at build;
keep placeholders on every free-text per [`18`](18-personal-onboarding.md) §14.4a (catalog test enforces it).

---

**1. The basics** _(core, form)_ — 10

- preferred name (text)
- pronouns (single + Other) **→`pronouns`**
- gender identity (single + Other) **→`gender`**
- birthday (date) **→`birthday`**
- important dates — anniversaries, kids' birthdays (dateList) **→`importantDates`**
- where you live (text) **→`location`**
- languages you speak (multi) **→`languages`**
- cultural / ethnic background (multi, joined) **→`ethnicity`**
- how you look — hair/build/features (text) **→`appearanceDescription`** _(feeds the self's dream images)_
- what you do for work (text) **→`occupation`**

_(Cut from today's basics: `grewUp` → Family; `education`/`chronotype`/`nationality`/`nickname` dropped as
low gate value; `importantDates` kept here (structured + useful). `interests` is filled by Joy & play, not
here.)_

**2. Your life now** _(core, form)_ — 7

- who you live with (multi: Partner / Children / Parents / Other family / Roommates / Pets / I live alone /
  Other) **→`livingSituation`** _(picking "Children" auto-fills the children roster — unchanged behaviour)_
- relationship status (single) **→`relationshipStatus`**
- children / parental status (single) **→`parentalStatus`**
- children roster (name / gender / age — branch on have-young/grown kids)
- pets (multi)
- pets roster (name / species / gender — branch on a pet being selected)
- a typical weekday, start to finish (longtext)

**3. What matters** _(core, form)_ — 5

- core values (multi) **→`values`**
- faith / spirituality (single + Other) **→`faith`**
- how you prefer to communicate (single: direct / gentle / playful / reserved / expressive)
  **→`communicationStyle`**
- describe yourself in a few words (text)
- a belief or principle that guides you (text)

_(The deep meaning/legacy/proud/insecure material — `meaning`, `proudOf`, `remembered`, `success`,
`neverCompromise`, `roleModel` — is **removed from the gate** and lives in **Your story** + its go-deeper, its
natural home. `riskTolerance`/`personality`/`decisionStyle`/`politicalLeaning`/`causes` are dropped as
low-coaching-signal; a couple can return as optional invited items if desired, §11.)_

**4. What you want** _(core, form)_ — 5

- what you most want to work on (multi) **→`goals`**
- one specific goal right now (text)
- how you want SelfOS to support you (multi: hold me accountable / help me reflect / give advice / just
  listen / challenge me / track progress)
- how you like to be coached (single: gently / directly / challenge me / with data & structure)
- what you keep avoiding, or what's holding you back (text)

_(Cut: `goodLife`/`fiveYears`/`unlimited`/`futureFear`/`learnSkill`/`motivates`/`habitBuild`/`habitBreak` —
the vision/legacy ones overlap Story; the habit ones can be set live in a session. Keeps the gate fast.)_

---

**5. Health & body** _(invited, form — sleep/energy/stress + private medical)_ — 15

- sleep quality (slider) · usual sleep schedule (single)
- energy through the day (slider) · stress level lately (slider)
- how you move / exercise (single)
- eating patterns (single)
- alcohol (single) · smoking / vaping (single)
- recreational substances you use (multi) **(R)** + **per-substance frequency** (single, branched per
  selection) **(R)** _(kept — high-signal, the branch keeps it light)_
- therapy now / in the past (single)
- any physical conditions to keep in mind (longtext) **→`healthNotes` (P)**
- mental-health diagnoses (longtext) **(R)**
- neurodivergence (multi: ADHD / Autism / Dyslexia / Other / None / PNTS) **(R)**
- medications affecting mood or energy (longtext) **(R)**
- how you feel about your body (slider)
- anything else to keep in mind (longtext) **→`healthNotes` (P)**

_(Cut ~49: the entire "Your body" / "Movement & fitness" / "Food & fuel" / "Rest & recovery" / "Mind & focus"
accordion groups and the anxiety/low-mood duplicates of **What weighs on you**. `caffeine` dropped.)_

**6. Relationships** _(invited, form)_ — 17

- attachment style (single: secure / anxious / avoidant / mixed, plain-language helper)
- how you handle conflict (single: avoid / accommodate / confront / collaborate)
- what you need most from people close to you (multi)
- how you express love (multi: words / touch / time / gifts / acts)
- how you best receive love (multi: same)
- how comfortable you are being emotionally vulnerable (slider)
- how good you are at boundaries (slider)
- how often you put others' needs ahead of your own (slider) _(people-pleasing — kept, high therapeutic
  signal)_
- number of close friends (single)
- how lonely you feel (slider)
- who you turn to in a crisis (text)
- your social battery (slider)
- your relationship deal-breakers (text)
- a recurring pattern you notice in your relationships (text)
- your biggest relationship challenge (text)
- _Your history_: your relationship history in brief (longtext) · a heartbreak that shaped you (longtext)

_(Cut ~35: the duplicate friendship group, "How you handle people," "Love & partnership," "How you relate"
(except people-pleasing), and "Community & belonging." `trust`/`openUp`/`emotionalAvailability` collapse into
the single vulnerability slider; `forgiveness` → Story/Weighs go-deeper.)_

**7. Work & money** _(invited, form + go-deeper)_ — 14

- _Your work_: work situation (single) · field / industry (text) · what you do day-to-day (text) · how much
  you enjoy your work (slider) · what work means to you (single) · how stressful it is (slider)
- _Ambition_: where you want your career to go (text) · how ambitious you feel (slider) · work–life balance
  (slider)
- _Money_ (own-coaching-only by default): your finances (single) · saver vs spender (single) · how much
  money worries you (slider) · a money goal you're working toward (text) · how money was handled growing up
  (longtext)

_(Cut ~37: `dreamJob`/`proudWork`/`careerOrigin`/`careerRegret`/`retirementVision`/`workLegacy` and the
entire "Your career path," "At work day-to-day," "Growth & purpose," "Money mindset," "Your finances"
groups. ~20 money questions → 5.)_

**8. Family & roots** _(invited, form + go-deeper, keeps `focus`)_ — 13

- who mainly raised you (single + Other)
- siblings / birth order (single + Other)
- your family's faith / culture growing up (text)
- closeness with your mother figure (slider)
- closeness with your father figure (slider)
- how affection was shown (single)
- how conflict was handled (single)
- any family mental-health or addiction history (yesNo)
- your childhood home mostly felt… (single: warm / tense / chaotic / strict / loving but hard / mixed)
- your relationship with your family now (single)
- the gifts and wounds you took from your upbringing (longtext)
- a favorite memory from growing up (longtext)
- _go-deeper:_ "Tell me more →" for parents' personalities, siblings, grandparents, heritage, inherited
  patterns, chosen family, and (if a parent) what you keep vs. do differently — the narrative that was ~35
  separate questions.

**9. Your story** _(invited, form + go-deeper, keeps `focus`)_ — 10

- your childhood in one word (text)
- your life so far in a few chapters (longtext)
- your happiest chapter (longtext)
- a hard time you came through (longtext)
- a turning point that changed your direction (longtext)
- something you're most proud of (longtext) _(absorbs Values' `proudOf`)_
- a decision you regret (longtext)
- the biggest lesson life has taught you (text)
- what you'd tell your younger self (longtext)
- who you're becoming / what you want the rest of your story to be (longtext) _(absorbs Values' legacy set)_
- _go-deeper:_ lowest moments, defining relationships, what you've survived, how you've changed, legacy &
  meaning — the ~35-question "chapters/childhood/coming-of-age/defining/legacy" groups now narrative.

**10. Joy & play** _(invited, form)_ — 12

- what you're into (multi) **→`interests`**
- a current obsession (text)
- a topic you could talk about for hours (text)
- a creative outlet you have or wish you had (text)
- your ideal weekend (longtext)
- what you love doing alone (text)
- what you love doing with people (text)
- how playful you are (slider)
- what reliably makes you laugh (text)
- a place you're dying to visit (text)
- something on your bucket list (longtext)
- your comfort movie / show / album / book (text)

_(Cut ~31: "What you watch & listen to," "Hobbies & making," "Travel & adventure" (except `travelDream`),
"Curiosity & learning," "Your happy place" — these enumerate taste rather than yield coaching signal.)_

**11. What weighs on you** _(invited, form + go-deeper, **restricted**, trauma-informed)_ — 11

- what's weighing on you most right now (multi + Other)
- how heavy it's felt lately (slider)
- how you talk to yourself when things go wrong (single: kindly / pretty harshly / in between)
- a worry that keeps coming back (longtext)
- a pattern you feel stuck in (longtext)
- any grief or loss you're carrying (longtext)
- when you're overwhelmed, you tend to… (multi)
- how supported you feel right now (slider)
- when things get dark, what helps you (longtext)
- how hopeful you are that things will improve (slider)
- _go-deeper:_ the trauma-informed chat (sets the depth, never digs) — absorbs the ~27 inner-world/coping/
  looking-forward duplicates. Crisis routing + footer always present ([`18`](18-personal-onboarding.md)
  §8.2).

### 4.4 Field-promotion map (unchanged set, re-homed)

All current `→field` promotions survive: `pronouns`, `gender`, `birthday`, `location`, `languages`,
`ethnicity`, `appearanceDescription`, `occupation`, `livingSituation`, `relationshipStatus`,
`parentalStatus`, `importantDates`, `values`, `faith`, `communicationStyle`, `goals`, `interests`,
`healthNotes` (P). The intimacy-block `sexualOrientation`/`relationshipStyle` (P) live in
[`27`](27-intimacy-redesign.md). No field is orphaned by the cuts.

## 5. Architecture & modules

- **`intakeCatalog.ts`** — the `INTAKE_CATALOG` array is rewritten to the §4.3 bank. Builders
  (`single`/`multi`/`slider`/`roster`/`f`/`grouped`/`when`/`whenAny`) and the shared `ACTIVITIES`/`TOYS`
  intimacy constants are **unchanged** (intimacy content is [`27`](27-intimacy-redesign.md)). `getIntakeSection`,
  `intakeSectionMeta`, `buildInterviewerAddendum` unchanged.
- **Slider-seed fix** — an **optional** `slider` must render **unseeded** (no value until the person moves it)
  so `isAnswered` returns false for an untouched slider and it produces **no portrait fact**. Touches
  `@selfos/answering`'s slider control + the intake's `isAnswered` path; a unit test asserts an untouched
  optional slider is unanswered and a moved one is answered. _(Shared with
  [`28`](28-portrait-synthesis-optimization.md) pillar 3 — implement in whichever lands first; the other
  references it.)_
- **No service changes** — `submitSectionForm`, `fillPersonFields`, `runIntakeTurn` (go-deeper), `synthesize`,
  the "(sensitive)" sub-block routing, and `RESTRICTED_SECTION_REFS` all operate on the catalog and need no
  edits. The `ensureIntakeSession` reconciliation already appends/ignores sections by id, so a returning
  person's session reconciles to the new catalog automatically (removed sections just stop being offered;
  their stored answers remain in `answers` but unused).
- **Renderer** — no changes; the same `IntakeFormPanel` renders the new (smaller) forms.

## 6. IPC / API contracts

**No IPC changes.** Same `intake:getState` / `submitForm` / `runTurn` / `skipSection` / `synthesize` /
`acknowledgeAdult` ([`18`](18-personal-onboarding.md) §6). `intakeSectionMeta()` returns the new (smaller)
catalog; the renderer renders whatever it's given.

## 7. States & edge cases

- **Existing person, mid-intake** — `ensureIntakeSession` reconciles: new/renamed sections appear
  `notStarted`; removed sections drop off the navigators; answers for retired question ids stay in
  `answers` (ignored by the new catalog, never resurfaced). No data loss, no forced redo.
- **Existing person, completed intake** — their portrait Insight is untouched and keeps feeding context. The
  `portraitAnswerSig` recompute will read differently; surface the standard
  ([`18`](18-personal-onboarding.md) §3.6) **"~X% out of date — refresh?"** nudge, framed once as
  "we've streamlined onboarding." Re-synthesis uses the new (smaller) bank → a leaner portrait.
- **Gate predicate** — unchanged ("core sections resolved + portrait generated"); the core set is now 4
  sections (basics/life-now/values/want).
- **Skip** — unchanged; every question optional.
- **Crisis** — unchanged; `weighs` go-deeper + footer always present.
- **Sync conflict / corrupt file** — standard vault behaviour; never silently shares restricted content.

## 8. Safety, privacy & honesty

- **No new exposure.** Every `restricted`/`private` flag from today is preserved (Health's sensitive items,
  the whole `weighs` section). The "(sensitive)" sub-block routing ([`18`](18-personal-onboarding.md) §14.8)
  is unchanged. Cutting questions can only _reduce_ what's stored.
- **Not medical / crisis** — unchanged ([`18`](18-personal-onboarding.md) §8.1/§8.2); the line + `CrisisFooter`
  stay on every onboarding surface; `weighs`/go-deeper keep trauma-informed + crisis routing.
- **Privacy defaults** — unchanged ([`18`](18-personal-onboarding.md) §8.3): intake facts default
  own-context-only; mapped fields follow the shared default except the explicitly private ones.

## 9. Accessibility

Unchanged from [`18`](18-personal-onboarding.md) §9 / [`01`](01-design-system.md) §9 — the controls are the
same `@selfos/answering` primitives. The one new behaviour (unseeded optional slider) must remain keyboard-
operable and announce "not yet set"; a control test covers it.

## 10. Testing strategy

- **Catalog unit tests (extend the existing `intakeCatalog.test.ts`):** every `shortText`/`longText` has a
  non-empty placeholder ([`18`](18-personal-onboarding.md) §14.4a — keep); the new section ids/tiers match
  §4.2; every `→field` promotion maps to a real `PersonFieldKey`; the core gate is the 4 expected sections;
  `restricted`/`private` flags present on the expected Health items + the whole `weighs` section; **total
  non-intimacy question count is within the target band** (a regression guard so it can't silently re-bloat).
- **Slider-seed unit:** _deferred to [`28`](28-portrait-synthesis-optimization.md)_ (lands with the engine fix).
- **Service unit:** `submitSectionForm` on the new sections fills the mapped fields; the "(sensitive)"
  routing still flags Health's restricted items; `ensureIntakeSession` reconciles an old session to the new
  catalog without losing stored answers.
- **E2E:** finish the 4 core forms (no AI) → fields decrypt onto the `Person` → starter portrait → gate
  releases; open an invited section + its go-deeper; an untouched slider produces no fact; 390px + control-
  geometry guards. Run `pnpm typecheck` after tests (memory `vitest-does-not-typecheck`).

## 11. Open questions

1. **Exact core-gate size** — 4 sections / ~25 Qs proposed. Trim further (drop `importantDates` from the
   gate, or merge Life-now into Basics) if first-run still feels long?
2. **Which "removed" items to keep as optional invited extras** — e.g. `riskTolerance`, `personality`,
   `decisionStyle`, `closenessPreference`, a couple of Joy taste items. Default: dropped; easy to re-add.
3. **Per-section target counts** — the §4.3 numbers are a starting point; tune against the §10 count guard.
4. **Existing-portrait migration** — confirm: leave existing portraits as-is + a one-time "refresh" nudge
   (proposed), vs. auto-flag every existing intake stale.
5. **Slider unseeded UX** — show an explicit "not set / skip" affordance vs. just an untouched track? (a11y).

## 12. Resolved decisions

- **Volume** — lean & high-signal (126 non-intimacy; ~184 total with [`27`](27-intimacy-redesign.md)), down
  from ~392 / ~492 (user, 2026-06-21).
- **Method** — one owner per topic; consolidate duplicates; structured-over-open; push narrative depth into
  the per-section go-deeper chat rather than long-text sprawl.
- **Coverage** — no topic dropped wholesale; the meaning/legacy material re-homes to Story; Health/Work/Money
  consolidate hardest.
- **Engine** — only the slider-seed fix + the catalog rewrite; no schema/IPC/renderer changes.

## 13. Changelog

- 2026-06-21 — created (Draft). Part of the onboarding-redesign spec group (26 non-intimacy catalog · 27
  intimacy · 28 synthesis/context optimization · 29 progressive profile-building). Cuts the non-intimacy
  intake from ~392 → 126 questions; amends [`18`](18-personal-onboarding.md) §14.4/§14.4a.
- 2026-06-21 — **Approved + built** (`feat/intake-catalog-redesign`, off `main`, NOT merged). Rewrote the 11
  non-intimacy sections of `INTAKE_CATALOG` to the §4.3 bank — **non-intimacy 392 → 126** (core gate 52 → ~27;
  Health 64→22, Relationships 52→17, Work&money 51→14, Family 48→13, Story 45→10, Joy 43→12, Weighs 37→11,
  Values 17→5). The **intimacy block (100) is byte-unchanged** (spec 27 owns it), so the catalog is now
  226 (→ ~184 after 27). Preserved every structural invariant (12 sections, core ids, placeholders, branch
  rules, `healthNotes` private, intimacy guarded) and every test-pinned id (`occupation`/`appearanceDescription`/
  `ethnicity`/`importantDates` in basics; `physicalConditions`/`healthOther`→`healthNotes`; `passions`→`interests`;
  `substancesUsed`+per-substance freq restricted), so the existing intake unit/bridge/E2E suites pass unchanged.
  Added an **anti-rebloat count guard** to `intakeCatalog.test.ts` (non-intimacy ≤ 150, core gate ≤ 30). The
  **slider-seed engine fix is deferred to [`28`](28-portrait-synthesis-optimization.md)** (it changes shared
  `@selfos/answering` behaviour). Existing portraits unaffected (orphan answers ignored; the standard
  "refresh your portrait" staleness nudge applies). Gate: typecheck (node + web), **442 core + 532 desktop**
  unit, onboarding **E2E** green. **NOTE (spec numbering):** a concurrent session also added specs and we
  collided on 21/22 — this group was renumbered 21–24 → **26–29** to clear it; the final cross-branch number
  reconcile happens at merge (the documented precedent). Awaiting user review of the as-built catalog.
