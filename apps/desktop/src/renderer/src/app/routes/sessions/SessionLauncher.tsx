import { useNavigate } from 'react-router-dom';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { Banner, Heading, Stack, Text } from '../../../design-system/components';
import { Composer } from './Composer';
import { SuggestedSessions } from './SuggestedSessions';
import { GuidedCatalog } from './GuidedCatalog';
import styles from './Launcher.module.css';

/**
 * The Sessions launcher (16 §3.1): the start state when there's no active session. Free-start framing +
 * composer, the AI "Suggested for you" row, and the grouped catalog. Works fully with AI off — the catalog
 * browses and a guided session's static opener seeds offline; only chatting + suggestions need AI.
 */
export function SessionLauncher({
  configured,
  onStartFree,
  onPickGuided,
}: {
  configured: boolean;
  onStartFree: (text: string) => void;
  onPickGuided: (guideId: string) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const adultAcknowledged = useGuidanceStore((s) => s.adultAcknowledged);
  const acknowledgeAdult = useGuidanceStore((s) => s.acknowledgeAdult);

  return (
    <div className={styles.launcher}>
      <Stack gap={6}>
        <section className={styles.freeStart}>
          <Heading level={2}>What do you want to work through?</Heading>
          <Text tone="secondary">
            Think out loud. SelfOS listens, notices patterns, and pushes back when it helps. Or
            start a guided session — a structured, coach- or therapist-informed exercise SelfOS
            walks you through, personalized to you.
          </Text>
          {configured ? (
            <Composer
              disabled={false}
              autoFocus={false}
              placeholder="Start talking…"
              onSend={onStartFree}
            />
          ) : (
            <Banner tone="info">
              Connect Claude in{' '}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => navigate('/settings')}
              >
                Settings
              </button>{' '}
              to start talking. You can still browse and start guided sessions below.
            </Banner>
          )}
        </section>

        <SuggestedSessions configured={configured} onPick={onPickGuided} />

        <GuidedCatalog
          onPick={onPickGuided}
          adultAcknowledged={adultAcknowledged}
          onAcknowledgeAdult={() => void acknowledgeAdult()}
        />
      </Stack>
    </div>
  );
}
