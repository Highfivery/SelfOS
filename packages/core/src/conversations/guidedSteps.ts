/**
 * Turn-embedded step tracking for structured guided exercises (16-guided-sessions §3.3). Like the wrap-up
 * marker, the coach is taught (in the exercise's prompt) to silently append a private marker naming the
 * step it has moved onto. The chat-turn orchestrator parses the latest one to advance `guideStep`, strips
 * every marker from the saved + streamed text, and the user never sees it. No extra model call, and free
 * input is never blocked — the stepper is best-effort orientation, not a gate.
 */

import { stripWrapUpMarker } from './wrapUp';
import { stripAgreementMarker } from './agreementMarker';
import { stripSuggestMarker } from './suggestMarker';

const STEP_MARKER_RE = /\[\[SELFOS:STEP:\d+\]\]/g;
const STEP_PREFIX = '[[SELFOS:STEP:';

/**
 * Teach the coach the step-marker convention for THIS exercise's steps (structured only). `n` is the
 * 0-based index of the step the coach is currently working through.
 */
export function buildStepInstruction(steps: string[]): string {
  const numbered = steps.map((s, i) => `${i}. ${s}`).join('; ');
  return `This is a structured exercise with these steps (0-based): ${numbered}. Privately, at the very end \
of each reply, append the exact token [[SELFOS:STEP:n]] where n is the index of the step you are currently \
guiding (e.g. [[SELFOS:STEP:0]] for the first). This token is a silent signal to the app; it is never shown \
to the person, so never mention or explain it. If they wander off-script, follow them — just mark the step \
that best reflects where the conversation is.`;
}

/** The latest step index the coach declared this turn, or null if no marker is present. */
export function parseLatestStep(text: string): number | null {
  const matches = [...text.matchAll(/\[\[SELFOS:STEP:(\d+)\]\]/g)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : null;
}

/**
 * Remove every step marker (and any trailing partial still mid-stream) from a reply, trimming trailing
 * whitespace. Safe to call on every streaming delta-accumulation so the token never flashes.
 */
export function stripStepMarkers(text: string): string {
  let out = text.replace(STEP_MARKER_RE, '');
  // Mid-stream the marker may have only partially arrived: '[[SELFOS:STEP:12' or '…:12]' (no closing ']]').
  out = out.replace(/\[\[SELFOS:STEP:\d*\]?$/, '');
  // …or a trailing partial of the prefix itself, e.g. '[[SELFOS:STE'.
  for (let i = STEP_PREFIX.length - 1; i > 0; i--) {
    const partial = STEP_PREFIX.slice(0, i);
    if (out.endsWith(partial)) {
      out = out.slice(0, -partial.length);
      break;
    }
  }
  return out.replace(/\s+$/, '');
}

// ── Challenge marker (52-challenge-sessions §3.2) ─────────────────────────────────────────────────────────
// When the person clearly agrees to a concrete stretch action in a challenge session, the coach silently
// appends a private `[[SELFOS:CHALLENGE:{json}]]` marker capturing the agreed challenge — exactly mirroring
// the step / wrap-up markers: stripped from saved + streamed text, never shown, best-effort, free input
// never blocked. The orchestrator parses it and creates the tracked `Challenge`. A malformed marker is
// ignored (no challenge created), the tolerant-parse rule (spec 37).

const CHALLENGE_MARKER_RE = /\[\[SELFOS:CHALLENGE:(\{[\s\S]*?\})\]\]/g;
const CHALLENGE_PREFIX = '[[SELFOS:CHALLENGE:';

/** The agreed challenge a coach marker carries (raw, pre-normalization). `action` is required (§3.2). */
export interface ChallengeMarker {
  action: string;
  comfort?: number;
  lifeArea?: string;
  domain?: string;
  checkInDays?: number;
}

/**
 * Parse the LATEST `[[SELFOS:CHALLENGE:{…}]]` marker in a reply into a raw `ChallengeMarker`, or null if there
 * is none or it doesn't validate (tolerant — a malformed marker yields no challenge, spec 37). Server-side
 * normalization (LIFE_AREAS, domain enum, comfort/checkInDays clamping) happens in `captureFromMarker`.
 */
export function parseChallengeMarker(text: string): ChallengeMarker | null {
  const matches = [...text.matchAll(CHALLENGE_MARKER_RE)];
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
  const action = typeof obj.action === 'string' ? obj.action.trim() : '';
  if (!action) return null;
  const marker: ChallengeMarker = { action };
  if (typeof obj.comfort === 'number' && Number.isFinite(obj.comfort)) marker.comfort = obj.comfort;
  if (typeof obj.lifeArea === 'string' && obj.lifeArea.trim())
    marker.lifeArea = obj.lifeArea.trim();
  if (typeof obj.domain === 'string' && obj.domain.trim()) marker.domain = obj.domain.trim();
  if (typeof obj.checkInDays === 'number' && Number.isFinite(obj.checkInDays))
    marker.checkInDays = obj.checkInDays;
  return marker;
}

/**
 * Remove every challenge marker (and any trailing partial still mid-stream) from a reply, trimming trailing
 * whitespace — so the token never flashes during streaming or persists in the transcript.
 */
export function stripChallengeMarker(text: string): string {
  let out = text.replace(CHALLENGE_MARKER_RE, '');
  // Mid-stream the marker body may have arrived without its closing ']]' — drop from the prefix to the end.
  out = out.replace(/\[\[SELFOS:CHALLENGE:[\s\S]*$/, '');
  // …or a trailing partial of the prefix itself, e.g. '[[SELFOS:CHALL'.
  for (let i = CHALLENGE_PREFIX.length - 1; i > 0; i--) {
    const partial = CHALLENGE_PREFIX.slice(0, i);
    if (out.endsWith(partial)) {
      out = out.slice(0, -partial.length);
      break;
    }
  }
  return out.replace(/\s+$/, '');
}

/** Strip all coach markers (wrap-up + step + challenge + agreement) — the single fn the renderer + services use. */
export function stripCoachMarkers(text: string): string {
  return stripSuggestMarker(
    stripAgreementMarker(stripChallengeMarker(stripStepMarkers(stripWrapUpMarker(text)))),
  );
}
