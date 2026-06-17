import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type AppPlatform, type SelfosBridge } from '../shared/channels';

// `process.platform` is available in the sandboxed preload (a subset of `process` is exposed). It
// drives the titlebar's per-platform window-control layout (02-app-shell §13); anything unexpected
// falls back to a safe no-controls state.
const PLATFORM: AppPlatform =
  process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux'
    ? process.platform
    : 'unknown';

/**
 * The only surface the renderer can reach. Exposed on `window.selfos` via contextBridge — no Node,
 * no `fs`, no secrets (00-architecture §3).
 */
const bridge: SelfosBridge = {
  getBootState: () => ipcRenderer.invoke(IpcChannels.getBootState),
  refreshBootState: () => ipcRenderer.invoke(IpcChannels.refreshBootState),
  selectVaultFolder: () => ipcRenderer.invoke(IpcChannels.selectVaultFolder),
  useVault: (path) => ipcRenderer.invoke(IpcChannels.useVault, path),
  unlinkVault: () => ipcRenderer.invoke(IpcChannels.unlinkVault),
  getConflicts: () => ipcRenderer.invoke(IpcChannels.getConflicts),
  revealVault: () => ipcRenderer.invoke(IpcChannels.revealVault),
  onVaultChanged: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannels.vaultChanged, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.vaultChanged, handler);
    };
  },
  platform: PLATFORM,
  onFullscreenChanged: (listener) => {
    const handler = (_event: unknown, fullscreen: boolean): void => listener(fullscreen);
    ipcRenderer.on(IpcChannels.fullscreenChanged, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.fullscreenChanged, handler);
    };
  },
  getAppVersion: () => ipcRenderer.invoke(IpcChannels.getAppVersion),
  getSettings: () => ipcRenderer.invoke(IpcChannels.getSettings),
  setSetting: (input) => ipcRenderer.invoke(IpcChannels.setSetting, input),
  resetSetting: (input) => ipcRenderer.invoke(IpcChannels.resetSetting, input),
  secretSet: (input) => ipcRenderer.invoke(IpcChannels.secretSet, input),
  secretHas: (input) => ipcRenderer.invoke(IpcChannels.secretHas, input),
  secretClear: (input) => ipcRenderer.invoke(IpcChannels.secretClear, input),
  claudeTest: () => ipcRenderer.invoke(IpcChannels.claudeTest),
  householdStatus: () => ipcRenderer.invoke(IpcChannels.householdStatus),
  householdSetup: (input) => ipcRenderer.invoke(IpcChannels.householdSetup, input),
  unlockWithRecoveryPhrase: (input) =>
    ipcRenderer.invoke(IpcChannels.unlockWithRecoveryPhrase, input),
  getActivePerson: () => ipcRenderer.invoke(IpcChannels.getActivePerson),
  peopleList: () => ipcRenderer.invoke(IpcChannels.peopleList),
  peopleSave: (input) => ipcRenderer.invoke(IpcChannels.peopleSave, input),
  peopleDelete: (id) => ipcRenderer.invoke(IpcChannels.peopleDelete, id),
  relationshipsList: () => ipcRenderer.invoke(IpcChannels.relationshipsList),
  relationshipsSave: (input) => ipcRenderer.invoke(IpcChannels.relationshipsSave, input),
  relationshipsDelete: (id) => ipcRenderer.invoke(IpcChannels.relationshipsDelete, id),
  accessGet: () => ipcRenderer.invoke(IpcChannels.accessGet),
  accessSaveRole: (role) => ipcRenderer.invoke(IpcChannels.accessSaveRole, role),
  accessSetAccount: (input) => ipcRenderer.invoke(IpcChannels.accessSetAccount, input),
  accessRemoveAccount: (personId) => ipcRenderer.invoke(IpcChannels.accessRemoveAccount, personId),
  invitesCreate: (input) => ipcRenderer.invoke(IpcChannels.invitesCreate, input),
  invitesList: (input) => ipcRenderer.invoke(IpcChannels.invitesList, input),
  invitesCancel: (input) => ipcRenderer.invoke(IpcChannels.invitesCancel, input),
  invitesRedeem: (input) => ipcRenderer.invoke(IpcChannels.invitesRedeem, input),
  invitesCompleteJoin: (input) => ipcRenderer.invoke(IpcChannels.invitesCompleteJoin, input),
  sessionSetActive: (input) => ipcRenderer.invoke(IpcChannels.sessionSetActive, input),
  usageSummary: (input) => ipcRenderer.invoke(IpcChannels.usageSummary, input),
  budgetGet: () => ipcRenderer.invoke(IpcChannels.budgetGet),
  budgetGetPerson: (personId) => ipcRenderer.invoke(IpcChannels.budgetGetPerson, personId),
  budgetSetApp: (budget) => ipcRenderer.invoke(IpcChannels.budgetSetApp, budget),
  budgetSetPerson: (input) => ipcRenderer.invoke(IpcChannels.budgetSetPerson, input),
  budgetStatus: () => ipcRenderer.invoke(IpcChannels.budgetStatus),
  chatStream: (input) => ipcRenderer.invoke(IpcChannels.chatStream, input),
  onChatChunk: (listener) => {
    const handler = (_event: unknown, delta: string): void => listener(delta);
    ipcRenderer.on(IpcChannels.chatChunk, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.chatChunk, handler);
    };
  },
  conversationsList: () => ipcRenderer.invoke(IpcChannels.conversationsList),
  conversationsGet: (id) => ipcRenderer.invoke(IpcChannels.conversationsGet, id),
  conversationsRename: (input) => ipcRenderer.invoke(IpcChannels.conversationsRename, input),
  conversationsDelete: (id) => ipcRenderer.invoke(IpcChannels.conversationsDelete, id),
  sessionsSetStatus: (input) => ipcRenderer.invoke(IpcChannels.sessionsSetStatus, input),
  sessionsEndAndSummarize: (input) =>
    ipcRenderer.invoke(IpcChannels.sessionsEndAndSummarize, input),
  sessionsStartGuided: (input) => ipcRenderer.invoke(IpcChannels.sessionsStartGuided, input),
  guidedGetState: () => ipcRenderer.invoke(IpcChannels.guidedGetState),
  guidedSuggest: () => ipcRenderer.invoke(IpcChannels.guidedSuggest),
  guidedAcknowledgeAdult: () => ipcRenderer.invoke(IpcChannels.guidedAcknowledgeAdult),
  usageSessionCosts: () => ipcRenderer.invoke(IpcChannels.usageSessionCosts),
  questionnairesList: () => ipcRenderer.invoke(IpcChannels.questionnairesList),
  questionnairesSendStates: () => ipcRenderer.invoke(IpcChannels.questionnairesSendStates),
  questionnairesGet: (id) => ipcRenderer.invoke(IpcChannels.questionnairesGet, id),
  questionnairesSave: (input) => ipcRenderer.invoke(IpcChannels.questionnairesSave, input),
  questionnairesDelete: (id) => ipcRenderer.invoke(IpcChannels.questionnairesDelete, id),
  questionnairesValidate: (input) => ipcRenderer.invoke(IpcChannels.questionnairesValidate, input),
  questionnairesListTypes: () => ipcRenderer.invoke(IpcChannels.questionnairesListTypes),
  questionnairesAddType: (name) => ipcRenderer.invoke(IpcChannels.questionnairesAddType, name),
  questionnairesIntimacyTopics: () => ipcRenderer.invoke(IpcChannels.questionnairesIntimacyTopics),
  questionnairesAddIntimacyTopic: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesAddIntimacyTopic, input),
  questionnairesRemoveIntimacyTopic: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesRemoveIntimacyTopic, input),
  questionnairesStoreImage: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesStoreImage, input),
  questionnairesGetImage: (imagePath) =>
    ipcRenderer.invoke(IpcChannels.questionnairesGetImage, imagePath),
  questionnairesDeleteImage: (imagePath) =>
    ipcRenderer.invoke(IpcChannels.questionnairesDeleteImage, imagePath),
  questionnairesGenerate: (input) => ipcRenderer.invoke(IpcChannels.questionnairesGenerate, input),
  questionnairesImproveQuestion: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesImproveQuestion, input),
  gapfinderSuggest: (input) => ipcRenderer.invoke(IpcChannels.gapfinderSuggest, input),
  insightsList: () => ipcRenderer.invoke(IpcChannels.insightsList),
  insightsAnalyze: (input) => ipcRenderer.invoke(IpcChannels.insightsAnalyze, input),
  insightsApprove: (input) => ipcRenderer.invoke(IpcChannels.insightsApprove, input),
  insightsUpdate: (input) => ipcRenderer.invoke(IpcChannels.insightsUpdate, input),
  insightsDelete: (input) => ipcRenderer.invoke(IpcChannels.insightsDelete, input),
  insightsFlag: (input) => ipcRenderer.invoke(IpcChannels.insightsFlag, input),
  memoryRefresh: () => ipcRenderer.invoke(IpcChannels.memoryRefresh),
  assignmentsCreate: (input) => ipcRenderer.invoke(IpcChannels.assignmentsCreate, input),
  assignmentsInbox: () => ipcRenderer.invoke(IpcChannels.assignmentsInbox),
  assignmentsGet: (assignmentId) => ipcRenderer.invoke(IpcChannels.assignmentsGet, assignmentId),
  assignmentsOpen: (assignmentId) => ipcRenderer.invoke(IpcChannels.assignmentsOpen, assignmentId),
  assignmentsSaveProgress: (input) =>
    ipcRenderer.invoke(IpcChannels.assignmentsSaveProgress, input),
  assignmentsSubmit: (input) => ipcRenderer.invoke(IpcChannels.assignmentsSubmit, input),
  assignmentsDecline: (input) => ipcRenderer.invoke(IpcChannels.assignmentsDecline, input),
  assignmentsResults: (questionnaireId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsResults, questionnaireId),
  assignmentsTrends: (questionnaireId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsTrends, questionnaireId),
  assignmentsDelete: (assignmentId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsDelete, assignmentId),
  assignmentsCreateCompatibility: (input) =>
    ipcRenderer.invoke(IpcChannels.assignmentsCreateCompatibility, input),
  assignmentsCompatibility: (questionnaireId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsCompatibility, questionnaireId),
  assignmentsAlign: (compatibilityGroupId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsAlign, compatibilityGroupId),
  assignmentsPublishCompatResult: (compatibilityGroupId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsPublishCompatResult, compatibilityGroupId),
  assignmentsDistillContextOnly: (compatibilityGroupId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsDistillContextOnly, compatibilityGroupId),
  assignmentsRevealRaw: (assignmentId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsRevealRaw, assignmentId),
  assignmentsCreateRelayLink: (input) =>
    ipcRenderer.invoke(IpcChannels.assignmentsCreateRelayLink, input),
  assignmentsDrain: () => ipcRenderer.invoke(IpcChannels.assignmentsDrain),
  assignmentsRevoke: (assignmentId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsRevoke, assignmentId),
  relayStatus: () => ipcRenderer.invoke(IpcChannels.relayStatus),
  relayConnect: (input) => ipcRenderer.invoke(IpcChannels.relayConnect, input),
  relayUpdate: () => ipcRenderer.invoke(IpcChannels.relayUpdate),
  relayTeardown: () => ipcRenderer.invoke(IpcChannels.relayTeardown),
  dreamsList: () => ipcRenderer.invoke(IpcChannels.dreamsList),
  dreamGet: (id) => ipcRenderer.invoke(IpcChannels.dreamGet, id),
  dreamSave: (input) => ipcRenderer.invoke(IpcChannels.dreamSave, input),
  dreamDelete: (id) => ipcRenderer.invoke(IpcChannels.dreamDelete, id),
  dreamAnalyzeTurn: (input) => ipcRenderer.invoke(IpcChannels.dreamAnalyzeTurn, input),
  onDreamChunk: (listener) => {
    const handler = (_event: unknown, delta: string): void => listener(delta);
    ipcRenderer.on(IpcChannels.dreamChunk, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.dreamChunk, handler);
    };
  },
  dreamGetAnalysis: (dreamId) => ipcRenderer.invoke(IpcChannels.dreamGetAnalysis, dreamId),
  dreamGetConversation: (dreamId) => ipcRenderer.invoke(IpcChannels.dreamGetConversation, dreamId),
  dreamSynthesize: (input) => ipcRenderer.invoke(IpcChannels.dreamSynthesize, input),
  dreamUpdateAnalysis: (input) => ipcRenderer.invoke(IpcChannels.dreamUpdateAnalysis, input),
  dreamApprove: (input) => ipcRenderer.invoke(IpcChannels.dreamApprove, input),
  dreamRemoveFromContext: (input) => ipcRenderer.invoke(IpcChannels.dreamRemoveFromContext, input),
  dreamPatternStats: (input) => ipcRenderer.invoke(IpcChannels.dreamPatternStats, input),
  dreamGetPatternSummary: () => ipcRenderer.invoke(IpcChannels.dreamGetPatternSummary),
  dreamPatternNarrative: () => ipcRenderer.invoke(IpcChannels.dreamPatternNarrative),
  dreamApprovePatternNarrative: () => ipcRenderer.invoke(IpcChannels.dreamApprovePatternNarrative),
  dreamRemovePatternNarrative: () => ipcRenderer.invoke(IpcChannels.dreamRemovePatternNarrative),
  dreamShareTargets: () => ipcRenderer.invoke(IpcChannels.dreamShareTargets),
  dreamGetInsight: (dreamId) => ipcRenderer.invoke(IpcChannels.dreamGetInsight, dreamId),
  dreamSetFactShare: (input) => ipcRenderer.invoke(IpcChannels.dreamSetFactShare, input),
  dreamGenerateImage: (input) => ipcRenderer.invoke(IpcChannels.dreamGenerateImage, input),
  dreamGetImage: (input) => ipcRenderer.invoke(IpcChannels.dreamGetImage, input),
  dreamDeleteImage: (input) => ipcRenderer.invoke(IpcChannels.dreamDeleteImage, input),
  dreamExportImage: (input) => ipcRenderer.invoke(IpcChannels.dreamExportImage, input),
  dreamSetImageShare: (input) => ipcRenderer.invoke(IpcChannels.dreamSetImageShare, input),
  dreamGetSharedImage: (input) => ipcRenderer.invoke(IpcChannels.dreamGetSharedImage, input),
  dreamListSharedImages: () => ipcRenderer.invoke(IpcChannels.dreamListSharedImages),
  intakeGetState: () => ipcRenderer.invoke(IpcChannels.intakeGetState),
  intakeRunTurn: (input) => ipcRenderer.invoke(IpcChannels.intakeRunTurn, input),
  onIntakeChunk: (listener) => {
    const handler = (_event: unknown, delta: string): void => listener(delta);
    ipcRenderer.on(IpcChannels.intakeChunk, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.intakeChunk, handler);
    };
  },
  intakeSkipSection: (input) => ipcRenderer.invoke(IpcChannels.intakeSkipSection, input),
  intakeSubmitForm: (input) => ipcRenderer.invoke(IpcChannels.intakeSubmitForm, input),
  intakeAcknowledgeAdult: () => ipcRenderer.invoke(IpcChannels.intakeAcknowledgeAdult),
  intakeSynthesize: (input) => ipcRenderer.invoke(IpcChannels.intakeSynthesize, input),
  profileSuggestions: () => ipcRenderer.invoke(IpcChannels.profileSuggestions),
  profileAcceptSuggestion: (id) => ipcRenderer.invoke(IpcChannels.profileAcceptSuggestion, id),
  profileDismissSuggestion: (id) => ipcRenderer.invoke(IpcChannels.profileDismissSuggestion, id),
  getSidebarCollapsed: () => ipcRenderer.invoke(IpcChannels.getSidebarCollapsed),
  setSidebarCollapsed: (collapsed) =>
    ipcRenderer.invoke(IpcChannels.setSidebarCollapsed, collapsed),
};

contextBridge.exposeInMainWorld('selfos', bridge);
