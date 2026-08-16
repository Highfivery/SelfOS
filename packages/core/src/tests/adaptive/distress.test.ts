import { describe, expect, it } from 'vitest';

import { readsAsDistress, takeCarriesDistress } from './distress';

describe('the safety carve-out (74 §8.3/§8.4)', () => {
  it('reads a real-world disclosure as distress, not as material', () => {
    expect(readsAsDistress('my ex raped me and I still freeze')).toBe(true);
    expect(readsAsDistress("I'm scared of him when he drinks")).toBe(true);
  });

  it('does NOT flag the pre-agreed roleplay this test exists to map', () => {
    expect(readsAsDistress('I like "rape me" as a roleplay line, with a safeword')).toBe(false);
    expect(readsAsDistress('choke me, hold me down, I want it rough')).toBe(false);
  });

  it('flags the take when any free-text turn carries a disclosure', () => {
    expect(
      takeCarriesDistress([{ answer: 'good girl works' }, { answer: 'I was assaulted at 19' }]),
    ).toBe(true);
    expect(takeCarriesDistress([{ answer: 'good girl works' }])).toBe(false);
    expect(takeCarriesDistress(undefined)).toBe(false);
  });
});
