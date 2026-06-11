import { beforeEach, describe, expect, it } from 'vitest';
import { memFileSystem } from '../host/memFileSystem';
import { hashPin } from '../crypto';
import {
  hasSuperAdminPassphrase,
  setSuperAdminPassphrase,
  storeSuperAdminHash,
  verifySuperAdminPassphrase,
} from './superAdmin';

// A fixed 32-byte AES key — the super-admin file is encrypted under the master key.
const KEY = new Uint8Array(32).fill(7);

let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

describe('super-admin passphrase (in the vault)', () => {
  it('reports absent until set', async () => {
    expect(await hasSuperAdminPassphrase(fs)).toBe(false);
    expect(await verifySuperAdminPassphrase(fs, KEY, 'whatever')).toBe(false);
  });

  it('sets and verifies the passphrase, rejecting the wrong one', async () => {
    await setSuperAdminPassphrase(fs, KEY, 'open-sesame');
    expect(await hasSuperAdminPassphrase(fs)).toBe(true);
    expect(await verifySuperAdminPassphrase(fs, KEY, 'open-sesame')).toBe(true);
    expect(await verifySuperAdminPassphrase(fs, KEY, 'wrong')).toBe(false);
  });

  it('writes to config/superadmin.enc, encrypted (no plaintext hash on disk)', async () => {
    await setSuperAdminPassphrase(fs, KEY, 'open-sesame');
    const bytes = await fs.read('config/superadmin.enc');
    expect(bytes).not.toBeNull();
    const onDisk = new TextDecoder().decode(bytes ?? new Uint8Array());
    expect(onDisk).toContain('"alg"'); // an encrypted envelope, not a bare hash
    expect(onDisk).not.toContain('passphraseHash');
  });

  it('degrades to false on a corrupt file, but has() still reports it present (no clobber)', async () => {
    await fs.writeAtomic('config/superadmin.enc', new TextEncoder().encode('{ not an envelope'));
    expect(await verifySuperAdminPassphrase(fs, KEY, 'anything')).toBe(false);
    // Presence-based has() keeps the migration from mistaking corrupt for absent and overwriting it.
    expect(await hasSuperAdminPassphrase(fs)).toBe(true);
  });

  it('accepts a pre-computed hash (the device-local → vault migration path)', async () => {
    // storeSuperAdminHash seeds the vault from an existing device-local hash without the passphrase.
    await storeSuperAdminHash(fs, KEY, await hashPin('legacy-pass'));
    expect(await hasSuperAdminPassphrase(fs)).toBe(true);
    expect(await verifySuperAdminPassphrase(fs, KEY, 'legacy-pass')).toBe(true);
    expect(await verifySuperAdminPassphrase(fs, KEY, 'nope')).toBe(false);
  });
});
