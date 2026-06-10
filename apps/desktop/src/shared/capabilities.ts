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
  'questionnaires.answer',
  'questionnaires.assign',
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
  'questionnaires.answer': 'Answer questionnaires',
  'questionnaires.assign': 'Assign questionnaires',
};

function capabilityMap(enabled: readonly CapabilityKey[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const capability of CAPABILITIES) map[capability] = enabled.includes(capability);
  return map;
}

/**
 * Built-in roles (04-people-roles §12): Owner = everything; Member = own data + own relationships +
 * answer questionnaires; Guest = answer assigned questionnaires only. The matrix is Owner-editable;
 * "own vs all" scoping is enforced in the service/UI layer in a later slice.
 */
export const DEFAULT_ROLES: Role[] = [
  { id: 'owner', name: 'Owner', builtin: true, capabilities: capabilityMap(CAPABILITIES) },
  {
    id: 'member',
    name: 'Member',
    builtin: true,
    capabilities: capabilityMap(['relationships.manage', 'sessions.own', 'questionnaires.answer']),
  },
  {
    id: 'guest',
    name: 'Guest',
    builtin: true,
    capabilities: capabilityMap(['questionnaires.answer']),
  },
];

export const OWNER_ROLE_ID = 'owner';

/** Whether a role grants a capability (missing key = denied). */
export function roleAllows(role: Role | undefined, capability: CapabilityKey): boolean {
  return role?.capabilities[capability] === true;
}
