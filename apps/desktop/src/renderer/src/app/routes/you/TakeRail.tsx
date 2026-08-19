import { Check, Lock, Minus, Sparkles } from 'lucide-react';
import { AdminOnlyBadge, Button, Card, Text } from '../../../design-system/components';
import type { StepId, StepStatus } from './takeSteps';
import adaptive from './Adaptive.module.css';

/**
 * 74 §3.6.9 — the step rail, on every step of the take.
 *
 * It is the whole answer to "there's no indication what comes after this": the seven steps are visible from the
 * first screen to the last, each carrying its state and its own count, and any reachable one is a tap away. A
 * blocked step is a disabled row with its reason attached rather than a live button into a dead end.
 */

const PIP: Record<StepStatus['state'], JSX.Element | number | null> = {
  done: <Check size={11} aria-hidden="true" />,
  skipped: <Minus size={11} aria-hidden="true" />,
  now: null,
  open: null,
  blocked: null,
};

/**
 * What the row says after its label. One unit for every step — marks made in it — so they compare.
 *
 * A blocked step gets a LOCK, not its sentence: "Needs some marks first" squashed the labels to "Hear …",
 * "Li…", "Its…" — the trailing text winning over the thing it was attached to. The reason is on the row's
 * accessible name and in full on the map, which has the room for it.
 */
function trailing(status: StepStatus): string | null {
  if (status.state === 'skipped') return 'skipped';
  if (status.state === 'blocked') return null;
  // A retake opens with last time's marks already on record, so one number would be standing for the other.
  if (status.fresh) return `${status.count} · ${status.fresh} today`;
  // A denominator where there is one — "2 of 6" moments, not a bare "2" that names nothing.
  if (status.outOf) return `${status.count} of ${status.outOf}`;
  // …otherwise the unit, because 132 next to 6 next to 8 is three different things wearing one number.
  if (status.count > 0)
    return status.unit ? `${status.count} ${status.unit}` : String(status.count);
  return null;
}

