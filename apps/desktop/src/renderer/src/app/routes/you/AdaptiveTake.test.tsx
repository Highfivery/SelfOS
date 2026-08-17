import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdaptiveBankView, AdaptiveStateView } from '@shared/schemas';
import { installMockBridge } from '../../../test-utils/bridge';
import { useAdaptiveTestStore } from '../../../stores/adaptiveTestStore';
import { AdaptiveTake } from './AdaptiveTake';

const BANK: AdaptiveBankView = {
  testId: 'dirty-talk',
  families: [
    { id: 'names-power', label: 'Names — power & role', kind: 'word' },
    {
      id: 'taboo',
      label: 'Taboo fantasy & roleplay',
      kind: 'phrase',
      note: 'Every entry here is PRE-AGREED, SAFEWORDED ROLEPLAY between consenting adults.',
    },
  ],
  entries: [
    {
      key: 'names-power:good-girl',
      text: 'good girl',
      kind: 'word',
      family: 'names-power',
      tier: 2,
      directions: ['hear', 'say'],
      sides: ['hear', 'say'],
      example: 'that’s it — such a good girl for me',
    },
    {
      key: 'taboo:run-primal',
      text: 'run (primal)',
      kind: 'phrase',
      family: 'taboo',
      tier: 5,
      directions: ['hear', 'say'],
      sides: ['hear', 'say'],
    },
  ],
  withheldByFamily: {},
  address: { self: 'girl' as const, partner: 'man' as const },
  resumeArea: 0,
};

function state(overrides: Partial<AdaptiveStateView> = {}): AdaptiveStateView {
  return {
    testId: 'dirty-talk',
    title: 'Dirty talk',
    blurb: 'What you want said to you.',
    framing: 'A map, not a verdict.',
    estimatedMinutes: 15,
    draft: null,
    latest: null,
    history: [],
    lexicon: {
      schemaVersion: 1,
      personId: 'p1',
      entries: [],
      registers: {},
      contexts: {},
      themes: [],
      wantsToSay: [],
      boundaries: [],
      updatedAt: 'now',
    },
    ambiguitiesLeft: 0,
    staleForRetake: false,
    ...overrides,
  };
}

const DRAFT = {
  id: 'r1',
  schemaVersion: 1,
  testId: 'dirty-talk',
  testVersion: 1,
  subjectPersonId: 'p1',
  answers: [],
  scores: [],
  status: 'draft' as const,
  kind: 'adaptive' as const,
  takenAt: 'now',
  createdAt: 'now',
  updatedAt: 'now',
};

function renderTake(): void {
  render(
    <MemoryRouter initialEntries={['/tests/dirty-talk/take']}>
      <AdaptiveTake />
    </MemoryRouter>,
  );
}

