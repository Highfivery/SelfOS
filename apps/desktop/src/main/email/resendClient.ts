import type {
  EmailClient,
  EmailSendOutcome,
  EmailSendRequest,
  EmailStatusPoll,
} from '@selfos/core/host';
import type { EmailVerifyResult } from '@selfos/core/schemas';

/**
 * Real Resend client (67 §5.1) — SelfOS's email sender. The key is passed per call and never reaches the
 * renderer. Blind-written (no network here) like the relay/OpenAI bits — verified on-device by the user;
 * the offline `SELFOS_FAKE_RESEND` fake covers the deterministic test path. Failures map to the
 * AUTH/RATE_LIMIT/NETWORK/API_ERROR taxonomy (the `openaiProxy` precedent).
 */
const RESEND_BASE = 'https://api.resend.com';

function mapStatus(status: number): 'AUTH' | 'RATE_LIMIT' | 'API_ERROR' {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMIT';
  return 'API_ERROR';
}

async function errorMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { message?: unknown; error?: { message?: unknown } };
    const message = body.message ?? body.error?.message;
    return typeof message === 'string' ? message : undefined;
  } catch {
    return undefined;
  }
}

export function resendClient(): EmailClient {
  return {
    async send(request: EmailSendRequest): Promise<EmailSendOutcome> {
      let response: Response;
      try {
        response = await fetch(`${RESEND_BASE}/emails`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${request.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: request.from,
            to: request.to,
            subject: request.subject,
            html: request.html,
            text: request.text,
            ...(request.scheduledAt ? { scheduled_at: request.scheduledAt } : {}),
          }),
        });
      } catch {
        return { ok: false, reason: 'NETWORK' };
      }
      if (!response.ok) {
        return {
          ok: false,
          reason: mapStatus(response.status),
          ...spreadMessage(await errorMessage(response)),
        };
      }
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id !== 'string') return { ok: false, reason: 'API_ERROR' };
      return { ok: true, id: body.id };
    },

    async cancel(apiKey: string, messageId: string): Promise<void> {
      try {
        await fetch(`${RESEND_BASE}/emails/${encodeURIComponent(messageId)}/cancel`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      } catch {
        // Best-effort (Phase 3 reconcile retries).
      }
    },

    async status(apiKey: string, messageIds: string[]): Promise<EmailStatusPoll[]> {
      const out: EmailStatusPoll[] = [];
      for (const id of messageIds) {
        try {
          const response = await fetch(`${RESEND_BASE}/emails/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!response.ok) continue;
          const body = (await response.json()) as { last_event?: unknown };
          out.push({
            id,
            status: typeof body.last_event === 'string' ? body.last_event : 'sent',
            ...(typeof body.last_event === 'string' ? { lastEvent: body.last_event } : {}),
          });
        } catch {
          // Skip; the next reconcile retries.
        }
      }
      return out;
    },

    async verify(apiKey: string): Promise<EmailVerifyResult> {
      let response: Response;
      try {
        response = await fetch(`${RESEND_BASE}/domains`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      } catch {
        return { ok: false, reason: 'NETWORK' };
      }
      if (!response.ok) {
        return {
          ok: false,
          reason: mapStatus(response.status),
          ...spreadMessage(await errorMessage(response)),
        };
      }
      const body = (await response.json()) as { data?: { name?: unknown; status?: unknown }[] };
      const domains = (body.data ?? [])
        .map((d) => ({
          name: typeof d.name === 'string' ? d.name : '',
          verified: d.status === 'verified',
        }))
        .filter((d) => d.name !== '');
      return { ok: true, domains };
    },
  };
}

function spreadMessage(message: string | undefined): { message?: string } {
  return message ? { message } : {};
}

/**
 * Deterministic offline fake (`SELFOS_FAKE_RESEND`) — never hits Resend. `mode` (the env value) can force a
 * failure path for the domain-unverified / auth E2E: `fail` → an API error on send, `noverify` → an
 * unverified domain on verify. Default → success with a verified fake domain.
 */
export function fakeResendClient(mode: string): EmailClient {
  let counter = 0;
  return {
    send(): Promise<EmailSendOutcome> {
      if (mode === 'fail')
        return Promise.resolve({ ok: false, reason: 'API_ERROR', message: 'domain unverified' });
      counter += 1;
      return Promise.resolve({ ok: true, id: `fake-resend-${counter}` });
    },
    cancel(): Promise<void> {
      return Promise.resolve();
    },
    status(_apiKey, messageIds): Promise<EmailStatusPoll[]> {
      return Promise.resolve(
        messageIds.map((id) => ({ id, status: 'delivered', lastEvent: 'delivered' })),
      );
    },
    verify(): Promise<EmailVerifyResult> {
      if (mode === 'noverify')
        return Promise.resolve({ ok: true, domains: [{ name: 'fake.example', verified: false }] });
      return Promise.resolve({ ok: true, domains: [{ name: 'fake.example', verified: true }] });
    },
  };
}
