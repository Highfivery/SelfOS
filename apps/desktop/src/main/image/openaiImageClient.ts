import type { ImageClient, ImageGenerateOutcome } from '@selfos/core/host';

/**
 * Real image client backed by OpenAI's image API (13-dream-images §5.1/§6.1) — SelfOS's second provider,
 * used ONLY to render pixels from a Claude-distilled, name-free prompt. The key is passed per call and
 * never reaches the renderer. A content-policy decline maps to `REFUSED` (uncharged → unmetered, §7);
 * any other failure is `ERROR`. Blind-written (no network here) like the relay/iOS bits — verified
 * on-device by the user; the offline fake covers the deterministic path.
 */
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

/** Heuristic: does an OpenAI error look like a content-policy refusal (vs. a transport/auth error)? */
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

export function openaiImageClient(): ImageClient {
  return {
    async verify(apiKey): Promise<void> {
      // Non-generative auth probe — a models-list GET bills nothing (33 §5.B). Reject with `.status` on a
      // failed response, or a status-free error on a network failure (mapped by openaiProxy).
      let response: Response;
      try {
        response = await fetch(OPENAI_MODELS_URL, {
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
            quality: 'high', // 1024² high quality (§4.5); the flat cost seeds at this tier
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
        const data = (await response.json()) as {
          data?: { b64_json?: string }[];
        };
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) return { ok: false, reason: 'ERROR', message: 'OpenAI returned no image data.' };
        return {
          ok: true,
          image: { bytes: new Uint8Array(Buffer.from(b64, 'base64')), mime: 'image/png' },
        };
      } catch {
        return { ok: false, reason: 'ERROR', message: 'OpenAI returned an unexpected response.' };
      }
    },
  };
}

// A 1×1 transparent PNG — the smallest valid image, so tests/E2E never touch the network.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Offline stub (gated by `SELFOS_FAKE_IMAGE`) so generation is deterministic. `SELFOS_FAKE_IMAGE=refuse`
 * makes it return a content-policy `REFUSED` (for the refusal-not-metered E2E, §10); any other truthy
 * value returns a tiny PNG.
 */
export function fakeImageClient(mode?: string): ImageClient {
  return {
    verify: (): Promise<void> => {
      // `SELFOS_FAKE_IMAGE=authfail` forces an AUTH failure for the connection-test failure path (33 §10).
      if (mode === 'authfail')
        return Promise.reject(Object.assign(new Error('http'), { status: 401 }));
      return Promise.resolve();
    },
    generate: async (): Promise<ImageGenerateOutcome> => {
      if (mode === 'refuse') {
        return {
          ok: false,
          reason: 'REFUSED',
          message: 'OpenAI declined this image (content policy).',
        };
      }
      // Optional artificial render delay so an E2E can observe the realtime progress mid-generation.
      const delayMs = Number(process.env['SELFOS_FAKE_IMAGE_DELAY_MS'] ?? 0);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return {
        ok: true,
        image: { bytes: new Uint8Array(Buffer.from(TINY_PNG_BASE64, 'base64')), mime: 'image/png' },
      };
    },
  };
}

export function defaultImageClient(): ImageClient {
  const fake = process.env['SELFOS_FAKE_IMAGE'];
  return fake ? fakeImageClient(fake) : openaiImageClient();
}
