import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookShelfEntry } from '@shared/schemas';
import { useStoryStore } from '../../../stores/storyStore';
import { Bookshelf } from './Bookshelf';

/** The shelf (72 §3.1) — the front door that replaced "open the first book on arrival". */

function entry(over: Partial<BookShelfEntry> = {}): BookShelfEntry {
  return {
    id: 'b1',
    type: 'biography',
    title: 'Still Running',
    status: 'ready',
    lifecycle: 'living',
    editions: 0,
    written: 23,
    total: 45,
    words: 50006,
    unit: { one: 'chapter', many: 'chapters' },
    updatedAt: '2026-08-14T00:00:00.000Z',
    ...over,
  };
}

function renderShelf(shelf: BookShelfEntry[], onOpen = vi.fn()): { onOpen: typeof onOpen } {
  useStoryStore.setState({
    shelf,
    bookTypes: [
      {
        id: 'biography',
        label: 'Biography',
        blurb: '',
        truthMode: 'true',
        summary: { drawsOn: '', shape: '', asksAbout: '' },
        gates: { adult: false },
        options: [],
        structures: [],
        stylePresets: [],
      },
    ],
  });
  render(<Bookshelf onOpen={onOpen} onNew={vi.fn()} resolveCover={() => Promise.resolve(null)} />);
  return { onOpen };
}

afterEach(() => useStoryStore.getState().reset());

describe('Bookshelf (72 §3.1)', () => {
  it('shows every book with its progress in that book’s own unit', () => {
    renderShelf([entry(), entry({ id: 'b2', title: 'The Long Year', written: 5, total: 8 })]);

    // The title is on the cover as art AND below as text, so assert the name the card actually exposes.
    expect(screen.getByRole('button', { name: 'Open Still Running' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open The Long Year' })).toBeInTheDocument();
    expect(screen.getByText('23 of 45 chapters written')).toBeInTheDocument();
    expect(screen.getByText('5 of 8 chapters written')).toBeInTheDocument();
    // Not a bare percentage — the unit is what makes the number mean something.
    expect(screen.queryByText('51%')).not.toBeInTheDocument();
  });

  it('names the state: a living book is Living, a finished one says which edition', () => {
    renderShelf([
      entry(),
      entry({
        id: 'b2',
        title: 'Second',
        lifecycle: 'finished',
        editions: 2,
        finishedAt: '2026-08-01T00:00:00.000Z',
      }),
    ]);

    expect(screen.getByText('Living')).toBeInTheDocument();
    expect(screen.getByText(/Edition 2/)).toBeInTheDocument();
  });

  it('opens the book you click — by a name that says what clicking does', async () => {
    const { onOpen } = renderShelf([entry(), entry({ id: 'b2', title: 'The Long Year' })]);

    await userEvent.click(screen.getByRole('button', { name: 'Open The Long Year' }));

    expect(onOpen).toHaveBeenCalledWith('b2');
  });

  it('a single book still shows the shelf — nothing opens itself (the pre-72 assumption)', () => {
    const { onOpen } = renderShelf([entry()]);

    expect(screen.getByRole('button', { name: 'Open Still Running' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
