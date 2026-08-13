# 71 — Question intelligence rebuild (ask ledger, planner & emergent topics)

> **Status:** **Approved** · Built — _last updated 2026-08-12_
>
> Questionnaire generation re-asks what a person has already answered and drifts off the requested
> type/register, because the signals that should prevent both are structurally broken: coverage is
> classified by hand-written keyword regex (34% miss rate on real data), saturation never fires,
> de-dup sees 2.7% of the ask history, and the type-agnostic candidate feed overrides the sensitivity
> register. This rebuilds the layer on a durable **ask ledger**, an **emergent per-person topic map**,
> and a dedicated **planning pass** that decides ground before generation writes questions. Supersedes
> the steering halves of [`69`](69-questionnaire-intelligence.md) §5.2/§5.9 and
> [`70`](70-adaptive-exploration.md) §3.2, and replaces [`08`](08-questionnaires.md) §27's intimacy
> coverage engine.

---

## 1. Overview

A member reported that an **intimacy / unfiltered** draft for their partner produced (a) a question
with nothing to do with the requested register, and (b) questions already asked before. Both were
reproduced against the real vault (61 sends to the recipient, 272 questions, 101 rated acts) by
reconstructing the exact prompt the model receives. Five independent defects, each proven:

**D1 — The candidate feed overrides the register.** `buildCandidateGuidance` emits
_"draw generation PRIMARILY from these"_ and is placed **last** in the user message (highest
recency), outranking the explicit-tier register ~6,000 chars earlier. Candidates come from
[`70`](70-adaptive-exploration.md)'s Explored-tab feed: type-agnostic, tier-agnostic, written in a
soft coaching register, and up to days stale. Both reported questions are stored candidates rewritten
— one near-verbatim.

**D2 — General coverage steers a typed draft off-topic.** `buildCoverageGuidance` is type-agnostic.
On the reported draft it emitted _"NEW / UNEXPLORED GROUND — lead here, put MOST questions on
genuinely new territory: **Friendships**, Taboo fantasy"_ and listed ten explicit categories under
_"leave these"_ — the inverse of what an unfiltered intimacy questionnaire should do.

