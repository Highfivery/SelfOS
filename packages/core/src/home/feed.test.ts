import { describe, expect, it } from 'vitest';
import { buildActivityFeed } from './feed';
import type { ActivityFeedInput } from './schemas';

const now = new Date('2026-07-13T12:00:00Z');
const hoursAgo = (h: number): string => new Date(now.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number): string => new Date(now.getTime() - d * 86_400_000).toISOString();

describe('buildActivityFeed', () => {
  it('merges sources, sorts newest-first, and maps domain/route/actionable', () => {
    const input: ActivityFeedInput = {
      now,
      sessions: [{ id: 's1', title: 'Boundaries', status: 'complete', updatedAt: hoursAgo(30) }],
      dreams: [{ id: 'd1', title: 'flooded house', createdAt: hoursAgo(20) }],
      inbox: [
        {
          assignmentId: 'a1',
          title: 'roots',
          senderName: 'Mom',
          createdAt: hoursAgo(2),
          answerable: true,
          fromSelf: false,
        },
      ],
      together: [
        {
          id: 't1',
          partnerName: 'Angel',
          yourTurn: true,
          unreadCount: 2,
          status: 'active',
          lastMessageAt: hoursAgo(1),
          createdAt: daysAgo(2),
        },
      ],
    };
    const feed = buildActivityFeed(input);
    expect(feed.map((e) => e.id)).toEqual(['together:t1', 'inbox:a1', 'dream:d1', 'session:s1']);
    const together = feed.find((e) => e.id === 'together:t1');
    expect(together?.title).toBe('Angel replied');
    expect(together?.detail).toBe('Your turn · 2 unread');
    expect(together?.route).toBe('/together');
    expect(together?.actionable).toBe(true);
    expect(feed.find((e) => e.id === 'session:s1')?.actionable).toBe(false);
  });

  it('excludes approved insights (captured memory) and surfaces only drafts as needs-review', () => {
    const feed = buildActivityFeed({
      now,
      insights: [
        { id: 'i1', summary: 'approved thing', approved: true, createdAt: hoursAgo(3) },
        { id: 'i2', summary: 'draft thing', approved: false, createdAt: hoursAgo(4) },
      ],
    });
    expect(feed.map((e) => e.id)).toEqual(['insight:i2']);
    expect(feed[0]?.title).toBe('New insight to review');
    expect(feed[0]?.actionable).toBe(true);
  });

  it('only surfaces a challenge check-in once it is actually due, and with no route', () => {
    const feed = buildActivityFeed({
      now,
      challenges: [
        {
          id: 'c1',
          action: 'Say the honest thing',
          status: 'active',
          checkInAt: hoursAgo(1),
          createdAt: daysAgo(3),
        },
        {
          id: 'c2',
          action: 'future',
          status: 'active',
          checkInAt: new Date(now.getTime() + 3600_000).toISOString(),
          createdAt: daysAgo(3),
        },
      ],
    });
    expect(feed.map((e) => e.id)).toEqual(['challenge:c1']);
    expect(feed[0]?.route).toBeUndefined();
    expect(feed[0]?.actionable).toBe(true);
  });

  it('only counts sent questionnaires with new responses', () => {
    const feed = buildActivityFeed({
      now,
      sentOverview: [
        {
          questionnaireId: 'q1',
          recipientName: 'Mom',
          newResponses: 2,
          answeredAt: hoursAgo(2),
          lastSentAt: daysAgo(3),
        },
        { questionnaireId: 'q2', newResponses: 0, lastSentAt: daysAgo(1) },
      ],
    });
    expect(feed.map((e) => e.id)).toEqual(['questionnaire:q1']);
    expect(feed[0]?.detail).toBe('2 new answers');
  });

  it('drops events outside the window, in the future, or unparseable; and caps to the limit', () => {
    const feed = buildActivityFeed({
      now,
      windowDays: 14,
      limit: 2,
      dreams: [
        { id: 'recent1', createdAt: hoursAgo(1) },
        { id: 'recent2', createdAt: hoursAgo(2) },
        { id: 'recent3', createdAt: hoursAgo(3) },
        { id: 'old', createdAt: daysAgo(30) },
        { id: 'future', createdAt: new Date(now.getTime() + 86_400_000).toISOString() },
        { id: 'bad', createdAt: 'nonsense' },
      ],
    });
    expect(feed).toHaveLength(2);
    expect(feed.map((e) => e.id)).toEqual(['dream:recent1', 'dream:recent2']);
  });

  it('skips inbox items that are not answerable or are self-sent', () => {
    const feed = buildActivityFeed({
      now,
      inbox: [
        {
          assignmentId: 'x',
          title: 't',
          senderName: 'Me',
          createdAt: hoursAgo(1),
          answerable: true,
          fromSelf: true,
        },
        {
          assignmentId: 'y',
          title: 't',
          senderName: 'B',
          createdAt: hoursAgo(1),
          answerable: false,
          fromSelf: false,
        },
      ],
    });
    expect(feed).toEqual([]);
  });
});
