# 46 — Intimacy activity-matrix accuracy (anatomy-driven labels + stable keys)

> **Status:** Draft — _last updated 2026-06-25_
>
> The onboarding intimacy **activity matrix** ([`18`](18-personal-onboarding.md) §14.5,
> [`27`](27-intimacy-redesign.md) §4.2) shows a sexual-act row that is **wrong** for some people
> (GitHub issue #62: a user sees "Going down on her (oral)" appearing when it shouldn't). Today the
> oral rows are tailored from **orientation** (`drawnTo`), which infers partner anatomy incorrectly and
> silently gives trans/non-binary people generic labels; worse, the **resolved display label is also the
> stored answer key**, so editing gender/orientation orphans prior ratings. This spec replaces the
> orientation-inference with **direct, sensitively-worded anatomy questions** that drive the oral labels,
> and introduces a **stable row key separate from the display label** so edits never orphan ratings.

Amends [`27`](27-intimacy-redesign.md) §4.2/§5 (the activity matrix) and
[`18`](18-personal-onboarding.md) §14.5 (the intimacy block). Touches the `Question.matrix` row model
shared with questionnaires ([`08`](08-questionnaires.md)) and the `@selfos/answering` renderer
(`ScalePicker`). Coordinates with [`47`](47-onboarding-quality-pass.md) (the wider intimacy-section
wording/length review — see §11). References [`00`](00-architecture.md)/[`01`](01-design-system.md) and
builds on the safety/privacy rails of [`18`](18-personal-onboarding.md) §14.10/§14.11.

---

## 1. Overview

The activity matrix is the single richest intimacy signal we collect — rows = the consensual-adult
activities (`INTIMACY_ACTIVITIES`), each rated on a 5-point feeling scale (Hard no · Not interested ·
Curious · Like it · Love it). To make the **oral** rows read naturally, the matrix tailors them by
anatomy: the _receiving_ label from the person's own anatomy, the _giving_ label(s) from the partner's
anatomy.

Today (`packages/core/src/intimacy/activityRows.ts`) that tailoring is wrong in three connected ways:

1. **Partner anatomy is inferred from orientation.** `drawnTo` ('Men'→penis, 'Women'→vulva) is used as a
   proxy for what a partner has between their legs. That conflates _who you date_ with _what genitals
   they have_, so the giving-oral row a person sees can be wrong for them. This is the user's report: a
   "Going down on her (oral)" row appears for someone for whom it doesn't fit.
2. **Trans / non-binary people get erased.** Own anatomy is inferred from `gender` and only `'Man'`
   /`'Woman'` are treated as certain; every other gender (and any ambiguous `drawnTo`) falls back to
   generic "Giving oral" / "Receiving oral". A trans woman with a penis, or a non-binary person, never
   gets accurate labels — the system "never erases on uncertainty," but the cost is that the most
   inclusive users get the least accurate experience.
3. **The label IS the key.** The resolver returns display strings that are used as **both** the matrix
   row label **and** the stored answer key (`Record<string, number>`, keyed by row string). The docstring
   acknowledges this. So if a person rates the matrix and later edits their gender or orientation, the row
   labels re-resolve to different strings and their prior ratings become **orphaned keys** — preserved on
   disk and appended verbatim at synthesis, but no longer shown against the (relabelled) row in the UI.
   Edits silently fork a person's ratings.

The fix: **stop inferring anatomy** and **ask it directly** (18+, `restricted`), tailor the oral labels
from the answers, and key the matrix by **stable row keys** decoupled from the resolved display label so
an anatomy/gender/orientation edit never orphans a rating.

> **Mandatory first step for the BUILD session (per CLAUDE.md §6 — "never fix an assumed cause").**
> Before changing any logic, **diagnose against the reporter's REAL intake data**: decrypt their vault
> and read the `basics` `gender` answer, the intimacy `drawnTo` answer, and the stored `activities`
> matrix keys, and confirm the exact mismatch shown in the issue #62 screenshot. The two leading
> hypotheses are **(a)** the data genuinely resolved a female-partner giving-oral row that feels wrong
> for them (an orientation-vs-anatomy mismatch — the model flaw), versus **(b)** `gender`/`drawnTo` were
> read from the wrong place / a stale answer so the resolver saw the wrong inputs (a plumbing flaw —
> `Onboarding.tsx` reads `gender` from the `basics` section answers, `IntakeFormPanel.tsx` reads live
> `drawnTo`). These produce different fixes. **Do not start editing the resolver until the live data
> confirms which one it is.** Both hypotheses are addressed by this spec (the anatomy questions fix (a);
> the diagnosis confirms whether (b) is also in play), but the cause must be verified, not assumed.

## 2. Goals / Non-goals

**Goals**

- **Drive the oral labels from anatomy, not orientation** — add explicit, sensitively-worded, 18+/
  `restricted` anatomy questions in the intimacy section: the person's **own anatomy** (drives the
  receiving-oral label) and the **partner anatomy they're into** (drives the giving-oral label(s)).
