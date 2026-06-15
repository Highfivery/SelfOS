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
 * A device-state update patch. Like `Partial<DeviceState>`, but `vaultBookmark` (the optional iOS/web
 * vault pointer) may be set to `undefined` to explicitly clear it — it's dropped on the JSON write
 * (14-vault-relinking §5.1). Required-nullable fields (e.g. `vaultPath`) still take `null`, not
 * `undefined`, so this stays sound.
 */
export type DeviceStatePatch = Omit<Partial<DeviceState>, 'vaultBookmark'> & {
  vaultBookmark?: string | undefined;
};

/**
 * People, relationships, and access (04-people-roles). Person/Relationship content is written
 * encrypted at rest; these schemas validate the decrypted shape.
 */

/**
 * The controllable person fields the owner can lock to own-context-only (15-shareability §4.1) — the
 * single source of truth shared by the editor, `buildContext`, and `buildDepictionNote`. `displayName`
 * (identity) is always shared; `email`/`phone` are delivery-only and never in context, so neither is
 * controllable. `birthday`'s only sharing effect is the dream-image depiction age (it's not narrated).
 */
export const PersonFieldKeySchema = z.enum([
  'pronouns',
  'birthday',
  'gender',
  'appearanceDescription',
  'ethnicity',
  'occupation',
  'interests',
  'location',
  'goals',
  'communicationStyle',
  'values',
  'languages',
  'importantDates',
  'notes',
  'healthNotes',
  'faith',
  // Promoted from the onboarding intake (18 §14.6) — structured life facts the coach can use directly.
  // relationshipStatus/parentalStatus/livingSituation default shared; sexualOrientation/relationshipStyle
  // default private (the intake adds them to `privateFields` when filled).
  'relationshipStatus',
  'parentalStatus',
  'livingSituation',
  'sexualOrientation',
  'relationshipStyle',
]);
export type PersonFieldKey = z.infer<typeof PersonFieldKeySchema>;
/** Every controllable key, in editor/context order (derived from the schema so the two can't drift). */
export const PERSON_FIELD_KEYS = PersonFieldKeySchema.options;

