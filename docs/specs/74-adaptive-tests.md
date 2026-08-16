# 74 — Adaptive tests & the erotic lexicon ("Dirty Talk")

> **Status:** Built — _last updated 2026-08-16_ (on `feat/adaptive-tests-spec`; all 19 decisions resolved; PR pending)
>
> A **second kind of test**. Every instrument in [`50`](50-self-assessments.md)/[`51`](51-wellbeing-neurodivergence-reflections.md)
> is a fixed item list scored by pure arithmetic. This adds an **adaptive** kind: the AI writes the items as it
> goes, seeded by what the app already knows, and a synthesis pass turns the take into a structured profile the
> whole app consumes. Its first instrument is **Dirty Talk** — a map of the sexual language a person wants to
> hear, wants to say, wants to be _able_ to say, and never wants again. **Fantasy** and **Sex Sessions** are the
> next two instruments on the same engine, which is why the engine exists at all.

Builds on [`50`](50-self-assessments.md) (the Tests hub, `TestResult`, the result→Insight bridge, `tests.own`,
the shared 18+ ack), [`49`](49-intimacy-activities-inventory.md) (the rating inventory + the "a hard no is a
boundary" rule), [`71`](71-question-intelligence-rebuild.md) (the ask ledger + topic map, which this both reads
and writes), [`70`](70-adaptive-exploration.md) (the silent partner steer), [`08`](08-questionnaires.md) (the
answering renderer, the context-provider registry, `explicitFraming`), [`58`](58-together-couples-sessions.md)
(the couples register + the consented-overlap precedent), [`66`](66-chat-reliability-and-message-management.md)
(`streamWithContinuation`), and [`06`](06-ai-usage-and-budgets.md) (every call metered + budget-gated).

---

## 1. Overview

### 1.1 The problem

SelfOS knows what a person likes to **do**. It knows almost nothing about what they want **said**.

Five surfaces touch dirty talk today and none of them produce anything usable: onboarding has a free-text box
(`dirtyTalkLikes`, "things you love to hear"); the activity matrix has six rows (_Light dirty talk · Explicit
dirty talk · Sexting · Phone sex · Begging · Verbal commands_); the kink test scores a `kink.dirty-talk`
category; there is a guided `dirty-talk-practice` session that opens by asking the person what they want to be
able to say; and the topic map carries `Intimacy:dirty-talk` as ground to mine. The result is a person who has
been asked about dirty talk five times and an app that still cannot produce one sentence they'd actually want to
hear — while spec 71 §1 measured that same ground being re-asked _7+ times in near-identical wording_.

Language is also the highest-leverage thing to know. A rating on "Explicit dirty talk: ♥♥♥" is nearly useless.
_"`good girl` and `mine` land, `filthy little slut` doesn't, and she wants to be able to say `cock` but freezes"_
changes what the coach says, what a questionnaire asks, what a challenge proposes, what her book sounds like,
and what her partner is told to try tonight.

### 1.2 Why a new test KIND, not a new instrument

The spec-50 engine cannot host this, structurally:

| Spec-50 assumption                                   | Why an adaptive test breaks it                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `TestDefinition.items` is a fixed list               | The items are written per take, from the person's own answers                                         |
| `testsGet` returns the whole form up front           | There is no whole form until the take is over                                                         |
| `itemCount` / `estimatedMinutes` derive from `items` | Both are estimates, not counts                                                                        |
| `TestResult.answers` = `questionId → value`          | Stores answers with **no record of what was asked** — meaningless six weeks later for generated items |
| Subscale keys come from the definition               | If the AI names dimensions per take, trends silently break                                            |
| Scoring is free                                      | Every adaptive turn is a metered model call                                                           |

So: a second kind, sharing the hub, the result→Insight bridge, the 18+ ack, the capability, and the Memory
integration — and diverging on items, storage, scoring, and cost.

### 1.3 Where the output goes

The take produces two artifacts:

1. An **`AdaptiveTestResult`** — versioned, dated, trend-bearing, deletable, exactly like any other test result.
2. A shared **erotic lexicon** (`EroticLexicon`) — one per person, written by every adaptive intimacy test and
   read by every explicit surface in the app. Dirty Talk writes its `words`/`lines`/`registers`/`contexts`;
   Fantasy and Sex Sessions will write their own sections into the same store. **Boundaries are global**: a hard
   no recorded in one test constrains all three, and every consumer.

Consumers: the solo coach, guided intimacy sessions (especially `dirty-talk-practice`), questionnaire generation
(`explicitFraming`), Together, challenges, the intimacy email, the **erotica book type**, and — silently — a
partner's suggestions.

## 2. Goals / Non-goals

**Goals**

- A reusable **adaptive test engine** in `@selfos/core/tests/adaptive`: probe packs, a fixed dimensional spine,
  seed material, a stopping rule, a synthesis contract. Adding Fantasy or Sex Sessions is then a definition file.
- The **Dirty Talk** instrument: a free deterministic word bank, an AI line-reaction pass, adaptive probes,
  context scenarios, and a synthesis into a profile the person can read, edit, and act on.
- A shared, **editable** `EroticLexicon` + a **global boundary store** every explicit surface honors.
- **Saturation write-back**: taking the test marks `Intimacy:dirty-talk` worked-through in the ask ledger, so
  the questionnaire planner stops mining ground the test just covered.
- A **silent partner steer** so one partner's coach can suggest language the other actually wants — never
  attributed, never announced — plus a **hard-no suppression that applies with or without any sharing**.
- The hub renamed **Tests** (`/tests`), with wellbeing instruments keeping their "check-in"/"reflection" nouns.

**Non-goals**

- **Retiring any existing surface.** Owner decision: coexist + seed. `dirtyTalkLikes`, the matrix rows, the kink
  subscale and the guided session all stay exactly as they are; the test seeds from them and saturates the topic.
