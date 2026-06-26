# 48 — Intimacy & connection guided sessions (expanded set)

> **Status:** Draft · _last updated 2026-06-25_
>
> The guided-session catalog ([`16`](16-guided-sessions.md)) ships only **three** "Intimacy & connection"
> exercises (Sensate Focus, Desire Discrepancy, Talking About Sex), all conservative/non-explicit. This spec
> greatly expands that one group into a full set spanning relational connection through explicit, in-policy
> sexual exploration (kink/power-exchange included) — plus ONE new **structured** exercise (a Yes/No/Maybe
> list builder). It is **mostly additive content** in the existing built-in catalog: a guided session is an
> ordinary [`05`](05-conversations.md) Conversation carrying `guideId`, so there is **no new machinery** —
> streaming, metering, lifecycle, summarize, and the 18+ gate all already exist and are reused unchanged.

Builds directly on [`16-guided-sessions.md`](16-guided-sessions.md) (the launcher, the `GuidedExercise`
catalog, the `[[SELFOS:STEP:n]]` step mechanism, the per-person 18+ acknowledgement). Reuses the in-policy
**explicit-framing register** established by [`08-questionnaires.md`](08-questionnaires.md) §16.5
(`intimacyExplicitFraming`) — explicit intimacy content is in policy when framed as consensual-adult sexual
wellness. References [`05-conversations.md`](05-conversations.md) (persona/safety/crisis),
[`09-session-analysis.md`](09-session-analysis.md) (complete → summarize → Insight),
[`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (metering), and
[`04-people-roles.md`](04-people-roles.md) (context), rather than restating them (DRY). Looks forward to the
expanded intimacy inventory (**spec 49**), the kink inventory test (**spec 50**), and the challenge sessions
(**spec 52**) — see §13 — but depends on **none** of them; every exercise here works standalone today.

---

## 1. Overview

SelfOS already does guided sessions (`16`): the Sessions launcher offers a curated, framework-informed catalog
grouped into **Reflective & therapy-informed · Coaching · Intimacy & connection**, each a normal conversation
pre-steered by a `systemPromptAddendum`. The Intimacy group is the thinnest and most timid of the three — three
relational/communication exercises, none explicit — even though the rest of SelfOS (the onboarding intimacy
block, `27`/`46`; the questionnaire explicit tiers, `08` §16.5) already supports frank, in-policy sexual
content for consenting adults behind the 18+ gate.

This spec brings the guided-session group up to that same level. It adds:

1. **More relational/connection exercises** (reigniting the spark, repair after a rupture, love maps, bids &
   appreciation, non-monogamy agreements & jealousy, feeling desirable / body image, intimacy after a life
   change) — `kind: 'chat'`, in the register the existing three already use.
2. **Explicit/sexual exercises** (fantasy exploration, kink & power-exchange, dirty-talk practice, working
   through sexual shame, exploring a specific act, mismatched libido & initiating, sexting / long-distance,
   edging & mindful arousal, aftercare & post-sex check-ins) — `kind: 'chat'`, written in the §08 §16.5
   consensual-adult sexual-wellness register so they are genuinely useful, not euphemistic.
3. **One structured exercise** — a **Yes/No/Maybe list builder** that walks the person through categories of
   sexual interests, sorting each into Yes / No / Maybe, using the `[[SELFOS:STEP:n]]` stepper.

All of these are entries in the existing `group: 'intimacy'` set, all `adult: true`, all gated by the existing
per-person 18+ acknowledgement (`16` §8.3). Picking any of them starts an ordinary session that completes,
summarizes, meters, and feeds memory exactly like the current intimacy exercises.

This is the first SelfOS spec whose primary deliverable is **catalog content + one structured exercise**, not
new architecture. The discipline is therefore in §8 (safety/voice for explicit content) and §5/§7 (the one
real code change — the structured exercise + the test the structured-set assertion forces).

## 2. Goals / Non-goals

**Goals**

- **Greatly expand the Intimacy & connection guided-session group** from 3 to a full set, spanning relational
  connection → explicit, in-policy sexual exploration (sensual through kink/power-exchange).
- Ship the explicit sessions in the **genuinely useful, in-policy register** of `08` §16.5
  (`intimacyExplicitFraming`) — frank and specific where the topic calls for it, never euphemistic — within the
  unchanged consensual-adult boundary.
- Add **one structured exercise** — the **Yes/No/Maybe list builder** — using the existing
  `[[SELFOS:STEP:n]]` stepper, so the person works through interest categories and sorts each Yes/No/Maybe.
- Keep this **purely additive in the catalog + one structured exercise**: no schema change, no new IPC, no new
  capability, no new nav — a guided session is already an ordinary Conversation carrying `guideId` (`16` §4.2).
- Keep all of it behind the **existing 18+ acknowledgement** (`16` §8.3) and the consensual-adult /
  within-Anthropic-policy boundary, stated in **every** addendum and led by PERSONA + SAFETY.

**Non-goals (deferred / out of scope)**

- **Persisting the Yes/No/Maybe list as structured data.** v1 the builder's output is its **transcript** + (via
  `09`) its SessionInsight, like every guided session. A durable, queryable Yes/No/Maybe / kink inventory is
  **spec 50** (the kink inventory test); this spec leaves a forward link (§13) but does **not** depend on it —
  the builder is a useful guided conversation now. (Open question §11.3 — confirm.)
- **New schema, IPC, capability, or nav.** None are needed (§4/§6). Reusing `guideId`, `chat:stream`,
  `sessions:startGuided`, `guided:getState`, `guided:acknowledgeAdult`, and the `intimacy` group is the entire
  mechanism.
- **A new safety/consent gate beyond `16` §8.3.** The per-person 18+ acknowledgement that already gates the
  Intimacy group covers these (they are reflective/relational conversations, not explicit media; the DOB+consent
  ceremony stays the questionnaire-relay concern, `08` §8.3). (Open question §11.2 — register depth per session.)
- **Expanding the other two groups, the launcher chrome, the recommender engine, or the structured-step
  mechanism.** Those are `16`'s; unchanged here.
- **User-authored intimacy exercises** — still the built-in curated catalog (`16` §2 non-goal).
- **The expanded intimacy inventory (spec 49) and challenge sessions (spec 52).** Forward-linked (§13), not
  built here.

## 3. UX & flows

This is `16`'s launcher and lifecycle, unchanged — these exercises **just appear as more cards** in the existing
**Intimacy & connection** group. No new screen, no new control. The flows below are the `16` flows as they apply
to this group; nothing here changes the launcher's structure.

### 3.1 Discovery — more cards in the existing group

- On the Sessions **launcher** (`16` §3.1), the **Intimacy & connection** collapsible group (`16` §3.2) now
  renders the full set as a grid of cards — each `title` + `framework` tag + one-line `blurb` (`16` §4.1), the
  identical card pattern the current three use. The group is **gated** exactly as today (`16` §8.3): its content
  shows only once the person has made the one-time **18+ acknowledgement**; before that, the group renders its
  age-gate prompt and the cards stay hidden.
- The group stays **excluded from "Suggested for you"** until acknowledged (`16` §3.4/§8.3) — these (now
  more numerous) intimacy exercises are filtered out of the recommender's candidate set until the ack
  (`suggestGuidedSessions(..., { adultAllowed })`, the existing filter on `e.adult`, reused verbatim). After
  the ack, the recommender may suggest them like any other catalog exercise.
- The structured **Yes/No/Maybe list builder** appears as a card in the group like the others; its card shows
  its framework tag (e.g. "Sexual self-discovery") and a "Steps" affordance (the existing structured-card
  marker, `16` §3.2 ⚙).

### 3.2 Starting & running a chat exercise (most of the set)

Identical to `16` §3.3 (guided chat):

1. The person taps an intimacy card. `sessions:startGuided({ guideId })` (`16` §6) creates a Conversation
   stamped with that `guideId` (scoped to the active person, `sessions.own`), seeds the exercise's **static
   opening message** as the first assistant turn (no model call — works offline, `16` §11.4), and opens the
   thread.
2. Each turn's system prompt = PERSONA + SAFETY + the person's context + the exercise's `systemPromptAddendum`
   (+ FORMATTING), assembled host-side by `buildSystemPrompt` (`16` §5, `promptBuilder.ts`). The addendum is
   appended **after** PERSONA + SAFETY + context, so the not-therapy / consensual-adult boundary always leads.
3. It then flows as a normal streaming chat (`05`). The person can go off-script anytime; the addendum steers,
   it never locks.
4. The always-present **CrisisFooter** (`05` §7) shows on every session, intimacy or not.

### 3.3 Starting & running the structured Yes/No/Maybe builder

Identical to `16` §3.3 (structured exercise):

1. Tapping the **Yes/No/Maybe list builder** card creates a Conversation with its `guideId` + `guideStep: 0`,
   seeds its static opener, and opens the thread with a **GuidedStepper** beside it (`16` §3.3) showing the
   builder's named steps (§5.2).
2. The coach walks the person through each category, sorting items into **Yes / No / Maybe** as they go, and
   silently appends `[[SELFOS:STEP:n]]` at the end of each reply to advance the stepper (`16` §3.3,
   `guidedSteps.ts` — the marker is stripped from saved + streamed text and the person never sees it). The
   stepper is best-effort orientation; free input is never blocked.
3. At the end the coach reflects the assembled Yes/No/Maybe summary back **in the conversation** (no separate
   store, v1 — §2 non-goal / §11.3), then naturally leads into the wrap-up (§3.4).

### 3.4 Completion & memory

Unchanged from `16` §3.5 / `09`: any of these sessions carries a lifecycle status, can be **marked complete**,
and **End & summarize** produces a SessionInsight that notes the exercise (`provenance.guideId`) and feeds the
person's **own** context. There is no separate "exercise outcome" store — the Yes/No/Maybe builder included
(v1). Per-session cost shows per `09` §14.3 (admin-only $). The intimacy life-areas the group foregrounds in
portrait-fact selection (`guideLifeAreas('intimacy')` → `['Intimacy', 'Relationships']`, `guidedCatalog.ts`)
apply to every entry here unchanged.

### 3.5 The session set (initial proposal — trim/add in §11.1)

Each entry below is a full `GuidedExercise` (`16` §4.1: `id` · `group:'intimacy'` · `title` · `framework` ·
`blurb` · `kind` · `openingMessage` · `systemPromptAddendum` · `adult:true`; structured also `steps`). The
**existing three** (`sensate-focus`, `desire-discrepancy`, `talking-about-sex`) stay as-is. Final per-card copy
is tuned at build; the `id`s, `kind`s, and framework tags below are the spec. The complete `openingMessage` +
`systemPromptAddendum` strings are written at build in the house style — each addendum **leads** with
`frame(framework)` (the shared `guidedCatalog.ts` not-therapy preamble) and the consensual-adult /
within-Anthropic-policy boundary, exactly like the current intimacy entries; explicit entries additionally
adopt the `08` §16.5 sexual-wellness register (§8.3). The intended steering for each is given so the build is
unambiguous.

#### Relational / connection — all `kind: 'chat'`

| id                        | title                                | framework tag            | blurb (one line)                                        | steering (systemPromptAddendum intent)                                                                                                                                                                                               |
| ------------------------- | ------------------------------------ | ------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reigniting-the-spark`    | Reigniting the Spark                 | Esther Perel / desire    | Rebuild erotic charge after it has faded.               | Explore how closeness can dampen desire (the intimacy↔mystery tension); help them find small ways to reintroduce novelty, anticipation, and play; non-explicit but warm.                                                             |
| `repair-after-rupture`    | Repair After a Rupture               | Gottman repair           | Reconnect after a fight or hurt in the relationship.    | Help them process the rupture without blame, take their share, and craft a repair attempt + a re-approach; route real safety concerns (abuse) to help.                                                                               |
| `love-maps`               | Love Maps                            | Gottman                  | Get to know your partner's inner world more deeply.     | Guide them to map their partner's world (stresses, hopes, history, current life) and notice gaps; frame as building friendship as the base of intimacy.                                                                              |
| `bids-and-appreciation`   | Bids & Appreciation                  | Gottman (turning toward) | Notice and turn toward your partner's small bids.       | Teach bids for connection and turning toward/away/against; help them spot missed bids and practise appreciation + responsiveness.                                                                                                    |
| `non-monogamy-agreements` | Agreements & Jealousy (Non-Monogamy) | Ethical non-monogamy     | Build clear agreements and work with jealousy.          | Help them articulate desires, boundaries, and agreements for an open/poly arrangement, and work with jealousy as information; non-judgemental of the relationship structure; route distress to help.                                 |
| `feeling-desirable`       | Feeling Desirable                    | Body image & self-worth  | Reconnect with feeling wanted and at home in your body. | Explore body image and feeling desirable/desiring; separate self-worth from appearance; gentle, never appearance-prescriptive; watch for distress/disordered patterns and route to help.                                             |
| `intimacy-after-change`   | Intimacy After a Life Change         | Adjustment & connection  | Rebuild intimacy after kids, illness, or meds.          | Normalize that intimacy shifts after major changes (a baby, illness, medication, menopause); help them grieve the old normal, communicate, and find what works now; encourage medical care for medical issues, never medical advice. |

#### Explicit / sexual — `kind: 'chat'` except the structured builder

These adopt the `08` §16.5 in-policy register (frank, specific, consensual-adult sexual wellness) within the
unchanged boundary (§8.3). `kind: 'chat'` unless noted.

| id                       | title                            | framework tag                  | blurb (one line)                                                | steering (systemPromptAddendum intent)                                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------- | ------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fantasy-exploration`    | Fantasy Exploration              | Sexual self-discovery          | Explore and understand your sexual fantasies.                   | Help them name, explore, and feel okay about their fantasies (taboo fantasies framed strictly as fantasy/roleplay, e.g. consensual non-consent as pre-agreed roleplay), distinguish fantasy from a wish to enact, and consider sharing some with a partner.                      |
| `kink-power-exchange`    | Kink & Power Exchange            | Kink (D/s)                     | Explore kink, D/s dynamics, negotiation, and aftercare.         | Explore kink and power-exchange (D/s, dominance/submission, roles) frankly and non-judgementally; centre **negotiation, consent, safewords, and aftercare**; emphasise SSC/RACK-style risk-awareness; route any non-consensual or unsafe real-world situation to help.           |
| `dirty-talk-practice`    | Dirty-Talk Practice              | Erotic communication           | Build confidence talking dirty with a partner.                  | Help them find words and confidence for erotic talk — what to say, how to start, matching a partner's taste; can be explicit; respectful and consent-forward; never coercive.                                                                                                    |
| `yes-no-maybe-builder`   | Yes / No / Maybe List            | Sexual self-discovery          | **(Structured)** Sort sexual interests into Yes, No, and Maybe. | **STRUCTURED** — walk through interest categories one step at a time (§5.2), sorting each item Yes/No/Maybe; reflect the assembled list back; frame as self-knowledge + a tool to share with a partner; consent-forward; explicit where apt.                                     |
| `sexual-shame`           | Working Through Sexual Shame     | Sex-positive / self-compassion | Loosen shame and inhibition around sex.                         | Gently explore where sexual shame/inhibition came from (upbringing, messages, experiences), apply self-compassion, and reframe desire as healthy; **especially trauma-aware** — if shame traces to abuse/assault, slow down, validate, and route to professional support (§8.4). |
| `exploring-an-act`       | Exploring a Specific Act         | Educational / consent          | Understand a specific act you're curious about.                 | Take a curious, **consent-forward, educational** stance toward a specific act they want to understand (mechanics, safety, communication, how to try it well together); explicit where needed; never pressure; safety + consent first.                                            |
| `mismatched-libido`      | Mismatched Libido & Initiating   | Sex therapy / desire           | Navigate different sex drives and how to initiate.              | Like Desire Discrepancy but action-focused: responsive vs spontaneous desire, initiating and turning toward, reducing pressure/rejection cycles; can be frank; encourage a qualified sex therapist for persistent distress.                                                      |
| `sexting-long-distance`  | Sexting & Long-Distance Intimacy | Erotic communication           | Keep desire alive across distance.                              | Help them build erotic connection at a distance — sexting, voice/photos (with a note on privacy/consent and never sharing without consent), anticipation, scheduling intimacy; explicit where apt; consent + privacy forward.                                                    |
| `edging-mindful-arousal` | Edging & Mindful Arousal         | Mindful sexuality              | Slow down and savour arousal, solo or together.                 | Guide mindful arousal/edging — staying present, building and sustaining arousal, savouring rather than rushing to climax; solo or partnered; explicit where apt; body-positive.                                                                                                  |
| `aftercare-checkins`     | Aftercare & Post-Sex Check-ins   | Aftercare                      | Care for each other after sex or a scene.                       | Help them build aftercare and post-intimacy check-ins — emotional and physical care, drop, debriefing a scene, what each needs afterward; centre attunement and consent.                                                                                                         |

That is **16 new intimacy entries** (15 chat + 1 structured) on top of the existing 3 → a **19-entry** Intimacy
group. The set, the names, and the per-session register are explicitly open for the user to trim/add (§11.1,
§11.2, §11.4).

## 4. Data model (vault files & schemas)

**N/A — no schema change.** This is the whole point of the design: a guided session is already an ordinary
`05`/`09` Conversation carrying the additive-optional `guideId` (+ `guideStep` for structured), defined by
`16` §4.2 and already shipped. These entries are **code, not vault data** — they extend the built-in
`GUIDED_CATALOG` array in `packages/core/src/conversations/guidedCatalog.ts` (`16` §4.1: the curated catalog is
built-in data like the capability registry, "not user data and the same for everyone, so it does not live in
the vault"). Concretely:

- **No new file, no new path, no `schemaVersion` bump, no migration.** A new intimacy session writes the same
  `people/<person-id>/conversations/<id>.enc` any session writes; its `guideId` is one of the new ids; its
  Insight (on End & summarize) is the same `Insight` (`source:'session'`, `provenance.guideId`) `09` produces.
- **The Yes/No/Maybe builder persists nothing extra** (v1, §2 non-goal). Its `guideStep` is the same additive
  field every structured exercise uses; its content lives in the transcript + the SessionInsight. (If §11.3 is
  resolved to persist a structured list, that becomes its own file + schema in **spec 50**, not here.)
- **18+ acknowledgement** uses the existing `people/<id>/guidance/prefs.enc` (`GuidancePrefs.adultAcknowledged`,
  `16` §8.3 / `guidanceService.ts`) — no change.
- **Ownership:** all reads/writes already go through the vault service (`encryptedStore` / `readEncryptedJson` /
  `writeEncryptedJson`); no direct `fs`. Catalog entries are constants, not vault I/O.

The `GuidedExercise` type itself is unchanged (`guidedCatalog.ts`): the new entries fill the existing fields
(`id`/`group`/`title`/`framework`/`blurb`/`kind`/`openingMessage`/`systemPromptAddendum`/`steps?`/`adult?`).

## 5. Architecture & modules

The only **code** change beyond catalog data is the one structured exercise; everything else is additive
content. Nothing new is registered — this extends the existing Sessions module (`05`/`16`).

### 5.1 Catalog additions (content)

- `packages/core/src/conversations/guidedCatalog.ts` — append the **16 new `GuidedExercise` entries** (§3.5)
  into the existing `GUIDED_CATALOG` array, in the `// ── Intimacy & connection (18+, §8.3)` section after the
  current three. Each new entry: `group:'intimacy'`, `adult:true`, a static `openingMessage`, and a
  `systemPromptAddendum` built with the existing `frame(framework)` preamble + the steering in §3.5. The
  explicit entries' addenda are written in the `08` §16.5 register (frank/specific/consensual-adult sexual
  wellness) — but `frame()` (the not-therapy boundary) **still leads**, and the consensual-adult /
  within-Anthropic-policy boundary is stated in-prompt exactly like the current intimacy entries
  (`sensate-focus` / `talking-about-sex` already say "stay within Anthropic's usage policy").
