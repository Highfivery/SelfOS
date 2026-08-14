import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
} from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import { OutlineEditor } from './OutlineEditor';
import styles from './Story.module.css';
import { TimelinePanel } from './TimelinePanel';
import { manuscriptMetrics } from '@selfos/core/story-metrics';
import { useEffect, useState } from 'react';
import type { ContinuityFinding, StoryBookBundle, StoryDraftProgress } from '@shared/schemas';
import { DraftProgress } from './DraftProgress';
import { chapterBadge, coverPosition, partLabel } from './chapterDisplay';

/** What each review finding is about, in the author's language. Two passes write into one list — the
 *  continuity check (names/dates/facts) and the whole-book manuscript read (72 §5.3) — so the kind is what
 *  tells them apart at a glance. */
export const FINDING_KIND_LABEL: Record<ContinuityFinding['kind'], string> = {
  name: 'Name',
  date: 'Date',
  fact: 'Fact',
  repetition: 'Repetition',
  pacing: 'Pacing',
  arc: 'Arc',
  voice: 'Voice',
  other: 'Note',
};
/** The Chapters tab: the cover-backed card grid grouped by part, the "write the remaining N" bar rendered
 *  inside the part that owns the unwritten shells, and the inline write-progress. */
export function ChaptersTab({
  bundle,
  chapterProgress,
  pending,
  onOpenChapter,
  onWrite,
}: {
  bundle: StoryBookBundle;
  chapterProgress: (StoryDraftProgress & { startedAt: number }) | null;
  pending: number;
  onOpenChapter: (chapterId: string) => void;
  onWrite: () => void | Promise<void>;
}): JSX.Element {
  const imageUrls = useStoryStore((s) => s.imageUrls);
  const { manifest, outline, chapters } = bundle;
  const bookId = manifest.id;
  const outlineChapters = outline ? outline.parts.flatMap((p) => p.chapters) : [];
  // Manual outline control (§16.1) — the structure is the author's, not only the model's.
  const [editingOutline, setEditingOutline] = useState(false);
  // Cross-chapter continuity (§17.3) — a metered check that surfaces name/date/fact conflicts as review items.
  const continuity = useStoryStore((s) => s.continuity);
  const loadContinuity = useStoryStore((s) => s.loadContinuity);
  const runContinuity = useStoryStore((s) => s.checkContinuity);
  const runManuscript = useStoryStore((s) => s.readManuscript);
  const resolveContinuity = useStoryStore((s) => s.resolveContinuity);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  const [continuityNote, setContinuityNote] = useState<string | null>(null);
  useEffect(() => {
    void loadContinuity(bookId);
  }, [bookId, loadContinuity]);
  const writtenCount = chapters.filter((c) => c.markdown.trim().length > 0).length;

  if (!outline) return <div />;
  if (editingOutline) {
    return <OutlineEditor bundle={bundle} onDone={() => setEditingOutline(false)} />;
  }
  const firstUnwrittenPart = outline.parts.findIndex((p) =>
    p.chapters.some((c) => !chapters.some((w) => w.id === c.id && w.markdown.trim().length > 0)),
  );
  // Per-chapter length + pacing (§16.5) — keyed by id so each card reads its own share/outlier.
  const metricById = new Map(manuscriptMetrics(chapters).chapters.map((m) => [m.id, m]));

  return (
    <Stack gap={5}>
      <div className={styles.outlineEditBar}>
        <Button variant="ghost" onClick={() => setEditingOutline(true)}>
          Edit outline
        </Button>
        {writtenCount >= 2 ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setContinuityNote(null);
              const res = await runContinuity(bookId);
              if (!res.ok) setContinuityNote(res.message ?? 'The continuity check couldn’t run.');
              else if (res.findings.length === 0)
                setContinuityNote('No continuity issues found — your names and dates line up.');
            }}
          >
            {busy ? 'Checking…' : 'Check continuity'}
          </Button>
        ) : null}
        {/* The manuscript pass (72 §5.3) — the whole-book read for what no single chapter can show. */}
        {writtenCount >= 2 ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setContinuityNote(null);
              const res = await runManuscript(bookId);
              if (!res.ok) setContinuityNote(res.message ?? 'The manuscript read couldn’t run.');
              else if (res.findings.length === 0)
                setContinuityNote('Nothing to flag — it holds together as a whole.');
            }}
          >
            {busy ? 'Reading…' : 'Read the whole book'}
          </Button>
        ) : null}
      </div>
      {continuityNote ? <Banner tone="info">{continuityNote}</Banner> : null}
      {continuity.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={2}>Things to review</Heading>
            <Text tone="secondary" size="sm">
              Names, dates and facts that don’t line up, and what a whole-book read turned up. Fix
              them in the chapters, then mark each one done — nothing is changed for you.
            </Text>
            {continuity.map((f) => (
              <div key={f.id} className={styles.continuityRow}>
                <Text size="sm">
                  <Text as="span" tone="tertiary" size="sm">
                    {FINDING_KIND_LABEL[f.kind]} ·{' '}
                  </Text>
                  <strong>{f.summary}</strong>
                  {f.chapters.length > 0 ? (
                    <Text tone="tertiary" size="sm">
                      {f.chapters.join(' · ')}
                    </Text>
                  ) : null}
                </Text>
                <Inline gap={1}>
                  <Button
                    variant="ghost"
                    onClick={() => void resolveContinuity(bookId, f.id, 'resolve')}
                  >
                    Mark fixed
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void resolveContinuity(bookId, f.id, 'dismiss')}
                  >
                    Dismiss
                  </Button>
                </Inline>
              </div>
            ))}
          </Stack>
        </Card>
      ) : null}
      {outline.parts.map((part, pi) => {
        const partWritten = part.chapters.filter((c) =>
          chapters.some((w) => w.id === c.id && w.markdown.trim().length > 0),
        ).length;
        const partReviewed = part.chapters.filter((c) =>
          chapters.some((w) => w.id === c.id && w.status === 'reviewed'),
        ).length;
        const partUnwritten = part.chapters.length - partWritten;
        const progressLabel =
          partUnwritten > 0
            ? `${partReviewed} of ${part.chapters.length} reviewed · ${partUnwritten} unwritten`
            : `${partReviewed} of ${part.chapters.length} reviewed`;
        return (
          <section className={styles.partSection} key={part.id}>
            <div className={styles.partHead}>
              <span className={styles.partEyebrow}>{partLabel(pi)}</span>
              <Heading level={2}>{part.title}</Heading>
              <span className={styles.partCount}>{progressLabel}</span>
            </div>
            {/* The write action / live write-progress lives inside the FIRST part that still has unwritten
                shells (§13.3) — so it sits where the work is, not floating above the whole grid. */}
            {firstUnwrittenPart === pi && chapterProgress ? (
              <DraftProgress p={chapterProgress} />
            ) : firstUnwrittenPart === pi && pending > 0 ? (
              <div className={styles.writeBar}>
                <Text size="sm">
                  {chapters.length > 0
                    ? `${pending} approved chapter${pending === 1 ? " isn't" : "s aren't"} written yet.`
                    : 'Your outline is ready.'}
                </Text>
                <Button variant="primary" onClick={() => void onWrite()}>
                  {chapters.length > 0
                    ? `Write the remaining ${pending} chapter${pending === 1 ? '' : 's'}`
                    : 'Write your chapters'}
                </Button>
              </div>
            ) : null}
            <div className={styles.chapterGrid}>
              {part.chapters.map((chapter) => {
                const written = chapters.find(
                  (c) => c.id === chapter.id && c.markdown.trim().length > 0,
                );
                const num = outlineChapters.findIndex((c) => c.id === chapter.id) + 1;
                const numLabel = num > 0 ? `Chapter ${num}` : 'Chapter';
                if (!written) {
                  return (
                    <div key={chapter.id} className={styles.notYetCard}>
                      <span className={styles.chNum}>{numLabel}</span>
                      <span className={styles.notYetTitle}>{chapter.title}</span>
                      <span>Not yet written</span>
                    </div>
                  );
                }
                const ownIllustration = written.imagePlacements[0]?.imageId;
                const imageId = ownIllustration ?? manifest.coverImageId;
                const url = imageId ? imageUrls[imageId] : undefined;
                const badge = chapterBadge(written.status);
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    className={`${styles.chapterCard} ${url ? '' : styles.chapterCardFallback}`}
                    style={
                      url
                        ? {
                            backgroundImage: `url("${url}")`,
                            backgroundPosition: ownIllustration ? 'center' : coverPosition(num),
                          }
                        : undefined
                    }
                    onClick={() => onOpenChapter(chapter.id)}
                  >
                    <span className={`${styles.chBadge} ${badge.cls}`}>
                      <span className={styles.chDot} aria-hidden="true" />
                      {badge.label}
                    </span>
                    <span className={styles.chapterCardBody}>
                      <span className={styles.chNum}>{numLabel}</span>
                      <span className={styles.chTitle}>{chapter.title}</span>
                      {(() => {
                        const m = metricById.get(chapter.id);
                        if (!m || m.words === 0) return null;
                        return (
                          <span className={styles.chMeta}>
                            {m.words.toLocaleString()} words · {Math.round(m.share * 100)}%
                            {m.outlier === 'long' ? (
                              <span className={styles.chOutlier}> · much longer</span>
                            ) : m.outlier === 'short' ? (
                              <span className={styles.chOutlier}> · much shorter</span>
                            ) : null}
                          </span>
                        );
                      })()}
                      <span className={styles.chReveal}>Read ›</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* The chronology sits with the structure it shapes (§16.2) — the outline says what the book holds,
          the timeline says when it happened. */}
      <TimelinePanel bundle={bundle} />
    </Stack>
  );
}
