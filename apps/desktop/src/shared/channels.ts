import type { BootState } from './schemas';

/**
 * IPC channel names + the renderer-facing bridge type. This module is zod-free so it is safe to
 * import from the sandboxed preload (the `BootState` import is type-only and erased at build time).
 */

export const IpcChannels = {
  getBootState: 'app:getBootState',
} as const;

export interface SelfosBridge {
  getBootState(): Promise<BootState>;
}

export type { BootState };
