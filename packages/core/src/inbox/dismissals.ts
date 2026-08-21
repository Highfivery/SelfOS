import { z } from 'zod';

import type { FileSystem } from '../host';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Entries the person has removed from their own queue (08 §35.3).
 *
 * In the RECIPIENT's own vault, deliberately (owner, 2026-08-20). Two precedents existed and they disagree:
 * a received questionnaire's dismissal is vault-stored (`recipientDismissedAt`), while favourites and nudge
 * dismissals are device-local. The questionnaire is the closer analogue — someone offered you something and
 * you took it out of your queue — and a dismissal that reappears on your other device reads as the app
 * forgetting what you told it.
 *
 * It has to live here rather than beside the thing dismissed, because the thing dismissed is not yours: a
 * contribution invitation lives in the AUTHOR's book folder, and a shared book's grant lives in the author's
 * vault. Writing there would cross the trust boundary for what is only ever a view decision about your own
 * queue. So the person's own space holds the ids they have finished with.
 */

const InboxDismissalsSchema = z.object({
  schemaVersion: z.literal(1),
  personId: z.string(),
  /** Kind-scoped entry ids (`<kind>:<domain id>`), so two domains can never collide. */
  ids: z.array(z.string()).default([]),
  updatedAt: z.string(),
});
export type InboxDismissals = z.infer<typeof InboxDismissalsSchema>;

/** Cap it so one person clearing a long queue can't grow the file without bound. Oldest drop off. */
const DISMISSAL_CAP = 500;

const dismissalsPath = (personId: string): string => `people/${personId}/inbox/dismissals.enc`;

export async function readInboxDismissals(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<InboxDismissals> {
  const raw = await readEncryptedJson(fs, dismissalsPath(personId), key);
  const parsed = InboxDismissalsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // A missing or unreadable file means "nothing dismissed" — never a reason to hide the queue.
  return { schemaVersion: 1, personId, ids: [], updatedAt: new Date(0).toISOString() };
}

/** Dismiss one entry. Idempotent: dismissing twice is the same as once, and never churns the file. */
export async function dismissInboxEntry(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  entryId: string,
  now: Date,
): Promise<InboxDismissals> {
  const current = await readInboxDismissals(fs, key, personId);
  if (current.ids.includes(entryId)) return current;
  const next: InboxDismissals = {
    ...current,
    ids: [entryId, ...current.ids].slice(0, DISMISSAL_CAP),
    updatedAt: now.toISOString(),
  };
  await writeEncryptedJson(fs, dismissalsPath(personId), next, key);
  return next;
}
