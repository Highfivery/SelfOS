import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { VaultMetaSchema, type VaultMeta } from '../../shared/schemas';
import { pathExists, readJson, writeJsonAtomic } from './atomic';
import { migrate, type MigrationSet } from './migrations';

/** Where things live inside a vault folder (00-architecture §4.1). */
export const VAULT_LAYOUT = {
  metaFile: join('.selfos', 'meta.json'),
  settingsFile: join('config', 'settings.json'),
} as const;

const CURRENT_META_VERSION = 1;

/** Migrations for `.selfos/meta.json` (none yet — everything is v1). */
export const VAULT_META_MIGRATIONS: MigrationSet = { latest: CURRENT_META_VERSION, steps: {} };

async function readMeta(metaPath: string): Promise<VaultMeta> {
  return VaultMetaSchema.parse(migrate(await readJson(metaPath), VAULT_META_MIGRATIONS));
}

export type VaultStatus =
  | { ok: true; meta: VaultMeta }
  | { ok: false; reason: 'missing' | 'invalid' };

/**
 * Create the vault structure if needed and return its metadata. Idempotent: re-running on an
 * existing vault reads and returns the existing meta without overwriting it.
 */
export async function initializeVault(vaultDir: string): Promise<VaultMeta> {
  const metaPath = join(vaultDir, VAULT_LAYOUT.metaFile);
  const settingsPath = join(vaultDir, VAULT_LAYOUT.settingsFile);

  let meta: VaultMeta;
  if (await pathExists(metaPath)) {
    meta = await readMeta(metaPath);
  } else {
    const now = new Date().toISOString();
    meta = {
      schemaVersion: CURRENT_META_VERSION,
      vaultId: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonAtomic(metaPath, meta);
  }

  if (!(await pathExists(settingsPath))) {
    await writeJsonAtomic(settingsPath, { schemaVersion: 1, values: {} });
  }

  return meta;
}

/** Determine whether a configured vault path is usable. */
export async function getVaultStatus(vaultDir: string): Promise<VaultStatus> {
  if (!(await pathExists(vaultDir))) return { ok: false, reason: 'missing' };
  const metaPath = join(vaultDir, VAULT_LAYOUT.metaFile);
  if (!(await pathExists(metaPath))) return { ok: false, reason: 'invalid' };
  try {
    return { ok: true, meta: await readMeta(metaPath) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
