import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RhythmStreak } from './RhythmStreak';

describe('RhythmStreak', () => {
  it('shows an N-day rhythm pill for a live run of ≥2 days', () => {
    render(<RhythmStreak streak={{ days: 12, since: '2026-07-02', suppressed: false }} />);
    expect(screen.getByText(/12-day rhythm/i)).toBeInTheDocument();
  });

  it('hides a one-day (too-thin) run', () => {
    const { container } = render(
      <RhythmStreak streak={{ days: 1, since: '2026-07-13', suppressed: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('hides entirely when suppressed during a crisis (never streak-shame, §8)', () => {
    const { container } = render(<RhythmStreak streak={{ days: 0, suppressed: true }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
