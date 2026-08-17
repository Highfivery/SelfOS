import { describe, expect, it } from 'vitest';

import { DIRTY_TALK_BANK } from './instruments/dirtyTalkBank';
import { bankEntry, type BankEntry } from './bank';
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

/**
 * A real bank entry, or a loud failure. This was `bankEntry(...)!`, so retiring a term left every fixture
 * holding `undefined` and the suite failed six tests deep inside the resolver with "cannot read 'includes'"
 * instead of naming the key that had gone (CLAUDE.md §4 — never `!` to silence).
 */
const entry = (key: string): BankEntry => {
  const found = bankEntry(DIRTY_TALK_BANK, key);
  if (!found) throw new Error(`no such bank entry: ${key}`);
  return found;
};

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
    const base = entry('claiming:you-re-mine');
    const universal = { ...base };
    delete universal.addresses;
    delete universal.body;
    expect(shownSides(universal, STRAIGHT_MAN)).toEqual(['hear', 'say']);
  });

  it('puts a line aimed at a girl on the SAY side for a straight man, and never the hear side', () => {
    const e = { ...entry('claiming:you-re-mine'), addresses: 'girl' as const };
    expect(shownSides(e, STRAIGHT_MAN)).toEqual(['say']);
  });

  it('puts a line about his own body on the HEAR side only', () => {
    const e = {
      ...entry('claiming:you-re-mine'),
      body: 'penis' as const,
      addresses: 'man' as const,
    };
    expect(shownSides(e, STRAIGHT_MAN)).toEqual(['hear']);
  });

  it('WITHHOLDS what reaches neither of them', () => {
    // Addressed to a man, about a vulva: neither he nor she is on either side of that line.
    const e = {
      ...entry('claiming:you-re-mine'),
      addresses: 'man' as const,
      body: 'vulva' as const,
    };
    expect(shownSides(e, STRAIGHT_MAN)).toEqual([]);
  });

  it('an `either/either` person is shown everything, on both sides', () => {
    const e = {
      ...entry('claiming:you-re-mine'),
      addresses: 'girl' as const,
      body: 'vulva' as const,
    };
    expect(shownSides(e, OPEN_ORIENTATION)).toEqual(['hear', 'say']);
  });

  it('never withholds when the person declined to answer — an unknown axis widens', () => {
    const declined: Orientation = { ...STRAIGHT_MAN, selfBody: 'either', selfAddress: 'either' };
    const e = {
      ...entry('claiming:you-re-mine'),
      addresses: 'man' as const,
      body: 'vulva' as const,
    };
    expect(shownSides(e, declined)).toEqual(['hear']);
  });

  it("respects an entry's own directions — orientation can only ever narrow, never widen", () => {
    const hearOnly = { ...entry('claiming:you-re-mine'), directions: ['hear'] as const };
    expect(shownSides(hearOnly, OPEN_ORIENTATION)).toEqual(['hear']);
  });

  it('accounts for every entry: shown + withheld === the area total', () => {
    const all = DIRTY_TALK_BANK.entries.filter((e) => e.family === 'anatomy-her');
    const area = orientArea('anatomy-her', all, STRAIGHT_MAN);
    expect(area.shown.length + area.withheld).toBe(all.length);
    expect(all.length).toBeGreaterThan(0);
  });
});
describe('§3.6.3 — the body axis has a fallback, so it no longer fails open into nonsense', () => {
  it('uses the identity taps when onboarding never asked about anatomy', () => {
    // This is the reported bug: with no intake answer both bodies resolved to `either`, so a straight man was
    // shown "your pussy is so wet for me" as a line to HEAR. The intake answer still wins where it exists.
    expect(bodyFromAnatomyAnswer(undefined, 'man')).toBe('penis');
    expect(bodyFromAnatomyAnswer(undefined, 'woman')).toBe('vulva');
    expect(bodyFromAnatomyAnswer('', 'woman')).toBe('vulva');
    expect(bodyFromAnatomyAnswer(undefined, 'either')).toBe('either');
    expect(bodyFromAnatomyAnswer(undefined)).toBe('either');
  });

  it('never lets identity override what they actually told onboarding', () => {
    // #62's rule: body comes from the direct answer, never from an inference about gender.
    expect(bodyFromAnatomyAnswer('Pussy (vulva)', 'man')).toBe('vulva');
    expect(bodyFromAnatomyAnswer('Cock (penis)', 'woman')).toBe('penis');
    // An explicit non-committal answer is an ANSWER — identity must not quietly narrow it.
    expect(bodyFromAnatomyAnswer('Rather not say', 'man')).toBe('either');
    expect(bodyFromAnatomyAnswer('Both or intersex', 'woman')).toBe('either');
  });

  it('a straight man with no onboarding answer hears about his body and says lines about hers', () => {
    const who = {
      selfAddress: 'man' as const,
      partnerAddress: 'girl' as const,
      selfBody: bodyFromAnatomyAnswer(undefined, 'man'),
      partnerBody: bodyFromAnatomyAnswer(undefined, 'woman'),
    };
    const hers: BankEntry = {
      key: 'anatomy-her:pussy',
      text: 'pussy',
      kind: 'word',
      family: 'anatomy-her',
      tier: 3,
      directions: ['hear', 'say'],
      body: 'vulva',
    };
    const his: BankEntry = { ...hers, key: 'anatomy-him:cock', text: 'cock', body: 'penis' };
    expect(shownSides(hers, who)).toEqual(['say']);
    expect(shownSides(his, who)).toEqual(['hear']);
  });
});
