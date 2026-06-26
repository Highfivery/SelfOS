import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TestSummary } from '@selfos/core/tests';
import type { TestResult } from '@shared/schemas';
import { TestResultScreen } from './TestResultScreen';
import { useTestStore } from '../../../stores/testStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const ecr: TestSummary = {
  id: 'ecr-r',
  group: 'relationships',
  title: 'Attachment style',
  instrument: 'ECR-R',
  blurb: 'Two dimensions.',
  framing: 'A reflection, not a label.',
  estimatedMinutes: 8,
  itemCount: 36,
  adult: false,
  sensitive: false,
  subscales: [
    { key: 'ecr.anxiety', label: 'Attachment anxiety', signed: false },
    { key: 'ecr.avoidance', label: 'Attachment avoidance', signed: false },
  ],
  wellbeing: false,
};

function result(id: string, takenAt: string): TestResult {
  return {
    id,
    schemaVersion: 1,
    testId: 'ecr-r',
    testVersion: 1,
    subjectPersonId: 'p1',
    answers: [],
    scores: [
      { key: 'ecr.anxiety', raw: 5, normalized: 0.7, band: 'heightened' },
      { key: 'ecr.avoidance', raw: 2, normalized: 0.3, band: 'lower' },
    ],
    insightId: 'i1',
    takenAt,
    createdAt: takenAt,
    updatedAt: takenAt,
  };
}

function seed(results: TestResult[]): void {
  useTestStore.setState({
    catalog: [ecr],
    resultsByTest: { 'ecr-r': results },
    adultAcknowledged: false,
    loaded: true,
  });
}

afterEach(() => {
  clearMockBridge();
  useTestStore.getState().reset();
});

const renderResult = (): void => {
  render(
    <MemoryRouter initialEntries={['/you/ecr-r']}>
      <Routes>
        <Route path="/you/:testId" element={<TestResultScreen />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('TestResultScreen', () => {
  it('renders the subscale bars + the non-diagnostic preamble', () => {
    installMockBridge({});
    seed([result('r1', '2026-06-26T10:00:00Z')]);
    renderResult();
    expect(screen.getByText('Attachment anxiety')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('heightened')).toBeInTheDocument();
    expect(screen.getByText(/not a label or a\s+diagnosis/)).toBeInTheDocument();
  });

  it('shows a trends section with ≥2 results', () => {
    installMockBridge({});
    seed([result('r2', '2026-06-27T10:00:00Z'), result('r1', '2026-06-26T10:00:00Z')]);
    renderResult();
    expect(screen.getByText(/How this has shifted \(2 takes\)/)).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
  });

  it('the narrative button spends + renders prose; a non-ok response shows a calm state', async () => {
    installMockBridge({
      testsNarrate: () => Promise.resolve({ ok: true, text: 'A warm reflection.', costUsd: 0.002 }),
    });
    seed([result('r1', '2026-06-26T10:00:00Z')]);
    renderResult();
    await userEvent.click(screen.getByRole('button', { name: /Reflect on my result/ }));
    await waitFor(() => expect(screen.getByText('A warm reflection.')).toBeInTheDocument());
    expect(screen.getByText(/\$0\.002/)).toBeInTheDocument(); // admin-only cost (present → shown)
  });

  it('shows a calm AI-off state when narrate is unavailable', async () => {
    installMockBridge({
      testsNarrate: () =>
        Promise.resolve({
          ok: false,
          reason: 'AI_OFF',
          message: 'Turn on AI in Settings to use this.',
        }),
    });
    seed([result('r1', '2026-06-26T10:00:00Z')]);
    renderResult();
    await userEvent.click(screen.getByRole('button', { name: /Reflect on my result/ }));
    await waitFor(() =>
      expect(screen.getByText('Turn on AI in Settings to use this.')).toBeInTheDocument(),
    );
  });
});

const phq9: TestSummary = {
  id: 'phq9',
  group: 'wellbeing',
  title: 'Mood check-in',
  instrument: 'based on PHQ-9',
  blurb: 'A gentle check-in.',
  framing: 'A reflection, not a diagnosis.',
  estimatedMinutes: 3,
  itemCount: 9,
  adult: false,
  sensitive: false,
  subscales: [{ key: 'phq9.total', label: 'Mood', signed: false }],
  wellbeing: true,
  attribution: 'Based on the PHQ-9 (Pfizer). No permission required.',
  bandDisplays: {
    moderate: 'Your answers suggest a fair amount of low mood has been weighing on you lately.',
    severe: 'Your answers suggest you’ve been going through a really heavy time.',
  },
  crisisItems: [{ questionId: 'phq9-9', atOrAbove: 1 }],
};

function phqResult(opts: { band: string; crisisFlag?: boolean }): TestResult {
  return {
    id: 'wr1',
    schemaVersion: 1,
    testId: 'phq9',
    testVersion: 1,
    subjectPersonId: 'p1',
    answers: [],
    scores: [{ key: 'phq9.total', raw: 11, normalized: 0.41, band: opts.band }],
    ...(opts.crisisFlag ? { crisisFlag: true } : {}),
    insightId: 'wi1',
    takenAt: '2026-06-26T10:00:00Z',
    createdAt: '2026-06-26T10:00:00Z',
    updatedAt: '2026-06-26T10:00:00Z',
  };
}

const renderWellbeing = (): void => {
  render(
    <MemoryRouter initialEntries={['/you/phq9']}>
      <Routes>
        <Route path="/you/:testId" element={<TestResultScreen />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('TestResultScreen — wellbeing (51 §3.3)', () => {
  it('shows the GENTLE range + the always-present professional-help line, never the clinical label', () => {
    installMockBridge({});
    useTestStore.setState({
      catalog: [phq9],
      resultsByTest: { phq9: [phqResult({ band: 'moderate' })] },
      adultAcknowledged: false,
      loaded: true,
    });
    renderWellbeing();
    expect(
      screen.getByText(/a fair amount of low mood has been weighing on you lately/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/This is a reflection, not a medical opinion/i)).toBeInTheDocument();
    // Non-diagnostic copy guarantees: no clinical key, no "you have", no diagnosis name.
    expect(screen.queryByText('moderate')).not.toBeInTheDocument();
    expect(screen.queryByText(/you have/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/depression/i)).not.toBeInTheDocument();
  });

  it('leads with a warm, resources-first crisis banner when the result is crisis-flagged (§5.2)', () => {
    installMockBridge({});
    useTestStore.setState({
      catalog: [phq9],
      resultsByTest: { phq9: [phqResult({ band: 'severe', crisisFlag: true })] },
      adultAcknowledged: false,
      loaded: true,
    });
    renderWellbeing();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/you don’t have to face it alone/i);
  });
});
