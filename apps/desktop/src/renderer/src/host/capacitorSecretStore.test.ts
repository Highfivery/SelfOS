// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { capacitorSecretStore, type KeychainPlugin } from './capacitorSecretStore';

function mockKeychain(overrides: Partial<KeychainPlugin> = {}): KeychainPlugin {
  return {
    get: vi.fn(() => Promise.resolve({ value: null })),
    set: vi.fn(() => Promise.resolve()),
    has: vi.fn(() => Promise.resolve({ value: false })),
    remove: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('capacitorSecretStore', () => {
  it('unwraps get value; null stays null', async () => {
    const present = capacitorSecretStore(
      mockKeychain({ get: () => Promise.resolve({ value: 'sk-123' }) }),
    );
    expect(await present.get('anthropic.apiKey')).toBe('sk-123');

    const absent = capacitorSecretStore(mockKeychain());
    expect(await absent.get('anthropic.apiKey')).toBeNull();
  });

  it('forwards set with id + value', async () => {
    const plugin = mockKeychain();
    await capacitorSecretStore(plugin).set('master.key', 'AAAA');
    expect(plugin.set).toHaveBeenCalledWith({ id: 'master.key', value: 'AAAA' });
  });

  it('unwraps has boolean', async () => {
    const yes = capacitorSecretStore(mockKeychain({ has: () => Promise.resolve({ value: true }) }));
    expect(await yes.has('master.key')).toBe(true);
    expect(await capacitorSecretStore(mockKeychain()).has('master.key')).toBe(false);
  });

  it('clear maps to remove', async () => {
    const plugin = mockKeychain();
    await capacitorSecretStore(plugin).clear('master.key');
    expect(plugin.remove).toHaveBeenCalledWith({ id: 'master.key' });
  });

  it('round-trips a value through a stateful fake keychain', async () => {
    const store = new Map<string, string>();
    const plugin: KeychainPlugin = {
      get: ({ id }) => Promise.resolve({ value: store.get(id) ?? null }),
      set: ({ id, value }) => {
        store.set(id, value);
        return Promise.resolve();
      },
      has: ({ id }) => Promise.resolve({ value: store.has(id) }),
      remove: ({ id }) => {
        store.delete(id);
        return Promise.resolve();
      },
    };
    const secrets = capacitorSecretStore(plugin);
    await secrets.set('k', 'v');
    expect(await secrets.has('k')).toBe(true);
    expect(await secrets.get('k')).toBe('v');
    await secrets.clear('k');
    expect(await secrets.get('k')).toBeNull();
  });
});
