import { useEffect, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Inline,
  Markdown,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  type SegmentOption,
} from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryStore } from '../../../stores/storyStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useStoryRefresh } from '../../notifications/useStoryRefresh';
import { useStoryInterview } from '../../notifications/useStoryInterview';
import { useSetting } from '../../../settings/useSetting';
import { aiKeyResolved } from '../../aiAvailability';
import { DEFAULT_IMAGE_STYLE, IMAGE_STYLE_PRESETS } from '../dreams/imageStyles';
import { downscaleImage } from '../sessions/downscaleImage';
import { AdminOnlyBadge } from '../../../design-system/components';
import type {
  BookConfig,
  BookOutline,
  ChapterMarkup,
  BookMatter,
  CommentIntent,
  StoryBookBundle,
  StoryCompleteness,
  StoryCompletenessStage,
  StoryReaderView,
  StructuralProposal,
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
  const readerView = useStoryStore((s) => s.readerView);
  const closeSharedBook = useStoryStore((s) => s.closeSharedBook);

  const [mode, setMode] = useState<'idle' | 'setup'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null); // the open chapter's id, or null

  // The automatic living-book refresh cadence (§3.4) — nudges the bridge (daily-throttled + capped) for the
  // open book if its autoRefresh is on. Silent: it just re-stamps stale badges / weaves in new material.
  useStoryRefresh(bundle?.manifest.id ?? null, bundle?.manifest.config.autoRefresh ?? false);
  // The autonomous interview cadence (§3.7) — nudges the bridge (7-day-throttled + capped + ≤1 open) to gap-pass
  // the book + mint a story check-in when warranted. Silent: check-ins land gently in the Inbox.
  useStoryInterview(bundle?.manifest.id ?? null, bundle?.manifest.config.autoRefresh ?? false);

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

  // Reading a book someone shared with you takes over the surface (the published head, read-only).
  if (readerView) {
    return (
      <div className={styles.page}>
        <SharedReaderView view={readerView} onBack={closeSharedBook} />
      </div>
    );
  }

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
      <SharedWithYou />
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

/**
 * The book cover (§3.8, Phase H). Reuses the spec-13 distill→render image flow behind the ONE shared image
 * consent (`dreams.imageGenerationEnabled`) + the OpenAI key. A cover is symbolic — never a portrait of the
 * subject (the service enforces name-free/no-likeness). When AI images aren't set up, a calm setup note
 * appears instead of a button that could only fail — owner sees the Settings path, a member is pointed at
 * the owner (41 §3.3). An existing cover always stays viewable/removable even if AI is later turned off.
 */
