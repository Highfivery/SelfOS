import { useEffect, useState } from 'react';
import { Button, Heading, Text } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import { SharedWithYou } from './SharedWithYou';
import { coverPosition } from './chapterDisplay';
import styles from './Books.module.css';
import type { BookShelfEntry } from '@shared/schemas';

/**
 * The bookshelf (72 §3.1) — the section's front door.
 *
 * Every book the person owns, as a cover-backed card that says something true at a glance: how far along it
 * is, in that book's own unit, and whether it is still growing or has been called finished. This replaces
 * the single-book Studio that opened `books[0]` on arrival — an assumption that was wrong the moment a
 * second book existed, and silently hid it.
 *
 * Books shared with the person sit on their own shelf beneath, because they are somebody else's work and a
 * reader can't write in them.
 */

function unitLine(b: BookShelfEntry): string {
  const unit = b.total === 1 ? b.unit.one : b.unit.many;
  return `${b.written} of ${b.total} ${unit} written`;
}

function stateChip(b: BookShelfEntry): { label: string; cls: string } {
  if (b.lifecycle === 'finished') {
    const latest = b.finishedAt !== undefined ? new Date(b.finishedAt) : null;
    const when =
      latest && !Number.isNaN(latest.getTime())
        ? latest.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
        : null;
    // An edition beyond the first is worth naming — "finished" alone would hide that it grew again.
    const which = b.editions > 1 ? `Edition ${b.editions}` : 'Finished';
    return { label: when ? `✓ ${which} ${when}` : `✓ ${which}`, cls: styles.shelfChipDone ?? '' };
  }
  return { label: 'Living', cls: styles.shelfChipLiving ?? '' };
}

export function Bookshelf({
  onOpen,
  onNew,
  resolveCover,
}: {
  onOpen: (bookId: string) => void;
  onNew: () => void;
  resolveCover: (bookId: string, imageId: string) => Promise<string | null>;
}): JSX.Element {
  const shelf = useStoryStore((s) => s.shelf);
  const bookTypes = useStoryStore((s) => s.bookTypes);
  const typeLabel = (id: string): string => bookTypes.find((t) => t.id === id)?.label ?? 'Book';
  const words = shelf.reduce((n, b) => n + b.words, 0);
  // Derived, never hard-coded: a registered type that is renamed or retired changes this line with it, and
  // the count can't drift from the picker the tile is inviting you into.
  const kindCount = bookTypes.length;
  // A few concrete examples of what a book can BE — the tile's whole job. Drawn from the registry by id and
  // filtered to what actually exists, and deliberately not the 18+ type: an empty tile on a shelf is the
  // wrong place to surface adult content to someone who has not asked for it.
  const examples = ['biography', 'yearInReview', 'childrens', 'dreamBook']
    .map((id) => bookTypes.find((t) => t.id === id)?.label.toLowerCase())
    .filter((label): label is string => Boolean(label))
    .slice(0, 3)
    .join(' · ');

  // Covers are decrypted one at a time behind the vault, so they arrive after the shelf renders. Until then
  // (and for a book with no cover at all) the card shows its painted fallback — never an empty rectangle.
  const [covers, setCovers] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    for (const b of shelf) {
      if (!b.coverImageId) continue;
      void resolveCover(b.id, b.coverImageId).then((url) => {
        if (live && url) setCovers((prev) => ({ ...prev, [b.id]: url }));
      });
    }
    return () => {
      live = false;
    };
  }, [shelf, resolveCover]);

  return (
    <>
      <div className={styles.shelfHead}>
        <div>
          <Heading level={1}>Your books</Heading>
          <Text tone="secondary">
            {shelf.length === 1 ? 'One book' : `${shelf.length} books`}
            {words > 0 ? ` · ${words.toLocaleString()} words` : ''}
          </Text>
        </div>
        <Button onClick={onNew}>+ New book</Button>
      </div>

      <div className={styles.shelf}>
        {shelf.map((b) => {
          const chip = stateChip(b);
          const url = covers[b.id] ?? null;
          // A book with no outline yet has nothing to be a fraction of — show no bar rather than a full one.
          const pct = b.total > 0 ? Math.round((b.written / b.total) * 100) : 0;
          return (
            <button
              key={b.id}
              type="button"
              className={styles.shelfItem}
              // The card's visible content is title + counts; the name says what CLICKING it does.
              aria-label={`Open ${b.title}`}
              onClick={() => onOpen(b.id)}
            >
              <span
                className={styles.shelfCover}
                style={
                  url
                    ? {
                        backgroundImage: `url(${url})`,
                        backgroundPosition: coverPosition(b.written),
                      }
                    : undefined
                }
              >
                {/* The title is cover ART here and text below — decorative repetition, so it is hidden
                    from assistive tech rather than read twice. */}
                <span className={styles.shelfCoverTitle} aria-hidden="true">
                  {b.title}
                </span>
              </span>
              <span className={styles.shelfTitle}>{b.title}</span>
              <span className={styles.shelfMeta}>
                {typeLabel(b.type)}
                {b.words > 0 ? ` · ${b.words.toLocaleString()} words` : ''}
              </span>
              <span className={styles.shelfBar} aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </span>
              <span className={styles.shelfChips}>
                <span className={chip.cls}>{chip.label}</span>
                <span className={styles.shelfCount}>{unitLine(b)}</span>
              </span>
            </button>
          );
        })}

        <button type="button" className={styles.shelfNew} onClick={onNew}>
          {/* Three unwritten spines rather than a plus: on a shelf, the invitation should look like books
              you haven't made yet. Decorative — the button's label already says what clicking does. */}
          <span className={styles.shelfNewCard} aria-hidden="true">
            <span className={styles.shelfNewArt}>
              <span className={styles.shelfNewSpine} />
              <span className={styles.shelfNewSpine} />
              <span className={styles.shelfNewSpine} />
            </span>
            <span className={styles.shelfNewPitch}>
              {kindCount > 1 ? `${kindCount} kinds of book` : 'A book from your story'}
            </span>
            {examples ? <span className={styles.shelfNewExamples}>{examples}</span> : null}
          </span>
          <span className={styles.shelfNewLabel}>Start a new book</span>
        </button>
      </div>

      <SharedWithYou />
    </>
  );
}
