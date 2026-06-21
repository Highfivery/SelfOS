import type { ImageClient, ImageGenerateOutcome } from '@selfos/core/host';
import { fromBase64 } from '@selfos/core/encoding';

/**
 * Real dream-image generation on iOS (13-dream-images §5.4): OpenAI's image API called via `fetch` from
 * inside the WKWebView, the image counterpart to `browserClaudeClient`. The OpenAI key is read from the
 * Keychain and passed per call. Mirrors the Electron `openaiImageClient` (the web preview keeps the
 * deterministic fake). Verified on-device — the real API isn't network-unit-tested.
 */
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

function isContentPolicy(payload: unknown): boolean {
  const err =
    typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload as { error?: { code?: unknown; type?: unknown; message?: unknown } }).error
      : undefined;
  const haystack = [err?.code, err?.type, err?.message]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  return (
    haystack.includes('content_policy') ||
    haystack.includes('moderation') ||
    haystack.includes('safety') ||
    haystack.includes('content policy')
  );
}

export function browserImageClient(): ImageClient {
  return {
    async verify(apiKey): Promise<void> {
      let response: Response;
      try {
        response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      } catch {
        throw new Error('network');
      }
      if (!response.ok) throw Object.assign(new Error('http'), { status: response.status });
    },
    async generate({ apiKey, model, prompt, size }): Promise<ImageGenerateOutcome> {
      let response: Response;
      try {
        response = await fetch(OPENAI_IMAGES_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            n: 1,
            size: size ?? '1024x1024',
            quality: 'high',
          }),
        });
      } catch {
        return {
          ok: false,
          reason: 'ERROR',
          message: 'Couldn’t reach OpenAI. Check your connection.',
        };
      }

      if (!response.ok) {
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          /* non-JSON error body */
        }
        if (isContentPolicy(payload)) {
          return {
            ok: false,
            reason: 'REFUSED',
            message: 'OpenAI declined this image (content policy).',
          };
        }
        return {
          ok: false,
          reason: 'ERROR',
          message: `OpenAI image request failed (${response.status}).`,
        };
      }

      try {
        const data = (await response.json()) as { data?: { b64_json?: string }[] };
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) return { ok: false, reason: 'ERROR', message: 'OpenAI returned no image data.' };
        return { ok: true, image: { bytes: fromBase64(b64), mime: 'image/png' } };
      } catch {
        return { ok: false, reason: 'ERROR', message: 'OpenAI returned an unexpected response.' };
      }
    },
  };
}
