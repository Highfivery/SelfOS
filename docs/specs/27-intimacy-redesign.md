# 27 — Intimacy & sexuality block redesign

> **Status:** Approved · **Built** 2026-06-21 (`feat/intimacy-redesign`) · _last updated 2026-06-21_
>
> The opt-in 18+ **Intimacy & sexuality** intake block ([`18`](18-personal-onboarding.md) §14.5) is
> comprehensive but **100 questions** with real fatigue traps — most painfully, three full ~40-item activity
> checklists (into-it / curious / hard-limits) = ~120 checkbox decisions for one concept. This spec
> **rebalances** it to **~55–60 questions** that stay **fully explicit**: it collapses the triple activity
> list into a single 3-state **matrix**, trims the most granular body-preference enumeration, and **adds the
> high-signal sexual-wellbeing & relational items a sex therapist would prioritize** (responsive vs.
> spontaneous desire, current masturbation frequency, after-care, consent/communication practices, sexual
> self-esteem). Same 18+/`restricted`/owner-visible rails, same explicit/unfiltered register.

Amends [`18`](18-personal-onboarding.md) §14.5/§14.10/§14.11. Pairs with
[`26`](26-intake-catalog-redesign.md) (the non-intimacy cut). The shared `INTIMACY_TOPICS` inventory
([`08`](08-questionnaires.md) §16.5a) is reused, so questionnaire generation stays in lockstep. Builds on
[`15`](15-shareability.md), [`04`](04-people-roles.md), and the explicit-framing/safety model of
[`18`](18-personal-onboarding.md) §8/§14.10. References [`00`](00-architecture.md)/[`01`](01-design-system.md).

---

## 1. Overview

The intimacy block is the single most valuable section for personalizing intimacy/relationship coaching —
and the most exhausting to fill. Today it has **100 questions**, with three structural problems:

1. **Fatigue.** `intoIt` / `curiousToTry` / `hardLimits` each render the full ~40-item `ACTIVITIES` list — a
   person makes **~120 separate checkbox decisions** to express one mental model ("this I like, this I'm
   curious about, this is off the table"). Positions are split into 4 separate multis; body preferences
   enumerate labia/clit/penis-girth at a granularity that's high-burden, lower-signal.
2. **Imbalance.** It's a thorough **preferences catalog** but thin on **sexual wellbeing** — the part a sex
   therapist most needs: desire _type_ (the single most clinically useful concept), current masturbation
   frequency (only _first-time_ is asked), how sex connects to emotional security, after-care, and how the
   person and partners actually **communicate and negotiate consent**.
3. **Cost & dilution** — like the rest of the intake, every answer tends to become a `restricted` portrait
   fact pinned into the person's own context ([`26`](26-intake-catalog-redesign.md) §1;
   [`28`](28-portrait-synthesis-optimization.md) caps/relevance-selects these).

The user's direction (2026-06-21): **"rebalance but also explicit."** So we cut volume and add wellbeing
depth **without** softening the register — it stays graphic, casual ("Do you like giving blowjobs?"), and
unfiltered within the consensual-adult boundary.

## 2. Goals / Non-goals

**Goals**

- **~55–60 questions** (from 100): collapse the triple activity list into **one 3-state matrix**, trim the
  most granular body-preference enumeration, merge the 4 position multis.
- **Keep it explicit** — same graphic, casual wording; same consensual-adult-incl-taboo-fantasy boundary
  ([`18`](18-personal-onboarding.md) §14.5); the prompts still invite as much detail as the person wants.
- **Add the sex-therapy depth that's missing** — responsive/spontaneous desire, current masturbation
  frequency, sexual self-esteem, after-care, consent & communication practices, how sex connects to
  emotional security.
- **Same safety rails** — 18+ ack, `restricted`, owner-visible / everyone-else-redacted, excluded from
  `buildDepictionNote`, never broadcast-shareable, relevance-gated surfacing
  ([`18`](18-personal-onboarding.md) §14.10/§14.11).
- **Stay in lockstep** with the shared `INTIMACY_TOPICS` inventory ([`08`](08-questionnaires.md) §16.5a).

