import { useEffect, useState } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import { Button, Inline, Markdown, RetryBanner, Text } from '../../../design-system/components';
import { Composer } from '../sessions/Composer';
import { MessageAttachments } from '../sessions/MessageAttachments';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { awaitingReply, useConversationStore } from '../../../stores/conversationStore';
import styles from './Together.module.css';

/**
 * A person's PRIVATE prep space for a Together session (58 §3.7). It's an ordinary 05 Conversation carrying a
 * `togetherSessionId` link, so it reuses the conversation store + Composer + streaming + attachments wholesale.
 * Prep is solo spend billed to its author; its content never reaches the shared transcript or the couples
 * prompt as text (only the author's own-context insights do). Invisible to the partner by construction.
 */
export function PrepPanel({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}): JSX.Element {
  const messages = useConversationStore((s) => s.messages);
  const streaming = useConversationStore((s) => s.streaming);
  const sending = useConversationStore((s) => s.sending);
  const send = useConversationStore((s) => s.send);
  const retry = useConversationStore((s) => s.retry);
  const error = useConversationStore((s) => s.error);
  const appendChunk = useConversationStore((s) => s.appendChunk);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const conv = await window.selfos?.togetherPrepOpen({ sessionId });
      if (conv && alive) await useConversationStore.getState().open(conv.id);
      if (alive) setReady(true);
    })();
    // Reset the shared store on leave so a later visit to solo Sessions doesn't linger on the prep thread.
    return () => {
      alive = false;
      useConversationStore.getState().reset();
    };
  }, [sessionId]);

  // Stream the coach reply into the live bubble (prep uses the solo chat:chunk sink).
  useEffect(() => window.selfos?.onChatChunk(appendChunk), [appendChunk]);

  return (
    <div className={styles.thread}>
      <div className={styles.sessionTop}>
        <Inline gap={1} align="center">
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to session
          </Button>
        </Inline>
        <span className={styles.asideTag}>
          <Lock size={12} aria-hidden="true" /> Private prep — only you
        </span>
      </div>
      <Text tone="secondary" size="sm">
        A private space to gather your thoughts. Nothing here is shared with your partner or shown
        in the conversation.
      </Text>

      <div className={styles.messages} aria-busy={sending} data-testid="together-prep-thread">
        {!ready ? (
          <Text tone="secondary">Loading…</Text>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.ts}-${i}`}
              className={[styles.bubbleRow, m.role === 'user' ? styles.bubbleMine : '']
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.bubble}>
                <Text size="xs" tone="secondary" weight={600}>
                  {m.role === 'user' ? 'You' : 'Coach'}
                </Text>
                {m.role === 'assistant' ? (
                  <Markdown>{m.content}</Markdown>
                ) : (
                  <>
                    {m.content ? <Text className={styles.bubbleText}>{m.content}</Text> : null}
                    {m.attachments && m.attachments.length > 0 ? (
                      <MessageAttachments attachments={m.attachments} />
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ))
        )}
        {sending && streaming ? (
          <div className={styles.bubbleRow}>
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

      {/* 66 §3.2 — the prep thread reuses the conversation store, which has always had a working
          `retry()`; it simply had no button, so a failed prep turn was an unreachable dead end. */}
      {!sending && awaitingReply(messages) ? (
        <RetryBanner error={error} onRetry={() => void retry()} />
      ) : null}

      <Composer
        disabled={sending}
        allowAttachments
        placeholder="Write privately…"
        onSend={(text, pending) => send(text, pending)}
      />
      <CrisisFooter />
    </div>
  );
}
