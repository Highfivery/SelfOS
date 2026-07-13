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

// ---------------------------------------------------------------------------
// Notifications (35-notification-system) — view types + the device-local
// per-person read/dismissed persistence. Most notifications are DERIVED from
// live state (conflicts, suggestions, responses, the update check); only the
// read/dismissed flags persist, keyed by a notification's `coalesceKey`.
// ---------------------------------------------------------------------------

/** The kinds migrated in v1. Extensible — add a literal here + a registry entry in the renderer. */
export const NOTIFICATION_KINDS = [
  'update-available',
  'profile-freshness',
  'responses-arrived',
  'reminder-due',
  'sync-conflict',
  'goal-followup', // 40-proactive-coaching §3.2 — a gentle check-in on a stale/due goal
  'coaching-synthesis', // 40 §3.3 — the cross-feature observation nudge
  'challenge-followup', // 52-challenge-sessions §3.5 — a gentle "how did your challenge go?" check-in
  'onboarding-updated', // 55-onboarding-attention §3.1 — completed onboarding has new/unanswered questions
  'answers-updated', // 56-answer-review-edit §3.2 — a recipient edited answers after the sender analyzed them
  'together-invite', // 58-together §3.11 — a partner invited you to a Together session
  'together-turn', // 58-together §3.11 — your turn in a Together session (coalesced per session, projection signature)
  'together-private', // 58-together §3.14 Part B — the coach left a private note just for you in a Together session
] as const;
export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/** Drives icon/accent + toast persistence; maps to the design-system Banner tones (no new colors). */
export const NotificationSeveritySchema = z.enum(['info', 'success', 'warning']);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

/**
 * What acting on a notification does. `navigate` follows an in-app route; `external` opens a URL via the
 * main-process shell (the renderer never opens URLs directly); `reveal-vault` opens the vault folder (the
 * sync-conflict "Resolve" affordance — a shell op, not a route or URL). Absent = purely informational.
 */
export const NotificationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), to: z.string().min(1) }),
  z.object({ type: z.literal('external'), url: z.string().min(1) }),
  z.object({ type: z.literal('reveal-vault') }),
]);
export type NotificationAction = z.infer<typeof NotificationActionSchema>;

/**
 * A resolved notification as the center/toasts render it. Derived in the renderer from live state +
 * persisted read/dismissed flags; never crosses IPC (only the flags persist). `coalesceKey` is the
 * stable "slot" (one notification per key); `signature` is the current condition value (conflict count,
 * version, suggestion id) — re-surfacing compares the persisted signature to this one per kind.
 */
export const NotificationSchema = z.object({
  id: z.string().min(1),
  kind: NotificationKindSchema,
  severity: NotificationSeveritySchema,
  title: z.string().min(1),
  body: z.string().optional(),
  action: NotificationActionSchema.optional(),
  createdAt: z.string(),
  coalesceKey: z.string().min(1),
  signature: z.string(),
  read: z.boolean(),
  dismissed: z.boolean(),
});
export type Notification = z.infer<typeof NotificationSchema>;

/**
 * One person's device-local notification state: per `coalesceKey`, the `signature` at which the item was
 * last read / dismissed. A later signature (per the kind's re-surface rule) un-reads / un-dismisses it.
 */
export const PersonNotificationStateSchema = z.object({
  read: z.record(z.string(), z.string()).default({}),
  dismissed: z.record(z.string(), z.string()).default({}),
});
export type PersonNotificationState = z.infer<typeof PersonNotificationStateSchema>;

/**
 * The coalesce keys whose read/dismissed state is APP-GLOBAL rather than per-person
 * (36-update-awareness §11): an update concerns the whole install, so dismissing it for one persona
 * dismisses it for all and it survives a person switch. The bridge splits these keys into a shared
 * device-state blob; everything else stays per-person (35-notification-system §4).
 */
export const APP_GLOBAL_NOTIFICATION_KEYS = ['update-available'] as const;

// ---------------------------------------------------------------------------
// Update awareness (36-update-awareness) — the notify-only update-check view
// type. The raw GitHub Releases payload is parsed/validated in the host and
// never crosses IPC wholesale; only this distilled result does.
// ---------------------------------------------------------------------------

/**
 * The result of an update check: the running version, the latest published version, whether an update
 * is available (latest > current), the release page to open, and when it was checked. A `null` result
 * (offline / rate-limited / timeout) means "couldn't check" — never overwrites the cached last-known.
 */
export const UpdateCheckResultSchema = z.object({
  current: z.string(),
  latest: z.string(),
  isUpdateAvailable: z.boolean(),
  releaseUrl: z.string(),
  publishedAt: z.string().optional(),
  checkedAt: z.string(),
});
export type UpdateCheckResult = z.infer<typeof UpdateCheckResultSchema>;

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
  /**
   * This install's stable device id (32-device-management §4.2) — generated once, stored device-local so
   * the Devices surface can mark "this device" key-free at boot. Additive-optional (no schemaVersion bump,
   * the `vaultBookmark` precedent). The synced `config/devices/<id>.enc` record is the source of truth.
   */
  deviceId: z.string().optional(),
  /** A cached copy of this device's registry label (so the UI can label "this device" before the key loads). */
  deviceLabel: z.string().optional(),
  /**
   * Per-person notification read/dismissed state (35-notification-system §4), keyed by person id. Ephemeral
   * UI state — device-local, never synced, never in the vault (a dismissal shouldn't leak across personas).
   * Additive-optional (the `vaultBookmark` precedent — no schemaVersion bump).
   */
  notificationState: z.record(z.string(), PersonNotificationStateSchema).optional(),
  /**
   * App-global notification read/dismissed state (36-update-awareness §11) — the single shared blob for
   * `APP_GLOBAL_NOTIFICATION_KEYS` (the update notice). Not keyed by person: an update concerns the whole
   * install, so its dismissal is shared across personas. Additive-optional (the `vaultBookmark` precedent).
   */
  globalNotificationState: PersonNotificationStateSchema.optional(),
  /** When this device last successfully checked for an app update (ISO). Advisory; the result is cached below. */
  lastUpdateCheckAt: z.string().optional(),
  /** The latest published version seen by the last successful check (semver, no `v`). */
  latestKnownVersion: z.string().optional(),
  /** The last successful update-check result, surfaced to Settings → About without re-fetching. */
  lastUpdateCheckResult: UpdateCheckResultSchema.optional(),
  /**
   * When this device last RAN an automatic memory-reconcile, keyed by subject person id (39-living-memory
   * §3.3). The auto-cadence throttle marker — device-local + per-person (each device throttles independently,
   * a reconcile dismissal shouldn't leak across personas). Additive-optional (the `notificationState`
   * precedent — no schemaVersion bump).
   */
  memoryReconcileCheckedAt: z.record(z.string(), z.string()).optional(),
  /**
   * When this device last RAN an automatic cross-feature synthesis, keyed by subject person id
   * (40-proactive-coaching §4.2). The renderer-driven cadence throttle marker — device-local + per-person, the
   * `memoryReconcileCheckedAt` precedent (ephemeral UI cadence state, must not sync). Additive-optional.
   */
  coachingSynthesizedAt: z.record(z.string(), z.string()).optional(),
  /**
   * Dismissed one-time discovery hints (the first-run orientation + feature tips, 41 §4), keyed by subject
   * person id → the set of dismissed hint keys. Ephemeral UI state — device-local + per-person (a tip
   * dismissal must not sync or nag after a person switch). Additive-optional (the `notificationState`
   * precedent — no schemaVersion bump).
   */
  discoveryDismissals: z.record(z.string(), z.array(z.string())).optional(),
  /**
   * Received questionnaires the active person has pinned (08 §3.3), keyed by subject person id → the set of
   * favourited assignment ids. A favourite is a personal, device-local view preference on someone else's
   * send — it must not sync or leak across personas. Additive-optional (the `discoveryDismissals` precedent).
   */
  inboxFavorites: z.record(z.string(), z.array(z.string())).optional(),
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

/**
 * A user-attached image on a Session message (45-session-attachments §4.2). Stored ENCRYPTED at
 * `people/<personId>/conversations/<conversationId>/attachments/<uuid>.enc`; the message references it by
 * this ref. `content` stays a plain string — the Claude vision content-block assembly is a runtime mapping
 * (§6.1), never a stored shape. Bytes never live in the transcript; `path` is used only host-side to re-read.
 */
export const AttachmentRefSchema = z.object({
  id: z.string().min(1), // the attachment uuid (also the basename of <uuid>.enc)
  kind: z.literal('image'), // forward-compat discriminant; only 'image' in v1 (PDFs/text are a non-goal)
  mime: z.string().min(1), // re-validated against ALLOWED_IMAGE_MIME in main
  path: z.string().min(1), // vault-relative path to <uuid>.enc — host-side re-read only
  width: z.number().int().positive().optional(), // stored (downscaled) pixel dimensions, for thumbnail layout
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(), // stored byte length (display / sanity)
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

/** Conversations (05-conversations) — encrypted per-person chat transcripts. */
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  ts: z.string(),
  // 45-session-attachments §4.2 — additive-optional image attachments on a (user) message. Absent ⇒ a plain
  // text message (today's behaviour) — NO Conversation.schemaVersion bump, NO migration (the additive habit).
  attachments: z.array(AttachmentRefSchema).optional(),
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
  // Challenge sessions (52-challenge-sessions §5.4). When this conversation is a challenge REFLECTION
  // session (the `challenge-reflect` guide), this back-links the Challenge it reflects on so End &
  // summarize stamps `provenance.challengeId`. Additive-optional — absent ⇒ a normal/guided session.
  challengeId: z.string().optional(),
  // Together prep spaces (58-together §3.7). When set, this conversation is a person's PRIVATE prep thread
  // for a couples session — an ordinary 05 Conversation carrying the link, so it reuses composer/streaming/
  // retry/attachments wholesale. A NEW filter in the Sessions-list read excludes these (they're reached via
  // the Together session's "Prep privately", not the solo Sessions list). Additive-optional — no migration.
  togetherSessionId: z.string().optional(),
  // Free-form session topic cache (28 §13.2). The life-areas a Haiku classifier inferred from the
  // conversation, reused across turns and re-run only on a subject shift, so context selects the relevant
  // pinned portrait facts. Additive-optional — absent ⇒ unclassified (⇒ core + fill). Guided sessions don't
  // use this (they derive their topic from the exercise group).
  topicLifeAreas: z.array(z.string()).optional(),
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
 * (18-personal-onboarding §4.1) — both additive, so existing Insights parse unchanged. `'test'` is the
 * fifth producer (50-self-assessments §4.4): a deterministically-scored self-assessment result. Additive
 * enum widening — `summarizeForContext`/`feedableInsights` don't branch on `source`, so a test insight feeds
 * context exactly like a session/intake one; no `schemaVersion` bump (the `'dream'`/`'intake'` precedent).
 */
export const InsightSourceSchema = z.enum([
  'questionnaire',
  'session',
  'dream',
  'intake',
  'test',
  // A Together couples-session wrap-up twin (58 §3.8) — one per partner, subject = that partner, feeding
  // ONLY their own coaching context. The enum is closed; this is a deliberate, listed amendment.
  'together',
]);
export type InsightSource = z.infer<typeof InsightSourceSchema>;

export const InsightFactSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  shareable: z.boolean(), // false = private to the subject; true = may feed related people's context
  // Per-person targeted sharing (12-dreams §3.4): person ids this fact is shared with, in addition to the
  // broadcast `shareable` boolean. Additive-optional — existing facts parse unchanged, no migration.
  shareableWith: z.array(z.string()).optional(),
  // Relationship-type-scoped sharing (42-relationship-scoped-sharing §4.1): the relationship types whose
  // related people may have this fact inform THEIR coaching context. Resolved against the live relationship
  // graph at buildContext time (a new sibling/partner inherits access per the item's types — no per-person
  // bookkeeping). Absent/empty ⇒ not type-shared (still own-context-only unless the legacy
  // `shareable`/`shareableWith` paths apply). A `restricted` fact is NEVER shared regardless (§8).
  // Additive-optional — the new sharing UIs set THIS, never broadcast `shareable: true`.
  // `.catch(undefined)` makes a corrupt scope FAIL CLOSED to own-only (42 §7): a malformed value degrades
  // this fact to private rather than throwing — otherwise one bad fact in person A's vault would crash
  // `buildContext(B)` for every related viewer B (`listInsightsForPerson` reads A on each related read).
  shareableTypes: z.array(RelationshipTypeSchema).optional().catch(undefined),
  // Break-glass-only (18-personal-onboarding §8.4): a fact derived from a `restricted` intake section
  // ("what weighs on you" / intimacy). It still feeds the subject's OWN coaching context, but is withheld
  // from the owner's normal People/Memory views — reachable only via the audited reveal. Additive-optional.
  restricted: z.boolean().optional(),
  // The user's correction signal (20-memory-dashboard §3.6): they marked this fact inaccurate. Flagging
  // EXCLUDES it from every context immediately (`summarizeForContext`) and tells the next reconciliation
  // not to re-assert it. The fact stays visible-but-marked + reversible (never silently deleted).
  flaggedInaccurate: z.boolean().optional(),
  flaggedAt: z.string().optional(),
  // Set when flagging a previously-SHARED fact inaccurate strips its share (39-living-memory §4.2): the
  // `shareable`/`shareableWith` are cleared and this stamps when, so Memory can show "sharing withdrawn."
  // Only present if there was a share to retract; cleared when the flag is removed. Additive-optional.
  retractedShareAt: z.string().optional(),
  // The fact's life-area, from the fixed LIFE_AREAS taxonomy (28-portrait-synthesis-optimization §pillar-2).
  // Drives per-call relevance selection of the (pinned) onboarding portrait: a budgeting session pulls
  // Money/Work facts, an intimacy session pulls Intimacy facts — instead of dumping all. Additive-optional:
  // a pre-28b fact has none ⇒ treated as always-relevant CORE (never narrowed). Normalized server-side
  // against LIFE_AREAS, never trusted raw from the model (mirrors `Insight.categories`).
  lifeArea: z.string().optional(),
});
export type InsightFact = z.infer<typeof InsightFactSchema>;

