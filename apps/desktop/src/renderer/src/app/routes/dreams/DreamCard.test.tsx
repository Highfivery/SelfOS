import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dream } from '@shared/channels';
import { DreamCard } from './DreamCard';

const base: Dream = {
  id: 'd1',
  schemaVersion: 1,
  personId: 'owner-1',
  title: 'Motel Fight with Dad',
  narrative: 'A tense night in a roadside motel, doors that would not lock.',
  lucid: false,
  nightmare: true,
  tags: [],
  people: [],
  sensitivity: 'standard',
  status: 'analyzed',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: 'now',
};

describe('DreamCard', () => {
  it('renders a fallback card (no image): the title + date, opens on click', async () => {
    const onOpen = vi.fn();
    render(<DreamCard dream={base} onOpen={onOpen} />);
    const btn = screen.getByRole('button', { name: /Motel Fight with Dad/ });
    // The accessible name carries the title, date, and status (badges have a text equivalent).
    expect(btn.getAttribute('aria-label')).toContain('2026-07-01');
    expect(btn.getAttribute('aria-label')).toContain('nightmare');
    expect(btn.getAttribute('aria-label')).toContain('analyzed');
    // The title shows; a titled dream does NOT spill its narrative onto the card (kept clean).
    expect(screen.getByText('Motel Fight with Dad')).toBeInTheDocument();
    expect(screen.queryByText(/tense night in a roadside motel/i)).not.toBeInTheDocument();
    await userEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('uses the generated image when present (as the card background)', () => {
    render(<DreamCard dream={base} imageUrl="data:image/png;base64,ABC" onOpen={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /Motel Fight/ });
    expect(btn.getAttribute('style')).toContain('data:image/png;base64,ABC');
    expect(screen.queryByText(/tense night in a roadside motel/i)).not.toBeInTheDocument();
  });

  it('uses the narrative as the title for an untitled dream (and shows no duplicate snippet)', () => {
    const untitled: Dream = { ...base, nightmare: false, status: 'captured' };
    delete (untitled as { title?: string }).title;
    render(<DreamCard dream={untitled} onOpen={vi.fn()} />);
    // The narrative becomes the visible title; there's no separate snippet to duplicate it.
    expect(screen.getByText(/tense night in a roadside motel/i)).toBeInTheDocument();
    expect(screen.getAllByText(/tense night in a roadside motel/i)).toHaveLength(1);
  });
});
