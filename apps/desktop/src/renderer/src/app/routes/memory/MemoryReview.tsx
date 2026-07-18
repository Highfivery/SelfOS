import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { Insight, Relationship } from '@shared/schemas';
import { availableRelationshipTypesFor } from '../../availableRelationshipTypes';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { Heading, Stack, Text } from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { ReviewQueue } from './ReviewQueue';
import styles from './Memory.module.css';

/**
 * The dedicated "Review new insights" screen (65 §3.3, on 62 §4 / 39) — its OWN route (`/memory/review`), not
 * mixed into the busy Memory page, so reviewing is focused. Reached from the Memory "Needs you" banner + the
 * sidebar Memory count badge; returns to `/memory` when done / all caught up. Feeds the active person's draft
 * insights + the merge/duplicate proposals to a one-at-a-time `ReviewQueue` (which orders drafts newest-first,
 * then proposals). Deterministic reads (no AI spend); per-person (the AppShell resets the insight store on a
 * switch), and the queue is held until the store has `loaded`.
 */
export function MemoryReview(): JSX.Element {
  const navigate = useNavigate();
  const insights = useInsightStore((s) => s.insights);
  const loaded = useInsightStore((s) => s.loaded);
  const load = useInsightStore((s) => s.load);
  const proposals = useInsightStore((s) => s.proposals);
  const loadReconcileState = useInsightStore((s) => s.loadReconcileState);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);

  const [relationships, setRelationships] = useState<Relationship[]>([]);

  useEffect(() => {
    void load();
    void loadPeople();
    void loadReconcileState();
    void window.selfos?.relationshipsList?.().then((rels) => setRelationships(rels ?? []));
  }, [load, loadPeople, loadReconcileState]);

  const availableTypes = useMemo(
    () => availableRelationshipTypesFor(activePersonId, relationships),
    [activePersonId, relationships],
  );
  // The active person's partner's name (partner↔partner is symmetric) — names the review-queue sharing note.
  const partnerName = useMemo(() => {
    if (!activePersonId) return undefined;
    for (const edge of relationships) {
      if (edge.type !== 'partner') continue;
      if (edge.fromPersonId === activePersonId)
        return people.find((p) => p.id === edge.toPersonId)?.displayName;
      if (edge.toPersonId === activePersonId)
        return people.find((p) => p.id === edge.fromPersonId)?.displayName;
    }
    return undefined;
  }, [activePersonId, relationships, people]);

  // Only the person's OWN insights; a sent-questionnaire draft is ABOUT its recipient (#129).
  const drafts = insights.filter((i) => i.subjectPersonId === activePersonId && !i.approved);
  const aboutNameFor = (insight: Insight): string | undefined => {
    if (insight.source !== 'questionnaire') return undefined;
    const pid = insight.provenance.aboutPersonId;
    if (pid) return people.find((p) => p.id === pid)?.displayName ?? 'someone';
    return insight.provenance.aboutName;
  };

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <button type="button" className={styles.backLink} onClick={() => navigate('/memory')}>
          <ArrowLeft size={15} aria-hidden="true" /> Memory
        </button>
        <Heading level={2}>Review new insights</Heading>
        <Text tone="secondary">
          One at a time — keep what’s right (and choose who each can inform), edit it, or leave it
          out.
        </Text>
      </Stack>

      {/* Hold the queue until the store has loaded — otherwise a cold reload on this hash route flashes the
          empty "all caught up" state for a frame before the drafts arrive (mirrors Memory.tsx's `loaded` gate). */}
      {loaded ? (
        <ReviewQueue
          drafts={drafts}
          proposals={proposals}
          aboutNameFor={aboutNameFor}
          onClose={() => navigate('/memory')}
          {...(availableTypes ? { availableTypes } : {})}
          {...(partnerName ? { partnerName } : {})}
        />
      ) : null}

      <CrisisFooter />
    </div>
  );
}
