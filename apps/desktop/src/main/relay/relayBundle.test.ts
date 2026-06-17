import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRelayBundle } from './relayBundle';

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
});