/**
 * The single sharing gate for an Insight fact (42-relationship-scoped-sharing §5.1): whether a fact owned
 * by one person may flow into a viewer's coaching context, given the relationship types describing how the
 * OWNER relates to the VIEWER (resolved from the live graph by the caller — see `relationshipTypesFromSubjectToViewer`).
 * Combines, in order: legacy broadcast `shareable: true`, per-person `shareableWith.includes(viewer)`
 * (12-dreams), and type-scoping `shareableTypes` ∩ `grantedTypes` ≠ ∅ (42) — AND requires the fact be
 * neither `restricted` (18 §8.4 — never shared by type) nor `flaggedInaccurate` (20 §3.6). Pure + reused by
 * `summarizeForContext`, `listRelatedShareableInsights`, and `scopeGrants`, so the boundary is defined once.
 */
export function factSharedWithViewer(
  fact: Pick<
    InsightFact,
    'shareable' | 'shareableWith' | 'shareableTypes' | 'restricted' | 'flaggedInaccurate'
  >,
  viewerId: string,
  grantedTypes: readonly RelationshipType[],
): boolean {
  if (fact.restricted === true || fact.flaggedInaccurate === true) return false;
  if (fact.shareable) return true;
  if (fact.shareableWith?.includes(viewerId)) return true;
  return (fact.shareableTypes ?? []).some((type) => grantedTypes.includes(type));
}

/**
 * One item in a person's outbound-sharing transparency view (42-relationship-scoped-sharing §5.3) — an
 * Insight fact or a shared intake answer they own, with its scope + the concrete related people currently
 * receiving it. Own data, so `text` is the full item; never crosses to a viewer (own-scoped read). A
 * crypto-free view type (defined here in the schemas shim) so the IPC/renderer may reference it.
 */
export interface OutboundSharingItem {
  /** Stable id: the `InsightFact.id`, or `<sectionId>.<questionId>` for a shared intake answer. */
  id: string;
  kind: 'fact' | 'intakeAnswer';
  /** The item's own text/label (own data → shown in full). */
  text: string;
  /** Legacy broadcast (`shareable: true`) — reaches EVERY related person. The new UIs never set it. */
  broadcast: boolean;
  /** The relationship types this item is scoped to (42 §4.1/§4.2). */
  types: RelationshipType[];
  /** Explicit person ids it's shared with (the per-person path — dreams, 12 §3.4). */
  personIds: string[];
  /** The concrete related people currently receiving it, resolved against the live graph. */
  recipients: { id: string; displayName: string }[];
}

export interface OutboundSharing {
  items: OutboundSharingItem[];
}

/** The call-type/topic signal a caller passes so context selects the relevant portrait facts
 * (28-portrait-synthesis-optimization §pillar-2). All fields optional: an absent/empty topic ⇒ the always-on
 * CORE facts + a priority fill (no topical narrowing). Crypto-free (defined here in the schemas shim) so the
 * renderer/IPC may reference it. */
export const ContextTopicSchema = z.object({
  lifeAreas: z.array(z.string()).optional(),
});
export type ContextTopic = z.infer<typeof ContextTopicSchema>;

/**
 * Where an Insight came from (20-memory-dashboard §3.3 powers deep-links). The primary `provenance` is the
 * origin; `Insight.contributingSources` folds in extra origins on merge ("from N moments").
 */
export const InsightProvenanceSchema = z.object({
  assignmentId: z.string().optional(),
  conversationId: z.string().optional(),
  dreamId: z.string().optional(), // set for dream-sourced insights (12-dreams §4.4)
  compatibilityGroupId: z.string().optional(), // set for compatibility alignment insights (08 §13.5d)
  guideId: z.string().optional(), // set when the session was a guided exercise (16-guided-sessions §3.5)
  intakeSection: z.string().optional(), // set for intake-sourced facts (18-personal-onboarding §4.1)
  testId: z.string().optional(), // set for test-sourced insights → deep-link to /you/:testId (50 §4.4)
  testResultId: z.string().optional(), // the specific TestResult this insight was built from (50 §4.4)
  challengeId: z.string().optional(), // set for a challenge reflection's insight → deep-link to the Challenge (52 §4.4)
  // The ResponseSet.revision this analysis was built from (56-answer-review-edit §4). Lets the sender detect a
  // stale analysis (`response.revision > analyzedRevision`) after a recipient edits + resubmits. Absent on a
  // pre-56 insight → treated as 1, so an un-edited send is never falsely flagged stale.
  analyzedRevision: z.number().int().positive().optional().catch(undefined),
  // Who a SENT questionnaire's insight is ABOUT — the recipient, when it isn't the subject (the sender). A
  // questionnaire you send to someone else produces an Insight for YOUR coaching (`subjectPersonId` = you)
  // whose facts describe THEIR answers, so Memory groups these as "responses to your questionnaires" instead
  // of mislabelling them "about you" (issue #129). `aboutPersonId` = a household recipient (stable id);
  // `aboutName` = an external recipient's display name. Absent ⇒ the insight is genuinely about the subject
  // (a normal session/dream/intake insight, or a self check-in). Additive-optional, no migration; stamped by
  // the producers + resolved read-time for pre-#129 insights. Never set for a self-recipient.
  aboutPersonId: z.string().optional().catch(undefined),
  aboutName: z.string().optional().catch(undefined),
  // Together wrap-up (58 §3.8): the session a twin came from, and the STABLE pair dimension (`pairKey`
  // survives edge delete/recreate, so it's the queryable relationship key — `Insight.relationshipId` is the
  // best-effort live edge). Additive-optional (the `aboutPersonId` precedent), no migration.
  togetherSessionId: z.string().optional().catch(undefined),
  pairKey: z.string().optional().catch(undefined),
  at: z.string(),
});
export type InsightProvenance = z.infer<typeof InsightProvenanceSchema>;

/**
 * The fixed life-area taxonomy (20-memory-dashboard §3.1/§11). Each insight is AI-tagged with 1–2 of these
 * (the dashboard groups by them). Producers assign them when they create the insight (no extra spend —
 * folded into the existing analysis call); the manual "Refresh memory" reconcile may re-tag.
 */
export const LIFE_AREAS = [
  'Relationships',
  'Family',
  'Work & purpose',
  'Health & body',
  'Emotions & patterns',
  'Values & beliefs',
  'Intimacy',
  'Goals & growth',
  'Money',
  'Faith',
  'Other',
] as const;
export type LifeArea = (typeof LIFE_AREAS)[number];

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
  // Life-area themes (1–2 from LIFE_AREAS; AI-assigned). Additive — absent on pre-20 insights ⇒ [] (no
  // migration); the dashboard treats an untagged insight as "Other".
  categories: z.array(z.string()).default([]),
  // A short, human-readable basis for the confidence ("corroborated by 3 sessions"), set by reconciliation.
  confidenceRationale: z.string().optional(),
  // When reconciliation last touched this insight (20-memory-dashboard §4.1).
  lastReconciledAt: z.string().optional(),
  // Extra origin provenances folded in when reconciliation MERGES a duplicate into this one ("from N
  // moments"). The primary `provenance` stays the origin. Additive-optional.
  contributingSources: z.array(InsightProvenanceSchema).optional(),
  approved: z.boolean(), // questionnaire insights require approval before entering buildContext (08 §3.7)
  provenance: InsightProvenanceSchema,
  crisisFlag: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Insight = z.infer<typeof InsightSchema>;

/**
 * A first-class tracked goal / commitment (39-living-memory §4.1). Goals were just `Goal: …` text facts on a
 * session insight — no status, no follow-through. Now they're their own entity at `people/<id>/goals/<id>.enc`,
 * extracted from session analysis (no extra AI spend — the analysis already returns `goals`), with a lifecycle
 * the user can see + close, and a clean read API for the coach's follow-up (spec 40). Per-subject (the owner is
 * `subjectPersonId`); never cross-person. `schemaVersion` starts at 1.
 *
 * `stale` is DERIVED for display (`effectiveGoalStatus`) and only PERSISTED when the user confirms a status
 * (§11 Q4) — the stored `status` stays `open`/`inProgress` until they act, so a goal never silently changes.
 */
export const GoalStatusSchema = z.enum(['open', 'inProgress', 'done', 'stale', 'abandoned']);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const GoalSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1), // the goal's owner — per-person isolation
  text: z.string(), // the commitment in the person's terms
  status: GoalStatusSchema, // `open` by default; `stale` is derived for display, persisted only on confirm
  due: z.string().optional(), // ISO date — a hard deadline if named
  horizon: z.string().optional(), // a soft horizon when there's no date ("this month", "someday")
  lifeArea: z.string().optional(), // from LIFE_AREAS, normalized server-side (mirrors InsightFact)
  provenance: InsightProvenanceSchema, // which session/source named it (reuse the existing schema)
  contributingSources: z.array(InsightProvenanceSchema).optional(), // re-mentions folded in (§4.3)
  insightId: z.string().optional(), // the Insight this goal was extracted from (back-reference)
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTouchedAt: z.string().optional(), // last time the person/coach engaged it (the staleness basis)
});
export type Goal = z.infer<typeof GoalSchema>;

/**
 * A tracked challenge / experiment (52-challenge-sessions §4.2) — a small, deliberately-stretching action the
 * person co-creates with the coach and commits to between sessions, with a check-in and a reflection that
 * feeds memory. It is its OWN entity, NOT a `Goal` subtype (§2/§4.2): a goal is a standing commitment; a
 * challenge is a time-boxed experiment with a `comfort` dial and a check-in. They relate (`seededGoalId`) but
 * never share a schema. Stored encrypted per-person at `people/<id>/challenges/<id>.enc`. `schemaVersion` 1.
 */
export const ChallengeStatusSchema = z.enum(['proposed', 'active', 'done', 'abandoned']);
export type ChallengeStatus = z.infer<typeof ChallengeStatusSchema>;

/** The challenge family — drives filtering, suggestion sourcing, and the 18+ gate (`intimacy`). */
export const ChallengeDomainSchema = z.enum([
  'overcome',
  'habit',
  'horizons',
  'novelty',
  'intimacy',
]);
export type ChallengeDomain = z.infer<typeof ChallengeDomainSchema>;

