import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { RelayBundle } from '../../shared/relay/cloudflareDeployer';

/**
 * The desktop host's relay-bundle loader (08-questionnaires §5.2). The relay Worker is built separately
 * (`apps/relay` → `dist/worker.js`, the answering page inlined); the deployer reads it from there to
 * upload to Cloudflare. The bundled version drives the "update available" check in the Relay panel.
 */
export const RELAY_VERSION = '1';

const requireFromHere = createRequire(import.meta.url);

export async function loadRelayBundle(): Promise<RelayBundle> {
  const dist = resolve(dirname(requireFromHere.resolve('@selfos/relay/package.json')), 'dist');
  try {
    const script = await readFile(resolve(dist, 'worker.js'), 'utf8');
    const meta = JSON.parse(await readFile(resolve(dist, 'meta.json'), 'utf8')) as {
      relayVersion?: string;
    };
    return { script, version: meta.relayVersion ?? RELAY_VERSION };
  } catch {
    throw new Error(
      'The relay Worker bundle is missing. Build it first: pnpm --filter @selfos/relay build',
    );
  }
}
