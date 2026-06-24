import { create } from 'zustand';
import type {
  Questionnaire,
  QuestionnaireInput,
  QuestionnaireSendState,
  SelfosBridge,
} from '@shared/channels';

// Derive AI call shapes from the bridge contract so the store never drifts from the IPC.
type GenerateInput = Parameters<SelfosBridge['questionnairesGenerate']>[0];
type GenerateResult = Awaited<ReturnType<SelfosBridge['questionnairesGenerate']>>;
type ImproveInput = Parameters<SelfosBridge['questionnairesImproveQuestion']>[0];
type ImproveResult = Awaited<ReturnType<SelfosBridge['questionnairesImproveQuestion']>>;
type SuggestInput = Parameters<SelfosBridge['gapfinderSuggest']>[0];
type SuggestResult = Awaited<ReturnType<SelfosBridge['gapfinderSuggest']>>;

const AI_UNAVAILABLE = {
  ok: false as const,
  reason: 'ERROR' as const,
  message: 'AI is unavailable.',
};

interface QuestionnaireState {
  questionnaires: Questionnaire[];
  loaded: boolean;
  /** Per-questionnaire send state for the author's list (keyed by id): latest send time + count. */
  sendStates: Record<string, QuestionnaireSendState>;
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
  /** AI authoring (budget-gated + metered in main). */
  generate: (input: GenerateInput) => Promise<GenerateResult>;
  improveQuestion: (input: ImproveInput) => Promise<ImproveResult>;
  suggest: (input: SuggestInput) => Promise<SuggestResult>;
  save: (input: QuestionnaireInput) => Promise<Questionnaire | null>;
  remove: (id: string) => Promise<void>;
  validate: (input: QuestionnaireInput) => Promise<string[]>;
  setFavorite: (id: string, favorite: boolean) => Promise<void>;
}

/** The sender's questionnaire definitions (08-questionnaires §3.1). CRUD flows through the bridge. */
export const useQuestionnaireStore = create<QuestionnaireState>((set, get) => ({
  questionnaires: [],
  loaded: false,
  sendStates: {},
  customTypes: [],
  load: async () => {
    const [questionnaires, sendStates] = await Promise.all([
      window.selfos?.questionnairesList() ?? [],
      window.selfos?.questionnairesSendStates() ?? {},
    ]);
    set({ questionnaires, sendStates, loaded: true });
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
  generate: async (input) => (await window.selfos?.questionnairesGenerate(input)) ?? AI_UNAVAILABLE,
  improveQuestion: async (input) =>
    (await window.selfos?.questionnairesImproveQuestion(input)) ?? AI_UNAVAILABLE,
  suggest: async (input) => (await window.selfos?.gapfinderSuggest(input)) ?? AI_UNAVAILABLE,
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
  setFavorite: async (id, favorite) => {
    // Optimistic flip so the star + sort respond instantly; the bridge persists it (no version bump).
    set({
      questionnaires: get().questionnaires.map((q) => (q.id === id ? { ...q, favorite } : q)),
    });
    await window.selfos?.questionnairesSetFavorite({ id, favorite });
  },
}));
