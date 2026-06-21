import type { AiProvider } from '@selfos/core/schemas';

/**
 * Whether AI is usable for a provider on this device — the **resolved** readiness (a device-local override
 * OR the household-shared key, 25-household-ai-credentials §5.3). Replaces the old per-surface
 * `secretHas(...)` check, which only saw this device's own key and so falsely reported "not set up" for a
 * member inheriting the shared household key. Never returns a key value.
 */
export async function aiKeyResolved(provider: AiProvider = 'anthropic'): Promise<boolean> {
  const status = await window.selfos?.aiKeyStatus({ provider });
  return Boolean(status?.resolvedReady);
}
