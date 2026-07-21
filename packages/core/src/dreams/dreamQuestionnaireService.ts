import type { FileSystem } from '../host';
import type {
  Dream,
  DreamProvenance,
  DreamQuestionnaireArtifact,
  PrivacyMode,
  QuestionnaireInput,
} from '../schemas';
import { getPerson } from '../people';
import { isSenderBlocked } from '../autoCheckins/prefsService';
import { formatIntakeForGeneration, getIntakeSession } from '../intake';
import {
  buildDedupReference,
  createAssignment,
  deleteQuestionnaire,
  gatherRecipientAskedPrompts,
  gatherRecipientHistory,
  gatherRecipientInsightFacts,
  gatherRecipientPriorAnswers,
  generateQuestions,
  saveQuestionnaire,
  validateQuestionnaire,
  type AiDeps,
} from '../questionnaires';

/**
 * Turn a dream analysis's questionnaire proposals into real, SENT questionnaires (66 §3.4).
 *
 * This is unattended — there is no review step, by explicit product decision — so it borrows the auto
 * check-in recipe rather than the story one: the story path only ever self-sends, whereas this can reach
 * another household member, which is the part that needs the eligibility re-checks and the no-orphan
 * ordering.
 *
 * Nothing is persisted on any failure path. A proposal we can't safely act on is skipped silently; the
 * analysis itself is the product and must still land.
 */

/** How many questions a dream check-in asks — matching the story check-in's size. */
const DREAM_QUESTION_COUNT = 4;
/** At most one per analysis, enforced host-side no matter what the model returns. */
const MAX_DREAM_QUESTIONNAIRES = 1;
const EXPIRY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DreamQuestionnaireProposal {
  title: string;
  brief: string;
  /** "me", a name from the dream's people, or absent ⇒ the dreamer. NEVER a personId. */
  // Explicitly `| undefined`: the tolerant parse `.catch(undefined)`s this, and the repo runs
  // `exactOptionalPropertyTypes`, so an optional-only type wouldn't accept it.
  for?: string | undefined;
}

export interface MintDreamQuestionnairesInput {
  deps: AiDeps;
  fs: FileSystem;
  key: Uint8Array;
  /** The dreamer — the author + sender of anything this creates. */
  personId: string;
  dream: Dream;
  analysisId: string;
  proposals: DreamQuestionnaireProposal[];
  now: Date;
}

/**
 * Resolve who a proposal is for, without ever trusting the model with an id.
 *
 * "me"/absent → the dreamer. A NAME is matched (case-insensitively) against the dream's own people, and
 * only a figure actually LINKED to the People graph can receive one — a free-text name is just a word in
 * a dream, not a person we can address.
 */
async function resolveRecipient(
  fs: FileSystem,
  key: Uint8Array,
  dreamerId: string,
  dream: Dream,
  target: string | undefined,
): Promise<{ personId: string; name?: string } | null> {
  const wanted = target?.trim().toLowerCase();
  if (!wanted || wanted === 'me' || wanted === 'myself') return { personId: dreamerId };

  for (const ref of dream.people) {
    if (!ref.personId) continue; // an unlinked dream figure can't be a recipient
    if (ref.name?.trim().toLowerCase() === wanted) {
      const person = await getPerson(fs, key, ref.personId);
      if (person) return { personId: ref.personId, name: person.displayName };
      continue;
    }
    const person = await getPerson(fs, key, ref.personId);
    if (person?.displayName.trim().toLowerCase() === wanted) {
      return { personId: ref.personId, name: person.displayName };
    }
  }
  return null;
}

