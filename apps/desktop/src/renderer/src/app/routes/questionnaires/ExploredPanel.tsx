import { useEffect } from 'react';
import { ArrowDownRight, Compass, Lock, Minus, Pin, RefreshCw, Sparkles, X } from 'lucide-react';
import type { CandidateFeedItem, CoverageAreaView, CoverageStatus } from '@shared/channels';
import { useCoverageStore } from '../../../stores/coverageStore';
import { Banner, Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './ExploredPanel.module.css';

/**
 * The "Explored" tab (spec 70 §3) — the forward-first, own-scoped read of what SelfOS is curious about asking
 * the active person NEXT (the candidate feed), over an honest "how well I know you" overview that never reads
 * "done", plus the steer controls. Transparency + agency; never a required step. Own-scoped: the bridge returns
 * only the viewer's own coverage/candidates/feedback (never partner/reciprocity data).
 */

const STATUS: Record<CoverageStatus, { label: string; className: string }> = {
  'knows-well': { label: 'Knows you well', className: styles.statusHigh ?? '' },
  'getting-to-know': { label: 'Getting to know you', className: styles.statusMid ?? '' },
  new: { label: 'New', className: styles.statusNew ?? '' },
};

function CandidateCard({ item }: { item: CandidateFeedItem }): JSX.Element {
  const curate = useCoverageStore((s) => s.curate);
  const curating = useCoverageStore((s) => s.curating);
  const busy = curating === item.id;
  const pinned = item.curation === 'asked';
  const deeper = item.kind === 'go-deeper' || item.curation === 'go-deeper';

  return (
    <li className={`${styles.candidate} ${pinned ? styles.candidatePinned : ''}`}>
      <div className={styles.candidateHead}>
        <span className={`${styles.tag} ${deeper ? styles.tagDeeper : styles.tagNew}`}>
          {deeper ? (
            <ArrowDownRight size={12} aria-hidden="true" />
          ) : (
            <Sparkles size={12} aria-hidden="true" />
          )}
          {deeper ? 'go deeper' : 'new ground'}
        </span>
        <span className={styles.candidateArea}>{item.lifeArea}</span>
        {pinned ? (
          <span className={styles.pinnedTag}>
            <Pin size={12} aria-hidden="true" />
            Pinned
          </span>
        ) : null}
      </div>
      <p className={styles.candidatePrompt}>{item.prompt}</p>
      <div className={styles.candidateActions}>
        <button
          type="button"
          className={styles.curateBtn}
          aria-pressed={pinned}
          disabled={busy}
          onClick={() => curate({ candidateId: item.id, action: pinned ? 'clear' : 'ask' })}
        >
          <Pin size={14} aria-hidden="true" />
          {pinned ? 'Asking this' : 'Ask me this'}
        </button>
        <button
          type="button"
          className={styles.curateBtn}
          disabled={busy}
          onClick={() => curate({ candidateId: item.id, action: 'not-this' })}
        >
          <X size={14} aria-hidden="true" />
          Not this
        </button>
        <button
          type="button"
          className={styles.curateBtn}
          aria-pressed={item.curation === 'go-deeper'}
          disabled={busy}
          onClick={() =>
            curate({
              candidateId: item.id,
              action: item.curation === 'go-deeper' ? 'clear' : 'go-deeper',
            })
          }
        >
          <ArrowDownRight size={14} aria-hidden="true" />
          Go deeper
        </button>
      </div>
    </li>
  );
}

function AreaRow({ area }: { area: CoverageAreaView }): JSX.Element {
  const steer = useCoverageStore((s) => s.steer);
  const steering = useCoverageStore((s) => s.steering);
  const acknowledgeAdult = useCoverageStore((s) => s.acknowledgeAdult);
  const acking = useCoverageStore((s) => s.acking);
  const adultAcknowledged = useCoverageStore((s) => s.view?.adultAcknowledged ?? false);
  const markedOff = useCoverageStore((s) => s.view?.markedOff ?? []);
  const isLeftAlone = markedOff.some(
    (m) => m.topicId === area.topicId && m.kind === 'not-applicable',
  );
  const busy = steering === area.topicId;
  const status = STATUS[area.status];
  const pct = Math.round(Math.max(0, Math.min(1, area.depth)) * 100);
  // The Intimacy row is an 18+ area: it needs the shared acknowledgement before it becomes steerable + before
  // intimacy candidates surface (spec 70 §3.4). Until then, show an inline unlock instead of the steers.
  const needsUnlock = area.adultGated === true && !adultAcknowledged;

  return (
    <li className={styles.area}>
      <div className={styles.areaMain}>
        <span className={styles.areaLabel}>
          {area.label}
          {area.adultGated ? <span className={styles.adultBadge}>18+</span> : null}
        </span>
        <div className={styles.meterRow}>
          <span className={styles.meter} aria-hidden="true">
            <span
              className={`${styles.meterFill} ${area.status === 'new' ? styles.meterFillNew : ''}`}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className={`${styles.status} ${status.className}`}>{status.label}</span>
        </div>
      </div>
      {needsUnlock ? (
        <div className={styles.unlockRow}>
          <span className={styles.unlockNote}>For 18+. Confirm to explore this.</span>
          <button
            type="button"
            className={styles.unlockBtn}
            disabled={acking}
            onClick={() => void acknowledgeAdult()}
          >
            <Lock size={14} aria-hidden="true" />
            I’m 18 or older
          </button>
        </div>
      ) : area.steerable ? (
        <div className={styles.areaActions}>
          <button
            type="button"
            className={styles.steerBtn}
            aria-pressed={area.steered}
            disabled={busy}
            onClick={() =>
              steer({
                topicId: area.topicId,
                lifeArea: area.lifeArea,
                label: area.label,
                action: area.steered ? 'clear' : 'explore-more',
              })
            }
          >
            <Compass size={14} aria-hidden="true" />
            {area.steered ? 'Exploring more' : 'Explore more'}
          </button>
          <button
            type="button"
            className={styles.steerBtn}
            aria-pressed={isLeftAlone}
            disabled={busy}
            onClick={() =>
              steer({
                topicId: area.topicId,
                lifeArea: area.lifeArea,
                label: area.label,
                action: isLeftAlone ? 'clear' : 'leave-alone',
              })
            }
          >
            <Minus size={14} aria-hidden="true" />
            Leave alone
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function ExploredPanel(): JSX.Element {
  const view = useCoverageStore((s) => s.view);
  const loaded = useCoverageStore((s) => s.loaded);
  const error = useCoverageStore((s) => s.error);
  const refreshing = useCoverageStore((s) => s.refreshing);
  const load = useCoverageStore((s) => s.load);
  const lookForMore = useCoverageStore((s) => s.lookForMore);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const candidates = view?.candidates ?? [];
  const areas = view?.areas ?? [];
  const markedOff = view?.markedOff ?? [];
  const areaTopicIds = new Set(areas.map((a) => a.topicId));
  // The "marked off" section shows the specific question-level declines not already reflected on an area row.
  const declines = markedOff.filter((m) => !m.topicId || !areaTopicIds.has(m.topicId));
  const hasEverRefreshed = Boolean(view?.candidatesRefreshedAt);

  return (
    <div
      role="tabpanel"
      id="qpanel-explored"
      aria-labelledby="qtab-explored"
      className={styles.panel}
    >
      <Stack gap={4}>
        {error ? <Banner tone="warning">{error}</Banner> : null}

        {!loaded ? (
          <Text tone="secondary" aria-live="polite">
            Loading…
          </Text>
        ) : (
          <>
            <section>
              <div className={styles.sectionHead}>
                <Heading level={3}>What SelfOS is curious about next</Heading>
                <Text tone="secondary">
                  Concrete things it might ask you next, drawn from your own answers. Keep, skip, or
                  go deeper — what you keep is what it asks. It never shows what anyone else shared.
                </Text>
              </div>

              {candidates.length > 0 ? (
                <ul className={styles.candidateList}>
                  {candidates.map((c) => (
                    <CandidateCard key={c.id} item={c} />
                  ))}
                </ul>
              ) : (
                <Card>
                  <Text tone="secondary">
                    {hasEverRefreshed
                      ? 'Nothing queued right now. Look for more, or check back after your next check-in.'
                      : 'SelfOS is still getting to know you. New questions appear here after your next check-in — or look for some now.'}
                  </Text>
                </Card>
              )}

              <div className={styles.feedFoot}>
                <button
                  type="button"
                  className={styles.lookMoreBtn}
                  disabled={refreshing}
                  onClick={() => void lookForMore()}
                >
                  <RefreshCw
                    size={14}
                    aria-hidden="true"
                    className={refreshing ? styles.spin : ''}
                  />
                  {refreshing ? 'Looking…' : 'Look for more'}
                </button>
                <span className={styles.feedNote}>
                  Refreshes on its own. Looking now uses a little of your AI allowance.
                </span>
              </div>
            </section>

            <section>
              <div className={styles.sectionHead}>
                <Heading level={3}>How well I know you</Heading>
                <Text tone="secondary">
                  There’s always more to learn — this never reads “done”. Tell it where to lean in
                  or ease off.
                </Text>
              </div>
              {areas.length > 0 ? (
                <Card>
                  <ul className={styles.areaList}>
                    {areas.map((area) => (
                      <AreaRow key={area.topicId} area={area} />
                    ))}
                  </ul>
                </Card>
              ) : null}
            </section>

            {declines.length > 0 ? (
              <section>
                <div className={styles.sectionHead}>
                  <Heading level={3}>Things you’ve told SelfOS to leave alone</Heading>
                </div>
                <Card>
                  <ul className={styles.chipList}>
                    {declines.map((m, i) => (
                      <li key={`${m.label}-${i}`} className={styles.chip}>
                        <span>{m.label}</span>
                        <span className={styles.chipKind}>
                          {m.kind === 'not-applicable' ? 'Doesn’t apply' : 'Prefer not to say'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            ) : null}
          </>
        )}
      </Stack>
    </div>
  );
}
