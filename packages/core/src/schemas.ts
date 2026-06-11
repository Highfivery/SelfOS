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
