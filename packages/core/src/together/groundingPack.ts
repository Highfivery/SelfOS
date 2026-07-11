import type { FileSystem } from '../host';
import type { TogetherSession } from '../schemas';
import { getRelationshipSynthesis } from '../coaching/relationshipSynthesisService';
import { getAlignmentReport } from '../questionnaires/alignmentService';
import { listAssignments } from '../questionnaires/assignmentService';
import { getReport, listAgreements, standingAgreements } from './agreementService';
import { allAdultAcknowledged } from './adultGate';
import { getTogetherGuide } from './togetherCatalog';
import { getYnmOptIn, ynmOverlapFor } from './ynmService';
import { pairKeyFor } from './togetherService';
import { listRelationships } from '../people';

// ── The grounding pack (58 §3.9) — zero extra AI spend, all cached/deterministic reads ────────────
// Opens every couples prompt with what SelfOS already knows about the RELATIONSHIP, so the coach "already
// knows" the pair. v1 = each participant's cached relationship synthesis (54) + the pair's latest compat
// alignment report (08). Agreements (Phase D), open joint challenges (Phase H), and pulse movement (Phase G)
// are added in their phases (progressive assembly — no dead grounding lines before their data source exists).
// Known v1 limit (§8.6): because twin sexual facts are restricted, this carries RELATIONAL continuity, not
// sexual detail — desire-topic continuity deliberately resets each session.

/** The most recent compatibility AlignmentReport whose two participants are exactly this pair; null if none. */
async function latestAlignmentSummary(
  fs: FileSystem,
  key: Uint8Array,
  participantIds: string[],
): Promise<string | null> {
  const pair = new Set(participantIds);
  const byGroup = new Map<string, Set<string>>();
  for (const a of await listAssignments(fs, key)) {
    if (!a.compatibilityGroupId) continue;
    const people = byGroup.get(a.compatibilityGroupId) ?? new Set<string>();
    people.add(a.senderPersonId);
    if (a.recipient.kind === 'person') people.add(a.recipient.personId);
    byGroup.set(a.compatibilityGroupId, people);
  }
  let best: { summary: string; generatedAt: string } | null = null;
  for (const [groupId, people] of byGroup) {
    if (people.size !== pair.size || ![...people].every((p) => pair.has(p))) continue;
    const report = await getAlignmentReport(fs, key, groupId);
    if (report && (!best || report.generatedAt > best.generatedAt)) {
      best = { summary: report.summary, generatedAt: report.generatedAt };
    }
  }
  return best?.summary ?? null;
}

/**
 * Assemble the grounding block for a session (or '' when there's nothing yet). `nameOf` resolves each
 * participant's display name (the bridge passes a resolver so this stays free of a people read here).
 */
export async function buildGroundingPack(
  fs: FileSystem,
  key: Uint8Array,
  session: TogetherSession,
  nameOf: (personId: string) => string,
): Promise<string> {
  const lines: string[] = [];

  // Each participant's cached relationship synthesis ABOUT each other participant (their own view of the
  // dynamic). Read-only; never generates. A person's own synthesis feeds only the grounding, never as a quote.
  for (const viewerId of session.participantIds) {
    for (const otherId of session.participantIds) {
      if (otherId === viewerId) continue;
      const synthesis = await getRelationshipSynthesis(fs, key, viewerId, otherId);
      if (synthesis && synthesis.observations.length > 0) {
        lines.push(
          `${nameOf(viewerId)}'s reflections on their relationship with ${nameOf(otherId)}:`,
        );
        for (const observation of synthesis.observations) lines.push(`  - ${observation}`);
      }
    }
  }

  const alignment = await latestAlignmentSummary(fs, key, session.participantIds);
  if (alignment) lines.push(`From a recent compatibility check between them: ${alignment}`);

  // Phase D: the pair's STANDING agreements (both see + edit them) so the coach honours what they've committed
  // to, and the most recent wrap-up summary for narrative continuity (relational, not sexual — §8.6).
  const standing = standingAgreements(await listAgreements(fs, key, session.pairKey));
  if (standing.length > 0) {
    lines.push('Standing agreements they’ve made together:');
    for (const a of standing) {
      lines.push(`  - ${a.text}${a.timeframe ? ` (${a.timeframe})` : ''}`);
    }
  }
  const lastReport = await getReport(fs, key, session.id);
  if (lastReport?.summary) {
    lines.push(`From their last wrap-up together: ${lastReport.summary}`);
  }

  // Phase F: the Yes/No/Maybe mutual overlap (§3.10b) feeds ONLY a Desire & intimacy guided session, and ONLY
  // when READY — both partners have opted in (symmetric consent) AND both have acknowledged adult content. The
  // edge is already verified (the session is accessible). Revoke → this drops immediately (live re-gate). The
  // list is items BOTH are ≥ "curious" about; one-sided answers are never revealed.
  const guide = session.guideId ? getTogetherGuide(session.guideId) : undefined;
  if (guide?.group === 'together-desire' && session.participantIds.length === 2) {
    const [a, b] = session.participantIds;
    if (a && b) {
      const pairKey = pairKeyFor(a, b);
      const [acked, aIn, bIn, rels] = await Promise.all([
        allAdultAcknowledged(fs, key, session.participantIds),
        getYnmOptIn(fs, key, a, pairKey),
        getYnmOptIn(fs, key, b, pairKey),
        listRelationships(fs, key),
      ]);
      // Defensive: re-check the live partner edge here too (this is a reusable core fn — don't rely solely on
      // the caller having verified it). A removed edge immediately re-gates the overlap feed.
      const edgeLive = rels.some(
        (r) =>
          r.type === 'partner' &&
          ((r.fromPersonId === a && r.toPersonId === b) ||
            (r.fromPersonId === b && r.toPersonId === a)),
      );
      const overlap = await ynmOverlapFor(fs, key, a, b, edgeLive && acked && aIn && bIn);
      if (overlap.ready && overlap.items.length > 0) {
        lines.push(
          'Their mutual Yes/No/Maybe list (both are at least curious about these — work ONLY from here, never reveal one-sided answers):',
        );
        for (const item of overlap.items) lines.push(`  - ${item.label}`);
      }
    }
  }

  if (lines.length === 0) return '';
  return [
    'What SelfOS already knows about this relationship (use it to ground your support — never quote it back verbatim):',
    ...lines,
  ].join('\n');
}
