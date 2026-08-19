import { useNavigate } from 'react-router-dom';
import { Check, Clock, Lock } from 'lucide-react';
import type { TestSummary } from '@selfos/core/tests';
import type { TestResult, TestSubscaleScore } from '@shared/schemas';
import { Button, Card, Heading, SubscaleBar } from '../../../design-system/components';
import { TAKE_STEPS } from './takeSteps';
import { wellbeingDisplay } from './profile';
import { barsReading, drawsReading, readingKindFor, spectrumReading } from './cardReading';
import { FILTER_GROUP_LABELS, cardStateOf } from './testsHub';
import styles from './You.module.css';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Day + month only, and the year only when it isn't this one — the full `6/26/2026` is what wraps the
  // meta line at card width.
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
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
        <span className={styles.tag}>{FILTER_GROUP_LABELS[test.group]}</span>
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
      ) : (
        <TakenReading test={test} scores={latest?.scores ?? []} />
      )}

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

/**
 * What a taken card shows, chosen by the instrument's SHAPE (50 §3.1). A bipolar instrument gets a position
 * on a named spectrum plus the one line its grid exists to produce; a many-facet one gets its leading facets
 * by name; everything else gets compact bars. All three read only subscales with signal — an unrated one
 * floors to its minimum, and stating that floor is the §8.1a bug.
 */
function TakenReading({
  test,
  scores,
}: {
  test: TestSummary;
  scores: TestSubscaleScore[];
}): JSX.Element | null {
  const kind = readingKindFor(test);

  if (kind === 'spectrum') {
    const reading = spectrumReading(test, scores);
    if (!reading) return <NothingRated />;
    return (
      <div>
        <span className={styles.readKicker}>Where you sit</span>
        <div className={styles.readFinding}>{capitalize(reading.band)}</div>
        <div className={styles.spectrum}>
          <div className={styles.spectrumTrack}>
            <span className={styles.spectrumTick} aria-hidden="true" />
            <span
              className={styles.spectrumDot}
              style={{ left: `${Math.round(reading.position * 100)}%` }}
              aria-hidden="true"
            />
          </div>
          {reading.poles.left && reading.poles.right ? (
            <div className={styles.spectrumEnds}>
              <span>{reading.poles.left}</span>
              <span>{reading.poles.right}</span>
            </div>
          ) : null}
        </div>
        {reading.divergence ? <p className={styles.divergence}>{reading.divergence}</p> : null}
      </div>
    );
  }

  if (kind === 'draws') {
    const reading = drawsReading(test, scores);
    if (!reading) return <NothingRated />;
    return (
      <div>
        <span className={styles.readKicker}>
          Strongest draws · of {reading.rated} {reading.rated === 1 ? 'area' : 'areas'} you rated
        </span>
        <ul className={styles.draws}>
          {reading.draws.map((draw) => (
            <li key={draw.key} className={styles.draw}>
              <span className={styles.drawName}>{draw.label}</span>
              <span className={styles.drawBar} aria-hidden="true">
                <i style={{ width: `${Math.round(draw.strength * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const bars = barsReading(test, scores);
  if (bars.length === 0) return <NothingRated />;
  return (
    <div className={styles.cardBars}>
      {bars.map((s) => (
        <SubscaleBar
          key={s.key}
          label={s.label}
          normalized={s.normalized}
          band={s.band}
          signed={s.signed}
        />
      ))}
    </div>
  );
}

/** Taken, but nothing was actually rated — said plainly rather than charted as a floor of zero. */
function NothingRated(): JSX.Element {
  return <p className={styles.cardGentle}>Nothing rated yet — open it to fill it in.</p>;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Exported for the hub's tests — the copy a card shows for an instrument in a given state. */
export const __testables = { metaLine, privacyWord };
