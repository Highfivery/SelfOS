import type { FileSystem } from '../host';
import { uuid } from '../id';
import type { Conversation } from '../schemas';
import { listConversations, saveConversation } from '../conversations';

// ── Together solo prep spaces (58 §3.7) ───────────────────────────────────────────────────────────
// A person's PRIVATE prep thread for a couples session is an ordinary 05 Conversation carrying a
// `togetherSessionId` link — so it reuses the composer/streaming/retry/attachments wholesale, and the
// person's insights from it feed their OWN coaching context like any conversation. Prep content never
// reaches the shared transcript or the couples prompt as text; it's solo spend billed to its author (§6.2).

/** The prep coach's opener — a static seed (no AI spend), setting the "gather your words, then bring it" frame. */
const PREP_OPENER =
  'This is your private prep space for your Together session — just for you. It’s a good place to gather ' +
  'your thoughts before (or between) talking with your partner. What’s on your mind that you’d like to ' +
  'find the words for, or bring into the conversation when you’re ready?';

/**
 * Find-or-create the active person's prep conversation for a Together session (§3.7). Idempotent: returns the
 * existing prep thread if one exists, else creates a fresh conversation carrying the link + a seeded opener.
 */
export async function openPrepConversation(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  togetherSessionId: string,
  now: Date,
): Promise<Conversation> {
  const existing = (await listConversations(fs, key, personId)).find(
    (c) => c.togetherSessionId === togetherSessionId,
  );
  if (existing) return existing;
  const at = now.toISOString();
  const conversation: Conversation = {
    id: uuid(),
    schemaVersion: 1,
    personId,
    title: 'Prep',
    createdAt: at,
    updatedAt: at,
    status: 'inProgress',
    togetherSessionId,
    messages: [{ role: 'assistant', content: PREP_OPENER, ts: at }],
  };
  await saveConversation(fs, key, conversation);
  return conversation;
}
