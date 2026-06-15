import { hashPin, verifyPin } from '../crypto';
import type { FileSystem } from '../host';
import { DEFAULT_ROLES, reconcileRole } from '../capabilities';
import {
  AccessConfigSchema,
  type AccessConfig,
  type AccessView,
  type Account,
  type Role,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

const ACCESS_PATH = 'config/access.enc';

function defaults(): AccessConfig {
  return { schemaVersion: 1, roles: DEFAULT_ROLES, accounts: [] };
}

/**
 * Read the access config, falling back to built-in defaults when none is written yet. Built-in roles are
 * reconciled against the current code defaults on every read (capabilities.ts `reconcileRole`) so a role
 * frozen in an older vault picks up capabilities added since (e.g. `intake.own`) without a migration — fixing
 * the "existing Member isn't gated into onboarding" bug. The reconcile is in-memory; it doesn't rewrite the file.
 */
export async function getAccessConfig(fs: FileSystem, key: Uint8Array): Promise<AccessConfig> {
  const raw = await readEncryptedJson(fs, ACCESS_PATH, key);
  const config = raw === null ? defaults() : AccessConfigSchema.parse(raw);
  return { ...config, roles: config.roles.map(reconcileRole) };
}

/** Renderer-safe view: roles + accounts with PIN hashes stripped to a boolean. */
export async function getAccessView(fs: FileSystem, key: Uint8Array): Promise<AccessView> {
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

async function write(fs: FileSystem, key: Uint8Array, config: AccessConfig): Promise<AccessConfig> {
  await writeEncryptedJson(fs, ACCESS_PATH, config, key);
  return config;
}

/** Write the defaults if no access config exists yet. */
export async function ensureAccessConfig(fs: FileSystem, key: Uint8Array): Promise<AccessConfig> {
  const raw = await readEncryptedJson(fs, ACCESS_PATH, key);
  return raw === null ? write(fs, key, defaults()) : AccessConfigSchema.parse(raw);
}

export async function saveRole(fs: FileSystem, key: Uint8Array, role: Role): Promise<AccessConfig> {
  const config = await getAccessConfig(fs, key);
  const roles = config.roles.some((existing) => existing.id === role.id)
    ? config.roles.map((existing) => (existing.id === role.id ? role : existing))
    : [...config.roles, role];
  return write(fs, key, { ...config, roles });
}

export async function setAccount(
  fs: FileSystem,
  key: Uint8Array,
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

/**
 * Ensure each given (subject) person has a login account, creating a no-PIN **Member** account for any that
 * lack one (18-personal-onboarding / roles refactor 2026-06-15). Every household subject is switchable +
 * carries a role this way — so a freshly-created person appears in the switcher and a new Member is gated
 * into onboarding. Idempotent: writes only when something was added. The Owner's own account is untouched.
 */
export async function ensureMemberAccounts(
  fs: FileSystem,
  key: Uint8Array,
  subjectPersonIds: string[],
): Promise<AccessConfig> {
  const config = await getAccessConfig(fs, key);
  const have = new Set(config.accounts.map((account) => account.personId));
  const missing = subjectPersonIds.filter((id) => !have.has(id));
  if (missing.length === 0) return config;
  const accounts: Account[] = [
    ...config.accounts,
    ...missing.map((personId) => ({ personId, roleId: 'member' })),
  ];
  return write(fs, key, { ...config, accounts });
}

export async function removeAccount(
  fs: FileSystem,
  key: Uint8Array,
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
  key: Uint8Array,
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
