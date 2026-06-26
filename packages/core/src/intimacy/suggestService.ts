import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject } from '../ai/jsonSalvage';
import type { ClaudeClient, FileSystem } from '../host';
import type { IntimacyTopicSuggestResult, UsageEvent } from '../schemas';
import { uuid } from '../id';
import { checkBudget, costOf, recordUsage } from '../usage';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import type { IntimacyTopics } from './topics';

/**
 * The owner-only AI **intimacy-topic suggester** (08-questionnaires §16.5a, the AI-assist follow-up). The
 * Owner optionally types a subject/theme and the model proposes consensual-adult **activity** + **fantasy**
 * topics to add to the shared inventory — deduped against what already exists, in the calm wellness register
 * the rest of the intimacy work uses. It PERSISTS NOTHING: the owner reviews the suggestions in a checklist,
 * edits, and the existing add path commits the chosen ones. The only AI spend is one `intimacy.suggestTopics`
 * pass, metered BEFORE parse (spec 06 / 37).
 *
 * Boundary (§8, in the prompt + the model, never a keyword filter): consensual adults only; taboo content
 * strictly as fantasy/roleplay; never minors, real non-consent, or illegal acts. The Owner is the full-access
 * role, so this is gated `people.manage` at the seam, like the manual add.
 */

const MAX_PER_KIND = 12;

function guidance(): string {
  return `You are helping the Owner of a private wellness app curate a shared, consensual-adult intimacy \
"topic inventory" — short labels (a few words each) that people later RATE in a self-reflection (e.g. \
"Sensual massage", "Light bondage (cuffs / ties)"). These are topics to rate, NOT instructions or how-to \
content. Write in a frank, plain, clinical-but-warm wellness register — like a sexual-health questionnaire, \
never erotica.

Suggest concise topics across two lists: "activities" (things partners do together) and "fantasies" \
(themes/roleplay people fantasize about). Boundary: consensual ADULTS only; taboo content ONLY as clearly \
pre-agreed fantasy/roleplay between adults (e.g. CNC as ravishment roleplay); NEVER anything involving \
minors, real non-consent, incest, or illegal acts. Do not repeat any topic the Owner already has (a list is \
provided to avoid). Keep each label short and rateable; aim for 6–10 fresh topics per list (fewer is fine if \
the subject is narrow). If a subject is given, stay close to it; if not, suggest a varied spread across \
gentle→adventurous.

Respond with ONLY a JSON object: {"activities": string[], "fantasies": string[]}.`;
}

function buildBrief(subject: string | undefined, existing: IntimacyTopics): string {
  const subjectLine = subject?.trim()
    ? `Subject to suggest around: ${subject.trim()}`
    : 'No specific subject — suggest a varied spread across gentle→adventurous.';
  const avoid = [...existing.activities, ...existing.fantasies];
  // Bound the avoid-list so a huge custom inventory can't blow the prompt; the post-parse dedupe is the
  // real guarantee, this just nudges the model.
  const avoidLine = `Topics the Owner ALREADY has (do not repeat these): ${avoid.slice(0, 160).join(', ')}`;
  return [subjectLine, avoidLine].join('\n\n');
}

const DraftSchema = z.object({
  activities: z.array(z.string()).catch([]).default([]),
  fantasies: z.array(z.string()).catch([]).default([]),
});

/** Case-insensitive: keep only fresh, non-empty, in-list-unique labels not already in `taken`. */
function freshen(values: string[], taken: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set(taken);
  for (const raw of values) {
    const label = raw.trim();
    const norm = label.toLocaleLowerCase();
    if (label === '' || seen.has(norm)) continue;
    seen.add(norm);
    out.push(label);
    if (out.length >= MAX_PER_KIND) break;
  }
  return out;
}

function buildUsage(
  model: string,
  personId: string,
  at: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  },
): UsageEvent {
  return {
    id: uuid(),
    schemaVersion: 1,
    type: 'intimacy.suggestTopics',
    personId,
    model,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(model, usage),
  };
}

export interface SuggestTopicsDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  /** The Owner — for usage attribution (the topics are household-wide). */
  personId: string;
  now: Date;
  override?: boolean;
}

/**
 * Run the suggester: budget-gated → one Claude call → meter (`intimacy.suggestTopics`, BEFORE parse) →
 * tolerant parse → dedupe against the existing inventory (case-insensitive). Returns ephemeral candidates;
 * nothing is written. An empty result after dedupe is an honest EMPTY (the model only echoed existing topics).
 */
export async function suggestIntimacyTopics(
  deps: SuggestTopicsDeps,
  input: { subject?: string; existing: IntimacyTopics },
): Promise<IntimacyTopicSuggestResult> {
  const { fs, key, client, apiKey, model, personId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  const person = await checkBudget(fs, key, {
    scope: 'person',
    personId,
    now,
    override: deps.override,
  });
  const app = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (person.state === 'over' || app.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const at = now.toISOString();
  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system: [PERSONA, SAFETY, guidance()].join('\n\n'),
        messages: [{ role: 'user', content: buildBrief(input.subject, input.existing) }],
        maxTokens: 800,
        extendedThinking: false, // a bounded structured-JSON call — keep the whole budget for output
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The suggestions couldn’t be written. Please try again.',
    };
  }

  // Meter BEFORE parse — a paid call whose JSON fails is still billed (spec 06 / 37).
  await recordUsage(fs, key, buildUsage(model, personId, at, result.usage));

  const obj = extractJsonObject(result.text);
  const parsed = obj ? DraftSchema.safeParse(obj) : null;
  if (!parsed?.success) {
    const { reason, message } = classifyParseOutcome(result.text, 'topic suggestions');
    return { ok: false, reason, message };
  }

  const taken = new Set(
    [...input.existing.activities, ...input.existing.fantasies].map((t) => t.toLocaleLowerCase()),
  );
  const activities = freshen(parsed.data.activities, taken);
  // Fantasies dedupe against the fantasy + activity sets too, so the two suggestion lists don't overlap.
  const fantasies = freshen(
    parsed.data.fantasies,
    new Set([...taken, ...activities.map((a) => a.toLocaleLowerCase())]),
  );

  if (activities.length === 0 && fantasies.length === 0) {
    return {
      ok: false,
      reason: 'EMPTY',
      message:
        'No fresh topics came back — try a different subject, or you may already have them all.',
    };
  }
  return { ok: true, suggestions: { activities, fantasies } };
}
