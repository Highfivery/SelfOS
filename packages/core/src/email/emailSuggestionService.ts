import type { FileSystem } from '../host';
import type {
  EmailAnswerStance,
  EmailFamily,
  EmailSuggestionType,
  Goal,
  Insight,
  SentSuggestion,
  UsageEvent,
} from '../schemas';
import { EmailAnswerStanceSchema, SentSuggestionSchema } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { uuid } from '../id';
import { listInsightsForPerson, ownSubjectInsights } from '../insights/insightStore';
import { listConversations } from '../conversations/conversationService';
import { conversationStatus } from '../schemas';
import { listGoals } from '../goals/goalService';
import { getSynthesis } from '../coaching/coachingSynthesisService';
import { stalestOpenGoal } from '../recommendations/providers';
import { isNearDuplicate } from '../questionnaires/dedup';
import { normalizeOptions } from '../questionnaires/questionnaireService';
import { readLexicon, suppressedTexts, violatesBoundary } from '../tests/adaptive/lexicon';
import type { EroticLexicon } from '../schemas';
import { runClaude, type AiDeps } from '../questionnaires/aiCall';
import { extractJsonObject } from '../ai/jsonSalvage';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import { explicitFraming } from '../questionnaires/aiPrompts';
import { listEmailResponses } from './emailResponse';

/**
 * The AI Coach Suggestions engine (67 §3.3 — family E, the crown jewel). At most twice a week per person,
 * and ONLY when genuinely-new data has accrued, SelfOS composes ONE suggestion email with a single metered
 * Claude call and schedules it. A suggestion is de-dup'd (never a re-phrasing of a recent one), avoids a
 * subject a person tapped "not for me" on, and resurfaces a "maybe later" subject after a few weeks. The
 * de-dup history + avoid-set are kept PER-FAMILY (`ai-suggestion` vs `ai-suggestion-intimacy`, §3.3), so a
 * "not for me" in one never suppresses the other.
 */

/** ≤2 suggestion emails/week per person (67 §3.3), with a minimum spacing so they never bunch. */
export const SUGGESTION_MAX_PER_WEEK = 2;
export const SUGGESTION_MIN_GAP_DAYS = 3;
/** The tappable answers a suggestion email may carry (67 §3.3a) — the prompt asks for 2–5 short ones. */
export const MAX_ANSWERS = 5;
const MAX_ANSWER_LABEL_CHARS = 60;
/** A "maybe later" subject is avoided for this long, then allowed to resurface (67 §3.6). */
export const RESURFACE_WEEKS = 3;
/** How far back the new-data gate looks when there's no prior suggestion. */
const NEW_DATA_FLOOR_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const suggestionsDir = (personId: string): string => `people/${personId}/email/suggestions`;
const suggestionPath = (personId: string, id: string): string =>
  `${suggestionsDir(personId)}/${id}.enc`;

const afterOrEq = (at: string | undefined, sinceMs: number): boolean =>
  at !== undefined && new Date(at).getTime() >= sinceMs;

/** The signals the new-data gate + generation read (67 §3.3). Deterministic, gathered host-side. */
export interface SuggestionSignals {
  /** Approved insights created since the last suggestion (drives "question to sit with"). */
  newInsights: Insight[];
  /** Completed sessions since the last suggestion. */
  newSessionCount: number;
  /** The coaching synthesis observation, if any (40). */
  observation?: string;
  /** The stalest open goal, if any (drives "something to try"). */
  stalestGoal?: Goal;
}

/**
 * Gather the deterministic suggestion signals for a person since `sinceAt` (67 §3.3). No AI, no side effects.
 */
