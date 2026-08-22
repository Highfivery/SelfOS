import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TestForm } from '@selfos/core/tests';
import { TestTake } from './TestTake';
import { useTestStore } from '../../../stores/testStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useTestStore.getState().reset();
});
const phq9Form: TestForm = {
  id: 'phq9',
  group: 'wellbeing',
  title: 'Mood check-in',
  instrument: 'based on PHQ-9',
  blurb: 'A gentle check-in on your mood.',
  framing: 'A reflection, not a diagnosis.',
  estimatedMinutes: 3,
  itemCount: 3,
  adult: false,
  sensitive: false,
  subscales: [{ key: 'phq9.total', label: 'Mood', signed: false }],
  wellbeing: true,
  attribution: 'Based on the PHQ-9 (Pfizer). No permission required.',
  items: [
    {
      id: 'phq9',
      type: 'matrix',
      prompt: 'Over the last 2 weeks, how often…',
      required: true,
      matrix: {
        rows: [
          { key: 'phq9-1', label: 'Little interest or pleasure in doing things' },
          {
            key: 'phq9-9',
            label: 'Thoughts that you would be better off dead, or of hurting yourself in some way',
          },
        ],
        min: 0,
        max: 3,
        pointLabels: ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'],
      },
    },
  ],
};

const renderTake = (): void => {
  render(
    <MemoryRouter initialEntries={['/you/phq9/take']}>
      <Routes>
        <Route path="/you/:testId/take" element={<TestTake />} />
        <Route path="/you" element={<div>You hub</div>} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('TestTake — wellbeing check-in (51 §3.2)', () => {
  it('shows the not-medical framing FIRST on the intro + the attribution + a Begin', async () => {
    installMockBridge({ testsGet: () => Promise.resolve(phq9Form) });
    renderTake();
    await waitFor(() =>
      expect(
        screen.getByText(/not.*a.*diagnosis, a screening, or medical advice/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/No permission required/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Begin' })).toBeInTheDocument();
  });
});
