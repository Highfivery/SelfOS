import type { FileSystem } from '../host';
import { listRelationships } from '../people/relationshipService';
import { getPerson } from '../people/peopleService';
import { allAdultAcknowledged } from '../together/adultGate';
import { getYnmOptIn, ynmOverlapFor } from '../together/ynmService';
import { pairKeyFor } from '../together/togetherService';
import { getIntakeSession, submitSectionForm } from '../intake/intakeService';
import { resolveIntakeActivityRows } from '../intimacy/activityRows';
import {
  matrixRowKey,
  matrixRowLabel,
  type IntakeAnswerValue,
  type IntimacyInventoryOffer,
} from '../schemas';
import { listSentSuggestions } from './emailSuggestionService';
import { listEmailResponses, isTakenUp } from './emailResponse';

/**
 * The intimacy slot of the email suggestion engine (67 §8.2). An E-int email is gated, shared-data-only, and
 * consented on BOTH sides: both partners 18+-acked, both opted into sharing their intimacy inventory (the
 * Together Yes/No/Maybe opt-in — the exact mutual-consent mechanism), and a non-empty MUTUAL "both into it /
 * curious" overlap from the intake ratings (`computeYnmOverlap`). The recipient's distinct intimacy-EMAIL
 * opt-in is checked separately at the reconcile (wanting explicit content in-app ≠ wanting it in the inbox).
 * Re-checked live every run — a partner→ex change or a removed opt-in revokes it immediately.
 */

/** A person's live partner-type relations (67 §8.2 — couple suggestions read a partner, not any relation). */
export async function listEmailPartners(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<{ id: string; displayName: string }[]> {
  const rels = await listRelationships(fs, key);
  const partnerIds = new Set<string>();
  for (const r of rels) {
    if (r.type !== 'partner') continue;
    if (r.fromPersonId === personId) partnerIds.add(r.toPersonId);
    else if (r.toPersonId === personId) partnerIds.add(r.fromPersonId);
  }
  const out: { id: string; displayName: string }[] = [];
  for (const id of partnerIds) {
    const person = await getPerson(fs, key, id); // a stale/removed id resolves to null → dropped
    if (person) out.push({ id, displayName: person.displayName });
  }
  return out;
}

/** The eligible-intimacy result for one recipient: the partner to build a mutual suggestion for + the shared acts. */
export interface IntimacyEmailTarget {
  partnerId: string;
  partnerName: string;
  /** A stable pairing key for the couple's two suggestion copies (mutual green light). */
  sharedSuggestionKey: string;
  /** The MUTUAL, consented "both into it / curious" acts (shared-data-only). */
  overlap: { key: string; label: string }[];
}

/**
 * Resolve the first partner for whom an intimacy email is fully eligible + has a non-empty shared signal
 * (67 §8.2), or null. Every gate is re-checked live: both 18+ acked, both Yes/No/Maybe opted-in (the
 * consented shared-data mechanism), and a non-empty mutual overlap. The recipient's `intimacyEmailOptIn`
 * is the caller's responsibility (checked at the reconcile alongside the family toggle).
 */
export async function resolveIntimacyEmailTarget(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<IntimacyEmailTarget | null> {
  for (const partner of await listEmailPartners(fs, key, personId)) {
    const pairKey = pairKeyFor(personId, partner.id);
    const bothAcked = await allAdultAcknowledged(fs, key, [personId, partner.id]);
    if (!bothAcked) continue;
    const [mine, theirs] = await Promise.all([
      getYnmOptIn(fs, key, personId, pairKey),
      getYnmOptIn(fs, key, partner.id, pairKey),
    ]);
    if (!mine || !theirs) continue; // shared intimacy data not consented on both sides
    const overlap = await ynmOverlapFor(fs, key, personId, partner.id, true);
    if (!overlap.ready || overlap.items.length === 0) continue;
    return {
      partnerId: partner.id,
      partnerName: partner.displayName,
      sharedSuggestionKey: `intimacy:${pairKey}`,
      overlap: overlap.items,
    };
  }
  return null;
}

/** The top rating on the intake activity matrix (the "into it / love it" pole). */
const INTO_IT_RATING = 5;

/** Read the person's intimacy activity ratings from their intake (the `activities` matrix), keyed by rowKey. */
async function readActivityMatrix(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<Record<string, number>> {
  let session = null;
  try {
    session = await getIntakeSession(fs, key, personId);
  } catch {
    return {};
  }
  const answer = session?.sections.find((s) => s.id === 'intimacy')?.answers['activities'];
  if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
    const out: Record<string, number> = {};
    for (const [rowKey, value] of Object.entries(answer as Record<string, unknown>))
      if (typeof value === 'number' && Number.isFinite(value)) out[rowKey] = value;
    return out;
  }
  return {};
}

/** rowKey → display label from the neutral default activity rows. */
function activityLabels(): Map<string, string> {
  const labels = new Map<string, string>();
  for (const row of resolveIntakeActivityRows({}))
    labels.set(matrixRowKey(row), matrixRowLabel(row));
  return labels;
}

/**
 * The pending intimacy-inventory-update offers (67 §3.6) — for each act the person tapped `im-game` on via an
 * intimacy email but hasn't yet marked "into it" in their inventory, an offer to bump it. NEVER a silent
 * write: this only surfaces the offer; `applyIntimacyInventoryOffer` performs the (explicit-confirm) write.
 * Self-resolving: once applied, the rating equals the top and the offer disappears (idempotent, no flag).
 */
export async function listIntimacyInventoryOffers(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<IntimacyInventoryOffer[]> {
  const [suggestions, responses, ratings] = await Promise.all([
    listSentSuggestions(fs, key, personId, 'ai-suggestion-intimacy'),
    listEmailResponses(fs, key, personId),
    readActivityMatrix(fs, key, personId),
  ]);
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const labels = activityLabels();
  const seen = new Set<string>();
  const offers: IntimacyInventoryOffer[] = [];
  for (const r of responses) {
    if (r.family !== 'ai-suggestion-intimacy' || !isTakenUp(r) || !r.suggestionId) continue;
    const actKey = byId.get(r.suggestionId)?.subjectKey;
    if (!actKey || seen.has(actKey)) continue;
    seen.add(actKey);
    const current = ratings[actKey] ?? 0;
    if (current < INTO_IT_RATING)
      offers.push({ actKey, actLabel: labels.get(actKey) ?? actKey, currentRating: current });
  }
  return offers;
}

/**
 * Apply an intimacy-inventory-update offer (67 §3.6) — the explicit in-app confirm. Bumps the one act's
 * rating to the top in the person's own intake `activities` matrix (merging, never wiping siblings), via the
 * ordinary intake write path (`submitSectionForm`, a non-completing draft). Returns false if the act is
 * unknown to the inventory. Own-data only; the bridge gates it on the active person.
 */
export async function applyIntimacyInventoryOffer(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  actKey: string,
  now: Date,
): Promise<boolean> {
  if (!activityLabels().has(actKey)) return false;
  const ratings = await readActivityMatrix(fs, key, personId);
  const next: Record<string, number> = { ...ratings, [actKey]: INTO_IT_RATING };
  await submitSectionForm(
    fs,
    key,
    personId,
    'intimacy',
    { activities: next as unknown as IntakeAnswerValue },
    now,
    undefined,
    false,
  );
  return true;
}
