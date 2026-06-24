# 37 — AI output robustness & honest failures

> **Status:** Built — _last updated 2026-06-23_
>
> A whole class of SelfOS bugs comes from brittle handling of Claude's JSON output: an all-or-nothing
> `safeParse` that drops a good batch over one bad element, a strict `.parse` that nukes an
> otherwise-perfect result over one off-spec field, and error messages that blame the user's data when
> the real cause was a parse failure, a truncation, or a content refusal. This spec makes every
> model-output parse **tolerant** and every failure **honest**, app-wide, via one shared pattern (and,
> pending the §11 decision, one shared `@selfos/core` utility). It also fixes the reported gap-finder
> bug as part of the work.

This is the first of a five-spec group:

- **37 — AI output robustness & honest failures** (this spec)
- **38 — questionnaire lifecycle** (consumes the honest failure-reason taxonomy on send/results surfaces)
- **39 — living memory** (reconcile/flag/dashboard — its analysis parses follow this spec)
- **40 — proactive coaching** (new AI-JSON producers must adopt this pattern from day one)
- **41 — first-run & discoverability** (surfaces the calm AI-not-configured / connectivity states)

This is a **backend-heavy** spec. There is no new screen and no new vault file — almost all changes
are in `@selfos/core` services plus **better, distinct messages** on existing surfaces (Sessions,
Dreams, Questionnaires builder/Results/Suggested, Memory, onboarding portrait). §3 is written
developer-facing (the "UX" is the wording of the honest failures) and §9 notes the no-new-UI scope.

---

## 1. Overview

SelfOS asks Claude to return structured JSON in ~9 places: questionnaire **generation**, per-question
**improve**, compatibility **variant** generation, the gap-finder **suggestions**, questionnaire
**analysis**, compatibility **alignment**, context-only **distillation**, **session analysis**, **dream
synthesis**, memory **reconcile**, and the onboarding **portrait** synthesis. Each parses the model's
reply and turns failure into a user-facing message.

Today these parsers are inconsistent:

- The **portrait** path (`packages/core/src/intake/intakeService.ts`) is the **gold standard** — its
  `PortraitDraftSchema` puts `.catch(...)` on every optional field (require only `portrait`),
  `salvageTruncatedPortrait` recovers the summary + complete facts from a truncated reply, and it emits
  **distinct** "cut off" vs "unexpected shape" messages (lines ~555–589, ~509–551, ~931–957).
- **Generation** (`generationService.ts`) is partly tolerant — it falls back from a `{title,questions}`
  object to a legacy bare array, drops malformed questions in `toQuestion`, and distinguishes a cut-off
  draft from a no-JSON reply (lines ~222–262). Good, but not its sibling calls.
- The **strict / brittle** parsers nuke the whole result on any imperfection and emit a misleading
  message:
  - **gap-finder** (`gapFinderService.ts`) — `z.array(QuestionnaireSuggestionSchema).safeParse(...)` is
    **all-or-nothing**, and `QuestionnaireSuggestionSchema` (`schemas.ts` ~951–958) requires
    `required: z.boolean()` on **every** sample question, which the model routinely omits → the **whole**
    parse fails → `[]` → the message **"No suggestions right now — add more about the people in your
    life."** This fires **after a successful Claude call** (the model replied; the code threw it away),
    and it blames the user's **data** for a **parse** problem. **This is the reported bug.**
  - **questionnaire analysis** (`analysisService.ts` ~84–92) — `AnalysisSchema.safeParse` → fail emits
    "Couldn't analyze those answers." (a parse failure read as inability).
  - **compatibility alignment** (`alignmentService.ts` ~149–156) — `AlignmentAiSchema.safeParse` → fail
    emits "Couldn't align these responses." (`items`/`facts` are all-or-nothing arrays).
  - **context-only distill** (`alignmentService.ts` ~270–273) — `ContextOnlyDistillSchema.safeParse` →
    "Couldn't distil those answers."
  - **session analysis** (`sessionAnalysisService.ts` ~230–239) — strict `SessionAnalysisDraftSchema.parse`
    in a `try/catch` → "The summary came back in an unexpected shape." (a refusal or a truncation is
    indistinguishable from a malformed-shape error here).
  - **dream synthesis** (`dreamAnalysisService.ts` ~308–317) — strict `DreamAnalysisDraftSchema.parse`
    → "The analysis came back in an unexpected shape."
  - **reconcile** (`reconcileService.ts` ~156–164) — `ReconcileOpsSchema.safeParse` → "The refresh came
    back in an unexpected shape." (better, but still no refusal/truncation distinction).
  - **variant** (`generationService.ts` ~310–318) — array `safeParse` with a length check → "Couldn't
    personalize this questionnaire."

