import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { TestSummary } from '@selfos/core/tests';
import type { TestResult } from '@shared/schemas';
import { You } from './You';
import { useTestStore } from '../../../stores/testStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useTestStore.getState().reset();
});

const bigFive: TestSummary = {
  id: 'bigfive-ipip-120',
  group: 'personality',
  title: 'Big Five personality',
  instrument: 'IPIP',
  blurb: 'Five broad dimensions.',
  framing: 'A reflection, not a verdict.',
  estimatedMinutes: 20,
  itemCount: 120,
  adult: false,
  sensitive: false,
  subscales: [{ key: 'bigfive.openness', label: 'Openness', signed: false }],
  wellbeing: false,
};
const attachment: TestSummary = {
  id: 'ecr-r',
  group: 'relationships',
  title: 'Attachment (ECR-R)',
  instrument: 'ECR-R',
  blurb: 'How you connect.',
  framing: 'A reflection, not a verdict.',
  estimatedMinutes: 15,
  itemCount: 36,
  adult: false,
  sensitive: false,
  subscales: [{ key: 'ecr.anxiety', label: 'Anxiety', signed: false }],
  wellbeing: false,
};
const kink: TestSummary = {
  id: 'kink-interests',
  group: 'intimacy',
  title: 'Kink & intimacy interests',
  instrument: 'SelfOS',
  blurb: 'A private map.',
  framing: 'Consensual adults only.',
  estimatedMinutes: 12,
  itemCount: 15,
  adult: true,
  sensitive: true,
  subscales: [{ key: 'kink.impact', label: 'Impact & sensation', signed: false }],
  wellbeing: false,
};
const phq9: TestSummary = {
  id: 'phq9',
  group: 'wellbeing',
  title: 'Mood check-in',
  instrument: 'based on PHQ-9',
  blurb: 'A gentle check-in on your mood.',
  framing: 'A reflection, not a diagnosis.',
  estimatedMinutes: 3,
  itemCount: 9,
  adult: false,
  sensitive: false,
  subscales: [{ key: 'phq9.total', label: 'Mood', signed: false }],
  wellbeing: true,
  attribution: 'Based on the PHQ-9 (Pfizer). No permission required.',
  bandDisplays: {
    minimal: 'Your answers suggest your mood has felt mostly okay lately.',
    moderate: 'Your answers suggest a fair amount of low mood has been weighing on you lately.',
  },
  crisisItems: [{ questionId: 'phq9-9', atOrAbove: 1 }],
};
const dirtyTalk: TestSummary = {
  id: 'dirty-talk',
  kind: 'adaptive',
  group: 'intimacy',
  title: 'Dirty talk',
  instrument: 'SelfOS',
  blurb: 'What you want said to you.',
  framing: 'A map, not a verdict.',
  estimatedMinutes: 15,
  // The adaptive bank size — never renderable as a question count.
  itemCount: 3161,
  adult: true,
  sensitive: true,
  subscales: [{ key: 'dirty.filth', label: 'Filthiness', signed: false }],
  wellbeing: false,
};

