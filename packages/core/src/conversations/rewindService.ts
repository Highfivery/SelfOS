import type { FileSystem } from '../host';
import type { ChatMessage } from '../schemas';

/**
 * Rewind — the shared primitive behind "delete from here" and "retry from here" (66 §3.3/§5.3).
 *
 * Both features are the same operation: truncate the transcript at a message, then optionally re-generate.
 * Keeping it as one pure function plus thin per-domain wrappers means Sessions, Dreams and Onboarding
 * can't drift on the tricky parts (staleness, attachment cleanup).
 *
 * **Why a stamp instead of a message id.** An additive-optional `ChatMessage.id` would be absent on every
 * message already in every vault — exactly the messages people want to rewind — so we'd carry a positional
 * fallback forever and gain nothing for them. Instead the caller passes what it *believes* it's rewinding
 * and we verify before truncating. That works on all historical data, needs no schema change, and catches
 * the real failure mode: a renderer acting on a stale array after a turn landed underneath it.
 * (Together is different — its messages are genuinely multi-writer and already carry stable ids.)
 */

/** What the caller believes sits at the index it's rewinding to. */
export interface MessageStamp {
  role: 'user' | 'assistant';
  ts: string;
}

export type TruncateResult =
  | { ok: true; messages: ChatMessage[]; dropped: ChatMessage[] }
  /** STALE = the transcript moved under the caller; INVALID = the index isn't in range. */
  | { ok: false; reason: 'STALE' | 'INVALID' };

/**
 * Drop `messages[index]` and everything after it. Pure — no I/O — so the interesting rules are testable
 * in isolation. Refuses if the message at `index` doesn't match `expect`.
 */
export function truncateMessages(
  messages: ChatMessage[],
  index: number,
  expect: MessageStamp,
): TruncateResult {
  if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
    return { ok: false, reason: 'INVALID' };
  }
  const target = messages[index];
  if (!target || target.role !== expect.role || target.ts !== expect.ts) {
    return { ok: false, reason: 'STALE' };
  }
  return { ok: true, messages: messages.slice(0, index), dropped: messages.slice(index) };
}

/**
 * Remove the encrypted blobs behind any attachments on dropped messages. Without this a rewind silently
 * orphans real bytes in the person's vault — invisible, and the kind of thing that goes unnoticed for a
 * year. Best-effort and path-guarded: a failure never fails the rewind.
 *
 * The guard is injected (the `getMedia(fs, key, path, guard)` pattern) so this module stays free of any
 * domain import — otherwise `conversationService` importing the truncate while this imports its path
 * guard would be a cycle.
 */
export async function reapDroppedAttachments(
  fs: FileSystem,
  dropped: ChatMessage[],
  isOurAttachmentPath: (path: string) => boolean,
): Promise<void> {
  for (const message of dropped) {
    for (const ref of message.attachments ?? []) {
      if (!isOurAttachmentPath(ref.path)) continue;
      try {
        await fs.remove(ref.path);
      } catch {
        // Cleanup only — an unreachable blob must never block the rewind itself.
      }
    }
  }
}

/**
 * Where a rewind should truncate so the transcript ends on a message the coach can answer (66 §3.3).
 *
 * - Hovering an ASSISTANT message → drop that reply and everything after, so the transcript ends on the
 *   user message that prompted it and regenerating produces a fresh reply to the same question.
 * - Hovering a USER message → keep it, drop the reply and everything after, so regenerating re-answers it.
 *
 * "Delete from here" always truncates AT the hovered message; only regenerate uses this.
 */
export function regenerateIndexFor(messages: ChatMessage[], index: number): number {
  return messages[index]?.role === 'assistant' ? index : index + 1;
}
