import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Goal, Insight } from '@shared/schemas';
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
  useInsightStore.setState({ insights: [], loaded: false });
  useGoalStore.setState({ goals: [], loaded: false });
  usePeopleStore.setState({ people: [], loaded: false });
  useConversationStore.setState({ conversations: [] });
  useDreamStore.setState({ dreams: [], loaded: false });
  useSessionStore.setState({ activePerson: null });
});

describe('Memory dashboard', () => {
  it('shows the empty state when there are no insights', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({ insightsList: () => Promise.resolve([]) });
    renderMemory();
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Memory' })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'Health & body' })).toBeInTheDocument();
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

  it('flags a fact as inaccurate', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const flag = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({ id: 'i1', facts: [{ id: 'f1', text: 'Dislikes mornings', shareable: false }] }),
        ]),
      insightsFlag: flag,
    });
    renderMemory();
    await userEvent.click(
      await screen.findByRole('button', { name: /Flag as inaccurate: Dislikes mornings/ }),
    );
    expect(flag).toHaveBeenCalledWith({ insightId: 'i1', factId: 'f1', flagged: true });
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
    expect(await screen.findByText(/Turn on AI in Settings/)).toBeInTheDocument();
  });
});
