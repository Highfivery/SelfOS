import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UsageRing } from './UsageRing';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import { useBudgetStore } from '../stores/budgetStore';
import { useSessionStore } from '../stores/sessionStore';

function renderRing(): void {
  render(
    <MemoryRouter>
      <UsageRing />
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useBudgetStore.setState({ status: null });
  useSessionStore.setState({ superAdmin: false, activePerson: null, access: null });
});

describe('UsageRing', () => {
  it('shows the percentage and opens a popover with stats + a link', async () => {
    installMockBridge({
      budgetStatus: () =>
        Promise.resolve({
          person: { state: 'warn', spentUsd: 3, limitUsd: 10, period: 'week' },
          app: { state: 'none', spentUsd: 0, limitUsd: null, period: null },
        }),
    });
    renderRing();
    const button = await screen.findByRole('button', { name: /AI usage: 30% used this week/i });
    await userEvent.click(button);
    expect(screen.getByText('30% of your allowance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View usage details →' })).toBeInTheDocument();
  });

  it('hides cost for a non-admin', async () => {
    installMockBridge({
      budgetStatus: () =>
        Promise.resolve({
          person: { state: 'ok', spentUsd: 3, limitUsd: 10, period: 'week' },
          app: { state: 'none', spentUsd: 0, limitUsd: null, period: null },
        }),
    });
    renderRing();
    await userEvent.click(await screen.findByRole('button', { name: /AI usage/i }));
    expect(screen.queryByText(/\$3\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText('Admin only')).not.toBeInTheDocument();
  });

  it('shows admin $ with the Admin only badge + the top usage types', async () => {
    useSessionStore.setState({ superAdmin: true }); // bypasses gating → budgets.manage
    installMockBridge({
      budgetStatus: () =>
        Promise.resolve({
          person: { state: 'ok', spentUsd: 3, limitUsd: 10, period: 'week' },
          app: { state: 'none', spentUsd: 0, limitUsd: null, period: null },
        }),
      usageSummary: () =>
        Promise.resolve({
          totalCostUsd: 3,
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          cacheSavingsUsd: 0,
          sessionCount: 2,
          avgCostPerSession: 1.5,
          avgCostPerType: 1.5,
          byType: { chat: { costUsd: 2, count: 5 }, 'dream.image': { costUsd: 1, count: 1 } },
          byModel: {},
          byPerson: {},
        }),
    });
    renderRing();
    await userEvent.click(await screen.findByRole('button', { name: /AI usage/i }));
    // $ figure + the Admin only badge (admins only).
    expect(await screen.findByText('$3.00 of $10.00')).toBeInTheDocument();
    expect(screen.getByText('Admin only')).toBeInTheDocument();
    // Session count + the highest-count usage types (most-used first).
    expect(screen.getByText('2 sessions this week')).toBeInTheDocument();
    expect(screen.getByText(/Top usage:/)).toBeInTheDocument();
  });
});