export async function mintDreamQuestionnaires(
  input: MintDreamQuestionnairesInput,
): Promise<DreamQuestionnaireArtifact[]> {
  const { deps, fs, key, personId, dream, analysisId, proposals, now } = input;
  const artifacts: DreamQuestionnaireArtifact[] = [];

  for (const proposal of proposals.slice(0, MAX_DREAM_QUESTIONNAIRES)) {
    const recipient = await resolveRecipient(fs, key, personId, dream, proposal.for);
    if (!recipient) continue; // unresolvable / unlinked → nothing persisted

    const isSelf = recipient.personId === personId;
    if (!isSelf) {
      const person = await getPerson(fs, key, recipient.personId);
      if (!person) continue;
      // The recipient's OWN standing opt-out (63 §3.3a) — their data, in their vault, and a hard gate
      // everywhere else automated sending happens. Honoured here for the same reason: it's their choice,
      // not the dreamer's. The switch behind it is reachable BEFORE anything is sent (66 — the
      // "Questions others send you" list includes people who could send, not just those already
      // sending), so this is a real gate rather than one guarding an invisible control.
      if (await isSenderBlocked(fs, key, recipient.personId, personId)) continue;
    }

    // Feed generation the analysis-derived THEME, never the raw narrative — so a questionnaire can't
    // paraphrase the dream back at the person it was about.
    const brief = isSelf
      ? proposal.brief
      : `Someone close to you has been reflecting on this and would like to understand it with you: ${proposal.brief}`;

    // De-dup grounding for the recipient (self OR a household member), so a dream check-in never re-asks
    // what they've already answered in onboarding / prior questionnaires / reflected on (08 §23.5). This
    // path previously passed NO de-dup inputs — a real hole, since it can reach another member with full
    // history. Mirrors the auto-checkin/bridge assembly (intake fetched here, the pure reference shared).
    const [dHistory, dPrompts, dAnswers, dFacts, dSession] = await Promise.all([
      gatherRecipientHistory(fs, key, recipient.personId),
      gatherRecipientAskedPrompts(fs, key, recipient.personId),
      gatherRecipientPriorAnswers(fs, key, recipient.personId),
      gatherRecipientInsightFacts(fs, key, recipient.personId),
      getIntakeSession(fs, key, recipient.personId),
    ]);
    const dIntake = dSession
      ? formatIntakeForGeneration(dSession)
      : { text: '', prompts: [] as string[] };
    const dedupReference = buildDedupReference({
      intakeText: dIntake.text,
      priorAnswers: dAnswers,
      insightFacts: dFacts,
      priorPrompts: dPrompts,
    });
    const recipientHistory = [
      dHistory,
      dIntake.text.trim() ? `What they have already answered in onboarding:\n${dIntake.text}` : '',
    ]
      .filter((s) => s.trim() !== '')
      .join('\n\n');
    const recipientAskedPrompts = [...dPrompts, ...dIntake.prompts];

    const generated = await generateQuestions(deps, {
      type: 'general',
      sensitivity: 'standard',
      brief,
      context: {
        authorPersonId: personId,
        includeAuthor: true,
        // For someone else, tailor to them — the same shareable-only target context the builder uses.
        includeTarget: !isSelf,
        includeRelationship: !isSelf,
        ...(isSelf ? {} : { targetPersonId: recipient.personId }),
      },
      existingPrompts: [],
      count: DREAM_QUESTION_COUNT,
      ...(recipientHistory ? { recipientHistory } : {}),
      ...(dedupReference ? { dedupReference } : {}),
      ...(recipientAskedPrompts.length ? { recipientAskedPrompts } : {}),
    });
    const questions = generated.ok ? (generated.questions ?? []) : [];
    if (questions.length === 0) continue;

    const provenance: DreamProvenance = {
      dreamId: dream.id,
      analysisId,
      brief: proposal.brief.slice(0, 280),
      generatedAt: now.toISOString(),
    };
    const draft: QuestionnaireInput = {
      title: proposal.title,
      type: 'general',
      sensitivity: 'standard',
      questions,
      dreamProvenance: provenance,
    };

    // `createAssignment` THROWS on an invalid questionnaire, and generation can emit authoring-only
    // types — so validate BEFORE saving, or a bad draft leaves an orphaned def behind.
    if (validateQuestionnaire(draft).length > 0) continue;

    let questionnaireId: string | undefined;
    try {
      const questionnaire = await saveQuestionnaire(fs, key, draft, personId);
      questionnaireId = questionnaire.id;
      const privacy: PrivacyMode = isSelf ? 'standard' : 'private';
      const assignment = await createAssignment(fs, key, {
        questionnaireId: questionnaire.id,
        senderPersonId: personId,
        recipient: { kind: 'person', personId: recipient.personId },
        channel: 'inApp',
        privacy,
        senderVisibleToRecipient: true,
        expiresAt: new Date(now.getTime() + EXPIRY_DAYS * DAY_MS).toISOString(),
      });
      artifacts.push({
        questionnaireId: questionnaire.id,
        assignmentId: assignment.id,
        title: questionnaire.title,
        recipientPersonId: recipient.personId,
        ...(recipient.name ? { recipientName: recipient.name } : {}),
        sentAt: now.toISOString(),
      });
    } catch {
      // Compensate: if the def saved but the send threw, remove it rather than leave an unsent orphan
      // the person never asked for. (The auto check-in path accepts that window; this one closes it.)
      if (questionnaireId) {
        try {
          await deleteQuestionnaire(fs, questionnaireId);
        } catch {
          // Best-effort cleanup.
        }
      }
      continue;
    }
  }

  return artifacts;
}
