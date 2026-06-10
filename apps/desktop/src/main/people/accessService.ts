import { hashPin, verifyPin } from '@selfos/core/crypto';
import type { FileSystem } from '@selfos/core/host';
import { DEFAULT_ROLES } from '../../shared/capabilities';
import type { AccessView } from '../../shared/channels';
import {
  AccessConfigSchema,
  type AccessConfig,
  type Account,
  type Role,
} from '../../shared/schemas';
import { readEncryptedJson, writeEncryptedJson } from '../crypto/encryptedStore';

const ACCESS_PATH = 'config/access.enc';

function defaults(): AccessConfig {
  return { schemaVersion: 1, roles: DEFAULT_ROLES, accounts: [] };
}

/** Read the access config, falling back to built-in defaults when none is written yet. */
export async function getAccessConfig(fs: FileSystem, key: Buffer): Promise<AccessConfig> {
  const raw = await readEncryptedJson(fs, ACCESS_PATH, key);
  return raw === null ? defaults() : AccessConfigSchema.parse(raw);
}

/** Renderer-safe view: roles + accounts with PIN hashes stripped to a boolean. */
export async function getAccessView(fs: FileSystem, key: Buffer): Promise<AccessView> {
  const config = await getAccessConfig(fs, key);
  return {
    roles: config.roles,
    accounts: config.accounts.map((account) => ({
      personId: account.personId,
      roleId: account.roleId,
      hasPin: account.pinHash !== undefined,
    })),
  };
}

async function write(fs: FileSystem, key: Buffer, config: AccessConfig): Promise<AccessConfig> {
  await writeEncryptedJson(fs, ACCESS_PATH, config, key);
  return config;
}

/** Write the defaults if no access config exists yet. */
export async function ensureAccessConfig(fs: FileSystem, key: Buffer): Promise<AccessConfig> {
  const raw = await readEncryptedJson(fs, ACCESS_PATH, key);
  return raw === null ? write(fs, key, defaults()) : AccessConfigSchema.parse(raw);
}

export async function saveRole(fs: FileSystem, key: Buffer, role: Role): Promise<AccessConfig> {
  const config = await getAccessConfig(fs, key);
  const roles = config.roles.some((existing) => existing.id === role.id)
    ? config.roles.map((existing) => (existing.id === role.id ? role : existing))
    : [...config.roles, role];
  return write(fs, key, { ...config, roles });
}

export async function setAccount(
  fs: FileSystem,
  key: Buffer,
  input: { personId: string; roleId: string; pin?: string | null | undefined },
): Promise<AccessConfig> {
  const config = await getAccessConfig(fs, key);
  const existing = config.accounts.find((account) => account.personId === input.personId);

  // pin: a string sets/replaces it, null clears it, undefined leaves it unchanged.
  const pinHash =
    input.pin === undefined
      ? existing?.pinHash
      : input.pin === null
        ? undefined
        : await hashPin(input.pin);
  const account: Account = {
    personId: input.personId,
    roleId: input.roleId,
    ...(pinHash ? { pinHash } : {}),
  };

  const accounts = existing
    ? config.accounts.map((a) => (a.personId === input.personId ? account : a))
    : [...config.accounts, account];
  return write(fs, key, { ...config, accounts });
}

export async function removeAccount(
  fs: FileSystem,
  key: Buffer,
  personId: string,
): Promise<AccessConfig> {
  const config = await getAccessConfig(fs, key);
  return write(fs, key, {
    ...config,
    accounts: config.accounts.filter((account) => account.personId !== personId),
  });
}

/** True if the PIN matches, or if the account has no PIN set (open access on this device). */
export async function verifyAccountPin(
  fs: FileSystem,
  key: Buffer,
  personId: string,
  pin: string,
): Promise<boolean> {
  const account = (await getAccessConfig(fs, key)).accounts.find(
    (candidate) => candidate.personId === personId,
  );
  if (!account) return false;
  if (!account.pinHash) return true;
  return verifyPin(pin, account.pinHash);
}
