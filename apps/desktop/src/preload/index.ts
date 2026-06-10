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
  sessionSetActive: (input) => ipcRenderer.invoke(IpcChannels.sessionSetActive, input),
  superadminUnlock: (input) => ipcRenderer.invoke(IpcChannels.superadminUnlock, input),
};

contextBridge.exposeInMainWorld('selfos', bridge);
