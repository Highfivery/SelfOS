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
