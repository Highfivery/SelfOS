# 72 — Books (many kinds of book, one life)

> **Status:** **Built — COMPLETE** (all eight types, P1–P6 + the `books:*` rename) — _last updated 2026-08-14_
>
> SelfOS writes books from what it knows about you. Spec [64](64-your-story.md) built one — a living
> biography — on a `BookType` registry designed for more. This spec generalizes that foundation into
> **eight kinds of book drawn from the same corpus** (your data plus what connected people share),
> rebuilds the prose pipeline to a publishable standard, replaces perpetual staleness with an explicit
> **Living / Finished** lifecycle, and retires the story's private question engine onto the spec-71
> ask-ledger substrate. It **supersedes spec 64**, whose §3–§19 remain the historical build record.

---

## 1. Overview

**The problem.** Your Story works, and both real books in the vault prove it — 50,006 and 53,778
words of drafted prose. But three things are wrong, and all three were measured against those real
books rather than inferred:

1. **The prose isn't publishable.** Not because of generic AI tells — the doctrine's banned-phrase
   list works (12 hits in 50,006 words). Because the narrator breaks frame **once every 168 words**
   ("the record" ×188, "the biographer" ×34, "doesn't say" ×52), and because it writes from
   156-character distilled facts while 48,283 characters of the subject's actual recorded speech are
   read only to compute a date range.
2. **No book can be finished.** 100% of chapters in both books are `stale`. `STORY_WEEKLY_AUTO_CAP`
   allows 10 rewrites a rolling week against 34 stale chapters, while daily auto check-ins keep
   changing the corpus. The arithmetic never converges.
3. **It is a biography, not a book engine.** The registry was built for many types and holds exactly
   one; `MCADAMS_SCENES` is imported directly by the interview engine, the type is hard-coded at
   three call sites, and 56 user-visible strings say "biographer".

**What this delivers.** One corpus, eight transforms. A prose pipeline that plans, drafts, critiques
and revises each chapter and then edits the manuscript as a whole. A book you can finish. An
interview that remembers what it asked and can hold a conversation about it.

**Related specs.** [64](64-your-story.md) (superseded — the mechanics this reuses), [71](71-question-intelligence-rebuild.md)
(the ask ledger / topic map / planner this adopts), [08](08-questionnaires.md) (generation, sending,
the answering renderer), [13](13-dream-images.md) (the image pipeline + its distillation privacy flow),
[15](15-shareability.md) (what a connected person shares), [58](58-together-couples-sessions.md) (shared pair storage —
the precedent for a two-person book), [00](00-architecture.md) (vault, IPC, security).

## 2. Goals / Non-goals

**Goals**

- **Eight book types, one sourcing model.** Every type reads the same corpus — the subject's own data
  plus what connected people share (§15). Nothing is invented from a blank page. What varies per type
  is how far the prose may depart from the record, how the book is structured, how real people appear,
  what the interview asks for, and how images are framed.
- **Publishable prose.** Every chapter is planned → drafted → critiqued against the craft doctrine →
  revised, then the whole manuscript gets a continuity/motif/pacing pass. Always, on Opus.
- **The writer sees the life, not a summary of it.** Session and Together transcripts, shared
  memories, approved quotes and photo answers reach the corpus; the per-chapter budget is raised from
  8k tokens to a share of a modern context window.
- **A book can be finished.** Per-book **Living** or **Finished**. Living surfaces new material as a
  proposal you accept; a chapter you have reviewed is never rewritten without you. Finished freezes an
  **edition** — done, exportable, and no longer interviewed for.
- **One interview, two ways to answer.** Live conversation or questions in your Inbox, both fully
  informed by the ask ledger, both closing the same gap, both startable by you or by the biographer.
- **The chronology is yours, not a book's.** One person-level timeline every book reads, plus moments
  scoped to a single book.

**Non-goals**

- **Books about someone who is not in your household and shares nothing with you.** The corpus is the
  boundary; a type that needs outside research is out of scope.
- **External (outside-household) sharing via the relay** — architecturally ready (64 §5.8), still a
  later slice.
- **Audio narration, print-on-demand integration, a storefront.** A print-ready PDF, EPUB and DOCX
  already make manual publishing possible.
- **Household contributions** (family-submitted questions and attributed quotes woven in) — the
  highest-value fast-follow after this spec, deliberately not bundled: it needs its own consent and
  attribution model. **Built as [73](73-household-contributions.md)** (2026-08-14).
- **Migrating the two existing books to a new schema.** They regenerate in place (§7.9).
- **Voice interview.** Text only; the turn model must not preclude it (CLAUDE.md §2).

## 3. UX & flows

The approved mockup is the visual contract for every screen below.

### 3.1 Entry & the bookshelf

`/books` (nav label **"Books"**, gated `story.own`) replaces the single-book Studio as the section's
front door. It shows every book the person owns as a cover-backed card: title, type, **Living** or
**Finished ✓**, a progress bar, and an unambiguous count of the type's own unit — _"23 of 45 chapters
written"_, _"11 of 32 pages written"_. Books shared with the person appear in a "Shared with you"
shelf beneath. A card opens the workspace; **+ New book** opens the type picker.

A person with no books sees the invitation (64 §13.3, retained): the promise, the real "drawn from"
counts, the privacy line.