- **No change to `buildSystemPrompt`** (`promptBuilder.ts`): it already appends the exercise addendum after
  PERSONA + SAFETY + context, and the step-marker convention for structured exercises (`16` §5). The new
  entries are picked up by id with zero code change.
- **No change to `guidanceService.ts`**: `suggestGuidedSessions(..., { adultAllowed })` already filters the
  intimacy group from the candidate set + validation until the 18+ ack (`e.adult`), so the new entries are
  gated out of "Suggested for you" for free; after the ack they are eligible like any catalog exercise. The
  recommender's system prompt lists the candidate ids dynamically, so the new ids appear automatically.

### 5.2 The structured Yes/No/Maybe builder (the one real exercise mechanism)

The builder is a `kind:'structured'` `GuidedExercise` (`yes-no-maybe-builder`) reusing the **existing**
`[[SELFOS:STEP:n]]` machinery (`guidedSteps.ts` — `buildStepInstruction`, `parseLatestStep`,
`stripStepMarkers`); **no new step mechanism**. Its `steps` are the category sweep, e.g.:

```
steps: [
  'Set up',          // explain Yes/No/Maybe, set a no-pressure tone
  'Sensual & touch', // kissing, massage, cuddling, etc. → sort each Yes/No/Maybe
  'Oral & manual',
  'Penetrative',
  'Kink & power',    // D/s, restraint, impact, etc. — frame as fantasy/curiosity
  'Roleplay & fantasy',
  'Review the list', // reflect the assembled Yes / No / Maybe back
]
```

