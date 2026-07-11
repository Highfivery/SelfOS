import { useEffect, useState } from 'react';
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
import type { Answer, InboxAssignmentDetail, SendAnswer } from '@shared/channels';
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

  const [detail, setDetail] = useState<InboxAssignmentDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineNote, setDeclineNote] = useState('');
  // 56 §3.1 — editing a previously-submitted send: the review is shown until the recipient taps "Edit answers",
  // which flips this on and renders the (pre-filled) form. Reopening the assignment is deferred to the update
  // submit, so Cancel is a true no-op (the send stays submitted).
  const [editing, setEditing] = useState(false);

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
          {saved ? <Banner tone="info">Saved — you can come back and finish later.</Banner> : null}
          {error ? <Banner tone="warning">{error}</Banner> : null}

          {/* One question at a time (08 §21.3): the shared wizard owns Back/Next + the action bar; the
              host supplies the terminal callbacks. Editing → Update answers + Cancel (no Save for later);
              a fresh answer → Submit + Save for later + Decline. */}
          <QuestionnaireForm
            questions={detail.questionnaire.questions}
            answers={answers}
            loadImage={loadImage}
            onChange={onChange}
            footer={<CrisisFooter />}
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
