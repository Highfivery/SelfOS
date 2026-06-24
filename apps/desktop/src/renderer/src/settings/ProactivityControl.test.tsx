import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProactivityControl } from './ProactivityControl';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
});

describe('ProactivityControl (40 §3.6)', () => {
  it('loads the active person’s current level into the select', async () => {
    installMockBridge({
      coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1, proactivity: 'active' }),
    });
    render(<ProactivityControl />);
    const select = screen.getByLabelText('How proactive your coach is') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('active'));
  });

  it('defaults to gentle when no preference is set', async () => {
    installMockBridge({ coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1 }) });
    render(<ProactivityControl />);
    const select = screen.getByLabelText('How proactive your coach is') as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe('gentle');
    expect(screen.getByText(/gently follow up on a goal/i)).toBeInTheDocument();
  });

  it('writes the chosen level through the bridge (per-person)', async () => {
    const setPrefs = vi.fn(() =>
      Promise.resolve({ schemaVersion: 1, proactivity: 'off' as const }),
    );
    installMockBridge({
      coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1 }),
      coachingSetPrefs: setPrefs,
    });
    render(<ProactivityControl />);
    const select = screen.getByLabelText('How proactive your coach is') as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    await userEvent.selectOptions(select, 'off');
    expect(setPrefs).toHaveBeenCalledWith({ proactivity: 'off' });
    // The "off" hint (always-available crisis support) is shown.
    expect(screen.getByText(/only responds when you start something/i)).toBeInTheDocument();
  });
});
