import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Usage } from './Usage';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useUsageStore } from '../../../stores/usageStore';
import { useSessionStore } from '../../../stores/sessionStore';
import type { UsageSummary } from '@shared/channels';

const summary: UsageSummary = {
  totalCostUsd: 1.23,
  inputTokens: 1000,
  outputTokens: 500,
  cacheWriteTokens: 0,
  cacheReadTokens: 2000,
  cacheSavingsUsd: 0.05,
  sessionCount: 2,
  avgCostPerSession: 0.615,
  avgCostPerType: 1.23,
  byType: { chat: { costUsd: 1.23, count: 4 } },
  byModel: { 'claude-sonnet-4-6': { costUsd: 1.23, count: 4 } },
};

afterEach(() => {
  clearMockBridge();
  useUsageStore.setState({
    scope: 'person',
    period: 'month',
    summary: null,
    budget: null,
    status: null,
    loaded: false,
  });
  useSessionStore.setState({
    status: null,
    activePerson: null,
    access: null,
    loaded: false,
    superAdmin: false,
  });
});

describe('Usage', () => {
  it('renders totals and breakdowns', async () => {
    installMockBridge({ usageSummary: () => Promise.resolve(summary) });
    render(<Usage />);
    expect(await screen.findByRole('heading', { name: '$1.23' })).toBeInTheDocument(); // total
    expect(screen.getByText('Coaching session')).toBeInTheDocument(); // by type label
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument(); // by model
    expect(screen.getByText('$0.05')).toBeInTheDocument(); // cache savings
  });

  it('saves a personal budget', async () => {
    const budgetSetPerson = vi.fn(() => Promise.resolve());
    installMockBridge({ usageSummary: () => Promise.resolve(summary), budgetSetPerson });
    render(<Usage />);
    await screen.findByRole('heading', { name: '$1.23' });
    await userEvent.type(screen.getByLabelText('My budget limit (USD)'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(budgetSetPerson).toHaveBeenCalledWith({ limitUsd: 10, period: 'month', warnRatio: 0.8 });
  });
});
