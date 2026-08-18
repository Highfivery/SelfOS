import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

function phq9Result(takenAt = '2026-06-26T10:00:00Z'): TestResult {
  return {
    id: 'wr1',
    schemaVersion: 1,
    testId: 'phq9',
    testVersion: 1,
    subjectPersonId: 'p1',
    answers: [],
    scores: [{ key: 'phq9.total', raw: 11, normalized: 0.41, band: 'moderate' }],
    insightId: 'wi1',
    takenAt,
    createdAt: takenAt,
    updatedAt: takenAt,
  };
}

function bigFiveResult(): TestResult {
  return {
    id: 'r1',
    schemaVersion: 1,
    testId: 'bigfive-ipip-120',
    testVersion: 1,
    subjectPersonId: 'p1',
    answers: [],
    scores: [{ key: 'bigfive.openness', raw: 100, normalized: 0.72, band: 'leans higher' }],
    insightId: 'i1',
    takenAt: '2026-06-26T10:00:00Z',
    createdAt: '2026-06-26T10:00:00Z',
    updatedAt: '2026-06-26T10:00:00Z',
  };
}

const renderYou = (): void => {
  render(
    <MemoryRouter>
      <You />
    </MemoryRouter>,
  );
};

describe('You hub', () => {
  it('shows the catalog + a profile card for a taken test, and gates the 18+ group', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [bigFive, attachment], adultAcknowledged: false }),
      testsResults: ({ testId }) =>
        Promise.resolve(testId === 'bigfive-ipip-120' ? [bigFiveResult()] : []),
    });
    renderYou();

    await waitFor(() => expect(screen.getByText('Your profiles')).toBeInTheDocument());
    // The profile card surfaces the top subscale + the "taken" line.
    expect(screen.getByText('Openness')).toBeInTheDocument();
    expect(screen.getByText('leans higher')).toBeInTheDocument();
    // Catalog card for the still-untaken test.
    expect(screen.getByRole('button', { name: 'Take' })).toBeInTheDocument();
    // The Intimacy & sexuality group is 18+-gated until acknowledged.
    expect(screen.getByText(/These are 18\+/)).toBeInTheDocument();
  });

  it('drops a taken test from "Available tests" — it lives only under Your profiles (95)', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [bigFive, attachment], adultAcknowledged: true }),
      testsResults: ({ testId }) =>
        Promise.resolve(testId === 'bigfive-ipip-120' ? [bigFiveResult()] : []),
    });
    renderYou();

    await waitFor(() => expect(screen.getByText('Your profiles')).toBeInTheDocument());
    // The taken Big Five appears exactly once (its profile card), never as a catalog "Take" card.
    expect(screen.getAllByText('Big Five personality')).toHaveLength(1);
    // The untaken Attachment test remains available to take.
    expect(screen.getByRole('button', { name: 'Take' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Attachment (ECR-R)' })).toBeInTheDocument();
  });

  it('hides the "Available tests" section once every test is taken (95)', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [bigFive], adultAcknowledged: true }),
      testsResults: () => Promise.resolve([bigFiveResult()]),
    });
    renderYou();

    await waitFor(() => expect(screen.getByText('Your profiles')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Available tests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take' })).not.toBeInTheDocument();
  });

  it('acknowledging 18+ reveals the intimacy tests', async () => {
    const list = vi.fn().mockResolvedValueOnce({ tests: [bigFive], adultAcknowledged: false });
    installMockBridge({
      testsList: list,
      testsResults: () => Promise.resolve([]),
      testsAcknowledgeAdult: () =>
        Promise.resolve({ tests: [bigFive, kink], adultAcknowledged: true }),
    });
    renderYou();

    await waitFor(() => expect(screen.getByText(/These are 18\+/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /18 or older/ }));
    await waitFor(() => expect(screen.getByText('Kink & intimacy interests')).toBeInTheDocument());
    expect(screen.queryByText(/These are 18\+/)).not.toBeInTheDocument();
  });

  it('shows the warm empty state when there are no results', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [bigFive], adultAcknowledged: true }),
      testsResults: () => Promise.resolve([]),
    });
    renderYou();
    await waitFor(() =>
      expect(screen.getByText(/Take a test to see how SelfOS understands you/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Your profiles')).not.toBeInTheDocument();
  });

  it('renders the wellbeing "Reflections & check-ins" group distinctly, with a "Check in" CTA (51 §3.1)', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [phq9], adultAcknowledged: false }),
      testsResults: () => Promise.resolve([]),
    });
    renderYou();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Reflections & check-ins' })).toBeInTheDocument(),
    );
    expect(screen.getByText(/reflections, not diagnoses/i)).toBeInTheDocument();
    // A wellbeing card invites a "Check in" (never "Take").
    expect(screen.getByRole('button', { name: 'Check in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take' })).not.toBeInTheDocument();
  });

  it('a taken wellbeing profile shows the GENTLE range, never the clinical band (51 §3.3)', async () => {
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [phq9], adultAcknowledged: false }),
      testsResults: () => Promise.resolve([phq9Result()]),
    });
    renderYou();
    await waitFor(() => expect(screen.getByText('Your profiles')).toBeInTheDocument());
    expect(
      screen.getByText(/a fair amount of low mood has been weighing on you lately/i),
    ).toBeInTheDocument();
    // The internal clinical key is never shown.
    expect(screen.queryByText('moderate')).not.toBeInTheDocument();
    // The wellbeing card invites "Check in again", not "Retake".
    expect(screen.getByRole('button', { name: 'Check in again' })).toBeInTheDocument();
  });

  it('does not call an adaptive intimacy profile "only you" — it feeds a partner\'s coach (74 §8.4)', async () => {
    // The take's intro and the report both say the loved terms quietly steer a partner's coach. A stronger
    // claim one screen earlier would be the app contradicting itself about who sees what.
    const dirtyTalk: TestSummary = {
      id: 'dirty-talk',
      kind: 'adaptive',
      group: 'intimacy',
      title: 'Dirty talk',
      instrument: 'SelfOS',
      blurb: 'What you want said to you.',
      framing: 'A map, not a verdict.',
      estimatedMinutes: 15,
      itemCount: 0,
      adult: true,
      sensitive: true,
      subscales: [{ key: 'dirty.filth', label: 'Filthiness', signed: false }],
      wellbeing: false,
    };
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [dirtyTalk, kink], adultAcknowledged: true }),
      testsResults: ({ testId }) =>
        Promise.resolve(
          testId === 'dirty-talk'
            ? [
                {
                  ...bigFiveResult(),
                  id: 'a1',
                  testId: 'dirty-talk',
                  scores: [{ key: 'dirty.filth', raw: 4, normalized: 0.8, band: 'high' }],
                },
              ]
            : [],
        ),
    });
    renderYou();
    expect(await screen.findByText('Dirty talk')).toBeInTheDocument();
    expect(screen.getByText('yours')).toBeInTheDocument();
    expect(screen.queryByText(/private — only you/)).not.toBeInTheDocument();
  });
});

