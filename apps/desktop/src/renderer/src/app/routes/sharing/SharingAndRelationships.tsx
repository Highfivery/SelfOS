import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CircleUser, Gem, HandHeart, Share2 } from 'lucide-react';
import type { Relationship } from '@shared/schemas';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import { availableRelationshipTypesFor } from '../../availableRelationshipTypes';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { RelationshipInsightsCard } from './RelationshipInsightsCard';
import { SharingByCategory } from './SharingByCategory';
import { SharingByPerson } from './SharingByPerson';
import { SharingFilterBar } from './SharingFilterBar';
import { SharingItemRow } from './SharingItemRow';
import { SharingStatsHeader } from './SharingStatsHeader';
import {
  EMPTY_SHARING_FILTERS,
  filterAndSortItems,
  resolveSharingTab,
  SHARING_TAB_LABEL,
  SHARING_TABS,
  summarizeSharingStats,
  type SharingFilters,
  type SharingSort,
  type SharingTab,
} from './sharingDashboard';
import styles from './SharingDashboard.module.css';

const TAB_ICON = {
  'by-person': CircleUser,
  'by-category': Gem,
  everything: Share2,
  reflections: HandHeart,
} as const;

/**
 * The unified Sharing transparency dashboard (68 §3) — "the one complete view of everything about you that
 * reaches anyone." A stats header + four tabs (By person / By category / Everything / Reflections) + a
 * filter/sort/search bar, folding in profile-field + dream-image sharing alongside memories + answers. Gated
 * `memory.own`; per-person (the store resets on switch). Crisis footer + not-medical line always present (§8).
 */
