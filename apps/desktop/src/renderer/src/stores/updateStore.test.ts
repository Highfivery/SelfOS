import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateCheckResult } from '@shared/channels';
import { useUpdateStore } from './updateStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

const RESULT: UpdateCheckResult = {
  current: '0.4.0',
  latest: '0.5.0',
  isUpdateAvailable: true,
  releaseUrl: 'https://github.com/Highfivery/SelfOS/releases/tag/v0.5.0',
  checkedAt: '2026-06-23T00:00:00.000Z',
};

beforeEach(() => {
  useUpdateStore.setState({ result: null, status: 'idle', errored: false, lastAttemptAt: null });
});

afterEach(() => {
  clearMockBridge();
  vi.useRealTimers();
});

describe('updateStore', () => {
  it('stores a successful check result', async () => {
    installMockBridge({ updatesCheck: () => Promise.resolve(RESULT) });
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().result).toEqual(RESULT);
    expect(useUpdateStore.getState().errored).toBe(false);
  });

  it('keeps the prior result but flags errored when a check returns null', async () => {
    useUpdateStore.setState({ result: RESULT });
    installMockBridge({ updatesCheck: () => Promise.resolve(null) });
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().result).toEqual(RESULT); // not clobbered
    expect(useUpdateStore.getState().errored).toBe(true);
  });

  it('throttles a non-forced check that follows a recent one, but a forced check always runs', async () => {
    const updatesCheck = vi.fn(() => Promise.resolve(RESULT));
    installMockBridge({ updatesCheck });
    await useUpdateStore.getState().check(false); // first auto check runs
    await useUpdateStore.getState().check(false); // immediately after → throttled
    expect(updatesCheck).toHaveBeenCalledTimes(1);
    await useUpdateStore.getState().check(true); // the manual button bypasses the throttle
    expect(updatesCheck).toHaveBeenCalledTimes(2);
  });

  it('loadCached surfaces the last-known result without a fresh check', async () => {
    installMockBridge({ updatesGetState: () => Promise.resolve(RESULT) });
    await useUpdateStore.getState().loadCached();
    expect(useUpdateStore.getState().result).toEqual(RESULT);
  });
});
