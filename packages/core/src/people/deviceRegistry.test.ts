import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import {
  defaultDeviceLabel,
  listDevices,
  registerThisDevice,
  removeDevice,
  renameDevice,
} from './deviceRegistry';

const key = generateMasterKey();

describe('deviceRegistry (28 §5.2)', () => {
  it('registers two devices in distinct files (no clobber) and lists both', async () => {
    const fs = memFileSystem();
    await registerThisDevice(fs, key, {
      deviceId: 'A',
      label: "Ben's Mac",
      platform: 'macos',
      now: new Date('2026-06-21T10:00:00.000Z'),
    });
    await registerThisDevice(fs, key, {
      deviceId: 'B',
      label: 'iPhone',
      platform: 'ios',
      now: new Date('2026-06-21T11:00:00.000Z'),
    });
    // Distinct per-device files — no shared-file clobber.
    expect(await fs.read('config/devices/A.enc')).not.toBeNull();
    expect(await fs.read('config/devices/B.enc')).not.toBeNull();
    const devices = await listDevices(fs, key);
    expect(devices.map((d) => d.deviceId).sort()).toEqual(['A', 'B']);
    // Newest-seen first.
    expect(devices[0]?.deviceId).toBe('B');
  });

  it('encrypts the record at rest (ciphertext on disk, no plaintext label)', async () => {
    const fs = memFileSystem();
    await registerThisDevice(fs, key, {
      deviceId: 'A',
      label: 'SECRET-LAPTOP',
      platform: 'macos',
      now: new Date('2026-06-21T10:00:00.000Z'),
    });
    const raw = new TextDecoder().decode((await fs.read('config/devices/A.enc'))!);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('SECRET-LAPTOP');
  });

  it('heartbeat preserves createdAt + the renamed label; updates lastSeenAt + lastActivePersonId', async () => {
    const fs = memFileSystem();
    await registerThisDevice(fs, key, {
      deviceId: 'A',
      label: 'default',
      platform: 'macos',
      now: new Date('2026-06-21T10:00:00.000Z'),
    });
    await renameDevice(fs, key, 'A', 'Office Mac');
    await registerThisDevice(fs, key, {
      deviceId: 'A',
      label: 'default-2', // ignored on heartbeat — the owner's rename wins
      platform: 'macos',
      now: new Date('2026-06-21T12:00:00.000Z'),
      activePersonId: 'p1',
    });
    const [d] = await listDevices(fs, key);
    expect(d?.label).toBe('Office Mac');
    expect(d?.createdAt).toBe('2026-06-21T10:00:00.000Z');
    expect(d?.lastSeenAt).toBe('2026-06-21T12:00:00.000Z');
    expect(d?.lastActivePersonId).toBe('p1');
  });

  it('removeDevice deletes the entry', async () => {
    const fs = memFileSystem();
    await registerThisDevice(fs, key, {
      deviceId: 'A',
      label: 'Mac',
      platform: 'macos',
      now: new Date('2026-06-21T10:00:00.000Z'),
    });
    await removeDevice(fs, 'A');
    expect(await listDevices(fs, key)).toEqual([]);
  });

  it('defaultDeviceLabel maps platforms', () => {
    expect(defaultDeviceLabel('ios')).toBe('iPhone');
    expect(defaultDeviceLabel('web')).toBe('Web browser');
    expect(defaultDeviceLabel('macos')).toBe('Mac');
    expect(defaultDeviceLabel('macos', 'Studio')).toBe('Studio');
  });
});
