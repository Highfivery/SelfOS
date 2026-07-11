/**
 * Turn-embedded agreement capture for Together couples sessions (58 §3.9/§6.4). When both partners clearly
 * commit to a concrete agreement (e.g. "screen-free dinners on weekdays"), the couples coach silently appends
 * a private `[[SELFOS:AGREEMENT:{json}]]` marker — exactly mirroring the challenge / step / wrap-up markers:
 * stripped from saved + streamed text, never shown, best-effort, free input never blocked. The Together turn
 * parses it into a pair-ledger `Agreement`; a malformed marker is ignored (tolerant-parse, spec 37). The STRIP
 * lives in the shared `stripCoachMarkers`, so a SOLO coach that ever emits one never shows it either.
 */

const AGREEMENT_MARKER_RE = /\[\[SELFOS:AGREEMENT:(\{[\s\S]*?\})\]\]/g;
const AGREEMENT_PREFIX = '[[SELFOS:AGREEMENT:';

/** The agreement a coach marker carries (raw, pre-normalization). `text` is required. */
export interface AgreementMarker {
  text: string;
  timeframe?: string;
}

/**
 * Parse the LATEST `[[SELFOS:AGREEMENT:{…}]]` marker into a raw `AgreementMarker`, or null if there is none or
 * it doesn't validate (tolerant — a malformed marker yields no agreement, spec 37).
 */
export function parseAgreementMarker(text: string): AgreementMarker | null {
  const matches = [...text.matchAll(AGREEMENT_MARKER_RE)];
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
  const agreementText = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!agreementText) return null;
  const marker: AgreementMarker = { text: agreementText };
  if (typeof obj.timeframe === 'string' && obj.timeframe.trim()) {
    marker.timeframe = obj.timeframe.trim();
  }
  return marker;
}

/**
 * Remove every agreement marker (and any trailing partial still mid-stream) from a reply, trimming trailing
 * whitespace — so the token never flashes during streaming or persists in the transcript.
 */
export function stripAgreementMarker(text: string): string {
  let out = text.replace(AGREEMENT_MARKER_RE, '');
  // Mid-stream the marker body may have arrived without its closing ']]' — drop from the prefix to the end.
  out = out.replace(/\[\[SELFOS:AGREEMENT:[\s\S]*$/, '');
  // …or a trailing partial of the prefix itself, e.g. '[[SELFOS:AGREE'.
  for (let i = AGREEMENT_PREFIX.length - 1; i > 0; i--) {
    const partial = AGREEMENT_PREFIX.slice(0, i);
    if (out.endsWith(partial)) {
      out = out.slice(0, -partial.length);
      break;
    }
  }
  return out.replace(/\s+$/, '');
}
