import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import type { NoteRow, NoteType } from '@selfos/core/schemas';
import {
  AdminOnlyBadge,
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Inline,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '../../../design-system/components';
import { useNoteStore } from '../../../stores/noteStore';
import { useSessionStore } from '../../../stores/sessionStore';
import styles from './Notes.module.css';

/**
 * Notes (76 §3) — the owner writes to ONE person, and the recipient is chosen before a word of it
 * exists, so everything after is written for them (the 08 §17 recipient-bound pattern).
 *
 * Owner-only: the route and the nav entry are both gated on `notes.manage`, and the bridge re-checks it
 * on every call — this surface is convenience, never the boundary.
 */

type Step = { kind: 'list' } | { kind: 'who' } | { kind: 'compose' } | { kind: 'preview' };

const TYPE_LABEL: Record<NoteType, string> = {
  announcement: 'Announcement',
  question: 'Question',
  suggestion: 'Suggestion',
};

/** What each type lets the recipient DO — the reason the choice exists at all. */
const TYPE_HINT: Record<NoteType, string> = {
  announcement: 'nothing to tap',
  question: 'tappable answers',
  suggestion: 'keen / maybe / not for me',
};

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

const when = (iso?: string): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function Notes(): JSX.Element {
  const canManage = useSessionStore((s) => s.can('notes.manage'));
  const activePersonId = useSessionStore((s) => s.activePerson?.id);
  const { rows, recipients, loaded, drafting, error, draft } = useNoteStore();
  const { load, loadRecipients, setDraft, requestDraft, send, setEmail, remove } = useNoteStore();

  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [type, setType] = useState<NoteType>('suggestion');
  const [mode, setMode] = useState<'ai' | 'self'>('ai');
  const [intent, setIntent] = useState('');
  const [addressDraft, setAddressDraft] = useState('');
  const [sent, setSent] = useState<{ emailed: boolean } | null>(null);

  // The STORE is reset centrally, in AppShell's per-person effect — that is the canonical place, and
  // `personScopedStores.test` fails if a resettable store is missing from it. This effect only owns the
  // local wizard state, which lives here rather than in the store.
  useEffect(() => {
    setStep({ kind: 'list' });
    setRecipientId(null);
    void load();
    void loadRecipients();
  }, [activePersonId, load, loadRecipients]);

  if (!canManage) return <div className={styles.page} />;

  const recipient = recipients.find((r) => r.personId === recipientId) ?? null;

  const startNew = (): void => {
    setDraft(null);
    setIntent('');
    setSent(null);
    setRecipientId(null);
    setStep({ kind: 'who' });
  };

  const doSend = async (): Promise<void> => {
    if (!recipientId) return;
    const result = await send({ recipientPersonId: recipientId, type, drafted: mode });
    if (result?.ok) {
      setSent({ emailed: result.emailed });
      setStep({ kind: 'list' });
    }
  };

  // ── The list ────────────────────────────────────────────────────────────────────────────────────
  if (step.kind === 'list') {
    const emailed = rows.filter((r) => r.note.emailedAt);
    const stats = [
      { key: 'Sent', value: rows.length },
      { key: 'Emailed', value: emailed.length },
      { key: 'Opened', value: emailed.filter((r) => r.delivery?.openedAt).length },
      { key: 'Clicked', value: emailed.filter((r) => r.delivery?.clickedAt).length },
    ];

    return (
      <div className={styles.page}>
        <Inline gap={3} align="start" wrap>
          <Stack gap={1}>
            <Inline gap={2} align="center" wrap>
              <Heading level={1}>Notes</Heading>
              <AdminOnlyBadge />
            </Inline>
            <Text size="sm" tone="secondary">
              A note to one person in your household, written for them. It waits in their SelfOS
              inbox, and emails them so it reaches them if they haven’t opened the app.
            </Text>
          </Stack>
          <Button onClick={startNew}>
            <Plus size={15} aria-hidden="true" /> Write a note
          </Button>
        </Inline>

        {sent ? (
          <Banner tone="info">
            {sent.emailed
              ? 'Sent. It’s in their inbox and on its way by email.'
              : 'Saved to their SelfOS inbox. No email went out — they have no address on file.'}
          </Banner>
        ) : null}

        {loaded && rows.length > 0 ? (
          <div className={styles.stats}>
            {stats.map((s) => (
              <div key={s.key} className={styles.stat}>
                <div className={styles.statValue}>{s.value}</div>
                <div className={styles.statKey}>{s.key}</div>
              </div>
            ))}
          </div>
        ) : null}

        {loaded && rows.length === 0 ? (
          <Card>
            <Stack gap={2}>
              <Text weight={600}>Nothing written yet</Text>
              <Text size="sm" tone="secondary">
                A note is one message to one person — something new they can try, a question worth
                asking, or a nudge toward something you think they’d like.
              </Text>
            </Stack>
          </Card>
        ) : null}

        {rows.map((row) => (
          <NoteListRow key={row.note.id} row={row} onRemove={() => void remove(row.note.id)} />
        ))}
      </div>
    );
  }

  // ── Step 1: who is it for ───────────────────────────────────────────────────────────────────────
  if (step.kind === 'who') {
    return (
      <div className={styles.page}>
        <Inline gap={3} align="center" wrap>
          <Button variant="secondary" onClick={() => setStep({ kind: 'list' })}>
            <ArrowLeft size={15} aria-hidden="true" /> Notes
          </Button>
          <Text size="sm" tone="tertiary">
            Step 1 of 3
          </Text>
        </Inline>

        <Stack gap={1}>
          <Heading level={1}>Who is this for?</Heading>
          <Text size="sm" tone="secondary">
            One person. The note is written for them, from what SelfOS knows about them.
          </Text>
        </Stack>

        <div role="radiogroup" aria-label="Who is this note for?">
          {recipients.map((r) => (
            <button
              key={r.personId}
              type="button"
              role="radio"
              aria-checked={recipientId === r.personId}
              className={`${styles.person} ${recipientId === r.personId ? styles.personOn : ''}`}
              onClick={() => {
                setRecipientId(r.personId);
                setAddressDraft('');
              }}
            >
              <span className={styles.avatar} aria-hidden="true">
                {initials(r.displayName)}
              </span>
              <span className={styles.who}>
                <span className={styles.whoName}>{r.displayName}</span>
                <span className={styles.whoAddress}>
                  {r.reachableByEmail ? r.email : 'No email address — SelfOS only'}
                </span>
              </span>
            </button>
          ))}
        </div>

        {recipients.length === 0 ? (
          <Banner tone="info" role="none">
            There’s nobody else in your household yet. Add someone in People first.
          </Banner>
        ) : null}

        {/* Reviving `Person.email`: it exists on the schema but nothing ever wrote it (76 §5.5). */}
        {recipient && !recipient.reachableByEmail ? (
          <Card>
            <Stack gap={3}>
              <Text size="sm" tone="secondary">
                {recipient.displayName} has no email address yet, so this note will reach their
                SelfOS inbox only. Add one and it’ll email them too.
              </Text>
              <Inline gap={2} align="end" wrap>
                <Field label={`Email address for ${recipient.displayName}`}>
                  {(field) => (
                    <TextInput
                      {...field}
                      value={addressDraft}
                      placeholder="name@example.com"
                      onChange={(e) => setAddressDraft(e.target.value)}
                    />
                  )}
                </Field>
                <Button
                  variant="secondary"
                  disabled={!addressDraft.includes('@')}
                  onClick={() => void setEmail(recipient.personId, addressDraft)}
                >
                  Save to their profile
                </Button>
              </Inline>
            </Stack>
          </Card>
        ) : null}

        <Inline gap={2} justify="end">
          <Button disabled={!recipientId} onClick={() => setStep({ kind: 'compose' })}>
            Write for {recipient?.displayName ?? 'them'} <ArrowRight size={15} aria-hidden="true" />
          </Button>
        </Inline>
      </div>
    );
  }

  // ── Step 2: compose ─────────────────────────────────────────────────────────────────────────────
  if (step.kind === 'compose') {
    return (
      <div className={styles.page}>
        <Inline gap={3} align="center" wrap>
          <Button variant="secondary" onClick={() => setStep({ kind: 'who' })}>
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </Button>
          <Text size="sm" tone="tertiary">
            Step 2 of 3
          </Text>
        </Inline>

        <Stack gap={1}>
          <Heading level={1}>A note for {recipient?.displayName ?? 'them'}</Heading>
          <Text size="sm" tone="secondary">
            {recipient?.reachableByEmail ? recipient.email : 'SelfOS inbox only'}
          </Text>
        </Stack>

        <Inline gap={2} wrap>
          <Button variant={mode === 'ai' ? 'primary' : 'secondary'} onClick={() => setMode('ai')}>
            <Sparkles size={15} aria-hidden="true" /> Draft something
          </Button>
          <Button
            variant={mode === 'self' ? 'primary' : 'secondary'}
            onClick={() => {
              setMode('self');
              if (!draft) setDraft({ subject: '', body: '', answers: [] });
            }}
          >
            Write it myself
          </Button>
        </Inline>

        {mode === 'ai' ? (
          <Card>
            <Stack gap={4}>
              <Banner tone="info" role="none">
                Written from everything SelfOS knows about {recipient?.displayName ?? 'them'} —
                sessions, dreams, goals, memory, questionnaire answers, private notes.
              </Banner>

              <Stack gap={2}>
                <Text size="sm" weight={600}>
                  What kind of note is this?
                </Text>
                <Text size="sm" tone="secondary">
                  This decides what they can do with it.
                </Text>
                <div className={styles.chipRow} role="radiogroup" aria-label="Kind of note">
                  {(Object.keys(TYPE_LABEL) as NoteType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={type === t}
                      className={`${styles.typeChip} ${type === t ? styles.typeChipOn : ''}`}
                      onClick={() => setType(t)}
                    >
                      {TYPE_LABEL[t]} · {TYPE_HINT[t]}
                    </button>
                  ))}
                </div>
              </Stack>

              <Field label="What are you thinking?" help="Rough is fine — a phrase is enough.">
                {(field) => (
                  <Textarea
                    {...field}
                    value={intent}
                    rows={3}
                    onChange={(e) => setIntent(e.target.value)}
                    placeholder="dream images are live now, thought she'd like it"
                  />
                )}
              </Field>

              <Inline gap={3} align="center" wrap>
                <Button
                  disabled={!intent.trim() || drafting}
                  aria-busy={drafting}
                  onClick={() =>
                    void requestDraft({
                      recipientPersonId: recipientId ?? '',
                      type,
                      intent: intent.trim(),
                    })
                  }
                >
                  <Sparkles size={15} aria-hidden="true" />{' '}
                  {drafting ? 'Drafting…' : `Draft it for ${recipient?.displayName ?? 'them'}`}
                </Button>
                <Text size="sm" tone="tertiary">
                  Uses your AI allowance
                </Text>
              </Inline>

              {error ? <Banner tone="warning">{error}</Banner> : null}
            </Stack>
          </Card>
        ) : null}

        {draft ? (
          <Card>
            <Stack gap={4}>
              <Field label="Subject">
                {(field) => (
                  <TextInput
                    {...field}
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Body">
                {(field) => (
                  <Textarea
                    {...field}
                    value={draft.body}
                    rows={7}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  />
                )}
              </Field>
              <Banner tone="info" role="none">
                Goes out as SelfOS — no sender, no signature. It reads as something the app noticed.
              </Banner>
            </Stack>
          </Card>
        ) : null}

        <Inline gap={2} justify="end">
          <Button
            disabled={!draft?.subject.trim() || !draft?.body.trim()}
            onClick={() => setStep({ kind: 'preview' })}
          >
            Preview <ArrowRight size={15} aria-hidden="true" />
          </Button>
        </Inline>
      </div>
    );
  }

  // ── Step 3: preview & send ──────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <Inline gap={3} align="center" wrap>
        <Button variant="secondary" onClick={() => setStep({ kind: 'compose' })}>
          <ArrowLeft size={15} aria-hidden="true" /> Back
        </Button>
        <Text size="sm" tone="tertiary">
          Step 3 of 3
        </Text>
      </Inline>

      <div className={styles.twoUp}>
        <Stack gap={2}>
          <Text size="sm" weight={600}>
            In their email
          </Text>
          <div className={styles.mailFrame}>
            <div className={styles.mailCard}>
              <p className={styles.mailSubject}>{draft?.subject}</p>
              <p className={styles.mailBody}>{draft?.body}</p>
              {draft && draft.answers.length > 0 ? (
                <div className={styles.mailButtons}>
                  {draft.answers.map((a) => (
                    <span key={a.label} className={styles.mailButton}>
                      {a.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <p className={styles.mailFoot}>
              SelfOS is a wellness tool, not therapy or medical care.
            </p>
          </div>
        </Stack>

        <Stack gap={2}>
          <Text size="sm" weight={600}>
            In their SelfOS inbox
          </Text>
          <Card>
            <Stack gap={2}>
              <Text weight={600}>{draft?.subject}</Text>
              <Text size="sm" tone="secondary">
                {draft?.body.split('\n')[0]}
              </Text>
            </Stack>
          </Card>
          <Banner tone="info" role="none">
            The inbox entry is the record — it stays findable after the email is buried. No sender
            is shown, here or in the email.
          </Banner>
        </Stack>
      </div>

      <Inline gap={2} justify="end" wrap>
        <Button variant="secondary" onClick={() => setStep({ kind: 'compose' })}>
          Keep editing
        </Button>
        <Button onClick={() => void doSend()}>
          <Send size={15} aria-hidden="true" /> Send to {recipient?.displayName ?? 'them'}
        </Button>
      </Inline>
    </div>
  );
}

/** One sent note. Delivery is a timeline, not a rate — at one recipient a percentage says nothing. */
function NoteListRow({ row, onRemove }: { row: NoteRow; onRemove: () => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const { note, recipientName, delivery } = row;

  return (
    <div className={styles.row}>
      <span className={styles.stripe} aria-hidden="true" />
      <div className={styles.rowMain}>
        <div className={styles.rowTitle}>{note.subject}</div>
        <div className={styles.meta}>
          <Text size="sm" tone="secondary">
            {recipientName} · {TYPE_LABEL[note.type]} · {when(note.createdAt)}
          </Text>
        </div>
        <div className={styles.timeline}>
          {note.emailedAt ? (
            <>
              <span className={styles.event}>
                <b>Delivered</b> {when(delivery?.deliveredAt ?? note.emailedAt)}
              </span>
              <span className={styles.event}>
                <b>Opened</b> {when(delivery?.openedAt)}
              </span>
              <span className={styles.event}>
                <b>Clicked</b> {when(delivery?.clickedAt)}
              </span>
            </>
          ) : (
            <span className={styles.event}>In SelfOS only — no email address on file</span>
          )}
        </div>
      </div>
      {confirming ? (
        <Inline gap={2} align="center">
          <Button variant="secondary" onClick={onRemove}>
            Delete
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </Inline>
      ) : (
        <Button
          variant="secondary"
          aria-label={`Delete note: ${note.subject}`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={14} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
