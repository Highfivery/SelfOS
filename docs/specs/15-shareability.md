# 15 — Unified shareability: per-item "may inform others" control

> **Status:** Approved · _last updated 2026-06-23_ · **Amended by [`42`](42-relationship-scoped-sharing.md):**
> Insight facts + intake answers gain **relationship-type scoping** (`shareableTypes`/`answerSharing`) on top of
> this spec's broadcast/per-person model; Person _fields_ keep the `privateFields` boolean lock unchanged (42 §2).
>
> Today, what one person's data the AI may use in **another** related person's coaching context is decided by
> **fixed buckets** — People split notes/fields into a hard-coded "shareable" vs "private" set, and Dreams are
> silently excluded from sharing whenever their sensitivity tier isn't `standard`. This spec replaces both with
> **one consistent, per-item control**: every Person field and every Dream carries an explicit "may inform the
> coaching context of people you relate to" flag. The owner sees and can flip each one. The default is
> **shared** (see §2); the shared-by-default posture is shown plainly inline (visible per-item toggles + a
> short section explainer), not via an interruptive prompt.

This is the foundational privacy refactor of the 2026-06 app refresh (memory: `app-refresh-plan-2026-06`,
package **A**). It touches the seam — `buildContext` — that Sessions, Dreams, Questionnaires, and the future
Home dashboard all read, so it lands first. Amends [`04-people-roles.md`](04-people-roles.md) §3.4/§8.4 and
[`12-dreams.md`](12-dreams.md) §3.4/§8.3. Builds on the shareable-vs-private boundary defined there; references
[`00-architecture.md`](00-architecture.md) and [`01-design-system.md`](01-design-system.md) rather than
restating them.

---

## 1. Overview

**The problem.** The "shareable vs private" decision is currently made _for_ the user by the code:

- **People** — `buildContext` includes a fixed set of descriptive fields (`gender`, `appearance`, `occupation`,
  …) plus `publicNotes` about a related person, and **never** `privateNotes`, `healthNotes`, or `faith`. The
  user cannot change which side a given field falls on; the buckets are hard-coded in
  `shareableProfileLines` / `privateProfileLines` (`packages/core/src/people/buildContext.ts`).
- **Dreams** — a dream's approved insight facts can be shared per-person, **but only if its
  `sensitivity === 'standard'`**; any intimate/explicit/unfiltered dream is silently barred from sharing
  (`dreamInsightService.setDreamFactShare` returns `SENSITIVE`), and the composer's sensitivity field reads
  "Sensitive dreams are kept out of any shared context."

**The change.** Make shareability an explicit, per-item property the owner controls:

1. Each controllable **Person field** can be marked "may inform related people's context" (default on).
2. Each **Dream** can be marked "may inform context" (default on) — replacing the sensitivity-based auto-exclusion.
3. `buildContext` and the dream-image depiction read these per-item flags instead of fixed buckets.
4. The Person editor and Dream composer expose the flags inline, clearly labelled, with sensible affordances
   (per-field lock toggle; a dream-level switch).

**What "shareable" means (unchanged semantics, made explicit).** A person's own session **always** uses all of
their own data — it is _their_ coaching context. The flag governs one thing only: whether an item _also_ flows
into the coaching context of **other people who relate to them**. "Private" never means "hidden from the
owner's own AI"; it means "kept out of everyone else's."

## 2. Goals / Non-goals

**Goals**

- One mechanism for shareability across People and Dreams; no more two divergent models.
- Per-item granularity: the owner can lock any single field or dream to own-context-only.
- A clear default (**everything shareable**, including the previously-private categories — health notes, faith,
  and intimate/explicit dreams), each item individually lockable, surfaced **plainly inline** (visible per-item
  toggles + a short section explainer) rather than via an interruptive one-time prompt.
- `buildContext` (and the dream-image depiction) honour the per-item flags exactly — no path leaks a
  user-locked item into another person's context.
- Migration-safe: additive-optional schema, no `schemaVersion` bump (the `email`/`phone`/descriptive-fields
  precedent).

