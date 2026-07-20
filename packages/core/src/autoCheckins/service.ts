import { getGuidancePrefs } from '../conversations/guidanceService';
import { formatIntakeForGeneration, getIntakeSession } from '../intake/intakeService';
import { ageFromBirthday } from '../people/buildContext';
import { getPerson, listPeople } from '../people/peopleService';
import { listRelationships } from '../people/relationshipService';
import {
  getAssignmentSnapshot,
  createAssignment,
  listAssignments,
} from '../questionnaires/assignmentService';
import { type AiDeps, generateQuestions } from '../questionnaires/generationService';
import { suggestQuestionnaires } from '../questionnaires/gapFinderService';
import { saveQuestionnaire, validateQuestionnaire } from '../questionnaires/questionnaireService';
import {
  gatherRecipientAskedPrompts,
  gatherRecipientHistory,
  gatherRecipientInsightFacts,
  gatherRecipientPriorAnswers,
} from '../questionnaires/recipientHistory';
import type {
  AutoCheckinCreated,
  AutoCheckinIntent,
  AutoCheckinProvenance,
  AutoCheckinRunResult,
  AutoCheckinTarget,
  IncomingAutoCheckinStream,
  Person,
  PrivacyMode,
  QuestionnaireInput,
  QuestionnaireSuggestion,
  Relationship,
  RelationshipType,
  SensitivityTier,
} from '../schemas';
import {
  AUTO_CHECKIN_EXPIRY_DAYS,
  allocateIntents,
  type AutoAssignmentView,
  hasPendingIntimacy,
  planStreams,
  shouldRunAutoCheckins,
  type StreamState,
} from './planner';
import { getAutoCheckinBlocks, getAutoCheckinConfig, isSenderBlocked } from './prefsService';

/**
 * The Auto check-ins orchestrator (63-auto-checkins §5.1) — the AI-bearing top level. Once a day, for each
 * enabled + due stream under its queue cap and out of crisis, it PLANS (pure planner + gap-finder), GENERATES
 * (the existing `generateQuestions` + recipient de-dup), and DELIVERS (`createAssignment`) — reusing the whole
 * questionnaire stack. Cadence + crisis + throttle are gated here; the bridge stamps the device throttle on
 * `ok:true`. Each generated questionnaire carries `autoCheckin` provenance (§4.2) into its immutable snapshot.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_QUESTION_COUNT = 4; // short, so a daily drop isn't a chore (§3.2)

const INTENT_RATIONALE: Record<AutoCheckinIntent, string> = {
  deepen: 'Building on something you’ve been reflecting on.',
  expand: 'Exploring an area next to what you’ve shared.',
  explore: 'Opening up something new.',
  intimacy: 'A space to explore desire and intimacy.',
};

export interface RunAutoCheckinsInput extends AiDeps {
  /** Whether the person is in a recurring-crisis state (computed by the caller via `aggregateCrisisSignal`). */
  crisis: boolean;
  /** The device throttle marker for this author (§3.4) — only consulted for an `auto` run. */
  lastCheckedAt?: string;
  /** `true` = the scheduled auto run (throttled); `false` = a manual "Run now" (skips the throttle). */
  auto: boolean;
}

/** The recipient-tailoring block passed to `generateQuestions` (name/pronouns/relationship, §24.4). */
interface RecipientTailoring {
  name?: string;
  pronouns?: string;
  relationship?: { type: RelationshipType; closeness?: number };
}

type Eligibility =
  | {
      ok: true;
      recipientPersonId: string;
      recipient: RecipientTailoring;
      canIntimacy: boolean;
      isSelf: boolean;
    }
  | { ok: false; reason: string };

