import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { readEncryptedJson, writeEncryptedJson } from './encryptedStore';

const key = generateMasterKey();

describe('encryptedStore', () => {
  it('round-trips JSON through an encrypted file', async () => {
    const fs = memFileSystem();
    await writeEncryptedJson(fs, 'config/thing.enc', { hello: 'world', n: 42 }, key);
    expect(await readEncryptedJson(fs, 'config/thing.enc', key)).toEqual({ hello: 'world', n: 42 });
  });

  it('returns null for an absent file', async () => {
    expect(await readEncryptedJson(memFileSystem(), 'config/missing.enc', key)).toBeNull();
  });

  it('encrypts at rest (no plaintext on disk) and rejects a non-encrypted file', async () => {
    const fs = memFileSystem();
    await writeEncryptedJson(fs, 'x.enc', { secret: 'SENSITIVE' }, key);
    const bytes = await fs.read('x.enc');
    const raw = bytes && new TextDecoder().decode(bytes);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('SENSITIVE');

    await fs.writeAtomic('plain.enc', new TextEncoder().encode('{"not":"an envelope"}'));
    await expect(readEncryptedJson(fs, 'plain.enc', key)).rejects.toThrow();
  });

  it('cannot be read with the wrong key', async () => {
    const fs = memFileSystem();
    await writeEncryptedJson(fs, 'x.enc', { a: 1 }, key);
    await expect(readEncryptedJson(fs, 'x.enc', generateMasterKey())).rejects.toThrow();
  });
});
