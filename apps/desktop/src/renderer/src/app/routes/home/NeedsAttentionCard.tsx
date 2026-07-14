import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ChevronRight,
  Flag,
  Handshake,
  Heart,
  Mail,
  Send,
  Sparkles,
  Sprout,
  type LucideIcon,
} from 'lucide-react';
import { Card, Heading, Stack } from '../../../design-system/components';
import type { AttentionItem, AttentionKind } from './attention';
import styles from './Home.module.css';

const KIND_ICON: Record<AttentionKind, LucideIcon> = {
  'together-turn': Heart,
  'together-invite': Mail,
  'analyze-responses': Sparkles,
  'review-insights': Sprout,
  agreement: Handshake,
  'check-in': Activity,
  goals: Flag,
  'send-questionnaire': Send,
};

/**
 * The "Needs attention" card (60-home-dashboard §3.1.2a) — a scannable queue of the concrete things WAITING
 * on the person (your Together turn, a response to analyze, insights to review, standing Together agreements,
 * your goals, the weekly check-in, a soft "ask someone" nudge). Distinct from the growth-oriented "For you" band
 * (the overlapping items
 * are filtered out of it so nothing nags twice). Each row deep-links to where the action happens. Self-hides
 * when the queue is clear. Per-person + crisis/proactivity-aware (the nudges are pre-filtered by the caller).
 */
export function NeedsAttentionCard({ items }: { items: AttentionItem[] }): JSX.Element | null {
  const navigate = useNavigate();
  if (items.length === 0) return null;
  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2} className={styles.sectionTitle}>
            Needs attention
          </Heading>
          <span className={styles.attnCount}>{items.length}</span>
        </div>
        <ul className={styles.attnList}>
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li key={item.kind}>
                <button
                  type="button"
                  className={styles.attnRow}
                  onClick={() =>
                    navigate(item.route, item.state ? { state: item.state } : undefined)
                  }
                >
                  <span className={styles.attnIcon}>
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className={styles.attnBody}>
                    <span className={styles.attnLabel}>{item.label}</span>
                    <span className={styles.attnDetail}>{item.detail}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden className={styles.attnChevron} />
                </button>
              </li>
            );
          })}
        </ul>
      </Stack>
    </Card>
  );
}
