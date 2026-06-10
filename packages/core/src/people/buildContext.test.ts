import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Person, Relationship } from '../schemas';
import { savePerson } from './peopleService';
import { saveRelationship } from './relationshipService';
import { buildContext } from './buildContext';

const key = generateMasterKey();

function person(id: string, displayName: string, extra: Partial<Person> = {}): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
    ...extra,
  };
}

describe('buildContext', () => {
  it("includes own notes and others' shareable notes, but never others' private notes", async () => {
    const fs = memFileSystem();
    await savePerson(
      fs,
      key,
      person('a', 'Alex', { publicNotes: 'likes hiking', privateNotes: 'anxious about work' }),
    );
    await savePerson(
      fs,
      key,
      person('b', 'Sam', { publicNotes: 'a nurse', privateNotes: 'SECRET-SAM' }),
    );
    const rel: Relationship = {
      id: 'r1',
      schemaVersion: 1,
      fromPersonId: 'a',
      toPersonId: 'b',
      type: 'partner',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await saveRelationship(fs, key, rel);

    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).toContain('Alex');
    expect(ctx).toContain('likes hiking'); // own shareable
    expect(ctx).toContain('anxious about work'); // own private — it's their own session
    expect(ctx).toContain('Sam'); // related person
    expect(ctx).toContain('a nurse'); // related person's shareable
    expect(ctx).not.toContain('SECRET-SAM'); // related person's private — excluded
  });

  it('returns empty for an unknown person', async () => {
    expect(await buildContext(memFileSystem(), key, 'nope')).toBe('');
  });
});