A second, related failure: **content refusals look identical to parse errors.** A genuine policy
refusal currently funnels into the same generic message as a malformed shape. The user can't tell "the
model declined" from "the JSON was off" from "it got cut off". (Per CLAUDE.md §6 and the
`adaptive-thinking-shares-maxtokens` lesson, a "no usable output" is far more often token starvation /
truncation / a parse drop than a real refusal — so we must label them distinctly.)

This spec standardizes both: tolerant parsing everywhere + an honest, distinct failure reason +
message per cause. It sits behind every AI surface; it touches no permissions and adds no nav.

Related: `06-ai-usage-and-budgets` (meter-before-parse), `28-portrait-synthesis-optimization`,
`18-personal-onboarding` §17.9 (the thinking-budget fix), `20-memory-dashboard` (reconcile),
`08-questionnaires` §13/§17 (generation/variant/analysis/alignment/suggest).

## 2. Goals / Non-goals

**Goals**

- **One tolerant model-JSON parsing approach**, used at every call site: per-element salvage (drop only
  the bad element, never the whole batch), `.catch` defaults on optional fields, **require only the
  essential field(s)**, and a balanced-brace/array salvage for truncation (generalize the portrait
  salvage).
- **An honest failure-reason taxonomy** distinguishing, at minimum: `NO_KEY`, `BUDGET`, `REFUSED`
  (genuine policy refusal — detect refusal-shaped prose), `TRUNCATED` (cut off — "try again"),
  `MALFORMED` (a reply arrived but no usable JSON could be salvaged), and `ERROR` (transport). Each maps
  to a **distinct, honest** user-facing message. **Never** report a parse/refusal/truncation as a data
  problem.
- **Apply across all model-JSON call sites** listed in §1 (gap-finder, generation, improve, variant,
  analysis, alignment, context-only distill, session analysis, dream synthesis, reconcile, portrait —
  confirm portrait already conforms, fold in only what's missing).
- **Fix the gap-finder bug fully** within this spec (loosen the schema + per-element salvage + honest
  message), not as a separate quick patch (user decision).
- **Preserve "meter before parse"** everywhere (a paid call whose JSON fails is still billed) — verify
  each path; flag any that don't.
- **Tests exercise imperfect output** — JSON missing a required field, an out-of-enum value, one bad
  element among good ones, a truncated reply, and a refusal string — asserting graceful salvage + the
  correct distinct reason/message. Offline fakes are updated so they don't only return perfect JSON.

**Non-goals**

- **No prompt rewrites to "fix" failures.** Per the `adaptive-thinking-shares-maxtokens` /
  `always-ask-never-assume` lessons, a "no output" is usually mechanical, not a refusal — we make the
  handling honest, we do not weaken any prompt's register. (The `extendedThinking: false` rule on
  bounded JSON calls already exists; this spec keeps it.)
- **No automatic retries beyond at most one bounded retry on `TRUNCATED`** (and only if §11 approves it).
  No retry on `REFUSED`/`MALFORMED`/`ERROR` (would just re-spend).
- **No new vault file, no new IPC channel, no new capability, no new nav.** The IPC contracts already
  carry `reason` + `message`; this spec only widens the reason taxonomy and improves the strings.
