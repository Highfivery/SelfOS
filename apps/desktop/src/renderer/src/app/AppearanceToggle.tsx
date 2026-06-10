import { Monitor, Moon, Sun } from 'lucide-react';
import { SegmentedControl, type SegmentOption } from '../design-system/components';
import { useSetting } from '../settings/useSetting';
import type { Appearance } from '../design-system/theme';

const OPTIONS: ReadonlyArray<SegmentOption<Appearance>> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function AppearanceToggle(): JSX.Element {
  const [theme, setTheme] = useSetting('appearance.theme');
  return (
    <SegmentedControl
      options={OPTIONS}
      value={theme}
      onChange={setTheme}
      aria-label="Appearance"
      iconOnly
    />
  );
}