export const PersonSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  displayName: z.string().min(1),
  isSubject: z.boolean(),
  pronouns: z.string().optional(),
  birthday: z.string().optional(),
  avatarPath: z.string().optional(),
  tags: z.array(z.string()),
  // The single merged notes field (15-shareability §4.3) — `publicNotes` + `privateNotes` collapsed into
  // one. Shareability is now per-field (`privateFields`), not bucket-by-name. Feeds the person's own
  // context always, and related people's context when `'notes'` is not in `privateFields`.
  notes: z.string().optional(),
  // Contact details (08-questionnaires) — used to prefill questionnaire delivery (mailto:/SMS). Encrypted
  // with the rest of the profile; intentionally excluded from `buildContext` (operational, not coaching
  // data). Additive-optional, so person files written before this parse unchanged (no migration needed).
  email: z.string().optional(),
  phone: z.string().optional(),
  // Descriptive profile fields (13-dream-images §4.6). The depiction subset (appearanceDescription +
  // gender + ethnicity + exact age from `birthday`) feeds the dream-image prompt (13 §8.2). Each is a
  // controllable key (above): it feeds related people's context (and the depiction) only while NOT locked
  // (15-shareability §4.1). `birthday` (above) is reused for age — not duplicated.
  gender: z.string().optional(), // small enum (female/male/non-binary/prefer-not-to-say) + free-text "other"
  appearanceDescription: z.string().optional(),
  ethnicity: z.string().optional(),
  occupation: z.string().optional(),
  interests: z.array(z.string()).optional(),
  location: z.string().optional(),
  goals: z.string().optional(),
  communicationStyle: z.string().optional(),
  values: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  importantDates: z
    .array(z.object({ label: z.string().min(1), date: z.string().min(1) }))
    .optional(),
  // Formerly always-private (health/faith); now controllable like every other field, defaulting to shared
  // (15-shareability §3.1). Still never sent to the image provider (only the depiction subset is, 13 §8.2).
  healthNotes: z.string().optional(),
  faith: z.string().optional(),
  // Promoted intake life-facts (18 §14.6) — additive-optional, no schemaVersion bump (the email/phone
  // precedent). The first three default shared; the last two are added to `privateFields` when the intake
  // fills them. None feed `buildDepictionNote` (never an image input).
  relationshipStatus: z.string().optional(),
  parentalStatus: z.string().optional(),
  livingSituation: z.string().optional(),
  sexualOrientation: z.string().optional(),
  relationshipStyle: z.string().optional(),
  // The controllable field keys the owner has locked to own-context-only (15-shareability §4.1). Absent or
  // not listed ⇒ shareable (the default). Storing only the opt-OUTs keeps it minimal + additive-optional.
  privateFields: z.array(PersonFieldKeySchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Person = z.infer<typeof PersonSchema>;

/**
 * The one shareability gate (15-shareability §4.1): a controllable person field is shared unless the owner
 * has locked it. Used by `buildContext` (related-person block), `buildDepictionNote`, and the editor.
 */
export function isPersonFieldShared(
  person: Pick<Person, 'privateFields'>,
  key: PersonFieldKey,
): boolean {
  return !(person.privateFields?.includes(key) ?? false);
}

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
  // The single merged notes field (15-shareability §4.3b) — `publicNotes` + `privateNotes` collapsed into
  // one, with one share flag. `notesShared` absent ⇒ shared (the default); `false` keeps the notes out of
  // the OTHER person's context. The relationship `type` is structural and always shown.
  notes: z.string().optional(),
  notesShared: z.boolean().optional(),
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
  notes: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  // Descriptive profile fields (13-dream-images §4.6) — mirror PersonSchema; main owns id/version/timestamps.
  gender: z.string().optional(),
  appearanceDescription: z.string().optional(),
  ethnicity: z.string().optional(),
  occupation: z.string().optional(),
  interests: z.array(z.string()).optional(),
  location: z.string().optional(),
  goals: z.string().optional(),
  communicationStyle: z.string().optional(),
  values: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  importantDates: z
    .array(z.object({ label: z.string().min(1), date: z.string().min(1) }))
    .optional(),
  healthNotes: z.string().optional(),
  faith: z.string().optional(),
  // Promoted intake life-facts (18 §14.6) — mirror PersonSchema.
  relationshipStatus: z.string().optional(),
  parentalStatus: z.string().optional(),
  livingSituation: z.string().optional(),
  sexualOrientation: z.string().optional(),
  relationshipStyle: z.string().optional(),
  // Per-field shareability locks (15-shareability §4.1) — the keys the owner locked to own-context-only.
  privateFields: z.array(PersonFieldKeySchema).optional(),
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
  notes: z.string().optional(),
  notesShared: z.boolean().optional(),
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

/**
 * Session lifecycle status (09-session-analysis §14.1). `inProgress` is the default; `onHold` is a
 * user-only "paused, will return" signal; `complete` is the wrapped state that offers "End & summarize".
 */
export const SessionStatusSchema = z.enum(['inProgress', 'onHold', 'complete']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const ConversationSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  personId: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(ChatMessageSchema),
  // Lifecycle + analysis (09-session-analysis §4/§14.1). All additive-optional — an existing transcript
  // with none of these reads as an `inProgress`, never-summarized session, so no schemaVersion bump or
  // transform is needed (the dreams/people additive-field precedent). `status` absent ⇒ `inProgress`.
  status: SessionStatusSchema.optional(),
  endedAt: z.string().optional(), // set when status → 'complete'; absent = not yet completed
  insightId: z.string().optional(), // the current SessionInsight for this conversation
  insightStale: z.boolean().optional(), // true after continuing past an end → re-run on next end
  // Guided sessions (16-guided-sessions §4.2). Additive-optional — absent `guideId` ⇒ a free session
  // (today's behaviour). `guideStep` is the current step index for structured exercises only.
  guideId: z.string().optional(),
  guideStep: z.number().int().nonnegative().optional(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

/** A conversation's lifecycle status, normalizing absent ⇒ `inProgress` (09 §14.1). */
export function conversationStatus(c: Pick<Conversation, 'status'>): SessionStatus {
  return c.status ?? 'inProgress';
}

/**
 * The shared Insight / metrics layer (08-questionnaires §4.4). A single, source-discriminated record:
 * questionnaires produce them now; session analysis (09), the tracking dashboards (11), and dreams (12)
 * build on the same shape. Stored encrypted per subject person; `metrics` is the extensible basis for
 * every trend. `'dream'` is the third producer (12-dreams §1.1) and `'intake'` the fourth
 * (18-personal-onboarding §4.1) — both additive, so existing Insights parse unchanged.
 */
export const InsightSourceSchema = z.enum(['questionnaire', 'session', 'dream', 'intake']);
export type InsightSource = z.infer<typeof InsightSourceSchema>;

export const InsightFactSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  shareable: z.boolean(), // false = private to the subject; true = may feed related people's context
  // Per-person targeted sharing (12-dreams §3.4): person ids this fact is shared with, in addition to the
  // broadcast `shareable` boolean. Additive-optional — existing facts parse unchanged, no migration.
  shareableWith: z.array(z.string()).optional(),
  // Break-glass-only (18-personal-onboarding §8.4): a fact derived from a `restricted` intake section
  // ("what weighs on you" / intimacy). It still feeds the subject's OWN coaching context, but is withheld
  // from the owner's normal People/Memory views — reachable only via the audited reveal. Additive-optional.
  restricted: z.boolean().optional(),
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
    dreamId: z.string().optional(), // set for dream-sourced insights (12-dreams §4.4)
    compatibilityGroupId: z.string().optional(), // set for compatibility alignment insights (08 §13.5d)
    guideId: z.string().optional(), // set when the session was a guided exercise (16-guided-sessions §3.5)
    intakeSection: z.string().optional(), // set for intake-sourced facts (18-personal-onboarding §4.1)
    at: z.string(),
  }),
  crisisFlag: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Insight = z.infer<typeof InsightSchema>;

/**
 * A profile-update suggestion (18-personal-onboarding §15) — the self-maintaining-profile signal. Produced as
 * a by-product of the session/dream/questionnaire analysis passes that already run (no extra AI spend): when
 * the analysis sees a fact that contradicts or extends a known profile/intake answer, it proposes an update.
 * It is a **proposal, never an edit** — the field/answer changes only when the person accepts. Stored
 * per-subject at `people/<id>/profile-suggestions/<id>.enc`. A `restricted`-derived suggestion (intimacy/
 * trauma) is itself restricted (own-context-only, owner-visible — §8.4).
 */
export const ProfileSuggestionStatusSchema = z.enum(['pending', 'accepted', 'dismissed']);
export type ProfileSuggestionStatus = z.infer<typeof ProfileSuggestionStatusSchema>;

export const ProfileUpdateSuggestionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1),
  kind: z.enum(['field', 'intakeSection']),
  field: PersonFieldKeySchema.optional(), // set for kind 'field'
  sectionId: z.string().optional(), // set for kind 'intakeSection'
  observed: z.string().min(1), // what the recent activity implies the new value is
  current: z.string().optional(), // the known value it would replace, if any
  rationale: z.string(), // a short, human reason ("a recent session mentioned a new job")
  sourceInsightId: z.string().min(1),
  sourceKind: z.enum(['session', 'dream', 'questionnaire', 'intake']),
  restricted: z.boolean(),
  status: ProfileSuggestionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProfileUpdateSuggestion = z.infer<typeof ProfileUpdateSuggestionSchema>;

/** The raw shape an analysis pass emits (model output) — validated before it's trusted (§15.6). */
export const RawProfileSuggestionSchema = z.object({
  field: z.string(),
  observed: z.string().min(1),
  current: z.string().optional(),
  rationale: z.string().default(''),
});
export type RawProfileSuggestion = z.infer<typeof RawProfileSuggestionSchema>;

/**
 * Personal onboarding — the "getting to know you" intake (18-personal-onboarding §4.1). An AI-guided,
 * resumable self-interview across sections, stored encrypted under the person at
 * `people/<id>/intake/session.enc` (never in the Sessions list). The interview transcript per section lives
 * here; the synthesized portrait is an `Insight` (`source: 'intake'`) in the shared layer. The 18+ ack for
 * the intimacy block is NOT stored here — it reuses the shared `guidance/prefs.enc` `adultAcknowledged`
 * flag (16-guided-sessions), so acking once anywhere unlocks both surfaces.
 */
