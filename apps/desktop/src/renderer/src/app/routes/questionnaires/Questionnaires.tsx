import { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, Plus } from 'lucide-react';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { QuestionnaireBuilder } from './QuestionnaireBuilder';
import styles from './Questionnaires.module.css';

type Selection = { mode: 'none' } | { mode: 'new' } | { mode: 'edit'; id: string };

/** Author questionnaires: a list of your definitions (left) with a builder pane (right). */
export function Questionnaires(): JSX.Element {
  const questionnaires = useQuestionnaireStore((s) => s.questionnaires);
  const loaded = useQuestionnaireStore((s) => s.loaded);
  const load = useQuestionnaireStore((s) => s.load);
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });

  useEffect(() => {
    void load();
  }, [load]);

  const selected =
    selection.mode === 'edit' ? (questionnaires.find((q) => q.id === selection.id) ?? null) : null;
  const detailOpen = selection.mode !== 'none';

  return (
    <div className={styles.layout} data-view={detailOpen ? 'detail' : 'list'}>
      <section className={styles.list} aria-label="Questionnaires">
        <div className={styles.header}>
          <Heading level={2}>Questionnaires</Heading>
          <Button variant="primary" onClick={() => setSelection({ mode: 'new' })}>
            <Plus size={16} aria-hidden="true" />
            New
          </Button>
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
        {selection.mode === 'new' ? (
          <QuestionnaireBuilder
            key="new"
            questionnaire={null}
            onDone={() => setSelection({ mode: 'none' })}
          />
        ) : selected ? (
          <QuestionnaireBuilder
            key={selected.id}
            questionnaire={selected}
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
