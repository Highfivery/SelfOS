import type { ImageClient } from '@selfos/core/host';
import type { ClaudeErrorCode, ClaudeTestResult } from './channels';

/**
 * The OpenAI connection-test proxy (29-multi-device-housekeeping §5.B) — the OpenAI sibling of
 * `claudeProxy.runConnectionTest`. Verifies the resolved OpenAI key with a NON-generative models-list probe
 * (`ImageClient.verify`) so a bad key surfaces at setup, not as a failed (billed) image. Same NO_KEY / AUTH
 * / RATE_LIMIT / NETWORK / API_ERROR taxonomy as Claude; messages name OpenAI. The key is passed per call
 * and never reaches the renderer (00 §6.2).
 */

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

function mapOpenAiError(error: unknown): { ok: false; code: ClaudeErrorCode; message: string } {
  const status = statusOf(error);
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: 'AUTH',
      message: 'That OpenAI key was rejected. Check it and try again.',
    };
  }
  if (status === 429) {
    return { ok: false, code: 'RATE_LIMIT', message: 'Rate limited by OpenAI. Try again shortly.' };
  }
  if (status === undefined) {
    return { ok: false, code: 'NETWORK', message: 'Couldn’t reach OpenAI. Check your connection.' };
  }
  return { ok: false, code: 'API_ERROR', message: `OpenAI returned an error (${status}).` };
}

/** Verify the OpenAI key works (a models-list probe — never an image generation). */
export async function runOpenAiConnectionTest(
  client: ImageClient,
  apiKey: string | null,
): Promise<ClaudeTestResult> {
  if (!apiKey) {
    return { ok: false, code: 'NO_KEY', message: 'Add your OpenAI key first.' };
  }
  try {
    await client.verify(apiKey);
    return { ok: true, text: 'ok' };
  } catch (error) {
    return mapOpenAiError(error);
  }
}
