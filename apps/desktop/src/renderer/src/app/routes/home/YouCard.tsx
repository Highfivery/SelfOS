import { useNavigate } from 'react-router-dom';
import { Sparkles, UserRound } from 'lucide-react';
import type { TestResult } from '@shared/schemas';
import type { TestSummary } from '@selfos/core/tests';
import { useTestStore } from '../../../stores/testStore';
import { Button, Card, Heading, Stack, SubscaleBar, Text } from '../../../design-system/components';
import { daysSince, RECHECK_AFTER_DAYS, RECHECKABLE_INSTRUMENTS } from './wellbeing';
import styles from './Home.module.css';

interface Highlight {
  key: string;
  label: string;
  normalized: number;
  signed: boolean;
  band?: string;
}

/** The most distinctive subscale of a taken test (max |normalized|), resolved to its display label + band. */
function topHighlight(test: TestSummary, result: TestResult): Highlight | null {
  let best: (typeof result.scores)[number] | undefined;
  for (const s of result.scores) {
    if (!best || Math.abs(s.normalized) > Math.abs(best.normalized)) best = s;
  }
  if (!best) return null;
  const meta = test.subscales.find((m) => m.key === best.key);
  return {
    key: `${test.id}:${best.key}`,
    label: meta?.label ?? best.key,
    normalized: best.normalized,
    signed: meta?.signed ?? false,
    ...(best.band ? { band: best.band } : {}),
  };
}

/**
 * The "You" bento card (60-home-dashboard §3.1.4) — a window into the self-assessments hub. It surfaces (1)
 * PROFILE HIGHLIGHTS: a signature trait from your latest results (nothing else on Home shows these), (2) a
 * gentle CHECK-IN nudge when your last mood/anxiety reflection is stale (≥14d — never for someone who's never
 * checked in, §8), and (3) TAKE-A-TEST invites for assessments you haven't done yet (the lead when you have no
 * results). "Explore" opens the You hub. Self-hides when there's no catalog (tests unavailable). Deep-links go
 * straight to the take flow / hub. Per-person (the testStore is scoped + resets on switch).
 */
export function YouCard(): JSX.Element | null {
  const navigate = useNavigate();
  const catalog = useTestStore((s) => s.catalog);
  const resultsByTest = useTestStore((s) => s.resultsByTest);
  const adultAcknowledged = useTestStore((s) => s.adultAcknowledged);

  if (catalog.length === 0) return null;

  const now = Date.now();

  // Profile highlights: the top subscale of each TAKEN non-wellbeing test, most-recently-taken first, capped 2.
  const taken = catalog
    .filter((t) => !t.wellbeing && (resultsByTest[t.id]?.length ?? 0) > 0)
    .map((t) => ({ test: t, result: resultsByTest[t.id]![0]! }))
    .sort((a, b) => b.result.takenAt.localeCompare(a.result.takenAt));
  const highlights = taken
    .map(({ test, result }) => topHighlight(test, result))
    .filter((h): h is Highlight => h !== null)
    .slice(0, 2);

  // A gentle "check in again" — the stalest recheckable instrument with a prior result that's gone ≥14d.
  let checkIn: { testId: string; days: number } | null = null;
  for (const t of catalog) {
    if (!RECHECKABLE_INSTRUMENTS.has(t.id)) continue;
    const latest = resultsByTest[t.id]?.[0];
    if (!latest) continue;
    const days = daysSince(latest.takenAt, now);
    if (days >= RECHECK_AFTER_DAYS && (!checkIn || days > checkIn.days)) {
      checkIn = { testId: t.id, days };
    }
  }

  // Untaken assessments to invite (adult ones only after the 18+ ack) — the lead when there are no results.
  const untaken = catalog
    .filter((t) => (resultsByTest[t.id]?.length ?? 0) === 0 && (!t.adult || adultAcknowledged))
    .slice(0, 3);

  const hasAnyResult = catalog.some((t) => (resultsByTest[t.id]?.length ?? 0) > 0);
  // Nothing to say at all — no results, nothing new to take: let another card carry the moment.
  if (!hasAnyResult && untaken.length === 0) return null;

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2} className={styles.sectionTitle}>
            <UserRound size={16} aria-hidden="true" /> You
          </Heading>
          <button type="button" className={styles.cardLink} onClick={() => navigate('/you')}>
            Explore
          </button>
        </div>

        {highlights.length > 0 ? (
          <div className={styles.youProfile}>
            <Text size="xs" tone="tertiary">
              Your profile
            </Text>
            {highlights.map((h) => (
              <SubscaleBar
                key={h.key}
                label={h.label}
                normalized={h.normalized}
                signed={h.signed}
                {...(h.band ? { band: h.band } : {})}
              />
            ))}
          </div>
        ) : (
          <Text tone="secondary" size="sm">
            Take a quick self-assessment to discover your profile — it helps your coach understand
            you.
          </Text>
        )}

        {checkIn ? (
          <div className={styles.youNudge}>
            <Text size="sm" tone="secondary">
              It’s been {checkIn.days} days since your last check-in.
            </Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/you/${checkIn.testId}/take`)}
            >
              Check in again
            </Button>
          </div>
        ) : null}

        {untaken.length > 0 ? (
          <div className={styles.youInvite}>
            <Text size="xs" tone="tertiary">
              {hasAnyResult ? 'Discover more' : 'Discover your profile'}
            </Text>
            <div className={styles.youChips}>
              {untaken.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.youChip}
                  onClick={() => navigate(`/you/${t.id}/take`)}
                >
                  <Sparkles size={13} aria-hidden="true" /> {t.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}
