import { uuid } from '../id';
import type { Question, SensitivityTier } from '../schemas';
import type { IntimacyTopics } from '../intimacy/topics';

/**
 * Deterministic **intimacy starter questions** (08-questionnaires §16.5b). When AI generation is asked
 * for an explicit/unfiltered intimacy questionnaire and the model declines to draft graphic sexual
 * content, we don't strand the Owner on "No usable questions" — we seed an editable set of frank,
 * consensual-adult starter questions instead, drawn from the same shared topic inventory the intake's
 * static intimacy block uses ([`18`](18-personal-onboarding.md), §14.13).
 *
 * These are templates, not model output: no AI spend, always available, fully editable in the builder.
 * The consensual-adult boundary is intrinsic — the questions only reference the curated topic inventory
 * (consenting adults; taboo themes as fantasy/roleplay only; never minors, real non-consent, or illegal).
 */

const q = (
  type: Question['type'],
  prompt: string,
  extra: Partial<Omit<Question, 'id' | 'type' | 'prompt'>> = {},
): Question => ({ id: uuid(), type, prompt, required: false, ...extra });

/**
 * Build a set of explicit, editable starter questions seeded by the merged topic inventory. `tier` only
 * tunes the wording's frankness; both tiers are explicit. The set is capped to `count` (default 6).
 */
export function intimacyStarterQuestions(
  topics: IntimacyTopics,
  tier: SensitivityTier,
  count = 6,
): Question[] {
  const activities = topics.activities.slice(0, 16);
  const fantasies = topics.fantasies.slice(0, 12);
  const frank = tier === 'unfiltered';

  const all: Question[] = [
    q('rating', 'How satisfied are you with your sex life right now?', {
      scale: { min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Completely' },
    }),
    activities.length >= 2
      ? q('multiChoice', "Which of these are you into? Pick everything that's a yes.", {
          options: activities,
        })
      : null,
    activities.length >= 2
      ? q('multiChoice', "What are you curious to try that we haven't?", { options: activities })
      : null,
    fantasies.length >= 2
      ? q('multiChoice', 'Which of these fantasies turn you on?', { options: fantasies })
      : null,
    q(
      'longText',
      frank
        ? 'Describe your ideal sexual encounter, start to finish, in as much explicit detail as you like.'
        : 'Describe your ideal intimate encounter, start to finish, in as much detail as you like.',
    ),
    q('longText', "What turns you on most that we don't do enough of?"),
    q('shortText', "What's a fantasy you've never told me?"),
    q('rating', 'How often do you want sex compared to how often we have it?', {
      scale: {
        min: 1,
        max: 5,
        minLabel: 'Much less',
        midLabel: 'About right',
        maxLabel: 'Much more',
      },
    }),
    activities.length >= 2
      ? q('multiChoice', "What's off the table for you — your hard limits?", {
          options: activities,
        })
      : null,
    q('longText', 'Is there anything about our sex life you wish you could change or bring up?'),
  ].filter((x): x is Question => x !== null);

  return all.slice(0, count);
}
