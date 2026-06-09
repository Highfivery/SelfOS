// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceStatePath, readDeviceState, writeDeviceState } from './deviceStore';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'selfos-userdata-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('deviceStore', () => {
  it('returns defaults when no state file exists', async () => {
    expect(await readDeviceState(dir)).toEqual({ schemaVersion: 1, vaultPath: null });
  });

  it('round-trips a written state', async () => {
    await writeDeviceState(dir, { schemaVersion: 1, vaultPath: '/some/vault' });
    expect(await readDeviceState(dir)).toEqual({ schemaVersion: 1, vaultPath: '/some/vault' });
  });

  it('falls back to defaults on a corrupt file', async () => {
    await writeFile(deviceStatePath(dir), 'not json', 'utf8');
    expect(await readDeviceState(dir)).toEqual({ schemaVersion: 1, vaultPath: null });
  });
});
