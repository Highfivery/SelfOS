import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useConversationStore } from '../../../stores/conversationStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import type { SessionStatus } from '@shared/schemas';
import { stripWrapUpMarker } from '@selfos/core/conversations';
import {
  Banner,
  Button,
  Heading,
  IconButton,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { Composer } from './Composer';
import { CrisisFooter } from './CrisisFooter';
import { SessionStatusPill } from './SessionStatusPill';
import { SessionStatusMenu } from './SessionStatusMenu';
import { SessionCostIndicator } from './SessionCostIndicator';
import { WrapUpCard } from './WrapUpCard';
import { WrapUpSuggestion } from './WrapUpSuggestion';
import { SESSION_STATUS_LABEL, SESSION_STATUSES } from './sessionStatus';
import styles from './Sessions.module.css';

type Filter = 'all' | SessionStatus;

/** The coaching Sessions surface (05/09): list with status + cost, streaming thread, lifecycle, summary. */
export function Sessions(): JSX.Element {
  const [aiEnabled] = useSetting('ai.enabled');
  const [autoSummarize] = useSetting('sessions.autoSummarizeOnEnd');
  const [memoryEnabled] = useSetting('sessions.memoryEnabled');
  const isAdmin = useSessionStore((s) => s.can('budgets.manage'));
  const [hasKey, setHasKey] = useState(false);

  const conversations = useConversationStore((s) => s.conversations);
  const sessionCosts = useConversationStore((s) => s.sessionCosts);
  const activeId = useConversationStore((s) => s.activeId);
  const activeStatus = useConversationStore((s) => s.activeStatus);
  const activeInsightId = useConversationStore((s) => s.activeInsightId);
  const activeInsightStale = useConversationStore((s) => s.activeInsightStale);
  const messages = useConversationStore((s) => s.messages);
  const streaming = useConversationStore((s) => s.streaming);
  const sending = useConversationStore((s) => s.sending);
  const summarizing = useConversationStore((s) => s.summarizing);
  const wrapUp = useConversationStore((s) => s.wrapUp);
  const wrapUpSuggested = useConversationStore((s) => s.wrapUpSuggested);
  const suggestionDismissed = useConversationStore((s) => s.suggestionDismissed);
  const error = useConversationStore((s) => s.error);
  const load = useConversationStore((s) => s.load);
  const newConversation = useConversationStore((s) => s.newConversation);
  const open = useConversationStore((s) => s.open);
  const send = useConversationStore((s) => s.send);
  const remove = useConversationStore((s) => s.remove);
  const rename = useConversationStore((s) => s.rename);
  const setStatus = useConversationStore((s) => s.setStatus);
  const summarize = useConversationStore((s) => s.summarize);
  const dismissSuggestion = useConversationStore((s) => s.dismissSuggestion);
  const dismissWrapUp = useConversationStore((s) => s.dismissWrapUp);
  const appendChunk = useConversationStore((s) => s.appendChunk);

  const navigate = useNavigate();
  const threadRef = useRef<HTMLDivElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  // On mobile the two panes stack into a master–detail: the list, then a full-screen thread with a
  // back affordance. Desktop ignores this (both panes always show via CSS).
  const [view, setView] = useState<'list' | 'thread'>('list');

  const openConversation = (id: string): void => {
    void open(id);
    setView('thread');
  };
  const startNew = (): void => {
    newConversation();
    setView('thread');
  };

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => window.selfos?.onChatChunk(appendChunk), [appendChunk]);
  useEffect(() => {
    void (async () => {
      setHasKey(Boolean(await window.selfos?.secretHas({ id: ANTHROPIC_API_KEY_ID })));
    })();
  }, []);
  useEffect(() => {
    threadRef.current?.scrollTo?.(0, threadRef.current.scrollHeight);
  }, [messages, streaming]);

  const configured = aiEnabled && hasKey;
  // Summarizing is only meaningful when AI is configured AND session memory is on (the service refuses
  // otherwise) — so every summarize affordance is gated on both, never offering a button that can only fail.
  const summarizeReady = configured && memoryEnabled !== false;
  // When unconfigured, keep the detail pane (the connect CTA) in view on mobile.
  const effectiveView = configured ? view : 'thread';

  // Completing is the trigger for summarize (09 §14.2): with auto-summarize off (default), completing
  // just completes — the thread then offers summarize so the user confirms before any spend.
  const completeSession = (id: string): void => {
    void (async () => {
      await setStatus(id, 'complete');
      if (autoSummarize && summarizeReady) await summarize(id);
    })();
  };
  const completeAndSummarize = (id: string): void => {
    void (async () => {
      await setStatus(id, 'complete');
      await summarize(id);
    })();
  };
  const handleSetStatus = (id: string, status: SessionStatus): void => {
    if (status === 'complete') completeSession(id);
    else void setStatus(id, status);
  };

  const filtered = useMemo(
    () => (filter === 'all' ? conversations : conversations.filter((c) => c.status === filter)),
    [conversations, filter],
  );

  const filterOptions = [
    { value: 'all' as const, label: 'All' },
    ...SESSION_STATUSES.map((s) => ({ value: s, label: SESSION_STATUS_LABEL[s] })),
  ];

  // A completed session that hasn't been summarized yet (or whose summary is stale) can be summarized.
  const canSummarizeActive =
    summarizeReady &&
    activeId !== null &&
    activeStatus === 'complete' &&
    (!activeInsightId || activeInsightStale);
  // Offer "Complete & summarize" from a menu only when it would actually summarize: AI+memory ready and the
  // session isn't already complete (re-summarizing a complete session goes through the stale re-run path).
  const canCompleteAndSummarize = (status: SessionStatus): boolean =>
    summarizeReady && status !== 'complete';
  const showSuggestion =
    summarizeReady &&
    activeId !== null &&
    wrapUpSuggested &&
    !suggestionDismissed &&
    activeStatus !== 'complete' &&
    !summarizing;

  return (
    <div className={styles.layout} data-view={effectiveView}>
      <aside className={styles.sidebar} aria-label="Conversations">
        <Button variant="secondary" onClick={startNew}>
          <Plus size={16} aria-hidden="true" />
          New session
        </Button>
        <SegmentedControl
          aria-label="Filter sessions by status"
          options={filterOptions}
          value={filter}
          onChange={(value) => setFilter(value as Filter)}
        />
        <Stack gap={1}>
          {filtered.map((conversation) => (
            <div
              key={conversation.id}
              className={
                conversation.id === activeId ? `${styles.conv} ${styles.convActive}` : styles.conv
              }
            >
              {renamingId === conversation.id ? (
                <TextInput
                  aria-label="Session title"
                  defaultValue={conversation.title}
                  autoFocus
                  onBlur={(event) => {
                    void rename(conversation.id, event.target.value);
                    setRenamingId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.convOpen}
                    onClick={() => openConversation(conversation.id)}
                  >
                    <MessageCircle size={14} aria-hidden="true" />
                    <span className={styles.convTitle}>{conversation.title}</span>
                  </button>
                  <div className={styles.convMeta}>
                    <SessionStatusPill status={conversation.status} />
                    <SessionCostIndicator cost={sessionCosts[conversation.id]} isAdmin={isAdmin} />
                    <span className={styles.convSpacer} />
                    <SessionStatusMenu
                      title={conversation.title}
                      status={conversation.status}
                      onSetStatus={(status) => handleSetStatus(conversation.id, status)}
                      {...(canCompleteAndSummarize(conversation.status)
                        ? { onCompleteAndSummarize: () => completeAndSummarize(conversation.id) }
                        : {})}
                    />
                    <IconButton
                      aria-label={`Rename ${conversation.title}`}
                      onClick={() => setRenamingId(conversation.id)}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      aria-label={`Delete ${conversation.title}`}
                      onClick={() => void remove(conversation.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </IconButton>
                  </div>
                </>
              )}
            </div>
          ))}
          {filtered.length === 0 ? (
            <Text tone="secondary" size="sm">
              {conversations.length === 0
                ? 'No sessions yet.'
                : `No ${SESSION_STATUS_LABEL[filter as SessionStatus]?.toLowerCase()} sessions.`}
            </Text>
          ) : null}
        </Stack>
      </aside>

      <section className={styles.main}>
        {configured ? (
          <button type="button" className={styles.back} onClick={() => setView('list')}>
            <ArrowLeft size={16} aria-hidden="true" />
            Conversations
          </button>
        ) : null}
        {!configured ? (
          <div className={styles.empty}>
            <Stack gap={3} align="center">
              <Heading level={3}>Connect Claude to start</Heading>
              <Text tone="secondary">Enable AI and add your key to begin a session.</Text>
              <Button variant="primary" onClick={() => navigate('/settings')}>
                Open Settings
              </Button>
            </Stack>
          </div>
        ) : (
          <>
            {activeId !== null ? (
              <div className={styles.threadHead}>
                <SessionStatusPill status={activeStatus} />
                <span className={styles.convSpacer} />
                <SessionStatusMenu
                  title="this session"
                  status={activeStatus}
                  onSetStatus={(status) => handleSetStatus(activeId, status)}
                  {...(canCompleteAndSummarize(activeStatus)
                    ? { onCompleteAndSummarize: () => completeAndSummarize(activeId) }
                    : {})}
                />
              </div>
            ) : null}

            <div className={styles.thread} ref={threadRef} aria-live="polite" aria-busy={sending}>
              {messages.length === 0 && !streaming && !sending ? (
                <div className={styles.empty}>
                  <Text tone="secondary">What’s on your mind?</Text>
                </div>
              ) : (
                <Stack gap={3}>
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={message.role === 'user' ? styles.userMsg : styles.coachMsg}
                    >
                      {message.content}
                    </div>
                  ))}
                  {streaming ? (
                    <div className={styles.coachMsg}>{stripWrapUpMarker(streaming)}</div>
                  ) : null}
                  {sending && !streaming ? (
                    <div className={`${styles.coachMsg} ${styles.thinking}`}>
                      Coach is thinking…
                    </div>
                  ) : null}
                </Stack>
              )}
            </div>

            {wrapUp ? <WrapUpCard insight={wrapUp} onDismiss={dismissWrapUp} /> : null}

            {canSummarizeActive && !wrapUp ? (
              <Button
                variant="secondary"
                onClick={() => activeId && void summarize(activeId)}
                disabled={summarizing}
              >
                <Sparkles size={16} aria-hidden="true" />
                {summarizing
                  ? 'Summarizing…'
                  : activeInsightStale
                    ? 'Re-summarize this session'
                    : 'Summarize this session'}
              </Button>
            ) : null}

            {showSuggestion ? (
              <WrapUpSuggestion
                busy={summarizing}
                onAccept={() => activeId && completeAndSummarize(activeId)}
                onDismiss={dismissSuggestion}
              />
            ) : null}

            {error ? <Banner tone="warning">{error}</Banner> : null}

            <Composer disabled={sending} onSend={(text) => void send(text)} />
          </>
        )}
      </section>

      <div className={styles.crisisWrap}>
        <CrisisFooter />
      </div>
    </div>
  );
}
