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

/**
 * The instruction that carries a truncated reply forward.
 *
 * This is NOT assistant prefill. Prefill (ending the conversation on an assistant turn) is the
 * obvious way to continue a reply and it is what this shipped with — but the current models reject
 * it outright: `This model does not support assistant message prefill. The conversation must end
 * with a user message.` The offline fake accepted the prefill shape happily, so every test passed
 * while the live path 400'd. Caught only by running against the real API.
 *
 * So a continuation sends the partial as an assistant turn and then THIS as a final user turn, which
 * satisfies the constraint. The wording matters: without "do not repeat" the model tends to restart
 * the reply, and without "no preamble" it prefixes something like "Continuing:" mid-sentence.
 */
export const CONTINUATION_INSTRUCTION =
  'Continue your previous message from exactly where it stopped. Do not repeat any of it, do not ' +
  'restate the question, and do not add any preamble — just carry straight on.';

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
    // reply as an assistant turn AND a final user turn asking it to carry on (the models reject a
    // conversation ending on an assistant turn — see CONTINUATION_INSTRUCTION).
    //
    // `trimEnd` matters on what we SEND — `text` keeps its trailing whitespace, so the continuation
    // appends onto it without swallowing a space at the seam.
    const isContinuation = text !== '';
    const messages = isContinuation
      ? [
          ...options.messages,
          { role: 'assistant' as const, content: text.trimEnd() },
          { role: 'user' as const, content: CONTINUATION_INSTRUCTION },
        ]
      : options.messages;

    let result: ClaudeStreamResult;
    try {
      result = await client.stream(
        {
          ...options,
          messages,
          // The continuation should spend its whole budget on visible output rather than sharing it
          // with thinking, which is what starved the reply to begin with
          // ([[adaptive-thinking-shares-maxtokens]]).
          ...(isContinuation ? { extendedThinking: false } : {}),
        },
        onDelta,
      );
    } catch (error) {
      // A FIRST-call failure is the caller's to handle (it has no reply to salvage), so rethrow. A
      // CONTINUATION failure must never destroy the text we already have: keep the partial and stop.
      // "A short reply beats a lost one" — and without this, a transport blip or an unsupported
      // continuation shape turns a usable truncated reply into a hard error, which is strictly worse
      // than the bug this whole helper exists to fix.
      if (!isContinuation) throw error;
      // The counter was bumped before this attempt; it contributed no text, so don't report it.
      continuations -= 1;
      break;
    }
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
