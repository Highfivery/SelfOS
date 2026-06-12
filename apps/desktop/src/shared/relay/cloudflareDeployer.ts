import { randomBytes } from '@selfos/core/crypto';

/**
 * Cloudflare provisioning + deploy for the zero-knowledge relay (08-questionnaires §3.8/§5.2). The app
 * brings the household's own least-privilege Cloudflare token, provisions a KV namespace, and deploys the
 * self-contained relay Worker (`apps/relay` → one `worker.js`, with the answering page inlined) to a free
 * `*.workers.dev` subdomain. All network access goes through an injected `fetch`, so this is fully
 * testable against a fake Cloudflare API (no real account/network in CI). The token never reaches the
 * renderer — these calls run host-side only, and only the resulting `RelayConfig` is persisted (encrypted).
 */

const CF_API = 'https://api.cloudflare.com/client/v4';
const COMPATIBILITY_DATE = '2024-11-01';
const SCRIPT_NAME = 'selfos-relay';
const KV_TITLE = 'selfos-relay-mailbox';

export type FetchLike = typeof fetch;

/** The built relay Worker the app uploads (read host-side from `@selfos/relay/dist`). */
export interface RelayBundle {
  script: string;
  version: string;
}

export interface DeployInput {
  apiToken: string;
  accountId: string;
}

export interface DeployResult {
  endpointUrl: string;
  drainSecret: string;
  relayVersion: string;
  scriptName: string;
  kvNamespaceId: string;
}

export class CloudflareDeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareDeployError';
  }
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function cfJson(
  fetchImpl: FetchLike,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetchImpl(`${CF_API}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers ?? {}) },
  });
  const body: unknown = await res.json().catch(() => null);
  const ok =
    res.ok &&
    typeof body === 'object' &&
    body !== null &&
    (body as { success?: boolean }).success !== false;
  if (!ok) {
    const errors = (body as { errors?: { message?: string }[] })?.errors;
    const detail = errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join('; ');
    throw new CloudflareDeployError(
      detail || `Cloudflare request failed (${res.status}) for ${path}`,
    );
  }
  return (body as { result?: unknown }).result;
}

/** A high-entropy app-level drain secret the Worker checks for drain/manage (never the renderer's). */
function generateDrainSecret(): string {
  return Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Verify the token is valid + active before doing anything destructive (the Connect pre-flight). */
export async function verifyCloudflareToken(fetchImpl: FetchLike, token: string): Promise<boolean> {
  try {
    const result = (await cfJson(fetchImpl, token, '/user/tokens/verify')) as { status?: string };
    return result?.status === 'active';
  } catch {
    return false;
  }
}

async function workersDevSubdomain(
  fetchImpl: FetchLike,
  token: string,
  accountId: string,
): Promise<string> {
  const result = (await cfJson(fetchImpl, token, `/accounts/${accountId}/workers/subdomain`)) as {
    subdomain?: string;
  };
  if (!result?.subdomain) {
    throw new CloudflareDeployError(
      'Your Cloudflare account has no workers.dev subdomain yet — enable one in the Cloudflare dashboard (Workers & Pages) and try again.',
    );
  }
  return result.subdomain;
}

async function createKvNamespace(
  fetchImpl: FetchLike,
  token: string,
  accountId: string,
): Promise<string> {
  const result = (await cfJson(fetchImpl, token, `/accounts/${accountId}/storage/kv/namespaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: KV_TITLE }),
  })) as { id?: string };
  if (!result?.id) throw new CloudflareDeployError('Could not create the relay storage namespace.');
  return result.id;
}

async function uploadWorker(
  fetchImpl: FetchLike,
  token: string,
  accountId: string,
  bundle: RelayBundle,
  kvNamespaceId: string,
  drainSecret: string,
): Promise<void> {
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      { type: 'kv_namespace', name: 'RELAY_KV', namespace_id: kvNamespaceId },
      { type: 'secret_text', name: 'DRAIN_SECRET', text: drainSecret },
    ],
  };
  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  form.set(
    'worker.js',
    new Blob([bundle.script], { type: 'application/javascript+module' }),
    'worker.js',
  );
  await cfJson(fetchImpl, token, `/accounts/${accountId}/workers/scripts/${SCRIPT_NAME}`, {
    method: 'PUT',
    body: form,
  });
}

async function enableWorkersDevRoute(
  fetchImpl: FetchLike,
  token: string,
  accountId: string,
): Promise<void> {
  await cfJson(
    fetchImpl,
    token,
    `/accounts/${accountId}/workers/scripts/${SCRIPT_NAME}/subdomain`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    },
  );
}

/**
 * Connect + deploy: verify the token, provision KV, upload the Worker (bound to KV + a fresh drain
 * secret), and enable the workers.dev route. Returns the config bits the caller encrypts into the vault.
 * Idempotent enough to retry — re-running creates a new KV namespace + re-uploads (partial provisioning
 * never claims success because each step throws on failure).
 */
export async function deployRelay(
  fetchImpl: FetchLike,
  bundle: RelayBundle,
  input: DeployInput,
): Promise<DeployResult> {
  if (!(await verifyCloudflareToken(fetchImpl, input.apiToken))) {
    throw new CloudflareDeployError(
      'That Cloudflare API token is invalid or expired. Create a token with Workers Scripts + Workers KV edit permissions.',
    );
  }
  const subdomain = await workersDevSubdomain(fetchImpl, input.apiToken, input.accountId);
  const kvNamespaceId = await createKvNamespace(fetchImpl, input.apiToken, input.accountId);
  const drainSecret = generateDrainSecret();
  await uploadWorker(
    fetchImpl,
    input.apiToken,
    input.accountId,
    bundle,
    kvNamespaceId,
    drainSecret,
  );
  await enableWorkersDevRoute(fetchImpl, input.apiToken, input.accountId);
  return {
    endpointUrl: `https://${SCRIPT_NAME}.${subdomain}.workers.dev`,
    drainSecret,
    relayVersion: bundle.version,
    scriptName: SCRIPT_NAME,
    kvNamespaceId,
  };
}

/** Re-upload the Worker (one-click update when SelfOS ships a new relay version). Reuses KV + the secret. */
export async function updateRelay(
  fetchImpl: FetchLike,
  bundle: RelayBundle,
  input: DeployInput & { kvNamespaceId: string; drainSecret: string },
): Promise<string> {
  await uploadWorker(
    fetchImpl,
    input.apiToken,
    input.accountId,
    bundle,
    input.kvNamespaceId,
    input.drainSecret,
  );
  return bundle.version;
}

/** Tear down: delete the Worker + its KV namespace (disable / uninstall). Best-effort, order-independent. */
export async function teardownRelay(
  fetchImpl: FetchLike,
  input: DeployInput & { scriptName: string; kvNamespaceId: string },
): Promise<void> {
  await cfJson(
    fetchImpl,
    input.apiToken,
    `/accounts/${input.accountId}/workers/scripts/${input.scriptName}`,
    {
      method: 'DELETE',
    },
  ).catch(() => undefined);
  await cfJson(
    fetchImpl,
    input.apiToken,
    `/accounts/${input.accountId}/storage/kv/namespaces/${input.kvNamespaceId}`,
    { method: 'DELETE' },
  ).catch(() => undefined);
}
