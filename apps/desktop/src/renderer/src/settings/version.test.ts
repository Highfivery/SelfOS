import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Drift guard (19-distribution §7/§10): the version the About page shows (`__APP_VERSION__`, injected
 * from `apps/desktop/package.json`) must equal the version electron-builder ships and release-please
 * bumps. Both derive from the same file, so they cannot disagree — this test pins that wiring: if the
 * `define` source ever points at the wrong file (or a literal), the build version + About version drift
 * and this fails.
 */
describe('app version', () => {
  it('__APP_VERSION__ matches apps/desktop/package.json version', () => {
    // Vitest runs with the package dir (apps/desktop) as cwd — read its package.json directly.
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(__APP_VERSION__).toBe(pkg.version);
  });
});
