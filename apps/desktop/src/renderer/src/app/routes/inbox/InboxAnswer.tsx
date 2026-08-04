import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import {
  compatibilityDisclosure,
  externalSendDisclosure,
  formatAnswerForDisplay,
  unansweredRequired,
  visibleAnswers,
  visibleQuestions,
} from '@selfos/core/questionnaires';
import type { AnswerMap, AnswerValue } from '@selfos/core/questionnaires';
import type {
  Answer,
  FactCorrectionOutcome,
  InboxAssignmentDetail,
  SendAnswer,
} from '@shared/channels';
import type { InboxCompatibilityView, Question } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Heading,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import { useInboxStore } from '../../../stores/inboxStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { QuestionnaireForm } from '@selfos/answering';
import { AlignmentReportView, AnswerList } from '../questionnaires/AlignmentReportView';
import styles from './Inbox.module.css';

/** Decrypt an attached image for display; null (e.g. without `questionnaires.create`) renders alt text. */
const loadImage = (imagePath: string): Promise<string | null> =>
  window.selfos?.questionnairesGetImage(imagePath) ?? Promise.resolve(null);

/** Map saved answers (Answer[]) into the form's keyed AnswerMap, and back for persistence. */
const toAnswerMap = (answers: Answer[]): AnswerMap =>
  Object.fromEntries(answers.map((a) => [a.questionId, a.value]));

// Only currently-VISIBLE questions are persisted (47 §3.3/§7): a follow-up whose branch trigger was later
// cleared/changed hides in the form, but its answer lingers in `map` — submitting it would have the analysis
// treat it as chosen. `visibleAnswers` drops those orphans, matching the relay answering page exactly.
const toAnswerList = (questions: Question[], map: AnswerMap): Answer[] => {
  const visible = visibleAnswers(questions, map);
  const out: Answer[] = [];
  for (const q of questions) {
    const value = visible[q.id];
    if (value !== undefined) out.push({ questionId: q.id, value });
  }
  return out;
};

/**
 * The recipient's answering pane for one Inbox assignment (08-questionnaires §3.3). Shows who's asking
 * + the privacy mode, renders the shared answering form (save/resume), and offers Submit or Decline
 * (silently or with a short note). Once submitted, it becomes a read-only **review** of their answers with
 * an **Edit answers** affordance to update + resend (56-answer-review-edit §3.1) — except a compatibility
 * send, which stays a joint-report view. A declined send stays locked.
 */
