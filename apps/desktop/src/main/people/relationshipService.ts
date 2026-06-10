import { randomUUID } from 'node:crypto';
import type { FileSystem } from '@selfos/core/host';
import {
  RelationshipSchema,
  type Relationship,
  type RelationshipInput,
} from '../../shared/schemas';
import { readEncryptedJson, writeEncryptedJson } from '../crypto/encryptedStore';

const RELATIONSHIPS_DIR = 'relationships';

function relationshipPath(id: string): string {
  return `${RELATIONSHIPS_DIR}/${id}.enc`;
}

export async function saveRelationship(
  fs: FileSystem,
  key: Buffer,
  relationship: Relationship,
): Promise<void> {
  await writeEncryptedJson(fs, relationshipPath(relationship.id), relationship, key);
}

export async function listRelationships(fs: FileSystem, key: Buffer): Promise<Relationship[]> {
  const relationships: Relationship[] = [];
  for (const name of await fs.list(RELATIONSHIPS_DIR)) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${RELATIONSHIPS_DIR}/${name}`, key);
    if (raw !== null) relationships.push(RelationshipSchema.parse(raw));
  }
  return relationships;
}

/** Create or update a relationship from renderer input; the main process owns id + timestamps. */
export async function upsertRelationship(
  fs: FileSystem,
  key: Buffer,
  input: RelationshipInput,
): Promise<Relationship> {
  const now = new Date().toISOString();
  let createdAt = now;
  if (input.id) {
    const existing = (await listRelationships(fs, key)).find((r) => r.id === input.id);
    if (existing) createdAt = existing.createdAt;
  }
  const relationship: Relationship = {
    id: input.id ?? randomUUID(),
    schemaVersion: 1,
    fromPersonId: input.fromPersonId,
    toPersonId: input.toPersonId,
    type: input.type,
    createdAt,
    updatedAt: now,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.closeness !== undefined ? { closeness: input.closeness } : {}),
    ...(input.since !== undefined ? { since: input.since } : {}),
    ...(input.publicNotes !== undefined ? { publicNotes: input.publicNotes } : {}),
    ...(input.privateNotes !== undefined ? { privateNotes: input.privateNotes } : {}),
  };
  await saveRelationship(fs, key, relationship);
  return relationship;
}

export async function deleteRelationship(fs: FileSystem, id: string): Promise<void> {
  await fs.remove(relationshipPath(id));
}
