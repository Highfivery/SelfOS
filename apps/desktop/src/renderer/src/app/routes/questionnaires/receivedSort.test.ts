import { describe, expect, it } from 'vitest';
import type { InboxItem } from '@shared/channels';
import { sortReceived } from './receivedSort';

function item(over: Partial<InboxItem>): InboxItem {
  return {
    assignmentId: 'a',
    title: 't',
    type: 'general',
    questionCount: 1,
    status: 'sent',
    privacy: 'standard',
    senderName: 'Sam',
    createdAt: '2026-06-01T00:00:00.000Z',
    favorite: false,
    answerable: true,
    hasDraft: false,
    fromSelf: false,
    ...over,
  };
}

describe('sortReceived', () => {
  it('orders by received date (newest first) by default', () => {
    const a = item({ assignmentId: 'a', createdAt: '2026-06-01T00:00:00.000Z' });
    const b = item({ assignmentId: 'b', createdAt: '2026-06-05T00:00:00.000Z' });
    expect(sortReceived([a, b], 'received').map((i) => i.assignmentId)).toEqual(['b', 'a']);
  });

  it('orders by answered date; un-answered (no date) sink to the bottom', () => {
    const answeredLate = item({ assignmentId: 'x', answeredAt: '2026-06-06T00:00:00.000Z' });
    const answeredEarly = item({ assignmentId: 'y', answeredAt: '2026-06-02T00:00:00.000Z' });
    const notAnswered = item({ assignmentId: 'z' }); // no answeredAt
    expect(
      sortReceived([notAnswered, answeredEarly, answeredLate], 'answered').map(
        (i) => i.assignmentId,
      ),
    ).toEqual(['x', 'y', 'z']);
  });

  it('orders by title A–Z, and pins favourites to the top regardless of the sort', () => {
    const alpha = item({ assignmentId: 'alpha', title: 'Alpha' });
    const beta = item({ assignmentId: 'beta', title: 'Beta', favorite: true });
    expect(sortReceived([alpha, beta], 'title').map((i) => i.title)).toEqual(['Beta', 'Alpha']);
  });
});
