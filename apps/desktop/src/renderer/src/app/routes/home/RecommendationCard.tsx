import type { ReactNode } from 'react';
import {
  BookOpen,
  Brain,
  ClipboardCheck,
  ClipboardList,
  Flag,
  Heart,
  HeartHandshake,
  HeartPulse,
  MessageCircle,
  Moon,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { RecommendationDomain } from '@selfos/core/recommendations';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/** A calm icon per recommendation domain (icons are decorative — the label carries the meaning). */
const DOMAIN_ICON: Record<RecommendationDomain, LucideIcon> = {
  session: MessageCircle,
  guided: Sparkles,
  intimacy: Heart,
  test: ClipboardCheck,
  challenge: Flag,
  wellbeing: HeartPulse,
  dream: Moon,
  memory: Brain,
  questionnaire: ClipboardList,
  together: HeartHandshake,
  story: BookOpen,
};

/**
 * One "For you" recommendation card (53 §3.2) — a uniform, calm shell: a domain icon, a short label, a
 * one-line person-specific reason, and a gentle "Not now" dismiss. The primary action(s) are the `children`
 * (a real, keyboard-operable button/link the per-recommendation renderer supplies). Invitation tone, never a
 * demand; dismissal is calm and never framed as a loss (§8).
 */
export function RecommendationCard({
  domain,
  label,
  reason,
  onDismiss,
  children,
}: {
  domain: RecommendationDomain;
  label: string;
  reason: string;
  onDismiss: () => void;
  children?: ReactNode;
}): JSX.Element {
  const Icon = DOMAIN_ICON[domain];
  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2}>
            <Icon size={16} aria-hidden="true" /> {label}
          </Heading>
          <button
            type="button"
            className={styles.cardLink}
            onClick={onDismiss}
            aria-label={`Dismiss “${label}” for now`}
          >
            <X size={14} aria-hidden="true" /> Not now
          </button>
        </div>
        <Text tone="secondary">{reason}</Text>
        {children}
      </Stack>
    </Card>
  );
}
