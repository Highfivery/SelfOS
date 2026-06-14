import { z } from 'zod';
import type { FileSystem } from '../host';
import {
  GuidancePrefsSchema,
  GuidedSuggestionSchema,
  GuidedSuggestionsCacheSchema,
  type GuidancePrefs,
  type GuidanceState,
  type GuidedSuggestResult,
  type GuidedSuggestion,
  type GuidedSuggestionsCache,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { gatherGenerationContext } from '../questionnaires/contextProviders';
import { runClaude, type AiDeps } from '../questionnaires/generationService';
import { GUIDED_CATALOG, type GuidedExercise } from './guidedCatalog';

/**
 * The "Suggested for you" recommender + its per-person cache + the 18+ acknowledgement (16-guided-sessions
 * §3.4/§4.3/§8.3). The recommender mirrors the questionnaire gap-finder: it gathers **structured context
 * only** (profiles, relationships, approved Insights — incl. session insights, which flow through the same
 * insights provider) via the shared context-provider registry, asks Claude to pick catalog exercises,
 * validates against the catalog, caches, and meters `guided.suggest`. Never sends raw transcripts.
 */

const SCHEMA_VERSION = 1;

const guidanceDir = (personId: string): string => `people/${personId}/guidance`;
const suggestionsPath = (personId: string): string => `${guidanceDir(personId)}/suggestions.enc`;
const prefsPath = (personId: string): string => `${guidanceDir(personId)}/prefs.enc`;

// --- 18+ acknowledgement + prefs (§8.3) ---

export async function getGuidancePrefs(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<GuidancePrefs> {
  const raw = await readEncryptedJson(fs, prefsPath(personId), key);
  return raw ? GuidancePrefsSchema.parse(raw) : { schemaVersion: SCHEMA_VERSION };
}

export async function acknowledgeAdult(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<void> {
  const prefs: GuidancePrefs = { schemaVersion: SCHEMA_VERSION, adultAcknowledged: true };
  await writeEncryptedJson(fs, prefsPath(personId), prefs, key);
}

// --- Suggestions cache (§4.3) ---

export async function getCachedSuggestions(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<GuidedSuggestionsCache | null> {
  const raw = await readEncryptedJson(fs, suggestionsPath(personId), key);
  return raw ? GuidedSuggestionsCacheSchema.parse(raw) : null;
}

/** The launcher's no-spend read on open (16 §6): cached suggestions (if any) + the 18+ ack state. */
export async function getGuidanceState(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<GuidanceState> {
  const [cache, prefs] = await Promise.all([
    getCachedSuggestions(fs, key, personId),
    getGuidancePrefs(fs, key, personId),
  ]);
  return {
    cache: cache ? { generatedAt: cache.generatedAt, suggestions: cache.suggestions } : null,
    adultAcknowledged: prefs.adultAcknowledged === true,
  };
}

// --- The recommender (§3.4) ---

function buildSuggestSystem(candidates: ReadonlyArray<GuidedExercise>): string {
  const list = candidates
    .map((e) => `- ${e.id} — ${e.title} (${e.framework}): ${e.blurb}`)
    .join('\n');
  return `You are SelfOS, a warm wellness self-help companion — NOT a clinician. From the catalog of \
guided self-help exercises below, recommend the 2-4 that best fit this person RIGHT NOW, based ONLY on the \
structured context provided (never invent facts). Favour relevance and variety over covering everything.

Catalog (use these exact ids):
${list}

Return ONLY a JSON array of up to 4 objects: {"guideId": "<one of the ids above>", "reason": "<one short, \
warm sentence on why this fits them now>"}. If there is little context, suggest broadly useful starters. \
Return ONLY the JSON array, nothing else.`;
}

function buildSuggestUser(context: string): string {
  const trimmed = context.trim();
  return trimmed
    ? `Here is the structured context about this person:\n${trimmed}\n\nWhich exercises fit them best right now?`
    : `There is little context yet. Suggest a few broadly useful starter exercises.`;
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

/**
 * Generate (or refresh) the person's suggestions and cache them. `adultAllowed` filters the intimacy group
 * out of the catalog AND out of validation until the 18+ ack (§8.3). Budget-gated + metered via runClaude.
 */
export async function suggestGuidedSessions(
  deps: AiDeps,
  opts: { adultAllowed: boolean },
): Promise<GuidedSuggestResult> {
  const candidates = GUIDED_CATALOG.filter((e) => opts.adultAllowed || !e.adult);
  const context = await gatherGenerationContext(deps.fs, deps.key, {
    authorPersonId: deps.personId,
    includeAuthor: true,
    includeTarget: false,
    includeRelationship: false,
  });

  const call = await runClaude(
    deps,
    buildSuggestSystem(candidates),
    buildSuggestUser(context),
    'guided.suggest',
    700,
  );
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const parsed = z.array(GuidedSuggestionSchema).safeParse(extractJsonArray(call.text));
  const valid = new Set(candidates.map((e) => e.id));
  const seen = new Set<string>();
  const suggestions: GuidedSuggestion[] = [];
  for (const s of parsed.success ? parsed.data : []) {
    if (!valid.has(s.guideId) || seen.has(s.guideId)) continue; // drop non-catalog / gated / duplicate ids
    seen.add(s.guideId);
    suggestions.push(s);
    if (suggestions.length >= 4) break;
  }
  if (suggestions.length === 0) {
    return {
      ok: false,
      reason: 'REFUSED',
      usage: call.usage,
      message: 'No suggestions right now — add more about yourself and the people in your life.',
    };
  }

  const generatedAt = deps.now.toISOString();
  const cache: GuidedSuggestionsCache = { schemaVersion: SCHEMA_VERSION, generatedAt, suggestions };
  await writeEncryptedJson(deps.fs, suggestionsPath(deps.personId), cache, deps.key);
  return { ok: true, generatedAt, suggestions, usage: call.usage };
}
