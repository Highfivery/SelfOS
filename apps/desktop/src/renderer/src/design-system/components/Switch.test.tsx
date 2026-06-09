import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';

describe('Switch', () => {
  it('exposes role switch with aria-checked', () => {
    render(<Switch checked onChange={() => {}} aria-label="Notifications" />);
    expect(screen.getByRole('switch', { name: 'Notifications' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('toggles via onChange when clicked', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="Notifications" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not fire when disabled', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} disabled onChange={onChange} aria-label="Notifications" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
