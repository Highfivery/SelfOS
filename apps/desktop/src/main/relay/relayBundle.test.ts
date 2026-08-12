import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRelayBundle, RELAY_VERSION } from './relayBundle';

/**
 * The packaged app has no monorepo layout, so loadRelayBundle must find the relay Worker bundle in the
 * app's Resources (electron-builder `extraResources` copies `apps/relay/dist` → `<resources>/relay`).
 * `process.resourcesPath` is the highest-priority candidate; this guards that production path
 * (regression for "The relay Worker bundle is missing" in the built app).
 */
describe('loadRelayBundle', () => {
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  const original = proc.resourcesPath;
  let dir: string | undefined;

  afterEach(async () => {
    proc.resourcesPath = original;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('loads the bundle from process.resourcesPath/relay (the packaged-app path)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'selfos-resources-'));
    const relay = join(dir, 'relay');
    await mkdir(relay, { recursive: true });
    await writeFile(join(relay, 'worker.js'), 'export default { fetch() {} }', 'utf8');
    await writeFile(join(relay, 'meta.json'), JSON.stringify({ relayVersion: '99' }), 'utf8');
    proc.resourcesPath = dir;

    const bundle = await loadRelayBundle();
    expect(bundle.script).toContain('export default');
    expect(bundle.version).toBe('99');
  });

  it('a bundle whose meta.json omits relayVersion is NOT assumed current', async () => {
    // The deploy refuses a bundle that doesn't match RELAY_VERSION; defaulting a missing field to the
    // app's own version would let exactly the stale `dist` that guard exists for self-certify past it.
    dir = await mkdtemp(join(tmpdir(), 'selfos-resources-'));
    const relay = join(dir, 'relay');
    await mkdir(relay, { recursive: true });
    await writeFile(join(relay, 'worker.js'), 'export default { fetch() {} }', 'utf8');
    await writeFile(join(relay, 'meta.json'), JSON.stringify({}), 'utf8');
    proc.resourcesPath = dir;

    expect((await loadRelayBundle()).version).not.toBe(RELAY_VERSION);
  });
});

/**
 * The app's RELAY_VERSION and the relay build script's are two hand-maintained copies of one number
 * (the build stamps `dist/meta.json`; the app compares against it). Since a deploy now REFUSES a
 * mismatched bundle, drifting them doesn't just weaken the update prompt — it would ship a `.dmg` where
 * Connect and Update throw for every user. This is the spec-19 `__APP_VERSION__` drift-guard pattern.
 */
describe('RELAY_VERSION', () => {
  it('matches the version stamped by the relay build script', async () => {
    const script = await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../relay/scripts/build.mjs'),
      'utf8',
    );
    expect(script).toMatch(new RegExp(`RELAY_VERSION = '${RELAY_VERSION}'`));
  });
});