export async function runAutoCheckins(input: RunAutoCheckinsInput): Promise<AutoCheckinRunResult> {
  const { fs, key, personId: authorId, now } = input;

  const config = await getAutoCheckinConfig(fs, key, authorId);
  const enabledTargets = config.targets.filter((t) => t.enabled);
  if (!config.enabled || enabledTargets.length === 0) {
    return { ok: false, reason: 'SKIPPED', message: 'Auto check-ins are off.' };
  }
  if (
    input.auto &&
    !shouldRunAutoCheckins({
      enabled: config.enabled,
      hasEnabledTargets: enabledTargets.length > 0,
      lastCheckedAt: input.lastCheckedAt,
      now,
    })
  ) {
    return { ok: false, reason: 'SKIPPED', message: 'Auto check-ins already ran recently.' };
  }
  if (input.crisis)
    return { ok: false, reason: 'CRISIS', message: 'Support comes first right now.' };
  if (!input.apiKey) {
    return {
      ok: false,
      reason: 'AI_OFF',
      message: 'Add your Claude API key to enable auto check-ins.',
    };
  }

  // Build each enabled stream's state from its OWN auto-generated assignments (this author → this recipient).
  const targetById = new Map(enabledTargets.map((t) => [t.id, t]));
  const streamById = new Map<string, StreamState>();
  for (const target of enabledTargets) {
    const recipientId = target.target.kind === 'self' ? authorId : target.target.personId;
    const assignments = await autoAssignmentsForStream(fs, key, authorId, recipientId, target.id);
    streamById.set(target.id, { targetId: target.id, cadence: target.cadence, assignments });
  }
  // A manual "Run now" (auto:false) tops up every stream regardless of its per-cadence due-time; the auto
  // cadence respects it. Either way the hard queue cap + per-run caps still bound the volume.
  const plans = planStreams({ streams: [...streamById.values()], now, force: !input.auto });

  const created: AutoCheckinCreated[] = [];
  const skipped: { targetId: string; reason: string }[] = [];
  let budgetHit = false;

  for (const plan of plans) {
    if (budgetHit) break;
    const target = targetById.get(plan.targetId);
    const stream = streamById.get(plan.targetId);
    if (!target || !stream) continue;

    const elig = await resolveEligibility(input, target);
    if (!elig.ok) {
      skipped.push({ targetId: target.id, reason: elig.reason });
      continue;
    }

    const reserveIntimacy = elig.canIntimacy && !hasPendingIntimacy(stream.assignments, now);
    const intents = allocateIntents(plan.slots, { reserveIntimacy });

    // Gather the recipient's de-dup bundle ONCE per stream (never re-ask, go deeper — §3.7).
    const bundle = await buildDedupBundle(fs, key, elig.recipientPersonId);

    // Run the gap-finder once if any topical slot needs it; its rationale'd ideas seed those slots.
    let suggestions: QuestionnaireSuggestion[] = [];
    if (intents.some((i) => i !== 'intimacy')) {
      const sug = await suggestQuestionnaires(input, {
        ...(elig.isSelf ? {} : { targetPersonId: elig.recipientPersonId }),
        ...(elig.recipient.name ? { recipientName: elig.recipient.name } : {}),
        ...(bundle.recipientHistory ? { recipientHistory: bundle.recipientHistory } : {}),
      });
      if (sug.ok) suggestions = sug.suggestions ?? [];
      // A gap-finder miss (thin context / budget / refusal) isn't fatal — topical slots fall back to a
      // generic intent brief; a BUDGET miss surfaces below on the first generate call.
    }

    let sugIndex = 0;
    for (const intent of intents) {
      const spec =
        intent === 'intimacy'
          ? intimacySpec(target.explorationFocus)
          : topicalSpec(suggestions[sugIndex++], target.explorationFocus, intent);

      const gen = await generateQuestions(input, {
        type: spec.type,
        sensitivity: spec.sensitivity,
        brief: spec.brief,
        context: {
          authorPersonId: authorId,
          includeAuthor: true,
          ...(elig.isSelf
            ? { includeTarget: false, includeRelationship: false }
            : {
                targetPersonId: elig.recipientPersonId,
                includeTarget: true,
                includeRelationship: true,
              }),
        },
        existingPrompts: [],
        count: AUTO_QUESTION_COUNT,
        ...(bundle.recipientHistory ? { recipientHistory: bundle.recipientHistory } : {}),
        recipientAskedPrompts: bundle.recipientAskedPrompts,
        ...(bundle.dedupReference ? { dedupReference: bundle.dedupReference } : {}),
        ...(intent === 'intimacy' && bundle.coveredActs.length
          ? { coveredIntimacyActs: bundle.coveredActs }
          : {}),
        recipient: elig.recipient,
      });

      if (!gen.ok) {
        if (gen.reason === 'BUDGET') {
          budgetHit = true;
          break;
        }
        skipped.push({ targetId: target.id, reason: `generate:${gen.reason}` });
        continue;
      }
      const generatedQuestions = gen.questions ?? [];
      if (generatedQuestions.length === 0) {
        skipped.push({ targetId: target.id, reason: 'generate:EMPTY' });
        continue;
      }

      const provenance: AutoCheckinProvenance = {
        targetId: target.id,
        intent,
        rationale: spec.rationale.slice(0, 280),
        generatedAt: now.toISOString(),
      };
      const draft: QuestionnaireInput = {
        title: gen.title?.trim() || spec.title || defaultTitle(intent),
        type: spec.type,
        sensitivity: spec.sensitivity,
        recipient: { kind: 'person', personId: elig.recipientPersonId },
        questions: generatedQuestions,
        autoCheckin: provenance,
      };
      // Generation can emit an authoring-only type (matrix/allocation/…) that `createAssignment` REJECTS by
      // throwing — in this unattended loop a thrown send would abort every remaining stream AND orphan the
      // just-saved def. Pre-validate BEFORE saving (so a bad slot leaves no orphan), and wrap the
      // persist+deliver so any I/O failure skips just this slot rather than the whole run (§7 / DoD).
      if (validateQuestionnaire(draft).length > 0) {
        skipped.push({ targetId: target.id, reason: 'generate:invalid' });
        continue;
      }
      let questionnaire;
      let assignment;
      try {
        questionnaire = await saveQuestionnaire(fs, key, draft, authorId);
        const privacy: PrivacyMode = elig.isSelf ? 'standard' : 'private';
        assignment = await createAssignment(fs, key, {
          questionnaireId: questionnaire.id,
          senderPersonId: authorId,
          recipient: { kind: 'person', personId: elig.recipientPersonId },
          channel: 'inApp',
          privacy,
          senderVisibleToRecipient: true,
          expiresAt: new Date(now.getTime() + AUTO_CHECKIN_EXPIRY_DAYS * DAY_MS).toISOString(),
        });
      } catch {
        skipped.push({ targetId: target.id, reason: 'deliver:error' });
        continue;
      }

      created.push({
        targetId: target.id,
        intent,
        questionnaireId: questionnaire.id,
        assignmentId: assignment.id,
        recipientPersonId: elig.recipientPersonId,
        title: questionnaire.title,
        rationale: provenance.rationale,
      });
    }
  }

  if (budgetHit && created.length === 0) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }
  return { ok: true, created, skipped };
}

