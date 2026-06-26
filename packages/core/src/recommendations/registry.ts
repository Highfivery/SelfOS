import { BUILT_IN_RECOMMENDATION_PROVIDERS } from './providers';
import type { RecommendationProvider } from './schemas';

/**
 * The recommendation registry (53 §5.1/§5.5) — modelled on the context-provider registry
 * (`questionnaires/contextProviders.ts`). Each feature module REGISTERS its recommendable actions; the
 * ranking engine gathers candidates from all registered providers with no changes to Home. Adding a
 * recommendation = registering a provider, not editing the dashboard.
 */
const providers: RecommendationProvider[] = [];

/** Register a provider (idempotent by id — a re-register replaces the prior one). */
export function registerRecommendationProvider(provider: RecommendationProvider): void {
  const i = providers.findIndex((p) => p.id === provider.id);
  if (i >= 0) providers[i] = provider;
  else providers.push(provider);
}

export function listRecommendationProviders(): RecommendationProvider[] {
  return [...providers];
}

/** Register the Slice-A built-ins (continue/goal/portrait/depth/synthesis/guided/questionnaire/memory). */
export function registerBuiltInRecommendationProviders(): void {
  for (const p of BUILT_IN_RECOMMENDATION_PROVIDERS) registerRecommendationProvider(p);
}

/** Clear + restore the built-ins (for tests, and the host bootstrap). */
export function resetRecommendationProviders(): void {
  providers.length = 0;
  registerBuiltInRecommendationProviders();
}

// Register the built-ins on first import so a host that never calls reset still has them.
registerBuiltInRecommendationProviders();
