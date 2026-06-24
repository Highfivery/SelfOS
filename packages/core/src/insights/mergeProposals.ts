import type { FileSystem } from '../host';
import { uuid } from '../id';
import { MergeProposalSchema, type InsightProvenance, type MergeProposal } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { deleteInsight, getInsight, saveInsight } from './insightStore';

/**
 * Confirm-before-apply memory merges (39-living-memory §3.4). Reconciliation no longer silently folds two
 * insights together — it queues a `MergeProposal` the user accepts (apply the merge) or dismisses (keep both)
 * in Memory's "Needs your review" region. Stored per-subject; only ever the subject's own (the bridge scopes
 * every channel to the active person).
 */

function proposalsDir(personId: string): string {
  return `people/${personId}/memory-proposals`;
}

function proposalPath(personId: string, id: string): string {
  return `${proposalsDir(personId)}/${id}.enc`;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

export async function saveMergeProposal(
  fs: FileSystem,
  key: Uint8Array,
  proposal: MergeProposal,
): Promise<void> {
  await writeEncryptedJson(fs, proposalPath(proposal.subjectPersonId, proposal.id), proposal, key);
}

export async function listMergeProposals(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<MergeProposal[]> {
  const out: MergeProposal[] = [];
  for (const name of await fs.list(proposalsDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${proposalsDir(personId)}/${name}`, key);
    if (!raw) continue;
    const proposal = MergeProposalSchema.parse(raw);
    if (proposal.subjectPersonId === personId) out.push(proposal);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

export async function getMergeProposal(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  id: string,
): Promise<MergeProposal | null> {
  const raw = await readEncryptedJson(fs, proposalPath(personId, id), key);
  return raw ? MergeProposalSchema.parse(raw) : null;
}

export async function deleteMergeProposal(
  fs: FileSystem,
  personId: string,
  id: string,
): Promise<void> {
  await fs.remove(proposalPath(personId, id));
}

/**
 * Apply a merge: fold the source insight's NON-flagged facts into the target (deduped by text), append the
 * source's provenance to the target's `contributingSources` ("from N moments"), then delete the source. The
 * exact conservative-merge logic reconciliation used to apply inline (20 §3.5). Returns false if either is
 * already gone. A flagged-inaccurate fact is never carried forward (the §3.6 invariant).
 */
export async function applyMerge(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  fromId: string,
  intoId: string,
  now: Date,
): Promise<boolean> {
  if (fromId === intoId) return false;
  const from = await getInsight(fs, key, personId, fromId);
  const into = await getInsight(fs, key, personId, intoId);
  if (!from || !into) return false;

  const at = now.toISOString();
  const seen = new Set(into.facts.map((f) => norm(f.text)));
  const foldedFacts = [...into.facts];
  for (const fact of from.facts) {
    if (fact.flaggedInaccurate) continue;
    if (seen.has(norm(fact.text))) continue;
    seen.add(norm(fact.text));
    foldedFacts.push({ ...fact, id: uuid() });
  }
  const contributing: InsightProvenance[] = [
    ...(into.contributingSources ?? []),
    from.provenance,
    ...(from.contributingSources ?? []),
  ];
  await saveInsight(fs, key, {
    ...into,
    facts: foldedFacts,
    contributingSources: contributing,
    lastReconciledAt: at,
    updatedAt: at,
  });
  await deleteInsight(fs, personId, from.id);
  return true;
}

/**
 * Resolve a queued proposal (39 §3.4). `merge` applies the fold; `keepBoth` just dismisses it. Either way the
 * proposal is removed. Returns false if the proposal is gone. The bridge scopes this to the owner.
 */
export async function resolveMergeProposal(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  proposalId: string,
  action: 'merge' | 'keepBoth',
  now: Date,
): Promise<boolean> {
  const proposal = await getMergeProposal(fs, key, personId, proposalId);
  if (!proposal) return false;
  if (action === 'merge') {
    await applyMerge(fs, key, personId, proposal.fromId, proposal.intoId, now);
  }
  await deleteMergeProposal(fs, personId, proposalId);
  return true;
}

/** Queue merge proposals for the given (validated) merge ops, skipping any pair already proposed. Returns the
 * count newly queued. `byId` maps insight id → summary for the proposal snapshot. */
export async function queueMergeProposals(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  merges: { from: string; into: string }[],
  summaryById: Map<string, string>,
  now: Date,
): Promise<number> {
  const existing = await listMergeProposals(fs, key, personId);
  // A pair is "already proposed" in EITHER direction — never queue a duplicate or its inverse.
  const seen = new Set(
    existing.flatMap((p) => [`${p.fromId}|${p.intoId}`, `${p.intoId}|${p.fromId}`]),
  );
  let queued = 0;
  for (const merge of merges) {
    const key1 = `${merge.from}|${merge.into}`;
    if (seen.has(key1)) continue;
    seen.add(key1);
    seen.add(`${merge.into}|${merge.from}`);
    await saveMergeProposal(fs, key, {
      id: uuid(),
      schemaVersion: 1,
      subjectPersonId: personId,
      fromId: merge.from,
      intoId: merge.into,
      fromSummary: summaryById.get(merge.from) ?? '',
      intoSummary: summaryById.get(merge.into) ?? '',
      createdAt: now.toISOString(),
    });
    queued += 1;
  }
  return queued;
}
