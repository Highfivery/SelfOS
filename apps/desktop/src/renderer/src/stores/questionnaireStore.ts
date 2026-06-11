import { create } from 'zustand';
import type { Questionnaire, QuestionnaireInput } from '@shared/channels';

interface QuestionnaireState {
  questionnaires: Questionnaire[];
  loaded: boolean;
  /** User-defined custom types (the starter taxonomy lives in the builder). */
  customTypes: string[];
  load: () => Promise<void>;
  loadTypes: () => Promise<void>;
  addType: (name: string) => Promise<string[]>;
  /** Encrypt + store an attached image; returns its vault path + mime (null if the bridge is absent). */
  storeImage: (base64: string, mime: string) => Promise<{ imagePath: string; mime: string } | null>;
  /** Read a stored image back as base64 for display (null if absent). */
  getImage: (imagePath: string) => Promise<string | null>;
  deleteImage: (imagePath: string) => Promise<void>;
  save: (input: QuestionnaireInput) => Promise<Questionnaire | null>;
  remove: (id: string) => Promise<void>;
  validate: (input: QuestionnaireInput) => Promise<string[]>;
}

/** The sender's questionnaire definitions (08-questionnaires §3.1). CRUD flows through the bridge. */
export const useQuestionnaireStore = create<QuestionnaireState>((set, get) => ({
  questionnaires: [],
  loaded: false,
  customTypes: [],
  load: async () => {
    const questionnaires = (await window.selfos?.questionnairesList()) ?? [];
    set({ questionnaires, loaded: true });
  },
  loadTypes: async () => {
    set({ customTypes: (await window.selfos?.questionnairesListTypes()) ?? [] });
  },
  addType: async (name) => {
    const customTypes = (await window.selfos?.questionnairesAddType(name)) ?? get().customTypes;
    set({ customTypes });
    return customTypes;
  },
  storeImage: async (base64, mime) =>
    (await window.selfos?.questionnairesStoreImage({ base64, mime })) ?? null,
  getImage: async (imagePath) => (await window.selfos?.questionnairesGetImage(imagePath)) ?? null,
  deleteImage: async (imagePath) => {
    await window.selfos?.questionnairesDeleteImage(imagePath);
  },
  save: async (input) => {
    const saved = (await window.selfos?.questionnairesSave(input)) ?? null;
    await get().load();
    return saved;
  },
  remove: async (id) => {
    await window.selfos?.questionnairesDelete(id);
    await get().load();
  },
  validate: async (input) => (await window.selfos?.questionnairesValidate(input)) ?? [],
}));
