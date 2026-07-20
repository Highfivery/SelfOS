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

  it('draws an area fill only when `fill`, and a ringed latest point only when `emphasizeLast` (65 §3.5)', () => {
    const series = [
      {
        label: 'Mood',
        points: [
          { x: 0, y: 1 },
          { x: 1, y: 3 },
          { x: 2, y: 2 },
        ],
      },
    ];
    const plain = render(<LineChart ariaLabel="plain" series={series} />);
    expect(plain.container.querySelectorAll('polygon')).toHaveLength(0);
    plain.unmount();

    const rich = render(<LineChart ariaLabel="rich" series={series} fill emphasizeLast />);
    expect(rich.container.querySelectorAll('polygon')).toHaveLength(1); // one area fill per series
    // emphasizeLast overlays one ringed (stroke) marker per series on top of the plain dots.
    const ringed = [...rich.container.querySelectorAll('circle')].filter((c) =>
      c.getAttribute('stroke'),
    );
    expect(ringed).toHaveLength(1);
  });

  it('applies an optional maxWidth override so callers can fill a wider column', () => {
    const series = [{ label: 'A', points: [{ x: 0, y: 1 }] }];
    const { container, rerender } = render(<LineChart ariaLabel="default" series={series} />);
    // Default: no inline max-width (the CSS default 440px cap applies).
    expect((container.firstElementChild as HTMLElement).style.maxWidth).toBe('');
    rerender(<LineChart ariaLabel="wide" series={series} maxWidth={600} />);
    expect((container.firstElementChild as HTMLElement).style.maxWidth).toBe('600px');
  });
});
