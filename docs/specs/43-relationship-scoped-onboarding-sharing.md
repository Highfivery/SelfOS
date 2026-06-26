# 43 — Onboarding per-question sharing (share-by-default, in the flow)

> **Status:** Built (2026-06-24) · _last updated 2026-06-26_ ·
> **Depends on [`42`](42-relationship-scoped-sharing.md).**
>
> **Amendment (2026-06-26, owner decision — share auto-saves; no confirm).** Two UX changes after the user
> reported "I pick _share with partner all_ and Save, but it doesn't save." **(1) One tap, no confirm:** the
> §3.1/§8 sensitive-share confirm is **removed** — picking a scope (per-question or the bulk "share all")
> applies on a single tap. Safety is preserved by the **default**: a sensitive answer still STARTS Private
> (its category preset), so sharing it is still a deliberate, explicit choice; it just takes effect on one tap
> instead of a second confirm. **(2) Auto-save on edit:** on a section the person has already **completed**
> (i.e. is editing), an answer or sharing change **persists immediately** (debounced, silent — `autoSaveForm`
> re-runs `intake:submitForm`), so a sharing pick saves right away with no separate button; the primary button
> becomes **"Done"**. A first-time section is unchanged — it still uses the explicit **Continue** (which is what
> marks it complete; auto-save never completes a section being filled for the first time).

> Today, onboarding answers are **own-context-only** (all intake Insight facts hardcoded
> `shareable: false`), and the only way to share anything is to finish the intake, run synthesis, then go to
> Memory and toggle individual facts — broadcasting them to _everyone_ related. This spec moves sharing
> **into the onboarding flow**: every question carries a **relationship-type sharing control**, items are
> **shared by default** per sensible category presets, the person can mark any question **private** or pick
> exactly which relationship types may use it as they answer, the **clear "informs their AI, never shown to
> them" copy** is right there, and changing an answer offers a **one-tap "refresh your portrait."**

Builds on [`42`](42-relationship-scoped-sharing.md) (the relationship-type sharing model, resolver,
presets, `RelationshipScopePicker`, confidentiality rule, transparency read) and amends
[`18`](18-personal-onboarding.md) (the intake catalog/forms/synthesis, §3.4/§3.5/§8.3/§14, the §15
freshness/staleness system it makes one-tap). Reuses the [`08`](08-questionnaires.md)/`@selfos/answering`
form renderer. References [`00`](00-architecture.md), [`01`](01-design-system.md),
[`04`](04-people-roles.md), [`15`](15-shareability.md).

---

## 1. Overview

**The problem.** The intake produces the richest data SelfOS has about a person, but it's a dead end for
the **marriage / sex-counseling** use case: nothing flows to a partner's coaching by default, and the only
escape hatch (Memory, post-synthesis) **broadcasts to every related person** — so a person can't safely say
"my partner's AI can use this, but not my coworker's." Sharing decisions also happen **far from the moment
of answering**, where context is lost.

**The change.** Bring sharing into the intake, per the [`42`](42-relationship-scoped-sharing.md) model:

1. **Per-question relationship-type control.** Each onboarding question shows a compact
   `RelationshipScopePicker` ([`42`](42-relationship-scoped-sharing.md) §3.1) — a chip
   (`Shared: Partner` / `Private` / …) that opens a relationship-type chooser.
2. **Share by default, by category.** Each question is **pre-set** from the
   [`42`](42-relationship-scoped-sharing.md) §4.3 presets (partner → everything; close family/friends →
   all but intimacy & trauma; coworker → basics/work/values; ex/other → nothing). Most questions need **zero
   interaction**; the person adjusts only what they care about.
3. **Bulk per-section control.** A section header "Sharing for this section" picker flips every question's
   scope at once (with a per-question override remaining possible) — so a person can lock a whole sensitive
   section in one move.
4. **Honest copy in place.** The [`42`](42-relationship-scoped-sharing.md) §3.2 "informs their AI, never
   shown to them" explainer sits on the onboarding surface and in the picker.
