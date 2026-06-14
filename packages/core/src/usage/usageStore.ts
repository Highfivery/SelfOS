import { z } from 'zod';
import type { FileSystem } from '../host';
import { UsageEventSchema, type UsageEvent, type UsageSummary } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { listPeople } from '../people';
import { cacheSavingsOf } from './pricing';

const UsageShardSchema = z.object({
  schemaVersion: z.number().int().positive(),
  events: z.array(UsageEventSchema),
});

function usageDir(personId: string): string {
  return `people/${personId}/usage`;
}

function shardPath(personId: string, month: string): string {
  return `${usageDir(personId)}/${month}.enc`;
}

function monthOf(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

/** Append a usage event to the person's encrypted monthly shard. */
export async function recordUsage(
  fs: FileSystem,
  key: Uint8Array,
  event: UsageEvent,
): Promise<void> {
  const path = shardPath(event.personId, monthOf(event.at));
  const existing = await readEncryptedJson(fs, path, key);
  const events = existing ? UsageShardSchema.parse(existing).events : [];
  events.push(event);
  await writeEncryptedJson(fs, path, { schemaVersion: 1, events }, key);
}

async function readPersonEvents(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  for (const name of await fs.list(usageDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${usageDir(personId)}/${name}`, key);
    if (raw) events.push(...UsageShardSchema.parse(raw).events);
  }
  return events;
}

/** Query usage events in [from, to] (inclusive ISO), optionally scoped to one person/type. */
export async function queryUsage(
  fs: FileSystem,
  key: Uint8Array,
  filter: { from: string; to: string; personId?: string; type?: string },
): Promise<UsageEvent[]> {
  const ids = filter.personId
    ? [filter.personId]
    : (await listPeople(fs, key)).map((person) => person.id);
  const out: UsageEvent[] = [];
  for (const id of ids) {
    for (const event of await readPersonEvents(fs, key, id)) {
      if (event.at < filter.from || event.at > filter.to) continue;
      if (filter.type && event.type !== filter.type) continue;
      out.push(event);
    }
  }
  return out;
}

/**
 * Roll usage events up per `sessionId` (09-session-analysis §14.3) — the accumulated tokens + cost of each
 * conversation (its chat turns + any `session.analyze`). Pure. The bridge redacts `costUsd` for non-admins.
 */
export function rollupSessionCosts(
  events: UsageEvent[],
): Record<string, { tokens: number; costUsd: number }> {
  const out: Record<string, { tokens: number; costUsd: number }> = {};
  for (const event of events) {
    if (!event.sessionId) continue;
    const bucket = (out[event.sessionId] ??= { tokens: 0, costUsd: 0 });
    bucket.tokens +=
      event.inputTokens + event.outputTokens + event.cacheWriteTokens + event.cacheReadTokens;
    bucket.costUsd += event.costUsd;
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
