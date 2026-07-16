import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { IpcChannels, type AppPlatform } from '../shared/channels';
import { BootStateSchema, type BootState } from '../shared/schemas';
import { createCoreBridge, readVaultSettingsValues, type BridgeHost } from '../shared/coreBridge';
import { computeBootState } from './boot';
import { initializeVault } from './vault/vault';
import { findConflicts } from './vault/conflicts';
import { readDeviceState, updateDeviceState, writeDeviceState } from './state/deviceStore';
import { readDeviceSettings, writeDeviceSettings } from './settings/settingsStore';
import { createNodeSecretStore } from './host/nodeSecretStore';
import { defaultEncryptor } from './secrets/encryptor';
import { defaultClaudeClient } from './claude/anthropicClient';
import { defaultImageClient } from './image/openaiImageClient';
import { loadMasterKey } from '@selfos/core/crypto';
import { createNodeFileSystem } from './host/nodeFileSystem';
import { loadRelayBundle, RELAY_VERSION } from './relay/relayBundle';
import { fakeRelayBundle, fakeRelayFetch } from '../shared/relay/fakeRelay';
import { checkForUpdate } from '@selfos/core/updates';
import { fakeUpdateFetch } from './updates/fakeUpdateFetch';
import { startVaultWatcher, stopVaultWatcher } from './vaultWatcherManager';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const encryptor = defaultEncryptor();
const claudeClient = defaultClaudeClient();
const imageClient = defaultImageClient();

function userDataDir(): string {
  return app.getPath('userData');
}

async function activeVaultPath(): Promise<string | null> {
  return (await readDeviceState(userDataDir())).vaultPath;
}

async function currentBootState(): Promise<BootState> {
  return BootStateSchema.parse(await computeBootState(userDataDir()));
}

/**
 * Registers main-process IPC handlers. The renderer talks only to `window.selfos` (a `SelfosBridge`);
 * here we build a node-backed `BridgeHost`, hand it to the shared `createCoreBridge` factory (the same
 * factory the iOS host uses — 07-mobile-platform §5.3), and register every data channel as a thin
 * `ipcMain.handle` delegate. Platform-specific surfaces (the folder picker, the chokidar watcher,
 * conflict scan, reveal) live in the host below; the chat stream + `useVault` are special-cased so the
 * watcher / stream target the invoking `WebContents`.
 */
