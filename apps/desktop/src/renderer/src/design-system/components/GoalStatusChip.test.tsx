import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GoalStatusChip } from './GoalStatusChip';

describe('GoalStatusChip', () => {
  it('renders a text label (never colour alone) and a data-status hook for tone', () => {
    const { container } = render(<GoalStatusChip status="inProgress" />);
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(container.querySelector('[data-status="inProgress"]')).not.toBeNull();
  });

  it('labels the stale state gently ("Open a while") and the abandoned state as "Let go"', () => {
    const { rerender } = render(<GoalStatusChip status="stale" />);
    expect(screen.getByText('Open a while')).toBeInTheDocument();
    rerender(<GoalStatusChip status="abandoned" />);
    expect(screen.getByText('Let go')).toBeInTheDocument();
  });
});
