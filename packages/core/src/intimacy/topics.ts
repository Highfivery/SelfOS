/**
 * The shared consensual-adult **intimacy topic inventory** (08-questionnaires §16.5a) — ONE source of
 * truth imported by BOTH the personal-intake intimacy block ([`18`](18-personal-onboarding.md)) and
 * questionnaire generation ([`08`](08-questionnaires.md) §16.5). Keeping it in one place removes the drift
 * between the two lists.
 *
 * The built-in lists are **owner-extensible**: the Owner can add custom activities + fantasies (stored
 * vault-side in `config/questionnaires.json`), and `mergedIntimacyTopics` combines the built-ins with those
 * custom additions. The merged inventory feeds both surfaces.
 *
 * **Boundary (enforced in the prompts + by the model, never a keyword filter):** consensual-adult sexuality
 * only. Taboo content appears strictly as **fantasy/roleplay** between consenting adults (e.g. CNC framed as
 * pre-agreed roleplay). Nothing here is about minors, real non-consent, or illegal acts.
 */

/** Built-in consensual-adult **activities** (acts/preferences). `'Other'` is a UI escape, added by the form, not a topic. */
export const INTIMACY_ACTIVITIES: readonly string[] = [
  'Oral (giving)',
  'Oral (receiving)',
  'Deepthroat',
  'Anal (giving)',
  'Anal (receiving)',
  'Rimming (giving)',
  'Rimming (receiving)',
  'Fingering',
  'Butt plugs / anal toys',
  'Vibrators / dildos',
  'Bondage',
  'Blindfolds',
  'Spanking (giving)',
  'Spanking (receiving)',
  'Choking (giving)',
  'Choking (receiving)',
  'Hair-pulling',
  'Biting',
  'BDSM / dom-sub play',
  'Role-play',
  'Dirty talk',
  'Sexting',
  'Face-sitting',
  'Squirting',
  'Threesomes',
  'Group sex / orgies',
  'Swinging',
  'Public / semi-public sex',
  'Exhibitionism',
  'Voyeurism',
];

/** Built-in consensual-adult **fantasies/roleplay** themes. Taboo themes are fantasy/roleplay only. */
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

/** The built-in inventory grouped (the shape both surfaces consume). */
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
