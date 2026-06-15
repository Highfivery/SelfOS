import { useNavigate } from 'react-router-dom';
import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { portraitStaleness } from '@selfos/core/intake';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useIntakeStore } from '../../../stores/intakeStore';

/**
 * The persistent onboarding nudge (18-personal-onboarding §3.1/§15): a warm prompt to finish the
 * getting-to-know-you intake — or, once complete, to refresh the portrait when answers have changed since.
 * Self-hides for someone without `intake.own`, or once complete AND the portrait is up to date.
 */
export function OnboardingCard(): JSX.Element | null {
  const navigate = useNavigate();
  const canDoIntake = useSessionStore((s) => s.can('intake.own'));
  const state = useIntakeStore((s) => s.state);
  const loaded = useIntakeStore((s) => s.loaded);

  if (!canDoIntake || !loaded || !state) return null;

  const complete = state.session.status === 'complete';
  const stale = complete ? portraitStaleness(state.session) : null;
  // Complete + portrait up to date → nothing to nudge.
  if (complete && !stale?.stale) return null;

  // Complete but the portrait is out of date (added/edited answers since) → nudge to refresh it.
  if (complete && stale?.stale) {
    return (
      <Card>
        <Stack gap={3}>
          <Heading level={2}>
            <RefreshCw size={18} aria-hidden="true" /> Keep your portrait up to date
          </Heading>
          <Text tone="secondary">
            You’ve added or changed about {stale.pct}% since your last portrait — refresh it so your
            coaching stays current.
          </Text>
          <div>
            <Button variant="primary" onClick={() => navigate('/onboarding')}>
              Refresh my portrait
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </Stack>
      </Card>
    );
  }

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
