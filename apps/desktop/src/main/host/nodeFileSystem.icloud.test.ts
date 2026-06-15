// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Simulate an iCloud-Drive / Dropbox sync daemon evicting the temp file between writeFile and rename:
// the rename SOURCE is gone, so it throws ENOENT. The first rename of each test fails; retries succeed.
let failRenameOnce = false;
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: vi.fn(async (from: string, to: string) => {
      if (failRenameOnce) {
        failRenameOnce = false;
        throw Object.assign(new Error('temp evicted by iCloud'), { code: 'ENOENT' });
      }
      return actual.rename(from, to);
    }),
  };
});

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from './nodeFileSystem';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'selfos-fs-icloud-'));
});
afterEach(async () => {
  failRenameOnce = false;
  await rm(root, { recursive: true, force: true });
});

describe('createNodeFileSystem (iCloud temp-eviction resilience)', () => {
  it('retries the atomic write when the rename source is evicted (ENOENT) and still succeeds', async () => {
    failRenameOnce = true;
    const fs = createNodeFileSystem(root);
    await fs.writeAtomic('config/access.enc', new TextEncoder().encode('payload'));

    const read = await fs.read('config/access.enc');
    expect(read && new TextDecoder().decode(read)).toBe('payload');
    // The failed first attempt left no orphaned `.tmp-*` residue.
    expect((await readdir(join(root, 'config'))).every((n) => !n.includes('.tmp-'))).toBe(true);
  });

  it('rethrows a non-ENOENT rename error without retrying forever', async () => {
    const fs = createNodeFileSystem(root);
    const { rename } = await import('node:fs/promises');
    vi.mocked(rename).mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );
    await expect(
      fs.writeAtomic('config/x.enc', new TextEncoder().encode('y')),
    ).rejects.toMatchObject({ code: 'EACCES' });
  });
});
