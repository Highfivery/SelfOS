import { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  Compass,
  Heart,
  Lock,
  Minus,
  Pin,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CandidateFeedItem,
  CoverageAreaView,
  CoverageTopicView,
  PartnerWishGroupView,
} from '@shared/channels';
import { useCoverageStore } from '../../../stores/coverageStore';
import { Banner, Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './ExploredPanel.module.css';

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
        <span className={styles.candidateHeadRight}>
          {pinned ? (
            <span className={styles.pinnedTag}>
              <Pin size={12} aria-hidden="true" />
              Pinned
            </span>
          ) : null}
          <button
            type="button"
            className={styles.candidateRemove}
            aria-label={`Remove this question: ${item.prompt}`}
            title="Remove this question"
            disabled={busy}
            onClick={() => curate({ candidateId: item.id, action: 'not-this' })}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </span>
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

/**
 * One specific piece of ground inside an area (spec 71 §5.8).
 *
 * The emergent map is the point of the surface: ground the model NAMED from this person's own material was
 * previously invisible here, because the panel only ever showed one row per life area. Worked-through topics
 * are listed too — seeing what it already covered is most of why someone opens this.
 */
const AREA_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open ground' },
  { id: 'worked', label: 'Well covered' },
  { id: 'ai', label: 'Named by AI' },
  { id: 'paused', label: 'Paused' },
] as const;
type AreaFilter = (typeof AREA_FILTERS)[number]['id'];

