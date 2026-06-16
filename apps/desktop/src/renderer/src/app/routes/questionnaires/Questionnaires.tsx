import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Plus, Sparkles } from 'lucide-react';
import type { Recipient } from '@shared/schemas';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { QuestionnaireBuilder, type BuilderSeed } from './QuestionnaireBuilder';
import { NewQuestionnaireStart } from './NewQuestionnaireStart';
import { SuggestedPanel } from './SuggestedPanel';
import styles from './Questionnaires.module.css';

type Selection =
  | { mode: 'none' }
  // Step 1 of creating: choose the recipient / compatibility BEFORE authoring (08 §17.3).
  | { mode: 'start'; seed?: BuilderSeed }
  | { mode: 'new'; seed?: BuilderSeed; recipient?: Recipient; compat: boolean }
  | { mode: 'edit'; id: string }
  | { mode: 'suggested' };

/** Author questionnaires: a list of your definitions (left) with a builder pane (right). */
export function Questionnaires(): JSX.Element {
  const questionnaires = useQuestionnaireStore((s) => s.questionnaires);
  const loaded = useQuestionnaireStore((s) => s.loaded);
  const load = useQuestionnaireStore((s) => s.load);
  const loadTypes = useQuestionnaireStore((s) => s.loadTypes);
  // Home's "Suggested next steps" card can hand off a gap-finder suggestion as a builder seed (17 §3.1).
  const location = useLocation();
  const handoffSeed = (location.state as { seed?: BuilderSeed } | null)?.seed;
  const [selection, setSelection] = useState<Selection>(
    // A handed-off gap-finder suggestion still picks a recipient first (08 §17.3).
    handoffSeed ? { mode: 'start', seed: handoffSeed } : { mode: 'none' },
  );

  useEffect(() => {
    void load();
    void loadTypes();
  }, [load, loadTypes]);

  const selected =
    selection.mode === 'edit' ? (questionnaires.find((q) => q.id === selection.id) ?? null) : null;
  const detailOpen = selection.mode !== 'none';

  return (
    <div className={styles.layout} data-view={detailOpen ? 'detail' : 'list'}>
      <section className={styles.list} aria-label="Questionnaires">
        <div className={styles.header}>
          <Heading level={2}>Questionnaires</Heading>
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={() => setSelection({ mode: 'suggested' })}>
              <Sparkles size={16} aria-hidden="true" />
              Suggested
            </Button>
            <Button variant="primary" onClick={() => setSelection({ mode: 'start' })}>
              <Plus size={16} aria-hidden="true" />
              New
            </Button>
          </div>
        </div>

        {loaded && questionnaires.length === 0 ? (
          <Card>
            <Stack gap={2} align="center">
              <ClipboardList size={24} aria-hidden="true" />
              <Text tone="secondary">
                No questionnaires yet. Create one to gather honest input from the people in your
                life.
              </Text>
            </Stack>
          </Card>
        ) : (
          <Stack gap={2}>
            {questionnaires.map((q) => {
              const active = selection.mode === 'edit' && selection.id === q.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  className={active ? `${styles.row} ${styles.rowActive}` : styles.row}
                  onClick={() => setSelection({ mode: 'edit', id: q.id })}
                >
                  <span className={styles.rowName}>{q.title}</span>
                  <span className={styles.rowBadge}>
                    {q.questions.length} {q.questions.length === 1 ? 'question' : 'questions'}
                  </span>
                </button>
              );
            })}
          </Stack>
        )}
      </section>

      <section className={styles.detail}>
        <button
          type="button"
          className={styles.back}
          onClick={() => setSelection({ mode: 'none' })}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Questionnaires
        </button>
        {selection.mode === 'suggested' ? (
          <SuggestedPanel onCreate={(seed) => setSelection({ mode: 'start', seed })} />
        ) : selection.mode === 'start' ? (
          <NewQuestionnaireStart
            onCancel={() => setSelection({ mode: 'none' })}
            onChosen={(choice) =>
              setSelection({
                mode: 'new',
                ...(selection.seed ? { seed: selection.seed } : {}),
                ...(choice.recipient ? { recipient: choice.recipient } : {}),
                compat: choice.compat,
              })
            }
          />
        ) : selection.mode === 'new' ? (
          <QuestionnaireBuilder
            key={selection.seed ? 'new-seeded' : 'new'}
            questionnaire={null}
            compat={selection.compat}
            {...(selection.recipient ? { initialRecipient: selection.recipient } : {})}
            {...(selection.seed ? { seed: selection.seed } : {})}
            onDone={() => setSelection({ mode: 'none' })}
          />
        ) : selected ? (
          <QuestionnaireBuilder
            key={selected.id}
            questionnaire={selected}
            onDuplicate={(seed) => setSelection({ mode: 'start', seed })}
            onDone={() => setSelection({ mode: 'none' })}
          />
        ) : (
          <div className={styles.empty}>
            <Text tone="tertiary">Select a questionnaire, or create a new one.</Text>
          </div>
        )}
      </section>
    </div>
  );
}