export function InboxAnswer({
  assignmentId,
  onDone,
}: {
  assignmentId: string;
  onDone: () => void;
}): JSX.Element {
  const getDetail = useInboxStore((s) => s.getDetail);
  const open = useInboxStore((s) => s.open);
  const saveProgress = useInboxStore((s) => s.saveProgress);
  const reopen = useInboxStore((s) => s.reopen);
  const submit = useInboxStore((s) => s.submit);
  const decline = useInboxStore((s) => s.decline);
  const dismiss = useInboxStore((s) => s.dismiss);

  const [detail, setDetail] = useState<InboxAssignmentDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineNote, setDeclineNote] = useState('');
  // Remove-from-Inbox (#350): a self check-in is deleted outright, a send from someone else is dismissed
  // (their copy stays). Two-step inline confirm so a tap can't lose it by accident.
  const [removing, setRemoving] = useState(false);
  // 56 §3.1 — editing a previously-submitted send: the review is shown until the recipient taps "Edit answers",
  // which flips this on and renders the (pre-filled) form. Reopening the assignment is deferred to the update
  // submit, so Cancel is a true no-op (the send stays submitted).
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  // Wrong-fact correction (spec 08 wrong-fact amendment): the question the recipient is flagging + its
  // reworded prompts (applied to their LOCAL view) + the resolved outcome. Reworded prompts never change the
  // sender's stored question — the recipient just answers the corrected version. The panel renders INLINE
  // (below the greyed question) via the wizard's `wrongFact.renderPanel` — never a banner above the questions.
  const [wrongFactQ, setWrongFactQ] = useState<Question | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionOutcome, setCorrectionOutcome] = useState<FactCorrectionOutcome | null>(null);
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({});

  const runCorrection = async (): Promise<void> => {
    if (!wrongFactQ || !correctionText.trim()) return;
    setCorrectionBusy(true);
    try {
      const result = await window.selfos?.assignmentsCorrectFact({
        assignmentId,
        questionId: wrongFactQ.id,
        questionPrompt: promptOverrides[wrongFactQ.id] ?? wrongFactQ.prompt,
        correction: correctionText.trim(),
      });
      if (result?.ok && result.rewrittenPrompt) {
        // Apply the reworded prompt to the recipient's LOCAL view + show the success outcome in place (the
        // question stays greyed until they close the panel). The sender's stored question is unchanged.
        setPromptOverrides((m) => ({ ...m, [wrongFactQ.id]: result.rewrittenPrompt! }));
        setCorrectionOutcome(result);
        setCorrectionText('');
      } else {
        setCorrectionOutcome(
          result ?? { ok: false, message: 'Couldn’t process that correction — please try again.' },
        );
      }
    } finally {
      setCorrectionBusy(false);
    }
  };

  // The inline wrong-fact panel body the wizard renders below the greyed question — the input (with an
  // optional error), OR the resolved success outcome. `close` dismisses the panel + un-greys the question.
  const renderWrongFactPanel = (close: () => void): JSX.Element => {
    const dismiss = (): void => {
      setCorrectionOutcome(null);
      close();
    };
    if (correctionOutcome?.ok) {
      return (
        <Banner tone="info">
          <Stack gap={2}>
            <Text size="sm">
              {correctionOutcome.insightFlagged
                ? 'Fixed — I flagged that in your Memory so it won’t come back, and reworded this question.'
                : 'Reworded this question so you can answer it.'}
            </Text>
            {correctionOutcome.source === 'profile' ? (
              <Button variant="secondary" onClick={() => navigate('/people')}>
                Update it in your profile
              </Button>
            ) : correctionOutcome.source === 'onboarding' ? (
              <Button variant="secondary" onClick={() => navigate('/onboarding')}>
                Update it in your onboarding
              </Button>
            ) : correctionOutcome.source === 'unknown' ? (
              <div className={styles.correctionActions}>
                <Text size="sm" tone="secondary">
                  Where does this come from?
                </Text>
                <Button variant="secondary" onClick={() => navigate('/people')}>
                  Profile
                </Button>
                <Button variant="secondary" onClick={() => navigate('/onboarding')}>
                  Onboarding
                </Button>
                <Button variant="secondary" onClick={() => navigate('/memory')}>
                  Memory
                </Button>
              </div>
            ) : null}
            <div>
              <Button variant="primary" onClick={dismiss}>
                Answer the reworded question
              </Button>
            </div>
          </Stack>
        </Banner>
      );
    }
    return (
      <Banner tone={correctionOutcome ? 'warning' : 'info'}>
        <Stack gap={2}>
          <Text weight={600}>What’s not right about this question?</Text>
          <Text size="sm" tone="secondary">
            e.g. “I turned 41 last May, not 39.” I’ll correct where this came from and reword the
            question so you can answer it.
          </Text>
          {/* Focus moves into the panel on open (the panel subtree mounts when the wizard opens it), so a
              keyboard/SR user lands on the correction input rather than back at the top of the page. */}
          <Textarea
            autoFocus
            rows={2}
            value={correctionText}
            placeholder="Say what’s wrong…"
            onChange={(e) => setCorrectionText(e.target.value)}
            aria-label="What’s wrong about this question"
          />
          {correctionOutcome && !correctionOutcome.ok ? (
            <Text size="sm">
              {correctionOutcome.message ?? 'Couldn’t process that correction — please try again.'}
            </Text>
          ) : null}
          <div className={styles.correctionActions}>
            <Button
              variant="primary"
              onClick={() => void runCorrection()}
              disabled={correctionBusy || correctionText.trim() === ''}
            >
              {correctionBusy ? 'Fixing…' : 'Fix it'}
            </Button>
            <Button variant="secondary" onClick={dismiss} disabled={correctionBusy}>
              Never mind
            </Button>
          </div>
        </Stack>
      </Banner>
    );
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      const loaded = await getDetail(assignmentId);
      if (!active) return;
      if (!loaded) {
        setMissing(true);
        return;
      }
      setDetail(loaded);
      setAnswers(toAnswerMap(loaded.answers));
      if (loaded.answerable && loaded.status === 'sent') void open(assignmentId);
    })();
    return () => {
      active = false;
    };
  }, [assignmentId, getDetail, open]);

  if (missing) {
    return (
      <Stack gap={3}>
        <Banner tone="warning">This questionnaire is no longer available.</Banner>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onDone}>
            Back to Inbox
          </Button>
        </div>
        <CrisisFooter />
      </Stack>
    );
  }
  if (!detail) {
    return <Text tone="tertiary">Loading…</Text>;
  }

  const asker = detail.senderName ?? 'Someone';
  // The disclosure is DERIVED from the send (compatibility visibility, else privacy mode), so the promise
  // shown to the recipient always matches what the system delivers (§3.2/§8.4) — one shared source
  // (`disclosure.ts`) for the answering pane, the relay page, and the landing card privacy chips.
  const disclosure = ((): string => {
    if (detail.compatibility)
      return compatibilityDisclosure(detail.compatibility.visibility, {
        otherParticipantName: detail.compatibility.otherParticipantName,
        senderName: asker,
        viewerIsSender: detail.compatibility.viewerIsSender,
      });
    return externalSendDisclosure(asker, detail.privacy);
  })();

  const onRemove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await dismiss(assignmentId);
      onDone();
    } catch {
      setError('Could not remove this from your Inbox. Please try again.');
      setBusy(false);
    }
  };

  // The remove/delete affordance (#350) — reachable in both the answering view and the locked review. A
  // self check-in is deleted for good; a send from someone else is removed from this Inbox only.
  const removeBlock = removing ? (
    <Banner tone="warning">
      <Stack gap={2}>
        <Text size="sm">
          {detail.fromSelf
            ? 'Delete this check-in? This removes it for good.'
            : `Remove this from your Inbox? ${asker} keeps their copy.`}
        </Text>
        <div className={styles.footer}>
          <Button variant="danger" onClick={() => void onRemove()} disabled={busy}>
            {detail.fromSelf ? 'Delete' : 'Remove'}
          </Button>
          <Button variant="secondary" onClick={() => setRemoving(false)} disabled={busy}>
            Keep it
          </Button>
        </div>
      </Stack>
    </Banner>
  ) : (
    <div>
      <Button variant="ghost" size="sm" onClick={() => setRemoving(true)}>
        {detail.fromSelf ? 'Delete this check-in' : 'Remove from my Inbox'}
      </Button>
    </div>
  );

  const onChange = (id: string, value: AnswerValue): void => {
    setSaved(false);
    setError(null);
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const onSave = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await saveProgress(assignmentId, toAnswerList(detail.questionnaire.questions, answers));
      setSaved(true);
    } catch {
      setError('Could not save your progress. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (): Promise<void> => {
    const unanswered = unansweredRequired(detail.questionnaire.questions, answers);
    if (unanswered.length > 0) {
      setError(
        `Answer the ${unanswered.length} required question${
          unanswered.length === 1 ? '' : 's'
        } to submit.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submit(assignmentId, toAnswerList(detail.questionnaire.questions, answers));
      onDone();
    } catch {
      setError('Could not submit your answers. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Resubmit edited answers (56 §3.1): re-open the submitted send, then submit — the revision bump tells the
  // sender their analysis is now stale. Validates required questions like a first submit.
  const onUpdate = async (): Promise<void> => {
    const unanswered = unansweredRequired(detail.questionnaire.questions, answers);
    if (unanswered.length > 0) {
      setError(
        `Answer the ${unanswered.length} required question${
          unanswered.length === 1 ? '' : 's'
        } to resend.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reopen(assignmentId);
      await submit(assignmentId, toAnswerList(detail.questionnaire.questions, answers));
      onDone();
    } catch {
      setError('Could not update your answers. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await decline(assignmentId, declineNote);
      onDone();
    } catch {
      setError('Could not decline. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Submitted/declined and NOT re-editing → review (56 §3.1): a recipient can now see + edit their own
  // answers, EXCEPT a compatibility send (its joint report + dual-answer alignment stays as-is, §3.6).
  const submitted = detail.status === 'submitted' || detail.status === 'analyzed';
  const canEdit = submitted && !detail.compatibility;
  if (!detail.answerable && !editing) {
    const review: SendAnswer[] = visibleQuestions(detail.questionnaire.questions, answers).map(
      (q) => ({ prompt: q.prompt, answer: formatAnswerForDisplay(q, answers[q.id]) }),
    );
    return (
      <Stack gap={3}>
        <Heading level={3}>{detail.questionnaire.title}</Heading>
        <Banner tone="info">
          {detail.status === 'declined'
            ? 'You declined this questionnaire.'
            : 'You’ve submitted this questionnaire. Thanks for filling it out.'}
        </Banner>
        {detail.status !== 'declined' && detail.compatibility ? (
          <JointReport compatibility={detail.compatibility} asker={asker} />
        ) : null}
        {canEdit ? (
          <Card>
            <Stack gap={3}>
              <Heading level={3}>Your answers</Heading>
              <AnswerList answers={review} />
              <Text size="sm" tone="secondary">
                You can update your answers and resend — {asker} will be able to review the update.
              </Text>
              <div>
                <Button variant="primary" onClick={() => setEditing(true)}>
                  Edit answers
                </Button>
              </div>
            </Stack>
          </Card>
        ) : null}
        {error ? <Banner tone="warning">{error}</Banner> : null}
        {removeBlock}
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onDone}>
            Back to Inbox
          </Button>
        </div>
        <CrisisFooter />
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <Heading level={3}>{detail.questionnaire.title}</Heading>
        <div className={styles.askMeta}>
          <span>From {asker}</span>
          <span aria-hidden="true">·</span>
          <span>
            {detail.privacy === 'private' || detail.compatibility ? (
              <Lock size={12} aria-hidden="true" className={styles.privacyIcon} />
            ) : null}
            {disclosure}
          </span>
        </div>
      </Stack>

      {declining ? (
        <div className={styles.declineForm}>
          <Banner tone="info">
            You can decline silently, or leave {asker} a short note. Either way, no answers are
            sent.
          </Banner>
          <Textarea
            value={declineNote}
            aria-label="Decline note (optional)"
            placeholder="Optional note…"
            rows={3}
            onChange={(event) => setDeclineNote(event.target.value)}
          />
          {error ? <Banner tone="warning">{error}</Banner> : null}
          <div className={styles.footer}>
            <Button variant="primary" onClick={() => void onDecline()} disabled={busy}>
              Decline
            </Button>
            <Button variant="secondary" onClick={() => setDeclining(false)} disabled={busy}>
              Back
            </Button>
          </div>
          <CrisisFooter />
        </div>
      ) : (
        <>
          {removeBlock}
          {saved ? <Banner tone="info">Saved — you can come back and finish later.</Banner> : null}
          {error ? <Banner tone="warning">{error}</Banner> : null}

          {/* One question at a time (08 §21.3): the shared wizard owns Back/Next + the action bar; the
              host supplies the terminal callbacks. Editing → Update answers + Cancel (no Save for later);
              a fresh answer → Submit + Save for later + Decline. Prompt overrides apply the reworded text
              from a wrong-fact correction to the recipient's local view (the sender's question is unchanged).
              The "That's not right about me" correction panel renders INLINE below the greyed question (the
              wizard owns placement; `onOpen` resets our input/outcome, `renderPanel` supplies the body). */}
          <QuestionnaireForm
            questions={detail.questionnaire.questions.map((q) =>
              promptOverrides[q.id] ? { ...q, prompt: promptOverrides[q.id]! } : q,
            )}
            answers={answers}
            loadImage={loadImage}
            onChange={onChange}
            footer={<CrisisFooter />}
            wrongFact={{
              onOpen: (q) => {
                setWrongFactQ(q);
                setCorrectionText('');
                setCorrectionOutcome(null);
              },
              renderPanel: renderWrongFactPanel,
            }}
            wizard={
              editing
                ? {
                    onSubmit: () => void onUpdate(),
                    submitLabel: 'Update answers',
                    onDecline: () => {
                      setEditing(false);
                      setError(null);
                      setAnswers(toAnswerMap(detail.answers)); // discard edits — restore submitted answers
                    },
                    declineLabel: 'Cancel',
                    busy,
                  }
                : {
                    onSubmit: () => void onSubmit(),
                    onSaveForLater: () => void onSave(),
                    onDecline: () => setDeclining(true),
                    busy,
                  }
            }
          />
        </>
      )}
    </Stack>
  );
}

/**
 * The answerer's view of a compatibility send after they've answered (§3.6): the shared report (once the
 * sender generates it), plus their own submitted answers for `eachSeesOwn`. Never the other person's raw
 * answers — only the joint report.
 */
function JointReport({
  compatibility,
  asker,
}: {
  compatibility: InboxCompatibilityView;
  asker: string;
}): JSX.Element {
  const { report, ownAnswers, visibility } = compatibility;
  // Context-only sends never produce a report — the answers just inform each person's own coach (§16.2).
  if (visibility === 'contextOnly') {
    return (
      <Card>
        <Text tone="secondary">
          Thanks — there’s no report for this one. Your answers just help your own coach understand
          you a little better.
        </Text>
      </Card>
    );
  }
  return (
    <Stack gap={3}>
      {ownAnswers && ownAnswers.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={3}>Your answers</Heading>
            <AnswerList answers={ownAnswers} />
          </Stack>
        </Card>
      ) : null}

      <Card>
        {report ? (
          <Stack gap={3}>
            <Heading level={3}>Your shared report</Heading>
            <AlignmentReportView report={report} />
          </Stack>
        ) : (
          <Text tone="secondary">
            {asker} will share a compatibility report here once both of you have answered.
          </Text>
        )}
      </Card>
    </Stack>
  );
}
