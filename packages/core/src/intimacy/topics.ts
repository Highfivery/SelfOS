/**
 * The shared consensual-adult **intimacy topic inventory** (08-questionnaires §16.5a) — ONE source of
 * truth imported by BOTH the personal-intake intimacy block ([`18`](18-personal-onboarding.md)) and
 * questionnaire generation ([`08`](08-questionnaires.md) §16.5). Keeping it in one place removes the drift
 * between the two lists.
 *
 * **Categorized + tiered (49-intimacy-activities-inventory).** `INTIMACY_ACTIVITIES_FULL` is the source of
 * truth — a list of `IntimacyActivity` entries, each carrying a stable `key` (the 46 §4.2 anatomy-independent
 * matrix-row key), a display `label`, a `category` (one of ~14 families — the onboarding matrix's group
 * header AND the kink test's subscale, [`50`](50-self-assessments.md)), and an intensity `tier` (1 gentle →
 * 5 extreme, orders rows sensual→extreme). `INTIMACY_ACTIVITIES` stays the **flat label list** (derived from
 * the inventory) so questionnaire generation + `mergedIntimacyTopics` are unaffected (the category metadata
 * is exposed via the new symbols only, never through `INTIMACY_TOPICS.activities`).
 *
 * The built-in lists are **owner-extensible**: the Owner can add custom activities + fantasies (stored
 * vault-side in `config/questionnaires.json`), and `mergedIntimacyTopics` combines the built-ins with those
 * custom additions. The merged inventory feeds both surfaces. Custom additions are uncategorized — the
 * readers place them in an "Other / custom" group (49 §7).
 *
 * **The inventory is render/synthesis-layer code, never per-person vault data, never mutated per-person**
 * (46 §5). All ratings live in the encrypted `IntakeSession`; this constant is the single shared source.
 *
 * **Boundary (enforced in the prompts + by the model, never a keyword filter):** consensual-adult sexuality
 * only. Taboo content appears strictly as **fantasy/roleplay** between consenting adults (e.g. CNC framed as
 * pre-agreed roleplay). Nothing here is about minors, real non-consent, or illegal acts.
 */

/** The ~14 consensual-adult activity families, ordered by **ascending baseline intensity** so the onboarding
 * matrix groups read sensual→extreme + the kink test's subscales ([`50`](50-self-assessments.md)) order the
 * same way. */
export const INTIMACY_CATEGORIES = [
  'sensual', // Sensual & sensory
  'oral', // Oral
  'manual-toys', // Manual & toys
  'penetration', // Penetration
  'anal', // Anal
  'roleplay', // Roleplay & fantasy
  'dirty-talk', // Dirty talk & verbal
  'power-exchange', // Power exchange / D-s
  'bondage', // Bondage & restraint
  'impact', // Impact & sensation
  'exhibition', // Exhibitionism & voyeurism
  'group', // Group & swinging
  'edge', // Edge play
  'taboo-fantasy', // Taboo *fantasy* (CNC etc., as fantasy/roleplay only)
] as const;
export type IntimacyCategory = (typeof INTIMACY_CATEGORIES)[number];

/** Human label per category — the matrix group header / the kink-test subscale name. */
export const INTIMACY_CATEGORY_LABELS: Readonly<Record<IntimacyCategory, string>> = {
  sensual: 'Sensual & sensory',
  oral: 'Oral',
  'manual-toys': 'Manual & toys',
  penetration: 'Penetration',
  anal: 'Anal',
  roleplay: 'Roleplay & fantasy',
  'dirty-talk': 'Dirty talk & verbal',
  'power-exchange': 'Power exchange / D-s',
  bondage: 'Bondage & restraint',
  impact: 'Impact & sensation',
  exhibition: 'Exhibitionism & voyeurism',
  group: 'Group & swinging',
  edge: 'Edge play',
  'taboo-fantasy': 'Taboo fantasy',
};

/** The fallback group label for an owner-custom (uncategorized) activity (49 §7). */
export const INTIMACY_OTHER_CATEGORY_LABEL = 'Other / custom';

