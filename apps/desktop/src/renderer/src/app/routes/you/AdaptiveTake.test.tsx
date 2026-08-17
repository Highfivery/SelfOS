import { render, screen, waitFor, within } from '@testing-library/react';
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
      await screen.findByText(/shape what a partner’s coach suggests to them/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/never telling them what you said/i)).toBeInTheDocument();
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

    // The marking rules live behind one link now, instead of four paragraphs on every one of 36 areas.
    await userEvent.click(await screen.findByRole('button', { name: /How marking works/i }));
    expect(screen.getByText(/nothing in SelfOS will suggest it again/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'good girl — hear & say — love it' }));

    await userEvent.click(screen.getByRole('button', { name: /Next area/ }));
    // The taboo family carries its roleplay framing wherever it appears (74 §8.1).
    expect(screen.getByText(/PRE-AGREED, SAFEWORDED ROLEPLAY/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'run (primal) — hear & say — never' }),
    );
    // The rail tallies per mark now, rather than one "N marked so far" line.
    // The rail tallies per mark now, rather than one "N marked so far" line.
    expect(screen.getByTestId('tally-love')).toHaveTextContent('1');
    expect(screen.getByTestId('tally-never')).toHaveTextContent('1');

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
    expect(screen.getByTestId('tally-never')).toHaveTextContent('0');
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
    // Two plain identity questions, each with its own group of options — scoped, because "a man" is an
    // option in both.
    const you = screen.getByRole('group', { name: 'You are a:' });
    const them = screen.getByRole('group', { name: 'Your partner is a:' });
    await userEvent.click(within(you).getByRole('button', { name: 'a man' }));
    await userEvent.click(within(them).getByRole('button', { name: 'a woman' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    // Identity is stored AND drives the address by default — the body axis depends on it when onboarding
    // has no anatomy answer, which is the whole reason a straight man was being shown "your pussy" to hear.
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({
        kind: 'setAddress',
        self: 'man',
        partner: 'girl',
        identity: { self: 'man', partner: 'woman' },
      }),
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
    expect(await screen.findByText(/You are a:/i)).toBeInTheDocument();
  });

  it('shows the example under a term — you react to the line, not the word', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    // The quote wraps the marked word in a <b>, so it is no longer one text node — which is the point.
    expect(await screen.findByText(/such a/)).toBeInTheDocument();
    expect(screen.getByText('good girl', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText(/for me/)).toBeInTheDocument();
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

  it('keeps the crisis footer on EVERY phase, including the ones you type into', async () => {
    // It used to be rendered inside the intro/address/bank branches only, so it vanished on probe and
    // scenario — the free-text phases the distress detector actually reads — and on `done`, where someone
    // lands after a heavy take. A crisis affordance must not depend on which pane is showing.
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveProbe: () =>
        Promise.resolve({
          ok: true,
          done: false,
          degraded: false,
          question: 'Say more about that?',
          ambiguityId: 'a1',
        }),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    for (const phase of ['probe', 'scenario', 'done', 'split', 'lines'] as const) {
      useAdaptiveTestStore.setState({ phase });
      expect(
        await screen.findByRole('button', { name: /get help now/i }),
        `crisis footer missing on the ${phase} phase`,
      ).toBeInTheDocument();
    }
  });

  it('offers a way back to the top of the deck — resume must not be a one-way door', async () => {
    const abandon = vi.fn(() => Promise.resolve());
    const setArea = vi.fn(() => Promise.resolve());
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveAbandon: abandon as never,
      testsAdaptiveSetArea: setArea as never,
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: /Start over from the top/i }));
    // Honest about what it does and does not touch: the marks are their answers, not this take's state.
    expect(abandon).toHaveBeenCalled();
    await waitFor(() => expect(setArea).toHaveBeenCalledWith({ testId: 'dirty-talk', area: 0 }));
  });

  it('says on screen whether a line is one you SAY or one you HEAR', async () => {
    // The reported confusion: a screen of "your pussy is so wet for me" with three marks and nothing saying
    // which direction is being rated. Orientation already resolved it; the answer lived in the aria-label,
    // where a sighted person never sees it. Rating the wrong direction silently poisons the profile.
    const sayOnly: AdaptiveBankView = {
      ...BANK,
      families: [{ id: 'anatomy-her', label: 'Anatomy — her body', kind: 'word' }],
      entries: [
        {
          key: 'anatomy-her:pussy',
          text: 'pussy',
          kind: 'word',
          family: 'anatomy-her',
          tier: 3,
          directions: ['hear', 'say'],
          sides: ['say'],
          example: 'your pussy is so wet for me',
        },
      ],
      withheldByFamily: {},
    };
    installMockBridge({
      testsBank: () => Promise.resolve(sayOnly),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });
    expect(await screen.findByText(/Things YOU SAY TO THEM/i)).toBeInTheDocument();
  });

  it('states the direction for a hear-only area too, not just say', async () => {
    const hearOnly: AdaptiveBankView = {
      ...BANK,
      families: [{ id: 'anatomy-him', label: 'Anatomy — his body', kind: 'word' }],
      entries: [
        {
          key: 'anatomy-him:cock',
          text: 'cock',
          kind: 'word',
          family: 'anatomy-him',
          tier: 3,
          directions: ['hear', 'say'],
          sides: ['hear'],
        },
      ],
      withheldByFamily: {},
    };
    installMockBridge({
      testsBank: () => Promise.resolve(hearOnly),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });
    expect(await screen.findByText(/Things THEY SAY TO YOU/i)).toBeInTheDocument();
  });

  it('shows the flow as a graphic, and what the identity answers change', async () => {
    // The approved redesign: direction is a coloured band with a You → Them flow, not a sentence buried in
    // body copy; and the identity screen previews the two lines it will actually ask, tagged by side.
    installMockBridge({
      testsBank: () => Promise.resolve({ ...BANK, address: undefined } as never),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    await userEvent.click(
      within(screen.getByRole('group', { name: 'You are a:' })).getByRole('button', {
        name: 'a man',
      }),
    );
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Your partner is a:' })).getByRole('button', {
        name: 'a woman',
      }),
    );
    // The consequence is on screen, tagged, before they commit to it.
    expect(screen.getByText('YOU SAY')).toBeInTheDocument();
    expect(screen.getByText('YOU HEAR')).toBeInTheDocument();
    expect(screen.getByText(/your pussy is so wet for me/)).toBeInTheDocument();
    expect(screen.getByText(/how hard your cock gets/)).toBeInTheDocument();
  });

  it('puts the deck actions in a rail, so finishing never means scrolling 47 rows', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });
    const rail = await screen.findByRole('complementary', { name: /Your marks/i });
    expect(within(rail).getByRole('button', { name: /Next area/ })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /Done for now/ })).toBeInTheDocument();
    // Progress is one bar, not 36 dashes.
    expect(screen.getByRole('progressbar', { name: /Area 1 of 2/ })).toBeInTheDocument();
  });

  it('turns a rejected LINE into a boundary only on a second, deliberate tap', async () => {
    // A plain "no" means "this line doesn't land" and must not mint a boundary — a boundary is permanent and
    // lifts only by an explicit act. The escape is what catches "the word is fine, not like that".
    const edit = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveLines: () =>
        Promise.resolve({ ok: true, lines: ['I want to beat that pussy'], degraded: false }),
      testsLexiconEdit: edit as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'lines' });
    await useAdaptiveTestStore.getState().loadLines('dirty-talk', 1);

    // Before the reaction there is no escape at all.
    expect(screen.queryByRole('button', { name: /Never anything like this/i })).toBeNull();
    await userEvent.click(
      await screen.findByRole('button', { name: 'I want to beat that pussy — no' }),
    );
    expect(edit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Never anything like this/i }));
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({
        kind: 'addBoundary',
        text: 'I want to beat that pussy',
        boundaryKind: 'theme',
      }),
    );
  });

  it('makes the WORD the biggest thing in its row, with the quote subordinate', async () => {
    // The clarity fix that isn't prose: the row used to make the quote the visual hero and the word a tiny
    // uppercase label, which reads as "rate this sentence" — the opposite of what the mark does. A sentence
    // telling people otherwise gets skimmed; hierarchy can't be.
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });

    const word = await screen.findByText('good girl', { selector: 'div' });
    const quote = screen.getByText('as in');
    // Structure here; the actual type SIZES are asserted in the E2E, since jsdom doesn't apply CSS modules.
    expect(word).toBeInTheDocument();
    expect(quote).toBeInTheDocument();
    // The word comes FIRST in the row, and the quote is explicitly labelled as illustration.
    expect(word.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
