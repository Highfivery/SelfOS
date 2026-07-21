import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { stripCoachMarkers } from '@selfos/core/conversations';
import type { AttachmentRef, StoryMemory, StoryMemoryEdits } from '@shared/schemas';
import { aiKeyResolved } from '../../aiAvailability';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { useStoryMemoryStore } from '../../../stores/storyMemoryStore';
import { useSetting } from '../../../settings/useSetting';
import {
  AttachmentThumb,
  Banner,
  Button,
  dayDividerLabel,
  Field,
  Heading,
  Markdown,
  MessageActions,
  MessageDayDivider,
  MessageRow,
  RetryBanner,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '../../../design-system/components';
import { Composer } from '../sessions/Composer';
import { awaitingReply } from '../../../stores/conversationStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './Story.module.css';

/** The user message's stored image attachments — resolved via the memory store's cache (45 §3.3). */
function MemoryAttachments({ attachments }: { attachments: AttachmentRef[] }): JSX.Element {
  const attachmentUrls = useStoryMemoryStore((s) => s.attachmentUrls);
  const loadAttachment = useStoryMemoryStore((s) => s.loadAttachment);

  useEffect(() => {
    for (const ref of attachments) void loadAttachment(ref);
  }, [attachments, loadAttachment]);

  return (
    <div className={styles.memAttachGrid}>
      {attachments.map((ref, i) => (
        <AttachmentThumb
          key={ref.id}
          src={attachmentUrls[ref.id] ?? null}
          alt={
            attachments.length > 1
              ? `Attached image ${i + 1} of ${attachments.length}`
              : 'Attached image'
          }
        />
      ))}
    </div>
  );
}

/**
 * The confirm card (§14) — the synthesized memory the person reviews + lightly edits before committing. Title,
 * approximate date, narrative and emotional texture are editable; people are read-only chips. "Add to my story"
 * commits it (feeds the book + the coach); "Keep talking" dismisses back to the chat.
 */
function MemoryConfirmCard({
  memory,
  saving,
  onSave,
  onKeepTalking,
}: {
  memory: StoryMemory;
  saving: boolean;
  onSave: (edits: StoryMemoryEdits) => void;
  onKeepTalking: () => void;
}): JSX.Element {
  const [title, setTitle] = useState(memory.title);
  const [approxDate, setApproxDate] = useState(memory.approxDate ?? '');
  const [narrative, setNarrative] = useState(memory.narrative);
  const [emotionalTexture, setEmotionalTexture] = useState(memory.emotionalTexture ?? '');

  return (
    <Stack gap={3}>
      <Heading level={3}>Your memory, in your words</Heading>
      <Text tone="secondary" size="sm">
        Your biographer wrote this from what you shared. Read it, change anything that isn’t quite
        right, then add it to your story.
      </Text>
      {memory.crisisFlag ? (
        <Banner tone="warning">
          This memory touches something heavy. If you need support right now, the resources below
          are here for you — you don’t have to hold it alone.
        </Banner>
      ) : null}
      <Field label="Title">
        {(p) => <TextInput {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label="When (roughly)">
        {(p) => (
          <TextInput
            {...p}
            value={approxDate}
            onChange={(e) => setApproxDate(e.target.value)}
            placeholder="e.g. 1994, my mid-twenties, the summer after college"
          />
        )}
      </Field>
      <Field label="The memory">
        {(p) => (
          <Textarea
            {...p}
            rows={8}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
          />
        )}
      </Field>
      <Field label="How it felt">
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            value={emotionalTexture}
            onChange={(e) => setEmotionalTexture(e.target.value)}
          />
        )}
      </Field>
      {memory.people.length > 0 ? (
        <Stack gap={1}>
          <Text size="sm" tone="tertiary">
            People in this memory
          </Text>
          <div className={styles.memPeople}>
            {memory.people.map((person, i) => (
              <span key={`${person.name}-${i}`} className={styles.memPersonChip}>
                {person.name}
              </span>
            ))}
          </div>
        </Stack>
      ) : null}
      <div className={styles.memConfirmActions}>
        <Button
          variant="primary"
          disabled={saving}
          onClick={() =>
            onSave({
              title: title.trim(),
              narrative: narrative.trim(),
              approxDate: approxDate.trim(),
              emotionalTexture: emotionalTexture.trim(),
            })
          }
        >
          {saving ? 'Adding…' : 'Add to my story'}
        </Button>
        <Button variant="ghost" disabled={saving} onClick={onKeepTalking}>
          Keep talking
        </Button>
      </div>
    </Stack>
  );
}

interface ShareMemoryPanelProps {
  /** Resume an existing memory chat; omit to start a NEW one (optionally seeded). */
  memoryId?: string;
  /** Seed a NEW memory from a gap focus or a photo caption — the biographer opens referencing it. */
  seedFocus?: string;
  onBack: () => void;
}

/**
 * "Share a memory" (64 §14) — an interactive biographer interview: the biographer opens the conversation
 * (streaming), asks/deepens like the dream-analysis pane, then synthesizes a structured memory the person
 * commits with one tap. Reuses the Sessions composer (with photo attachments) + crisis footer. The reading
 * (chat) surface streams — that IS the progress; the synthesis is a button-busy state.
 */
export function ShareMemoryPanel({
  memoryId,
  seedFocus,
  onBack,
}: ShareMemoryPanelProps): JSX.Element {
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasKey, setHasKey] = useState(false);

  const loaded = useStoryMemoryStore((s) => s.loaded);
  const messages = useStoryMemoryStore((s) => s.messages);
  const streaming = useStoryMemoryStore((s) => s.streaming);
  const opening = useStoryMemoryStore((s) => s.opening);
  const sending = useStoryMemoryStore((s) => s.sending);
  const synthesizing = useStoryMemoryStore((s) => s.synthesizing);
  const saving = useStoryMemoryStore((s) => s.saving);
  const readyFlag = useStoryMemoryStore((s) => s.ready);
  const memory = useStoryMemoryStore((s) => s.memory);
  const error = useStoryMemoryStore((s) => s.error);
  const open = useStoryMemoryStore((s) => s.open);
  const openNew = useStoryMemoryStore((s) => s.openNew);
  const sendTurn = useStoryMemoryStore((s) => s.sendTurn);
  const retryTurn = useStoryMemoryStore((s) => s.retryTurn);
  const rewind = useStoryMemoryStore((s) => s.rewind);
  const regenerateFrom = useStoryMemoryStore((s) => s.regenerateFrom);
  const synthesize = useStoryMemoryStore((s) => s.synthesize);
  const save = useStoryMemoryStore((s) => s.save);
  const appendChunk = useStoryMemoryStore((s) => s.appendChunk);
  const close = useStoryMemoryStore((s) => s.close);

  const threadRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);
  const [mode, setMode] = useState<'chat' | 'confirm' | 'saved'>('chat');

  const configured = aiEnabled && hasKey;

  useEffect(() => {
    void (async () => {
      setHasKey(await aiKeyResolved('anthropic'));
    })();
  }, []);
  useEffect(() => window.selfos?.onMemoryChunk(appendChunk), [appendChunk]);

  // Open exactly once: an existing memory always loads (a resume — no new spend); a NEW memory only starts once
  // AI is confirmed ready (the biographer's opener needs it). `configured` resolves async, so the effect re-runs
  // and opens then.
  useEffect(() => {
    if (openedRef.current) return;
    if (memoryId) {
      openedRef.current = true;
      void open(memoryId);
    } else if (configured) {
      openedRef.current = true;
      void openNew(seedFocus);
    }
  }, [memoryId, seedFocus, configured, open, openNew]);

  // Clear the open-chat state when the panel unmounts (leaves the collection intact).
  useEffect(() => close, [close]);

  useEffect(() => {
    threadRef.current?.scrollTo?.(0, threadRef.current.scrollHeight);
  }, [messages, streaming]);

  // A committed memory (existing or just-saved) shows the saved state.
  useEffect(() => {
    if (memory?.status === 'saved') setMode('saved');
  }, [memory?.status, memory?.id]);

  // Readiness is durable (stamped on the memory) OR from this turn — so leaving/returning keeps the offer.
  const ready = Boolean(memory?.readyAt) || readyFlag;
  const hasExchange = messages.some((m) => m.role === 'user');

  const saveThis = async (): Promise<void> => {
    // Synthesize first, then reveal the editable confirm card (never a hard gate — always available once
    // there's been an exchange).
    const ok = await synthesize();
    if (ok) setMode('confirm');
  };

  const chat = (
    <>
      <div
        className={styles.memThread}
        ref={threadRef}
        aria-live="polite"
        aria-busy={sending || opening}
      >
        {messages.length === 0 && !streaming ? (
          <div className={`${styles.memCoachMsg} ${styles.memThinking}`}>
            Your biographer is here…
          </div>
        ) : (
          <Stack gap={3}>
            {messages.map((message, index) => {
              const divider = dayDividerLabel(messages[index - 1]?.ts, message.ts);
              return (
                <Fragment key={index}>
                  {divider ? <MessageDayDivider label={divider} /> : null}
                  <MessageRow
                    side={message.role === 'user' ? 'user' : 'coach'}
                    iso={message.ts}
                    actions={
                      sending || opening ? undefined : (
                        <MessageActions
                          followingCount={Math.max(0, messages.length - index - 1)}
                          label={message.role === 'user' ? 'your turn' : 'your biographer’s reply'}
                          onRegenerate={() => void regenerateFrom(index)}
                          onDelete={() => void rewind(index)}
                        />
                      )
                    }
                  >
                    <div
                      className={message.role === 'user' ? styles.memUserMsg : styles.memCoachMsg}
                    >
                      {message.role === 'user' ? (
                        <>
                          {message.content}
                          {message.attachments && message.attachments.length > 0 ? (
                            <MemoryAttachments attachments={message.attachments} />
                          ) : null}
                        </>
                      ) : (
                        <Markdown>{stripCoachMarkers(message.content)}</Markdown>
                      )}
                    </div>
                  </MessageRow>
                </Fragment>
              );
            })}
            {streaming ? (
              <MessageRow side="coach">
                <div className={styles.memCoachMsg}>
                  <Markdown>{stripCoachMarkers(streaming)}</Markdown>
                </div>
              </MessageRow>
            ) : null}
            {(sending || opening) && !streaming ? (
              <MessageRow side="coach">
                <div className={`${styles.memCoachMsg} ${styles.memThinking}`}>Thinking…</div>
              </MessageRow>
            ) : null}
          </Stack>
        )}
      </div>

      {!sending && !opening && awaitingReply(messages) ? (
        <RetryBanner error={error} onRetry={() => void retryTurn()} />
      ) : null}

      <Composer
        disabled={sending || opening}
        allowAttachments
        placeholder="Tell your biographer about the memory…"
        onSend={(text, attachments) => sendTurn(text, attachments)}
      />

      {hasExchange ? (
        <div className={styles.memSaveRow}>
          {ready ? (
            <Text size="sm" tone="secondary">
              Your biographer has enough to write this memory whenever you’re ready.
            </Text>
          ) : null}
          <Button
            variant={ready ? 'primary' : 'secondary'}
            onClick={() => void saveThis()}
            disabled={synthesizing || sending || opening}
          >
            <Sparkles size={16} aria-hidden="true" />
            {synthesizing ? 'Writing your memory…' : 'Save this memory'}
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <div className={styles.memLayout}>
      <button type="button" className={styles.memBack} onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to your story
      </button>
      <Heading level={2}>Share a memory</Heading>

      {error && !awaitingReply(messages) ? <Banner tone="warning">{error}</Banner> : null}

      {mode === 'saved' && memory ? (
        <Stack gap={3}>
          <Banner tone="info">
            <strong>Woven into your story.</strong> Your biographer will fold “{memory.title}” into
            your book as it writes.
          </Banner>
          {memory.narrative ? (
            <Text tone="secondary" size="sm">
              <Markdown>{memory.narrative}</Markdown>
            </Text>
          ) : null}
          <div>
            <Button variant="secondary" onClick={onBack}>
              Done
            </Button>
          </div>
        </Stack>
      ) : mode === 'confirm' && memory ? (
        <MemoryConfirmCard
          memory={memory}
          saving={saving}
          onSave={(edits) => {
            void (async () => {
              const ok = await save(edits);
              if (ok) setMode('saved');
            })();
          }}
          onKeepTalking={() => setMode('chat')}
        />
      ) : configured ? (
        // Wait for the initial open to land so the thread never flashes before its first message.
        loaded || opening ? (
          chat
        ) : (
          <div className={`${styles.memCoachMsg} ${styles.memThinking}`}>Opening…</div>
        )
      ) : (
        <Stack gap={3} align="center">
          <Heading level={3}>Share a memory with your biographer</Heading>
          <Text tone="secondary">
            SelfOS uses AI to talk a memory through with you and write it into your story.
          </Text>
          <AiUnavailableNotice />
        </Stack>
      )}

      <CrisisFooter />
    </div>
  );
}