/** A light structured outcome captured at check-in (§3.5) alongside the free-text reflection. */
export const ChallengeOutcomeSchema = z.enum(['did', 'partly', 'didnt']);
export type ChallengeOutcome = z.infer<typeof ChallengeOutcomeSchema>;

export const ChallengeSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1), // per-person isolation — the challenge's owner (always self)
  action: z.string(), // the agreed stretch action, in the person's terms ("strike up one conversation…")
  status: ChallengeStatusSchema, // 'active' on capture; 'proposed' for a suggestion not yet agreed (§3.7)
  comfort: z.number().int().min(1).max(5), // the person's chosen stretch (1 gentle nudge … 5 big leap) — the dial
  lifeArea: z.string().optional(), // from LIFE_AREAS, normalized server-side (mirrors InsightFact/Goal)
  domain: ChallengeDomainSchema.optional(), // the challenge family — for filtering/suggestion (§4.2)
  adult: z.boolean().optional(), // a sexual/explicit challenge → 18+-gated surfaces + restricted reflection facts
  conversationId: z.string().optional(), // the challenge session this was agreed in (back-reference)
  provenance: InsightProvenanceSchema, // reuse the existing schema (carries conversationId + at)
  agreedAt: z.string().optional(), // set when status → 'active' (the person committed)
  checkInAt: z.string().optional(), // when the app should gently ask "how did it go?" (§3.5)
  reflection: z.string().optional(), // the person's outcome reflection (on check-in)
  outcome: ChallengeOutcomeSchema.optional(), // a light structured outcome from the check-in
  insightId: z.string().optional(), // the reflection's derived Insight (source:'session', §4.4)
  seededGoalId: z.string().optional(), // if completing seeded a 39 Goal (§11 Q6) — the back-link
  seededFromChallengeId: z.string().optional(), // the prior challenge this was seeded from (§3.7 chain)
  groupId: z.string().optional(), // links the twin JOINT challenges a couples coach mints for both partners (58 §5.6)
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A joint (couples) challenge's cross-partner status (58 §5.6), DERIVED from the twins — never a stored record. */
export interface JointChallengeStatus {
  groupId: string;
  action: string;
  /** How many of the pair have a twin (2 in v1). */
  memberCount: number;
  /** How many twins have been checked in (outcome recorded / status done). */
  checkedInCount: number;
  /** Every partner has checked in. */
  allCheckedIn: boolean;
  /** At least one twin is still active (the challenge is live for the pair). */
  active: boolean;
  /** The most recent twin update, for ordering. */
  updatedAt: string;
}
export type Challenge = z.infer<typeof ChallengeSchema>;

/**
 * The cached proactive suggestion (52 §3.7) — `people/<id>/challenges/suggestion.enc`, one current,
 * overwritten on each `challenge.suggest` pass. View-only re-display costs nothing; accepting it (not the
 * suggestion) is what creates a `Challenge`. Tolerant-parsed (spec 37): only `action` is required.
 */
export const ChallengeSuggestionSchema = z.object({
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1),
  action: z.string().min(1), // the candidate stretch action, in the person's terms (the only required field)
  why: z.string().catch('').default(''), // why-it-fits (drawn from their own data) — calm, never a verdict
  comfort: z.number().int().min(1).max(5).optional(), // a suggested stretch level (the person can re-dial)
  lifeArea: z.string().optional(), // from LIFE_AREAS, normalized server-side
  domain: ChallengeDomainSchema.optional(),
  adult: z.boolean().optional(), // a sexual/intimacy candidate (only surfaced once the 18+ ack is present)
  computedAt: z.string(),
});
export type ChallengeSuggestion = z.infer<typeof ChallengeSuggestionSchema>;

/** The result of the proactive suggester (52 §6) — budget-gated `challenge.suggest`, tolerant-parsed (37). */
export type ChallengeSuggestionResult =
  | { ok: true; suggestion: ChallengeSuggestion }
  | {
      ok: false;
      reason:
        | 'NO_KEY'
        | 'BUDGET'
        | 'CAPPED' // the per-period suggest cap (§5.3) — distinct from a hard BUDGET stop
        | 'AI_OFF'
        | 'EMPTY'
        | 'REFUSED'
        | 'TRUNCATED'
        | 'MALFORMED'
        | 'ERROR';
      message: string;
    };

/**
 * AI-suggested intimacy topics for the owner to review (08-questionnaires §16.5a, AI-assist follow-up).
 * Deduped activity + fantasy candidates the owner picks/edits before adding to the shared inventory — the
 * suggester PERSISTS NOTHING (the owner's "Add selected" reuses the existing add path). The only AI spend is
 * the `intimacy.suggestTopics` pass, owner-gated + metered before parse.
 */
export interface IntimacyTopicSuggestions {
  activities: string[];
  fantasies: string[];
}

export type IntimacyTopicSuggestResult =
  | { ok: true; suggestions: IntimacyTopicSuggestions }
  | {
      ok: false;
      reason:
        | 'NO_KEY'
        | 'BUDGET'
        | 'AI_OFF'
        | 'EMPTY'
        | 'REFUSED'
        | 'TRUNCATED'
        | 'MALFORMED'
        | 'ERROR';
      message: string;
    };

/**
 * The result of an inline check-in (52 §6). The status + outcome ALWAYS persist (free, no AI); the optional
 * reflection → Insight bridge (§5.4) is deterministic in v1, so a check-in never spends. `challenge` carries
 * the updated record (status moved to `done`/`active`/`abandoned`); `insightId` is the derived reflection
 * Insight when one was produced.
 */
export type ChallengeCheckInResult =
  | { ok: true; challenge: Challenge; insightId?: string }
  | { ok: false; reason: 'NOT_FOUND'; message: string };

/**
 * A scored subscale within a self-assessment result (50-self-assessments §4.3). `key` matches a
 * `SubscaleSpec.key` (e.g. `'bigfive.neuroticism'`, `'ecr.anxiety'`, `'kink.power-exchange'`); `raw` is the
 * deterministic aggregate (sum/mean) before normalization; `normalized` is what charts + `Insight.metrics`
 * use (0..1 for `'unit'`, −1..1 for `'signed'`); `band` is the plain, non-pathologizing descriptor label
 * resolved at score time (§3.3/§8.1).
 */
export const TestSubscaleScoreSchema = z.object({
  key: z.string().min(1),
  raw: z.number(),
  normalized: z.number(),
  band: z.string().optional(),
});
export type TestSubscaleScore = z.infer<typeof TestSubscaleScoreSchema>;

/**
 * One taking of a self-assessment ("Test"), per-person + encrypted at `people/<id>/tests/<result-id>.enc`
 * (50-self-assessments §4.3). A retake is a NEW file (`reTakeOf` set) + a new trend point; prior results are
 * kept (never overwritten) so trends are honest. `answers.value` reuses the questionnaire `Answer.value`
 * union (08 §4.3) so the `@selfos/answering` renderer round-trips test items unchanged (matrix →
 * `Record<string, number>`). The `TestDefinition` itself is curated code, never vaulted.
 */
export const TestResultSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  testId: z.string().min(1), // the TestDefinition.id
  testVersion: z.number().int().nonnegative(), // the definition's content version at score time (honesty)
  subjectPersonId: z.string().min(1), // the taker (always self — there is no other recipient)
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      value: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string()),
        z.record(z.string(), z.number()), // matrix / allocation
      ]),
    }),
  ),
  scores: z.array(TestSubscaleScoreSchema), // the deterministic result
  reTakeOf: z.string().optional(), // prior TestResult id → the longitudinal chain (trends)
  insightId: z.string().optional(), // the derived Insight this result produced (source: 'test')
  crisisFlag: z.boolean().optional(), // a heuristic answer-level flag → lead with resources (§8.2)
  takenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

/** A goal is "stale" past its `due`, or (no `due`) after this many days untouched (39 §11 Q4). */
export const STALE_AFTER_DAYS = 21;

/** Active (not yet closed) goal statuses — the ones that can derive to `stale` and feed the coach. */
const ACTIVE_GOAL_STATUSES: ReadonlySet<GoalStatus> = new Set(['open', 'inProgress']);

/** When the goal was last meaningfully touched — the staleness clock (falls back to creation). Pure. */
function goalTouchedAt(goal: Goal): string {
  return goal.lastTouchedAt ?? goal.updatedAt ?? goal.createdAt;
}

/**
 * Whether an ACTIVE goal currently reads as stale (39 §3.1/§11 Q4) — past its `due`, OR (no `due`) untouched
 * for `STALE_AFTER_DAYS`. Pure + crypto-free so both the bridge and the renderer derive the same display state
 * without persisting it. A closed goal (done/abandoned) or one already stored `stale` is never re-derived.
 */
export function isGoalStale(goal: Goal, now: Date): boolean {
  if (!ACTIVE_GOAL_STATUSES.has(goal.status)) return false;
  if (goal.due) {
    const due = Date.parse(goal.due);
    return Number.isFinite(due) && due < now.getTime();
  }
  const touched = Date.parse(goalTouchedAt(goal));
  if (!Number.isFinite(touched)) return false;
  return now.getTime() - touched > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** The status to DISPLAY for a goal: its stored status, or `stale` when an active goal has gone stale. Pure. */
export function effectiveGoalStatus(goal: Goal, now: Date): GoalStatus {
  return isGoalStale(goal, now) ? 'stale' : goal.status;
}

/**
 * A pending memory-merge proposal (39-living-memory §3.4). Reconciliation no longer silently merges two
 * insights — it queues a proposal the user confirms (Merge) or dismisses (Keep both) in Memory's "Needs your
 * review" region. Stored per-subject at `people/<id>/memory-proposals/<id>.enc`. The summaries are snapshotted
 * for display so the card reads even if an insight later changes. `schemaVersion` starts at 1; additive.
 */
export const MergeProposalSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1),
  fromId: z.string().min(1), // the insight that would be folded away
  intoId: z.string().min(1), // the insight it would fold into (kept)
  fromSummary: z.string(),
  intoSummary: z.string(),
  createdAt: z.string(),
});
export type MergeProposal = z.infer<typeof MergeProposalSchema>;

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
  // 'field' / 'intakeSection' = the §15 FRESHNESS kinds ("this answer is stale — update it"); 'depth' = the
  // §29 progressive-profile DEPTH invitation ("this area is unexplored — want to go deeper?"). Additive enum
  // widen — pre-29 records (no 'depth') parse unchanged (the email/phone additive precedent, no schema bump).
  kind: z.enum(['field', 'intakeSection', 'depth']),
  field: PersonFieldKeySchema.optional(), // set for kind 'field'
  sectionId: z.string().optional(), // set for kind 'intakeSection' AND 'depth' (the invited section it opens)
  // For 'depth' (29): the thin life-area the activity kept circling (when it routed via an area, §5.3).
  lifeArea: z.string().optional(),
  // For 'depth' (29): the recurring theme that triggered it ("we keep coming back to your dad").
  theme: z.string().optional(),
  observed: z.string().min(1), // §15: the implied new value; for 'depth' = the theme/area the model named
  current: z.string().optional(), // the known value it would replace, if any
  rationale: z.string(), // a short, human reason ("a recent session mentioned a new job"); the card subtitle
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
 * The raw shape an analysis pass emits for a §29 DEPTH delta (model output → validated before trust, §5.2).
 * The model names ONE recurring profile area the conversation keeps circling that the person hasn't explored —
 * either by the invited `sectionId` from the unfilled list it's shown, or by a `lifeArea` we map to a section
 * host-side. A hallucinated/`core`/already-filled target is dropped at recording (`recordDepthInvitations…`).
 */
