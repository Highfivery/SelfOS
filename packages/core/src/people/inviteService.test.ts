import { beforeEach, describe, expect, it } from 'vitest';
import { memFileSystem } from '../host/memFileSystem';
import { generateMasterKey } from '../crypto';
import { toBase64 } from '../encoding';
import {
  cancelInvite,
  createInvite,
  generateInviteCode,
  listInvitesForPerson,
  redeemInvite,
} from './inviteService';

const KEY = generateMasterKey();
const T0 = 1_700_000_000_000; // a fixed "now"
const DAY = 24 * 60 * 60 * 1000;

let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

describe('invite codes', () => {
  it('generates a 6-word dash-joined phrase', () => {
    const code = generateInviteCode();
    expect(code.split('-')).toHaveLength(6);
    expect(code).toMatch(/^[a-z]+(-[a-z]+){5}$/);
  });

  it('round-trips: create → redeem returns the same master key + personId, then is single-use', async () => {
    const { code, invite } = await createInvite(fs, KEY, 'wife-1', T0);
    expect(invite.personId).toBe('wife-1');

    const redeemed = await redeemInvite(fs, code, T0 + DAY);
    expect(redeemed).not.toBeNull();
    expect(redeemed && toBase64(redeemed.masterKey)).toBe(toBase64(KEY));
    expect(redeemed?.personId).toBe('wife-1');

    // Single-use: the invite file is gone, so a replay fails.
    expect(await redeemInvite(fs, code, T0 + DAY)).toBeNull();
  });

  it('is case- and separator-insensitive on redeem', async () => {
    const { code } = await createInvite(fs, KEY, 'wife-1', T0);
    const messy = code.toUpperCase().replace(/-/g, ' ');
    const redeemed = await redeemInvite(fs, messy, T0);
    expect(redeemed && toBase64(redeemed.masterKey)).toBe(toBase64(KEY));
  });

  it('rejects a wrong code without consuming the invite', async () => {
    await createInvite(fs, KEY, 'wife-1', T0);
    expect(await redeemInvite(fs, 'amber-amber-amber-amber-amber-amber', T0)).toBeNull();
    // The real code still works afterward (the wrong attempt didn't delete it).
    expect(await listInvitesForPerson(fs, 'wife-1', T0)).toHaveLength(1);
  });

  it('expires after 7 days (redeem returns null and the file is GC’d)', async () => {
    const { code } = await createInvite(fs, KEY, 'wife-1', T0);
    expect(await redeemInvite(fs, code, T0 + 8 * DAY)).toBeNull();
    expect(await listInvitesForPerson(fs, 'wife-1', T0 + 8 * DAY)).toHaveLength(0);
  });

  it('lists pending invites per person and cancels by id', async () => {
    const a = await createInvite(fs, KEY, 'wife-1', T0);
    await createInvite(fs, KEY, 'kid-1', T0);
    expect(await listInvitesForPerson(fs, 'wife-1', T0)).toHaveLength(1);

    await cancelInvite(fs, a.invite.id);
    expect(await listInvitesForPerson(fs, 'wife-1', T0)).toHaveLength(0);
    expect(await listInvitesForPerson(fs, 'kid-1', T0)).toHaveLength(1);
  });

  it('writes a key-free-readable file with no plaintext master key', async () => {
    const { invite } = await createInvite(fs, KEY, 'wife-1', T0);
    const bytes = await fs.read(`config/invites/${invite.id}.enc`);
    expect(bytes).not.toBeNull();
    const onDisk = new TextDecoder().decode(bytes ?? new Uint8Array());
    expect(onDisk).toContain('"wrapped"'); // the wrapped (encrypted) key
    expect(onDisk).toContain('"personId": "wife-1"'); // metadata is plaintext (no key needed to read)
    expect(onDisk).not.toContain(toBase64(KEY)); // the raw master key never appears
  });
});
