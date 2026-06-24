/**
 * In-session proactivity (40-proactive-coaching §3.1). A guarded, prompt-level instruction — the sibling of
 * `depthAskInstruction` (29 §3.5) — that lets the LIVE coach proactively follow up on ONE of the person's
 * open / stale commitments (their spec-39 goals) when the conversation is naturally relevant. It is appended
 * AFTER persona + safety + context (it steers, never overrides — the boundary always leads), so the coach may
 * gently raise a goal at most once, then let it go.
 *
 * This is FREE — it rides the chat turn the user already pays for (no extra Claude call), exactly like the
 * depth-ask. The caller (the bridge chat handler) reads the per-person proactivity level + the open/stale goal
 * set and assembles it; when proactivity is `off` or there are no active goals, it isn't added (the builder
 * returns '' for an empty set; the caller skips it entirely when off).
 */

/** A bounded active commitment the coach may follow up on, in the person's own words. */
export interface GoalRaiseGoal {
  text: string;
  /** Derived-stale (past due / long untouched) — these are the prime, gentle follow-up candidates. */
  stale: boolean;
}

export interface GoalRaiseContext {
  /** The person's active (open / in-progress / stale) goals, already bounded + ordered by the caller. */
  goals: GoalRaiseGoal[];
  /** `active` makes the coach a touch more present; `gentle` (default) keeps it light. `off` never reaches here. */
  level?: 'gentle' | 'active';
}

/** How many goals to name in the instruction (bounded, like the rest of context). */
const MAX_NAMED = 5;

/**
 * Build the in-session goal-raise instruction. Returns '' when there's nothing active to raise (so the caller
 * adds nothing). Heavier/sensitive follow-ups defer to safety; the coach raises at most one, then drops it.
 */
export function goalRaiseInstruction(ctx: GoalRaiseContext): string {
  const goals = ctx.goals.slice(0, MAX_NAMED);
  if (goals.length === 0) return '';

  const named = goals.map((g) => `"${g.text}"${g.stale ? ' (set a while ago)' : ''}`).join(', ');
  const presence =
    ctx.level === 'active'
      ? 'You may be a little more present in following up'
      : 'Keep it light and unforced';

  return `This person has named some open commitments to themselves: ${named}. If — and ONLY if — this \
conversation is naturally about one of them (or a related struggle), you may gently check in on AT MOST ONE \
(in your own warm words, e.g. "last time you mentioned wanting to do that — how’s it been going?"), favouring \
one they set a while ago and haven’t returned to. ${presence}: offer it once, and if they don’t pick it up or \
say not now, let it go completely and stay with what they came to talk about — never turn the session into a \
progress review, never lecture, never list their goals back at them. This NEVER takes precedence over safety: \
if they express any distress or are working through something heavy, drop the check-in entirely and respond \
with care.`;
}