**The URL names the book** (as built, P5b). `/books` is the shelf, `/books/<bookId>` the workspace,
`/books/<bookId>/<tab>` a tab, `/books/<bookId>/read[/<chapterId>]` the reader; `/books/memories` is
reserved for the person-level memory collection, which belongs to no book (§15.1 of 64). Before the
shelf, a single book was implied and `/books/read` meant "read the only one" — an assumption that
stops being true at two books. `/story/*` redirects, so links minted before the rename still land.
The store is what renders and the URL is what deep-links: both are mirrored, because a surface
rendered without a Route (component tests) has no params to read.

The counts come from a dedicated shelf read (`listShelf`, §5.x) rather than the manifest — a count
maintained at write time is a count that can drift from the files, and a shelf that lies about a book
is worse than one that takes a moment. `total` falls back to what is written when a book has no
outline yet, so a book mid-commission reads as whole rather than "0 of 0".

### 3.2 Choosing a kind of book

Eight types in two groups, split by `truthMode`:

**Told true** (`truthMode: 'true'` — never invents; where the record is silent it asks)
`biography` · `memoir` (one bounded era) · `yearInReview` · `portrait` (one person you love) ·
`ourStory` (you and a partner, shared)

**Reimagined** (`truthMode: 'fictionalized'` — real feelings, invented events)
`childrens` · `dreamBook` · `erotica` (18+)

Each card names what it draws on, its shape, and what its interview asks about — all three declared by
the type itself (`BookType.summary`), so a type added later describes itself without touching this
screen. `erotica` requires the shared 18+ acknowledgement from **both** participants (§8.4); the card
is **pickable** and the gate is applied at the commission, where the acknowledgement can actually be
given — disabling the card would send someone to Settings mid-flow to unlock what they just chose, and
the bridge re-enforces the gate regardless (as built, P5b). Picking a type that needs a subject —
`portrait`, `ourStory` — asks who, from the People graph, before the commission step.

### 3.3 Commission

