// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { isSuperAdminActive, setSuperAdminActive } from './superAdmin';

afterEach(() => setSuperAdminActive(false));

describe('super-admin inspect state', () => {
  it('defaults to inactive and toggles in memory', () => {
    expect(isSuperAdminActive()).toBe(false);
    setSuperAdminActive(true);
    expect(isSuperAdminActive()).toBe(true);
    setSuperAdminActive(false);
    expect(isSuperAdminActive()).toBe(false);
  });
});
