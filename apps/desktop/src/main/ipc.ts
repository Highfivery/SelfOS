import { ipcMain } from 'electron';
import { IpcChannels } from '../shared/channels';
import { BootStateSchema, type BootState } from '../shared/schemas';

/**
 * Registers main-process IPC handlers. Slice 1 has no vault yet, so boot state is a stub that lets
 * the shell render; the real boot/vault flow arrives with the app-shell and vault slices.
 *
 * The stub is validated through the schema so every handler follows the "validate on both sides"
 * rule (00-architecture §6.1) — the renderer validates again on receipt.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.getBootState, (): BootState => {
    return BootStateSchema.parse({ phase: 'ready', vaultPath: null, hasSettings: false });
  });
}
