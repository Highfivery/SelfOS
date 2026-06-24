import type { FileSystem } from '../host';
import { listInsightsForPerson } from '../insights';
import {
  IntakeSessionSchema,
  type OutboundSharing,
  type OutboundSharingItem,
  type Relationship,
  type RelationshipType,
} from '../schemas';
import { readEncryptedJson } from '../vault';
import { listRelatedPeople } from './buildContext';
import { relationshipTypesFromSubjectToViewer } from './relationshipScope';
import { formatSharedAnswer, getIntakeQuestion } from './sharedIntakeAnswers';
// Pure (catalog + presets), imported by its direct path to avoid the people↔intake barrel cycle.
import { effectiveAnswerScope } from '../intake/sharingCategory';

/**
 * The transparency read (42-relationship-scoped-sharing §5.3): exactly which of a person's OWN shareable
 * items flow to which relationship types and which concrete people, resolved against the live graph. Powers
 * the "what you share & with whom" surfaces in 43/44. Own-scoped — the bridge gates it on `memory.own` and
 * the active person, so a person only ever sees their **own** outbound sharing (never another's).
 *
 * `relationships` is passed in (resolved by the caller) so this stays a thin assembler.
 */
export async function listOutboundSharing(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  relationships: Relationship[],
): Promise<OutboundSharing> {
  // The concrete related people + the type(s) describing how the subject relates to each (subject→viewer).
  const relatedPeople = await listRelatedPeople(fs, key, personId);
  const grantsByPerson = new Map<string, RelationshipType[]>(
    relatedPeople.map((person) => [
      person.id,
      relationshipTypesFromSubjectToViewer(personId, person.id, relationships),
    ]),
  );

  /** The concrete related people a scope reaches (broadcast ⇒ everyone; else type/person-id matches). */
  const recipientsFor = (
    broadcast: boolean,
    types: RelationshipType[],
    personIds: string[],
  ): { id: string; displayName: string }[] =>
    relatedPeople.filter((person) => {
      if (broadcast) return true;
      if (personIds.includes(person.id)) return true;
      const granted = grantsByPerson.get(person.id) ?? [];
      return types.some((type) => granted.includes(type));
    });

  const items: OutboundSharingItem[] = [];

  // 1) Insight facts the person shares (broadcast / per-person / type-scoped). A `restricted` or
  //    flagged-inaccurate fact reaches no one (the gate excludes it), so it's not "outbound" — skip it.
  for (const insight of await listInsightsForPerson(fs, key, personId)) {
    for (const fact of insight.facts) {
      if (fact.restricted === true || fact.flaggedInaccurate === true) continue;
      const broadcast = fact.shareable === true;
      const types = fact.shareableTypes ?? [];
      const personIds = fact.shareableWith ?? [];
      if (!broadcast && types.length === 0 && personIds.length === 0) continue; // private — not outbound
      items.push({
        id: fact.id,
        kind: 'fact',
        text: fact.text,
        broadcast,
        types,
        personIds,
        recipients: recipientsFor(broadcast, types, personIds),
      });
    }
  }

  // 2) Shared structured intake answers (their per-question `answerSharing` scope, written by 43). Iterate
  //    ANSWERED questions and resolve each via `effectiveAnswerScope` (the share-by-default backfill), so a
  //    portrait from before per-question sharing still surfaces its shared answers; restricted answers default
  //    Private and drop out below. An explicit choice (incl. an explicit []) is honored.
  const raw = await readEncryptedJson(fs, `people/${personId}/intake/session.enc`, key);
  const parsed = raw === null ? null : IntakeSessionSchema.safeParse(raw);
  if (parsed?.success) {
    for (const section of parsed.data.sections) {
      for (const questionId of Object.keys(section.answers)) {
        const types = effectiveAnswerScope(section.id, questionId, section.answerSharing);
        if (types.length === 0) continue; // Private — not outbound
        const value = section.answers[questionId];
        if (value === undefined) continue;
        const question = getIntakeQuestion(questionId);
        const answerText = question ? formatSharedAnswer(question, value) : '';
        if (answerText.trim() === '') continue;
        items.push({
          id: `${section.id}.${questionId}`,
          kind: 'intakeAnswer',
          text: `${question?.prompt ?? questionId}: ${answerText}`,
          broadcast: false,
          types,
          personIds: [],
          recipients: recipientsFor(false, types, []),
        });
      }
    }
  }

  return { items };
}
