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
import { listInsightsForPerson } from '../insights/insightStore';
import { listConversations } from '../conversations/conversationService';
import { conversationStatus } from '../schemas';
import { listGoals } from '../goals/goalService';
import { getSynthesis } from '../coaching/coachingSynthesisService';
import { stalestOpenGoal } from '../recommendations/providers';
import { isNearDuplicate } from '../questionnaires/dedup';
import { runClaude, type AiDeps } from '../questionnaires/aiCall';
import { extractJsonObject } from '../ai/jsonSalvage';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import { explicitFraming } from '../questionnaires/aiPrompts';
import { mergedIntimacyTopics } from '../intimacy/topics';
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
  const newInsights = insights.filter((i) => i.approved && afterOrEq(i.createdAt, sinceMs));
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
}

/**
 * Compose ONE suggestion with a single metered Claude call (67 §3.3, `email.suggest`), de-dup'd against the
 * per-family avoid-set. Returns `null` when there's nothing fresh, the candidate duplicates a recent one, or
 * the model declines/errors — in every "null" case NO email is sent. Budget-gating, truncation-safety, AND
 * usage metering all come from `runClaude` (it records the `email.suggest` event itself — the caller must NOT
 * re-record `usage`, which is returned only for assertions). The caller persists the returned `SentSuggestion`.
 */
export async function generateSuggestion(
  deps: AiDeps,
  input: GenerateInput,
): Promise<{ suggestion: EmailSuggestion; sent: SentSuggestion; usage: UsageEvent } | null> {
  const intimacy = input.family === 'ai-suggestion-intimacy';
  const overlap = (input.intimacyOverlap ?? []).filter((a) => !input.avoid.subjects.has(a.key));
  if (intimacy && overlap.length === 0) return null; // shared signal exhausted / all avoided

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
    intimacy ? explicitFraming('explicit', mergedIntimacyTopics()) : '',
    'You write ONE short, warm coaching suggestion to email a person, in their own SelfOS space. Return ' +
      'ONLY a JSON object {"headline": string, "body": string}. The headline is a short subject line (≤ 8 ' +
      'words). The body is 1–3 plain sentences — specific, kind, never clinical, never a re-phrasing of ' +
      'anything in AVOID. No markdown, no lists, no links.',
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
  const parsed = extractJsonObject(result.text) as { headline?: unknown; body?: unknown } | null;
  const headline = typeof parsed?.headline === 'string' ? parsed.headline.trim() : '';
  const body = typeof parsed?.body === 'string' ? parsed.body.trim() : '';
  if (!headline || !body) return null; // a bad/empty parse → no email (scheduled family, no retry)

  const dedupKey = `${headline} ${body}`;
  if (isNearDuplicate(dedupKey, input.avoid.texts)) return null; // a re-phrasing → skip

  const suggestion: EmailSuggestion = {
    family: input.family,
    suggestionType,
    headline,
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
