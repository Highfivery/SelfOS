import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdaptiveNamesView } from '@shared/schemas';
import { installMockBridge } from '../../../test-utils/bridge';
import { useAdaptiveTestStore } from '../../../stores/adaptiveTestStore';
import { NamesPhase } from './NamesPhase';

/** 74 §3.6.8 — the pet-name phase: register-first, two marks per name, per-direction boundaries. */

const NAMES: AdaptiveNamesView = {
  testId: 'dirty-talk',
  selfName: 'Ben',
  partnerName: 'Angel',
  registers: [
    {
      id: 'names-praise',
      label: 'Names — praise',
      note: 'Being told you are good at it.',
      count: 2,
      minTier: 2,
      maxTier: 2,
      samples: ['good girl', 'good boy'],
      marked: 0,
    },
    {
      id: 'names-rough-heavy',
      label: 'Names — rough, heavy',
      count: 1,
      minTier: 4,
      maxTier: 5,
      samples: ['slut'],
      marked: 3,
    },
  ],
  entries: [
    {
      key: 'names-praise:good-girl',
      text: 'good girl',
      family: 'names-praise',
      tier: 2,
      example: 'that’s it — such a good girl for me',
    },
    {
      key: 'names-praise:good-boy',
      text: 'good boy',
      family: 'names-praise',
      tier: 2,
      example: 'that’s my good boy',
    },
    {
      key: 'names-rough-heavy:slut',
      text: 'slut',
      family: 'names-rough-heavy',
      tier: 4,
      example: 'that’s my slut',
      // Ruled out to hear in an EARLIER take — settled, and not re-offered.
      settledHear: true,
    },
  ],
};

function renderPhase(): void {
  // The verbs live in the shared step rail (74 §3.6.9), which the take owns — this stands in for it, so the
  // phase's own controls are the only thing under test here.
  render(<NamesPhase rail={<div data-testid="step-rail" />} />);
}

describe('NamesPhase (74 §3.6.8)', () => {
  beforeEach(() => {
    useAdaptiveTestStore.getState().reset();
  });

  async function load(over: Partial<AdaptiveNamesView> = {}): Promise<void> {
    installMockBridge({ testsNames: () => Promise.resolve({ ...NAMES, ...over }) });
    await useAdaptiveTestStore.getState().loadNames('dirty-talk');
  }

  it('opens on the registers, not on 2,000 rows — with the count and real names on each card', async () => {
    await load();
    renderPhase();
    const card = screen.getByRole('button', { name: /praise/i });
    expect(card).toHaveTextContent('2');
    // Never choosing blind: real names from inside it.
    expect(card).toHaveTextContent('good girl');
    // A started register reads as started — that is the unit of progress, not a row.
    expect(screen.getByRole('button', { name: /rough, heavy/i })).toHaveTextContent('3 marked');
  });

  it('asks each name TWICE, in columns carrying both real names', async () => {
    await load();
    renderPhase();
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));
    expect(
      screen.getByRole('button', { name: 'good girl — Angel → Ben — love it' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'good girl — Ben → Angel — love it' }),
    ).toBeInTheDocument();
  });

  it('records the two directions independently, and takes one back on a second tap', async () => {
    const names = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      testsNames: () => Promise.resolve(NAMES),
      testsAdaptiveNames: names as never,
    });
    await useAdaptiveTestStore.getState().loadNames('dirty-talk');
    useAdaptiveTestStore.setState({
      state: {
        draft: { id: 'r1' },
      } as never,
    });
    renderPhase();
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));

    await userEvent.click(screen.getByRole('button', { name: 'good girl — Angel → Ben — never' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'good girl — Ben → Angel — love it' }),
    );
    expect(useAdaptiveTestStore.getState().nameMarks['names-praise:good-girl']).toEqual({
      hear: 'never',
      say: 'love',
    });
    // Autosaved as a delta, both sides in one write.
    await waitFor(() =>
      expect(names).toHaveBeenCalledWith(
        expect.objectContaining({
          marks: { 'names-praise:good-girl': { hear: 'never', say: 'love' } },
          autosave: true,
        }),
      ),
    );

    // Tapping the same mark again takes it back — a mis-tapped ✗ must not be a permanent boundary.
    await userEvent.click(screen.getByRole('button', { name: 'good girl — Angel → Ben — never' }));
    expect(useAdaptiveTestStore.getState().nameMarks['names-praise:good-girl']).toEqual({
      say: 'love',
    });
    await waitFor(() =>
      expect(names).toHaveBeenLastCalledWith(
        expect.objectContaining({ cleared: { 'names-praise:good-girl': ['hear'] } }),
      ),
    );
  });

  it('leaves an EARLIER take’s hard no settled on its own side only', async () => {
    await load();
    renderPhase();
    await userEvent.click(screen.getByRole('button', { name: /rough, heavy/i }));
    // "slut" appears as the name AND inside its own example, so scope to the name element itself.
    expect(screen.getByText(/off the table/i)).toBeInTheDocument();
    // …and the other direction is still live, because a boundary is per-direction now.
    expect(
      screen.getByRole('button', { name: 'slut — Ben → Angel — love it' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'slut — Angel → Ben — love it' }),
    ).not.toBeInTheDocument();
  });

  it('shows the shared step rail on BOTH screens, and only the register has its own primary', async () => {
    await load();
    renderPhase();
    // The grid: the rail is the only navigation — the phase's verbs used to be a bottom bar here and a side
    // rail one screen over, so "where am I" changed between two screens of one test.
    expect(screen.getByTestId('step-rail')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Done with this one/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));
    expect(screen.getByTestId('step-rail')).toBeInTheDocument();
    // Inside a register the primary closes the REGISTER — walking out of the step from here would step past
    // the registers they have not opened (the §3.6.9 walk, finding 3).
    expect(screen.getByRole('button', { name: /Done with this one/i })).toBeInTheDocument();
  });
});
