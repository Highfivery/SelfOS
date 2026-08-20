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
    },
    {
      id: 'names-rough-heavy',
      label: 'Names — rough, heavy',
      count: 1,
      minTier: 4,
      maxTier: 5,
      samples: ['slut'],
    },
  ],
  entries: [
    {
      key: 'names-praise:good-girl',
      text: 'good girl',
      family: 'names-praise',
      tier: 2,
      example: 'that’s it — such a good girl for me',
      sides: ['hear', 'say'],
    },
    {
      key: 'names-praise:good-boy',
      text: 'good boy',
      family: 'names-praise',
      tier: 2,
      example: 'that’s my good boy',
      sides: ['hear', 'say'],
    },
    {
      key: 'names-rough-heavy:anal-slut',
      text: 'slut',
      family: 'names-rough-heavy',
      tier: 4,
      example: 'that’s my slut',
      sides: ['hear', 'say'],
      // Ruled out to hear in an EARLIER take. Still re-markable: a no is a preference now (74 §3.2).
      hearState: 'never',
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

  it('opens on the registers, not on 2,000 rows — real names, the range in words, and counts', async () => {
    await load();
    renderPhase();
    const card = screen.getByRole('button', { name: /praise/i });
    // Never choosing blind: real names from inside it.
    expect(card).toHaveTextContent('good girl');
    // How far it goes, said in words — the five-pip meter it replaced encoded a RANGE and read as an AMOUNT.
    expect(card).toHaveTextContent(/gentle/i);
    expect(card).toHaveTextContent('2 names, none marked yet');
    // A register whose names carry a mark from an earlier sitting reads as started, from the SEEDED marks.
    const rough = screen.getByRole('button', { name: /rough, heavy/i });
    expect(rough).toHaveTextContent('1 marked · 1 names');
    expect(rough).not.toHaveTextContent('%');
    expect(rough).not.toHaveTextContent(/all marked/i);
    expect(rough).not.toHaveTextContent(/left/i);
    expect(rough).toHaveTextContent(/strong to intense/i);
  });

  it('THE BUG: a register marked in THIS sitting stops reading "none marked yet" immediately', async () => {
    // It used to keep the mount-time server count forever, so a register you had just worked through still
    // read "Not opened" until the take was reloaded (owner-reported 2026-08-19).
    await load();
    renderPhase();
    expect(screen.getByRole('button', { name: /praise/i })).toHaveTextContent(
      '2 names, none marked yet',
    );
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));
    await userEvent.click(
      screen.getByRole('button', { name: 'good girl — Angel → Ben — love it' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Done with this one/i }));
    const card = screen.getByRole('button', { name: /praise/i });
    expect(card).toHaveTextContent('1 marked · 2 names');
    expect(card).not.toHaveTextContent('%');
    expect(card).not.toHaveTextContent('none marked yet');
  });

  it('counts love / okay / never as names, and they reconcile with the marked total', async () => {
    await load();
    renderPhase();
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));
    await userEvent.click(
      screen.getByRole('button', { name: 'good girl — Angel → Ben — love it' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'good boy — Angel → Ben — never' }));
    await userEvent.click(screen.getByRole('button', { name: /Done with this one/i }));
    const card = screen.getByRole('button', { name: /praise/i });
    expect(card).toHaveTextContent('2 marked · 2 names');
    // One loved, one ruled out — mutually exclusive, so they sum to the marked total.
    expect(card).toHaveTextContent(/you love/i);
    expect(card).toHaveTextContent(/not for you/i);
  });

  it('sorts in progress first by default, and re-sorts on demand', async () => {
    await load();
    renderPhase();
    const names = (): string[] =>
      screen
        .getAllByRole('button', { name: /praise|rough, heavy/i })
        .map((el) => el.textContent ?? '');
    // rough-heavy is fully marked, so it sinks below the untouched one.
    expect(names()[0]).toMatch(/praise/i);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'hot');
    expect(names()[0]).toMatch(/rough, heavy/i);
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

  it('lets an EARLIER take’s no be changed — nothing is off the table for good (74 §3.2)', async () => {
    await load();
    renderPhase();
    await userEvent.click(screen.getByRole('button', { name: /rough, heavy/i }));
    // The row is no longer locked out, on either side.
    expect(screen.queryByText(/off the table/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'slut — Angel → Ben — never' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // …and tapping a different mark actually changes it.
    await userEvent.click(screen.getByRole('button', { name: 'slut — Angel → Ben — love it' }));
    expect(useAdaptiveTestStore.getState().nameMarks['names-rough-heavy:anal-slut']).toMatchObject({
      hear: 'love',
    });
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

  /*
   * 74 §3.6.29 — the durable no-completion rule, narrowed 2026-08-18: a COUNT is fine, a fraction of a whole
   * is not — "the line is the DENOMINATOR". These cards carried a percentage, a filling bar, "N of M names
   * marked", "all marked ✓" and "N left": five ways of saying a register is finishable.
   *
   * It is not, and this is not academic. The bank GROWS — `names-rough-mild` went 130 → 132 in the same
   * change that removed these — so anyone who had marked all 130 would open the app to "98% · 2 left" having
   * done nothing at all.
   */
  it('shows no percentage, no meter and no done-state, even on a fully marked register', async () => {
    await load();
    renderPhase();
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));
    await userEvent.click(
      screen.getByRole('button', { name: 'good girl — Angel → Ben — love it' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'good boy — Angel → Ben — love it' }));
    await userEvent.click(screen.getByRole('button', { name: /Done with this one/i }));
    const card = screen.getByRole('button', { name: /praise/i });
    // Every name in the register is marked — the case that used to read "100% · all marked".
    expect(card).toHaveTextContent('2 marked · 2 names');
    for (const claim of [/%/, /all marked/i, /\bleft\b/i, /of 2 names marked/i]) {
      expect(card).not.toHaveTextContent(claim);
    }
    expect(card.querySelector('[style*="width"]')).toBeNull();
  });

  it('says out loud that there is no finishing it', async () => {
    await load();
    renderPhase();
    expect(screen.getByText(/no finishing this/i)).toBeInTheDocument();
  });
});