- **Fix the trans/non-binary erasure** — a trans woman with a penis, or anyone whose gender ≠ anatomy,
  now gets accurate oral labels because the system asks anatomy directly instead of guessing from
  gender/orientation. Neutral fallback only when anatomy is genuinely unspecified or "prefer not to say."
- **Decouple answer key from display label** — introduce a **stable row key** for the intake activity
  matrix, distinct from the resolved display label, so editing anatomy/gender/orientation never orphans a
  prior rating, and synthesis maps keys → current labels reliably.
- **Keep `drawnTo` (orientation)** as standalone coaching context (who you date); it just no longer
  drives the act labels.
- **No data loss** — existing intake answers keyed by old label strings carry forward (extend the
  existing orphaned-key handling into a read-time mapping); all schema additions are additive-optional
  with **no `schemaVersion` bump**.
- **Same safety rails** — 18+ ack (shared `adultAcknowledged`), `restricted` facts, owner-visible /
  everyone-else-redacted, excluded from `buildDepictionNote`, never broadcast-shareable, relevance-gated
  ([`18`](18-personal-onboarding.md) §14.10/§14.11). Inclusive, non-clinical, never-pathologizing wording.

**Non-goals**

- **Tailoring beyond the oral rows.** Anatomy drives **only** the two oral rows, exactly as today; every
  other activity row stays universal. Expanding anatomy-specific tailoring to other acts (penetration
  giving/receiving, etc.) is a deliberate deferred non-goal (§11) — it multiplies rows and complexity and
  is not what issue #62 is about.
- **Reworking `Person.gender`.** The `basics` `gender` single-select (Woman / Man / Non-binary /
  Genderfluid / Trans woman / Trans man / Prefer not to say / Other) is unchanged; it stays separate from
  anatomy (§5). Gender identity ≠ anatomy — that separation is the whole point.
- **Changing `INTIMACY_ACTIVITIES`.** The shared inventory ([`08`](08-questionnaires.md) §16.5a) is the
  single source of truth for questionnaire generation and is **never mutated** per-person; tailoring stays
  at the render/synthesis layer (§5).
- **Re-trimming or re-wording the rest of the intimacy section** — that is [`47`](47-onboarding-quality-pass.md)
  (coordination in §11).
- **A new categorical-columns matrix type** — the matrix stays an ordinal labelled scale
  ([`27`](27-intimacy-redesign.md) §5); this spec changes only the **row model** (key vs label), not the
  column model.

## 3. UX & flows

Unchanged shell ([`18`](18-personal-onboarding.md) §3.3/§14.5): opt-in **Intimacy & sexuality** card →
one-time **18+ acknowledgement** → the branched structured form via `@selfos/answering`, with the content
note, not-medical line, and `CrisisFooter`. Every question optional/skippable.

**New: anatomy questions.** Two new questions sit in the intimacy section (18+, `restricted`), placed
**before** the activity matrix so the matrix's oral rows are already resolvable when it renders:

1. **Own anatomy** (single-select) — e.g. _"What are your genitals?"_ with options **Penis / Vulva /
   Both or intersex / Prefer not to say** (exact wording is an open question, §11). Drives the
   **receiving-oral** label.
2. **Partner anatomy you're into** (multi-select) — e.g. _"What genitals are you into on a partner?"_
   with options **Penis / Vulva** (+ optional "no preference / not sure"). Drives the **giving-oral**
   label(s): selecting penis → a "giving a blowjob" giving row, selecting vulva → a "going down on her /
   cunnilingus" giving row, both → both rows. (Whether this is a new question or derivable from existing
   answers is an open question, §11.)