**Non-goals**

- **Relationship-scoped per-target field sharing** (e.g. "share my occupation with my partner but not my
  coworker"). Person fields share to **all** related people or none (one flag). Dreams keep their existing
  **per-related-person, per-fact** granularity (12 §3.4) on top of the dream-level flag. Per-target _field_
  sharing is a possible future refinement — out of scope here.
- **Changing who is a "related person."** The relationship graph is unchanged; this spec only changes _what_
  flows along it.
- **Re-designing the dream per-fact share UI** (`DreamShareControls`). We ungate it from sensitivity and make
  it reachable for all tiers, but its interaction model is unchanged.
- **A new capability.** Shareability is owner/self data control, not a role gate. No new entry in
  `capabilities.ts`.

## 3. UX & flows

### 3.1 Person editor — per-field shareability (amends `04`)

The People editor's **About**, **Notes**, and the private group are reworked so each controllable field shows a
small **shareability affordance** — an unobtrusive lock/share toggle (icon button) adjacent to the field label.

- **Shared** (default): an open/share icon, label "Shared — may inform people you relate to."
- **Private**: a closed-lock icon, label "Private — only used in this person's own coaching."

Today's two-section split ("About" = shareable, "Private" = health/faith) is **dissolved**: health notes and
faith move in alongside the other descriptive fields, each just defaulting to shared like everything else, each
flippable. The two separate notes fields (`publicNotes` + `privateNotes`) are **merged into a single "Notes"
field** with one share toggle (default shared). The standing helper copy that reads _"Only ever used in this
person's own coaching context — never shared…"_ is removed (it's no longer true by default); per-field state is
shown by the toggle instead.

A single section-level explainer replaces it: _"By default, what you note here can inform the coaching of people
you relate to. Lock any item to keep it to this person only."_ This plain, always-visible line — together with
the per-field toggles themselves — is how the shared-by-default posture is communicated; there is **no separate
interruptive heads-up** (the app is pre-release, so there's no installed-user "surprise" to guard against).

**Bulk affordance.** A section header control — "Lock all" / "Share all" — flips every controllable field at
once, for users who want the conservative posture without clicking each lock.

### 3.2 Dream composer — dream-level shareability (amends `12`)

The DreamComposer's **Sensitivity** field keeps its tiers (they still drive the image-generation warning and
the intimacy framing), but its helper text **no longer** claims sensitive dreams are excluded from sharing.

A **new explicit control** is added: a switch — **"Let this dream inform coaching context"** — with help text:
_"On: this dream's reflections can inform your coaching, and (once you analyze and approve it) be shared with
people you relate to. Off: it stays a private journal entry."_ Default **on** for all tiers.

When **off**, the dream's approved insight (if any) is excluded from context and the per-fact share controls are
hidden. When **on**, sharing works for every sensitivity tier — the per-person/per-fact `DreamShareControls`
(12 §3.4) become available regardless of tier (a sensitive dream can be shared; the owner still chooses which
facts and with whom).

### 3.3 Relationship editor

The relationship editor's two notes fields merge into one **Notes** field carrying a single share toggle
(default shared), mirroring the Person notes control — so "what the coach may say about this relationship to the
_other_ person" is one clear switch.

### 3.4 Effect on existing surfaces

- **Sessions / chat** — context the coach sees for a related person now reflects per-item flags.
- **Dreams sharing** — `DreamShareControls` reachable for all tiers when the dream-level switch is on.
- **Dream images** — the depiction of a People-graph-linked figure (`buildDepictionNote`) includes only the
  appearance/gender/ethnicity/age fields the owner has left **shared** on that person.

## 4. Data model (vault files & schemas)

All reads/writes stay through the vault service; no direct `fs`. The new flags (`privateFields`,
`informsContext`) are **additive-optional** (no bump). The one shape change is the Person **notes merge** (§4.3),
which bumps `Person.schemaVersion` and adds a migration-registry entry.

### 4.1 Person — `privateFields`

Add one field to `PersonSchema` / `PersonInputSchema` (`packages/core/src/schemas.ts`):

