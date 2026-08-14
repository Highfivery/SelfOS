// The Studio's five tabs (§13.2). `chapters` is the default; each is a real sub-route (`/story/<tab>`), so a
// tab deep-links + survives reload, while an internal mirror drives rendering (works with no Route, e.g. RTL).
export const STUDIO_TABS = ['chapters', 'photos', 'interview', 'sharing', 'settings'] as const;
export type StudioTab = (typeof STUDIO_TABS)[number];
export const TAB_LABEL: Record<StudioTab, string> = {
  chapters: 'Chapters',
  photos: 'Photos',
  interview: 'Interview',
  sharing: 'Sharing',
  settings: 'Settings',
};
export function isStudioTab(v: string): v is StudioTab {
  return (STUDIO_TABS as readonly string[]).includes(v);
}
