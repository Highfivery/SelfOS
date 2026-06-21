import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { SecretStore } from '../host';
import { ANTHROPIC_API_KEY_ID, OPENAI_API_KEY_ID } from '../schemas';
import {
  aiKeyStatus,
  clearSharedKey,
  readAiCredentials,
  resolveAiKey,
  resolveOpenAiKey,
  writeSharedKey,
} from './aiCredentialsService';

const key = generateMasterKey();
const now = new Date('2026-06-21T12:00:00.000Z');

/** A trivial in-memory SecretStore for resolution tests (device-local override). */
function memSecrets(initial: Record<string, string> = {}): SecretStore {
  const store = new Map<string, string>(Object.entries(initial));
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

const AI_PATH = 'config/ai-credentials.enc';

describe('aiCredentialsService — resolution order (25 §4.4)', () => {
  it('device override wins over a shared key', async () => {
    const fs = memFileSystem();
    await writeSharedKey(fs, key, { provider: 'anthropic', value: 'shared-key', now });
    const secrets = memSecrets({ [ANTHROPIC_API_KEY_ID]: 'device-key' });
    expect(await resolveAiKey(secrets, fs, key)).toEqual({ key: 'device-key', source: 'device' });
  });

  it('falls back to the shared key when there is no override', async () => {
    const fs = memFileSystem();
    await writeSharedKey(fs, key, { provider: 'anthropic', value: 'shared-key', now });
    expect(await resolveAiKey(memSecrets(), fs, key)).toEqual({
      key: 'shared-key',
      source: 'shared',
    });
  });

  it('resolves to none when neither exists', async () => {
    expect(await resolveAiKey(memSecrets(), memFileSystem(), key)).toEqual({
      key: undefined,
      source: 'none',
    });
  });

  it('resolves the OpenAI provider independently of Claude', async () => {
    const fs = memFileSystem();
    await writeSharedKey(fs, key, { provider: 'openai', value: 'shared-openai', now });
    expect(await resolveOpenAiKey(memSecrets(), fs, key)).toEqual({
      key: 'shared-openai',
      source: 'shared',
    });
    // Claude has no shared key → none, proving independence.
    expect(await resolveAiKey(memSecrets(), fs, key)).toEqual({ key: undefined, source: 'none' });
  });
});

describe('aiCredentialsService — write/clear (encrypted at rest)', () => {
  it('writes the shared key encrypted (ciphertext on disk, key inside the envelope)', async () => {
    const fs = memFileSystem();
    await writeSharedKey(fs, key, {
      provider: 'anthropic',
      value: 'sk-ant-SENSITIVE',
      sharedByPersonId: 'owner-1',
      now,
    });
    // On disk it must be a ciphertext envelope, never the raw key.
    const bytes = await fs.read(AI_PATH);
    const raw = bytes && new TextDecoder().decode(bytes);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('sk-ant-SENSITIVE');
    // Decrypted, the key + metadata round-trip.
    const creds = await readAiCredentials(fs, key);
    expect(creds?.anthropicApiKey).toBe('sk-ant-SENSITIVE');
    expect(creds?.sharedByPersonId).toBe('owner-1');
  });

  it('clearing one provider keeps the other; clearing both deletes the file (no orphan ciphertext)', async () => {
    const fs = memFileSystem();
    await writeSharedKey(fs, key, { provider: 'anthropic', value: 'a', now });
    await writeSharedKey(fs, key, { provider: 'openai', value: 'o', now });

    await clearSharedKey(fs, key, { provider: 'anthropic', now });
    const creds = await readAiCredentials(fs, key);
    expect(creds?.anthropicApiKey).toBeUndefined();
    expect(creds?.openaiApiKey).toBe('o');
    expect(await fs.read(AI_PATH)).not.toBeNull();

    await clearSharedKey(fs, key, { provider: 'openai', now });
    expect(await fs.read(AI_PATH)).toBeNull();
    expect(await readAiCredentials(fs, key)).toBeNull();
  });

  it('reads a corrupt/garbage file as null, never throwing', async () => {
    const fs = memFileSystem();
    await fs.writeAtomic(AI_PATH, new TextEncoder().encode('{"not":"an envelope"}'));
    expect(await readAiCredentials(fs, key)).toBeNull();
    // Resolution falls through to the device override.
    const secrets = memSecrets({ [ANTHROPIC_API_KEY_ID]: 'device-key' });
    expect(await resolveAiKey(secrets, fs, key)).toEqual({ key: 'device-key', source: 'device' });
  });
});

describe('aiKeyStatus — booleans + enum only, never a value', () => {
  it('reports the four source cases without leaking a key', async () => {
    const fs = memFileSystem();
    // none
    expect(await aiKeyStatus(memSecrets(), fs, key, 'anthropic')).toEqual({
      hasSharedKey: false,
      hasDeviceOverride: false,
      resolvedReady: false,
      source: 'none',
    });
    // shared
    await writeSharedKey(fs, key, { provider: 'anthropic', value: 'shared', now });
    expect(await aiKeyStatus(memSecrets(), fs, key, 'anthropic')).toEqual({
      hasSharedKey: true,
      hasDeviceOverride: false,
      resolvedReady: true,
      source: 'shared',
    });
    // device override wins
    const status = await aiKeyStatus(
      memSecrets({ [OPENAI_API_KEY_ID]: 'x', [ANTHROPIC_API_KEY_ID]: 'sk-ZZSECRET' }),
      fs,
      key,
      'anthropic',
    );
    expect(status).toEqual({
      hasSharedKey: true,
      hasDeviceOverride: true,
      resolvedReady: true,
      source: 'device',
    });
    // the status object never carries a key value
    expect(JSON.stringify(status)).not.toContain('sk-ZZSECRET');
  });
});
