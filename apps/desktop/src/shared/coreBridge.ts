import { z } from 'zod';
import {
  ANTHROPIC_API_KEY_ID,
  MIN_OWNER_PIN_LENGTH,
  OPENAI_API_KEY_ID,
  type AccessView,
  type AttachmentRef,
  type BudgetState,
  type ChatTurnResult,
  type ClaudeTestResult,
  type ConversationMeta,
  type RewindResult,
  type IntakeRewindOutcome,
  type KeyRotateResult,
  type RotationStatus,
  type VaultSyncReadiness,
  type DreamApproveResult,
  type DreamImageResult,
  type DreamNarrativeResult,
  type DreamReflectionResult,
  type DreamSharedImage,
  type AppPlatform,
  type DreamShareResult,
  type DreamSynthesisResult,
  type GuidanceState,
  type GuidedSuggestResult,
  type HouseholdStatus,
  type InviteSummary,
  type SelfosBridge,
  type SetActiveResult,
  type SettingsValues,
  type StreamChunkMap,
  type StreamSurface,
  type UsageSummary,
} from './channels';
import {
  APP_GLOBAL_NOTIFICATION_KEYS,
  AiProviderSchema,
  AnswerSchema,
  AnswerTypeSchema,
  AttachmentRefSchema,
  AutoCheckinTargetSchema,
  type AutoCheckinBlocks,
  type AutoCheckinConfig,
  type AutoCheckinRunResult,
  type IncomingAutoCheckinStream,
  BudgetSchema,
  ChallengeDomainSchema,
  ChallengeOutcomeSchema,
  ChallengeStatusSchema,
  DreamAnalysisEditsSchema,
  DreamInputSchema,
  GoalStatusSchema,
  PersonInputSchema,
  PersonNotificationStateSchema,
  QuestionnaireInputSchema,
  RelationshipInputSchema,
  RoleSchema,
  SensitivityTierSchema,
  SessionStatusSchema,
  SettingsFileSchema,
  conversationStatus,
  effectiveGoalStatus,
  ProactivityLevelSchema,
  type CoachingPrefs,
  type CoachingSynthesis,
  type CoachingSynthesisResult,
  type RelationshipSynthesis,
  type RelationshipSynthesisResult,
  type AiKeyStatus,
  type AlignmentResult,
  type DeviceView,
  type Assignment,
  type CompatibilityGroup,
  type CompatibilityMember,
  type CompatibilitySendResult,
  type CompatibilityVisibility,
  type CompatResultPublish,
  type ContextOnlyResult,
  type InAppSendResult,
  type RelayResult,
  type InboxAssignmentDetail,
  type InboxCompatibilityView,
  type InboxItem,
  type Goal,
  type GoalSuggestResult,
  type Challenge,
  type ChallengeCheckInResult,
  type ChallengeSuggestion,
  type ChallengeSuggestionResult,
  type Insight,
  type MemoryReconcileResult,
  type MemoryReconcileState,
  type OutboundSharing,
  IntakeAnswerValueSchema,
  PersonFieldKeySchema,
  EmailFamilySchema,
  EmailSendInputSchema,
  isEmailableTransactionalKind,
  type EmailActivityEntry,
  type EmailPrefs,
  type EmailReconcileResult,
  type EmailResponse,
  type EmailSendResult,
  type EmailStatus,
  type EmailVerifyResult,
  type IntimacyInventoryOffer,
  type MutualGreenLight,
  type EmailContentSnapshot,
  type OwnerEmailActivityEntry,
  RelationshipTypeSchema,
  type RelationshipType,
  type IntakeState,
  type ProfileUpdateSuggestion,
  type IntakeSynthesisResult,
  type IntakeTurnResult,
  type PrivacyMode,
  type QuestionTrend,
  type QuestionnaireAggregate,
  type Role,
  type RelayLinkResult,
  type SendAnswer,
  type SendResult,
  type AssignmentStatus,
  type QuestionnaireSendState,
  type QuestionnaireSentOverview,
  type SentRecipientSummary,
  type QuestionnaireAnalyzeResult,
  type QuestionnaireGenerateResult,
  type QuestionnaireImproveResult,
  CORRECTABLE_PROFILE_FIELDS,
  type FactCorrectionOutcome,
  type QuestionnaireSuggestResult,
  type SavedSuggestion,
  type SavedSuggestionsResult,
  type BootState,
  type Budget,
  type Conversation,
  type DeviceState,
  type DeviceStatePatch,
  type Dream,
  type DreamAnalysis,
  type DreamInput,
  type DreamPatternStats,
  type DreamPatternSummary,
  type DreamPatternWindow,
  type DreamShareTarget,
  type Person,
  type PersonNotificationState,
  type AnswersUpdatedSummary,
  type ReminderDueSummary,
  type ResponsesArrivedSummary,
  type Questionnaire,
  type Relationship,
  type RelayConfig,
  type RelayStatus,
  type SessionCost,
  type SessionSummaryResult,
  type TestResult,
  type UpdateCheckResult,
  TogetherCreateInputSchema,
  TogetherSetPausedInputSchema,
  TogetherMarkReadInputSchema,
  type TogetherSession,
  type TogetherSessionSummary,
  type TogetherSessionView,
  type TogetherParticipant,
  type TogetherCreateResult,
  type TogetherTurnResult,
  TogetherSendMessageInputSchema,
  TogetherRetryInputSchema,
  TogetherRewindInputSchema,
  TogetherPrepOpenSchema,
  TogetherStoreAttachmentSchema,
  TogetherGetAttachmentSchema,
  type Agreement,
  type TogetherCatalogEntry,
  type TogetherReportView,
  type TogetherWrapUpResult,
  type TogetherYnmStatus,
  type TogetherYnmOverlap,
  type TogetherPulseView,
  type TogetherSuggestion,
  TogetherYnmInputSchema,
  TogetherPulseLogInputSchema,
  TogetherWrapUpInputSchema,
  TogetherGetReportInputSchema,
  TogetherSaveAgreementInputSchema,
  TogetherSetAgreementStatusInputSchema,
  type AgreementSummary,
  StoryCreateInputSchema,
  StoryAskGapInputSchema,
  StoryBookRefSchema,
  StorySetQuoteStatusInputSchema,
  StoryResolveContinuityInputSchema,
  StorySetConsentInputSchema,
  StoryChapterRefSchema,
  StoryChapterVersionInputSchema,
  StoryMemoryRefSchema,
  StoryMemoryOpenInputSchema,
  StoryMemoryTurnInputSchema,
  StoryMemorySaveInputSchema,
  StoryMemoryRewindInputSchema,
  StoryMemoryStoreAttachmentInputSchema,
  StoryMemoryGetAttachmentInputSchema,
  StoryExportInputSchema,
  StoryGenerateImageInputSchema,
  StoryImageRefSchema,
  StoryUploadPhotoInputSchema,
  StoryPhotoAnswerInputSchema,
  StoryImagePlacementRefSchema,
  StorySetPlacementInputSchema,
  StoryEditPassageInputSchema,
  StoryExcludeInputSchema,
  StoryMarkInputSchema,
  StoryOutlineInputSchema,
  StoryPinInputSchema,
  StoryInterviewCheckInputSchema,
  StoryReadSharedInputSchema,
  StoryReadSharedImageInputSchema,
  StorySetReadPositionInputSchema,
  StoryReaderGrantInputSchema,
  StoryRefreshInputSchema,
  StoryRemoveMarkInputSchema,
  StoryOutlineEditInputSchema,
  StoryResolveProposalInputSchema,
  StoryTimelineEditInputSchema,
  StoryTodoToQuestionsInputSchema,
  StoryAnswerQuestionInputSchema,
  StoryUnexcludeInputSchema,
  StoryUpdateInputSchema,
  StoryUpdateMarkInputSchema,
  type BookManifest,
  type BookReader,
  type ChapterMarkup,
  type ChapterVersion,
  type StoryChapterHistoryView,
  type StoryMemoryView,
  type StoryMemoryDetail,
  type StoryMemorySynthesisResult,
  type StoryMemorySaveResult,
  type ExclusionItem,
  type QuoteCandidate,
  type CastEntry,
  type ConsentPerson,
  type ContinuityFinding,
  type NewMaterialEntry,
  type StoryAcceptMaterialResult,
  type StoryContinuityResult,
  type MarkupMark,
  type SharedBookSummary,
  type StoryBookBundle,
  type BookShelfEntry,
  type StoryBookTypeView,
  type StoryChaptersResult,
  type StoryExcludeResult,
  type AiFailureReason,
  type StoryDraftProgress,
  type ImageGenProgress,
  type StoryFoundationsResult,
  type StoryQuestionsResult,
  type StoryAnswerResult,
  type StoryCompleteness,
  type StoryCorpusStats,
  type StoryOutlineEditResult,
  type StoryTimelineEditResult,
  type StoryTitlesResult,
  type StoryEssenceResult,
  type StoryHomeSignal,
  type StoryImageEntry,
  type StoryImageResult,
  type StoryPhotoAnalyzeResult,
  type StoryPhotoAnswer,
  type StoryPlacementSuggestResult,
  type StoryInterviewCadenceResult,
  type StoryGapsView,
  type StoryCheckInResult,
  type StoryAnsweredCheckIn,
  type StoryPublishResult,
  type StoryPublishDiff,
  type StoryUnpublishResult,
  type StoryReaderView,
  type StoryOwnBookView,
  type StoryRefreshViewResult,
  type StoryResolveProposalResult,
  type StoryRevisionResult,
  type StoryTodoList,
  type StructuralProposal,
} from './schemas';
import { OWNER_ROLE_ID, roleAllows, type CapabilityKey } from './capabilities';
import { runConnectionTest } from './claudeProxy';
import { runOpenAiConnectionTest } from './openaiProxy';
import {
  deployRelay,
  teardownRelay,
  updateRelay,
  type FetchLike,
  type RelayBundle,
} from './relay/cloudflareDeployer';
import { createRelayHttpClient } from './relay/relayHttpClient';
import {
  clearRelayConfig,
  readRelayConfig,
  relayStatusOf,
  writeRelayConfig,
} from './relay/relayConfig';
import type {
  ClaudeClient,
  EmailClient,
  FileSystem,
  ImageClient,
  SecretStore,
} from '@selfos/core/host';
import type { AssertMainOwnedHandled } from '@selfos/core/rebuild-guard';
import { uuid } from '@selfos/core/id';
import {
  aiKeyStatus as computeAiKeyStatus,
  clearSharedKey,
  readAiCredentials,
  resolveAiKey,
  resolveOpenAiKey,
  writeSharedKey,
} from '@selfos/core/ai';
import { settingWriteNeedsAdmin } from './settingsPolicy';
import {
  createMasterKey,
  isVaultInitialized,
  loadMasterKey,
  MASTER_KEY_ID,
  readRotationJournal,
  restoreFromRecoveryPhrase,
  resumeRotation,
  rotateMasterKey,
  RotationError,
  storeMasterKey,
  VAULT_ALREADY_INITIALIZED,
} from '@selfos/core/crypto';
import {
  cancelInvite,
  createInvite,
  defaultDeviceLabel,
  deletePerson,
  deleteRelationship,
  ensureMemberAccounts,
  applyScopeBatch,
  getAccessConfig,
  getAccessView,
  getPerson,
  listDevices,
  MAX_SCOPE_BATCH_TARGETS,
  listInvitesForPerson,
  listOutboundSharing,
  listPeople,
  listRelatedPeople,
  listRelationships,
  redeemInvite,
  relationshipTypesFromSubjectToViewer,
  registerThisDevice,
  removeAccount,
  renameDevice,
  savePerson,
  saveRole,
  setAccount,
  upsertPerson,
  upsertRelationship,
  verifyAccountPin,
  ageFromBirthday,
} from '@selfos/core/people';
import {
  checkBudget,
  DEFAULT_BUDGET,
  effectivePersonBudget,
  getBudgets,
  periodStart,
  queryUsage,
  rollupSessionCosts,
  setAppBudget,
  setPersonBudget,
  summarize,
} from '@selfos/core/usage';
import {
  acknowledgeAdult,
  conversationAttachmentsDir,
  deleteConversation,
  endAndSummarize,
  getConversation,
  getConversationAttachment,
  getGuidancePrefs,
  getGuidanceState,
  isConversationAttachmentPath,
  listConversations,
  regenerateFrom,
  retryReply,
  rewindConversation,
  runChatTurn,
  saveConversation,
  setSessionStatus,
  startChallenge,
  startChallengeReflection,
  startGuided,
  storeConversationAttachment,
  suggestGuidedSessions,
} from '@selfos/core/conversations';
import {
  createSession as createTogetherSession,
  digestFor,
  getReport as getTogetherReport,
  getSession as getTogetherSession,
  getTogetherAttachment,
  getTogetherGuide,
  guideStepFor,
  togetherCatalogFor,
  togetherGuideView,
  allAdultAcknowledged,
  getYnmOptIn,
  setYnmOptIn,
  ynmOverlapFor,
  buildPulseView,
  logPulseCheckIn,
  reapTogetherForPerson,
  withdrawSession as withdrawTogetherSession,
  listJointChallenges,
  type JointChallengeStatus,
  listSuggestions,
  pairKeyFor,
  isReportStale,
  isTogetherAttachmentPath,
  dedupeAgreements,
  getAgreement,
  listAgreements,
  listDoneAgreementsForViewer,
  listStandingAgreementsForViewer,
  listMessages as listTogetherMessages,
  listSessionsForPerson as listTogetherSessionsForPerson,
  listStates as listTogetherStates,
  messageOwningAttachment,
  openPrepConversation,
  runTogetherWrapUp,
  saveAgreement,
  projectMessages as projectTogetherMessages,
  removeMessagesFrom,
  retryTogetherReply,
  runTogetherTurn,
  storeTogetherAttachment,
  togetherAttachmentsDir,
  updateState as updateTogetherState,
} from '@selfos/core/together';
import { sniffImageMime } from '@selfos/core/media';
import { readImagePrefs, readFeatureImagePrefs, setFeatureImagePrefs } from '@selfos/core/images';
import type { FeatureImagePrefs } from '@selfos/core/schemas';
import {
  backfillPartnerSharing,
  deleteInsight,
  flagInsightFact,
  listAllInsights,
  listInsightsForPerson,
  listMergeProposals,
  listRelatedShareableInsights,
  reapOrphanShares,
  reconcileInsights,
  resolveMergeProposal,
  retroTagLegacyPortraits,
  shouldAutoReconcile,
  updateInsight,
} from '@selfos/core/insights';
import {
  buildQuestionnaireDeliveryEmail,
  buildTransactionalEmail,
  buildWelcomeEmail,
  clearSharedResendKey,
  computeMutualGreenLights,
  editEmailResponse,
  emailStatusOf,
  applyIntimacyInventoryOffer,
  listAllEmailActivity,
  getEmailContent,
  listEmailActivity,
  listEmailResponses,
  listIntimacyInventoryOffers,
  readEmailPrefs,
  reconcileEmailSchedule,
  resolveResendKey,
  scheduleQuestionnaireReminder,
  sendFamilyEmail,
  sendQuestionnaireDeliveryEmail,
  sendTransactionalEmail,
  setEmailPrefs,
  updateEmailConfig,
  writeSharedResendKey,
  RECONCILE_THROTTLE_MS,
} from '@selfos/core/email';
import {
  createGoal,
  deleteGoal,
  listGoals,
  setGoalStatus,
  suggestGoals,
  updateGoal,
} from '@selfos/core/goals';
import {
  addExclusion,
  addMark,
  applyFoundations,
  answerAuthorQuestion,
  applyMarkup,
  approveOutline,
  createBook,
  deleteBook,
  rewriteBookFromScratch,
  editPassage,
  generateBookChapters,
  generateChapter,
  generateFoundations,
  getBook,
  getBookType,
  getChapter,
  getChapterHistory,
  getExclusions,
  getMarkup,
  getQuotes,
  getTodos,
  listBookTypes,
  mineQuoteCandidates,
  setQuoteStatus,
  listBooks,
  listShelf,
  clearNewMaterial,
  finishEdition,
  reopenBook,
  declineNewMaterial,
  detectNewMaterial,
  getNewMaterial,
  mintTodoCheckIn,
  resolveSentQuestionTodos,
  bookMentionsReader,
  buildDraftDocx,
  buildDraftEpub,
  buildDraftHtml,
  buildDraftMarkdown,
  buildPublishedDocx,
  buildPublishedEpub,
  buildPublishedHtml,
  buildPublishedMarkdown,
  addPhotoAnswer,
  addUploadedPhoto,
  analyzeStoryPhoto,
  suggestImagePlacement,
  setImagePlacement,
  removeImagePlacement,
  computeStoryHomeSignal,
  askGap,
  readManuscript,
  BOOK_TASK_MODELS,
  deleteStoryImage,
  exportFileStem,
  generateStoryImage,
  getPhotoAnswers,
  getStoryCompleteness,
  getCastRegister,
  getConsentRegister,
  setConsentEntry,
  checkContinuity,
  listContinuityFindings,
  resolveContinuityFinding,
  lineEditChapter,
  getStoryCorpusStats,
  getStoryGaps,
  getStoryImage,
  getStoryImageIndex,
  grantReader,
  listAnsweredStoryCheckIns,
  listChapters,
  listReaders,
  listSharedBooks,
  listStructuralProposals,
  computePublishDiff,
  pinPassage,
  publishBook,
  unpublishBook,
  reapReadReceiptsAbout,
  readBookBundle,
  readSharedBook,
  readOwnBook,
  readSharedImage,
  refreshBook,
  removeExclusion,
  resolveProposal,
  revokeReader,
  writeReadReceipt,
  runStoryInterviewCadence,
  removeMark,
  restoreChapterVersion,
  saveChapter,
  saveOutline,
  countWords,
  updateBook,
  updateMark,
  listMemoryViews,
  getMemory,
  getMemoryConversation,
  openMemoryChat,
  runMemoryTurn,
  retryMemoryReply,
  rewindMemoryConversation,
  regenerateMemoryFrom,
  synthesizeMemory,
  saveMemory,
  deleteMemory,
  storeMemoryAttachment,
  getMemoryAttachment,
  type StoreMemoryAttachmentResult,
  addChapter,
  addPart,
  deleteChapter,
  deletePart,
  mergeChapters,
  moveChapter,
  renameChapter,
  renamePart,
  splitChapter,
  addTimelineEvent,
  getTimeline,
  removeTimelineEvent,
  sortTimeline,
  updateTimelineEvent,
  regenerateEssence,
  suggestTitles,
} from '@selfos/core/story';
import {
  clearSuggestion,
  deleteChallenge,
  getChallenge,
  getSuggestion,
  listChallenges,
  recordCheckIn,
  seedGoalFromChallenge,
  setChallengeStatus,
  snoozeCheckIn,
  suggestChallenge,
} from '@selfos/core/challenges';
import {
  aggregateCrisisSignal,
  countNewInsights,
  getCoachingPrefs,
  getDailyReflectionEnabled,
  getProactivity,
  getRelationshipSynthesis,
  getSynthesis,
  setCoachingPrefs,
  shouldSynthesize,
  synthesize,
  synthesizeRelationship,
  type GoalRaiseGoal,
} from '@selfos/core/coaching';
import {
  autoCheckinSentActivity,
  type AutoCheckinStreamActivity,
  getAutoCheckinBlocks,
  getAutoCheckinConfig,
  listIncomingAutoCheckinStreams,
  runAutoCheckins,
  seedDefaultConfigIfAbsent,
  setAutoCheckinBlock,
  setAutoCheckinConfig,
} from '@selfos/core/auto-checkins';
import {
  addCustomType,
  analyzeAssignment,
  attachRelayLink,
  readRelayLink,
  buildQuestionTrends,
  buildQuestionnaireAggregate,
  type AggregateSend,
  compatibilityDisclosure,
  createAssignment,
  createCompatibilitySend,
  writeCompatibilityMember,
  declineAssignment,
  deleteQuestionnaireImage,
  deleteSend,
  dismissAssignmentForRecipient,
  distillContextOnly,
  formatAnswerForDisplay,
  formatResponseAnswers,
  generateAlignment,
  generateVariant,
  getAlignmentReport,
  getCompatibilityGroup,
  createRelaySend,
  drainRelaySend,
  buildDedupReference,
  externalSendDisclosure,
  garbageCollectImages,
  gatherRecipientHistory,
  gatherRecipientAskedPrompts,
  gatherRecipientPriorAnswers,
  gatherRecipientInsightFacts,
  gatherRecipientQuestionnaireTitles,
  gatherRecipientFeedbackGuidance,
  gatherRecipientPinnedLabels,
  gatherRecipientTopicMaterial,
  gatherRecipientPartnerContext,
  generateQuestions,
  groundSummary,
  backfillAskLedger,
  refreshCoverage,
  refreshNextCandidates,
  markCandidateAsked,
  readProfile,
  writeProfile,
  readCoverageView,
  steerTopic,
  curateCandidate,
  clearCandidateFeedAndRead,
  addPartnerWishAndRead,
  removePartnerWishAndRead,
  buildPartnerWishGuidance,
  type QuestionnaireCoverageView,
  type CoverageSteerInput,
  type CandidateCurateInput,
  type AddPartnerWishInput,
  resolveInsightAbout,
  resolveInsightSource,
  getAssignment,
  getAssignmentSnapshot,
  getQuestionnaire,
  getQuestionnaireImage,
  correctSnapshotQuestion,
  replaceQuestion,
  saveResponse,
  getResponse,
  improveQuestion,
  sharpenQuestion,
  resolveFactCorrection,
  type KnownFact,
  isAllowedImageMime,
  isAnswerable,
  listAssignments,
  listCoveredTopics,
  markCoveredTopic,
  listCustomTypes,
  isAnalysisStale,
  listQuestionnaires,
  MAX_IMAGE_BYTES,
  openAssignment,
  publishRelayResult,
  reopenAssignment,
  purgeQuestionnaire,
  revokeRelayForDeletion,
  revokeRelaySend,
  saveProgress,
  saveQuestionnaire,
  storeQuestionnaireImage,
  submitResponse,
  suggestQuestionnaires,
  listSavedSuggestions,
  accumulateSavedSuggestions,
  deleteSavedSuggestion,
  validateQuestionnaire,
  setFavorite,
  buildResultsExport,
  exportMimeType,
  type AiDeps,
  type ExportSend,
  type TrendSend,
} from '@selfos/core/questionnaires';
import {
  approveAnalysis,
  approvePatternNarrative,
  deleteDreamImage,
  generateDreamImage,
  generatePatternNarrative,
  getAnalysis,
  getDream,
  getDreamConversation,
  getDreamImage,
  getDreamInsight,
  getSharedDreamImage,
  listImagesSharedWith,
  setDreamImageShare,
  getPatternStats,
  getPatternSummary,
  listDreams,
  listDreamShareTargets,
  deleteDream,
  openReflection,
  removeFromContext,
  regenerateDreamFrom,
  removePatternNarrativeFromContext,
  retryDreamReply,
  rewindDreamConversation,
  runAnalysisTurn,
  saveDream,
  setDreamFactShare,
  synthesizeAnalysis,
  updateAnalysis,
} from '@selfos/core/dreams';
import {
  ensureIntakeSession,
  type CoveredAct,
  formatIntakeForGeneration,
  getIntakeSection,
  getIntakeSession,
  intakeSectionMeta,
  regenerateIntakeFrom,
  retryIntakeTurn,
  rewindIntakeSection,
  runIntakeTurn,
  setIntakeAnswerSharing,
  skipIntakeSection,
  submitSectionForm,
  synthesizeIntake,
} from '@selfos/core/intake';
import {
  deleteAllResults,
  deleteResult,
  getTest,
  listResults,
  listTestSummaries,
  narrateResult,
  registerTestContextProvider,
  normalizeTestSummary,
  takeTest,
  testForm,
  type ScoreAnswers,
  type TestForm,
  type TestNarrateResponse,
  type TestSummary,
} from '@selfos/core/tests';
import {
  acceptSuggestion,
  dismissSuggestion,
  listPendingSuggestions,
  unfilledInvitedSections,
} from '@selfos/core/profile';
import { fromBase64, toBase64 } from '@selfos/core/encoding';

/**
 * The platform-agnostic SelfOS bridge factory (07-mobile-platform §5.3, slice iii-b1). The renderer
 * only ever talks to a `SelfosBridge` (`window.selfos`); this factory implements the ~30 vault-data
 * operations **once**, over an injected `BridgeHost` of platform primitives. Both hosts use it:
 *
 * - **Electron:** `ipc.ts` builds a node-backed `BridgeHost`, calls `createCoreBridge`, and wraps each
 *   data method in an `ipcMain.handle` delegate; the preload exposes the same `SelfosBridge` shape.
 * - **iOS (Capacitor):** an in-webview host wires the primitives to native plugins; the renderer calls
 *   this bridge directly (no IPC).
 *
 * This module must stay **node/electron-free** — the web build imports it. Inputs from the (untrusted)
 * renderer are Zod-validated here so the trust boundary holds on both platforms.
 */

// Register the test-profile context provider into 08's registry (50 §5.5) so questionnaire generation +
// the gap-finder pull self-assessment profiles automatically. Idempotent by id (the built-ins register on
// their own module load, before this runs since this module imports them).
registerTestContextProvider();

export interface BridgeHost {
  // --- Vault access ---
  /** The active vault's `FileSystem` + decrypted master key, or null when not unlocked / not set up. */
  vaultAndKey(): Promise<{ fs: FileSystem; key: Uint8Array } | null>;
  /** The active vault path, or null when none is selected. */
  vaultPath(): Promise<string | null>;
  /** A `FileSystem` rooted at a vault path — for setup/unlock/settings flows that run without a key. */
  fileSystem(vaultPath: string): FileSystem;
  /** Device-local secret store (master key, API key). */
  secrets: SecretStore;
  /** Streaming Claude client. */
  claude: ClaudeClient;
  /** Image-generation client (OpenAI second provider, 13-dream-images §5.1). */
  image: ImageClient;
  /** Email sender (Resend, 67-email-engagement §5.1). Faked under `SELFOS_FAKE_RESEND`. */
  email: EmailClient;

  // --- Device-local state ---
  readDeviceState(): Promise<DeviceState>;
  updateDeviceState(patch: DeviceStatePatch): Promise<DeviceState>;
  /** Device-scoped settings (`key → value`); device-local, separate from the synced vault settings. */
  readDeviceSettings(): Promise<Record<string, unknown>>;
  writeDeviceSettings(values: Record<string, unknown>): Promise<void>;

  // --- Misc ---
  /** The model to use for AI calls (the host reads its own model preference + default). */
  activeModel(): Promise<string>;
  /** The app version string (About section). */
  appVersion: string;
  /** The host platform — drives the titlebar's window-control layout (02-app-shell §13). */
  platform: AppPlatform;

  // --- Relay (external delivery, 08-questionnaires §5.2/§5.4) ---
  /** Relay host surface: outbound `fetch` (Cloudflare REST + Worker) + the built Worker bundle to deploy. */
  relay: {
    fetch: FetchLike;
    /** The built relay Worker (`apps/relay/dist/worker.js`) + its version, read host-side. */
    loadBundle(): Promise<RelayBundle>;
    /** The app's current bundled relay version (drives the "update available" check). */
    currentVersion: string;
  };

  // --- Streaming sink ---
  /**
   * Deliver a streamed reply chunk for one surface to the renderer (Electron → IPC event; iOS → in-webview
   * listener). ONE sink for every streamed surface (64 §15.3) — the surface key selects the payload type, so
   * a new streamed surface needs a line in `StreamChunkMap` and nothing here.
   */
  emitStreamChunk<K extends StreamSurface>(surface: K, chunk: StreamChunkMap[K]): void;
  /** Deliver a Your Story create-and-draft progress update to the renderer (64 §3.2, its own channel). */
  emitStoryProgress(progress: StoryDraftProgress): void;
  /** Deliver a single-image / vision generation phase update to the renderer (its own channel), so every
   *  image surface shows realtime progress (compose → render / analyze) instead of a bare spinner. */
  emitImageProgress(progress: ImageGenProgress): void;

  // --- Platform-specific surface, forwarded verbatim to the renderer-facing bridge ---
  getBootState(): Promise<BootState>;
  refreshBootState(): Promise<BootState>;
  selectVaultFolder(): Promise<string | null>;
  useVault(path: string): Promise<BootState>;
  getConflicts(): Promise<string[]>;
  /** Whether the active vault folder still has not-yet-downloaded iCloud items (33 §5.D). Best-effort. */
  hasPendingDownloads?(): Promise<boolean>;
  revealVault(): Promise<void>;
  /** Open an external URL in the user's browser (the renderer never opens URLs directly; 35 §3.4). */
  openExternal(url: string): Promise<void>;
  /**
   * Check for a newer published app version (36-update-awareness §5). The host owns the network call (the
   * public GitHub Releases API, no auth) + parsing; returns the distilled result, or `null` when the check
   * couldn't be made (offline / rate-limited / timeout). Faked under `SELFOS_FAKE_UPDATE` in the host.
   */
  checkForUpdate(): Promise<UpdateCheckResult | null>;
  /**
   * Save image bytes to a file the user chooses OUTSIDE the vault (13-dream-images §3.5) — a native save
   * dialog on Electron, a download on iOS/web. Returns the chosen path, or null if cancelled.
   */
  saveImageFile(suggestedName: string, bytes: Uint8Array, mime: string): Promise<string | null>;
  /**
   * Render a self-contained HTML document to PDF bytes (64-your-story §3.9) — Electron `printToPDF` on an
   * offscreen window. Returns null on a host that can't (web/iOS) so the caller degrades gracefully.
   */
  printToPdf(html: string): Promise<Uint8Array | null>;
  /** Subscribe to external vault changes (the host's watcher); returns an unsubscribe. */
  onVaultChanged(listener: () => void): () => void;
  /** Subscribe to one surface's streamed chunks; the counterpart to `emitStreamChunk`. A listener hears
   *  ONLY its own surface, so two live streams can never cross. */
  onStreamChunk<K extends StreamSurface>(
    surface: K,
    listener: (chunk: StreamChunkMap[K]) => void,
  ): () => void;
  /** Subscribe to Your Story draft-progress updates; the counterpart to `emitStoryProgress`. */
  onStoryProgress(listener: (progress: StoryDraftProgress) => void): () => void;
  /** Subscribe to image/vision generation phase updates; the counterpart to `emitImageProgress`. */
  onImageProgress(listener: (progress: ImageGenProgress) => void): () => void;
}

/** Vault-relative path of the plain-JSON, vault-scoped settings file (02-app-shell). */
const VAULT_SETTINGS_PATH = 'config/settings.json';

/**
 * Read the vault-scoped settings `key → value` map via the `FileSystem` host. Plain JSON (not
 * encrypted); falls back to an empty map on a missing or unparseable file. Exported so the Electron
 * host's `activeModel` can read the model preference without re-implementing the file handling.
 */
export async function readVaultSettingsValues(fs: FileSystem): Promise<Record<string, unknown>> {
  const bytes = await fs.read(VAULT_SETTINGS_PATH);
  if (!bytes) return {};
  try {
    return SettingsFileSchema.parse(JSON.parse(new TextDecoder().decode(bytes))).values;
  } catch {
    return {};
  }
}

async function writeVaultSettingsValues(
  fs: FileSystem,
  values: Record<string, unknown>,
): Promise<void> {
  const text = `${JSON.stringify({ schemaVersion: 1, values }, null, 2)}\n`;
  await fs.writeAtomic(VAULT_SETTINGS_PATH, new TextEncoder().encode(text));
}

const ScopeSchema = z.enum(['vault', 'device']);
const SetSettingSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  scope: ScopeSchema,
});
const ResetSettingSchema = z.object({ key: z.string().min(1), scope: ScopeSchema });
const SecretSetSchema = z.object({ id: z.string().min(1), value: z.string() });
const SecretIdSchema = z.object({ id: z.string().min(1) });
const AiProviderInputSchema = z.object({ provider: AiProviderSchema.default('anthropic') });
const AiSetSharedKeySchema = z.object({ provider: AiProviderSchema, value: z.string().min(1) });
const DevicesRenameSchema = z.object({
  deviceId: z.string().min(1),
  label: z.string().min(1).max(80),
});
const KeysRotateSchema = z.object({ revokeDeviceIds: z.array(z.string()).default([]) });
const HouseholdSetupSchema = z.object({
  ownerName: z.string().min(1),
  pin: z.string().min(MIN_OWNER_PIN_LENGTH),
});
const UnlockWithRecoveryPhraseSchema = z.object({ phrase: z.string().min(1) });
const SetAccountSchema = z.object({
  personId: z.string().min(1),
  roleId: z.string().min(1),
  pin: z.string().nullable().optional(),
});
const SetActiveSchema = z.object({ personId: z.string().min(1), pin: z.string().optional() });
const UsageSummarySchema = z.object({
  scope: z.enum(['person', 'app']),
  period: z.enum(['week', 'month']),
  personId: z.string().min(1).optional(),
});
// A conversation id is a renderer-minted uuid; restrict it to a safe path SEGMENT (no `/` or `..`) so a
// crafted id can't traverse out of the active person's vault tree when a file path is built from it (45 §6).
const ConversationIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid conversation id');
const ChatStreamSchema = z.object({
  conversationId: ConversationIdSchema,
  // Allow an empty string for an image-only message (45 §3.1) — at least text OR ≥1 attachment is required.
  userText: z.string(),
  // The per-message cap (~5, 45 §4.4) is re-enforced here — the renderer is not the trust boundary.
  attachments: z.array(AttachmentRefSchema).max(5).optional(),
});
const StoreAttachmentSchema = z.object({
  conversationId: ConversationIdSchema,
  base64: z.string().min(1),
  mime: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
});
const ConversationAttachmentRefSchema = z.object({
  conversationId: ConversationIdSchema,
  path: z.string().min(1),
});
const ChatConversationIdSchema = z.object({ conversationId: z.string().min(1) });
const StartGuidedSchema = z.object({ guideId: z.string().min(1) });
// Self-assessments (50). The answer value mirrors the questionnaire `Answer.value` union; `scoreTest` is
// total (clamps/omits bad cells) so loose validation is safe — we only need a record of answered questions.
const TestIdSchema = z.object({ testId: z.string().min(1) });
const TestResultRefSchema = z.object({ testId: z.string().min(1), resultId: z.string().min(1) });
const TestTakeSchema = z.object({
  testId: z.string().min(1),
  answers: z.record(z.string(), z.unknown()),
});
const SessionSetStatusSchema = z.object({
  conversationId: z.string().min(1),
  status: SessionStatusSchema,
});
/** 66 §3.3 — a rewind target: which message, plus the stamp core re-verifies before truncating. */
const RewindConversationSchema = z.object({
  conversationId: z.string().min(1),
  index: z.number().int().nonnegative(),
  expect: z.object({ role: z.enum(['user', 'assistant']), ts: z.string().min(1) }),
});
const RewindDreamSchema = z.object({
  dreamId: z.string().min(1),
  index: z.number().int().nonnegative(),
  expect: z.object({ role: z.enum(['user', 'assistant']), ts: z.string().min(1) }),
});
const RewindIntakeSchema = z.object({
  sectionId: z.string().min(1),
  index: z.number().int().nonnegative(),
  expect: z.object({ role: z.enum(['user', 'assistant']), ts: z.string().min(1) }),
});
const DreamAnalyzeTurnSchema = z.object({
  dreamId: z.string().min(1),
  userText: z.string().min(1),
});
const DreamIdSchema = z.object({ dreamId: z.string().min(1) });
const DreamUpdateAnalysisSchema = z.object({
  dreamId: z.string().min(1),
  edits: DreamAnalysisEditsSchema,
});
const DreamPatternWindowSchema = z.object({ window: z.enum(['30d', '90d', 'all']) });
const DreamSetFactShareSchema = z.object({
  dreamId: z.string().min(1),
  factId: z.string().min(1),
  withPersonId: z.string().min(1),
  share: z.boolean(),
});
const DreamGenerateImageSchema = z.object({
  dreamId: z.string().min(1),
});
const DreamSetImageShareSchema = z.object({
  dreamId: z.string().min(1),
  targetPersonId: z.string().min(1),
  shared: z.boolean(),
});
const DreamGetSharedImageSchema = z.object({
  dreamerId: z.string().min(1),
  dreamId: z.string().min(1),
});

/** A zeroed stats object — returned to a denied/unready `dreamPatternStats` caller (a read, never throws). */
function emptyPatternStats(window: DreamPatternWindow): DreamPatternStats {
  return {
    window,
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
  };
}
const PersonIdSchema = z.string().min(1);
const InvitePersonSchema = z.object({ personId: z.string().min(1) });
const InviteIdSchema = z.object({ id: z.string().min(1) });
const InviteCodeSchema = z.object({ code: z.string().min(1) });
const CompleteJoinSchema = z.object({ pin: z.string().min(MIN_OWNER_PIN_LENGTH) });
const RenameSchema = z.object({ id: z.string().min(1), title: z.string().min(1) });
const BudgetSetPersonSchema = z.object({
  personId: z.string().min(1),
  budget: BudgetSchema.nullable(),
});
const AssignmentsCreateSchema = z.object({
  questionnaireId: z.string().min(1),
  // No recipient here — it's bound to the questionnaire at creation (08 §17.3) and read from the def.
  privacy: z.enum(['standard', 'private']).optional(),
  senderVisibleToRecipient: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});
const StoreImageSchema = z.object({ base64: z.string().min(1), mime: z.string().min(1) });
const GenerateSchema = z.object({
  type: z.string().min(1),
  sensitivity: SensitivityTierSchema,
  brief: z.string().optional(),
  existingPrompts: z.array(z.string()),
  // The bound household recipient (08 §17.12) — the bridge auto-tailors to their shareable context AND de-dups
  // against their full history. The author never receives any of it. No separate "about a person" picker.
  recipientPersonId: z.string().min(1).optional(),
  // Intimacy draft format (08 §17.12-C): direct questions, described scenarios, or a mix.
  intimacyMode: z.enum(['questions', 'scenarios', 'mix']).optional(),
  // How many questions to draft (08 §23.4): 1–20; core defaults to 5 when omitted. maxTokens scales with it.
  count: z.number().int().min(1).max(20).optional(),
});
const ImproveSchema = z.object({
  prompt: z.string().min(1),
  type: AnswerTypeSchema,
  instruction: z.string().min(1),
});
// "Too vague → sharpen" (08 §28.2) — no free instruction; the wording lives in core.
const SharpenSchema = z.object({
  prompt: z.string().min(1),
  type: AnswerTypeSchema,
});
// "Already answered → replace" — record a covered topic for a recipient (08 §28.3).
const MarkCoveredSchema = z.object({
  recipientPersonId: z.string().min(1),
  note: z.string().min(1),
  sourcePrompt: z.string().optional(),
});
// A steer from the Explored panel (spec 69 §3.4) — own-scoped in the bridge.
const SteerTopicSchema = z.object({
  topicId: z.string().min(1),
  lifeArea: z.string().optional(),
  label: z.string().optional(),
  action: z.enum(['explore-more', 'leave-alone', 'clear']),
});
const CurateCandidateSchema = z.object({
  candidateId: z.string().min(1),
  action: z.enum(['ask', 'not-this', 'go-deeper', 'clear']),
});
/** The empty Explored view returned when the caller is denied / has no active person (a fresh literal each call). */
const emptyCoverageView = (): QuestionnaireCoverageView => ({
  candidates: [],
  areas: [],
  markedOff: [],
  partners: [],
  adultAcknowledged: false,
  hasPlacement: false,
});
const AddPartnerWishSchema = z.object({
  partnerPersonId: z.string().min(1),
  note: z.string().min(1).max(300),
  intimacy: z.boolean().optional(),
});
const RemovePartnerWishSchema = z.object({ wishId: z.string().min(1) });
// A recipient flagging a wrong fact in a question they're answering (spec 08 §29 wrong-fact amendment).
const CorrectFactSchema = z.object({
  assignmentId: z.string().min(1),
  questionId: z.string().min(1),
  correction: z.string().min(1).max(1000),
});

/**
 * Apply a proposed correction to the recipient's OWN profile field (08 §32.4).
 *
 * The field allowlist is the whole security story: it is exactly the set the correction flow reads to build
 * its candidate facts, so this can never be used to write anything else on the person — and it targets the
 * ACTIVE person only, so a member correcting their own birthday needs no `people.manage`.
 */
const ApplyProfileFixSchema = z
  .object({
    assignmentId: z.string().min(1),
    field: z.enum(CORRECTABLE_PROFILE_FIELDS),
    value: z.string().min(1).max(200),
  })
  // A birthday is parsed downstream (`ageFromBirthday`) and has NO editor for a subject (18 §14.6 moved it
  // to onboarding), so a malformed value would silently drop their age from every context with no way to
  // repair it. The model is asked for YYYY-MM-DD; enforce it at the boundary rather than trusting that.
  .refine((v) => v.field !== 'birthday' || isCalendarDate(v.value), {
    message: 'A birthday must be a real YYYY-MM-DD date.',
    path: ['value'],
  });

/** A strict YYYY-MM-DD that is also a REAL date (rejects 2026-02-31, which `new Date` would roll over). */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * The recipient's OWN on-record facts — what a wrong fact in a question could have come from (08 §29.2).
 *
 * Shared by the correction call (numbered for the model to match against) and the candidate picker (shown to
 * the recipient when the model couldn't match one), so the two can never drift out of sync.
 */
async function collectKnownFacts(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
): Promise<KnownFact[]> {
  const known: KnownFact[] = [];
  const person = await getPerson(fs, key, personId);
  if (person) {
    if (person.birthday) {
      const age = ageFromBirthday(person.birthday, now);
      known.push({
        source: 'profile',
        label: 'your birthday',
        text: age != null ? `age: ${age} (born ${person.birthday})` : `born ${person.birthday}`,
        field: 'birthday',
        currentValue: person.birthday,
      });
    }
    for (const [field, label, value] of [
      ['occupation', 'occupation', person.occupation],
      ['relationshipStatus', 'relationship status', person.relationshipStatus],
      ['parentalStatus', 'parental status', person.parentalStatus],
      ['location', 'location', person.location],
    ] as const) {
      if (value)
        known.push({
          source: 'profile',
          label: `your ${label}`,
          text: `${label}: ${value}`,
          field,
          currentValue: value,
        });
    }
  }
  // Only NON-flagged insight facts (a fact already flagged inaccurate no longer feeds generation).
  const insights = await listInsightsForPerson(fs, key, personId);
  for (const ins of insights) {
    for (const f of ins.facts) {
      if (f.flaggedInaccurate) continue;
      known.push({
        source: 'insight',
        label: 'your Memory',
        text: f.text,
        insightId: ins.id,
        factId: f.id,
      });
    }
  }
  // Onboarding is a single generic entry (the granular answers aren't listed here) — enough to route "this
  // came from my onboarding", which the panel turns into a prompt to fix it there.
  const session = await getIntakeSession(fs, key, personId);
  if (session) {
    known.push({
      source: 'onboarding',
      label: 'your onboarding answers',
      text: 'something you told SelfOS during onboarding',
    });
  }
  return known;
}
// Per-person image prefs patch (image-settings amendment): one feature, a partial of style/notes/toggle.
const ImagePrefsSetSchema = z.object({
  feature: z.enum(['dreams', 'story']),
  patch: z.object({
    enabled: z.boolean().optional(),
    style: z.string().min(1).optional(),
    styleNotes: z.string().max(300).optional(),
  }),
});
const SuggestSchema = z.object({ targetPersonId: z.string().min(1).optional() });
// Recipient-first saved suggestions (08 §18.5) — a household recipient, validated in the bridge.
const SavedSuggestionsSchema = z.object({ recipientPersonId: z.string().min(1) });
const SavedSuggestionDeleteSchema = z.object({
  recipientPersonId: z.string().min(1),
  suggestionId: z.string().min(1),
});
const AnalyzeSchema = z.object({ assignmentId: z.string().min(1) });
const CreateRelayLinkSchema = z.object({
  questionnaireId: z.string().min(1),
  // No recipient here — the external recipient is bound to the questionnaire at creation (08 §17.3); the
  // bridge reads name/email/phone from the def.
  privacy: z.enum(['standard', 'private']).optional(),
  senderVisibleToRecipient: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});
const RelayConnectSchema = z.object({
  apiToken: z.string().min(1),
  accountId: z.string().min(1),
});
const InsightFactInputSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  shareable: z.boolean(),
  // Relationship-type scope for the fact (42 §4.1 / 44 §3.4): the new Memory sharing control sets THIS
  // (with `shareable: false`) instead of broadcasting. Additive-optional; merged by id in `updateInsight`,
  // so an edit that omits it preserves the stored scope.
  shareableTypes: z.array(RelationshipTypeSchema).optional(),
  // The deliberate un-restrict of a person's OWN sensitive fact (42 §8 two-step / 44 §3.4): only ever sent
  // as `false` by the explicit "share this sensitive fact" action. A normal edit never carries it, so the
  // merge preserves a fact's `restricted` flag — it can only be lifted by this deliberate act on one's own fact.
  restricted: z.boolean().optional(),
});
const InsightEditSchema = z.object({
  subjectPersonId: z.string().min(1),
  id: z.string().min(1),
  summary: z.string().optional(),
  facts: z.array(InsightFactInputSchema).optional(),
});
const InsightIdSchema = z.object({ subjectPersonId: z.string().min(1), id: z.string().min(1) });
// Flag (or clear) a fact as inaccurate (20-memory-dashboard §3.6). `factId` omitted = the whole insight.
const InsightFlagSchema = z.object({
  insightId: z.string().min(1),
  factId: z.string().min(1).optional(),
  flagged: z.boolean(),
});
// Tracked goals (39-living-memory §6). All scoped to the active person in the handler (the trust boundary).
const GoalSetStatusSchema = z.object({ goalId: z.string().min(1), status: GoalStatusSchema });
const GoalUpdateSchema = z.object({
  goalId: z.string().min(1),
  text: z.string().optional(),
  due: z.string().optional(),
  horizon: z.string().optional(),
});
const GoalDeleteSchema = z.object({ goalId: z.string().min(1) });
const GoalCreateSchema = z.object({
  text: z.string().min(1),
  due: z.string().optional(),
  horizon: z.string().optional(),
  lifeArea: z.string().optional(),
});
// Challenges / experiments (52-challenge-sessions §6). All scoped to the active person in the handler.
const ChallengeStartSchema = z.object({ domain: ChallengeDomainSchema.optional() });
const ChallengeStartReflectionSchema = z.object({ challengeId: z.string().min(1) });
const ChallengeIdSchema = z.object({ challengeId: z.string().min(1) });
const ChallengeSetStatusSchema = z.object({
  challengeId: z.string().min(1),
  status: ChallengeStatusSchema,
});
const ChallengeCheckInSchema = z.object({
  challengeId: z.string().min(1),
  outcome: ChallengeOutcomeSchema,
  reflection: z.string().optional(),
});
const ChallengeSuggestSchema = z.object({ override: z.boolean().optional() });
// Proactive coaching (40 §6) — the per-person proactivity preference write.
const CoachingSetPrefsSchema = z.object({
  proactivity: ProactivityLevelSchema.optional(),
  dailyReflection: z.boolean().optional(),
});
// `auto` (renderer cadence) applies the throttle/threshold gate; absent/false = a manual force (still
// budget/key-gated, throttle bypassed).
const CoachingSynthesizeSchema = z.object({ auto: z.boolean().optional() });
// Auto check-ins (63 §6) — the config write + the run trigger.
const AutoCheckinSetConfigSchema = z.object({
  enabled: z.boolean().optional(),
  targets: z.array(AutoCheckinTargetSchema).optional(),
});
const AutoCheckinRunSchema = z.object({ auto: z.boolean().optional() });
const AutoCheckinSetBlockSchema = z.object({
  senderPersonId: z.string().min(1),
  blocked: z.boolean(),
});
const RelationshipSynthesizeSchema = z.object({ partnerPersonId: z.string().min(1) });
const ResolveProposalSchema = z.object({
  proposalId: z.string().min(1),
  action: z.enum(['merge', 'keepBoth']),
});
// Personal onboarding (18-personal-onboarding §6).
const IntakeRunTurnSchema = z.object({ sectionId: z.string().min(1), userText: z.string() });
const IntakeSectionIdSchema = z.object({ sectionId: z.string().min(1) });
const IntakeSynthesizeSchema = z.object({ sectionId: z.string().min(1).optional() });
const IntakeSubmitFormSchema = z.object({
  sectionId: z.string().min(1),
  answers: z.record(z.string(), IntakeAnswerValueSchema),
  // Per-question relationship-type sharing scopes (43 §6) — the trust boundary validates the types.
  sharing: z.record(z.string(), z.array(RelationshipTypeSchema)).optional(),
  // Auto-save passes `false` to persist a draft without completing the section (default complete).
  complete: z.boolean().optional(),
});
const IntakeSetAnswerSharingSchema = z.object({
  sectionId: z.string().min(1),
  questionId: z.string().min(1),
  types: z.array(RelationshipTypeSchema),
});
// 68-sharing-redesign §6 — the per-category bulk scope change. Bounded (`MAX_SCOPE_BATCH_TARGETS`) so a
// caller can't rescope thousands at once.
const SetScopeBatchSchema = z.object({
  types: z.array(RelationshipTypeSchema),
  factTargets: z
    .array(z.object({ insightId: z.string().min(1), factId: z.string().min(1) }))
    .max(MAX_SCOPE_BATCH_TARGETS),
  answerTargets: z
    .array(z.object({ sectionId: z.string().min(1), questionId: z.string().min(1) }))
    .max(MAX_SCOPE_BATCH_TARGETS),
});
// 68-sharing-redesign §6 — the own-scoped profile-field lock toggle.
const SetProfileFieldSharedSchema = z.object({
  field: PersonFieldKeySchema,
  shared: z.boolean(),
});
// 67-email-engagement §6 — email config + prefs inputs.
const EmailSetConfigSchema = z.object({
  sendingDomain: z.string().optional(),
  fromAddress: z.string().optional(),
  fromName: z.string().optional(),
});
const EmailSetSharedKeySchema = z.object({ value: z.string().min(1) });
const EmailSetPrefsSchema = z.object({
  address: z.string().optional(),
  families: z.record(EmailFamilySchema, z.boolean()).optional(),
  richness: z.enum(['brief', 'full']).optional(),
  intimacyEmailOptIn: z.boolean().optional(),
  paused: z.boolean().optional(),
  digestDay: z.number().int().min(0).max(6).optional(),
  digestTime: z.enum(['morning', 'afternoon', 'evening']).optional(),
});
const EmailActivitySchema = z.object({
  personId: z.string().optional(),
  family: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
const EmailSendQuestionnaireDeliverySchema = z.object({
  toAddress: z.string(),
  subject: z.string(),
  message: z.string(),
  link: z.string(),
  assignmentId: z.string().optional(),
});
const EmailSendTransactionalSchema = z.object({
  kind: z.string(),
  sourceKey: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(400).optional(),
});
const EmailReconcileSchema = z.object({ auto: z.boolean().optional() });
const EmailEditResponseSchema = z.object({ id: z.string().min(1), answer: z.string() });
const EmailIntimacyOfferSchema = z.object({ actKey: z.string().min(1) });
const EmailContentInputSchema = z.object({ personId: z.string().min(1), id: z.string().min(1) });
const ProfileSuggestionIdSchema = z.string().min(1);
const AssignmentIdSchema = z.string().min(1);
const QuestionnaireIdSchema = z.string().min(1);
const AnswersSchema = z.object({
  assignmentId: z.string().min(1),
  answers: z.array(AnswerSchema),
});
const DeclineSchema = z.object({
  assignmentId: z.string().min(1),
  note: z.string().optional(),
});
const CompatibilityCreateSchema = z.object({
  // Compatibility is always the sender + the bound recipient (08 §17.12-B) — both derived from the
  // questionnaire, so no participant ids are passed.
  questionnaireId: z.string().min(1),
});
const GroupIdSchema = z.string().min(1);

/**
 * Mint a FRESH relay link + PIN for an existing, already-validated shareable send (08 §17.14a/c): revoke the
 * old mailbox, derive the disclosure (compat vs external), re-upload. Shared by `assignmentsReshare` (by id)
 * and `questionnairesShareLink` (the latest send of a questionnaire). Returns null if the upload fails.
 */
async function reshareLink(
  fs: FileSystem,
  key: Uint8Array,
  client: ReturnType<typeof createRelayHttpClient>,
  endpointUrl: string,
  assignment: Assignment,
): Promise<RelayLinkResult | null> {
  if (assignment.relay) await revokeRelayForDeletion(fs, key, client, assignment.id);
  const senderName =
    (await getPerson(fs, key, assignment.senderPersonId))?.displayName ?? 'Someone';
  const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
  const compat = snapshot?.compatibility;
  const disclosure = compat?.enabled
    ? compatibilityDisclosure(compat.visibility, {
        otherParticipantName: senderName,
        senderName,
        viewerIsSender: false,
      })
    : externalSendDisclosure(
        assignment.senderVisibleToRecipient ? senderName : 'the person who sent this',
        assignment.privacy,
      );
  try {
    return await attachRelayLink(fs, key, client, assignment.id, {
      senderName,
      senderVisibleToRecipient: assignment.senderVisibleToRecipient,
      disclosure,
      endpointUrl,
    });
  } catch {
    // Mint failed after the old mailbox was revoked: the send keeps its stale relay; the user can retry.
    return null;
  }
}

/**
 * Load the relay Worker bundle to deploy, refusing one whose version doesn't match the app's own
 * `RELAY_VERSION` (08 §17.14c). The bundle is a BUILT artifact (`apps/relay/dist`), so a dev tree whose
 * `pnpm --filter @selfos/relay build` predates a version bump holds an older Worker than the app expects.
 * Deploying it "succeeds" while shipping routes the app no longer speaks — the Relay panel then still
 * reads "an older version" right after an Update that reported nothing wrong, and calls like
 * `/api/admin/drainTaps` keep 404ing. Fail loudly with the fix instead of silently redeploying stale code.
 */
async function loadDeployableRelayBundle(relay: BridgeHost['relay']): Promise<RelayBundle> {
  const bundle = await relay.loadBundle();
  if (bundle.version !== relay.currentVersion) {
    throw new Error(
      `The built relay Worker is version ${bundle.version}, but this app expects ${relay.currentVersion}. ` +
        'Rebuild it first: pnpm --filter @selfos/relay build',
    );
  }
  return bundle;
}

/** Build the renderer-facing `SelfosBridge` from a platform `BridgeHost`. */
export function createCoreBridge(host: BridgeHost): SelfosBridge {
  const activePersonId = async (): Promise<string | null> =>
    (await host.readDeviceState()).activePersonId ?? null;

  // One-time sharing backfill guard (owner decision, 2026-07-17 — all insights default to shared-with-
  // partner). Runs the idempotent `backfillPartnerSharing` once per person per process on the first Memory
  // read; the persisted result makes any later run a no-op, so this just avoids re-scanning each load.
  const partnerShareBackfilled = new Set<string>();

  const ensurePartnerShareBackfill = async (
    fs: FileSystem,
    key: Uint8Array,
    personId: string,
  ): Promise<void> => {
    if (partnerShareBackfilled.has(personId)) return;
    partnerShareBackfilled.add(personId);
    try {
      await backfillPartnerSharing(fs, key, personId);
    } catch {
      // A backfill failure must never block reading Memory; drop the guard so a later load retries.
      partnerShareBackfilled.delete(personId);
    }
  };

  /** The active person's role (from the access config), or null. */
  const activePersonRole = async (fs: FileSystem, key: Uint8Array): Promise<Role | null> => {
    const personId = await activePersonId();
    if (!personId) return null;
    const access = await getAccessConfig(fs, key);
    const account = access.accounts.find((candidate) => candidate.personId === personId);
    return access.roles.find((candidate) => candidate.id === account?.roleId) ?? null;
  };

  /**
   * Whether the active person's role grants a capability — enforces admin-only actions in the bridge (the
   * trust boundary). The Owner is the full-access role (the concealed super-admin was removed 2026-06-15).
   */
  const activePersonCan = async (
    fs: FileSystem,
    key: Uint8Array,
    capability: CapabilityKey,
  ): Promise<boolean> => {
    return roleAllows((await activePersonRole(fs, key)) ?? undefined, capability);
  };

  /** Whether the active person is the household Owner (the full-access role). */
  const activePersonIsOwner = async (fs: FileSystem, key: Uint8Array): Promise<boolean> =>
    (await activePersonRole(fs, key))?.id === OWNER_ROLE_ID;

  // The device registry (32-device-management §5.2): register/heartbeat this device into the vault on each
  // join path + once per app launch. The key-free `deviceId` is generated once + cached device-local.
  let deviceHeartbeatDone = false;
  const ensureDeviceRegistered = async (fs: FileSystem, key: Uint8Array): Promise<void> => {
    const device = await host.readDeviceState();
    let deviceId = device.deviceId;
    let deviceLabel = device.deviceLabel;
    if (!deviceId) {
      deviceId = uuid();
      deviceLabel = defaultDeviceLabel(host.platform);
      await host.updateDeviceState({ deviceId, deviceLabel });
    }
    await registerThisDevice(fs, key, {
      deviceId,
      label: deviceLabel ?? defaultDeviceLabel(host.platform),
      platform: host.platform,
      now: new Date(),
      activePersonId: device.activePersonId ?? null,
    });
  };

  // ── Together (58) access helpers — the trust boundary is here, not the renderer (§5.2) ─────────────
  // Every read/write authorizes by `together.own` + participant membership + a LIVE `partner` edge to
  // every other participant, re-checked on each call (deleting the edge instantly re-gates everything).

  /** Whether the active person has a live `partner` edge to every one of `otherIds` (order-independent). */
  const togetherEdgeLive = async (
    fs: FileSystem,
    key: Uint8Array,
    viewerId: string,
    otherIds: string[],
  ): Promise<boolean> => {
    const rels = await listRelationships(fs, key);
    return otherIds.every((oid) =>
      relationshipTypesFromSubjectToViewer(viewerId, oid, rels).includes('partner'),
    );
  };

  /** The YNM readiness status a viewer sees for a partner (§3.10b) — never reveals the partner's inventory. */
  const ynmStatusFor = async (
    fs: FileSystem,
    key: Uint8Array,
    personId: string,
    partnerPersonId: string,
  ): Promise<TogetherYnmStatus> => {
    const edgeLive = await togetherEdgeLive(fs, key, personId, [partnerPersonId]);
    const youAcked = (await getGuidancePrefs(fs, key, personId)).adultAcknowledged === true;
    const acked = await allAdultAcknowledged(fs, key, [personId, partnerPersonId]);
    const eligible = edgeLive && acked;
    const pairKey = pairKeyFor(personId, partnerPersonId);
    const [youOptedIn, partnerOptedIn] = await Promise.all([
      getYnmOptIn(fs, key, personId, pairKey),
      getYnmOptIn(fs, key, partnerPersonId, pairKey),
    ]);
    return {
      youAcked,
      eligible,
      youOptedIn,
      partnerOptedIn,
      ready: eligible && youOptedIn && partnerOptedIn,
    };
  };

  /** ctx + active person, gated on `together.own`. Null if not ready or not allowed (surface is hidden). */
  const togetherCtx = async (): Promise<{
    fs: FileSystem;
    key: Uint8Array;
    personId: string;
  } | null> => {
    const ctx = await host.vaultAndKey();
    const personId = ctx ? await activePersonId() : null;
    if (!ctx || !personId) return null;
    if (!(await activePersonCan(ctx.fs, ctx.key, 'together.own'))) return null;
    return { fs: ctx.fs, key: ctx.key, personId };
  };

  /** A session the active person may access — membership + live edge — else null (§5.2). */
  const accessibleTogetherSession = async (
    fs: FileSystem,
    key: Uint8Array,
    personId: string,
    id: string,
  ): Promise<TogetherSession | null> => {
    const session = await getTogetherSession(fs, key, id);
    if (!session || !session.participantIds.includes(personId)) return null;
    const others = session.participantIds.filter((p) => p !== personId);
    return (await togetherEdgeLive(fs, key, personId, others)) ? session : null;
  };

  const togetherParticipants = async (
    fs: FileSystem,
    key: Uint8Array,
    session: TogetherSession,
  ): Promise<TogetherParticipant[]> => {
    const out: TogetherParticipant[] = [];
    for (const pid of session.participantIds) {
      out.push({
        personId: pid,
        displayName: (await getPerson(fs, key, pid))?.displayName ?? 'Someone',
      });
    }
    return out;
  };

  /** Build the viewer's list summary — every derived field over their projection (§5.2). */
  const buildTogetherSummary = async (
    fs: FileSystem,
    key: Uint8Array,
    session: TogetherSession,
    viewerId: string,
    now: Date,
  ): Promise<TogetherSessionSummary> => {
    const states = await listTogetherStates(fs, key, session.id);
    const messages = await listTogetherMessages(fs, key, session.id);
    // Only an EXPLICIT wrap-up (`report.wrappedUp`) marks the session `complete`; a mid-session "reflect"
    // checkpoint writes a report WITHOUT `wrappedUp`, so it never ends the session (58 §3.8).
    const report = await getTogetherReport(fs, key, session.id);
    const wrappedUpAt = report?.wrappedUp ? (report.wrappedUpAt ?? report.updatedAt) : null;
    const digest = digestFor(session, states, wrappedUpAt, messages, viewerId, now);
    return {
      id: session.id,
      pairKey: session.pairKey,
      ...(session.topic ? { topic: session.topic } : {}),
      ...(session.guideId ? { guideId: session.guideId } : {}),
      initiatorPersonId: session.initiatorPersonId,
      participants: await togetherParticipants(fs, key, session),
      status: digest.status,
      yourTurn: digest.yourTurn,
      readyToWrapUp: digest.readyToWrapUp,
      unreadCount: digest.unreadCount,
      ...(digest.lastMessageSnippet !== undefined
        ? { lastMessageSnippet: digest.lastMessageSnippet }
        : {}),
      ...(digest.lastMessageAt !== undefined ? { lastMessageAt: digest.lastMessageAt } : {}),
      ...(digest.lastPrivateCoachAt !== undefined
        ? { lastPrivateCoachAt: digest.lastPrivateCoachAt }
        : {}),
      createdAt: session.createdAt,
    };
  };

  /** The full viewer-projected session view (summary + projected messages + the viewer's own ack flag). */
  const buildTogetherView = async (
    fs: FileSystem,
    key: Uint8Array,
    session: TogetherSession,
    viewerId: string,
    now: Date,
  ): Promise<TogetherSessionView> => {
    const summary = await buildTogetherSummary(fs, key, session, viewerId, now);
    const states = await listTogetherStates(fs, key, session.id);
    const messages = await listTogetherMessages(fs, key, session.id);
    // A guided couples session (§3.10): resolve the guide meta + DERIVE the current step from the newest coach
    // message that declared one (never stored on session.enc). The stepper renders from these.
    const guide = togetherGuideView(session.guideId);
    return {
      ...summary,
      messages: projectTogetherMessages(messages, viewerId),
      viewerAcked: Boolean(states.get(viewerId)?.rulesAckAt),
      ...(guide ? { guide } : {}),
      ...(guide?.kind === 'structured' ? { guideStep: guideStepFor(messages) } : {}),
    };
  };

  /**
   * Map a core turn outcome → the renderer-facing `TogetherTurnResult`. On BUDGET, honesty is asymmetric
   * (§6.2): the INITIATOR sees their own standard budget message; the non-initiator gets a NEUTRAL,
   * session-scoped notice — no ratio, no `$`, no naming of whose budget. On success, the refreshed view.
   */
  const togetherTurnResult = async (
    fs: FileSystem,
    key: Uint8Array,
    session: TogetherSession,
    viewerId: string,
    outcome: { ok: true } | { ok: false; reason: string; message: string },
  ): Promise<TogetherTurnResult> => {
    if (outcome.ok) {
      return { ok: true, view: await buildTogetherView(fs, key, session, viewerId, new Date()) };
    }
    if (outcome.reason === 'BUDGET') {
      const message =
        viewerId === session.initiatorPersonId
          ? outcome.message
          : 'AI replies are paused for this session until next period.';
      return { ok: false, reason: 'BUDGET', message };
    }
    const reason: 'NO_KEY' | 'EMPTY' | 'ERROR' =
      outcome.reason === 'NO_KEY' || outcome.reason === 'EMPTY' ? outcome.reason : 'ERROR';
    return { ok: false, reason, message: outcome.message };
  };

  const AI_KEY_IDS = { anthropic: ANTHROPIC_API_KEY_ID, openai: OPENAI_API_KEY_ID } as const;

  /**
   * Auto-share (25 §5.6): mirror the active owner's device-local AI keys into the vault-shared credentials
   * so member devices inherit them with NO manual step — the fix for the recurring "AI not set up on a
   * member's shared vault" trap (a device-local key + a synced `ai.enabled` left members locked out). Runs
   * only for an owner (`settings.manage`), only when the `ai.shareCredentials` opt-out is not off, and is
   * idempotent — a provider already shared is skipped, so it costs nothing on repeat boots. Best-effort.
   */
  const ensureSharedAiCredentials = async (fs: FileSystem, key: Uint8Array): Promise<void> => {
    if (!(await activePersonCan(fs, key, 'settings.manage'))) return;
    if ((await readVaultSettingsValues(fs))['ai.shareCredentials'] === false) return;
    const creds = await readAiCredentials(fs, key);
    const sharedByPersonId = (await activePersonId()) ?? undefined;
    for (const provider of ['anthropic', 'openai'] as const) {
      const already = provider === 'anthropic' ? creds?.anthropicApiKey : creds?.openaiApiKey;
      if (already) continue;
      const deviceKey = await host.secrets.get(AI_KEY_IDS[provider]);
      if (!deviceKey) continue;
      await writeSharedKey(fs, key, {
        provider,
        value: deviceKey,
        ...(sharedByPersonId ? { sharedByPersonId } : {}),
        now: new Date(),
      });
    }
  };

  /**
   * Assemble the full author-blind known-data for a household recipient (08 §19.1/§24.3): the recipient history
   * (profile + insight facts + already-asked prompts), the RAW onboarding answers (incl. the intimacy-matrix act
   * ratings), the RAW answers to prior questionnaires (§24.3-A1), and the set of intimacy acts already rated.
   * All host-side; never returned to the author.
   */
  const recipientKnownData = async (
    fs: FileSystem,
    key: Uint8Array,
    recipientPersonId: string,
    /** The active person (author) — reads their per-recipient covered-topic notes (08 §28.3). */
    authorId: string,
  ): Promise<{
    history: string;
    coveredActs: CoveredAct[];
    askedPrompts: string[];
    dedupReference: string;
    /** The author's "already covered" topic notes for this recipient (08 §28.3) — fed to the gap-finder's
     *  avoid-list by the caller, so the TOPIC selector won't re-pick a marked-done area under a new title. */
    coveredNotes: string[];
    /** Differentiated avoid/boundary/reword steering from the recipient's Personalization Profile — how the
     *  app learns from their prior skips/declines (spec 69 §5.9). */
    feedbackGuidance: string;
    /** Partner-shared context — ONLY for a self-send (author == recipient): the facts people close to them
     *  shared TO them, so a self check-in can personalize + reciprocate (spec 69 §5.4). Restricted never
     *  crosses (the `scopeGrants` gate). Empty for an other-person send. */
    partnerContext: string;
    /** Ground the person explicitly pinned ("Ask me this") — leads the spec-71 planner. */
    pinnedLabels: string[];
    /** The recipient's own material (spec 71 §5.2) — re-opens worked ground it actually speaks to. */
    newMaterial: { at: string; text: string }[];
  }> => {
    const history = await gatherRecipientHistory(fs, key, recipientPersonId);
    const pinnedLabels = await gatherRecipientPinnedLabels(fs, key, recipientPersonId);
    const newMaterial = await gatherRecipientTopicMaterial(fs, key, recipientPersonId);
    // The recipient's skip/decline steering (spec 69) — read host-side, fed to the model to avoid what they
    // said doesn't apply / would rather not, and to reword what landed unclear.
    const recipientFeedback = await gatherRecipientFeedbackGuidance(fs, key, recipientPersonId);
    // "Explore with your partner" (spec 70 §3.5) — when the AUTHOR sends to a partner, silently fold in the
    // author's OWN wishes about the recipient (never quoted/attributed; live-edge + both-18+-acked gated inside
    // `buildPartnerWishGuidance`). Never for a self-send (that's the partnerContext reciprocity path above).
    const partnerWishGuidance =
      recipientPersonId === authorId
        ? ''
        : await buildPartnerWishGuidance(
            fs,
            key,
            authorId,
            recipientPersonId,
            await allAdultAcknowledged(fs, key, [authorId, recipientPersonId]),
          );
    const feedbackGuidance = [recipientFeedback, partnerWishGuidance]
      .filter((s) => s.trim() !== '')
      .join('\n\n');
    // Partner-shared context (spec 69 §5.4) — ONLY when the author is generating for THEMSELVES (a self check-in),
    // so a partner's shared desire can be reflected back. Never for an other-person send (that'd surface a third
    // party's context to the author). Restricted facts are excluded by the gate regardless.
    const partnerContext =
      recipientPersonId === authorId
        ? (await gatherRecipientPartnerContext(fs, key, recipientPersonId)).contextBlock
        : '';
    // The structured already-asked prompts (08 §23.5) drive the deterministic hard near-dup filter in core.
    const priorPrompts = await gatherRecipientAskedPrompts(fs, key, recipientPersonId);
    // §24.3-A1/A2: the recipient's RAW prior-questionnaire answers + all distilled insight facts (sessions,
    // dreams, tests, Together) — so the semantic pass can catch a re-ask of ANY of them, not just onboarding.
    const priorAnswers = await gatherRecipientPriorAnswers(fs, key, recipientPersonId);
    const insightFacts = await gatherRecipientInsightFacts(fs, key, recipientPersonId);
    const session = await getIntakeSession(fs, key, recipientPersonId);
    const intake = session
      ? formatIntakeForGeneration(session)
      : {
          text: '',
          coveredActs: [] as CoveredAct[],
          prompts: [] as string[],
        };
    // The author's explicit "already covered" notes for this recipient (08 §28.3) — the strongest de-dup
    // signal there is; fed into the reference below + returned for the gap-finder's avoid-list.
    const coveredTopics = await listCoveredTopics(fs, key, authorId, recipientPersonId);
    const coveredNotes = coveredTopics.map((t) => t.note);
    // The generation SOFT grounding (the whole blob) — onboarding appended, as before.
    const combined = [
      history,
      intake.text.trim() ? `What they have already answered in onboarding:\n${intake.text}` : '',
    ]
      .filter((s) => s.trim() !== '')
      .join('\n\n');
    // The SEMANTIC-PASS reference (08 §23.5b/§24.3-A2/A3): a DEDICATED, per-section-budgeted digest of the
    // "already have data for this" material, so a huge onboarding can't truncate away the prior-questionnaire
    // answers or insight facts (Track A's whole point). Uses the SHARED `buildDedupReference` — the ONE
    // budgeting rule the auto-checkin engine + Your Story's biographer also call, so the three can't drift.
    const dedupReference = buildDedupReference({
      intakeText: intake.text,
      priorAnswers,
      insightFacts,
      priorPrompts,
      // §28.3 — the author's marked-done topics lead the reference (strongest, most deliberate signal).
      ...(coveredNotes.length ? { coveredTopics: coveredNotes } : {}),
    });
    // The hard near-dup FILTER list: prior questionnaire prompts, the answered onboarding question prompts, AND
    // the prompts of questions the author marked "already answered" (§28.3) — so a re-ask of any is dropped
    // deterministically too.
    const coveredPrompts = coveredTopics
      .map((t) => t.sourcePrompt)
      .filter((p): p is string => Boolean(p));
    const askedPrompts = [...priorPrompts, ...intake.prompts, ...coveredPrompts];
    return {
      history: combined,
      coveredActs: intake.coveredActs,
      askedPrompts,
      dedupReference,
      coveredNotes,
      feedbackGuidance,
      partnerContext,
      pinnedLabels,
      newMaterial,
    };
  };

  /**
   * Best-effort revoke of the relay links for the sends matching `predicate`, before a deletion purges
   * them (§3.9). No-op if no relay is configured; a relay that's unreachable doesn't block the delete —
   * the mailbox expires on its own (§11.3).
   */
  const revokeRelayLinks = async (
    fs: FileSystem,
    key: Uint8Array,
    predicate: (assignment: Assignment) => boolean,
  ): Promise<void> => {
    const config = await readRelayConfig(fs, key);
    if (!config) return;
    const client = createRelayHttpClient(config.endpointUrl, config.drainSecret, host.relay.fetch);
    for (const assignment of await listAssignments(fs, key, {})) {
      if (assignment.relay && predicate(assignment)) {
        await revokeRelayForDeletion(fs, key, client, assignment.id);
      }
    }
  };

  /** Build the deps for an AI authoring call, gated by `capability`; null if not permitted. */
  const aiUnavailableTitleMessage = 'Connect Claude in Settings → AI to use the title workshop.';
  const aiDeps = async (
    capability: CapabilityKey = 'questionnaires.create',
  ): Promise<AiDeps | null> => {
    const ctx = await host.vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, capability))) return null;
    const personId = await activePersonId();
    if (!personId) return null;
    return {
      fs: ctx.fs,
      key: ctx.key,
      client: host.claude,
      apiKey: (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
      model: await host.activeModel(),
      // Every book pass runs on the most capable model regardless of the app-wide setting (72 §5.3) — a
      // book is the one artifact where the model's literary judgment IS the product. Keyed by usage type,
      // so a non-book call's type isn't in the map and keeps the person's own choice.
      models: BOOK_TASK_MODELS,
      personId,
      now: new Date(),
    };
  };

  /** The sender's display name for the recipient — null when the send is anonymous (§3.2). */
  const senderNameFor = async (
    fs: FileSystem,
    key: Uint8Array,
    assignment: Assignment,
  ): Promise<string | null> => {
    if (!assignment.senderVisibleToRecipient) return null;
    const sender = await getPerson(fs, key, assignment.senderPersonId);
    return sender?.displayName ?? null;
  };

  /** A send's recipient display name (person → their name; external → its displayName or "External"). */
  const recipientDisplayName = async (
    fs: FileSystem,
    key: Uint8Array,
    assignment: Assignment,
  ): Promise<string> =>
    assignment.recipient.kind === 'person'
      ? ((await getPerson(fs, key, assignment.recipient.personId))?.displayName ?? 'Unknown')
      : (assignment.recipient.displayName ?? 'External');

  /**
   * Resolve an assignment the active person is **allowed to answer** — they hold `questionnaires.answer`
   * AND are the in-app person recipient. Returns null otherwise, so a non-recipient can never read or
   * mutate someone else's send. The renderer isn't the trust boundary; this enforcement lives here.
   */
  const recipientAssignment = async (
    assignmentId: string,
  ): Promise<{ fs: FileSystem; key: Uint8Array; assignment: Assignment } | null> => {
    const ctx = await host.vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.answer'))) return null;
    const personId = await activePersonId();
    if (!personId) return null;
    const assignment = await getAssignment(ctx.fs, ctx.key, assignmentId);
    if (
      !assignment ||
      assignment.recipient.kind !== 'person' ||
      assignment.recipient.personId !== personId
    ) {
      return null;
    }
    return { fs: ctx.fs, key: ctx.key, assignment };
  };

  /** Assemble the renderer-facing intake state (§6): the resumable session + catalog meta + availability. */
  const buildIntakeState = async (
    fs: FileSystem,
    key: Uint8Array,
    personId: string,
  ): Promise<IntakeState> => {
    const session = await ensureIntakeSession(fs, key, personId, new Date());
    const apiKey = (await resolveAiKey(host.secrets, fs, key)).key ?? null;
    const aiEnabled = (await readVaultSettingsValues(fs))['ai.enabled'] === true;
    const prefs = await getGuidancePrefs(fs, key, personId);
    return {
      session,
      sections: intakeSectionMeta(),
      aiAvailable: Boolean(apiKey) && aiEnabled,
      adultAcknowledged: prefs.adultAcknowledged === true,
    };
  };

  /** A benign, non-nudging intake state for an unpermitted / signed-out caller (renderer renders nothing). */
  const emptyIntakeState = (personId: string): IntakeState => ({
    session: {
      id: 'none',
      schemaVersion: 1,
      personId,
      status: 'complete',
      sections: [],
      startedAt: '',
      updatedAt: '',
    },
    sections: intakeSectionMeta(),
    aiAvailable: false,
    adultAcknowledged: false,
  });

  return {
    // --- Platform-specific (forwarded to the host) ---
    getBootState: () => host.getBootState(),
    refreshBootState: () => host.refreshBootState(),
    selectVaultFolder: () => host.selectVaultFolder(),
    useVault: (path) => host.useVault(path),
    getConflicts: () => host.getConflicts(),
    vaultSyncReadiness: async (): Promise<VaultSyncReadiness> => {
      // Sync-safety (33 §5.D): if the chosen folder has NO recovery.enc but still has pending iCloud
      // downloads, "absent marker" may just mean "not downloaded yet" — warn instead of routing to Setup.
      const ctx = await host.vaultPath();
      if (!ctx) return { ready: true };
      const fs = host.fileSystem(ctx);
      if (await isVaultInitialized(fs)) return { ready: true }; // initialized → Unlock, never Setup
      const pending = host.hasPendingDownloads ? await host.hasPendingDownloads() : false;
      return pending ? { ready: false, reason: 'icloud-pending' } : { ready: true };
    },
    revealVault: () => host.revealVault(),
    onVaultChanged: (listener) => host.onVaultChanged(listener),
    // The renderer-facing API is unchanged (§15.3) — five named subscriptions, now thin delegations over
    // the one surface-keyed channel, so no store/component/test had to move for the collapse.
    onChatChunk: (listener) => host.onStreamChunk('chat', listener),
    onDreamChunk: (listener) => host.onStreamChunk('dream', listener),
    onIntakeChunk: (listener) => host.onStreamChunk('intake', listener),
    onTogetherChunk: (listener) => host.onStreamChunk('together', listener),
    onMemoryChunk: (listener) => host.onStreamChunk('memory', listener),
    onStoryProgress: (listener) => host.onStoryProgress(listener),
    onImageProgress: (listener) => host.onImageProgress(listener),
    platform: host.platform,
    // iOS/web have no OS window chrome, so there is no fullscreen-titlebar transition to report.
    onFullscreenChanged: () => () => {},
    getAppVersion: () => Promise.resolve(host.appVersion),

    // --- Settings ---
    getSettings: async (): Promise<SettingsValues> => {
      const vaultDir = await host.vaultPath();
      const vault = vaultDir ? await readVaultSettingsValues(host.fileSystem(vaultDir)) : {};
      return { vault, device: await host.readDeviceSettings() };
    },
    setSetting: async (input): Promise<void> => {
      const { key, value, scope } = SetSettingSchema.parse(input);
      // Trust boundary (26): a vault-scoped (household-wide) or admin-only setting write requires
      // `settings.manage` — enforced here, not just hidden in the UI.
      if (settingWriteNeedsAdmin(key, scope)) {
        const ctx = await host.vaultAndKey();
        if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
          throw new Error('Not permitted');
        }
      }
      if (scope === 'device') {
        await host.writeDeviceSettings({ ...(await host.readDeviceSettings()), [key]: value });
        return;
      }
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return;
      const fs = host.fileSystem(vaultDir);
      await writeVaultSettingsValues(fs, { ...(await readVaultSettingsValues(fs)), [key]: value });
      // Toggling household key-sharing takes effect immediately (25 §5.6): turning it ON shares the owner's
      // current device keys; turning it OFF withdraws them from the vault (members fall back to their own).
      if (key === 'ai.shareCredentials') {
        const liveKey = await loadMasterKey(host.secrets);
        if (liveKey) {
          if (value === true) await ensureSharedAiCredentials(fs, liveKey);
          else if (value === false && (await activePersonCan(fs, liveKey, 'settings.manage'))) {
            await clearSharedKey(fs, liveKey, { provider: 'anthropic', now: new Date() });
            await clearSharedKey(fs, liveKey, { provider: 'openai', now: new Date() });
          }
        }
      }
    },
    resetSetting: async (input): Promise<void> => {
      const { key, scope } = ResetSettingSchema.parse(input);
      if (settingWriteNeedsAdmin(key, scope)) {
        const ctx = await host.vaultAndKey();
        if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
          throw new Error('Not permitted');
        }
      }
      if (scope === 'device') {
        const values = { ...(await host.readDeviceSettings()) };
        delete values[key];
        await host.writeDeviceSettings(values);
        return;
      }
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return;
      const fs = host.fileSystem(vaultDir);
      const values = { ...(await readVaultSettingsValues(fs)) };
      delete values[key];
      await writeVaultSettingsValues(fs, values);
    },

    // --- Secrets + Claude ---
    secretSet: async (input): Promise<void> => {
      const { id, value } = SecretSetSchema.parse(input);
      await host.secrets.set(id, value);
      // Auto-share an AI key to the household by default (25 §5.6): when an OWNER saves a Claude/OpenAI key
      // and sharing isn't opted out, mirror it into the vault so members inherit it with no extra step. A
      // member's own-key override is device-local only (the settings.manage guard skips non-owners).
      if (id === ANTHROPIC_API_KEY_ID || id === OPENAI_API_KEY_ID) {
        const ctx = await host.vaultAndKey();
        if (ctx && (await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
          if ((await readVaultSettingsValues(ctx.fs))['ai.shareCredentials'] !== false) {
            const sharedByPersonId = (await activePersonId()) ?? undefined;
            await writeSharedKey(ctx.fs, ctx.key, {
              provider: id === ANTHROPIC_API_KEY_ID ? 'anthropic' : 'openai',
              value,
              ...(sharedByPersonId ? { sharedByPersonId } : {}),
              now: new Date(),
            });
          }
        }
      }
    },
    secretHas: async (input): Promise<boolean> => {
      return host.secrets.has(SecretIdSchema.parse(input).id);
    },
    secretClear: async (input): Promise<void> => {
      await host.secrets.clear(SecretIdSchema.parse(input).id);
    },
    claudeTest: async (): Promise<ClaudeTestResult> => {
      // Test the *resolved* key (device override → vault-shared → device-only when no vault), 25 §6.3.
      const ctx = await host.vaultAndKey();
      const apiKey = ctx
        ? ((await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null)
        : await host.secrets.get(ANTHROPIC_API_KEY_ID);
      return runConnectionTest(host.claude, apiKey, await host.activeModel());
    },
    openaiTest: async (): Promise<ClaudeTestResult> => {
      // Verify the *resolved* OpenAI key (override → shared, 25 §6.3) with a non-generative probe — never an
      // image generation, so it bills nothing (33 §5.B). The key stays host-side.
      const ctx = await host.vaultAndKey();
      const apiKey = ctx
        ? ((await resolveOpenAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null)
        : await host.secrets.get(OPENAI_API_KEY_ID);
      return runOpenAiConnectionTest(host.image, apiKey);
    },

    // --- Household AI credentials (25-household-ai-credentials) ---
    // Readiness — booleans + an enum only, never a key value (§5.3). Ungated (a self-readiness read, like
    // secretHas); the value never leaves the bridge.
    aiKeyStatus: async (input): Promise<AiKeyStatus> => {
      const { provider } = AiProviderInputSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      if (!ctx) {
        const hasDeviceOverride = await host.secrets.has(
          provider === 'anthropic' ? ANTHROPIC_API_KEY_ID : OPENAI_API_KEY_ID,
        );
        return {
          hasSharedKey: false,
          hasDeviceOverride,
          resolvedReady: hasDeviceOverride,
          source: hasDeviceOverride ? 'device' : 'none',
        };
      }
      return computeAiKeyStatus(host.secrets, ctx.fs, ctx.key, provider);
    },
    // Owner-only writes to the shared household key (§6.2). Gated on `settings.manage` in the bridge — the
    // trust boundary is here, not the UI (coordinates with spec 30).
    aiSetSharedKey: async (input): Promise<void> => {
      const { provider, value } = AiSetSharedKeySchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
        throw new Error('Not permitted');
      }
      const sharedByPersonId = (await activePersonId()) ?? undefined;
      await writeSharedKey(ctx.fs, ctx.key, {
        provider,
        value,
        ...(sharedByPersonId ? { sharedByPersonId } : {}),
        now: new Date(),
      });
    },
    // Promote the owner's existing device key into the vault (the §5.4 migration) — reads the device secret
    // host-side; no key value crosses IPC inbound. No-op if no device key exists.
    aiShareDeviceKey: async (input): Promise<void> => {
      const { provider } = AiProviderInputSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
        throw new Error('Not permitted');
      }
      const deviceKey = await host.secrets.get(
        provider === 'anthropic' ? ANTHROPIC_API_KEY_ID : OPENAI_API_KEY_ID,
      );
      if (!deviceKey) return;
      const sharedByPersonId = (await activePersonId()) ?? undefined;
      await writeSharedKey(ctx.fs, ctx.key, {
        provider,
        value: deviceKey,
        ...(sharedByPersonId ? { sharedByPersonId } : {}),
        now: new Date(),
      });
    },
    aiClearSharedKey: async (input): Promise<void> => {
      const { provider } = AiProviderInputSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
        throw new Error('Not permitted');
      }
      await clearSharedKey(ctx.fs, ctx.key, { provider, now: new Date() });
    },

    // --- Devices (32-device-management) — owner-only, enforced in the bridge ---
    devicesList: async (): Promise<DeviceView[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'devices.manage'))) return [];
      const device = await host.readDeviceState();
      const [records, people] = await Promise.all([
        listDevices(ctx.fs, ctx.key),
        listPeople(ctx.fs, ctx.key),
      ]);
      const nameOf = (id?: string | null): string | null =>
        id ? (people.find((p) => p.id === id)?.displayName ?? null) : null;
      return records.map((r) => ({
        deviceId: r.deviceId,
        label: r.label,
        platform: r.platform,
        createdAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
        isThisDevice: r.deviceId === device.deviceId,
        lastActivePersonName: nameOf(r.lastActivePersonId),
      }));
    },
    devicesRename: async (input): Promise<void> => {
      const { deviceId, label } = DevicesRenameSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'devices.manage'))) {
        throw new Error('Not permitted');
      }
      await renameDevice(ctx.fs, ctx.key, deviceId, label);
      const device = await host.readDeviceState();
      if (device.deviceId === deviceId) await host.updateDeviceState({ deviceLabel: label });
    },
    // Whole-vault key rotation (32 §5.3/§6.4) — owner-only, sync-aware pre-flight, returns the NEW phrase once.
    keysRotate: async (input): Promise<KeyRotateResult> => {
      const { revokeDeviceIds } = KeysRotateSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'devices.manage'))) {
        return { ok: false, code: 'NOT_PERMITTED' };
      }
      // Pre-flight: refuse on unresolved sync conflicts (re-keying a conflicted vault could orphan a copy).
      if ((await host.getConflicts()).length > 0)
        return { ok: false, code: 'SYNC_CONFLICT_UNRESOLVED' };
      const thisDeviceId = (await host.readDeviceState()).deviceId;
      if (!thisDeviceId) return { ok: false, code: 'ERROR' };
      try {
        const result = await rotateMasterKey(ctx.fs, host.secrets, {
          revokeDeviceIds,
          thisDeviceId,
          now: new Date(),
        });
        return { ok: true, ...result };
      } catch (error) {
        if (error instanceof RotationError) return { ok: false, code: error.code };
        return { ok: false, code: 'ERROR' };
      }
    },
    keysRotateStatus: async (): Promise<RotationStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'devices.manage'))) return null;
      const journal = await readRotationJournal(ctx.fs);
      return journal ? { phase: journal.phase, total: journal.files.length } : null;
    },

    // --- Household identity (10-multi-device-vault) ---
    householdStatus: async (): Promise<HouseholdStatus> => {
      const vaultDir = await host.vaultPath();
      const device = await host.readDeviceState();
      const pendingJoinPersonId = device.pendingJoinPersonId ?? null;
      const key = await loadMasterKey(host.secrets);
      if (!vaultDir) {
        return {
          vaultInitialized: false,
          hasMasterKey: key !== null,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId,
        };
      }
      const fs = host.fileSystem(vaultDir);
      const vaultInitialized = await isVaultInitialized(fs);
      if (!key) {
        return {
          vaultInitialized,
          hasMasterKey: false,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId,
        };
      }
      // (32 §5.3) Resume a rotation this device may have crashed mid-flight, BEFORE reading anything
      // key-dependent. A 'committing' resume promotes the new master key — so reload it afterward.
      if (device.deviceId) {
        try {
          await resumeRotation(fs, host.secrets, device.deviceId);
        } catch {
          /* resume is best-effort; a stuck journal surfaces via keys:rotateStatus */
        }
      }
      const liveKey = (await loadMasterKey(host.secrets)) ?? key;

      // (32 §5.5) Re-key detection: if this device's key can't decrypt the access config but the vault IS
      // initialized, the vault was re-keyed elsewhere (this device was signed out). Clear the stale key and
      // route to Unlock (a graceful "rejoin", not a corruption error).
      let access;
      try {
        access = await getAccessConfig(fs, liveKey);
      } catch {
        await host.secrets.clear(MASTER_KEY_ID);
        return {
          vaultInitialized,
          hasMasterKey: false,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId,
        };
      }
      const hasOwner = access.accounts.some((account) => account.roleId === OWNER_ROLE_ID);
      // Heartbeat this device into the registry once per app launch (32 §6.1) — non-fatal if it fails.
      if (!deviceHeartbeatDone && vaultInitialized && hasOwner) {
        deviceHeartbeatDone = true;
        try {
          await ensureDeviceRegistered(fs, liveKey);
          // Auto-share the owner's device-local AI keys into the vault (25 §5.6) so an existing setup that
          // predates auto-sharing reaches members on the next launch — without the owner clicking anything.
          await ensureSharedAiCredentials(fs, liveKey);
        } catch {
          /* registry heartbeat + auto-share are best-effort; never block boot */
        }
      }
      return {
        vaultInitialized,
        hasMasterKey: true,
        hasOwner,
        activePersonId: device.activePersonId ?? null,
        pendingJoinPersonId,
      };
    },
    householdSetup: async (input): Promise<{ recoveryPhrase: string; ownerId: string }> => {
      const { ownerName, pin } = HouseholdSetupSchema.parse(input);
      const vaultDir = await host.vaultPath();
      if (!vaultDir) throw new Error('No vault selected');
      const fs = host.fileSystem(vaultDir);
      // Mint a key only for a genuinely fresh vault; createMasterKey is the hard backstop against
      // re-keying. The people-non-empty check guards a partially-synced vault whose recovery.enc went
      // missing (10-multi-device-vault §7 #9).
      let recoveryPhrase = '';
      if (!(await isVaultInitialized(fs))) {
        if ((await fs.list('people')).length > 0) throw new Error(VAULT_ALREADY_INITIALIZED);
        recoveryPhrase = (await createMasterKey(host.secrets, fs)).recoveryPhrase;
      }
      const key = await loadMasterKey(host.secrets);
      // Initialized vault but this device has no key → it must Unlock first, not run Setup.
      if (!key) throw new Error(VAULT_ALREADY_INITIALIZED);
      // Never add a second owner to an existing household.
      const access = await getAccessConfig(fs, key);
      if (access.accounts.some((account) => account.roleId === OWNER_ROLE_ID)) {
        throw new Error(VAULT_ALREADY_INITIALIZED);
      }
      const now = new Date().toISOString();
      const owner: Person = {
        id: uuid(),
        schemaVersion: 1,
        displayName: ownerName,
        isSubject: true,
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      await savePerson(fs, key, owner);
      await setAccount(fs, key, { personId: owner.id, roleId: OWNER_ROLE_ID, pin });
      await host.updateDeviceState({ activePersonId: owner.id });
      await ensureDeviceRegistered(fs, key);
      return { recoveryPhrase, ownerId: owner.id };
    },
    unlockWithRecoveryPhrase: async (input): Promise<{ ok: boolean }> => {
      // Join/recover this device: restore the master key from the recovery phrase (10-multi-device
      // §6.2). No owner is created. The phrase is never logged. Bad/garbled phrase → { ok: false }.
      const { phrase } = UnlockWithRecoveryPhraseSchema.parse(input);
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return { ok: false };
      const ok = await restoreFromRecoveryPhrase(host.secrets, host.fileSystem(vaultDir), phrase);
      if (ok) {
        const ctx = await host.vaultAndKey();
        if (ctx) await ensureDeviceRegistered(ctx.fs, ctx.key);
      }
      return { ok };
    },
    unlinkVault: async (): Promise<BootState> => {
      // Detach this device from the current vault (14-vault-relinking). The host-agnostic half: the
      // Electron wrapper in ipc.ts also stops the chokidar watcher first (a platform concern, like
      // useVault's startVaultWatcher); on iOS that step is a no-op.
      //
      // CLEAR THE MASTER KEY FIRST. The key is a single device-local slot, not keyed per vault — so a
      // stale key left behind would mis-route the next folder (§7.1): a fresh folder → the desync
      // UnlockScreen, a different existing vault → wrong-key decrypt failures. Once it is gone, the
      // existing HouseholdGate routes correctly with no new routing code. This is why unlink == switch.
      await host.secrets.clear(MASTER_KEY_ID);
      // Forget the vault pointer + this device's session/join state (all device-local). Touch NOTHING
      // inside the vault on disk — the folder stays byte-intact and re-linkable via its recovery phrase.
      // Clear BOTH pointers: `vaultPath` (Electron) and `vaultBookmark` (the web/iOS bookmark) — each
      // host reads only its own, so clearing both keeps the detach correct on every platform.
      await host.updateDeviceState({
        vaultPath: null,
        vaultBookmark: undefined,
        activePersonId: null,
        pendingJoinPersonId: null,
      });
      // Recompute boot from the now-cleared device state → onboarding ("Choose a folder").
      return host.refreshBootState();
    },

    // --- People + relationships ---
    getActivePerson: async (): Promise<Person | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return null;
      const id = await activePersonId();
      return id ? getPerson(ctx.fs, ctx.key, id) : null;
    },
    peopleList: async (): Promise<Person[]> => {
      const ctx = await host.vaultAndKey();
      return ctx ? listPeople(ctx.fs, ctx.key) : [];
    },
    peopleSave: async (input): Promise<Person> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      const person = await upsertPerson(ctx.fs, ctx.key, PersonInputSchema.parse(input));
      // A subject person gets a no-PIN Member login by default, so they're immediately switchable by the
      // Owner and gated into onboarding (roles refactor 2026-06-15). The Access tab refines role/PIN later.
      if (person.isSubject) await ensureMemberAccounts(ctx.fs, ctx.key, [person.id]);
      return person;
    },
    peopleDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return;
      const personId = PersonIdSchema.parse(id);
      await deletePerson(ctx.fs, personId);
      // Reap any per-person shares pointing at the now-deleted person from every OTHER person's insight
      // facts (39-living-memory §4.5). Cleanup only — the read-time re-gate already prevents any leak, so
      // a best-effort failure here is non-fatal. Done from the seam to avoid a people↔insights import cycle.
      await reapOrphanShares(ctx.fs, ctx.key, personId);
      // Reap the shared-root Together data the person was in (session folders + pair agreements/reports;
      // their own per-person Together data went with `deletePerson`) — 58 §5.6.
      await reapTogetherForPerson(ctx.fs, ctx.key, personId);
      // Reap story read receipts OTHER readers hold about the deleted author's books (§13.6.8 both directions;
      // the deleted person's own receipts went with `deletePerson`). Best-effort cleanup.
      await reapReadReceiptsAbout(ctx.fs, ctx.key, personId);
    },
    relationshipsList: async (): Promise<Relationship[]> => {
      const ctx = await host.vaultAndKey();
      return ctx ? listRelationships(ctx.fs, ctx.key) : [];
    },
    relationshipsSave: async (input): Promise<Relationship> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      return upsertRelationship(ctx.fs, ctx.key, RelationshipInputSchema.parse(input));
    },
    relationshipsDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return;
      await deleteRelationship(ctx.fs, PersonIdSchema.parse(id));
    },

    // --- Access (roles + accounts) ---
    accessGet: async (): Promise<AccessView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return { roles: [], accounts: [] };
      // Backfill a Member login for any subject person that predates auto-accounts, so every household
      // subject is switchable by the Owner (roles refactor 2026-06-15). Idempotent + cheap after the
      // first (writes only when an account is genuinely missing). Best-effort: a transient vault-write
      // failure (e.g. an iCloud sync race) must NOT break a plain `access:get` read — degrade to the
      // current view and let a later call backfill once the write succeeds.
      try {
        const subjects = (await listPeople(ctx.fs, ctx.key))
          .filter((p) => p.isSubject)
          .map((p) => p.id);
        await ensureMemberAccounts(ctx.fs, ctx.key, subjects);
      } catch {
        // swallowed — the backfill retries on the next access:get
      }
      return getAccessView(ctx.fs, ctx.key);
    },
    accessSaveRole: async (role): Promise<AccessView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await saveRole(ctx.fs, ctx.key, RoleSchema.parse(role));
      return getAccessView(ctx.fs, ctx.key);
    },
    accessSetAccount: async (input): Promise<AccessView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await setAccount(ctx.fs, ctx.key, SetAccountSchema.parse(input));
      return getAccessView(ctx.fs, ctx.key);
    },
    accessRemoveAccount: async (personId): Promise<AccessView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await removeAccount(ctx.fs, ctx.key, PersonIdSchema.parse(personId));
      return getAccessView(ctx.fs, ctx.key);
    },

    // --- Device invites (10-multi-device-vault §5.4) — owner-only, member-scoped, enforced here ---
    invitesCreate: async (input): Promise<{ code: string; expiresAt: string }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) {
        throw new Error('Not permitted');
      }
      const { personId } = InvitePersonSchema.parse(input);
      // The target must be a real, NON-owner account — never wrap the master key in an invite bound to
      // the owner (10-multi-device-vault §5.4).
      const access = await getAccessConfig(ctx.fs, ctx.key);
      const account = access.accounts.find((candidate) => candidate.personId === personId);
      if (!account || account.roleId === OWNER_ROLE_ID) throw new Error('Not a member');
      // One valid code per person — supersede any existing pending invite at the boundary.
      const now = Date.now();
      for (const pending of await listInvitesForPerson(ctx.fs, personId, now)) {
        await cancelInvite(ctx.fs, pending.id);
      }
      const { code, invite } = await createInvite(ctx.fs, ctx.key, personId, now);
      return { code, expiresAt: invite.expiresAt };
    },
    invitesList: async (input): Promise<InviteSummary[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) return [];
      const { personId } = InvitePersonSchema.parse(input);
      return listInvitesForPerson(ctx.fs, personId, Date.now());
    },
    invitesCancel: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) return;
      await cancelInvite(ctx.fs, InviteIdSchema.parse(input).id);
    },
    invitesRedeem: async (input): Promise<{ ok: boolean; displayName?: string }> => {
      // Member redeem (no device key required yet — that's the point): unwrap the master key from the
      // invite and store it device-local, remembering who the invite is for (10-multi-device §5.4).
      const { code } = InviteCodeSchema.parse(input);
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return { ok: false };
      const fs = host.fileSystem(vaultDir);
      const result = await redeemInvite(fs, code, Date.now());
      if (!result) return { ok: false };
      await storeMasterKey(host.secrets, result.masterKey);
      // Persist the pending join so a crash before completeJoin resumes the "Set your PIN" step on next
      // boot — never drop into an open picker with a PIN-less account (the key is now on this device).
      await host.updateDeviceState({ pendingJoinPersonId: result.personId });
      const person = await getPerson(fs, result.masterKey, result.personId);
      return { ok: true, ...(person ? { displayName: person.displayName } : {}) };
    },
    invitesCompleteJoin: async (input): Promise<{ ok: boolean }> => {
      // Finish joining: set the freshly-redeemed member's OWN PIN and sign them in. Only the person the
      // redeem resolved (persisted device-local) can be completed — never the owner.
      const { pin } = CompleteJoinSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = (await host.readDeviceState()).pendingJoinPersonId ?? null;
      if (!ctx || !personId) return { ok: false };
      const account = (await getAccessConfig(ctx.fs, ctx.key)).accounts.find(
        (candidate) => candidate.personId === personId,
      );
      if (!account || account.roleId === OWNER_ROLE_ID) return { ok: false };
      await setAccount(ctx.fs, ctx.key, { personId, roleId: account.roleId, pin });
      await host.updateDeviceState({ activePersonId: personId, pendingJoinPersonId: null });
      await ensureDeviceRegistered(ctx.fs, ctx.key);
      return { ok: true };
    },

    // --- Session ---
    sessionSetActive: async (input): Promise<SetActiveResult> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return { ok: false, reason: 'NO_ACCOUNT' };
      const { personId, pin } = SetActiveSchema.parse(input);
      const person = await getPerson(ctx.fs, ctx.key, personId);
      if (!person) return { ok: false, reason: 'NO_ACCOUNT' };
      // The Owner (the full-access role) can switch to ANY household person with no PIN — even one whose
      // own login has a PIN set (god-mode switching, 2026-06-15). Everyone else must pass the target's PIN.
      if (!(await activePersonIsOwner(ctx.fs, ctx.key))) {
        if (!(await verifyAccountPin(ctx.fs, ctx.key, personId, pin ?? ''))) {
          return { ok: false, reason: 'WRONG_PIN' };
        }
      }
      await host.updateDeviceState({ activePersonId: personId });
      return { ok: true, person };
    },

    // --- Usage + budgets (06-ai-usage-and-budgets) ---
    usageSummary: async (input): Promise<UsageSummary> => {
      const { scope, period, personId } = UsageSummarySchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx) return summarize([]);
      const now = new Date();
      const from = periodStart(now, period);
      const to = now.toISOString();
      // Only an admin may see the whole household or another person; everyone else sees only their own.
      const canManage = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      if (canManage) {
        if (personId) return summarize(await queryUsage(ctx.fs, ctx.key, { from, to, personId }));
        if (scope === 'app') return summarize(await queryUsage(ctx.fs, ctx.key, { from, to }));
      }
      const self = await activePersonId();
      if (!self) return summarize([]);
      return summarize(await queryUsage(ctx.fs, ctx.key, { from, to, personId: self }));
    },
    budgetGet: async (): Promise<{ app: Budget | null; person: Budget | null }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return { app: null, person: null };
      const budgets = await getBudgets(ctx.fs, ctx.key);
      const personId = await activePersonId();
      return {
        app: budgets.app ?? null,
        person: personId ? await effectivePersonBudget(ctx.fs, ctx.key, personId) : null,
      };
    },
    budgetGetPerson: async (personId): Promise<Budget> => {
      const id = PersonIdSchema.parse(personId);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'budgets.manage'))) {
        return DEFAULT_BUDGET;
      }
      return effectivePersonBudget(ctx.fs, ctx.key, id);
    },
    budgetSetApp: async (budget): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'budgets.manage'))) return;
      await setAppBudget(ctx.fs, ctx.key, budget === null ? null : BudgetSchema.parse(budget));
    },
    budgetSetPerson: async (input): Promise<void> => {
      const { personId, budget } = BudgetSetPersonSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'budgets.manage'))) return;
      await setPersonBudget(ctx.fs, ctx.key, personId, budget);
    },
    budgetStatus: async (): Promise<{ person: BudgetState; app: BudgetState }> => {
      const none: BudgetState = {
        state: 'none',
        budgetRatio: 0,
        spentUsd: 0,
        limitUsd: null,
        period: null,
      };
      const ctx = await host.vaultAndKey();
      if (!ctx) return { person: none, app: none };
      const now = new Date();
      const personId = await activePersonId();
      const person = personId
        ? await checkBudget(ctx.fs, ctx.key, { scope: 'person', personId, now })
        : none;
      const app = await checkBudget(ctx.fs, ctx.key, { scope: 'app', now });
      // $ is admin-only (the budgets.manage gate). A non-admin gets only `budgetRatio` (+ state/period)
      // for their OWN budget — never the dollars over IPC — and nothing about the household app budget
      // (the "Everyone" scope is admin-only too). Mirrors usage:summary / usage:sessionCosts redaction.
      const canManage = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      if (canManage) return { person, app };
      const ratioOnly = (b: BudgetState): BudgetState => ({
        state: b.state,
        budgetRatio: b.budgetRatio,
        period: b.period,
      });
      return { person: ratioOnly(person), app: none };
    },

    // --- Conversations + chat (05-conversations) ---
    conversationsList: async (): Promise<ConversationMeta[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return [];
      return (
        (await listConversations(ctx.fs, ctx.key, personId))
          // Together prep threads (58 §3.7) are ordinary conversations, but they belong to a couples session's
          // "Prep privately" panel — NOT the solo Sessions list. Filter them out here (the new §3.7 filter).
          .filter((c) => !c.togetherSessionId)
          .map((c) => ({
            id: c.id,
            title: c.title,
            updatedAt: c.updatedAt,
            status: conversationStatus(c),
            ...(c.guideId ? { guideId: c.guideId } : {}),
          }))
      );
    },
    conversationsGet: async (id): Promise<Conversation | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return null;
      return getConversation(ctx.fs, ctx.key, personId, PersonIdSchema.parse(id));
    },
    conversationsRename: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return;
      const { id, title } = RenameSchema.parse(input);
      const conversation = await getConversation(ctx.fs, ctx.key, personId, id);
      if (!conversation) return;
      await saveConversation(ctx.fs, ctx.key, {
        ...conversation,
        title,
        updatedAt: new Date().toISOString(),
      });
    },
    conversationsDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return;
      await deleteConversation(ctx.fs, personId, PersonIdSchema.parse(id));
    },
    chatStream: async (input): Promise<ChatTurnResult> => {
      const { conversationId, userText, attachments } = ChatStreamSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      // 29 §3.5 — the in-session depth ask (setting `intake.inSessionDepthAsk`, default ON). When on, hand the
      // turn the person's unexplored invited sections so the coach may gently invite ONE (prompt-level,
      // relevance-gated). Adult (18+) sections are withheld until the shared ack; restricted-but-not-adult
      // areas stay in the list but the instruction only raises them if the person opens that door (§8).
      const depthAskOn =
        (await readVaultSettingsValues(ctx.fs))['intake.inSessionDepthAsk'] !== false;
      let depthAsk: { sections: ReturnType<typeof unfilledInvitedSections> } | undefined;
      if (depthAskOn) {
        const session = await getIntakeSession(ctx.fs, ctx.key, personId);
        const prefs = await getGuidancePrefs(ctx.fs, ctx.key, personId);
        const adultAcked = prefs.adultAcknowledged === true;
        const sections = unfilledInvitedSections(session).filter((s) => !s.adult || adultAcked);
        if (sections.length > 0) depthAsk = { sections };
      }
      // 40 §3.1 — in-session proactivity (per-person `coaching.proactivity`, default 'gentle'). When NOT off,
      // hand the turn the person's active (open/in-progress/stale) commitments so the coach may gently follow
      // up on ONE when relevant — free, riding this turn (no extra call). Bounded + ordered stale-first so the
      // prime follow-up candidates lead; the builder withholds it entirely when there's nothing active.
      const now = new Date();
      const proactivity = await getProactivity(ctx.fs, ctx.key, personId);
      let goalRaise: { goals: GoalRaiseGoal[]; level: 'gentle' | 'active' } | undefined;
      if (proactivity !== 'off') {
        const active = (await listGoals(ctx.fs, ctx.key, personId))
          .filter((g) => g.status === 'open' || g.status === 'inProgress')
          .map((g) => ({ text: g.text, stale: effectiveGoalStatus(g, now) === 'stale' }))
          .sort((a, b) => Number(b.stale) - Number(a.stale)); // stale-first
        if (active.length > 0) goalRaise = { goals: active, level: proactivity };
      }
      return runChatTurn({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        conversationId,
        userText,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        onDelta: (text) => host.emitStreamChunk('chat', text),
        ...(depthAsk ? { depthAsk } : {}),
        ...(goalRaise ? { goalRaise } : {}),
        now,
      });
    },
    chatRetry: async (conversationId): Promise<ChatTurnResult> => {
      // 05 §4.1 — re-generate a reply for a session whose last message is an unanswered user message (an
      // empty/failed turn, or a re-opened session that ended on the user). Never adds a new user message, so
      // it can't duplicate; the cached topic keeps the context relevant. Streams via the same `chat` stream surface.
      // The optional in-session nudges (depth-ask 29 §3.5, goal-raise 40 §3.1) are intentionally omitted on a
      // recovery turn — a retry should just deliver the missing reply, not surface a fresh proactive invitation.
      const cid = z.string().min(1).parse(conversationId);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return retryReply({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        conversationId: cid,
        onDelta: (text) => host.emitStreamChunk('chat', text),
        now: new Date(),
      });
    },

    conversationsRewind: async (input): Promise<RewindResult> => {
      // 66 §3.3 — "delete from here". Person-scoped: `rewindConversation` is keyed by the HOST's active
      // person, so a foreign conversationId simply resolves to nothing.
      const { conversationId, index, expect } = RewindConversationSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { ok: false, reason: 'NOT_FOUND' };
      }
      return rewindConversation(ctx.fs, ctx.key, personId, conversationId, index, expect);
    },
    chatRegenerateFrom: async (input): Promise<ChatTurnResult> => {
      // 66 §3.3 — "retry from here": truncate + re-generate in ONE call, so the renderer never observes a
      // half-rewound transcript. Streams on the existing `chat` stream surface.
      const { conversationId, index, expect } = RewindConversationSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return regenerateFrom(
        {
          fs: ctx.fs,
          key: ctx.key,
          client: host.claude,
          apiKey,
          model: await host.activeModel(),
          personId,
          conversationId,
          onDelta: (text) => host.emitStreamChunk('chat', text),
          now: new Date(),
        },
        index,
        expect,
      );
    },

    // --- Together: couples sessions (58) — every handler gates on together.own + membership + live edge ---
    togetherList: async (): Promise<TogetherSessionSummary[]> => {
      const c = await togetherCtx();
      if (!c) return [];
      const now = new Date();
      const rels = await listRelationships(c.fs, c.key);
      const sessions = await listTogetherSessionsForPerson(c.fs, c.key, c.personId);
      const out: TogetherSessionSummary[] = [];
      for (const session of sessions) {
        const others = session.participantIds.filter((p) => p !== c.personId);
        // Live-edge gate: an un-edged pair is inaccessible to both (deleting the edge removes it).
        if (
          !others.every((oid) =>
            relationshipTypesFromSubjectToViewer(c.personId, oid, rels).includes('partner'),
          )
        ) {
          continue;
        }
        const summary = await buildTogetherSummary(c.fs, c.key, session, c.personId, now);
        // The decliner's own list drops the session entirely (§3.5); everyone else never sees a quiet decline.
        if (summary.status !== 'declined') out.push(summary);
      }
      // Newest activity first; an un-messaged session falls back to its create time.
      return out.sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
      );
    },
    togetherGet: async (id): Promise<TogetherSessionView | null> => {
      const c = await togetherCtx();
      if (!c) return null;
      const session = await accessibleTogetherSession(
        c.fs,
        c.key,
        c.personId,
        z.string().min(1).parse(id),
      );
      if (!session) return null;
      const view = await buildTogetherView(c.fs, c.key, session, c.personId, new Date());
      // The decliner sees nothing — even a direct get returns null (§3.5).
      return view.status === 'declined' ? null : view;
    },
    togetherCreate: async (input): Promise<TogetherCreateResult> => {
      const { partnerPersonId, topic, guideId } = TogetherCreateInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) {
        return { ok: false, reason: 'NOT_READY', message: 'SelfOS isn’t ready yet.' };
      }
      if (!(await activePersonCan(ctx.fs, ctx.key, 'together.own'))) {
        return { ok: false, reason: 'NOT_ALLOWED', message: 'You can’t start Together sessions.' };
      }
      if (partnerPersonId === personId) {
        return { ok: false, reason: 'NO_EDGE', message: 'Pick a partner other than yourself.' };
      }
      // The partner must be a subject WITH a login account (a non-subject contact can't participate — §3.1).
      const partner = await getPerson(ctx.fs, ctx.key, partnerPersonId);
      const access = await getAccessConfig(ctx.fs, ctx.key);
      const hasAccount = access.accounts.some((a) => a.personId === partnerPersonId);
      if (!partner || !partner.isSubject || !hasAccount) {
        return {
          ok: false,
          reason: 'PARTNER_NOT_SUBJECT',
          message: 'That person needs a SelfOS login in this household to join.',
        };
      }
      if (!(await togetherEdgeLive(ctx.fs, ctx.key, personId, [partnerPersonId]))) {
        return {
          ok: false,
          reason: 'NO_EDGE',
          message: 'Together with this person isn’t available.',
        };
      }
      // A guided couples session (§3.10): the guideId must resolve to a real catalog entry. An adult
      // (`together-desire`) guide additionally requires BOTH participants' 18+ acks (§5.2 N-party conjunction),
      // re-checked host-side here regardless of what the catalog card showed — never merely a hidden UI card.
      if (guideId) {
        const guide = getTogetherGuide(guideId);
        if (!guide) {
          return {
            ok: false,
            reason: 'NOT_ALLOWED',
            message: 'That guided session isn’t available.',
          };
        }
        if (
          guide.adult &&
          !(await allAdultAcknowledged(ctx.fs, ctx.key, [personId, partnerPersonId]))
        ) {
          return {
            ok: false,
            reason: 'NOT_ALLOWED',
            message: 'Both of you need to turn on adult content first.',
          };
        }
      }
      const session = await createTogetherSession(
        ctx.fs,
        ctx.key,
        {
          initiatorPersonId: personId,
          participantIds: [personId, partnerPersonId],
          ...(topic !== undefined ? { topic } : {}),
          ...(guideId !== undefined ? { guideId } : {}),
        },
        new Date(),
      );
      return {
        ok: true,
        session: await buildTogetherView(ctx.fs, ctx.key, session, personId, new Date()),
      };
    },
    togetherAccept: async (id): Promise<TogetherSessionView | null> => {
      const c = await togetherCtx();
      if (!c) return null;
      const session = await accessibleTogetherSession(
        c.fs,
        c.key,
        c.personId,
        z.string().min(1).parse(id),
      );
      if (!session) return null;
      await updateTogetherState(
        c.fs,
        c.key,
        session.id,
        c.personId,
        { rulesAckAt: new Date().toISOString() },
        new Date(),
      );
      return buildTogetherView(c.fs, c.key, session, c.personId, new Date());
    },
    togetherDecline: async (id): Promise<void> => {
      const c = await togetherCtx();
      if (!c) return;
      const session = await accessibleTogetherSession(
        c.fs,
        c.key,
        c.personId,
        z.string().min(1).parse(id),
      );
      if (!session) return;
      await updateTogetherState(
        c.fs,
        c.key,
        session.id,
        c.personId,
        { declinedAt: new Date().toISOString() },
        new Date(),
      );
    },
    togetherSetPaused: async (input): Promise<TogetherSessionView | null> => {
      const { sessionId, paused } = TogetherSetPausedInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return null;
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) return null;
      await updateTogetherState(
        c.fs,
        c.key,
        session.id,
        c.personId,
        { pausedAt: paused ? new Date().toISOString() : undefined },
        new Date(),
      );
      return buildTogetherView(c.fs, c.key, session, c.personId, new Date());
    },
    togetherLeave: async (id): Promise<TogetherSessionView | null> => {
      const c = await togetherCtx();
      if (!c) return null;
      const session = await accessibleTogetherSession(
        c.fs,
        c.key,
        c.personId,
        z.string().min(1).parse(id),
      );
      if (!session) return null;
      await updateTogetherState(
        c.fs,
        c.key,
        session.id,
        c.personId,
        { leftAt: new Date().toISOString() },
        new Date(),
      );
      return buildTogetherView(c.fs, c.key, session, c.personId, new Date());
    },
    togetherWithdraw: async (id): Promise<boolean> => {
      const c = await togetherCtx();
      if (!c) return false;
      const session = await accessibleTogetherSession(
        c.fs,
        c.key,
        c.personId,
        z.string().min(1).parse(id),
      );
      if (!session) return false;
      // The core enforces initiator-only + still-pending; the bridge already gated participant + live edge.
      const result = await withdrawTogetherSession(c.fs, c.key, session.id, c.personId);
      return result.ok;
    },
    togetherMarkRead: async (input): Promise<void> => {
      const { sessionId, at } = TogetherMarkReadInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return;
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) return;
      await updateTogetherState(
        c.fs,
        c.key,
        session.id,
        c.personId,
        { lastReadMessageAt: at },
        new Date(),
      );
    },
    togetherSendMessage: async (input): Promise<TogetherTurnResult> => {
      const { sessionId, text, privateAside, attachments } =
        TogetherSendMessageInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return { ok: false, reason: 'NOT_ALLOWED', message: 'SelfOS isn’t ready yet.' };
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) {
        return { ok: false, reason: 'NOT_ALLOWED', message: 'Together isn’t available right now.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, c.fs, c.key)).key ?? null;
      // The explicit register is unlocked ONLY when EVERY participant has acked (§5.2 N-party conjunction).
      const allAdultAcked = await allAdultAcknowledged(c.fs, c.key, session.participantIds);
      const outcome = await runTogetherTurn({
        fs: c.fs,
        key: c.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        session,
        authorPersonId: c.personId,
        userText: text,
        ...(privateAside ? { privateAside: true } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(allAdultAcked ? { allAdultAcked: true } : {}),
        onDelta: (delta) => host.emitStreamChunk('together', { sessionId, delta }),
        now: new Date(),
      });
      return togetherTurnResult(c.fs, c.key, session, c.personId, outcome);
    },
    togetherPrepOpen: async (input): Promise<Conversation | null> => {
      const { sessionId } = TogetherPrepOpenSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return null;
      // A participant (membership + live edge) opens THEIR OWN prep thread (§3.7) — a solo conversation
      // billed to them (their `chatStream` bills the active person, outside the initiator-pays rule).
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) return null;
      return openPrepConversation(c.fs, c.key, c.personId, sessionId, new Date());
    },
    togetherStoreAttachment: async (
      input,
    ): Promise<
      | AttachmentRef
      | { ok: false; reason: 'UNSUPPORTED' | 'TOO_LARGE' | 'NOT_FOUND'; message: string }
    > => {
      const { sessionId, base64, mime, width, height } = TogetherStoreAttachmentSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return { ok: false, reason: 'NOT_FOUND', message: 'SelfOS isn’t ready yet.' };
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) return { ok: false, reason: 'NOT_FOUND', message: 'Together isn’t available.' };
      const dims =
        width !== undefined || height !== undefined
          ? {
              ...(width !== undefined ? { width } : {}),
              ...(height !== undefined ? { height } : {}),
            }
          : undefined;
      return storeTogetherAttachment(c.fs, c.key, sessionId, fromBase64(base64), mime, dims);
    },
    togetherGetAttachment: async (input): Promise<{ mime: string; dataBase64: string } | null> => {
      const { sessionId, path } = TogetherGetAttachmentSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return null;
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) return null;
      // Confine the path to THIS session's attachments folder (a crafted path can't reach another session's).
      const prefix = `${togetherAttachmentsDir(sessionId)}/`;
      if (!isTogetherAttachmentPath(path) || !path.startsWith(prefix)) return null;
      // Message-gated (§5.2): an attachment referenced ONLY by a private aside is readable by the aside's
      // author alone — the projection hides the aside from the partner, so its image must be gated too.
      // Fail CLOSED on an unknown owner: a legitimate read always renders from a message the viewer can see,
      // so an owning message always exists on the happy path; an owner-less path (a stored-but-never-sent
      // orphan) must never resolve to bytes for anyone but its storer's own author-gated read.
      const owner = await messageOwningAttachment(c.fs, c.key, sessionId, path);
      if (!owner || (owner.privateAside && owner.authorPersonId !== c.personId)) return null;
      const bytes = await getTogetherAttachment(c.fs, c.key, path);
      return bytes ? { mime: sniffImageMime(bytes), dataBase64: toBase64(bytes) } : null;
    },
    togetherRewind: async (input): Promise<TogetherSessionView | null> => {
      // 66 §3.3 — same membership + live-edge gate as every other Together op. The projection check
      // lives in core: `removeMessagesFrom` computes the span over the remover's OWN view, so a
      // message they can't see (a partner's private aside) can't be targeted even by id.
      const { sessionId, fromMessageId } = TogetherRewindInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return null;
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) return null;
      const result = await removeMessagesFrom(c.fs, c.key, session.id, c.personId, fromMessageId);
      if (!result.ok) return null;
      const view = await buildTogetherView(c.fs, c.key, session, c.personId, new Date());
      return view.status === 'declined' ? null : view;
    },
    togetherRetry: async (input): Promise<TogetherTurnResult> => {
      const { sessionId } = TogetherRetryInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return { ok: false, reason: 'NOT_ALLOWED', message: 'SelfOS isn’t ready yet.' };
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) {
        return { ok: false, reason: 'NOT_ALLOWED', message: 'Together isn’t available right now.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, c.fs, c.key)).key ?? null;
      const allAdultAcked = await allAdultAcknowledged(c.fs, c.key, session.participantIds);
      const outcome = await retryTogetherReply({
        fs: c.fs,
        key: c.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        session,
        authorPersonId: c.personId,
        ...(allAdultAcked ? { allAdultAcked: true } : {}),
        onDelta: (delta) => host.emitStreamChunk('together', { sessionId, delta }),
        now: new Date(),
      });
      return togetherTurnResult(c.fs, c.key, session, c.personId, outcome);
    },

    // --- Phase D: wrap-up + the pair agreements ledger (58 §3.8/§3.9) ---
    togetherCatalog: async (): Promise<TogetherCatalogEntry[]> => {
      const c = await togetherCtx();
      if (!c) return [];
      // The 18+ `together-desire` group is withheld unless the active person acked AND ≥1 live-edge partner
      // has acked too (so "both acks exist" for at least one pairing) — host-side (§3.10). Starting a desire
      // session then RE-CHECKS `allAdultAcknowledged([initiator, that partner])` at `togetherCreate`, so a
      // wrong-partner pairing can never bypass the conjunction.
      const meAcked = (await getGuidancePrefs(c.fs, c.key, c.personId)).adultAcknowledged === true;
      let allowAdult = false;
      if (meAcked) {
        const rels = await listRelationships(c.fs, c.key);
        const partnerIds = new Set<string>();
        for (const r of rels) {
          if (r.type !== 'partner') continue;
          if (r.fromPersonId === c.personId) partnerIds.add(r.toPersonId);
          else if (r.toPersonId === c.personId) partnerIds.add(r.fromPersonId);
        }
        for (const pid of partnerIds) {
          if ((await getGuidancePrefs(c.fs, c.key, pid)).adultAcknowledged === true) {
            allowAdult = true;
            break;
          }
        }
      }
      return togetherCatalogFor({ allowAdult });
    },
    togetherAcknowledgeAdult: async (): Promise<boolean> => {
      const c = await togetherCtx();
      if (!c) return false;
      // The active person's one-time 18+ ack — the shared guidance-prefs flag (16/48/50). Their own consent
      // only; the partner acks for themselves. The desire group + register stay gated until BOTH have acked.
      await acknowledgeAdult(c.fs, c.key, c.personId);
      return true;
    },
    togetherYnmStatus: async (input): Promise<TogetherYnmStatus> => {
      const { partnerPersonId } = TogetherYnmInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c)
        return {
          youAcked: false,
          eligible: false,
          youOptedIn: false,
          partnerOptedIn: false,
          ready: false,
        };
      return ynmStatusFor(c.fs, c.key, c.personId, partnerPersonId);
    },
    togetherYnmOptIn: async (input): Promise<TogetherYnmStatus> => {
      const { partnerPersonId } = TogetherYnmInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c)
        return {
          youAcked: false,
          eligible: false,
          youOptedIn: false,
          partnerOptedIn: false,
          ready: false,
        };
      // Opting in requires the pair be eligible (both acks + live edge) — you can't consent to share the
      // overlap before the register is even unlocked. Revoke is always allowed (below).
      if (
        (await togetherEdgeLive(c.fs, c.key, c.personId, [partnerPersonId])) &&
        (await allAdultAcknowledged(c.fs, c.key, [c.personId, partnerPersonId]))
      ) {
        await setYnmOptIn(c.fs, c.key, c.personId, partnerPersonId, true, new Date());
      }
      return ynmStatusFor(c.fs, c.key, c.personId, partnerPersonId);
    },
    togetherYnmRevoke: async (input): Promise<TogetherYnmStatus> => {
      const { partnerPersonId } = TogetherYnmInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c)
        return {
          youAcked: false,
          eligible: false,
          youOptedIn: false,
          partnerOptedIn: false,
          ready: false,
        };
      // Revocation is ALWAYS honored (§3.10b) — the overlap drops from every subsequent read immediately.
      await setYnmOptIn(c.fs, c.key, c.personId, partnerPersonId, false, new Date());
      return ynmStatusFor(c.fs, c.key, c.personId, partnerPersonId);
    },
    togetherYnmOverlap: async (input): Promise<TogetherYnmOverlap> => {
      const { partnerPersonId } = TogetherYnmInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return { ready: false, items: [] };
      // The mutual overlap is computed ONLY when READY: both 18+ acks + a live edge + BOTH opted in. Otherwise
      // an empty not-ready result — never a one-sided or partial list (§3.10b). Live re-gate on every read.
      const edgeLive = await togetherEdgeLive(c.fs, c.key, c.personId, [partnerPersonId]);
      const acked = await allAdultAcknowledged(c.fs, c.key, [c.personId, partnerPersonId]);
      const pairKey = pairKeyFor(c.personId, partnerPersonId);
      const [youIn, partnerIn] = await Promise.all([
        getYnmOptIn(c.fs, c.key, c.personId, pairKey),
        getYnmOptIn(c.fs, c.key, partnerPersonId, pairKey),
      ]);
      return ynmOverlapFor(
        c.fs,
        c.key,
        c.personId,
        partnerPersonId,
        edgeLive && acked && youIn && partnerIn,
      );
    },
    togetherPulse: async (input): Promise<TogetherPulseView> => {
      const { partnerPersonId } = TogetherYnmInputSchema.parse(input);
      const c = await togetherCtx();
      const empty: TogetherPulseView = {
        checkInSeries: [],
        sessionSeries: [],
        hasCheckIns: false,
        alignment: { ready: false },
      };
      if (!c) return empty;
      // Pulse is pair-scoped: a live partner edge is required (re-checked, §5.2). The desire-alignment gate
      // (both logged + both consented) is enforced inside `buildPulseView`.
      if (!(await togetherEdgeLive(c.fs, c.key, c.personId, [partnerPersonId]))) return empty;
      return buildPulseView(c.fs, c.key, c.personId, partnerPersonId);
    },
    togetherPulseLog: async (input): Promise<TogetherPulseView> => {
      const { partnerPersonId, metrics, shareMetrics } = TogetherPulseLogInputSchema.parse(input);
      const c = await togetherCtx();
      const empty: TogetherPulseView = {
        checkInSeries: [],
        sessionSeries: [],
        hasCheckIns: false,
        alignment: { ready: false },
      };
      if (!c) return empty;
      if (!(await togetherEdgeLive(c.fs, c.key, c.personId, [partnerPersonId]))) return empty;
      await logPulseCheckIn(
        c.fs,
        c.key,
        c.personId,
        partnerPersonId,
        metrics,
        shareMetrics,
        new Date(),
      );
      return buildPulseView(c.fs, c.key, c.personId, partnerPersonId);
    },
    togetherJointChallenges: async (input): Promise<JointChallengeStatus[]> => {
      const { partnerPersonId } = TogetherYnmInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return [];
      // Pair-scoped: a live partner edge is required (re-checked, §5.2). Reads BOTH partners' twin Challenge
      // records to derive the cross-partner "both checked in" status — never any other challenge content.
      if (!(await togetherEdgeLive(c.fs, c.key, c.personId, [partnerPersonId]))) return [];
      return listJointChallenges(c.fs, c.key, [c.personId, partnerPersonId]);
    },
    togetherSuggestions: async (sessionId): Promise<TogetherSuggestion[]> => {
      const c = await togetherCtx();
      if (!c) return [];
      // Session-scoped: only a participant with a live edge sees the coach's suggestion cards (§5.2).
      const session = await accessibleTogetherSession(
        c.fs,
        c.key,
        c.personId,
        z.string().min(1).parse(sessionId),
      );
      return session ? listSuggestions(c.fs, c.key, session.id) : [];
    },
    togetherWrapUp: async (input): Promise<TogetherWrapUpResult> => {
      const { sessionId, mode } = TogetherWrapUpInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return { ok: false, reason: 'NOT_ALLOWED', message: 'SelfOS isn’t ready yet.' };
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) {
        return { ok: false, reason: 'NOT_ALLOWED', message: 'Together isn’t available right now.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, c.fs, c.key)).key ?? null;
      // Together memory rides the existing Sessions memory toggle (Together is a coaching session type) — no
      // dead new setting (§12). The live partner edge id is the best-effort `relationshipId` (§3.8).
      const memoryEnabled =
        (await readVaultSettingsValues(c.fs))['sessions.memoryEnabled'] !== false;
      const rels = await listRelationships(c.fs, c.key);
      const others = session.participantIds.filter((p) => p !== c.personId);
      const edge = rels.find(
        (r) =>
          r.type === 'partner' &&
          ((r.fromPersonId === c.personId && others.includes(r.toPersonId)) ||
            (r.toPersonId === c.personId && others.includes(r.fromPersonId))),
      );
      const outcome = await runTogetherWrapUp({
        fs: c.fs,
        key: c.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        session,
        memoryEnabled,
        ...(edge ? { relationshipId: edge.id } : {}),
        ...(mode ? { mode } : {}),
        now: new Date(),
      });
      if (outcome.ok) return { ok: true, report: outcome.report, stale: false };
      return { ok: false, reason: outcome.reason, message: outcome.message };
    },
    togetherGetReport: async (input): Promise<TogetherReportView> => {
      const { sessionId } = TogetherGetReportInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return { report: null, stale: false, agreements: [] };
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, sessionId);
      if (!session) return { report: null, stale: false, agreements: [] };
      const report = await getTogetherReport(c.fs, c.key, sessionId);
      // Derived staleness (§3.8): the newest mutually-visible human message vs the report's last-generated time.
      const shared = (await listTogetherMessages(c.fs, c.key, sessionId)).filter(
        (m) => !m.privateAside && m.role === 'user',
      );
      const newestHumanTs = shared.reduce<string | null>(
        (max, m) => (max === null || m.ts > max ? m.ts : max),
        null,
      );
      // The per-session ledger shows only agreements made in THIS session (issue #206) — the pair-wide view
      // lives on Home/Goals (`togetherMyAgreements`). Collapse any duplicate captures so the same action item
      // never renders twice.
      const agreements = dedupeAgreements(
        (await listAgreements(c.fs, c.key, session.pairKey)).filter(
          (a) => a.provenance.sessionId === sessionId,
        ),
      );
      return { report, stale: isReportStale(report, newestHumanTs), agreements };
    },
    togetherSaveAgreement: async (input): Promise<Agreement | null> => {
      const parsed = TogetherSaveAgreementInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return null;
      const session = await accessibleTogetherSession(c.fs, c.key, c.personId, parsed.sessionId);
      if (!session) return null;
      const [a, b] = session.participantIds;
      if (!a || !b) return null;
      return saveAgreement(
        c.fs,
        c.key,
        a,
        b,
        {
          ...(parsed.id ? { id: parsed.id } : {}),
          text: parsed.text,
          ...(parsed.timeframe ? { timeframe: parsed.timeframe } : {}),
          status: parsed.status,
          sessionId: parsed.sessionId,
        },
        new Date(),
      );
    },
    // Every STANDING agreement across the active person's pairs (spec 61) — surfaced in Goals + Home. Scoped
    // to the active person (only pairs they're a member of); the partner display name is attached here.
    togetherMyAgreements: async (): Promise<AgreementSummary[]> => {
      const c = await togetherCtx();
      if (!c) return [];
      const rows = await listStandingAgreementsForViewer(c.fs, c.key, c.personId);
      return Promise.all(
        rows.map(async (r) => ({
          agreement: r.agreement,
          partnerPersonId: r.partnerPersonId,
          partnerName:
            (await getPerson(c.fs, c.key, r.partnerPersonId))?.displayName ?? 'your partner',
        })),
      );
    },
    // Every DONE (completed) commitment across the active person's pairs (spec 61) — the Goals "Completed &
    // closed" record, so a followed-through commitment isn't lost when it drops out of the standing list.
    togetherDoneCommitments: async (): Promise<AgreementSummary[]> => {
      const c = await togetherCtx();
      if (!c) return [];
      const rows = await listDoneAgreementsForViewer(c.fs, c.key, c.personId);
      return Promise.all(
        rows.map(async (r) => ({
          agreement: r.agreement,
          partnerPersonId: r.partnerPersonId,
          partnerName:
            (await getPerson(c.fs, c.key, r.partnerPersonId))?.displayName ?? 'your partner',
        })),
      );
    },
    // Mark a standing agreement done/retired from Goals/Home (spec 61). Resolves the pair from the partner id
    // (robust to a deleted origin session), loads the existing shared record, and re-saves ONLY the status —
    // preserving text/timeframe/createdAt/origin provenance (last-write-wins on the shared record, §7).
    togetherSetAgreementStatus: async (input): Promise<Agreement | null> => {
      const parsed = TogetherSetAgreementStatusInputSchema.parse(input);
      const c = await togetherCtx();
      if (!c) return null;
      const pairKey = pairKeyFor(c.personId, parsed.partnerPersonId);
      const existing = await getAgreement(c.fs, c.key, pairKey, parsed.agreementId);
      if (!existing) return null;
      return saveAgreement(
        c.fs,
        c.key,
        c.personId,
        parsed.partnerPersonId,
        {
          id: existing.id,
          text: existing.text,
          ...(existing.timeframe ? { timeframe: existing.timeframe } : {}),
          status: parsed.status,
          sessionId: existing.provenance.sessionId,
        },
        new Date(),
      );
    },

    // --- Session image attachments (45 §6) — gated by `sessions.own`, scoped to the active person ---
    conversationStoreAttachment: async (
      input,
    ): Promise<
      | AttachmentRef
      | { ok: false; reason: 'UNSUPPORTED' | 'TOO_LARGE' | 'NOT_FOUND'; message: string }
    > => {
      const { conversationId, base64, mime, width, height } = StoreAttachmentSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { ok: false, reason: 'NOT_FOUND', message: 'SelfOS isn’t ready yet.' };
      }
      // Store under the ACTIVE person's conversation tree. The id is restricted to a safe path segment by
      // `ConversationIdSchema` (no `/`/`..`), and `storeConversationAttachment` re-checks the built path against
      // the attachment guard, so a crafted id can't traverse out of the person's tree. mime + size are
      // re-validated inside `storeConversationAttachment`.
      const dims =
        width !== undefined || height !== undefined
          ? {
              ...(width !== undefined ? { width } : {}),
              ...(height !== undefined ? { height } : {}),
            }
          : undefined;
      return storeConversationAttachment(
        ctx.fs,
        ctx.key,
        personId,
        conversationId,
        fromBase64(base64),
        mime,
        dims,
      );
    },
    conversationGetAttachment: async (
      input,
    ): Promise<{ mime: string; dataBase64: string } | null> => {
      const { conversationId, path } = ConversationAttachmentRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own')))
        return null;
      // Re-check it's one of OUR attachment files AND under the active person's NAMED conversation (so a
      // path can't reach another person's — or another conversation's — attachment).
      const prefix = `${conversationAttachmentsDir(personId, conversationId)}/`;
      if (!isConversationAttachmentPath(path) || !path.startsWith(prefix)) return null;
      const bytes = await getConversationAttachment(ctx.fs, ctx.key, path);
      return bytes ? { mime: sniffImageMime(bytes), dataBase64: toBase64(bytes) } : null;
    },
    conversationExportAttachment: async (input): Promise<string | null> => {
      const { conversationId, path } = ConversationAttachmentRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own')))
        return null;
      const prefix = `${conversationAttachmentsDir(personId, conversationId)}/`;
      if (!isConversationAttachmentPath(path) || !path.startsWith(prefix)) return null;
      const bytes = await getConversationAttachment(ctx.fs, ctx.key, path);
      if (!bytes) return null;
      const mime = sniffImageMime(bytes);
      const ext =
        mime === 'image/webp'
          ? 'webp'
          : mime === 'image/jpeg'
            ? 'jpg'
            : mime === 'image/gif'
              ? 'gif'
              : 'png';
      // The bytes leave the encrypted vault by the user's explicit choice (45 §11).
      return host.saveImageFile(`session-image.${ext}`, bytes, mime);
    },

    // --- Session lifecycle + analysis (09-session-analysis §14) — gated by `sessions.own` ---
    sessionsSetStatus: async (input): Promise<ConversationMeta | null> => {
      const { conversationId, status } = SessionSetStatusSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own')))
        return null;
      const updated = await setSessionStatus({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        conversationId,
        status,
        now: new Date(),
      });
      return updated
        ? {
            id: updated.id,
            title: updated.title,
            updatedAt: updated.updatedAt,
            status: conversationStatus(updated),
          }
        : null;
    },
    sessionsEndAndSummarize: async (input): Promise<SessionSummaryResult> => {
      const { conversationId } = ChatConversationIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // The session-memory master toggle lives in vault settings (default ON); the service refuses when off.
      const memoryEnabled =
        (await readVaultSettingsValues(ctx.fs))['sessions.memoryEnabled'] !== false;
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      // 29 — hand the analysis the person's intake session so the same (paid) pass can detect an unexplored
      // profile area and emit a depth invitation for free.
      const intakeSession = await getIntakeSession(ctx.fs, ctx.key, personId);
      return endAndSummarize({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        conversationId,
        memoryEnabled,
        intakeSession,
        now: new Date(),
      });
    },
    // --- Guided sessions (16-guided-sessions §6) — gated by `sessions.own` ---
    sessionsStartGuided: async (input): Promise<{ conversationId: string } | null> => {
      const { guideId } = StartGuidedSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return null;
      }
      return startGuided({ fs: ctx.fs, key: ctx.key, personId, guideId, now: new Date() });
    },
    guidedGetState: async (): Promise<GuidanceState> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { cache: null, adultAcknowledged: false };
      }
      return getGuidanceState(ctx.fs, ctx.key, personId);
    },
    guidedSuggest: async (): Promise<GuidedSuggestResult> => {
      // Reuses the gap-finder deps (budget + metering + key-in-main), gated on `sessions.own`.
      const deps = await aiDeps('sessions.own');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      // The Intimacy group is excluded from suggestions until the 18+ ack (§8.3).
      const prefs = await getGuidancePrefs(deps.fs, deps.key, deps.personId);
      return suggestGuidedSessions(deps, { adultAllowed: prefs.adultAcknowledged === true });
    },
    guidedAcknowledgeAdult: async (): Promise<GuidanceState> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { cache: null, adultAcknowledged: false };
      }
      await acknowledgeAdult(ctx.fs, ctx.key, personId);
      return getGuidanceState(ctx.fs, ctx.key, personId);
    },
    // --- Self-assessments / "Tests" (50-self-assessments §6). Gated `tests.own` + active-person-scoped; the
    // 18+ group's items/results are withheld here (the trust boundary), not just the UI. Only narrate spends. ---
    testsList: async (): Promise<{ tests: TestSummary[]; adultAcknowledged: boolean }> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'tests.own'))) {
        return { tests: [], adultAcknowledged: false };
      }
      const ack = (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      return { tests: listTestSummaries(ack), adultAcknowledged: ack };
    },
    testsGet: async (input): Promise<TestForm | null> => {
      const { testId } = TestIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'tests.own'))) return null;
      const def = getTest(testId);
      if (!def) return null;
      // A sensitive test's items are withheld until the 18+ ack (§3.5) — in the bridge, not just the UI.
      if (
        def.adult &&
        (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged !== true
      ) {
        return null;
      }
      return testForm(def);
    },
    testsTake: async (input): Promise<TestResult | null> => {
      const { testId, answers } = TestTakeSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'tests.own'))) return null;
      const def = getTest(testId);
      if (!def) return null;
      if (
        def.adult &&
        (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged !== true
      ) {
        return null;
      }
      // Deterministic + free — no budget check, no AI. `scoreTest` is total, so loosely-typed answers are safe.
      return takeTest(
        ctx.fs,
        ctx.key,
        def,
        { personId, answers: answers as ScoreAnswers },
        new Date(),
      );
    },
    testsResults: async (input): Promise<TestResult[]> => {
      const { testId } = TestIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'tests.own'))) return [];
      const def = getTest(testId);
      if (
        def?.adult &&
        (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged !== true
      ) {
        return [];
      }
      return listResults(ctx.fs, ctx.key, personId, testId);
    },
    testsNarrate: async (input): Promise<TestNarrateResponse> => {
      const { testId, resultId } = TestResultRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'tests.own'))) {
        return { ok: false, reason: 'AI_OFF', message: 'Not available.' };
      }
      const def = getTest(testId);
      if (!def) return { ok: false, reason: 'ERROR', message: 'That assessment is gone.' };
      if (
        def.adult &&
        (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged !== true
      ) {
        return { ok: false, reason: 'AI_OFF', message: 'Not available.' };
      }
      const result = (await listResults(ctx.fs, ctx.key, personId, testId)).find(
        (r) => r.id === resultId,
      );
      if (!result) return { ok: false, reason: 'ERROR', message: 'That result is gone.' };
      const now = new Date();
      const person = await checkBudget(ctx.fs, ctx.key, { scope: 'person', personId, now });
      const app = await checkBudget(ctx.fs, ctx.key, { scope: 'app', now });
      const out = await narrateResult({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey: (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
        aiEnabled: (await readVaultSettingsValues(ctx.fs))['ai.enabled'] === true,
        model: await host.activeModel(),
        def,
        result,
        personId,
        now,
        overBudget: person.state === 'over' || app.state === 'over',
      });
      if (!out.ok) return out;
      // Cost ($) is admin-only (the budgets.manage gate, redacted here like everywhere else, 06).
      const showCost = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      return { ok: true, text: out.text, ...(showCost ? { costUsd: out.costUsd } : {}) };
    },
    testsAcknowledgeAdult: async (): Promise<{
      tests: TestSummary[];
      adultAcknowledged: boolean;
    }> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'tests.own'))) {
        return { tests: [], adultAcknowledged: false };
      }
      await acknowledgeAdult(ctx.fs, ctx.key, personId);
      return { tests: listTestSummaries(true), adultAcknowledged: true };
    },
    testsDeleteResult: async (input): Promise<TestResult[]> => {
      const { testId, resultId } = TestResultRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'tests.own'))) return [];
      // Pass the definition so a partial delete re-derives the Insight from the latest remaining take
      // (keeps trends + the crisis flag honest — 51 §5.4).
      await deleteResult(ctx.fs, ctx.key, personId, testId, resultId, getTest(testId));
      return listResults(ctx.fs, ctx.key, personId, testId);
    },
    testsDeleteAll: async (input): Promise<void> => {
      const { testId } = TestIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'tests.own'))) return;
      await deleteAllResults(ctx.fs, ctx.key, personId, testId);
    },
    usageSessionCosts: async (): Promise<Record<string, SessionCost>> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return {};
      // Lifetime usage for the active person, rolled up per session (chat turns + any session.analyze).
      const events = await queryUsage(ctx.fs, ctx.key, {
        from: '0000',
        to: '9999',
        personId,
      });
      const rollup = rollupSessionCosts(events);
      // $ is admin-only (the budgets.manage gate). Everyone gets `budgetRatio` — a fraction, no $ leaked.
      const showCost = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      const budget = await effectivePersonBudget(ctx.fs, ctx.key, personId);
      const limit = budget.limitUsd > 0 ? budget.limitUsd : null;
      const out: Record<string, SessionCost> = {};
      for (const [id, { tokens, costUsd }] of Object.entries(rollup)) {
        out[id] = {
          tokens,
          ...(showCost ? { costUsd } : {}),
          ...(limit !== null ? { budgetRatio: Math.min(1, costUsd / limit) } : {}),
        };
      }
      return out;
    },

    // --- Questionnaires (08-questionnaires) — gated by `questionnaires.create` ---
    questionnairesList: async (): Promise<Questionnaire[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return [];
      // Authoring/edit list = the active person's OWN questionnaires. A questionnaire someone else authored
      // (incl. one they SENT to you) belongs in your Inbox, not your edit list — showing it here made no
      // sense (08 §4.2). A legacy creator-less def (pre-38) has no author recorded, so it stays visible to
      // the Owner (the full-access role, and the only one who can delete it — §3.9) rather than orphaning.
      const personId = await activePersonId();
      const isOwner = await activePersonCan(ctx.fs, ctx.key, 'people.manage');
      return (await listQuestionnaires(ctx.fs, ctx.key)).filter(
        (q) => q.creatorPersonId === personId || (q.creatorPersonId === undefined && isOwner),
      );
    },
    questionnairesSendStates: async (): Promise<Record<string, QuestionnaireSendState>> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return {};
      const personId = await activePersonId();
      if (!personId) return {};
      // The active person's own sends, aggregated by questionnaire — latest send time + count + whether the
      // LATEST send is answered. Pure metadata for the list's "Sent · <date>" badge + hiding the share-a-link
      // affordance once answered (08 §17.14); no raw answers or recipient detail.
      const sends = await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId });
      interface Acc {
        lastSentAt: string;
        total: number;
        latestStatus: AssignmentStatus;
      }
      const acc: Record<string, Acc> = {};
      for (const a of sends) {
        const prev = acc[a.questionnaireId];
        const isLatest = !prev || a.createdAt > prev.lastSentAt;
        acc[a.questionnaireId] = {
          lastSentAt: isLatest ? a.createdAt : prev.lastSentAt,
          total: (prev?.total ?? 0) + 1,
          latestStatus: isLatest ? a.status : (prev?.latestStatus ?? a.status),
        };
      }
      const states: Record<string, QuestionnaireSendState> = {};
      for (const [qid, a] of Object.entries(acc)) {
        states[qid] = {
          lastSentAt: a.lastSentAt,
          total: a.total,
          answered: a.latestStatus === 'submitted' || a.latestStatus === 'analyzed',
        };
      }
      return states;
    },
    questionnairesSentOverview: async (): Promise<Record<string, QuestionnaireSentOverview>> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return {};
      const personId = await activePersonId();
      if (!personId) return {};
      // The active person's own sends, aggregated per questionnaire with per-recipient detail for the
      // landing "Sent" cards (08 §3.1). Recipient detail (names + answered status, never the raw answers) is
      // results territory, so this read is `viewResults`-gated — stricter than `questionnairesSendStates`.
      const sends = await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId });
      // assignmentId → its derived Insight (for the "analysed" excerpt + to know which sends are analysed).
      const insightByAssignment = new Map(
        (await listInsightsForPerson(ctx.fs, ctx.key, personId)).flatMap((i) =>
          i.provenance.assignmentId ? [[i.provenance.assignmentId, i] as const] : [],
        ),
      );
      const isAnswered = (status: AssignmentStatus): boolean =>
        status === 'submitted' || status === 'analyzed';
      // Group by questionnaire, then dedupe recipients to their LATEST send (a re-ask shows each person once).
      interface Recip {
        name: string;
        at: string;
        status: AssignmentStatus;
        privacy: PrivacyMode;
        answeredAt?: string;
      }
      interface Agg {
        lastSentAt: string;
        latestByRecipient: Map<string, Recip>;
        newResponses: number;
        answeredAt?: string; // most recent submission across sends
        analyzedAt?: string; // most recent analysis time across sends (latest analysed insight's updatedAt)
        analyzable?: { at: string; id: string }; // latest submitted-but-un-analysed send
        latestInsight?: { at: string; id: string; summary: string }; // latest analysed send's insight
      }
      const byQuestionnaire = new Map<string, Agg>();
      for (const a of sends) {
        // The sender's own COMPATIBILITY half isn't a "recipient" — they answer in-app (08 §3.6/§16.1). A
        // plain self check-in (recipient = sender, no compat group) IS a real send and stays included.
        if (
          a.compatibilityGroupId &&
          a.recipient.kind === 'person' &&
          a.recipient.personId === personId
        ) {
          continue;
        }
        const recipientName =
          a.recipient.kind === 'person'
            ? ((await getPerson(ctx.fs, ctx.key, a.recipient.personId))?.displayName ?? 'Unknown')
            : (a.recipient.displayName ?? 'External');
        // Dedupe key: the person id for a household recipient, else the external label (best-effort).
        const recipientKey =
          a.recipient.kind === 'person' ? `p:${a.recipient.personId}` : `x:${recipientName}`;
        const agg = byQuestionnaire.get(a.questionnaireId) ?? {
          lastSentAt: a.createdAt,
          latestByRecipient: new Map<string, Recip>(),
          newResponses: 0,
        };
        agg.lastSentAt = agg.lastSentAt > a.createdAt ? agg.lastSentAt : a.createdAt;
        const answered = isAnswered(a.status);
        // A submitted send's `updatedAt` is its submission time (08 §13.5b) — the "Answered <date·time>".
        const submittedAt = answered ? a.updatedAt : undefined;
        const prior = agg.latestByRecipient.get(recipientKey);
        // Keep the recipient's LATEST send (a re-ask shows each person once). A strictly-later send always
        // wins; on an EXACT timestamp tie (two rapid programmatic sends), prefer an answered one so the card
        // reflects real engagement deterministically rather than depending on iteration order.
        const supersedes =
          !prior ||
          a.createdAt > prior.at ||
          (a.createdAt === prior.at && answered && !isAnswered(prior.status));
        if (supersedes) {
          agg.latestByRecipient.set(recipientKey, {
            name: recipientName,
            at: a.createdAt,
            status: a.status,
            privacy: a.privacy,
            ...(submittedAt ? { answeredAt: submittedAt } : {}),
          });
        }
        if (answered && submittedAt) {
          agg.answeredAt =
            !agg.answeredAt || submittedAt > agg.answeredAt ? submittedAt : agg.answeredAt;
          const insight = insightByAssignment.get(a.id);
          if (insight) {
            // Track the most-recently-answered analysed send's insight for the card excerpt + deep-link.
            if (!agg.latestInsight || submittedAt > agg.latestInsight.at) {
              agg.latestInsight = { at: submittedAt, id: insight.id, summary: insight.summary };
            }
            // The most recent ANALYSIS time (when the insight was written/updated), for the "Recently
            // analyzed" sort — distinct from `answeredAt` (when the recipient submitted).
            agg.analyzedAt =
              !agg.analyzedAt || insight.updatedAt > agg.analyzedAt
                ? insight.updatedAt
                : agg.analyzedAt;
          } else if (a.status === 'submitted') {
            // Un-analysed → a "new response" (tallied over sends) + a candidate for one-tap Analyze.
            agg.newResponses += 1;
            if (!agg.analyzable || submittedAt > agg.analyzable.at) {
              agg.analyzable = { at: submittedAt, id: a.id };
            }
          }
        }
        byQuestionnaire.set(a.questionnaireId, agg);
      }
      const overview: Record<string, QuestionnaireSentOverview> = {};
      for (const [questionnaireId, agg] of byQuestionnaire) {
        const recipients: SentRecipientSummary[] = [...agg.latestByRecipient.values()].map((r) => ({
          name: r.name,
          status: r.status,
          answered: isAnswered(r.status),
          ...(r.answeredAt ? { answeredAt: r.answeredAt } : {}),
        }));
        // "Analysed" = EVERY recipient has answered and there's nothing left to analyse (all answered sends
        // have an insight); the excerpt is that insight's summary. A still-outstanding recipient keeps the
        // card at "N of M answered" (never "Analyzed"); a fresh un-analysed response shows the Analyze
        // affordance (analyzableAssignmentId) instead of the excerpt.
        const answeredCount = recipients.filter((r) => r.answered).length;
        const allAnswered = recipients.length > 0 && answeredCount === recipients.length;
        const analyzed = allAnswered && !agg.analyzable && agg.latestInsight !== undefined;
        // The card privacy chip (08 §3.1): one mode when every recipient's latest send agrees, else
        // `mixed` (a legacy multi-recipient questionnaire sent under different modes).
        const privacies = new Set([...agg.latestByRecipient.values()].map((r) => r.privacy));
        const privacy: PrivacyMode | 'mixed' | undefined =
          privacies.size === 1 ? [...privacies][0] : privacies.size > 1 ? 'mixed' : undefined;
        overview[questionnaireId] = {
          questionnaireId,
          lastSentAt: agg.lastSentAt,
          recipients,
          answeredCount,
          newResponses: agg.newResponses,
          analyzed,
          ...(privacy ? { privacy } : {}),
          ...(agg.answeredAt ? { answeredAt: agg.answeredAt } : {}),
          ...(agg.analyzedAt ? { analyzedAt: agg.analyzedAt } : {}),
          ...(analyzed && agg.latestInsight
            ? { insightSummary: agg.latestInsight.summary, insightId: agg.latestInsight.id }
            : {}),
          ...(agg.analyzable ? { analyzableAssignmentId: agg.analyzable.id } : {}),
        };
      }
      return overview;
    },
    questionnairesGet: async (id): Promise<Questionnaire | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return null;
      return getQuestionnaire(ctx.fs, ctx.key, PersonIdSchema.parse(id));
    },
    questionnairesSave: async (input): Promise<Questionnaire> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        throw new Error('Not permitted');
      }
      const personId = await activePersonId();
      const parsed = QuestionnaireInputSchema.parse(input);
      // Detect images dropped by this edit BEFORE saving, so the now-orphaned media gets reaped (the
      // builder's "remove" only clears the draft — §13.2 — leaving the encrypted file for GC).
      const before = parsed.id ? await getQuestionnaire(ctx.fs, ctx.key, parsed.id) : null;
      // Stamp the creator (main-side, never the renderer) so deletion can enforce "creator-only" rules.
      const saved = await saveQuestionnaire(ctx.fs, ctx.key, parsed, personId ?? undefined);
      if (before) {
        const after = new Set(saved.questions.flatMap((q) => (q.media ? [q.media.imagePath] : [])));
        const removedAnImage = before.questions.some(
          (q) => q.media && !after.has(q.media.imagePath),
        );
        if (removedAnImage) await garbageCollectImages(ctx.fs, ctx.key);
      }
      return saved;
    },
    questionnairesDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return;
      const questionnaireId = QuestionnaireIdSchema.parse(id);
      // Owner (people.manage) purge a questionnaire + everything downstream at any stage
      // (§3.9). A non-owner creator may delete their OWN questionnaire only while it is still unsent.
      if (await activePersonCan(ctx.fs, ctx.key, 'people.manage')) {
        await revokeRelayLinks(ctx.fs, ctx.key, (a) => a.questionnaireId === questionnaireId);
        await purgeQuestionnaire(ctx.fs, ctx.key, questionnaireId);
        return;
      }
      const questionnaire = await getQuestionnaire(ctx.fs, ctx.key, questionnaireId);
      if (!questionnaire) return;
      const personId = await activePersonId();
      if (questionnaire.creatorPersonId !== personId) throw new Error('Not permitted');
      // A non-owner creator may delete their OWN questionnaire while it is still unsent, OR when every send is
      // SELF-TARGETED (the recipient is the creator themselves — a self / auto check-in, #350). Sends to
      // OTHERS stay protected (§3.9): a non-owner can't purge a questionnaire whose recipients may have
      // answered, since that would destroy their responses + the insights drawn from them.
      const sends = (await listAssignments(ctx.fs, ctx.key)).filter(
        (a) => a.questionnaireId === questionnaireId,
      );
      const allSelfTargeted = sends.every(
        (a) => a.recipient.kind === 'person' && a.recipient.personId === personId,
      );
      if (!allSelfTargeted) throw new Error('Not permitted');
      // Unsent or self-only — safe to purge; revoke any preview/self relay link first.
      await revokeRelayLinks(ctx.fs, ctx.key, (a) => a.questionnaireId === questionnaireId);
      await purgeQuestionnaire(ctx.fs, ctx.key, questionnaireId);
    },
    questionnairesValidate: async (input): Promise<string[]> => {
      // Pure pre-flight check — exposes nothing sensitive, so no vault/capability gate.
      return validateQuestionnaire(QuestionnaireInputSchema.parse(input));
    },
    questionnairesSetFavorite: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return;
      const { id, favorite } = z
        .object({ id: z.string().min(1), favorite: z.boolean() })
        .parse(input);
      await setFavorite(ctx.fs, ctx.key, id, favorite);
    },
    questionnairesListTypes: async (): Promise<string[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return [];
      return listCustomTypes(ctx.fs);
    },
    questionnairesAddType: async (name): Promise<string[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        throw new Error('Not permitted');
      }
      return addCustomType(ctx.fs, z.string().parse(name));
    },

    questionnairesStoreImage: async (input): Promise<{ imagePath: string; mime: string }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        throw new Error('Not permitted');
      }
      const { base64, mime } = StoreImageSchema.parse(input);
      if (!isAllowedImageMime(mime)) throw new Error('Unsupported image type');
      const bytes = fromBase64(base64);
      // Re-validate the size in main (the renderer's check isn't the trust boundary).
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image too large');
      const imagePath = await storeQuestionnaireImage(ctx.fs, ctx.key, bytes);
      return { imagePath, mime };
    },
    questionnairesGetImage: async (imagePath): Promise<string | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return null;
      const path = z.string().parse(imagePath);
      // An author (`create`) reads any media for the builder/preview. A recipient (`answer`) may read ONLY
      // images referenced by a questionnaire actually sent TO THEM — so they can see author images in the
      // Inbox without being able to enumerate the household's media (the bridge is the trust boundary).
      if (!(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        const personId = await activePersonId();
        if (!personId || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.answer'))) {
          return null;
        }
        const mine = await listAssignments(ctx.fs, ctx.key, { recipientPersonId: personId });
        let referenced = false;
        for (const a of mine) {
          const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
          if (snapshot?.questions.some((q) => q.media?.imagePath === path)) {
            referenced = true;
            break;
          }
        }
        if (!referenced) return null;
      }
      const bytes = await getQuestionnaireImage(ctx.fs, ctx.key, path);
      return bytes ? toBase64(bytes) : null;
    },
    questionnairesDeleteImage: async (imagePath): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return;
      await deleteQuestionnaireImage(ctx.fs, z.string().parse(imagePath));
    },
    questionnairesGenerate: async (input): Promise<QuestionnaireGenerateResult> => {
      const deps = await aiDeps();
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const p = GenerateSchema.parse(input);
      // The bound recipient (08 §17.12) drives BOTH (a) relevance — auto-tailor to the recipient's *shareable*
      // context (their profile/relationship/shareable insights, the §13.3 boundary) so questions fit the person
      // they're for, and (b) de-dup — their FULL answered content as avoid-only grounding (§17.4), gathered
      // host-side, never returned to the author. Only a HOUSEHOLD recipient has this context; an external one
      // has neither, so both are skipped. There is no separate "about a person" picker (§17.12-A).
      const recipientPerson = p.recipientPersonId
        ? await getPerson(deps.fs, deps.key, p.recipientPersonId)
        : null;
      const recipientIsHousehold = recipientPerson !== null;
      // Knowledge-aware de-dup (08 §19): the recipient's history + RAW onboarding answers, and the intimacy
      // acts already rated — so generation goes deeper instead of repeating what's known. Author-blind.
      const known = recipientIsHousehold
        ? await recipientKnownData(deps.fs, deps.key, p.recipientPersonId as string, deps.personId)
        : {
            history: '',
            coveredActs: [],
            askedPrompts: [],
            dedupReference: '',
            coveredNotes: [] as string[],
            feedbackGuidance: '',
            partnerContext: '',
            pinnedLabels: [] as string[],
            newMaterial: [] as { at: string; text: string }[],
          };
      // Who it's FOR (08 §24.4): the recipient's name/pronouns + the author↔recipient relationship (type +
      // closeness), so generation adopts the right register (partner vs coworker vs child) and personalizes.
      let recipientFraming:
        | {
            name?: string;
            pronouns?: string;
            relationship?: { type: RelationshipType; closeness?: number };
          }
        | undefined;
      if (recipientPerson) {
        const rels = await listRelationships(deps.fs, deps.key);
        // "the recipient is the author's ___" — resolved from the live graph so an edge stored in EITHER
        // direction gives the right role (parent↔child is asymmetric; using `edge.type` raw would invert it).
        const relType = relationshipTypesFromSubjectToViewer(
          deps.personId,
          recipientPerson.id,
          rels,
        )[0];
        const edge = rels.find(
          (r) =>
            (r.fromPersonId === deps.personId && r.toPersonId === recipientPerson.id) ||
            (r.fromPersonId === recipientPerson.id && r.toPersonId === deps.personId),
        );
        recipientFraming = {
          name: recipientPerson.displayName,
          ...(recipientPerson.pronouns ? { pronouns: recipientPerson.pronouns } : {}),
          ...(relType
            ? {
                relationship: {
                  type: relType,
                  ...(edge?.closeness != null ? { closeness: edge.closeness } : {}),
                },
              }
            : {}),
        };
      }
      return generateQuestions(deps, {
        type: p.type,
        sensitivity: p.sensitivity,
        ...(p.brief !== undefined ? { brief: p.brief } : {}),
        context: {
          authorPersonId: deps.personId,
          // The author's own data always feeds (§15.4); the recipient's full context tailors (§24.5 override).
          includeAuthor: true,
          ...(recipientIsHousehold ? { targetPersonId: p.recipientPersonId as string } : {}),
          includeTarget: recipientIsHousehold,
          includeRelationship: recipientIsHousehold,
        },
        existingPrompts: p.existingPrompts,
        // spec 71 — the ask ledger + emergent topic map: the planner picks ground from what has ACTUALLY been
        // asked (scoped to this type + tier), and the questions come back tagged so the ledger can be
        // appended at send time. Household recipients only; an external one has no household record.
        ...(recipientIsHousehold ? { recipientPersonId: p.recipientPersonId as string } : {}),
        ...(known.pinnedLabels.length ? { requestedLabels: known.pinnedLabels } : {}),
        ...(known.newMaterial.length ? { newMaterial: known.newMaterial } : {}),
        ...(known.history ? { recipientHistory: known.history } : {}),
        ...(known.dedupReference ? { dedupReference: known.dedupReference } : {}),
        ...(known.askedPrompts.length ? { recipientAskedPrompts: known.askedPrompts } : {}),
        ...(known.coveredActs.length ? { coveredIntimacyActs: known.coveredActs } : {}),
        // spec 69 §5.9 — learn from their prior skips/declines (avoid / boundary / reword).
        ...(known.feedbackGuidance ? { feedbackGuidance: known.feedbackGuidance } : {}),
        // spec 69 §5.4 — a self check-in can reflect a partner's shared desire (restricted never crosses).
        ...(known.partnerContext ? { partnerContext: known.partnerContext } : {}),
        ...(p.intimacyMode !== undefined ? { intimacyMode: p.intimacyMode } : {}),
        ...(p.count !== undefined ? { count: p.count } : {}),
        ...(recipientFraming ? { recipient: recipientFraming } : {}),
      });
    },
    questionnairesImproveQuestion: async (input): Promise<QuestionnaireImproveResult> => {
      const deps = await aiDeps();
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      return improveQuestion(deps, ImproveSchema.parse(input));
    },
    // "Too vague → sharpen" (08 §28.2): rewrite the same question to be concrete + probing. The prompt wording
    // lives in core (`SHARPEN_INSTRUCTION`); the renderer just asks to sharpen.
    questionnairesSharpenQuestion: async (input): Promise<QuestionnaireImproveResult> => {
      const deps = await aiDeps();
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      return sharpenQuestion(deps, SharpenSchema.parse(input));
    },
    // "Already answered → replace" (08 §28.3): record the topic as covered for this recipient so ALL future
    // generation avoids it. Author-scoped (the note lives under the active person, keyed by recipient); gated
    // `questionnaires.create`. The replacement question itself is generated via the existing generate path.
    questionnairesMarkCovered: async (input): Promise<{ ok: boolean }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        return { ok: false };
      }
      const authorId = await activePersonId();
      if (!authorId) return { ok: false };
      const p = MarkCoveredSchema.parse(input);
      await markCoveredTopic(
        ctx.fs,
        ctx.key,
        authorId,
        {
          recipientPersonId: p.recipientPersonId,
          note: p.note,
          ...(p.sourcePrompt !== undefined ? { sourcePrompt: p.sourcePrompt } : {}),
        },
        new Date(),
      );
      return { ok: true };
    },
    // The Questionnaire-Intelligence transparency read (spec 69 §3.4/§6): the active person's OWN
    // "what SelfOS has explored" coverage view. Own-scoped — gated `questionnaires.own`, always scoped to the
    // active person, and the projection surfaces only their own coverage/feedback (never reciprocity / partner
    // data, §8). An empty view is returned when unavailable rather than throwing.
    questionnairesPersonalizationProfile: async (): Promise<QuestionnaireCoverageView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.own')))
        return emptyCoverageView();
      const personId = await activePersonId();
      if (!personId) return emptyCoverageView();
      const acked = (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      return readCoverageView(ctx.fs, ctx.key, personId, new Date(), acked);
    },
    // Write a steer (explore more / leave alone) into the active person's OWN profile and return the refreshed
    // view. Own-scoped: a steer can only ever touch the caller's own Personalization Profile.
    questionnairesSteerTopic: async (input): Promise<QuestionnaireCoverageView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.own')))
        return emptyCoverageView();
      const personId = await activePersonId();
      if (!personId) return emptyCoverageView();
      const parsed = SteerTopicSchema.parse(input);
      const acked = (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      // Gate an Intimacy "explore more" (leaning IN) on the 18+ ack IN THE BRIDGE, not just the UI (spec 70 §8 —
      // intimacy steering stays behind the ack; the renderer hides it, but the bridge is the trust boundary).
      // "Leave alone" (backing off) + "clear" are always allowed — they never add explicit exposure. A crafted
      // un-acked "explore more" on Intimacy is a no-op that just returns the current view.
      if (parsed.topicId === 'Intimacy' && parsed.action === 'explore-more' && !acked) {
        return readCoverageView(ctx.fs, ctx.key, personId, new Date(), acked);
      }
      const p: CoverageSteerInput = {
        topicId: parsed.topicId,
        action: parsed.action,
        ...(parsed.lifeArea !== undefined ? { lifeArea: parsed.lifeArea } : {}),
        ...(parsed.label !== undefined ? { label: parsed.label } : {}),
      };
      return steerTopic(ctx.fs, ctx.key, personId, p, new Date(), acked);
    },
    // Curate a candidate in the active person's OWN feed (spec 70 §3.2). Cheap, no AI; own-scoped in the bridge.
    questionnairesCurateCandidate: async (input): Promise<QuestionnaireCoverageView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.own')))
        return emptyCoverageView();
      const personId = await activePersonId();
      if (!personId) return emptyCoverageView();
      const parsed: CandidateCurateInput = CurateCandidateSchema.parse(input);
      const acked = (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      return curateCandidate(ctx.fs, ctx.key, personId, parsed, new Date(), acked);
    },
    // Clear the whole candidate feed for the active person (spec 70 §3.2). Cheap, no AI; own-scoped in the bridge.
    questionnairesClearCandidateFeed: async (): Promise<QuestionnaireCoverageView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.own')))
        return emptyCoverageView();
      const personId = await activePersonId();
      if (!personId) return emptyCoverageView();
      const acked = (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      return clearCandidateFeedAndRead(ctx.fs, ctx.key, personId, new Date(), acked);
    },
    // The manual "Look for more" (spec 70 §5.4): force a candidate refresh for the active person, then return
    // the refreshed OWN view. Budget-gated + metered `questionnaire.profile` INSIDE `refreshNextCandidates`
    // (fail-safe — a no-key / over-budget / degraded pass leaves the last-good feed, surfaced as `refreshDegraded`
    // so the panel can say so honestly). Own-scoped.
    questionnairesRefreshNextCandidates: async (): Promise<QuestionnaireCoverageView> => {
      const deps = await aiDeps('questionnaires.own');
      if (!deps) return emptyCoverageView();
      const result = await refreshNextCandidates(deps, deps.personId);
      const acked =
        (await getGuidancePrefs(deps.fs, deps.key, deps.personId)).adultAcknowledged === true;
      const view = await readCoverageView(deps.fs, deps.key, deps.personId, new Date(), acked);
      return result.ok ? view : { ...view, refreshDegraded: true };
    },
    // The inline "I'm 18+" unlock on the Intimacy row (spec 70 §3.4): do the SHARED 18+ acknowledgement for the
    // active person (the same `adultAcknowledged` gate as guided/Together), then return the refreshed OWN view.
    // Own-scoped; no AI.
    questionnairesAcknowledgeAdult: async (): Promise<QuestionnaireCoverageView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.own')))
        return emptyCoverageView();
      const personId = await activePersonId();
      if (!personId) return emptyCoverageView();
      await acknowledgeAdult(ctx.fs, ctx.key, personId);
      return readCoverageView(ctx.fs, ctx.key, personId, new Date(), true);
    },
    // Add an "Explore with your partner" wish to the active person's OWN profile (spec 70 §3.5). Own-scoped +
    // re-checked against a LIVE partner edge in the bridge (a person may only wish for a partner they're actually
    // connected to). Silent: this only stores the requester's own free text — it never reads the partner's data.
    questionnairesAddPartnerWish: async (input): Promise<QuestionnaireCoverageView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.own')))
        return emptyCoverageView();
      const personId = await activePersonId();
      if (!personId) return emptyCoverageView();
      const parsed = AddPartnerWishSchema.parse(input);
      const wishInput: AddPartnerWishInput = {
        partnerPersonId: parsed.partnerPersonId,
        note: parsed.note,
        ...(parsed.intimacy !== undefined ? { intimacy: parsed.intimacy } : {}),
      };
      const acked = (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      // Re-gate: only a LIVE `partner` edge between the two lets a wish be added (the trust boundary).
      const rels = await listRelationships(ctx.fs, ctx.key);
      const livePartner = rels.some(
        (e) =>
          e.type === 'partner' &&
          ((e.fromPersonId === personId && e.toPersonId === wishInput.partnerPersonId) ||
            (e.fromPersonId === wishInput.partnerPersonId && e.toPersonId === personId)),
      );
      if (!livePartner) return readCoverageView(ctx.fs, ctx.key, personId, new Date(), acked);
      return addPartnerWishAndRead(ctx.fs, ctx.key, personId, wishInput, new Date(), acked);
    },
    questionnairesRemovePartnerWish: async (input): Promise<QuestionnaireCoverageView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.own')))
        return emptyCoverageView();
      const personId = await activePersonId();
      if (!personId) return emptyCoverageView();
      const { wishId } = RemovePartnerWishSchema.parse(input);
      const acked = (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      return removePartnerWishAndRead(ctx.fs, ctx.key, personId, wishId, new Date(), acked);
    },
    // A recipient flags a wrong fact in a question they're answering (spec 08 wrong-fact amendment). Trace it
    // to the recipient's OWN on-record facts (profile / onboarding / insight), auto-flag a wrong INSIGHT so it
    // stops feeding future questions, and reword THIS question so they can answer the corrected version. The
    // recipient is the subject (their own data), so all reads/writes are their own — recipient-scoped.
    assignmentsCorrectFact: async (input): Promise<FactCorrectionOutcome> => {
      const p = CorrectFactSchema.parse(input);
      const scoped = await recipientAssignment(p.assignmentId);
      if (!scoped) return { ok: false, reason: 'NO_PERMISSION', message: 'Not permitted.' };
      const deps = await aiDeps('questionnaires.answer');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'AI is unavailable.' };
      const { fs, key, assignment } = scoped;
      const personId = deps.personId;
      const now = new Date();

      // The question comes from the FROZEN send snapshot, not the renderer — so the rewrite is validated
      // against the real structure (option count, matrix rows) the recipient is answering (08 §32.3).
      const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
      const question = snapshot?.questions.find((q) => q.id === p.questionId);
      if (!question) return { ok: false, reason: 'NO_PERMISSION', message: 'Not permitted.' };

      const known = await collectKnownFacts(fs, key, personId, now);
      const res = await resolveFactCorrection(deps, {
        question,
        correction: p.correction,
        knownFacts: known,
      });
      if (!res.ok || !res.question) {
        return {
          ok: false,
          ...(res.reason ? { reason: res.reason } : {}),
          ...(res.message ? { message: res.message } : {}),
        };
      }
      const corrected = res.question;

      // Write the correction for REAL (§32.3). The question was wrong, so it is replaced — in the send being
      // answered, and in the questionnaire itself when the corrector authored it (an auto check-in is sent
      // from you to you, which is exactly where a bad question would otherwise come back). The answer is then
      // recorded against the corrected question; there is no mapping back to the original wording.
      await correctSnapshotQuestion(fs, key, assignment.id, corrected);
      // Every send freezes its OWN snapshot, so this touches nobody else's copy or recorded answers.
      const def = await getQuestionnaire(fs, key, assignment.questionnaireId);
      // Only the author's own questionnaire is rewritten — a recipient correcting a question someone ELSE
      // wrote fixes their own send, but never silently edits that person's authored content.
      const ownsDefinition = def != null && def.creatorPersonId === personId;
      if (ownsDefinition && def.questions.some((q) => q.id === corrected.id)) {
        await saveQuestionnaire(fs, key, {
          ...def,
          questions: replaceQuestion(def.questions, corrected),
        });
      }
      // A draft answer to the OLD question answered a question that no longer exists — keeping it would
      // record a choice they never made against the corrected wording.
      const draft = await getResponse(fs, key, assignment.id);
      if (draft?.answers.some((a) => a.questionId === corrected.id)) {
        await saveResponse(fs, key, {
          ...draft,
          answers: draft.answers.filter((a) => a.questionId !== corrected.id),
        });
      }

      // Auto-fix at source for an insight (safe + non-destructive); a profile fact is PROPOSED for an
      // explicit tap and onboarding is routed, since auto-editing structured data from free text is
      // unreliable (§29.2 / §32.4).
      const matched = res.matched;
      let insightFlagged = false;
      if (matched?.source === 'insight' && matched.insightId && matched.factId) {
        await flagInsightFact(fs, key, personId, matched.insightId, matched.factId, true, now);
        insightFlagged = true;
      }
      return {
        ok: true,
        question: corrected,
        ...(res.problem ? { problem: res.problem } : {}),
        source: matched?.source ?? 'unknown',
        ...(matched?.label ? { sourceLabel: matched.label } : {}),
        ...(matched?.text ? { sourceText: matched.text } : {}),
        insightFlagged,
        ...(matched?.source === 'profile' &&
        matched.field &&
        matched.currentValue &&
        res.proposedValue
          ? {
              profileFix: {
                field: matched.field,
                label: matched.label,
                currentValue: matched.currentValue,
                proposedValue: res.proposedValue,
              },
            }
          : {}),
      };
    },

    // Apply a proposed correction to the recipient's OWN profile field (08 §32.4). Recipient-scoped and
    // allowlisted to the same fields the correction flow reads, so it can't be used to write anything else.
    assignmentsApplyProfileFix: async (input): Promise<{ ok: boolean; message?: string }> => {
      const p = ApplyProfileFixSchema.parse(input);
      const scoped = await recipientAssignment(p.assignmentId);
      if (!scoped) return { ok: false, message: 'Not permitted.' };
      const { fs, key } = scoped;
      const personId = await activePersonId();
      if (!personId) return { ok: false, message: 'Not permitted.' };
      const person = await getPerson(fs, key, personId);
      if (!person) return { ok: false, message: 'Not permitted.' };
      // Rebuild from the person's own record with exactly one field replaced; PersonInputSchema strips every
      // main-owned field, so this can only ever change the allowlisted value.
      await upsertPerson(fs, key, PersonInputSchema.parse({ ...person, [p.field]: p.value }));
      return { ok: true };
    },
    gapfinderSuggest: async (input): Promise<QuestionnaireSuggestResult> => {
      const deps = await aiDeps();
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const { targetPersonId } = SuggestSchema.parse(input);
      // spec 69 §5.2 — the Home gap-finder now gets the SAME avoid-list as the auto/saved paths (it used to
      // pass nothing, so it could re-propose already-covered topics forever). Household targets only: the
      // target's history as avoid-only grounding + the topics already sent (titles) + the author's marked-done
      // notes (§28.3) as the deterministic `avoidSuggestions`.
      let recipientHistory = '';
      let avoidSuggestions: string[] = [];
      if (targetPersonId !== undefined && (await getPerson(deps.fs, deps.key, targetPersonId))) {
        const [history, priorTitles, covered] = await Promise.all([
          gatherRecipientHistory(deps.fs, deps.key, targetPersonId),
          gatherRecipientQuestionnaireTitles(deps.fs, deps.key, targetPersonId),
          listCoveredTopics(deps.fs, deps.key, deps.personId, targetPersonId),
        ]);
        recipientHistory = history;
        avoidSuggestions = [...priorTitles, ...covered.map((t) => t.note)];
      }
      return suggestQuestionnaires(deps, {
        ...(targetPersonId !== undefined ? { targetPersonId } : {}),
        ...(recipientHistory.trim() ? { recipientHistory } : {}),
        ...(avoidSuggestions.length ? { avoidSuggestions } : {}),
      });
    },

    // --- Recipient-first saved suggestions (08 §18) — author = the active person, gated `questionnaires.create`.
    // The saved set lives under the author's folder, so reads/writes are structurally per-active-person. The
    // recipient must be a household person (the tailoring needs their data); the bridge is the trust boundary. ---
    questionnaireSuggestionsList: async (input): Promise<SavedSuggestion[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const { recipientPersonId } = SavedSuggestionsSchema.parse(input);
      return listSavedSuggestions(ctx.fs, ctx.key, personId, recipientPersonId);
    },
    questionnaireSuggestionsGenerate: async (input): Promise<SavedSuggestionsResult> => {
      const deps = await aiDeps();
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const { recipientPersonId } = SavedSuggestionsSchema.parse(input);
      // Tailoring needs a real household recipient (profile + insights + already-asked questions). A bad/external
      // id has no household context, so refuse rather than spend on a generic result on the persisted path.
      const recipient = await getPerson(deps.fs, deps.key, recipientPersonId);
      if (!recipient) {
        return { ok: false, reason: 'DENIED', message: 'Choose someone in your household.' };
      }
      // Their full answered content as avoid-only grounding (§17.4 / §18.2 / §19.1: now incl. raw onboarding
      // answers) + the ideas already saved, so a "Suggest more" returns genuinely new ones. Author-blind.
      const known = await recipientKnownData(deps.fs, deps.key, recipientPersonId, deps.personId);
      const recipientHistory = known.history;
      const existing = await listSavedSuggestions(
        deps.fs,
        deps.key,
        deps.personId,
        recipientPersonId,
      );
      // Topic-level de-dup (§23.5/§28.3): avoid re-proposing an idea already SAVED here, a questionnaire
      // already SENT to this recipient, OR a topic the author explicitly marked "already answered" — so
      // "Suggest more" opens new ground instead of circling covered topics.
      const priorTitles = await gatherRecipientQuestionnaireTitles(
        deps.fs,
        deps.key,
        recipientPersonId,
      );
      const avoidSuggestions = [
        ...existing.map((s) => s.title),
        ...priorTitles,
        ...known.coveredNotes,
      ];
      // spec 71 §5.2 — the topic SELECTOR gets the ledger's ground, not just opaque prior titles.
      const ground = await groundSummary(
        deps.fs,
        deps.key,
        recipientPersonId,
        'general',
        'standard',
      );
      const result = await suggestQuestionnaires(deps, {
        targetPersonId: recipientPersonId,
        recipientName: recipient.displayName,
        ...(recipientHistory ? { recipientHistory } : {}),
        ...(avoidSuggestions.length ? { avoidSuggestions } : {}),
        ...(ground.worked.length ? { workedThrough: ground.worked } : {}),
        ...(ground.open.length ? { openGround: ground.open } : {}),
      });
      if (!result.ok || !result.suggestions) {
        // A failed generate preserves the prior saved set (§18.5) — the panel keeps what it had.
        return {
          ok: false,
          saved: existing,
          added: 0,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.message ? { message: result.message } : {}),
        };
      }
      const saved = await accumulateSavedSuggestions(
        deps.fs,
        deps.key,
        deps.personId,
        recipientPersonId,
        result.suggestions,
        deps.now,
      );
      return {
        ok: true,
        saved,
        added: result.suggestions.length,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    },
    questionnaireSuggestionDelete: async (input): Promise<SavedSuggestion[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const { recipientPersonId, suggestionId } = SavedSuggestionDeleteSchema.parse(input);
      return deleteSavedSuggestion(
        ctx.fs,
        ctx.key,
        personId,
        recipientPersonId,
        suggestionId,
        new Date(),
      );
    },
    questionnaireSuggestionMaterialize: async (input): Promise<QuestionnaireGenerateResult> => {
      // "Create from this" (08 §19.4) runs a FULL knowledge-aware generation from the suggestion's idea —
      // producing a complete, de-duped, deep questionnaire with proper options (so a choice question is never
      // blank). Falls back (in the renderer) to seeding the sample questions if this fails.
      const deps = await aiDeps();
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const { recipientPersonId, suggestionId } = SavedSuggestionDeleteSchema.parse(input);
      const recipient = await getPerson(deps.fs, deps.key, recipientPersonId);
      if (!recipient)
        return { ok: false, reason: 'DENIED', message: 'Choose someone in your household.' };
      const suggestion = (
        await listSavedSuggestions(deps.fs, deps.key, deps.personId, recipientPersonId)
      ).find((s) => s.id === suggestionId);
      if (!suggestion) {
        return {
          ok: false,
          reason: 'MALFORMED',
          message: 'That suggestion is no longer available.',
        };
      }
      const known = await recipientKnownData(deps.fs, deps.key, recipientPersonId, deps.personId);
      const brief = [
        `Build a full, specific questionnaire from this idea: "${suggestion.title}".`,
        suggestion.rationale ? `Why now: ${suggestion.rationale}.` : '',
        suggestion.questions.length
          ? `Sample directions to expand on: ${suggestion.questions.map((q) => q.prompt).join('; ')}.`
          : '',
      ]
        .filter((s) => s !== '')
        .join(' ');
      return generateQuestions(deps, {
        type: suggestion.type,
        sensitivity: 'standard',
        brief,
        context: {
          authorPersonId: deps.personId,
          includeAuthor: true,
          targetPersonId: recipientPersonId,
          includeTarget: true,
          includeRelationship: true,
        },
        existingPrompts: [],
        count: 6,
        // spec 71 — same ledger/planner steering as the manual draft path.
        recipientPersonId,
        ...(known.pinnedLabels.length ? { requestedLabels: known.pinnedLabels } : {}),
        ...(known.newMaterial.length ? { newMaterial: known.newMaterial } : {}),
        ...(known.history ? { recipientHistory: known.history } : {}),
        ...(known.dedupReference ? { dedupReference: known.dedupReference } : {}),
        ...(known.askedPrompts.length ? { recipientAskedPrompts: known.askedPrompts } : {}),
        // `coveredActs` only affects the prompt for an explicit-tier intimacy draft; a materialize is
        // standard-tier, so this is inert here today. Passed for symmetry (de-dup still runs via `history`)
        // and so it works automatically if a future materialize carries the suggestion's sensitivity.
        ...(known.coveredActs.length ? { coveredIntimacyActs: known.coveredActs } : {}),
        // spec 69 §5.9 — learn from their prior skips/declines (avoid / boundary / reword).
        ...(known.feedbackGuidance ? { feedbackGuidance: known.feedbackGuidance } : {}),
        // spec 69 §5.4 — a self check-in can reflect a partner's shared desire (restricted never crosses).
        ...(known.partnerContext ? { partnerContext: known.partnerContext } : {}),
      });
    },

    // --- Memory / insights (20-memory-dashboard §5.1/§6) — gated by `memory.own`, active-person-scoped.
    // The trust boundary (spec 20 §1.1): the dashboard returns ONLY the active person's own insights +
    // their relationships' shareable, non-restricted facts — NEVER `listAllInsights` (the cross-user leak). ---
    insightsList: async (): Promise<Insight[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      // Bring existing insights up to the shared-with-partner default once (owner decision, 2026-07-17),
      // before reading, so both this list AND a partner's context reflect it. Idempotent + non-blocking.
      await ensurePartnerShareBackfill(ctx.fs, ctx.key, personId);
      // Own insights in full — the user sees ALL their own facts, INCLUDING their own `restricted` intake
      // facts (their own data). Never another member's insights.
      const own = await listInsightsForPerson(ctx.fs, ctx.key, personId);
      // Enrich a sent-questionnaire insight with WHO it's about (#129) so Memory can group it as a "response
      // to your questionnaire" instead of mislabelling it "about you," AND with its source questionnaire's
      // title + id so the card can link "From <title>" to that questionnaire's Results (62 §context). New
      // insights carry the `about` in provenance; pre-#129 ones + the source ref are resolved read-time from
      // the originating assignment. A self check-in (recipient === subject) resolves `about` to null and
      // stays a normal "about you" insight.
      const ownEnriched = await Promise.all(
        own.map(async (raw) => {
          // Normalize a pre-fix third-person self-assessment summary to "you/your" (matches its facts + the
          // rest of Memory) — read-time, so existing insights read consistently without a rewrite.
          const base =
            raw.source === 'test' ? { ...raw, summary: normalizeTestSummary(raw.summary) } : raw;
          const about =
            base.provenance.aboutPersonId || base.provenance.aboutName
              ? null
              : await resolveInsightAbout(ctx.fs, ctx.key, base);
          const sourceRef = await resolveInsightSource(ctx.fs, ctx.key, base);
          if (!about && !sourceRef) return base;
          return {
            ...base,
            provenance: { ...base.provenance, ...(about ?? {}), ...(sourceRef ?? {}) },
          };
        }),
      );
      // Related people contribute ONLY their shareable, non-restricted facts (the `summarizeForContext`
      // boundary, re-gated at read via `listRelatedPeople`); their summaries + private/restricted facts
      // never cross over.
      // Enrich each related person with the relationship type(s) describing how THEY relate to this viewer
      // (42 §5.2), so type-scoped facts resolve against the live graph at read time.
      const relationships = await listRelationships(ctx.fs, ctx.key);
      const related = (await listRelatedPeople(ctx.fs, ctx.key, personId)).map((other) => ({
        ...other,
        grantedTypes: relationshipTypesFromSubjectToViewer(other.id, personId, relationships),
      }));
      const relatedShareable = await listRelatedShareableInsights(
        ctx.fs,
        ctx.key,
        personId,
        related,
      );
      return [...ownEnriched, ...relatedShareable];
    },
    memoryOutboundSharing: async (): Promise<OutboundSharing> => {
      // The transparency read (42 §5.3): the active person's OWN outbound sharing only. Gated on `memory.own`
      // + scoped to the active person — a person never sees another's sharing.
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own')))
        return { items: [], keptPrivateCount: 0 };
      const personId = await activePersonId();
      if (!personId) return { items: [], keptPrivateCount: 0 };
      const relationships = await listRelationships(ctx.fs, ctx.key);
      return listOutboundSharing(ctx.fs, ctx.key, personId, relationships);
    },
    memorySetScopeBatch: async (input): Promise<{ updated: number }> => {
      // The per-category bulk scope change (68 §6). Gated `memory.own` for the fact writes; the answer writes
      // additionally require `intake.own` (a `memory.own`-only caller has its answerTargets skipped, never
      // errored — §7). Active-person-scoped: a person can only ever rescope THEIR OWN items (the boundary).
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return { updated: 0 };
      const personId = await activePersonId();
      if (!personId) return { updated: 0 };
      const { types, factTargets, answerTargets } = SetScopeBatchSchema.parse(input);
      const includeAnswers = await activePersonCan(ctx.fs, ctx.key, 'intake.own');
      return applyScopeBatch({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        types,
        factTargets,
        answerTargets,
        includeAnswers,
        now: new Date(),
      });
    },
    memorySetProfileFieldShared: async (input): Promise<boolean> => {
      // The profile-field lock toggle (68 §3.8/§6). Own-scoped + gated `memory.own` — deliberately NOT
      // `people.manage`, so a member can share/lock THEIR OWN field. Flips the field in/out of the active
      // person's own `Person.privateFields` (never another person's record — the trust boundary).
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return false;
      const personId = await activePersonId();
      if (!personId) return false;
      const { field, shared } = SetProfileFieldSharedSchema.parse(input);
      const person = await getPerson(ctx.fs, ctx.key, personId);
      if (!person) return false;
      const locked = new Set(person.privateFields ?? []);
      const wasLocked = locked.has(field);
      if (shared) locked.delete(field);
      else locked.add(field);
      // No-op toggle (already in the requested state) → skip the write to avoid spurious sync churn.
      if (wasLocked === !shared) return true;
      const next: Person = { ...person, updatedAt: new Date().toISOString() };
      if (locked.size > 0) next.privateFields = [...locked];
      else delete next.privateFields;
      await savePerson(ctx.fs, ctx.key, next);
      return true;
    },
    // --- Email engagement (67 §6) — the Resend key is resolved host-side + never returned ---
    emailStatus: async (): Promise<EmailStatus> => {
      const ctx = await host.vaultAndKey();
      const noneStatus: EmailStatus = {
        configured: false,
        domainVerified: false,
        hasSharedKey: false,
        hasDeviceOverride: false,
        resolvedReady: false,
        source: 'none',
        intimacyEligible: false,
      };
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own')))
        return noneStatus;
      // Intimacy-email eligibility = the person's own shared 18+ acknowledgement (67 §8.2).
      const intimacyEligible =
        (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      return emailStatusOf(host.secrets, ctx.fs, ctx.key, { intimacyEligible });
    },
    emailVerify: async (): Promise<EmailVerifyResult> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        return { ok: false, reason: 'NO_KEY' };
      const resolved = await resolveResendKey(host.secrets, ctx.fs, ctx.key);
      if (!resolved.key) return { ok: false, reason: 'NO_KEY' };
      const result = await host.email.verify(resolved.key);
      // Persist the domain-verification state so `EmailStatus.domainVerified` reflects a real verify.
      if (result.ok) {
        await updateEmailConfig(
          ctx.fs,
          ctx.key,
          { domainVerified: result.domains.some((d) => d.verified) },
          new Date(),
        );
      }
      return result;
    },
    emailSetConfig: async (input): Promise<EmailStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        return emailStatusOf(
          host.secrets,
          ctx?.fs ?? host.fileSystem(''),
          ctx?.key ?? new Uint8Array(),
        );
      await updateEmailConfig(ctx.fs, ctx.key, EmailSetConfigSchema.parse(input), new Date());
      return emailStatusOf(host.secrets, ctx.fs, ctx.key);
    },
    emailSetSharedKey: async (input): Promise<EmailStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        return emailStatusOf(
          host.secrets,
          ctx?.fs ?? host.fileSystem(''),
          ctx?.key ?? new Uint8Array(),
        );
      const { value } = EmailSetSharedKeySchema.parse(input);
      await writeSharedResendKey(ctx.fs, ctx.key, value, new Date());
      return emailStatusOf(host.secrets, ctx.fs, ctx.key);
    },
    emailClearSharedKey: async (): Promise<EmailStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        return emailStatusOf(
          host.secrets,
          ctx?.fs ?? host.fileSystem(''),
          ctx?.key ?? new Uint8Array(),
        );
      await clearSharedResendKey(ctx.fs, ctx.key, new Date());
      return emailStatusOf(host.secrets, ctx.fs, ctx.key);
    },
    emailGetPrefs: async (): Promise<EmailPrefs | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'email.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      return readEmailPrefs(ctx.fs, ctx.key, personId);
    },
    emailSetPrefs: async (input): Promise<EmailPrefs> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own'))) {
        // Return a harmless default so the renderer store has a shape; nothing is persisted.
        return {
          schemaVersion: 1,
          families: {},
          richness: 'brief',
          intimacyEmailOptIn: false,
          paused: false,
          digestDay: 0,
          digestTime: 'evening',
          unsubscribeToken: 'unavailable',
        };
      }
      // Intimacy-email opt-in requires the person's own shared 18+ acknowledgement (67 §8.2); `setEmailPrefs`
      // coerces the opt-in OFF when ineligible. (The mutual/partner gates apply later, at SEND time.)
      const eligible =
        (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      return setEmailPrefs(
        ctx.fs,
        ctx.key,
        personId,
        EmailSetPrefsSchema.parse(input),
        eligible,
        new Date(),
      );
    },
    emailAcknowledgeAdult: async (): Promise<EmailStatus> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      const noneStatus: EmailStatus = {
        configured: false,
        domainVerified: false,
        hasSharedKey: false,
        hasDeviceOverride: false,
        resolvedReady: false,
        source: 'none',
        intimacyEligible: false,
      };
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own')))
        return noneStatus;
      // The person confirms they're 18+ (the shared app-wide ack, 67 §8.2) — then intimacy email is opt-in-able.
      await acknowledgeAdult(ctx.fs, ctx.key, personId);
      return emailStatusOf(host.secrets, ctx.fs, ctx.key, { intimacyEligible: true });
    },
    emailSend: async (input): Promise<EmailSendResult> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own')))
        return { ok: false, reason: 'NOT_CONFIGURED' };
      const { family } = EmailSendInputSchema.parse(input);
      // Phase 0 composes only the welcome family; reject anything else (no scaffolding for the unbuilt
      // families — else a hand-crafted call would send welcome content mislabeled as another family).
      if (family !== 'welcome') return { ok: false, reason: 'NOT_CONFIGURED' };
      const now = new Date();
      // Welcome is sent ONCE (67 §3.2): if one was already logged for this person, no-op idempotently so a
      // re-trigger (a re-open, a re-saved address) never re-sends.
      const prior = await listEmailActivity(ctx.fs, ctx.key, personId, { family: 'welcome' });
      const sent = prior.find((entry) => entry.status !== 'failed');
      if (sent) return { ok: true, entryId: sent.id };
      // Crisis suppresses ALL email (§8.1): a recurring crisis signal blocks the send.
      const insights = await listInsightsForPerson(ctx.fs, ctx.key, personId);
      const crisisSuppressed = aggregateCrisisSignal({
        insights,
        now,
        nightmareNudge: false,
      }).recurring;
      const resolved = await resolveResendKey(host.secrets, ctx.fs, ctx.key);
      // Phase 0 composes only the welcome family; later phases add each family's composer.
      const person = await getPerson(ctx.fs, ctx.key, personId);
      const composed = buildWelcomeEmail({
        ...(person?.displayName ? { recipientName: person.displayName } : {}),
      });
      return sendFamilyEmail({
        fs: ctx.fs,
        key: ctx.key,
        email: host.email,
        resendKey: resolved.key,
        personId,
        family,
        composed,
        crisisSuppressed,
        now,
      });
    },
    emailSendQuestionnaireDelivery: async (input): Promise<EmailSendResult> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      // The SENDER (active person) triggers the delivery; gate on their own email capability. NOT_CONFIGURED
      // when unavailable so the renderer falls back cleanly to the `mailto:` hand-off (67 §7).
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own')))
        return { ok: false, reason: 'NOT_CONFIGURED' };
      const parsed = EmailSendQuestionnaireDeliverySchema.parse(input);
      const resolved = await resolveResendKey(host.secrets, ctx.fs, ctx.key);
      const composed = buildQuestionnaireDeliveryEmail({
        subject: parsed.subject,
        message: parsed.message,
        link: parsed.link,
      });
      // Family A goes to the RECIPIENT's contact address, not the sender's engagement address; it is not
      // crisis-suppressed and not gated on the recipient's opt-in (67 §3.2/§7). The one gate the core applies
      // is that the household is configured + a recipient address is present.
      const now = new Date();
      const result = await sendQuestionnaireDeliveryEmail({
        fs: ctx.fs,
        key: ctx.key,
        email: host.email,
        resendKey: resolved.key,
        senderPersonId: personId,
        toAddress: parsed.toAddress,
        composed,
        now,
      });
      // Phase 3: on a successful delivery to a known assignment, schedule an unanswered-reminder for a few
      // days out (canceled on the next reconcile once they answer). Best-effort — never fails the delivery.
      if (result.ok && parsed.assignmentId) {
        try {
          await scheduleQuestionnaireReminder({
            fs: ctx.fs,
            key: ctx.key,
            email: host.email,
            resendKey: resolved.key,
            senderPersonId: personId,
            toAddress: parsed.toAddress,
            originalSubject: parsed.subject,
            assignmentId: parsed.assignmentId,
            now,
          });
        } catch {
          // scheduling the reminder is a best-effort follow-up; the delivery already succeeded.
        }
      }
      return result;
    },
    emailSendTransactional: async (input): Promise<EmailSendResult> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own')))
        return { ok: false, reason: 'NOT_CONFIGURED' };
      const parsed = EmailSendTransactionalSchema.parse(input);
      // Only the emailable notification kinds (67 §3.2) — reject anything else (no scaffolding; and a
      // caller can't email arbitrary-kind content to their own inbox outside the allowlist).
      if (!isEmailableTransactionalKind(parsed.kind)) return { ok: false, reason: 'FAMILY_OFF' };
      const resolved = await resolveResendKey(host.secrets, ctx.fs, ctx.key);
      const composed = buildTransactionalEmail({
        title: parsed.title,
        ...(parsed.body ? { body: parsed.body } : {}),
      });
      // Idempotent on the source key; routes through sendFamilyEmail (engagement address + transactional
      // opt-in + pause). Not crisis-suppressed (§7 — transactional is not a C/D/E/F family).
      return sendTransactionalEmail({
        fs: ctx.fs,
        key: ctx.key,
        email: host.email,
        resendKey: resolved.key,
        personId,
        sourceKey: parsed.sourceKey,
        composed,
        now: new Date(),
      });
    },
    emailScheduleReconcile: async (input): Promise<EmailReconcileResult> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own')))
        return { ok: false, reason: 'NOT_CONFIGURED' };
      const auto = EmailReconcileSchema.parse(input ?? {}).auto ?? true;
      const now = new Date();
      // 24h per-person throttle on the AUTO cadence (the autoCheckins precedent); a manual run forces.
      if (auto) {
        const device = await host.readDeviceState();
        const last = device.emailScheduledAt?.[personId];
        if (last && now.getTime() - new Date(last).getTime() < RECONCILE_THROTTLE_MS)
          return { ok: false, reason: 'SKIPPED' };
      }
      const resolved = await resolveResendKey(host.secrets, ctx.fs, ctx.key);
      const prefs = await readEmailPrefs(ctx.fs, ctx.key, personId);
      const insights = await listInsightsForPerson(ctx.fs, ctx.key, personId);
      const crisisSuppressed = aggregateCrisisSignal({
        insights,
        now,
        nightmareNudge: false,
      }).recurring;
      const person = await getPerson(ctx.fs, ctx.key, personId);
      // A provisioned relay enables the one-click interactive re-engagement email + draining its taps
      // (67 §3.5 / Phase 4). The Cloudflare token + drain secret stay host-side, never crossing IPC.
      const relayConfig = await readRelayConfig(ctx.fs, ctx.key);
      const relayParts = relayConfig
        ? {
            relay: createRelayHttpClient(
              relayConfig.endpointUrl,
              relayConfig.drainSecret,
              host.relay.fetch,
            ),
            relayEndpoint: relayConfig.endpointUrl,
          }
        : {};
      // The AI bundle (Phase 5) — enables family E AI Coach Suggestions + analyzing an emailed check-in. The
      // Claude key is resolved host-side and never crosses IPC; absent ⇒ no suggestion email is generated.
      const aiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      const result = await reconcileEmailSchedule({
        fs: ctx.fs,
        key: ctx.key,
        email: host.email,
        resendKey: resolved.key,
        personId,
        prefs,
        crisisSuppressed,
        now,
        ...(person?.displayName ? { recipientName: person.displayName } : {}),
        ...relayParts,
        ai: { client: host.claude, apiKey: aiKey, model: await host.activeModel() },
      });
      // Stamp the throttle only on a real run (not a NOT_CONFIGURED short-circuit) — the memoryRefresh pattern.
      if (result.ok) {
        const latest = await host.readDeviceState();
        await host.updateDeviceState({
          emailScheduledAt: {
            ...(latest.emailScheduledAt ?? {}),
            [personId]: now.toISOString(),
          },
        });
      }
      return result;
    },
    emailResponses: async (): Promise<EmailResponse[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own'))) return [];
      return listEmailResponses(ctx.fs, ctx.key, personId);
    },
    emailEditResponse: async (input): Promise<EmailResponse | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own'))) return null;
      const { id, answer } = EmailEditResponseSchema.parse(input);
      // Own-scoped — the active person edits only their OWN responses (the path is under their vault).
      return editEmailResponse(ctx.fs, ctx.key, personId, id, answer);
    },
    emailAllActivity: async (): Promise<OwnerEmailActivityEntry[]> => {
      const ctx = await host.vaultAndKey();
      // Owner-only (67 §3.7) — the full-visibility Email-activity view across every member.
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) return [];
      return listAllEmailActivity(ctx.fs, ctx.key);
    },
    emailContent: async (input): Promise<EmailContentSnapshot | null> => {
      const ctx = await host.vaultAndKey();
      // Owner-only (67 §3.7) — read the stored rendered content of a member's sent email ("see what was sent").
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) return null;
      const { personId, id } = EmailContentInputSchema.parse(input);
      return getEmailContent(ctx.fs, ctx.key, personId, id);
    },
    emailMutualGreenLights: async (): Promise<MutualGreenLight[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own'))) return [];
      // Own-scoped: the active person's green lights with their partners (67 §3.6).
      return computeMutualGreenLights(ctx.fs, ctx.key, personId);
    },
    emailIntimacyOffers: async (): Promise<IntimacyInventoryOffer[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own'))) return [];
      return listIntimacyInventoryOffers(ctx.fs, ctx.key, personId);
    },
    emailApplyIntimacyOffer: async (input): Promise<boolean> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own'))) return false;
      const { actKey } = EmailIntimacyOfferSchema.parse(input);
      // Own-data only — an explicit-confirm inventory bump on the ACTIVE person's own intake (67 §3.6).
      return applyIntimacyInventoryOffer(ctx.fs, ctx.key, personId, actKey, new Date());
    },
    emailActivity: async (input): Promise<EmailActivityEntry[]> => {
      const ctx = await host.vaultAndKey();
      const activeId = ctx ? await activePersonId() : null;
      if (!ctx || !activeId || !(await activePersonCan(ctx.fs, ctx.key, 'email.own'))) return [];
      const parsed = EmailActivitySchema.parse(input ?? {});
      const target = parsed.personId ?? activeId;
      // Reading another person's activity is the owner view — `people.manage`-gated (67 §6).
      if (target !== activeId && !(await activePersonCan(ctx.fs, ctx.key, 'people.manage')))
        return [];
      return listEmailActivity(ctx.fs, ctx.key, target, {
        ...(parsed.family ? { family: parsed.family as EmailActivityEntry['family'] } : {}),
        ...(parsed.from ? { from: parsed.from } : {}),
        ...(parsed.to ? { to: parsed.to } : {}),
      });
    },
    insightsAnalyze: async (input): Promise<QuestionnaireAnalyzeResult> => {
      const deps = await aiDeps('questionnaires.viewResults');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      return analyzeAssignment(deps, AnalyzeSchema.parse(input));
    },
    insightsApprove: async (input): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const p = InsightEditSchema.parse(input);
      // A person can only ever approve/edit their OWN insight (the subject is always the active person —
      // the sender for a questionnaire/compatibility draft, the dreamer/intaker otherwise). Reject any other
      // subject so a member can't reach into another's memory by passing their id (spec 20 §6).
      if (p.subjectPersonId !== (await activePersonId())) return null;
      return updateInsight(ctx.fs, ctx.key, p.subjectPersonId, p.id, {
        approved: true,
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
        ...(p.facts !== undefined ? { facts: p.facts } : {}),
      });
    },
    insightsUpdate: async (input): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const p = InsightEditSchema.parse(input);
      if (p.subjectPersonId !== (await activePersonId())) return null;
      return updateInsight(ctx.fs, ctx.key, p.subjectPersonId, p.id, {
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
        ...(p.facts !== undefined ? { facts: p.facts } : {}),
      });
    },
    insightsDelete: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return;
      const { subjectPersonId, id } = InsightIdSchema.parse(input);
      if (subjectPersonId !== (await activePersonId())) return;
      await deleteInsight(ctx.fs, subjectPersonId, id);
    },
    insightsFlag: async (input): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = InsightFlagSchema.parse(input);
      // flagInsightFact loads the ACTIVE person's own insight by id — a person can only flag their own.
      return flagInsightFact(
        ctx.fs,
        ctx.key,
        personId,
        p.insightId,
        p.factId ?? null,
        p.flagged,
        new Date(),
      );
    },
    memoryRefresh: async (input): Promise<MemoryReconcileResult> => {
      const auto = input?.auto === true;
      // An AUTOMATIC pass (renderer cadence) only runs when warranted: the opt-out setting is honored, and the
      // threshold/gap/throttle gate must pass — otherwise it's a calm SKIPPED no-op that never spends. A MANUAL
      // Refresh always forces (skips this gate). The throttle marker is device-local + per-person.
      let autoStamp: { personId: string } | null = null;
      if (auto) {
        const ctx = await host.vaultAndKey();
        const personId = await activePersonId();
        if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) {
          return { ok: false, reason: 'SKIPPED' };
        }
        if ((await readVaultSettingsValues(ctx.fs))['memory.autoReconcile'] === false) {
          return { ok: false, reason: 'SKIPPED' };
        }
        const approved = (await listInsightsForPerson(ctx.fs, ctx.key, personId)).filter(
          (i) => i.approved,
        );
        const device = await host.readDeviceState();
        const lastCheckedAt = device.memoryReconcileCheckedAt?.[personId];
        if (!shouldAutoReconcile({ insights: approved, lastCheckedAt, now: new Date() })) {
          return { ok: false, reason: 'SKIPPED' };
        }
        autoStamp = { personId };
      }
      // Reuse the AI-deps assembly (gates on `memory.own`, reads the key host-side, never to the renderer).
      const deps = await aiDeps('memory.own');
      if (!deps)
        return { ok: false, reason: auto ? 'SKIPPED' : 'DENIED', message: 'Not available.' };
      // Free no-AI step that rides this pass (39 §4.5): retro-tag a legacy untagged portrait's facts with a
      // life-area so it topic-narrows in context like a fresh one. Idempotent; never bumps updatedAt.
      await retroTagLegacyPortraits(deps.fs, deps.key, deps.personId);
      const result = await reconcileInsights(deps);
      // spec 69 §5.6 — ride the SAME reconcile cadence (launch/focus, 24h throttle, ≥N-new-signals gate) to
      // refresh the active person's coverage map, so generation steers to genuinely new ground. Metered
      // `questionnaire.profile`, budget-gated + fail-safe inside `refreshCoverage`. Best-effort: a coverage
      // failure never fails the memory refresh. Then refresh the forward-first candidate feed (spec 70 §3.2/§5.4)
      // on the SAME cadence, right after — it reads the freshly-placed coverage map to propose "what's next".
      try {
        // spec 71 §5.6 — seed the ask ledger from existing sends BEFORE the coverage/candidate passes, so both
        // read a correct history on the very first run. Idempotent (a completed backfill is an immediate no-op)
        // and fail-safe (a degraded run leaves the flag unset and simply retries tomorrow).
        //
        // Backfilled for EVERY household person, not just the active one: the ledger is owned by the RECIPIENT
        // (generation reads `recipientPersonId`), so seeding only the person at the keyboard would leave the
        // fix inert for exactly the case it was built for — one member drafting for their partner — until that
        // partner happened to open the app themselves. The active person leads so their own surfaces are
        // correct first; everyone with no send history is flagged done immediately, at the cost of one scan.
        const backfillIds = [
          deps.personId,
          ...(await listPeople(deps.fs, deps.key))
            .map((p) => p.id)
            .filter((id) => id !== deps.personId),
        ];
        for (const id of backfillIds) {
          await backfillAskLedger(deps, id);
        }
        await refreshCoverage(deps, deps.personId);
        await refreshNextCandidates(deps, deps.personId);
      } catch {
        // coverage/candidate refresh is a side-benefit of this cadence, not part of the memory-refresh contract
      }
      // Consume the 24h throttle window only when the pass DIDN'T fail for a no-spend transient reason
      // (AI off / over budget / a stream ERROR — all bail before metering). Those should retry on the next
      // launch, not be suppressed for 24h (the §3.3 "falls back to manual" intent). A pass that DID spend —
      // success, nothing-to-do, or a billed-but-unparseable reply — stamps, so it can't re-spend every tick.
      const noSpend =
        result.reason === 'AI_OFF' || result.reason === 'BUDGET' || result.reason === 'ERROR';
      if (autoStamp && !noSpend) {
        const device = await host.readDeviceState();
        await host.updateDeviceState({
          memoryReconcileCheckedAt: {
            ...(device.memoryReconcileCheckedAt ?? {}),
            [autoStamp.personId]: new Date().toISOString(),
          },
        });
      }
      return result;
    },
    memoryReconcileState: async (): Promise<MemoryReconcileState> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return { proposals: [] };
      const personId = await activePersonId();
      if (!personId) return { proposals: [] };
      const insights = await listInsightsForPerson(ctx.fs, ctx.key, personId);
      const lastReconciledAt = insights
        .map((i) => i.lastReconciledAt)
        .filter((v): v is string => typeof v === 'string')
        .sort()
        .at(-1);
      const proposals = await listMergeProposals(ctx.fs, ctx.key, personId);
      return { ...(lastReconciledAt ? { lastReconciledAt } : {}), proposals };
    },
    memoryResolveProposal: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return;
      const personId = await activePersonId();
      if (!personId) return;
      const p = ResolveProposalSchema.parse(input);
      // Scoped to the active person's OWN proposals (the trust boundary).
      await resolveMergeProposal(ctx.fs, ctx.key, personId, p.proposalId, p.action, new Date());
    },
    goalsList: async (): Promise<Goal[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return listGoals(ctx.fs, ctx.key, personId);
    },
    goalsSetStatus: async (input): Promise<Goal | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = GoalSetStatusSchema.parse(input);
      // Scoped to the active person's OWN goals — a person can only change their own (the trust boundary).
      return setGoalStatus(ctx.fs, ctx.key, personId, p.goalId, p.status, new Date());
    },
    goalsUpdate: async (input): Promise<Goal | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = GoalUpdateSchema.parse(input);
      return updateGoal(
        ctx.fs,
        ctx.key,
        personId,
        p.goalId,
        {
          ...(p.text !== undefined ? { text: p.text } : {}),
          ...(p.due !== undefined ? { due: p.due } : {}),
          ...(p.horizon !== undefined ? { horizon: p.horizon } : {}),
        },
        new Date(),
      );
    },
    goalsDelete: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return;
      const personId = await activePersonId();
      if (!personId) return;
      const p = GoalDeleteSchema.parse(input);
      // The delete path is `people/<activePerson>/goals/<id>` — inherently scoped to the active person's
      // OWN goals, so a person can never remove another's (the trust boundary).
      await deleteGoal(ctx.fs, personId, p.goalId);
    },
    goalsCreate: async (input): Promise<Goal | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = GoalCreateSchema.parse(input);
      // Written to `people/<activePerson>/goals/` — inherently the active person's OWN goal (trust boundary).
      return createGoal(
        ctx.fs,
        ctx.key,
        personId,
        {
          text: p.text,
          ...(p.due !== undefined ? { due: p.due } : {}),
          ...(p.horizon !== undefined ? { horizon: p.horizon } : {}),
          ...(p.lifeArea !== undefined ? { lifeArea: p.lifeArea } : {}),
        },
        new Date(),
      );
    },
    goalsSuggest: async (): Promise<GoalSuggestResult> => {
      // Metered + budget-gated inside `suggestGoals`; gated `memory.own` + active-person-scoped via `aiDeps`.
      const deps = await aiDeps('memory.own');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      return suggestGoals(deps);
    },
    // --- Proactive coaching (40-proactive-coaching) — gated `sessions.own`, active-person-scoped ---
    coachingGetPrefs: async (): Promise<CoachingPrefs | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      return getCoachingPrefs(ctx.fs, ctx.key, personId);
    },
    coachingSetPrefs: async (input): Promise<CoachingPrefs | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = CoachingSetPrefsSchema.parse(input);
      // Scoped to the active person's OWN coaching prefs (the trust boundary) — each persona tunes their own.
      // A partial patch merges (each field independent), so toggling one never clobbers the other.
      return setCoachingPrefs(ctx.fs, ctx.key, personId, {
        ...(p.proactivity !== undefined ? { proactivity: p.proactivity } : {}),
        ...(p.dailyReflection !== undefined ? { dailyReflection: p.dailyReflection } : {}),
      });
    },
    coachingGetSynthesis: async (): Promise<CoachingSynthesis | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      return getSynthesis(ctx.fs, ctx.key, personId);
    },
    coachingSynthesize: async (input): Promise<CoachingSynthesisResult> => {
      const { auto } = CoachingSynthesizeSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // AI off → skip silently (40 §7) — no dead button (the card gates on `configured`), no alarming log.
      if ((await readVaultSettingsValues(ctx.fs))['ai.enabled'] === false) {
        return { ok: false, reason: 'AI_OFF', message: 'Turn on AI in Settings to use this.' };
      }
      // Proactivity `off` disables the synthesis pass entirely (40 §3.6) — a calm skip, never spends.
      const level = await getProactivity(ctx.fs, ctx.key, personId);
      if (level === 'off') {
        return { ok: false, reason: 'EMPTY', message: 'Proactive coaching is turned off.' };
      }
      // An AUTOMATIC pass (renderer cadence) only runs when warranted (throttle window + new-insight delta);
      // a MANUAL force bypasses just the throttle (still budget/key-gated). The marker is device-local/per-person.
      const now = new Date();
      if (auto) {
        const insights = await listInsightsForPerson(ctx.fs, ctx.key, personId);
        // The daily Home reflection is opt-out-able without turning off proactivity (60 §6.3) — a calm skip.
        if (!(await getDailyReflectionEnabled(ctx.fs, ctx.key, personId))) {
          return { ok: false, reason: 'EMPTY', message: 'Daily reflection is turned off.' };
        }
        // Suppress the auto-reflection during recurring distress (60 §8) — Home leads with support, not a
        // generated observation. The manual tap still works (the person asked for it); the always-on crisis
        // support surfaces regardless.
        const ownApproved = insights.filter((i) => i.approved && i.subjectPersonId === personId);
        if (
          aggregateCrisisSignal({ insights: ownApproved, nightmareNudge: false, now }).recurring
        ) {
          return { ok: false, reason: 'EMPTY', message: 'Support comes first right now.' };
        }
        const device = await host.readDeviceState();
        const lastSynthesizedAt = device.coachingSynthesizedAt?.[personId];
        const newInsightCount = countNewInsights(insights, lastSynthesizedAt);
        if (
          !shouldSynthesize(
            {
              level,
              newInsightCount,
              ...(lastSynthesizedAt ? { lastSynthesizedAt } : {}),
            },
            now,
          )
        ) {
          return { ok: false, reason: 'EMPTY', message: 'Nothing new to notice yet.' };
        }
      }
      const deps = await aiDeps('sessions.own');
      if (!deps) return { ok: false, reason: 'ERROR', message: 'Not available.' };
      const result = await synthesize(deps);
      // Stamp the throttle marker on a successful run (auto or manual) so auto won't re-fire within the window.
      if (result.ok) {
        const device = await host.readDeviceState();
        await host.updateDeviceState({
          coachingSynthesizedAt: {
            ...(device.coachingSynthesizedAt ?? {}),
            [personId]: new Date().toISOString(),
          },
        });
      }
      return result;
    },
    // --- Auto check-ins (63-auto-checkins §6) — gated `questionnaires.autoCheckin`, active-person-scoped ---
    autoCheckinsGetConfig: async (): Promise<AutoCheckinConfig | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.autoCheckin')))
        return null;
      const personId = await activePersonId();
      if (!personId) return null;
      return getAutoCheckinConfig(ctx.fs, ctx.key, personId);
    },
    autoCheckinsSetConfig: async (input): Promise<AutoCheckinConfig | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.autoCheckin')))
        return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const patch = AutoCheckinSetConfigSchema.parse(input);
      // Owner-only to target ANOTHER person (§3.6 — the compensating control for the no-consent model). A
      // non-owner may configure only their OWN self-stream; a person-target in the patch needs `people.manage`.
      // The renderer gates the "Add a person" UI, but the trust boundary is HERE: reject the write (return the
      // unchanged config) rather than persist a non-owner's other-target.
      if (
        patch.targets?.some((t) => t.target.kind === 'person') &&
        !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))
      ) {
        return getAutoCheckinConfig(ctx.fs, ctx.key, personId);
      }
      return setAutoCheckinConfig(ctx.fs, ctx.key, personId, {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.targets !== undefined ? { targets: patch.targets } : {}),
      });
    },
    autoCheckinsEnsureSeed: async (): Promise<{
      seeded: boolean;
      config: AutoCheckinConfig;
    } | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.autoCheckin')))
        return null;
      const personId = await activePersonId();
      if (!personId) return null;
      // Seed the default-on self stream once, iff onboarding is complete (§5.1) — write-once + idempotent.
      const session = await getIntakeSession(ctx.fs, ctx.key, personId);
      return seedDefaultConfigIfAbsent(ctx.fs, ctx.key, personId, {
        onboardingComplete: session?.status === 'complete',
      });
    },
    autoCheckinsRun: async (input): Promise<AutoCheckinRunResult> => {
      const { auto = true } = AutoCheckinRunSchema.parse(input ?? {});
      // E2E determinism (63 §13) — the `SELFOS_FAKE_STORY_NO_CADENCE` sibling. Disables ONLY the autonomous
      // launch cadence, so a test can observe a MANUAL "Run now" against a known queue state: otherwise the
      // cadence fires on mount, tops the stream up to TARGET_DEPTH, and the later manual run has nothing left
      // to do (and, with the offline fake returning identical questions, its one remaining slot is emptied by
      // the near-dup filter). `globalThis` read so this still typechecks under the web lib.
      const testEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env;
      if (auto && testEnv?.['SELFOS_FAKE_NO_AUTO_CHECKIN_CADENCE']) {
        return { ok: false, reason: 'SKIPPED', message: 'Auto check-ins already ran recently.' };
      }
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (
        !ctx ||
        !personId ||
        !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.autoCheckin'))
      ) {
        return { ok: false, reason: 'SKIPPED', message: 'SelfOS isn’t ready yet.' };
      }
      // AI off → skip silently (no dead affordance, the panel gates on `configured`). §7.
      if ((await readVaultSettingsValues(ctx.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to use auto check-ins.',
        };
      }
      const deps = await aiDeps('questionnaires.autoCheckin');
      if (!deps) return { ok: false, reason: 'SKIPPED', message: 'Not available.' };
      // Crisis suppression (§8.1) — the same aggregate the coaching pass uses, over the author's OWN approved
      // insights. Never overridden by the toggle; computed here (like coachingSynthesize), passed into the engine.
      const ownApproved = (await listInsightsForPerson(ctx.fs, ctx.key, personId)).filter(
        (i) => i.approved && i.subjectPersonId === personId,
      );
      const crisis = aggregateCrisisSignal({
        insights: ownApproved,
        nightmareNudge: false,
        now: deps.now,
      }).recurring;
      const device = await host.readDeviceState();
      const lastCheckedAt = device.autoCheckinCheckedAt?.[personId];
      const result = await runAutoCheckins({
        ...deps,
        crisis,
        auto,
        ...(lastCheckedAt ? { lastCheckedAt } : {}),
      });
      // Stamp the device throttle on any COMPLETED run (so the auto cadence won't re-fire within 24h). Not on
      // AI_OFF/BUDGET/CRISIS/SKIPPED — those retry next launch (mirrors memoryRefresh/coachingSynthesize).
      if (result.ok) {
        const latest = await host.readDeviceState();
        await host.updateDeviceState({
          autoCheckinCheckedAt: {
            ...(latest.autoCheckinCheckedAt ?? {}),
            [personId]: new Date().toISOString(),
          },
        });
      }
      return result;
    },
    // Target visibility & control (§3.3a/§6.6). NOT gated on `questionnaires.autoCheckin` — a person can be
    // TARGETED by an owner without holding it, and must always be able to see + stop it. Scoped strictly to
    // streams targeting the active person (the enumeration never reveals streams aimed at anyone else).
    autoCheckinsIncomingStreams: async (): Promise<IncomingAutoCheckinStream[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return listIncomingAutoCheckinStreams(ctx.fs, ctx.key, personId);
    },
    // The per-stream compact read (spec 69 §3.4/§13): the OWNER's own sent activity for each other-person
    // stream (count + latest date). Own-scoped — only what the active person sent; never the target's data.
    // Gated `questionnaires.autoCheckin` (the same gate that owns the config surface it renders on).
    autoCheckinsSentActivity: async (): Promise<Record<string, AutoCheckinStreamActivity>> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.autoCheckin')))
        return {};
      const personId = await activePersonId();
      if (!personId) return {};
      return autoCheckinSentActivity(ctx.fs, ctx.key, personId);
    },
    autoCheckinsGetBlocks: async (): Promise<AutoCheckinBlocks> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return { schemaVersion: 1, blockedSenders: [] };
      return getAutoCheckinBlocks(ctx.fs, ctx.key, personId);
    },
    autoCheckinsSetBlock: async (input): Promise<AutoCheckinBlocks> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return { schemaVersion: 1, blockedSenders: [] };
      const { senderPersonId, blocked } = AutoCheckinSetBlockSchema.parse(input);
      // The active person edits only their OWN block list (the trust boundary) — the sender can never override it.
      return setAutoCheckinBlock(ctx.fs, ctx.key, personId, senderPersonId, blocked);
    },
    // --- Your Story (64-your-story §5.6) — gated `story.own`, active-person-scoped (the trust boundary) ---
    storyBookTypes: async (): Promise<StoryBookTypeView[]> =>
      // The registry is code (§4) — return a serializable projection (the renderer can't import the story
      // module, which pulls crypto). No gate: it's static, non-personal catalog metadata.
      listBookTypes().map((t) => ({
        id: t.id,
        label: t.label,
        blurb: t.blurb,
        truthMode: t.truthMode,
        summary: t.summary,
        gates: t.gates,
        options: (t.options ?? []).map((o) => ({
          id: o.id,
          label: o.label,
          kind: o.kind,
          ...(o.help ? { help: o.help } : {}),
          ...(o.choices ? { choices: o.choices } : {}),
          ...(o.placeholder ? { placeholder: o.placeholder } : {}),
          ...(o.required ? { required: o.required } : {}),
        })),
        ...(t.sourceSelect ? { sourceSelect: t.sourceSelect } : {}),
        structures: t.structures.map((s) => ({
          id: s.id,
          label: s.label,
          description: s.description,
          ...(s.isDefault ? { isDefault: true } : {}),
        })),
        stylePresets: t.stylePresets.map((p) => ({ id: p.id, label: p.label })),
      })),
    storyList: async (): Promise<BookManifest[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return listBooks(ctx.fs, ctx.key, personId);
    },
    /** The bookshelf (72 §3.1) — every book with enough counted to show it without opening it. */
    storyShelf: async (): Promise<BookShelfEntry[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      // The unit a book is counted in belongs to its TYPE, which lives in the code registry — resolved here
      // so the shelf read stays a pure count and a picture book's pages need no change to it (72 P6).
      return listShelf(ctx.fs, ctx.key, personId, (typeId) => {
        const spine = getBookType(typeId)?.spine;
        return spine?.kind === 'pages'
          ? { one: 'page', many: 'pages' }
          : { one: 'chapter', many: 'chapters' };
      });
    },
    storyCreate: async (input): Promise<BookManifest | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = StoryCreateInputSchema.parse(input);
      const bookType = getBookType(p.type);
      if (!bookType) return null; // only a registered book type
      // The 18+ gate is enforced HERE, not by hiding the card (72 §8.4): a hand-crafted IPC call must not be
      // able to start an adult book without the acknowledgement, whatever the picker showed.
      if (bookType.gates.adult) {
        const acked =
          (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
        if (!acked) return null;
      }
      return createBook(ctx.fs, ctx.key, {
        personId,
        type: p.type,
        title: p.title,
        config: p.config,
        now: new Date(),
      });
    },
    storyGet: async (input): Promise<StoryBookBundle | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const { bookId } = StoryBookRefSchema.parse(input);
      return readBookBundle(ctx.fs, ctx.key, personId, bookId);
    },
    storyGenerateFoundations: async (input): Promise<StoryFoundationsResult> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to write your story.',
        };
      }
      const book = await getBook(deps.fs, deps.key, deps.personId, bookId);
      if (!book) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
      const bookType = getBookType(book.type);
      if (!bookType) return { ok: false, reason: 'ERROR', message: 'Unknown book type.' };
      const exclusions = await getExclusions(deps.fs, deps.key, deps.personId, bookId);
      const result = await generateFoundations(deps, {
        bookId,
        bookType,
        config: book.config,
        exclusions,
      });
      if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
      await applyFoundations(
        deps.fs,
        deps.key,
        deps.personId,
        bookId,
        {
          title: result.title,
          essence: result.essence,
          outline: result.outline,
          timeline: result.timeline,
        },
        new Date(),
      );
      const bundle = await readBookBundle(deps.fs, deps.key, deps.personId, bookId);
      if (!bundle) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
      return { ok: true, bundle };
    },
    // Create-and-draft (64 §3.2): the whole book in one main-side flow — read + outline, AUTO-APPROVE (no
    // review gate), then draft every chapter — streaming per-chapter progress via `story:progress`. Runs in
    // main, so it continues even if the renderer navigates away; the progress stream keeps the store current.
    storyGenerateFullDraft: async (input): Promise<StoryFoundationsResult> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const fail = (
        reason: AiFailureReason | 'AI_OFF',
        message: string,
      ): StoryFoundationsResult => {
        host.emitStoryProgress({
          bookId,
          phase: 'error',
          chaptersDone: 0,
          chaptersTotal: 0,
          message,
        });
        return { ok: false, reason, message };
      };
      const deps = await aiDeps('story.own');
      if (!deps) return fail('NO_KEY', 'SelfOS isn’t ready yet.');
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return fail('AI_OFF', 'Turn on AI in Settings to write your story.');
      }
      const book = await getBook(deps.fs, deps.key, deps.personId, bookId);
      if (!book) return fail('ERROR', 'That book is no longer here.');
      const bookType = getBookType(book.type);
      if (!bookType) return fail('ERROR', 'Unknown book type.');

      // Phase 1 — read everything + propose the outline (the foundations pass).
      host.emitStoryProgress({ bookId, phase: 'reading', chaptersDone: 0, chaptersTotal: 0 });
      const exclusions = await getExclusions(deps.fs, deps.key, deps.personId, bookId);
      const result = await generateFoundations(deps, {
        bookId,
        bookType,
        config: book.config,
        exclusions,
      });
      if (!result.ok) return fail(result.reason, result.message);
      await applyFoundations(
        deps.fs,
        deps.key,
        deps.personId,
        bookId,
        {
          title: result.title,
          essence: result.essence,
          outline: result.outline,
          timeline: result.timeline,
        },
        new Date(),
      );
      // Auto-approve — the person shapes the drafted book with the edit/markup/suggest tools, not a gate.
      await approveOutline(deps.fs, deps.key, deps.personId, bookId, result.outline, new Date());

      // Phase 2 — draft every chapter, streaming per-chapter progress.
      const total = result.outline.parts.reduce((n, p) => n + p.chapters.length, 0);
      host.emitStoryProgress({ bookId, phase: 'writing', chaptersDone: 0, chaptersTotal: total });
      await generateBookChapters(deps, bookId, (p) =>
        host.emitStoryProgress({
          bookId,
          phase: 'writing',
          chaptersDone: p.chaptersDone,
          chaptersTotal: p.chaptersTotal,
          currentTitle: p.title,
          ...(p.craft ? { craft: p.craft } : {}),
        }),
      );
      const bundle = await readBookBundle(deps.fs, deps.key, deps.personId, bookId);
      if (!bundle) return fail('ERROR', 'That book is no longer here.');
      host.emitStoryProgress({ bookId, phase: 'done', chaptersDone: total, chaptersTotal: total });
      return { ok: true, bundle };
    },
    storySaveOutline: async (input): Promise<BookManifest | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = StoryOutlineInputSchema.parse(input);
      if (!(await getBook(ctx.fs, ctx.key, personId, p.bookId))) return null;
      await saveOutline(ctx.fs, ctx.key, personId, p.bookId, p.outline);
      return updateBook(ctx.fs, ctx.key, personId, p.bookId, {}, new Date()); // bump updatedAt
    },
    storyApproveOutline: async (input): Promise<BookManifest | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = StoryOutlineInputSchema.parse(input);
      return approveOutline(ctx.fs, ctx.key, personId, p.bookId, p.outline, new Date());
    },
    storyUpdate: async (input): Promise<BookManifest | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = StoryUpdateInputSchema.parse(input);
      return updateBook(
        ctx.fs,
        ctx.key,
        personId,
        p.bookId,
        {
          // A title the person sets here is their own — clear the `auto` flag so a later foundations pass
          // (e.g. "Start over") never overwrites it (§3.2).
          ...(p.title !== undefined ? { title: p.title, titleAuto: false } : {}),
          ...(p.config !== undefined ? { config: p.config } : {}),
          ...(p.matter !== undefined ? { matter: p.matter } : {}),
          ...(p.essence !== undefined ? { essence: p.essence } : {}),
        },
        new Date(),
      );
    },
    storyDelete: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return;
      const personId = await activePersonId();
      if (!personId) return;
      const { bookId } = StoryBookRefSchema.parse(input);
      if (!(await getBook(ctx.fs, ctx.key, personId, bookId))) return; // only the active person's own book
      await deleteBook(ctx.fs, personId, bookId);
    },
    storyRewriteFromScratch: async (input): Promise<StoryBookBundle | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const { bookId } = StoryBookRefSchema.parse(input);
      if (!(await getBook(ctx.fs, ctx.key, personId, bookId))) return null; // only the active person's own book
      // Reset to the pre-draft state (no AI here) — the renderer re-runs the streamed full-draft afterwards.
      const reset = await rewriteBookFromScratch(ctx.fs, ctx.key, personId, bookId, new Date());
      if (!reset) return null;
      return readBookBundle(ctx.fs, ctx.key, personId, bookId);
    },
    storyGenerateChapters: async (input): Promise<StoryChaptersResult> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to write your story.',
        };
      }
      // Stream per-chapter progress (§3.2) so the "Write your chapters" flow shows the same rich screen as
      // create-and-draft (no reading phase — the outline already exists, so it goes straight to writing).
      const result = await generateBookChapters(deps, bookId, (p) =>
        host.emitStoryProgress({
          bookId,
          phase: 'writing',
          chaptersDone: p.chaptersDone,
          chaptersTotal: p.chaptersTotal,
          currentTitle: p.title,
          ...(p.craft ? { craft: p.craft } : {}),
        }),
      );
      if (!result.ok) {
        host.emitStoryProgress({
          bookId,
          phase: 'error',
          chaptersDone: 0,
          chaptersTotal: 0,
          message: result.message ?? 'Couldn’t write the chapters.',
        });
        return {
          ok: false,
          reason: result.reason ?? 'ERROR',
          message: result.message ?? 'Couldn’t write the chapters.',
        };
      }
      const bundle = await readBookBundle(deps.fs, deps.key, deps.personId, bookId);
      if (!bundle) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
      host.emitStoryProgress({
        bookId,
        phase: 'done',
        chaptersDone: bundle.chapters.length,
        chaptersTotal: bundle.chapters.length,
      });
      return {
        ok: true,
        generated: result.generated,
        bundle,
        ...(result.reason === 'BUDGET' && result.message
          ? { budgetReached: true, message: result.message }
          : {}),
      };
    },
    storyRegenerateChapter: async (input): Promise<StoryChaptersResult> => {
      const { bookId, chapterId } = StoryChapterRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to write your story.',
        };
      }
      const res = await generateChapter(deps, { bookId, chapterId });
      if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
      const bundle = await readBookBundle(deps.fs, deps.key, deps.personId, bookId);
      if (!bundle) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
      return { ok: true, generated: 1, bundle };
    },
    storyReviewChapter: async (input): Promise<StoryBookBundle | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const { bookId, chapterId } = StoryChapterRefSchema.parse(input);
      const chapter = await getChapter(ctx.fs, ctx.key, personId, bookId, chapterId);
      if (!chapter) return null;
      await saveChapter(ctx.fs, ctx.key, personId, bookId, {
        ...chapter,
        status: 'reviewed',
        lastReviewedAt: new Date().toISOString(),
        // Marking a chapter Reviewed resolves the "What changed" diff — drop the retained prior text (§13.5).
        // Explicit `undefined` is omitted on write (JSON), so the persisted chapter no longer carries it.
        previousMarkdown: undefined,
      });
      return readBookBundle(ctx.fs, ctx.key, personId, bookId);
    },
    // --- Chapter version history (§13.9) — non-AI, gated `story.own` + active-person-scoped ---
    storyChapterHistory: async (input): Promise<StoryChapterHistoryView> => {
      const { bookId, chapterId } = StoryChapterRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { chapterId, versions: [] };
      }
      const personId = await activePersonId();
      if (!personId) return { chapterId, versions: [] };
      const history = await getChapterHistory(ctx.fs, ctx.key, personId, bookId, chapterId);
      // Newest first, list entries only — a 20-deep history of 5,000-word chapters is a heavy payload, so
      // the prose crosses IPC one version at a time via storyChapterVersion.
      return {
        chapterId,
        versions: history.versions
          .map((v) => ({
            revision: v.revision,
            savedAt: v.savedAt,
            reason: v.reason,
            words: countWords(v.markdown),
          }))
          .reverse(),
      };
    },
    storyChapterVersion: async (input): Promise<ChapterVersion | null> => {
      const { bookId, chapterId, revision } = StoryChapterVersionInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const history = await getChapterHistory(ctx.fs, ctx.key, personId, bookId, chapterId);
      return history.versions.find((v) => v.revision === revision) ?? null;
    },
    storyRestoreChapterVersion: async (input): Promise<StoryBookBundle | null> => {
      const { bookId, chapterId, revision } = StoryChapterVersionInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const restored = await restoreChapterVersion(
        ctx.fs,
        ctx.key,
        personId,
        bookId,
        chapterId,
        revision,
        new Date(),
      );
      if (!restored) return null;
      return readBookBundle(ctx.fs, ctx.key, personId, bookId);
    },
    // --- Markup layer (§3.3) — non-AI ops gated `story.own` + active-person-scoped ---
    storyGetMarkup: async (input): Promise<ChapterMarkup> => {
      const { bookId, chapterId } = StoryChapterRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { schemaVersion: 1, chapterId, marks: [] };
      }
      const personId = await activePersonId();
      if (!personId) return { schemaVersion: 1, chapterId, marks: [] };
      return getMarkup(ctx.fs, ctx.key, personId, bookId, chapterId);
    },
    storyMark: async (input): Promise<ChapterMarkup> => {
      const { bookId, chapterId, mark } = StoryMarkInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { schemaVersion: 1, chapterId, marks: [] };
      }
      const personId = await activePersonId();
      if (!personId) return { schemaVersion: 1, chapterId, marks: [] };
      return addMark(ctx.fs, ctx.key, personId, bookId, chapterId, mark);
    },
    storyUpdateMark: async (input): Promise<ChapterMarkup | null> => {
      const { bookId, chapterId, markId, patch } = StoryUpdateMarkInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      return updateMark(ctx.fs, ctx.key, personId, bookId, chapterId, markId, patch);
    },
    storyRemoveMark: async (input): Promise<ChapterMarkup> => {
      const { bookId, chapterId, markId } = StoryRemoveMarkInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { schemaVersion: 1, chapterId, marks: [] };
      }
      const personId = await activePersonId();
      if (!personId) return { schemaVersion: 1, chapterId, marks: [] };
      return removeMark(ctx.fs, ctx.key, personId, bookId, chapterId, markId);
    },
    storyEditPassage: async (input): Promise<StoryBookBundle | null> => {
      const { bookId, chapterId, anchor, newText } = StoryEditPassageInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const edited = await editPassage(
        ctx.fs,
        ctx.key,
        personId,
        bookId,
        chapterId,
        anchor,
        newText,
      );
      if (!edited) return null; // orphaned anchor / chapter gone
      return readBookBundle(ctx.fs, ctx.key, personId, bookId);
    },
    storyPinQuote: async (input): Promise<StoryBookBundle | null> => {
      const parsed = StoryPinInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const pinned = await pinPassage(
        ctx.fs,
        ctx.key,
        personId,
        parsed.bookId,
        parsed.chapterId,
        parsed.anchor,
        parsed.text,
        parsed.sourceRef,
      );
      if (!pinned) return null;
      return readBookBundle(ctx.fs, ctx.key, personId, parsed.bookId);
    },
    storyTodos: async (input): Promise<StoryTodoList> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { schemaVersion: 1, todos: [] };
      }
      const personId = await activePersonId();
      if (!personId) return { schemaVersion: 1, todos: [] };
      // Self-heal any "Questions sent" to-do whose check-in has since been answered/closed (§3.7) — it used to
      // sit in the "Needs you" count forever. Free, no AI; the read reflects the fresh state.
      await resolveSentQuestionTodos(ctx.fs, ctx.key, personId, bookId);
      return getTodos(ctx.fs, ctx.key, personId, bookId);
    },
    storyExclusions: async (input): Promise<ExclusionItem[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return getExclusions(ctx.fs, ctx.key, personId, bookId);
    },
    storyExclude: async (input): Promise<StoryExcludeResult> => {
      const { bookId, kind, value, note } = StoryExcludeInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        throw new Error('Not permitted.');
      }
      const personId = await activePersonId();
      if (!personId) throw new Error('No active person.');
      const { exclusions, staled } = await addExclusion(
        ctx.fs,
        ctx.key,
        personId,
        bookId,
        { kind, value, ...(note ? { note } : {}) },
        new Date(),
      );
      const bundle = await readBookBundle(ctx.fs, ctx.key, personId, bookId);
      if (!bundle) throw new Error('That book is no longer here.');
      return { exclusions, bundle, staled };
    },
    storyUnexclude: async (input): Promise<ExclusionItem[]> => {
      const { bookId, itemId } = StoryUnexcludeInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return removeExclusion(ctx.fs, ctx.key, personId, bookId, itemId);
    },
    storyQuoteCandidates: async (input): Promise<QuoteCandidate[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return getQuotes(ctx.fs, ctx.key, personId, bookId);
    },
    storyMineQuotes: async (input): Promise<QuoteCandidate[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return mineQuoteCandidates(ctx.fs, ctx.key, personId, bookId, new Date());
    },
    storySetQuoteStatus: async (input): Promise<QuoteCandidate[]> => {
      const { bookId, quoteId, status } = StorySetQuoteStatusInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return setQuoteStatus(ctx.fs, ctx.key, personId, bookId, quoteId, status);
    },
    storyTodoToQuestions: async (input): Promise<StoryQuestionsResult> => {
      const { bookId, chapterId, focus, anchor } = StoryTodoToQuestionsInputSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to gather answers.',
        };
      }
      // Honors the ≤1-open-check-in invariant + records askedPrompts/openCheckin (§3.7) — so a "Turn into
      // questions" to-do can't pile a second check-in on a gap check-in, and the gap pass won't re-ask its topic.
      const res = await mintTodoCheckIn(deps, { bookId, focus });
      if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
      // Record the to-do only AFTER the mint succeeds (so a failed mint leaves no dangling questionsSent to-do).
      const mark: MarkupMark = {
        id: globalThis.crypto.randomUUID(),
        kind: 'todo',
        text: focus,
        todoKind: 'questions',
        status: 'questionsSent',
        assignmentId: res.assignmentId,
        createdAt: new Date().toISOString(),
        ...(anchor ? { anchor } : {}),
      };
      const markup = await addMark(deps.fs, deps.key, deps.personId, bookId, chapterId, mark);
      return { ok: true, markup, assignmentId: res.assignmentId };
    },
    storyAnswerQuestion: async (input): Promise<StoryAnswerResult> => {
      const { bookId, chapterId, markId } = StoryAnswerQuestionInputSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to ask your biographer.',
        };
      }
      return answerAuthorQuestion(deps, { bookId, chapterId, markId });
    },
    // --- Share a memory (§14) — the biographer interview chat + its synthesized memory ---
    storyMemoryList: async (): Promise<StoryMemoryView[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      return listMemoryViews(ctx.fs, ctx.key, personId);
    },
    storyMemoryGet: async (input): Promise<StoryMemoryDetail | null> => {
      const { memoryId } = StoryMemoryRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const memory = await getMemory(ctx.fs, ctx.key, personId, memoryId);
      if (!memory) return null;
      return {
        memory,
        conversation: await getMemoryConversation(ctx.fs, ctx.key, personId, memoryId),
      };
    },
    storyMemoryOpen: async (input): Promise<StoryMemoryDetail | null> => {
      const { memoryId, seedFocus, bookId, gapId } = StoryMemoryOpenInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      const person = await getPerson(ctx.fs, ctx.key, personId);
      const res = await openMemoryChat({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        personName: person?.displayName ?? '',
        ...(memoryId ? { memoryId } : {}),
        ...(seedFocus ? { seedFocus } : {}),
        ...(bookId ? { bookId } : {}),
        ...(gapId ? { gapId } : {}),
        onDelta: (text) => host.emitStreamChunk('memory', text),
        now: new Date(),
      });
      return { memory: res.memory, conversation: res.conversation };
    },
    storyMemoryTurn: async (input): Promise<ChatTurnResult> => {
      const { memoryId, text, attachments } = StoryMemoryTurnInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      const person = await getPerson(ctx.fs, ctx.key, personId);
      return runMemoryTurn({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        personName: person?.displayName ?? '',
        memoryId,
        userText: text,
        ...(attachments ? { attachments } : {}),
        onDelta: (text2) => host.emitStreamChunk('memory', text2),
        now: new Date(),
      });
    },
    storyMemoryRetry: async (input): Promise<ChatTurnResult> => {
      const { memoryId } = StoryMemoryRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      const person = await getPerson(ctx.fs, ctx.key, personId);
      return retryMemoryReply({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        personName: person?.displayName ?? '',
        memoryId,
        onDelta: (text) => host.emitStreamChunk('memory', text),
        now: new Date(),
      });
    },
    storyMemoryRewind: async (input): Promise<RewindResult> => {
      const { memoryId, index, expect } = StoryMemoryRewindInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'NOT_FOUND' };
      }
      return rewindMemoryConversation(ctx.fs, ctx.key, personId, memoryId, index, expect);
    },
    storyMemoryRegenerate: async (input): Promise<ChatTurnResult> => {
      const { memoryId, index, expect } = StoryMemoryRewindInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      const person = await getPerson(ctx.fs, ctx.key, personId);
      return regenerateMemoryFrom(
        {
          fs: ctx.fs,
          key: ctx.key,
          client: host.claude,
          apiKey,
          model: await host.activeModel(),
          personId,
          personName: person?.displayName ?? '',
          memoryId,
          onDelta: (text) => host.emitStreamChunk('memory', text),
          now: new Date(),
        },
        index,
        expect,
      );
    },
    storyMemorySynthesize: async (input): Promise<StoryMemorySynthesisResult> => {
      const { memoryId } = StoryMemoryRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      if ((await readVaultSettingsValues(ctx.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to save this memory.',
        };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      const person = await getPerson(ctx.fs, ctx.key, personId);
      return synthesizeMemory({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        personName: person?.displayName ?? '',
        memoryId,
        now: new Date(),
      });
    },
    storyMemorySave: async (input): Promise<StoryMemorySaveResult> => {
      const { memoryId, edits } = StoryMemorySaveInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // A saved memory feeds the coach only when memory is on — it rides the SESSIONS master memory toggle
      // (`sessions.memoryEnabled`, the Together/sessions precedent, NOT dreams' own `dreams.memoryEnabled`).
      // The memory itself still saves + feeds the book regardless.
      const memoryEnabled =
        (await readVaultSettingsValues(ctx.fs))['sessions.memoryEnabled'] !== false;
      return saveMemory({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        memoryId,
        ...(edits ? { edits } : {}),
        memoryEnabled,
        now: new Date(),
      });
    },
    storyMemoryDelete: async (input): Promise<void> => {
      const { memoryId } = StoryMemoryRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return;
      await deleteMemory(ctx.fs, ctx.key, personId, memoryId);
    },
    storyMemoryStoreAttachment: async (input): Promise<StoreMemoryAttachmentResult> => {
      const { memoryId, dataBase64, mime, width, height } =
        StoryMemoryStoreAttachmentInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'UNSUPPORTED', message: 'Not permitted.' };
      }
      const bytes = fromBase64(dataBase64);
      return storeMemoryAttachment(ctx.fs, ctx.key, personId, memoryId, bytes, mime, {
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      });
    },
    storyMemoryGetAttachment: async (
      input,
    ): Promise<{ mime: string; dataBase64: string } | null> => {
      const { memoryId, path, mime } = StoryMemoryGetAttachmentInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      // Scope the read to THIS person's memory attachments (the path guard + the active-person prefix).
      if (!path.startsWith(`people/${personId}/story/memories/${memoryId}/`)) return null;
      const bytes = await getMemoryAttachment(ctx.fs, ctx.key, path);
      return bytes ? { mime, dataBase64: toBase64(bytes) } : null;
    },
    storyRefreshCheck: async (input): Promise<StoryRefreshViewResult> => {
      const { bookId, auto } = StoryRefreshInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { staled: 0, rewritten: 0, bundle: null };
      }
      const personId = await activePersonId();
      if (!personId) return { staled: 0, rewritten: 0, bundle: null };

      const now = new Date();
      const DAY_MS = 24 * 60 * 60 * 1000;
      // The AUTO cadence throttles to once per device-local day — a manual "Refresh now" is never throttled.
      if (auto) {
        const last = (await host.readDeviceState()).storyRefreshCheckedAt?.[personId];
        if (last && now.getTime() - Date.parse(last) < DAY_MS) {
          return {
            staled: 0,
            rewritten: 0,
            bundle: await readBookBundle(ctx.fs, ctx.key, personId, bookId),
          };
        }
      }

      // Marking stale is free + always runs; the auto-rewrite needs a real key + AI on + budget (refreshBook).
      // With AI off OR no key, just mark stale so the badges still update — never run the rewrite loop (which
      // would build the corpus then fail NO_KEY per chapter).
      const deps = await aiDeps('story.own');
      const aiReady =
        deps && deps.apiKey && (await readVaultSettingsValues(deps.fs))['ai.enabled'] !== false;
      let staled = 0;
      let rewritten = 0;
      let proposalsAdded: number | undefined;
      let budgetReached: boolean | undefined;
      if (deps && aiReady) {
        // The auto cadence never spends during recurring distress (§8) — computed HOST-SIDE from the person's
        // own approved insights, so it doesn't depend on the renderer having loaded anything.
        let crisis = false;
        if (auto) {
          const own = (await listInsightsForPerson(ctx.fs, ctx.key, personId)).filter(
            (i) => i.approved,
          );
          crisis = aggregateCrisisSignal({ insights: own, nightmareNudge: false, now }).recurring;
        }
        const res = await refreshBook(deps, {
          bookId,
          auto: auto ?? false,
          ...(crisis ? { crisis } : {}),
        });
        staled = res.staled;
        rewritten = res.rewritten;
        proposalsAdded = res.proposalsAdded;
        budgetReached = res.budgetReached;
      } else {
        // AI off / no key: detection is free and still runs — knowing what could go in never spends.
        staled = await detectNewMaterial(ctx.fs, ctx.key, personId, bookId, now);
      }

      // Stamp the auto-cadence throttle after a run (a manual refresh never touches it).
      if (auto) {
        const device = await host.readDeviceState();
        await host.updateDeviceState({
          storyRefreshCheckedAt: { ...device.storyRefreshCheckedAt, [personId]: now.toISOString() },
        });
      }
      const bundle = await readBookBundle(ctx.fs, ctx.key, personId, bookId);
      return {
        staled,
        rewritten,
        bundle,
        ...(proposalsAdded ? { proposalsAdded } : {}),
        ...(budgetReached ? { budgetReached: true } : {}),
      };
    },
    storyProposals: async (input): Promise<StructuralProposal[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return listStructuralProposals(ctx.fs, ctx.key, personId, bookId);
    },
    storyEditOutline: async (input): Promise<StoryOutlineEditResult> => {
      const { bookId, edit } = StoryOutlineEditInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, bundle: null, message: 'Not permitted.' };
      }
      const personId = await activePersonId();
      if (!personId) return { ok: false, bundle: null };
      // Deterministic outline surgery — no AI, no metering. The op union is exhaustive, so a new member
      // is a compile error here rather than a silently ignored edit.
      const at = [ctx.fs, ctx.key, personId, bookId] as const;
      const res = await (async (): Promise<{ ok: boolean; message?: string }> => {
        switch (edit.op) {
          case 'addPart':
            return addPart(...at, edit);
          case 'renamePart':
            return renamePart(...at, edit);
          case 'deletePart':
            return deletePart(...at, edit);
          case 'addChapter':
            return addChapter(...at, edit);
          case 'renameChapter':
            return renameChapter(...at, edit);
          case 'moveChapter':
            return moveChapter(...at, edit);
          case 'splitChapter':
            return splitChapter(...at, edit);
          case 'mergeChapters':
            return mergeChapters(...at, edit);
          case 'deleteChapter':
            return deleteChapter(...at, edit);
        }
      })();
      const bundle = await readBookBundle(ctx.fs, ctx.key, personId, bookId);
      return { ok: res.ok, bundle, ...(res.message ? { message: res.message } : {}) };
    },
    storyEditTimeline: async (input): Promise<StoryTimelineEditResult> => {
      const { bookId, edit } = StoryTimelineEditInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, timeline: null, message: 'Not permitted.' };
      }
      const personId = await activePersonId();
      if (!personId) return { ok: false, timeline: null };
      const at = [ctx.fs, ctx.key, personId, bookId] as const;
      const res = await (async (): Promise<{ ok: boolean; message?: string }> => {
        switch (edit.op) {
          case 'add':
            return addTimelineEvent(...at, edit);
          case 'update':
            return updateTimelineEvent(...at, edit);
          case 'remove':
            return removeTimelineEvent(...at, edit);
        }
      })();
      const stored = await getTimeline(ctx.fs, ctx.key, personId, bookId);
      // Hand back the chronologically sorted view, so a corrected date lands in the right place at once.
      const timeline = stored ? { ...stored, events: sortTimeline(stored.events) } : null;
      return { ok: res.ok, timeline, ...(res.message ? { message: res.message } : {}) };
    },
    storySuggestTitles: async (input): Promise<StoryTitlesResult> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      // `story.own`-gated + active-person-scoped; a metered read (the workshop returns candidates, the
      // person commits the pick through `storyUpdate`). AI-off / no key surface honestly.
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, titles: [], message: 'Not permitted.' };
      if (!deps.apiKey) return { ok: false, titles: [], message: aiUnavailableTitleMessage };
      const res = await suggestTitles(deps, bookId);
      return res.ok
        ? { ok: true, titles: res.titles }
        : { ok: false, titles: [], message: res.message };
    },
    storyRegenerateEssence: async (input): Promise<StoryEssenceResult> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, essence: null, message: 'Not permitted.' };
      if (!deps.apiKey) return { ok: false, essence: null, message: aiUnavailableTitleMessage };
      const res = await regenerateEssence(deps, bookId);
      return res.ok
        ? { ok: true, essence: res.essence }
        : { ok: false, essence: null, message: res.message };
    },
    storyResolveProposal: async (input): Promise<StoryResolveProposalResult> => {
      const { bookId, proposalId, action } = StoryResolveProposalInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, proposals: [], bundle: null, message: 'Not permitted.' };
      }
      const personId = await activePersonId();
      if (!personId) return { ok: false, proposals: [], bundle: null };
      // Approve applies the restructure (mutates the outline/chapters) — no AI spend; dismiss just files it away.
      const res = await resolveProposal(ctx.fs, ctx.key, personId, { bookId, proposalId, action });
      const bundle = await readBookBundle(ctx.fs, ctx.key, personId, bookId);
      return {
        ok: res.ok,
        proposals: res.proposals,
        bundle,
        ...(res.message ? { message: res.message } : {}),
      };
    },
    storyContinuityCheck: async (input): Promise<StoryContinuityResult> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps)
        return { ok: false, findings: [], reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          findings: [],
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to check continuity.',
        };
      }
      return checkContinuity(deps, bookId);
    },
    storyNewMaterial: async (input): Promise<NewMaterialEntry[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return (await getNewMaterial(ctx.fs, ctx.key, personId, bookId)).entries;
    },
    storyAcceptMaterial: async (input): Promise<StoryAcceptMaterialResult> => {
      const { bookId, chapterId } = StoryChapterRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return { ok: false, reason: 'AI_OFF', message: 'Turn on AI in Settings to weave this in.' };
      }
      // Accepting runs ONE rewrite through the craft loop (§3.6). Only on success do the entries clear —
      // a failed or over-budget rewrite leaves the proposal standing so it can be tried again.
      const res = await generateChapter(deps, { bookId, chapterId });
      if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
      await clearNewMaterial(deps.fs, deps.key, deps.personId, bookId, { chapterId });
      return { ok: true };
    },
    storyDeclineMaterial: async (input): Promise<NewMaterialEntry[]> => {
      const { bookId, chapterId } = StoryChapterRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      await declineNewMaterial(ctx.fs, ctx.key, personId, bookId, { chapterId });
      return (await getNewMaterial(ctx.fs, ctx.key, personId, bookId)).entries;
    },
    storyFinishEdition: async (
      input,
    ): Promise<{ ok: boolean; message?: string; bundle: StoryBookBundle | null }> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own')))
        return { ok: false, message: 'Not permitted.', bundle: null };
      const personId = await activePersonId();
      if (!personId) return { ok: false, message: 'Not permitted.', bundle: null };
      const res = await finishEdition(ctx.fs, ctx.key, personId, bookId, new Date());
      const bundle = await readBookBundle(ctx.fs, ctx.key, personId, bookId);
      return res.ok ? { ok: true, bundle } : { ok: false, message: res.message, bundle };
    },
    storyReopenBook: async (input): Promise<StoryBookBundle | null> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      await reopenBook(ctx.fs, ctx.key, personId, bookId, new Date());
      return readBookBundle(ctx.fs, ctx.key, personId, bookId);
    },
    storyManuscriptRead: async (input): Promise<StoryContinuityResult> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps)
        return { ok: false, findings: [], reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          findings: [],
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to read the whole book.',
        };
      }
      return readManuscript(deps, bookId);
    },
    storyContinuity: async (input): Promise<ContinuityFinding[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return listContinuityFindings(ctx.fs, ctx.key, personId, bookId);
    },
    storyResolveContinuity: async (input): Promise<ContinuityFinding[]> => {
      const { bookId, findingId, action } = StoryResolveContinuityInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return resolveContinuityFinding(ctx.fs, ctx.key, personId, { bookId, findingId, action });
    },
    storyLineEdit: async (input): Promise<StoryRevisionResult> => {
      const { bookId, chapterId } = StoryChapterRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to polish a chapter.',
        };
      }
      const res = await lineEditChapter(deps, { bookId, chapterId });
      if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
      const bundle = await readBookBundle(deps.fs, deps.key, deps.personId, bookId);
      if (!bundle) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
      const markup = await getMarkup(deps.fs, deps.key, deps.personId, bookId, chapterId);
      return { ok: true, bundle, markup };
    },
    storyHomeSignal: async (): Promise<StoryHomeSignal> => {
      const empty: StoryHomeSignal = {
        hasBook: false,
        staleChapters: 0,
        pendingProposals: 0,
        unwrittenChapters: 0,
        signature: '',
      };
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return empty;
      const personId = await activePersonId();
      if (!personId) return empty;
      return computeStoryHomeSignal(ctx.fs, ctx.key, personId);
    },
    storyCorpusStats: async (): Promise<StoryCorpusStats> => {
      const empty: StoryCorpusStats = {
        reflections: 0,
        dreams: 0,
        memories: 0,
        answers: 0,
        sessions: 0,
      };
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return empty;
      const personId = await activePersonId();
      if (!personId) return empty;
      return getStoryCorpusStats(ctx.fs, ctx.key, personId);
    },
    storyCastRegister: async (input): Promise<CastEntry[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return getCastRegister(ctx.fs, ctx.key, personId, bookId);
    },
    storyConsent: async (input): Promise<ConsentPerson[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return getConsentRegister(ctx.fs, ctx.key, personId, bookId);
    },
    storySetConsent: async (input): Promise<ConsentPerson[]> => {
      const { bookId, name, consent, pseudonym } = StorySetConsentInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return setConsentEntry(ctx.fs, ctx.key, personId, {
        bookId,
        name,
        consent,
        ...(pseudonym !== undefined ? { pseudonym } : {}),
        now: new Date(),
      });
    },
    storyCompleteness: async (input): Promise<StoryCompleteness> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const empty: StoryCompleteness = { stage: 'beginning', ratio: 0, covered: 0, total: 12 };
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return empty;
      const personId = await activePersonId();
      if (!personId) return empty;
      return getStoryCompleteness(ctx.fs, ctx.key, personId, bookId);
    },
    storyInterviewCheck: async (input): Promise<StoryInterviewCadenceResult> => {
      const { bookId, auto } = StoryInterviewCheckInputSchema.parse(input);
      // E2E determinism (64 §13.6): disable ONLY the autonomous cadence when this test hook is set, so a test
      // can drive the MANUAL gap pass with a known corpus (the auto cadence otherwise mints a check-in on mount
      // that blocks the manual pass via the ≤1-open invariant). `globalThis` read so it typechecks under web.
      const testEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env;
      if (auto && testEnv?.['SELFOS_FAKE_STORY_NO_CADENCE']) return { outcome: 'throttled' };
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { outcome: 'noBook' };
      }
      const personId = await activePersonId();
      if (!personId) return { outcome: 'noBook' };
      // The gap pass + mint need a real key + AI on; without them, the cadence is a no-op (never a NO_KEY
      // spend). The outcome is the HONEST `aiOff` — a fully-clickable "Find what's missing" rendering as
      // "check back later" with AI off is the prerequisite-absent-silence class the DoD forbids.
      const deps = await aiDeps('story.own');
      const aiReady =
        deps && deps.apiKey && (await readVaultSettingsValues(deps.fs))['ai.enabled'] !== false;
      if (!deps || !aiReady) return { outcome: 'aiOff' };
      // The auto cadence never spends during recurring distress — computed HOST-SIDE from the person's own
      // approved insights (the storyRefreshCheck precedent), so it doesn't depend on the renderer.
      let crisis = false;
      if (auto) {
        const own = (await listInsightsForPerson(ctx.fs, ctx.key, personId)).filter(
          (i) => i.approved,
        );
        crisis = aggregateCrisisSignal({
          insights: own,
          nightmareNudge: false,
          now: new Date(),
        }).recurring;
      }
      return runStoryInterviewCadence(deps, {
        bookId,
        auto: auto ?? false,
        ...(crisis ? { crisis } : {}),
      });
    },
    storyGaps: async (input): Promise<StoryGapsView> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const empty: StoryGapsView = { gaps: [], partCoverage: [], hasOpenCheckin: false };
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return empty;
      const personId = await activePersonId();
      if (!personId) return empty;
      return getStoryGaps(ctx.fs, ctx.key, personId, bookId);
    },
    storyAskGap: async (input): Promise<StoryCheckInResult> => {
      const { bookId, gapId } = StoryAskGapInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // Minting a check-in needs a real key + AI on (the mint runs `generateQuestions`).
      const deps = await aiDeps('story.own');
      const aiReady =
        deps && deps.apiKey && (await readVaultSettingsValues(deps.fs))['ai.enabled'] !== false;
      if (!deps || !aiReady) {
        return {
          ok: false,
          reason: 'NO_KEY',
          message: 'Turn on AI in Settings to ask for questions.',
        };
      }
      return askGap(deps, { bookId, gapId });
    },
    storyAnsweredCheckIns: async (input): Promise<StoryAnsweredCheckIn[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return listAnsweredStoryCheckIns(ctx.fs, ctx.key, personId, bookId);
    },
    // --- Publishing & readers (§3.5) — the publish gate is the ONE way a book reaches another person. ---
    storyPublish: async (input): Promise<StoryPublishResult> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, message: 'Not permitted.' };
      }
      const personId = await activePersonId();
      if (!personId) return { ok: false, message: 'No active person.' };
      return publishBook(ctx.fs, ctx.key, personId, bookId, new Date());
    },
    storyPublishDiff: async (input): Promise<StoryPublishDiff> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const empty: StoryPublishDiff = {
        everPublished: false,
        added: [],
        removed: [],
        updated: [],
        unchanged: [],
        willShrink: false,
        nothingToPublish: true,
      };
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return empty;
      const personId = await activePersonId();
      if (!personId) return empty;
      return computePublishDiff(ctx.fs, ctx.key, personId, bookId);
    },
    storyUnpublish: async (input): Promise<StoryUnpublishResult> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, message: 'Not permitted.' };
      }
      const personId = await activePersonId();
      if (!personId) return { ok: false, message: 'No active person.' };
      return unpublishBook(ctx.fs, ctx.key, personId, bookId, new Date());
    },
    storyReaders: async (input): Promise<BookReader[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return listReaders(ctx.fs, ctx.key, personId, bookId);
    },
    storyGrantReader: async (input): Promise<BookReader[]> => {
      const { bookId, readerPersonId } = StoryReaderGrantInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return grantReader(ctx.fs, ctx.key, personId, bookId, readerPersonId, new Date());
    },
    storyRevokeReader: async (input): Promise<BookReader[]> => {
      const { bookId, readerPersonId } = StoryReaderGrantInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return revokeReader(ctx.fs, ctx.key, personId, bookId, readerPersonId, new Date());
    },
    storyReaderFeatured: async (input): Promise<boolean> => {
      const { bookId, readerPersonId } = StoryReaderGrantInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return false;
      const personId = await activePersonId();
      if (!personId) return false;
      const reader = await getPerson(ctx.fs, ctx.key, readerPersonId);
      if (!reader) return false;
      const chapters = await listChapters(ctx.fs, ctx.key, personId, bookId);
      return bookMentionsReader(chapters, reader.displayName);
    },
    storySharedBooks: async (): Promise<SharedBookSummary[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      // The viewer's device-local read progress (per-person, never synced) refines the "new/updated" cues.
      const readAt = (await host.readDeviceState()).storyReadProgress?.[personId] ?? {};
      return listSharedBooks(ctx.fs, ctx.key, personId, readAt);
    },
    storyReadShared: async (input): Promise<StoryReaderView | null> => {
      const { authorPersonId, bookId } = StoryReadSharedInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      // The core re-gates on every read (published + still granted) — the viewer is the active person.
      return readSharedBook(ctx.fs, ctx.key, personId, authorPersonId, bookId);
    },
    storyReadOwnBook: async (input): Promise<StoryOwnBookView | null> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const view = await readOwnBook(ctx.fs, ctx.key, personId, bookId);
      if (!view) return null;
      const device = await host.readDeviceState();
      const saved = device.storyReadPosition?.[personId]?.[bookId];
      // Only resume to a chapter that's still in the book (a deleted/renamed chapter shouldn't dead-end).
      const lastChapterId = saved && view.chapters.some((c) => c.id === saved) ? saved : null;
      return { view, lastChapterId };
    },
    storySetReadPosition: async (input): Promise<void> => {
      const { bookId, chapterId } = StorySetReadPositionInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return;
      const personId = await activePersonId();
      if (!personId) return;
      if (!(await getBook(ctx.fs, ctx.key, personId, bookId))) return; // only the active person's own book
      const device = await host.readDeviceState();
      await host.updateDeviceState({
        storyReadPosition: {
          ...device.storyReadPosition,
          [personId]: { ...device.storyReadPosition?.[personId], [bookId]: chapterId },
        },
      });
    },
    storyMarkSharedRead: async (input): Promise<void> => {
      // Record that the active viewer opened a shared book. TWO records: (1) device-local + per-person read
      // progress (§3.6) for the reader's own "what's new" badge, never synced; (2) a vault-persisted read
      // RECEIPT (§13.6.8) under the reader's own space so the AUTHOR can see who has read their book.
      const { authorPersonId, bookId } = StoryReadSharedInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return;
      const personId = await activePersonId();
      if (!personId) return;
      const device = await host.readDeviceState();
      await host.updateDeviceState({
        storyReadProgress: {
          ...device.storyReadProgress,
          [personId]: {
            ...device.storyReadProgress?.[personId],
            [bookId]: new Date().toISOString(),
          },
        },
      });
      // The receipt is re-gated inside (book still published + still shared with this reader). Best-effort —
      // an author-facing convenience must never break the reader's primary "open" flow (matches the sibling reaps).
      await writeReadReceipt(ctx.fs, ctx.key, personId, authorPersonId, bookId, new Date()).catch(
        () => undefined,
      );
    },
    storyReadSharedImage: async (input): Promise<{ mime: string; dataBase64: string } | null> => {
      const { authorPersonId, bookId, imageId } = StoryReadSharedImageInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const image = await readSharedImage(
        ctx.fs,
        ctx.key,
        personId,
        authorPersonId,
        bookId,
        imageId,
      );
      return image ? { mime: image.mime, dataBase64: toBase64(image.bytes) } : null;
    },
    storyExportMarkdown: async (input): Promise<string | null> => {
      const { bookId, head } = StoryExportInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      // Draft head (§13.6.1 — no publish needed) or the published head; null when there's nothing to export.
      const built =
        head === 'draft'
          ? await buildDraftMarkdown(ctx.fs, ctx.key, personId, bookId)
          : await buildPublishedMarkdown(ctx.fs, ctx.key, personId, bookId);
      if (!built) return null;
      const bytes = new TextEncoder().encode(built.markdown);
      // Reuses the generic file-save host op (the dream-image export precedent) — the bytes leave the vault.
      return host.saveImageFile(`${exportFileStem(built.title)}.md`, bytes, 'text/markdown');
    },
    storyExportPdf: async (input): Promise<string | null> => {
      const { bookId, head } = StoryExportInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const built =
        head === 'draft'
          ? await buildDraftHtml(ctx.fs, ctx.key, personId, bookId)
          : await buildPublishedHtml(ctx.fs, ctx.key, personId, bookId);
      if (!built) return null; // nothing to export (draft: no outline; published: not published)
      const pdf = await host.printToPdf(built.html);
      if (!pdf) return null; // a host that can't render PDF (web/iOS), or a render failure
      return host.saveImageFile(`${exportFileStem(built.title)}.pdf`, pdf, 'application/pdf');
    },
    storyExportEpub: async (input): Promise<string | null> => {
      const { bookId, head } = StoryExportInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const built =
        head === 'draft'
          ? await buildDraftEpub(ctx.fs, ctx.key, personId, bookId)
          : await buildPublishedEpub(ctx.fs, ctx.key, personId, bookId);
      if (!built) return null; // nothing to export (draft: no outline; published: not published)
      return host.saveImageFile(
        `${exportFileStem(built.title)}.epub`,
        built.bytes,
        'application/epub+zip',
      );
    },
    storyExportDocx: async (input): Promise<string | null> => {
      const { bookId, head } = StoryExportInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const built =
        head === 'draft'
          ? await buildDraftDocx(ctx.fs, ctx.key, personId, bookId)
          : await buildPublishedDocx(ctx.fs, ctx.key, personId, bookId);
      if (!built) return null;
      return host.saveImageFile(
        `${exportFileStem(built.title)}.docx`,
        built.bytes,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    },
    // --- Images (§3.8, Phase H) — shares the ONE image consent + OpenAI key with dreams ---------------
    storyImages: async (input): Promise<StoryImageEntry[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return (await getStoryImageIndex(ctx.fs, ctx.key, personId, bookId)).images;
    },
    storyGenerateImage: async (input): Promise<StoryImageResult> => {
      const { bookId, target } = StoryGenerateImageInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // Your Story image settings are now split from Dreams + made per-person (image-settings amendment):
      // consent + style + direction come from THIS person's story prefs (a per-book override still wins,
      // resolved inside generateStoryImage); the story image MODEL is its own owner-managed vault setting.
      const settings = await readVaultSettingsValues(ctx.fs);
      const imageModel =
        typeof settings['story.imageModel'] === 'string'
          ? settings['story.imageModel']
          : 'gpt-image-2';
      const prefs = await readFeatureImagePrefs(ctx.fs, ctx.key, personId, 'story');
      const style = prefs.style;
      const styleNotes = prefs.styleNotes.trim();
      // Route realtime phase events to the surface that started this generation (§ image progress).
      const progressId =
        target.kind === 'cover'
          ? `story:${bookId}:cover`
          : `story:${bookId}:ch:${target.chapterId}`;
      const result = await generateStoryImage({
        fs: ctx.fs,
        key: ctx.key,
        claude: host.claude,
        image: host.image,
        anthropicApiKey: (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
        openaiApiKey: (await resolveOpenAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
        consent: prefs.enabled,
        claudeModel: await host.activeModel(),
        imageModel,
        style,
        ...(styleNotes ? { styleNotes } : {}),
        personId,
        bookId,
        target,
        now: new Date(),
        onPhase: (phase) => host.emitImageProgress({ id: progressId, phase }),
      });
      host.emitImageProgress({ id: progressId, phase: result.ok ? 'done' : 'error' });
      if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
      // Cost ($) is admin-only (budgets.manage) — combines the flat image + the small distillation charge.
      const showCost = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      return {
        ok: true,
        image: result.image,
        ...(showCost ? { costUsd: result.imageUsage.costUsd + result.promptUsage.costUsd } : {}),
      };
    },
    storyGetImage: async (input): Promise<{ mime: string; dataBase64: string } | null> => {
      const { bookId, imageId } = StoryImageRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const image = await getStoryImage(ctx.fs, ctx.key, personId, bookId, imageId);
      return image ? { mime: image.mime, dataBase64: toBase64(image.bytes) } : null;
    },
    storyDeleteImage: async (input): Promise<void> => {
      const { bookId, imageId } = StoryImageRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return;
      await deleteStoryImage(ctx.fs, ctx.key, personId, bookId, imageId, new Date());
    },
    // --- Photos (§3.7, Phase H2) — uploads + Claude vision Q&A; a photo is NEVER a generation input --------
    storyUploadPhoto: async (input): Promise<StoryImageEntry | null> => {
      const { bookId, mime, dataBase64, chapterId } = StoryUploadPhotoInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      // Defense in depth: the renderer already downscaled + stripped EXIF (spec 45), but re-validate the
      // mime + size at the trust boundary (a crafted call can't stash arbitrary bytes).
      const ALLOWED = ['image/png', 'image/webp', 'image/jpeg', 'image/gif'];
      if (!ALLOWED.includes(mime)) return null;
      const bytes = fromBase64(dataBase64);
      if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) return null;
      return addUploadedPhoto(
        ctx.fs,
        ctx.key,
        personId,
        bookId,
        { bytes, mime, ...(chapterId ? { chapterId } : {}) },
        new Date(),
      );
    },
    storyAnalyzePhoto: async (input): Promise<StoryPhotoAnalyzeResult> => {
      const { bookId, imageId } = StoryImageRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const showCost = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      return analyzeStoryPhoto({
        fs: ctx.fs,
        key: ctx.key,
        claude: host.claude,
        anthropicApiKey: (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
        claudeModel: await host.activeModel(),
        personId,
        bookId,
        imageId,
        now: new Date(),
        showCost,
      });
    },
    storyAnswerPhoto: async (input): Promise<void> => {
      const { bookId, imageId, question, answer } = StoryPhotoAnswerInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return;
      await addPhotoAnswer(
        ctx.fs,
        ctx.key,
        personId,
        bookId,
        { imageId, question, answer },
        new Date(),
      );
    },
    storyPhotoAnswers: async (input): Promise<StoryPhotoAnswer[]> => {
      const { bookId } = StoryBookRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return [];
      return getPhotoAnswers(ctx.fs, ctx.key, personId, bookId);
    },
    // --- Image placement (§3.8, Phase H3) — AI-suggested anchor, instant set/move/remove -----------------
    storySuggestPlacement: async (input): Promise<StoryPlacementSuggestResult> => {
      const { bookId, chapterId, imageId } = StoryImagePlacementRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to suggest a spot.',
        };
      }
      return suggestImagePlacement(deps, { bookId, chapterId, imageId });
    },
    storySetPlacement: async (input): Promise<StoryBookBundle | null> => {
      const { bookId, chapterId, imageId, afterAnchor, caption } =
        StorySetPlacementInputSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      const chapter = await setImagePlacement(ctx.fs, ctx.key, personId, bookId, chapterId, {
        imageId,
        afterAnchor,
        ...(caption !== undefined ? { caption } : {}),
      });
      return chapter ? readBookBundle(ctx.fs, ctx.key, personId, bookId) : null;
    },
    storyRemovePlacement: async (input): Promise<StoryBookBundle | null> => {
      const { bookId, chapterId, imageId } = StoryImagePlacementRefSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'story.own'))) return null;
      await removeImagePlacement(ctx.fs, ctx.key, personId, bookId, chapterId, imageId);
      return readBookBundle(ctx.fs, ctx.key, personId, bookId);
    },
    // The batch markup revision — the one AI call in the markup layer (§3.3.1/§5.3).
    storyApplyMarkup: async (input): Promise<StoryRevisionResult> => {
      const { bookId, chapterId } = StoryChapterRefSchema.parse(input);
      const deps = await aiDeps('story.own');
      if (!deps) return { ok: false, reason: 'NO_KEY', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(deps.fs))['ai.enabled'] === false) {
        return {
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to apply your changes.',
        };
      }
      const res = await applyMarkup(deps, { bookId, chapterId });
      if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
      const bundle = await readBookBundle(deps.fs, deps.key, deps.personId, bookId);
      if (!bundle) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
      const markup = await getMarkup(deps.fs, deps.key, deps.personId, bookId, chapterId);
      return { ok: true, bundle, markup };
    },
    // --- Relationship insights (54-memory-redesign §6) — gated `memory.own`, active-person-scoped ---
    relationshipsGetSynthesis: async (input): Promise<RelationshipSynthesis | null> => {
      const { partnerPersonId } = RelationshipSynthesizeSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      return getRelationshipSynthesis(ctx.fs, ctx.key, personId, partnerPersonId);
    },
    relationshipsSynthesize: async (input): Promise<RelationshipSynthesisResult> => {
      const { partnerPersonId } = RelationshipSynthesizeSchema.parse(input);
      const base = await aiDeps('memory.own');
      if (!base) return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      if ((await readVaultSettingsValues(base.fs))['ai.enabled'] === false) {
        return { ok: false, reason: 'AI_OFF', message: 'Turn on AI in Settings to use this.' };
      }
      const viewerId = base.personId;
      // The viewer can only synthesize about their OWN partner — resolve the grant from the live graph and
      // require a `partner` edge (v1 is partner-only). The same `grantedTypes` the share gate uses (42).
      const relationships = await listRelationships(base.fs, base.key);
      const grantedTypes = relationshipTypesFromSubjectToViewer(
        partnerPersonId,
        viewerId,
        relationships,
      );
      if (!grantedTypes.includes('partner')) {
        return { ok: false, reason: 'EMPTY', message: 'Relationship insights are for partners.' };
      }
      const partner = await getPerson(base.fs, base.key, partnerPersonId);
      if (!partner)
        return { ok: false, reason: 'EMPTY', message: 'That person is no longer here.' };
      return synthesizeRelationship({
        fs: base.fs,
        key: base.key,
        client: base.client,
        apiKey: base.apiKey,
        model: base.model,
        viewerPersonId: viewerId,
        partnerPersonId,
        partnerName: partner.displayName,
        grantedTypes,
        now: base.now,
      });
    },
    // --- Challenges / experiments (52-challenge-sessions) — gated `challenges.own`, active-person-scoped ---
    challengesStart: async (input): Promise<{ conversationId: string } | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const { domain } = ChallengeStartSchema.parse(input ?? {});
      // A sexual/intimacy domain requires the 18+ ack (§8.3) — enforced in the bridge, not just the UI.
      if (
        domain === 'intimacy' &&
        (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged !== true
      ) {
        return null;
      }
      return startChallenge({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        ...(domain ? { domain } : {}),
        now: new Date(),
      });
    },
    challengesStartReflection: async (input): Promise<{ conversationId: string } | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const { challengeId } = ChallengeStartReflectionSchema.parse(input);
      const challenge = await getChallenge(ctx.fs, ctx.key, personId, challengeId);
      if (!challenge) return null;
      // A sexual challenge's reflection stays the inline restricted path (§8.4) — no reflection SESSION for it.
      if (challenge.adult === true) return null;
      return startChallengeReflection({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        challengeId,
        now: new Date(),
      });
    },
    challengesList: async (): Promise<Challenge[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      return listChallenges(ctx.fs, ctx.key, personId);
    },
    challengesGet: async (input): Promise<Challenge | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const { challengeId } = ChallengeIdSchema.parse(input);
      return getChallenge(ctx.fs, ctx.key, personId, challengeId);
    },
    challengesSetStatus: async (input): Promise<Challenge | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = ChallengeSetStatusSchema.parse(input);
      // Scoped to the active person's OWN challenge — a person can only change their own (the trust boundary).
      return setChallengeStatus(ctx.fs, ctx.key, personId, p.challengeId, p.status, new Date());
    },
    challengesCheckIn: async (input): Promise<ChallengeCheckInResult> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) {
        return { ok: false, reason: 'NOT_FOUND', message: 'That challenge is no longer here.' };
      }
      const p = ChallengeCheckInSchema.parse(input);
      // Deterministic — no AI spend; the reflection → Insight bridge runs in `recordCheckIn` (§5.4).
      return recordCheckIn({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        challengeId: p.challengeId,
        outcome: p.outcome,
        ...(p.reflection !== undefined ? { reflection: p.reflection } : {}),
        now: new Date(),
      });
    },
    challengesSnooze: async (input): Promise<Challenge | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const { challengeId } = ChallengeIdSchema.parse(input);
      return snoozeCheckIn(ctx.fs, ctx.key, personId, challengeId, new Date());
    },
    challengesSeedGoal: async (input): Promise<Challenge | null> => {
      const ctx = await host.vaultAndKey();
      // Seeding writes a 39 Goal, so it also needs `memory.own` (the goals capability). Both Member-default.
      if (
        !ctx ||
        !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own')) ||
        !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))
      ) {
        return null;
      }
      const personId = await activePersonId();
      if (!personId) return null;
      const { challengeId } = ChallengeIdSchema.parse(input);
      return seedGoalFromChallenge(ctx.fs, ctx.key, personId, challengeId, new Date());
    },
    challengesDelete: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) return;
      const personId = await activePersonId();
      if (!personId) return;
      const { challengeId } = ChallengeIdSchema.parse(input);
      // The delete path is `people/<activePerson>/challenges/<id>` — inherently scoped to the active person.
      await deleteChallenge(ctx.fs, personId, challengeId);
    },
    challengesSuggest: async (input): Promise<ChallengeSuggestionResult> => {
      const { override } = ChallengeSuggestSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // AI off → a calm skip (the card gates on `configured`), no dead button (52 §7 / 31 AI-required).
      if ((await readVaultSettingsValues(ctx.fs))['ai.enabled'] === false) {
        return { ok: false, reason: 'AI_OFF', message: 'Turn on AI in Settings to use this.' };
      }
      const deps = await aiDeps('challenges.own');
      if (!deps) return { ok: false, reason: 'ERROR', message: 'Not available.' };
      // Sexual/intimacy candidates are withheld until the per-person 18+ ack (§8.3) — passed to the suggester.
      const adultAllowed =
        (await getGuidancePrefs(ctx.fs, ctx.key, personId)).adultAcknowledged === true;
      return suggestChallenge({ ...deps, adultAllowed, ...(override ? { override } : {}) });
    },
    challengesGetSuggestion: async (): Promise<ChallengeSuggestion | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      return getSuggestion(ctx.fs, ctx.key, personId);
    },
    challengesClearSuggestion: async (): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'challenges.own'))) return;
      const personId = await activePersonId();
      if (!personId) return;
      await clearSuggestion(ctx.fs, personId);
    },
    assignmentsCreate: async (input): Promise<InAppSendResult> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        throw new Error('Not permitted');
      }
      const personId = await activePersonId();
      if (!personId) throw new Error('No active person');
      const { questionnaireId, privacy, senderVisibleToRecipient, expiresAt } =
        AssignmentsCreateSchema.parse(input);
      // The recipient is BOUND to the questionnaire at creation (08 §17.3) — the sender never re-picks it.
      // An in-app send requires a household recipient; an external-bound questionnaire goes via the relay.
      const def = await getQuestionnaire(ctx.fs, ctx.key, questionnaireId);
      if (!def) throw new Error('Questionnaire not found');
      if (def.recipient?.kind !== 'person') {
        throw new Error(
          'This questionnaire is addressed to someone outside the household — use the link.',
        );
      }
      const recipientPersonId = def.recipient.personId;
      // The bound recipient must still be a real household person, so we never persist a dangling,
      // unanswerable send (a self-send is allowed — self check-ins are a valid use).
      if (!(await getPerson(ctx.fs, ctx.key, recipientPersonId))) {
        throw new Error('Recipient not found');
      }
      const senderVisible = senderVisibleToRecipient ?? true;
      const assignment = await createAssignment(ctx.fs, ctx.key, {
        questionnaireId,
        senderPersonId: personId,
        recipient: { kind: 'person' as const, personId: recipientPersonId },
        channel: 'inApp',
        privacy: privacy ?? 'standard',
        senderVisibleToRecipient: senderVisible,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });

      // spec 70 §5.5 — a candidate that was just asked drops off the recipient's "what's next" feed + stops
      // steering generation. Best-effort + immediate for this direct path; the daily `refreshNextCandidates`
      // self-heals anything missed. Own-scoped: stamps the RECIPIENT's own profile with the prompts they were
      // asked (no cross-person data — the def's own questions).
      try {
        const askedPrompts = def.questions.map((q) => q.prompt.trim()).filter(Boolean);
        if (askedPrompts.length) {
          const profile = await readProfile(ctx.fs, ctx.key, recipientPersonId);
          const stamped = markCandidateAsked(
            profile,
            { assignmentId: assignment.id, askedPrompts },
            new Date(),
          );
          if (stamped !== profile) await writeProfile(ctx.fs, ctx.key, stamped);
        }
      } catch {
        // candidate bookkeeping is best-effort; never fail a send over it
      }

      // 08 §17.13 — unified delivery: ALSO mint a relay link so the recipient can answer in their Inbox OR
      // anywhere via the link. Only when the sender can deliver externally AND a relay is connected;
      // otherwise the send is Inbox-only (the graceful fallback — the app works without Cloudflare).
      const config = (await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal'))
        ? await readRelayConfig(ctx.fs, ctx.key)
        : null;
      if (!config) return { assignment };
      const senderName = (await getPerson(ctx.fs, ctx.key, personId))?.displayName ?? 'Someone';
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      try {
        const { link, pin } = await attachRelayLink(ctx.fs, ctx.key, client, assignment.id, {
          senderName,
          senderVisibleToRecipient: senderVisible,
          disclosure: externalSendDisclosure(
            senderVisible ? senderName : 'the person who sent this',
            privacy ?? 'standard',
          ),
          endpointUrl: config.endpointUrl,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        });
        return {
          assignment: (await getAssignment(ctx.fs, ctx.key, assignment.id)) ?? assignment,
          link,
          pin,
        };
      } catch (e) {
        // A relay IS connected but minting failed — surface it (don't swallow): the in-app send stands,
        // but the sender should know the link didn't go out and can retry from Results (§17.14a).
        return {
          assignment,
          linkError: e instanceof Error ? e.message : 'The relay couldn’t be reached.',
        };
      }
    },

    // --- Inbox / answering (08-questionnaires §13.5) — gated by `questionnaires.answer` + recipient-scoped ---
    assignmentsInbox: async (): Promise<InboxItem[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.answer'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const assignments = await listAssignments(ctx.fs, ctx.key, { recipientPersonId: personId });
      const device = await host.readDeviceState();
      const favorites = new Set(device.inboxFavorites?.[personId] ?? []);
      const items: InboxItem[] = [];
      for (const a of assignments) {
        if (a.recipientDismissedAt) continue; // recipient removed it from their Inbox (#350)
        const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
        if (!snapshot) continue; // a half-written send with no snapshot is unanswerable — skip it
        const response = await getResponse(ctx.fs, ctx.key, a.id);
        const submitted = response && response.submittedAt !== undefined;
        items.push({
          assignmentId: a.id,
          title: snapshot.title,
          type: snapshot.type,
          questionCount: snapshot.questions.length,
          status: a.status,
          privacy: a.privacy,
          senderName: await senderNameFor(ctx.fs, ctx.key, a),
          createdAt: a.createdAt,
          ...(submitted ? { answeredAt: a.updatedAt } : {}),
          favorite: favorites.has(a.id),
          answerable: isAnswerable(a.status),
          hasDraft: Boolean(response && !submitted),
          fromSelf: a.senderPersonId === personId,
          // The card privacy chip states the REAL compatibility promise per mode (08 §3.1) — the frozen
          // snapshot's visibility, present only on a compatibility send.
          ...(snapshot.compatibility
            ? { compatibilityVisibility: snapshot.compatibility.visibility }
            : {}),
          // Surface the auto-checkin provenance so the Inbox card shows it's auto-generated (§8.3, never covert).
          ...(snapshot.autoCheckin ? { autoCheckin: snapshot.autoCheckin } : {}),
          // A Your Story interview send (64 §5.5) → a "Your biographer" eyebrow so the ask is never mysterious.
          ...(snapshot.storyProvenance ? { fromBiographer: true } : {}),
        });
      }
      return items;
    },
    assignmentsSetFavorite: async ({ assignmentId, favorite }): Promise<void> => {
      // A personal, device-local pin on a received questionnaire (08 §3.3). Recipient-scoped: only the active
      // person can favourite their own Inbox items, and it never syncs or leaks across personas.
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.answer'))) return;
      const personId = await activePersonId();
      if (!personId) return;
      const id = AssignmentIdSchema.parse(assignmentId);
      // Only pin an assignment actually sent to the active person (never an arbitrary id).
      const mine = await listAssignments(ctx.fs, ctx.key, { recipientPersonId: personId });
      if (!mine.some((a) => a.id === id)) return;
      const device = await host.readDeviceState();
      const current = new Set(device.inboxFavorites?.[personId] ?? []);
      if (favorite) current.add(id);
      else current.delete(id);
      await host.updateDeviceState({
        inboxFavorites: { ...device.inboxFavorites, [personId]: [...current] },
      });
    },
    assignmentsGet: async (assignmentId): Promise<InboxAssignmentDetail | null> => {
      const resolved = await recipientAssignment(AssignmentIdSchema.parse(assignmentId));
      if (!resolved) return null;
      const { fs, key, assignment } = resolved;
      const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
      if (!snapshot) return null;
      const draft = await getResponse(fs, key, assignment.id);
      // For a compatibility send, surface the answerer's joint-report view per the visibility mode: the
      // shared report (once the sender generates it) for everyone, plus their OWN answers for eachSeesOwn.
      let compatibility: InboxCompatibilityView | undefined;
      if (snapshot.compatibility?.enabled && assignment.compatibilityGroupId) {
        const visibility = snapshot.compatibility.visibility;
        const report = await getAlignmentReport(fs, key, assignment.compatibilityGroupId);
        const submitted = draft && draft.submittedAt !== undefined ? draft : null;
        const ownAnswers =
          visibility === 'eachSeesOwn' && submitted
            ? formatResponseAnswers(snapshot.questions, submitted.answers)
            : undefined;
        // The participant context for the disclosure (§16.1): this recipient is one participant; find the
        // OTHER member of the group and whether this recipient is themselves the sender.
        const group = (await listAssignments(fs, key)).filter(
          (a) => a.compatibilityGroupId === assignment.compatibilityGroupId,
        );
        const other = group.find((a) => a.id !== assignment.id);
        const otherParticipantName =
          other && other.recipient.kind === 'person'
            ? ((await getPerson(fs, key, other.recipient.personId))?.displayName ??
              'the other person')
            : 'the other person';
        const viewerIsSender =
          assignment.recipient.kind === 'person' &&
          assignment.recipient.personId === assignment.senderPersonId;
        compatibility = {
          visibility,
          report,
          otherParticipantName,
          viewerIsSender,
          ...(ownAnswers ? { ownAnswers } : {}),
        };
      }
      return {
        assignmentId: assignment.id,
        questionnaire: snapshot,
        status: assignment.status,
        privacy: assignment.privacy,
        senderName: await senderNameFor(fs, key, assignment),
        answers: draft?.answers ?? [],
        answerable: isAnswerable(assignment.status),
        // A self check-in (recipient IS the sender) → the Inbox offers outright "Delete"; else "Remove"
        // (dismiss, sender's copy untouched). recipient.personId is the active person (recipientAssignment).
        fromSelf:
          assignment.recipient.kind === 'person' &&
          assignment.recipient.personId === assignment.senderPersonId,
        ...(compatibility ? { compatibility } : {}),
      };
    },
    assignmentsOpen: async (assignmentId): Promise<void> => {
      // Best-effort status nudge (sent → opened); a non-recipient simply no-ops here rather than
      // throwing like the answer mutations, since opening reveals nothing and isn't user-initiated.
      const resolved = await recipientAssignment(AssignmentIdSchema.parse(assignmentId));
      if (!resolved) return;
      await openAssignment(resolved.fs, resolved.key, resolved.assignment.id);
    },
    assignmentsSaveProgress: async (input): Promise<void> => {
      const { assignmentId, answers } = AnswersSchema.parse(input);
      const resolved = await recipientAssignment(assignmentId);
      if (!resolved) throw new Error('Not permitted');
      await saveProgress(resolved.fs, resolved.key, { assignmentId, answers });
    },
    assignmentsReopen: async (assignmentId): Promise<void> => {
      // 56 §3.1 — the recipient re-opens their own submitted send to edit + resend. Recipient-scoped (an Inbox
      // item is always the household-person recipient); the core fn rejects a non-reopenable status. A
      // compatibility send is withheld (its dual-participant alignment report would be invalidated). A relay
      // link, if this send also had one, was already revoked at first submit (§17.13), so editing is in-app only.
      const resolved = await recipientAssignment(AssignmentIdSchema.parse(assignmentId));
      if (!resolved) throw new Error('Not permitted');
      if (resolved.assignment.compatibilityGroupId) {
        throw new Error('A compatibility questionnaire can’t be edited after sending.');
      }
      await reopenAssignment(resolved.fs, resolved.key, resolved.assignment.id);
    },
    assignmentsSubmit: async (input): Promise<void> => {
      const { assignmentId, answers } = AnswersSchema.parse(input);
      const resolved = await recipientAssignment(assignmentId);
      if (!resolved) throw new Error('Not permitted');
      await submitResponse(resolved.fs, resolved.key, { assignmentId, answers });
      // 08 §17.13 first-wins: if this send also has a relay link, close its mailbox so the link can't be
      // answered again on the other surface (best-effort; the drain guard is the backstop).
      const assignment = await getAssignment(resolved.fs, resolved.key, assignmentId);
      if (assignment?.relay) {
        const config = await readRelayConfig(resolved.fs, resolved.key);
        if (config) {
          const client = createRelayHttpClient(
            config.endpointUrl,
            config.drainSecret,
            host.relay.fetch,
          );
          await revokeRelayForDeletion(resolved.fs, resolved.key, client, assignmentId);
        }
      }
    },
    assignmentsDecline: async (input): Promise<void> => {
      const { assignmentId, note } = DeclineSchema.parse(input);
      const resolved = await recipientAssignment(assignmentId);
      if (!resolved) throw new Error('Not permitted');
      await declineAssignment(resolved.fs, resolved.key, {
        assignmentId,
        ...(note !== undefined ? { note } : {}),
      });
      // Close the relay link too, if any (§17.13) — a declined send shouldn't stay answerable via the link.
      const assignment = await getAssignment(resolved.fs, resolved.key, assignmentId);
      if (assignment?.relay) {
        const config = await readRelayConfig(resolved.fs, resolved.key);
        if (config) {
          const client = createRelayHttpClient(
            config.endpointUrl,
            config.drainSecret,
            host.relay.fetch,
          );
          await revokeRelayForDeletion(resolved.fs, resolved.key, client, assignmentId);
        }
      }
    },
    assignmentsDismiss: async (assignmentId): Promise<void> => {
      // Remove a received questionnaire from the recipient's Inbox (#350). Recipient-scoped via
      // `recipientAssignment` (gated `questionnaires.answer` + recipient == active person), so a caller can
      // only ever act on a send made to THEM.
      const resolved = await recipientAssignment(AssignmentIdSchema.parse(assignmentId));
      if (!resolved) throw new Error('Not permitted');
      const { fs, key, assignment } = resolved;
      const isSelf =
        assignment.recipient.kind === 'person' &&
        assignment.recipient.personId === assignment.senderPersonId;
      if (isSelf) {
        // The recipient IS the sender (a self check-in): delete it outright — nobody else has a copy.
        if (assignment.relay) await revokeRelayLinks(fs, key, (a) => a.id === assignment.id);
        await deleteSend(fs, key, assignment.id);
      } else {
        // A send from someone else: dismiss it (hide from this Inbox) WITHOUT touching the sender's copy.
        await dismissAssignmentForRecipient(fs, key, assignment.id);
      }
    },
    assignmentsResults: async (questionnaireId): Promise<SendResult[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const qid = QuestionnaireIdSchema.parse(questionnaireId);
      // The active person's own sends of this questionnaire (Results is sender-scoped, newest first).
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.questionnaireId === qid,
      );
      const insightByAssignment = new Map(
        (await listInsightsForPerson(ctx.fs, ctx.key, personId)).flatMap((i) =>
          i.provenance.assignmentId ? [[i.provenance.assignmentId, i] as const] : [],
        ),
      );
      const results: SendResult[] = [];
      for (const a of sends) {
        const recipientName =
          a.recipient.kind === 'person'
            ? ((await getPerson(ctx.fs, ctx.key, a.recipient.personId))?.displayName ?? 'Unknown')
            : (a.recipient.displayName ?? 'External');
        const insight = insightByAssignment.get(a.id);
        // Fetch the response once when it's needed — for the Standard-submitted answers view, the submission
        // revision, AND/OR to detect a stale analysis (the recipient edited + resubmitted since it was
        // analyzed, 56 §3.2). Any submitted send (or one with an insight) needs it; the answers stay gated on
        // Standard below, so a Private send's raw responses still never reach the sender.
        const needsResponse = a.status === 'submitted' || insight !== undefined;
        const response = needsResponse ? await getResponse(ctx.fs, ctx.key, a.id) : null;
        // Privacy boundary (§8.4/§21.5): only a Standard, submitted send exposes answers to the sender. A
        // PRIVATE send surfaces NOTHING from the answers — words or numbers; its only output is the derived
        // insight (below). The raw answers never cross the bridge for a private send.
        let answers: SendAnswer[] | undefined;
        if (a.privacy === 'standard' && a.status === 'submitted' && response) {
          const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
          if (snapshot) {
            // formatResponseAnswers carries a per-question decline's flag + reason (§25.2) so Results can
            // render a "Skipped" chip, not just the "Skipped — <reason>" string.
            answers = formatResponseAnswers(snapshot.questions, response.answers);
          }
        }
        results.push({
          assignmentId: a.id,
          recipientName,
          channel: a.channel,
          relayLinked: Boolean(a.relay),
          status: a.status,
          privacy: a.privacy,
          createdAt: a.createdAt,
          analyzed: insight !== undefined,
          analysisStale: isAnalysisStale(response, insight),
          ...(response?.submittedAt !== undefined ? { revision: response.revision ?? 1 } : {}),
          // Surface the link expiry only for a still-open relay-linked send — once submitted/revoked/expired
          // the countdown is moot (38 §3.6).
          ...(a.relay &&
          a.expiresAt &&
          (a.status === 'sent' || a.status === 'opened' || a.status === 'inProgress')
            ? { expiresAt: a.expiresAt }
            : {}),
          ...(a.status === 'submitted' ? { submittedAt: a.updatedAt } : {}),
          ...(a.declineNote !== undefined ? { declineNote: a.declineNote } : {}),
          ...(answers ? { answers } : {}),
          // The derived Insight's summary + id (once analyzed) for the Memory deep-link (+ the inline excerpt
          // on a Standard card). The insight is the derived, allowed output — for a private send it's the ONLY
          // thing surfaced (§21.5); the raw answers never cross.
          ...(insight ? { insightSummary: insight.summary, insightId: insight.id } : {}),
        });
      }
      return results;
    },
    assignmentsDelete: async (assignmentId): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults'))) return;
      const id = AssignmentIdSchema.parse(assignmentId);
      const assignment = await getAssignment(ctx.fs, ctx.key, id);
      if (!assignment) return;
      // Only the send's own sender (or the Owner) may delete it + its derived Insight.
      const personId = await activePersonId();
      if (
        assignment.senderPersonId !== personId &&
        !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))
      ) {
        throw new Error('Not permitted');
      }
      if (assignment.relay) await revokeRelayLinks(ctx.fs, ctx.key, (a) => a.id === id);
      await deleteSend(ctx.fs, ctx.key, id);
    },
    assignmentsTrends: async (questionnaireId): Promise<QuestionTrend[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const qid = QuestionnaireIdSchema.parse(questionnaireId);
      // Trends span every SUBMITTED send of this questionnaire by the active person — Standard AND
      // Private (the Private disclosure is worded to allow this, §3.2). Numbers, never the prose answers.
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.questionnaireId === qid && a.status === 'submitted',
      );
      const trendSends: TrendSend[] = [];
      for (const a of sends) {
        const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
        const response = await getResponse(ctx.fs, ctx.key, a.id);
        if (!snapshot || !response) continue;
        const recipientName =
          a.recipient.kind === 'person'
            ? ((await getPerson(ctx.fs, ctx.key, a.recipient.personId))?.displayName ?? 'Unknown')
            : (a.recipient.displayName ?? 'External');
        trendSends.push({
          submittedAt: a.updatedAt,
          recipientName,
          questions: snapshot.questions,
          answers: response.answers,
        });
      }
      return buildQuestionTrends(trendSends);
    },
    assignmentsAggregate: async (questionnaireId): Promise<QuestionnaireAggregate> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return { questions: [] };
      const personId = await activePersonId();
      if (!personId) return { questions: [] };
      const qid = QuestionnaireIdSchema.parse(questionnaireId);
      // The "At a glance" aggregate spans every SUBMITTED send of this questionnaire by the active person.
      // The core builder applies the §21.5 privacy rule from each send's `privacy`: PRIVATE sends are excluded
      // ENTIRELY — words AND numbers (a private answer never appears in any distribution, average, or count).
      // The raw answers are decrypted HERE (host-side) and never cross IPC — only the aggregate does.
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.questionnaireId === qid && a.status === 'submitted',
      );
      const aggregateSends: AggregateSend[] = [];
      for (const a of sends) {
        const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
        const response = await getResponse(ctx.fs, ctx.key, a.id);
        if (!snapshot || !response) continue;
        aggregateSends.push({
          privacy: a.privacy,
          questions: snapshot.questions,
          answers: response.answers,
        });
      }
      return buildQuestionnaireAggregate(aggregateSends);
    },

    // --- Compatibility (08-questionnaires §3.6/§13.5d) ---
    assignmentsCreateCompatibility: async (input): Promise<CompatibilitySendResult> => {
      const deps = await aiDeps('questionnaires.create');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const { questionnaireId } = CompatibilityCreateSchema.parse(input);
      const canonical = await getQuestionnaire(deps.fs, deps.key, questionnaireId);
      if (!canonical?.compatibility?.enabled) {
        return {
          ok: false,
          reason: 'INVALID',
          message: 'This isn’t a compatibility questionnaire.',
        };
      }
      // The participants are the sender + the BOUND recipient (08 §17.12-B), derived from the questionnaire.
      const recipient = canonical.recipient;
      if (!recipient) {
        return { ok: false, reason: 'INVALID', message: 'This questionnaire has no recipient.' };
      }
      const visibility = canonical.compatibility.visibility;
      const senderPerson = await getPerson(deps.fs, deps.key, deps.personId);
      const senderName = senderPerson?.displayName ?? 'Someone';
      // Each participant's gender drives the OTHER person's pronouns in their variant (§17.14e) — so a man
      // asked about his female partner reads "her", never "him".
      const senderGender = senderPerson?.gender;

      // Resolve the OTHER participant up front: each person's variant must ask about the OTHER one (08
      // §17.12 — the recipient was being asked about themselves, not the sender). For a household person,
      // validate it exists + isn't the sender; for an external recipient, it's their given name.
      let otherName: string;
      let otherGender: string | undefined;
      if (recipient.kind === 'person') {
        if (recipient.personId === deps.personId) {
          return {
            ok: false,
            reason: 'INVALID',
            message: 'You can’t compare yourself with yourself.',
          };
        }
        const rp = await getPerson(deps.fs, deps.key, recipient.personId);
        if (!rp)
          return { ok: false, reason: 'INVALID', message: 'A chosen person no longer exists.' };
        otherName = rp.displayName;
        otherGender = rp.gender;
      } else {
        // An external recipient nearly always has a name; fall back to a warm placeholder, not "them".
        otherName = recipient.displayName ?? 'your partner';
      }

      // The sender's own variant — written TO the sender, ABOUT the other participant; their own full context.
      const senderVariant = await generateVariant(deps, {
        forName: senderName,
        ...(senderGender ? { forGender: senderGender } : {}),
        aboutName: otherName,
        ...(otherGender ? { aboutGender: otherGender } : {}),
        questions: canonical.questions,
        targetContext: {
          authorPersonId: deps.personId,
          includeAuthor: true,
          includeTarget: false,
          includeRelationship: false,
        },
      });
      if (!senderVariant.ok || !senderVariant.questions) {
        return {
          ok: false,
          reason: senderVariant.reason ?? 'ERROR',
          message: senderVariant.message ?? 'Could not personalize.',
        };
      }

      if (recipient.kind === 'person') {
        // --- Household: two paired in-app sends (sender + the recipient) ---
        const recipientPersonId = recipient.personId;
        // The recipient's variant — written TO them, ABOUT the sender; their SHAREABLE context only (§13.3).
        const recipientVariant = await generateVariant(deps, {
          forName: otherName,
          ...(otherGender ? { forGender: otherGender } : {}),
          aboutName: senderName,
          ...(senderGender ? { aboutGender: senderGender } : {}),
          questions: canonical.questions,
          targetContext: {
            authorPersonId: deps.personId,
            includeAuthor: false,
            targetPersonId: recipientPersonId,
            includeTarget: true,
            includeRelationship: true,
          },
        });
        if (!recipientVariant.ok || !recipientVariant.questions) {
          return {
            ok: false,
            reason: recipientVariant.reason ?? 'ERROR',
            message: recipientVariant.message ?? 'Could not personalize.',
          };
        }
        const compatibilityGroupId = await createCompatibilitySend(deps.fs, deps.key, {
          questionnaireId,
          senderPersonId: deps.personId,
          visibility,
          recipients: [
            { personId: deps.personId, questions: senderVariant.questions },
            { personId: recipientPersonId, questions: recipientVariant.questions },
          ],
        });
        // Unified delivery (§17.14): also mint a relay link for the RECIPIENT's variant so a household
        // recipient can answer in their Inbox OR via a link + email/SMS — exactly like an external send.
        // The sender answers their OWN variant in-app, so no link is minted for the sender's member. Only
        // when the sender can deliver externally AND a relay is connected (else Inbox-only, graceful).
        const config = (await activePersonCan(deps.fs, deps.key, 'questionnaires.sendExternal'))
          ? await readRelayConfig(deps.fs, deps.key)
          : null;
        if (!config) return { ok: true, compatibilityGroupId };
        const recipientMember = (
          await listAssignments(deps.fs, deps.key, { senderPersonId: deps.personId })
        ).find(
          (a) =>
            a.compatibilityGroupId === compatibilityGroupId &&
            a.recipient.kind === 'person' &&
            a.recipient.personId === recipientPersonId,
        );
        if (!recipientMember) {
          // A relay is connected but we can't find the recipient's just-created member to attach a link —
          // surface it (don't fall back to a silent no-link), matching the mint-failure path below.
          return {
            ok: true,
            compatibilityGroupId,
            linkError: 'Couldn’t prepare the share link. Open Results to add one.',
          };
        }
        const client = createRelayHttpClient(
          config.endpointUrl,
          config.drainSecret,
          host.relay.fetch,
        );
        try {
          const { link, pin } = await attachRelayLink(
            deps.fs,
            deps.key,
            client,
            recipientMember.id,
            {
              senderName,
              senderVisibleToRecipient: true,
              // The recipient is told (from their POV) who's comparing them — the sender (§16.1).
              disclosure: compatibilityDisclosure(visibility, {
                otherParticipantName: senderName,
                senderName,
                viewerIsSender: false,
              }),
              endpointUrl: config.endpointUrl,
            },
          );
          return { ok: true, compatibilityGroupId, link, pin };
        } catch (e) {
          // A relay IS connected but minting failed (e.g. the relay is unreachable / its deploy is stale).
          // The in-app paired sends still stand, but DON'T swallow it: surface a linkError so the sender
          // sees the link didn't go out and can retry from Results, instead of a silent Inbox-only state.
          return {
            ok: true,
            compatibilityGroupId,
            linkError: e instanceof Error ? e.message : 'The relay couldn’t be reached.',
          };
        }
      }

      // --- External (relay): the sender answers in-app + the recipient answers via the relay (08 §17.12-B) ---
      if (!(await activePersonCan(deps.fs, deps.key, 'questionnaires.sendExternal'))) {
        return { ok: false, reason: 'DENIED', message: 'You can’t send external links.' };
      }
      const relayConfig = await readRelayConfig(deps.fs, deps.key);
      if (!relayConfig) {
        return {
          ok: false,
          reason: 'INVALID',
          message: 'No relay is connected. Ask an admin to set one up in Settings → Relay.',
        };
      }
      // The external recipient's variant — written TO them, ABOUT the sender (no household context to draw on).
      const externalVariant = await generateVariant(deps, {
        forName: otherName,
        // An external recipient has no stored gender → their variant refers to the sender by name/their
        // gender, and to the external person by name (no pronoun assumed).
        aboutName: senderName,
        ...(senderGender ? { aboutGender: senderGender } : {}),
        questions: canonical.questions,
        targetContext: {
          authorPersonId: deps.personId,
          includeAuthor: false,
          includeTarget: false,
          includeRelationship: false,
        },
      });
      if (!externalVariant.ok || !externalVariant.questions) {
        return {
          ok: false,
          reason: externalVariant.reason ?? 'ERROR',
          message: externalVariant.message ?? 'Could not personalize.',
        };
      }
      const compatibilityGroupId = uuid();
      // The sender's in-app member.
      await writeCompatibilityMember(deps.fs, deps.key, {
        canonical,
        senderPersonId: deps.personId,
        participantPersonId: deps.personId,
        questions: senderVariant.questions,
        visibility,
        compatibilityGroupId,
      });
      // The external recipient's relay member — the recipient is told who's comparing (the sender).
      const disclosure = compatibilityDisclosure(visibility, {
        otherParticipantName: senderName,
        senderName,
        viewerIsSender: false,
      });
      const client = createRelayHttpClient(
        relayConfig.endpointUrl,
        relayConfig.drainSecret,
        host.relay.fetch,
      );
      const { link, pin } = await createRelaySend(deps.fs, deps.key, client, {
        questionnaireId,
        senderPersonId: deps.personId,
        senderName,
        recipient: {
          kind: 'external',
          ...(recipient.displayName !== undefined ? { displayName: recipient.displayName } : {}),
          ...(recipient.email !== undefined ? { email: recipient.email } : {}),
          ...(recipient.phone !== undefined ? { phone: recipient.phone } : {}),
        },
        senderVisibleToRecipient: true,
        privacy: 'private',
        disclosure,
        endpointUrl: relayConfig.endpointUrl,
        variant: externalVariant.questions,
        compatibilityGroupId,
      });
      return { ok: true, compatibilityGroupId, link, pin };
    },
    assignmentsCompatibility: async (questionnaireId): Promise<CompatibilityGroup[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const qid = QuestionnaireIdSchema.parse(questionnaireId);
      const canReveal = await activePersonCan(ctx.fs, ctx.key, 'questionnaires.readRaw');
      // The active person's own compatibility sends of this questionnaire, grouped by their shared id.
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.questionnaireId === qid && a.compatibilityGroupId,
      );
      // "Processed" groups: a report Insight (subject = sender) for the report modes, OR the per-participant
      // context Insights for a `contextOnly` group (subject = each participant) — so scan ALL insights for
      // the group id, not just the sender's (§16.2). These are the sender's own groups, so no privacy gap.
      const insightGroups = new Set(
        (await listAllInsights(ctx.fs, ctx.key)).flatMap((i) =>
          i.provenance.compatibilityGroupId ? [i.provenance.compatibilityGroupId] : [],
        ),
      );
      const byGroup = new Map<string, Assignment[]>();
      for (const a of sends) {
        const gid = a.compatibilityGroupId as string;
        byGroup.set(gid, [...(byGroup.get(gid) ?? []), a]);
      }
      const groups: CompatibilityGroup[] = [];
      for (const [groupId, members] of byGroup) {
        const memberViews: CompatibilityMember[] = [];
        for (const a of members) {
          memberViews.push({
            assignmentId: a.id,
            recipientName: await recipientDisplayName(ctx.fs, ctx.key, a),
            channel: a.channel,
            relayLinked: Boolean(a.relay),
            // The sender's own member answers in-app — never a link to share.
            isSelf: a.recipient.kind === 'person' && a.recipient.personId === personId,
            status: a.status,
            ...(a.status === 'submitted' ? { submittedAt: a.updatedAt } : {}),
          });
        }
        const bothSubmitted = members.length >= 2 && members.every((a) => a.status === 'submitted');
        const first = members[0];
        const snapshot = first ? await getAssignmentSnapshot(ctx.fs, ctx.key, first.id) : null;
        const visibility: CompatibilityVisibility =
          snapshot?.compatibility?.visibility ?? 'sharedReport';
        groups.push({
          compatibilityGroupId: groupId,
          questionnaireId: qid,
          visibility,
          members: memberViews,
          bothSubmitted,
          report: await getAlignmentReport(ctx.fs, ctx.key, groupId),
          analyzed: insightGroups.has(groupId),
          canReveal: visibility === 'senderSeesAll' && canReveal,
        });
      }
      return groups;
    },
    assignmentsAlign: async (compatibilityGroupId): Promise<AlignmentResult> => {
      const deps = await aiDeps('questionnaires.viewResults');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const groupId = GroupIdSchema.parse(compatibilityGroupId);
      // Sender-scoped: only the person who sent the group may align it.
      const group = await getCompatibilityGroup(deps.fs, deps.key, groupId);
      if (group.length === 0 || group.some((a) => a.senderPersonId !== deps.personId)) {
        return { ok: false, reason: 'DENIED', message: 'Not available.' };
      }
      // A contextOnly group produces NO report — it's distilled per-participant via the dedicated path.
      const first = group[0];
      const snapshot = first ? await getAssignmentSnapshot(deps.fs, deps.key, first.id) : null;
      if (snapshot?.compatibility?.visibility === 'contextOnly') {
        return { ok: false, reason: 'DENIED', message: 'This is a context-only send.' };
      }
      return generateAlignment(deps, { compatibilityGroupId: groupId });
    },
    assignmentsDistillContextOnly: async (compatibilityGroupId): Promise<ContextOnlyResult> => {
      const deps = await aiDeps('questionnaires.viewResults');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const groupId = GroupIdSchema.parse(compatibilityGroupId);
      // Sender-scoped: only the sender of the group may run the distillation (they pay for it).
      const group = await getCompatibilityGroup(deps.fs, deps.key, groupId);
      if (group.length === 0 || group.some((a) => a.senderPersonId !== deps.personId)) {
        return { ok: false, reason: 'DENIED', message: 'Not available.' };
      }
      const first = group[0];
      const snapshot = first ? await getAssignmentSnapshot(deps.fs, deps.key, first.id) : null;
      if (snapshot?.compatibility?.visibility !== 'contextOnly') {
        return { ok: false, reason: 'DENIED', message: 'This isn’t a context-only send.' };
      }
      return distillContextOnly(deps, { compatibilityGroupId: groupId });
    },
    assignmentsPublishCompatResult: async (compatibilityGroupId): Promise<CompatResultPublish> => {
      // Push the generated alignment report back to the EXTERNAL recipient(s) of a compatibility group,
      // sealed under each one's content key so the relay page shows it (08 §17.12-D). Sender-scoped; needs
      // the report already generated. contextOnly isn't offered for external, so it never reaches here.
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults'))) {
        return { ok: false, reason: 'DENIED', message: 'Not available.' };
      }
      const personId = await activePersonId();
      if (!personId) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const groupId = GroupIdSchema.parse(compatibilityGroupId);
      const group = await getCompatibilityGroup(ctx.fs, ctx.key, groupId);
      if (group.length === 0 || group.some((a) => a.senderPersonId !== personId)) {
        return { ok: false, reason: 'DENIED', message: 'Not available.' };
      }
      const externals = group.filter((a) => a.channel === 'relay' && a.relay);
      if (externals.length === 0) {
        return {
          ok: false,
          reason: 'INVALID',
          message: 'There’s no external recipient to share with.',
        };
      }
      const report = await getAlignmentReport(ctx.fs, ctx.key, groupId);
      if (!report) {
        return { ok: false, reason: 'NOT_READY', message: 'Generate the report first.' };
      }
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) {
        return { ok: false, reason: 'INVALID', message: 'No relay is connected.' };
      }
      const senderName = (await getPerson(ctx.fs, ctx.key, personId))?.displayName ?? 'them';
      // From the recipient's point of view the "other" participant is the sender. Every external-eligible
      // visibility (sharedReport / eachSeesOwn / senderSeesAll) gives the recipient the combined report.
      const result: RelayResult = {
        schemaVersion: 1,
        kind: 'report',
        headline: `How you and ${senderName} compare`,
        summary: report.summary,
        items: report.items,
        generatedAt: report.generatedAt,
      };
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      let published = 0;
      let unsupported = 0; // a send minted before the wrapped content key existed (can't write back)
      for (const member of externals) {
        try {
          if (await publishRelayResult(ctx.fs, ctx.key, client, member.id, result)) published += 1;
          else unsupported += 1;
        } catch {
          // A relay the app can't reach right now is skipped; the sender can retry (idempotent).
        }
      }
      if (published === 0) {
        // Distinguish "this link predates result-sharing" from a transport failure, so the message is honest.
        return unsupported === externals.length
          ? {
              ok: false,
              reason: 'INVALID',
              message: 'This link was created before sharing results was supported.',
            }
          : {
              ok: false,
              reason: 'ERROR',
              message: 'Couldn’t reach the relay to share the results.',
            };
      }
      return { ok: true, published };
    },
    assignmentsRevealRaw: async (assignmentId): Promise<SendAnswer[] | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return null;
      const id = AssignmentIdSchema.parse(assignmentId);
      const assignment = await getAssignment(ctx.fs, ctx.key, id);
      if (!assignment) return null;
      const personId = await activePersonId();
      const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, assignment.id);
      // Who may read a Private send's raw answers: the Owner (full-access role — any send), OR the sender of
      // a `senderSeesAll` compatibility send holding the granted `questionnaires.readRaw`. Nothing else.
      // (The super-admin concept + the break-glass audit log were removed 2026-06-15.)
      let permitted = await activePersonIsOwner(ctx.fs, ctx.key);
      if (!permitted && assignment.senderPersonId === personId && assignment.compatibilityGroupId) {
        permitted =
          snapshot?.compatibility?.visibility === 'senderSeesAll' &&
          (await activePersonCan(ctx.fs, ctx.key, 'questionnaires.readRaw'));
      }
      if (!permitted) return null;

      const response = await getResponse(ctx.fs, ctx.key, assignment.id);
      if (!snapshot || !response || response.submittedAt === undefined) return null;
      return formatResponseAnswers(snapshot.questions, response.answers);
    },

    // --- Relay: external delivery (08-questionnaires §3.2/§3.5/§3.8/§5.2). The Cloudflare token + drain
    //     secret stay host-side (read from config/relay.enc); only renderer-safe data crosses the bridge.
    assignmentsCreateRelayLink: async (
      input,
    ): Promise<{ assignmentId: string; link: string; pin: string }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        throw new Error('Not permitted');
      const parsed = CreateRelayLinkSchema.parse(input);
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) {
        throw new Error('No relay is connected. Ask an admin to set one up in Settings → Relay.');
      }
      const personId = await activePersonId();
      if (!personId) throw new Error('Not permitted');
      // The external recipient is BOUND to the questionnaire at creation (08 §17.3) — read it from the def.
      const def = await getQuestionnaire(ctx.fs, ctx.key, parsed.questionnaireId);
      if (!def) throw new Error('Questionnaire not found');
      if (def.recipient?.kind !== 'external') {
        throw new Error(
          'This questionnaire is addressed to someone in the household — send it in-app.',
        );
      }
      const bound = def.recipient;
      const sender = await getPerson(ctx.fs, ctx.key, personId);
      const senderName = sender?.displayName ?? 'Someone';
      const privacy = parsed.privacy ?? 'private';
      const senderVisible = parsed.senderVisibleToRecipient ?? true;
      const disclosure = externalSendDisclosure(
        senderVisible ? senderName : 'the person who sent this',
        privacy,
      );
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      const { assignment, link, pin } = await createRelaySend(ctx.fs, ctx.key, client, {
        questionnaireId: parsed.questionnaireId,
        senderPersonId: personId,
        senderName,
        // Rebuild with conditional spreads so optional fields are absent (not `undefined`) under
        // exactOptionalPropertyTypes.
        recipient: {
          kind: 'external',
          ...(bound.displayName !== undefined ? { displayName: bound.displayName } : {}),
          ...(bound.email !== undefined ? { email: bound.email } : {}),
          ...(bound.phone !== undefined ? { phone: bound.phone } : {}),
        },
        senderVisibleToRecipient: senderVisible,
        privacy,
        disclosure,
        endpointUrl: config.endpointUrl,
        ...(parsed.expiresAt !== undefined ? { expiresAt: parsed.expiresAt } : {}),
      });
      return { assignmentId: assignment.id, link, pin };
    },
    assignmentsDrain: async (): Promise<{ drained: number; declined: number }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        return { drained: 0, declined: 0 };
      const config = await readRelayConfig(ctx.fs, ctx.key);
      const personId = await activePersonId();
      if (!config || !personId) return { drained: 0, declined: 0 };
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      // Drain the active person's still-open sends that carry relay material — external links AND the
      // links attached to in-app household sends (08 §17.13). Submitted/declined/revoked/expired ones are
      // already drained or done, so re-draining them is wasted relay round-trips.
      const open = ['sent', 'opened', 'inProgress'];
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.relay && open.includes(a.status),
      );
      let drained = 0;
      let declined = 0;
      for (const a of sends) {
        try {
          const result = await drainRelaySend(ctx.fs, ctx.key, client, a.id);
          drained += result.drained;
          if (result.declined) declined += 1;
        } catch {
          // A send the relay can't reach right now is skipped; the next drain retries (idempotent).
        }
      }
      return { drained, declined };
    },
    assignmentsRevoke: async (assignmentId): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal'))) return;
      const id = AssignmentIdSchema.parse(assignmentId);
      const assignment = await getAssignment(ctx.fs, ctx.key, id);
      if (!assignment?.relay) return;
      const personId = await activePersonId();
      if (
        assignment.senderPersonId !== personId &&
        !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))
      ) {
        throw new Error('Not permitted');
      }
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) return;
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      await revokeRelaySend(ctx.fs, ctx.key, client, id);
    },
    assignmentsReshare: async (assignmentId): Promise<RelayLinkResult | null> => {
      // Re-publish a fresh link + PIN for an existing send (08 §17.14). We never store the PIN (only a
      // hash), so the original can't be re-shown — resharing mints a NEW link + PIN and revokes the old
      // mailbox so the previous link stops working. Sender-scoped + external-capable + relay connected.
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        return null;
      const id = AssignmentIdSchema.parse(assignmentId);
      const assignment = await getAssignment(ctx.fs, ctx.key, id);
      if (!assignment) return null;
      const personId = await activePersonId();
      if (
        assignment.senderPersonId !== personId &&
        !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))
      ) {
        throw new Error('Not permitted');
      }
      // Never mint a link for the SENDER'S OWN member (they answer in-app), or for an already-answered
      // send. Key off the send's own sender (NOT the active person) so an admin resharing someone else's
      // group can't mint a link to the sender's full-context self-variant.
      if (
        assignment.recipient.kind === 'person' &&
        assignment.recipient.personId === assignment.senderPersonId
      ) {
        return null;
      }
      if (assignment.status === 'submitted' || assignment.status === 'declined') return null;
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) return null;
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      return reshareLink(ctx.fs, ctx.key, client, config.endpointUrl, assignment);
    },
    assignmentsReAsk: async (input): Promise<InAppSendResult> => {
      // Re-send the same questionnaire to the same bound recipient in one action (38 §3.3), mirroring the
      // original delivery, and auto-revoke the prior open link so it can't double-submit (38 §3.6).
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create')))
        throw new Error('Not permitted');
      const personId = await activePersonId();
      if (!personId) throw new Error('No active person');
      const { questionnaireId } = z.object({ questionnaireId: z.string().min(1) }).parse(input);
      const def = await getQuestionnaire(ctx.fs, ctx.key, questionnaireId);
      if (!def) throw new Error('Questionnaire not found');
      if (def.compatibility?.enabled) {
        throw new Error(
          'Re-asking a compatibility questionnaire isn’t supported yet — use Duplicate.',
        );
      }
      // The sender's prior sends of THIS questionnaire, newest first — replicate the last one's privacy.
      const prior = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.questionnaireId === questionnaireId,
      );
      const last = prior[0];
      const senderName = (await getPerson(ctx.fs, ctx.key, personId))?.displayName ?? 'Someone';
      const senderVisible = last?.senderVisibleToRecipient ?? true;
      const relayConfig = (await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal'))
        ? await readRelayConfig(ctx.fs, ctx.key)
        : null;
      const client = relayConfig
        ? createRelayHttpClient(relayConfig.endpointUrl, relayConfig.drainSecret, host.relay.fetch)
        : null;
      // Auto-revoke every still-open relay-linked prior send's mailbox so an old link can't be reopened.
      if (client) {
        for (const a of prior) {
          if (
            a.relay &&
            (a.status === 'sent' || a.status === 'opened' || a.status === 'inProgress')
          ) {
            await revokeRelayForDeletion(ctx.fs, ctx.key, client, a.id);
          }
        }
      }

      // External-bound → a fresh relay link (requires a relay).
      if (def.recipient?.kind === 'external') {
        if (!relayConfig || !client) {
          throw new Error('No relay is connected. Ask an admin to set one up in Settings → Relay.');
        }
        const bound = def.recipient;
        const privacy = last?.privacy ?? 'private';
        const { assignment, link, pin } = await createRelaySend(ctx.fs, ctx.key, client, {
          questionnaireId,
          senderPersonId: personId,
          senderName,
          recipient: {
            kind: 'external',
            ...(bound.displayName !== undefined ? { displayName: bound.displayName } : {}),
            ...(bound.email !== undefined ? { email: bound.email } : {}),
            ...(bound.phone !== undefined ? { phone: bound.phone } : {}),
          },
          senderVisibleToRecipient: senderVisible,
          privacy,
          disclosure: externalSendDisclosure(
            senderVisible ? senderName : 'the person who sent this',
            privacy,
          ),
          endpointUrl: relayConfig.endpointUrl,
        });
        return { assignment, link, pin };
      }

      // Household person → in-app send + a unified link when a relay is connected.
      if (def.recipient?.kind !== 'person') throw new Error('This questionnaire has no recipient.');
      const recipientPersonId = def.recipient.personId;
      if (!(await getPerson(ctx.fs, ctx.key, recipientPersonId)))
        throw new Error('Recipient not found');
      const privacy = last?.privacy ?? 'standard';
      const assignment = await createAssignment(ctx.fs, ctx.key, {
        questionnaireId,
        senderPersonId: personId,
        recipient: { kind: 'person' as const, personId: recipientPersonId },
        channel: 'inApp',
        privacy,
        senderVisibleToRecipient: senderVisible,
      });
      if (!client || !relayConfig) return { assignment };
      try {
        const { link, pin } = await attachRelayLink(ctx.fs, ctx.key, client, assignment.id, {
          senderName,
          senderVisibleToRecipient: senderVisible,
          disclosure: externalSendDisclosure(
            senderVisible ? senderName : 'the person who sent this',
            privacy,
          ),
          endpointUrl: relayConfig.endpointUrl,
        });
        return { assignment, link, pin };
      } catch {
        return {
          assignment,
          linkError: 'We couldn’t create the link — open Results to resend it.',
        };
      }
    },
    assignmentsExportResults: async (input): Promise<string | null> => {
      // Export a questionnaire's results to a file OUTSIDE the vault (38 §3.7). The privacy boundary is
      // enforced HERE (the bridge), not the renderer: a Standard send exports all answers; a PRIVATE send
      // exports NO answers — words or numbers (§21.5) — only that it was answered.
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        throw new Error('Not permitted');
      const personId = await activePersonId();
      if (!personId) throw new Error('No active person');
      const { questionnaireId, format } = z
        .object({ questionnaireId: z.string().min(1), format: z.enum(['csv', 'json']) })
        .parse(input);
      const def = await getQuestionnaire(ctx.fs, ctx.key, questionnaireId);
      if (!def) throw new Error('Questionnaire not found');
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.questionnaireId === questionnaireId,
      );
      const exportSends: ExportSend[] = [];
      for (const a of sends) {
        const recipientName = await recipientDisplayName(ctx.fs, ctx.key, a);
        const answers: { prompt: string; answer: string }[] = [];
        // Only a STANDARD submitted send exports its answers; a Private send exports none (§21.5).
        if (a.privacy === 'standard' && a.status === 'submitted') {
          const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
          const response = await getResponse(ctx.fs, ctx.key, a.id);
          if (snapshot && response) {
            const byId = new Map(response.answers.map((ans) => [ans.questionId, ans.value]));
            for (const q of snapshot.questions) {
              answers.push({ prompt: q.prompt, answer: formatAnswerForDisplay(q, byId.get(q.id)) });
            }
          }
        }
        exportSends.push({
          recipientName,
          status: a.status,
          privacy: a.privacy,
          ...(a.status === 'submitted' ? { submittedAt: a.updatedAt } : {}),
          answers,
        });
      }
      const text = buildResultsExport(def.title, exportSends, format);
      const slug =
        def.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'results';
      return host.saveImageFile(
        `${slug}.${format}`,
        new TextEncoder().encode(text),
        exportMimeType(format),
      );
    },
    questionnairesShareLink: async (
      questionnaireId,
      regenerate,
    ): Promise<RelayLinkResult | null> => {
      // The shareable link + PIN for a SENT questionnaire (08 §17.14d) — at the top of the sent (locked)
      // preview + the list kebab, so the link stays reachable after sending without going to Results. By
      // default this RE-SHOWS the EXISTING link/PIN (no regeneration); `regenerate: true` (the manual
      // Refresh) mints a fresh one + revokes the old. Always the latest still-open RECIPIENT send (never
      // the sender's own self member).
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const qid = QuestionnaireIdSchema.parse(questionnaireId);
      const open = ['sent', 'opened', 'inProgress'];
      const candidate = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId }))
        .filter(
          (a) =>
            a.questionnaireId === qid &&
            open.includes(a.status) &&
            // The shareable member is the RECIPIENT, never the sender's own (self) compat member.
            !(a.recipient.kind === 'person' && a.recipient.personId === a.senderPersonId),
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      if (!candidate) return null;
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) return null;
      // Re-show the existing link unless a refresh was asked for (or the send predates stored PIN material).
      if (!regenerate) {
        const existing = await readRelayLink(ctx.fs, ctx.key, candidate.id, config.endpointUrl);
        if (existing) return existing;
      }
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      return reshareLink(ctx.fs, ctx.key, client, config.endpointUrl, candidate);
    },
    relayStatus: async (): Promise<RelayStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        return { configured: false, updateAvailable: false };
      return relayStatusOf(await readRelayConfig(ctx.fs, ctx.key), host.relay.currentVersion);
    },
    relayConnect: async (input): Promise<RelayStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        throw new Error('Not permitted');
      const { apiToken, accountId } = RelayConnectSchema.parse(input);
      const bundle = await loadDeployableRelayBundle(host.relay);
      const result = await deployRelay(host.relay.fetch, bundle, { apiToken, accountId });
      const config: RelayConfig = {
        schemaVersion: 1,
        endpointUrl: result.endpointUrl,
        drainSecret: result.drainSecret,
        cloudflare: {
          accountId,
          apiToken,
          relayVersion: result.relayVersion,
          scriptName: result.scriptName,
          kvNamespaceId: result.kvNamespaceId,
        },
      };
      await writeRelayConfig(ctx.fs, ctx.key, config);
      return relayStatusOf(config, host.relay.currentVersion);
    },
    relayUpdate: async (): Promise<RelayStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        throw new Error('Not permitted');
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) return { configured: false, updateAvailable: false };
      const bundle = await loadDeployableRelayBundle(host.relay);
      const relayVersion = await updateRelay(host.relay.fetch, bundle, {
        apiToken: config.cloudflare.apiToken,
        accountId: config.cloudflare.accountId,
        kvNamespaceId: config.cloudflare.kvNamespaceId,
        drainSecret: config.drainSecret,
      });
      const next: RelayConfig = { ...config, cloudflare: { ...config.cloudflare, relayVersion } };
      await writeRelayConfig(ctx.fs, ctx.key, next);
      return relayStatusOf(next, host.relay.currentVersion);
    },
    relayTeardown: async (): Promise<RelayStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        throw new Error('Not permitted');
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (config) {
        await teardownRelay(host.relay.fetch, {
          apiToken: config.cloudflare.apiToken,
          accountId: config.cloudflare.accountId,
          scriptName: config.cloudflare.scriptName,
          kvNamespaceId: config.cloudflare.kvNamespaceId,
        });
        await clearRelayConfig(ctx.fs);
      }
      return { configured: false, updateAvailable: false };
    },

    // --- Dreams (12-dreams) — gated by `dreams.own`, scoped to the active dreamer ---
    dreamsList: async (): Promise<Dream[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return [];
      return listDreams(ctx.fs, ctx.key, personId);
    },
    dreamGet: async (id): Promise<Dream | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getDream(ctx.fs, ctx.key, personId, PersonIdSchema.parse(id));
    },
    dreamSave: async (input): Promise<Dream> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        throw new Error('Not permitted');
      }
      const { id: inputId, ...fields } = DreamInputSchema.parse(input);
      // Main owns id/schemaVersion/personId/status/timestamps; merge over an existing dream so editing
      // preserves createdAt + the analysis link (status/analysisId change only in the analysis slice) and
      // the image descriptor (13 §4.2 — written only by dreamImageService, never sendable by the renderer;
      // dropping it would orphan the encrypted bytes at dreams/<id>/image.enc and revoke its sharing).
      //
      // The carry-forward list is hand-maintained, which is exactly how `image` was once dropped, so the
      // guard below fails the BUILD if `Dream` gains another main-owned field and nobody decides here
      // whether it survives an edit. Note what it does and does not prove: it checks that every
      // main-owned field has been CLASSIFIED, not that the corresponding spread was actually written —
      // listing a field as carried-forward without adding its spread still compiles. A triage tripwire,
      // not a proof.
      // Set fresh here: schemaVersion/personId/status/createdAt/updatedAt. Carried forward from the
      // existing record: analysisId/image/analysisReadyAt. If this errors, `Dream` gained a main-owned
      // field — decide whether an edit keeps it, add it below, then list it here. Do NOT just widen the
      // list. (`analysisReadyAt` is carried: it is the coach's "ready to analyze" offer, 66 §3.4, and
      // dropping it on an edit would silently retract the offer.)
      const _guard: AssertMainOwnedHandled<
        Dream,
        DreamInput,
        | 'schemaVersion'
        | 'personId'
        | 'status'
        | 'createdAt'
        | 'updatedAt'
        | 'analysisId'
        | 'image'
        | 'analysisReadyAt'
      > = true;
      void _guard;
      //
      // Keep this read immediately before the write. `dreamSave` and `generateDreamImage` are both
      // read-then-write-the-whole-record, so whichever writes last wins; reading at save time (rather
      // than caching anything from when the composer opened) keeps this side's window down to the few
      // microseconds of this function. `generateDreamImage` re-reads before ITS write for the same
      // reason (its window spanned two network calls, so it could lose typed prose — the worse
      // direction). Neither is a lock: two writes landing inside each other's re-read still race.
      // Closing it properly needs field-level merging or serialization across every dream writer.
      const existing = inputId ? await getDream(ctx.fs, ctx.key, personId, inputId) : null;
      const now = new Date().toISOString();
      const dream: Dream = {
        ...fields,
        id: existing?.id ?? inputId ?? uuid(),
        schemaVersion: 1,
        personId,
        status: existing?.status ?? 'captured',
        ...(existing?.analysisId !== undefined ? { analysisId: existing.analysisId } : {}),
        // 66 §3.4 — the readiness signal is main-owned like status/analysisId; carry it across an edit or
        // editing the dream would silently drop the coach's "ready to analyze" offer.
        ...(existing?.analysisReadyAt !== undefined
          ? { analysisReadyAt: existing.analysisReadyAt }
          : {}),
        ...(existing?.image !== undefined ? { image: existing.image } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await saveDream(ctx.fs, ctx.key, dream);
      return dream;
    },
    dreamDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return;
      // deleteDream removes the dream folder but KEEPS its derived Insight (20-memory-dashboard §3.7) — an
      // insight is the coach's lasting memory and persists when its source is gone (its provenance link then
      // shows "source removed"). To remove the insight too, the dreamer uses Memory's explicit delete.
      await deleteDream(ctx.fs, personId, PersonIdSchema.parse(id));
    },
    dreamStartReflection: async (input): Promise<DreamReflectionResult> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // Key host-side; streamed opener deltas go to the dedicated dream sink (never the Sessions stream).
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return openReflection({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        dreamId,
        onDelta: (text) => host.emitStreamChunk('dream', text),
        now: new Date(),
      });
    },
    dreamAnalyzeTurn: async (input): Promise<ChatTurnResult> => {
      const { dreamId, userText } = DreamAnalyzeTurnSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // The API key is read host-side and never crosses to the renderer; streamed deltas go to the
      // dedicated dream sink so they never mix with the Sessions chat stream.
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return runAnalysisTurn({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        dreamId,
        userText,
        onDelta: (text) => host.emitStreamChunk('dream', text),
        now: new Date(),
      });
    },
    dreamRetryTurn: async (input): Promise<ChatTurnResult> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return retryDreamReply({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        dreamId,
        onDelta: (text) => host.emitStreamChunk('dream', text),
        now: new Date(),
      });
    },
    dreamRewind: async (input): Promise<RewindResult> => {
      const { dreamId, index, expect } = RewindDreamSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'NOT_FOUND' };
      }
      return rewindDreamConversation(ctx.fs, ctx.key, personId, dreamId, index, expect);
    },
    dreamRegenerateFrom: async (input): Promise<ChatTurnResult> => {
      const { dreamId, index, expect } = RewindDreamSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return regenerateDreamFrom(
        {
          fs: ctx.fs,
          key: ctx.key,
          client: host.claude,
          apiKey,
          model: await host.activeModel(),
          personId,
          dreamId,
          onDelta: (text) => host.emitStreamChunk('dream', text),
          now: new Date(),
        },
        index,
        expect,
      );
    },
    dreamGetAnalysis: async (dreamId): Promise<DreamAnalysis | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getAnalysis(ctx.fs, ctx.key, personId, PersonIdSchema.parse(dreamId));
    },
    dreamGetConversation: async (dreamId): Promise<Conversation | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getDreamConversation(ctx.fs, ctx.key, personId, PersonIdSchema.parse(dreamId));
    },
    dreamSynthesize: async (input): Promise<DreamSynthesisResult> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return synthesizeAnalysis({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        dreamId,
        now: new Date(),
        // 66 §3.4 — this channel gates on `dreams.own`, but auto-creating a questionnaire needs
        // `questionnaires.create`. Resolved here (the bridge is the trust boundary) rather than in core.
        questionnairesEnabled: await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'),
      });
    },
    dreamUpdateAnalysis: async (input): Promise<DreamAnalysis | null> => {
      const { dreamId, edits } = DreamUpdateAnalysisSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return updateAnalysis({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        dreamId,
        edits,
        now: new Date(),
      });
    },
    dreamApprove: async (input): Promise<DreamApproveResult> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'NOT_FOUND', message: 'There’s no analysis to approve yet.' };
      }
      // The dream→coach master toggle lives in vault settings (default ON); the service refuses when off.
      const memoryEnabled =
        (await readVaultSettingsValues(ctx.fs))['dreams.memoryEnabled'] !== false;
      return approveAnalysis({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        dreamId,
        memoryEnabled,
        now: new Date(),
      });
    },
    dreamRemoveFromContext: async (input): Promise<void> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return;
      await removeFromContext({ fs: ctx.fs, key: ctx.key, personId, dreamId, now: new Date() });
    },
    dreamPatternStats: async (input): Promise<DreamPatternStats> => {
      const { window } = DreamPatternWindowSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return emptyPatternStats(window);
      }
      return getPatternStats(ctx.fs, ctx.key, personId, window, new Date());
    },
    dreamGetPatternSummary: async (): Promise<DreamPatternSummary | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getPatternSummary(ctx.fs, ctx.key, personId);
    },
    dreamPatternNarrative: async (): Promise<DreamNarrativeResult> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return generatePatternNarrative({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        now: new Date(),
      });
    },
    dreamApprovePatternNarrative: async (): Promise<DreamApproveResult> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return {
          ok: false,
          reason: 'NOT_FOUND',
          message: 'There’s no pattern reflection to approve yet.',
        };
      }
      const memoryEnabled =
        (await readVaultSettingsValues(ctx.fs))['dreams.memoryEnabled'] !== false;
      return approvePatternNarrative({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        memoryEnabled,
        now: new Date(),
      });
    },
    dreamRemovePatternNarrative: async (): Promise<void> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return;
      await removePatternNarrativeFromContext({ fs: ctx.fs, key: ctx.key, personId });
    },
    dreamShareTargets: async (): Promise<DreamShareTarget[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return [];
      return listDreamShareTargets(ctx.fs, ctx.key, personId);
    },
    dreamGetInsight: async (dreamId): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getDreamInsight(ctx.fs, ctx.key, personId, PersonIdSchema.parse(dreamId));
    },
    dreamSetFactShare: async (input): Promise<DreamShareResult> => {
      const { dreamId, factId, withPersonId, share } = DreamSetFactShareSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      // Cross-person sharing is the privileged action — gated by `dreams.shareContext`, not `dreams.own`.
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.shareContext'))) {
        return { ok: false, reason: 'NOT_FOUND' };
      }
      return setDreamFactShare({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        dreamId,
        factId,
        withPersonId,
        share,
        now: new Date(),
      });
    },
    // Per-person image preferences (image-settings amendment) — style, direction + the on/off toggle, split
    // per use-type (dreams / story). Scoped to the ACTIVE person: each member edits only their own, so one
    // choice never overwrites another's (the reported bug). No admin gate — it's a personal preference.
    imagesGetPrefs: async () => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return null;
      return readImagePrefs(ctx.fs, ctx.key, personId);
    },
    imagesSetPrefs: async (input) => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return null;
      const p = ImagePrefsSetSchema.parse(input);
      // Build the patch with only DEFINED keys (exactOptionalPropertyTypes: no `undefined` values).
      const patch: Partial<FeatureImagePrefs> = {
        ...(p.patch.enabled !== undefined ? { enabled: p.patch.enabled } : {}),
        ...(p.patch.style !== undefined ? { style: p.patch.style } : {}),
        ...(p.patch.styleNotes !== undefined ? { styleNotes: p.patch.styleNotes } : {}),
      };
      return setFeatureImagePrefs(ctx.fs, ctx.key, personId, p.feature, patch);
    },
    dreamGenerateImage: async (input): Promise<DreamImageResult> => {
      const { dreamId } = DreamGenerateImageSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.generateImage'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // Consent + style + direction are now PER-PERSON (image-settings amendment) so one member's choice
      // never overwrites another's; the image MODEL stays an owner-managed vault setting and both API keys
      // are read host-side and never cross to the renderer.
      const settings = await readVaultSettingsValues(ctx.fs);
      const imageModel =
        typeof settings['dreams.imageModel'] === 'string'
          ? settings['dreams.imageModel']
          : 'gpt-image-2';
      const prefs = await readFeatureImagePrefs(ctx.fs, ctx.key, personId, 'dreams');
      const styleNotes = prefs.styleNotes.trim();
      const progressId = `dream:${dreamId}`;
      const result = await generateDreamImage({
        fs: ctx.fs,
        key: ctx.key,
        claude: host.claude,
        image: host.image,
        anthropicApiKey: (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
        openaiApiKey: (await resolveOpenAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
        consent: prefs.enabled,
        claudeModel: await host.activeModel(),
        imageModel,
        style: prefs.style,
        ...(styleNotes ? { styleNotes } : {}),
        personId,
        dreamId,
        now: new Date(),
        onPhase: (phase) => host.emitImageProgress({ id: progressId, phase }),
      });
      host.emitImageProgress({ id: progressId, phase: result.ok ? 'done' : 'error' });
      if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
      // Cost ($) is admin-only (the budgets.manage gate, like everywhere else) — a non-admin's result
      // carries no cost figure. Combines the flat image charge + the small distillation charge.
      const showCost = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      return {
        ok: true,
        mime: result.mime,
        ...(showCost ? { costUsd: result.imageUsage.costUsd + result.promptUsage.costUsd } : {}),
      };
    },
    dreamGetImage: async (input): Promise<{ mime: string; dataBase64: string } | null> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.generateImage'))) {
        return null;
      }
      const image = await getDreamImage(ctx.fs, ctx.key, personId, dreamId);
      return image ? { mime: image.mime, dataBase64: toBase64(image.bytes) } : null;
    },
    dreamDeleteImage: async (input): Promise<void> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.generateImage'))) {
        return;
      }
      await deleteDreamImage(ctx.fs, ctx.key, personId, dreamId, new Date());
    },
    dreamExportImage: async (input): Promise<string | null> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.generateImage'))) {
        return null;
      }
      const image = await getDreamImage(ctx.fs, ctx.key, personId, dreamId);
      if (!image) return null;
      const ext =
        image.mime === 'image/webp' ? 'webp' : image.mime === 'image/jpeg' ? 'jpg' : 'png';
      // The bytes leave the encrypted vault by the dreamer's explicit choice (§3.5/§8.5).
      return host.saveImageFile(`dream-image.${ext}`, image.bytes, image.mime);
    },
    dreamSetImageShare: async (input): Promise<DreamShareResult> => {
      const { dreamId, targetPersonId, shared } = DreamSetImageShareSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      // Cross-person sharing is the privileged action — gated by `dreams.shareContext` (not `dreams.own`).
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.shareContext'))) {
        return { ok: false, reason: 'NOT_FOUND' };
      }
      return setDreamImageShare({
        fs: ctx.fs,
        key: ctx.key,
        dreamerId: personId,
        dreamId,
        targetPersonId,
        shared,
        now: new Date(),
      });
    },
    dreamGetSharedImage: async (input): Promise<{ mime: string; dataBase64: string } | null> => {
      const { dreamerId, dreamId } = DreamGetSharedImageSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const viewerId = ctx ? await activePersonId() : null;
      // Any signed-in person may read — the SHARE itself is the grant; the service re-gates relationship +
      // shareableWith + sensitivity at read time, so this can't reach an image not shared with the viewer.
      if (!ctx || !viewerId) return null;
      const image = await getSharedDreamImage(ctx.fs, ctx.key, viewerId, dreamerId, dreamId);
      return image ? { mime: image.mime, dataBase64: toBase64(image.bytes) } : null;
    },
    dreamListSharedImages: async (): Promise<DreamSharedImage[]> => {
      const ctx = await host.vaultAndKey();
      const viewerId = ctx ? await activePersonId() : null;
      if (!ctx || !viewerId) return [];
      return listImagesSharedWith(ctx.fs, ctx.key, viewerId);
    },

    // --- Personal onboarding (18-personal-onboarding §6) — gated by `intake.own`, active-person-scoped ---
    intakeGetState: async (): Promise<IntakeState> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return emptyIntakeState(personId ?? '');
      }
      return buildIntakeState(ctx.fs, ctx.key, personId);
    },
    intakeRunTurn: async (input): Promise<IntakeTurnResult> => {
      const { sectionId, userText } = IntakeRunTurnSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // The API key is read host-side and never crosses to the renderer; deltas go to the dedicated intake
      // sink so they never mix with the Sessions / Dreams streams.
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return runIntakeTurn({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        sectionId,
        userText,
        onDelta: (text) => host.emitStreamChunk('intake', text),
        now: new Date(),
      });
    },
    intakeRetryTurn: async (input): Promise<IntakeTurnResult> => {
      const { sectionId } = IntakeSectionIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return retryIntakeTurn({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        sectionId,
        onDelta: (text) => host.emitStreamChunk('intake', text),
        now: new Date(),
      });
    },
    intakeRewind: async (input): Promise<IntakeRewindOutcome> => {
      const { sectionId, index, expect } = RewindIntakeSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return { ok: false, reason: 'NOT_FOUND' };
      }
      return rewindIntakeSection(ctx.fs, ctx.key, personId, sectionId, index, expect, new Date());
    },
    intakeRegenerateFrom: async (input): Promise<IntakeTurnResult> => {
      const { sectionId, index, expect } = RewindIntakeSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return regenerateIntakeFrom(
        {
          fs: ctx.fs,
          key: ctx.key,
          client: host.claude,
          apiKey,
          model: await host.activeModel(),
          personId,
          sectionId,
          onDelta: (text) => host.emitStreamChunk('intake', text),
          now: new Date(),
        },
        index,
        expect,
      );
    },
    intakeSkipSection: async (input): Promise<IntakeState> => {
      const { sectionId } = IntakeSectionIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return emptyIntakeState(personId ?? '');
      }
      await skipIntakeSection(ctx.fs, ctx.key, personId, sectionId, new Date());
      return buildIntakeState(ctx.fs, ctx.key, personId);
    },
    intakeSubmitForm: async (input): Promise<IntakeState> => {
      const { sectionId, answers, sharing, complete } = IntakeSubmitFormSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return emptyIntakeState(personId ?? '');
      }
      // An adult-gated section (intimacy) requires the shared 18+ acknowledgement — enforced HERE (the bridge
      // is the trust boundary, not the renderer). Without it, the submit is a no-op.
      const def = getIntakeSection(sectionId);
      if (def?.adult) {
        const prefs = await getGuidancePrefs(ctx.fs, ctx.key, personId);
        if (prefs.adultAcknowledged !== true) return buildIntakeState(ctx.fs, ctx.key, personId);
      }
      // `complete` defaults to true (the Continue/Done button); auto-save passes false to persist a draft.
      await submitSectionForm(
        ctx.fs,
        ctx.key,
        personId,
        sectionId,
        answers,
        new Date(),
        sharing,
        complete ?? true,
      );
      return buildIntakeState(ctx.fs, ctx.key, personId);
    },
    intakeAcknowledgeAdult: async (): Promise<IntakeState> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return emptyIntakeState(personId ?? '');
      }
      // The 18+ ack is shared with guided sessions (16) — acking here unlocks both surfaces (§3.3 decision).
      await acknowledgeAdult(ctx.fs, ctx.key, personId);
      return buildIntakeState(ctx.fs, ctx.key, personId);
    },
    intakeSetAnswerSharing: async (input): Promise<boolean> => {
      // The transparency surface's per-answer scope control (44 §3.5). Gated on `intake.own` + scoped to the
      // active person — a person can only change THEIR OWN intake answer sharing (the bridge is the boundary).
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own')))
        return false;
      const { sectionId, questionId, types } = IntakeSetAnswerSharingSchema.parse(input);
      const updated = await setIntakeAnswerSharing(
        ctx.fs,
        ctx.key,
        personId,
        sectionId,
        questionId,
        types,
        new Date(),
      );
      return updated !== null;
    },
    intakeSynthesize: async (input): Promise<IntakeSynthesisResult> => {
      const { sectionId } = IntakeSynthesizeSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return synthesizeIntake({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        ...(sectionId !== undefined ? { sectionId } : {}),
        now: new Date(),
      });
    },
    // Self-maintaining profile (18 §15) — own-scoped + gated `intake.own`. The list/accept/dismiss return the
    // updated PENDING set so the renderer re-renders from one round-trip.
    profileSuggestions: async (): Promise<ProfileUpdateSuggestion[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) return [];
      return listPendingSuggestions(ctx.fs, ctx.key, personId);
    },
    profileAcceptSuggestion: async (id): Promise<ProfileUpdateSuggestion[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) return [];
      await acceptSuggestion(
        ctx.fs,
        ctx.key,
        personId,
        ProfileSuggestionIdSchema.parse(id),
        new Date(),
      );
      return listPendingSuggestions(ctx.fs, ctx.key, personId);
    },
    profileDismissSuggestion: async (id): Promise<ProfileUpdateSuggestion[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) return [];
      await dismissSuggestion(
        ctx.fs,
        ctx.key,
        personId,
        ProfileSuggestionIdSchema.parse(id),
        new Date(),
      );
      return listPendingSuggestions(ctx.fs, ctx.key, personId);
    },

    // --- UI state (device-local) ---
    getSidebarCollapsed: async (): Promise<boolean> => {
      return (await host.readDeviceState()).sidebarCollapsed ?? false;
    },
    setSidebarCollapsed: async (collapsed): Promise<void> => {
      await host.updateDeviceState({ sidebarCollapsed: z.boolean().parse(collapsed) });
    },

    // --- Discovery (41 §4) — one-time orientation/tip dismissals, device-local + per-person ---
    getDiscoveryDismissals: async (): Promise<string[]> => {
      const personId = await activePersonId();
      if (!personId) return [];
      const device = await host.readDeviceState();
      return z.array(z.string()).parse(device.discoveryDismissals?.[personId] ?? []);
    },
    setDiscoveryDismissals: async (keys): Promise<void> => {
      const parsed = z.array(z.string()).parse(keys);
      const personId = await activePersonId();
      if (!personId) return;
      const device = await host.readDeviceState();
      await host.updateDeviceState({
        discoveryDismissals: { ...device.discoveryDismissals, [personId]: parsed },
      });
    },

    // --- Notifications (35-notification-system §6) ---
    getNotificationState: async (): Promise<PersonNotificationState> => {
      const device = await host.readDeviceState();
      const personId = await activePersonId();
      // App-global keys (the update notice, 36 §11) come from the shared blob so a dismissal is shared
      // across personas + survives a switch; everything else is the active person's own state.
      const global = PersonNotificationStateSchema.parse(device.globalNotificationState ?? {});
      const person = personId
        ? PersonNotificationStateSchema.parse(device.notificationState?.[personId] ?? {})
        : { read: {}, dismissed: {} };
      return {
        read: { ...person.read, ...pickKeys(global.read, APP_GLOBAL_NOTIFICATION_KEYS) },
        dismissed: {
          ...person.dismissed,
          ...pickKeys(global.dismissed, APP_GLOBAL_NOTIFICATION_KEYS),
        },
      };
    },
    setNotificationState: async (state): Promise<void> => {
      const parsed = PersonNotificationStateSchema.parse(state);
      const device = await host.readDeviceState();
      // Split: the app-global keys persist to the shared blob; the rest to the active person's blob.
      const patch: DeviceStatePatch = {
        globalNotificationState: {
          read: pickKeys(parsed.read, APP_GLOBAL_NOTIFICATION_KEYS),
          dismissed: pickKeys(parsed.dismissed, APP_GLOBAL_NOTIFICATION_KEYS),
        },
      };
      const personId = await activePersonId();
      if (personId) {
        patch.notificationState = {
          ...device.notificationState,
          [personId]: {
            read: omitKeys(parsed.read, APP_GLOBAL_NOTIFICATION_KEYS),
            dismissed: omitKeys(parsed.dismissed, APP_GLOBAL_NOTIFICATION_KEYS),
          },
        };
      }
      await host.updateDeviceState(patch);
    },
    notificationsResponsesArrived: async (): Promise<ResponsesArrivedSummary[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      const personId = await activePersonId();
      if (!personId) return [];
      // The active person's own sends with a submitted response, grouped by questionnaire. Local read —
      // the relay drain (the existing point) is what fetches external responses; here we only count what's
      // already in the vault, so no network is added (35 §3.6/§11).
      const sends = await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId });
      const counts = new Map<string, number>();
      // The most recent answered send per questionnaire (by submit time ≈ updatedAt) — names the
      // notification ("Angel answered …") and orders it (38 §4.2).
      const latest = new Map<string, Assignment>();
      for (const a of sends) {
        // Count both 'submitted' and 'analyzed' — a response the sender already analyzed still ARRIVED,
        // so the count stays a monotonic "responses received" tally. Counting only 'submitted' would make
        // analyzing one a 2→1 decrease, which `onIncrease` never re-surfaces, hiding a still-pending one.
        if (a.status !== 'submitted' && a.status !== 'analyzed') continue;
        // Skip a SELF-send (sender === recipient): a biographer story check-in and a self-targeted auto
        // check-in are both self-sends, so counting them would raise a "<Your name> answered …" bell about
        // yourself for answering your own questions. Their answers still reach the book/insights normally.
        if (a.recipient.kind === 'person' && a.recipient.personId === personId) continue;
        counts.set(a.questionnaireId, (counts.get(a.questionnaireId) ?? 0) + 1);
        const cur = latest.get(a.questionnaireId);
        if (!cur || a.updatedAt > cur.updatedAt) latest.set(a.questionnaireId, a);
      }
      const out: ResponsesArrivedSummary[] = [];
      for (const [questionnaireId, submittedCount] of counts) {
        const def = await getQuestionnaire(ctx.fs, ctx.key, questionnaireId);
        if (!def) continue; // a deleted questionnaire — nothing to navigate to
        const newest = latest.get(questionnaireId);
        if (!newest) continue; // unreachable (counts ⊆ latest), but keeps the index access total
        out.push({
          questionnaireId,
          title: def.title,
          submittedCount,
          latestRecipientName: await recipientDisplayName(ctx.fs, ctx.key, newest),
          at: newest.updatedAt,
        });
      }
      return out;
    },
    notificationsAnswersUpdated: async (): Promise<AnswersUpdatedSummary[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      const personId = await activePersonId();
      if (!personId) return [];
      // The sender's sends whose recipient EDITED their answers since the sender analyzed them (56 §3.2) —
      // one entry per stale send. Local read; carries NO raw answers, so a Private send's boundary holds.
      const insightByAssignment = new Map(
        (await listInsightsForPerson(ctx.fs, ctx.key, personId)).flatMap((i) =>
          i.provenance.assignmentId ? [[i.provenance.assignmentId, i] as const] : [],
        ),
      );
      const sends = await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId });
      const out: AnswersUpdatedSummary[] = [];
      for (const a of sends) {
        const insight = insightByAssignment.get(a.id);
        if (!insight) continue; // never analyzed → not "stale"; the responses-arrived nudge covers a first look
        const response = await getResponse(ctx.fs, ctx.key, a.id);
        if (!isAnalysisStale(response, insight) || !response) continue;
        const def = await getQuestionnaire(ctx.fs, ctx.key, a.questionnaireId);
        if (!def) continue; // a deleted questionnaire — nothing to navigate to
        out.push({
          assignmentId: a.id,
          questionnaireId: a.questionnaireId,
          title: def.title,
          recipientName: await recipientDisplayName(ctx.fs, ctx.key, a),
          revision: response.revision ?? 1,
          at: response.submittedAt ?? a.updatedAt,
        });
      }
      return out;
    },
    notificationsRemindersDue: async (): Promise<ReminderDueSummary[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      const personId = await activePersonId();
      if (!personId) return [];
      // The sender's still-open sends past the 7-day window, grouped by questionnaire. Local read — no
      // background network, no scheduler; the nudge is recomputed on the existing launch/focus tick (35 §3.6).
      const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const sends = await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId });
      const groups = new Map<string, { count: number; newest: Assignment }>();
      for (const a of sends) {
        // Still awaiting an answer (not submitted/declined/expired/revoked) AND past the window.
        if (a.status !== 'sent' && a.status !== 'opened' && a.status !== 'inProgress') continue;
        if (now - new Date(a.createdAt).getTime() < WINDOW_MS) continue;
        const cur = groups.get(a.questionnaireId);
        groups.set(a.questionnaireId, {
          count: (cur?.count ?? 0) + 1,
          newest: !cur || a.createdAt > cur.newest.createdAt ? a : cur.newest,
        });
      }
      const out: ReminderDueSummary[] = [];
      for (const [questionnaireId, { count, newest }] of groups) {
        const def = await getQuestionnaire(ctx.fs, ctx.key, questionnaireId);
        if (!def) continue;
        out.push({
          questionnaireId,
          title: def.title,
          recipientName: await recipientDisplayName(ctx.fs, ctx.key, newest),
          count,
        });
      }
      return out;
    },
    openExternal: async (url): Promise<void> => {
      const parsed = z.string().url().parse(url);
      // Only ever hand the shell an http(s) URL — never a file:/custom scheme from a notification payload.
      if (!/^https?:\/\//i.test(parsed))
        throw new Error('Only http(s) URLs may be opened externally');
      await host.openExternal(parsed);
    },

    // --- Update awareness (36-update-awareness §6) ---
    updatesCheck: async (): Promise<UpdateCheckResult | null> => {
      const result = await host.checkForUpdate();
      // Cache ONLY a successful result — a `null` (couldn't check) must not overwrite the last-known (§7).
      if (result) {
        await host.updateDeviceState({
          lastUpdateCheckAt: result.checkedAt,
          latestKnownVersion: result.latest,
          lastUpdateCheckResult: result,
        });
      }
      return result;
    },
    updatesGetState: async (): Promise<UpdateCheckResult | null> =>
      (await host.readDeviceState()).lastUpdateCheckResult ?? null,
  };
}

/** Keep only the entries whose key is in `keys` (the app-global notification split, 36 §11). */
function pickKeys(map: Record<string, string>, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) if (map[key] !== undefined) out[key] = map[key] as string;
  return out;
}

/** Drop the entries whose key is in `keys` (the per-person remainder of the notification split). */
function omitKeys(map: Record<string, string>, keys: readonly string[]): Record<string, string> {
  const set = new Set(keys);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) if (!set.has(key)) out[key] = value;
  return out;
}
