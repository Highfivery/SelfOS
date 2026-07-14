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
    expect(screen.getByRole('button', { name: /reflect on it/i })).toBeInTheDocument();
  });

  it('invites a check-in once one is due', () => {
    useChallengeStore.setState({
      challenges: [challenge({ checkInAt: new Date(Date.now() - 3600_000).toISOString() })],
      loaded: true,
    });
    renderCard();
    expect(screen.getByText(/ready for a check-in/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /how.s it going/i })).toBeInTheDocument();
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
