import { z } from 'zod';

/**
 * Zod schemas are the single source of truth for IPC payload shapes (00-architecture §6.1).
 * TS types are inferred from them. This module imports zod, so it must NOT be imported by the
 * sandboxed preload — the preload imports type-only from `./channels` instead.
 */

export const BootPhaseSchema = z.enum(['starting', 'onboarding', 'vault-error', 'ready']);
export type BootPhase = z.infer<typeof BootPhaseSchema>;

export const BootStateSchema = z.object({
  phase: BootPhaseSchema,
  vaultPath: z.string().nullable(),
  hasSettings: z.boolean(),
});
export type BootState = z.infer<typeof BootStateSchema>;

/** `.selfos/meta.json` — small app metadata stored inside the vault. */
export const VaultMetaSchema = z.object({
  schemaVersion: z.number().int().positive(),
  vaultId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VaultMeta = z.infer<typeof VaultMetaSchema>;

/** Saved main-window geometry (device-local). */
export const WindowBoundsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
});
export type WindowBounds = z.infer<typeof WindowBoundsSchema>;

/** A settings file (`config/settings.json` in the vault, or the device-local equivalent). */
export const SettingsFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  values: z.record(z.string(), z.unknown()),
});
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

/** Device-local state (in userData, never synced) — active vault + window geometry. */
export const DeviceStateSchema = z.object({
  schemaVersion: z.number().int().positive(),
  vaultPath: z.string().nullable(),
  /**
   * The iOS vault handle (07-mobile-platform §4): a security-scoped bookmark blob, not a path —
   * resolved on launch to regain access to the shared iCloud folder. The web preview host uses it as
   * the IndexedDB vault id. Optional; the boot logic picks whichever the platform provides (Electron
   * uses `vaultPath`). Additive, so existing device-state files parse unchanged.
   */
  vaultBookmark: z.string().optional(),
  window: WindowBoundsSchema.optional(),
  activePersonId: z.string().nullable().optional(),
  /**
   * @deprecated Migration source only (10-multi-device-vault §6.4). The super-admin hash now lives in
   * the vault (`config/superadmin.enc`); this device-local copy is read once to seed it, then unused.
   */
  superAdminPassphraseHash: z.string().optional(),
  /**
   * A member who redeemed an invite but hasn't yet set their PIN (10-multi-device-vault §5.4). Persisted
   * so a crash between redeem and finish resumes the "Set your PIN" step on next boot rather than
   * dropping into an open person picker. Cleared once the join completes.
   */
  pendingJoinPersonId: z.string().nullable().optional(),
  /** Whether the desktop sidebar is collapsed to an icon rail (device-local UI preference). */
  sidebarCollapsed: z.boolean().optional(),
});
export type DeviceState = z.infer<typeof DeviceStateSchema>;

/**
 * People, relationships, and access (04-people-roles). Person/Relationship content is written
 * encrypted at rest; these schemas validate the decrypted shape.
 */

export const PersonSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  displayName: z.string().min(1),
  isSubject: z.boolean(),
  pronouns: z.string().optional(),
  birthday: z.string().optional(),
  avatarPath: z.string().optional(),
  tags: z.array(z.string()),
  publicNotes: z.string().optional(),
  privateNotes: z.string().optional(),
  // Contact details (08-questionnaires) — used to prefill questionnaire delivery (mailto:/SMS). Encrypted
  // with the rest of the profile; intentionally excluded from `buildContext` (operational, not coaching
  // data). Additive-optional, so person files written before this parse unchanged (no migration needed).
  email: z.string().optional(),
  phone: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Person = z.infer<typeof PersonSchema>;

export const RelationshipTypeSchema = z.enum([
  'partner',
  'parent',
  'child',
  'sibling',
  'friend',
  'coworker',
  'ex',
  'other',
]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RelationshipSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  fromPersonId: z.string().min(1),
  toPersonId: z.string().min(1),
  type: RelationshipTypeSchema,
  label: z.string().optional(),
  closeness: z.number().int().min(1).max(5).optional(),
  since: z.string().optional(),
  publicNotes: z.string().optional(),
  privateNotes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const RoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  builtin: z.boolean(),
  capabilities: z.record(z.string(), z.boolean()),
});
export type Role = z.infer<typeof RoleSchema>;

