import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IntimacyTopicsView } from '@shared/channels';
import { IntimacyTopicsControl } from './IntimacyTopicsControl';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => clearMockBridge());

const view = (custom: IntimacyTopicsView['custom']): IntimacyTopicsView => ({
  builtIn: { activities: ['Oral (giving)', 'Bondage'], fantasies: ['Voyeurism'] },
  custom,
});

describe('IntimacyTopicsControl (§16.5a)', () => {
  it('shows custom topics removable, the built-in count, and the 18+ note', async () => {
    installMockBridge({
      questionnairesIntimacyTopics: () =>
        Promise.resolve(view({ activities: ['Wax play'], fantasies: [] })),
    });
    render(<IntimacyTopicsControl />);

    expect(await screen.findByText('Wax play')).toBeInTheDocument();
    expect(screen.getByText(/18\+ only/i)).toBeInTheDocument();
    // No custom fantasies yet → the built-in count is surfaced.
    expect(screen.getByText(/1 built-in topics are always included/i)).toBeInTheDocument();
  });

  it('adds a custom topic via the IPC and refreshes', async () => {
    const add = vi.fn(() => Promise.resolve(view({ activities: ['Wax play'], fantasies: [] })));
    installMockBridge({
      questionnairesIntimacyTopics: () => Promise.resolve(view({ activities: [], fantasies: [] })),
      questionnairesAddIntimacyTopic: add,
    });
    render(<IntimacyTopicsControl />);

    await userEvent.type(await screen.findByLabelText('Add a custom activity'), 'Wax play');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0] as HTMLElement);
    await waitFor(() => expect(add).toHaveBeenCalledWith({ kind: 'activities', name: 'Wax play' }));
    expect(await screen.findByText('Wax play')).toBeInTheDocument();
  });

  it('removes a custom topic via the IPC', async () => {
    const remove = vi.fn(() => Promise.resolve(view({ activities: [], fantasies: [] })));
    installMockBridge({
      questionnairesIntimacyTopics: () =>
        Promise.resolve(view({ activities: ['Wax play'], fantasies: [] })),
      questionnairesRemoveIntimacyTopic: remove,
    });
    render(<IntimacyTopicsControl />);

    await userEvent.click(await screen.findByRole('button', { name: 'Remove Wax play' }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ kind: 'activities', name: 'Wax play' }),
    );
  });
});