export function SharingAndRelationships(): JSX.Element {
  const navigate = useNavigate();
  const routeTab = (useParams()['*'] ?? '').split('/')[0] ?? '';

  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  const canEditAnswers = useSessionStore((s) => s.can('intake.own'));
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);

  const outbound = useInsightStore((s) => s.outbound);
  const insights = useInsightStore((s) => s.insights);
  const loaded = useInsightStore((s) => s.loaded);
  const load = useInsightStore((s) => s.load);

  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [filters, setFilters] = useState<SharingFilters>(EMPTY_SHARING_FILTERS);
  const [sort, setSort] = useState<SharingSort>('recent');

  useEffect(() => {
    void load();
    void loadPeople();
    void window.selfos?.relationshipsList?.().then((rels) => setRelationships(rels ?? []));
  }, [load, loadPeople]);

  // The `sharing/*` splat mirrored to state (the Together/Story pattern) so a deep-link lands + reload
  // survives, AND it still renders bare in RTL (no Route context).
  const [tab, setTab] = useState<SharingTab>(() => resolveSharingTab(routeTab));
  useEffect(() => setTab(resolveSharingTab(routeTab)), [routeTab]);
  const goTab = (t: SharingTab): void => {
    setTab(t);
    navigate(t === 'by-person' ? '/sharing' : `/sharing/${t}`);
  };
  const onTabKeyDown = (e: React.KeyboardEvent): void => {
    const i = SHARING_TABS.indexOf(tab);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % SHARING_TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + SHARING_TABS.length) % SHARING_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SHARING_TABS.length - 1;
    else return;
    e.preventDefault();
    const key = SHARING_TABS[next];
    if (!key) return;
    goTab(key);
    document.getElementById(`shtab-${key}`)?.focus();
  };

  const availableTypes = useMemo(
    () => availableRelationshipTypesFor(activePersonId, relationships),
    [activePersonId, relationships],
  );
  const stats = useMemo(
    () => summarizeSharingStats(outbound, activePersonId, relationships),
    [outbound, activePersonId, relationships],
  );
  const visibleItems = useMemo(
    () => filterAndSortItems(outbound.items, filters, sort),
    [outbound.items, filters, sort],
  );

  // The viewer's PARTNER relationships → one relationship-insight card each (Reflections tab, moved verbatim).
  const partners = useMemo(() => {
    if (!activePersonId) return [] as { id: string; name: string }[];
    const ids = new Set<string>();
    for (const r of relationships) {
      if (r.type !== 'partner') continue;
      if (r.fromPersonId === activePersonId) ids.add(r.toPersonId);
      else if (r.toPersonId === activePersonId) ids.add(r.fromPersonId);
    }
    return [...ids]
      .map((id) => ({ id, name: people.find((p) => p.id === id)?.displayName }))
      .filter((p): p is { id: string; name: string } => p.name !== undefined);
  }, [relationships, activePersonId, people]);

  const nothingShared = loaded && outbound.items.length === 0;

  return (
    <div className={styles.page}>
      <Stack gap={2}>
        <Heading level={2}>Sharing</Heading>
        <Text tone="secondary">
          Everything about you that helps the people you relate to — used to personalize their
          coaching, never shown to them directly.
        </Text>
      </Stack>

      {nothingShared && stats.keptPrivateCount === 0 ? (
        <Card>
          <Stack gap={3} align="center">
            <Share2 size={24} aria-hidden="true" />
            <Text tone="secondary">
              You’re not sharing anything yet. When you choose to let a memory, an onboarding
              answer, a profile detail, or a dream image inform someone you relate to, it shows up
              here — so you can always see and change exactly what flows where.
            </Text>
          </Stack>
        </Card>
      ) : (
        <SharingStatsHeader stats={stats} />
      )}

      <div className={styles.tabs} role="tablist" aria-label="Sharing">
        {SHARING_TABS.map((t) => {
          const Icon = TAB_ICON[t];
          const count =
            t === 'everything'
              ? outbound.items.length
              : t === 'reflections'
                ? partners.length
                : undefined;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              id={`shtab-${t}`}
              {...(tab === t ? { 'aria-controls': `shpanel-${t}` } : {})}
              aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => goTab(t)}
              onKeyDown={onTabKeyDown}
            >
              <Icon size={15} aria-hidden="true" />
              {SHARING_TAB_LABEL[t]}
              {count !== undefined && count > 0 ? (
                <span className={styles.tabCount}>{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab !== 'reflections' ? (
        <SharingFilterBar
          items={outbound.items}
          availableTypes={availableTypes}
          filters={filters}
          onFilters={setFilters}
          sort={sort}
          onSort={setSort}
        />
      ) : null}

      <section role="tabpanel" id={`shpanel-${tab}`} aria-labelledby={`shtab-${tab}`}>
        {tab === 'by-person' ? (
          <SharingByPerson
            items={visibleItems}
            insights={insights}
            availableTypes={availableTypes}
            canEditAnswers={canEditAnswers}
          />
        ) : null}

        {tab === 'by-category' ? (
          <SharingByCategory
            items={visibleItems}
            insights={insights}
            relationships={relationships}
            activePersonId={activePersonId}
            availableTypes={availableTypes}
            canEditAnswers={canEditAnswers}
          />
        ) : null}

        {tab === 'everything' ? (
          visibleItems.length === 0 ? (
            <Text tone="secondary">
              {nothingShared ? 'You’re not sharing anything yet.' : 'Nothing matches your filters.'}
            </Text>
          ) : (
            <div className={styles.rows}>
              {visibleItems.map((item) => (
                <SharingItemRow
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  insights={insights}
                  availableTypes={availableTypes}
                  canEditAnswers={canEditAnswers}
                />
              ))}
            </div>
          )
        ) : null}

        {tab === 'reflections' ? (
          partners.length === 0 ? (
            <Card>
              <Text tone="secondary">
                Add a partner in People, and relationship insights about the two of you will appear
                here.
              </Text>
            </Card>
          ) : (
            <Stack gap={3}>
              <Text size="sm" tone="tertiary">
                Insight about you and your partners — drawn from what they share, shown as insight,
                never their raw answers.
              </Text>
              {partners.map((p) => (
                <RelationshipInsightsCard
                  key={p.id}
                  partnerId={p.id}
                  partnerName={p.name}
                  canManageAi={canManageAi}
                />
              ))}
            </Stack>
          )
        ) : null}
      </section>

      <CrisisFooter />
    </div>
  );
}
