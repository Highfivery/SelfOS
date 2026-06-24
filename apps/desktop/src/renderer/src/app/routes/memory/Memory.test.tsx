import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Goal, Insight } from '@shared/schemas';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { Memory } from './Memory';
import { useInsightStore } from '../../../stores/insightStore';
import { useGoalStore } from '../../../stores/goalStore';
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

function goal(over: Partial<Goal> & { id: string; text: string }): Goal {
  return {
    schemaVersion: 1,
    subjectPersonId: 'p1',
    status: 'open',
    provenance: { conversationId: 'c1', at: '2026-06-11T12:00:00.000Z' },
    createdAt: '2026-06-11T12:00:00.000Z',
    updatedAt: '2026-06-11T12:00:00.000Z',
    ...over,
  };
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
  useGoalStore.setState({ goals: [], loaded: false });
  usePeopleStore.setState({ people: [], loaded: false });
  useConversationStore.setState({ conversations: [] });
  useDreamStore.setState({ dreams: [], loaded: false });
  useSessionStore.setState({ activePerson: null });
});

describe('Memory dashboard', () => {
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
      await screen.findByText(/Insights appear here after your sessions/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Memory' })).toBeInTheDocument();
    // A member can own sessions → the gated next action shows.
    expect(screen.getByRole('button', { name: /start a session/i })).toBeInTheDocument();
  });

  it('omits the Start-a-session action for a person who cannot own sessions', async () => {
    useSessionStore.setState({ activePerson: activeP1, access: null }); // no role → can('sessions.own') false
    installMockBridge({ insightsList: () => Promise.resolve([]) });
    renderMemory();
    expect(
      await screen.findByText(/Insights appear here after your sessions/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start a session/i })).not.toBeInTheDocument();
  });

  it('puts a draft in "Needs your review" and approves it', async () => {
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
    expect(await screen.findByText('Needs your review')).toBeInTheDocument();
    expect(screen.getByText('Wants more connection')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(approve).toHaveBeenCalled();
  });

  it('groups an approved own insight by life-area with confidence + provenance', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    useConversationStore.setState({ conversations: [] }); // no matching conversation → "source removed"
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
            provenance: { conversationId: 'cX', at: '2026-06-11T12:00:00.000Z' },
          }),
        ]),
    });
    renderMemory();
    expect(await screen.findByText('Values steady routines')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Health & body/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/High confidence — echoed across 3 sessions/)).toBeInTheDocument();
    // The session's source is gone (no matching conversation) → "original source removed".
    expect(screen.getByText(/original source removed/i)).toBeInTheDocument();
  });

  it('renders a related person’s shared facts read-only (no edit) under their section', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      peopleList: () => Promise.resolve([{ ...activeP1, id: 'p2', displayName: 'Sam' }]),
      insightsList: () =>
        Promise.resolve([
          insight({ id: 'own', summary: 'MY OWN NOTE' }),
          insight({
            id: 'rel',
            subjectPersonId: 'p2',
            summary: '',
            facts: [{ id: 'rf', text: 'Sam started a new job', shareable: true }],
          }),
        ]),
    });
    renderMemory();
    expect(await screen.findByText('About people you relate to')).toBeInTheDocument();
    expect(screen.getByText('Sam started a new job')).toBeInTheDocument();
    expect(screen.getByText(/About Sam/)).toBeInTheDocument();
    // A related card is read-only — no Edit button for it (only the own insight has one).
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });

  it('marks an AI-inferred fact "not right about me"', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const flag = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          // A session insight = AI-inferred → keeps the relabelled correction toggle.
          insight({
            id: 'i1',
            source: 'session',
            provenance: { conversationId: 'c1', at: '2026-06-11T12:00:00.000Z' },
            facts: [{ id: 'f1', text: 'Dislikes mornings', shareable: false }],
          }),
        ]),
      insightsFlag: flag,
    });
    renderMemory();
    await userEvent.click(await screen.findByRole('button', { name: /This isn’t right about me/ }));
    expect(flag).toHaveBeenCalledWith({ insightId: 'i1', factId: 'f1', flagged: true });
  });

  it('shows Edit answer + Delete (no correction toggle) for an onboarding fact', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'p',
            source: 'intake',
            provenance: { intakeSection: 'basics', at: '2026-06-11T12:00:00.000Z' },
            facts: [
              { id: 'f1', text: 'Grew up in Ohio', shareable: false, shareableTypes: ['partner'] },
            ],
          }),
        ]),
    });
    renderMemory();
    expect(await screen.findByRole('button', { name: /Edit answer/ })).toBeInTheDocument();
    // Onboarding facts are what you told SelfOS — no "this isn't right" toggle, no plain "Edit".
    expect(
      screen.queryByRole('button', { name: /This isn’t right about me/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    // Clean cards (44 audit): NO per-fact sharing chip/picker on the card — sharing lives in "Manage sharing".
    expect(screen.queryByRole('button', { name: /activate to change/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Set by your onboarding answer/)).not.toBeInTheDocument();
  });

  it('shows a restricted onboarding fact with a minimal "sensitive" tag, no sharing control', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'p',
            source: 'intake',
            provenance: { intakeSection: 'weighs', at: '2026-06-11T12:00:00.000Z' },
            facts: [{ id: 'f1', text: 'Carries grief', shareable: false, restricted: true }],
          }),
        ]),
    });
    renderMemory();
    // A restricted onboarding fact keeps a small informational "private" tag (own-coaching-only) — but no
    // sharing control on the card (44 audit); sharing is managed in one place.
    expect(await screen.findByText('private')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /activate to change/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Share with someone/ })).not.toBeInTheDocument();
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
    // Section headers render as expand/collapse buttons.
    expect(await screen.findByRole('button', { name: /Relationships/ })).toBeInTheDocument();
    // A non-sensitive section is OPEN by default → its fact is visible.
    expect(screen.getByText('Works in RevOps')).toBeInTheDocument();
    // The sensitive (restricted) Intimacy section is COLLAPSED by default → its fact is NOT rendered yet.
    expect(screen.queryByText('Bisexual, monogamous')).not.toBeInTheDocument();
    // Expanding it reveals the fact.
    await userEvent.click(screen.getByRole('button', { name: /Intimacy/ }));
    expect(screen.getByText('Bisexual, monogamous')).toBeInTheDocument();
  });

  it('filters by search', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({ id: 'i1', summary: 'Loves hiking outdoors' }),
          insight({ id: 'i2', summary: 'Prefers quiet evenings' }),
        ]),
    });
    renderMemory();
    expect(await screen.findByText('Loves hiking outdoors')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search memory'), 'hiking');
    expect(screen.getByText('Loves hiking outdoors')).toBeInTheDocument();
    expect(screen.queryByText('Prefers quiet evenings')).not.toBeInTheDocument();
  });

  it('renders the Goals section with status, and marks a goal done (moving it to closed)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const setStatus = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      insightsList: () => Promise.resolve([insight({ id: 'i1' })]),
      goalsList: () =>
        Promise.resolve([goal({ id: 'g1', text: 'Finish the thesis', status: 'open' })]),
      goalsSetStatus: setStatus,
    });
    renderMemory();
    expect(await screen.findByRole('heading', { name: /Goals & commitments/ })).toBeInTheDocument();
    expect(screen.getByText('Finish the thesis')).toBeInTheDocument();
    const setStatusSelect = screen.getByRole('combobox', {
      name: /Set status for: Finish the thesis/,
    });
    expect(setStatusSelect).toHaveValue('open'); // the goal reads Open

    await userEvent.selectOptions(setStatusSelect, 'done');
    expect(setStatus).toHaveBeenCalledWith({ goalId: 'g1', status: 'done' });
  });

  it('shows the gentle stale prompt for a goal past its due date', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () => Promise.resolve([insight({ id: 'i1' })]),
      goalsList: () =>
        Promise.resolve([
          goal({ id: 'g1', text: 'Call the dentist', status: 'open', due: '2000-01-01' }),
        ]),
    });
    renderMemory();
    expect(await screen.findByText(/still working on it/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Still on it' })).toBeInTheDocument();
    expect(screen.getByText('Open a while')).toBeInTheDocument(); // the derived stale chip
  });

  it('shows the warm Goals empty hint when there are insights but no goals', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () => Promise.resolve([insight({ id: 'i1' })]),
      goalsList: () => Promise.resolve([]),
    });
    renderMemory();
    expect(
      await screen.findByText(/Goals you mention in sessions show up here/),
    ).toBeInTheDocument();
  });

  it('shows a merge proposal in Needs your review and confirms it + the kept-tidy signal', async () => {
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
    // No role/access set on the session store, so the role-aware note falls to the safer member copy.
    expect(
      await screen.findByText(/ask the person who set up this household/i),
    ).toBeInTheDocument();
  });
});
