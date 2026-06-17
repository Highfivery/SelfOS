import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceChip } from './ConfidenceChip';

describe('ConfidenceChip', () => {
  it('shows the level as text (not colour alone) and folds the rationale into the accessible name', () => {
    render(<ConfidenceChip level="high" rationale="corroborated by 3 sessions" />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(
      screen.getByLabelText('High confidence — corroborated by 3 sessions'),
    ).toBeInTheDocument();
  });

  it('renders without a rationale', () => {
    render(<ConfidenceChip level="low" />);
    expect(screen.getByLabelText('Low confidence')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
  });
});
