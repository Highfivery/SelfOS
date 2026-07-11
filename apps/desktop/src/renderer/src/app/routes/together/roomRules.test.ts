import { describe, expect, it } from 'vitest';
import { TOGETHER_FRAME_LINE, roomRules } from './roomRules';

describe('roomRules (58 §3.4/§8.7)', () => {
  const rules = roomRules('Angel');

  it('derives the five rules of the room, naming the partner', () => {
    expect(rules).toHaveLength(5);
    expect(rules.map((r) => r.title)).toEqual([
      'You both see the conversation.',
      'The coach knows you both.',
      'Private notes exist.',
      'Nothing new is shared between you.',
      'You can step away.',
    ]);
    expect(rules.some((r) => r.body.includes('Angel'))).toBe(true);
  });

  it('the copy is MECHANICAL, never absolute (§8.7) — no "never revealed"/"only the coach will ever see"', () => {
    const all = [...rules.map((r) => `${r.title} ${r.body}`), TOGETHER_FRAME_LINE]
      .join(' ')
      .toLowerCase();
    expect(all).not.toContain('never revealed');
    expect(all).not.toContain('only the coach will ever see');
    // …and it uses the mechanical phrasings.
    expect(all).toContain('designed never to quote');
    expect(all).toContain("doesn't appear in the shared conversation");
  });

  it('discloses no owner/admin access (the durable rule)', () => {
    const all = rules
      .map((r) => r.body)
      .join(' ')
      .toLowerCase();
    expect(all).not.toContain('owner');
    expect(all).not.toContain('admin');
  });

  it('the frame line is not-therapy (§8.1)', () => {
    expect(TOGETHER_FRAME_LINE.toLowerCase()).toContain('not therapy');
  });
});
