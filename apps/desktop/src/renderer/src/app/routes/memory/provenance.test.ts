import { describe, expect, it } from 'vitest';
import type { Insight } from '@shared/schemas';
import { provenanceTarget } from './provenance';

function insight(over: Partial<Insight>): Insight {
  return {
    id: 'i1',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: 's',
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-06-12T00:00:00.000Z' },
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    ...over,
  };
}

describe('provenanceTarget', () => {
  it('deep-links a session to /sessions with the conversation id', () => {
    const t = provenanceTarget(
      insight({ source: 'session', provenance: { conversationId: 'c1', at: 'now' } }),
    );
    expect(t).toMatchObject({ label: 'From a session', to: '/sessions' });
    expect(t.state).toEqual({ focusConversationId: 'c1' });
    expect(t.source).toEqual({ kind: 'session', id: 'c1' });
  });

  it('deep-links a dream to /dreams with the dream id', () => {
    const t = provenanceTarget(
      insight({ source: 'dream', provenance: { dreamId: 'd1', at: 'now' } }),
    );
    expect(t).toMatchObject({ label: 'From a dream', to: '/dreams' });
    expect(t.state).toEqual({ focusDreamId: 'd1' });
  });

  it('routes intake to /onboarding and questionnaire to /questionnaires (no deep-link state)', () => {
    expect(provenanceTarget(insight({ source: 'intake' }))).toMatchObject({
      label: 'From onboarding',
      to: '/onboarding',
      source: { kind: 'other' },
    });
    const q = provenanceTarget(
      insight({ source: 'questionnaire', provenance: { assignmentId: 'a1', at: 'now' } }),
    );
    expect(q).toMatchObject({ to: '/questionnaires', source: { kind: 'other' } });
    expect(q.state).toBeUndefined();
  });

  it('names how many moments a merged insight folds in', () => {
    const t = provenanceTarget(
      insight({
        source: 'session',
        provenance: { conversationId: 'c1', at: 'now' },
        contributingSources: [{ at: 'x' }, { at: 'y' }],
      }),
    );
    expect(t.label).toBe('From 3 moments');
  });
});
