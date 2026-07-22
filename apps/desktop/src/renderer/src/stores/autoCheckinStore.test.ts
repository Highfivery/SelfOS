import { afterEach, describe, expect, it } from 'vitest';
import { useAutoCheckinStore } from './autoCheckinStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useAutoCheckinStore.getState().reset();
});

/**
 * #314 / 08 §27.6 — since the generic-filler fallback was removed, "created nothing" has TWO distinct causes,
 * and the note must not misreport one as the other. Telling someone their "queue is already topped up" when
 * the real reason is that there was nothing worth asking is exactly the kind of dishonesty that made the
 * original behaviour feel broken.
 */
describe('autoCheckinStore — the manual run note', () => {
  it('says there is no new ground when the run skipped for that reason', async () => {
    installMockBridge({
      autoCheckinsRun: () =>
        Promise.resolve({
          ok: true,
          created: [],
          skipped: [{ targetId: 't-self', reason: 'no-new-topic' }],
        }),
    });
    await useAutoCheckinStore.getState().run({ auto: false });
    expect(useAutoCheckinStore.getState().lastRunNote).toMatch(/no new ground/i);
  });

  it('still says the queue is topped up when nothing was skipped for lack of ground', async () => {
    installMockBridge({
      autoCheckinsRun: () => Promise.resolve({ ok: true, created: [], skipped: [] }),
    });
    await useAutoCheckinStore.getState().run({ auto: false });
    expect(useAutoCheckinStore.getState().lastRunNote).toMatch(/already topped up/i);
  });

  it('reports what it added when it did create check-ins', async () => {
    installMockBridge({
      autoCheckinsRun: () =>
        Promise.resolve({
          ok: true,
          created: [
            {
              targetId: 't-self',
              intent: 'intimacy',
              questionnaireId: 'q1',
              assignmentId: 'a1',
              recipientPersonId: 'p1',
              title: 'T',
              rationale: 'R',
            },
          ],
          skipped: [{ targetId: 't-self', reason: 'no-new-topic' }],
        }),
    });
    await useAutoCheckinStore.getState().run({ auto: false });
    // A partial run (one slot delivered, one skipped) leads with what LANDED, not the skip.
    expect(useAutoCheckinStore.getState().lastRunNote).toMatch(/Added 1 new check-in/);
  });

  it('stays silent on an automatic run (the cadence must never chatter)', async () => {
    installMockBridge({
      autoCheckinsRun: () =>
        Promise.resolve({
          ok: true,
          created: [],
          skipped: [{ targetId: 't-self', reason: 'no-new-topic' }],
        }),
    });
    await useAutoCheckinStore.getState().run({ auto: true });
    expect(useAutoCheckinStore.getState().lastRunNote).toBeNull();
  });
});