export const AccountSchema = z.object({
  personId: z.string().min(1),
  roleId: z.string().min(1),
  pinHash: z.string().optional(),
});
export type Account = z.infer<typeof AccountSchema>;

export const AccessConfigSchema = z.object({
  schemaVersion: z.number().int().positive(),
  roles: z.array(RoleSchema),
  accounts: z.array(AccountSchema),
});
export type AccessConfig = z.infer<typeof AccessConfigSchema>;

/** Roles + accounts with PIN hashes stripped — safe to expose to the renderer (the IPC `AccessView`). */
export interface AccessView {
  roles: Role[];
  accounts: { personId: string; roleId: string; hasPin: boolean }[];
}

/** Non-secret view of a pending device-invite (10-multi-device-vault §5.4) — never the wrapped key or code. */
export interface InviteSummary {
  id: string;
  personId: string;
  createdAt: string;
  expiresAt: string;
}

/** Renderer-supplied person fields; the main process owns `id`, `schemaVersion`, and timestamps. */
export const PersonInputSchema = z.object({
  id: z.string().optional(),
  displayName: z.string().min(1),
  isSubject: z.boolean(),
  pronouns: z.string().optional(),
  birthday: z.string().optional(),
  tags: z.array(z.string()).default([]),
  publicNotes: z.string().optional(),
  privateNotes: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});
export type PersonInput = z.infer<typeof PersonInputSchema>;

export const RelationshipInputSchema = z.object({
  id: z.string().optional(),
  fromPersonId: z.string().min(1),
  toPersonId: z.string().min(1),
  type: RelationshipTypeSchema,
  label: z.string().optional(),
  closeness: z.number().int().min(1).max(5).optional(),
  since: z.string().optional(),
  publicNotes: z.string().optional(),
  privateNotes: z.string().optional(),
});
export type RelationshipInput = z.infer<typeof RelationshipInputSchema>;

/** AI usage accounting (06-ai-usage-and-budgets). One event per AI call, stored encrypted per person. */
export const UsageEventSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  type: z.string().min(1),
  personId: z.string().min(1),
  sessionId: z.string().optional(),
  model: z.string().min(1),
  at: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

export const BudgetSchema = z.object({
  limitUsd: z.number().nonnegative(),
  period: z.enum(['week', 'month']),
  warnRatio: z.number().min(0).max(1),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const BudgetsConfigSchema = z.object({
  schemaVersion: z.number().int().positive(),
  app: BudgetSchema.optional(),
  perPerson: z.record(z.string(), BudgetSchema),
});
export type BudgetsConfig = z.infer<typeof BudgetsConfigSchema>;

/** Conversations (05-conversations) — encrypted per-person chat transcripts. */
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  ts: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ConversationSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  personId: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(ChatMessageSchema),
});
export type Conversation = z.infer<typeof ConversationSchema>;

/**
 * The shared Insight / metrics layer (08-questionnaires §4.4). A single, source-discriminated record:
 * questionnaires produce them now; session analysis (09) and the tracking dashboards (11) build on the
 * same shape. Stored encrypted per subject person; `metrics` is the extensible basis for every trend.
 */
export const InsightSourceSchema = z.enum(['questionnaire', 'session']);
export type InsightSource = z.infer<typeof InsightSourceSchema>;

export const InsightFactSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  shareable: z.boolean(), // false = private to the subject; true = may feed related people's context
});
export type InsightFact = z.infer<typeof InsightFactSchema>;

export const InsightSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  source: InsightSourceSchema,
  subjectPersonId: z.string().min(1), // whose coaching this informs
  relationshipId: z.string().optional(),
  summary: z.string(),
  facts: z.array(InsightFactSchema),
  metrics: z.record(z.string(), z.number()).optional(), // named normalized signals; the basis for trends
  confidence: z.enum(['low', 'medium', 'high']),
  approved: z.boolean(), // questionnaire insights require approval before entering buildContext (08 §3.7)
  provenance: z.object({
    assignmentId: z.string().optional(),
    conversationId: z.string().optional(),
    at: z.string(),
  }),
  crisisFlag: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Insight = z.infer<typeof InsightSchema>;

