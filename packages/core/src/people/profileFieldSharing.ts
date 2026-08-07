import {
  isPersonFieldShared,
  PERSON_FIELD_KEYS,
  type LifeArea,
  type OutboundSharingItem,
  type Person,
  type PersonFieldKey,
} from '../schemas';

/**
 * Human labels for the controllable person fields (15-shareability §4.1), matching the People editor. Used to
 * render a `profileField` outbound item's text ("<label>: <value>") in the Sharing dashboard (68 §3.8/§4.1).
 */
export const PERSON_FIELD_LABELS: Record<PersonFieldKey, string> = {
  pronouns: 'Pronouns',
  birthday: 'Birthday',
  gender: 'Gender',
  appearanceDescription: 'Appearance',
  ethnicity: 'Ethnicity',
  occupation: 'Occupation',
  interests: 'Interests',
  location: 'Location',
  goals: 'Goals',
  communicationStyle: 'Communication style',
  values: 'Values',
  languages: 'Languages',
  importantDates: 'Important dates',
  notes: 'Notes',
  healthNotes: 'Health notes',
  faith: 'Faith',
  relationshipStatus: 'Relationship status',
  parentalStatus: 'Parental status',
  livingSituation: 'Living situation',
  sexualOrientation: 'Sexual orientation',
  relationshipStyle: 'Relationship style',
};

/**
 * The display life-area bucket a profile field groups under in the Sharing dashboard's By-category tab
 * (68 §3.5/§4.1) — so a shared `healthNotes` lands next to a health-area insight fact. Fields with no obvious
 * area fall through to "Other" (via `sharingItemCategory`). A display bucket, not the sharing MECHANIC.
 */
export const PROFILE_FIELD_LIFE_AREA: Partial<Record<PersonFieldKey, LifeArea>> = {
  occupation: 'Work & purpose',
  goals: 'Goals & growth',
  values: 'Values & beliefs',
  communicationStyle: 'Relationships',
  relationshipStatus: 'Relationships',
  relationshipStyle: 'Intimacy',
  sexualOrientation: 'Intimacy',
  parentalStatus: 'Family',
  livingSituation: 'Family',
  healthNotes: 'Health & body',
  faith: 'Faith',
};

/**
 * Format one controllable field's value for display; `undefined` when the field is empty (so an unpopulated
 * field never surfaces as a shared item). String fields → the trimmed string; list fields → comma-joined;
 * `importantDates` → "label (date), …". Pure + total.
 */
export function formatPersonFieldValue(person: Person, key: PersonFieldKey): string | undefined {
  if (key === 'importantDates') {
    const dates = person.importantDates ?? [];
    if (dates.length === 0) return undefined;
    return dates.map((entry) => `${entry.label} (${entry.date})`).join(', ');
  }
  if (key === 'interests' || key === 'values' || key === 'languages') {
    const list = person[key] ?? [];
    const cleaned = list.map((value) => value.trim()).filter((value) => value !== '');
    return cleaned.length === 0 ? undefined : cleaned.join(', ');
  }
  const value = person[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The active person's OWN profile fields that currently reach the people they relate to (68 §3.8) — each
 * populated, NON-locked controllable field is a `profileField` outbound item reaching ALL related people
 * (profile fields broadcast to all related, 15-shareability §2 — no relationship-type scoping). Pure: the
 * caller passes the resolved related people as recipients. Locked fields (`privateFields`) and empty fields
 * are omitted, so the dashboard drops a field the moment it's locked or cleared.
 */
export function profileSharingItems(
  person: Person,
  recipients: { id: string; displayName: string }[],
): OutboundSharingItem[] {
  const items: OutboundSharingItem[] = [];
  for (const key of PERSON_FIELD_KEYS) {
    if (!isPersonFieldShared(person, key)) continue; // locked → own-context only, not outbound
    const value = formatPersonFieldValue(person, key);
    if (value === undefined) continue; // empty → nothing to share
    const item: OutboundSharingItem = {
      id: `field:${key}`,
      kind: 'profileField',
      text: `${PERSON_FIELD_LABELS[key]}: ${value}`,
      broadcast: false, // not the legacy `shareable` broadcast — a per-field lock that reaches all related
      types: [],
      personIds: [],
      recipients,
    };
    const lifeArea = PROFILE_FIELD_LIFE_AREA[key];
    if (lifeArea) item.lifeArea = lifeArea;
    items.push(item);
  }
  return items;
}
