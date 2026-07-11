import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import type { Insight } from '../schemas';
import { saveInsight } from '../insights';
import { pairKeyFor } from './togetherService';
import { buildPulseView, listPulseCheckIns, logPulseCheckIn } from './pulseService';

const key = generateMasterKey();
const BEN = 'ben';
const ANGEL = 'angel';

function at(iso: string): Date {
  return new Date(iso);
}

async function seedTwin(
  fs: FileSystem,
  subjectId: string,
  metrics: { connectionValence: number; frictionLevel: number },
  createdAt: string,
): Promise<void> {
  const twin: Insight = {
    id: `twin-${subjectId}-${createdAt}`,
    schemaVersion: 1,
    source: 'together',
    subjectPersonId: subjectId,
    summary: 'A Together session reflection.',
    facts: [],
    metrics,
    confidence: 'medium',
    categories: ['Relationships'],
    approved: true,
    provenance: { togetherSessionId: 'sess-1', pairKey: pairKeyFor(BEN, ANGEL), at: createdAt },
    createdAt,
    updatedAt: createdAt,
  };
  await saveInsight(fs, key, twin);
}

describe('pulse check-ins (§3.10a)', () => {
  it('logs a check-in, clamps metrics to 0..1, and lists oldest-first', async () => {
    const fs = memFileSystem();
    await logPulseCheckIn(
      fs,
      key,
      BEN,
      ANGEL,
      { connection: 1.5, desire: -0.3 },
      undefined,
      at('2026-07-10T10:00:00Z'),
    );
    await logPulseCheckIn(
      fs,
      key,
      BEN,
      ANGEL,
      { connection: 0.4 },
      undefined,
      at('2026-07-11T10:00:00Z'),
    );
    const list = await listPulseCheckIns(fs, key, BEN, pairKeyFor(BEN, ANGEL));
    expect(list.length).toBe(2);
    expect(list[0]!.at < list[1]!.at).toBe(true);
    expect(list[0]!.metrics['connection']).toBe(1); // clamped from 1.5
    expect(list[0]!.metrics['desire']).toBe(0); // clamped from -0.3
  });

  it('drops a check-in with no finite metrics', async () => {
    const fs = memFileSystem();
    const r = await logPulseCheckIn(
      fs,
      key,
      BEN,
      ANGEL,
      { connection: NaN },
      undefined,
      at('2026-07-10T10:00:00Z'),
    );
    expect(r).toBeNull();
    expect(await listPulseCheckIns(fs, key, BEN, pairKeyFor(BEN, ANGEL))).toHaveLength(0);
  });

  it("surfaces the viewer's own metric trends but never the partner's raw metrics", async () => {
    const fs = memFileSystem();
    await logPulseCheckIn(
      fs,
      key,
      BEN,
      ANGEL,
      { connection: 0.2, satisfaction: 0.9 },
      undefined,
      at('2026-07-10T10:00:00Z'),
    );
    await logPulseCheckIn(
      fs,
      key,
      BEN,
      ANGEL,
      { connection: 0.8 },
      undefined,
      at('2026-07-11T10:00:00Z'),
    );
    // Angel logs her own — must not appear in Ben's series.
    await logPulseCheckIn(
      fs,
      key,
      ANGEL,
      BEN,
      { connection: 0.1 },
      undefined,
      at('2026-07-11T11:00:00Z'),
    );
    const view = await buildPulseView(fs, key, BEN, ANGEL);
    expect(view.hasCheckIns).toBe(true);
    const connection = view.series.find((s) => s.label === 'Connection');
    expect(connection?.points.map((p) => p.y)).toEqual([0.2, 0.8]); // Ben's only, rising
    expect(connection?.direction).toBe('rising');
  });

  it('folds the pair wrap-up twins into dyad session series (normalized ±1 → 0..1)', async () => {
    const fs = memFileSystem();
    await seedTwin(fs, BEN, { connectionValence: -1, frictionLevel: 1 }, '2026-07-01T00:00:00Z');
    await seedTwin(fs, BEN, { connectionValence: 1, frictionLevel: -1 }, '2026-07-05T00:00:00Z');
    const view = await buildPulseView(fs, key, BEN, ANGEL);
    const conn = view.series.find((s) => s.label === 'Connection (sessions)');
    expect(conn?.points.map((p) => p.y)).toEqual([0, 1]); // -1→0, 1→1
    const friction = view.series.find((s) => s.label === 'Friction (sessions)');
    expect(friction?.points.map((p) => p.y)).toEqual([1, 0]);
  });
});

