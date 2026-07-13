import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  PULSE_METRICS,
  PULSE_METRIC_LABELS,
  PulseCheckInSchema,
  type PulseAlignment,
  type PulseCheckIn,
  type PulseSeries,
  type TogetherPulseView,
} from '../schemas';
import { listInsightsForPerson } from '../insights';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { pairKeyFor } from './togetherService';

// ── Pulse (58 §3.10a — absorbs spec 11) — the couples dyad-metric trend + a frictionless check-in ────
// A person's own check-ins live at people/<logger>/together/pulse/<pairKey>/<id>.enc (one writer per file).
// The Pulse view assembles the viewer's OWN metric trends + the dyad Connection/Friction from the wrap-up
// twins (Phase D), and — ONLY when both partners logged AND both CONSENTED to share `desire` — the desire
// alignment (the 11 §3.1 both-answer/dual-consent gate; never inferred, hidden until then).

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const clampUnitToUnitInterval = (n: number): number => clamp01((n + 1) / 2); // ±1 dyad metric → 0..1

function isSafeSegment(s: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(s);
}
function isSafePairKey(pairKey: string): boolean {
  const parts = pairKey.split('~');
  return parts.length === 2 && parts.every(isSafeSegment);
}
function pulseDir(personId: string, pairKey: string): string {
  return `people/${personId}/together/pulse/${pairKey}`;
}

/** Log a pulse check-in (§3.10a) — the logger's OWN perception; metrics clamped to 0..1. */
export async function logPulseCheckIn(
  fs: FileSystem,
  key: Uint8Array,
  loggerPersonId: string,
  partnerPersonId: string,
  metrics: Record<string, number>,
  shareMetrics: string[] | undefined,
  now: Date,
): Promise<PulseCheckIn | null> {
  const pairKey = pairKeyFor(loggerPersonId, partnerPersonId);
  if (!isSafeSegment(loggerPersonId) || !isSafePairKey(pairKey)) return null;
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(metrics)) {
    if (typeof v === 'number' && Number.isFinite(v)) clean[k] = clamp01(v);
  }
  if (Object.keys(clean).length === 0) return null;
  const at = now.toISOString();
  const checkIn: PulseCheckIn = {
    id: uuid(),
    schemaVersion: 1,
    pairKey,
    loggerPersonId,
    at,
    metrics: clean,
    ...(shareMetrics && shareMetrics.length > 0 ? { shareMetrics } : {}),
    createdAt: at,
    updatedAt: at,
  };
  await writeEncryptedJson(
    fs,
    `${pulseDir(loggerPersonId, pairKey)}/${checkIn.id}.enc`,
    checkIn,
    key,
  );
  return checkIn;
}

