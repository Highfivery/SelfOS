import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Read and JSON-parse a file (throws if missing or invalid JSON). */
export async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/**
 * Write JSON atomically: serialize to a temp file in the same directory, then rename over the
 * target (atomic on the same filesystem). Avoids leaving a half-written file if the process dies
 * mid-write — important when the vault lives in a synced folder (00-architecture §4.3).
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmpPath, filePath);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
