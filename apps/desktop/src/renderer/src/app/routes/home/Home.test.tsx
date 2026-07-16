import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../../settings/builtins';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { TestGroupId, TestSummary } from '@selfos/core/tests';
import type { ConversationMeta, Dream } from '@shared/channels';
import type { Goal, Insight, Person, TestResult } from '@shared/schemas';
import { Home } from './Home';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { useInsightStore } from '../../../stores/insightStore';
import { useInboxStore } from '../../../stores/inboxStore';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { useGoalStore } from '../../../stores/goalStore';
import { useDiscoveryStore } from '../../../stores/discoveryStore';
import { useSynthesisStore } from '../../../stores/synthesisStore';
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

/** A conversation updated just now (counts toward the rolling momentum window). */
function recentMeta(
  id: string,
  title: string,
  status: ConversationMeta['status'],
): ConversationMeta {
  return { id, title, updatedAt: new Date().toISOString(), status };
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

function staleGoal(id: string, text: string): Goal {
  return {
    id,
    schemaVersion: 1,
    subjectPersonId: ME.id,
    text,
    status: 'open',
    provenance: { at: '2026-01-01T00:00:00.000Z' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastTouchedAt: '2026-01-01T00:00:00.000Z', // long untouched → stale
  };
}

/** A minimal catalog summary for a test the person has taken (drives the `take-a-test` / `intimacy-exercise`
 *  signals). The shape is the crypto-free `TestSummary` the bridge returns. */
function testSummary(id: string, group: TestGroupId, instrument: string): TestSummary {
  return {
    id,
    group,
    title: `${instrument} test`,
    instrument,
    blurb: 'A reflection.',
    framing: 'Not a diagnosis.',
    estimatedMinutes: 5,
    itemCount: 10,
    adult: group === 'intimacy',
    sensitive: group === 'intimacy',
    subscales: [],
    wellbeing: group === 'wellbeing',
  };
}

function testResult(id: string, testId: string, takenAt: string): TestResult {
  return {
    id,
    schemaVersion: 1,
    testId,
    testVersion: 1,
    subjectPersonId: ME.id,
    answers: [],
    scores: [],
    takenAt,
    createdAt: takenAt,
    updatedAt: takenAt,
  };
}

/** Mock-bridge seed making the given catalog tests appear ALREADY TAKEN (so `take-a-test` is satisfied). */
function tookTests(...tests: { id: string; group: TestGroupId; instrument: string }[]): {
  testsList: () => Promise<{ tests: TestSummary[]; adultAcknowledged: boolean }>;
  testsResults: (args: { testId: string }) => Promise<TestResult[]>;
} {
  const summaries = tests.map((t) => testSummary(t.id, t.group, t.instrument));
  return {
    testsList: () => Promise.resolve({ tests: summaries, adultAcknowledged: true }),
    testsResults: ({ testId }) =>
      Promise.resolve(
        tests.some((t) => t.id === testId)
          ? [testResult(`${testId}-r`, testId, '2026-06-20T00:00:00.000Z')]
          : [],
      ),
  };
}

function renderHome(): void {
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

const forYouRegion = (): HTMLElement | null => screen.queryByRole('region', { name: 'For you' });

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
  useGoalStore.getState().reset();
  useDiscoveryStore.getState().reset();
  useSynthesisStore.getState().reset();
  useInsightStore.setState({ insights: [], proposals: [], loaded: false });
  useSessionStore.setState({ activePerson: null, access: null });
});

describe('Home — hierarchy & status grid', () => {
  it('shows getting-started for a brand-new person — and NO "For you" section or momentum', async () => {
    installMockBridge();
    renderHome();
    expect(await screen.findByRole('heading', { name: /welcome to selfos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start a session/i })).toBeInTheDocument();
    // The encouragement zone is suppressed for a brand-new person (getting-started owns the screen).
    expect(forYouRegion()).toBeNull();
    // Crisis footer is always present (§7).
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();
  });

  it('renders the status grid a seeded person has, with a "For you" zone above it', async () => {
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
            type: 'general',
            questionCount: 3,
            status: 'sent' as const,
            privacy: 'private' as const,
            senderName: 'Sam',
            createdAt: 'now',
            favorite: false,
            answerable: true,
            hasDraft: false,
            fromSelf: false,
          },
        ]),
    });
    renderHome();

    expect(await screen.findByRole('heading', { name: /ben/i, level: 1 })).toBeInTheDocument();

    // The smart next action (the top-ranked recommendation) is elevated into the "For you today" band:
    // an open session seeds "Continue your session".
    expect(await screen.findByText(/continue your session/i)).toBeInTheDocument();

    // Status overview grid (distinct from the actionable zone).
    expect(
      screen.getByRole('heading', { name: /pick up where you left off/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('A hard week')).toBeInTheDocument();
    expect(screen.queryByText('Done')).toBeNull(); // completed → not in Continue
    expect(screen.getByRole('heading', { name: 'Wellbeing' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent dreams' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /what the coach knows/i })).toBeInTheDocument();
    // The compact Questionnaires bento card (60 §3.6) surfaces the unanswered inbox send as an action link.
    expect(screen.getByRole('heading', { name: 'Questionnaires' })).toBeInTheDocument();
    expect(await screen.findByText(/1 waiting for you to answer/i)).toBeInTheDocument();
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
});

describe('Home — the "For you" engine', () => {
  it('invites a near-empty person to try a guided session', async () => {
    installMockBridge({
      // `active` widens the "For you" cap to 3 so the gentle guided invite surfaces alongside the
      // open-session + take-a-test recommendations a near-empty person also gets.
      coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1, proactivity: 'active' as const }),
      conversationsList: () => Promise.resolve([meta('c1', 'A first talk', 'inProgress')]),
    });
    renderHome();
    const region = await waitFor(() => {
      const r = forYouRegion();
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    expect(region).toHaveTextContent(/try a guided session/i);
    expect(screen.queryByRole('heading', { name: /welcome to selfos/i })).toBeNull();
  });

  it('surfaces the living-book "Your story grew" card when a chapter has new material (64 §5.6)', async () => {
    installMockBridge({
      // Some activity so the person isn't "new" (which suppresses all "For you" pushes).
      conversationsList: () => Promise.resolve([meta('c1', 'A past talk', 'complete')]),
      storyHomeSignal: () =>
        Promise.resolve({
          hasBook: true,
          staleChapters: 1,
          pendingProposals: 0,
          unwrittenChapters: 0,
          signature: 'b1:1:0:0',
        }),
    });
    renderHome();
    // Proves the capability snapshot includes `story.own` (else the provider is filtered — the spec-52 lesson);
    // findByText polls until the async storyHomeSignal resolves + the card renders.
    expect(await screen.findByText(/new material to weave in/i)).toBeInTheDocument();
    expect(forYouRegion()).not.toBeNull();
  });

  it('surfaces a Together invitation in the "Needs attention" queue (58 §3.12 / 60 §3.1.2a)', async () => {
    installMockBridge({
      coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1, proactivity: 'active' as const }),
      // Some activity so the person isn't "new" (which suppresses all "For you" pushes).
      conversationsList: () => Promise.resolve([meta('c1', 'A past talk', 'complete')]),
      togetherList: () =>
        Promise.resolve([
          {
            id: 'ts1',
            pairKey: 'owner-1~partner',
            initiatorPersonId: 'partner', // Angel invited Ben → a pending invite for him
            participants: [
              { personId: 'owner-1', displayName: 'Ben' },
              { personId: 'partner', displayName: 'Angel' },
            ],
            status: 'invited' as const,
            yourTurn: false,
            unreadCount: 0,
            createdAt: 'now',
          },
        ]),
    });
    renderHome();
    // The Together invitation surfaces in the "Needs attention" card (a genuinely-pending action).
    expect(await screen.findByRole('heading', { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Angel invited you to a session/i).length).toBeGreaterThan(0);
  });

  it('invites a first self-assessment when no profile test is taken (50)', async () => {
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'A first talk', 'inProgress')]),
    });
    renderHome();
    const region = await waitFor(() => {
      const r = forYouRegion();
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    expect(region).toHaveTextContent(/discover how you see yourself/i);
  });

  it('surfaces the weekly mood check-in reminder in "Needs attention" when a prior one has gone quiet (51 / 60 §3.1.2a)', async () => {
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'A past talk', 'complete')]),
      testsList: () =>
        Promise.resolve({
          tests: [testSummary('phq9', 'wellbeing', 'PHQ-9')],
          adultAcknowledged: false,
        }),
      testsResults: ({ testId }) =>
        Promise.resolve(
          testId === 'phq9' ? [testResult('r', 'phq9', '2026-01-01T00:00:00.000Z')] : [],
        ),
    });
    renderHome();
    expect(await screen.findByRole('heading', { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByText(/check in on how you.re doing/i)).toBeInTheDocument();
  });

  it('invites an intimacy exercise once 18+ is acked AND an intimacy profile is taken (48)', async () => {
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'A past talk', 'complete')]),
      guidedGetState: () => Promise.resolve({ cache: null, adultAcknowledged: true }),
      ...tookTests({ id: 'kink-interests', group: 'intimacy', instrument: 'Kink interests' }),
    });
    renderHome();
    const region = await waitFor(() => {
      const r = forYouRegion();
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    expect(region).toHaveTextContent(/build on your intimacy profile/i);
  });

  it('hides the intimacy exercise before the 18+ ack even though the profile exists (the gate is the boundary, 48 §8)', async () => {
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'A past talk', 'complete')]),
      // The intimacy profile is present in the catalog, but the per-person 18+ ack is NOT given...
      guidedGetState: () => Promise.resolve({ cache: null, adultAcknowledged: false }),
      ...tookTests({ id: 'kink-interests', group: 'intimacy', instrument: 'Kink interests' }),
    });
    renderHome();
    const region = await waitFor(() => {
      const r = forYouRegion();
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    // ...so the engine never even considers it (no premature 18+ exposure).
    expect(region).not.toHaveTextContent(/build on your intimacy profile/i);
  });

  it('shows the daily reflection observation when AI is configured with a cached synthesis (§3.1.4)', async () => {
    // The synthesis observation is now the band's daily reflection card, not a "For you" rec. With AI off
    // (and no cache), the card shows no observation — a calm state, never a dead button.
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'A hard week', 'complete')]),
      insightsList: () => Promise.resolve([sessionInsight('s1', -0.4), sessionInsight('s2', 0.5)]),
    });
    setAi(false);
    renderHome();
    await screen.findByRole('heading', { name: /ben/i, level: 1 });
    expect(screen.queryByText(/rest and self-worth keep circling/i)).toBeNull();

    clearMockBridge();
    useConversationStore.getState().reset();
    useInsightStore.setState({ insights: [], proposals: [], loaded: false });
    useSynthesisStore.getState().reset();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () => Promise.resolve([meta('c1', 'A hard week', 'complete')]),
      insightsList: () => Promise.resolve([sessionInsight('s1', -0.4), sessionInsight('s2', 0.5)]),
      coachingGetSynthesis: () =>
        Promise.resolve({
          schemaVersion: 1,
          subjectPersonId: ME.id,
          observation: 'Rest and self-worth keep circling each other for you this week.',
          sources: ['sessions'],
          computedAt: '2026-06-20T00:00:00.000Z',
        }),
    });
    setAi(true);
    renderHome();
    await waitFor(() =>
      expect(screen.getByText(/rest and self-worth keep circling/i)).toBeInTheDocument(),
    );
  });

  it('shows a calm, satisfied line when there is nothing to recommend', async () => {
    installMockBridge({
      conversationsList: () =>
        Promise.resolve([
          meta('c1', 'A', 'complete'),
          meta('c2', 'B', 'complete'),
          meta('c3', 'C', 'complete'),
        ]),
      // A taken profile test satisfies `take-a-test`, so the engine has genuinely nothing to recommend.
      ...tookTests({ id: 'bigfive', group: 'personality', instrument: 'IPIP' }),
    });
    renderHome();
    // Nothing ranks → the band's focal shows a calm satisfied line rather than a forced suggestion.
    expect(await screen.findByText(/you.re all set for now/i)).toBeInTheDocument();
  });

  it('a stale goal surfaces in "Needs attention" + the Goals card, with a one-tap Done (60 §3.1.2a/§3.1.3)', async () => {
    const setStatus = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      goalsList: () => Promise.resolve([staleGoal('g1', 'finish the memoir')]),
      goalsSetStatus: setStatus,
    });
    renderHome();
    // The stale goal leads the "Needs attention" queue (split out of "For you").
    expect(await screen.findByRole('heading', { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByText(/a goal needs a check-in/i)).toBeInTheDocument();
    // …and the Goals bento card carries the action (its per-goal buttons name the goal, for a11y).
    fireEvent.click(screen.getByRole('button', { name: /mark .*finish the memoir.* done/i }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith({ goalId: 'g1', status: 'done' }));
  });

  it('dismissing a "For you" recommendation ("Not now") suppresses it and persists per-person', async () => {
    const setDismissals = vi.fn(() => Promise.resolve());
    // A near-empty person gets the guided-session invite in "For you" — a growth rec that stays in the band.
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'A past talk', 'complete')]),
      setDiscoveryDismissals: setDismissals,
    });
    renderHome();
    const region = await waitFor(() => {
      const r = forYouRegion();
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    const dismiss = within(region).getByRole('button', { name: /for now$/i });
    fireEvent.click(dismiss);
    // The persisted signature is signal-aware (`rec:<id>:…`), so it re-surfaces only when the signal changes (§7).
    await waitFor(() =>
      expect(setDismissals).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringMatching(/^rec:/)]),
      ),
    );
  });
});