/** A consensual-adult intimacy activity, categorized + tiered (49). */
export interface IntimacyActivity {
  /** Stable, anatomy-independent matrix-row key (46 §4.2). Never changes when the label re-resolves. */
  key: string;
  /** Display label — the matrix row label, the kink-test item, the generation seed. */
  label: string;
  /** Which family this belongs to — the kink test's subscale + the matrix's group header (49 §4.1). */
  category: IntimacyCategory;
  /** Baseline intensity tier, gentle (1) → extreme (5). Orders rows sensual→extreme + within a category.
   * The inventory's baseline intensity — INDEPENDENT of a given person's 1–5 rating of the row. */
  tier: 1 | 2 | 3 | 4 | 5;
}

/** Deterministic, stable slug for an activity label → its anatomy-independent row key. Mirrors
 * `slugifyActivity` in `activityRows.ts` (kept in sync; the two oral rows use explicit keys there). */
function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Build an entry, defaulting the key to the label slug (oral entries pass an explicit stable key). */
function a(
  label: string,
  category: IntimacyCategory,
  tier: IntimacyActivity['tier'],
  key?: string,
): IntimacyActivity {
  return { key: key ?? slug(label), label, category, tier };
}

// The two anatomy-resolved oral rows keep the 46 §4.2 stable keys; the resolver in activityRows.ts expands
// 'oral-giving' into oral-giving-penis/-vulva per partner anatomy and relabels 'oral-receiving' by own anatomy.
const KEY_ORAL_RECEIVING = 'oral-receiving';
const KEY_ORAL_GIVING = 'oral-giving';

/**
 * The full categorized, tiered inventory — the source of truth (49 §4.1). ~94 consensual-adult acts across
 * the 14 categories, sensual→extreme. The two relationship dynamics (Degradation/humiliation, Praise/worship,
 * 27 §4.3) are folded in as `power-exchange` entries with their existing slugs preserved as stable keys (49
 * §11, no-loss carry-forward). The `edge`/`taboo-fantasy` entries are worded plainly as activities a person
 * can rate (never as instructions); `taboo-fantasy` items are strictly fantasy/roleplay (§8).
 */
