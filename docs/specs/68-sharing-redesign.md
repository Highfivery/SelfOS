# 68 — Sharing redesign: a unified "what reaches anyone" transparency dashboard

> **Status:** **Built** · _last updated 2026-08-07_
>
> The `/sharing` ("Sharing & relationships") page today is, by its own admission, _"a relocation, not a
> redesign"_ ([`57`](57-memory-overview-redesign.md) §5.3): a flat, unbounded scroll of one card per shared
> item, with no stats, filter, sort, or grouping — and it **omits** two whole surfaces (profile-field sharing
> and dream-image sharing) that also send a person's data to others. This spec is a **complete redesign** of
> the page into a warm, sleek **transparency dashboard**: a stats header ("N things you share · M people
> reached · K kept private"), **By person / By category / Everything / Reflections** tabs, a filter/sort/search
> bar, and — folding in the two omitted surfaces — the **one complete view of everything about you that reaches
> anyone**. It supersedes [`57`](57-memory-overview-redesign.md) §3.8 + §5.3 (the flat page) and extends the
> outbound-sharing model of [`44`](44-memory-dashboard-overhaul.md) §3.5 / [`42`](42-relationship-scoped-sharing.md) §5.3.

This is an **information-architecture + presentation** redesign that **preserves every sharing mechanic and
privacy boundary** of [`42`](42-relationship-scoped-sharing.md) (relationship-type scoping, the "shared ≠ shown"
confidentiality rule, `restricted` facts never outbound). It needs a small, additive core extension (project
`lifeArea` / `SharingCategory` onto `OutboundSharingItem`, and fold profile fields + dream images into the read)
but **no `schemaVersion` bump** and **no context-feed change**. Reads reuse `memory:outboundSharing`
([`42`](42-relationship-scoped-sharing.md) §6). An interactive mockup (a warm dashboard, lucide icons throughout,
the SelfOS palette) was approved.

References [`00`](00-architecture.md) (vault, IPC, per-person isolation), [`01`](01-design-system.md) (tokens,
responsive, a11y, primitives), and the sharing group it extends: [`42`](42-relationship-scoped-sharing.md) (the
model + resolver + `RelationshipScopePicker` + confidentiality rule + 29 relationship types + presets),
[`44`](44-memory-dashboard-overhaul.md) (`listOutboundSharing` + the "what you share" surface + per-fact
correction/scope), [`15`](15-shareability.md) (profile-field sharing via `Person.privateFields`),
[`43`](43-relationship-scoped-onboarding-sharing.md) (intake-answer sharing + `SharingCategory` presets),
[`13`](13-dream-images.md) (dream-image sharing) / [`12`](12-dreams.md) §3.4 (dream-fact sharing),
[`57`](57-memory-overview-redesign.md) (the page it supersedes), [`05`](05-conversations.md) (crisis/not-medical).

---

## 1. Overview

### 1.1 The problem (documented)

The `/sharing` page was moved out of Memory in [`57`](57-memory-overview-redesign.md) §3.8 **as-is** — a
deliberate relocation, never redesigned. As a result:

- **It's a flat, unbounded scroll with no affordances.** `SharingSection` renders one `Card` per shared item —
  every non-restricted Insight fact **and** every shared intake answer, via `memory:outboundSharing` — with **no
  stats, no filter, no sort, no search, no grouping**. Because sharing **defaults to partner** and is **backfilled**
  onto existing data ([`44`](44-memory-dashboard-overhaul.md) / the [`54`](54-memory-redesign.md) "share ALL by
  default" decision), the list is **long by design** — it can run to dozens of cards with no way to scan or narrow.
- **It stacks two unrelated concerns in one scroll.** `SharingAndRelationships` puts **relationship reflections**
  (per-partner AI observations about you — a _reflection_ surface) above the **outbound-sharing control** (a
  _privacy/transparency_ surface). They compete for the same vertical scroll and read as one muddled page.
- **It OMITS two whole surfaces that also send your data to others.** The page shows Insight facts + intake
  answers only. It does **not** show **profile-field sharing** ([`15`](15-shareability.md) `Person.privateFields`
  — occupation, gender, health notes, faith… flowing to related people; today editable only in the People editor)
  or **dream-image sharing** ([`13`](13-dream-images.md) `Dream.image.shareableWith`; today editable only in
  Dreams). So the page that claims to show "what you share" is **incomplete** — a person cannot audit everything
  about them that reaches anyone from one place.
- **Two data warts.** (1) A **per-person-shared dream fact** ([`12`](12-dreams.md) §3.4 — `shareableWith` set,
  `shareableTypes` empty) renders its scope via `describeScope([])` → **"Shared with Private · reaching Sam"** — a
  self-contradiction ("Private" yet a named recipient). (2) An **intake-derived fact** (`source: 'intake'`) renders
  as an **inert read-only twin row** ("Set by your onboarding answer") right beside its editable `intakeAnswer`
  row — two rows for one thing, one of them a dead control.
- **A broken cross-link.** Home's `SharingCard` "Manage" button navigates to **`/memory`** (wrong — the sharing
  surface left Memory in [`57`](57-memory-overview-redesign.md)); it must go to **`/sharing`**.

### 1.2 The redesign (approved mockup) — a unified transparency dashboard

`/sharing` becomes the **one complete, scannable view of everything about you that reaches anyone**, and the one
place to control all of it:

1. **Stats header** — three warm stat tiles: **"N things you share"** (split by relationship type — Partner _k_ ·
   Close family _j_ · Friends _i_ …), **"M people reached"** (per-recipient chips, each an `Avatar` + a count),
   **"K kept private"** (the sensitive/`restricted` facts that are **never** shared — a reassurance count, not a
   list of secrets).
2. **Tabs** — **By person** (default) · **By category** · **Everything** · **Reflections**.
3. **A filter / sort / search bar** — filter by type / recipient / category / kind; sort by recently-changed /
   recipient / A–Z; search item text. Every field is already on the loaded objects (§4).
4. **By person** — collapsible per-person groups ("Angel · Partner · 18 things her coach can draw on"), each item
   compact: a **kind eyebrow** ("Memory · Values") + the item text + an inline `RelationshipScopePicker`.
5. **By category** — life-area grouping (Values · Work · Emotions · Intimacy…) with per-category counts + which
   relationship types reach each.
6. **Everything** — today's flat list, now under the filter/sort bar.
7. **Reflections** — the per-partner `RelationshipInsightsCard`s (the [`54`](54-memory-redesign.md) relationship
   synthesis about _you_), moved into their **own tab** so a _reflection_ no longer shares the _control_ scroll.
8. **Fold in the two omitted surfaces** so the dashboard is genuinely complete: **profile-field sharing**
   ([`15`](15-shareability.md)) and **dream-image sharing** ([`13`](13-dream-images.md)) appear as first-class
   shared items alongside facts + answers.
9. **Fix the warts:** a per-person dream share reads **"Shared with Sam"** (not "Private · reaching Sam"); the
   inert intake-fact twin row is dropped (the answer is the single control); Home's "Manage" → `/sharing`.

### 1.3 Whole-app fit

- **Reuse-first, boundary-preserving.** Every sharing mechanic, resolver, and the "shared ≠ shown" confidentiality
  rule of [`42`](42-relationship-scoped-sharing.md) is untouched. The work is renderer + a small additive core
  extension to `listOutboundSharing` / `OutboundSharingItem` (§4/§5). No `schemaVersion` bump; no change to what
  reaches whose coaching context.
- **Consistent with the app's patterns.** Tabbed dashboards mirror [`58`](58-together-couples-sessions.md) Together
  and [`08`](08-questionnaires.md) Questionnaires; stat tiles mirror [`44`](44-memory-dashboard-overhaul.md)
  `StatsSummary`; lucide icons + the calm palette per [`01`](01-design-system.md).
- **Honesty + safety unchanged.** The crisis footer + not-medical line stay ([`05`](05-conversations.md) §7);
  `restricted` facts never appear as outbound (they live in the "kept private" reassurance count); no copy implies
  an owner/admin can see anyone's data (the durable CLAUDE.md §1 rule); a partner's raw shared data is never shown.

## 2. Goals / Non-goals

**Goals**

- A **stats header** on `/sharing`: things-you-share (split by relationship type), people-reached (per-recipient
  chips + counts), kept-private (the reassurance count of `restricted`/sensitive facts never shared).
- **Tabs** — By person (default) · By category · Everything · Reflections — with a **filter / sort / search** bar
  (type · recipient · category · kind; recently-changed · recipient · A–Z; item-text search).
- **The one complete "reaches anyone" view** — fold **profile-field sharing** ([`15`](15-shareability.md)) and
  **dream-image sharing** ([`13`](13-dream-images.md)) into the dashboard alongside Insight facts + intake answers,
  **editable inline** (profile-field share/lock toggle; dream-image per-person unshare) via new **own-scoped**
  writes (so a member controls their own sharing without `people.manage`).
- **Per-category bulk actions** — "Make private" / "Share with partner" that **replace** the scope of every
  type-scoped item (facts + answers) in a category, via a bounded **`memory:setScopeBatch`** handler (profile
  fields + dream images excluded — different sharing models).
- **Move relationship reflections to their own tab** so a reflection no longer shares the control scroll.
- **Fix the three warts** — per-person dream share reads "Shared with <name>"; drop the inert intake-fact twin
  row; Home "Manage" → `/sharing`.
- **Additive, boundary-preserving core** — project `lifeArea` / `SharingCategory` onto `OutboundSharingItem`,
  extend the `kind` union with `profileField` / `dreamImage`, and (recommended) extend `listOutboundSharing` to
  read them. **No `schemaVersion` bump**, **no context-feed change**, reuse `memory:outboundSharing`.
- **Full responsive + a11y + visual-QA** ([`01`](01-design-system.md) §9, CLAUDE.md §12): ~360px→desktop, no
  horizontal scroll anywhere (incl. inner controls), content fills width (no `max-width` page cap), lucide icons
  only (never emoji/unicode).

**Non-goals (deferred / out of scope)**

- **Changing any sharing MECHANIC.** [`42`](42-relationship-scoped-sharing.md)'s `factSharedWithViewer` /
  `scopeGrants` / `summarizeForContext`, the confidentiality preamble, the `SHARING_PRESETS`, the relationship
  graph, and the `restricted` rule are all **unchanged**. This spec changes what's **shown + controlled where**,
  not what reaches whose context.
- **Redesigning `RelationshipInsightsCard`** — the reflection cards move to a tab as-is (their
  `relationships:synthesize`/`:getSynthesis` + metering + "shared ≠ shown" framing are unchanged,
  [`54`](54-memory-redesign.md)).
- **Adding relationship-type scoping to profile fields.** [`15`](15-shareability.md) profile fields share
  broadcast-to-all-related (a boolean lock via `privateFields`); adding type-scoping is a [`15`](15-shareability.md)
  §2 non-goal. This spec **surfaces** them with a share/lock affordance; it does not add a third scoping axis.
- **A household/Owner oversight view.** Sharing stays self-scoped for everyone
  ([`20`](20-memory-dashboard.md) §2 / [`44`](44-memory-dashboard-overhaul.md) §8) — a person sees only their
  **own** outbound sharing.
- **Changing the `LIFE_AREAS` taxonomy** ([`schemas.ts`](packages/core/src/schemas.ts)) or the `SharingCategory`
  presets ([`sharingPresets.ts`](packages/core/src/people/sharingPresets.ts)).
- **New AI features / spend.** The only AI call on the page remains `relationships:synthesize` (unchanged, in the
  Reflections tab). The stats + grouping + search are deterministic, no spend.
- **A "who can see me" / inbound view.** Everyone's sharing is per-owner and per-direction; the page shows only
  **outbound** sharing (what _you_ send), never "who can access you."

## 3. UX & flows

The redesigned **Sharing** page (`/sharing`, gated `memory.own`), responsive ~360px→desktop
([`01`](01-design-system.md) §9). The crisis footer + not-medical line are present (§8). Icons are **lucide only**
(§9). Wireframe reference: the approved interactive mockup (warm dashboard — stats header, four tabs, filter bar,
per-person + per-category groups, the folded-in surfaces).

### 3.1 Page shell + stats header

Top to bottom:

1. **Header** — "Sharing" + a one-line framing: _"Everything about you that helps the people you relate to —
   used to personalize their coaching, never shown to them directly."_ (the [`42`](42-relationship-scoped-sharing.md)
   §3.2 "shared ≠ shown" copy, reused).
