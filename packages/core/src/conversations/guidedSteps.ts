/**
 * Turn-embedded step tracking for structured guided exercises (16-guided-sessions §3.3). Like the wrap-up
 * marker, the coach is taught (in the exercise's prompt) to silently append a private marker naming the
 * step it has moved onto. The chat-turn orchestrator parses the latest one to advance `guideStep`, strips
 * every marker from the saved + streamed text, and the user never sees it. No extra model call, and free
 * input is never blocked — the stepper is best-effort orientation, not a gate.
 */

import { stripWrapUpMarker } from './wrapUp';

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

/** Strip both coach markers (wrap-up + step) — the single function the renderer + service use on replies. */
export function stripCoachMarkers(text: string): string {
  return stripStepMarkers(stripWrapUpMarker(text));
}
