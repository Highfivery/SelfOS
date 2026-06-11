import { create } from 'zustand';
import type { AccessView, HouseholdStatus, Person, SetActiveResult } from '@shared/channels';
import { roleAllows, type CapabilityKey } from '@shared/capabilities';

interface SessionState {
  status: HouseholdStatus | null;
  activePerson: Person | null;
  access: AccessView | null;
  loaded: boolean;
  /** Concealed super-admin "inspect everything" mode (04-people-roles §8). In-memory only. */
  superAdmin: boolean;
  /** Whether the (hidden) super-admin unlock prompt is open. */
  unlockPromptOpen: boolean;
  /** Whether the app is locked to the full-screen person picker (logout). In-memory only. */
  locked: boolean;
  /** Fetch household status, the active person, and the access view. */
  load: () => Promise<void>;
  /** Run first-run setup; resolves to the recovery phrase to show once. */
  setup: (input: { ownerName: string; passphrase: string }) => Promise<string>;
  /** Join/recover this device with the recovery phrase; reloads the gate on success. */
  unlock: (phrase: string) => Promise<boolean>;
  /** Whether the active person's role grants a capability (super-admin bypasses all). */
  can: (capability: CapabilityKey) => boolean;
  /** Switch the active person (verifying their PIN); reloads on success. */
  switchTo: (personId: string, pin?: string) => Promise<SetActiveResult>;
  openUnlockPrompt: () => void;
  closeUnlockPrompt: () => void;
  /** Verify the super-admin passphrase; on success, enter inspect-all mode. */
  unlockSuperAdmin: (passphrase: string) => Promise<boolean>;
  lockSuperAdmin: () => void;
  /** Log out: lock to the full-screen person picker and drop any super-admin elevation. */
  lock: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: null,
  activePerson: null,
  access: null,
  loaded: false,
  superAdmin: false,
  unlockPromptOpen: false,
  locked: false,
  load: async () => {
    const status = (await window.selfos?.householdStatus()) ?? null;
    const activePerson = (await window.selfos?.getActivePerson()) ?? null;
    const access = (await window.selfos?.accessGet()) ?? null;
    set({ status, activePerson, access, loaded: true });
  },
  setup: async (input) => {
    const result = await window.selfos?.householdSetup(input);
    return result?.recoveryPhrase ?? '';
  },
  unlock: async (phrase) => {
    const result = await window.selfos?.unlockWithRecoveryPhrase({ phrase });
    if (result?.ok) await get().load(); // re-evaluate the gate — this device now holds the key
    return result?.ok ?? false;
  },
  can: (capability) => {
    const { activePerson, access, superAdmin } = get();
    if (superAdmin) return true;
    if (!activePerson || !access) return false;
    const account = access.accounts.find((candidate) => candidate.personId === activePerson.id);
    const role = access.roles.find((candidate) => candidate.id === account?.roleId);
    return roleAllows(role, capability);
  },
  switchTo: async (personId, pin) => {
    const result =
      (await window.selfos?.sessionSetActive({ personId, ...(pin ? { pin } : {}) })) ?? null;
    if (result?.ok) {
      await get().load();
      set({ locked: false });
    }
    return result ?? { ok: false, reason: 'NO_ACCOUNT' };
  },
  openUnlockPrompt: () => set({ unlockPromptOpen: true }),
  closeUnlockPrompt: () => set({ unlockPromptOpen: false }),
  unlockSuperAdmin: async (passphrase) => {
    const ok = (await window.selfos?.superadminUnlock({ passphrase })) ?? false;
    if (ok) set({ superAdmin: true, unlockPromptOpen: false });
    return ok;
  },
  lockSuperAdmin: () => {
    void window.selfos?.superadminLock();
    set({ superAdmin: false });
  },
  lock: () => {
    if (get().superAdmin) void window.selfos?.superadminLock();
    set({ locked: true, superAdmin: false });
  },
}));