- **No change to the privacy boundaries** of any call site (e.g. the gap-finder's structured-context-only
  rule, the variant's shareable-facts-only target context). Salvage operates on the model's reply, not on
  what we send it.
- **Not** a generic "any model output" framework — scope is the structured-JSON producers in §1. Free
  prose streaming (chat turns, the dream/intake interview turns) already degrades gracefully (the text is
  shown as-is) and is out of scope except where it shares the `runClaude` failure shape.

## 3. UX & flows (developer-facing API + the honest-failure wording)

There is no new screen. The user-facing change is **which message they see when AI output fails**, on
the surfaces that already render `result.message`. The developer-facing change is a shared parsing API.

### 3.1 The shared parsing approach

Every structured-JSON service follows this pipeline (the portrait path already does; the others adopt
it):

1. **`runClaude` / `client.stream`** → on transport throw, return `ERROR`; on no key, `NO_KEY`; over
   budget, `BUDGET` (these already exist in `runClaude`).
2. **Meter immediately** (record the `UsageEvent`) — before any parse.
3. **Extract + salvage** the JSON from `result.text` via the shared helper (see §5):
   - strip code fences,
   - try a whole-reply `JSON.parse` of the first balanced object/array,
   - on a parse throw, attempt a **balanced-brace/array salvage** that recovers complete top-level
     elements and skips a truncated trailing one (generalizing `salvageTruncatedPortrait`).
4. **Validate tolerantly** with a Zod schema that:
   - **requires only the essential field(s)** (e.g. `summary`, or `portrait`, or a suggestion's
     `title` + non-empty `questions`),
   - puts **`.catch(<default>)`** on every optional field,
   - wraps each **array element** in `.catch(...)` so one bad element becomes a droppable sentinel
     (e.g. `{ text: '' }`), and then **filters the sentinels out** — so one bad question/fact/suggestion
     never discards the rest.
5. **Classify the outcome** into the §3.2 taxonomy and return the matching honest message.

The principle (a documented CLAUDE.md lesson): **a strict `.parse` on a model reply is the wrong
contract** — one off-spec optional field, or one bad element in a batch, must never throw away an
otherwise-usable result, and the parse boundary must own a balanced-brace salvage for truncation.

### 3.2 The failure-reason taxonomy (the honest messages)

`AiFailureReason` (`schemas.ts` ~962) is widened to:

| reason      | when                                                                                       | message intent (exact wording → §11)                           |
| ----------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `NO_KEY`    | no API key resolved                                                                        | "Add your Claude API key first." (existing)                    |
| `DENIED`    | capability/policy denied at the host (existing, kept)                                      | existing                                                       |
| `BUDGET`    | person or app budget over for the period                                                   | "AI budget reached for this period." (existing)                |
| `REFUSED`   | the reply is **refusal-shaped prose** (no JSON, and the text reads as a decline)           | honest "the model declined / couldn't help with this one"      |
| `TRUNCATED` | the reply began JSON but was **cut off** (salvage recovered nothing usable, or partial)    | "…was cut off before it finished. Please try again." (a retry) |
| `MALFORMED` | a reply arrived but **no usable JSON** could be salvaged, and it is **not** refusal-shaped | honest "came back in an unexpected shape. Please try again."   |
| `ERROR`     | transport throw                                                                            | "…failed. Please try again." (existing)                        |

Notes:

- **`REFUSED` keeps its name but changes its meaning** in some call sites: today several paths return
  `REFUSED` for _any_ unparseable output (gap-finder, analysis, alignment, distill, variant). After this
  spec, `REFUSED` means a **detected refusal**, and a plain parse miss is `MALFORMED` / `TRUNCATED`. This
  is the core honesty fix — "no output" was being mislabeled as a refusal (the exact mistake the
  2026-06-16 revert warns against).
- **Refusal detection is conservative and last-resort** (§5.3): we classify `REFUSED` only when there is
  **no salvageable JSON** _and_ the prose matches a small set of refusal patterns; otherwise an
  unparseable reply is `MALFORMED` (or `TRUNCATED` if it looks cut off). We never assume a refusal as the
  first explanation.
- The `*Result` interfaces (`QuestionnaireSuggestResult`, `QuestionnaireGenerateResult`,
  `QuestionnaireAnalyzeResult`, `AlignmentResult`, `ContextOnlyResult`, `SessionSummaryResult`,
  `DreamSynthesisResult`, `MemoryReconcileResult`, `IntakeSynthesisResult`) already expose `reason?` +
  `message?`; they gain the new reason values via the widened `AiFailureReason` (or their per-service
  unions). Consuming surfaces only need to render `message` (no consumer logic change required), but §38
  may key send/results affordances off the richer `reason`.

### 3.3 The gap-finder fix (the reported bug, end-to-end)

1. **Loosen the schema** — `QuestionnaireSuggestionSchema.questions[].required` becomes
   `z.boolean().optional()` (the model omits it; `required` is not essential to a _suggestion_). A
   suggestion's essential fields are `title` + at least one usable question.
2. **Per-element salvage** — replace the all-or-nothing
   `z.array(QuestionnaireSuggestionSchema).safeParse(...)` with the shared tolerant-array parse: each
   element is `.catch`-wrapped and bad ones are dropped, so a malformed 2nd suggestion still yields the
   1st and 3rd. (§11 decides whether a 1-of-3 partial set is shown or treated as a miss.)
3. **Honest message** — when **zero** usable suggestions survive _and the call succeeded_, return
   `MALFORMED` (or `TRUNCATED`/`REFUSED` per detection), **not** a data-blaming message. The "add more
   about the people in your life" copy is reserved for the **genuinely empty-context** case (the model
   was given nothing to work with) — see §11 for whether to keep that distinct branch.

### 3.4 Surfaces that render the improved messages

