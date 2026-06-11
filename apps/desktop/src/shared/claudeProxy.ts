import type { ClaudeClient } from '@selfos/core/host';
import type { ClaudeErrorCode, ClaudeTestResult } from './channels';

/**
 * The Claude proxy boundary (00-architecture §6.2) — platform-agnostic proxy helpers (error mapping +
 * the connection test) over an injected `ClaudeClient`, unit-testable without network or a key. Lives in
 * `shared` (not `main`) so the shared `createCoreBridge` factory — bundled into both the Electron main
 * process and the iOS WebView (07-mobile-platform §5.3) — can run the connection test on either host. The
 * API key is passed per call and never reaches the renderer.
 */

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

export function mapError(error: unknown): { ok: false; code: ClaudeErrorCode; message: string } {
  const status = statusOf(error);
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: 'AUTH',
      message: 'That API key was rejected. Check it and try again.',
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: 'RATE_LIMIT',
      message: 'Rate limited by Anthropic. Try again shortly.',
    };
  }
  if (status === undefined) {
    return {
      ok: false,
      code: 'NETWORK',
      message: 'Couldn’t reach Anthropic. Check your connection.',
    };
  }
  return { ok: false, code: 'API_ERROR', message: `Anthropic returned an error (${status}).` };
}

/** Send a tiny request to confirm the key + model work end-to-end. */
export async function runConnectionTest(
  client: ClaudeClient,
  apiKey: string | null,
  model: string,
): Promise<ClaudeTestResult> {
  if (!apiKey) {
    return { ok: false, code: 'NO_KEY', message: 'Add your Claude API key first.' };
  }
  try {
    const text = await client.send({
      apiKey,
      model,
      messages: [{ role: 'user', content: 'Reply with just the word: ok' }],
      maxTokens: 16,
    });
    return { ok: true, text };
  } catch (error) {
    return mapError(error);
  }
}
