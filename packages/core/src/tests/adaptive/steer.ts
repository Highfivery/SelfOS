import type { FileSystem } from '../../host';
import {
  listRelationships,
  livePartnerEdge,
  livePartnerIds,
} from '../../people/relationshipService';
import type { EroticLexicon, LexiconEntry } from '../../schemas';
import { derivedWantsToSay, lovedEntries, readLexicon, suppressedTexts } from './lexicon';

/**
 * 74 §5.7/§5.8 — where the lexicon goes.
 *
 * Three blocks, three different rules:
 *
 * 1. {@link buildOwnLexiconBlock} — the person's OWN coach, using their own words back to them. No secrecy
 *    involved; it is their profile.
 * 2. {@link buildPartnerSteer} — their partner's coach. **Silent** (the spec-70 `partnerWishes` precedent):
 *    never attributed, never announced, gated on a LIVE partner edge re-checked every call and on both 18+
 *    acks. The owner chose full fidelity — her own written words travel verbatim (74 §8.4) — so the honest
 *    part of that decision is stated in the take's intro rather than hidden here.
 * 3. {@link buildSuppressionBlock} — her hard nos, in HER PARTNER's prompt, **with or without any steer**.
 *    This is the one direction that needs no consent, because it only ever prevents a suggestion.
 */

/**
 * The live `partner` this person has, if any. The steer + the suppression both need it, and both re-derive it
 * on every call so a removed edge drops them immediately rather than leaving stale access behind.
 */
export async function livePartnerOf(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<string | null> {
  return livePartnerIds(await listRelationships(fs, key), personId)[0] ?? null;
}

/** How many entries of each kind reach a prompt. Personal enough to land, bounded enough to stay cheap. */
const CAP = 20;

function list(entries: LexiconEntry[]): string {
  return entries
    .slice(0, CAP)
    .map((entry) => entry.text)
    .join(' · ');
}

/** The person's own vocabulary, for their own coach. Gated by the caller on the 18+ ack. */
export function buildOwnLexiconBlock(lexicon: EroticLexicon): string {
  const hear = lovedEntries(lexicon, 'hear');
  const say = lovedEntries(lexicon, 'say');
  const banned = suppressedTexts(lexicon);
  if (hear.length === 0 && say.length === 0 && banned.length === 0) return '';

  const parts = ['THEIR OWN EROTIC LANGUAGE (from the Dirty Talk test — use it, in their words):'];
  if (hear.length > 0) parts.push(`Loves to hear: ${list(hear)}.`);
  if (say.length > 0) parts.push(`Comfortable saying: ${list(say)}.`);
  // DERIVED, not read off the record: the goal list is the hear/say gap, which exists the moment the bank is
  // marked — so this block is right mid-take as well as after synthesis.
  const goals = derivedWantsToSay(lexicon);
  if (goals.length > 0) {
    parts.push(
      `Wants to be able to say but freezes — treat as something to PRACTISE, never a failing: ${goals
        .slice(0, CAP)
        .join(' · ')}.`,
    );
  }
  if (lexicon.voice) parts.push(`How they want it said: ${lexicon.voice}`);
  if (lexicon.themes.length > 0) parts.push(`In their words: ${lexicon.themes.join(' · ')}.`);
  if (banned.length > 0) {
    parts.push(
      `NEVER use, in any form, however well it would fit — these are their hard limits: ${banned.join(' · ')}.`,
    );
  }
  return parts.join('\n');
}

/**
 * The SILENT partner steer. Reads the PARTNER's lexicon and returns guidance for the requester's coach, so a
 * suggestion lands in language their partner actually wants — without ever saying where it came from.
 *
 * Gating, all re-checked here so a removed edge or a revoked ack drops it on the very next call:
 * a live `partner` edge, and both 18+ acks (resolved by the caller, which owns the guidance-prefs read).
 */
export async function buildPartnerSteer(
  fs: FileSystem,
  key: Uint8Array,
  requesterId: string,
  partnerId: string,
  bothAdultAcked: boolean,
): Promise<string> {
  if (requesterId === partnerId || !bothAdultAcked) return '';
  const rels = await listRelationships(fs, key);
  if (!livePartnerEdge(rels, requesterId, partnerId)) return '';

  const lexicon = await readLexicon(fs, key, partnerId);
  const hear = lovedEntries(lexicon, 'hear');
  if (hear.length === 0 && lexicon.themes.length === 0) return '';

  const parts = [
    'WHAT LANDS FOR THEIR PARTNER — when they ask what to say, draw on this. Present it entirely as your own' +
      ' suggestion: NEVER say it came from their partner, that their partner told you, or that you know' +
      ' anything about what their partner likes. Never mention a test, a profile, or a source of any kind.',
    `Language that lands for their partner: ${list(hear)}.`,
  ];
  if (lexicon.themes.length > 0) parts.push(`What they respond to: ${lexicon.themes.join(' · ')}.`);
  if (lexicon.voice) parts.push(`How it should sound: ${lexicon.voice}`);
  return parts.join('\n');
}

/**
 * The partner's hard nos, as a negative constraint in the requester's prompt — **unconditional** (74 §8.4).
 *
 * This runs whether or not the steer does, because it can only ever prevent a suggestion: the coach may never
 * propose language their partner has said is off. Still gated on a live partner edge, since a suppression for
 * someone who is no longer their partner is just a leak with good manners.
 */
export async function buildSuppressionBlock(
  fs: FileSystem,
  key: Uint8Array,
  requesterId: string,
  partnerId: string,
): Promise<string> {
  if (requesterId === partnerId) return '';
  const rels = await listRelationships(fs, key);
  if (!livePartnerEdge(rels, requesterId, partnerId)) return '';
  const banned = suppressedTexts(await readLexicon(fs, key, partnerId));
  if (banned.length === 0) return '';
  return (
    'NEVER suggest any of the following to them, in any form — not as a line, an idea, or an example.' +
    ' Do not explain that you are avoiding anything, and never say why: ' +
    `${banned.join(' · ')}.`
  );
}
