import { join } from 'node:path';
import type { BudgetState, BudgetStateKind } from '../../shared/channels';
import { BudgetsConfigSchema, type Budget, type BudgetsConfig } from '../../shared/schemas';
import { readEncryptedJson, writeEncryptedJson } from '../crypto/encryptedStore';
import { queryUsage } from './usageStore';

function budgetsPath(vaultDir: string): string {
  return join(vaultDir, 'config', 'budgets.enc');
}

function defaults(): BudgetsConfig {
  return { schemaVersion: 1, perPerson: {} };
}

export async function getBudgets(vaultDir: string, key: Buffer): Promise<BudgetsConfig> {
  const raw = await readEncryptedJson(budgetsPath(vaultDir), key);
  return raw === null ? defaults() : BudgetsConfigSchema.parse(raw);
}

async function write(vaultDir: string, key: Buffer, config: BudgetsConfig): Promise<BudgetsConfig> {
  await writeEncryptedJson(budgetsPath(vaultDir), config, key);
  return config;
}

export async function setAppBudget(
  vaultDir: string,
  key: Buffer,
  budget: Budget | null,
): Promise<BudgetsConfig> {
  const config = await getBudgets(vaultDir, key);
  const next: BudgetsConfig = { ...config, perPerson: config.perPerson };
  if (budget) next.app = budget;
  else delete next.app;
  return write(vaultDir, key, next);
}

export async function setPersonBudget(
  vaultDir: string,
  key: Buffer,
  personId: string,
  budget: Budget | null,
): Promise<BudgetsConfig> {
  const config = await getBudgets(vaultDir, key);
  const perPerson = { ...config.perPerson };
  if (budget) perPerson[personId] = budget;
  else delete perPerson[personId];
  return write(vaultDir, key, { ...config, perPerson });
}

/** Start-of-period ISO for `now` (calendar month, or the most recent Monday for week). */
export function periodStart(now: Date, period: 'week' | 'month'): string {
  if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  const start = new Date(now);
  const offset = (start.getDay() + 6) % 7; // days since Monday
  start.setDate(start.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * Evaluate a budget for the current period. `scope: 'app'` sums all people; `'person'` sums one.
 * An owner override downgrades a hard `over` to `warn` so the owner is never stranded.
 */
export async function checkBudget(
  vaultDir: string,
  key: Buffer,
  options: {
    scope: 'app' | 'person';
    personId?: string | undefined;
    now: Date;
    override?: boolean | undefined;
  },
): Promise<BudgetState> {
  const budgets = await getBudgets(vaultDir, key);
  const budget =
    options.scope === 'app'
      ? budgets.app
      : options.personId
        ? budgets.perPerson[options.personId]
        : undefined;
  if (!budget) return { state: 'none', spentUsd: 0, limitUsd: null, period: null };

  const from = periodStart(options.now, budget.period);
  const to = options.now.toISOString();
  const events = await queryUsage(
    vaultDir,
    key,
    options.scope === 'person' && options.personId
      ? { from, to, personId: options.personId }
      : { from, to },
  );
  const spentUsd = events.reduce((sum, event) => sum + event.costUsd, 0);

  let state: BudgetStateKind =
    spentUsd >= budget.limitUsd
      ? 'over'
      : spentUsd >= budget.limitUsd * budget.warnRatio
        ? 'warn'
        : 'ok';
  if (state === 'over' && options.override) state = 'warn';

  return { state, spentUsd, limitUsd: budget.limitUsd, period: budget.period };
}