const daysAgo = (n: number): string => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function makeResult(over: Partial<TestResult> & Pick<TestResult, 'testId'>): TestResult {
  const at = over.takenAt ?? daysAgo(2);
  return {
    id: 'r1',
    schemaVersion: 1,
    testVersion: 1,
    subjectPersonId: 'p1',
    answers: [],
    scores: [],
    takenAt: at,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

const bigFiveResult = (): TestResult =>
  makeResult({
    testId: 'bigfive-ipip-120',
    scores: [{ key: 'bigfive.openness', raw: 100, normalized: 0.72, band: 'leans higher' }],
  });

const phq9Result = (takenAt = daysAgo(2)): TestResult =>
  makeResult({
    testId: 'phq9',
    takenAt,
    scores: [{ key: 'phq9.total', raw: 11, normalized: 0.41, band: 'moderate' }],
  });

const renderYou = (): void => {
  render(
    <MemoryRouter>
      <You />
    </MemoryRouter>,
  );
};

/** The catalog grid, so a query never collides with the identically-labelled lead-slot action. */
const grid = (): HTMLElement => screen.getByRole('region', { name: 'Everything you can take' });
const leadSlot = (): HTMLElement => screen.getByRole('region', { name: 'Next for you' });

describe('Tests hub', () => {
  it('keeps every instrument in ONE grid, enriching a card rather than moving it', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [bigFive, attachment], adultAcknowledged: true }),
      testsResults: ({ testId }) =>
        Promise.resolve(testId === 'bigfive-ipip-120' ? [bigFiveResult()] : []),
    });
    renderYou();

    await waitFor(() => expect(screen.getByText('Everything you can take')).toBeInTheDocument());
    // The taken instrument appears exactly ONCE — it does not move to a separate section and it is not
    // duplicated as a catalog card (the bug the old two-section layout traded for a reshaping page).
    expect(within(grid()).getAllByRole('heading', { name: 'Big Five personality' })).toHaveLength(
      1,
    );
    // Its card carries the RESULT, not a blurb.
    expect(within(grid()).getByText('Openness')).toBeInTheDocument();
    expect(within(grid()).getByText('leans higher')).toBeInTheDocument();
    expect(within(grid()).getByRole('button', { name: 'Retake' })).toBeInTheDocument();
    // The untaken one is still an invitation.
    expect(within(grid()).getByRole('button', { name: 'Take' })).toBeInTheDocument();
  });

  it('counts what is outstanding without ever implying a finish line', async () => {
    installMockBridge({
      testsList: () =>
        Promise.resolve({ tests: [bigFive, attachment, phq9], adultAcknowledged: true }),
      testsResults: ({ testId }) =>
        Promise.resolve(testId === 'bigfive-ipip-120' ? [bigFiveResult()] : []),
    });
    renderYou();

    const strip = await screen.findByRole('group', { name: 'Your tests at a glance' });
    expect(within(strip).getByText('Taken')).toBeInTheDocument();
    expect(within(strip).getByText('Not tried')).toBeInTheDocument();
    // Three independent numbers — never a ratio, a percentage or a meter, because the catalog GROWS:
    // "1 of 3" would be a lie the next release. (A subscale's own percentage elsewhere is a trait score,
    // not progress toward finishing, so the guard is scoped to the strip.)
    expect(within(strip).queryByText(/of/)).toBeNull();
    expect(within(strip).queryByText(/%/)).toBeNull();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('leads with an overdue check-in over anything else', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [dirtyTalk, phq9], adultAcknowledged: true }),
      testsResults: ({ testId }) =>
        Promise.resolve(testId === 'phq9' ? [phq9Result(daysAgo(18))] : []),
    });
    renderYou();

    await waitFor(() => expect(leadSlot()).toBeInTheDocument());
    expect(within(leadSlot()).getByRole('heading', { name: 'Mood check-in' })).toBeInTheDocument();
    expect(within(leadSlot()).getByText(/18 days since your last one/)).toBeInTheDocument();
    // The due card is findable in the grid too, not only in the lead slot.
    expect(within(grid()).getByText('Due')).toBeInTheDocument();
  });

  it('leads with the adaptive flagship when nothing is due, and hides the slot when nothing is outstanding', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [bigFive, dirtyTalk], adultAcknowledged: true }),
      testsResults: () => Promise.resolve([]),
    });
    const { unmount } = render(
      <MemoryRouter>
        <You />
      </MemoryRouter>,
    );
    await waitFor(() => expect(leadSlot()).toBeInTheDocument());
    expect(within(leadSlot()).getByRole('heading', { name: 'Dirty talk' })).toBeInTheDocument();
    unmount();
    clearMockBridge();
    useTestStore.getState().reset();

    installMockBridge({
      testsList: () => Promise.resolve({ tests: [bigFive], adultAcknowledged: true }),
      testsResults: () => Promise.resolve([bigFiveResult()]),
    });
    renderYou();
    await waitFor(() => expect(screen.getByText('Everything you can take')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Next for you' })).not.toBeInTheDocument();
  });

  it('filters the grid from one control, with a count on every option', async () => {
    installMockBridge({
      testsList: () =>
        Promise.resolve({ tests: [bigFive, attachment, phq9], adultAcknowledged: true }),
      testsResults: ({ testId }) =>
        Promise.resolve(testId === 'bigfive-ipip-120' ? [bigFiveResult()] : []),
    });
    renderYou();

    await waitFor(() => expect(screen.getByText('Everything you can take')).toBeInTheDocument());
    const filters = screen.getByRole('group', { name: 'Filter tests' });
    await userEvent.click(within(filters).getByRole('button', { name: /Not tried/ }));
    // Big Five is taken, so it drops out; the two untried remain.
    expect(within(grid()).queryByRole('heading', { name: 'Big Five personality' })).toBeNull();
    expect(within(grid()).getByRole('heading', { name: 'Mood check-in' })).toBeInTheDocument();

    await userEvent.click(within(filters).getByRole('button', { name: /Under 5 min/ }));
    // Only the 3-minute check-in qualifies.
    expect(within(grid()).getByRole('heading', { name: 'Mood check-in' })).toBeInTheDocument();
    expect(within(grid()).queryByRole('heading', { name: 'Attachment (ECR-R)' })).toBeNull();
  });

  it('invites a "Check in" for a wellbeing reflection, never a "Take"', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [phq9], adultAcknowledged: true }),
      testsResults: () => Promise.resolve([]),
    });
    renderYou();
    await waitFor(() => expect(screen.getByText('Everything you can take')).toBeInTheDocument());
    expect(within(grid()).getByRole('button', { name: 'Check in' })).toBeInTheDocument();
    expect(within(grid()).queryByRole('button', { name: 'Take' })).toBeNull();
  });

  it('shows a taken wellbeing reflection as the GENTLE range, never the clinical band (51 §3.3)', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [phq9], adultAcknowledged: true }),
      testsResults: () => Promise.resolve([phq9Result()]),
    });
    renderYou();
    await waitFor(() =>
      expect(
        screen.getByText(/a fair amount of low mood has been weighing on you lately/i),
      ).toBeInTheDocument(),
    );
    // The internal clinical key is never rendered.
    expect(screen.queryByText('moderate')).not.toBeInTheDocument();
    expect(within(grid()).getByRole('button', { name: 'Check in again' })).toBeInTheDocument();
  });

  it('says "yours" for an adaptive intimacy profile, never "private — only you" (74 §8.4)', async () => {
    // The take's intro and the report both say the loved terms quietly steer a partner's coach. A stronger
    // claim one screen earlier would be the app contradicting itself about who sees what.
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [dirtyTalk, kink], adultAcknowledged: true }),
      testsResults: ({ testId }) =>
        Promise.resolve(
          testId === 'dirty-talk'
            ? [
                makeResult({
                  testId: 'dirty-talk',
                  scores: [{ key: 'dirty.filth', raw: 4, normalized: 0.8, band: 'high' }],
                }),
              ]
            : [],
        ),
    });
    renderYou();
    const card = await screen.findByRole('listitem', { name: 'Dirty talk' });
    expect(within(card).getByText(/· yours$/)).toBeInTheDocument();
    expect(within(card).queryByText(/private — only you/)).toBeNull();
    // The spec-50 sensitive sibling keeps the STRONGER wording — the two must not be flattened into one.
    const kinkCard = screen.getByRole('listitem', { name: 'Kink & intimacy interests' });
    expect(within(kinkCard).getByText(/private — only you/)).toBeInTheDocument();
  });

  it('never renders the adaptive bank size as a question count', async () => {
    // `itemCount` on an adaptive take is its BANK inventory (3,161 entries), not questions anyone answers.
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [dirtyTalk], adultAcknowledged: true }),
      testsResults: () => Promise.resolve([]),
    });
    renderYou();
    await waitFor(() => expect(screen.getByText('Everything you can take')).toBeInTheDocument());
    expect(screen.queryByText(/3161/)).not.toBeInTheDocument();
    expect(screen.queryByText(/3,161/)).not.toBeInTheDocument();
    expect(within(grid()).getByText(/Adapts as you go/)).toBeInTheDocument();
  });

  it('gates the adult instruments behind one page-level unlock, then reveals them', async () => {
    const list = vi.fn().mockResolvedValueOnce({ tests: [bigFive], adultAcknowledged: false });
    installMockBridge({
      testsList: list,
      testsResults: () => Promise.resolve([]),
      testsAcknowledgeAdult: () =>
        Promise.resolve({ tests: [bigFive, kink], adultAcknowledged: true }),
    });
    renderYou();

    await waitFor(() => expect(screen.getByText(/More, for adults/)).toBeInTheDocument());
    // The gate is a property of the page, not a card sitting in the grid pretending to be an instrument.
    expect(within(grid()).queryByText(/More, for adults/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /18 or older/ }));
    await waitFor(() =>
      expect(
        within(grid()).getByRole('listitem', { name: 'Kink & intimacy interests' }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/More, for adults/)).not.toBeInTheDocument();
  });

  it('says the reflection line once, not on every card', async () => {
    installMockBridge({
      testsList: () =>
        Promise.resolve({ tests: [bigFive, attachment, phq9], adultAcknowledged: true }),
      testsResults: () => Promise.resolve([]),
    });
    renderYou();
    await waitFor(() =>
      expect(screen.getAllByText(/not a verdict, a score, or a diagnosis/i)).toHaveLength(1),
    );
    // The per-instrument framing lives on the intro + result screens (51 §8.1), not repeated in the catalog.
    expect(screen.queryByText('A reflection, not a verdict.')).not.toBeInTheDocument();
  });

  it('keeps the crisis footer present (51 §8)', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [bigFive], adultAcknowledged: true }),
      testsResults: () => Promise.resolve([]),
    });
    renderYou();
    expect(await screen.findByRole('button', { name: /Get help now/i })).toBeInTheDocument();
  });
});

