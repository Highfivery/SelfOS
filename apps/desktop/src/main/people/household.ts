import { randomUUID } from 'node:crypto';
import { OWNER_ROLE_ID } from '../../shared/capabilities';
import type { HouseholdStatus } from '../../shared/channels';
import type { Person } from '../../shared/schemas';
import { createMasterKey, loadMasterKey } from '@selfos/core/crypto';
import { createNodeFileSystem } from '../host/nodeFileSystem';
import { createNodeSecretStore } from '../host/nodeSecretStore';
import type { Encryptor } from '../secrets/encryptor';
import { getAccessConfig, savePerson, setAccount } from '@selfos/core/people';
import { getActivePersonId, setActivePersonId } from './session';
import { setSuperAdminPassphrase } from './superAdmin';

/** Whether the household is set up and who is active — drives the renderer's post-boot gate. */
export async function householdStatus(
  userDataDir: string,
  encryptor: Encryptor,
  vaultDir: string | null,
): Promise<HouseholdStatus> {
  const key = await loadMasterKey(createNodeSecretStore(userDataDir, encryptor));
  if (!key || !vaultDir) {
    return { hasMasterKey: key !== null, hasOwner: false, activePersonId: null };
  }
  const access = await getAccessConfig(createNodeFileSystem(vaultDir), key);
  const hasOwner = access.accounts.some((account) => account.roleId === OWNER_ROLE_ID);
  return { hasMasterKey: true, hasOwner, activePersonId: await getActivePersonId(userDataDir) };
}

/**
 * First-run setup: generate the master key (+ recovery phrase), create the owner person and account,
 * store the super-admin passphrase, and activate the owner. Returns the recovery phrase to show once.
 */
export async function setupHousehold(
  userDataDir: string,
  encryptor: Encryptor,
  vaultDir: string,
  input: { ownerName: string; passphrase: string },
): Promise<{ recoveryPhrase: string; ownerId: string }> {
  const secrets = createNodeSecretStore(userDataDir, encryptor);
  const fs = createNodeFileSystem(vaultDir);
  const { recoveryPhrase } = await createMasterKey(secrets, fs);
  const key = await loadMasterKey(secrets);
  if (!key) throw new Error('Master key creation failed');

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
  await setSuperAdminPassphrase(userDataDir, input.passphrase);
  await setActivePersonId(userDataDir, owner.id);

  return { recoveryPhrase, ownerId: owner.id };
}
