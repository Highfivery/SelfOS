# 49 — Intimacy activities inventory (categorized, tiered expansion)

> **Status:** Built — _last updated 2026-06-25_
>
> The shared consensual-adult intimacy inventory `INTIMACY_ACTIVITIES` is a **flat ~30-string list**
> (`packages/core/src/intimacy/topics.ts`) read by the onboarding intimacy matrix, questionnaire
> generation, and the kink-inventory test ([`50`](50-self-assessments.md)). This spec
> **greatly expands and restructures** it into a **categorized, tiered inventory** (~60–100 activities
> across ~14 categories, each entry carrying a stable `key`, a display `label`, a `category`, and an
> intensity `tier` from gentle→extreme), spanning slow/sensual through extreme/hardcore/kinky/explicit
> — within the unchanged consensual-adult boundary. It is a **foundational shared-content change**: the
> tiered categories become the kink test's subscales, the onboarding matrix groups by category in the
> tier ordering sensual→extreme, and questionnaire generation can seed from categories.

Builds on [`46`](46-intimacy-matrix-accuracy.md) (the stable-key `MatrixRow` model + the anatomy-driven
resolver — this spec **adopts and extends** it), [`27`](27-intimacy-redesign.md) §4.2/§5 (the 5-point
labelled activity matrix), [`18`](18-personal-onboarding.md) §14.5/§14.8/§14.10/§14.11 (the 18+/
`restricted`/owner-visible intimacy block + safety rails), and [`08`](08-questionnaires.md) §16.5/§16.5a
(the shared owner-extensible `INTIMACY_TOPICS` inventory read by questionnaire generation). Coordinates
with [`50`](50-self-assessments.md) (the kink test, which consumes the categories as subscales) and
the concurrent questionnaire work (§11.1). References [`00`](00-architecture.md)/[`01`](01-design-system.md).
This is a **foundational/content spec** — much of it is developer-facing data structure (§4/§5) rather
than new UI.

---

## 1. Overview

`INTIMACY_ACTIVITIES` is the single source of truth for the consensual-adult acts/preferences SelfOS
knows about. Today it is a **flat list of ~30 strings** (`packages/core/src/intimacy/topics.ts`):

```ts
export const INTIMACY_ACTIVITIES: readonly string[] = [
  'Oral (giving)',
  'Oral (receiving)',
  'Deepthroat',
  'Anal (giving)',
  'Anal (receiving)',
  'Rimming (giving)',
  'Rimming (receiving)',
  'Fingering',
  'Butt plugs / anal toys',
  'Vibrators / dildos',
  'Bondage',
  'Blindfolds',
  'Spanking (giving)',
  'Spanking (receiving)',
  'Choking (giving)',
  'Choking (receiving)',
  'Hair-pulling',
  'Biting',
  'BDSM / dom-sub play',
  'Role-play',
  'Dirty talk',
  'Sexting',
  'Face-sitting',
  'Squirting',
  'Threesomes',
  'Group sex / orgies',
  'Swinging',
  'Public / semi-public sex',
  'Exhibitionism',
  'Voyeurism',
];
```

Three problems make this list too small and too flat for what we now build on top of it:

1. **It is read by three surfaces, and each wants more structure than a flat list gives.**
   - The **onboarding intimacy matrix** ([`27`](27-intimacy-redesign.md) §4.2) renders every entry as one
     long, ungrouped 5-point matrix. The intake catalog wires it directly:
     `matrix: { rows: resolveIntakeActivityRows(), … }` (`packages/core/src/intake/intakeCatalog.ts`),
     and `resolveIntakeActivityRows` (`packages/core/src/intimacy/activityRows.ts`) maps each flat string
     to a `MatrixRow` (`{ key, label }`). A flat list has no natural grouping, so a longer list reads as an
     undifferentiated wall.
   - **Questionnaire generation** ([`08`](08-questionnaires.md) §16.5) seeds the model with this inventory
     as an avoid-/seed list. With no categories it can't be asked to "draft from the bondage & restraint
     family" or balance across intensities.
   - The **kink-inventory test** ([`50`](50-self-assessments.md)) wants the categories **as subscales**
     (sensual, oral, power exchange, impact, …) and the tiers to **order** items gentle→extreme. A flat
     list gives it neither, so 50 cannot exist as specced without this.

2. **It is small and skewed.** ~30 items is a thin sample of the consensual-adult landscape — heavy on a
   few BDSM and group/exhibition items, light on sensual/sensory, dirty-talk/verbal nuance, roleplay
   variety, sensation play, edge play, and the slow end of the spectrum. People who want gentle/sensual
   coaching, and people who want the genuinely extreme end, both find the list under-serves them.

3. **There is no notion of intensity.** "Sensual massage" and "edge play" sit in one undifferentiated
   bag. The kink test, the matrix ordering (sensual→extreme), and any future "ease in gently vs. go hard"
   coaching all need a tier axis the list doesn't carry.

The fix: **restructure the inventory into categorized, tiered entries** and **expand it** to ~60–100
acts across ~14 categories spanning slow/sensual→extreme/hardcore/kinky/explicit, **keeping it a
render/synthesis-layer concept** (never mutated per-person, per [`46`](46-intimacy-matrix-accuracy.md))
and **building on 46's stable-key `MatrixRow` model** so each entry already has a stable `key` + a display
`label` and existing ratings carry forward with no data loss.

This is **foundational** — it is read by the matrix, by questionnaire generation, by the kink test
([`50`](50-self-assessments.md)), and (in scope as future consumers) by intimacy guided sessions and
challenges (see the "whole-app fit" note in §11). Doing it early, before [`50`](50-self-assessments.md),
means those consumers inherit the structure rather than re-deriving it.

## 2. Goals / Non-goals

**Goals**

- **Restructure** `INTIMACY_ACTIVITIES` from a flat `readonly string[]` into a **categorized, tiered
  inventory** of `IntimacyActivity` entries — `{ key, label, category, tier }` — proposed **~14 categories**
  (§4.1), each entry on an intensity **tier** (gentle→extreme).
- **Greatly expand** the inventory to **~60–100 activities** across the categories, spanning slow/sensual →
  extreme/hardcore/kinky/explicit, within the unchanged consensual-adult boundary.
