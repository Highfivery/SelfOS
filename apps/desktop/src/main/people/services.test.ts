// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '@selfos/core/crypto';
import type { FileSystem } from '@selfos/core/host';
import { createNodeFileSystem } from '../host/nodeFileSystem';
import type { Person, Relationship } from '../../shared/schemas';
import { deletePerson, getPerson, listPeople, savePerson, upsertPerson } from './peopleService';
import {
  deleteRelationship,
  listRelationships,
  saveRelationship,
  upsertRelationship,
} from './relationshipService';
import { getAccessConfig, getAccessView, setAccount, verifyAccountPin } from './accessService';

const key = Buffer.from(generateMasterKey());
let vault: string;
let fs: FileSystem;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-people-'));
  fs = createNodeFileSystem(vault);
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

function person(id: string, displayName: string, isSubject = false): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

describe('peopleService', () => {
  it('saves, reads, lists (sorted), and deletes people', async () => {
    await savePerson(fs, key, person('p1', 'Bea', true));
    await savePerson(fs, key, person('p2', 'Alex'));
    expect((await listPeople(fs, key)).map((p) => p.displayName)).toEqual(['Alex', 'Bea']);
    expect((await getPerson(fs, key, 'p1'))?.isSubject).toBe(true);
    await deletePerson(fs, 'p1');
    expect(await getPerson(fs, key, 'p1')).toBeNull();
  });

  it('stores profiles encrypted at rest (no plaintext name on disk)', async () => {
    await savePerson(fs, key, person('p1', 'SecretName'));
    const raw = await readFile(join(vault, 'people', 'p1', 'profile.enc'), 'utf8');
    expect(raw).not.toContain('SecretName');
    expect(raw).toContain('aes-256-gcm');
  });

  it('cannot be read with the wrong master key', async () => {
    await savePerson(fs, key, person('p1', 'Bea'));
    await expect(getPerson(fs, Buffer.from(generateMasterKey()), 'p1')).rejects.toThrow();
  });

  it('ignores a stray non-directory entry in people/ (e.g. a synced .DS_Store)', async () => {
    await savePerson(fs, key, person('p1', 'Bea'));
    // Cloud providers drop files like `.DS_Store` into browsed folders; the old listing skipped them.
    await writeFile(join(vault, 'people', '.DS_Store'), 'junk');
    expect((await listPeople(fs, key)).map((p) => p.displayName)).toEqual(['Bea']);
  });
});

describe('upsertPerson', () => {
  it('creates with a generated id + timestamps, then updates preserving createdAt', async () => {
    const created = await upsertPerson(fs, key, {
      displayName: 'Sam',
      isSubject: false,
      tags: [],
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();

    const updated = await upsertPerson(fs, key, {
      id: created.id,
      displayName: 'Samuel',
      isSubject: true,
      tags: ['close'],
    });
    expect(updated.id).toBe(created.id);
    expect(updated.displayName).toBe('Samuel');
    expect(updated.isSubject).toBe(true);
    expect(updated.createdAt).toBe(created.createdAt);
  });
});

describe('relationshipService', () => {
  it('saves, lists, and deletes relationships', async () => {
    const rel: Relationship = {
      id: 'r1',
      schemaVersion: 1,
      fromPersonId: 'p1',
      toPersonId: 'p2',
      type: 'partner',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await saveRelationship(fs, key, rel);
    expect((await listRelationships(fs, key))[0]?.type).toBe('partner');
    await deleteRelationship(fs, 'r1');
    expect(await listRelationships(fs, key)).toEqual([]);
  });

  it('upserts a relationship with a generated id', async () => {
    const created = await upsertRelationship(fs, key, {
      fromPersonId: 'a',
      toPersonId: 'b',
      type: 'friend',
    });
    expect(created.id).toBeTruthy();
    expect((await listRelationships(fs, key)).length).toBe(1);
  });
});

describe('accessService', () => {
  it('defaults to the built-in roles and no accounts', async () => {
    const config = await getAccessConfig(fs, key);
    expect(config.roles.map((r) => r.id)).toEqual(['owner', 'member', 'guest']);
    expect(config.accounts).toEqual([]);
  });

  it('sets an account and verifies its pin', async () => {
    await setAccount(fs, key, { personId: 'p1', roleId: 'owner', pin: '4321' });
    expect(await verifyAccountPin(fs, key, 'p1', '4321')).toBe(true);
    expect(await verifyAccountPin(fs, key, 'p1', '0000')).toBe(false);
  });

  it('treats a pinless account as open and clears a pin with null', async () => {
    await setAccount(fs, key, { personId: 'p2', roleId: 'member' });
    expect(await verifyAccountPin(fs, key, 'p2', 'anything')).toBe(true);
    await setAccount(fs, key, { personId: 'p2', roleId: 'member', pin: '1111' });
    expect(await verifyAccountPin(fs, key, 'p2', 'anything')).toBe(false);
    await setAccount(fs, key, { personId: 'p2', roleId: 'member', pin: null });
    expect(await verifyAccountPin(fs, key, 'p2', 'anything')).toBe(true);
  });

  it('exposes a redacted view without pin hashes', async () => {
    await setAccount(fs, key, { personId: 'p1', roleId: 'owner', pin: '4321' });
    const view = await getAccessView(fs, key);
    const account = view.accounts.find((candidate) => candidate.personId === 'p1');
    expect(account?.hasPin).toBe(true);
    expect(account).not.toHaveProperty('pinHash');
    expect(view.roles.map((role) => role.id)).toContain('owner');
  });
});
