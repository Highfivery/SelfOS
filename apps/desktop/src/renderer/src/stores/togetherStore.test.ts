import { afterEach, describe, expect, it } from 'vitest';
import type { TogetherSessionView, TogetherTurnResult } from '@shared/schemas';
import { useTogetherStore } from './togetherStore';
import { useSessionStore } from './sessionStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

const ME = 'me';

function view(id: string, over: Partial<TogetherSessionView> = {}): TogetherSessionView {
  return {
    id,
    pairKey: 'me~partner',
    initiatorPersonId: ME,
    participants: [
      { personId: ME, displayName: 'Ben' },
      { personId: 'partner', displayName: 'Angel' },
    ],
    status: 'active',
    yourTurn: true,
    unreadCount: 0,
    createdAt: '2026-07-21T00:00:00.000Z',
    messages: [],
    viewerAcked: true,
    ...over,
  };
}

/** A deferred promise so we can resolve the "coach thinking" turn AFTER the viewer has navigated away. */
function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  clearMockBridge();
  useTogetherStore.getState().reset();
  useSessionStore.setState({ activePerson: null });
});

describe('togetherStore — no forced navigation when a turn resolves after switching sessions', () => {
  it('does NOT clobber `open` back to session A when its turn resolves while B is open', async () => {
    useSessionStore.setState({ activePerson: { id: ME } as never });

    const turn = defer<TogetherTurnResult>();
    installMockBridge({
      togetherGet: (id: string) => Promise.resolve(view(id)),
      togetherMarkRead: () => Promise.resolve(),
      togetherGetReport: () => Promise.resolve({ report: null, stale: false, agreements: [] }),
      // The coach "thinks" — resolves only when we tell it to, after the viewer has switched sessions.
      togetherSendMessage: () => turn.promise,
    });

    // Viewing session A.
    await useTogetherStore.getState().openSession('A');
    expect(useTogetherStore.getState().open?.id).toBe('A');

    // Send a message — the turn is now in flight; do NOT await it.
    const sendPromise = useTogetherStore.getState().sendMessage('hello');
    expect(useTogetherStore.getState().sending).toBe(true);

    // Navigate to session B while the coach is still thinking.
    await useTogetherStore.getState().openSession('B');
    expect(useTogetherStore.getState().open?.id).toBe('B');
    // Opening a fresh session clears the leaked "thinking" state from A's in-flight turn.
    expect(useTogetherStore.getState().sending).toBe(false);

    // A's turn finally resolves with A's refreshed view.
    turn.resolve({ ok: true, view: view('A', { messages: [] }) });
    await sendPromise;

    // The screen must STILL be on B — A's late result must not yank the viewer back.
    expect(useTogetherStore.getState().open?.id).toBe('B');
  });

  it('applies the turn result normally when the same session is still open', async () => {
    useSessionStore.setState({ activePerson: { id: ME } as never });
    const resolved = view('A', {
      messages: [
        {
          id: 'm1',
          authorPersonId: ME,
          role: 'user',
          content: 'hello',
          ts: '2026-07-21T00:01:00.000Z',
          privateAside: false,
        },
      ],
    });
    installMockBridge({
      togetherGet: (id: string) => Promise.resolve(view(id)),
      togetherMarkRead: () => Promise.resolve(),
      togetherGetReport: () => Promise.resolve({ report: null, stale: false, agreements: [] }),
      togetherSendMessage: () =>
        Promise.resolve({ ok: true, view: resolved } as TogetherTurnResult),
    });

    await useTogetherStore.getState().openSession('A');
    await useTogetherStore.getState().sendMessage('hello');

    expect(useTogetherStore.getState().open?.id).toBe('A');
    expect(useTogetherStore.getState().open?.messages).toHaveLength(1);
    expect(useTogetherStore.getState().sending).toBe(false);
  });

  it('does NOT clobber `open` back to A when a RETRY resolves while B is open', async () => {
    useSessionStore.setState({ activePerson: { id: ME } as never });
    const turn = defer<TogetherTurnResult>();
    installMockBridge({
      togetherGet: (id: string) => Promise.resolve(view(id)),
      togetherMarkRead: () => Promise.resolve(),
      togetherGetReport: () => Promise.resolve({ report: null, stale: false, agreements: [] }),
      togetherRetry: () => turn.promise,
    });

    await useTogetherStore.getState().openSession('A');
    const retryPromise = useTogetherStore.getState().retry();
    expect(useTogetherStore.getState().sending).toBe(true);

    await useTogetherStore.getState().openSession('B');
    expect(useTogetherStore.getState().open?.id).toBe('B');

    turn.resolve({ ok: true, view: view('A') });
    await retryPromise;

    expect(useTogetherStore.getState().open?.id).toBe('B');
  });

  it('refresh does NOT clobber `open` back to A when the viewer navigated to B mid-refresh', async () => {
    useSessionStore.setState({ activePerson: { id: ME } as never });
    // `togetherGet` for A is deferred so we can navigate away before `refresh` resolves it.
    const aGet = defer<TogetherSessionView>();
    let getCalls = 0;
    installMockBridge({
      togetherGet: (id: string) => {
        getCalls += 1;
        // The FIRST call (openSession('A')) returns immediately; the SECOND (refresh's re-fetch of A) defers.
        if (id === 'A' && getCalls > 1) return aGet.promise;
        return Promise.resolve(view(id));
      },
      togetherList: () => Promise.resolve([]),
      togetherMarkRead: () => Promise.resolve(),
      relationshipsList: () => Promise.resolve([]),
      peopleList: () => Promise.resolve([]),
      accessGet: () => Promise.resolve({ roles: [], accounts: [] }),
    });

    await useTogetherStore.getState().openSession('A');
    const refreshPromise = useTogetherStore.getState().refresh();

    await useTogetherStore.getState().openSession('B');
    expect(useTogetherStore.getState().open?.id).toBe('B');

    // A's re-fetch finally resolves — it must not overwrite B.
    aGet.resolve(view('A', { topic: 'stale A' }));
    await refreshPromise;

    expect(useTogetherStore.getState().open?.id).toBe('B');
    expect(useTogetherStore.getState().open?.topic).toBeUndefined();
  });
});
