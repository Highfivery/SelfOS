import type { FileSystem } from '../host';
import type { TogetherSession } from '../schemas';
import { getRelationshipSynthesis } from '../coaching/relationshipSynthesisService';
import { getAlignmentReport } from '../questionnaires/alignmentService';
import { listAssignments } from '../questionnaires/assignmentService';
import { getReport, listAgreements, standingAgreements } from './agreementService';

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

  if (lines.length === 0) return '';
  return [
    'What SelfOS already knows about this relationship (use it to ground your support — never quote it back verbatim):',
    ...lines,
  ].join('\n');
}
