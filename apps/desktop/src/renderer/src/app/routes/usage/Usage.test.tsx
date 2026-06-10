import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Usage } from './Usage';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useUsageStore } from '../../../stores/usageStore';
import { useSessionStore } from '../../../stores/sessionStore';
import type { Person, UsageSummary } from '@shared/channels';

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
  byPerson: { 'owner-1': { costUsd: 1.23, count: 4 } },
};

const makePerson = (id: string, displayName: string): Person => ({
  id,
  schemaVersion: 1,
  displayName,
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
});

/** `can()` returns true for everything in super-admin mode — the simplest way to test the admin view. */
function setAdmin(isAdmin: boolean): void {
  useSessionStore.setState({ superAdmin: isAdmin });
}

afterEach(() => {
  clearMockBridge();
  useUsageStore.setState({
    selectedPersonId: null,
    period: 'month',
    summary: null,
    budget: null,
    status: null,
    people: [],
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
    // Admin-only sections are marked (picker, cost, by-person, overall cap).
    expect(screen.getAllByText('Admin only').length).toBeGreaterThanOrEqual(3);
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
    expect(screen.queryByLabelText('Whose usage')).not.toBeInTheDocument(); // no person picker
    expect(screen.queryByRole('heading', { name: 'By person' })).not.toBeInTheDocument();
    expect(screen.queryByText('Admin only')).not.toBeInTheDocument(); // no admin markers
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

  it('lets an admin pick a person and shows a by-person breakdown', async () => {
    const usageSummary = vi.fn(() => Promise.resolve(summary));
    installMockBridge({
      usageSummary,
      peopleList: () => Promise.resolve([makePerson('owner-1', 'Alex'), makePerson('m-1', 'Sam')]),
    });
    setAdmin(true);
    render(<Usage />);
    expect(await screen.findByRole('heading', { name: 'By person' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sam' })).toBeInTheDocument(); // picker populated
    expect(screen.getAllByText('Alex').length).toBeGreaterThanOrEqual(1); // byPerson id resolved

    await userEvent.selectOptions(screen.getByLabelText('Whose usage'), 'm-1');
    await waitFor(() =>
      expect(usageSummary).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'person', personId: 'm-1' }),
      ),
    );
  });
});
