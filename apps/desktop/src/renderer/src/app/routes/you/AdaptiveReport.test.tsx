import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdaptiveStateView } from '@shared/schemas';
import { installMockBridge } from '../../../test-utils/bridge';
import { useAdaptiveTestStore } from '../../../stores/adaptiveTestStore';
import { AdaptiveReport } from './AdaptiveReport';

function result(id: string, takenAt: string, filth: number) {
  return {
    id,
    schemaVersion: 1,
    testId: 'dirty-talk',
    testVersion: 1,
    kind: 'adaptive' as const,
    status: 'complete' as const,
    subjectPersonId: 'p1',
    answers: [],
    scores: [
      { key: 'dirtytalk.explicitness', raw: filth, normalized: filth, band: 'high' },
      { key: 'dirtytalk.claiming', raw: 0.5, normalized: 0.5, band: 'medium' },
    ],
    takenAt,
    createdAt: takenAt,
    updatedAt: takenAt,
  };
}

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

function renderReport(): void {
  render(
    <MemoryRouter initialEntries={['/tests/dirty-talk']}>
      <Routes>
        <Route path="/tests/:testId" element={<AdaptiveReport />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdaptiveReport (74 §3.3)', () => {
  beforeEach(() => {
    useAdaptiveTestStore.getState().reset();
  });

  it('charts the spine across retakes — the whole reason the spine is fixed', async () => {
    // Without this the report showed only the newest take, so a retake produced a comparable number that
    // nothing in the app ever compared.
    const takes = [
      result('r2', '2026-08-10T00:00:00Z', 0.9),
      result('r1', '2026-06-01T00:00:00Z', 0.4),
    ];
    installMockBridge({
      testsAdaptiveState: () => Promise.resolve(state({ latest: takes[0]!, history: takes })),
    });
    renderReport();
    expect(await screen.findByText('Across your takes')).toBeInTheDocument();
    // One labelled ROW per dimension, each with its own sparkline and its change in words — not four
    // overlapping lines on one axis behind a colour legend (74 §3.6.13).
    expect(
      screen.getByRole('img', { name: /How explicit across your takes/i }),
    ).toBeInTheDocument();
    // Named twice on the page — once in "the shape of it", once as this row's label.
    expect(screen.getAllByText('How explicit').length).toBeGreaterThanOrEqual(2);
    // The change as text is the §9 equivalent, and the thing you actually want from a trend.
    expect(screen.getByText('+50')).toBeInTheDocument();
  });

  it('does not chart a single take — one point is not a trend', async () => {
    const one = [result('r1', '2026-06-01T00:00:00Z', 0.4)];
    installMockBridge({
      testsAdaptiveState: () => Promise.resolve(state({ latest: one[0]!, history: one })),
    });
    renderReport();
    expect(await screen.findByText('The shape of it')).toBeInTheDocument();
    expect(screen.queryByText('Across your takes')).not.toBeInTheDocument();
  });

  it('shows the register + timing the synthesis has been scoring all along', async () => {
    // These were generated on every take, stored, and read by nothing — paid for and discarded.
    const one = [result('r1', '2026-06-01T00:00:00Z', 0.4)];
    installMockBridge({
      testsAdaptiveState: () =>
        Promise.resolve(
          state({
            latest: one[0]!,
            history: one,
            lexicon: {
              ...state().lexicon,
              registers: { claiming: 0.9, degradation: 0.1 },
              contexts: { buildUp: { heat: 0.2, note: 'teasing, no filth' } },
            },
          }),
        ),
    });
    renderReport();
    expect(await screen.findByText('Register & timing')).toBeInTheDocument();
    // Machine keys are never shown raw.
    expect(screen.getByText('Claiming')).toBeInTheDocument();
    expect(screen.getByText('Build-up')).toBeInTheDocument();
    expect(screen.queryByText('buildUp')).not.toBeInTheDocument();
    expect(screen.getByText('teasing, no filth')).toBeInTheDocument();
  });

  it('shows ONE invitation when nothing is taken — not empty headings and two Take it buttons', async () => {
    // It used to render the "you haven't taken this" banner, a Take it button, and then carry on into the
    // rest of the report: an empty "Your words" section with "Love to hear" and "Comfortable saying"
    // headings and nothing under either, plus a SECOND Take it button in the footer.
    installMockBridge({ testsAdaptiveState: () => Promise.resolve(state()) });
    renderReport();
    expect(await screen.findByRole('button', { name: 'Take it' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Take it/ })).toHaveLength(1);
    expect(screen.queryByText('Your words')).not.toBeInTheDocument();
    expect(screen.queryByText('Love to hear')).not.toBeInTheDocument();
    expect(screen.queryByText('The shape of it')).not.toBeInTheDocument();
    // The crisis affordance is still present on an empty state.
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();
  });

  it('shows an entry dialled DOWN in the split, instead of losing it entirely', async () => {
    // Marked love in the deck, then rated 1 in the split: below the >= 3 bar for loved, not a boundary, not
    // the middle mark. Recorded and shown nowhere. It reads as "fine, not a favourite".
    const one = [result('r1', '2026-06-01T00:00:00Z', 0.4)];
    installMockBridge({
      testsAdaptiveState: () =>
        Promise.resolve(
          state({
            latest: one[0]!,
            history: one,
            lexicon: {
              ...state().lexicon,
              entries: [
                {
                  key: 'names-power:good-girl',
                  text: 'good girl',
                  kind: 'word',
                  family: 'names-power',
                  tier: 2,
                  hear: 1,
                  say: 0,
                },
              ],
            },
          }),
        ),
    });
    renderReport();
    expect(await screen.findByText(/Fine either way/i)).toBeInTheDocument();
    expect(screen.getByText('good girl')).toBeInTheDocument();
  });

  it('leads with the lede and the keyed readings, not with a wall of prose', async () => {
    installMockBridge({
      testsAdaptiveState: async () =>
        state({
          latest: {
            ...result('r1', '2026-08-01', 0.9),
            lede: 'You want to be told you are good far more than you want to be pushed around.',
            narrative: 'An opener that is not the finding.\n\nThe rest of the read goes here.',
            readings: [
              {
                kind: 'pattern' as const,
                text: 'The praise you want is about effort, not looks.',
                source: 'Echoes your onboarding answers on where confidence comes from.',
              },
              {
                kind: 'suggestion' as const,
                text: 'A name is an easier first move than a sentence.',
              },
            ],
          },
        }),
    });
    renderReport();

    // The lede is the claim, at display size — and it is the LEDE, not the narrative's opener.
    expect(
      await screen.findByText(/told you are good far more than you want to be pushed around/),
    ).toBeInTheDocument();
    expect(screen.getByText(/An opener that is not the finding/)).toBeInTheDocument();

    // Each reading names its kind before its claim, and cites its source when it had one.
    expect(screen.getByText('Pattern')).toBeInTheDocument();
    expect(screen.getByText('Try')).toBeInTheDocument();
    expect(screen.getByText(/Echoes your onboarding answers/)).toBeInTheDocument();
    // A reading without a source simply doesn't cite one — never an invented one.
    expect(screen.getByText(/A name is an easier first move/)).toBeInTheDocument();
  });

  it('folds a long word list and states a hard no as one line rather than a field of chips', async () => {
    // Hear-side only, so each entry lands in exactly ONE list: an entry asked both ways would show up under
    // "Love to hear" AND in the hear/say gap, and the duplicate would make the assertions below meaningless.
    const entry = (n: number, state_: 'never' | undefined) => ({
      key: `k${n}`,
      family: 'praise',
      text: `line ${n}`,
      kind: 'word' as const,
      tier: 1,
      sides: ['hear' as const],
      hear: state_ ? 0 : 4,
      say: 0,
      ...(state_ ? { state: state_ } : {}),
    });
    const entries = [
      ...Array.from({ length: 15 }, (_, i) => entry(i, undefined)),
      ...Array.from({ length: 3 }, (_, i) => entry(100 + i, 'never')),
    ];
    installMockBridge({
      testsAdaptiveState: async () =>
        state({
          latest: result('r1', '2026-08-01', 0.9),
          lexicon: { ...state().lexicon, entries },
        }),
    });
    renderReport();

    // 12 shown, the remainder behind one disclosure. The folded entries stay in the DOM — that is what a
    // disclosure IS — so the assertion is about what a person can SEE, not about what exists.
    expect(await screen.findByText('line 0')).toBeVisible();
    expect(screen.getByText('See the other 3')).toBeVisible();
    expect(screen.getByText('line 14')).not.toBeVisible();

    // The hard nos are a sentence, not a field of struck-through chips.
    expect(screen.getByText(/3 off the table/)).toBeVisible();
    expect(screen.getByText('line 100')).not.toBeVisible();
  });

  it('says where the profile is used, because it is not a page you visit', async () => {
    installMockBridge({
      testsAdaptiveState: async () => state({ latest: result('r1', '2026-08-01', 0.9) }),
    });
    renderReport();

    expect(await screen.findByText('Where this gets used')).toBeInTheDocument();
    expect(screen.getByText(/never what you ruled out/)).toBeInTheDocument();
  });
});
