import { verifyPin } from '../crypto';
import {
  EncryptedEnvelopeSchema,
  RelayMailboxSchema,
  SealedResponseSchema,
  type RelayMailbox,
  type RelayStoredResponse,
  type SealedResponse,
} from '../schemas';

/**
 * The relay mailbox operations (08-questionnaires §5.4/§8.6) — the Worker's zero-knowledge logic, kept
 * here (pure, no `Request`/`Response`) so it typechecks under both libs and is unit-tested against an
 * in-memory KV. The Worker in `apps/relay` does only HTTP routing + static-page serving around these.
 *
 * The relay stores ONLY ciphertext: a sealed content blob keyed by token, gated by a scrypt PIN hash
 * (rate-limited), and at most one sealed response per token (single-submission-per-link, §11.3). It never
 * holds a key that can read either — questions decrypt via the URL-fragment content key, responses via
 * the send private key, neither of which the relay sees.
 */

// The cap + PIN limits live in a leaf module so the client-side response-size guard can share them without
// pulling this Worker module into the answering bundle (38 §5.4). Re-exported for existing importers.
export { MAX_RESPONSE_BYTES, MAX_PIN_ATTEMPTS, LOCKOUT_MS } from './relayLimits';
import { MAX_RESPONSE_BYTES, MAX_PIN_ATTEMPTS, LOCKOUT_MS } from './relayLimits';

/** The minimal KV the relay needs — Workers KV satisfies it; tests pass an in-memory fake. */
export interface RelayKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RelayEnv {
  kv: RelayKv;
  nowIso: () => string;
  nowMs: () => number;
}

export interface RelayOpResult {
  status: number;
  json: unknown;
}

const mailboxKey = (token: string): string => `mailbox:${token}`;
const responseKey = (token: string): string => `response:${token}`;
const attemptsKey = (token: string): string => `attempts:${token}`;

interface Attempts {
  count: number;
  lockoutUntil?: number;
}

async function loadMailbox(env: RelayEnv, token: string): Promise<RelayMailbox | null> {
  const raw = await env.kv.get(mailboxKey(token));
  if (!raw) return null;
  const parsed = RelayMailboxSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

function isAvailable(mailbox: RelayMailbox, env: RelayEnv): boolean {
  return !mailbox.expiresAt || env.nowIso() <= mailbox.expiresAt;
}

/**
 * The single PIN gate enforcing the rate-limit uniformly across EVERY PIN-checked endpoint
 * (unlock/respond/withdraw). Each wrong guess — on any of them — counts toward the shared 5-attempt /
 * 15-min lockout, so the link's PIN can't be brute-forced through an unthrottled endpoint. Returns
 * `{ ok: true }` on a correct PIN (and clears the counter), else the HTTP response to return.
 */
async function pinGate(
  env: RelayEnv,
  token: string,
  pin: string,
  mailbox: RelayMailbox,
): Promise<{ ok: true } | { ok: false; result: RelayOpResult }> {
  const attemptsRaw = await env.kv.get(attemptsKey(token));
  const attempts: Attempts = attemptsRaw ? (JSON.parse(attemptsRaw) as Attempts) : { count: 0 };
  if (attempts.lockoutUntil && env.nowMs() < attempts.lockoutUntil) {
    return {
      ok: false,
      result: { status: 429, json: { error: 'locked', lockedUntil: attempts.lockoutUntil } },
    };
  }
  if (await verifyPin(pin, mailbox.pinHash)) {
    await env.kv.delete(attemptsKey(token));
    return { ok: true };
  }
  // Wrong PIN: increment (resetting the count once a prior lockout has elapsed) and re-lock if at cap.
  const count = (attempts.lockoutUntil ? 0 : attempts.count) + 1;
  const next: Attempts =
    count >= MAX_PIN_ATTEMPTS ? { count, lockoutUntil: env.nowMs() + LOCKOUT_MS } : { count };
  await env.kv.put(attemptsKey(token), JSON.stringify(next), { expirationTtl: 3600 });
  return {
    ok: false,
    result: next.lockoutUntil
      ? { status: 429, json: { error: 'locked', lockedUntil: next.lockoutUntil } }
      : {
          status: 401,
          json: { error: 'wrong pin', attemptsRemaining: Math.max(0, MAX_PIN_ATTEMPTS - count) },
        },
  };
}

/** App → relay: create/replace the mailbox (drain-secret authenticated by the Worker). */
export async function putMailbox(env: RelayEnv, body: unknown): Promise<RelayOpResult> {
  const parsed = RelayMailboxSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: 'invalid mailbox' } };
  await env.kv.put(mailboxKey(parsed.data.token), JSON.stringify(parsed.data));
  await env.kv.delete(attemptsKey(parsed.data.token));
  return { status: 200, json: { ok: true } };
}

/**
 * App → relay: attach a sealed outcome to an existing mailbox (08 §17.12-D, drain-secret authenticated).
 * Patches the stored mailbox in place so the content + PIN gate are untouched; a returning recipient then
 * receives `sealedResult` from `unlock`. No-op-safe if the mailbox is gone (expired/revoked).
 */
export async function putResult(env: RelayEnv, body: unknown): Promise<RelayOpResult> {
  const token =
    typeof (body as { token?: unknown })?.token === 'string'
      ? (body as { token: string }).token
      : '';
  if (!token) return { status: 400, json: { error: 'token required' } };
  const sealedParse = EncryptedEnvelopeSchema.safeParse(
    (body as { sealedResult?: unknown })?.sealedResult,
  );
  if (!sealedParse.success) return { status: 400, json: { error: 'invalid result' } };
  const mailbox = await loadMailbox(env, token);
  if (!mailbox) return { status: 404, json: { error: 'unavailable' } };
  const updated: RelayMailbox = { ...mailbox, sealedResult: sealedParse.data };
  await env.kv.put(mailboxKey(token), JSON.stringify(updated));
  return { status: 200, json: { ok: true } };
}

