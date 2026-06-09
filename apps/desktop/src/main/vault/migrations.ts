/**
 * Generic schema-migration runner (00-architecture §4.4). Each persisted file carries a
 * `schemaVersion`; on read we run ordered migration steps up to the current version, then validate
 * with Zod. There are no real migrations yet (everything is v1), but the framework and registries
 * exist so later format changes are a matter of adding one step.
 */
export interface MigrationSet {
  /** The current/latest schema version for this file type. */
  latest: number;
  /** `steps[n]` migrates data from version `n` to `n + 1` and must set `schemaVersion = n + 1`. */
  steps: Record<number, (data: unknown) => unknown>;
}

function readVersion(data: unknown): number {
  if (typeof data === 'object' && data !== null && 'schemaVersion' in data) {
    const value = (data as { schemaVersion: unknown }).schemaVersion;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  }
  return 1;
}

/** Run migrations from the data's `schemaVersion` up to `set.latest`. Throws on a missing step. */
export function migrate(raw: unknown, set: MigrationSet): unknown {
  let version = readVersion(raw);
  let data = raw;
  while (version < set.latest) {
    const step = set.steps[version];
    if (!step) throw new Error(`No migration step from schema version ${version}`);
    data = step(data);
    version += 1;
  }
  return data;
}