- **Adopt and extend [`46`](46-intimacy-matrix-accuracy.md)'s stable-key model.** Every entry's `key` is the
  stable matrix-row key (anatomy-independent); the resolver in `activityRows.ts` consumes the categorized
  inventory and still tailors **only** the oral rows by anatomy. Existing ratings (label-keyed or 46
  stable-keyed) carry forward read-time with **no data loss** (extend `migrateActivityMatrixValue` /
  `LEGACY_ACTIVITY_KEY_MAP`).
- **Surface the structure** on all three readers: the onboarding matrix **groups by category** in the tier
  ordering sensual→extreme; questionnaire generation can **seed from categories**; the kink test
  ([`50`](50-self-assessments.md)) uses **categories as subscales**.
- **Stay additive/compatible.** Questionnaire matrices that read the inventory keep working byte-identically;
  the onboarding matrix groups but still renders as the **5-point labelled scale**; **no `schemaVersion`
  bump** beyond what 46 already introduced (none — 46 was additive-optional).
- **Keep the same safety rails** — 18+ ack, `restricted`, owner-visible / everyone-else-redacted, excluded
  from `buildDepictionNote`, never broadcast-shareable, relevance-gated
  ([`18`](18-personal-onboarding.md) §14.10/§14.11), inclusive non-clinical wording, taboo strictly as
  fantasy/roleplay, never pathologizing.

**Non-goals**

- **The kink-inventory test itself** — [`50`](50-self-assessments.md). This spec only delivers the
  categorized/tiered inventory it depends on (and confirms the categories map cleanly to subscales).
- **Loosening the content boundary.** The scope line ([`18`](18-personal-onboarding.md) §14.5: no minors,
  no real non-consent, no illegal acts as activities; taboo only as fantasy/roleplay) is **unchanged**.
- **Touching `INTIMACY_FANTASIES`.** The separate fantasies/roleplay list (`topics.ts`) stays a flat list
  for now; this spec restructures only `INTIMACY_ACTIVITIES`. (Whether fantasies later gets the same
  treatment is out of scope; flagged in §11.)
- **A new categorical-columns matrix type.** The matrix stays an **ordinal 5-point labelled scale**
  ([`27`](27-intimacy-redesign.md) §5, [`46`](46-intimacy-matrix-accuracy.md)); this spec changes the
  **inventory shape** + how rows are **grouped/ordered**, not the column model.
- **Reworking the anatomy resolution.** [`46`](46-intimacy-matrix-accuracy.md)'s anatomy-driven oral
  tailoring is reused unchanged; this spec only changes what the resolver iterates over (a categorized
  inventory instead of a flat list).
- **Medical sexual-health screening** (STI status/testing) — non-medical; out
  ([`27`](27-intimacy-redesign.md) §11).
- **Owner-managed custom-category curation UI.** Owner custom additions still ride the existing
  `mergedIntimacyTopics` free-text path ([`08`](08-questionnaires.md) §16.5a); a richer "add to a
  category at a tier" Settings UI is a deliberate future polish (§11), not this spec.

## 3. UX & flows

This is primarily a **data-structure + content** change; the only user-visible surfaces are the three
readers, and only the onboarding matrix changes visibly. (Developer-facing API/usage is §5.)

### 3.1 Onboarding intimacy matrix — now grouped by category

Entry/shell unchanged ([`18`](18-personal-onboarding.md) §3.3/§14.5, [`27`](27-intimacy-redesign.md) §3):
opt-in **Intimacy & sexuality** card → one-time **18+ acknowledgement** → the branched structured form via
`@selfos/answering` (content note, not-medical line, `CrisisFooter`), with the activity matrix gated inside
the `getSpecific` opt-in group exactly as today (the catalog already has
`branch: when('getSpecific', true)` on `activities`).

