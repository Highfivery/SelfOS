import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LifeRing } from '@selfos/core/home';
import { LifeRings } from './LifeRings';

const ring = (over: Partial<LifeRing>): LifeRing => ({
  key: 'wellbeing',
  label: 'Wellbeing',
  value: 0.72,
  pct: 72,
  levelLabel: 'Active',
  softened: false,
  ...over,
});

describe('LifeRings', () => {
  it('shows each ring with BOTH the level word and the % (the owner’s choice)', () => {
    render(
      <LifeRings rings={[ring({}), ring({ key: 'connection', label: 'Connection', pct: 40 })]} />,
    );
    expect(screen.getByText('Wellbeing')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText(/not a score to chase/i)).toBeInTheDocument();
  });

  it('hides the % and shows supportive copy when softened during a crisis (§8)', () => {
    render(<LifeRings rings={[ring({ softened: true, levelLabel: 'Steady' })]} />);
    expect(screen.queryByText('72%')).toBeNull();
    expect(screen.getByText('Steady')).toBeInTheDocument();
    expect(screen.getByText(/be kind to yourself/i)).toBeInTheDocument();
  });

  it('renders nothing when there are no rings', () => {
    const { container } = render(<LifeRings rings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
