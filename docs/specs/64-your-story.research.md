# 64 — Your Story: research appendix

> Companion to [`64-your-story.md`](64-your-story.md). Compiled 2026-07-15 from four research
> passes (codebase data + infrastructure inventories; competitor/market research; biography &
> memoir craft research). This is **source material for implementation** — the Biographer's
> Doctrine and banned-prose inventory feed `storyPromptBuilder` (spec §5.2), the interview
> blueprint feeds `storyInterviewService` (§5.5), the production checklist feeds the reader view
> and exports (§3.6/§3.9). It is reference, not spec: where this file and the spec disagree, the
> spec wins.

---

## Part I — The Biographer's Doctrine

Craft principles distilled from master practitioners; adapt into `BIOGRAPHER_SYSTEM` in
imperative voice. Attributions kept for provenance.

1. **Turn every page.** Write from the whole corpus, never a skim — the revealing fact is usually
   in the material nobody weighted. (Robert Caro)
2. **Facts are the base; the scene is the point.** "Are you making the reader see the scene?" is
   the review gate for every chapter. (Caro, Paris Review Art of Biography No. 5)
3. **Honor sense of place.** Anchor scenes in named, physically rendered places; place explains
   behavior. When the corpus lacks place detail, ask for it — never invent it. (Caro)
4. **Reconstruct time-and-motion.** Rebuild key episodes as lived sequence (where they stood, what
   they saw, in what order), not outcome summaries. (Caro)
5. **Show forces through their effects on people.** Never describe a life-force (a controlling
   parent, an addiction, ambition) abstractly; show what it did, one named person at a time. (Caro)
6. **Keep it chronological; withhold hindsight.** Let the reader learn as life was lived; suspense
   and meaning come from knowledge arriving when it actually arrived. (Walter Isaacson)
7. **Tell it like a story at a dinner table.** Warm narration that survives being read aloud; cut
   what can't be spoken naturally. (Isaacson)
8. **Organize the person around their productive contradictions.** Present dualities side by side
   without adjudicating; restraint is the award-level move. (Isaacson)
9. **Start before the cradle; penetrate the silences.** Family origins are part of the story; what
   the subject avoids is biographical data to handle honestly and gently. (Ron Chernow)
10. **Take no one at their word.** Cross-check self-report against the rest of the record; when
    sources disagree, prefer the version supported by detail — or name the discrepancy on the
    page. (Stacy Schiff)
11. **Let themes emerge from the corpus before drafting.** Never impose a template theme. (Schiff)
12. **Distill the essence before writing.** Maintain a living statement of what the book — and
    each chapter — is about; judge every passage against it. (Caro)
13. **Write a portrait, not an autopsy.** Empathy and idiosyncratic detail over clinical
    dissection; always the warm particular over the diagnostic label. (Hermione Lee)
14. **Admit you'll never fully catch them.** Epistemic humility on the page — "the record doesn't
    say," "she remembers it two ways" — is a mark of quality. (Richard Holmes)
15. **Situation vs. story.** Events are situations; a chapter exists only when it knows the
    emotional experience — the insight — it exists to earn. THE conversion rule from life-data to
    narrative. (Vivian Gornick)
16. **Voice is everything, and double-sided.** The subject must be shown "the beautiful and the
    beastly"; flattery kills credibility. (Mary Karr)
17. **Practice sacred carnality.** Load scenes with sensory, bodily, particular data; where the
    corpus lacks it, the interview engine goes and gets it. (Karr)
18. **Give the protagonist an inner enemy.** The recurring internal struggle (visible in session
    themes and test-informed patterns) is the book's plot engine. (Karr)
19. **Never exaggerate; never fabricate; flag uncertainty honestly.** Interior experience is
    enough; memory's fallibility is admitted, not smoothed. (Karr)
20. **Think small.** Build chapters from small vivid incidents — vividness signals a universal
    truth — not from "important" milestones. (William Zinsser)
21. **Run the double perspective.** The experiencing self in the scene + the reflective narrator
    who understands now; all-scene passages get one line of hindsight, all-reflection passages get
    the concrete moment restored. (Phillip Lopate)
22. **Be ruthless with the subject, gentle with everyone else.** Third parties are rounded
    characters with their own reasons; write them with fairness the subject's memory may not
    supply. (memoir-ethics consensus)

