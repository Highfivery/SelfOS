import type { FileSystem } from '../host';
import { uuid } from '../id';
import { RelationshipSchema, type Relationship, type RelationshipInput } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { RELATIONSHIP_SCHEMA_VERSION, migrateRelationshipRaw } from './migrations';

const RELATIONSHIPS_DIR = 'relationships';

function relationshipPath(id: string): string {
  return `${RELATIONSHIPS_DIR}/${id}.enc`;
}

export async function saveRelationship(
  fs: FileSystem,
  key: Uint8Array,
  relationship: Relationship,
): Promise<void> {
  await writeEncryptedJson(fs, relationshipPath(relationship.id), relationship, key);
}

export async function listRelationships(fs: FileSystem, key: Uint8Array): Promise<Relationship[]> {
  const relationships: Relationship[] = [];
  for (const name of await fs.list(RELATIONSHIPS_DIR)) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${RELATIONSHIPS_DIR}/${name}`, key);
    // Read-time notes-merge migration (15-shareability §4.3b) before validation.
    if (raw !== null) relationships.push(RelationshipSchema.parse(migrateRelationshipRaw(raw)));
  }
  return relationships;
}

/** Create or update a relationship from renderer input; the main process owns id + timestamps. */
export async function upsertRelationship(
  fs: FileSystem,
  key: Uint8Array,
  input: RelationshipInput,
): Promise<Relationship> {
  const now = new Date().toISOString();
  let createdAt = now;
  if (input.id) {
    const existing = (await listRelationships(fs, key)).find((r) => r.id === input.id);
    if (existing) createdAt = existing.createdAt;
  }
  const relationship: Relationship = {
    id: input.id ?? uuid(),
    schemaVersion: RELATIONSHIP_SCHEMA_VERSION,
    fromPersonId: input.fromPersonId,
    toPersonId: input.toPersonId,
    type: input.type,
    createdAt,
    updatedAt: now,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.closeness !== undefined ? { closeness: input.closeness } : {}),
    ...(input.since !== undefined ? { since: input.since } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.notesShared !== undefined ? { notesShared: input.notesShared } : {}),
  };
  await saveRelationship(fs, key, relationship);
  return relationship;
}

export async function deleteRelationship(fs: FileSystem, id: string): Promise<void> {
  await fs.remove(relationshipPath(id));
}
