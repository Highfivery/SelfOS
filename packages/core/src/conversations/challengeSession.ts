import type { FileSystem } from '../host';
import { uuid } from '../id';
import type { ChallengeDomain, Conversation } from '../schemas';
import { saveConversation } from './conversationService';
import {
  CHALLENGE_COACH_ID,
  CHALLENGE_REFLECT_ID,
  challengeOpeningMessage,
  getReflectGuide,
} from './challengeCoach';

/**
 * Start a challenge session (52-challenge-sessions §3.1/§5.1) — the `startGuided` analogue. Creates an ordinary
 * conversation stamped with the `challenge-coach` `guideId`, seeded with a STATIC, domain-aware opener (no
 * model call — works offline, the 16 §11.4 precedent). The first real turn proposes, grounded in context, and
 * captures the agreed challenge from a marker (handled in `chatService`). Lives in `conversations` (not
 * `challenges`) so the challenges core imports no `conversations` runtime (the marker edge stays one-way).
 */
export interface StartChallengeDeps {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  domain?: ChallengeDomain; // an optional domain seed from the launcher (§3.1)
  now: Date;
}

export async function startChallenge(
  deps: StartChallengeDeps,
): Promise<{ conversationId: string }> {
  const { fs, key, personId, domain, now } = deps;
  const at = now.toISOString();
  const id = uuid();
  const conversation: Conversation = {
    id,
    schemaVersion: 1,
    personId,
    title: 'Take on a challenge',
    createdAt: at,
    updatedAt: at,
    status: 'inProgress',
    guideId: CHALLENGE_COACH_ID,
    messages: [{ role: 'assistant', content: challengeOpeningMessage(domain), ts: at }],
  };
  await saveConversation(fs, key, conversation);
  return { conversationId: id };
}

/**
 * Start a challenge REFLECTION session (§3.5) — "Talk about how it went". A normal conversation stamped with
 * the `challenge-reflect` guide and back-linked to the challenge via `challengeId`, so its End & summarize
 * stamps `provenance.challengeId` (§5.4). Static reflective opener, no model call.
 */
export interface StartChallengeReflectionDeps {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  challengeId: string;
  now: Date;
}

export async function startChallengeReflection(
  deps: StartChallengeReflectionDeps,
): Promise<{ conversationId: string }> {
  const { fs, key, personId, challengeId, now } = deps;
  const at = now.toISOString();
  const id = uuid();
  const conversation: Conversation = {
    id,
    schemaVersion: 1,
    personId,
    title: 'How did it go?',
    createdAt: at,
    updatedAt: at,
    status: 'inProgress',
    guideId: CHALLENGE_REFLECT_ID,
    challengeId,
    messages: [{ role: 'assistant', content: getReflectGuide().openingMessage, ts: at }],
  };
  await saveConversation(fs, key, conversation);
  return { conversationId: id };
}