## Part II — Structural templates

All four share the professional convention: **open in medias res with a character-revealing
scene — never at birth** (Chernow opens _Washington_ at the 1793 portrait sittings; _Educated_'s
prologue stages the whole conflict in one image), then earn the chronology.

1. **Chronological spine with thematic braids** (the Isaacson/Chernow; the spec's rendered
   default). Parts = life eras; each chapter built around one dominant scene + one braid-thread.
   Grows by appending chapters; prologue/epilogue are rewritten as understanding deepens. Risk:
   recent chapters are situation-heavy (thin hindsight); "and then" listing if scene discipline
   slips.
2. **McAdams chapter-based** (the spec's internal data model). The subject's own life chapters are
   the ToC; the eight key scenes are the set-pieces; the future-script chapter is periodically
   "cashed in" (imagined vs. happened becomes a new chapter). Risk: the subject's own periodization
   can be flat; the biographer interrogates chapter breaks rather than just accepting them.
3. **Thematic parts / identity phases** (the _Becoming_ shape; _Born a Crime_'s interstitial
   context capsules). Best for rich-but-gappy data. Risk: essay-collection feel without a strong
   through-line per part.
4. **Braided past/present** (the pursuer). A present-tense strand from live session/dream data
   alternating with the past narrative — structurally native to a living book; the spec adopts it
   as **interludes between parts** rather than a full braid. Risk: two voices/tenses are hard to
   sustain.

## Part III — The interview engine blueprint

### The McAdams Life Story Interview (Foley Center, Northwestern, 2007) — distilled

Framing stance (adapt near-verbatim): _"This is about the story of your life. The story is
selective — it doesn't include everything that ever happened. There are no right or wrong
answers."_ Explicitly story-collection, not therapy (matches the §8.1 boundary).

- **A. Life chapters**: the life as a book — 2–7 chapters, each a title + gist + **how we get from
  one chapter to the next** (turning points hide in the transitions).
- **B. Eight key scenes**, each probed the same six ways: what happened · when and where · who was
  involved · what were you thinking · what were you feeling · **why is this important — what does
  it say about who you are?** (the meaning-probe closes every scene; its answer is Gornick's
  "story"). The scenes: high point · low point (softening fallback allowed) · turning point ·
  positive childhood memory · negative childhood memory · vivid adult memory · spiritual/mystical
  experience (worded inclusively) · wisdom event.
- **C. Future script**: the next chapter; dreams/hopes/plans; the **life project** and why it
  matters.
- **D. Challenges**: greatest life challenge · health crisis · greatest loss · greatest
  failure/regret (each: how it developed, how you coped, what it means).
- **E. Personal ideology**: beliefs in a nutshell; values; **the story of how they changed**; the
  most important value in human living.
- **F. Life theme**: the central thread the subject themselves discerns.
- **G. Other**: "what else should I know to understand your life story?"

### What the engine listens for (narrative-identity coding → biography material)

- **Redemption sequences** (bad → good) — the signature of generative narratives; render them, but
  **never impose one** (redemption-washing is banned).
- **Contamination sequences** (good → bad) — render honestly; look for the subject's own
  counter-evidence.
- **Agency and communion** — the two theme families; a rich chapter usually carries both.

### Question registers beyond McAdams

- **StoryCorps** (legacy/relational): most important person; happiest/saddest moment; biggest
  influence and their lessons; earliest memories; wisdom to pass on; how you'd like to be
  remembered.
- **Proust Questionnaire** (self-definition): perfect happiness; greatest fear; trait you most
  deplore in yourself; greatest regret; when/where happiest; treasured possession; motto — motto
  and self-definitions feed the epigraph and front matter.
- **Aron's 36 questions** (design principle only): graduated escalation + reciprocal vulnerability.

### Deepening moves (flat answer → scene-level material)

- Open forms only: How/What/Why, never Do/Did. ("How did you learn your trade?" not "Did you like
  it?") (Smithsonian oral-history guide)
- The three universal follow-ups: "Could you explain?" · "Can you give me an example?" · "How did
  that happen?"
- Caro's witness probes: "What did you see?" / "What would I have seen?" — re-asking the same
  scene later surfaces what they didn't know they knew.
- **One question per turn; never stack.** (The oral-history "SU — shut up" rule, adapted.)
- **Sensory opener beats biographical opener** ("Describe the kitchen you grew up in" ≫ "tell me
  about your childhood"). Deepening ladder for any flat answer: **place → bodies → objects →
  dialogue → feeling → meaning.**
- Artifact prompts: photos/letters/heirlooms trigger stories — generate questions **from the
  uploaded photo** (spec §3.7/§3.8).
- Follow heat, not the script: detour when a rich subject opens.
- Fatigue rule: stop and resume later rather than pushing (maps to check-in back-off).

## Part IV — Voice & quality bar

### Markers of award-level prose (the review gate)

Scene-forward (judgment rendered as scene, not asserted traits) · deliberate rhythm (survives
reading aloud; sentence length varies with emotional register) · specificity as morality (the
particular sensory noun builds trust; strip every word that does no work) · the double perspective
always running · complexity without verdicts · honest epistemics · one earned "story" per chapter.

### The banned-prose contract (enforce in `BIOGRAPHER_SYSTEM`; sourced from the maintained

"Signs of AI writing" inventory + memoir-craft consensus)

- **Vocabulary cluster**: tapestry · testament ("a testament to") · delve · journey (as
  life-metaphor crutch) · pivotal · intricate · meticulous(ly) · showcase · underscore · vibrant ·
  robust · landscape/realm · navigate (metaphorical) · foster · boast · "rich cultural heritage" ·
  "nestled" · "in the heart of" · "indelible mark" · "turning point" as a label rather than a
  dramatized scene.
- **Constructions**: "not just X, but Y" / "It's not X — it's Y"; rule-of-three adjective stacks;
  anaphora abuse; self-posed rhetorical questions; copula-avoidance ("serves as," "stands as,"
  "represents") where "is" is honest; "-ing" significance tails ("…highlighting her resilience").
- **Moves**:
  - "I learned that…" moralizing and lesson-stamped endings ("Ultimately…", "Little did I know…",
    "It was in that moment that I realized…") — insight is earned in scene, never announced.
  - Summary-only chapters — every chapter contains at least one fully rendered scene.
  - False omniscience about others' inner lives — attribute ("she seemed," "he later said," "I
    believed at the time") or ask the subject.
  - Fabricated specifics — never invent sensory detail, dialogue, dates, or scenes; a gap becomes
    an interview question.
  - Redemption-washing a contamination memory; trauma close-ups without exits (alternate visceral
    scene with reflective distance; let brutal moments breathe; the steady adult narrator stays
    present).
  - Diagnostic labeling — portraits, not case files; instruments/scores/bands never appear in
    prose.
  - Flattery/eulogy register — a flawless subject is unbelievable.

## Part V — Production conventions (make it a real book)

- **Front matter order**: half title · title page · colophon (privacy note: "written from and
  stored in your private vault"; version date; wellness boundary line) · dedication (elicited,
  never invented) · epigraph (subject's motto or chosen quote) · table of contents (**titled**
  chapters, not bare numbers) · list of illustrations (when photos exist) · prologue
  (in-medias-res scene, 800–1,500 words, rewritten as the book grows).
- **Body**: 2–5 named parts; chapters cold-open on a scene (place + time + body), close on
  resonance, not a moral; optional present-tense interludes between parts. Craft-normal chapter
  length 2,500–5,000 words (memoir sweet spot ≈80k total); the spec's `standard` length starts
  shorter (§11 Q4) with `full` reaching craft length.
- **Photos**: plate-insert section or inline in time-sequence; caption voice = who/when/where/what,
  people named in pictured order; captions may carry narrative voice, never jokes at a third
  party's expense.
- **Back matter**: acknowledgments (elicited) · **"A Note on this book"** (drawn-from disclosure:
  "N conversations, M reflections, dreams recorded between X and Y"; reconstructed dialogue is
  marked as reconstruction; changed-name disclosure when pseudonyms are used) · version/"what's
  new in this edition" note.
- **Third-party defaults**: real first names only with the subject's deliberate choice; otherwise
  role-names ("my sister") or pseudonyms + disclosure; antagonists written with motive-empathy.

## Part VI — Competitor landscape (condensed)

Market proof: StoryWorth has printed **1M+ books from ~35M stories** at $59–$199/yr; ghostwriter
services run $899 (No Story Lost) to $48k–$135k (Scribe). The $200–$800 "near-professional
narrative quality" middle is empty. Virtually all marketing is "a gift to capture your parents";
the **self-authored, continuously updated, psychologically deep** lane is unclaimed.

| Product                                  | Capture                               | Prose                                 | Output                       | Notable                                                               |
| ---------------------------------------- | ------------------------------------- | ------------------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| StoryWorth                               | weekly emailed question               | user writes                           | hardcover ≤480pp             | 350+ prompt bank; family-submitted questions; books read as Q&A piles |
| Remento                                  | weekly prompt → voice/video           | AI "Speech-to-Story" (tone/POV dials) | hardcover + QR to recordings | #1 complaint: AI flattens the speaker's voice                         |
| Autobiographer                           | conversational AI interviewer (voice) | AI                                    | 250pp digital                | progress-toward-book meter; privacy-pitch vs ToS skepticism           |
| Storii                                   | automated phone calls                 | none (transcripts)                    | audiobook + PDF              | zero-tech elder capture                                               |
| Kindred Tales / Life Story AI / Memoirji | AI interview / WhatsApp               | AI draft → user edits                 | book/PDF                     | Life Story AI's blind "interviewer" role (can ask, cannot read)       |
| No Story Lost / StoryTerrace / LifeBook  | human interviews                      | ghostwriters                          | coffee-table books           | what pros add: structure, live follow-ups, chronology, design         |

**Category failure modes → Your Story's answers** (each is a spec requirement): writing burden →
day-one draft from existing data; generic question banks → gap-driven, dedup-backed questions that
never re-ask; AI flattens voice → pinned verbatim quotes, protected user edits, the banned-prose
contract; Q&A pile ≠ narrative → timeline spine + essence statements + scene-first doctrine;
editing friction at both extremes → the collaborative draft view; keepsakes dying with servers →
local files, in-app provenance links, export anytime; privacy anxiety → encrypted vault, nothing
leaves except distilled image prompts; the book freezes at print → the living book.

**Patterns borrowed**: weekly one-question cadence (→ story check-ins); source-linked prose (QR →
in-app provenance deep links); the completeness/progress meter; verbatim↔polished as a first-class
dial; family-submitted questions (→ the contributions fast-follow); pay-once resentment of
subscriptions (→ bundled feature, no separate paywall).

## Sources (load-bearing)

McAdams, _The Life Story Interview II_ (2007), Foley Center, Northwestern —
https://cpb-us-e1.wpmucdn.com/sites.northwestern.edu/dist/4/3901/files/2020/11/The-Life-Story-Interview-II-2007.pdf ·
Caro, Paris Review Art of Biography No. 5; _Working_ — https://www.theparisreview.org/interviews/6442 ·
Schiff, Paris Review No. 6; Holmes, No. 7; McCullough, No. 2 ·
Isaacson, Tim Ferriss Show #273 transcript — https://tim.blog/2018/02/02/the-tim-ferriss-show-transcripts-walter-isaacson/ ·
Chernow, National Archives _Prologue_ interview ·
Karr, _The Art of Memoir_; Gornick, _The Situation and the Story_; Zinsser, "How to Write a
Memoir" (American Scholar); Lopate on the double perspective ·
Smithsonian Folklife & Oral History Interviewing Guide —
https://museumonmainstreet.org/sites/default/files/Smithsonian%20oral%20history%20guide.pdf ·
StoryCorps Great Questions — https://storycorps.org/participate/great-questions/ ·
"Signs of AI writing" inventory — https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing ·
Competitor sources: storyworth.com, remento.co, autobiographer.com, storii.com, meminto.com,
nostorylost.com, storyterrace.com/pricing, lifebookmemoirs.com/packages, scribemedia.com,
kindredtales.net, life-story.ai, memoirji.com, keepsakeproject.co, dayoneapp.com/book-printing,
rosebud.app, hereafter.ai — with review corroboration via Trustpilot and cross-competitor
teardowns (flagged as vendor-published where applicable; complaint patterns used only where
corroborated across rivals).
