import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockBridge } from '../test-utils/bridge';
import { useAdaptiveTestStore } from './adaptiveTestStore';

/**
 * 74 §3.4 — the autosave's failure modes. These are the ones that are invisible in the UI and only show up
 * as data: a write that follows you into someone else's vault, a "Saved" over a write that never happened,
 * and two flushes racing each other so one mark quietly disappears.
 */

const DRAFT = {
  id: 'r1',
  schemaVersion: 1,
  testId: 'dirty-talk',
  testVersion: 1,
  subjectPersonId: 'p1',
  answers: [],
  scores: [],
  status: 'draft' as const,
  kind: 'adaptive' as const,
  takenAt: 'now',
  createdAt: 'now',
  updatedAt: 'now',
};

const STATE = {
  testId: 'dirty-talk',
  title: 'Dirty talk',
  blurb: '',
  framing: '',
  estimatedMinutes: 15,
  draft: DRAFT,
  latest: null,
  history: [],
  lexicon: {
    schemaVersion: 1,
    personId: 'p1',
    entries: [],
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    boundaries: [],
    updatedAt: 'now',
  },
  ambiguitiesLeft: 0,
  staleForRetake: false,
};

function seed(): void {
  useAdaptiveTestStore.setState({ state: STATE, activeTestId: 'dirty-talk', phase: 'bank' });
}

describe('the adaptive autosave', () => {
  beforeEach(() => {
    useAdaptiveTestStore.getState().reset();
    vi.useRealTimers();
  });

  it('does NOT write a pending mark after the person switches (the reset drops it)', async () => {
    const bank = vi.fn(() => Promise.resolve(STATE));
    installMockBridge({ testsAdaptiveBank: bank as never });
    seed();

    useAdaptiveTestStore.getState().mark('names-power:good-girl', 'hear', 'love');
    // Switching person is an in-app modal — the take stays mounted — and AppShell resets every per-person
    // store. The debounced write must die with it, or it lands in the NEXT person's lexicon.
    useAdaptiveTestStore.getState().reset();
    await useAdaptiveTestStore.getState().flush('dirty-talk');

    expect(bank).not.toHaveBeenCalled();
  });

  it('treats a refused write (null) as a failure, not a save', async () => {
    // Every handler returns null when its gate refuses — no throw. "Saved" over that is the worst lie here.
    installMockBridge({ testsAdaptiveBank: (() => Promise.resolve(null)) as never });
    seed();

    useAdaptiveTestStore.getState().mark('names-power:good-girl', 'hear', 'love');
    await useAdaptiveTestStore.getState().flush('dirty-talk');

    expect(useAdaptiveTestStore.getState().saveState).toBe('unsaved');
  });

  it('re-queues a failed write so the next flush carries it', async () => {
    const calls: unknown[] = [];
    let fail = true;
    installMockBridge({
      testsAdaptiveBank: ((input: unknown) => {
        calls.push(input);
        return Promise.resolve(fail ? null : STATE);
      }) as never,
    });
    seed();

    useAdaptiveTestStore.getState().mark('names-power:good-girl', 'hear', 'love');
    await useAdaptiveTestStore.getState().flush('dirty-talk');
    fail = false;
    await useAdaptiveTestStore.getState().flush('dirty-talk');

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ marks: { 'names-power:good-girl': { hear: 'love' } } });
    expect(useAdaptiveTestStore.getState().saveState).toBe('saved');
  });

  it('serializes overlapping flushes so neither delta is dropped', async () => {
    const seen: Record<string, unknown>[] = [];
    let open = 0;
    let maxOpen = 0;
    let release: null | (() => void) = null;
    installMockBridge({
      testsAdaptiveBank: ((input: Record<string, unknown>) => {
        seen.push(input);
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        // Hold the FIRST write open past the second tap — the exact shape of the race, where the second
        // flush would read the lexicon before the first one's write landed and drop its delta.
        if (seen.length === 1) {
          return new Promise<typeof STATE>((r) => {
            release = (): void => {
              open -= 1;
              r(STATE);
            };
          });
        }
        open -= 1;
        return Promise.resolve(STATE);
      }) as never,
    });
    seed();

    useAdaptiveTestStore.getState().mark('a:one', 'hear', 'love');
    const first = useAdaptiveTestStore.getState().flush('dirty-talk');
    useAdaptiveTestStore.getState().mark('b:two', 'hear', 'never');
    const second = useAdaptiveTestStore.getState().flush('dirty-talk');
    await Promise.resolve();
    await Promise.resolve();

    (release as null | (() => void))?.();
    await Promise.all([first, second]);

    // Never two writes against the same file at once — that overlap is what silently drops a mark.
    expect(maxOpen).toBe(1);
    // And nothing is lost: whether the taps coalesce into one write or queue into two is an implementation
    // detail, but every marked key must appear somewhere in what was sent.
    const sent = Object.assign({}, ...seen.map((call) => call['marks'] as object)) as Record<
      string,
      string
    >;
    expect(sent['a:one']).toEqual({ hear: 'love' });
    expect(sent['b:two']).toEqual({ hear: 'never' });
  });

  it('carries the take’s un-marks on the closing call, not just the marks', async () => {
    const bank = vi.fn(() => Promise.resolve(STATE));
    installMockBridge({ testsAdaptiveBank: bank as never });
    seed();

    useAdaptiveTestStore.getState().mark('a:one', 'hear', 'never');
    // Tapping the same mark again takes it back — the toggle both phases share since §3.6.26.
    useAdaptiveTestStore.getState().mark('a:one', 'hear', 'never');
    await useAdaptiveTestStore.getState().submitBank('dirty-talk');

    // An un-marked side is ABSENT from `marks`, and absence undoes nothing — the closing call must say which
    // DIRECTION was taken back (74 §3.6.26), or a failed autosave leaves the stale mark on record for good.
    const closing = (bank.mock.calls.at(-1) as unknown[] | undefined)?.[0] as
      | { cleared?: Record<string, ('hear' | 'say')[]> }
      | undefined;
    expect(closing?.cleared?.['a:one']).toEqual(['hear']);
  });
});
