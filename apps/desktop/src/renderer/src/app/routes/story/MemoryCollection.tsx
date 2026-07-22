import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryMemoryStore } from '../../../stores/storyMemoryStore';
import type { StoryMemoryView } from '@shared/schemas';
import styles from './Story.module.css';

/** A friendly "last worked on" label for an in-progress memory row (§14) — today/yesterday, else a short date. */
function formatMemoryWhen(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const now = new Date();
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** One memory row in the collection (§14) — `progress` (resumable, shows a Continue cue + last-activity) or
 *  `saved` (re-read only, shows where it wove into the book). The whole row opens the chat; a two-step Remove. */
function MemoryCollectionRow({
  m,
  variant,
  confirmDelete,
  onOpen,
  onArmDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  m: StoryMemoryView;
  variant: 'progress' | 'saved';
  confirmDelete: string | null;
  onOpen: () => void;
  onArmDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void | Promise<void>;
}): JSX.Element {
  const title = m.title || (variant === 'progress' ? 'New memory' : 'Untitled memory');
  return (
    <div className={styles.memRow}>
      <button
        type="button"
        className={styles.memRowMain}
        aria-label={
          variant === 'progress'
            ? `Continue the memory “${title}”`
            : `Re-read the memory “${title}”`
        }
        onClick={onOpen}
      >
        <Text size="sm" weight={500}>
          {title}
        </Text>
        <div className={styles.memRowMeta}>
          {variant === 'progress' ? (
            <span className={styles.memDraftChip}>
              {m.status === 'ready' ? 'Ready to save' : 'In progress'}
            </span>
          ) : null}
          {variant === 'progress' ? (
            <Text size="sm" tone="tertiary">
              Last worked on {formatMemoryWhen(m.updatedAt)}
            </Text>
          ) : null}
          {m.approxDate ? (
            <Text size="sm" tone="tertiary">
              {m.approxDate}
            </Text>
          ) : null}
          {m.people.slice(0, 3).map((p, i) => (
            <span key={`${p.name}-${i}`} className={styles.memPersonChip}>
              {p.name}
            </span>
          ))}
          {m.wroteIntoChapterTitle ? (
            <Text size="sm" tone="tertiary">
              wove into “{m.wroteIntoChapterTitle}”
            </Text>
          ) : null}
        </div>
      </button>
      {variant === 'progress' ? (
        <span className={styles.memRowContinue} aria-hidden="true">
          Continue →
        </span>
      ) : null}
      <div className={styles.memRowActions}>
        {confirmDelete === m.id ? (
          <>
            <Text size="sm" tone="tertiary">
              Remove?
            </Text>
            <Button variant="ghost" onClick={onConfirmDelete}>
              Remove
            </Button>
            <button type="button" className={styles.sourcesToggle} onClick={onCancelDelete}>
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.sourcesToggle}
            aria-label={`Remove the memory “${title}”`}
            onClick={onArmDelete}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The shared memory collection (§14.2/§15.1) — "Pick up where you left off" (resumable, not-yet-saved chats)
 * above "Memories you've shared" (the finished ones), both newest-first. ONE component so the Interview tab
 * (inside the book Studio) and the book-independent `/story/memories` route cannot drift.
 *
 * Memories are person-level, so this reads the same store on both surfaces and needs no book. When there are
 * no memories at all it renders `emptyState` (the standalone route's invitation) — or nothing, so the
 * Interview tab stays quiet until the person has shared something.
 */
export function MemoryCollection({
  onOpen,
  emptyState,
}: {
  onOpen: (memoryId: string) => void;
  emptyState?: ReactNode;
}): JSX.Element | null {
  const memories = useStoryMemoryStore((s) => s.memories);
  const memoriesLoaded = useStoryMemoryStore((s) => s.memoriesLoaded);
  const loadMemories = useStoryMemoryStore((s) => s.loadMemories);
  const deleteMemory = useStoryMemoryStore((s) => s.deleteMemory);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Keyed on the active person (the `Story.tsx` convention): AppShell resets this store on a switch, and the
  // standalone route does NOT unmount (the switcher doesn't navigate), so without this the new person's
  // memories would never load AND the `memoriesLoaded` gate would suppress the empty state — a blank forever.
  const activePersonId = useSessionStore((s) => s.activePerson?.id);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories, activePersonId]);

  const inProgress = memories.filter((m) => m.status !== 'saved');
  const shared = memories.filter((m) => m.status === 'saved');

  // Nothing yet — render the caller's empty state (never a half-empty pair of cards). Held until the first
  // load resolves so the standalone route doesn't flash its invitation over an existing collection.
  if (memories.length === 0) return memoriesLoaded ? <>{emptyState ?? null}</> : null;

  const rowHandlers = (
    m: StoryMemoryView,
  ): Pick<
    Parameters<typeof MemoryCollectionRow>[0],
    'onOpen' | 'onArmDelete' | 'onCancelDelete' | 'onConfirmDelete'
  > => ({
    onOpen: () => onOpen(m.id),
    onArmDelete: () => setConfirmDelete(m.id),
    onCancelDelete: () => setConfirmDelete(null),
    onConfirmDelete: async () => {
      setConfirmDelete(null);
      await deleteMemory(m.id);
    },
  });

  return (
    <>
      {inProgress.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={3}>Pick up where you left off</Heading>
            <Text tone="tertiary" size="sm">
              Memory chats you haven’t finished — open one to keep talking, or review a draft your
              biographer has already written.
            </Text>
            <Stack gap={1}>
              {inProgress.map((m) => (
                <MemoryCollectionRow
                  key={m.id}
                  m={m}
                  variant="progress"
                  confirmDelete={confirmDelete}
                  {...rowHandlers(m)}
                />
              ))}
            </Stack>
          </Stack>
        </Card>
      ) : null}

      {shared.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={3}>Memories you’ve shared</Heading>
            <Text tone="tertiary" size="sm">
              Moments you’ve told your biographer — open one to re-read it. Your biographer weaves
              them into your story.
            </Text>
            <Stack gap={1}>
              {shared.map((m) => (
                <MemoryCollectionRow
                  key={m.id}
                  m={m}
                  variant="saved"
                  confirmDelete={confirmDelete}
                  {...rowHandlers(m)}
                />
              ))}
            </Stack>
          </Stack>
        </Card>
      ) : null}
    </>
  );
}
