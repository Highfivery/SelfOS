import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionLauncher } from './SessionLauncher';
import { SuggestedSessions } from './SuggestedSessions';
import { GuidedStepper } from './GuidedStepper';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useGuidanceStore } from '../../../stores/guidanceStore';

function renderLauncher(props: Partial<Parameters<typeof SessionLauncher>[0]> = {}): void {
  render(
    <MemoryRouter>
      <SessionLauncher
        configured
        onStartFree={() => {}}
        onPickGuided={() => {}}
        onStartChallenge={() => {}}
        onTalkItThrough={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useGuidanceStore.getState().reset();
});

describe('SessionLauncher', () => {
  it('renders the free-start framing + grouped catalog', () => {
    installMockBridge();
    renderLauncher();
    expect(screen.getByText('What do you want to work through?')).toBeInTheDocument();
    expect(screen.getByText('Reflective & therapy-informed')).toBeInTheDocument();
    expect(screen.getByText('Coaching')).toBeInTheDocument();
    expect(screen.getByText('Intimacy & connection')).toBeInTheDocument();
  });

  it('picking an exercise card calls onPickGuided with its id', async () => {
    installMockBridge();
    const onPickGuided = vi.fn();
    renderLauncher({ onPickGuided });
    await userEvent.click(screen.getByRole('button', { name: /Start Thought Record/ }));
    expect(onPickGuided).toHaveBeenCalledWith('cbt-thought-record');
  });

  it('gates the intimacy group behind an 18+ acknowledgement, then reveals it', async () => {
    installMockBridge({
      guidedAcknowledgeAdult: () => Promise.resolve({ cache: null, adultAcknowledged: true }),
    });
    renderLauncher();
    // Before ack: the gate button shows; the adult cards (existing AND new, 48) do not.
    expect(screen.queryByRole('button', { name: /Start Sensate Focus/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Start Kink & Power Exchange/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /18 or older/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Start Sensate Focus/ })).toBeInTheDocument(),
    );
    // The expanded set (48) renders too — a new explicit card and the structured builder card.
    expect(screen.getByRole('button', { name: /Start Kink & Power Exchange/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Start Yes \/ No \/ Maybe List/ }),
    ).toBeInTheDocument();
  });

  it('picking a new (48) intimacy card calls onPickGuided with its id', async () => {
    installMockBridge({
      guidedAcknowledgeAdult: () => Promise.resolve({ cache: null, adultAcknowledged: true }),
    });
    const onPickGuided = vi.fn();
    renderLauncher({ onPickGuided });
    await userEvent.click(screen.getByRole('button', { name: /18 or older/i }));
    const card = await screen.findByRole('button', { name: /Start Fantasy Exploration/ });
    await userEvent.click(card);
    expect(onPickGuided).toHaveBeenCalledWith('fantasy-exploration');
  });
});

describe('SuggestedSessions', () => {
  it('shows a calm "turn on AI" state when not configured', () => {
    installMockBridge();
    render(
      <MemoryRouter>
        <SuggestedSessions configured={false} onPick={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/isn.t set up yet/i)).toBeInTheDocument();
    // No spend affordance is offered when AI is off.
    expect(screen.queryByRole('button', { name: /get personalized/i })).not.toBeInTheDocument();
  });

  it('explicit first tap generates suggestions (no silent spend), then shows them', async () => {
    installMockBridge({
      guidedSuggest: () =>
        Promise.resolve({
          ok: true,
          generatedAt: new Date().toISOString(),
          suggestions: [{ guideId: 'values-clarification', reason: 'A grounding start for you.' }],
          usage: {
            id: 'u1',
            schemaVersion: 1,
            type: 'guided.suggest',
            personId: 'p1',
            model: 'm',
            at: 'now',
            inputTokens: 1,
            outputTokens: 1,
            cacheWriteTokens: 0,
            cacheReadTokens: 0,
            costUsd: 0,
          },
        }),
    });
    // Mark the no-spend read as completed with no cache → the first-tap button shows.
    useGuidanceStore.setState({ loaded: true, suggestions: null });
    render(
      <MemoryRouter>
        <SuggestedSessions configured onPick={() => {}} />
      </MemoryRouter>,
    );
    const tap = screen.getByRole('button', { name: /get personalized suggestions/i });
    await userEvent.click(tap);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Start Values Clarification/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('A grounding start for you.')).toBeInTheDocument();
  });
});

describe('GuidedStepper', () => {
  it('marks the current step with aria-current (not colour alone)', () => {
    render(
      <GuidedStepper steps={['Goal', 'Reality', 'Options', 'Will & way forward']} current={1} />,
    );
    const current = screen.getByText('Reality').closest('li');
    expect(current?.getAttribute('aria-current')).toBe('step');
    // The non-current steps are not marked.
    expect(screen.getByText('Goal').closest('li')?.getAttribute('aria-current')).toBeNull();
  });
});
