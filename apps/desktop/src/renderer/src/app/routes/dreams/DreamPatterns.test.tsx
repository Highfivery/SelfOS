import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DreamPatternStats } from '@shared/schemas';
import { DreamPatterns } from './DreamPatterns';
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useDreamPatternStore.getState().reset();
  useSettingsStore.setState((s) => ({ values: { ...s.values, 'ai.enabled': false } }));
});

const baseStats: DreamPatternStats = {
  window: '30d',
  dreamCount: 4,
  analyzedCount: 2,
  symbols: [{ label: 'water', count: 3 }],
  themes: [{ label: 'loss', count: 2 }],
  people: [{ label: 'Mara', count: 2 }],
  emotions: [{ label: 'fear', count: 3 }],
  lucidCount: 1,
  nightmareCount: 2,
  moodTrend: [
    { date: '2026-06-01', value: -0.5 },
    { date: '2026-06-05', value: 0.2 },
  ],
  vividnessTrend: [{ date: '2026-06-01', value: 3 }],
  nightmareNudge: false,
};

function enableAi(): void {
  useSettingsStore.setState((s) => ({
    values: { ...s.values, 'ai.enabled': true, 'dreams.memoryEnabled': true },
  }));
}

function renderPatterns(): void {
  render(
    <MemoryRouter>
      <DreamPatterns />
    </MemoryRouter>,
  );
}

describe('Dream patterns screen', () => {
  it('renders the deterministic charts from stats', async () => {
    installMockBridge({ dreamPatternStats: () => Promise.resolve(baseStats) });
    renderPatterns();
    expect(await screen.findByText('water')).toBeInTheDocument();
    expect(screen.getByText('Mara')).toBeInTheDocument();
    expect(screen.getByText('fear')).toBeInTheDocument();
    expect(screen.getByText(/2 of 4/)).toBeInTheDocument(); // nightmares of total
  });

  it('switches the window and re-fetches stats', async () => {
    const statsSpy = vi.fn(() => Promise.resolve(baseStats));
    installMockBridge({ dreamPatternStats: statsSpy });
    renderPatterns();
    await screen.findByText('water');
    await userEvent.click(screen.getByRole('button', { name: 'All time' }));
    await waitFor(() => expect(statsSpy).toHaveBeenCalledWith({ window: 'all' }));
  });

  it('shows the gentle nightmare nudge when flagged', async () => {
    installMockBridge({
      dreamPatternStats: () => Promise.resolve({ ...baseStats, nightmareNudge: true }),
    });
    renderPatterns();
    expect(
      await screen.findByText(/recurring nightmares can be worth talking through/i),
    ).toBeInTheDocument();
  });

  it('shows the empty state when there are no dreams', async () => {
    installMockBridge({
      dreamPatternStats: () => Promise.resolve({ ...baseStats, dreamCount: 0 }),
    });
    renderPatterns();
    expect(await screen.findByText(/patterns appear as you log more/i)).toBeInTheDocument();
  });

  it('generates the AI narrative on demand', async () => {
    enableAi();
    installMockBridge({
      dreamPatternStats: () => Promise.resolve(baseStats),
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetPatternSummary: () => Promise.resolve(null),
    });
    renderPatterns();
    await userEvent.click(await screen.findByRole('button', { name: 'Generate a reflection' }));
    expect(await screen.findByText(/a thread of searching recurs/i)).toBeInTheDocument();
  });

  it('approves a generated narrative into the coaching context', async () => {
    enableAi();
    installMockBridge({
      dreamPatternStats: () => Promise.resolve(baseStats),
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetPatternSummary: () =>
        Promise.resolve({
          schemaVersion: 1,
          personId: 'owner-1',
          narrative: 'A recurring thread of water.',
          windowFrom: '2026-06-01',
          windowTo: '2026-06-11',
          computedAt: 'now',
        }),
    });
    renderPatterns();
    await screen.findByText('A recurring thread of water.');
    await userEvent.click(screen.getByRole('button', { name: /add to my coaching context/i }));
    expect(await screen.findByText(/in your coaching context/i)).toBeInTheDocument();
  });

  it('shows a calm connect-Claude state for the narrative when AI is off, but still charts', async () => {
    installMockBridge({
      dreamPatternStats: () => Promise.resolve(baseStats),
      secretHas: () => Promise.resolve(false),
    });
    renderPatterns();
    expect(await screen.findByText('water')).toBeInTheDocument(); // charts work offline
    expect(screen.getByText(/connect claude to reflect across your dreams/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate a reflection' })).not.toBeInTheDocument();
  });
});
