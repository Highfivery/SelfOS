import { useEffect, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Markdown,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
  type SegmentOption,
} from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryStore } from '../../../stores/storyStore';
import type {
  BookConfig,
  BookOutline,
  ChapterMarkup,
  CommentIntent,
  StoryBookBundle,
  TextAnchor,
} from '@shared/schemas';
import styles from './Story.module.css';

type Voice = BookConfig['voice'];
type Style = BookConfig['style'];
type Length = BookConfig['length'];

const VOICE_OPTIONS: SegmentOption<Voice>[] = [
  { value: 'third', label: 'Third person' },
  { value: 'first', label: 'First person' },
];
const STYLE_OPTIONS: SegmentOption<Style>[] = [
  { value: 'literary', label: 'Literary' },
  { value: 'warm', label: 'Warm' },
  { value: 'plain', label: 'Plain' },
];
const LENGTH_OPTIONS: SegmentOption<Length>[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'standard', label: 'Standard' },
  { value: 'full', label: 'Full' },
];

function Labeled({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <Stack gap={2}>
      <Text size="sm" tone="secondary">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

export function Story(): JSX.Element {
  const activePersonId = useSessionStore((s) => s.activePerson?.id);
  const personName = useSessionStore((s) => s.activePerson?.displayName ?? '');
  const books = useStoryStore((s) => s.books);
  const bundle = useStoryStore((s) => s.bundle);
  const loaded = useStoryStore((s) => s.loaded);
  const generating = useStoryStore((s) => s.generating);
  const load = useStoryStore((s) => s.load);
  const create = useStoryStore((s) => s.create);
  const open = useStoryStore((s) => s.open);
  const generateFoundations = useStoryStore((s) => s.generateFoundations);

  const [mode, setMode] = useState<'idle' | 'setup'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null); // the open chapter's id, or null

  useEffect(() => {
    void load();
  }, [load, activePersonId]);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setMode('idle');
    setError(null);
    setReading(null);
  }, [activePersonId]);

  // Open the first book once loaded so returning lands on it — but never while a pass is running (so it
  // can't race the create → generate sequence or open a book into a dead-end mid-generation).
  useEffect(() => {
    const first = books[0];
    if (loaded && first && !bundle && !generating) void open(first.id);
  }, [loaded, books, bundle, generating, open]);

  const draftFoundations = async (bookId: string): Promise<void> => {
    setError(null);
    const res = await generateFoundations(bookId);
    if (!res.ok) setError(res.message);
  };

  if (!loaded) return <div className={styles.page} aria-busy="true" />;

  if (generating) {
    return (
      <div className={styles.page}>
        <Card>
          <Stack gap={3}>
            <Heading level={2}>Reading your story…</Heading>
            <Text tone="secondary">
              Your biographer is reading everything you’ve shared and shaping the outline. This
              takes a moment.
            </Text>
          </Stack>
        </Card>
      </div>
    );
  }

  if (bundle) {
    if (bundle.outline && !bundle.outline.approved) {
      return (
        <div className={styles.page}>
          <OutlineReview bundle={bundle} />
        </div>
      );
    }
    if (bundle.outline) {
      const openChapter = reading ? bundle.chapters.find((c) => c.id === reading) : undefined;
      if (openChapter) {
        return (
          <div className={styles.page}>
            <ChapterReader bundle={bundle} chapter={openChapter} onBack={() => setReading(null)} />
          </div>
        );
      }
      return (
        <div className={styles.page}>
          <BookOverview bundle={bundle} onOpenChapter={setReading} />
        </div>
      );
    }
    // A book exists but has no outline yet — never generated, or a foundations pass that failed. Offer to
    // draft (or retry) it, and surface any error, so it's never a silent dead-end.
    return (
      <div className={styles.page}>
        <NeedsOutline
          bundle={bundle}
          error={error}
          onGenerate={() => draftFoundations(bundle.manifest.id)}
        />
      </div>
    );
  }

  if (mode === 'setup') {
    return (
      <div className={styles.page}>
        <StorySetup
          defaultTitle={personName ? `The Story of ${personName}` : 'Your Story'}
          onCancel={() => setMode('idle')}
          onCreate={async (title, config) => {
            setError(null);
            const book = await create({ type: 'biography', title, config });
            if (!book) {
              setError('Couldn’t start your story. Try again.');
              return;
            }
            setMode('idle');
            await open(book.id); // land on the book so a failed pass shows NeedsOutline (not the empty state)
            await draftFoundations(book.id);
          }}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Card>
        <Stack gap={4}>
          <Stack gap={2}>
            <Heading level={1}>Your Story</Heading>
            <Text tone="secondary">
              An evolving biography, written for you from everything SelfOS knows — your
              reflections, sessions, and the answers you’ve given. It’s written from your private
              vault, and nobody sees it until you choose to share.
            </Text>
          </Stack>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Inline>
            <Button variant="primary" onClick={() => setMode('setup')}>
              Start your story
            </Button>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}

function StorySetup({
  defaultTitle,
  onCreate,
  onCancel,
}: {
  defaultTitle: string;
  onCreate: (title: string, config: BookConfig) => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [title, setTitle] = useState(defaultTitle);
  const [voice, setVoice] = useState<Voice>('third');
  const [style, setStyle] = useState<Style>('warm');
  const [length, setLength] = useState<Length>('standard');

  return (
    <Card>
      <Stack gap={4}>
        <Stack gap={2}>
          <Heading level={2}>Start your story</Heading>
          <Text tone="secondary">
            Your biographer reads everything it knows about you unless you exclude it later. Choose
            a title and how it should read.
          </Text>
        </Stack>
        <Labeled label="Title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        </Labeled>
        <Labeled label="Narrative voice">
          <SegmentedControl
            options={VOICE_OPTIONS}
            value={voice}
            onChange={setVoice}
            aria-label="Narrative voice"
          />
        </Labeled>
        <Labeled label="Style">
          <SegmentedControl
            options={STYLE_OPTIONS}
            value={style}
            onChange={setStyle}
            aria-label="Style"
          />
        </Labeled>
        <Labeled label="Length">
          <SegmentedControl
            options={LENGTH_OPTIONS}
            value={length}
            onChange={setLength}
            aria-label="Length"
          />
        </Labeled>
        <Inline justify="flex-end">
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={title.trim().length === 0}
            onClick={() => onCreate(title.trim(), { voice, style, length, autoRefresh: true })}
          >
            Create &amp; draft the outline
          </Button>
        </Inline>
      </Stack>
    </Card>
  );
}

function NeedsOutline({
  bundle,
  error,
  onGenerate,
}: {
  bundle: StoryBookBundle;
  error: string | null;
  onGenerate: () => void | Promise<void>;
}): JSX.Element {
  const remove = useStoryStore((s) => s.remove);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Stack gap={4}>
      <Heading level={1}>{bundle.manifest.title}</Heading>
      <Text tone="secondary">
        Your outline hasn’t been drafted yet. When you’re ready, your biographer will read
        everything it knows and propose the shape of your book.
      </Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Inline justify="space-between">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onGenerate();
            setBusy(false);
          }}
        >
          {error ? 'Try again' : 'Draft the outline'}
        </Button>
        {confirmDelete ? (
          <Inline>
            <Button variant="danger" onClick={() => void remove(bundle.manifest.id)}>
              Delete
            </Button>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </Inline>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete book
          </Button>
        )}
      </Inline>
    </Stack>
  );
}

