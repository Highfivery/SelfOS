import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { SegmentedControl, type SegmentOption } from '../design-system/components';
import type { Appearance } from '../design-system/theme';

const OPTIONS: ReadonlyArray<SegmentOption<Appearance>> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function AppearanceToggle(): JSX.Element {
  const { appearance, setAppearance } = useTheme();
  return (
    <SegmentedControl
      options={OPTIONS}
      value={appearance}
      onChange={setAppearance}
      aria-label="Appearance"
      iconOnly
    />
  );
}