describe('Home — proactivity & safety', () => {
  it('proactivity off: no "For you" zone, no momentum push — but the status grid still shows', async () => {
    installMockBridge({
      coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1, proactivity: 'off' as const }),
      conversationsList: () =>
        Promise.resolve([
          recentMeta('c1', 'A week', 'inProgress'),
          recentMeta('c2', 'B', 'inProgress'),
        ]),
      goalsList: () => Promise.resolve([staleGoal('g1', 'finish the memoir')]),
    });
    renderHome();
    // The status grid is unaffected (it reflects existing data, it isn't a push).
    expect(await screen.findByRole('heading', { name: /pick up where/i })).toBeInTheDocument();
    expect(forYouRegion()).toBeNull();
    // Your goals are a GENUINE (non-nudge) item — they STAY in "Needs attention" even with proactivity off
    // (the user's ask: goals must be top of mind here). Only the momentum push + "For you" band are hidden.
    expect(screen.getByRole('heading', { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByText(/a goal needs a check-in/i)).toBeInTheDocument();
    expect(screen.queryByText(/you.ve shown up/i)).toBeNull();
  });

  it('reflects momentum as a warm header line when the person has shown up', async () => {
    installMockBridge({
      conversationsList: () =>
        Promise.resolve([recentMeta('c1', 'A', 'complete'), recentMeta('c2', 'B', 'complete')]),
    });
    renderHome();
    expect(await screen.findByText(/you.ve shown up 2 times this week/i)).toBeInTheDocument();
  });

  it('celebrates a milestone badge once when a threshold is crossed (60 §3.1.7)', async () => {
    // 10 sessions (older than the celebration window, so their per-session completions don't compete) →
    // the "10 sessions in" milestone is the eligible celebration.
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    installMockBridge({
      conversationsList: () =>
        Promise.resolve(
          Array.from({ length: 10 }, (_, i) => ({
            id: `c${i}`,
            title: `S${i}`,
            updatedAt: old,
            status: 'complete' as const,
          })),
        ),
    });
    renderHome();
    expect(await screen.findByText(/10 sessions in/i)).toBeInTheDocument();
  });

  it('surfaces the supportive crisis banner on recurring distress, and suppresses "For you"', async () => {
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
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    installMockBridge({
      goalsList: () => Promise.resolve([staleGoal('g1', 'finish the memoir')]),
      insightsList: () => Promise.resolve([recentCrisis('x1', 1), recentCrisis('x2', 5)]),
      // A live 2-day activity run — WITHOUT crisis this would show a rhythm streak pill; crisis must suppress
      // it (§8, the top gamification guardrail — a struggling person is never streak-shamed).
      conversationsList: () =>
        Promise.resolve([
          {
            id: 'c1',
            title: 'A',
            updatedAt: new Date().toISOString(),
            status: 'complete' as const,
          },
          { id: 'c2', title: 'B', updatedAt: yesterday, status: 'complete' as const },
        ]),
    });
    renderHome();
    expect(await screen.findByText(/carrying a lot/i)).toBeInTheDocument();
    expect(screen.getByText('988')).toBeInTheDocument();
    // Encouragement de-escalates: no "For you" pushes during distress, no rhythm streak, and the gentle AI
    // "Needs attention" nudges (check-in / ask-someone) are suppressed (§8). BUT your own commitments — your
    // goals + Together agreements — still show: they're grounding, not AI pushes, and the crisis banner
    // already leads with support (the user's repeated ask; hiding your own goals was over-aggressive).
    expect(forYouRegion()).toBeNull();
    expect(screen.getByText(/a goal needs a check-in/i)).toBeInTheDocument();
    expect(screen.queryByText(/check in on how you.re doing/i)).toBeNull();
    expect(screen.queryByText(/rhythm/i)).toBeNull();
  });

  it('does not surface the crisis banner for a single recent flag', async () => {
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
    installMockBridge({
      conversationsList: () => Promise.resolve([meta('c1', 'A week', 'inProgress')]),
      insightsList: () => Promise.resolve([recentCrisis('x1', 1)]),
    });
    renderHome();
    await screen.findByRole('heading', { name: /pick up where/i });
    expect(screen.queryByText(/carrying a lot/i)).toBeNull();
  });
});
