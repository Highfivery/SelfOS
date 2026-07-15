import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AgreementSummary } from '@shared/schemas';
import { CompletedCommitments } from './CompletedCommitments';
import { useTogetherStore } from '../../../stores/togetherStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

function doneSummary(over: Partial<AgreementSummary> = {}): AgreementSummary {
  return {
    partnerPersonId: 'angel',
    partnerName: 'Angel',
    agreement: {
      id: 'a1',
      schemaVersion: 1,
      pairKey: 'angel~ben',
      text: 'Screen-free dinners',
      timeframe: 'weekdays',
      status: 'done',
      provenance: { sessionId: 'sess-1', at: '2026-07-01T00:00:00.000Z' },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    },
    ...over,
  };
}

afterEach(() => {
  clearMockBridge();
  useTogetherStore.getState().reset();
});

describe('Completed Together commitments in Goals (spec 61 — user request 2026-07-15)', () => {
  it('lists DONE commitments (partner + Completed tag) and reopens one back to standing via the shared ledger', async () => {
    const setStatus = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      togetherDoneCommitments: () => Promise.resolve([doneSummary()]),
      togetherSetAgreementStatus: setStatus,
    });
    render(
      <MemoryRouter>
        <CompletedCommitments />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Screen-free dinners')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Angel')).toBeInTheDocument();
    expect(screen.getByText('weekdays')).toBeInTheDocument();

    // Reopen writes back to the shared ledger as `standing` (returns it to the active commitments list).
    await userEvent.click(screen.getByRole('button', { name: /Reopen/ }));
    expect(setStatus).toHaveBeenCalledWith({
      partnerPersonId: 'angel',
      agreementId: 'a1',
      status: 'standing',
    });
  });

  it('renders nothing when there are no completed commitments', async () => {
    installMockBridge({ togetherDoneCommitments: () => Promise.resolve([]) });
    const { container } = render(
      <MemoryRouter>
        <CompletedCommitments />
      </MemoryRouter>,
    );
    await Promise.resolve();
    expect(container.querySelector('button')).toBeNull();
    expect(screen.queryByText(/Together commitments/)).not.toBeInTheDocument();
  });
});
