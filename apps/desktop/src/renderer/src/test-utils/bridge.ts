import type { SelfosBridge } from '@shared/channels';
import type { BootState } from '@shared/schemas';

const READY: BootState = { phase: 'ready', vaultPath: '/vault', hasSettings: true };

/** Install a fully-stubbed `window.selfos` bridge for tests; pass overrides for the bits you care about. */
export function installMockBridge(overrides: Partial<SelfosBridge> = {}): SelfosBridge {
  const bridge: SelfosBridge = {
    getBootState: () => Promise.resolve(READY),
    refreshBootState: () => Promise.resolve(READY),
    selectVaultFolder: () => Promise.resolve(null),
    useVault: () => Promise.resolve(READY),
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    onVaultChanged: () => () => {},
    getAppVersion: () => Promise.resolve('0.0.0'),
    getSettings: () => Promise.resolve({ vault: {}, device: {} }),
    setSetting: () => Promise.resolve(),
    resetSetting: () => Promise.resolve(),
    ...overrides,
  };
  window.selfos = bridge;
  return bridge;
}

export function clearMockBridge(): void {
  delete window.selfos;
}
