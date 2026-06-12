import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DreamPersonRef } from '@shared/channels';
import { DreamPeopleEditor } from './DreamPeopleEditor';

const people = [
  { id: 'p-sam', displayName: 'Sam' },
  { id: 'p-robin', displayName: 'Robin' },
];

function renderEditor(values: DreamPersonRef[] = []): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(<DreamPeopleEditor values={values} onChange={onChange} people={people} />);
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
});