/** This stream's own auto check-ins: sends from `senderId` to `recipientId` whose snapshot names `targetId`. */
async function autoAssignmentsForStream(
  fs: AiDeps['fs'],
  key: Uint8Array,
  senderId: string,
  recipientId: string,
  targetId: string,
): Promise<AutoAssignmentView[]> {
  const all = await listAssignments(fs, key, {
    senderPersonId: senderId,
    recipientPersonId: recipientId,
  });
  const out: AutoAssignmentView[] = [];
  for (const a of all) {
    const snapshot = await getAssignmentSnapshot(fs, key, a.id);
    const prov = snapshot?.autoCheckin;
    if (!prov || prov.targetId !== targetId) continue;
    out.push({
      createdAt: a.createdAt,
      status: a.status,
      ...(a.expiresAt ? { expiresAt: a.expiresAt } : {}),
      intent: prov.intent,
    });
  }
  return out;
}

/** Re-check eligibility every run against the live graph (§8.2): onboarding, adult, partner, both 18+ acks. */
async function resolveEligibility(
  input: RunAutoCheckinsInput,
  target: AutoCheckinTarget,
): Promise<Eligibility> {
  const { fs, key, personId: authorId, now } = input;

  if (target.target.kind === 'self') {
    const session = await getIntakeSession(fs, key, authorId);
    if (session?.status !== 'complete') return { ok: false, reason: 'onboarding-incomplete' };
    const self = await getPerson(fs, key, authorId);
    const prefs = await getGuidancePrefs(fs, key, authorId);
    return {
      ok: true,
      recipientPersonId: authorId,
      recipient: tailoringFor(self, undefined),
      canIntimacy: target.includeIntimacy && prefs.adultAcknowledged === true,
      isSelf: true,
    };
  }

  const recipientId = target.target.personId;
  const person = await getPerson(fs, key, recipientId);
  if (!person) return { ok: false, reason: 'not-found' };
  const session = await getIntakeSession(fs, key, recipientId);
  if (session?.status !== 'complete') return { ok: false, reason: 'onboarding-incomplete' };
  const age = person.birthday ? ageFromBirthday(person.birthday, now) : null;
  if (age === null || age < 18) return { ok: false, reason: 'not-adult' };
  // The target's standing opt-out (§3.3a): if they've turned this sender off, generate + deliver nothing —
  // a hard gate re-checked every run, so a block takes effect immediately regardless of the owner's config.
  if (await isSenderBlocked(fs, key, recipientId, authorId)) {
    return { ok: false, reason: 'blocked-by-recipient' };
  }

  const relType = relationshipTypeBetween(await listRelationships(fs, key), authorId, recipientId);
  let canIntimacy = false;
  if (target.includeIntimacy && relType === 'partner') {
    const [authorPrefs, targetPrefs] = await Promise.all([
      getGuidancePrefs(fs, key, authorId),
      getGuidancePrefs(fs, key, recipientId),
    ]);
    canIntimacy = authorPrefs.adultAcknowledged === true && targetPrefs.adultAcknowledged === true;
  }
  return {
    ok: true,
    recipientPersonId: recipientId,
    recipient: tailoringFor(person, relType),
    canIntimacy,
    isSelf: false,
  };
}

