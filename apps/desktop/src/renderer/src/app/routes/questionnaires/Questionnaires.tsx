import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Inbox as InboxIcon, Plus, Send, Sparkles } from 'lucide-react';
import { validateQuestionnaire } from '@selfos/core/questionnaires';
import type { Recipient } from '@shared/schemas';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useInboxStore } from '../../../stores/inboxStore';
import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
} from '../../../design-system/components';
import { InboxAnswer } from '../inbox/InboxAnswer';
import { QuestionnaireBuilder, type BuilderSeed } from './QuestionnaireBuilder';
import { NewQuestionnaireStart } from './NewQuestionnaireStart';
import { SuggestedPanel } from './SuggestedPanel';
import { SentCard } from './SentCard';
import { ReceivedCard } from './ReceivedCard';
import styles from './Questionnaires.module.css';

type Selection =
  | { mode: 'none' }
  // Step 1 of creating: choose the recipient / compatibility BEFORE authoring (08 §17.3).
  | { mode: 'start'; seed?: BuilderSeed }
  | {
      mode: 'new';
      seed?: BuilderSeed;
      recipient?: Recipient;
      compat: boolean;
      // Set when this builder was opened from a saved suggestion (08 §18.4): on first save we remove that
      // suggestion so a created idea stops being offered (opening-then-cancelling keeps it).
      fromSuggestion?: { recipientPersonId: string; suggestionId: string };
    }
  | { mode: 'edit'; id: string; share?: boolean; view?: 'results' }
  | { mode: 'suggested' }
  // A received card opens the shared answering pane (08 §3.3) — the Inbox content, mirrored here.
  | { mode: 'answer'; assignmentId: string };

/**
 * The Questionnaires landing (08-questionnaires §3.1/§3.3): two card sections — "Sent" (questionnaires the
 * active person authored, with per-recipient answered status) and "Received" (questionnaires sent to them,
 * mirroring the Inbox). Opening a card drops into a full-width detail view (builder or answering pane).
 */