The exact category steps are tuned at build (and will likely align to spec 49's expanded inventory / spec 50's
kink categories once those exist — §13; but the builder works with a sensible hard-coded sweep now). The
addendum (built via `frame('sexual self-discovery and the Yes/No/Maybe model')` + `buildStepInstruction(steps)`,
which `buildSystemPrompt` already appends for structured exercises) instructs the coach to, for each category,
offer items and have the person sort each into **Yes / No / Maybe**, advance the stepper marker per turn, and at
the final step reflect the assembled three-bucket list back in the conversation. Free input is never blocked
(`16` §3.3).

> **Test impact (must do, not optional):** `guidedCatalog.test.ts` currently asserts
> `the structured set is exactly the four resolved exercises (16 §11.2)` — hard-coding
> `['cbt-thought-record','decision-clarifier','grow-goal-setting','weekly-review']`. Adding a **fifth**
> structured exercise **breaks this test**. The build must **update that assertion** to include
> `'yes-no-maybe-builder'` (and reconcile the `16` §11.2 reference — note this spec adds a structured intimacy
> exercise to that resolved set). This is the single existing test the change forces; it is named here so it is
> not missed.

### 5.3 Renderer

- **No new component, store, route, or nav.** The new entries flow through the **existing** `GuidedCatalog`
  group renderer (more cards in the Intimacy group), the existing `SuggestedSessions` row (post-ack), the
  existing `GuidedStepper` (for the builder), and `conversationStore.startGuided` (`16` §5). The 18+ gate UI is
  the existing one (`16` §8.3).
