import { create } from 'zustand';
import type { Person, PersonInput, Relationship, RelationshipInput } from '@shared/channels';

interface PeopleState {
  people: Person[];
  relationships: Relationship[];
  loaded: boolean;
  load: () => Promise<void>;
  savePerson: (input: PersonInput) => Promise<Person | null>;
  removePerson: (id: string) => Promise<void>;
  saveRelationship: (input: RelationshipInput) => Promise<void>;
  removeRelationship: (id: string) => Promise<void>;
}

export const usePeopleStore = create<PeopleState>((set, get) => ({
  people: [],
  relationships: [],
  loaded: false,
  load: async () => {
    const people = (await window.selfos?.peopleList()) ?? [];
    const relationships = (await window.selfos?.relationshipsList()) ?? [];
    set({ people, relationships, loaded: true });
  },
  savePerson: async (input) => {
    const saved = (await window.selfos?.peopleSave(input)) ?? null;
    await get().load();
    return saved;
  },
  removePerson: async (id) => {
    await window.selfos?.peopleDelete(id);
    await get().load();
  },
  saveRelationship: async (input) => {
    await window.selfos?.relationshipsSave(input);
    await get().load();
  },
  removeRelationship: async (id) => {
    await window.selfos?.relationshipsDelete(id);
    await get().load();
  },
}));