function OutlineReview({ bundle }: { bundle: StoryBookBundle }): JSX.Element {
  const approveOutline = useStoryStore((s) => s.approveOutline);
  const saveOutline = useStoryStore((s) => s.saveOutline);
  const generateFoundations = useStoryStore((s) => s.generateFoundations);
  const [outline, setOutline] = useState<BookOutline>(
    bundle.outline ?? { schemaVersion: 1, approved: false, parts: [] },
  );
  const [busy, setBusy] = useState(false);
  const bookId = bundle.manifest.id;

  const editChapter = (
    partId: string,
    chapterId: string,
    patch: { title?: string; brief?: string },
  ) =>
    setOutline((o) => ({
      ...o,
      parts: o.parts.map((p) =>
        p.id === partId
          ? { ...p, chapters: p.chapters.map((c) => (c.id === chapterId ? { ...c, ...patch } : c)) }
          : p,
      ),
    }));

  const removeChapter = (partId: string, chapterId: string) =>
    setOutline((o) => ({
      ...o,
      parts: o.parts
        .map((p) =>
          p.id === partId ? { ...p, chapters: p.chapters.filter((c) => c.id !== chapterId) } : p,
        )
        .filter((p) => p.chapters.length > 0),
    }));

  const chapterCount = outline.parts.reduce((n, p) => n + p.chapters.length, 0);

  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <Heading level={1}>Review your outline</Heading>
        <Text tone="secondary">
          This is the shape of your book. Rename or adjust anything, remove what doesn’t fit, then
          approve it and your biographer will start writing.
        </Text>
      </Stack>

      {bundle.manifest.essence ? (
        <Card>
          <Stack gap={2}>
            <Text size="sm" tone="secondary">
              What this book is about
            </Text>
            <Markdown>{bundle.manifest.essence}</Markdown>
          </Stack>
        </Card>
      ) : null}

      {outline.parts.map((part) => (
        <Card key={part.id}>
          <Stack gap={3}>
            <Heading level={2}>{part.title}</Heading>
            {part.chapters.map((chapter) => (
              <div key={chapter.id} className={styles.chapterRow}>
                <Stack gap={2}>
                  <Inline justify="space-between">
                    <div className={styles.grow}>
                      <TextInput
                        value={chapter.title}
                        onChange={(e) =>
                          editChapter(part.id, chapter.id, { title: e.target.value })
                        }
                        aria-label="Chapter title"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => removeChapter(part.id, chapter.id)}
                      aria-label={`Remove chapter ${chapter.title}`}
                    >
                      Remove
                    </Button>
                  </Inline>
                  <Textarea
                    value={chapter.brief}
                    onChange={(e) => editChapter(part.id, chapter.id, { brief: e.target.value })}
                    aria-label="Chapter brief"
                    rows={2}
                  />
                </Stack>
              </div>
            ))}
          </Stack>
        </Card>
      ))}

      <Inline justify="space-between">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await generateFoundations(bookId);
            setBusy(false);
          }}
        >
          Start over
        </Button>
        <Inline>
          <Button
            disabled={busy || chapterCount === 0}
            onClick={async () => {
              setBusy(true);
              await saveOutline(bookId, outline);
              setBusy(false);
            }}
          >
            Save changes
          </Button>
          <Button
            variant="primary"
            disabled={busy || chapterCount === 0}
            onClick={async () => {
              setBusy(true);
              await approveOutline(bookId, outline);
              setBusy(false);
            }}
          >
            Approve &amp; start writing
          </Button>
        </Inline>
      </Inline>
    </Stack>
  );
}

