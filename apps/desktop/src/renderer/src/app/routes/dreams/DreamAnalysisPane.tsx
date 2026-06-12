import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import type { Dream } from '@shared/channels';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import { useDreamAnalysisStore } from '../../../stores/dreamAnalysisStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import { Banner, Button, Heading, Stack, Text } from '../../../design-system/components';
import { Composer } from '../sessions/Composer';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { DreamSynthesisCard } from './DreamSynthesisCard';
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
  const navigate = useNavigate();

  const messages = useDreamAnalysisStore((s) => s.messages);
  const streaming = useDreamAnalysisStore((s) => s.streaming);
  const sending = useDreamAnalysisStore((s) => s.sending);
  const synthesizing = useDreamAnalysisStore((s) => s.synthesizing);
  const approving = useDreamAnalysisStore((s) => s.approving);
  const analysis = useDreamAnalysisStore((s) => s.analysis);
  const insight = useDreamAnalysisStore((s) => s.insight);
  const shareTargets = useDreamAnalysisStore((s) => s.shareTargets);
  const setFactShare = useDreamAnalysisStore((s) => s.setFactShare);
  const error = useDreamAnalysisStore((s) => s.error);
  const canShare = useSessionStore((s) => s.can('dreams.shareContext'));
  const open = useDreamAnalysisStore((s) => s.open);
  const sendTurn = useDreamAnalysisStore((s) => s.sendTurn);
  const synthesize = useDreamAnalysisStore((s) => s.synthesize);
  const saveEdits = useDreamAnalysisStore((s) => s.saveEdits);
  const approve = useDreamAnalysisStore((s) => s.approve);
  const removeFromContext = useDreamAnalysisStore((s) => s.removeFromContext);
  const appendChunk = useDreamAnalysisStore((s) => s.appendChunk);

  const threadRef = useRef<HTMLDivElement>(null);
  // Lead with the card once analyzed; the chat tucks behind a toggle (12 §3.2, confirmed in review).
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    void open(dream.id);
  }, [dream.id, open]);
  useEffect(() => window.selfos?.onDreamChunk(appendChunk), [appendChunk]);
  useEffect(() => {
    void (async () => {
      setHasKey(Boolean(await window.selfos?.secretHas({ id: ANTHROPIC_API_KEY_ID })));
    })();
  }, []);
  useEffect(() => {
    threadRef.current?.scrollTo?.(0, threadRef.current.scrollHeight);
  }, [messages, streaming]);

  const configured = aiEnabled && hasKey;
  // Dream memory defaults ON (matches the bridge default) — only an explicit false disables approval.
  const memoryEnabled = memoryEnabledSetting !== false;

  const chat = (
    <>
      <div className={styles.thread} ref={threadRef} aria-live="polite" aria-busy={sending}>
        {messages.length === 0 && !streaming && !sending ? (
          <Text tone="secondary">
            When you’re ready, share a little about the dream — how it felt, what stood out — and
            I’ll ask a few gentle questions. Or create the analysis straight away.
          </Text>
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
            {streaming ? <div className={styles.coachMsg}>{streaming}</div> : null}
            {sending && !streaming ? (
              <div className={`${styles.coachMsg} ${styles.thinking}`}>Coach is reflecting…</div>
            ) : null}
          </Stack>
        )}
      </div>

      <Composer disabled={sending} onSend={(text) => void sendTurn(text)} />

      <div className={styles.synthRow}>
        <Button
          variant="primary"
          onClick={() => void synthesize()}
          disabled={synthesizing || sending}
        >
          <Sparkles size={16} aria-hidden="true" />
          {synthesizing
            ? 'Writing your analysis…'
            : analysis
              ? 'Re-create analysis'
              : 'Create analysis'}
        </Button>
      </div>
    </>
  );

  return (
    <div className={styles.analysisLayout}>
      <button type="button" className={styles.analysisBack} onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to dream
      </button>
      <Heading level={2}>Dream analysis</Heading>

      {error ? <Banner tone="warning">{error}</Banner> : null}

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
            dream.sensitivity === 'standard' ? (
              insight ? (
                <DreamShareControls
                  facts={insight.facts}
                  targets={shareTargets}
                  onSetShare={(factId, withPersonId, share) =>
                    void setFactShare(factId, withPersonId, share)
                  }
                />
              ) : null
            ) : (
              <Text size="xs" tone="tertiary">
                This dream is marked sensitive, so it’s kept out of shared context.
              </Text>
            )
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
            <Heading level={3}>Connect Claude to analyze</Heading>
            <Text tone="secondary">
              Enable AI and add your key to reflect on this dream. Your journal still works without
              it.
            </Text>
            <Button variant="primary" onClick={() => navigate('/settings')}>
              Open Settings
            </Button>
          </Stack>
        </div>
      )}

      <CrisisFooter />
    </div>
  );
}