/**
 * Questionnaires (08-questionnaires §4.2/§4.3). Created fresh (no templates), sent as an immutable
 * snapshot, and answered into a ResponseSet. All file shapes are Zod-validated + versioned.
 */

export const AnswerTypeSchema = z.enum([
  'shortText',
  'longText',
  'singleChoice',
  'multiChoice',
  'rating',
  'slider',
  'ranking',
  'thisOrThat',
  'yesNo',
  'date',
  'matrix',
  'allocation',
]);
export type AnswerType = z.infer<typeof AnswerTypeSchema>;

/** Simple conditional branching (v1): show a question/section when a prior answer equals a value. */
export const BranchRuleSchema = z.object({
  whenQuestionId: z.string().min(1),
  equals: z.union([z.string(), z.number(), z.boolean()]),
  action: z.literal('show'),
});
export type BranchRule = z.infer<typeof BranchRuleSchema>;

export const QuestionSchema = z.object({
  id: z.string().min(1),
  canonicalId: z.string().optional(), // shared across compatibility variants for alignment
  type: AnswerTypeSchema,
  prompt: z.string().min(1),
  help: z.string().optional(),
  required: z.boolean(),
  media: z
    .object({ imagePath: z.string().min(1), alt: z.string(), mime: z.string().min(1) })
    .optional(), // author-attached image (encrypted; ZK on relay). `mime` builds the display data URL.
  options: z.array(z.string()).optional(), // choice/ranking/thisOrThat/allocation buckets
  scale: z
    .object({
      min: z.number(),
      max: z.number(),
      minLabel: z.string().optional(),
      maxLabel: z.string().optional(),
      step: z.number().optional(),
    })
    .optional(),
  matrix: z
    .object({
      rows: z.array(z.string()),
      min: z.number(),
      max: z.number(),
      minLabel: z.string().optional(),
      maxLabel: z.string().optional(),
    })
    .optional(),
  metricKey: z.string().optional(), // rating/slider/matrix → populates Insight.metrics
  branch: BranchRuleSchema.optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const SensitivityTierSchema = z.enum([
  'standard',
  'intimacyGeneral',
  'explicit',
  'unfiltered',
]);
export type SensitivityTier = z.infer<typeof SensitivityTierSchema>;

export const CompatibilityConfigSchema = z.object({
  enabled: z.literal(true),
  visibility: z.enum(['sharedReport', 'senderSeesAll', 'eachSeesOwn']),
});
export type CompatibilityConfig = z.infer<typeof CompatibilityConfigSchema>;

export const QuestionnaireSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().positive(), // immutable-snapshot version; bumps on edit
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.string().min(1), // a starter-taxonomy key OR a user-defined custom type
  sensitivity: SensitivityTierSchema,
  questions: z.array(QuestionSchema),
  compatibility: CompatibilityConfigSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Questionnaire = z.infer<typeof QuestionnaireSchema>;

/** Renderer-supplied questionnaire fields; main owns id, schemaVersion, version, and timestamps. */
export const QuestionnaireInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.string().min(1),
  sensitivity: SensitivityTierSchema,
  questions: z.array(QuestionSchema),
  compatibility: CompatibilityConfigSchema.optional(),
});
export type QuestionnaireInput = z.infer<typeof QuestionnaireInputSchema>;

/**
 * Non-secret questionnaire prefs (`config/questionnaires.json` in the vault, plain JSON — §4.1).
 * Holds the user-defined **custom types** that reappear in the builder's type picker. Stored plain,
 * mirroring `config/settings.json`; default message templates land here with the relay slice.
 */
export const QuestionnairePrefsSchema = z.object({
  schemaVersion: z.number().int().positive(),
  customTypes: z.array(z.string().min(1)),
});
export type QuestionnairePrefs = z.infer<typeof QuestionnairePrefsSchema>;

/** A gap-finder proposal (08-questionnaires §3.7): a questionnaire idea + a few sample questions. */
export const QuestionnaireSuggestionSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  rationale: z.string(),
  questions: z.array(
    z.object({ type: AnswerTypeSchema, prompt: z.string().min(1), required: z.boolean() }),
  ),
});
export type QuestionnaireSuggestion = z.infer<typeof QuestionnaireSuggestionSchema>;