Title (blank = the biographer names it), **voice**, **register** (the type's own style presets),
**length** or **page count** (per `spine`), and a live **specimen** rendering the chosen voice ×
register. A "drawn from" chip row shows the real corpus counts. The commission states the time and
that it runs in the background, then **Write my book**.

### 3.4 Writing

The full-draft screen shows the current chapter, its position, elapsed time and ETA, and the **four
craft passes** as they run (plan → draft → critique → revise). The outline reveals itself as
foundations land. Progress streams from main and survives navigation (64 §13.3, retained). A
"Browse SelfOS ›" exit makes clear it keeps going.

### 3.5 The workspace

A hero (cover, title, essence, the Living/Finished switch, stats, Read / Write / ⋯), a **Needs you**
strip that self-hides when clear, then six tabs:

| Tab               | Holds                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Chapters**      | The card grid by part with word counts and pacing outliers, the write bar, outline editing, continuity findings        |
| **Timeline**      | The person-level chronology + this book's own moments (§3.8)                                                           |
| **The interview** | Open conversation, what it wants next, ground covered, self-noticed ground, photos, what you've told it, quotes (§3.7) |
| **People**        | Everyone the book names, how often, and what they're called in it (§3.9)                                               |
| **Sharing**       | Publish diff, readers with read receipts, export, who this book names                                                  |
| **Settings**      | Writing config, lifecycle, front/back matter, images, exclusions, danger zone                                          |

### 3.6 The living book

A **Living** book detects new material for free (the §5.4 signature diff) and surfaces it as a
**proposal**, never a status: _"3 new details could go in Provider"_ with **Weave these in** /
**Not now**. A chapter marked reviewed is never rewritten without an explicit act. Accepting runs one
metered revision through the craft loop.

**Finish this edition** freezes the current reviewed chapters as **Edition N** — readable, exportable,
shareable, and no longer interviewed for. New material still accumulates quietly and offers
_"Start edition N+1"_ when it's worth it. A finished book can be reopened.

### 3.7 The interview

One surface, ordered by what to do next:

1. **Talk about anything** — an open conversation with no gap attached, optionally seeded by a person,
   a place, a year, a photo, or "something hard". This is the entry that does not exist today.
2. **What it wants next** — the top gap, offering **Talk it through** and **Send me questions
   instead** as equal choices, plus "ask me something else".
3. **Ground covered** — the spec-71 topic map with a **depth** reading (not a boolean), each row
   offering Talk or Ask.
4. **Ground it noticed on its own** — topics the model named from your own answers (71 §5.3).
5. **Start from a photo** — the photo gallery, folded in here because a photo's only purpose is to
   prompt a memory you answer.
6. **What you've told it** — memories and answered check-ins in one list, each showing which chapter
   it wove into.
7. **In your own words** — mined quotes awaiting approval.

**The conversation** is the existing memory chat (64 §14 — streaming, retry, rewind, regenerate,
attachments, confirm card, crisis footer), with two changes: a side rail showing **what it already
knows** about this ground, and a **where this goes** panel naming the gap it closes and the chapter it
will likely land in. Saving the memory closes the gap (§5.5).

The biographer may **invite** a conversation (a `story-checkin` notification and a Home
recommendation), not only send questions.

### 3.8 The timeline

A **person-level** chronology at `people/<id>/story/timeline.enc` that every book reads, plus
**per-book** moments for events belonging to one story (an invented event in a children's book).
Adding a moment asks which it is. `userEdited` still protects a correction from AI overwrite;
tombstones still prevent re-proposal (64 §16.2, retained). A book reads the person timeline filtered
to its own span plus its own additions.

### 3.9 People

Everyone the book names, how often, and **what they're called in it**. A different name substitutes
everywhere the book is read, shared or exported; the draft keeps the real one. The four consent states
are removed (§5.9) — they were manual bookkeeping with no enforcement. The Sharing tab shows a neutral
list of who the book names before you share.

### 3.10 Reading and shaping

Unchanged from 64 §13.5/§13.7: the immersive reader (front matter → chapters with opener art, drop
cap, pinned quotes, figures → back matter and colophon) and the chapter editor (highlight → cut, edit,
add context, correct, ask, pin, exclude; sources panel; Review & apply; History; polish; illustrate).

## 4. Data model (vault files & schemas)

All reads/writes go through the vault service; no direct `fs`. Every change below is **additive with
tolerant parsing** except the four explicit migrations in §7.9.

### 4.1 `BookType` — four new declarative slots

`BookType` (code, not vault — the `guidedCatalog` precedent) gains:

- **`truthMode: 'true' | 'fictionalized'`** — whether the prose may depart from the record. Drives a
  clause in the system prompt and whether the "never invent" rule is absolute.
- **`spine: BookSpine`** — how the book is structured:
  `{ kind: 'eras' } | { kind: 'span', from?, to? } | { kind: 'pages', count, wordsPerPage } | { kind: 'vignettes' }`.
  Replaces the hard-coded parts-and-chapters assumption in foundations.
- **`castPolicy: 'realNames' | 'renamed' | 'childrenAsHeroes'`** — how real people appear, and what the
  People tab defaults to.
- **`framework: BookInterviewFramework`** — already exists, but becomes the **only** source of
  interview dimensions. `MCADAMS_SCENES` moves behind `biography.framework` and is no longer imported
  by the engine.
- **`imageFraming: string`** — the per-type image contract (§8.5). The default is 64's symbolic,
  no-likeness framing; `childrens` overrides it.
- **`audience?: { ageFrom: number; ageTo: number; readingLevel: string }`** — children's books only.

`BookTypeId` is already an open `z.string()`, so adding types is additive.

### 4.2 `BookConfig`

Gains `lifecycle: 'living' | 'finished'` (default `living`) and `edition: number` (default 1).
`quality` is **not** a setting — every book is written at publication quality (§11 resolved).

### 4.3 The timeline moves to the person

- **New:** `people/<personId>/story/timeline.enc` — `LifeTimeline`, the shared chronology.
- **Kept:** `people/<personId>/story/books/<bookId>/timeline.enc` — now holds **only** this book's own
  moments (`TimelineEvent` gains `bookScoped: true`).
- Migration in §7.9.

**As built (P5d).** `readBookTimeline` is a **pure** read that merges the person's chronology with this
book's own moments, deduped by normalized label with the person winning — so it is correct both before and
after the migration has run. `migrateBookTimeline` runs **once on the book-open path**, not on read: making
every reader a writer means two readers can truncate a file the other is mid-write on. Tombstones migrate
too, even when a book has no events left to move — "I took that out" is a fact about the life, and leaving
it behind lets a deleted moment be re-proposed by the next book. The foundations pass folds generated
moments into the **life** timeline for the same reason. Every consumer that hands the chronology to the
model (the corpus, the bundle, the structure pass) reads the merged view; reading the book file alone would
give the biographer a chronology the person's corrections never reached.

### 4.4 New material (replacing the stale status)

**New:** `books/<bookId>/material.enc` — `StoryNewMaterialList`:

```
{ schemaVersion: 1, entries: [{ chapterId, items: [{ sourceRef, label, excerpt }], detectedAt }] }
```

Produced by the free signature diff (§5.4). `BookChapter.status` loses `'stale'`; a chapter is
`new | updated | reviewed | generating`. Migration in §7.9.

### 4.5 Editions

**New:** `books/<bookId>/editions/<n>/` — a frozen copy of the published manifest + chapters + images
at the moment **Finish this edition** was pressed, reusing the existing raw-copy archive mechanism
(`archiveDraftState`). `BookManifest` gains `editions: [{ n, finishedAt, chapterCount, wordCount }]`.

### 4.6 Memories link to their gap and their book

`StoryMemory` gains `bookId?` (which book the chat was started from — fixes the arbitrary `books[0]`
voice selection) and `gapId?` (the gap it answers, so saving closes it). Memories stay **person-level**
and feed every book.

### 4.7 Consent shrinks to pseudonyms

`BookConsentEntry` becomes `{ name, pseudonym?, updatedAt }`. `ConsentState`, `ConsentPerson.consent`
and `unconsentedNames` are **deleted**. `pseudonymMap` / `pseudonymizeChapters` / `pseudonymizeManifest`
/ `pseudonymizeCast` are untouched.

### 4.8 Cast gains a character sheet

`CastEntry` gains `sheet?: string` — a reusable appearance description injected into every image prompt
for a type whose `castPolicy` is `childrenAsHeroes`, so the same child looks like the same child across
a picture book (§8.5).

## 5. Architecture & modules

The `packages/core/src/story/` module is renamed **`books/`** with a compatibility re-export barrel for
one release. Modules that change:

### 5.1 `bookTypes.ts` — eight types

Registers eight `BookType` entries. Each carries its own doctrine, structures, style presets,
interview framework, gates and image framing. The `adult === (id === 'erotica')` invariant is tested.

**The doctrine fix (§1 item 1).** `BIOGRAPHY_DOCTRINE`'s honest-epistemics rule currently hands the
model a literal script — `say so on the page ("the record doesn't say", …)`. That example is removed and
replaced with a **prohibition on narrating the sourcing apparatus**: the prose may never refer to "the
record", "the material", "the biographer", "this chapter" or "this book"; a silence is written around,
or attributed in character ("he never explained why", "she remembers it two ways"). The epistemic
constraint — never invent — is unchanged. This is inherited by every type's doctrine.

### 5.2 `bookCorpus.ts` — feed the writer the life

- **Session and Together transcripts** enter the corpus as `{ kind: 'transcript' }` items — the
  subject's own `role: 'user'` messages and their own non-aside Together lines, chunked per
  conversation. This is the single biggest quality lever: it is where sensory, first-person voice
  lives. Privacy is unchanged — own data only; a partner's asides and messages remain structurally
  absent (58 §3.8).
- `CHAPTER_CORPUS_TOKEN_BUDGET` 8,000 → **60,000**; `FOUNDATIONS_CORPUS_TOKEN_BUDGET` 40,000 →
  **150,000**.
- Relevance slicing takes the chapter's **scene plan** (§5.3) as its query rather than the title and
  brief alone.
- `runGapPass` gains the missing `budgetCorpus` call (64 defect D-03).
- `spine` drives what a type reads: `{ kind: 'span' }` filters the corpus to a date range so a memoir
  or a year-in-review sees only its era.

### 5.3 `bookGenerationService.ts` — the craft loop

Each chapter becomes four bounded, metered, individually-resumable calls:

| Pass         | Type            | Produces                                                                                                           |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Plan**     | `book.plan`     | The scenes this chapter turns on, the thread it carries, what it must not repeat                                   |
| **Draft**    | `book.chapter`  | The prose, with `[[SRC:sN]]` citations                                                                             |
| **Critique** | `book.critique` | A structured list of defects against the doctrine — meta-narration, summary-not-scene, invented detail, repetition |
| **Revise**   | `book.revise`   | The corrected chapter                                                                                              |

Then, once the book is drafted, a **manuscript pass** (`book.manuscript`) reads every chapter for
continuity, repeated motifs, pacing and arc, and emits findings — reusing and extending the existing
`checkContinuity` review-item model rather than rewriting silently.

`CHAPTER_MAX_TOKENS` rises to **16,000** so a `full`-length chapter can't truncate (64 defect D-04).
Every pass is budget-gated, meters before parse, and refuses honestly on truncation.

**Model.** All book passes run on **Opus** via a per-task model override on `AiDeps` (the app-wide
`ai.model` setting continues to govern everything else).

### 5.4 `bookFreshness.ts` — proposals, not staleness

The signature diff is unchanged and stays free. What changes is the output: instead of setting
`status: 'stale'`, it writes `StoryNewMaterial` entries naming _which_ sources changed and _what_ they
say. `refreshBook` no longer auto-rewrites; it detects, records, and (for a Living book) raises the
proposal. A reviewed chapter is only ever rewritten by an explicit accept.

**Cadence caps become per-book** (`STORY_WEEKLY_AUTO_CAP`, `STORY_INTERVIEW_WEEKLY_CAP`): `queryUsage`
is filtered by the book's id (`UsageEvent.sessionId` already carries it) so a second book never starves
the first.

### 5.5 `bookInterviewService.ts` — onto the spec-71 substrate

The private engine — 12 boolean `frameworkCoverage` dimensions and a 50-entry `askedPrompts` list — is
**retired**. In its place:

- A book's `framework` dimensions are **seeded as topics** into the person's spec-71 topic map, exactly
  as 71 §5.3 seeds built-in categories: a seed, never a ceiling. The model names new ground as it
  appears, alias-merged.
- Coverage becomes **depth per topic** (how richly told), derived from the ask ledger's counts plus
  whether the material contains a rendered scene — not a boolean.
- `runGapPass` becomes a **planner call** in the 71 §5.5 sense: it picks ground before generation
  writes, scoped to this book's type and span.
- **Both channels close the gap.** `askGap` (Inbox) already stamps `assignmentId`; the chat path now
  passes `gapId` into the memory record, and `saveMemory` stamps the ask ledger and marks the gap
  answered — closing the 64 defect where a conversation left the gap open and re-proposable.
- `StoryMemory.scene` finally feeds coverage (it is written today and read by nothing).
- **`buildMemorySystem` is given the dedup reference** (prior answers, insight facts, asked prompts,
  intake, feedback, covered topics) — the same bundle the questionnaire path already assembles — so the
  conversation stops opening cold, and the book config comes from `memory.bookId`, not `books[0]`.
- The cadence may mint **either** a check-in or a conversation invitation.

### 5.6 `bookImageService.ts`

`STORY_IMAGE_FRAMING` becomes per-type (`BookType.imageFraming`). For `castPolicy:
'childrenAsHeroes'`, the framing permits depicting the named children and the prompt carries the
`CastEntry.sheet` so the character stays consistent across pages (§8.5). Image size derives from the
type's `spine` (a picture-book page is not a square).

### 5.7 Renderer

`Story.tsx` (5,355 lines, 44 components) is split into `app/routes/books/` — one component per file per
CLAUDE.md §4. New: `Bookshelf`, `TypePicker`, `TimelineTab`, `PeopleTab`, `InterviewTab` (rebuilt),
`ConversationPanel` (the memory chat + its rails). Retained largely as-is: `BookReader`,
`ChapterEditor`, `ShareReadersPanel`, `OutlineEditor`, `HistorySheet`, `ReviewSheet`, `ExportDialog`.

### 5.8 Shared storage for "Our Story"

`ourStory` is the one type whose book is not owned by one person. It lives at
`together/pairs/<pairKey>/books/<bookId>/` — the spec-58 pair-storage precedent — readable and writable
by both participants, with the same live-edge re-check on every read. Both are interviewed for it;
either can publish. This is the largest new build in the spec and is its own phase (§10, P6).

### 5.9 Deletions

`ConsentState`, `unconsentedNames` and the warn-at-publish path; `frameworkCoverage` and
`computeStoryCompleteness`'s 12-dimension arithmetic; `BookChapter.status: 'stale'`; the auto-rewrite
branch of `refreshBook`.

### 5.10 Build phases

Each is its own PR-gated slice under the standard CLAUDE.md §6/§7 cadence.

| Phase  | What                                                                                                                                                                                                                            | Why here                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **P1** | **Prose quality + the blocking defects.** Doctrine fix; transcripts into the corpus; budgets raised; the four-pass craft loop; manuscript pass; Opus; unbudgeted gap pass; chapter token ceiling; empty shells; proposal dedup. | Independently valuable and **provable** — re-measure meta-narration on the regenerated book. |
| **P2** | **Lifecycle.** Living/Finished, new-material proposals replacing staleness, editions, per-book cadence caps.                                                                                                                    | Regenerating is exactly when the lifecycle must be right.                                    |
| **P3** | **The type model.** The four `BookType` slots, `MCADAMS_SCENES` behind the framework, spine-driven foundations, the eight types minus the two hard ones.                                                                        | Everything downstream keys off this.                                                         |
| **P4** | **The interview onto 71.** Retire the boolean engine; topic seeding + depth; gap-closing from both channels; the informed conversation; the open "talk about anything" entry; conversation invitations.                         | Needs P3's per-type frameworks.                                                              |
| **P5** | **The UI rebuild.** Split `Story.tsx`; bookshelf; type picker; the six tabs; person-level timeline; People without consent states; photos into the interview.                                                                   | Presents everything above.                                                                   |
| **P6** | **The two hard types.** `childrens` (page spine, character sheet, per-type image framing, audience) and `ourStory` (shared pair storage).                                                                                       | Each is a genuine new build.                                                                 |

**As built (P6b1 — the shared-book spine).** The spec called `ourStory` the largest new build, and the
reason turned out to be authorization rather than storage:

- **The book path WAS the authorization.** `story:*` handlers checked `story.own` and resolved the active
  person, and every path was built under `people/<activePersonId>/` — so a caller could not reach another
  person's book however they tried, and Story never needed a per-book gate the way Together does. A pair
  root has no such property, so the gate has to become explicit; it is Together's (membership + a **live
  partner edge, re-derived on every call**). That also makes revocation free: deleting the edge re-gates the
  book on the next read, with no revocation step, no `sharedWith` list, and the book left unreachable rather
  than destroyed.
- **Addressing is by ref SHAPE.** A pairKey is two ids joined by `~`, which is not a legal id, so
  `booksDir` can resolve `people/<id>/story/books` vs `together/pairs/<pairKey>/books` without any call site
  changing. The first argument to every `storyService` function is now an _owner ref_, not always a person.
- **A pair is not a spendable identity.** `AiDeps.meterPersonId` splits "whose data this is for" from "who
  the spend is billed to" — without it the budget check looks up a person that doesn't exist and the usage
  event is filed under an id no Usage screen can resolve.
- **The corpus merges two lives, minus the break-glass tier.** The owner chose full corpora; `restricted`
  onboarding material is withheld from BOTH sides, because the prose is read by the other partner and that
  is the case 58's `excludeRestricted` exists for. A person's own book still reads their own (§8.3).
- **Only the commissioner may delete** (owner decision) — `personId` names the pair on a shared book, so
  `commissionedBy` records who that was.

**As built (P6b2 — the type and its surfaces). P6 is complete; all eight types are registered.** The bridge
migration turned out to have one precise seam: the argument immediately before a `bookId` IS the owner ref,
so 81 storage call sites moved with a substitution and no structural change. The 17 AI handlers additionally
re-point `AiDeps.personId` at the book while billing the person who ran it. Three product rules landed with
it: the partner picker offers only **live partner edges** and the bridge **re-checks the edge at create** (a
hand-crafted IPC call must not be able to make a shared book with a non-partner); **only the commissioner may
delete**, since deleting destroys the other partner's copy; and the workspace says **"Shared with <name>"**,
because the difference between a private draft and something another person is reading should be visible.
The commission's "reads everything it knows about you" line is rewritten for this type — it reads both
lives, minus what either marked private during onboarding.

**As built (P6a — `childrens`).** Most of what §4.1 declared was already in place from P3, and the work was
mostly making declared-but-inert slots actually do something:

- `imageFraming`, `castPolicy` and `audience` were **declared and read by nothing**. The image service
  hard-coded its own framing AND its own distillation instruction; the distillation is the real gate (it
  rewrites the brief before anything leaves the app), so relaxing only the framing would have stripped the
  character sheet anyway and the hero would have changed face every page. Both are now per-type.
- `BookInterviewFramework.scenes` was typed as `typeof MCADAMS_SCENES`, which made "the framework is the
  only source of interview dimensions" unachievable — every type was forced to reuse biography's eight
  scenes, and all five did. It is now structural, and the picture book asks about the CHILD.
- The **character sheet lives on `BookConsentEntry`**, not `CastEntry` as §4.8 proposed: the cast register is
  derived and recomputed on every read, so nothing on it survives. It is the same kind of per-book,
  per-person, author-authored record as a pseudonym, so it shares its storage and its write path — which
  makes independent-field merging load-bearing (a whole-entry replace would delete how someone looks the
  moment you renamed them).
- `spine.count` was a **request in the prompt with nothing behind it**; the outline is now capped to it. A
  SHORT reply is deliberately left alone — padding with empty shells is the §7.5 defect this spec removed.
- Two pre-existing defects were fixed in passing (CLAUDE.md §6): `portrait`'s **required** "Who it's about"
  answer reached no directive, so the model was never told whose portrait it was; and person options offered
  the author themselves. The style picker also ignored each type's declared `stylePresets` and offered all
  seven registers — for a type declaring a subset that meant offering a register whose directive resolves to
  the empty string.
- **Illustration is explicit** (owner decision): a 32-page book is 32 paid generations, so the bulk action
  states how many and — for a `budgets.manage` admin, per the app-wide money rule — what it will cost,
  before spending anything.
- The workspace now **counts in the type's own unit** (pages, not chapters) everywhere the shelf already
  did, from one `unitForType` derivation shared by both.

## 6. IPC / API contracts

All channels stay gated `story.own` and active-person-scoped in the bridge (the trust boundary); keys
stay host-side. The ~70 existing `story:*` channels are renamed `books:*` with the same shapes.

**As built.** 102 channels (not ~70), renamed along with their `SelfosBridge` method names
(`storyList` → `booksList`) and the image-progress surface keys, so nothing in the seam still says "story".
The **capability stays `story.own`** — renaming it would need a role-config migration in every existing
vault for no user-visible gain. The core module moved `story/` → `books/` behind a compatibility barrel
(`@selfos/core/story*` still resolves for one release); the file names inside it are unchanged.

**New**

| Channel                                        | Request                     | Response                               | Notes                                                           |
| ---------------------------------------------- | --------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `books:types`                                  | —                           | `BookTypeView[]`                       | Eight types + their gates; adult types withheld until both acks |
| `books:newMaterial`                            | `{ bookId }`                | `StoryNewMaterialList`                 | Free read                                                       |
| `books:weaveIn`                                | `{ bookId, chapterId }`     | `ChapterResult`                        | Accept a proposal — one craft-loop revision                     |
| `books:finishEdition`                          | `{ bookId }`                | `{ edition, chapterCount, wordCount }` | Freezes Edition N                                               |
| `books:reopen`                                 | `{ bookId }`                | `BookManifest`                         | Finished → Living                                               |
| `books:manuscriptPass`                         | `{ bookId }`                | `ContinuityFinding[]`                  | The whole-book editorial pass                                   |
| `books:personTimeline` / `:editPersonTimeline` | — / edit                    | `LifeTimeline`                         | The shared chronology                                           |
| `books:setCastSheet`                           | `{ bookId, name, sheet }`   | `CastEntry[]`                          | The character sheet                                             |
| `books:startConversation`                      | `{ bookId, gapId?, seed? }` | `{ memoryId }`                         | Opens the chat, gap-linked                                      |

**Changed** — `books:setConsent` drops `consent`, taking `{ bookId, name, pseudonym }`.
**Removed** — none; the consent-state field simply leaves the input schema.

**Claude.** Every book pass is a bounded, non-streaming `runClaude` with `extendedThinking: false`
except the conversation, which streams. Model is forced to Opus per §5.3. Failure classification,
tolerant parsing and meter-before-parse follow spec [37](37-ai-output-robustness.md) unchanged.

## 7. States & edge cases

1. **No AI / no key** — the bookshelf, reader, timeline, people and export all work; every generative
   affordance shows the role-aware `AiUnavailableNotice`. A book with no chapters shows the invitation.
2. **Over budget** — the craft loop stops cleanly between passes and resumes next period; a
   half-critiqued chapter keeps its draft.
3. **Truncation** — a chapter still cut off after bounded continuations is refused, never persisted
   (64 §13.9, retained).
4. **A pass fails mid-loop** — the chapter keeps the last good pass's output and is marked for retry;
   one bad chapter never blocks the queue.
5. **Unwritten shells** — an outline chapter with no prose renders as **Not written** in the grid and
   is counted in the hero; the book reaches `ready` only when every outline chapter has prose. Fixes
   the 64 defect where 11 empty shells left a book stuck in `outlining` invisibly.
6. **Duplicate proposals** — `proposalSignature` is checked against **pending, dismissed and the
   outline's existing chapter titles**; an approved proposal's signature is retained (today it is
   spliced out, which is how a chapter can be proposed twice).
7. **Concurrent edits / sync conflicts** — every write re-reads live before saving (the 64 pattern);
   vault conflicts surface through the existing `00` conflict banner.
8. **Corrupt or missing files** — each corpus source is read behind its own guard and degrades to
   omission, never a blank book (64 §7, retained).
9. **Migration.** Four, all idempotent and run on first read:
   - `BookChapter.status: 'stale'` → `'updated'`, plus a one-time material scan.
   - Book timelines → the person timeline; a moment already `userEdited` wins; the book file keeps
     nothing (all existing moments are life moments).
   - `BookConsentEntry.consent` → dropped; a `pseudonym` is preserved.
   - `type: 'biography'` books gain the new `BookType` slots from the registry (no file change).
     **The two existing books regenerate in place** (owner decision): protected passages, pinned quotes,
     markup, timeline, matter, images and readers all carry forward; chapters are rewritten through the
     craft loop.
10. **A shared "Our Story" when a partner leaves the household** — the live-edge re-check denies on the
    next read; the remaining participant keeps a readable copy of the published head.

## 8. Safety

### 8.1 The boundary

Books are a wellness reflection, never clinical. The not-medical line appears on the title page, in the
colophon, and in every export (64 §8.2, retained). The doctrine forbids naming instruments, scores,
bands or diagnoses even where test data informs characterization.

### 8.2 Crisis

The `CrisisFooter` renders on every book surface outside the immersive reader (whose colophon carries
the line). While `aggregateCrisisSignal(...).recurring` holds, the biographer rests: no cadence spend,
no interview invitation, no auto-generation — with a warm quiet state that says so. A memory
synthesized with `crisisFlag` leads its confirm card with resources.

### 8.3 Sensitive material

The corpus reads the subject's own `restricted` facts (their own book — the 64 §5.1 exception,
unchanged) but a **`sensitive` memory's derived Insight stays restricted** and never partner-shares.
Exclusions filter at the corpus boundary, so excluded material can never be reintroduced by a later
rewrite.

