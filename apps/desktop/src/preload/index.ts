import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  type AppPlatform,
  type SelfosBridge,
  type StreamChunkEnvelope,
  type StreamChunkMap,
  type StreamSurface,
} from '../shared/channels';

/**
 * Subscribe to ONE streamed surface over the single `stream:chunk` channel (64 §15.3). Each caller gets its
 * own `ipcRenderer` listener that ignores envelopes for other surfaces, so two live streams never cross and
 * unsubscribing one leaves the others intact.
 */
function onStreamChunk<K extends StreamSurface>(
  surface: K,
  listener: (chunk: StreamChunkMap[K]) => void,
): () => void {
  const handler = (_event: unknown, envelope: StreamChunkEnvelope): void => {
    if (envelope.surface === surface) listener(envelope.chunk as StreamChunkMap[K]);
  };
  ipcRenderer.on(IpcChannels.streamChunk, handler);
  return () => {
    ipcRenderer.removeListener(IpcChannels.streamChunk, handler);
  };
}

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
  onChatChunk: (listener) => onStreamChunk('chat', listener),
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
  imagesGetPrefs: () => ipcRenderer.invoke(IpcChannels.imagesGetPrefs),
  imagesSetPrefs: (input) => ipcRenderer.invoke(IpcChannels.imagesSetPrefs, input),
  testsList: () => ipcRenderer.invoke(IpcChannels.testsList),
  testsGet: (input) => ipcRenderer.invoke(IpcChannels.testsGet, input),
  testsTake: (input) => ipcRenderer.invoke(IpcChannels.testsTake, input),
  testsResults: (input) => ipcRenderer.invoke(IpcChannels.testsResults, input),
  testsNarrate: (input) => ipcRenderer.invoke(IpcChannels.testsNarrate, input),
  testsAcknowledgeAdult: () => ipcRenderer.invoke(IpcChannels.testsAcknowledgeAdult),
  testsDeleteResult: (input) => ipcRenderer.invoke(IpcChannels.testsDeleteResult, input),
  testsDeleteAll: (input) => ipcRenderer.invoke(IpcChannels.testsDeleteAll, input),
  // 74 — adaptive tests.
  testsBank: (input) => ipcRenderer.invoke(IpcChannels.testsBank, input),
  testsNames: (input) => ipcRenderer.invoke(IpcChannels.testsNames, input),
  testsAdaptiveNames: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveNames, input),
  testsAdaptiveState: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveState, input),
  testsAdaptiveStart: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveStart, input),
  testsAdaptiveBank: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveBank, input),
  testsAdaptiveSetArea: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveSetArea, input),
  testsAdaptiveLines: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveLines, input),
  testsAdaptiveProbe: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveProbe, input),
  testsAdaptiveScenario: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveScenario, input),
  testsAdaptiveTurn: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveTurn, input),
  testsAdaptiveDeleteTurn: (input) =>
    ipcRenderer.invoke(IpcChannels.testsAdaptiveDeleteTurn, input),
  testsAdaptiveSynthesize: (input) =>
    ipcRenderer.invoke(IpcChannels.testsAdaptiveSynthesize, input),
  testsAdaptiveAbandon: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveAbandon, input),
  testsLexicon: () => ipcRenderer.invoke(IpcChannels.testsLexicon),
  testsLexiconEdit: (input) => ipcRenderer.invoke(IpcChannels.testsLexiconEdit, input),
  testsAdaptiveDeleteAll: (input) => ipcRenderer.invoke(IpcChannels.testsAdaptiveDeleteAll, input),
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
  questionnairesStoreImage: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesStoreImage, input),
  questionnairesGetImage: (imagePath) =>
    ipcRenderer.invoke(IpcChannels.questionnairesGetImage, imagePath),
  questionnairesDeleteImage: (imagePath) =>
    ipcRenderer.invoke(IpcChannels.questionnairesDeleteImage, imagePath),
  questionnairesGenerate: (input) => ipcRenderer.invoke(IpcChannels.questionnairesGenerate, input),
  questionnairesImproveQuestion: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesImproveQuestion, input),
  questionnairesSharpenQuestion: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesSharpenQuestion, input),
  questionnairesMarkCovered: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesMarkCovered, input),
  questionnairesPersonalizationProfile: () =>
    ipcRenderer.invoke(IpcChannels.questionnairesPersonalizationProfile),
  questionnairesSteerTopic: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesSteerTopic, input),
  questionnairesCurateCandidate: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesCurateCandidate, input),
  questionnairesLiftSuppression: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesLiftSuppression, input),
  inboxList: () => ipcRenderer.invoke(IpcChannels.inboxList),
  inboxDismiss: (entryId) => ipcRenderer.invoke(IpcChannels.inboxDismiss, entryId),
  questionnairesClearCandidateFeed: () =>
    ipcRenderer.invoke(IpcChannels.questionnairesClearCandidateFeed),
  questionnairesRefreshNextCandidates: () =>
    ipcRenderer.invoke(IpcChannels.questionnairesRefreshNextCandidates),
  questionnairesAcknowledgeAdult: () =>
    ipcRenderer.invoke(IpcChannels.questionnairesAcknowledgeAdult),
  questionnairesAddPartnerWish: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesAddPartnerWish, input),
  questionnairesRemovePartnerWish: (input) =>
    ipcRenderer.invoke(IpcChannels.questionnairesRemovePartnerWish, input),
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
  memorySetScopeBatch: (input) => ipcRenderer.invoke(IpcChannels.memorySetScopeBatch, input),
  memorySetProfileFieldShared: (input) =>
    ipcRenderer.invoke(IpcChannels.memorySetProfileFieldShared, input),
  emailStatus: () => ipcRenderer.invoke(IpcChannels.emailStatus),
  emailVerify: () => ipcRenderer.invoke(IpcChannels.emailVerify),
  emailSetConfig: (input) => ipcRenderer.invoke(IpcChannels.emailSetConfig, input),
  emailSetSharedKey: (input) => ipcRenderer.invoke(IpcChannels.emailSetSharedKey, input),
  emailClearSharedKey: () => ipcRenderer.invoke(IpcChannels.emailClearSharedKey),
  emailGetPrefs: () => ipcRenderer.invoke(IpcChannels.emailGetPrefs),
  emailSetPrefs: (input) => ipcRenderer.invoke(IpcChannels.emailSetPrefs, input),
  emailAcknowledgeAdult: () => ipcRenderer.invoke(IpcChannels.emailAcknowledgeAdult),
  emailSend: (input) => ipcRenderer.invoke(IpcChannels.emailSend, input),
  emailSendQuestionnaireDelivery: (input) =>
    ipcRenderer.invoke(IpcChannels.emailSendQuestionnaireDelivery, input),
  emailSendTransactional: (input) => ipcRenderer.invoke(IpcChannels.emailSendTransactional, input),
  emailScheduleReconcile: (input) => ipcRenderer.invoke(IpcChannels.emailScheduleReconcile, input),
  emailResponses: () => ipcRenderer.invoke(IpcChannels.emailResponses),
  emailEditResponse: (input) => ipcRenderer.invoke(IpcChannels.emailEditResponse, input),
  emailAllActivity: () => ipcRenderer.invoke(IpcChannels.emailAllActivity),
  emailContent: (input) => ipcRenderer.invoke(IpcChannels.emailContent, input),
  emailMutualGreenLights: () => ipcRenderer.invoke(IpcChannels.emailMutualGreenLights),
  emailIntimacyOffers: () => ipcRenderer.invoke(IpcChannels.emailIntimacyOffers),
  emailApplyIntimacyOffer: (input) =>
    ipcRenderer.invoke(IpcChannels.emailApplyIntimacyOffer, input),
  emailActivity: (input) => ipcRenderer.invoke(IpcChannels.emailActivity, input),
  notesRecipients: () => ipcRenderer.invoke(IpcChannels.notesRecipients),
  notesDraft: (input) => ipcRenderer.invoke(IpcChannels.notesDraft, input),
  notesSend: (input) => ipcRenderer.invoke(IpcChannels.notesSend, input),
  notesList: () => ipcRenderer.invoke(IpcChannels.notesList),
  notesDelete: (input) => ipcRenderer.invoke(IpcChannels.notesDelete, input),
  notesGetForMe: (input) => ipcRenderer.invoke(IpcChannels.notesGetForMe, input),
  notesAnswer: (input) => ipcRenderer.invoke(IpcChannels.notesAnswer, input),
  peopleSetEmail: (input) => ipcRenderer.invoke(IpcChannels.peopleSetEmail, input),
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
  autoCheckinsSentActivity: () => ipcRenderer.invoke(IpcChannels.autoCheckinsSentActivity),
  autoCheckinsGetBlocks: () => ipcRenderer.invoke(IpcChannels.autoCheckinsGetBlocks),
  autoCheckinsSetBlock: (input) => ipcRenderer.invoke(IpcChannels.autoCheckinsSetBlock, input),
  booksBookTypes: () => ipcRenderer.invoke(IpcChannels.booksBookTypes),
  booksList: () => ipcRenderer.invoke(IpcChannels.booksList),
  booksShelf: () => ipcRenderer.invoke(IpcChannels.booksShelf),
  booksCreate: (input) => ipcRenderer.invoke(IpcChannels.booksCreate, input),
  booksGet: (input) => ipcRenderer.invoke(IpcChannels.booksGet, input),
  booksGenerateFoundations: (input) =>
    ipcRenderer.invoke(IpcChannels.booksGenerateFoundations, input),
  booksGenerateFullDraft: (input) => ipcRenderer.invoke(IpcChannels.booksGenerateFullDraft, input),
  onStoryProgress: (listener) => {
    const handler = (_event: unknown, progress: unknown): void =>
      listener(progress as Parameters<typeof listener>[0]);
    ipcRenderer.on(IpcChannels.booksProgress, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.booksProgress, handler);
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
  booksSaveOutline: (input) => ipcRenderer.invoke(IpcChannels.booksSaveOutline, input),
  booksApproveOutline: (input) => ipcRenderer.invoke(IpcChannels.booksApproveOutline, input),
  booksUpdate: (input) => ipcRenderer.invoke(IpcChannels.booksUpdate, input),
  booksDelete: (input) => ipcRenderer.invoke(IpcChannels.booksDelete, input),
  booksRewriteFromScratch: (input) =>
    ipcRenderer.invoke(IpcChannels.booksRewriteFromScratch, input),
  booksGenerateChapters: (input) => ipcRenderer.invoke(IpcChannels.booksGenerateChapters, input),
  booksRegenerateChapter: (input) => ipcRenderer.invoke(IpcChannels.booksRegenerateChapter, input),
  booksReviewChapter: (input) => ipcRenderer.invoke(IpcChannels.booksReviewChapter, input),
  booksChapterHistory: (input) => ipcRenderer.invoke(IpcChannels.booksChapterHistory, input),
  booksChapterVersion: (input) => ipcRenderer.invoke(IpcChannels.booksChapterVersion, input),
  booksRestoreChapterVersion: (input) =>
    ipcRenderer.invoke(IpcChannels.booksRestoreChapterVersion, input),
  booksGetMarkup: (input) => ipcRenderer.invoke(IpcChannels.booksGetMarkup, input),
  booksMark: (input) => ipcRenderer.invoke(IpcChannels.booksMark, input),
  booksUpdateMark: (input) => ipcRenderer.invoke(IpcChannels.booksUpdateMark, input),
  booksRemoveMark: (input) => ipcRenderer.invoke(IpcChannels.booksRemoveMark, input),
  booksApplyMarkup: (input) => ipcRenderer.invoke(IpcChannels.booksApplyMarkup, input),
  booksEditPassage: (input) => ipcRenderer.invoke(IpcChannels.booksEditPassage, input),
  booksPinQuote: (input) => ipcRenderer.invoke(IpcChannels.booksPinQuote, input),
  booksTodos: (input) => ipcRenderer.invoke(IpcChannels.booksTodos, input),
  booksExclusions: (input) => ipcRenderer.invoke(IpcChannels.booksExclusions, input),
  booksExclude: (input) => ipcRenderer.invoke(IpcChannels.booksExclude, input),
  booksUnexclude: (input) => ipcRenderer.invoke(IpcChannels.booksUnexclude, input),
  booksQuoteCandidates: (input) => ipcRenderer.invoke(IpcChannels.booksQuoteCandidates, input),
  booksMineQuotes: (input) => ipcRenderer.invoke(IpcChannels.booksMineQuotes, input),
  booksSetQuoteStatus: (input) => ipcRenderer.invoke(IpcChannels.booksSetQuoteStatus, input),
  booksTodoToQuestions: (input) => ipcRenderer.invoke(IpcChannels.booksTodoToQuestions, input),
  booksAnswerQuestion: (input) => ipcRenderer.invoke(IpcChannels.booksAnswerQuestion, input),
  booksMemoryList: () => ipcRenderer.invoke(IpcChannels.booksMemoryList),
  booksMemoryGet: (input) => ipcRenderer.invoke(IpcChannels.booksMemoryGet, input),
  booksMemoryOpen: (input) => ipcRenderer.invoke(IpcChannels.booksMemoryOpen, input),
  booksMemoryTurn: (input) => ipcRenderer.invoke(IpcChannels.booksMemoryTurn, input),
  booksMemoryRetry: (input) => ipcRenderer.invoke(IpcChannels.booksMemoryRetry, input),
  booksMemoryRewind: (input) => ipcRenderer.invoke(IpcChannels.booksMemoryRewind, input),
  booksMemoryRegenerate: (input) => ipcRenderer.invoke(IpcChannels.booksMemoryRegenerate, input),
  booksMemorySynthesize: (input) => ipcRenderer.invoke(IpcChannels.booksMemorySynthesize, input),
  booksMemorySave: (input) => ipcRenderer.invoke(IpcChannels.booksMemorySave, input),
  booksMemoryDelete: (input) => ipcRenderer.invoke(IpcChannels.booksMemoryDelete, input),
  booksMemoryStoreAttachment: (input) =>
    ipcRenderer.invoke(IpcChannels.booksMemoryStoreAttachment, input),
  booksMemoryGetAttachment: (input) =>
    ipcRenderer.invoke(IpcChannels.booksMemoryGetAttachment, input),
  onMemoryChunk: (listener) => onStreamChunk('memory', listener),
  booksRefreshCheck: (input) => ipcRenderer.invoke(IpcChannels.booksRefreshCheck, input),
  booksProposals: (input) => ipcRenderer.invoke(IpcChannels.booksProposals, input),
  booksResolveProposal: (input) => ipcRenderer.invoke(IpcChannels.booksResolveProposal, input),
  booksContinuityCheck: (input) => ipcRenderer.invoke(IpcChannels.booksContinuityCheck, input),
  booksManuscriptRead: (input) => ipcRenderer.invoke(IpcChannels.booksManuscriptRead, input),
  booksNewMaterial: (input) => ipcRenderer.invoke(IpcChannels.booksNewMaterial, input),
  booksFinishEdition: (input) => ipcRenderer.invoke(IpcChannels.booksFinishEdition, input),
  booksReopenBook: (input) => ipcRenderer.invoke(IpcChannels.booksReopenBook, input),
  booksAcceptMaterial: (input) => ipcRenderer.invoke(IpcChannels.booksAcceptMaterial, input),
  booksDeclineMaterial: (input) => ipcRenderer.invoke(IpcChannels.booksDeclineMaterial, input),
  booksContinuity: (input) => ipcRenderer.invoke(IpcChannels.booksContinuity, input),
  booksResolveContinuity: (input) => ipcRenderer.invoke(IpcChannels.booksResolveContinuity, input),
  booksLineEdit: (input) => ipcRenderer.invoke(IpcChannels.booksLineEdit, input),
  booksEditOutline: (input) => ipcRenderer.invoke(IpcChannels.booksEditOutline, input),
  booksEditTimeline: (input) => ipcRenderer.invoke(IpcChannels.booksEditTimeline, input),
  booksSuggestTitles: (input) => ipcRenderer.invoke(IpcChannels.booksSuggestTitles, input),
  booksRegenerateEssence: (input) => ipcRenderer.invoke(IpcChannels.booksRegenerateEssence, input),
  booksHomeSignal: () => ipcRenderer.invoke(IpcChannels.booksHomeSignal),
  booksCorpusStats: () => ipcRenderer.invoke(IpcChannels.booksCorpusStats),
  booksCastRegister: (input) => ipcRenderer.invoke(IpcChannels.booksCastRegister, input),
  booksConsent: (input) => ipcRenderer.invoke(IpcChannels.booksConsent, input),
  booksSetConsent: (input) => ipcRenderer.invoke(IpcChannels.booksSetConsent, input),
  booksCompleteness: (input) => ipcRenderer.invoke(IpcChannels.booksCompleteness, input),
  booksInterviewCheck: (input) => ipcRenderer.invoke(IpcChannels.booksInterviewCheck, input),
  booksGaps: (input) => ipcRenderer.invoke(IpcChannels.booksGaps, input),
  booksAskGap: (input) => ipcRenderer.invoke(IpcChannels.booksAskGap, input),
  booksAnsweredCheckIns: (input) => ipcRenderer.invoke(IpcChannels.booksAnsweredCheckIns, input),
  booksPublish: (input) => ipcRenderer.invoke(IpcChannels.booksPublish, input),
  booksPublishDiff: (input) => ipcRenderer.invoke(IpcChannels.booksPublishDiff, input),
  booksUnpublish: (input) => ipcRenderer.invoke(IpcChannels.booksUnpublish, input),
  booksReaders: (input) => ipcRenderer.invoke(IpcChannels.booksReaders, input),
  booksGrantReader: (input) => ipcRenderer.invoke(IpcChannels.booksGrantReader, input),
  booksRevokeReader: (input) => ipcRenderer.invoke(IpcChannels.booksRevokeReader, input),
  booksReaderFeatured: (input) => ipcRenderer.invoke(IpcChannels.booksReaderFeatured, input),
  booksSharedBooks: () => ipcRenderer.invoke(IpcChannels.booksSharedBooks),
  booksReadShared: (input) => ipcRenderer.invoke(IpcChannels.booksReadShared, input),
  booksReadOwnBook: (input) => ipcRenderer.invoke(IpcChannels.booksReadOwnBook, input),
  booksSetReadPosition: (input) => ipcRenderer.invoke(IpcChannels.booksSetReadPosition, input),
  booksMarkSharedRead: (input) => ipcRenderer.invoke(IpcChannels.booksMarkSharedRead, input),
  booksReadSharedImage: (input) => ipcRenderer.invoke(IpcChannels.booksReadSharedImage, input),
  booksExportMarkdown: (input) => ipcRenderer.invoke(IpcChannels.booksExportMarkdown, input),
  booksExportPdf: (input) => ipcRenderer.invoke(IpcChannels.booksExportPdf, input),
  booksExportEpub: (input) => ipcRenderer.invoke(IpcChannels.booksExportEpub, input),
  booksExportDocx: (input) => ipcRenderer.invoke(IpcChannels.booksExportDocx, input),
  booksImages: (input) => ipcRenderer.invoke(IpcChannels.booksImages, input),
  booksGenerateImage: (input) => ipcRenderer.invoke(IpcChannels.booksGenerateImage, input),
  booksGetImage: (input) => ipcRenderer.invoke(IpcChannels.booksGetImage, input),
  booksDeleteImage: (input) => ipcRenderer.invoke(IpcChannels.booksDeleteImage, input),
  booksUploadPhoto: (input) => ipcRenderer.invoke(IpcChannels.booksUploadPhoto, input),
  booksAnalyzePhoto: (input) => ipcRenderer.invoke(IpcChannels.booksAnalyzePhoto, input),
  booksAnswerPhoto: (input) => ipcRenderer.invoke(IpcChannels.booksAnswerPhoto, input),
  booksPhotoAnswers: (input) => ipcRenderer.invoke(IpcChannels.booksPhotoAnswers, input),
  booksSuggestPlacement: (input) => ipcRenderer.invoke(IpcChannels.booksSuggestPlacement, input),
  booksSetPlacement: (input) => ipcRenderer.invoke(IpcChannels.booksSetPlacement, input),
  booksRemovePlacement: (input) => ipcRenderer.invoke(IpcChannels.booksRemovePlacement, input),
  booksInviteContribution: (input) =>
    ipcRenderer.invoke(IpcChannels.booksInviteContribution, input),
  booksRevokeContributionInvite: (input) =>
    ipcRenderer.invoke(IpcChannels.booksRevokeContributionInvite, input),
  booksMyInvitations: () => ipcRenderer.invoke(IpcChannels.booksMyInvitations),
  booksContributionInvites: (input) =>
    ipcRenderer.invoke(IpcChannels.booksContributionInvites, input),
  booksSubmitContribution: (input) =>
    ipcRenderer.invoke(IpcChannels.booksSubmitContribution, input),
  booksWithdrawContribution: (input) =>
    ipcRenderer.invoke(IpcChannels.booksWithdrawContribution, input),
  booksMyContributions: () => ipcRenderer.invoke(IpcChannels.booksMyContributions),
  booksBookContributions: (input) => ipcRenderer.invoke(IpcChannels.booksBookContributions, input),
  booksDecideContribution: (input) =>
    ipcRenderer.invoke(IpcChannels.booksDecideContribution, input),
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
  togetherSayLinesState: (input) => ipcRenderer.invoke(IpcChannels.togetherSayLinesState, input),
  togetherSayLines: (input) => ipcRenderer.invoke(IpcChannels.togetherSayLines, input),
  togetherStarLine: (input) => ipcRenderer.invoke(IpcChannels.togetherStarLine, input),
  togetherUnstarLine: (input) => ipcRenderer.invoke(IpcChannels.togetherUnstarLine, input),
  onSayLinesProgress: (listener) => {
    const handler = (_event: unknown, progress: unknown): void =>
      listener(progress as Parameters<typeof listener>[0]);
    ipcRenderer.on(IpcChannels.togetherSayLinesProgress, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.togetherSayLinesProgress, handler);
    };
  },
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
  assignmentsDismiss: (assignmentId) =>
    ipcRenderer.invoke(IpcChannels.assignmentsDismiss, assignmentId),
  assignmentsCorrectFact: (input) => ipcRenderer.invoke(IpcChannels.assignmentsCorrectFact, input),
  assignmentsApplyProfileFix: (input) =>
    ipcRenderer.invoke(IpcChannels.assignmentsApplyProfileFix, input),
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
  onDreamChunk: (listener) => onStreamChunk('dream', listener),
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
  onIntakeChunk: (listener) => onStreamChunk('intake', listener),
  onTogetherChunk: (listener) => onStreamChunk('together', listener),
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
