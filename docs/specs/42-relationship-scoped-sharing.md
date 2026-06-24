# 42 — Relationship-scoped sharing (the foundational sharing model)

> **Status:** Built — the data layer, resolver, category presets, confidentiality rule, transparency read
> (`listOutboundSharing` + `memory:outboundSharing`), and the reusable `RelationshipScopePicker` control are
> implemented (the foundational read + model; the per-question onboarding UI is
> [`43`](43-relationship-scoped-onboarding-sharing.md) and the Memory surfaces are
> [`44`](44-memory-dashboard-overhaul.md)) · _last updated 2026-06-23_
>
> Today, what one person's data may inform **another** related person's AI coaching context is an
> all-or-nothing decision: a fact is either broadcast to **every** related person (`shareable: true`) or
> targeted at a single person id (`shareableWith`), and **all onboarding (intake) data is hardcoded
> own-context-only** so it is never shared at all. This spec introduces **relationship-type-scoped
> sharing**: every shareable item (an Insight fact **and** a structured intake answer) can name the
> **relationship types** (`partner`, `parent`, `sibling`, `friend`, …) whose people's AI may use it,
> resolved against the **live relationship graph** at context-build time. It also makes "shared" honestly
> mean **"informs their AI, never shown to them"** via a coach **confidentiality rule**, and ships the
> **data layer + a reusable control + a transparency read** that specs [`43`](43-relationship-scoped-onboarding-sharing.md)
> (onboarding) and [`44`](44-memory-dashboard-overhaul.md) (Memory) build on.

This is the **foundational** spec of the relationship-sharing group (42 → then 43 & 44 in parallel). It
amends the per-item shareability model of [`15`](15-shareability.md) and the shared Insight/context layer
([`08`](08-questionnaires.md) §1.1/§4.4) read by [`05`](05-conversations.md)/[`09`](09-session-analysis.md)
(sessions), [`12`](12-dreams.md)/[`13`](13-dream-images.md) (dreams), [`08`](08-questionnaires.md)
(questionnaires), [`18`](18-personal-onboarding.md) (intake), and [`20`](20-memory-dashboard.md)/[`44`](44-memory-dashboard-overhaul.md)
(Memory). It touches the seam — `buildContext`/`summarizeForContext` — that every coaching surface reads,
so it lands first. References [`00`](00-architecture.md), [`01`](01-design-system.md),
[`04`](04-people-roles.md) (relationship graph), [`11`](11-relationship-tracking.md).

---

## 1. Overview

**The problem.** SelfOS is built for households where related people's coaching can draw on each other —
the motivating case is **marriage / sex counseling**: a spouse's answers personalizing the _other_
spouse's coaching. But the current sharing model can't express it safely:

- **Sharing is all-or-nothing.** A fact is `shareable: true` (broadcast to **every** related person —
  parent, coworker, ex, child) or `shareableWith: [oneId]` (one specific person). There is no "share with
  my partner(s), but never my parent or coworker." So the safe-feeling default has to be _off_, and the
  Memory "Share" toggle today **broadcasts to everyone** — a latent privacy hazard in any household with a
  mix of relationships.
- **Intake never shares.** Every onboarding Insight fact is hardcoded `shareable: false`
  (`intakeService.synthesizePortrait`), and trauma/intimacy facts are additionally `restricted` (never
  shareable). So the richest data about a person — their onboarding answers — **cannot** inform a partner's
  coaching at all, even when both want it. This spec unblocks that (the per-question UX is [`43`](43-relationship-scoped-onboarding-sharing.md)).
- **"Shared" leaks more than intended.** Shared facts are dumped into the related person's context block
  with no instruction restraining the coach, so nothing stops it saying _"I know your wife enjoys X."_ For
  the counseling use case that **breaks the whole promise** — shared data must _inform_, never be _disclosed_.

**The change.** Three foundational pieces:

1. **Relationship-type scoping.** A shareable item names the **relationship types** whose related people's
   AI may use it. Resolution happens **at context-build time** against the live graph, so adding a sibling
   later automatically grants/denies per the item's types — no per-person bookkeeping.
2. **Two shared surfaces, one model.** Both the AI-distilled **Insight facts** and the structured **intake
   answers** carry relationship-type scopes and flow into related people's context (the answer path is the
   spec [`43`](43-relationship-scoped-onboarding-sharing.md) producer; this spec owns the _read_ + resolver).
