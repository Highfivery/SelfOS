import type { ClaudeClient } from '../host';
import { LIFE_AREAS } from '../schemas';
import { lifeAreasFromText } from '../insights/lifeAreaKeywords';

/**
 * Free-form session topic classification (28 §13.2). A free-start (non-guided) session has no structured topic
 * signal, so we infer one from the user's message with a SMALL, fast model — `claude-haiku-4-5` — independent
 * of the chat model. Cost is bounded by caching the result on the conversation and re-running ONLY when the
 * subject shifts (`topicShifted`). The classifier sees only text already sent to the model for the reply (no
 * new data exposure) and never sees the portrait facts; it returns life-area labels only.
 */
export const TOPIC_MODEL = 'claude-haiku-4-5';

const VALID_AREAS = new Set<string>(LIFE_AREAS);

/**
 * Whether to (re-)run the classifier this turn. A cheap, deterministic trigger — NOT the classifier itself:
 * re-classify on the first turn (no cached topic) or when the message's keyword signals touch a life-area the
 * cached topic doesn't cover (a likely subject change). A message with no strong keyword signal keeps the
 * cached topic (no needless spend). The keywords only decide WHEN to spend on Haiku; the topic is the model's.
 */
export function topicShifted(userText: string, cached: string[] | undefined): boolean {
  if (cached === undefined) return true; // never classified (turn 1) — always classify
  const hits = lifeAreasFromText(userText);
  if (hits.length === 0) return false; // no strong signal → keep the cached topic (incl. a cached `[]`)
  // A keyword hit outside the cached set is a likely subject change. For a cached `[]` (classified to "no
  // specific area"), ANY hit counts as a shift — the subject just became specific.
  return hits.some((area) => !cached.includes(area));
}

const SYSTEM = `You label what life-area(s) a person's message is about, to help a coach recall relevant \
background. Reply with ONLY a JSON object {"lifeAreas": [...]} whose values are drawn from EXACTLY this list: \
${LIFE_AREAS.join(', ')}. Choose the 1-3 most relevant; use [] if none clearly apply. No prose, no fences.`;

function parseLifeAreas(text: string): string[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const raw = (parsed as { lifeAreas?: unknown }).lifeAreas;
  if (!Array.isArray(raw)) return [];
  // Validate against the canonical list (never trust the model's labels raw); dedupe, keep canonical order.
  const picked = new Set(
    raw.filter((v): v is string => typeof v === 'string' && VALID_AREAS.has(v)),
  );
  return LIFE_AREAS.filter((area) => picked.has(area));
}

export interface ClassifyTopicResult {
  lifeAreas: string[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
}

/**
 * Classify the latest message into life-areas. Returns the validated areas + the call's token usage so the
 * caller meters it (`session.topic`), or `null` when the call THREW (transport error) — never throws. A call
 * that returns but parses to nothing yields `{ lifeAreas: [], usage }` (still metered; the tokens were spent).
 * Fail-open is the caller's job: on `null`/`[]` it keeps the cached topic (or none on turn 1).
 */
export async function classifyTopic(deps: {
  client: ClaudeClient;
  apiKey: string;
  userText: string;
  priorAssistant?: string;
}): Promise<ClassifyTopicResult | null> {
  const messages = [
    ...(deps.priorAssistant ? [{ role: 'assistant' as const, content: deps.priorAssistant }] : []),
    { role: 'user' as const, content: deps.userText },
  ];
  let result;
  try {
    result = await deps.client.stream(
      {
        apiKey: deps.apiKey,
        model: TOPIC_MODEL,
        system: SYSTEM,
        messages,
        maxTokens: 120,
        extendedThinking: false,
      },
      () => {},
    );
  } catch {
    return null;
  }
  return { lifeAreas: parseLifeAreas(result.text), usage: result.usage };
}
