import { z } from 'zod';
import type { FileSystem } from '../host';
import { deriveKeyFromPhrase, randomBytes, unwrapKey, wrapKey } from '../crypto';
import { fromBase64, toBase64 } from '../encoding';
import { uuid } from '../id';
import type { InviteSummary } from '../schemas';
import { INVITE_WORDS } from './inviteWords';

export type { InviteSummary };

/**
 * One-time member **invite codes** (10-multi-device-vault §5.4). The owner generates a word-phrase code
 * for a specific member; the master key wrapped under that code's KEK is written to a key-free-readable
 * `config/invites/<id>.enc` (the redeeming device has no master key yet). The member enters the code on
 * a new device to unwrap the key, then sets their own PIN. Codes are single-use (deleted on redeem) and
 * expire after 7 days.
 */
const INVITES_DIR = 'config/invites';
const INVITE_WORD_COUNT = 6;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const EnvelopeSchema = z.object({
  v: z.literal(1),
  alg: z.literal('aes-256-gcm'),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

const InviteFileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  personId: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  salt: z.string(), // base64
  wrapped: EnvelopeSchema,
});
type InviteFile = z.infer<typeof InviteFileSchema>;

function invitePath(id: string): string {
  return `${INVITES_DIR}/${id}.enc`;
}

/**
 * Generate a human-typeable word-phrase code: 6 words from the 128-word list (~2⁴²). A random byte maps
 * to a word with no modulo bias (256 % 128 === 0). Case- and separator-insensitive on redeem (the KDF
 * normalizes the phrase), so `Amber Tide …` and `amber-tide-…` derive the same key.
 */
export function generateInviteCode(): string {
  const words: string[] = [];
  for (const byte of randomBytes(INVITE_WORD_COUNT)) {
    const word = INVITE_WORDS[byte % INVITE_WORDS.length];
    if (word !== undefined) words.push(word);
  }
  return words.join('-');
}

async function readInvite(fs: FileSystem, path: string): Promise<InviteFile | null> {
  const bytes = await fs.read(path);
  if (bytes === null) return null;
  try {
    return InviteFileSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null; // ignore unparsable invite files
  }
}

function isExpired(invite: InviteFile, now: number): boolean {
  return Date.parse(invite.expiresAt) <= now;
}

/** Create a pending invite for `personId`. Returns the plain code (shown once) + its non-secret summary. */
export async function createInvite(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: number,
): Promise<{ code: string; invite: InviteSummary }> {
  const code = generateInviteCode();
  const salt = randomBytes(16);
  const wrapped = await wrapKey(key, await deriveKeyFromPhrase(code, salt));
  const id = uuid();
  const file: InviteFile = {
    schemaVersion: 1,
    id,
    personId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    salt: toBase64(salt),
    wrapped,
  };
  await fs.writeAtomic(
    invitePath(id),
    new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`),
  );
  return {
    code,
    invite: { id, personId, createdAt: file.createdAt, expiresAt: file.expiresAt },
  };
}

/** Pending (non-expired) invites for a person; expired files are garbage-collected as a side effect. */
export async function listInvitesForPerson(
  fs: FileSystem,
  personId: string,
  now: number,
): Promise<InviteSummary[]> {
  const result: InviteSummary[] = [];
  for (const entry of await fs.list(INVITES_DIR)) {
    if (!entry.endsWith('.enc')) continue;
    const path = `${INVITES_DIR}/${entry}`;
    const file = await readInvite(fs, path);
    if (!file || file.personId !== personId) continue;
    if (isExpired(file, now)) {
      await fs.remove(path);
      continue;
    }
    result.push({
      id: file.id,
      personId: file.personId,
      createdAt: file.createdAt,
      expiresAt: file.expiresAt,
    });
  }
  return result;
}

/** Cancel (delete) a pending invite by id. */
export async function cancelInvite(fs: FileSystem, id: string): Promise<void> {
  await fs.remove(invitePath(id));
}

/**
 * Redeem an invite code on a new device: try it against each pending invite's salt; the one that unwraps
 * (and isn't expired) yields the master key + the bound `personId`. The invite is deleted (single-use).
 * Returns null when no pending invite matches (wrong/garbled code or all expired).
 */
export async function redeemInvite(
  fs: FileSystem,
  code: string,
  now: number,
): Promise<{ masterKey: Uint8Array; personId: string } | null> {
  for (const entry of await fs.list(INVITES_DIR)) {
    if (!entry.endsWith('.enc')) continue;
    const path = `${INVITES_DIR}/${entry}`;
    const file = await readInvite(fs, path);
    if (!file) continue;
    if (isExpired(file, now)) {
      await fs.remove(path);
      continue;
    }
    try {
      const kek = await deriveKeyFromPhrase(code, fromBase64(file.salt));
      const masterKey = await unwrapKey(file.wrapped, kek);
      await fs.remove(path); // single-use
      return { masterKey, personId: file.personId };
    } catch {
      // wrong code for this invite — keep trying the others
    }
  }
  return null;
}
