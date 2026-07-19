import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { stripDreamMarkers } from '@selfos/core/dreams';
import type { Dream } from '@shared/channels';
import { aiKeyResolved } from '../../aiAvailability';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { useDreamAnalysisStore } from '../../../stores/dreamAnalysisStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import {
  Banner,
  Button,
  dayDividerLabel,
  Heading,
  Markdown,
  MessageDayDivider,
  MessageRow,
  RetryBanner,
  Stack,
  Text,
} from '../../../design-system/components';
import { Composer } from '../sessions/Composer';
import { awaitingReply } from '../../../stores/conversationStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { DreamSynthesisCard } from './DreamSynthesisCard';
import { DreamAnalyzeSuggestion } from './DreamAnalyzeSuggestion';
import { DreamShareControls } from './DreamShareControls';
import { DreamImagePanel } from './DreamImagePanel';
import styles from './Dreams.module.css';

interface DreamAnalysisPaneProps {
  dream: Dream;
  onBack: () => void;
}

/**
 * The guided dream-analysis surface (12-dreams §3.2/§3.3), shown in-pane in place of the dream editor.
 * A dream-scoped reflective chat (reusing the Sessions composer + crisis footer) → a "Create analysis"
 * synthesis → a read-first, editable, approvable card. Once analyzed it **leads with the card**, tucking
 * the chat behind a "Continue the conversation" toggle. Capture/journaling never needs AI; only the
 * chat + synthesis do, so an existing analysis stays viewable/editable/approvable even with AI off.
 */
