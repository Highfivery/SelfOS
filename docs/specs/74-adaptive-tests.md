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

> **§3.6 supersedes the PRESENTATION below** (2026-08-16): the bank is walked one area per screen with a
> hand-authored example under every term, oriented to who is speaking to whom, and the middle mark now means
> "it's okay" rather than "not yet". What a mark MEANS to safety is unchanged. Read §3.2 for the model and
> §3.6 for what is on screen.

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

Each entry is rated in **both directions** — hear and say — because what you love to hear and what you can get out of your
own mouth are completely different things, and that gap is the most useful thing this test finds. (§3.6.4
narrows this: an ORIENTED entry carries one rating, on the side it belongs to, and §3.6.6 is what keeps the
unshown side from reading as "cannot say it".)

|             | HEAR | SAY |
| ----------- | ---- | --- |
| `cunt`      | ♥♥♥♥ | ✗   |
| `good girl` | ♥♥♥♥ | —   |
| `whore`     | ✗    | ✗   |

Scale: `Ban` never · `Contrast` it's okay · `—` nothing · `Flame` 0–4. **Two states, three marks** — the
`~ not yet` state below is **SUPERSEDED by §3.6.2**:

- **`✗` never** — permanent. Suppressed everywhere, never re-offered on a retake, and **no reason is ever
  asked**. Requiring someone to justify a no is itself coercive (§8.2).
- ~~**`~` not yet** — "makes me cringe / I'd feel like an idiot".~~ **SUPERSEDED by §3.6.2**: the middle mark
  now means "It's okay", a mild yes that feeds no goal. The cringe signal is no longer captured by a mark at
  all; the goal signal comes from the hear/say gap (§3.6.6).
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

A free write-in per family ("your words — anything we missed"). **As built — SUPERSEDED by §3.6.3:** both
anatomical forms ship as entries and everyone sees both. §3.6.3 replaces that with the `body`/`addresses`
resolver; entries matching neither side are withheld, counted and stated (§3.6.5). Rewriting a phrase's
anatomy in place is NOT the mechanism and was never built.

Each entry declares its sensible **directions** — most demands are `both` (she says _"fuck me harder"_, he hears
it), a few are one-way (_"good girl"_ is rarely a thing you say about yourself) — so the grid never asks a
nonsense question.

This phase alone is shippable value: no AI, no cost, and already better than the free-text box.

**Phase 2 — Line reactions.** ONE batched model call writes ~12 complete lines, seeded by phase 1 + the seeds in
§5.4, each tagged internally with register + heat. The person marks it with the same three lucide marks as the deck — `Flame` / `Contrast` / `Ban` (§3.6.1 #5;
the emoji here are superseded, and `AdaptiveTake.tsx:395` still renders them).

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

> **§3.6.2/§3.6.6 amend the SOURCE of "What you can't say yet"**: it renders from `state === 'notYet'` today
> (`AdaptiveReport.tsx:218`), which the middle-mark change empties. Slice 4 re-sources it from the hear/say
> gap, and only for entries where both sides were shown.

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

#### 3.3a The report, redesigned (2026-08-18, owner-requested, mockup approved first)

As built, the report was the longest and least useful thing the test produced: a wall of several hundred
chips — every loved line, every mild yes, every hard no struck through — under two thin bars, with the AI
prose as an undifferentiated Markdown block on top. A person who has just made hundreds of marks does not
want to read their marks back.

It now **leads with what it means** and keeps every list behind a disclosure:

- **A hero** carrying the synthesis's `lede` at reading size — one claim, in serif, the only line on the page
  set that way. `lede` is its own field rather than the narrative's first paragraph, because pulling the
  opener out of the prose works until the model opens with a throat-clear, and then the loudest line on the
  page is filler. A take from before the field existed falls back to that first paragraph, so it still opens
  on a sentence.
- **"Why this, probably"** — 2–4 keyed `readings` (`pattern` / `gap` / `suggestion`), each hedged, each able
  to name the **source** elsewhere in SelfOS it echoes. The synthesis is given a bounded digest of the
  person's own-subject insight facts to read against; with no signals on file, a source is **dropped in code**
  rather than trusted to the instruction — an invented citation is worse than none.
- **A two-up grid**: the shape of it (strongest five, the rest folded, no-signal dimensions listed and never
  charted) and the hear/say gap, which is the finding the test exists to produce and was previously a chip
  list halfway down.
- **Every long list folds** after twelve, and **a hard no is one sentence** ("N off the table") with a
  disclosure — a boundary is a boundary, not a result to display at length.
- **"Where this gets used"**, on the page, because the profile is not a document: it changes what the rest of
  the app says to them, and a person who cannot see that reads the screen as a record of what they tapped.

The report **may interpret** ("you respond to being claimed, not degraded") — clearly labelled as a reading of
what they answered, never a verdict (§8.1). It is second-person, in their words, never clinical labels.

### 3.4 Editing

Every part of the lexicon is editable in place: add a word, move one between states, fix a mis-read line, edit
the prose. It is _their vocabulary_; an AI reading of it is a draft. Edits write straight to the `EroticLexicon`
(not the result — the result is the dated record of what they answered on the day).

#### Autosave — the take is never a form you have to finish

**Every tap persists on its own** (a ~700ms debounce, so a run of taps is one write). Nothing about a take
waits for a Next button, and there is no "finish it in one sitting" — the bank alone is ~1,100 entries, so
treating it as a form to complete would be the wrong shape twice over: it would lose a long pass to a crash,
and it would tell someone they have to keep going when the honest answer is that partial marks are already
useful. The take says so on screen: _every tap saves itself · move on whenever · come back for the rest_.

Three things this rule drags in, each of which is a defect if skipped:

- **Un-marking has to reach the store.** Once a tap is written before it can be reconsidered, a mis-tapped `Ban` mark
  would be a permanent boundary they never meant. So the pass sends `cleared` alongside `marks`, and
  `clearMarks` reverses the state, the seeded ratings, and the boundary. This is not §3.2's "a boundary lifts
  only by an explicit act" being widened — un-marking **is** that act, by the same person, on a mark made in
  **this take**.

  That scope is **structural, not a UI convention**, because the renderer is not the trust boundary: every
  mark records its take (`source: test:<resultId>`), un-marking only touches entries carrying the CURRENT
  take's source, and the take must still be the open draft. A crafted `cleared` naming an earlier take's
  boundary — or replaying a completed take's id, which the renderer holds in `history` — clears nothing.
  It cannot be walked around by re-marking a hard no first either, because `applyBankMarks` skips a `never`
  entry **before** the write, so a boundary can never be re-stamped with a newer source.

- **A boundary made in THIS take stays editable.** §3.5 renders a `never` from an earlier take as settled and
  un-offerable. Applied to a mark made seconds ago it would freeze a mis-tap in place — and scoping the
  exemption to the current _sitting_ rather than the current _take_ would strand a mis-tap noticed tomorrow
  with no way to fix it until the take completes, on a feature whose whole point is coming back tomorrow.
- **An autosave does not stamp a turn.** `turns` is the record of what was actually _asked_; a turn per tap
  would put ~1,100 of them in one result and make that record worthless. Only closing a pass stamps.

Resuming picks up at the furthest phase reached (`resumePhase`), not at the top of the bank — otherwise the
promise on screen is a lie the second time they open it.

### 3.5 Retakes, deletion, and the practice handoff

Retake = a new dated result + a trend point; the lexicon is **merged forward**, and a `never` is never
re-offered (an `okay` is — §3.6.2). Delete-one re-derives from the latest remaining result; delete-all removes the
results, the derived Insight, **and** the lexicon sections this test owns — deletion has to be real here (§8.5).

The report's **"Practise this"** button starts the existing `dirty-talk-practice` guided session with the goal
pre-loaded, so the guided session stops opening on "what do you want to be able to say?" when the app already
knows.

### 3.6 The bank pass, redesigned — AMENDMENT (2026-08-16, owner-requested, mockup approved) — **BUILT**

> **Supersedes** the pass-1/pass-2 presentation in §3.2 and the two-pass claim in §11 resolved #2. The
> boundary rules (§8.1/§8.2), the 18+ gate, the taboo framing, the crisis handling and the autosave contract
> (§3.4) are **unchanged** — this changes what is shown and how it is asked, not what a mark means to safety.

The owner, on first sight of the built pass: _"it's overwhelming with a ton of terms — which is good to have,
but needs to be presented much better and have like a short quote for each in how it's used."_ Then, separately:
_"make it smarter so if the person is a guy and straight it shows ones that he likes to hear and likes to say,
and vice versa for a girl."_

