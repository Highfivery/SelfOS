import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from './appStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import type { BootState } from '@shared/schemas';

const ONBOARDING: BootState = { phase: 'onboarding', vaultPath: null, hasSettings: false };
const READY: BootState = { phase: 'ready', vaultPath: '/v', hasSettings: true };

afterEach(() => {
  clearMockBridge();
  useAppStore.setState({ phase: 'starting', vaultPath: null, busy: false });
});

describe('appStore', () => {
  it('init sets the phase from the bridge', async () => {
    installMockBridge({ getBootState: () => Promise.resolve(ONBOARDING) });
    await useAppStore.getState().init();
    expect(useAppStore.getState().phase).toBe('onboarding');
  });

  it('chooseVault transitions to ready after a folder is selected', async () => {
    installMockBridge({
      selectVaultFolder: () => Promise.resolve('/v'),
      useVault: () => Promise.resolve(READY),
    });
    await useAppStore.getState().chooseVault();
    expect(useAppStore.getState().phase).toBe('ready');
    expect(useAppStore.getState().vaultPath).toBe('/v');
    expect(useAppStore.getState().busy).toBe(false);
  });

  it('chooseVault stays put when the picker is cancelled', async () => {
    useAppStore.setState({ phase: 'onboarding' });
    installMockBridge({
      selectVaultFolder: () => Promise.resolve(null),
      useVault: () => Promise.reject(new Error('should not be called')),
    });
    await useAppStore.getState().chooseVault();
    expect(useAppStore.getState().phase).toBe('onboarding');
  });
});
