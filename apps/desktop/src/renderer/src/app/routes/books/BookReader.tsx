import { Button, Heading, Markdown, Text } from '../../../design-system/components';
import { useSetting } from '../../../settings/useSetting';
import styles from './Books.module.css';
import { BOOK_BOUNDARY_LINE, colophonLines } from '@selfos/core/story-matter';
import { useEffect, useRef, useState } from 'react';
import type { StoryReaderView } from '@shared/schemas';
import { partLabel } from './chapterDisplay';
import { splitParagraphs } from './markupHelpers';

/** The short state mark shown next to a chapter in the Contents (owner reader only, §13.5). */
export function tocStatusMark(status?: string): { label: string; isNew: boolean } | null {
  switch (status) {
    case 'reviewed':
      return { label: '✓', isNew: false };
    case 'updated':
      return { label: 'updated', isNew: true };
    case 'stale':
      return { label: 'new material', isNew: true };
    case 'new':
      return { label: 'new', isNew: true };
    default:
      return null;
  }
}
/**
 * The Book — the immersive reader (§13.5). ONE surface for both the OWNER reading their own draft head (with
 * per-chapter status, an Edit affordance, and a device-local resume position) and a granted READER reading a
 * shared book's published head (read-only). Controlled: `chapterId` = the current chapter (null = front
 * matter); `onNavigate` moves between front matter and chapters. `resolveImage` fetches each image's data URL
 * (own-book draft images vs. the re-gated published bytes — the caller decides). The Read⇄Shape toggle + the
 * in-place markup arrive in R3; for now the owner edits via "Edit this chapter" → the existing chapter editor.
 */
