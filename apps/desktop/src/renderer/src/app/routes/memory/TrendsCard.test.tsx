import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Insight } from '@shared/schemas';
import { TrendsCard } from './TrendsCard';

const NOW = Date.now();
function insight(id: string, offsetDays: number, metrics: Record<string, number>): Insight {
  const at = new Date(NOW - offsetDays * 86400000).toISOString();
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: '',
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at },
    createdAt: at,
    updatedAt: at,
    metrics,
  };
}

const insights = [
  insight('a', 2, { moodValence: 0.1, moodEnergy: 0.3, emotionalIntensity: 0.5 }),
  insight('b', 1, { moodValence: 0.3, moodEnergy: 0.32, emotionalIntensity: 0.6 }),
];

describe('TrendsCard (65 §3.5)', () => {
  it('defaults the chart to Mood + Energy and humanizes every label (no camelCase machine names)', () => {
    render(<TrendsCard insights={insights} personId="p1" />);
    // The text read charts Mood + Energy by default (humanized).
    expect(screen.getByText(/Mood (rising|steady|dipping)/)).toBeInTheDocument();
    expect(screen.getByText(/Energy (rising|steady|dipping)/)).toBeInTheDocument();
    // The third series is offered by the picker but NOT charted by default, and reads humanized.
    const chip = screen.getByRole('button', { name: 'Emotional intensity' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/emotionalIntensity/)).not.toBeInTheDocument();
  });

  it('adds a series to the chart when its picker chip is toggled on', async () => {
    const user = userEvent.setup();
    render(<TrendsCard insights={insights} personId="p1" />);
    const chip = screen.getByRole('button', { name: 'Emotional intensity' });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Emotional intensity (rising|steady|dipping)/)).toBeInTheDocument();
  });
});
