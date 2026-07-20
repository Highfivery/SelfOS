import { useCallback, useEffect, useState } from 'react';
import { Check, Flag, MoreVertical } from 'lucide-react';
import type { Challenge, ChallengeOutcome, JointChallengeStatus } from '@shared/schemas';
import { useChallengeStore } from '../../../stores/challengeStore';
import {
  Banner,
  Button,
  Collapsible,
  Heading,
  IconButton,
  Inline,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import {
  closedOutcomeLabel,
  isTwinCheckedIn,
  jointStateLine,
  ownTwin,
  splitJointChallenges,
} from './jointChallenges';
import styles from './Together.module.css';

const OUTCOME_OPTIONS: { outcome: ChallengeOutcome; label: string }[] = [
  { outcome: 'did', label: 'I did it' },
  { outcome: 'partly', label: 'Partly' },
  { outcome: 'didnt', label: 'Not this time' },
];

/**
 * The pair's JOINT challenges (58 §5.6) — a stretch action the couples coach set for BOTH partners.
 *
 * AMENDED 2026-07-20: this is now where you CHECK IN, not a status mirror that punts to Home (§12 — surface
 * the control where the work happens; the old "track your own check-in on Home" pointed at a surface that
 * couldn't check in). Each row carries a one-tap "Check in" that expands the 52 §3.5 outcome row + an
 * optional note, with snooze / let-go behind a kebab so the row stays dense.
 *
 * The privacy boundary is structural: the cross-partner AGGREGATE comes from the gated `together:jointChallenges`
 * read (counts only), while the viewer's OWN twin comes from their own person-scoped `challengeStore` and is
 * matched by `groupId`. A partner's reflection text never reaches this component. Self-hides when the pair has
 * no joint challenge at all.
 */
export function TogetherJointChallenges({
  partnerId,
  partnerName,
}: {
  partnerId: string;
  partnerName: string;
}): JSX.Element | null {
  const [items, setItems] = useState<JointChallengeStatus[] | null>(null);
  const challenges = useChallengeStore((s) => s.challenges);
  const challengesLoaded = useChallengeStore((s) => s.loaded);
  const loadChallenges = useChallengeStore((s) => s.load);

  const refresh = useCallback(async (): Promise<void> => {
    const list =
      (await window.selfos?.togetherJointChallenges({ partnerPersonId: partnerId })) ?? [];
    setItems(list);
  }, [partnerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The viewer's own twins live in the per-person challenge store. Refresh it whenever the tile mounts —
  // NOT just when the store is empty: Home loads the store at boot, so a twin minted later in a couples
  // session would leave a stale-but-`loaded` list and the row would offer no check-in at all.
  useEffect(() => {
    void loadChallenges();
  }, [loadChallenges, partnerId]);

  const { open, closed } = splitJointChallenges(items ?? []);
  if (open.length === 0 && closed.length === 0) return null;

  return (
    <Stack gap={2}>
      <Heading level={2}>{open.length > 1 ? 'Joint challenges' : 'Joint challenge'}</Heading>
      <Stack gap={2}>
        {open.map((i) => (
          <JointChallengeRow
            key={i.groupId}
            status={i}
            // `null` until the per-person store has loaded — the row must not guess "not me" and credit the
            // viewer's own check-in to their partner.
            twin={challengesLoaded ? (ownTwin(challenges, i.groupId) ?? null) : null}
            mineKnown={challengesLoaded}
            partnerName={partnerName}
            onActed={refresh}
          />
        ))}
      </Stack>
      {closed.length > 0 ? (
        <Collapsible header={<Text weight={600}>Completed &amp; closed ({closed.length})</Text>}>
          <Stack gap={2}>
            {closed.map((i) => (
              <div key={i.groupId} className={styles.challengeStrip}>
                <div className={styles.challengeMain}>
                  <span className={styles.challengeIcon}>
                    <Check size={20} aria-hidden="true" />
                  </span>
                  <div className={styles.challengeText}>
                    <Text weight={600}>{i.action}</Text>
                    <Text size="sm" tone="secondary">
                      {i.allCheckedIn
                        ? 'You both followed through on this one.'
                        : 'You let this one go.'}
                    </Text>
                  </div>
                </div>
                <span
                  className={styles.statusPill}
                  data-tone={i.allCheckedIn ? 'accent' : undefined}
                >
                  {i.allCheckedIn ? <Check size={13} aria-hidden="true" /> : null}{' '}
                  {closedOutcomeLabel(i)}
                </span>
              </div>
            ))}
          </Stack>
        </Collapsible>
      ) : null}
    </Stack>
  );
}

/**
 * One live joint challenge. Collapsed it shows the named state (who the ball is with) + a one-tap "Check in";
 * expanded it shows the outcome row + an optional note. A viewer who has already checked in gets no check-in
 * affordance — just their state and the wait on their partner.
 */
function JointChallengeRow({
  status,
  twin,
  mineKnown,
  partnerName,
  onActed,
}: {
  status: JointChallengeStatus;
  twin: Challenge | null;
  /** Whether the per-person store has loaded — until it has, the viewer's own state is genuinely unknown. */
  mineKnown: boolean;
  partnerName: string;
  onActed: () => Promise<void>;
}): JSX.Element {
  const checkIn = useChallengeStore((s) => s.checkIn);
  const snooze = useChallengeStore((s) => s.snooze);
  const setStatus = useChallengeStore((s) => s.setStatus);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = mineKnown ? isTwinCheckedIn(twin ?? undefined) : null;
  const canAct = twin !== null && twin.status === 'active';

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  /**
   * Run a mutation, then refresh BOTH sides: the store reloads the viewer's own twin, `onActed` re-reads the
   * partner-side aggregate — otherwise the count stays stale until the tile remounts.
   *
   * A failure is SURFACED, never swallowed (CLAUDE.md §4), and the panel stays open with the typed note
   * intact — silently discarding a reflection the person believes they saved is the worst outcome here.
   */
  const act = async (run: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const failure = await run();
      await onActed();
      if (failure) {
        setError(failure);
        return;
      }
      setExpanded(false);
      setMenuOpen(false);
      setNote('');
    } catch {
      setError('That didn’t save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const record = (outcome: ChallengeOutcome): void => {
    if (!twin) return;
    void act(async () => {
      const result = await checkIn(twin.id, outcome, note.trim() || undefined);
      // A missing/stale twin is exactly what the newest-record match guards against — say so rather than
      // collapsing the panel as if it worked.
      return result && !result.ok ? result.message : null;
    });
  };

  return (
    <div className={styles.challengeStrip}>
      <div className={styles.challengeMain}>
        <span className={styles.challengeIcon}>
          <Flag size={20} aria-hidden="true" />
        </span>
        <div className={styles.challengeText}>
          <Text weight={600}>{status.action}</Text>
          <Text size="sm" tone="secondary">
            A shared experiment you took on together.
          </Text>
        </div>
      </div>

      {expanded ? (
        <Stack gap={2} className={styles.challengeExpand}>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How did it go? (optional)"
            rows={2}
            aria-label="Your reflection"
          />
          <Inline gap={2} wrap>
            {OUTCOME_OPTIONS.map(({ outcome, label }) => (
              <Button
                key={outcome}
                variant={outcome === 'did' ? 'primary' : 'secondary'}
                onClick={() => record(outcome)}
                disabled={busy}
              >
                {label}
              </Button>
            ))}
            <Button variant="ghost" onClick={() => setExpanded(false)} disabled={busy}>
              Cancel
            </Button>
          </Inline>
        </Stack>
      ) : (
        // `wrap` matters at phone width: the pill carries an unbounded partner display name, and every child
        // here is non-shrinkable (§12 — a nowrap row would push an inner scrollbar).
        <Inline gap={2} align="center" wrap>
          <span
            className={styles.statusPill}
            data-tone={status.allCheckedIn ? 'accent' : undefined}
          >
            {status.allCheckedIn ? <Check size={13} aria-hidden="true" /> : null}{' '}
            {jointStateLine(status, mine, partnerName)}
          </span>
          {canAct && mine === false ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setExpanded(true)}
              disabled={busy}
              aria-busy={busy}
            >
              Check in
            </Button>
          ) : null}
          {canAct ? (
            <span className={styles.menuWrap}>
              <IconButton
                aria-label={`Options for “${status.action}”`}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MoreVertical size={14} aria-hidden="true" />
              </IconButton>
              {menuOpen ? (
                <>
                  <button
                    type="button"
                    className={styles.menuBackdrop}
                    aria-hidden="true"
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className={styles.menu} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      disabled={busy}
                      onClick={() =>
                        twin &&
                        void act(async () => {
                          await snooze(twin.id);
                          return null;
                        })
                      }
                    >
                      Not yet
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={`${styles.menuItem} ${styles.menuItemDanger}`}
                      disabled={busy}
                      onClick={() =>
                        twin &&
                        void act(async () => {
                          await setStatus(twin.id, 'abandoned');
                          return null;
                        })
                      }
                    >
                      Let it go
                    </button>
                  </div>
                </>
              ) : null}
            </span>
          ) : null}
        </Inline>
      )}

      {/* One full-width slot for a failed action, whichever state the row is in — never swallowed (§4). */}
      {error ? (
        <div className={styles.challengeError}>
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        </div>
      ) : null}
    </div>
  );
}
