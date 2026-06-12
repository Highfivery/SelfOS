/**
 * Maintained per-model pricing (06-ai-usage-and-budgets §4.3), USD per 1M tokens. Cache write = 1.25×
 * input (5-minute ephemeral); cache read = 0.1× input. All displayed cost is an **estimate** — the
 * source of truth is the user's Anthropic bill. Update this table when prices change.
 */
export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

// Conservative fallback for an unrecognized model (so cost is never under-reported).
const FALLBACK: ModelPricing = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };

export function pricingFor(model: string): ModelPricing {
  return PRICING[model] ?? FALLBACK;
}

/**
 * Image-generation pricing (13-dream-images §4.5) — a **flat** USD cost per image, since an image call has
 * no meaningful token counts. Seeded at the high-quality 1024² estimate; all cost is an estimate (the
 * source of truth is the user's OpenAI bill). `dream.image` events carry zero tokens + this flat cost.
 */
export interface ImagePricing {
  perImageUsd: number;
}

export const IMAGE_PRICING: Record<string, ImagePricing> = {
  'gpt-image-2': { perImageUsd: 0.17 },
  'gpt-image-1': { perImageUsd: 0.17 },
};

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/** Estimated USD cost for a single call's token counts. */
export function costOf(model: string, tokens: TokenCounts): number {
  // Image models charge a flat per-image price (their events carry zero tokens, so the token formula
  // below would yield $0); the flat cost is the source of truth for a `dream.image` event (§4.5).
  const image = IMAGE_PRICING[model];
  if (image) return image.perImageUsd;
  const p = pricingFor(model);
  return (
    (tokens.inputTokens * p.input +
      tokens.outputTokens * p.output +
      tokens.cacheWriteTokens * p.cacheWrite +
      tokens.cacheReadTokens * p.cacheRead) /
    1_000_000
  );
}

/** USD saved by reading the cached prefix instead of paying full input price. */
export function cacheSavingsOf(model: string, cacheReadTokens: number): number {
  const p = pricingFor(model);
  return (cacheReadTokens * (p.input - p.cacheRead)) / 1_000_000;
}
