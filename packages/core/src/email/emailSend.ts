import { z } from 'zod';
import type { EmailClient, FileSystem } from '../host';
import { uuid } from '../id';
import {
  EmailActivityEntrySchema,
  type EmailActivityEntry,
  type EmailFamily,
  type EmailSendResult,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { fromLineOf, readEmailConfig } from './emailConfig';
import { effectiveFamilyEnabled, readEmailPrefs } from './emailPrefs';
import type { ComposedEmail } from './emailComposer';

const activityDir = (personId: string): string => `people/${personId}/email/activity`;
const shardPath = (personId: string, month: string): string =>
  `${activityDir(personId)}/${month}.enc`;
const monthOf = (iso: string): string => iso.slice(0, 7); // YYYY-MM

const ActivityShardSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(EmailActivityEntrySchema),
});

async function appendActivity(
  fs: FileSystem,
  key: Uint8Array,
  entry: EmailActivityEntry,
): Promise<void> {
  // `sentAt` is always set on a real entry; a scheduled-only entry shards by its schedule month.
  const path = shardPath(entry.personId, monthOf(entry.sentAt ?? entry.scheduledAt ?? ''));
  const raw = await readEncryptedJson(fs, path, key);
  const entries = raw ? ActivityShardSchema.parse(raw).entries : [];
  entries.push(entry);
  await writeEncryptedJson(fs, path, { schemaVersion: 1, entries }, key);
}

/**
 * The one send-and-log orchestrator (67 §5.2) — every family routes through it, so gating + logging can't
 * be bypassed. Gating order: crisis (suppresses ALL email, §8.1) → configured (key + from-line) → the
 * person's engagement address (fail-closed, §4.2) → the per-family opt-in → the global pause. A gating
 * miss is NOT logged (no send attempted); an actual send attempt (success or Resend failure) writes an
 * `EmailActivityEntry`. The composed content + `crisisSuppressed` are computed by the caller (the bridge).
 */
export async function sendFamilyEmail(deps: {
  fs: FileSystem;
  key: Uint8Array;
  email: EmailClient;
  resendKey: string | undefined;
  personId: string;
  family: EmailFamily;
  composed: ComposedEmail;
  crisisSuppressed: boolean;
  scheduledAt?: string;
  tokens?: string[];
  now: Date;
}): Promise<EmailSendResult> {
  const { fs, key, email, resendKey, personId, family, composed, now } = deps;

  if (deps.crisisSuppressed) return { ok: false, reason: 'CRISIS' };

  const config = await readEmailConfig(fs, key);
  const from = fromLineOf(config);
  if (!resendKey || !from) return { ok: false, reason: 'NOT_CONFIGURED' };

  const prefs = await readEmailPrefs(fs, key, personId);
  if (!prefs?.address) return { ok: false, reason: 'NO_ADDRESS' }; // fail-closed
  if (!effectiveFamilyEnabled(prefs, family)) return { ok: false, reason: 'FAMILY_OFF' };
  if (prefs.paused) return { ok: false, reason: 'PAUSED' };

  const outcome = await email.send({
    apiKey: resendKey,
    from,
    to: prefs.address,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    ...(deps.scheduledAt ? { scheduledAt: deps.scheduledAt } : {}),
  });

  const entry: EmailActivityEntry = {
    id: uuid(),
    schemaVersion: 1,
    personId,
    family,
    subject: composed.subject,
    toAddress: prefs.address,
    status: outcome.ok ? (deps.scheduledAt ? 'scheduled' : 'sent') : 'failed',
    sentAt: now.toISOString(),
    clicks: [],
    tokens: deps.tokens ?? [],
    ...(outcome.ok ? { resendMessageId: outcome.id } : {}),
    ...(deps.scheduledAt ? { scheduledAt: deps.scheduledAt } : {}),
  };
  await appendActivity(fs, key, entry);

  if (!outcome.ok)
    return {
      ok: false,
      reason: 'SEND_ERROR',
      ...(outcome.message ? { message: outcome.message } : {}),
    };
  return {
    ok: true,
    entryId: entry.id,
    ...(outcome.id ? { resendMessageId: outcome.id } : {}),
  };
}

/** Read a person's logged email activity, newest first (67 §6 — the owner view + own-history reads). */
export async function listEmailActivity(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  filter?: { family?: EmailFamily; from?: string; to?: string },
): Promise<EmailActivityEntry[]> {
  const out: EmailActivityEntry[] = [];
  for (const name of await fs.list(activityDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${activityDir(personId)}/${name}`, key);
    if (raw) {
      try {
        out.push(...ActivityShardSchema.parse(raw).entries);
      } catch {
        // A corrupt shard is quarantined, never crashes the view (67 §7).
      }
    }
  }
  const filtered = out.filter((entry) => {
    if (filter?.family && entry.family !== filter.family) return false;
    const at = entry.sentAt ?? entry.scheduledAt;
    if (filter?.from && at && at < filter.from) return false;
    if (filter?.to && at && at > filter.to) return false;
    return true;
  });
  return filtered.sort((a, b) => ((a.sentAt ?? '') < (b.sentAt ?? '') ? 1 : -1));
}
