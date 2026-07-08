import { useEffect, useMemo, useState } from 'react';
import type { Relationship } from '@shared/schemas';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { RelationshipInsightsCard } from './RelationshipInsightsCard';
import { SharingSection } from './SharingSection';
import styles from './SharingAndRelationships.module.css';

/**
 * "Sharing & relationships" (`/sharing`, 57-memory-overview-redesign §3.8) — the home for the two surfaces
 * relocated out of Memory so Memory stays purely "what SelfOS knows about you." Two complementary sections:
 *
 * - **Relationship reflections** — per-partner AI observations about the viewer + the dynamic (54 §3.3). The
 *   partner's shared data is NEVER shown raw; only the synthesis about YOU. Explicit-tap to generate/refresh.
 * - **What you share** — the outbound-sharing transparency + control surface (44 §3.5): every item you share,
 *   its scope, who receives it, editable in place.
 *
 * Reuses `RelationshipInsightsCard` + the `relationships:synthesize`/`:getSynthesis` IPC and `SharingSection`
 * + `memory:outboundSharing` unchanged — this is a relocation, not a redesign. Gated `memory.own`; per-person.
 */
export function SharingAndRelationships(): JSX.Element {
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const [relationships, setRelationships] = useState<Relationship[]>([]);

  useEffect(() => {
    void loadPeople();
    void window.selfos?.relationshipsList?.().then((rels) => setRelationships(rels ?? []));
  }, [loadPeople]);

  // The viewer's PARTNER relationships (the `partner` edge is symmetric) → one relationship-insight card each.
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

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <Heading level={2}>Sharing &amp; relationships</Heading>
        <Text tone="secondary">
          Reflections on your relationships, and control over everything you choose to share.
        </Text>
      </Stack>

      <section className={styles.section} aria-label="Relationship reflections">
        <Heading level={3}>Relationship reflections</Heading>
        <Text size="sm" tone="tertiary">
          Insight about you and your partners — drawn from what they share, shown as insight, never
          their raw answers.
        </Text>
        {partners.length === 0 ? (
          <Card>
            <Text tone="secondary">
              Add a partner in People, and relationship insights about the two of you will appear
              here.
            </Text>
          </Card>
        ) : (
          <Stack gap={3}>
            {partners.map((p) => (
              <RelationshipInsightsCard
                key={p.id}
                partnerId={p.id}
                partnerName={p.name}
                canManageAi={canManageAi}
              />
            ))}
          </Stack>
        )}
      </section>

      <SharingSection />

      <CrisisFooter />
    </div>
  );
}
