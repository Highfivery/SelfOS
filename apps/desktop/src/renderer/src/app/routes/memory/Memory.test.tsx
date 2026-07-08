import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Insight } from '@shared/schemas';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { Memory } from './Memory';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const activeP1 = {
  id: 'p1',
  schemaVersion: 1 as const,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

function insight(over: Partial<Insight> & { id: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: 'p1',
    summary: `summary-${over.id}`,
    facts: [],
    confidence: 'medium',
    categories: ['Other'],
    approved: true,
    provenance: { assignmentId: 'a1', at: '2026-06-11T12:00:00.000Z' },
    createdAt: '2026-06-11T12:00:00.000Z',
    updatedAt: '2026-06-11T12:00:00.000Z',
    ...over,
  };
}

function renderMemory(): void {
  render(
    <MemoryRouter>
      <Memory />
    </MemoryRouter>,
  );
}

/** Drill: overview tile → life-area detail → single-insight detail (where the edit/correct controls live). */
async function openInsight(summary: string, area: RegExp): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: area }));
  await userEvent.click(await screen.findByRole('button', { name: `Open insight: ${summary}` }));
}

afterEach(() => {
  clearMockBridge();
  useInsightStore.setState({
    insights: [],
    outbound: { items: [] },
    loaded: false,
    lastReconciledAt: undefined,
    proposals: [],
  });
  usePeopleStore.setState({ people: [], loaded: false });
  useConversationStore.setState({ conversations: [] });
  useDreamStore.setState({ dreams: [], loaded: false });
  useSessionStore.setState({ activePerson: null });
});

