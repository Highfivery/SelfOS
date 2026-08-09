import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuestionnaireCoverageView, SelfosBridge } from '@shared/channels';
import { ExploredPanel } from './ExploredPanel';
import { useCoverageStore } from '../../../stores/coverageStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const view = (over: Partial<QuestionnaireCoverageView> = {}): QuestionnaireCoverageView => ({
  hasPlacement: true,
  areas: [
    {
      topicId: 'Work & purpose',
      lifeArea: 'Work & purpose',
      label: 'Work & purpose',
      status: 'explored',
      depth: 0.8,
      steerable: true,
      steered: false,
    },
    {
      topicId: 'Money',
      lifeArea: 'Money',
      label: 'Money',
      status: 'not-yet',
      depth: 0,
      steerable: true,
      steered: false,
    },
    {
      topicId: 'Intimacy',
      lifeArea: 'Intimacy',
      label: 'Intimacy',
      status: 'lightly-touched',
      depth: 0.2,
      steerable: false,
      steered: false,
    },
  ],
  markedOff: [{ label: 'How is your commute?', kind: 'not-applicable', at: 'now' }],
  ...over,
});

beforeEach(() => {
  useCoverageStore.getState().reset();
});
afterEach(() => {
  clearMockBridge();
  useCoverageStore.getState().reset();
});

describe('ExploredPanel (spec 69 §3.4)', () => {
  it('renders the coverage read + marked-off list; Intimacy is read-only', async () => {
    installMockBridge({ questionnairesPersonalizationProfile: () => Promise.resolve(view()) });
    render(<ExploredPanel />);
    expect(await screen.findByText('Work & purpose')).toBeInTheDocument();
    expect(screen.getByText('Money')).toBeInTheDocument();
    // Coverage status shown as text (never color-only).
    expect(screen.getByText('Explored')).toBeInTheDocument();
    expect(screen.getByText('Not yet explored')).toBeInTheDocument();
    // The marked-off decline surfaces.
    expect(screen.getByText('How is your commute?')).toBeInTheDocument();
    // Intimacy is read-only — no steer buttons in its row.
    expect(screen.getByText('Managed in your intimacy settings')).toBeInTheDocument();
    // General areas each get Explore more / Leave alone.
    expect(screen.getAllByRole('button', { name: 'Explore more' })).toHaveLength(2);
  });

  it('a steer calls the bridge and updates the view', async () => {
    const steer = vi.fn<SelfosBridge['questionnairesSteerTopic']>().mockResolvedValue(
      view({
        areas: view().areas.map((a) => (a.topicId === 'Money' ? { ...a, steered: true } : a)),
      }),
    );
    installMockBridge({
      questionnairesPersonalizationProfile: () => Promise.resolve(view()),
      questionnairesSteerTopic: steer,
    });
    // Seed the loaded view directly (deterministic — no async-load race on the singleton store).
    useCoverageStore.setState({ view: view(), loaded: true });
    render(<ExploredPanel />);
    await screen.findByText('Money');
    // Explore more on the Money row (2nd general area).
    await userEvent.click(screen.getAllByRole('button', { name: 'Explore more' })[1]!);
    await waitFor(() =>
      expect(steer).toHaveBeenCalledWith({
        topicId: 'Money',
        lifeArea: 'Money',
        label: 'Money',
        action: 'explore-more',
      }),
    );
    // The refreshed view marks Money as being explored more.
    expect(await screen.findByText('Exploring more')).toBeInTheDocument();
  });

  it('shows a calm empty state before any exploration', async () => {
    installMockBridge({
      questionnairesPersonalizationProfile: () =>
        Promise.resolve({ areas: [], markedOff: [], hasPlacement: false }),
    });
    render(<ExploredPanel />);
    expect(await screen.findByText(/hasn’t explored anything with you yet/)).toBeInTheDocument();
  });
});
