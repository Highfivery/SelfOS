import type { FileSystem } from '../host';
import type {
  EmailFamily,
  EmailSuggestionType,
  Goal,
  Insight,
  SentSuggestion,
  UsageEvent,
} from '../schemas';
import { SentSuggestionSchema } from '../schemas';
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
    if (r.answer === 'not-for-me') subjects.add(subject);
    else if (r.answer === 'maybe-later') {
      const ageMs = now.getTime() - new Date(r.respondedAt).getTime();
      if (ageMs < RESURFACE_WEEKS * 7 * DAY_MS) subjects.add(subject); // still resting; resurface later
    }
  }
  return { texts: sent.map((s) => s.text), subjects };
}

/** A generated suggestion, ready to mint tokens + compose an email around (67 §3.3). */
export interface EmailSuggestion {
  family: 'ai-suggestion' | 'ai-suggestion-intimacy';
  suggestionType: EmailSuggestionType;
  headline: string;
  body: string;
  /** Tappable answers to `body` when it asks something (67 §3.3a / #459). Empty when it does not, and empty
   *  when the model's options failed the shared shape rules — the email then links into the app instead of
   *  offering buttons that cannot answer the question. */
  options: string[];
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
  // Read the recipient's own boundary list before generating anything explicit for them (74 §8.4).
  const lexicon = intimacy ? await readLexicon(deps.fs, deps.key, deps.personId) : null;

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
    intimacy && lexicon ? suppressionLine(lexicon) : '',
    'You write ONE short, warm coaching suggestion to email a person, in their own SelfOS space. Return ' +
      'ONLY a JSON object {"headline": string, "body": string, "options": string[]}. The headline is a ' +
      'short subject line (≤ 8 words). The body is 1–3 plain sentences — specific, kind, never clinical, ' +
      'never a re-phrasing of anything in AVOID. No markdown, no lists, no links.',
    // The email renders `options` as tappable buttons directly under the body, so they must ANSWER the body.
    // Reported defect (#459): a question was emailed with generic engagement buttons ("I'm game / Maybe
    // later / Not for me"), which read as "do you want to answer this?" and did not answer the question at
    // all. Same rule as questionnaire generation (08 §32.8): options are direct, plausible answers to the
    // exact prompt, distinct, mutually exclusive, and covering the honest range.
    'If the body ASKS the person something, `options` must be 2–5 short answers to THAT question — direct, ' +
      'plausible, distinct from each other, and covering the honest range (including an "it depends" or ' +
      '"not sure yet" where that is a real answer). They are answers, NOT reactions: never "I\'m game", ' +
      '"Maybe later", "Sounds good", or anything about whether they want to answer. If the body does NOT ' +
      'ask a question, return an empty `options` array.',
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
  if (lexicon && (violatesBoundary(lexicon, headline) || violatesBoundary(lexicon, body)))
    return null;
  // Run the SAME shape rules as questionnaire generation (08 §32.8) — trim, drop blanks, reject
  // case-insensitive duplicates, require at least two. An unusable set degrades to NO buttons rather than to
  // buttons that cannot answer the question, which is the #459 failure. `normalizeOptions` is the single
  // shared validator, so the email surface can no longer drift from the in-app one.
  const rawOptions = Array.isArray(parsed?.options)
    ? parsed.options.filter((o): o is string => typeof o === 'string')
    : [];
  const options = rawOptions.length > 0 ? (normalizeOptions(rawOptions) ?? []) : [];

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
