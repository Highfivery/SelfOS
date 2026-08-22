import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdaptiveBankView, AdaptiveStateView } from '@shared/schemas';
import { installMockBridge } from '../../../test-utils/bridge';
import { SKIPPED_ANSWER } from '@selfos/core/schemas';
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

/**
 * 74 §3.6.1 — clear the two-tap practice, which stands between Begin and the deck.
 *
 * The fixture bank has exactly one word-with-a-quote entry, so the practice is a single beat. Its tap is a REAL
 * mark (that is the point), so it marks "it's okay" — the deck tests then set their own mark over it, and no
 * assertion about a final payload is disturbed.
 */
async function pastPractice(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: "good girl — it's okay" }));
  await userEvent.click(screen.getByRole('button', { name: 'Start marking' }));
}

/**
 * 74 §3.6.9 — Begin now lands on the MAP, which is the take's front door: every step, its state, and a tap into
 * any of them. From there its primary enters the first step that has nothing in it yet. Fixtures here mock no
 * name registers, so the names step bounces straight through to the words (free — `loadNames` makes no AI call).
 */
async function beginTake(label: RegExp = /^Begin$/): Promise<void> {
  // 74 §3.6.30 — a take with prior work opens straight on the MAP, so the intro exists only for a genuinely
  // untouched one. Wait for whichever entry point this fixture produces rather than assuming the intro.
  await waitFor(() => {
    expect(
      screen.queryByRole('button', { name: label }) ??
        screen.queryByRole('button', { name: /^(Start|Pick up):/ }),
    ).not.toBeNull();
  });
  const intro = screen.queryByRole('button', { name: label });
  if (intro) await userEvent.click(intro);
  await userEvent.click(await screen.findByRole('button', { name: /^(Start|Pick up):/ }));
}

/**
 * Enough marked material for a generating step to be worth running (74 §3.6.9). Below this the AI steps are
 * deliberately blocked — running one on two or three marks gives the model nothing of the person's to draw on.
 */
/**
 * Enough to clear the §3.6.9 readiness gate: 15 marks, at least 3 of them a yes.
 *
 * Counted per DIRECTION since §3.6.26, so each entry carries two — which is also what the gate now sees.
 */
const ENOUGH_MARKS: Record<
  string,
  { hear?: 'love' | 'okay' | 'never'; say?: 'love' | 'okay' | 'never' }
> = Object.fromEntries(
  Array.from({ length: 16 }, (_, i) => {
    const mark = i < 5 ? ('love' as const) : ('okay' as const);
    return [`seed:${i}`, { hear: mark, say: mark }] as const;
  }),
);

/**
 * 74 §3.6.35 — a fake that RECORDS the pass, the way the bridge does.
 *
 * The three AI steps render their set from the take's own turns now, because holding a generated set in
 * renderer state alone is what made it disposable. So a fake that only returns `{lines}` from the phase call
 * and never puts them on the draft is not a fake of the real thing — it is a fake of the bug. This mirrors
 * `stampOffers`: the phase reply lands on the draft as answerless turns, and `testsAdaptiveState` hands them
 * back on the re-read the store does next.
 */
