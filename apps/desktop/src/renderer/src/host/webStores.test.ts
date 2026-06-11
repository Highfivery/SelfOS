// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  currentDeviceId,
  webDeviceSettings,
  webDeviceStore,
  webFakeClaudeClient,
  webSecretStore,
} from './webStores';

beforeEach(() => localStorage.clear());

describe('currentDeviceId', () => {
  it('defaults to A and reads ?device=', () => {
    expect(currentDeviceId('')).toBe('A');
    expect(currentDeviceId('?device=B')).toBe('B');
  });
});

describe('webSecretStore', () => {
  it('set/get/has/clear, namespaced per device', async () => {
    const a = webSecretStore('A');
    const b = webSecretStore('B');
    await a.set('master', 'key-a');
    expect(await a.get('master')).toBe('key-a');
    expect(await a.has('master')).toBe(true);
    // A different device has its own keychain — the master key does NOT leak across devices.
    expect(await b.get('master')).toBeNull();
    await a.clear('master');
    expect(await a.has('master')).toBe(false);
  });
});

describe('webDeviceStore', () => {
  it('returns defaults, merges patches, and persists', async () => {
    const store = webDeviceStore('A');
    expect(await store.read()).toEqual({ schemaVersion: 1, vaultPath: null });
    await store.update({ vaultBookmark: 'SelfOS' });
    await store.update({ activePersonId: 'owner-1' });
    expect(await store.read()).toMatchObject({
      vaultBookmark: 'SelfOS',
      activePersonId: 'owner-1',
    });
    // A fresh handle on the same device reads the persisted state.
    expect(await webDeviceStore('A').read()).toMatchObject({ activePersonId: 'owner-1' });
  });

  it('namespaces state per device', async () => {
    await webDeviceStore('A').update({ activePersonId: 'owner-1' });
    expect((await webDeviceStore('B').read()).activePersonId).toBeUndefined();
  });
});

describe('webDeviceSettings', () => {
  it('reads {} by default and round-trips a values map', async () => {
    const settings = webDeviceSettings('A');
    expect(await settings.read()).toEqual({});
    await settings.write({ 'window.x': 1 });
    expect(await settings.read()).toEqual({ 'window.x': 1 });
  });
});

describe('webFakeClaudeClient', () => {
  it('streams a canned reply and reports usage', async () => {
    const chunks: string[] = [];
    const result = await webFakeClaudeClient().stream(
      { apiKey: 'sk', model: 'm', system: '', messages: [], maxTokens: 16 },
      (delta) => chunks.push(delta),
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });
});