**Measured before designing** (not estimated): **1,033 entries · 36 families · median 26 per family**, tiers
`1:76 · 2:159 · 3:287 · 4:343 · 5:168`. So half the bank sits at the intense end, and the median area is a
comfortable screen — the size was never the problem.

Four distinct causes, and a quote only fixes one:

1. **Volume** — 36 families in one scroll, no sense of position, progress, or remaining.
2. **Context** — `hole`, `mine`, `brat`, `cumslut` out of context are a vocabulary list. You cannot react to a
   word; you can react to being spoken to.
3. **Uniformity** — 1,033 identical rows with three identical buttons, optimizing for the _rare_ action. Most
   entries get no mark, so the common interaction is scanning past, which should be free.
4. **Orientation** — a straight man was being asked to rate `your cunt` in the hear direction and `good girl`
   in the hear direction. Roughly half the bank could never be said to him or by him.

#### 3.6.1 The seven decisions (owner, asked one at a time)

| #   | Decision                                                                                   | Why this one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A hand-authored example quote** per fragment; complete lines show none                   | Templates break exactly where the term is unusual (`"I want to feel your down there"`), which is where the example matters most                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | **One area per screen** — a deck of 36, with progress and a one-tap skip                   | Turns an endless scroll into ~26 rows, and makes stopping read as progress rather than abandonment                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3   | **No pre-filter** — order areas broad-first, niche-last                                    | The test exists to DISCOVER; pre-excluding an area sight-unseen means never finding out. Ordering buys the speed without the cost. Needs **no new field** — `Bank.families` is already an ordered array and `buildBank` preserves declaration order, so this is a re-ordering of the `bankFamily(...)` blocks. What IS missing is the per-area one-line description the deck needs: `BankFamily.note` exists but is optional and mostly unset, so slice 3 fills it — content, alongside the quotes |
| 4   | **Nothing hidden** — every tier on screen, ordered gentle → extreme, with an intensity pip | Matches the standing "gate nothing" posture; the pip is information, not a reveal                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | **Three marks, lucide icons only** — `Flame` / `Contrast` / `Ban`                          | `AdaptiveTake.tsx:291` renders `🔥 / ~ / ✗` — one emoji plus two text glyphs; the line reactions (`:395`), the instructions (`:215`) and the settled-boundary row (`:266`) are emoji too and are all in scope. `Ban` (circle-slash) reads as a boundary where a bare X reads as "close"                                                                                                                                                                                                            |
| 6   | **The middle mark means "It's okay"** — a mild yes, not "not yet"                          | See §3.6.2 — this is a model change, not a relabel                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | **Oriented to the person** — body from intake anatomy, address asked in-take               | See §3.6.3. Inferring from gender + orientation is the exact conflation that broke #62. NB the anatomy answers exist but **nothing in `tests/adaptive` reads intake today** (§5.4's seeds are unbuilt) — slice 1 adds that read                                                                                                                                                                                                                                                                    |

#### 3.6.2 The middle mark changes meaning

`~ not yet` ("makes me cringe / I'd feel like an idiot") becomes **"It's okay"** — fine, works, not a
favourite. That is a **different signal**, so:

- `LexiconState` is `'never' | 'okay'`. New marks only ever produce `okay`.
- **The middle mark no longer feeds `derivedWantsToSay`.** A mild yes is not a goal. The goal signal moves
  wholly to the hear/say **gap** — loved to hear, rated low to say — which is stronger for being derived from
  two answers rather than one. **But the gap needs both answers**, and §3.6.4's collapse removes one of them
  for every oriented entry: see **§3.6.6, which is a prerequisite of this change, not a follow-up.**
- **Two probe inputs go with it.** `engine.ts:76` (the "they flinched at these" context line) and
  `engine.ts:131` (the `cringe` probe — the code calls it "the most coachable signal in the take") both read
  `notYet` and would silently never fire again. Both re-source from the gap set in slice 1; an empty probe
  pack is invisible, so nothing would report the loss.
- The negative side is unchanged: `never` is still permanent, still suppressed everywhere, still never
  re-offered, still asks no reason (§8.2).

**Legacy `notYet` values.** The semantics genuinely differ, so this is a real coercion, not a rename: on read,
`notYet` → `okay`, and it stops contributing to goals. The negative side is untouched.

**The blast radius is small by construction**, which is a better argument than "the population is ~0":
`completeAdaptiveTake` persists the derived goals onto the lexicon (`adaptiveService.ts:302`) and
`derivedWantsToSay` UNIONS with that persisted list (`lexicon.ts:432`), so a COMPLETED legacy take keeps every
goal it produced. Only a `notYet` sitting in an unfinished draft loses its contribution.

**If you want the count anyway** it needs a main-process decrypt — the master key is under Electron
`safeStorage`, so no plain node script can read a lexicon. Either temporarily log
`(await readLexicon(fs, key, personId)).entries.filter((e) => e.state === 'notYet').length` from the
`testsAdaptiveState` handler and open the Tests hub once per person, or accept the blast radius above. A
key-free `ls people/*/tests/lexicon.enc` is NOT a proxy: `recordBankPass` writes a lexicon on the FIRST
autosave, so an abandoned draft leaves one behind.

**The rename is five declarations, not one**: `LexiconStateSchema` (`schemas.ts:1090`), `BankMark`
(`lexicon.ts:81`), the two bridge input enums (`coreBridge.ts:1153`, `:1188`), the channel contract
(`channels.ts:2411`), and the store's `BankMark` (`adaptiveTestStore.ts:22`).

#### 3.6.3 Orientation — what could actually be said in your bed

Two independent axes, each split by direction. Getting this from `gender` + orientation is forbidden: the
onboarding activity matrix did exactly that and issue **#62** was the result — it conflated who-you-date with
what-they-have, was wrong for trans and non-binary people, and orphaned prior ratings when someone edited
their gender. The fix then was to **ask anatomy directly**, and those answers already exist.

| Axis        | Example terms                    | Source                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Body**    | `your cunt`, `your cock is huge` | `ownAnatomy` / `partnerAnatomy` from the intake intimacy section, via `activityContext.activityRowContext` — already collected, never re-asked. **The answers are LABELS, not enums**, so slice 1 states the mapping: `Cock (penis)`→`penis`, `Pussy (vulva)`→`vulva`, `Both or intersex`→`either`; `Rather not say` / `Don't mind` / unset / unrecognized → **`either`, never a withhold** |
| **Address** | `good girl`, `my boy`, `brat`    | **Asked in-take**, two taps (§3.6.4). Recorded nowhere today, and NOT derivable from anatomy: a trans woman may absolutely want "good girl"                                                                                                                                                                                                                                                 |

`BankEntry` gains both as optional tags — absent means universal:

```ts
interface BankEntry {
  // …existing
  /** One short line showing it in use. Absent when the entry is already a complete utterance. */
  example?: string;
  /** Who the line is aimed at. Absent ⇒ addresses anyone. */
  addresses?: 'girl' | 'man' | 'either';
  /** Whose anatomy it names. Absent ⇒ names no one's. */
  body?: 'penis' | 'vulva' | 'either';
}
```

**The resolver** (pure, unit-testable, no AI):

- Shown on the **HEAR** side when the entry addresses _me_ and names _my_ body (or names no body).
- Shown on the **SAY** side when it addresses _my partner_ and names _their_ body.
- `either` on an axis satisfies both sides; an `either/either` person sees both sides for everything.
- Matching neither side ⇒ **withheld**, counted, and said out loud (§3.6.5).
- **Absent or non-committal on an axis ⇒ `either`, never a withhold.** `Rather not say`, `Both or intersex`,
  `Don't mind`, unset, and anything unrecognized all fail **open**. Withholding by default would give someone
  who declined to answer a thinner test with no way to know why — the exact §3.6.5 failure — and it mirrors
  `resolveOral`'s existing "never guess → neutral" rule (`activityRows.ts:97`).

**Orientation is a display filter and nothing else.** It is never written to the lexicon, never a boundary,
and never suppresses anything downstream. Changing the answer re-shows everything; no mark is lost. That
distinction is load-bearing — a `never` is permanent and this deliberately is not.

#### 3.6.4 The shape of the take after this

**Phase 0a — two taps** (new, before the deck; skipped when already answered on a retake):

```
When someone talks to you like this, you're…   [ their girl ] [ their man ] [ neither · both · depends ]
And the person you're saying it to is…          [ a girl ]     [ a man ]     [ neither · both · depends ]
```