/**
 * Recipient → relay: verify the PIN (rate-limited: 5 attempts → 15-min lockout) and, on success, release
 * the sealed content for client-side decryption. Reports whether a response was already submitted so the
 * page can show the "thanks" state without leaking anything.
 */
export async function unlock(env: RelayEnv, body: unknown): Promise<RelayOpResult> {
  const token =
    typeof (body as { token?: unknown })?.token === 'string'
      ? (body as { token: string }).token
      : '';
  const pin =
    typeof (body as { pin?: unknown })?.pin === 'string' ? (body as { pin: string }).pin : '';
  if (!token || !pin) return { status: 400, json: { error: 'token and pin required' } };

  const mailbox = await loadMailbox(env, token);
  if (!mailbox || !isAvailable(mailbox, env)) {
    return { status: 404, json: { error: 'unavailable' } };
  }

  const gate = await pinGate(env, token, pin, mailbox);
  if (!gate.ok) return gate.result;

  const submitted = Boolean(await env.kv.get(responseKey(token)));
  return {
    status: 200,
    json: {
      ok: true,
      sealedContent: mailbox.sealedContent,
      submitted,
      // The sender's pushed outcome, if any (08 §17.12-D) — sealed under the content key, so a returning
      // recipient who's already answered can decrypt + see the report/acknowledgement client-side.
      ...(mailbox.sealedResult ? { sealedResult: mailbox.sealedResult } : {}),
    },
  };
}

function sizeBytes(value: unknown): number {
  // Byte length of the UTF-8 JSON — the payload the Worker would store.
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Recipient → relay: store the sealed response (a submission or a decline). PIN-gated (rate-limited the
 * same way), size-bounded (≤256 KB), single-submission-per-link. The Worker never sees the plaintext.
 */
export async function respond(env: RelayEnv, body: unknown): Promise<RelayOpResult> {
  const token =
    typeof (body as { token?: unknown })?.token === 'string'
      ? (body as { token: string }).token
      : '';
  const pin =
    typeof (body as { pin?: unknown })?.pin === 'string' ? (body as { pin: string }).pin : '';
  if (!token || !pin) return { status: 400, json: { error: 'token and pin required' } };

  const sealedParse = SealedResponseSchema.safeParse((body as { sealed?: unknown })?.sealed);
  if (!sealedParse.success) return { status: 400, json: { error: 'invalid response' } };
  const sealed: SealedResponse = sealedParse.data;
  if (sizeBytes(sealed) > MAX_RESPONSE_BYTES) {
    return { status: 413, json: { error: 'too large' } };
  }

  const mailbox = await loadMailbox(env, token);
  if (!mailbox || !isAvailable(mailbox, env)) {
    return { status: 404, json: { error: 'unavailable' } };
  }
  const gate = await pinGate(env, token, pin, mailbox);
  if (!gate.ok) return gate.result;
  if (await env.kv.get(responseKey(token))) {
    return { status: 409, json: { error: 'already submitted' } };
  }

  const stored: RelayStoredResponse = { sealed, receivedAt: env.nowIso() };
  await env.kv.put(responseKey(token), JSON.stringify(stored));
  return { status: 200, json: { ok: true } };
}

/** Recipient → relay: withdraw (delete) the response before drain — PIN-gated. */
export async function withdraw(env: RelayEnv, body: unknown): Promise<RelayOpResult> {
  const token =
    typeof (body as { token?: unknown })?.token === 'string'
      ? (body as { token: string }).token
      : '';
  const pin =
    typeof (body as { pin?: unknown })?.pin === 'string' ? (body as { pin: string }).pin : '';
  if (!token || !pin) return { status: 400, json: { error: 'token and pin required' } };
  const mailbox = await loadMailbox(env, token);
  if (!mailbox) return { status: 404, json: { error: 'unavailable' } };
  const gate = await pinGate(env, token, pin, mailbox);
  if (!gate.ok) return gate.result;
  await env.kv.delete(responseKey(token));
  return { status: 200, json: { ok: true } };
}

/** App → relay: read the stored response(s) for a token (drain-secret authenticated; idempotent). */
export async function drain(env: RelayEnv, body: unknown): Promise<RelayOpResult> {
  const token =
    typeof (body as { token?: unknown })?.token === 'string'
      ? (body as { token: string }).token
      : '';
  if (!token) return { status: 400, json: { error: 'token required' } };
  const raw = await env.kv.get(responseKey(token));
  const responses: RelayStoredResponse[] = raw ? [JSON.parse(raw) as RelayStoredResponse] : [];
  return { status: 200, json: { responses } };
}

/** App → relay: delete a response after the app has persisted it locally (purge-on-drain). */
export async function purge(env: RelayEnv, body: unknown): Promise<RelayOpResult> {
  const token =
    typeof (body as { token?: unknown })?.token === 'string'
      ? (body as { token: string }).token
      : '';
  if (!token) return { status: 400, json: { error: 'token required' } };
  await env.kv.delete(responseKey(token));
  return { status: 200, json: { ok: true } };
}

/** App → relay: revoke a send entirely — delete the mailbox + any response + attempt counter. */
export async function revoke(env: RelayEnv, body: unknown): Promise<RelayOpResult> {
  const token =
    typeof (body as { token?: unknown })?.token === 'string'
      ? (body as { token: string }).token
      : '';
  if (!token) return { status: 400, json: { error: 'token required' } };
  await env.kv.delete(mailboxKey(token));
  await env.kv.delete(responseKey(token));
  await env.kv.delete(attemptsKey(token));
  return { status: 200, json: { ok: true } };
}