const CHAPTER_STATUS_LABEL: Record<string, string> = {
  generating: 'Writing…',
  new: 'New',
  updated: 'Updated',
  stale: 'New material',
  reviewed: 'Reviewed',
};

function BookOverview({
  bundle,
  onOpenChapter,
}: {
  bundle: StoryBookBundle;
  onOpenChapter: (chapterId: string) => void;
}): JSX.Element {
  const remove = useStoryStore((s) => s.remove);
  const generateChapters = useStoryStore((s) => s.generateChapters);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { manifest, outline, chapters } = bundle;

  const outlineChapters = outline ? outline.parts.flatMap((p) => p.chapters) : [];
  const writtenIds = new Set(chapters.map((c) => c.id));
  const pending = outlineChapters.filter((c) => !writtenIds.has(c.id)).length;

  return (
    <Stack gap={4}>
      <Inline justify="space-between">
        <Heading level={1}>{manifest.title}</Heading>
        <Text tone="secondary" size="sm">
          Biography · {manifest.config.voice === 'first' ? 'first person' : 'third person'}
        </Text>
      </Inline>

      {manifest.essence ? (
        <Card>
          <Markdown>{manifest.essence}</Markdown>
        </Card>
      ) : null}

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {pending > 0 ? (
        <Inline>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setError(null);
              const res = await generateChapters(manifest.id);
              if (!res.ok) setError(res.message);
              else if (res.budgetReached && res.message) setError(res.message);
            }}
          >
            {busy
              ? 'Writing your chapters…'
              : chapters.length > 0
                ? `Write the remaining ${pending} chapter${pending === 1 ? '' : 's'}`
                : 'Write your chapters'}
          </Button>
        </Inline>
      ) : null}

      {outline
        ? outline.parts.map((part) => (
            <Card key={part.id}>
              <Stack gap={2}>
                <Heading level={2}>{part.title}</Heading>
                {part.chapters.map((chapter) => {
                  const written = chapters.find((c) => c.id === chapter.id);
                  return written ? (
                    <button
                      key={chapter.id}
                      type="button"
                      className={styles.chapterLink}
                      onClick={() => onOpenChapter(chapter.id)}
                    >
                      <Text className={styles.rowTitle}>{chapter.title}</Text>
                      <Text tone="secondary" size="sm">
                        {CHAPTER_STATUS_LABEL[written.status] ?? written.status} ›
                      </Text>
                    </button>
                  ) : (
                    <div key={chapter.id} className={styles.overviewRow}>
                      <Text className={styles.rowTitle}>{chapter.title}</Text>
                      <Text tone="secondary" size="sm">
                        Not yet written
                      </Text>
                    </div>
                  );
                })}
              </Stack>
            </Card>
          ))
        : null}

      <Inline>
        {confirmDelete ? (
          <Inline>
            <Text tone="secondary" size="sm">
              Delete this book?
            </Text>
            <Button variant="danger" onClick={() => void remove(manifest.id)}>
              Delete
            </Button>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </Inline>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete book
          </Button>
        )}
      </Inline>
    </Stack>
  );
}

