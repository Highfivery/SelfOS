import { SegmentedControl, Text } from '../../../design-system/components';
import adaptive from './Adaptive.module.css';

/**
 * 74 §3.6.34 — is this row STILL UNMARKED?
 *
 * A row is marked per DIRECTION, and orientation shows some rows on one side only (§3.6.3/§3.6.23). So the
 * question the filter has to ask is "does every side this person was actually OFFERED have an answer?" —
 * not "does this row have any answer at all".
 *
 * The first version of this filter asked the second question (`hear === undefined && say === undefined`),
 * which meant answering ONE side of a two-sided row made it vanish from "still unmarked" with the other
 * side blank — the exact thing the filter exists to surface. That is the §3.6.11 conflation in a fourth
 * place: core already separates "has an answer" (`hasAnswer`) from "this direction was answered"
 * (`directionAnswered`) because reading a blank side as an answer once put a false statement in front of
 * the person. This is the view-layer mirror of `directionAnswered`, in ONE place so the two marking steps
 * cannot drift into two definitions again.
 *
 * A row shown on NO side (every term in it aimed at a body neither of them has) is not "still unmarked" —
 * there is nothing to answer — which falls out of `some` over an empty list being false.
 */
export function isStillUnmarked(
  sides: readonly ('hear' | 'say')[],
  mark: { hear?: unknown; say?: unknown } | undefined,
): boolean {
  return sides.some((side) => mark?.[side] === undefined);
}

/** What a marking screen is currently showing. */
export type MarkFilterValue = 'all' | 'new';

const OPTIONS = [
  { value: 'all' as const, label: 'Everything' },
  { value: 'new' as const, label: 'Still unmarked' },
];

/**
 * 74 §3.6.34 — "still unmarked", shared by the words step and the names step.
 *
 * Both marking screens have the same second-visit problem: the hard part is not choosing where to go, it is
 * finding the rows you have not answered inside 47 lines or 123 names. One component so the control sits in
 * the same place, reads the same way and uses the same words on both — the two screens are one test, and
 * §3.6.34 exists because they had drifted into different shapes.
 *
 * A two-option `SegmentedControl` rather than chips: two short labels fit at 360px, where a wrapping pile
 * would not (§12 — a control that does not fit gets a space-filling component, never a wrap).
 */
export function MarkFilter({
  value,
  onChange,
  total,
  shown,
  noun,
}: {
  value: MarkFilterValue;
  onChange: (next: MarkFilterValue) => void;
  total: number;
  shown: number;
  /** What the total is counting, in the step's own words — "here" for an area, "names" for a register. */
  noun: string;
}): JSX.Element {
  return (
    <div className={adaptive.markFilter}>
      <SegmentedControl aria-label="Show" options={OPTIONS} value={value} onChange={onChange} />
      {/*
       * A COUNT, never a fraction (74 §3.6.29). "12 still unmarked" says how much is outstanding; "12 of 47"
       * would pair it with a total and make the completion claim the durable rule forbids.
       */}
      <Text size="sm" tone="tertiary">
        {value === 'all' ? `${total} ${noun}` : `${shown} still unmarked`}
      </Text>
    </div>
  );
}
