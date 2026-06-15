import type { Role } from './schemas';

/**
 * Capabilities are the unit of permission (04-people-roles §4.3). Features register capabilities;
 * roles are bundles of them; the active person's role gates the UI. This list is the v1 set; new
 * features append to it and the role×capability matrix grows automatically.
 */
export const CAPABILITIES = [
  'people.manage',
  'people.viewOthers',
  'relationships.manage',
  'settings.manage',
  'users.manage',
  'roles.manage',
  'budgets.manage',
  'sessions.own',
  // Questionnaires (08-questionnaires §3/§12).
  'questionnaires.create',
  'questionnaires.answer',
  'questionnaires.viewResults',
  'questionnaires.sendExternal',
  // `readRaw` (break-glass raw-answer access for a `senderSeesAll` compatibility send, §8.4/§13.5d) is an
  // EXPLICIT_GRANT_ONLY capability: it ships OFF even for the Owner and is granted only by an explicit
  // toggle in the Roles matrix. The concealed super-admin break-glass reveal works independently of it.
  'questionnaires.readRaw',
  // Dreams (12-dreams §12). `dreams.own` = capture + analyze + view one's own dreams; `dreams.shareContext`
  // = promote a specific dream-insight fact into a related person's context (off by default per dream).
  // There is intentionally no "view others' dreams" capability — dreams are dreamer-only (12 §8.4).
  'dreams.own',
  'dreams.shareContext',
  // Generate an AI image of one's own dream (13-dream-images §6). Default ON for Member, like `dreams.own`.
  'dreams.generateImage',
  // Personal onboarding (18-personal-onboarding §5). `intake.own` = run one's own getting-to-know-you
  // intake (Member default ON). `intake.readRestricted` is EXPLICIT_GRANT_ONLY (below): the audited
  // break-glass that lets an owner view a person's restricted intake facts ("what weighs on you" /
  // intimacy) — ships OFF even for the Owner; the concealed super-admin reveal works independently.
  'intake.own',
  'intake.readRestricted',
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number];

/** Human-readable labels for the role × capability matrix editor. */
export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  'people.manage': 'Manage people',
  'people.viewOthers': "View others' profiles",
  'relationships.manage': 'Manage relationships',
  'settings.manage': 'Manage settings',
  'users.manage': 'Manage logins',
  'roles.manage': 'Manage roles',
  'budgets.manage': 'Manage budgets & view cost',
  'sessions.own': 'Have their own sessions',
  'questionnaires.create': 'Create & send questionnaires',
  'questionnaires.answer': 'Answer questionnaires',
  'questionnaires.viewResults': 'View questionnaire results',
  'questionnaires.sendExternal': 'Send questionnaires to external people',
  'questionnaires.readRaw': 'Reveal raw private answers (break-glass)',
  'dreams.own': 'Log & analyze their own dreams',
  'dreams.shareContext': 'Share a dream insight into a relationship',
  'dreams.generateImage': 'Generate an AI image of their own dream',
  'intake.own': 'Do their own getting-to-know-you onboarding',
  'intake.readRestricted': 'Reveal restricted intake content (break-glass)',
};

/**
 * Capabilities that ship OFF even for the Owner and never auto-grant — they're enabled only by an
 * explicit toggle in the Roles matrix (08-questionnaires §8.4). `roleAllows` special-cases these so the
 * Owner's automatic full-access bypass skips them, and the Roles editor leaves the Owner column toggleable
 * for exactly these. Today only the break-glass `questionnaires.readRaw` is here.
 */
export const EXPLICIT_GRANT_ONLY: ReadonlySet<CapabilityKey> = new Set<CapabilityKey>([
  'questionnaires.readRaw',
  'intake.readRestricted',
]);

function capabilityMap(enabled: readonly CapabilityKey[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const capability of CAPABILITIES) map[capability] = enabled.includes(capability);
  return map;
}

/** Every capability except the explicit-grant-only ones — the Owner's default (so `readRaw` ships OFF). */
const OWNER_DEFAULT_CAPABILITIES = CAPABILITIES.filter((c) => !EXPLICIT_GRANT_ONLY.has(c));

/**
 * Built-in roles (04-people-roles §12): Owner = everything; Member = own data + own relationships +
 * their own sessions; Guest = no capabilities yet (a login slot with nothing enabled until a Guest
 * purpose is specced). The matrix is Owner-editable; "own vs all" scoping is enforced in the
 * service/UI layer in a later slice.
 */
export const DEFAULT_ROLES: Role[] = [
  {
    id: 'owner',
    name: 'Owner',
    builtin: true,
    capabilities: capabilityMap(OWNER_DEFAULT_CAPABILITIES),
  },
  {
    id: 'member',
    name: 'Member',
    builtin: true,
    capabilities: capabilityMap([
      'relationships.manage',
      'sessions.own',
      'questionnaires.create',
      'questionnaires.answer',
      'questionnaires.viewResults',
      'questionnaires.sendExternal',
      'dreams.own',
      'dreams.shareContext',
      'dreams.generateImage',
      'intake.own',
    ]),
  },
  {
    id: 'guest',
    name: 'Guest',
    builtin: true,
    capabilities: capabilityMap([]),
  },
];

export const OWNER_ROLE_ID = 'owner';

/**
 * Whether a role grants a capability. The **Owner always has every capability** — including ones
 * added after the role was persisted (a stored owner map can be stale, e.g. a vault created before
 * `budgets.manage` existed) — **except** the explicit-grant-only ones (e.g. break-glass `readRaw`), which
 * the Owner gets only when the stored map turns them on. For all other roles, a missing key means denied.
 */
export function roleAllows(role: Role | undefined, capability: CapabilityKey): boolean {
  if (!role) return false;
  if (EXPLICIT_GRANT_ONLY.has(capability)) return role.capabilities[capability] === true;
  if (role.id === OWNER_ROLE_ID) return true;
  return role.capabilities[capability] === true;
}
