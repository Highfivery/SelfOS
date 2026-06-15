import { stripIntakeFieldMarkers } from '@selfos/core/intake';
import type { IntakeSection, IntakeSectionMeta } from '@shared/channels';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Banner, Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { Composer } from '../sessions/Composer';
import { useIntakeStore } from '../../../stores/intakeStore';
import styles from './Onboarding.module.css';

/**
 * The active intake section's adaptive interview (18-personal-onboarding §3.2): the streamed Q&A (reusing
 * the Sessions `Composer`), the skip / "that's enough" controls, the per-section reflection, and — for the
 * intimacy block — the one-time 18+ gate. The crisis footer lives in the container, always present.
 */
export function IntakeSectionPanel({
  meta,
  section,
  adultAcknowledged,
  onAdvance,
}: {
  meta: IntakeSectionMeta;
  section: IntakeSection | undefined;
  adultAcknowledged: boolean;
  onAdvance: () => void;
}): JSX.Element {
  const streaming = useIntakeStore((s) => s.streaming);
  const running = useIntakeStore((s) => s.running);
  const busy = useIntakeStore((s) => s.busy);
  const runTurn = useIntakeStore((s) => s.runTurn);
  const completeSection = useIntakeStore((s) => s.completeSection);
  const skipSection = useIntakeStore((s) => s.skipSection);
  const acknowledgeAdult = useIntakeStore((s) => s.acknowledgeAdult);

  const messages = section?.messages ?? [];
  const status = section?.status ?? 'notStarted';
  const locked = meta.adult && !adultAcknowledged;

  // The intimacy block is gated behind the shared 18+ acknowledgement (§3.3).
  if (locked) {
    return (
      <Card>
        <div className={styles.gate}>
          <Heading level={2}>{meta.title}</Heading>
          <Text tone="secondary">{meta.blurb}</Text>
          {meta.contentNote ? <Banner tone="info">{meta.contentNote}</Banner> : null}
          <div className={styles.controls}>
            <Button variant="primary" disabled={busy} onClick={() => void acknowledgeAdult()}>
              <ShieldCheck size={16} aria-hidden="true" />
              I’m 18 or older — continue
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void skipSection(meta.id).then(onAdvance);
              }}
            >
              Skip this section
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const complete = status === 'complete';

  return (
    <Card>
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <Heading level={2}>{meta.title}</Heading>
          <Text tone="secondary" className={styles.blurb}>
            {meta.blurb}
          </Text>
        </div>

        {meta.contentNote ? <Banner tone="info">{meta.contentNote}</Banner> : null}

        <div className={styles.thread} aria-live="polite" aria-busy={running}>
          <div className={`${styles.turn} ${styles.coachMsg}`}>{meta.opener}</div>
          {messages.map((m, i) => (
            <div
              key={i}
              className={`${styles.turn} ${m.role === 'user' ? styles.userMsg : styles.coachMsg}`}
            >
              {m.content}
            </div>
          ))}
          {running ? (
            streaming ? (
              <div className={`${styles.turn} ${styles.coachMsg}`}>
                {stripIntakeFieldMarkers(streaming)}
              </div>
            ) : (
              <div className={styles.thinking}>Listening…</div>
            )
          ) : null}
        </div>

        {complete && section?.reflection ? (
          <Card className={styles.reflection}>
            <Stack gap={1}>
              <Text size="sm" weight={600}>
                A quick reflection
              </Text>
              <Text>{section.reflection}</Text>
            </Stack>
          </Card>
        ) : null}

        {!complete ? (
          <>
            <Composer
              disabled={running}
              onSend={(text) => void runTurn(meta.id, text)}
              placeholder="Share as much or as little as you like…"
              autoFocus={false}
            />
            <div className={styles.controls}>
              <Button
                variant="secondary"
                disabled={busy || running || messages.length === 0}
                onClick={() => {
                  void completeSection(meta.id).then(onAdvance);
                }}
              >
                That’s enough on this
              </Button>
              <Button
                variant="ghost"
                disabled={busy || running}
                onClick={() => {
                  void skipSection(meta.id).then(onAdvance);
                }}
              >
                Skip this section
              </Button>
            </div>
          </>
        ) : (
          <div className={styles.controls}>
            <Button variant="primary" onClick={onAdvance}>
              Continue
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
