import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBootState } from './useBootState';
import type { BootState } from '@shared/schemas';

afterEach(() => {
  delete window.selfos;
});

describe('useBootState', () => {
  it('returns the validated boot state from the bridge', async () => {
    const state: BootState = { phase: 'ready', vaultPath: null, hasSettings: false };
    window.selfos = { getBootState: () => Promise.resolve(state) };

    const { result } = renderHook(() => useBootState());

    await waitFor(() => expect(result.current).toEqual(state));
  });

  it('stays null when the bridge returns an invalid payload', async () => {
    const invalid = { phase: 'bogus' } as unknown as BootState;
    window.selfos = { getBootState: () => Promise.resolve(invalid) };

    const { result } = renderHook(() => useBootState());

    // The effect must swallow the Zod failure and leave state null.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeNull();
  });

  it('stays null when no bridge is present (e.g. outside Electron)', async () => {
    const { result } = renderHook(() => useBootState());

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeNull();
  });
});
