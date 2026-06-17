import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RelayBundle } from '../../shared/relay/cloudflareDeployer';

/**
 * The desktop host's relay-bundle loader (08-questionnaires §5.2). The relay Worker is built separately
 * (`apps/relay` → `dist/worker.js`, the answering page inlined); the deployer reads it from there to
 * upload to Cloudflare. The bundled version drives the "update available" check in the Relay panel.
 */
// Must match apps/relay/scripts/build.mjs. Bumping it makes the Relay panel's "Update relay" prompt fire
// for an already-deployed older relay so the user can push the current Worker (08 §17.14c).
export const RELAY_VERSION = '2';

const requireFromHere = createRequire(import.meta.url);

/** Candidate `apps/relay/dist` locations: the resolved workspace package, then a path relative to this
 *  bundled file (`apps/desktop/out/main` → `apps/relay`). The first that holds a `worker.js` wins. */
function relayDistDirs(): string[] {
  const dirs: string[] = [];
  try {
    dirs.push(resolve(dirname(requireFromHere.resolve('@selfos/relay/package.json')), 'dist'));
  } catch {
    // @selfos/relay not resolvable from node_modules (e.g. an odd Electron resolve) — fall through.
  }
  // From the bundled main (apps/desktop/out/main) up to the repo, then apps/relay/dist.
  const here = dirname(fileURLToPath(import.meta.url));
  dirs.push(resolve(here, '..', '..', '..', 'relay', 'dist'));
  dirs.push(resolve(here, '..', '..', '..', '..', 'apps', 'relay', 'dist'));
  return dirs;
}

export async function loadRelayBundle(): Promise<RelayBundle> {
  for (const dist of relayDistDirs()) {
    try {
      const script = await readFile(resolve(dist, 'worker.js'), 'utf8');
      const meta = JSON.parse(await readFile(resolve(dist, 'meta.json'), 'utf8')) as {
        relayVersion?: string;
      };
      return { script, version: meta.relayVersion ?? RELAY_VERSION };
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    'The relay Worker bundle is missing. Build it first: pnpm --filter @selfos/relay build',
  );
}
