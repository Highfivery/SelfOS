import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Compass, X } from 'lucide-react';
import type { IntakeSectionMeta, ProfileUpdateSuggestion } from '@shared/channels';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { DiscoveryTip } from '../../DiscoveryTip';
import { useSessionStore } from '../../../stores/sessionStore';
import { useIntakeStore } from '../../../stores/intakeStore';
import { useDiscoveryStore, DISCOVERY_KEYS } from '../../../stores/discoveryStore';
import styles from './Home.module.css';

// A stable empty reference — a selector that returns a fresh `[]` each call re-renders Zustand forever.
const NO_SECTIONS: IntakeSectionMeta[] = [];

/**
 * Progressive profile building — the DEPTH invitation nudge (29-progressive-profile-building §3.2). A calm,
 * opt-in card inviting the person to go deeper on an unexplored part of their profile that recent activity
 * kept circling ("we keep coming back to your family — want to tell me more?"). Self-hides when none pending.
 * Distinct from the §15 freshness card ("update a stale answer") — depth vs. freshness (§1). Own-scoped +
 * gated `intake.own` in the bridge; never an interrupt — **Go deeper** opens that intake section, **Not now**
 * is a durable dismissal (no re-nag). Accepting routes through the existing intake/18+ gate on the section.
 */
export function DepthInvitationCard(): JSX.Element | null {
  const navigate = useNavigate();
  const canDoIntake = useSessionStore((s) => s.can('intake.own'));
  const sections = useIntakeStore((s) => s.state?.sections ?? NO_SECTIONS);
  const [pending, setPending] = useState<ProfileUpdateSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const dismissTip = useDiscoveryStore((s) => s.dismiss);

  const load = useCallback(async (): Promise<void> => {
    const all = (await window.selfos?.profileSuggestions()) ?? [];
    setPending(all.filter((s) => s.kind === 'depth'));
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (canDoIntake) void load();
  }, [canDoIntake, load]);

  if (!canDoIntake || !loaded || pending.length === 0) return null;

  const titleFor = (sectionId: string | undefined): string =>
    sections.find((m) => m.id === sectionId)?.title ?? 'your profile';

  const goDeeper = async (s: ProfileUpdateSuggestion): Promise<void> => {
    dismissTip(DISCOVERY_KEYS.tipDepthInvitations); // acting on it suppresses the explainer tip
    setBusy(s.id);
    await window.selfos?.profileAcceptSuggestion(s.id);
    // Open the invited section in the Onboarding "Go deeper" flow, scrolled to the top (§3.3 / §14.7). The
    // renderer already holds the resolved `sectionId`, so no extra round-trip is needed to route.
    if (s.sectionId) navigate('/onboarding', { state: { openSection: s.sectionId } });
    setBusy(null);
  };

  const notNow = async (id: string): Promise<void> => {
    setBusy(id);
    const next = await window.selfos?.profileDismissSuggestion(id);
    setPending((next ?? []).filter((s) => s.kind === 'depth'));
    setBusy(null);
  };

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>
          <Compass size={18} aria-hidden="true" /> Want to go a little deeper?
        </Heading>
        <DiscoveryTip tipKey={DISCOVERY_KEYS.tipDepthInvitations}>
          SelfOS invites you to go deeper over time, as it notices what keeps coming up. Always
          optional.
        </DiscoveryTip>
        <Stack gap={3}>
          {pending.map((s) => (
            <div key={s.id} className={styles.freshnessItem}>
              <Stack gap={1}>
                <Text size="sm" weight={500}>
                  Tell me more about {titleFor(s.sectionId)}?
                </Text>
                <Text size="sm" tone="secondary">
                  {s.rationale || `We’ve touched on ${s.theme ?? 'this'} a few times.`}
                </Text>
              </Stack>
              <div className={styles.freshnessActions}>
                <Button
                  variant="secondary"
                  disabled={busy === s.id}
                  onClick={() => void goDeeper(s)}
                >
                  Go deeper <ArrowRight size={14} aria-hidden="true" />
                </Button>
                <Button variant="ghost" disabled={busy === s.id} onClick={() => void notNow(s.id)}>
                  <X size={14} aria-hidden="true" /> Not now
                </Button>
              </div>
            </div>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
