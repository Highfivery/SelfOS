import { z } from 'zod';
import type { EmailClient, FileSystem } from '../host';
import { uuid } from '../id';
import {
  EmailActivityEntrySchema,
  EmailContentSnapshotSchema,
  type EmailActivityEntry,
  type EmailContentSnapshot,
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

const emailContentPath = (personId: string, entryId: string): string =>
  `people/${personId}/email/content/${entryId}.enc`;

/** A safe path segment (no traversal / separators) — guards the content read against a crafted id. */
const isSafeSegment = (v: string): boolean => /^[A-Za-z0-9_-]+$/.test(v);

/**
 * Read the stored rendered content of one sent email (67 §3.7 — the owner view's "see what was sent"). Null
 * when there's no snapshot (a pre-Phase-6.1 send, a snapshot-write failure) or a corrupt/absent file. The
 * caller (the bridge) gates on `people.manage`; the id/person segments are path-guarded here too.
 */
export async function getEmailContent(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  entryId: string,
): Promise<EmailContentSnapshot | null> {
  if (!isSafeSegment(personId) || !isSafeSegment(entryId)) return null;
  try {
    const raw = await readEncryptedJson(fs, emailContentPath(personId, entryId), key);
    if (!raw) return null;
    const parsed = EmailContentSnapshotSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const ActivityShardSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(EmailActivityEntrySchema),
});

/**
 * Update logged activity entries in place (67 §3.4 / Phase 3) — the status poll + a cancel need to mutate
 * an already-logged entry (append-only otherwise). The `updater` returns a changed entry or the same one;
 * only shards with an actual change are rewritten. A corrupt shard is skipped, never crashes. Returns the
 * number of entries changed.
 */
export async function updateEmailActivity(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  updater: (entry: EmailActivityEntry) => EmailActivityEntry,
): Promise<number> {
  let changed = 0;
  for (const name of await fs.list(activityDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const path = `${activityDir(personId)}/${name}`;
    const raw = await readEncryptedJson(fs, path, key);
    if (!raw) continue;
    let entries: EmailActivityEntry[];
    try {
      entries = ActivityShardSchema.parse(raw).entries;
    } catch {
      continue; // a corrupt shard is quarantined
    }
    let shardChanged = false;
    const next = entries.map((entry) => {
      const updated = updater(entry);
      if (updated !== entry) {
        shardChanged = true;
        changed += 1;
      }
      return updated;
    });
    if (shardChanged) await writeEncryptedJson(fs, path, { schemaVersion: 1, entries: next }, key);
  }
  return changed;
}

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
 * The shared send-and-log tail every family runs through AFTER its own gating (67 §5.2). It hands the
 * composed email to Resend and writes an `EmailActivityEntry` regardless of the Resend outcome — a real
 * attempt (success OR a Resend failure) is always logged; only a pre-send gating miss is not. This is the
 * one place that both actually sends and logs, so logging can't be bypassed.
 */
async function performSend(deps: {
  fs: FileSystem;
  key: Uint8Array;
  email: EmailClient;
  resendKey: string;
  from: string;
  personId: string;
  family: EmailFamily;
  toAddress: string;
  composed: ComposedEmail;
  scheduledAt?: string;
  tokens?: string[];
  sourceKey?: string;
  /** Who the email is FOR, when that differs from the person it is logged under (76 §5.3). */
  recipientPersonId?: string;
  now: Date;
}): Promise<EmailSendResult> {
  const outcome = await deps.email.send({
    apiKey: deps.resendKey,
    from: deps.from,
    to: deps.toAddress,
    subject: deps.composed.subject,
    html: deps.composed.html,
    text: deps.composed.text,
    ...(deps.scheduledAt ? { scheduledAt: deps.scheduledAt } : {}),
  });

  const entryId = uuid();
  // Snapshot the rendered email (67 §3.7 / owner view "see what was sent") so the owner can view the exact
  // content later. Encrypted, per-person; best-effort — a snapshot write failure never fails the send.
  let contentSnapshotPath: string | undefined;
  try {
    const path = emailContentPath(deps.personId, entryId);
    await writeEncryptedJson(
      deps.fs,
      path,
      {
        schemaVersion: 1,
        subject: deps.composed.subject,
        html: deps.composed.html,
        text: deps.composed.text,
      } satisfies EmailContentSnapshot,
      deps.key,
    );
    contentSnapshotPath = path;
  } catch {
    contentSnapshotPath = undefined;
  }

  const entry: EmailActivityEntry = {
    id: entryId,
    schemaVersion: 1,
    personId: deps.personId,
    family: deps.family,
    subject: deps.composed.subject,
    toAddress: deps.toAddress,
    status: outcome.ok ? (deps.scheduledAt ? 'scheduled' : 'sent') : 'failed',
    sentAt: deps.now.toISOString(),
    clicks: [],
    tokens: deps.tokens ?? [],
    ...(outcome.ok ? { resendMessageId: outcome.id } : {}),
    ...(deps.scheduledAt ? { scheduledAt: deps.scheduledAt } : {}),
    ...(deps.sourceKey ? { sourceKey: deps.sourceKey } : {}),
    ...(deps.recipientPersonId ? { recipientPersonId: deps.recipientPersonId } : {}),
    ...(contentSnapshotPath ? { contentSnapshotPath } : {}),
  };
  await appendActivity(deps.fs, deps.key, entry);

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
  sourceKey?: string;
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

  return performSend({
    fs,
    key,
    email,
    resendKey,
    from,
    personId,
    family,
    toAddress: prefs.address,
    composed,
    now,
    ...(deps.scheduledAt ? { scheduledAt: deps.scheduledAt } : {}),
    ...(deps.tokens ? { tokens: deps.tokens } : {}),
    ...(deps.sourceKey ? { sourceKey: deps.sourceKey } : {}),
  });
}

/**
 * Family B — a transactional alert (67 §3.2 / Phase 2). An engagement family, so — unlike family A — it
 * routes through `sendFamilyEmail` (the person's own engagement address + the `transactional` opt-in +
 * pause). Per §7 it is NOT crisis-suppressed (crisis suppresses only C/D/E/F). It is **idempotent on
 * `sourceKey`** (the source notification's `coalesceKey#signature`): if a non-failed transactional entry
 * with this key is already logged, it no-ops — so a re-open never re-sends the same alert, while a changed
 * signature (a genuinely new event) is a new key and sends again. A prior FAILED send is retryable.
 */
export async function sendTransactionalEmail(deps: {
  fs: FileSystem;
  key: Uint8Array;
  email: EmailClient;
  resendKey: string | undefined;
  personId: string;
  sourceKey: string;
  composed: ComposedEmail;
  now: Date;
}): Promise<EmailSendResult> {
  const prior = await listEmailActivity(deps.fs, deps.key, deps.personId, {
    family: 'transactional',
  });
  const already = prior.find((e) => e.sourceKey === deps.sourceKey && e.status !== 'failed');
  if (already) return { ok: true, entryId: already.id };

  return sendFamilyEmail({
    fs: deps.fs,
    key: deps.key,
    email: deps.email,
    resendKey: deps.resendKey,
    personId: deps.personId,
    family: 'transactional',
    composed: deps.composed,
    crisisSuppressed: false, // §7 — transactional is not one of the crisis-suppressed families (C/D/E/F)
    sourceKey: deps.sourceKey,
    now: deps.now,
  });
}

/**
 * Family A — questionnaire delivery (67 §3.2 / Phase 1). SelfOS's first send to a RECIPIENT rather than
 * its own user, so its gating differs from the engagement families: it goes to the recipient's CONTACT
 * address (passed in, not the sender's engagement `EmailPrefs.address`), it is NOT gated on the recipient's
 * per-family opt-in / pause (they may not even be a SelfOS person — it's a delivery mechanism), and it is
 * NOT crisis-suppressed (crisis suppresses only the engagement families C/D/E/F, §7). The only gates are:
 * the household is configured (a resolvable key + a from-line) and a recipient address is present. The
 * activity entry is logged under the SENDER (the person who triggered the delivery), with the recipient's
 * address as `toAddress` — so the owner view attributes it to who sent it (67 §3.7).
 */
export async function sendQuestionnaireDeliveryEmail(deps: {
  fs: FileSystem;
  key: Uint8Array;
  email: EmailClient;
  resendKey: string | undefined;
  /** The person who triggered the delivery — the activity is logged under them. */
  senderPersonId: string;
  /** The recipient's contact address (from the delivery UI / `Person.email`), NOT an engagement address. */
  toAddress: string;
  composed: ComposedEmail;
  scheduledAt?: string;
  /** De-dup/identify key (Phase 3: `questionnaire-reminder:<assignmentId>` for a scheduled reminder). */
  sourceKey?: string;
  now: Date;
}): Promise<EmailSendResult> {
  const config = await readEmailConfig(deps.fs, deps.key);
  const from = fromLineOf(config);
  if (!deps.resendKey || !from) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (!deps.toAddress.trim()) return { ok: false, reason: 'NO_ADDRESS' };

  return performSend({
    fs: deps.fs,
    key: deps.key,
    email: deps.email,
    resendKey: deps.resendKey,
    from,
    personId: deps.senderPersonId,
    family: 'questionnaire-delivery',
    toAddress: deps.toAddress,
    composed: deps.composed,
    now: deps.now,
    ...(deps.scheduledAt ? { scheduledAt: deps.scheduledAt } : {}),
    ...(deps.sourceKey ? { sourceKey: deps.sourceKey } : {}),
  });
}

/**
 * Family I — an owner-authored note (76 §5.3).
 *
 * Shares family A's gating profile, not the engagement families': it goes to the recipient's CONTACT
 * address (`Person.email`, passed in), is NOT gated on their per-family opt-in or `paused`, and is not
 * crisis-suppressed. The owner sets the address and the note is not refusable — an owner decision
 * (76 §8.3), recorded there along with its deliverability cost.
 *
 * The activity entry is logged under the **SENDER** with `recipientPersonId` stamped. That is what makes
 * the delivery metrics work at all: `reconcileEmailSchedule` is active-person-scoped, so logging under
 * the recipient would mean their opens never refreshed until they themselves opened the app.
 *
 * The caller has ALREADY written the note record (76 §5.3). A failure here reduces reach; it never
 * loses the note.
 */
export async function sendNoteEmail(deps: {
  fs: FileSystem;
  key: Uint8Array;
  email: EmailClient;
  resendKey: string | undefined;
  /** The author — the activity is logged under them, so their own reconcile polls it. */
  senderPersonId: string;
  /** Who it is for. Stamped on the entry so the owner view can name them rather than an address. */
  recipientPersonId: string;
  /** Their contact address (`Person.email`), NOT an engagement address. */
  toAddress: string;
  composed: ComposedEmail;
  tokens?: string[];
  sourceKey?: string;
  now: Date;
}): Promise<EmailSendResult> {
  const config = await readEmailConfig(deps.fs, deps.key);
  const from = fromLineOf(config);
  if (!deps.resendKey || !from) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (!deps.toAddress.trim()) return { ok: false, reason: 'NO_ADDRESS' };

  return performSend({
    fs: deps.fs,
    key: deps.key,
    email: deps.email,
    resendKey: deps.resendKey,
    from,
    personId: deps.senderPersonId,
    family: 'note',
    toAddress: deps.toAddress,
    composed: deps.composed,
    now: deps.now,
    recipientPersonId: deps.recipientPersonId,
    ...(deps.tokens ? { tokens: deps.tokens } : {}),
    ...(deps.sourceKey ? { sourceKey: deps.sourceKey } : {}),
  });
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