**Live resolution.** As in [`27`](27-intimacy-redesign.md), the activity matrix's rows re-resolve **live**
in the form as the person answers the anatomy questions (they sit in the same intimacy form), and
synthesis re-resolves server-side with the same context so keys line up.

**Diagnosis-first (process, not user-facing).** Per §1, the BUILD session confirms the real mismatch
against the reporter's decrypted data before touching the resolver. This is a developer step, surfaced
here because it gates the implementation.

**Happy path (a person who fits the user's report — a straight man):**

1. Acks 18+, reaches the intimacy form.
2. Answers `gender` = Man (basics), `drawnTo` = Women (orientation, coaching context).
3. Answers **own anatomy** = Penis, **partner anatomy** = Vulva.
4. The activity matrix's oral rows resolve to **Receiving oral (blowjob)** (own = penis) + **Going down
   on her (cunnilingus)** (partner = vulva) — and **no** "giving a blowjob" giving row, because no partner
   has a penis. The wrong row from the report no longer appears _because of the anatomy answer_, not an
   orientation guess.
5. Rates rows; ratings persist under **stable keys** (`oral-receiving`, `oral-giving-vulva`, …).
6. Later edits gender → Non-binary, or `drawnTo` → adds Men: the matrix **labels** re-resolve (e.g. a
   "giving a blowjob" row now appears because partner anatomy added penis), but every prior rating stays
   attached to its **stable key** — nothing orphans.

## 4. Data model (vault files & schemas)

All reads/writes go through the vault service / intake session as today; no direct `fs`. Everything below
is **additive-optional** — **no `schemaVersion` bump**.

### 4.1 New anatomy questions (catalog only)

Two new questions in `packages/core/src/intake/intakeCatalog.ts`'s `intimacy` section, both `restricted`,
both placed before `activities`, both gated by the existing intimacy gates (18+ ack; if they sit inside
the `getSpecific` opt-in group, they branch on `when('getSpecific', true)` like the matrix — confirm in
§11). They are **catalog data**, not schema fields — no `Person` field is promoted (anatomy stays a
`restricted` intake answer + fact, never a profile field, never in `buildDepictionNote`).

Proposed (wording to be approved, §11):

- `ownAnatomy` — `single`, options `['Penis', 'Vulva', 'Both or intersex', 'Prefer not to say']`,
  `{ restricted: true }`.
- `partnerAnatomy` — `multi`, options `['Penis', 'Vulva']` (+ optional "No preference / not sure"),
  `{ restricted: true }`.

These ride the same `restricted` routing as the rest of the intimacy block
([`18`](18-personal-onboarding.md) §14.8) — owner-visible, redacted for everyone else, never broadcast.

### 4.2 Stable matrix row keys (the `Question.matrix` row model)

Today `Question.matrix.rows: z.array(z.string())` — each row string is **both** the display label and the
answer key (the matrix value is `Record<string, number>`, keyed by the row string). This spec separates
key from label **for the intake activity matrix**, with two candidate models (the choice is an open
question for the user, §11):

- **Option A — `{ key, label }[]` rows (preferred).** Extend `matrix.rows` to accept either a plain
  `string` (back-compat — key === label, what every questionnaire matrix uses today) or `{ key: string,
label: string }`. A Zod union: `z.array(z.union([z.string(), z.object({ key: z.string().min(1), label:
z.string().min(1) })]))`. The renderer keys answers by `key`, displays `label`; questionnaire matrices
  (plain strings) are **completely unaffected** (key === label as before). This makes the key/label split
  a first-class, reusable concept.

- **Option B — a parallel key map on the intake matrix only.** Keep `matrix.rows: string[]` as the display
  labels and add an optional `matrix.rowKeys?: string[]` (parallel array, same length) that the intake
  matrix supplies; the answering renderer keys by `rowKeys[i]` when present, else by the label. Smaller
  blast radius, but a looser contract (two parallel arrays).

Either way the matrix **value stays `Record<string, number>`** (key → 1..5 point), so `IntakeAnswerValue`
is unchanged. For the intake activity matrix the **stable keys** are anatomy-independent identifiers:
e.g. `oral-receiving`, `oral-giving-penis`, `oral-giving-vulva`, plus a stable key per universal activity
(slugified from `INTIMACY_ACTIVITIES` once) and per relationship-dynamic row. Resolving anatomy changes
the **label** attached to a key, never the key itself.

### 4.3 Migration / carry-forward of existing label-keyed answers

Existing vaults hold `activities` answers keyed by **old label strings** (e.g. `"Going down on her
(oral)"`, `"Oral (receiving)"`, the neutral `"Giving oral"`, or any `INTIMACY_ACTIVITIES` label). A
**read-time, idempotent** mapping (no on-disk rewrite, no `schemaVersion` bump — the additive-schema
precedent) converts old label keys → stable keys when the matrix is read for display and at synthesis:

- A pure `LEGACY_ACTIVITY_KEY_MAP` (or a `legacyKeyFor(label)` function) maps every label the old resolver
  could ever emit — both neutral (`"Giving oral"`, `"Receiving oral"`) and the anatomy variants
  (`"Giving a blowjob"` → `oral-giving-penis`, `"Going down on her (oral)"` → `oral-giving-vulva`,
  `"Receiving oral (blowjob)"`/`"Receiving oral (going down on you)"` → `oral-receiving`) and each universal
  activity label → its slug.
- Applied when loading a stored answer into the matrix UI and in `formatAnswerForSynthesis`. **Any key
  that still doesn't map is appended verbatim** — extending the existing orphaned-key handling
  (`activityContext.ts` / `intakeService.ts` `formatAnswerForSynthesis`) so a re-synthesis **never silently
  drops a prior rating**. This is strictly more robust than today: today's orphan handling only survives
  because the key happens to be a readable label; with stable keys we also need the legacy map so an old
  rating re-attaches to its new stable row in the UI, not just in the portrait text.

### 4.4 Ownership

All matrix/anatomy answers live in the encrypted `IntakeSession` (the existing intake store); no new vault
file. The `INTIMACY_ACTIVITIES` shared constant is unchanged.

## 5. Architecture & modules

- **`packages/core/src/intimacy/activityRows.ts`** — rewrite the resolver. `resolveIntakeActivityRows`
  now takes an **anatomy context** (`ownAnatomy`, `partnerAnatomy`) instead of inferring from
  `(gender, drawnTo)`, and returns rows carrying a **stable key + a resolved label** (the §4.2 shape):
  - `resolveOral` reads **own anatomy** (`'Penis'` → "Receiving oral (blowjob)", `'Vulva'` → "Receiving
    oral (going down on you)", `'Both or intersex'` → a both/neutral receiving label, `'Prefer not to
say'`/unset → neutral "Receiving oral") for the `oral-receiving` row, and **partner anatomy** (`'Penis'`
    → `oral-giving-penis` "Giving a blowjob", `'Vulva'` → `oral-giving-vulva` "Going down on her (oral)",
    both → both rows, none/unspecified → a single neutral `oral-giving` "Giving oral" row).
  - **Inclusive by construction:** because anatomy is asked directly, a trans woman with a penis gets the
    penis receiving label and the partner rows she selected — **not** the generic fallback. Neutral
    fallback is reserved for genuine non-answers ("prefer not to say" / unset), never triggered merely by a
    non-binary gender or an "Everyone" orientation.
  - The shared `INTIMACY_ACTIVITIES` inventory is still **never mutated**; the resolver maps each inventory
    label to its stable key + (for oral) an anatomy-resolved label.
- **`packages/core/src/intake/activityContext.ts`** — `activityRowContext` now reads the **anatomy
  answers** (`ownAnatomy` from the intimacy section, `partnerAnatomy` from the intimacy section) out of the
  session, instead of `gender` (basics) + `drawnTo` (intimacy). `withResolvedActivityRows` is unchanged in
  shape — it just passes the new context. **Note:** the renderer must now read both anatomy answers from
  the live intimacy form (both live in the same `intimacy` section, simpler than today's cross-section
  `gender` read) — confirm this resolves the plumbing-hypothesis (b) from §1.
- **`apps/desktop/src/renderer/.../onboarding/IntakeFormPanel.tsx`** — re-resolve the matrix from the live
  `ownAnatomy` + `partnerAnatomy` answers (both in `answers`), replacing the current `profileGender` +
  `drawnTo` inputs. `Onboarding.tsx`'s cross-section `gender` read for the matrix is **removed** (gender no
  longer drives the rows) — but `gender` stays a basics question for its own sake.
