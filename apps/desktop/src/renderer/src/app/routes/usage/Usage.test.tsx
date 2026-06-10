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

/** `can()` returns true for everything in super-admin mode — the simplest way to test the admin view. */
function setAdmin(isAdmin: boolean): void {
  useSessionStore.setState({ superAdmin: isAdmin });
}

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
  it('shows cost, breakdowns, and budgets for an admin', async () => {
    installMockBridge({ usageSummary: () => Promise.resolve(summary) });
    setAdmin(true);
    render(<Usage />);
    expect(await screen.findByRole('heading', { name: '$1.23' })).toBeInTheDocument(); // total
    expect(screen.getByText('Coaching session')).toBeInTheDocument(); // by type label
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument(); // by model
    expect(screen.getByText('$0.05')).toBeInTheDocument(); // cache savings ($)
    expect(screen.getAllByRole('button', { name: 'Save' }).length).toBeGreaterThan(0); // budget editor
  });

  it('hides cost and budgets for a normal user, showing only their usage', async () => {
    installMockBridge({ usageSummary: () => Promise.resolve(summary) });
    setAdmin(false);
    render(<Usage />);
    expect(await screen.findByText('Input tokens')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '$1.23' })).not.toBeInTheDocument(); // no cost
    expect(screen.queryByText('Cache savings')).not.toBeInTheDocument(); // no $ savings
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(); // no budgets
    expect(screen.queryByRole('group', { name: 'Whose usage' })).not.toBeInTheDocument(); // no Everyone scope
  });

  it('saves the optional overall cap as an admin', async () => {
    const budgetSetApp = vi.fn(() => Promise.resolve());
    installMockBridge({ usageSummary: () => Promise.resolve(summary), budgetSetApp });
    setAdmin(true);
    render(<Usage />);
    await screen.findByRole('heading', { name: '$1.23' });
    await userEvent.type(screen.getByLabelText('Everyone (app) limit (USD)'), '25');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(budgetSetApp).toHaveBeenCalledWith({ limitUsd: 25, period: 'month', warnRatio: 0.8 });
  });
});