5. **Both answers and facts flow.** The chosen scope is stored on the intake session (`answerSharing`) and
   propagated to the **distilled facts** at synthesis, so both the raw answer and the AI's interpretation
   share per the person's choice ([`42`](42-relationship-scoped-sharing.md) §5.2 reads them).
6. **One-tap re-analysis.** When an answer changes, an inline "answers changed — refresh your portrait"
   action appears right where the person edits (the existing [`18`](18-personal-onboarding.md) §15 staleness
   banner + Home nudge stay).

## 2. Goals / Non-goals

**Goals**

- A **per-question** relationship-type sharing control in the onboarding form, defaulted by category, with
  a **per-section bulk** control.
- **Share-by-default** per the [`42`](42-relationship-scoped-sharing.md) presets — flipping today's
  own-only intake to shared-where-sensible, with the person in control.
- **Propagate the per-question scope to both** the stored answer (`answerSharing`) **and** the synthesized
  facts (`shareableTypes`), so [`42`](42-relationship-scoped-sharing.md)'s context read shares both.
- **Clear, in-context "shared ≠ shown" copy** so a person understands sharing informs a partner's AI, not
  reveals their answers.
- A **one-tap "refresh portrait"** affordance at the edit point, complementing the existing staleness nudges.
- **Safety-first** — intimacy/trauma keep their `restricted` status and default to **partner-only** scope
  (never broadcast); the 18+ gate, skippability, and trauma-informed framing are unchanged.

**Non-goals (deferred / out of scope)**

- **The sharing model, resolver, presets constant, picker control, and confidentiality rule** — those are
  [`42`](42-relationship-scoped-sharing.md); this spec **consumes** them.
- **The Memory transparency/stats/flag surfaces** — those are [`44`](44-memory-dashboard-overhaul.md).
- **Sharing on People/dreams/questionnaires** — this spec covers the **onboarding** producer; the same
  model is available to others later (out of scope here).
- **Auto-applying scope to existing Insight facts of other producers** — only intake facts are re-tagged at
  intake synthesis.
- **A mutual-accept handshake** — relationship-is-enough ([`42`](42-relationship-scoped-sharing.md) §2).

## 3. UX & flows

### 3.1 The per-question control (in the form)

In the `@selfos/answering` `QuestionnaireForm` question card (the `QuestionField` component), add a
**sharing control slot** in the question header row, right-aligned beside the prompt:

- A `RelationshipScopePicker` ([`42`](42-relationship-scoped-sharing.md) §3.1) bound to that question's
  scope. Collapsed chip: `Shared: Partner` / `Shared: Partner, Family` / `Private`.
- The picker is **rendered only in onboarding** (the form takes a new optional `sharing` prop — questionnaires
  pass nothing, so their forms are unchanged).
- Defaults come from the question's **category** (mapped from the intake section/life-area →
  `SHARING_PRESets`); the person sees the default already applied and adjusts only if they want.
- For a **restricted** (intimacy/trauma) question, the chip reads `Private (sensitive)` until the person
  opts it into sharing; choosing a type both **un-restricts that answer's derived facts for sharing** and
  scopes them (the deliberate two-step from [`42`](42-relationship-scoped-sharing.md) §8, made one gesture
  here with a clear confirm: _"This is sensitive — share it with your Partner's coaching?"_).

### 3.2 The per-section bulk control

At the top of each section's form (and on the section card), a **"Sharing for this section"** control:

- Sets every question in the section to a chosen scope at once (e.g. lock the whole "What weighs on you"
  section to `Private`, or open the whole "Joy & play" section to `Partner, Family, Friends`).
- A per-question override still wins (the bulk control sets, the question can re-set). A small "mixed"
  state on the bulk chip when questions differ.

### 3.3 The honest explainer

The onboarding surface carries the [`42`](42-relationship-scoped-sharing.md) §3.2 explainer once, near the
first sharing control the person meets:

> _"As you answer, you choose who this can help. **Sharing** lets the people you pick (like your partner)
> have your answers **inform their AI coaching** — for couples or intimacy coaching, say. They **never see
> your answers**, and their coach won't repeat them back. **Private** keeps an answer to your own coaching."_