/** Outcome shapes for the AI authoring calls (08-questionnaires §13.3) — shared by the IPC + services. */
export type AiFailureReason = 'NO_KEY' | 'DENIED' | 'BUDGET' | 'REFUSED' | 'ERROR';
export interface QuestionnaireGenerateResult {
  ok: boolean;
  questions?: Question[];
  usage?: UsageEvent;
  reason?: AiFailureReason;
  message?: string;
}
export interface QuestionnaireImproveResult {
  ok: boolean;
  prompt?: string;
  usage?: UsageEvent;
  reason?: AiFailureReason;
  message?: string;
}
export interface QuestionnaireSuggestResult {
  ok: boolean;
  suggestions?: QuestionnaireSuggestion[];
  usage?: UsageEvent;
  reason?: AiFailureReason;
  message?: string;
}
export interface QuestionnaireAnalyzeResult {
  ok: boolean;
  insight?: Insight;
  usage?: UsageEvent;
  reason?: AiFailureReason | 'NO_RESPONSE';
  message?: string;
}

export const ChannelSchema = z.enum(['inApp', 'relay']);
export type Channel = z.infer<typeof ChannelSchema>;

export const AssignmentStatusSchema = z.enum([
  'draft',
  'sent',
  'opened',
  'inProgress',
  'submitted',
  'analyzed',
  'expired',
  'revoked',
  'declined',
]);
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;

export const PrivacyModeSchema = z.enum(['standard', 'private']);
export type PrivacyMode = z.infer<typeof PrivacyModeSchema>;

export const RecipientSchema = z.union([
  z.object({ kind: z.literal('person'), personId: z.string().min(1) }),
  z.object({
    kind: z.literal('external'),
    displayName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  }),
]);
export type Recipient = z.infer<typeof RecipientSchema>;

export const AssignmentSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  questionnaireId: z.string().min(1), // source definition id (provenance); the as-sent snapshot is keyed by assignment id
  senderPersonId: z.string().min(1),
  recipient: RecipientSchema,
  channel: ChannelSchema,
  privacy: PrivacyModeSchema,
  senderVisibleToRecipient: z.boolean(), // false = anonymous (external)
  status: AssignmentStatusSchema,
  expiresAt: z.string().optional(), // omitted = indefinite
  declineNote: z.string().optional(),
  relay: z
    .object({
      token: z.string().min(1),
      pinHash: z.string().min(1),
      publicKey: z.string().min(1),
      privateKeyWrapped: z.string().min(1),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const AnswerSchema = z.object({
  questionId: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const ResponseSetSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  assignmentId: z.string().min(1),
  reAskOf: z.string().optional(), // prior ResponseSet id → longitudinal chain
  answers: z.array(AnswerSchema),
  submittedAt: z.string(),
});
export type ResponseSet = z.infer<typeof ResponseSetSchema>;

/**
 * Derived "view" types produced by the core services and surfaced over IPC. They live here (a
 * crypto-free module) rather than alongside their services so `channels.ts` can import them from the
 * schemas shim without dragging `@selfos/core/crypto` into the renderer/web tsconfig (07-mobile-platform
 * §5.2). Not Zod-parsed — they are computed results, not file shapes.
 */

/** Rolled-up AI usage for the dashboard (06-ai-usage-and-budgets). */
export interface UsageSummary {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  cacheSavingsUsd: number;
  sessionCount: number;
  avgCostPerSession: number;
  avgCostPerType: number;
  byType: Record<string, { costUsd: number; count: number }>;
  byModel: Record<string, { costUsd: number; count: number }>;
  byPerson: Record<string, { costUsd: number; count: number }>;
}

export type BudgetStateKind = 'none' | 'ok' | 'warn' | 'over';
export interface BudgetState {
  state: BudgetStateKind;
  spentUsd: number;
  limitUsd: number | null;
  period: 'week' | 'month' | null;
}

export type ChatTurnResult =
  | { ok: true; conversation: Conversation; usage: UsageEvent }
  | { ok: false; reason: 'NO_KEY' | 'BUDGET' | 'ERROR'; message: string };
