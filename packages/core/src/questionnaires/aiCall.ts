import { streamWithContinuation } from '../conversations/streamWithContinuation';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import type { AiFailureReason, UsageEvent } from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';

/**
 * The shared budget-gated, metered one-shot Claude call (08-questionnaires §3.1/§13.3) used by every
 * questionnaire AI service (generate / improve / variant / gap-finder / analysis / alignment / the §23.5
 * semantic de-dup pass). Extracted here so those services can share it without importing each other (the
 * `generationService` ↔ `semanticDedup` cycle). `generationService` re-exports these for back-compat.
 */

export interface AiDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  now: Date;
  override?: boolean;
}

export type ClaudeCallResult =
  | {
      ok: true;
      text: string;
      usage: UsageEvent;
      /** True when the reply STILL ended at `max_tokens` after the bounded continuations — the text may be
       *  cut off mid-thought. Callers producing a persisted artifact (a story chapter) must treat this as an
       *  honest TRUNCATED failure rather than saving a half-finished result; JSON callers may still salvage
       *  (spec 37's tolerant parsing handles a truncated tail). */
      truncated?: boolean;
    }
  | { ok: false; reason: AiFailureReason; message: string };

/** Shared budget-gated, metered one-shot Claude call (used by generate / improve / gap-finder / de-dup). */
export async function runClaude(
  deps: AiDeps,
  system: string,
  userText: string,
  type: string,
  maxTokens: number,
): Promise<ClaudeCallResult> {
  const { fs, key, apiKey, model, personId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const person = await checkBudget(fs, key, {
    scope: 'person',
    personId,
    now,
    override: deps.override,
  });
  const app = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (person.state === 'over' || app.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  let streamed;
  try {
    // Truncation-safe (66 §5.1, extended to every one-shot pass): a reply that hits `max_tokens` is
    // transparently CONTINUED (bounded, budget-re-checked per continuation) instead of being silently cut
    // off — story chapters are the app's longest single generations and were the last surface without this.
    // Usage is summed across the calls, so the single `UsageEvent` below still meters the true billed cost.
    streamed = await streamWithContinuation(
      deps.client,
      {
        apiKey,
        model,
        system,
        messages: [{ role: 'user', content: userText }],
        maxTokens,
        // These are bounded structured calls — disable adaptive thinking so it can't consume the whole
        // token budget and truncate the output to empty (the intimacy-generation bug, 08 §17.9). Verified
        // live: sonnet + adaptive thinking + 1500 tokens → stop_reason `max_tokens`, empty output → "No
        // usable questions"; with thinking off the full budget goes to the output.
        extendedThinking: false,
      },
      () => {},
      {
        // A continuation is a fresh billed call — a budget that was fine when the pass started may not be
        // by the time we'd continue. Keep the partial and stop cleanly rather than overspend.
        canContinue: async () => {
          const p = await checkBudget(fs, key, {
            scope: 'person',
            personId,
            now,
            override: deps.override,
          });
          const a = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
          return p.state !== 'over' && a.state !== 'over';
        },
      },
    );
  } catch {
    return { ok: false, reason: 'ERROR', message: 'Generation failed. Please try again.' };
  }

  const usage: UsageEvent = {
    id: uuid(),
    schemaVersion: 1,
    type,
    personId,
    model,
    at: now.toISOString(),
    inputTokens: streamed.usage.inputTokens,
    outputTokens: streamed.usage.outputTokens,
    cacheWriteTokens: streamed.usage.cacheWriteTokens,
    cacheReadTokens: streamed.usage.cacheReadTokens,
    costUsd: costOf(model, streamed.usage),
  };
  await recordUsage(fs, key, usage);
  return {
    ok: true,
    text: streamed.text,
    usage,
    // Still cut off even after the bounded continuations (or the budget stopped them) — let the caller
    // decide whether a partial result is usable (JSON salvage) or must be refused (a persisted chapter).
    ...(streamed.stopReason === 'max_tokens' ? { truncated: true } : {}),
  };
}
