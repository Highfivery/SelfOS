import { describe, expect, it } from 'vitest';
import {
  buildStepInstruction,
  parseLatestStep,
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