```ts
// The controllable descriptive/notes field keys the owner has locked to own-context-only. Absent or not
// listed ⇒ shareable (the default). Storing only the opt-OUTs keeps it minimal and migration-free.
privateFields: z.array(PersonFieldKeySchema).optional(),
```

Where `PersonFieldKeySchema = z.enum([...])` enumerates the **controllable** keys (single source of truth, also
used by the editor and `buildContext`):

```
'pronouns' | 'birthday' | 'gender' | 'appearanceDescription' | 'ethnicity' | 'occupation' |
'interests' | 'location' | 'goals' | 'communicationStyle' | 'values' | 'languages' |
'importantDates' | 'notes' | 'healthNotes' | 'faith'
```

`notes` is the **merged** single notes field (§3.1) — `publicNotes` + `privateNotes` collapse into one
`notes: z.string().optional()` field on `PersonSchema`, replacing both. See §4.3 for the one-line migration.

- `displayName` is **always** shared (identity; how related people refer to them) — not controllable.
- `email` / `phone` are **never** in context (delivery-only, 08) — not controllable, excluded from this model.
- A locked `birthday` means the figure's **age** is withheld from others' dream-image depiction (the only place
  birthday feeds others).

A helper `isPersonFieldShared(person, key): boolean` = `!(person.privateFields?.includes(key))` becomes the one
gate. `upsertPerson` persists `privateFields` with the same conditional-spread pattern as the other optional
fields (a field cleared from the lock-set drops, doesn't linger).

### 4.2 Dream — `informsContext`

Add one field to `DreamSchema` / `DreamInputSchema`:

```ts
// Whether this dream may inform coaching context at all (own + shareable-to-related). Default true. Replaces
// the old sensitivity-based auto-exclusion. Additive-optional; absent ⇒ true.
informsContext: z.boolean().optional(),
```

The dreamer's own context and the per-fact sharing both gate on `dream.informsContext !== false`.

### 4.3b Relationship — merged `notes` + share flag

For consistency, `RelationshipSchema` gets the **same** notes treatment as Person: `publicNotes` + `privateNotes`
collapse into one `notes: z.string().optional()` field, plus `notesShared: z.boolean().optional()` (default —
absent ⇒ shared). A relationship's only context-bearing free text is its notes (its `type` is structural and
always shown), so a single boolean suffices rather than a `privateFields`-style array. `buildContext` /
`buildLinkedPeopleContext` include the relationship's `notes` only when `notesShared !== false`. Same
`schemaVersion` bump + migration as the Person notes merge (§4.3).

### 4.3 Migration (resolved: literal flip + notes merge)

Two changes touch existing records. The app is **pre-release** (no installed users; at most the developer's own
test vault), so both land directly without a heavyweight migration runner:

- **Default flip (resolved → literal).** `privateFields` absent ⇒ every controllable item is **shared**,
  including existing `healthNotes` / `faith` / merged `notes`. There is no grandfathering; the visible per-field
  toggles let the user lock anything. (Matches the "everything shared by default" decision.)
- **Notes merge.** `publicNotes` + `privateNotes` collapse into one `notes` field. A one-time, idempotent read
  migration combines them — `notes = [publicNotes, privateNotes].map(s => s?.trim()).filter(Boolean).join('\n\n')`
  — and drops the two old keys. Because this **changes a persisted shape**, it warrants a `schemaVersion` bump on
  `Person` + a migration entry in the people migration registry (unlike the purely-additive `privateFields` /
  `informsContext`, which need none). `buildContext` reads `notes` (own context always; others' context when
  `isPersonFieldShared(person,'notes')`).

## 5. Architecture & modules