export const RawDepthInvitationSchema = z.object({
  sectionId: z.string().optional(), // the invited section, if the model named one
  lifeArea: z.string().optional(), // OR the thin life-area (mapped to a section host-side, §5.3)
  theme: z.string().min(1), // the recurring topic ("your father", "money stress")
  rationale: z.string().default(''),
});
export type RawDepthInvitation = z.infer<typeof RawDepthInvitationSchema>;

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
  z.array(z.object({ label: z.string(), date: z.string() })), // a `dateList` answer (→ importantDates)
  z.array(z.record(z.string(), z.string())), // a `roster` answer (repeatable rows of {column → value})
  z.record(z.string(), z.number()), // a `matrix` answer (row → point, e.g. the intimacy activity matrix)
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
  // Per-question sharing scope (42-relationship-scoped-sharing §4.2), keyed by question id → the relationship
  // types whose related people may have THIS answer inform their coaching. Absent question ⇒ that answer is
  // not type-shared (own-context-only). Written by the onboarding per-question UI (43); read into a related
  // person's context here (42 §5.2). Additive-optional — pre-spec sections parse unchanged, no migration.
  // `.catch(undefined)` fails closed (42 §7): a corrupt scope map degrades to "nothing shared" rather than
  // throwing, mirroring `InsightFact.shareableTypes` and the `safeParse` read paths.
  answerSharing: z.record(z.string(), z.array(RelationshipTypeSchema)).optional().catch(undefined),
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
  // The catalog as it stood when onboarding last completed/refreshed (55-onboarding-attention §4) — the section
  // ids + `sectionId.questionId` keys that existed then. Lets the attention indicator tell a GENUINELY-new
  // question/section (added by a later app update, ∉ the snapshot) from a deep section simply not yet done, so
  // the persistent surfaces don't nag about the whole un-started invited catalog. Additive-optional (no bump).
  knownSectionIds: z.array(z.string()).optional().catch(undefined),
  knownQuestionKeys: z.array(z.string()).optional().catch(undefined),
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
  'dateList', // a repeatable list of {label, date} pairs (e.g. anniversaries → Person.importantDates)
  'roster', // a repeatable list of rows with configurable columns (e.g. kids: name/gender/DOB; pets)
]);
export type AnswerType = z.infer<typeof AnswerTypeSchema>;

/**
 * The answer types the model may choose for AI-generated / AI-suggested questions. Authoring-only types
 * (`matrix`, `allocation`, `dateList`, `roster` — they need extra structure a sample question can't carry)
 * are intentionally excluded. The single source shared by the generation guide, the gap-finder prompt, AND
 * the gap-finder's parse schema (`SuggestionQuestionSchema`), so the prompt names exactly the enum values
 * the parse will accept — the gap-finder "unexpected shape" bug was the prompt omitting this list, leaving
 * the model to guess type names like "text"/"scale" that then failed validation.
 */
export const SUGGESTABLE_ANSWER_TYPES = [
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
] as const;
export const SuggestableAnswerTypeSchema = z.enum(SUGGESTABLE_ANSWER_TYPES);

/**
 * A `roster` column definition — a labeled per-row field: free `text`, a `select` with options, or a
 * `date` (rendered as a native date picker; e.g. a child's date of birth, which — unlike an age — never
 * goes stale). A `date` value is the ISO `YYYY-MM-DD` string the input emits.
 */
export const RosterColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'select', 'date']),
  options: z.array(z.string()).optional(), // for type: 'select'
  placeholder: z.string().optional(), // example text for a 'text' column
});
export type RosterColumn = z.infer<typeof RosterColumnSchema>;

/** One entry of a `dateList` answer — a labeled date (e.g. "Anniversary" → "2014-06-21"). */
export const DateEntrySchema = z.object({ label: z.string(), date: z.string() });
export type DateEntry = z.infer<typeof DateEntrySchema>;

/**
 * Simple conditional branching (v1): show a question/section when a prior answer matches. Either `equals`
 * (a single value) or `equalsAny` (any of several values — e.g. show follow-ups unless the answer was "Not
 * for me") must be set; the renderer checks whichever is present.
 */
export const BranchRuleSchema = z.object({
  whenQuestionId: z.string().min(1),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  equalsAny: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  action: z.literal('show'),
});
export type BranchRule = z.infer<typeof BranchRuleSchema>;

/**
 * A `matrix` row. Historically each row was a plain `string` used as **both** the display label **and** the
 * answer key (the matrix value is `Record<string, number>`, keyed by the row string) — every questionnaire
 * matrix still uses this form, so a plain string keeps key === label and renders byte-identically. The
 * `{ key, label }` form (46 §4.2) splits the **stable answer key** from the **display label**, so the intake
 * activity matrix can re-label a row (e.g. an anatomy-driven oral label) without orphaning a prior rating
 * keyed by the old label. Use {@link matrixRowKey}/{@link matrixRowLabel} — never assume a row is a string.
 */
export const MatrixRowSchema = z.union([
  z.string(),
  z.object({ key: z.string().min(1), label: z.string().min(1) }),
]);
export type MatrixRow = z.infer<typeof MatrixRowSchema>;

/** The stable answer key for a matrix row (the row string itself for a plain-string row). */
export function matrixRowKey(row: MatrixRow): string {
  return typeof row === 'string' ? row : row.key;
}
/** The display label for a matrix row (the row string itself for a plain-string row). */
export function matrixRowLabel(row: MatrixRow): string {
  return typeof row === 'string' ? row : row.label;
}

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
  // singleChoice/multiChoice: offer an "Other" write-in (a free-text field when picked) — the answer stores
  // the typed text alongside any preset picks (08 §17.12-C). Additive; the renderer also honors a literal
  // 'Other' option (the intake's existing convention).
  allowOther: z.boolean().optional(),
  scale: z
    .object({
      min: z.number(),
      max: z.number(),
      minLabel: z.string().optional(),
      midLabel: z.string().optional(), // slider only: an example anchored at the middle of the track
      maxLabel: z.string().optional(),
      step: z.number().optional(),
    })
    .optional(),
  matrix: z
    .object({
      // A row is a display label OR a { key, label } pair (46 §4.2). Questionnaire matrices pass plain
      // strings (key === label, unchanged); the intake activity matrix passes { key, label } so a relabelled
      // oral row never orphans a rating keyed by the stable key. See MatrixRowSchema / matrixRowKey/Label.
      rows: z.array(MatrixRowSchema),
      min: z.number(),
      max: z.number(),
      minLabel: z.string().optional(),
      // A 3-point matrix (max−min===2) carrying all of min/mid/maxLabel renders each row as three LABELLED
      // options (e.g. Hard limit · Curious · Into it) instead of numbered points. The stored value stays the
      // numeric row→point map; the labels are display only.
      midLabel: z.string().optional(),
      maxLabel: z.string().optional(),
      // An N-point LABELLED scale: one label per point (length must equal max−min+1) — e.g. the intake
      // activity matrix's 5-point feeling scale (Hard no · Not interested · Curious · Like it · Love it).
      // When present it wins over min/mid/maxLabel; absent → numbered points (existing questionnaire matrices)
      // or the 3-label fallback above. Additive; the value is still the numeric row→point map.
      pointLabels: z.array(z.string()).optional(),
      // Labels (a subset of `pointLabels`) rendered with a distinct boundary/limit tone rather than the
      // neutral feeling tone — e.g. ['Hard no'], so a hard limit reads as a boundary, not just another option.
      limitLabels: z.array(z.string()).optional(),
      // Optional display GROUPING (49 §5): category headers above row groups, each listing the row keys it
      // contains (in render order). The intake activity matrix passes groups so its ~90 rows read grouped
      // sensual→extreme, every group open by default; questionnaire matrices pass none → flat byte-identical
      // render. Display only — the stored value is still the numeric row→point map keyed by stable keys.
      groups: z.array(z.object({ label: z.string(), rowKeys: z.array(z.string()) })).optional(),
    })
    .optional(),
  metricKey: z.string().optional(), // rating/slider/matrix → populates Insight.metrics
  roster: z.array(RosterColumnSchema).optional(), // for type: 'roster' — the per-row columns (kids, pets…)
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

/**
 * Who a send goes to. A **household person** (in-app Inbox) or an **external** person (relay link). Shared
 * by the questionnaire definition (08-questionnaires §17.3 — every non-compatibility questionnaire is bound
 * to ONE recipient, chosen at creation) and by each `Assignment` (the frozen as-sent record).
 */
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

export const QuestionnaireSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().positive(), // immutable-snapshot version; bumps on edit
  // Who authored it — set by main on create from the active person, never the renderer. Gates "a creator
  // may delete their own questionnaire only while unsent" (§3.9). Additive-optional (legacy defs lack it →
  // only the Owner can delete those); no schemaVersion bump.
  creatorPersonId: z.string().optional(),
  // The single recipient this questionnaire is for (08 §17.3) — chosen at creation, never several. Required
  // for non-compatibility questionnaires (a compatibility def carries its two participants at send instead,
  // so it omits this). Optional in the shape (a draft may be saved incomplete); the non-compat requirement is
  // enforced at the AUTHORING boundary (the recipient-first start step) and the SEND path (the bridge derives
  // the recipient from the def and rejects a missing/wrong-kind one) — NOT in the structural validateQuestionnaire,
  // which createAssignment calls and must keep working for recipient-less compatibility snapshots.
  recipient: RecipientSchema.optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.string().min(1), // a starter-taxonomy key OR a user-defined custom type
  sensitivity: SensitivityTierSchema,
  questions: z.array(QuestionSchema),
  compatibility: CompatibilityConfigSchema.optional(),
  // Pin a recurring questionnaire to the top of the list (38 §13.8). Additive-optional, household-wide;
  // absent = not favorited. Set via `setFavorite` (a star toggle), NOT through the builder — so it never
  // bumps the content `version`, and `saveQuestionnaire` preserves it across edits.
  favorite: z.boolean().optional(),
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
  recipient: RecipientSchema.optional(),
  questions: z.array(QuestionSchema),
  compatibility: CompatibilityConfigSchema.optional(),
});
export type QuestionnaireInput = z.infer<typeof QuestionnaireInputSchema>;

/**
 * Non-secret questionnaire prefs (`config/questionnaires.json` in the vault, plain JSON — §4.1).
 * Holds the user-defined **custom types** that reappear in the builder's type picker, plus the Owner's
 * **custom intimacy topics** (§16.5a) — household-wide additions to the shared `INTIMACY_TOPICS` inventory
 * that feed both the intake intimacy block and questionnaire generation. Stored plain, mirroring
 * `config/settings.json`. All fields beyond `customTypes` are additive-optional (no schemaVersion bump).
 */
export const QuestionnairePrefsSchema = z.object({
  schemaVersion: z.number().int().positive(),
  customTypes: z.array(z.string().min(1)),
  customIntimacyActivities: z.array(z.string().min(1)).optional(),
  customIntimacyFantasies: z.array(z.string().min(1)).optional(),
});
export type QuestionnairePrefs = z.infer<typeof QuestionnairePrefsSchema>;

/** The intimacy topic inventory split into read-only built-ins + the Owner's removable custom additions
 * (08-questionnaires §16.5a) — the shape the owner Settings surface + inline builder add render. */
export interface IntimacyTopicGroups {
  activities: string[];
  fantasies: string[];
}
export interface IntimacyTopicsView {
  builtIn: IntimacyTopicGroups;
  custom: IntimacyTopicGroups;
}

/**
 * One sample question on a gap-finder proposal. `required` is tolerant (37 §3.3): the model routinely omits
 * it and it isn't essential to a *suggestion*. `type` is validated against the answer-type enum — the
 * gap-finder parses an array of these TOLERANTLY (per-element), so a single off-spec `type` drops only that
 * sample question, never the whole suggestion (the gap-finder "unexpected shape" bug). Exported so the
 * service can wrap it in a `tolerantArray` without re-declaring the shape (DRY).
 */
export const SuggestionQuestionSchema = z.object({
  // Restricted to the AI-suggestable subset (not the full AnswerTypeSchema): a sample question with an
  // authoring-only type (matrix/allocation/…) can't seed a usable builder draft, so the gap-finder drops it.
  type: SuggestableAnswerTypeSchema,
  prompt: z.string().min(1),
  required: z.boolean().optional(),
  // Choice options for choice-type sample questions (08 §19.4) — so a seeded multiple-choice question is
  // never blank. Optional (non-choice types omit it); tolerated per-element like the rest of the suggestion.
  options: z.array(z.string()).optional(),
});
export type SuggestionQuestion = z.infer<typeof SuggestionQuestionSchema>;

