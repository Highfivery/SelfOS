import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { CandidateFeedItem, QuestionnaireCoverageView, SelfosBridge } from '@shared/channels';
import { ExploredPanel } from './ExploredPanel';
import { useCoverageStore } from '../../../stores/coverageStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const candidate = (over: Partial<CandidateFeedItem> = {}): CandidateFeedItem => ({
  id: 'c1',
  lifeArea: 'Money',
  prompt: 'What would financial security feel like for you?',
  kind: 'new',
  curation: 'none',
  ...over,
});

const view = (over: Partial<QuestionnaireCoverageView> = {}): QuestionnaireCoverageView => ({
  hasPlacement: true,
  candidatesRefreshedAt: '2026-08-09T00:00:00.000Z',
  candidates: [candidate()],
  areas: [
    {
      topicId: 'Work & purpose',
      lifeArea: 'Work & purpose',
      label: 'Work & purpose',
      status: 'knows-well',
      depth: 0.8,
      steerable: true,
      steered: false,
    },
    {
      topicId: 'Money',
      lifeArea: 'Money',
      label: 'Money',
      status: 'new',
      depth: 0,
      steerable: true,
      steered: false,
    },
    {
      topicId: 'Intimacy',
      lifeArea: 'Intimacy',
      label: 'Intimacy',
      status: 'getting-to-know',
      depth: 0.2,
      steerable: false,
      steered: false,
      adultGated: true,
    },
  ],
  markedOff: [{ label: 'How is your commute?', kind: 'not-applicable', at: 'now' }],
  adultAcknowledged: false,
  ...over,
});

beforeEach(() => {
  useCoverageStore.getState().reset();
});
afterEach(() => {
  clearMockBridge();
  useCoverageStore.getState().reset();
});

describe('ExploredPanel (spec 70 §3)', () => {
  it('leads with the candidate feed, then the honest overview (never "done"); Intimacy is 18+-gated', async () => {
    installMockBridge({ questionnairesPersonalizationProfile: () => Promise.resolve(view()) });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    // The candidate feed leads.
    expect(await screen.findByText('What SelfOS is curious about next')).toBeInTheDocument();
    expect(
      screen.getByText('What would financial security feel like for you?'),
    ).toBeInTheDocument();
    expect(screen.getByText('new ground')).toBeInTheDocument();
    // The honest overview — never "done"; status is text (not color-only).
    expect(screen.getByText('How well I know you')).toBeInTheDocument();
    expect(screen.getByText('Knows you well')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    // No "Explored/done" language anywhere.
    expect(screen.queryByText(/explored/i)).toBeNull();
    // The marked-off decline surfaces.
    expect(screen.getByText('How is your commute?')).toBeInTheDocument();
    // Intimacy (18+) is gated until acked: it shows the 18+ badge + the inline unlock, NOT the steer buttons.
    expect(screen.getByText('18+')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /18 or older/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Explore more' })).toHaveLength(2); // Work + Money only
  });

  it('the Intimacy row unlocks its steers via the inline 18+ acknowledgement (spec 70 §3.4)', async () => {
    const ack = vi.fn<SelfosBridge['questionnairesAcknowledgeAdult']>().mockResolvedValue(
      view({
        adultAcknowledged: true,
        areas: view().areas.map((a) => (a.lifeArea === 'Intimacy' ? { ...a, steerable: true } : a)),
      }),
    );
    installMockBridge({
      questionnairesPersonalizationProfile: () => Promise.resolve(view()),
      questionnairesAcknowledgeAdult: ack,
    });
    useCoverageStore.setState({ view: view(), loaded: true });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: /18 or older/i }));
    await waitFor(() => expect(ack).toHaveBeenCalled());
    // After acking, the Intimacy row is steerable (3 Explore-more: Work + Money + Intimacy) and the unlock is gone.
    expect(await screen.findAllByRole('button', { name: 'Explore more' })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /18 or older/i })).toBeNull();
  });

  it('a candidate curation tap calls the bridge and refreshes the view', async () => {
    const curate = vi
      .fn<SelfosBridge['questionnairesCurateCandidate']>()
      .mockResolvedValue(view({ candidates: [candidate({ curation: 'asked' })] }));
    installMockBridge({
      questionnairesPersonalizationProfile: () => Promise.resolve(view()),
      questionnairesCurateCandidate: curate,
    });
    useCoverageStore.setState({ view: view(), loaded: true });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    await screen.findByText('What would financial security feel like for you?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask me this' }));
    await waitFor(() => expect(curate).toHaveBeenCalledWith({ candidateId: 'c1', action: 'ask' }));
    // The refreshed view marks the candidate pinned.
    expect(await screen.findByRole('button', { name: 'Asking this' })).toBeInTheDocument();
  });

  it('"Look for more" calls the refresh bridge (budget-gated pass)', async () => {
    const refresh = vi
      .fn<SelfosBridge['questionnairesRefreshNextCandidates']>()
      .mockResolvedValue(view());
    // Pre-first-refresh: no candidates and no `candidatesRefreshedAt` at all.
    const { candidatesRefreshedAt: _drop, ...preRefresh } = view({ candidates: [] });
    void _drop;
    installMockBridge({
      questionnairesPersonalizationProfile: () => Promise.resolve(preRefresh),
      questionnairesRefreshNextCandidates: refresh,
    });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    // Pre-first-refresh calm state.
    expect(await screen.findByText(/still getting to know you/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Look for more' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(
      await screen.findByText('What would financial security feel like for you?'),
    ).toBeInTheDocument();
  });

  it('"Look for more" surfaces an honest message when the pass is degraded (no key / over budget)', async () => {
    const refresh = vi
      .fn<SelfosBridge['questionnairesRefreshNextCandidates']>()
      .mockResolvedValue(view({ candidates: [], refreshDegraded: true }));
    installMockBridge({
      questionnairesPersonalizationProfile: () => Promise.resolve(view({ candidates: [] })),
      questionnairesRefreshNextCandidates: refresh,
    });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Look for more' });
    await userEvent.click(screen.getByRole('button', { name: 'Look for more' }));
    expect(await screen.findByText(/Couldn’t look for more right now/)).toBeInTheDocument();
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
    useCoverageStore.setState({ view: view(), loaded: true });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    await screen.findByText('How well I know you');
    await userEvent.click(screen.getAllByRole('button', { name: 'Explore more' })[1]!);
    await waitFor(() =>
      expect(steer).toHaveBeenCalledWith({
        topicId: 'Money',
        lifeArea: 'Money',
        label: 'Money',
        action: 'explore-more',
      }),
    );
    expect(await screen.findByText('Exploring more')).toBeInTheDocument();
  });
});
