/**
 * Turn-embedded coach-initiated private clarification for Together couples sessions (58 §3.14 Part B / §6.4).
 * On a NON-aside (open) turn, when the coach wants to gently verify something sensitive with ONE partner
 * without surfacing it in the shared room, it silently appends a private
 * `[[SELFOS:PRIVATE:{"to":"<partner name>","text":"<the private note>"}]]` marker — exactly mirroring the
 * agreement / challenge / step / wrap-up markers: stripped from the saved + streamed text, never shown, and
 * best-effort. The Together turn resolves `to` to a participant and mints a `privateAside` coach message
 * scoped to that partner (the projection hides it from the other); an unresolvable `to` is DROPPED (no leak).
 * A malformed marker is ignored (tolerant-parse, spec 37). The STRIP lives in the shared `stripCoachMarkers`,
 * so a coach that ever emits one never shows the raw token in ANY surface.
 */

const PRIVATE_MARKER_RE = /\[\[SELFOS:PRIVATE:(\{[\s\S]*?\})\]\]/g;
const PRIVATE_PREFIX = '[[SELFOS:PRIVATE:';

/** The private clarification a coach marker carries (raw, pre-resolution). Both fields required. */
export interface PrivateMarker {
  /** The partner the coach wants to reach — a display name (resolved to a participant id by the turn). */
  to: string;
  /** The private note the coach wants only that partner to see. */
  text: string;
}

/**
 * Parse the LATEST `[[SELFOS:PRIVATE:{…}]]` marker into a raw `PrivateMarker`, or null if there is none or it
 * doesn't validate (tolerant — a malformed marker yields no private note, spec 37). Both `to` and `text` must
 * be non-empty strings.
 */
export function parsePrivateMarker(text: string): PrivateMarker | null {
  const matches = [...text.matchAll(PRIVATE_MARKER_RE)];
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
  const to = typeof obj.to === 'string' ? obj.to.trim() : '';
  const note = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!to || !note) return null;
  return { to, text: note };
}

/**
 * Remove every private-clarification marker (and any trailing partial still mid-stream) from a reply, trimming
 * trailing whitespace — so the token never flashes during streaming or persists in the shared transcript.
 */
export function stripPrivateMarker(text: string): string {
  let out = text.replace(PRIVATE_MARKER_RE, '');
  // Mid-stream the marker body may have arrived without its closing ']]' — drop from the prefix to the end.
  out = out.replace(/\[\[SELFOS:PRIVATE:[\s\S]*$/, '');
  // …or a trailing partial of the prefix itself, e.g. '[[SELFOS:PRIV'.
  for (let i = PRIVATE_PREFIX.length - 1; i > 0; i--) {
    const partial = PRIVATE_PREFIX.slice(0, i);
    if (out.endsWith(partial)) {
      out = out.slice(0, -partial.length);
      break;
    }
  }
  return out.replace(/\s+$/, '');
}
