import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineChart } from './LineChart';

describe('LineChart', () => {
  it('renders an accessible labelled chart with a polyline + legend per series', () => {
    const { container } = render(
      <LineChart
        ariaLabel="Trend over time"
        series={[
          {
            label: 'Mara',
            points: [
              { x: 0, y: 1 },
              { x: 1, y: 3 },
            ],
          },
          {
            label: 'Sam',
            points: [
              { x: 0, y: 2 },
              { x: 1, y: 2 },
            ],
          },
        ]}
      />,
    );
    // role=img with the provided accessible name (via <title>).
    expect(screen.getByRole('img', { name: 'Trend over time' })).toBeInTheDocument();
    // One polyline per series; the legend names each.
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
    expect(screen.getByText('Mara')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });
});
