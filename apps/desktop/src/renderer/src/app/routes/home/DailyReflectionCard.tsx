import { RefreshCw, Sparkles } from 'lucide-react';
import { useSynthesisStore } from '../../../stores/synthesisStore';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { Button, Card, Markdown, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/**
 * The daily reflection card (60 §3.1.4) — the cross-feature AI observation (40 synthesis) in a warm
 * companion voice. **Slice 1 is cache-only + explicit tap** (no auto-cadence, no new spend): it shows the
 * cached observation and an explicit Refresh / "Reflect on my week" that generates on demand (metered, the
 * existing rules). Slice 2 adds the once-a-day auto-generate. AI-off → the role-aware notice, never a dead
 * button. The auto-daily cadence + admin-only cost land in Slice 2 (§5.3/§6.2).
 */
export function DailyReflectionCard({
  configured,
  canSynthesize,
}: {
  configured: boolean;
  canSynthesize: boolean;
}): JSX.Element {
  const synthesis = useSynthesisStore((s) => s.synthesis);
  const running = useSynthesisStore((s) => s.running);

  const eyebrow = (
    <div className={styles.reflectionHead}>
      <span className={styles.reflectionEyebrow}>
        <Sparkles size={14} aria-hidden="true" /> Reflection
      </span>
      <span className={styles.aiTag}>AI</span>
    </div>
  );

  const generate = (): void => {
    void useSynthesisStore.getState().run();
  };

  let body: JSX.Element;
  if (synthesis) {
    body = (
      <>
        <div className={styles.reflectionBody}>
          <Markdown>{synthesis.observation}</Markdown>
        </div>
        <div className={styles.reflectionActions}>
          <Button variant="ghost" size="sm" onClick={generate} disabled={running || !configured}>
            <RefreshCw size={14} aria-hidden="true" /> {running ? 'Reflecting…' : 'Refresh'}
          </Button>
        </div>
      </>
    );
  } else if (!configured) {
    body = <AiUnavailableNotice variant="inline" />;
  } else if (canSynthesize) {
    body = (
      <>
        <Text tone="secondary">
          When you’re ready, I can look across your week and share what I’m noticing.
        </Text>
        <div className={styles.reflectionActions}>
          <Button variant="secondary" size="sm" onClick={generate} disabled={running}>
            <Sparkles size={14} aria-hidden="true" />{' '}
            {running ? 'Reflecting…' : 'Reflect on my week'}
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <Text tone="secondary">
        As you do a little more, I’ll start noticing gentle threads across it — and share them here.
      </Text>
    );
  }

  return (
    <Card className={styles.reflectionCard}>
      <Stack gap={3}>
        {eyebrow}
        {body}
      </Stack>
    </Card>
  );
}