export const IntakeSectionStatusSchema = z.enum([
  'notStarted',
  'inProgress',
  'skipped',
  'complete',
]);
export type IntakeSectionStatus = z.infer<typeof IntakeSectionStatusSchema>;

/**
 * A structured intake answer value (18 §14). Widened from a bare string (the chat-era direct fills) to cover
 * the form answer types reused from the questionnaire engine: single-choice/short/long text (string),
 * multi-select/ranking (string[]), rating/slider (number), yes/no (boolean). Additive — existing string
 * answers still parse, so no schemaVersion bump.
 */
export const IntakeAnswerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);
export type IntakeAnswerValue = z.infer<typeof IntakeAnswerValueSchema>;

export const IntakeSectionSchema = z.object({
  id: z.string().min(1),
  status: IntakeSectionStatusSchema,
  // heavy/intimate sections → restricted in owner views (§8.4). Mirrors the catalog (the catalog is the
  // source of truth; this is stamped at section creation so a read knows it without the catalog).
  restricted: z.boolean(),
  messages: z.array(ChatMessageSchema), // the chat transcript (chat sections + go-deeper); excludes the opener
  answers: z.record(z.string(), IntakeAnswerValueSchema), // structured form answers, keyed by question id
  reflection: z.string().optional(), // the light per-section member-facing reflection (§11.3)
});
export type IntakeSection = z.infer<typeof IntakeSectionSchema>;

export const IntakeSessionStatusSchema = z.enum(['inProgress', 'complete']);
export type IntakeSessionStatus = z.infer<typeof IntakeSessionStatusSchema>;

export const IntakeSessionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  personId: z.string().min(1),
  status: IntakeSessionStatusSchema,
  sections: z.array(IntakeSectionSchema),
  insightId: z.string().optional(), // the portrait Insight (set once synthesized)
  portrait: z.string().optional(), // the member-facing closing portrait summary (set at final synthesis)
  // Per-answer signature (sectionId.questionId → cheap hash) snapshotted at the LAST portrait synthesis, so a
  // deterministic "your portrait is X% out of date" nudge can detect added/edited/cleared answers since (§15).
  portraitAnswerSig: z.record(z.string(), z.number()).optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});
export type IntakeSession = z.infer<typeof IntakeSessionSchema>;

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
  placeholder: z.string().optional(), // example/hint text for free-text answers (additive)
  group: z.string().optional(), // optional accordion group heading for long forms (18 §14.3, additive)
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

/**
 * Compatibility visibility (08-questionnaires §3.6/§16.2) — the author's choice that **derives the
 * recipient's disclosure**: `sharedReport` (joint report only, raw hidden both ways), `eachSeesOwn` (each
 * answerer also sees their own answers), `senderSeesAll` (the sender may reveal raw — needs
 * `questionnaires.readRaw`), `contextOnly` (NO report or raw sharing — each participant's own answers are
 * distilled into an own-context Insight that quietly informs their own coach; the most private mode).
 */
export const CompatibilityVisibilitySchema = z.enum([
  'sharedReport',
  'senderSeesAll',
  'eachSeesOwn',
  'contextOnly',
]);
export type CompatibilityVisibility = z.infer<typeof CompatibilityVisibilitySchema>;

export const CompatibilityConfigSchema = z.object({
  enabled: z.literal(true),
  visibility: CompatibilityVisibilitySchema,
});
export type CompatibilityConfig = z.infer<typeof CompatibilityConfigSchema>;

export const QuestionnaireSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().positive(), // immutable-snapshot version; bumps on edit
  // Who authored it — set by main on create from the active person, never the renderer. Gates "a creator
  // may delete their own questionnaire only while unsent" (§3.9). Additive-optional (legacy defs lack it →
  // only the Owner can delete those); no schemaVersion bump.
  creatorPersonId: z.string().optional(),
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
  // Links the two paired sends of a compatibility questionnaire (08-questionnaires §3.6/§13.5d) so the
  // alignment report can find them. Additive-optional — non-compatibility sends omit it, no migration.
  compatibilityGroupId: z.string().optional(),
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
  // The persisted answer value. The `Record<string, number>` arm carries matrix (row → point) and
  // allocation (option → amount) answers — matching the live `AnswerValue` the answering renderer emits.
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.record(z.string(), z.number()),
  ]),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const ResponseSetSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  assignmentId: z.string().min(1),
  reAskOf: z.string().optional(), // prior ResponseSet id → longitudinal chain
  answers: z.array(AnswerSchema),
  // Present once the recipient submits; absent while the response is a saved-but-unsubmitted draft
  // (save/resume, §3.3). The assignment status (`inProgress` vs `submitted`) is the authoritative
  // lifecycle marker; `submittedAt` is the submission timestamp. Relaxing required→optional is
  // additive (existing submitted responses still parse) — no schemaVersion bump.
  submittedAt: z.string().optional(),
});
export type ResponseSet = z.infer<typeof ResponseSetSchema>;

// ── Relay: external zero-knowledge delivery (08-questionnaires §3.4/§4.5/§5.4/§8.6) ──────────────────
// The Worker stores ONLY ciphertext. Questions (+ author images) are sealed under a symmetric content
// key carried in the URL **fragment** (never sent to the server); responses are sealed to the send's
// public key in the recipient's browser. These schemas validate every wire boundary on both hosts.

/** AES-256-GCM envelope (matches the crypto `EncryptedEnvelope`), Zod-validated at the relay boundary. */
export const EncryptedEnvelopeSchema = z.object({
  v: z.literal(1),
  alg: z.literal('aes-256-gcm'),
  iv: z.string().min(1),
  tag: z.string().min(1),
  data: z.string(),
});
export type EncryptedEnvelopeData = z.infer<typeof EncryptedEnvelopeSchema>;

/**
 * The plaintext questionnaire content the recipient's browser decrypts with the URL-fragment content
 * key. The relay only ever holds the sealed form of this. `images` maps each `Question.media.imagePath`
 * to its bytes sealed under the same content key (§8.6), so author images decrypt client-side too.
 */
export const RelayContentSchema = z.object({
  schemaVersion: z.number().int().positive(),
  questionnaire: QuestionnaireSchema, // the immutable as-sent snapshot the recipient answers
  publicKey: z.string().min(1), // seal responses to this (ECDH P-256, base64 raw)
  senderName: z.string().nullable(), // null = anonymous
  disclosure: z.string(), // the honest privacy text, DERIVED from privacy/visibility (§8.4)
  images: z.record(z.string(), EncryptedEnvelopeSchema), // imagePath → sealed bytes (content key)
});
export type RelayContent = z.infer<typeof RelayContentSchema>;