Stored on the lexicon (`EroticLexicon.address = { self, partner }`), so Fantasy and Sex Sessions inherit it
and never ask again. Three additive pieces slice 1 must name, because nothing carries it today:
`EroticLexiconSchema.address` (optional `{ self, partner }`, each `'girl' | 'man' | 'either'`, absent ⇒
unasked, `.catch(undefined)` like every other lexicon field); a `{ kind: 'setAddress' }` arm on
`AdaptiveLexiconEdit`; and — because §3.6.5 promises a route back — an affordance that re-opens phase 0a
mid-take, not only on first run. Changing it re-runs the resolver and re-shows; it writes no mark and lifts
no boundary. Anatomy is **not** re-asked; when intake has none, §11 resolved #7 already covers asking
in-take.

**Phase 1 — the deck.** One area per screen: progress rail (`Area 4 of 36`), area title + its own one-line
description, the terms in a single column as `term → quote → marks`, then `Skip this area` / `Next area`. The
quote is the widest column, not a subtitle under the term — that keeps the row one line tall and puts the eye
on the sentence.

**Phase 2 — the hear/say split largely COLLAPSES.** Once an entry is oriented its direction is implied, so it
carries **one rating on the side it belongs to**, inline in the deck. The separate split screen survives only
for `either/either` entries, which need both. This is the second reduction: the take gets shorter twice over.

#### 3.6.5 Withheld terms are stated, never silently dropped

Each area that hides entries says so, with a count, a reason, and a route back:

> _14 terms in this area are things said to a girl about her body — not shown, because nobody is saying them
> to you. Change that in **Before we start**._

An invisible filter would be the worse failure here: on a test whose whole point is discovery, you would only
notice by wondering why an area felt thin.

The count comes from the **pure resolver**, returned with the area — not from the renderer counting empty
rows — so the note and the rendered rows can never disagree. Slice 5 asserts it on the resolver: for a fixed
person and area, `shown + withheld === the area's entry count`.

#### 3.6.6 The collapse needs a third value: NOT APPLICABLE

**This is a prerequisite of §3.6.4, and I had it wrong.** `say: 0` today does not mean "not asked" — every
derived signal reads it as _cannot say it_. Once orientation means an entry is only ever SHOWN on one side,
the unshown side silently becomes that same 0, and three things break at once:

- `derivedWantsToSay` (`lexicon.ts:428`, `hear >= 3 && say <= 1`) turns **every loved hear-only entry into a
  goal the person never declined** — and goals reach their own coach prompt AND a partner-shared Insight fact
  (`adaptiveService.ts:379`). That is the worst of the three: it invents wants and shares them.
- `sayConfidence` (`spine.ts:163`) averages `say / 4` over everything loved-to-hear, so `.say-confidence`
  floors for everyone.
- `.receiving-voice` / `.giving-voice` are `direction: 'say'` (`spine.ts:83`, `:92`) and `meanOf` counts a
  hear-only mark as "marked" (`spine.ts:139`), so both dimensions floor too — the same "not their thing, 0%"
  failure visual QA already caught once on this feature.

So the shown sides must be **recorded, not inferred from a zero**. `LexiconEntry` gains
`sides?: ('hear' | 'say')[]` — which sides this person was actually asked — and:

- `derivedWantsToSay` reads the gap only when BOTH sides were shown; a hear-only entry contributes no goal.
- `sayConfidence` and every `direction: 'say'` dimension restrict to entries whose `sides` include `say`, and
  report `NO_SIGNAL_BAND` when that set is empty rather than 0.
- `sides` is written **by the take** (it is a record of what was asked), never by the resolver at read time —
  a later orientation change must not retroactively rewrite what a past take asked.

Consequence for §3.6.2, stated honestly: the goal signal does **not** survive intact for oriented entries. It
survives for `either/either` entries and for whatever reaches the surviving split screen. Without `sides`,
dropping the middle mark's goal contribution would leave the goal list _fabricated_ rather than merely thinner.

#### 3.6.7 Build slices

1. **Model + resolver** — `example`/`addresses`/`body` tags, `EroticLexicon.address`, the `okay` rename and
   its goal-derivation change, the pure orientation resolver. No UI.
2. **The quotes** — ~400 hand-authored lines. The bulk of the work, and content, not code.
3. **The deck** — phase 0a, one-area-per-screen, lucide marks, the withheld note, the tier pip.
4. **The collapse** — one rating inline; the split screen reduced to the `either/either` remainder; report and
   `DirtyTalkProfile` reconciled.
5. **Guards** — resolver truth table, a withheld-count assertion, the §12 overflow guard at 360px on the deck,
   and an E2E walking an oriented take end to end.

### 3.6.7 The practice sheet — two taps before the deck opens (2026-08-17, owner-requested, mockup approved) — **BUILT**

The §3.6.3 direction band and the §3.6.4 row hierarchy both landed, and the owner still said the word-vs-phrase
rule "gets a bit lost". Three attempts at fixing it in copy failed the same way, and the third drew the sharpest
correction of the whole feature: _"you just changing some text and capitalizing it IS NOT AN IMPROVEMENT."_ Then:
_"the very first thing they read and eyes get drawn to to be: You're marking the word, not the phrase."_

So the rule stops being copy on the deck and becomes a **practice** the deck sits behind:

1. **The rule is the headline** — first element, largest type on the sheet, `word` underlined in warm, and
   **repeated identically on both beats** so it cannot scroll away. It is a standing fact about ~1,000 rows, not
   a caption on one example.
2. **Two beats, one per direction.** Beat one is `You → Them`, beat two flips to `Them → You`. Watching the band
   change is what teaches "this varies per area"; a sentence saying so is what was already being skimmed.
3. **The taps are REAL marks.** Both words are actual bank entries, picked by the same orientation the deck uses,
   filtered to `kind: 'word'` **with** a quote (a phrase-family entry — which IS the whole line — would
   demonstrate the opposite of the rule above it) and sorted by tier, so the first thing anyone ever sees in this
   test is a tier-1 word. Each tap autosaves like any other, and the running tally behind the scrim visibly
   increments — the person sees their practice count rather than being asked to warm up for nothing.
4. **Required, not dismissible.** `Start marking` is disabled until the last beat is answered; in a browser the
   scrim genuinely covers the rows, so the deck cannot be reached around it. That is the whole difference between
   a practice and a notice.
5. **Once ever, not once per sitting.** It is owed only when the person has marked _nothing at all_ — which,
   because the taps are marks, can never become true again. A retake or a resumed take opens straight into the
   deck. No new persistence, no new field.
6. **Nothing unexplained on it.** An earlier mockup carried two step-dots; the owner asked what they did, which
   is the answer — they are gone. The row also drops the heat meter and the side chip: the band above already
   states the direction, and an unlabelled glyph is the thing being removed.

