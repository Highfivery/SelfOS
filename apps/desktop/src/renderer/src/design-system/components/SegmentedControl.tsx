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
}

/** A single-select group of mutually exclusive options rendered as connected buttons. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  iconOnly = false,
  ...aria
}: SegmentedControlProps<T>): JSX.Element {
  return (
    <div className={styles.group} role="group" aria-label={aria['aria-label']}>
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
