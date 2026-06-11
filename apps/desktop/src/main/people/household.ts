import { randomUUID } from 'node:crypto';
import { OWNER_ROLE_ID } from '../../shared/capabilities';
import type { HouseholdStatus } from '../../shared/channels';
import type { Person } from '../../shared/schemas';
import {
  createMasterKey,
  isVaultInitialized,
  loadMasterKey,
  VAULT_ALREADY_INITIALIZED,
} from '@selfos/core/crypto';
import { createNodeFileSystem } from '../host/nodeFileSystem';
import { createNodeSecretStore } from '../host/nodeSecretStore';
import type { Encryptor } from '../secrets/encryptor';
import { getAccessConfig, savePerson, setAccount } from '@selfos/core/people';
import { getActivePersonId, setActivePersonId } from './session';
import { setSuperAdminPassphrase } from './superAdmin';

/**
 * Whether the household is set up and who is active — drives the renderer's three-way post-boot gate
 * (10-multi-device-vault §3.1). `vaultInitialized` is a key-free property of the vault (recovery.enc
 * present), computed BEFORE the device key so a freshly-installed device routes to Unlock — not Setup.
 */
export async function householdStatus(
  userDataDir: string,
  encryptor: Encryptor,
  vaultDir: string | null,
): Promise<HouseholdStatus> {
  const key = await loadMasterKey(createNodeSecretStore(userDataDir, encryptor));
  if (!vaultDir) {
    return {
      vaultInitialized: false,
      hasMasterKey: key !== null,
      hasOwner: false,
      activePersonId: null,
    };
  }
  const fs = createNodeFileSystem(vaultDir);
  const vaultInitialized = await isVaultInitialized(fs);
  if (!key) {
    return { vaultInitialized, hasMasterKey: false, hasOwner: false, activePersonId: null };
  }
  const access = await getAccessConfig(fs, key);
  const hasOwner = access.accounts.some((account) => account.roleId === OWNER_ROLE_ID);
  return {
    vaultInitialized,
    hasMasterKey: true,
    hasOwner,
    activePersonId: await getActivePersonId(userDataDir),
  };
}

/**
 * First-run setup: generate the master key (+ recovery phrase) for a fresh vault, create the owner
 * person and account, store the super-admin passphrase, and activate the owner. Returns the recovery
 * phrase to show once (empty when resuming an interrupted setup — no new phrase is issued).
 *
 * Safety (10-multi-device-vault §6.3): we mint a master key ONLY for a genuinely fresh vault. An
 * already-initialized vault is never re-keyed — it is either finished (an interrupted first-run, where
 * this device holds the key but no owner exists yet) or refused (a second-owner attempt / a device
 * without the key, which must Unlock instead).
 */
export async function setupHousehold(
  userDataDir: string,
  encryptor: Encryptor,
  vaultDir: string,
  input: { ownerName: string; passphrase: string },
): Promise<{ recoveryPhrase: string; ownerId: string }> {
  const secrets = createNodeSecretStore(userDataDir, encryptor);
  const fs = createNodeFileSystem(vaultDir);

  // Mint a key only for a fresh vault; createMasterKey is the hard backstop against re-keying. The
  // people-non-empty check guards a partially-synced vault whose recovery.enc went missing (§7 #9).
  let recoveryPhrase = '';
  if (!(await isVaultInitialized(fs))) {
    if ((await fs.list('people')).length > 0) throw new Error(VAULT_ALREADY_INITIALIZED);
    recoveryPhrase = (await createMasterKey(secrets, fs)).recoveryPhrase;
  }

  const key = await loadMasterKey(secrets);
  // Initialized vault but this device has no key → it must Unlock first, not run Setup.
  if (!key) throw new Error(VAULT_ALREADY_INITIALIZED);

  // Never add a second owner to an existing household.
  const access = await getAccessConfig(fs, key);
  if (access.accounts.some((account) => account.roleId === OWNER_ROLE_ID)) {
    throw new Error(VAULT_ALREADY_INITIALIZED);
  }

  const now = new Date().toISOString();
  const owner: Person = {
    id: randomUUID(),
    schemaVersion: 1,
    displayName: input.ownerName,
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  await savePerson(fs, key, owner);
  await setAccount(fs, key, { personId: owner.id, roleId: OWNER_ROLE_ID });
  await setSuperAdminPassphrase(fs, key, input.passphrase);
  await setActivePersonId(userDataDir, owner.id);

  return { recoveryPhrase, ownerId: owner.id };
}
