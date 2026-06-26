import { useEffect, useState } from 'react';
import { EyeOff, RefreshCw, Sparkles } from 'lucide-react';
import type { RelationshipSynthesis } from '@shared/schemas';
import { Banner, Button, Card, Stack, Text } from '../../../design-system/components';
import { aiUnavailableMessage } from '../../AiUnavailableNotice';
import styles from './Memory.module.css';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/**
 * A per-partner **relationship-insights** card (54 §3.3) — the partner's shared data is NEVER shown raw here;
 * instead this surfaces an AI synthesis about the viewer + the dynamic (cached; explicit-tap to generate /
 * refresh). Self-contained: it loads its own cached synthesis on mount and owns the generate lifecycle, so it
 * stays correct as the partner list re-derives on an active-person switch.
 */
export function RelationshipInsightsCard({
  partnerId,
  partnerName,
  canManageAi,
}: {
  partnerId: string;
  partnerName: string;
  canManageAi: boolean;
}): JSX.Element {
  const [synthesis, setSynthesis] = useState<RelationshipSynthesis | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    void window.selfos?.relationshipsGetSynthesis?.({ partnerPersonId: partnerId }).then((s) => {
      if (live) {
        setSynthesis(s ?? null);
        setLoaded(true);
      }
    });
    return () => {
      live = false;
    };
  }, [partnerId]);

  const generate = async (): Promise<void> => {
    setGenerating(true);
    setError(null);
    try {
      const result = await window.selfos?.relationshipsSynthesize?.({ partnerPersonId: partnerId });
      if (result?.ok) {
        setSynthesis(result.synthesis);
      } else if (result?.reason === 'AI_OFF' || result?.reason === 'NO_KEY') {
        setError(aiUnavailableMessage({ canManageAi }));
      } else if (result?.reason === 'BUDGET' || result?.reason === 'CAPPED') {
        setError(result.message);
      } else if (result?.reason === 'EMPTY') {
        setError(
          `There isn’t enough yet to reflect on your relationship with ${partnerName} — keep using SelfOS and check back.`,
        );
      } else {
        setError('Couldn’t write relationship insights. Please try again.');
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card className={styles.relCard}>
      <div className={styles.relHead}>
        <div className={styles.relAvatar} aria-hidden="true">
          {initials(partnerName)}
        </div>
        <div className={styles.relWho}>
          <Text weight={600}>You &amp; {partnerName}</Text>
          <Text size="sm" tone="tertiary">
            Partner
          </Text>
        </div>
        {synthesis ? (
          <Button variant="ghost" onClick={() => void generate()} disabled={generating}>
            <RefreshCw size={14} aria-hidden="true" /> {generating ? 'Reflecting…' : 'Refresh'}
          </Button>
        ) : null}
      </div>

      {synthesis ? (
        <Stack gap={2}>
          <Text size="sm" tone="accent">
            <Sparkles size={13} aria-hidden="true" /> Relationship insights
          </Text>
          <ul className={styles.relList}>
            {synthesis.observations.map((o, i) => (
              <li key={i} className={styles.relItem}>
                {o}
              </li>
            ))}
          </ul>
        </Stack>
      ) : !loaded ? (
        <Text size="sm" tone="tertiary" aria-busy="true">
          Loading…
        </Text>
      ) : (
        <Stack gap={3}>
          <Text size="sm" tone="secondary">
            Get gentle, AI-written observations about you and your relationship with {partnerName} —
            drawn from your own reflections and what {partnerName} has chosen to share.
          </Text>
          <Button variant="secondary" onClick={() => void generate()} disabled={generating}>
            <Sparkles size={15} aria-hidden="true" /> {generating ? 'Reflecting…' : 'Reflect on us'}
          </Button>
        </Stack>
      )}

      {error ? (
        <Banner tone="info" role="status">
          {error}
        </Banner>
      ) : null}

      <div className={styles.relFooter}>
        <EyeOff size={13} aria-hidden="true" />
        <Text size="xs" tone="tertiary">
          Built from what {partnerName} chose to share — used as insight for your coach, never shown
          as their raw answers.
        </Text>
      </div>
    </Card>
  );
}
