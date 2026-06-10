import { useEffect } from 'react';
import { useUsageStore } from '../../../stores/usageStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { usageTypeLabel } from '@shared/usageTypes';
import {
  Card,
  Heading,
  Inline,
  SegmentedControl,
  Stack,
  Text,
} from '../../../design-system/components';
import { BudgetEditor } from './BudgetEditor';
import { formatTokens, formatUsd } from './format';
import styles from './Usage.module.css';

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={styles.stat}>
      <Text size="xs" tone="tertiary">
        {label}
      </Text>
      <Text weight={600}>{value}</Text>
    </div>
  );
}

/** AI usage dashboard (06-ai-usage-and-budgets): totals, breakdowns, cache savings, budgets. */
export function Usage(): JSX.Element {
  const scope = useUsageStore((s) => s.scope);
  const period = useUsageStore((s) => s.period);
  const summary = useUsageStore((s) => s.summary);
  const budget = useUsageStore((s) => s.budget);
  const status = useUsageStore((s) => s.status);
  const load = useUsageStore((s) => s.load);
  const setScope = useUsageStore((s) => s.setScope);
  const setPeriod = useUsageStore((s) => s.setPeriod);
  const savePersonBudget = useUsageStore((s) => s.savePersonBudget);
  const saveAppBudget = useUsageStore((s) => s.saveAppBudget);
  const canApp = useSessionStore((s) => s.can('settings.manage'));

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Stack gap={5}>
      <Stack gap={1}>
        <Heading level={2}>Usage</Heading>
        <Text tone="secondary">Estimated cost — your Anthropic bill is the source of truth.</Text>
      </Stack>

      <Inline gap={3} wrap>
        {canApp ? (
          <SegmentedControl
            aria-label="Whose usage"
            value={scope}
            onChange={(value) => void setScope(value)}
            options={[
              { value: 'person', label: 'Mine' },
              { value: 'app', label: 'Everyone' },
            ]}
          />
        ) : null}
        <SegmentedControl
          aria-label="Period"
          value={period}
          onChange={(value) => void setPeriod(value)}
          options={[
            { value: 'week', label: 'This week' },
            { value: 'month', label: 'This month' },
          ]}
        />
      </Inline>

      {summary ? (
        <>
          <Card>
            <Stack gap={3}>
              <Text size="sm" tone="secondary">
                Total ({scope === 'app' ? 'everyone' : 'you'}, this {period})
              </Text>
              <Heading level={1}>{formatUsd(summary.totalCostUsd)}</Heading>
              <div className={styles.stats}>
                <Stat label="Sessions" value={String(summary.sessionCount)} />
                <Stat label="Avg / session" value={formatUsd(summary.avgCostPerSession)} />
                <Stat label="Avg / type" value={formatUsd(summary.avgCostPerType)} />
                <Stat label="Input tokens" value={formatTokens(summary.inputTokens)} />
                <Stat label="Output tokens" value={formatTokens(summary.outputTokens)} />
                <Stat label="Cache read" value={formatTokens(summary.cacheReadTokens)} />
                <Stat label="Cache write" value={formatTokens(summary.cacheWriteTokens)} />
                <Stat label="Cache savings" value={formatUsd(summary.cacheSavingsUsd)} />
              </div>
            </Stack>
          </Card>

          <div className={styles.columns}>
            <Card>
              <Stack gap={2}>
                <Heading level={3}>By type</Heading>
                {Object.keys(summary.byType).length === 0 ? (
                  <Text tone="tertiary" size="sm">
                    No usage yet.
                  </Text>
                ) : (
                  Object.entries(summary.byType).map(([type, row]) => (
                    <Inline key={type} gap={2} justify="between">
                      <Text size="sm">{usageTypeLabel(type)}</Text>
                      <Text size="sm" tone="secondary">
                        {formatUsd(row.costUsd)} · {row.count}
                      </Text>
                    </Inline>
                  ))
                )}
              </Stack>
            </Card>
            <Card>
              <Stack gap={2}>
                <Heading level={3}>By model</Heading>
                {Object.keys(summary.byModel).length === 0 ? (
                  <Text tone="tertiary" size="sm">
                    No usage yet.
                  </Text>
                ) : (
                  Object.entries(summary.byModel).map(([model, row]) => (
                    <Inline key={model} gap={2} justify="between">
                      <Text size="sm">{model}</Text>
                      <Text size="sm" tone="secondary">
                        {formatUsd(row.costUsd)} · {row.count}
                      </Text>
                    </Inline>
                  ))
                )}
              </Stack>
            </Card>
          </div>
        </>
      ) : null}

      {budget && status ? (
        <Card>
          <Stack gap={4}>
            <Heading level={3}>Budgets</Heading>
            <BudgetEditor
              label="My budget"
              budget={budget.person}
              status={status.person}
              onSave={(next) => void savePersonBudget(next)}
            />
            {canApp ? (
              <BudgetEditor
                label="Everyone (app)"
                budget={budget.app}
                status={status.app}
                onSave={(next) => void saveAppBudget(next)}
              />
            ) : null}
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}
