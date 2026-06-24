import { useEffect, useState } from 'react';
import { Select, Stack, Text } from '../design-system/components';
import type { ProactivityLevel } from '@shared/schemas';

/**
 * The per-person proactivity level (40-proactive-coaching §3.6/§5.4). Unlike the household-wide settings,
 * this is per-active-person (`CoachingPrefs`, read/written via `coaching:getPrefs`/`setPrefs` — the bridge is
 * the trust boundary), so it manages its own state rather than the schema-driven `useSetting` store. The
 * select's three levels are warm + non-surveilling; "Off" still leaves the always-present crisis support on.
 */

const LEVELS: { value: ProactivityLevel; label: string; hint: string }[] = [
  {
    value: 'gentle',
    label: 'Gentle (recommended)',
    hint: 'Your coach may gently follow up on a goal you set — once, only when it’s relevant — and now and then notice a theme across your reflections. Easy to let go.',
  },
  {
    value: 'active',
    label: 'Active',
    hint: 'A little more present: it follows up on your commitments more readily and looks across your reflections more often. Still warm, never pushy.',
  },
  {
    value: 'off',
    label: 'Off',
    hint: 'Your coach only responds when you start something. No goal check-ins, no “what I’m noticing” observations. (Support for a hard moment is always here, either way.)',
  },
];

export function ProactivityControl(): JSX.Element {
  const [level, setLevel] = useState<ProactivityLevel>('gentle');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const prefs = await window.selfos?.coachingGetPrefs();
      if (!active) return;
      if (prefs) setLevel(prefs.proactivity ?? 'gentle');
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const choose = (next: ProactivityLevel): void => {
    setLevel(next);
    void window.selfos?.coachingSetPrefs({ proactivity: next });
  };

  const hint = LEVELS.find((l) => l.value === level)?.hint ?? '';

  return (
    <Stack gap={2}>
      <Select
        value={level}
        aria-label="How proactive your coach is"
        disabled={!loaded}
        onChange={(e) => choose(e.target.value as ProactivityLevel)}
      >
        {LEVELS.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </Select>
      <Text size="sm" tone="secondary">
        {hint}
      </Text>
    </Stack>
  );
}
