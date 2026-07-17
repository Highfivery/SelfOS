import type { InboxItem } from '@shared/channels';

/** Sort orders for the Received tab (08 §3.3). */
export type ReceivedSort = 'received' | 'answered' | 'title';

/** The value a sort key reads for a received item (a time, or the title). */
function receivedSortValue(item: InboxItem, sort: ReceivedSort): string {
  if (sort === 'title') return item.title.toLowerCase();
  if (sort === 'answered') return item.answeredAt ?? '';
  return item.createdAt; // 'received'
}

/**
 * Order received questionnaires: favourites first (pinned to the top), then the chosen sort — titles
 * ascending, times descending (most recent first); items missing the sort's date sink to the bottom. Pure +
 * stable.
 */
export function sortReceived(items: InboxItem[], sort: ReceivedSort): InboxItem[] {
  return [...items].sort((a, b) => {
    const favDelta = (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    if (favDelta !== 0) return favDelta;
    const av = receivedSortValue(a, sort);
    const bv = receivedSortValue(b, sort);
    if (av === bv) return 0;
    if (sort === 'title') return av.localeCompare(bv);
    if (!av) return 1; // no date for this sort → bottom
    if (!bv) return -1;
    return bv.localeCompare(av); // most recent first
  });
}
