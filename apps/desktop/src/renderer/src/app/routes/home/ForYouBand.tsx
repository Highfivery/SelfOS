import type { Recommendation } from '@selfos/core/recommendations';
import type { ProfileUpdateSuggestion } from '@shared/channels';
import { useDiscoveryStore } from '../../../stores/discoveryStore';
import { Card, Stack, Text } from '../../../design-system/components';
import { DailyReflectionCard } from './DailyReflectionCard';
import { RecommendationItem } from './RecommendationItem';
import styles from './Home.module.css';

/**
 * The "For you today" band (60 §3.1.4) — the daily AI reflection beside the single **smart next action**
 * (the top-ranked recommendation, elevated into a focal card). The rest of the ranked recommendations
 * render below in the "For you" strip (Home passes `recs.slice(1)` to `ForYou`). When nothing ranks, the
 * focal shows a calm satisfied line rather than a forced suggestion. The dismissal wiring matches `ForYou`.
 */
export function ForYouBand({
  recs,
  configured,
  canSynthesize,
  depthSuggestion,
}: {
  recs: Recommendation[];
  configured: boolean;
  canSynthesize: boolean;
  depthSuggestion: ProfileUpdateSuggestion | null;
}): JSX.Element {
  const dismiss = useDiscoveryStore((s) => s.dismiss);
  const top = recs[0];
  return (
    <div className={styles.band}>
      <DailyReflectionCard configured={configured} canSynthesize={canSynthesize} />
      <div className={styles.bandFocal}>
        {top ? (
          <RecommendationItem
            rec={top}
            configured={configured}
            depthSuggestion={depthSuggestion}
            onDismiss={() => dismiss(`rec:${top.dismissKey}`)}
          />
        ) : (
          <Card className={styles.focalSatisfied}>
            <Stack gap={2}>
              <span className={styles.reflectionEyebrow}>For you</span>
              <Text tone="secondary">
                You’re all set for now — nothing needs you. Enjoy the calm.
              </Text>
            </Stack>
          </Card>
        )}
      </div>
    </div>
  );
}
