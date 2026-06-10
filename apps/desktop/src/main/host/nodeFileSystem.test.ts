// @vitest-environment node
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeFileSystem } from './nodeFileSystem';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'selfos-fs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createNodeFileSystem', () => {
  it('round-trips bytes via an atomic write that creates parent dirs and leaves no temp residue', async () => {
    const fs = createNodeFileSystem(root);
    await fs.writeAtomic('nested/deep/file.bin', new TextEncoder().encode('hello 🌿'));

    const read = await fs.read('nested/deep/file.bin');
    expect(read && new TextDecoder().decode(read)).toBe('hello 🌿');
    // No `.tmp-*` left behind by the temp-file + rename.
    expect((await readdir(join(root, 'nested', 'deep'))).every((n) => !n.includes('.tmp-'))).toBe(
      true,
    );
  });

  it('returns null when reading an absent file', async () => {
    expect(await createNodeFileSystem(root).read('config/missing.enc')).toBeNull();
  });

  it('returns null when a path component is a file, not a directory (ENOTDIR)', async () => {
    const fs = createNodeFileSystem(root);
    // A stray file where a directory is expected — e.g. macOS `.DS_Store` inside `people/`.
    await writeFile(join(root, 'people'), 'not a dir');
    expect(await fs.read('people/p1/profile.enc')).toBeNull();
  });

  it('returns [] when listing an absent directory', async () => {
    expect(await createNodeFileSystem(root).list('people')).toEqual([]);
  });

  it('lists entry names and removes files or directories (no throw when missing)', async () => {
    const fs = createNodeFileSystem(root);
    await fs.writeAtomic('people/p1/profile.enc', new Uint8Array([1]));
    await fs.writeAtomic('relationships/r1.enc', new Uint8Array([2]));
    expect((await fs.list('people')).sort()).toEqual(['p1']);

    await fs.remove('people/p1'); // directory, recursive
    expect(await fs.list('people')).toEqual([]);
    await fs.remove('relationships/r1.enc'); // file
    expect(await fs.read('relationships/r1.enc')).toBeNull();
    await fs.remove('does/not/exist'); // no throw
  });
});
