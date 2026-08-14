import { describe, expect, it } from 'vitest';
import { memFileSystem } from '../host/memFileSystem';
import { PREFS_PATH } from './paths';
import { addCustomType, listCustomTypes } from './customTypeService';

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

  it('DELETES the retired intimacy-topic keys once, and leaves other unknown keys alone (owner, 2026-08-14)', async () => {
    // Two rules that look contradictory and are not. Retiring a field is an EXPLICIT, named act
    // (`RETIRED_PREFS_KEYS`) — the owner chose to drop the custom intimacy topics, so they go. Everything
    // else unknown is preserved, because erasing authored content as a side effect of an unrelated save is
    // not ours to do.
    const fs = memFileSystem();
    const write = async (o: unknown): Promise<void> => {
      await fs.writeAtomic(
        'config/questionnaires.json',
        new TextEncoder().encode(JSON.stringify(o)),
      );
    };
    const read = async (): Promise<Record<string, unknown>> =>
      JSON.parse(
        new TextDecoder().decode((await fs.read('config/questionnaires.json')) as Uint8Array),
      ) as Record<string, unknown>;

    await write({
      schemaVersion: 1,
      customTypes: ['Check-in'],
      customIntimacyActivities: ['MFM threesome'],
      customIntimacyFantasies: ['Watching partner with a third'],
      somethingElseEntirely: ['keep me'],
    });

    // A plain READ performs the one-time cleanup.
    expect(await listCustomTypes(fs)).toEqual(['Check-in']);
    const after = await read();
    expect(after['customIntimacyActivities']).toBeUndefined();
    expect(after['customIntimacyFantasies']).toBeUndefined();
    // …without touching what nobody retired, or what the schema does know.
    expect(after['somethingElseEntirely']).toEqual(['keep me']);
    expect(after['customTypes']).toEqual(['Check-in']);

    // Idempotent: a second read rewrites nothing and loses nothing.
    await listCustomTypes(fs);
    expect(await read()).toEqual(after);
  });

  it('preserves keys the schema no longer knows, instead of erasing authored content (2026-08-13)', async () => {
    // The general rule the deletion above is a deliberate exception to.
    const fs = memFileSystem();
    await fs.writeAtomic(
      'config/questionnaires.json',
      new TextEncoder().encode(
        JSON.stringify({ schemaVersion: 1, customTypes: [], somethingElseEntirely: ['keep me'] }),
      ),
    );
    await addCustomType(fs, 'Check-in');
    const raw = JSON.parse(
      new TextDecoder().decode((await fs.read('config/questionnaires.json')) as Uint8Array),
    ) as Record<string, unknown>;
    expect(raw['customTypes']).toEqual(['Check-in']);
    expect(raw['somethingElseEntirely']).toEqual(['keep me']);
  });
});
