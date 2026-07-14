import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AgreementSummary } from '@shared/schemas';
import { TogetherCommitments } from './TogetherCommitments';
import { useTogetherStore } from '../../../stores/togetherStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

function summary(over: Partial<AgreementSummary> = {}): AgreementSummary {
  return {
    partnerPersonId: 'angel',
    partnerName: 'Angel',
    agreement: {
      id: 'a1',
      schemaVersion: 1,
      pairKey: 'angel~ben',
      text: 'Weekly date night',
      timeframe: 'Fridays',
      status: 'standing',
      provenance: { sessionId: 'sess-1', at: '2026-07-01T00:00:00.000Z' },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    ...over,
  };
}

function renderIt(): void {
  render(
    <MemoryRouter>
      <TogetherCommitments />
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useTogetherStore.getState().reset();
});

describe('Together commitments (spec 61 §3.2)', () => {
  it('lists standing agreements with the partner named, and marks one done via the shared ledger', async () => {
    const setStatus = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      togetherMyAgreements: () => Promise.resolve([summary()]),
      togetherSetAgreementStatus: setStatus,
    });
    renderIt();

    expect(await screen.findByText('Weekly date night')).toBeInTheDocument();
    expect(screen.getByText('Angel')).toBeInTheDocument();
    expect(screen.getByText('Fridays')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Together commitments/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(setStatus).toHaveBeenCalledWith({
      partnerPersonId: 'angel',
      agreementId: 'a1',
      status: 'done',
    });
  });

  it('renders nothing when there are no standing agreements', async () => {
    installMockBridge({ togetherMyAgreements: () => Promise.resolve([]) });
    const { container } = render(
      <MemoryRouter>
        <TogetherCommitments />
      </MemoryRouter>,
    );
    // Allow the mount-effect fetch to resolve, then assert it stays hidden.
    await Promise.resolve();
    expect(container.querySelector('button')).toBeNull();
    expect(screen.queryByText(/Together commitments/)).not.toBeInTheDocument();
  });
});