export async function gatherSuggestionSignals(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  sinceAt: Date,
  now: Date,
): Promise<SuggestionSignals> {
  const sinceMs = sinceAt.getTime();
  const [insights, conversations, goals, synthesis] = await Promise.all([
    listInsightsForPerson(fs, key, personId),
    listConversations(fs, key, personId),
    listGoals(fs, key, personId),
    getSynthesis(fs, key, personId),
  ]);
  // Own-subject only (#129): a suggestion email speaks to this person about THEMSELVES, so a questionnaire/
  // auto check-in they SENT (an insight about the RECIPIENT) must never trigger or populate their own email.
  const newInsights = ownSubjectInsights(insights).filter(
    (i) => i.approved && afterOrEq(i.createdAt, sinceMs),
  );
  const newSessionCount = conversations.filter(
    (c) => conversationStatus(c) === 'complete' && afterOrEq(c.endedAt ?? c.updatedAt, sinceMs),
  ).length;
  const stalest = stalestOpenGoal(goals, now);
  return {
    newInsights,
    newSessionCount,
    ...(synthesis?.observation ? { observation: synthesis.observation } : {}),
    ...(stalest ? { stalestGoal: stalest } : {}),
  };
}

/**
 * The new-data gate (67 §3.3) — true only when there's genuinely-new material to suggest from. No new data
 * → NO email (never "just to send one" — the 63 §13 lesson). For intimacy, pass `intimacyOverlap` (the
 * mutual shared signal); a non-empty overlap alone counts as fresh material.
 */
export function hasNewSuggestionData(
  signals: SuggestionSignals,
  intimacyOverlapCount = 0,
): boolean {
  return (
    signals.newInsights.length > 0 ||
    signals.newSessionCount > 0 ||
    Boolean(signals.observation) ||
    intimacyOverlapCount > 0
  );
}

