import { z } from 'zod';
import { UpdateCheckResultSchema, type UpdateCheckResult } from '../schemas';

/**
 * Update awareness (36-update-awareness §5). A pure, notify-only check against the PUBLIC GitHub Releases
 * API: fetch the latest published release, parse its `vX.Y.Z` tag, and semver-compare it to the running
 * version. Network is injected as a `fetch`, so every branch (newer / older / equal / malformed / 404 /
 * 403 / network / timeout) is unit-testable with no real network. NEVER sends a token — the repo is public.
 *
 * Returns a populated `UpdateCheckResult` on success (including "up to date"), or `null` when the check
 * couldn't be made (offline / rate-limited / timeout / unexpected response) so the caller keeps its cached
 * last-known state and the manual UI can show a calm "couldn't check right now" (§7).
 */

export type FetchLike = typeof fetch;

const REPO = 'Highfivery/SelfOS';
const RELEASES_LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
/** The repo's Releases listing — the fallback link target when a release has no own `html_url`. */
const RELEASES_PAGE_URL = `https://github.com/${REPO}/releases`;
const TIMEOUT_MS = 8000;

/** The slice of the GitHub release payload we use; everything else is ignored (never passed through). */
const GithubReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string().optional(),
  published_at: z.string().nullish(),
});

export interface CheckForUpdateOptions {
  fetch: FetchLike;
  /** The running app version (semver, may carry a leading `v`). */
  currentVersion: string;
  /** ISO timestamp stamped onto the result (injected so the check stays deterministic in tests). */
  now: string;
}

/** Parse a `vX.Y.Z` (release-please) tag into numeric [major, minor, patch], or null if malformed. */
function parseSemver(raw: string): [number, number, number] | null {
  // Strip a leading `v` and any `-prerelease`/`+build` suffix (release-please tags are clean vX.Y.Z).
  const core = raw.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  const parts = core.split('.');
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return [nums[0] as number, nums[1] as number, nums[2] as number];
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

/** A populated "up to date" result (no update available), used for the 404 / malformed-tag cases. */
function upToDate(currentVersion: string, now: string): UpdateCheckResult {
  const current = currentVersion.replace(/^v/i, '');
  return {
    current,
    latest: current,
    isUpdateAvailable: false,
    releaseUrl: RELEASES_PAGE_URL,
    checkedAt: now,
  };
}

export async function checkForUpdate(
  options: CheckForUpdateOptions,
): Promise<UpdateCheckResult | null> {
  const { fetch: fetchImpl, currentVersion, now } = options;
  const current = currentVersion.replace(/^v/i, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(RELEASES_LATEST_URL, {
      signal: controller.signal,
      headers: {
        // GitHub requires a descriptive User-Agent for API calls; no auth (the repo is public).
        'User-Agent': `SelfOS/${current}`,
        Accept: 'application/vnd.github+json',
      },
    });
  } catch {
    // Offline / DNS failure / timeout (abort) → couldn't check (§7). Keep cached state.
    return null;
  } finally {
    clearTimeout(timer);
  }

  // No releases yet (or only drafts/prereleases — `/releases/latest` excludes those) → treat as up to date.
  if (response.status === 404) return upToDate(current, now);
  // Rate-limited (403) or any other non-OK → couldn't check; rely on cached state (§7).
  if (!response.ok) return null;

  let release: z.infer<typeof GithubReleaseSchema>;
  try {
    release = GithubReleaseSchema.parse(await response.json());
  } catch {
    // Unexpected/unparseable body → couldn't check (don't crash).
    return null;
  }

  const latestParsed = parseSemver(release.tag_name);
  const currentParsed = parseSemver(current);
  // A malformed latest tag → ignore that release (treat as up to date); a malformed running version
  // (shouldn't happen) is conservatively treated as "no update" so we never falsely nag.
  if (!latestParsed || !currentParsed) return upToDate(current, now);

  const latest = release.tag_name.trim().replace(/^v/i, '');
  return {
    current,
    latest,
    isUpdateAvailable: compareSemver(latestParsed, currentParsed) > 0,
    releaseUrl: release.html_url ?? RELEASES_PAGE_URL,
    ...(release.published_at ? { publishedAt: release.published_at } : {}),
    checkedAt: now,
  };
}

export { UpdateCheckResultSchema };
export type { UpdateCheckResult };