/** A gap-finder proposal (08-questionnaires §3.7): a questionnaire idea + a few sample questions. */
export const QuestionnaireSuggestionSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  rationale: z.string(),
  questions: z.array(SuggestionQuestionSchema),
});
export type QuestionnaireSuggestion = z.infer<typeof QuestionnaireSuggestionSchema>;

/**
 * A **persisted** gap-finder suggestion (08-questionnaires §18.3): a proposal plus a stable `id` (so it can be
 * deleted or auto-removed once a questionnaire is created from it) and when it was generated. Saved per author,
 * keyed by recipient; accumulates across "Suggest more" up to `SUGGESTION_CAP`.
 */
export const SavedSuggestionSchema = QuestionnaireSuggestionSchema.extend({
  id: z.string().min(1),
  createdAt: z.string(),
});
export type SavedSuggestion = z.infer<typeof SavedSuggestionSchema>;

/**
 * The per-author saved-suggestions document (08-questionnaires §18.3) at
 * `people/<authorId>/questionnaires/suggestions.enc`. Holds one set per recipient the author has generated
 * ideas for. Additive view doc — no migration (a missing file ⇒ no saved suggestions).
 */
export const SavedSuggestionSetSchema = z.object({
  recipientPersonId: z.string().min(1),
  suggestions: z.array(SavedSuggestionSchema),
  updatedAt: z.string(),
});
export type SavedSuggestionSet = z.infer<typeof SavedSuggestionSetSchema>;

export const QuestionnaireSuggestionsDocSchema = z.object({
  schemaVersion: z.number().int().positive(),
  sets: z.array(SavedSuggestionSetSchema),
});
export type QuestionnaireSuggestionsDoc = z.infer<typeof QuestionnaireSuggestionsDocSchema>;

/** The accumulate cap per recipient (08-questionnaires §18.3) — newest kept when a new batch overflows. */
export const SUGGESTION_CAP = 9;

/** Result of a persisted gap-finder generate (08-questionnaires §18.5): the updated saved set + honest
 * outcome. On failure the prior saved set is preserved (the caller returns it unchanged). */
export interface SavedSuggestionsResult {
  ok: boolean;
  saved?: SavedSuggestion[];
  // How many NEW suggestions were added this round (0 when the model returned nothing usable).
  added?: number;
  usage?: UsageEvent;
  reason?: AiFailureReason;
  message?: string;
}

/**
 * Outcome shapes for the AI authoring/analysis calls — shared by the IPC + services. `TRUNCATED` (cut off,
 * a retry) and `MALFORMED` (a reply arrived but no usable JSON could be salvaged) are the honest, distinct
 * parse-failure reasons (37 §3.2); `REFUSED` now means a *detected* refusal, not any parse miss.
 */
export type AiFailureReason =
  | 'NO_KEY'
  | 'DENIED'
  | 'BUDGET'
  | 'REFUSED'
  | 'TRUNCATED'
  | 'MALFORMED'
  | 'ERROR';
