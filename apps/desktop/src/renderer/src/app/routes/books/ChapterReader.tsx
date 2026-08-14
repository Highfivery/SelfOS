import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Markdown,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '../../../design-system/components';
import { useSetting } from '../../../settings/useSetting';
import { useImageConsent } from '../../../stores/imagePrefsStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryStore } from '../../../stores/storyStore';
import { aiKeyResolved } from '../../aiAvailability';
import { ImageProgress } from './ImageProgress';
import styles from './Books.module.css';
import { useEffect, useState } from 'react';
import type { CommentIntent, StoryBookBundle } from '@shared/schemas';
import { ChapterRibbon } from './ChapterRibbon';
import { HistorySheet } from './HistorySheet';
import { ReviewSheet } from './ReviewSheet';
import {
  INTENT_LABEL,
  INTENT_OPTIONS,
  SOURCE_KIND_LABEL,
  TODO_KIND_LABEL,
  TODO_KIND_OPTIONS,
  buildAnchor,
  countApplicable,
  splitParagraphs,
} from './markupHelpers';
import type { ReaderTodoKind } from './markupHelpers';

export function ChapterReader({
  bundle,
  chapter,
  onBack,
}: {
  bundle: StoryBookBundle;
  chapter: StoryBookBundle['chapters'][number];
  onBack: () => void;
}): JSX.Element {
  const regenerateChapter = useStoryStore((s) => s.regenerateChapter);
  const lineEdit = useStoryStore((s) => s.lineEdit);
  const reviewChapter = useStoryStore((s) => s.reviewChapter);
  const markup = useStoryStore((s) => s.markup);
  const loadMarkup = useStoryStore((s) => s.loadMarkup);
  const clearMarkup = useStoryStore((s) => s.clearMarkup);
  const addMark = useStoryStore((s) => s.addMark);
  const removeMark = useStoryStore((s) => s.removeMark);
  const updateMark = useStoryStore((s) => s.updateMark);
  const flagInsight = useStoryStore((s) => s.flagInsight);
  const applyMarkup = useStoryStore((s) => s.applyMarkup);
  const editPassage = useStoryStore((s) => s.editPassage);
  const pinQuote = useStoryStore((s) => s.pinQuote);
  const todoToQuestions = useStoryStore((s) => s.todoToQuestions);
  const answerQuestion = useStoryStore((s) => s.answerQuestion);
  const exclude = useStoryStore((s) => s.exclude);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  // Image placement (§3.8, Phase H3).
  const bookImages = useStoryStore((s) => s.images);
  const imageUrls = useStoryStore((s) => s.imageUrls);
  const loadImages = useStoryStore((s) => s.loadImages);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const generateImage = useStoryStore((s) => s.generateImage);
  const suggestPlacement = useStoryStore((s) => s.suggestPlacement);
  const setPlacement = useStoryStore((s) => s.setPlacement);
  const removePlacement = useStoryStore((s) => s.removePlacement);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Image-generation setup (§3.8) — the SAME gate as the cover panel, so the "Illustrate this chapter" button
  // is never a dead control. Errors surface IN the Images card (below), not at the top of the reader.
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  const imageConsent = useImageConsent('story');
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasImageKey, setHasImageKey] = useState(false);
  // Gate the "turn on image generation" setup note on the ASYNC key check having resolved, so it never
  // flashes for a fully-configured person (the CoverPanel `loading` lesson — same data, same behavior).
  const [imageKeyChecked, setImageKeyChecked] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [illustrating, setIllustrating] = useState(false);
  // The two-step "Rewrite this chapter" confirm (§8.2 spend legibility) + the History sheet (§13.9).
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  // The opt-in "Polish the writing" (§17.3) — a light line-edit, reversible via History.
  const [confirmPolish, setConfirmPolish] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Answer-the-author (§3.3): the id of the question comment currently being answered.
  const [answering, setAnswering] = useState<string | null>(null);
  const [openSources, setOpenSources] = useState<number | null>(null);
  const [activePara, setActivePara] = useState<number | null>(null);
  const [activeQuote, setActiveQuote] = useState<string | null>(null);
  const [mode, setMode] = useState<'menu' | 'comment' | 'edit' | 'exclude' | 'todo' | null>(null);
  const [commentIntent, setCommentIntent] = useState<CommentIntent>('addContext');
  const [todoKind, setTodoKind] = useState<ReaderTodoKind>('remind');
  const [flagSource, setFlagSource] = useState(false);
  const [draft, setDraft] = useState('');
  // The batch Review & apply sheet (§13.5) — the bottom-sticky pill opens it; it lists the pending marks and
  // runs the one metered revision (`applyMarkup`, call-count unchanged).
  const [reviewOpen, setReviewOpen] = useState(false);

  const bookId = bundle.manifest.id;
  const chapterId = chapter.id;
  const paragraphs = splitParagraphs(chapter.markdown);
  const provByAnchor = new Map(chapter.provenance.map((p) => [p.anchor, p.refs]));

  // The Memory insight a paragraph drew on, if any — a "Fix this" comment can also flag it inaccurate (§3.3).
  const insightIdFor = (i: number): string | null =>
    (provByAnchor.get(`p${i}`) ?? []).find((r) => r.kind === 'insight')?.id ?? null;

  useEffect(() => {
    void loadMarkup(bookId, chapterId);
    return () => clearMarkup();
  }, [bookId, chapterId, loadMarkup, clearMarkup]);

  useEffect(() => {
    void loadImages(bookId);
  }, [bookId, loadImages]);

  useEffect(() => {
    void (async () => {
      setHasImageKey(Boolean(await aiKeyResolved('openai')));
      setImageKeyChecked(true);
    })();
  }, [bookId]);

  const imagesReady = imageConsent === true && aiEnabled !== false && hasImageKey;

  // Resolve data URLs for every image placed in THIS chapter.
  useEffect(() => {
    for (const p of chapter.imagePlacements) {
      if (!imageUrls[p.imageId]) void getImageUrl(bookId, p.imageId);
    }
  }, [bookId, chapter.imagePlacements, imageUrls, getImageUrl]);

  const placedIds = new Set(chapter.imagePlacements.map((p) => p.imageId));
  // Images that can still be placed here: illustrations + uploaded photos not already in this chapter.
  const placeable = bookImages.filter((i) => i.kind !== 'cover' && !placedIds.has(i.id));

  // Place an image: ask the AI where it fits, then set it (fall back to the first paragraph on failure so it's
  // never a dead-end — the author can move it).
  const placeImage = async (imageId: string): Promise<void> => {
    setImageBusy(true);
    setError(null);
    const suggested = await suggestPlacement(bookId, chapterId, imageId);
    const anchor = suggested.ok ? suggested.afterAnchor : 'p0';
    await setPlacement(bookId, chapterId, imageId, anchor);
    setImageBusy(false);
  };

  const illustrate = async (): Promise<void> => {
    setImageBusy(true);
    setIllustrating(true);
    setImageError(null);
    // No per-image style — every image uses the single global style (Settings → Images, §3.8).
    const res = await generateImage(bookId, { kind: 'illustration', chapterId });
    setIllustrating(false);
    if (res.ok) await placeImage(res.image.id);
    else setImageError(res.message);
    setImageBusy(false);
  };

  // Answer-the-author (§3.3): the biographer replies to a "question" comment, grounded in that paragraph's
  // sources (a metered `story.answer` call). The reply is stored on the mark + adopted into the markup.
  const askBiographer = async (markId: string): Promise<void> => {
    setAnswering(markId);
    setError(null);
    const res = await answerQuestion(bookId, chapterId, markId);
    setAnswering(null);
    if (!res.ok) setError(res.message);
  };

  const closeMenu = (): void => {
    setActivePara(null);
    setActiveQuote(null);
    setMode(null);
    setDraft('');
    setTodoKind('remind'); // don't leave the To-do form defaulted to the metered "questions" kind
    setFlagSource(false);
  };

  // Open the toolbar for a paragraph, seeded with the current text selection (if any is inside it).
  const openMenu = (i: number): void => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    const selected = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    setActivePara(i);
    setActiveQuote(
      selected.length > 0 && (paragraphs[i] ?? '').includes(selected) ? selected : null,
    );
    setMode('menu');
    setDraft('');
  };

  const addDelete = async (i: number): Promise<void> => {
    await addMark(bookId, chapterId, {
      id: crypto.randomUUID(),
      kind: 'delete',
      anchor: buildAnchor(paragraphs, i, activeQuote),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    closeMenu();
  };

  const submitComment = async (i: number): Promise<void> => {
    if (draft.trim().length === 0) return;
    // A "Fix this" comment can also flag the source insight inaccurate in Memory (specs 20/44).
    const insightId = commentIntent === 'fix' && flagSource ? insightIdFor(i) : null;
    await addMark(bookId, chapterId, {
      id: crypto.randomUUID(),
      kind: 'comment',
      anchor: buildAnchor(paragraphs, i, activeQuote),
      intent: commentIntent,
      text: draft.trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
      ...(insightId ? { flagInsightId: insightId } : {}),
    });
    if (insightId) await flagInsight(insightId);
    closeMenu();
  };

  const submitTodo = async (i: number): Promise<void> => {
    if (draft.trim().length === 0) return;
    if (todoKind === 'questions') {
      // Explicit, metered: mint a story check-in into the Inbox (§5.5).
      setNotice(null);
      const res = await todoToQuestions(
        bookId,
        chapterId,
        draft.trim(),
        buildAnchor(paragraphs, i, activeQuote),
      );
      if (res.ok) setNotice('A few questions are waiting in your Inbox.');
      else setError(res.message);
      closeMenu();
      return;
    }
    await addMark(bookId, chapterId, {
      id: crypto.randomUUID(),
      kind: 'todo',
      anchor: buildAnchor(paragraphs, i, activeQuote),
      text: draft.trim(),
      todoKind,
      status: 'open',
      createdAt: new Date().toISOString(),
    });
    closeMenu();
  };

  const submitEdit = async (i: number): Promise<void> => {
    if (draft.trim().length === 0) return;
    const ok = await editPassage(
      bookId,
      chapterId,
      buildAnchor(paragraphs, i, activeQuote),
      draft.trim(),
    );
    if (!ok) setError('That passage has moved — reopen the chapter and try the edit again.');
    closeMenu();
  };

  const addPin = async (i: number): Promise<void> => {
    const anchor = buildAnchor(paragraphs, i, activeQuote);
    const ok = await pinQuote(bookId, chapterId, anchor, anchor.quote ?? '');
    if (!ok) setError('That passage has moved — reopen the chapter and try again.');
    closeMenu();
  };

  const noticeExcluded = (staled: number): void => {
    setNotice(
      staled > 0
        ? `Won’t be written again. ${staled} chapter${staled === 1 ? '' : 's'} that mentioned it ${
            staled === 1 ? 'is' : 'are'
          } marked to rewrite.`
        : 'Won’t be written again.',
    );
  };

  const submitExclude = async (): Promise<void> => {
    if (draft.trim().length === 0) return;
    setNotice(null);
    try {
      noticeExcluded(await exclude(bookId, 'topic', draft.trim()));
    } catch {
      setError('Couldn’t exclude that. Try again.');
    }
    closeMenu();
  };

  const excludeSource = async (kind: string, id: string): Promise<void> => {
    setNotice(null);
    try {
      noticeExcluded(await exclude(bookId, 'source', id, SOURCE_KIND_LABEL[kind] ?? 'a source'));
    } catch {
      setError('Couldn’t exclude that. Try again.');
    }
    setOpenSources(null);
  };

  const applicable = countApplicable(markup);

  // Close the Review & apply sheet the moment the batch empties (the last mark removed, or the revision
  // applied) — the pill vanishes with it, so the sheet must never linger as an empty dead-end.
  useEffect(() => {
    if (applicable === 0) setReviewOpen(false);
  }, [applicable]);

  // Footnote numbers for the numbered superscript sources (§13.5): a running counter over the paragraphs that
  // actually drew on something, so provenance reads as book-style footnotes rather than an inline "Sources (N)".
  const sourceNoByPara = new Map<number, number>();
  {
    let n = 0;
    paragraphs.forEach((_, i) => {
      if ((provByAnchor.get(`p${i}`)?.length ?? 0) > 0) sourceNoByPara.set(i, (n += 1));
    });
  }

  // Per-kind counts for the bottom-sticky pending pill copy (§13.5) — mirrors `countApplicable`'s membership so
  // the pill total always equals what "Apply with your biographer" will act on.
  const allMarks = markup?.marks ?? [];
  const cutCount = allMarks.filter((m) => m.kind === 'delete' && m.status === 'pending').length;
  const commentCount = allMarks.filter(
    (m) => m.kind === 'comment' && m.status === 'open' && m.intent !== 'question',
  ).length;
  const askCount = allMarks.filter(
    (m) => m.kind === 'todo' && m.status === 'open' && m.todoKind === 'ask',
  ).length;
  const pillBreakdown = [
    cutCount > 0 ? `${cutCount} cut${cutCount === 1 ? '' : 's'}` : null,
    commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : null,
    askCount > 0 ? `${askCount} to-do${askCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const applyBatch = async (): Promise<void> => {
    setError(null);
    const res = await applyMarkup(bookId, chapterId);
    if (!res.ok) setError(res.message);
    else setReviewOpen(false);
  };

  return (
    <Stack gap={4}>
      <Inline justify="space-between">
        <Button variant="ghost" onClick={onBack} aria-label="Back to the book">
          ‹ Back
        </Button>
      </Inline>

      <Heading level={1}>{chapter.title}</Heading>
      <ChapterRibbon
        chapter={chapter}
        onReview={async () => {
          setError(null);
          const ok = await reviewChapter(bookId, chapterId);
          if (!ok) setError('Couldn’t save that. Try again.');
        }}
      />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner tone="info">{notice}</Banner> : null}

      <div className={styles.shapeBody}>
        <Stack gap={3}>
          {paragraphs.map((para, i) => {
            const refs = provByAnchor.get(`p${i}`);
            const marks = (markup?.marks ?? []).filter(
              (m) =>
                m.anchor?.paragraphId === `p${i}` &&
                ((m.kind === 'delete' && m.status === 'pending') ||
                  (m.kind === 'comment' && m.status === 'open') ||
                  (m.kind === 'todo' && m.status === 'open')),
            );
            const sourced = Boolean(refs && refs.length > 0);
            return (
              <div key={i} className={styles.para}>
                <div className={styles.paraMeasure}>
                  <div className={styles.paraBody}>
                    <Markdown {...(sourced ? { className: styles.inlineProse } : {})}>
                      {para}
                    </Markdown>
                    {sourced && refs ? (
                      <button
                        type="button"
                        className={styles.sourceSup}
                        aria-label={`Sources (${refs.length})`}
                        aria-expanded={openSources === i}
                        onClick={() => setOpenSources(openSources === i ? null : i)}
                      >
                        {sourceNoByPara.get(i)}
                      </button>
                    ) : null}
                  </div>

                  <div className={styles.paraActions}>
                    <button
                      type="button"
                      className={styles.sourcesToggle}
                      aria-expanded={activePara === i}
                      onClick={() => (activePara === i && mode ? closeMenu() : openMenu(i))}
                    >
                      Mark up
                    </button>
                  </div>

                  {openSources === i && refs ? (
                    <Stack gap={1}>
                      {refs.map((ref, j) => (
                        <div key={j} className={styles.markRow}>
                          <Text size="sm" tone="secondary">
                            Drawn from {SOURCE_KIND_LABEL[ref.kind] ?? 'your history'}
                            {ref.at ? ` · ${ref.at.slice(0, 10)}` : ''}
                          </Text>
                          <button
                            type="button"
                            className={styles.sourcesToggle}
                            onClick={() => void excludeSource(ref.kind, ref.id)}
                          >
                            Don’t draw on this again
                          </button>
                        </div>
                      ))}
                    </Stack>
                  ) : null}

                  {activePara === i && mode ? (
                    <Card>
                      <Stack gap={3}>
                        <Text size="sm" tone="secondary">
                          {activeQuote ? `Selected: “${activeQuote}”` : 'This whole paragraph'}
                        </Text>
                        {mode === 'menu' ? (
                          <Inline gap={2}>
                            <Button onClick={() => void addDelete(i)}>Delete</Button>
                            <Button
                              onClick={() => {
                                setMode('edit');
                                setDraft(activeQuote ?? para);
                              }}
                            >
                              Edit
                            </Button>
                            <Button onClick={() => setMode('comment')}>Comment</Button>
                            <Button
                              onClick={() => {
                                setMode('todo');
                                setDraft('');
                              }}
                            >
                              To-do
                            </Button>
                            <Button onClick={() => void addPin(i)}>Pin</Button>
                            <Button
                              onClick={() => {
                                setMode('exclude');
                                setDraft(activeQuote ?? para);
                              }}
                            >
                              Exclude
                            </Button>
                            <Button variant="ghost" onClick={closeMenu}>
                              Cancel
                            </Button>
                          </Inline>
                        ) : null}
                        {mode === 'comment' ? (
                          <Stack gap={2}>
                            <SegmentedControl
                              options={INTENT_OPTIONS}
                              value={commentIntent}
                              onChange={setCommentIntent}
                              aria-label="Comment kind"
                            />
                            <Textarea
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label="Comment"
                              rows={2}
                              placeholder="What should the biographer know?"
                            />
                            {commentIntent === 'fix' && insightIdFor(i) ? (
                              <label className={styles.flagRow}>
                                <input
                                  type="checkbox"
                                  checked={flagSource}
                                  onChange={(e) => setFlagSource(e.target.checked)}
                                />
                                <Text size="sm" tone="secondary">
                                  Also mark the source insight as inaccurate in your Memory
                                </Text>
                              </label>
                            ) : null}
                            <Inline justify="flex-end">
                              <Button variant="ghost" onClick={closeMenu}>
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                disabled={draft.trim().length === 0}
                                onClick={() => void submitComment(i)}
                              >
                                Add comment
                              </Button>
                            </Inline>
                          </Stack>
                        ) : null}
                        {mode === 'todo' ? (
                          <Stack gap={2}>
                            <SegmentedControl
                              options={TODO_KIND_OPTIONS}
                              value={todoKind}
                              onChange={setTodoKind}
                              aria-label="To-do kind"
                            />
                            <Text size="sm" tone="secondary">
                              {todoKind === 'remind'
                                ? 'A private reminder for you — your biographer never touches it.'
                                : todoKind === 'ask'
                                  ? 'An instruction your biographer folds into the next revision.'
                                  : 'Your biographer will ask you a few questions to gather this, waiting in your Inbox.'}
                            </Text>
                            <Textarea
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label="To-do"
                              rows={2}
                              placeholder={
                                todoKind === 'remind'
                                  ? 'e.g. upload the photo of Dad’s shop'
                                  : 'e.g. go deeper on the winter he got sick'
                              }
                            />
                            <Inline justify="flex-end">
                              <Button variant="ghost" onClick={closeMenu}>
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                disabled={draft.trim().length === 0 || busy}
                                onClick={() => void submitTodo(i)}
                              >
                                {todoKind === 'questions'
                                  ? busy
                                    ? 'Sending…'
                                    : 'Send me questions'
                                  : 'Add to-do'}
                              </Button>
                            </Inline>
                          </Stack>
                        ) : null}
                        {mode === 'edit' ? (
                          <Stack gap={2}>
                            <Text size="sm" tone="secondary">
                              Rewrite this in your own words — it’s kept exactly as you write it.
                            </Text>
                            <Textarea
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label="Your words"
                              rows={3}
                            />
                            <Inline justify="flex-end">
                              <Button variant="ghost" onClick={closeMenu}>
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                disabled={draft.trim().length === 0}
                                onClick={() => void submitEdit(i)}
                              >
                                Save my words
                              </Button>
                            </Inline>
                          </Stack>
                        ) : null}
                        {mode === 'exclude' ? (
                          <Stack gap={2}>
                            <Text size="sm" tone="secondary">
                              Never write about this again. It won’t appear in future chapters, and
                              any chapter that already mentions it is marked to rewrite.
                            </Text>
                            <Textarea
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label="What to never write about"
                              rows={2}
                            />
                            <Inline justify="flex-end">
                              <Button variant="ghost" onClick={closeMenu}>
                                Cancel
                              </Button>
                              <Button
                                variant="danger"
                                disabled={draft.trim().length === 0}
                                onClick={() => void submitExclude()}
                              >
                                Never write about this
                              </Button>
                            </Inline>
                          </Stack>
                        ) : null}
                      </Stack>
                    </Card>
                  ) : null}

                  {chapter.imagePlacements
                    .filter((pl) => pl.afterAnchor === `p${i}`)
                    .map((pl) => (
                      <figure key={pl.imageId} className={styles.placedImage}>
                        {imageUrls[pl.imageId] ? (
                          <img src={imageUrls[pl.imageId]} alt={pl.caption || 'Book image'} />
                        ) : null}
                        <figcaption>
                          <TextInput
                            value={pl.caption}
                            aria-label="Image caption"
                            placeholder="Caption (optional)"
                            onChange={(e) =>
                              void setPlacement(
                                bookId,
                                chapterId,
                                pl.imageId,
                                pl.afterAnchor,
                                e.target.value,
                              )
                            }
                          />
                          <Inline gap={2}>
                            <Select
                              aria-label="Move image after paragraph"
                              value={pl.afterAnchor}
                              onChange={(e) =>
                                void setPlacement(
                                  bookId,
                                  chapterId,
                                  pl.imageId,
                                  e.target.value,
                                  pl.caption,
                                )
                              }
                            >
                              {paragraphs.map((_, pi) => (
                                <option key={pi} value={`p${pi}`}>
                                  After paragraph {pi + 1}
                                </option>
                              ))}
                            </Select>
                            <button
                              type="button"
                              className={styles.sourcesToggle}
                              aria-label="Remove this image"
                              onClick={() => void removePlacement(bookId, chapterId, pl.imageId)}
                            >
                              Remove
                            </button>
                          </Inline>
                        </figcaption>
                      </figure>
                    ))}
                </div>

                {/* Pending marks live in the right-margin rail beside the measure at ≥900px (a container query,
                  §13.5), and stack under the paragraph below that. */}
                {marks.length > 0 ? (
                  <div className={styles.paraMarks} data-testid="shape-mark-rail">
                    {marks.map((m) => (
                      <div key={m.id} className={styles.markRow}>
                        {m.kind === 'delete' ? (
                          <Text size="sm" tone="secondary">
                            ✂ <del className={styles.deleteQuote}>{m.anchor.quote}</del>
                          </Text>
                        ) : m.kind === 'comment' ? (
                          <Text size="sm" tone="secondary">
                            💬 {INTENT_LABEL[m.intent]}: {m.text}
                          </Text>
                        ) : m.kind === 'todo' ? (
                          <Text size="sm" tone="secondary">
                            ☐ {TODO_KIND_LABEL[m.todoKind] ?? 'To-do'}: {m.text}
                          </Text>
                        ) : null}
                        {/* Answer-the-author (§3.3): a "question" comment gets a real, provenance-grounded
                            reply from the biographer — no longer a dead end. */}
                        {m.kind === 'comment' && m.intent === 'question' ? (
                          m.answer ? (
                            <div className={styles.questionAnswer}>
                              <Text size="sm">{m.answer}</Text>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={styles.sourcesToggle}
                              disabled={answering === m.id}
                              onClick={() => void askBiographer(m.id)}
                            >
                              {answering === m.id ? 'Asking…' : 'Ask your biographer'}
                            </button>
                          )
                        ) : null}
                        {m.kind === 'todo' && m.todoKind === 'remind' ? (
                          <button
                            type="button"
                            className={styles.sourcesToggle}
                            onClick={() =>
                              void updateMark(bookId, chapterId, m.id, { status: 'done' })
                            }
                          >
                            Mark done
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.sourcesToggle}
                            aria-label={`Undo this ${m.kind === 'delete' ? 'deletion' : m.kind}`}
                            onClick={() => void removeMark(bookId, chapterId, m.id)}
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Stack>
      </div>

      {/* Images in this chapter (§3.8) — illustrate or place an existing photo/illustration; the AI suggests
          where it fits, and you can move it. */}
      <Card>
        <Stack gap={2}>
          <Heading level={3}>Images</Heading>
          {imageError ? <Banner tone="danger">{imageError}</Banner> : null}
          {illustrating ? (
            <ImageProgress
              id={`story:${bookId}:ch:${chapterId}`}
              label="Illustrating this chapter"
            />
          ) : null}
          <Inline gap={2}>
            {imagesReady ? (
              <Button variant="ghost" disabled={imageBusy} onClick={() => void illustrate()}>
                {imageBusy ? 'Working…' : 'Illustrate this chapter'}
              </Button>
            ) : null}
            {placeable.length > 0 ? (
              <Select
                aria-label="Add an image to this chapter"
                value=""
                disabled={imageBusy}
                onChange={(e) => {
                  if (e.target.value) void placeImage(e.target.value);
                }}
              >
                <option value="">Add a photo or illustration…</option>
                {placeable.map((img) => (
                  <option key={img.id} value={img.id}>
                    {img.caption || (img.kind === 'uploaded' ? 'Photo' : 'Illustration')}
                  </option>
                ))}
              </Select>
            ) : null}
          </Inline>
          {!imagesReady && imageKeyChecked ? (
            <Text tone="secondary" size="sm">
              {canManageAi
                ? 'Turn on AI image generation and add your OpenAI key in Settings → Images to illustrate this chapter.'
                : 'Ask the person who set up this household to turn on AI image generation.'}
            </Text>
          ) : null}
        </Stack>
      </Card>

      <Inline justify="space-between">
        {confirmRewrite ? (
          <Inline gap={2}>
            <Text size="sm" tone="secondary">
              Rewrite this whole chapter with your biographer? Your pinned passages and edits in
              your own words are kept, and the current text is saved to History.
            </Text>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setConfirmRewrite(false);
                setError(null);
                const res = await regenerateChapter(bookId, chapterId);
                if (!res.ok) setError(res.message);
              }}
            >
              Rewrite it
            </Button>
            <Button variant="ghost" onClick={() => setConfirmRewrite(false)}>
              Cancel
            </Button>
          </Inline>
        ) : confirmPolish ? (
          <Inline gap={2}>
            <Text size="sm" tone="secondary">
              Polish the writing with your biographer — grammar and flow only, keeping your meaning
              and your own words. The current text is saved to History, so you can undo it.
            </Text>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setConfirmPolish(false);
                setError(null);
                const res = await lineEdit(bookId, chapterId);
                if (!res.ok) setError(res.message);
              }}
            >
              Polish it
            </Button>
            <Button variant="ghost" onClick={() => setConfirmPolish(false)}>
              Cancel
            </Button>
          </Inline>
        ) : (
          <Inline gap={2}>
            <Button disabled={busy} onClick={() => setConfirmRewrite(true)}>
              {busy ? 'Working…' : 'Rewrite this chapter'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmPolish(true)}>
              Polish the writing
            </Button>
          </Inline>
        )}
        <Button variant="ghost" onClick={() => setHistoryOpen(true)}>
          History
        </Button>
      </Inline>

      {/* The bottom-sticky pending pill (§13.5): a running count of what the batch revision will act on, opening
          the Review & apply sheet. Inline edits + pins are already applied (they're not marks), so the pill's
          total mirrors `countApplicable`, never those instant changes. */}
      {applicable > 0 ? (
        <div className={styles.pendingPillWrap} aria-live="polite">
          <button
            type="button"
            className={styles.pendingPill}
            onClick={() => setReviewOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={reviewOpen}
          >
            <span className={styles.pendingPillCount}>
              {applicable} change{applicable === 1 ? '' : 's'} ready
              {pillBreakdown ? ` · ${pillBreakdown}` : ''}
            </span>
            <span className={styles.pendingPillHint}>
              — your inline edits and pins are already in
            </span>
          </button>
        </div>
      ) : null}

      {reviewOpen ? (
        <ReviewSheet
          markup={markup}
          busy={busy}
          onRemove={(markId) => void removeMark(bookId, chapterId, markId)}
          onApply={applyBatch}
          onClose={() => setReviewOpen(false)}
        />
      ) : null}

      {historyOpen ? (
        <HistorySheet
          bookId={bookId}
          chapterId={chapterId}
          currentMarkdown={chapter.markdown}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </Stack>
  );
}
