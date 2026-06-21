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
  // `readRaw` (raw-answer access for a `senderSeesAll` compatibility send, §8.4/§13.5d) is an
  // EXPLICIT_GRANT_ONLY capability: it ships OFF for non-owner roles and is granted only by an explicit
  // toggle in the Roles matrix. The Owner (full-access) always has it.
  'questionnaires.readRaw',
  // Dreams (12-dreams §12). `dreams.own` = capture + analyze + view one's own dreams; `dreams.shareContext`
  // = promote a specific dream-insight fact into a related person's context (off by default per dream).
  // There is intentionally no "view others' dreams" capability — dreams are dreamer-only (12 §8.4).
  'dreams.own',
  'dreams.shareContext',
  // Generate an AI image of one's own dream (13-dream-images §6). Default ON for Member, like `dreams.own`.
  'dreams.generateImage',
  // Personal onboarding (18-personal-onboarding §5). `intake.own` = run one's own getting-to-know-you
  // intake (Member default ON). `intake.readRestricted` is EXPLICIT_GRANT_ONLY (below): it lets a holder
  // view a person's restricted intake facts ("what weighs on you" / intimacy) — ships OFF for non-owner
  // roles; the Owner (full-access) always has it.
  'intake.own',
  'intake.readRestricted',
  // Memory (20-memory-dashboard §4.2). `memory.own` = view + edit + flag + refresh one's OWN memory
  // dashboard (own insights + relationships' shareable facts). Member default ON. The Memory surface no
  // longer borrows `questionnaires.viewResults` (which now only gates the questionnaire Results surface).
  'memory.own',
  // Devices & key rotation (32-device-management §4.2) — list/rename/revoke devices + rotate the master
  // key. Owner-only (not in any non-owner default); the Owner has it via the full-access bypass.
  'devices.manage',
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
  'memory.own': 'View & manage their own memory',
  'devices.manage': 'Manage devices & re-key the vault',
};

/**
 * Capabilities that are never default-on for NON-owner roles — a non-owner gets them only by an explicit
 * toggle in the Roles matrix (the break-glass reveals of the most sensitive data, 08-questionnaires §8.4 /
 * 18-personal-onboarding §8.4). The **Owner always has them** (full access). `roleAllows` checks the owner
 * bypass first, then requires an explicit `true` for these on any other role.
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

/** The Owner is the full-access role — every capability (the super-admin's powers fold into the Owner). */
const OWNER_DEFAULT_CAPABILITIES = CAPABILITIES;

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
      'memory.own',
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
 * Whether a role grants a capability. The **Owner has EVERY capability** — including ones added after the
 * role was persisted (a stale stored map) AND the break-glass `EXPLICIT_GRANT_ONLY` ones: the Owner is the
 * full-access role (the concealed "super-admin" was removed 2026-06-15, folding its powers into the Owner).
 * For all other roles, a missing key means denied, and `EXPLICIT_GRANT_ONLY` capabilities require an
 * explicit `true` in the stored map (granted via the Roles matrix) — they're never default-on for non-owners.
 */
export function roleAllows(role: Role | undefined, capability: CapabilityKey): boolean {
  if (!role) return false;
  // The Owner is the full-access role — every capability, including the EXPLICIT_GRANT_ONLY ones. This
  // check MUST precede the EXPLICIT_GRANT_ONLY gate below. For every other role a capability is granted
  // only by an explicit `true` in the stored map (so EXPLICIT_GRANT_ONLY caps need a Roles-matrix toggle).
  if (role.id === OWNER_ROLE_ID) return true;
  return role.capabilities[capability] === true;
}

/**
 * Reconcile a built-in role's stored capability map against the current code defaults — adding any
 * capability key the stored map is MISSING (a capability introduced after the vault was created), using the
 * default value. Preserves keys the owner has explicitly set (those already exist in the map), so a
 * deliberate toggle-off is never re-enabled. This is why an existing Member picks up a newly-added default
 * like `intake.own` without a destructive migration. Custom (non-built-in) roles are returned unchanged.
 */
export function reconcileRole(role: Role): Role {
  if (!role.builtin) return role;
  const def = DEFAULT_ROLES.find((d) => d.id === role.id);
  if (!def) return role;
  const capabilities = { ...role.capabilities };
  let changed = false;
  for (const [capability, value] of Object.entries(def.capabilities)) {
    if (!(capability in capabilities)) {
      capabilities[capability] = value;
      changed = true;
    }
  }
  return changed ? { ...role, capabilities } : role;
}
