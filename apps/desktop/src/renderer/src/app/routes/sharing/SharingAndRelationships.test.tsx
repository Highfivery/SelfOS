import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Relationship } from '@shared/schemas';
import { SharingAndRelationships } from './SharingAndRelationships';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const activeP1 = {
  id: 'p1',
  schemaVersion: 1 as const,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};
const partnerP2 = { ...activeP1, id: 'p2', displayName: 'Sam' };

const partnerRel: Relationship = {
  id: 'r1',
  schemaVersion: 1,
  fromPersonId: 'p1',
  toPersonId: 'p2',
  type: 'partner',
  createdAt: 'now',
  updatedAt: 'now',
};

function renderPage(): void {
  render(
    <MemoryRouter>
      <SharingAndRelationships />
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useInsightStore.setState({ insights: [], outbound: { items: [] }, loaded: false });
  usePeopleStore.setState({ people: [], loaded: false });
  useSessionStore.setState({ activePerson: null });
});

describe('Sharing & relationships page', () => {
  it('renders both sections and generates a per-partner relationship insight (54 §3.3 relocated)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const synth = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        synthesis: {
          schemaVersion: 1,
          subjectPersonId: 'p1',
          partnerPersonId: 'p2',
          observations: ['You and Sam both value security.'],
          computedAt: '2026-06-26T12:00:00.000Z',
        },
      }),
    );
    installMockBridge({
      peopleList: () => Promise.resolve([activeP1, partnerP2]),
      relationshipsList: () => Promise.resolve([partnerRel]),
      relationshipsGetSynthesis: () => Promise.resolve(null),
      relationshipsSynthesize: synth,
      insightsList: () => Promise.resolve([]),
      memoryOutboundSharing: () => Promise.resolve({ items: [] }),
    });
    renderPage();

    // Both sections are present.
    expect(
      await screen.findByRole('heading', { name: 'Sharing & relationships' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Relationship reflections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /What you share & with whom/ })).toBeInTheDocument();

    // The partner card renders; the shared data is NEVER shown raw — only the AI observation once generated.
    expect(await screen.findByText(/You & Sam/)).toBeInTheDocument();
    expect(screen.getByText(/never shown.*as their raw answers/i)).toBeInTheDocument();
    // "Reflect on us" only appears once the card's cached-synthesis read resolves (findBy waits for it).
    await userEvent.click(await screen.findByRole('button', { name: /Reflect on us/ }));
    expect(await screen.findByText('You and Sam both value security.')).toBeInTheDocument();
    expect(synth).toHaveBeenCalledWith({ partnerPersonId: 'p2' });
  });

  it('shows the add-a-partner empty state when there are no partner relationships', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      peopleList: () => Promise.resolve([activeP1]),
      relationshipsList: () => Promise.resolve([]),
      insightsList: () => Promise.resolve([]),
      memoryOutboundSharing: () => Promise.resolve({ items: [] }),
    });
    renderPage();
    expect(
      await screen.findByText(/Add a partner in People, and relationship insights/),
    ).toBeInTheDocument();
  });
});
