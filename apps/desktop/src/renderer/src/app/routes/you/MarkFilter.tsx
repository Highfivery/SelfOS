import { SegmentedControl, Text } from '../../../design-system/components';
import adaptive from './Adaptive.module.css';

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
