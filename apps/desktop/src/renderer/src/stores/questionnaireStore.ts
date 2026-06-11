import { create } from 'zustand';
import type { Questionnaire, QuestionnaireInput } from '@shared/channels';

interface QuestionnaireState {
  questionnaires: Questionnaire[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (input: QuestionnaireInput) => Promise<Questionnaire | null>;
  remove: (id: string) => Promise<void>;
  validate: (input: QuestionnaireInput) => Promise<string[]>;
}

/** The sender's questionnaire definitions (08-questionnaires §3.1). CRUD flows through the bridge. */
export const useQuestionnaireStore = create<QuestionnaireState>((set, get) => ({
  questionnaires: [],
  loaded: false,
  load: async () => {
    const questionnaires = (await window.selfos?.questionnairesList()) ?? [];
    set({ questionnaires, loaded: true });
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
