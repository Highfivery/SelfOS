import type { SelfosBridge } from '@shared/channels';
import type { BootState } from '@shared/schemas';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { useSessionStore } from '../stores/sessionStore';

const READY: BootState = { phase: 'ready', vaultPath: '/vault', hasSettings: true };
const ONBOARDING: BootState = { phase: 'onboarding', vaultPath: null, hasSettings: false };

/** Install a fully-stubbed `window.selfos` bridge for tests; pass overrides for the bits you care about. */
export function installMockBridge(overrides: Partial<SelfosBridge> = {}): SelfosBridge {
  const bridge: SelfosBridge = {
    getBootState: () => Promise.resolve(READY),
    refreshBootState: () => Promise.resolve(READY),
    selectVaultFolder: () => Promise.resolve(null),
    useVault: () => Promise.resolve(READY),
    unlinkVault: () => Promise.resolve(ONBOARDING),
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    onVaultChanged: () => () => {},
    platform: 'web',
    onFullscreenChanged: () => () => {},
    getAppVersion: () => Promise.resolve('0.0.0'),
    getSettings: () => Promise.resolve({ vault: {}, device: {} }),
    setSetting: () => Promise.resolve(),
    resetSetting: () => Promise.resolve(),
    secretSet: () => Promise.resolve(),
    secretHas: () => Promise.resolve(false),
    secretClear: () => Promise.resolve(),
    claudeTest: () => Promise.resolve({ ok: true, text: 'ok' }),
    aiKeyStatus: () =>
      Promise.resolve({
        hasSharedKey: false,
        hasDeviceOverride: false,
        resolvedReady: false,
        source: 'none' as const,
      }),
    aiSetSharedKey: () => Promise.resolve(),
    aiShareDeviceKey: () => Promise.resolve(),
    aiClearSharedKey: () => Promise.resolve(),
    devicesList: () => Promise.resolve([]),
    devicesRename: () => Promise.resolve(),
    householdStatus: () =>
      Promise.resolve({
        vaultInitialized: true,
        hasMasterKey: true,
        hasOwner: true,
        activePersonId: 'owner-1',
        pendingJoinPersonId: null,
      }),
    householdSetup: () => Promise.resolve({ recoveryPhrase: 'TEST-PHRASE', ownerId: 'owner-1' }),
    unlockWithRecoveryPhrase: () => Promise.resolve({ ok: true }),
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
    invitesCreate: () =>
      Promise.resolve({ code: 'amber-tide-fox-quill-river-stone', expiresAt: '' }),
    invitesList: () => Promise.resolve([]),
    invitesCancel: () => Promise.resolve(),
    invitesRedeem: () => Promise.resolve({ ok: true, displayName: 'Wife' }),
    invitesCompleteJoin: () => Promise.resolve({ ok: true }),
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
    budgetGetPerson: () =>
      Promise.resolve({ limitUsd: 10, period: 'week' as const, warnRatio: 0.8 }),
    budgetSetApp: () => Promise.resolve(),
    budgetSetPerson: () => Promise.resolve(),
    budgetStatus: () =>
      Promise.resolve({
        person: { state: 'none', budgetRatio: 0, spentUsd: 0, limitUsd: null, period: null },
        app: { state: 'none', budgetRatio: 0, spentUsd: 0, limitUsd: null, period: null },
      }),
    chatStream: (input) =>
      Promise.resolve({
        ok: true,
        conversation: {
          id: input.conversationId,
          schemaVersion: 1,
          personId: 'owner-1',
          title: input.userText,
          createdAt: 'now',
          updatedAt: 'now',
          messages: [
            { role: 'user', content: input.userText, ts: 'now' },
            { role: 'assistant', content: 'I hear you.', ts: 'now' },
          ],
        },
        usage: {
          id: 'u',
          schemaVersion: 1,
          type: 'chat',
          personId: 'owner-1',
          model: 'claude-sonnet-4-6',
          at: 'now',
          inputTokens: 100,
          outputTokens: 10,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          costUsd: 0.001,
        },
      }),
    onChatChunk: () => () => {},
    conversationsList: () => Promise.resolve([]),
    conversationsGet: () => Promise.resolve(null),
    conversationsRename: () => Promise.resolve(),
    conversationsDelete: () => Promise.resolve(),
    sessionsSetStatus: () => Promise.resolve(null),
    sessionsEndAndSummarize: () =>
      Promise.resolve({ ok: false, reason: 'ERROR', message: 'not configured' }),
    sessionsStartGuided: () => Promise.resolve(null),
    guidedGetState: () => Promise.resolve({ cache: null, adultAcknowledged: false }),
    guidedSuggest: () =>
      Promise.resolve({ ok: false, reason: 'DENIED', message: 'not configured' }),
    guidedAcknowledgeAdult: () => Promise.resolve({ cache: null, adultAcknowledged: true }),
    usageSessionCosts: () => Promise.resolve({}),
    questionnairesList: () => Promise.resolve([]),
    questionnairesSendStates: () => Promise.resolve({}),
    questionnairesShareLink: () => Promise.resolve(null),
    questionnairesGet: () => Promise.resolve(null),
    questionnairesSave: (input) =>
      Promise.resolve({
        id: input.id ?? 'new-q',
        schemaVersion: 1,
        version: 1,
        title: input.title,
        type: input.type,
        sensitivity: input.sensitivity,
        questions: input.questions,
        createdAt: 'now',
        updatedAt: 'now',
      }),
    questionnairesDelete: () => Promise.resolve(),
    questionnairesValidate: () => Promise.resolve([]),
    questionnairesListTypes: () => Promise.resolve([]),
    questionnairesAddType: (name) => Promise.resolve([name]),
    questionnairesIntimacyTopics: () =>
      Promise.resolve({
        builtIn: { activities: [], fantasies: [] },
        custom: { activities: [], fantasies: [] },
      }),
    questionnairesAddIntimacyTopic: () =>
      Promise.resolve({
        builtIn: { activities: [], fantasies: [] },
        custom: { activities: [], fantasies: [] },
      }),
    questionnairesRemoveIntimacyTopic: () =>
      Promise.resolve({
        builtIn: { activities: [], fantasies: [] },
        custom: { activities: [], fantasies: [] },
      }),
    questionnairesStoreImage: (input) =>
      Promise.resolve({ imagePath: 'questionnaires/media/mock.enc', mime: input.mime }),
    questionnairesGetImage: () => Promise.resolve(null),
    questionnairesDeleteImage: () => Promise.resolve(),
    questionnairesGenerate: () => Promise.resolve({ ok: true, questions: [] }),
    questionnairesImproveQuestion: () => Promise.resolve({ ok: true, prompt: 'improved' }),
    gapfinderSuggest: () => Promise.resolve({ ok: true, suggestions: [] }),
    insightsList: () => Promise.resolve([]),
    insightsAnalyze: () => Promise.resolve({ ok: false, reason: 'NO_RESPONSE' }),
    insightsApprove: () => Promise.resolve(null),
    insightsUpdate: () => Promise.resolve(null),
    insightsDelete: () => Promise.resolve(),
    insightsFlag: () => Promise.resolve(null),
    memoryRefresh: () => Promise.resolve({ ok: true, reconciledCount: 0, mergedCount: 0 }),
    assignmentsCreate: (input) =>
      Promise.resolve({
        assignment: {
          id: 'new-a',
          schemaVersion: 1,
          questionnaireId: input.questionnaireId,
          senderPersonId: 'owner-1',
          recipient: { kind: 'person' as const, personId: 'recipient-1' },
          channel: 'inApp' as const,
          privacy: input.privacy ?? 'standard',
          senderVisibleToRecipient: input.senderVisibleToRecipient ?? true,
          status: 'sent' as const,
          createdAt: 'now',
          updatedAt: 'now',
        },
      }),
    assignmentsInbox: () => Promise.resolve([]),
    assignmentsGet: () => Promise.resolve(null),
    assignmentsOpen: () => Promise.resolve(),
    assignmentsSaveProgress: () => Promise.resolve(),
    assignmentsSubmit: () => Promise.resolve(),
    assignmentsDecline: () => Promise.resolve(),
    assignmentsResults: () => Promise.resolve([]),
    assignmentsTrends: () => Promise.resolve([]),
    assignmentsDelete: () => Promise.resolve(),
    assignmentsCreateCompatibility: () =>
      Promise.resolve({ ok: true, compatibilityGroupId: 'group-1' }),
    assignmentsCompatibility: () => Promise.resolve([]),
    assignmentsAlign: () =>
      Promise.resolve({ ok: false, reason: 'NOT_READY', message: 'Not ready.' }),
    assignmentsPublishCompatResult: () =>
      Promise.resolve({ ok: false, reason: 'NOT_READY', message: 'Not ready.' }),
    assignmentsDistillContextOnly: () =>
      Promise.resolve({ ok: false, reason: 'NOT_READY', message: 'Not ready.' }),
    assignmentsRevealRaw: () => Promise.resolve(null),
    assignmentsCreateRelayLink: () =>
      Promise.resolve({ assignmentId: 'a1', link: 'https://relay.test/q/t#k=k', pin: '000000' }),
    assignmentsDrain: () => Promise.resolve({ drained: 0, declined: 0 }),
    assignmentsRevoke: () => Promise.resolve(),
    assignmentsReshare: () => Promise.resolve(null),
    relayStatus: () => Promise.resolve({ configured: false, updateAvailable: false }),
    relayConnect: () => Promise.resolve({ configured: false, updateAvailable: false }),
    relayUpdate: () => Promise.resolve({ configured: false, updateAvailable: false }),
    relayTeardown: () => Promise.resolve({ configured: false, updateAvailable: false }),
    dreamsList: () => Promise.resolve([]),
    dreamGet: () => Promise.resolve(null),
    dreamSave: (input) =>
      Promise.resolve({
        id: input.id ?? 'new-dream',
        schemaVersion: 1,
        personId: 'owner-1',
        narrative: input.narrative,
        lucid: input.lucid,
        nightmare: input.nightmare,
        tags: input.tags,
        people: input.people,
        sensitivity: input.sensitivity,
        status: 'captured' as const,
        createdAt: 'now',
        updatedAt: 'now',
      }),
    dreamDelete: () => Promise.resolve(),
    dreamAnalyzeTurn: (input) =>
      Promise.resolve({
        ok: true,
        conversation: {
          id: input.dreamId,
          schemaVersion: 1,
          personId: 'owner-1',
          title: 'Dream',
          createdAt: 'now',
          updatedAt: 'now',
          messages: [
            { role: 'user', content: input.userText, ts: 'now' },
            { role: 'assistant', content: 'Tell me more about how it felt.', ts: 'now' },
          ],
        },
        usage: {
          id: 'u',
          schemaVersion: 1,
          type: 'dream.analyze',
          personId: 'owner-1',
          sessionId: input.dreamId,
          model: 'claude-sonnet-4-6',
          at: 'now',
          inputTokens: 100,
          outputTokens: 10,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          costUsd: 0.001,
        },
      }),
    onDreamChunk: () => () => {},
    dreamGetAnalysis: () => Promise.resolve(null),
    dreamGetConversation: () => Promise.resolve(null),
    dreamSynthesize: (input) =>
      Promise.resolve({
        ok: true,
        analysis: {
          id: 'analysis-1',
          schemaVersion: 1,
          dreamId: input.dreamId,
          personId: 'owner-1',
          summary: 'A dream of shifting rooms.',
          emotionalLandscape: 'Unsettled but curious.',
          wakingLifeConnections: 'Perhaps a sense of change at home.',
          notableImages: 'The rearranging house, as imaginative reflection.',
          reflectiveQuestions: ['What feels in flux right now?'],
          tags: { emotions: [], symbols: [], settings: [], themes: [], people: [] },
          edited: false,
          generatedAt: 'now',
          updatedAt: 'now',
        },
        usage: {
          id: 'u',
          schemaVersion: 1,
          type: 'dream.analyze',
          personId: 'owner-1',
          sessionId: input.dreamId,
          model: 'claude-sonnet-4-6',
          at: 'now',
          inputTokens: 200,
          outputTokens: 50,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          costUsd: 0.003,
        },
      }),
    dreamUpdateAnalysis: () => Promise.resolve(null),
    dreamApprove: () => Promise.resolve({ ok: true, insightId: 'insight-1' }),
    dreamRemoveFromContext: () => Promise.resolve(),
    dreamPatternStats: (input) =>
      Promise.resolve({
        window: input.window,
        dreamCount: 0,
        analyzedCount: 0,
        symbols: [],
        themes: [],
        people: [],
        emotions: [],
        lucidCount: 0,
        nightmareCount: 0,
        moodTrend: [],
        vividnessTrend: [],
        nightmareNudge: false,
      }),
    dreamGetPatternSummary: () => Promise.resolve(null),
    dreamPatternNarrative: () =>
      Promise.resolve({
        ok: true,
        summary: {
          schemaVersion: 1,
          personId: 'owner-1',
          narrative: 'Across your recent dreams, a thread of searching recurs.',
          windowFrom: '2026-06-01',
          windowTo: '2026-06-11',
          computedAt: 'now',
        },
        usage: {
          id: 'u',
          schemaVersion: 1,
          type: 'dream.patterns',
          personId: 'owner-1',
          model: 'claude-sonnet-4-6',
          at: 'now',
          inputTokens: 30,
          outputTokens: 20,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          costUsd: 0.001,
        },
      }),
    dreamApprovePatternNarrative: () => Promise.resolve({ ok: true, insightId: 'insight-2' }),
    dreamRemovePatternNarrative: () => Promise.resolve(),
    dreamShareTargets: () => Promise.resolve([]),
    dreamGetInsight: () => Promise.resolve(null),
    dreamSetFactShare: () => Promise.resolve({ ok: true }),
    dreamGenerateImage: () => Promise.resolve({ ok: true, mime: 'image/png' }),
    dreamGetImage: () => Promise.resolve(null),
    dreamDeleteImage: () => Promise.resolve(),
    dreamExportImage: () => Promise.resolve(null),
    dreamSetImageShare: () => Promise.resolve({ ok: true }),
    dreamGetSharedImage: () => Promise.resolve(null),
    dreamListSharedImages: () => Promise.resolve([]),
    intakeGetState: () =>
      Promise.resolve({
        session: {
          id: 'intake-1',
          schemaVersion: 1,
          personId: 'owner-1',
          status: 'inProgress',
          sections: [],
          startedAt: 'now',
          updatedAt: 'now',
        },
        sections: [],
        aiAvailable: false,
        adultAcknowledged: false,
      }),
    intakeRunTurn: (input) =>
      Promise.resolve({
        ok: true,
        session: {
          id: 'intake-1',
          schemaVersion: 1,
          personId: 'owner-1',
          status: 'inProgress',
          sections: [
            {
              id: input.sectionId,
              status: 'inProgress',
              restricted: false,
              messages: [
                { role: 'user', content: input.userText, ts: 'now' },
                { role: 'assistant', content: 'Thank you for sharing that.', ts: 'now' },
              ],
              answers: {},
            },
          ],
          startedAt: 'now',
          updatedAt: 'now',
        },
        usage: {
          id: 'u',
          schemaVersion: 1,
          type: 'intake.interview',
          personId: 'owner-1',
          model: 'claude-sonnet-4-6',
          at: 'now',
          inputTokens: 10,
          outputTokens: 10,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          costUsd: 0.001,
        },
      }),
    onIntakeChunk: () => () => {},
    intakeSkipSection: () =>
      Promise.resolve({
        session: {
          id: 'intake-1',
          schemaVersion: 1,
          personId: 'owner-1',
          status: 'inProgress',
          sections: [],
          startedAt: 'now',
          updatedAt: 'now',
        },
        sections: [],
        aiAvailable: false,
        adultAcknowledged: false,
      }),
    intakeSubmitForm: () =>
      Promise.resolve({
        session: {
          id: 'intake-1',
          schemaVersion: 1,
          personId: 'owner-1',
          status: 'inProgress',
          sections: [],
          startedAt: 'now',
          updatedAt: 'now',
        },
        sections: [],
        aiAvailable: false,
        adultAcknowledged: false,
      }),
    profileSuggestions: () => Promise.resolve([]),
    profileAcceptSuggestion: () => Promise.resolve([]),
    profileDismissSuggestion: () => Promise.resolve([]),
    intakeAcknowledgeAdult: () =>
      Promise.resolve({
        session: {
          id: 'intake-1',
          schemaVersion: 1,
          personId: 'owner-1',
          status: 'inProgress',
          sections: [],
          startedAt: 'now',
          updatedAt: 'now',
        },
        sections: [],
        aiAvailable: true,
        adultAcknowledged: true,
      }),
    intakeSynthesize: () =>
      Promise.resolve({
        ok: true,
        session: {
          id: 'intake-1',
          schemaVersion: 1,
          personId: 'owner-1',
          status: 'complete',
          sections: [],
          startedAt: 'now',
          updatedAt: 'now',
          portrait: 'Here is what I have come to understand about you.',
          insightId: 'intake-insight-1',
        },
        portrait: 'Here is what I have come to understand about you.',
        insightId: 'intake-insight-1',
      }),
    getSidebarCollapsed: () => Promise.resolve(false),
    setSidebarCollapsed: () => Promise.resolve(),
    ...overrides,
  };
  window.selfos = bridge;
  return bridge;
}

export function clearMockBridge(): void {
  delete window.selfos;
}

/**
 * Make the active person the Owner (the full-access role) for a test — the replacement for the removed
 * super-admin bypass (roles refactor 2026-06-15). Reuses the existing active person id when set.
 */
export function elevateToOwner(): void {
  const state = useSessionStore.getState();
  const personId = state.activePerson?.id ?? 'owner-1';
  useSessionStore.setState({
    activePerson: state.activePerson ?? {
      id: personId,
      schemaVersion: 1,
      displayName: 'Owner',
      isSubject: true,
      tags: [],
      createdAt: 'now',
      updatedAt: 'now',
    },
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId, roleId: 'owner', hasPin: false }],
    },
  });
}
