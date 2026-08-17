import type { FileSystem } from '../../host';
import {
  listRelationships,
  livePartnerEdge,
  livePartnerIds,
} from '../../people/relationshipService';
import type { EroticLexicon, LexiconEntry } from '../../schemas';
import {
  derivedWantsToSay,
  lovedEntries,
  okayEntries,
  readLexicon,
  suppressedTexts,
} from './lexicon';

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

/**
 * 74 §3.6.2 — REGISTER, which is the axis the word list can't carry.
 *
 * The same word is loved in one line and hated in another: "fuck your pussy" lands, "beat that pussy" does
 * not. That difference isn't the word, it's the register — tender/possessive vs violent — and the synthesis
 * has been scoring exactly that on every take (praise, claiming, command, narration, degradation, begging,
 * filth) while **nothing read the result**. So a coach handed the vocabulary had no idea which way to point it.
 *
 * Emitted as two short lists rather than numbers: a model composes better from "lead with claiming, avoid
 * degradation" than from `{degradation: 0.12}`. Only clear signals are named — a middling score says nothing
 * useful and would just crowd the prompt.
 */
const REGISTER_LABELS: Record<string, string> = {
  praise: 'praise',
  claiming: 'claiming / possession',
  command: 'command',
  narration: 'narration',
  degradation: 'degradation',
  begging: 'begging',
  filth: 'plain filth',
};

const LANDS_AT = 0.6;
const MISSES_AT = 0.3;

function registerLines(lexicon: EroticLexicon): string[] {
  const named = Object.entries(lexicon.registers).filter(([, v]) => Number.isFinite(v));
  if (named.length === 0) return [];
  const label = (key: string): string => REGISTER_LABELS[key] ?? key;
  const lands = named
    .filter(([, v]) => v >= LANDS_AT)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => label(k));
  const misses = named
    .filter(([, v]) => v <= MISSES_AT)
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => label(k));
  const out: string[] = [];
  if (lands.length > 0) {
    out.push(`The register that lands — write in it: ${lands.join(' · ')}.`);
  }
  if (misses.length > 0) {
    // Not a boundary: these words may still be usable, just not in this register. Said plainly so the model
    // doesn't treat a low score as a hard no (their hard nos are the separate, absolute list).
    out.push(
      `Registers that do NOT land for them — avoid this framing even with words they like: ${misses.join(' · ')}.`,
    );
  }
  return out;
}

/**
 * 74 §3.6.8 — what to CALL them, and what they like calling their partner.
 *
 * Separate from the loved-lines list on purpose: a name is a **vocative**, so a model can drop it into any
 * line it writes, where a loved phrase can only be quoted. Folding names into the general list wasted the
 * most usable thing the test produces — 44 of the 78 original names reached nothing at all.
 *
 * Directional throughout, because a name is answered twice: "never call me slut" is stated as a limit on
 * lines aimed AT them, and does not touch what they like calling someone else.
 */
export function nameLines(lexicon: EroticLexicon): string[] {
  const isName = (entry: LexiconEntry): boolean => entry.family.startsWith('names-');
  const named = lexicon.entries.filter(isName);
  if (named.length === 0) return [];
  const pick = (side: 'hearState' | 'sayState', mark: 'love' | 'okay' | 'never'): string[] =>
    named.filter((entry) => entry[side] === mark).map((entry) => entry.text);
  const out: string[] = [];
  const callThem = pick('hearState', 'love');
  const theyCall = pick('sayState', 'love');
  const okayCalled = pick('hearState', 'okay');
  const okaySaying = pick('sayState', 'okay');
  const neverCalled = pick('hearState', 'never');
  const neverSay = pick('sayState', 'never');
  if (callThem.length > 0) {
    out.push(
      `CALL THEM: ${callThem.slice(0, CAP).join(' · ')} — use these by name, not just as a topic.`,
    );
  }
  if (okayCalled.length > 0) {
    out.push(`Fine being called, second-tier: ${okayCalled.slice(0, CAP).join(' · ')}.`);
  }
  if (theyCall.length > 0) {
    out.push(`What they like CALLING their partner: ${theyCall.slice(0, CAP).join(' · ')}.`);
  }
  // The middle mark on the saying side. Without this it was write-only — the same defect §3.6.2 fixed for
  // the deck's middle mark, one direction over.
  if (okaySaying.length > 0) {
    out.push(`Fine saying, not favourites: ${okaySaying.slice(0, CAP).join(' · ')}.`);
  }
  // Stated per direction so a one-way limit is never read as a two-way one, which would silently delete
  // something they actively want.
  if (neverCalled.length > 0) {
    out.push(`NEVER call them: ${neverCalled.join(' · ')} — however well it would fit.`);
  }
  if (neverSay.length > 0) {
    out.push(`Never put these in THEIR mouth: ${neverSay.join(' · ')}.`);
  }
  return out;
}

