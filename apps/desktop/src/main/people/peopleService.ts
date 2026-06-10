import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PersonSchema, type Person, type PersonInput } from '../../shared/schemas';
import { pathExists } from '../vault/atomic';
import { readEncryptedJson, writeEncryptedJson } from '../crypto/encryptedStore';

function peopleDir(vaultDir: string): string {
  return join(vaultDir, 'people');
}

function profilePath(vaultDir: string, id: string): string {
  return join(peopleDir(vaultDir), id, 'profile.enc');
}

export async function getPerson(vaultDir: string, key: Buffer, id: string): Promise<Person | null> {
  const raw = await readEncryptedJson(profilePath(vaultDir, id), key);
  return raw === null ? null : PersonSchema.parse(raw);
}

export async function savePerson(vaultDir: string, key: Buffer, person: Person): Promise<void> {
  await mkdir(join(peopleDir(vaultDir), person.id), { recursive: true });
  await writeEncryptedJson(profilePath(vaultDir, person.id), person, key);
}

export async function listPeople(vaultDir: string, key: Buffer): Promise<Person[]> {
  const dir = peopleDir(vaultDir);
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const people: Person[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const person = await getPerson(vaultDir, key, entry.name);
    if (person) people.push(person);
  }
  return people.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Create or update a person from renderer input; the main process owns id + timestamps. */
export async function upsertPerson(
  vaultDir: string,
  key: Buffer,
  input: PersonInput,
): Promise<Person> {
  const existing = input.id ? await getPerson(vaultDir, key, input.id) : null;
  const now = new Date().toISOString();
  const person: Person = {
    id: existing?.id ?? input.id ?? randomUUID(),
    schemaVersion: 1,
    displayName: input.displayName,
    isSubject: input.isSubject,
    tags: input.tags,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(input.pronouns !== undefined ? { pronouns: input.pronouns } : {}),
    ...(input.birthday !== undefined ? { birthday: input.birthday } : {}),
    ...(existing?.avatarPath ? { avatarPath: existing.avatarPath } : {}),
    ...(input.publicNotes !== undefined ? { publicNotes: input.publicNotes } : {}),
    ...(input.privateNotes !== undefined ? { privateNotes: input.privateNotes } : {}),
  };
  await savePerson(vaultDir, key, person);
  return person;
}

/** Remove a person and their data folder. */
export async function deletePerson(vaultDir: string, id: string): Promise<void> {
  await rm(join(peopleDir(vaultDir), id), { recursive: true, force: true });
}
