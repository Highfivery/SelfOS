import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useIntakeStore } from '../../../stores/intakeStore';

/**
 * The persistent onboarding nudge (18-personal-onboarding §3.1): a warm prompt to finish the
 * getting-to-know-you intake. Shown while the active person can do their own intake and hasn't completed it;
 * self-hides once complete (or for someone without `intake.own`).
 */
export function OnboardingCard(): JSX.Element | null {
  const navigate = useNavigate();
  const canDoIntake = useSessionStore((s) => s.can('intake.own'));
  const state = useIntakeStore((s) => s.state);
  const loaded = useIntakeStore((s) => s.loaded);

  if (!canDoIntake || !loaded || !state || state.session.status === 'complete') return null;

  const started = state.session.sections.some((s) => s.status !== 'notStarted');

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>
          <Sparkles size={18} aria-hidden="true" />{' '}
          {started ? 'Finish getting to know SelfOS' : 'Tell SelfOS about yourself'}
        </Heading>
        <Text tone="secondary">
          {started
            ? 'Pick up your getting-to-know-you conversation where you left off — it helps SelfOS support you better.'
            : 'A warm, private conversation so SelfOS can understand you and support you better. Skip anything; stop anytime.'}
        </Text>
        <div>
          <Button variant="primary" onClick={() => navigate('/onboarding')}>
            {started ? 'Continue onboarding' : 'Start onboarding'}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </Stack>
    </Card>
  );
}
