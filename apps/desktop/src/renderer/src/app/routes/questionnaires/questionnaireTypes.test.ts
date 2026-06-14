import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TYPE,
  QUESTIONNAIRE_TYPES,
  SENSITIVITY_TYPES,
  effectiveSensitivity,
  seedSensitivityForType,
  sensitivityConfigFor,
} from './questionnaireTypes';

describe('questionnaireTypes (§15.1/§15.2)', () => {
  it('includes General and defaults to it', () => {
    expect(QUESTIONNAIRE_TYPES.some((t) => t.value === 'general')).toBe(true);
    expect(DEFAULT_TYPE).toBe('general');
  });

  it('only intimacy and scenario carry sensitivity', () => {
    expect(Object.keys(SENSITIVITY_TYPES).sort()).toEqual(['intimacy', 'scenario']);
    expect(sensitivityConfigFor('general')).toBeNull();
    expect(sensitivityConfigFor('role-feedback')).toBeNull();
    expect(sensitivityConfigFor('my custom type')).toBeNull();
  });

  it('intimacy offers tiers only (no standard) and defaults to intimacyGeneral', () => {
    const cfg = sensitivityConfigFor('intimacy');
    expect(cfg?.options.map((o) => o.value)).toEqual(['intimacyGeneral', 'explicit', 'unfiltered']);
    expect(cfg?.default).toBe('intimacyGeneral');
  });

  it('scenario offers standard (default) plus the intimacy tiers', () => {
    const cfg = sensitivityConfigFor('scenario');
    expect(cfg?.default).toBe('standard');
    expect(cfg?.options.map((o) => o.value)).toEqual([
      'standard',
      'intimacyGeneral',
      'explicit',
      'unfiltered',
    ]);
  });

  it('seeds sensitivity on type change, keeping a still-valid tier', () => {
    // General → intimacy seeds the intimacy default.
    expect(seedSensitivityForType('intimacy', 'standard')).toBe('intimacyGeneral');
    // Scenario → intimacy keeps an explicit tier (valid for both).
    expect(seedSensitivityForType('intimacy', 'explicit')).toBe('explicit');
    // Leaving a sensitive type drops to standard.
    expect(seedSensitivityForType('role-feedback', 'explicit')).toBe('standard');
    expect(seedSensitivityForType('general', 'intimacyGeneral')).toBe('standard');
    // Scenario keeps standard by default.
    expect(seedSensitivityForType('scenario', 'standard')).toBe('standard');
  });

  it('clamps the effective sensitivity for the current type (§15.6)', () => {
    // A non-sensitivity type is always standard, even if a stale tier lingers in state.
    expect(effectiveSensitivity('general', 'explicit')).toBe('standard');
    // An intimacy type can't be standard — it clamps to its default.
    expect(effectiveSensitivity('intimacy', 'standard')).toBe('intimacyGeneral');
    // A valid tier passes through.
    expect(effectiveSensitivity('scenario', 'explicit')).toBe('explicit');
  });
});
