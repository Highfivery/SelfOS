// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from './pin';

describe('pin', () => {
  it('verifies a correct pin', async () => {
    expect(await verifyPin('1234', await hashPin('1234'))).toBe(true);
  });

  it('rejects a wrong pin', async () => {
    expect(await verifyPin('0000', await hashPin('1234'))).toBe(false);
  });

  it('rejects a malformed stored value', async () => {
    expect(await verifyPin('1234', 'garbage')).toBe(false);
  });

  it('uses a fresh salt each time', async () => {
    expect(await hashPin('1234')).not.toBe(await hashPin('1234'));
  });
});
