import type { SelfosBridge } from '@shared/channels';
import type { BootState, Person } from '@shared/schemas';
import { DEFAULT_ROLES } from '@shared/capabilities';

/**
 * TEMPORARY iOS preview bridge (07-mobile-platform slice iii-a).
 *
 * The renderer talks only to `window.selfos` (a `SelfosBridge`); on Electron the preload sets it. This
 * no-op stub lets the SelfOS UI render inside the iOS WKWebView so we can confirm the Capacitor → Xcode →
 * device toolchain works, BEFORE the real in-webview host (`@selfos/core` wired to the iCloud-Drive
 * filesystem / iOS-Keychain / Claude plugins) is built in slices iii-b/c/d. It shows the full shell with
 * empty data; every action is a no-op. It is replaced by the real iOS host and will be deleted then.
 */
const READY: BootState = { phase: 'ready', vaultPath: '/iCloud/SelfOS', hasSettings: true };

const OWNER: Person = {
  id: 'owner-1',
  schemaVersion: 1,
  displayName: 'You',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

export function installStubBridge(): void {
  const bridge: SelfosBridge = {
    getBootState: () => Promise.resolve(READY),
    refreshBootState: () => Promise.resolve(READY),
    selectVaultFolder: () => Promise.resolve(null),
    useVault: () => Promise.resolve(READY),
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    onVaultChanged: () => () => {},
    getAppVersion: () => Promise.resolve('0.0.0-ios-preview'),
    getSettings: () => Promise.resolve({ vault: {}, device: {} }),
    setSetting: () => Promise.resolve(),
    resetSetting: () => Promise.resolve(),
    secretSet: () => Promise.resolve(),
    secretHas: () => Promise.resolve(false),
    secretClear: () => Promise.resolve(),
    claudeTest: () =>
      Promise.resolve({ ok: false, code: 'NO_KEY', message: 'Add your Claude API key.' }),
    householdStatus: () =>
      Promise.resolve({
        vaultInitialized: true,
        hasMasterKey: true,
        hasOwner: true,
        activePersonId: 'owner-1',
        pendingJoinPersonId: null,
      }),
    householdSetup: () => Promise.resolve({ recoveryPhrase: 'PREVIEW-ONLY', ownerId: 'owner-1' }),
    unlockWithRecoveryPhrase: () => Promise.resolve({ ok: true }),
    getActivePerson: () => Promise.resolve(OWNER),
    peopleList: () => Promise.resolve([OWNER]),
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
    invitesCreate: () =>
      Promise.resolve({ code: 'amber-tide-fox-quill-river-stone', expiresAt: 'preview' }),
    invitesList: () => Promise.resolve([]),
    invitesCancel: () => Promise.resolve(),
    invitesRedeem: () => Promise.resolve({ ok: false }),
    invitesCompleteJoin: () => Promise.resolve({ ok: true }),
    sessionSetActive: () => Promise.resolve({ ok: true, person: OWNER }),
    superadminUnlock: () => Promise.resolve(false),
    superadminLock: () => Promise.resolve(),
    usageSummary: () =>
      Promise.resolve({
        totalCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        cacheSavingsUsd: 0,
        sessionCount: 0,
        avgCostPerSession: 0,
        avgCostPerType: 0,
        byType: {},
        byModel: {},
        byPerson: {},
      }),
    budgetGet: () => Promise.resolve({ app: null, person: null }),
    budgetGetPerson: () => Promise.resolve({ limitUsd: 10, period: 'week', warnRatio: 0.8 }),
    budgetSetApp: () => Promise.resolve(),
    budgetSetPerson: () => Promise.resolve(),
    budgetStatus: () =>
      Promise.resolve({
        person: { state: 'none', spentUsd: 0, limitUsd: null, period: null },
        app: { state: 'none', spentUsd: 0, limitUsd: null, period: null },
      }),
    chatStream: () =>
      Promise.resolve({
        ok: false,
        reason: 'ERROR',
        message: 'AI is not wired up in the preview yet.',
      }),
    onChatChunk: () => () => {},
    conversationsList: () => Promise.resolve([]),
    conversationsGet: () => Promise.resolve(null),
    conversationsRename: () => Promise.resolve(),
    conversationsDelete: () => Promise.resolve(),
    getSidebarCollapsed: () => Promise.resolve(false),
    setSidebarCollapsed: () => Promise.resolve(),
  };
  window.selfos = bridge;
}
