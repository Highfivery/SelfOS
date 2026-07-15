import { Fragment, useRef, useState } from 'react';
import { ImagePlus, Lock, MessageCirclePlus, Users, X } from 'lucide-react';
import type { TogetherMessageView, TogetherSessionView } from '@shared/schemas';
import {
  AttachmentThumb,
  Banner,
  Button,
  dayDividerLabel,
  IconButton,
  Inline,
  Markdown,
  MessageDayDivider,
  MessageTime,
  Text,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import {
  downscaleImage,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type PendingAttachment,
} from '../sessions/downscaleImage';
import { stripCoachMarkers } from '@selfos/core/conversations';
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
              <Lock size={11} aria-hidden="true" />{' '}
              {isCoach ? 'Private — from the coach, just for you' : 'Private to the coach'}
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
        <MessageTime iso={message.ts} />
      </div>
    </div>
  );
}

/**
 * The composer with an explicit AUDIENCE toggle (58 §3.6): every message is clearly either shared with the
 * partner or a private note only the coach sees. The choice is a segmented control (not a status label), the
 * whole composer visibly transforms in private mode, and the Send button reflects the audience — so public vs
 * private is unmistakable at every point. Plus image attachments (§6.1).
 */
function TogetherComposer({
  disabled,
  partnerName,
  onSend,
}: {
  disabled: boolean;
  partnerName: string;
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
      <div className={styles.audienceToggle} role="group" aria-label="Who sees this">
        <button
          type="button"
          className={styles.audienceOption}
          data-active={!aside}
          aria-pressed={!aside}
          onClick={() => setAside(false)}
        >
          <Users size={15} aria-hidden="true" />
          <span className={styles.audienceLabel}>Shared with {partnerName}</span>
        </button>
        <button
          type="button"
          className={styles.audienceOption}
          data-active={aside}
          aria-pressed={aside}
          onClick={() => setAside(true)}
        >
          <Lock size={15} aria-hidden="true" />
          <span className={styles.audienceLabel}>Just the coach</span>
        </button>
      </div>
      {aside ? (
        <div className={styles.privateBanner}>
          <Lock size={16} aria-hidden="true" />
          <Text size="sm" tone="accent">
            Private note. Only the coach sees this — {partnerName} won’t see it, or that you wrote
            one.
          </Text>
        </div>
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
        className={[styles.composerInput, aside ? styles.composerInputPrivate : '']
          .filter(Boolean)
          .join(' ')}
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
      <Inline gap={2} align="center" justify="between" wrap>
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
        <Inline gap={2} align="center">
          {/* Who-sees-this, spelled out again right next to Send — the last, unmissable cue. */}
          <span className={styles.audienceHint} data-aside={aside}>
            {aside ? <Lock size={14} aria-hidden="true" /> : <Users size={14} aria-hidden="true" />}
            {aside ? 'Only the coach' : `You and ${partnerName} both see this`}
          </span>
          <Button onClick={() => void submit()} disabled={!canSend}>
            {aside ? (
              <>
                <Lock size={14} aria-hidden="true" /> Send privately
              </>
            ) : (
              'Send'
            )}
          </Button>
        </Inline>
      </Inline>
    </div>
  );
}

/**
 * The session thread (58 §3.6): author-attributed bubbles, a private-aside composer, turn state, crisis footer.
 * When `completed` (the session is wrapped up, §3.8), the composer collapses behind a "Reopen to keep talking"
 * button so the session reads as ended — one tap reveals the composer, and the next shared message reopens the
 * session (deriving it back to `active`, §4.3).
 */
export function TogetherThread({
  session,
  onPrep,
  completed = false,
}: {
  session: TogetherSessionView;
  onPrep: () => void;
  completed?: boolean;
}): JSX.Element {
  const me = useSessionStore((s) => s.activePerson?.id ?? null);
  const sending = useTogetherStore((s) => s.sending);
  const streaming = useTogetherStore((s) => s.streaming);
  const error = useTogetherStore((s) => s.error);
  const send = useTogetherStore((s) => s.sendMessage);
  const retry = useTogetherStore((s) => s.retry);
  // On a wrapped-up session the composer stays hidden until the person deliberately reopens it (§3.8).
  const [reopened, setReopened] = useState(false);

  const other = session.participants.find((p) => p.personId !== me);
  const turnLabel = completed
    ? 'Wrapped up'
    : session.yourTurn
      ? 'Your turn'
      : `Waiting for ${other?.displayName ?? 'your partner'}`;

  const steps = session.guide?.kind === 'structured' ? (session.guide.steps ?? []) : [];
  const currentStep = session.guideStep ?? 0;

  return (
    <div className={styles.thread}>
      <div className={styles.threadHead}>
        <Text weight={600} className={styles.cardTitle}>
          {session.guide?.title ?? session.topic ?? 'Together'}
        </Text>
        <Inline gap={2} align="center">
          <span
            className={styles.turnPill}
            data-turn={completed ? 'done' : session.yourTurn ? 'you' : 'them'}
          >
            {turnLabel}
          </span>
          <Button variant="secondary" onClick={onPrep}>
            <Lock size={13} aria-hidden="true" /> Prep privately
          </Button>
        </Inline>
      </div>

      {steps.length > 0 ? (
        <ol className={styles.stepper} aria-label="Exercise steps">
          {steps.map((step, i) => (
            <li
              key={i}
              className={styles.stepItem}
              data-state={i < currentStep ? 'done' : i === currentStep ? 'current' : 'todo'}
              aria-current={i === currentStep ? 'step' : undefined}
            >
              <span className={styles.stepDot} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.stepLabel}>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.messages} aria-busy={sending} data-testid="together-thread">
        {session.messages.length === 0 ? (
          <Text tone="secondary">
            This is the start of your conversation. Say what’s on your mind — the coach will help
            you both find your way through it.
          </Text>
        ) : (
          session.messages.map((m, i) => {
            const divider = dayDividerLabel(session.messages[i - 1]?.ts, m.ts);
            return (
              <Fragment key={m.id}>
                {divider ? <MessageDayDivider label={divider} /> : null}
                <MessageBubble
                  message={m}
                  session={session}
                  isMine={m.role === 'user' && m.authorPersonId === me}
                />
              </Fragment>
            );
          })
        )}
        {sending && streaming ? (
          <div className={styles.bubbleRow}>
            <Avatar name="Coach" />
            <div className={styles.bubble}>
              <Text size="xs" tone="secondary" weight={600}>
                Coach
              </Text>
              {/* Strip coach markers (SUGGEST/AGREEMENT/CHALLENGE/STEP) from the LIVE stream too — a
                  trailing marker must never flash to the author mid-stream (mirrors Sessions). */}
              <Markdown>{stripCoachMarkers(streaming)}</Markdown>
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

      {completed && !reopened ? (
        <div className={styles.reopenBar}>
          <Text size="sm" tone="secondary">
            Sending a message reopens this session.
          </Text>
          <Button variant="secondary" onClick={() => setReopened(true)}>
            <MessageCirclePlus size={14} aria-hidden="true" /> Reopen to keep talking
          </Button>
        </div>
      ) : (
        <TogetherComposer
          disabled={sending}
          partnerName={other?.displayName ?? 'your partner'}
          onSend={async (text, aside, pending) => {
            await send(text, aside, pending);
          }}
        />
      )}
      <CrisisFooter />
    </div>
  );
}
