import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type SelfosBridge } from '../shared/channels';

/**
 * The only surface the renderer can reach. Exposed on `window.selfos` via contextBridge — no Node,
 * no `fs`, no secrets (00-architecture §3).
 */
const bridge: SelfosBridge = {
  getBootState: () => ipcRenderer.invoke(IpcChannels.getBootState),
};

contextBridge.exposeInMainWorld('selfos', bridge);
