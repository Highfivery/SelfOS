import type { FileSystem } from '../host';
import { uuid } from '../id';
import { TogetherSuggestionSchema, type TogetherSuggestion } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import type { SuggestMarker } from '../conversations/suggestMarker';
import { getTogetherGuide } from './togetherCatalog';

// ── Coach SUGGESTION artifacts (58 §5.6) — a write-once card the couples coach can drop into a session:
// a guided exercise to start together, or a compatibility check-in to seed. Stored per session (both
// partners see it); ONE writer (the coach turn's device). It NEVER auto-acts — the renderer surfaces an
// explicit action (start the exercise / open a check-in). Same-shape as the message store, so no second writer.

function isSafeSegment(s: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(s);
}
function suggestionsDir(sessionId: string): string {
  return `together/sessions/${sessionId}/suggestions`;
}

/**
 * Capture a coach SUGGESTION from a marker into a write-once session artifact (§5.6). A `guide` suggestion is
 * kept only if its `guideId` resolves to a real, NON-adult Together catalog entry (an adult exercise is never
 * surfaced this way — it lives behind the explicit-register + 18+ gates, §3.10); an unknown guide degrades to
 * a plain prompt card (no start action). Returns the stored suggestion, or null if nothing usable.
 */
export async function captureSuggestionFromMarker(
  fs: FileSystem,
  key: Uint8Array,
  sessionId: string,
  marker: SuggestMarker,
  now: Date,
): Promise<TogetherSuggestion | null> {
  if (!isSafeSegment(sessionId) || !marker.prompt.trim()) return null;
  const at = now.toISOString();
  // A guide suggestion only carries a guideId when it names a real, non-adult catalog entry.
  const guide =
    marker.kind === 'guide' && marker.guideId ? getTogetherGuide(marker.guideId) : undefined;
  const guideId = guide && !guide.adult ? guide.id : undefined;
  const suggestion: TogetherSuggestion = {
    id: uuid(),
    schemaVersion: 1,
    sessionId,
    kind: marker.kind,
    prompt: marker.prompt.trim(),
    ...(guideId ? { guideId } : {}),
    ...(marker.kind === 'questionnaire' && marker.topic ? { topic: marker.topic } : {}),
    createdAt: at,
  };
  await writeEncryptedJson(
    fs,
    `${suggestionsDir(sessionId)}/${suggestion.id}.enc`,
    suggestion,
    key,
  );
  return suggestion;
}

/** All coach suggestions for a session, oldest-first; a corrupt entry is skipped (§7 tolerant reads). */
export async function listSuggestions(
  fs: FileSystem,
  key: Uint8Array,
  sessionId: string,
): Promise<TogetherSuggestion[]> {
  if (!isSafeSegment(sessionId)) return [];
  const out: TogetherSuggestion[] = [];
  for (const name of await fs.list(suggestionsDir(sessionId))) {
    if (!name.endsWith('.enc')) continue;
    try {
      const raw = await readEncryptedJson(fs, `${suggestionsDir(sessionId)}/${name}`, key);
      const parsed = raw ? TogetherSuggestionSchema.safeParse(raw) : null;
      if (parsed?.success) out.push(parsed.data);
    } catch {
      // Skip a corrupt suggestion; the session still renders.
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
