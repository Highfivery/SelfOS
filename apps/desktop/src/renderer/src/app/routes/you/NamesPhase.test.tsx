import { createRef } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

/** The register the take navigated to, so a test can assert the picker drove it. */
let wentTo: number | null = null;

function renderPhase(): void {
  // The verbs live in the shared step rail (74 §3.6.9), which the take owns — this stands in for it, so the
  // phase's own controls are the only thing under test here. Since §3.6.34 the register verbs live there
  // too, which is why navigation arrives as a callback rather than being the phase's own business.
  wentTo = null;
  render(
    <NamesPhase
      rail={<div data-testid="step-rail" />}
      headingRef={createRef<HTMLDivElement>()}
      onGoToRegister={(index) => {
        wentTo = index;
      }}
    />,
  );
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
    // 74 §3.6.34 — going back is the TAKE's job now (the rail's "All registers"), so a test that only
    // renders the phase asks the store directly rather than through a stub that has no verbs.
    act(() => useAdaptiveTestStore.getState().setOpenRegister(null));
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
    // 74 §3.6.34 — going back is the TAKE's job now (the rail's "All registers"), so a test that only
    // renders the phase asks the store directly rather than through a stub that has no verbs.
    act(() => useAdaptiveTestStore.getState().setOpenRegister(null));
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
    /*
     * 74 §3.6.34 — and inside a register there is STILL no card of its own. The register's verbs (Next
     * register / Previous register / All registers) moved into the shared rail, which is where the words
     * step has always kept its area verbs. A separate card above the rail was the last thing making two
     * screens of one test different shapes.
     */
    expect(screen.queryByRole('button', { name: /Done with this one/i })).not.toBeInTheDocument();
  });

  /*
   * 74 §3.6.34 — the names step navigates like the WORDS step, because they are two screens of one test.
   *
   * The words step has had an in-place area picker since §3.6.22 while this one made you leave the register,
   * land on a grid and choose again. The index comes from the bank's own order, never the card sort — an
   * index that moves when you re-sort is worse than no index at all.
   */
  /*
   * 74 §3.6.34 — "still unmarked", the same control the words step has, in the same place.
   *
   * The hard thing on a second visit is not choosing a register, it is finding the rows inside it you have
   * not answered — 123 names in `names-body`. The count beside it is a COUNT and never a fraction (§3.6.29):
   * "3 still unmarked" says how much is outstanding, "3 of 18" would make the completion claim.
   */
  it('filters to what is still unmarked, and counts it without a denominator', async () => {
    await load();
    renderPhase();
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));
    const before = screen.getAllByRole('button', { name: /love it$/ }).length;

    const hearAll = screen.getAllByRole('button', { name: /→ .* — love it$/ });
    // The first row's two columns are the first two matches: hear then say.
    await userEvent.click(hearAll[0]!);

    /*
     * OWNER-REPORTED, 2026-08-20 — ONE side is not an answer to a two-sided row.
     *
     * The first version of this filter asked "does this row have any answer at all", so answering the hear
     * side made the row vanish from "still unmarked" while the say side was still blank — which is precisely
     * the row the filter exists to surface. §3.6.11 separated "has an answer" from "this direction was
     * answered" in core for the same reason; this is that distinction at the view layer.
     */
    await userEvent.click(screen.getByRole('button', { name: 'Still unmarked' }));
    expect(screen.getAllByRole('button', { name: /love it$/ })).toHaveLength(before);

    // …and once the OTHER side is answered too, it goes.
    await userEvent.click(screen.getByRole('button', { name: 'Everything' }));
    const sayAll = screen.getAllByRole('button', { name: /→ .* — love it$/ });
    await userEvent.click(sayAll[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'Still unmarked' }));
    const after = screen.getAllByRole('button', { name: /love it$/ }).length;
    expect(after).toBeLessThan(before);
    // A COUNT of what is outstanding — never "3 of 18", which would pair it with a total (§3.6.29).
    // Scoped to the filter's own row: "Register 1 of 2" in the header IS a position and stays (owner,
    // 2026-08-20), so a page-wide assertion would catch the wrong thing.
    const filterRow = screen.getByRole('group', { name: 'Show' }).parentElement!;
    expect(within(filterRow).getByText(/\d+ still unmarked/)).toBeInTheDocument();
    expect(within(filterRow).queryByText(/of/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Everything' }));
    expect(screen.getAllByRole('button', { name: /love it$/ })).toHaveLength(before);
  });

  it('moves register-to-register in place, in a stable order, without going back to the grid', async () => {
    await load();
    renderPhase();
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));
    expect(screen.getByText(/Register 1 of 2/)).toBeInTheDocument();

    const jump = screen.getByRole('combobox', { name: /Go to a register/i });
    await userEvent.selectOptions(jump, '1');
    expect(wentTo).toBe(1);

    // The picker lists every register in the bank's order, not just the open one.
    expect(within(jump).getByRole('option', { name: /1\. praise/i })).toBeInTheDocument();
    expect(within(jump).getByRole('option', { name: /2\. rough, heavy/i })).toBeInTheDocument();
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
    // 74 §3.6.34 — going back is the TAKE's job now (the rail's "All registers"), so a test that only
    // renders the phase asks the store directly rather than through a stub that has no verbs.
    act(() => useAdaptiveTestStore.getState().setOpenRegister(null));
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
