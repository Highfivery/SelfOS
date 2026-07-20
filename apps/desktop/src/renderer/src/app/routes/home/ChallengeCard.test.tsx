import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Challenge } from '@shared/schemas';
import { ChallengeCard } from './ChallengeCard';
import { useChallengeStore } from '../../../stores/challengeStore';

const challenge = (over: Partial<Challenge>): Challenge => ({
  id: 'ch1',
  schemaVersion: 1,
  subjectPersonId: 'me',
  action: 'Say the honest thing once a day',
  status: 'active',
  comfort: 3,
  agreedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  provenance: { at: 'now' },
  createdAt: 'now',
  updatedAt: 'now',
  ...over,
});

function renderCard(): void {
  render(
    <MemoryRouter>
      <ChallengeCard />
    </MemoryRouter>,
  );
}

afterEach(() => useChallengeStore.getState().reset());

describe('ChallengeCard', () => {
  it('shows the active challenge with its action, comfort, and a day marker', () => {
    useChallengeStore.setState({ challenges: [challenge({})], loaded: true });
    renderCard();
    expect(screen.getByRole('heading', { name: /your challenge/i })).toBeInTheDocument();
    expect(screen.getByText(/say the honest thing/i)).toBeInTheDocument();
    expect(screen.getByText(/day 3/i)).toBeInTheDocument(); // agreed 2 days ago → day 3
  });

  // 52 §3.3 (amended): before a check-in is due, THIS card owns the actions — the "For you"
  // `challenge-checkin` recommendation isn't showing, so without these Home offers no way to act.
  it('offers inline quick actions while no check-in is due', () => {
    useChallengeStore.setState({ challenges: [challenge({})], loaded: true });
    renderCard();
    expect(screen.getByRole('button', { name: 'I did it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reflect' })).toBeInTheDocument();
  });

  // …and once it IS due, the card defers so Home never offers the same check-in twice (§7).
  it('hides its action row once a check-in is due, deferring to the focal recommendation', () => {
    useChallengeStore.setState({
      challenges: [challenge({ checkInAt: new Date(Date.now() - 3600_000).toISOString() })],
      loaded: true,
    });
    renderCard();
    expect(screen.getByText(/ready for a check-in/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /how.s it going/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I did it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not yet' })).toBeNull();
  });

  it('self-hides when there is no active challenge', () => {
    useChallengeStore.setState({ challenges: [challenge({ status: 'done' })], loaded: true });
    const { container } = render(
      <MemoryRouter>
        <ChallengeCard />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