- **Core (`@selfos/core/people`)** — refactor `buildContext.ts`:
  - Replace `shareableProfileLines` / `privateProfileLines` with a single `profileLines(person, audience)`,
    `audience: 'self' | 'others'`. For `'self'`, every populated field is emitted; for `'others'`, only fields
    where `isPersonFieldShared(person, key)`.
  - `buildContext` uses `audience: 'self'` for the subject's own block and `audience: 'others'` for each related
    person. `buildLinkedPeopleContext` (dreams) uses `'others'`.
  - `buildDepictionNote` gates each part (`appearanceDescription`/`gender`/`ethnicity`/age-from-`birthday`) on
    `isPersonFieldShared`.
  - Keep `shareableProfileLines`/`privateProfileLines` as thin wrappers if other code imports them, or update
    callers — choose during build (the test suite is the guard).
- **Core (`@selfos/core/dreams`)** — `dreamInsightService.setDreamFactShare`: **remove** the
  `sensitivity !== 'standard'` → `SENSITIVE` guard. `getDreamInsight`/`listDreamShareTargets` and the dreamer's
  own-context inclusion gate on `informsContext !== false`. Confirm the dream-image flow (`dreamImageService`)
  is unaffected (image generation is a separate consent path, not the context-sharing flag).
- **Renderer** — `PersonEditor.tsx`: per-field toggle component + "Lock/Share all"; remove the fixed
  About/Private split copy; single merged Notes field. `RelationshipsEditor.tsx`: merged Notes field + a share
  toggle. `DreamComposer.tsx`: the new switch + revised sensitivity help. A small reusable `ShareToggle`
  design-system primitive (icon button + accessible label) → add to `/gallery` (DoD §12).
- **No new IPC channels** — `privateFields`, `informsContext`, and the merged `notes` ride the existing
  `people:*` and `dreams:*` upsert/save contracts (new/changed optional fields on `PersonInput` / `DreamInput`).
  No new settings are introduced (the interruptive heads-up was dropped).

## 6. IPC / API contracts

No new channels. The existing `peopleUpsert` and `dreamsSave` contracts carry the new optional fields, validated
in the bridge by the amended Zod schemas (the trust boundary stays in main). No new settings. No Claude API
change — this spec only changes _what text_ `buildContext` assembles, not how it's used.

## 7. States & edge cases

- **Field present but locked** — included in own context, excluded from others'. Verified per field key.
- **All fields locked** — a related person's block shows name + relationship type only (no descriptive lines,
  no notes); never errors.
- **Dream `informsContext` off** — approved insight excluded from own + others' context; share controls hidden;
  the dream remains fully readable/editable in the journal.
- **Sensitive dream, `informsContext` on** — shareable; per-fact controls available; image-gen warning still
  fires independently (unchanged).
- **Upgrade / old records** — `privateFields` / `informsContext` absent ⇒ §4.3 default applies; person/dream
  files written before this spec parse unchanged for `privateFields`/`informsContext` (additive-optional); the
  Person notes-merge runs its one-time registry migration (§4.3) on read.
- **Locked `birthday`** — others' dream-image depiction omits age; the owner's own image flow is unaffected.
- **Sync conflict / corrupt file** — unchanged behaviour (handled by the vault service per `00`); a malformed
  `privateFields` array fails Zod validation and the record is treated as unreadable, not silently shared.
- **Offline (no Claude)** — purely a data/context-assembly change; works fully offline.

## 8. Safety

Shareability is itself a safety/privacy surface (CLAUDE.md §1: all user content is highly sensitive). The
boundary this enforces — a locked item **never** reaches another person's AI context — must hold on every code
path; the test suite asserts it exhaustively (§10). The "everything shared by default" posture is a deliberate,
user-chosen product decision; the always-visible per-item toggles + the §3.1 inline explainer are how it's kept
honest, and per-item locks are the user's control. No crisis-routing implications beyond the existing
Dreams/Sessions behaviour; nothing here weakens the not-medical boundary or crisis handling. Health/faith content
flowing into a _related_ person's context is the most sensitive consequence — the per-field lock is the one
deliberate control the owner uses to withhold it.

## 9. Accessibility

- The per-field `ShareToggle` is a real `<button>` with an accessible name conveying both state and meaning
  (e.g. "Occupation: shared — may inform related people; activate to lock"), not icon-only/colour-only — state
  is announced as text (design-system §9). Visible focus ring; keyboard operable; `aria-pressed` for the toggle.
