import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Plus, Sparkles } from 'lucide-react';
import {
  awaitingReply,
  isBlankReply,
  useConversationStore,
} from '../../../stores/conversationStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import { aiKeyResolved } from '../../aiAvailability';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import type { SessionStatus } from '@shared/schemas';
import type { ChallengeDomain } from '@shared/channels';
import { getExercise, stripCoachMarkers } from '@selfos/core/conversations';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import {
  Banner,
  Button,
  dayDividerLabel,
  Markdown,
  MessageDayDivider,
  MessageActions,
  MessageRow,
  RetryBanner,
  Select,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { Composer } from './Composer';
import type { PendingAttachment } from './downscaleImage';
import { MessageAttachments } from './MessageAttachments';
import { CrisisFooter } from './CrisisFooter';
import { SessionLauncher } from './SessionLauncher';
import { GuidedStepper } from './GuidedStepper';
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
  const activeGuideId = useConversationStore((s) => s.activeGuideId);
  const activeGuideStep = useConversationStore((s) => s.activeGuideStep);
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
  const startGuided = useConversationStore((s) => s.startGuided);
  const startChallenge = useConversationStore((s) => s.startChallenge);
  const startChallengeReflection = useConversationStore((s) => s.startChallengeReflection);
  const challengeCreated = useConversationStore((s) => s.challengeCreated);
  const dismissChallengeCreated = useConversationStore((s) => s.dismissChallengeCreated);
  const open = useConversationStore((s) => s.open);
  const send = useConversationStore((s) => s.send);
  const retry = useConversationStore((s) => s.retry);
  const rewind = useConversationStore((s) => s.rewind);
  const regenerateFrom = useConversationStore((s) => s.regenerateFrom);
  const loadGuidance = useGuidanceStore((s) => s.load);
  const remove = useConversationStore((s) => s.remove);
  const rename = useConversationStore((s) => s.rename);
  const setStatus = useConversationStore((s) => s.setStatus);
  const summarize = useConversationStore((s) => s.summarize);
  const dismissSuggestion = useConversationStore((s) => s.dismissSuggestion);
  const dismissWrapUp = useConversationStore((s) => s.dismissWrapUp);
  const appendChunk = useConversationStore((s) => s.appendChunk);

  const threadRef = useRef<HTMLDivElement>(null);
  const wrapUpRef = useRef<HTMLDivElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  // On mobile the two panes stack into a master–detail: the list, then a full-screen thread with a
  // back affordance. Desktop ignores this (both panes always show via CSS).
  const [view, setView] = useState<'list' | 'thread'>('list');

  const openConversation = (id: string): void => {
    void open(id);
    setView('thread');
  };

  // Deep-link from Memory's provenance link (20-memory-dashboard §3.3): open the referenced session.
  const location = useLocation();
  useEffect(() => {
    const focus = (location.state as { focusConversationId?: string } | null)?.focusConversationId;
    if (focus) {
      void open(focus);
      setView('thread');
    }
  }, [location.state, open]);
  const startNew = (): void => {
    newConversation();
    setView('thread');
  };
  // Free-start from the launcher: send creates the conversation, then the pane flips to the thread.
  const startFree = (text: string, attachments: PendingAttachment[]): void => {
    setView('thread');
    void send(text, attachments);
  };
  // Pick a guided exercise from the launcher/suggestions → start it and open the thread.
  const startGuidedSession = (guideId: string): void => {
    void startGuided(guideId).then((id) => {
      if (id) setView('thread');
    });
  };
  // Take on a challenge (52 §3.1) — start the challenge-coach session, then flip to the thread.
  const startChallengeSession = (domain?: ChallengeDomain): void => {
    void startChallenge(domain).then((id) => {
      if (id) setView('thread');
    });
  };
  // "Talk it through" (52 §3.5) — open a reflection session for a non-adult challenge.
  const talkChallengeThrough = (challengeId: string): void => {
    void startChallengeReflection(challengeId).then((id) => {
      if (id) setView('thread');
    });
  };

  useEffect(() => {
    void load();
    void loadGuidance();
  }, [load, loadGuidance]);
  useEffect(() => window.selfos?.onChatChunk(appendChunk), [appendChunk]);
  useEffect(() => {
    void (async () => {
      setHasKey(await aiKeyResolved('anthropic'));
    })();
  }, []);
  useEffect(() => {
    threadRef.current?.scrollTo?.(0, threadRef.current.scrollHeight);
  }, [messages, streaming]);
  // When a wrap-up card appears (summarized), scroll it to the TOP of the thread so its heading leads — it
  // lives inside the scroll container (not below it), so it can never overflow onto the pinned crisis footer.
  useEffect(() => {
    if (wrapUp) wrapUpRef.current?.scrollIntoView?.({ block: 'start' });
  }, [wrapUp]);

  const configured = aiEnabled && hasKey;
  // Summarizing is only meaningful when AI is configured AND session memory is on (the service refuses
  // otherwise) — so every summarize affordance is gated on both, never offering a button that can only fail.
  const summarizeReady = configured && memoryEnabled !== false;
  const effectiveView = view;
  // In a session thread once there's an active/seeded session or a turn in flight; otherwise the launcher
  // (16 §3.1) is the start state. The launcher renders even with AI off (catalog + static guided openers).
  const inThread = activeId !== null || messages.length > 0 || sending || streaming;
  // Drop the blank-assistant ghost (pre-05 §4.1) before rendering so the day-divider "previous" is the
  // previous SHOWN message, and never a hidden ghost.
  const shownMessages = messages.filter((message) => !isBlankReply(message));
  // A structured guided exercise shows its stepper beside the thread (16 §3.3).
  const activeExercise = activeGuideId ? getExercise(activeGuideId) : undefined;
  const stepperSteps =
    activeExercise?.kind === 'structured' && activeExercise.steps ? activeExercise.steps : null;

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
  // The manual "Wrap up & reflect" affordance below the composer (09 §14.2): a first-class way to end + analyze
  // an in-progress session on demand (same action as the ⋯ menu's "complete & summarize"). Hidden when it
  // can't analyze (AI/memory off → `summarizeReady` false), when there's nothing to reflect on yet, once the
  // session is already complete, and while the proactive wrap-up suggestion is showing (so there's never two
  // wrap-up controls at once).
  const canWrapUp =
    summarizeReady &&
    activeId !== null &&
    messages.length > 0 &&
    activeStatus !== 'complete' &&
    !showSuggestion &&
    // Not while the last turn is still awaiting a reply (a live failure or a legacy dead-end): retry first, so
    // you never summarize an unanswered turn — and the "Try again" banner isn't stacked with a wrap-up button.
    !awaitingReply(messages);

  return (
    <div className={styles.layout} data-view={effectiveView}>
      <aside className={styles.sidebar} aria-label="Conversations">
        <Button variant="secondary" onClick={startNew}>
          <Plus size={16} aria-hidden="true" />
          New session
        </Button>
        <Select
          className={styles.filterSelect}
          aria-label="Filter sessions by status"
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
        >
          {filterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === 'all' ? 'All sessions' : option.label}
            </option>
          ))}
        </Select>
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
                    <span className={styles.convInfo}>
                      <SessionStatusPill status={conversation.status} />
                      <SessionCostIndicator
                        cost={sessionCosts[conversation.id]}
                        isAdmin={isAdmin}
                      />
                    </span>
                    <span className={styles.convActions}>
                      <SessionStatusMenu
                        title={conversation.title}
                        status={conversation.status}
                        onSetStatus={(status) => handleSetStatus(conversation.id, status)}
                        {...(canCompleteAndSummarize(conversation.status)
                          ? { onCompleteAndSummarize: () => completeAndSummarize(conversation.id) }
                          : {})}
                        onRename={() => setRenamingId(conversation.id)}
                        onDelete={() => void remove(conversation.id)}
                      />
                    </span>
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
        <button type="button" className={styles.back} onClick={() => setView('list')}>
          <ArrowLeft size={16} aria-hidden="true" />
          Conversations
        </button>
        {!inThread ? (
          <SessionLauncher
            configured={configured}
            onStartFree={startFree}
            onPickGuided={startGuidedSession}
            onStartChallenge={startChallengeSession}
            onTalkItThrough={talkChallengeThrough}
            seedText={(location.state as { seedText?: string } | null)?.seedText ?? ''}
          />
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

            {stepperSteps ? <GuidedStepper steps={stepperSteps} current={activeGuideStep} /> : null}

            <div
              className={styles.thread}
              ref={threadRef}
              data-testid="session-thread"
              aria-live="polite"
              aria-busy={sending}
            >
              {messages.length === 0 && !streaming && !sending ? (
                <div className={styles.empty}>
                  <Text tone="secondary">What’s on your mind?</Text>
                </div>
              ) : (
                <Stack gap={3}>
                  {shownMessages.map((message, index) => {
                    // A "Today"/date divider when the day changes from the previous shown message (§4.1).
                    const divider = dayDividerLabel(shownMessages[index - 1]?.ts, message.ts);
                    return (
                      <Fragment key={index}>
                        {divider ? <MessageDayDivider label={divider} /> : null}
                        <MessageRow
                          side={message.role === 'user' ? 'user' : 'coach'}
                          iso={message.ts}
                          actions={
                            sending ? undefined : (
                              <MessageActions
                                // `shownMessages` hides blank ghosts, so its index isn't the stored
                                // one — map back by reference to rewind the right message.
                                followingCount={Math.max(
                                  0,
                                  messages.length - messages.indexOf(message) - 1,
                                )}
                                label={
                                  message.role === 'user' ? 'your message' : 'the coach’s reply'
                                }
                                onRegenerate={() => void regenerateFrom(messages.indexOf(message))}
                                onDelete={() => void rewind(messages.indexOf(message))}
                              />
                            )
                          }
                        >
                          <div
                            className={message.role === 'user' ? styles.userMsg : styles.coachMsg}
                          >
                            {message.role === 'user' ? (
                              <>
                                {message.content}
                                {message.attachments && message.attachments.length > 0 ? (
                                  <MessageAttachments attachments={message.attachments} />
                                ) : null}
                              </>
                            ) : (
                              // Coach prose renders Markdown; strip coach markers first (order matters, §7).
                              <Markdown>{stripCoachMarkers(message.content)}</Markdown>
                            )}
                          </div>
                        </MessageRow>
                      </Fragment>
                    );
                  })}
                  {streaming ? (
                    <MessageRow side="coach">
                      <div className={styles.coachMsg}>
                        <Markdown>{stripCoachMarkers(streaming)}</Markdown>
                      </div>
                    </MessageRow>
                  ) : null}
                  {sending && !streaming ? (
                    <MessageRow side="coach">
                      <div className={`${styles.coachMsg} ${styles.thinking}`}>
                        Coach is thinking…
                      </div>
                    </MessageRow>
                  ) : null}
                </Stack>
              )}
              {/* The wrap-up card lives INSIDE the scroll container so a tall summary scrolls with the thread
                  and can never overflow its grid row onto the pinned crisis footer below. */}
              {wrapUp ? (
                <div ref={wrapUpRef} className={styles.wrapCardSlot}>
                  <WrapUpCard insight={wrapUp} onDismiss={dismissWrapUp} />
                </div>
              ) : null}
            </div>

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

            {/* 52 §3.2 — a captured challenge confirms inline (a polite live region), with a quiet dismiss. */}
            {challengeCreated ? (
              <Banner tone="info" role="status">
                <Stack gap={2}>
                  <Text>
                    <strong>Challenge set ✓</strong> — {challengeCreated.action}
                  </Text>
                  <Text tone="secondary" size="sm">
                    You’ll find it on your Sessions home, and I’ll gently check in later.
                  </Text>
                  <div>
                    <Button variant="ghost" onClick={dismissChallengeCreated}>
                      Dismiss
                    </Button>
                  </div>
                </Stack>
              </Banner>
            ) : null}

            {/* A turn still awaiting a reply (nothing in flight; the last real message is the user's — even if a
                blank ghost reply trails it) is always recoverable (05 §4.1): a live failure shows the error, a
                RE-OPENED session that ended on the user's message shows a gentle prompt, and a LEGACY session that
                dead-ended on an empty reply is caught too — all offer "Try again" (which asks the coach to reply
                to the existing transcript, never re-sending/duplicating the message). */}
            {!sending && awaitingReply(messages) ? (
              <RetryBanner error={error} onRetry={() => void retry()} />
            ) : error ? (
              <Banner tone="warning">{error}</Banner>
            ) : null}

            {configured ? (
              <>
                <Composer
                  disabled={sending}
                  allowAttachments
                  // Return the send promise so the composer keeps pending attachments if a store fails.
                  onSend={(text, attachments) => send(text, attachments)}
                />
                {canWrapUp ? (
                  <div className={styles.wrapUpRow}>
                    <Button
                      variant="secondary"
                      onClick={() => activeId && completeAndSummarize(activeId)}
                      disabled={summarizing}
                    >
                      <Sparkles size={16} aria-hidden="true" />
                      {summarizing ? 'Wrapping up…' : 'Wrap up & reflect'}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <AiUnavailableNotice />
            )}
          </>
        )}
      </section>

      <div className={styles.crisisWrap}>
        <CrisisFooter />
      </div>
    </div>
  );
}
