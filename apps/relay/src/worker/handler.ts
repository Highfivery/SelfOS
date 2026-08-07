import {
  drain,
  drainTaps,
  purge,
  putMailbox,
  putResult,
  recordTap,
  respond,
  revoke,
  unlock,
  withdraw,
  type RelayEnv,
  type RelayKv,
  type RelayOpResult,
} from '@selfos/core/relay';

/**
 * The relay Worker's HTTP layer (08-questionnaires §5.4). It does ONLY routing + auth + static serving;
 * every zero-knowledge operation lives in `@selfos/core/relay` (unit-tested against an in-memory KV).
 * The Worker holds no key that can read questions or responses — it is a ciphertext mailbox.
 *
 *  Recipient (public, PIN-gated, rate-limited):  POST /api/unlock | /api/respond | /api/withdraw
 *  Recipient (public, one-click email tap):      GET  /t/<token>
 *  App (drain-secret authenticated):             POST /api/admin/mailbox | /result | /drain | /purge | /revoke | /drainTaps
 *  Answering page (static):                       GET  /q/<token>
 */

/** A tiny self-contained confirmation page for a one-click email tap (67 §3.5) — inline style only (CSP). */
const TAP_PAGE = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>SelfOS</title></head>',
  '<body style="margin:0;background:#f6f1ea;color:#2e2a25;',
  "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;\">",
  '<div style="max-width:440px;margin:15vh auto;padding:0 24px;text-align:center;">',
  '<div style="font-weight:700;font-size:20px;color:#241f1a;margin-bottom:16px;">SelfOS</div>',
  '<div style="background:#fff;border:1px solid #e7ddd0;border-radius:12px;padding:28px 24px;">',
  '<p style="font-size:18px;margin:0 0 8px;">Got it — thanks!</p>',
  '<p style="color:#6e665c;margin:0;">Open SelfOS to see it. You can close this tab.</p>',
  '</div></div></body></html>',
].join('');

export interface WorkerEnv {
  RELAY_KV: RelayKv;
  DRAIN_SECRET: string;
}

// The app calls from a non-web origin (Electron / Capacitor), so the admin endpoints need permissive
// CORS; they are drain-secret authenticated, and everything stored is ciphertext.
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

// Strict CSP for the answering page: no external origins, decrypted images as data:, same-origin XHR
// only. Inline script/style are the self-contained bundle the Worker serves.
const PAGE_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function jsonResponse(result: RelayOpResult): Response {
  return new Response(JSON.stringify(result.json), {
    status: result.status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isAuthed(request: Request, drainSecret: string): boolean {
  // A plain compare; the drain secret is 256-bit high-entropy, so timing leakage isn't a practical risk
  // (and admin endpoints are only reachable by someone who already knows the endpoint URL).
  return (request.headers.get('authorization') ?? '') === `Bearer ${drainSecret}`;
}

/** The single fetch entrypoint. `page` is the inlined static answering-page HTML. */
export async function handleRelayRequest(
  request: Request,
  env: WorkerEnv,
  page: string,
): Promise<Response> {
  const url = new URL(request.url);
  const relayEnv: RelayEnv = {
    kv: env.RELAY_KV,
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (request.method === 'GET') {
    if (url.pathname.startsWith('/q/')) {
      return new Response(page, { status: 200, headers: PAGE_HEADERS });
    }
    if (url.pathname.startsWith('/t/')) {
      // A one-click email tap (67 §3.5): record it, show a friendly confirmation. Public + no PIN — the
      // opaque token is the capability and the relay learns only that it was tapped, and when.
      await recordTap(relayEnv, decodeURIComponent(url.pathname.slice('/t/'.length)));
      return new Response(TAP_PAGE, { status: 200, headers: PAGE_HEADERS });
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('SelfOS relay', { status: 200, headers: CORS });
    }
    return error(404, 'not found');
  }

  if (request.method !== 'POST') return error(405, 'method not allowed');

  const body = await readJson(request);

  switch (url.pathname) {
    case '/api/unlock':
      return jsonResponse(await unlock(relayEnv, body));
    case '/api/respond':
      return jsonResponse(await respond(relayEnv, body));
    case '/api/withdraw':
      return jsonResponse(await withdraw(relayEnv, body));
  }

  if (url.pathname.startsWith('/api/admin/')) {
    if (!isAuthed(request, env.DRAIN_SECRET)) return error(401, 'unauthorized');
    switch (url.pathname) {
      case '/api/admin/mailbox':
        return jsonResponse(await putMailbox(relayEnv, body));
      case '/api/admin/result':
        return jsonResponse(await putResult(relayEnv, body));
      case '/api/admin/drain':
        return jsonResponse(await drain(relayEnv, body));
      case '/api/admin/purge':
        return jsonResponse(await purge(relayEnv, body));
      case '/api/admin/revoke':
        return jsonResponse(await revoke(relayEnv, body));
      case '/api/admin/drainTaps':
        return jsonResponse(await drainTaps(relayEnv, body));
    }
  }

  return error(404, 'not found');
}
