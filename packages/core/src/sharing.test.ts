import { describe, expect, it } from 'vitest';
import { confidentialityPreamble, describeScope } from './sharing';

describe('describeScope (42 §3.2)', () => {
  it('empty scope → Private', () => {
    expect(describeScope([])).toBe('Private');
  });

  it('one type → its label', () => {
    expect(describeScope(['partner'])).toBe('Partner');
  });

  it('multiple types → joined in stable display order, de-duped', () => {
    expect(describeScope(['friend', 'partner', 'partner'])).toBe('Partner, Friend');
  });
});

describe('confidentialityPreamble (42 §3.4)', () => {
  it('names the supported person and forbids quoting/attributing/revealing', () => {
    const text = confidentialityPreamble('Bri');
    expect(text).toContain('Bri');
    expect(text).toMatch(/never quote them/i);
    expect(text).toMatch(/name who shared them/i);
    expect(text).toMatch(/don't share/i);
  });

  it('falls back to a neutral name when none is given', () => {
    expect(confidentialityPreamble('')).toContain('this person');
  });
});
