import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, Compass, Lock } from 'lucide-react';
import { Button, Heading } from '../../../design-system/components';
import { daysSince } from '../home/wellbeing';
import { privacyWord } from './TestCard';
import type { NextUp } from './testsHub';
import styles from './You.module.css';

/**
 * How long this takes, in the instrument's own terms. An ADAPTIVE take has no item count — `itemCount` is
 * its bank inventory (3,161 entries), never a question count — so the branch is on `kind`, never on why the
 * slot picked it.
 */
function shapeLine(test: NextUp['test']): string {
  return test.kind === 'adaptive'
    ? `About ${test.estimatedMinutes} minutes, and it adapts as you go.`
    : `About ${test.estimatedMinutes} minutes, ${test.itemCount} questions.`;
}

/** The one-line reason this instrument is being offered — composed from catalog facts, never invented. */
function reasonLine(next: NextUp, now: number): string {
  const { test, reason, lastAt } = next;
  if (reason === 'due') {
    // A `due` pick is >= the re-check window by definition, so there is always a number to state.
    const days = daysSince(lastAt ?? '', now);
    return `It's been ${days} days since your last one. ${shapeLine(test)}`;
  }
  return `${test.blurb} ${shapeLine(test)}`;
}

/**
 * The rotating lead slot (50 §3.1). It offers ONE thing: the check-in you're overdue for, else the adaptive
 * flagship, else the shortest thing untried. It is an invitation, not a queue — there is no count of what's
 * left here and no sense of a finish line; the stat strip carries the numbers.
 *
 * The accent means "this is the action". The `due` variant tints warm because being overdue is a state, not
 * a different action — the button stays the standard accent so one hue never carries two meanings.
 */
export function NextUpSlot({ next, now }: { next: NextUp; now: number }): JSX.Element {
  const navigate = useNavigate();
  const { test, reason } = next;
  const due = reason === 'due';
  const privacy = privacyWord(test);
  const cta = test.wellbeing ? 'Check in' : test.kind === 'adaptive' ? 'Start' : 'Take';

  return (
    <section className={`${styles.next} ${due ? styles.nextDue : ''}`} aria-label="Next for you">
      <span className={styles.nextTile} aria-hidden="true">
        {due ? <Clock size={22} /> : <Compass size={22} />}
      </span>
      <div className={styles.nextText}>
        <span className={styles.nextKicker}>{due ? 'Next for you' : 'Start here'}</span>
        <span className={styles.nextTitleRow}>
          <Heading level={2} className={styles.nextTitle}>
            {test.title}
          </Heading>
          {test.adult ? (
            <span className={styles.adultPill}>
              <Lock size={11} aria-hidden="true" /> 18+
            </span>
          ) : null}
          {privacy !== null ? <span className={styles.nextPrivacy}>{privacy}</span> : null}
        </span>
        <p className={styles.nextLine}>{reasonLine(next, now)}</p>
      </div>
      <div className={styles.nextActions}>
        <Button
          variant="primary"
          onClick={() =>
            navigate(`/tests/${test.id}/take`, due ? { state: { retake: true } } : undefined)
          }
        >
          {cta} <ArrowRight size={15} aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
