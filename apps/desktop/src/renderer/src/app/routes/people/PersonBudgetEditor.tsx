import { useEffect, useState } from 'react';
import {
  Button,
  Field,
  Inline,
  Select,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import type { Person } from '@shared/channels';

/** Admin-only per-person AI budget editor (06). Lives on the person page's Budget tab. */
export function PersonBudgetEditor({ person }: { person: Person }): JSX.Element {
  const [limit, setLimit] = useState('');
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const budget = await window.selfos?.budgetGetPerson(person.id);
      if (budget) {
        setLimit(String(budget.limitUsd));
        setPeriod(budget.period);
      }
      setLoaded(true);
    })();
  }, [person.id]);

  const save = async (): Promise<void> => {
    const value = Number(limit);
    if (!Number.isFinite(value) || value <= 0) return;
    await window.selfos?.budgetSetPerson({
      personId: person.id,
      budget: { limitUsd: value, period, warnRatio: 0.8 },
    });
    setSaved(true);
  };

  const reset = async (): Promise<void> => {
    await window.selfos?.budgetSetPerson({ personId: person.id, budget: null });
    setLimit('10');
    setPeriod('week');
    setSaved(true);
  };

  if (!loaded) {
    return (
      <Text tone="tertiary" size="sm">
        Loading…
      </Text>
    );
  }

  return (
    <Stack gap={3}>
      <Text size="sm" tone="secondary">
        How much {person.displayName} can spend on AI per period. Defaults to $10 / week.
      </Text>
      <Inline gap={2} wrap>
        <Field label="Limit (USD)">
          {(props) => (
            <TextInput
              {...props}
              type="number"
              min="0"
              step="0.5"
              value={limit}
              onChange={(event) => {
                setLimit(event.target.value);
                setSaved(false);
              }}
            />
          )}
        </Field>
        <Field label="Per">
          {(props) => (
            <Select
              {...props}
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as 'week' | 'month');
                setSaved(false);
              }}
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </Select>
          )}
        </Field>
        <Button variant="primary" onClick={() => void save()} disabled={!limit}>
          Save budget
        </Button>
        <Button variant="secondary" onClick={() => void reset()}>
          Reset to default
        </Button>
      </Inline>
      {saved ? (
        <Text size="xs" tone="secondary">
          Saved.
        </Text>
      ) : null}
    </Stack>
  );
}