/** A response sealed to the send public key (ephemeral ECDH + AES-GCM) — the relay never sees plaintext. */
export const SealedResponseSchema = z.object({
  epk: z.string().min(1), // ephemeral public key (base64 raw)
  env: EncryptedEnvelopeSchema, // AES-GCM(RelayResponsePayload)
});
export type SealedResponse = z.infer<typeof SealedResponseSchema>;

/** Age attestation captured on the relay before sensitive content renders (§8.3). */
export const AgeAttestationSchema = z.object({
  tier: SensitivityTierSchema,
  method: z.enum(['checkbox', 'dob']),
  bornBefore: z.string().optional(), // the DOB the recipient attested being born on/before (dob method)
});
export type AgeAttestation = z.infer<typeof AgeAttestationSchema>;

/** The consent/disclosure the recipient saw, sealed inside the response (the app fills in the rest). */
export const RelayConsentInfoSchema = z.object({
  disclosureShown: z.string(),
  senderShown: z.string().nullable(),
  ageAttestation: AgeAttestationSchema.optional(),
});
export type RelayConsentInfo = z.infer<typeof RelayConsentInfoSchema>;

/** What's inside a sealed response — a submission or a decline (both zero-knowledge to the relay). */
export const RelayResponsePayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('submit'),
    answers: z.array(AnswerSchema),
    submittedAt: z.string(),
    consent: RelayConsentInfoSchema.optional(),
  }),
  z.object({ kind: z.literal('decline'), note: z.string().optional(), at: z.string() }),
]);
export type RelayResponsePayload = z.infer<typeof RelayResponsePayloadSchema>;

/** The mailbox the app uploads + the Worker stores per token (ciphertext + the PIN gate). */
export const RelayMailboxSchema = z.object({
  schemaVersion: z.number().int().positive(),
  token: z.string().min(1),
  sealedContent: EncryptedEnvelopeSchema, // RelayContent sealed under the fragment content key
  pinHash: z.string().min(1), // scrypt `salt:hash`; the Worker PIN-gates content release (rate-limited)
  createdAt: z.string(),
  expiresAt: z.string().optional(), // unclaimed expiry (§11.3); omitted = the 60-day default applied app-side
});
export type RelayMailbox = z.infer<typeof RelayMailboxSchema>;

/** A response the Worker is holding for the app to drain (purge-on-drain). */
export const RelayStoredResponseSchema = z.object({
  sealed: SealedResponseSchema,
  receivedAt: z.string(),
});
export type RelayStoredResponse = z.infer<typeof RelayStoredResponseSchema>;

/** The consent/disclosure receipt stored with an external response (§4.5/§8.3/§8.5). */
export const ConsentReceiptSchema = z.object({
  schemaVersion: z.number().int().positive(),
  assignmentId: z.string().min(1),
  disclosureShown: z.string(), // the exact derived privacy text shown
  senderShown: z.string().nullable(), // the name shown, or null if anonymous
  ageAttestation: AgeAttestationSchema.optional(),
  at: z.string(),
});
export type ConsentReceipt = z.infer<typeof ConsentReceiptSchema>;

/**
 * The per-household relay configuration (`config/relay.enc`, encrypted — §4.1/§4.5). The Cloudflare API
 * token + the drain secret are secrets that **never cross to the renderer** (the IPC bridge is the
 * boundary); they live host-side only. `relayVersion` is the deployed Worker version for one-click update.
 */
export const RelayConfigSchema = z.object({
  schemaVersion: z.number().int().positive(),
  endpointUrl: z.string().min(1),
  drainSecret: z.string().min(1),
  cloudflare: z.object({
    accountId: z.string().min(1),
    apiToken: z.string().min(1),
    relayVersion: z.string().min(1),
    scriptName: z.string().min(1), // the deployed Worker name (for update/teardown)
    kvNamespaceId: z.string().min(1), // the provisioned KV namespace (for teardown)
  }),
});
export type RelayConfig = z.infer<typeof RelayConfigSchema>;

/** Renderer-safe relay status (no secrets) for the admin Settings → Relay panel. */
export const RelayStatusSchema = z.object({
  configured: z.boolean(),
  endpointUrl: z.string().optional(),
  relayVersion: z.string().optional(),
  updateAvailable: z.boolean(),
});
export type RelayStatus = z.infer<typeof RelayStatusSchema>;

/** How aligned two answerers were on one canonical question (08-questionnaires §3.6). */
export const AlignmentAgreementSchema = z.enum(['aligned', 'mixed', 'divergent']);
export type AlignmentAgreement = z.infer<typeof AlignmentAgreementSchema>;

export const AlignmentItemSchema = z.object({
  canonicalId: z.string(),
  prompt: z.string(),
  agreement: AlignmentAgreementSchema,
  note: z.string(),
});
export type AlignmentItem = z.infer<typeof AlignmentItemSchema>;

/**
 * The AI-aligned compatibility report (08-questionnaires §3.6/§13.5d): the two answerers' responses
 * aligned by `canonicalId` into a summary + per-question agreement. Stored encrypted at
 * `questionnaires/compat/<groupId>/report.enc`. Generating it also drafts an Insight (subject = sender)
 * reviewed in Memory; `insightId` records that link.
 */
export const AlignmentReportSchema = z.object({
  schemaVersion: z.number().int().positive(),
  compatibilityGroupId: z.string().min(1),
  questionnaireId: z.string().min(1),
  personAName: z.string(),
  personBName: z.string(),
  summary: z.string(),
  items: z.array(AlignmentItemSchema),
  crisisFlag: z.boolean().optional(),
  insightId: z.string().optional(),
  generatedAt: z.string(),
});
export type AlignmentReport = z.infer<typeof AlignmentReportSchema>;

/**
 * Dreams (12-dreams). A person captures a dream (narrative-first), optionally works through a guided
 * analysis that synthesizes a structured DreamAnalysis, and — once approved — that analysis becomes an
 * Insight (`source: 'dream'`) feeding `buildContext`. All shapes are Zod-validated, versioned, and stored
 * encrypted under the dreamer's folder; dreams are private to the dreamer (12 §8.4). The per-dream
 * `sensitivity` reuses 08's `SensitivityTier` (12 §8.3); trauma is the orthogonal `nightmare` flag.
 */

