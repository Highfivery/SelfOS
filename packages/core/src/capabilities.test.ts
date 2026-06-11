import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CAPABILITY_LABELS, DEFAULT_ROLES, roleAllows } from './capabilities';
import type { Role } from './schemas';

describe('roleAllows', () => {
  it('grants the Owner every capability', () => {
    const owner = DEFAULT_ROLES.find((role) => role.id === 'owner')!;
    expect(roleAllows(owner, 'budgets.manage')).toBe(true);
    expect(roleAllows(owner, 'people.manage')).toBe(true);
    expect(roleAllows(owner, 'sessions.own')).toBe(true);
  });

  it('grants the Owner capabilities even when missing from a stale stored map', () => {
    // Simulates a vault persisted before `budgets.manage` (or any future capability) existed.
    const staleOwner: Role = { id: 'owner', name: 'Owner', builtin: true, capabilities: {} };
    expect(roleAllows(staleOwner, 'budgets.manage')).toBe(true);
    expect(roleAllows(staleOwner, 'roles.manage')).toBe(true);
  });

  it('checks the stored map for non-owner roles', () => {
    const member: Role = {
      id: 'member',
      name: 'Member',
      builtin: true,
      capabilities: { 'sessions.own': true },
    };
    expect(roleAllows(member, 'sessions.own')).toBe(true);
    expect(roleAllows(member, 'budgets.manage')).toBe(false);
  });

  it('denies when there is no role', () => {
    expect(roleAllows(undefined, 'budgets.manage')).toBe(false);
  });
});

describe('dreams capabilities (12-dreams)', () => {
  const owner = DEFAULT_ROLES.find((role) => role.id === 'owner')!;
  const member = DEFAULT_ROLES.find((role) => role.id === 'member')!;
  const guest = DEFAULT_ROLES.find((role) => role.id === 'guest')!;

  it('registers dreams.own and dreams.shareContext with labels', () => {
    expect(CAPABILITIES).toContain('dreams.own');
    expect(CAPABILITIES).toContain('dreams.shareContext');
    expect(CAPABILITY_LABELS['dreams.own']).toBeTruthy();
    expect(CAPABILITY_LABELS['dreams.shareContext']).toBeTruthy();
  });

  it('grants both to Owner and Member by default, but not Guest', () => {
    expect(roleAllows(owner, 'dreams.own')).toBe(true);
    expect(roleAllows(member, 'dreams.own')).toBe(true);
    expect(roleAllows(member, 'dreams.shareContext')).toBe(true);
    expect(roleAllows(guest, 'dreams.own')).toBe(false);
    expect(roleAllows(guest, 'dreams.shareContext')).toBe(false);
  });
});
