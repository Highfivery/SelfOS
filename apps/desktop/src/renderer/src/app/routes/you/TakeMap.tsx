import { useState } from 'react';
import { Check, Minus, Sparkles } from 'lucide-react';
import { Button, Card, Heading, Text } from '../../../design-system/components';
import { markCount } from './takeSteps';
import type { StepId, StepStatus } from './takeSteps';
import adaptive from './Adaptive.module.css';

/**
 * 74 §3.6.9 — the map: the whole test on one screen, shown on the way in and again on the way back.
 *
 * Opening the take used to say "What do you call each other?" and give no indication that six more things
 * followed — and coming back through "pick up where you left off" dropped straight into whichever AI phase had
 * been reached, with no route back to the words or the names. This is the screen that fixes both: every step,
 * what it asks, whether it spends, what you have already done in it, and a tap into any of them.
 */
/**
 * What a finished step says after its label. Three steps — who you two are, the split, and the profile —
 * have nothing countable: their "done" is HAVING ANSWERED, so `count` is 0 and the row read "done · 0",
 * a number of nothing.
 *
 * And where there IS a count it needs its unit, which is what `StepStatus.unit` was added for: 132 marks
 * beside 6 answered questions beside 8 moment picks is three different things wearing one bare number. The
 * rail already does this; the map never did.
 */
function doneLabel(status: StepStatus): string {
  if (status.count <= 0) return 'done';
  return status.unit ? `done · ${status.count} ${status.unit}` : `done · ${status.count}`;
}

export function TakeMap({
  statuses,
  resuming,
  onGo,
  onStart,
  onAbandon,
  busy,
  retake,
}: {
  statuses: readonly StepStatus[];
  /** A take with work already in it — the copy leads with picking up rather than beginning. */
  resuming: boolean;
  onGo: (id: StepId) => void;
  onStart: () => void;
  onAbandon: (() => void) | null;
  busy: boolean;
  /**
   * 74 §3.6.10 — a RETAKE (a finished profile already exists) asks first, before anything else: keep what is
   * on record and edit it, or start from an empty sheet. Owner-directed. Without it, tapping Retake silently
   * loaded every previous answer and the only way to a clean run was a destructive button at the bottom of a
   * screen nobody scrolls to.
   */
  retake: { onKeep: () => void; onFresh: () => void } | null;
}): JSX.Element {
  const nextUp =
    statuses.find((status) => status.state === 'now') ??
    statuses.find((status) => status.state === 'open') ??
    statuses[0];
  // 74 §3.6.34 — MARKS, not everything countable (`markCount`, beside the units that define it).
  const marked = markCount(statuses);

  if (retake) return <RetakeChoice marked={marked} busy={busy} {...retake} />;

  return (
    <div className={adaptive.mapWrap}>
      <div className={adaptive.mapHead}>
        <Heading level={2}>{resuming ? 'Where you got to' : "What's in this"}</Heading>
        <Text tone="secondary">
          {resuming
            ? `${marked} marks so far. Pick up where you left off, or jump to any step — nothing here has to be done in order.`
            : 'Seven steps. Do them in order or not, skip any of them, and stop whenever — every tap saves itself.'}
        </Text>
      </div>

      <ol className={adaptive.mapList} aria-label="Every step">
        {statuses.map((status, index) => {
          const { step, state } = status;
          return (
            <li key={step.id}>
              <button
                type="button"
                className={`${adaptive.mapRow} ${adaptive[`map_${state}`]}`}
                disabled={state === 'blocked'}
                onClick={() => onGo(step.id)}
                aria-current={state === 'now' ? 'step' : undefined}
              >
                <span className={adaptive.mapPip} aria-hidden="true">
                  {state === 'done' ? (
                    <Check size={13} />
                  ) : state === 'skipped' ? (
                    <Minus size={13} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className={adaptive.mapBody}>
                  <span className={adaptive.mapTop}>
                    <b>{step.label}</b>
                    {step.ai ? (
                      <span className={adaptive.aiTag}>
                        <Sparkles size={11} aria-hidden="true" /> uses AI
                      </span>
                    ) : null}
                    <span className={adaptive.mapState}>
                      {state === 'done' && status.fresh === undefined
                        ? doneLabel(status)
                        : state === 'skipped'
                          ? 'skipped'
                          : state === 'blocked'
                            ? (status.reason ?? 'not yet')
                            : status.fresh
                              ? `${status.count} on record · ${status.fresh} today`
                              : status.count > 0
                                ? `${status.count} so far`
                                : 'not started'}
                    </span>
                  </span>
                  <span className={adaptive.mapBlurb}>{step.blurb}</span>
                  {step.note ? <span className={adaptive.mapNote}>{step.note}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className={adaptive.mapActions}>
        <Button variant="primary" disabled={busy} onClick={onStart}>
          {resuming
            ? `Pick up: ${nextUp?.step.label.toLowerCase() ?? 'the names'} →`
            : `Start: ${nextUp?.step.label.toLowerCase() ?? 'the names'} →`}
        </Button>
      </div>

      {/* Out of the rail and down here, quiet, behind its own confirm: it wipes everything for this person now,
          hard nos included, and a destructive action does not belong shoulder to shoulder with the button
          everybody taps. */}
      {onAbandon ? (
        <Card className={adaptive.mapDanger}>
          <Text size="sm" tone="secondary">
            <b>Start over from the top.</b> Clears every mark, every split and every hard no for
            this test — you begin from an empty sheet.
          </Text>
          <Button variant="ghost" disabled={busy} onClick={onAbandon}>
            Start over from the top
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The first thing a retake shows. Two real options, each saying what it does to what is on record — the
 * destructive one is never the default and never one tap.
 */
function RetakeChoice({
  marked,
  busy,
  onKeep,
  onFresh,
}: {
  marked: number;
  busy: boolean;
  onKeep: () => void;
  onFresh: () => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={adaptive.mapWrap}>
      <div className={adaptive.mapHead}>
        <Heading level={2}>Taking it again</Heading>
        <Text tone="secondary">
          You have {marked} marks on record from last time. Build on them, or start from an empty
          sheet — either way this is a new take, so your profile can show what changed.
        </Text>
      </div>

      <Card className={adaptive.retakeCard}>
        <div>
          <Heading level={3}>Keep what you marked</Heading>
          <Text size="sm" tone="secondary">
            Everything you said last time is already filled in. Change your mind about any of it,
            add what you skipped, and leave the rest alone.
          </Text>
        </div>
        <Button variant="primary" disabled={busy} onClick={onKeep}>
          Keep and edit →
        </Button>
      </Card>

      <Card className={adaptive.retakeCard}>
        <div>
          <Heading level={3}>Start fresh</Heading>
          <Text size="sm" tone="secondary">
            Clears every mark, every split and <b>every hard no</b> for this test — the suppression
            list goes with them. Who you both are stays; you won&rsquo;t answer that again.
          </Text>
        </div>
        {confirming ? (
          <div className={adaptive.retakeConfirm}>
            <Button variant="secondary" disabled={busy} onClick={onFresh}>
              Yes, clear it all
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Never mind
            </Button>
          </div>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
            Start fresh
          </Button>
        )}
      </Card>
    </div>
  );
}
