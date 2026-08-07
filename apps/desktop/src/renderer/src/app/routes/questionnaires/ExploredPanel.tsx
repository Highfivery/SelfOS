import { useEffect } from 'react';
import { CheckCircle2, Circle, CircleDashed, Compass, Minus } from 'lucide-react';
import type { CoverageAreaView, CoverageStatus } from '@shared/channels';
import { useCoverageStore } from '../../../stores/coverageStore';
import { Banner, Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './ExploredPanel.module.css';

/**
 * The "Explored" tab (spec 69 §3.4) — a calm, own-scoped read of what SelfOS has explored with the active
 * person across their life areas, the topics they've marked off, and a steer control ("explore more" /
 * "leave alone") that writes to their Personalization Profile. Transparency + agency; never a required step.
 * Own-scoped: the bridge returns only the viewer's own coverage/feedback (never partner/reciprocity data).
 */

const STATUS: Record<CoverageStatus, { label: string; Icon: typeof Circle; className: string }> = {
  explored: { label: 'Explored', Icon: CheckCircle2, className: styles.statusExplored ?? '' },
  'lightly-touched': {
    label: 'Lightly touched',
    Icon: CircleDashed,
    className: styles.statusLight ?? '',
  },
  'not-yet': { label: 'Not yet explored', Icon: Circle, className: styles.statusNone ?? '' },
};

function StatusPill({ status }: { status: CoverageStatus }): JSX.Element {
  const s = STATUS[status];
  return (
    <span className={`${styles.status} ${s.className}`}>
      <s.Icon size={14} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function ExploredPanel(): JSX.Element {
  const view = useCoverageStore((s) => s.view);
  const loaded = useCoverageStore((s) => s.loaded);
  const error = useCoverageStore((s) => s.error);
  const steering = useCoverageStore((s) => s.steering);
  const load = useCoverageStore((s) => s.load);
  const steer = useCoverageStore((s) => s.steer);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const areas = view?.areas ?? [];
  const markedOff = view?.markedOff ?? [];
  const areaTopicIds = new Set(areas.map((a) => a.topicId));
  // The "marked off" section shows the specific question-level declines (those not tied to a life-area row,
  // which already reflect their state inline). Area-level "leave alone" is shown on the area row itself.
  const declines = markedOff.filter((m) => !m.topicId || !areaTopicIds.has(m.topicId));
  const leftAlone = (topicId: string): boolean =>
    markedOff.some((m) => m.topicId === topicId && m.kind === 'not-applicable');

  const onSteer = (
    area: CoverageAreaView,
    action: 'explore-more' | 'leave-alone' | 'clear',
  ): void => {
    void steer({ topicId: area.topicId, lifeArea: area.lifeArea, label: area.label, action });
  };

  return (
    <div
      role="tabpanel"
      id="qpanel-explored"
      aria-labelledby="qtab-explored"
      className={styles.panel}
    >
      <Stack gap={4}>
        <div>
          <Heading level={3}>What SelfOS has explored with you</Heading>
          <Text tone="secondary">
            A quiet look at where SelfOS has gotten to know you — and where it’s steering next. It
            never shows what anyone else shared. Tell it where to go deeper, or what to leave alone.
          </Text>
        </div>

        {error ? <Banner tone="warning">{error}</Banner> : null}
        {!loaded ? (
          <Text tone="secondary" aria-live="polite">
            Loading…
          </Text>
        ) : areas.length === 0 ? (
          <Card>
            <Text tone="secondary">
              SelfOS hasn’t explored anything with you yet. As you answer check-ins, this fills in.
            </Text>
          </Card>
        ) : (
          <Card>
            <Stack gap={2}>
              <Text tone="secondary" size="sm">
                Areas of your life
              </Text>
              <ul className={styles.areaList}>
                {areas.map((area) => {
                  const isLeftAlone = leftAlone(area.topicId);
                  const busy = steering === area.topicId;
                  return (
                    <li key={area.topicId} className={styles.area}>
                      <div className={styles.areaMain}>
                        <span className={styles.areaLabel}>{area.label}</span>
                        <StatusPill status={area.status} />
                        {area.steered ? (
                          <span className={styles.steeredTag}>
                            <Compass size={12} aria-hidden="true" />
                            Exploring more
                          </span>
                        ) : null}
                      </div>
                      {area.steerable ? (
                        <div className={styles.areaActions}>
                          <button
                            type="button"
                            className={styles.steerBtn}
                            aria-pressed={area.steered}
                            disabled={busy}
                            onClick={() => onSteer(area, area.steered ? 'clear' : 'explore-more')}
                          >
                            <Compass size={14} aria-hidden="true" />
                            Explore more
                          </button>
                          <button
                            type="button"
                            className={styles.steerBtn}
                            aria-pressed={isLeftAlone}
                            disabled={busy}
                            onClick={() => onSteer(area, isLeftAlone ? 'clear' : 'leave-alone')}
                          >
                            <Minus size={14} aria-hidden="true" />
                            Leave alone
                          </button>
                        </div>
                      ) : (
                        <span className={styles.readonlyNote}>
                          Managed in your intimacy settings
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Stack>
          </Card>
        )}

        {declines.length > 0 ? (
          <Card>
            <Stack gap={2}>
              <Text tone="secondary" size="sm">
                Things you’ve told SelfOS to leave alone
              </Text>
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
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </div>
  );
}
