# 75 — Say something to your partner

> **Status:** Draft — awaiting approval
> **Owner decisions taken:** 2026-08-21 (eleven, recorded in §11.1 — no open questions remain)
> **Depends on:** [`74`](74-adaptive-tests.md) (the lexicon + the partner steer), [`58`](58-together-couples-sessions.md) (the
> Together surface + the Desire tab), [`06`](06-ai-usage-and-budgets.md) (metering + budgets)

---

## 1. Overview

A surface in **Together → Desire** where you ask SelfOS to write you a few lines to say to your partner, drawn
from what **they** have marked as landing for them, optionally steered by a free-text brief in your own words
("wanting to fuck her tonight", "how much I loved cumming in her ass last night").

**This is not a new capability so much as an existing one made visible.** [`74`](74-adaptive-tests.md) §5.8's
`buildPartnerSteer` already feeds your partner's loved language into your coach's prompt whenever you ask it
what to say — silently, never attributed. Today that only fires inside a coaching conversation, where you have
to know to ask. This gives it a front door, a brief, and a list you can scan and copy from.

**The exposure level is deliberately unchanged from §8.4.** The screen writes lines; it never says "she likes
X", never lists her marks, and never names a source. Her own phrases may appear inside a line — which is
exactly what the silent steer already does, and which §8.4 already records as a knowing override ("those are
her words, and she will recognise them").

---

## 2. Goals / Non-goals

**Goals**

- Turn "what should I say to her?" into a scannable list of usable lines, in the register she responds to.
- Accept a free-text brief so the lines are about the thing you actually want to say tonight.
- Keep the promise the take makes to the person whose data this is (§8.4).
- Be honest and useful when there is nothing to draw on — the common case today (§7.1).

**Non-goals**

- **No delivery.** v1 does not send anything — not in-app, not by email, not by text. You copy a line and send
  it yourself. (Owner decision §11.1-4.)
- **No new consent surface for the partner**, and no visibility to them that you used it (owner decision
  §11.1-5; consequence recorded in §8.3).
- **Not a chat.** It writes a batch and stops. Iterating is "write more" / "more like this", not a conversation
  — Sessions already covers conversation.
- **Not a second lexicon.** It reads what the Dirty Talk take produced; it never writes to her lexicon.

---

## 3. UX & flows

Lives on the **Desire** tab of Together, which already only exists once **both** partners hold the 18+ ack
(58 §3.10). Named **"Say something to `<name>`"** (owner decision §11.1-8).

### 3.1 The ready state

- **Head** — the name, an `18+` badge, and one line of what it is: _"Ideas written to land for her, in the
  register she responds to."_
- **Brief** — a free-text box, the primary control, empty by default and always optional. Under it, chips that
  fill the box rather than replacing it: `Tonight · Right now · About last night · Out of nowhere · Build it up
slowly`. The brief is what makes the owner's own examples work; the chips are shortcuts, not a taxonomy.
- **Write me some lines** — the single primary action. Admin-only cost hint beside it (`🔒 Admin only ~$0.01`,
  the app-wide money rule — a member sees no `$`).
- **Lines** — one per card, serif at reading size (the deck's treatment for a line, §3.6.4), each with **Copy**
  and **More like this**. `LINES_PER_BATCH = 5`.
- **Write more** appends a batch; it never replaces one (the §3.6.35 rule — a generated set you were shown is
  never silently discarded).
- **Footer, load-bearing:** _"Written from what `<name>` has marked. It never names a source, and she is never
  told you used this."_ It is honest to you about where the material comes from, and it is the sentence that
  states the boundary this feature is built to hold.

### 3.2 The brief

Free text, capped (`MAX_BRIEF = 400`). It steers subject and occasion. It **cannot** loosen anything: the
output filter (§8.2) runs on every line regardless of what the brief asked for, so a brief that reaches for
something she has ruled out simply produces fewer lines, and §7.3 says so honestly rather than silently.

### 3.3 Starring

Lines are **ephemeral by default** — leave the screen and they are gone. A line you **star** is kept, so you
can come back to one that worked (owner decision §11.1-6). Starred lines are listed under the generator,
newest first, each with Copy and Unstar.

### 3.4 The empty state (§7.1 — the common case today)

When there is no usable signal for that partner, the section still renders and says so plainly:

> **`<name>` hasn't marked anything yet.** This writes from what she's marked in the Dirty Talk bank — what she
> likes hearing, and the register that lands. She hasn't marked any of it, so there's nothing here to write
> from yet.

with a single **See what it asks** link that opens the Dirty Talk take so you can show her (owner decision
§11.1-7 — no nudge, no notification, no outbound message). It is never silently absent; that is the §7 DoD
rule the relay link failed.

### 3.5 Progress

Every generation shows a **phase label + elapsed + ETA** (the durable §12 rule; a bare spinner is
unacceptable). Reuses the established progress-event pattern.

---

## 4. Data model (vault files & schemas)

**Nothing new is stored about the partner.** The generator reads her lexicon and writes nothing to it.

One new file, in the **requester's** own space:

```
people/<requesterId>/together/sayLines/<pairKey>.enc   → SayLinesStore
```

```ts
StarredLine = {
  id: string;
  text: string;            // the line, as written
  brief?: string;          // what was asked for, so a starred line has context later
  createdAt: string;
};
SayLinesStore = {
  schemaVersion: 1;
  pairKey: string;
  lines: StarredLine[];    // cap 100
  lastBrief?: string;      // §11.1-10 — the box is prefilled next visit
};
```

`pairKey` is the existing stable two-person key (58 §4.3), so the set is scoped to the pair rather than to a
session. **`lastBrief` persists** (owner decision §11.1-10): the box comes back filled with what you last
asked for, so "about last night" does not have to be retyped. It is your own words about your own wanting,
in your own vault space — but it is explicit free text at rest, which is why it is named here rather than
treated as incidental UI state.

**Starred lines are KEPT when the partner is deleted or clears their lexicon** (owner decision §11.1-9). The
consequence, recorded plainly rather than buried (§8.3): a starred line can contain her verbatim phrases
(§8.1), so this is a deliberate exception to §3.6.11's "delete is delete" — her marks go, and prose you chose
to keep, which may quote them, stays. It is your saved content, and the owner chose to treat it that way.
Generation stops the moment her signal is gone (§5.1 returns `null`), so nothing NEW can be produced from a
lexicon that no longer exists; only what you had already starred survives.

---

## 5. Architecture & modules

### 5.1 One assembly, two renderings

`buildPartnerSteer` (74 §5.8) already assembles exactly the signal this needs — loved-to-hear entries, loved
names, themes, registers, voice — behind exactly the gates this needs. **It is extracted rather than copied**,
because tonight's §3.6.39 lesson is that the same rule written twice diverges silently:

```
partnerLandingSignal(fs, key, requesterId, partnerId, bothAdultAcked)  →  PartnerSignal | null
   ├── buildPartnerSteer(...)      renders it as a prompt block for the coach   (existing, unchanged output)
   └── sayLinesPhase(...)          renders it as generation input for this feature
```

`null` when any gate fails **or** there is nothing to draw on — which is what drives §3.4's empty state, so the
UI cannot disagree with the engine about whether this is usable.

### 5.2 Generation

A new phase in `@selfos/core/tests/adaptive` (it reads the lexicon and shares the register/boundary
machinery), metered as a new `together.sayLines` usage type:

- **System:** `PERSONA` + `SAFETY` + `REGISTER` + **both** boundary blocks (§8.2) + `whoBlock` (who these two
  are — identity and address, 74 §3.6.35) + the landing signal + the instruction.
- **User:** the brief, if any.
- **Parse:** the same tolerant path the lines phase now uses (`parseLines`, with
  `salvageJsonStringArrayField` — §3.6.39), so one bad element never costs the batch.
- **Filter:** §8.2, per line.
- **Failure:** the §3.6.39 `nothingUsable` split — a reply that never parsed is the model's outcome; a reply
  that parsed and then lost everything to the filter is ours, and says so differently (§7.3).

---

## 6. IPC / API contracts

All gated on **`together.own`**, and re-gated host-side on a **live partner edge** + **both 18+ acks**, every
call. The bridge is the trust boundary; the UI gate is convenience.

| Channel                  | In                                | Out                          |
| ------------------------ | --------------------------------- | ---------------------------- |
| `together:sayLinesState` | `{ partnerId }`                   | `SayLinesView` (ready/empty) |
| `together:sayLines`      | `{ partnerId, brief?, exclude? }` | `SayLinesResult`             |
| `together:starLine`      | `{ partnerId, text, brief? }`     | `StarredLine[]`              |
| `together:unstarLine`    | `{ partnerId, id }`               | `StarredLine[]`              |

`exclude` carries the lines already on screen so **Write more** means more, not the same five again (the
§3.6.19 rule). `SayLinesView` never carries her marks — only `ready: boolean` and the partner's display name.

---

## 7. States & edge cases

1. **Partner has no usable signal** — §3.4. **This is the state on the owner's own vault today:** measured
   2026-08-21, Angel has 16 lexicon entries and **0** marked loved / okay / never, no themes, no registers, no
   voice, so `partnerLandingSignal` returns `null`. Built exactly as asked, this feature shows the empty state
   until she marks something. Recorded here so it is not discovered as a bug.
2. **No live partner edge, or either ack missing** — the section does not render at all (the Desire tab itself
   is already gated on both acks, 58 §3.10).
3. **Everything was filtered** — the model wrote, and every line touched something she has ruled out or he has
   ruled out saying. Honest and distinct from a model failure: _"Nothing came back that fits both what you
   asked for and what you've each ruled out."_ Never blames her data, never names what was ruled out.
4. **AI off / over budget** — the calm role-aware state the app already uses; the starred list still reads.
5. **More than one partner** — the section repeats per partner with a live edge. (Two `partner` edges exist in
   the household today, but only one involves the owner.)

---

## 8. Safety

### 8.1 What may be shown (the decided posture)

Lines only. **Never** "she likes X", never a list of her marks, never a source. Her own phrases **may** appear
inside a line — the exposure level the silent steer already has, recorded as a knowing override in 74 §8.4
(owner decision §11.1-1). The take's existing intro is what informs her, unchanged:

> _"It shapes how SelfOS talks to you — and, if you have a partner here, it can quietly shape what their coach
> suggests to them. It never tells them what you said."_

Because this screen shows **lines and not marks**, that sentence stays literally true.

### 8.2 Suppression is unconditional, and runs BOTH ways

The insight the directional model (74 §3.6.8) makes expressible: a line here is **said by him, heard by her**,
so two different boundary sets apply and both are absolute.

- Her **`hearState: never`** — she would be hearing it. Never generated.
- His **`sayState: never`** — it would be in his mouth. Never generated.

Belt (both lists in the prompt as hard negative constraints) and braces (`violatesBoundary` per line, with the
direction, after generation). A brief cannot override either. Suppression only ever **prevents**, so it is
never gated on anything (the §5.8a rule).

### 8.3 The consequence of "no off-switch", recorded plainly

The owner chose (§11.1-5) that the partner gets **no new control and no visibility**. Recorded rather than
buried, in the §8.4 tradition: **her only lever remains not marking things**, which also costs her her own
profile. The take's intro tells her the steer exists before she produces material; it does not tell her a
front door for it exists. This is a deliberate choice, not an oversight.

**And a second, related one (§11.1-9):** a **starred line outlives her data**. If she deletes her marks, or is
removed from the household, her lexicon goes and generation stops — but lines you starred stay, and a starred
line can carry her verbatim phrases. §3.6.11 established "delete is delete" for her marks specifically; this
spec does not extend that to prose the other partner chose to keep. Also deliberate, also the owner's call,
and written here so nobody later reads it as a missed reap.

### 8.4 The trauma carve-out is not negotiable

Text that tripped the trauma/crisis path **never** enters an erotic-suggestion prompt (74 §8.4). This spec
carves no exception. `SAFETY` leads the system prompt as everywhere else, and the crisis footer is present on
the surface (§8.2 of 58 — a crisis affordance belongs outside the pane that changes).

### 8.5 Not medical

Standard wellness framing; the surface carries the app-wide not-therapy line.

---

## 9. Accessibility

**A line row stacks below 560px.** Caught in the mockup: with Copy / More-like-this / star holding their
width beside the text, the line itself squeezed to one word per line — the §12 flexbox rule, where the
content loses to the controls. Below the small stop the tools drop UNDER the line and the text takes the
full width. A line is the content here; the buttons are not entitled to the same row.

Lines are real text, copyable and selectable. Star is a labelled toggle with `aria-pressed`, not colour alone.
Progress is a labelled `progressbar` with the phase and elapsed as text. The 18+ badge is text, not a colour.
Every state reads to the bottom at 360px with no horizontal scroll (§12).

---

## 10. Testing strategy

- **Core** — `partnerLandingSignal` gate matrix (self / no edge / one ack / both acks / no signal); the
  both-ways suppression, each direction verified to fail when reverted; brief-cannot-override-the-filter;
  `exclude` means the second batch differs.
- **Bridge (two-persona)** — a non-partner gets nothing; a Guest is denied; the view never carries her marks
  (assert the serialized payload); star/unstar round-trips and is scoped to the requester.
- **Renderer** — ready / empty / everything-filtered / AI-off; star persists; copy present.
- **E2E** — seed a partner lexicon, generate through the real UI, decrypt to assert a starred line persisted
  and that **no line contains a term either of them ruled out**; the empty state renders with the link; 360px
  guard.
- **Live** — the §3.6.31 pass: run it against real Claude at the owner's real shape once his partner has
  marks, because the offline fake cannot show whether the lines are any good.

---

## 11. Open questions

### 11.1 Resolved (owner, 2026-08-21)

1. **Disclosure** — lines only, no ingredient list; her phrases may appear inside a line (the existing §8.4
   level).
2. **Data source** — her marks, via the existing steer assembly.
3. **Placement** — Together → Desire.
4. **Delivery** — on screen + copy only; nothing sent, in-app or out.
5. **Her control** — none added; consequence recorded in §8.3.
6. **Persistence** — ephemeral, with per-line starring.
7. **Empty state** — honest, with a link to the take; no nudge, no notification.
8. **Name** — "Say something to `<name>`".
9. **Starred lines survive her deletion** — kept, not reaped. A deliberate exception to §3.6.11, with the
   consequence recorded in §4 and §8.3; generation still stops the moment her signal is gone.
10. **The brief persists** between visits (`lastBrief`), so the box comes back filled.
11. **`LINES_PER_BATCH = 5`.**

### 11.2 Still open

None. Every fork is decided; this is ready to build on approval.

---

## 12. Changelog

- 2026-08-21 — Drafted. Eight owner decisions taken before any design (§11.1); mockup of all three states
  reviewed in the app's real tokens before writing. Two findings recorded from measuring the real vault
  first: the silent steer already carries this data (so the change is exposure, not capability), and the
  owner's own partner has no usable marks today, which makes the empty state (§3.4/§7.1) the common case
  rather than an edge case.
- 2026-08-21 — Remaining forks closed (§11.1-9/10/11): starred lines are KEPT when her data goes (a
  deliberate exception to §3.6.11, consequence recorded in §4 + §8.3), the brief persists as `lastBrief`, and
  a batch is 5. No open questions remain.
