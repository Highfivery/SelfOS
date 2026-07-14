import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('shows a label, value, positive delta, and sub-line', () => {
    render(<StatTile label="Insights" value="23" delta={3} sub="2 need review" />);
    expect(screen.getByText('Insights')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2 need review')).toBeInTheDocument();
  });

  it('renders as a static tile without onClick, and a button with it', () => {
    const onClick = vi.fn();
    const { rerender } = render(<StatTile label="Sessions" value="4" />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<StatTile label="Sessions" value="4" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});