function offering(): {
  view: () => AdaptiveStateView;
  offer: (phase: string, items: { id: string; text: string; options?: string[] }[]) => void;
  answer: (phase: string, id: string, answer: string) => void;
  /** The bridge's tombstone: the row stays so it cannot be re-offered, the answer goes with it. */
  remove: (phase: string, id: string) => void;
} {
  let turns: NonNullable<AdaptiveStateView['draft']>['turns'] = [];
  const view = (): AdaptiveStateView => state({ draft: { ...DRAFT, turns: [...(turns ?? [])] } });
  return {
    view,
    offer: (phase, items) => {
      const known = new Set((turns ?? []).filter((t) => t.phase === phase).map((t) => t.item.id));
      turns = [
        ...(turns ?? []),
        ...items
          .filter((item) => !known.has(item.id))
          .map((item) => ({
            phase,
            item: { id: item.id, pack: phase, text: item.text, options: item.options ?? [] },
            at: 'now',
          })),
      ];
    },
    answer: (phase, id, given) => {
      turns = (turns ?? []).map((t) =>
        t.phase === phase && t.item.id === id ? { ...t, answer: given } : t,
      );
    },
    remove: (phase, id) => {
      turns = (turns ?? []).map((t) =>
        t.phase === phase && t.item.id === id
          ? { phase: t.phase, item: t.item, at: t.at, deleted: true }
          : t,
      );
    },
  };
}

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
    await beginTake();
    await pastPractice();

    // The marking rules live behind one link now, instead of four paragraphs on every one of 36 areas.
    await userEvent.click(await screen.findByRole('button', { name: /How marking works/i }));
    expect(screen.getByText(/nothing in SelfOS will suggest it again/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'good girl — Them → You — love it' }));

    await userEvent.click(screen.getByRole('button', { name: /Next area/ }));
    // The taboo family carries its roleplay framing wherever it appears (74 §8.1).
    expect(screen.getByText(/PRE-AGREED, SAFEWORDED ROLEPLAY/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'run (primal) — Them → You — never' }),
    );
    // The rail tallies per mark now, rather than one "N marked so far" line.
    // The rail tallies per mark now, rather than one "N marked so far" line.
    expect(screen.getByTestId('tally-love')).toHaveTextContent('1');
    expect(screen.getByTestId('tally-never')).toHaveTextContent('1');

    await userEvent.click(screen.getByRole('button', { name: /Done with the words →/ }));
    await waitFor(() =>
      expect(bankPass).toHaveBeenCalledWith(
        expect.objectContaining({
          // Nested `objectContaining`: the practice sheet's own tap is a real mark on a real entry, so the
          // payload legitimately carries a side this test never touched.
          marks: expect.objectContaining({
            'names-power:good-girl': expect.objectContaining({ hear: 'love' }),
            'taboo:run-primal': expect.objectContaining({ hear: 'never' }),
          }),
        }),
      ),
    );
  });

  it('shows live progress on an AI phase — never a bare spinner (CLAUDE.md §12)', async () => {
    let resolveLines: (value: {
      ok: boolean;
      lines: string[];
      degraded: boolean;
    }) => void = () => {};
    const take = offering();
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(take.view()),
      testsAdaptiveStart: () => Promise.resolve(take.view()),
      testsAdaptiveLines: () =>
        new Promise((resolve) => {
          resolveLines = resolve;
        }) as never,
    });
    renderTake();
    // A draft is already in flight, so the intro offers to pick it up rather than begin.
    await beginTake(/Pick up where you left off/i);
    useAdaptiveTestStore.setState({ phase: 'lines', marks: ENOUGH_MARKS });
    void useAdaptiveTestStore.getState().loadLines('dirty-talk', 1);

    // Two live regions can be on screen at once now — the autosave's "Saved" and this — so match the progress
    // one by its own text rather than taking whichever `status` comes first.
    const status = await screen.findByText(/Writing lines for you/);
    expect(status).toHaveTextContent(/elapsed/);
    // The bridge records the round before the renderer ever sees it, so the fake does too.
    take.offer('lines', [{ id: 'good girl, just like that', text: 'good girl, just like that' }]);
    resolveLines({ ok: true, lines: ['good girl, just like that'], degraded: false });
    expect(await screen.findByText(/good girl, just like that/)).toBeInTheDocument();
  });

  // --- 74 §3.6.1 — the practice sheet ---

  it('will not open the deck until the practice tap lands, and counts that tap', async () => {
    const bankPass = vi.fn(() => Promise.resolve(state({ draft: DRAFT })));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: bankPass as never,
    });
    renderTake();
    await beginTake();

    // The rule is the FIRST thing on the sheet and the largest — three attempts at saying it in body copy
    // were skimmed, so it leads as the heading.
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('heading', { level: 2 })).toHaveTextContent(
      /marking the word, not the phrase/i,
    );
    // Required, not dismissible: no way into the deck until a mark actually lands.
    expect(within(sheet).getByRole('button', { name: 'Start marking' })).toBeDisabled();

    await userEvent.click(within(sheet).getByRole('button', { name: "good girl — it's okay" }));
    // The practice tap is a REAL mark — it is autosaved like any other, not a throwaway demo.
    await waitFor(() =>
      expect(bankPass).toHaveBeenCalledWith(
        expect.objectContaining({
          // The SAY side: `pickBeats` demonstrates that direction first, and since §3.6.26 the practice tap
          // lands on the direction its own beat showed rather than marking the whole entry.
          marks: expect.objectContaining({
            'names-power:good-girl': expect.objectContaining({ say: 'okay' }),
          }),
          autosave: true,
        }),
      ),
    );

    await userEvent.click(within(sheet).getByRole('button', { name: 'Start marking' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // …and it does not come back mid-take, because the tap it required is itself a mark.
    await userEvent.click(screen.getByRole('button', { name: /Next area/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is skipped once ANY term has been marked — practised once ever, not every sitting', async () => {
    // What "already marked" means in the store: the lexicon carries an entry for the term (74 §3.5 seeds the
    // deck from it), so a retake or a resumed sitting skips the practice — it is done once, ever.
    const resumed = state({
      draft: DRAFT,
      lexicon: {
        ...state().lexicon,
        entries: [
          {
            key: 'names-power:good-girl',
            text: 'good girl',
            kind: 'word' as const,
            family: 'names-power',
            tier: 2,
            hear: 4,
            say: 4,
            // Loved BOTH ways. Since §3.6.26 the mark is what carries that; the ratings are derived from it,
            // and an entry with ratings and no mark is pre-Option-B data that `readLexicon` clears.
            hearState: 'love' as const,
            sayState: 'love' as const,
            source: 'test:r1',
          },
        ],
      },
    });
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(resumed),
      testsAdaptiveStart: () => Promise.resolve(resumed),
    });
    renderTake();
    await beginTake(/Pick up where you left off/i);
    expect(await screen.findByText(/Area 1 of 2/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // --- 74 §3.4 — every tap saves itself ---

  it('does NOT grey the row when only ONE direction is a no (74 §3.6.26)', async () => {
    // Owner-reported. The row read as spent the moment either side was ruled out, because the whole-row test
    // defaulted an UNANSWERED side to `never` — so "never say this to me" greyed a row whose other half was
    // still blank, or loved. The two directions are separate answers; only both-no is an empty row.
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: (() => Promise.resolve(state({ draft: DRAFT }))) as never,
    });
    renderTake();
    await beginTake();
    await pastPractice();

    // A term the PRACTICE did not touch. `good girl` is no good here: the practice sheet's own beats mark it,
    // so its other side already carries an `okay` and even the buggy rule came out false — a guard that
    // passes against the bug it exists to catch (caught by actually running the revert).
    await userEvent.click(screen.getByRole('button', { name: /Next area/ }));
    const row = (): HTMLElement => {
      const btn = screen.getByRole('button', { name: 'run (primal) — Them → You — never' });
      const found = btn.closest('div[class*="row"]');
      if (!found) throw new Error('no row around the mark');
      return found as HTMLElement;
    };
    await userEvent.click(
      screen.getByRole('button', { name: 'run (primal) — Them → You — never' }),
    );
    // One side ruled out, the other untouched — an ordinary answered row, not a spent one.
    expect(row().className).not.toMatch(/rowNo/);

    // ...and ruling out the OTHER side too is what makes it a row with nothing in it.
    await userEvent.click(
      screen.getByRole('button', { name: 'run (primal) — You → Them — never' }),
    );
    expect(row().className).toMatch(/rowNo/);
  });

  it('autosaves each mark without waiting for Next, and says so', async () => {
    const bankPass = vi.fn(() => Promise.resolve(state({ draft: DRAFT })));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: bankPass as never,
    });
    renderTake();
    await beginTake();
    await pastPractice();
    expect(screen.getByText(/Every tap saves itself/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'good girl — Them → You — love it' }));
    // No Next click anywhere in this test — the write happens on its own.
    await waitFor(() =>
      expect(bankPass).toHaveBeenCalledWith(
        expect.objectContaining({
          marks: expect.objectContaining({
            'names-power:good-girl': expect.objectContaining({ hear: 'love' }),
          }),
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
    await beginTake();
    await pastPractice();

    await userEvent.click(screen.getByRole('button', { name: /Next area/ }));
    const never = screen.getByRole('button', { name: 'run (primal) — Them → You — never' });
    await userEvent.click(never);
    await waitFor(() => expect(bankPass).toHaveBeenCalled());
    // Still a live control, not the settled "off the table" row a PRIOR take's boundary renders as.
    expect(
      screen.getByRole('button', { name: 'run (primal) — Them → You — never' }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'run (primal) — Them → You — never' }),
    );
    await waitFor(() =>
      expect(bankPass).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cleared: expect.objectContaining({ 'taboo:run-primal': ['hear'] }),
          autosave: true,
        }),
      ),
    );
    expect(screen.getByTestId('tally-never')).toHaveTextContent('0');
  });

  it('an EARLIER take’s no is re-offered and re-markable — nothing is settled (74 §3.6.11)', async () => {
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
            hearState: 'never' as const,
            sayState: 'never' as const,
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
    await beginTake(/Pick up where you left off/i);
    // No practice sheet here: a no from an earlier take IS a mark, so this person has practised.
    // It lives in the taboo family — the deck shows one area at a time (74 §3.6.4).
    await userEvent.click(await screen.findByRole('button', { name: /Next area/ }));
    // The row is live rather than frozen, and shows the answer they gave.
    expect(screen.queryByText(/off the table/i)).not.toBeInTheDocument();
    const no = await screen.findByRole('button', { name: 'run (primal) — Them → You — never' });
    expect(no).toHaveAttribute('aria-pressed', 'true');
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
    await beginTake();

    expect(await screen.findByText(/who are the two of you/i)).toBeInTheDocument();
    // TWO questions, not four. The "you like being called girl/man" pair is gone: it only ever oriented four
    // anatomy/praise families — a body job — while the vocative question it appeared to ask is answered one
    // step over, by marking 2,215 real names in both directions (74 §3.6.9).
    expect(screen.queryByText(/You like being called/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/likes being called something else/i)).not.toBeInTheDocument();
    const you = screen.getByRole('group', { name: 'You are a:' });
    const them = screen.getByRole('group', { name: 'Your partner is a:' });
    await userEvent.click(within(you).getByRole('button', { name: 'a man' }));
    await userEvent.click(within(them).getByRole('button', { name: 'a woman' }));
    await userEvent.click(screen.getByRole('button', { name: /Next: what you call each other/i }));

    // Identity is stored AND now DERIVES the address axis outright — the body axis depends on it when
    // onboarding has no anatomy answer, which is the whole reason a straight man was being shown "your pussy"
    // to hear.
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
    await beginTake();
    expect(await screen.findByText(/Area 1 of 2/)).toBeInTheDocument();
    expect(screen.queryByText(/who are the two of you/i)).not.toBeInTheDocument();
  });

  it('STATES what it withheld, with a route back — never a silently thinner list', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve({ ...BANK, withheldByFamily: { 'names-power': 14 } }),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await beginTake();
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
    await beginTake();
    await pastPractice();
    // The quote wraps the marked word in a <b>, so it is no longer one text node — which is the point.
    expect(await screen.findByText(/such a/)).toBeInTheDocument();
    expect(screen.getByText('good girl', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText(/for me/)).toBeInTheDocument();
  });

  it('says so and stays put when an AI phase degrades — never relocates them silently (74 §3.6.9)', async () => {
    // It used to JUMP to the next phase on a degraded call, which is indistinguishable from the step having
    // worked: you asked for lines, the screen changed, and nothing said the request had failed. Now the rail
    // owns navigation, so a phase that could not produce anything stays where it is and says why.
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveLines: () => Promise.resolve({ ok: false, degraded: true }),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    // Something marked, or the step is blocked before it can be asked at all.
    useAdaptiveTestStore.setState({ phase: 'lines', marks: ENOUGH_MARKS });
    await userEvent.click(await screen.findByRole('button', { name: /Write them for me/i }));

    expect(useAdaptiveTestStore.getState().phase).toBe('lines');
    expect(useAdaptiveTestStore.getState().busy).toBe(false);
    expect(await screen.findByRole('button', { name: /Try again/i })).toBeInTheDocument();
    // …and the way onward is the rail, not a silent hop.
    expect(
      screen.getByRole('button', { name: /Next: the questions it still has/i }),
    ).toBeInTheDocument();
  });

  it('will not ASK an AI step on arrival — a rail makes that a billed mis-tap (74 §3.6.9)', async () => {
    const lines = vi.fn(() => Promise.resolve({ ok: true, lines: ['x'], degraded: false }));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveLines: lines as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'lines', marks: ENOUGH_MARKS });
    // Arriving is not asking. It also says what it will draw on, and that it costs something.
    expect(await screen.findByRole('button', { name: /Write them for me/i })).toBeInTheDocument();
    expect(screen.getByText(/a little of your AI allowance/i)).toBeInTheDocument();
    expect(lines).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Write them for me/i }));
    await waitFor(() => expect(lines).toHaveBeenCalled());
  });

  it('blocks an AI step that has nothing to work from, with the reason and no spend', async () => {
    const lines = vi.fn(() => Promise.resolve({ ok: true, lines: ['x'], degraded: false }));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveLines: lines as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'map' });
    const rail = await screen.findByRole('button', { name: /Lines written for you/i });
    // Greyed with its reason rather than a live tap into a paid call that can only come back empty.
    expect(rail).toBeDisabled();
    expect(rail).toHaveTextContent(/marks first/i);
    expect(lines).not.toHaveBeenCalled();
  });

  it('shows every step from the front door, so nothing about the test is a surprise', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    // The reported gap: opening the take said "What do you call each other?" and gave no indication that six
    // more things followed.
    const map = await screen.findByRole('list');
    for (const label of [
      /Who you two are/i,
      /What you call each other/i,
      /^The words/i,
      /Lines written for you/i,
      /The questions it still has/i,
      /In the moment/i,
      /Your profile/i,
    ]) {
      expect(within(map).getByRole('button', { name: label })).toBeInTheDocument();
    }
    // …and the ones that spend say so up front.
    expect(screen.getAllByText(/uses AI/i).length).toBeGreaterThanOrEqual(3);
  });

  it('is navigable BOTH ways from any step — a resumed take is not a one-way door', async () => {
    // The reported dead end: coming back through "pick up where you left off" landed in the AI phase it had
    // reached, with no route back to the words or the names. `setPhase` was called exactly twice in the whole
    // screen, both times to return to `address`.
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'probe', marks: ENOUGH_MARKS });
    const rail = await screen.findByRole('complementary', { name: /The steps/i });
    await userEvent.click(within(rail).getByRole('button', { name: /The words/i }));
    expect(useAdaptiveTestStore.getState().phase).toBe('bank');
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

  it('offers a way back to the map from every step, in the rail (74 §3.6.30)', async () => {
    /*
     * Reported alongside the intro bug: the map was reachable on the way IN and on the way back OUT, and
     * nowhere in between — so someone part-way through had the seven steps listed beside them and no route
     * to the screen that explains what they are.
     */
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: (() => Promise.resolve(state({ draft: DRAFT }))) as never,
    });
    renderTake();
    await beginTake();
    await pastPractice();
    // On a marking step, with the rail beside it.
    expect(await screen.findByRole('list', { name: 'Steps' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Every step' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /All steps/i }));
    expect(await screen.findByRole('list', { name: 'Every step' })).toBeInTheDocument();
  });

  it('opens a DRAFT-only take on the map, not the intro (74 §3.6.30)', async () => {
    /*
     * The reported bug, in the state it was reported from: one result, `status: 'draft'`, no profile.
     *
     * The card calls that "Keep marking" — `cardStateOf` is satisfied by ANY result and `listAdaptiveResults`
     * includes the draft. The take screen used to ask a stricter question: its resume path required
     * `state.latest`, which the bridge defines as the first result whose status is NOT draft. So `latest` was
     * null, the effect returned early, `start()` never ran, and the phase sat on its `intro` initial value.
     * A `latest`-only fixture would pass against the old code too — the draft-only shape is the whole point.
     */
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    expect(await screen.findByRole('list', { name: 'Every step' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Begin$/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Pick up where you left off/i }),
    ).not.toBeInTheDocument();
  });

  it('still shows the intro for a take nobody has touched', async () => {
    // The other half of the rule — the intro is not gone, it is now reserved for a genuinely first take.
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    expect(await screen.findByRole('button', { name: /^Begin$/ })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Every step' })).not.toBeInTheDocument();
  });

  it('offers a way back to the top — quiet, and off the button everybody taps', async () => {
    const abandon = vi.fn(() => Promise.resolve());
    const setArea = vi.fn(() => Promise.resolve());
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveAbandon: abandon as never,
      testsAdaptiveSetArea: setArea as never,
    });
    renderTake();
    // It wipes every mark and every hard no for this person, so it does not sit shoulder to shoulder with
    // "pick up where you left off" — it is at the bottom of the map, with what it clears spelled out.
    // 74 §3.6.30 — a take with prior work opens ON the map, so the step list is what greets them.
    expect(await screen.findByRole('list', { name: 'Every step' })).toBeInTheDocument();
    expect(await screen.findByText(/every hard no for this test/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Start over from the top/i }));
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
    await beginTake();
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
    expect(screen.getByText(/hard cock through your jeans/)).toBeInTheDocument();
  });

  it('puts the deck actions in a rail, so finishing never means scrolling 47 rows', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });
    const rail = await screen.findByRole('complementary', { name: /The steps/i });
    expect(within(rail).getByRole('button', { name: /Next area/ })).toBeInTheDocument();
    expect(
      within(rail).getByRole('button', { name: /Done with the words for now/ }),
    ).toBeInTheDocument();
    /*
     * 74 §3.6.34 — where you ARE, never how far along you are.
     *
     * This used to assert a progressbar. It filled toward 100% as you moved through the areas and reached
     * full on the last one whether you had marked everything or nothing — a meter filling toward a full
     * width, which is the thing the durable no-completion rule names, and which §3.6.29 had already removed
     * from the name register cards while leaving it here. The COUNT survives: the rule's line is a
     * denominator paired with a meter, not a count.
     */
    expect(screen.getByText(/Area 1 of 2/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  /*
   * 74 §3.6.34 — the SAME "still unmarked" the names step has, in the same place, in the same words.
   *
   * Both marking screens have the same second-visit problem — 36 areas of up to 47 lines here, a 123-name
   * register there — and they were drifting into different shapes, which is what this section exists to stop.
   */
  /*
   * 74 §3.6.34 — the words step counts the words step's OWN rows.
   *
   * There is ONE lexicon per person: the deck's marks and the pet names' marks are written into the same
   * `entries`. Seeding `store.marks` from all of them made it a SUPERSET of `nameMarks` rather than its
   * sibling, and four numbers read it as "the words step's marks" — the rail's "N of M shown here" (whose
   * denominator is deck-only, so it could exceed 100%), the rail's trailing "N words", `bankTally`, and
   * `stepStatuses`' `nameMarks + bankMarks`, which counted every marked name twice against a bridge that
   * counts each entry once. Measured on the owner's real vault before the fix: the words step said
   * "320 of 924 shown here" when he had marked 22 words.
   */
  it('does not count a pet name as a marked WORD', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () =>
        Promise.resolve(
          state({
            lexicon: {
              ...state().lexicon,
              entries: [
                // One real deck row from this step…
                {
                  key: 'taboo:run-primal',
                  text: 'run (primal)',
                  family: 'taboo',
                  kind: 'phrase',
                  tier: 5,
                  hear: 3,
                  say: 0,
                  hearState: 'love',
                },
                // …and a pet name, which lives in the same lexicon but is NOT a row of this step.
                {
                  key: 'names-warm:babydoll',
                  text: 'babydoll',
                  family: 'names-warm',
                  kind: 'word',
                  tier: 2,
                  hear: 3,
                  say: 3,
                  hearState: 'love',
                  sayState: 'love',
                },
              ],
            },
          }),
        ),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });
    await screen.findByRole('complementary', { name: /The steps/i });

    // ONE marked word, not two. The denominator is this step's own rows, so the two must be comparable.
    expect(screen.getByText(/1 of 2 shown here/)).toBeInTheDocument();
    // And the name's two loves are not counted as words: the deck row contributes exactly one.
    expect(screen.getByTestId('tally-love')).toHaveTextContent('1');
  });

  it('filters an area to what is still unmarked, and resets on the next area', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });
    await screen.findByRole('complementary', { name: /The steps/i });
    /*
     * Wait for the PRACTICE to settle before counting. This test deliberately does not call
     * `pastPractice()` (its row must start unmarked), so the sheet is up — and its own tap is named
     * `good girl — love it`, with no direction segment, so it matches the loose `/— love it$/` count
     * below but neither of the split matchers. `practice` latches in an effect off `store.marks`, so
     * under load the count can be taken one render BEFORE the sheet mounts and then compared against a
     * later render that includes it (a real intermittent failure: "expected 3 to be 2"). The rail is
     * not a sufficient signal — it renders first.
     */
    await screen.findByRole('button', { name: "good girl — it's okay" });
    const before = screen.getAllByRole('button', { name: /— love it$/ }).length;
    expect(before).toBeGreaterThan(1);

    /*
     * OWNER-REPORTED, 2026-08-20 — one side is not an answer to a two-sided row. The first version of this
     * filter dropped a row as soon as it had ANY mark, so a half-answered row hid itself from the one view
     * whose job is to find it (§3.6.11's distinction, at the view layer).
     */
    // Asserted, not assumed: a conditional here would go vacuous the moment the fixture changed.
    const hear = screen.getAllByRole('button', { name: /— Them → You — love it$/ });
    const say = screen.getAllByRole('button', { name: /— You → Them — love it$/ });
    expect(hear.length).toBeGreaterThan(0);
    expect(say.length).toBeGreaterThan(0);

    await userEvent.click(hear[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Still unmarked' }));
    // Half-answered: it must STILL be here.
    expect(screen.getAllByRole('button', { name: /— love it$/ }).length).toBe(before);

    // …and once the other side is answered, it goes.
    await userEvent.click(screen.getByRole('button', { name: 'Everything' }));
    await userEvent.click(screen.getAllByRole('button', { name: /— You → Them — love it$/ })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Still unmarked' }));
    expect(screen.getAllByRole('button', { name: /— love it$/ }).length).toBeLessThan(before);

    // A new area starts unfiltered — arriving on a filtered empty list reads as a broken area.
    const rail = await screen.findByRole('complementary', { name: /The steps/i });
    await userEvent.click(within(rail).getByRole('button', { name: /Next area/ }));
    expect(screen.getByRole('button', { name: 'Everything' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('turns a rejected LINE into a boundary only on a second, deliberate tap', async () => {
    // A plain "no" means "this line doesn't land" and must not mint a boundary — a boundary is permanent and
    // lifts only by an explicit act. The escape is what catches "the word is fine, not like that".
    const edit = vi.fn(() => Promise.resolve(null));
    const take = offering();
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(take.view()),
      testsAdaptiveLines: () => {
        take.offer('lines', [
          { id: 'I want to beat that pussy', text: 'I want to beat that pussy' },
        ]);
        return Promise.resolve({ ok: true, lines: ['I want to beat that pussy'], degraded: false });
      },
      testsAdaptiveTurn: ((input: { itemId: string; answer: string }) => {
        take.answer('lines', input.itemId, input.answer);
        return Promise.resolve(undefined);
      }) as never,
      testsLexiconEdit: edit as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'lines', marks: ENOUGH_MARKS });
    await useAdaptiveTestStore.getState().loadLines('dirty-talk', 1);

    // Before the reaction there is no escape at all.
    expect(screen.queryByRole('button', { name: /Never anything like this/i })).toBeNull();
    await userEvent.click(
      // The mark's own words. The lines step uses the marking steps' control now, and a line reaction is
      // NOT a boundary — the ban below it is — so this one reads "not this one" rather than the deck's
      // "never", which would name the very thing the second tap exists to do (74 §3.6.35).
      await screen.findByRole('button', { name: 'I want to beat that pussy — not this one' }),
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
      testsAdaptiveBank: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank' });
    // The practice sheet demonstrates the same row, so clear it before measuring the deck's own.
    await pastPractice();

    const word = await screen.findByText('good girl', { selector: 'div' });
    const quote = screen.getByText('as in');
    // Structure here; the actual type SIZES are asserted in the E2E, since jsdom doesn't apply CSS modules.
    expect(word).toBeInTheDocument();
    expect(quote).toBeInTheDocument();
    // The word comes FIRST in the row, and the quote is explicitly labelled as illustration.
    expect(word.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // --- 74 §3.6.10 — the retake choice ---

  it('asks FIRST on a retake: keep and edit, or start fresh', async () => {
    const abandon = vi.fn(() => Promise.resolve());
    const done = state({
      draft: DRAFT,
      latest: { ...DRAFT, status: 'complete' as const },
      lexicon: {
        ...state().lexicon,
        entries: [
          {
            key: 'names-power:good-girl',
            text: 'good girl',
            kind: 'word' as const,
            family: 'names-power',
            tier: 2,
            hear: 4,
            say: 4,
            source: 'test:r0',
          },
        ],
      },
    });
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(done),
      testsAdaptiveStart: () => Promise.resolve(done),
      testsAdaptiveAbandon: abandon as never,
    });
    renderTake();
    // 74 §3.6.30 — opens on the map, which puts the retake choice up first rather than behind an intro.

    // Before anything else — not the step list, and not a destructive button at the bottom of a screen
    // nobody scrolls to.
    expect(await screen.findByRole('heading', { name: /Taking it again/i })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Every step' })).not.toBeInTheDocument();
    // What "start fresh" costs is stated, and it takes two taps.
    expect(screen.getByText(/every hard no/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Start fresh$/ }));
    expect(abandon).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Yes, clear it all/i }));
    await waitFor(() => expect(abandon).toHaveBeenCalled());
  });

  it('keeps everything when they choose to edit — and does not ask twice', async () => {
    const abandon = vi.fn(() => Promise.resolve());
    const done = state({ draft: DRAFT, latest: { ...DRAFT, status: 'complete' as const } });
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(done),
      testsAdaptiveStart: () => Promise.resolve(done),
      testsAdaptiveAbandon: abandon as never,
    });
    renderTake();
    // 74 §3.6.30 — opens on the map, which puts the retake choice up first rather than behind an intro.
    await userEvent.click(await screen.findByRole('button', { name: /Keep and edit/i }));

    // Straight to the map, with nothing cleared.
    expect(await screen.findByRole('list', { name: 'Every step' })).toBeInTheDocument();
    expect(abandon).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: /Taking it again/i })).not.toBeInTheDocument();
  });

  it('never asks on a FIRST take — there is nothing to keep or clear', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    expect(await screen.findByRole('list', { name: 'Every step' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Taking it again/i })).not.toBeInTheDocument();
  });
});

