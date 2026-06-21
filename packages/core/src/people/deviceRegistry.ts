import type { FileSystem } from '../host';
import { DeviceRecordSchema, type DeviceRecord } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * The household device registry (32-device-management §4/§5.2). Every device that joins (Setup,
 * recovery-phrase unlock, invite redeem) writes its own `config/devices/<deviceId>.enc` — one file per
 * device so two devices booting at once never clobber a shared registry. The owner can list/rename/revoke;
 * key rotation (28 Slice B) re-encrypts survivors and deletes revoked entries. Encrypted under the master
 * key like all vault content; the renderer never reads these files directly.
 */

const DEVICES_DIR = 'config/devices';
const recordPath = (deviceId: string): string => `${DEVICES_DIR}/${deviceId}.enc`;

/** A friendly default label from the platform (the owner can rename it). */
export function defaultDeviceLabel(platform: string, hostname?: string): string {
  if (hostname && hostname.trim()) return hostname.trim();
  if (platform === 'ios') return 'iPhone';
  if (platform === 'web') return 'Web browser';
  if (platform === 'macos' || platform === 'darwin') return 'Mac';
  if (platform === 'win32') return 'Windows PC';
  if (platform === 'linux') return 'Linux PC';
  return 'This device';
}

/** Read one device's record (null if absent/corrupt — treated like any other vault file). */
export async function readDeviceRecord(
  fs: FileSystem,
  key: Uint8Array,
  deviceId: string,
): Promise<DeviceRecord | null> {
  try {
    const raw = await readEncryptedJson(fs, recordPath(deviceId), key);
    return raw ? DeviceRecordSchema.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Register this device, or update its `lastSeenAt` (+ `lastActivePersonId`) if already registered. Called
 * host-side on every join path and on boot (a heartbeat). `createdAt` is preserved across heartbeats.
 */
export async function registerThisDevice(
  fs: FileSystem,
  key: Uint8Array,
  input: {
    deviceId: string;
    label: string;
    platform: string;
    now: Date;
    activePersonId?: string | null;
  },
): Promise<void> {
  const existing = await readDeviceRecord(fs, key, input.deviceId);
  const nowIso = input.now.toISOString();
  const record: DeviceRecord = {
    schemaVersion: 1,
    deviceId: input.deviceId,
    // Keep the owner's renamed label across heartbeats; use the supplied label only on first register.
    label: existing?.label ?? input.label,
    platform: input.platform,
    createdAt: existing?.createdAt ?? nowIso,
    lastSeenAt: nowIso,
    ...(input.activePersonId !== undefined ? { lastActivePersonId: input.activePersonId } : {}),
  };
  await writeEncryptedJson(fs, recordPath(input.deviceId), record, key);
}

/** Every registered device, newest-seen first. Skips unreadable/corrupt entries. */
export async function listDevices(fs: FileSystem, key: Uint8Array): Promise<DeviceRecord[]> {
  const entries = await fs.list(DEVICES_DIR);
  const records: DeviceRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith('.enc')) continue;
    const record = await readDeviceRecord(fs, key, name.slice(0, -'.enc'.length));
    if (record) records.push(record);
  }
  return records.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** Rename a device (cosmetic; no rotation). No-op if the device isn't registered. */
export async function renameDevice(
  fs: FileSystem,
  key: Uint8Array,
  deviceId: string,
  label: string,
): Promise<void> {
  const existing = await readDeviceRecord(fs, key, deviceId);
  if (!existing) return;
  await writeEncryptedJson(fs, recordPath(deviceId), { ...existing, label }, key);
}

/** Delete a device's registry entry (used by revocation; no key needed to delete the file). */
export async function removeDevice(fs: FileSystem, deviceId: string): Promise<void> {
  await fs.remove(recordPath(deviceId));
}
