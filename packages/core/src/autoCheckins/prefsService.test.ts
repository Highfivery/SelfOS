import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { writeEncryptedJson } from '../vault';
import {
  getAutoCheckinConfig,
  hasAutoCheckinConfig,
  seedDefaultConfigIfAbsent,
  setAutoCheckinConfig,
} from './prefsService';

const key = generateMasterKey();
const AUTHOR = 'p-author';
const configPath = `people/${AUTHOR}/questionnaires/autoCheckins.enc`;

describe('getAutoCheckinConfig', () => {
  it('defaults to off + empty when absent', async () => {
    const fs = memFileSystem();
    const config = await getAutoCheckinConfig(fs, key, AUTHOR);
    expect(config).toEqual({ schemaVersion: 1, enabled: false, targets: [] });
  });

  it('fails CLOSED (off) on a corrupt config', async () => {
    const fs = memFileSystem();
    await writeEncryptedJson(fs, configPath, { nonsense: true }, key);
    const config = await getAutoCheckinConfig(fs, key, AUTHOR);
    expect(config.enabled).toBe(false);
    expect(config.targets).toEqual([]);
  });
});

describe('setAutoCheckinConfig', () => {
  it('round-trips the master toggle + targets', async () => {
    const fs = memFileSystem();
    const target = {
      id: 't1',
      target: { kind: 'self' as const },
      enabled: true,
      includeIntimacy: false,
      explorationFocus: 'career direction',
      cadence: 'weekly' as const,
    };
    await setAutoCheckinConfig(fs, key, AUTHOR, { enabled: true, targets: [target] });
    const config = await getAutoCheckinConfig(fs, key, AUTHOR);
    expect(config.enabled).toBe(true);
    expect(config.targets).toEqual([target]);
  });

  it('merges each field independently', async () => {
    const fs = memFileSystem();
    await setAutoCheckinConfig(fs, key, AUTHOR, { enabled: true, targets: [] });
    await setAutoCheckinConfig(fs, key, AUTHOR, { enabled: false }); // targets untouched
    const config = await getAutoCheckinConfig(fs, key, AUTHOR);
    expect(config.enabled).toBe(false);
    expect(config.targets).toEqual([]);
  });
});

describe('seedDefaultConfigIfAbsent', () => {
  it('seeds an on, intimacy-ready self stream once onboarding is complete', async () => {
    const fs = memFileSystem();
    const { seeded, config } = await seedDefaultConfigIfAbsent(fs, key, AUTHOR, {
      onboardingComplete: true,
    });
    expect(seeded).toBe(true);
    expect(config.enabled).toBe(true);
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0]?.target).toEqual({ kind: 'self' });
    expect(config.targets[0]?.enabled).toBe(true);
    expect(config.targets[0]?.includeIntimacy).toBe(true);
    expect(await hasAutoCheckinConfig(fs, key, AUTHOR)).toBe(true);
  });

  it('does NOT seed a pre-onboarding person (no file written)', async () => {
    const fs = memFileSystem();
    const { seeded } = await seedDefaultConfigIfAbsent(fs, key, AUTHOR, {
      onboardingComplete: false,
    });
    expect(seeded).toBe(false);
    expect(await hasAutoCheckinConfig(fs, key, AUTHOR)).toBe(false);
  });

  it('is idempotent — never re-seeds once a config exists', async () => {
    const fs = memFileSystem();
    await seedDefaultConfigIfAbsent(fs, key, AUTHOR, { onboardingComplete: true });
    const again = await seedDefaultConfigIfAbsent(fs, key, AUTHOR, { onboardingComplete: true });
    expect(again.seeded).toBe(false);
  });

  it('never re-enables after an explicit off', async () => {
    const fs = memFileSystem();
    await setAutoCheckinConfig(fs, key, AUTHOR, { enabled: false, targets: [] }); // person turned it off
    const seed = await seedDefaultConfigIfAbsent(fs, key, AUTHOR, { onboardingComplete: true });
    expect(seed.seeded).toBe(false);
    expect(seed.config.enabled).toBe(false);
  });
});
