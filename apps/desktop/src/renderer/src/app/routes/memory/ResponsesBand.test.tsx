import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Insight } from '@shared/schemas';
import { ResponsesBand, type RecipientGroup } from './ResponsesBand';

function ins(id: string, at: string): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: 'p1',
    summary: `s-${id}`,
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at },
    createdAt: at,
    updatedAt: at,
  };
}

const groups: RecipientGroup[] = [
  {
    key: 'angel',
    name: 'Angel',
    insights: [ins('a1', '2026-07-10T12:00:00.000Z'), ins('a2', '2026-07-16T12:00:00.000Z')],
  },
  { key: 'sam', name: 'Sam', insights: [ins('s1', '2026-07-11T12:00:00.000Z')] },
];

describe('ResponsesBand (65 §3.6)', () => {
  it('renders a compact recipient card per group (count + last date), collapsed by default', () => {
    render(
      <ResponsesBand
        groups={groups}
        openKeys={new Set()}
        onOpenChange={() => {}}
        renderCards={(items) => <div data-testid="grid">{items.length}</div>}
      />,
    );
    expect(screen.getByText('From questionnaires you sent')).toBeInTheDocument();
    expect(screen.getByText('Angel')).toBeInTheDocument();
    expect(screen.getByText(/2 insights · last/)).toBeInTheDocument();
    expect(screen.getByText(/1 insight · last/)).toBeInTheDocument();
    // Collapsed → no expanded card grid rendered.
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument();
  });

  it('toggles a recipient on click, and shows their cards full-width when controlled open', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ResponsesBand
        groups={groups}
        openKeys={new Set()}
        onOpenChange={onOpenChange}
        renderCards={(items) => <div data-testid="grid">{items.length} cards</div>}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Angel/ }));
    expect(onOpenChange).toHaveBeenCalledWith('angel', true);

    rerender(
      <ResponsesBand
        groups={groups}
        openKeys={new Set(['angel'])}
        onOpenChange={onOpenChange}
        renderCards={(items) => <div data-testid="grid">{items.length} cards</div>}
      />,
    );
    expect(screen.getByText(/From Angel.s answers/)).toBeInTheDocument();
    expect(screen.getByTestId('grid')).toHaveTextContent('2 cards');
  });
});
