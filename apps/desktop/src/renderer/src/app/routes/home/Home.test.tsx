import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../../settings/builtins';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { ConversationMeta, Dream } from '@shared/channels';
import type { Insight, Person } from '@shared/schemas';
import { Home } from './Home';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { useInsightStore } from '../../../stores/insightStore';
import { useInboxStore } from '../../../stores/inboxStore';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { useSettingsStore } from '../../../settings/settingsStore';

const ME: Person = {
  id: 'owner-1',
  schemaVersion: 1,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

function signIn(roleId: 'owner' | 'member'): void {
  useSessionStore.setState({
    activePerson: ME,
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: ME.id, roleId, hasPin: false }],
    },
  });
}

function setAi(enabled: boolean): void {
  useSettingsStore.setState((state) => ({ values: { ...state.values, 'ai.enabled': enabled } }));
}

function meta(id: string, title: string, status: ConversationMeta['status']): ConversationMeta {
  return { id, title, updatedAt: 'now', status };
}

function sessionInsight(id: string, valence: number): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: ME.id,
    summary: `Reflected on the week (${id})`,
    facts: [],
    metrics: { moodValence: valence, moodEnergy: 0.1 },
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { conversationId: id, at: `2026-06-0${id.slice(-1)}T00:00:00.000Z` },
    createdAt: 'now',
    updatedAt: `2026-06-0${id.slice(-1)}`,
  };
}

function dream(id: string, title: string): Dream {
  return {
    id,
    schemaVersion: 1,
    personId: ME.id,
    title,
    narrative: 'I was wandering through a city that kept rearranging itself.',
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: 'now',
    updatedAt: `2026-06-0${id.slice(-1)}`,
  };
}

function renderHome(): void {
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setAi(false);
  signIn('owner');
});

afterEach(() => {
  clearMockBridge();
  useConversationStore.getState().reset();
  useDreamStore.getState().reset();
  useDreamPatternStore.getState().reset();
  useInboxStore.getState().reset();
  useGuidanceStore.getState().reset();
  useInsightStore.setState({ insights: [], loaded: false });
  useSessionStore.setState({ activePerson: null, access: null });
});

