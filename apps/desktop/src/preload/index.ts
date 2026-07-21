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
  vaultSyncReadiness: () => ipcRenderer.invoke(IpcChannels.vaultSyncReadiness),
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
  openaiTest: () => ipcRenderer.invoke(IpcChannels.openaiTest),
  aiKeyStatus: (input) => ipcRenderer.invoke(IpcChannels.aiKeyStatus, input),
  aiSetSharedKey: (input) => ipcRenderer.invoke(IpcChannels.aiSetSharedKey, input),
  aiShareDeviceKey: (input) => ipcRenderer.invoke(IpcChannels.aiShareDeviceKey, input),
  aiClearSharedKey: (input) => ipcRenderer.invoke(IpcChannels.aiClearSharedKey, input),
  devicesList: () => ipcRenderer.invoke(IpcChannels.devicesList),
  devicesRename: (input) => ipcRenderer.invoke(IpcChannels.devicesRename, input),
  keysRotate: (input) => ipcRenderer.invoke(IpcChannels.keysRotate, input),
  keysRotateStatus: () => ipcRenderer.invoke(IpcChannels.keysRotateStatus),
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
  chatRetry: (conversationId) => ipcRenderer.invoke(IpcChannels.chatRetry, conversationId),
  conversationsRewind: (input) => ipcRenderer.invoke(IpcChannels.conversationsRewind, input),
  chatRegenerateFrom: (input) => ipcRenderer.invoke(IpcChannels.chatRegenerateFrom, input),
  onChatChunk: (listener) => {
    const handler = (_event: unknown, delta: string): void => listener(delta);
    ipcRenderer.on(IpcChannels.chatChunk, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.chatChunk, handler);
    };
  },
  conversationStoreAttachment: (input) =>
    ipcRenderer.invoke(IpcChannels.conversationStoreAttachment, input),
  conversationGetAttachment: (input) =>
    ipcRenderer.invoke(IpcChannels.conversationGetAttachment, input),
  conversationExportAttachment: (input) =>
    ipcRenderer.invoke(IpcChannels.conversationExportAttachment, input),
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
  testsList: () => ipcRenderer.invoke(IpcChannels.testsList),
  testsGet: (input) => ipcRenderer.invoke(IpcChannels.testsGet, input),
  testsTake: (input) => ipcRenderer.invoke(IpcChannels.testsTake, input),
  testsResults: (input) => ipcRenderer.invoke(IpcChannels.testsResults, input),
  testsNarrate: (input) => ipcRenderer.invoke(IpcChannels.testsNarrate, input),
  testsAcknowledgeAdult: () => ipcRenderer.invoke(IpcChannels.testsAcknowledgeAdult),
  testsDeleteResult: (input) => ipcRenderer.invoke(IpcChannels.testsDeleteResult, input),
  testsDeleteAll: (input) => ipcRenderer.invoke(IpcChannels.testsDeleteAll, input),
  usageSessionCosts: () => ipcRenderer.invoke(IpcChannels.usageSessionCosts),
  questionnairesList: () => ipcRenderer.invoke(IpcChannels.questionnairesList),
  questionnairesSendStates: () => ipcRenderer.invoke(IpcChannels.questionnairesSendStates),
  questionnairesSentOverview: () => ipcRenderer.invoke(IpcChannels.questionnairesSentOverview),
  questionnairesShareLink: (id, regenerate) =>
    ipcRenderer.invoke(IpcChannels.questionnairesShareLink, id, regenerate),
  questionnairesGet: (id) => ipcRenderer.invoke(IpcChannels.questionnairesGet, id),
  questionnairesSave: (input) => ipcRenderer.invoke(IpcChannels.questionnairesSave, input),
  questionnairesDelete: (id) => ipcRenderer.invoke(IpcChannels.questionnairesDelete, id),
  questionnairesValidate: (input) => ipcRenderer.invoke(IpcChannels.questionnairesValidate, input),
  questionnairesSetFavorite: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesSetFavorite, input),
  questionnairesListTypes: () => ipcRenderer.invoke(IpcChannels.questionnairesListTypes),
  questionnairesAddType: (name) => ipcRenderer.invoke(IpcChannels.questionnairesAddType, name),
  questionnairesIntimacyTopics: () => ipcRenderer.invoke(IpcChannels.questionnairesIntimacyTopics),
  questionnairesAddIntimacyTopic: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesAddIntimacyTopic, input),
  questionnairesRemoveIntimacyTopic: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesRemoveIntimacyTopic, input),
  questionnairesSuggestIntimacyTopics: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesSuggestIntimacyTopics, input),
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
  questionnaireSuggestionsList: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnaireSuggestionsList, input),
  questionnaireSuggestionsGenerate: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnaireSuggestionsGenerate, input),
  questionnaireSuggestionDelete: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnaireSuggestionDelete, input),
  questionnaireSuggestionMaterialize: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnaireSuggestionMaterialize, input),
  insightsList: () => ipcRenderer.invoke(IpcChannels.insightsList),
  memoryOutboundSharing: () => ipcRenderer.invoke(IpcChannels.memoryOutboundSharing),
  insightsAnalyze: (input) => ipcRenderer.invoke(IpcChannels.insightsAnalyze, input),
  insightsApprove: (input) => ipcRenderer.invoke(IpcChannels.insightsApprove, input),
  insightsUpdate: (input) => ipcRenderer.invoke(IpcChannels.insightsUpdate, input),
  insightsDelete: (input) => ipcRenderer.invoke(IpcChannels.insightsDelete, input),
  insightsFlag: (input) => ipcRenderer.invoke(IpcChannels.insightsFlag, input),
  memoryRefresh: (input) => ipcRenderer.invoke(IpcChannels.memoryRefresh, input),
  memoryReconcileState: () => ipcRenderer.invoke(IpcChannels.memoryReconcileState),
  memoryResolveProposal: (input) => ipcRenderer.invoke(IpcChannels.memoryResolveProposal, input),
  goalsList: () => ipcRenderer.invoke(IpcChannels.goalsList),
  goalsSetStatus: (input) => ipcRenderer.invoke(IpcChannels.goalsSetStatus, input),
  goalsUpdate: (input) => ipcRenderer.invoke(IpcChannels.goalsUpdate, input),
  goalsDelete: (input) => ipcRenderer.invoke(IpcChannels.goalsDelete, input),
  goalsCreate: (input) => ipcRenderer.invoke(IpcChannels.goalsCreate, input),
  goalsSuggest: () => ipcRenderer.invoke(IpcChannels.goalsSuggest),
  coachingGetPrefs: () => ipcRenderer.invoke(IpcChannels.coachingGetPrefs),
  coachingSetPrefs: (input) => ipcRenderer.invoke(IpcChannels.coachingSetPrefs, input),
  coachingGetSynthesis: () => ipcRenderer.invoke(IpcChannels.coachingGetSynthesis),
  coachingSynthesize: (input) => ipcRenderer.invoke(IpcChannels.coachingSynthesize, input),
  autoCheckinsGetConfig: () => ipcRenderer.invoke(IpcChannels.autoCheckinsGetConfig),
  autoCheckinsSetConfig: (input) => ipcRenderer.invoke(IpcChannels.autoCheckinsSetConfig, input),
  autoCheckinsEnsureSeed: () => ipcRenderer.invoke(IpcChannels.autoCheckinsEnsureSeed),
  autoCheckinsRun: (input) => ipcRenderer.invoke(IpcChannels.autoCheckinsRun, input),
  autoCheckinsIncomingStreams: () => ipcRenderer.invoke(IpcChannels.autoCheckinsIncomingStreams),
  autoCheckinsGetBlocks: () => ipcRenderer.invoke(IpcChannels.autoCheckinsGetBlocks),
  autoCheckinsSetBlock: (input) => ipcRenderer.invoke(IpcChannels.autoCheckinsSetBlock, input),
  storyBookTypes: () => ipcRenderer.invoke(IpcChannels.storyBookTypes),
  storyList: () => ipcRenderer.invoke(IpcChannels.storyList),
  storyCreate: (input) => ipcRenderer.invoke(IpcChannels.storyCreate, input),
  storyGet: (input) => ipcRenderer.invoke(IpcChannels.storyGet, input),
  storyGenerateFoundations: (input) =>
    ipcRenderer.invoke(IpcChannels.storyGenerateFoundations, input),
  storyGenerateFullDraft: (input) => ipcRenderer.invoke(IpcChannels.storyGenerateFullDraft, input),
  onStoryProgress: (listener) => {
    const handler = (_event: unknown, progress: unknown): void =>
      listener(progress as Parameters<typeof listener>[0]);
    ipcRenderer.on(IpcChannels.storyProgress, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.storyProgress, handler);
    };
  },
  onImageProgress: (listener) => {
    const handler = (_event: unknown, progress: unknown): void =>
      listener(progress as Parameters<typeof listener>[0]);
    ipcRenderer.on(IpcChannels.imageProgress, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.imageProgress, handler);
    };
  },
  storySaveOutline: (input) => ipcRenderer.invoke(IpcChannels.storySaveOutline, input),
  storyApproveOutline: (input) => ipcRenderer.invoke(IpcChannels.storyApproveOutline, input),
  storyUpdate: (input) => ipcRenderer.invoke(IpcChannels.storyUpdate, input),
  storyDelete: (input) => ipcRenderer.invoke(IpcChannels.storyDelete, input),
  storyRewriteFromScratch: (input) =>
    ipcRenderer.invoke(IpcChannels.storyRewriteFromScratch, input),
  storyGenerateChapters: (input) => ipcRenderer.invoke(IpcChannels.storyGenerateChapters, input),
  storyRegenerateChapter: (input) => ipcRenderer.invoke(IpcChannels.storyRegenerateChapter, input),
  storyReviewChapter: (input) => ipcRenderer.invoke(IpcChannels.storyReviewChapter, input),
  storyChapterHistory: (input) => ipcRenderer.invoke(IpcChannels.storyChapterHistory, input),
  storyChapterVersion: (input) => ipcRenderer.invoke(IpcChannels.storyChapterVersion, input),
  storyRestoreChapterVersion: (input) =>
    ipcRenderer.invoke(IpcChannels.storyRestoreChapterVersion, input),
  storyGetMarkup: (input) => ipcRenderer.invoke(IpcChannels.storyGetMarkup, input),
  storyMark: (input) => ipcRenderer.invoke(IpcChannels.storyMark, input),
  storyUpdateMark: (input) => ipcRenderer.invoke(IpcChannels.storyUpdateMark, input),
  storyRemoveMark: (input) => ipcRenderer.invoke(IpcChannels.storyRemoveMark, input),
  storyApplyMarkup: (input) => ipcRenderer.invoke(IpcChannels.storyApplyMarkup, input),
  storyEditPassage: (input) => ipcRenderer.invoke(IpcChannels.storyEditPassage, input),
  storyPinQuote: (input) => ipcRenderer.invoke(IpcChannels.storyPinQuote, input),
  storyTodos: (input) => ipcRenderer.invoke(IpcChannels.storyTodos, input),
  storyExclusions: (input) => ipcRenderer.invoke(IpcChannels.storyExclusions, input),
  storyExclude: (input) => ipcRenderer.invoke(IpcChannels.storyExclude, input),
  storyUnexclude: (input) => ipcRenderer.invoke(IpcChannels.storyUnexclude, input),
  storyTodoToQuestions: (input) => ipcRenderer.invoke(IpcChannels.storyTodoToQuestions, input),
  storyRefreshCheck: (input) => ipcRenderer.invoke(IpcChannels.storyRefreshCheck, input),
  storyProposals: (input) => ipcRenderer.invoke(IpcChannels.storyProposals, input),
  storyResolveProposal: (input) => ipcRenderer.invoke(IpcChannels.storyResolveProposal, input),
  storyHomeSignal: () => ipcRenderer.invoke(IpcChannels.storyHomeSignal),
  storyCorpusStats: () => ipcRenderer.invoke(IpcChannels.storyCorpusStats),
  storyCompleteness: (input) => ipcRenderer.invoke(IpcChannels.storyCompleteness, input),
  storyInterviewCheck: (input) => ipcRenderer.invoke(IpcChannels.storyInterviewCheck, input),
  storyGaps: (input) => ipcRenderer.invoke(IpcChannels.storyGaps, input),
  storyAskGap: (input) => ipcRenderer.invoke(IpcChannels.storyAskGap, input),
  storyAnsweredCheckIns: (input) => ipcRenderer.invoke(IpcChannels.storyAnsweredCheckIns, input),
  storyPublish: (input) => ipcRenderer.invoke(IpcChannels.storyPublish, input),
  storyReaders: (input) => ipcRenderer.invoke(IpcChannels.storyReaders, input),
  storyGrantReader: (input) => ipcRenderer.invoke(IpcChannels.storyGrantReader, input),
  storyRevokeReader: (input) => ipcRenderer.invoke(IpcChannels.storyRevokeReader, input),
  storyReaderFeatured: (input) => ipcRenderer.invoke(IpcChannels.storyReaderFeatured, input),
  storySharedBooks: () => ipcRenderer.invoke(IpcChannels.storySharedBooks),
  storyReadShared: (input) => ipcRenderer.invoke(IpcChannels.storyReadShared, input),
  storyReadOwnBook: (input) => ipcRenderer.invoke(IpcChannels.storyReadOwnBook, input),
  storySetReadPosition: (input) => ipcRenderer.invoke(IpcChannels.storySetReadPosition, input),
  storyMarkSharedRead: (input) => ipcRenderer.invoke(IpcChannels.storyMarkSharedRead, input),
  storyReadSharedImage: (input) => ipcRenderer.invoke(IpcChannels.storyReadSharedImage, input),
  storyExportMarkdown: (input) => ipcRenderer.invoke(IpcChannels.storyExportMarkdown, input),
  storyExportPdf: (input) => ipcRenderer.invoke(IpcChannels.storyExportPdf, input),
  storyImages: (input) => ipcRenderer.invoke(IpcChannels.storyImages, input),
  storyGenerateImage: (input) => ipcRenderer.invoke(IpcChannels.storyGenerateImage, input),
  storyGetImage: (input) => ipcRenderer.invoke(IpcChannels.storyGetImage, input),
  storyDeleteImage: (input) => ipcRenderer.invoke(IpcChannels.storyDeleteImage, input),
  storyUploadPhoto: (input) => ipcRenderer.invoke(IpcChannels.storyUploadPhoto, input),
  storyAnalyzePhoto: (input) => ipcRenderer.invoke(IpcChannels.storyAnalyzePhoto, input),
  storyAnswerPhoto: (input) => ipcRenderer.invoke(IpcChannels.storyAnswerPhoto, input),
  storyPhotoAnswers: (input) => ipcRenderer.invoke(IpcChannels.storyPhotoAnswers, input),
  storySuggestPlacement: (input) => ipcRenderer.invoke(IpcChannels.storySuggestPlacement, input),
  storySetPlacement: (input) => ipcRenderer.invoke(IpcChannels.storySetPlacement, input),
  storyRemovePlacement: (input) => ipcRenderer.invoke(IpcChannels.storyRemovePlacement, input),
  relationshipsGetSynthesis: (input) =>
    ipcRenderer.invoke(IpcChannels.relationshipsGetSynthesis, input),
  relationshipsSynthesize: (input) =>
    ipcRenderer.invoke(IpcChannels.relationshipsSynthesize, input),
  challengesStart: (input) => ipcRenderer.invoke(IpcChannels.challengesStart, input),
  challengesStartReflection: (input) =>
    ipcRenderer.invoke(IpcChannels.challengesStartReflection, input),
  challengesList: () => ipcRenderer.invoke(IpcChannels.challengesList),
  challengesGet: (input) => ipcRenderer.invoke(IpcChannels.challengesGet, input),
  challengesSetStatus: (input) => ipcRenderer.invoke(IpcChannels.challengesSetStatus, input),
  challengesCheckIn: (input) => ipcRenderer.invoke(IpcChannels.challengesCheckIn, input),
  challengesSnooze: (input) => ipcRenderer.invoke(IpcChannels.challengesSnooze, input),
  challengesSeedGoal: (input) => ipcRenderer.invoke(IpcChannels.challengesSeedGoal, input),
  challengesDelete: (input) => ipcRenderer.invoke(IpcChannels.challengesDelete, input),
  challengesSuggest: (input) => ipcRenderer.invoke(IpcChannels.challengesSuggest, input),
  challengesGetSuggestion: () => ipcRenderer.invoke(IpcChannels.challengesGetSuggestion),
  challengesClearSuggestion: () => ipcRenderer.invoke(IpcChannels.challengesClearSuggestion),
  // Together / couples sessions (58).
  togetherList: () => ipcRenderer.invoke(IpcChannels.togetherList),
  togetherGet: (id) => ipcRenderer.invoke(IpcChannels.togetherGet, id),
  togetherCreate: (input) => ipcRenderer.invoke(IpcChannels.togetherCreate, input),
  togetherAccept: (id) => ipcRenderer.invoke(IpcChannels.togetherAccept, id),
  togetherDecline: (id) => ipcRenderer.invoke(IpcChannels.togetherDecline, id),
  togetherSetPaused: (input) => ipcRenderer.invoke(IpcChannels.togetherSetPaused, input),
  togetherLeave: (id) => ipcRenderer.invoke(IpcChannels.togetherLeave, id),
  togetherWithdraw: (id) => ipcRenderer.invoke(IpcChannels.togetherWithdraw, id),
  togetherMarkRead: (input) => ipcRenderer.invoke(IpcChannels.togetherMarkRead, input),
  togetherSendMessage: (input) => ipcRenderer.invoke(IpcChannels.togetherSendMessage, input),
  togetherRetry: (input) => ipcRenderer.invoke(IpcChannels.togetherRetry, input),
  togetherRewind: (input) => ipcRenderer.invoke(IpcChannels.togetherRewind, input),
  togetherPrepOpen: (input) => ipcRenderer.invoke(IpcChannels.togetherPrepOpen, input),
  togetherStoreAttachment: (input) =>
    ipcRenderer.invoke(IpcChannels.togetherStoreAttachment, input),
  togetherGetAttachment: (input) => ipcRenderer.invoke(IpcChannels.togetherGetAttachment, input),
  togetherCatalog: () => ipcRenderer.invoke(IpcChannels.togetherCatalog),
  togetherAcknowledgeAdult: () => ipcRenderer.invoke(IpcChannels.togetherAcknowledgeAdult),
  togetherYnmStatus: (input) => ipcRenderer.invoke(IpcChannels.togetherYnmStatus, input),
  togetherYnmOptIn: (input) => ipcRenderer.invoke(IpcChannels.togetherYnmOptIn, input),
  togetherYnmRevoke: (input) => ipcRenderer.invoke(IpcChannels.togetherYnmRevoke, input),
  togetherYnmOverlap: (input) => ipcRenderer.invoke(IpcChannels.togetherYnmOverlap, input),
  togetherPulse: (input) => ipcRenderer.invoke(IpcChannels.togetherPulse, input),
  togetherPulseLog: (input) => ipcRenderer.invoke(IpcChannels.togetherPulseLog, input),
  togetherJointChallenges: (input) =>
    ipcRenderer.invoke(IpcChannels.togetherJointChallenges, input),
  togetherSuggestions: (sessionId) =>
    ipcRenderer.invoke(IpcChannels.togetherSuggestions, sessionId),
  togetherWrapUp: (input) => ipcRenderer.invoke(IpcChannels.togetherWrapUp, input),
  togetherGetReport: (input) => ipcRenderer.invoke(IpcChannels.togetherGetReport, input),
  togetherSaveAgreement: (input) => ipcRenderer.invoke(IpcChannels.togetherSaveAgreement, input),
  togetherMyAgreements: () => ipcRenderer.invoke(IpcChannels.togetherMyAgreements),
  togetherDoneCommitments: () => ipcRenderer.invoke(IpcChannels.togetherDoneCommitments),
  togetherSetAgreementStatus: (input) =>
    ipcRenderer.invoke(IpcChannels.togetherSetAgreementStatus, input),
  assignmentsCreate: (input) => ipcRenderer.invoke(IpcChannels.assignmentsCreate, input),
  assignmentsInbox: () => ipcRenderer.invoke(IpcChannels.assignmentsInbox),
  assignmentsSetFavorite: (input) => ipcRenderer.invoke(IpcChannels.assignmentsSetFavorite, input),
  assignmentsGet: (assignmentId) => ipcRenderer.invoke(IpcChannels.assignmentsGet, assignmentId),
  assignmentsOpen: (assignmentId) => ipcRenderer.invoke(IpcChannels.assignmentsOpen, assignmentId),
  assignmentsSaveProgress: (input) =>
    ipcRenderer.invoke(IpcChannels.assignmentsSaveProgress, input),
  assignmentsReopen: (assignmentId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsReopen, assignmentId),
  assignmentsSubmit: (input) => ipcRenderer.invoke(IpcChannels.assignmentsSubmit, input),
  assignmentsDecline: (input) => ipcRenderer.invoke(IpcChannels.assignmentsDecline, input),
  assignmentsResults: (questionnaireId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsResults, questionnaireId),
  assignmentsTrends: (questionnaireId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsTrends, questionnaireId),
  assignmentsAggregate: (questionnaireId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsAggregate, questionnaireId),
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
  assignmentsReshare: (assignmentId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsReshare, assignmentId),
  assignmentsReAsk: (input) => ipcRenderer.invoke(IpcChannels.assignmentsReAsk, input),
  assignmentsExportResults: (input) =>
    ipcRenderer.invoke(IpcChannels.assignmentsExportResults, input),
  relayStatus: () => ipcRenderer.invoke(IpcChannels.relayStatus),
  relayConnect: (input) => ipcRenderer.invoke(IpcChannels.relayConnect, input),
  relayUpdate: () => ipcRenderer.invoke(IpcChannels.relayUpdate),
  relayTeardown: () => ipcRenderer.invoke(IpcChannels.relayTeardown),
  dreamsList: () => ipcRenderer.invoke(IpcChannels.dreamsList),
  dreamGet: (id) => ipcRenderer.invoke(IpcChannels.dreamGet, id),
  dreamSave: (input) => ipcRenderer.invoke(IpcChannels.dreamSave, input),
  dreamDelete: (id) => ipcRenderer.invoke(IpcChannels.dreamDelete, id),
  dreamStartReflection: (input) => ipcRenderer.invoke(IpcChannels.dreamStartReflection, input),
  dreamAnalyzeTurn: (input) => ipcRenderer.invoke(IpcChannels.dreamAnalyzeTurn, input),
  dreamRetryTurn: (input) => ipcRenderer.invoke(IpcChannels.dreamRetryTurn, input),
  dreamRewind: (input) => ipcRenderer.invoke(IpcChannels.dreamRewind, input),
  dreamRegenerateFrom: (input) => ipcRenderer.invoke(IpcChannels.dreamRegenerateFrom, input),
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
  intakeRetryTurn: (input) => ipcRenderer.invoke(IpcChannels.intakeRetryTurn, input),
  intakeRewind: (input) => ipcRenderer.invoke(IpcChannels.intakeRewind, input),
  intakeRegenerateFrom: (input) => ipcRenderer.invoke(IpcChannels.intakeRegenerateFrom, input),
  onIntakeChunk: (listener) => {
    const handler = (_event: unknown, delta: string): void => listener(delta);
    ipcRenderer.on(IpcChannels.intakeChunk, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.intakeChunk, handler);
    };
  },
  onTogetherChunk: (listener) => {
    const handler = (_event: unknown, delta: string): void => listener(delta);
    ipcRenderer.on(IpcChannels.togetherChunk, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.togetherChunk, handler);
    };
  },
  intakeSkipSection: (input) => ipcRenderer.invoke(IpcChannels.intakeSkipSection, input),
  intakeSubmitForm: (input) => ipcRenderer.invoke(IpcChannels.intakeSubmitForm, input),
  intakeAcknowledgeAdult: () => ipcRenderer.invoke(IpcChannels.intakeAcknowledgeAdult),
  intakeSetAnswerSharing: (input) => ipcRenderer.invoke(IpcChannels.intakeSetAnswerSharing, input),
  intakeSynthesize: (input) => ipcRenderer.invoke(IpcChannels.intakeSynthesize, input),
  profileSuggestions: () => ipcRenderer.invoke(IpcChannels.profileSuggestions),
  profileAcceptSuggestion: (id) => ipcRenderer.invoke(IpcChannels.profileAcceptSuggestion, id),
  profileDismissSuggestion: (id) => ipcRenderer.invoke(IpcChannels.profileDismissSuggestion, id),
  getSidebarCollapsed: () => ipcRenderer.invoke(IpcChannels.getSidebarCollapsed),
  setSidebarCollapsed: (collapsed) =>
    ipcRenderer.invoke(IpcChannels.setSidebarCollapsed, collapsed),
  getDiscoveryDismissals: () => ipcRenderer.invoke(IpcChannels.getDiscoveryDismissals),
  setDiscoveryDismissals: (keys) => ipcRenderer.invoke(IpcChannels.setDiscoveryDismissals, keys),
  getNotificationState: () => ipcRenderer.invoke(IpcChannels.getNotificationState),
  setNotificationState: (state) => ipcRenderer.invoke(IpcChannels.setNotificationState, state),
  notificationsResponsesArrived: () =>
    ipcRenderer.invoke(IpcChannels.notificationsResponsesArrived),
  notificationsAnswersUpdated: () => ipcRenderer.invoke(IpcChannels.notificationsAnswersUpdated),
  notificationsRemindersDue: () => ipcRenderer.invoke(IpcChannels.notificationsRemindersDue),
  openExternal: (url) => ipcRenderer.invoke(IpcChannels.openExternal, url),
  updatesCheck: (force) => ipcRenderer.invoke(IpcChannels.updatesCheck, force),
  updatesGetState: () => ipcRenderer.invoke(IpcChannels.updatesGetState),
};

contextBridge.exposeInMainWorld('selfos', bridge);
