import { useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useStoryStore } from '../../stores/storyStore';

/** In-memory throttle so focus events can't spam the attempt (the real 7-day interval is in the bridge). */
const FOCUS_THROTTLE_MS = 30 * 60 * 1000;

/**
 * Drives the autonomous interview cadence (64-your-story §3.7 — mirrors `useStoryRefresh`): a non-blocking
 * attempt on mount + on window focus/resume for the open book. The bridge owns the real gates (the 7-day
 * interval, the weekly cap, the crisis suppressor, the ≤1-open-check-in back-off, budget) and no-ops when not
 * warranted, so this hook just nudges it; the in-memory throttle keeps focus events cheap. Only fires for a book
 * with `autoRefresh` on; re-armed when the book or active person changes.
 */
export function useStoryInterview(bookId: string | null, autoRefresh: boolean): void {
  const runInterviewCheck = useStoryStore((s) => s.runInterviewCheck);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (!bookId || !autoRefresh || !activePersonId) return undefined;

    const attempt = (): void => {
      const now = Date.now();
      if (now - lastAttempt.current < FOCUS_THROTTLE_MS) return;
      lastAttempt.current = now;
      void runInterviewCheck(bookId, { auto: true });
    };

    attempt(); // mount / book- or person-change
    const onFocus = (): void => attempt();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') attempt();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [bookId, autoRefresh, activePersonId, runInterviewCheck]);
}
