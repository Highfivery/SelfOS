import { describe, expect, it } from 'vitest';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem, SecretStore } from '../host';
import { writeEncryptedJson, readEncryptedJson } from '../vault';
import { decryptBytes, encryptBytes } from './cryptoService';
import {
  createMasterKey,
  loadMasterKey,
  restoreFromRecoveryPhrase,
  VAULT_ALREADY_INITIALIZED,
} from './masterKey';
import {
  enumerateEncryptedFiles,
  readRotationJournal,
  resumeRotation,
  rotateMasterKey,
  RotationError,
} from './keyRotation';

function memSecrets(): SecretStore {
  const store = new Map<string, string>();
  return {
    get: (id) => Promise.resolve(store.get(id) ?? null),
    set: (id, value) => {
      store.set(id, value);
      return Promise.resolve();
    },
    has: (id) => Promise.resolve(store.has(id)),
    clear: (id) => {
      store.delete(id);
      return Promise.resolve();
    },
  };
}

const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
const IMAGE = 'people/p1/dreams/d1/image.enc';

/** Decrypt the raw-bytes image file (it isn't a JSON payload, so readEncryptedJson can't read it). */
async function decryptImage(fs: FileSystem, key: Uint8Array): Promise<Uint8Array> {
  const env = JSON.parse(new TextDecoder().decode((await fs.read(IMAGE))!));
  return decryptBytes(env, key);
}

/** Seed a vault with one `.enc` of every feature class + recovery + invites + a 2-device registry. */
async function seedVault(): Promise<{
  fs: FileSystem;
  secrets: SecretStore;
  oldKey: Uint8Array;
  oldPhrase: string;
  contentFiles: string[];
}> {
  const fs = memFileSystem();
  const secrets = memSecrets();
  const { recoveryPhrase: oldPhrase } = await createMasterKey(secrets, fs);
  const oldKey = (await loadMasterKey(secrets))!;

  const contentFiles = [
    'people/p1/profile.enc',
    'people/p1/conversations/c1.enc',
    'people/p1/insights/i1.enc',
    'people/p1/intake/session.enc',
    'people/p1/usage/2026-06.enc',
    'questionnaires/q1.enc',
    'questionnaires/assignments/a1.enc',
    'config/access.enc',
    'config/relay.enc',
    'config/ai-credentials.enc',
    'config/devices/A.enc',
    'config/devices/B.enc',
  ];
  for (const path of contentFiles) {
    await writeEncryptedJson(fs, path, { path, secret: `plain-${path}` }, oldKey);
  }
  // A binary file (dream image) via encryptBytes — exercises the byte path.
  await fs.writeAtomic(
    'people/p1/dreams/d1/image.enc',
    encode(
      `${JSON.stringify(await encryptBytes(new Uint8Array([1, 2, 3, 4]), oldKey), null, 2)}\n`,
    ),
  );
  contentFiles.push('people/p1/dreams/d1/image.enc');
  // A pending invite (key-free file) + the journal-name lookalike must NOT be touched/enumerated.
  await fs.writeAtomic('config/invites/inv1.enc', encode('{"invite":true}'));
  await fs.writeAtomic('config/settings.json', encode('{"schemaVersion":1,"values":{}}')); // plaintext, skipped

  return { fs, secrets, oldKey, oldPhrase, contentFiles };
}

describe('keyRotation — enumeration (28 §5.1)', () => {
  it('discovers every content .enc but excludes recovery.enc, invites, and plaintext settings', async () => {
    const { fs, contentFiles } = await seedVault();
    const found = (await enumerateEncryptedFiles(fs)).sort();
    expect(found).toEqual([...contentFiles].sort());
    expect(found).not.toContain('config/recovery.enc');
    expect(found).not.toContain('config/invites/inv1.enc');
    expect(found).not.toContain('config/settings.json');
  });
});

describe('keyRotation — full rotation (28 §5.3)', () => {
  it('re-encrypts everything under a new key, rewraps recovery, drops invites + the revoked device', async () => {
    const { fs, secrets, oldKey, oldPhrase, contentFiles } = await seedVault();
    const result = await rotateMasterKey(fs, secrets, {
      revokeDeviceIds: ['B'],
      thisDeviceId: 'A',
      now: new Date('2026-06-21T10:00:00.000Z'),
    });
    const newKey = (await loadMasterKey(secrets))!;

    expect(result.recoveryPhrase).not.toBe(oldPhrase);
    expect(result.revokedDeviceIds).toEqual(['B']);
    expect(result.cancelledInviteCount).toBe(1);

    // Every surviving content file decrypts with the NEW key and FAILS with the OLD key.
    for (const path of contentFiles.filter((p) => p !== 'config/devices/B.enc' && p !== IMAGE)) {
      await expect(readEncryptedJson(fs, path, newKey)).resolves.toBeTruthy();
      await expect(readEncryptedJson(fs, path, oldKey)).rejects.toThrow();
    }
    // The binary image re-encrypts too (decrypts to its bytes with the new key, fails with the old).
    expect([...(await decryptImage(fs, newKey))]).toEqual([1, 2, 3, 4]);
    await expect(decryptImage(fs, oldKey)).rejects.toThrow();
    // recovery.enc now unwraps with the NEW phrase, not the old.
    expect(await restoreFromRecoveryPhrase(memSecrets(), fs, result.recoveryPhrase)).toBe(true);
    expect(await restoreFromRecoveryPhrase(memSecrets(), fs, oldPhrase)).toBe(false);
    // Invites gone; the revoked device gone; the journal + staging cleaned up.
    expect(await fs.read('config/invites/inv1.enc')).toBeNull();
    expect(await fs.read('config/devices/B.enc')).toBeNull();
    expect(await fs.read('config/devices/A.enc')).not.toBeNull();
    expect(await readRotationJournal(fs)).toBeNull();
    expect(await fs.list('.selfos/rotation-staging')).toEqual([]);
  });

  it('refuses to revoke the rotating device', async () => {
    const { fs, secrets } = await seedVault();
    await expect(
      rotateMasterKey(fs, secrets, {
        revokeDeviceIds: ['A'],
        thisDeviceId: 'A',
        now: new Date(),
      }),
    ).rejects.toThrow(RotationError);
  });
});

