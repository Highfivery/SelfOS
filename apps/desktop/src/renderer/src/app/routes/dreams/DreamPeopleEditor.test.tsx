import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DreamPersonRef } from '@shared/channels';
import { DreamPeopleEditor } from './DreamPeopleEditor';
import { useSessionStore } from '../../../stores/sessionStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const people = [
  { id: 'p-sam', displayName: 'Sam' },
  { id: 'p-robin', displayName: 'Robin' },
];

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null });
  usePeopleStore.setState({ people: [], relationships: [], loaded: false });
});

/** A stateful harness so `values` actually updates on `onChange` (the composer's real behaviour). */
function renderEditor(initial: DreamPersonRef[] = []): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  function Harness(): JSX.Element {
    const [values, setValues] = useState<DreamPersonRef[]>(initial);
    return (
      <DreamPeopleEditor
        values={values}
        onChange={(next) => {
          onChange(next);
          setValues(next);
        }}
        people={people}
      />
    );
  }
  render(<Harness />);
  return onChange;
}

describe('DreamPeopleEditor', () => {
  it('links a known person from the dropdown (carries a personId)', async () => {
    const onChange = renderEditor();
    await userEvent.selectOptions(screen.getByLabelText('Link a person you know'), 'p-sam');
    expect(onChange).toHaveBeenCalledWith([{ personId: 'p-sam' }]);
  });

  it('adds a free name (text only, no personId)', async () => {
    const onChange = renderEditor();
    await userEvent.type(screen.getByPlaceholderText(/add a name/i), 'a stranger');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith([{ name: 'a stranger' }]);
  });

  it('shows a linked marker + resolved name for a People-graph link', () => {
    renderEditor([{ personId: 'p-robin' }]);
    expect(screen.getByText('Robin')).toBeInTheDocument();
    expect(screen.getByText('linked')).toBeInTheDocument();
  });

  it('renders a free name without a linked marker', () => {
    renderEditor([{ name: 'a stranger' }]);
    expect(screen.getByText('a stranger')).toBeInTheDocument();
    expect(screen.queryByText('linked')).not.toBeInTheDocument();
  });

  it('omits already-linked people from the dropdown', () => {
    renderEditor([{ personId: 'p-sam' }]);
    const select = screen.getByLabelText('Link a person you know');
    expect(select).not.toHaveTextContent('Sam');
    expect(select).toHaveTextContent('Robin');
  });

  it('removes a person', async () => {
    const onChange = renderEditor([{ personId: 'p-sam' }, { name: 'a stranger' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove a stranger' }));
    expect(onChange).toHaveBeenCalledWith([{ personId: 'p-sam' }]);
  });

  // --- §15.6: offer to add a genuinely-new name to the household as a contact ---

  it('offers to add a new name; adding creates a contact and upgrades the chip to linked', async () => {
    installMockBridge({
      peopleSave: (input) =>
        Promise.resolve({
          id: 'new-1',
          schemaVersion: 1,
          displayName: input.displayName,
          isSubject: input.isSubject,
          tags: [],
          createdAt: 'now',
          updatedAt: 'now',
        }),
      peopleList: () => Promise.resolve([]),
    });
    const onChange = renderEditor();
    await userEvent.type(screen.getByPlaceholderText(/add a name/i), 'Sarah');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    // The add-to-people prompt appears for a genuinely-new name.
    expect(await screen.findByText(/add .*sarah.* to your people/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /add as contact/i }));

    // The free chip is upgraded to a linked personId (name kept as a fallback label).
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith([{ personId: 'new-1', name: 'Sarah' }]),
    );
    // The optional relationship step then appears.
    expect(await screen.findByText(/how do you know sarah/i)).toBeInTheDocument();
  });

  it('saves an optional relationship for the just-added contact', async () => {
    const saveRel = vi.fn(() => Promise.resolve());
    installMockBridge({
      peopleSave: (input) =>
        Promise.resolve({
          id: 'new-1',
          schemaVersion: 1,
          displayName: input.displayName,
          isSubject: input.isSubject,
          tags: [],
          createdAt: 'now',
          updatedAt: 'now',
        }),
      peopleList: () => Promise.resolve([]),
      relationshipsSave: saveRel as never,
    });
    useSessionStore.setState({
      activePerson: {
        id: 'owner-1',
        schemaVersion: 1,
        displayName: 'Me',
        isSubject: true,
        tags: [],
        createdAt: 'now',
        updatedAt: 'now',
      },
    });
    renderEditor();
    await userEvent.type(screen.getByPlaceholderText(/add a name/i), 'Sarah');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(await screen.findByRole('button', { name: /add as contact/i }));
    await userEvent.selectOptions(await screen.findByLabelText('Relationship'), 'partner');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saveRel).toHaveBeenCalledWith(
        expect.objectContaining({ fromPersonId: 'owner-1', toPersonId: 'new-1', type: 'partner' }),
      ),
    );
  });

  it('does not offer to add a name that matches an existing household person', async () => {
    const onChange = renderEditor();
    await userEvent.type(screen.getByPlaceholderText(/add a name/i), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith([{ name: 'Sam' }]);
    expect(screen.queryByText(/to your people/i)).not.toBeInTheDocument();
  });

  it('"Not now" keeps the free name without creating a contact', async () => {
    const save = vi.fn();
    installMockBridge({ peopleSave: save as never });
    renderEditor();
    await userEvent.type(screen.getByPlaceholderText(/add a name/i), 'Sarah');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(await screen.findByRole('button', { name: /not now/i }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.queryByText(/to your people/i)).not.toBeInTheDocument();
  });
});