/** Someone who appeared in a dream — linked to the People graph (04) when known, else a free name. */
export const DreamPersonRefSchema = z
  .object({
    personId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  // Exactly one identity is meaningful: a People-graph link OR a free name, never an empty ref (12 §4.2).
  .refine((ref) => Boolean(ref.personId ?? ref.name), {
    message: 'a dream person needs a personId or a name',
  });
export type DreamPersonRef = z.infer<typeof DreamPersonRefSchema>;

export const DreamStatusSchema = z.enum(['captured', 'analyzing', 'analyzed']);
export type DreamStatus = z.infer<typeof DreamStatusSchema>;

/**
 * The generated dream-image descriptor (13-dream-images §4.2) — metadata only; the encrypted bytes live
 * beside it at `people/<id>/dreams/<id>/image.enc`. Additive-optional on `Dream` — **no `schemaVersion`
 * bump, no migration** (the `Person.email` / `Insight.dreamId` precedent). Absent = the dream has no image.
 */
export const DreamImageDescriptorSchema = z.object({
  style: z.string().min(1), // the style used (e.g. 'dreamlike'); free string so styles can grow
  mime: z.string().min(1), // e.g. 'image/png' — builds the display data URL (08 §13.2 `mime` precedent)
  generatedAt: z.string(),
  model: z.string().min(1), // the OpenAI image model used (provenance; cost is snapshotted in the UsageEvent)
  // Per-dream sharing (13 §3.6): the related-person ids this image is shared with (the 12 §13.5
  // InsightFact.shareableWith model). Absent/[] = dreamer-only. Re-gated at read time. Lands in slice 5.
  shareableWith: z.array(z.string()).optional(),
});
export type DreamImageDescriptor = z.infer<typeof DreamImageDescriptorSchema>;

export const DreamSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  personId: z.string().min(1), // the dreamer (owner of this data)
  title: z.string().optional(),
  narrative: z.string().min(1), // the brain-dump (voice-ready later)
  dreamDate: z.string().optional(), // when it occurred; may differ from createdAt (when logged)
  mood: z.number().min(-1).max(1).optional(), // waking mood, normalized valence (chartable)
  vividness: z.number().int().min(1).max(5).optional(),
  lucid: z.boolean(),
  nightmare: z.boolean(),
  sleepQuality: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()),
  people: z.array(DreamPersonRefSchema),
  sensitivity: SensitivityTierSchema, // reuse 08's tier (12 §8.3); default 'standard'
  // Whether this dream may inform coaching context at all — own + shareable-to-related (15-shareability
  // §4.2). Default true; replaces the old sensitivity-based auto-exclusion. Additive-optional; absent ⇒ true.
  informsContext: z.boolean().optional(),
  status: DreamStatusSchema,
  analysisId: z.string().optional(), // the canonical DreamAnalysis, once created
  image: DreamImageDescriptorSchema.optional(), // the generated image's metadata (13 §4.2); bytes in image.enc
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Dream = z.infer<typeof DreamSchema>;

/** Structured tags coded onto a dream by analysis — the substrate for cross-dream patterns (12 §3.5). */
export const DreamTagsSchema = z.object({
  emotions: z.array(z.string()),
  symbols: z.array(z.string()),
  settings: z.array(z.string()),
  themes: z.array(z.string()),
  people: z.array(z.string()),
});
export type DreamTags = z.infer<typeof DreamTagsSchema>;

export const DreamAnalysisSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  dreamId: z.string().min(1),
  personId: z.string().min(1),
  // readable, editable sections (12 §3.2/§4.3)
  summary: z.string(),
  emotionalLandscape: z.string(),
  wakingLifeConnections: z.string(),
  notableImages: z.string(), // symbolic/archetypal reflection — honestly framed (12 §8.1)
  reflectiveQuestions: z.array(z.string()),
  coachingPrompt: z.string().optional(),
  // structured coding for patterns (content-analysis style)
  tags: DreamTagsSchema,
  metrics: z.record(z.string(), z.number()).optional(), // normalized signals, e.g. emotionalIntensity
  lensesApplied: z.array(z.string()).optional(), // transparency, e.g. ['reflective','continuity','symbolic']
  crisisFlag: z.boolean().optional(), // self-harm/crisis risk → result leads with resources (12 §8.2)
  distressSignal: z.boolean().optional(), // milder trauma/distress → feeds the nightmare nudge (12 §8.2)
  edited: z.boolean(), // the person edited the AI output before approving
  insightId: z.string().optional(), // the Insight produced on approval (08 §4.4)
  generatedAt: z.string(),
  updatedAt: z.string(),
});
export type DreamAnalysis = z.infer<typeof DreamAnalysisSchema>;

/** Cached cross-dream AI narrative (12 §4.4); deterministic stats are computed live, not stored. */
export const DreamPatternSummarySchema = z.object({
  schemaVersion: z.number().int().positive(),
  personId: z.string().min(1),
  narrative: z.string(),
  windowFrom: z.string(), // range covered
  windowTo: z.string(),
  computedAt: z.string(),
  insightId: z.string().optional(), // set if the person approved the narrative into context
});
export type DreamPatternSummary = z.infer<typeof DreamPatternSummarySchema>;

/**
 * Renderer-supplied dream capture fields; the main process owns `id`, `schemaVersion`, `personId`
 * (the active dreamer), `status`, `analysisId`, and timestamps (12 §5.1). Booleans + collections default
 * so a fast brain-dump (narrative only) is valid.
 */
export const DreamInputSchema = z.object({
  id: z.string().optional(), // present when editing an existing dream
  title: z.string().optional(),
  narrative: z.string().min(1),
  dreamDate: z.string().optional(),
  mood: z.number().min(-1).max(1).optional(),
  vividness: z.number().int().min(1).max(5).optional(),
  lucid: z.boolean().default(false),
  nightmare: z.boolean().default(false),
  sleepQuality: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).default([]),
  people: z.array(DreamPersonRefSchema).default([]),
  sensitivity: SensitivityTierSchema.default('standard'),
  // Whether this dream may inform coaching context (15-shareability §4.2). Optional so legacy callers /
  // tests omit it; the composer always sends it. Absent ⇒ true everywhere it's read.
  informsContext: z.boolean().optional(),
});
export type DreamInput = z.infer<typeof DreamInputSchema>;

