import type { LucideIcon } from 'lucide-react';
import styles from './SegmentedControl.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  iconOnly?: boolean;
  /**
   * How tall the segments are. Defaults to `compact` (28px) — the height every existing caller was built
   * around, including the titlebar's appearance control, which is bounded by `--control-height`.
   *
   * `comfortable` is a full 44px tap target. It exists because the shared marking filter (74 §3.6.34) is a
   * primary in-content control on six screens of this test, and the take's own UI audit flags it on every
   * one of them: 28px is fine for chrome and under the minimum for something you tap while working.
   */
  size?: 'compact' | 'comfortable';
}

/** A single-select group of mutually exclusive options rendered as connected buttons. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  iconOnly = false,
  size = 'compact',
  ...aria
}: SegmentedControlProps<T>): JSX.Element {
  return (
    <div
      className={`${styles.group} ${size === 'comfortable' ? styles.comfortable : ''}`}
      role="group"
      aria-label={aria['aria-label']}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={iconOnly ? option.label : undefined}
            title={iconOnly ? option.label : undefined}
            className={active ? `${styles.segment} ${styles.active}` : styles.segment}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={16} aria-hidden="true" /> : null}
            {iconOnly ? null : <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