export function BookReader({
  view,
  owner,
  chapterId,
  lastChapterId,
  resolveImage,
  onExit,
  onNavigate,
  onEditChapter,
  onSetPosition,
}: {
  view: StoryReaderView;
  owner: boolean;
  chapterId: string | null;
  lastChapterId?: string | null;
  resolveImage: (imageId: string) => Promise<string | null>;
  onExit: () => void;
  onNavigate: (chapterId: string | null) => void;
  onEditChapter?: (chapterId: string) => void;
  onSetPosition?: (chapterId: string) => void;
}): JSX.Element {
  const [scale, setScale] = useSetting('story.readerFontSize');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const { manifest, chapters, authorName } = view;
  const order = manifest.chapterOrder;
  const chapter = chapterId ? chapters.find((c) => c.id === chapterId) : null;
  const idx = chapterId ? order.indexOf(chapterId) : -1;
  const prevId = idx > 0 ? order[idx - 1] : null;
  const nextId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const isLast = idx === order.length - 1;
  const titleById = new Map(chapters.map((c) => [c.id, c.title]));

  // Resolve the images this view needs: the cover (front matter / chapter opener fallback) + the current
  // chapter's placements. Cancels a stale in-flight resolve when the chapter changes.
  useEffect(() => {
    const needed = new Set<string>();
    if (manifest.coverImageId) needed.add(manifest.coverImageId);
    if (chapter) for (const pl of chapter.imagePlacements) needed.add(pl.imageId);
    let cancelled = false;
    void (async () => {
      for (const imageId of needed) {
        if (urls[imageId]) continue;
        const url = await resolveImage(imageId);
        if (!cancelled && url) setUrls((u) => ({ ...u, [imageId]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // resolveImage is stable per (book, owner); depend on the ids we need, not the fn identity.
  }, [manifest.coverImageId, chapterId, chapter]);

  // Record the owner's read position whenever a chapter is open (device-local resume, §13.6.9).
  useEffect(() => {
    if (owner && chapter && onSetPosition) onSetPosition(chapter.id);
  }, [owner, chapter?.id]);

  // Scroll to the top on a page change (each chapter / front matter is its own "page").
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [chapterId]);

  const AA_STEPS = [1, 1.12, 1.25];
  const cycleAa = (): void => {
    const cur = typeof scale === 'number' ? scale : 1;
    const nearest = AA_STEPS.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
    setScale(AA_STEPS[(AA_STEPS.indexOf(nearest) + 1) % AA_STEPS.length] ?? 1);
  };

  const coverUrl = manifest.coverImageId ? urls[manifest.coverImageId] : undefined;
  // Chapter opener art (§13.5): the chapter's OWN illustration (its first placement) → the book cover →
  // the deterministic gradient fallback. The promoted image becomes the hero, so it's excluded from the
  // inline figures below (never rendered twice).
  const openerPlacementId = chapter?.imagePlacements[0]?.imageId;
  const openerImageId = openerPlacementId ?? manifest.coverImageId;
  const openerUrl = openerImageId ? urls[openerImageId] : undefined;

  return (
    <div
      className={styles.reader}
      style={{ ['--reader-scale' as string]: String(typeof scale === 'number' ? scale : 1) }}
    >
      <div className={styles.readerBar}>
        <Button variant="ghost" onClick={onExit} aria-label={owner ? 'Back to the studio' : 'Back'}>
          {owner ? '‹ Studio' : '‹ Back'}
        </Button>
        <span className={styles.mid}>{manifest.title}</span>
        <span className={styles.pos}>
          {chapter ? `Ch. ${idx + 1} of ${order.length}` : 'Front matter'}
        </span>
        {owner && chapter && onEditChapter ? (
          <button
            type="button"
            className={styles.shapeButton}
            aria-label="Shape this chapter"
            title="Edit this chapter"
            onClick={() => onEditChapter(chapter.id)}
          >
            Shape
          </button>
        ) : null}
        <button type="button" className={styles.aaButton} aria-label="Text size" onClick={cycleAa}>
          aA
        </button>
      </div>

      <div className={styles.readerScroll} ref={scrollRef}>
        <div className={styles.readerCol}>
          {chapter ? (
            <>
              <div
                className={`${styles.chapterOpener} ${openerUrl ? '' : styles.chapterOpenerFallback}`}
                style={openerUrl ? { backgroundImage: `url("${openerUrl}")` } : undefined}
              >
                <span className={styles.k}>Chapter {idx + 1}</span>
                <h1>{chapter.title}</h1>
              </div>
              <div className={styles.prose}>
                {splitParagraphs(chapter.markdown).map((para, pi) => (
                  <div key={pi} className={pi === 0 ? styles.dropCap : undefined}>
                    <Markdown>{para}</Markdown>
                    {(chapter.pinnedQuotes ?? [])
                      .filter((q) => q.anchor.paragraphId === `p${pi}`)
                      .map((q, qi) => (
                        <blockquote key={`pin-${qi}`} className={styles.pullQuote}>
                          {q.text}
                          <small>In your own words</small>
                        </blockquote>
                      ))}
                    {chapter.imagePlacements
                      .filter(
                        (pl) => pl.afterAnchor === `p${pi}` && pl.imageId !== openerPlacementId,
                      )
                      .map((pl) =>
                        urls[pl.imageId] ? (
                          <figure key={pl.imageId} className={styles.readerFigure}>
                            <img src={urls[pl.imageId]} alt={pl.caption || 'Book image'} />
                            {pl.caption ? <figcaption>{pl.caption}</figcaption> : null}
                          </figure>
                        ) : null,
                      )}
                  </div>
                ))}
              </div>

              {owner && onEditChapter ? (
                <div className={styles.readerEdit}>
                  <Button variant="ghost" onClick={() => onEditChapter(chapter.id)}>
                    Shape this chapter ›
                  </Button>
                </div>
              ) : null}

              {/* Back matter follows the last chapter (the natural end of the book). */}
              {isLast ? (
                <>
                  {manifest.matter?.acknowledgments ? (
                    <section className={styles.readerBack}>
                      <Heading level={3}>Acknowledgments</Heading>
                      <div className={styles.prose}>
                        <Markdown>{manifest.matter.acknowledgments}</Markdown>
                      </div>
                    </section>
                  ) : null}
                  {manifest.matter?.aboutAuthor ? (
                    <section className={styles.readerBack}>
                      <Heading level={3}>About the author</Heading>
                      <div className={styles.prose}>
                        <Markdown>{manifest.matter.aboutAuthor}</Markdown>
                      </div>
                    </section>
                  ) : null}
                  {manifest.noteOnBook ? (
                    <section className={styles.readerBack}>
                      <Heading level={3}>A note on this book</Heading>
                      <Text tone="secondary">{manifest.noteOnBook}</Text>
                    </section>
                  ) : null}
                  <div className={styles.colophon}>
                    {new Date(manifest.publishedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}{' '}
                    · {manifest.title}
                    {/* Their colophon (when written) then the standing boundary — one shared helper, so
                        the reader and both exports can't drift on the line that must always be there. */}
                    {colophonLines(manifest.matter).map((line) => (
                      <span key={line}>
                        <br />
                        {line}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}

              <div className={styles.readerNav}>
                {prevId ? (
                  <button type="button" onClick={() => onNavigate(prevId)}>
                    <span className={styles.lbl}>‹ Previous</span>
                    <span className={styles.ttl}>{titleById.get(prevId)}</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => onNavigate(null)}>
                    <span className={styles.lbl}>‹</span>
                    <span className={styles.ttl}>Front matter</span>
                  </button>
                )}
                <span className={styles.sp} />
                {nextId ? (
                  <button
                    type="button"
                    style={{ textAlign: 'right' }}
                    onClick={() => onNavigate(nextId)}
                  >
                    <span className={styles.lbl}>Next ›</span>
                    <span className={styles.ttl}>{titleById.get(nextId)}</span>
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            /* ---- Front matter ---- */
            <>
              <div className={styles.coverPageBig}>
                <div
                  className={`${styles.coverBook} ${coverUrl ? '' : styles.coverBookFallback}`}
                  style={coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined}
                >
                  <span className={styles.cbTitle}>{manifest.title}</span>
                  <span className={styles.cbKicker}>A living biography</span>
                </div>
              </div>
              <div className={styles.titlePage}>
                <h1>{manifest.title}</h1>
                <div className={styles.by}>
                  {owner ? `The story of ${authorName}` : `by ${authorName}`}
                </div>
                {manifest.essence ? <div className={styles.ess}>{manifest.essence}</div> : null}
                {/* The §8.2 boundary on the way IN as well as out — a reader who never reaches the last
                    chapter (or a draft with none written) still sees what this book is and isn't. */}
                <div className={styles.titleBoundary}>{BOOK_BOUNDARY_LINE}</div>
              </div>
              {manifest.matter?.dedication ? (
                <p className={styles.frontDed}>{manifest.matter.dedication}</p>
              ) : null}
              {manifest.matter?.epigraph ? (
                <blockquote className={styles.frontEpi}>{manifest.matter.epigraph}</blockquote>
              ) : null}
              {manifest.cast && manifest.cast.length > 0 ? (
                <section className={styles.castList} aria-label="The people in this book">
                  <h2>The people in this book</h2>
                  <ul>
                    {manifest.cast.map((m) => (
                      <li key={m.name}>
                        <strong>{m.name}</strong>
                        {m.relationship ? ` — ${m.relationship}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {manifest.parts.length > 0 ? (
                <nav className={styles.contents} aria-label="Contents">
                  <h2>Contents</h2>
                  {manifest.parts.map((part, pIdx) => (
                    <div key={part.id}>
                      <div className={styles.part}>
                        {partLabel(pIdx)} · {part.title}
                      </div>
                      {part.chapterIds.map((id) => {
                        const n = order.indexOf(id) + 1;
                        const mark = owner
                          ? tocStatusMark(chapters.find((c) => c.id === id)?.status)
                          : null;
                        return (
                          <button
                            key={id}
                            type="button"
                            className={styles.tocLink}
                            onClick={() => onNavigate(id)}
                          >
                            <span className={styles.no}>{n}</span>
                            <span className={styles.tt}>{titleById.get(id)}</span>
                            <span className={styles.dots} />
                            {mark ? (
                              <span className={`${styles.st} ${mark.isNew ? styles.new : ''}`}>
                                {mark.label}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </nav>
              ) : null}
              <div className={styles.frontBegin}>
                {owner && lastChapterId && lastChapterId !== order[0] ? (
                  <Button variant="primary" onClick={() => onNavigate(lastChapterId)}>
                    Continue · {titleById.get(lastChapterId)} ›
                  </Button>
                ) : null}
                {order[0] ? (
                  <Button
                    variant={
                      owner && lastChapterId && lastChapterId !== order[0] ? 'ghost' : 'primary'
                    }
                    onClick={() => onNavigate(order[0]!)}
                  >
                    {owner && lastChapterId && lastChapterId !== order[0]
                      ? 'From the beginning'
                      : 'Begin reading ›'}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
