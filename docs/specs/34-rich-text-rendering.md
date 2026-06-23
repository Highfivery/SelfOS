# 34 — AI rich-text rendering

> **Status:** **Approved** — _last updated 2026-06-22_
>
> SelfOS renders every AI-generated string as a plain text node, so the Markdown the model naturally
> writes (`**bold**`, `*italic*`, `-`/`1.` lists, `###` headings, `---` rules, `> quotes`,
> `` `code` ``) is shown to the user as literal characters. This spec introduces ONE shared, hardened,
> streaming-safe rich-text renderer, a model **formatting contract** in the prompt builders so
> generation and rendering agree, and applies both across all ~16 AI-prose surfaces — plus a
> readability pass on the portrait and insight summaries.

---

## 1. Overview

The model writes Markdown; nothing in SelfOS parses it. The result is broken-looking text on the two
surfaces the user flagged (the onboarding **portrait** and **coaching sessions**) and on a dozen more
(dream analysis, memory insights, the compatibility/alignment report, wrap-up cards, the onboarding
"Tell me more" go-deeper chat). See the full inventory in §3.4.

This is a **cross-cutting design-system + prompt** change, not a per-screen patch:

1. A single `<Markdown>` primitive that renders a **curated, safe subset** of Markdown to semantic
   elements styled with design tokens (`01-design-system.md`).
2. A **formatting contract** appended to the system prompts (and the JSON-prose instructions) so the
   model only emits what the renderer supports — no tables, images, raw HTML.
3. Every AI-prose render site switched to `<Markdown>`.
4. A readability pass so the portrait and insight summaries gain real visual hierarchy.

Related: `01-design-system.md` (tokens, `/gallery`), `05-conversations.md` + `16-guided-sessions.md`
(session messages), `18-personal-onboarding.md` (portrait + go-deeper chat), `09-session-analysis.md`

- `20-memory-dashboard.md` (insights), `12-dreams.md`/`13` (dream analysis), `08-questionnaires.md`
  (alignment report, relay page). The renderer must also be reachable from the **relay web page**
  (external recipients see the alignment report), which is why it lives in `@selfos/answering` (§5).

## 2. Goals / Non-goals

- **Goals**
  - One shared renderer for all AI prose; no duplicated rendering logic.
  - Modern, Claude/ChatGPT-style formatting: paragraphs, **bold**, _italic_, bulleted + numbered
    lists, blockquotes, inline code, headings, thematic breaks, links.
  - **Safe by construction**: no raw HTML execution, **no images** (network/privacy), no script, no
    arbitrary network fetches from the renderer; links are neutered (open externally via the existing
    safe path, or render as non-navigating styled text — see §11).
  - **Streaming-safe**: partial/incomplete Markdown mid-stream degrades gracefully (a dangling `**`
    shows literally until closed; no flicker, no thrown parse).
  - A **prompt formatting contract** so the model stays within the supported subset.
  - Accessible semantic output (`<strong>`, `<ul>`/`<ol>`/`<li>`, `<blockquote>`, `<h3>`…).
  - Cohesive with the design system; showcased in `/gallery`.
  - Readability pass: the portrait + insight summaries read as structured content, not a wall of text.
- **Non-goals**
  - GitHub-flavored tables, task lists, footnotes, image embedding, syntax-highlighted code blocks,
    or arbitrary raw HTML. (The contract tells the model not to produce them; the renderer drops them
    if it ever sees them.)
  - Markdown **authoring** by the user (this renders model output; user inputs stay plain).
  - Changing what the model says — only how it is formatted/displayed.

## 3. UX & flows

### 3.1 The supported subset (what `<Markdown>` renders)