2. **Stats header** — three stat tiles (stack to one column below `--bp-sm`, [`01`](01-design-system.md) §5.5):
   - **"N things you share"** — the total count of outbound items, with a small split **by relationship type**
     (Partner _k_ · Close family _j_ · Friends _i_ …), derived by summing each item's resolved types. Text +
     count, never colour-only.
   - **"M people reached"** — the distinct related people currently receiving anything, each an **`Avatar` + a
     count chip** ("Angel 18 · Mom 4"). Reuses the Home `SharingCard` tally (§5.4), lifted to a shared helper.
   - **"K kept private"** — the count of the person's **sensitive/`restricted`** facts that are **never** shared
     (a reassurance stat, a `Lock` icon): _"K sensitive things stay with you alone."_ This is a **count only** —
     never a list of the private items' text (they're the most sensitive content). Derived by counting
     `restricted` / flagged facts (the ones `listOutboundSharing` deliberately excludes, §4).
3. **Tabs** (§3.2) with the **filter/sort/search bar** (§3.3) directly under them.
4. **The active tab's content** (§3.4–§3.7).
5. **Crisis footer + not-medical line** (§8), always present.

**Empty state (nothing shared):** a warm "You're not sharing anything yet. When you choose to let a memory, an
onboarding answer, a profile detail, or a dream image inform someone you relate to, it shows up here — so you can
always see and change exactly what flows where." (extends the existing `SharingSection` empty copy). The stats
header shows zeros / hides; the "kept private" stat still shows if there are sensitive facts (reassurance).

