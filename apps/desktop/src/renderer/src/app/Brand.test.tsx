import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Brand } from './Brand';

describe('Brand', () => {
  it('renders the sprout mark and the wordmark (presentational, no routing)', () => {
    render(<Brand />);
    // The wordmark text is present (CSS hides it only at the smallest widths).
    expect(screen.getByText('SelfOS')).toBeInTheDocument();
  });
});
