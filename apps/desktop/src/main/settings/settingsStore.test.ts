// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDeviceSettings, writeDeviceSettings } from './settingsStore';

let userData: string;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'selfos-set-ud-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('device settings store', () => {
  it('returns an empty map when nothing is persisted', async () => {
    expect(await readDeviceSettings(userData)).toEqual({});
  });

  it('round-trips the device-scoped values map', async () => {
    await writeDeviceSettings(userData, { 'window.x': 1, 'window.y': 2 });
    expect(await readDeviceSettings(userData)).toEqual({ 'window.x': 1, 'window.y': 2 });
  });

  it('replaces the whole map on write (the factory does read-merge-write)', async () => {
    await writeDeviceSettings(userData, { a: 1, b: 2 });
    await writeDeviceSettings(userData, { a: 1 });
    expect(await readDeviceSettings(userData)).toEqual({ a: 1 });
  });
});
