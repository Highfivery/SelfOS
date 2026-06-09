// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { migrate, type MigrationSet } from './migrations';

const setV3: MigrationSet = {
  latest: 3,
  steps: {
    1: (d) => ({ ...(d as object), schemaVersion: 2, added: true }),
    2: (d) => ({ ...(d as object), schemaVersion: 3, more: 1 }),
  },
};

describe('migrate', () => {
  it('runs every step from the data version to latest', () => {
    const result = migrate({ schemaVersion: 1, name: 'x' }, setV3);
    expect(result).toEqual({ schemaVersion: 3, name: 'x', added: true, more: 1 });
  });

  it('is a no-op when already at the latest version', () => {
    const data = { schemaVersion: 3 };
    expect(migrate(data, setV3)).toBe(data);
  });

  it('treats missing schemaVersion as version 1', () => {
    const result = migrate({ name: 'x' }, setV3) as { schemaVersion: number };
    expect(result.schemaVersion).toBe(3);
  });

  it('throws when a step is missing', () => {
    const broken: MigrationSet = { latest: 2, steps: {} };
    expect(() => migrate({ schemaVersion: 1 }, broken)).toThrow(/No migration step/);
  });
});
