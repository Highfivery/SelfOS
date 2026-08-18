import { Check, Minus, Sparkles } from 'lucide-react';
import { Button, Card, Heading, Text } from '../../../design-system/components';
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
export function TakeMap({
  statuses,
  resuming,
  onGo,
  onStart,
  onAbandon,
  busy,
}: {
  statuses: readonly StepStatus[];
  /** A take with work already in it — the copy leads with picking up rather than beginning. */
  resuming: boolean;
  onGo: (id: StepId) => void;
  onStart: () => void;
  onAbandon: (() => void) | null;
  busy: boolean;
}): JSX.Element {
  const nextUp =
    statuses.find((status) => status.state === 'now') ??
    statuses.find((status) => status.state === 'open') ??
    statuses[0];
  const marked = statuses.reduce((sum, status) => sum + status.count, 0);

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
                        ? `done · ${status.count}`
                        : state === 'skipped'
                          ? 'skipped'
                          : state === 'blocked'
                            ? (status.reason ?? 'not yet')
                            : status.outstanding
                              ? `${status.outstanding} new to do`
                              : status.fresh !== undefined
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
