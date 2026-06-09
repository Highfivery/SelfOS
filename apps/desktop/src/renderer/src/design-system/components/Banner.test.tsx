import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Banner } from './Banner';

describe('Banner', () => {
  it('renders its message as a status region', () => {
    render(<Banner tone="warning">Heads up</Banner>);
    expect(screen.getByRole('status')).toHaveTextContent('Heads up');
  });
});