describe('retake goes where a retake goes (74 §3.6.15)', () => {
  it('sends the adaptive "Keep marking" to the choice, not through an intro', async () => {
    const seen: { pathname: string; state: unknown }[] = [];
    function Probe(): JSX.Element {
      const loc = useLocation();
      seen.push({ pathname: loc.pathname, state: loc.state });
      return <p>take screen</p>;
    }
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [dirtyTalk], adultAcknowledged: true }),
      testsResults: () =>
        Promise.resolve([
          makeResult({
            testId: 'dirty-talk',
            scores: [{ key: 'dirty.filth', raw: 4, normalized: 0.8, band: 'high' }],
          }),
        ]),
    });
    render(
      <MemoryRouter initialEntries={['/tests']}>
        <Routes>
          <Route path="/tests" element={<You />} />
          <Route path="/tests/:testId/take" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    // An adaptive take is never "finished", so its second action is "Keep marking", not "Retake".
    await userEvent.click(await screen.findByRole('button', { name: 'Keep marking' }));

    // It used to land on the intro — an explanation of a test they have already taken, with a button reading
    // "Pick up where you left off", which then led to the actual question two taps later.
    const last = seen[seen.length - 1];
    expect(last?.pathname).toBe('/tests/dirty-talk/take');
    expect(last?.state).toEqual({ retake: true });
  });
});
