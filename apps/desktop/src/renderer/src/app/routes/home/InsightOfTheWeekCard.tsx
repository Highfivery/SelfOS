import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button, Card, Heading, Markdown, Stack, Text } from '../../../design-system/components';
import { useSynthesisStore } from '../../../stores/synthesisStore';
import styles from './Home.module.css';

/**
 * "Something I’m noticing" (40-proactive-coaching §3.3) — the cross-feature synthesis nudge: one gentle
 * observation connecting a theme across the person's recent sessions, dreams, questionnaires, and onboarding.
 * It is an INVITATION to reflect, never a finding. Shown only when proactivity is on AND there's either a
 * cached observation or enough recent material to run one (self-hiding otherwise). The automatic cadence
 * fills it in the background; "What are you noticing lately?" is the explicit-tap manual run (§11 Q8).
 *
 * "Talk it through" seeds a session on the observation (the §17 seed-handoff). No spend on load — the cadence
 * hook + the manual button are the only things that run the (budget-gated, metered) pass.
 */
export function InsightOfTheWeekCard({
  configured,
  canSynthesize,
}: {
  configured: boolean;
  canSynthesize: boolean;
}): JSX.Element | null {
  const navigate = useNavigate();
  const synthesis = useSynthesisStore((s) => s.synthesis);
  const running = useSynthesisStore((s) => s.running);
  const error = useSynthesisStore((s) => s.error);
  const loaded = useSynthesisStore((s) => s.loaded);
  const run = useSynthesisStore((s) => s.run);

  // Proactivity is per-person (read here, the bridge is the trust boundary). `off` disables synthesis entirely.
  const [proactivityOff, setProactivityOff] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void window.selfos?.coachingGetPrefs().then((p) => {
      if (active) setProactivityOff((p?.proactivity ?? 'gentle') === 'off');
    });
    return () => {
      active = false;
    };
  }, []);

  if (!configured || proactivityOff === null || proactivityOff || !loaded) return null;
  // Self-hide when there's nothing to show and nothing to run from (a brand-new person).
  if (!synthesis && !canSynthesize) return null;

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2}>
            <Sparkles size={16} aria-hidden="true" /> Something I’m noticing
          </Heading>
          {synthesis ? (
            <button
              type="button"
              className={styles.cardLink}
              onClick={() => navigate('/sessions', { state: { seedText: synthesis.observation } })}
            >
              Talk it through
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {synthesis ? (
          <Markdown>{synthesis.observation}</Markdown>
        ) : (
          <Text tone="secondary">
            Want me to look across your recent sessions, dreams, and reflections for a thread worth
            exploring?
          </Text>
        )}

        {error ? (
          <Text size="sm" tone="secondary">
            {error}
          </Text>
        ) : null}

        <div>
          <Button variant="secondary" disabled={running} onClick={() => void run()}>
            {running ? 'Looking…' : synthesis ? 'Look again' : 'What are you noticing lately?'}
          </Button>
        </div>

        <p className={styles.notMedical}>
          A gentle reflection across your reflections — something to wonder about, not a conclusion.
        </p>
      </Stack>
    </Card>
  );
}