Its scrim is `position: fixed`. An area is up to 47 rows, so a scrim scoped to `.deck` spans thousands of pixels
and centres the sheet halfway down it — off screen, while every `toBeVisible` assertion passes. The E2E asserts
`toBeInViewport` for exactly that reason (the #207 lesson).

### 3.6.8 Pet names as their own phase — APPROVED + **BUILT** (2026-08-17, owner-directed)

The owner, on the address screen: _"i think pet names would be useful in this test and analysis… a user can, like
words, mark pet names they like, ok, not ok for what they like to me called and what they like to call their
partner, then maybe we complete remove the existing pet names stuff and replace it with this."_

**What the measurement showed before any of this was designed.** `lexicon.address` is read in exactly ONE place —
the orientation resolver — and never by the synthesis, the report, or either coach prompt. It withholds nothing:
on the real bank a straight man has **0 of 1,033 entries hidden**; the axis only decides which _direction_ each is
asked in. Meanwhile **44 of the 78 pet names map to no spine dimension at all**, so a loved name reached nothing.
So the address question was a direction filter dressed as a preference question, and the names themselves — the
most directly usable output the test could produce — were the least used thing in it.

1. **A phase of its own, first, before the vocabulary.** Registers are cards with counts, an intensity range and
   three real names; the person opens the ones that mean something. A register they never open is simply unasked.
   Inside, the whole register is on the page — the tier lines are signposts, not doors.
2. **Two marks per name**, `call me` and `call them`, in columns tinted with the same two colours the §3.6.3
   direction band already teaches, carrying both people's actual names. Never one mark plus an inferred side.
3. **The address axis stops applying to names** and survives only for the ~144 body/praise/claiming entries, where
   marking cannot help: a line naming a body either fits yours or it doesn't. The identity question shrinks to
   that job and loses every pet-name example.
4. **Boundaries become directional.** "Never call me slut" must not stop him calling her slut, so
   `LexiconBoundary.direction` and per-entry `hearState`/`sayState` exist. **Absent means both directions** — the
   strictest reading — so no boundary written before this loosens, and `violatesBoundary` without a stated
   direction still refuses everything ruled out either way. `hear`/`say` stay derived (love → 4, okay → 2,
   never → 0) so the spine, steer and report read exactly what they always did.
5. **A "Names & address" dimension** joins the fixed spine, so the warm and role registers finally reach the
   chart; the rough ones keep feeding Degradation. A dimension that did not exist for an older take reads
   "nothing yet", never a false zero.
6. **Across the whole app.** Suppression already reaches everywhere. What is new is that a loved name is a
   _vocative_ — usable in any generated line, where a loved phrase can only be quoted — so both coach prompts get
   an explicit block. The non-sexual surfaces (biographer, dream analysis, wellbeing) are deliberately excluded.
7. **Two people's answers can collide**, and the boundary wins: if she has ruled out being called something he
   loves calling her, it is suppressed silently and his own report says only "Angel has ruled this one out" —
   never a list of her answers.
8. **2,215 names across 24 registers**, each with a line showing it in use. The lines are composed from
   per-register frames rather than written one at a time — at this size that is the honest way to keep one
   voice, and it is stated rather than implied. Guards: every name has an example, the example contains the
   name, keys are unique across registers, both directions are always asked, every roleplay register carries
   its adults-only framing, and **no entry in any register names a minor** (that guard caught `wild child`,
   which was removed rather than exempted).
9. **The three original name families are GONE from the deck.** The new registers carry all 78 of their names,
   so leaving them would have duplicated every one under two keys with split marks. `cock hungry` fell out
   entirely — it is an adjective, not a name — and belongs in the degradation family as a line.
10. **"Start over from the top" clears everything for that person**, hard nos included (owner-directed). A `never`
    left behind renders as a settled row, which is the state they are trying to leave; the confirm says the
    suppression list goes with it. Identity and address survive — starting over is not answering the setup again.

### 3.6.9 The take's navigation — APPROVED + **BUILT** (2026-08-17, owner-requested, mockup approved)

The owner: _"there should also be clear to the user for this test the different sections and questions that will be
asked. for instance when opening it, it shows What do you call each other?, but doesn't give any indication whats
after that, also they should be able to skip or answer some then move on to the next, in general we need a much
better navigation workflow"_ — and separately, on the AI phases: _"WHEN THEY GET TO THAT STEP, LEAVE AND COME BACK
USING THE PICK UP WHERE YOU LEFT OFF, IT IMMEDIATELY GOES TO THE AI GENERATING WITH NO WAY TO GO BACK TO THE WORDS
OR WHAT YOU LIKE TO BE CALLED."_

**What the audit found, in the code rather than by looking.** `setPhase` was called exactly TWICE in the whole
screen, both times to return to the identity taps — so from the split onward there was no route back at all. Every
AI phase fired its own call on arrival (`started.current[phase]`). `testsAdaptiveLines` and `testsAdaptiveScenario`
reached the model with **no check that anything had been marked**. The probe returned the same `done` whether it had
exhausted its ambiguities or had nothing to work from. A degraded phase silently relocated the person to the next
one, which is indistinguishable from that phase having worked.

1. **Seven named steps**, one pure model (`takeSteps.ts`) that the map, the rail and every frame read, so they can
   never disagree about where someone is (§7 coherence).
2. **A map** on the way in and on the way back: every step, what it asks, whether it spends, what is done in it.
   It replaces "Begin" dropping you straight into a phase with no sense of what follows.
3. **A rail on every step**, carrying the same seven rows and any reachable one a tap away. Its verbs come FIRST in
   the column — an area runs to 47 rows, so actions under a tally and seven rows are below the fold before any
   scrolling has happened.
4. **Three verbs**: `Next: ‹step›` · `Skip this step` · `Finish — show me my profile`. A skip is recorded and shown
   as a skip; it never spends, so skipping the last step lands on the map rather than on a synthesis.
5. **An AI step waits to be asked.** Arrival never fires the call, and the step says what it will draw on and that
   it costs something before the tap.
6. **Enough to work FROM, not merely something** (`generationReadiness`, shared by the renderer and the bridge so
   they cannot drift): **15 marks and 3 that were a yes**. Below that a generating step is greyed with the
   shortfall — "14 more marks" — because a model given two or three marks writes from its own defaults, which is
   the generic output this test exists to avoid, charged for. A lexicon of nothing but hard nos is the same
   problem, hence the separate loved count. The bridge refuses independently of the UI.
7. **The profile is deliberately NOT gated on that threshold** — being unable to finish is worse than a thin
   profile, and the report already says when it is working from little.
8. **The identity taps are the WORDS step's prerequisite**, entered from that step rather than sprung on someone
   before they know what the test contains, and enforced wherever the step is entered from (the deck fails OPEN
   without them, §3.6.3).
9. **The two vocative questions are GONE.** "You like being called: girl / man" oriented four anatomy/praise
   families — a body job — while the question it appeared to ask is answered one step over by marking 2,215 real
   names in both directions. `address` is now derived from identity, so those four families orient exactly as
   before with no migration.
10. **Nothing is asked twice.** Nine terms sat in both a deck family and a name register as two separate lexicon
    keys, so the same words were marked twice and the profile could hold both a loved-to-hear and a hard no for
    one of them. The deck gave them up; a guard pins it.
11. **The profile links back to what produced it** — every section to its step, which is the whole answer to
    "easy to update": changing one name is two taps from the chip that shows it.
12. **The practice sheet has a way out that is not doing it** ("Not now — back to the steps"): required to reach
    the deck, never a modal someone who wandered in from the map cannot leave.

### 3.6.10 The retake choice — APPROVED + **BUILT** (2026-08-17, owner-directed)

_"RETAKE SHOULD PROVIDE AN OPTION TO RESET OR KEEP CURRENT AND EDIT!"_ — and, in the same breath, _"STOP GUESSING
AND ASSUMING AND ASK AND CONFIRM"_, so the three forks were put to the owner before anything was written.

Tapping Retake silently reloaded every previous answer (§3.5 seeds the deck from the lexicon, by design), and the
only route to a clean run was a destructive button at the bottom of a screen nobody scrolls to. Confirmed:

1. **The choice is the FIRST thing a retake shows** — before the map's step list, not after it.
2. **"Start fresh" clears everything, hard nos included** — identical to the existing start-over, so there is one
   behaviour rather than two similar ones. Who you both are survives; starting over is not answering setup again.
3. **"Keep and edit" is still a NEW take**, so "Across your takes" gets its second point. This needed no code:
   `startAdaptiveTake` already opens a fresh draft stamped `reTakeOf` whenever a completed result exists —
   verified rather than assumed.

The destructive option is never the default and never one tap: it names what it clears, then confirms. The choice
is per ENTRY, not once ever — leaving the take and coming back asks again, because the answer can change.

### 3.6.11 A `never` is a preference, not a permanent boundary — APPROVED + **BUILT** (2026-08-19, owner-directed)

The owner: _"the never should be a preference, NOT a boundary across the entire app."_ Asked what that meant
operationally, since it has two very different readings, and the answer was **changeable, but still respected** —
across the WHOLE take, names and deck words alike.

**What it means in code.** Suppression is now DERIVED from the live mark rather than duplicated into a record:

- `applyBankMarks` / `applyNameMarks` no longer refuse to re-mark a `never`, and no longer write a
  `kind:'word'` boundary record. A second copy of the same fact is precisely what made it unliftable — the entry
  could change and the record could not.
- `suppressedTexts` reads a bank entry's suppression from its **state**, and ignores a `kind:'word'` record that
  matches an entry. Nothing on disk has to be migrated: lexicons written before today still carry those records,
  and they are simply no longer the source of truth. A `theme` named in a probe is untouched — that is what
  `boundaries` is for now.
- `clearMarks` / `clearNameMarks` are no longer scoped to the take that wrote the mark. Taking one back in a
  later sitting is the same ordinary act as changing it. **The draft guard in `adaptiveService` still holds**: a
  stale `resultId` cannot reach into a take that is not open, which was always a separate protection.
- `mergeLexicons` resolves state last-write-wins. `never`-wins was right while it was permanent and is wrong for
  a preference: lifting one here would be undone by an older copy on the next sync.
- Nothing renders as settled. The deck's locked row and the pet-name "off the table" state are gone, and
  `AdaptiveNameEntryView.settledHear` / `settledSay` with them.

**What did NOT change.** A marked `never` still suppresses that text everywhere — unconditionally, on every path
that writes prose a person reads (§5.8), including the unreviewed outbound ones. `deleteAllAdaptiveResults` still
keeps `never` entries, so deleting your takes never makes the app start using a word you had ruled out. The report
still offers the explicit lift, and still never asks why.

### 3.6.12 The register grid, redesigned — APPROVED + **BUILT** (2026-08-19, owner-requested, mockup approved)

A complete redesign of the pet-name register grid, plus the bug that made it necessary.

**The bug.** Each register's `marked` count was computed server-side in `testsNames` and fetched **once** at
mount; `flush()` never re-fetched. So a register marked in THIS sitting kept reading "Not opened", while one
marked in an earlier sitting showed a count — because that one was already baked into the fetch. Two sources of
truth for one fact, and the stale one was on screen.

**The fix is the redesign's foundation.** `AdaptiveNameRegisterView.marked` is **removed**: every fact it carried
is already in `entries`, and `store.nameMarks` is seeded from the view on load AND updated on every tap, so it is
complete. A pure `registerStats(entries, nameMarks)` derives all of it in the renderer — exact, instant, and with
nothing left to drift. It is also what supplies the love / okay / never counts, which never existed in the view
type at all.

**Owner decisions, asked one at a time.**

1. **A progress bar and a percentage** — the never-show-complete rule was narrowed on 2026-08-18 because a
   moving total makes a denominator a lie; a register's total is fixed, and the screen already showed
   "N of M marked" inside an open register. Worded as progress through the LIST, never about the person.
2. **Either direction counts as answered.** A name marked one way is answered. The alternatives make 100%
   unreachable for someone who only cares about being called things, which is its own dishonesty.
3. **One grid with a sort control**, never grouped sections — a group holding one register would stretch that
   card to the full row in an `auto-fill` grid (the defect #530 hit). Default: in progress → untouched →
   all-marked, curated warm→furthest order as the tiebreak.
4. **All three counts**, as counts of NAMES so they reconcile with the marked total above them. A mixed name
   lands in one bucket, precedence `never > love > okay`.

**The range is words, not a meter.** The five-pip meter lit the tiers a register SPANS (4–5 lit positions 4 and
5), which reads as an AMOUNT ("2 out of 5") — two encodings of overlapping facts with nothing saying how they
related. Reported twice as unclear. It is now an eyebrow above the title reading `gentle`, `gentle to strong`,
`warm to intense`, `intense`. §12 decides the placement: a tag never shares a line with a title, or both it and
the sample names lose width.

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
    state?: 'never' | 'okay'; // a boundary, or a mild yes (§3.6.2). `notYet` is coerced on read.
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

#### 5.8a One rule, applied everywhere (2026-08-18)

The table above is what was designed; what was BUILT was six paths wired by hand as each was written, and a
dozen that were never wired at all. An audit of every generation path in the app found the inconsistency was
not a matter of taste — it produced two real fail-open holes:

- The questionnaire suppression was threaded **inside `explicitFraming`**, so the gentle 18+ tier
  (`intimacyGeneral`) and every non-sensitive type dropped it. A gentle intimacy questionnaire could ask
  about the one term a person had ruled out, and nobody reviews a generated question before it is sent.
- The **challenge coach** took `CHALLENGE_INTIMACY_REGISTER` — an explicit sexual register on the same 18+
  ack — while the topic gate withheld the person's own vocabulary. It was the one place in the app
  deliberately speaking explicitly TO them with their own words held back.

The rule now, stated once and applied uniformly:

> **Suppression is unconditional on any path that writes prose a person reads. The positive steer stays
> gated** (the 18+ ack, and the context being intimate at all).

Suppression can only ever PREVENT a suggestion, so there is no tier, topic or relationship state at which
withholding it is correct. The steer is the opposite — it hands a model explicit vocabulary — so its gates
stay exactly where they were.

Three shared helpers make adding a path one line, so the next one has an obvious thing to call:
`buildOwnSuppressionBlock` (the hard nos), `buildPracticeGroundBlock` (the derived hear/say gap — a goal list
the person never had to write), and `buildProfileReadBlock` / `profileReadBlock` (the report's `lede` +
`readings`, which were **written once and read by nothing** until now; the 18+ gate lives inside the helper
rather than in each caller).

**Now wired:** goals · dream analysis + patterns · weekly coaching synthesis · relationship synthesis ·
session wrap-up · Together wrap-up · memory reconciliation · questionnaire analysis · compatibility alignment
· compatibility variant rewrite · fact correction · every questionnaire tier · book foundations,
answer-the-author, interview gap questions, continuity + line-edit · the sensitive self-assessment narrative ·
the challenge coach's own vocabulary.

**Deliberately NOT wired,** so the next audit does not re-tread them: the topic classifier, semantic dedup,
ask-ledger backfill, the questionnaire planner/gap-finder/coverage passes and guided-session suggestions —
these classify or select, they do not write prose in the person's register; and the whole-book structural
reads (manuscript, structure, title, essence, placement) plus image-prompt distillations, which operate on
text already generated with the block rather than producing new material in that register.

#### 3.6.13 Six reports from one afternoon (2026-08-18)

All six came from the owner using the real app, and three of them were one root cause.

**The root cause: a pet name that is also an everyday word.** Dozens of the name bank's entries are ordinary
English — `love` · `baby` · `beautiful` · `angel` · `treasure` · `honey`. `violatesBoundary` matched a banned
single word anywhere it appeared, so someone who went through the pet-name pass and ruled out most of it was
suppressing that much of the language. Measured: **40% of ordinary intimate lines** were being discarded, and
an 8-paragraph synthesis narrative is near-certain to contain one — so the whole read was thrown away. The
person saw "Nothing usable came back this time" on the lines step and "the written read didn't come through"
on their profile, and had no way to tell that the app had done it to itself.

Fixed by making a single-word name a boundary **when it is used to ADDRESS them** — comma-adjacent, after
`my`/`oh`/`you're`, or the bare word — and only for a curated list of names that are also everyday words
(`EVERYDAY_WORDS`). It is a RELAXATION, so anything not on that list (`whore`, `slut`, `cumdump`) keeps the
plain substring match, and multi-word names ("good girl") keep it too: they have no innocent use.

**Failures wearing a success.** `AdaptiveProbeView.done` means "nothing left to ask", and the store folded
`degraded` into it — so a failed call printed _"everything you marked was clear enough that it has no question
to ask — that's this step finished."_ And `loadScenario` set `scenario: null` with no message, so tapping a
moment showed a thinking state and returned to the same grid in silence: a button that does nothing. Both
views now carry the phase's own `message`, and `done` is the success state alone.

**Three smaller ones.** The `done` phase was a whole screen whose only content was a banner and a button to
leave it — it now redirects to the report. A rail button's label was a bare text node beside a span, and
`Button` is a flex container with a gap, so the label rendered with a double gap mid-phrase; the label is one
child now. And a synthesis that produced nothing was a dead end — the report offers to run the read again
(idempotent: the take keeps its insight id).

**Left as designed:** the profile step is still not gated on the readiness threshold. Being unable to finish
is worse than a thin profile, and now that a failed analysis is retryable the thin case has a way forward.

#### 3.6.14 Naming it, and making a failure diagnosable (2026-08-18, second pass)

The first pass fixed the over-matching but the phases still reported failure generically, so a second round of
"it still doesn't work" carried no more information than the first. Three changes:

- **"The written read" → "Psychological analysis".** The old name said nothing about what the thing IS; this
  is an analysis of what their answers say about them.
- **Every phase now says WHICH failure it was.** `runLinesPhase`, `runProbePhase` and `runScenarioPhase`
  collapsed two opposite causes into a bare `degraded`: a reply that never parsed (the MODEL — a refusal, a
  truncation, prose instead of JSON, all of which `classifyParseOutcome` already names) and a reply that
  parsed and then lost everything to `violatesBoundary` (OURS — the app filtering out its own output). They
  are different sentences to a person and different bugs to fix, and neither was distinguishable from the
  other or from "AI isn't set up".
- **The real client captures its replies** when `SELFOS_FAKE_PROMPT_DIR` is set, with `stop_reason`. A prompt
  says what was sent; diagnosing "nothing came back" needs what came back, and the offline fakes can never
  show a refusal or a truncation.

**And the words + trends block was redesigned.** Three bands of identical grey chips under three quiet labels
became banded groups with a left rule and a count; the four-series line chart — capped at 440px inside a
full-width section, so most of the row was empty, and unreadable without matching a colour to a legend —
became one labelled row per dimension with its own sparkline and its change stated in words (which is also
the §9 text equivalent, and the thing you actually want from a trend).

#### 3.6.15 What the live model actually showed (2026-08-18, third pass)

The owner supplied a key. Running the phases against **real Claude at his numbers** — 142 marks, ~246 hard
nos — found four defects that no offline test could have, because the fake never refuses, never writes loose
JSON, and never writes a sentence long enough to break a layout.

- **The probe asked about a hard no.** `openAmbiguities` generated `They loved "baby" but ruled out "sweet
girl" — is it that word, or the register?` That is the app fighting itself twice: the probe's own prompt
  forbids asking anyone to justify a boundary, and the question it produces necessarily contains the term the
  boundary filter then rejects it for. Every attempt billed a call and reported "nothing came back", for
  anyone who had ruled anything out. The contrast is drawn against the **middle mark** now, and the prompt
  names the only words the probe may quote — because with 246 nos, "quote their own marked words" lands on a
  banned one about half the time.
- **The analysis was thrown away whole for one word in three thousand.** `violatesBoundary` was applied to the
  entire 6–8 paragraph narrative. It now filters **per paragraph**, so the boundary stays absolute — no
  sentence containing it is ever shown — while the rest of the work survives. And `ok` no longer hangs on the
  narrative alone: the report leads with the lede and the readings, so a take that produced those has an
  analysis.
- **Half of live one-string replies are invalid JSON.** The model writes
  `{"question": "When you hear "baby" land right …"}` — inner quotes unescaped.
  `salvageJsonObjectField` cannot rescue it either (it stops at the first unescaped quote), so
  `salvageLooseStringField` was added: greedy to the last quote before the close.
- **The name-family relaxation is opt-IN.** Enumerating every pet name that is also an everyday word is
  whack-a-mole across 342 single-word names; listing the crude families instead fails OPEN when a family is
  added later. So the everyday families are named explicitly and everything else keeps the plain substring
  match.

**And the retake flow.** Retake landed on the intro — an explanation of a test they had already taken, behind
a button reading "Pick up where you left off" — with the question a retake actually poses (keep what you
marked, or start fresh?) two taps further on. Retake now goes straight to that choice.

A live scenario option also overflowed its button: an option is a whole spoken line, and `Button` is
`white-space: nowrap` at a fixed height, which is right for a label and wrong for a sentence. The offline
fake's short canned options could never have shown it.

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
- **Retake** — merges forward; `never` entries are never re-offered; `okay` may be. A legacy `notYet` reads as
  `okay` (§3.6.2).
- **No partner** — solo/self-talk framing throughout; the steer simply never runs.
- **Partner edge removed mid-life** — the steer re-gates on the next call, no stale access.

## 8. Safety

### 8.1 The boundary

Consensual adults only; taboo strictly as fantasy/roleplay; never minors, never real non-consent, never illegal
acts; within Anthropic's usage policy. Stated in-prompt on every phase, enforced by content + the model, **never
a keyword filter** (the `@selfos/core/intimacy/topics` rule). The not-medical line and the `CrisisFooter` are on
every surface. The report interprets but never diagnoses.

### 8.2 Boundaries and shame

- A `never` is **a preference, not a permanent boundary** (owner decision, 2026-08-19 — see §3.6.11). It is
  suppressed everywhere for exactly as long as it is set, is changeable in any sitting, and **never requires
  a reason**.
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

The deck is keyboard-operable one area at a time, with a per-mark accessible label naming the entry, the
direction it is rated on, and the mark ("good girl — hear — it's okay"). The three marks are lucide **icons**
(§3.6.1 #5), so text equivalence is a REQUIREMENT rather than a property of the glyph: each carries a text
label and `aria-pressed`, and state is never conveyed by icon or colour alone. Line reactions are buttons with
real labels, not gestures. The withheld note (§3.6.5) is part of the area's accessible content, not a visual
aside. Spine bars + trends carry text equivalents (the `SubscaleBar` / `LineChart` precedent). Progress is a
polite live region; the crisis banner is announced. Responsive ~360px→desktop with no horizontal scrollbar and no
inner scroller — the deck is a single column at every width, so nothing collapses. Reduced motion respected.

## 10. Testing strategy

- **Unit (core):** the bank marks + the two states (`never` permanent, `okay` a mild yes) + the legacy-`notYet` coercion + the
  orientation resolver truth table + `shown + withheld === total` + the fabricated-goal guard (§3.6.6); the boundary union on merge; a `never` never
  re-offered on a retake; `mapToSpine` rejects an AI-invented key; the stopping rule caps calls AND cost; a
  degraded phase still synthesizes; the saturation write is idempotent and lands `Intimacy:dirty-talk` in the
  ledger; the steer is gated on a live edge + both acks and **never emits a boundary reason or a probe answer**;
  the suppression holds with no steer at all.
- **Bridge (two-persona, decrypt-level):** a take writes an encrypted result + lexicon + Insight; the Insight is
  intimacy-gated (present in an intimacy context, **absent** from a money context, absent from the digest, absent
  from Together); a partner's prompt carries the steer but **never** an attribution phrase; a `never` word is
  absent from a partner's suggestion prompt; a Guest is refused; the 18+ gate withholds everything.
- **RTL:** the deck renders one area with its quotes, records a mark on the oriented side only, and states the withheld
  count; the report renders + edits persist; AI-off shows the
  short-version path; the practice handoff carries the goal.
- **E2E (Playwright, `SELFOS_FAKE_CLAUDE`):** a full take → profile → **decrypt the vault** to assert the lexicon
  and the ledger entries; a retake versions and never re-offers a `never`; delete-all removes result + Insight +
  lexicon sections; 360px overflow guard on the deck + report; the full surface renders to the bottom.

## 11. Open questions

### Resolved (2026-08-16 — asked one at a time, before drafting the build)

1. **Taboo fantasy (F18)** → **ships in v1**, and **nothing is gated at all** — no tier ceiling, no family
   opt-in. Private two-person household of consenting adults. The roleplay framing + hard limits stay (§8.1).
2. **Pacing** → ~~a **two-pass bank**: pass 1 marks only what lands, pass 2 asks the hear/say split on what was
   marked.~~ **SUPERSEDED by §3.6.4** — one area per screen, one rating on the oriented side, the split screen
   surviving only for `either/either` entries. Marks are lucide (#14) and the middle mark's meaning changed
   (#15).
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

### Resolved (2026-08-16 — the bank-pass redesign, asked one at a time; see §3.6)

10. **Quotes** → **hand-authored per fragment**, not templated and not AI-generated. ~400 lines; complete
    utterances show none.
11. **Pacing** → **one area per screen**, a deck of 36 with progress and a per-area skip. Supersedes the
    single-scroll presentation in #2 (the two-PASS model itself is superseded separately by §3.6.4's collapse).
12. **Narrowing** → **no pre-filter**; areas are ORDERED broad-first so a half-finished take is a real profile.
13. **Intensity** → **nothing hidden**; every tier on screen, gentle → extreme, with an intensity pip.
14. **Marks** → **keep all three**, lucide icons only (`Flame` / `Contrast` / `Ban`).
15. **The middle mark** → **"It's okay"**, a mild yes. A model change: it stops feeding goals, which now come
    from the hear/say gap alone (§3.6.2).
16. **Orientation** → body from **intake anatomy**, address from **two taps in-take**. Never inferred from
    gender + orientation (#62). A display filter only — never a boundary (§3.6.3).

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

- 2026-08-18 — **AMENDED (§3.6.17–§3.6.22): the moments get navigation, the questions get short and tappable,
  and five silent defects go with them.** Owner-reported: _"In the moment has no navigation… no way back to the
  category grid, and no way to review or edit answers given for other categories"_ and _"the questions are too
  long — they should be quick to read, short, easy to answer, and specifically about dirty talk."_

  **§3.6.17 — the probe.** A pass asks up to six questions and every one of them was stamped under the bare
  AMBIGUITY id; `stampTurn` replaces on `(phase, item.id)`, so answering Q2 destroyed Q1's answer. Six answers
  typed, one on disk — which is also why the review screen showed a single card, and why the synthesis, whose
  richest input is this free text, was fed a sixth of it. `probeTurnId`/`ambiguityOfProbeTurn` split the two
  (crypto-free in `schemas.ts`, so the renderer stamps and the bridge reads back one definition). The questions
  are now one line under 20 words — **enforced in code, not just asked for** — with 3–5 tappable answers
  written for that exact question and a folded "say more"; the prompt's interpretive angle is gone, because a
  reading about the person belongs in their profile where it is labelled as one. A skip records a distinct
  marker instead of `''`, which every consumer had been counting as an answer.

  **§3.6.19 — the moments.** The generated scenes were never persisted (`options: []` hardcoded at the stamp),
  so an answered moment could never be re-opened or re-picked, and re-entering a category could only mean
  spending again on five different ones. Options now travel with the turn, the six categories are a strip that
  never leaves the screen, and switching is navigation rather than a purchase. Three of the six —
  `edge`, `sexting`, `phone` — had been written by the engine and reachable from nowhere.

  **§3.6.18 — a failed analysis.** The one AI phase that never carried its own reason, and the one reported
  three times because of it: `runSynthesis` returned a bare `degraded` on a parse failure and the bridge
  discarded `ok`/`reason`/`message` regardless, then completed the take and redirected to a report with no
  profile in it. It now names which failure it was, leaves the take open, and offers both a retry and an
  explicit `acceptDegraded` finish — the latter because "never complete on a failure" alone is a trap for
  anyone over budget.

  **§3.6.21/§3.6.22.** The take's running spend in the rail (admin-only by construction — the bridge redacts
  `costUsd`), comparable rail units, and an area jump for the 36-area words step.

  **Verified LIVE** against the owner's own vault through `createCoreBridge` — the real handlers, not the
  engine functions — at 132 marks / 245 boundaries: questions 8–13 words (was ~54), 6/6 tappable, **6 of 6
  answers on disk**, an answered moment keeps its 4 options, `sexting` writes moments, analysis 2,450 chars.
  Gate: typecheck ×3, lint, format, **2390 core + 1684 desktop** unit, **216 E2E**. The answer-loss guard is
  verified to FAIL when reverted ("expected 3 but got 1").

  **Lessons: (1) a shared id across N generated items is invisible until something replaces-by-id — the
  de-duplication fix that made answers editable is what turned a harmless append into silent destruction, so
  when you add replace-by-key, enumerate everything that writes that key. (2) Paid output that is never
  persisted (a scene's options) reads as a UI dead end, and the fix is storage, not navigation. (3) A prompt
  that asks for brevity gets it most of the time; one 27-word question in six is enough to reopen the
  complaint, so the cap belongs in code — the instruction is belt, the filter is braces. (4) A destructive
  action called as "cleanup" without reading it cost the owner his whole lexicon: `abandonAdaptiveTake` is the
  disclosed, confirm-gated "start fresh", not a scratch-draft tidy-up.**

- 2026-08-17 — **AMENDED (§3.6.2): word-level marking stays; REGISTER becomes the axis that carries the rest,
  and a rejected line can become a boundary.** The owner asked whether the bank should be quote-based instead
  of word-based, from a case word-level can't answer on its own: _"they could like I want to fuck your pussy
  but not like I want to beat that pussy"_. **Measured before deciding:** 6 word families vs 30 phrase
  families, and 256 of ~1,033 entries carry a quote while 587 ARE the line — so the bank is already ~75%
  quote-based, and the word-level part is exactly the nouns and vocatives.
  **Word-level stays, because suppression depends on it.** All three consumers feed a model that GENERATES,
  and `violatesBoundary` blocks a candidate by word-boundaried match on short strings. Ban a word and every
  future line containing it is caught; ban a whole sentence and a paraphrase sails through. Quote-only would
  quietly break the hard-no guarantee, which is the strongest promise in the feature.
  **What was actually missing is register.** The synthesis has been scoring seven registers on every take and
  **nothing read the result**, so a coach handed the vocabulary had no idea which way to point it.
  `buildOwnLexiconBlock` and `buildPartnerSteer` now name the register that lands and the register that does
  not — as words, not numbers, and only for clear signals — with the miss stated honestly as _not_ a boundary
  ("avoid this framing even with words they like"), since their hard nos are the separate absolute list.
  **And the lines phase can now produce a limit.** A "no" there meant "this line doesn't land" and produced
  nothing durable. It still doesn't mint a boundary on its own — a boundary is permanent and lifts only by an
  explicit act (§3.2) — but a rejected line now offers a second, deliberate tap that records it as a THEME
  boundary, which `violatesBoundary` matches on stemmed content words, so "beat that pussy" also stops "gonna
  beat that pussy up".
  **Considered and rejected:** flipping the bank to quotes (unenforceable boundaries, several thousand
  entries, a much longer pass, and the coach loses composable vocabulary); a per-row "not like that" on all
  ~1,000 rows (control noise); and a hand-authored contrasting-lines stage per loved word (256+ words × 3
  lines of content, materially longer take).

- 2026-08-17 — **The deck, redesigned for real (§3.6.4; mockup approved before any code).** The owner, on the
  fourth round of "improve the UI/UX" being answered with copy edits: _"WHEN I SAY IMPROVE SOMETHING FROM THE
  UI/UX, THAT MEANS DESIGN, NOT A LINE OF TEXT"_ — and they were right. Direction had become a sentence, the
  address screen a relabel, the chrome a moved paragraph. The deck was still four stacked paragraphs above a
  flat hairline table with three identical grey squares per row. What changed now:
  **Direction is a graphic.** A coloured band above every area with a `You → Them` flow, and the whole band's
  colour changes with the direction, so it is legible before anything is read. The same two colours tag the
  identity screen's preview, so the preview teaches the band.
  **The line is the hero of its row.** The example moves to serif at reading size; the term drops to a quiet
  uppercase label above it. You react to the line, so the line is what you see first.
  **The marks are three distinct controls** — warm / accent / danger, filling when active, 44px, with the
  boundary set apart by a divider so a hard no can never be a mis-tap neighbour.
  **Intensity is a 3-bar meter** (red at the top tier) with a text equivalent, replacing an unexplained 5px dot.
  **Progress is one slim bar** with a floor so area 1 of 36 still reads, replacing 36 dashes.
  **Actions and the running tally live in a sticky rail**, so finishing never means scrolling past 47 rows a
  person has already decided about, and a partial pass visibly counts (§3.6.1 #3).
  **The marking rules collapse to one link** on every area instead of four paragraphs on each of 36.
  **The identity screen shows its consequence** — two real bank lines, tagged YOU SAY / YOU HEAR, chosen by the
  same rule the resolver uses, so the preview can never promise a line the deck then withholds.
  Two defects the render caught that the CSS alone would not have: a stale pre-redesign `.deckHead { display:
flex }` made the progress bar a content-sized flex item parked mid-header (measured at 10px wide, not
  assumed), and the band's long change label wrapped its own sentence onto three lines.

- 2026-08-17 — **Fourth audit + the owner's UI/UX corrections (§3.3/§3.6.3/§6).** Two of these were reported
  by the owner from screenshots, and both were things the audits had missed by only ever looking at the
  _taken_ state of a _fully-onboarded_ person.
  **The direction was not clear** — a screen of "your pussy is so wet for me" with three marks and nothing
  saying whether you were rating hearing it or saying it. Orientation had already resolved it (that area is
  say-only for a man who dates women), but the answer lived in the **aria-label**, where a sighted person
  never sees it. Rating the wrong direction silently poisons the whole profile, so it is now stated in the
  area header as an instruction, with a per-row marker when an area mixes the two.
  **The body axis had exactly one source and it fails open.** `selfBody`/`partnerBody` came only from the
  onboarding anatomy answers, so someone who skipped onboarding or answered "rather not say" was shown the
  entire bank in both directions — a straight man rating lines about a vulva as things he'd like to HEAR. The
  two taps now also ask **who the two of you are** ("You are a: / Your partner is a:", the owner's wording) and
  that backs the body axis; the intake answer still wins wherever it exists, because it was asked directly and
  #62 forbids overriding it by inference. Identity and address stay separable behind an escape — a man can
  want "good girl", and collapsing them would be the same conflation #62 was about.
  **The not-yet-taken report was broken:** a banner, a Take it button, then the whole report rendered empty —
  "Love to hear" and "Comfortable saying" headings with nothing under either — and a second Take it button.
  **A dialled-down entry vanished:** marked love in the deck and then rated 1–2 in the split, it fell below the
  loved bar, wasn't a boundary and wasn't the middle mark, so it appeared nowhere. It reads as "fine, not a
  favourite" and is shown there.
  **`TestResult.costUsd` carried only the synthesis call** while the bridge redacted it as a money figure; each
  AI phase now accrues onto the draft, and the true per-take cost is shown to `budgets.manage` (the spec-50
  precedent).
  **Also:** an area change moved no focus, so a keyboard or screen-reader user got 36 silent screen changes.
  **Checked and found sound:** the saturation write-back closes real topic ids (`Intimacy:dirty-talk` at 3
  asks = `SATURATION_ASKS`), and a take's own Insight cannot re-open the ground it just closed, because
  `topicsWithNewMaterial` ignores material at-or-older-than the last ask and both are stamped at the same
  instant.

- 2026-08-16 — **Third audit + visual / workflow / usability passes (§3.3/§3.6.4/§5.3).** This one went at the
  AI phases' own prompts, the scoring math, the sync merge, and then at the rendered screens.
  **Correctness:** the probe QUESTION and the scenario SCENE were the only model prose reaching the person
  unfiltered — lines, options, narrative, themes, wantsToSay and voice all pass through `violatesBoundary`,
  and those two did not; the probe is the phase that asks open questions, so "never ask them to justify a
  boundary" was requested and not enforced. Both now filter, degrading the phase rather than showing it.
  `mergeLexicons` dropped `sides` when the newer copy lacked it — a device on an older build would erase the
  record of what was ASKED, and an entry with no `sides` reads as both-sides-asked, which is exactly how a
  fabricated goal gets into their own coach's prompt; what was asked now survives a merge the way a boundary
  does.
  **Two things were generated and thrown away:** the synthesis scores seven **registers** and six **contexts**
  with notes on every take, stored them, and nothing read them — now the report's "Register & timing"; and
  the fixed spine exists so retakes stay comparable, yet the report showed only the newest take — now
  "Across your takes" (≥2 takes, no-signal dimensions excluded rather than plotted at zero).
  **Visual / usability:** the standing instructions and the autosave banner were repeating on **all 36 areas**,
  pushing the first markable row most of the way down the viewport every time (4 rows visible, now 7); they
  show once, and a permanent one-line legend carries the marks. The tier pip was a colour-only dot with no
  legend (§9) and now carries a text equivalent. "Shown for: either · either" was machine output, not
  language. The report's section headings sat flush against their first row.
  **Workflow:** "Skip this area" and "Next area →" called the same function — two labels, one behaviour, side
  by side, so Skip read as meaning something extra it never did. One button now, and the banner says moving on
  skips whatever you left alone.
  **Recorded, not built:** a retake re-walks all 36 areas with every prior mark pre-filled; there is no
  "show me only what I haven't marked".

- 2026-08-16 — **Second audit — deeper sweep (§3.6.2/§8.3).** Ran against the data lifecycle, the seam and
  every consumer rather than the take. Four findings, all fixed and guarded:
  **(1) SAFETY — the crisis footer was missing from most of the take.** It was rendered inside the intro,
  address and bank branches only, so it disappeared on `probe` and `scenario` — the free-text phases
  `readsAsDistress` actually reads — and on `done`, where someone lands after a heavy take. Hoisted to one
  always-present footer outside the phase branches.
  **(2) The middle mark was write-only.** `It's okay` was recorded, restored in the deck, and then appeared
  nowhere: absent from the report and from every prompt. Hundreds of taps bought the person nothing, and
  their own profile silently omitted their own answers. It now shows on the report as "Fine either way" and
  reaches their OWN coach as second-tier ("usable, never lead with them"). It stays OUT of the partner steer,
  which answers "what lands", and out of the goal derivation, which §3.6.2 already settled.
  **(3) A ledger failure reported a completed take as failed.** `recordTakeSaturation` documents itself as
  best-effort, but was awaited unguarded after the result and the Insight were already written — so a throw
  surfaced "that didn't go through" over a finished profile. Now caught; a retry heals it, and the write is
  idempotent by construction.
  **(4) Resume was a one-way door.** `abandon` existed end-to-end and was rendered nowhere, so nothing could
  take someone back to area 1 of a 36-area deck. Surfaced as "Start over from the top", which clears the
  take's record and its place in the deck and says plainly that the marks are kept — they are the person's
  answers and live in the lexicon, not in the take.
  **Checked and found sound** (recorded so the next audit doesn't re-tread): person-delete reaps the lexicon
  with the person folder; the derived Insight is `restricted` + `lifeArea: 'Intimacy'` and inherits its id
  across retakes, so `deleteAllAdaptiveResults` can't orphan one; the adult-book lexicon block sits behind a
  bridge-side ack re-check; the "Delete it all" copy already states that hard nos survive; and the hard-no
  list is deliberately UNCAPPED where every neighbouring list caps at 20 — now pinned by a tripwire, since a
  dropped boundary is not a cheaper prompt but a limit the coach never learns.
  **Recorded, not built:** `recordBankPass` will write marks against any `resultId` the renderer sends (the
  dangerous direction — un-marking — is already scoped to the open draft, and the write path is confined to
  the caller's own person folder), so this is a hardening rather than a defect.

- 2026-08-16 — **Audit close-out (§3.6/§3.5/§8.4).** A full audit of the shipped feature — model, seam,
  renderer, and its integration with the surfaces the lexicon feeds — after the redesign landed. Four
  user-facing defects, each now guarded (every guard verified to fail when reverted):
  **(1)** the Tests hub badged an adaptive intimacy profile **"private — only you"** one screen before the
  take and the report both say the loved terms quietly steer a partner's coach — the app contradicting
  itself about who sees what. It now reads "yours", which is true; a spec-50 sensitive result really is
  own-context-only and keeps the stronger wording.
  **(2)** the report's **"Practise this"** handed the goal over in `seedText`, but the same navigation opens
  a guided thread, so the launcher that read it never rendered and the goal was silently dropped — the
  practice session opened by asking what the report had just told us. The seed now reaches the thread
  composer.
  **(3)** an area whose every entry is withheld (common on a same-sex configuration) rendered the marking
  instructions and an empty card over "0 here"; it now says what happened and keeps the route back.
  **(4)** a resumed area index was not clamped to the current bank, so retiring a family would strand the
  deck on a blank screen.
  **(5)** every store action is now wrapped in a failure guard: a rejected bridge call used to leave `busy`
  set with nothing on screen and no route out but quitting the app — which, on a take that autosaves, reads
  as losing everything you just marked. It stops, says so, and leaves the phase where it was.
  **Suppression was also completed across every generation path** — the challenge coach, the intimacy
  email, questionnaire generation, and the biographer chat all took an explicit register while being denied
  the hard-no list; the session gate is now unconditional, since suppression only ever PREVENTS a
  suggestion and a topic classifier that fails open is the wrong thing to hang a boundary on.
  **Recorded, not built:** the hear/say split still renders as one long list for an `either/either`
  configuration (it autosaves and is skippable, so it works — chunking it by area would mirror the deck);
  the report shows the profile but not the orientation it was built under (the take's "Before we start" is
  the one place that changes it); and there is no per-entry way to move a `love` down to `okay` outside a
  retake — a `never` can already be lifted from the report.

- 2026-08-16 — **AMENDED (§3.6): the bank pass, redesigned.** Owner-requested after seeing the built pass, and
  approved as a mockup before any code. Measured first (1,033 entries · 36 families · median 26), which named
  four separate causes where "overwhelming" had read as one: volume, missing context, uniformity, and — the
  one the owner spotted independently — **orientation**, since roughly half the bank could never be said to a
  given person or by them. Seven decisions locked; the two that change more than pixels are the **middle mark
  becoming "It's okay"** (a mild yes that no longer feeds goals — the goal signal moves wholly to the hear/say
  gap, which is stronger for being derived from two answers) and **orientation**, whose body axis reuses the
  intake anatomy answers rather than inferring from gender + orientation, because that inference is precisely
  what broke #62. Two consequences worth their own line: the hear/say split **collapses** into the deck for
  every oriented entry, and withheld terms are **counted and stated** rather than silently dropped, because an
  invisible filter on a discovery test is the worse failure.

  **The doc audit then found a blocker in the amendment itself**, which is why §3.6.6 exists: `say: 0` does not
  mean "not asked" anywhere in the code — it means _cannot say it_. So collapsing the split would have left
  every loved hear-only entry looking like a declined one, turning it into a **goal the person never declined**
  — and goals reach their own coach prompt AND a partner-shared Insight fact. The shown sides therefore have to
  be RECORDED (`LexiconEntry.sides`), not inferred from a zero, and the claim that "the goal signal survives
  intact" was corrected: it survives for `either/either` entries, not for oriented ones. Two smaller finds:
  dropping the middle mark silently kills both `notYet`-fed probe inputs (an empty probe pack is invisible),
  and the intake anatomy answers are LABELS, not enums, with no stated mapping — now written down, failing
  **open** so someone who declined to answer never gets a silently thinner test.

  **BUILT 2026-08-16** on `feat/adaptive-deck`, all five slices. What the build itself surfaced, beyond the
  audit: the deck's 36-dot progress rail is ~540px and cannot fit a phone, so it is hidden below 620px where
  the "Area N of 36" text beside it already says the same thing (the §12 guard caught it, not a screenshot);
  the withheld count is usually **0** with family-level tags, because an entry aimed at a girl still reaches a
  straight man's SAY side — the real reduction is the side split (for a straight man: 129 say-only, 65
  hear-only of 1,033), not withholding, and §3.6.5's note is the honest exception rather than the rule.
  Coverage: **213/213** word entries carry a hand-written example, pinned by a bank-integrity guard.

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