- **Questionnaires → Suggested** (`SuggestedPanel`) — the gap-finder message (the bug's surface).
- **Questionnaires builder → Draft with AI** — generation / improve / variant messages.
- **Questionnaires → Results** — analysis / alignment / context-only messages.
- **Memory → Refresh memory** — reconcile message.
- **Sessions → Complete & summarize / wrap-up** — session-analysis message.
- **Dreams → Create analysis** — dream-synthesis message.
- **Onboarding → See my portrait** — portrait message (already honest; kept).

Each already shows the calm AI-off / over-budget states (per `31-ai-required`); this spec only sharpens
the **failure-after-a-successful-call** messages.

## 4. Data model (vault files & schemas)

- **Files:** N/A — this spec owns no vault file. It changes in-memory parse logic and a few Zod schema
  definitions; no persisted format changes, so **no `schemaVersion` bump and no migration**.
- **Schemas (Zod — source of truth):**
  - **Widen** `AiFailureReason` (`schemas.ts`) to add `'TRUNCATED'` and `'MALFORMED'`
    (`'NO_KEY' | 'DENIED' | 'BUDGET' | 'REFUSED' | 'TRUNCATED' | 'MALFORMED' | 'ERROR'`). All `*Result`
    interfaces inherit the new members. Per-service unions that extend it (`QuestionnaireAnalyzeResult`'s
    `| 'NO_RESPONSE'`, `MemoryReconcileResult`'s `| 'AI_OFF' | 'NOTHING_TO_DO'`, alignment's `NOT_READY`,
    session's `MEMORY_DISABLED`/`NOT_FOUND`) are preserved.
  - **Loosen** `QuestionnaireSuggestionSchema.questions[].required` → `z.boolean().optional()` (the
    gap-finder fix). This is a _looser_ validator over a model reply, not a persisted shape — nothing
    stored changes.
  - **Convert the strict draft schemas to tolerant ones** — `SessionAnalysisDraftSchema`,
    `DreamAnalysisDraftSchema`, `AnalysisSchema`, `AlignmentAiSchema`, `ContextOnlyDistillSchema`,
    `ReconcileOpsSchema`, the variant array schema, and `GeneratedSetSchema` — following the
    `PortraitDraftSchema` pattern: require only the essential field(s); `.catch` every optional;
    `.catch`-wrap each array element and filter sentinels. (Each schema keeps its _meaning_ — e.g.
    session analysis still requires `summary`; alignment still requires `summary` + at least one usable
    item/fact — but stops being all-or-nothing.)
  - The shared helper(s) (§5) are exported from `@selfos/core` with inferred TS types
    (`z.infer`/explicit), validated at the parse boundary like every other core schema.
- **Ownership:** unchanged — all reads/writes still go through the vault service; this spec only changes
  how a model **reply string** is parsed before the (existing) writes.

## 5. Architecture & modules

A backend refactor inside `@selfos/core`. No feature module, no nav/route/settings registration.

### 5.1 Shared parsing utility (`@selfos/core`, pending §11)

A new module — proposed `packages/core/src/ai/jsonSalvage.ts` (name TBD) — exporting:

- **`extractJsonObject(text): unknown | null`** and **`extractJsonArray(text): unknown | null`** — the
  fence-stripping, brace-slicing extractors that already exist (duplicated today in
  `generationService.ts`, `analysisService.ts`, `reconcileService.ts`, and as throwing variants in
  `intakeService.ts`/`sessionAnalysisService.ts`/`dreamAnalysisService.ts`). Consolidate to **one**
  non-throwing implementation (return `null` on no-JSON; never throw — the callers branch on `null`).
- **`salvageJsonArray(text): unknown[]`** — the balanced-brace scanner generalized from
  `salvageTruncatedPortrait`: walk the first top-level `[`, collect every **complete** `{...}` element
  via depth tracking, skip a truncated trailing element, return what parsed. Used to salvage a
  suggestions/variant/items array that got cut off.
- **`salvageJsonObjectField(text, field)`** — generalize the portrait's `"portrait":"..."` recovery so a
  truncated object can still yield its leading essential string field (e.g. `summary`).
- **`tolerantArray(elementSchema, { keep })`** — a tiny Zod helper that wraps each element in
  `.catch(sentinel)` and filters sentinels, so every array parse is per-element salvaging by default
  (DRY: the gap-finder, generation, alignment items/facts, distill facts, etc. all use it).
- **`classifyAiOutcome(text, parsed)`** — given the raw reply + whether tolerant parse produced a usable
  result, return one of `{ ok, value } | { reason: 'TRUNCATED' | 'MALFORMED' | 'REFUSED' }` so the
  distinct-message decision lives in **one** place (§5.3). Pure, unit-testable, no I/O.

Whether to centralize into this one helper vs keep per-service salvage is a **§11 open question** — but
the duplication today (three copies of `extractJsonObject`, two of `salvageTruncatedPortrait`'s logic
in spirit) argues strongly for DRY consolidation.

### 5.2 Per-service changes (each adopts §3.1 + §5.1)

- `questionnaires/gapFinderService.ts` — loosen schema (§3.3), `tolerantArray` + `salvageJsonArray`,
  honest `classifyAiOutcome` message. **Bug fixed here.**
- `questionnaires/generationService.ts` — already tolerant; switch its local `extractJson*` to the shared
  helper, fold `variant` onto `tolerantArray` + `salvageJsonArray` (a truncated variant array still maps
  what it can; keep the count-preservation safety on options), and replace the `REFUSED`-for-everything
  branches with `classifyAiOutcome`.
- `questionnaires/analysisService.ts` — `AnalysisSchema` → tolerant (require `summary`; `facts` via
  `tolerantArray`); classify the empty/no-JSON case honestly.
- `questionnaires/alignmentService.ts` — `AlignmentAiSchema` + `ContextOnlyDistillSchema` → tolerant
  (require `summary`; `items`/`facts` via `tolerantArray`); honest messages. (`NOT_READY` pre-validation
  is unchanged — it's a data-readiness check, not a parse outcome.)
- `conversations/sessionAnalysisService.ts` — `SessionAnalysisDraftSchema.parse` → `safeParse` of a
  tolerant schema + `salvageJsonObjectField('summary')` fallback; distinct `TRUNCATED`/`MALFORMED`.
- `dreams/dreamAnalysisService.ts` — `DreamAnalysisDraftSchema.parse` → tolerant `safeParse` (require
  `summary` + the prose fields it needs to render; reflectiveQuestions via `tolerantArray`); distinct
  messages.
- `insights/reconcileService.ts` — `ReconcileOpsSchema` already `.default([])`s its arrays; switch to
  `tolerantArray` so one malformed op doesn't drop the batch, and emit `TRUNCATED`/`MALFORMED` distinctly.
- `intake/intakeService.ts` (portrait) — already conforms; **migrate it onto the shared helpers** so the
  gold-standard logic lives in one place (and `ReflectionDraftSchema` adopts the non-throwing extractor).
- `questionnaires/aiServices.test.ts` and the offline fakes — see §10.

### 5.3 Refusal detection (conservative)

`classifyAiOutcome` declares `REFUSED` only when **both**: (a) `salvageJsonArray`/`salvageJsonObjectField`
recovered **nothing usable**, and (b) the prose matches a small, reviewed set of refusal markers (e.g.
"I can't help", "I'm not able to", "I won't"). Otherwise: if the text contained an opening brace/bracket
but no balanced close (or salvage got a partial), it's `TRUNCATED`; else `MALFORMED`. The marker list is
intentionally small and documented; **a false negative (treating a refusal as `MALFORMED` → "unexpected
shape, try again") is preferred to a false positive** (telling the user the model refused when it merely
truncated) — consistent with the never-assume-a-refusal rule.

### 5.4 Where this is the trust boundary

The bridge stays the trust boundary for _inputs_; this spec governs _outputs_ the model returns. The
salvage operates entirely host-side in `@selfos/core` before any persisted write; the renderer only ever
sees the derived result + the honest `message`. No raw model reply crosses IPC.

## 6. IPC / API contracts

- **IPC channels:** **No new channels.** The existing AI-authoring/analysis channels
  (`questionnaires:generate` / `:improveQuestion` / `gapfinder:suggest` / `assignments:results` /
  analyze / align / `insights:*` reconcile / `sessions:endAndSummarize` / `dreams:synthesize` /
  `intake:synthesize`) keep their request shapes. Their **response shapes gain the two new
  `AiFailureReason` members** (`TRUNCATED`, `MALFORMED`) via the widened type — a non-breaking widening
  (consumers render `message`; any `reason` switch must add the two arms, caught by `tsc`).
- **Claude API:** unchanged model/streaming/budgeting. The `extendedThinking: false` rule on bounded
  JSON calls (generation, reconcile, portrait) is retained — it is part of _why_ output is parseable
  (see `adaptive-thinking-shares-maxtokens`). The only new API-adjacent behavior is the **optional
  one-retry on `TRUNCATED`** (a second `client.stream` with the same args, metered again), gated on the
  §11 decision; if added, it is bounded to **exactly one** retry and never fires on `REFUSED`/`MALFORMED`.

## 7. States & edge cases

- **Loading / empty / success** — unchanged; this spec is about the failure tail.
- **One bad element among good** — salvaged: drop the bad element, keep the rest (the gap-finder's core
  fix; same for generation questions, alignment items/facts, distill facts, session/dream array fields).
- **Missing a required-but-non-essential field** (e.g. a suggestion question without `required`) — the
  loosened schema accepts it; the field defaults. **No** whole-batch loss.
- **Out-of-enum value** (e.g. an `agreement` outside `aligned|mixed|divergent`, a `type` outside
  `AnswerTypeSchema`) — the element's `.catch` sentinel drops just that element; the rest survive.
- **Truncated reply (cut off mid-JSON)** — `salvageJsonArray`/`salvageJsonObjectField` recover what
  completed; if nothing usable, return `TRUNCATED` with a "try again" message (the portrait precedent,
  issue #19). Optional one-retry per §11.
- **No JSON at all but not a refusal** — `MALFORMED` ("unexpected shape, try again") — never a data-blame.
- **Genuine content refusal** — `REFUSED` with an honest decline message, **only** when §5.3 detects it.
- **No key / over budget / transport error** — `NO_KEY` / `BUDGET` / `ERROR` (existing; precede parsing).
- **Empty / thin context** (the gap-finder genuinely had nothing to suggest from) — distinct from a parse
  miss; §11 decides whether to keep the "add more about the people" branch and how to detect it
  (structured-context emptiness is a pre-call check, not a post-call inference).
- **Offline (no Claude)** — `31-ai-required`'s calm not-configured/connectivity state; unchanged.
- **Large data** — a maximal intake already drove the portrait past 8000 tokens (issue #19); salvage +
  the generous budget cover it. The same salvage now protects every batch producer from the analogous
  overflow.
- **Concurrent edits / sync conflicts / corrupt-or-missing files / migration** — N/A: this spec adds no
  persisted state and no migration; reads/writes are unchanged and remain conflict-handled by the vault
  service.
- **Metering invariant** — every paid path must `recordUsage` **before** parse. Verified present in
  session analysis (~226–228), dream synthesis (~304–306), reconcile (~140–154), portrait (~927–929),
  and `runClaude` (generation/improve/variant/gap-finder/analysis/alignment/distill all share it,
  ~159–173). The section reflection (`synthesizeSection` ~825) also meters before parse. **No path is
  missing it today; the spec's job is to keep it so as salvage is added.**

## 8. Safety

This feature touches conversation/wellbeing output indirectly: it parses the **session-analysis**,
**dream-synthesis**, **questionnaire-analysis**, **alignment**, **context-only**, **reconcile**, and
**portrait** replies — several of which carry a model **`crisisFlag`** / **`distressSignal`**.

- **Tolerant parsing must never drop a crisis signal.** `crisisFlag`/`distressSignal` are top-level
  optional booleans; the tolerant schemas keep them with `.catch(undefined)` (preserve, not coerce) so a
  per-element salvage of facts/items can't discard the flag. Where a reply is **salvaged from a truncated
  object**, the salvage must read the flag if it survived; if the flag region was cut off, the safe
  default is the existing behavior (flag absent ⇒ not flagged) — and the truncated reply is reported
  `TRUNCATED` (a retry), so the user re-runs and the flag can surface. **Document this explicitly in
  each service** so a future salvage tweak can't silently strip it.
- **The not-medical boundary is unchanged** — these are reflective-memory parses, never diagnosis; the
  framing in each prompt (`SESSION_ANALYSIS_GUIDANCE`, `DREAM_ANALYSIS_GUIDANCE`, portrait instruction)
  is untouched.
- **Crisis routing** (the `CrisisFooter` / resources-first surfaces in Sessions/Dreams/Memory/onboarding)
  is unaffected — this spec changes only the failure messages, which lead with calm honesty and never
  imply the user did something wrong.
- **Honest failure is itself a safety property here:** telling a distressed user "add more about the
  people in your life" when the model actually replied (the current gap-finder bug) is the kind of
  blaming, confusing message we must eliminate.

## 9. Accessibility

**No new UI**, so no new interaction model. The only rendered change is **message text** on existing
surfaces, which already meet the design-system standards:

- Failure messages render in the existing calm/error containers (`Banner`/inline status) with
  `role="status"`/`aria-live` as those components already provide; the new strings must remain plain,
  concise, and free of jargon (no "MALFORMED"/"REFUSED" leaking to the UI — those are internal `reason`s;
  the user sees the §3.2 prose).
- No colour-only signalling is introduced; messages are text.
- Reduced-motion / focus / keyboard behavior are inherited unchanged from the host surfaces.

## 10. Testing strategy

Tests are the proof that imperfect output is handled — and that the offline fakes stop hiding live bugs.

- **Shared helper (Vitest, pure):**
  - `extractJsonObject`/`extractJsonArray` — fenced, prose-wrapped, no-JSON (`null`), nested braces.
  - `salvageJsonArray` — full array; array with one truncated trailing element (keeps the complete ones);
    array with one malformed middle element (skips it); cut-off before the array opens (`[]`).
  - `salvageJsonObjectField` — recovers a leading string field from a truncated object; `null` when the
    field never appeared.
  - `tolerantArray` — drops a bad element, keeps good ones; all-good passthrough; all-bad ⇒ empty.
  - `classifyAiOutcome` — refusal-string ⇒ `REFUSED`; cut-off-with-brace ⇒ `TRUNCATED`; junk prose ⇒
    `MALFORMED`; usable parse ⇒ `ok`.
- **Per-service (Vitest):** for **each** of gap-finder, generation, variant, analysis, alignment,
  context-only distill, session analysis, dream synthesis, reconcile, portrait — feed a fake client that
  returns:
  1. **a reply missing a "required" field** (the gap-finder's `required` omission; assert success +
     salvage, not the data-blame message),
  2. **an out-of-enum value** (assert the bad element drops, the rest survive),
  3. **one-bad-element-among-good** (assert partial salvage, not whole-batch loss),
  4. **a truncated reply** (assert `TRUNCATED` + the "cut off" message, or the optional retry),
  5. **a refusal string** (assert `REFUSED` + an honest decline message),
  6. **junk / no JSON** (assert `MALFORMED` + "unexpected shape").
  - Assert **`recordUsage` ran** on cases 1–6 where a call succeeded (meter-before-parse).
- **Gap-finder regression (the reported bug):** a fake reply matching the live model's real shape —
  three suggestions, **none** carrying `required` — must yield **three** suggestions (today it yields
  zero). This is the test that would have caught the bug.
- **Offline fakes updated:** `aiServices.test.ts`'s gap-finder fake (and any other fake that returns
  flawless canned JSON) must be made **imperfect by default** (omit `required`, occasionally include a
  bad element) so the suite exercises real salvage — per CLAUDE.md §6, "the fakes hide live model bugs".
  Keep at least one perfect-JSON fixture per service for the happy path.
- **Component (Vitest + RTL):** the surfaces in §3.4 render the **distinct** message for each reason
  (Suggested shows the honest gap-finder message, not the data-blame line; Results/Memory/Sessions/Dreams
  show their `TRUNCATED` vs `MALFORMED` vs `REFUSED` strings). No new components.
- **E2E (Playwright):** drive the **Suggested** flow with `SELFOS_FAKE_CLAUDE` returning a
  `required`-less suggestion set → assert suggestions appear (the bug's user-visible fix), and one path
  returning a truncated reply → assert the calm "cut off, try again" message (not a data-blame). Reuse the
  existing fake-Claude E2E hook; no new vault setup.
- **Mocking:** vault via the in-memory `memFileSystem`; Claude via the per-test `fakeClient(text)` and the
  app/web `SELFOS_FAKE_CLAUDE` host fakes (made imperfect where noted). Live-model verification is **not**
  automatable — per the `adaptive-thinking-shares-maxtokens` lesson, the maintainer spot-checks one real
  gap-finder + one real portrait call against the live API before merge to confirm the salvage matches
  real-world output.

## 11. Resolved decisions (owner, 2026-06-23)

- **Message wording — APPROVED.** `TRUNCATED` → "The {noun} was cut off before it finished. Please try
  again." · `MALFORMED` → "The {noun} came back in an unexpected shape. Please try again." · `REFUSED` →
  "The AI couldn’t help with this one." The `{noun}` is the surface's subject (suggestions / draft /
  analysis / summary / portrait / refresh / comparison / personalized questionnaire / reworded question).
  None blames the user's data; the internal reason names never leak to the UI.
- **Centralize — YES.** Build the one `@selfos/core/ai/jsonSalvage` utility every service imports (DRY;
  one place to harden). The three copies of `extractJsonObject` + the portrait salvage are consolidated.
- **Salvage aggressiveness — show any partial (≥1).** Whatever survived per-element salvage is shown; a
  1-of-3 suggestion set still appears. Alignment is naturally partial-safe (un-verdicted prompts default
  to `mixed`), so it shows what salvaged too. Never discard a usable result.
- **One-retry on `TRUNCATED` — NO.** Always surface the calm "cut off, try again" message and let the
  user re-tap; no surprise second metered call. (The generous output budgets already make truncation
  rare.)
- **Empty-context branch — KEEP, as a PRE-CALL check.** The gap-finder detects near-empty structured
  context (`gatherGenerationContext` returns `''`) **before** calling Claude and returns the "add more
  about the people in your life" hint (no spend, no `reason` — it's an empty state, not an AI failure). A
  **post-call** zero-suggestion result is now an honest parse-outcome message (`TRUNCATED`/`MALFORMED`/
  `REFUSED`), never the data-blame line.
- **Refusal markers — host-only, small English list.** `classifyParseFailure` lives in `@selfos/core`
  (the host owns output classification); the relay/`@selfos/answering` surfaces don't classify model
  output, so the marker list stays host-side.
- **Telemetry — out of scope** (not requested).

## 11a. Implementation notes (as built)

- The `{noun}` per surface (the wording §11 approved): gap-finder + guided suggest use **"suggestion
  set"** (so "The suggestion set was cut off…" reads cleanly), generation **"draft"**, variant
  **"personalized questionnaire"**, improve **"reworded question"**, analysis **"analysis"**, alignment
  **"comparison"**, context-only distill **"summary"**, session **"summary"**, dream **"analysis"**,
  reconcile **"refresh"**, portrait **"portrait"**.
- The pre-call empty-context check is `isThinContext` (in `contextProviders.ts`, next to the provider that
  emits the identity boilerplate) — context is "thin" when every line is the always-present "created by …"
  / "It is about …" boilerplate (a literally-empty gathered context never happens), so the gap-finder's
  empty-state hint fires meaningfully without spending.
- **Beyond the §1 list:** the guided-sessions recommender (`guidanceService`) — the gap-finder's twin —
  got the same tolerant + honest treatment (it shares the `runClaude` shape and had the same data-blame
  message). Its empty-context behavior is unchanged (it recommends from a fixed catalog, so it always
  suggests starters; no pre-call thin-context hint).
- The portrait's `IntakeSynthesisResult` reason union does not include `REFUSED`, so a detected refusal on
  that path collapses to `MALFORMED` (consistent with the never-assume-a-refusal stance — a portrait
  refusal is implausible and "unexpected shape, try again" is the safe message).
- **Telemetry** (the deferred §11 item) was not built (not requested).

## 12. Changelog

- 2026-06-23 — created (Draft). First of the 37–41 group. Captures the gap-finder bug
  (`gapFinderService.ts` + `QuestionnaireSuggestionSchema`'s required `required`), the brittle strict
  parsers across conversations/dreams/insights/questionnaires, the gold-standard portrait pattern to
  generalize, and the offline-fakes-hide-live-bugs trap. The gap-finder bug is fixed within this spec
  (user decision).
- 2026-06-23 — Approved + **Built**. §11 decisions resolved (owner): proposed wording approved; centralize
  into one `@selfos/core/ai/jsonSalvage` utility; show any partial (≥1); NO one-retry on TRUNCATED;
  empty-context kept as a PRE-CALL check; refusal markers host-only; telemetry out of scope. Built the
  shared utility (`extractJsonObject`/`extractJsonArray`/`salvageJsonArray`/`salvageJsonObjectField`/
  `salvageJsonObjectArrayField`/`tolerantArray`/`classifyParseFailure`/`aiFailureMessage`/
  `classifyParseOutcome`); widened `AiFailureReason` (+`TRUNCATED`/`MALFORMED`) and the inline result
  unions; loosened `QuestionnaireSuggestionSchema.questions[].required` → optional; converted the strict
  draft schemas to tolerant ones and adopted the shared parse + honest classify across gap-finder,
  generation, improve, variant, analysis, alignment, context-only distill, session analysis, dream
  synthesis, reconcile, the guided-suggest twin, and migrated the portrait onto the shared helpers.
  Meter-before-parse + crisis-signal preservation verified throughout. Tests: 27 shared-helper units, a
  gap-finder regression (3 `required`-less suggestions → 3 shown, was 0), per-service salvage/truncation/
  refusal/MALFORMED cases, an RTL for `SuggestedPanel`, and an E2E driving the Suggested flow with an
  imperfect fake reply. Offline fakes made imperfect by default (omit `required`). Gate green: typecheck,
  lint, format, **599 core + 11 relay + 660 desktop** unit, **88/88 E2E**. Code-reviewer **ship**.