export interface QuestionnaireGenerateResult {
  ok: boolean;
  questions?: Question[];
  // A short AI-suggested title (08 §16.4) — the builder uses it only when the title field is still empty.
  title?: string;
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

/**
 * Result of the manual "Refresh memory" reconciliation (20-memory-dashboard §3.5). `AI_OFF` is the calm
 * not-configured state (no key / AI disabled); the dashboard still renders existing insights. On success it
 * reports how many insights were re-scored / merged so the UI can confirm what changed.
 */
export interface MemoryReconcileResult {
  ok: boolean;
  reconciledCount?: number;
  mergedCount?: number;
  /** Merge proposals queued for the user to confirm (39-living-memory §3.4 — confirm-before-apply). */
  proposedCount?: number;
  usage?: UsageEvent;
  /** `SKIPPED` = an automatic pass that wasn't warranted (throttle/threshold/opt-out) — a silent no-op. */
  reason?: AiFailureReason | 'AI_OFF' | 'NOTHING_TO_DO' | 'SKIPPED';
  message?: string;
}

/** The "kept tidy" signal + the queue of merge proposals for Memory (39-living-memory §3.2/§3.4). */
export interface MemoryReconcileState {
  lastReconciledAt?: string;
  proposals: MergeProposal[];
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
      // The symmetric content key (the one in the recipient's link fragment) wrapped under the master key,
      // so the sender can later seal an OUTCOME the recipient can decrypt with that same fragment key —
      // e.g. an external compatibility report pushed from Results (08 §17.12-D). Additive-optional: sends
      // minted before this omit it (their outcome write-back is simply unavailable), no migration.
      contentKeyWrapped: z.string().min(1).optional(),
      // The 6-digit PIN wrapped under the master key (08 §17.14d), so the sender can RE-SHOW the existing
      // link + PIN later ("Share link") instead of regenerating it every time. The relay still only ever
      // holds the `pinHash`. Additive-optional: sends minted before this omit it (their "Share link" falls
      // back to minting a fresh one); no migration.
      pinWrapped: z.string().min(1).optional(),
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
    z.array(z.object({ label: z.string(), date: z.string() })), // a `dateList` answer
    z.array(z.record(z.string(), z.string())), // a `roster` answer
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
  // Monotonic submission revision (56-answer-review-edit §4): 1 on first submit, incremented each time the
  // recipient edits + resubmits. Additive-optional (a pre-56 submitted response reads as revision 1), so the
  // sender can tell a re-analysis is due (`revision > analyzedRevision`). No schemaVersion bump.
  revision: z.number().int().positive().optional().catch(undefined),
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
  // A sealed outcome the sender pushed after both answered (08 §17.12-D) — RelayResult sealed under the
  // content key. Released alongside the content on PIN unlock so a returning recipient sees the result.
  sealedResult: EncryptedEnvelopeSchema.optional(),
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

/** The secret id under which the Claude API key is stored device-local (single source; re-exported by channels). */
export const ANTHROPIC_API_KEY_ID = 'anthropic.apiKey';
/** The secret id for the OpenAI API key — SelfOS's second provider, for dream images (13-dream-images §6.1). */
export const OPENAI_API_KEY_ID = 'openai.apiKey';

/**
 * Household-shared AI credentials (25-household-ai-credentials §4.1), stored encrypted under the master
 * key at `config/ai-credentials.enc` so every member device pointing at the same vault inherits a working
 * key. The plaintext keys sit *inside* the encrypted envelope — the same posture as `config/relay.enc`'s
 * Cloudflare token. Both providers are optional so a household may share Claude, OpenAI, both, or neither.
 */
export const AiCredentialsSchema = z.object({
  schemaVersion: z.number().int().positive(),
  anthropicApiKey: z.string().min(1).optional(),
  openaiApiKey: z.string().min(1).optional(),
  updatedAt: z.string().datetime().optional(),
  /** Who shared it (the owner) — informational, no secret material. */
  sharedByPersonId: z.string().optional(),
});
export type AiCredentials = z.infer<typeof AiCredentialsSchema>;

/** Which AI provider a credential / resolution refers to (25 §4.4). */
export const AiProviderSchema = z.enum(['anthropic', 'openai']);
export type AiProvider = z.infer<typeof AiProviderSchema>;

/**
 * Renderer-safe AI key readiness (25 §5.3) — **booleans + an enum only, never a key value**. Each AI
 * surface computes `aiAvailable = ai.enabled && resolvedReady`.
 */
export const AiKeyStatusSchema = z.object({
  hasSharedKey: z.boolean(),
  hasDeviceOverride: z.boolean(),
  resolvedReady: z.boolean(),
  source: z.enum(['device', 'shared', 'none']),
});
export type AiKeyStatus = z.infer<typeof AiKeyStatusSchema>;

/**
 * A device's registry entry (32-device-management §4.2), stored encrypted under the master key at
 * `config/devices/<deviceId>.enc` — one file per device so two devices booting at once never clobber a
 * shared registry. `platform` is the raw `BridgeHost.platform` string (macos/ios/web/…).
 */
export const DeviceRecordSchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string(),
  label: z.string(),
  platform: z.string(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  /** Best-effort: who last signed in on this device. The surface shows "—" if unknown. */
  lastActivePersonId: z.string().nullable().optional(),
  /** Set when this entry was the target of a revoke (audit; the file is then removed). */
  revokedAt: z.string().datetime().optional(),
});
export type DeviceRecord = z.infer<typeof DeviceRecordSchema>;

/** The renderer-facing projection of a device (32 §4.2) — no raw personId; the name is resolved owner-side. */
export const DeviceViewSchema = z.object({
  deviceId: z.string(),
  label: z.string(),
  platform: z.string(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  isThisDevice: z.boolean(),
  lastActivePersonName: z.string().nullable(),
});
export type DeviceView = z.infer<typeof DeviceViewSchema>;

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
 * The outcome the sender pushes back to an external recipient once both have answered (08 §17.12-D) — a
 * compatibility report or a plain acknowledgement, sealed under the SAME content key as the questions (so
 * the recipient opens it with the key already in their link fragment). The relay only ever holds the
 * sealed form. `kind: 'report'` carries the shared report; `'thanks'` is an acknowledgement with no report.
 */
export const RelayResultSchema = z.object({
  schemaVersion: z.number().int().positive(),
  kind: z.enum(['report', 'thanks']),
  headline: z.string().min(1), // the warm one-line outcome shown to the recipient
  summary: z.string().optional(), // the report summary (report kind)
  items: z.array(AlignmentItemSchema).optional(), // the per-question alignment (report kind)
  generatedAt: z.string(),
});
export type RelayResult = z.infer<typeof RelayResultSchema>;

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
      // 52-challenge-sessions §3.2: the coach emitted a `[[SELFOS:CHALLENGE:…]]` marker this turn and a
      // Challenge was captured (free — rides this turn). The renderer shows an inline "Challenge set ✓"
      // confirmation linking to the tracked card and refreshes the challenge store. Absent ⇒ no capture.
      challengeCreated?: { id: string; action: string };
      // 12-dreams §15.4: in a dream-analysis turn, the coach emitted a `[[SELFOS:DREAM_READY]]` marker —
      // it has gathered enough to write a meaningful analysis. The renderer surfaces a highlighted
      // "Analyze this dream" suggestion (never a gate — synthesis stays available). Absent ⇒ not yet ready.
      analysisReady?: boolean;
    }
  // EMPTY = the model returned no visible text (e.g. adaptive thinking starved the max_tokens budget). It's a
  // real failure the user can retry, never a silently-saved blank reply (05-conversations §4.1).
  | { ok: false; reason: 'NO_KEY' | 'BUDGET' | 'ERROR' | 'EMPTY'; message: string };

/**
 * Result of "End & summarize" (09-session-analysis §6). On success carries the produced (auto-approved)
 * Session Insight + the metered usage; the wrap-up card renders from the Insight (summary, facts, the
 * mood metrics, crisis flag). `MEMORY_DISABLED` when the session-memory master toggle is off.
 */
export type SessionSummaryResult =
  | { ok: true; insight: Insight; usage: UsageEvent }
  | {
      ok: false;
      // TRUNCATED/MALFORMED/REFUSED are the honest parse-failure reasons (37 §3.2).
      reason:
        | 'NO_KEY'
        | 'BUDGET'
        | 'ERROR'
        | 'MEMORY_DISABLED'
        | 'NOT_FOUND'
        | 'REFUSED'
        | 'TRUNCATED'
        | 'MALFORMED';
      message: string;
      usage?: UsageEvent;
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
 * Proactive-coaching intensity (40-proactive-coaching §3.6/§4.1a). Per-person, read in the bridge.
 * `off` = no in-session goal-raising, no synthesis pass, no goal-followup nudges (cross-insight crisis
 * awareness §3.5 is safety and is NEVER disabled by this). `gentle` (default when absent) = in-session
 * goal-raising + a slow synthesis cadence + ≤1 open nudge. `active` = a faster synthesis cadence + a
 * slightly more present in-session coach.
 */
export const ProactivityLevelSchema = z.enum(['off', 'gentle', 'active']);
export type ProactivityLevel = z.infer<typeof ProactivityLevelSchema>;

/** Per-person coaching preferences (40 §4.1a) — `people/<id>/coaching/prefs.enc`. Absent ⇒ `gentle`. */
export const CoachingPrefsSchema = z.object({
  schemaVersion: z.number().int().positive(),
  proactivity: ProactivityLevelSchema.optional(), // absent ⇒ DEFAULT_PROACTIVITY ('gentle')
});
export type CoachingPrefs = z.infer<typeof CoachingPrefsSchema>;

/** The proactivity level when a person hasn't chosen one (40 §3.6). */
export const DEFAULT_PROACTIVITY: ProactivityLevel = 'gentle';

/**
 * The cached cross-feature synthesis (40-proactive-coaching §4.1) — one gentle observation connecting signals
 * across the person's recent sessions + dreams + questionnaires + intake. Stored per-subject at
 * `people/<id>/coaching/synthesis.enc`; re-running OVERWRITES it (one current observation, not history). It is
 * NOT an Insight and is NEVER promoted into `summarizeForContext` — it's a surfaced nudge, not grounding.
 * Tolerant-parsed (spec 37): only `observation` is required; the rest `.catch` to defaults.
 */
export const CoachingSynthesisSchema = z.object({
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1), // per-person isolation
  observation: z.string(), // the one gentle cross-feature observation (the only required field)
  sources: z.array(z.string()).catch([]).default([]), // which surfaces fed it (e.g. "dreams", "sessions")
  lifeArea: z.string().optional(), // from LIFE_AREAS, normalized server-side — drives coalescing (§3.7)
  computedAt: z.string(),
  windowFrom: z.string().optional(),
  windowTo: z.string().optional(),
});
export type CoachingSynthesis = z.infer<typeof CoachingSynthesisSchema>;

/** The result of running the cross-feature synthesis pass (40 §6) — budget-gated `coaching.synthesize`. */
export type CoachingSynthesisResult =
  | { ok: true; synthesis: CoachingSynthesis }
  | {
      ok: false;
      reason:
        | 'NO_KEY'
        | 'BUDGET'
        | 'CAPPED' // the proactivity-specific per-week synthesis cap (40 §3.4) — distinct from a hard BUDGET stop
        | 'AI_OFF'
        | 'EMPTY'
        | 'REFUSED'
        | 'TRUNCATED'
        | 'MALFORMED'
        | 'ERROR';
      message: string;
    };

/**
 * A cached **relationship-insights** synthesis (54-memory-redesign) — per (viewer, partner). The AI pass reads
 * the viewer's OWN insights + what the partner has chosen to SHARE (never the partner's raw answers) and emits
 * a few gentle observations about the viewer and the dynamic. Cached view-only (explicit-tap, no auto-cadence
 * in v1); NOT promoted into context. Per-person isolation: `subjectPersonId` is the viewer.
 */
export const RelationshipSynthesisSchema = z.object({
  schemaVersion: z.number().int().positive(),
  subjectPersonId: z.string().min(1), // the viewer
  partnerPersonId: z.string().min(1), // the partner this synthesis is about
  observations: z.array(z.string()).min(1), // the relationship insights (about the viewer + the dynamic)
  computedAt: z.string(),
});
export type RelationshipSynthesis = z.infer<typeof RelationshipSynthesisSchema>;

/** The result of running the relationship-insights synthesis (54 §6) — budget-gated `relationship.synthesize`. */
export type RelationshipSynthesisResult =
  | { ok: true; synthesis: RelationshipSynthesis }
  | {
      ok: false;
      reason:
        | 'NO_KEY'
        | 'BUDGET'
        | 'CAPPED'
        | 'AI_OFF'
        | 'EMPTY' // not enough signal yet (the viewer has little memory, the partner shares little)
        | 'REFUSED'
        | 'TRUNCATED'
        | 'MALFORMED'
        | 'ERROR';
      message: string;
    };

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
      // TRUNCATED/MALFORMED join the honest parse-failure reasons (37 §3.2).
      reason: 'NO_KEY' | 'BUDGET' | 'ERROR' | 'REFUSED' | 'TRUNCATED' | 'MALFORMED' | 'DENIED';
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
  // TRUNCATED (cut off) vs MALFORMED (unexpected shape) are now distinct (37 §3.2; was both ERROR).
  | {
      ok: false;
      reason: 'NO_KEY' | 'BUDGET' | 'ERROR' | 'TRUNCATED' | 'MALFORMED';
      message: string;
    };

/**
 * One Inbox row for the recipient (08-questionnaires §3.3). A **derived** view — the recipient sees the
 * purpose and (unless the sender chose anonymity) who's asking, never the sender's private data.
 * Computed in the bridge from the assignment + its frozen snapshot, so raw answers never cross IPC here.
 */
export interface InboxItem {
  assignmentId: string;
  title: string;
  type: string; // the questionnaire's category (from the frozen snapshot), shown as the card eyebrow
  questionCount: number;
  status: AssignmentStatus;
  privacy: PrivacyMode;
  senderName: string | null; // null = the sender stayed anonymous
  createdAt: string;
  answeredAt?: string; // when the recipient submitted (ISO) — present once submitted
  favorite: boolean; // the active person pinned it (device-local, per-person)
  answerable: boolean; // still open to answer / decline
  hasDraft: boolean; // saved-but-unsubmitted progress exists
  // True when the active person is BOTH sender and recipient (a self check-in). The standalone Inbox still
  // lists it, but the Questionnaires landing's "Received" section (things OTHERS sent you) filters it out —
  // it already appears there under "Sent" (08 §3.3), so it never double-renders on one screen.
  fromSelf: boolean;
  // Present for a compatibility send (read from the frozen snapshot): the visibility mode, so the card's
  // privacy chip (08 §3.1) can state the REAL promise per mode — a generic "private" would misstate
  // `senderSeesAll`, where the sender may see the answers.
  compatibilityVisibility?: CompatibilityVisibility;
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
 * A cross-recipient "At a glance" aggregate for one questionnaire (08-questionnaires §20.7/§21.5). A derived,
 * sender-scoped view carrying **no raw written answers** — only distributions/averages/counts. The
 * **privacy rule** (§8.4/§21.5): **Private sends are excluded ENTIRELY** — the aggregate is Standard sends
 * only, for every question type (a private recipient's answers, words AND numbers, are never shown).
 * Additive view type — no persisted-schema change.
 */
export interface AggregateOptionCount {
  label: string;
  count: number;
}
export interface AggregateRowAverage {
  label: string;
  average: number; // mean of the numeric answers for this row/bucket
}
interface QuestionAggregateBase {
  questionId: string;
  prompt: string;
  /** How many STANDARD sends answered this question (private sends are excluded from the aggregate, §21.5). */
  responseCount: number;
}
// A proper discriminated union (each member carries the base fields) so `Extract`/switch narrowing works.
export type QuestionAggregate =
  | (QuestionAggregateBase & { kind: 'distribution'; options: AggregateOptionCount[] }) // choice / yes-no / this-or-that
  | (QuestionAggregateBase & { kind: 'average'; average: number; min: number; max: number }) // rating / slider
  | (QuestionAggregateBase & {
      kind: 'rows';
      rows: AggregateRowAverage[];
      min: number;
      max: number;
    }) // matrix per-row avg
  | (QuestionAggregateBase & { kind: 'allocation'; rows: AggregateRowAverage[] }) // allocation per-bucket avg
  | (QuestionAggregateBase & { kind: 'count' }); // free-text / date / ranking — just the response count
export interface QuestionnaireAggregate {
  questions: QuestionAggregate[];
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
  // True when this send carries relay material (a link the recipient can answer from anywhere). A household
  // ('inApp') send ALSO mints one when a relay is connected (§17.13), so relay affordances (drain / link /
  // revoke) must key off THIS, not `channel === 'relay'`.
  relayLinked: boolean;
  status: AssignmentStatus;
  privacy: PrivacyMode;
  createdAt: string;
  // When a relay-linked send's link stops working (default 60 days). Surfaced so the sender knows when to
  // re-share, before the recipient hits a dead link (38 §3.6). Absent on a link-less in-app send.
  expiresAt?: string;
  submittedAt?: string;
  declineNote?: string;
  analyzed: boolean;
  // True when this send was analyzed but the recipient has since edited + resubmitted their answers, so the
  // Insight is out of date (56-answer-review-edit §3.2: `response.revision > insight.analyzedRevision`). Drives
  // the "Answers updated — re-analyze" chip. Always false for a never-analyzed or in-app-editing-disabled send.
  analysisStale: boolean;
  // The recipient's current submission revision (56 §4), so the auto-analyze guard can distinguish a genuine
  // re-edit from a retry of the same attempt. Present for a submitted send (a re-edit bumps it).
  revision?: number;
  answers?: SendAnswer[]; // present only for a Standard, submitted send
  // The derived Insight's summary + id, present once analyzed — so Results can deep-link to the exact insight
  // in Memory (and, for a Standard send, show the excerpt inline, 08 §20.8/§21.5). The insight is the derived,
  // allowed output even for a Private send; the raw answers are never carried.
  insightSummary?: string;
  insightId?: string;
}

/**
 * Per-questionnaire send state for the author's list (08-questionnaires §17.14): the latest time the active
 * person sent this questionnaire + how many times. Absent for a never-sent questionnaire (so the list can
 * show a "Draft" affordance). Pure metadata — no answers, no recipient detail.
 */
export interface QuestionnaireSendState {
  lastSentAt: string;
  total: number;
  // Whether the LATEST send has been answered (submitted/analyzed). Once answered there's nothing left to
  // answer, so the "Share a link" affordance is hidden (a re-ask creates a fresh unanswered send → shown
  // again). Additive; absent ⇒ treat as not-answered (the pre-existing "show the link" behaviour).
  answered?: boolean;
}

/**
 * One recipient of a questionnaire, as summarised on the redesigned Questionnaires landing "Sent" card
 * (08-questionnaires §3.1). Deduped to the recipient's LATEST send, so a re-asked questionnaire shows each
 * person once with their current state — never the raw answers (that stays the per-send Results view).
 */
export interface SentRecipientSummary {
  /** Display name (a household person's name, or the external recipient's label). */
  name: string;
  /** The recipient's latest send status — drives the per-person state dot. */
  status: AssignmentStatus;
  /** True once the recipient has submitted (status `submitted` or `analyzed`). */
  answered: boolean;
  /** When this recipient's latest send was submitted (ISO) — present only once answered. */
  answeredAt?: string;
}

/**
 * A per-questionnaire "Sent" overview for the landing cards (08-questionnaires §3.1) — richer than
 * QuestionnaireSendState: who it went to + who's answered, so a card can read "1 of 2 answered". A derived,
 * sender-scoped view gated on `questionnaires.viewResults` (recipient detail is results territory); the raw
 * answers never cross here. Recipients are deduped to their latest send; the sender's own compatibility half
 * is excluded (they answer in-app, not a "recipient").
 */
export interface QuestionnaireSentOverview {
  questionnaireId: string;
  lastSentAt: string;
  /** Distinct recipients (deduped), each with their latest status. */
  recipients: SentRecipientSummary[];
  /** How many distinct recipients have answered — the numerator of "X of N answered". */
  answeredCount: number;
  /** Submitted responses not yet analysed by the sender — drives the "N new" badge. */
  newResponses: number;
  /** The most recent submission time across all sends (ISO) — the card's "Answered <date·time>". */
  answeredAt?: string;
  /** True once every submitted send has been analysed (≥1 submitted, none left un-analysed). */
  analyzed: boolean;
  /** The derived Insight's full summary (the latest analysed send) — the card clamps it for display. */
  insightSummary?: string;
  /** That Insight's id, so the card's "View in Memory" can deep-link straight to it. Present with
   *  `insightSummary`. */
  insightId?: string;
  /** The latest submitted-but-un-analysed send, so the card can offer a one-tap "Analyze". Absent when
   *  there's nothing new to analyse (nothing submitted, or all analysed). */
  analyzableAssignmentId?: string;
  /** The privacy mode of the recipients' latest sends, for the card's privacy chip (§3.1 card privacy
   *  badges): `private` = the sender sees only the derived insight, `standard` = the sender sees the
   *  answers, `mixed` = a legacy multi-recipient questionnaire whose latest sends differ. Derived with the
   *  same per-recipient latest-send dedup as `recipients`; absent only when there are no sends. */
  privacy?: PrivacyMode | 'mixed';
}

/**
 * One questionnaire the active person sent that has ≥1 submitted response — the source for the
 * `responses-arrived` notification (35-notification-system §3.6). Derived in the bridge from the sender's
 * assignments (local read; no network — the relay drain is the existing point that fetches external
 * responses). `submittedCount` is the re-surface signature (a new response → higher count → re-surfaces).
 */
/**
 * One questionnaire the active person sent that's still unanswered after the reminder window (7 days) — the
 * source for the `reminder-due` notification (38 §3.3). Derived in the bridge from the sender's open sends
 * (local read; no network, no scheduler). Nudges the SENDER to re-share; it never messages the recipient.
 */
export interface ReminderDueSummary {
  questionnaireId: string;
  title: string;
  recipientName: string; // the most recent still-unanswered recipient (names the nudge)
  count: number; // unanswered sends past the window — the re-surface signature (onIncrease)
}

export interface ResponsesArrivedSummary {
  questionnaireId: string;
  title: string;
  submittedCount: number;
  /**
   * The most recent responder's display name (or a neutral label for an unnamed external), so the
   * notification can read "Angel answered …" rather than a faceless count (38 §3.1/§4.2).
   */
  latestRecipientName: string;
  /** The newest response's time (the assignment's submit timestamp) — orders the notification (38 §4.2). */
  at: string;
}

/**
 * One send whose recipient EDITED their answers after the sender analyzed them (56-answer-review-edit §3.2) —
 * the source for the `answers-updated` notification. Derived in the bridge from the sender's assignments +
 * insights (local read; carries NO raw answers, so a Private send's boundary holds). `revision` is the
 * re-surface signature (a further edit → higher revision → re-surfaces; onIncrease).
 */
export interface AnswersUpdatedSummary {
  assignmentId: string; // the specific send that was edited — the notification coalesces per send
  questionnaireId: string; // for the Results deep-link + title
  title: string;
  recipientName: string; // who edited (names the nudge)
  revision: number; // the recipient's current response revision — the re-surface signature (onIncrease)
  at: string; // the newest edit's submit timestamp — orders the notification
}

/** One of the two paired sends of a compatibility questionnaire, as the sender sees it (08 §3.6). */
export interface CompatibilityMember {
  assignmentId: string;
  recipientName: string;
  channel: Channel; // 'relay' = an external recipient (answers via a link; can receive a pushed outcome)
  // True when this member carries relay material — an external recipient OR a household member that also
  // minted a link (§17.14). Drives the per-member "Share / Resend link" + the group drain affordance.
  relayLinked: boolean;
  isSelf: boolean; // the sender's own member (answers in-app; never gets a link to share)
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
      // TRUNCATED/MALFORMED join the honest parse-failure reasons (37 §3.2).
      reason:
        | 'NO_KEY'
        | 'DENIED'
        | 'BUDGET'
        | 'REFUSED'
        | 'TRUNCATED'
        | 'MALFORMED'
        | 'ERROR'
        | 'NOT_READY';
      message: string;
      usage?: UsageEvent;
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
      // TRUNCATED/MALFORMED join the honest parse-failure reasons (37 §3.2).
      reason:
        | 'NO_KEY'
        | 'DENIED'
        | 'BUDGET'
        | 'REFUSED'
        | 'TRUNCATED'
        | 'MALFORMED'
        | 'ERROR'
        | 'NOT_READY';
      message: string;
    };

/**
 * The result of an in-app (household) send (08-questionnaires §13.5/§17.13). The recipient always gets it
 * in their Inbox; when a relay is connected and the sender can deliver externally, a `link` + `pin` are also
 * minted so the recipient can answer anywhere — the first submission (either surface) wins. Absent when no
 * relay is connected (Inbox-only, the graceful fallback).
 */
export interface InAppSendResult {
  assignment: Assignment;
  link?: string;
  pin?: string;
  // Set when a relay IS connected but minting the link failed (e.g. the relay is unreachable). The send
  // still stands (Inbox), but this is surfaced — NOT silently swallowed — so the sender knows the link
  // didn't go out and can retry from Results. Absent when no relay is connected (Inbox-only by design).
  linkError?: string;
}

/** A freshly minted (or re-minted) relay link + its one-time PIN — for delivery / re-share (08 §17.14). */
export interface RelayLinkResult {
  link: string;
  pin: string;
}

/**
 * The result of pushing an external compatibility outcome to the recipient(s) from Results (08 §17.12-D).
 * `published` is how many external relay members received the sealed report. `NOT_READY` until the
 * alignment report exists; `INVALID` when the group has no external recipient to share with.
 */
export type CompatResultPublish =
  | { ok: true; published: number }
  | { ok: false; reason: 'DENIED' | 'NOT_READY' | 'INVALID' | 'ERROR'; message: string };

/** The result of a dual compatibility send (generate each variant + freeze the paired snapshots). */
export type CompatibilitySendResult =
  | {
      ok: true;
      compatibilityGroupId: string;
      // The recipient's link + PIN, returned once for delivery: an EXTERNAL recipient always answers via
      // the relay (08 §17.12-B), and a HOUSEHOLD recipient ALSO gets a link when a relay is connected
      // (§17.14a) — they answer in their Inbox OR via the link. Omitted when no relay is connected.
      link?: string;
      pin?: string;
      // Set when a relay IS connected but minting the recipient's link failed — surfaced, not swallowed,
      // so the sender knows the link didn't go out and can retry from Results (§17.14a). Absent = no relay.
      linkError?: string;
    }
  | {
      ok: false;
      // TRUNCATED/MALFORMED propagate from a variant-generation parse failure (37 §3.2).
      reason:
        | 'NO_KEY'
        | 'DENIED'
        | 'BUDGET'
        | 'REFUSED'
        | 'TRUNCATED'
        | 'MALFORMED'
        | 'ERROR'
        | 'INVALID';
      message: string;
    };

/** The result of synthesizing a dream (+ guided transcript) into a structured analysis (12 §3.2). */
export type DreamSynthesisResult =
  | { ok: true; analysis: DreamAnalysis; usage: UsageEvent }
  | {
      ok: false;
      // TRUNCATED/MALFORMED/REFUSED are the honest parse-failure reasons (37 §3.2).
      reason: 'NO_KEY' | 'BUDGET' | 'ERROR' | 'NOT_FOUND' | 'REFUSED' | 'TRUNCATED' | 'MALFORMED';
      message: string;
      usage?: UsageEvent;
    };

/**
 * The result of opening (or resuming) a dream's guided reflection (12 §15.4). The coach opens the
 * conversation itself with an AI-generated first message that reflects the specific dream back. Falls back
 * to a static opener (still `ok: true`) when AI can't run (no key / over budget / transport error), so the
 * session always opens; `usage` is present only when the AI opener actually ran + was metered. `ok: false`
 * only for a genuinely-missing dream.
 */
export type DreamReflectionResult =
  | { ok: true; conversation: Conversation; usage?: UsageEvent }
  | { ok: false; reason: 'ERROR'; message: string };

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

// ── Together: couples sessions (58-together-couples-sessions) ────────────────────────────────────
// Async, invitation-based, AI-facilitated sessions between connected partners. All records are new
// (`schemaVersion: 1`), one-writer-per-file (§4) — session status/staleness/turn state are DERIVED on
// read, never stored, so no file needs a second writer (the one exception, `Agreement`, lands in Phase D).

/**
 * A Together session (§4.2). Written **once** by the initiator at create, then IMMUTABLE — status,
 * staleness, and the guided step are all derived on read (§4.3/§3.8/§3.10), so there is never a second
 * writer. `participantIds` is exactly 2 in v1 but N-ready by design (§2 non-goal).
 */
export const TogetherSessionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  pairKey: z.string().min(1),
  participantIds: z.array(z.string().min(1)).min(2),
  initiatorPersonId: z.string().min(1), // the payer (§6.2)
  topic: z.string().optional(), // immutable in v1 (§2 non-goal)
  guideId: z.string().optional(), // Together catalog entry (§3.10); current STEP is derived from messages
  createdAt: z.string(),
});
export type TogetherSession = z.infer<typeof TogetherSessionSchema>;

/**
 * Each participant's own state file (§4.2), the ONLY writer being that person. `declinedAt`/`pausedAt`
 * are honored only in the writer's own projection (§4.3); `leftAt` ends the session for both, neutrally.
 */
export const ParticipantStateSchema = z.object({
  schemaVersion: z.literal(1),
  personId: z.string().min(1),
  rulesAckAt: z.string().optional(), // accepting the rules of the room — the consent record (§3.4)
  declinedAt: z.string().optional(), // decline quietly — honored only in the DECLINER's projection (§3.5)
  pausedAt: z.string().optional(), // pause-for-me — visible only in the pauser's own view (§8.3)
  leftAt: z.string().optional(), // ends the session for both, neutrally (§8.3)
  lastReadMessageAt: z.string().optional(), // drives the unread/turn badges (projection-derived)
  ynmOptInAt: z.string().optional(), // §3.10b symmetric opt-in; cleared by together:ynmRevoke (Phase F)
  updatedAt: z.string(),
});
export type ParticipantState = z.infer<typeof ParticipantStateSchema>;

/**
 * A single message in a Together session (§4.2) — write-once by its author's device. A private aside
 * (and the coach's private reply to it) carries `privateAside: true` + the aside author's
 * `authorPersonId`, so the projection (§5.2) hides the whole exchange from the partner.
 */
export const TogetherMessageSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  authorPersonId: z.string().min(1), // the human author; a coach msg carries the turn-runner's id
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  ts: z.string(),
  privateAside: z.boolean().optional(), // §3.6 — the whole aside EXCHANGE (incl. the coach reply) carries this
  replyToMessageId: z.string().optional(), // coach msgs: the triggering message; never crosses a masking projection
  attachments: z.array(AttachmentRefSchema).optional(), // stored under the session's attachments/ (§4.1, Phase C)
  // A structured guided couples session (§3.10): the step the coach declared this turn (parsed from its
  // `[[SELFOS:STEP:n]]` marker, stripped from `content`). The CURRENT step is derived from the newest coach
  // message carrying this — never stored on the single-writer session.enc. Additive-optional (Phase E).
  guideStep: z.number().int().nonnegative().optional(),
  // A coach-INITIATED private note (§3.14 Part B) — distinguishes it from an ordinary §3.6 aside coach reply
  // (both are `assistant` + `privateAside` + authored-for-viewer). Drives the `together-private` signal so it
  // fires only for an unprompted note, never for a reply the viewer just watched arrive. Additive-optional.
  coachInitiated: z.boolean().optional(),
});
export type TogetherMessage = z.infer<typeof TogetherMessageSchema>;

