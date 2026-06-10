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
};

contextBridge.exposeInMainWorld('selfos', bridge);
