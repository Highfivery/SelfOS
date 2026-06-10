// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto/cryptoService';
import type { Person, Relationship } from '../../shared/schemas';
import { savePerson } from './peopleService';
import { saveRelationship } from './relationshipService';
import { buildContext } from './buildContext';

const key = generateMasterKey();
let vault: string;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-ctx-'));
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

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
    await savePerson(
      vault,
      key,
      person('a', 'Alex', { publicNotes: 'likes hiking', privateNotes: 'anxious about work' }),
    );
    await savePerson(
      vault,
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
    await saveRelationship(vault, key, rel);

    const ctx = await buildContext(vault, key, 'a');
    expect(ctx).toContain('Alex');
    expect(ctx).toContain('likes hiking'); // own shareable
    expect(ctx).toContain('anxious about work'); // own private — it's their own session
    expect(ctx).toContain('Sam'); // related person
    expect(ctx).toContain('a nurse'); // related person's shareable
    expect(ctx).not.toContain('SECRET-SAM'); // related person's private — excluded
  });

  it('returns empty for an unknown person', async () => {
    expect(await buildContext(vault, key, 'nope')).toBe('');
  });
});