**Non-goals**

- **The non-intimacy catalog** — [`26`](26-intake-catalog-redesign.md).
- **Loosening the content boundary** — the scope line ([`18`](18-personal-onboarding.md) §14.5: no minors,
  no real non-consent, no illegal acts as activities) is unchanged.
- **Sexual-trauma intake** — non-consensual experiences are **not** solicited here; a single gentle,
  optional pointer routes that to the trauma-informed **What weighs on you** go-deeper
  ([`26`](26-intake-catalog-redesign.md) §4.3 #11). This block stays about consensual adult sexuality.
- **A new matrix renderer** — `@selfos/answering` already has a `matrix` answer type
  ([`08`](08-questionnaires.md)); this reuses it. Confirm it supports per-row single-select columns; if a
  small extension is needed, scope it here (§5).
- **Medical sexual-health screening** (STI status/testing) — the app is non-medical; deferred (§11).

## 3. UX & flows

Unchanged shell ([`18`](18-personal-onboarding.md) §3.3/§14.5): opt-in card on the "Go deeper" grid → one-time
**18+ acknowledgement** (shared `adultAcknowledged`, [`18`](18-personal-onboarding.md) §12) → the branched
structured form via `@selfos/answering`, with the content note, not-medical line, and `CrisisFooter`. Every
question optional/skippable; conditional questions sit **directly under** their gate
([`18`](18-personal-onboarding.md) §14.5).

**The one notable UX change:** the **activity matrix** replaces the three sequential ~40-item checklists. One
control: rows = the consensual-adult activities (the `INTIMACY_ACTIVITIES` inventory), columns = **Into it /
Curious / Hard limit** (single-select per row; leaving a row blank = "no answer"). Far less fatigue, richer
data (the three states are captured in one pass), and it maps cleanly to facts ("into: X, Y; curious: Z; hard
limit: W").

## 4. Data model

### 4.1 Schema

- **`Person` fields** — unchanged: `sexualOrientation` (P) and `relationshipStyle` (P) remain the only
  promoted fields; everything else stays a `restricted` Insight fact
  ([`18`](18-personal-onboarding.md) §14.6).
- **`matrix` answer type** — already exists ([`08`](08-questionnaires.md)). Confirm
  `@selfos/answering` renders a `matrix` with single-select rows and that `answerToString`/`isAnswered`
  handle the `Record<string,string>` value (row→column). If matrix today is min→max _scale_ columns only, add
  a categorical-column variant (rows × named single-select options). Scope in §5; additive.
- **No new restricted/private mechanics** — same `restricted`-fact routing
  ([`18`](18-personal-onboarding.md) §14.8/§14.10).

### 4.2 The rebalanced bank (61 as built)

Notation as [`26`](26-intake-catalog-redesign.md): `single`/`multi`/`yesNo`/`text`/`longtext`/`slider`
(3-anchor, **unseeded** [`26`](26-intake-catalog-redesign.md) §5)/`matrix` · all `(R)` `restricted` except
the two `(P)` fields · all optional/skippable · branches sit under their gate. **NEW** = a sex-therapy
addition not in today's block. Explicit, casual wording retained.

**A. Orientation & identity** — 6

- sexual orientation (multi) **→`sexualOrientation` (P)**
- who you're drawn to (multi: men / women / non-binary people / trans women / trans men / everyone / Other)
- relationship style (single: monogamous / open / poly / swinging / exploring / Other)
  **→`relationshipStyle` (P)**
- are you currently exclusive / monogamous right now (yesNo)
- how big a part of life intimacy is for you (slider)
- your sex drive / libido (single: very low → very high)

**B. Your sexual story** _(reflective, all optional)_ — 5

- age of your first partnered experience (ranges + "haven't yet" + PNTS)
- how many sexual partners you've had (ranges)
- your first sexual experience, in your words (longtext)
- what messages about sex you absorbed growing up (longtext)
- any sexual shame or hang-ups you carry (longtext)

_(Cut from today's 13: first-masturbation/first-orgasm ages, how you discovered masturbation, best/most-
memorable, most-embarrassing, sexualRegret, sexualityEvolved — keep the reflective core; depth via the
go-deeper if wanted.)_

**C. Your current sex life** _(branch on "Do you have a sexual partner right now?" yesNo)_ — 8

- how satisfied you are with your sex life (slider)
- how often you're intimate now (single)
- how often you'd like to be (single)
- who usually initiates (single)
- how easily you can talk about sex with them (slider)
- something you want but haven't asked for (longtext)
- what's working well (longtext)
- what you wish were different (longtext)

_(Cut: orgasmTogether, sharedFantasies (yesNo), partnerAttractive — low marginal signal.)_

**D. Desire, arousal & what you like** — 13

- **NEW — desire type** (single: "Do you usually feel desire out of the blue (spontaneous), or does it build
  once things get going (responsive), or both?") _(the single highest-value sex-therapy item; reframes
  mismatched-desire coaching)_
- **NEW — how often you masturbate these days** (single freq) _(currently only first-time is asked)_
- what gets you in the mood (multi: touch / words / anticipation / visuals / scent / romance / a few drinks /
  stress relief / Other)
- your turn-ons (multi + note)
- your turn-offs (multi + note)
- where you most like to be touched / your erogenous zones (multi) _(merges today's `touchAreas` +
  `erogenousZones`)_
- favorite positions & ways you like sex (multi: missionary / doggy / on top / spooning / standing / oral
  giving / oral receiving / 69 / face-sitting / grinding / mutual masturbation / Other) _(merges today's 4
  position multis into one)_
- how rough you like it (slider)
- dominant or submissive (single: dominant / submissive / switch / vanilla / Other)
- how you feel about dirty talk (single) + _(branch)_ dirty talk you love to hear (longtext)
- **activity matrix** (matrix: rows = `INTIMACY_ACTIVITIES`; columns = Into it / Curious / Hard limit)
  **(R)** — _replaces `intoIt` + `curiousToTry` + `hardLimits` (3 × ~40 checks → 1 control)_
- kinks or fetishes, in your own words (longtext)
- toys you own or want (matrix: rows = the `TOYS` set; columns = Own / Want / Not for me) _(merges today's
  `toysOwn` + `toysWant`)_

**E. Acts & specifics** _(explicit, branched to anatomy/config)_ — 6

- _(if they give oral on a penis)_ when you give a blowjob, do you swallow or spit (single)
- _(if a partner ejaculates)_ where you like a partner to cum (multi)
- how you feel about anal (single: give / receive / both / not for me / curious)
- choking — being choked / doing it / both / neither / curious (single)
- degraded or praised (single: degradation / praise / both / neither)
- describe your ideal sexual encounter, start to finish, in as much detail as you like (longtext)

_(Cut: swallowTurnsOn, assPlay, squirting, loud/quiet, lights — low signal; kept the explicit anchors.)_

**F. Body & confidence** _(trimmed)_ — 4

- body types you're drawn to (multi)
- pubic hair you prefer on a partner (single)
- how you keep your own grooming (single)
- how confident you feel in your own body sexually (slider) _(sexual self-esteem — kept)_

_(Cut the granular enumeration the user agreed to trim: breast preference, attracted-to-penis +
length/girth sliders, attracted-to-vulva + labia/clit specifics, the body-feelings longtext. The
attraction is already captured by "who you're drawn to" in A.)_

**G. Fantasies & media** — 7

- your wildest fantasy, in as much detail as you like (longtext)
- fantasies you'd actually like to try (longtext)
- common fantasies that appeal (multi: `INTIMACY_FANTASIES` incl. CNC/"ravishment" roleplay, + Other)
- a CNC / "ravishment" roleplay interest (single: yes / curious / no — framed as consensual roleplay, real
  limits set in H / the matrix)
- do you watch porn (single: never → daily) + _(branch)_ what genres you like (multi + note)
- do you read or listen to erotica (single)
- do you sext / share nudes, record, or cam (single: none / sometimes / often / into camming) _(merges
  today's `sexting` + `recording` + `broadcasting` + `mirror` into one)_

**H. Wellbeing, consent & meaning** _(the rebalance — several NEW)_ — 9

- any difficulties you'd want support with (multi: arousal / reaching orgasm / orgasming too quickly /
  lasting longer / pain during sex / erectile difficulty / dryness / low desire / mismatched desire / body
  confidence / performance anxiety / none / Other) **(R)**
- performance anxiety (slider)
- how your mood affects your libido (longtext)
- **NEW — how sex & closeness connect to feeling emotionally secure for you** (longtext)
- **NEW — after intense or vulnerable sex, what do you need (after-care)?** (text)
- **NEW — how you and partners handle consent and checking in** (single: we talk explicitly / we read each
  other / it varies / we struggle with it / Other, + optional note)
- consent / safety / boundaries SelfOS should always hold (longtext)
- what makes you feel safe and present during sex (longtext)
- what you most want SelfOS to understand about your sexuality (longtext)

_(A single gentle, optional line near H points to **What weighs on you** for anyone wanting to discuss a
non-consensual experience — handled trauma-informed there, not solicited here.)_

**Tally:** **61** as built (from 100; the inline counts above are indicative — a couple of branched
follow-ups land the exact figure). Explicit register retained; the two matrices do the heavy lifting on
volume; H adds the wellbeing depth.

### 4.3 Second pass — consolidation + an opt-in "specifics" gate (61 → ~40; user-directed 2026-06-21)

A follow-up review found the 61-block still long, with avoidable **redundancy against the `activities`
matrix** and granular preference data that only a subset of people want to fill in. The user's goal is
**better AI signal for personalizing sessions / questionnaires / dream analysis with fewer questions** — so
this pass **consolidates** (not softens) and **gates the explicit specifics behind one opt-in**, keeping the
explicit register. The result: **~40 questions**, of which a casual user sees only **~28** (the core) unless
they toggle "want to get specific?". Explicit content is unchanged for those who opt in.

- **Cut as redundant with the kept `activities` matrix** (it already has give/receive rows): `givesOralPenis`
  (Oral giving), `analPref` (Anal giving/receiving), `choking` (Choking giving/receiving), and the **`toys`
  matrix** (Vibrators/dildos, Butt plugs are activity rows). `cncInterest` is dropped — already an option in
  `commonFantasies`.
- **Cut as low coaching-signal / your call:** `partnerGrooming`, `ownGrooming`, `erogenousZones`,
  `partnerCount`, `firstExperience` (covered by messages-growing-up + shame), `kinks` free-text (covered by
  matrix + commonFantasies + idealEncounter), `pornGenres` (keep `watchPorn` frequency), `positions`,
  `masturbationFreq`, `bodyTypePref`, and the most granular act survivors `swallowSpit` + `cumWhere`.
- **Merge / rework:** `inTheMood` → folded into `turnOns`; `wildestFantasy` + `fantasiesToTry` → one
  `fantasies` long-text; `erotica` + `sexualMedia` → one `eroticaMedia` multi; `dirtyTalk` single dropped
  (the matrix has a _Dirty talk_ row) but the rich `dirtyTalkLikes` ("what you love to hear") is kept;
  `degradePraise` → two new rows on the activities matrix (_Degradation / humiliation_, _Praise / worship_),
  the single dropped.
- **The opt-in gate** — a new `getSpecific` (yesNo) in a "Getting specific (optional)" group. Everything
  explicit/granular branches on `when('getSpecific', true)`: `turnOns`, `turnOffs`, `roughness`, `domSub`,
  the `activities` matrix, `dirtyTalkLikes`, `idealEncounter`, `fantasies`,
  `commonFantasies`, `watchPorn`, `eroticaMedia`. **Always-visible core (~28):** orientation/identity (+
  `desireType`), the reflective story (messages / shame / first-age), the whole **current-sex-life** relational
  block (gated only on `hasPartner`), `bodyConfidence`, and the **entire** wellbeing / consent / safety /
  meaning group. Safety, consent, boundaries and the emotional/relational signal are **never** hidden behind
  the specifics gate.
- **`restricted`/privacy unchanged** — every intimacy answer stays `restricted` (or a `private` field); the
  18+ ack + own-context-only boundary (§8) is untouched. `INTIMACY_ACTIVITIES`/`INTIMACY_FANTASIES` shared
  constants are unchanged (the two new matrix rows are appended inline to the intake matrix only, not the
  shared inventory the questionnaire engine reads).

## 5. Architecture & modules

- **`intakeCatalog.ts`** — rewrite the `intimacy` section to the §4.2 bank. Reuse the shared
  `INTIMACY_ACTIVITIES` / `INTIMACY_FANTASIES` / `TOYS` constants; the activity + toys **matrices** reference
  those same lists (one source of truth with [`08`](08-questionnaires.md) generation — no drift).
- **`matrix` (3-point labelled — AS BUILT).** Today's `matrix` is rows × a numeric scale (value
  `Record<string, number>`). Rather than a heavier categorical-columns type (which would need a horizontal
  column grid — a mobile no-horizontal-scroll hazard, §12), the 3-state matrix is an **ordinal 3-point** scale
  whose buttons show **labels instead of numbers**. The minimal additive changes: (1) `Question.matrix` gains
  an optional **`midLabel`** (mirroring slider); (2) `@selfos/answering`'s `ScalePicker` gains an optional
  `labels` prop, and the matrix render passes the 3 labels when a matrix has exactly 3 points + all of
  min/mid/maxLabel (otherwise unchanged numbered points — existing 5-point questionnaire matrices are
  untouched); (3) `IntakeAnswerValue` is **widened** to include `Record<string, number>` (the intake now
  stores a matrix answer); (4) the shared `isAnswered` (every-row, kept for required questionnaire matrices)
  is supplemented by an **intake-local `intakeAnswered`** that counts a matrix answered when **any** row is
  rated — so a long optional activity matrix persists partial ratings. The buttons stay flex-wrapped
  (`.scale`/`.matrixRow` wrap), so 3 labelled options never overflow at ~360px.
- **Synthesis** — the whole `intimacy` section is `restricted`, so all its facts flag restricted via
  `RESTRICTED_SECTION_REFS` ([`18`](18-personal-onboarding.md) §14.8). A new `formatAnswerForSynthesis` maps a
  3-point labelled matrix answer to readable label text for the portrait input ("oral: Into it; choking: Hard
  limit"), and `answerToString` gained a keyed-map fallback so a matrix never reads "[object Object]".
- **Slider-seed fix** — the intimacy sliders (libido intensity, roughness, body confidence, etc.) use the
  **unseeded** optional-slider behaviour from [`26`](26-intake-catalog-redesign.md) §5 /
  [`28`](28-portrait-synthesis-optimization.md) — an untouched intensity slider is **unanswered** (no
  false-neutral "average roughness" fact).

## 6. IPC / API contracts

**No IPC changes** — same `intake:submitForm` / `synthesize` / `acknowledgeAdult`. The 18+ ack is enforced in
the bridge before the intimacy section's questions are served ([`18`](18-personal-onboarding.md) §6).

## 7. States & edge cases

- **Pre-redesign answers** — a person who answered the old `intoIt`/`curiousToTry`/`hardLimits`/positions/
  body-pref questions keeps those answers in `answers` (ignored by the new catalog). Re-synthesis uses the
  new bank. No data loss; the standard "refresh your portrait" nudge applies
  ([`26`](26-intake-catalog-redesign.md) §7).
- **18+ not acknowledged** — the section stays gated; unchanged.
- **Matrix partially filled** — blank rows = no answer (no fact); only filled rows produce facts.
- **Branch staleness** — handled by the existing `resolveBranch` pruning ([`08`](08-questionnaires.md)).
- **Crisis / trauma disclosure mid-block** — leads with warmth + resources; the optional pointer to **What
  weighs on you** is available; footer always present.

## 8. Safety, privacy & honesty

- **18+ + `restricted` + owner-visible / everyone-else-redacted + excluded from `buildDepictionNote` + never
  broadcast-shareable** — all unchanged ([`18`](18-personal-onboarding.md) §14.10). The structured answers
  (incl. the two matrices) ride the **same** rails as today's.
- **Relevance-gated surfacing** — the coach references intimacy facts only in clearly relevant contexts
  ([`18`](18-personal-onboarding.md) §14.11; sharpened by [`28`](28-portrait-synthesis-optimization.md)'s
  life-area selection — Intimacy facts surface in intimacy/relationship sessions, not a budgeting chat).
- **Consensual-adult boundary** — unchanged ([`18`](18-personal-onboarding.md) §14.5). Taboo _fantasy_ (CNC)
  stays framed as roleplay with real limits captured in the matrix/H; no minors / real non-consent / illegal
  acts as activities.
- **Sexual trauma** — not solicited here; the gentle optional pointer routes it to the trauma-informed
  **What weighs on you** ([`26`](26-intake-catalog-redesign.md)). Not-medical line + `CrisisFooter` on every
  surface.

## 9. Accessibility

The activity/toys **matrix** must be fully keyboard-operable and screen-reader-clear (each row a labelled
single-select group; the three columns announced) — the biggest a11y item here, since it's the new control.
Per [`01`](01-design-system.md) §9: no horizontal scroll at ~360px (a wide matrix on a phone needs a
responsive layout — likely stacked per-row on narrow widths, like the `roster` cards). Unseeded sliders
announce "not set." Reduced-motion respected.

## 10. Testing strategy

- **Catalog unit:** the new `intimacy` bank matches §4.2 (count in band, the two matrices present, every
  free-text has a placeholder, the NEW wellbeing items present); the section is `restricted` + `adult`; the
  branches sit under their gates (the conditional-reveal assertion from [`18`](18-personal-onboarding.md)
  §14.5 still passes).
- **Matrix unit:** a categorical matrix renders rows × named columns; `isAnswered` true only
  for filled rows; `answerToString` formats "Into it: …; Curious: …; Hard limit: …".
- **Synthesis unit:** intimacy answers → `restricted` facts (never `shareable`); the matrix answer becomes
  readable facts; `sexualOrientation`/`relationshipStyle` land as private fields.
- **E2E:** 18+ ack → the intimacy form → fill the activity matrix + a branched explicit question →
  synthesize → a `restricted` intimacy fact is owner-visible but redacted for a member; orientation is a
  private field; the matrix value decrypts correctly; 390px (matrix stacks, no overflow) + control-geometry
  guards. Run `pnpm typecheck` after tests.

## 11. Open questions

1. **Matrix support** — RESOLVED at build: today's `matrix` is scale-only, so the 3-state matrix is an
   ordinal **3-point labelled** scale (additive `midLabel` + a `ScalePicker labels` prop), not a categorical-
   columns type — see §5. Mobile-safe (wrapping), value stays `Record<string, number>`.
2. **Activity-list length in a matrix** — shipped with the **full** shared `INTIMACY_ACTIVITIES` as rows (one
   source of truth with [`08`](08-questionnaires.md) — not forked/trimmed); the rows stack vertically. If it
   reads long in use, a future polish could add sub-headers; not blocking.
3. **STI / sexual-health screening** — add a light, clearly-optional, non-diagnostic "anything about sexual
   health you'd want SelfOS to keep in mind" (text), or keep out as medical? (Default: out.)
4. **Exact retention in B/C/E** — the reflective-story and acts items trimmed here (§4.2) — confirm the cut
   set vs. keeping one or two more.
5. **Desire-type wording** — validate the spontaneous/responsive framing reads naturally for all genders.

## 12. Resolved decisions

- **Direction** — rebalance **but keep explicit** (user, 2026-06-21): cut volume + add wellbeing depth, do
  not soften the graphic/casual register.
- **Volume** — 61 as built (from 100), via the activity/toys matrices, merged positions, and trimmed granular
  body-prefs. **Second pass (2026-06-21): ~40** — consolidate redundancy against the activities matrix + gate
  the explicit specifics behind one opt-in toggle (§4.3); ~28 shown to a casual user. Explicit register kept.
- **Additions** — desire type, current masturbation frequency, after-care, consent/communication practices,
  sex↔emotional-security; sexual self-esteem kept.
- **Boundary** — unchanged; sexual trauma routes to **What weighs on you**, not solicited here.

## 13. Changelog

- 2026-06-21 — created (Draft). Part of the onboarding-redesign spec group (26 non-intimacy catalog · 27
  intimacy · 28 synthesis/context optimization · 29 progressive profile-building). Rebalances the intimacy
  block 100 → ~58, explicit register retained, via a 3-state activity matrix + sex-therapy wellbeing
  additions; amends [`18`](18-personal-onboarding.md) §14.5/§14.10/§14.11.
- 2026-06-21 — **Approved + built** (`feat/intimacy-redesign`, stacked on `feat/intake-catalog-redesign`/26,
  NOT merged). Rewrote the `intimacy` section **100 → 61**, explicit register retained: the into-it/curious/
  hard-limits triple list → ONE 3-point **labelled matrix** (Hard limit · Curious · Into it); `toysOwn`/
  `toysWant` → one toys matrix (Not for me · Want to try · Own it); merged the 4 position multis + the
  touch/erogenous multis; trimmed the granular body-pref enumeration (breast/labia/clit/penis sliders);
  **added** the sex-therapy depth — `desireType` (spontaneous/responsive), `masturbationFreq`,
  `sexEmotionalSecurity`, `afterCare`, `consentPractices` (`bodyConfidence` kept). Engine (all additive,
  no migration): `matrix.midLabel` + a labelled `ScalePicker` (3-point matrices only; existing numbered
  matrices untouched), `IntakeAnswerValue` widened to the matrix record, an intake-local partial-matrix
  answeredness, and `formatAnswerForSynthesis` (labelled portrait text). `sexualOrientation`/
  `relationshipStyle` stay the only private fields; every other intimacy answer `restricted` (the catalog
  invariant test passes). Tests: +catalog intimacy-band/matrix guard, +core partial-matrix-persists +
  synthesis-formats-labels, +`QuestionnaireForm` RTL labelled-matrix render+pick, and the onboarding **E2E**
  now asserts the labelled matrix renders in the real built app after the 18+ ack. Gate: typecheck (node +
  web), lint, format, **444 core + 533 desktop + 11 relay** unit, onboarding E2E green. Same numbering note
  as 26 (this group is 26–29; merge-time reconcile). Awaiting user review.
- 2026-06-21 — **Second pass — consolidation + opt-in specifics gate (61 → ~40)** (`feat/intimacy-trim`,
  off `main`). User: "still A LOT of questions" — goal is better AI personalization signal with fewer
  questions. Decisions all **asked first** (3 rounds). **Cut 15:** redundant-with-the-`activities`-matrix
  (`givesOralPenis`/`analPref`/`choking`/the `toys` matrix; `cncInterest` already in `commonFantasies`) +
  low-signal/your-call (`partnerGrooming`/`ownGrooming`/`erogenousZones`/`partnerCount`/`firstExperience`/
  `kinks`/`pornGenres`/`positions`/`masturbationFreq`/`bodyTypePref`). **Merged:** `inTheMood`→`turnOns`;
  `wildestFantasy`+`fantasiesToTry`→one `fantasies` long-text; `erotica`+`sexualMedia`→one `eroticaMedia`
  multi; `dirtyTalk` single dropped (matrix covers it; kept `dirtyTalkLikes`); `degradePraise`→two new
  activities-matrix rows. **New opt-in gate:** a `getSpecific` yesNo in a "Getting specific (optional)"
  group; the 13 explicit/granular questions branch on `when('getSpecific', true)` so a casual user sees
  ~28 core (orientation, reflective story, the relational current-sex-life block, body confidence, and the
  **entire** wellbeing/consent/safety/meaning group — never gated). Privacy/18+/`restricted` unchanged;
  shared `INTIMACY_ACTIVITIES`/`_FANTASIES` constants untouched (the two new rows are inline to the intake
  matrix only); a follow-up also cut the most granular act survivors `swallowSpit` + `cumWhere`. See
  §4.3. Tests updated (catalog band ~40 + matrices = `['activities']`; the intimacy E2E
  reworked to exercise the new `getSpecific` gate alongside the `hasPartner` conditional).
