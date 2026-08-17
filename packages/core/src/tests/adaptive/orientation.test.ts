import { describe, expect, it } from 'vitest';

import { DIRTY_TALK_BANK } from './instruments/dirtyTalkBank';
import { bankEntry } from './bank';
import {
  OPEN_ORIENTATION,
  addressFromAnswer,
  bodyFromAnatomyAnswer,
  orientArea,
  shownSides,
  type Orientation,
} from './orientation';

/**
 * 74 §3.6.3 — the orientation resolver. Everything here fails OPEN: an unknown answer must widen what is
 * shown, never narrow it, because a silently thinner test is the failure §3.6.5 exists to prevent.
 */

const STRAIGHT_MAN: Orientation = {
  selfAddress: 'man',
  partnerAddress: 'girl',
  selfBody: 'penis',
  partnerBody: 'vulva',
};

const entry = (key: string) => bankEntry(DIRTY_TALK_BANK, key)!;

describe('orientation', () => {
  it('maps the intake ANSWER LABELS, and anything non-committal fails open', () => {
    expect(bodyFromAnatomyAnswer('Cock (penis)')).toBe('penis');
    expect(bodyFromAnatomyAnswer('Pussy (vulva)')).toBe('vulva');
    expect(bodyFromAnatomyAnswer('Both or intersex')).toBe('either');
    expect(bodyFromAnatomyAnswer('Rather not say')).toBe('either');
    expect(bodyFromAnatomyAnswer("Don't mind")).toBe('either');
    expect(bodyFromAnatomyAnswer(undefined)).toBe('either');
    expect(bodyFromAnatomyAnswer('some future relabel')).toBe('either');
    expect(addressFromAnswer('girl')).toBe('girl');
    expect(addressFromAnswer('man')).toBe('man');
    expect(addressFromAnswer(undefined)).toBe('either');
  });

  it('shows an untagged entry on both sides for everyone', () => {
    const base = entry('claiming:mine');
    const universal = { ...base };
    delete universal.addresses;
    delete universal.body;
    expect(shownSides(universal, STRAIGHT_MAN)).toEqual(['hear', 'say']);
  });

  it('puts a line aimed at a girl on the SAY side for a straight man, and never the hear side', () => {
    const e = { ...entry('claiming:mine'), addresses: 'girl' as const };
    expect(shownSides(e, STRAIGHT_MAN)).toEqual(['say']);
  });

  it('puts a line about his own body on the HEAR side only', () => {
    const e = { ...entry('claiming:mine'), body: 'penis' as const, addresses: 'man' as const };
    expect(shownSides(e, STRAIGHT_MAN)).toEqual(['hear']);
  });

  it('WITHHOLDS what reaches neither of them', () => {
    // Addressed to a man, about a vulva: neither he nor she is on either side of that line.
    const e = { ...entry('claiming:mine'), addresses: 'man' as const, body: 'vulva' as const };
    expect(shownSides(e, STRAIGHT_MAN)).toEqual([]);
  });

  it('an `either/either` person is shown everything, on both sides', () => {
    const e = { ...entry('claiming:mine'), addresses: 'girl' as const, body: 'vulva' as const };
    expect(shownSides(e, OPEN_ORIENTATION)).toEqual(['hear', 'say']);
  });

  it('never withholds when the person declined to answer — an unknown axis widens', () => {
    const declined: Orientation = { ...STRAIGHT_MAN, selfBody: 'either', selfAddress: 'either' };
    const e = { ...entry('claiming:mine'), addresses: 'man' as const, body: 'vulva' as const };
    expect(shownSides(e, declined)).toEqual(['hear']);
  });

  it("respects an entry's own directions — orientation can only ever narrow, never widen", () => {
    const hearOnly = { ...entry('claiming:mine'), directions: ['hear'] as const };
    expect(shownSides(hearOnly, OPEN_ORIENTATION)).toEqual(['hear']);
  });

  it('accounts for every entry: shown + withheld === the area total', () => {
    const all = DIRTY_TALK_BANK.entries.filter((e) => e.family === 'anatomy-her');
    const area = orientArea('anatomy-her', all, STRAIGHT_MAN);
    expect(area.shown.length + area.withheld).toBe(all.length);
    expect(all.length).toBeGreaterThan(0);
  });
});