describe('the desire alignment (§3.10a — dual consent)', () => {
  it('stays hidden until BOTH log a desire value AND both consent to share it', async () => {
    const fs = memFileSystem();
    // Ben shares his desire.
    await logPulseCheckIn(
      fs,
      key,
      BEN,
      ANGEL,
      { desire: 0.8 },
      ['desire'],
      at('2026-07-10T10:00:00Z'),
    );
    let view = await buildPulseView(fs, key, BEN, ANGEL);
    expect(view.alignment.ready).toBe(false); // Angel hasn't shared

    // Angel logs desire but does NOT consent to share.
    await logPulseCheckIn(
      fs,
      key,
      ANGEL,
      BEN,
      { desire: 0.7 },
      undefined,
      at('2026-07-10T11:00:00Z'),
    );
    view = await buildPulseView(fs, key, BEN, ANGEL);
    expect(view.alignment.ready).toBe(false); // still hidden

    // Angel now consents.
    await logPulseCheckIn(
      fs,
      key,
      ANGEL,
      BEN,
      { desire: 0.75 },
      ['desire'],
      at('2026-07-11T11:00:00Z'),
    );
    view = await buildPulseView(fs, key, BEN, ANGEL);
    expect(view.alignment.ready).toBe(true);
    expect(view.alignment.yours).toBe(0.8);
    expect(view.alignment.theirs).toBe(0.75);
    expect(view.alignment.read).toBe('aligned'); // |0.8-0.75| <= 0.25
  });

  it('reads "some distance" when the shared desire values diverge', async () => {
    const fs = memFileSystem();
    await logPulseCheckIn(
      fs,
      key,
      BEN,
      ANGEL,
      { desire: 0.9 },
      ['desire'],
      at('2026-07-10T10:00:00Z'),
    );
    await logPulseCheckIn(
      fs,
      key,
      ANGEL,
      BEN,
      { desire: 0.2 },
      ['desire'],
      at('2026-07-10T11:00:00Z'),
    );
    const view = await buildPulseView(fs, key, BEN, ANGEL);
    expect(view.alignment.ready).toBe(true);
    expect(view.alignment.read).toBe('some distance');
  });

  it("a viewer who shared but whose partner's latest desire check-in withdrew consent sees it hidden again", async () => {
    const fs = memFileSystem();
    await logPulseCheckIn(
      fs,
      key,
      BEN,
      ANGEL,
      { desire: 0.6 },
      ['desire'],
      at('2026-07-10T10:00:00Z'),
    );
    await logPulseCheckIn(
      fs,
      key,
      ANGEL,
      BEN,
      { desire: 0.6 },
      ['desire'],
      at('2026-07-10T11:00:00Z'),
    );
    expect((await buildPulseView(fs, key, BEN, ANGEL)).alignment.ready).toBe(true);
    // Angel's newest check-in no longer shares desire → the latest-consented read is gone.
    await logPulseCheckIn(
      fs,
      key,
      ANGEL,
      BEN,
      { desire: 0.6 },
      undefined,
      at('2026-07-12T11:00:00Z'),
    );
    expect((await buildPulseView(fs, key, BEN, ANGEL)).alignment.ready).toBe(false);
  });
});
