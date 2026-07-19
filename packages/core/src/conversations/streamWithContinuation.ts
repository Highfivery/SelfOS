import type {
  ClaudeClient,
  ClaudeStreamOptions,
  ClaudeStreamResult,
  ClaudeUsage,
} from '../host/claudeClient';

/**
 * Truncation-safe streaming (66 §5.1) — the single place every chat surface gets cut-off recovery.
 *
 * A coaching reply that hits `max_tokens` stops mid-sentence. Before 66 that was undetectable (the
 * transport discarded `stop_reason`), so the half-finished text was persisted as if the model had
 * chosen to stop — the reported "the AI just stops" bug. Here we detect it and CONTINUE the reply by
 * re-calling with the partial appended as an assistant message (assistant-prefill continuation), then
 * concatenating. `onDelta` passes straight through, so the renderer sees one uninterrupted reply with
 * no seam, no button, and no banner (§3.1).
 *
 * Deliberately bounded and gated: a runaway reply must not chain calls forever or spend past a
 * budget the person has already hit. When we can't continue we keep the partial rather than discard
 * it — a short reply beats a lost one.
 */

/**
 * At most this many CONTINUATION calls per turn (so ≤ 3 calls total). A reply needing more than this
 * is pathological; stopping keeps a bad turn from quietly costing several turns' worth of budget.
 */
export const MAX_CONTINUATIONS = 2;

export interface ContinuationOptions {
  /** Override the continuation cap (tests). Defaults to `MAX_CONTINUATIONS`. */
  maxContinuations?: number;
  /**
   * Re-checked before EVERY continuation — a continuation is a fresh billed call, so a budget that
   * was fine when the turn started may not be by the time we'd continue. Returning false keeps the
   * partial and stops cleanly (never an error).
   */
  canContinue?: () => boolean | Promise<boolean>;
}

/** The stitched reply, plus how many continuations it took (0 ⇒ the model finished on its own). */
export interface ContinuedStreamResult extends ClaudeStreamResult {
  continuations: number;
}

const EMPTY_USAGE: ClaudeUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

function addUsage(a: ClaudeUsage, b: ClaudeUsage): ClaudeUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

/**
 * Stream a reply, transparently continuing it if the model runs out of room.
 *
 * Usage is SUMMED across every call, so a caller that records one `UsageEvent` from the result meters
 * the turn's full billed cost with no change on its side — the whole point of putting this here
 * rather than in each of the five services.
 */
export async function streamWithContinuation(
  client: ClaudeClient,
  options: ClaudeStreamOptions,
  onDelta: (text: string) => void,
  opts: ContinuationOptions = {},
): Promise<ContinuedStreamResult> {
  const cap = opts.maxContinuations ?? MAX_CONTINUATIONS;

  let text = '';
  let usage = EMPTY_USAGE;
  let continuations = 0;
  let stopReason: ClaudeStreamResult['stopReason'];

  for (;;) {
    // The first pass sends the caller's messages; each continuation re-sends them plus the partial
    // reply so far as an assistant turn, which the model then carries on from.
    //
    // `trimEnd` matters: the API rejects a final assistant message ending in whitespace. We trim only
    // what we SEND — `text` keeps its trailing whitespace, so the continuation appends onto it
    // without swallowing a space at the seam.
    const isContinuation = text !== '';
    const messages = isContinuation
      ? [...options.messages, { role: 'assistant' as const, content: text.trimEnd() }]
      : options.messages;

    const result = await client.stream(
      {
        ...options,
        messages,
        // Extended thinking is incompatible with assistant prefill, so a continuation MUST disable it.
        // It's also what we want independently: the continuation should spend its whole budget on
        // visible output rather than sharing it with thinking, which is what starved the reply to
        // begin with ([[adaptive-thinking-shares-maxtokens]]).
        ...(isContinuation ? { extendedThinking: false } : {}),
      },
      onDelta,
    );
    text += result.text;
    usage = addUsage(usage, result.usage);
    stopReason = result.stopReason;

    if (result.stopReason !== 'max_tokens') break;
    if (continuations >= cap) break;
    // An empty continuation means the model has nothing more to add; continuing would spend for
    // nothing and could spin until the cap.
    if (continuations > 0 && result.text === '') break;
    if (opts.canContinue && !(await opts.canContinue())) break;

    continuations += 1;
  }

  return { text, usage, continuations, ...(stopReason ? { stopReason } : {}) };
}
