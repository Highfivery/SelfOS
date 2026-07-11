import { useRef, useState } from 'react';
import { ImagePlus, Lock, X } from 'lucide-react';
import type { TogetherMessageView, TogetherSessionView } from '@shared/schemas';
import {
  AttachmentThumb,
  Banner,
  Button,
  IconButton,
  Inline,
  Markdown,
  Text,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import {
  downscaleImage,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type PendingAttachment,
} from '../sessions/downscaleImage';
import { useSessionStore } from '../../../stores/sessionStore';
import { useTogetherStore } from '../../../stores/togetherStore';
import { TogetherAttachments } from './TogetherAttachments';
import styles from './Together.module.css';

/** Initials avatar — theme-safe accent tint (colored per-person avatars can't hold contrast across themes). */
function Avatar({ name }: { name: string }): JSX.Element {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

function nameFor(session: TogetherSessionView, personId: string): string {
  return session.participants.find((p) => p.personId === personId)?.displayName ?? 'Someone';
}

function MessageBubble({
  message,
  session,
  isMine,
}: {
  message: TogetherMessageView;
  session: TogetherSessionView;
  isMine: boolean;
}): JSX.Element {
  const isCoach = message.role === 'assistant';
  const author = isCoach ? 'Coach' : nameFor(session, message.authorPersonId);
  const classes = [
    styles.bubbleRow,
    isMine ? styles.bubbleMine : '',
    message.privateAside ? styles.bubbleAside : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes}>
      {!isMine ? <Avatar name={author} /> : null}
      <div className={styles.bubble}>
        <Inline gap={1} align="center">
          <Text size="xs" tone="secondary" weight={600}>
            {author}
          </Text>
          {message.privateAside ? (
            <span className={styles.asideTag}>
              <Lock size={11} aria-hidden="true" /> Private to the coach
            </span>
          ) : null}
        </Inline>
        {isCoach ? (
          <Markdown>{message.content}</Markdown>
        ) : (
          <>
            {message.content ? <Text className={styles.bubbleText}>{message.content}</Text> : null}
            {message.attachments && message.attachments.length > 0 ? (
              <TogetherAttachments sessionId={session.id} attachments={message.attachments} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** The composer with the private-aside toggle (58 §3.6) + image attachments (§6.1) — restyles when armed. */
function TogetherComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string, aside: boolean, pending: PendingAttachment[]) => Promise<void>;
}): JSX.Element {
  const [text, setText] = useState('');
  const [aside, setAside] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !disabled && (text.trim().length > 0 || pending.length > 0);

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return;
    setAddError(null);
    for (const file of Array.from(files)) {
      if (pending.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        setAddError(`Up to ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`);
        break;
      }
      try {
        const attachment = await downscaleImage(file);
        setPending((prev) => [...prev, attachment].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
      } catch {
        setAddError('That image couldn’t be added.');
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = async (): Promise<void> => {
    if (!canSend) return;
    const snapshot = text.trim();
    const wasAside = aside;
    const sentPending = pending;
    setText('');
    setPending([]);
    setAddError(null);
    // Reset the aside toggle after each send — a private aside is a deliberate act each time (§3.6).
    setAside(false);
    await onSend(snapshot, wasAside, sentPending);
  };

  return (
    <div className={[styles.composer, aside ? styles.composerAside : ''].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={styles.asideToggle}
        aria-pressed={aside}
        onClick={() => setAside((v) => !v)}
      >
        <Lock size={13} aria-hidden="true" />
        {aside ? 'Private to the coach' : 'Write privately to the coach'}
      </button>
      {aside ? (
        <Text size="xs" tone="secondary">
          Only the coach sees this note in the conversation. Your partner won’t see it here — or
          that you wrote one.
        </Text>
      ) : null}
      {pending.length > 0 ? (
        <ul className={styles.pendingRow} aria-label="Attachments">
          {pending.map((p, i) => (
            <li key={p.id} className={styles.pendingItem}>
              <AttachmentThumb
                src={`data:${p.mime};base64,${p.base64}`}
                alt={`Attachment ${i + 1}`}
              />
              <IconButton
                aria-label={`Remove attachment ${i + 1}`}
                onClick={() => setPending((list) => list.filter((a) => a.id !== p.id))}
              >
                <X size={12} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      {addError ? <Banner tone="danger">{addError}</Banner> : null}
      <textarea
        className={styles.composerInput}
        value={text}
        disabled={disabled}
        placeholder={aside ? 'A private note to the coach…' : 'Write a message…'}
        aria-label={aside ? 'Private note to the coach' : 'Message'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <Inline gap={2} align="center" justify="between">
        <IconButton
          aria-label="Attach image"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          <ImagePlus size={16} aria-hidden="true" />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => void addFiles(e.target.files)}
        />
        <Button onClick={() => void submit()} disabled={!canSend}>
          Send
        </Button>
      </Inline>
    </div>
  );
}

/** The session thread (58 §3.6): author-attributed bubbles, a private-aside composer, turn state, crisis footer. */
export function TogetherThread({
  session,
  onPrep,
}: {
  session: TogetherSessionView;
  onPrep: () => void;
}): JSX.Element {
  const me = useSessionStore((s) => s.activePerson?.id ?? null);
  const sending = useTogetherStore((s) => s.sending);
  const streaming = useTogetherStore((s) => s.streaming);
  const error = useTogetherStore((s) => s.error);
  const send = useTogetherStore((s) => s.sendMessage);
  const retry = useTogetherStore((s) => s.retry);

  const other = session.participants.find((p) => p.personId !== me);
  const turnLabel = session.yourTurn
    ? 'Your turn'
    : `Waiting for ${other?.displayName ?? 'your partner'}`;

  return (
    <div className={styles.thread}>
      <div className={styles.threadHead}>
        <Text weight={600} className={styles.cardTitle}>
          {session.topic ?? 'Together'}
        </Text>
        <Inline gap={2} align="center">
          <span className={styles.turnPill} data-turn={session.yourTurn ? 'you' : 'them'}>
            {turnLabel}
          </span>
          <Button variant="secondary" onClick={onPrep}>
            <Lock size={13} aria-hidden="true" /> Prep privately
          </Button>
        </Inline>
      </div>

      <div className={styles.messages} aria-busy={sending} data-testid="together-thread">
        {session.messages.length === 0 ? (
          <Text tone="secondary">
            This is the start of your conversation. Say what’s on your mind — the coach will help
            you both find your way through it.
          </Text>
        ) : (
          session.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              session={session}
              isMine={m.role === 'user' && m.authorPersonId === me}
            />
          ))
        )}
        {sending && streaming ? (
          <div className={styles.bubbleRow}>
            <Avatar name="Coach" />
            <div className={styles.bubble}>
              <Text size="xs" tone="secondary" weight={600}>
                Coach
              </Text>
              <Markdown>{streaming}</Markdown>
            </div>
          </div>
        ) : sending ? (
          <Text tone="secondary" size="sm">
            Coach is thinking…
          </Text>
        ) : null}
      </div>

      {error ? (
        <div className={styles.threadBanner}>
          <Banner tone="danger">
            <Inline gap={2} align="center" wrap>
              <span>{error}</span>
              <Button variant="secondary" onClick={() => void retry()} disabled={sending}>
                Try again
              </Button>
            </Inline>
          </Banner>
        </div>
      ) : null}

      <TogetherComposer
        disabled={sending}
        onSend={async (text, aside, pending) => {
          await send(text, aside, pending);
        }}
      />
      <CrisisFooter />
    </div>
  );
}
