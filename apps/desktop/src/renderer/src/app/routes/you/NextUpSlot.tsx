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
  const { test, reason, lastAt, started } = next;
  if (reason === 'due') {
    // A `due` pick is >= the re-check window by definition, so there is always a number to state.
    const days = daysSince(lastAt ?? '', now);
    return `It's been ${days} days since your last one. ${shapeLine(test)}`;
  }
  if (started === true) {
    // Re-pitching a take someone has already opened reads as though the app forgot. The honest reason it is
    // still on offer is that it does not finish.
    return 'It never really finishes — there is always more to mark, and each pass sharpens what SelfOS says back to you.';
  }
  return `${test.blurb} ${shapeLine(test)}`;
}

/**
 * One panel of the lead zone (50 §3.1), of at most two. They fill in priority order: the check-ins you're
 * overdue for, then the adaptive flagship — offered whether or not it has been started, because it never
 * finishes — then the shortest thing untried. It is an invitation, not a queue — there is no count of what's
 * left here and no sense of a finish line; the stat strip carries the numbers.
 *
 * The accent means "this is the action". The `due` variant tints warm because being overdue is a state, not
 * a different action — the button stays the standard accent so one hue never carries two meanings.
 */
export function NextUpSlot({ next, now }: { next: NextUp; now: number }): JSX.Element {
  const navigate = useNavigate();
  const { test, reason, started } = next;
  const due = reason === 'due';
  const privacy = privacyWord(test);
  // A flagship already under way is picked back up, not started — the same words its card uses.
  const cta = started
    ? 'Keep marking'
    : test.wellbeing
      ? 'Check in'
      : test.kind === 'adaptive'
        ? 'Start'
        : 'Take';
  const kicker = due ? 'Next for you' : started ? 'Keep going' : 'Start here';

  return (
    // Named by its instrument: two panels sharing one region name is ambiguous to a screen reader, and to
    // any test that has to tell them apart.
    <section
      className={`${styles.next} ${due ? styles.nextDue : ''}`}
      aria-label={`${kicker}: ${test.title}`}
    >
      <span className={styles.nextTile} aria-hidden="true">
        {due ? <Clock size={22} /> : <Compass size={22} />}
      </span>
      <div className={styles.nextText}>
        <span className={styles.nextKicker}>{kicker}</span>
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
            navigate(
              `/tests/${test.id}/take`,
              due || started ? { state: { retake: true } } : undefined,
            )
          }
        >
          {cta} <ArrowRight size={15} aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
