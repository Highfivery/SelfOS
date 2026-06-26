import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
};

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
      testsList: () => Promise.resolve({ tests: [bigFive], adultAcknowledged: false }),
      testsResults: () => Promise.resolve([bigFiveResult()]),
    });
    renderYou();

    await waitFor(() => expect(screen.getByText('Your profiles')).toBeInTheDocument());
    // The profile card surfaces the top subscale + the "taken" line.
    expect(screen.getByText('Openness')).toBeInTheDocument();
    expect(screen.getByText('leans higher')).toBeInTheDocument();
    // Catalog card for a takeable test.
    expect(screen.getByRole('button', { name: 'Take' })).toBeInTheDocument();
    // The Intimacy & sexuality group is 18+-gated until acknowledged.
    expect(screen.getByText(/These are 18\+/)).toBeInTheDocument();
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
});
