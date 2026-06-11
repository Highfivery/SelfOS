import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FrequencyBars } from './FrequencyBars';
import { ProportionBar } from './ProportionBar';
import { TrendLine } from './TrendLine';

describe('chart primitives', () => {
  it('FrequencyBars renders each label with its count as text (not colour-only)', () => {
    render(
      <FrequencyBars
        items={[
          { label: 'water', value: 6 },
          { label: 'house', value: 4 },
        ]}
      />,
    );
    expect(screen.getByText('water')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('house')).toBeInTheDocument();
  });

  it('FrequencyBars shows the empty label when there are no items', () => {
    render(<FrequencyBars items={[]} emptyLabel="Nothing yet." />);
    expect(screen.getByText('Nothing yet.')).toBeInTheDocument();
  });

  it('ProportionBar renders the value-of-total figure as text', () => {
    render(<ProportionBar label="Nightmares" value={5} total={12} tone="warning" />);
    expect(screen.getByText('Nightmares')).toBeInTheDocument();
    expect(screen.getByText(/5 of 12 · 42%/)).toBeInTheDocument();
  });

  it('TrendLine exposes an accessible label and a text empty state', () => {
    const { rerender } = render(
      <TrendLine
        points={[
          { date: '2026-06-01', value: 0 },
          { date: '2026-06-02', value: 0.5 },
        ]}
        min={-1}
        max={1}
        aria-label="Mood trend"
      />,
    );
    expect(screen.getByRole('img', { name: /mood trend/i })).toBeInTheDocument();
    rerender(
      <TrendLine points={[]} min={-1} max={1} aria-label="Mood trend" emptyLabel="No data yet." />,
    );
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });
});