/** The author↔target relationship type — a `partner` edge wins (for the intimacy gate); else the first edge. */
function relationshipTypeBetween(
  relationships: Relationship[],
  a: string,
  b: string,
): RelationshipType | undefined {
  const between = relationships.filter(
    (r) =>
      (r.fromPersonId === a && r.toPersonId === b) || (r.fromPersonId === b && r.toPersonId === a),
  );
  const partner = between.find((r) => r.type === 'partner');
  return partner?.type ?? between[0]?.type;
}

/**
 * The enabled auto check-in streams (across all household people) that target `viewerId` (§3.3a/§4.5) — the
 * data for the viewer's "Check-ins others send you" surface. Scoped STRICTLY to streams aimed at the viewer:
 * a person can only ever see who is sending THEM check-ins, never streams aimed at anyone else. Skips a
 * sender whose master toggle or stream is off (nothing actively targeting the viewer). Never exposes the
 * owner's private per-target exploration focus.
 */
export async function listIncomingAutoCheckinStreams(
  fs: AiDeps['fs'],
  key: Uint8Array,
  viewerId: string,
): Promise<IncomingAutoCheckinStream[]> {
  const [people, blocks, relationships] = await Promise.all([
    listPeople(fs, key),
    getAutoCheckinBlocks(fs, key, viewerId),
    listRelationships(fs, key),
  ]);
  const blocked = new Set(blocks.blockedSenders);
  const out: IncomingAutoCheckinStream[] = [];
  for (const owner of people) {
    if (owner.id === viewerId) continue;
    // Only a SUBJECT can send — a plain contact has no account and configures nothing.
    if (!owner.isSubject) continue;
    const config = await getAutoCheckinConfig(fs, key, owner.id);
    const stream = config.enabled
      ? config.targets.find(
          (t) => t.enabled && t.target.kind === 'person' && t.target.personId === viewerId,
        )
      : undefined;
    const relType = relationshipTypeBetween(relationships, viewerId, owner.id);
    // 66 — everyone who COULD send is listed, not just those already sending. The block governs one-off
    // automated sends too (a dream-derived questionnaire), so a switch that only appeared after someone
    // had started a recurring stream would be unreachable exactly when it mattered most.
    out.push({
      senderPersonId: owner.id,
      senderName: owner.displayName,
      ...(relType ? { relationshipLabel: relType } : {}),
      active: stream !== undefined,
      ...(stream ? { cadence: stream.cadence, includeIntimacy: stream.includeIntimacy } : {}),
      blocked: blocked.has(owner.id),
    });
  }
  // Those actively sending lead; the rest are there to pre-empt.
  return out.sort((a, b) => Number(b.active) - Number(a.active));
}

function tailoringFor(
  person: Person | null,
  relType: RelationshipType | undefined,
): RecipientTailoring {
  return {
    ...(person?.displayName ? { name: person.displayName } : {}),
    ...(person?.pronouns ? { pronouns: person.pronouns } : {}),
    ...(relType ? { relationship: { type: relType } } : {}),
  };
}

interface SlotSpec {
  type: string;
  sensitivity: SensitivityTier;
  brief: string;
  title?: string;
  rationale: string;
}

