import { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Heading,
  Inline,
  Select,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import type { BookOutline, StoryBookBundle } from '@shared/schemas';
import styles from './Story.module.css';

/**
 * Manual outline control (64 §16.1) — the author's own hands on the structure, with no AI in the loop.
 *
 * Reordering uses ↑/↓ buttons rather than drag-and-drop: keyboard-reachable by construction, no new
 * dependency, and it matches the ranking control the questionnaire form already uses. The two lossy
 * operations (delete a chapter, delete a part) confirm inline before they're sent — a merge does not,
 * because it keeps both chapters' prose (§13.9).
 */
export function OutlineEditor({
  bundle,
  onDone,
}: {
  bundle: StoryBookBundle;
  onDone: () => void;
}): JSX.Element {
  const editOutline = useStoryStore((s) => s.editOutline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `chapter:<id>` / `part:<id>` while a delete is armed — a two-step confirm, never a modal. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The chapter id whose "merge into…" picker is open. */
  const [merging, setMerging] = useState<string | null>(null);
  /** The chapter id being split (its inline two-title/two-brief form). */
  const [splitting, setSplitting] = useState<string | null>(null);
  const [newPartTitle, setNewPartTitle] = useState('');

  const outline: BookOutline | null = bundle.outline;
  const bookId = bundle.manifest.id;
  if (!outline) return <div />;

  const written = (chapterId: string): boolean =>
    bundle.chapters.some((c) => c.id === chapterId && c.markdown.trim().length > 0);

  const run = async (edit: Parameters<typeof editOutline>[1]): Promise<void> => {
    // Commit a title the person typed but hasn't blurred yet, so clicking an action can't send a stale
    // title (or drop the rename entirely) — the classic type-then-click race.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setBusy(true);
    setError(null);
    const res = await editOutline(bookId, edit);
    // A failure is surfaced, never swallowed — a stale view (a chapter someone else's edit removed) is the
    // realistic case, and the person needs to know their edit didn't land.
    if (!res.ok) setError(res.message ?? 'That change didn’t go through.');
    setBusy(false);
  };

  return (
    <Stack gap={4}>
      <div className={styles.outlineEditHead}>
        <Stack gap={1}>
          <Heading level={2}>Edit your outline</Heading>
          <Text tone="secondary" size="sm">
            Add, rename, reorder, split or merge — your book, your shape. Nothing here asks the
            biographer for permission, and nothing here rewrites your prose.
          </Text>
        </Stack>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {outline.parts.map((part, pi) => (
        <section key={part.id} className={styles.outlineEditPart}>
          <div className={styles.outlineEditPartHead}>
            <TextInput
              aria-label={`Part ${pi + 1} title`}
              defaultValue={part.title}
              disabled={busy}
              onBlur={(e) => {
                const title = e.currentTarget.value.trim();
                if (title && title !== part.title) {
                  void run({ op: 'renamePart', partId: part.id, title });
                }
              }}
            />
            {confirming === `part:${part.id}` ? (
              <Inline gap={1}>
                <Text size="sm" tone="tertiary">
                  Delete this part, its {part.chapters.length} chapter
                  {part.chapters.length === 1 ? '' : 's'} and their writing?
                </Text>
                <Button
                  variant="ghost"
                  className={styles.dangerAction}
                  disabled={busy}
                  onClick={async () => {
                    setConfirming(null);
                    await run({ op: 'deletePart', partId: part.id });
                  }}
                >
                  Delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(null)}>
                  Keep
                </Button>
              </Inline>
            ) : (
              <Button
                variant="ghost"
                className={styles.dangerAction}
                // A book needs at least one part, so don't offer an action that can only fail (§12).
                disabled={busy || outline.parts.length === 1}
                onClick={() => setConfirming(`part:${part.id}`)}
              >
                Delete part
              </Button>
            )}
          </div>

          <Stack gap={1}>
            {part.chapters.map((chapter, ci) => (
              <div key={chapter.id} className={styles.outlineEditRow}>
                <TextInput
                  aria-label={`Chapter title: ${chapter.title}`}
                  defaultValue={chapter.title}
                  disabled={busy}
                  onBlur={(e) => {
                    const title = e.currentTarget.value.trim();
                    if (title && title !== chapter.title) {
                      void run({ op: 'renameChapter', chapterId: chapter.id, title });
                    }
                  }}
                />
                <div className={styles.outlineEditActions}>
                  <Button
                    variant="ghost"
                    aria-label={`Move “${chapter.title}” up`}
                    disabled={busy || (pi === 0 && ci === 0)}
                    onClick={() =>
                      void run(
                        ci === 0
                          ? {
                              // At the top of a part, "up" means the end of the previous part.
                              op: 'moveChapter',
                              chapterId: chapter.id,
                              toPartId: outline.parts[pi - 1]!.id,
                              toIndex: outline.parts[pi - 1]!.chapters.length,
                            }
                          : {
                              op: 'moveChapter',
                              chapterId: chapter.id,
                              toPartId: part.id,
                              toIndex: ci - 1,
                            },
                      )
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Move “${chapter.title}” down`}
                    disabled={
                      busy || (pi === outline.parts.length - 1 && ci === part.chapters.length - 1)
                    }
                    onClick={() =>
                      void run(
                        ci === part.chapters.length - 1
                          ? {
                              // At the end of a part, "down" means the start of the next part.
                              op: 'moveChapter',
                              chapterId: chapter.id,
                              toPartId: outline.parts[pi + 1]!.id,
                              toIndex: 0,
                            }
                          : {
                              op: 'moveChapter',
                              chapterId: chapter.id,
                              toPartId: part.id,
                              toIndex: ci + 1,
                            },
                      )
                    }
                  >
                    ↓
                  </Button>
                  {/* Secondary actions collapse into a kebab rather than a wrapping button pile (§12). */}
                  <RowMenu
                    title={chapter.title}
                    disabled={busy}
                    onSplit={() => setSplitting(chapter.id)}
                    onMerge={() => setMerging(chapter.id)}
                    onDelete={() => setConfirming(`chapter:${chapter.id}`)}
                  />
                  {confirming === `chapter:${chapter.id}` ? (
                    <>
                      <Text size="sm" tone="tertiary">
                        {written(chapter.id) ? 'Delete it and its writing?' : 'Delete it?'}
                      </Text>
                      <Button
                        variant="ghost"
                        className={styles.dangerAction}
                        disabled={busy}
                        onClick={async () => {
                          setConfirming(null);
                          await run({ op: 'deleteChapter', chapterId: chapter.id });
                        }}
                      >
                        Delete
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </>
                  ) : null}
                </div>

                {merging === chapter.id ? (
                  <div className={styles.outlineMergeRow}>
                    <Text size="sm" tone="tertiary">
                      Merge “{chapter.title}” into — both chapters’ writing is kept:
                    </Text>
                    <Inline gap={2} wrap>
                      <Select
                        aria-label={`Merge “${chapter.title}” into`}
                        value=""
                        disabled={busy}
                        onChange={async (e) => {
                          const intoChapterId = e.currentTarget.value;
                          if (!intoChapterId) return;
                          setMerging(null);
                          await run({ op: 'mergeChapters', chapterId: chapter.id, intoChapterId });
                        }}
                      >
                        <option value="">Choose a chapter…</option>
                        {outline.parts
                          .flatMap((p) => p.chapters)
                          .filter((c) => c.id !== chapter.id)
                          .map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.title}
                            </option>
                          ))}
                      </Select>
                      <Button variant="ghost" onClick={() => setMerging(null)}>
                        Cancel
                      </Button>
                    </Inline>
                  </div>
                ) : null}

                {splitting === chapter.id ? (
                  <SplitForm
                    chapterTitle={chapter.title}
                    brief={chapter.brief}
                    busy={busy}
                    onCancel={() => setSplitting(null)}
                    onSplit={async (fields) => {
                      setSplitting(null);
                      await run({ op: 'splitChapter', chapterId: chapter.id, ...fields });
                    }}
                  />
                ) : null}
              </div>
            ))}
          </Stack>

          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run({ op: 'addChapter', partId: part.id, title: 'A new chapter' })}
          >
            + Add a chapter to {part.title}
          </Button>
        </section>
      ))}

      <div className={styles.outlineEditRow}>
        <TextInput
          aria-label="New part title"
          placeholder="A new part — e.g. “Leaving home”"
          value={newPartTitle}
          disabled={busy}
          onChange={(e) => setNewPartTitle(e.currentTarget.value)}
        />
        <Button
          variant="ghost"
          disabled={busy || !newPartTitle.trim()}
          onClick={async () => {
            const title = newPartTitle.trim();
            setNewPartTitle('');
            await run({ op: 'addPart', title });
          }}
        >
          Add part
        </Button>
      </div>
    </Stack>
  );
}

/**
 * A chapter row's secondary actions (§12 — a kebab, never a wrapping pile of buttons). Mirrors the Studio
 * hero's own kebab: a backdrop closes it, Escape closes it, and each item is a real `menuitem`.
 */
function RowMenu({
  title,
  disabled,
  onSplit,
  onMerge,
  onDelete,
}: {
  title: string;
  disabled: boolean;
  onSplit: () => void;
  onMerge: () => void;
  onDelete: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className={styles.kebabWrap}>
      <button
        type="button"
        className={styles.kebabButton}
        aria-label={`More actions for “${title}”`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open ? (
        <>
          <div className={styles.kebabBackdrop} onClick={() => setOpen(false)} aria-hidden="true" />
          <div className={styles.kebabMenu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onSplit)}
            >
              Split “{title}” in two
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onMerge)}
            >
              Merge “{title}” into another chapter
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${styles.kebabItem} ${styles.dangerAction}`}
              onClick={pick(onDelete)}
            >
              Delete “{title}”
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The inline split form. It collects BOTH halves' titles and briefs, because narrowing the first half's
 * brief is what makes a split mean anything — split on titles alone and the original is still supposed to
 * say everything it already says, so the next pass would just rewrite the same chapter (§16.1).
 */
function SplitForm({
  chapterTitle,
  brief,
  busy,
  onCancel,
  onSplit,
}: {
  chapterTitle: string;
  brief: string;
  busy: boolean;
  onCancel: () => void;
  onSplit: (fields: {
    firstTitle: string;
    secondTitle: string;
    firstBrief: string;
    secondBrief: string;
  }) => void | Promise<void>;
}): JSX.Element {
  const [firstTitle, setFirstTitle] = useState(chapterTitle);
  const [secondTitle, setSecondTitle] = useState('');
  const [firstBrief, setFirstBrief] = useState(brief);
  const [secondBrief, setSecondBrief] = useState('');
  return (
    <div className={styles.outlineMergeRow}>
      <Text size="sm" tone="tertiary">
        Split “{chapterTitle}” — the writing stays with the first half until you rewrite it.
      </Text>
      <Inline gap={2} wrap>
        <TextInput
          aria-label="First chapter title"
          value={firstTitle}
          disabled={busy}
          onChange={(e) => setFirstTitle(e.currentTarget.value)}
        />
        <TextInput
          aria-label="First chapter is about"
          placeholder="Now only about…"
          value={firstBrief}
          disabled={busy}
          onChange={(e) => setFirstBrief(e.currentTarget.value)}
        />
      </Inline>
      <Inline gap={2} wrap>
        <TextInput
          aria-label="Second chapter title"
          placeholder="The new chapter’s title"
          value={secondTitle}
          disabled={busy}
          onChange={(e) => setSecondTitle(e.currentTarget.value)}
        />
        <TextInput
          aria-label="Second chapter is about"
          placeholder="And this one about…"
          value={secondBrief}
          disabled={busy}
          onChange={(e) => setSecondBrief(e.currentTarget.value)}
        />
      </Inline>
      <Inline gap={2}>
        <Button
          variant="primary"
          disabled={busy || !firstTitle.trim() || !secondTitle.trim()}
          onClick={() => void onSplit({ firstTitle, secondTitle, firstBrief, secondBrief })}
        >
          Split in two
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </Inline>
    </div>
  );
}