function CoverPanel({
  bookId,
  coverImageId,
}: {
  bookId: string;
  coverImageId?: string;
}): JSX.Element {
  const isAdmin = useSessionStore((s) => s.can('budgets.manage'));
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  const [consent] = useSetting('dreams.imageGenerationEnabled');
  const [aiEnabled] = useSetting('ai.enabled');
  const [defaultStyle] = useSetting('dreams.imageStyle');
  const generateImage = useStoryStore((s) => s.generateImage);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const deleteImage = useStoryStore((s) => s.deleteImage);

  const [style, setStyle] = useState<string>('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setError(null);
    setConfirmRemove(false);
    void (async () => {
      const has = await aiKeyResolved('openai');
      const url = coverImageId ? await getImageUrl(bookId, coverImageId) : null;
      setHasKey(Boolean(has));
      setCoverUrl(url);
      setLoading(false);
    })();
  }, [bookId, coverImageId, getImageUrl]);

  const ready = consent === true && aiEnabled !== false && hasKey;
  const chosenStyle =
    style || (typeof defaultStyle === 'string' && defaultStyle) || DEFAULT_IMAGE_STYLE;

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await generateImage(bookId, { kind: 'cover' }, chosenStyle);
    if (res.ok) {
      const url = await getImageUrl(bookId, res.image.id);
      setCoverUrl(url);
      setCost(typeof res.costUsd === 'number' ? res.costUsd : null);
    } else {
      setError(res.message);
    }
    setBusy(false);
  };

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Cover</Heading>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {coverUrl ? (
          <img className={styles.coverImage} src={coverUrl} alt={`Cover for this book`} />
        ) : (
          <Text tone="secondary" size="sm">
            A symbolic cover for your story — evocative art, never a literal portrait.
          </Text>
        )}
        {ready ? (
          <Stack gap={2}>
            <Field label="Style">
              {(p) => (
                <Select {...p} value={style} onChange={(e) => setStyle(e.target.value)}>
                  <option value="">Default ({chosenStyle})</option>
                  {IMAGE_STYLE_PRESETS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>
            <Inline>
              <Button disabled={busy} onClick={create}>
                {busy ? 'Creating…' : coverUrl ? 'Regenerate cover' : 'Create a cover'}
              </Button>
              {coverUrl && coverImageId ? (
                confirmRemove ? (
                  <Inline>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await deleteImage(bookId, coverImageId);
                        setCoverUrl(null);
                        setCost(null);
                        setConfirmRemove(false);
                        setBusy(false);
                      }}
                    >
                      Remove cover
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                      Keep
                    </Button>
                  </Inline>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
                    Remove
                  </Button>
                )
              ) : null}
              {isAdmin && cost !== null ? (
                <Text tone="secondary" size="sm">
                  <AdminOnlyBadge /> ~${cost.toFixed(3)}
                </Text>
              ) : null}
            </Inline>
          </Stack>
        ) : loading ? null : (
          <Text tone="secondary" size="sm">
            {canManageAi
              ? 'Turn on AI image generation and add your OpenAI key in Settings → Dreams to create a cover.'
              : 'Ask the person who set up this household to turn on AI image generation.'}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Photos (§3.7, Phase H2). Upload personal photos (downscaled + EXIF-stripped in the renderer, spec 45);
 * each can be analyzed by Claude vision → a caption + 2–4 questions to answer, and every answer persists to
 * the interview corpus so the biographer can draw on it. A photo is NEVER an image-generation input — it's
 * only ever read by vision. Uploading needs no consent (it's the author's own photo); analyzing needs the
 * Claude key (the app already requires AI), so a failed analyze surfaces its reason calmly.
 */
function PhotosPanel({ bookId }: { bookId: string }): JSX.Element {
  const images = useStoryStore((s) => s.images);
  const imageUrls = useStoryStore((s) => s.imageUrls);
  const photoAnswers = useStoryStore((s) => s.photoAnswers);
  const loadImages = useStoryStore((s) => s.loadImages);
  const loadPhotoAnswers = useStoryStore((s) => s.loadPhotoAnswers);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const uploadPhoto = useStoryStore((s) => s.uploadPhoto);
  const analyzePhoto = useStoryStore((s) => s.analyzePhoto);
  const answerPhoto = useStoryStore((s) => s.answerPhoto);
  const deleteImage = useStoryStore((s) => s.deleteImage);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-photo vision questions (ephemeral) + a per-question draft answer, keyed by image id.
  const [questions, setQuestions] = useState<Record<string, string[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const photos = images.filter((i) => i.kind === 'uploaded');

  useEffect(() => {
    void loadImages(bookId);
    void loadPhotoAnswers(bookId);
  }, [bookId, loadImages, loadPhotoAnswers]);

  // Resolve a data URL for every uploaded photo not yet cached.
  useEffect(() => {
    for (const p of photos) {
      if (!imageUrls[p.id]) void getImageUrl(bookId, p.id);
    }
  }, [bookId, photos, imageUrls, getImageUrl]);

  const onPick = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const scaled = await downscaleImage(file);
      const entry = await uploadPhoto(bookId, scaled.mime, scaled.base64);
      if (entry) await getImageUrl(bookId, entry.id);
      else setError('That image couldn’t be added.');
    } catch {
      setError('Couldn’t read that image. Try a different photo.');
    }
    setBusy(false);
  };

  const analyze = async (imageId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await analyzePhoto(bookId, imageId);
    if (res.ok) setQuestions((q) => ({ ...q, [imageId]: res.analysis.questions }));
    else setError(res.message);
    setBusy(false);
  };

  return (
    <Card>
      <Stack gap={2}>
        <Inline justify="space-between">
          <Heading level={2}>Photos</Heading>
          <Button variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Working…' : 'Add a photo'}
          </Button>
        </Inline>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className={styles.hiddenFile}
          aria-label="Add a photo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPick(file);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {photos.length === 0 ? (
          <Text tone="secondary" size="sm">
            Add a photo and your biographer can ask about the memory behind it — the answers become
            part of your story. Photos are never used to generate art.
          </Text>
        ) : null}
        {photos.map((p) => {
          const answered = photoAnswers.filter((a) => a.imageId === p.id);
          const asked = questions[p.id] ?? [];
          const url = imageUrls[p.id];
          return (
            <div key={p.id} className={styles.photoRow}>
              {url ? (
                <img className={styles.photoThumb} src={url} alt={p.caption ?? 'Uploaded photo'} />
              ) : null}
              <Stack gap={1}>
                {p.caption ? <Text size="sm">{p.caption}</Text> : null}
                <Inline>
                  <Button variant="ghost" disabled={busy} onClick={() => analyze(p.id)}>
                    {p.caption ? 'Ask more' : 'Caption & ask about this'}
                  </Button>
                  <button
                    type="button"
                    className={styles.sourcesToggle}
                    aria-label="Remove this photo"
                    onClick={() => void deleteImage(bookId, p.id)}
                  >
                    Remove
                  </button>
                </Inline>
                {answered.map((a, i) => (
                  <Text key={`ans-${i}`} tone="secondary" size="sm">
                    <strong>{a.question}</strong> {a.answer}
                  </Text>
                ))}
                {asked.map((q) => (
                  <Field key={q} label={q}>
                    {(fieldProps) => (
                      <Inline>
                        <TextInput
                          {...fieldProps}
                          value={drafts[`${p.id}:${q}`] ?? ''}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [`${p.id}:${q}`]: e.target.value }))
                          }
                          placeholder="Your answer…"
                        />
                        <Button
                          disabled={busy || !(drafts[`${p.id}:${q}`] ?? '').trim()}
                          onClick={async () => {
                            const answer = (drafts[`${p.id}:${q}`] ?? '').trim();
                            if (!answer) return;
                            await answerPhoto(bookId, p.id, q, answer);
                            setDrafts((d) => {
                              const next = { ...d };
                              delete next[`${p.id}:${q}`];
                              return next;
                            });
                            setQuestions((qs) => ({
                              ...qs,
                              [p.id]: (qs[p.id] ?? []).filter((x) => x !== q),
                            }));
                          }}
                        >
                          Save answer
                        </Button>
                      </Inline>
                    )}
                  </Field>
                ))}
              </Stack>
            </div>
          );
        })}
      </Stack>
    </Card>
  );
}