### 8.4 Adult content

`erotica` requires the shared `adultAcknowledged` from **both** participants, re-checked at create and
at every generation — never merely a hidden card (the 48/49 precedent). The explicit register is
consenting-adults-only, within Anthropic policy, and the shared `SAFETY` prefix is never loosened.

### 8.5 Images and likeness

The default image framing stays 64's: symbolic, non-photorealistic, **never a likeness of a real
person and never a name**, with the Claude distillation stripping both before anything reaches OpenAI.

**The `childrens` type deliberately relaxes this** (owner decision, 2026-08-13): its framing permits
depicting the author's own children, and a character sheet describing their appearance passes through
the distillation to OpenAI so the character stays consistent across pages.

**As built, the gate is the DISTILLATION, not the framing.** There are two independent enforcement points,
and only one of them matters: the framing merely asks the image generator, while the Claude distillation
rewrites the brief before anything leaves the app. A type that relaxed only the framing would still have its
sheets stripped. Both are per-type, and the relaxation stays bounded even here — illustration only (never
photoreal), still no text in the image, still content policy. A sheet is **never auto-sent from the
profile**: the People tab suggests it from `Person.appearanceDescription` and shows what will leave, and the
author must save it themselves. A sheet stored against any other type is inert and never read. The consequence, stated
plainly: appearance data about a real child leaves the app to a third-party image provider, which no
other SelfOS surface does today. It applies to this one type, only for children in the author's own
household, and only when image generation is switched on.

