import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { MEDIA_DIR } from './paths';
import {
  deleteQuestionnaireImage,
  getQuestionnaireImage,
  isAllowedImageMime,
  storeQuestionnaireImage,
} from './imageService';

const key = generateMasterKey();
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

describe('imageService', () => {
  it('stores an encrypted image and reads it back byte-for-byte', async () => {
    const fs = memFileSystem();
    const path = await storeQuestionnaireImage(fs, key, png);
    expect(path.startsWith(`${MEDIA_DIR}/`)).toBe(true);
    expect(path.endsWith('.enc')).toBe(true);

    // At rest it's ciphertext (the envelope), not the raw bytes.
    const onDisk = await fs.read(path);
    expect(new TextDecoder().decode(onDisk!)).toContain('"alg":"aes-256-gcm"');

    const out = await getQuestionnaireImage(fs, key, path);
    expect(out && Array.from(out)).toEqual(Array.from(png));
  });

  it('degrades to null (not a throw) with the wrong key, so a bad image never breaks the form', async () => {
    const fs = memFileSystem();
    const path = await storeQuestionnaireImage(fs, key, png);
    expect(await getQuestionnaireImage(fs, generateMasterKey(), path)).toBeNull();
  });

  it('refuses to read or delete a path outside the media dir', async () => {
    const fs = memFileSystem();
    await fs.writeAtomic('config/recovery.enc', new TextEncoder().encode('secret'));
    expect(await getQuestionnaireImage(fs, key, 'config/recovery.enc')).toBeNull();
    await deleteQuestionnaireImage(fs, 'config/recovery.enc');
    expect(await fs.read('config/recovery.enc')).not.toBeNull(); // untouched
  });

  it('deletes a stored image', async () => {
    const fs = memFileSystem();
    const path = await storeQuestionnaireImage(fs, key, png);
    await deleteQuestionnaireImage(fs, path);
    expect(await getQuestionnaireImage(fs, key, path)).toBeNull();
  });

  it('whitelists only common raster mime types', () => {
    expect(isAllowedImageMime('image/png')).toBe(true);
    expect(isAllowedImageMime('image/jpeg')).toBe(true);
    expect(isAllowedImageMime('image/svg+xml')).toBe(false);
    expect(isAllowedImageMime('application/pdf')).toBe(false);
  });
});
