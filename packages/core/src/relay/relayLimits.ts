/**
 * Relay limits shared by the Worker AND the client-side guards (38 §5.4) — a leaf module (no imports) so
 * the in-app/relay-page response-size guard can reference the SAME cap the Worker enforces, and a drift
 * test can assert they're identical. Centralized here (out of `relayMailbox`) so importing the cap into the
 * answering renderer never drags the Worker's KV/env logic into that bundle.
 */
export const MAX_RESPONSE_BYTES = 256 * 1024;
export const MAX_PIN_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