const SOURCE_KIND_LABEL: Record<string, string> = {
  insight: 'a coaching insight',
  intakeAnswer: 'your onboarding',
  response: 'a check-in answer',
  dream: 'a dream',
  test: 'a self-reflection',
  goal: 'a goal',
  challenge: 'a challenge',
  together: 'a session with your partner',
  timeline: 'your timeline',
  photo: 'a photo',
};

/** Split a chapter's markdown into paragraphs the SAME way the core anchors provenance (`p<index>` over
 *  blank-line-separated non-empty blocks — mirrors `chapterParagraphs`; kept inline since the renderer can't
 *  import the story core, which pulls crypto). */
function splitParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

const INTENT_OPTIONS: SegmentOption<CommentIntent>[] = [
  { value: 'addContext', label: 'Add context' },
  { value: 'fix', label: 'Fix this' },
  { value: 'question', label: 'Ask' },
];
const INTENT_LABEL: Record<CommentIntent, string> = {
  addContext: 'Add context',
  fix: 'Fix this',
  question: 'Question',
};

/** Build a text anchor for a mark: a selected span, or the whole paragraph when nothing is selected. Records a
 *  short prefix/suffix so a paragraph mark survives light re-flow. A selection that appears MORE THAN ONCE in
 *  the paragraph can't be pinned to the right occurrence from the DOM string alone, so it falls back to the
 *  whole paragraph — otherwise the backend would anchor to the first match and an instant Edit would rewrite
 *  the wrong span (a silent data bug on the person's own words). Exported for a unit test. */
export function buildAnchor(paragraphs: string[], i: number, quote: string | null): TextAnchor {
  const para = paragraphs[i] ?? '';
  const sel = quote && quote.trim().length > 0 ? quote : null;
  const unique = sel !== null && para.indexOf(sel) === para.lastIndexOf(sel) && para.includes(sel);
  const q = unique ? sel : para;
  const idx = para.indexOf(q);
  const prefix = idx > 0 ? para.slice(Math.max(0, idx - 24), idx) : undefined;
  const afterText = idx >= 0 ? para.slice(idx + q.length, idx + q.length + 24) : '';
  return {
    paragraphId: `p${i}`,
    quote: q,
    ...(prefix ? { prefix } : {}),
    ...(afterText.length > 0 ? { suffix: afterText } : {}),
  };
}

/** The marks the batch revision will act on (mirrors the core `pendingRevisionMarks`): pending deletes + open
 *  addContext/fix comments + open `ask` to-dos. A question comment is recorded but not applied. Exported so a
 *  test can lock down the question-comment exclusion (the one place this diverges from the strip). */
export function countApplicable(markup: ChapterMarkup | null): number {
  if (!markup) return 0;
  return markup.marks.filter(
    (m) =>
      (m.kind === 'delete' && m.status === 'pending') ||
      (m.kind === 'comment' && m.status === 'open' && m.intent !== 'question') ||
      (m.kind === 'todo' && m.status === 'open' && m.todoKind === 'ask'),
  ).length;
}

