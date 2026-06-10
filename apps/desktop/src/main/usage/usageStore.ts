import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { UsageSummary } from '../../shared/channels';
import { UsageEventSchema, type UsageEvent } from '../../shared/schemas';
import { pathExists } from '../vault/atomic';
import { readEncryptedJson, writeEncryptedJson } from '../crypto/encryptedStore';
import { listPeople } from '../people/peopleService';
import { cacheSavingsOf } from './pricing';

const UsageShardSchema = z.object({
  schemaVersion: z.number().int().positive(),
  events: z.array(UsageEventSchema),
});

function usageDir(vaultDir: string, personId: string): string {
  return join(vaultDir, 'people', personId, 'usage');
}

function shardPath(vaultDir: string, personId: string, month: string): string {
  return join(usageDir(vaultDir, personId), `${month}.enc`);
}

function monthOf(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

/** Append a usage event to the person's encrypted monthly shard. */
export async function recordUsage(vaultDir: string, key: Buffer, event: UsageEvent): Promise<void> {
  await mkdir(usageDir(vaultDir, event.personId), { recursive: true });
  const path = shardPath(vaultDir, event.personId, monthOf(event.at));
  const existing = await readEncryptedJson(path, key);
  const events = existing ? UsageShardSchema.parse(existing).events : [];
  events.push(event);
  await writeEncryptedJson(path, { schemaVersion: 1, events }, key);
}

async function readPersonEvents(
  vaultDir: string,
  key: Buffer,
  personId: string,
): Promise<UsageEvent[]> {
  const dir = usageDir(vaultDir, personId);
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const events: UsageEvent[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(join(dir, entry.name), key);
    if (raw) events.push(...UsageShardSchema.parse(raw).events);
  }
  return events;
}

/** Query usage events in [from, to] (inclusive ISO), optionally scoped to one person/type. */
export async function queryUsage(
  vaultDir: string,
  key: Buffer,
  filter: { from: string; to: string; personId?: string; type?: string },
): Promise<UsageEvent[]> {
  const ids = filter.personId
    ? [filter.personId]
    : (await listPeople(vaultDir, key)).map((person) => person.id);
  const out: UsageEvent[] = [];
  for (const id of ids) {
    for (const event of await readPersonEvents(vaultDir, key, id)) {
      if (event.at < filter.from || event.at > filter.to) continue;
      if (filter.type && event.type !== filter.type) continue;
      out.push(event);
    }
  }
  return out;
}

/** Roll a set of usage events up into the dashboard summary. Pure. */
export function summarize(events: UsageEvent[]): UsageSummary {
  const byType: Record<string, { costUsd: number; count: number }> = {};
  const byModel: Record<string, { costUsd: number; count: number }> = {};
  const byPerson: Record<string, { costUsd: number; count: number }> = {};
  const sessions = new Set<string>();
  let totalCostUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let cacheSavingsUsd = 0;

  for (const event of events) {
    totalCostUsd += event.costUsd;
    inputTokens += event.inputTokens;
    outputTokens += event.outputTokens;
    cacheWriteTokens += event.cacheWriteTokens;
    cacheReadTokens += event.cacheReadTokens;
    cacheSavingsUsd += cacheSavingsOf(event.model, event.cacheReadTokens);
    if (event.sessionId) sessions.add(event.sessionId);
    (byType[event.type] ??= { costUsd: 0, count: 0 }).costUsd += event.costUsd;
    byType[event.type]!.count += 1;
    (byModel[event.model] ??= { costUsd: 0, count: 0 }).costUsd += event.costUsd;
    byModel[event.model]!.count += 1;
    (byPerson[event.personId] ??= { costUsd: 0, count: 0 }).costUsd += event.costUsd;
    byPerson[event.personId]!.count += 1;
  }

  const sessionCount = sessions.size;
  const typeCount = Object.keys(byType).length;
  return {
    totalCostUsd,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    cacheSavingsUsd,
    sessionCount,
    avgCostPerSession: sessionCount ? totalCostUsd / sessionCount : 0,
    avgCostPerType: typeCount ? totalCostUsd / typeCount : 0,
    byType,
    byModel,
    byPerson,
  };
}
