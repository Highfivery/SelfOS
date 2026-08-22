import { useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useStoryStore } from '../../stores/storyStore';

/** In-memory throttle so focus events can't spam the attempts (the real gates — daily/weekly/interval — are
 *  in the bridge, per book). */
const FOCUS_THROTTLE_MS = 30 * 60 * 1000;

/**
 * Drives the living-book cadences (refresh §3.4/§5.4 + interview §3.7) at the APP level (64-your-story §18.5,
 * #298 — the spec-39/40 precedent). Previously these mounted only on the `/story` route, so a book only refreshed
 * or minted an interview check-in while the person was already looking at it. Mounted at AppShell, they run for
 * EVERY book the active person owns with `autoRefresh` on — on mount, on window focus/resume, and on a person
 * switch — so gap/refresh prompts surface globally (the minted check-in lands in the Inbox queue, where the
 * one "waiting for you" row counts it — the per-item `story-checkin` bell row was retired in 08 §36).
 *
 * back-off, budget) and no-ops when not warranted, so this hook just nudges each eligible book; the in-memory
 * throttle keeps focus events cheap. Multi-book ready (#299): it loops every book, not `books[0]`.
 */
export function useStoryCadences(): void {
  const canStory = useSessionStore((s) => s.can('story.own'));
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const refreshBook = useStoryStore((s) => s.refreshBook);
  const runInterviewCheck = useStoryStore((s) => s.runInterviewCheck);
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (!canStory || !activePersonId) return undefined;
    let cancelled = false;

    const attempt = (): void => {
      const now = Date.now();
      if (now - lastAttempt.current < FOCUS_THROTTLE_MS) return;
      lastAttempt.current = now;
      void (async () => {
        const books = (await window.selfos?.booksList()) ?? [];
        if (cancelled || useSessionStore.getState().activePerson?.id !== activePersonId) return;
        for (const book of books) {
          if (!book.config.autoRefresh) continue;
          void refreshBook(book.id, { auto: true });
          void runInterviewCheck(book.id, { auto: true });
        }
      })();
    };

    attempt(); // mount / person-change
    const onFocus = (): void => attempt();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') attempt();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [canStory, activePersonId, refreshBook, runInterviewCheck]);
}