function ChapterReader({
  bundle,
  chapter,
  onBack,
}: {
  bundle: StoryBookBundle;
  chapter: StoryBookBundle['chapters'][number];
  onBack: () => void;
}): JSX.Element {
  const regenerateChapter = useStoryStore((s) => s.regenerateChapter);
  const reviewChapter = useStoryStore((s) => s.reviewChapter);
  const markup = useStoryStore((s) => s.markup);
  const loadMarkup = useStoryStore((s) => s.loadMarkup);
  const clearMarkup = useStoryStore((s) => s.clearMarkup);
  const addMark = useStoryStore((s) => s.addMark);
  const removeMark = useStoryStore((s) => s.removeMark);
  const applyMarkup = useStoryStore((s) => s.applyMarkup);
  const editPassage = useStoryStore((s) => s.editPassage);
  const pinQuote = useStoryStore((s) => s.pinQuote);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  const [error, setError] = useState<string | null>(null);
  const [openSources, setOpenSources] = useState<number | null>(null);
  const [activePara, setActivePara] = useState<number | null>(null);
  const [activeQuote, setActiveQuote] = useState<string | null>(null);
  const [mode, setMode] = useState<'menu' | 'comment' | 'edit' | null>(null);
  const [commentIntent, setCommentIntent] = useState<CommentIntent>('addContext');
  const [draft, setDraft] = useState('');

  const bookId = bundle.manifest.id;
  const chapterId = chapter.id;
  const paragraphs = splitParagraphs(chapter.markdown);
  const provByAnchor = new Map(chapter.provenance.map((p) => [p.anchor, p.refs]));

  useEffect(() => {
    void loadMarkup(bookId, chapterId);
    return () => clearMarkup();
  }, [bookId, chapterId, loadMarkup, clearMarkup]);

  const closeMenu = (): void => {
    setActivePara(null);
    setActiveQuote(null);
    setMode(null);
    setDraft('');
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
    await addMark(bookId, chapterId, {
      id: crypto.randomUUID(),
      kind: 'comment',
      anchor: buildAnchor(paragraphs, i, activeQuote),
      intent: commentIntent,
      text: draft.trim(),
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

  const applicable = countApplicable(markup);

  return (
    <Stack gap={4}>
      <Inline justify="space-between">
        <Button variant="ghost" onClick={onBack} aria-label="Back to the book">
          ‹ Back
        </Button>
        <Text tone="secondary" size="sm">
          {CHAPTER_STATUS_LABEL[chapter.status] ?? chapter.status}
        </Text>
      </Inline>

      <Heading level={1}>{chapter.title}</Heading>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {applicable > 0 ? (
        <div className={styles.applyBar} role="status">
          <Text size="sm">
            {applicable} change{applicable === 1 ? '' : 's'} ready to apply
          </Text>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setError(null);
              const res = await applyMarkup(bookId, chapterId);
              if (!res.ok) setError(res.message);
            }}
          >
            {busy ? 'Applying…' : 'Review & apply'}
          </Button>
        </div>
      ) : null}

      <Stack gap={3}>
        {paragraphs.map((para, i) => {
          const refs = provByAnchor.get(`p${i}`);
          const marks = (markup?.marks ?? []).filter(
            (m) =>
              m.anchor?.paragraphId === `p${i}` &&
              ((m.kind === 'delete' && m.status === 'pending') ||
                (m.kind === 'comment' && m.status === 'open')),
          );
          return (
            <div key={i} className={styles.para}>
              <div className={styles.paraBody}>
                <Markdown>{para}</Markdown>
              </div>

              {marks.length > 0 ? (
                <Stack gap={1}>
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
                      ) : null}
                      <button
                        type="button"
                        className={styles.sourcesToggle}
                        aria-label={`Undo this ${m.kind === 'delete' ? 'deletion' : 'comment'}`}
                        onClick={() => void removeMark(bookId, chapterId, m.id)}
                      >
                        Undo
                      </button>
                    </div>
                  ))}
                </Stack>
              ) : null}

              <Inline gap={2}>
                <button
                  type="button"
                  className={styles.sourcesToggle}
                  aria-expanded={activePara === i}
                  onClick={() => (activePara === i && mode ? closeMenu() : openMenu(i))}
                >
                  Mark up
                </button>
                {refs && refs.length > 0 ? (
                  <button
                    type="button"
                    className={styles.sourcesToggle}
                    aria-expanded={openSources === i}
                    onClick={() => setOpenSources(openSources === i ? null : i)}
                  >
                    Sources ({refs.length})
                  </button>
                ) : null}
              </Inline>

              {openSources === i && refs ? (
                <Stack gap={1}>
                  {refs.map((ref, j) => (
                    <Text key={j} size="sm" tone="secondary">
                      Drawn from {SOURCE_KIND_LABEL[ref.kind] ?? 'your history'}
                      {ref.at ? ` · ${ref.at.slice(0, 10)}` : ''}
                    </Text>
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
                        <Button onClick={() => void addPin(i)}>Pin</Button>
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
                  </Stack>
                </Card>
              ) : null}
            </div>
          );
        })}
      </Stack>

      <Inline justify="space-between">
        <Button
          disabled={busy}
          onClick={async () => {
            setError(null);
            const res = await regenerateChapter(bookId, chapterId);
            if (!res.ok) setError(res.message);
          }}
        >
          {busy ? 'Rewriting…' : 'Rewrite this chapter'}
        </Button>
        {chapter.status === 'reviewed' ? (
          <Text tone="secondary" size="sm">
            Reviewed
          </Text>
        ) : (
          <Button
            variant="primary"
            onClick={async () => {
              setError(null);
              const ok = await reviewChapter(bookId, chapterId);
              if (!ok) setError('Couldn’t save that. Try again.');
            }}
          >
            Looks good
          </Button>
        )}
      </Inline>
    </Stack>
  );
}
