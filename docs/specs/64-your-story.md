# 64 — Your Story (living biography & book projects)

> **Status:** Draft — _last updated 2026-07-15_
>
> Your Story turns everything SelfOS knows about a person into an ever-evolving, professionally
> written **biography** — a real book, drafted by an AI biographer from the person's own data,
> curated by the person in a collaborative draft view, shared (only after their review) with chosen
> household members, and exportable as Markdown/PDF. It is built as a generic, extensible **book
> projects** foundation: the biography is the first `BookType`; future types (fiction based on the
> user's life, an erotica type behind the 18+ gate, a couples "Our Story", a year-in-review) plug in
> as registry entries without shell changes.

---

## 1. Overview

SelfOS already holds what no life-story product has: a ~200-question life intake, months of
coaching-session analyses, dreams, personality/attachment/wellbeing profiles, goals, challenges,
couples-session history, and a relationship graph — all distilled into the source-tagged,
provenance-stamped, date-anchored **Insight layer** (specs 08/09/12/18/50/58). Your Story is the
payoff artifact for that corpus: a living book that exists **on day one** (no blank page, no
question-curriculum), grows as the person's life and data grow, and interviews the person only for
what it genuinely doesn't know.

Market context (2026 research, full citations in the spec's research appendix commit): the
life-story category (StoryWorth 1M+ printed books, Remento, Autobiographer, ghostwriter services
$899–$135k) fails in consistent ways — writing burden → abandonment, generic question banks, AI
prose that flattens the subject's voice, Q&A piles instead of narrative, books that freeze at
print, and privacy anxiety. Every one of those maps to a design decision in this spec. The
"self-authored, continuously updated, psychologically deep biography" lane is empty; SelfOS's
encrypted local vault + data gravity is the moat.

Related specs: 08 (questionnaire engine + §24 all-data tailoring precedent), 63 (auto check-ins —
the autonomous interview loop this reuses), 09/16 (sessions the interview chat later reuses), 13
(image pipeline), 34 (Markdown rendering), 35 (notifications), 39 (goals), 45 (attachments/vision),
50/51 (tests — clinical-band invariant), 53/60 (Home recommendations), 58 (Together privacy
projections), 20/44/62 (Memory, flag-inaccurate loop).

## 2. Goals / Non-goals

**Goals (v1 = the `biography` book type)**

- A person can create their biography and get a **substantial, well-structured draft from existing
  data alone** — outline first (their approval), then chapter-by-chapter prose.
- The prose targets the craft bar of professional biography: the spec bakes in a **Biographer's
  Doctrine** (Caro/Isaacson/Karr/Gornick/Lee/Lopate-derived principles), the **McAdams Life Story
  Interview** framework as the structural/interview science, and an explicit **banned-AI-prose
  contract**.
- **One book, one truth**: the Draft view is the control room — read, comment, edit directly, pin
  verbatim quotes, and **exclude** passages/topics/people/sources (durably: excluded material is
  never reintroduced by later rewrites). The reader version is simply the draft as of the person's
  last review.
- **Living book (hybrid auto)**: free deterministic stale-detection; stale chapters auto-rewrite on
  a budget-capped weekly cadence; **structural** changes (new chapter, reorder, prologue rewrite)
  are proposed and wait for one-tap approval; "Refresh now" always available.
- **Interview engine** on both surfaces: gap-driven biographer questionnaires through the existing
  generation + auto-check-in machinery (v1), and a conversational "Story interview" session (later
  phase) for scene-level depth.
- **Readers**: chosen household members read the **published head** (never the live draft) in a
  typography-first reader view; grants are per-person, revocable, re-checked at read time.
- **Export**: Markdown and print-ready PDF, written outside the vault via a save dialog.
- **Images**: AI-generated cover and on-demand chapter illustrations (OpenAI, behind the spec-13
  distillation privacy flow); user photo uploads that Claude vision analyzes and asks about before
  they land in chapters with captions.
- **Extensible foundation**: a `BookType` registry (doctrine addendum, structure templates, style
  presets, interview frameworks, gates per type); v1 registers `biography` only.

**Non-goals (v1)**

- Other book types (fiction, erotica, couples "Our Story", year-in-review) — the registry is built
  so they're additive entries later; erotica reuses the existing shared 18+ ack when it comes.
- External (outside-household) sharing via the relay — architecturally ready (§5.8), later slice.
- EPUB / DOCX export, audio narration, print-on-demand integration (a print-ready PDF makes
  Lulu/Blurb possible manually).
- Household **contributions** (family-submitted questions/quotes woven in with attribution) — a
  high-value fast-follow, not v1 (§11).
- Raw session-transcript quote-mining (v1 quotes come from intake/questionnaire answers, which are
  verbatim by nature); editions history beyond the published snapshot.
- Multiple simultaneous books per person per type (the model supports N books; v1 UI creates one
  biography).

## 3. UX & flows

### 3.1 Entry & navigation

- New top-level nav entry **"Your Story"** (book icon), route `/story`, gated on `story.own`
  (Member default ON; Guest none). Registered per the feature-module conventions (02).
- Home surfaces (spec 53/60 engine): a `story` recommendation provider ("Your story grew — Chapter
  7 has new material to weave in", "3 questions could fill a gap in your twenties"); no bespoke
  Home card.

### 3.2 First run — creating the book

1. `/story` empty state explains the feature (and its privacy model: "written from your private
   vault; nobody sees it until you share") → **"Start your story"**.
2. **Setup (one screen, not a wizard)**: title (default "The Story of {name}", editable), narrative
   voice (**third person** default; first person available), style register (Literary · Warm ·
   Plain — style presets from the BookType), length target (Concise · Standard · Full), and a note
   that the biographer reads everything it knows unless excluded later. No area-picking step — all
   data feeds the draft (owner decision, 2026-07-15; §8.3 governs safety).
3. **Foundations pass** (one metered call): produces the book's **essence statement**, a proposed
   **timeline**, and a proposed **outline** — parts + chapters, each chapter with a title, a 1–2
   sentence brief ("essence"), an era/date range, and the source material it will draw on. The
   McAdams "life chapters" concept shapes the proposal.
4. **Outline review** — the first collaboration moment: rename/reorder/merge/split chapters, edit
   briefs, delete proposed chapters. **Approve outline** → chapter drafting begins (queued,
   progress shown per chapter, resumable; budget-gated so an over-budget stop resumes cleanly next
   period).

### 3.3 The Draft view (the control room)

- `/story` shows the **book overview**: cover (or placeholder), completeness meter ("Your story is
  ~64% told" — §5.6), parts/chapters list with per-chapter status chips (Generating · New · Stale ·
  Reviewed), pending structural proposals, pending interview nudges, and actions (Refresh now ·
  Share & readers · Export).
- Opening a chapter shows **rendered prose** (book renderer, §5.9) with per-paragraph affordances
  (hover/tap):
  - **Sources** — a popover listing the paragraph's provenance (e.g. "From your onboarding — Your
    story · From the session on May 12") with deep links to the source surface (Memory insight,
    session, dream), the spec-20 provenance pattern.
  - **Comment** — anchored feedback ("this is overstated", "my sister wasn't there — it was my
    cousin"). Comments queue per chapter; **"Apply feedback"** runs one revision call that
    addresses open comments and marks them applied. A comment can also flow to Memory: "this fact
    is wrong" offers the existing flag-inaccurate action on the underlying insight, fixing the
    book AND the memory.
  - **Edit text** — direct editing of a passage (Textarea in place). User-edited passages become
    **protected blocks**: later rewrites must preserve them verbatim (code-enforced, §5.4 — not
    just prompted).
  - **Pin quote** — mark a sentence as untouchable "in your own words" material (rendered as a
    pull-quote; never paraphrased by rewrites).
  - **Exclude** — remove a passage, and choose scope: _this passage_ · _this topic_ · _this
    person_ · _this source_. Writes a durable `ExclusionItem`; the passage disappears, the chapter
    is queued for a seam-smoothing revision, and every future generation filters the exclusion at
    the **corpus level** (§5.2) so it can never be reintroduced. An **Exclusions panel** on the
    book overview lists and un-excludes items.
- **Chapter review**: a chapter freshly generated or auto-rewritten is status **New/Updated** with
  a diff-oriented affordance ("what changed"); **"Looks good"** marks it Reviewed. Only Reviewed
  content can be published (§3.5).

### 3.4 The living book (hybrid auto)

- **Stale detection is free**: each chapter stores a `sourceSignature` (the contributing source ids
  - their update stamps). A cadence hook (launch/focus, throttled daily — the spec-63 pattern)
    diffs new/changed insights, answers, dreams, etc. against chapter signatures and flags stale
    chapters.
- **Auto-rewrite**: stale chapters regenerate automatically on a weekly, budget-capped cadence
  (`STORY_WEEKLY_AUTO_CAP` chapter rewrites per rolling 7 days; owner override; never during an
  active crisis signal, never when AI off / over budget — the spec-63 gates verbatim). Rewrites
  respect protected blocks, pinned quotes, exclusions.
- **Structural proposals**: when new material doesn't fit existing chapters (a new era/theme, a
  chapter that should split, a prologue that no longer fits the book), the engine files a
  `StructuralProposal` (human-readable rationale) that waits for one-tap approval — never applied
  silently (the spec-20 merge-proposal pattern).
- **"Refresh now"** on the book and per chapter forces the pass immediately (still metered +
  budget-gated).

### 3.5 Publishing & readers

- **Publish gate (owner decision)**: readers never see the live draft. **"Share updates"**
  snapshots all Reviewed chapters into the **published head**; readers always read that snapshot.
  The first publish walks the person through choosing readers.
- **Readers**: any household people the person picks (the questionnaire-recipient model — no
  relationship edge required), per-person grants stored on the book, **revocable, re-checked at
  every read** (the dream-image-sharing model). When granting a reader who is prominently featured
  in the book, the picker shows a gentle awareness note ("Angel appears throughout this book").
- A shared book appears for the reader as **"Shared with you"** on their `/story` surface (and a
  `story-shared` notification). Reader view is read-only, typography-first (§3.6), shows the
  published head + a "What's new since you last read" marker (device-local per-person read
  progress). No comments from readers in v1.
- Revoking a reader (or the person deleting the book) removes access at the next read — no stale
  access (read-time re-gate).

### 3.6 Reader view

- A book-reading surface: cover page → front matter (title page; dedication and epigraph when the
  person has provided them — elicited by the interview engine, never invented); table of contents;
  parts/chapters; photo placements with captions; back matter — acknowledgments (elicited), **"A
  Note on this book"** (auto-generated honesty page: "Drawn from N conversations, M reflections,
  dreams recorded between X and Y…; reconstructed dialogue is marked as reconstruction"), and a
  colophon with the version date and the wellness boundary line (§8.1).
- Typography-first reading: the reader column uses a **percentage-based measure** (the chat-bubble
  precedent) rather than a fixed px cap — see §11 for the §12 sign-off.
- Available for the person's own book too ("Read your story") — always rendering the **draft
  head** for the owner, published head for readers.

### 3.7 The interview engine

- **Gap pass** (`story.interview`, metered): scores the book against the McAdams framework
  (life-chapter coverage, the eight key scenes, challenges, ideology, future script) and against
  craft needs (chapters thin on scene/sensory/quote material; timeline holes; contradictions to
  resolve — "take no one at their word"). Emits prioritized gaps, each with a FOCUS brief.
- **Story check-ins (v1)**: the top gap becomes a small questionnaire minted through the existing
  pipeline — `generateQuestions` with FOCUS = the gap brief, the §24 all-data `dedupReference` so
  it **never re-asks what the vault already knows**, plus this book's own asked-prompt history.
  Delivered as a normal in-app self-send into the **Inbox** with a "Your biographer" eyebrow +
  rationale (the spec-63 presentation), carrying `storyProvenance` on the definition. Cadence:
  driven by the story cadence hook, ≤1 open story check-in at a time, back-off when ignored
  (spec-63 planner constants), suppressed on crisis/AI-off/over-budget. Answers flow through the
  ordinary submit → analysis → Insight loop and thereby into the corpus — which un-flags the gap
  and (typically) stales the relevant chapter. Interview questions follow the oral-history rules:
  open How/What/Why forms, sensory elicitation ("what did the kitchen smell like"), one McAdams
  meaning-probe per scene ("why is this important — what does it say about you?").
- **Story interview sessions (later phase, §5.11)**: a conversational interview (guided-session
  machinery) for deep scene reconstruction — the "eight key scenes" work that forms can't reach.
- **Photo Q&A**: uploading a photo (§3.8) triggers a vision pass that proposes a caption and asks
  2–4 photo-specific questions **inline on the photo card** (answers persist to the interview
  state and corpus).

### 3.8 Images

- **Cover**: "Create a cover" on the book overview — style preset picker (book-cover preset group)
  - optional direction notes → the spec-13 two-call flow (Claude distills a **name-free, symbolic**
    cover brief; OpenAI renders; never a photoreal likeness) → cover stored encrypted; regenerate at
    will; admin-only cost shown (13 §-precedent).
- **Chapter illustrations**: "Illustrate this chapter" — same flow seeded from the chapter's
  distilled themes. On-demand only (no auto image spend).
- **Uploads**: file picker/drag-drop on a chapter or the book's photo tray → client `downscaleImage`
  (reuses spec 45: ≤1568px, EXIF stripped) → encrypted media in the book's images dir → vision
  analysis (caption suggestion + questions, §3.7). Placement: the user (or an AI suggestion)
  anchors the image after a paragraph with a caption; the renderer interleaves placements (§5.9).
  Photos never feed image _generation_; they're analyzed by Claude vision only.

### 3.9 Export

- **Export panel**: Markdown (the whole book as `.md` + an `images/` folder alongside, standard
  `![caption](images/…)` links) and **PDF** (typeset print CSS → Electron `printToPDF`), both via a
  new generic `saveFile` host op with the standard save dialog ("this leaves the encrypted vault"
  note — the spec-13 export precedent). Exports render the **draft head** for the owner (it's
  their book); a "published version" toggle exports the published head.

## 4. Data model (vault files & schemas)

All files are encrypted (`writeEncryptedJson` / `encryptBytes`) — the owner's 2026-07-15 decision:
markdown **content** inside `.enc` at rest, real `.md` only via explicit export. All new schemas
are `schemaVersion: 1`, additive-optional evolution (the established no-migration convention). All
I/O through the vault service / `FileSystem` host.

```
people/<personId>/story/books/<bookId>/
  book.enc                 BookManifest
  outline.enc              BookOutline
  timeline.enc             LifeTimeline
  chapters/<chapterId>.enc BookChapter          (draft head)
  published/<chapterId>.enc BookChapter snapshot (published head)
  published/manifest.enc   PublishedManifest    (publishedAt, chapter list + order, coverImageId)
  comments/<commentId>.enc DraftComment
  exclusions.enc           ExclusionList
  interview.enc            StoryInterviewState
  images/index.enc         StoryImageIndex
  images/<imageId>.enc     encryptBytes (uploads + generated illustrations + cover bytes)
```

Zod schemas (in `packages/core/src/schemas.ts` unless noted; names final at implementation):

- **`BookManifestSchema`** — `{ schemaVersion:1, id, personId, type: BookTypeId ('biography'),
title, config: { voice:'third'|'first', style:'literary'|'warm'|'plain', length:
'concise'|'standard'|'full', autoRefresh: boolean (default true) }, essence?: string, status:
'outlining'|'drafting'|'ready', coverImageId?, sharedWith: string[] (person ids), createdAt,
updatedAt, publishedAt? }`.
- **`BookOutlineSchema`** — `{ schemaVersion:1, approved: boolean, parts: [{ id, title, chapters:
[{ id, title, brief, eraFrom?, eraTo?, lifeAreas: LifeArea[], order }] }] }`.
- **`LifeTimelineSchema`** — `{ schemaVersion:1, events: [{ id, date?: string, approx?: string,
label, sourceRef?: StorySourceRef, userEdited: boolean }] }` — user-editable; the chronology
  spine.
- **`BookChapterSchema`** — `{ schemaVersion:1, id, partId, order, title, markdown, revision:
number, status: 'generating'|'new'|'stale'|'reviewed', sourceSignature: string, provenance:
[{ anchor: paragraphId, refs: StorySourceRef[] }], protectedBlocks: [{ anchor, text }],
pinnedQuotes: [{ anchor, text, sourceRef? }], imagePlacements: [{ imageId, afterAnchor,
caption }], lastGeneratedAt, lastReviewedAt? }`.
- **`StorySourceRefSchema`** — a discriminated pointer reusing existing provenance vocabulary:
  `{ kind: 'insight'|'intakeAnswer'|'response'|'dream'|'test'|'goal'|'challenge'|'together'|
'timeline'|'photo', id, at? }` (deep-linkable; the Insight-provenance pattern).
- **`DraftCommentSchema`** — `{ schemaVersion:1, id, chapterId, anchor, text, status:
'open'|'applied'|'dismissed', createdAt, appliedRevision? }`.
- **`ExclusionListSchema`** — `{ schemaVersion:1, items: [{ id, kind:
'passage'|'topic'|'person'|'source', value: string (topic text / personId / StorySourceRef /
passage fingerprint), note?, createdAt }] }`.
- **`StoryInterviewStateSchema`** — `{ schemaVersion:1, askedPrompts: string[], frameworkCoverage:
{ chapters: boolean, scenes: Record<McAdamsScene, boolean>, challenges, ideology, futureScript },
photoAnswers: [{ imageId, question, answer, at }], lastGapPassAt?, openCheckinAssignmentId? }`.
- **`StoryImageIndexSchema`** — `{ schemaVersion:1, images: [{ id, kind: 'uploaded'|'generated'|
'cover', mime, caption?, visionNotes?, chapterId?, createdAt }] }`.
- **`QuestionnaireSchema` (additive)** — optional `storyProvenance?: { bookId, gapBrief,
generatedAt }` on the definition (mirrors `autoCheckin` provenance; no version bump).
- **Device-local (additive `DeviceStateSchema`)** — `storyReadProgress?: Record<personId,
Record<bookId, lastReadAt>>` and `storyRefreshCheckedAt?: Record<personId, timestamp>` (the
  spec-63 throttle pattern).

**BookType registry (code, not vault)** — `packages/core/src/story/bookTypes.ts`:
`{ id, label, doctrine: string (system-prompt addendum), structures, stylePresets, interview:
framework config, gates: { adult?: boolean } }`. v1 registers `biography`. The registry is the
extension point for future types; nothing else in the pipeline hard-codes "biography".

## 5. Architecture & modules

New core module **`packages/core/src/story/`** (top-level, like `autoCheckins/` — avoids import
cycles; it imports `questionnaires`, `insights`, `people`, never the reverse).

### 5.1 `storyCorpus.ts` — the all-data read (deterministic, no AI)

Assembles the subject's complete material, organized by life-area and date, every item carrying a
`StorySourceRef`:

- Person profile — **all fields including locked/private** (`profileLines(person,'self')`
  precedent: the subject reading their own data).
- Intake — full raw answers **including restricted sections** (weighs/intimacy) and the portrait.
- Insights — all **approved** insights + facts including `restricted` (subject's own), with
  `flaggedInaccurate` facts/insights **always excluded** (they're wrong, not private).
- Questionnaire raw Q→A (own responses, incl. auto check-ins), goals, challenges (+reflections),
  dreams + analyses (**excluding** dreams with `informsContext:false` — muted means muted), test
  results as **display bands/subscales only — `clinicalKey` never enters the corpus** (spec-51
  invariant), timeline events.
- Together — **viewer-projection only**: own asides, shared messages, shared reports, agreements,
  own pulse; the partner's asides/private state are structurally absent (spec 58).
- Other people appear as characters via (a) the subject's own statements about them and (b) facts
  those people share **to this viewer** through the existing `factSharedWithViewer` gate — never
  their private data.
- The **ExclusionList filters here**, at the corpus boundary — excluded topics/people/sources never
  reach any story prompt again.

Scoping rule (the §24 pattern): this all-data read exists **only** inside story generation.
`buildContext`, coaching, Memory, and every other surface keep their existing gates unchanged.

### 5.2 `storyPromptBuilder.ts` — the Biographer

`BIOGRAPHER_SYSTEM` = SAFETY-derived boundary + the **Biographer's Doctrine** (the craft
principles: scene-first — "make the reader see the scene"; sense of place; chronology withholding
hindsight; situation vs story; the double perspective; portrait-not-autopsy; honest epistemics —
"the record doesn't say"; never exaggerate/fabricate — a missing detail becomes an interview
question, never an invention) + the **banned-prose contract** (the tapestry/testament/delve
vocabulary cluster, "not just X but Y", "I learned that…" moralizing, summary-only chapters, false
omniscience about others' inner lives, redemption-washing, diagnostic labels) + voice/style/length
config + third-party ethics defaults (§8.4) + the FORMATTING contract (34) extended with the
provenance-marker instruction. Per-call user messages carry: essence, outline context (neighboring
chapter briefs for continuity), the chapter brief, the corpus slice, exclusions, pinned quotes,
protected blocks.

### 5.3 `storyGenerationService.ts` — the orchestrator (the one genuinely new engine)

No SelfOS feature currently assembles one artifact across multiple AI calls; this service does,
as a **queue of independent bounded calls** (each metered, each budget-gated, resumable):

- `generateFoundations` → essence + timeline + outline (`story.outline`, maxTokens ~8000, tolerant
  parse + salvage per spec 37).
- `generateChapter(chapterId)` → chapter markdown (`story.chapter`, maxTokens ~8000,
  `extendedThinking:false`). The model emits per-paragraph source markers
  (`[[SRC:ref,ref]]`) which are **stripped from the stored markdown** and captured into
  `chapter.provenance` (the stripCoachMarkers pattern — markers never render).
- `reviseChapter(chapterId, {comments|instruction, range?})` → targeted revision
  (`story.chapter`, smaller budget); marks comments applied.
- **Protected-block enforcement is code, not prompt**: after any (re)generation, protected blocks
  and pinned quotes are verified present byte-verbatim; a violating draft has the blocks
  re-inserted at their anchors (deterministic splice) before save.
- **Queue semantics**: chapters generate sequentially; `BUDGET` stops the queue cleanly (state
  `generating` persists; the cadence hook resumes next period) — the spec-63 `budgetHit` pattern.
- Meter-before-parse everywhere; failures surface honestly (TRUNCATED/MALFORMED/REFUSED — 37).

### 5.4 `storyFreshness.ts` — the living-book engine

`sourceSignature` computation + diffing; stale marking; the weekly auto-rewrite allocator
(`STORY_WEEKLY_AUTO_CAP = 10` rolling 7-day chapter rewrites, owner override bypass — the
`SYNTHESIS_WEEKLY_CAP` pattern); `StructuralProposal` generation (stored alongside outline;
approve/dismiss). Renderer cadence hook `useStoryRefresh()` (launch/focus, device-local daily
throttle) — the spec-63 hook verbatim.

### 5.5 `storyInterviewService.ts` — gaps → questions

Gap pass (`story.interview`) over outline + coverage + corpus stats → prioritized gaps; mints story
check-ins via `generateQuestions` (FOCUS = gap brief; `dedupReference` = the §24 bundle + this
book's `askedPrompts`) + `createAssignment` (in-app self-send, `storyProvenance`); photo vision
analysis + question generation. Completeness meter = deterministic coverage % over the framework
map + chapter thinness (no AI).

### 5.6 IPC seam, capability, settings, usage types

- Capability **`story.own`** (Member ON; label "Your Story"). No new EXPLICIT_GRANT_ONLY caps.
- Usage types: `story.outline`, `story.chapter`, `story.interview`, `story.imagePrompt` (distill),
  `story.image` (flat, IMAGE_PRICING).
- Settings: none global in v1 — per-book config lives on the manifest (autoRefresh, voice, style).
- Channels (all gated `story.own` + active-person-scoped in the bridge; Zod-validated; keys stay
  host-side): `story:list`, `story:create`, `story:get` (manifest+outline+chapters meta),
  `story:getChapter`, `story:approveOutline`, `story:updateOutline`, `story:generate` (foundations
  | chapter | all-stale), `story:reviewChapter`, `story:editPassage`, `story:pinQuote`,
  `story:comment` / `story:applyComments`, `story:exclude` / `story:unexclude`,
  `story:proposals` / `story:resolveProposal`, `story:refreshCheck` (cadence),
  `story:interviewRun`, `story:photoUpload` / `story:photoAnswer`, `story:generateCover` /
  `story:illustrate`, `story:getImage`, `story:share` / `story:revokeShare`,
  `story:sharedBooks` / `story:readShared` (viewer-scoped, **published head only**, read-time
  re-gate), `story:publish`, `story:export`, `story:delete`.
- New host op **`saveFile(suggestedName, bytes, mime)`** generalizing `saveImageFile`
  (+ `SELFOS_FAKE_SAVE_DIR`); PDF via a hidden window + `webContents.printToPDF` in main.

### 5.7 Renderer

- Route `/story` + per-chapter drill-in; per-person Zustand `storyStore` (reset registered in the
  AppShell per-person list — the standing rule).
- **Book renderer**: composes the existing safe `<Markdown>` primitive per text segment,
  interleaving image placements (decrypted via `story:getImage` object URLs) and pull-quotes —
  images never travel through markdown syntax (the model never emits image markdown; the renderer
  owns placement), so spec 34's no-image safety invariant is preserved.
- Reader-view typography: percentage-based measure (§11 sign-off), print CSS shared with the PDF
  export.
- Notification kind `story-shared` (+ `story-proposal` for pending structural approvals);
  recommendation provider `story`.

### 5.8 Relay-readiness (not v1)

The zero-knowledge relay can later carry a read-only book page (sealed published snapshot + PIN);
nothing in v1 may preclude it (the published head is already a self-contained snapshot).

### 5.9–5.11 Later phases in this spec

Story interview **sessions** (conversational): an ordinary Conversation carrying a story addendum
(the guided-session mechanism) seeded with the current gap FOCUS; its session analysis feeds the
corpus like any session. Household contributions; editions. Each is additive.

### 5.12 Build phases (each its own PR-gated slice, standard §6/§7 cadence)

- **A — Foundation**: schemas + vault layout + `story.own` + `story.*` usage types + the BookType
  registry + **the corpus builder with every §5.1 gate unit-tested** + IPC skeleton + nav/route/
  store + the creation flow + foundations pass + outline review UI.
- **B — Chapters**: the generation orchestrator + provenance capture + the draft reading view
  (source popovers, deep links) + "Refresh now" + honest failure states.
- **C — Collaboration**: comments → apply-with-AI; direct edits + protected blocks (code-enforced);
  exclusions (all four scopes) + seam-smoothing revision; pinned quotes; the flag-to-Memory
  hand-off.
- **D — Living book**: source signatures + the cadence hook + weekly-capped auto-rewrites +
  structural proposals + the Home recommendation provider.
- **E — Interviews**: the gap pass + story check-ins through the questionnaire pipeline (Inbox
  eyebrow + rationale) + the completeness meter.
- **F — Readers & publishing**: publish snapshot + per-person grants + the shared-books surface +
  the `story-shared` notification + read-time re-gates + the reader view.
- **G — Export**: the generic `saveFile` host op + Markdown export + print CSS + PDF.
- **H — Images**: uploads + vision Q&A + placements/captions + cover generation + chapter
  illustrations + Lightbox integration.
- **Post-v1 fast-follows** (ordering per §11): story interview sessions; household contributions;
  the relay reader page; EPUB; editions history.

## 6. IPC / API contracts

§5.6 lists the channels; shapes are Zod schemas in `channels.ts` per the established seam
(channels → coreBridge (trust boundary) → ipc → preload → test-utils). Claude usage: model =
the global `ai.model`; every structured call passes `extendedThinking:false`; prompt-cache the
stable BIOGRAPHER_SYSTEM prefix; tolerant parse + salvage (37); meter before parse; image calls
follow the spec-13 two-call flow. Failure surfaces: NO_KEY/AI_OFF → role-aware setup notice (41);
BUDGET → calm "resumes next week" state; REFUSED/TRUNCATED/MALFORMED → honest per-chapter error
with retry. The renderer never sees keys or raw model replies.

## 7. States & edge cases

- **Thin corpus** (new user): foundations still run; the outline proposes fewer, broader chapters
  and the book opens with an elegant short draft + prominent interview invitations — never empty
  scaffolding or an error.
- **Generation interrupted** (quit/crash/budget mid-queue): chapters are independent files;
  `generating` status persists and the queue resumes on next cadence/`Refresh now`. No partial
  chapter is ever saved (a chapter write is atomic and post-validated).
- **Over budget**: queue pauses with an honest state; auto-refresh skips the week; owner override
  proceeds (06).
- **AI off / no key**: existing book remains fully readable/editable/exportable (only generation,
  interviews, and images need AI) — role-aware notice otherwise (31/41).
- **Crisis signal active**: all story generation + story check-ins suppressed (63 precedent);
  draft/reader surfaces stay available; §8.2.
- **Conflicting sources**: the doctrine requires naming discrepancies honestly or asking (a
  gap-pass "verification" question) — never silently picking one.
- **Excluded person is a reader**: exclusion governs content; grants govern access — both apply
  independently.
- **Reader revoked / person deleted**: read-time re-gate denies; person-delete reaps their story
  tree + their grants on others' books (the spec-58 reap pattern).
- **Sync conflict on a chapter**: standard vault conflict banner; chapters are per-file so blast
  radius is one chapter; last-write-wins with the conflict copy surfaced (00).
- **Corrupt chapter/manifest**: fails closed per file — the book renders remaining chapters and
  offers regeneration of the corrupt one; exclusions/interview state `.catch` to safe defaults
  (never fail open into un-excluding).
- **Large books**: chapters lazy-load (list shows metadata only); the corpus builder caps
  per-chapter slices by relevance + recency budgets (the §24 cap pattern).
- **Photo edge cases**: unsupported mime/oversize rejected calmly (45); vision failure keeps the
  photo with a manual caption path.

## 8. Safety

1. **Not-medical boundary.** The book is a wellness reflection artifact, not an assessment. The
   colophon and "A Note on this book" carry the standard boundary line; the biographer's doctrine
   enforces **portrait, not autopsy**: test data may inform characterization ("she runs anxious
   before big decisions") but clinical instruments, scores, bands, and diagnostic language never
   appear in prose (the spec-51 never-shown invariant extends into the corpus itself — display
   bands only, and the prompt forbids clinical framing).
2. **Crisis.** Generation and story check-ins are suppressed while `aggregateCrisisSignal` is
   recurring (Home leads with support instead — 40/53); crisis-flagged source material is written
   with the trauma-pacing doctrine (scene + reflective distance, exits and breathing room, no
   gratuitous detail, no redemption-washing); the draft view shows the standard crisis-resources
   footer when the book draws on crisis-flagged sources.
3. **All-data scope.** The corpus's restricted-data read is an owner-approved, story-scoped
   exception (the §24 precedent, decision 2026-07-15): the draft is private to its subject until
   they publish; the **review-then-publish gate is the safety mechanism** for anything reaching
   another person. Nothing bypasses it: readers can only ever receive the published head of
   Reviewed chapters.
4. **Third parties.** Other people's private data never enters the corpus (only viewer-shared
   facts + the subject's own statements); Together material is viewer-projected (partner asides
   structurally absent); the prose ethics defaults: no false omniscience about others' inner
   lives, motive-empathy for antagonists, role-names available per person (an exclusion-panel
   "use a pseudonym for X" option), and the reader-grant awareness note (§3.5). The
   never-disclose-owner-access rule is untouched (nothing here discloses anything about admin
   access).
5. **Fabrication.** The doctrine's hard rule: never invent scenes, dialogue, dates, or sensory
   detail. A gap produces an interview question, never fiction. Reconstructed dialogue is marked.
6. **18+.** The v1 biography is not adult-gated (it's the subject's own data, private by default),
   but intimate material follows the register of the source (frank where the person was frank,
   never gratuitous); the future erotica BookType declares `gates.adult` and reuses the shared ack.

## 9. Accessibility

Keyboard-completable throughout (chapter list, paragraph affordance menus via focusable buttons,
comment threads, outline editor); `aria-expanded`/`aria-controls` on collapsibles; the reader view
uses semantic headings matching the ToC hierarchy + a skip-to-chapter nav; provenance popovers are
focus-trapped and Esc-dismissable; status chips carry text (never color-only); generated images
require captions/alt (the photo Q&A supplies them; alt falls back to the caption); reduced-motion
respected on progress/transition affordances; contrast per tokens (01).

## 10. Testing strategy

- **Unit (core)**: corpus gates (flagged excluded; muted dreams excluded; `clinicalKey` absent —
  a string-level guard over the serialized corpus; Together partner-asides absent; exclusions
  filter by each kind; §24 scoping — `buildContext` byte-identical with story present); signature
  staleness truth table; protected-block/pinned-quote enforcement (model output that mangles them
  is corrected deterministically); provenance-marker strip + capture; queue resume after BUDGET;
  weekly cap; publish snapshot isolation (draft edits after publish don't leak); gap pass never
  re-asks (dedup against askedPrompts + corpus); tolerant parses (imperfect fakes).
- **Bridge (two-persona, decrypt-level)**: reader sees published head only — never draft, never
  unpublished revisions; revoke re-gates at read; non-reader denied; grants survive/reap on
  person-delete; export produces plaintext markdown OUTSIDE the vault while chapters at rest stay
  AES-GCM envelopes.
- **RTL**: outline editor; chapter pane affordances (comment/apply, exclude scopes, pin, edit →
  protected); proposals approve/dismiss; reader "what's new"; calm AI-off/budget states.
- **E2E (Playwright, offline fakes — new fake-Claude branches keyed on unique prompt markers for
  outline/chapter/revise/interview, deliberately imperfect; `SELFOS_FAKE_IMAGE`;
  `SELFOS_FAKE_SAVE_DIR`)**: the crown jewel — seed a rich persona → create book → approve outline
  → chapters generate → provenance deep-link opens the source → comment → apply → exclude a topic
  → regenerate (excluded content stays gone — decrypt-level assert) → publish → grant reader →
  switch persona → reader sees published book but NOT a post-publish draft edit → revoke → denied
  → export .md + PDF (files exist outside vault; .md contains the chapter text; vault chapter
  still encrypted). Plus: photo upload → vision questions → answer → caption renders; crisis seed
  suppresses generation; 360px overflow guards + full-surface-renders-to-bottom on draft AND
  reader; the §7 whole-flow coherence walk.

## 11. Open questions

1. **Reader measure vs the §12 full-width rule.** A book reader wants a readable measure. Proposal:
   a percentage-based column (~70%, the chat-bubble precedent) for the reader view only — needs
   the owner's explicit sign-off as a §12 exception.
2. **Household contributions** (family-submitted questions + attributed quotes through the
   existing send machinery) — recommended as the first fast-follow after v1 (it's the market's
   most-loved feature). Confirm placement.
3. **Story interview sessions** (the conversational deep-scene interviewer) — recommended as the
   final v1 phase or first fast-follow; confirm appetite.
4. **Default book length** — recommend `standard` ≈ 10–18 chapters, 1,500–3,000 words each
   (craft target is 2,500–5,000; we start shorter for cost/iteration and let `full` reach craft
   length). Confirm.
5. **Cover timing** — recommend on-demand only (never auto-spend an image). Confirm.
6. **Nav label** — "Your Story" (recommended) vs "Story".
7. **`STORY_WEEKLY_AUTO_CAP` = 10** chapter auto-rewrites/week — confirm the number.

## 12. Changelog

- 2026-07-15 — created (Draft). Eight foundational decisions locked with the owner this date:
  all-data corpus with draft-level curation and one book (draft → published head); encrypted at
  rest with .md/PDF export; third-person default voice; hybrid auto updates; both interview
  surfaces (questionnaires v1, sessions later); household per-person readers; publish-after-review
  gate; Markdown + PDF exports. Grounded in the 2026-07-15 research pass (data/infra inventories;
  competitor research: StoryWorth/Remento/Autobiographer et al.; craft research: Caro, Isaacson,
  Karr, Gornick, Lee, Lopate, McAdams Life Story Interview, StoryCorps/Smithsonian oral-history
  practice).
