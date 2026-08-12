import { z } from 'zod';

import type { FileSystem } from '../host';
import { SensitivityTierSchema, type Question } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { formatAnswerForDisplay, isDeclined, type AnswerValue } from './answering';

/**
 * The **ask ledger** (spec 71 §5.1) — a durable, per-recipient record of every question they have been
 * asked, appended at send time and never recomputed by scanning sends.
 *
 * This exists because the app previously had no memory of what it had asked. It re-derived that on every
 * generation by listing every assignment and decrypting every frozen snapshot — **six independent full
 * scans** (`gatherRecipientAskedPrompts`, `gatherRecipientIntimacyAsks`,
 * `gatherRecipientQuestionnaireTitles`, `gatherRecipientPriorAnswersByAssignment`,
 * `countAnsweredQuestionnaires`, plus a nested call) — then compressed the raw prompts into a 2,000-char
 * slice of the de-dup prompt. Measured on a real vault that was 1,148 decrypt ops per draft and **2.7%** of
 * the ask history surviving into the prompt (spec 71 §1 D5). One read replaces all six, and the reference is
 * built from **gists + per-topic counts** rather than raw prompts, so the token cost is roughly flat in
 * history size instead of linear.
 *
 * The ledger belongs to the **recipient** (it is their record of what they were asked), is append-only, and
 * is merged by `questionId` so a sync conflict can never duplicate or lose an entry.
 *
 * PURE + I/O split: the classification/derivation helpers are pure and unit-testable; only `readLedger` /
 * `writeLedger` / `appendAsks` / `recordOutcomes` touch the vault.
 */

const SCHEMA_VERSION = 1;

/**
 * Keep the ledger economical on a person with years of daily check-ins. Entries are tiny (~200 bytes), so
 * this is a generous ceiling, not a working limit; the OLDEST entries drop first, and per-topic counts
 * derived from a 5,000-ask window are far beyond what any steering decision needs.
 */
export const MAX_LEDGER_ENTRIES = 5000;

/** A considered free-text answer — the threshold above which an answer counts as a productive vein. */
const RICH_TEXT_CHARS = 140;

/**
 * How an asked question actually landed. Only `skipped`/`declined` are treated as a NEGATIVE signal that can
 * saturate a topic on quality alone (spec 71 §5.4); `rich` is a positive preference signal and `brief` is
 * deliberately neutral — a rating question answered with a number is a complete answer, not a dead vein, and
 * treating it as one would wrongly close rating-heavy ground.
 */
export const AskOutcomeSchema = z.enum(['pending', 'rich', 'brief', 'skipped', 'declined']);
export type AskOutcome = z.infer<typeof AskOutcomeSchema>;

export const AskLedgerEntrySchema = z.object({
  /** The question's id within its frozen snapshot — the merge key. */
  questionId: z.string().min(1),
  assignmentId: z.string().min(1),
  /** ISO — the send's `createdAt`. */
  at: z.string(),
  /** The questionnaire type as sent (`intimacy`, `scenario`, a custom type, …). */
  type: z.string(),
  tier: SensitivityTierSchema,
  /** The topics this question covered, tagged at write time by the pass that wrote it (spec 71 §5.3). */
  topicIds: z.array(z.string()).catch([]).default([]),
  /** A compact restatement of what was asked — NOT the prompt. This is what makes the reference scale. */
  gist: z.string().catch('').default(''),
  outcome: AskOutcomeSchema.catch('pending').default('pending'),
});
export type AskLedgerEntry = z.infer<typeof AskLedgerEntrySchema>;

export const AskLedgerSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  personId: z.string(),
  entries: z.array(AskLedgerEntrySchema).catch([]).default([]),
  /** Set once the one-time backfill (spec 71 §5.6) has seeded this person's history. */
  backfilledAt: z.string().optional(),
});
export type AskLedger = z.infer<typeof AskLedgerSchema>;

export const ledgerPath = (personId: string): string =>
  `people/${personId}/questionnaires/askLedger.enc`;

/** An empty ledger — the correct starting state for someone who has never been asked anything. */
export function emptyLedger(personId: string): AskLedger {
  return { schemaVersion: SCHEMA_VERSION, personId, entries: [] };
}

/**
 * Read a person's ledger, deriving an empty one when absent. A corrupt/partial doc degrades to empty rather
 * than throwing out of the generation that depends on it — the app then behaves exactly as it did before this
 * spec (no saturation signal) instead of dead-ending (spec 71 §7).
 */