export function DreamAnalysisPane({ dream, onBack }: DreamAnalysisPaneProps): JSX.Element {
  const [aiEnabled] = useSetting('ai.enabled');
  const [memoryEnabledSetting] = useSetting('dreams.memoryEnabled');
  const [hasKey, setHasKey] = useState(false);

  const loaded = useDreamAnalysisStore((s) => s.loaded);
  const messages = useDreamAnalysisStore((s) => s.messages);
  const streaming = useDreamAnalysisStore((s) => s.streaming);
  const opening = useDreamAnalysisStore((s) => s.opening);
  const sending = useDreamAnalysisStore((s) => s.sending);
  const synthesizing = useDreamAnalysisStore((s) => s.synthesizing);
  const approving = useDreamAnalysisStore((s) => s.approving);
  const analysisReady = useDreamAnalysisStore((s) => s.analysisReady);
  const analysis = useDreamAnalysisStore((s) => s.analysis);
  const insight = useDreamAnalysisStore((s) => s.insight);
  const shareTargets = useDreamAnalysisStore((s) => s.shareTargets);
  const setFactShare = useDreamAnalysisStore((s) => s.setFactShare);
  const error = useDreamAnalysisStore((s) => s.error);
  const canShare = useSessionStore((s) => s.can('dreams.shareContext'));
  const open = useDreamAnalysisStore((s) => s.open);
  const startReflection = useDreamAnalysisStore((s) => s.startReflection);
  const sendTurn = useDreamAnalysisStore((s) => s.sendTurn);
  const retryTurn = useDreamAnalysisStore((s) => s.retryTurn);
  const synthesize = useDreamAnalysisStore((s) => s.synthesize);
  const saveEdits = useDreamAnalysisStore((s) => s.saveEdits);
  const approve = useDreamAnalysisStore((s) => s.approve);
  const removeFromContext = useDreamAnalysisStore((s) => s.removeFromContext);
  const appendChunk = useDreamAnalysisStore((s) => s.appendChunk);

  // 66 §3.4 — readiness is durable (stamped on the dream) OR from this turn, so leaving the reflection and
  // coming back doesn't lose the coach's offer.
  const ready = Boolean(dream.analysisReadyAt) || analysisReady;

  const threadRef = useRef<HTMLDivElement>(null);
  // Lead with the card once analyzed; the chat tucks behind a toggle (12 §3.2, confirmed in review).
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    void open(dream.id);
  }, [dream.id, open]);
  useEffect(() => window.selfos?.onDreamChunk(appendChunk), [appendChunk]);
  useEffect(() => {
    void (async () => {
      setHasKey(await aiKeyResolved('anthropic'));
    })();
  }, []);
  useEffect(() => {
    threadRef.current?.scrollTo?.(0, threadRef.current.scrollHeight);
  }, [messages, streaming]);

  const configured = aiEnabled && hasKey;
  // Dream memory defaults ON (matches the bridge default) — only an explicit false disables approval.
  const memoryEnabled = memoryEnabledSetting !== false;

  // Coach-first opening (12 §15.4): for a never-reflected dream, once AI is ready, have the coach OPEN the
  // conversation referencing this dream — so the session is never a blank chat re-asking for the dream. Only
  // a `captured` dream with no transcript/analysis auto-opens; it waits for `open()` to finish (`loaded`) so
  // it never races the initial load, and `startReflection` is idempotent server-side (no double-spend).
  useEffect(() => {
    if (
      loaded &&
      configured &&
      !analysis &&
      dream.status === 'captured' &&
      messages.length === 0 &&
      !opening &&
      !sending
    ) {
      void startReflection();
    }
  }, [
    loaded,
    configured,
    analysis,
    dream.status,
    messages.length,
    opening,
    sending,
    startReflection,
  ]);

  const chat = (
    <>
      <div
        className={styles.thread}
        ref={threadRef}
        aria-live="polite"
        aria-busy={sending || opening}
      >
        {messages.length === 0 && !streaming ? (
          // The coach is opening the reflection (or briefly, before it does) — never a blank prompt.
          <div className={`${styles.coachMsg} ${styles.thinking}`}>Reading your dream…</div>
        ) : (
          <Stack gap={3}>
            {messages.map((message, index) => {
              const divider = dayDividerLabel(messages[index - 1]?.ts, message.ts);
              return (
                <Fragment key={index}>
                  {divider ? <MessageDayDivider label={divider} /> : null}
                  <MessageRow side={message.role === 'user' ? 'user' : 'coach'} iso={message.ts}>
                    <div className={message.role === 'user' ? styles.userMsg : styles.coachMsg}>
                      {message.role === 'user' ? (
                        message.content
                      ) : (
                        <Markdown>{stripDreamMarkers(message.content)}</Markdown>
                      )}
                    </div>
                  </MessageRow>
                </Fragment>
              );
            })}
            {streaming ? (
              <MessageRow side="coach">
                <div className={styles.coachMsg}>
                  <Markdown>{stripDreamMarkers(streaming)}</Markdown>
                </div>
              </MessageRow>
            ) : null}
            {(sending || opening) && !streaming ? (
              <MessageRow side="coach">
                <div className={`${styles.coachMsg} ${styles.thinking}`}>Reflecting…</div>
              </MessageRow>
            ) : null}
          </Stack>
        )}
      </div>

      {/* 66 §3.2 — a turn still awaiting a reply is always recoverable: a live failure shows the error, a
          reflection reopened mid-turn shows a gentle prompt. Try again asks the coach to answer the
          existing transcript, never re-sending the message. */}
      {!sending && !opening && awaitingReply(messages) ? (
        <RetryBanner error={error} onRetry={() => void retryTurn()} />
      ) : null}

      <Composer disabled={sending || opening} onSend={(text) => void sendTurn(text)} />

      {/* Once the coach signals it has enough (12 §15.4), a highlighted nudge; otherwise the
          always-available "Create analysis" (or "Re-create analysis" once one exists). Exactly one analyze
          affordance at a time — never a gate. The nudge is only for the not-yet-analyzed path (a reopened
          chat behind "Continue the conversation" already has an analysis → offer re-create, not the nudge). */}
      {ready && !analysis ? (
        <DreamAnalyzeSuggestion busy={synthesizing} onAnalyze={() => void synthesize()} />
      ) : (
        <div className={styles.synthRow}>
          <Button
            variant="secondary"
            onClick={() => void synthesize()}
            disabled={synthesizing || sending || opening || messages.length === 0}
          >
            <Sparkles size={16} aria-hidden="true" />
            {synthesizing
              ? 'Writing your analysis…'
              : analysis
                ? 'Re-create analysis'
                : 'Create analysis'}
          </Button>
        </div>
      )}
    </>
  );

  return (
    <div className={styles.analysisLayout}>
      <button type="button" className={styles.analysisBack} onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to dream
      </button>
      <Heading level={2}>Dream analysis</Heading>

      {/* Only when the recoverable-turn banner below isn't already carrying it, so it never doubles. */}
      {error && !awaitingReply(messages) ? <Banner tone="warning">{error}</Banner> : null}

      {analysis ? (
        <>
          <DreamSynthesisCard
            analysis={analysis}
            memoryEnabled={memoryEnabled}
            approving={approving}
            onSaveEdits={(edits) => void saveEdits(edits)}
            onApprove={() => void approve()}
            onRemoveFromContext={() => void removeFromContext()}
          />
          {analysis.insightId && canShare ? (
            dream.informsContext === false ? (
              <Text size="xs" tone="tertiary">
                This dream is kept as a private journal entry, so it won’t inform coaching context.
              </Text>
            ) : insight ? (
              <DreamShareControls
                facts={insight.facts}
                targets={shareTargets}
                onSetShare={(factId, withPersonId, share) =>
                  void setFactShare(factId, withPersonId, share)
                }
              />
            ) : null
          ) : null}
          {/* Visualize the dream alongside the written reflection (13-dream-images §3.1). */}
          <DreamImagePanel dream={dream} />
          {configured ? (
            <div className={styles.continueWrap}>
              <Button
                variant="secondary"
                onClick={() => setChatOpen((value) => !value)}
                aria-expanded={chatOpen}
                aria-controls="dream-analysis-chat"
              >
                {chatOpen ? 'Hide conversation' : 'Continue the conversation'}
              </Button>
              {chatOpen ? <div id="dream-analysis-chat">{chat}</div> : null}
            </div>
          ) : null}
        </>
      ) : configured ? (
        chat
      ) : (
        <div className={styles.empty}>
          <Stack gap={3} align="center">
            <Heading level={3}>Reflect on this dream</Heading>
            <Text tone="secondary">
              SelfOS uses AI to reflect on a dream with you. Your journal still works without it.
            </Text>
            <AiUnavailableNotice />
          </Stack>
        </div>
      )}

      <CrisisFooter />
    </div>
  );
}
