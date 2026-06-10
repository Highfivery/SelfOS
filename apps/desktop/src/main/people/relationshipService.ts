import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { RelationshipSchema, type Relationship } from '../../shared/schemas';
import { pathExists } from '../vault/atomic';
import { readEncryptedJson, writeEncryptedJson } from '../crypto/encryptedStore';

function relationshipsDir(vaultDir: string): string {
  return join(vaultDir, 'relationships');
}

function relationshipPath(vaultDir: string, id: string): string {
  return join(relationshipsDir(vaultDir), `${id}.enc`);
}

export async function saveRelationship(
  vaultDir: string,
  key: Buffer,
  relationship: Relationship,
): Promise<void> {
  await mkdir(relationshipsDir(vaultDir), { recursive: true });
  await writeEncryptedJson(relationshipPath(vaultDir, relationship.id), relationship, key);
}

export async function listRelationships(vaultDir: string, key: Buffer): Promise<Relationship[]> {
  const dir = relationshipsDir(vaultDir);
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const relationships: Relationship[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(join(dir, entry.name), key);
    if (raw !== null) relationships.push(RelationshipSchema.parse(raw));
  }
  return relationships;
}

export async function deleteRelationship(vaultDir: string, id: string): Promise<void> {
  await rm(relationshipPath(vaultDir, id), { force: true });
}
