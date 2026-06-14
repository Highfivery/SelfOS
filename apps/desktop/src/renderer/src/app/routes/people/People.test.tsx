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

  it('saves descriptive About fields, including health/faith now inline (15 §3.1)', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'About' }));
    await userEvent.selectOptions(screen.getByLabelText('Gender'), 'Non-binary');
    await userEvent.type(screen.getByLabelText('Appearance'), 'tall, curly hair');
    await userEvent.type(screen.getByLabelText('Occupation'), 'nurse');
    await userEvent.type(screen.getByLabelText('Health notes'), 'manages asthma');
    await userEvent.type(screen.getByLabelText('Faith'), 'Buddhist');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(peopleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        gender: 'Non-binary',
        appearanceDescription: 'tall, curly hair',
        occupation: 'nurse',
        healthNotes: 'manages asthma',
        faith: 'Buddhist',
      }),
    );
  });

  it('locks a single field via its ShareToggle → persists privateFields (15 §4.1)', async () => {
    const peopleSave = vi.fn((input: { displayName: string }) =>
      Promise.resolve({
        id: 'new',
        schemaVersion: 2,
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
    await userEvent.click(screen.getByRole('button', { name: 'About' }));
    await userEvent.type(screen.getByLabelText('Occupation'), 'nurse');
    // Each field defaults to shared; clicking its toggle locks it.
    await userEvent.click(screen.getByRole('button', { name: /occupation: shared/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(peopleSave.mock.calls[0]?.[0]).toMatchObject({
      occupation: 'nurse',
      privateFields: expect.arrayContaining(['occupation']),
    });
  });

  it('"Lock all" locks every controllable field; default save carries no privateFields', async () => {
    const peopleSave = vi.fn((input: { displayName: string }) =>
      Promise.resolve({
        id: 'new',
        schemaVersion: 2,
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
    await userEvent.click(screen.getByRole('button', { name: 'About' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lock all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    const locked = (peopleSave.mock.calls[0]?.[0] as { privateFields?: string[] }).privateFields;
    expect(locked).toEqual(
      expect.arrayContaining(['notes', 'healthNotes', 'faith', 'occupation', 'gender', 'pronouns']),
    );
  });

  it('shows the §3.1 inline explainer and not the old "never shared" private copy', async () => {
    installMockBridge({});
    render(<People />);
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await userEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(screen.getByText(/Lock any item to keep it to this person only/i)).toBeInTheDocument();
    expect(
      screen.queryByText(
        /never shared with anyone else’s AI, and never sent to an image provider/i,
      ),
    ).not.toBeInTheDocument();
  });

  it('reveals a free-text field when gender is "Other" and saves the typed value', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'About' }));
    await userEvent.selectOptions(screen.getByLabelText('Gender'), 'Other…');
    await userEvent.type(screen.getByLabelText('Gender (describe)'), 'genderfluid');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(peopleSave).toHaveBeenCalledWith(expect.objectContaining({ gender: 'genderfluid' }));
  });

  it('saves the merged Notes field (15 §4.3)', async () => {
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
    // The merged single Notes field lives on the Notes tab now (15-shareability §4.3).
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    await userEvent.type(screen.getByLabelText('Notes'), 'a nurse');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(peopleSave).toHaveBeenCalledWith(expect.objectContaining({ notes: 'a nurse' }));
  });
});
