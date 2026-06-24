import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  aiFailureMessage,
  classifyParseFailure,
  classifyParseOutcome,
  extractJsonArray,
  extractJsonObject,
  salvageJsonArray,
  salvageJsonObjectArrayField,
  salvageJsonObjectField,
  tolerantArray,
} from './jsonSalvage';

describe('extractJsonObject', () => {
  it('pulls a fenced object out of surrounding prose', () => {
    expect(extractJsonObject('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('handles nested braces', () => {
    expect(extractJsonObject('{"a":{"b":2},"c":[1,2]}')).toEqual({ a: { b: 2 }, c: [1, 2] });
  });
  it('returns null when there is no object (never throws)', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{ truncated "a":')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('extractJsonArray', () => {
  it('pulls a fenced array out of prose', () => {
    expect(extractJsonArray('Here:\n```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });
  it('returns null when there is no array', () => {
    expect(extractJsonArray('no array here')).toBeNull();
    expect(extractJsonArray('[{"a":1},')).toBeNull(); // unbalanced
  });
});

describe('salvageJsonArray', () => {
  it('keeps the complete elements of a truncated array (skips the cut-off trailing one)', () => {
    const text = '[{"id":"a"},{"id":"b"},{"id":"c';
    expect(salvageJsonArray(text)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
  it('skips a malformed middle element but keeps the rest', () => {
    // The middle object has an unparseable value; the scanner only emits objects that JSON.parse cleanly.
    const text = '[{"id":"a"},{"id":},{"id":"c"}]';
    expect(salvageJsonArray(text)).toEqual([{ id: 'a' }, { id: 'c' }]);
  });
  it('returns the full array when complete', () => {
    expect(salvageJsonArray('[{"id":"a"},{"id":"b"}]')).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
  it('returns [] when the array never opens', () => {
    expect(salvageJsonArray('cut off before the array')).toEqual([]);
  });
  it('is string-aware: a "}" inside a string does not close an element', () => {
    expect(salvageJsonArray('[{"t":"a } b"},{"t":"c"}]')).toEqual([{ t: 'a } b' }, { t: 'c' }]);
  });
});

describe('salvageJsonObjectField', () => {
  it('recovers a leading string field from a truncated object', () => {
    const text = '{"summary":"All good here","facts":[{"text":"incomp';
    expect(salvageJsonObjectField(text, 'summary')).toBe('All good here');
  });
  it('decodes escaped characters in the value', () => {
    expect(salvageJsonObjectField('{"summary":"line \\"quote\\" end"', 'summary')).toBe(
      'line "quote" end',
    );
  });
  it('returns null when the field never appeared', () => {
    expect(salvageJsonObjectField('{"other":"x"}', 'summary')).toBeNull();
  });
});

describe('salvageJsonObjectArrayField', () => {
  it('recovers complete objects of a named array field inside a truncated object', () => {
    const text = '{"portrait":"hi","facts":[{"text":"one"},{"text":"two"},{"text":"thr';
    expect(salvageJsonObjectArrayField(text, 'facts')).toEqual([{ text: 'one' }, { text: 'two' }]);
  });
  it('returns [] when the field is absent', () => {
    expect(salvageJsonObjectArrayField('{"portrait":"hi"}', 'facts')).toEqual([]);
  });
});

describe('tolerantArray', () => {
  const element = z.object({ id: z.string().min(1) });
  const schema = tolerantArray(element, { id: '' }, (v) => v.id.trim() !== '');

  it('drops a bad element and keeps the good ones', () => {
    expect(schema.parse([{ id: 'a' }, { nope: 1 }, { id: 'c' }])).toEqual([
      { id: 'a' },
      { id: 'c' },
    ]);
  });
  it('passes all-good through unchanged', () => {
    expect(schema.parse([{ id: 'a' }, { id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
  it('returns [] when every element is bad', () => {
    expect(schema.parse([{ nope: 1 }, 42, null])).toEqual([]);
  });
  it('returns [] when the input is not an array', () => {
    expect(schema.parse('not an array')).toEqual([]);
  });
});

describe('classifyParseFailure', () => {
  it('classifies an empty reply as TRUNCATED (token starvation, §17.9)', () => {
    expect(classifyParseFailure('')).toBe('TRUNCATED');
    expect(classifyParseFailure('   \n ')).toBe('TRUNCATED');
  });
  it('classifies an unclosed structure as TRUNCATED', () => {
    expect(classifyParseFailure('{"a":1,"b":[1,2')).toBe('TRUNCATED');
    expect(classifyParseFailure('here you go: [{"x":1}')).toBe('TRUNCATED');
  });
  it('classifies refusal-shaped prose (no JSON) as REFUSED', () => {
    expect(classifyParseFailure('I cannot help with that request.')).toBe('REFUSED');
    expect(classifyParseFailure("I'm not able to write this one.")).toBe('REFUSED');
  });
  it('classifies balanced-but-unusable junk as MALFORMED', () => {
    expect(classifyParseFailure('no json here, just prose')).toBe('MALFORMED');
    expect(classifyParseFailure('{"complete":"but wrong shape"}')).toBe('MALFORMED');
  });
  it('prefers TRUNCATED over REFUSED for a cut-off reply that happens to contain a marker', () => {
    // never-assume-a-refusal: an unclosed structure is a truncation even if the prose hints otherwise.
    expect(classifyParseFailure('{"note":"i cannot..." [1,2')).toBe('TRUNCATED');
  });
});

describe('aiFailureMessage + classifyParseOutcome', () => {
  it('builds calm, no-data-blame messages with the surface noun', () => {
    expect(aiFailureMessage('TRUNCATED', 'suggestion set')).toBe(
      'The suggestion set was cut off before it finished. Please try again.',
    );
    expect(aiFailureMessage('MALFORMED', 'analysis')).toBe(
      'The analysis came back in an unexpected shape. Please try again.',
    );
    expect(aiFailureMessage('REFUSED', 'draft')).toBe('The AI couldn’t help with this one.');
  });
  it('never blames the user’s data', () => {
    for (const reason of ['TRUNCATED', 'MALFORMED', 'REFUSED'] as const) {
      expect(aiFailureMessage(reason, 'suggestion set')).not.toMatch(
        /add more|your data|your brief/i,
      );
    }
  });
  it('classifyParseOutcome returns the reason + its message together', () => {
    expect(classifyParseOutcome('', 'portrait')).toEqual({
      reason: 'TRUNCATED',
      message: 'The portrait was cut off before it finished. Please try again.',
    });
  });
});
