import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { DreamPatternStats } from '@shared/schemas';
import { DreamInsightStrip } from './DreamInsightStrip';

function stats(overrides: Partial<DreamPatternStats>): DreamPatternStats {
  return {
    window: '30d',
    dreamCount: 4,
    analyzedCount: 2,
    symbols: [],
    themes: [],
    people: [],
    emotions: [],
    lucidCount: 0,
    nightmareCount: 0,
    moodTrend: [],
    vividnessTrend: [],
    nightmareNudge: false,
    ...overrides,
  };
}

function renderStrip(value: DreamPatternStats | null): void {
  render(
    <MemoryRouter initialEntries={['/dreams']}>
      <Routes>
        <Route path="/dreams" element={<DreamInsightStrip stats={value} />} />
        <Route path="/dreams/patterns" element={<div>Patterns screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DreamInsightStrip', () => {
  it('renders the theme, counts, and a mood cue, and links to patterns', async () => {
    renderStrip(
      stats({
        themes: [{ label: 'water', count: 3 }],
        lucidCount: 2,
        nightmareCount: 1,
        moodTrend: [
          { date: '2026-07-01', value: -0.6 },
          { date: '2026-07-02', value: -0.5 },
          { date: '2026-07-03', value: 0.4 },
          { date: '2026-07-04', value: 0.6 },
        ],
      }),
    );
    expect(screen.getByText('water')).toBeInTheDocument();
    expect(screen.getByText('2 lucid')).toBeInTheDocument();
    expect(screen.getByText('1 nightmare')).toBeInTheDocument(); // singular
    expect(screen.getByText(/brighter lately/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /see patterns/i }));
    expect(await screen.findByText('Patterns screen')).toBeInTheDocument();
  });

  it('hides entirely when there is nothing to say (null / too few dreams / no items)', () => {
    const { unmount: u1 } = render(
      <MemoryRouter>
        <DreamInsightStrip stats={null} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /see patterns/i })).not.toBeInTheDocument();
    u1();

    const { unmount: u2 } = render(
      <MemoryRouter>
        <DreamInsightStrip stats={stats({ dreamCount: 1, lucidCount: 1 })} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /see patterns/i })).not.toBeInTheDocument();
    u2();

    // Enough dreams, but no theme / counts / mood → still nothing worth showing.
    render(
      <MemoryRouter>
        <DreamInsightStrip stats={stats({ dreamCount: 3 })} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /see patterns/i })).not.toBeInTheDocument();
  });

  it('pluralizes nightmares', () => {
    renderStrip(stats({ nightmareCount: 3 }));
    expect(screen.getByText('3 nightmares')).toBeInTheDocument();
  });
});
