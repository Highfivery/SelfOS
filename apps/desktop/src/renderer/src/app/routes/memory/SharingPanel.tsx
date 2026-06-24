import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Share2 } from 'lucide-react';
import type { OutboundSharingItem, Relationship } from '@shared/schemas';
import { describeScope, SHARING_INLINE_EXPLAINER } from '@selfos/core/sharing';
import { useInsightStore } from '../../../stores/insightStore';
import { useSessionStore } from '../../../stores/sessionStore';
import {
  Card,
  Heading,
  Markdown,
  RelationshipScopePicker,
  Stack,
  Text,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { FactSharingControl } from './FactSharingControl';
import { availableRelationshipTypesFor } from '../../availableRelationshipTypes';
import styles from './SharingPanel.module.css';

/**
 * "What you share & with whom" (44-memory-dashboard §3.5) — the one place to audit + control ALL outbound
 * sharing. Lists every item the active person shares (insight facts + intake answers, via
 * `memory:outboundSharing`), each with its scope, the concrete people currently receiving it, and a
 * `RelationshipScopePicker` to change scope or set Private. Own-scoped (the bridge gates the reads + writes).
 */
export function SharingPanel(): JSX.Element {
  const navigate = useNavigate();
  const outbound = useInsightStore((s) => s.outbound);
  const insights = useInsightStore((s) => s.insights);
  const loaded = useInsightStore((s) => s.loaded);
  const load = useInsightStore((s) => s.load);
  const setAnswerScope = useInsightStore((s) => s.setAnswerScope);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);

  const [relationships, setRelationships] = useState<Relationship[]>([]);

  useEffect(() => {
    void load();
    void window.selfos?.relationshipsList?.().then((rels) => setRelationships(rels ?? []));
  }, [load]);

  const availableTypes = useMemo(
    () => availableRelationshipTypesFor(activePersonId, relationships),
    [activePersonId, relationships],
  );

  // Resolve a fact item back to its parent insight (own insights are in the loaded list) so the per-fact
  // control can edit the right insight. Outbound never includes restricted facts (the read skips them).
  const factLocation = (
    factId: string,
  ): {
    insightId: string;
    subjectPersonId: string;
    source: (typeof insights)[number]['source'];
    fact: (typeof insights)[number]['facts'][number];
  } | null => {
    for (const insight of insights) {
      const fact = insight.facts.find((f) => f.id === factId);
      if (fact)
        return {
          insightId: insight.id,
          subjectPersonId: insight.subjectPersonId,
          source: insight.source,
          fact,
        };
    }
    return null;
  };

  const renderControl = (item: OutboundSharingItem): JSX.Element | null => {
    if (item.kind === 'fact') {
      const loc = factLocation(item.id);
      if (!loc) return null;
      // An onboarding-derived fact's scope is owned by its answer (43 §4) and recomputed on re-synthesis,
      // so editing it here would silently revert — show it read-only (the matching `intakeAnswer` item below
      // is the editable control). AI-inferred facts stay directly editable.
      if (loc.source === 'intake') {
        return (
          <Text size="xs" tone="tertiary">
            Set by your onboarding answer
          </Text>
        );
      }
      return (
        <FactSharingControl
          insightId={loc.insightId}
          subjectPersonId={loc.subjectPersonId}
          fact={loc.fact}
          {...(availableTypes ? { availableTypes } : {})}
        />
      );
    }
    // intakeAnswer — id is `<sectionId>.<questionId>`; split on the first '.'.
    const dot = item.id.indexOf('.');
    const sectionId = dot >= 0 ? item.id.slice(0, dot) : item.id;
    const questionId = dot >= 0 ? item.id.slice(dot + 1) : '';
    return (
      <RelationshipScopePicker
        value={item.types}
        label={item.text}
        {...(availableTypes ? { availableTypes } : {})}
        onChange={(types) => void setAnswerScope({ sectionId, questionId, types })}
      />
    );
  };

  return (
    <div className={styles.layout}>
      <button type="button" className={styles.back} onClick={() => navigate('/memory')}>
        <ArrowLeft size={15} aria-hidden="true" /> Memory
      </button>

      <Stack gap={2}>
        <Heading level={2}>What you share &amp; with whom</Heading>
        <Text tone="secondary">{SHARING_INLINE_EXPLAINER}</Text>
      </Stack>

      {loaded && outbound.items.length === 0 ? (
        <Card>
          <Stack gap={3} align="center">
            <Share2 size={24} aria-hidden="true" />
            <Text tone="secondary">
              You’re not sharing anything yet. When you choose to share a memory or an onboarding
              answer with someone you relate to, it shows up here — so you can always see and change
              exactly what flows where.
            </Text>
          </Stack>
        </Card>
      ) : null}

      <Stack gap={3}>
        {outbound.items.map((item) => {
          const scopeLabel = item.broadcast ? 'Everyone you relate to' : describeScope(item.types);
          const recipients = item.recipients.map((r) => r.displayName);
          return (
            <Card key={`${item.kind}:${item.id}`} className={styles.itemCard}>
              <div className={styles.itemHead}>
                <div className={styles.itemMain}>
                  <Text size="xs" tone="tertiary" className={styles.itemKind}>
                    {item.kind === 'fact' ? 'Memory' : 'Onboarding answer'}
                  </Text>
                  <Markdown inline size="sm">
                    {item.text}
                  </Markdown>
                </div>
                <div className={styles.itemControl}>{renderControl(item)}</div>
              </div>
              <Text size="xs" tone="tertiary">
                Shared with {scopeLabel} ·{' '}
                {recipients.length > 0
                  ? `reaching ${recipients.join(', ')}`
                  : 'no one in your circle yet'}
              </Text>
            </Card>
          );
        })}
      </Stack>

      <CrisisFooter />
    </div>
  );
}
