import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dream } from '@shared/channels';
import { Dreams } from './Dreams';
import { useDreamStore } from '../../../stores/dreamStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useDreamStore.setState({ dreams: [], loaded: false });
});

const baseDream: Dream = {
  id: 'd1',
  schemaVersion: 1,
  personId: 'owner-1',
  title: 'Mountain flight',
  narrative: 'I was flying over snowy mountains.',
  lucid: true,
  nightmare: false,
  tags: [],
  people: [],
  sensitivity: 'standard',
  status: 'captured',
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
};

/** A dreamSave stub that echoes the input back as a saved Dream, so tests can assert the payload. */
function saveSpy(): ReturnType<typeof vi.fn> {
  return vi.fn((input) =>
    Promise.resolve({
      id: input.id ?? 'd1',
      schemaVersion: 1,
      personId: 'owner-1',
      narrative: input.narrative,
      lucid: input.lucid,
      nightmare: input.nightmare,
      tags: input.tags,
      people: input.people,
      sensitivity: input.sensitivity,
      status: 'captured' as const,
      createdAt: 'now',
      updatedAt: 'now',
    }),
  );
}

describe('Dreams', () => {
  it('shows the empty state when there are no dreams', async () => {
    installMockBridge({ dreamsList: () => Promise.resolve([]) });
    render(<Dreams />);
    expect(await screen.findByText(/no dreams yet/i)).toBeInTheDocument();
  });

  it('lists existing dreams by title', async () => {
    installMockBridge({ dreamsList: () => Promise.resolve([baseDream]) });
    render(<Dreams />);
    expect(await screen.findByText('Mountain flight')).toBeInTheDocument();
  });

  it('captures a dream: narrative-first, with optional flags', async () => {
    const save = saveSpy();
    installMockBridge({ dreamsList: () => Promise.resolve([]), dreamSave: save });
    render(<Dreams />);

    await userEvent.click(screen.getByRole('button', { name: 'Log a dream' }));
    await userEvent.type(
      screen.getByLabelText('What happened?'),
      'I was back in my childhood house.',
    );
    await userEvent.click(screen.getByRole('switch', { name: 'Lucid dream' }));
    await userEvent.selectOptions(screen.getByLabelText('Waking mood'), 'Good');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        narrative: 'I was back in my childhood house.',
        lucid: true,
        nightmare: false,
        mood: 0.5,
        sensitivity: 'standard',
      }),
    );
  });

  it('disables Save until a narrative is entered', async () => {
    installMockBridge({ dreamsList: () => Promise.resolve([]) });
    render(<Dreams />);
    await userEvent.click(screen.getByRole('button', { name: 'Log a dream' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('surfaces a calm error when saving fails', async () => {
    installMockBridge({
      dreamsList: () => Promise.resolve([]),
      dreamSave: () => Promise.reject(new Error('Not permitted')),
    });
    render(<Dreams />);

    await userEvent.click(screen.getByRole('button', { name: 'Log a dream' }));
    await userEvent.type(screen.getByLabelText('What happened?'), 'A dream.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save this dream/i);
  });

  it('deletes a dream after a confirm step', async () => {
    const remove = vi.fn(() => Promise.resolve());
    installMockBridge({ dreamsList: () => Promise.resolve([baseDream]), dreamDelete: remove });
    render(<Dreams />);

    await userEvent.click(await screen.findByText('Mountain flight'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // A confirm step appears before the destructive action runs.
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('d1');
  });
});
