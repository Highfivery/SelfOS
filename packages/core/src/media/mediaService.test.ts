import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import {
  ALLOWED_IMAGE_MIME,
  deleteMedia,
  getMedia,
  isAllowedImageMime,
  MAX_IMAGE_BYTES,
  sniffImageMime,
  storeMedia,
} from './mediaService';

const key = generateMasterKey();
const dir = 'people/p1/conversations/c1/attachments';
const guard = (p: string): boolean =>
  /^people\/[^/]+\/conversations\/[^/]+\/attachments\/[^/]+\.enc$/.test(p) && !p.includes('..');

describe('@selfos/core/media', () => {
  it('round-trips bytes through encryptBytes to <dir>/<uuid>.enc', async () => {
    const fs = memFileSystem();
    const bytes = new Uint8Array([1, 2, 3, 4, 250, 0, 255]);
    const { id, path } = await storeMedia(fs, key, dir, bytes);
    expect(path).toBe(`${dir}/${id}.enc`);

    // On disk it's an encrypted envelope, NOT the raw bytes.
    const raw = await fs.read(path);
    const parsed = JSON.parse(new TextDecoder().decode(raw!)) as Record<string, unknown>;
    expect(parsed['alg']).toBe('aes-256-gcm');
    expect(parsed['data']).not.toBe(undefined);

    const back = await getMedia(fs, key, path, guard);
    expect(back).toEqual(bytes);
  });

  it('getMedia refuses an out-of-guard path (the .. / non-attachment guard)', async () => {
    const fs = memFileSystem();
    const { path } = await storeMedia(fs, key, dir, new Uint8Array([9]));
    // A path that escapes the guard returns null even though the file exists.
    expect(await getMedia(fs, key, 'config/recovery.enc', guard)).toBeNull();
    expect(await getMedia(fs, key, `${dir}/../../secret.enc`, guard)).toBeNull();
    // The legitimate path still works.
    expect(await getMedia(fs, key, path, guard)).not.toBeNull();
  });

  it('getMedia returns null for absent or corrupt files', async () => {
    const fs = memFileSystem();
    expect(await getMedia(fs, key, `${dir}/missing.enc`, guard)).toBeNull();
    await fs.writeAtomic(`${dir}/corrupt.enc`, new TextEncoder().encode('not json'));
    expect(await getMedia(fs, key, `${dir}/corrupt.enc`, guard)).toBeNull();
  });

  it('deleteMedia removes a stored blob but is a no-op outside the guard', async () => {
    const fs = memFileSystem();
    const { path } = await storeMedia(fs, key, dir, new Uint8Array([7]));
    await deleteMedia(fs, 'config/recovery.enc', guard); // guard rejects → no-op
    expect(await fs.read(path)).not.toBeNull();
    await deleteMedia(fs, path, guard);
    expect(await fs.read(path)).toBeNull();
  });

  it('mime + size helpers', () => {
    expect(ALLOWED_IMAGE_MIME).toContain('image/png');
    expect(isAllowedImageMime('image/png')).toBe(true);
    expect(isAllowedImageMime('image/jpeg')).toBe(true);
    expect(isAllowedImageMime('image/heic')).toBe(false);
    expect(isAllowedImageMime('application/pdf')).toBe(false);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('sniffImageMime reads the magic bytes', () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe(
      'image/png',
    );
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('image/gif');
    expect(
      sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe('image/webp');
    expect(sniffImageMime(new Uint8Array([0, 1, 2]))).toBe('image/png'); // default
  });
});
