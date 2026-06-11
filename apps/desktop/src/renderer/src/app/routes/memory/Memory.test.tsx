import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Insight } from '@shared/schemas';
import { Memory } from './Memory';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useInsightStore.setState({ insights: [], loaded: false });
  usePeopleStore.setState({ people: [], loaded: false });
});

function draftInsight(over: Partial<Insight> = {}): Insight {
  return {
    id: 'i1',
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: 'p1',
    summary: 'They want more connection.',
    facts: [
      { id: 'f1', text: 'Wants more date nights', shareable: false },
      { id: 'f2', text: 'Feels distant', shareable: false },
    ],
    confidence: 'high',
    approved: false,
    provenance: { assignmentId: 'a1', at: '2026-06-11T12:00:00.000Z' },
    createdAt: '2026-06-11T12:00:00.000Z',
    updatedAt: '2026-06-11T12:00:00.000Z',
    ...over,
  };
}

describe('Memory', () => {
  it('shows the empty state when there are no insights', async () => {
    installMockBridge({ insightsList: () => Promise.resolve([]) });
    render(<Memory />);
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it('reviews a draft and approves it with the chosen shareable facts', async () => {
    // Stateful: the list reflects approval, so the card can collapse to its read view afterward.
    let current = draftInsight();
    const approve = vi.fn(
      (input: { facts?: { id: string; text: string; shareable: boolean }[] }) => {
        current = { ...current, approved: true, ...(input.facts ? { facts: input.facts } : {}) };
        return Promise.resolve(current);
      },
    );
    installMockBridge({
      insightsList: () => Promise.resolve([current]),
      insightsApprove: approve,
      peopleList: () =>
        Promise.resolve([
          {
            id: 'p1',
            schemaVersion: 1,
            displayName: 'Ben',
            isSubject: true,
            tags: [],
            createdAt: 'now',
            updatedAt: 'now',
          },
        ]),
    });
    render(<Memory />);

    // The draft opens in review mode, addressed to the subject person.
    expect(await screen.findByText(/About Ben/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting your review/i)).toBeInTheDocument();

    // Mark the first fact shareable, then Approve.
    await userEvent.click(screen.getByLabelText('Wants more date nights — shareable'));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectPersonId: 'p1',
        id: 'i1',
        facts: expect.arrayContaining([expect.objectContaining({ id: 'f1', shareable: true })]),
      }),
    );
    // Once approved, the card collapses to the read view (Approve gone, Edit shown).
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('leads a crisis-flagged insight with concern + resources', async () => {
    installMockBridge({
      insightsList: () => Promise.resolve([draftInsight({ crisisFlag: true })]),
    });
    render(<Memory />);
    expect(await screen.findByText(/may indicate distress/i)).toBeInTheDocument();
    expect(screen.getByText(/988/)).toBeInTheDocument();
  });
});