describe('a failed AI phase says so — it never wears a success (74 §3.6.12)', () => {
  it('does not report a failed probe as "nothing left to ask"', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      // The bridge returns `done` whether it exhausted the ambiguities or the call failed. Folding the two
      // together printed a failure in the words of a success: "everything you marked was clear enough that
      // it has no question to ask — that's this step finished."
      testsAdaptiveProbe: () =>
        Promise.resolve({
          ok: false,
          done: true,
          degraded: true,
          message: 'Nothing usable came back this time — try again.',
        }),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'probe', marks: ENOUGH_MARKS });
    await userEvent.click(await screen.findByRole('button', { name: /Ask me/i }));

    expect(await screen.findByText(/Nothing usable came back/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing left it can/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    // The split itself, not just which branch renders: `done` is the SUCCESS state and a degraded pass must
    // not set it. Asserting only the copy passes even when the two are folded back together.
    expect(useAdaptiveTestStore.getState().probeDone).toBe(false);
  });

  it('says a moment produced nothing instead of returning to the grid in silence', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveScenario: () =>
        Promise.resolve({
          ok: false,
          context: 'buildUp',
          degraded: true,
          message: 'Nothing usable came back this time — try again.',
        }),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'scenario', marks: ENOUGH_MARKS });
    // Tapping a moment used to clear the thinking state and set no scene — the same grid, no scene, no
    // error. It read as a button that does nothing.
    await userEvent.click(await screen.findByRole('button', { name: /Build-up/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Write build-up moments/i }));
    expect(await screen.findByText(/Nothing usable came back/i)).toBeInTheDocument();
  });

  it('picking a category costs nothing — only asking for moments spends (74 §3.6.19)', async () => {
    // The strip is navigation, not a purchase. It used to be a grid where a tap WAS the spend, so there was
    // no way to look at a category — or come back to one you had answered — without paying for five more.
    const scenario = vi.fn(() => Promise.resolve({ ok: true, context: 'edge', degraded: false }));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveScenario: scenario as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'scenario', marks: ENOUGH_MARKS });

    // All six are reachable — `edge`, `sexting` and `phone` were written by the engine and offered nowhere.
    for (const name of ['Build-up', 'During', 'Edge', 'After', 'Sexting', 'Phone']) {
      await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
    }
    expect(scenario).not.toHaveBeenCalled();
  });
});