function topicalSpec(
  suggestion: QuestionnaireSuggestion | undefined,
  focus: string,
  intent: AutoCheckinIntent,
): SlotSpec {
  const briefParts: string[] = [];
  briefParts.push(suggestion?.rationale?.trim() || INTENT_RATIONALE[intent]);
  if (focus.trim()) briefParts.push(`Focus especially on: ${focus.trim()}.`);
  // A topical slot is never sensitive — coerce an intimacy/scenario suggestion type back to a general one.
  const suggestedType = suggestion?.type?.trim();
  const type =
    suggestedType && suggestedType !== 'intimacy' && suggestedType !== 'scenario'
      ? suggestedType
      : 'general';
  return {
    type,
    sensitivity: 'standard',
    brief: briefParts.join(' '),
    ...(suggestion?.title ? { title: suggestion.title } : {}),
    rationale: suggestion?.rationale?.trim() || INTENT_RATIONALE[intent],
  };
}

function intimacySpec(focus: string): SlotSpec {
  const briefParts = [
    'Explore desire, intimacy, and sexuality openly. Prefer topics not yet covered so this goes somewhere new.',
  ];
  if (focus.trim()) briefParts.push(`Focus especially on: ${focus.trim()}.`);
  return {
    type: 'intimacy',
    sensitivity: 'unfiltered',
    brief: briefParts.join(' '),
    rationale: INTENT_RATIONALE.intimacy,
  };
}

function defaultTitle(intent: AutoCheckinIntent): string {
  return intent === 'intimacy' ? 'Desire & intimacy check-in' : 'A quick check-in';
}

/**
 * Assemble the recipient's de-dup bundle from the shared host-side gatherers. This MIRRORS the manual path's
 * `recipientKnownData` (coreBridge.ts, 08 §23.5b/§24.3) EXACTLY — the soft-grounding blob with onboarding
 * appended, and a semantic-pass reference whose sections each get their OWN budget so a heavy onboarding can't
 * truncate away the prior-questionnaire answers or the session/dream/test insight facts (the §23.5b bug).
 * Author-blind: fed only to the model, never surfaced to the author. (Slice B extracts a single shared builder
 * used by both this engine and the bridge; until then this must stay in lockstep with `recipientKnownData`.)
 */
async function buildDedupBundle(
  fs: AiDeps['fs'],
  key: Uint8Array,
  recipientId: string,
): Promise<{
  recipientHistory: string;
  dedupReference: string;
  recipientAskedPrompts: string[];
  coveredActs: { label: string; rating: string }[];
}> {
  const [history, priorPrompts, priorAnswers, insightFacts, session] = await Promise.all([
    gatherRecipientHistory(fs, key, recipientId),
    gatherRecipientAskedPrompts(fs, key, recipientId),
    gatherRecipientPriorAnswers(fs, key, recipientId),
    gatherRecipientInsightFacts(fs, key, recipientId),
    getIntakeSession(fs, key, recipientId),
  ]);
  const intake = session
    ? formatIntakeForGeneration(session)
    : { text: '', coveredActs: [], prompts: [] };
  const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}\n…` : s);

  const recipientHistory = [
    history,
    intake.text.trim() ? `What they have already answered in onboarding:\n${intake.text}` : '',
  ]
    .filter((s) => s.trim() !== '')
    .join('\n\n');

  const dedupReference = [
    intake.text.trim()
      ? `ALREADY ANSWERED in their onboarding — do NOT re-ask ANY of this, including specific sub-preferences, acts, positions, kinks, and options they selected (e.g. MMF/FFM, particular porn genres, yes/no on an act):\n${cap(intake.text.trim(), 8000)}`
      : '',
    priorAnswers.trim()
      ? `ALREADY ANSWERED in prior questionnaires (do NOT re-ask any of this):\n${cap(priorAnswers.trim(), 4000)}`
      : '',
    insightFacts.trim()
      ? `ALREADY KNOWN about them from sessions, reflections, tests, and dreams (do NOT re-ask these):\n${cap(insightFacts.trim(), 3000)}`
      : '',
    priorPrompts.length
      ? `ALREADY ASKED in prior questionnaires:\n${cap(priorPrompts.map((p) => `- ${p}`).join('\n'), 2000)}`
      : '',
  ]
    .filter((s) => s.trim() !== '')
    .join('\n\n');

  const recipientAskedPrompts = [...priorPrompts, ...intake.prompts];
  return {
    recipientHistory,
    dedupReference,
    recipientAskedPrompts,
    coveredActs: intake.coveredActs.map((a) => ({ label: a.label, rating: a.rating })),
  };
}