/**
 * The user-editable sections of a synthesized analysis (12 §3.2/§3.3). All optional → a partial edit;
 * the structured tags/metrics/flags are AI-owned and not editable here. Validated in the bridge before
 * the analysis is re-saved (marked `edited`).
 */
export const DreamAnalysisEditsSchema = z.object({
  summary: z.string().optional(),
  emotionalLandscape: z.string().optional(),
  wakingLifeConnections: z.string().optional(),
  notableImages: z.string().optional(),
  reflectiveQuestions: z.array(z.string()).optional(),
  coachingPrompt: z.string().optional(),
});
export type DreamAnalysisEdits = z.infer<typeof DreamAnalysisEditsSchema>;

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
  /**
   * Spend as a share of the period budget, clamped 0..1 (0 when there's no budget). Always present —
   * it's the non-$ signal everyone may see (06 §12). The actual dollars (`spentUsd`/`limitUsd`) are
   * **admin-only**: the bridge redacts them for non-`budgets.manage` callers, so a non-admin can't read
   * the figures over IPC, only the ratio (mirrors the `usage:summary` / `usage:sessionCosts` redaction).
   */
  budgetRatio: number;
  period: 'week' | 'month' | null;
  spentUsd?: number;
  limitUsd?: number | null;
}

export type ChatTurnResult =
  | {
      ok: true;
      conversation: Conversation;
      usage: UsageEvent;
      // 09-session-analysis §14.1: a lightweight, turn-embedded hint that the session feels wrapped up.
      // Assessed as part of the turn the user already paid for (no extra Claude call). The renderer shows a
      // dismissible "mark complete & summarize?" prompt when set and the session isn't already complete.
      wrapUpSuggested?: boolean;
    }
  | { ok: false; reason: 'NO_KEY' | 'BUDGET' | 'ERROR'; message: string };

/**
 * Result of "End & summarize" (09-session-analysis §6). On success carries the produced (auto-approved)
 * Session Insight + the metered usage; the wrap-up card renders from the Insight (summary, facts, the
 * mood metrics, crisis flag). `MEMORY_DISABLED` when the session-memory master toggle is off.
 */
export type SessionSummaryResult =
  | { ok: true; insight: Insight; usage: UsageEvent }
  | {
      ok: false;
      reason: 'NO_KEY' | 'BUDGET' | 'ERROR' | 'MEMORY_DISABLED' | 'NOT_FOUND';
      message: string;
    };

/**
 * Per-session AI cost rollup (09-session-analysis §14.3). `costUsd` is included **only for admins**
 * (`budgets.manage`), redacted at the bridge — everyone else sees a budget-relative bar from `tokens`.
 */
export interface SessionCost {
  tokens: number;
  costUsd?: number; // $ — admin-only (budgets.manage)
  budgetRatio?: number; // 0..1 — the session's cost as a share of the person's period budget (no $ leaked)
}

/**
 * Guided sessions (16-guided-sessions §4.3). The AI recommender picks catalog exercises that fit the
 * person right now; each pick carries the exercise id + a one-line reason. Cached per-person in the vault.
 */
export const GuidedSuggestionSchema = z.object({
  guideId: z.string().min(1),
  reason: z.string(),
});
export type GuidedSuggestion = z.infer<typeof GuidedSuggestionSchema>;

/** The per-person cached "Suggested for you" row (16 §4.3) — `people/<id>/guidance/suggestions.enc`. */
export const GuidedSuggestionsCacheSchema = z.object({
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string(),
  suggestions: z.array(GuidedSuggestionSchema),
});
export type GuidedSuggestionsCache = z.infer<typeof GuidedSuggestionsCacheSchema>;

/** Per-person guidance preferences (16 §8.3) — `people/<id>/guidance/prefs.enc`. The 18+ ack lives here. */
export const GuidancePrefsSchema = z.object({
  schemaVersion: z.number().int().positive(),
  adultAcknowledged: z.boolean().optional(), // one-time 18+ acknowledgement for the Intimacy group
});
export type GuidancePrefs = z.infer<typeof GuidancePrefsSchema>;

/**
 * What the launcher reads on open (16 §6) — cached suggestions (no spend) + the 18+ ack state. `cache`
 * is null until the person taps "Get personalized suggestions" (explicit-first-tap, no silent spend).
 */
export interface GuidanceState {
  cache: { generatedAt: string; suggestions: GuidedSuggestion[] } | null;
  adultAcknowledged: boolean;
}

/**
 * Result of generating/refreshing suggestions (16 §6). On success carries the freshly cached row; on
 * failure a calm typed envelope (the catalog still works regardless). `REFUSED` ⇒ nothing useful came back.
 */
export type GuidedSuggestResult =
  | { ok: true; generatedAt: string; suggestions: GuidedSuggestion[]; usage: UsageEvent }
  | {
      ok: false;
      reason: 'NO_KEY' | 'BUDGET' | 'ERROR' | 'REFUSED' | 'DENIED';
      message: string;
      usage?: UsageEvent;
    };

/**
 * Catalog metadata for one intake section (18-personal-onboarding §4.2), sent to the renderer — the catalog
 * itself is host-only code, so the renderer renders section structure + the static opener from this.
 */
export interface IntakeSectionMeta {
  id: string;
  title: string;
  blurb: string;
  restricted: boolean;
  adult: boolean;
  // Whether this section gates first-run (`core`) or is offered anytime afterward (`invited`), and whether it's
  // a structured `form` or an AI `chat` (18 §14.2/§14.3). The renderer renders forms from `questions`.
  tier: 'core' | 'invited';
  mode: 'form' | 'chat';
  opener: string; // chat: the static opening question (no spend). form: a short intro line.
  contentNote?: string; // a kind heads-up shown before a heavy/intimate section (§3.3)
  // Form sections only: the renderer-facing questions (reused questionnaire `Question` shape, with branching).
  // The host-side field/restricted mapping is NOT sent to the renderer (it's applied in `submitSectionForm`).
  questions?: Question[];
}

/**
 * What `intake:getState` returns (§6): the resumable session, the catalog meta, and availability. The
 * intake is AI-driven, so `aiAvailable` (key configured + AI enabled) gates whether it can run at all (§7).
 */
