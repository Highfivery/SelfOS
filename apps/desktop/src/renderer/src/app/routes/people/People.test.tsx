import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { People } from './People';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { usePeopleStore } from '../../../stores/peopleStore';
import type { Person } from '@shared/channels';

const bea: Person = {
  id: 'p1',
  schemaVersion: 1,
  displayName: 'Bea',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

afterEach(() => {
  clearMockBridge();
  usePeopleStore.setState({ people: [], relationships: [], loaded: false });
});

describe('People', () => {
  it('lists people from the store', async () => {
    installMockBridge({ peopleList: () => Promise.resolve([bea]) });
    render(<People />);
    expect(await screen.findByText('Bea')).toBeInTheDocument();
    expect(screen.getByText('Subject')).toBeInTheDocument();
  });

  it('shows the empty state when no one exists', async () => {
    installMockBridge({ peopleList: () => Promise.resolve([]) });
    render(<People />);
    expect(await screen.findByText(/No one here yet/i)).toBeInTheDocument();
  });

  it('adds a person through the editor', async () => {
    const peopleSave = vi.fn((input: { displayName: string }) =>
      Promise.resolve({
        id: 'new',
        schemaVersion: 1,
        displayName: input.displayName,
        isSubject: false,
        tags: [],
        createdAt: 'now',
        updatedAt: 'now',
      }),
    );
    installMockBridge({ peopleSave });
    render(<People />);
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(peopleSave).toHaveBeenCalled();
    expect(peopleSave.mock.calls[0]?.[0]).toMatchObject({ displayName: 'Sam', isSubject: false });
  });

  it('saves shared and private notes separately', async () => {
    const peopleSave = vi.fn((input: { displayName: string }) =>
      Promise.resolve({
        id: 'new',
        schemaVersion: 1,
        displayName: input.displayName,
        isSubject: false,
        tags: [],
        createdAt: 'now',
        updatedAt: 'now',
      }),
    );
    installMockBridge({ peopleSave });
    render(<People />);
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Sam');
    // Notes live on the Notes tab now.
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    await userEvent.type(screen.getByLabelText('Shared notes'), 'a nurse');
    await userEvent.type(screen.getByLabelText('Private notes'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(peopleSave).toHaveBeenCalledWith(
      expect.objectContaining({ publicNotes: 'a nurse', privateNotes: 'secret' }),
    );
  });
});
