// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '@selfos/core/crypto';
import { savePerson } from '../people/peopleService';
import type { Person } from '../../shared/schemas';
import { buildSystemPrompt } from './promptBuilder';

const key = Buffer.from(generateMasterKey());
let vault: string;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-prompt-'));
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
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
    await savePerson(vault, key, person('p1', 'Alex', { publicNotes: 'enjoys hiking' }));
    const prompt = await buildSystemPrompt(vault, key, 'p1');
    expect(prompt).toContain('wellness'); // persona/safety
    expect(prompt.toLowerCase()).toContain('not medical'); // safety boundary
    expect(prompt).toContain('crisis'); // crisis routing
    expect(prompt).toContain('Alex'); // context
    expect(prompt).toContain('enjoys hiking'); // shareable context
  });
});