/** Derived, viewer-projected session status (§4.3). `declined` is internal — the decliner's own list drops it. */
export const TogetherStatusSchema = z.enum([
  'invited',
  'expired',
  'active',
  'onHold',
  'ended',
  'complete',
  'declined',
]);
export type TogetherStatus = z.infer<typeof TogetherStatusSchema>;

/** A participant descriptor for rendering the avatar pair (names resolved bridge-side). */
export interface TogetherParticipant {
  personId: string;
  displayName: string;
}

/** One projected message (§5.2) — author-attributed; asides present only for their author. */
export interface TogetherMessageView {
  id: string;
  authorPersonId: string;
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  privateAside: boolean;
  replyToMessageId?: string;
  attachments?: AttachmentRef[];
}

/** A Together sessions-list summary, every field derived over the viewer's projection (§3 intro). */
export interface TogetherSessionSummary {
  id: string;
  pairKey: string;
  topic?: string;
  guideId?: string;
  initiatorPersonId: string;
  participants: TogetherParticipant[];
  status: TogetherStatus;
  yourTurn: boolean;
  unreadCount: number;
  lastMessageSnippet?: string;
  lastMessageAt?: string;
  /** The ts of the newest private coach note for the viewer (§3.14 Part B) — drives `together-private`. */
  lastPrivateCoachAt?: string;
  createdAt: string;
}

