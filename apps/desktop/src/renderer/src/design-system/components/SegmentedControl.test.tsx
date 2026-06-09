import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';

type Fruit = 'a' | 'b';
const options: ReadonlyArray<SegmentOption<Fruit>> = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
];

describe('SegmentedControl', () => {
  it('marks the selected option as pressed', () => {
    render(<SegmentedControl options={options} value="a" onChange={() => {}} aria-label="Fruit" />);
    expect(screen.getByRole('button', { name: 'Apple' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Banana' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the chosen value', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="a" onChange={onChange} aria-label="Fruit" />);
    await userEvent.click(screen.getByRole('button', { name: 'Banana' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
