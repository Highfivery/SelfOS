import { create } from 'zustand';
import type { AccessView, HouseholdStatus, Person, SetActiveResult } from '@shared/channels';
import { OWNER_ROLE_ID, roleAllows, type CapabilityKey } from '@shared/capabilities';

interface SessionState {
  status: HouseholdStatus | null;
  activePerson: Person | null;
  access: AccessView | null;
  loaded: boolean;
  /** Whether the app is locked to the full-screen person picker (logout). In-memory only. */
  locked: boolean;
  /** Fetch household status, the active person, and the access view. */
  load: () => Promise<void>;
  /** Run first-run setup; resolves to the recovery phrase to show once. */
  setup: (input: { ownerName: string; pin: string }) => Promise<string>;
  /** Join/recover this device with the recovery phrase; reloads the gate on success. */
  unlock: (phrase: string) => Promise<boolean>;
  /** Redeem a member invite code; resolves to who it's for (or null if it didn't match). */
  redeemInvite: (code: string) => Promise<{ ok: boolean; displayName?: string }>;
  /** Finish joining after a redeem: set the member's own PIN and sign in; reloads the gate. */
  completeJoin: (pin: string) => Promise<boolean>;
  /** Whether the active person's role grants a capability (the Owner is the full-access role). */
  can: (capability: CapabilityKey) => boolean;
  /** Whether the active person is the household Owner (the full-access role). */
  isOwner: () => boolean;
  /** Switch the active person (the Owner needs no PIN; others verify theirs); reloads on success. */
  switchTo: (personId: string, pin?: string) => Promise<SetActiveResult>;
  /** Log out: lock to the full-screen person picker. */
  lock: () => void;
  /** Drop all session state back to its initial in-memory values (e.g. after unlinking the vault). */
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: null,
  activePerson: null,
  access: null,
  loaded: false,
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
  redeemInvite: async (code) => {
    return (await window.selfos?.invitesRedeem({ code })) ?? { ok: false };
  },
  completeJoin: async (pin) => {
    const result = await window.selfos?.invitesCompleteJoin({ pin });
    if (result?.ok) await get().load(); // re-evaluate the gate — member is now active with the key
    return result?.ok ?? false;
  },
  can: (capability) => {
    const { activePerson, access } = get();
    if (!activePerson || !access) return false;
    const account = access.accounts.find((candidate) => candidate.personId === activePerson.id);
    const role = access.roles.find((candidate) => candidate.id === account?.roleId);
    return roleAllows(role, capability);
  },
  isOwner: () => {
    const { activePerson, access } = get();
    if (!activePerson || !access) return false;
    const account = access.accounts.find((candidate) => candidate.personId === activePerson.id);
    return account?.roleId === OWNER_ROLE_ID;
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
  lock: () => set({ locked: true }),
  reset: () =>
    set({
      status: null,
      activePerson: null,
      access: null,
      loaded: false,
      locked: false,
    }),
}));
