import { describe, expect, it } from 'vitest';
import { WRAP_UP_MARKER, stripWrapUpMarker } from './wrapUp';

describe('stripWrapUpMarker', () => {
  it('removes the full marker and trailing whitespace', () => {
    expect(stripWrapUpMarker(`All done here.\n\n${WRAP_UP_MARKER}`)).toBe('All done here.');
  });

  it('removes a trailing partial marker still mid-stream', () => {
    expect(stripWrapUpMarker('Take care. [[SELFOS:WR')).toBe('Take care.');
    expect(stripWrapUpMarker('Take care. [[')).toBe('Take care.');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripWrapUpMarker('Just a normal reply.')).toBe('Just a normal reply.');
  });
});
