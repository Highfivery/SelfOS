import { useState } from 'react';
import {
  Button,
  Field,
  Inline,
  Select,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import type { Budget } from '@shared/schemas';
import type { BudgetState } from '@shared/channels';
import { formatUsd } from './format';

/** A small budget control: progress vs. the limit + an editor to set/clear it. */
export function BudgetEditor({
  label,
  budget,
  status,
  onSave,
}: {
  label: string;
  budget: Budget | null;
  status: BudgetState;
  onSave: (budget: Budget | null) => void;
}): JSX.Element {
  const [limit, setLimit] = useState(budget ? String(budget.limitUsd) : '');
  const [period, setPeriod] = useState<'week' | 'month'>(budget?.period ?? 'month');

  const save = (): void => {
    const value = Number(limit);
    if (!Number.isFinite(value) || value <= 0) return;
    onSave({ limitUsd: value, period, warnRatio: 0.8 });
  };

  const tone = status.state === 'over' ? 'danger' : status.state === 'warn' ? 'warning' : 'ok';

  return (
    <Stack gap={2}>
      <Inline gap={2} justify="space-between">
        <Text size="sm" weight={500}>
          {label}
        </Text>
        {status.limitUsd != null ? (
          <Text size="sm" tone={tone === 'ok' ? 'secondary' : 'accent'}>
            {formatUsd(status.spentUsd ?? 0)} / {formatUsd(status.limitUsd)} this {status.period}
          </Text>
        ) : (
          <Text size="sm" tone="tertiary">
            No budget
          </Text>
        )}
      </Inline>
      {status.limitUsd != null ? (
        <progress
          value={status.spentUsd ?? 0}
          max={status.limitUsd}
          aria-label={`${label} budget used`}
        />
      ) : null}
      <Inline gap={2} wrap align="end">
        <Field label={`${label} limit (USD)`}>
          {(props) => (
            <TextInput
              {...props}
              type="number"
              min="0"
              step="0.5"
              value={limit}
              placeholder="e.g. 10"
              onChange={(event) => setLimit(event.target.value)}
            />
          )}
        </Field>
        <Field label="Per">
          {(props) => (
            <Select
              {...props}
              value={period}
              onChange={(event) => setPeriod(event.target.value as 'week' | 'month')}
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </Select>
          )}
        </Field>
        <Button variant="secondary" onClick={save} disabled={!limit}>
          Save
        </Button>
        {budget ? (
          <Button variant="secondary" onClick={() => onSave(null)}>
            Clear
          </Button>
        ) : null}
      </Inline>
    </Stack>
  );
}
