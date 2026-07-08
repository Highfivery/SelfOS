import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Insight, OutboundSharing, Relationship } from '@shared/schemas';
import { SharingSection } from './SharingSection';
import { useInsightStore } from '../../../stores/insightStore';
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

const parentInsight: Insight = {
  schemaVersion: 1,
  id: 'i1',
  source: 'session',
  subjectPersonId: 'p1',
  summary: '',
  facts: [{ id: 'f1', text: 'Likes hiking', shareable: false, shareableTypes: ['partner'] }],
  confidence: 'medium',
  categories: ['Other'],
  approved: true,
  provenance: { at: '2026-06-20T12:00:00.000Z' },
  createdAt: '2026-06-20T12:00:00.000Z',
  updatedAt: '2026-06-20T12:00:00.000Z',
};

const outbound: OutboundSharing = {
  items: [
    {
      id: 'f1',
      kind: 'fact',
      text: 'Likes hiking',
      broadcast: false,
      types: ['partner'],
      personIds: [],
      recipients: [{ id: 'p2', displayName: 'Sam' }],
    },
    {
      id: 'health.sleep',
      kind: 'intakeAnswer',
      text: 'Sleep: 6 hours',
      broadcast: false,
      types: ['sibling'],
      personIds: [],
      recipients: [],
    },
  ],
};

const rel = (over: Partial<Relationship> & { id: string }): Relationship => ({
  schemaVersion: 1,
  fromPersonId: 'p1',
  toPersonId: 'p2',
  type: 'partner',
  createdAt: 'now',
  updatedAt: 'now',
  ...over,
});

const relationships: Relationship[] = [
  rel({ id: 'r1', toPersonId: 'p2', type: 'partner' }),
  rel({ id: 'r2', toPersonId: 'p3', type: 'sibling' }),
];

function renderPanel(): void {
  render(
    <MemoryRouter>
      <SharingSection />
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useInsightStore.setState({ insights: [], outbound: { items: [] }, loaded: false });
  useSessionStore.setState({ activePerson: null });
});

describe('SharingSection (transparency surface)', () => {
  it('lists shared items with scope + recipients and re-scopes a fact via the picker', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const update = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      insightsList: () => Promise.resolve([parentInsight]),
      memoryOutboundSharing: () => Promise.resolve(outbound),
      relationshipsList: () => Promise.resolve(relationships),
      insightsUpdate: update,
    });
    renderPanel();
    expect(await screen.findByText('Likes hiking')).toBeInTheDocument();
    expect(screen.getByText('Sleep: 6 hours')).toBeInTheDocument();
    expect(screen.getByText(/Shared with Partner · reaching Sam/)).toBeInTheDocument();

    // Re-scope the fact: add Sibling.
    await userEvent.click(screen.getByRole('button', { name: /Likes hiking/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sibling' }));
    expect(update).toHaveBeenCalledWith({
      subjectPersonId: 'p1',
      id: 'i1',
      facts: [
        {
          id: 'f1',
          text: 'Likes hiking',
          shareable: false,
          shareableTypes: ['partner', 'sibling'],
        },
      ],
    });
  });

  it('changes an intake answer’s scope via intakeSetAnswerSharing (parsed section.question id)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const setAnswer = vi.fn(() => Promise.resolve(true));
    installMockBridge({
      insightsList: () => Promise.resolve([parentInsight]),
      memoryOutboundSharing: () => Promise.resolve(outbound),
      relationshipsList: () => Promise.resolve(relationships),
      intakeSetAnswerSharing: setAnswer,
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /Sleep: 6 hours/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Partner' }));
    expect(setAnswer).toHaveBeenCalledWith({
      sectionId: 'health',
      questionId: 'sleep',
      types: ['partner', 'sibling'],
    });
  });

  it('shows the nothing-shared empty state', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () => Promise.resolve([]),
      memoryOutboundSharing: () => Promise.resolve({ items: [] }),
    });
    renderPanel();
    expect(await screen.findByText(/not sharing anything yet/)).toBeInTheDocument();
  });
});
