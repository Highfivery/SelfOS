import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Plus, Sparkles } from 'lucide-react';
import type { Recipient } from '@shared/schemas';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
} from '../../../design-system/components';
import { QuestionnaireBuilder, type BuilderSeed } from './QuestionnaireBuilder';
import { QuestionnaireRowMenu } from './QuestionnaireRowMenu';
import { NewQuestionnaireStart } from './NewQuestionnaireStart';
import { SuggestedPanel } from './SuggestedPanel';
import { formatSentDate, resendStatus } from './sentState';
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
  const sendStates = useQuestionnaireStore((s) => s.sendStates);
  const loaded = useQuestionnaireStore((s) => s.loaded);
  const load = useQuestionnaireStore((s) => s.load);
  const remove = useQuestionnaireStore((s) => s.remove);
  const loadTypes = useQuestionnaireStore((s) => s.loadTypes);
  // Home's "Suggested next steps" card can hand off a gap-finder suggestion as a builder seed (17 §3.1).
  const location = useLocation();
  const handoffSeed = (location.state as { seed?: BuilderSeed } | null)?.seed;
  const [selection, setSelection] = useState<Selection>(
    // A handed-off gap-finder suggestion still picks a recipient first (08 §17.3).
    handoffSeed ? { mode: 'start', seed: handoffSeed } : { mode: 'none' },
  );
  // List-row deletion (08 §3.9): confirm first (it removes any responses + insights), then delete. The
  // bridge re-enforces permission (Owner any stage; a non-owner creator only their own + unsent) and throws
  // otherwise — surfaced calmly here.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onDeleteFromList = async (id: string): Promise<void> => {
    setConfirmDeleteId(null);
    setDeleteError(null);
    try {
      await remove(id);
      // If the deleted one was open in the builder, return to the empty list view.
      setSelection((s) => (s.mode === 'edit' && s.id === id ? { mode: 'none' } : s));
    } catch {
      setDeleteError(
        'You don’t have permission to delete that one — it may have already been sent by someone else.',
      );
    }
  };

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
            {deleteError ? <Banner tone="warning">{deleteError}</Banner> : null}
            {questionnaires.map((q) => {
              const active = selection.mode === 'edit' && selection.id === q.id;
              const sent = sendStates[q.id];
              return (
                <Stack key={q.id} gap={1}>
                  <div className={active ? `${styles.row} ${styles.rowActive}` : styles.row}>
                    <button
                      type="button"
                      className={styles.rowOpen}
                      onClick={() => setSelection({ mode: 'edit', id: q.id })}
                    >
                      <span className={styles.rowName}>{q.title}</span>
                      <span className={styles.rowSub}>
                        <span>
                          {q.questions.length} {q.questions.length === 1 ? 'question' : 'questions'}
                        </span>
                        {sent ? (
                          <span className={styles.rowSent}>
                            · Sent {formatSentDate(sent.lastSentAt)}
                          </span>
                        ) : null}
                        {/* Once the re-send cooldown has elapsed, nudge that it's time to ask again. */}
                        {sent && resendStatus(sent.lastSentAt).ready ? (
                          <span className={styles.rowResend}>· Ready to re-send</span>
                        ) : null}
                      </span>
                    </button>
                    <QuestionnaireRowMenu
                      title={q.title}
                      onDelete={() => setConfirmDeleteId(q.id)}
                    />
                  </div>
                  {confirmDeleteId === q.id ? (
                    <Banner tone="warning">
                      <Stack gap={2}>
                        <Text>
                          Delete “{q.title}”?{' '}
                          {sent
                            ? 'It removes the questionnaire, any responses, and insights drawn from them.'
                            : 'This can’t be undone.'}
                        </Text>
                        <Inline gap={2}>
                          <Button variant="primary" onClick={() => void onDeleteFromList(q.id)}>
                            Delete
                          </Button>
                          <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
                            Cancel
                          </Button>
                        </Inline>
                      </Stack>
                    </Banner>
                  ) : null}
                </Stack>
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
            onDuplicate={(seed) => setSelection({ mode: 'start', seed })}
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