### 8.6 Other people

The corpus reads a connected person's data only through `factSharedWithViewer` (§15). A book may be
published to household readers; the Sharing tab lists who the book names before you share, and any
person can be given a different name that substitutes everywhere the book is read or exported.

## 9. Accessibility

Per [01](01-design-system.md). Specifically: the bookshelf is a list of links with accessible names
carrying title and state; tab strips are `role="tablist"` with roving tabindex and must **fit** at
360px without horizontal scroll (never `overflow-x`); depth meters and coverage bars carry a text
equivalent, never colour or length alone; the conversation thread is an `aria-live` log with
`aria-busy` while streaming; the craft-loop passes are a labelled `progressbar` with a text phase;
chapter cards are buttons named by their title; the reader's text-size control is keyboard-reachable
and its scale persists device-locally. Every generative action has a visible focus state and an honest
disabled reason.

## 10. Testing strategy

The vault is a `memFileSystem`; Claude and the image provider are the existing offline fakes
(`SELFOS_FAKE_CLAUDE`, `SELFOS_FAKE_IMAGE`, `SELFOS_FAKE_PROMPT_DIR` for prompt capture). **The fakes
must be imperfect by default** (spec 37 §10) so tolerant parsing and salvage are actually exercised.

**The proof for P1 is a measurement, not an assertion.** A test regenerates a seeded chapter through
the craft loop and asserts the meta-narration rate against a fixed corpus — the same count that reads
1-per-168-words today must read zero. It is verified to FAIL against the current doctrine.

