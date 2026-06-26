import type { ChallengeDomain } from '@shared/channels';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { Heading, Stack, Text } from '../../../design-system/components';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { Composer } from './Composer';
import type { PendingAttachment } from './downscaleImage';
import { SuggestedSessions } from './SuggestedSessions';
import { GuidedCatalog } from './GuidedCatalog';
import { ChallengeSection } from './ChallengeSection';
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
  onStartChallenge,
  onTalkItThrough,
  seedText = '',
}: {
  configured: boolean;
  onStartFree: (text: string, attachments: PendingAttachment[]) => void;
  onPickGuided: (guideId: string) => void;
  /** Start a challenge-coach session (52 §3.1), optionally domain-seeded. */
  onStartChallenge: (domain?: ChallengeDomain) => void;
  /** Open a challenge reflection session for a non-adult challenge (52 §3.5). */
  onTalkItThrough: (challengeId: string) => void;
  /** Prefill the free-start composer (40 §3.3 — the Home synthesis "Talk it through" seed-handoff). */
  seedText?: string;
}): JSX.Element {
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
              allowAttachments
              placeholder="Start talking…"
              initialText={seedText}
              onSend={onStartFree}
            />
          ) : (
            <Stack gap={2}>
              <AiUnavailableNotice />
              <Text tone="secondary" size="sm">
                You can still browse and start guided sessions below.
              </Text>
            </Stack>
          )}
        </section>

        <ChallengeSection
          adultAcknowledged={adultAcknowledged}
          onStartChallenge={onStartChallenge}
          onTalkItThrough={onTalkItThrough}
        />

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
