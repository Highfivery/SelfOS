import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Goal } from '@shared/schemas';
import { GoalFollowupCard } from './GoalFollowupCard';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useGoalStore } from '../../../stores/goalStore';

afterEach(() => {
  clearMockBridge();
  useGoalStore.getState().reset();
});

const daysAgo = (n: number): string => new Date(Date.now() - n * 86400000).toISOString();

function staleGoal(id: string, text: string): Goal {
  return {
    id,
    schemaVersion: 1,
    subjectPersonId: 'p1',
    text,
    status: 'open',
    provenance: { at: daysAgo(40) },
    createdAt: daysAgo(40),
    updatedAt: daysAgo(40),
    lastTouchedAt: daysAgo(40),
  };
}

function renderCard(): void {
  render(
    <MemoryRouter>
      <GoalFollowupCard />
    </MemoryRouter>,
  );
}

describe('GoalFollowupCard (40 §3.2)', () => {
  it('shows the stalest goal with the three calm actions', () => {
    installMockBridge();
    useGoalStore.setState({ goals: [staleGoal('g1', 'finish the deck')], loaded: true });
    renderCard();
    expect(screen.getByText('finish the deck')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /still on it/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark done/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /let it go/i })).toBeInTheDocument();
  });

  it('Mark done sets the goal status through the bridge', async () => {
    const setStatus = vi.fn(() => Promise.resolve(null));
    installMockBridge({ goalsSetStatus: setStatus, goalsList: () => Promise.resolve([]) });
    useGoalStore.setState({ goals: [staleGoal('g1', 'finish the deck')], loaded: true });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: /mark done/i }));
    expect(setStatus).toHaveBeenCalledWith({ goalId: 'g1', status: 'done' });
  });

  it('self-hides when nothing is stale', () => {
    installMockBridge();
    useGoalStore.setState({
      goals: [{ ...staleGoal('g1', 'fresh'), lastTouchedAt: daysAgo(1) }],
      loaded: true,
    });
    renderCard();
    expect(screen.queryByText('fresh')).toBeNull();
  });
});
