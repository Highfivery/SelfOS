import { describe, expect, it } from 'vitest';
import {
  buildStepInstruction,
  parseChallengeMarker,
  parseLatestStep,
  stripChallengeMarker,
  stripCoachMarkers,
  stripStepMarkers,
} from './guidedSteps';

describe('guided step markers', () => {
  it('parses the latest declared step', () => {
    expect(parseLatestStep('Working on it. [[SELFOS:STEP:2]]')).toBe(2);
    // Last marker wins if several appear.
    expect(parseLatestStep('[[SELFOS:STEP:0]] then [[SELFOS:STEP:3]]')).toBe(3);
    expect(parseLatestStep('no marker here')).toBeNull();
  });

  it('strips complete and partial step markers (no flash mid-stream)', () => {
    expect(stripStepMarkers('Done. [[SELFOS:STEP:1]]')).toBe('Done.');
    expect(stripStepMarkers('Done. [[SELFOS:STEP:1')).toBe('Done.');
    expect(stripStepMarkers('Done. [[SELFOS:STE')).toBe('Done.');
    expect(stripStepMarkers('plain text')).toBe('plain text');
  });

  it('stripCoachMarkers removes both wrap-up and step markers', () => {
    expect(stripCoachMarkers('Bye. [[SELFOS:WRAPUP]] [[SELFOS:STEP:4]]')).toBe('Bye.');
    expect(stripCoachMarkers('Bye. [[SELFOS:WRAPUP]]')).toBe('Bye.');
  });

  it('buildStepInstruction lists the 0-based steps and the marker convention', () => {
    const instruction = buildStepInstruction(['Goal', 'Reality']);
    expect(instruction).toContain('0. Goal');
    expect(instruction).toContain('1. Reality');
    expect(instruction).toContain('[[SELFOS:STEP:n]]');
  });
});

describe('challenge markers (52 §3.2)', () => {
  it('parses the agreed challenge from the latest marker', () => {
    const text =
      'Love it — set. [[SELFOS:CHALLENGE:{"action":"Call one friend this week","comfort":3,"lifeArea":"Relationships","checkInDays":5}]]';
    const parsed = parseChallengeMarker(text);
    expect(parsed?.action).toBe('Call one friend this week');
    expect(parsed?.comfort).toBe(3);
    expect(parsed?.lifeArea).toBe('Relationships');
    expect(parsed?.checkInDays).toBe(5);
  });

  it('returns null for no marker, a malformed JSON marker, or a missing action (tolerant, 37)', () => {
    expect(parseChallengeMarker('just a normal reply')).toBeNull();
    expect(parseChallengeMarker('[[SELFOS:CHALLENGE:{not json}]]')).toBeNull();
    expect(parseChallengeMarker('[[SELFOS:CHALLENGE:{"comfort":3}]]')).toBeNull(); // no action
  });

  it('strips complete and partial challenge markers (no flash mid-stream)', () => {
    expect(stripChallengeMarker('Set. [[SELFOS:CHALLENGE:{"action":"x"}]]')).toBe('Set.');
    expect(stripChallengeMarker('Set. [[SELFOS:CHALLENGE:{"action":"x"')).toBe('Set.');
    expect(stripChallengeMarker('Set. [[SELFOS:CHALL')).toBe('Set.');
    expect(stripChallengeMarker('plain text')).toBe('plain text');
  });

  it('stripCoachMarkers also removes the challenge marker', () => {
    expect(stripCoachMarkers('Done. [[SELFOS:WRAPUP]] [[SELFOS:CHALLENGE:{"action":"x"}]]')).toBe(
      'Done.',
    );
  });
});