- **A consented partner-share surface.** The partner path is the silent steer only (§5.7). No opt-in screen, no
  "share my profile" toggle, no phrasebook to send. (If that's ever wanted it is additive.)
- **Audio / voice.** Register is captured as text about voice ("low, close, certain"), never recorded audio. No
  second provider.
- **Fantasy and Sex Sessions themselves** — this spec builds the engine and one instrument; each later
  instrument is its own slice (and its own §11 decisions).
- **Gating the content.** No tier ceiling, no family opt-in, nothing hidden (§3.2). The 18+ ack and the hard
  limits (§8.1) are the only things standing in front of any of it.
- **Anything outside consensual adults.** Unchanged from every intimacy surface (§8).

## 3. UX & flows

### 3.1 The hub rename (`/you` → `/tests`)

Nav label and route become **Tests**; the page keeps its "how you see yourself" framing and its link to Memory.
The **wellbeing group keeps its own nouns everywhere** — cards say _Check in_, results say _check-in_, the
recommendation copy is unchanged — because [`51`](51-wellbeing-neurodivergence-reflections.md) §8.1 forbids
framing a PHQ-9 as a test. `/you` and `/you/*` **redirect** to `/tests/*` (deep links, the `wellbeing-checkin`
recommendation route, and any bookmark keep working).

An adaptive test's catalog card differs from a deterministic one in three ways: it says **"about 15 min · adapts
as you go"** instead of an item count, it carries a **cost line** ("uses a little of your AI allowance"), and its
Take button reads **Start**.

### 3.2 The take — Dirty Talk, phase by phase

Every phase persists on completion. The take is **resumable across sittings** (a `draft` result), shows
**realtime progress** on every AI phase (phase label + elapsed + ETA — the durable §12 rule; a bare spinner is
unacceptable), and can be abandoned at any point without saving a profile.

**Phase 0 — Intro.** 18+ ack if not already held (the shared `guidance/prefs.enc adultAcknowledged`); the
non-diagnostic framing; what it costs; and the honest privacy line: _"This stays yours. It shapes how SelfOS
talks to you — and, if you have a partner here, it can quietly shape what their coach suggests to them. It never
tells them what you said."_ (§8.4 — the person is told the steer exists before they produce the material.)

**Phase 1 — The bank.** Deterministic, free, instant, and **comprehensive** — the full draft inventory is §13:
~300 entries across **19 families**, each carrying an intensity **tier 1 (tame) → 5 (extreme / taboo fantasy)**,
mirroring the spec-49 activity inventory's `{ key, label, category, tier }` model so the two read the same way.

Two kinds of entry, because people don't speak in single words:

- **Words** — `cunt`, `cock`, `good girl`, `slut`, `wet`, `throbbing`.
- **Phrases** — the things actually said: _"fuck me in the ass" · "choke me" · "finger my asshole" · "deeper" ·
  "pound my pussy" · "suck that cock" · "don't come until I say" · "I can feel you throb"_. These are the high-value
  entries; a word rating alone can't tell you whether she wants to be **told**, **asked**, or **narrated to**.

Each entry is rated **twice** — hear and say — because what you love to hear and what you can get out of your
own mouth are completely different things, and that gap is the most useful thing this test finds:

|             | HEAR | SAY |
| ----------- | ---- | --- |
| `cunt`      | ♥♥♥♥ | ✗   |
| `good girl` | ♥♥♥♥ | —   |
| `whore`     | ✗    | ✗   |

Scale: `✗` never · `~` not yet · `—` nothing · `♥`…`♥♥♥♥`. **Three negative states, not one** (owner decision):

- **`✗` never** — permanent. Suppressed everywhere, never re-offered on a retake, and **no reason is ever
  asked**. Requiring someone to justify a no is itself coercive (§8.2).
- **`~` not yet** — "makes me cringe / I'd feel like an idiot". Revisitable on a retake, and the raw material
  for the shame + practice sessions. This is where most of the coaching value lives.
- **`—` nothing** — neutral, no signal.

**Pacing a 300-entry bank without a wall.** Rating 300 entries in two directions is 600 taps and nobody finishes.
Three mechanisms, all existing precedents:

1. **A ceiling.** One question first — _"How far should this go?"_ — sets the tier ceiling (**1–2 playful · 3
   explicit · 4 filthy & kinky · 5 no limits, show me everything**). Entries above the ceiling are never
   rendered. Raising it later is one tap and reveals the rest; it is never raised for them.
2. **Family opt-in**, exactly the kink test's branched `equalsAny` pattern: they pick which families to work
   through; each family's grid is revealed only when chosen. Degradation, taboo fantasy and edge families are
   never shown unopened.
3. **Skip is free** at family and entry level, and an unrated entry is simply omitted from the scoring mean —
   never treated as a no (the `scoreSubscale` "unanswered → omit" rule).

A free write-in per family ("your words — anything we missed"). **As built:** both anatomical forms ship as
entries and everyone sees both, marking what applies; per-person resolution via `activityRows` (and the dialect
question) are later refinements rather than shipped behaviour.

Each entry declares its sensible **directions** — most demands are `both` (she says _"fuck me harder"_, he hears
it), a few are one-way (_"good girl"_ is rarely a thing you say about yourself) — so the grid never asks a
nonsense question.

This phase alone is shippable value: no AI, no cost, and already better than the free-text box.

**Phase 2 — Line reactions.** ONE batched model call writes ~12 complete lines, seeded by phase 1 + the seeds in
§5.4, each tagged internally with register + heat. The person marks 🔥 / 😐 / 🚫.

> _"You're so fucking wet for me." · "Good girl. Just like that." · "I can feel you throbbing around me." ·
> "Don't come until I say." · "Look at you, taking every inch." · "You're mine. Say it." · "Beg me for it." ·
> "You filthy little slut, you love this." · "God, you feel perfect." · "Tell me what you want. Out loud."_

The inference this unlocks is the point: `good girl` ♥♥♥♥ + `slut` ♥♥♥ + _"filthy little slut"_ 🚫 means the pull
is **claiming and praise inside a power dynamic**, not degradation — which no word-level rating could tell you.

**Phase 3 — Probes.** 3–6 adaptive turns, only where the signal is genuinely ambiguous. Not a survey; a
conversation that already knows things:

> **You loved _"good girl"_ and _"you're mine"_ but _"filthy little slut"_ was a no. Is it being talked _down_
> to that doesn't land — or that word specifically?**
>
> **You marked _"cunt"_ as never-say but yes-hear. Is that "he can, I can't", or does hearing it in your own
> mouth just feel wrong?**

The second question is the one that finds a **goal** rather than a preference — _"I want to be able to. I just
freeze"_ — and hands `dirty-talk-practice` a real starting point.

**Phase 4 — Context scenarios.** 2–3 scenes, because register is context-dependent and the most obvious way this
feature embarrasses someone is suggesting mid-act language for a 2pm text (owner decision: score per context).
Contexts: **build-up · during · edge/climax · after · sexting · phone**.

> _It's 2pm. He texts: "thinking about last night. specifically the noise you made." What's the right next
> message?_ → escalate / tease / soft / not at work
>
> _He's got you pinned, thirty seconds away. What do you want in your ear?_ → "come for me" / "not yet" /
> narration / no words
>
> _Afterwards, still lying there._ → "good girl" / "that was incredible" / "come here" / nothing

**Phase 5 — Synthesis.** One structured pass → the profile. Metered; the person sees phase + timer + ETA.

### 3.3 The report

Written **to them, in their register** — not a clinical readout. It is also, deliberately, a thing they might
read aloud or hand to a partner (§8.5), so it reads like prose with the structure underneath:

> **You want to be claimed, not degraded.** _Mine · my slut · good girl · you're perfect_ all landed hard.
> _Filthy little slut_ didn't. The line isn't how crude the word is — it's whether there's warmth behind it.
>
> **You want to be told, not asked.** Every question-shaped line scored lower than every command.
>
> **Your strongest register is narration.** _You're so wet · I can feel you throb · you're so tight._ He doesn't
> need better words; he needs to say what's happening out loud.
>
> **What you can't say yet.** _Cock. Cunt._ You want to and you freeze. That's not a limit — that's the thing to
> practise, and there's a session for it. → **Practise this**
>
> **Off the table.** _Whore · filthy · daddy · anything about being used._ Not "maybe later" — off.
>
> **Timing.** Build-up: teasing, no filth. During: filth, commands, narration. After: soft and short.

Below it: the editable lexicon (§3.4), the spine bars (`SubscaleBar`, reusing the deterministic result screen),
trends across retakes (`LineChart`, ≥2 results), history, and Delete.

The report **may interpret** ("you respond to being claimed, not degraded") — clearly labelled as a reading of
what they answered, never a verdict (§8.1). It is second-person, in their words, never clinical labels.

### 3.4 Editing

Every part of the lexicon is editable in place: add a word, move one between states, fix a mis-read line, edit
the prose. It is _their vocabulary_; an AI reading of it is a draft. Edits write straight to the `EroticLexicon`
(not the result — the result is the dated record of what they answered on the day).

### 3.5 Retakes, deletion, and the practice handoff

Retake = a new dated result + a trend point; the lexicon is **merged forward**, and a `✗ never` is never
re-offered (a `~ not yet` is). Delete-one re-derives from the latest remaining result; delete-all removes the
results, the derived Insight, **and** the lexicon sections this test owns — deletion has to be real here (§8.5).

The report's **"Practise this"** button starts the existing `dirty-talk-practice` guided session with the goal
pre-loaded, so the guided session stops opening on "what do you want to be able to say?" when the app already
knows.

## 4. Data model

All Zod-backed, encrypted under the master key, in the taker's own folder. Definitions are **code, never vault**.

### 4.1 Vault layout

```
people/<person-id>/
  tests/<result-id>.enc          # existing — now holds AdaptiveTestResult too (discriminated by `kind`)
  tests/lexicon.enc              # NEW — the shared EroticLexicon (one per person, all adaptive intimacy tests)
  insights/<insight-id>.enc      # existing — the derived Insight (source: 'test')
  questionnaires/askLedger.enc   # existing — the saturation write-back (§5.6)
  guidance/prefs.enc             # existing — the shared 18+ ack
```

### 4.2 `AdaptiveTestDefinition` (code)

```ts
type TestKind = 'deterministic' | 'adaptive';

interface AdaptiveTestDefinition {
  id: 'dirty-talk'; // later: 'fantasy', 'sex-sessions'
  kind: 'adaptive';
  group: 'intimacy';
  adult: true;
  sensitive: true;
  title: string;
  blurb: string;
  framing: string;
  estimatedMinutes: number; // an estimate, not a count

  /** The FIXED dimensional spine — stable metric keys, so trends and `Insight.metrics` survive a retake even
   *  though the items don't. The synthesis MAPS onto these; it may never invent a key. */
  spine: { key: string; label: string; description: string }[];

  /** The phases this instrument runs, in order. Each names a probe pack (§5.2). */
  phases: AdaptivePhase[];

  /** What the take may read to personalize turn 1 (§5.4). */
  seeds: SeedSource[];

  /** The topic ids this instrument covers, written back to the ask ledger on completion (§5.6). */
  saturates: string[]; // ['Intimacy:dirty-talk']

  /** The synthesis contract — the JSON shape the report parses into. */
  synthesis: { schema: ZodType; system: string };
}
```

Dirty Talk's spine (stable keys, never AI-invented):

`dirtytalk.explicitness · .praise · .claiming · .command · .narration · .degradation · .begging ·
.receiving-voice · .giving-voice · .say-confidence`

### 4.3 `AdaptiveTestResult`

The critical difference from `TestResult`: it stores **what was asked**, not just the answers.

```ts
interface AdaptiveTestResult {
  id: string;
  schemaVersion: number;
  kind: 'adaptive';
  testId: string;
  testVersion: number;
  subjectPersonId: string;
  status: 'draft' | 'complete'; // resumable across sittings
  /** Every turn, in order — the generated item AND the answer. Without this a generated item's answer is
   *  meaningless later, and a retake can't tell what it already asked. */
  turns: { phase: string; item: AdaptiveItem; answer: AnswerValue; at: string }[];
  scores: TestSubscaleScore[]; // mapped onto the definition's spine — reuses the 50 shape
  profile: DirtyTalkProfile; // the structured synthesis (§4.5)
  narrative: string; // the prose report
  reTakeOf?: string;
  insightId?: string;
  costUsd: number; // what this take actually cost (admin-visible only)
  takenAt: string;
  createdAt: string;
  updatedAt: string;
}
```

### 4.4 `EroticLexicon` (shared, per person)

```ts
interface EroticLexicon {
  schemaVersion: number;
  personId: string;
  entries: {
    key: string; // stable slug — survives a relabel, the 46 §4.2 rule
    text: string;
    kind: 'word' | 'phrase';
    family: DirtyTalkFamily; // one of the 17 (§13)
    tier: 1 | 2 | 3 | 4 | 5; // tame → extreme, mirroring INTIMACY_ACTIVITIES_FULL
    directions: ('hear' | 'say')[]; // most are both; a few only make sense one way
    hear: 0 | 1 | 2 | 3 | 4; // — · fine · like · love · that word does it
    say: 0 | 1 | 2 | 3 | 4;
    state?: 'never' | 'notYet'; // a boundary, not a low score (49 §3.1)
    custom?: boolean; // their write-in
    source: string; // which test/edit wrote it
  }[];
  /** The tier ceiling they chose (§3.2). Entries above it were never shown — so an unrated tier-5 entry means
   *  "not asked", NEVER "not interested", and no consumer may read it as a no. */
  ceiling: 1 | 2 | 3 | 4 | 5;
  lines: { text: string; reaction: 'love' | 'meh' | 'no'; registers: string[] }[];
  registers: Record<string, number>; // praise · claiming · command · narration · degradation · begging
  contexts: Record<string, { heat: number; note?: string }>; // buildUp · during · edge · after · sexting · phone
  wantsToSay: string[]; // the GOAL list — the coachable material
  themes: string[]; // their own words
  voice?: string; // "low, close, certain. not loud."
  /** GLOBAL boundaries — written by any adaptive intimacy test, honored by every consumer. Never re-offered. */
  boundaries: { text: string; kind: 'word' | 'theme'; at: string }[];
  updatedAt: string;
}
```

### 4.5 `DirtyTalkProfile`

The per-result snapshot of what this take concluded (the lexicon is the living merge of all takes). Same fields,
plus the mapped `spine` values.

### 4.6 Additive schema changes

- `TestResultSchema` → a discriminated union on `kind` (absent ⇒ `'deterministic'`, so **no migration**).
- `InsightProvenance` already carries `testId`/`testResultId`. No change.
- New `USAGE_TYPE_LABELS` entries: `test.adaptive.lines` · `test.adaptive.probe` · `test.adaptive.scenario` ·
  `test.adaptive.synthesize`.
- **No new capability** — `tests.own` + the shared 18+ ack cover it.

## 5. Architecture & modules

`@selfos/core/tests/adaptive/` — `engine.ts` (the run loop + stopping rule) · `probePacks.ts` · `lexicon.ts`
(the shared store + merge + boundary rules) · `saturation.ts` (the ledger write-back) · `steer.ts` (the partner
steer + the suppression) · `instruments/dirtyTalk.ts` (the definition + word bank + synthesis contract).

### 5.1 The run loop

Each AI phase is one `runClaude` call (`AiDeps`, budget-gated, metered, `streamWithContinuation`,
tolerant-parsed via `jsonSalvage`, **metered before parse**). The engine never runs a phase without a budget
check, and a failed phase degrades to _skip this phase_, never to a failed take: a take that reaches synthesis
with only phase 1 answered still produces a (thinner, honest) profile.

### 5.2 Probe packs

`word-bank` (deterministic) · `line-reaction` (batched generation + swipe) · `probe` (open adaptive turn) ·
`scenario` (a described moment + choices) · `forced-choice`. A pack declares how it renders (reusing
`@selfos/answering` where the shape fits) and how its answers feed the synthesis. Fantasy will lean on
`scenario`; Sex Sessions on `scenario` + a new `sequence` pack.

### 5.3 The stopping rule

Bounded by BOTH: a per-phase turn cap AND a hard **`MAX_ADAPTIVE_CALLS = 6`** and **`MAX_TAKE_COST_USD = 0.40`**
per take, stated up front in the intro. When either is hit the engine proceeds to synthesis with what it has.

### 5.4 Seeds

Read once at the start of the take (never re-read mid-take): the intake intimacy section (`dirtyTalkLikes`,
`turnOns`, the `dirty-talk` matrix rows, anatomy, orientation), the kink test's `kink.dirty-talk` subscale, the
topic map's open/closed intimacy ground, whether a live `partner` edge exists, and the existing lexicon on a
retake. **Coexist + seed** (owner decision): nothing upstream is retired or changed.

### 5.5 Result → Insight

Unchanged bridge (50 §5.4): one Insight, `source:'test'`, `approved:true`, retake reuses `insightId`, facts
`lifeArea:'Intimacy'` and `shareableTypes:['partner']`. Which means the existing **relevance gate applies**: the
profile reaches the taker's own intimacy-topic context only, is excluded from topic-free digests
(`digestableInsights`), and is excluded from Together prompts by `excludeRestricted`. Consumers that need more
than that get an **explicit seam** (§5.8), never a loosened gate.

### 5.6 Saturation write-back

On completion the engine appends ask-ledger entries for `saturates` (`Intimacy:dirty-talk`) with a synthetic
`assignmentId` of `test:<resultId>`, `outcome: 'rich'`, and a gist per phase. `deriveTopicStats` then counts them
like any other ask, so the planner treats the ground as worked-through and moves on — reopening naturally after
`DORMANT_DAYS`. Idempotent by `questionId` (`test:<resultId>:<phase>`), so a re-merge is a no-op.

### 5.7 The partner steer (owner decision: silent, full-fidelity)

`buildDirtyTalkSteer(fs, key, requesterId, partnerId)`, modelled on `buildPartnerWishGuidance`:

- Gated on a **live `partner` edge**, re-checked on every call (a removed edge drops it immediately).
- Gated on **both** parties holding the 18+ ack.
- Emits the partner's lexicon as guidance the coach may use — **including her own written-in words and themes
  verbatim** (the owner's informed decision, §8.4) — under a NEVER-ATTRIBUTE instruction identical in force to
  the partner-wish block: never say it came from anyone, never say their partner told you, never quote a source.
- **Recommended bound (§11 Q1):** only the `loves`/`likes` lexicon, `lines` marked love, `themes`, `voice` and
  `contexts` travel. Boundary **reasons** and free-text **probe answers** never travel — those can carry history
  and narrative that has nothing to do with what she wants said in bed.

### 5.8 Consumers

| Consumer                        | Seam                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solo sessions + guided intimacy | The lexicon block appended after PERSONA/SAFETY/context, gated on the 18+ ack                                                                                                                                                                                                                                                             |
| `dirty-talk-practice`           | Opens on the `wantsToSay` goal; the practice material is their own list                                                                                                                                                                                                                                                                   |
| Questionnaire generation        | `explicitFraming` gains an optional vocabulary block — the tier still governs intensity, but the WORDS become theirs                                                                                                                                                                                                                      |
| Challenges                      | Drawn from `wantsToSay`/`likes`, never from `boundaries`                                                                                                                                                                                                                                                                                  |
| Intimacy email                  | **Yes** (owner decision) — the E-int family may send a specific line in their register instead of a generic nudge, behind its existing double opt-in                                                                                                                                                                                      |
| Together                        | Both partners' lexicons when both acked. The coach **may NAME a mismatch out loud** (owner decision) — "one of you wants to be told, the other has been asking permission" — framed as an observation about the pattern between them, never as one partner's file read aloud, and never attributing a specific word to a specific person  |
| **Erotica book**                | The `filthyTalk` register + the vocabulary substitution lists become person-tuned. **Same slice** (owner decision) — landed as the LAST commit, rebased immediately before, and purely ADDITIVE (a lexicon block appended after the existing register directives, never an edit of them) so it cannot clobber the register work in flight |
| Partner's coach                 | §5.7, plus the **unconditional suppression**: a `boundaries` entry can never appear in a suggestion to their partner, with or without any steer                                                                                                                                                                                           |

## 6. IPC / API contracts

All gated `tests.own` + active-person-scoped + 18+-withheld **in the bridge** (the trust boundary), with the
Claude key resolved host-side and never crossing IPC:

- `tests:adaptiveStart({ testId })` → `{ resultId, phase, item }` — creates/resumes a draft.
- `tests:adaptiveAnswer({ resultId, answer })` → `{ phase, item } | { done: true }` — persists the turn and
  returns the next item (running a model call only when the phase needs one). Progress is streamed on an
  `tests:adaptiveProgress` event (phase + elapsed + ETA, the §12 realtime rule).
- `tests:adaptiveSynthesize({ resultId })` → the profile + narrative.
- `tests:lexicon()` / `tests:updateLexicon({ patch })` — read + the §3.4 edits.
- `tests:adaptiveAbandon({ resultId })` — discard a draft.

`costUsd` is admin-only on every response (`budgets.manage`, redacted in the bridge — the 06 rule).

## 7. States & edge cases

- **AI off / no key / over budget** — phase 1 (the word bank) still runs and still writes a lexicon; the AI
  phases are skipped with a calm `AiUnavailableNotice`, and the report says honestly that it's the short version.
- **Mid-take failure** — the draft persists; reopening resumes at the last completed phase.
- **Cap reached** — synthesis runs on what exists; the report says it went short.
- **Empty seeds** (a person who did no intake) — the word bank carries the take on its own.
- **Corrupt result / lexicon** — skipped, never thrown (the `listResults` precedent); a corrupt lexicon degrades
  to empty rather than blocking a session.
- **Sync conflict** — the lexicon is last-write-wins on `updatedAt` **except boundaries, which UNION** (a hard no
  can never be lost by a merge).
- **Retake** — merges forward; `never` entries are never re-offered; `notYet` may be.
- **No partner** — solo/self-talk framing throughout; the steer simply never runs.
- **Partner edge removed mid-life** — the steer re-gates on the next call, no stale access.

## 8. Safety

### 8.1 The boundary

Consensual adults only; taboo strictly as fantasy/roleplay; never minors, never real non-consent, never illegal
acts; within Anthropic's usage policy. Stated in-prompt on every phase, enforced by content + the model, **never
a keyword filter** (the `@selfos/core/intimacy/topics` rule). The not-medical line and the `CrisisFooter` are on
every surface. The report interprets but never diagnoses.

### 8.2 Boundaries and shame

- A `never` is permanent, suppressed everywhere, never re-offered, and **never requires a reason**.
- The AI **never escalates**. It offers a spread; the person picks. If a probe would push toward material they
  haven't shown interest in, it doesn't run. The app never pushes sex at anyone.
- Names and roles are identity-loaded (_daddy_ for someone with a father wound, _slut_ for someone with a
  history). A probe offers once and backs off the instant it lands wrong.
- _"I'd feel like an idiot"_ is the most common answer this test will get. The response is warmth and the
  `sexual-shame` / practice sessions — never more probing.
- If shame, coercion, or an assault history surfaces: slow down, validate, **stop the take**, route to
  professional support. Never frame trauma as kink; never treat a disclosed assault as erotic.

### 8.3 Crisis

Unchanged: a distress signal in a probe answer raises `crisisFlag` on the result, feeds `aggregateCrisisSignal`,
and the report leads with resources.

### 8.4 Privacy — and the informed override

The profile is `lifeArea:'Intimacy'`, so by default it is own-context, intimacy-topic-only, digest-excluded and
Together-excluded.

**The owner has knowingly overridden this for the partner steer, twice.** Recorded plainly rather than buried:

1. The steer may use the partner's **own written words verbatim** in suggestions to their partner. It is never
   attributed — but _those are her words, and she will recognise them_. The first time he uses two of her phrases
   in one night she can reasonably infer the app told him. That is a disclosure by inference; it was chosen
   deliberately, and §3.2's intro tells the person the steer exists **before** they produce any material.
2. **Everything** travels — including boundary **reasons** and free-text **probe answers**, which can carry
   history that has nothing to do with what she wants said in bed. Also chosen deliberately.

**The one thing that does not travel is a safety rule, not a privacy preference:** text that tripped the
trauma/crisis path never enters an erotic-suggestion prompt. §8 forbids treating a disclosure as erotic material
anywhere in SelfOS; this spec does not carve an exception.

The suppression runs the other way unconditionally: a partner's coach can never suggest a word she has marked
`never`, with or without any steer.

**Your own data is always fully visible to you** (owner decision): your profile, every answer, every turn of
every take, with no relevance gate applied to your own screens — the gate governs what reaches a PROMPT, never
what you can read about yourself. There is **no cross-person reveal**: the Owner cannot read another person's
profile, because unlike a restricted intake fact there is no household-safety case for it and the steer already
carries everything useful to a partner's coach. **Never** tell a person an owner/admin can read this (the
durable rule).

### 8.5 This artifact is different

It is the most sensitive thing in the vault and it is also, by design, something a person may read aloud or show
a partner. Two consequences: the report is written to be read that way, and **deletion is complete** — results,
Insight, and the lexicon sections this test owns.

## 9. Accessibility

The word-bank grid is keyboard-operable with per-cell labels ("cunt — hear", "cunt — say") and never conveys
state by colour alone (the `✗ / ~ / — / ♥` marks are text). Line reactions are buttons with real labels, not
gestures. Spine bars + trends carry text equivalents (the `SubscaleBar` / `LineChart` precedent). Progress is a
polite live region; the crisis banner is announced. Responsive ~360px→desktop with no horizontal scrollbar and no
inner scroller — the word-bank grid collapses to one word per row at phone width. Reduced motion respected.

## 10. Testing strategy

- **Unit (core):** the word-bank scale + the three negative states; the boundary union on merge; a `never` never
  re-offered on a retake; `mapToSpine` rejects an AI-invented key; the stopping rule caps calls AND cost; a
  degraded phase still synthesizes; the saturation write is idempotent and lands `Intimacy:dirty-talk` in the
  ledger; the steer is gated on a live edge + both acks and **never emits a boundary reason or a probe answer**;
  the suppression holds with no steer at all.
- **Bridge (two-persona, decrypt-level):** a take writes an encrypted result + lexicon + Insight; the Insight is
  intimacy-gated (present in an intimacy context, **absent** from a money context, absent from the digest, absent
  from Together); a partner's prompt carries the steer but **never** an attribution phrase; a `never` word is
  absent from a partner's suggestion prompt; a Guest is refused; the 18+ gate withholds everything.
- **RTL:** the word bank renders + records both directions; the report renders + edits persist; AI-off shows the
  short-version path; the practice handoff carries the goal.
- **E2E (Playwright, `SELFOS_FAKE_CLAUDE`):** a full take → profile → **decrypt the vault** to assert the lexicon
  and the ledger entries; a retake versions and never re-offers a `never`; delete-all removes result + Insight +
  lexicon sections; 360px overflow guard on the word bank + report; the full surface renders to the bottom.

## 11. Open questions

### Resolved (2026-08-16 — asked one at a time, before drafting the build)

1. **Taboo fantasy (F18)** → **ships in v1**, and **nothing is gated at all** — no tier ceiling, no family
   opt-in. Private two-person household of consenting adults. The roleplay framing + hard limits stay (§8.1).
2. **Pacing** → a **two-pass bank**: pass 1 marks only what lands (🔥 / ✗ / ~), pass 2 asks the hear/say split on
   what was marked. ~500 entries without ~1,000 taps.
3. **Steer bound** → **everything travels**. Sole exception: crisis / trauma-flagged text (a safety rule,
   §8.4). As built it emits the DERIVED vocabulary + themes rather than raw probe text, and never a boundary
   reason — the suppression needs the boundary itself, not the why.
4. **Together** → the couples coach **may name a mismatch out loud**, framed as the pattern between them.
5. **Intimacy email** → **yes**, behind its existing double opt-in.
6. **Erotica book** → wired in the **same slice**, as the last commit, additive-only (§5.8).
7. **Anatomy variants** → **resolved from intake** via `activityRows`; asked in-take only when intake is empty.
8. **Break-glass** → **no cross-person reveal**; a person always sees ALL of their own data (§8.4).
9. **Depth** → **uncapped, confidence-based**. The budget still gates every call, plus a non-binding runaway
   backstop (§5.3).

### Still open

- ~~Retake cadence~~ → **RESOLVED (owner): the profile goes stale and prompts a retake.** After
  **`PROFILE_STALE_DAYS = 90`** the Tests hub card reads "worth a fresh look?" and a `dirty-talk-retake`
  recommendation provider surfaces one gentle Home invitation. 90 days on purpose — the same horizon
  `DORMANT_DAYS` uses for "when do we reconsider this ground", so the model has ONE answer for that question
  (spec 71 §5.9). It follows the wellbeing check-in's rules exactly (§8): a soft invitation, dismissible,
  **never escalating**, never a schedule, and it never fires for someone who has never taken it. A retake merges
  forward and never re-offers a `never`.
- **A "tonight" dial.** Desire moves with mood; a single stored profile is a snapshot. Worth a lightweight
  "tonight I want _\_\_" that temporarily biases the register? \_Recommendation: not v1 — see how the profile lands._

## 12. Changelog

- 2026-08-16 — **BUILT** on `feat/adaptive-tests-spec`, in a worktree off `origin/main` (the books session
  holds the shared checkout). Eight slices:
  **(1) the core** — `TestResult` widened ADDITIVELY with `kind`/`status`/`turns`/`profile`/`narrative`
  (absent `kind` ⇒ `'deterministic'` via `testResultKind`, so **no migration**); the bank type + builder; the
  Dirty Talk bank (~1,100 entries, 36 families, tiers 1–5, family-scoped stable slugs); the shared
  `EroticLexicon` (a `never` is permanent — no mark, split, merge or retake lifts it — and boundaries UNION
  on merge); the FIXED spine.
  **(2) the take** — start/resume/abandon, the two passes, `completeAdaptiveTake` (scores → result → Insight →
  saturation), and the ask-ledger write-back so the questionnaire planner stops mining `Intimacy:dirty-talk`.
  **(3) the adaptive half** — lines / probes / scenarios / synthesis, uncapped and confidence-based, with
  `openAmbiguities` as a DETERMINISTIC stop rule (the loop terminates on data, never on the model's opinion of
  its own certainty) plus the budget and a non-binding runaway backstop.
  **(4) the seam** — 13 channels behind ONE gate (`tests.own` + active person + the 18+ ack), view types in
  the crypto-free `schemas` so the sandboxed preload stays type-only.
  **(5) the renderer** — `/you` → `/tests` with redirects, the two-pass take, the report, live phase progress.
  **(6) the consumers** — own-words block, the silent partner steer, the unconditional suppression, Together,
  and the 90-day retake nudge.
  **(7) the erotica book** — additive-only, rebased immediately before, last commit.
  **(8) E2E + docs.**
  Gate green: typecheck (4 packages), lint, format, **2,272 core + 1,610 desktop** unit, and a decrypt-level
  E2E (ack → mark → split → complete with AI off → the report → the lexicon, the Insight and the ask ledger on
  disk → the `/you` redirect) with the §12 guard run against the bank grid mid-mark.
  **Four defects the build itself surfaced:** `testsResults` resolved ids against the deterministic catalog
  only, so an adaptive id skipped the 18+ gate; `testsAcknowledgeAdult` built its OWN catalog list, so the
  adaptive instruments vanished the moment someone acknowledged (caught by the E2E, not a unit test — both now
  share one `testCatalogFor`); a themed boundary could not be enforced by substring matching at all
  ("anything about being used" shares nothing with "I love using you"), so themes match on stemmed content
  words; and **visual QA caught the report calling an unmarked dimension "not their thing 0%"**, which tells
  someone something about themselves they never said — a no-signal dimension now reads `nothing yet` and is
  listed rather than charted.
  **As-built deviations from the draft:** `TestResult` is widened additively rather than made a discriminated
  union (far less invasive, and every existing consumer keeps its type); the AI phases start themselves on
  entry rather than waiting for a tap (otherwise the person lands on an empty screen after saying yes); and
  the steer carries everything EXCEPT crisis/trauma-flagged text, which is a safety rule rather than a privacy
  preference and is stated as such in §8.4.

- 2026-08-16 — created (Draft). Ten owner decisions locked in the brainstorm before drafting: build the adaptive
  ENGINE (not a bespoke test); coexist + seed with the five existing surfaces **but** saturate the topic; the
  partner path is a **silent steer** carrying **her own words verbatim** (informed privacy override, §8.4); hard
  nos **always suppress**; three results sharing **one lexicon**; the hub renames to **Tests** with wellbeing
  keeping its own nouns; a `never`/`not yet` split; and **per-context** register scoring.
- 2026-08-16 — nine further decisions, asked one at a time (§11): F18 ships and **nothing is gated**; a
  **two-pass** bank; **everything** travels in the steer except crisis-flagged text; Together **may name a
  mismatch**; the lexicon **may reach the intimacy email**; the **erotica book is wired in the same slice**
  (last commit, additive-only); anatomy **resolved from intake**; **no cross-person reveal** but a person sees
  **all** of their own data; and the adaptive half is **uncapped, confidence-based** (budget still gates every
  call). The bank grew to ~500 entries across 24 families on the owner's instruction — more explicit, more
  vulgar, tame → extreme.

---

## 13. Appendix — the bank (draft content)

The source of truth is `@selfos/core/tests/adaptive/instruments/dirtyTalkBank.ts` — the spec-49 shape
(`{ key, text, kind, family, tier, directions }`) so it groups, orders and renders exactly like the activity
matrix. **~1,100 entries across 36 families**, tier **1 (tame) → 5 (extreme)**, words AND the phrases people
actually say. **Nothing is gated** (§3.2): every family is visible from the start.

**Boundary (unchanged, and the only thing standing in front of any of it):** consensual adults; taboo strictly
as **pre-agreed, safeworded roleplay** between adults who both know that's what it is — that is where the
ravishment/CNC register lives (F18), worded as roleplay; never minors, never real non-consent, never illegal
acts. Carried by the content + the model, never a keyword filter.

Anatomy inside a phrase is resolved per person from the intake answers (`activityRows`), so _"stretch my pussy" /
"stretch my ass" /_ a neutral form render as appropriate.

**F1 · Anatomy — her body**
_t1_ down there · between your legs · your body · your chest · your curves · your waist · your hips — _t2_ pussy ·
tits · ass · nipples · clit · thighs · mouth · throat · breasts · bum · lips · collarbone — _t3_ cunt · asshole ·
hole · that ass · those tits · your slit · your opening · your cunt lips · your tight cunt · your little cunt ·
your holes — _t4_ your tight little ass · that greedy cunt · your slick cunt · your fuckhole · your dripping
hole · your puffy lips · your swollen clit · that soaking cunt · your perfect tits · those hard nipples · your
tight little hole · that fat ass — _t5_ your used cunt · your gaping hole · your used little hole · your ruined
cunt · all your holes

**F2 · Anatomy — his body**
_t1_ your body · down there · your hands · your arms · your chest · your thighs — _t2_ cock · dick · balls · your
mouth · your fingers · your tongue — _t3_ that cock · your hard cock · your load · precum · your shaft · your
tip · your cum · your thick cock · your tip leaking · your big dick — _t4_ fat cock · thick cock · every inch ·
that big fucking cock · your heavy balls · your veiny cock · your cock stretching me · that huge fucking dick —
_t5_ that cock that ruins me · that cock owns me · that monster

**F3 · State & sensation**
_t1_ warm · close · breathless · shaking · trembling · tingling — _t2_ wet · hard · aching · sensitive · tight ·
needy · desperate · swollen · tender · buzzing — _t3_ soaked · dripping · throbbing · clenching · twitching ·
pulsing · slick · quivering · slippery · rock hard · leaking · dripping wet · so hard it hurts · soaking
through · sopping — _t4_ gushing · stretched · full · sloppy · raw · sore · ruined · overflowing · creaming ·
dripping down my thighs · so full I can't breathe · stuffed · split open · drenched · stretched open · pounded —
_t5_ wrecked · destroyed · used up · fucked out · gaping · numb · spent · fucked stupid

**F4 · Names — affectionate**
_t1_ baby · babe · beautiful · gorgeous · sweetheart · honey · love · my love · angel · darling · my girl · my
everything — _t2_ pretty girl · handsome · my boy · sweet thing · beautiful girl · gorgeous girl

**F5 · Names — power & role**
_t2_ good girl · good boy · little one — _t3_ sir · ma'am · mistress · daddy · mommy · princess · kitten · pet ·
babygirl · boy · goddess · queen · my king · bunny — _t4_ master · owner · my property · my toy · plaything ·
doll · my pet · my good girl · my little whore

**F6 · Names — degrading**
_t3_ naughty girl · dirty girl · bad girl · filthy little thing · greedy girl · little tease · cocktease — _t4_
slut · my slut · little slut · whore · bitch · brat · dirty whore · needy slut · cock hungry · filthy slut ·
greedy little slut — _t5_ cockslut · cumslut · cumdump · fucktoy · fuckdoll · hole · pathetic little slut ·
worthless · my filthy whore · dumb slut · desperate little whore · breeding slut · anal slut · my cumrag ·
pathetic whore · good little fuckhole

**F7 · Claiming & possession**
_t2_ mine · you're mine · my girl · my boy · all mine — _t3_ you belong to me · nobody else gets this · say
you're mine · who do you belong to · say it · you're mine tonight · **own me** — _t4_ I own this pussy · this
cunt is mine · mine to use · you're my property · every hole is mine · say my name when you come · this ass is
mine · nobody else touches this · this mouth is mine · own me completely · claim me · make me yours — _t5_
_(roleplay)_ you don't get to say no to me · I'll do what I like with you · you're mine to ruin · I own every
part of you · you're my property to use

**F8 · Praise & worship — her**
_t1_ you're beautiful · you feel amazing · I love how you feel · you're perfect · you're amazing — _t2_ good
girl · that's it · just like that · you're doing so well · you feel incredible · god you're gorgeous · so good —
_t3_ you take it so well · look how well you're taking it · you were made for this · I love how you taste ·
you're so good at that · that's my girl · you're so fucking tight · you're so beautiful when you come · I love
watching you — _t4_ you take my cock so well · that's my good little slut · perfect fucking pussy · you were made
to take this · such a good girl for me · god you suck cock so well · your cunt was made for me · your mouth was
made for my cock · you take it like a good girl · you're perfect when you beg · that pussy is perfect — _t5_ best
fucking pussy I've ever had · you were built to be fucked · your cunt was built for my cock

**F9 · Degradation & humiliation**
_t3_ you love this, don't you · look at the state of you · you're such a mess · you can't help yourself — _t4_
dirty little slut · filthy girl · look how wet you get for me · you're leaking everywhere · beg like the slut you
are · you're pathetic when you want it · is that all it takes · look at you drooling for it · you're so easy ·
look how desperate you are — _t5_ you're just a hole · you exist for this · you'd take anything, wouldn't you ·
say you're my whore · thank me for it · look at yourself · you're nothing but a hole to fuck · dumb little slut ·
you love being used, don't you · you're a mess and you love it · beg properly · you're just something to fuck ·
say thank you for my cum

**F10 · Commands — general**
_t1_ come here · kiss me · closer · slower · look at me — _t2_ don't move · stay still · open your mouth · spread
your legs · hands above your head · turn around · bend over · on your knees · take it off · touch yourself · get
on the bed — _t3_ open wider · arch your back · don't look away · say my name · take it · don't stop · keep
going · be quiet · don't make a sound · let me hear you · show me · touch yourself for me · hold still · put your
hands here · spread wider · legs open — _t4_ crawl · hold your legs open · keep them open · take it all · don't
you dare stop · ask me nicely · hands behind your back · eyes on me · spread that ass · hold your ankles · bend
over further · keep still while I finish · say you're mine · tell me you're my slut — _t5_ gag on it · choke on
it · hold your breath · count them · don't spill a drop · present yourself · beg for my cock · keep your mouth
open · open your throat · take every inch

**F11 · Commands — orgasm control**
_t2_ come for me · let go · don't hold back — _t3_ not yet · hold it · don't come yet · wait · ask me first ·
come now · that's it, come · slow down · edge for me — _t4_ don't come until I say · you'll come when I tell
you · again · one more · ask permission · you can come now · good girl, come · come on my cock · hold it for me ·
you're not done · again, right now · squirt for me — _t5_ _(roleplay)_ you don't get to come tonight · hold it or
you'll be punished · you'll come when I'm done with you · you'll come until I say stop · come until it hurts

**F12 · Demands — the receiving voice**
_t1_ touch me · kiss me · closer · don't stop · keep going — _t2_ fuck me · harder · deeper · slower · right
there · just like that · I want you inside me · I need you · more · kiss me there · **taste me** — _t3_ fuck me
harder · pound me · **pound my pussy** · fuck me from behind · ride me · suck my clit · lick my pussy · eat me ·
finger me · use your mouth · put it in · give it to me · don't be gentle · get in me · rub my clit · fuck me
slow · grind on me · go deeper · hit that spot · **I want your cock in me** · shove it in · fill me — _t4_ **fuck
me in the ass** · **finger my asshole** · **choke me** · **stretch my pussy** · **stretch my ass** · **fill my
mouth** · **slap my pussy** · **beat my pussy** · **put it in my ass** · **cum in me** · **cum on me** · **cum in
my pussy** · **cum in my mouth** · **fill all my holes** · **I wanna choke on your dick** · pull my hair · spank
me · slap my tits · hold me down · spit in my mouth · come on my face · come on my tits · use me · make me beg ·
ruin me · breed me · fill me up · grab my throat · fuck my throat · stretch me open · finger me while you fuck
me · hold my hips · bend me over · take me from behind · fuck me harder than that · rub my clit while you fuck
me · fuck me raw · pin me down · make me scream · I want it rough · hold my legs back · put it back in — _t5_
wreck my pussy · choke me harder · treat me like your whore · use every hole · make me take it · fuck me till I
can't walk · destroy me · use me like a toy · split me open · I want to feel it tomorrow · fuck me until I cry ·
use my throat · don't be nice to me · ruin every hole · _(pre-agreed CNC, safeworded)_ don't stop even if I say
so

**F13 · Demands — the giving voice**
_t2_ come here · let me taste you · I want to watch · take it off · sit on me · **I wanna taste you** — _t3_
**suck that cock** · **suck my cock** · **lick my balls** · **lick my ass** · get on your knees · ride me · sit on
my face · open your mouth · take it · look at me while you take it · say my name · tell me who owns this · spread
them · bounce on it · play with yourself for me · put on a show · get it wet · spit on it — _t4_ swallow it ·
take it all · deeper · gag on it · beg for it · tell me what you are · hold still while I use you · arch for me ·
give me that ass · choke on my cock · take my load · open wider · take it deeper · hold it there · look up at
me · suck my balls · milk it · take every inch · squirt for me · **I'm gonna cum in your pussy** · **I'm gonna
cum in your mouth** · say you're my little slut — _t5_ _(roleplay)_ you'll take what I give you · open up, I'm
not done · you'll take it till I'm finished · beg me for my cum · **I wanna feel your juices explode around my
cock**

**F14 · Narration & feedback**
_t1_ that feels amazing · I love this · you feel so good — _t2_ you're so wet · you're so hard · you're so tight ·
**you're so big** · god you fill me · I can feel you · you feel incredible — _t3_ **I can feel you throb** · I can
feel you clenching · you're dripping down my hand · listen to how wet you are · look how hard you make me · I'm
going to come · I've been hard all day · I can still taste you · you're shaking · you're squeezing me · I can
hear how wet you are — _t4_ your cunt is soaking · I can feel you tightening around my cock · you're leaking all
over me · I'm going to fill you · watch it go in · look at you taking every inch · you're so fucking wet for me ·
your pussy is gripping me · you're taking it so deep · your ass is so tight · I can feel you stretching around
me · you're throbbing on my cock — _t5_ listen to that · you're making such a mess · I can feel your cunt begging
for it · you're gushing · look how well that little cunt takes it

**F15 · Begging & permission**
_t2_ please · I need it · please don't stop · I want it — _t3_ please fuck me · can I come · may I come · please
let me · I need you inside me · I'm so close · please, more · please give it to me — _t4_ please sir · please
daddy · please let me come · I'll be good · I'll do anything · please use me · may I touch myself · please fill
me · I need to come · please cum in me — _t5_ thank you · thank you for letting me · thank you for using me ·
please, I'll be your good little slut · I'm begging you · please, I need your cum

**F16 · Sexting & anticipation**
_t1_ thinking about you · can't wait to see you · I miss you — _t2_ I've been thinking about last night · what
are you wearing · I want you tonight · come home · are you alone — _t3_ I'm so hard thinking about you · I'm wet
just typing this · tell me what you'd do to me · send me one · I've been thinking about your mouth all day · I'm
touching myself · describe it — _t4_ I've been thinking about your cunt all day · I'm going to ruin you tonight ·
I want you on your knees when I get home · I'm fucking you the second you walk in · don't touch yourself until
I'm home · I want you dripping before I get there · I'm going to fill you tonight · I want your cock the second
you're home — _t5_ I'm going to use every hole tonight · you'd better be ready for me · I'm going to fuck you
until you can't stand

**F17 · Aftercare & tenderness**
_t1_ come here · I've got you · that was perfect · you did so well · I love you · stay right there · you're
incredible · thank you — _t2_ good girl · you were so good · are you okay · let me hold you · I'm proud of you ·
you're safe · you took that so well · let me clean you up

**F18 · Taboo fantasy & roleplay** _(t5 — every entry is **pre-agreed, safeworded roleplay between consenting
adults**, labelled as roleplay in the UI and in every prompt. This is where the ravishment/CNC register lives.)_
**CNC / ravishment** _("take it", "you don't get a choice", "I'm not asking", "fight me", "stop struggling",
"rape me", "I'm going to rape you", "I'm going to take what I want", "you're not getting away")_ · **stranger**
_("you don't even know my name")_ · boss/employee · teacher/student _(adults)_ · doctor/patient · **cheating**
_("does he know you're here", "we shouldn't be doing this")_ · **cuckold / hotwife** _("tell me what he did to
you", "did you let him finish", "did he fill you")_ · **breeding** _("I'm going to breed you", "you're taking
every drop", "I'm putting a baby in you")_ · **primal** _("run", "I'll catch you", "found you")_ · age-gap
_(adults)_ · **objectification** _("you're furniture tonight", "you're just a hole to use")_ · caught in the act ·
sex-worker roleplay · being shared

**F19 · Delivery & voice** _(how it's said, not what)_
whispered · in my ear · low and slow · growled · commanding · breathless · loud · filthy but smiling · silent,
just sounds · narrating the whole time · a single word at the right moment · saying my name · moaning · telling
me what you're about to do before you do it · through gritted teeth · laughing · right against my ear · loud
enough that they'd hear · begging under your breath

**F20 · Oral**
_t2_ suck me · lick me · use your mouth · taste me · kiss me there · kiss it — _t3_ eat my pussy · suck my cock ·
lick my clit · suck it · put it in your mouth · sit on my face · lick me clean · get it wet · lick it slowly ·
swallow me · **lick my balls** · **suck my balls** · **lick my ass** · tongue me · suck it harder · lick my clit
faster — _t4_ deepthroat it · gag on it · choke on my cock · take it all the way · fuck my face · face-fuck me ·
swallow it · don't spill it · look at me while you suck it · worship it · don't stop until I come in your mouth ·
hold it in your mouth · **fill my mouth** · **cum in my mouth** · rim me · tongue my ass · spit on it · use your
throat — _t5_ use my throat · make me gag · leave me drooling · fuck my mouth like a pussy

**F21 · Anal**
_t2_ touch me there · play with my ass — _t3_ finger my ass · finger my asshole · lick my ass · rim me · put a
finger in · slowly · work it in · spread my ass — _t4_ **fuck my ass** · **put it in my ass** · **stretch my
ass** · take my ass · in my ass · plug me · pound my ass · all the way · take it deeper · **cum in my ass** ·
finger my ass while you fuck me · spit on my ass · fuck my ass raw — _t5_ ruin my ass · both holes · use my ass
like a pussy · **fill all my holes** · destroy my ass

**F22 · Cum & finishing**
_t2_ come for me · I'm close · I'm going to come — _t3_ **cum in me** · **cum on me** · come with me · I want to
feel you come · make me come · finish in me · inside me · where do you want it — _t4_ **cum in my pussy** · **cum
in my mouth** · **cum in my ass** · fill me up · come on my face · come on my tits · come on my ass · come on my
back · swallow it · come all over me · breed me · paint me · give me your load · don't pull out · in my throat ·
let me taste it · don't waste a drop · give me every drop — _t5_ make a mess of me · I want to be dripping with
it · put it back in after · fill both · I want it leaking out of me · **fill all my holes**

**F23 · Impact, restraint & pain** _(verbal)_
_t2_ harder · pull my hair · hold me down — _t3_ spank me · slap my ass · grab my throat · pin me · bite me ·
scratch me · squeeze · harder than that · again · **spank me daddy** — _t4_ **choke me** · **slap my pussy** ·
**beat my pussy** · slap my tits · slap my face · mark me · leave a bruise · tie me up · hold my wrists · harder,
I can take it · hold me down while you do it · choke me while you fuck me · spank me while I ride you — _t5_
choke me harder · hurt me a little · make it sting · don't be careful with me · leave marks I'll see tomorrow

**F24 · Being watched / shared** _(verbal)_
_t3_ I want to watch you · watch me · look at us · imagine someone seeing this · tell me a fantasy — _t4_ would
you let them watch · tell me what he did · I want to watch someone else make you come _(fantasy)_ · what if
someone walked in — _t5_ _(roleplay)_ tell me how he fucked you · I want to see you take someone else · did you
let him cum in you

**F25 · Praise & worship — him**
_t1_ you feel so good · I love your hands · I love your mouth — _t2_ you're so hard for me · you feel huge · I
love your cock · you're so good at that — _t3_ you fuck me so well · nobody fills me like you · **you're so
big** · I love how you use me · you know exactly what you're doing · god, that cock · **your dick is huge** —
_t4_ your cock ruins me · you fuck me better than anyone · you make me forget my name · you fill me completely ·
I love how you take what you want · **your dick is too big for my little cunt** · I love how you use my holes —
_t5_ I'd let you do anything to me · you own this pussy

**F26 · Toys & objects**
_t2_ use it on me · get the toy · use your fingers and it — _t3_ fuck me with it · hold it there · turn it up ·
put it inside me · use it while you watch — _t4_ both at once · put the plug in · leave it in · make me come with
it while you watch · fuck me with it until I beg · one in each hole — _t5_ don't stop till the toy's done with me

**F27 · Public & risk**
_t2_ be quiet · someone might hear · not here — _t3_ they'll hear us · right here · don't stop, someone's
coming · keep your voice down · quick, before they're back — _t4_ hold still, don't make a sound · take it right
here · nobody knows what you're doing · under the table · in the car — _t5_ let them hear

**F28 · Teasing & denial**
_t2_ not yet · you want it, don't you · patience — _t3_ ask me nicely · say please · you'll get it when I
decide · look how badly you want it · almost · I could keep you like this all night — _t4_ beg me · maybe I'll
let you · not until you've earned it · you'll wait · ask again, properly · tell me how badly you want my cock —
_t5_ I could stop right now · you'll take what I decide to give you

**F29 · Consent & check-ins** _(the language that makes the rest safe to want — rated the same way, because for
a lot of people being asked IS part of it, and for others it breaks the spell)_
_t1_ is this okay · you okay · too much? · more? · do you like that — _t2_ tell me if it's too much · you can stop
me · colour? · green / amber / red · say the word and I stop · we can stop any time — _t3_ do you want more ·
harder? · can I · do you want me to stop · is this still good · tell me what you need — _t4_ you did so well, are
you alright · was that too far · come back to me

**F30 · Comparisons & ego**
_t2_ nobody does that like you — _t3_ nobody fucks me like you · I've never come like that · you're the best I've
had · no one's ever made me feel like this — _t4_ you ruined me for anyone else · I don't want anyone else · I've
never done that with anyone else · you're the biggest I've had · nobody's ever filled me like this

**F31 · The morning after / next day**
_t1_ I'm still thinking about last night · last night was incredible — _t2_ I'm still sore · I can still feel
you · I woke up wanting you · I didn't sleep — _t3_ I'm sore in the best way · I could still taste you this
morning · I've been thinking about it all morning — _t4_ I want it again before work · I'm still dripping from
last night · I can still feel where you were · I'm still leaking you

**F32 · Size & fit**
_t2_ you're big · you feel huge · it's a lot — _t3_ **your dick is huge** · you're so big · I can feel every
inch · you're stretching me · it barely fits · go slow, you're big — _t4_ **your dick is too big for my little
cunt** · you're splitting me open · I can't take it all · take it all anyway · make it fit · you're too big for
my ass · stretch me around it — _t5_ ruin me with it · I don't care if it doesn't fit

**F33 · Squirting, wetness & mess**
_t2_ I'm so wet · look how wet I am — _t3_ **I wanna squirt all over you** · make me squirt · I'm going to
squirt · I'm soaking · you're making me drip — _t4_ squirt for me · soak me · look what you did to me · I'm
soaking the sheets · you made a mess of me · I'm dripping down my legs — _t5_ I want to ruin the bed · make me
squirt until I can't take it

**F34 · Taste & fluids**
_t1_ kiss me — _t2_ **taste me** · **I wanna taste you** · let me taste — _t3_ lick it off · lick my fingers ·
taste yourself on me · I love how you taste · get it on your tongue — _t4_ spit it in my mouth · share it · kiss
me after · lick it off my tits · don't swallow yet — _t5_ let me lick you clean

**F35 · Role-name lines** _(the name in a whole phrase, which is what people actually say)_
_t2_ yes sir · yes ma'am — _t3_ **oh daddy** · yes daddy · please daddy · thank you daddy · yes mistress · please
sir · thank you sir — _t4_ **spank me daddy** · fuck me daddy · harder daddy · deeper daddy · I'm your good girl
daddy · cum in me daddy · yes daddy, I'm yours — _t5_ use me daddy · I'll be good for you daddy

**F36 · Self-labelling** _(claiming it about yourself — different from being called it, and often a bigger step)_
_t2_ I'm yours · I'm all yours — _t3_ **I'm your little slut** · I'm your slut · I'm your good girl · I belong to
you · I'm your dirty girl — _t4_ I'm your whore · I'm your fucktoy · I'm your cumslut · use me, I'm yours · I'm
your hole · I exist for your cock — _t5_ I'm nothing but your fucktoy · I'm your worthless little slut