**Unit (Vitest, core)**

- `bookTypes` — eight types; every type has a doctrine, structures, presets, framework, spine and
  image framing; the `adult === (id === 'erotica')` invariant; **the doctrine contains no
  sourcing-narration example** (the P1 regression guard).
- `bookCorpus` — transcripts feed as `transcript` items and only the subject's own turns (a partner's
  Together aside is structurally absent); a `span` spine filters to its era; the gap pass is budgeted;
  every existing privacy gate from 64 §5.1 still holds (restricted own facts in, flagged out,
  wholly-flagged dropped, muted dreams out, cross-person only via `factSharedWithViewer`, exclusions
  at the boundary).
- Craft loop — each pass meters before parse; a mid-loop failure keeps the last good output; a
  truncated chapter is refused and never persisted; the four passes are individually resumable.
- `bookFreshness` — a source change produces a **material entry, never a `stale` status**; a reviewed
  chapter is never rewritten without an accept; cadence caps are **per book** (two books each get a
  full allowance — verified to fail against the person-scoped query).
- Lifecycle — finishing freezes an edition whose chapters are byte-identical to the reviewed set;
  reopening restores Living; new material still accrues while Finished.
- Interview — a book's framework seeds topics into the spec-71 map without becoming a ceiling; depth
  rises with asks + a rendered scene; **saving a conversation closes its gap** (stamps the ask ledger,
  marks it answered) so the next planner pass doesn't re-propose it; `buildMemorySystem` carries the
  dedup reference and the book's own config (never `books[0]`).
