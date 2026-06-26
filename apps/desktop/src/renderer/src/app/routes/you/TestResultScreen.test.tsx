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