- **No `/gallery` change** — no new design-system primitive; the card and stepper patterns already exist
  (`16` added them).

### 5.4 What stays shared / unchanged

`@selfos/core/conversations` (`guidedCatalog.ts`, `guidedSteps.ts`, `promptBuilder.ts`, `guidanceService.ts`,
`guidedSessionService.ts`) — all unchanged except the appended catalog entries + the one structured exercise +
the test update. The catalog is already importable by the renderer for display metadata and used host-side for
`openingMessage`/`systemPromptAddendum` (`16` §4.1).

## 6. IPC / API contracts

**N/A — no new IPC.** Every channel this needs already exists from `16` and is reused verbatim:

- `sessions:startGuided({ guideId })` → `{ conversationId }` — gated `sessions.own`, active-person-scoped,
  validates `guideId` against the catalog (so a new intimacy id is accepted because it is now in
  `GUIDED_CATALOG`; the trust boundary is the bridge, `00` §6).
- `guided:getState()` → cached suggestions + 18+ ack state (`getGuidanceState`) — the no-spend launcher read.
- `guided:suggest({ refresh? })` → recommender (`suggestGuidedSessions`), metered `guided.suggest`; the
  `adultAllowed` gate already filters these intimacy entries until the ack.
- `guided:acknowledgeAdult()` → records the per-person 18+ ack (`acknowledgeAdult`).
- Guided chat turns use the existing `chat:stream` — the conversation carries the `guideId`, so host-side prompt
  assembly picks up the new addendum + (for the builder) the step convention; **no new streaming channel**.

