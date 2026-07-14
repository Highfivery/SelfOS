import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OutboundSharing } from '@shared/schemas';
import { SharingCard } from './SharingCard';

const item = (id: string, names: string[]): OutboundSharing['items'][number] => ({
  id,
  kind: 'fact',
  text: 'a fact',
  broadcast: false,
  types: [],
  personIds: names.map((n) => `p-${n}`),
  recipients: names.map((n) => ({ id: `p-${n}`, displayName: n })),
});

function renderCard(outbound: OutboundSharing): void {
  render(
    <MemoryRouter>
      <SharingCard outbound={outbound} />
    </MemoryRouter>,
  );
}

describe('SharingCard', () => {
  it('summarizes what you share and tallies recipients', () => {
    renderCard({
      items: [item('a', ['Angel', 'Mom']), item('b', ['Angel']), item('c', ['Angel'])],
    });
    expect(screen.getByText(/3 things/i)).toBeInTheDocument();
    // Angel receives 3 items, Mom 1.
    expect(screen.getByText('Angel')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Mom')).toBeInTheDocument();
  });

  it('self-hides when nothing is shared', () => {
    const { container } = render(
      <MemoryRouter>
        <SharingCard outbound={{ items: [] }} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
