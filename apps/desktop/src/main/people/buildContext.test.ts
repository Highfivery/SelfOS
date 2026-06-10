// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '@selfos/core/crypto';
import type { FileSystem } from '@selfos/core/host';
import { createNodeFileSystem } from '../host/nodeFileSystem';
import type { Person, Relationship } from '../../shared/schemas';
import { savePerson } from './peopleService';
import { saveRelationship } from './relationshipService';
import { buildContext } from './buildContext';

const key = Buffer.from(generateMasterKey());
let vault: string;
let fs: FileSystem;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-ctx-'));
  fs = createNodeFileSystem(vault);
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
    expect(await buildContext(fs, key, 'nope')).toBe('');
  });
});