describe('typing in an answered question does not take the app down (74 §3.6.16)', () => {
  beforeEach(() => useAdaptiveTestStore.getState().reset());
  it('survives a backspace — the value is read before the state updater runs', async () => {
    // A blank white window: reading `e.currentTarget.value` INSIDE a functional setState throws, because the
    // updater runs after the event has been handled and React has nulled `currentTarget` by then. One
    // keystroke in the edit box killed the whole renderer. (`e.target` is NOT nulled, which is why the other
    // updaters in the app that read `target.value` are fine.)
    const draft = {
      id: 'd1',
      schemaVersion: 1,
      testId: 'dirty-talk',
      testVersion: 1,
      kind: 'adaptive',
      status: 'draft',
      subjectPersonId: 'p1',
      answers: [],
      scores: [],
      turns: [
        {
          phase: 'probe',
          item: { id: 'a1', pack: 'probe', text: 'What lands for you?', options: [] },
          answer: 'ab',
          at: 'x',
        },
      ],
      takenAt: 'x',
      createdAt: 'x',
      updatedAt: 'x',
    };
    installMockBridge({
      testsBank: () => Promise.resolve({ families: [], entries: [] }) as never,
      testsAdaptiveState: () =>
        Promise.resolve({
          testId: 'dirty-talk',
          title: 'T',
          blurb: 'b',
          framing: 'f',
          estimatedMinutes: 15,
          draft,
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
            updatedAt: 'x',
          },
          ambiguitiesLeft: 1,
          staleForRetake: false,
        }) as never,
    });
    render(
      <MemoryRouter initialEntries={['/tests/dirty-talk/take']}>
        <AdaptiveTake />
      </MemoryRouter>,
    );
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'probe', marks: ENOUGH_MARKS });
    const box = await screen.findByLabelText(/Your answer to: What lands/i);
    await userEvent.click(box);
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}');
    expect(box).toBeInTheDocument();
  });
});

