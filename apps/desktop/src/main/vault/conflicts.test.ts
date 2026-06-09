// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findConflicts, isConflictCopy } from './conflicts';

describe('isConflictCopy', () => {
  it('flags Dropbox and Syncthing conflict copies', () => {
    expect(isConflictCopy("journal (Ben's conflicted copy 2026-06-09).md")).toBe(true);
    expect(isConflictCopy('note.sync-conflict-20260609-120000-ABCDEFG.md')).toBe(true);
  });

  it('does not flag normal files', () => {
    expect(isConflictCopy('2026-06-09.md')).toBe(false);
    expect(isConflictCopy('settings.json')).toBe(false);
  });
});

describe('findConflicts', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'selfos-conflicts-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds conflict copies recursively and ignores clean files', async () => {
    await mkdir(join(dir, 'journal'), { recursive: true });
    await writeFile(join(dir, 'journal', 'ok.md'), 'x');
    await writeFile(join(dir, 'journal', 'ok (conflicted copy 2026-06-09).md'), 'x');

    const conflicts = await findConflicts(dir);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('conflicted copy');
  });
});
