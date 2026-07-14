import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NeedsAttentionCard } from './NeedsAttentionCard';
import type { AttentionItem } from './attention';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function renderCard(items: AttentionItem[]): void {
  render(
    <MemoryRouter>
      <NeedsAttentionCard items={items} />
    </MemoryRouter>,
  );
}

describe('NeedsAttentionCard (60 §3.1.2a)', () => {
  it('lists the queue with labels, details, and a count; a row routes to its action', () => {
    navigate.mockClear();
    renderCard([
      {
        kind: 'together-turn',
        label: 'It’s your turn with Angel',
        detail: 'Continue your Together session',
        route: '/together',
      },
      {
        kind: 'analyze-responses',
        label: '2 responses to turn into insight',
        detail: 'Analyze to see what it means',
        route: '/questionnaires',
        count: 2,
      },
    ]);
    expect(screen.getByRole('heading', { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // the count badge
    expect(screen.getByText('It’s your turn with Angel')).toBeInTheDocument();
    expect(screen.getByText('2 responses to turn into insight')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /your turn with Angel/i }));
    expect(navigate).toHaveBeenCalledWith('/together', undefined);
  });

  it('passes router state when an item carries it (deep-links into a flow)', () => {
    navigate.mockClear();
    renderCard([
      {
        kind: 'send-questionnaire',
        label: 'Ask someone what they think',
        detail: 'It’s been a while',
        route: '/questionnaires',
        state: { startNew: true },
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /ask someone what they think/i }));
    expect(navigate).toHaveBeenCalledWith('/questionnaires', { state: { startNew: true } });
  });

  it('self-hides when the queue is clear', () => {
    const { container } = render(
      <MemoryRouter>
        <NeedsAttentionCard items={[]} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
