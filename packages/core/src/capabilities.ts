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
  // Questionnaires (08-questionnaires §3/§12). `readRaw` (break-glass raw-answer access) is intentionally
  // NOT registered here: it ships off even for the Owner and is reached only via the concealed super-admin
  // unlock, so it lands with the private-mode/break-glass slice, not as a normal owner-granted capability.
  'questionnaires.create',
  'questionnaires.answer',
  'questionnaires.viewResults',
  'questionnaires.sendExternal',
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
};

function capabilityMap(enabled: readonly CapabilityKey[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const capability of CAPABILITIES) map[capability] = enabled.includes(capability);
  return map;
}

/**
 * Built-in roles (04-people-roles §12): Owner = everything; Member = own data + own relationships +
 * their own sessions; Guest = no capabilities yet (a login slot with nothing enabled until a Guest
 * purpose is specced). The matrix is Owner-editable; "own vs all" scoping is enforced in the
 * service/UI layer in a later slice.
 */
export const DEFAULT_ROLES: Role[] = [
  { id: 'owner', name: 'Owner', builtin: true, capabilities: capabilityMap(CAPABILITIES) },
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
 * `budgets.manage` existed). For all other roles, a missing key means denied.
 */
export function roleAllows(role: Role | undefined, capability: CapabilityKey): boolean {
  if (!role) return false;
  if (role.id === OWNER_ROLE_ID) return true;
  return role.capabilities[capability] === true;
}