- Structure proposals — a signature is checked against pending, dismissed **and existing outline
  titles**; an approved proposal's signature is retained (verified to fail today).
- Migrations — each is idempotent: `stale` → `updated`, book timelines → the person timeline
  (a `userEdited` moment wins), consent states dropped with pseudonyms preserved.
- Images — the default framing still forbids likeness and names; `childrens` framing permits them and
  carries the character sheet; no other type does (the §8.5 boundary guard).

**Component (Vitest + RTL)**

Bookshelf states (none / several / shared-with-you); the type picker withholding adult types until
both acks; the Living proposal (Weave in / Not now) and that a reviewed chapter shows no auto-change;
the interview's open "talk about anything" entry; the conversation's know-what-it-knows rail; People
without consent states; honest AI-off, over-budget, crisis and throttled states on every generative
control.

**E2E (Playwright, decrypt-level)**

1. Create a book of a **non-biography** type end to end → its interview asks that type's questions,
   not McAdams.
2. The **craft loop**: draft a chapter → the four passes stream → decrypt the chapter and assert the
   prose persisted with provenance.
3. **Living**: change a source → a proposal appears naming the chapter → accept → decrypt the revision;
   a reviewed chapter is untouched until accepted.
4. **Finish an edition** → decrypt the frozen copy → reopen → Living again.
5. **The conversation closes its gap**: talk a gap through, save → the gap reads answered and the next
   planner pass does not re-propose it (verified to fail today).