describe('AdaptiveTake (74 §3.2)', () => {
  beforeEach(() => {
    useAdaptiveTestStore.getState().reset();
  });

  it('tells them the steer exists BEFORE they produce any material (74 §8.4)', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
    });
    renderTake();
    expect(
      await screen.findByText(/it can quietly shape what their coach suggests to them/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/never tells them what you said/i)).toBeInTheDocument();
  });

  it('is withheld entirely before the 18+ ack — the bridge returns nothing', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(null),
      testsAdaptiveState: () => Promise.resolve(null),
    });
    renderTake();
    expect(await screen.findByText(/This one is 18\+/i)).toBeInTheDocument();
  });

  it('marks only what lands in pass 1, and shows the boundary rule in plain words', async () => {
    const bankPass = vi.fn(() => Promise.resolve(state({ draft: DRAFT })));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: bankPass as never,
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));

    expect(await screen.findByText(/nothing in SelfOS will suggest it again/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'good girl — hear & say — love it' }));

    await userEvent.click(screen.getByRole('button', { name: /Next area/ }));
    // The taboo family carries its roleplay framing wherever it appears (74 §8.1).
    expect(screen.getByText(/PRE-AGREED, SAFEWORDED ROLEPLAY/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'run (primal) — hear & say — never' }),
    );
    expect(screen.getByText(/2 marked/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Done — show me/i }));
    await waitFor(() =>
      expect(bankPass).toHaveBeenCalledWith(
        expect.objectContaining({
          marks: { 'names-power:good-girl': 'love', 'taboo:run-primal': 'never' },
        }),
      ),
    );
  });

  it('asks the hear/say split ONLY for what was marked, and never for a boundary', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    await userEvent.click(screen.getByRole('button', { name: 'good girl — hear & say — love it' }));
    await userEvent.click(screen.getByRole('button', { name: /Next area/ }));
    await userEvent.click(
      screen.getByRole('button', { name: 'run (primal) — hear & say — never' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Done — show me/i }));

    expect(await screen.findByText(/Hearing it, or saying it\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'good girl — hear 4 of 4' })).toBeInTheDocument();
    // The one they ruled out is not re-rated.
    expect(screen.queryByRole('button', { name: /run \(primal\) — hear/ })).not.toBeInTheDocument();
  });

  it('shows live progress on an AI phase — never a bare spinner (CLAUDE.md §12)', async () => {
    let resolveLines: (value: {
      ok: boolean;
      lines: string[];
      degraded: boolean;
    }) => void = () => {};
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveLines: () =>
        new Promise((resolve) => {
          resolveLines = resolve;
        }) as never,
    });
    renderTake();
    // A draft is already in flight, so the intro offers to pick it up rather than begin.
    await userEvent.click(
      await screen.findByRole('button', { name: /Pick up where you left off/i }),
    );
    useAdaptiveTestStore.setState({ phase: 'lines' });
    void useAdaptiveTestStore.getState().loadLines('dirty-talk', 1);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/Writing lines for you/);
    expect(status).toHaveTextContent(/elapsed/);
    resolveLines({ ok: true, lines: ['good girl, just like that'], degraded: false });
    expect(await screen.findByText(/good girl, just like that/)).toBeInTheDocument();
  });

  // --- 74 §3.4 — every tap saves itself ---

  it('autosaves each mark without waiting for Next, and says so', async () => {
    const bankPass = vi.fn(() => Promise.resolve(state({ draft: DRAFT })));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: bankPass as never,
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    expect(screen.getByText(/Every tap saves itself/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'good girl — hear & say — love it' }));
    // No Next click anywhere in this test — the write happens on its own.
    await waitFor(() =>
      expect(bankPass).toHaveBeenCalledWith(
        expect.objectContaining({
          marks: { 'names-power:good-girl': 'love' },
          autosave: true,
        }),
      ),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('takes back a mis-tapped ✗ — an autosaved boundary must stay editable in the same sitting', async () => {
    const bankPass = vi.fn(() => Promise.resolve(state({ draft: DRAFT })));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: bankPass as never,
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));

    await userEvent.click(screen.getByRole('button', { name: /Next area/ }));
    const never = screen.getByRole('button', { name: 'run (primal) — hear & say — never' });
    await userEvent.click(never);
    await waitFor(() => expect(bankPass).toHaveBeenCalled());
    // Still a live control, not the settled "off the table" row a PRIOR take's boundary renders as.
    expect(
      screen.getByRole('button', { name: 'run (primal) — hear & say — never' }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'run (primal) — hear & say — never' }),
    );
    await waitFor(() =>
      expect(bankPass).toHaveBeenLastCalledWith(
        expect.objectContaining({ cleared: ['taboo:run-primal'], autosave: true }),
      ),
    );
    expect(screen.getByText(/0 marked/)).toBeInTheDocument();
  });

  it('a boundary from an EARLIER take is still settled, not re-offered', async () => {
    const withBoundary = state({
      draft: DRAFT,
      lexicon: {
        ...state().lexicon,
        entries: [
          {
            key: 'taboo:run-primal',
            text: 'run (primal)',
            kind: 'phrase',
            family: 'taboo',
            tier: 5,
            hear: 0,
            say: 0,
            state: 'never' as const,
            source: 'test:r0',
          },
        ],
      },
    });
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(withBoundary),
      testsAdaptiveStart: () => Promise.resolve(withBoundary),
    });
    renderTake();
    await userEvent.click(
      await screen.findByRole('button', { name: /Pick up where you left off/i }),
    );
    // The boundary lives in the taboo family — the deck shows one area at a time (74 §3.6.4).
    await userEvent.click(await screen.findByRole('button', { name: /Next area/ }));
    expect(await screen.findByText(/off the table/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'run (primal) — hear & say — never' }),
    ).not.toBeInTheDocument();
  });

  // --- 74 §3.6.3/§3.6.4/§3.6.5 — orientation ---

  it('asks the two address taps first, then opens the deck oriented', async () => {
    const edit = vi.fn(() => Promise.resolve(null));
    const unoriented = { ...BANK };
    delete (unoriented as { address?: unknown }).address;
    installMockBridge({
      testsBank: () => Promise.resolve(unoriented),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsLexiconEdit: edit as never,
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));

    expect(await screen.findByText(/Before we start/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'their man' }));
    await userEvent.click(screen.getByRole('button', { name: 'a girl' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({ kind: 'setAddress', self: 'man', partner: 'girl' }),
    );
  });

  it('skips the address taps on a retake — they are asked once, not every time', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK), // BANK already carries an address
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    expect(await screen.findByText(/Area 1 of 2/)).toBeInTheDocument();
    expect(screen.queryByText(/Before we start/i)).not.toBeInTheDocument();
  });

  it('STATES what it withheld, with a route back — never a silently thinner list', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve({ ...BANK, withheldByFamily: { 'names-power': 14 } }),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    expect(await screen.findByText(/14 terms are hidden here/i)).toBeInTheDocument();
    // …and the way back is a control, not just a sentence.
    await userEvent.click(screen.getByRole('button', { name: /Before we start/i }));
    expect(await screen.findByText(/When someone talks to you like this/i)).toBeInTheDocument();
  });

  it('shows the example under a term — you react to the line, not the word', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    expect(await screen.findByText(/such a good girl for me/)).toBeInTheDocument();
  });

  it('moves on rather than dead-ending when an AI phase degrades (74 §7)', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveLines: () => Promise.resolve({ ok: false, degraded: true }),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'lines' });
    await useAdaptiveTestStore.getState().loadLines('dirty-talk', 1);
    // It moved ON, which is the whole point — not to a fixed phase. With the component mounted, the phase
    // it lands in keeps degrading forward under the same mock bridge (probe → scenario), so pinning one
    // name would assert the mock's depth rather than the rule: a degraded phase is skipped, never fatal.
    expect(useAdaptiveTestStore.getState().phase).not.toBe('lines');
    expect(useAdaptiveTestStore.getState().busy).toBe(false);
  });

  it('says so and stays usable when a call fails — never a frozen take (74 §7)', async () => {
    // Every action is wrapped, so a rejected bridge call cannot leave `busy` set with nothing on screen.
    // Before the guard, this froze the take mid-phase and the only route out was quitting the app — which,
    // on a take that autosaves, looks exactly like losing everything you just marked.
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveSynthesize: () => Promise.reject(new Error('offline')),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    await useAdaptiveTestStore.getState().synthesize('dirty-talk');
    expect(useAdaptiveTestStore.getState().busy).toBe(false);
    expect(useAdaptiveTestStore.getState().progress).toBeNull();
    expect(await screen.findByText(/didn’t go through|didn't go through/)).toBeInTheDocument();
  });

  it('says what happened when an area holds nothing for either of them, instead of an empty card', async () => {
    // A same-sex configuration resolves whole areas to one side. Rendering "0 here" under the marking
    // instructions and an empty card reads as a broken screen.
    installMockBridge({
      testsBank: () =>
        Promise.resolve({
          ...BANK,
          entries: BANK.entries.filter((e) => e.family !== 'names-power'),
          withheldByFamily: { 'names-power': 1 },
        }),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });
    expect(await screen.findByText(/nothing to mark here/i)).toBeInTheDocument();
    expect(screen.queryByText(/Only tap what actually does something/)).not.toBeInTheDocument();
    // The withheld note still carries the route back.
    expect(screen.getByRole('button', { name: /Before we start/ })).toBeInTheDocument();
  });

  it('does not strand a resumed take past the end of a shorter bank', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve({ ...BANK, resumeArea: 9 }),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });
    // Clamped to the last real area, not a blank screen with no way forward.
    expect(await screen.findByText(/Area 2 of 2/)).toBeInTheDocument();
  });
});
