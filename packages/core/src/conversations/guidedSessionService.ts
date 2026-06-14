import type { FileSystem } from '../host';
import { uuid } from '../id';
import type { Conversation } from '../schemas';
import { saveConversation } from './conversationService';
import { getExercise } from './guidedCatalog';

/**
 * Start a guided session (16-guided-sessions §5). Creates an ordinary conversation stamped with the
 * exercise's `guideId` (+ `guideStep: 0` for structured), and seeds the exercise's **static opening
 * message** as the first assistant turn — no model call (§11.4), so it works even with AI off. The session
 * then flows as a normal streaming chat; the host-side prompt assembly picks up the addendum from `guideId`.
 */
export interface StartGuidedDeps {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  guideId: string;
  now: Date;
}

/** Returns the new conversation id, or null if `guideId` isn't in the catalog (§7). */
export async function startGuided(
  deps: StartGuidedDeps,
): Promise<{ conversationId: string } | null> {
  const { fs, key, personId, guideId, now } = deps;
  const exercise = getExercise(guideId);
  if (!exercise) return null;
  const at = now.toISOString();
  const id = uuid();
  const conversation: Conversation = {
    id,
    schemaVersion: 1,
    personId,
    title: exercise.title,
    createdAt: at,
    updatedAt: at,
    status: 'inProgress',
    guideId,
    ...(exercise.kind === 'structured' ? { guideStep: 0 } : {}),
    messages: [{ role: 'assistant', content: exercise.openingMessage, ts: at }],
  };
  await saveConversation(fs, key, conversation);
  return { conversationId: id };
}
