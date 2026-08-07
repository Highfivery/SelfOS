import type { FileSystem } from '../host';
import { feedableInsights, listInsightsForPerson } from '../insights';
import { getPerson } from '../people/peopleService';
import { scopeGrants } from '../people/relationshipScope';
import { listRelationships } from '../people/relationshipService';

/**
 * Partner-shared context for a person's OWN questionnaire (spec 69 §5.4) — the facts people close to them have
 * shared TO them (the SAME facts their coach already sees), so a self / auto check-in can personalize from, and
 * RECIPROCATE, a partner's stated desire or need ("your partner mentioned X — how do you feel about it?").
 *
 * Privacy: it uses the ONE sharing gate `scopeGrants(fact, subject=partner, viewer=this person, live graph)`,
 * which folds in the restricted / flagged / not-shared exclusions — so a RESTRICTED fact NEVER crosses. This is
 * only ever gathered for a SELF-send (author == recipient), and every fact it surfaces already reaches this
 * person's own coaching context, so nothing new is exposed to anyone.
 */

/** A partner's shared fact in one of these areas is a reciprocity candidate (a desire/need to reflect back). */
const RECIPROCITY_LIFE_AREAS = new Set(['Intimacy', 'Relationships']);
/** Bound each partner's contribution so the prompt stays economical. */
const MAX_PARTNER_FACTS = 30;

export interface PartnerReciprocity {
  fromPartnerId: string;
  note: string;
}

export interface PartnerContext {
  /** The prompt block — `''` when nothing crosses. */
  contextBlock: string;
  /** Desire/need facts a partner shared, to reflect back tactfully. */
  reciprocity: PartnerReciprocity[];
}

export async function gatherRecipientPartnerContext(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<PartnerContext> {
  const rels = await listRelationships(fs, key);
  const relatedIds = new Set<string>();
  for (const e of rels) {
    if (e.fromPersonId === personId) relatedIds.add(e.toPersonId);
    else if (e.toPersonId === personId) relatedIds.add(e.fromPersonId);
  }

  const lines: string[] = [];
  const reciprocity: PartnerReciprocity[] = [];
  for (const otherId of relatedIds) {
    const person = await getPerson(fs, key, otherId);
    if (!person) continue;
    const approved = (await listInsightsForPerson(fs, key, otherId)).filter((i) => i.approved);
    const feedable = await feedableInsights(fs, key, approved);
    const shared = feedable
      .flatMap((i) => i.facts)
      // The gate: restricted / flagged / not-shared-to-this-person facts are excluded here.
      .filter((fact) => scopeGrants(fact, otherId, personId, rels))
      .slice(0, MAX_PARTNER_FACTS);
    for (const fact of shared) {
      lines.push(`- ${fact.text} — shared by ${person.displayName}`);
      if (fact.lifeArea && RECIPROCITY_LIFE_AREAS.has(fact.lifeArea)) {
        reciprocity.push({ fromPartnerId: otherId, note: fact.text });
      }
    }
  }

  if (lines.length === 0) return { contextBlock: '', reciprocity };
  const recipNote = reciprocity.length
    ? `\nWhere a partner has shared a desire, preference, or need, you MAY ask how THIS person feels about it —` +
      ` whether they'd want it too, their own take, what it brings up — tactfully, on its own terms, and NEVER` +
      ` quoting the partner word-for-word.`
    : '';
  const contextBlock =
    `WHAT PEOPLE CLOSE TO THEM HAVE SHARED (this is already part of their own coaching context — use it to` +
    ` personalize and to explore how THEY feel; do NOT quote it back verbatim):\n${lines.join('\n')}${recipNote}`;
  return { contextBlock, reciprocity };
}