| Markdown                       | Rendered as                                                                       | Notes                                                        |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Paragraphs / blank-line breaks | `<p>` with token spacing                                                          | Replaces today's `pre-wrap` blob                             |
| `**bold**`                     | `<strong>`                                                                        |                                                              |
| `*italic*` / `_italic_`        | `<em>`                                                                            |                                                              |
| `` `inline code` ``            | `<code>` (token-styled)                                                           |                                                              |
| `- ` / `* ` bullets            | `<ul><li>`                                                                        | nested lists supported to 2 levels                           |
| `1. ` ordered                  | `<ol><li>`                                                                        |                                                              |
| `> quote`                      | `<blockquote>`                                                                    |                                                              |
| `# … ###` headings             | `<h3>`/`<h4>` (visually clamped to fit cards; never larger than the card heading) | a top-level `#` inside prose downscales, it doesn't dominate |
| `---` / `***`                  | `<hr>` (subtle token rule)                                                        |                                                              |
| `[text](url)`                  | neutered link (see §11)                                                           | **no** image syntax — `![]()` is dropped                     |

Anything outside this subset (tables, images, raw HTML tags, code fences) is **stripped to its text
content or dropped**, never rendered as raw markup and never as live HTML.

### 3.2 The two flagged surfaces (acceptance)

- **Onboarding portrait** (`ClosingPortrait.tsx`): the "What I've come to understand about you"
  summary renders with paragraph breaks, emphasis, and any lists — not literal `**`/`---`. Plus the
  §3.5 readability pass.
- **Coaching session thread** (`Sessions.tsx`): each assistant message renders Markdown; the
  **streaming** bubble renders Markdown incrementally and never flashes broken syntax; user messages
  stay plain. The "Coach is thinking…" and crisis affordances are unchanged.

### 3.3 Streaming behavior

While a message streams, `<Markdown>` re-parses the growing buffer each chunk. Incomplete constructs
render as literal text until they complete, then resolve (e.g. `**stay` → literal, `**stayed**` →
**stayed**). No layout jump beyond normal text growth; `aria-live` semantics unchanged.

### 3.4 Full render-site inventory (all must switch to `<Markdown>`)

