import { describe, expect, it } from 'vitest';
import { rankRecommendations } from './rank';
import { BUILT_IN_RECOMMENDATION_PROVIDERS } from './providers';
import type { PersonRecommendationState, Recommendation } from './schemas';

const NOW = new Date('2026-07-16T12:00:00.000Z');

function state(over: Partial<PersonRecommendationState> = {}): PersonRecommendationState {
  return {
    capabilities: new Set(['story.own']),
    adultAcknowledged: false,
    proactivity: 'active',
    now: NOW,
    crisis: false,
    isNew: false,
    configured: true,
    openGoals: [],
    openSessions: 0,
    hasSynthesisCache: false,
    canSynthesize: false,
    portraitStale: false,
    depthInvitation: null,
    guidedSuggestionCount: 0,
    lightActivity: false,
    questionnaireGapHint: false,
    memoryStale: false,
    ...over,
  };
}

const find = (s: PersonRecommendationState, dismissed = new Set<string>()): Recommendation | null =>
  rankRecommendations([...BUILT_IN_RECOMMENDATION_PROVIDERS], s, { dismissed }).find(
    (r) => r.id === 'story-living',
  ) ?? null;

const withBook = (
  over: Partial<NonNullable<PersonRecommendationState['story']>> = {},
): PersonRecommendationState =>
  state({
    story: {
      hasBook: true,
      staleChapters: 0,
      pendingProposals: 0,
      unwrittenChapters: 0,
      signature: 's',
      ...over,
    },
  });

describe('story-living recommendation provider (64 §5.6)', () => {
  it('shows no card without a book (starting one is the nav’s job, not a push)', () => {
    expect(find(state({ story: null }))).toBeNull();
    expect(
      find(
        state({
          story: {
            hasBook: false,
            staleChapters: 0,
            pendingProposals: 0,
            unwrittenChapters: 0,
            signature: '',
          },
        }),
      ),
    ).toBeNull();
  });

  it('leads with new material to weave in (stale outranks proposals + unwritten)', () => {
    const r = find(withBook({ staleChapters: 2, pendingProposals: 1, unwrittenChapters: 3 }));
    expect(r?.label).toBe('Your story grew');
    expect(r?.reason).toMatch(/2 chapters .* new material to weave in/);
    expect(r?.route).toBe('/story');
  });

  it('falls back to structural suggestions, then chapters awaiting a draft', () => {
    expect(find(withBook({ pendingProposals: 1, unwrittenChapters: 2 }))?.label).toBe(
      'Shape your story',
    );
    expect(find(withBook({ unwrittenChapters: 2 }))?.label).toBe('Keep writing your story');
    expect(find(withBook({}))).toBeNull(); // a book with nothing pending → no card
  });

  it('is filtered without the story.own capability (no dead CTA)', () => {
    expect(find(withBook({ staleChapters: 1 }), new Set()) !== null).toBe(true);
    expect(
      find(
        state({
          capabilities: new Set(),
          story: {
            hasBook: true,
            staleChapters: 1,
            pendingProposals: 0,
            unwrittenChapters: 0,
            signature: 's',
          },
        }),
      ),
    ).toBeNull();
  });

  it('the dismissal carries the signature so only the SAME signal stays hidden', () => {
    const s = withBook({ staleChapters: 1, signature: 'sig-1' });
    expect(find(s, new Set(['rec:story-living:sig-1']))).toBeNull(); // dismissed this exact signal
    expect(find(s, new Set(['rec:story-living:sig-0']))?.label).toBe('Your story grew'); // a stale dismissal doesn't apply
  });
});
