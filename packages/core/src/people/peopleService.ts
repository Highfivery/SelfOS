import type { FileSystem } from '../host';
import { uuid } from '../id';
import { PersonSchema, type Person, type PersonInput } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

const PEOPLE_DIR = 'people';

function profilePath(id: string): string {
  return `${PEOPLE_DIR}/${id}/profile.enc`;
}

export async function getPerson(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
): Promise<Person | null> {
  const raw = await readEncryptedJson(fs, profilePath(id), key);
  return raw === null ? null : PersonSchema.parse(raw);
}

export async function savePerson(fs: FileSystem, key: Uint8Array, person: Person): Promise<void> {
  await writeEncryptedJson(fs, profilePath(person.id), person, key);
}

export async function listPeople(fs: FileSystem, key: Uint8Array): Promise<Person[]> {
  const people: Person[] = [];
  for (const name of await fs.list(PEOPLE_DIR)) {
    const person = await getPerson(fs, key, name);
    if (person) people.push(person);
  }
  return people.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Create or update a person from renderer input; the main process owns id + timestamps. */
export async function upsertPerson(
  fs: FileSystem,
  key: Uint8Array,
  input: PersonInput,
): Promise<Person> {
  const existing = input.id ? await getPerson(fs, key, input.id) : null;
  const now = new Date().toISOString();
  const person: Person = {
    id: existing?.id ?? input.id ?? uuid(),
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
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    // Descriptive profile fields (13-dream-images §4.6) — additive-optional, conditionally spread so a
    // person saved without them stays clean (exactOptionalPropertyTypes).
    ...(input.gender !== undefined ? { gender: input.gender } : {}),
    ...(input.appearanceDescription !== undefined
      ? { appearanceDescription: input.appearanceDescription }
      : {}),
    ...(input.ethnicity !== undefined ? { ethnicity: input.ethnicity } : {}),
    ...(input.occupation !== undefined ? { occupation: input.occupation } : {}),
    ...(input.interests !== undefined ? { interests: input.interests } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.goals !== undefined ? { goals: input.goals } : {}),
    ...(input.communicationStyle !== undefined
      ? { communicationStyle: input.communicationStyle }
      : {}),
    ...(input.values !== undefined ? { values: input.values } : {}),
    ...(input.languages !== undefined ? { languages: input.languages } : {}),
    ...(input.importantDates !== undefined ? { importantDates: input.importantDates } : {}),
    ...(input.healthNotes !== undefined ? { healthNotes: input.healthNotes } : {}),
    ...(input.faith !== undefined ? { faith: input.faith } : {}),
  };
  await savePerson(fs, key, person);
  return person;
}

/** Remove a person and their data folder. */
export async function deletePerson(fs: FileSystem, id: string): Promise<void> {
  await fs.remove(`${PEOPLE_DIR}/${id}`);
}
