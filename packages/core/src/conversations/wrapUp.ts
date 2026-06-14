/**
 * Turn-embedded "this session feels wrapped up" signal (09-session-analysis §14.1). Rather than a second
 * Claude call, the coach is invited (in the system prompt) to end its reply with a private marker token
 * when the conversation has reached a natural, satisfying stopping point. The chat-turn orchestrator
 * detects the marker, strips it from the saved + streamed text, and surfaces a `wrapUpSuggested` hint — so
 * the user gets a gentle "mark complete & summarize?" prompt at no extra spend, and never sees the token.
 */

/** The private signal token the coach may append. Deliberately unlikely to occur in natural prose. */
export const WRAP_UP_MARKER = '[[SELFOS:WRAPUP]]';

/** The system-prompt instruction that teaches the coach the marker convention (chat sessions only). */
export const WRAP_UP_INSTRUCTION = `Privately, if (and only if) this conversation has reached a natural, \
satisfying stopping point — the person seems resolved, ready to close, or you've reached a clear ending — \
append the exact token ${WRAP_UP_MARKER} as the very last thing in your reply, on its own. This token is a \
silent signal to the app; it is never shown to the person, so never mention it, explain it, or use it mid-\
conversation. If the conversation is still open or ongoing, do not include it.`;

/**
 * Remove the wrap-up marker (and any trailing partial marker still mid-stream) from a reply, trimming
 * trailing whitespace. Safe to call on every streaming delta-accumulation so the token never flashes.
 */
export function stripWrapUpMarker(text: string): string {
  let out = text.split(WRAP_UP_MARKER).join('');
  // Mid-stream the marker may have only partially arrived — drop a trailing prefix of it too.
  for (let i = WRAP_UP_MARKER.length - 1; i > 0; i--) {
    const partial = WRAP_UP_MARKER.slice(0, i);
    if (out.endsWith(partial)) {
      out = out.slice(0, -partial.length);
      break;
    }
  }
  return out.replace(/\s+$/, '');
}
