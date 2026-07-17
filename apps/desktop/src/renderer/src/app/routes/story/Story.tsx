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
import { downscaleImage } from '../sessions/downscaleImage';
import { AdminOnlyBadge } from '../../../design-system/components';
import type {
  BookConfig,
  ChapterMarkup,
  BookMatter,
  CommentIntent,
  StoryBookBundle,
  StoryCompleteness,
  StoryCompletenessStage,
  StoryDraftProgress,
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
// Styles have grown past what a SegmentedControl can hold at phone width (§12 — no horizontal scroll), so the
// style picker is a full-width Select with a one-line hint for the chosen register.
const STYLE_CHOICES: { value: Style; label: string; hint: string }[] = [
  { value: 'literary', label: 'Literary', hint: 'Vivid, image-led prose with deliberate rhythm.' },
  { value: 'warm', label: 'Warm', hint: 'Plain, tender, dinner-table narration.' },
  { value: 'plain', label: 'Plain', hint: 'Direct, unadorned, concrete; short sentences.' },
  {
    value: 'journalistic',
    label: 'Journalistic',
    hint: 'Reportorial and evidence-led; clear and propulsive.',
  },
  {
    value: 'reflective',
    label: 'Reflective',
    hint: 'Essayistic and meditative; interior and thoughtful.',
  },
  {
    value: 'cinematic',
    label: 'Cinematic',
    hint: 'Scene-forward and dramatic; vivid set-pieces.',
  },
  { value: 'poetic', label: 'Poetic', hint: 'Lyrical and image-dense; heightened rhythm.' },
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
  const progress = useStoryStore((s) => s.progress);
  const load = useStoryStore((s) => s.load);
  const open = useStoryStore((s) => s.open);
  const createAndDraft = useStoryStore((s) => s.createAndDraft);
  const draftBook = useStoryStore((s) => s.draftBook);
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

  // Open the first book once loaded so returning lands on it — but never while a draft is running (so it
  // can't race the create → draft sequence or open a book into a dead-end mid-generation).
  useEffect(() => {
    const first = books[0];
    if (loaded && first && !bundle && !progress) void open(first.id);
  }, [loaded, books, bundle, progress, open]);

  if (!loaded) return <div className={styles.page} aria-busy="true" />;

  // Reading a book someone shared with you takes over the surface (the published head, read-only).
  if (readerView) {
    return (
      <div className={styles.page}>
        <SharedReaderView view={readerView} onBack={closeSharedBook} />
      </div>
    );
  }

  // A create-and-draft is in progress (§3.2) — the rich, full-screen writing screen (no book to show yet).
  // It survives navigation (the draft runs in main; the progress stream keeps this current). The
  // chapter-write from the overview (`scope: 'chapters'`) shows the SAME progress inline instead (below).
  if (progress && progress.scope === 'create') {
    return (
      <div className={styles.page}>
        <DraftProgress p={progress} />
      </div>
    );
  }

  if (bundle) {
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
    // A book exists but has no outline yet — a draft that hasn't run, or one that failed. Offer to draft (or
    // retry) it, and surface any error, so it's never a silent dead-end.
    return (
      <div className={styles.page}>
        <NeedsOutline
          bundle={bundle}
          error={error}
          onGenerate={async () => {
            setError(null);
            const res = await draftBook(bundle.manifest.id);
            if (!res.ok && res.message) setError(res.message);
          }}
        />
      </div>
    );
  }

  if (mode === 'setup') {
    return (
      <div className={styles.page}>
        <StorySetup
          titleHint={personName ? `e.g. The Story of ${personName}` : 'e.g. The Story of a Life'}
          onCancel={() => setMode('idle')}
          onCreate={async (title, config) => {
            setError(null);
            setMode('idle');
            // Create AND draft the whole book in one flow — no outline-review gate. The draft screen shows
            // immediately (progress is seeded), and the finished book lands ready to edit.
            const res = await createAndDraft({ type: 'biography', title, config });
            if (!res.ok && res.message) setError(res.message);
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
  titleHint,
  onCreate,
  onCancel,
}: {
  titleHint: string;
  onCreate: (title: string, config: BookConfig) => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [voice, setVoice] = useState<Voice>('third');
  const [style, setStyle] = useState<Style>('warm');
  const [length, setLength] = useState<Length>('full');
  const styleHint = STYLE_CHOICES.find((s) => s.value === style)?.hint ?? '';

  return (
    <Card>
      <Stack gap={4}>
        <Stack gap={2}>
          <Heading level={2}>Start your story</Heading>
          <Text tone="secondary">
            Your biographer reads everything it knows about you unless you exclude it later. Choose
            how it should read — you can leave the title to your biographer.
          </Text>
        </Stack>
        <Labeled label="Title (optional)">
          <Stack gap={1}>
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Title"
              placeholder={titleHint}
            />
            <Text size="sm" tone="secondary">
              Leave blank and your biographer will suggest a title from your story — you can rename
              it before it starts writing.
            </Text>
          </Stack>
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
          <Stack gap={1}>
            <Select
              value={style}
              aria-label="Style"
              onChange={(e) => setStyle(e.target.value as Style)}
            >
              {STYLE_CHOICES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            {styleHint ? (
              <Text size="sm" tone="secondary">
                {styleHint}
              </Text>
            ) : null}
          </Stack>
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

/** mm:ss for a millisecond duration. */
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A soft "about N left" from the observed pace (only once ≥1 chapter is done, so it's real, not guessed). */
function estimateRemaining(elapsedMs: number, done: number, total: number): string | null {
  if (done < 1 || total <= done) return null;
  const perChapter = elapsedMs / done;
  const leftSec = Math.round((perChapter * (total - done)) / 1000);
  if (leftSec <= 15) return 'almost done';
  if (leftSec < 90) return `about ${leftSec} sec left`;
  return `about ${Math.round(leftSec / 60)} min left`;
}

/**
 * The create-and-draft progress screen (§3.2) — real per-chapter progress with a live timer + estimate, and a
 * clear "you can keep working, this continues in the background" note. Driven by the store's `progress` (which
 * is fed by the main-side stream and survives navigation), so returning to /story mid-draft shows live status.
 */
function DraftProgress({ p }: { p: StoryDraftProgress & { startedAt: number } }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const writing = p.phase === 'writing';
  const total = p.chaptersTotal;
  const done = p.chaptersDone;
  const elapsed = now - p.startedAt;
  const pct = writing && total > 0 ? Math.min(99, 15 + (done / total) * 84) : 8;
  const eta = writing ? estimateRemaining(elapsed, done, total) : null;
  const phaseLabel = writing
    ? p.currentTitle
      ? `Writing “${p.currentTitle}” — chapter ${Math.min(done + 1, total)} of ${total}`
      : `Writing your chapters — ${done} of ${total}`
    : 'Reading everything you’ve shared, and shaping the outline…';

  return (
    <Card>
      <Stack gap={4}>
        <Inline gap={3}>
          <div className={styles.draftIcon} aria-hidden="true">
            <span className={styles.draftSpinner} />
          </div>
          <Stack gap={1}>
            <Heading level={2}>Writing your story</Heading>
            <Text tone="secondary" size="sm" aria-live="polite">
              {phaseLabel}
            </Text>
          </Stack>
        </Inline>

        <Stack gap={2}>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(writing && total > 0 ? { 'aria-valuenow': Math.round(pct) } : {})}
            aria-label="Writing progress"
          >
            <div
              className={writing ? styles.progressFill : styles.progressIndeterminate}
              style={writing ? { width: `${pct}%` } : undefined}
            />
          </div>
          <Inline justify="space-between">
            <Text size="sm" tone="secondary">
              {fmtDuration(elapsed)} elapsed
            </Text>
            <Text size="sm" tone="secondary">
              {eta ?? (writing ? 'estimating…' : 'this takes a moment')}
            </Text>
          </Inline>
          {writing && total > 0 ? (
            <div className={styles.progressDots} aria-hidden="true">
              {Array.from({ length: total }, (_, i) => (
                <span
                  key={i}
                  className={
                    i < done
                      ? `${styles.dot} ${styles.dotDone}`
                      : i === done
                        ? `${styles.dot} ${styles.dotCurrent}`
                        : styles.dot
                  }
                />
              ))}
            </div>
          ) : null}
        </Stack>

        <div className={styles.draftNote}>
          <Text size="sm">
            You can keep using SelfOS — your biographer keeps writing in the background. We’ll have
            your book ready when you come back.
          </Text>
        </div>
      </Stack>
    </Card>
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
  const generateImage = useStoryStore((s) => s.generateImage);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const deleteImage = useStoryStore((s) => s.deleteImage);

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

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    // No per-image style — every image uses the single global style (Settings → Images, §3.8).
    const res = await generateImage(bookId, { kind: 'cover' });
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
              ? 'Turn on AI image generation and add your OpenAI key in Settings → Images to create a cover.'
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
  const update = useStoryStore((s) => s.update);
  const progress = useStoryStore((s) => s.progress);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [interviewBusy, setInterviewBusy] = useState(false);
  const { manifest, outline, chapters } = bundle;
  const bookId = manifest.id;
  const [titleDraft, setTitleDraft] = useState<string | null>(null); // non-null while renaming

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
  // A chapter-write in progress for THIS book → show the rich progress inline (narrowed non-null for the JSX).
  const chapterProgress =
    progress && progress.scope === 'chapters' && progress.bookId === bookId ? progress : null;

  return (
    <Stack gap={4}>
      <Inline justify="space-between">
        {titleDraft === null ? (
          <Inline gap={2}>
            <Heading level={1}>{manifest.title}</Heading>
            <button
              type="button"
              className={styles.sourcesToggle}
              aria-label="Rename this book"
              onClick={() => setTitleDraft(manifest.title)}
            >
              Rename
            </button>
          </Inline>
        ) : (
          <Inline gap={2}>
            <div className={styles.grow}>
              <TextInput
                value={titleDraft}
                aria-label="Book title"
                onChange={(e) => setTitleDraft(e.target.value)}
              />
            </div>
            <Button
              variant="primary"
              disabled={titleDraft.trim().length === 0}
              onClick={async () => {
                const next = titleDraft.trim();
                if (next && next !== manifest.title) await update(bookId, { title: next });
                setTitleDraft(null);
              }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setTitleDraft(null)}>
              Cancel
            </Button>
          </Inline>
        )}
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

      {chapterProgress ? (
        // The same rich, real-time progress as create-and-draft, shown INLINE here (keeps the overview in
        // view; §3.2). Driven by the store's `progress`, streamed from main, so it continues if you leave.
        <DraftProgress p={chapterProgress} />
      ) : pending > 0 ? (
        <Inline>
          <Button
            variant="primary"
            onClick={async () => {
              setError(null);
              const res = await generateChapters(manifest.id);
              if (!res.ok) setError(res.message);
              else if (res.budgetReached && res.message) setError(res.message);
            }}
          >
            {chapters.length > 0
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
              <Inline gap={2}>
                <Text className={styles.rowTitle}>{b.title}</Text>
                {b.updated ? (
                  <span className={styles.newBadge}>{b.neverOpened ? 'New' : 'Updated'}</span>
                ) : null}
              </Inline>
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
  const { manifest, chapters, authorName, authorPersonId, bookId } = view;
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  // Fetch the published image bytes as data URLs (re-gated per read), keyed by image id.
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const needed = new Set<string>();
    if (manifest.coverImageId) needed.add(manifest.coverImageId);
    for (const c of chapters) for (const pl of c.imagePlacements) needed.add(pl.imageId);
    let cancelled = false;
    void (async () => {
      for (const imageId of needed) {
        const img = await window.selfos?.storyReadSharedImage({ authorPersonId, bookId, imageId });
        if (!cancelled && img) {
          setUrls((u) => ({ ...u, [imageId]: `data:${img.mime};base64,${img.dataBase64}` }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorPersonId, bookId, manifest.coverImageId, chapters]);

  return (
    <Stack gap={4}>
      <Inline>
        <button type="button" className={styles.sourcesToggle} onClick={onBack}>
          ‹ Back
        </button>
      </Inline>
      <div className={styles.readerView}>
        <div className={styles.coverPage}>
          {manifest.coverImageId && urls[manifest.coverImageId] ? (
            <img className={styles.coverImage} src={urls[manifest.coverImageId]} alt="Cover" />
          ) : null}
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
              const paras = splitParagraphs(c.markdown);
              return (
                <article key={id} className={styles.readerChapter}>
                  <Heading level={3}>{c.title}</Heading>
                  {paras.map((para, pi) => (
                    <div key={pi}>
                      <Markdown>{para}</Markdown>
                      {c.imagePlacements
                        .filter((pl) => pl.afterAnchor === `p${pi}`)
                        .map((pl) =>
                          urls[pl.imageId] ? (
                            <figure key={pl.imageId} className={styles.placedImage}>
                              <img src={urls[pl.imageId]} alt={pl.caption || 'Book image'} />
                              {pl.caption ? <figcaption>{pl.caption}</figcaption> : null}
                            </figure>
                          ) : null,
                        )}
                    </div>
                  ))}
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
  const [imageConsent] = useSetting('dreams.imageGenerationEnabled');
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasImageKey, setHasImageKey] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
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

  useEffect(() => {
    void loadImages(bookId);
  }, [bookId, loadImages]);

  useEffect(() => {
    void (async () => setHasImageKey(Boolean(await aiKeyResolved('openai'))))();
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
    setImageError(null);
    // No per-image style — every image uses the single global style (Settings → Images, §3.8).
    const res = await generateImage(bookId, { kind: 'illustration', chapterId });
    if (res.ok) await placeImage(res.image.id);
    else setImageError(res.message);
    setImageBusy(false);
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
          );
        })}
      </Stack>

      {/* Images in this chapter (§3.8) — illustrate or place an existing photo/illustration; the AI suggests
          where it fits, and you can move it. */}
      <Card>
        <Stack gap={2}>
          <Heading level={3}>Images</Heading>
          {imageError ? <Banner tone="danger">{imageError}</Banner> : null}
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
          {!imagesReady ? (
            <Text tone="secondary" size="sm">
              {canManageAi
                ? 'Turn on AI image generation and add your OpenAI key in Settings → Images to illustrate this chapter.'
                : 'Ask the person who set up this household to turn on AI image generation.'}
            </Text>
          ) : null}
        </Stack>
      </Card>

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
