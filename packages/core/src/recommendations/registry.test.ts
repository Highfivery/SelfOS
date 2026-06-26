import { afterEach, describe, expect, it } from 'vitest';
import {
  listRecommendationProviders,
  registerRecommendationProvider,
  resetRecommendationProviders,
} from './registry';
import type { RecommendationProvider } from './schemas';

afterEach(() => resetRecommendationProviders());

const stub: RecommendationProvider = {
  id: 'stub',
  domain: 'session',
  relevance: () => null,
};

describe('recommendation registry', () => {
  it('ships the Slice-A built-ins by default', () => {
    const ids = listRecommendationProviders().map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'continue-session',
        'stale-goal',
        'refresh-portrait',
        'depth-invitation',
        'synthesis-observation',
        'guided-suggestion',
        'questionnaire-gap',
        'refresh-memory',
      ]),
    );
  });

  it('is idempotent by id — a re-register replaces, never duplicates', () => {
    const before = listRecommendationProviders().length;
    registerRecommendationProvider(stub);
    registerRecommendationProvider({ ...stub, domain: 'memory' });
    const matches = listRecommendationProviders().filter((p) => p.id === 'stub');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.domain).toBe('memory');
    expect(listRecommendationProviders()).toHaveLength(before + 1);
  });

  it('reset restores the built-ins and drops registered extras', () => {
    registerRecommendationProvider(stub);
    resetRecommendationProviders();
    expect(listRecommendationProviders().map((p) => p.id)).not.toContain('stub');
  });
});
