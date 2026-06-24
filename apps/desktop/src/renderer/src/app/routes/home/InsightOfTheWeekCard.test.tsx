import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CoachingSynthesis } from '@shared/schemas';
import { InsightOfTheWeekCard } from './InsightOfTheWeekCard';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useSynthesisStore } from '../../../stores/synthesisStore';

afterEach(() => {
  clearMockBridge();
  useSynthesisStore.getState().reset();
});

const synthesis: CoachingSynthesis = {
  schemaVersion: 1,
  subjectPersonId: 'p1',
  observation: 'Connection keeps surfacing across your recent reflections.',
  sources: ['sessions', 'dreams'],
  lifeArea: 'Relationships',
  computedAt: '2026-06-24T00:00:00.000Z',
};

function renderCard(props: { configured?: boolean; canSynthesize?: boolean } = {}): void {
  render(
    <MemoryRouter>
      <InsightOfTheWeekCard
        configured={props.configured ?? true}
        canSynthesize={props.canSynthesize ?? true}
      />
    </MemoryRouter>,
  );
}

describe('InsightOfTheWeekCard (40 §3.3)', () => {
  it('shows a cached observation with Talk it through + Look again', async () => {
    installMockBridge({ coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1 }) });
    useSynthesisStore.setState({ synthesis, loaded: true });
    renderCard();
    expect(await screen.findByText(/connection keeps surfacing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /talk it through/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /look again/i })).toBeInTheDocument();
  });

  it('offers the manual run when there is no synthesis yet but enough material', async () => {
    const run = vi.fn(() =>
      Promise.resolve({ ok: false as const, reason: 'EMPTY' as const, message: 'x' }),
    );
    installMockBridge({
      coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1 }),
      coachingSynthesize: run,
    });
    useSynthesisStore.setState({ synthesis: null, loaded: true });
    renderCard({ canSynthesize: true });
    const button = await screen.findByRole('button', { name: /what are you noticing lately/i });
    await userEvent.click(button);
    expect(run).toHaveBeenCalled();
  });

  it('is hidden when proactivity is off', async () => {
    installMockBridge({
      coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1, proactivity: 'off' }),
    });
    useSynthesisStore.setState({ synthesis, loaded: true });
    renderCard();
    // Wait a tick for the async pref read, then assert nothing rendered.
    await waitFor(() => expect(screen.queryByText(/connection keeps surfacing/i)).toBeNull());
  });

  it('self-hides for a brand-new person (no synthesis, not enough material)', async () => {
    installMockBridge({ coachingGetPrefs: () => Promise.resolve({ schemaVersion: 1 }) });
    useSynthesisStore.setState({ synthesis: null, loaded: true });
    renderCard({ canSynthesize: false });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /what are you noticing/i })).toBeNull(),
    );
  });
});
