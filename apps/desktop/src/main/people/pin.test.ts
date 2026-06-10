// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from './pin';

describe('pin', () => {
  it('verifies a correct pin', () => {
    expect(verifyPin('1234', hashPin('1234'))).toBe(true);
  });

  it('rejects a wrong pin', () => {
    expect(verifyPin('0000', hashPin('1234'))).toBe(false);
  });

  it('rejects a malformed stored value', () => {
    expect(verifyPin('1234', 'garbage')).toBe(false);
  });

  it('uses a fresh salt each time', () => {
    expect(hashPin('1234')).not.toBe(hashPin('1234'));
  });
});
