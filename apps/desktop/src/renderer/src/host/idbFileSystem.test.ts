// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { idbFileSystem } from './idbFileSystem';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array | null): string | null =>
  bytes === null ? null : new TextDecoder().decode(bytes);

let factory: IDBFactory;
beforeEach(() => {
  factory = new IDBFactory();
});

describe('idbFileSystem', () => {
  it('returns null for a missing file', async () => {
    const fs = idbFileSystem('v1', { factory });
    expect(await fs.read('config/settings.json')).toBeNull();
  });

  it('round-trips bytes', async () => {
    const fs = idbFileSystem('v1', { factory });
    await fs.writeAtomic('people/p1/profile.enc', enc('hello'));
    expect(dec(await fs.read('people/p1/profile.enc'))).toBe('hello');
  });

  it('lists immediate children (files + dirs), deduped; [] when absent', async () => {
    const fs = idbFileSystem('v1', { factory });
    await fs.writeAtomic('people/a/profile.enc', enc('a'));
    await fs.writeAtomic('people/b/profile.enc', enc('b'));
    await fs.writeAtomic('config/settings.json', enc('{}'));
    expect((await fs.list('people')).sort()).toEqual(['a', 'b']);
    expect(await fs.list('config')).toEqual(['settings.json']);
    expect(await fs.list('missing')).toEqual([]);
  });

  it('removes a file and a directory subtree', async () => {
    const fs = idbFileSystem('v1', { factory });
    await fs.writeAtomic('people/a/profile.enc', enc('a'));
    await fs.writeAtomic('people/a/notes.enc', enc('n'));
    await fs.remove('people/a');
    expect(await fs.read('people/a/profile.enc')).toBeNull();
    expect(await fs.list('people')).toEqual([]);
  });

  it('isolates vaults by id but shares within an id (the multi-device case)', async () => {
    const v1 = idbFileSystem('v1', { factory });
    const v2 = idbFileSystem('v2', { factory });
    await v1.writeAtomic('config/recovery.enc', enc('one'));
    expect(await v2.read('config/recovery.enc')).toBeNull();
    // A second handle on the SAME vault id sees the same bytes — two devices, one shared vault.
    expect(dec(await idbFileSystem('v1', { factory }).read('config/recovery.enc'))).toBe('one');
  });

  it('fires onWrite for writes and removes', async () => {
    const writes: string[] = [];
    const fs = idbFileSystem('v1', { factory, onWrite: (path) => writes.push(path) });
    await fs.writeAtomic('a.enc', enc('a'));
    await fs.remove('a.enc');
    expect(writes).toEqual(['a.enc', 'a.enc']);
  });
});
