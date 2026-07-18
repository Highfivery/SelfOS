import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Insight } from '@shared/schemas';
import { MemoryReview } from './MemoryReview';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
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
    source: 'session',
    subjectPersonId: 'p1',
    summary: `summary-${over.id}`,
    facts: [],
    confidence: 'medium',
    categories: ['Other'],
    approved: false,
    provenance: { conversationId: 'c1', at: '2026-06-11T12:00:00.000Z' },
    createdAt: '2026-06-11T12:00:00.000Z',
    updatedAt: '2026-06-11T12:00:00.000Z',
    ...over,
  };
}

function renderReview(): void {
  render(
    <MemoryRouter initialEntries={['/memory/review']}>
      <MemoryReview />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  clearMockBridge();
  useInsightStore.setState({
    insights: [],
    outbound: { items: [] },
    loaded: false,
    lastReconciledAt: undefined,
    proposals: [],
  });
  usePeopleStore.setState({ people: [], loaded: false });
  useSessionStore.setState({ activePerson: null });
});

describe('MemoryReview — the dedicated one-at-a-time review screen (65 §3.3)', () => {
  it('shows the focused header + a back-to-Memory affordance', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([insight({ id: 'd1', summary: 'Wants more connection' })]),
    });
    renderReview();
    expect(await screen.findByRole('heading', { name: 'Review new insights' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Memory/ })).toBeInTheDocument();
    expect(screen.getByText('Wants more connection')).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 to review/)).toBeInTheDocument();
  });

  it('Keep & save approves the draft (with its edits)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const approve = vi.fn((input: unknown) => Promise.resolve(input as Insight));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([insight({ id: 'd1', summary: 'Wants more connection' })]),
      insightsApprove: approve,
    });
    renderReview();
    await userEvent.click(await screen.findByRole('button', { name: 'Keep & save' }));
    expect(approve).toHaveBeenCalled();
  });

  it('drops a fact with "not right" before keeping; the approve edit omits it', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const approve = vi.fn((input: unknown) => Promise.resolve(input as Insight));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'd1',
            summary: 'S',
            facts: [
              { id: 'f1', text: 'Keep me', shareable: false, shareableTypes: ['partner'] },
              { id: 'f2', text: 'Wrong one', shareable: false, shareableTypes: ['partner'] },
            ],
          }),
        ]),
      insightsApprove: approve,
    });
    renderReview();
    await userEvent.click(
      await screen.findByRole('button', { name: /not right — drop: Wrong one/i }),
    );
    expect(screen.queryByText('Wrong one')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep & save' }));
    const [arg] = approve.mock.calls[0] ?? [];
    const facts = (arg as { facts: { id: string }[] } | undefined)?.facts ?? [];
    expect(facts.map((f) => f.id)).toEqual(['f1']);
  });

  it('the share chip cycles a fact scope; Keep & save carries it (local until then)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const approve = vi.fn((input: unknown) => Promise.resolve(input as Insight));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'd1',
            summary: 'S',
            facts: [
              { id: 'f1', text: 'Likes trail runs', shareable: false, shareableTypes: ['partner'] },
            ],
          }),
        ]),
      insightsApprove: approve,
    });
    renderReview();
    await userEvent.click(await screen.findByRole('button', { name: /Sharing for .*: Partner/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep & save' }));
    const [arg] = approve.mock.calls[0] ?? [];
    const facts =
      (arg as { facts: { id: string; shareableTypes?: string[] }[] } | undefined)?.facts ?? [];
    expect(facts.find((f) => f.id === 'f1')?.shareableTypes).toContain('parent');
  });

  it('a merge proposal offers Merge / Keep both / Discard new', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const resolveProposal = vi.fn(() => Promise.resolve());
    installMockBridge({
      insightsList: () => Promise.resolve([]),
      memoryReconcileState: () =>
        Promise.resolve({
          proposals: [
            {
              id: 'mp1',
              schemaVersion: 1,
              subjectPersonId: 'p1',
              fromId: 'a',
              intoId: 'b',
              fromSummary: 'Likes hiking',
              intoSummary: 'Enjoys hiking',
              createdAt: '2026-06-11T12:00:00.000Z',
            },
          ],
        }),
      memoryResolveProposal: resolveProposal,
    });
    renderReview();
    expect(await screen.findByText('Likes hiking')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep both' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard new' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Merge into one' }));
    expect(resolveProposal).toHaveBeenCalledWith({ proposalId: 'mp1', action: 'merge' });
  });

  it('a restricted draft fact gets NO share chip — it stays own-only', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const approve = vi.fn((input: unknown) => Promise.resolve(input as Insight));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'd1',
            source: 'intake',
            summary: 'A private matter',
            provenance: { intakeSection: 'basics', at: '2026-06-11T12:00:00.000Z' },
            facts: [{ id: 'f1', text: 'A sensitive detail', shareable: false, restricted: true }],
          }),
        ]),
      insightsApprove: approve,
    });
    renderReview();
    expect(await screen.findByText('private')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sharing for/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep & save' }));
    const [arg] = approve.mock.calls[0] ?? [];
    const facts =
      (arg as { facts: { id: string; shareableTypes?: string[] }[] } | undefined)?.facts ?? [];
    expect(facts.find((f) => f.id === 'f1')).not.toHaveProperty('shareableTypes');
  });

  it('an empty queue shows "all caught up" + a Done that returns to Memory', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({ insightsList: () => Promise.resolve([]) });
    renderReview();
    expect(await screen.findByText(/All caught up/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});