**What changes:** the matrix's rows, previously one long ungrouped list, are now **grouped by category**,
and the **categories are ordered by ascending intensity** (sensual & sensory first → edge play / taboo
fantasy last). Each category renders a small **section header** (e.g. "Sensual & sensory", "Power exchange
/ D-s") above its rows; within a category, rows order by tier then by inventory order. Concretely:

- The matrix question stays one `matrix` control with the 5-point labelled scale (Hard no · Not interested ·
  Curious · Like it · Love it) — the answer model is unchanged.
- Rows are presented as **category groups, each open by default** (CLAUDE.md §12: never default-collapse
  form inputs; accordion grouping is for optional tidying only — every group renders open, still
  user-collapsible). A much longer matrix is the reason grouping exists here, but collapsing a group by
  default would silently hide its rows at the bottom of a long section (the exact failure CLAUDE.md §7/§12
  warn about), so groups are **open by default**.
- The anatomy-driven oral rows ([`46`](46-intimacy-matrix-accuracy.md)) live in the **Oral** category and
  still re-resolve live from the `ownAnatomy`/`partnerAnatomy` answers.
- Skipping `getSpecific` → the whole matrix (all categories) stays hidden, exactly as today.

**Open question (§11):** with ~60–100 rows even grouped, the matrix is long. Whether the person rates **all
categories** or first **picks which categories to rate** (a category-selection step that filters the
matrix) is an explicit UX decision flagged for the user — see §11. The default this spec proposes is
**all categories, grouped, open by default**, with the standing "full surface renders to the bottom" +
no-overflow guards (CLAUDE.md §7) treated as critical here (§7/§9/§10).

### 3.2 Questionnaire generation — seed from categories

`packages/core/src/intimacy/topics.ts` is read by questionnaire generation ([`08`](08-questionnaires.md)
§16.5) via `INTIMACY_TOPICS` / `mergedIntimacyTopics`. With the inventory categorized, generation can
optionally **seed from a category** (e.g. "draft explicit questions about the Bondage & restraint family")
and **balance across tiers**. No behavior is forced — generation continues to seed from the full inventory
by default, so existing generation flows are unchanged; the category structure is **additive context** the
generation prompt can use. (The exact prompt change is generation-side, owned by [`08`](08-questionnaires.md);
this spec only guarantees the category/tier metadata is available, see §5.)

### 3.3 The kink-inventory test ([`50`](50-self-assessments.md)) — categories as subscales

The kink test ([`50`](50-self-assessments.md), separate spec) consumes the categorized inventory: each
**category is a subscale**, the **tiers order** items within a subscale gentle→extreme, and a person's
ratings roll up to a per-category profile. This spec delivers the structure; 50 builds the test. The
guarantee here is that `intimacyActivitiesByCategory()` / `INTIMACY_CATEGORIES` (§5) expose exactly the
grouping 50 needs.

## 4. Data model (vault files & schemas)

All reads/writes go through the intake session / vault service as today; no direct `fs`. The inventory is
**code, not vault data** — a shared constant. Everything below is **additive** — **no `schemaVersion`
bump** (matching the [`46`](46-intimacy-matrix-accuracy.md) additive precedent; the matrix value stays
`Record<string, number>` keyed by stable keys).

### 4.1 The categorized, tiered inventory entry

Replace the flat `INTIMACY_ACTIVITIES: readonly string[]` with a list of **entry objects**
(`packages/core/src/intimacy/topics.ts`):

```ts
/** A consensual-adult intimacy activity, categorized + tiered (49). */
export interface IntimacyActivity {
  /** Stable, anatomy-independent matrix-row key (46 §4.2). Never changes when the label re-resolves. */
  key: string;
  /** Display label (the matrix row label, the kink-test item, the generation seed). */
  label: string;
  /** Which family this belongs to — the kink test's subscale, the matrix's group header (49 §4.2). */
  category: IntimacyCategory;
  /** Intensity tier, gentle (1) → extreme (5). Orders rows sensual→extreme + within a category. */
  tier: 1 | 2 | 3 | 4 | 5;
}
```

**Category enum** (proposed ~14 — final list is an open question, §11), ordered by ascending baseline
intensity so the matrix groups read sensual→extreme:

```ts
export const INTIMACY_CATEGORIES = [
  'sensual', // Sensual & sensory
  'oral', // Oral
  'manual-toys', // Manual & toys
  'penetration', // Penetration
  'anal', // Anal
  'roleplay', // Roleplay & fantasy
  'dirty-talk', // Dirty talk & verbal
  'power-exchange', // Power exchange / D-s
  'bondage', // Bondage & restraint
  'impact', // Impact & sensation
  'exhibition', // Exhibitionism & voyeurism
  'group', // Group & swinging
  'edge', // Edge play
  'taboo-fantasy', // Taboo *fantasy* (CNC etc., as fantasy only)
] as const;
export type IntimacyCategory = (typeof INTIMACY_CATEGORIES)[number];

/** Human label per category (the matrix group header / subscale name). */
export const INTIMACY_CATEGORY_LABELS: Readonly<Record<IntimacyCategory, string>> = {
  /* … */
};
```

- **`tier`** is `1..5` (gentle→extreme). A 3-tier scale (gentle/moderate/intense) is an alternative flagged
  in §11; this spec proposes 5 to mirror the matrix's 5 points and give the kink test finer ordering. The
  tier is the inventory's _baseline_ intensity (used for ordering/subscale weighting), **independent** of a
  given person's 1–5 _rating_ of the row.
- **`key`** is the [`46`](46-intimacy-matrix-accuracy.md) stable key. For most entries it remains
  `slugifyActivity(label)`; the oral entries keep the anatomy-resolved keys (`oral-receiving`,
  `oral-giving-penis`, `oral-giving-vulva`, `oral-giving`). Keys **must be unique across the inventory**
  (an integrity test asserts this, §10).
- **Boundary, in the data.** `taboo-fantasy` entries are worded strictly as **fantasy/roleplay** (CNC /
  "ravishment" roleplay, etc.), mirroring the existing intake/questionnaire treatment; **no** minors / real
  non-consent / illegal acts appear as entries at any tier (§8). The boundary is enforced in wording + the
  generation prompt + the model, never a keyword filter ([`08`](08-questionnaires.md) §16.5a), but the
  inventory itself contains nothing out of policy.

**A concrete starter inventory (~60–100 entries) is proposed in §11 for the user's review/curation** —
this spec does **not** silently invent the final list. The structure (entry shape + categories + tier
axis) is the decision; the exact rows + their category/tier assignments are flagged.

### 4.2 Backward-compatible accessors

Existing readers expect specific shapes; provide accessors so the restructure is additive:

```ts
/** Flat list of labels — the legacy `string[]` shape questionnaire generation seeds from. */
export const INTIMACY_ACTIVITY_LABELS: readonly string[] = INTIMACY_ACTIVITIES_FULL.map(
  (a) => a.label,
);

/** The full categorized inventory (the new source of truth). */
export const INTIMACY_ACTIVITIES_FULL: readonly IntimacyActivity[] = [
  /* §4.1 entries */
];

/** Grouped by category, in INTIMACY_CATEGORIES order; within a category by tier then inventory order. */
export function intimacyActivitiesByCategory(): ReadonlyMap<IntimacyCategory, IntimacyActivity[]>;
```

> **Naming decision (flagged, §11):** keep the name `INTIMACY_ACTIVITIES` pointing at the **flat label
> list** (least-churn for the questionnaire reader + `mergedIntimacyTopics`) and add
> `INTIMACY_ACTIVITIES_FULL` for the categorized inventory; **or** rename `INTIMACY_ACTIVITIES` to the
> categorized list and give the flat list a new name. The first minimizes blast radius on the concurrent
> questionnaire work (§11.1) and is the spec's recommendation, but it's a shared-symbol rename either way —
> hence flagged. `INTIMACY_TOPICS` / `mergedIntimacyTopics` continue to expose `activities` as **labels**
> (a flat string list) so generation is unaffected; the category metadata is exposed separately.

### 4.3 Relationship to 46's `MatrixRow` model + carry-forward

- **Stable keys.** Each `IntimacyActivity.key` **is** the [`46`](46-intimacy-matrix-accuracy.md) §4.2 stable
  `MatrixRow` key. `resolveIntakeActivityRows` (§5) emits `MatrixRow` (`{ key, label }`) entries straight
  from the inventory (oral entries anatomy-resolved as today), so the matrix value stays
  `Record<string, number>` keyed by stable keys. **No value-shape change, no `schemaVersion` bump.**
- **Carry-forward of existing ratings (no data loss).** `migrateActivityMatrixValue` /
  `LEGACY_ACTIVITY_KEY_MAP` (`activityRows.ts`, [`46`](46-intimacy-matrix-accuracy.md) §4.3) is **extended**
  to cover every label the **pre-49 flat inventory** could emit → its (possibly new) stable key:
  - A rating stored under a **46 stable key** (`slugifyActivity('Bondage')`, `oral-receiving`, …) that the
    new inventory still uses is **already correct** — `STABLE_KEYS` recognizes it, no remap.
  - A rating stored under an **old label string** (`'Bondage'`, `'Spanking (giving)'`, …) maps to its stable
    key via `LEGACY_ACTIVITY_KEY_MAP` (already covers every flat-inventory label).
  - **If an expanded entry's wording changes** (e.g. `'BDSM / dom-sub play'` is split/renamed into
    finer-grained entries), its **old label and old slug** are added to `LEGACY_ACTIVITY_KEY_MAP` mapping to
    the **new** stable key(s), so a prior rating re-attaches. Where one old row maps to several new rows, the
    migration assigns the old rating to the **closest** new entry (documented per-mapping) and the rest start
    unrated.
  - Any key that still doesn't map is **appended verbatim** at synthesis (the existing orphan handling), so a
    re-synthesis **never silently drops a prior rating**. Idempotent — re-running never double-maps or drops
    (the §4.3-46 first-wins logic is preserved).
