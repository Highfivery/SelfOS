import { describe, expect, it } from 'vitest';
import { crc32, makeZip, type ZipEntry } from './zip';

/** Parse a store-only ZIP back into { name → bytes } by walking the central directory (store = raw data). */
function readStoreZip(buf: Uint8Array): Record<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Find the End Of Central Directory (scan back for the signature).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no EOCD');
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true); // central dir offset
  const out: Record<string, Uint8Array> = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) throw new Error('bad central record');
    const size = dv.getUint32(ptr + 24, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    // Jump to the local header to find the data start.
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    out[name] = buf.subarray(dataStart, dataStart + size);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('makeZip — store-only ZIP writer (§18.3)', () => {
  it('round-trips entries verbatim, in order, with a valid central directory + EOCD', () => {
    const entries: ZipEntry[] = [
      { name: 'mimetype', data: new TextEncoder().encode('application/epub+zip') },
      { name: 'a/b.txt', data: new TextEncoder().encode('hello — world') },
      { name: 'img.bin', data: new Uint8Array([0, 1, 2, 255, 254]) },
    ];
    const zip = makeZip(entries);
    // Signatures: first local header + an EOCD at the end.
    const dv = new DataView(zip.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50); // first local file header
    // The first entry is `mimetype`, method 0 (store) — required for a valid EPUB.
    expect(dv.getUint16(8, true)).toBe(0); // compression method = store
    const back = readStoreZip(zip);
    expect(Object.keys(back)).toEqual(['mimetype', 'a/b.txt', 'img.bin']);
    expect(new TextDecoder().decode(back['mimetype']!)).toBe('application/epub+zip');
    expect(new TextDecoder().decode(back['a/b.txt']!)).toBe('hello — world');
    expect([...back['img.bin']!]).toEqual([0, 1, 2, 255, 254]);
  });

  it('crc32 matches known IEEE vectors', () => {
    expect(crc32(new TextEncoder().encode(''))).toBe(0);
    // "123456789" → 0xCBF43926 (the canonical CRC-32 check value).
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

export { readStoreZip };
