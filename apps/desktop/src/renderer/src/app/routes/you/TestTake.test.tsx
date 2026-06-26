import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TestForm } from '@selfos/core/tests';
import { TestTake } from './TestTake';
import { useTestStore } from '../../../stores/testStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useTestStore.getState().reset();
});

/** A minimal PHQ-9 check-in form: two mood rows + the crisis item 9, on the 0–3 frequency scale. */
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
  crisisItems: [{ questionId: 'phq9-9', atOrAbove: 1 }],
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

  it('escalates a prominent crisis banner the instant PHQ-9 item 9 is answered positive (§3.2 step 3)', async () => {
    installMockBridge({ testsGet: () => Promise.resolve(phq9Form) });
    renderTake();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Begin' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Begin' }));

    // No crisis surface yet.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Answer item 9 with any non-"Not at all" value → the crisis banner appears immediately, mid-check-in.
    const item9 = screen.getByRole('radiogroup', { name: /better off dead/i });
    await userEvent.click(within(item9).getByRole('radio', { name: 'Several days' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/please reach out to someone who can help/i);
    // The crisis surface is independent of finishing — "Stop check-in" is available.
    expect(screen.getByRole('button', { name: 'Stop check-in' })).toBeInTheDocument();
  });
});