| #   | Surface                                  | File (renderer)                                                     |
| --- | ---------------------------------------- | ------------------------------------------------------------------- |
| 1   | Onboarding portrait summary              | `routes/onboarding/ClosingPortrait.tsx`                             |
| 2   | Onboarding per-section reflections       | `routes/onboarding/ClosingPortrait.tsx`                             |
| 3   | Onboarding "Tell me more" go-deeper chat | `routes/onboarding/IntakeFormPanel.tsx`                             |
| 4   | Session messages (saved)                 | `routes/sessions/Sessions.tsx`                                      |
| 5   | Session message (streaming)              | `routes/sessions/Sessions.tsx`                                      |
| 6   | Wrap-up card summary                     | `routes/sessions/WrapUpCard.tsx`                                    |
| 7   | Wrap-up card facts                       | `routes/sessions/WrapUpCard.tsx` (facts: plain or light — see §3.6) |
| 8   | Dream synthesis (5 prose fields)         | `routes/dreams/DreamSynthesisCard.tsx`                              |
| 9   | Memory insight summary                   | `routes/memory/InsightCard.tsx`                                     |
| 10  | Memory insight facts                     | `routes/memory/InsightCard.tsx`                                     |
| 11  | Home memory card summary                 | `routes/home/MemoryCard.tsx`                                        |
| 12  | Alignment/compatibility report summary   | `routes/questionnaires/AlignmentReportView.tsx`                     |
| 13  | Alignment per-item notes                 | `routes/questionnaires/AlignmentReportView.tsx`                     |
| 14  | Alignment report on the **relay page**   | `apps/relay` (via `@selfos/answering`)                              |
| 15  | Guided session messages                  | shares the Sessions thread (#4/#5)                                  |
| 16  | Any future AI-prose surface              | uses `<Markdown>` by default                                        |

### 3.5 Readability pass (portrait + insight summaries)

Beyond rendering: with real paragraphs/lists the portrait stops being one dense block. Give the
portrait card generous paragraph rhythm and ensure section reflections are visually distinct.
Insight summary vs. facts gets a clearer hierarchy (summary as prose, facts as a labeled list).
This is layout/token polish enabled by `<Markdown>`, not new data.

### 3.6 Facts (short structured strings)

Insight/wrap-up **facts** are short single claims. Render them with `<Markdown inline>` (emphasis +
inline code only, no block elements) so a stray `**` doesn't show but a fact never becomes a heading
or list. Confirm in §11.

## 4. Data model (vault files & schemas)

N/A — no persisted format changes. `<Markdown>` is a pure view layer over strings already stored
(messages, `Insight.summary`/facts, `Dream` analysis fields, `IntakeSession.portrait`, alignment
report). No `schemaVersion` change, no migration.

## 5. Architecture & modules

- **New primitive:** `Markdown` lives in **`@selfos/answering`** (self-contained, design-token CSS,
  no app design-system dependency — matching the existing `QuestionnaireForm`/`CrisisFooter` there),
  so the **relay Worker page**, the iOS WebView, and the Electron renderer all share one
  implementation. The Electron design-system **re-exports** it (`design-system/components/index.ts`)
  so in-app callers import it like any primitive.
- **Implementation:** a **hand-rolled, dependency-light** parser for the §3.1 subset (recommended —
  consistent with SelfOS's bespoke-no-lib pattern for charts, zero new deps, smallest iOS bundle,
  full control of the security surface). Alternative: `react-markdown` + `remark-gfm` hardened
  (no `rehype-raw`, image components disabled, `urlTransform` neutering links). **See §11.**
- **Props:** `<Markdown>{string}</Markdown>` for block prose; `<Markdown inline>` for §3.6 facts;
  optional `tone`/`size` pass-through to match surrounding `Text`.
- **Prompt contract:** a `FORMATTING` constant added to `packages/core/src/conversations/promptBuilder.ts`,
  appended **after** `PERSONA` + `SAFETY` (and the per-feature addenda), telling the model to use only
  the supported subset and to avoid tables/images/HTML. For the JSON-producing calls (portrait, dream
  synthesis, insight analysis, alignment) the per-call instruction notes prose fields may use light
  Markdown (paragraphs, bold, lists), facts stay plain. Located in: `promptBuilder.ts`,
  `intakeService.ts`, `dreamAnalysisService.ts`, `aiPrompts.ts`.
- **Changed components:** the 16 render sites in §3.4 swap their text node for `<Markdown>`; remove
  now-redundant `white-space: pre-wrap` CSS where `<Markdown>` owns layout.
- **`/gallery`:** add a `Markdown` section showcasing every supported construct + an `inline` example.

## 6. IPC / API contracts

N/A — no new IPC. (The formatting contract changes the **content** of existing prompt strings built
in `@selfos/core`; the API key stays in main; no new channels.)

## 7. States & edge cases

- **Empty string** → renders nothing (or the existing placeholder), no crash.
- **Plain text (no markdown)** → renders as a normal paragraph; graceful degradation is the default.
- **Incomplete markdown mid-stream** → literal until closed (§3.3); never throws.
- **Malicious/odd model output** — raw HTML (`<script>`, `<img onerror>`) is **never** parsed as
  HTML; image syntax is dropped; `javascript:`/`data:` link URLs are rejected (§11). This is a
  security boundary, tested explicitly.
- **Very long output / deep nesting** → lists clamp to 2 levels; headings clamp visually; no overflow
  (verify the §7 no-horizontal-overflow guard still holds at ~360px).
- **Coach markers** (`[[SELFOS:STEP:n]]`, `[[SELFOS:WRAPUP]]`, field markers) are stripped **before**
  `<Markdown>` (existing `stripCoachMarkers`/marker logic runs first; order matters).
- **RTL/long words** → `overflow-wrap` retained on rendered blocks.

## 8. Safety

Touches conversation surfaces, so the boundary matters: the crisis footer + not-medical lines are
**outside** `<Markdown>` and unchanged. `<Markdown>` must never enable a network request or script
from a model string (no images, no raw HTML, no live links to untrusted schemes) — this protects the
renderer-is-offline guarantee and prevents a model response from exfiltrating via an image URL.
Crisis-flagged surfaces still lead with resources; rendering doesn't alter that ordering.

## 9. Accessibility

Semantic elements only (`<strong>`/`<em>`/`<ul>`/`<ol>`/`<li>`/`<blockquote>`/`<h3>`/`<hr>`), so
screen readers announce structure. Headings inside cards use a level that doesn't break the page
outline (clamp to `<h3>`/`<h4>`). Contrast/inline-code styling from tokens. No motion. Links (if
navigable) are keyboard-focusable with visible focus; if neutered, they are not interactive and not
in the tab order.

## 10. Testing strategy

- **Unit (parser):** each supported construct → expected semantic output; unsupported constructs
  (table/image/raw HTML/code fence) → safe degradation; `javascript:`/`data:` URLs rejected;
  incomplete-stream input never throws and resolves on completion.
- **Security unit:** `<script>`, `<img onerror=…>`, `![](http://x)` produce **no** live element and
  trigger no network/DOM injection.
- **Component (RTL):** the portrait, a session message, a wrap-up card, an insight, the alignment
  report each render markdown (assert real `<strong>`/`<li>` in the DOM, not literal `**`).
- **E2E (Playwright):** a session reply containing a list + bold renders structured (no raw `**`);
  the onboarding portrait renders structured; the ~360px overflow guard still passes on these
  surfaces.
- **Mocking:** the offline fake Claude returns markdown-containing strings so tests exercise real
  rendering (today's fakes return prose — extend them to include bold + a list).

## 11. Resolved decisions

- **Renderer implementation:** **hand-rolled, dependency-light** parser for the §3.1 subset (matches
  SelfOS's bespoke-no-lib pattern, zero new deps, smallest iOS bundle, full control of the security
  surface). `react-markdown` is not used.
- **Links:** **neutered** — link text renders as styled, non-navigating text (safest; preserves the
  renderer-is-offline guarantee). No clickable links from model prose in v1.
- **Headings:** rendered as `<h3>`/`<h4>`, visually clamped so they never dominate the card title.
- **Where the primitive lives:** **`@selfos/answering`** (so the relay web page + iOS reuse it),
  re-exported from the Electron design-system.

## 12. Changelog

- 2026-06-22 — created (drafted from the onboarding + session formatting bug; decisions: full subset,
  also constrain the model, fold in portrait/insight readability polish).
- 2026-06-22 — **Approved.** Open questions resolved: hand-rolled renderer, neutered links,
  `<h3>`/`<h4>` clamped headings, lives in `@selfos/answering`.
- 2026-06-22 — **Built** (`feat/rich-text-rendering`). The `Markdown` primitive + dependency-free
  `markdownParser` (AST → semantic elements) live in `@selfos/answering`, re-exported from the Electron
  design-system. Security is by construction: the parser never emits raw HTML, drops image syntax, and the
  `link` AST node carries no URL (neutered → no `href`/scheme ever rendered); it is total (never throws)
  and streaming-safe (incomplete markdown degrades to literal text and resolves on completion). The
  `FORMATTING` contract is appended **after** persona+safety in `buildSystemPrompt` (chat/guided/depth-ask)
  - the intake interviewer + the dream-analysis chat, with light-Markdown notes added to the JSON-prose
    calls (portrait/reflection, dream synthesis, questionnaire analysis + alignment); facts stay plain. All
    §3.4 surfaces switched to `<Markdown>` (block) / `<Markdown inline>` (facts) — incl. the relay page's
    alignment report — with markers stripped before rendering and user input left plain; redundant
    `white-space: pre-wrap` removed where `<Markdown>` owns layout, plus the §3.5 portrait/insight
    readability pass and a `/gallery` showcase. Tests: parser units + DOM security units (no live
    `<script>`/`<img>`/`<a>`/`href`) + streaming degradation, per-surface RTL (portrait, session, wrap-up,
    insight, alignment render real `<strong>`/`<li>`), and E2E (session reply + portrait render structured,
    no raw `**`); the offline fake Claude now returns markdown so tests exercise real rendering. Gate green:
    typecheck, lint, format, **501 core + 11 relay + 598 desktop** unit; code-reviewer **ship** (security
    boundary verified airtight). Live-preview verified the Sessions reply renders as a real list with bold.
