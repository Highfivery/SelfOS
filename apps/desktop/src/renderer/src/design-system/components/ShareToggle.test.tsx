import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareToggle } from './ShareToggle';

describe('ShareToggle', () => {
  it('conveys the shared state as text + aria-pressed, naming the field and the action', () => {
    render(<ShareToggle shared onChange={() => {}} label="Occupation" />);
    const button = screen.getByRole('button', { pressed: true });
    expect(button).toHaveAccessibleName(/occupation: shared — may inform people you relate to/i);
    expect(button).toHaveAccessibleName(/activate to lock/i);
    expect(screen.getByText('Shared')).toBeInTheDocument();
  });

  it('conveys the private (locked) state', () => {
    render(<ShareToggle shared={false} onChange={() => {}} label="Health notes" />);
    const button = screen.getByRole('button', { pressed: false });
    expect(button).toHaveAccessibleName(/health notes: private — used only in this person/i);
    expect(button).toHaveAccessibleName(/activate to share/i);
    expect(screen.getByText('Private')).toBeInTheDocument();
  });

  it('toggles to the opposite state on click', async () => {
    const onChange = vi.fn();
    render(<ShareToggle shared onChange={onChange} label="Notes" />);
    await userEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does not fire when disabled', async () => {
    const onChange = vi.fn();
    render(<ShareToggle shared disabled onChange={onChange} label="Notes" />);
    await userEvent.click(screen.getByRole('button'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