export const INTIMACY_ACTIVITIES_FULL: readonly IntimacyActivity[] = [
  // Sensual & sensory (t1–2).
  a('Sensual massage', 'sensual', 1),
  a('Making out / extended kissing', 'sensual', 1),
  a('Body worship', 'sensual', 2),
  a('Feather / soft-touch teasing', 'sensual', 1),
  a('Temperature play (ice / warm)', 'sensual', 2),
  a('Blindfolds', 'sensual', 2),
  a('Mutual masturbation', 'sensual', 2),
  a('Watch partner masturbate', 'sensual', 2),
  // Oral (t2–3). Receiving + giving are anatomy-resolved (46); the rest are universal.
  a('Receiving oral', 'oral', 2, KEY_ORAL_RECEIVING),
  a('Giving oral', 'oral', 2, KEY_ORAL_GIVING),
  a('Deepthroat', 'oral', 3),
  a('69', 'oral', 2),
  a('Face-sitting', 'oral', 3),
  a('Rimming (giving)', 'oral', 3),
  a('Rimming (receiving)', 'oral', 3),
  // Manual & toys (t1–3).
  a('Fingering', 'manual-toys', 1),
  a('Hand jobs / manual stimulation', 'manual-toys', 1),
  a('Vibrators', 'manual-toys', 1),
  a('Dildos', 'manual-toys', 2),
  a('Wand / clitoral toys', 'manual-toys', 2),
  a('Strap-on play', 'manual-toys', 3),
  a('Anal toys / butt plugs', 'manual-toys', 3),
  a('Cock rings', 'manual-toys', 2),
  a('Thrusting machine', 'manual-toys', 3),
  // Penetration (t2–3).
  a('Vaginal sex', 'penetration', 2),
  a('Different positions / variety', 'penetration', 2),
  a('Slow & sensual', 'penetration', 2),
  a('Teasing penetration', 'penetration', 2),
  a('Rough / hard', 'penetration', 3),
  a('Quickies', 'penetration', 2),
  // Anal (t2–4).
  a('Anal (receiving)', 'anal', 3),
  a('Anal (giving)', 'anal', 3),
  a('Anal fingering', 'anal', 2),
  a('Pegging', 'anal', 3),
  a('Double penetration', 'anal', 4),
  // Roleplay & fantasy (t2–4).
  a('General role-play', 'roleplay', 2),
  a('Costumes / dress-up', 'roleplay', 2),
  a('Stranger / one-night roleplay', 'roleplay', 3),
  a('Boss / employee', 'roleplay', 3),
  a('Teacher / student', 'roleplay', 3),
  a('Doctor / patient', 'roleplay', 3),
  a('Captor / captive (fantasy)', 'roleplay', 4),
  a('Wearing lingerie', 'roleplay', 2),
  a('Partner wearing lingerie', 'roleplay', 2),
  // Dirty talk & verbal (t1–3).
  a('Light dirty talk', 'dirty-talk', 1),
  a('Explicit dirty talk', 'dirty-talk', 2),
  a('Sexting', 'dirty-talk', 2),
  a('Phone / voice sex', 'dirty-talk', 2),
  a('Begging', 'dirty-talk', 3),
  a('Verbal commands', 'dirty-talk', 3),
  // Power exchange / D-s (t2–4). Degradation/humiliation + Praise/worship folded in (49 §11), slugs preserved.
  a('Being dominant', 'power-exchange', 3),
  a('Being submissive', 'power-exchange', 3),
  a('Switching', 'power-exchange', 3),
  a('Following commands', 'power-exchange', 2),
  a('Giving commands', 'power-exchange', 2),
  a('Degradation / humiliation', 'power-exchange', 4),
  a('Praise / worship', 'power-exchange', 2),
  a('Service / obedience', 'power-exchange', 3),
  a('Collaring', 'power-exchange', 4),
  a('Brat play', 'power-exchange', 3),
  // Bondage & restraint (t2–4).
  a('Light bondage (cuffs / ties)', 'bondage', 2),
  a('Rope bondage / shibari', 'bondage', 3),
  a('Restraint to the bed / furniture', 'bondage', 2),
  a('Gags', 'bondage', 3),
  a('Predicament bondage', 'bondage', 4),
  a('Suspension', 'bondage', 4),
  // Impact & sensation (t2–5).
  a('Spanking (giving)', 'impact', 2),
  a('Spanking (receiving)', 'impact', 2),
  a('Hair-pulling', 'impact', 2),
  a('Biting', 'impact', 2),
  a('Flogging', 'impact', 3),
  a('Paddling', 'impact', 3),
  a('Caning', 'impact', 4),
  a('Wax play', 'impact', 3),
  a('Nipple clamps', 'impact', 3),
  a('Pinching / scratching', 'impact', 2),
  a('Pussy patting/slapping', 'impact', 2),
  // Exhibitionism & voyeurism (t2–4).
  a('Exhibitionism', 'exhibition', 3),
  a('Voyeurism', 'exhibition', 3),
  a('Being watched', 'exhibition', 2),
  a('Watching a partner', 'exhibition', 2),
  a('Public / semi-public sex', 'exhibition', 3),
  a('Sharing photos / videos (with a partner)', 'exhibition', 3),
  a('Camming', 'exhibition', 3),
  // Group & swinging (t3–4).
  a('Threesomes', 'group', 3),
  a('Group sex / orgies', 'group', 4),
  a('Swinging', 'group', 4),
  a('Cuckolding / hotwifing', 'group', 4),
  // Edge play (t4–5). Worded plainly as activities to rate, never as instructions (§8).
  a('Breath play / choking (giving)', 'edge', 4),
  a('Breath play / choking (receiving)', 'edge', 4),
  a('Knife / needle play', 'edge', 5),
  a('Electro play', 'edge', 4),
  a('Fisting', 'edge', 4),
  a('Heavy impact', 'edge', 5),
  // Taboo fantasy (t4–5) — fantasy/roleplay ONLY; no minors / real non-consent / illegal acts (§8).
  a('Consensual non-consent (CNC) / ravishment roleplay', 'taboo-fantasy', 5),
  a('Primal play', 'taboo-fantasy', 4),
  a('Age-gap roleplay (adults)', 'taboo-fantasy', 4),
  a('Pet play', 'taboo-fantasy', 4),
  a('"Forced" roleplay (pre-agreed)', 'taboo-fantasy', 5),
];

/** Map of stable key → category, for grouping resolved matrix rows + the kink test's subscales (49 §5). */
const KEY_TO_CATEGORY: ReadonlyMap<string, IntimacyCategory> = new Map(
  INTIMACY_ACTIVITIES_FULL.map((entry) => [entry.key, entry.category]),
);