- The "Lock/Share all" control is a real button, keyboard reachable, announcing the resulting state.
- The Dream switch reuses the design-system `Switch` (already a11y-correct, with `flex: none` per the standing
  fix). Responsive ~360px→desktop (DoD §7/§12): the per-field toggle wraps under the label on narrow widths.

## 10. Testing strategy

- **Unit (Vitest, core):** `isPersonFieldShared` truth table; `profileLines(person,'self')` emits all populated
  fields while `'others'` emits only shared ones; **a locked field never appears in any related-person path**
  (`buildContext`, `buildLinkedPeopleContext`, `buildDepictionNote`) — the privacy-boundary assertion, one test
  per controllable key category; dream `informsContext: false` excludes the approved insight from own + others'
  context; `setDreamFactShare` now succeeds for a sensitive-tier dream; the §4.3 notes-merge migration combines
  `publicNotes`+`privateNotes` idempotently (Person **and** Relationship) and the default flip leaves all items
  shared; a relationship with `notesShared: false` keeps its notes out of `buildContext`/`buildLinkedPeopleContext`.
- **Component (Vitest + RTL):** PersonEditor renders a toggle per controllable field, default shared, flip
  persists into the `PersonInput` payload; "Lock all" flips every key; the removed-copy assertion; the single
  merged Notes field renders. DreamComposer renders the new switch, default on, payload carries `informsContext`;
  sensitive dream still shows the image-gen tier note but not the old exclusion copy.
- **E2E (Playwright):** create a person, lock `healthNotes`, relate them to the subject, open the subject's
  session → decrypt the assembled context and assert the locked note is **absent** while a shared field is
  **present**; capture + analyze + approve a sensitive dream, share a fact with a related person, assert it
  reaches that person's `summarizeForContext`; a 390px layout/overflow guard over the reworked editor sections.
- Vault + Claude mocked as established (`memFileSystem`, fake Claude client). Run `pnpm typecheck` after adding
  tests (memory: `vitest-does-not-typecheck`).

## 11. Open questions

**Resolved during spec review (2026-06-12):**

- **Migration of previously-private data** → **literal flip.** Existing health/faith/notes default to shared; no
  grandfathering (the app is pre-release, so there's no installed-user data to protect). Per-field locks are the
  control. (§4.3)
- **"Used for them" (item 10)** → **the existing analyze→approve→Insight path.** No raw dream narrative enters
  own-context. (§3.2, §4.2)
- **One-time heads-up** → **dropped.** Pre-release; the always-visible toggles + the §3.1 inline explainer
  communicate the posture. No new setting.
- **Notes fields** → **merge** `publicNotes` + `privateNotes` into one `notes` field with a `schemaVersion` bump
  - migration. (§4.1, §4.3)
- **New people default** → **all-shared**, no per-category exception.

- **`ShareToggle` placement** → **inline per-field toggle** next to each label, plus the "Lock/Share all"
  section-header control for bulk. (§3.1, §9)
- **Relationship notes** → **included.** Relationship notes get the same treatment (merge `publicNotes` +
  `privateNotes` → one `notes` field + a share flag). (§4.4)

All open questions are resolved; the spec is build-ready pending final approval.

## 12. Changelog

- 2026-06-12 — created (Draft). Package A of the 2026-06 app refresh; decisions captured in memory
  `app-refresh-plan-2026-06`.
- 2026-06-12 — Review. Resolved migration (literal flip), dream-own-context (analyze→approve path), heads-up
  (dropped — pre-release), notes (merge into one field), inline per-field toggle + bulk, and relationship notes
  (included). All open questions resolved; build-ready pending final approval.
- 2026-06-14 — Approved + built (package A). Two build-time UX decisions confirmed with the user: (1) `pronouns`
  and `birthday` get inline per-field `ShareToggle`s on the Profile tab too (they're controllable keys), and
  (2) one "Lock all / Share all" bulk control lives in the About section header and flips **every** controllable
  field across tabs. Built on `feat/shareability` off `main`.
