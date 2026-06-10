import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
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
  TextInput,
} from '../../../design-system/components';
import { Composer } from './Composer';
import { CrisisFooter } from './CrisisFooter';
import styles from './Sessions.module.css';

/** The coaching Sessions surface (05-conversations): session list + streaming thread + crisis footer. */
export function Sessions(): JSX.Element {
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasKey, setHasKey] = useState(false);

  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const messages = useConversationStore((s) => s.messages);
  const streaming = useConversationStore((s) => s.streaming);
  const sending = useConversationStore((s) => s.sending);
  const error = useConversationStore((s) => s.error);
  const load = useConversationStore((s) => s.load);
  const newConversation = useConversationStore((s) => s.newConversation);
  const open = useConversationStore((s) => s.open);
  const send = useConversationStore((s) => s.send);
  const remove = useConversationStore((s) => s.remove);
  const rename = useConversationStore((s) => s.rename);
  const appendChunk = useConversationStore((s) => s.appendChunk);

  const navigate = useNavigate();
  const threadRef = useRef<HTMLDivElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
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
  // When unconfigured, keep the detail pane (the connect CTA) in view on mobile.
  const effectiveView = configured ? view : 'thread';

  return (
    <div className={styles.layout} data-view={effectiveView}>
      <aside className={styles.sidebar} aria-label="Conversations">
        <Button variant="secondary" onClick={startNew}>
          <Plus size={16} aria-hidden="true" />
          New session
        </Button>
        <Stack gap={1}>
          {conversations.map((conversation) => (
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
                </>
              )}
            </div>
          ))}
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
                  {streaming ? <div className={styles.coachMsg}>{streaming}</div> : null}
                  {sending && !streaming ? (
                    <div className={`${styles.coachMsg} ${styles.thinking}`}>
                      Coach is thinking…
                    </div>
                  ) : null}
                </Stack>
              )}
            </div>

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
