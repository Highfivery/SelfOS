import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { Person } from '../schemas';
import { buildSystemPrompt, PERSONA, SAFETY } from './promptBuilder';
import { GUIDED_CATALOG, getExercise, listExercises } from './guidedCatalog';
import {
  CHALLENGE_COACH_ID,
  CHALLENGE_GUIDES,
  CHALLENGE_INTIMACY_REGISTER,
  CHALLENGE_REFLECT_ID,
  challengeOpeningMessage,
  isChallengeGuide,
} from './challengeCoach';

const key = generateMasterKey();
let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

function person(id: string, name: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName: name,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

describe('challenge guides (52 §5.2)', () => {
  it('getExercise resolves the challenge guides, but they are NOT in the browsable catalog', () => {
    expect(getExercise(CHALLENGE_COACH_ID)?.id).toBe(CHALLENGE_COACH_ID);
    expect(getExercise(CHALLENGE_REFLECT_ID)?.id).toBe(CHALLENGE_REFLECT_ID);
    expect(GUIDED_CATALOG.some((e) => e.id === CHALLENGE_COACH_ID)).toBe(false);
    expect(listExercises().some((e) => isChallengeGuide(e.id))).toBe(false);
  });

  it('challengeOpeningMessage is static + domain-aware (no model call needed)', () => {
    expect(challengeOpeningMessage()).toMatch(/challenge|experiment/i);
    expect(challengeOpeningMessage('habit')).toMatch(/habit/i);
    expect(challengeOpeningMessage('intimacy')).toMatch(/intimacy|connection/i);
  });

  it('the always-on challenge-coach addendum states the SAFETY core + steers sex away until the 18+ ack (§8)', () => {
    const addendum = CHALLENGE_GUIDES.find(
      (g) => g.id === CHALLENGE_COACH_ID,
    )!.systemPromptAddendum;
    const lower = addendum.toLowerCase();
    // not therapy / not medical
    expect(lower).toContain('not therapy');
    // propose & negotiate, never coerce; respect a no immediately
    expect(lower).toContain('invitation');
    expect(lower).toMatch(/never pressure|never coerce|do not coerce/);
    expect(lower).toMatch(/respect a "no"|respect a no|"not now"/);
    // crisis/distress drops the challenge + routes to resources
    expect(lower).toMatch(/drop the challenge/);
    expect(lower).toMatch(/professional|emergency/);
    // the marker convention is taught in-prompt
    expect(addendum).toContain('[[SELFOS:CHALLENGE:');
    // SAFETY GATE (§8.3): the always-on addendum does NOT carry the explicit sexual register — it steers a
    // sexual challenge away until the person has confirmed they're 18+.
    expect(lower).toMatch(/18 or older/);
    expect(lower).toMatch(/keep this challenge non-sexual/);
    expect(lower).not.toContain('consensual adults only'); // that lives in the acked-only register
  });

  it('the EXPLICIT register (appended only when the 18+ ack is present) carries the sexual boundary (§8.3)', () => {
    const lower = CHALLENGE_INTIMACY_REGISTER.toLowerCase();
    // hard-nos absolutely (the intimacy matrix)
    expect(lower).toContain('hard no');
    // partner buy-in for partnered sexual acts
    expect(lower).toMatch(/partner'?s? (genuine )?consent|partner'?s? consent and enthusiasm/);
    // consensual-adult boundary + never minors / real non-consent
    expect(lower).toContain('consensual adults only');
    expect(lower).toContain('never minors');
    // trauma-aware: slow down, stop pushing, route to support
    expect(lower).toMatch(/trauma|assault/);
  });

  it('the reflect addendum does NOT teach the challenge marker (it never captures a new one)', () => {
    const addendum = CHALLENGE_GUIDES.find(
      (g) => g.id === CHALLENGE_REFLECT_ID,
    )!.systemPromptAddendum;
    expect(addendum).not.toContain('[[SELFOS:CHALLENGE:');
    expect(addendum.toLowerCase()).toContain('not therapy');
  });
});

describe('buildSystemPrompt with the challenge guide', () => {
  it('appends the challenge addendum AFTER persona + safety + context (the boundary leads, §8)', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    const prompt = await buildSystemPrompt(fs, key, 'p1', CHALLENGE_COACH_ID);
    // persona + safety lead
    expect(prompt.indexOf(PERSONA)).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf(SAFETY)).toBeGreaterThan(prompt.indexOf(PERSONA));
    // the challenge steering comes AFTER safety
    const addendumStart = prompt.indexOf('helping them take on a small CHALLENGE');
    expect(addendumStart).toBeGreaterThan(prompt.indexOf(SAFETY));
    // and the person context is present
    expect(prompt).toContain('Alex');
  });

  it('GATES the explicit sexual register on the 18+ ack (§8.3): absent without it, present with it', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    // Un-acked (default) → the explicit register is NOT in the prompt; the gated stance is.
    const unacked = await buildSystemPrompt(fs, key, 'p1', CHALLENGE_COACH_ID);
    expect(unacked).not.toContain('consensual adults only');
    expect(unacked.toLowerCase()).toContain('keep this challenge non-sexual');
    // Acked → the explicit register is appended, after the boundary.
    const acked = await buildSystemPrompt(
      fs,
      key,
      'p1',
      CHALLENGE_COACH_ID,
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(acked).toContain('consensual adults only');
    expect(acked.indexOf('consensual adults only')).toBeGreaterThan(acked.indexOf(SAFETY));
    // The register is challenge-coach-only: a normal guided session never gets it even when acked.
    const guided = await buildSystemPrompt(
      fs,
      key,
      'p1',
      'cbt-thought-record',
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(guided).not.toContain('consensual adults only');
  });
});
