import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  DEFAULT_ROLES,
  EXPLICIT_GRANT_ONLY,
  reconcileRole,
  roleAllows,
} from './capabilities';
import type { Role } from './schemas';

describe('reconcileRole', () => {
  it('adds a capability missing from a stale built-in role map (existing Member gains intake.own)', () => {
    // A Member role frozen before `intake.own` existed — its stored map lacks the key.
    const staleMember: Role = {
      id: 'member',
      name: 'Member',
      builtin: true,
      capabilities: { 'sessions.own': true }, // no intake.own
    };
    expect(roleAllows(staleMember, 'intake.own')).toBe(false); // before reconcile: denied
    const reconciled = reconcileRole(staleMember);
    expect(roleAllows(reconciled, 'intake.own')).toBe(true); // after reconcile: the default (on) applies
  });

  it('preserves an explicit toggle-off (does not re-enable a deliberately disabled default)', () => {
    const member: Role = {
      id: 'member',
      name: 'Member',
      builtin: true,
      capabilities: { 'dreams.own': false }, // explicitly turned off
    };
    expect(reconcileRole(member).capabilities['dreams.own']).toBe(false);
  });

  it('leaves custom (non-built-in) roles untouched', () => {
    const custom: Role = { id: 'helper', name: 'Helper', builtin: false, capabilities: {} };
    expect(reconcileRole(custom)).toBe(custom);
  });
});

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

  it('grants explicit-grant-only capabilities to the Owner (full-access role, super-admin removed)', () => {
    const owner = DEFAULT_ROLES.find((role) => role.id === 'owner')!;
    expect(EXPLICIT_GRANT_ONLY.has('questionnaires.readRaw')).toBe(true);
    // The Owner is the full-access role — it has the break-glass capabilities too.
    expect(roleAllows(owner, 'questionnaires.readRaw')).toBe(true);
    expect(roleAllows(owner, 'intake.readRestricted')).toBe(true);
  });

  it('keeps explicit-grant-only capabilities OFF for a non-owner role until the stored map turns it on', () => {
    // A plain member does NOT get readRaw by default.
    const member = DEFAULT_ROLES.find((role) => role.id === 'member')!;
    expect(roleAllows(member, 'questionnaires.readRaw')).toBe(false);
    // A member who is granted it explicitly does.
    const granted: Role = {
      id: 'member',
      name: 'Member',
      builtin: true,
      capabilities: { 'questionnaires.readRaw': true },
    };
    expect(roleAllows(granted, 'questionnaires.readRaw')).toBe(true);
  });

  it('registers questionnaires.readRaw with a label', () => {
    expect(CAPABILITIES).toContain('questionnaires.readRaw');
    expect(CAPABILITY_LABELS['questionnaires.readRaw']).toContain('break-glass');
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