- **No new restricted/private mechanics** — every inventory entry is rated inside the `restricted` intimacy
  matrix; routing is unchanged ([`18`](18-personal-onboarding.md) §14.8).

### 4.4 Ownership

The inventory is a shared **code constant** (`packages/core/src/intimacy/topics.ts`), never per-person
vault data, **never mutated per-person** ([`46`](46-intimacy-matrix-accuracy.md) §5,
[`08`](08-questionnaires.md) §16.5a). All ratings live in the encrypted `IntakeSession` via the existing
intake store; no new vault file. Owner custom additions still flow through `mergedIntimacyTopics`'s free-text
path (uncategorized; placed in an "Other / custom" bucket by the readers, see §7).

## 5. Architecture & modules

How it's built. No new feature module; this extends existing core modules + the three readers.

- **`packages/core/src/intimacy/topics.ts`** — the restructure:
  - Add `IntimacyActivity` / `IntimacyCategory` / `INTIMACY_CATEGORIES` / `INTIMACY_CATEGORY_LABELS` /
    `INTIMACY_ACTIVITIES_FULL` (the categorized inventory) + `INTIMACY_ACTIVITY_LABELS` (flat labels) +
    `intimacyActivitiesByCategory()` (§4.1/§4.2).
  - Keep `INTIMACY_FANTASIES`, `INTIMACY_TOPICS`, `IntimacyTopics`, `mergedIntimacyTopics` exposing
    `activities` as a **flat label list** (so questionnaire generation is unaffected — §3.2/§4.2). The
    category metadata is exposed via the new symbols, **not** through `INTIMACY_TOPICS.activities`.
- **`packages/core/src/intimacy/activityRows.ts`** ([`46`](46-intimacy-matrix-accuracy.md)) — `resolveIntakeActivityRows(ctx)`
  now iterates the **categorized inventory** (`INTIMACY_ACTIVITIES_FULL`) instead of the flat
  `INTIMACY_ACTIVITIES`, emitting `MatrixRow` entries in **category order, then tier within a category**
  (so the rows arrive sensual→extreme grouped). The oral entries are still the only anatomy-tailored rows
  (the `resolveOral` logic is unchanged — it keys off the same `Oral` entries). `STABLE_KEYS` is derived
  from the inventory keys (it already is, just over the new list). `INTIMACY_MATRIX_DYNAMICS`
  (Degradation/humiliation, Praise/worship) either fold into the inventory as `power-exchange` entries
  **or** stay appended — flagged in §11 (recommend folding them in as categorized `power-exchange` entries
  so they're in the kink test's subscale too, with their existing slugs preserved as the stable keys via
  `LEGACY_ACTIVITY_KEY_MAP` for no-loss carry-forward).
- **`packages/core/src/intimacy/grouping.ts` (new small helper)** — a pure
  `groupMatrixRowsByCategory(rows)` returning `{ category, label, rows }[]` in category order, derived from
  the inventory's `key → category` map, for the renderer's grouped display. Keeps the renderer free of the
  inventory's internals (it just renders groups). The kink test ([`50`](50-self-assessments.md)) reuses
  `intimacyActivitiesByCategory()` directly for its subscales.
- **`packages/core/src/intake/intakeCatalog.ts`** — the `activities` matrix question is **unchanged in
  shape** (`matrix: { rows: resolveIntakeActivityRows(), min: 1, max: 5, pointLabels, limitLabels }`); it
  inherits the longer, ordered row list automatically. No new catalog field.
- **`packages/core/src/intake/activityContext.ts`** — unchanged (it already re-resolves rows via
  `withResolvedActivityRows` with the anatomy context; the longer inventory flows through).
- **`packages/core/src/intake/intakeService.ts` (`formatAnswerForSynthesis`)** — already maps matrix points
  → labels via the resolved rows; it inherits the longer inventory + the extended
  `migrateActivityMatrixValue`. The synthesis label text now reads grouped/longer but the mechanism is
  unchanged (still `restricted`-routed; orphaned keys appended).
- **`@selfos/answering` (`ScalePicker` / matrix render)** — the renderer takes the resolved `MatrixRow[]`
  and, **additively**, an optional grouping (the `{ category, label, rows }[]` from `groupMatrixRowsByCategory`)
  so the intake matrix can render **category headers** above row groups, every group **open by default**
  (CLAUDE.md §12). **Questionnaire matrices pass no grouping → render byte-identically** (one flat list, key
  === label). The 5-point labelled scale (`pointLabels`/`limitLabels`) is unchanged. (Extract the grouping
  helper to `@selfos/core` so the relay/web/iOS answering page reuses it, the established
  [`08`](08-questionnaires.md) §13.5 pattern.)
- **`apps/desktop/src/renderer/.../onboarding/IntakeFormPanel.tsx`** — already re-resolves the activity
  matrix live from the anatomy answers ([`46`](46-intimacy-matrix-accuracy.md) §5); it passes the grouped
  view to the matrix renderer. No new IPC.
- **`packages/core/src/questionnaires/answering.ts` + `trends.ts`** — already use `matrixRowKey`/
  `matrixRowLabel` (they never assume a row is a string, [`46`](46-intimacy-matrix-accuracy.md)); they
  inherit the longer inventory with no change.

Nothing here adds a setting, route, nav entry, IPC handler, or capability. The change is: one core constant
restructured + expanded, one resolver iterating it, one additive renderer grouping, one extended
carry-forward map.

## 6. IPC / API contracts