describe('every new control on the AI steps actually works (74 §3.6.16)', () => {
  const draftWith = (turns: unknown[]) => ({
    ...DRAFT,
    turns,
  });

  it('shows every answered question, and saving an edit writes it', async () => {
    const turn = vi.fn(() => Promise.resolve(undefined));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () =>
        Promise.resolve(
          state({
            draft: draftWith([
              {
                phase: 'probe',
                item: { id: 'a1', pack: 'probe', text: 'First question?', options: [] },
                answer: 'my answer',
                at: 'x',
              },
            ]) as never,
          }),
        ),
      testsAdaptiveTurn: turn as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'probe', marks: ENOUGH_MARKS });

    // The whole set is on screen, not one question with no way back to the last.
    const box = await screen.findByLabelText(/Your answer to: First question/i);
    expect(box).toHaveValue('my answer');
    await userEvent.type(box, ' — changed');
    await userEvent.click(screen.getByRole('button', { name: /Save this answer/i }));
    expect(turn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'probe', itemId: 'a1', answer: 'my answer — changed' }),
    );
  });

  it('lists every moment, marks the one you picked, and lets you change it', async () => {
    const turn = vi.fn(() => Promise.resolve(undefined));
    const take = offering();
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(take.view()),
      testsAdaptiveTurn: turn as never,
      testsAdaptiveScenario: () => {
        // As the bridge does: the moments are on the draft before anyone picks anything, which is what makes
        // an unpicked one survive (74 §3.6.35).
        take.offer('scenario', [
          { id: 'buildUp#A moment.', text: 'A moment.', options: ['say this', 'or this'] },
          { id: 'buildUp#Another moment.', text: 'Another moment.', options: ['third', 'fourth'] },
        ]);
        return Promise.resolve({
          ok: true,
          context: 'buildUp',
          degraded: false,
          scene: 'A moment.',
          options: ['say this', 'or this'],
          scenes: [
            { scene: 'A moment.', options: ['say this', 'or this'] },
            { scene: 'Another moment.', options: ['third', 'fourth'] },
          ],
        });
      },
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'scenario', marks: ENOUGH_MARKS });
    await userEvent.click(await screen.findByRole('button', { name: /^Build-up/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Write build-up moments/i }));

    // More than one moment per pass — one at a time meant a call per scene and no sense of a set.
    expect(await screen.findByText('A moment.')).toBeInTheDocument();
    expect(screen.getByText('Another moment.')).toBeInTheDocument();
    // …and there is a way to get more, rather than one pass and done.
    expect(
      screen.getByRole('button', { name: /Write more build-up moments/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'or this' }));
    // The OPTIONS travel with the turn (74 §3.6.19). They were hardcoded `[]`, so the scene survived and the
    // choices did not — which is what made an answered moment impossible to re-open or re-pick.
    expect(turn).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'scenario',
        answer: 'or this',
        options: ['say this', 'or this'],
      }),
    );
  });

  it('shows the take’s running spend to an admin, and jumps straight to an area (74 §3.6.21/§3.6.22)', async () => {
    // The take is the most expensive thing in the app and every step priced itself as "a little of your AI
    // allowance" — an adjective, seven times, while the real total sat unread on the draft. `costUsd` is
    // redacted at the bridge for anyone without `budgets.manage`, so its presence IS the admin gate.
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () =>
        Promise.resolve(state({ draft: { ...DRAFT, costUsd: 0.3142 } as never })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank', marks: ENOUGH_MARKS });

    expect(await screen.findByText('$0.31')).toBeInTheDocument();
    expect(screen.getAllByText(/Admin only/i).length).toBeGreaterThan(0);

    // …and 36 areas with only prev/next meant twenty taps to revisit one. A Select, not a chip row (§12).
    const jump = await screen.findByLabelText('Go to an area');
    expect(jump).toBeInTheDocument();
  });

  it('hides the spend entirely when the bridge redacted it (74 §3.6.21)', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'bank', marks: ENOUGH_MARKS });

    await screen.findByLabelText('Go to an area');
    expect(screen.queryByText(/Spent so far/i)).not.toBeInTheDocument();
  });

  it('the profile step waits to be asked instead of spending on arrival', async () => {
    const synth = vi.fn(() => Promise.resolve(state()));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveSynthesize: synth as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'map', marks: ENOUGH_MARKS });

    await userEvent.click(
      within(await screen.findByRole('list', { name: 'Every step' })).getByRole('button', {
        name: /Your profile/i,
      }),
    );
    // Navigating to the most expensive step used to RUN it — the one step you could not look at without
    // paying for it — and, once `done`, it had no view of its own and rendered a blank page.
    expect(synth).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Write my profile/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Write my profile/i }));
    expect(synth).toHaveBeenCalled();
  });
});