### 3.4 Share-by-default behaviour

- A brand-new intake **pre-fills** each question's scope from its category preset
  ([`42`](42-relationship-scoped-sharing.md) §4.3). Filling a question with no interaction ⇒ it shares per
  its preset.
- The person can flip any question to `Private` or a narrower/wider type set; the choice persists on
  `answerSharing` immediately (per answer, like the answer itself).
- **Skipping** a question shares nothing (no answer). **Clearing** an answer drops its sharing.

### 3.5 One-tap refresh after an edit

When the person edits an already-answered question (the intake is a living, editable profile,
[`18`](18-personal-onboarding.md) §14.11) such that `portraitStaleness` becomes non-zero, the form shows an
inline, calm **"You changed some answers — refresh your portrait"** button right there (in addition to the
existing [`18`](18-personal-onboarding.md) §15.4 staleness banner + Home `OnboardingCard` review nudge). One
tap runs `intake:synthesize` (the existing portrait pass; budget-gated; calm AI-off/over-budget states). It
**never auto-spends** — it's one explicit tap (the guided-sessions "never auto-spend" rule).

### 3.6 Happy path

1. A member fills "The basics" — each field's chip already reads `Shared: Partner, Family, Friends`
   (preset). They leave them.
2. In "Health & wellbeing," the sleep/stress fields default `Shared: Partner`; they lock "mental-health
   diagnoses" to `Private` with one tap on its chip.
3. They open the 18+ intimacy block; every question defaults `Private (sensitive)`. For "love languages"
   and "what turns you on" they tap → confirm → `Shared: Partner`. The rest stay private.
4. They generate the starter portrait; synthesis tags the derived facts with the same scopes.
5. Their partner has a session later; the partner's coach **uses** the shared intimacy/health facts to
   personalize (couples/sex coaching) but **never repeats them** ([`42`](42-relationship-scoped-sharing.md)
   §3.4). The member can see exactly what they share in Memory ([`44`](44-memory-dashboard-overhaul.md)).
6. Weeks later they change their relationship status; the form shows "refresh your portrait" → one tap.

## 4. Data model (vault files & schemas)

All via the vault/crypto service. **Additive-optional — no `schemaVersion` bump** (the
[`18`](18-personal-onboarding.md) §14.9 precedent).

- **`IntakeSection.answerSharing`** — defined in [`42`](42-relationship-scoped-sharing.md) §4.2
  (`Record<questionId, RelationshipType[]>`). This spec **writes** it (on `submitSectionForm`), defaulting
  unset questions from the category preset at submit and storing the resolved scope explicitly.
- **Synthesized fact tagging.** `synthesizePortrait` sets each fact's `shareableTypes`
  ([`42`](42-relationship-scoped-sharing.md) §4.1) from the scope of the question(s)/section the fact
  derives from. Because fact↔question attribution is imperfect, the rule (resolved §11): a fact inherits the
  **intersection** (most restrictive) of the scopes of the answers in its source section, falling back to
  the **section's** bulk scope; a `restricted` fact stays `restricted` (never `shareableTypes`-shared)
  **unless** the person explicitly opted its question into sharing (then synthesis emits a non-restricted,
  type-scoped fact for that answer's content). This keeps the per-question control honest for the **answer**
  path (exact) and conservative for the **fact** path (most-restrictive).
- **Category mapping.** A pure `questionCategory(sectionId, questionId) → SharingCategory` (used to pick the
  preset). The intake catalog (`IntakeFormQuestion`) gains an optional per-question `category?` override
  (else the section's category); additive.
- **No new files.** Everything rides the existing `people/<id>/intake/session.enc` + the portrait Insight.

## 5. Architecture & modules

- **Core (`@selfos/core/intake`)** —
  - `submitSectionForm` accepts a `sharing: Record<questionId, RelationshipType[]>` alongside `answers`,
    resolves unset questions from `SHARING_PRESETS` ([`42`](42-relationship-scoped-sharing.md)), and writes
    `IntakeSection.answerSharing`.
  - `synthesizePortrait` tags facts' `shareableTypes` per §4 (most-restrictive-of-section, restricted stays
    restricted unless opted in), carrying prior choices forward on re-synthesis (the existing carry-forward).
  - A pure `defaultScopeForQuestion(sectionId, questionId)` over the catalog + presets (tested).
- **`@selfos/answering`** — `QuestionnaireForm`/`QuestionField` gain an optional `sharing` prop:
  `{ scopeOf(questionId), setScope(questionId, types), availableTypes }`; when present, render the
  `RelationshipScopePicker` per question + the section bulk control. Absent ⇒ unchanged (questionnaires).
- **Renderer (`routes/onboarding`)** — `IntakeFormPanel` wires the per-question + per-section scope state
  (seeded from `answerSharing` or presets), passes `sharing` to the form, includes the explainer, and the
  one-tap "refresh portrait" affordance; passes `sharing` to `intake:submitForm`. `intakeStore.submitForm`
  carries the `sharing` map. The available relationship types come from the person's graph (so the picker
  only offers types that exist) — or the full set if none yet, with a hint to add relationships in People.
