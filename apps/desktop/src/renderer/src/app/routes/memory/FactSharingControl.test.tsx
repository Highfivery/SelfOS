import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InsightFact } from '@shared/schemas';
import { FactSharingControl } from './FactSharingControl';
import { useInsightStore } from '../../../stores/insightStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const fact = (over: Partial<InsightFact> & { id: string; text: string }): InsightFact => ({
  shareable: false,
  ...over,
});

afterEach(() => {
  clearMockBridge();
  useInsightStore.setState({ insights: [], outbound: { items: [] }, loaded: false });
});

describe('FactSharingControl', () => {
  it('scopes a normal fact to a relationship type (shareableTypes, never broadcast)', async () => {
    const update = vi.fn(() => Promise.resolve(null));
    installMockBridge({ insightsUpdate: update });
    render(
      <FactSharingControl
        insightId="i1"
        subjectPersonId="p1"
        fact={fact({ id: 'f1', text: 'Values steady routines' })}
        availableTypes={['partner', 'sibling']}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Values steady routines/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Partner' }));
    expect(update).toHaveBeenCalledWith({
      subjectPersonId: 'p1',
      id: 'i1',
      facts: [
        { id: 'f1', text: 'Values steady routines', shareable: false, shareableTypes: ['partner'] },
      ],
    });
  });

  it('requires a deliberate two-step to un-restrict a sensitive fact, then scopes it', async () => {
    const update = vi.fn(() => Promise.resolve(null));
    installMockBridge({ insightsUpdate: update });
    render(
      <FactSharingControl
        insightId="i1"
        subjectPersonId="p1"
        fact={fact({ id: 'f1', text: 'A trauma detail', restricted: true })}
        availableTypes={['partner']}
      />,
    );
    // Sensitive: own-coaching-only, no picker yet.
    expect(screen.getByText(/sensitive · only your coach/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Share with someone/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: /A trauma detail/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Partner' }));
    expect(update).toHaveBeenCalledWith({
      subjectPersonId: 'p1',
      id: 'i1',
      facts: [
        {
          id: 'f1',
          text: 'A trauma detail',
          shareable: false,
          shareableTypes: ['partner'],
          restricted: false,
        },
      ],
    });
  });

  it('cancels the sensitive two-step without writing', async () => {
    const update = vi.fn(() => Promise.resolve(null));
    installMockBridge({ insightsUpdate: update });
    render(
      <FactSharingControl
        insightId="i1"
        subjectPersonId="p1"
        fact={fact({ id: 'f1', text: 'A trauma detail', restricted: true })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Share with someone/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByText(/sensitive · only your coach/)).toBeInTheDocument(),
    );
    expect(update).not.toHaveBeenCalled();
  });
});