/** The person's own vocabulary, for their own coach. Gated by the caller on the 18+ ack. */
export function buildOwnLexiconBlock(lexicon: EroticLexicon): string {
  const hear = lovedEntries(lexicon, 'hear');
  const say = lovedEntries(lexicon, 'say');
  const banned = suppressedTexts(lexicon);
  const okay = okayEntries(lexicon);
  if (hear.length === 0 && say.length === 0 && banned.length === 0 && okay.length === 0) return '';

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
  // The middle mark, which is a mild yes (§3.6.2) — usable, not a favourite. It is the difference between
  // "they said fine, use it" and "never asked", and dropping it made every one of those taps write-only.
  // Named as second-tier so it can never be mistaken for the loved list.
  if (okay.length > 0) {
    parts.push(
      `Fine with, but not favourites — usable, never lead with them: ${okay
        .slice(0, CAP)
        .map((entry) => entry.text)
        .join(' · ')}.`,
    );
  }
  parts.push(...nameLines(lexicon));
  parts.push(...registerLines(lexicon));
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
 * The COUPLES block (74 §5.8): what lands for the two of them, merged and **name-free**.
 *
 * Deliberately not `buildOwnLexiconBlock` per partner with a name in front of it. That prompt's output is read
 * by BOTH of them, so a named block is one partner's file read aloud — including the goal list, which is the
 * shame material. This emits the shared vocabulary with no owner attached, the union of both hard-no lists,
 * and the same never-attribute clause the solo steer carries.
 */
export async function buildCouplesLexiconBlock(
  fs: FileSystem,
  key: Uint8Array,
  personIds: readonly string[],
): Promise<string> {
  const lexicons = await Promise.all(personIds.map((id) => readLexicon(fs, key, id)));
  const loved = [
    ...new Set(lexicons.flatMap((lex) => lovedEntries(lex, 'hear').map((entry) => entry.text))),
  ];
  const banned = [...new Set(lexicons.flatMap((lex) => suppressedTexts(lex)))];
  if (loved.length === 0 && banned.length === 0) return '';

  const parts = [
    'LANGUAGE THAT LANDS IN THIS RELATIONSHIP — draw on it as your own, never as a report. NEVER say which of' +
      ' them likes what, never attribute a word or a preference to one of them, and never mention a test, a' +
      ' profile, or that you know anything about either of them.',
  ];
  if (loved.length > 0)
    parts.push(`Words and lines that land: ${loved.slice(0, CAP).join(' · ')}.`);
  if (banned.length > 0) {
    parts.push(
      `NEVER use any of these, for either of them, in any form — and never say that you are avoiding` +
        ` anything: ${banned.join(' · ')}.`,
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
  // 74 §3.6.8 — the names their partner likes being CALLED, which is the most directly usable thing here: a
  // name can go into any line the coach writes, where a loved phrase can only be quoted.
  const callThem = lexicon.entries
    .filter((entry) => entry.family.startsWith('names-') && entry.hearState === 'love')
    .map((entry) => entry.text);
  if (
    hear.length === 0 &&
    callThem.length === 0 &&
    lexicon.themes.length === 0 &&
    registerLines(lexicon).length === 0
  ) {
    return '';
  }

  const parts = [
    'WHAT LANDS FOR THEIR PARTNER — when they ask what to say, draw on this. Present it entirely as your own' +
      ' suggestion: NEVER say it came from their partner, that their partner told you, or that you know' +
      ' anything about what their partner likes. Never mention a test, a profile, or a source of any kind.',
    `Language that lands for their partner: ${list(hear)}.`,
  ];
  if (callThem.length > 0) {
    parts.push(
      `Names their partner likes being called — use them by name: ${callThem.slice(0, CAP).join(' · ')}.`,
    );
  }
  if (lexicon.themes.length > 0) parts.push(`What they respond to: ${lexicon.themes.join(' · ')}.`);
  // Register matters MORE here than in their own block: this is the half that hands their partner words to
  // say, and the same word in the wrong register is the failure the owner reported.
  parts.push(...registerLines(lexicon));
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