describe('Home', () => {
  it('shows the getting-started state for a brand-new person', async () => {
    installMockBridge();
    renderHome();
    expect(await screen.findByRole('heading', { name: /welcome to selfos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start a session/i })).toBeInTheDocument();
    // Discovery: the owner is pointed at sending a questionnaire too (41 §3.1).
    expect(screen.getByRole('button', { name: /send a questionnaire/i })).toBeInTheDocument();
    // No real cards yet.
    expect(screen.queryByRole('heading', { name: /pick up where you left off/i })).toBeNull();
    // Crisis footer is always present (§7).
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();
  });

  it('shows the discovery nudge for a near-empty person (one session, nothing else)', async () => {
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'A first talk', 'inProgress')]),
    });
    renderHome();
    // Not brand-new (so no Welcome card), but light enough to nudge discovery.
    expect(await screen.findByText(/a few things to explore/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /welcome to selfos/i })).toBeNull();
    expect(screen.getByRole('button', { name: /log a dream/i })).toBeInTheDocument();
  });

  it('renders the cards a seeded person has, and hides the empty ones', async () => {
    installMockBridge({
      conversationsList: () =>
        Promise.resolve([meta('c1', 'A hard week', 'inProgress'), meta('c2', 'Done', 'complete')]),
      insightsList: () => Promise.resolve([sessionInsight('s1', -0.4), sessionInsight('s2', 0.5)]),
      dreamsList: () => Promise.resolve([dream('d1', 'The shifting city')]),
      assignmentsInbox: () =>
        Promise.resolve([
          {
            assignmentId: 'a1',
            title: 'Check-in',
            questionCount: 3,
            status: 'sent' as const,
            privacy: 'private' as const,
            senderName: 'Sam',
            createdAt: 'now',
            answerable: true,
            hasDraft: false,
          },
        ]),
    });
    renderHome();

    // Greeting + status line (open sessions wins the status line).
    expect(await screen.findByRole('heading', { name: /ben/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText('1 session in progress')).toBeInTheDocument();

    // Continue card (only the in-progress one), wellbeing, dreams, memory, inbox.
    expect(
      screen.getByRole('heading', { name: /pick up where you left off/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('A hard week')).toBeInTheDocument();
    expect(screen.queryByText('Done')).toBeNull(); // completed → not in Continue
    expect(screen.getByRole('heading', { name: 'Wellbeing' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent dreams' })).toBeInTheDocument();
    expect(screen.getByText('The shifting city')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /what the coach knows/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByText(/1 questionnaire waiting/i)).toBeInTheDocument();

    // Getting-started is gone once there's real content.
    expect(screen.queryByRole('heading', { name: /welcome to selfos/i })).toBeNull();
  });

  it('hides the wellbeing trend until there are ≥2 analyzed sessions', async () => {
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'One session', 'onHold')]),
      insightsList: () => Promise.resolve([sessionInsight('s1', 0.2)]), // only one
    });
    renderHome();
    expect(await screen.findByRole('heading', { name: /pick up where/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Wellbeing' })).toBeNull();
  });

  it('shows the dollar figure to an admin and a budget bar to a member', async () => {
    const seed = {
      conversationsList: () => Promise.resolve([meta('c1', 'A hard week', 'inProgress')]),
      usageSessionCosts: () =>
        Promise.resolve({ c1: { tokens: 1200, costUsd: 0.42, budgetRatio: 0.1 } }),
    };

    installMockBridge(seed);
    signIn('owner');
    const { unmount } = render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(await screen.findByText('$0.42')).toBeInTheDocument();
    expect(screen.getAllByText(/admin only/i).length).toBeGreaterThan(0);
    unmount();

    useConversationStore.getState().reset();
    signIn('member');
    installMockBridge(seed);
    renderHome();
    await screen.findByRole('heading', { name: /pick up where/i });
    expect(screen.queryByText('$0.42')).toBeNull();
    expect(screen.getByLabelText(/% of your period allowance/i)).toBeInTheDocument();
  });

  it('hides Suggested next steps when AI is off and shows it when configured', async () => {
    installMockBridge({
      secretHas: () => Promise.resolve(false),
      conversationsList: () => Promise.resolve([meta('c1', 'A hard week', 'inProgress')]),
    });
    setAi(false);
    renderHome();
    await screen.findByRole('heading', { name: /pick up where/i });
    expect(screen.queryByRole('heading', { name: /suggested next steps/i })).toBeNull();

    clearMockBridge();
    useConversationStore.getState().reset();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () => Promise.resolve([meta('c1', 'A hard week', 'inProgress')]),
    });
    setAi(true);
    renderHome();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /suggested next steps/i })).toBeInTheDocument(),
    );
  });

  // --- cross-insight crisis awareness (40 §3.5) ---
  const recentCrisis = (id: string, daysAgo: number): Insight => ({
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: ME.id,
    summary: 'A heavy check-in',
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    crisisFlag: true,
    provenance: {
      conversationId: id,
      at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    },
    createdAt: 'now',
    updatedAt: 'now',
  });

  it('surfaces the supportive crisis banner when distress recurs (≥2 recent flags), even without a mood chart', async () => {
    installMockBridge({
      insightsList: () => Promise.resolve([recentCrisis('x1', 1), recentCrisis('x2', 5)]),
    });
    renderHome();
    expect(await screen.findByText(/carrying a lot/i)).toBeInTheDocument();
    // It's resources-first (988) and NOT dismissible (no dismiss control on the banner).
    expect(screen.getByText('988')).toBeInTheDocument();
    // The mood chart needs ≥2 mood points; these crisis insights carry none, so the banner stands alone.
    expect(screen.queryByRole('heading', { name: 'Wellbeing' })).toBeNull();
  });

  it('does not surface the crisis banner for a single recent flag', async () => {
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'A week', 'inProgress')]),
      insightsList: () => Promise.resolve([recentCrisis('x1', 1)]),
    });
    renderHome();
    await screen.findByRole('heading', { name: /pick up where/i });
    expect(screen.queryByText(/carrying a lot/i)).toBeNull();
  });
});