6. **Person-level timeline**: correct a date in one book → it is corrected in a second book.
7. **Per-book caps**: two books both run their cadence in one week.
8. A **360px** guard on every new surface: no element with `overflow-x: auto|scroll` exceeds its
   width, and each tab strip fits.

**Updated, not new** — the existing consent-center E2E must drop its consent-state assertions and keep
the pseudonym round-trip.

## 11. Open questions

_None blocking._ Every product decision was resolved with the owner on 2026-08-13 and is recorded in
§2–§8: eight types from one corpus; the four `BookType` slots; craft loop + manuscript pass always, on
Opus; Living/Finished with propose-never-rewrite; regenerate in place; Our Story as one shared book;
per-type image framing with likeness permitted for children's books; person-level timeline with
per-book additions; photos folded into the interview; pseudonyms kept and consent states cut; per-book
cadence caps; the six-tab workspace.

Two items are **deliberately deferred** rather than open:

1. **Household contributions** — family-submitted questions and attributed quotes. No longer deferred:
   specced and built as [73](73-household-contributions.md) (2026-08-14).
2. **One generic streaming channel** (64 #289) — six per-surface sinks remain. A behaviour-preserving
   refactor worth doing when a seventh would otherwise be added.

## 12. Changelog

- 2026-08-14 — **Renamed `story:*` → `books:*`** — 102 channels, their bridge method names and the
  image-progress surface keys, plus the core module `story/` → `books/` behind a compatibility barrel.
  Mechanical, no behaviour change; the capability stays `story.own` (no role-config migration).
- 2026-08-14 — **P6b2 built — SPEC 72 IS COMPLETE.** The `ourStory` type, the commission partner picker
  (live edges only, re-checked at create), the shelf and workspace on both partners' sides, the
  commissioner-only delete, and the "Shared with <name>" signal. 81 bridge storage call sites moved to the
  owner ref via one precise seam; the 17 AI handlers additionally split addressing from billing.
- 2026-08-14 — **P6b1 built** — the storage and authorization spine for `ourStory`, backend only (no
  surface: the type, the commission and the interview are P6b2). A pair-owned book lives at
  `together/pairs/<pairKey>/books/`, addressed by passing the pairKey where every other book passes a person
  id — `booksDir` resolves the root from the ref's SHAPE, which is what let shared storage land without
  touching ~340 call sites. The gate became explicit (membership + a live partner edge, re-derived per call)
  because **until now the book path WAS the authorization**. The corpus merges both partners' lives with the
  break-glass tier withheld from both sides. `AiDeps.meterPersonId` separates the storage owner ref from the
  spendable identity, since a pair has no budget. `BookManifest.commissionedBy` records who may delete.
- 2026-08-14 — **P6a built** — the `childrens` picture book. Registered the type (page spine, own interview
  scenes, own registers, 3–7 audience); made `imageFraming` / `castPolicy` / `audience` actually consumed;
  added the character sheet on `BookConsentEntry` with independent-field merging; enforced `spine.count`;
  gave the workspace the type's own counting unit; added the explicit bulk illustrate. Fixed three
  pre-existing defects found on the way: `portrait`'s subject answer reached no directive, person options
  offered the author themselves, and the style picker ignored each type's declared presets. `ourStory`
  remains (P6b).
- 2026-08-13 — **Approved.** The three drafting questions resolved with the owner: §8.5's likeness
  wording stands as written; the capability stays `story.own` while the channels become `books:*` (no
  role-config migration); the core module is renamed `story/` → `books/` behind a compatibility barrel.
  P1 begins.
- 2026-08-13 — created. Supersedes spec [64](64-your-story.md) (whose §3–§19 remain the historical
  build record). Written after a three-pass review of the whole feature and a decrypt-level measurement
  of the two real books in the vault; all owner decisions resolved before drafting.
