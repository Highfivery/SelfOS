import { useState } from 'react';
import { BookHeart, Check, Pencil, Trash2 } from 'lucide-react';
import type { DreamAnalysis, DreamAnalysisEdits } from '@shared/schemas';
import { Banner, Button, Heading, Stack, Text } from '../../../design-system/components';
import { DreamAnalysisEditor } from './DreamAnalysisEditor';
import styles from './Dreams.module.css';

interface DreamSynthesisCardProps {
  analysis: DreamAnalysis;
  memoryEnabled: boolean;
  approving: boolean;
  onSaveEdits: (edits: DreamAnalysisEdits) => void;
  onApprove: () => void;
  onRemoveFromContext: () => void;
}

/** One readable section of the analysis (pre-wrapped prose). */
function Section({
  title,
  note,
  body,
}: {
  title: string;
  note?: string;
  body: string;
}): JSX.Element {
  return (
    <div className={styles.section}>
      <Text weight={600}>{title}</Text>
      {note ? (
        <Text size="xs" tone="tertiary">
          {note}
        </Text>
      ) : null}
      <Text className={styles.sectionBody} tone="secondary">
        {body}
      </Text>
    </div>
  );
}

/**
 * The synthesized dream analysis (12-dreams §3.2/§3.3): a read-first card of the five sections, with an
 * Edit toggle and the approve→context lifecycle. If the analysis flags crisis, the card leads with
 * support resources; symbolic readings are framed as imaginative reflection, never fact (12 §8.1/§8.2).
 */
export function DreamSynthesisCard({
  analysis,
  memoryEnabled,
  approving,
  onSaveEdits,
  onApprove,
  onRemoveFromContext,
}: DreamSynthesisCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const approved = Boolean(analysis.insightId);

  if (editing) {
    return (
      <DreamAnalysisEditor
        analysis={analysis}
        onCancel={() => setEditing(false)}
        onSave={(edits) => {
          onSaveEdits(edits);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <Stack gap={4}>
      {analysis.crisisFlag ? (
        <Banner tone="warning">
          This dream touched on something heavy. If you’re struggling, you don’t have to carry it
          alone — use “Get help now” below, or reach out to someone you trust.
        </Banner>
      ) : analysis.distressSignal ? (
        <Banner tone="warning">
          This dream carried some distress. If dreams like this keep coming up, it can help to talk
          them through — with someone you trust, or a professional.
        </Banner>
      ) : null}

      <div className={styles.cardHead}>
        <Heading level={3}>Your dream analysis</Heading>
        {approved ? (
          <span className={styles.contextBadge}>
            <BookHeart size={14} aria-hidden="true" />
            In your coaching context
          </span>
        ) : null}
      </div>
      <Text size="xs" tone="tertiary">
        A reflection to explore — not medical advice, and not a fixed interpretation.
      </Text>

      <Section title="Summary" body={analysis.summary} />
      <Section title="Emotional landscape" body={analysis.emotionalLandscape} />
      <Section title="Possible waking-life connections" body={analysis.wakingLifeConnections} />
      <Section
        title="Notable images & symbols"
        note="Imaginative reflection, not fact — something to sit with."
        body={analysis.notableImages}
      />

      {analysis.reflectiveQuestions.length > 0 ? (
        <div className={styles.section}>
          <Text weight={600}>Questions to reflect on</Text>
          <ul className={styles.questionList}>
            {analysis.reflectiveQuestions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.coachingPrompt ? (
        <Section title="A gentle prompt" body={analysis.coachingPrompt} />
      ) : null}

      <div className={styles.cardActions}>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          <Pencil size={16} aria-hidden="true" />
          Edit
        </Button>
        {approved ? (
          <Button variant="secondary" onClick={onRemoveFromContext}>
            <Trash2 size={16} aria-hidden="true" />
            Remove from context
          </Button>
        ) : (
          <div className={styles.approveWrap}>
            <Button variant="primary" onClick={onApprove} disabled={!memoryEnabled || approving}>
              <Check size={16} aria-hidden="true" />
              Add to my coaching context
            </Button>
            {!memoryEnabled ? (
              <Text size="xs" tone="tertiary">
                Turn on Dream memory in Settings to add this.
              </Text>
            ) : null}
          </div>
        )}
      </div>
    </Stack>
  );
}