export function Questionnaires(): JSX.Element {
  const questionnaires = useQuestionnaireStore((s) => s.questionnaires);
  const sendStates = useQuestionnaireStore((s) => s.sendStates);
  const sentOverview = useQuestionnaireStore((s) => s.sentOverview);
  const loaded = useQuestionnaireStore((s) => s.loaded);
  const load = useQuestionnaireStore((s) => s.load);
  const remove = useQuestionnaireStore((s) => s.remove);
  const setFavorite = useQuestionnaireStore((s) => s.setFavorite);
  const loadTypes = useQuestionnaireStore((s) => s.loadTypes);
  const deleteSuggestion = useQuestionnaireStore((s) => s.deleteSuggestion);

  const inboxItems = useInboxStore((s) => s.items);
  const loadInbox = useInboxStore((s) => s.load);

  // Favorited (pinned) questionnaires sort to the top (38 §13.8); the rest keep their existing order.
  // (Coerce to 0/1 — Number(undefined) is NaN, which would break the comparator.)
  const ordered = [...questionnaires].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

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

  // After a new questionnaire is saved from a suggestion, drop that suggestion (08 §18.4). Takes the optional
  // link so the call site needn't narrow it across the JSX closure boundary.
  const removeSuggestion = (from?: { recipientPersonId: string; suggestionId: string }): void => {
    if (!from) return;
    void deleteSuggestion(from.recipientPersonId, from.suggestionId);
  };

  // Return to the landing AND refresh both stores, so a card reflects what just happened in the detail view
  // (a send, an answer, an edit) — e.g. a self check-in you just answered flips its Sent card to "Answered".
  const closeDetail = useCallback((): void => {
    setSelection({ mode: 'none' });
    void load();
    void loadInbox();
  }, [load, loadInbox]);

  const onDeleteFromList = async (id: string): Promise<void> => {
    setConfirmDeleteId(null);
    setDeleteError(null);
    try {
      await remove(id);
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
    void loadInbox();
  }, [load, loadTypes, loadInbox]);

  // A `responses-arrived` notification deep-links to a questionnaire's Results (38 §3.1):
  // `/questionnaires?focus=<id>&view=results`. Applied via an effect (not just the initializer) so it works
  // even when the user is already on this screen — React Router updates `location.search` in place.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focusId = params.get('focus');
    if (!focusId) return;
    setSelection({
      mode: 'edit',
      id: focusId,
      ...(params.get('view') === 'results' ? { view: 'results' as const } : {}),
    });
  }, [location.search, location.key]);

  const selected =
    selection.mode === 'edit' ? (questionnaires.find((q) => q.id === selection.id) ?? null) : null;
  const detailOpen = selection.mode !== 'none';

  const hasSent = ordered.length > 0;
  // "Received" = questionnaires OTHERS sent you. A self check-in already shows under "Sent", so filter it out
  // here to avoid the same card appearing twice on one screen (08 §3.3). The standalone Inbox still lists it.
  const received = inboxItems.filter((i) => !i.fromSelf);
  const hasReceived = received.length > 0;

  return (
    <div className={styles.page} data-view={detailOpen ? 'detail' : 'list'}>
      {!detailOpen ? (
        <>
          <div className={styles.header}>
            <div>
              <Heading level={2}>Questionnaires</Heading>
              <Text tone="secondary">Ask the people in your life. See what’s come back.</Text>
            </div>
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

          {deleteError ? <Banner tone="warning">{deleteError}</Banner> : null}

          {loaded && !hasSent && !hasReceived ? (
            <Card>
              <Stack gap={2} align="center">
                <ClipboardList size={24} aria-hidden="true" />
                <Text tone="secondary">
                  No questionnaires yet. Use <strong>New</strong> above to create one and gather
                  honest input from the people in your life — or <strong>Suggested</strong> to let
                  the coach propose one worth sending.
                </Text>
              </Stack>
            </Card>
          ) : null}

          {hasSent ? (
            <section className={styles.section} aria-label="Sent questionnaires">
              <div className={styles.sectionHead}>
                <span className={styles.sectionIcon}>
                  <Send size={16} aria-hidden="true" />
                </span>
                <Heading level={3}>Sent</Heading>
                <span className={styles.sectionCount}>{ordered.length}</span>
                <span className={styles.sectionSub}>questionnaires you’ve asked</span>
              </div>

              {confirmDeleteId ? (
                <Banner tone="warning">
                  <Stack gap={2}>
                    <Text>
                      Delete “{questionnaires.find((q) => q.id === confirmDeleteId)?.title}”?{' '}
                      {sendStates[confirmDeleteId]
                        ? 'It removes the questionnaire, any responses, and insights drawn from them.'
                        : 'This can’t be undone.'}
                    </Text>
                    <Inline gap={2}>
                      <Button
                        variant="primary"
                        onClick={() => void onDeleteFromList(confirmDeleteId)}
                      >
                        Delete
                      </Button>
                      <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </Button>
                    </Inline>
                  </Stack>
                </Banner>
              ) : null}

              <div className={styles.grid}>
                {ordered.map((q) => {
                  const sent = sendStates[q.id];
                  // An unsent definition that isn't valid-to-send is a Draft (38 §3.4). `validateQuestionnaire`
                  // is pure (no IPC).
                  const isDraft = !sent && validateQuestionnaire(q).length > 0;
                  return (
                    <SentCard
                      key={q.id}
                      questionnaire={q}
                      {...(sentOverview[q.id] ? { overview: sentOverview[q.id] } : {})}
                      {...(sent ? { sendState: sent } : {})}
                      isDraft={isDraft}
                      onOpen={() => setSelection({ mode: 'edit', id: q.id })}
                      onToggleFavorite={() => void setFavorite(q.id, !q.favorite)}
                      {...(sent
                        ? { onShare: () => setSelection({ mode: 'edit', id: q.id, share: true }) }
                        : {})}
                      onDelete={() => setConfirmDeleteId(q.id)}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}

          {hasReceived ? (
            <section className={styles.section} aria-label="Received questionnaires">
              <div className={styles.sectionHead}>
                <span className={styles.sectionIcon}>
                  <InboxIcon size={16} aria-hidden="true" />
                </span>
                <Heading level={3}>Received</Heading>
                <span className={styles.sectionCount}>{received.length}</span>
                <span className={styles.sectionSub}>questionnaires people sent you</span>
              </div>
              <div className={styles.grid}>
                {received.map((item) => (
                  <ReceivedCard
                    key={item.assignmentId}
                    item={item}
                    onOpen={() => setSelection({ mode: 'answer', assignmentId: item.assignmentId })}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <div className={styles.detail}>
          <button type="button" className={styles.back} onClick={closeDetail}>
            <ArrowLeft size={16} aria-hidden="true" />
            Questionnaires
          </button>
          {selection.mode === 'suggested' ? (
            // Recipient-first (08 §18): the suggestion already knows who it's for, so go straight to the
            // builder bound to that person (no re-asking) and remember the suggestion to remove on save.
            <SuggestedPanel
              onCreate={(create) =>
                setSelection({
                  mode: 'new',
                  seed: create.seed,
                  recipient: { kind: 'person', personId: create.recipientPersonId },
                  compat: false,
                  fromSuggestion: {
                    recipientPersonId: create.recipientPersonId,
                    suggestionId: create.suggestionId,
                  },
                })
              }
            />
          ) : selection.mode === 'start' ? (
            <NewQuestionnaireStart
              onCancel={closeDetail}
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
              {...(selection.fromSuggestion
                ? { onCreated: () => removeSuggestion(selection.fromSuggestion) }
                : {})}
              onDuplicate={(seed) => setSelection({ mode: 'start', seed })}
              onDone={closeDetail}
            />
          ) : selection.mode === 'answer' ? (
            <InboxAnswer
              key={selection.assignmentId}
              assignmentId={selection.assignmentId}
              onDone={closeDetail}
            />
          ) : selected ? (
            <QuestionnaireBuilder
              key={selected.id}
              questionnaire={selected}
              {...(selection.mode === 'edit' && selection.share ? { initialShare: true } : {})}
              {...(selection.mode === 'edit' && selection.view === 'results'
                ? { initialView: 'results' as const }
                : {})}
              onDuplicate={(seed) => setSelection({ mode: 'start', seed })}
              onDone={closeDetail}
            />
          ) : (
            <div className={styles.empty}>
              <Text tone="tertiary">Select a questionnaire, or create a new one.</Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