**No IPC changes** — same `intake:submitForm` / `synthesize` / `acknowledgeAdult` ([`18`](18-personal-onboarding.md)
§6, [`46`](46-intimacy-matrix-accuracy.md) §6). The 18+ ack is enforced in the bridge before the intimacy
section (incl. the activity matrix) is served. The matrix value stays a plain `Record<string, number>`
keyed by stable keys, so nothing on the seam changes shape.

**No Claude / API change in this spec.** The inventory restructure is pure, synchronous, offline data + a
pure resolver/grouping. Questionnaire **generation** ([`08`](08-questionnaires.md)) may later use the new
category metadata to shape its prompt, but that prompt change is owned by 08 and is not part of this spec —
this spec only guarantees the metadata is available (§3.2/§5). No new model call, no new usage type.

## 7. States & edge cases

- **Pre-49 ratings, keyed by old labels.** A vault holding `activities` answers keyed by the **pre-49 flat
  inventory labels** carries forward via the extended `LEGACY_ACTIVITY_KEY_MAP` → stable keys (§4.3); the
  matrix shows them against the (possibly relabelled/regrouped) row; synthesis maps them; no data loss.
- **Pre-49 ratings keyed by 46 stable keys.** Already correct — `STABLE_KEYS` recognizes them, no remap.
  (A vault between 46 and 49 is the common case.)
- **An old row split/renamed into finer entries.** The old label/slug maps to the **closest** new entry's
  stable key (§4.3); the rating re-attaches to that entry; the other new entries start unrated. The mapping
  is explicit per-renamed-entry (documented + tested, §10), never a silent drop.
