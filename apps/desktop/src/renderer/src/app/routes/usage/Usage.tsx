import { useEffect } from 'react';
import { useUsageStore } from '../../../stores/usageStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { usageTypeLabel } from '@shared/usageTypes';
import {
  AdminOnlyBadge,
  Card,
  Heading,
  Inline,
  SegmentedControl,
  Select,
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

/**
 * AI usage dashboard (06-ai-usage-and-budgets). Cost ($), the "Everyone" + per-person picker, the
 * by-person breakdown, and the overall-cap editor are admin-only (`budgets.manage`); everyone else
 * sees only their own usage with no dollar amounts.
 */
export function Usage(): JSX.Element {
  const selectedPersonId = useUsageStore((s) => s.selectedPersonId);
  const period = useUsageStore((s) => s.period);
  const summary = useUsageStore((s) => s.summary);
  const budget = useUsageStore((s) => s.budget);
  const status = useUsageStore((s) => s.status);
  const people = useUsageStore((s) => s.people);
  const load = useUsageStore((s) => s.load);
  const loadPeople = useUsageStore((s) => s.loadPeople);
  const setSelectedPerson = useUsageStore((s) => s.setSelectedPerson);
  const setPeriod = useUsageStore((s) => s.setPeriod);
  const saveAppBudget = useUsageStore((s) => s.saveAppBudget);
  const canManage = useSessionStore((s) => s.can('budgets.manage'));

  // Re-load when admin status flips too (e.g. entering/leaving super-admin inspect mode mid-view).
  useEffect(() => {
    void load();
  }, [load, canManage]);
  useEffect(() => {
    if (canManage) void loadPeople();
  }, [canManage, loadPeople]);

  const nameOf = (personId: string): string =>
    people.find((person) => person.id === personId)?.displayName ?? 'Person';
  const scopeLabel = !canManage
    ? 'You'
    : selectedPersonId === null
      ? 'Everyone'
      : nameOf(selectedPersonId);

  return (
    <Stack gap={5}>
      <Stack gap={1}>
        <Heading level={2}>Usage</Heading>
        <Text tone="secondary">
          {canManage
            ? 'Estimated cost — your Anthropic bill is the source of truth.'
            : 'Your AI usage this period.'}
        </Text>
      </Stack>

      <Inline gap={3} wrap>
        {canManage ? (
          <Inline gap={2}>
            <Select
              aria-label="Whose usage"
              value={selectedPersonId ?? 'app'}
              onChange={(event) =>
                void setSelectedPerson(event.target.value === 'app' ? null : event.target.value)
              }
            >
              <option value="app">Everyone</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </Select>
            <AdminOnlyBadge />
          </Inline>
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
                {scopeLabel}, this {period}
              </Text>
              {canManage ? (
                <Inline gap={2}>
                  <Heading level={1}>{formatUsd(summary.totalCostUsd)}</Heading>
                  <AdminOnlyBadge />
                </Inline>
              ) : null}
              <div className={styles.stats}>
                <Stat label="Sessions" value={String(summary.sessionCount)} />
                {canManage ? (
                  <Stat label="Avg / session" value={formatUsd(summary.avgCostPerSession)} />
                ) : null}
                {canManage ? (
                  <Stat label="Avg / type" value={formatUsd(summary.avgCostPerType)} />
                ) : null}
                <Stat label="Input tokens" value={formatTokens(summary.inputTokens)} />
                <Stat label="Output tokens" value={formatTokens(summary.outputTokens)} />
                <Stat label="Cache read" value={formatTokens(summary.cacheReadTokens)} />
                <Stat label="Cache write" value={formatTokens(summary.cacheWriteTokens)} />
                {canManage ? (
                  <Stat label="Cache savings" value={formatUsd(summary.cacheSavingsUsd)} />
                ) : null}
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
                        {canManage ? `${formatUsd(row.costUsd)} · ` : ''}
                        {row.count}
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
                        {canManage ? `${formatUsd(row.costUsd)} · ` : ''}
                        {row.count}
                      </Text>
                    </Inline>
                  ))
                )}
              </Stack>
            </Card>
          </div>

          {canManage && selectedPersonId === null && Object.keys(summary.byPerson).length > 0 ? (
            <Card>
              <Stack gap={2}>
                <Inline gap={2}>
                  <Heading level={3}>By person</Heading>
                  <AdminOnlyBadge />
                </Inline>
                {Object.entries(summary.byPerson).map(([personId, row]) => (
                  <Inline key={personId} gap={2} justify="between">
                    <Text size="sm">{nameOf(personId)}</Text>
                    <Text size="sm" tone="secondary">
                      {formatUsd(row.costUsd)} · {row.count}
                    </Text>
                  </Inline>
                ))}
              </Stack>
            </Card>
          ) : null}
        </>
      ) : null}

      {canManage && budget && status ? (
        <Card>
          <Stack gap={3}>
            <Inline gap={2}>
              <Heading level={3}>Overall cap (optional)</Heading>
              <AdminOnlyBadge />
            </Inline>
            <Text size="sm" tone="secondary">
              A ceiling across everyone, on top of each person’s budget. Per-person budgets are set
              on each person’s page.
            </Text>
            <BudgetEditor
              label="Everyone (app)"
              budget={budget.app}
              status={status.app}
              onSave={(next) => void saveAppBudget(next)}
            />
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}
