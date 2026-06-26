import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubscaleBar } from './SubscaleBar';

describe('SubscaleBar', () => {
  it('renders a unit subscale value as a percent + the band (text, not colour-only)', () => {
    render(<SubscaleBar label="Openness" normalized={0.72} band="leans higher" />);
    expect(screen.getByText('Openness')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('leans higher')).toBeInTheDocument();
  });

  it('renders a signed subscale value with a sign', () => {
    render(<SubscaleBar label="Orientation" normalized={-0.4} signed />);
    expect(screen.getByText('−0.40')).toBeInTheDocument();
  });

  it('shows 0 for a neutral signed value', () => {
    render(<SubscaleBar label="Orientation" normalized={0} signed />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
