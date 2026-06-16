import { describe, expect, it } from 'vitest';
import { memFileSystem } from '../host/memFileSystem';
import { PREFS_PATH } from './paths';
import {
  addCustomIntimacyTopic,
  addCustomType,
  listCustomTypes,
  readCustomIntimacyTopics,
  removeCustomIntimacyTopic,
} from './customTypeService';
import { INTIMACY_ACTIVITIES } from '../intimacy/topics';

describe('customTypeService', () => {
  it('starts empty on a fresh vault', async () => {
    const fs = memFileSystem();
    expect(await listCustomTypes(fs)).toEqual([]);
  });

  it('adds a custom type and persists it as plain JSON in the vault', async () => {
    const fs = memFileSystem();
    const after = await addCustomType(fs, '  Affair recovery  ');
    expect(after).toEqual(['Affair recovery']); // trimmed
    expect(await listCustomTypes(fs)).toEqual(['Affair recovery']);

    // Stored plain (decodable without the master key) so it syncs like settings.json.
    const bytes = await fs.read(PREFS_PATH);
    expect(bytes).not.toBeNull();
    const parsed = JSON.parse(new TextDecoder().decode(bytes!)) as { customTypes: string[] };
    expect(parsed.customTypes).toEqual(['Affair recovery']);
  });

  it('ignores blank names', async () => {
    const fs = memFileSystem();
    await expect(addCustomType(fs, '   ')).rejects.toThrow(/needs a name/i);
    expect(await listCustomTypes(fs)).toEqual([]);
  });

  it('de-dupes case-insensitively and against reserved starter keys', async () => {
    const fs = memFileSystem();
    await addCustomType(fs, 'Date night');
    await addCustomType(fs, 'date NIGHT'); // same type, different case → no-op
    expect(await listCustomTypes(fs)).toEqual(['Date night']);

    // A name colliding with a reserved starter type is also a no-op.
    const after = await addCustomType(fs, 'Intimacy', ['intimacy']);
    expect(after).toEqual(['Date night']);
  });

  it('sorts the list case-insensitively for a stable picker order', async () => {
    const fs = memFileSystem();
    await addCustomType(fs, 'zebra');
    await addCustomType(fs, 'Apple');
    await addCustomType(fs, 'mango');
    expect(await listCustomTypes(fs)).toEqual(['Apple', 'mango', 'zebra']);
  });

  it('falls back to empty on a corrupt prefs file', async () => {
    const fs = memFileSystem();
    await fs.writeAtomic(PREFS_PATH, new TextEncoder().encode('{ not json'));
    expect(await listCustomTypes(fs)).toEqual([]);
    // …and a subsequent add still works (overwrites the garbage).
    expect(await addCustomType(fs, 'Recovery')).toEqual(['Recovery']);
  });

  describe('custom intimacy topics (§16.5a)', () => {
    it('starts empty, adds activities + fantasies, and reads them back', async () => {
      const fs = memFileSystem();
      expect(await readCustomIntimacyTopics(fs)).toEqual({ activities: [], fantasies: [] });

      await addCustomIntimacyTopic(fs, 'activities', '  Wax play  ');
      await addCustomIntimacyTopic(fs, 'fantasies', 'Pirate roleplay');
      expect(await readCustomIntimacyTopics(fs)).toEqual({
        activities: ['Wax play'], // trimmed
        fantasies: ['Pirate roleplay'],
      });
      // Custom types are unaffected (same prefs file, separate fields).
      expect(await listCustomTypes(fs)).toEqual([]);
    });

    it('a case-insensitive duplicate of a built-in OR a custom topic is a no-op', async () => {
      const fs = memFileSystem();
      await addCustomIntimacyTopic(fs, 'activities', 'Wax play');
      await addCustomIntimacyTopic(fs, 'activities', 'wax PLAY'); // dupe custom → no-op
      await addCustomIntimacyTopic(fs, 'activities', 'oral (giving)', INTIMACY_ACTIVITIES); // dupe built-in → no-op
      expect((await readCustomIntimacyTopics(fs)).activities).toEqual(['Wax play']);
    });

    it('removes a custom topic case-insensitively (built-ins are not stored here, so unaffected)', async () => {
      const fs = memFileSystem();
      await addCustomIntimacyTopic(fs, 'fantasies', 'Pirate roleplay');
      await addCustomIntimacyTopic(fs, 'fantasies', 'Spy roleplay');
      expect(await removeCustomIntimacyTopic(fs, 'fantasies', 'pirate ROLEPLAY')).toEqual([
        'Spy roleplay',
      ]);
    });
  });
});
