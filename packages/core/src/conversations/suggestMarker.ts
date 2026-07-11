/**
 * Turn-embedded SUGGESTION capture for Together couples sessions (58 §5.6/§6.4). When the couples coach
 * proposes a concrete next step — a guided exercise or a compatibility check-in the pair could do together —
 * it silently appends a private `[[SELFOS:SUGGEST:{json}]]` marker, mirroring the AGREEMENT/CHALLENGE markers:
 * stripped from saved + streamed text, never shown, best-effort, free input never blocked. The Together turn
 * captures it into a write-once session artifact (a suggestion CARD); a malformed marker is ignored
 * (tolerant-parse, spec 37). It NEVER auto-sends anything — the card offers the person an explicit action.
 */

const SUGGEST_MARKER_RE = /\[\[SELFOS:SUGGEST:(\{[\s\S]*?\})\]\]/g;
const SUGGEST_PREFIX = '[[SELFOS:SUGGEST:';

/** The suggestion a coach marker carries (raw, pre-normalization). */
export interface SuggestMarker {
  kind: 'guide' | 'questionnaire';
  /** A short, human phrasing of the suggestion the card shows ("Try the Love Maps exercise together"). */
  prompt: string;
  /** For a `guide` suggestion — the Together catalog entry id to start (validated against the catalog). */
  guideId?: string;
  /** For a `questionnaire` suggestion — a short topic to seed a compatibility check-in. */
  topic?: string;
}

/** Parse the LATEST `[[SELFOS:SUGGEST:{…}]]` marker, or null if none / it doesn't validate (tolerant). */
export function parseSuggestMarker(text: string): SuggestMarker | null {
  const matches = [...text.matchAll(SUGGEST_MARKER_RE)];
  const last = matches[matches.length - 1];
  if (!last || !last[1]) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(last[1]);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind === 'guide' || obj.kind === 'questionnaire' ? obj.kind : null;
  const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
  if (!kind || !prompt) return null;
  const marker: SuggestMarker = { kind, prompt };
  if (typeof obj.guideId === 'string' && obj.guideId.trim()) marker.guideId = obj.guideId.trim();
  if (typeof obj.topic === 'string' && obj.topic.trim()) marker.topic = obj.topic.trim();
  return marker;
}

/** Remove every suggestion marker (and any trailing partial still mid-stream) from a reply. */
export function stripSuggestMarker(text: string): string {
  let out = text.replace(SUGGEST_MARKER_RE, '');
  // Mid-stream the marker body may have arrived without its closing ']]' — drop from the prefix to the end.
  out = out.replace(/\[\[SELFOS:SUGGEST:[\s\S]*$/, '');
  // …or a trailing partial of the prefix itself, e.g. '[[SELFOS:SUGG'.
  for (let i = SUGGEST_PREFIX.length - 1; i > 0; i--) {
    const partial = SUGGEST_PREFIX.slice(0, i);
    if (out.endsWith(partial)) {
      out = out.slice(0, -partial.length);
      break;
    }
  }
  return out.replace(/\s+$/, '');
}