export function TakeRail({
  statuses,
  onGo,
  actions,
  saveState,
  extra,
  spendUsd,
}: {
  statuses: readonly StepStatus[];
  onGo: (id: StepId) => void;
  /** The step's own verbs — Next / Skip / Finish — which live under the rail, not scattered per phase. */
  actions: JSX.Element;
  saveState?: JSX.Element | null;
  /** The step's own running state (a marks tally), above the steps it belongs to. */
  extra?: JSX.Element | null;
  /**
   * 74 §3.6.21 — what this take has cost so far.
   *
   * ADMIN-ONLY BY CONSTRUCTION: `costUsd` is redacted at the bridge for anyone without `budgets.manage`
   * (the durable 06 rule — the $ boundary is the bridge, not the UI), so the field being present IS the
   * gate. Undefined renders nothing.
   *
   * The take is the most expensive thing in SelfOS and every step described its price as "a little of your
   * AI allowance" — an adjective, seven times over, while the real running total sat on the draft unread.
   */
  spendUsd?: number | undefined;
}): JSX.Element {
  return (
    <aside className={adaptive.rail} aria-label="The steps, and where to go next">
      {/*
       * The VERBS come first, then the tally, then the steps. Order matters here for a mechanical reason: this
       * column is sticky, and an area runs to 47 rows — if the actions sit under a tally and seven step rows,
       * they are below the fold before any scrolling has happened, which is the exact "finishing means scrolling
       * back through everything you already decided" problem the rail was built to remove.
       */}
      <Card className={adaptive.railCard}>
        <div className={adaptive.railActions}>{actions}</div>
        {saveState ? <div className={adaptive.railSaved}>{saveState}</div> : null}
      </Card>
      {spendUsd !== undefined ? (
        <Card className={adaptive.railCard}>
          <div className={adaptive.railHead}>This take</div>
          <div className={adaptive.spendRow}>
            <Text as="span" size="sm" tone="secondary">
              Spent so far
            </Text>
            <b>${spendUsd.toFixed(2)}</b>
          </div>
          <AdminOnlyBadge />
        </Card>
      ) : null}
      {extra ?? null}
      <Card className={`${adaptive.railCard} ${adaptive.railSteps}`}>
        <div className={adaptive.railHead}>The steps</div>
        <ol className={adaptive.stepList} aria-label="Steps">
          {statuses.map((status, index) => {
            const { step, state } = status;
            const label = trailing(status);
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className={`${adaptive.stepRow} ${adaptive[`step_${state}`]}`}
                  aria-current={state === 'now' ? 'step' : undefined}
                  aria-label={
                    state === 'blocked' && status.reason
                      ? `${step.label} — ${status.reason}`
                      : step.label
                  }
                  disabled={state === 'blocked'}
                  onClick={() => onGo(step.id)}
                >
                  <span className={adaptive.stepPip} aria-hidden="true">
                    {PIP[state] ?? index + 1}
                  </span>
                  <span className={adaptive.stepLabel}>{step.short}</span>
                  {step.ai ? (
                    <Sparkles size={11} className={adaptive.stepAi} aria-label="uses AI" />
                  ) : null}
                  {state === 'blocked' ? (
                    <Lock size={11} className={adaptive.stepLock} aria-hidden="true" />
                  ) : label ? (
                    <span className={adaptive.stepCount}>{label}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </Card>
    </aside>
  );
}

/**
 * The three verbs every step ends with, in one place so no step invents its own vocabulary. The middle one is
 * what makes the whole thing navigable: any step can be passed over, and the profile then says it was.
 */
export function StepActions({
  next,
  onNext,
  onSkip,
  onFinish,
  busy,
  nextLabel,
}: {
  next: StepStatus | null;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
  busy: boolean;
  /** Overrides "Next: <step>" where the step's own primary action is more specific ("Done with names"). */
  nextLabel?: string;
}): JSX.Element {
  return (
    <>
      {next ? (
        <Button variant="primary" disabled={busy} onClick={onNext}>
          {nextLabel ?? `Next: ${next.step.label.toLowerCase()} →`}
        </Button>
      ) : null}
      <Button variant="ghost" disabled={busy} onClick={onSkip}>
        Skip this step
      </Button>
      {/* On the last step, "Next: your profile" IS the finish — rendering both would be one action wearing two
          labels, which is how a flow starts reading as two different things (the §7 coherence rule). */}
      {next?.step.id === 'profile' ? null : (
        <Button variant="ghost" disabled={busy} onClick={onFinish}>
          Finish — show me my profile
        </Button>
      )}
    </>
  );
}

/**
 * The running tally, above the steps in the rail. It makes a partial pass visibly worth something (§3.6.1 #3),
 * and it is shared between the names and the words so the two marking steps read as one test.
 */
export function Tally({
  counts,
  label,
  note,
  testIdPrefix,
}: {
  counts: { love: number; okay: number; never: number };
  label: string;
  note?: string;
  testIdPrefix: string;
}): JSX.Element {
  const rows: { key: keyof typeof counts; label: string }[] = [
    { key: 'love', label: 'love it' },
    { key: 'okay', label: "it's okay" },
    { key: 'never', label: 'never' },
  ];
  return (
    <Card className={adaptive.railCard}>
      <div className={adaptive.railHead}>{label}</div>
      <div className={adaptive.tally}>
        {rows.map((row) => (
          <div
            key={row.key}
            className={adaptive.tallyRow}
            data-testid={`${testIdPrefix}-${row.key}`}
          >
            <span className={`${adaptive.dot} ${adaptive[row.key]}`} aria-hidden="true" />
            <span className={adaptive.tallyLabel}>{row.label}</span>
            <b>{counts[row.key]}</b>
          </div>
        ))}
      </div>
      {note ? (
        <div className={adaptive.tallyNote}>
          <Text size="sm" tone="tertiary">
            {note}
          </Text>
        </div>
      ) : null}
    </Card>
  );
}

/** The one-line "where you are" the frames put above their own heading. */
export function StepEyebrow({
  status,
  total,
  index,
}: {
  status: StepStatus;
  total: number;
  index: number;
}): JSX.Element {
  return (
    <div className={adaptive.stepEyebrow}>
      <Text as="span" size="sm" tone="tertiary">
        Step {index + 1} of {total}
      </Text>
      {status.step.ai ? (
        <span className={adaptive.aiTag}>
          <Sparkles size={11} aria-hidden="true" /> uses AI
        </span>
      ) : null}
    </div>
  );
}
