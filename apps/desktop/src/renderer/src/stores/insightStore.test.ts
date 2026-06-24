import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Insight } from '@shared/schemas';
import { useInsightStore } from './insightStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

const insight: Insight = {
  schemaVersion: 1,
  id: 'i1',
  source: 'session',
  subjectPersonId: 'p1',
  summary: 's',
  facts: [
    { id: 'f1', text: 'first', shareable: false },
    { id: 'f2', text: 'second', shareable: false, restricted: true },
  ],
  confidence: 'medium',
  categories: ['Other'],
  approved: true,
  provenance: { at: '2026-06-20T12:00:00.000Z' },
  createdAt: '2026-06-20T12:00:00.000Z',
  updatedAt: '2026-06-20T12:00:00.000Z',
};

afterEach(() => {
  clearMockBridge();
  useInsightStore.setState({ insights: [], outbound: { items: [] }, loaded: false });
});

describe('insightStore.setFactScope', () => {
  it('rebuilds the FULL facts array (changed one scoped, the rest minimal) so siblings are never dropped', async () => {
    const update = vi.fn(() => Promise.resolve(null));
    installMockBridge({ insightsUpdate: update, insightsList: () => Promise.resolve([insight]) });
    // Seed the store as a mounted dashboard would (load pulls the parent insight).
    useInsightStore.setState({ insights: [insight], loaded: true });

    await useInsightStore.getState().setFactScope({
      subjectPersonId: 'p1',
      insightId: 'i1',
      fact: { id: 'f1', text: 'first', shareable: false, shareableTypes: ['partner'] },
    });

    // `updateInsight` REPLACES facts with the patch, so BOTH facts must be sent: the changed one carrying the
    // new scope, the sibling minimal (its stored `restricted` is preserved server-side by merge-by-id).
    expect(update).toHaveBeenCalledWith({
      subjectPersonId: 'p1',
      id: 'i1',
      facts: [
        { id: 'f1', text: 'first', shareable: false, shareableTypes: ['partner'] },
        { id: 'f2', text: 'second', shareable: false },
      ],
    });
  });
});
