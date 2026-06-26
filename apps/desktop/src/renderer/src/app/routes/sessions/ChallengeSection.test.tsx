import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Challenge } from '@shared/channels';
import { ChallengeSection } from './ChallengeSection';
import { useChallengeStore } from '../../../stores/challengeStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

function challenge(over: Partial<Challenge> = {}): Challenge {
  return {
    id: 'ch1',
    schemaVersion: 1,
    subjectPersonId: 'p1',
    action: 'Strike up one conversation with a stranger this week',
    status: 'active',
    comfort: 3,
    lifeArea: 'Relationships',
    provenance: { conversationId: 'c1', at: '2026-06-26T00:00:00.000Z' },
    agreedAt: '2026-06-26T00:00:00.000Z',
    checkInAt: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z',
    ...over,
  };
}

function seed(challenges: Challenge[]): void {
  useChallengeStore.setState({ challenges, suggestion: null, loaded: true });
}

afterEach(() => {
  clearMockBridge();
  useChallengeStore.getState().reset();
  vi.restoreAllMocks();
});

describe('ChallengeSection', () => {
  it('invites a challenge with a domain chooser when there is none active', () => {
    installMockBridge();
    seed([]);
    render(
      <ChallengeSection
        adultAcknowledged={false}
        onStartChallenge={() => {}}
        onTalkItThrough={() => {}}
      />,
    );
    expect(screen.getByText(/Ready to stretch a little/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Surprise me' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build a habit' })).toBeInTheDocument();
    // The intimacy domain is hidden until the 18+ ack (§8.3).
    expect(screen.queryByRole('button', { name: 'Intimacy' })).not.toBeInTheDocument();
  });

  it('shows the intimacy domain once the 18+ ack is present', () => {
    installMockBridge();
    seed([]);
    render(
      <ChallengeSection adultAcknowledged onStartChallenge={() => {}} onTalkItThrough={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Intimacy' })).toBeInTheDocument();
  });

  it('starts a domain-seeded challenge on click', async () => {
    installMockBridge();
    seed([]);
    const onStart = vi.fn();
    render(
      <ChallengeSection adultAcknowledged onStartChallenge={onStart} onTalkItThrough={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Build a habit' }));
    expect(onStart).toHaveBeenCalledWith('habit');
  });

  it('renders the active challenge with status chip, comfort, and the inline check-in', async () => {
    installMockBridge();
    const checkIn = vi.fn(() =>
      Promise.resolve({ ok: true as const, challenge: challenge({ status: 'done' }) }),
    );
    window.selfos!.challengesCheckIn = checkIn;
    seed([challenge()]);
    render(
      <ChallengeSection adultAcknowledged onStartChallenge={() => {}} onTalkItThrough={() => {}} />,
    );
    expect(
      screen.getByText('Strike up one conversation with a stranger this week'),
    ).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument(); // the status chip label
    // "I did it" records a check-in.
    await userEvent.click(screen.getByRole('button', { name: 'I did it' }));
    expect(checkIn).toHaveBeenCalledWith(
      expect.objectContaining({ challengeId: 'ch1', outcome: 'did' }),
    );
  });

  it('Reflect opens an outcome form with a note', async () => {
    installMockBridge();
    const checkIn = vi.fn(() =>
      Promise.resolve({ ok: true as const, challenge: challenge({ status: 'done' }) }),
    );
    window.selfos!.challengesCheckIn = checkIn;
    seed([challenge()]);
    render(
      <ChallengeSection adultAcknowledged onStartChallenge={() => {}} onTalkItThrough={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reflect' }));
    await userEvent.type(screen.getByLabelText('Your reflection'), 'it went okay');
    await userEvent.click(screen.getByRole('button', { name: 'Partly' }));
    expect(checkIn).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: 'ch1',
        outcome: 'partly',
        reflection: 'it went okay',
      }),
    );
  });

  it('offers to seed a Goal after a successful check-in (§11 Q6 — confirm-before-create)', async () => {
    installMockBridge();
    const checkIn = vi.fn(() =>
      Promise.resolve({ ok: true as const, challenge: challenge({ status: 'done' }) }),
    );
    const seedGoal = vi.fn(() => Promise.resolve(challenge({ seededGoalId: 'g1' })));
    window.selfos!.challengesCheckIn = checkIn;
    window.selfos!.challengesSeedGoal = seedGoal;
    seed([challenge()]);
    render(
      <ChallengeSection adultAcknowledged onStartChallenge={() => {}} onTalkItThrough={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'I did it' }));
    expect(screen.getByText(/make this an ongoing goal/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make it a goal' }));
    expect(seedGoal).toHaveBeenCalledWith({ challengeId: 'ch1' });
    expect(screen.getByText(/Added to your ongoing goals/i)).toBeInTheDocument();
  });

  it('hides "Talk it through" for a sexual challenge (the inline restricted path only, §8.4)', () => {
    installMockBridge();
    seed([challenge({ adult: true, lifeArea: 'Intimacy' })]);
    render(
      <ChallengeSection adultAcknowledged onStartChallenge={() => {}} onTalkItThrough={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Talk it through' })).not.toBeInTheDocument();
  });

  it('folds closed challenges into a "Past challenges" affordance', () => {
    installMockBridge();
    seed([challenge({ id: 'old', status: 'done', action: 'Did a brave thing' })]);
    render(
      <ChallengeSection adultAcknowledged onStartChallenge={() => {}} onTalkItThrough={() => {}} />,
    );
    expect(screen.getByText('Past challenges (1)')).toBeInTheDocument();
    expect(screen.getByText('Did a brave thing')).toBeInTheDocument();
  });
});
