import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AgreementSummary, Goal } from '@shared/schemas';
import { Goals } from './Goals';
import { useGoalStore } from '../../../stores/goalStore';
import { useTogetherStore } from '../../../stores/togetherStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

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

function renderGoals(): void {
  render(
    <MemoryRouter>
      <Goals />
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useGoalStore.setState({ goals: [], loaded: false });
  useTogetherStore.getState().reset();
});

function doneCommitment(): AgreementSummary {
  return {
    partnerPersonId: 'angel',
    partnerName: 'Angel',
    agreement: {
      id: 'ac1',
      schemaVersion: 1,
      pairKey: 'angel~ben',
      text: 'Screen-free dinners',
      status: 'done',
      provenance: { sessionId: 'sess-1', at: '2026-07-01T00:00:00.000Z' },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    },
  };
}

describe('Goals page', () => {
  it('renders active goals with status, and marks a goal done', async () => {
    const setStatus = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      goalsList: () =>
        Promise.resolve([goal({ id: 'g1', text: 'Finish the thesis', status: 'open' })]),
      goalsSetStatus: setStatus,
    });
    renderGoals();
    expect(await screen.findByRole('heading', { name: /Goals & commitments/ })).toBeInTheDocument();
    expect(screen.getByText('Finish the thesis')).toBeInTheDocument();
    const setStatusSelect = screen.getByRole('combobox', {
      name: /Set status for: Finish the thesis/,
    });
    expect(setStatusSelect).toHaveValue('open');

    await userEvent.selectOptions(setStatusSelect, 'done');
    expect(setStatus).toHaveBeenCalledWith({ goalId: 'g1', status: 'done' });
  });

  it('shows the gentle stale prompt for a goal past its due date', async () => {
    installMockBridge({
      goalsList: () =>
        Promise.resolve([
          goal({ id: 'g1', text: 'Call the dentist', status: 'open', due: '2000-01-01' }),
        ]),
    });
    renderGoals();
    expect(await screen.findByText(/still working on it/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Still on it' })).toBeInTheDocument();
    expect(screen.getByText('Open a while')).toBeInTheDocument(); // the derived stale chip
  });

  it('shows the warm empty hint when there are no goals', async () => {
    installMockBridge({ goalsList: () => Promise.resolve([]) });
    renderGoals();
    expect(
      await screen.findByText(/Goals you mention in sessions show up here/),
    ).toBeInTheDocument();
  });

  it('folds completed & closed goals into a collapsible history', async () => {
    installMockBridge({
      goalsList: () =>
        Promise.resolve([
          goal({ id: 'g1', text: 'Ship the redesign', status: 'inProgress' }),
          goal({ id: 'g2', text: 'Old finished goal', status: 'done' }),
        ]),
    });
    renderGoals();
    expect(await screen.findByText('Ship the redesign')).toBeInTheDocument();
    expect(screen.getByText(/Completed & closed \(1\)/)).toBeInTheDocument();
  });

  it('includes completed Together commitments in the "Completed & closed" history (user request 2026-07-15)', async () => {
    installMockBridge({
      goalsList: () =>
        Promise.resolve([goal({ id: 'g2', text: 'Old finished goal', status: 'done' })]),
      togetherDoneCommitments: () => Promise.resolve([doneCommitment()]),
    });
    renderGoals();
    // The count folds in the completed commitment alongside the closed goal (1 goal + 1 commitment = 2).
    expect(await screen.findByText(/Completed & closed \(2\)/)).toBeInTheDocument();
    expect(screen.getByText('Screen-free dinners')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reopen/ })).toBeInTheDocument();
  });

  it('shows the closed history even with NO personal goals, when a commitment was completed', async () => {
    installMockBridge({
      goalsList: () => Promise.resolve([]),
      togetherDoneCommitments: () => Promise.resolve([doneCommitment()]),
    });
    renderGoals();
    // No goals + a completed commitment → the closed history shows it (not the "no goals" empty hint).
    expect(await screen.findByText(/Completed & closed \(1\)/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Goals you mention in sessions show up here/),
    ).not.toBeInTheDocument();
  });
});
