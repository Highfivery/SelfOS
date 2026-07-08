import type { InsightFact } from '@shared/schemas';

/** One fact prepared for display — the code-generated prefix stripped for its section. */
export interface WrapUpFact {
  id: string;
  text: string;
}

/** Session-summary facts grouped by their code prefix (09) for a scannable card. `other` keeps any
 *  unrecognized fact (e.g. a guided session's `Exercise:` note) with its full text, so nothing is dropped. */
export interface WrapUpGroups {
  goals: WrapUpFact[];
  themes: WrapUpFact[];
  followUps: WrapUpFact[];
  people: WrapUpFact[];
  other: WrapUpFact[];
}

// The prefixes `sessionAnalysisService` stamps onto each fact (`${prefix}: ${text}`). Order is display-agnostic
// — the card decides section order; this only routes each fact to its group.
const SECTION_PREFIXES: { key: Exclude<keyof WrapUpGroups, 'other'>; prefix: string }[] = [
  { key: 'goals', prefix: 'Goal' },
  { key: 'themes', prefix: 'Theme' },
  { key: 'followUps', prefix: 'Follow-up' },
  { key: 'people', prefix: 'Person mentioned' },
];

/**
 * Group a session Insight's facts into the wrap-up card's sections by their code-stamped prefix, stripping the
 * prefix from the display text. A fact whose prefix isn't recognized falls into `other` with its full text
 * intact — so a schema/prefix change never silently swallows a fact. Pure; the stored facts are never mutated.
 */
export function groupWrapUpFacts(facts: readonly InsightFact[]): WrapUpGroups {
  const groups: WrapUpGroups = { goals: [], themes: [], followUps: [], people: [], other: [] };
  for (const fact of facts) {
    const match = SECTION_PREFIXES.find((p) => fact.text.startsWith(`${p.prefix}: `));
    if (match) {
      groups[match.key].push({ id: fact.id, text: fact.text.slice(match.prefix.length + 2) });
    } else {
      groups.other.push({ id: fact.id, text: fact.text });
    }
  }
  return groups;
}
