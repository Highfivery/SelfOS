import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Build-time identity injected as `define` globals across the Electron, web, and test builds
 * (19-distribution §3.3/§5). The **version** is the single source of truth in
 * `apps/desktop/package.json` (release-please bumps it on each release, and electron-builder ships
 * it); the **short SHA** + **date** make a specific build identifiable on the About page.
 *
 * Used by `electron.vite.config.ts`, `vite.web.config.ts`, and `vitest.config.ts` so all three
 * surfaces share one definition — and so the drift-guard test sees the same `__APP_VERSION__`.
 */
export interface BuildInfo {
  version: string;
  sha: string;
  date: string;
}

export function buildInfo(): BuildInfo {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
    version: string;
  };
  return { version: pkg.version, sha: gitShortSha(), date: buildDate() };
}

/** The `define` map (values are pre-stringified, as `define` requires). */
export function buildDefines(): Record<string, string> {
  const info = buildInfo();
  return {
    __APP_VERSION__: JSON.stringify(info.version),
    __BUILD_SHA__: JSON.stringify(info.sha),
    __BUILD_DATE__: JSON.stringify(info.date),
  };
}

/** Short commit SHA: a CI override (the release job's tag SHA), else `git`, else `'dev'`. */
function gitShortSha(): string {
  const fromEnv = process.env.SELFOS_BUILD_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

/** Build date as `YYYY-MM-DD`: a CI override, else today. */
function buildDate(): string {
  const fromEnv = process.env.SELFOS_BUILD_DATE;
  if (fromEnv) return fromEnv;
  return new Date().toISOString().slice(0, 10);
}