/** A couples guided-catalog card the renderer shows (§3.10) — steering (addendum/opener) omitted. */
export interface TogetherCatalogEntry {
  id: string;
  group: string;
  groupTitle: string;
  title: string;
  framework: string;
  blurb: string;
  kind: 'chat' | 'structured';
  /** Number of named steps for a structured practice (0 for a chat practice) — drives the "N steps" marker. */
  stepCount: number;
  adult: boolean;
}

/** The resolved guide meta a guided couples session carries (§3.10) — title/steps for the card + stepper. */
export interface TogetherGuideView {
  id: string;
  title: string;
  framework: string;
  kind: 'chat' | 'structured';
  steps?: string[];
  adult?: boolean;
}

/** The full session view — the summary plus the viewer-projected messages + the viewer's own ack flag. */
export interface TogetherSessionView extends TogetherSessionSummary {
  messages: TogetherMessageView[];
  viewerAcked: boolean;
  /** The resolved guide (a guided couples session, §3.10), absent for a free session. */
  guide?: TogetherGuideView;
  /** The DERIVED current step for a structured guide (newest coach message's `guideStep`), else absent. */
  guideStep?: number;
}

/** Create input (§6.1) — Zod-validated in the bridge before any storage. */
export const TogetherCreateInputSchema = z.object({
  partnerPersonId: z.string().min(1),
  topic: z.string().max(200).optional(),
  guideId: z.string().min(1).optional(),
});
export type TogetherCreateInput = z.infer<typeof TogetherCreateInputSchema>;

export const TogetherSetPausedInputSchema = z.object({
  sessionId: z.string().min(1),
  paused: z.boolean(),
});
export type TogetherSetPausedInput = z.infer<typeof TogetherSetPausedInputSchema>;

export const TogetherMarkReadInputSchema = z.object({
  sessionId: z.string().min(1),
  at: z.string().min(1),
});
export type TogetherMarkReadInput = z.infer<typeof TogetherMarkReadInputSchema>;

/**
 * The result of `together:create` (§6.1) — a discriminated union so the renderer can surface the exact
 * prerequisite-absent state (§3.13).
 */
export type TogetherCreateResult =
  | { ok: true; session: TogetherSessionView }
  | {
      ok: false;
      reason: 'NOT_READY' | 'NOT_ALLOWED' | 'NO_EDGE' | 'PARTNER_NOT_SUBJECT';
      message: string;
    };

/** The result of a couples turn (§5.1) — the refreshed viewer-projected view, or an honest failure (37). */
export type TogetherTurnResult =
  | { ok: true; view: TogetherSessionView }
  | {
      ok: false;
      reason: 'NO_KEY' | 'BUDGET' | 'EMPTY' | 'ERROR' | 'NOT_ALLOWED';
      message: string;
    };

export const TogetherSendMessageInputSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1),
  privateAside: z.boolean().optional(), // §3.6 — a private aside to the coach
  attachments: z.array(AttachmentRefSchema).optional(), // §6.1 — already-stored image refs (Phase C)
});
export type TogetherSendMessageInput = z.infer<typeof TogetherSendMessageInputSchema>;

export const TogetherRetryInputSchema = z.object({ sessionId: z.string().min(1) });
export type TogetherRetryInput = z.infer<typeof TogetherRetryInputSchema>;

/** Prep-space open input (§3.7) — the caller's own prep Conversation for a session. */
export const TogetherPrepOpenSchema = z.object({ sessionId: z.string().min(1) });
export type TogetherPrepOpenInput = z.infer<typeof TogetherPrepOpenSchema>;

/** Together attachment store/read inputs (§6.1) — the session's own image seam (aside-gated reads). */
export const TogetherStoreAttachmentSchema = z.object({
  sessionId: z.string().min(1),
  // ~5 MB of image → ~6.83 MB of base64; cap at 8 MB chars so a hostile renderer can't force an unbounded
  // decode before the core size check (which authoritatively re-validates the real byte length) runs.
  base64: z
    .string()
    .min(1)
    .max(8 * 1024 * 1024),
  mime: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type TogetherStoreAttachmentInput = z.infer<typeof TogetherStoreAttachmentSchema>;

export const TogetherGetAttachmentSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
});
export type TogetherGetAttachmentInput = z.infer<typeof TogetherGetAttachmentSchema>;

// ── Phase D: wrap-up report + the pair agreements ledger (58 §3.8/§3.9) ───────────────────────────

/** The shared wrap-up report — both partners see it; staleness is DERIVED, never stored (§3.8). */
export const SharedReportSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  summary: z.string(),
  themes: z.array(z.string()).default([]),
  workedThrough: z.array(z.string()).default([]),
  agreementIds: z.array(z.string()).default([]),
  challengeGroupId: z.string().optional(),
  // Dyad metrics mirror (the chart source of truth stays the twins); crisis detail is NEVER here (§8.5).
  metrics: z.record(z.string(), z.number()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SharedReport = z.infer<typeof SharedReportSchema>;

export const AgreementStatusSchema = z.enum(['standing', 'done', 'retired']);
export type AgreementStatus = z.infer<typeof AgreementStatusSchema>;

/** A pair-level agreement — the ONE two-editor record (either partner edits/retires; last-write-wins, §7). */
export const AgreementSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  pairKey: z.string().min(1),
  text: z.string().min(1),
  timeframe: z.string().optional(),
  status: AgreementStatusSchema,
  provenance: z.object({ sessionId: z.string(), at: z.string() }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Agreement = z.infer<typeof AgreementSchema>;

export const TogetherWrapUpInputSchema = z.object({ sessionId: z.string().min(1) });
export type TogetherWrapUpInput = z.infer<typeof TogetherWrapUpInputSchema>;

/** The wrap-up result the bridge returns (the shared report on success; an honest failure reason otherwise). */
export type TogetherWrapUpResult =
  | { ok: true; report: SharedReport; stale: false }
  | {
      ok: false;
      reason:
        | 'NOT_ALLOWED'
        | 'MEMORY_DISABLED'
        | 'EMPTY'
        | 'NO_KEY'
        | 'BUDGET'
        | 'TRUNCATED'
        | 'MALFORMED'
        | 'REFUSED'
        | 'ERROR';
      message: string;
    };

export const TogetherGetReportInputSchema = z.object({ sessionId: z.string().min(1) });
export type TogetherGetReportInput = z.infer<typeof TogetherGetReportInputSchema>;

// ── Phase F: Yes/No/Maybe — together (§3.10b) ─────────────────────────────────────────────────────

/** A person's symmetric YNM opt-in for a pair (§3.10b) — stored at people/<id>/together/ynm/<pairKey>.enc. */
export const YnmOptInSchema = z.object({
  schemaVersion: z.literal(1),
  personId: z.string().min(1),
  pairKey: z.string().min(1),
  optedInAt: z.string(),
});
export type YnmOptIn = z.infer<typeof YnmOptInSchema>;

/** The YNM status a viewer sees for a partner (§3.10b) — never reveals the partner's inventory, only readiness. */
export interface TogetherYnmStatus {
  /** Whether the ACTIVE person has acknowledged adult content (their own state — drives the ack affordance). */
  youAcked: boolean;
  /** Whether the explicit register is unlocked for this pair (both 18+ acks + live edge). */
  eligible: boolean;
  youOptedIn: boolean;
  partnerOptedIn: boolean;
  /** True iff eligible AND both opted in — the mutual overlap can be shown/fed (§3.10b). */
  ready: boolean;
}

/** The mutual YNM overlap (§3.10b) — items BOTH partners are ≥ "curious" about; one-sided answers never shown. */
export interface TogetherYnmOverlap {
  ready: boolean;
  items: { key: string; label: string }[];
}

export const TogetherYnmInputSchema = z.object({ partnerPersonId: z.string().min(1) });
export type TogetherYnmInput = z.infer<typeof TogetherYnmInputSchema>;

// ── Phase G: Pulse (§3.10a — absorbs spec 11) ─────────────────────────────────────────────────────

/** The pulse metric starter set (§11 #4): a 1-3 tap check-in logs a subset of these (each normalized 0..1). */
export const PULSE_METRICS = ['connection', 'desire', 'satisfaction'] as const;
export type PulseMetric = (typeof PULSE_METRICS)[number];
/** The single source of truth for each metric's display label — used by the trend assembly AND the check-in UI. */
export const PULSE_METRIC_LABELS: Record<PulseMetric, string> = {
  connection: 'Connection',
  desire: 'Desire',
  satisfaction: 'Satisfaction',
};

/** A person's own pulse check-in (§3.10a) — one writer, stored at people/<logger>/together/pulse/<pairKey>/. */
export const PulseCheckInSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  pairKey: z.string().min(1),
  loggerPersonId: z.string().min(1), // their OWN perception; one writer
  at: z.string(),
  metrics: z.record(z.string(), z.number()), // e.g. { connection, desire, satisfaction } normalized 0..1
  shareMetrics: z.array(z.string()).optional(), // metric keys this logger consents to comparative views for
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PulseCheckIn = z.infer<typeof PulseCheckInSchema>;

/** A trend line for the Pulse chart — a named metric over time (x = ms timestamp, y = 0..1). */
export interface PulseSeries {
  label: string;
  points: { x: number; y: number }[];
  /** A plain-language direction for the §9 text-equivalent ('rising' | 'steady' | 'dipping' | 'flat'). */
  direction: 'rising' | 'steady' | 'dipping' | 'flat';
}

/**
 * The desire-alignment comparative (§3.10a / 11 §3.1) — shown ONLY when BOTH partners have logged a check-in
 * with a `desire` metric they each CONSENTED to share. Never inferred; hidden (`ready:false`) until then.
 */
export interface PulseAlignment {
  ready: boolean;
  /** The two most-recent shared desire values (0..1) + a plain-language read ('aligned' | 'some distance'). */
  yours?: number;
  theirs?: number;
  read?: 'aligned' | 'some distance';
}

/** The Pulse view (§3.10a): the viewer's own metric trends + dyad trends + the dual-consent desire alignment. */
export interface TogetherPulseView {
  /** The viewer's own check-in metric trends + the dyad Connection/Friction from the wrap-up twins (0..1). */
  series: PulseSeries[];
  /** Whether the viewer has logged at least one check-in (drives the empty state). */
  hasCheckIns: boolean;
  /** The viewer's most-recent check-in timestamp (ISO), if any — drives the "log regularly" nudge. */
  lastCheckInAt?: string;
  alignment: PulseAlignment;
}

export const TogetherPulseLogInputSchema = z.object({
  partnerPersonId: z.string().min(1),
  metrics: z.record(z.string(), z.number()),
  shareMetrics: z.array(z.string()).optional(),
});
export type TogetherPulseLogInput = z.infer<typeof TogetherPulseLogInputSchema>;

/** A coach SUGGESTION artifact (58 §5.6) — a write-once card in the session; NEVER auto-acts. One writer. */
export const TogetherSuggestionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  kind: z.enum(['guide', 'questionnaire']),
  prompt: z.string().min(1), // the coach's human phrasing shown on the card
  guideId: z.string().optional(), // a `guide` suggestion → the Together catalog entry to start
  topic: z.string().optional(), // a `questionnaire` suggestion → a topic to seed a compatibility check-in
  createdAt: z.string(),
});
export type TogetherSuggestion = z.infer<typeof TogetherSuggestionSchema>;

/** Save (create/edit/retire) an agreement — inline on the ledger (§11 #2). `id` absent ⇒ create. */
export const TogetherSaveAgreementInputSchema = z.object({
  sessionId: z.string().min(1),
  id: z.string().optional(),
  text: z.string().min(1).max(2000),
  timeframe: z.string().max(200).optional(),
  status: AgreementStatusSchema,
});
export type TogetherSaveAgreementInput = z.infer<typeof TogetherSaveAgreementInputSchema>;

/** The report + its resolved agreements + derived staleness — the Together wrap-up/memory view (§3.8/§3.9). */
export interface TogetherReportView {
  report: SharedReport | null;
  stale: boolean;
  agreements: Agreement[];
}
