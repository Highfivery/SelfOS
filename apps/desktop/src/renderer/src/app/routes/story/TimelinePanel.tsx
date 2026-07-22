import { useRef, useState } from 'react';
import { Banner, Button, Heading, Stack, Text, TextInput } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import type { StoryBookBundle, TimelineEvent } from '@shared/schemas';
import styles from './Story.module.css';

/**
 * A real calendar date (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) vs a fuzzy era ("mid-90s"). Month/day are range
 * checked, so `2024-13-45` is treated as a label rather than presented to the model as an authoritative date.
 */
function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!m) return false;
  const month = m[2] ? Number(m[2]) : undefined;
  const day = m[3] ? Number(m[3]) : undefined;
  if (month !== undefined && (month < 1 || month > 12)) return false;
  if (day !== undefined && (day < 1 || day > 31)) return false;
  return true;
}

/**
 * Split a typed "when" into the two schema fields. `clear: true` (an EDIT) emits both keys so emptying one
 * can't leave a stale value in the other; `clear: false` (an ADD) omits what wasn't given.
 */
function whenFields(value: string, opts: { clear: boolean }): { date?: string; approx?: string } {
  const trimmed = value.trim();
  if (!trimmed) return opts.clear ? { date: '', approx: '' } : {};
  return isCalendarDate(trimmed)
    ? { date: trimmed, ...(opts.clear ? { approx: '' } : {}) }
    : { approx: trimmed, ...(opts.clear ? { date: '' } : {}) };
}

/**
 * The timeline studio (64 §16.2) — the book's chronology, editable at last.
 *
 * It was generated at foundations, stored, shipped to the renderer and read by nothing. Now every moment can
 * be added, re-dated or removed; each edit stamps `userEdited`, which is what keeps a correction from being
 * reverted by the next foundations pass. What the person fixes here feeds the biographer as dated grounding
 * and steers how chapters are ordered — but only ever as a PROPOSAL: a corrected date never silently
 * rearranges a book that's already drafted.
 */
export function TimelinePanel({ bundle }: { bundle: StoryBookBundle }): JSX.Element {
  const editTimeline = useStoryStore((s) => s.editTimeline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [when, setWhen] = useState('');

  const bookId = bundle.manifest.id;
  const events = bundle.timeline?.events ?? [];

  // Every edit is a read-modify-write of one file, so they must not overlap: blurring a focused row fires
  // its save, and the click that caused the blur fires another — interleaved, whichever reads second wins
  // and the other edit is silently lost. Chain them instead.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = async (edit: Parameters<typeof editTimeline>[1]): Promise<boolean> => {
    // Commit a value typed but not yet blurred, so an action can't send a stale field.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setBusy(true);
    setError(null);
    const mine = queue.current.then(() => editTimeline(bookId, edit));
    queue.current = mine.catch(() => undefined);
    const res = await mine;
    if (!res.ok) setError(res.message ?? 'That change didn’t go through.');
    setBusy(false);
    return res.ok;
  };

  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <Heading level={2}>Your timeline</Heading>
        <Text tone="secondary" size="sm">
          The spine your story hangs on. Your biographer uses these dates to place a scene in the
          right year and to work out what order your chapters belong in — and what you fix here
          stays fixed.
        </Text>
      </Stack>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {events.length === 0 ? (
        <Text tone="tertiary" size="sm">
          Nothing on your timeline yet. Add the moments you want your story anchored to — a birth, a
          move, a turning point.
        </Text>
      ) : (
        <Stack gap={1}>
          {events.map((event) => (
            <TimelineRow
              key={event.id}
              event={event}
              busy={busy}
              confirming={confirming === event.id}
              onArmDelete={() => setConfirming(event.id)}
              onCancelDelete={() => setConfirming(null)}
              onConfirmDelete={async () => {
                setConfirming(null);
                await run({ op: 'remove', eventId: event.id });
              }}
              onSave={(fields) => run({ op: 'update', eventId: event.id, ...fields })}
            />
          ))}
        </Stack>
      )}

      <div className={styles.tlRow}>
        <div className={styles.tlWhen}>
          <TextInput
            aria-label="When it happened"
            placeholder="1985"
            value={when}
            disabled={busy}
            onChange={(e) => setWhen(e.currentTarget.value)}
          />
        </div>
        <div className={styles.tlWhat}>
          <TextInput
            aria-label="What happened"
            placeholder="What happened — e.g. “We moved west”"
            value={label}
            disabled={busy}
            onChange={(e) => setLabel(e.currentTarget.value)}
          />
        </div>
        <Button
          variant="ghost"
          disabled={busy || !label.trim()}
          onClick={async () => {
            const ok = await run({ op: 'add', label, ...whenFields(when, { clear: false }) });
            if (ok) {
              setLabel('');
              setWhen('');
            }
          }}
        >
          Add a moment
        </Button>
      </div>
    </Stack>
  );
}

/** One moment: its name + when, both editable in place, with a two-step remove. */
function TimelineRow({
  event,
  busy,
  confirming,
  onArmDelete,
  onCancelDelete,
  onConfirmDelete,
  onSave,
}: {
  event: TimelineEvent;
  busy: boolean;
  confirming: boolean;
  onArmDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void | Promise<void>;
  onSave: (fields: { label?: string; date?: string; approx?: string }) => void | Promise<boolean>;
}): JSX.Element {
  const when = event.date ?? event.approx ?? '';
  return (
    <div className={styles.tlRow}>
      <div className={styles.tlWhen}>
        <TextInput
          aria-label={`When “${event.label}” happened`}
          defaultValue={when}
          disabled={busy}
          onBlur={(e) => {
            const next = e.currentTarget.value.trim();
            if (next === when) return;
            void onSave(whenFields(next, { clear: true }));
          }}
        />
      </div>
      <div className={styles.tlWhat}>
        <TextInput
          aria-label={`Edit the moment “${event.label}”`}
          defaultValue={event.label}
          disabled={busy}
          onBlur={(e) => {
            const next = e.currentTarget.value.trim();
            if (next && next !== event.label) void onSave({ label: next });
          }}
        />
      </div>
      <div className={styles.tlActions}>
        {event.userEdited ? (
          <span
            className={styles.tlMine}
            title="You added or corrected this — your biographer won’t change it back"
          >
            yours
          </span>
        ) : null}
        {confirming ? (
          <>
            <Text size="sm" tone="tertiary">
              Remove it?
            </Text>
            <Button
              variant="ghost"
              className={styles.dangerAction}
              disabled={busy}
              onClick={onConfirmDelete}
            >
              Remove
            </Button>
            <Button variant="ghost" onClick={onCancelDelete}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            className={styles.dangerAction}
            aria-label={`Remove “${event.label}” from your timeline`}
            disabled={busy}
            onClick={onArmDelete}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
