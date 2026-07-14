import type { FileSystem } from '../host';
import { uuid } from '../id';
import { AgreementSchema, SharedReportSchema, type Agreement, type SharedReport } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { pairKeyFor } from './togetherService';

// ── Pair agreements ledger + the shared wrap-up report (58 §3.8/§3.9) ─────────────────────────────
// Agreements live at the PAIR level (together/pairs/<pairKey>/agreements/<id>.enc) — the one deliberate
// two-editor record (either partner edits/retires; last-write-wins accepted, §7). The report lives in the
// session folder (together/sessions/<id>/report.enc, one writer: whoever runs wrap-up; idempotent re-run).
// Staleness is DERIVED (§3.8), never stored.

const PAIRS_ROOT = 'together/pairs';

/** An id we minted is safe (traversal defense — the `isMediaPath` habit). */
function isSafeSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment);
}
/** A pairKey is two safe ids joined by `~` (`pairKeyFor`) — path-safe, no traversal. */
function isSafePairKey(pairKey: string): boolean {
  const parts = pairKey.split('~');
  return parts.length === 2 && parts.every(isSafeSegment);
}

function agreementsDir(pairKey: string): string {
  return `${PAIRS_ROOT}/${pairKey}/agreements`;
}
function agreementPath(pairKey: string, id: string): string {
  return `${agreementsDir(pairKey)}/${id}.enc`;
}
function reportPath(sessionId: string): string {
  return `together/sessions/${sessionId}/report.enc`;
}

// ── The shared report ─────────────────────────────────────────────────────────────────────────────

export async function saveReport(
  fs: FileSystem,
  key: Uint8Array,
  report: SharedReport,
): Promise<void> {
  await writeEncryptedJson(fs, reportPath(report.sessionId), report, key);
}

export async function getReport(
  fs: FileSystem,
  key: Uint8Array,
  sessionId: string,
): Promise<SharedReport | null> {
  if (!isSafeSegment(sessionId)) return null;
  try {
    const raw = await readEncryptedJson(fs, reportPath(sessionId), key);
    return raw ? SharedReportSchema.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The report is stale when any human message in the session is newer than `report.createdAt` (§3.8) — derived,
 * never stored, so continuing a completed session (writing a new message) makes it derive stale automatically.
 */
export function isReportStale(report: SharedReport | null, newestHumanTs: string | null): boolean {
  if (!report) return false;
  if (!newestHumanTs) return false;
  return newestHumanTs > report.createdAt;
}

// ── The pair agreements ledger ──────────────────────────────────────────────────────────────────

/** Every agreement for a pair, newest-first; a corrupt entry is skipped (never fails the ledger). */
export async function listAgreements(
  fs: FileSystem,
  key: Uint8Array,
  pairKey: string,
): Promise<Agreement[]> {
  if (!isSafePairKey(pairKey)) return [];
  const out: Agreement[] = [];
  for (const name of await fs.list(agreementsDir(pairKey))) {
    if (!name.endsWith('.enc')) continue;
    try {
      const raw = await readEncryptedJson(fs, `${agreementsDir(pairKey)}/${name}`, key);
      if (raw) out.push(AgreementSchema.parse(raw));
    } catch {
      // Skip a corrupt agreement; the ledger still renders (§7).
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAgreement(
  fs: FileSystem,
  key: Uint8Array,
  pairKey: string,
  id: string,
): Promise<Agreement | null> {
  if (!isSafePairKey(pairKey) || !isSafeSegment(id)) return null;
  try {
    const raw = await readEncryptedJson(fs, agreementPath(pairKey, id), key);
    return raw ? AgreementSchema.parse(raw) : null;
  } catch {
    return null;
  }
}

export interface SaveAgreementInput {
  id?: string;
  text: string;
  timeframe?: string;
  status: Agreement['status'];
  sessionId: string;
}

/**
 * Create or update (inline edit / retire — §11 #2) a pair agreement. Last-write-wins on the shared record: an
 * edit preserves `createdAt` + the origin provenance, bumping `updatedAt`. A new agreement stamps its origin
 * session. Idempotent by id.
 */
export async function saveAgreement(
  fs: FileSystem,
  key: Uint8Array,
  personA: string,
  personB: string,
  input: SaveAgreementInput,
  now: Date,
): Promise<Agreement | null> {
  const pairKey = pairKeyFor(personA, personB);
  if (!isSafePairKey(pairKey)) return null;
  const at = now.toISOString();
  const text = input.text.trim();
  if (!text) return null;
  const id = input.id ?? uuid();
  if (!isSafeSegment(id)) return null;
  const existing = input.id ? await getAgreement(fs, key, pairKey, id) : null;
  const agreement: Agreement = {
    id,
    schemaVersion: 1,
    pairKey,
    text,
    ...(input.timeframe && input.timeframe.trim() ? { timeframe: input.timeframe.trim() } : {}),
    status: input.status,
    provenance: existing?.provenance ?? { sessionId: input.sessionId, at },
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  await writeEncryptedJson(fs, agreementPath(pairKey, id), agreement, key);
  return agreement;
}

/** Capture an agreement from a coach `[[SELFOS:AGREEMENT]]` marker (§6.4) — a new standing agreement. */
export async function captureAgreementFromMarker(
  fs: FileSystem,
  key: Uint8Array,
  personA: string,
  personB: string,
  marker: { text: string; timeframe?: string },
  sessionId: string,
  now: Date,
): Promise<Agreement | null> {
  return saveAgreement(
    fs,
    key,
    personA,
    personB,
    {
      text: marker.text,
      ...(marker.timeframe ? { timeframe: marker.timeframe } : {}),
      status: 'standing',
      sessionId,
    },
    now,
  );
}

/** Standing agreements only (the Together home strip count + the grounding pack, §3.9). */
export function standingAgreements(agreements: Agreement[]): Agreement[] {
  return agreements.filter((a) => a.status === 'standing');
}

/** A viewer's standing agreement surfaced outside its session (spec 61) — the partner id resolved. */
export interface StandingAgreementForViewer {
  agreement: Agreement;
  partnerPersonId: string;
}

/**
 * Every STANDING agreement across the viewer's pairs (spec 61) — for surfacing outside a session (the Home
 * needs-attention queue + the Goals "Together commitments" section). Lists `together/pairs/`, keeps only
 * pairs the viewer is a member of, resolves the partner id (the other segment of the pairKey), and returns
 * their standing agreements newest-first. Display-name resolution is the bridge's job (it has people
 * access). The bridge scopes to the active person, so this only reaches pairs the viewer belongs to.
 */
export async function listStandingAgreementsForViewer(
  fs: FileSystem,
  key: Uint8Array,
  viewerId: string,
): Promise<StandingAgreementForViewer[]> {
  if (!isSafeSegment(viewerId)) return [];
  const out: StandingAgreementForViewer[] = [];
  for (const pairKey of await fs.list(PAIRS_ROOT)) {
    if (!isSafePairKey(pairKey)) continue;
    // isSafePairKey guarantees exactly two `~`-split ids.
    const [first, second] = pairKey.split('~');
    if (first === undefined || second === undefined) continue;
    if (first !== viewerId && second !== viewerId) continue;
    const partnerPersonId = first === viewerId ? second : first;
    for (const agreement of standingAgreements(await listAgreements(fs, key, pairKey))) {
      out.push({ agreement, partnerPersonId });
    }
  }
  return out.sort((a, b) => b.agreement.createdAt.localeCompare(a.agreement.createdAt));
}