- **`packages/answering` (`@selfos/answering`) — `ScalePicker` / matrix render.** Key answers by the
  stable **row key** (Option A `row.key` or Option B `rowKeys[i]`), display the **label**. The labelled
  5-point scale (`pointLabels` / `limitLabels`) is unchanged. Questionnaire matrices (plain-string rows)
  keep key === label.
- **Synthesis (`intakeService.ts` `formatAnswerForSynthesis` / `formAnswersMessages`)** — already
  re-resolves with `activityRowContext` and appends orphaned keys; extend it to (1) run answers through the
  §4.3 legacy-key map and (2) format by stable key → current label. Still `restricted`-routed.
- **`Person.gender` stays separate from anatomy** — gender identity is a profile/identity field; anatomy
  is a `restricted` intimacy answer used only to label the oral rows. They are never conflated; a person's
  gender is never used to infer their anatomy.

## 6. IPC / API contracts

**No IPC changes.** Same `intake:submitForm` / `synthesize` / `acknowledgeAdult`. The 18+ ack is enforced
in the bridge before the intimacy section's questions (including the new anatomy questions) are served
([`18`](18-personal-onboarding.md) §6). **No Claude/API change** — the resolver and key mapping are pure,
synchronous, offline logic; synthesis prompt input changes only in the readable label text it includes.

