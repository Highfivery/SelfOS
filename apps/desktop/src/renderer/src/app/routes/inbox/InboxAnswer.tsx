import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  ADMIN_ACCESS_DISCLOSURE,
  compatibilityDisclosure,
  unansweredRequired,
} from '@selfos/core/questionnaires';
import type { AnswerMap, AnswerValue } from '@selfos/core/questionnaires';
import type { Answer, InboxAssignmentDetail } from '@shared/channels';
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
import { useSetting } from '../../../settings/useSetting';
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

const toAnswerList = (questions: Question[], map: AnswerMap): Answer[] => {
  const out: Answer[] = [];
  for (const q of questions) {
    const value = map[q.id];
    if (value !== undefined) out.push({ questionId: q.id, value });
  }
  return out;
};

/**
 * The recipient's answering pane for one Inbox assignment (08-questionnaires §3.3). Shows who's asking
 * + the privacy mode, renders the shared answering form (save/resume), and offers Submit or Decline
 * (silently or with a short note). Locked once submitted/declined.
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
  const submit = useInboxStore((s) => s.submit);
  const decline = useInboxStore((s) => s.decline);
  // Whether recipients are told an admin could break-glass access answers (admin-only setting, §8.4).
  const [discloseAdminAccess] = useSetting('questionnaires.discloseAdminAccess');

  const [detail, setDetail] = useState<InboxAssignmentDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineNote, setDeclineNote] = useState('');

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
  // shown to the recipient always matches what the system delivers (§3.2/§8.4). The admin-access line is
  // appended only when the (admin-only) disclosure setting is on and an admin could ever reach the answers.
  const disclosure = ((): string => {
    if (detail.compatibility)
      return compatibilityDisclosure(detail.compatibility.visibility, asker);
    return detail.privacy === 'private'
      ? 'Your answers personalize their coaching. They won’t see your individual responses — though your numeric ratings may appear in their trends over time.'
      : 'They’ll see your answers.';
  })();
  const showsAdminAccess =
    discloseAdminAccess === true && (detail.privacy === 'private' || Boolean(detail.compatibility));

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

  // Locked: already submitted or declined — no post-submit answer review (§3.3), EXCEPT a compatibility
  // send shows the answerer the joint report (and, for eachSeesOwn, their own answers) per §3.6.
  if (!detail.answerable) {
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
            {showsAdminAccess ? ` ${ADMIN_ACCESS_DISCLOSURE}` : ''}
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
          <QuestionnaireForm
            questions={detail.questionnaire.questions}
            answers={answers}
            loadImage={loadImage}
            onChange={onChange}
            footer={<CrisisFooter />}
          />

          {saved ? <Banner tone="info">Saved — you can come back and finish later.</Banner> : null}
          {error ? <Banner tone="warning">{error}</Banner> : null}

          <div className={styles.footer}>
            <Button variant="primary" onClick={() => void onSubmit()} disabled={busy}>
              Submit
            </Button>
            <Button variant="secondary" onClick={() => void onSave()} disabled={busy}>
              Save for later
            </Button>
            <Button variant="secondary" onClick={() => setDeclining(true)} disabled={busy}>
              Decline
            </Button>
          </div>
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
  const { report, ownAnswers } = compatibility;
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
