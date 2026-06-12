import type { FileSystem } from '../host';
import {
  RawAccessAuditLogSchema,
  type RawAccessAuditEntry,
  type RawAccessAuditLog,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * The break-glass raw-access audit log (08-questionnaires §4.5/§8.4). Every reveal of a Private send's raw
 * answers — the concealed super-admin (any send) or a `senderSeesAll` sender holding
 * `questionnaires.readRaw` — appends an entry here **before** the answers are shown. The log lives
 * encrypted in the vault (`config/raw-access-audit.enc`), so it's captured the same way from every device
 * and is readable only in super-admin mode. The append/list authorization is enforced one layer up in the
 * bridge; this service owns the storage.
 */

const AUDIT_PATH = 'config/raw-access-audit.enc';

/** Read the audit log, or an empty log when none exists yet. */
async function readLog(fs: FileSystem, key: Uint8Array): Promise<RawAccessAuditLog> {
  const raw = await readEncryptedJson(fs, AUDIT_PATH, key);
  if (!raw) return { schemaVersion: 1, entries: [] };
  return RawAccessAuditLogSchema.parse(raw);
}

/** Append one reveal entry to the encrypted, cross-device audit log. */
export async function appendAuditEntry(
  fs: FileSystem,
  key: Uint8Array,
  entry: RawAccessAuditEntry,
): Promise<void> {
  const log = await readLog(fs, key);
  log.entries.push(entry);
  await writeEncryptedJson(fs, AUDIT_PATH, log, key);
}

/** The full audit trail, newest first. */
export async function listAuditEntries(
  fs: FileSystem,
  key: Uint8Array,
): Promise<RawAccessAuditEntry[]> {
  const { entries } = await readLog(fs, key);
  return [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
