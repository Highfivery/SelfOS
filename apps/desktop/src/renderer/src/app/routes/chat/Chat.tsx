import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Plus, Trash2 } from 'lucide-react';
import { useConversationStore } from '../../../stores/conversationStore';
import { useSetting } from '../../../settings/useSetting';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import {
  Banner,
  Button,
  Heading,
  IconButton,
  Stack,
  Text,
} from '../../../design-system/components';
import { formatUsd } from '../usage/format';
import { Composer } from './Composer';
import { CrisisFooter } from './CrisisFooter';
import styles from './Chat.module.css';

/** The coaching chat (05-conversations): conversation list + streaming thread + cost + crisis footer. */
export function Chat(): JSX.Element {
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasKey, setHasKey] = useState(false);

  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const messages = useConversationStore((s) => s.messages);
  const streaming = useConversationStore((s) => s.streaming);
  const sending = useConversationStore((s) => s.sending);
  const runningCostUsd = useConversationStore((s) => s.runningCostUsd);
  const budget = useConversationStore((s) => s.budget);
  const error = useConversationStore((s) => s.error);
  const load = useConversationStore((s) => s.load);
  const newConversation = useConversationStore((s) => s.newConversation);
  const open = useConversationStore((s) => s.open);
  const send = useConversationStore((s) => s.send);
  const remove = useConversationStore((s) => s.remove);
  const appendChunk = useConversationStore((s) => s.appendChunk);

  const threadRef = useRef<HTMLDivElement>(null);

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
  const personBudget = budget?.person.state;

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="Conversations">
        <Button variant="secondary" onClick={newConversation}>
          <Plus size={16} aria-hidden="true" />
          New
        </Button>
        <Stack gap={1}>
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={
                conversation.id === activeId ? `${styles.conv} ${styles.convActive}` : styles.conv
              }
            >
              <button
                type="button"
                className={styles.convOpen}
                onClick={() => void open(conversation.id)}
              >
                <MessageCircle size={14} aria-hidden="true" />
                <span className={styles.convTitle}>{conversation.title}</span>
              </button>
              <IconButton
                aria-label={`Delete ${conversation.title}`}
                onClick={() => void remove(conversation.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </IconButton>
            </div>
          ))}
        </Stack>
      </aside>

      <section className={styles.main}>
        {!configured ? (
          <div className={styles.empty}>
            <Stack gap={2} align="center">
              <Heading level={3}>Connect Claude to start</Heading>
              <Text tone="secondary">
                Enable AI and add your key in Settings → AI to begin a conversation.
              </Text>
            </Stack>
          </div>
        ) : (
          <>
            <div className={styles.thread} ref={threadRef} aria-live="polite">
              {messages.length === 0 && !streaming ? (
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
                  {streaming ? <div className={styles.coachMsg}>{streaming}</div> : null}
                </Stack>
              )}
            </div>

            {error ? <Banner tone="warning">{error}</Banner> : null}

            <div className={styles.costRow}>
              <Text size="xs" tone="tertiary">
                This chat: {formatUsd(runningCostUsd)} (estimated)
              </Text>
              {personBudget === 'warn' || personBudget === 'over' ? (
                <Text size="xs" tone="accent">
                  Budget {personBudget === 'over' ? 'reached' : 'almost reached'}
                </Text>
              ) : null}
            </div>

            <Composer disabled={sending} onSend={(text) => void send(text)} />
          </>
        )}
        <CrisisFooter />
      </section>
    </div>
  );
}