- **A category an activity moved between** (an entry's `category` is re-assigned during curation). The
  entry's **`key` is unchanged**, so the rating stays attached; only the **group header** it renders under
  changes. No data loss, no remap — the rating follows the key, not the category. (Re-categorization is a
  display change.)
- **Partially filled matrix.** Blank rows = no answer (no fact); only rated rows produce facts. Unchanged.
- **Anatomy edited after rating** ([`46`](46-intimacy-matrix-accuracy.md) §7). The oral rows re-label, keys
  stable → no orphan. A removed partner-anatomy option hides a giving row but preserves its rating under the
  stable key. Unchanged by this spec.
- **A much longer matrix at narrow widths (the headline UX risk).** With ~60–100 grouped rows the matrix is
  long. **Critical guards (CLAUDE.md §7/§12):** (a) **no horizontal scroll anywhere at ~360px** — the
  5-point labelled buttons wrap (`.scale`/`.matrixRow` wrap, [`27`](27-intimacy-redesign.md) §5), and
  category headers are full-width; (b) the **full surface renders to the bottom** — every category group is
  **open by default** (no `<details>` is `!open`; CLAUDE.md §12), and the trailing affordances (the
  remaining intimacy questions after the matrix, the "Tell me more"/Continue controls) are reachable; the
  E2E **scrolls to the end and asserts the last group's rows + the trailing controls are visible** (§10).
  This is exactly the collapsed-accordion class of bug CLAUDE.md §7 calls out, so it is tested explicitly.
- **Owner custom activities (uncategorized).** A custom free-text activity from `mergedIntimacyTopics`
  ([`08`](08-questionnaires.md) §16.5a) has no `category`/`tier`. The readers place it in an **"Other /
  custom"** group at the **end** (after `taboo-fantasy`) and assign it a neutral mid tier for ordering; the
  kink test ([`50`](50-self-assessments.md)) excludes uncategorized custom items from category subscales
  (or buckets them as "Other"), flagged for 50. It is **never** dropped.
- **Corrupt/missing matrix value.** A malformed `activities` value degrades to "unanswered" (no facts), per
  the tolerant intake-answer handling; never throws. Unchanged.
- **Sync conflict on the intake session.** Handled by the existing intake/vault sync-conflict behavior
  ([`00`](00-architecture.md)); the value is keyed by stable keys, so a merged session never silently
  re-keys. Unchanged.
- **Questionnaire matrix unaffected.** A questionnaire `matrix` with plain-string rows renders flat (no
  grouping) and keys by label — byte-identical to today (§5; the regression proof is the questionnaire
  matrix E2E, §10).
- **18+ not acknowledged.** The section (incl. the matrix) stays gated. Unchanged.

## 8. Safety, privacy & honesty

- **18+ + `restricted` + owner-visible / everyone-else-redacted + excluded from `buildDepictionNote` + never
  broadcast-shareable** — every inventory entry is rated inside the `restricted` intimacy matrix and rides
  the **same** rails as today ([`18`](18-personal-onboarding.md) §14.10, [`27`](27-intimacy-redesign.md) §8,
  [`46`](46-intimacy-matrix-accuracy.md) §8). The expansion adds rows, not new mechanics; nothing changes
  the restricted routing.
- **Consensual-adult boundary — in the data and the wording.** The inventory contains **only**
  consensual-adult acts within Anthropic usage policy. The `edge` and `taboo-fantasy` categories are the
  most sensitive: **`taboo-fantasy` items are worded strictly as fantasy/roleplay** (CNC / "ravishment"
  roleplay framed as pre-agreed, etc.), mirroring the existing intake/questionnaire treatment
  ([`27`](27-intimacy-redesign.md) §8, [`08`](08-questionnaires.md) §16.5); **no** minors / real
  non-consent / illegal acts appear as entries at **any** tier. `edge play` items (breath play, etc.) are
  worded plainly as activities a person can rate, never as instructions or encouragement, and a "Hard no"
  is rendered as a **boundary** (the distinct `limitLabels` tone, [`27`](27-intimacy-redesign.md) §4.2).
- **Inclusive, non-clinical, never pathologizing wording.** Labels are casual/affirming
  ([`46`](46-intimacy-matrix-accuracy.md) §8), never clinical, never implying that an interest (or its
  absence) is a problem. The kink test ([`50`](50-self-assessments.md)) inherits this — a profile is a
  description of preference, never a diagnosis.
- **Relevance-gated surfacing.** Intimacy facts (now from a richer inventory) surface only in clearly
  relevant intimacy/relationship contexts ([`18`](18-personal-onboarding.md) §14.11;
  [`28`](28-portrait-synthesis-optimization.md) life-area selection) — not a budgeting chat.
- **Crisis / not-medical.** Not-medical line + `CrisisFooter` on every intimacy surface, unchanged. The
  optional pointer to **What weighs on you** for non-consensual experiences ([`27`](27-intimacy-redesign.md)
  §8) is unchanged — this block stays consensual-adult. Sexual-health/STI screening stays **out** (medical;
  [`27`](27-intimacy-redesign.md) §11).

## 9. Accessibility

Per [`01`](01-design-system.md) §9 and the matrix-specific rules in [`27`](27-intimacy-redesign.md) §9 /
[`46`](46-intimacy-matrix-accuracy.md) §9. A **much longer grouped matrix** raises the stakes on the
existing rules:

- **Keyboard.** Each row remains a labelled single-select group of the 5 labelled points; full keyboard
  operation (tab between rows, arrow/select within a row). Category **headers** are non-interactive headings
  (or a collapsible group control) — if collapsible, the toggle is keyboard-operable and the group is **open
  by default** (CLAUDE.md §12), so a keyboard user never has to expand to reach a row.
- **Screen reader.** The row **label** (not the stable key) is the accessible name
  ([`46`](46-intimacy-matrix-accuracy.md) §9); category headers are announced as headings/group labels so
  the structure is navigable ("Power exchange / D-s — group, N items"). Tier is **not** surfaced as a
  visible/announced ranking on the rating control (it orders rows, but a person rates their own feeling, not
  the item's "intensity") — so it never reads as a value judgment.
- **No horizontal scroll at ~360px.** The 5 labelled points wrap (`.scale`/`.matrixRow` wrap); category
  headers are full-width; the matrix stacks per-row on narrow widths ([`27`](27-intimacy-redesign.md) §9).
  This is asserted in the E2E inner-scrollbar scan (CLAUDE.md §7).
- **Full surface reachable.** Groups open by default + the "renders to the bottom" guard (§7/§10) ensure no
  row or trailing control is hidden in a default-collapsed accordion (CLAUDE.md §7/§12).
- **Reduced-motion** respected (any group expand/collapse honors it).

## 10. Testing strategy

Vault = encrypted intake session over the test/memFileSystem fakes; Claude = the offline fake (synthesis).
Run `pnpm typecheck` after writing tests (Vitest does not typecheck — memory `vitest-does-not-typecheck`).

**Unit — inventory integrity (`topics.test.ts`):**

- Every `IntimacyActivity.key` is **unique** across `INTIMACY_ACTIVITIES_FULL` (the core invariant — a
  duplicate key would collide matrix ratings).
- Every entry's `category` is in `INTIMACY_CATEGORIES`; every `tier` is `1..5`; every `label` is non-empty.
- `INTIMACY_CATEGORY_LABELS` has an entry for **every** `IntimacyCategory` (exhaustive).
- `INTIMACY_ACTIVITY_LABELS` (the flat list generation reads) equals
  `INTIMACY_ACTIVITIES_FULL.map(a => a.label)` and contains no duplicates.
- Inventory size is in the agreed band (~60–100, the exact target set once §11 is curated).
- The oral entries have the [`46`](46-intimacy-matrix-accuracy.md) stable keys (`oral-receiving`,
  `oral-giving-penis`, `oral-giving-vulva`, `oral-giving`).
- Every `taboo-fantasy` entry's label reads as fantasy/roleplay (a wording guard — no minors/real-non-consent
  phrasing; asserted against a forbidden-substring list, since the wording is the boundary, §8).

**Unit — grouping/ordering (`activityRows.test.ts` / `grouping.test.ts`):**

- `resolveIntakeActivityRows({})` returns rows in **category order, tier within category** (sensual→extreme);
  the oral rows sit in the `oral` category; the dynamics rows in `power-exchange` (if folded, §5/§11).
- `intimacyActivitiesByCategory()` groups every entry into its category; group order = `INTIMACY_CATEGORIES`.
- The anatomy truth table ([`46`](46-intimacy-matrix-accuracy.md) §10) still passes against the expanded
  inventory (own/partner anatomy → correct oral labels; `drawnTo` doesn't affect rows; trans/nb not erased).

**Unit — migration / carry-forward (`activityRows.test.ts`):**

- A rating keyed by a **46 stable key** the new inventory still uses is unchanged (no remap).
- A rating keyed by an **old pre-49 label** (`'Bondage'`, `'Spanking (giving)'`, …) maps to its stable key.
- A **split/renamed** old entry's old label maps to the **closest** new entry's key (the documented mapping);
  the rating re-attaches; idempotent on re-read; an unmapped key is **appended verbatim** (no drop).
- An entry whose **category** is re-assigned keeps the **same key** (a rating stays attached; only the group
  changes).

**Unit — synthesis (`intakeService` tests):** intimacy matrix answers → `restricted` facts (never
`shareable`); the matrix formats by **stable key → current label** ("bondage: Love it; edge play: Hard
no"); a preserved legacy/orphaned rating still reaches the portrait; anatomy facts stay `restricted`,
owner-visible, never a `Person` field.

**Unit — questionnaire generation read (`topics`/generation tests):** questionnaire generation still seeds
from the **flat label list** (`INTIMACY_TOPICS.activities` / `mergedIntimacyTopics`) — assert it reads the
expanded labels and is unaffected by the category metadata (the §3.2/§4.2 compatibility guarantee).

**Component (RTL):** the intake matrix renders **category group headers** above row groups, every group
**open by default** (no `<details>` is `!open`); a questionnaire `matrix` with plain-string rows renders
**flat** (no grouping), key === label (the byte-identical regression). _As-built note (per
[`46`](46-intimacy-matrix-accuracy.md) §10):_ `@selfos/answering` has no standalone test harness, so the
grouped render is covered via **`IntakeFormPanel` RTL** + the onboarding **E2E**, and the flat questionnaire
render via the existing questionnaire-builder/preview tests.

**E2E (Playwright, the real built app) — the headline cases:**

- 18+ ack → the intimacy form → `getSpecific` → answer anatomy → the matrix renders **grouped by category**
  in sensual→extreme order; **scroll to the very bottom and assert the last category's rows are visible**
  AND the trailing intimacy controls (the questions after the matrix + Continue/"Tell me more") are visible
  (the CLAUDE.md §7 "full surface renders to the bottom" guard — the collapsed-accordion bug class).
- Rate rows across several categories (incl. an `edge`/`taboo-fantasy` row) → synthesize → a `restricted`
  intimacy fact is **owner-visible, redacted for a member** → **decrypt the persisted `activities` value and
  assert it is keyed by STABLE keys** (carry-forward proof).
- **No-overflow / inner-scrollbar scan** at **390px AND ~360px** while the long matrix renders (CLAUDE.md §7:
  assert no element has `scrollWidth > clientWidth` with `overflow-x: auto|scroll`, not just `main`) + the
  control-geometry guard for the 5-point buttons.
- **Carry-forward E2E:** seed a vault with an `activities` value keyed by **pre-49 labels**, re-open
  onboarding → the matrix shows those ratings against the (regrouped) rows → re-synthesize → the facts are
  present (no data loss), and the re-saved value is keyed by stable keys.
- **Questionnaire matrix regression:** the existing questionnaire matrix E2E still passes (plain-string rows,
  flat render, key by label) — the §11.1 shared-surface proof.

## 11. Open questions

- **The exact final activity list, category assignments, and tier scale** — this spec proposes the
  **structure** (entry shape `{key,label,category,tier}`, ~14 categories, a tier axis) and a **concrete
  starter inventory of ~70 entries** below for the user's **review/curation**; it is **not** a silently
  assumed final list. Decisions needed: (a) confirm/curate the entries + their wording; (b) confirm the
  category set (~14 below) — add/merge any; (c) **3 tiers (gentle/moderate/intense) vs 5 tiers** (this spec
  proposes **5** to mirror the matrix points + give the kink test finer ordering). **Proposed starter
  inventory (review + curate):**
  - **Sensual & sensory** (t1–2): Sensual massage · Making out / extended kissing · Body worship · Feather /
    soft-touch teasing · Temperature play (ice / warm) · Sensory deprivation (blindfold-only) · Blindfolds ·
    Mutual masturbation.
  - **Oral** (t2–3): Receiving oral · Giving oral · Deepthroat · 69 · Face-sitting · Rimming (giving) ·
    Rimming (receiving). _(Oral rows are anatomy-resolved by [`46`](46-intimacy-matrix-accuracy.md).)_
  - **Manual & toys** (t1–3): Fingering · Hand jobs / manual stimulation · Vibrators · Dildos · Wand/clitoral
    toys · Strap-on play · Anal toys / butt plugs · Cock rings.
  - **Penetration** (t2–3): Vaginal sex · Different positions / variety · Slow & sensual · Rough / hard · Quickies.
  - **Anal** (t2–4): Anal (receiving) · Anal (giving) · Anal fingering · Pegging · Double penetration _(fantasy
    framing where relevant)_.
  - **Roleplay & fantasy** (t2–4): General role-play · Costumes / dress-up · Stranger / one-night roleplay ·
    Boss/employee · Teacher/student · Doctor/patient · Captor/captive _(fantasy)_.
  - **Dirty talk & verbal** (t1–3): Light dirty talk · Explicit dirty talk · Sexting · Phone / voice sex ·
    Begging · Verbal commands.
  - **Power exchange / D-s** (t2–4): Being dominant · Being submissive · Switching · Following commands ·
    Giving commands · Degradation / humiliation _(consensual)_ · Praise / worship · Service / obedience ·
    Collaring · Brat play.
  - **Bondage & restraint** (t2–4): Light bondage (cuffs / ties) · Rope bondage / shibari · Restraint to the
    bed/furniture · Gags · Predicament bondage · Suspension _(advanced)_.
  - **Impact & sensation** (t2–5): Spanking (giving) · Spanking (receiving) · Hair-pulling · Biting ·
    Flogging · Paddling · Caning · Wax play · Nipple clamps · Pinching/scratching.
  - **Exhibitionism & voyeurism** (t2–4): Exhibitionism · Voyeurism · Being watched · Watching a partner ·
    Public / semi-public sex · Sharing photos/videos _(consensual, between partners)_ · Camming.
  - **Group & swinging** (t3–4): Threesomes · Group sex / orgies · Swinging · Cuckolding / hotwifing _(as a
    dynamic)_.
  - **Edge play** (t4–5): Breath play / choking (giving) · Breath play / choking (receiving) · Knife/needle
    play _(advanced)_ · Electro play · Fisting · Heavy impact.
  - **Taboo fantasy** (t4–5, fantasy/roleplay only): Consensual non-consent (CNC) / "ravishment" roleplay ·
    Primal play · Age-gap roleplay _(adults)_ · Pet play · "Forced" roleplay _(pre-agreed)_. **(No minors /
    real non-consent / illegal acts — fantasy framing only, §8.)**
- **Onboarding matrix UX with a much longer list** — does the person rate **all categories** (the proposed
  default: grouped, open by default), **or** first **pick which categories to rate** (a category-selection
  step that filters the matrix to chosen families)? The longer the curated list, the stronger the case for
  the pick-categories option. **Recommendation:** ship "all categories, grouped, open by default" first
  (simplest; the §7/§9/§10 guards keep it usable), with category-selection as a fast follow if it reads long
  in use.
- **Wording of `edge play` / `taboo fantasy` items** — confirm the exact labels read affirming, casual, and
  unambiguously fantasy/roleplay for the taboo set (§8), e.g. the CNC label. The starter list above is a
  first draft to review.
- **`INTIMACY_MATRIX_DYNAMICS` (Degradation/humiliation, Praise/worship)** — fold them into the inventory as
  `power-exchange` entries (recommended — then they're in the kink test's subscale, with their existing slugs
  preserved as stable keys for no-loss carry-forward), or keep them appended outside the inventory as today?
- **`INTIMACY_ACTIVITIES` naming** — keep the name on the **flat label list** (least churn; recommended,
  §4.2) and add `INTIMACY_ACTIVITIES_FULL` for the categorized inventory, **or** rename to the categorized
  list? Either is a shared-symbol decision (coordinate with §11.1).
- **`INTIMACY_FANTASIES`** — leave flat (this spec's default), or give it the same categorized/tiered
  treatment in a follow-up? (Out of scope here.)
- **Sequencing vs [`46`](46-intimacy-matrix-accuracy.md) and the concurrent questionnaire agent.** **46 is
  already Built** (the stable-key `MatrixRow` model + the anatomy resolver are on `main`), so the prerequisite
  is met — sequence **46 → 49**: 49 expands the inventory on top of 46's stable keys. Coordinate the
  `topics.ts` change with the concurrent questionnaire work via a `git worktree` + only-your-hunks re-apply
  (§11.1). **Recommendation:** build 49 **before** [`50`](50-self-assessments.md) so the kink test inherits
  the categories rather than re-deriving them.

### 11.1 Concurrency / shared-surface coordination

`packages/core/src/intimacy/topics.ts` and the shared `@selfos/answering` matrix renderer are the
touchpoints with the concurrent **questionnaires** work and with [`46`](46-intimacy-matrix-accuracy.md):

- **`topics.ts` (`INTIMACY_ACTIVITIES`)** is read by **questionnaire generation** ([`08`](08-questionnaires.md)
  §16.5/§16.5a). The restructure MUST keep `INTIMACY_TOPICS.activities` / `mergedIntimacyTopics().activities`
  exposing a **flat label list** (§3.2/§4.2), so generation is **byte-unaffected**; the category metadata is
  exposed via new symbols only. Any shared-file edit goes through a **`git worktree` with only-your-hunks
  re-apply** (the established pattern when a concurrent agent shares the working tree).
- **`Question.matrix` + `@selfos/answering` `ScalePicker`** — the inventory expansion changes only _what rows
  the intake resolver emits_ and _how the intake matrix is grouped_; it does **not** change the matrix
  **type/column model**. Grouping is **additive and intake-only** — **questionnaire matrices (plain-string
  rows) render byte-identically** (one flat list, key === label). The proof is re-running the questionnaire
  matrix E2E (§10). Land any concurrent `Question.matrix` changes in a known order.
- **Keep the inventory render/synthesis-layer only.** It is **never** mutated per-person
  ([`46`](46-intimacy-matrix-accuracy.md) §5) — the resolver/grouping run at the render layer; synthesis
  re-resolves with the same context. The shared constant is the single source of truth read by the matrix,
  questionnaire generation, and the kink test.

> **Whole-app fit.** This inventory is foundational shared content. Today it powers **(1)** the onboarding
> intimacy activity matrix and **(2)** questionnaire generation; this spec adds **(3)** the kink-inventory
> test ([`50`](50-self-assessments.md), categories = subscales) as a first-class consumer; and the
> structure is designed so future consumers — **intimacy guided sessions** ([`16`](16-guided-sessions.md):
> a session can draw on a person's category profile to suggest where to explore) and **challenges** (a
> "try something from the Sensual & sensory family" prompt) — inherit the same categories/tiers rather than
> re-deriving them. Building the categorized/tiered inventory **early** (before 50) is what lets every
> consumer share one structure.

## 12. Changelog

- 2026-06-25 — **Built.** §11 resolved with the owner (all the spec's recommended defaults): **(a)** shipped the
  proposed ~94-entry starter inventory across the 14 categories as-is (curatable later — it's a code constant);
  **(b)** the onboarding matrix renders **all categories, grouped, open by default** (no pick-categories step);
  **(c)** **5 tiers** (gentle→extreme); **(d)** the two relationship dynamics are **folded into `power-exchange`**
  (slugs preserved as stable keys → no-loss carry-forward); **(e)** `INTIMACY_ACTIVITIES` keeps pointing at the
  **flat label list** (least churn) + new `INTIMACY_ACTIVITIES_FULL` is the categorized source; **(f)**
  `INTIMACY_FANTASIES` left flat. Built: `topics.ts` (`IntimacyActivity`/`IntimacyCategory`/`INTIMACY_CATEGORIES`/
  `INTIMACY_CATEGORY_LABELS`/`INTIMACY_ACTIVITIES_FULL`/`INTIMACY_ACTIVITY_LABELS`/`intimacyActivitiesByCategory`/
  `orderedActivities`/`categoryForKey`); `activityRows.ts` iterates the categorized inventory in display order +
  matches the two oral rows by key + the extended `LEGACY_ACTIVITY_KEY_MAP` (pre-49 splits/renames →
  closest new key; `'Squirting'` intentionally orphan-preserved); new `grouping.ts`
  (`groupMatrixRowsByCategory`/`matrixGroupsForRows`/`resolvedActivityMatrix`); additive `Question.matrix.groups`
  (no `schemaVersion` bump); the `@selfos/answering` matrix renders category headers (every group **open** — a
  plain heading, never a collapsed `<details>`) when `groups` present, flat byte-identically otherwise; the
  catalog + `activityContext` + `IntakeFormPanel` pass the grouped matrix. Tests: inventory integrity (unique
  keys, exhaustive category labels, ~60–100 band, oral stable keys, taboo-fantasy wording guard), grouping/
  ordering, carry-forward (pre-49 splits + Squirting orphan), synthesis label mapping, generation-still-reads-
  flat-labels; IntakeFormPanel grouped-render RTL; the onboarding E2E now asserts the grouped headers + the full
  surface renders to the bottom + no-overflow at 390 **and** 360px; the questionnaire matrix E2E stays green
  (flat regression). Sequencing: 46 (Built) → **49 (Built)** → 50. Amends [`27`](27-intimacy-redesign.md) §4.2/§5
  and [`08`](08-questionnaires.md) §16.5a (the inventory shape).
- 2026-06-25 — created (Draft). Greatly expands AND restructures the shared `INTIMACY_ACTIVITIES` inventory
  from a flat ~30-string list into a **categorized, tiered** inventory (~60–100 entries, ~14 categories,
  intensity tiers gentle→extreme) spanning slow/sensual → extreme/hardcore/kinky/explicit within the
  unchanged consensual-adult boundary. Foundational shared content read by the onboarding intimacy matrix
  (now grouped by category, sensual→extreme), questionnaire generation (can seed from categories), and the
  kink-inventory test ([`50`](50-self-assessments.md), categories = subscales). Builds on
  [`46`](46-intimacy-matrix-accuracy.md)'s stable-key `MatrixRow` model (each entry carries a stable
  key + label; existing ratings carry forward read-time via the extended `LEGACY_ACTIVITY_KEY_MAP`, no data
  loss, no `schemaVersion` bump). Sequencing: 46 (Built) → 49 → 50. Amends [`27`](27-intimacy-redesign.md)
  §4.2/§5 and [`08`](08-questionnaires.md) §16.5a (the inventory shape). Open: the exact curated activity
  list + category assignments + 3-vs-5 tiers, the long-matrix UX (rate-all vs pick-categories), edge/taboo
  wording, the dynamics-fold + naming decisions, and shared-file coordination with the questionnaire agent.
