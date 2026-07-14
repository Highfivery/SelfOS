import { useNavigate } from 'react-router-dom';
import {
  Brain,
  CheckCircle2,
  ClipboardList,
  Compass,
  Heart,
  MessageCircle,
  Moon,
  Target,
} from 'lucide-react';
import type { ActivityDomain, ActivityEvent } from '@selfos/core/home';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

const FEED_ICONS: Record<ActivityDomain, typeof MessageCircle> = {
  session: MessageCircle,
  dream: Moon,
  insight: Brain,
  inbox: ClipboardList,
  questionnaire: ClipboardList,
  together: Heart,
  challenge: Target,
  goal: CheckCircle2,
  wellbeing: Compass,
};

/** A short relative time ("now" / "12m" / "3h" / "2d") for a feed timestamp. */
function relTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const secs = Math.max(0, Math.floor((now - t) / 1000));
  if (secs < 60) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  const hours = Math.floor(secs / 3600);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function FeedRowBody({ event }: { event: ActivityEvent }): JSX.Element {
  const Icon = FEED_ICONS[event.domain];
  return (
    <>
      <span className={styles.feedDot} data-domain={event.domain} aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className={styles.feedBody}>
        <span className={styles.feedTitle}>{event.title}</span>
        {event.detail ? <span className={styles.feedDetail}>{event.detail}</span> : null}
      </span>
      <span className={styles.feedWhen}>{relTime(event.at, Date.now())}</span>
    </>
  );
}

/**
 * The "recent across everything" cross-feature activity feed (60 §3.1.6). Time-sorted, deduped, capped
 * (the core `buildActivityFeed` did that). Actionable entries (needs review / your turn / due) are
 * emphasized; those with a route are clickable and navigate; the feed scrolls **inside its own card**, never
 * the page (§9/§12). Self-hides when there's no recent activity.
 */
export function ActivityFeed({ events }: { events: ActivityEvent[] }): JSX.Element | null {
  const navigate = useNavigate();
  if (events.length === 0) return null;
  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.railHead}>
          <Heading level={2} className={styles.railTitle}>
            Recent
          </Heading>
          <Text size="xs" tone="tertiary">
            across everything · 14 days
          </Text>
        </div>
        <ul className={styles.feed}>
          {events.map((event) => {
            const cls = `${styles.feedRow}${event.actionable ? ` ${styles.feedRowActionable}` : ''}`;
            const route = event.route; // narrowed to string in the truthy branch (a const, no cast)
            return (
              <li key={event.id}>
                {route ? (
                  <button type="button" className={cls} onClick={() => navigate(route)}>
                    <FeedRowBody event={event} />
                  </button>
                ) : (
                  <div className={cls}>
                    <FeedRowBody event={event} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Stack>
    </Card>
  );
}