function BookOverview({
  bundle,
  onOpenChapter,
}: {
  bundle: StoryBookBundle;
  onOpenChapter: (chapterId: string) => void;
}): JSX.Element {
  const remove = useStoryStore((s) => s.remove);
  const generateChapters = useStoryStore((s) => s.generateChapters);
  const refreshBook = useStoryStore((s) => s.refreshBook);
  const todos = useStoryStore((s) => s.todos);
  const loadTodos = useStoryStore((s) => s.loadTodos);
  const updateMark = useStoryStore((s) => s.updateMark);
  const exclusions = useStoryStore((s) => s.exclusions);
  const loadExclusions = useStoryStore((s) => s.loadExclusions);
  const unexclude = useStoryStore((s) => s.unexclude);
  const proposals = useStoryStore((s) => s.proposals);
  const loadProposals = useStoryStore((s) => s.loadProposals);
  const resolveProposal = useStoryStore((s) => s.resolveProposal);
  const completeness = useStoryStore((s) => s.completeness);
  const loadCompleteness = useStoryStore((s) => s.loadCompleteness);
  const runInterviewCheck = useStoryStore((s) => s.runInterviewCheck);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [interviewBusy, setInterviewBusy] = useState(false);
  const { manifest, outline, chapters } = bundle;
  const bookId = manifest.id;

  useEffect(() => {
    void loadExclusions(bookId);
    void loadTodos(bookId);
    void loadProposals(bookId);
    void loadCompleteness(bookId);
  }, [bookId, loadExclusions, loadTodos, loadProposals, loadCompleteness]);

  const openTodos = todos.filter((t) => t.status === 'open' || t.status === 'questionsSent');

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

      {chapters.length > 0 ? (
        <CoverPanel
          bookId={bookId}
          {...(manifest.coverImageId ? { coverImageId: manifest.coverImageId } : {})}
        />
      ) : null}

      {chapters.length > 0 ? <PhotosPanel bookId={bookId} /> : null}

      {completeness && chapters.length > 0 ? <CompletenessMeter c={completeness} /> : null}

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {refreshNotice ? <Banner tone="info">{refreshNotice}</Banner> : null}

      {chapters.length > 0 ? (
        <Inline>
          <Button
            disabled={busy}
            onClick={async () => {
              setError(null);
              setRefreshNotice(null);
              const res = await refreshBook(manifest.id, { auto: false });
              // The pass may have filed structural proposals — reload the panel so they appear.
              await loadProposals(manifest.id);
              const bits: string[] = [];
              if (res.rewritten > 0)
                bits.push(
                  `Brought ${res.rewritten} chapter${res.rewritten === 1 ? '' : 's'} up to date with what’s new.`,
                );
              else if (res.staled > 0)
                bits.push(
                  `${res.staled} chapter${res.staled === 1 ? ' has' : 's have'} new material to fold in — turn on AI to update ${res.staled === 1 ? 'it' : 'them'}.`,
                );
              if (res.proposalsAdded)
                bits.push(
                  `${res.proposalsAdded} suggested change${res.proposalsAdded === 1 ? '' : 's'} to review below.`,
                );
              setRefreshNotice(bits.length > 0 ? bits.join(' ') : 'Your story is up to date.');
            }}
          >
            {busy ? 'Checking…' : 'Refresh from what’s new'}
          </Button>
          <Button
            variant="ghost"
            disabled={interviewBusy}
            onClick={async () => {
              setError(null);
              setRefreshNotice(null);
              setInterviewBusy(true);
              try {
                const res = await runInterviewCheck(manifest.id);
                setRefreshNotice(
                  res.outcome === 'minted'
                    ? 'Your biographer sent a few questions to your Inbox to fill a gap.'
                    : res.outcome === 'openCheckin'
                      ? 'You already have questions from your biographer waiting in your Inbox.'
                      : res.outcome === 'noGaps'
                        ? 'Nothing new to ask right now — your story is well covered.'
                        : 'No new questions right now — check back later.',
                );
              } finally {
                setInterviewBusy(false);
              }
            }}
          >
            {interviewBusy ? 'Looking…' : 'Find what’s missing'}
          </Button>
        </Inline>
      ) : null}

      {proposals.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={2}>Suggested changes</Heading>
            <Text tone="secondary" size="sm">
              Your biographer thinks the book’s shape could change. Nothing happens until you
              approve — a new or split chapter is written on your next refresh.
            </Text>
            {proposals.map((p) => (
              <div key={p.id} className={styles.markRow}>
                <Stack gap={1}>
                  <Text size="sm" className={styles.rowTitle}>
                    {proposalSummary(p)}
                  </Text>
                  {p.rationale ? (
                    <Text size="sm" tone="secondary">
                      {p.rationale}
                    </Text>
                  ) : null}
                </Stack>
                <Inline gap={1}>
                  <button
                    type="button"
                    className={styles.sourcesToggle}
                    onClick={async () => {
                      setError(null);
                      const r = await resolveProposal(bookId, p.id, 'approve');
                      if (!r.ok && r.message) setError(r.message);
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={styles.sourcesToggle}
                    aria-label="Dismiss this suggestion"
                    onClick={() => void resolveProposal(bookId, p.id, 'dismiss')}
                  >
                    Dismiss
                  </button>
                </Inline>
              </div>
            ))}
          </Stack>
        </Card>
      ) : null}

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
                  // An approved structural proposal leaves an un-written shell (empty markdown, status stale)
                  // that the next refresh drafts — show it as "Not yet written", not a clickable blank chapter.
                  const written = chapters.find(
                    (c) => c.id === chapter.id && c.markdown.trim().length > 0,
                  );
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

      {openTodos.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={2}>To do</Heading>
            {openTodos.map((t) => (
              <div key={t.id} className={styles.markRow}>
                <Text size="sm">
                  {TODO_KIND_LABEL[t.kind] ?? 'To-do'}: {t.text}
                </Text>
                {t.kind === 'remind' && t.status === 'open' ? (
                  <button
                    type="button"
                    className={styles.sourcesToggle}
                    onClick={async () => {
                      await updateMark(bookId, t.chapterId, t.id, { status: 'done' });
                      await loadTodos(bookId);
                    }}
                  >
                    Mark done
                  </button>
                ) : (
                  <Text size="sm" tone="secondary">
                    {t.status === 'questionsSent'
                      ? 'Questions sent'
                      : 'Folds into your next revision'}
                  </Text>
                )}
              </div>
            ))}
          </Stack>
        </Card>
      ) : null}

      {exclusions.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={2}>Never written about</Heading>
            <Text tone="secondary" size="sm">
              Things you’ve asked your biographer to leave out. They won’t appear in future
              chapters.
            </Text>
            {exclusions.map((item) => {
              // A `source` exclusion's `value` is a cryptic ref id; show its friendly `note` label instead.
              const label = item.note ?? item.value;
              return (
                <div key={item.id} className={styles.markRow}>
                  <Text size="sm">{label}</Text>
                  <button
                    type="button"
                    className={styles.sourcesToggle}
                    aria-label={`Allow writing about ${label} again`}
                    onClick={() => void unexclude(bookId, item.id)}
                  >
                    Allow again
                  </button>
                </div>
              );
            })}
          </Stack>
        </Card>
      ) : null}

      {chapters.length > 0 ? (
        <>
          <MatterEditor bookId={bookId} {...(manifest.matter ? { matter: manifest.matter } : {})} />
          <ShareReadersPanel
            bookId={bookId}
            authorPersonId={manifest.personId}
            {...(manifest.publishedAt ? { publishedAt: manifest.publishedAt } : {})}
          />
        </>
      ) : null}

      <SharedWithYou />

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