/**
 * 74 §3.6.35 — the three AI steps show everything they generated, in one shape.
 *
 * Each of them used to show a different slice of its own set: the lines step showed the current round plus
 * whatever had a reaction, the probe step filtered to answered questions only, and the moments step showed
 * whatever this sitting happened to fetch. Nothing you passed over was reachable, and nothing you ignored
 * survived a reload.
 */
describe('74 §3.6.35 — the generated set is reviewable and changeable', () => {
  it('shows a question you skipped, says so, and still lets you answer it', async () => {
    const take = offering();
    take.offer('probe', [
      { id: 'a#answered', text: 'Is it the word, or who says it?', options: ['the word', 'who'] },
      { id: 'a#skipped', text: 'What phrasing kills it?', options: ['rehearsed', 'baby talk'] },
      { id: 'a#open', text: 'Before, or during?', options: ['before', 'during'] },
    ]);
    take.answer('probe', 'a#answered', 'the word');
    take.answer('probe', 'a#skipped', SKIPPED_ANSWER);
    const turn = vi.fn(() => Promise.resolve(undefined));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(take.view()),
      testsAdaptiveTurn: turn as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'probe', marks: ENOUGH_MARKS });

    // All three are on screen. The skipped one used to be filtered off it entirely — recorded, and
    // unreachable — while the rail went on counting it as asked.
    expect(await screen.findByText('Is it the word, or who says it?')).toBeInTheDocument();
    expect(screen.getByText('What phrasing kills it?')).toBeInTheDocument();
    expect(screen.getByText('Before, or during?')).toBeInTheDocument();
    // A skip is still not an answer (74 §3.6.17) — it is labelled as what it is.
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.getByText(/You passed over this one/)).toBeInTheDocument();

    // …and it is answerable, which is the whole point of keeping it.
    await userEvent.click(screen.getByRole('button', { name: 'baby talk' }));
    expect(turn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'probe', itemId: 'a#skipped', answer: 'baby talk' }),
    );
  });

  it('filters to what has not been answered, without ever showing a fraction', async () => {
    const take = offering();
    take.offer('lines', [
      { id: 'reacted', text: 'a line you answered' },
      { id: 'untouched', text: 'a line you did not' },
    ]);
    take.answer('lines', 'reacted', 'love');
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(take.view()),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'lines', marks: ENOUGH_MARKS });

    expect(await screen.findByText(/a line you answered/)).toBeInTheDocument();
    expect(screen.getByText('2 lines')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Not answered yet' }));
    expect(screen.queryByText(/a line you answered/)).toBeNull();
    expect(screen.getByText(/a line you did not/)).toBeInTheDocument();
    // A COUNT, never a fraction (74 §3.6.29) — "1 of 2" would pair it with a total and make the completion
    // claim the durable rule forbids.
    const count = screen.getByText('1 not answered');
    expect(count).toBeInTheDocument();
    // Scoped to the filter's OWN row: page-wide this catches "Step 4 of 7" in the eyebrow, which is a
    // POSITION and stays (74 §3.6.29 — the rule's line is the denominator, not the count).
    expect(count.parentElement?.textContent ?? '').not.toMatch(/\d+ of \d+/);
  });

  it('deletes a question behind a confirm — and it does not come back', async () => {
    // OWNER-REPORTED: "there should be a way to delete questions, not just skip them." A skip keeps the
    // question on screen and answerable; this takes it away for good (74 §3.6.37).
    const take = offering();
    take.offer('probe', [
      { id: 'a#keep', text: 'A question worth keeping', options: ['yes'] },
      { id: 'a#bad', text: 'A nonsense question', options: ['yes'] },
    ]);
    take.answer('probe', 'a#bad', 'something I typed');
    const del = vi.fn(() => Promise.resolve(undefined));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(take.view()),
      testsAdaptiveDeleteTurn: del as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'probe', marks: ENOUGH_MARKS });
    expect(await screen.findByText('A nonsense question')).toBeInTheDocument();

    // Two-step: the first tap arms, it does not delete.
    const cards = screen.getAllByRole('button', { name: /^Delete$/ });
    await userEvent.click(cards[1]!);
    expect(del).not.toHaveBeenCalled();
    // …and it says what removing an ANSWERED one costs, rather than doing it silently.
    expect(screen.getByText(/stops feeding your profile/)).toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole('group', { name: /Delete this question/ })).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(del).toHaveBeenCalledWith(expect.objectContaining({ phase: 'probe', itemId: 'a#bad' }));
  });

  it('keeps a deleted item off the screen and out of the rail count', async () => {
    // The tombstone stays on the record so the phase can never re-offer it — but it must be invisible, and
    // the rail must agree with the screen (the §3.6.35 disagreement, from the other side).
    const take = offering();
    take.offer('probe', [
      { id: 'a#kept', text: 'Still here', options: [] },
      { id: 'a#gone', text: 'Deleted question', options: [] },
    ]);
    take.remove('probe', 'a#gone');
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(take.view()),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'probe', marks: ENOUGH_MARKS });

    expect(await screen.findByText('Still here')).toBeInTheDocument();
    expect(screen.queryByText('Deleted question')).toBeNull();
    // One asked, not two — on the screen AND in the rail. Both are asserted in their own region: the two
    // reading the same number is the entire point, so a page-wide matcher finds both and goes ambiguous.
    const rail = screen.getByRole('complementary', { name: /The steps/i });
    expect(within(rail).getByRole('button', { name: /questions it still has/i })).toHaveTextContent(
      '1 asked',
    );
    const filter = screen.getByRole('group', { name: 'Show' }).parentElement!;
    expect(filter).toHaveTextContent('1 asked');
  });

  it('lets a moment be skipped and deleted, not only answered', async () => {
    // OWNER-REPORTED: "in the moment options should be skippable and deletable." It had neither.
    const take = offering();
    take.offer('scenario', [
      { id: 'buildUp#A moment.', text: 'A moment.', options: ['say this', 'or this'] },
    ]);
    const turn = vi.fn(() => Promise.resolve(undefined));
    const del = vi.fn(() => Promise.resolve(undefined));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(take.view()),
      testsAdaptiveTurn: turn as never,
      testsAdaptiveDeleteTurn: del as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'scenario', marks: ENOUGH_MARKS });
    await userEvent.click(await screen.findByRole('button', { name: /^Build-up/ }));
    expect(await screen.findByText('A moment.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Skip this one' }));
    // Recorded as a skip on the moment's OWN id, so it lands on the offer rather than adding a second turn.
    expect(turn).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'scenario',
        itemId: 'buildUp#A moment.',
        answer: SKIPPED_ANSWER,
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    await userEvent.click(
      within(screen.getByRole('group', { name: /Delete this moment/ })).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(del).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'scenario', itemId: 'buildUp#A moment.' }),
    );
  });

  it('says a line is ruled out once it is, and offers the way back', async () => {
    // The ban wrote a real boundary and changed nothing on screen: same link, same words, still enabled. And
    // until `removeBoundary` there was nothing anywhere in the app that could lift it (74 §3.2/§3.6.35).
    const take = offering();
    take.offer('lines', [{ id: 'a ruled-out line', text: 'a ruled-out line' }]);
    take.answer('lines', 'a ruled-out line', 'no');
    const banned = state({
      draft: take.view().draft,
      lexicon: {
        ...take.view().lexicon,
        boundaries: [{ text: 'a ruled-out line', kind: 'theme' as const, at: 'now' }],
      },
    });
    const edit = vi.fn(() => Promise.resolve(banned.lexicon));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(banned),
      testsLexiconEdit: edit as never,
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'lines', marks: ENOUGH_MARKS });

    // The row SAYS it, rather than offering the same tap again as though nothing had happened.
    expect(await screen.findByText('Ruled out')).toBeInTheDocument();
    expect(screen.getByText(/Nothing in SelfOS will say this/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Never anything like this/i })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(edit).toHaveBeenCalledWith({ kind: 'removeBoundary', text: 'a ruled-out line' });
  });
});
