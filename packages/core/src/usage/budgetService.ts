import type { FileSystem } from '../host';
import {
  BudgetsConfigSchema,
  type Budget,
  type BudgetState,
  type BudgetStateKind,
  type BudgetsConfig,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { queryUsage } from './usageStore';

const BUDGETS_PATH = 'config/budgets.enc';

/** Everyone has a budget: this default applies to a person the admin hasn't configured (06 §12). */
export const DEFAULT_BUDGET: Budget = { limitUsd: 10, period: 'week', warnRatio: 0.8 };

function defaults(): BudgetsConfig {
  return { schemaVersion: 1, perPerson: {} };
}

/** A person's effective budget: their override, or the $10/week default. */
export async function effectivePersonBudget(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<Budget> {
  return (await getBudgets(fs, key)).perPerson[personId] ?? DEFAULT_BUDGET;
}

export async function getBudgets(fs: FileSystem, key: Uint8Array): Promise<BudgetsConfig> {
  const raw = await readEncryptedJson(fs, BUDGETS_PATH, key);
  return raw === null ? defaults() : BudgetsConfigSchema.parse(raw);
}

async function write(
  fs: FileSystem,
  key: Uint8Array,
  config: BudgetsConfig,
): Promise<BudgetsConfig> {
  await writeEncryptedJson(fs, BUDGETS_PATH, config, key);
  return config;
}

export async function setAppBudget(
  fs: FileSystem,
  key: Uint8Array,
  budget: Budget | null,
): Promise<BudgetsConfig> {
  const config = await getBudgets(fs, key);
  const next: BudgetsConfig = { ...config, perPerson: config.perPerson };
  if (budget) next.app = budget;
  else delete next.app;
  return write(fs, key, next);
}

export async function setPersonBudget(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  budget: Budget | null,
): Promise<BudgetsConfig> {
  const config = await getBudgets(fs, key);
  const perPerson = { ...config.perPerson };
  if (budget) perPerson[personId] = budget;
  else delete perPerson[personId];
  return write(fs, key, { ...config, perPerson });
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
  fs: FileSystem,
  key: Uint8Array,
  options: {
    scope: 'app' | 'person';
    personId?: string | undefined;
    now: Date;
    override?: boolean | undefined;
  },
): Promise<BudgetState> {
  const budgets = await getBudgets(fs, key);
  // Person scope always has a budget (override or the $10/week default); app scope may be unset.
  const budget =
    options.scope === 'app'
      ? budgets.app
      : options.personId
        ? (budgets.perPerson[options.personId] ?? DEFAULT_BUDGET)
        : undefined;
  if (!budget) return { state: 'none', spentUsd: 0, limitUsd: null, period: null };

  const from = periodStart(options.now, budget.period);
  const to = options.now.toISOString();
  const events = await queryUsage(
    fs,
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