describe('keyRotation — crash safety (28 §5.3, the most important tests)', () => {
  it('Phase-1 crash → resume DISCARDS; the vault is unchanged (old key still works)', async () => {
    const { fs, secrets, oldKey, oldPhrase, contentFiles } = await seedVault();
    await expect(
      rotateMasterKey(fs, secrets, {
        revokeDeviceIds: ['B'],
        thisDeviceId: 'A',
        now: new Date(),
        __crashAt: 'afterStaging',
      }),
    ).rejects.toThrow('__CRASH__');
    // A 'staging' journal is present; resume discards it.
    expect((await readRotationJournal(fs))?.phase).toBe('staging');
    expect(await resumeRotation(fs, secrets, 'A')).toBe('discarded');

    // The master key is STILL the old key; every file decrypts with it; recovery is still the OLD phrase.
    expect(await loadMasterKey(secrets)).toEqual(oldKey);
    for (const path of contentFiles.filter((p) => p !== IMAGE)) {
      await expect(readEncryptedJson(fs, path, oldKey)).resolves.toBeTruthy();
    }
    expect([...(await decryptImage(fs, oldKey))]).toEqual([1, 2, 3, 4]);
    expect(await restoreFromRecoveryPhrase(memSecrets(), fs, oldPhrase)).toBe(true);
    expect(await fs.read('config/invites/inv1.enc')).not.toBeNull(); // not cancelled
    expect(await readRotationJournal(fs)).toBeNull();
  });

  it('Phase-2 crash → resume COMMITS to fully-new-key; idempotent', async () => {
    const { fs, secrets, oldKey, oldPhrase, contentFiles } = await seedVault();
    await expect(
      rotateMasterKey(fs, secrets, {
        revokeDeviceIds: ['B'],
        thisDeviceId: 'A',
        now: new Date(),
        __crashAt: 'afterCommitJournal',
      }),
    ).rejects.toThrow('__CRASH__');
    // Mid-commit: journal is 'committing', master key not yet promoted (originals still old-key).
    expect((await readRotationJournal(fs))?.phase).toBe('committing');
    expect(await loadMasterKey(secrets)).toEqual(oldKey);

    expect(await resumeRotation(fs, secrets, 'A')).toBe('committed');
    const newKey = (await loadMasterKey(secrets))!;
    expect(newKey).not.toEqual(oldKey);

    for (const path of contentFiles.filter((p) => p !== 'config/devices/B.enc' && p !== IMAGE)) {
      await expect(readEncryptedJson(fs, path, newKey)).resolves.toBeTruthy();
      await expect(readEncryptedJson(fs, path, oldKey)).rejects.toThrow();
    }
    expect([...(await decryptImage(fs, newKey))]).toEqual([1, 2, 3, 4]);
    expect(await restoreFromRecoveryPhrase(memSecrets(), fs, oldPhrase)).toBe(false); // old phrase dead
    expect(await fs.read('config/invites/inv1.enc')).toBeNull();
    expect(await fs.read('config/devices/B.enc')).toBeNull();
    expect(await readRotationJournal(fs)).toBeNull();
    // Idempotent: a second resume is a no-op.
    expect(await resumeRotation(fs, secrets, 'A')).toBe('none');
  });
});

describe('keyRotation — refusals & guards', () => {
  it('aborts on a corrupt file BEFORE any destructive write (vault untouched)', async () => {
    const { fs, secrets, oldKey, contentFiles } = await seedVault();
    await fs.writeAtomic('people/p1/corrupt.enc', encode('not an envelope'));
    await expect(
      rotateMasterKey(fs, secrets, { revokeDeviceIds: [], thisDeviceId: 'A', now: new Date() }),
    ).rejects.toMatchObject({ code: 'FILE_CORRUPT' });
    // Vault untouched: old key still works, no journal/staging left behind.
    expect(await loadMasterKey(secrets)).toEqual(oldKey);
    for (const path of contentFiles.filter((p) => p !== IMAGE)) {
      await expect(readEncryptedJson(fs, path, oldKey)).resolves.toBeTruthy();
    }
    expect(await readRotationJournal(fs)).toBeNull();
    expect(await fs.list('.selfos/rotation-staging')).toEqual([]);
  });

  it('refuses a second concurrent rotation while a journal exists', async () => {
    const { fs, secrets } = await seedVault();
    await rotateMasterKey(fs, secrets, {
      revokeDeviceIds: [],
      thisDeviceId: 'A',
      now: new Date(),
      __crashAt: 'afterStaging',
    }).catch(() => undefined);
    await expect(
      rotateMasterKey(fs, secrets, { revokeDeviceIds: [], thisDeviceId: 'A', now: new Date() }),
    ).rejects.toMatchObject({ code: 'ROTATION_IN_PROGRESS' });
  });

  it('the createMasterKey non-overwrite guard stays intact after rotation', async () => {
    const { fs, secrets } = await seedVault();
    await rotateMasterKey(fs, secrets, { revokeDeviceIds: [], thisDeviceId: 'A', now: new Date() });
    // Rotation rewrote recovery.enc via rewrapRecovery, NOT createMasterKey — which still refuses to re-key.
    await expect(createMasterKey(secrets, fs)).rejects.toThrow(VAULT_ALREADY_INITIALIZED);
  });
});
