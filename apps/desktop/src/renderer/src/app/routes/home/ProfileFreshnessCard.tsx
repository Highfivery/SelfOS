import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, X } from 'lucide-react';
import type { ProfileUpdateSuggestion } from '@shared/channels';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import styles from './Home.module.css';

/** Human labels for the fields a suggestion can target (falls back to the raw key). */
const FIELD_LABELS: Record<string, string> = {
  occupation: 'Occupation',
  location: 'Location',
  relationshipStatus: 'Relationship status',
  parentalStatus: 'Children',
  livingSituation: 'Living situation',
  goals: 'Goals',
  communicationStyle: 'Communication style',
  values: 'Values',
  languages: 'Languages',
  interests: 'Interests',
  faith: 'Faith',
  healthNotes: 'Health notes',
  sexualOrientation: 'Sexual orientation',
  relationshipStyle: 'Relationship style',
};

/**
 * The self-maintaining-profile nudge (18-personal-onboarding §15): pending profile-update **freshness**
 * suggestions noticed by the analysis passes. Self-hides when there are none. Each is a **proposal** — Update
 * writes the field, Dismiss is durable (no re-nag). Own-scoped + gated `intake.own` in the bridge; shown only
 * to a person who can do their own intake. The §29 DEPTH invitations (`kind: 'depth'`) are a distinct surface
 * (DepthInvitationCard) — filtered out here so freshness and depth stay separate (29 §1/§3.2).
 */
export function ProfileFreshnessCard(): JSX.Element | null {
  const canDoIntake = useSessionStore((s) => s.can('intake.own'));
  const [pending, setPending] = useState<ProfileUpdateSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const all = (await window.selfos?.profileSuggestions()) ?? [];
    setPending(all.filter((s) => s.kind !== 'depth'));
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (canDoIntake) void load();
  }, [canDoIntake, load]);

  if (!canDoIntake || !loaded || pending.length === 0) return null;

  const act = async (id: string, accept: boolean): Promise<void> => {
    setBusy(id);
    const next = accept
      ? await window.selfos?.profileAcceptSuggestion(id)
      : await window.selfos?.profileDismissSuggestion(id);
    setPending((next ?? []).filter((s) => s.kind !== 'depth'));
    setBusy(null);
  };

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>
          <RefreshCw size={18} aria-hidden="true" /> Keep your profile fresh
        </Heading>
        <Text tone="secondary">
          A few things may have changed — review and update what still fits. Nothing changes unless
          you say so.
        </Text>
        <Stack gap={3}>
          {pending.map((s) => (
            <div key={s.id} className={styles.freshnessItem}>
              <Stack gap={1}>
                <Text size="sm" weight={500}>
                  {FIELD_LABELS[s.field ?? ''] ?? s.field ?? 'Profile'}: {s.observed}
                </Text>
                <Text size="sm" tone="secondary">
                  {s.rationale}
                  {s.current ? ` (was: ${s.current})` : ''}
                </Text>
              </Stack>
              <div className={styles.freshnessActions}>
                <Button
                  variant="secondary"
                  disabled={busy === s.id}
                  onClick={() => void act(s.id, true)}
                >
                  <Check size={14} aria-hidden="true" /> Update
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy === s.id}
                  onClick={() => void act(s.id, false)}
                >
                  <X size={14} aria-hidden="true" /> Dismiss
                </Button>
              </div>
            </div>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