/** Read a person's sent-suggestion history, optionally for one family, newest-first (67 §4.4). */
export async function listSentSuggestions(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  family?: EmailFamily,
): Promise<SentSuggestion[]> {
  const out: SentSuggestion[] = [];
  for (const name of await fs.list(suggestionsDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${suggestionsDir(personId)}/${name}`, key);
    if (!raw) continue;
    const parsed = SentSuggestionSchema.safeParse(raw);
    if (parsed.success && (!family || parsed.data.family === family)) out.push(parsed.data);
  }
  return out.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
}

/** Persist a sent suggestion (67 §4.4). */
export async function recordSentSuggestion(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  suggestion: SentSuggestion,
): Promise<void> {
  await writeEncryptedJson(fs, suggestionPath(personId, suggestion.id), suggestion, key);
}

/**
 * The per-family avoid-set (67 §3.3/§3.6): the recent suggestion texts (fuzzy de-dup keys) + the subjects a
 * person has ruled out. A `not-for-me` response avoids that subject forever; a `maybe-later` avoids it until
 * `RESURFACE_WEEKS` have passed (then it may resurface). Kept strictly per-family.
 */
export async function buildAvoidSet(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  family: EmailFamily,
  now: Date,
): Promise<{ texts: string[]; subjects: Set<string> }> {
  const [sent, responses] = await Promise.all([
    listSentSuggestions(fs, key, personId, family),
    listEmailResponses(fs, key, personId),
  ]);
  const byId = new Map(sent.map((s) => [s.id, s]));
  const subjects = new Set<string>();
  for (const r of responses) {
    if (r.family !== family || !r.suggestionId) continue;
    const subject = byId.get(r.suggestionId)?.subjectKey;
    if (!subject) continue;
    // The MEANING, not the wording (67 §3.3a): answers are written per email now, so `stance` is what says
    // "rule this out" / "not now". The two legacy values are still honoured — responses recorded before
    // stances existed carried their meaning in the fixed `answer` value, and must not silently lose it.
    const ruledOut = r.stance === 'no' || r.answer === 'not-for-me';
    const resting = r.stance === 'maybe' || r.answer === 'maybe-later';
    if (ruledOut) subjects.add(subject);
    else if (resting) {
      const ageMs = now.getTime() - new Date(r.respondedAt).getTime();
      if (ageMs < RESURFACE_WEEKS * 7 * DAY_MS) subjects.add(subject); // still resting; resurface later
    }
  }
  return { texts: sent.map((s) => s.text), subjects };
}

/**
 * One tappable answer on a suggestion email (67 §3.3a): the words the person reads, plus what tapping them
 * MEANS. The label is written for this body and this body only; the stance is what the response loop reads,
 * so dynamic wording never costs us the rule-it-out / rest-it / mutual-green-light behaviour.
 */
export interface SuggestionAnswer {
  label: string;
  stance: EmailAnswerStance;
}

/**
 * The one fixed set this feature must never emit again (#523). A model handed "options" will sometimes echo
 * the engagement labels it has seen; a set made ENTIRELY of them is the defect wearing a model's output, so
 * it is refused rather than sent.
 */
const GENERIC_ENGAGEMENT_LABELS = new Set(
  [
    "i'm game",
    'im game',
    'we’re into it',
    "we're into it",
    'maybe later',
    'not for me',
    'not for us',
    'sounds good',
    'more like this',
    'less like this',
  ].map((l) => l.replace(/’/g, "'")),
);

const normalizeLabel = (label: string): string => label.trim().toLowerCase().replace(/’/g, "'");

/**
 * True when the generic labels are the MAJORITY of the set — i.e. the set is the reported email wearing a
 * model's byline. Not "every": a single honest decline among several specific answers ("Yes, Thursday" /
 * "Another day" / "Not for me") is a real answer to a real proposal, while three of four generic is the
 * defect with a word added.
 */
export function isGenericEngagementSet(labels: readonly string[]): boolean {
  if (labels.length === 0) return false;
  const generic = labels.filter((l) => GENERIC_ENGAGEMENT_LABELS.has(normalizeLabel(l))).length;
  return generic * 2 > labels.length;
}

/** A generated suggestion, ready to mint tokens + compose an email around (67 §3.3). */
export interface EmailSuggestion {
  family: 'ai-suggestion' | 'ai-suggestion-intimacy';
  suggestionType: EmailSuggestionType;
  headline: string;
  body: string;
  /**
   * The tappable answers to THIS body (67 §3.3a). Never empty: a suggestion whose answers are missing or
   * unusable is not sent at all, because the alternative — falling through to one fixed set of engagement
   * buttons — is the reported defect (#459, #523): an emailed question arrived under "I'm game / Maybe later
   * / Not for me", which answers a question nobody asked.
   */
  options: SuggestionAnswer[];
  subjectKey?: string;
  partnerPersonId?: string;
  sharedSuggestionKey?: string;
}

/** Pick the suggestion type from the freshest available signal (non-intimacy). */
function pickType(signals: SuggestionSignals): EmailSuggestionType {
  if (signals.observation) return 'question-to-sit-with';
  if (signals.stalestGoal) return 'something-to-try';
  return 'check-in';
}

interface GenerateInput {
  family: 'ai-suggestion' | 'ai-suggestion-intimacy';
  signals: SuggestionSignals;
  avoid: { texts: string[]; subjects: Set<string> };
  recipientName?: string;
  /** For intimacy: the mutual "both into it/curious" acts (shared-data-only, 67 §8.2). */
  intimacyOverlap?: { key: string; label: string }[];
  partnerName?: string;
  partnerPersonId?: string;
  sharedSuggestionKey?: string;
  /**
   * The shared Questionnaire-Intelligence steering (spec 69 §3.2 — email joins the one universe): the
   * recipient's coverage + differentiated feedback guidance (`gatherRecipientFeedbackGuidance`) so the email
   * nudge steers to genuinely NEW ground + honors declines, and the covered-topics the app has already worked
   * elsewhere (questionnaires / story) so email stops re-suggesting them. Email keeps its own per-family
   * `avoid`-set on top (past suggestions + not-for-me/maybe-later subjects) — those stay email-only (§69 P4).
   */
  steering?: { feedbackGuidance?: string; coveredTopics?: string[] };
  /**
   * The intimacy ground still OPEN with this person, from their own topic map (spec 71 §5.3) — the subject
   * matter for an intimacy suggestion.
   *
   * REQUIRED, and an EMPTY array is meaningful: it says this person has worked every area through, and the
   * prompt must say so rather than degrade to the seeded families. Optional-with-a-seed-fallback is the shape
   * that produced the bug this replaced — the caller omitted it in exactly the all-worked case, so an explicit
   * email nobody reviews first would nudge toward the areas they had just exhausted. Every caller has a topic
   * map (`ensureTopics` seeds one for everyone), so there is no honest case for a fallback here.
   */
  openGround: readonly { label: string; blurb?: string }[];
}

/**
 * Compose ONE suggestion with a single metered Claude call (67 §3.3, `email.suggest`), de-dup'd against the
 * per-family avoid-set. Returns `null` when there's nothing fresh, the candidate duplicates a recent one, or
 * the model declines/errors — in every "null" case NO email is sent. Budget-gating, truncation-safety, AND
 * usage metering all come from `runClaude` (it records the `email.suggest` event itself — the caller must NOT
 * re-record `usage`, which is returned only for assertions). The caller persists the returned `SentSuggestion`.
 */
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * The hard-no list as a negative constraint. Mirrors the wording `buildSuppressionBlock` uses so the same
 * rule reads the same way in every prompt that carries it.
 */
function suppressionLine(lexicon: EroticLexicon): string {
  const nos = suppressedTexts(lexicon);
  if (nos.length === 0) return '';
  return (
    'NEVER use any of these words or phrases, in any form — they have been ruled out and the rule is ' +
    `absolute, whatever else this email says: ${nos.join(' · ')}. Never mention that anything was ruled out.`
  );
}

export async function generateSuggestion(
  deps: AiDeps,
  input: GenerateInput,
): Promise<{ suggestion: EmailSuggestion; sent: SentSuggestion; usage: UsageEvent } | null> {
  const intimacy = input.family === 'ai-suggestion-intimacy';
  const overlap = (input.intimacyOverlap ?? []).filter((a) => !input.avoid.subjects.has(a.key));
  if (intimacy && overlap.length === 0) return null; // shared signal exhausted / all avoided
  /*
   * The recipient's own boundary list, read UNCONDITIONALLY (74 §5.8a).
   *
   * It used to be read only for the intimacy family, which disabled three things at once for every other
   * suggestion: the negative constraint in the prompt below, and BOTH `violatesBoundary` checks further down
   * (each guarded on `lexicon`, so a null one silently skipped them). The comment on those checks says
   * "nothing that touches a boundary is emailed, whatever the model returned" — true only for one family.
   *
   * That is the same shape §3.6.29 removed from `chatService`, where suppression sat inside `if (adultAcked)`:
   * a hard no is not a sexual-topic preference, and the list contains ordinary words (`baby`, `beautiful`,
   * `love`) that a warm non-intimacy coaching email can very plausibly reach for. Suppression can only ever
   * PREVENT, so no family makes withholding it correct — and this is the one surface whose output reaches a
   * person with nobody reviewing it first.
   */
  const lexicon = await readLexicon(deps.fs, deps.key, deps.personId);

  const suggestionType: EmailSuggestionType = intimacy ? 'intimacy' : pickType(input.signals);
  const subjectKey = intimacy
    ? overlap[0]?.key
    : suggestionType === 'something-to-try'
      ? input.signals.stalestGoal?.id
      : undefined;
  if (subjectKey && input.avoid.subjects.has(subjectKey)) return null; // ruled out

  const system = [
    PERSONA,
    SAFETY,
    // Same rule as questionnaire generation: the subject matter is this person's OWN open ground, so an
    // intimacy email can never nudge toward an area they have already worked through.
    intimacy ? explicitFraming('explicit', [], { openGround: input.openGround }) : '',
    // The hard-no list, as a negative constraint (74 §8.4: suppression is unconditional, with or without any
    // steer). This is the ONLY surface where explicit generated text leaves the device with nobody reviewing
    // it first, so it is the last place that should be generating in the explicit register without knowing
    // what someone has ruled out — a person who marked a word `never` could be emailed it.
    suppressionLine(lexicon),
    'You write ONE short, warm coaching suggestion to email a person, in their own SelfOS space. Return ' +
      'ONLY a JSON object {"headline": string, "body": string, "options": [{"label": string, "stance": ' +
      '"yes"|"maybe"|"no"|"other"}]}. The headline is a short subject line (≤ 8 words). The body is 1–3 ' +
      'plain sentences — specific, kind, never clinical, never a re-phrasing of anything in AVOID. No ' +
      'markdown, no lists, no links.',
    // The email renders `options` as the ONLY tappable buttons under the body, so they are the whole reply.
    // Reported twice (#459, #523): a question was emailed under "I'm game / Maybe later / Not for me",
    // which reads as "do you want to answer this?" and answers the question not at all. Same rule as
    // questionnaire generation (08 §32.8): direct, plausible answers to the exact prompt, distinct,
    // mutually exclusive, covering the honest range.
    '`options` is REQUIRED and must be 2–5 short answers to THIS body, written for THIS body — a person ' +
      'reading them should be able to tell which email they belong to. Direct, plausible, distinct from ' +
      'each other, and covering the honest range (include a "not sure" or "it depends" where that is a ' +
      'real answer). NEVER a generic set that would fit any email: never "I\'m game", "Maybe later", ' +
      '"Not for me", "Sounds good". Keep each label under about 5 words so it fits a button.',
    // The label is the words; the stance is what tapping it MEANS, and it is what the response loop reads.
    'Set `stance` on each answer: "no" only for an answer that rules this subject out for good, "maybe" ' +
      'only for one that puts it off for now, "yes" for one that takes it up, and "other" for an answer ' +
      'that simply answers the question and expresses no such preference (most answers to an open question ' +
      'are "other" — answering is not declining).',
    // Ask for a body a person can actually answer in a tap. A question with no short honest answers ends up
    // unsendable (the app refuses to fabricate options), so the body has to be shaped for its own answers.
    'Write a body whose answers can be honest short buttons. If your first idea cannot be answered that ' +
      'way — an open memory question like "when did you first learn that?" — narrow it until it can, or ' +
      'suggest something concrete to try instead.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const contextLines: string[] = [];
  if (input.recipientName) contextLines.push(`For: ${input.recipientName}`);
  contextLines.push(`Suggestion type: ${suggestionType}`);
  if (suggestionType === 'question-to-sit-with' && input.signals.observation)
    contextLines.push(`A reflection worth deepening: ${input.signals.observation}`);
  if (suggestionType === 'something-to-try' && input.signals.stalestGoal)
    contextLines.push(`A goal that's gone quiet: ${input.signals.stalestGoal.text}`);
  if (suggestionType === 'check-in')
    contextLines.push('Invite a small self check-in — one gentle thing to notice this week.');
  if (input.signals.newInsights[0]?.summary)
    contextLines.push(`Recently learned: ${input.signals.newInsights[0].summary}`);
  if (intimacy) {
    contextLines.push(
      `A couple suggestion for ${input.recipientName ?? 'them'}` +
        (input.partnerName ? ` and ${input.partnerName}` : '') +
        '. Build ONLY on this MUTUAL, consensual interest you both share: ' +
        overlap
          .slice(0, 4)
          .map((a) => a.label)
          .join(', ') +
        '. Frank and specific, within policy; never assume anything beyond this shared list.',
    );
  }
  // The shared Questionnaire-Intelligence steering (spec 69 P4): steer to new ground + honor declines, and
  // don't re-suggest ground already covered by a questionnaire / the biographer.
  if (input.steering?.feedbackGuidance?.trim())
    contextLines.push(input.steering.feedbackGuidance.trim());
  if (input.steering?.coveredTopics && input.steering.coveredTopics.length > 0)
    contextLines.push(
      'ALREADY COVERED elsewhere (do NOT suggest a check-in about any of these — cover new ground instead): ' +
        input.steering.coveredTopics.slice(0, 12).join(' | '),
    );
  if (input.avoid.texts.length > 0)
    contextLines.push(
      'AVOID (do not re-phrase any of these recent suggestions): ' +
        input.avoid.texts.slice(0, 12).join(' | '),
    );

  const result = await runClaude(
    deps,
    system,
    contextLines.join('\n'),
    'email.suggest',
    intimacy ? 700 : 500,
  );
  if (!result.ok) return null; // NO_KEY / BUDGET / refusal / error → no email
  const parsed = extractJsonObject(result.text) as {
    headline?: unknown;
    body?: unknown;
    options?: unknown;
  } | null;
  const headline = typeof parsed?.headline === 'string' ? parsed.headline.trim() : '';
  const body = typeof parsed?.body === 'string' ? parsed.body.trim() : '';
  if (!headline || !body) return null; // a bad/empty parse → no email (scheduled family, no retry)
  // Belt and braces on top of the prompt line: nothing that touches a boundary is emailed, whatever the
  // model returned. Refusing to send beats sending the one thing they ruled out.
  if (violatesBoundary(lexicon, headline) || violatesBoundary(lexicon, body)) return null;
  // Run the SAME shape rules as questionnaire generation (08 §32.8) — trim, drop blanks, reject
  // case-insensitive duplicates, require at least two. `normalizeOptions` is the single shared validator, so
  // the email surface can no longer drift from the in-app one.
  //
  // An unusable set means NO EMAIL (#523). The previous shape — degrade to "no buttons" — was not what the
  // delivery path then did: it fell through to one fixed engagement set, which is exactly the email a person
  // reported twice. An answerless suggestion is a suggestion this feature cannot deliver, so it is skipped;
  // there will be another next cycle, and none of the material is consumed.
  const raw = Array.isArray(parsed?.options) ? parsed.options : [];
  const answers = raw
    .map((o) => {
      // Tolerant on shape: a bare string is read as a stance-free answer rather than dropped.
      const label =
        typeof o === 'string' ? o : isRecord(o) && typeof o.label === 'string' ? o.label : '';
      const stance = isRecord(o) ? EmailAnswerStanceSchema.safeParse(o.stance) : null;
      return { label, stance: stance?.success ? stance.data : ('other' as EmailAnswerStance) };
    })
    .filter((a) => a.label.trim() !== '');
  // The prompt asks for 2–5 short answers; a model that returns eight long ones would otherwise ship eight
  // buttons and eight tokens. Clamp before validating, so an over-long set still yields a usable email.
  const labels = normalizeOptions(
    answers
      .filter((a) => a.label.trim().length <= MAX_ANSWER_LABEL_CHARS)
      .slice(0, MAX_ANSWERS)
      .map((a) => a.label),
  );
  if (!labels) return null; // fewer than two usable answers → not sendable
  // A set made entirely of the engagement labels answers no particular question — refuse it outright rather
  // than ship the reported email under a model's byline.
  if (isGenericEngagementSet(labels)) return null;
  // The labels are model-written prose that both reaches the person AND is quoted into their coaching
  // context, so they carry the same boundary guarantee as the headline and body (74 §8.4). A hard-no term
  // in a button is exactly as unsendable as one in the sentence above it.
  if (labels.some((l) => violatesBoundary(lexicon, l))) return null;
  const stanceOf = new Map(answers.map((a) => [a.label.trim(), a.stance]));
  const options: SuggestionAnswer[] = labels.map((label) => ({
    label,
    stance: stanceOf.get(label) ?? 'other',
  }));

  const dedupKey = `${headline} ${body}`;
  if (isNearDuplicate(dedupKey, input.avoid.texts)) return null; // a re-phrasing → skip

  const suggestion: EmailSuggestion = {
    family: input.family,
    suggestionType,
    headline,
    options,
    body,
    ...(subjectKey ? { subjectKey } : {}),
    ...(input.partnerPersonId ? { partnerPersonId: input.partnerPersonId } : {}),
    ...(input.sharedSuggestionKey ? { sharedSuggestionKey: input.sharedSuggestionKey } : {}),
  };
  const sent: SentSuggestion = {
    id: uuid(),
    schemaVersion: 1,
    family: input.family,
    suggestionType,
    text: dedupKey,
    ...(subjectKey ? { subjectKey } : {}),
    ...(input.partnerPersonId ? { partnerPersonId: input.partnerPersonId } : {}),
    ...(input.sharedSuggestionKey ? { sharedSuggestionKey: input.sharedSuggestionKey } : {}),
    tokens: [],
    sentAt: deps.now.toISOString(),
  };
  return { suggestion, sent, usage: result.usage };
}

/** The default new-data lookback when a person has no prior suggestion (67 §3.3). */
export function suggestionLookbackFloor(now: Date): Date {
  return new Date(now.getTime() - NEW_DATA_FLOOR_DAYS * DAY_MS);
}