**D3 — Saturation never fires.** `buildIntimacyCoverage`'s `new-material` re-open signal is the
newest own-subject Insight of **any** kind, so any session/dream/test re-opens **every** intimacy
category. Real result: nine categories at or past the threshold of 3 (penetration 9, dirty-talk 8,
impact 8, exhibition 8, anal 6, bondage 6, group 6, oral 5, manual-toys 5) and `saturated: []`. The
_"ALREADY EXPLORED THOROUGHLY — do NOT return to these"_ line is therefore never emitted, and
`deepenableActs` carries **all 101** rated acts — a 2,463-char block, 29% of the prompt. This is
[`08`](08-questionnaires.md) §27 (the #314 fix) regressed to inert; its tests pass only because they
use controlled timestamps.

**D4 — Coverage classification is keyword regex, and misses a third of reality.**
`categoriesMentionedIn` matches hand-curated keywords. On the recipient's 99 intimacy questions,
**34.3% credit to zero categories** — invisible to saturation, coverage and the Explored tab —
including unambiguous content ("when Ben does take control during sex" → power-exchange; "one hand
working his cock… your mouth" → oral + manual; "a penis sleeve" → manual-toys). **Both reported
questions credit zero categories**, so that ground can be re-asked indefinitely. Whole concepts have
no category at all (who initiates, solo/mutual masturbation, eroticised release from the mental
load — precisely the reported off-register question).

**D5 — De-dup sees 2.7% of the history.** `buildDedupReference` caps the asked-prompt section at
2,000 chars. The recipient's 272 prompts average 271 chars = 74,417 chars, so ~8 prompts survive.
Proof of damage: dirty talk has been asked **7+ times** in near-identical wording.

The root shape behind all five: **the app has no durable memory of what it has asked.** It
re-derives that from raw ciphertext on every generation (six full scans, 1,148 decrypt ops at 110
sends), compresses it lossily into a prompt, and classifies it with regex. This spec gives it a real
memory instead.

Related: [`08`](08-questionnaires.md) (questionnaires), [`63`](63-auto-checkins.md) (auto
check-ins), [`69`](69-questionnaire-intelligence.md) (personalization profile),
[`70`](70-adaptive-exploration.md) (candidate feed), [`49`](49-intimacy-activities-inventory.md)
(activity inventory), [`64`](64-your-story.md) / [`13`](13-dream-images.md) / [`67`](67-email-engagement.md)
(other `generateQuestions` callers).

## 2. Goals / Non-goals

**Goals**

- A questionnaire's **type + sensitivity tier govern** every other steering signal, always.
- Never re-ask ground already worked, at the **topic** level, not just the wording level.
- Coverage reflects what was **actually asked**, not what a regex could recognise.
- The topic vocabulary **grows with the person** — new ground is named as it appears.
- The system gets **smarter over time**: it learns which angles produce real answers and stops
  mining ones that produce skips.
- Scale to hundreds of questionnaires per person without the de-dup signal degrading.
- No regression on the five other paths that share this code.

**Non-goals**

- Changing auto check-in **cadence** (owner decision 2026-08-12: fix quality, not scheduling).
- Changing the answering, results, relay, compatibility or analysis surfaces.
- Changing the onboarding intimacy **matrix** (`49`) — it remains the intake UI; coverage simply
  stops depending on it for classification.
- Cost minimisation. The owner has explicitly prioritised quality over AI spend for this feature.

## 3. UX & flows

Mostly developer-facing; the three user-visible changes are:

1. **Draft with AI (manual).** Unchanged controls (brief, count, intimacy mode). The draft is
   preceded by a planning pass, so drafting takes marginally longer; the existing elapsed-time
   progress indicator already covers this (CLAUDE.md §12 realtime-progress rule).
2. **Explored tab ([`70`](70-adaptive-exploration.md) §3).** Rows are now the person's **emergent
   topic map** rather than 9 fixed life areas + 14 fixed intimacy categories, so the list is longer,
   more specific, and changes over time. Curation ("Ask me this" / "Not this" / "Go deeper") is
   unchanged and now steers the planner directly. Intimacy topics stay behind the existing 18+
   acknowledgement gate ([`70`](70-adaptive-exploration.md) §3.4).
3. **Nothing else changes.** Sending, answering, results, relay and compatibility are untouched.

**Generation flow (all six paths).**

```
gather (1 ledger read)  →  PLAN (AI: choose ground, name topics)
                        →  GENERATE (AI: write questions from threads, at tier)
                        →  DEDUP (AI: existing semantic pass, ledger-backed reference)
                        →  GUARD (deterministic: repetition + recitation)
                        →  LEDGER APPEND (topics tagged at write time)
```

## 4. Data model (vault files & schemas)

**New — the ask ledger.** `people/<personId>/questionnaires/askLedger.enc`, encrypted, owned by the
recipient (their record of what they have been asked). Appended when a send is created; never
recomputed by scanning sends.

```ts
export const AskLedgerEntrySchema = z.object({
  questionId: z.string().min(1),
  assignmentId: z.string().min(1),
  at: z.string(), // ISO — the send's createdAt
  type: z.string(), // questionnaire type as sent
  tier: SensitivityTierSchema,
  topicIds: z.array(z.string()).default([]), // tagged at write time (§5.3)
  gist: z.string().max(120).default(''), // compact restatement, NOT the prompt
  outcome: z.enum(['pending', 'rich', 'brief', 'skipped', 'declined']).default('pending'),
});

export const AskLedgerSchema = z.object({
  schemaVersion: z.literal(1),
  personId: z.string().min(1),
  entries: z.array(AskLedgerEntrySchema).default([]),
  backfilledAt: z.string().optional(), // set once the one-time classification pass has run
});
```

**New — the emergent topic map.** Added to the existing `PersonalizationProfile`
([`69`](69-questionnaire-intelligence.md) §4) as `topics`, replacing the derived-on-read
`coverage.topics` skeleton. Per-person, seeded from the built-in vocabulary, freely extended.

```ts
export const TopicSchema = z.object({
  topicId: z.string().min(1), // stable slug
  label: z.string().min(1),
  lifeArea: z.string(), // one of LIFE_AREAS — the parent bucket
  seeded: z.boolean().default(false), // true = came from the built-in vocabulary
  aliases: z.array(z.string()).default([]), // merge targets, so "verbal" folds into "dirty-talk"
});
```

**As built — every question carries TWO tags (§5.3 roll-up).** Running the first backfill against the real
vault exposed the emergent vocabulary's own failure mode: it FRAGMENTS a family across names no text
comparison can relate. Threesome ground had been worked **13 times** across five topics ("Threesomes",
"Threesome dynamics", "FFM threesome", "Finding a third / apps") while the built-in `Group & swinging` showed
**0 asks and read as OPEN**; bondage was 13 across two names; `Edge play` read as untouched after five. So a
question is now tagged with its closest **built-in family** (the roll-up that makes the family saturate) AND
its **specific ground** (precision), and each specific topic records the family as its `parentTopicId` so it
**inherits the family's closure** — the roll-up alone was only half a fix, since a closed family could still
be re-opened through one of its own narrower names. `mintTopics` also ADOPTS a family onto a pre-existing
orphan topic, so a re-tag repairs a map built under the older contract. `TAGGING_VERSION` on the ledger drives
that re-tag: bumping it makes the next reconcile re-classify existing history, because a filing correction is
worthless if it only reaches questions asked after it.

**As built — counts are DERIVED, not stored.** The draft carried `askedCount` / `richCount` / `lastAskedAt` /
`saturatedUntil` on the topic. They are instead derived from the ledger on read (`deriveTopicStats` →
`topicStatuses`), because a stored count is a second source of truth that can drift from what was actually
asked — the class of bug this spec exists to remove. The persisted topic is identity only.

`schemaVersion` stays 1 on `PersonalizationProfile` — `topics` is **additive-optional** and an absent
value derives from the seed vocabulary, matching the [`69`](69-questionnaire-intelligence.md) §4.1 /
[`70`](70-adaptive-exploration.md) precedent. The ask ledger is a **new file**, so it needs no
migration; it is populated by the §5.6 backfill.

**Ownership.** All reads/writes go through the vault service via `@selfos/core/questionnaires`. No
direct `fs`.

**Removed.** `IntimacyCoverage` as a persisted/derived steering input, `CATEGORY_KEYWORDS`, and
`categoriesMentionedIn` as the classification path. `INTIMACY_CATEGORIES` survives **only** as seed
vocabulary; `INTIMACY_ACTIVITIES_FULL` survives unchanged as the onboarding matrix ([`49`](49-intimacy-activities-inventory.md)).

## 5. Architecture & modules

### 5.1 The ask ledger (`questionnaires/askLedger.ts`)

The durable record of what a person has been asked: **one read**, appended in `createAssignment`, outcome
updated on submit.

**As built it SUPERSEDES the six full scans as the steering signal; it has not yet REPLACED them as code.**
The scans (`gatherRecipientAskedPrompts`, `gatherRecipientIntimacyAsks`,
`gatherRecipientQuestionnaireTitles`, `gatherRecipientPriorAnswersByAssignment`,
`countAnsweredQuestionnaires`, plus the nested call inside `gatherRecipientHistory`) still run on every
draft — ~1,148 decrypt ops — because two of them feed consumers the ledger cannot serve yet
(`gatherRecipientQuestionnaireTitles` → the gap-finder's avoid-list; `gatherRecipientPriorAnswersByAssignment`
→ Your Story's corpus, which needs whole answers, not gists), and the rest are the **pre-backfill fallback**:
until a person's `backfilledAt` is set the ledger is empty, so planning from it would tell the model almost
nothing has been asked. Removing them is a bounded follow-up gated on `ledgerAuthoritative`, not a rewrite —
but it changes the de-dup inputs on the highest-volume path, so it wants the same real-vault verification pass
that caught the defects in §1, and is deliberately not bundled with the steering fix.

The de-dup reference is rebuilt from **gists + per-topic counts** rather than raw prompts — the same
history at roughly a tenth the tokens, e.g. `dirty-talk — asked 8×, last 2 Aug` on one line instead of
eight 271-char prompts. Section caps are rebalanced accordingly (§7).

### 5.2 Saturation (topic-scoped + cooldown)

A topic saturates at `askedCount >= SATURATION_ASKS`. Re-opening requires **topic-relevant** new
material, an explicit request, or dormancy — never an unrelated insight (**D3**).

**As built — how "topic-relevant" is resolved.** `topicsWithNewMaterial` matches the person's own material
(their own-subject insight summaries + facts, `#129`-filtered) against topic labels, deterministically and for
free — no classification pass. Two rules keep it honest: material must be **newer than that topic's last ask**
(otherwise the answers a topic produced would immediately re-open it and it could never saturate), and every
content word of the topic's name must appear (a conservative mention test that won't fire on one shared word
like "play" or "body"). The cooldown floor still applies on top, so a re-open can never cause an immediate
re-ask. Supplied by the manual bridge draft and the auto check-in path; a caller that omits it simply gets
request/dormancy re-opening. A re-opened topic additionally carries `saturatedUntil`, a
hard floor (default 14 days) that no signal overrides, so the mechanism cannot silently go inert
again.

**As built — the floor gates RE-OPENING only.** Applying the cooldown to every recently-touched topic was
verified against the real vault to leave **1 of 14** areas open and to shut the two LEAST-worked ones (asked
once and twice), which would have pushed the planner to invent new ground while obvious ground sat unused. The
floor therefore applies only once a topic has reached the ask threshold; ground with headroom stays open. With
that correction the same real history yields **3 of 14** open — the three least-worked, all on-register.

### 5.3 Tagging at write time (replaces keyword regex)

The **generation** pass returns, per question, the `topicIds` it is covering and a ≤120-char `gist`,
alongside the question itself — it already knows what it is asking, so accuracy is far higher than
post-hoc matching at near-zero cost (**D4**). Unknown topic ids are **minted** into the person's map
(normalised + alias-merged so near-synonyms don't fork). This unifies intimacy with the general life
areas, which already mint emergent sub-topics via
[`69`](69-questionnaire-intelligence.md)'s `applyCoverageAssessments`.

### 5.4 Answer-quality learning

On submit, each entry's `outcome` is set deterministically (declined / skipped / brief / rich, by
answer length + type). A topic whose recent outcomes are mostly skipped/declined is treated as
saturated **regardless of count**, and the planner prefers veins with a high `richCount`. This is the
signal the app currently cannot see at all.

### 5.5 The planner (`questionnaires/planService.ts`)

A new metered pass, `questionnaire.plan`, run before generation on **every** path. Input: type, tier,
recipient framing, the topic map with counts/outcomes, curation pins, and the feedback guidance.
Output: `{ threads: [{ topicId?, label, angle }] }` — **threads, not finished questions** (owner
decision: this is what produced the near-verbatim repeat).

Generation then receives **only** the chosen threads + the register + who the recipient is. This is
the quality argument: today's 8,412-char prompt is ~50% steering, some of it contradictory, so the
model arbitrates instructions instead of writing. `buildCandidateGuidance` and `buildCoverageGuidance`
are **removed from the generation prompt entirely** and become planner inputs (**D1**, **D2**). The
register is restated as governing in the generation prompt.

### 5.6 Backfill

A one-time, bounded, metered classification pass per person over existing sends seeds the ledger and
topic map, so saturation is correct immediately rather than blind for weeks. Idempotent, guarded by
`backfilledAt`, and fail-safe (a failed backfill leaves the ledger empty and the app behaves as today). It
rides the existing daily reconcile cadence, ahead of the coverage/candidate passes.

**As built — the ledger is authoritative only once `backfilledAt` is set.** Until then generation keeps the
legacy intimacy-coverage steering and skips the planner entirely. Without this there is a migration window in
which the ledger is empty or partial, so planning from it would tell the model almost nothing had been asked —
worse than the engine being replaced. The switch is therefore clean rather than gradual.

### 5.8 The Explored tab shows the map (owner decision 2026-08-12)

`foldTopicMap` first overlays real ask counts onto the existing life-area rows. On top of that, **each area row
expands to reveal the specific ground inside it** — every topic, worked-through ones included, with its real
ask count, an open / worked-through / left-alone state, and a `new ground` marker on anything the model named
itself. Without this the rebuild's most interesting output was invisible: the app knew ten new things about a
person and showed them none.

Three decisions, all the owner's:

- **Intimacy is included**, behind the same 18+ acknowledgement as the rest of its row. This knowingly reverses
  [`70`](70-adaptive-exploration.md) §3.4's aggregation (recorded there): explicit labels now appear on screen
  once acknowledged, in exchange for a person being able to see and steer their own ground.
- **"Leave alone" is a 90-day cooldown, never a ban.** It persists as a new `left-alone` feedback kind —
  deliberately distinct from `not-applicable`, which is a per-question "this isn't about me" that stays true —
  and lapses on its own, so the person can change their mind by doing nothing. Tapping again lifts it early.
- **Every topic is listed**, not only open ones: seeing what it has already covered is most of the point.

The row is **two lines** (name, then count · state · action). A single line was built first and visual QA
against the real app showed the §12 failure it warns about — with the sub-nav beside it the column is ~700px,
so a label fought the badge and wrapped a word at a time while the action dropped to its own line. Topic
actions carry a per-topic accessible name (`Leave <topic> alone`); a list of thirty buttons all named "Leave
alone" is unusable with a screen reader and ambiguous against the area-level steer of the same name.

### 5.7 Deterministic guards

- **Repetition guard** — refuse/replace a question whose topics are all saturated for that recipient,
  independent of the AI de-dup pass.
- **Recitation guard** — reject a question that restates a known fact back at the person
  (`You've said/marked/mentioned X…`), which `GENERATION_SYSTEM` already forbids and 7+ of the
  recipient's real questions do.
- **Bounded deepening** — the go-deeper act list is capped to the acts within this set's target
  ground (**D3**), not all 101.

### 5.8 Call sites migrated (blast radius)

All six must move together: the manual bridge draft (`coreBridge.questionnairesGenerate` + the
suggestion-materialize path), `autoCheckins/service.ts`, `dreams/dreamQuestionnaireService.ts`,
`story/storyInterviewService.ts`, and `email/emailSchedule.ts` (via
`gatherRecipientFeedbackGuidance`). `coverageService.ts` (the candidate refresh) is re-pointed at the
topic map.

### 5.9 Topic-map hygiene

An emergent vocabulary only stays useful if something prunes it. Left alone it grew to **341 topics for 277
questions** on a real map — roughly one name per question, and once §5.8 made the map visible, the Explored tab
listed rows like _"Bottling one thing"_ and _"What felt different"_. Three causes, three fixes:

- **Re-tagging orphaned old names.** Each pass mints labels for what it sees and leaves the previous pass's
  behind, referenced by nothing (11 such on the real map). `pruneTopicMap` drops any emergent topic the ledger
  doesn't reference; seeded families always survive, since they are the roll-up vocabulary.
- **Separate passes coined the same ground twice.** `mintTopics` resolves only against the map as it stands, so
  two runs can independently name one thing. The GC folds near-duplicates into the best-attested name,
  rewriting the ledger's `topicIds` so no count is lost.
- **The classifier named per QUESTION, not per topic** — it sees one question at a time and cannot know what
  recurs. Tightening the prompt toward durable ground ("could ten questions sit under this?") helped and did
  not solve it: 165 emergent topics still backed exactly one question. So the DATA decides: a name must be
  arrived at independently **`MIN_TOPIC_SUPPORT`** times to become a topic. Below that the question keeps its
  family tag — nothing is lost for saturation or de-dup, the map just doesn't grow a row — and a name that
  genuinely recurs is promoted on the next pass.

Result on the same real map: **341 → 75 topics (24 seeded, 51 emergent), zero backed by fewer than two
questions**, and labels that read as areas of a life ("Being overpowered", "Estrangement", "Spontaneous
initiation"). Residual near-duplicates survive where labels share too few words to merge ("Genuine rest" vs
"Restorative rest"); they are real ground with real support, and the roll-up family carries saturation either
way, so over-merging would cost more than it saves.

The GC runs at the end of every backfill/re-tag and is idempotent.

## 6. IPC / API contracts

**No new renderer-facing IPC channels.** The planner, tagging and backfill are host-side, inside the
existing gated `questionnaires:generate` / auto-checkin / story / dream / email paths. The Explored
tab keeps its existing [`70`](70-adaptive-exploration.md) channels; only the shape of the rows it
receives changes (emergent topics rather than a fixed list). The Claude key stays in main.

**Claude calls.** New `questionnaire.plan` (bounded JSON, `extendedThinking: false`, tolerant parse
per [`37`](37-ai-output-robustness.md), fail-safe → fall back to coverage-only steering). Generation's
response shape gains `topicIds` + `gist` per question, parsed per-element so a missing tag degrades to
"untagged" rather than dropping the question. Backfill is a separate bounded classification pass.

## 7. States & edge cases

| Case                                  | Behaviour                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| No ledger yet (new person)            | Planner runs on the seed vocabulary; everything is new ground.                                           |
| Backfill not yet run                  | App behaves as today (no saturation signal), then self-heals on first backfill.                          |
| Backfill fails / over budget          | Ledger stays empty, `backfilledAt` unset, retried on next run. Never blocks drafting.                    |
| Planner fails (AI off, budget, parse) | **Fail-safe:** fall back to deterministic coverage steering; generation still runs.                      |
| Question returns no `topicIds`        | Entry stored untagged; counts unaffected. Never drops the question.                                      |
| Every topic saturated                 | Planner is told to open genuinely new ground and may mint new topics; never re-mines.                    |
| All threads rejected by guards        | Honest empty result ("nothing new to ask right now"), never filler ([`08`](08-questionnaires.md) §27.5). |
| Ledger corrupt                        | Tolerant parse → treated as empty; generation degrades to today's behaviour, never throws.               |
| Sync conflict on the ledger           | Append-only entries, merged by `questionId`; last-write-wins on `outcome`.                               |
| Hundreds of sends                     | One read; reference is gists + counts, so token cost is ~flat in history size.                           |
| Migration from `IntimacyCoverage`     | Seeded topic map reproduces the 14 categories, so day-one behaviour is no worse.                         |

## 8. Safety

The not-medical boundary and the consensual-adult boundary are **unchanged and non-negotiable**: the
`SAFETY` prefix, the explicit-tier boundary clause (consenting adults only; taboo strictly as
fantasy/roleplay; never minors, real non-consent, or illegal acts), the 18+ acknowledgement gate, and
crisis routing all keep their current wording and placement. The planner inherits the same `SAFETY`
prefix and the same boundary; it may name ground but never loosens the boundary. Emergent topics are
**names for ground already in the person's own material** — the taxonomy cannot introduce subject
matter the boundary excludes, and the boundary is enforced in the prompt and by the model, never by a
keyword filter ([`49`](49-intimacy-activities-inventory.md)). Intimacy topics remain gated behind the
shared 18+ acknowledgement on every surface. Restricted facts continue never to cross the sharing
gate. The ledger stores a **gist**, not answer content.

## 9. Accessibility

The Explored tab's existing semantics are preserved (labelled sections, text-not-colour-only status,
keyboard-reachable curation controls, `aria-current` on the active section). A longer, emergent topic
list must keep the [`70`](70-adaptive-exploration.md) sub-nav behaviour and the §12 no-horizontal-scroll
rule at 360px; topic labels ellipsize with `min-width: 0` rather than wrapping a word per line.

## 10. Testing strategy

- **Unit (core).** Ledger append/read/merge; outcome classification; saturation (topic-scoped
  re-open, cooldown floor, quality-based saturation); topic minting + alias merge; planner parse +
  fail-safe; repetition and recitation guards; bounded deepening.
- **Prompt assertions (the gap that let D3 ship inert).** Assert **what actually reaches the model**
  for a realistic heavy-history person: the register governs, no off-type ground appears in a typed
  draft, saturated ground is absent, and the go-deeper block is bounded. Each must be verified to
  **fail when the fix is reverted**.
- **Regression fixtures from real shapes.** A fixture reproducing the reported case (9 intimacy
  categories past threshold, 272 asks, 34% untagged) must show saturation firing and the reported
  questions being blocked.
- **Integration (coreBridge).** Two-persona: ledger is recipient-scoped; the author never sees it;
  generation stays author-blind ([`08`](08-questionnaires.md) §17.4).
- **The other five paths.** Auto check-ins, dream questionnaires, Story interview, email suggestions
  and the suggestion-materialize path each keep a green test proving no regression.
- **E2E.** Draft with AI end-to-end, decrypting the vault to assert ledger entries and topic tags
  persisted; Explored tab renders emergent topics and curation still steers.
- Vault and Claude are mocked as today (`memFileSystem`, the offline fake). Per CLAUDE.md §6 the fake
  must be **imperfect** — it returns untagged and mis-tagged questions so the degradation paths are
  genuinely exercised.

## 11. Open questions

_All resolved with the owner on 2026-08-12:_

1. Steering on a typed questionnaire → **planner decides ground; candidate/coverage blocks removed
   from the generation prompt.**
2. Planner shape → **a separate on-demand planning call**, on every path including auto check-ins.
3. Candidate feed shape → **threads/angles, never finished question text.**
4. General coverage block → **scoped to the type; the tier register always governs.**
5. Saturation → **topic-scoped re-open + a hard cooldown floor.**
6. De-dup budget → **restructured onto the ledger (gists + counts), caps rebalanced.**
7. Ask ledger → **build it and migrate all consumers onto it.**
8. Answer quality → **record it and steer on it.**
9. Taxonomy → **per-person, seeded from built-ins, freely emergent.**
10. Backfill → **yes, one-time AI classification of existing history.**
11. Scope → **unify intimacy and general life areas into one model.**
12. Cadence → **unchanged; fix quality only.**
13. Delivery → **spec approved first, then a single PR.**

## 12. Changelog

- 2026-08-13 — **Follow-up: topic-map hygiene (§5.9).** Making the map visible (§5.8) exposed that it had grown
  to 341 topics for 277 questions — one name per question, with orphans left by each re-tag. Added
  `pruneTopicMap` (drop unreferenced, fold cross-run duplicates), tightened both tagging prompts toward durable
  ground, and made support the deciding rule: a name must recur to become a topic. **341 → 75 topics, zero
  singletons**, on the real map.
- 2026-08-13 — **Fix: the recitation guard now catches asserted past BEHAVIOUR (§5.7).** Found by drafting a
  real unfiltered questionnaire for a real recipient — not by a test. The ground was right (the planner opened
  her only two remaining topics and NAMED THREE NEW ONES the taxonomy has no word for — "Aftercare & coming
  down", "The ask itself", "Fantasy vs. want-to-do-it" — the emergent behaviour working), but one question read
  _"You know your exhibitionism is real — you and Ben have already broadcast yourselves live."_ Generation is
  **author-blind** (§17.4): the recipient's material feeds the model host-side and must never come back in
  question text, which the AUTHOR reads in the builder. `hasRecitation` only matched attribution VERBS
  ("you've said / you marked"), so an assertion of established behaviour sailed through. Added three patterns —
  `you (and X) have already <verb>`, `as you mentioned`, `given that you rated` — each kept narrow, with an
  `if` lookbehind so a legitimate conditional ("if you've already tried it, what changed?") is not dropped;
  the guard drops a question outright, so a false positive costs a real one. Test pins BOTH directions and is
  verified to FAIL when the patterns are reverted.
- 2026-08-13 — **Polish: the catch-all bucket is filtered out of the ground summaries (§5.2).** Verifying the
  selector change on the real vault showed `Other` — the catch-all seed topic — being offered to BOTH members
  as ground to PREFER. It stays in the map and keeps collecting asks (it is real ground), but as steering it
  says nothing: "prefer Other" and "don't build around Other" are equally useless to a model. `groundSummary`
  now drops `CATCH_ALL_TOPIC_ID` from both lists, so `nextOpenGround` inherits the fix and can never make it a
  FOCUS either. Emergent topics parented to it keep their own real labels and still surface — the guard pins
  that, deliberately leaving the parent OPEN, since a child correctly INHERITS a closed family's closure and
  would otherwise be hidden for the right reason. Verified after: Angel 7 → 6 open, Ben 9 → 8, nothing else moved.
- 2026-08-13 — **Follow-up: the TOPIC SELECTOR sees the ledger too (§5.2).** A class sweep after the one-engine
  fix — the same shape, on the majority path. The gap-finder SELECTS the topic for every non-intimacy check-in
  and its rationale becomes the slot brief, i.e. the governing `FOCUS` line; but it steered only on prior
  TITLES, which are opaque (`"The Art of You"` says nothing about what it covered). Measured on the real vault
  before changing anything: **53 of Angel's 58 non-intimacy topics were saturated** (Relationships 59 asks,
  Emotions & patterns 41) while the selector saw only 57 titles — so it could aim a check-in at ground worked
  59 times while five topics sat open. It now receives the ledger's worked-through and barely-touched ground
  (`groundSummary`, type/tier-scoped) on both call sites (auto engine + the Suggested panel), as prompt
  steering rather than a hard filter, since the planner and question-level de-dup already bound the damage
  downstream. Guarded on both paths, each verified to FAIL when the wiring is reverted.
- 2026-08-13 — **Follow-up: one engine decides ground (§5.2).** The auto check-in engine's intimacy slot still
  chose its focus from the LEGACY keyword coverage map (`nextIntimacyCategory`) while the planner chose from the
  ledger — two engines disagreeing on the path that carried 13 of 22 real intimacy sends, and §1 had already
  measured the legacy one as missing a third of what had been asked with its saturation never firing. Because
  the slot's brief GOVERNS generation, the wrong engine's ground silently overrode the planner downstream. The
  brief now takes its ground from `nextOpenGround` (ledger + topic map, type/tier-scoped) whenever the ledger is
  authoritative; the legacy map survives ONLY as the pre-backfill fallback, which is why it is not deleted.
  Guarded by a structural differential: every seeded intimacy topic is worked through in the ledger, leaving one
  EMERGENT topic the built-in taxonomy has no word for, so only the ledger can name the focus — verified to FAIL
  when the wiring is reverted. §5.1 corrected: the ledger supersedes the six scans as the SIGNAL, but they still
  run as code; that removal is a separate, real-vault-verified follow-up.
- 2026-08-13 — **Follow-up: the topic-scoped re-open is now live (§5.2).** The parameter shipped inert — no
  caller supplied it — so worked ground only re-opened via an explicit request or 90-day dormancy, never
  because the person had since said something about it. `topicsWithNewMaterial` resolves it deterministically
  from their own insights (newer-than-last-ask + full-label mention), wired into the manual and auto paths.
  The unscoped behaviour is pinned by a guard **verified to fail when reverted**. This closes the last item
  carried on the spec.
- 2026-08-12 — **Follow-up: the Explored tab shows the emergent map (§5.8).** Area rows expand to the specific
  ground inside them — all topics, real counts, open/worked/left-alone state, a `new ground` marker. Owner
  decisions: Intimacy included behind the existing 18+ ack (reverses [`70`](70-adaptive-exploration.md) §3.4),
  "Leave alone" is a bounded 90-day `left-alone` steer rather than a ban, all topics listed. Mockup approved
  first; visual QA against the real app caught a §12 row-wrap failure that a single-line design would have
  shipped.
- 2026-08-12 — **Follow-up: vocabulary fragmentation (§4/§5.3).** Found by running the shipped backfill against
  the real vault and inspecting the result: the emergent taxonomy split one family across several names, so a
  heavily-worked area read as untouched and OPEN (`Group & swinging` 0 asks after 13; `Edge play` 0 after 5).
  Fixed with a mandatory roll-up tag + `parentTopicId` closure inheritance + singularized label matching +
  `TAGGING_VERSION`-driven re-tagging of existing history. Verified on the real vault: `Group & swinging` 0 →
  **9 asks, closed**, every fragmented child now closed with it, open intimacy ground down to the three
  genuinely least-worked areas. Also removed `buildCandidateGuidance`, dead since §5.5.
- 2026-08-12 — **BUILT.** Ask ledger + emergent topic map + planner + backfill + guards, wired through all six
  generation paths. Gate green: typecheck (4 pkgs), lint, format, **2003 core + 1563 desktop** unit, **202
  E2E**. Both prompt guards verified to FAIL when the fix is reverted (§10). Re-verified against the real
  vault: 272 asks seeded, 11 of 14 intimacy areas correctly saturated (was `saturated: []`), zero off-type
  ground in an unfiltered plan prompt, de-dup reference 74,146 → 7,556 chars carrying **all** 272 asks instead
  of 2.7% of them. As-built deviations recorded in §4/§5.2/§5.6.
- 2026-08-12 — created. Root causes D1–D5 reproduced against a real vault (61 sends, 272 questions,
  99 intimacy questions, 101 rated acts); all 13 design decisions resolved with the owner.