/** The "Share & readers" panel (§3.5): publish (Reviewed chapters → the published head) + grant/revoke readers.
 *  Readers never see the working draft — only what's been marked "Looks good". */
function ShareReadersPanel({
  bookId,
  publishedAt,
  authorPersonId,
}: {
  bookId: string;
  publishedAt?: string;
  authorPersonId: string;
}): JSX.Element {
  const publish = useStoryStore((s) => s.publish);
  const exportMarkdown = useStoryStore((s) => s.exportMarkdown);
  const exportPdf = useStoryStore((s) => s.exportPdf);
  const readers = useStoryStore((s) => s.readers);
  const loadReaders = useStoryStore((s) => s.loadReaders);
  const grantReader = useStoryStore((s) => s.grantReader);
  const revokeReader = useStoryStore((s) => s.revokeReader);
  const readerFeatured = useStoryStore((s) => s.readerFeatured);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState('');
  const [featured, setFeatured] = useState(false);

  useEffect(() => {
    void loadReaders(bookId);
    void loadPeople();
  }, [bookId, loadReaders, loadPeople]);

  const readerIds = new Set(readers.map((r) => r.personId));
  const candidates = people.filter((p) => p.id !== authorPersonId && !readerIds.has(p.id));
  const candidateName = people.find((p) => p.id === candidate)?.displayName ?? '';

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Share &amp; readers</Heading>
        <Text tone="secondary" size="sm">
          Readers see only the chapters you’ve marked “Looks good” — never your working draft.
          Sharing updates re-publishes those chapters.
        </Text>
        {notice ? <Banner tone="info">{notice}</Banner> : null}
        <Inline>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNotice(null);
              const res = await publish(bookId);
              setNotice(
                res.ok
                  ? `Shared ${res.publishedChapters} chapter${res.publishedChapters === 1 ? '' : 's'} with your readers.`
                  : res.message,
              );
              setBusy(false);
            }}
          >
            {busy ? 'Sharing…' : publishedAt ? 'Share updates' : 'Publish & choose readers'}
          </Button>
          {publishedAt ? (
            <>
              <Button
                variant="ghost"
                onClick={async () => {
                  setNotice(null);
                  const path = await exportMarkdown(bookId);
                  if (path) setNotice(`Saved to ${path} — this file leaves your encrypted vault.`);
                }}
              >
                Export as Markdown
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  setNotice(null);
                  const path = await exportPdf(bookId);
                  if (path) setNotice(`Saved to ${path} — this file leaves your encrypted vault.`);
                }}
              >
                Export as PDF
              </Button>
              <Text tone="secondary" size="sm">
                Last shared {new Date(publishedAt).toLocaleDateString()}
              </Text>
            </>
          ) : (
            <Text tone="secondary" size="sm">
              Share your story to export it.
            </Text>
          )}
        </Inline>

        {readers.length > 0 ? (
          <Stack gap={1}>
            {readers.map((r) => (
              <div key={r.personId} className={styles.markRow}>
                <Text size="sm">{r.displayName}</Text>
                <button
                  type="button"
                  className={styles.sourcesToggle}
                  aria-label={`Remove ${r.displayName} as a reader`}
                  onClick={() => void revokeReader(bookId, r.personId)}
                >
                  Remove
                </button>
              </div>
            ))}
          </Stack>
        ) : null}

        {candidates.length > 0 ? (
          <Stack gap={1}>
            <Inline>
              <Select
                value={candidate}
                aria-label="Add a reader"
                onChange={async (e) => {
                  const id = e.target.value;
                  setCandidate(id);
                  setFeatured(id ? await readerFeatured(bookId, id) : false);
                }}
              >
                <option value="">Add a reader…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                disabled={!candidate}
                onClick={async () => {
                  await grantReader(bookId, candidate);
                  setCandidate('');
                  setFeatured(false);
                }}
              >
                Add as reader
              </Button>
            </Inline>
            {featured && candidateName ? (
              <Text tone="secondary" size="sm">
                {candidateName} appears in this book — they’ll be able to read what you’ve written
                about them.
              </Text>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

/** The front/back matter editor (§3.6) — the person's own dedication, epigraph, and acknowledgments. */
function MatterEditor({ bookId, matter }: { bookId: string; matter?: BookMatter }): JSX.Element {
  const update = useStoryStore((s) => s.update);
  const [dedication, setDedication] = useState(matter?.dedication ?? '');
  const [epigraph, setEpigraph] = useState(matter?.epigraph ?? '');
  const [acknowledgments, setAcknowledgments] = useState(matter?.acknowledgments ?? '');
  const [saved, setSaved] = useState(false);
  const touch = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setSaved(false);
  };
  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Dedication &amp; acknowledgments</Heading>
        <Text tone="secondary" size="sm">
          Your own words for the opening and closing pages — added to what readers see. Optional.
        </Text>
        <Field label="Dedication">
          {(p) => (
            <Textarea
              {...p}
              value={dedication}
              rows={2}
              placeholder="For…"
              onChange={(e) => touch(setDedication)(e.target.value)}
            />
          )}
        </Field>
        <Field label="Epigraph">
          {(p) => (
            <Textarea
              {...p}
              value={epigraph}
              rows={2}
              placeholder="A line or quote to open with…"
              onChange={(e) => touch(setEpigraph)(e.target.value)}
            />
          )}
        </Field>
        <Field label="Acknowledgments">
          {(p) => (
            <Textarea
              {...p}
              value={acknowledgments}
              rows={3}
              placeholder="With thanks to…"
              onChange={(e) => touch(setAcknowledgments)(e.target.value)}
            />
          )}
        </Field>
        <Inline>
          <Button
            onClick={async () => {
              await update(bookId, {
                matter: {
                  ...(dedication.trim() ? { dedication: dedication.trim() } : {}),
                  ...(epigraph.trim() ? { epigraph: epigraph.trim() } : {}),
                  ...(acknowledgments.trim() ? { acknowledgments: acknowledgments.trim() } : {}),
                },
              });
              setSaved(true);
            }}
          >
            Save
          </Button>
          {saved ? (
            <Text tone="secondary" size="sm">
              Saved.
            </Text>
          ) : null}
        </Inline>
      </Stack>
    </Card>
  );
}

/** The completeness stage → a warm label (§3.6, owner decision: a qualitative stage + a subtle bar, never a %). */
const COMPLETENESS_STAGE: Record<StoryCompletenessStage, string> = {
  beginning: 'Just beginning',
  takingShape: 'Taking shape',
  comingTogether: 'Coming together',
  richlyTold: 'Richly told',
};

/** The "Shared with you" section (§3.5) — books others have published to the active person. Self-hides when
 *  empty; opening a card reads the published head (never the author's draft). */
function SharedWithYou(): JSX.Element | null {
  const sharedBooks = useStoryStore((s) => s.sharedBooks);
  const loadSharedBooks = useStoryStore((s) => s.loadSharedBooks);
  const openSharedBook = useStoryStore((s) => s.openSharedBook);
  useEffect(() => {
    void loadSharedBooks();
  }, [loadSharedBooks]);
  if (sharedBooks.length === 0) return null;
  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Shared with you</Heading>
        {sharedBooks.map((b) => (
          <button
            key={`${b.authorPersonId}:${b.bookId}`}
            type="button"
            className={styles.chapterLink}
            onClick={() => void openSharedBook(b.authorPersonId, b.bookId)}
          >
            <Stack gap={1}>
              <Text className={styles.rowTitle}>{b.title}</Text>
              <Text tone="secondary" size="sm">
                By {b.authorName} · {b.chapterCount} chapter{b.chapterCount === 1 ? '' : 's'}
              </Text>
            </Stack>
            <Text tone="secondary" size="sm">
              Read ›
            </Text>
          </button>
        ))}
      </Stack>
    </Card>
  );
}

/** The reader view (§3.6) — a granted reader reads a book's PUBLISHED head: cover → front matter → contents →
 *  parts/chapters (read-only, typography-first) → back matter + the "A Note on this book" honesty page. */
function SharedReaderView({
  view,
  onBack,
}: {
  view: StoryReaderView;
  onBack: () => void;
}): JSX.Element {
  const { manifest, chapters, authorName } = view;
  const chapterById = new Map(chapters.map((c) => [c.id, c]));
  return (
    <Stack gap={4}>
      <Inline>
        <button type="button" className={styles.sourcesToggle} onClick={onBack}>
          ‹ Back
        </button>
      </Inline>
      <div className={styles.readerView}>
        <div className={styles.coverPage}>
          <Heading level={1}>{manifest.title}</Heading>
          <Text tone="secondary">by {authorName}</Text>
        </div>

        {manifest.matter?.dedication ? (
          <p className={styles.dedication}>
            <em>{manifest.matter.dedication}</em>
          </p>
        ) : null}
        {manifest.matter?.epigraph ? (
          <blockquote className={styles.epigraph}>{manifest.matter.epigraph}</blockquote>
        ) : null}

        {manifest.parts.length > 0 ? (
          <nav className={styles.toc} aria-label="Contents">
            <Heading level={3}>Contents</Heading>
            {manifest.parts.map((part) => (
              <Stack key={part.id} gap={1}>
                <Text size="sm" tone="secondary">
                  {part.title}
                </Text>
                {part.chapterIds.map((id) => {
                  const c = chapterById.get(id);
                  return c ? (
                    <Text key={id} size="sm">
                      {c.title}
                    </Text>
                  ) : null;
                })}
              </Stack>
            ))}
          </nav>
        ) : null}

        {manifest.parts.map((part) => (
          <section key={part.id}>
            <Heading level={2}>{part.title}</Heading>
            {part.chapterIds.map((id) => {
              const c = chapterById.get(id);
              if (!c) return null;
              return (
                <article key={id} className={styles.readerChapter}>
                  <Heading level={3}>{c.title}</Heading>
                  <Markdown>{c.markdown}</Markdown>
                </article>
              );
            })}
          </section>
        ))}

        {manifest.matter?.acknowledgments ? (
          <section className={styles.backMatter}>
            <Heading level={3}>Acknowledgments</Heading>
            <Markdown>{manifest.matter.acknowledgments}</Markdown>
          </section>
        ) : null}
        {manifest.noteOnBook ? (
          <section className={styles.backMatter}>
            <Heading level={3}>A note on this book</Heading>
            <Text tone="secondary" size="sm">
              {manifest.noteOnBook}
            </Text>
          </section>
        ) : null}
      </div>
    </Stack>
  );
}

/** How far along the story is — a warm stage label + a quiet progress bar (never a bare percentage). */
function CompletenessMeter({ c }: { c: StoryCompleteness }): JSX.Element {
  const label = COMPLETENESS_STAGE[c.stage];
  const pct = Math.round(c.ratio * 100);
  return (
    <div className={styles.completeness}>
      <Inline justify="space-between">
        <Text size="sm" className={styles.rowTitle}>
          Your story so far
        </Text>
        <Text size="sm" tone="secondary">
          {label}
        </Text>
      </Inline>
      <div
        className={styles.meterTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={label}
        aria-label={`Your story is ${label.toLowerCase()}`}
      >
        <div className={styles.meterFill} style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
    </div>
  );
}

/** A one-line, human-readable summary of what a structural proposal would do (the rationale is shown beneath). */
function proposalSummary(p: StructuralProposal): string {
  switch (p.kind) {
    case 'newChapter':
      return `Add a new chapter: “${p.title}”`;
    case 'splitChapter':
      return `Split a chapter into “${p.firstTitle}” and “${p.secondTitle}”`;
    case 'reorder':
      return 'Reorder the chapters in a part';
    case 'prologueRewrite':
      return 'Rewrite the opening chapter';
  }
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

// The to-do kinds the reader creates: a personal reminder, an instruction to fold into the next revision, or
// "turn into questions" (mint a story check-in into the Inbox — an explicit, metered AI action).
type ReaderTodoKind = 'remind' | 'ask' | 'questions';
const TODO_KIND_OPTIONS: SegmentOption<ReaderTodoKind>[] = [
  { value: 'remind', label: 'Remind me' },
  { value: 'ask', label: 'Ask my biographer' },
  { value: 'questions', label: 'Turn into questions' },
];
const TODO_KIND_LABEL: Record<string, string> = {
  remind: 'Reminder',
  ask: 'For your biographer',
  questions: 'Turned into questions',
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
  const updateMark = useStoryStore((s) => s.updateMark);
  const flagInsight = useStoryStore((s) => s.flagInsight);
  const applyMarkup = useStoryStore((s) => s.applyMarkup);
  const editPassage = useStoryStore((s) => s.editPassage);
  const pinQuote = useStoryStore((s) => s.pinQuote);
  const todoToQuestions = useStoryStore((s) => s.todoToQuestions);
  const exclude = useStoryStore((s) => s.exclude);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openSources, setOpenSources] = useState<number | null>(null);
  const [activePara, setActivePara] = useState<number | null>(null);
  const [activeQuote, setActiveQuote] = useState<string | null>(null);
  const [mode, setMode] = useState<'menu' | 'comment' | 'edit' | 'exclude' | 'todo' | null>(null);
  const [commentIntent, setCommentIntent] = useState<CommentIntent>('addContext');
  const [todoKind, setTodoKind] = useState<ReaderTodoKind>('remind');
  const [flagSource, setFlagSource] = useState(false);
  const [draft, setDraft] = useState('');

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
      {notice ? <Banner tone="info">{notice}</Banner> : null}

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
                (m.kind === 'comment' && m.status === 'open') ||
                (m.kind === 'todo' && m.status === 'open')),
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
                      ) : m.kind === 'todo' ? (
                        <Text size="sm" tone="secondary">
                          ☐ {TODO_KIND_LABEL[m.todoKind] ?? 'To-do'}: {m.text}
                        </Text>
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
                          Never write about this again. It won’t appear in future chapters, and any
                          chapter that already mentions it is marked to rewrite.
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
