import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AgreementSummary, Goal } from '@shared/schemas';
import { GoalsCard } from './GoalsCard';
import { useGoalStore } from '../../../stores/goalStore';
import { useTogetherStore } from '../../../stores/togetherStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

function commitment(text: string): AgreementSummary {
  return {
    partnerPersonId: 'angel',
    partnerName: 'Angel',
    agreement: {
      id: 'a1',
      schemaVersion: 1,
      pairKey: 'angel~me',
      text,
      status: 'standing',
      provenance: { sessionId: 's1', at: 'now' },
      createdAt: 'now',
      updatedAt: 'now',
    },
  };
}

const goal = (over: Partial<Goal> & { id: string; text: string }): Goal => ({
  schemaVersion: 1,
  subjectPersonId: 'me',
  status: 'open',
  provenance: { at: 'now' },
  createdAt: 'now',
  updatedAt: 'now',
  ...over,
});

function renderCard(props: { configured?: boolean; crisis?: boolean } = {}): void {
  render(
    <MemoryRouter>
      <GoalsCard configured={props.configured ?? true} crisis={props.crisis ?? false} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  useGoalStore.getState().reset();
  useTogetherStore.getState().reset();
  clearMockBridge();
});

describe('GoalsCard (60 §3.1.3)', () => {
  it('invites a first goal when there are none', () => {
    installMockBridge();
    useGoalStore.setState({ goals: [], loaded: true });
    renderCard();
    expect(screen.getByRole('heading', { name: /goals/i })).toBeInTheDocument();
    expect(screen.getByText(/set a goal you want to move toward/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new goal/i })).toBeInTheDocument();
  });

  it('shows Together commitments (text + partner) with a one-tap mark done (spec 61)', async () => {
    const setStatus = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      togetherSetAgreementStatus: setStatus,
      togetherMyAgreements: () => Promise.resolve([commitment('Weekly date night')]),
    });
    useGoalStore.setState({ goals: [], loaded: true });
    useTogetherStore.setState({ myAgreements: [commitment('Weekly date night')] });
    renderCard();

    expect(screen.getByText('Together commitments')).toBeInTheDocument();
    expect(screen.getByText('Weekly date night')).toBeInTheDocument();
    expect(screen.getByText('Angel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark done: Weekly date night' }));
    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith({
        partnerPersonId: 'angel',
        agreementId: 'a1',
        status: 'done',
      }),
    );
  });

  it('shows a completion bar + the top goal with one-tap Done / Still on it', async () => {
    const setStatus = vi.fn(() => Promise.resolve(null));
    installMockBridge({ goalsSetStatus: setStatus, goalsList: () => Promise.resolve([]) });
    useGoalStore.setState({
      goals: [
        goal({ id: 'g1', text: 'Write every morning', due: '2026-06-01' }), // overdue → stale, surfaces first
        goal({ id: 'g2', text: 'read more', status: 'done' }),
      ],
      loaded: true,
    });
    renderCard();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument(); // the completion figure
    expect(screen.getByText('Write every morning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mark .*write every morning.* done/i }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith({ goalId: 'g1', status: 'done' }));
  });

  it('creates a new goal inline', async () => {
    const create = vi.fn(() => Promise.resolve(null));
    installMockBridge({ goalsCreate: create, goalsList: () => Promise.resolve([]) });
    useGoalStore.setState({ goals: [], loaded: true });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /new goal/i }));
    fireEvent.change(screen.getByLabelText(/new goal/i), {
      target: { value: 'Stretch for ten minutes' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add goal/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Stretch for ten minutes' }),
      ),
    );
  });

  it('suggests goals on tap and adds one that is accepted (AI configured)', async () => {
    const create = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      goalsCreate: create,
      goalsList: () => Promise.resolve([]),
      goalsSuggest: () =>
        Promise.resolve({
          ok: true,
          suggestions: [{ text: 'Call your sister this week', rationale: 'You miss her' }],
        }),
    });
    useGoalStore.setState({ goals: [goal({ id: 'g1', text: 'existing' })], loaded: true });
    renderCard({ configured: true });
    fireEvent.click(screen.getByRole('button', { name: /suggest goals/i }));
    expect(await screen.findByText('Call your sister this week')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add .*call your sister/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Call your sister this week' }),
      ),
    );
  });

  it('hides the completion bar + AI suggest during a crisis, keeping the calm list (§8)', () => {
    installMockBridge();
    useGoalStore.setState({
      goals: [
        goal({
          id: 'g1',
          text: 'be gentle with yourself',
          lastTouchedAt: new Date().toISOString(),
        }),
      ],
      loaded: true,
    });
    renderCard({ configured: true, crisis: true });
    expect(screen.queryByText(/of .* done/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /suggest goals/i })).toBeNull();
    expect(screen.getByText('be gentle with yourself')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new goal/i })).toBeInTheDocument();
  });

  it('hides AI suggest when AI is not configured', () => {
    installMockBridge();
    useGoalStore.setState({ goals: [goal({ id: 'g1', text: 'x' })], loaded: true });
    renderCard({ configured: false });
    expect(screen.queryByRole('button', { name: /suggest goals/i })).toBeNull();
    expect(screen.getByRole('button', { name: /new goal/i })).toBeInTheDocument();
  });
});
