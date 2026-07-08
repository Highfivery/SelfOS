import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Insight, InsightFact } from '@shared/schemas';
import { WrapUpCard } from './WrapUpCard';

function fact(id: string, text: string): InsightFact {
  return { id, text, shareable: false };
}

function insightWith(facts: InsightFact[]): Insight {
  return {
    id: 'i1',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: 'A grounded close to a hard conversation.',
    facts,
    metrics: { moodValence: 0, moodEnergy: 0.1 },
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-07-08T00:00:00.000Z' },
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
  };
}

function renderCard(facts: InsightFact[]): void {
  render(
    <MemoryRouter>
      <WrapUpCard insight={insightWith(facts)} onDismiss={() => {}} />
    </MemoryRouter>,
  );
}

describe('WrapUpCard (grouped, condensed)', () => {
  it('renders facts as labelled sections, not one flat list', () => {
    renderCard([
      fact('g1', 'Goal: Send Angel an honest text'),
      fact('t1', 'Theme: emotional withdrawal'),
      fact('p1', 'Person mentioned: Angel'),
    ]);
    expect(screen.getByText('Goals & commitments')).toBeInTheDocument();
    expect(screen.getByText('Themes')).toBeInTheDocument();
    expect(screen.getByText('People mentioned')).toBeInTheDocument();
    // The prefix is stripped in the display text.
    expect(screen.getByText('Send Angel an honest text')).toBeInTheDocument();
    expect(screen.queryByText(/^Goal: /)).not.toBeInTheDocument();
  });

  it('condenses themes beyond the preview behind a "+N more" that reveals the rest', async () => {
    const themes = Array.from({ length: 9 }, (_, i) => fact(`t${i}`, `Theme: theme ${i}`));
    renderCard(themes);
    // 6 shown, 3 hidden behind the chip.
    expect(screen.getByText('theme 0')).toBeInTheDocument();
    expect(screen.queryByText('theme 8')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+3 more' }));
    expect(screen.getByText('theme 8')).toBeInTheDocument();
    // The reveal is a two-way toggle — "Show fewer" collapses it back.
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.queryByText('theme 8')).not.toBeInTheDocument();
  });

  it('collapses follow-ups by default and expands them on click', async () => {
    renderCard([
      fact('f1', 'Follow-up: How did Angel respond?'),
      fact('f2', 'Follow-up: Did you book therapy?'),
    ]);
    const toggle = screen.getByRole('button', { name: /Follow-ups for next time/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('How did Angel respond?')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('How did Angel respond?')).toBeInTheDocument();
  });

  it('keeps an unrecognized fact visible under "Also noted" (never dropped)', () => {
    renderCard([fact('x1', 'Exercise: Thought Record (CBT)')]);
    expect(screen.getByText('Also noted')).toBeInTheDocument();
    expect(screen.getByText('Exercise: Thought Record (CBT)')).toBeInTheDocument();
  });

  it('omits a section that has no facts', () => {
    renderCard([fact('g1', 'Goal: one clear next step')]);
    expect(screen.getByText('Goals & commitments')).toBeInTheDocument();
    expect(screen.queryByText('Themes')).not.toBeInTheDocument();
    expect(screen.queryByText('People mentioned')).not.toBeInTheDocument();
    expect(screen.queryByText(/Follow-ups/)).not.toBeInTheDocument();
  });

  it('leads with crisis resources when the analysis flagged a concern', () => {
    const insight = { ...insightWith([fact('t1', 'Theme: heaviness')]), crisisFlag: true };
    render(
      <MemoryRouter>
        <WrapUpCard insight={insight} onDismiss={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/988/)).toBeInTheDocument();
  });
});
