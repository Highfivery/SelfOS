import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelationshipScopePicker } from './RelationshipScopePicker';

describe('RelationshipScopePicker (42 §3.1)', () => {
  it('shows a Private chip when the scope is empty, naming state + meaning', () => {
    render(<RelationshipScopePicker value={[]} onChange={() => {}} label="Sleep schedule" />);
    const chip = screen.getByRole('button', { expanded: false });
    expect(chip).toHaveAccessibleName(/sleep schedule: private/i);
    expect(screen.getByText('Private')).toBeInTheDocument();
  });

  it('summarizes the scope in the chip when shared', () => {
    render(
      <RelationshipScopePicker value={['partner', 'friend']} onChange={() => {}} label="Goals" />,
    );
    const chip = screen.getByRole('button', { expanded: false });
    expect(chip).toHaveAccessibleName(/goals: shared with partner, friend/i);
    expect(screen.getByText('Shared: Partner, Friend')).toBeInTheDocument();
  });

  it('opens the popover and toggles a relationship type', async () => {
    const onChange = vi.fn();
    render(<RelationshipScopePicker value={[]} onChange={onChange} label="Sleep schedule" />);
    await userEvent.click(screen.getByRole('button', { name: /sleep schedule/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Partner' }));
    expect(onChange).toHaveBeenCalledWith(['partner']);
  });

  it('"Private (only me)" clears the scope', async () => {
    const onChange = vi.fn();
    render(<RelationshipScopePicker value={['partner']} onChange={onChange} label="Health" />);
    await userEvent.click(screen.getByRole('button', { name: /health: shared/i }));
    await userEvent.click(screen.getByRole('button', { name: /private \(only me\)/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('limits the offered types to the person’s graph when availableTypes is given', async () => {
    render(
      <RelationshipScopePicker
        value={[]}
        onChange={() => {}}
        label="Goals"
        availableTypes={['partner', 'sibling']}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /goals/i }));
    expect(screen.getByRole('checkbox', { name: 'Partner' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Sibling' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Coworker' })).not.toBeInTheDocument();
  });
});
