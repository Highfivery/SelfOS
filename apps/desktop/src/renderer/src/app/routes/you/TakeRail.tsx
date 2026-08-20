import { Check, LayoutGrid, Lock, Minus, Sparkles } from 'lucide-react';
import { AdminOnlyBadge, Button, Card, Text } from '../../../design-system/components';
import type { StepId, StepStatus } from './takeSteps';
import adaptive from './Adaptive.module.css';

/**
 * 74 §3.6.9/§3.6.30 — the step rail, on every step of the take.
 *
 * It is the whole answer to "there's no indication what comes after this": the seven steps are visible from the
 * first screen to the last, each carrying its state and its own count, and any reachable one is a tap away. A
 * blocked step is a disabled row with its reason attached rather than a live button into a dead end.
 *
 * §3.6.30 rebuilt it as ONE card of sections rather than four stacked cards, and gave it the thing it never
 * had: a way back to the MAP from every screen. Four cards meant four borders, four paddings and four headings
 * of chrome above the steps, which is what pushed the list itself down the column.
 */

const PIP: Record<StepStatus['state'], JSX.Element | number | null> = {
  done: <Check size={11} aria-hidden="true" />,
  skipped: <Minus size={11} aria-hidden="true" />,
  now: null,
  open: null,
  blocked: null,
};

/**
 * What the row says after its label.
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
  onMap,
  actions,
  saveState,
  extra,
  spendUsd,
}: {
  statuses: readonly StepStatus[];
  onGo: (id: StepId) => void;
  /**
   * 74 §3.6.30 — back to the map, from every screen of the take.
   *
   * The map was reachable on the way in and on the way back out and nowhere in between, so a person part-way
   * through had the seven steps listed beside them and no way to reach the screen that explains what they
   * are. It leads the rail because it is the one control that is the same on every step.
   */
  onMap: () => void;
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
   */
  spendUsd?: number | undefined;
}): JSX.Element {
  const at = statuses.findIndex((status) => status.state === 'now');
  return (
    <aside className={adaptive.rail} aria-label="The steps, and where to go next">
      <Card className={`${adaptive.railCard} ${adaptive.railUnified}`}>
        <button type="button" className={adaptive.railMap} onClick={onMap}>
          <span className={adaptive.railMapIcon} aria-hidden="true">
            <LayoutGrid size={12} />
          </span>
          <span className={adaptive.railMapLabel}>All steps</span>
          {at >= 0 ? (
            <span className={adaptive.railMapAt} aria-hidden="true">
              {at + 1} / {statuses.length}
            </span>
          ) : null}
        </button>
        {/*
         * The VERBS come first, then the tally, then the steps. Order matters here for a mechanical reason:
         * this column is sticky, and an area runs to 47 rows — if the actions sit under a tally and seven step
         * rows, they are below the fold before any scrolling has happened, which is the exact "finishing means
         * scrolling back through everything you already decided" problem the rail was built to remove.
         */}
        <div className={adaptive.railSection}>
          <div className={adaptive.railActions}>{actions}</div>
          {saveState ? <div className={adaptive.railSaved}>{saveState}</div> : null}
        </div>
        {extra ? <div className={adaptive.railSection}>{extra}</div> : null}
        <div className={`${adaptive.railSection} ${adaptive.railSteps}`}>
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
        </div>
        {spendUsd !== undefined ? (
          <div className={adaptive.railFoot}>
            <AdminOnlyBadge />
            <Text as="span" size="sm" tone="tertiary">
              This take
            </Text>
            <b>${spendUsd.toFixed(2)}</b>
          </div>
        ) : null}
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
        {/* ONE child — `Button` is a flex row with a gap, so a two-node label doubles it (74 §3.6.13). */}
        <span>
          Skip<span className={adaptive.verbLong}> this step</span>
        </span>
      </Button>
      {/* On the last step, "Next: your profile" IS the finish — rendering both would be one action wearing two
          labels, which is how a flow starts reading as two different things (the §7 coherence rule). */}
      {next?.step.id === 'profile' ? null : (
        <Button variant="ghost" disabled={busy} onClick={onFinish}>
          <span>
            Finish<span className={adaptive.verbLong}> — show me my profile</span>
          </span>
        </Button>
      )}
    </>
  );
}

/**
 * The running tally. It makes a partial pass visibly worth something (§3.6.1 #3), and it is shared between the
 * names and the words so the two marking steps read as one test.
 *
 * §3.6.30 turned it from three stacked rows into a 3-up strip: the rail is one card now, and three labelled
 * rows of chrome sat between the verbs and the steps for numbers that read fine side by side.
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
    <>
      <div className={adaptive.railHead}>{label}</div>
      <div className={adaptive.tally}>
        {rows.map((row) => (
          <div
            key={row.key}
            className={adaptive.tallyRow}
            data-testid={`${testIdPrefix}-${row.key}`}
          >
            <span className={`${adaptive.dot} ${adaptive[row.key]}`} aria-hidden="true" />
            <b>{counts[row.key]}</b>
            <span className={adaptive.tallyLabel}>{row.label}</span>
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
    </>
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
