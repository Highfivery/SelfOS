import type { SelfosBridge } from '@shared/channels';
import type { BootState } from '@shared/schemas';
import { DEFAULT_ROLES } from '@shared/capabilities';

const READY: BootState = { phase: 'ready', vaultPath: '/vault', hasSettings: true };

/** Install a fully-stubbed `window.selfos` bridge for tests; pass overrides for the bits you care about. */
export function installMockBridge(overrides: Partial<SelfosBridge> = {}): SelfosBridge {
  const bridge: SelfosBridge = {
    getBootState: () => Promise.resolve(READY),
    refreshBootState: () => Promise.resolve(READY),
    selectVaultFolder: () => Promise.resolve(null),
    useVault: () => Promise.resolve(READY),
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    onVaultChanged: () => () => {},
    getAppVersion: () => Promise.resolve('0.0.0'),
    getSettings: () => Promise.resolve({ vault: {}, device: {} }),
    setSetting: () => Promise.resolve(),
    resetSetting: () => Promise.resolve(),
    secretSet: () => Promise.resolve(),
    secretHas: () => Promise.resolve(false),
    secretClear: () => Promise.resolve(),
    claudeTest: () => Promise.resolve({ ok: true, text: 'ok' }),
    householdStatus: () =>
      Promise.resolve({ hasMasterKey: true, hasOwner: true, activePersonId: 'owner-1' }),
    householdSetup: () => Promise.resolve({ recoveryPhrase: 'TEST-PHRASE', ownerId: 'owner-1' }),
    getActivePerson: () => Promise.resolve(null),
    peopleList: () => Promise.resolve([]),
    peopleSave: (input) =>
      Promise.resolve({
        id: input.id ?? 'new-id',
        schemaVersion: 1,
        displayName: input.displayName,
        isSubject: input.isSubject,
        tags: input.tags,
        createdAt: 'now',
        updatedAt: 'now',
      }),
    peopleDelete: () => Promise.resolve(),
    relationshipsList: () => Promise.resolve([]),
    relationshipsSave: (input) =>
      Promise.resolve({
        id: input.id ?? 'new-rel',
        schemaVersion: 1,
        fromPersonId: input.fromPersonId,
        toPersonId: input.toPersonId,
        type: input.type,
        createdAt: 'now',
        updatedAt: 'now',
      }),
    relationshipsDelete: () => Promise.resolve(),
    accessGet: () =>
      Promise.resolve({
        roles: DEFAULT_ROLES,
        accounts: [{ personId: 'owner-1', roleId: 'owner', hasPin: false }],
      }),
    accessSaveRole: () => Promise.resolve({ roles: DEFAULT_ROLES, accounts: [] }),
    accessSetAccount: () => Promise.resolve({ roles: DEFAULT_ROLES, accounts: [] }),
    accessRemoveAccount: () => Promise.resolve({ roles: DEFAULT_ROLES, accounts: [] }),
    sessionSetActive: (input) =>
      Promise.resolve({
        ok: true,
        person: {
          id: input.personId,
          schemaVersion: 1,
          displayName: 'Someone',
          isSubject: true,
          tags: [],
          createdAt: 'now',
          updatedAt: 'now',
        },
      }),
    ...overrides,
  };
  window.selfos = bridge;
  return bridge;
}

export function clearMockBridge(): void {
  delete window.selfos;
}