export async function readLedger(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<AskLedger> {
  const raw = await readEncryptedJson(fs, ledgerPath(personId), key);
  if (!raw) return emptyLedger(personId);
  const parsed = AskLedgerSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyLedger(personId);
}

export async function writeLedger(
  fs: FileSystem,
  key: Uint8Array,
  ledger: AskLedger,
): Promise<void> {
  await writeEncryptedJson(fs, ledgerPath(ledger.personId), ledger, key);
}

/**
 * Merge new entries into a ledger, keyed by `questionId` (pure).
 *
 * Append-only by construction: an existing entry is never duplicated, and a re-merge of the same send is a
 * no-op — which is what makes both the send path and the backfill idempotent, and what makes a sync conflict
 * safe to resolve by simply merging both sides. An incoming entry may only ENRICH an existing one (fill in
 * topics/gist, advance a `pending` outcome); it can never blank fields that are already known.
 */
export function mergeEntries(
  existing: readonly AskLedgerEntry[],
  incoming: readonly AskLedgerEntry[],
): AskLedgerEntry[] {
  const byId = new Map(existing.map((e) => [e.questionId, e]));
  for (const next of incoming) {
    const prior = byId.get(next.questionId);
    if (!prior) {
      byId.set(next.questionId, next);
      continue;
    }
    byId.set(next.questionId, {
      ...prior,
      topicIds: next.topicIds.length > 0 ? next.topicIds : prior.topicIds,
      gist: next.gist.trim() !== '' ? next.gist : prior.gist,
      outcome: next.outcome !== 'pending' ? next.outcome : prior.outcome,
    });
  }
  // Oldest-first, so the cap drops the oldest asks (see `MAX_LEDGER_ENTRIES`).
  const all = [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
  return all.length > MAX_LEDGER_ENTRIES ? all.slice(all.length - MAX_LEDGER_ENTRIES) : all;
}

/** Append (or enrich) entries for a recipient. Best-effort at the call site — never part of a send's contract. */
export async function appendAsks(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  entries: readonly AskLedgerEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const ledger = await readLedger(fs, key, personId);
  const merged = mergeEntries(ledger.entries, entries);
  await writeLedger(fs, key, { ...ledger, entries: merged });
}

/**
 * Classify how one asked question landed, deterministically (spec 71 §5.4). No AI, no I/O.
 *
 * `undefined` (the question was never answered at all in a submitted response) is `skipped` — the person saw
 * it and moved past it, which is the same negative signal as an explicit skip for steering purposes.
 */
export function classifyOutcome(question: Question, value: AnswerValue | undefined): AskOutcome {
  if (value === undefined) return 'skipped';
  if (isDeclined(value)) return 'declined';
  const display = formatAnswerForDisplay(question, value).trim();
  if (display === '') return 'skipped';
  return display.length >= RICH_TEXT_CHARS ? 'rich' : 'brief';
}

/** Record how a submitted response's answers landed, enriching the recipient's existing ledger entries. */
export async function recordOutcomes(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  outcomes: readonly { questionId: string; outcome: AskOutcome }[],
): Promise<void> {
  if (outcomes.length === 0) return;
  const ledger = await readLedger(fs, key, personId);
  const byId = new Map(outcomes.map((o) => [o.questionId, o.outcome]));
  let changed = false;
  const entries = ledger.entries.map((e) => {
    const next = byId.get(e.questionId);
    if (next === undefined || next === e.outcome) return e;
    changed = true;
    return { ...e, outcome: next };
  });
  if (!changed) return;
  await writeLedger(fs, key, { ...ledger, entries });
}

/** Per-topic exploration stats, DERIVED from the ledger so counts can never drift from what was asked. */
export interface TopicStats {
  askedCount: number;
  /** Answers that carried real material — the "this vein is productive" signal. */
  richCount: number;
  /** Skipped or declined — the "this isn't landing" signal that can saturate on quality alone. */
  deadCount: number;
  lastAskedAt?: string;
}

/**
 * Derive per-topic stats from the ledger (pure). A question tagged with several topics credits each of them,
 * mirroring the multi-credit behaviour of the taxonomy it replaces — which is fail-safe for repetition
 * (a topic may read as worked slightly early, steering generation AWAY from it, never back into it).
 */
export function deriveTopicStats(ledger: AskLedger): Map<string, TopicStats> {
  const out = new Map<string, TopicStats>();
  for (const e of ledger.entries) {
    for (const topicId of e.topicIds) {
      const s = out.get(topicId) ?? { askedCount: 0, richCount: 0, deadCount: 0 };
      s.askedCount += 1;
      if (e.outcome === 'rich') s.richCount += 1;
      if (e.outcome === 'skipped' || e.outcome === 'declined') s.deadCount += 1;
      if (!s.lastAskedAt || e.at > s.lastAskedAt) s.lastAskedAt = e.at;
      out.set(topicId, s);
    }
  }
  return out;
}