export interface IntakeState {
  session: IntakeSession;
  sections: IntakeSectionMeta[];
  aiAvailable: boolean;
  adultAcknowledged: boolean; // the shared 18+ ack (16-guided-sessions) — gates the intimacy block
}

/**
 * One adaptive interview turn (§6). Streams the interviewer reply via `onIntakeChunk`; resolves with the
 * updated session and which `Person` fields were filled this turn (direct `[[SELFOS:FIELD:…]]` markers).
 */
export type IntakeTurnResult =
  | { ok: true; session: IntakeSession; usage: UsageEvent; filledFields?: string[] }
  | { ok: false; reason: 'NO_KEY' | 'BUDGET' | 'ERROR'; message: string };

/**
 * Result of a synthesis pass (§6/§11.3). With a `sectionId`: a light per-section reflection (sets
 * `reflection`). Without one: the richer final portrait (sets `portrait` + `insightId`, fills inferred
 * fields, and completes the session). Both meter `intake.synthesize`.
 */
export type IntakeSynthesisResult =
  | {
      ok: true;
      session: IntakeSession;
      reflection?: string;
      portrait?: string;
      insightId?: string;
      // Absent when a section completes with no AI spend (best-effort reflection skipped, §11.3).
      usage?: UsageEvent;
    }
  | { ok: false; reason: 'NO_KEY' | 'BUDGET' | 'ERROR'; message: string };

/**
 * One Inbox row for the recipient (08-questionnaires §3.3). A **derived** view — the recipient sees the
 * purpose and (unless the sender chose anonymity) who's asking, never the sender's private data.
 * Computed in the bridge from the assignment + its frozen snapshot, so raw answers never cross IPC here.
 */
export interface InboxItem {
  assignmentId: string;
  title: string;
  questionCount: number;
  status: AssignmentStatus;
  privacy: PrivacyMode;
  senderName: string | null; // null = the sender stayed anonymous
  createdAt: string;
  answerable: boolean; // still open to answer / decline
  hasDraft: boolean; // saved-but-unsubmitted progress exists
}

/**
 * What an answered compatibility send shows its answerer (08-questionnaires §3.6). The joint `report`
 * (null until the sender generates it) is shown per the visibility mode; `ownAnswers` is included only
 * for `eachSeesOwn`, so the answerer can see their own submitted answers alongside the report.
 */
export interface InboxCompatibilityView {
  visibility: CompatibilityVisibility;
  report: AlignmentReport | null;
  ownAnswers?: SendAnswer[];
  // The participant context the recipient's disclosure is derived from (§16.1): the OTHER participant's
  // name, the sender's name, and whether this recipient is themselves the sender (you + someone else).
  otherParticipantName: string;
  viewerIsSender: boolean;
}

/** The recipient's answering view: the frozen snapshot + any saved draft answers to resume. */
export interface InboxAssignmentDetail {
  assignmentId: string;
  questionnaire: Questionnaire; // the immutable as-sent snapshot the recipient answers
  status: AssignmentStatus;
  privacy: PrivacyMode;
  senderName: string | null;
  answers: Answer[]; // saved draft answers; empty until the recipient saves progress
  answerable: boolean;
  // Present only for a compatibility send — drives the answerer's joint-report view once they've answered.
  compatibility?: InboxCompatibilityView;
}

/** One question + its answer rendered as display text, for the sender's Standard-send Results (§3.7). */
export interface SendAnswer {
  prompt: string;
  answer: string; // formatted for display; '' when unanswered
}

/** One point on a per-question trend line: a numeric answer at a submission time. */
export interface TrendPoint {
  at: string; // ISO submit time
  value: number;
}

/** One series within a question's trend — a recipient (and, for matrix/allocation, a row/bucket). */
export interface TrendSeries {
  label: string;
  points: TrendPoint[]; // ≥2, ordered by time
}

/**
 * A numeric question's rating-over-time across a questionnaire's re-asks (08-questionnaires §3.7). Only
 * questions with ≥2 points in some series appear. Includes **all** submitted sends — Standard and Private
 * — so the Private disclosure is worded to say answers may appear in the sender's trends (§3.2).
 */
export interface QuestionTrend {
  questionId: string;
  prompt: string;
  series: TrendSeries[];
}

/**
 * One send of a questionnaire as the **sender** sees it in Results (08-questionnaires §3.7). A derived
 * view: `answers` is populated **only** for a Standard, submitted send — a Private send never carries the
 * raw answers across IPC (the break-glass `readRaw` reveal is a separate, deferred slice). The `analyzed`
 * flag reflects whether an Insight already exists for this send (drafted or approved).
 */
export interface SendResult {
  assignmentId: string;
  recipientName: string;
  channel: Channel; // 'relay' = an external link send (drainable / revocable); 'inApp' = household
  status: AssignmentStatus;
  privacy: PrivacyMode;
  createdAt: string;
  submittedAt?: string;
  declineNote?: string;
  analyzed: boolean;
  answers?: SendAnswer[]; // present only for a Standard, submitted send
}

/** One of the two paired sends of a compatibility questionnaire, as the sender sees it (08 §3.6). */
export interface CompatibilityMember {
  assignmentId: string;
  recipientName: string;
  status: AssignmentStatus;
  submittedAt?: string;
}

/**
 * A compatibility send — its two paired members + the alignment report — as the **sender** sees it in
 * Results (08-questionnaires §3.6/§13.5d). Raw answers are never inlined here; `canReveal` is true only
 * for a `senderSeesAll` group when the sender holds `questionnaires.readRaw`, which drives the explicit
 * (audited) "Reveal raw answers" action.
 */
export interface CompatibilityGroup {
  compatibilityGroupId: string;
  questionnaireId: string;
  visibility: CompatibilityVisibility;
  members: CompatibilityMember[];
  bothSubmitted: boolean;
  report: AlignmentReport | null;
  analyzed: boolean; // an Insight already exists for this group's report
  canReveal: boolean; // senderSeesAll AND the sender holds questionnaires.readRaw
}

/** The result of generating a compatibility alignment report (→ report + draft Insight, 08 §13.5d). */
export type AlignmentResult =
  | { ok: true; report: AlignmentReport; usage: UsageEvent }
  | {
      ok: false;
      reason: 'NO_KEY' | 'DENIED' | 'BUDGET' | 'REFUSED' | 'ERROR' | 'NOT_READY';
      message: string;
    };

