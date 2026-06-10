import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Brand } from './Brand';

describe('Brand', () => {
  it('shows the wordmark when expanded', () => {
    render(<Brand />);
    expect(screen.getByText('SelfOS')).toBeInTheDocument();
  });

  it('collapses to a labelled mark only (no wordmark text)', () => {
    render(<Brand collapsed />);
    expect(screen.queryByText('SelfOS')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'SelfOS' })).toBeInTheDocument();
  });
});
