import { z } from 'zod';
import type { FileSystem, SecretStore } from '../host';
import { fromBase64, toBase64 } from '../encoding';
import { uuid } from '../id';
import {
  decryptBytes,
  deriveKeyFromPhrase,
  encryptBytes,
  generateMasterKey,
  generateRecoveryPhrase,
  isEncryptedEnvelope,
  randomBytes,
  wrapKey,
} from './cryptoService';
import { loadMasterKey, storeMasterKey } from './masterKey';

/**
 * Whole-vault key rotation (32-device-management §5.3) — the cryptographic revocation primitive. Generates
 * a NEW master key, re-encrypts every master-key-encrypted vault file under it, rewraps `recovery.enc` with
 * a NEW recovery phrase, deletes pending invites, and drops revoked device registry entries. Crash-safe via
 * a two-phase **stage → commit** flow journaled for resume: Phase 1 only writes to a staging area (originals
 * untouched → a crash here = "no rotation happened"); Phase 2 swaps staged files over originals from a
 * complete set under a `committing` journal (idempotent → a crash here resumes to fully-new-key).
 *
 * The new key is held in a **device-local temp secret** (never the synced journal) so a revoked device that
 * syncs mid-rotation can't read it. After rotation, every other device's old key fails wholesale → §5.5
 * re-key detection signs it out → it rejoins only with the new phrase / a new invite.
 */

const STAGING_DIR = '.selfos/rotation-staging';
const JOURNAL_PATH = 'config/keyrotation.journal.json';
const RECOVERY_PATH = 'config/recovery.enc';
const INVITES_DIR = 'config/invites';
const DEVICES_DIR = 'config/devices';
/** Top-level vault dirs that hold every master-key-encrypted file (path-discovery, not a per-feature list). */
const ROTATION_ROOTS = ['people', 'config', 'questionnaires'];
/** Device-local temp slot holding the new master key during a rotation (for crash-resume on the rotator). */
export const ROTATION_NEW_KEY_ID = 'selfos.rotation.newKey';

const stagingPath = (file: string): string => `${STAGING_DIR}/${file}`;

export type RotationErrorCode =
  | 'NO_MASTER_KEY'
  | 'ROTATION_IN_PROGRESS'
  | 'FILE_CORRUPT'
  | 'CANNOT_REVOKE_THIS_DEVICE';

export class RotationError extends Error {
  constructor(public readonly code: RotationErrorCode) {
    super(code);
    this.name = 'RotationError';
  }
}

export const RotationJournalSchema = z.object({
  schemaVersion: z.literal(1),
  rotationId: z.string(),
  startedAt: z.string().datetime(),
  rotatingDeviceId: z.string(),
  phase: z.enum(['staging', 'committing']),
  files: z.array(z.string()),
  revokeDeviceIds: z.array(z.string()),
});
export type RotationJournal = z.infer<typeof RotationJournalSchema>;

export interface RotateResult {
  recoveryPhrase: string;
  reencryptedFileCount: number;
  revokedDeviceIds: string[];
  cancelledInviteCount: number;
}

const encodeJson = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

/** Recursively collect every `.enc` file under the content roots (path-discovery so new features are covered). */
export async function enumerateEncryptedFiles(fs: FileSystem): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const name of await fs.list(dir)) {
      const path = `${dir}/${name}`;
      if (name.endsWith('.enc')) out.push(path);
      else await walk(path); // a name without an extension is a sub-directory
    }
  };
  for (const root of ROTATION_ROOTS) await walk(root);
  // recovery.enc is rewrapped (not re-encrypted under the master key); invites are deleted. Exclude both.
  return out.filter((p) => p !== RECOVERY_PATH && !p.startsWith(`${INVITES_DIR}/`));
}

/** Read + decrypt a content `.enc` under `oldKey`, re-encrypt under `newKey`, write to `dest`. */
async function reEncryptFile(
  fs: FileSystem,
  path: string,
  oldKey: Uint8Array,
  newKey: Uint8Array,
  dest: string,
): Promise<void> {
  const bytes = await fs.read(path);
  if (bytes === null) return;
  let envelope: unknown;
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RotationError('FILE_CORRUPT');
  }
  if (!isEncryptedEnvelope(envelope)) throw new RotationError('FILE_CORRUPT');
  let plain: Uint8Array;
  try {
    plain = await decryptBytes(envelope, oldKey);
  } catch {
    throw new RotationError('FILE_CORRUPT');
  }
  await fs.writeAtomic(dest, encodeJson(await encryptBytes(plain, newKey)));
}

/** Build the plaintext recovery bundle (the new key wrapped under a fresh phrase KEK + salt). */
async function buildRecoveryBundle(newKey: Uint8Array, phrase: string): Promise<Uint8Array> {
  const salt = randomBytes(16);
  const wrapped = await wrapKey(newKey, await deriveKeyFromPhrase(phrase, salt));
  return encodeJson({ schemaVersion: 1, salt: toBase64(salt), wrapped });
}