/**
 * The result of a **context-only** compatibility distillation (08-questionnaires §16.2): each participant's
 * own answers are distilled into an own-context Insight (auto-approved, never cross-shared). No report —
 * `updated` is how many participants' coaching contexts were enriched.
 */
export type ContextOnlyResult =
  | { ok: true; updated: number; usage: UsageEvent[] }
  | {
      ok: false;
      reason: 'NO_KEY' | 'DENIED' | 'BUDGET' | 'REFUSED' | 'ERROR' | 'NOT_READY';
      message: string;
    };

/** The result of a dual compatibility send (generate each variant + freeze the paired snapshots). */
export type CompatibilitySendResult =
  | { ok: true; compatibilityGroupId: string }
  | {
      ok: false;
      reason: 'NO_KEY' | 'DENIED' | 'BUDGET' | 'REFUSED' | 'ERROR' | 'INVALID';
      message: string;
    };

/** The result of synthesizing a dream (+ guided transcript) into a structured analysis (12 §3.2). */
export type DreamSynthesisResult =
  | { ok: true; analysis: DreamAnalysis; usage: UsageEvent }
  | { ok: false; reason: 'NO_KEY' | 'BUDGET' | 'ERROR' | 'NOT_FOUND'; message: string };

/** The result of approving a dream's analysis into the coach's memory (→ Insight, 12 §3.3). */
export type DreamApproveResult =
  | { ok: true; insightId: string }
  | { ok: false; reason: 'MEMORY_DISABLED' | 'NOT_FOUND'; message: string };

/** The time window cross-dream patterns aggregate over (12 §3.5). */
export type DreamPatternWindow = '30d' | '90d' | 'all';

/** One ranked label + occurrence count (recurring symbols/themes/people/emotions). */
export interface DreamPatternCount {
  label: string;
  count: number;
  personId?: string; // set when a "people" entry resolves to a People-graph person (04)
}

/** One time-series point (a normalized signal on the date the dream occurred). */
export interface DreamTrendPoint {
  date: string; // YYYY-MM-DD (the dream's occurred-date)
  value: number;
}

/**
 * Deterministic cross-dream statistics (12 §3.5) — computed live from each `DreamAnalysis.tags` + the
 * `Dream` metadata over the chosen window. A crypto-free view type (surfaced over IPC like `UsageSummary`).
 */
export interface DreamPatternStats {
  window: DreamPatternWindow;
  dreamCount: number; // dreams in the window
  analyzedCount: number; // of those, how many have a synthesized analysis
  symbols: DreamPatternCount[]; // recurring symbols, most frequent first
  themes: DreamPatternCount[]; // recurring themes
  people: DreamPatternCount[]; // who appears most (dream.people + analysis.tags.people)
  emotions: DreamPatternCount[]; // dominant emotions across dreams
  lucidCount: number;
  nightmareCount: number;
  moodTrend: DreamTrendPoint[]; // waking mood (−1..1) over time
  vividnessTrend: DreamTrendPoint[]; // vividness (1..5) over time
  /** The recurring-nightmare nudge (12 §8.2): a recent frequency of nightmares OR an AI distress signal. */
  nightmareNudge: boolean;
}

/** The result of generating the cross-dream AI narrative (12 §3.5) — budget-gated `dream.patterns`. */
export type DreamNarrativeResult =
  | { ok: true; summary: DreamPatternSummary; usage: UsageEvent }
  | { ok: false; reason: 'NO_KEY' | 'BUDGET' | 'ERROR' | 'EMPTY'; message: string };

/** A related person the dreamer can share a dream insight with (12 §3.4). */
export interface DreamShareTarget {
  id: string;
  displayName: string;
}

/**
 * The result of generating (or regenerating) a dream's image (13-dream-images §5.2/§6). On success the
 * bytes are encrypted to `image.enc` and the descriptor is stamped onto the dream; the caller fetches the
 * bytes separately (the prompt never travels back). `promptUsage` is the Claude distillation charge
 * (`dream.imagePrompt`); `imageUsage` is the flat OpenAI charge (`dream.image`) — present only when the
 * provider was actually billed. A `REFUSED` (content-policy decline) is uncharged, so it carries no
 * `imageUsage` (the distillation, if it ran + billed, still does).
 */
export type DreamImageGenerateResult =
  | {
      ok: true;
      descriptor: DreamImageDescriptor;
      mime: string;
      promptUsage: UsageEvent;
      imageUsage: UsageEvent;
    }
  | {
      ok: false;
      reason: 'NO_CONSENT' | 'NO_KEY' | 'BUDGET' | 'REFUSED' | 'ERROR';
      message: string;
      promptUsage?: UsageEvent;
      imageUsage?: UsageEvent;
    };

/**
 * The slim IPC result the renderer sees for `dreams:generateImage` (13 §6) — the usage events stay
 * host-side (recorded through `06`); the renderer fetches the bytes separately, so this never carries the
 * prompt or the pixels back.
 */
export type DreamImageResult =
  | { ok: true; mime: string; costUsd?: number } // costUsd present only for admins (budgets.manage), §3.2
  | {
      ok: false;
      reason: 'NO_CONSENT' | 'NO_KEY' | 'BUDGET' | 'REFUSED' | 'ERROR';
      message: string;
    };

/**
 * The result of a dream sharing toggle (shared by two paths). For **insight-fact** sharing (12 §3.4),
 * `NOT_ALLOWED` = the dream's `informsContext` is off — sensitive dreams are now shareable when it's on
 * (15-shareability §3.2 replaced the old `SENSITIVE` refusal there). For **dream-image** sharing
 * (13-dream-images §3.6, a separate consent path left unchanged by 15), `SENSITIVE` still refuses a
 * sensitive-tier image. `NOT_FOUND` = the dream/fact is missing or the target isn't a related person.
 */
export type DreamShareResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_ALLOWED' | 'SENSITIVE' | 'NOT_FOUND' };

/**
 * One dream image shared **with** the viewer by a related person (13-dream-images §3.6) — for the
 * recipient's "Shared with you" surface. Metadata only; the bytes are fetched separately via
 * `getSharedImage` (which re-gates the relationship + share + sensitivity at read time).
 */
export interface DreamSharedImage {
  dreamerId: string;
  dreamerName: string;
  dreamId: string;
  mime: string;
}
