import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('a legacy broadcast fact reads as all available types, narrowable on edit', async () => {
    const update = vi.fn(() => Promise.resolve(null));
    installMockBridge({ insightsUpdate: update });
    render(
      <FactSharingControl
        insightId="i1"
        subjectPersonId="p1"
        fact={fact({ id: 'f1', text: 'Broadcast fact', shareable: true })}
        availableTypes={['partner', 'sibling']}
      />,
    );
    // Honest: a broadcast fact currently reaches every related person → shown as all available types.
    expect(
      screen.getByRole('button', { name: /shared with Partner, Sibling/i }),
    ).toBeInTheDocument();
    // Narrowing it to just Partner re-scopes (and drops the broadcast — the scoped model never broadcasts).
    await userEvent.click(screen.getByRole('button', { name: /Broadcast fact/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sibling' }));
    expect(update).toHaveBeenCalledWith({
      subjectPersonId: 'p1',
      id: 'i1',
      facts: [{ id: 'f1', text: 'Broadcast fact', shareable: false, shareableTypes: ['partner'] }],
    });
  });
});
