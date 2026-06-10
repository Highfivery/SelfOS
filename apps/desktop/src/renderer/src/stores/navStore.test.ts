import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNavStore } from './navStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useNavStore.setState({ collapsed: false, loaded: false });
});

describe('navStore', () => {
  it('hydrates the collapsed state from the bridge', async () => {
    installMockBridge({ getSidebarCollapsed: () => Promise.resolve(true) });
    await useNavStore.getState().load();
    expect(useNavStore.getState().collapsed).toBe(true);
    expect(useNavStore.getState().loaded).toBe(true);
  });

  it('toggles and persists each change device-local', () => {
    const setSidebarCollapsed = vi.fn(() => Promise.resolve());
    installMockBridge({ setSidebarCollapsed });

    useNavStore.getState().toggle();
    expect(useNavStore.getState().collapsed).toBe(true);
    expect(setSidebarCollapsed).toHaveBeenLastCalledWith(true);

    useNavStore.getState().toggle();
    expect(useNavStore.getState().collapsed).toBe(false);
    expect(setSidebarCollapsed).toHaveBeenLastCalledWith(false);
  });
});
