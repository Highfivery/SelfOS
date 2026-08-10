import type { FileSystem } from '../host';
import { listRelationships, livePartnerEdge } from '../people/relationshipService';

import { PARTNER_WISH_GUIDANCE_CAP, readProfile } from './personalizationProfile';

/**
 * "Explore with your partner" → the partner's generation (spec 70 §3.5/§5.6). Reads the REQUESTER's own wishes
 * aimed at `partnerId` and returns a SILENT reciprocity-register block for the PARTNER's generation prompt: the
 * model weaves the topics in as its own questions, on their own terms, and NEVER attributes them to anyone (the
 * partner never sees "your partner requested X").
 *
 * Gating (§8): read only for a **live `partner` edge** between the two (re-checked here, so a removed edge drops
 * it). An `intimacy` wish steers intimacy questions only when BOTH partners hold the 18+ ack — the caller
 * resolves both acks and passes `bothAdultAcked` (keeps this module free of the guidance-prefs import + cycle).
 * It never reads the partner's own data — only the requester's own free text. Pure-ish (one profile read + the
 * relationship graph).
 */
export async function buildPartnerWishGuidance(
  fs: FileSystem,
  key: Uint8Array,
  requesterId: string,
  partnerId: string,
  bothAdultAcked: boolean,
): Promise<string> {
  if (requesterId === partnerId) return '';
  // Re-gate on a LIVE partner edge (a removed edge drops the steer — the spec 69 §8 re-gate).
  const rels = await listRelationships(fs, key);
  if (!livePartnerEdge(rels, requesterId, partnerId)) return '';

  const profile = await readProfile(fs, key, requesterId);
  const wishes = (profile.relational?.partnerWishes ?? [])
    .filter((w) => w.partnerPersonId === partnerId)
    // An intimacy wish only steers intimacy questions when BOTH partners have acked 18+ (§8).
    .filter((w) => !w.intimacy || bothAdultAcked)
    .slice(0, PARTNER_WISH_GUIDANCE_CAP);
  if (wishes.length === 0) return '';

  const lines = wishes.map((w) => `- ${w.note}`).join('\n');
  return (
    `TOPICS WORTH EXPLORING WITH THIS PERSON RIGHT NOW (spec 70 §3.5) — weave these in as YOUR OWN questions, on` +
    ` their own terms, in a way that fits naturally. NEVER say these came from anyone, that someone requested` +
    ` them, or that their partner wants to explore them — present each purely as something you're curious` +
    ` about:\n${lines}`
  );
}