/** The category a stable matrix-row key belongs to, or `undefined` for an owner-custom/unknown key (→ Other).
 * The anatomy-resolved oral keys (`oral-giving-penis`/`-vulva`/the neutral `oral-giving`/`oral-receiving`)
 * all resolve to `oral` so a relabelled oral row groups correctly (46 §5). */
export function categoryForKey(key: string): IntimacyCategory | undefined {
  const direct = KEY_TO_CATEGORY.get(key);
  if (direct) return direct;
  if (key.startsWith('oral-')) return 'oral';
  return undefined;
}

/** Flat list of activity **labels** — the legacy `string[]` shape questionnaire generation seeds from. */
export const INTIMACY_ACTIVITY_LABELS: readonly string[] = INTIMACY_ACTIVITIES_FULL.map(
  (x) => x.label,
);

/**
 * Built-in consensual-adult **activities** as a flat label list — the shape questionnaire generation reads
 * (08 §16.5). Derived from {@link INTIMACY_ACTIVITIES_FULL}; the category/tier metadata is exposed via the
 * new symbols, NOT here (49 §4.2). `'Other'` is a UI escape, added by the form, not a topic.
 */
export const INTIMACY_ACTIVITIES: readonly string[] = INTIMACY_ACTIVITY_LABELS;

/** The inventory grouped by category, in {@link INTIMACY_CATEGORIES} order; within a category, tier ascending
 * (stable — equal tiers keep inventory order). The kink test ([`50`](50-self-assessments.md)) consumes this
 * for subscales. */
export function intimacyActivitiesByCategory(): ReadonlyMap<IntimacyCategory, IntimacyActivity[]> {
  const out = new Map<IntimacyCategory, IntimacyActivity[]>();
  for (const category of INTIMACY_CATEGORIES) out.set(category, []);
  for (const entry of INTIMACY_ACTIVITIES_FULL) out.get(entry.category)?.push(entry);
  // Sort each group by tier (stable: Array.sort preserves order for equal tiers → inventory order within a tier).
  for (const entries of out.values()) entries.sort((x, y) => x.tier - y.tier);
  return out;
}

/** The inventory flattened in **display order**: category order, then tier within a category (sensual→extreme).
 * The single ordering the onboarding matrix rows + the grouped headers derive from (49 §3.1/§5). */
export function orderedActivities(): IntimacyActivity[] {
  const byCategory = intimacyActivitiesByCategory();
  const out: IntimacyActivity[] = [];
  for (const category of INTIMACY_CATEGORIES) out.push(...(byCategory.get(category) ?? []));
  return out;
}

/** Built-in consensual-adult **fantasies/roleplay** themes. Taboo themes are fantasy/roleplay only. (Stays a
 * flat list — 49 restructures only the activities inventory.) */
export const INTIMACY_FANTASIES: readonly string[] = [
  'Threesome / group',
  'Voyeurism',
  'Exhibitionism',
  'Domination',
  'Submission',
  'Consensual non-consent (CNC) roleplay',
  'Bondage',
  'Being watched',
  'Strangers / one-night roleplay',
  'Boss / employee roleplay',
  'Teacher / student roleplay',
  'Cheating roleplay',
  'Gangbang',
];

/** The built-in inventory grouped (the shape both surfaces consume). `activities` is the flat label list so
 * questionnaire generation is unaffected by the categorization (49 §3.2/§4.2). */
export const INTIMACY_TOPICS = {
  activities: INTIMACY_ACTIVITIES,
  fantasies: INTIMACY_FANTASIES,
} as const;

export interface IntimacyTopics {
  activities: string[];
  fantasies: string[];
}

/** Case-insensitive de-dupe that keeps the first spelling seen (built-ins win over custom dupes). */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (v.trim() === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

/**
 * The **merged** inventory = built-in topics + the Owner's custom additions (deduped, case-insensitive,
 * built-ins first). Custom additions are owner-managed free text; the consensual-adult boundary is enforced
 * by the prompt + the model, not by filtering here (the Owner is the full-access role).
 */
export function mergedIntimacyTopics(custom?: {
  activities?: string[];
  fantasies?: string[];
}): IntimacyTopics {
  return {
    activities: dedupe([...INTIMACY_ACTIVITIES, ...(custom?.activities ?? [])]),
    fantasies: dedupe([...INTIMACY_FANTASIES, ...(custom?.fantasies ?? [])]),
  };
}