describe('retake goes where a retake goes (74 §3.6.15)', () => {
  it('sends Retake to the choice, not through an intro for a test they have taken', async () => {
    const seen: { pathname: string; state: unknown }[] = [];
    function Probe(): JSX.Element {
      const loc = useLocation();
      seen.push({ pathname: loc.pathname, state: loc.state });
      return <p>take screen</p>;
    }
    const dirtyTalk: TestSummary = {
      id: 'dirty-talk',
      kind: 'adaptive',
      group: 'intimacy',
      title: 'Dirty talk',
      instrument: 'SelfOS',
      blurb: 'What you want said to you.',
      framing: 'A map, not a verdict.',
      estimatedMinutes: 15,
      itemCount: 0,
      adult: true,
      sensitive: true,
      subscales: [{ key: 'dirty.filth', label: 'Filthiness', signed: false }],
      wellbeing: false,
    };
    installMockBridge({
      testsList: () => Promise.resolve({ tests: [dirtyTalk], adultAcknowledged: true }),
      testsResults: () =>
        Promise.resolve([
          {
            ...bigFiveResult(),
            id: 'a1',
            testId: 'dirty-talk',
            scores: [{ key: 'dirty.filth', raw: 4, normalized: 0.8, band: 'high' }],
          },
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
    await userEvent.click(await screen.findByRole('button', { name: 'Retake' }));

    // It used to land on the intro — an explanation of a test they have already taken, with a button reading
    // "Pick up where you left off", which then led to the actual question two taps later.
    const last = seen[seen.length - 1];
    expect(last?.pathname).toBe('/tests/dirty-talk/take');
    expect(last?.state).toEqual({ retake: true });
  });
});
