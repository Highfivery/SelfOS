import { readDeviceState, updateDeviceState } from '../state/deviceStore';

/** The active person on this device (04-people-roles §3.1). Stored device-local, never synced. */
export async function getActivePersonId(userDataDir: string): Promise<string | null> {
  return (await readDeviceState(userDataDir)).activePersonId ?? null;
}

export async function setActivePersonId(
  userDataDir: string,
  personId: string | null,
): Promise<void> {
  await updateDeviceState(userDataDir, { activePersonId: personId });
}
