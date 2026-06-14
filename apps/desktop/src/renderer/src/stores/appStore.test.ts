import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './appStore';
import { useSessionStore } from './sessionStore';
import { useDreamStore } from './dreamStore';
import { useResultsStore } from './resultsStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import type { BootState } from '@shared/schemas';

const ONBOARDING: BootState = { phase: 'onboarding', vaultPath: null, hasSettings: false };
const READY: BootState = { phase: 'ready', vaultPath: '/v', hasSettings: true };

afterEach(() => {
  clearMockBridge();
  vi.restoreAllMocks();
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

  it('unlink detaches via the bridge, resets per-vault stores, and routes to onboarding', async () => {
    useAppStore.setState({ phase: 'ready', vaultPath: '/v' });
    installMockBridge({ unlinkVault: () => Promise.resolve(ONBOARDING) });
    // Spy a representative subset incl. the newer resultsStore (every per-person store must reset).
    const sessionReset = vi.spyOn(useSessionStore.getState(), 'reset');
    const dreamReset = vi.spyOn(useDreamStore.getState(), 'reset');
    const resultsReset = vi.spyOn(useResultsStore.getState(), 'reset');

    await useAppStore.getState().unlink();

    expect(sessionReset).toHaveBeenCalled();
    expect(dreamReset).toHaveBeenCalled();
    expect(resultsReset).toHaveBeenCalled();
    expect(useAppStore.getState().phase).toBe('onboarding');
    expect(useAppStore.getState().vaultPath).toBeNull();
    expect(useAppStore.getState().busy).toBe(false);
  });

  it('unlink rethrows and stays linked if the detach fails', async () => {
    useAppStore.setState({ phase: 'ready', vaultPath: '/v' });
    installMockBridge({ unlinkVault: () => Promise.reject(new Error('boom')) });
    await expect(useAppStore.getState().unlink()).rejects.toThrow('boom');
    // No apply ran → still on the current vault; busy cleared by the finally.
    expect(useAppStore.getState().phase).toBe('ready');
    expect(useAppStore.getState().busy).toBe(false);
  });
});
