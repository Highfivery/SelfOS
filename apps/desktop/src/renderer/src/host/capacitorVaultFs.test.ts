// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { toBase64 } from '@selfos/core/encoding';
import { capacitorFileSystem, type VaultFsPlugin } from './capacitorVaultFs';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array | null): string | null =>
  bytes === null ? null : new TextDecoder().decode(bytes);

function mockPlugin(overrides: Partial<VaultFsPlugin> = {}): VaultFsPlugin {
  return {
    pickFolder: vi.fn(() => Promise.resolve({ bookmark: 'bm', name: 'SelfOS' })),
    read: vi.fn(() => Promise.resolve({ data: null })),
    writeAtomic: vi.fn(() => Promise.resolve()),
    list: vi.fn(() => Promise.resolve({ entries: [] })),
    remove: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('capacitorFileSystem', () => {
  it('decodes base64 bytes from read; null stays null', async () => {
    const plugin = mockPlugin({ read: () => Promise.resolve({ data: toBase64(enc('hello')) }) });
    const fs = capacitorFileSystem('bm', plugin);
    expect(dec(await fs.read('config/recovery.enc'))).toBe('hello');

    const empty = capacitorFileSystem('bm', mockPlugin());
    expect(await empty.read('missing')).toBeNull();
  });

  it('passes the bookmark + base64-encodes bytes on writeAtomic', async () => {
    const plugin = mockPlugin();
    await capacitorFileSystem('bm-123', plugin).writeAtomic('people/p1/profile.enc', enc('data'));
    expect(plugin.writeAtomic).toHaveBeenCalledWith({
      bookmark: 'bm-123',
      path: 'people/p1/profile.enc',
      data: toBase64(enc('data')),
    });
  });

  it('round-trips bytes through the bridge (write then read)', async () => {
    const store = new Map<string, string>();
    const plugin = mockPlugin({
      writeAtomic: ({ path, data }) => {
        store.set(path, data);
        return Promise.resolve();
      },
      read: ({ path }) => Promise.resolve({ data: store.get(path) ?? null }),
    });
    const fs = capacitorFileSystem('bm', plugin);
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await fs.writeAtomic('a.enc', bytes);
    expect([...(await fs.read('a.enc'))!]).toEqual([0, 1, 2, 250, 255]);
  });

  it('returns the entries array from list and forwards remove', async () => {
    const plugin = mockPlugin({ list: () => Promise.resolve({ entries: ['a', 'b'] }) });
    const fs = capacitorFileSystem('bm', plugin);
    expect(await fs.list('people')).toEqual(['a', 'b']);
    await fs.remove('people/a');
    expect(plugin.remove).toHaveBeenCalledWith({ bookmark: 'bm', path: 'people/a' });
  });
});