### 3.2 Tabs

A `role="tablist"` with roving-tabindex (the [`08`](08-questionnaires.md) pattern), each carrying a light count:

- **By person** (default) — how much reaches each person.
- **By category** — what areas of your life you share.
- **Everything** — the flat list (today's view), filter/sort applied.
- **Reflections** — the per-partner relationship insights (a distinct concern, given its own home).

The tab strip **fits at 360px** (tighten padding/counts below `--bp-sm`; never an `overflow-x` scroll — CLAUDE.md
§12). The active tab is deep-linkable/reload-surviving (a `/sharing/:tab?` splat, the Together/Story pattern, §5.1)
so a Home/notification deep-link can land on "By person"; also mirrored to `useState` so it renders bare in RTL.

### 3.3 Filter / sort / search bar

A quiet toolbar (a full-width search input + full-width `Select`s so nothing scrolls-x at phone width — the
CLAUDE.md §12 "space-filling control, never a wrapping chip row" rule):

- **Search** — filters items by their text (`item.text`).
- **Filter** — by **relationship type** (any type present in the graph), **recipient** (a specific person),
  **category** (a life-area / sharing category), and **kind** (Memory · Onboarding answer · Profile · Dream image).
- **Sort** — **Recently updated** (default; **resolved:** by the source Insight's `updatedAt` for facts, and a
  stable best-available order for answers / profile fields / dream images — no new per-scope-change stamp, so no
  schema change), **By recipient** (A→Z of the primary recipient), **A–Z** (item text).

All fields are already on the loaded objects — no new read is needed for filtering/sorting (§4). The bar applies to
**By person**, **By category**, and **Everything** (it's hidden on **Reflections**, which has no per-item list).

### 3.4 By person (default tab)

Collapsible per-person groups, one per related person currently receiving anything:

- **Group header** — the person's `Avatar` + name + relationship-type chip(s) + a count: _"Angel · Partner · 18
  things her coach can draw on."_ A `Collapsible` ([`01`](01-design-system.md), the 62 primitive) — open by
  default, user-collapsible (never default-collapsed, so no items hide unreachably — CLAUDE.md §12 / §7).
- **Each item** (compact row): a **kind eyebrow** ("Memory · Values" / "Onboarding answer · Health" / "Profile" /
  "Dream image"), the **item text**, and an inline control:
  - `fact` / `intakeAnswer` → the `RelationshipScopePicker` (change scope / set Private) exactly as today.
  - `profileField` → a share/lock affordance (§3.8).
  - `dreamImage` → per-person share display + control (§3.8).
- An item that reaches several people appears under **each** of its recipient groups (the grouping is by recipient,
  so an item scoped to "Partner" with two partners shows under both) — editing its scope in one place updates it
  everywhere (the store reloads, §5.3).

### 3.5 By category

Grouped by **category** (life-area for facts, sharing-category for answers, a field-group for profile fields,
"Dreams" for dream images — §4 resolves a single display bucket):

- **Group header** — the category name + icon ([`44`](44-memory-dashboard-overhaul.md) `LIFE_AREA_ICON`) + a count
  - a compact "reaches: Partner, Friends" line (the union of the group's items' relationship types).
- Items render the same compact rows as By person, each with its inline scope control.
- **Per-category bulk actions** (v1) — in each group header, two buttons: **"Make private"** and **"Share with
  partner"**. They **REPLACE** the scope of every **type-scoped** item in the category — i.e. Insight facts
  ([`42`](42-relationship-scoped-sharing.md) `shareableTypes`) + intake answers (`answerSharing`) — in one call
  (**"Make private"** → `[]`; **"Share with partner"** → `['partner']`, replacing whatever was there, not adding).
  **Profile fields and dream images are NOT touched by the category bulk action** — they use different sharing
  models (spec 15's boolean `Person.privateFields` lock; per-person `Dream.image.shareableWith`), so they're
  managed individually per-item (§3.8), never scoped by relationship type. The category header states this
  ("Applies to memories & answers in this category"), so the bulk action is honest about its reach. Each bulk
  action shows a brief inline confirm (it's a batch scope change), then writes via the new `memory:setScopeBatch`
  handler (§6) and reloads the store, so every tab + the stats header update at once (§5.3).

### 3.6 Everything

The flat list — today's `SharingSection` cards — under the filter/sort bar. Each card keeps its kind eyebrow, text,
scope control, and the **fixed** recipient line (§3.9). This is the fallback for a person who wants the raw list.

### 3.7 Reflections

The per-partner `RelationshipInsightsCard`s (moved verbatim from the current `SharingAndRelationships` top section):
the framing line + the `relationship.synthesize` observation **about you** + generate/refresh/AI-off/EMPTY states.
The partner's raw shared data is **never** shown — only the synthesis about you ([`54`](54-memory-redesign.md) §3.3,
unchanged). Empty state when no partner exists (as today).

### 3.8 Folding in profile fields + dream images

The dashboard becomes complete by surfacing the two omitted surfaces as first-class items:

- **Profile fields** ([`15`](15-shareability.md)) — for the active person's own `Person` record, each **populated,
  non-locked** controllable field (occupation, gender, appearance, values, health notes, faith… — the
  `PERSON_FIELD_KEYS` minus `privateFields`) is a shared item reaching **all** related people. Kind eyebrow
  "Profile"; text "`<Field label>`: `<value>`"; scope reads **"Everyone you relate to"** (profile fields broadcast
  to all related — no type scoping, [`15`](15-shareability.md) §2). Inline control (**resolved**): a
  **share/lock toggle** (the spec-15 `ShareToggle` affordance) that flips the field in/out of `privateFields` so a
  person can lock a field **without leaving the page** (share → private and back). It writes through a new
  **own-scoped** path (§6) — a member editing **their own** profile-field sharing must not require `people.manage`,
  which the People-editor `people:*` upsert is gated on.
- **Dream images** ([`13`](13-dream-images.md)) — each of the active person's dreams whose image is shared
  (`Dream.image.shareableWith` non-empty) is an item, kind eyebrow "Dream image", text "Dream image · `<dream
title / date>`", per-person recipients. Inline control (**resolved**): **display the recipients with an inline
  unshare per person** (the per-person chip pattern → `dreams:setImageShare`), plus a **"Manage in Dreams"** link
  to **add** a recipient (adding a new share needs the dream context). So a person can revoke a dream-image share
  from here, and adds route back to Dreams.

Both fold in via **extending `listOutboundSharing`** (recommended, §4/§5.2) so the stats + tabs + filter treat them
uniformly. A dream **fact** shared per-person already flows as `kind: 'fact'` (that's the §3.9 wart, not a new
surface); a dream **image** is the new `dreamImage` kind.

### 3.9 The wart fixes

- **Per-person dream share label.** In the recipient line + scope chip, when an item is **not** broadcast and has
  **no** relationship types but **does** have per-person recipients (the `shareableWith` path — dream facts, dream
  images), describe it as **"Shared with Sam"** (the recipient names), never `describeScope([])` → "Private". The
  scope resolution becomes: broadcast → "Everyone you relate to"; types non-empty → `describeScope(types)`;
  else recipients non-empty → "Shared with `<names>`"; else "Private".
- **Drop the inert intake-fact twin.** An intake-derived Insight fact (`source: 'intake'`) whose scope is owned by
  its answer (recomputed on re-synthesis, so not independently editable — the [`44`](44-memory-dashboard-overhaul.md)
  audit) is **not emitted** as a separate outbound item; the editable `intakeAnswer` item is the single control.
  (Recommended: skip `source: 'intake'` facts in `listOutboundSharing`, §4, so the twin never reaches the renderer
  — cleaner than a renderer-side suppression.)
- **Home "Manage" → `/sharing`.** `SharingCard` navigates to `/sharing`, not `/memory` (§5.4).

## 4. Data model (vault files & schemas)

**No `schemaVersion` bump, no migration.** The persisted schemas ([`42`](42-relationship-scoped-sharing.md) §4:
`InsightFact.shareableTypes`, `IntakeSection.answerSharing`; [`15`](15-shareability.md): `Person.privateFields`;
[`13`](13-dream-images.md): `Dream.image.shareableWith`) are all unchanged. The only change is to the **crypto-free
view type `OutboundSharingItem`** (a projection, not persisted) in [`schemas.ts`](packages/core/src/schemas.ts) and
what `listOutboundSharing` fills.

### 4.1 `OutboundSharingItem` — additive projection fields + kind union

Extend the existing interface ([`schemas.ts`](packages/core/src/schemas.ts) — a plain TS view type, not Zod, so
this is purely additive and needs no version bump):

```ts
export interface OutboundSharingItem {
  id: string;
  // + 'profileField' | 'dreamImage' fold in the two omitted surfaces (§3.8). Renderers must handle the new
  //   kinds (a closed union → compile-checked switch).
  kind: 'fact' | 'intakeAnswer' | 'profileField' | 'dreamImage';
  text: string;
  broadcast: boolean;
  types: RelationshipType[];
  personIds: string[];
  recipients: { id: string; displayName: string }[];
  // NEW (additive, optional): a life-area for a fact (from InsightFact.lifeArea) — drives By-category grouping.
  lifeArea?: LifeArea;
  // NEW (additive, optional): the SharingCategory for an intake answer (from `questionCategory(section, q)`) —
  //   the By-category axis for answers. `sharingItemCategory(item)` (§5.2) resolves a single display bucket
  //   from lifeArea | category | kind so every kind groups uniformly.
  category?: SharingCategory;
}
```

- **`fact`** — `lifeArea` from `InsightFact.lifeArea` (already on the schema, normalized against `LIFE_AREAS`;
  absent ⇒ "Other").
- **`intakeAnswer`** — `category` from `questionCategory(sectionId, questionId)`
  ([`sharingCategory.ts`](packages/core/src/intake/sharingCategory.ts), pure).
- **`profileField`** — id `field:<PersonFieldKey>`; text "`<label>`: `<value>`"; `broadcast: false`, `types: []`,
  `personIds: []`, but **recipients = every related person** (profile fields go to all related, [`15`](15-shareability.md));
  category = a field→category display bucket (a small pure map; e.g. health→"Health & body", faith→"Faith",
  occupation→"Work & purpose"). The scope chip reads "Everyone you relate to" (§3.9's broadcast-like display, but
  driven by non-empty recipients rather than `broadcast:true`, since `privateFields` is a per-field lock, not a
  broadcast flag).
- **`dreamImage`** — id `dreamImage:<dreamId>`; text "Dream image · `<dream title/date>`"; `shareableWith` →
  `personIds` + resolved `recipients`; category = "Dreams" (or the dream's own life-area if we choose to carry it —
  a build detail).

### 4.2 The "kept private" count

The reassurance stat (§3.1) counts the person's **own** `restricted` (and, if we choose, flagged-inaccurate) facts
— exactly the ones `listOutboundSharing` **excludes** ([`outboundSharing.ts`](packages/core/src/people/outboundSharing.ts)
line ~59). Recommended: `listOutboundSharing` returns an additive **`keptPrivateCount: number`** on `OutboundSharing`
(a count only, never the private items' text) so the renderer needn't re-read insights. Additive to the
`OutboundSharing` view type (no persistence).

### 4.3 What `listOutboundSharing` reads (extended)

The core read ([`outboundSharing.ts`](packages/core/src/people/outboundSharing.ts)) is extended to assemble the
complete outbound picture (§5.2):

1. **Insight facts** — as today, but (a) **skip `source: 'intake'` facts** (the twin fix, §3.9), and (b) fill
   `lifeArea`. (An intake fact's scope is answer-owned; the `intakeAnswer` item is the control.)
2. **Intake answers** — as today, plus fill `category`.
3. **Profile fields** — the active person's own `Person`: each populated controllable field not in `privateFields`
   → a `profileField` item reaching all related people.
4. **Dream images** — each of the person's dreams with a non-empty `Dream.image.shareableWith` → a `dreamImage`
   item.

### 4.4 Writes touch only existing persisted fields (no new schema)

The two new write handlers (§6) persist **existing** shapes — no new schema, no `schemaVersion` bump:

- **`memory:setScopeBatch`** writes `InsightFact.shareableTypes` (per fact) + `IntakeSection.answerSharing` (per
  answer) — the exact fields the per-item `RelationshipScopePicker` already writes, applied to a set of targets in
  one call.
- **`memory:setProfileFieldShared`** writes the active person's own `Person.privateFields` array
  ([`15`](15-shareability.md) §4.1) — the same lock-set the People editor writes.

**Ownership** — all reads/writes via the vault/crypto service ([`00`](00-architecture.md) §3); every read + write is
own-scoped + per-person-isolated (the bridge gates it, §6). No direct `fs`.

## 5. Architecture & modules

Primarily **renderer**, plus a small additive **core** extension. Build in a git worktree
([`57`](57-memory-overview-redesign.md) §5.5 precedent) — the page touches shared renderer files.

### 5.1 Renderer (`routes/sharing`)

- **`SharingAndRelationships.tsx`** rebuilt into the §3 dashboard: header + the stats header + the tab strip
  (`/sharing/:tab?` splat mirrored to `useState`) + the filter/sort/search bar + the active tab. The current top
  "Relationship reflections" section becomes the **Reflections** tab; `SharingSection`'s flat list becomes the
  **Everything** tab; **By person** / **By category** are new views over the same loaded `outbound.items`.
- **New route-local components:** `SharingStatsHeader` (three stat tiles, reusing `Avatar`), `SharingFilterBar`
  (search + type/recipient/category/kind `Select`s + sort `Select`), `SharingByPerson` (per-recipient `Collapsible`
  groups), `SharingByCategory` (per-category groups), and a shared `SharingItemRow` (kind eyebrow + text + the
  kind-appropriate inline control — `RelationshipScopePicker` / `ShareToggle` / dream-image control). `SharingSection`
  is refactored to render the `SharingItemRow` list (Everything).
- **No new design-system primitive** — reuses `Collapsible` ([`01`](01-design-system.md)), `Avatar`,
  `RelationshipScopePicker` ([`42`](42-relationship-scoped-sharing.md)), `FactSharingControl`, `ShareToggle`
  ([`15`](15-shareability.md)), `Select`, `Card`, `Markdown`, `Tabs`-style tablist. So **no `/gallery` change** (and
  the `/gallery` route is gone anyway, [`01`](01-design-system.md) §12 changelog).
- **Pure helpers** (route-local or `@selfos/core`, unit-tested): `summarizeSharingStats(outbound)` (things-you-share
  split by type + people-reached tally + kept-private count), `sharingItemCategory(item)` (resolve a single display
  bucket from `lifeArea` | `category` | `kind`), `groupByPerson(items)` / `groupByCategory(items)`,
  `filterAndSortItems(items, filters, sort)`, and `describeSharingScope(item)` (the §3.9 broadcast/types/recipients/
  Private resolution).
- **Store** — reuse `insightStore` (`outbound`, `load`, `setFactScope`, `setAnswerScope`); add a
  **`setScopeBatch`** action (the per-category bulk, → `memory:setScopeBatch`) and a **`setProfileFieldShared`**
  action (the inline profile lock, → `memory:setProfileFieldShared`); the dream-image inline unshare routes through
  `dreams:setImageShare`. Each reloads `outbound` after so the stats + every tab stay in sync. Loaded per-person;
  reset on `activePerson.id` change (already wired).

### 5.2 Core (`@selfos/core/people/outboundSharing.ts`)

- Extend `listOutboundSharing` per §4.3: skip `source: 'intake'` facts, fill `lifeArea` / `category`, and assemble
  the **profileField** + **dreamImage** items (reading the active person's `Person` + their dreams' `image.shareableWith`).
  Keep it a thin assembler; the resolver/graph traversal (`listRelatedPeople`, `relationshipTypesFromSubjectToViewer`)
  is unchanged.
- Return `keptPrivateCount` on `OutboundSharing` (§4.2).
- `sharingItemCategory` — a pure display-bucket resolver, exported for the renderer + tests.
- **Boundary preserved** — the read still emits only the person's **own** items (own data → full text), never
  another person's; `restricted`/flagged facts are still excluded from `items` (they feed only the private count).
- **New core service `applyScopeBatch`** — backs `memory:setScopeBatch` (§6): given the active person, a `types`
  scope, and the fact + answer targets, it applies the scope to each (facts through the `updateInsight`
  merge-by-id path so sibling facts are preserved; answers through `setIntakeAnswerSharing`), bounded + pure of any
  cross-person write. Reused by the bridge; unit-tested (§10). The profile-field write reuses the existing
  `Person.privateFields` upsert logic behind the new own-scoped `memory:setProfileFieldShared` bridge op.

### 5.3 Editing semantics (unchanged mechanics)

- **Facts / intake answers** — `RelationshipScopePicker` → `insights:update` (`shareableTypes`) /
  `intake:setAnswerSharing`, via the existing `insightStore.setFactScope` / `setAnswerScope`
  ([`44`](44-memory-dashboard-overhaul.md) §6). `updateInsight` **replaces** the facts array, so a scope edit sends
  every fact (the store already does this — [`insightStore.ts`](apps/desktop/src/renderer/src/stores/insightStore.ts)
  §setFactScope). After any edit the store reloads, so the stats + all tabs stay in sync.
- **Per-category bulk** — the "Make private" / "Share with partner" buttons call `memory:setScopeBatch` with the
  category's fact + answer targets (§6); the scope **replaces** each target's; profile fields + dream images are
  excluded (§3.5).
- **Profile fields** — the inline lock toggle writes the active person's own `Person.privateFields` via the new
  **own-scoped** `memory:setProfileFieldShared` (§6) — **not** the `people.manage`-gated People upsert, so a member
  can control their own profile-field sharing here.
- **Dream images** — inline per-person unshare via `dreams:setImageShare` ([`13`](13-dream-images.md) §3.6),
  `dreams.shareContext`-gated, dreamer-scoped; adding a share routes to Dreams.

### 5.4 Cross-surface touch-ups

- **Home `SharingCard`** — the "Manage" button navigates **`/sharing`** (not `/memory`). Lift its per-recipient
  tally into the shared `summarizeSharingStats` so Home + the stats header can't drift.
- **Notifications / deep-links** — any consumer that meant "manage sharing" lands on `/sharing` (or `/sharing/by-person`).

## 6. IPC / API contracts

**Reuse the existing channels; the only change is the additive shape of `memory:outboundSharing`'s result.**

- **`memory:outboundSharing`** ([`42`](42-relationship-scoped-sharing.md) §6) — own-scoped, gated `memory.own`,
  active-person-scoped (unchanged gate). Its `OutboundSharing` result gains the additive `lifeArea`/`category` per
  item, the `profileField`/`dreamImage` kinds, and `keptPrivateCount` (§4). No new channel.
- **`insights:update`** — carries `shareableTypes` on facts (the scope edit), unchanged
  ([`44`](44-memory-dashboard-overhaul.md) §6).
- **`intake:setAnswerSharing`** — one intake answer's scope, gated **`intake.own`**, active-person-scoped, unchanged
  ([`44`](44-memory-dashboard-overhaul.md) §6). **The gating mismatch (documented + resolved):** the page's reads
  are gated `memory.own`, but intake-answer scope **writes** need `intake.own`. **A default Member holds both**
  ([`04`](04-people-roles.md)), so the common case is fine; but a person with `memory.own` and not `intake.own` (a
  custom role) could **read** the intake rows but not **edit** them — the picker degrades gracefully (a read-only
  chip + a hint), never a dead control (§7). **Profile-field writes get their own `memory.own`-gated,
  own-scoped path** (`memory:setProfileFieldShared`, below) — deliberately **not** the `people.manage`-gated
  People upsert — so a member can control their own profile-field sharing here.
- **`dreams:setImageShare` / `dreams:listSharedImages`** — [`13`](13-dream-images.md) §3.6, `dreams.shareContext`,
  dreamer-scoped, unchanged. Powers the §3.8 dream-image inline **unshare**. (Reading `Dream.image.shareableWith`
  for the dashboard rides the extended `memory:outboundSharing` read, host-side, so no new renderer channel is
  needed to _list_ shared images; adding a new share still routes to Dreams.)
- **`memory:setScopeBatch`** (**new**, included in v1) — the per-category bulk action (§3.5). Request:

  ```ts
  {
    // The relationship-type scope to apply, REPLACING each target's current scope (empty ⇒ Private).
    types: RelationshipType[];
    factTargets: { insightId: string; factId: string }[];      // Insight facts (shareableTypes)
    answerTargets: { sectionId: string; questionId: string }[]; // intake answers (answerSharing)
  }
  ```

  Applies `types` to every target in one call — facts via the `insights:update` merge-by-id path
  ([`44`](44-memory-dashboard-overhaul.md) §6; the handler reads each insight, sets the target fact's
  `shareableTypes`, preserves the other facts) and answers via `setIntakeAnswerSharing`. **Gated `memory.own`
  for the fact writes AND `intake.own` for the answer writes** (a caller lacking `intake.own` has its
  `answerTargets` skipped, never errors — the graceful degrade, §7), active-person-scoped in the bridge (a person
  can only rescope their **own** items — the trust boundary). **Bounded** (a caller can't rescope thousands at
  once; a sane per-call cap). It touches **only** facts + answers — **never** profile fields or dream images
  (their models differ, §3.5). Returns the updated count so the store can reload.

- **`memory:setProfileFieldShared`** (**new**, included in v1, **own-scoped**) — the §3.8 profile-field lock
  toggle. Request `{ field: PersonFieldKey; shared: boolean }`; flips the field in/out of the **active person's
  own** `Person.privateFields`. Gated **`memory.own`** (own data) + active-person-scoped — deliberately **not**
  `people.manage`, so a member can lock/share **their own** profile field without the admin capability the
  People-editor `people:*` upsert requires. (Writes the same `privateFields` array [`15`](15-shareability.md) §4.1
  uses, via the vault/crypto service; the trust boundary is the bridge.)
- **Claude** — the only AI call remains `relationships:synthesize`/`:getSynthesis` (unchanged, in the Reflections
  tab; bounded JSON, `extendedThinking: false`, meter-before-parse — [`37`](37-ai-output-robustness.md)). The stats /
  grouping / filter are deterministic (no call). The key stays in main ([`00`](00-architecture.md) §6.2).

## 7. States & edge cases

Per [`00`](00-architecture.md) §7 — every surface handles loading / empty / error / offline.

- **Nothing shared** → the warm empty state (§3.1); stats show zeros / hide; the "kept private" stat still shows if
  there are sensitive facts (reassurance). Tabs render their empty variants.
- **Sharing many things (the common case, backfilled)** → the stats header + tabs + filter/sort **make the long list
  scannable** — the whole point. Long groups lazy-render; the filter narrows; no horizontal scroll at any width.
- **An item reaching several people** → appears under each recipient group (By person) and once under its category
  (By category); editing its scope reloads the store, so it updates in every view (§5.3).
- **Per-person dream share ("Shared with Sam")** → the §3.9 label fix; a decrypt/RTL guard asserts the chip never
  reads "Private" when a recipient exists.
- **Intake fact twin** → not emitted (§3.9/§4.3); only the editable `intakeAnswer` row appears. A test asserts an
  intake answer produces exactly one editable row (no read-only twin).
- **Profile field folded in** → a populated, non-locked field shows as a "Profile" item reaching all related people;
  locking it (or the field being emptied) removes it from the dashboard on reload. A field with no related people
  shows "no one in your circle yet" (like other items).
- **Dream image folded in** → a shared image shows its recipients; unsharing the last recipient removes the item.
- **`memory.own` without `intake.own`** (custom role) → the intake-answer rows render **read-only** (a scope chip +
  a hint that onboarding sharing is managed in onboarding), never a picker that errors. Facts stay editable, and a
  per-category **bulk action** still applies to the category's **facts** while **skipping** its answer targets (the
  batch handler drops `answerTargets` for a caller lacking `intake.own`, §6 — never an error).
- **Per-category bulk ("Make private" / "Share with partner")** → **replaces** the scope of every fact + answer in
  the category in one `memory:setScopeBatch` call; the inline confirm prevents an accidental mass change; **profile
  fields + dream images in the category are untouched** (§3.5) — the header states the bulk action's reach so it's
  honest. After it runs, the store reloads and the stats + all tabs reflect the change.
- **Profile-field lock toggle (own-scoped)** → a member can lock/share **their own** profile field from here
  without `people.manage`; locking removes it from the dashboard on reload; the write never touches another
  person's `Person`.
- **AI off / no key / over budget** → the **entire dashboard renders** (stats + all four tabs + folds are local
  data, no AI). Only the **Reflections** tab's synthesis card needs AI and shows its calm connect/EMPTY state there
  ([`54`](54-memory-redesign.md)).
- **Per-person switch** → `insightStore` resets (own outbound reloads); the page resets to the default tab;
  per-person isolation holds ([`20`](20-memory-dashboard.md) §5.1).
- **`restricted` / sensitive facts** → **never** appear as outbound items (only in the "kept private" count); the
  data gating is unchanged (§8). A sensitive fact the owner deliberately un-restricts + type-scopes
  ([`42`](42-relationship-scoped-sharing.md) §8 two-step, done in Memory) then appears as a normal outbound item.
- **Corrupt scope / fact** → fails closed to own-only ([`42`](42-relationship-scoped-sharing.md) §7,
  `.catch(undefined)`); a corrupt item is skipped, never silently broadcast, never crashes the view.
- **Sync conflict / corrupt file / large graph** → standard vault behaviour ([`00`](00-architecture.md) §4.3);
  per-person line/read budgets keep it bounded ([`42`](42-relationship-scoped-sharing.md) §5.2).
- **Deep-link to a tab** → `/sharing/by-person` (etc.) lands on that tab (splat mirrored to state, §3.2); a bare
  `/sharing` opens **By person**.
- **Migration** → none (no schema change). A pre-68 vault renders in the new dashboard immediately; existing shared
  items appear grouped; the folded-in profile/dream surfaces appear the first time the page loads.

## 8. Safety, privacy & honesty

Sharing **is** the privacy surface (CLAUDE.md §1; [`42`](42-relationship-scoped-sharing.md) §8;
[`44`](44-memory-dashboard-overhaul.md) §8). Nothing here weakens it:

- **"Shared ≠ shown" is unchanged.** The [`42`](42-relationship-scoped-sharing.md) §3.4 confidentiality preamble
  still governs every cross-shared line: a recipient's coach **uses but never quotes, attributes, or reveals**
  shared content. This page controls **what** flows, never how it's disclosed (it never is).
- **`restricted` (trauma/intimacy break-glass) facts are NEVER outbound.** They are excluded from `items` (as today,
  [`outboundSharing.ts`](packages/core/src/people/outboundSharing.ts)) and surface only as the **"kept private"
  count** — a reassurance number, **never** a list of the private items' text. Sharing intimacy with a partner still
  requires the deliberate un-restrict + type-scope two-step in Memory ([`42`](42-relationship-scoped-sharing.md) §8),
  not this page.
- **No raw display of another person's shared data.** The **Reflections** tab shows only the AI synthesis **about
  you**, never a partner's raw answers ([`54`](54-memory-redesign.md) §8). The dashboard shows only the **active
  person's own** outbound items (own data → full text is theirs to see); it never renders anyone else's sharing.
- **No surveillance framing.** No copy implies an owner/admin can see anyone's content (the durable CLAUDE.md §1
  rule). The page is strictly "what **you** send," never "who can see you."
- **Honest labels.** The wart fix (§3.9) removes a lie ("Private · reaching Sam"); the "kept private" stat is honest
  reassurance, not a teaser. The kind eyebrows + scope chips make every flow legible + controllable — the whole
  point of a transparency surface.
- **Not-medical / crisis** ([`05`](05-conversations.md) §7) — the crisis footer + not-medical line are present;
  nothing here is clinical.

## 9. Accessibility

Per [`01`](01-design-system.md) §9 + CLAUDE.md §12:

- **Tabs** — `role="tablist"` / `role="tab"` with `aria-selected`, roving-tabindex, visible focus; the tab strip
  **fits at 360px** (no `overflow-x` scroll — §12).
- **Stat tiles** — the counts + type splits + kept-private count are **text**, never colour-only; the people-reached
  `Avatar`s carry accessible names (initials + name).
- **Per-person / per-category groups** — `Collapsible` header buttons with `aria-expanded`; **open by default** so
  no items hide unreachably (CLAUDE.md §12); the full surface renders to the bottom (§7 DoD guard).
- **Inline controls** — `RelationshipScopePicker` ([`42`](42-relationship-scoped-sharing.md) §9: state + meaning in
  text, `flex: none`, non-clipped popover), `ShareToggle` ([`15`](15-shareability.md) §9: state as text),
  dream-image per-person chips (`aria-pressed`) — all reused, all keyboard-operable.
- **Filter/sort bar** — labelled `Select`s + a labelled search input; full-width space-filling controls (never a
  wrapping chip row, §12).
- **Icons** — lucide only, all decorative icons `aria-hidden`, every icon-only control has an `aria-label`
  (never emoji/unicode — the durable rule).
- **Responsive ~360px→desktop, no horizontal scrollbars** (incl. inner controls, tested at the real container
  widths); the top-level page container **fills width** (no `max-width` cap — CLAUDE.md §12); stat tiles + groups
  reflow to one column; reduced-motion respected.

## 10. Testing strategy

Per the DoD (CLAUDE.md §7). Decrypt the vault to assert data; run `pnpm typecheck` after tests
(`vitest-does-not-typecheck`).

- **Unit (core, pure):** `summarizeSharingStats` (things-you-share split by type; people-reached tally;
  kept-private count from `restricted`/flagged facts); `sharingItemCategory` (fact→lifeArea, answer→category,
  profileField→field bucket, dreamImage→"Dreams"); `filterAndSortItems` (each filter axis + each sort, incl.
  "Recently updated" by Insight `updatedAt`); the extended `listOutboundSharing` — **skips `source: 'intake'`
  facts** (no twin), fills `lifeArea`/`category`, emits `profileField` items for non-locked populated fields
  reaching all related people, emits `dreamImage` items for shared dream images, returns `keptPrivateCount`;
  `describeSharingScope` (broadcast → "Everyone"; types → `describeScope`; recipients-only → "Shared with
  <names>", **never** "Private"; empty → "Private"); **`applyScopeBatch`** — replaces the scope on every fact +
  answer target (facts preserve sibling facts via merge-by-id; empty `types` ⇒ Private), touches **only** the
  given targets, and **skips answer targets when the caller lacks `intake.own`**.
- **Bridge (integration):** `memory:setScopeBatch` is own-scoped (a caller can't rescope another person's items)
  and gated `memory.own` (+ `intake.own` for answers — a `memory.own`-only caller's answer targets are skipped,
  facts applied); `memory:setProfileFieldShared` is **own-scoped + `memory.own`** (a member can flip their own
  `privateFields` **without** `people.manage`; it cannot touch another person's `Person`). Decrypt to assert the
  persisted `shareableTypes` / `answerSharing` / `privateFields`.
- **Component (RTL):** the stats header renders the three tiles from a seeded `outbound`; the tab strip switches By
  person / By category / Everything / Reflections; **By person** groups by recipient with counts + collapsibles;
  **By category** groups by category; the filter/sort/search narrow + reorder the list; a **per-person dream share
  reads "Shared with Sam"** (the wart fix); an **intake answer produces exactly one editable row** (no inert twin);
  a **profile field renders with a share/lock affordance**; a **dream image renders with its recipients**; the
  `RelationshipScopePicker` edit calls `insights:update` / `intake:setAnswerSharing`; **By category** shows the
  per-group **"Make private" / "Share with partner"** bulk buttons, which (after the inline confirm) call
  `memory:setScopeBatch` with the category's fact + answer targets and **not** its profile/dream items; the
  **profile-field lock toggle** calls `memory:setProfileFieldShared`; the `memory.own`-without-`intake.own` case
  renders intake rows read-only (no dead picker); the Reflections tab renders the relationship card + its AI-off
  state.
- **E2E (Playwright) — the flow + the headline privacy guard:** seed a person with facts across several life areas
  (one shared to `partner`, one `restricted`), a shared intake answer, a shared profile field, and a per-person-
  shared dream image; relate A↔B (partner) and A↔C (sibling). Open `/sharing` as A → the stats header shows the
  right totals + type split + kept-private count → **By person** shows the partner group with the partner-scoped
  items and the sibling group without them → scope a fact to a new type and **decrypt** that it reaches the right
  person → the `restricted` fact is **absent** from every tab (only in the kept-private count) → the dream-share
  chip reads "Shared with <name>" → the intake answer shows one editable row → in **By category**, "Share with
  partner" on a category **replaces** its facts' + answers' scope (decrypt to confirm) while leaving its profile
  field + dream image untouched → the inline profile-field lock removes it from the dashboard (decrypt the
  `privateFields`) → the dream-image inline unshare revokes a recipient (decrypt `shareableWith`). **No-horizontal-overflow /
  inner-scrollbar guard at ~360px** on every tab; **full-surface-renders-to-the-bottom** (no default-collapsed group
  hides items). **Cross-surface:** Home's "Manage" navigates to `/sharing`. Visual QA at desktop + 360px (stats
  header, each tab, the folded-in surfaces — each reads clean + intentional, matching the approved mockup; lucide
  icons, no emoji).
- Vault + Claude mocked as established (`memFileSystem`, `SELFOS_FAKE_CLAUDE`); decrypt to assert data, not just UI.

## 11. Open questions

**All resolved with the owner (2026-08-06) — spec Approved.** The decisions are folded into the sections noted:

1. **Per-category bulk actions → INCLUDED in v1** (§3.5/§4.4/§5/§6/§7/§10). Each **By category** group gets
   **"Make private"** and **"Share with partner"** buttons that **REPLACE** the scope of every **type-scoped** item
   in the category — **Insight facts + intake answers only**. **Profile fields** (spec 15 boolean `privateFields`)
   and **dream images** (per-person `shareableWith`) use different sharing models and are **handled individually**,
   never by the category bulk action (the header states this). Backed by a new bounded **`memory:setScopeBatch`**
   handler + `applyScopeBatch` core service, gated `memory.own` (+ `intake.own` for answer writes),
   active-person-scoped.
2. **Profile fields → editable INLINE** via a share/lock toggle (§3.8/§5.3/§6), through a new **own-scoped**
   `memory:setProfileFieldShared` write so a member can control **their own** profile-field sharing **without**
   `people.manage` (which the People-editor upsert requires).
3. **Dream images → display + INLINE per-person unshare** (`dreams:setImageShare`) + a **"Manage in Dreams"**
   link-out for adding new shares (§3.8/§5.3).
4. **"Kept private" stat → count only** (§3.1/§4.2/§8) — a reassurance number, **never** a list of the private
   items' text.
5. **Tabs → deep-linkable `/sharing/:tab?`** (§3.2), the [`58`](58-together-couples-sessions.md)/[`08`](08-questionnaires.md)
   splat pattern (mirrored to `useState` for RTL), so Home/notification deep-links land on a tab.
6. **Sort "Recently updated" → Insight `updatedAt`** for facts + a stable best-available order for
   answers/profile/dream (§3.3) — **no schema change** (no new per-scope-change stamp).

## 12. Changelog

- 2026-08-07 — **Slice 1b BUILT — spec 68 is now FULLY BUILT.** `/sharing` rebuilt into the unified
  transparency dashboard: a stats header (things-you-share by type · people-reached · kept-private), four tabs
  (**By person** / **By category** / **Everything** / **Reflections**) on a `sharing/*` splat (deep-linkable +
  reload-surviving, mirrored to `useState` for RTL), and a full-width filter/sort/search bar. Folds in the two
  omitted surfaces — **profile-field sharing** (a `ShareToggle` → `memory:setProfileFieldShared`) and
  **dream-image sharing** (per-recipient unshare → `dreams:setImageShare` + a "Manage in Dreams" link). Per-category
  **bulk actions** ("Make private" / "Share with partner" → `memory:setScopeBatch`, an inline confirm; facts +
  answers only, profile/dream untouched; hidden when there's no applicable target for the caller's role).
  Reflections moved to its own tab. The three warts fixed: a per-person dream share reads **"Shared with <name>"**
  (never "Private · reaching X"); the inert intake-fact twin is gone (the 1a read skips `source:'intake'` facts);
  Home's "Manage" + the nav go to `/sharing` (nav aria-label "Sharing & relationships" → "Sharing"). New
  route-local components (`SharingStatsHeader`/`SharingFilterBar`/`SharingByPerson`/`SharingByCategory`/
  `SharingItemRow`) + pure helpers (`summarizeSharingStats`/`describeSharingScope`/`groupByPerson`/
  `groupByCategory`/`filterAndSortItems`/`resolveSharingTab`); the old `SharingSection` deleted.
  `sharingItemCategory` relocated from the crypto-heavy `people/outboundSharing.ts` to the crypto-free
  `@selfos/core/sharing` (re-exported for 1a) so the renderer can import it. No new design-system primitive.
  Gate green: typecheck/lint/format, 1785 core + 1501 desktop unit (+sharingDashboard pure helpers +8 dashboard
  RTL), a decrypt-level Playwright E2E (stats + tabs + folded-in surfaces + bulk-replace/lock/unshare all
  decrypt-asserted + restricted-absent + 360px overflow guard on every tab + Home Manage → /sharing) + the 3
  updated existing sharing E2E; visual QA at desktop + 360px matching the approved mockup. Code-reviewer **ship**
  (dead `isCloseFamily` removed; the privacy/honesty core verified airtight).
- 2026-08-07 — **Slice 1a BUILT** (core + bridge; the additive, no-migration extension — no renderer UI yet).
  `OutboundSharingItem` gains `'profileField' | 'dreamImage'` kinds + optional `lifeArea`/`category`;
  `OutboundSharing` gains `keptPrivateCount`. `listOutboundSharing` now skips `source: 'intake'` facts (the
  twin fix), fills `lifeArea`/`category`, emits profile-field items (each populated non-locked controllable
  field, reaching all related people) + dream-image items (standard-tier, `image.shareableWith` non-empty),
  and returns `keptPrivateCount` (all `restricted` facts across every insight, intake included). New pure
  `sharingItemCategory` + `profileFieldSharing.ts` helpers; new core `applyScopeBatch`; new bounded
  own-scoped bridge handlers `memory:setScopeBatch` (gated `memory.own`, `intake.own` for answers) +
  `memory:setProfileFieldShared` (gated `memory.own`, NOT `people.manage`). Reuses `memory:outboundSharing`.
  Slice 1b (the dashboard UI) follows.
- 2026-08-06 — reviewed with the owner; per-category bulk actions included in v1, remaining open questions
  resolved; Approved.
- 2026-08-06 — created (Draft). A **complete redesign** of `/sharing` into a unified transparency dashboard —
  stats header ("N things you share · M people reached · K kept private"), **By person / By category / Everything /
  Reflections** tabs, a filter/sort/search bar — that folds in the two omitted surfaces (**profile-field sharing**
  [`15`](15-shareability.md) + **dream-image sharing** [`13`](13-dream-images.md)) so it's the one complete "what
  reaches anyone" view, moves the relationship reflections to their own tab, and fixes three warts (per-person dream
  share reads "Shared with Sam" not "Private · reaching Sam"; the inert intake-fact twin row is dropped; Home
  "Manage" → `/sharing`). Additive core: project `lifeArea`/`SharingCategory` + `profileField`/`dreamImage` kinds +
  `keptPrivateCount` onto the `OutboundSharing` view type, extend `listOutboundSharing` — **no `schemaVersion` bump,
  no context-feed change, no new AI spend**; reuses `memory:outboundSharing`. Supersedes
  [`57`](57-memory-overview-redesign.md) §3.8 + §5.3; extends [`44`](44-memory-dashboard-overhaul.md) §3.5 /
  [`42`](42-relationship-scoped-sharing.md) §5.3. An interactive mockup was approved. Open questions (§11): inline
  vs link-out editing for profile fields (+ the own-scoped write capability) and dream images, the per-category bulk
  action semantics + a possible `memory:setScopeBatch`, the "kept private" stat depth, deep-linkable tabs, and the
  "recently changed" sort's data source.