describe('Memory overview', () => {
  it('shows the empty state explaining when insights appear, with a Start-a-session action', async () => {
    useSessionStore.setState({
      activePerson: activeP1,
      access: {
        roles: DEFAULT_ROLES,
        accounts: [{ personId: activeP1.id, roleId: 'member', hasPin: false }],
      },
    });
    installMockBridge({ insightsList: () => Promise.resolve([]) });
    renderMemory();
    expect(
      await screen.findByText(/what\s+SelfOS learns about you shows up here/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start a session/i })).toBeInTheDocument();
  });

  it('omits the Start-a-session action for a person who cannot own sessions', async () => {
    useSessionStore.setState({ activePerson: activeP1, access: null });
    installMockBridge({ insightsList: () => Promise.resolve([]) });
    renderMemory();
    await screen.findByText(/what\s+SelfOS learns about you shows up here/i);
    expect(screen.queryByRole('button', { name: /start a session/i })).not.toBeInTheDocument();
  });

  it('shows the portrait + a life-area tile map, and drills into an area then a single insight', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    useConversationStore.setState({ conversations: [] }); // cX missing → "source removed" in the detail
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'i1',
            approved: true,
            summary: 'Values steady routines',
            categories: ['Health & body'],
            confidence: 'high',
            confidenceRationale: 'echoed across 3 sessions',
            source: 'session',
            facts: [{ id: 'f1', text: 'Sleeps 8 hours', shareable: false }],
            provenance: { conversationId: 'cX', at: '2026-06-11T12:00:00.000Z' },
          }),
        ]),
    });
    renderMemory();
    // The overview shows the area as a TILE (its gist), not a full card.
    const tile = await screen.findByRole('button', { name: /^Health & body/ });
    expect(tile).toHaveTextContent('Values steady routines');
    // Drill in → the life-area detail heading, then the single insight.
    await userEvent.click(tile);
    expect(screen.getByRole('heading', { name: 'Health & body' })).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Open insight: Values steady routines' }),
    );
    // The insight detail carries the confidence + "source removed" provenance.
    expect(screen.getByLabelText(/High confidence — echoed across 3 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/original source removed/i)).toBeInTheDocument();
  });

  it('NEVER displays a related person’s shared facts raw — sharing is context, not display (54)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      peopleList: () => Promise.resolve([{ ...activeP1, id: 'p2', displayName: 'Sam' }]),
      insightsList: () =>
        Promise.resolve([
          insight({ id: 'own', summary: 'MY OWN NOTE' }),
          insight({
            id: 'rel',
            subjectPersonId: 'p2',
            summary: 'Sam summary',
            facts: [{ id: 'rf', text: 'Sam started a new job', shareable: true }],
          }),
        ]),
    });
    renderMemory();
    // The viewer's OWN insight surfaces (as the area tile's gist)…
    expect(await screen.findByText('MY OWN NOTE')).toBeInTheDocument();
    // …but a related person's shared fact is NEVER shown raw, anywhere in Memory.
    expect(screen.queryByText('Sam started a new job')).not.toBeInTheDocument();
    expect(screen.queryByText('About people you relate to')).not.toBeInTheDocument();
  });

  it('opens Needs your review from the callout and approves a draft', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    let current = insight({ id: 'd1', approved: false, summary: 'Wants more connection' });
    const approve = vi.fn(() => {
      current = { ...current, approved: true };
      return Promise.resolve(current);
    });
    installMockBridge({
      insightsList: () => Promise.resolve([current]),
      insightsApprove: approve,
    });
    renderMemory();
    // The slim callout announces the draft; opening Review shows it (in edit mode, summary in a textarea).
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(screen.getByRole('heading', { name: 'Needs your review' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Wants more connection')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(approve).toHaveBeenCalled();
  });

  it('marks an AI-inferred fact "not right about me" from the insight detail', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const flag = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'i1',
            source: 'session',
            summary: 'Dislikes mornings',
            provenance: { conversationId: 'c1', at: '2026-06-11T12:00:00.000Z' },
            facts: [{ id: 'f1', text: 'Dislikes mornings', shareable: false }],
          }),
        ]),
      insightsFlag: flag,
    });
    renderMemory();
    await openInsight('Dislikes mornings', /^Other/);
    await userEvent.click(screen.getByRole('button', { name: /This isn’t right about me/ }));
    expect(flag).toHaveBeenCalledWith({ insightId: 'i1', factId: 'f1', flagged: true });
  });

  it('shows Edit answer (no correction toggle) for an onboarding fact in the detail', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'p',
            source: 'intake',
            summary: 'Grew up in Ohio',
            provenance: { intakeSection: 'basics', at: '2026-06-11T12:00:00.000Z' },
            facts: [
              { id: 'f1', text: 'Grew up in Ohio', shareable: false, shareableTypes: ['partner'] },
            ],
          }),
        ]),
    });
    renderMemory();
    await openInsight('Grew up in Ohio', /^Other/);
    expect(screen.getByRole('button', { name: /Edit answer/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /This isn’t right about me/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('groups a long portrait into collapsible life-area sections; sensitive ones start collapsed', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const lifeAreaFact = (id: string, text: string, lifeArea: string, restricted = false) => ({
      id,
      text,
      shareable: false,
      lifeArea,
      ...(restricted ? { restricted: true } : {}),
    });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'p',
            source: 'intake',
            summary: 'A portrait.',
            provenance: { intakeSection: 'basics', at: '2026-06-11T12:00:00.000Z' },
            facts: [
              lifeAreaFact('1', 'Married to Ben', 'Relationships'),
              lifeAreaFact('2', 'Two kids', 'Family'),
              lifeAreaFact('3', 'Works in RevOps', 'Work & purpose'),
              lifeAreaFact('4', 'Has Hashimoto', 'Health & body'),
              lifeAreaFact('5', 'Core values: honesty', 'Values & beliefs'),
              lifeAreaFact('6', 'Career goal', 'Goals & growth'),
              lifeAreaFact('7', 'Atheist', 'Faith'),
              lifeAreaFact('8', 'Money anxiety', 'Money'),
              lifeAreaFact('9', 'Bisexual, monogamous', 'Intimacy', true),
            ],
          }),
        ]),
    });
    renderMemory();
    await openInsight('A portrait.', /^Other/);
    // Section headers render as expand/collapse buttons; a non-sensitive one is OPEN by default.
    expect(screen.getByRole('button', { name: /Relationships/ })).toBeInTheDocument();
    expect(screen.getByText('Works in RevOps')).toBeInTheDocument();
    // The sensitive (restricted) Intimacy section is COLLAPSED by default.
    expect(screen.queryByText('Bisexual, monogamous')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Intimacy/ }));
    expect(screen.getByText('Bisexual, monogamous')).toBeInTheDocument();
  });

  it('opens "responses to your questionnaires" from its tile, grouped by recipient (#129)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    usePeopleStore.setState({
      people: [activeP1, { ...activeP1, id: 'p2', displayName: 'Angel' }],
      loaded: true,
    });
    installMockBridge({
      peopleList: () =>
        Promise.resolve([activeP1, { ...activeP1, id: 'p2', displayName: 'Angel' }]),
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'resp-hh',
            source: 'questionnaire',
            summary: 'Angel wants more protected time together',
            categories: ['Relationships'],
            provenance: { assignmentId: 'a1', aboutPersonId: 'p2', at: '2026-06-11T12:00:00.000Z' },
          }),
          insight({
            id: 'resp-ext',
            source: 'questionnaire',
            summary: 'Sam gave candid feedback',
            categories: ['Work & purpose'],
            provenance: { assignmentId: 'a2', aboutName: 'Sam', at: '2026-06-11T12:00:00.000Z' },
          }),
          insight({
            id: 'own',
            source: 'session',
            summary: 'Values steady routines',
            categories: ['Health & body'],
            provenance: { conversationId: 'c1', at: '2026-06-11T12:00:00.000Z' },
          }),
        ]),
    });
    renderMemory();
    // Responses are NOT life-area tiles; they sit behind their own tile → view, grouped by recipient.
    await userEvent.click(
      await screen.findByRole('button', { name: /From questionnaires you sent/ }),
    );
    expect(
      screen.getByRole('heading', { name: 'Responses to your questionnaires' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Angel' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sam' })).toBeInTheDocument();
    // Opening one shows the "From Angel’s answers" eyebrow (never "About you").
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Open insight: Angel wants more protected time together',
      }),
    );
    expect(screen.getByText(/From Angel’s answers/)).toBeInTheDocument();
  });

  it('search surfaces matching insights as rows', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({ id: 'i1', summary: 'Loves hiking outdoors' }),
          insight({ id: 'i2', summary: 'Prefers quiet evenings' }),
        ]),
    });
    renderMemory();
    await screen.findByRole('button', { name: /^Other/ });
    await userEvent.type(screen.getByLabelText('Search memory'), 'hiking');
    expect(
      screen.getByRole('button', { name: 'Open insight: Loves hiking outdoors' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open insight: Prefers quiet evenings' }),
    ).not.toBeInTheDocument();
  });

  it('shows a merge proposal in the review view and confirms it + the kept-tidy signal', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const resolve = vi.fn(() => Promise.resolve());
    installMockBridge({
      insightsList: () => Promise.resolve([insight({ id: 'i1' })]),
      memoryReconcileState: () =>
        Promise.resolve({
          lastReconciledAt: new Date().toISOString(),
          proposals: [
            {
              id: 'mp1',
              schemaVersion: 1,
              subjectPersonId: 'p1',
              fromId: 'a',
              intoId: 'b',
              fromSummary: 'Loves the outdoors',
              intoSummary: 'Values nature',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      memoryResolveProposal: resolve,
    });
    renderMemory();
    expect(await screen.findByText(/Memory last tidied/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText(/combine them into one/)).toBeInTheDocument();
    expect(screen.getByText('· Values nature')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(resolve).toHaveBeenCalledWith({ proposalId: 'mp1', action: 'merge' });
  });

  it('runs Refresh memory and shows the calm AI-off note', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const refresh = vi.fn(() => Promise.resolve({ ok: false, reason: 'AI_OFF' as const }));
    installMockBridge({
      insightsList: () => Promise.resolve([insight({ id: 'i1' })]),
      memoryRefresh: refresh,
    });
    renderMemory();
    await userEvent.click(await screen.findByRole('button', { name: /Refresh/ }));
    expect(refresh).toHaveBeenCalled();
    expect(
      await screen.findByText(/ask the person who set up this household/i),
    ).toBeInTheDocument();
  });
});