- **No new nav/route.**

## 6. IPC / API contracts

- **`intake:submitForm`** — extended to carry `{ sectionId, answers, sharing }` (`sharing` additive). The
  bridge validates (Zod) + active-person-scopes (the trust boundary) and persists `answerSharing`. Gated
  `intake.own`.
- **`intake:synthesize`** — unchanged signature; now tags `shareableTypes` (server-side, from the trusted
  catalog scope + `answerSharing`, never the model).
- **`memory:outboundSharing`** — consumed (defined in [`42`](42-relationship-scoped-sharing.md)) if the
  onboarding surface shows an inline "what you're sharing" summary (optional; the full surface is in
  [`44`](44-memory-dashboard-overhaul.md)).
- **Claude API** — synthesis unchanged in shape; the scope tagging is host-side. The key stays in main.

## 7. States & edge cases

- **Question unset (no interaction)** → shares per category preset; the chip shows the default so it's never
  a hidden share.
- **No relationships yet** → the picker offers the full type set with a gentle "add people you relate to in
  People to use these" hint; scopes are stored and take effect once a matching relationship exists
  ([`42`](42-relationship-scoped-sharing.md) resolves at read).
- **Restricted question opted into sharing** → a clear confirm; the derived fact is emitted non-restricted +
  type-scoped for **that answer only**; everything else in the restricted section stays restricted/private.
- **Bulk section scope vs per-question override** → per-question wins; bulk chip shows "mixed" when they
  differ.
- **Edit after synthesis** → `portraitStaleness` > 0 → inline refresh affordance (§3.5); scope changes alone
  (no answer change) also re-tag on the next synthesis.
- **Skipped/cleared** → no answer, no sharing.
- **Re-synthesis** → fact scopes carried forward; new/edited answers re-tagged per current `answerSharing`.
- **AI off / over budget** → the form + scope controls work fully (no AI); only synthesis/refresh needs AI →
  calm states.
- **Migration / pre-spec session** → `answerSharing` absent ⇒ answers default to their category preset on
  next submit; existing intake facts (own-only) stay own-only until re-synthesized (no surprise broadcast).
- **Per-person isolation / sync conflict / corrupt** → standard vault behaviour; a corrupt `answerSharing`
  fails closed (own-only).

## 8. Safety, privacy & honesty

- **Sensitive defaults are partner-only** — intimacy/trauma never default to friends/family/coworker
  ([`42`](42-relationship-scoped-sharing.md) §4.3); opting them into sharing is an explicit, confirmed act,
  and even then only the answers the person chooses.
- **Restricted stays restricted by default** — a restricted fact is shared only when the person explicitly
  opts its question in; the [`18`](18-personal-onboarding.md) §8.4 own-context-only invariant holds for
  everything not opted in.
- **"Shared ≠ shown"** — the [`42`](42-relationship-scoped-sharing.md) §3.4 confidentiality preamble governs
  how recipients' coaches use shared content; the §3.3 copy sets the expectation honestly at the moment of
  choosing.
