import { useState } from 'react';
import type { DreamAnalysis, DreamAnalysisEdits } from '@shared/schemas';
import { Button, Field, Stack, Textarea } from '../../../design-system/components';
import styles from './Dreams.module.css';

interface DreamAnalysisEditorProps {
  analysis: DreamAnalysis;
  onCancel: () => void;
  onSave: (edits: DreamAnalysisEdits) => void;
}

/**
 * Edit the readable sections of a synthesized analysis before (or after) approval (12-dreams §3.2).
 * Mounted fresh each time the card enters edit mode, so its fields seed from the current analysis. The
 * AI-owned structured tags/metrics/flags aren't editable here — only the human-readable prose.
 */
export function DreamAnalysisEditor({
  analysis,
  onCancel,
  onSave,
}: DreamAnalysisEditorProps): JSX.Element {
  const [summary, setSummary] = useState(analysis.summary);
  const [emotionalLandscape, setEmotionalLandscape] = useState(analysis.emotionalLandscape);
  const [wakingLifeConnections, setWakingLifeConnections] = useState(
    analysis.wakingLifeConnections,
  );
  const [notableImages, setNotableImages] = useState(analysis.notableImages);
  const [questions, setQuestions] = useState(analysis.reflectiveQuestions.join('\n'));
  const [coachingPrompt, setCoachingPrompt] = useState(analysis.coachingPrompt ?? '');

  const save = (): void => {
    onSave({
      summary,
      emotionalLandscape,
      wakingLifeConnections,
      notableImages,
      reflectiveQuestions: questions
        .split('\n')
        .map((q) => q.trim())
        .filter(Boolean),
      coachingPrompt,
    });
  };

  return (
    <Stack gap={4}>
      <Field label="Summary">
        {(p) => (
          <Textarea {...p} value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
        )}
      </Field>
      <Field label="Emotional landscape">
        {(p) => (
          <Textarea
            {...p}
            value={emotionalLandscape}
            onChange={(e) => setEmotionalLandscape(e.target.value)}
            rows={3}
          />
        )}
      </Field>
      <Field label="Possible waking-life connections">
        {(p) => (
          <Textarea
            {...p}
            value={wakingLifeConnections}
            onChange={(e) => setWakingLifeConnections(e.target.value)}
            rows={3}
          />
        )}
      </Field>
      <Field label="Notable images & symbols" help="Imaginative reflection, not fact.">
        {(p) => (
          <Textarea
            {...p}
            value={notableImages}
            onChange={(e) => setNotableImages(e.target.value)}
            rows={3}
          />
        )}
      </Field>
      <Field label="Questions to reflect on" help="One per line.">
        {(p) => (
          <Textarea
            {...p}
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            rows={3}
          />
        )}
      </Field>
      <Field label="A gentle prompt">
        {(p) => (
          <Textarea
            {...p}
            value={coachingPrompt}
            onChange={(e) => setCoachingPrompt(e.target.value)}
            rows={2}
          />
        )}
      </Field>

      <div className={styles.cardActions}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>
          Save changes
        </Button>
      </div>
    </Stack>
  );
}
