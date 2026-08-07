import type { EmailVerifyResult } from '../schemas';

/** One outbound email to hand to Resend (67 §5.1). `from` is a full "Name <addr@domain>" line. */
export interface EmailSendRequest {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** ISO datetime for Resend's native scheduling (≤30 days ahead); absent ⇒ send now. */
  scheduledAt?: string;
}

export type EmailSendOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'API_ERROR'; message?: string };

/** A delivery-status poll for one previously-sent message (67 §5.1; Resend retrieval, no webhook). */
export interface EmailStatusPoll {
  id: string;
  /** Resend's delivery status string (e.g. 'delivered', 'bounced'); mapped to `EmailDeliveryStatus`. */
  status: string;
  lastEvent?: string;
}

/**
 * The Resend host part (67 §5.1) — a network primitive wired to `globalThis.fetch` in `ipc.ts`, with a
 * `SELFOS_FAKE_RESEND` offline fake so tests never hit Resend (the `ImageClient`/`checkForUpdate`
 * precedent). The resolved key is read host-side and passed per call; it never reaches the renderer.
 */
export interface EmailClient {
  /** Send (or schedule) one email. Returns Resend's message id, or a mapped failure. */
  send(request: EmailSendRequest): Promise<EmailSendOutcome>;
  /** Cancel a previously-scheduled Resend email (Phase 3). */
  cancel(apiKey: string, messageId: string): Promise<void>;
  /** Poll delivery status for sent/scheduled messages (Phase 3; no webhook). */
  status(apiKey: string, messageIds: string[]): Promise<EmailStatusPoll[]>;
  /** Verify the API key + list verified domains (the "Test connection"). */
  verify(apiKey: string): Promise<EmailVerifyResult>;
}
