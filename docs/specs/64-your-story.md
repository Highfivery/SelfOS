# 64 — Your Story (living biography & book projects)

> **Status:** **Approved** — _last updated 2026-07-15_
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

> **2026-07-17:** the _surface layouts_ in §3.1–§3.6 are superseded by the approved full-surface
> redesign in **§13 (the Studio & the Book)**. Every _mechanic_ defined here — the markup model,
> batch Review & apply, the publish gate, the interview engine, exclusions, freshness — is unchanged
> and referenced from §13.

### 3.1 Entry & navigation

- New top-level nav entry **"Your Story"** (book icon), route `/story`, gated on `story.own`
  (Member default ON; Guest none). Registered per the feature-module conventions (02).
- Home surfaces (spec 53/60 engine): a `story` recommendation provider ("Your story grew — Chapter
  7 has new material to weave in", "3 questions could fill a gap in your twenties"); no bespoke
  Home card.

### 3.2 First run — creating the book

1. `/story` empty state explains the feature (and its privacy model: "written from your private
   vault; nobody sees it until you share") → **"Start your story"**.
2. **Setup (one screen, not a wizard)**: title (**optional** — leave it blank and the biographer
   proposes one from your content, editable on outline review; owner decision 2026-07-16), narrative
   voice (**third person** default; first person available), style register (Literary · Warm · Plain ·
   Journalistic · Reflective · Cinematic · Poetic — style presets from the BookType, shown as a
   full-width Select once past what a SegmentedControl holds at phone width, §12), length target
   (Concise · Standard · Full, **default Full** — a biography reads at published-book length; owner
   decision 2026-07-16), and a note that the biographer reads everything it knows unless excluded
   later. No area-picking step — all data feeds the draft (owner decision, 2026-07-15; §8.3 governs
   safety).
3. **Create-and-draft (one flow, no outline-review gate; owner decision 2026-07-16)** — creating a book
   drafts it end-to-end in the **main process**: the **foundations pass** (a proposed title drawn from the
   through-line, applied only when the person left the title blank — `BookManifest.titleAuto`; the essence,
   timeline, and outline), the outline is **auto-approved**, then every chapter is drafted (queued,
   budget-gated so an over-budget stop resumes cleanly next period). The person shapes the finished book
   with the edit/markup/suggest tools (§3.3) rather than a gate — the title stays editable in place on the
   overview.
   - A rich **"Writing your story"** progress screen shows real-time status streamed over the
     `story:progress` event: the phase (reading → `Writing "<chapter>" — chapter N of M`), a determinate
     progress bar + chapter dots, an **elapsed timer** and an **improving time estimate** (from the observed
     per-chapter pace), and a clear "you can keep using SelfOS — this continues in the background" note.
   - Because the draft runs in main, it **continues if the person navigates away**; a live **"Your Story ·
     N/M" sidebar indicator** shows progress from any page, and returning to `/story` shows the live screen.
     The store's `progress` (fed by the stream, subscribed at app level) survives navigation; a failed draft
     lands on the retry state, never a dead-end.
   - The same real-time progress drives **writing remaining chapters** from the overview (after an approved
     structural change or a budget stop) — shown **inline** in the overview (`progress.scope: 'chapters'`, a
     renderer-only flag) rather than a full-screen takeover, so the book stays in view. Single-chapter ops
     (rewrite one chapter, apply a markup revision) keep their inline button label.

### 3.3 The Draft view (the control room)

- `/story` shows the **book overview**: cover (or placeholder), completeness meter ("Your story is
  ~64% told" — §5.6), the **chapters grid** (see below), pending structural proposals, pending
  interview nudges, and actions (Refresh now · Share & readers · Export).
- **Chapters grid (redesign, owner decision 2026-07-16):** chapters render as a responsive grid of
  **portrait, cover-backed cards** grouped by part (a part eyebrow + title + chapter count over each
  grid), inspired by a modern media grid. Each card's **background is the book's generated cover** —
  or, where a chapter has its own illustration (§3.8), that image takes over as the card background,
  so the grid grows richer as art is added; a warm gradient stands in until a cover exists. A dark
  bottom scrim keeps the overlaid **chapter number + title** legible; a status pill (New · Updated ·
  New material · Writing… · Reviewed) reads at a glance; hovering reveals a "Read ›" affordance. An
  approved-but-unwritten chapter shell shows as a calm dashed "Not yet written" card. No horizontal
  overflow at phone width (§12).
- Opening a chapter shows **rendered prose** (book renderer, §5.9). Marking it up is
  **selection-based**: highlighting any span (word → paragraph) raises a contextual toolbar
  (Delete · Edit · Comment · To-do · Pin · Exclude · Sources). A per-paragraph affordance handle
  also opens the same toolbar for touch/keyboard users (a highlight isn't required — the toolbar is
  reachable from a focusable paragraph menu). The marks a person places form a visible
  **suggestion layer** over the chapter (deletions struck through, comments/to-dos anchored in the
  margin); they are reviewed and applied together (§3.3.1), not one AI call per action.
  - **Delete** — mark a span to cut. Struck through in place, pending until applied; the applying
    revision removes it and smooths the seam. (One-time, chapter-local — distinct from Exclude.)
  - **Edit** — replace a span with the person's own words (inline Textarea). Applies **instantly,
    no AI** (it's their text), and the edited span becomes a **protected block** later rewrites
    must preserve verbatim (code-enforced, §5.4).
  - **Comment** — anchored feedback carrying an **intent**: _Add context_ ("the lathe was my
    grandfather's — mention it's three generations old"), _Fix this_ ("my sister wasn't there — it
    was my cousin"), or _Question_ ("why did you frame it this way?"). A _Fix this_ comment on a
    provenance-linked fact also offers the existing **flag-inaccurate** action on the underlying
    insight — fixing the book **and** Memory (specs 20/44).
  - **To-do** — a tracked task anchored to the span/chapter (§3.3.2).
  - **Pin** — mark a sentence untouchable "in your own words" (rendered as a pull-quote; applies
    instantly, never paraphrased by any rewrite).
  - **Exclude** — the durable "never write about this again" action, scoped: _this passage_ ·
    _this topic_ · _this person_ · _this source_. Writes an `ExclusionItem`; the passage disappears
    and every future generation filters it at the **corpus level** (§5.2) so it can't be
    reintroduced. An **Exclusions panel** on the overview lists and un-excludes items. (Delete cuts
    _here_; Exclude bars _everywhere_.)
  - **Sources** — a popover of the span's provenance with deep links to each source surface (Memory
    insight, session, dream, intake answer, photo), the spec-20 provenance pattern.

#### 3.3.1 Review & apply (batch — owner decision, 2026-07-15)

- Pending marks accumulate; the chapter shows a **"N changes ready to apply"** bar (e.g. "1 cut · 1
  comment · 1 to-do"). **Apply changes** runs **one** metered revision (`story.chapter`, §5.3) that
  honors every pending delete + comment (and any to-dos marked "hand to biographer") and smooths
  seams — respecting protected edits, pinned quotes, and exclusions. Pending marks become
  _applied_; the chapter goes to status **Updated** for review.
- Instant, no-AI marks (inline **Edit**, **Pin**, **Exclude**) take effect immediately and don't
  wait for a batch — but Exclude also queues the chapter for a smoothing pass folded into the next
  Apply/refresh. **Review** previews the pending set before applying; individual marks are
  undoable before Apply.
- **Chapter review**: a freshly generated or auto-rewritten chapter is status **New/Updated** with
  a "what changed" affordance; **"Looks good"** marks it **Reviewed**. Only Reviewed content
  publishes (§3.5).

#### 3.3.2 To-dos (owner decision, 2026-07-15)

A to-do is a tracked note that carries **which kind** it is, with three actions:

- **Remind me** — a personal checklist item the AI never touches ("upload the photo of Dad's
  shop"); the person checks it off themselves.
- **Ask my biographer** — an instruction folded into the next Apply/refresh revision ("go deeper on
  the winter he got sick — this chapter skips it").
- **Turn into questions** — hands the to-do to the **interview engine** (§5.5): mints a targeted
  story check-in (FOCUS = the to-do text) through the existing generate + de-dup pipeline to gather
  the missing details / go deeper / fill the gap. Answers flow back through the normal analysis →
  insight → corpus loop and (typically) stale the chapter, which then weaves them in.

To-dos render inline where placed **and** collect in a book-level **"To do"** list on the overview,
so nothing is lost across chapters. Each shows its kind and its status (open / done / questions
sent).

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

- **Story settings section (owner decision, 2026-07-16)**: a **collapsible "Story settings"** section on the
  Your Story book overview is the cohesive home for configuring THIS book — never a lone control jammed under
  another card. It has two groups: **Writing** (narrative voice · tone/style register · length · auto-refresh
  — all editable post-creation, persisted to `BookConfig` via `storyUpdate`; changes steer FUTURE rewrites,
  existing chapters keep their text until re-drafted/refreshed) and **Images** — this book's **own** image
  style (`BookConfig.imageStyle`, a grouped preset select + a **Custom…** free-text option) + a **style
  direction** note (`BookConfig.imageStyleNotes`). The story's image style is **independent of the dream-image
  style**: `generateStoryImage` uses `book.config.imageStyle`/`imageStyleNotes` when set, falling back to the
  global `dreams.imageStyle` for a book that hasn't chosen its own (additive-optional, no migration). The
  reusable `ImageStylePicker` is shared with the dream-image `ImageStyleControl` in Settings → Images (which
  keeps the OpenAI model + key). A control belongs where the work happens (CLAUDE.md §12).
- **Realtime progress (mandatory, CLAUDE.md §12)**: every image/vision generation — cover, chapter
  illustration, dream image, photo vision — shows a live **phase** (`Composing the scene…` → `Painting
the image…`, or `Reading your photo…`), an **elapsed timer**, and an **ETA**, never a bare spinner. The
  generation runs in main and streams `image:progress` phase events (its own channel, `emitImageProgress`
  → preload → the shared `ImageProgress` renderer); vision is a single phase carried by the timer alone.
- **Cover**: "Create a cover" on the book overview → the spec-13 two-call flow (Claude distills a
  **name-free, symbolic** cover brief in the book's image style; OpenAI renders; never a photoreal likeness)
  → cover stored encrypted; regenerate at will; admin-only cost shown (13 §-precedent).
- **Chapter illustrations**: "Illustrate this chapter" — same flow seeded from the chapter's
  distilled themes. On-demand only (no auto image spend). The button appears **only when image
  generation is set up** (consent on + AI on + an OpenAI key); otherwise the Images card shows a calm
  role-aware setup note (never a dead control), and generation errors surface **in the card**.
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
  markup/<chapterId>.enc   ChapterMarkup        (the suggestion layer: comments, deletes, to-dos)
  todos.enc                StoryTodoList        (book-level roll-up of every to-do)
  exclusions.enc           ExclusionList
  interview.enc            StoryInterviewState
  images/index.enc         StoryImageIndex
  images/<imageId>.enc     encryptBytes (uploads + generated illustrations + cover bytes)
```

Zod schemas (in `packages/core/src/schemas.ts` unless noted; names final at implementation):

- **`BookManifestSchema`** — `{ schemaVersion:1, id, personId, type: BookTypeId ('biography'),
title, titleAuto?: boolean (the title was app-assigned — a placeholder or the AI-proposed title — so
the foundations pass may overwrite it; cleared once the person edits the title), config: {
voice:'third'|'first', style:'literary'|'warm'|'plain'|'journalistic'|'reflective'|'cinematic'|'poetic',
length:'concise'|'standard'|'full' (default 'full'), autoRefresh: boolean (default true) }, essence?:
string, status:'outlining'|'drafting'|'ready', coverImageId?, sharedWith: string[] (person ids),
createdAt, updatedAt, publishedAt? }`.
- **`BookOutlineSchema`** — `{ schemaVersion:1, approved: boolean, parts: [{ id, title, chapters:
[{ id, title, brief, eraFrom?, eraTo?, lifeAreas: LifeArea[], order }] }] }`.
- **`LifeTimelineSchema`** — `{ schemaVersion:1, events: [{ id, date?: string, approx?: string,
label, sourceRef?: StorySourceRef, userEdited: boolean }] }` — user-editable; the chronology
  spine.
- **`BookChapterSchema`** — `{ schemaVersion:1, id, partId, order, title, markdown, revision:
number, status: 'generating'|'new'|'updated'|'stale'|'reviewed', sourceSignature: string, provenance:
[{ anchor: paragraphId, refs: StorySourceRef[] }], protectedBlocks: [{ anchor: TextAnchor, text }],
pinnedQuotes: [{ anchor: TextAnchor, text, sourceRef? }], imagePlacements: [{ imageId, afterAnchor,
caption }], lastGeneratedAt, lastReviewedAt? }`.
- **`TextAnchorSchema`** — the shared span pointer that survives light re-flow: `{ paragraphId,
quote?: string (the exact selected text), prefix?: string, suffix?: string }` — resolved against
  the live markdown by exact-then-fuzzy match (the standard text-quote-anchor approach).
  Paragraph-level marks omit `quote`. An anchor that no longer resolves after a rewrite is surfaced
  as **orphaned** (never silently dropped, never silently reapplied).
- **`StorySourceRefSchema`** — a discriminated pointer reusing existing provenance vocabulary:
  `{ kind: 'insight'|'intakeAnswer'|'response'|'dream'|'test'|'goal'|'challenge'|'together'|
'timeline'|'photo', id, at? }` (deep-linkable; the Insight-provenance pattern).
- **`ChapterMarkupSchema`** — the per-chapter suggestion layer: `{ schemaVersion:1, chapterId,
marks: MarkupMark[] }`. **`MarkupMarkSchema`** (discriminated on `kind`):
  - `comment` — `{ id, kind:'comment', anchor: TextAnchor, intent:
'addContext'|'fix'|'question', text, status: 'open'|'applied'|'dismissed', createdAt,
appliedRevision?, flagInsightId? (a 'fix' may drive the Memory flag-inaccurate hand-off) }`.
  - `delete` — `{ id, kind:'delete', anchor: TextAnchor, status: 'pending'|'applied'|'undone',
createdAt, appliedRevision? }`.
  - `todo` — `{ id, kind:'todo', anchor?: TextAnchor, text, todoKind:
'remind'|'ask'|'questions', status: 'open'|'done'|'questionsSent'|'applied', assignmentId?, createdAt }`.
  - Instant/no-AI marks (`edit`→`protectedBlocks`, `pin`→`pinnedQuotes`) live on the chapter, not
    the markup layer, because they apply immediately; the markup layer holds only the pending batch
    (deletes, comments, ask/questions to-dos) plus personal `remind` to-dos.
- **`StoryTodoListSchema`** — `{ schemaVersion:1, todos: [{ id, chapterId, kind, text, status,
createdAt }] }` — a denormalized book-level roll-up (source of truth stays each chapter's markup)
  so the overview "To do" list needs one read, not N.
- **`ExclusionListSchema`** — `{ schemaVersion:1, items: [{ id, kind:
'passage'|'topic'|'person'|'source', value: string, note?, createdAt }] }`. `value` by kind: `topic`
  = the topic phrase; `passage` = the excluded passage's **text** (a text-avoidance phrase, not a hash,
  so the corpus can substring-match it); `person` = the person id (the corpus ALSO avoids that person's
  display name in free text, so the subject's own mentions are dropped, not just cross-shared facts);
  `source` = a `StorySourceRef` id.
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
- `applyMarkup(chapterId)` → **the batch revision** (§3.3.1): reads the chapter's pending markup
  (deletes + comments + `ask`/`questions` to-dos) and runs **one** `story.chapter` revision whose
  user message carries the current markdown + each pending mark rendered as an instruction (a
  `delete` → "cut this span: «quote»"; an `addContext` comment → "weave in: «text» near «quote»"; a
  `fix` → "correct: «text»"; an `ask` to-do → "«text»"). Protected blocks, pinned quotes, and
  exclusions are enforced (below). On success, every included mark → `applied` (stamped with the new
  `revision`); the chapter → `updated`. Deterministic marks (inline edit, pin, exclude) are already
  in the chapter before this runs. A `questions` to-do does **not** go to this call — it routes to
  §5.5.
- **Protected-block enforcement is code, not prompt**: after any (re)generation or `applyMarkup`,
  protected blocks and pinned quotes are verified present byte-verbatim; a violating draft has the
  blocks re-inserted at their anchors (deterministic splice) before save. `TextAnchor`s are
  re-resolved after every rewrite; a mark whose anchor no longer resolves is left **orphaned** for
  the person to re-place — never silently dropped or reapplied to the wrong span.
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

**To-do → questions** (§3.3.2): a `questions` to-do calls the same minting path with **FOCUS = the
to-do text** (e.g. "the winter Dad got sick"), producing a targeted check-in rather than a
framework-gap one; the to-do goes `questionsSent` and stores the `assignmentId`, so its status can
reflect when the answers land (and it auto-closes once the resulting insight reaches the corpus).
This is the one bridge from the markup layer into the interview engine — no new generation code, a
different FOCUS.

### 5.6 IPC seam, capability, settings, usage types

- Capability **`story.own`** (Member ON; label "Your Story"). No new EXPLICIT_GRANT_ONLY caps.
- Usage types: `story.outline`, `story.chapter`, `story.interview`, `story.imagePrompt` (distill),
  `story.image` (flat, IMAGE_PRICING).
- Settings: none global in v1 — per-book config lives on the manifest (autoRefresh, voice, style).
- Channels (all gated `story.own` + active-person-scoped in the bridge; Zod-validated; keys stay
  host-side): `story:list`, `story:create`, `story:get` (manifest+outline+chapters meta),
  `story:getChapter` (+ its markup layer), `story:approveOutline`, `story:updateOutline`,
  `story:generate` (foundations | chapter | all-stale), `story:reviewChapter`, `story:editPassage`
  (instant, → protected block), `story:pinQuote`, `story:mark` / `story:updateMark` /
  `story:removeMark` (add/edit/undo a comment · delete · to-do in the markup layer),
  `story:applyMarkup` (the batch revision), `story:todos` (book-level roll-up) /
  `story:todoToQuestions` (§5.5), `story:exclude` / `story:unexclude`,
  `story:proposals` / `story:resolveProposal`, `story:refreshCheck` (cadence),
  `story:interviewRun`, `story:photoUpload` / `story:photoAnswer`, `story:generateCover` /
  `story:illustrate`, `story:getImage`, `story:share` / `story:revokeShare`,
  `story:sharedBooks` / `story:readShared` (viewer-scoped, **published head only**, read-time
  re-gate), `story:publish`, `story:export`, `story:delete`.
- New host op **`saveFile(suggestedName, bytes, mime)`** generalizing `saveImageFile`
  (+ `SELFOS_FAKE_SAVE_DIR`); PDF via a hidden window + `webContents.printToPDF` in main.
- **2026-07-17:** the §13 redesign adds `story:gaps`, `story:askGap`, `story:corpusStats`, a
  `head: 'draft' | 'published'` input on both exports, `rewriteBookFromScratch`, and the read-receipt
  read/write — see §13.6.

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
- **C — Collaboration (the markup layer)**: selection toolbar + text anchors; the suggestion layer
  (delete · comment-with-intent · to-do) + the batch **Review & apply** revision; instant inline
  edits → protected blocks (code-enforced) + pins; exclusions (all four scopes); the book-level "To
  do" list + the to-do→questions bridge; the flag-to-Memory hand-off. (This is the largest v1 slice
  — may sub-slice C1 markup/apply, C2 to-dos + exclusions.)
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
  re-asks (dedup against askedPrompts + corpus); tolerant parses (imperfect fakes). **Markup layer**:
  `TextAnchor` resolve (exact + fuzzy + orphan-on-miss, never mis-reapply); `applyMarkup` batches
  all pending marks into ONE revision (call count = 1) honoring deletes/comments/ask-to-dos while
  preserving protected/pinned spans; instant edit/pin/exclude bypass the batch; a `questions` to-do
  routes to the interview minter (not `applyMarkup`) with FOCUS = the to-do text; the to-do
  book-roll-up stays consistent with per-chapter markup.
- **Bridge (two-persona, decrypt-level)**: reader sees published head only — never draft, never
  unpublished revisions; revoke re-gates at read; non-reader denied; grants survive/reap on
  person-delete; export produces plaintext markdown OUTSIDE the vault while chapters at rest stay
  AES-GCM envelopes.
- **RTL**: outline editor; chapter pane affordances (comment/apply, exclude scopes, pin, edit →
  protected); proposals approve/dismiss; reader "what's new"; calm AI-off/budget states.
- **E2E (Playwright, offline fakes)** — BUILT (2026-07-16, `test/story-e2e`). The main-process
  `fakeClaudeClient` gained Your Story branches keyed on each pass's unique prompt phrase (`plan a
biography of` / `WRITE THIS CHAPTER` / `You are REVISING one chapter` / `the biographer taking
stock` / `reviewing the SHAPE`; the vision/distill/placement system prompts) so the whole feature
  is drivable through the real UI (previously the AI passes were reachable only via the bridge, hence
  the core+coreBridge+RTL-only coverage). Three focused walks in `launch.spec.ts` (kept under the
  30s/test budget, the Together lesson): (1) **author spine** — setup (blank title → the biographer
  names it; the added styles; Full default) → outline **rename** → write chapters → read prose + a
  provenance **Sources** popover (a seeded corpus insight makes `[[SRC:s0]]` resolve) → mark a
  paragraph with a comment → **Review & apply** (revised prose) → **exclude** a topic → decrypt the
  manifest (title renamed, `titleAuto` cleared, `config.length='full'`/`style='cinematic'`) + a 360px
  overflow guard; (2) **living book** — create → approve → write → **Refresh from what's new** files a
  structural proposal → **Approve** restructures the outline (a new un-written shell) → the
  completeness **stage** (never a %) → **Find what's missing** → a story-provenance questionnaire is
  minted into the Inbox (decrypt-level); (3) **publish/reader/export/cover** — create → write →
  **Create a cover** (distill→render behind the shared image consent) → mark a chapter **Looks good**
  → **Publish** → grant a household **reader** → **Export as Markdown AND PDF** (both files land OUTSIDE
  the vault; the .md contains the title) → switch persona → a first-share **`story-shared` notification** +
  a **"New" marker** greet the reader → they read the **published head** (title + prose) via "Shared with
  you" → returning clears the marker (device-local read progress). Extended to (4) **photos** — upload →
  Claude vision proposes a caption + questions → answering one feeds the interview corpus. The "Your
  biographer" Inbox eyebrow is asserted in (2). Crisis-suppression of the auto cadence stays a coreBridge
  test (host-side + timing-sensitive).

## 11. Resolved decisions

All prior open questions were resolved with the owner on 2026-07-15 (the recommended option in each
case):

1. **Reader measure — approved §12 exception.** The reader view (only) uses a percentage-based
   readable column (~70%, the chat-bubble precedent). Owner-signed-off exception to the durable
   "no max-width caps" rule (§12) because a book genuinely needs a readable measure; every other
   Your Story surface fills its width normally.
2. **Household contributions — post-v1 fast-follow** (family-submitted questions + attributed
   quotes through the existing send machinery). Not in v1.
3. **Story interview sessions — post-v1 fast-follow.** v1's interview surface is the questionnaire
   check-in (Phase E); the conversational deep-scene interviewer comes after.
4. **Default length — `full`** (owner decision 2026-07-16 — a biography reads at published-book
   length): `full` ≈ 16–24 substantial chapters, ~2,500–5,000 words each; `standard` ≈ 10–18 chapters
   at ~1,500–3,000 words; `concise` shorter still. Length stays selectable in setup.
5. **Cover — on-demand only** (never auto-spend an image).
6. **Nav label — "Your Story."**
7. **`STORY_WEEKLY_AUTO_CAP` = 10** chapter auto-rewrites per rolling 7 days (owner override
   bypasses).

No open questions remain; the spec is Approved and ready for the Phase A slice (§5.12).

## 12. Changelog

- 2026-07-20 — **§13.9 Trust repairs & the draft vault BUILT** (`fix/story-trust-repairs`): protected
  blocks/pinned quotes enforced (PRESERVE + `enforceProtected`) on EVERY generation path, not just
  revisions; `runClaude` truncation continuation (66 §5.1) + honest `TRUNCATED` refusal for chapters
  (never persist a half-finished chapter) + trailing `[[…` fragment strip; per-chapter version history
  (`history/<id>.enc`, cap 20) + the History sheet (compare + restore-any, restore itself undoable) +
  whole-draft `archive/<ts>/` (keep 3) before rewrite-from-scratch; honest outcome states (`aiOff`
  outcome + `throttleReason`, budget/cap-aware refresh notices, begin-flow AI gating, the commission CTA
  renamed "Write my book", a rewrite confirm); the §8.2 crisis footer + "biographer is resting" quiet
  state finally on the surface; `extendedThinking: false` on the story + dream image distillation calls.
- 2026-07-15 — created (Draft). Eight foundational decisions locked with the owner this date:
  all-data corpus with draft-level curation and one book (draft → published head); encrypted at
  rest with .md/PDF export; third-person default voice; hybrid auto updates; both interview
  surfaces (questionnaires v1, sessions later); household per-person readers; publish-after-review
  gate; Markdown + PDF exports. Grounded in the 2026-07-15 research pass (data/infra inventories;
  competitor research: StoryWorth/Remento/Autobiographer et al.; craft research: Caro, Isaacson,
  Karr, Gornick, Lee, Lopate, McAdams Life Story Interview, StoryCorps/Smithsonian oral-history
  practice).
- 2026-07-15 — Draft view upgraded to a **selection-based markup layer** after mockup review (two
  further owner decisions): highlight any span → contextual toolbar (Delete · Edit · Comment ·
  To-do · Pin · Exclude · Sources); marks accumulate as a visible **suggestion layer** applied
  together via one **Review & apply** revision (inline edits + pins + excludes are instant/no-AI);
  comments carry an intent (Add context / Fix this / Question); **to-dos** carry a kind (Remind me /
  Ask my biographer / Turn into questions), collect in a book-level "To do" list, and the
  "Turn into questions" kind bridges into the interview engine (FOCUS = the to-do). Added
  `ChapterMarkup`/`MarkupMark`/`TextAnchor`/`StoryTodoList` schemas, the `story:mark`/`applyMarkup`/
  `todoToQuestions` channels, and the §3.3.1/§3.3.2 flows.
- 2026-07-15 — **Approved.** All seven open questions resolved (§11) with the owner (recommended
  option each): reader-view ~70% measure as a signed-off §12 exception; contributions + interview
  sessions are post-v1 fast-follows; `standard` default length; on-demand covers; "Your Story" nav
  label; `STORY_WEEKLY_AUTO_CAP = 10`. Ready for the Phase A backbone slice.
- 2026-07-16 — **Setup refinements (testing feedback, on `feat/auto-checkins-finish`, PR [#218]).**
  Three owner-decided tweaks to the "Start your story" screen: (1) **title is optional** — leaving it
  blank lets the foundations pass propose a title from the content, applied via the new additive
  `BookManifest.titleAuto` flag (never overwrites a title the person supplied or later edits on the
  outline-review screen, which now has an editable book-title field); (2) **four more style presets**
  (Journalistic · Reflective · Cinematic · Poetic — the Style control became a full-width Select since
  seven options overflow a SegmentedControl at phone width, §12); (3) **default length is now Full**
  (published-book length), still selectable. Additive schema (no version bump). §3.2 / §4 / §11
  amended.
- 2026-07-16 — **Full Playwright E2E added (on `test/story-e2e`, after PR #218 merged).** Closed the
  standing E2E gap: the main-process `fakeClaudeClient` gained Your Story branches (foundations /
  chapter / revision / gap / structure / vision / distill / placement) so the whole feature is
  drivable through the real UI, plus three focused `launch.spec.ts` walks — author spine, living book,
  and publish/reader/export/cover (see §10). 3/3 green (×3 no flake); the fake reordering is safe for
  the existing suite (two pre-existing, unrelated failures on `main` — `onboarding attention (55)`,
  `dreams typed-new-name` — were confirmed failing without this change).
- 2026-07-16 — **Deferred coordination items BUILT + those two pre-existing failures fixed (on
  `test/story-e2e`).** (1) **Reader read-progress + "what's new"** (§3.6): `listSharedBooks` now derives
  `neverOpened`/`updated` from the viewer's device-local `storyReadProgress`; a new `story:markSharedRead`
  records the open (opening a shared book clears the cues); the "Shared with you" card shows a **"New"/
  "Updated"** badge. (2) **`story-shared` notification** — a one-time bell notice per newly-shared book
  (owner decision: notify on first share only; later republishes surface as the quiet card marker, never a
  re-notify), derived in `useNotificationSources`, kind added to the registry. (3) **"Your biographer"
  Inbox eyebrow** — `InboxItem.fromBiographer` set when the frozen snapshot carries `storyProvenance`.
  Broadened the E2E (photos/vision, PDF export, the notification + marker + eyebrow). Also fixed the two
  pre-existing `main` failures (Playwright substring collision on a new "Sharing & relationships" nav item;
  the onboarding-attention relaunch assertion tightened to the onboarding item, since a freshly-onboarded
  owner now legitimately gets the auto check-ins seed notice). Additive schema (no version bump); full gate
  green (core 1412 + desktop 1256, 6 story E2E ×3 no flake).
- 2026-07-16 — **Create-and-draft redesign (testing feedback; §3.2/§3.3 amended; on
  `feat/story-draft-progress`).** Two owner-decided changes to the creation flow: (1) **no outline-review
  gate** — creating a book now drafts it end-to-end in one flow (foundations → auto-approve → all chapters)
  and lands on the editable book; the title is renamed in place on the overview (the `OutlineReview` screen
  is removed). (2) A **rich real-time writing screen** replacing the plain "Reading your story…" card — a
  new main-side `story:generateFullDraft` streams per-chapter progress over a `story:progress` event
  (mirroring chat streaming: host `emitStoryProgress`/`onStoryProgress` + a `storySender` binding); the
  renderer shows the phase, a determinate bar + chapter dots, an **elapsed timer** and an **improving
  estimate**, and a "keeps writing in the background" note. The draft runs in main, so it **continues across
  navigation** — a live **"Your Story · N/M" sidebar indicator** (subscribed at app level via the store's
  `progress`, fed by the stream) shows it from any page, verified by an E2E that navigates away mid-draft and
  returns to the finished book. New `StoryDraftProgress` view type; `generateBookChapters` gained an
  `onProgress` callback. Mockup approved first (the standard UI-redesign process). Gate green: core 1413 +
  desktop 1258, 5 story E2E ×3 no flake; real-Electron visual QA of the writing screen + sidebar indicator +
  the drafted overview.
- 2026-07-16 — **Chapter-write progress (testing follow-up; on `feat/story-chapter-progress`).** The plain
  "Writing your chapters…" button on the overview (the `generateChapters` path — reachable after an approved
  structural change or a budget stop) now shows the **same rich real-time progress** as create-and-draft:
  `storyGenerateChapters` streams per-chapter `story:progress` (its ipc handler binds `storySender`), the store
  seeds/clears `progress` (counts from the current bundle so no "0 of 0" flicker), and it renders **inline** in
  the overview (a renderer-only `progress.scope: 'create' | 'chapters'` — `create` = full-screen, `chapters` =
  inline so the overview stays in view and its error handling survives). Real-Electron visual QA confirms it.
- 2026-07-17 — **§13 added (Approved): the Studio & the Book — a ground-up full-surface UX redesign**, after
  the owner rejected the shipped surface as thrown-together ("completely REDESIGN FROM SCRATCH") and approved
  a 16-screen interactive mockup of every screen (the standard mockup-first process; artifact
  `story-redesign`, first-proposal). §3.1–§3.6's _surface layouts_ are superseded by §13; every §3 _mechanic_
  (markup model, batch apply, publish gate, interview engine, exclusions, freshness) is unchanged and reused.
  New owner decisions this date: reader **read receipts** (yes); check-in answering stays in the Inbox
  (inline answering = fast-follow); the single-book UI stays (a bookshelf = fast-follow); "Rewrite from
  scratch" keeps photos/exclusions/answers/config and discards chapters/edits/pins/marks.
- 2026-07-17 — **§13 R1 (Studio IA) BUILT** (`feat/story-studio-ia`, PR pending) — the Studio hero + Needs-you
  strip + five tabs (Chapters/Photos/Interview/Sharing/Settings) replacing the old one-page card stack, the
  `story/*` splat route for tab deep-links, the to-do sheet, the Danger zone (type-to-confirm delete +
  `rewriteBookFromScratch`), and the `story:rewriteFromScratch` seam. The chapter reader stays the existing
  `ChapterReader` (the immersive Book view is R2/R3). See §13.7 R1 for the full build note + test coverage.
- 2026-07-17 — **§13 R2 (The Book — immersive reader) BUILT** (`feat/story-book-reader`, PR pending) — the
  unified `BookReader` (owner + shared, front-matter-first: cover/title page/dedication/epigraph/contents →
  chapter opener art + drop-cap Lora prose + pull-quotes + prev/next → back matter + colophon), entered from the
  Studio hero "Read your story" + the `/story/read` deep-link, with aA text-size cycling + a device-local
  per-person resume position. New core `readOwnBook` (draft head, own-data full projection with per-chapter
  status) + `story:readOwnBook`/`story:setReadPosition`. The shared reader is unified onto the same component.
  See §13.7 R2 for the full build note + test coverage.
- 2026-07-17 — **§13 R3 (Shape & review — core) BUILT** (`feat/story-shape-review`, PR pending) — the
  what-changed diff + the Shape ribbon + the Read⇄Shape toggle. Additive `BookChapter.previousMarkdown` +
  a pure `wordDiff` (`@selfos/core/story-diff`); a `ChapterRibbon` (New/Rewritten · What changed [word-diff] ·
  Looks good ✓) on new/updated chapters; a compact "Shape" toggle in the reader bar + a "Shape this chapter ›"
  end-affordance entering the existing markup editor from the reader. The deeper Shape-surface visual restyle
  (superscript sources, margin-rail marks, the right-hand Review & apply sheet) landed as **R3-polish** (below).
  See §13.7 R3 for the full build note + test coverage.
- 2026-07-17 — **§13 R4 (Sharing & export) BUILT** (`feat/story-sharing-export`, PR pending) — read receipts
  end-to-end + draft export + the export dialog. A `StoryReadReceipt` written by the reader on open (re-gated) and
  joined author-side into `BookReader.read` (Read-the-latest / older-version / not-yet-opened) on the Sharing tab;
  person-delete reaps receipts both directions. `buildDraftMarkdown`/`buildDraftHtml` + a `head:'draft'|'published'`
  export param so a never-published book exports its live draft; the two inline export buttons became one
  "Export…" dialog (format + version + vault-boundary line). See §13.7 R4 for the full build note + test coverage.
- 2026-07-17 — **R3-polish (Shape editing surface, immersive look) BUILT** (`feat/story-shape-r3-polish`, merged) —
  the three deferred visual refinements of the `ChapterReader` markup surface (§13.5), a restyle of the
  existing/tested machinery with the `applyMarkup` call-count invariant + all markup RTL/E2E green: (1) provenance
  as **numbered `<sup>` footnotes** (keeps the `aria-label="Sources (N)"` popover trigger); (2) the pending-marks
  strip in an **absolute right-margin rail beside the ~70% measure at ≥900px** (a `@container` query over a
  `.shapeBody` inline-size container), stacking under the paragraph below that; (3) the inline apply bar → a
  **bottom-sticky pending pill** ("N changes ready · 1 cut · 1 comment · 1 to-do …") opening a **right-hand
  `ReviewSheet`** (grouped Cuts / Comments / For your biographer, each removable from the batch) with
  **"Apply with your biographer"** (the one metered revision, unchanged). code-reviewer **ship** (the apply-once
  invariant + `ReviewSheet` type-narrowing + container-query verified against the compiled CSS) — applied the one
  should-fix (a vestigial `paraBodySourced` class that emitted a stray `undefined` token) + nits (a live-region on
  the pill so screen readers hear the count change, a scoped `story-shape` container name, and the sheet
  auto-closes when the batch empties so it's never a dead-end). Gate green: typecheck, lint, format, 1290 desktop
  unit (+4 Story RTL [superscript-replaces-inline + rail + sheet-groups/removes/applies-once + auto-close], the 4
  apply-bar RTL re-pointed to the pill/sheet with a `toHaveBeenCalledTimes(1)` apply-once lock), 7 story E2E (the
  author-spine walk drives the pill → sheet → Apply, asserts the absolute rail at 1440px, and runs the 360px
  overflow guard with a pending mark on screen). Real-Electron visual QA at desktop + 360px, light + dark. See
  §13.7 R3-polish for the full note.
- 2026-07-17 — **§13 R5 (Interview tab — life map + gaps) BUILT** (`feat/story-interview-tab`, PR pending) — the
  gap pass now persists `lastGaps` (ids) + `lastPartCoverage` (a tolerant per-part model reading + a
  written/reviewed fallback); a free `story:gaps` read + `story:askGap` (explicit mint honoring ≤1) +
  `story:answeredCheckIns`; the rebuilt `InterviewTab` (completeness hero + a `LifeMap` per-part coverage bar with
  a word text-equivalent + "Worth telling next" gap cards with "Ask me about this" + an "Answered" history block).
  The answered-history chapter linkage was deferred here + BUILT in the §13 close-out (see the close-out entry
  above). See §13.7 R5 for the full note.
- 2026-07-17 — **§13 R6 (Photos tab + the corpus wiring fix) BUILT** (`feat/story-photos-corpus`, PR pending) —
  the §13.6.2 functional gap: `buildStoryCorpus` now takes a `bookId` and reads `interview.enc.photoAnswers`, so
  a photo's caption + answered Q&A finally feed the biographer (grouped one `photo`-kind corpus item per photo,
  exclusion-filtered); threaded `bookId` through all six generation/refresh/gap callers. The Photos tab was
  redesigned from a vertical list into a responsive gallery of cards (cover · caption · "N memories captured" ·
  inline Q&A). See §13.7 R6 for the full build note + test coverage.
- 2026-07-17 — **§13 R7 (Begin screens — invitation · commission · the writing) BUILT** (`feat/story-begin-screens`,
  PR pending) — the FINAL slice: a new crypto-free `story:corpusStats` (deterministic session/reflection/dream
  counts + a year span) + a static `specimen` per style preset drive the redesigned three begin surfaces — the
  invitation (book-cover hero + three-step promise + "Drawn from" chips), the commission (a live-preview rail with
  a cover mock + a specimen sentence that re-renders per style × voice, style as a card gallery), and the writing
  (essence line + an outline reveal + a "Browse SelfOS ›" exit). See §13.7 R7 for the full note. **§13 (The Studio
  & the Book) is now fully BUILT, R1–R7.**
- 2026-07-17 — **§13 CLOSE-OUT — the two deferred follow-ups BUILT** (`feat/story-closeout`, PR pending). (1) The
  **answered-history chapter linkage** (§13.6.5, deferred in R5): `listAnsweredStoryCheckIns` now derives "wove
  into <chapter>" deterministically — an answered check-in → its analysis Insight (`provenance.assignmentId`) →
  the earliest chapter whose paragraph provenance cites that insight — so the Interview tab's answered history
  names the chapter each check-in wove into (absent, honestly, until the answer is analyzed + a citing chapter is
  drafted). (2) The shared **`--color-scrim` token** (deferred R4-polish): the three Story overlays' hardcoded
  scrim → one design-system token in `tokens.css`. With this, **§13 has NO remaining deferrals — it is 100%
  complete.**

## 13. The Studio & the Book — the 2026-07-17 full-surface redesign (BUILT, R1–R7 — 100% complete)

The approved mockup is the visual contract for this section; where prose and mockup disagree, the mockup
wins. Everything below reuses the built §3–§5 machinery — this is a re-architecture of the _surface_, plus
the small backend additions the new surface needs and four working-but-wrong gaps the redesign audit found.

### 13.1 Why

The shipped surface was one 2,600-line stack of flat cards: settings above the chapters, photos above the
book, delete a ghost link at the bottom of a scroll, prose rendered as UI text with "Mark up · Sources"
links under every paragraph. The audit also found real functional gaps: **export trapped behind publishing**
(§3.9 promised a draft export), **photo answers never reach the corpus** (§3.7 promised they do), the gap
pass **computes a prioritized gap list no surface ever shows**, **no prev/next** while reading, and the
owner **can never see their own book as a book** (front matter renders only for readers). §13 fixes all of
these as part of the rebuild.

### 13.2 Information architecture — two places, not one page

- **The Studio** (`/story`) — managing a living book. One hero owns the book's identity; a "Needs you"
  strip gathers every pending decision; five tabs hold everything else: **Chapters · Photos · Interview ·
  Sharing · Settings**. Real sub-routes (`/story`, `/story/photos`, `/story/interview`, `/story/sharing`,
  `/story/settings`) so tabs deep-link and survive reload.
- **The Book** (`/story/read`, `/story/read/:chapterId`) — an immersive reading surface for the owner's
  **draft head** (front matter included), with a **Read ⇄ Shape** toggle; a shared book opens the same
  surface at `/story/shared/:bookId` rendering the **published head**, read-only (no Shape, no statuses,
  no sources). Chapter routes make chapters deep-linkable for provenance links and notifications.
- The UI remains **single-book** (`books[0]`); the hero title area is built as a switcher-ready slot
  (bookshelf = post-v1 fast-follow, backend already N-book).
- The store keeps its per-person reset and app-level `story:progress` subscription unchanged.

### 13.3 Begin — invitation, commission, the writing

- **Invitation** (no-book empty state): the book as hero (cover placeholder art), the three-step promise
  (It reads · It writes · It keeps writing), a **"Drawn from"** chip row with real counts (a new
  crypto-free `story:corpusStats` read — conversations / reflections / dreams counts + year span, no AI),
  the privacy line, "Begin your book". The **"Shared with you" shelf** renders below (and is the whole
  surface for a person with no book of their own).
- **Commission** (setup): title (optional, unchanged) · voice · style · length — with a **live preview
  rail**: a cover mock that takes the typed title, and a **specimen sentence** re-rendered per
  voice × style ("How your biographer will sound"). Specimens are **static strings on the BookType's
  style presets** (7 styles × 2 voices, so future BookTypes carry their own). Style renders as a card
  gallery (auto-fill grid, §12-safe), length as three cards with reading-terms sublabels. A footer line
  sets the time expectation ("Roughly 10–20 minutes… you can keep using SelfOS"). `autoRefresh` stays
  hard-coded on at create (Settings owns it afterwards).
- **The writing** (full-surface, `scope:'create'`): the cover breathes; the **essence line appears when
  the foundations pass lands** (bundle refetch on phase change); the **outline reveals itself** as a
  two-column chapter list with done/current/upcoming markers driven by the existing progress stream;
  elapsed + improving ETA unchanged; the "you don't have to watch" note gains a real **"Browse SelfOS ›"**
  exit (progress persists; sidebar chip unchanged). The inline `scope:'chapters'` variant keeps its
  compact bar, restyled to match.

### 13.4 The Studio

- **Hero**: cover (art or "Create a cover" placeholder when image generation is ready) · eyebrow
  (`Your story · Biography`) · title + rename pencil · essence in italic serif · config chips (voice ·
  style · length · N chapters) · a freshness line ("3 chapters have new material · refreshed 2 h ago" —
  stale count from bundle statuses, free) · the completeness meter ("~64% told · See what's missing ›" →
  Interview tab) · actions: **Continue reading · Ch. N** (primary; opens the Book at the device-local
  own-book read position — `storyReadProgress` gains `chapterId` for the owner's book), **Refresh from
  what's new** (badge = stale count), and a **⋯ menu** (Export… · Share… · Rename · Rewrite from
  scratch… · Delete…).
- **Needs you** (hidden when empty; replaced by a quiet "All caught up — next gentle refresh Sunday"
  line): one card per pending decision — **Suggested change** (proposal rationale + Approve/Later
  inline), **To review** (count of `new`/`updated` chapters → opens the first in the Book), **Check-in
  waiting** (open story check-in → its Inbox item), **To-dos** (open count → a right-hand **to-do
  sheet**, the Review-&-apply sheet primitive: the book roll-up with kind chips, Mark done, and
  open-in-chapter links).
- **Chapters tab**: the approved cover-backed card grid, unchanged in DNA, plus a per-part review
  progress line ("3 of 4 reviewed"), the "write the remaining N" bar rendered **inside the part that
  owns the unwritten shells**, and the dashed not-yet-written cards. The "Shared with you" shelf sits
  compactly at the bottom of this tab for book-owners.
- **Photos tab** (§13.7-F): drop zone + gallery cards (caption in the book serif, placement chip:
  "In Chapter 4 · after ¶4" / "Not placed yet" + AI-suggest), the **vision Q&A inline on the card**
  (question rows with answer inputs + Save; answered rows editable), Remove.
- **Interview tab** (§13.6): completeness stage + ratio, the **life map**, gap cards with **"Ask me
  about this"**, the open check-in card, and an answered-history block.
- **Sharing tab**: a "What readers see" card — published date, shared-chapter count, and an honest
  "N newer chapters aren't included yet" derivation (draft chapters absent from the published head or
  regenerated since `publishedAt`) with a "Review them ›" link; **Share updates** primary; first-publish
  copy explains the gate. A **readers card**: per-reader row (avatar · name · "Reader since \<date>" ·
  **read state from receipts**, §13.6) + kebab (Remove) + add-reader select with the featured-person
  awareness note. An **Export card** (also in the hero ⋯) opens the export dialog.
- **Settings tab** — four groups + the danger zone, replacing the mid-page collapsible:
  - **Book details**: title · dedication · epigraph · acknowledgments (the `BookMatter` editor, inline
    row editing).
  - **Writing**: voice · style · length · auto-refresh, with the "steers future rewrites" note.
  - **Images**: this book's image style + style direction (the shared `ImageStylePicker`), and the
    cover controls (Create/Regenerate/Remove).
  - **Never written about**: the exclusions list with kind chips + "Allow again".
  - **Danger zone** (its own bordered card): **Rewrite from scratch…** and **Delete this book…**
    (§13.6). Delete leaves the bottom of the page forever.
- **Edge states** (per the mockup, all calm, never a dead control): role-aware AI-off banners; over
  budget ("rests now, resumes Sunday — N chapters wait in the queue"); background writing (hero inline
  bar + the existing sidebar chip); thin corpus (short-book promise + "See the N questions ›"); a
  failed chapter card with Try again; crisis quiet ("Your biographer rests while things are heavy" —
  the existing §8.2 gates, surfaced honestly).

### 13.5 The Book

- **Front matter** (owner draft head at `/story/read`; published head for readers): cover page → title
  page (title, "The story of \<name>", essence) → dedication → epigraph → **Contents** (dotted leaders;
  per-chapter state marks for the owner — ✓ reviewed / updated / new / reading; the reader instead gets
  the "new since you last read" cues) → back matter line. **"A note on this book" renders for the owner
  too**: the deterministic builder is factored out of `storyPublish` and rendered live from the draft
  corpus counts.
- **Read mode**: a sticky translucent bar (‹ Studio · running book title · Ch. N of M · **aA** ·
  Read ⇄ Shape · thin progress rule). Chapter opener = the chapter's illustration, else a deterministic
  cover crop, else the gradient fallback, with `CHAPTER N` + title overlaid. Prose in Lora at the §11.1
  approved measure, first-paragraph drop cap, pinned quotes rendered as pull-quotes, `imagePlacements`
  interleaved as figures with captions. Provenance markers and the suggestion layer are **invisible in
  Read**. Footer: ‹ previous / next › chapter + Contents. **aA** = a three-step reader text size,
  device-local. Keyboard: ←/→ chapters, Esc → Studio.
- **Shape mode** (same page, same typography — the §3.3 machinery restyled): selecting a span raises the
  contextual toolbar (Cut · Edit · Comment · To-do · Pin · Exclude · Sources); a focusable ¶ handle per
  paragraph keeps it keyboard/touch-reachable (§9). Marks live **in the margin** on wide containers
  (≥900px: an absolute rail beside the measure) and under the paragraph below that; cuts strike inline,
  instant edits show a dotted underline, pins a warm highlight; provenance becomes numbered superscripts
  (popover on tap = today's Sources content, incl. "Don't draw on this again"). A `new`/`updated`
  chapter leads with a ribbon: "**rewritten from new material** · **What changed** · **Looks good ✓**".
  **What changed is now a real diff**: an additive `BookChapter.previousMarkdown?` keeps the prior text
  on rewrite/apply (cleared when the chapter is marked Reviewed) and the ribbon toggles an inline
  word-diff render. A bottom-sticky pill counts pending marks ("3 changes ready · 1 cut · 1 comment ·
  1 to-do — your inline edit and pin are already in") → **Review & apply**.
- **Review & apply**: a right-hand sheet over the dimmed chapter — pending marks grouped (Cuts /
  Comments / For your biographer) each with its anchor excerpt and "Remove from this batch" (= the
  existing mark undo), an "Already yours — applied instantly" note for edits/pins, and **Apply with
  your biographer** (the one metered revision, unchanged).
- **Reader variant**: same surface, published head, no Shape toggle, no statuses/sources/diffs; back
  matter carries acknowledgments, the honesty note, and the colophon with the wellness boundary line.
  Opening writes the read receipt (§13.6) in addition to the existing device-local mark-read.

### 13.6 New backend + wiring fixes

All additive; no `schemaVersion` bumps; every channel gated `story.own` + person-scoped as today.

1. **Draft export** (fixes the trapped export): `buildDraftMarkdown`/`buildDraftHtml` render the live
   draft head (every written chapter in outline order + matter + cover + placements; the live honesty
   note). `story:exportMarkdown`/`story:exportPdf` gain a `head: 'draft' | 'published'` input
   (published unchanged; draft needs no publish). The export dialog (format cards + head toggle +
   vault-boundary line) fronts both.
2. **Photo answers reach the biographer** (fixes the §3.7 gap): `storyCorpus` reads
   `interview.enc.photoAnswers` (caption + Q/A lines as corpus slices, exclusion-filtered like
   everything else).
3. **The gap list reaches the screen**: the gap pass persists its output — additive
   `StoryInterviewState.lastGaps?: StoryGap[]` and `lastPartCoverage?: { partId, score }[]` (the pass's
   prompt/schema gains a per-part 0–1 coverage read, tolerant-parsed; fallback when absent = each
   part's written/reviewed ratio). A crypto-free **`story:gaps`** read returns
   `{ gaps, partCoverage, lastGapPassAt }` — rendering the Interview tab is **free** (no AI on view);
   "Find what's missing" re-runs the metered pass as today.
4. **The life map**: one segment per outline part (chronological by construction), labeled from the
   part title/era, height = its coverage score, dashed when an open gap targets it; a text equivalent
   (per-part "richly told / thin" list) renders alongside per §9 — never color/height-only.
5. **"Ask me about this"**: `story:askGap(gapId)` mints a check-in from that gap's FOCUS through the
   existing mint path; disabled (with the hint) while a check-in is already open (the ≤1 invariant).
   The **answered history** derives deterministically: submitted story-provenance assignments joined to
   the chapters whose provenance cites the insights that analysis produced ("wove into _First Words_").
6. **Rewrite from scratch**: core `rewriteBookFromScratch(bookId)` — deletes `chapters/`, `markup/`,
   `proposals.enc`; clears `essence`, chapter-bound generated illustrations, and (implicitly) all
   protected blocks/pins/placements; **keeps** config, title (`titleAuto` semantics unchanged — a
   never-renamed book may be re-titled by the fresh foundations), matter, uploaded photos + captions +
   answers, the cover, exclusions, and interview state; the **published head stays** until the person
   shares again. Then runs the standard full-draft flow with the standard progress stream. Confirm
   dialog lists keeps/discards exactly as the mockup.
7. **Delete, armed properly**: `story:delete` unchanged; the dialog requires typing the book's title
   to enable "Delete forever" and names the consequences (readers lose access now).
8. **Read receipts** (owner decision 2026-07-17): when a reader opens a shared book, their app writes
   `people/<readerId>/story/receipts/<bookId>.enc` — `{ bookId, authorPersonId, lastOpenedAt,
lastPublishedAtSeen }` (one writer: the reader; additive schema). The author's Sharing tab joins
   grants to receipts: no file → "hasn't opened it yet"; `lastPublishedAtSeen >= publishedAt` → "has
   read the latest"; else "opened \<date>". Person-delete reaps receipts both directions.
9. **Continue reading**: device-local `storyReadProgress` (existing) gains the owner's own-book
   `{ chapterId, at }`; the hero's primary action resumes there (falls back to chapter 1 / front
   matter).
10. **Corpus stats**: `story:corpusStats` — deterministic counts for the invitation (no AI, no spend).

### 13.7 Build slices (each PR-gated, standard §6/§7 cadence + the §10 E2E discipline)

- **R1 — Studio IA — BUILT** (2026-07-17, `feat/story-studio-ia`, PR pending): `story/*` splat route so the
  tabs deep-link; the `StudioLayout` hero (cover + title/Rename + essence + config chips + freshness +
  completeness + Read/Refresh/⋯ kebab) + the `NeedsYou` strip (proposals · to-review · to-dos, self-hiding to a
  calm "all caught up" line) + five tabs (Chapters · Photos · Interview · Sharing · Settings) with the existing
  panels relocated (Settings holds matter + Writing/Images [the collapsible dropped for open groups] +
  exclusions + Danger zone); the book-level `TodoSheet`; the `DangerZone` (type-to-confirm delete + rewrite).
  New core **`rewriteBookFromScratch`** (keeps config/title/matter/cover/uploaded-photos/exclusions/interview +
  the published head; discards chapters/markup/proposals/outline/timeline/essence + only AI-generated
  illustrations) + the `story:rewriteFromScratch` channel through the whole seam, gated `story.own` +
  active-person-scoped; the store's `rewriteFromScratch` resets then re-runs the standard streamed draft
  (mirroring `createAndDraft`). The **chapter reader stays the existing `ChapterReader`** (the immersive Book
  view is R2/R3). Gate green: typecheck, lint, format, **1420 core + 1270 desktop** unit (+`rewriteBookFromScratch`
  keeps/discards + missing-book null; +a coreBridge rewrite round-trip + Guest denial; +Story RTL for the tab
  deep-link, the type-to-confirm delete, and rewrite-then-redraft; the 10 relocated-surface RTL updated to switch
  tabs), **6 story E2E** (the 3 relocated walks re-pointed through the tabs; +a new Studio-tabs + Danger-zone
  delete walk with a 360px overflow guard). Real-Electron visual QA at desktop + 360px, light + dark (the hero /
  Needs-you / tabs / Settings danger zone / rewrite dialog match the approved mockup).
- **R2 — The Book (read) — BUILT** (2026-07-17, `feat/story-book-reader`, PR pending): the immersive Book
  reader. New core **`readOwnBook`** (the owner reads their OWN book from the DRAFT head — the same
  `StoryReaderView` shape the shared reader uses, so the renderer is unified — built from a synthetic manifest
  with a LIVE honesty note [reusing `noteOnBook`] + per-chapter `status` + `pinnedQuotes`; parts/order from the
  outline keeping only written chapters, so an unwritten shell never shows a blank chapter; the person's own
  data, so the full projection is safe, unlike the cross-person minimal `readSharedBook`). Extended
  `ReaderChapter` with `status`/`pinnedQuotes` (own-book only). Read-position resume is **device-local +
  per-person** (`DeviceState.storyReadPosition` = personId → bookId → chapterId) via `story:setReadPosition`;
  `story:readOwnBook` returns `{ view, lastChapterId }` where `lastChapterId` only resolves to a chapter that
  still exists (never a dangling resume) — both channels gated `story.own` + active-person-scoped. A unified
  **`BookReader`** component (owner + shared) renders: a reader bar (‹ Studio/Back · title · Ch. N of M · aA
  text-size cycling `story.readerFontSize` [a hidden device setting]); front matter (cover book · title page ·
  dedication · epigraph · contents with per-chapter status marks · Begin/Continue/From-the-beginning); the
  chapter page (opener art = **the chapter's own illustration → the book cover → a warm dusk-gradient fallback**,
  the promoted image excluded from the inline figures so it never renders twice · Lora prose with a drop cap on
  the first paragraph · pinned pull-quotes · placed figures · prev/next) + an owner "Edit this chapter ›" that
  drops into the existing `ChapterReader` markup editor; back matter (acknowledgments · a-note-on-this-book ·
  colophon with the not-medical line) on the last chapter. The Studio hero "Read your story" + `/story/read`
  deep-link both enter it; the **shared reader is unified onto the same component** (front-matter-first). Chapter
  cards still open the editor (unchanged, R3 wires cards→reader). code-reviewer verdict **ship** — the one
  applied follow-up was the §13.5 opener precedence (was cover-only; now the chapter's own illustration leads,
  matching R1's card grid + the mockup). Gate green: typecheck, lint, format, **1423 core + 1274 desktop**
  unit (+`readOwnBook` draft-head/status/unwritten-shell/null; +a coreBridge readOwnBook + resumable
  setReadPosition [+ ghost-chapter resolves to null] + Guest denial; +3 Story RTL owner-reader deep-link +
  hero-navigation + opener-uses-chapter-illustration-not-duplicated-inline, the shared-reader RTL updated to the
  front-matter→chapter flow), **7 story E2E** (a new
  owner-reader walk: front matter → Begin reading → chapter prose → aA changes the reader scale → Edit reaches
  the editor → back to Studio, + a 360px overflow guard; the publish/shared-reader walk updated to Begin-reading
  first). Real-Electron visual QA at desktop + 360px, light + dark (the cover/title-page front matter, the
  chapter opener + drop-cap prose + prev/next, the settled 360px column, and the dark theme all read as an
  intentional, book-like immersive reader).
- **R3 — Shape & review — BUILT (core)** (2026-07-17, `feat/story-shape-review`, PR pending): the
  **what-changed diff + the Shape ribbon + the Read⇄Shape toggle**, restyling the existing markup machinery
  with the `applyMarkup` call-count invariants untouched. **R3a** — an additive `BookChapter.previousMarkdown`
  keeps the pre-rewrite text (captured in `generateChapter` [rewrite path only — a first draft carries none] +
  `applyMarkup`, cleared when a chapter is marked Reviewed) + a pure, dependency-free **`wordDiff`**/`hasChanges`
  (LCS over words, whitespace-insensitive) in `@selfos/core/story` (exposed to the renderer via a lean
  `@selfos/core/story-diff` subpath). **R3b** — a new/updated chapter leads with a **`ChapterRibbon`**
  ("New chapter" / "Rewritten from new material" · a **"What changed"** toggle that reveals a real inline
  word-diff [added `<ins>` green, removed `<del>` struck red] · **"Looks good ✓"** review) that collapses to a
  calm "✓ Reviewed" once reviewed; and a **Read⇄Shape toggle** — a compact **"Shape"** button in the reader bar
  (owner-only, on a chapter page) + a "Shape this chapter ›" affordance at the chapter's end, both entering the
  existing `ChapterReader` markup editor from the reader (staying on `/story/read`), so editing is a mode of the
  book rather than a separate screen. code-reviewer **fix-first** — one should-fix applied (a **`stale`** chapter
  now leads with the ribbon too: "New material to fold in" + the spend-free "Looks good ✓" accept action —
  R3b's removal of the old bottom review button had otherwise left a stale chapter with no status cue AND no way
  to be reviewed short of a metered rewrite) + two nits (a `MAX_DIFF_CELLS` cap so `wordDiff` degrades to a
  coarse whole-block diff past ~1M word-cells instead of an unbounded table; `useMemo` on the render + a
  `role="group"` label on the diff). Gate green: typecheck, lint, format, **1429 core + 1278 desktop** unit
  (+`wordDiff` [6, incl. the cell-cap fallback]; `previousMarkdown` captured-on-rewrite/apply +
  no-prior-on-first-draft; +coreBridge review-clears; +3 Story RTL: ribbon+diff reveal/hide +
  first-draft-no-toggle + stale-keeps-its-review; the R2 owner-reader RTL/E2E re-pointed to the Shape toggle),
  **7 story E2E** (the author-spine walk now asserts the ribbon + reveals the word-diff after a revision).
  Real-Electron visual QA (the ribbon + the red/green word-diff + the reader-bar Shape toggle read clean +
  book-like). The immersive margin-based look of the Shape editing surface itself (superscript sources · margin
  rail · Review & apply sheet) landed as **R3-polish** (below).
- **R4 — Sharing & export — BUILT** (2026-07-17, `feat/story-sharing-export`, PR pending): **read receipts
  end-to-end + draft export + the export dialog**. **Read receipts (§13.6.8):** a new `StoryReadReceipt` schema
  - core `writeReadReceipt` (the reader writes `people/<readerId>/story/receipts/<bookId>.enc` on open — re-gated
    inside on published + still-shared, storing the `publishedAt` they saw) / `readReadReceipt` (author-side, trust-
    checked on `authorPersonId`+`bookId`) / `reapReadReceiptsAbout` (person-delete "both directions" — the deleted
    person's own receipts go with `deletePerson`, this reaps receipts OTHER readers hold about the deleted author's
    books); `listReaders` now joins each granted reader to their receipt → a `BookReader.read` state
    (`{openedAt, upToDate}` or absent), surfaced on the Sharing tab as "Read the latest" / "Opened <date> · older
    version" / "Hasn't opened it yet". The receipt write piggybacks on the existing `storyMarkSharedRead` (which
    already carries the author id); the reap is wired into `peopleDelete`. **Draft export (§13.6.1):** core
    `buildDraftMarkdown`/`buildDraftHtml` (reuse `readOwnBook`'s draft head + resolve the draft image bytes) + a
    `head: 'draft' | 'published'` param (`StoryExportInputSchema`, default published) on `story:exportMarkdown`/
    `:exportPdf`, so a **never-published** book exports its live written chapters + the live honesty note. **Export
    dialog:** the two inline export buttons → one **"Export…"** (always available) opening a centered `role="dialog"`
    (format Markdown/PDF · version Working-draft/Published [Published unusable until shared] · the vault-boundary
    line). Additive schema, no bump. Gate green: typecheck, lint, format, **1433 core + 1279 desktop** unit
    (+receipt write/read/derive/reap [3] + draft-export [1] core; +coreBridge two-persona receipt round-trip
    [reader opens → author sees "read the latest" → republish → "older" → reap] + draft-export-without-publishing;
    +3 Story RTL [export dialog Markdown-published, PDF-draft-no-publish, the reader read-state row]), **7 story
    E2E** (the publish/reader walk now exports the DRAFT before publishing + the published PDF via the dialog, and
    the author's Sharing tab shows "Read the latest" after the reader opens). Real-Electron visual QA (the export
    dialog + the reader read-state read clean). code-reviewer **ship** (receipt trust boundary + owner-scoped
    draft export + both-directions reap all verified sound); applied the one should-fix — the secondary receipt
    write is now best-effort (`.catch`) so an author-facing convenience can't break the reader's open flow — + the
    a11y nit (autoFocus the export dialog's primary button). A shared `--color-scrim` token to DRY the 3
    Story-local overlays is deferred to the R7 polish sweep.
- **R3-polish — Shape editing surface, immersive look — BUILT** (2026-07-17, `feat/story-shape-r3-polish`, merged):
  the three deferred visual refinements of the `ChapterReader` markup surface (§13.5), a restyle of the
  existing, tested machinery — the `applyMarkup` call-count invariant + every markup RTL/E2E stay green; the
  ribbon + Read⇄Shape toggle (R3b) are untouched. **(1) Numbered superscript sources** — the per-paragraph
  "Sources (N)" button becomes a footnote-numbered `<sup>` marker trailing the prose (the markdown flows inline so
  it sits on the last line; a relative offset, not `vertical-align: super`, keeps a real tappable box and doesn't
  swell the line height); it keeps the `aria-label="Sources (N)"` accessible name, so it still opens the existing
  "Drawn from … · Don't draw on this again" popover. **(2) Margin-rail marks** — the pending-marks strip
  (delete/comment/to-do, with Undo/Mark done) moves to an **absolute rail in the right margin beside the ~70%
  measure on wide containers** (a `@container shape (min-width: 900px)` query over a new `.shapeBody` inline-size
  container; each `.para` is the positioning context) and stacks under the paragraph below that; the measure fills
  the width on narrow containers (§12). **(3) Review & apply sheet + bottom-sticky pending pill** — the inline
  `.applyBar` is replaced by a bottom-sticky pill ("N changes ready · 1 cut · 1 comment · 1 to-do — your inline
  edits and pins are already in", per-kind counts mirroring `countApplicable`) that opens a **right-hand
  `ReviewSheet`** (reusing the shared `.sheet*` chrome) — pending marks grouped Cuts / Comments / For your
  biographer, each with its anchor excerpt + "Remove from this batch" (= the existing mark undo), the
  "already yours" note for edits/pins, and **"Apply with your biographer"** (the one metered revision, unchanged).
  code-reviewer **ship** — applied the one should-fix (a vestigial `paraBodySourced` CSS-module reference that
  emitted a stray `undefined` class token; the inline layout already works via `.inlineProse`) + three nits: an
  `aria-live="polite"` region on the pill so a screen reader hears the batch count change (restoring the old
  `.applyBar role="status"` behaviour), a scoped `story-shape` container name (container names aren't
  CSS-module-scoped), and the sheet **auto-closes when the batch empties** (removing the last mark, or applying)
  so it's never a lingering empty dead-end. Gate green: typecheck, lint, format, **1290 desktop** unit (the 4
  apply-bar RTL re-pointed to the pill/sheet flow — `toHaveBeenCalledTimes(1)` locks the apply-once invariant;
  +4 new Story RTL: the superscript replaces the inline label + opens the popover, a mark renders in the
  `shape-mark-rail` not under the paragraph, the sheet groups + removes-from-batch + applies once excluding the
  question comment, and the sheet auto-closes when the last mark is removed), **7 story E2E** (the author-spine
  walk drives the new flow: the superscript sources popover, the absolute rail asserted at 1440px, the pending
  pill → sheet → Apply with your biographer, + the 360px overflow guard run **with a pending mark on screen** so
  the pill + stacked rail are exercised at phone width). Real-Electron visual QA at desktop + 360px, light + dark
  (superscript ¹ + right-margin rail + centered sticky pill; the right-hand sheet grouped with its excerpts +
  Apply action; the 360px column fills + marks stack under the paragraph, no overflow).
- **R5 — Interview tab — BUILT** (2026-07-17, `feat/story-interview-tab`, PR pending): the Interview tab
  becomes the full life-map + gaps + ask-a-gap + answered-history experience. **Backend:** the gap pass now
  **persists** its output — additive `StoryInterviewState.lastGaps` (each gap gets a stable `id` at persist time)
  - `lastPartCoverage` (per-part 0..1), the prompt/schema gaining a tolerant per-part `partCoverage` read that
    falls back to the deterministic written/reviewed ratio (`computePartCoverage`: reviewed = 1, written-not-
    reviewed = 0.5, unwritten = 0). Three new reads/ops, all gated `story.own` + active-person-scoped: a **free**
    `story:gaps` (`getStoryGaps` → `{gaps, partCoverage, lastGapPassAt, hasOpenCheckin}`, no AI); **`story:askGap`**
    (`askGap` — the explicit, user-triggered mint of a check-in from a specific persisted gap, reusing the
    `mintStoryCheckInFromTodo` self-send path and honoring the ≤1-open-check-in invariant — refuses while one is
    genuinely open, proceeds once it resolves); and **`story:answeredCheckIns`** (`listAnsweredStoryCheckIns` —
    submitted story-provenance assignments for this book, newest-first, deterministic). **Renderer:** the rebuilt
    `InterviewTab` — the completeness hero, a **`LifeMap`** (one coverage bar per outline part + a **word** for how
    richly told each era is, the §9 text equivalent, a labelled `progressbar`), the "Worth telling next" gap cards
    with **"Ask me about this"** (disabled + explained while a check-in is open), and an **"Answered"** history
    block; the store gained `gaps`/`answeredCheckIns` + `loadGaps`/`askGap`/`loadAnsweredCheckIns` (reset on person
    switch). The **chapter-linkage** "wove into <chapter>" on the answered history is left for a later pass (the
    field exists; deterministic-only for now). Additive schema, no version bump. Gate green: typecheck, lint,
    format, **1441 core + 1288 desktop** unit (+`computePartCoverage`, +`getStoryGaps` persisted/fallback, +`askGap` mint/≤1-refusal/resolve/unknown-id, +`listAnsweredStoryCheckIns`; +a coreBridge gaps→askGap→answered
    round-trip + Guest denial; +a Story RTL: life map + gap-card ask + answered history), **7 story E2E** (the
    living-book walk now asserts the life map + a "Worth telling next" gap card after the pass). Real-Electron
    visual QA (the completeness hero + life-map coverage bars + gap invitations + open-check-in state read clean).
    code-reviewer **fix-first** — one should-fix applied (the "Ask me about this" UI now **single-flights** every
    mint affordance: a gap ask / Find button disables while ANY mint is in flight [`busy || asking !== null`], so
    a fast second click can't mint two open check-ins before the ≤1 flag catches up — the core `askGap` invariant
    was sound but the UI didn't gate concurrent clicks) + the nits (per-item try/catch in `listAnsweredStoryCheckIns`
    so a corrupt record skips instead of blanking the list; a life-map-staleness comment; the LifeMap progressbar
    `aria-label` = the part title alone, the coverage word carried by `aria-valuetext` + the visible word).
- **R6 — Photos tab + the corpus wiring fix — BUILT** (2026-07-17, `feat/story-photos-corpus`, PR pending):
  the §13.6.2 functional gap closed + the Photos tab redesigned as a gallery. **Backend (the fix):**
  `buildStoryCorpus` now takes a `bookId` and reads `interview.enc.photoAnswers` — each photo the person
  **answered about** becomes one corpus item holding its caption + every answered Q&A (`sourceRef.kind: 'photo'`,
  exclusion-filtered via `add()` like everything else, so a `source` exclusion on the imageId drops it); a photo
  only vision-captioned but never answered feeds nothing (a bare AI caption is the model's guess, not the
  subject's words). Before this, §3.7 promised
  photo answers feed generation but the corpus never read them — the answer persisted and fed nothing. Threaded
  `bookId` through all six call sites (generation foundations/chapters/revision, refresh, freshness, structure,
  the gap pass); `generateFoundations` gained `opts.bookId` (both bridge callers pass it). No schema change
  (`photoAnswers`/the image index already existed). **Renderer:** the Photos tab's vertical `photoRow` list →
  a responsive `.photoGrid` gallery of cards (cover image at 4/3, caption, a "N memories captured" chip, the
  answered Q&A inline, and Caption-&-ask/Remove actions bottom-aligned), single-column at ≤480px — all the
  existing accessible names/flow preserved so the answering path is unchanged. **Tests:** +3 core (`storyCorpus`:
  a photo caption + answers feed the corpus as one `photo`-kind item; a `source` exclusion on the imageId drops
  it; book-scoped — book B never picks up book A's answers) + updated every `buildStoryCorpus`/`generateFoundations`
  caller; +1 Story RTL (the gallery renders caption + the captured-memories chip + the answer); the photo E2E
  rewritten to **prove the fix**: upload → vision caption + answer → "Find what's missing" → the captured gap
  prompt (`SELFOS_FAKE_PROMPT_DIR`) contains the answer verbatim (a new `SELFOS_FAKE_STORY_NO_CADENCE` main-only
  test hook disables the autonomous cadence so the manual gap pass runs with the full corpus deterministically —
  the ≤1-open invariant otherwise let the auto cadence mint first + block it). Gate green: typecheck, lint,
  format, **1444 core + 1293 desktop** unit, **7 story E2E**. Real-Electron visual QA at desktop (2-up gallery)
  - 360px (single column, no overflow). **Lesson: a corpus builder that's book-scoped for one source (photo
    answers in `interview.enc`) must take the `bookId` — every generation/refresh/gap caller already had it in
    scope; and an E2E that captures a generation prompt via the gap pass has to defeat the autonomous cadence
    (which mints a check-in on mount and blocks the manual pass via ≤1-open), so gate the auto cadence behind a
    main-only test hook and poll the captured file, never a UI-text signal that a static description also matches.**
- **R7 — Begin screens (invitation · commission · the writing) — BUILT** (2026-07-17,
  `feat/story-begin-screens`, PR pending) — the final slice of the §13 redesign, redesigning the three
  "begin" surfaces + the one new backend read. **Backend:** a deterministic, crypto-free
  **`story:corpusStats`** (`getStoryCorpusStats` — session/reflection/dream counts + a year span from the
  dated material, no AI, gated `story.own` + active-person-scoped, zeroed when denied) + a static
  **`specimen: { first, third }`** on every `BookType` style preset (a sample sentence per register × voice,
  demonstration prose, never a real fact). **Invitation** (no-book empty state): a book-cover hero + the
  three-step promise (It reads · It writes · It keeps writing) + a **"Drawn from"** chip row with the real
  counts (pure `drawnFromChips`) + the privacy line + "Begin your book"; the "Shared with you" shelf below.
  **Commission** (setup): a live-preview rail — a cover mock that takes the typed title + a **specimen
  sentence** ("How your biographer will sound", pure `specimenFor`, re-rendered per style × voice) — with
  style as a **card gallery** (`role="radiogroup"` of radio cards, §12-safe auto-fill grid) and length as
  three cards with reading-terms sublabels; a footer time-expectation line; `autoRefresh` still hard-coded
  on at create. **The writing** (draft progress): the **essence line** appears when the foundations pass
  lands, the **outline reveals itself** as a two-column chapter list with done/current/upcoming markers
  driven by the progress stream, and the note gains a real **"Browse SelfOS ›"** exit (progress persists in
  the background). Gate green: typecheck, lint, format, **1468 core + 1313 desktop** unit (+`getStoryCorpusStats`
  [counts/year-span/empty], +every-preset-has-both-specimens, +`drawnFromChips`/`specimenFor` [6 pure], +3
  Story RTL [invitation chips + promise, commission specimen changes with style, the writing outline reveal +
  Browse], +a coreBridge corpusStats gate/scope test), **7 story E2E** (the setup walk drives the commission
  card gallery + specimen + a 360px overflow guard). Real-Electron visual QA of all three screens at desktop
  - 360px, light + dark. **The whole-flow coherence walk** (invitation → commission → writing → Studio) —
    no redundant asks, no colliding labels, no dead controls. **§13 is now fully BUILT (R1–R7).**

### 13.8 Decisions locked 2026-07-17

1. The 16-screen mockup is **approved as the visual contract** (studio tabs; immersive reader;
   margin-based shaping; the chapter-card grid retained).
2. **Read receipts: yes** — reader-written, author-visible, per §13.6.8.
3. **Check-in answering stays in the Inbox** for this redesign; inline answering on the Interview tab
   is a named fast-follow.
4. **Single-book UI stays**; the bookshelf over the N-book backend is a named fast-follow.
5. **Rewrite from scratch** semantics per §13.6.6.
6. Reader typography details (drop cap, pull-quotes, three-step aA) ship as mocked.

### 13.9 Trust repairs & the draft vault (2026-07-20, BUILT)

A deep audit (2026-07-20) found four classes of silent trust breaks between the feature's promises and
its wiring. All are fixed as one slice (`fix/story-trust-repairs`); the owner authorized the full set.

**Protected words survive EVERY rewrite path.** `enforceProtected` previously ran only in `applyMarkup`,
so a stale-chapter auto-rewrite or one-click "Rewrite this chapter" silently dropped the person's
protected blocks/pinned quotes from the prose while the record still claimed them. Now `generateChapter`
(a) reads the existing chapter first and carries its protected/pinned texts into the chapter prompt as a
PRESERVE block (the same contract the revision prompt always had), and (b) code-enforces them after the
call — §5.3's "after any (re)generation" is finally true. `applyMarkup` additionally enforces against
the **live re-read** chapter, so a passage pinned during the slow revision call survives that revision.

**Truncation is detected, continued, and never persisted as complete.** `runClaude` (every one-shot
pass, story and questionnaires alike) now streams through `streamWithContinuation` (66 §5.1): a reply
that stops at `max_tokens` is transparently continued (≤2 continuations, budget re-checked before each,
usage summed into the one metered event). A reply STILL truncated after that surfaces
`truncated: true`; `generateChapter`/`applyMarkup` refuse it honestly (`TRUNCATED`, nothing persisted) —
a book chapter ending mid-scene must never save as finished. `stripSourceMarkers` also strips a
trailing unterminated `[[…` fragment defensively so a half marker can never render.

**The draft vault (chapter version history).** Drafts are sacred: every rewrite/revision archives the
text it replaces to `history/<chapterId>.enc` (`ChapterVersion` = markdown + provenance + signature +
reason `rewrite`/`revision`/`restore`, capped at `CHAPTER_HISTORY_CAP = 20`). The Shape surface gains a
**History sheet** (the shared `.sheet*` chrome): versions newest-first (reason + date + word count),
per-version **Compare** (the word-diff against the current text, prose fetched one version at a time via
`story:chapterVersion` — list entries carry no prose) and **Restore** behind a two-step confirm.
Restoring archives the current text first (reason `restore` — restoring is itself undoable), takes the
version's markdown/provenance/signature as a new revision (`status: 'updated'`, `previousMarkdown` set
so the ribbon diff shows what the restore changed), and re-enforces protected/pinned texts. Seam:
`story:chapterHistory` / `story:chapterVersion` / `story:restoreChapterVersion`, gated `story.own` +
active-person-scoped. **Rewrite-from-scratch archives the whole drafted state** (manifest incl.
essence/title, outline, timeline, chapters + history — raw encrypted copies, nothing decrypted) into
`archive/<timestamp>/` before discarding, keeping the newest `ARCHIVE_KEEP = 3`; no archive UI yet
(deliberate — the safety net ships first, a browser can follow).

**Honest states.** The interview check returns `aiOff` (distinct from `throttled`) when AI is off/no
key, and `throttled` carries a `throttleReason` (`weeklyCap` / `interval` / `backoff`) — the Interview
tab explains each (role-aware AI-unavailable copy; "already took stock twice this week"; the expired
check-in back-off) instead of a false "check back later". The manual refresh notice distinguishes
`budgetReached` ("the AI budget for this period is used up") and `capped` ("weekly allowance") from
AI-off, and never says "turn on AI" when it is on. The begin flow gates on resolved AI readiness (the
role-aware `AiUnavailableNotice`; Begin/commission disabled) instead of letting the create succeed and
the draft strand the person on NeedsOutline; the commission CTA is renamed **"Write my book"** (the
click commissions the whole first draft, not just an outline). "Rewrite this chapter" gains a two-step
confirm stating what is kept (§8.2 spend legibility).

**Crisis surfacing (§8.2, finally built).** The story surfaces render the standard `CrisisFooter`
(invitation, commission, Studio, Shape, NeedsOutline, the writing screen — not inside the immersive
reader, whose colophon carries the wellness line), and while `aggregateCrisisSignal(...).recurring`
holds (renderer-computed, the Home precedent) the Studio hero + Interview tab surface the quiet state —
"Your biographer is resting while things are heavy" — instead of the cadences silently pausing.

**Adaptive-thinking fix.** The story AND dream image distillation calls now pass
`extendedThinking: false` (a 400-token bounded output; the documented starvation class).

### 13.10 Interview-loop coherence & answer-the-author (2026-07-20, BUILT)

The audit's second cluster: the biographer interview loop contradicted itself and dead-ended. Fixed on
`fix/story-interview-loop`.

**De-dup parity (§3.7, closing the §23.5 drift).** A biographer check-in is a SELF-send, and
`mintStoryCheckInFromTodo` passed `existingPrompts: []` with no `dedupReference` — so it could re-ask what
onboarding or a prior questionnaire already answered ("reads like it hasn't read your file"). It now
assembles the SAME budgeted reference the auto-checkin engine uses — extracted into ONE shared pure
`buildDedupReference` (recipientHistory.ts) so the two can't drift — over the person's own history
(onboarding-first) + the exact asked-prompt list, and passes them into `generateQuestions`. Author-blind.

**Gap lifecycle (§3.7).** A `StoryGap` gains a persisted `assignmentId` (`askGap` stamps it) and a
DERIVED `status` (`getStoryGaps` reads the check-in's state on the fly): `open` → askable; `asked` → a
check-in is waiting; `answered` → it was answered. "Worth telling next" renders each honestly — an
answered gap shows "Answered ✓" and never re-offers an identical re-ask that contradicted the "Answered"
card; `askGap` refuses re-asking an already-answered gap. Corrected the moment a check-in is answered
(from the Inbox, anywhere), not only at the next metered gap pass.

**`questionsSent` to-dos resolve.** A "Turn into questions" to-do stamped `questionsSent` and nothing
flipped it, so it sat in the Studio "Needs you" count forever. `resolveSentQuestionTodos` (free, no AI)
flips it to `done` once its check-in resolves; the bridge runs it on the todos read, so the count
self-heals. The to-do mint now routes through `mintTodoCheckIn`, which honors the ≤1-open-check-in
invariant (can't pile a second check-in on a gap check-in) + records `askedPrompts`/`openCheckin`.

**Self-send bell.** `notificationsResponsesArrived` skipped: a story check-in (and a self-targeted auto
check-in) is a self-send, so answering it raised a "<Your name> answered …" bell about yourself. It now
skips a send whose recipient is the sender.

**Answer-the-author (§3.3).** The comment "Ask" intent was recorded and never answered — a dead end. Now
`answerAuthorQuestion` (metered `story.answer`) replies to a `question` comment grounded in that
paragraph's provenance (the corpus items it actually cited), so the biographer can honestly say "this came
from a coaching session where you described…" — and plainly say when the record doesn't support an answer
(never invent). The reply renders inline at the paragraph and persists on the mark.

## 14. Share a memory (2026-07-20, BUILT)

The conversational complement to the structured interview engine (§3.7): a person tells their biographer
about a moment, the biographer asks and deepens (the McAdams deepening ladder — place → sensory → objects
→ dialogue → the body → meaning), and when it has enough it synthesizes a structured **memory** the person
commits with one tap. Owner decisions (2026-07-20): memories are **person-level**; save is a **one-tap
confirm card**; the derived Insight is **partner-shared by default with trauma/intimacy restricted
carve-outs**; the chat supports **full in-chat photo attachments**.

**Architecture.** The dream-analysis chat, scoped under the book's owner. Storage:
`people/<personId>/story/memories/<memoryId>/` — `memory.enc` (the `StoryMemory` record), `conversation.enc`
(the interview transcript, reusing the `Conversation` schema, `id = memoryId`), and `attachments/` (encrypted
in-chat photos). Person-level (NOT book-scoped), so a saved memory feeds EVERY book + the coach and survives
a book delete/rewrite. The transcript lives beside the record (not in `conversations/`), so the Sessions
surface never lists it — the same structural exclusion dreams use. `storyMemoryService.ts` reuses the whole
shared spine: `streamWithContinuation`, persist-user-first (66 §3.2), meter-first (`story.memory`), the EMPTY
fail-safe, `truncateMessages` rewind/regenerate, and the coach-speaks-first idempotent opener (static
fallback so it always opens). `MEMORY_INTERVIEW_GUIDANCE` is the biographer's interviewing voice, wiring the
McAdams deepening ladder (the research that never reached the gap pass); it never writes the memory up
in-chat.

**The readiness → confirm → save flow.** A `[[SELFOS:MEMORY_READY]]` marker (paired with the spoken
"there's a whole memory here now, save it?" invitation) sets a durable `readyAt` on the record (survives
navigation — the DREAM_READY §3.4 lesson) and lights a "Save this memory" affordance (never a gate — the
button is available once there are exchanges). `synthesizeMemory` (a bounded `extendedThinking: false` JSON
call, meter-before-parse, tolerant) produces the structured draft — title, a first-person `narrative` in the
person's own voice, approximate date/era, places, people (linkable to household people), life areas,
emotional texture, pull-quote candidates, an optional McAdams `scene` key, and a `sensitive` flag — rendered
as a one-tap **confirm card** (editable title/date/narrative/texture). `saveMemory` commits it: status
`saved`, and it distills into an `Insight` (`source: 'memory'`, `approved: true`) so it feeds coaching /
Memory / Together / questionnaire de-dup like any session/dream insight. A normal memory's facts default
partner-shared (`producedFactShare`); a **sensitive** memory's facts are `restricted` + `lifeArea:
'Intimacy'` (own-context only, never partner-shared — the intake-restricted precedent). Saving is gated on
the `sessions.memoryEnabled` toggle for the INSIGHT only — the memory still saves + feeds the book when
memory is off. Re-save reuses the same `insightId`, carrying sharing forward.

**Feeding the book.** A new first-class `StorySourceKind: 'memory'` — `buildStoryCorpus` emits one corpus
item per SAVED memory (the first-person narrative + emotional texture), with real per-memory provenance, so a
chapter paragraph can cite the specific memory it wove in, editing/deleting a memory stales the chapters that
cite it, and the honesty note counts "memories you shared". A gathering/ready-but-unsaved memory feeds
nothing (the photo-answers "wire the corpus read in the same slice" lesson).

**Surfaces.** A "Share a memory" card leads the Interview tab; each gap gets a "Talk it through" that opens
the chat seeded from the gap's focus; a photo gets "Tell the story of this photo" (seeded from its caption);
a "Memories you've shared" collection lists every memory (title · era · people · "wove into <chapter>") with
re-open / keep-talking / **delete-truly-forgets** (removes the record + transcript + attachments + the
Insight, so the corpus + coach both forget it). The chat carries the standard `CrisisFooter` (memories
surface trauma) and a `crisisFlag` on synthesis routes to support. Full in-chat photo attachments reuse the
Sessions media machinery (path-guarded encrypted storage, mime/size re-validation, vision content blocks
re-read per turn). Seam: `story:memoryList/Get/Open/Turn/Retry/Rewind/Regenerate/Synthesize/Save/Delete/
StoreAttachment/GetAttachment` + a `story:memoryChunk` stream, all gated `story.own` + active-person-scoped;
usage type `story.memory`; the AI key stays host-side.

### 14.1 Decisions locked 2026-07-20

1. **Person-level** memories (survive book delete/rewrite, feed every book + the coach).
2. **One-tap confirm card** (editable) — synthesis then commit, not a Memory-dashboard review.
3. Memory insight **partner-shared by default**, **trauma/intimacy restricted** (own-context only).
4. **Full in-chat photo attachments** (the Sessions attachment machinery).

### 14.2 Resume + history (2026-07-21, BUILT)

A memory chat behaves like a Session — you can leave it unfinished and come back to it later, and every
chat is kept as history.

- **Every started chat is kept** (owner decision) — a memory persists (record + transcript) the moment it's
  opened; nothing is auto-reaped, even an opener-only draft.
- **Auto working title** (owner decision, an AI call over the free "first-line snippet") — once there's been
  an exchange, an untitled **unsaved** draft (`gathering` OR marker-`ready`-but-not-yet-synthesized — both carry
  an empty title, so a memory shared in a single turn still gets one) gets a short AI-generated working title (a
  cheap metered `story.memory` call, best-effort; it re-attempts each turn only while the title is still empty,
  then stops; re-reads before the write so it won't clobber the synthesis title) so the resume list can name it.
  `listMemoryViews` returns the raw title; the renderer shows a "New memory" fallback for a still-untitled draft.
- **Two sections on the Interview tab** (owner decision): **"Pick up where you left off"** (the resumable
  `status !== 'saved'` chats — each with an **"In progress" / "Ready to save"** chip, a "Last worked on <when>"
  line, and a **Continue** affordance) sits above **"Memories you've shared"** (the finished, `saved` ones).
- **Reopen a synthesized-but-unsaved draft → straight to the review card** (owner decision) — a `ready`
  memory reopens directly on the editable confirm card built from the draft it already wrote (no new AI
  spend); "Keep talking" returns to the chat.

---

## 15. Backlog batch 0 — correctness & hygiene (2026-07-22, PROPOSED)

The first batch of the groomed Your Story backlog (GitHub #288, #305, #289): one real dead-end bug, two
honesty/granularity gaps in what the corpus claims vs what it feeds, and the streaming-sink refactor the
§14 memory chat's fifth copy finally justified. Nothing here changes what the biographer writes — it makes
the app tell the truth about its own material and stops the seam growing a sixth copy of the same plumbing.

### 15.1 Memories without a book (#288 — bug)

**The dead-end.** A memory is **person-level** by design (§14, decision 1) — it survives a book delete and
feeds every future book plus the coach. Its derived Insight is permanent. But `provenance.ts` links a
`source:'memory'` insight to `/story/interview?memory=<id>`, and the Interview tab lives _inside_ the book
Studio. A person who deletes their only book keeps the memory and the insight, and the Memory card's "view
source" link lands them on "Begin your book" — the memory is unreachable, permanently, from the one surface
that still cites it.

**Decision (owner, 2026-07-22): keep the memories, give them a book-independent home.** Memories are NOT
reaped when the last book goes — that would silently forget material the coach is actively using, and the
delete-a-book confirm has no business deleting unrelated life material.

**The surface.** A new book-independent route **`/story/memories`** — titled **"Your memories"** — rendering
the SAME two sections the Interview tab already has ("Pick up where you left off" + the saved collection,
§14.2), extracted into one shared component so the two surfaces cannot drift. (The page title deliberately
differs from the "Memories you've shared" section heading inside it — two headings reading identically on one
screen is the §7 label collision.) It renders identically with a
book, with several books, or with none; opening/continuing a memory chat works with no book (the backend
already does — `buildMemorySystem` falls back to the warm/third default config when `listBooks` is empty).

- The memory deep-link becomes **`/story/memories?memory=<id>`** unconditionally — correct in every book
  state, so the dead-end closes by construction rather than by a has-a-book branch.
- The Interview tab keeps its sections (a memory is part of the interview loop when you have a book) and
  gains a quiet "See all memories →" to the route.
- Entry with no book: reachable from the Memory card's provenance link AND from a quiet "Your memories"
  action on the story invitation — the latter is load-bearing, not decoration, because an unsaved draft
  memory produces no Insight and so has no provenance link to arrive by. That action is never disabled by
  AI state: sharing a NEW memory needs AI, but reaching one you already told the biographer must not.
- The collection reloads on an active-person switch (keyed on the active person, the `Story.tsx`
  convention): AppShell resets the per-person memory store but the standalone route does not unmount, so a
  mount-only load would leave the next person on a permanently blank surface.
- When the multi-book shelf lands (#299), `/story/memories` is already the right shape — person-level, not
  book-scoped.

**No schema, no new IPC, no backend change.** `storyMemoryList/Open/Turn/...` are all already
`story.own`-gated + active-person-scoped and book-free.

### 15.2 Corpus honesty & granularity (#305)

**(a) "Drawn from N conversations" overstates.** The invitation chip row (`drawnFromChips`, §13.3) reports
`stats.conversations` — a raw `listConversations` count — but `buildStoryCorpus` **never reads a transcript**.
Sessions reach the biographer only through their derived, approved insights. A person with 40 chatty
sessions and no analysis sees "40 sessions" on a promise the book cannot keep.

`getStoryCorpusStats` is re-derived from **what actually feeds**, mirroring every drop `buildStoryCorpus`
itself makes: **reflections** (approved insights that pass `feedableInsights` — and, mirrored explicitly
here, never a wholly-flagged one, whose material the corpus discards), **dreams** that inform context,
**saved** memories with a written narrative, and **answered** questionnaires (a wholly-declined response
feeds nothing, so it doesn't count). The bare conversation count is gone.

Deliberately NOT counted, though they do feed: the **onboarding intake** (its portrait already rides in
under `reflections`), **goals**, **challenges**, and **photo answers** (book-scoped, while the invitation is
pre-book). The chip row is a human read of the material, not an audit. The year span keeps its existing
dated-everything derivation, conversations included: a session's **date** is real chronology for the life
even though its transcript is never source material.

Cost, honestly: this is no longer free — it decrypts one response per questionnaire the person was sent, so
a long auto-check-in history (spec 63) makes it grow. `countAnsweredQuestionnaires` keeps it as cheap as an
exact count allows by skipping the frozen-snapshot decrypt the corpus itself needs.

**(b) The response corpus item is one lumped block.** `buildStoryCorpus` emits every answer the person ever
gave as a SINGLE item with `sourceRef {kind:'response', id: personId}`, so a paragraph woven from one
answer to one check-in cites "all your answers, ever" — freshness can't tell which answers changed, the item
carries no date so it never lands in chronology, and a `source` exclusion can only drop the lot. (The
provenance popover still reads the generic "a check-in answer": `StorySourceRef` carries only `{kind,id,at}`,
so naming the questionnaire in the UI is a follow-on, not part of this slice.)

A new `gatherRecipientPriorAnswersByAssignment` (the per-assignment sibling of the existing
`gatherRecipientPriorAnswers`, sharing its per-question decline filter so a skip is still never fed as
biography material) returns one block per answered assignment, and the corpus emits **one item per
questionnaire** — `sourceRef {kind:'response', id: assignmentId, at: submittedAt}`, label `From "<title>"`,
dated so it lands in chronology. The existing `response` source kind is unchanged; only its `id` grows more
precise, so a per-questionnaire `source` exclusion now works and stale provenance degrades exactly the way
every other missing source already does.

Two migration consequences, both handled deliberately. **An exclusion must never silently lapse** (§3.3): a
person who excluded the old lumped block has `{kind:'source', value: <personId>}` on disk, which after the
re-key would match nothing and quietly re-admit every answer they said never to write about — so a
`personId` source exclusion is honoured as "exclude every answer", with a regression test. And a chapter
citing the old ref **one-time stales** (its freshness signature drifts, as it does for any vanished source);
with `autoRefresh` on that converts into one metered rewrite.

### 15.3 One generic streaming channel (#289 — refactor, behavior-preserving)

`emitMemoryChunk`/`onMemoryChunk` was the **fifth** hand-rolled copy of the same sink (chat · dream · intake
· together · memory) across `BridgeHost`, `coreBridge`, `ipc.ts`, `preload`, `webHost` and the test host —
five near-identical emit methods, five subscribe methods, five `IpcChannels` entries, five module-scoped
`WebContents` senders with their own bind/reset. A sixth streamed surface should need none of it.

**The design.** One surface-keyed channel with a typed payload map:

```ts
export interface StreamChunkMap {
  chat: string;
  dream: string;
  intake: string;
  together: TogetherChunk;
  memory: string;
}
export type StreamSurface = keyof StreamChunkMap;
```

- `BridgeHost` gains `emitStreamChunk<K extends StreamSurface>(surface: K, chunk: StreamChunkMap[K])` and
  loses the five emit methods; `coreBridge`'s call sites become `host.emitStreamChunk('memory', text)` etc.
- One IPC channel `stream:chunk` carrying a `StreamChunkEnvelope` — a **mapped union**
  (`{[K in StreamSurface]: {surface: K; chunk: StreamChunkMap[K]}}[StreamSurface]`), not a widened
  `{surface; chunk: StreamChunkMap[StreamSurface]}`, which would accept a Together chunk labelled `chat`.
  `ipc.ts` keeps ONE `Map<StreamSurface, WebContents>` and one `bindStream(surface, sender)` returning its
  release fn; the per-turn bind + `finally` reset semantics are preserved **exactly**, and the release is
  identity-guarded so a second window's binding can't be torn down by the first turn's `finally` (a stream
  must never outlive its turn or leak into another window — the Together session-bleed lesson).
- The renderer-facing `SelfosBridge` keeps `onChatChunk`/`onDreamChunk`/`onIntakeChunk`/`onTogetherChunk`/
  `onMemoryChunk` as thin one-line delegations over a single `onStreamChunk(surface, listener)`, so **no
  store, component, or test changes** — the collapse is entirely below the renderer API. The preload
  registers one `ipcRenderer` listener **per subscription**, each ignoring envelopes for other surfaces
  (rather than one shared fan-out listener): unsubscribing is then trivially safe and can never drop a
  sibling's subscription, at the cost of one string compare per chunk per subscriber. It stays **zod-free**
  (the sandboxed-preload rule) — the new declarations are types only, so nothing is imported at runtime.
- Adding a streamed surface is then: one line in `StreamChunkMap`, one `onXChunk` delegation. No host part,
  no channel, no sender, no preload entry.

Not in scope: `emitImageProgress` / `story:progress` are _progress_ streams with a different contract; the
typed map can absorb them later, but this slice does not touch them.

### 15.4 Decisions locked 2026-07-22

1. **#288 = keep the memories** — a book-independent `/story/memories` route, never reap on last-book delete.
2. **#305(a)** — corpus stats count what actually **feeds** generation, not raw activity.
3. **#305(b)** — the response corpus item splits **per answered questionnaire** (assignment id as provenance).
4. **#289** — the renderer-facing `onXChunk` API is **kept** (thin delegations); only the transport collapses.

### 15.5 Build slices (each its own PR, standard §6/§7 cadence)

| Slice | Issue | Scope                                                                                                                                                                                                                                                                                                                                                                    | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B0-1  | #288  | Extract the shared memory-collection component; add the `/story/memories` route + the story-store wiring; re-point `provenanceTarget` unconditionally; "See all memories →" on the Interview tab + "Your memories" on the invitation. Carries the Interview tab's pre-existing 360px `.gapRow` overflow fix (same surface, so it lands here rather than as a follow-up). | RTL: the route renders both sections with **no book**; the deep-link opens that memory; an empty state, never a blank page; the collection reloads on a person switch; the invitation entry works. Unit: the provenance target is book-independent. E2E: share + save a memory → delete the only book → the Memory insight's "view source" opens the memory (the dead-end, verified to FAIL before the fix) → 360px guard.                                                                                                                                                                                                                 |
| B0-2  | #305  | `getStoryCorpusStats` re-derived from feeding sources; `gatherRecipientPriorAnswersByAssignment`; per-questionnaire corpus items.                                                                                                                                                                                                                                        | Core: stats ignore transcript-only conversations + count memories/answers; one item per answered assignment with its assignment id + date; a declined answer still never feeds; a `source` exclusion on one assignment drops only that one. RTL: chips read the new stats.                                                                                                                                                                                                                                                                                                                                                                 |
| B0-3  | #289  | `StreamChunkMap` + `emitStreamChunk`/`onStreamChunk` through `BridgeHost` → `coreBridge` → `ipc.ts` → preload → `webHost` → test host; delete the ten per-surface methods.                                                                                                                                                                                               | The existing streaming tests are the regression proof (the 206-test coreBridge suite drives chat/dream/intake/together/memory through the collapsed sink unchanged). New host tests: a chunk reaches ONLY its own surface's listeners; a Together chunk keeps its `sessionId`; unsubscribing one listener leaves the surface's others intact. The per-turn sender lifecycle lives in `ipc.ts`, which has no unit harness (it needs Electron) — it's covered end-to-end instead: **74 E2E across all five streamed surfaces** (Sessions, dreams, onboarding, Together, memory), each of which would fail on a mis-bound or un-reset sender. |

---

## 16. Backlog batch 1 — authoring control (2026-07-22, PROPOSED)

The second batch of the groomed backlog (GitHub #291, #292, #296, #302, #301): the gaps an author hits
while actually working on their book. Every one is a place where the app decides something the person
should — the outline is AI-proposed-only, the timeline is captured then never shown, the front matter is
three free-text boxes, the title is a one-shot, and nothing anywhere counts a word. None of them needs a new
engine; four of the five reuse machinery that already exists behind an AI-proposal wrapper.

### 16.1 Manual outline control (#291)

**Today.** `applyStructuralProposal` (`storyStructureService.ts`) performs _some_ of the mutations an author
wants — insert a chapter, split one, reorder a part — keeping the draft-head chapters aligned via
`syncPartChapterOrder`. But they are reachable **only** by approving an AI proposal: a person who knows their
own life better than the model cannot move a chapter without asking the model to suggest it. And the proposal
union (`newChapter | splitChapter | reorder | prologueRewrite`) has no **merge**, **rename**, **delete**,
**add/delete part** or **cross-part move** at all — those are genuinely new logic here, which is why the merge
invariant below needs its own guarantees rather than inheriting the proposal path's.

**The change.** Expose those mutations directly as a small, deterministic, **AI-free** API — add part / add
chapter / rename / reorder (within and across parts) / split / merge / delete — and give the Chapters tab a
manual editing affordance. The rules the proposal path already enforces are the same rules here, extracted
so both callers share them rather than the manual path re-implementing them:

- **A chapter with prose is never silently destroyed.** Delete is the only discarding operation and it
  confirms; **merge is non-lossy by construction** — it concatenates both chapters' prose (joined by a blank
  line) and carries the person's protected blocks, pinned quotes, image placements, markup marks, to-dos and
  version history onto the survivor, so it needs no confirm. Critically, the target may be **outlined but
  never drafted** (routine after a budget-stopped draft pass, which leaves later chapters with no record at
  all): the merge starts from a fresh shell in that case rather than skipping the write, because skipping it
  would delete the source and take its prose with it while reporting success — the §13.9 loss this op exists
  to prevent.
- **A removed chapter is forgotten everywhere.** One `forgetChapter` path clears the record, its markup, its
  history, its entries in the book-level to-do roll-up (otherwise a phantom "Needs you" item survives forever
  — nothing could re-sync it away, since its markup file is gone) and its rows in the image index.
- **Order stays consistent by construction:** every mutation re-numbers its part and calls
  `syncPartChapterOrder`, so an outline edit can never leave a chapter orphaned or double-ordered.
- Reordering and renaming **do not** stale a chapter (its material didn't change). A merge does. A split
  stales **only when the first half's brief actually narrows** — a title-only split leaves the chapter still
  supposed to say everything it already says, so staling would provoke a metered rewrite that reproduces the
  same chapter. The split form therefore collects both halves' titles _and_ briefs.

### 16.2 Timeline studio (#292)

**Today.** `Book.timeline` is generated by the foundations pass, written to `timeline.enc`, carried to the
renderer inside the bundle — and read by nothing. The only reference in the entire renderer is a provenance
_label_ string. `TimelineEvent.userEdited` exists specifically to protect a hand-fixed event from AI
overwrite, and nothing has ever set it. It is write-only dead data.

**The change (decision, 2026-07-22): the timeline becomes load-bearing — grounding AND chapter ordering.**

- A **timeline view** on the Chapters tab — the chronology sits with the structure it shapes — as a flat
  chronological list (dated first, then fuzzy eras, then undated), with add / edit / remove / re-date, each
  edit stamping `userEdited: true`. Persisted **sorted**, so a reload shows the order the edit did.
- **Grounding:** `buildStoryCorpus` emits one corpus item per moment (`kind: 'timeline'` — already in
  `StorySourceKind`, never used), dated, so the biographer can place a scene in the right year instead of
  inferring it. A generated moment is labelled as one the biographer _placed_, a hand-edited one as a date
  they _confirmed_: corpus items are introduced as "source material, never invent beyond it", so the model's
  own earlier inference must not be laundered back as something the person vouched for.
- **Chapter ordering:** the structure pass renders the chronology as a framed `THEIR TIMELINE` block ("trust
  these dates over anything you infer") and tells the reorder rule that the timeline is the authority on when
  things happened, so correcting a date actually re-shapes the book. It **proposes**, never silently
  re-orders a drafted outline. The timeline's corpus items are filtered out of that one pass, since the block
  already carries them — otherwise every structure prompt ships the whole chronology twice.

**Durability — what "what you fix here stays fixed" actually means.** The naive reading (a `userEdited`
event is never overwritten) is too narrow: it holds for a re-dated moment but not for a rename or a delete,
and the first cut of this slice failed both. What holds now:

- A **corrected date** survives any later foundations/refresh pass (the promise `userEdited` always encoded;
  this is the first code to honour it).
- A **renamed** moment absorbs the model's re-proposal instead of being duplicated by it. Generated events
  carry a **stable id derived from their normalized label** rather than a fresh uuid per pass, so the
  re-proposal collapses onto the person's version. Stable ids also stop a `source` exclusion on a moment
  being orphaned by the next pass, and stop every citing chapter drifting `stale` (a paid rewrite for
  nothing).
- A **deleted** moment stays deleted — a tombstone list (`LifeTimeline.removed`, additive-optional, no
  version bump) records the normalized label so a later pass can't re-propose it. Adding it back clears the
  tombstone.
- A **rewrite from scratch** keeps every moment the person authored or corrected and discards only what the
  biographer proposed — the confirm dialog now says so. (It previously deleted `timeline.enc` outright,
  which was fine when the timeline was invisible AI output and is silent destruction of the person's own
  work now that it isn't.)
- Residual, documented rather than implied: a model re-proposal that is genuinely **reworded** ("Birth in
  Ohio" vs "Born in Ohio") still reads as a different moment and lands alongside the person's. Normalization
  catches case/punctuation/spacing, not synonyms.

Deliberately NOT built: era **grouping** in the view (a flat list is honest for the size these lists reach),
and any instruction to derive `eraFrom`/`eraTo` stamps from the chronology — the dates reach the model, but
nothing tells it to stamp eras with them, so the spec shouldn't claim it.

### 16.3 Structured front & back matter (#296)

**Today.** `BookMatter` is three optional free-text strings (dedication, epigraph, acknowledgments).

**The change (decision, 2026-07-22):** the audit's five — **dedication, epigraph, acknowledgments,
about-the-author, colophon**. The three existing fields keep their names and values (additive-optional, no
migration, no `schemaVersion` bump); `aboutAuthor` and `colophon` are new.

**The boundary is added to, never replaced.** The draft of this section said the colophon "carries" the
not-medical line, with a blank colophon falling back to it — but that makes a safety line the person can
overwrite by typing anything at all. As built, a colophon they write is rendered **above** the standing
`BOOK_BOUNDARY_LINE`, which always appears (§8.2). One shared `colophonLines()` helper feeds the reader, the
Markdown export and the PDF export, so the three can't drift on the one line that has to be there — and an
exported or shared copy leaves the vault, which is exactly when it matters most. Three hardenings the review
surfaced: the boundary also renders **on the reader's title page** (owner decision), so someone who reads
the front matter and one chapter — or a draft with no chapters written — still sees it, not only after the
last chapter; the Markdown export runs author matter through `mdSafeMatter` (a line-initial `<!--` opens a
CommonMark HTML block that would otherwise swallow every following line, boundary included, in any renderer
with HTML on); and `colophonLines` won't print the boundary twice if it's pasted in as a colophon. Only the
E2E pins the exact wording (`not a medical record`) end-to-end — the core tests would pass on a softened
line — so a `storyMatter` unit asserts the wording is present too.

Light completeness prompts on the Settings tab ("your book has no dedication yet") — never a gate, never a
nag. Matter is **snapshotted at publish** with the rest of the head, so a reader sees the matter as it was
when published, not as it is now.

### 16.4 Title workshop (#302)

**Today.** The AI title is one-shot and only while `titleAuto`; there is no way to see alternatives or ask
again, and the essence regenerates only via a full rewrite-from-scratch (which discards every chapter).

**The change (decision, 2026-07-22): one metered pass returns N alternatives (~5), and "suggest again" is a
new pass.** Cheapest per title, and the person compares a set rather than judging one at a time. Plus a
**standalone essence regeneration** — its own small pass, so re-reading the book's through-line no longer
requires destroying the draft. Choosing a title (AI or hand-written) clears `titleAuto`, so the app never
silently re-titles a book the person named.

### 16.5 Manuscript metrics (#301)

Deterministic, **no AI, no new storage**: per-chapter and whole-book **word counts**, and a **pacing /
balance** read (each chapter's share of the book, flagging the outliers — "this chapter is 4× the average").
Rendered on the Studio hero (whole-book) and the Chapters tab (per chapter). Counts come from the drafted
markdown with markup stripped, so a chapter's count matches what a reader would actually read.

### 16.6 Decisions locked 2026-07-22

1. **#292** — the timeline feeds **grounding AND chapter ordering** (not display-only).
2. **#296** — five matter fields: dedication, epigraph, acknowledgments, about-the-author, colophon.
3. **#302** — **one pass returns N alternatives**; "suggest again" is a new pass.
4. Release cadence: Batch 0 + Batch 1 ship together (the open release PR accumulates them).

### 16.7 Build slices (each its own PR, standard §6/§7 cadence)

| Slice | Issue | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1-1  | #291  | A shared AI-free outline API (`storyOutline.ts`) — the extracted `chapterShell`/`syncPartChapterOrder` the proposal path now imports, plus the genuinely new merge/rename/delete/part ops; the Chapters tab manual editor (↑/↓ reorder, secondary actions in a kebab, merge target as a Select, lossy ops confirmed).                                                                                                                                                                                                                                      | Core: every mutation keeps order + `partId` consistent with no orphaned records; merge keeps BOTH chapters' prose **including into an undrafted target** (verified to fail without the shell fallback) and carries marks/to-dos; delete clears its to-dos; a title-only split does NOT stale. RTL: the kebab actions, the cross-part ↑/↓ payloads, the split form's briefs, a refused edit surfacing. E2E: rename + reorder + merge through the real UI → decrypt asserts the outline AND chapter records agree and the prose survived.                                                   |
| B1-2  | #292  | Timeline view + editor (`userEdited` stamped, persisted sorted, serialized writes); stable label-derived ids for generated moments; a tombstone list so a delete sticks; corpus emits dated `timeline` items (honestly labelled); the structure pass gets a framed `THEIR TIMELINE` block with the corpus copies filtered out; rewrite-from-scratch keeps the person's moments + the dialog says so.                                                                                                                                                       | Core: a hand-edited event survives a foundations pass; a RENAMED one absorbs the re-proposal rather than duplicating; a DELETED one is not re-proposed (and adding it back clears the tombstone); normalization matches case/punctuation/spacing; the chronology persists sorted; a rewrite keeps the person's moments and drops the biographer's. Bridge: round-trip + gating. RTL: a corrected date is sent as `date` with `approx` cleared; a fuzzy era goes to `approx`. E2E: correct a date through the UI → **it reaches a captured structure prompt** (and the old date does not). |
| B1-3  | #296  | `aboutAuthor` + `colophon` on `BookMatter` (additive, no bump); the Settings matter editor + a light missing-matter nudge; reader + both exports render them through one shared `colophonLines()`; matter rides the existing publish snapshot.                                                                                                                                                                                                                                                                                                             | Core: the boundary line renders with a colophon, without one, and with a whitespace-only one; `missingMatter` names the gaps and ignores whitespace; both exporters emit about-the-author AND the boundary. RTL: the editor saves both fields and shows the nudge. E2E: the author writes both → the exported Markdown carries them **and** the boundary → the READER sees them at the end of the book.                                                                                                                                                                                   |
| B1-4  | #302  | `suggestTitles` (one metered `story.title` pass, N alternatives, current title + case-dups dropped) + a standalone `regenerateEssence` (`story.essence`); the `TitleWorkshop` UI (Suggest titles → Use this / Suggest again; Rewrite the essence → Keep / Discard). Both passes **return, never write** — the caller commits the pick through `update`, which clears `titleAuto` — so a metered pass never mutates behind a failed save.                                                                                                                   | Core: one pass yields N distinct titles, metered once, meter-before-parse, honest failure (NO_KEY/MALFORMED); a second call spends again; essence regen touches no chapter. RTL: pick → title set + commit; essence keep → commit, no chapter touched. E2E: Suggest titles → the current title is deduped out → Use this updates the hero + decrypted book title → Rewrite the essence → Keep persists the new through-line.                                                                                                                                                              |
| B1-5  | #301  | Pure `manuscriptMetrics(chapters)` (per-chapter reader-visible word count, share-of-book, `'long'`/`'short'` pacing outliers vs the mean; only WRITTEN chapters count; balance flags fire only with ≥3 written) reusing the shared `countWords`, exposed to the renderer through the lean `@selfos/core/story-metrics` subpath (the `story-diff`/`story-matter` precedent — no crypto barrel). Studio hero shows the whole-book length (total / written count / average); the Chapters tab shows each written card's word count + share + an outlier note. | Core: `readerWordCount` strips inline emphasis; empty book is all zeros (never NaN); unwritten shells contribute nothing and are never flagged; share + average correct; no balance flags under 3 written; a chapter ≥2× the mean is long, ≤0.4× is short; order preserved. RTL: the hero length line + per-chapter word/share + long/short notes render. E2E: after writing a book the hero shows the whole-book length end-to-end (real core → renderer via the lean subpath).                                                                                                          |

## 17. Backlog batch 2 — the biographer's craft (2026-07-22, PROPOSED)

The third batch of the groomed backlog (GitHub #297, #295, #294, #304): the machinery a real biographer relies
on — feeding each chapter the _relevant_ material within a budget, knowing the book's recurring people, keeping
facts consistent across chapters, and citing the person's own vivid lines. All decisions below were locked with
the owner on 2026-07-22 (AskUserQuestion) before any code.

### 17.1 Corpus budgeting + per-chapter relevance slicing (#297) — BUILT (B2-1)

**Today.** `generateChapter` laid the WHOLE corpus into every chapter prompt: a long life both blew the context
window and diluted a chapter with material from unrelated eras/areas — "no corpus budgeting" (MAJOR).

**The change.** Two pure, AI-free, no-storage passes in `corpusBudget.ts`:

- **`sliceCorpusForChapter(corpus, chapter, {tokenBudget})`** — score each source item's relevance to the
  chapter (a life-area match weighs most: +3; falling in the chapter's era: +2; keyword overlap with its
  title + brief: up to +3), then keep the best within a token budget (`CHAPTER_CORPUS_TOKEN_BUDGET = 8000`),
  ordered by relevance then chronology. A large item never blocks the smaller ones after it (best-effort
  packing). A chapter with no strong matches still fills to budget in time order — relevance only reorders, so
  a thin corpus stays usable (§7). Wired into `generateChapter` AND the `applyMarkup` revision path (both write
  ONE chapter); the freshness signature stays over the FULL corpus, so a budget/relevance tweak never stales
  every chapter.
- **`budgetCorpus(corpus, {tokenBudget})`** — a whole-corpus cap for the foundations pass, which needs breadth
  not a single chapter's slice. Under budget it's returned unchanged; over budget
  (`FOUNDATIONS_CORPUS_TOKEN_BUDGET = 40000`) it keeps the outline-critical distilled/dated spine first
  (timeline > memory > insight > goal > … , chronologically within a priority) and trims the bulk raw intake
  first (its distilled portrait rides in as an insight anyway).

Token counts are a rough estimate (~4 chars/token) — only ever used to BOUND a prompt, never billed. The
profile is always kept in full and never counted. The budgets are documented cost/quality knobs, not a
user-facing setting.

### 17.2 Cast register (#295) — BUILT (B2-3)

**Decision: internal + opt-in front matter.** Build a cast register automatically (from the People graph +
memory people + named mentions) to keep names/relationships consistent across chapters; the author may
_optionally_ publish it as a "dramatis personae" front-matter section. Real names appear in the book only if
the author opts in.

### 17.3 Cross-chapter continuity + line-edit (#294) — BUILT (B2-4)

**Decision: review items + opt-in line-edit.** A continuity checker reconciles names/dates/facts across
chapters and surfaces conflicts as review items the author resolves (consistent with how Story already surfaces
proposals — never an automatic rewrite). The line-edit pass is an opt-in, per-chapter suggestion.

### 17.4 Quote mining (#304) — BUILT (B2-2)

**Decision: review queue, author approves.** Mining surfaces candidate verbatim first-person lines (from
Sessions/Together) as a review queue; nothing is cited until the author approves each one. No private line
reaches a chapter — or a shared/exported book — without an explicit OK. Approved quotes become citable corpus
material with real provenance. Privacy is enforced at MINING time: a Together line is a candidate only when
the subject authored it and it is not a private aside (a partner's words never enter the queue), and a
confidential Together **prep** thread is excluded from mining entirely (the person's shared Together lines are
mined separately, with the aside/partner gates).

### 17.5 Build slices (each its own PR, standard §6/§7 cadence)

| Slice | Issue | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2-1  | #297  | Pure `corpusBudget.ts`: `sliceCorpusForChapter` (life-area/era/keyword relevance within `CHAPTER_CORPUS_TOKEN_BUDGET`) + `budgetCorpus` (whole-corpus cap by outline-criticality). Wired into `generateChapter`, `applyMarkup`, and `generateFoundations`; freshness stays over the full corpus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Core: token estimate; relevance scoring (area/era/keyword, no-signal = 0, out-of-era = 0); slice keeps the relevant within budget, packs around a large item, and fills chronologically with no signal; `budgetCorpus` no-op under budget, keeps the spine + trims raw intake over budget, total on empty. Regression: the generation E2E still writes valid chapters through the sliced path.                                                                                                                                                                                                                       |
| B2-2  | #304  | New pure `storyQuotes.ts`: a deterministic AI-free miner (`mineQuoteCandidates`) over the subject's OWN `role:'user'` session + Together lines — Together filtered to `authorPersonId === subject && !privateAside` so a partner's words never enter the queue — plus `isQuotable`/`setQuoteStatus`; a `quotes.enc` store (the exclusions precedent); a new `'quote'` `StorySourceKind`; `buildStoryCorpus` emits ONLY `status:'approved'` quotes as `{kind:'quote'}` items (the single funnel — pending/rejected never reach generation or export); the `story:quoteCandidates`/`:mineQuotes`/`:setQuoteStatus` seam (gated `story.own` + active-person-scoped); the "In your own words" review section on the Interview tab.                                                                                                                                                                                                                                                                                                                   | Core: `isQuotable`; mine dedupes + never re-surfaces a rejected line + mines only the subject's own non-aside Together lines (a partner's never); approve/reject flips status; the corpus emits an approved quote but never a pending/rejected one. Bridge: mine → approve round-trip + refused without `story.own`. RTL: mine → approve moves a line to "can quote". E2E: send a session line → mine → approve → decrypt asserts it persisted approved (so the corpus will cite it).                                                                                                                                |
| B2-3  | #295  | New pure `castRegister.ts`: `getCastRegister` builds the book's recurring people from the People graph (relationship type/label), saved-memory `people[]`, and named mentions in the (exclusion-filtered) corpus — reusing the same gated related-people read the corpus uses (never another person's private data; an excluded person drops out). `castForPublication` derives the reader-facing `{name, relationship}` shape. A new `BookMatter.castPublished` opt-in (off by default) + a frozen `PublishedManifest.cast`: `publishBook` and the owner-draft reader compute + freeze the cast ONLY when opted in (a shared reader can't recompute the subject's private graph). Reader + both exports render a "The people in this book" front-matter section; the `story:castRegister` seam (gated `story.own` + active-person-scoped) feeds the Settings matter editor (a Publish-a-cast-list `Switch` + a live register preview).                                                                                                          | Core: register from graph (label wins over type) + mentions; an excluded person never appears; `castForPublication` keeps graph/memory/mentioned, drops a zero-signal name; empty on a lone subject. Publish: cast frozen only on opt-in, absent when off. Export: both renderers show the list (and omit it with no cast). Bridge: register naming a partner + refused without `story.own`. RTL: preview shows only when toggled on; save sends `castPublished`. E2E: seed a partner → toggle Publish → the preview lists them → decrypt asserts the opt-in persisted.                                              |
| B2-4  | #294  | New pure `storyContinuity.ts`: `checkContinuity` (a metered `story.continuity` pass over the written chapters' prose → name/date/fact findings stored as review items in `continuity.enc`, de-duped across runs incl. resolved/dismissed; zero findings is the healthy result; no spend under 2 written chapters) + `listContinuityFindings` + `resolveContinuityFinding` (resolve/dismiss — author-driven, never a rewrite). `lineEditChapter` (opt-in `story.lineEdit` pass) polishes ONE chapter keeping meaning/voice + protected/pinned words (code-enforced), refuses truncation, and ARCHIVES the pre-edit text (`ChapterVersion.reason:'lineEdit'`) so it's reversible via the History sheet. Seam: `story:continuityCheck`/`:continuity`/`:resolveContinuity`/`:lineEdit` (gated `story.own` + active-person-scoped, honest AI-off). UI: a "Check continuity" button + a "Continuity to review" card (Mark fixed / Dismiss) on the Chapters tab, and a per-chapter "Polish the writing" two-step confirm beside "Rewrite this chapter". | Core: findings stored pending + de-duped across runs; empty findings is a healthy result; no spend under 2 written chapters; resolve removes a finding and it never re-surfaces; line-edit polishes + archives to History (`reason:'lineEdit'`) + status `updated`, refuses an empty chapter. Bridge: 2-chapter continuity → finding → resolve + line-edit → revised + History, refused without `story.own`. RTL: Check continuity → finding with Mark fixed/Dismiss → resolve removes it. E2E: Polish the writing → prose changes → "Before a polish" in History → decrypt asserts the archived `lineEdit` version. |
