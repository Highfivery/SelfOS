import { listDreams } from '../dreams/dreamService';
import type { FileSystem } from '../host';
import { getInsight, listInsightsForPerson, saveInsight } from '../insights';
// Pure (catalog + presets), imported by its direct path to avoid the people↔intake barrel cycle.
import { effectiveAnswerScope, questionCategory } from '../intake/sharingCategory';
import { setIntakeAnswerSharing } from '../intake/intakeService';
import {
  IntakeSessionSchema,
  LIFE_AREAS,
  type LifeArea,
  type OutboundSharing,
  type OutboundSharingItem,
  type Relationship,
  type RelationshipType,
} from '../schemas';
// `sharingItemCategory` lives in the crypto-free `../sharing` so the renderer can import it without pulling
// this host-only (crypto-heavy) module; re-exported here for the read + the 1a callers/tests.
import { sharingItemCategory } from '../sharing';
import { readEncryptedJson } from '../vault';
import { getPerson } from './peopleService';
import { listRelatedPeople } from './buildContext';
import { profileSharingItems } from './profileFieldSharing';
import { relationshipTypesFromSubjectToViewer } from './relationshipScope';
import { formatSharedAnswer, getIntakeQuestion } from './sharedIntakeAnswers';

export { sharingItemCategory };

/** Normalize an `InsightFact.lifeArea` (a free string) against the fixed taxonomy; undefined if not a member. */
function normalizeLifeArea(value: string | undefined): LifeArea | undefined {
  return value !== undefined && (LIFE_AREAS as readonly string[]).includes(value)
    ? (value as LifeArea)
    : undefined;
}

/**
 * The transparency read (42-relationship-scoped-sharing §5.3, extended by 68 §4.3): exactly which of a
 * person's OWN shareable items flow to which relationship types and which concrete people, resolved against
 * the live graph. Powers the unified Sharing dashboard (68). Own-scoped — the bridge gates it on `memory.own`
 * and the active person, so a person only ever sees their **own** outbound sharing (never another's).
 *
 * Assembles the COMPLETE outbound picture: Insight facts, shared intake answers, the person's own shared
 * **profile fields** (15-shareability), and their shared **dream images** (13-dream-images). Intake-sourced
 * insight facts are skipped (their scope is answer-owned — the `intakeAnswer` row is the single control, 68
 * §3.9). `relationships` is passed in (resolved by the caller) so this stays a thin assembler.
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
  let keptPrivateCount = 0;

  // 1) Insight facts the person shares (broadcast / per-person / type-scoped). A `restricted` fact reaches no
  //    one — count it toward the "kept private" reassurance stat (68 §4.2), never surfaced. This count spans
  //    EVERY insight, INCLUDING intake-sourced ones (onboarding trauma/intimacy is exactly where `restricted`
  //    facts originate — omitting them would undercount the most sensitive content the stat reassures about). A
  //    flagged-inaccurate fact is corrected (excluded), not private, so it's neither outbound nor counted.
  //    Intake-sourced insights are then skipped for the ITEM list (answer-owned scope — the `intakeAnswer` row
  //    is the control, 68 §3.9), but their restricted facts were already counted above.
  for (const insight of await listInsightsForPerson(fs, key, personId)) {
    for (const fact of insight.facts) if (fact.restricted === true) keptPrivateCount++;
    if (insight.source === 'intake') continue;
    for (const fact of insight.facts) {
      if (fact.restricted === true) continue; // reaches no one — already counted above
      if (fact.flaggedInaccurate === true) continue;
      const broadcast = fact.shareable === true;
      const types = fact.shareableTypes ?? [];
      const personIds = fact.shareableWith ?? [];
      if (!broadcast && types.length === 0 && personIds.length === 0) continue; // private — not outbound
      const item: OutboundSharingItem = {
        id: fact.id,
        kind: 'fact',
        text: fact.text,
        broadcast,
        types,
        personIds,
        recipients: recipientsFor(broadcast, types, personIds),
      };
      const lifeArea = normalizeLifeArea(fact.lifeArea);
      if (lifeArea) item.lifeArea = lifeArea;
      items.push(item);
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
          category: questionCategory(section.id, questionId),
        });
      }
    }
  }

  // 3) Shared PROFILE fields (15-shareability) — each populated, non-locked controllable field reaches ALL
  //    related people (68 §3.8). Read the person's OWN record.
  const person = await getPerson(fs, key, personId);
  if (person) items.push(...profileSharingItems(person, relatedPeople));

  // 4) Shared DREAM images (13-dream-images §3.6) — each standard-tier dream whose `image.shareableWith` names
  //    someone is an item, reaching those per-person recipients (68 §3.8). Non-standard tiers can't be shared.
  for (const dream of await listDreams(fs, key, personId)) {
    const sharedWith = dream.image?.shareableWith ?? [];
    if (dream.sensitivity !== 'standard' || sharedWith.length === 0) continue;
    const label = dream.title ?? dream.dreamDate ?? dream.createdAt.slice(0, 10);
    items.push({
      id: `dreamImage:${dream.id}`,
      kind: 'dreamImage',
      text: `Dream image · ${label}`,
      broadcast: false,
      types: [],
      personIds: sharedWith,
      recipients: recipientsFor(false, [], sharedWith),
    });
  }

  return { items, keptPrivateCount };
}

/** The per-call cap on scope-batch targets (68 §6) — a caller can't rescope thousands at once. */
export const MAX_SCOPE_BATCH_TARGETS = 200;