export function registerIpcHandlers(): void {
  // The device-local secret store + the renderers to stream chat / dream-analysis chunks back to (each
  // set per turn, on the dedicated channel).
  const secrets = createNodeSecretStore(userDataDir(), encryptor);
  let chatSender: WebContents | undefined;
  let dreamSender: WebContents | undefined;
  let intakeSender: WebContents | undefined;
  let togetherSender: WebContents | undefined;
  // E2E/dev: a deterministic in-memory relay (no real Cloudflare account/network), like SELFOS_FAKE_CLAUDE.
  const useFakeRelay = Boolean(process.env['SELFOS_FAKE_RELAY']);
  // E2E/dev: a deterministic update check (no real GitHub call). The env value is the latest version to
  // report; the REAL parse + semver logic still runs (36-update-awareness §10).
  const fakeUpdate = process.env['SELFOS_FAKE_UPDATE'];
  const updateFetch = fakeUpdate
    ? fakeUpdateFetch(fakeUpdate)
    : (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        globalThis.fetch(input, init);

  const host: BridgeHost = {
    vaultAndKey: async () => {
      const vaultDir = await activeVaultPath();
      if (!vaultDir) return null;
      const key = await loadMasterKey(secrets);
      return key ? { fs: createNodeFileSystem(vaultDir), key } : null;
    },
    vaultPath: activeVaultPath,
    fileSystem: createNodeFileSystem,
    secrets,
    claude: claudeClient,
    image: imageClient,
    readDeviceState: () => readDeviceState(userDataDir()),
    updateDeviceState: (patch) => updateDeviceState(userDataDir(), patch),
    readDeviceSettings: () => readDeviceSettings(userDataDir()),
    writeDeviceSettings: (values) => writeDeviceSettings(userDataDir(), values),
    activeModel: async () => {
      const vaultDir = await activeVaultPath();
      if (!vaultDir) return DEFAULT_MODEL;
      const model = (await readVaultSettingsValues(createNodeFileSystem(vaultDir)))['ai.model'];
      return typeof model === 'string' ? model : DEFAULT_MODEL;
    },
    appVersion: __APP_VERSION__,
    // Drives the renderer titlebar layout; the renderer reads it from the preload bridge, but the
    // host needs it to satisfy the shared shape (the coreBridge factory carries it through).
    platform: ((): AppPlatform =>
      process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux'
        ? process.platform
        : 'unknown')(),
    relay: useFakeRelay
      ? { fetch: fakeRelayFetch(), loadBundle: fakeRelayBundle, currentVersion: RELAY_VERSION }
      : {
          // Node ≥20's global fetch reaches the Cloudflare REST API + the deployed Worker; the API token +
          // drain secret used here stay host-side (read from config/relay.enc), never reaching the renderer.
          fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
            globalThis.fetch(input, init),
          loadBundle: loadRelayBundle,
          currentVersion: RELAY_VERSION,
        },
    emitChatChunk: (chunk) => {
      if (chatSender && !chatSender.isDestroyed()) {
        chatSender.send(IpcChannels.chatChunk, chunk);
      }
    },
    emitDreamChunk: (chunk) => {
      if (dreamSender && !dreamSender.isDestroyed()) {
        dreamSender.send(IpcChannels.dreamChunk, chunk);
      }
    },
    emitIntakeChunk: (chunk) => {
      if (intakeSender && !intakeSender.isDestroyed()) {
        intakeSender.send(IpcChannels.intakeChunk, chunk);
      }
    },
    emitTogetherChunk: (chunk) => {
      if (togetherSender && !togetherSender.isDestroyed()) {
        togetherSender.send(IpcChannels.togetherChunk, chunk);
      }
    },
    getBootState: currentBootState,
    refreshBootState: currentBootState,
    selectVaultFolder: async () => {
      const result = await dialog.showOpenDialog({
        title: 'Choose your SelfOS vault folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled) return null;
      return result.filePaths[0] ?? null;
    },
    useVault: async (path) => {
      // Data side only; the per-window watcher is started in the IPC wrapper (it needs event.sender).
      await initializeVault(path);
      const state = await readDeviceState(userDataDir());
      await writeDeviceState(userDataDir(), { ...state, vaultPath: path });
      return currentBootState();
    },
    getConflicts: async () => {
      const vaultDir = await activeVaultPath();
      return vaultDir ? findConflicts(vaultDir) : [];
    },
    hasPendingDownloads: async () => {
      // Best-effort macOS iCloud check: a `.<name>.icloud` placeholder anywhere means the folder is still
      // downloading (33 §5.D). Non-iCloud folders (Dropbox/Drive/local) simply have none.
      const vaultDir = await activeVaultPath();
      if (!vaultDir) return false;
      const { readdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const walk = async (dir: string): Promise<boolean> => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return false;
        }
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (await walk(join(dir, entry.name))) return true;
          } else if (entry.name.startsWith('.') && entry.name.endsWith('.icloud')) {
            return true;
          }
        }
        return false;
      };
      return walk(vaultDir);
    },
    revealVault: async () => {
      const vaultDir = await activeVaultPath();
      if (vaultDir) await shell.openPath(vaultDir);
    },
    openExternal: async (url) => {
      // The coreBridge already validates this is an http(s) URL before reaching the host.
      await shell.openExternal(url);
    },
    checkForUpdate: () =>
      checkForUpdate({
        fetch: updateFetch,
        currentVersion: __APP_VERSION__,
        now: new Date().toISOString(),
      }),
    saveImageFile: async (suggestedName, bytes) => {
      // E2E hook: write to a fixed path without showing the native dialog (which Playwright can't drive).
      const fakeDir = process.env['SELFOS_FAKE_SAVE_DIR'];
      const filePath = fakeDir
        ? join(fakeDir, suggestedName)
        : await dialog
            .showSaveDialog({ title: 'Save file', defaultPath: suggestedName })
            .then((r) => (r.canceled ? null : r.filePath));
      if (!filePath) return null;
      await writeFile(filePath, Buffer.from(bytes));
      return filePath;
    },
    printToPdf: async (html) => {
      // Render the self-contained HTML offscreen and print it to PDF bytes (64-your-story §3.9). The window
      // is hidden, sandboxed (no node), and destroyed after — it only ever loads our own data: URL.
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
      });
      try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        const pdf = await win.webContents.printToPDF({ printBackground: true });
        return new Uint8Array(pdf);
      } catch {
        return null;
      } finally {
        win.destroy();
      }
    },
    // On Electron the renderer subscribes to these over IPC in the preload, not via the in-process
    // bridge — so the bridge's own subscriptions are unused in main (they exist for the iOS host).
    onVaultChanged: () => () => {},
    onChatChunk: () => () => {},
    onDreamChunk: () => () => {},
    onIntakeChunk: () => () => {},
    onTogetherChunk: () => () => {},
  };

  const bridge = createCoreBridge(host);

  /** Register a request/response channel as a thin delegate to the shared bridge. */
  const handle = <F extends (...args: never[]) => Promise<unknown>>(
    channel: string,
    method: F,
  ): void => {
    ipcMain.handle(channel, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
      method(...(args as Parameters<F>)),
    );
  };

  handle(IpcChannels.getBootState, bridge.getBootState);
  handle(IpcChannels.refreshBootState, bridge.refreshBootState);
  handle(IpcChannels.selectVaultFolder, bridge.selectVaultFolder);
  handle(IpcChannels.getConflicts, bridge.getConflicts);
  handle(IpcChannels.vaultSyncReadiness, bridge.vaultSyncReadiness);
  handle(IpcChannels.revealVault, bridge.revealVault);
  handle(IpcChannels.getAppVersion, bridge.getAppVersion);
  handle(IpcChannels.getSettings, bridge.getSettings);
  handle(IpcChannels.setSetting, bridge.setSetting);
  handle(IpcChannels.resetSetting, bridge.resetSetting);
  handle(IpcChannels.secretSet, bridge.secretSet);
  handle(IpcChannels.secretHas, bridge.secretHas);
  handle(IpcChannels.secretClear, bridge.secretClear);
  handle(IpcChannels.claudeTest, bridge.claudeTest);
  handle(IpcChannels.openaiTest, bridge.openaiTest);
  handle(IpcChannels.aiKeyStatus, bridge.aiKeyStatus);
  handle(IpcChannels.aiSetSharedKey, bridge.aiSetSharedKey);
  handle(IpcChannels.aiShareDeviceKey, bridge.aiShareDeviceKey);
  handle(IpcChannels.aiClearSharedKey, bridge.aiClearSharedKey);
  handle(IpcChannels.devicesList, bridge.devicesList);
  handle(IpcChannels.devicesRename, bridge.devicesRename);
  handle(IpcChannels.keysRotate, bridge.keysRotate);
  handle(IpcChannels.keysRotateStatus, bridge.keysRotateStatus);
  handle(IpcChannels.householdStatus, bridge.householdStatus);
  handle(IpcChannels.householdSetup, bridge.householdSetup);
  handle(IpcChannels.unlockWithRecoveryPhrase, bridge.unlockWithRecoveryPhrase);
  handle(IpcChannels.getActivePerson, bridge.getActivePerson);
  handle(IpcChannels.peopleList, bridge.peopleList);
  handle(IpcChannels.peopleSave, bridge.peopleSave);
  handle(IpcChannels.peopleDelete, bridge.peopleDelete);
  handle(IpcChannels.relationshipsList, bridge.relationshipsList);
  handle(IpcChannels.relationshipsSave, bridge.relationshipsSave);
  handle(IpcChannels.relationshipsDelete, bridge.relationshipsDelete);
  handle(IpcChannels.accessGet, bridge.accessGet);
  handle(IpcChannels.accessSaveRole, bridge.accessSaveRole);
  handle(IpcChannels.accessSetAccount, bridge.accessSetAccount);
  handle(IpcChannels.accessRemoveAccount, bridge.accessRemoveAccount);
  handle(IpcChannels.invitesCreate, bridge.invitesCreate);
  handle(IpcChannels.invitesList, bridge.invitesList);
  handle(IpcChannels.invitesCancel, bridge.invitesCancel);
  handle(IpcChannels.invitesRedeem, bridge.invitesRedeem);
  handle(IpcChannels.invitesCompleteJoin, bridge.invitesCompleteJoin);
  handle(IpcChannels.sessionSetActive, bridge.sessionSetActive);
  handle(IpcChannels.usageSummary, bridge.usageSummary);
  handle(IpcChannels.budgetGet, bridge.budgetGet);
  handle(IpcChannels.budgetGetPerson, bridge.budgetGetPerson);
  handle(IpcChannels.budgetSetApp, bridge.budgetSetApp);
  handle(IpcChannels.budgetSetPerson, bridge.budgetSetPerson);
  handle(IpcChannels.budgetStatus, bridge.budgetStatus);
  handle(IpcChannels.conversationsList, bridge.conversationsList);
  handle(IpcChannels.conversationsGet, bridge.conversationsGet);
  handle(IpcChannels.conversationsRename, bridge.conversationsRename);
  handle(IpcChannels.conversationsDelete, bridge.conversationsDelete);
  handle(IpcChannels.sessionsSetStatus, bridge.sessionsSetStatus);
  handle(IpcChannels.sessionsEndAndSummarize, bridge.sessionsEndAndSummarize);
  handle(IpcChannels.sessionsStartGuided, bridge.sessionsStartGuided);
  handle(IpcChannels.guidedGetState, bridge.guidedGetState);
  handle(IpcChannels.guidedSuggest, bridge.guidedSuggest);
  handle(IpcChannels.guidedAcknowledgeAdult, bridge.guidedAcknowledgeAdult);
  handle(IpcChannels.testsList, bridge.testsList);
  handle(IpcChannels.testsGet, bridge.testsGet);
  handle(IpcChannels.testsTake, bridge.testsTake);
  handle(IpcChannels.testsResults, bridge.testsResults);
  handle(IpcChannels.testsNarrate, bridge.testsNarrate);
  handle(IpcChannels.testsAcknowledgeAdult, bridge.testsAcknowledgeAdult);
  handle(IpcChannels.testsDeleteResult, bridge.testsDeleteResult);
  handle(IpcChannels.testsDeleteAll, bridge.testsDeleteAll);
  handle(IpcChannels.usageSessionCosts, bridge.usageSessionCosts);
  handle(IpcChannels.questionnairesList, bridge.questionnairesList);
  handle(IpcChannels.questionnairesSendStates, bridge.questionnairesSendStates);
  handle(IpcChannels.questionnairesSentOverview, bridge.questionnairesSentOverview);
  handle(IpcChannels.questionnairesShareLink, bridge.questionnairesShareLink);
  handle(IpcChannels.questionnairesGet, bridge.questionnairesGet);
  handle(IpcChannels.questionnairesSave, bridge.questionnairesSave);
  handle(IpcChannels.questionnairesDelete, bridge.questionnairesDelete);
  handle(IpcChannels.questionnairesValidate, bridge.questionnairesValidate);
  handle(IpcChannels.questionnairesSetFavorite, bridge.questionnairesSetFavorite);
  handle(IpcChannels.questionnairesListTypes, bridge.questionnairesListTypes);
  handle(IpcChannels.questionnairesAddType, bridge.questionnairesAddType);
  handle(IpcChannels.questionnairesIntimacyTopics, bridge.questionnairesIntimacyTopics);
  handle(IpcChannels.questionnairesAddIntimacyTopic, bridge.questionnairesAddIntimacyTopic);
  handle(IpcChannels.questionnairesRemoveIntimacyTopic, bridge.questionnairesRemoveIntimacyTopic);
  handle(
    IpcChannels.questionnairesSuggestIntimacyTopics,
    bridge.questionnairesSuggestIntimacyTopics,
  );
  handle(IpcChannels.questionnairesStoreImage, bridge.questionnairesStoreImage);
  handle(IpcChannels.questionnairesGetImage, bridge.questionnairesGetImage);
  handle(IpcChannels.questionnairesDeleteImage, bridge.questionnairesDeleteImage);
  handle(IpcChannels.questionnairesGenerate, bridge.questionnairesGenerate);
  handle(IpcChannels.questionnairesImproveQuestion, bridge.questionnairesImproveQuestion);
  handle(IpcChannels.gapfinderSuggest, bridge.gapfinderSuggest);
  handle(IpcChannels.questionnaireSuggestionsList, bridge.questionnaireSuggestionsList);
  handle(IpcChannels.questionnaireSuggestionsGenerate, bridge.questionnaireSuggestionsGenerate);
  handle(IpcChannels.questionnaireSuggestionDelete, bridge.questionnaireSuggestionDelete);
  handle(IpcChannels.questionnaireSuggestionMaterialize, bridge.questionnaireSuggestionMaterialize);
  handle(IpcChannels.insightsList, bridge.insightsList);
  handle(IpcChannels.memoryOutboundSharing, bridge.memoryOutboundSharing);
  handle(IpcChannels.insightsAnalyze, bridge.insightsAnalyze);
  handle(IpcChannels.insightsApprove, bridge.insightsApprove);
  handle(IpcChannels.insightsUpdate, bridge.insightsUpdate);
  handle(IpcChannels.insightsDelete, bridge.insightsDelete);
  handle(IpcChannels.insightsFlag, bridge.insightsFlag);
  handle(IpcChannels.memoryRefresh, bridge.memoryRefresh);
  handle(IpcChannels.memoryReconcileState, bridge.memoryReconcileState);
  handle(IpcChannels.memoryResolveProposal, bridge.memoryResolveProposal);
  handle(IpcChannels.goalsList, bridge.goalsList);
  handle(IpcChannels.goalsSetStatus, bridge.goalsSetStatus);
  handle(IpcChannels.goalsUpdate, bridge.goalsUpdate);
  handle(IpcChannels.goalsDelete, bridge.goalsDelete);
  handle(IpcChannels.goalsCreate, bridge.goalsCreate);
  handle(IpcChannels.goalsSuggest, bridge.goalsSuggest);
  handle(IpcChannels.coachingGetPrefs, bridge.coachingGetPrefs);
  handle(IpcChannels.coachingSetPrefs, bridge.coachingSetPrefs);
  handle(IpcChannels.coachingGetSynthesis, bridge.coachingGetSynthesis);
  handle(IpcChannels.coachingSynthesize, bridge.coachingSynthesize);
  handle(IpcChannels.autoCheckinsGetConfig, bridge.autoCheckinsGetConfig);
  handle(IpcChannels.autoCheckinsSetConfig, bridge.autoCheckinsSetConfig);
  handle(IpcChannels.autoCheckinsEnsureSeed, bridge.autoCheckinsEnsureSeed);
  handle(IpcChannels.autoCheckinsRun, bridge.autoCheckinsRun);
  handle(IpcChannels.storyBookTypes, bridge.storyBookTypes);
  handle(IpcChannels.storyList, bridge.storyList);
  handle(IpcChannels.storyCreate, bridge.storyCreate);
  handle(IpcChannels.storyGet, bridge.storyGet);
  handle(IpcChannels.storyGenerateFoundations, bridge.storyGenerateFoundations);
  handle(IpcChannels.storySaveOutline, bridge.storySaveOutline);
  handle(IpcChannels.storyApproveOutline, bridge.storyApproveOutline);
  handle(IpcChannels.storyUpdate, bridge.storyUpdate);
  handle(IpcChannels.storyDelete, bridge.storyDelete);
  handle(IpcChannels.storyGenerateChapters, bridge.storyGenerateChapters);
  handle(IpcChannels.storyRegenerateChapter, bridge.storyRegenerateChapter);
  handle(IpcChannels.storyReviewChapter, bridge.storyReviewChapter);
  handle(IpcChannels.storyGetMarkup, bridge.storyGetMarkup);
  handle(IpcChannels.storyMark, bridge.storyMark);
  handle(IpcChannels.storyUpdateMark, bridge.storyUpdateMark);
  handle(IpcChannels.storyRemoveMark, bridge.storyRemoveMark);
  handle(IpcChannels.storyApplyMarkup, bridge.storyApplyMarkup);
  handle(IpcChannels.storyEditPassage, bridge.storyEditPassage);
  handle(IpcChannels.storyPinQuote, bridge.storyPinQuote);
  handle(IpcChannels.storyTodos, bridge.storyTodos);
  handle(IpcChannels.storyExclusions, bridge.storyExclusions);
  handle(IpcChannels.storyExclude, bridge.storyExclude);
  handle(IpcChannels.storyUnexclude, bridge.storyUnexclude);
  handle(IpcChannels.storyTodoToQuestions, bridge.storyTodoToQuestions);
  handle(IpcChannels.storyRefreshCheck, bridge.storyRefreshCheck);
  handle(IpcChannels.storyProposals, bridge.storyProposals);
  handle(IpcChannels.storyResolveProposal, bridge.storyResolveProposal);
  handle(IpcChannels.storyHomeSignal, bridge.storyHomeSignal);
  handle(IpcChannels.storyCompleteness, bridge.storyCompleteness);
  handle(IpcChannels.storyInterviewCheck, bridge.storyInterviewCheck);
  handle(IpcChannels.storyPublish, bridge.storyPublish);
  handle(IpcChannels.storyReaders, bridge.storyReaders);
  handle(IpcChannels.storyGrantReader, bridge.storyGrantReader);
  handle(IpcChannels.storyRevokeReader, bridge.storyRevokeReader);
  handle(IpcChannels.storyReaderFeatured, bridge.storyReaderFeatured);
  handle(IpcChannels.storySharedBooks, bridge.storySharedBooks);
  handle(IpcChannels.storyReadShared, bridge.storyReadShared);
  handle(IpcChannels.storyMarkSharedRead, bridge.storyMarkSharedRead);
  handle(IpcChannels.storyExportMarkdown, bridge.storyExportMarkdown);
  handle(IpcChannels.storyExportPdf, bridge.storyExportPdf);
  handle(IpcChannels.storyImages, bridge.storyImages);
  handle(IpcChannels.storyGenerateImage, bridge.storyGenerateImage);
  handle(IpcChannels.storyGetImage, bridge.storyGetImage);
  handle(IpcChannels.storyDeleteImage, bridge.storyDeleteImage);
  handle(IpcChannels.storyUploadPhoto, bridge.storyUploadPhoto);
  handle(IpcChannels.storyAnalyzePhoto, bridge.storyAnalyzePhoto);
  handle(IpcChannels.storyAnswerPhoto, bridge.storyAnswerPhoto);
  handle(IpcChannels.storyPhotoAnswers, bridge.storyPhotoAnswers);
  handle(IpcChannels.storySuggestPlacement, bridge.storySuggestPlacement);
  handle(IpcChannels.storySetPlacement, bridge.storySetPlacement);
  handle(IpcChannels.storyRemovePlacement, bridge.storyRemovePlacement);
  handle(IpcChannels.storyReadSharedImage, bridge.storyReadSharedImage);
  handle(IpcChannels.relationshipsGetSynthesis, bridge.relationshipsGetSynthesis);
  handle(IpcChannels.relationshipsSynthesize, bridge.relationshipsSynthesize);
  handle(IpcChannels.challengesStart, bridge.challengesStart);
  handle(IpcChannels.challengesStartReflection, bridge.challengesStartReflection);
  handle(IpcChannels.challengesList, bridge.challengesList);
  handle(IpcChannels.challengesGet, bridge.challengesGet);
  handle(IpcChannels.challengesSetStatus, bridge.challengesSetStatus);
  handle(IpcChannels.challengesCheckIn, bridge.challengesCheckIn);
  handle(IpcChannels.challengesSnooze, bridge.challengesSnooze);
  handle(IpcChannels.challengesSeedGoal, bridge.challengesSeedGoal);
  handle(IpcChannels.challengesDelete, bridge.challengesDelete);
  handle(IpcChannels.challengesSuggest, bridge.challengesSuggest);
  handle(IpcChannels.challengesGetSuggestion, bridge.challengesGetSuggestion);
  handle(IpcChannels.challengesClearSuggestion, bridge.challengesClearSuggestion);
  // Together / couples sessions (58).
  handle(IpcChannels.togetherList, bridge.togetherList);
  handle(IpcChannels.togetherGet, bridge.togetherGet);
  handle(IpcChannels.togetherCreate, bridge.togetherCreate);
  handle(IpcChannels.togetherAccept, bridge.togetherAccept);
  handle(IpcChannels.togetherDecline, bridge.togetherDecline);
  handle(IpcChannels.togetherSetPaused, bridge.togetherSetPaused);
  handle(IpcChannels.togetherLeave, bridge.togetherLeave);
  handle(IpcChannels.togetherWithdraw, bridge.togetherWithdraw);
  handle(IpcChannels.togetherMarkRead, bridge.togetherMarkRead);
  // The couples turn streams on its own channel (kept separate from chat/dreams so streams never cross, §5.4).
  // Same per-turn sender binding + reset as chatStream.
  ipcMain.handle(IpcChannels.togetherSendMessage, async (event, raw: unknown) => {
    togetherSender = event.sender;
    try {
      return await bridge.togetherSendMessage(
        raw as { sessionId: string; text: string; privateAside?: boolean },
      );
    } finally {
      togetherSender = undefined;
    }
  });
  ipcMain.handle(IpcChannels.togetherRetry, async (event, raw: unknown) => {
    togetherSender = event.sender;
    try {
      return await bridge.togetherRetry(raw as { sessionId: string });
    } finally {
      togetherSender = undefined;
    }
  });
  handle(IpcChannels.togetherPrepOpen, bridge.togetherPrepOpen);
  handle(IpcChannels.togetherStoreAttachment, bridge.togetherStoreAttachment);
  handle(IpcChannels.togetherGetAttachment, bridge.togetherGetAttachment);
  handle(IpcChannels.togetherCatalog, bridge.togetherCatalog);
  handle(IpcChannels.togetherAcknowledgeAdult, bridge.togetherAcknowledgeAdult);
  handle(IpcChannels.togetherYnmStatus, bridge.togetherYnmStatus);
  handle(IpcChannels.togetherYnmOptIn, bridge.togetherYnmOptIn);
  handle(IpcChannels.togetherYnmRevoke, bridge.togetherYnmRevoke);
  handle(IpcChannels.togetherYnmOverlap, bridge.togetherYnmOverlap);
  handle(IpcChannels.togetherPulse, bridge.togetherPulse);
  handle(IpcChannels.togetherPulseLog, bridge.togetherPulseLog);
  handle(IpcChannels.togetherJointChallenges, bridge.togetherJointChallenges);
  handle(IpcChannels.togetherSuggestions, bridge.togetherSuggestions);
  handle(IpcChannels.togetherWrapUp, bridge.togetherWrapUp);
  handle(IpcChannels.togetherGetReport, bridge.togetherGetReport);
  handle(IpcChannels.togetherSaveAgreement, bridge.togetherSaveAgreement);
  handle(IpcChannels.togetherMyAgreements, bridge.togetherMyAgreements);
  handle(IpcChannels.togetherDoneCommitments, bridge.togetherDoneCommitments);
  handle(IpcChannels.togetherSetAgreementStatus, bridge.togetherSetAgreementStatus);
  handle(IpcChannels.assignmentsCreate, bridge.assignmentsCreate);
  handle(IpcChannels.assignmentsInbox, bridge.assignmentsInbox);
  handle(IpcChannels.assignmentsSetFavorite, bridge.assignmentsSetFavorite);
  handle(IpcChannels.assignmentsGet, bridge.assignmentsGet);
  handle(IpcChannels.assignmentsOpen, bridge.assignmentsOpen);
  handle(IpcChannels.assignmentsSaveProgress, bridge.assignmentsSaveProgress);
  handle(IpcChannels.assignmentsReopen, bridge.assignmentsReopen);
  handle(IpcChannels.assignmentsSubmit, bridge.assignmentsSubmit);
  handle(IpcChannels.assignmentsDecline, bridge.assignmentsDecline);
  handle(IpcChannels.assignmentsResults, bridge.assignmentsResults);
  handle(IpcChannels.assignmentsTrends, bridge.assignmentsTrends);
  handle(IpcChannels.assignmentsAggregate, bridge.assignmentsAggregate);
  handle(IpcChannels.assignmentsDelete, bridge.assignmentsDelete);
  handle(IpcChannels.assignmentsCreateCompatibility, bridge.assignmentsCreateCompatibility);
  handle(IpcChannels.assignmentsCompatibility, bridge.assignmentsCompatibility);
  handle(IpcChannels.assignmentsAlign, bridge.assignmentsAlign);
  handle(IpcChannels.assignmentsPublishCompatResult, bridge.assignmentsPublishCompatResult);
  handle(IpcChannels.assignmentsDistillContextOnly, bridge.assignmentsDistillContextOnly);
  handle(IpcChannels.assignmentsRevealRaw, bridge.assignmentsRevealRaw);
  handle(IpcChannels.assignmentsCreateRelayLink, bridge.assignmentsCreateRelayLink);
  handle(IpcChannels.assignmentsDrain, bridge.assignmentsDrain);
  handle(IpcChannels.assignmentsRevoke, bridge.assignmentsRevoke);
  handle(IpcChannels.assignmentsReshare, bridge.assignmentsReshare);
  handle(IpcChannels.assignmentsReAsk, bridge.assignmentsReAsk);
  handle(IpcChannels.assignmentsExportResults, bridge.assignmentsExportResults);
  handle(IpcChannels.relayStatus, bridge.relayStatus);
  handle(IpcChannels.relayConnect, bridge.relayConnect);
  handle(IpcChannels.relayUpdate, bridge.relayUpdate);
  handle(IpcChannels.relayTeardown, bridge.relayTeardown);
  handle(IpcChannels.dreamsList, bridge.dreamsList);
  handle(IpcChannels.dreamGet, bridge.dreamGet);
  handle(IpcChannels.dreamSave, bridge.dreamSave);
  handle(IpcChannels.dreamDelete, bridge.dreamDelete);
  handle(IpcChannels.dreamGetAnalysis, bridge.dreamGetAnalysis);
  handle(IpcChannels.dreamGetConversation, bridge.dreamGetConversation);
  handle(IpcChannels.dreamSynthesize, bridge.dreamSynthesize);
  handle(IpcChannels.dreamUpdateAnalysis, bridge.dreamUpdateAnalysis);
  handle(IpcChannels.dreamApprove, bridge.dreamApprove);
  handle(IpcChannels.dreamRemoveFromContext, bridge.dreamRemoveFromContext);
  handle(IpcChannels.dreamPatternStats, bridge.dreamPatternStats);
  handle(IpcChannels.dreamGetPatternSummary, bridge.dreamGetPatternSummary);
  handle(IpcChannels.dreamPatternNarrative, bridge.dreamPatternNarrative);
  handle(IpcChannels.dreamApprovePatternNarrative, bridge.dreamApprovePatternNarrative);
  handle(IpcChannels.dreamRemovePatternNarrative, bridge.dreamRemovePatternNarrative);
  handle(IpcChannels.dreamShareTargets, bridge.dreamShareTargets);
  handle(IpcChannels.dreamGetInsight, bridge.dreamGetInsight);
  handle(IpcChannels.dreamSetFactShare, bridge.dreamSetFactShare);
  handle(IpcChannels.dreamGenerateImage, bridge.dreamGenerateImage);
  handle(IpcChannels.dreamGetImage, bridge.dreamGetImage);
  handle(IpcChannels.dreamDeleteImage, bridge.dreamDeleteImage);
  handle(IpcChannels.dreamExportImage, bridge.dreamExportImage);
  handle(IpcChannels.dreamSetImageShare, bridge.dreamSetImageShare);
  handle(IpcChannels.dreamGetSharedImage, bridge.dreamGetSharedImage);
  handle(IpcChannels.dreamListSharedImages, bridge.dreamListSharedImages);
  handle(IpcChannels.intakeGetState, bridge.intakeGetState);
  handle(IpcChannels.intakeSkipSection, bridge.intakeSkipSection);
  handle(IpcChannels.intakeSubmitForm, bridge.intakeSubmitForm);
  handle(IpcChannels.intakeAcknowledgeAdult, bridge.intakeAcknowledgeAdult);
  handle(IpcChannels.intakeSetAnswerSharing, bridge.intakeSetAnswerSharing);
  handle(IpcChannels.intakeSynthesize, bridge.intakeSynthesize);
  handle(IpcChannels.profileSuggestions, bridge.profileSuggestions);
  handle(IpcChannels.profileAcceptSuggestion, bridge.profileAcceptSuggestion);
  handle(IpcChannels.profileDismissSuggestion, bridge.profileDismissSuggestion);
  handle(IpcChannels.getSidebarCollapsed, bridge.getSidebarCollapsed);
  handle(IpcChannels.setSidebarCollapsed, bridge.setSidebarCollapsed);
  handle(IpcChannels.getDiscoveryDismissals, bridge.getDiscoveryDismissals);
  handle(IpcChannels.setDiscoveryDismissals, bridge.setDiscoveryDismissals);
  handle(IpcChannels.getNotificationState, bridge.getNotificationState);
  handle(IpcChannels.setNotificationState, bridge.setNotificationState);
  handle(IpcChannels.notificationsResponsesArrived, bridge.notificationsResponsesArrived);
  handle(IpcChannels.notificationsAnswersUpdated, bridge.notificationsAnswersUpdated);
  handle(IpcChannels.notificationsRemindersDue, bridge.notificationsRemindersDue);
  handle(IpcChannels.openExternal, bridge.openExternal);
  handle(IpcChannels.updatesCheck, bridge.updatesCheck);
  handle(IpcChannels.updatesGetState, bridge.updatesGetState);

  // useVault is platform-specific: after the shared data side runs, begin watching the freshly
  // activated vault for THIS window (the watcher needs the invoking WebContents).
  ipcMain.handle(IpcChannels.useVault, async (event, raw: unknown): Promise<BootState> => {
    const path = z.string().min(1).parse(raw);
    const state = await bridge.useVault(path);
    startVaultWatcher(path, event.sender);
    return state;
  });

  // unlinkVault mirrors useVault's platform-specific half: stop the chokidar watcher for the folder
  // we're leaving (it has no host-agnostic equivalent) BEFORE the shared bridge clears the device-local
  // key + pointers (14-vault-relinking §5.2).
  ipcMain.handle(IpcChannels.unlinkVault, async (): Promise<BootState> => {
    await stopVaultWatcher();
    return bridge.unlinkVault();
  });

  // chatStream streams reply chunks back to the invoking window via emitChatChunk → IPC event. The
  // sender is bound for the turn only — reset afterwards so no stale WebContents lingers between turns.
  ipcMain.handle(IpcChannels.chatStream, async (event, raw: unknown) => {
    chatSender = event.sender;
    try {
      return await bridge.chatStream(
        raw as { conversationId: string; userText: string; attachments?: never },
      );
    } finally {
      chatSender = undefined;
    }
  });
  // chatRetry re-generates a reply for an unanswered turn — same per-turn sender binding as chatStream (05 §4.1).
  ipcMain.handle(IpcChannels.chatRetry, async (event, raw: unknown) => {
    chatSender = event.sender;
    try {
      return await bridge.chatRetry(raw as string);
    } finally {
      chatSender = undefined;
    }
  });
  // Session image attachments (45) — thin delegates; the bridge owns validation + active-person scoping.
  handle(IpcChannels.conversationStoreAttachment, bridge.conversationStoreAttachment);
  handle(IpcChannels.conversationGetAttachment, bridge.conversationGetAttachment);
  handle(IpcChannels.conversationExportAttachment, bridge.conversationExportAttachment);

  // dreamStartReflection + dreamAnalyzeTurn stream the guided-analysis reply on their own channel (kept
  // separate from chat so the Sessions and Dreams streams never cross). Same per-turn sender binding +
  // reset as chatStream — the coach's opener streams too (12 §15.4).
  ipcMain.handle(IpcChannels.dreamStartReflection, async (event, raw: unknown) => {
    dreamSender = event.sender;
    try {
      return await bridge.dreamStartReflection(raw as { dreamId: string });
    } finally {
      dreamSender = undefined;
    }
  });
  ipcMain.handle(IpcChannels.dreamAnalyzeTurn, async (event, raw: unknown) => {
    dreamSender = event.sender;
    try {
      return await bridge.dreamAnalyzeTurn(raw as { dreamId: string; userText: string });
    } finally {
      dreamSender = undefined;
    }
  });

  // intakeRunTurn streams the interviewer reply on its own channel (kept separate from chat/dreams). Same
  // per-turn sender binding + reset as chatStream (18-personal-onboarding §6).
  ipcMain.handle(IpcChannels.intakeRunTurn, async (event, raw: unknown) => {
    intakeSender = event.sender;
    try {
      return await bridge.intakeRunTurn(raw as { sectionId: string; userText: string });
    } finally {
      intakeSender = undefined;
    }
  });
}
