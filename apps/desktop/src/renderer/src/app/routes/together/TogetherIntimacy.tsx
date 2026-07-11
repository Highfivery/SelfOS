import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import type { TogetherYnmStatus } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
} from '../../../design-system/components';
import { useTogetherStore } from '../../../stores/togetherStore';
import styles from './Together.module.css';

/**
 * The Desire & intimacy affordance (58 §3.10/§3.10b): the active person's one-time 18+ acknowledgement, and
 * — once BOTH partners have acked + a live edge — the symmetric, revocable Yes/No/Maybe opt-in + the mutual
 * overlap. Everything is gated host-side; this surface only reflects the bridge's `youAcked`/`eligible`/`ready`.
 * A one-sided answer is NEVER shown — the overlap read returns `ready:false` until both opt in.
 */
export function TogetherIntimacy({
  partnerId,
  partnerName,
}: {
  partnerId: string;
  partnerName: string;
}): JSX.Element | null {
  const navigate = useNavigate();
  const create = useTogetherStore((s) => s.create);
  const loadCatalog = useTogetherStore((s) => s.loadCatalog);
  const [status, setStatus] = useState<TogetherYnmStatus | null>(null);
  const [overlap, setOverlap] = useState<{ key: string; label: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const s = (await window.selfos?.togetherYnmStatus({ partnerPersonId: partnerId })) ?? null;
    setStatus(s);
    if (s?.ready) {
      const o = await window.selfos?.togetherYnmOverlap({ partnerPersonId: partnerId });
      setOverlap(o?.ready ? o.items : []);
    } else {
      setOverlap(null);
    }
  }, [partnerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ack = async (): Promise<void> => {
    setBusy(true);
    await window.selfos?.togetherAcknowledgeAdult();
    await Promise.all([refresh(), loadCatalog()]);
    setBusy(false);
  };
  const optIn = async (): Promise<void> => {
    setBusy(true);
    await window.selfos?.togetherYnmOptIn({ partnerPersonId: partnerId });
    await refresh();
    setBusy(false);
  };
  const revoke = async (): Promise<void> => {
    setBusy(true);
    await window.selfos?.togetherYnmRevoke({ partnerPersonId: partnerId });
    await refresh();
    setBusy(false);
  };
  const startYnm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await create(partnerId, undefined, 'yes-no-maybe-together');
    if (result.ok) navigate(`/together/session/${result.session.id}`);
    else {
      setError(result.message);
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2} align="center">
          <Lock size={16} aria-hidden="true" />
          <Heading level={3}>Desire &amp; intimacy</Heading>
          <span className={styles.adultBadge}>18+</span>
        </Inline>

        {!status.youAcked ? (
          <>
            <Text size="sm" tone="secondary">
              Turn on adult content to unlock the Desire &amp; intimacy sessions and Yes/No/Maybe
              with {partnerName}. Intimacy topics can then be explored frankly, for consenting
              adults. Each of you turns this on for yourself.
            </Text>
            <Button onClick={() => void ack()} disabled={busy} aria-busy={busy}>
              <ShieldCheck size={14} aria-hidden="true" /> I’m 18+ — turn on adult content
            </Button>
          </>
        ) : !status.eligible ? (
          <Text size="sm" tone="secondary">
            You’ve turned on adult content. Waiting for {partnerName} to turn it on too — then the
            Desire &amp; intimacy sessions unlock for both of you.
          </Text>
        ) : (
          <>
            <Text size="sm" tone="secondary">
              <strong>Yes / No / Maybe.</strong> Privately compare what you’re each curious about —
              only the things you <em>both</em> lean toward are ever shown. Both of you must opt in,
              and you can revoke anytime.
            </Text>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            {!status.youOptedIn ? (
              <Button onClick={() => void optIn()} disabled={busy} aria-busy={busy}>
                Opt in to compare
              </Button>
            ) : !status.ready ? (
              <Stack gap={1}>
                <Text size="sm" tone="secondary">
                  You’ve opted in. Waiting for {partnerName} to opt in too.
                </Text>
                <Inline gap={2} align="center">
                  <Button variant="secondary" onClick={() => void revoke()} disabled={busy}>
                    Revoke
                  </Button>
                </Inline>
              </Stack>
            ) : (
              <Stack gap={2}>
                {overlap && overlap.length > 0 ? (
                  <Stack gap={1}>
                    <Text size="xs" tone="secondary" weight={600}>
                      You’re both curious about
                    </Text>
                    <ul>
                      {overlap.map((item) => (
                        <li key={item.key}>
                          <Text size="sm">{item.label}</Text>
                        </li>
                      ))}
                    </ul>
                  </Stack>
                ) : (
                  <Text size="sm" tone="secondary">
                    You’ve both opted in — but there’s no shared overlap yet. Fill in your intimacy
                    preferences in Onboarding to find common ground.
                  </Text>
                )}
                <Inline gap={2} align="center">
                  <Button onClick={() => void startYnm()} disabled={busy} aria-busy={busy}>
                    Start Yes/No/Maybe together
                  </Button>
                  <Button variant="secondary" onClick={() => void revoke()} disabled={busy}>
                    Revoke
                  </Button>
                </Inline>
              </Stack>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
