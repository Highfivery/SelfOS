import { handleRelayRequest, type WorkerEnv } from './handler';

// The static answering page (HTML with the inlined JS+CSS bundle) is injected at build time — see
// scripts/build.mjs. Declared here so the Worker source typechecks on its own.
declare const __RELAY_PAGE_HTML__: string;

/** The Cloudflare bindings the app provisions: a KV namespace for the ciphertext mailbox + the drain secret. */
export interface CloudflareEnv {
  RELAY_KV: KVNamespace;
  DRAIN_SECRET: string;
}

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    // Adapt the Cloudflare KVNamespace to the minimal RelayKv the core ops use.
    const workerEnv: WorkerEnv = {
      RELAY_KV: {
        get: (key) => env.RELAY_KV.get(key),
        put: (key, value, options) => env.RELAY_KV.put(key, value, options),
        delete: (key) => env.RELAY_KV.delete(key),
      },
      DRAIN_SECRET: env.DRAIN_SECRET,
    };
    return handleRelayRequest(request, workerEnv, __RELAY_PAGE_HTML__);
  },
};
