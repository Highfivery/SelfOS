import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { Person } from '../schemas';
import { buildSystemPrompt, FORMATTING, PERSONA, SAFETY } from './promptBuilder';
import { getExercise } from './guidedCatalog';

const key = generateMasterKey();
let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

function person(id: string, name: string, extra: Partial<Person> = {}): Person {
  return {
    id,
    schemaVersion: 1,
    displayName: name,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
    ...extra,
  };
}

describe('buildSystemPrompt', () => {
  it('includes the persona, the safety boundary, and the person context', async () => {
    await savePerson(fs, key, person('p1', 'Alex', { notes: 'enjoys hiking' }));
    const prompt = await buildSystemPrompt(fs, key, 'p1');
    expect(prompt).toContain('wellness'); // persona/safety
    expect(prompt.toLowerCase()).toContain('not medical'); // safety boundary
    expect(prompt).toContain('crisis'); // crisis routing
    expect(prompt).toContain('Alex'); // context
    expect(prompt).toContain('enjoys hiking'); // shareable context
  });

  it('appends the formatting contract LAST, after persona + safety (34 §5)', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    const prompt = await buildSystemPrompt(fs, key, 'p1');
    expect(prompt).toContain(FORMATTING);
    expect(prompt.indexOf(PERSONA)).toBeLessThan(prompt.indexOf(FORMATTING));
    expect(prompt.indexOf(SAFETY)).toBeLessThan(prompt.indexOf(FORMATTING));
    // It tells the model to avoid what the renderer drops.
    expect(prompt.toLowerCase()).toContain('do not use tables, images, raw html');
  });

  it('does not append a guided addendum for a free session', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    const prompt = await buildSystemPrompt(fs, key, 'p1');
    expect(prompt).not.toContain('SELFOS:STEP');
    expect(prompt).not.toContain(getExercise('grow-goal-setting')!.systemPromptAddendum);
  });

  it('appends the exercise addendum AFTER persona+safety for a guided session', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    const prompt = await buildSystemPrompt(fs, key, 'p1', 'cbt-thought-record');
    const addendum = getExercise('cbt-thought-record')!.systemPromptAddendum;
    expect(prompt).toContain(addendum);
    // Persona + safety still lead — they appear before the addendum.
    expect(prompt.indexOf(PERSONA)).toBeLessThan(prompt.indexOf(addendum));
    expect(prompt.indexOf(SAFETY)).toBeLessThan(prompt.indexOf(addendum));
  });

  it('teaches the step-marker convention only for a structured exercise', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    const structured = await buildSystemPrompt(fs, key, 'p1', 'grow-goal-setting');
    expect(structured).toContain('[[SELFOS:STEP:n]]');
    const chat = await buildSystemPrompt(fs, key, 'p1', 'reflective-session');
    expect(chat).not.toContain('[[SELFOS:STEP:n]]');
  });

  it('adds nothing for an unknown/retired guideId (§7)', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    const guided = await buildSystemPrompt(fs, key, 'p1', 'retired-exercise');
    const free = await buildSystemPrompt(fs, key, 'p1');
    expect(guided).toBe(free);
  });

  it('appends the in-session depth ask AFTER persona+safety when sections are passed (29 §3.5)', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    const depthAsk = {
      sections: [
        { id: 'family', title: 'Family & roots', restricted: false, adult: false, skipped: false },
      ],
    };
    const prompt = await buildSystemPrompt(fs, key, 'p1', undefined, depthAsk);
    expect(prompt).toContain('Family & roots'); // the invited area is named
    expect(prompt).toMatch(/crisis/i); // crisis always takes precedence in the ask
    // The boundary still leads — the ask comes after persona + safety.
    expect(prompt.indexOf(SAFETY)).toBeLessThan(prompt.indexOf('Family & roots'));
  });

  it('adds no depth ask when there are no unexplored sections to invite', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    const withEmpty = await buildSystemPrompt(fs, key, 'p1', undefined, { sections: [] });
    const free = await buildSystemPrompt(fs, key, 'p1');
    expect(withEmpty).toBe(free);
  });
});
