import type { Recommendation } from '@selfos/core/recommendations';
import type { ProfileUpdateSuggestion } from '@shared/channels';
import { Stack, Text } from '../../../design-system/components';
import { useDiscoveryStore } from '../../../stores/discoveryStore';
import { RecommendationItem } from './RecommendationItem';
import styles from './Home.module.css';

/**
 * The "For you" recommendation section (53 §3.1.3) — the focal, actionable zone above the status overview
 * grid. Renders the engine's top-N ranked recommendations as calm `RecommendationCard`s, each with its
 * preserved action. When there's nothing worth recommending it shows a calm, satisfied line ("you're all set
 * for now"), never a forced suggestion or a dead-end (§7). A labelled region for a11y (§9).
 *
 * The caller only mounts this when the section is allowed (not proactivity-off, not crisis, not brand-new) —
 * those cases suppress the whole zone upstream (§3.7/§7/§8).
 */
export function ForYou({
  recs,
  configured,
  depthSuggestion,
}: {
  recs: Recommendation[];
  configured: boolean;
  depthSuggestion: ProfileUpdateSuggestion | null;
}): JSX.Element {
  const dismiss = useDiscoveryStore((s) => s.dismiss);

  return (
    <section className={styles.forYou} aria-label="For you">
      <h2 className={styles.sectionTitle}>For you</h2>
      {recs.length === 0 ? (
        <Text tone="secondary">
          You’re all set for now — nothing needs your attention. Nicely done.
        </Text>
      ) : (
        <Stack gap={3}>
          {recs.map((rec) => (
            <RecommendationItem
              key={rec.id}
              rec={rec}
              configured={configured}
              depthSuggestion={depthSuggestion}
              onDismiss={() => dismiss(`rec:${rec.dismissKey}`)}
            />
          ))}
        </Stack>
      )}
    </section>
  );
}