- **No dark patterns** — `Private` is always a first-class, equal option; the default is shown, never hidden;
  bulk-lock a section in one move.
- **Not-medical / crisis / 18+** — unchanged ([`18`](18-personal-onboarding.md) §8/§14.10); the trauma-informed
  framing and crisis footer remain on every onboarding surface.
- **Accepted residual (model attribution).** Fact↔question attribution comes from the model's echoed section
  ref. The conservative tagging (§4) bounds the blast radius — a normal-block fact only ever inherits the
  **non-restricted** questions' scopes (the candidate split mirrors `formAnswersMessages`), and a restricted
  fact stays own-only unless its restricted answers were opted in. The residual: if the model misattributes a
  sensitive answer's content to the **base** (non-sensitive) section ref, that fact would inherit the base
  section's (capped, non-broadcast) scope rather than staying restricted. This is bounded (preset, never
  broadcast), low-likelihood (restricted answers are sent only under the "(sensitive)" sub-block header), and
  the answer path is exact regardless — a known, accepted limit, not a silent one. A per-fact model-cited-source
  refinement (§11) is the future hardening if attribution proves unreliable.

## 9. Accessibility

Per [`01`](01-design-system.md) §9: the per-question picker + section bulk control are keyboard-operable
labelled buttons/popovers (state in text, not colour); the picker reuses
[`42`](42-relationship-scoped-sharing.md) §3.1's a11y. The form layout stays single-column at ~360px with
the sharing chip wrapping under the prompt (no overflow — the §12 DoD inner-scroll guard; the chip is
`flex: none`). The "refresh portrait" affordance is a labelled button; the explainer is text. Reduced-motion
respected.

## 10. Testing strategy

- **Unit (core):** `submitSectionForm` writes `answerSharing`, defaulting unset questions from the preset;
  `synthesizePortrait` tags facts' `shareableTypes` (most-restrictive-of-section; restricted stays restricted
  unless opted in; opted-in restricted answer → a non-restricted type-scoped fact); `defaultScopeForQuestion`
  is correct per category; re-synthesis carries scopes forward.
- **Component (RTL):** the onboarding form renders a `RelationshipScopePicker` per question (default chip
  matches preset), a section bulk control (sets all; per-question override shows "mixed"); the explainer
  renders; a restricted question shows `Private (sensitive)` + the share confirm; the "refresh portrait"
  affordance appears after an edit; a questionnaire form (no `sharing` prop) is unchanged.
- **E2E (Playwright):** complete onboarding scoping the intimacy "love languages" answer to `partner`; relate
  the member to a partner B and a sibling C; **decrypt** the intake session to assert `answerSharing`; open
  B's session → assert the shared answer + a derived fact appear in B's context and the confidentiality
  preamble is present; open C's session → assert they're **absent**; edit an answer → the "refresh portrait"
  affordance → re-synthesize. 360px overflow + control-geometry guards on the form with pickers.
- Vault + Claude mocked as established; decrypt to assert data. Run `pnpm typecheck` after tests.

## 11. Open questions

_Resolved ask-first (2026-06-23):_

- **Granularity** → **per-question** control (defaulted by category) **plus** a per-section bulk control.
- **Default presets** → the [`42`](42-relationship-scoped-sharing.md) §4.3 matrix.
- **What flows** → **both** the stored answer (`answerSharing`) **and** the distilled facts
  (`shareableTypes`).
- **Re-analysis** → a **one-tap "refresh portrait"** at the edit point + keep the existing staleness nudges.
- **Sensitive** → intimacy/trauma default **partner-only / private-sensitive**; opt-in is explicit + confirmed.

_Build-time tuning:_ the fact↔question attribution rule (the §4 "most-restrictive-of-section" choice vs.
asking the model to cite a source question id per fact) is finalized at build — the conservative
section-intersection is the default; a model-cited-source refinement is a possible enhancement if attribution
proves reliable. The exact per-category mapping + the section-bulk "mixed" UX detail are tuned with the
[`42`](42-relationship-scoped-sharing.md) preset constant.

## 12. Changelog

