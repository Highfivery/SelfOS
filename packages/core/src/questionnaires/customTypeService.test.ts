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
});