## 7. States & edge cases

- **Anatomy unanswered** — the oral rows render with **neutral** labels ("Giving oral" / "Receiving
  oral"), never hidden, never guessed. A person who skips anatomy still gets a usable matrix.
- **"Prefer not to say"** — own anatomy → neutral receiving label; partner anatomy "no preference / not
  sure" (or empty) → a single neutral giving row.
- **Both / intersex** — own anatomy `'Both or intersex'` → a both/neutral receiving label (e.g. "Receiving
  oral"); partner anatomy with both penis and vulva → **both** giving rows (`oral-giving-penis` +
  `oral-giving-vulva`).
- **Editing anatomy after rating the matrix** — the matrix **labels** re-resolve, but each rating stays
  attached to its **stable key** (§4.2), so nothing orphans. Adding a partner-anatomy option reveals a new
  giving row (unrated); removing one hides a row but **preserves** its stored rating under the stable key
  (re-appears if re-selected). The portrait re-synthesizes from the current set + any preserved keys.
- **Pre-spec answers (label-keyed)** — the §4.3 read-time legacy map re-attaches old label-keyed ratings
  to their stable keys; any unmapped key is appended verbatim at synthesis (no data loss). Idempotent — a
  re-onboarding / re-synthesis never double-maps or drops.
- **Re-onboarding flow** — a person re-entering the intimacy section sees their preserved ratings against
  the stable rows (mapped from legacy keys on first read); editing anatomy mid-flow re-labels live.
- **Orientation (`drawnTo`) edited** — no longer affects the matrix at all (it's pure coaching context
  now); editing it can never orphan a rating.
- **18+ not acknowledged** — the section (and the new anatomy questions) stay gated; unchanged.
- **Sync conflict on the intake session** — handled by the existing intake/vault sync-conflict behavior
  ([`00`](00-architecture.md)); the matrix value is a plain `Record<string, number>` keyed by stable keys,
  so a merged session never silently re-keys.
- **Branch staleness** — handled by the existing `resolveBranch` pruning ([`08`](08-questionnaires.md)).
- **Corrupt/missing matrix value** — a malformed `activities` value degrades to "unanswered" (no facts),
  per the tolerant intake-answer handling; never throws.

## 8. Safety, privacy & honesty

- **18+ + `restricted` + owner-visible / everyone-else-redacted + excluded from `buildDepictionNote` +
  never broadcast-shareable** — the new anatomy answers and their facts ride the **same** rails as the
  rest of the intimacy block ([`18`](18-personal-onboarding.md) §14.10,
  [`27`](27-intimacy-redesign.md) §8). Anatomy is **never** promoted to a `Person` field and **never**
  reaches an image provider.
- **Inclusive, non-clinical wording.** The anatomy questions are framed plainly and affirmingly, never
  pathologizing, never assuming gender from anatomy or vice-versa — explicitly the point of the redesign.
  "Both or intersex" and "Prefer not to say" are first-class options. Final wording is reviewed for
  inclusivity (§11).
- **Consensual-adult boundary** — unchanged ([`18`](18-personal-onboarding.md) §14.5).
- **Relevance-gated surfacing** — anatomy/oral facts surface only in clearly relevant intimacy contexts
  ([`18`](18-personal-onboarding.md) §14.11; [`28`](28-portrait-synthesis-optimization.md) life-area
  selection).
- **Not-medical line + `CrisisFooter`** on every intimacy surface, unchanged. Anatomy is collected for
  natural, accurate act labels — **not** as medical/health-screening data (STI/sexual-health screening
  stays out, [`27`](27-intimacy-redesign.md) §11).

## 9. Accessibility

Per [`01`](01-design-system.md) §9. The activity matrix stays fully keyboard-operable and screen-reader
clear: each row is a labelled single-select group of the 5 labelled points; the **label** (not the stable
key) is the accessible name, so a screen reader announces "Going down on her — Hard no … Love it." The new
anatomy questions are standard `single`/`multi` controls (labelled, keyboard-operable, "Other"/PNTS
options reachable). No horizontal scroll at ~360px — the labelled points wrap (`.scale`/`.matrixRow` wrap,
[`27`](27-intimacy-redesign.md) §5); the matrix stacks per-row on narrow widths. Reduced-motion respected.
The stable-key change is internal and must not change any accessible name.

## 10. Testing strategy

Vault = encrypted intake session over the test/memFileSystem fakes; Claude = the offline fake (synthesis).

**Diagnosis (process, gating the build):** before changing logic, the build session decrypts the
reporter's vault and records the real `gender`/`drawnTo`/`activities` keys to confirm hypothesis (a) vs (b)
(§1). Not an automated test — a documented prerequisite.

**Unit — resolver truth table (`activityRows.test.ts`):** an **anatomy-driven** truth table, including the
inclusivity cases the old model failed:

- own = Penis, partner = Vulva (the report's straight man) → receiving = blowjob, giving = `oral-giving-vulva`
  only, **no** giving-blowjob row.
- own = Vulva, partner = Penis → receiving = going-down-on-you, giving = `oral-giving-penis` only.
- partner = both → both giving rows; partner = none/PNTS → single neutral giving row.
- **Trans woman, own = Penis** → blowjob receiving label (NOT the generic fallback) — the regression that
  proves the trans/nb erasure is fixed.
- own = "Both or intersex" → both/neutral receiving; own = PNTS / unset → neutral receiving.
- **`drawnTo` does not affect the rows** (vary orientation, assert identical rows) — proving the
  decoupling.

**Unit — stable keys & migration:**

- Resolving different anatomy keeps the **same stable keys** for universal rows and `oral-receiving`; only
  labels change.
- **Key stability across an edit:** rate the matrix, edit anatomy/gender/`drawnTo`, re-resolve → every
  prior rating still maps to a stable key (no orphan). Assert the stored value's keys are unchanged.
- **Legacy map:** an answer keyed by old label strings (`"Going down on her (oral)"`, `"Receiving oral"`,
  a universal-activity label) maps to the right stable keys; an unmapped key is appended verbatim;
  idempotent on re-read.

**Unit — synthesis:** intimacy answers → `restricted` facts (never `shareable`); the activity matrix
formats by **stable key → current label** ("oral (receiving): Love it; …"); a preserved legacy/orphaned
rating still reaches the portrait. Anatomy facts are `restricted`, owner-visible, never a `Person` field.

**Component (RTL) — `@selfos/answering`:** a matrix with `{key,label}` (or `rowKeys`) rows renders the
**label**, stores the answer under the **key**; questionnaire matrices (plain-string rows) unchanged
(key === label). `IntakeFormPanel` re-resolves the matrix live from the anatomy answers; editing
`partnerAnatomy` adds/removes a giving row without dropping other ratings.

**E2E (Playwright, the real built app):** 18+ ack → the intimacy form → answer **own anatomy + partner
anatomy** → assert the matrix shows the **correct** oral labels for that anatomy (and the wrong-for-them
row is absent) → rate rows → synthesize → a `restricted` intimacy fact is owner-visible, redacted for a
member → **decrypt the persisted `activities` value and assert it is keyed by STABLE keys** → **edit gender
(or `drawnTo`) and re-open → assert the stored keys do NOT change** (the orphan regression). Plus the
390px no-overflow + control-geometry guards while the matrix renders. Run `pnpm typecheck` after writing
tests (Vitest does not typecheck).

## 11. Open questions

1. **Anatomy option wording + inclusivity review.** Exact prompts and option labels for `ownAnatomy`
   (Penis / Vulva / Both or intersex / Prefer not to say?) and `partnerAnatomy` (Penis / Vulva, plus a
   "no preference / not sure"?). Needs an inclusivity read — plain, affirming, non-pathologizing, never
   assuming gender from anatomy. (Default proposal in §3/§4.1.)
2. **Is the partner-anatomy question new, or derivable?** Should we add an explicit `partnerAnatomy` multi,
   or derive partner anatomy from existing answers (e.g. a combination of `drawnTo` + a lighter prompt)?
   The spec assumes a **new explicit question** (deriving from orientation is exactly the flaw we're
   fixing), but the user should confirm we want a second new question vs. one own-anatomy question +
   keeping giving rows neutral.
3. **The `Question.matrix` key model — Option A (`{key,label}[]` union rows) vs Option B (parallel
   `rowKeys?: string[]`).** §4.2 prefers A (a first-class, reusable key/label split, questionnaire matrices
   untouched); B is smaller-blast-radius but a looser contract. **User to approve which.**
4. **Where the anatomy questions sit** — inside the existing `getSpecific` "Getting specific (optional)"
   opt-in group (branching `when('getSpecific', true)`, like the matrix), or always-visible in the
   identity block? If gated, a person who skips "get specific" gets neutral oral labels (acceptable, since
   the matrix is also gated there); if always-visible, anatomy is asked of everyone who acks 18+. Confirm.
5. **Coordination/sequencing with [`47`](47-onboarding-quality-pass.md)** (the wider intimacy-section
   wording/length pass). This spec adds two questions and changes the matrix row model; spec 47 reviews
   the rest of the section's wording and length. Decide ordering (build 46 first so 47 reviews the final
   anatomy wording, or interleave) so the two don't conflict on the catalog.
6. **Deferred non-goal confirmation** — tailoring stays oral-only. Confirm we are NOT expanding
   anatomy-specific tailoring to other acts (penetration giving/receiving, etc.) in this spec.

### 11.1 Concurrency / shared-surface coordination

A separate agent is concurrently building the **questionnaires** feature, which shares the matrix renderer
and the intimacy inventory. Sequence to avoid clobbering:

- **`Question.matrix` model + the shared `@selfos/answering` `ScalePicker`** are the real touchpoint. The
  stable-row-key change (§4.2) MUST be **additive and opt-in** so existing **questionnaire matrices render
  byte-identically** (string rows still key by their label). If the questionnaire agent is also changing
  `Question.matrix` or the matrix renderer, land the two in a known order and re-run the questionnaire matrix
  E2E as the proof.
- **`packages/core/src/intimacy/topics.ts` (`INTIMACY_ACTIVITIES`)** is read by questionnaire generation.
  This spec only rewrites the **resolver** and never mutates the shared inventory — keep it that way.
- Any append-only IPC seam edits go through a `git worktree` with only-your-hunks re-apply (shared with the
  questionnaire work).

## 12. Changelog

- 2026-06-25 — created (Draft). Addresses GitHub issue #62 (a wrong sexual-act row in the onboarding
  intimacy activity matrix). Replaces orientation-inferred oral labels with direct, sensitively-worded
  anatomy questions (own + partner anatomy, 18+/`restricted`), fixing the trans/non-binary erasure; and
  decouples the matrix answer **key** from the resolved display **label** (stable keys) so editing
  anatomy/gender/orientation never orphans a rating. Mandatory build-time first step: diagnose against the
  reporter's real decrypted intake data before changing logic. Amends [`27`](27-intimacy-redesign.md) §4.2/
  §5 and [`18`](18-personal-onboarding.md) §14.5.
