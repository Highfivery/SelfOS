import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { IpcChannels } from '../shared/channels';
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
import { isSuperAdminActive, setSuperAdminActive } from './people/superAdmin';
import { loadMasterKey } from '@selfos/core/crypto';
import { createNodeFileSystem } from './host/nodeFileSystem';
import { loadRelayBundle, RELAY_VERSION } from './relay/relayBundle';
import { fakeRelayBundle, fakeRelayFetch } from '../shared/relay/fakeRelay';
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
  // E2E/dev: a deterministic in-memory relay (no real Cloudflare account/network), like SELFOS_FAKE_CLAUDE.
  const useFakeRelay = Boolean(process.env['SELFOS_FAKE_RELAY']);

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
    isSuperAdminActive,
    setSuperAdminActive,
    appVersion: __APP_VERSION__,
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
    revealVault: async () => {
      const vaultDir = await activeVaultPath();
      if (vaultDir) await shell.openPath(vaultDir);
    },
    saveImageFile: async (suggestedName, bytes) => {
      // E2E hook: write to a fixed path without showing the native dialog (which Playwright can't drive).
      const fakeDir = process.env['SELFOS_FAKE_SAVE_DIR'];
      const filePath = fakeDir
        ? join(fakeDir, suggestedName)
        : await dialog
            .showSaveDialog({ title: 'Export dream image', defaultPath: suggestedName })
            .then((r) => (r.canceled ? null : r.filePath));
      if (!filePath) return null;
      await writeFile(filePath, Buffer.from(bytes));
      return filePath;
    },
    // On Electron the renderer subscribes to these over IPC in the preload, not via the in-process
    // bridge — so the bridge's own subscriptions are unused in main (they exist for the iOS host).
    onVaultChanged: () => () => {},
    onChatChunk: () => () => {},
    onDreamChunk: () => () => {},
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
  handle(IpcChannels.revealVault, bridge.revealVault);
  handle(IpcChannels.getAppVersion, bridge.getAppVersion);
  handle(IpcChannels.getSettings, bridge.getSettings);
  handle(IpcChannels.setSetting, bridge.setSetting);
  handle(IpcChannels.resetSetting, bridge.resetSetting);
  handle(IpcChannels.secretSet, bridge.secretSet);
  handle(IpcChannels.secretHas, bridge.secretHas);
  handle(IpcChannels.secretClear, bridge.secretClear);
  handle(IpcChannels.claudeTest, bridge.claudeTest);
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
  handle(IpcChannels.superadminUnlock, bridge.superadminUnlock);
  handle(IpcChannels.superadminLock, bridge.superadminLock);
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
  handle(IpcChannels.questionnairesList, bridge.questionnairesList);
  handle(IpcChannels.questionnairesGet, bridge.questionnairesGet);
  handle(IpcChannels.questionnairesSave, bridge.questionnairesSave);
  handle(IpcChannels.questionnairesDelete, bridge.questionnairesDelete);
  handle(IpcChannels.questionnairesValidate, bridge.questionnairesValidate);
  handle(IpcChannels.questionnairesListTypes, bridge.questionnairesListTypes);
  handle(IpcChannels.questionnairesAddType, bridge.questionnairesAddType);
  handle(IpcChannels.questionnairesStoreImage, bridge.questionnairesStoreImage);
  handle(IpcChannels.questionnairesGetImage, bridge.questionnairesGetImage);
  handle(IpcChannels.questionnairesDeleteImage, bridge.questionnairesDeleteImage);
  handle(IpcChannels.questionnairesGenerate, bridge.questionnairesGenerate);
  handle(IpcChannels.questionnairesImproveQuestion, bridge.questionnairesImproveQuestion);
  handle(IpcChannels.gapfinderSuggest, bridge.gapfinderSuggest);
  handle(IpcChannels.insightsList, bridge.insightsList);
  handle(IpcChannels.insightsAnalyze, bridge.insightsAnalyze);
  handle(IpcChannels.insightsApprove, bridge.insightsApprove);
  handle(IpcChannels.insightsUpdate, bridge.insightsUpdate);
  handle(IpcChannels.insightsDelete, bridge.insightsDelete);
  handle(IpcChannels.assignmentsCreate, bridge.assignmentsCreate);
  handle(IpcChannels.assignmentsInbox, bridge.assignmentsInbox);
  handle(IpcChannels.assignmentsGet, bridge.assignmentsGet);
  handle(IpcChannels.assignmentsOpen, bridge.assignmentsOpen);
  handle(IpcChannels.assignmentsSaveProgress, bridge.assignmentsSaveProgress);
  handle(IpcChannels.assignmentsSubmit, bridge.assignmentsSubmit);
  handle(IpcChannels.assignmentsDecline, bridge.assignmentsDecline);
  handle(IpcChannels.assignmentsResults, bridge.assignmentsResults);
  handle(IpcChannels.assignmentsTrends, bridge.assignmentsTrends);
  handle(IpcChannels.assignmentsDelete, bridge.assignmentsDelete);
  handle(IpcChannels.assignmentsCreateCompatibility, bridge.assignmentsCreateCompatibility);
  handle(IpcChannels.assignmentsCompatibility, bridge.assignmentsCompatibility);
  handle(IpcChannels.assignmentsAlign, bridge.assignmentsAlign);
  handle(IpcChannels.assignmentsRevealRaw, bridge.assignmentsRevealRaw);
  handle(IpcChannels.assignmentsCreateRelayLink, bridge.assignmentsCreateRelayLink);
  handle(IpcChannels.assignmentsDrain, bridge.assignmentsDrain);
  handle(IpcChannels.assignmentsRevoke, bridge.assignmentsRevoke);
  handle(IpcChannels.relayStatus, bridge.relayStatus);
  handle(IpcChannels.relayConnect, bridge.relayConnect);
  handle(IpcChannels.relayUpdate, bridge.relayUpdate);
  handle(IpcChannels.relayTeardown, bridge.relayTeardown);
  handle(IpcChannels.auditList, bridge.auditList);
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
  handle(IpcChannels.getSidebarCollapsed, bridge.getSidebarCollapsed);
  handle(IpcChannels.setSidebarCollapsed, bridge.setSidebarCollapsed);

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
      return await bridge.chatStream(raw as { conversationId: string; userText: string });
    } finally {
      chatSender = undefined;
    }
  });

  // dreamAnalyzeTurn streams the guided-analysis reply on its own channel (kept separate from chat so the
  // Sessions and Dreams streams never cross). Same per-turn sender binding + reset as chatStream.
  ipcMain.handle(IpcChannels.dreamAnalyzeTurn, async (event, raw: unknown) => {
    dreamSender = event.sender;
    try {
      return await bridge.dreamAnalyzeTurn(raw as { dreamId: string; userText: string });
    } finally {
      dreamSender = undefined;
    }
  });
}
