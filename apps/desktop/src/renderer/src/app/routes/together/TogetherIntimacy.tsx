import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shuffle, Lock, ShieldCheck } from 'lucide-react';
import type { TogetherCatalogEntry, TogetherYnmStatus } from '@shared/schemas';
import { Banner, Button, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { useTogetherStore } from '../../../stores/togetherStore';
import { PracticeCard } from './PracticeCard';
import styles from './Together.module.css';

/**
 * The Desire & intimacy panel (58 §3.10/§3.10b), redesigned as ONE cohesive 18+ space instead of a bolted-on
 * card: the active person's one-time 18+ acknowledgement, and — once BOTH partners have acked + a live edge —
 * the symmetric, revocable Yes/No/Maybe opt-in + mutual overlap, alongside the adult guided practices. Every
 * gate is enforced host-side; this surface only reflects the bridge's `youAcked`/`eligible`/`ready`, and a
 * one-sided answer is NEVER shown (`ready:false` until both opt in).
 */
export function TogetherIntimacy({
  partnerId,
  partnerName,
  adultPractices,
  selectedId,
  onPick,
}: {
  partnerId: string;
  partnerName: string;
  adultPractices: TogetherCatalogEntry[];
  selectedId: string | null;
  onPick: (entry: TogetherCatalogEntry) => void;
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
    <div className={styles.intimacyPanel}>
      <div className={styles.intimacyHead}>
        <Lock size={18} aria-hidden="true" />
        <Heading level={2}>Desire &amp; intimacy</Heading>
        <span className={styles.adultBadge}>18+</span>
      </div>

      {!status.youAcked ? (
        <Stack gap={2} align="start">
          <Text size="sm" tone="secondary">
            A private, consenting space for the two of you. Turn on adult content to unlock the
            Desire &amp; intimacy sessions and Yes/No/Maybe with {partnerName} — intimacy topics can
            then be explored frankly, for consenting adults. Each of you turns this on for yourself.
          </Text>
          <Button onClick={() => void ack()} disabled={busy} aria-busy={busy}>
            <ShieldCheck size={14} aria-hidden="true" /> I’m 18+ — turn on adult content
          </Button>
        </Stack>
      ) : !status.eligible ? (
        <Text size="sm" tone="secondary">
          You’ve turned on adult content. Waiting for {partnerName} to turn it on too — then the
          Desire &amp; intimacy sessions unlock for both of you.
        </Text>
      ) : (
        <Stack gap={4}>
          <Text size="sm" tone="secondary">
            You’ve both turned on adult content, so it’s unlocked — a private space for consenting
            adults.
          </Text>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <div className={styles.intimacyCard}>
            <Text weight={600} className={styles.intimacyCardTitle}>
              <Shuffle size={16} aria-hidden="true" /> Yes / No / Maybe
            </Text>
            <Text size="sm" tone="secondary">
              Privately compare what you’re each curious about — only the things you <em>both</em>{' '}
              lean toward are ever shown. Both of you opt in, and you can revoke anytime.
            </Text>
            {!status.youOptedIn ? (
              <Inline gap={2} align="center">
                <Button onClick={() => void optIn()} disabled={busy} aria-busy={busy}>
                  Opt in to compare
                </Button>
              </Inline>
            ) : !status.ready ? (
              <Stack gap={2} align="start">
                <Text size="sm" tone="secondary">
                  You’ve opted in. Waiting for {partnerName} to opt in too.
                </Text>
                <Button variant="secondary" onClick={() => void revoke()} disabled={busy}>
                  Revoke
                </Button>
              </Stack>
            ) : (
              <Stack gap={2} align="start">
                {overlap && overlap.length > 0 ? (
                  <Stack gap={1}>
                    <Text size="xs" tone="secondary" weight={600}>
                      You’re both curious about
                    </Text>
                    <ul className={styles.chipRow}>
                      {overlap.map((item) => (
                        <li key={item.key} className={styles.chip}>
                          {item.label}
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
          </div>

          {adultPractices.length > 0 ? (
            <Stack gap={1}>
              <Text size="xs" tone="secondary" weight={600} className={styles.practiceGroupTitle}>
                Guided practices
              </Text>
              <div className={styles.practiceGrid}>
                {adultPractices.map((entry) => (
                  <PracticeCard
                    key={entry.id}
                    entry={entry}
                    selected={selectedId === entry.id}
                    onPick={onPick}
                  />
                ))}
              </div>
            </Stack>
          ) : null}
        </Stack>
      )}
    </div>
  );
}
