import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DailyReflectionCard } from './DailyReflectionCard';
import { useSynthesisStore } from '../../../stores/synthesisStore';

function renderCard(props: { configured: boolean; canSynthesize: boolean }): void {
  render(
    <MemoryRouter>
      <DailyReflectionCard {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  useSynthesisStore.getState().reset();
});

describe('DailyReflectionCard', () => {
  it('shows the cached observation in a companion voice with a Refresh action', () => {
    useSynthesisStore.setState({
      synthesis: {
        schemaVersion: 1,
        subjectPersonId: 'me',
        observation: 'Rest and self-worth keep circling each other for you this week.',
        sources: ['sessions'],
        computedAt: '2026-07-13T00:00:00.000Z',
      },
      loaded: true,
    });
    renderCard({ configured: true, canSynthesize: true });
    expect(screen.getByText(/rest and self-worth keep circling/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    // The §3.3 seed-handoff — turn the observation into a session.
    expect(screen.getByRole('button', { name: /talk it through/i })).toBeInTheDocument();
  });

  it('offers an explicit "Reflect on my week" when configured with no cache yet', () => {
    renderCard({ configured: true, canSynthesize: true });
    expect(screen.getByRole('button', { name: /reflect on my week/i })).toBeInTheDocument();
  });

  it('shows a gentle not-enough-yet line when configured but there is too little to draw on', () => {
    renderCard({ configured: true, canSynthesize: false });
    expect(screen.getByText(/i.ll start noticing gentle threads/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reflect on my week/i })).toBeNull();
  });
});
