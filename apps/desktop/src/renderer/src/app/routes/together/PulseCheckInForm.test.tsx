import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PulseCheckInForm } from './PulseCheckInForm';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const emptyView = {
  checkInSeries: [],
  sessionSeries: [],
  hasCheckIns: false,
  alignment: { ready: false as const },
};

afterEach(() => clearMockBridge());

describe('PulseCheckInForm (spec 61 §3.4)', () => {
  it('logs the three metrics + a consented desire share, and shows the heading by default', async () => {
    const log = vi.fn<
      (input: {
        partnerPersonId: string;
        metrics: Record<string, number>;
        shareMetrics?: string[];
      }) => Promise<typeof emptyView>
    >(() => Promise.resolve(emptyView));
    installMockBridge({ togetherPulseLog: log });
    render(<PulseCheckInForm partnerId="angel" partnerName="Angel" />);

    expect(screen.getByRole('heading', { name: 'How are things with Angel?' })).toBeInTheDocument();
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Desire')).toBeInTheDocument();
    expect(screen.getByText('Satisfaction')).toBeInTheDocument();

    // Raise connection to High (scoped to its own control), opt in to sharing desire, then save.
    const connection = screen.getByRole('group', { name: 'Connection level' });
    await userEvent.click(within(connection).getByRole('button', { name: 'High' }));
    await userEvent.click(screen.getByRole('switch', { name: /Share my desire level with Angel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save check-in' }));

    expect(log).toHaveBeenCalledTimes(1);
    const arg = log.mock.calls[0]![0];
    expect(arg.partnerPersonId).toBe('angel');
    expect(arg.metrics.connection).toBe(1); // High → 1
    expect(arg.metrics.desire).toBe(0.5); // untouched → steady
    expect(arg.shareMetrics).toEqual(['desire']);
  });

  it('hides its own heading when hideHead is set (the Home card supplies the label)', () => {
    installMockBridge({ togetherPulseLog: () => Promise.resolve(emptyView) });
    render(<PulseCheckInForm partnerId="angel" partnerName="Angel" hideHead />);
    expect(
      screen.queryByRole('heading', { name: 'How are things with Angel?' }),
    ).not.toBeInTheDocument();
    // The metric controls + Save still render.
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save check-in' })).toBeInTheDocument();
  });
});
