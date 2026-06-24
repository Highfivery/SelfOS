import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { Goal, GoalStatus } from '@shared/schemas';
import { effectiveGoalStatus } from '@shared/schemas';
import {
  Button,
  Card,
  GoalStatusChip,
  IconButton,
  Inline,
  Select,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { useGoalStore } from '../../../stores/goalStore';
import styles from './GoalCard.module.css';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The set-status dropdown (closed states included so a goal can be reopened). */
const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'inProgress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'abandoned', label: 'Let go' },
];

/**
 * One tracked goal / commitment in Memory (39-living-memory §3.1). Shows its text, derived status (a labelled,
 * non-colour-only chip), an optional due/horizon, and provenance (deep-linking to the source session like 20
 * §3.3). The user can set status, edit text/due, or delete. A goal that reads **stale** surfaces a gentle
 * "still working on it?" prompt with one-tap Still on it / Mark done / Let it go.
 */
export function GoalCard({ goal }: { goal: Goal }): JSX.Element {
  const navigate = useNavigate();
  const setStatus = useGoalStore((s) => s.setStatus);
  const update = useGoalStore((s) => s.update);
  const remove = useGoalStore((s) => s.remove);

  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [text, setText] = useState(goal.text);
  const [due, setDue] = useState(goal.due ?? '');

  const status = effectiveGoalStatus(goal, new Date());
  const isStale = status === 'stale';

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = (): Promise<void> =>
    run(async () => {
      await update({ goalId: goal.id, text, due });
      setEditing(false);
    });

  const provLink =
    goal.provenance.conversationId !== undefined
      ? () =>
          navigate('/sessions', {
            state: { focusConversationId: goal.provenance.conversationId },
          })
      : null;

  return (
    <Card className={styles.card}>
      <Stack gap={2}>
        <div className={styles.head}>
          {editing ? (
            <TextInput
              value={text}
              aria-label="Edit goal"
              onChange={(event) => setText(event.target.value)}
            />
          ) : (
            <Text className={styles.goalText}>{goal.text}</Text>
          )}
          <GoalStatusChip status={status} />
        </div>

        {editing ? (
          <label className={styles.dueField}>
            <Text size="sm" tone="secondary">
              Due date (optional)
            </Text>
            <TextInput
              type="date"
              value={due}
              aria-label="Goal due date"
              onChange={(event) => setDue(event.target.value)}
            />
          </label>
        ) : (
          <div className={styles.metaRow}>
            {goal.due ? (
              <Text size="sm" tone="secondary">
                Due {formatDate(goal.due)}
              </Text>
            ) : goal.horizon ? (
              <Text size="sm" tone="secondary">
                {goal.horizon}
              </Text>
            ) : null}
            {provLink ? (
              <button type="button" className={styles.provLink} onClick={provLink}>
                From a session on {formatDate(goal.provenance.at)} →
              </button>
            ) : (
              <Text size="sm" tone="tertiary">
                From a session on {formatDate(goal.provenance.at)}
              </Text>
            )}
          </div>
        )}

        {isStale && !editing ? (
          <div className={styles.stalePrompt} role="status">
            <Text size="sm" tone="secondary">
              This has been open a while — still working on it? Totally fine to let it go.
            </Text>
            <Inline gap={1} wrap>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void run(() => setStatus(goal.id, 'inProgress'))}
              >
                Still on it
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void run(() => setStatus(goal.id, 'done'))}
              >
                Mark done
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => setStatus(goal.id, 'abandoned'))}
              >
                Let it go
              </Button>
            </Inline>
          </div>
        ) : null}

        {editing ? (
          <Inline gap={2}>
            <Button size="sm" disabled={busy} onClick={() => void onSaveEdit()}>
              <Check size={14} aria-hidden="true" /> Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setText(goal.text);
                setDue(goal.due ?? '');
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </Inline>
        ) : confirmDelete ? (
          <Inline gap={2}>
            <Text size="sm" tone="secondary">
              Delete this goal?
            </Text>
            <Button size="sm" disabled={busy} onClick={() => void run(() => remove(goal.id))}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </Inline>
        ) : (
          <div className={styles.actions}>
            <Select
              aria-label={`Set status for: ${goal.text}`}
              value={goal.status === 'stale' ? 'open' : goal.status}
              disabled={busy}
              onChange={(event) =>
                void run(() => setStatus(goal.id, event.target.value as GoalStatus))
              }
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Inline gap={1}>
              <IconButton aria-label="Edit goal" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil size={14} aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label="Delete goal"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </IconButton>
            </Inline>
          </div>
        )}
      </Stack>
    </Card>
  );
}
