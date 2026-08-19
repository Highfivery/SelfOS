import { useNavigate } from 'react-router-dom';
import { Check, Clock, Lock } from 'lucide-react';
import { TEST_GROUP_LABELS, type TestSummary } from '@selfos/core/tests';
import type { TestResult } from '@shared/schemas';
import { Button, Card, Heading, SubscaleBar } from '../../../design-system/components';
import { TAKE_STEPS } from './takeSteps';
import { topSubscales, wellbeingDisplay } from './profile';
import { cardStateOf } from './testsHub';
import styles from './You.module.css';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/**
 * 74 §8.4 — the two privacy words are deliberately different and must not be flattened into one badge.
 * A spec-50 sensitive result really is own-context-only, so it keeps the stronger wording; an adaptive
 * intimacy profile is "yours" because what you love travels silently into a partner's coach, and the take's
 * own intro says so — this card must not contradict it one screen earlier.
 */
export function privacyWord(test: TestSummary): string | null {
  if (!test.sensitive) return null;
  return test.kind === 'adaptive' ? 'yours' : 'private — only you';
}

/** The meta line under the title: what the instrument is, and either its size or your history with it. */
function metaLine(test: TestSummary, results: TestResult[]): string {
  const privacy = privacyWord(test);
  const parts: string[] = [];
  const latest = results[0];
  // An adaptive take has no item count — `itemCount` is its BANK size (3,161 entries), not a question
  // count, so it must never be rendered as one (74). And once you've taken something, how many questions
  // it had stops being decision-information: it only lengthens the line and wraps the card.
  if (test.kind === 'adaptive') parts.push('Adapts as you go');
  else if (latest === undefined) parts.push(`${test.instrument} · ${test.itemCount} questions`);
  else parts.push(test.instrument);

  if (latest !== undefined) {
    const takes = results.length;
    const noun = test.wellbeing ? 'check-in' : 'take';
    parts.push(`${takes} ${noun}${takes === 1 ? '' : 's'}`);
    parts.push(`last ${formatDate(latest.takenAt)}`);
  }
  if (privacy !== null) parts.push(privacy);
  return parts.join(' · ');
}

interface TestCardProps {
  test: TestSummary;
  results: TestResult[];
  now: number;
}

/**
 * One instrument in the catalog grid — the SAME component in every state (50 §3.1). An untaken card is an
 * invitation; a taken card is your result; a due card is a taken card whose gentle re-check window has
 * passed. The difference is carried by form — a stripe, a pill, and what fills the body — never by size,
 * so the grid stays scannable and nothing reshapes as you work through it.
 */
export function TestCard({ test, results, now }: TestCardProps): JSX.Element {
  const navigate = useNavigate();
  const state = cardStateOf(test, results, now);
  const latest = results[0];
  const adaptive = test.kind === 'adaptive';

  const wb = test.wellbeing && latest ? wellbeingDisplay(test, latest.scores) : undefined;
  const top = !test.wellbeing && latest ? topSubscales(test, latest.scores, 2) : [];

  const takeLabel = test.wellbeing ? 'Check in' : adaptive ? 'Start' : 'Take';
  const againLabel = test.wellbeing ? 'Check in again' : adaptive ? 'Keep marking' : 'Retake';
  const open = (): void => navigate(`/tests/${test.id}`);
  const take = (): void => navigate(`/tests/${test.id}/take`);
  /**
   * Straight to "keep what you marked, or start fresh?" — the question a retake actually poses (74 §3.6.15).
   *
   * Only ever from a TAKEN card. Carrying retake intent into a FIRST take looks harmless but is not: the
   * take screen maps `done` → `map` whenever the flag is set, so the flag would suppress the redirect to the
   * report at the END of that very take, leaving the person parked on the map after finishing.
   */
  const again = (): void => navigate(`/tests/${test.id}/take`, { state: { retake: true } });

  const stripe = state === 'due' ? styles.cardDue : adaptive ? styles.cardAdaptive : '';

  return (
    <Card className={`${styles.card} ${stripe}`} role="listitem" aria-label={test.title}>
      <div className={styles.cardTop}>
        <span className={styles.tag}>{TEST_GROUP_LABELS[test.group]}</span>
        {test.adult ? (
          <span className={styles.adultPill}>
            <Lock size={11} aria-hidden="true" /> 18+
          </span>
        ) : null}
        {state === 'untaken' ? (
          <span className={styles.pill}>
            <Clock size={12} aria-hidden="true" /> {test.estimatedMinutes} min
          </span>
        ) : state === 'due' ? (
          <span className={`${styles.pill} ${styles.pillDue}`}>
            <Clock size={12} aria-hidden="true" /> Due
          </span>
        ) : (
          <span className={`${styles.pill} ${styles.pillTaken}`}>
            <Check size={12} aria-hidden="true" /> {adaptive ? 'Started' : 'Taken'}
          </span>
        )}
      </div>

      <Heading level={3} className={styles.cardTitle}>
        {test.title}
      </Heading>
      <p className={styles.cardMeta}>{metaLine(test, results)}</p>

      {state === 'untaken' ? (
        <p className={styles.cardBlurb}>{test.blurb}</p>
      ) : wb ? (
        // 51 §8.1 — the GENTLE range sentence, never the internal clinical band and never a score.
        <p className={styles.cardGentle}>{wb.display}</p>
      ) : top.length > 0 ? (
        <div className={styles.cardBars}>
          {top.map((s) => (
            <SubscaleBar
              key={s.key}
              label={s.label}
              normalized={s.normalized}
              band={s.band}
              signed={s.signed}
            />
          ))}
        </div>
      ) : null}

      {/* The shape of an adaptive take, shown only as an INVITATION. Never a progress meter: a take that
          can always be added to has no "done", so this describes the take's structure, not your position
          in it (the durable never-show-complete rule, and 74 — an adaptive take never finishes). */}
      {/* `TAKE_STEPS` is the Dirty Talk phase model (74 §3.6.9), the only adaptive instrument today. A
          second one would need its own step source before this could be shown for it. */}
      {adaptive && test.id === 'dirty-talk' && state === 'untaken' ? (
        <div className={styles.pips}>
          <span className={styles.pipRow} aria-hidden="true">
            {TAKE_STEPS.map((step) => (
              <i key={step.id} />
            ))}
          </span>
          <span>{TAKE_STEPS.length} steps</span>
        </div>
      ) : null}

      <div className={styles.cardActions}>
        {state === 'untaken' ? (
          <Button variant="primary" onClick={take}>
            {takeLabel}
          </Button>
        ) : state === 'due' ? (
          <>
            <Button variant="primary" onClick={again}>
              {takeLabel}
            </Button>
            <Button variant="ghost" onClick={open}>
              Open
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={open}>
              Open
            </Button>
            <Button variant="ghost" onClick={again}>
              {againLabel}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

/** Exported for the hub's tests — the copy a card shows for an instrument in a given state. */
export const __testables = { metaLine, privacyWord };
