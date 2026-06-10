import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonBudgetEditor } from './PersonBudgetEditor';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import type { Person } from '@shared/channels';

const person: Person = {
  id: 'p1',
  schemaVersion: 1,
  displayName: 'Sam',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

afterEach(() => clearMockBridge());

describe('PersonBudgetEditor', () => {
  it('loads the budget and saves with the person id', async () => {
    const budgetSetPerson = vi.fn(() => Promise.resolve());
    installMockBridge({
      budgetGetPerson: () => Promise.resolve({ limitUsd: 10, period: 'week', warnRatio: 0.8 }),
      budgetSetPerson,
    });
    render(<PersonBudgetEditor person={person} />);
    const limit = await screen.findByLabelText('Limit (USD)');
    await userEvent.clear(limit);
    await userEvent.type(limit, '15');
    await userEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(budgetSetPerson).toHaveBeenCalledWith({
      personId: 'p1',
      budget: { limitUsd: 15, period: 'week', warnRatio: 0.8 },
    });
  });

  it('resets to the default', async () => {
    const budgetSetPerson = vi.fn(() => Promise.resolve());
    installMockBridge({
      budgetGetPerson: () => Promise.resolve({ limitUsd: 20, period: 'month', warnRatio: 0.8 }),
      budgetSetPerson,
    });
    render(<PersonBudgetEditor person={person} />);
    await screen.findByLabelText('Limit (USD)');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(budgetSetPerson).toHaveBeenCalledWith({ personId: 'p1', budget: null });
  });
});