export async function readRotationJournal(fs: FileSystem): Promise<RotationJournal | null> {
  const bytes = await fs.read(JOURNAL_PATH);
  if (bytes === null) return null;
  try {
    return RotationJournalSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

const deleteInvites = async (fs: FileSystem): Promise<number> => {
  let count = 0;
  for (const name of await fs.list(INVITES_DIR)) {
    if (name.endsWith('.enc')) {
      await fs.remove(`${INVITES_DIR}/${name}`);
      count++;
    }
  }
  return count;
};

/**
 * Phase 2 — commit: swap staged files over originals (idempotent), promote the new key, drop revoked
 * devices + invites, finalize. Used by both `rotateMasterKey` and `resumeRotation`. `newKey` is the
 * device-local temp key. Returns the cancelled-invite count.
 */
async function commit(
  fs: FileSystem,
  secrets: SecretStore,
  journal: RotationJournal,
  newKey: Uint8Array,
): Promise<number> {
  for (const file of [...journal.files, RECOVERY_PATH]) {
    const staged = await fs.read(stagingPath(file));
    if (staged !== null) await fs.writeAtomic(file, staged);
  }
  await storeMasterKey(secrets, newKey); // promote: this device now reads the new-key vault
  for (const id of journal.revokeDeviceIds) await fs.remove(`${DEVICES_DIR}/${id}.enc`);
  const cancelledInviteCount = await deleteInvites(fs);
  await fs.remove(STAGING_DIR);
  await fs.remove(JOURNAL_PATH);
  await secrets.clear(ROTATION_NEW_KEY_ID);
  return cancelledInviteCount;
}

/**
 * Rotate the master key: re-encrypt the whole vault under a fresh key + new phrase, revoking `revokeDeviceIds`.
 * `thisDeviceId` is the surviving (rotating) device. Throws `RotationError` (NO_MASTER_KEY / ROTATION_IN_PROGRESS
 * / FILE_CORRUPT / CANNOT_REVOKE_THIS_DEVICE) leaving the vault consistent (untouched, or resumable).
 */
export async function rotateMasterKey(
  fs: FileSystem,
  secrets: SecretStore,
  opts: {
    revokeDeviceIds: string[];
    thisDeviceId: string;
    now: Date;
    /** TEST-ONLY: simulate a process crash at a phase boundary (no cleanup), to exercise resume (§10). */
    __crashAt?: 'afterStaging' | 'afterCommitJournal';
  },
): Promise<RotateResult> {
  const oldKey = await loadMasterKey(secrets);
  if (!oldKey) throw new RotationError('NO_MASTER_KEY');
  if (await readRotationJournal(fs)) throw new RotationError('ROTATION_IN_PROGRESS');
  if (opts.revokeDeviceIds.includes(opts.thisDeviceId)) {
    throw new RotationError('CANNOT_REVOKE_THIS_DEVICE');
  }

  const newKey = generateMasterKey();
  const recoveryPhrase = generateRecoveryPhrase();
  const files = await enumerateEncryptedFiles(fs);
  const journal: RotationJournal = {
    schemaVersion: 1,
    rotationId: uuid(),
    startedAt: opts.now.toISOString(),
    rotatingDeviceId: opts.thisDeviceId,
    phase: 'staging',
    files,
    revokeDeviceIds: opts.revokeDeviceIds,
  };

  // Hold the new key device-local (never in the synced journal) so a revoked device can't read it mid-rotation.
  await secrets.set(ROTATION_NEW_KEY_ID, toBase64(newKey));
  try {
    // --- Phase 1: stage (no destructive writes; originals stay old-key-readable) ---
    await fs.writeAtomic(JOURNAL_PATH, encodeJson(journal));
    for (const file of files) {
      await reEncryptFile(fs, file, oldKey, newKey, stagingPath(file));
    }
    await fs.writeAtomic(
      stagingPath(RECOVERY_PATH),
      await buildRecoveryBundle(newKey, recoveryPhrase),
    );
  } catch (error) {
    // A corrupt file (or any Phase-1 failure) → abandon: nothing destructive happened.
    await fs.remove(STAGING_DIR);
    await fs.remove(JOURNAL_PATH);
    await secrets.clear(ROTATION_NEW_KEY_ID);
    throw error;
  }

  // TEST-ONLY crash after a complete Phase 1 (journal still 'staging') — resume must discard, vault intact.
  if (opts.__crashAt === 'afterStaging') throw new Error('__CRASH__');

  // --- Phase 2: commit (swap from the complete staged set; idempotent on resume) ---
  await fs.writeAtomic(JOURNAL_PATH, encodeJson({ ...journal, phase: 'committing' }));
  // TEST-ONLY crash right after the journal flips to 'committing' — resume must finish the swap.
  if (opts.__crashAt === 'afterCommitJournal') throw new Error('__CRASH__');
  const cancelledInviteCount = await commit(
    fs,
    secrets,
    { ...journal, phase: 'committing' },
    newKey,
  );

  return {
    recoveryPhrase,
    reencryptedFileCount: files.length,
    revokedDeviceIds: opts.revokeDeviceIds,
    cancelledInviteCount,
  };
}

/**
 * Resume a rotation found at boot (§5.3). `staging` → discard (nothing destructive happened; vault stays
 * old-key). `committing` → re-run the idempotent swap to reach fully-new-key. Only the rotating device can
 * resume a `committing` rotation (it holds the device-local new key); another device leaves it for the
 * rotator and is handled by §5.5 re-key detection. Returns what it did.
 */
export async function resumeRotation(
  fs: FileSystem,
  secrets: SecretStore,
  thisDeviceId: string,
): Promise<'none' | 'discarded' | 'committed' | 'not-this-device'> {
  const journal = await readRotationJournal(fs);
  if (!journal) return 'none';
  if (journal.phase === 'staging') {
    await fs.remove(STAGING_DIR);
    await fs.remove(JOURNAL_PATH);
    await secrets.clear(ROTATION_NEW_KEY_ID);
    return 'discarded';
  }
  // committing
  if (journal.rotatingDeviceId !== thisDeviceId) return 'not-this-device';
  const base64 = await secrets.get(ROTATION_NEW_KEY_ID);
  if (!base64) {
    // The temp new key is gone but commit is mid-flight — the only safe recovery is the new phrase via
    // Unlock; leave the journal for an explicit retry rather than guess. (Should not happen on the rotator.)
    return 'not-this-device';
  }
  await commit(fs, secrets, journal, fromBase64(base64));
  return 'committed';
}