- 2026-06-24 — **Fix — share-by-default backfill + inline picker confirm** (`fix/onboarding-sharing-end-to-end`,
  user-reported). Two bugs: **(a)** share-by-default never reached EXISTING portraits — `factScopeForSection`
  - the answer readers returned `[]` for a section with no `answerSharing` (only written on (re-)submit), so a
    portrait from before this spec showed everything Private. Fixed with a pure `effectiveAnswerScope` that
    backfills a **missing** entry for an _answered_ question to its category default (explicit choice incl.
    explicit `[]`=Private still wins; restricted defaults `[]`), used by synthesis (§4) + the shared-answer
    context + the transparency read. **(b)** The sensitive-share confirm (§3.1) rendered as a top-of-section
    Banner far from the picker → "nothing happened"; it now renders **inline in the question's (or bulk) sharing
    slot**, replacing the picker. Tests: `effectiveAnswerScope` units + a pre-spec backfill integration + an E2E
    reproducing a pre-spec portrait → partner context + Sharing summary reflect it.
- 2026-06-24 — **BUILT** (on `feat/onboarding-scoped-sharing`). As-built notes: **(1)** `@selfos/answering`
  stays free of the app design-system, so the `sharing` prop is a **render-prop** `{ renderControl(questionId)
}` (not `{ scopeOf, setScope, availableTypes }`) — the onboarding host (`IntakeFormPanel`) renders the actual
  `RelationshipScopePicker` and owns the scope state, picker, bulk control, explainer, sensitive-confirm, and
  the one-tap refresh. **(2)** New pure `@selfos/core/intake/sharingCategory.ts` —
  `SECTION_SHARING_CATEGORY` map + `questionCategory`/`questionDefaultsPrivate`/`defaultScopeForQuestion`;
  `IntakeFormQuestion.category?` added (additive). **(3)** `submitSectionForm(…, sharing?)` writes
  `IntakeSection.answerSharing`, defaulting every answered question from its preset (restricted ⇒ Private).
  **(4)** `synthesizePortrait` tags each fact's `shareableTypes` via `factScopeForSection` — the
  most-restrictive INTERSECTION of the section's per-question scopes, read **only** from the explicit
  `answerSharing` (a pre-spec section that's merely re-synthesized stays own-only — no surprise broadcast, §7);
  the normal-vs-"(sensitive)" candidate split mirrors `formAnswersMessages` so a private sensitive answer never
  drags a section's ordinary facts to own-only (or vice-versa); a `restricted` fact stays restricted unless its
  answers were opted in (then non-restricted + type-scoped). **(5)** The promoted profile field (e.g.
  `occupation`) keeps its **independent** spec-15 field-share (shared to all related by default) — spec 43 only
  governs the intake answer + the derived fact; the E2E asserts the spec-43 signal via the FACT text + the
  confidentiality preamble, not the bare promoted value. Tests: core (`sharingCategory` + `submitSectionForm`
  answerSharing + `synthesizePortrait` tagging incl. most-restrictive / restricted-stays / opted-in / no-
  answerSharing-own-only), a bridge round-trip (IPC carries scope → partner sees the fact, sibling doesn't),
  RTL (per-question chips defaulted by preset, section bulk + "Mixed", sensitive-confirm, refresh affordance),
  and an E2E (scope basics → Partner → decrypt `answerSharing` + the fact's `shareableTypes` → partner's
  context has the fact behind the preamble, the sibling's has neither; 360px overflow guard). Amends
  [`18`](18-personal-onboarding.md) and reuses the [`08`](08-questionnaires.md)/`@selfos/answering` form.
- 2026-06-23 — created (Draft). The onboarding half of the relationship-sharing group; depends on
  [`42`](42-relationship-scoped-sharing.md). Decisions resolved ask-first (2026-06-23): per-question control
  - section bulk, share-by-default per the §4.3 presets, both answers + facts flow, one-tap re-analysis,
    intimacy/trauma partner-only default. Amends [`18`](18-personal-onboarding.md) (§3.4/§3.5/§8.3/§14/§15) and
    reuses the [`08`](08-questionnaires.md)/`@selfos/answering` form. Build-ready pending final approval.
