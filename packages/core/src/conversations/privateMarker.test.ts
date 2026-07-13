import { describe, expect, it } from 'vitest';
import { parsePrivateMarker, stripPrivateMarker } from './privateMarker';
import { stripCoachMarkers } from './guidedSteps';

describe('private clarification marker (58 §3.14 Part B)', () => {
  it('parses the latest well-formed marker', () => {
    const text =
      'Thanks for sharing that. [[SELFOS:PRIVATE:{"to":"Angel","text":"How are you feeling about this, just between us?"}]]';
    expect(parsePrivateMarker(text)).toEqual({
      to: 'Angel',
      text: 'How are you feeling about this, just between us?',
    });
  });

  it('takes the last marker when several are present', () => {
    const text =
      '[[SELFOS:PRIVATE:{"to":"Ben","text":"first"}]] [[SELFOS:PRIVATE:{"to":"Angel","text":"second"}]]';
    expect(parsePrivateMarker(text)).toEqual({ to: 'Angel', text: 'second' });
  });

  it('returns null for a malformed, empty, or missing marker (tolerant)', () => {
    expect(parsePrivateMarker('no marker here')).toBeNull();
    expect(parsePrivateMarker('[[SELFOS:PRIVATE:{not json}]]')).toBeNull();
    expect(parsePrivateMarker('[[SELFOS:PRIVATE:{"to":"","text":"hi"}]]')).toBeNull();
    expect(parsePrivateMarker('[[SELFOS:PRIVATE:{"to":"Ben","text":""}]]')).toBeNull();
    expect(parsePrivateMarker('[[SELFOS:PRIVATE:{"to":"Ben"}]]')).toBeNull();
  });

  it('strips the marker (and mid-stream partials) from the visible reply', () => {
    expect(stripPrivateMarker('Hello. [[SELFOS:PRIVATE:{"to":"Ben","text":"hi"}]]')).toBe('Hello.');
    // Mid-stream partial: body without the closing ]].
    expect(stripPrivateMarker('Hello. [[SELFOS:PRIVATE:{"to":"Ben"')).toBe('Hello.');
    // A trailing partial of the prefix itself.
    expect(stripPrivateMarker('Hello. [[SELFOS:PRIV')).toBe('Hello.');
  });

  it('is removed by the shared stripCoachMarkers (so the token never shows in any surface)', () => {
    expect(
      stripCoachMarkers('Take care. [[SELFOS:PRIVATE:{"to":"Angel","text":"checking in"}]]'),
    ).toBe('Take care.');
    // Alongside the other markers.
    expect(
      stripCoachMarkers(
        'Bye. [[SELFOS:WRAPUP]] [[SELFOS:PRIVATE:{"to":"Ben","text":"one thing"}]]',
      ),
    ).toBe('Bye.');
  });
});
