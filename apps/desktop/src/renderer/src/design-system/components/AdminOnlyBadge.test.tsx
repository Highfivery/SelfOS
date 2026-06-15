import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminOnlyBadge } from './AdminOnlyBadge';

describe('AdminOnlyBadge', () => {
  it('renders the "Admin only" label (text, not colour-only)', () => {
    render(<AdminOnlyBadge />);
    expect(screen.getByText('Admin only')).toBeInTheDocument();
  });

  it('exposes a tooltip explaining who can see the marked content', () => {
    render(<AdminOnlyBadge />);
    expect(screen.getByText('Admin only')).toHaveAttribute(
      'title',
      'Only the household owner can see this.',
    );
  });
});