/** 12-month activity, drawn as bars. Text equivalent in the aria-label (§9 — never colour/shape alone). */
function Sparkline({ activity }: { activity: readonly number[] }): JSX.Element | null {
  const total = activity.reduce((n, v) => n + v, 0);
  // Nothing asked in a year renders as a row of flat empty bars, which reads as a broken dashed line rather
  // than "quiet". Caught only by looking at it — draw nothing instead.
  if (activity.length === 0 || total === 0) return null;
  const max = Math.max(...activity, 1);
  const w = 76;
  const h = 20;
  const bw = w / activity.length;
  return (
    <svg
      className={styles.spark}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${total} ${total === 1 ? 'question' : 'questions'} over the last 12 months`}
    >
      <title>{`${total} ${total === 1 ? 'question' : 'questions'} over the last 12 months`}</title>
      {activity.map((v, i) => {
        // A zero month draws NOTHING. Rendering it as a faint 1px bar made a sparse year read as a dashed
        // line beside the title instead of a chart — visible immediately in the app, invisible to every test.
        if (v === 0) return null;
        const bh = (v / max) * (h - 3) + 2;
        return (
          <rect
            key={i}
            x={i * bw}
            y={h - bh}
            width={Math.max(2, bw - 1.6)}
            height={bh}
            rx={1}
            className={styles.sparkBar}
          />
        );
      })}
    </svg>
  );
}

const shortDate = (iso: string | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * One piece of ground inside an area.
 *
 * Labels say what the control DOES, which took three passes to get right. "Explore again" read as *finished,
 * revisit sometime*; "leave alone" described a mood; "ask about this next" implied the topic would not be
 * asked about otherwise, which is false — everything stays in the pool and this only changes the order. And
 * the same control does two different things: on open ground it moves the topic up; on WORKED ground it
 * re-opens ground the system had closed (`requestedTopicIds` overrides saturation), which is a bigger deal
 * and now says so.
 */
function TopicRow({
  topic,
  area,
}: {
  topic: CoverageTopicView;
  area: CoverageAreaView;
}): JSX.Element {
  const steer = useCoverageStore((s) => s.steer);
  const steering = useCoverageStore((s) => s.steering);
  const busy = steering === topic.topicId;
  const send = (action: 'explore-more' | 'leave-alone' | 'clear'): void => {
    void steer({ topicId: topic.topicId, lifeArea: area.lifeArea, label: topic.label, action });
  };
  const last = shortDate(topic.lastAskedAt);
  const until = shortDate(topic.pausedUntil);
  return (
    <li className={styles.topicRow}>
      <div className={styles.topicMain}>
        <span className={styles.topicName}>
          {topic.label}
          {topic.emergent ? <span className={styles.topicNew}>AI named</span> : null}
          {topic.leftAlone ? (
            <span className={styles.topicPaused}>{until ? `Paused until ${until}` : 'Paused'}</span>
          ) : topic.prioritized ? (
            <span className={styles.topicPinned}>Prioritized</span>
          ) : null}
        </span>
        {topic.blurb ? <span className={styles.topicBlurb}>{topic.blurb}</span> : null}
      </div>
      <div className={`${styles.topicSide} ${topic.blurb ? '' : styles.topicSideFlat}`}>
        <span className={styles.topicCount}>
          {topic.askedCount === 0
            ? 'not asked yet'
            : `asked ${topic.askedCount}×${last ? ` · last ${last}` : ''}`}
        </span>
        <span className={styles.topicActs}>
          {topic.leftAlone ? (
            <button
              type="button"
              className={styles.topicAct}
              disabled={busy}
              aria-label={`Start asking about ${topic.label} again`}
              onClick={() => send('clear')}
            >
              Start asking again
            </button>
          ) : (
            <>
              <button
                type="button"
                className={styles.topicAct}
                disabled={busy}
                aria-pressed={topic.prioritized}
                aria-label={
                  topic.prioritized
                    ? `Remove priority from ${topic.label}`
                    : topic.open
                      ? `Prioritize ${topic.label}`
                      : `Revisit ${topic.label}`
                }
                onClick={() => send(topic.prioritized ? 'clear' : 'explore-more')}
              >
                {topic.prioritized
                  ? 'Remove priority'
                  : topic.open
                    ? 'Prioritize this'
                    : 'Revisit this'}
              </button>
              <button
                type="button"
                className={`${styles.topicAct} ${styles.topicActStop}`}
                disabled={busy}
                aria-label={`Pause asking about ${topic.label}`}
                onClick={() => send('leave-alone')}
              >
                Pause asking
              </button>
            </>
          )}
        </span>
      </div>
    </li>
  );
}

/**
 * One life area, as a card.
 *
 * There is deliberately NO completeness meter here. A bar filling toward a full width claims progress toward
 * finished, and no area is ever finished — there is always another question, which is the whole premise of the
 * emergent topic map. The card reports what actually happened instead: activity over the last year, how many
 * questions, when the ground was last worked, and how much of it is still open.
 */
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
  const [expanded, setExpanded] = useState(false);
  const needsUnlock = area.adultGated === true && !adultAcknowledged;
  const openCount = area.topics.filter((t) => t.open && !t.leftAlone).length;
  const last = shortDate(area.lastAskedAt);
  const canExpand = area.topics.length > 0 && !needsUnlock;

  return (
    <li className={`${styles.area} ${expanded ? styles.areaOpen : ''}`}>
      <button
        type="button"
        className={styles.areaHead}
        aria-expanded={canExpand ? expanded : undefined}
        disabled={!canExpand}
        onClick={() => canExpand && setExpanded((v) => !v)}
      >
        <span className={styles.areaTop}>
          <span className={styles.areaLabel}>
            {area.label}
            {area.adultGated ? <span className={styles.adultBadge}>18+</span> : null}
          </span>
          {area.activity.some((v) => v > 0) ? (
            <span className={styles.sparkWrap}>
              <Sparkline activity={area.activity} />
              <span className={styles.sparkCaption}>asked over 12 months</span>
            </span>
          ) : null}
        </span>
        {area.blurb ? <span className={styles.areaBlurb}>{area.blurb}</span> : null}
        <span className={styles.areaMeta}>
          <span className={styles.metaCount}>
            <b>{area.askedCount}</b> asked
          </span>
          {last ? <span className={styles.metaSep}>· last {last}</span> : null}
          {area.topics.length > 0 && !needsUnlock ? (
            <span className={styles.metaSep}>
              · {area.topics.length} {area.topics.length === 1 ? 'topic' : 'topics'}
            </span>
          ) : null}
          {openCount > 0 && !needsUnlock ? (
            <span className={styles.metaOpen}>· {openCount} open</span>
          ) : null}
        </span>
      </button>
      {canExpand ? (
        <div className={styles.chipRow}>
          {area.topics.slice(0, 4).map((t) => (
            <span
              key={t.topicId}
              className={`${styles.tchip} ${
                t.leftAlone
                  ? styles.tchipPaused
                  : t.emergent
                    ? styles.tchipNew
                    : t.open
                      ? styles.tchipOpen
                      : styles.tchipWorked
              }`}
            >
              {t.label}
            </span>
          ))}
          {area.topics.length > 4 ? (
            <span className={`${styles.tchip} ${styles.tchipMore}`}>+{area.topics.length - 4}</span>
          ) : null}
        </div>
      ) : null}
      {expanded && canExpand ? (
        <ul className={styles.topicList}>
          {area.topics.map((t) => (
            <TopicRow key={t.topicId} topic={t} area={area} />
          ))}
        </ul>
      ) : null}
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
              void steer({
                topicId: area.topicId,
                lifeArea: area.lifeArea,
                label: area.label,
                action: area.steered ? 'clear' : 'explore-more',
              })
            }
          >
            <Compass size={14} aria-hidden="true" />
            {area.steered ? 'Prioritized' : 'Prioritize this area'}
          </button>
          <button
            type="button"
            className={styles.steerBtn}
            aria-pressed={isLeftAlone}
            disabled={busy}
            onClick={() =>
              void steer({
                topicId: area.topicId,
                lifeArea: area.lifeArea,
                label: area.label,
                action: isLeftAlone ? 'clear' : 'leave-alone',
              })
            }
          >
            <Minus size={14} aria-hidden="true" />
            {isLeftAlone ? 'Start asking again' : 'Pause asking'}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function PartnerCard({ group }: { group: PartnerWishGroupView }): JSX.Element {
  const addPartnerWish = useCoverageStore((s) => s.addPartnerWish);
  const removePartnerWish = useCoverageStore((s) => s.removePartnerWish);
  const wishing = useCoverageStore((s) => s.wishing);
  const adultAcknowledged = useCoverageStore((s) => s.view?.adultAcknowledged ?? false);
  const [note, setNote] = useState('');
  const [intimacy, setIntimacy] = useState(false);
  const busy = wishing === group.partnerId;

  const submit = (): void => {
    const trimmed = note.trim();
    if (!trimmed || busy) return;
    // Only ever flag intimacy while the person currently holds the 18+ ack — so a stale local
    // `intimacy: true` can't ride along after the toggle unmounts (the checkbox only shows when acked).
    void addPartnerWish({
      partnerPersonId: group.partnerId,
      note: trimmed,
      ...(intimacy && adultAcknowledged ? { intimacy: true } : {}),
    });
    setNote('');
    setIntimacy(false);
  };

  return (
    <Card>
      <Stack gap={2}>
        <div>
          <Heading level={3}>Explore with {group.partnerName}</Heading>
          <Text tone="secondary">
            Something you’d like SelfOS to explore with {group.partnerName}. It weaves these into
            their check-ins naturally — they never see that you asked.
          </Text>
        </div>
        {group.wishes.length > 0 ? (
          <ul className={styles.wishList}>
            {group.wishes.map((w) => (
              <li key={w.id} className={styles.wish}>
                <span className={styles.wishNote}>
                  {w.intimacy ? (
                    <span className={styles.wishIntimacy}>
                      <Heart size={12} aria-hidden="true" />
                      18+
                    </span>
                  ) : null}
                  {w.note}
                </span>
                <button
                  type="button"
                  className={styles.wishRemove}
                  aria-label={`Remove “${w.note}”`}
                  disabled={busy}
                  onClick={() =>
                    void removePartnerWish({ wishId: w.id, partnerId: group.partnerId })
                  }
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className={styles.wishAdd}>
          <input
            type="text"
            className={styles.wishInput}
            value={note}
            maxLength={300}
            placeholder={`Something to explore with ${group.partnerName}…`}
            aria-label={`Something to explore with ${group.partnerName}`}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <button
            type="button"
            className={styles.wishAddBtn}
            disabled={busy || note.trim() === ''}
            onClick={submit}
          >
            Add
          </button>
        </div>
        {adultAcknowledged ? (
          <label className={styles.wishIntimacyToggle}>
            <input
              type="checkbox"
              checked={intimacy}
              disabled={busy}
              onChange={(e) => setIntimacy(e.target.checked)}
            />
            An intimacy topic (18+)
          </label>
        ) : null}
      </Stack>
    </Card>
  );
}

type ExploredSection = 'curious' | 'coverage' | 'partner' | 'left-alone';

export function ExploredPanel(): JSX.Element {
  const view = useCoverageStore((s) => s.view);
  const loaded = useCoverageStore((s) => s.loaded);
  const error = useCoverageStore((s) => s.error);
  const refreshing = useCoverageStore((s) => s.refreshing);
  const clearing = useCoverageStore((s) => s.clearing);
  const load = useCoverageStore((s) => s.load);
  const lookForMore = useCoverageStore((s) => s.lookForMore);
  const clearFeed = useCoverageStore((s) => s.clearFeed);

  const [section, setSection] = useState<ExploredSection>('curious');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const candidates = view?.candidates ?? [];
  const areas = view?.areas ?? [];
  const markedOff = view?.markedOff ?? [];
  const partners = view?.partners ?? [];
  const areaTopicIds = new Set(areas.map((a) => a.topicId));
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('all');
  const [areaTerm, setAreaTerm] = useState('');
  const term = areaTerm.trim().toLowerCase();
  const visibleAreas = areas.filter((a) => {
    const hit = (s2: string | undefined): boolean => (s2 ?? '').toLowerCase().includes(term);
    if (
      term &&
      !(hit(a.label) || hit(a.blurb) || a.topics.some((t) => hit(t.label) || hit(t.blurb)))
    )
      return false;
    if (areaFilter === 'open') return a.topics.some((t) => t.open && !t.leftAlone);
    if (areaFilter === 'worked') return a.topics.some((t) => !t.open && !t.leftAlone);
    if (areaFilter === 'ai') return a.topics.some((t) => t.emergent);
    if (areaFilter === 'paused') return a.topics.some((t) => t.leftAlone);
    return true;
  });
  // The "left alone" list shows the specific question-level declines not already reflected on an area row.
  const declines = markedOff.filter((m) => !m.topicId || !areaTopicIds.has(m.topicId));
  const hasEverRefreshed = Boolean(view?.candidatesRefreshedAt);
  // The nav uses just the first name so the label stays on one line; the section itself keeps the full name.
  const partnerFirst = partners.length === 1 ? partners[0]?.partnerName.split(' ')[0] : undefined;

  // The Explored sections, each its own full-width view (spec 70 §3, sub-nav layout). Partner/left-alone only
  // appear when they have content.
  const navItems: { id: ExploredSection; label: string; count: number; icon: JSX.Element }[] = [
    {
      id: 'curious',
      label: 'Curious next',
      count: candidates.length,
      icon: <Sparkles size={16} />,
    },
    {
      id: 'coverage',
      label: 'How well it knows you',
      count: areas.length,
      icon: <Compass size={16} />,
    },
    ...(partners.length > 0
      ? [
          {
            id: 'partner' as const,
            label: partnerFirst ? `Explore with ${partnerFirst}` : 'Explore with a partner',
            count: partners.length,
            icon: <Heart size={16} />,
          },
        ]
      : []),
    ...(declines.length > 0
      ? [
          {
            id: 'left-alone' as const,
            label: 'Left alone',
            count: declines.length,
            icon: <Minus size={16} />,
          },
        ]
      : []),
  ];
  // Fall back to the feed if the active section is no longer available (e.g. the last decline was cleared).
  const active = navItems.some((n) => n.id === section) ? section : 'curious';

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
            <Text tone="secondary" className={styles.lead}>
              A quiet look at where SelfOS is getting to know you — and where it’s steering next. It
              never shows what anyone else shared. Tell it where to go deeper, or what to leave
              alone.
            </Text>

            <div className={styles.layout}>
              <nav className={styles.subnav} aria-label="Explored sections">
                {navItems.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`${styles.navItem} ${active === n.id ? styles.navItemOn : ''}`}
                    aria-current={active === n.id ? 'page' : undefined}
                    onClick={() => {
                      setSection(n.id);
                      setConfirmClear(false);
                    }}
                  >
                    <span className={styles.navIcon} aria-hidden="true">
                      {n.icon}
                    </span>
                    <span className={styles.navLabel}>{n.label}</span>
                    <span className={styles.navCount}>{n.count}</span>
                  </button>
                ))}
              </nav>

              <div className={styles.sectionPanel}>
                {active === 'curious' ? (
                  <section>
                    <div className={styles.feedHead}>
                      <div className={styles.sectionHead}>
                        <Heading level={3}>What SelfOS is curious about next</Heading>
                        <Text tone="secondary">
                          Concrete things it might ask you next, drawn from your own answers. Keep
                          it, remove it, or go deeper — what you keep is what it asks. It never
                          shows what anyone else shared.
                        </Text>
                      </div>
                      {candidates.length > 0 ? (
                        confirmClear ? (
                          <span className={styles.confirmRow}>
                            <Text tone="secondary">Remove all {candidates.length}?</Text>
                            <button
                              type="button"
                              className={styles.dangerBtn}
                              disabled={clearing}
                              onClick={() => {
                                void clearFeed();
                                setConfirmClear(false);
                              }}
                            >
                              Clear all
                            </button>
                            <button
                              type="button"
                              className={styles.clearBtn}
                              onClick={() => setConfirmClear(false)}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={styles.clearBtn}
                            disabled={clearing}
                            onClick={() => setConfirmClear(true)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            Clear all
                          </button>
                        )
                      ) : null}
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
                ) : null}

                {active === 'coverage' ? (
                  <section>
                    <div className={styles.sectionHead}>
                      <Heading level={3}>How well I know you</Heading>
                      <Text tone="secondary">
                        There’s always more to learn — this never reads “done”. Tell it where to
                        lean in or ease off.
                      </Text>
                    </div>
                    {areas.length > 0 ? (
                      <>
                        <div className={styles.pulse}>
                          <span className={styles.pu}>
                            <b>{areas.reduce((n, a) => n + a.askedCount, 0)}</b>
                            <span>questions asked</span>
                          </span>
                          <span className={styles.pu}>
                            <b className={styles.puOn}>
                              {areas.reduce(
                                (n, a) => n + a.topics.filter((t) => t.open && !t.leftAlone).length,
                                0,
                              )}
                            </b>
                            <span>ground still open</span>
                          </span>
                          <span className={styles.pu}>
                            <b>
                              {areas.reduce(
                                (n, a) => n + a.topics.filter((t) => t.emergent).length,
                                0,
                              )}
                            </b>
                            <span>topics AI named</span>
                          </span>
                        </div>
                        <div className={styles.filterBar}>
                          <div className={styles.seg} role="group" aria-label="Filter areas">
                            {AREA_FILTERS.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                aria-pressed={areaFilter === f.id}
                                onClick={() => setAreaFilter(f.id)}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                          <input
                            className={styles.searchBox}
                            type="search"
                            value={areaTerm}
                            placeholder="Search areas and topics…"
                            aria-label="Search areas and topics"
                            onChange={(e) => setAreaTerm(e.target.value)}
                          />
                        </div>
                        {visibleAreas.length > 0 ? (
                          <ul className={styles.areaList}>
                            {visibleAreas.map((area) => (
                              <AreaRow key={area.topicId} area={area} />
                            ))}
                          </ul>
                        ) : (
                          <Text tone="secondary">Nothing matches that.</Text>
                        )}
                      </>
                    ) : null}
                  </section>
                ) : null}

                {active === 'partner' ? (
                  <section>
                    <Stack gap={3}>
                      {partners.map((group) => (
                        <PartnerCard key={group.partnerId} group={group} />
                      ))}
                    </Stack>
                  </section>
                ) : null}

                {active === 'left-alone' ? (
                  <section>
                    <div className={styles.sectionHead}>
                      <Heading level={3}>Left alone</Heading>
                      <Text tone="secondary">
                        Things you’ve told SelfOS not to explore. It steers clear of these.
                      </Text>
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
              </div>
            </div>
          </>
        )}
      </Stack>
    </div>
  );
}
