import { useNavigate } from 'react-router-dom';
import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { useSynthesisStore } from '../../../stores/synthesisStore';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { Button, Card, Markdown, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/**
 * The daily reflection card (60 §3.1.4) — the cross-feature AI observation (40 synthesis) in a warm
 * companion voice. The cache is auto-populated **once per day** by the app-wide synthesis cadence hook
 * (AppShell `useCoachingSynthesis` → the bridge gates on AI + proactivity + the `dailyReflection` toggle +
 * budget + a ≥N-new-insight threshold + no-crisis, ≤1/day — 60 §6.2/§6.3/§8); this card just reads that cache
 * and offers an explicit Refresh / "Reflect on my week" (metered, the existing rules). AI-off → the role-aware
 * notice, never a dead button.
 */
export function DailyReflectionCard({
  configured,
  canSynthesize,
}: {
  configured: boolean;
  canSynthesize: boolean;
}): JSX.Element {
  const navigate = useNavigate();
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/sessions', { state: { seedText: synthesis.observation } })}
          >
            Talk it through <ArrowRight size={14} aria-hidden="true" />
          </Button>
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
