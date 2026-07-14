# 61 — Together follow-through (agreements + pulse on the dashboard)

> **Status:** **Approved** — _last updated 2026-07-14_
>
> The "things to do" that come out of a Together wrap-up (the **agreements ledger**) and the couples
> **Pulse check-in** are today buried — agreements only surface at the very bottom of one session's
> reflection panel, and the check-in only lives on the Together page. This spec surfaces both where the
> user actually looks: standing agreements in the Home **needs-attention** queue and alongside **Goals**,
> a summary strip at the **top** of a Together session, and an **inline Pulse check-in** on Home. Amends
> [58](58-together-couples-sessions.md) (Together), [39](39-living-memory-continuity.md) (Goals), and
> [60](60-home-dashboard-redesign.md) (Home).

---

## 1. Overview

Together (spec 58) already produces two kinds of follow-through:

- **Agreements** (§3.9) — the pair-level shared ledger of commitments a couple makes ("check in each
  evening", "date night Fridays"). Captured from a coach `[[SELFOS:AGREEMENT]]` marker or added by hand
  during wrap-up. Stored per pair at `together/pairs/<pairKey>/agreements/<id>.enc`, status
  `standing`/`done`/`retired`.
- **Pulse** (§3.10a) — a frictionless 1–3-tap couples check-in ("How are things with `<partner>`?" across
  connection / desire / satisfaction), logged per person, with the dual-consent desire alignment.

Both are hard to find. Agreements are only readable by opening a specific session and scrolling past the
thread + suggestions to the reflection panel at the very bottom (`TogetherReflection`). The Pulse
check-in (`TogetherPulse`) only renders on the Together page; the main Home dashboard shows a **read-only**
pulse ring (`TogetherHomeCard`) with no way to log. So a couple who agree to something in a session, or
who want a quick temperature check, have to remember to go dig for it.

This spec makes the follow-through **visible where the user already is** — the Home dashboard, the Goals
surface, and the top of a Together session — without changing what an agreement or a pulse check-in _is_
(no new persisted schema, no duplication). It is the couples-facing sibling of the goal-follow-up and
recommendation work in specs 39/53/60.

## 2. Goals / Non-goals

**Goals**

- A person can see their **standing Together agreements across all their partners** without opening a
  session — surfaced (a) in the Home **needs-attention** queue and (b) as a **"Together commitments"**
  section in the Goals surface, where they can mark one **done** (which writes back to the shared ledger).
- A Together **session** shows, near the **top**, that there are agreements / a reflection to look at,
  with a jump to them — so nothing lives only at the bottom of the page.
- A person can log the **Pulse check-in inline on the Home dashboard** (all three metrics + the
  default-off share-desire consent toggle), one motion, without navigating to Together.
- Zero new persisted schema, zero duplication: an agreement stays the one shared pair record; a pulse
  check-in stays the one per-person log. Mark-done on Home/Goals writes the **same** shared agreement.

**Non-goals**

- **Turning an agreement into a per-person `Goal`.** Agreements are a shared, two-editor pair record with
  a different lifecycle (`standing`/`done`/`retired`); Goals are per-person. We **surface agreements
  alongside goals**, we do not mint duplicate `Goal` records (decided 2026-07-14). No new `provenance`
  key, no sync problem.
- **Editing an agreement's text from Home/Goals.** Inline text/timeframe editing stays in the session's
  reflection panel (the two-editor context). The Home/Goals surface is read + mark-done/retire only.
- **A new persisted "dismissed" state for agreements.** (See §11.)
- **Changing the Pulse metrics, storage, consent model, or the desire-alignment gate** (58 §3.10a is
  unchanged — we only add a second surface for the existing check-in form).
- **Multi-partner pulse on Home at once** — Home surfaces the check-in for **one partner** (the first
  eligible live partner). A household with multiple partners gets a single check-in card, not one per pair.

## 3. UX & flows

### 3.1 Standing agreements in the Home needs-attention queue (slice A)

The Home **needs-attention** queue (`NeedsAttentionCard`, spec 60 §3.1.2a) gains an `agreement` item when
the active person has ≥1 **standing** agreement across their live partner pairs:

- Copy: **"Following through with `<partner>`"** · detail "`N` standing agreement`s`" (partner named when
  a single pair; "your partners" when more than one).
- Icon: `handshake` (lucide).
- Route: `/goals` (the "Together commitments" section, §3.2). Navigation-only row, consistent with the
  rest of the queue.
- Ordering: below the urgent Together items (`together-turn`, `together-invite`) and the
  `analyze-responses`/`review-insights` items. It is a **gentle nudge** (`nudge: true`) — so it respects the
  person's opt-out and is dropped under `suppressNudges` (proactivity off **or** recurring crisis), matching
  how the queue's other gentle reminders (`check-in`, `stale-goals`) behave. It stays visible for the default
  gentle/active proactivity.
- It clears naturally as agreements are marked **done**/**retired** (no standing agreements → no item).

### 3.2 "Together commitments" in the Goals surface (slice A)

The Goals surface (`/goals` route + the Home `GoalsCard`) gains a **"Together commitments"** section,
rendered above/below the personal goals list, only when there are standing agreements:

- One row per standing agreement: the text, an optional timeframe, the **partner's name**, and a
  **"Mark done"** button. A done row shows a quiet "Done" tag (mirrors `AgreementRow` in the session).
- Marking done calls the new `together:setAgreementStatus` channel (§6) → writes `status: 'done'` to the
  **shared** agreement, so both partners see it done. The row then leaves the standing set.
- A "retire" affordance (secondary) mirrors the session ledger.
- Read-only for text/timeframe (edit stays in the session, §2). Each row carries a **quiet link into the
  originating Together session** ("from your session with `<partner>`") for full editing.
- Marked "Together commitments" (not "Goals") so it's clear these are shared with a partner, not private
  personal goals. A short one-line note: "Shared with `<partner>` — either of you can update these."

The Home `GoalsCard` shows a compact **passive roll-up** ("`N` Together commitments") linking to the same
section, **in addition to** the needs-attention item (decided 2026-07-14) — the needs-attention row is the
actionable callout, the `GoalsCard` count is a passive glance. It does not duplicate the full list on Home.

### 3.3 Session top summary strip (slice B)

`TogetherSession` renders a compact **summary strip** directly under the session header (`sessionTop`,
above `TogetherThread`) whenever the loaded `reportView` has a report **or** ≥1 non-retired agreement:

- Content: a pin icon + "`N` agreement`s`" (when any) + "reflection from `<relative date>`" (when a report
  exists) + a **"Jump to reflection"** text button.
- "Jump to reflection" scrolls the existing `TogetherReflection` section into view (an anchor / ref +
  `scrollIntoView`), rather than the user hunting to the bottom.
- If a wrap-up is available but not yet run (memory + AI on, no report), the strip instead reads "Ready to
  wrap up & reflect" with the same jump — so the affordance to _create_ the reflection is also surfaced up
  top.
- The full `TogetherReflection` panel stays at the bottom (unchanged); the strip is a lightweight
  signpost, not a relocation of the whole panel.

### 3.4 Inline Pulse check-in on Home (slice C)

A new **`pulse-checkin`** recommendation surfaces in the Home **"For you"** band (not the needs-attention
queue — that queue is navigation-only; the check-in needs inline controls):

- It appears when the active person has an eligible live partner (the **first** eligible partner) **and**
  a check-in is **due** for that partner — due = **never checked in, or last check-in > `PULSE_DUE_DAYS`
  (default 7) ago** (§11). Home derives `pulseCheckinDue` by fetching that partner's Pulse view once per
  load (a free deterministic read); logging clears it for the window.
- The card renders the **existing check-in form** ("How are things with `<partner>`?", the three
  `PULSE_METRICS` as Low/Steady/High `SegmentedControl`s, the default-off lock-gated "share my desire
  level" `Switch`, and Save) — extracted from `TogetherPulse` into a shared `PulseCheckInForm` so the
  Together page and the Home card render one implementation (DRY; the consent model + desire gate are
  byte-identical).
- On Save it calls the existing `togetherPulseLog` and shows the "Saved. Come back anytime." state; the
  card then drops out of "due" until the next window.
- It is subject to the standard recommendation gating: `capabilityGate: 'together.own'`, hidden under
  `proactivity === 'off'` / `isNew` / `crisis`, and competes for the band's capped slots by score.
- The read-only pulse **ring** on `TogetherHomeCard` (60 §3.1.5) is unchanged — it's the trend glance; the
  new card is the "log it now" callout. They coexist.

## 4. Data model (vault files & schemas)

**No new persisted files or schema.** This spec is surfacing + read/write over existing records:

- **Agreements** — `together/pairs/<pairKey>/agreements/<id>.enc` (`AgreementSchema`, spec 58 §3.9).
  Unchanged. Mark-done/retire writes the existing record via the existing core `saveAgreement`.
- **Pulse check-ins** — `people/<logger>/together/pulse/<pairKey>/<id>.enc` (`PulseCheckInSchema`, 58
  §3.10a). Unchanged. Logged via the existing core `logPulseCheckIn`.

**New crypto-free view types** (renderer-facing, in `@selfos/core/schemas`, not persisted):

```ts
// One standing agreement surfaced outside its session, with the partner resolved for display + write-back.
export interface AgreementSummary {
  agreement: Agreement; // the shared record (carries provenance.sessionId for the "open session" link)
  partnerPersonId: string; // the OTHER participant (drives the mark-done write + display name)
  partnerName: string; // resolved display name (falls back to "your partner")
}
```

`pulseCheckinDue` is a renderer-derived signal on `PersonRecommendationState` (additive-optional), not a
vault field:

```ts
// Added to PersonRecommendationState (recommendations/schemas.ts) — additive-optional.
pulseCheckinDue?: { partnerPersonId: string; partnerName: string };
```

**Ownership:** all reads/writes go through the existing core services + the bridge; the renderer never
touches `fs`.

## 5. Architecture & modules

### Core (`packages/core`)

- **`together/agreementService.ts`** — add `listStandingAgreementsForViewer(fs, key, viewerId): Promise<AgreementSummary[]>`:
  list `together/pairs/`, keep pairKeys whose two `~`-split ids include `viewerId`, `listAgreements` +
  `standingAgreements` each, resolve the partner id (the other segment). (Display-name resolution is done
  in the bridge, which has `people` access — the core returns partner **ids**; the bridge attaches names.
  Alternatively the core returns ids and a thin summary; see §6.) Corrupt/absent dirs are skipped.
- No change to `pulseService` — the Home card uses the existing `logPulseCheckIn` / `buildPulseView`.
- **`recommendations/providers.ts`** — add a `pulseCheckin` provider (`domain: 'together'`,
  `capabilityGate: 'together.own'`, `relevance` returns a candidate from `state.pulseCheckinDue`). Register
  it in `BUILT_IN_RECOMMENDATION_PROVIDERS`. Its id is **not** added to `ATTENTION_REC_IDS` (it stays in
  the For-you band because it needs an inline control).

### Renderer (`apps/desktop/src/renderer`)

- **`app/routes/together/PulseCheckInForm.tsx`** (new) — extract the check-in form (metric
  `SegmentedControl`s + share-desire `Switch` + Save + the "How are things with `<partner>`?" head + the
  saved/nudge line) from `TogetherPulse`. `TogetherPulse` becomes `PulseCheckInForm` + the trend chart +
  alignment banner. The form takes `partnerId`, `partnerName`, and an `onLogged?` callback.
- **`app/routes/together/TogetherSession.tsx`** — add the top summary strip (§3.3) with a ref to the
  reflection section for the jump.
- **`app/routes/home/RecommendationItem.tsx`** — add a `rec.id === 'pulse-checkin'` branch rendering
  `PulseCheckInForm` (the established inline-control pattern, alongside `stale-goal` / `challenge-checkin`).
- **`app/routes/home/Home.tsx`** — compute `recState.pulseCheckinDue` (fetch `togetherPulse` for the
  first eligible partner → due when never / `lastCheckInAt` older than `PULSE_DUE_DAYS`), and feed the
  agreements needs-attention item (fetch `together:myAgreements` in the per-person effect; add to the
  `needsAttention(...)` input).
- **`app/routes/home/attention.ts`** — add the `agreement` `AttentionKind` + its item; **`NeedsAttentionCard.tsx`**
  gains the `handshake` icon mapping.
- **`app/routes/home/NeedsAttentionCard` / `GoalsCard.tsx`** — the compact "N Together commitments"
  roll-up on the Goals card.
- **Goals surface** (`app/routes/goals/…`) — the "Together commitments" section (§3.2), a small
  route-local component listing `AgreementSummary[]` with mark-done/retire + the open-session link.
- **`stores/togetherStore.ts`** — add `myAgreements` state + `loadMyAgreements()` + `setAgreementStatus()`
  actions over the new channels; the Goals surface + Home read from it (reset on person switch — the
  per-person rule).

No new design-system primitive (the strip, the commitments rows, and the check-in form all compose
existing primitives) → **no `/gallery` change** unless `PulseCheckInForm` is deemed a reusable primitive
(it's route-local for now).

## 6. IPC / API contracts

Two new channels, both gated `together.own` + **active-person-scoped in the bridge** (the trust boundary —
only agreements for pairs the active person is a member of; the pair is re-resolved from the partner id on
every write):

- **`together:myAgreements`** — request `{}`; response `AgreementSummary[]`. The bridge lists the active
  person's pairs, returns their standing agreements, and attaches each partner's display name (bridge has
  `people` access). Never returns another household member's pairs.
- **`together:setAgreementStatus`** — request `{ partnerPersonId: string; agreementId: string; status: 'standing' | 'done' | 'retired' }`;
  response `Agreement | null`. The bridge resolves the pair from `(activePerson, partnerPersonId)`, loads
  the existing agreement, and re-saves via the existing core `saveAgreement` (preserving text / timeframe /
  `createdAt` / origin provenance — only the status changes). Returns `null` if the pair/agreement can't be
  resolved (calm no-op in the UI).

The existing `together:pulse` / `together:pulseLog` (58 §3.10a) are reused unchanged for the Home inline
check-in. No Claude API involved in this spec (the wrap-up that _creates_ agreements is 58's; here we only
read/status them).

## 7. States & edge cases

- **No partner / no agreements / no pulse** — the needs-attention item, the commitments section, and the
  pulse card each self-hide (never a dead control).
- **Loading** — Home skeletons (existing); the commitments section renders after `myAgreements` loads.
- **Origin session withdrawn/deleted** — mark-done resolves the pair from the **partner id**, not the
  session, so it still works even if `provenance.sessionId` no longer resolves. The "Open in Together" link
  still points at `/together/session/<sessionId>`; if that session is gone/inaccessible, the session route
  shows its calm "This session isn't available right now" view (a graceful degrade, not a dead-end) — the
  commitment itself is unaffected.
- **Partner edge lapsed** (partner no longer a subject with a login) — `myAgreements` still returns the
  viewer's own standing agreements for that pair (they're the viewer's commitments too), but the partner
  name falls back to a stored/"your partner" label; the pulse card requires an **eligible live** partner
  (matches Together's live-edge rule) so it hides.
- **Concurrent edit / sync** — last-write-wins on the shared agreement (58 §7 accepted); a partner marking
  done on another device syncs via the vault watcher; Home/Goals re-read on `onVaultChanged` (debounced,
  the existing Together refresh pattern).
- **Pulse due flicker** — `pulseCheckinDue` is computed once per Home load / person switch; logging a
  check-in clears it for the window. A stale value never persists (recomputed on next load).
- **Offline (no Claude)** — unaffected; agreements + pulse are AI-free reads/writes. (Creating a new
  reflection from the session strip needs AI, per 58 — the strip's "Ready to wrap up" affordance shows the
  same connect-Claude state the reflection panel already does.)
- **Crisis** — the needs-attention agreement item and the pulse For-you card are both suppressed under an
  active crisis signal (the rank engine early-returns; the queue drops non-urgent items), consistent with
  60/53.

## 8. Safety

Together is a wellbeing (not medical) couples feature; the not-therapy framing, crisis footer, and the
in-session escalation/coercion handling (58 §8) are unchanged — this spec adds no conversational surface.
The Pulse desire metric stays behind the **default-off, explicit dual-consent** share toggle exactly as in
58 §3.10a (reused form, same gate) — a partner's raw metrics are never shown; only the consented alignment
read is. Agreements are the couple's own words; surfacing them to a member only ever shows **their own
pairs'** agreements (bridge-scoped), never another household member's. No admin-access disclosure copy
(durable rule).

## 9. Accessibility

- The summary strip's "Jump to reflection" is a real `<button>` moving focus to the reflection section
  (`tabIndex=-1` + `focus()` on the section, not just `scrollIntoView`), so keyboard + screen-reader users
  reach it too.
- The needs-attention agreement row and the commitments rows are keyboard-navigable buttons/links with
  descriptive labels (partner named); the pulse metric controls reuse the existing `SegmentedControl`
  a11y (per-metric `aria-label`), and the share toggle keeps its lock-note label.
- Counts/states are text (never colour/icon alone); reduced-motion respected on the jump scroll
  (`scrollIntoView` honours the OS setting via the existing app behaviour).

## 10. Testing strategy

**Unit (Vitest, core)**

- `listStandingAgreementsForViewer` — returns only the viewer's pairs' **standing** agreements (excludes
  done/retired, excludes other members' pairs), resolves the partner id, skips a corrupt entry.
- The `pulseCheckin` provider — returns a candidate iff `pulseCheckinDue` set; null otherwise; respects
  `capabilityGate`.

**Component (Vitest + RTL)**

- The Goals "Together commitments" section — lists standing agreements, mark-done calls
  `setAgreementStatus` and drops the row, hides when empty.
- `RecommendationItem` `pulse-checkin` branch — renders the three metrics + share toggle, Save calls
  `togetherPulseLog`.
- The session summary strip — shows count + jump when a report/agreements exist, hidden otherwise; jump
  focuses the reflection section.
- `NeedsAttentionCard` — renders the agreement item with the partner name + routes to `/goals`.

**Integration (coreBridge, two-persona)**

- `together:myAgreements` — persona A sees only A's pairs' standing agreements, not B's; a standing
  agreement A + B share appears for both; a done one is excluded.
- `together:setAgreementStatus` — A marks done → the shared record (read by B) is done; a non-member is
  refused (`null`); resolves the pair from the partner id (works with a deleted origin session).

**E2E (Playwright)**

- Seed a pair with a standing agreement + no recent pulse → Home shows the "Following through with
  `<partner>`" needs-attention item **and** the inline "How are things…" pulse card; log a check-in inline
  (decrypt asserts the `PulseCheckIn` written); open Goals → "Together commitments" → mark done (decrypt
  asserts the shared `Agreement` status is `done` + the Home item cleared); open the session → the top
  summary strip shows + "Jump to reflection" scrolls to the panel. 360px overflow guard on the new
  surfaces.

Vault + Claude are mocked per the standard harness (agreements/pulse are AI-free here; the fakes cover the
no-key/over-budget states inherited from the reused surfaces).

## 11. Open questions

_All resolved 2026-07-14._

1. **Pulse "due" cadence.** RESOLVED — surface the Home inline check-in when the person has **never**
   checked in with the partner **or** the last check-in is **> `PULSE_DUE_DAYS` = 7 days** old. Flat 7 days
   for v1, tunable later.
2. **Agreement callout prominence vs nagging.** RESOLVED — the **clear-as-you-act, non-dismissible**
   version: show the "Following through with `<partner>`" needs-attention item whenever there are standing
   agreements; it clears only as they're marked done/retired. No per-item dismissal in v1.
3. **Home commitments roll-up placement.** RESOLVED — show **both**: the needs-attention item (actionable
   callout) **and** a passive "`N` Together commitments" count on the `GoalsCard`. Re-check in visual QA
   that the two don't read as noisy.

## 12. Changelog

- 2026-07-14 — created + **Approved**. Bundles slices A (agreements → Goals + needs-attention), B (session
  top summary), C (inline Pulse on Home) from the 2026-07-14 review. Decisions: surface agreements
  alongside goals (no duplicate `Goal` records), all three pulse metrics inline; pulse due at > 7 days;
  agreement callout is clear-as-you-act (non-dismissible); Home shows both the needs-attention item and a
  passive `GoalsCard` count. Memory insights redesign is a separate spec (62).
