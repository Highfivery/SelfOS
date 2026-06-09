import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Home } from './Home';

describe('Home', () => {
  it('renders the welcome heading', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: /a calm space for yourself/i })).toBeInTheDocument();
  });

  it('renders the reflective lede', () => {
    render(<Home />);
    expect(screen.getByText(/your words stay yours/i)).toBeInTheDocument();
  });
});