**Claude API:** unchanged. Chat turns meter as the existing `chat` usage type; the recommender as
`guided.suggest` (`16` §5). The key stays in main (`00` §6.2); the renderer never sees it. The explicit
addenda are within Anthropic's usage policy (§8.3); a model refusal on a turn degrades to the normal chat
error/empty-reply handling (`05`/`37`) — there is **no** auto-retry or canned-content circumvention.

## 7. States & edge cases

Most are `16` §7 unchanged; the ones that matter for explicit content are spelled out.

- **AI off / no key** — the launcher + Intimacy catalog still render; the **static opening message** of any
  intimacy exercise renders offline; the first model-needing turn shows the existing not-configured state
  (`16` §7). "Suggested for you" hides with the calm hint. Per `31` (AI required), this is a setup prompt, never
  a faked experience.
- **Over budget** — starting a session hits the existing budget gate (`06`); suggestions show cache-or-hide
  (`16` §7).
- **18+ not acknowledged (the common first state)** — the **whole Intimacy group is gated**: the cards
  (existing three + all new ones) are hidden behind the age-gate prompt, and the group is **excluded from
  suggestions** (`suggestGuidedSessions` filters `e.adult`). Acknowledging once reveals the group + makes the
  entries suggestible. This must be tested with the gate **un-acknowledged** (the DoD "test the prerequisite
  absent" rule), not just post-ack — assert the new cards do not render and are not suggested.
- **A person with no partner doing a couple-oriented session** — many entries (Love Maps, Bids, Repair,
  Reigniting the Spark, Aftercare, Mismatched Libido) read as partnered, but a single person may pick them. Each
  such addendum must include a **solo framing fallback** — if there is no current partner, the coach adapts to
  reflection/preparation/self-understanding for a future or past relationship rather than assuming a present
  partner. (The person's profile/context already informs this; the addendum makes it explicit so the coach
  never presumes a partner who isn't there.) The static opener is written to not assume a partner.
- **Unknown / removed `guideId`** — a conversation referencing a retired intimacy exercise still opens as a
  normal session (the addendum is simply absent, `16` §7); `startGuided` rejects an unknown id. Stable ids
  (§3.5) avoid this.
- **Structured builder, person goes off-script** — allowed; the stepper reflects best-effort progress; free
  input is never blocked (`16` §3.3). A partial Yes/No/Maybe list is fine — the final reflection summarizes
  what was sorted.
- **Model declines an explicit turn** — within-policy content should not be refused, but if a turn comes back
  empty/refused it degrades to the normal chat handling (`05`/`37`: an honest "try again", never a fabricated
  reply, never a re-prompt to circumvent policy). No canned-explicit fallback (contrast the questionnaire `08`
  §16.5b fallback, which was superseded; sessions do not get one).
- **Trauma surfaces (especially `sexual-shame`, `exploring-an-act`, kink)** — handled in §8.4: slow down,
  validate, never push, route to professional support; the SAFETY crisis instruction always applies.
- **Completion / summarize** — unchanged (`09`): marking complete + End & summarize yields a SessionInsight
  noting the exercise; a sensitive intimacy Insight follows the existing sensitivity handling. The Yes/No/Maybe
  builder summarizes like any session (no separate outcome).
- **Per-person isolation** — the suggestions cache + 18+ ack + any guide state reset on `activePerson.id`
  change (`16` §4.3, the per-person rule) — unchanged.
- **Sync conflict / corrupt / migration / large data** — unchanged vault behaviour (`00`); no new persisted
  format, so no new migration. An old transcript with absent `guideId` is a free session (`09`/`16` migration).

## 8. Safety (required — this touches wellbeing AND explicit sexual content)

This is the safety-critical heart of the spec: it adds **explicit, in-policy sexual content** (sensual through
kink/power-exchange) to the guided-session catalog. The boundaries are the established SelfOS ones; nothing here
loosens them — it applies them to more, franker exercises.

### 8.1 Not therapy, not medical (the boundary always leads)

- SelfOS guided sessions are **self-guided wellness exercises informed by** known approaches — **NOT therapy,
  sex therapy, diagnosis, or treatment**, and not a substitute for professional care (CLAUDE.md §1; `16` §8.1).
  Every new addendum **leads** with the shared `frame(framework)` preamble (`guidedCatalog.ts`), which states
  this in the coach's own instructions, and `buildSystemPrompt` appends it **after** PERSONA + SAFETY + context,
  so the boundary always precedes the steering (`16` §5). The card titles avoid clinical claims; the framework
  tag carries recognisability (`16` §8.1).
- The **always-present CrisisFooter** (`05` §7) shows on every session.
- Persistent sexual distress/dysfunction → the coach encourages a **qualified sex therapist or clinician**
  (several addenda already do, e.g. `desire-discrepancy`); medical issues (pain, meds, illness affecting sex) →
  **medical care**, never medical advice (e.g. `intimacy-after-change`, `mismatched-libido`).

### 8.2 Crisis routing (unchanged, non-negotiable)

Intimacy topics can surface acute distress — abuse, coercion, assault history, self-harm. Crisis handling is
unchanged (`05` §7 / `09` §7): warmth, take it seriously, route to professional/emergency help, never manage a
crisis alone. The SAFETY block (with the crisis instruction) leads every prompt and the new addenda **reinforce,
never weaken** it. Specifically:

- **Non-consent or abuse described as real (not fantasy/roleplay)** — the coach must treat it as a safety
  concern and route to help (e.g. `non-monogamy-agreements`, `kink-power-exchange`, `exploring-an-act` addenda
  state this), not as an erotic topic.
- **Sexual shame tracing to abuse/assault** (`sexual-shame`) — slow down, validate, and encourage professional
  support; do not push the exercise (§8.4).

### 8.3 Explicit content — consensual-adult, in-policy (the register)

The explicit sessions adopt the **`08` §16.5 register** (`intimacyExplicitFraming`): frank, specific,
consensual-adult sexual wellness — genuinely useful, not euphemistic — within a boundary that is **stated in
every explicit addendum** and unchanged from the rest of SelfOS:

- **Consensual adults only.** Taboo content **only** as fantasy/roleplay (e.g. consensual non-consent (CNC) as
  pre-agreed roleplay); **NEVER** minors, real (non-roleplay) non-consent, or illegal acts (the intake `27`
  §14.5 / `08` §16.5 boundary, verbatim in intent). Within those limits this content **is** in policy, so the
  coach engages normally and does not substitute tasteful deflections.
- **Within Anthropic's usage policy.** The shared `SAFETY` prefix is **not** loosened; only the per-exercise
  addendum gains the explicit register. A model refusal is handled gracefully (§7), never circumvented.
- **Gated by the existing 18+ acknowledgement** (`16` §8.3): every new entry is `group:'intimacy'` + `adult:true`,
  so the whole set is behind the one-time per-person 18+ ack and excluded from suggestions until then — the
  invariant the `guidedCatalog.test.ts` `only intimacy exercises are adult-gated` assertion enforces
  (`adult === (group === 'intimacy')`), which these additions preserve (all new entries intimacy + adult; no
  non-intimacy explicit content). No DOB/consent ceremony is added — these are reflective conversations, not
  explicit media delivered to a third party (the DOB+consent ceremony stays the questionnaire-relay concern,
  `08` §8.3).
- **Never coercive.** Every explicit/relational addendum frames exploration as **invitational** — the coach
  centres the person's own desires, consent, and boundaries (and a partner's, where relevant); it never
  pressures the person toward any act, never assumes shared desire, and respects a "no" or a pause immediately.

### 8.4 Topics that intersect trauma — handle gently

Some explicit topics (sexual shame, exploring a specific act, kink/power-exchange, feeling desirable / body
image) commonly intersect trauma, abuse, disordered patterns, or deep shame. The relevant addenda must instruct
the coach to:

- **Watch for distress** and, if it surfaces, **slow down, validate, and stop pushing the exercise** — the
  person's wellbeing leads, not completing the steps.
- **Route to professional support** (a therapist / sex therapist / crisis line per the situation) when the topic
  traces to trauma, assault, or a pattern that needs care — without diagnosing.
- **Never frame trauma as kink** or treat a disclosed assault as an erotic topic (§8.2).

### 8.5 Privacy

A guided session is the person's own data (their transcript, their context), encrypted like any session
(`05`/`04`). The **recommender** sends only **structured context** (the shareable summary via the
context-provider registry) to Claude — never raw transcripts (`08`/`09`/`16` §8.4 boundary), unchanged. The 18+
ack + suggestions cache are per-person and reset on switch. A Yes/No/Maybe transcript and its SessionInsight are
the person's own; sharing any derived fact is the existing per-fact relationship-scoped sharing (`42`/`44`),
which already excludes `restricted`/sensitive facts from others' context — no new sharing path here.

## 9. Accessibility

Per `01` §9 and `16` §9, all reused — no new surface, so no new a11y work, but the additions must not regress it:

- The new intimacy **cards** are real buttons with accessible names = `title` + `framework` + `blurb` (`16` §9),
  in the existing collapsible group (proper heading/region, not color-only).
- The **GuidedStepper** for the Yes/No/Maybe builder announces the current step and is not color-only (`16` §9).
- The **18+ gate** prompt + reveal is keyboard-operable and screen-reader friendly (the existing one).
- Responsive ~360px→desktop — the Intimacy card grid reflows to one column on phones (the existing grid); the
  larger set must not introduce horizontal overflow at narrow widths (the §10 / DoD overflow guard covers it).
- Reduced-motion respected (the existing launcher).

## 10. Testing strategy

The bulk is content, so testing is light but targeted — and it must include the gate-absent and edge cases (§7),
not just the happy path.

- **Unit (core, `guidedCatalog.test.ts` — extend the existing suite):**
  - The integrity invariants hold for the expanded catalog: **unique ids**, every entry in a known group,
    **structured entries declare `steps` / chats do not**, and crucially **`adult === (group === 'intimacy')`**
    still holds (all new entries intimacy + adult; the assertion already in the file).
  - **Update the structured-set assertion** (§5.2) to the new resolved set including `'yes-no-maybe-builder'`
    (this test **will fail** until updated — that is the signal it's the one forced change).
  - Every new entry has a non-empty static `openingMessage` and a `systemPromptAddendum` that **frames it as
    not-therapy** (the existing `not therapy|NOT therapy` assertion) **and** (for explicit entries) states the
    consensual-adult / within-Anthropic-policy boundary — extend the assertion to check the boundary phrasing on
    the explicit set.
  - `getExercise` resolves each new id; `guidedGroupTitle('intimacy')` unchanged.
- **Unit (core, `promptBuilder.test.ts`):** a new intimacy `guideId` makes `buildSystemPrompt` append its
  addendum **after** PERSONA + SAFETY + context (the boundary leads), and for `yes-no-maybe-builder` the
  step-marker instruction is appended (structured path) — reuse the existing addendum-ordering assertions with a
  new id.
- **Unit (core, `guidanceService.test.ts`):** with `adultAllowed: false`, the recommender **filters out** the
  new intimacy ids (none survive validation); with `adultAllowed: true`, they are eligible — extend the existing
  `adultAllowed` gating tests to assert a new intimacy id can be suggested only post-ack.
- **Component (RTL):** the Intimacy group renders the expanded card set (a new card present); picking a new card
  calls `startGuided` with its id; the structured builder card shows the stepper affordance; the **18+ gate
  hides the new cards** when un-acknowledged (reuse the existing `16` launcher RTL with the larger set).
- **E2E (Playwright, `SELFOS_FAKE_CLAUDE`):**
  - **A new intimacy chat card starts a session** — open Sessions → acknowledge 18+ → Intimacy group → tap a new
    explicit card → the static opener renders → a steered reply streams → mark complete → summarize (`09`) → the
    Insight notes the exercise (`provenance.guideId`).
  - **The structured Yes/No/Maybe builder advances steps** — start it → opener + stepper → the fake coach's
    `[[SELFOS:STEP:n]]` markers advance the stepper and never appear in the visible text → the final step
    reflects the list.
  - **The 18+ gate** — with the ack un-acknowledged, the new intimacy cards do **not** render and are **not**
    suggested; acknowledging reveals them (the §7 prerequisite-absent case).
  - **Layout** — a **390px no-overflow guard** on the launcher with the expanded Intimacy group (incl. the inner
    scrollbar scan per the DoD), and the structured-card / stepper geometry, so the larger set doesn't overflow
    a narrow pane.
- **Mocks:** the offline fake Claude (`SELFOS_FAKE_CLAUDE`) drives the recommender + chat turns deterministically
  (extend it to emit a `[[SELFOS:STEP:n]]` marker for the builder turn so the stepper-advance E2E exercises real
  marker stripping, per the `16` build precedent + the DoD "fakes must exercise the real path" rule). The vault
  is the standard encrypted test vault; assert the Insight's `provenance.guideId` by decrypt, not just render.

## 11. Open questions

- **§11.1 — The exact final session set.** §3.5 proposes 16 new entries (15 chat + 1 structured) → a 19-entry
  Intimacy group. **Which to keep, drop, merge, rename, or add?** (e.g. is `mismatched-libido` redundant with
  the existing `desire-discrepancy`? Combine `sexting-long-distance` and `dirty-talk-practice`? Add a
  "first-time / new relationship intimacy" or a "reigniting after infidelity" exercise?) The user trims/adds.
- **§11.2 — How explicit the default register should be, per session.** All explicit entries adopt the `08`
  §16.5 register within the consensual-adult boundary, but the **depth varies** — should some (e.g.
  `dirty-talk-practice`, `kink-power-exchange`, `edging-mindful-arousal`) be **fully graphic** while others
  (e.g. `feeling-desirable`, `intimacy-after-change`) stay warm-but-non-explicit, and where exactly is each
  line? (Questionnaires expose this as the `explicit` vs `unfiltered` tier; sessions have no tier control — the
  register is baked into each addendum, so the per-session level is a content decision.)
- **§11.3 — Should the Yes/No/Maybe builder persist its list as data now, or only after spec 50?** v1 (this
  spec) it is conversation-only (transcript + SessionInsight, §2 non-goal). The alternative is a durable,
  queryable Yes/No/Maybe structure — which is **spec 50** (the kink inventory test). Confirm: keep it
  conversation-only here and let spec 50 introduce the persisted inventory (the recommendation), or persist a
  lightweight structured list in this spec?
- **§11.4 — Naming of any of these sessions** (titles + framework tags). Several names are placeholders (e.g.
  "Agreements & Jealousy (Non-Monogamy)", "Working Through Sexual Shame", "Exploring a Specific Act"). Final
  copy is tuned at build, but the user may want specific names — and whether any framework tag should change
  (e.g. should kink cite "RACK/SSC" rather than just "Kink (D/s)"?).
- **§11.5 — Does any proposed session belong in a different group** rather than Intimacy & connection? (e.g. is
  `feeling-desirable` / body image better in the Reflective & therapy-informed group — un-gated — than the 18+
  Intimacy group? Is `repair-after-rupture` a general relationship-repair exercise that should sit in Coaching
  or a future Relationships group rather than Intimacy?) Moving an entry to a non-`intimacy` group means it is
  **not** `adult`-gated (the `adult === (group === 'intimacy')` invariant), which is a real visibility decision.

## 12. Changelog

- 2026-06-25 — created (Draft). Greatly expands the `16-guided-sessions` "Intimacy & connection" group from 3
  to a proposed 19 entries (16 new: 15 chat + 1 structured Yes/No/Maybe builder), in the `08` §16.5
  consensual-adult sexual-wellness register, all behind the existing 18+ acknowledgement. **Locked decisions
  (§11 / §8.3):** the group ships explicit, in-policy sessions across the full range (sensual → kink/power-
  exchange); all are 18+-gated (`group:'intimacy'` + `adult:true`); the consensual-adult / within-Anthropic-
  policy boundary is stated in every addendum and led by PERSONA + SAFETY. The Yes/No/Maybe builder is
  structured (`[[SELFOS:STEP:n]]`) and forward-links to spec 50 (kink inventory test) + spec 49 (expanded
  intimacy inventory) but depends on neither (works standalone now). Mostly additive content — no schema, IPC,
  capability, or nav change; the one forced code change is adding the structured exercise and **updating the
  `guidedCatalog.test.ts` structured-set assertion** (§5.2). Open: the exact set, per-session explicitness
  depth, whether the Yes/No/Maybe list persists as data now or after spec 50, final naming, and whether any
  entry belongs in a different (un-gated) group.

---

## Relationship to other specs / whole-app fit

This spec is one entry in a coordinated intimacy arc; it is deliberately self-contained but designed to slot in
as the others land:

- **Spec 49 (expanded intimacy inventory)** — broadens the shared `INTIMACY_TOPICS` / activity inventory
  (`@selfos/core/intimacy`, the constant `08` §16.5a / `27` already share with onboarding and questionnaire
  generation). When it ships, these guided sessions **consume it for free**: the explicit addenda can seed from
  the richer inventory (the same way `intimacyExplicitFraming` already seeds questionnaire generation), and the
  **Yes/No/Maybe builder's category steps (§5.2) can align to the expanded inventory's categories** instead of a
  hard-coded sweep. No change to this spec is required to benefit — the builder works with a sensible sweep now
  and gets richer when 49 exists.
- **Spec 50 (kink inventory test)** — introduces the durable, queryable Yes/No/Maybe / kink inventory data
  structure. This spec's `yes-no-maybe-builder` is the **conversational on-ramp** to that: today it produces a
  reflected-in-chat list (transcript + SessionInsight); once 50 ships, the builder can **write the structured
  inventory** the test owns (resolving §11.3), so a guided conversation and a structured inventory feed the same
  underlying data. The forward link is intentional; the dependency is **one-directional and optional** — 50 will
  build on the builder, not the reverse.
- **Spec 52 (challenge sessions)** — these intimacy exercises (especially the explicit and kink ones, the
  Yes/No/Maybe list, fantasy exploration, and aftercare) are natural **sources for couple/intimacy challenges**:
  a challenge can reference a completed exercise's SessionInsight or propose trying a Yes/No/Maybe "Maybe" item.
  By keeping every exercise a normal `05`/`09` session whose output is a standard SessionInsight (`provenance.
guideId`), this spec gives 52 a clean, memory-integrated surface to build challenges from with no special
  plumbing.
- **Whole-app coherence** — because a guided session is just a Conversation carrying `guideId`, these intimacy
  sessions inherit **everything** the app already does: per-person isolation, metering/budgets (`06`), the
  living-memory loop and goals (`39`), proactive coaching nudges (`40`), relationship-scoped sharing of any
  derived fact (`42`/`44`, with sensitive facts excluded), and the 18+ gate shared with the onboarding intimacy
  block and questionnaires. The intimacy group is thus consistent with the rest of SelfOS's intimacy surfaces
  (`18`/`27`/`46`/`08` §16) rather than a bolt-on, and it expands the catalog without expanding the machinery.
