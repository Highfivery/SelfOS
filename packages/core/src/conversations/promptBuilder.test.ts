import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { Person } from '../schemas';
import { buildSystemPrompt } from './promptBuilder';

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
});