3. **Honest "shared ≠ shown."** A coach **confidentiality rule** in the prompt: cross-shared content
   personalizes but is **never** quoted, attributed, or revealed to the recipient. Plus a **transparency
   read** (`listOutboundSharing`) powering the "what you share & with whom" surfaces in [`43`](43-relationship-scoped-onboarding-sharing.md)/[`44`](44-memory-dashboard-overhaul.md).

**What "shared" means (sharpened).** A person's own session **always** uses **all** of their own data —
it is _their_ context. Sharing governs one thing only: whether an item **also** flows into the coaching
context of **other people who relate to them in a chosen way**, where the coach may **use but never
disclose** it. "Private" still means "kept out of everyone else's coaching," never "hidden from my own AI."

## 2. Goals / Non-goals

**Goals**

- **Relationship-type-scoped sharing** for Insight facts **and** intake answers, resolved against the live
  graph at build time (a new sibling/partner inherits access automatically per the item's scope).
- **Category-aware default presets** (a shared constant) so onboarding can default sensibly (partner →
  everything; close family/friends → all but intimacy & trauma; coworker → basics/work/values; ex/other →
  nothing) — applied by [`43`](43-relationship-scoped-onboarding-sharing.md), defined here.
- **The confidentiality rule** — a prompt-level instruction so cross-shared content is **used, never
  disclosed**; "shared" honestly means "informs their AI," not "shown to them."
- **A transparency read** — `listOutboundSharing(personId)` → exactly which items flow to which
  relationship types and which concrete people, powering the Memory/onboarding sharing surfaces.
- **A reusable `RelationshipScopePicker`** design-system control (a per-item relationship-type chooser) +
  the `/gallery` entry, used by [`43`](43-relationship-scoped-onboarding-sharing.md) (per question) and
  [`44`](44-memory-dashboard-overhaul.md) (per fact).
- **Safety-first defaults & resolution** — restricted (trauma/intimacy) facts stay `restricted` and remain
  own-context-only **unless** explicitly type-scoped by the owner/person; a corrupt scope fails **closed**.
- **Migration-safe** — additive-optional schema (no `schemaVersion` bump), reusing the `15`/`18` additive
  precedent; legacy `shareable`/`shareableWith` keep working.

**Non-goals (deferred / out of scope)**

- **The onboarding per-question UI + share-by-default flip** — that's [`43`](43-relationship-scoped-onboarding-sharing.md). This spec exposes the _model, resolver, presets, confidentiality rule, transparency read, and the picker control_ only.
- **The Memory stats/flag/transparency surfaces** — that's [`44`](44-memory-dashboard-overhaul.md). This spec provides the data layer they consume.
- **A separate "connected accounts" handshake / mutual-accept step.** Resolved (2026-06-23): the in-app
  relationship is sufficient; both people see the sharing in the transparency panel. No accept ceremony.
- **Per-person field-level sharing UI on People** (spec [`15`](15-shareability.md)'s lock model). Person
  _fields_ keep their existing `privateFields` boolean lock; this spec adds \*\*type-scoping for Insight facts
  - intake answers\*\*, not a third axis on People fields. (A future unification is possible; out of scope.)
- **Auto-creating People/relationships** from intake (still phase 2, [`18`](18-personal-onboarding.md) §2).
- **Changing crisis/not-medical behavior** — unchanged.

## 3. UX & flows

This is a **foundational/developer-facing** spec; its user-visible surfaces are delivered by
[`43`](43-relationship-scoped-onboarding-sharing.md) and [`44`](44-memory-dashboard-overhaul.md). It ships
**one** reusable UI primitive and the shared copy they use.

### 3.1 `RelationshipScopePicker` (design-system control)

A compact, accessible control representing one item's sharing scope:

- **Collapsed:** a chip summarizing the scope — `Private` (lock icon) / `Shared: Partner` / `Shared:
Partner, Family` / `Shared: everyone you've allowed`. Text + icon, never colour-only.
- **Expanded (popover):** a labelled checkbox list of the relationship types present in the person's graph
  (or the full type set when authoring), each "Partner", "Parent", "Child", "Sibling", "Friend",
  "Coworker", "Ex", "Other", plus a **"Private (only me)"** clear-all. A short explainer line:
  _"People you relate to this way can have this inform their AI coaching — they never see it directly."_
- Emits the chosen `RelationshipType[]` (empty ⇒ private). Keyboard-operable, `aria-pressed`/`aria-expanded`,
  visible focus, names state in text (design-system §9). `flex: none` so it never shrinks in a row.
- Added to `/gallery` (DoD §12). [`43`](43-relationship-scoped-onboarding-sharing.md) renders it per
  question; [`44`](44-memory-dashboard-overhaul.md) renders it per fact (replacing the broadcast
  `ShareToggle`).

### 3.2 Shared copy (single source, reused)

The honest "shared ≠ shown" message is defined here as exported strings so all surfaces are consistent:

- **Inline explainer:** _"Sharing lets the people you choose have this **inform their AI coaching** — to
  help personalize their experience (e.g. couples or intimacy coaching). They **never see your answers
  directly**, and their coach won't repeat them back."_
- **Scope summary helper:** `describeScope(types) → "Partner" | "Partner, Family" | "Private" | …`.

### 3.3 Resolution flow (what happens at coaching time)

When person **B** starts any coaching surface (`buildContext(B)`):

1. Find B's related people (existing relationship-graph traversal).
2. For each related person **A**, compute the **relationship type(s) A→B** from the graph.
3. Include an A-owned shareable item in B's context iff it is **not** restricted, **not**
   flagged-inaccurate, and **its scope grants B** — i.e. `shareable === true` (legacy broadcast) **or**
   `shareableWith.includes(B)` **or** `shareableTypes` intersects the A→B type(s).
4. Wrap all such cross-shared lines under the **confidentiality preamble** (§3.4) so the coach uses but
   never discloses them.

### 3.4 The confidentiality rule (prompt-level)

Whenever cross-shared content from related people is present in a context, it is prefixed with a
non-negotiable instruction (appended in the SAFETY-adjacent region, never overridable by persona/topic):

> _"The lines below were shared by people related to <name> to help you support <name>. Treat them as
> **private background**: let them shape how you help, but **never quote them, name who shared them, or
> reveal that you know them**. If <name> asks what someone else said or shared, say you don't share other
> people's private information."_

This is what makes "shared ≠ shown" structurally true, not just a label.

## 4. Data model (vault files & schemas)

All reads/writes via the vault/crypto service (no direct `fs`). Changes are **additive-optional** — **no
`schemaVersion` bump** (the `email`/`phone`/`shareableWith` precedent). Existing facts/answers parse
unchanged.

### 4.1 `RelationshipType` (reuse) + `InsightFact.shareableTypes`

Reuse the existing `Relationship.type` enum as the canonical `RelationshipTypeSchema`
(`'partner' | 'parent' | 'child' | 'sibling' | 'friend' | 'coworker' | 'ex' | 'other'`) — export it as a
named schema if not already.

Add to `InsightFactSchema` (`packages/core/src/schemas.ts`):

```ts
// The relationship types whose related people may have this fact inform THEIR coaching context.
// Resolved against the live relationship graph at buildContext time. Absent/empty ⇒ not type-shared
// (still own-context-only unless the legacy `shareable`/`shareableWith` paths apply). Restricted facts
// are NEVER shared regardless (§8). Additive-optional.
shareableTypes: z.array(RelationshipTypeSchema).optional(),
```

The existing `shareable: boolean` (legacy broadcast) and `shareableWith?: string[]` (per-person) are
**retained** for back-compat and for the explicit "everyone" / "this one person" cases (dreams use
`shareableWith`). The **new sharing UIs set `shareableTypes`**, never broadcast `shareable: true` by
default.

### 4.2 Intake answer sharing — `IntakeSection.answerSharing`

To share the **structured answers** (the "both answers and facts" decision), the per-question scope chosen
in onboarding ([`43`](43-relationship-scoped-onboarding-sharing.md)) is persisted on the intake session:

```ts
// On IntakeSection: per-question sharing scope. Keyed by question id → the relationship types whose
// people may have this answer inform their coaching. Absent question ⇒ that answer's category default
// (resolved by 43 at submit time, then stored explicitly here). Additive-optional.
answerSharing: z.record(z.string(), z.array(RelationshipTypeSchema)).optional(),
```

The **answers themselves** already live in `IntakeSection.answers`. This spec defines how they are **read
into a related person's context** (§5.2); [`43`](43-relationship-scoped-onboarding-sharing.md) owns
writing `answerSharing` and the per-question UI.

### 4.3 Category default presets (shared constant)

A code constant (single source of truth, consumed by [`43`](43-relationship-scoped-onboarding-sharing.md)):

```ts
// packages/core/src/people/sharingPresets.ts (or alongside the catalog)
// Default relationship-type scope per intake CATEGORY (life-area / section group). Per-question
// overridable. Resolved (2026-06-23): partner = everything; close family/friends = all but intimacy &
// trauma; coworker = basics/work/values; ex/other = nothing.
export const SHARING_PRESETS: Record<SharingCategory, RelationshipType[]> = {
  basics: ['partner', 'parent', 'child', 'sibling', 'friend', 'coworker'],
  values: ['partner', 'parent', 'child', 'sibling', 'friend', 'coworker'],
  goals: ['partner', 'parent', 'child', 'sibling', 'friend'],
  work: ['partner', 'parent', 'child', 'sibling', 'friend', 'coworker'],
  joy: ['partner', 'parent', 'child', 'sibling', 'friend'],
  health: ['partner'], // private-leaning; partner by default
  relationships: ['partner', 'friend'],
  family: ['partner', 'parent', 'child', 'sibling'],
  story: ['partner', 'friend'],
  intimacy: ['partner'], // restricted: partner ONLY by default
  trauma: ['partner'], // restricted: partner ONLY by default
};
```

The exact category→default mapping is tuned with [`43`](43-relationship-scoped-onboarding-sharing.md) at
build (the source of truth is this constant); the **principle** is fixed by the 2026-06-23 decision.

### 4.4 Ownership & migration

- **No migration / no bump.** `shareableTypes`, `answerSharing` are additive-optional; pre-spec
  facts/sessions parse unchanged (the [`15`](15-shareability.md)/[`18`](18-personal-onboarding.md) §14.9
  additive precedent).
- All persistence stays through the vault/crypto service. `restricted` semantics unchanged; a restricted
  fact ignores `shareableTypes` entirely (§8).

## 5. Architecture & modules

### 5.1 The relationship-type resolver (pure, tested)

A new pure helper in `@selfos/core/people` (e.g. `relationshipScope.ts`):

- **`relationshipTypesFromSubjectToViewer(subjectId, viewerId, relationships): RelationshipType[]`** —
  the type(s) describing how `subject` relates to `viewer` **from the subject's perspective** (the subject
  set the scope). Uses the existing bidirectional edge lookup; derives the inverse type where the edge is
  stored the other way (the [`04`](04-people-roles.md) §4.2 inverse-type derivation — e.g. an edge
  `from=parent,to=child,type='child'` means the subject's relation to that viewer is "child"). Returns all
  matching types (a pair can have >1 edge). Empty when unrelated.
- **`scopeGrants(item, subjectId, viewerId, relationships): boolean`** — the single gate combining
  `shareable` (legacy broadcast) ∨ `shareableWith.includes(viewer)` ∨ (`shareableTypes` ∩
  `relationshipTypesFromSubjectToViewer(...)` ≠ ∅), **AND** `restricted !== true` **AND**
  `flaggedInaccurate !== true`.

### 5.2 Context assembly (`@selfos/core/insights` + `@selfos/core/people`)

- **`summarizeForContext`** — replace the inline `(fact.shareable || shareableWith.includes(personId))`
  predicate with `scopeGrants(fact, otherId, personId, relationships)`. It now needs the **relationships
  list** + each related person's id (it already iterates related people). Restricted + flagged exclusions
  unchanged (they're folded into `scopeGrants`).
- **Shared intake answers** — add a sibling that emits, for each related person A, A's **shared structured
  answers**: read A's `IntakeSession`, and for each answered question whose `answerSharing[qid]` intersects
  the A→B type(s), emit a labelled line (`"<question label>: <answer>"`). Reuses the catalog to resolve a
  question id → human label and `answerToString` for the value. Capped (a per-person line budget like the
  existing `MAX_SHARED_FACTS_PER_PERSON`).
- **`listRelatedShareableInsights`** (the Memory read) — same `scopeGrants` swap; continues to project the
  **minimal shape** (only shareable fact text + scrubbed provenance), never spreading restricted/metrics/etc.
- **The confidentiality preamble** (§3.4) — emitted by `promptBuilder`/`summarizeForContext` **whenever**
  any cross-shared line (fact or answer) is present, once, before the shared block.

### 5.3 Transparency read

- **`listOutboundSharing(fs, key, personId, relationships): OutboundSharing`** — for the subject, returns
  every shareable item they own (Insight facts with `shareableTypes`/`shareableWith`/broadcast + shared
  intake answers) with: the item label/text (own data, so full), its scope (types + any explicit person
  ids), and the **concrete related people currently receiving it** (resolved against the graph). Powers the
  [`44`](44-memory-dashboard-overhaul.md) "what you share & with whom" surface and the
  [`43`](43-relationship-scoped-onboarding-sharing.md) onboarding summary. Own-scoped (a person sees only
  their **own** outbound sharing).

### 5.4 Renderer

- The `RelationshipScopePicker` primitive + the shared copy strings (§3.1/§3.2) live in the design system /
  a shared module; [`43`](43-relationship-scoped-onboarding-sharing.md)/[`44`](44-memory-dashboard-overhaul.md)
  import them. No new route/nav/store here.

## 6. IPC / API contracts

- **No new channels for the model itself** — `shareableTypes` rides the existing `insights:update`
  (Memory edit) and the intake synthesis path; `answerSharing` rides `intake:submitForm`
  ([`43`](43-relationship-scoped-onboarding-sharing.md)). The trust boundary (Zod validation in the bridge,
  active-person scoping) is unchanged; the Claude key stays in main.
- **`memory:outboundSharing()`** (new, own-scoped, gated `memory.own`) → the `listOutboundSharing` result
  for the active person — consumed by [`44`](44-memory-dashboard-overhaul.md)'s sharing summary/panel.
  (Defined here so the read is foundational; the surface is in 44.)
- **Claude API** — no new call. This spec changes **what text** `buildContext` assembles (adding
  type-resolved shared facts/answers + the confidentiality preamble), not how the model is called.

## 7. States & edge cases

- **Item type-scoped, viewer unrelated / wrong type** → excluded from the viewer's context (the common
  safe case). Verified per type.
- **New relationship added after scoping** → the next `buildContext` resolves it live; access follows the
  item's `shareableTypes` automatically (no per-person rewrite).
- **Relationship removed / type changed** → access re-resolves at read; a removed partner immediately stops
  receiving partner-scoped items (no stale leak — the [`15`](15-shareability.md) read-time-gate property).
- **Restricted fact with `shareableTypes` set** → **still excluded** from every other person's context
  (`restricted` wins; defense-in-depth, [`18`](18-personal-onboarding.md) §8.4). The owner can only share a
  restricted item by first making it non-restricted (an explicit, deliberate act in
  [`44`](44-memory-dashboard-overhaul.md)).
- **Flagged-inaccurate fact** → excluded regardless of scope (already in `scopeGrants`).
- **Asymmetric / one-directional relationship** → the resolver uses the subject→viewer direction; if A
  scopes "partner" and the only edge is A→B typed partner, B receives it; B sharing back is B's own
  independent choice (sharing is per-owner, not auto-reciprocal — matches the consent model).
- **Corrupt `shareableTypes`/`answerSharing`** → fails Zod → the record is treated as unreadable/own-only,
  **never silently broadcast** (fail-closed).
- **Legacy broadcast `shareable: true`** → still grants all related people (back-compat); the new UIs never
  set it, and [`44`](44-memory-dashboard-overhaul.md) migrates the Memory toggle to type-scoping.
- **Offline (no Claude)** → pure data/context-assembly change; resolves fully offline.
- **Sync conflict / corrupt file** → standard vault behaviour ([`00`](00-architecture.md)).
- **Large graph / many shared items** → per-person line budget caps context size (§5.2).

## 8. Safety, privacy & honesty

Sharing **is** the safety surface here (CLAUDE.md §1 — all user content is highly sensitive).

- **The boundary that must always hold:** an item only reaches a viewer whose relationship type the owner
  chose; restricted (trauma/intimacy) facts are **never** shared by type; a corrupt scope fails closed. The
  test suite asserts this exhaustively (§10).
- **"Shared ≠ shown" is enforced, not promised** — the §3.4 confidentiality preamble means a recipient's
  coach **uses but never discloses** cross-shared content. This is the load-bearing guarantee for the
  couples/sex-counseling use case and is part of the not-disclose contract (CLAUDE.md durable rule:
  never tell users an owner/admin can see their data — here, never reveal _another person's_ shared data).
- **Restricted stays restricted** — the [`18`](18-personal-onboarding.md) §8.4 invariants are unchanged;
  `shareableTypes` cannot override `restricted`. Sharing intimacy with a partner (the use case) requires the
  owner to **un-restrict** the specific fact deliberately (in [`44`](44-memory-dashboard-overhaul.md)) **and**
  type-scope it — two explicit acts, never a default.
- **Default presets are conservative for the sensitive categories** (§4.3): intimacy/trauma default to
  **partner only**, never friends/family/coworkers — and even that default applies only once the person
  opts those answers into sharing in [`43`](43-relationship-scoped-onboarding-sharing.md).
- **Transparency is mandatory** — `listOutboundSharing` exists so the person can always see exactly what
  flows where; sharing is never invisible (surfaced in [`43`](43-relationship-scoped-onboarding-sharing.md)/[`44`](44-memory-dashboard-overhaul.md)).
- **Not-medical / crisis** ([`05`](05-conversations.md) §7) — unchanged; nothing here weakens crisis routing.

## 9. Accessibility

Per [`01`](01-design-system.md) §9: the `RelationshipScopePicker` is a real button + popover with an
accessible name conveying both **state and meaning** ("Sleep schedule: shared with Partner; activate to
change") — text/icon, never colour-only; `aria-expanded`/`aria-pressed`; visible focus; keyboard-operable;
`flex: none`. The scope summary chip's state is announced as text. Responsive ~360px→desktop (the popover
is reachable + non-clipped at narrow widths, [`01`](01-design-system.md)/§12 dropdown rule). Reduced-motion
respected.

## 10. Testing strategy

- **Unit (core):** `relationshipTypesFromSubjectToViewer` (direct, inverse-derived, multi-edge, unrelated);
  `scopeGrants` truth table — a fact reaches a viewer **iff** type-matches/`shareableWith`/legacy-broadcast
  **and** not restricted **and** not flagged; a `restricted` fact with `shareableTypes` set is **excluded**
  from every other person; a flagged fact excluded; relationship-removed/type-changed re-gates at read;
  corrupt scope fails closed. `listOutboundSharing` reports the right items → right concrete people.
  `summarizeForContext` emits shared **intake answers** for a related person per `answerSharing`, with the
  confidentiality preamble present when (and only when) cross-shared lines exist.
- **Privacy boundary (the headline guard):** a type-scoped intimacy fact reaches the **partner** but **not**
  a sibling/coworker/parent; a restricted fact reaches **no one**; one E2E + bridge test so it can't
  silently regress (mirrors [`20`](20-memory-dashboard.md) §10's cross-user guard).
- **Component (RTL):** `RelationshipScopePicker` renders the type list, emits the chosen set, shows
  `Private`/`Shared: …` chip states, keyboard-operable; the shared copy renders.
- **E2E (Playwright):** person A scopes an intake answer + a fact to `partner`; relate A↔B as partners and
  A↔C as siblings; open B's session → **decrypt the assembled context** and assert A's partner-scoped
  fact/answer is **present** and that the coach prompt carries the **confidentiality preamble**; open C's
  session → assert the same item is **absent**; remove the A↔B partner edge → it's gone from B. 360px guard
  on the picker.
- Vault + Claude mocked as established (`memFileSystem`, `SELFOS_FAKE_CLAUDE`); decrypt the vault to assert
  data, not just UI. Run `pnpm typecheck` after tests (memory `vitest-does-not-typecheck`).

## 11. Open questions

_All major decisions resolved ask-first (2026-06-23):_

- **Scope mechanism** → **relationship-type scoping**, resolved against the live graph at build time
  (not per-person snapshots). (§4.1/§5.1)
- **What flows** → **both** the AI-distilled facts **and** the structured intake answers. (§5.2)
- **Recipient consent** → the **in-app relationship is sufficient**; both people see it in the transparency
  panel — **no accept handshake**. (§2 non-goal)
- **Sensitive default** → intimacy **and** trauma default to **partner only**; the person opts those answers
  into sharing in [`43`](43-relationship-scoped-onboarding-sharing.md), then may extend types per question.
  (§4.3/§8)
- **Default presets** → the §4.3 matrix (partner=all; close family/friends=all-but-intimacy/trauma;
  coworker=basics/work/values; ex/other=nothing). Confirmed 2026-06-23.
- **"Shared ≠ shown"** → enforced via the §3.4 confidentiality preamble, not just copy.

_Build-time tuning:_ the exact category→default mapping constant, the per-person line budget for shared
answers, and the resolver's inverse-type direction details are finalized at build (the constant is the
source of truth).

## 12. Changelog

- 2026-06-24 — **Audit follow-ups** (`fix/relationship-sharing-audit-followups`). A post-build review of
  42/43/44 found three should-fixes, all resolved: **(1)** `buildLinkedPeopleContext` (the dreams
  linked-people context) bypassed the centralized gate — it now routes through `factSharedWithViewer`
  (resolving `grantedTypes` against the live graph) so it honors `shareableTypes`, excludes
  `flaggedInaccurate` facts (a pre-existing leak on the dreams surface), and is prefixed with the §3.4
  confidentiality preamble like `summarizeForContext` — "shared ≠ shown" now holds on dreams too. **(3)** a
  corrupt scope now **fails closed**: `InsightFact.shareableTypes` + `IntakeSection.answerSharing` gained
  `.catch(undefined)` (§7), so a malformed value degrades a fact/answer to own-only instead of throwing out
  of a related viewer's whole `buildContext`. Plus the duplicated inverse-type map is now a single
  `INVERSE_RELATIONSHIP_TYPE` exported from `@selfos/core/sharing` (used by the core resolver + the
  renderer). (#2 — intake-fact scope is in spec 44.) Tests: +`buildLinkedPeopleContext` partner/sibling/
  flagged/restricted + a corrupt-scope-fails-closed unit (`relationshipSharing.test.ts`). Gate green:
  typecheck, lint, format, **719 core + 768 desktop** unit, **105 E2E**.
- 2026-06-23 — **Built.** Implemented the foundational read + model: `InsightFact.shareableTypes` +
  `IntakeSection.answerSharing` (additive-optional, no schemaVersion bump); the pure resolver
  (`relationshipTypesFromSubjectToViewer` + `scopeGrants`, with parent↔child inverse derivation) + the single
  `factSharedWithViewer` gate (broadcast ∨ per-person ∨ type-scope, AND not-restricted/not-flagged);
  `summarizeForContext`/`listRelatedShareableInsights` rewired onto it (caller-resolved `grantedTypes`, so
  `insights` stays cycle-free) + shared **intake answers** read into a related person's context
  (`buildSharedIntakeAnswerLines`, reading the catalog directly to dodge the people↔intake cycle); the §3.4
  **confidentiality preamble** prefixing any cross-shared block ("shared ≠ shown"); the `SHARING_PRESETS`
  constant; `listOutboundSharing` + the `memory:outboundSharing` IPC (own-scoped, `memory.own`-gated); and the
  reusable `RelationshipScopePicker` design-system control + shared copy (`describeScope`, the explainers) +
  `/gallery`. Tests: resolver/`scopeGrants` truth table, the partner-vs-sibling/restricted privacy guard
  (core + bridge + a decrypt-level E2E), the transparency read, `RelationshipScopePicker` RTL, the
  `memory:outboundSharing` gating/own-scope. The per-question onboarding UI (writing `answerSharing`) is
  [`43`](43-relationship-scoped-onboarding-sharing.md); the Memory transparency/flag surfaces are
  [`44`](44-memory-dashboard-overhaul.md).
- 2026-06-23 — created (Draft). Foundational spec of the relationship-sharing group (42 → 43 & 44).
  Decisions resolved ask-first across three question rounds (2026-06-23): relationship-type scoping,
  share both answers + facts, relationship-is-enough consent, intimacy/trauma default partner-only, the
  §4.3 default presets, and the §3.4 confidentiality rule. Amends [`15`](15-shareability.md) (per-item →
  per-relationship-type), the Insight/context layer, and the Memory read; sibling specs
  [`43`](43-relationship-scoped-onboarding-sharing.md) (onboarding) + [`44`](44-memory-dashboard-overhaul.md)
  (Memory) build on it. Build-ready pending final approval.