/** A person's own pulse check-ins for a pair, oldest-first; a corrupt entry is skipped. */
export async function listPulseCheckIns(
  fs: FileSystem,
  key: Uint8Array,
  loggerPersonId: string,
  pairKey: string,
): Promise<PulseCheckIn[]> {
  if (!isSafeSegment(loggerPersonId) || !isSafePairKey(pairKey)) return [];
  const out: PulseCheckIn[] = [];
  for (const name of await fs.list(pulseDir(loggerPersonId, pairKey))) {
    if (!name.endsWith('.enc')) continue;
    try {
      const raw = await readEncryptedJson(fs, `${pulseDir(loggerPersonId, pairKey)}/${name}`, key);
      const parsed = raw ? PulseCheckInSchema.safeParse(raw) : null;
      if (parsed?.success) out.push(parsed.data);
    } catch {
      // Skip a corrupt check-in; the trend still renders.
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

function direction(points: { y: number }[]): PulseSeries['direction'] {
  if (points.length < 2) return 'flat';
  const first = points[0]!.y;
  const last = points[points.length - 1]!.y;
  const delta = last - first;
  if (delta > 0.05) return 'rising';
  if (delta < -0.05) return 'dipping';
  return 'steady';
}

/** A metric's series from a set of check-ins (x = ms timestamp, y = 0..1), oldest-first. */
function metricSeries(label: string, checkIns: PulseCheckIn[], metric: string): PulseSeries | null {
  const points: { x: number; y: number }[] = [];
  for (const c of checkIns) {
    const v = c.metrics[metric];
    if (typeof v === 'number' && Number.isFinite(v)) {
      points.push({ x: Date.parse(c.at) || 0, y: clamp01(v) });
    }
  }
  if (points.length === 0) return null;
  return { label, points, direction: direction(points) };
}

/**
 * Assemble the Pulse view for a viewer + partner (§3.10a). Series: the viewer's own check-in metrics + the
 * dyad Connection/Friction from the viewer's wrap-up twins for this pair (normalized 0..1). Alignment: the
 * dual-consent desire comparison — only when BOTH logged AND both consented to share `desire`.
 */
export async function buildPulseView(
  fs: FileSystem,
  key: Uint8Array,
  viewer: string,
  partner: string,
): Promise<TogetherPulseView> {
  const pairKey = pairKeyFor(viewer, partner);
  const [own, twins] = await Promise.all([
    listPulseCheckIns(fs, key, viewer, pairKey),
    listInsightsForPerson(fs, key, viewer),
  ]);

  const series: PulseSeries[] = [];
  for (const metric of PULSE_METRICS) {
    const s = metricSeries(PULSE_METRIC_LABELS[metric], own, metric);
    if (s) series.push(s);
  }

  // The viewer's OWN wrap-up-twin Connection/Friction for THIS pair (Phase D) — the viewer's private
  // reflection of the session, NOT the partner's data — normalized ±1 → 0..1, oldest-first.
  const pairTwins = twins
    .filter((i) => i.source === 'together' && i.provenance.pairKey === pairKey && i.metrics)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const [metric, label] of [
    ['connectionValence', 'Connection (sessions)'],
    ['frictionLevel', 'Friction (sessions)'],
  ] as const) {
    const points = pairTwins
      .filter((i) => typeof i.metrics?.[metric] === 'number')
      .map((i) => ({
        x: Date.parse(i.createdAt) || 0,
        y: clampUnitToUnitInterval(i.metrics![metric]!),
      }));
    if (points.length > 0) series.push({ label, points, direction: direction(points) });
  }

  const alignment = await desireAlignment(fs, key, partner, pairKey, own);
  // `own` is oldest-first (listPulseCheckIns sorts ascending), so the last entry is the most recent.
  const lastCheckInAt = own.at(-1)?.at;
  return {
    series,
    hasCheckIns: own.length > 0,
    ...(lastCheckInAt ? { lastCheckInAt } : {}),
    alignment,
  };
}

/**
 * The desire-alignment comparative (§3.10a) — computed ONLY when BOTH partners have logged a check-in whose
 * `desire` metric they CONSENTED to share (shareMetrics includes 'desire'). Otherwise hidden (`ready:false`).
 * Reads the partner's check-ins solely to surface their latest CONSENTED desire value — never any other metric.
 */
async function desireAlignment(
  fs: FileSystem,
  key: Uint8Array,
  partner: string,
  pairKey: string,
  ownCheckIns: PulseCheckIn[],
): Promise<PulseAlignment> {
  const latestSharedDesire = (checkIns: PulseCheckIn[]): number | null => {
    // The MOST-RECENT desire reading governs consent: find the newest check-in that carries a desire value,
    // and surface it only if THAT check-in consents to share. So logging a fresh check-in WITHOUT sharing
    // desire retracts visibility — the intuitive privacy model, not a stale older opt-in lingering forever.
    for (let i = checkIns.length - 1; i >= 0; i--) {
      const c = checkIns[i]!;
      if (typeof c.metrics['desire'] !== 'number') continue;
      return (c.shareMetrics ?? []).includes('desire') ? clamp01(c.metrics['desire']) : null;
    }
    return null;
  };
  const yours = latestSharedDesire(ownCheckIns);
  if (yours === null) return { ready: false };
  const partnerCheckIns = await listPulseCheckIns(fs, key, partner, pairKey);
  const theirs = latestSharedDesire(partnerCheckIns);
  if (theirs === null) return { ready: false };
  return {
    ready: true,
    yours,
    theirs,
    read: Math.abs(yours - theirs) <= 0.25 ? 'aligned' : 'some distance',
  };
}
