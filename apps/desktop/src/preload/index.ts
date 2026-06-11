import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type SelfosBridge } from '../shared/channels';

/**
 * The only surface the renderer can reach. Exposed on `window.selfos` via contextBridge — no Node,
 * no `fs`, no secrets (00-architecture §3).
 */
const bridge: SelfosBridge = {
  getBootState: () => ipcRenderer.invoke(IpcChannels.getBootState),
  refreshBootState: () => ipcRenderer.invoke(IpcChannels.refreshBootState),
  selectVaultFolder: () => ipcRenderer.invoke(IpcChannels.selectVaultFolder),
  useVault: (path) => ipcRenderer.invoke(IpcChannels.useVault, path),
  getConflicts: () => ipcRenderer.invoke(IpcChannels.getConflicts),
  revealVault: () => ipcRenderer.invoke(IpcChannels.revealVault),
  onVaultChanged: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannels.vaultChanged, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.vaultChanged, handler);
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
  superadminUnlock: (input) => ipcRenderer.invoke(IpcChannels.superadminUnlock, input),
  superadminLock: () => ipcRenderer.invoke(IpcChannels.superadminLock),
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
  questionnairesList: () => ipcRenderer.invoke(IpcChannels.questionnairesList),
  questionnairesGet: (id) => ipcRenderer.invoke(IpcChannels.questionnairesGet, id),
  questionnairesSave: (input) => ipcRenderer.invoke(IpcChannels.questionnairesSave, input),
  questionnairesDelete: (id) => ipcRenderer.invoke(IpcChannels.questionnairesDelete, id),
  questionnairesValidate: (input) => ipcRenderer.invoke(IpcChannels.questionnairesValidate, input),
  questionnairesListTypes: () => ipcRenderer.invoke(IpcChannels.questionnairesListTypes),
  questionnairesAddType: (name) => ipcRenderer.invoke(IpcChannels.questionnairesAddType, name),
  questionnairesStoreImage: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesStoreImage, input),
  questionnairesGetImage: (imagePath) =>
    ipcRenderer.invoke(IpcChannels.questionnairesGetImage, imagePath),
  questionnairesDeleteImage: (imagePath) =>
    ipcRenderer.invoke(IpcChannels.questionnairesDeleteImage, imagePath),
  assignmentsCreate: (input) => ipcRenderer.invoke(IpcChannels.assignmentsCreate, input),
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
  getSidebarCollapsed: () => ipcRenderer.invoke(IpcChannels.getSidebarCollapsed),
  setSidebarCollapsed: (collapsed) =>
    ipcRenderer.invoke(IpcChannels.setSidebarCollapsed, collapsed),
};

contextBridge.exposeInMainWorld('selfos', bridge);
