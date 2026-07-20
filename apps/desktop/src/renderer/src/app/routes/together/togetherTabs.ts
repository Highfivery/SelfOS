/**
 * The Together home tab set (58 §3.2a) — the four-tab IA that replaced the long stacked scroll.
 *
 * `desire` is CONDITIONAL: the tab exists only once BOTH partners have enabled adult content
 * (`TogetherYnmStatus.eligible`), so the word "Desire" is never on screen over someone's shoulder until the
 * pair is actually using it (§1 — never make anyone feel surveilled). Before that, the ack/opt-in prompt
 * lives quietly at the bottom of the Practices tab.
 */
export const BASE_TOGETHER_TABS = ['sessions', 'practices', 'pulse'] as const;
export const ALL_TOGETHER_TABS = [...BASE_TOGETHER_TABS, 'desire'] as const;
export type TogetherTab = (typeof ALL_TOGETHER_TABS)[number];

export const TOGETHER_TAB_LABEL: Record<TogetherTab, string> = {
  sessions: 'Sessions',
  practices: 'Practices',
  pulse: 'Pulse',
  desire: 'Desire',
};

export function isTogetherTab(value: string): value is TogetherTab {
  return (ALL_TOGETHER_TABS as readonly string[]).includes(value);
}

/** The tabs to render, in order — `desire` appended only when the pair has unlocked it. */
export function visibleTogetherTabs(desireUnlocked: boolean): TogetherTab[] {
  return desireUnlocked ? [...ALL_TOGETHER_TABS] : [...BASE_TOGETHER_TABS];
}

/**
 * Resolve the active tab from the `together/*` splat segment, honouring which tabs are actually visible. An
 * unknown segment (or `session/<id>`, the sibling route that can't reach here anyway) falls back to the first
 * tab; selecting `desire` while it's locked also falls back, so a stale deep-link never shows an empty tab.
 */
export function resolveTogetherTab(
  segment: string | undefined,
  desireUnlocked: boolean,
): TogetherTab {
  const visible = visibleTogetherTabs(desireUnlocked);
  const first = segment?.split('/')[0] ?? '';
  return isTogetherTab(first) && visible.includes(first) ? first : 'sessions';
}