/**
 * The per-category bulk scope change (68 §3.5/§6): apply `types` — REPLACING each target's current scope
 * (empty ⇒ Private) — to a set of Insight facts + intake answers in one call. Facts are rescoped in place
 * (their sibling facts + server-owned `restricted`/`shareableWith` flags preserved), answers via
 * `setIntakeAnswerSharing`. Touches ONLY the given fact + answer targets — never profile fields or dream
 * images (their sharing models differ, 68 §3.5). When `includeAnswers` is false (a caller lacking
 * `intake.own`), the answer targets are skipped, never errored (68 §7). Own-scoped: the caller passes its own
 * `personId`; this never writes another person's data. Returns the number of targets actually updated.
 */
export async function applyScopeBatch(deps: {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  types: readonly RelationshipType[];
  factTargets: { insightId: string; factId: string }[];
  answerTargets: { sectionId: string; questionId: string }[];
  includeAnswers: boolean;
  now: Date;
}): Promise<{ updated: number }> {
  const { fs, key, personId, factTargets, answerTargets, includeAnswers, now } = deps;
  const types = [...new Set(deps.types)];
  let updated = 0;

  // Facts — group by insight so each file is read/written once even when several of its facts are targeted.
  const factsByInsight = new Map<string, Set<string>>();
  for (const target of factTargets) {
    const set = factsByInsight.get(target.insightId) ?? new Set<string>();
    set.add(target.factId);
    factsByInsight.set(target.insightId, set);
  }
  for (const [insightId, factIds] of factsByInsight) {
    const insight = await getInsight(fs, key, personId, insightId);
    if (!insight) continue;
    let touched = false;
    const facts = insight.facts.map((fact) => {
      if (!factIds.has(fact.id)) return fact;
      touched = true;
      updated++;
      const next = { ...fact };
      // Replace ONLY the relationship-type scope; leave broadcast/`shareableWith`/`restricted` alone.
      if (types.length === 0)
        delete next.shareableTypes; // Private (own context only)
      else next.shareableTypes = types;
      return next;
    });
    if (touched) await saveInsight(fs, key, { ...insight, facts, updatedAt: now.toISOString() });
  }

  // Answers — only when the caller holds `intake.own` (else silently skipped, 68 §7).
  if (includeAnswers) {
    for (const target of answerTargets) {
      const result = await setIntakeAnswerSharing(
        fs,
        key,
        personId,
        target.sectionId,
        target.questionId,
        types,
        now,
      );
      if (result !== null) updated++;
    }
  }

  return { updated };
}
