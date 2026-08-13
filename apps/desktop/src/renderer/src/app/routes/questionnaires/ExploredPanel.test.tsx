import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
      activity: [],
      askedCount: 9,
      topics: [
        {
          topicId: 'Work & purpose:director-of-ops',
          label: 'Director of Ops ambition',
          askedCount: 6,
          open: false,
          leftAlone: false,
          emergent: true,
          prioritized: false,
        },
        {
          topicId: 'Work & purpose:satisfaction',
          label: 'RevOps role & satisfaction',
          askedCount: 3,
          open: true,
          leftAlone: false,
          emergent: true,
          prioritized: false,
        },
      ],
    },
    {
      topicId: 'Money',
      lifeArea: 'Money',
      label: 'Money',
      status: 'new',
      depth: 0,
      steerable: true,
      steered: false,
      activity: [],
      askedCount: 0,
      topics: [],
    },
    {
      topicId: 'Intimacy',
      lifeArea: 'Intimacy',
      label: 'Intimacy',
      status: 'getting-to-know',
      depth: 0.2,
      steerable: false,
      steered: false,
      activity: [],
      askedCount: 4,
      topics: [
        {
          topicId: 'Intimacy:oral',
          label: 'Oral',
          askedCount: 4,
          open: false,
          leftAlone: false,
          emergent: false,
          prioritized: false,
        },
      ],
      adultGated: true,
    },
  ],
  markedOff: [{ label: 'How is your commute?', kind: 'not-applicable', at: 'now' }],
  partners: [],
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
    // The candidate feed is the default section.
    expect(await screen.findByText('What SelfOS is curious about next')).toBeInTheDocument();
    expect(
      screen.getByText('What would financial security feel like for you?'),
    ).toBeInTheDocument();
    expect(screen.getByText('new ground')).toBeInTheDocument();

    // The coverage section (its own sub-nav item) — honest overview, never "done"; status is text.
    await userEvent.click(screen.getByRole('button', { name: /How well it knows you/ }));
    expect(await screen.findByText('How well I know you')).toBeInTheDocument();
    // No completeness label or meter anywhere: nothing here is ever finished (spec 71 §5.9).
    expect(screen.queryByText('Knows you well')).not.toBeInTheDocument();
    expect(screen.queryByText('Getting to know you')).not.toBeInTheDocument();
    expect(screen.queryByText('New', { exact: true })).not.toBeInTheDocument();
    // What replaced it: activity + counts, describing what happened rather than what is left.
    expect(screen.getAllByText(/asked/).length).toBeGreaterThan(0);
    // Intimacy (18+) is gated until acked: it shows the 18+ badge + the inline unlock, NOT the steer buttons.
    expect(screen.getByText('18+')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /18 or older/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Prioritize this area' })).toHaveLength(2); // Work + Money only

    // The "left alone" section holds the marked-off decline.
    await userEvent.click(screen.getByRole('button', { name: /Left alone/ }));
    expect(await screen.findByText('How is your commute?')).toBeInTheDocument();

    // No "Explored/done" language anywhere in the panel.
    expect(screen.queryByText(/explored/i)).toBeNull();
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
    await userEvent.click(await screen.findByRole('button', { name: /How well it knows you/ }));
    await userEvent.click(await screen.findByRole('button', { name: /18 or older/i }));
    await waitFor(() => expect(ack).toHaveBeenCalled());
    // After acking, the Intimacy row is steerable (3 Explore-more: Work + Money + Intimacy) and the unlock is gone.
    expect(await screen.findAllByRole('button', { name: 'Prioritize this area' })).toHaveLength(3);
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

  it('renders an "Explore with your partner" card; adding a wish calls the bridge (spec 70 §3.5)', async () => {
    const withPartner = view({
      partners: [
        {
          partnerId: 'ben',
          partnerName: 'Ben',
          wishes: [{ id: 'w1', note: 'plan more date nights', intimacy: false }],
        },
      ],
    });
    const addWish = vi
      .fn<SelfosBridge['questionnairesAddPartnerWish']>()
      .mockResolvedValue(withPartner);
    installMockBridge({
      questionnairesPersonalizationProfile: () => Promise.resolve(withPartner),
      questionnairesAddPartnerWish: addWish,
    });
    useCoverageStore.setState({ view: withPartner, loaded: true });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    // The partner section is its own sub-nav item.
    await userEvent.click(await screen.findByRole('button', { name: /Explore with Ben/ }));
    expect(await screen.findByRole('heading', { name: 'Explore with Ben' })).toBeInTheDocument();
    // The existing wish shows, and it says the partner never sees it (silent).
    expect(screen.getByText('plan more date nights')).toBeInTheDocument();
    expect(screen.getByText(/they never see that you asked/i)).toBeInTheDocument();
    // Add a new wish.
    await userEvent.type(
      screen.getByLabelText('Something to explore with Ben'),
      'take a cooking class',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(addWish).toHaveBeenCalledWith({
        partnerPersonId: 'ben',
        note: 'take a cooking class',
      }),
    );
  });

  it('the left sub-nav lists each section (partner/left-alone only when they have content)', async () => {
    const withPartner = view({
      partners: [
        {
          partnerId: 'ben',
          partnerName: 'Ben',
          wishes: [{ id: 'w1', note: 'plan more date nights', intimacy: false }],
        },
      ],
    });
    installMockBridge({
      questionnairesPersonalizationProfile: () => Promise.resolve(withPartner),
    });
    useCoverageStore.setState({ view: withPartner, loaded: true });
    const nav = render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    // All four section nav items are present (partner + left-alone because they have content here).
    const sections = await screen.findByRole('navigation', { name: /Explored sections/i });
    expect(within(sections).getByRole('button', { name: /Curious next/ })).toBeInTheDocument();
    expect(
      within(sections).getByRole('button', { name: /How well it knows you/ }),
    ).toBeInTheDocument();
    expect(within(sections).getByRole('button', { name: /Explore with Ben/ })).toBeInTheDocument();
    expect(within(sections).getByRole('button', { name: /Left alone/ })).toBeInTheDocument();

    // With no partner and no declines, only the two core sections show.
    nav.unmount();
    useCoverageStore.setState({ view: view({ markedOff: [] }), loaded: true });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    const bare = await screen.findByRole('navigation', { name: /Explored sections/i });
    expect(within(bare).getByRole('button', { name: /Curious next/ })).toBeInTheDocument();
    expect(within(bare).queryByRole('button', { name: /Explore with/ })).toBeNull();
    expect(within(bare).queryByRole('button', { name: /Left alone/ })).toBeNull();
  });

  it('the ✕ removes a candidate; Clear all empties the feed (spec 70 §3.2)', async () => {
    const curate = vi
      .fn<SelfosBridge['questionnairesCurateCandidate']>()
      // Removing c1 leaves c2, so the feed (and Clear all) is still there.
      .mockResolvedValue(view({ candidates: [candidate({ id: 'c2', prompt: 'Another one?' })] }));
    const clearFeed = vi
      .fn<SelfosBridge['questionnairesClearCandidateFeed']>()
      .mockResolvedValue(view({ candidates: [] }));
    installMockBridge({
      questionnairesPersonalizationProfile: () =>
        Promise.resolve(
          view({
            candidates: [candidate({ id: 'c1' }), candidate({ id: 'c2', prompt: 'Another one?' })],
          }),
        ),
      questionnairesCurateCandidate: curate,
      questionnairesClearCandidateFeed: clearFeed,
    });
    useCoverageStore.setState({
      view: view({
        candidates: [candidate({ id: 'c1' }), candidate({ id: 'c2', prompt: 'Another one?' })],
      }),
      loaded: true,
    });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    // ✕ on the first card removes just that one (maps to 'not-this').
    const removes = await screen.findAllByRole('button', { name: /Remove this question/ });
    await userEvent.click(removes[0]!);
    await waitFor(() =>
      expect(curate).toHaveBeenCalledWith({ candidateId: 'c1', action: 'not-this' }),
    );
    // Clear all is a two-step confirm, then calls the bulk bridge.
    await userEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' })); // the confirm
    await waitFor(() => expect(clearFeed).toHaveBeenCalled());
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
    await userEvent.click(await screen.findByRole('button', { name: /How well it knows you/ }));
    await screen.findByText('How well I know you');
    await userEvent.click(screen.getAllByRole('button', { name: 'Prioritize this area' })[1]!);
    await waitFor(() =>
      expect(steer).toHaveBeenCalledWith({
        topicId: 'Money',
        lifeArea: 'Money',
        label: 'Money',
        action: 'explore-more',
      }),
    );
    expect(await screen.findByText('Prioritized')).toBeInTheDocument();
  });

  /** Open the coverage section, which is where the topic map lives. */
  const openCoverage = async (steer?: ReturnType<typeof vi.fn>): Promise<void> => {
    installMockBridge({
      questionnairesPersonalizationProfile: () => Promise.resolve(view()),
      ...(steer ? { questionnairesSteerTopic: steer } : {}),
    });
    useCoverageStore.setState({ view: view(), loaded: true });
    render(
      <MemoryRouter>
        <ExploredPanel />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: /How well it knows you/ }));
    await screen.findByText('How well I know you');
  };

  it('reveals the emergent topic map inside an area, worked-through ground included (spec 71 §5.8)', async () => {
    await openCoverage();
    // Collapsed by default — the panel stays scannable with 30+ topics on the map.
    expect(screen.queryByText('Director of Ops ambition')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Work & purpose/ }));
    // Every topic is listed with its real ask count, worked-through ground included: seeing what it has
    // already covered is most of the point of this surface.
    expect(screen.getByText('Director of Ops ambition')).toBeInTheDocument();
    expect(screen.getByText('RevOps role & satisfaction')).toBeInTheDocument();
    expect(screen.getByText(/asked 6×/)).toBeInTheDocument();
    // Ground the model named itself is marked, so it reads as new rather than a built-in family.
    expect(screen.getAllByText('AI named').length).toBeGreaterThan(0);
  });

  it('leaving a topic alone steers that TOPIC, not the whole area', async () => {
    const steer = vi.fn<SelfosBridge['questionnairesSteerTopic']>().mockResolvedValue(view());
    await openCoverage(steer);
    await userEvent.click(screen.getByRole('button', { name: /Work & purpose/ }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Pause asking about RevOps role & satisfaction' }),
    );
    await waitFor(() =>
      expect(steer).toHaveBeenCalledWith(
        expect.objectContaining({
          topicId: 'Work & purpose:satisfaction',
          action: 'leave-alone',
        }),
      ),
    );
  });

  it('keeps intimacy topics behind the 18+ acknowledgement', async () => {
    await openCoverage();
    // The fixture's Intimacy row is un-acknowledged, so there is nothing to expand and no explicit label
    // reaches the screen (spec 70 §3.4 — the gate is unchanged by this surface).
    // The row itself still renders (it always did) — what the gate withholds is the ground inside it, so the
    // header must not be expandable and no intimacy topic may reach the screen.
    expect(screen.getByRole('button', { name: /^Intimacy/ })).toBeDisabled();
    expect(screen.queryByText('Oral')).not.toBeInTheDocument();
  });
});
