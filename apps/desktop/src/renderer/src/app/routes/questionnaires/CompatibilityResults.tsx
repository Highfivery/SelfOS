import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Lock, Send, Sparkles } from 'lucide-react';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import type { CompatibilityGroup, CompatibilityMember, SendAnswer } from '@shared/schemas';
import { Banner, Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useSetting } from '../../../settings/useSetting';
import { AlignmentReportView, AnswerList } from './AlignmentReportView';
import styles from './Questionnaires.module.css';

/**
 * The sender's **compatibility** Results (08-questionnaires §3.6/§13.5d): the two paired sends, a manual
 * "Generate alignment" once both have answered → a joint report + a draft Insight (reviewed in Memory),
 * and — for a `senderSeesAll` group with `questionnaires.readRaw` — an explicit, audited "Reveal raw
 * answers" action per member. Raw answers are never shown otherwise.
 */
export function CompatibilityResults({
  questionnaireId,
}: {
  questionnaireId: string;
}): JSX.Element {
  const [groups, setGroups] = useState<CompatibilityGroup[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [aiEnabled] = useSetting('ai.enabled');
  const [hasAiKey, setHasAiKey] = useState(false);
  useEffect(() => {
    void window.selfos
      ?.secretHas({ id: ANTHROPIC_API_KEY_ID })
      .then((v) => setHasAiKey(Boolean(v)));
  }, []);
  const aiReady = aiEnabled === true && hasAiKey;

  const load = useCallback(async (): Promise<void> => {
    setGroups((await window.selfos?.assignmentsCompatibility(questionnaireId)) ?? []);
    setLoaded(true);
  }, [questionnaireId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (loaded && groups.length === 0) {
    return (
      <Card>
        <Stack gap={2} align="center">
          <Sparkles size={24} aria-hidden="true" />
          <Text tone="secondary">
            You haven’t sent this compatibility questionnaire yet. Use <strong>Send</strong> on the
            Edit tab to ask two people.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap={3}>
      <Heading level={3}>Compatibility</Heading>
      {!aiReady ? (
        <Banner tone="info">
          Turn on AI in <Link to="/settings">Settings</Link> to align responses into a report.
        </Banner>
      ) : null}
      {groups.map((group) => (
        <GroupCard
          key={group.compatibilityGroupId}
          group={group}
          aiReady={aiReady}
          onChanged={load}
        />
      ))}
    </Stack>
  );
}

function GroupCard({
  group,
  aiReady,
  onChanged,
}: {
  group: CompatibilityGroup;
  aiReady: boolean;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const [aligning, setAligning] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);
  const [revealed, setRevealed] = useState<Record<string, SendAnswer[]>>({});
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  const names = group.members.map((m) => m.recipientName).join(' & ');
  const isContextOnly = group.visibility === 'contextOnly';
  // An external participant answers via a relay link and can be sent the report back (§17.12-D).
  const externalMembers = group.members.filter((m) => m.channel === 'relay');

  // Push the generated report back to the external recipient(s)' relay link.
  const runShare = async (): Promise<void> => {
    if (sharing) return;
    setSharing(true);
    setMessage(null);
    try {
      const result = await window.selfos?.assignmentsPublishCompatResult(
        group.compatibilityGroupId,
      );
      if (result?.ok) {
        setShared(true);
      } else {
        setMessage({ tone: 'warning', text: result?.message ?? 'Couldn’t share the results.' });
      }
    } finally {
      setSharing(false);
    }
  };

  // Context-only: distil each participant's own answers into their own coach's context — no report.
  const runDistill = async (): Promise<void> => {
    if (aligning) return;
    setAligning(true);
    setMessage({ tone: 'info', text: 'Updating each coach…' });
    try {
      const result = await window.selfos?.assignmentsDistillContextOnly(group.compatibilityGroupId);
      if (result?.ok) {
        setMessage(null);
        await onChanged();
      } else {
        setMessage({ tone: 'warning', text: result?.message ?? 'Couldn’t update their coaches.' });
      }
    } finally {
      setAligning(false);
    }
  };

  const runAlign = async (): Promise<void> => {
    if (aligning) return;
    setAligning(true);
    setMessage({ tone: 'info', text: 'Aligning their answers…' });
    try {
      const result = await window.selfos?.assignmentsAlign(group.compatibilityGroupId);
      if (result?.ok) {
        setMessage(null);
        await onChanged();
      } else {
        setMessage({ tone: 'warning', text: result?.message ?? 'Couldn’t align these responses.' });
      }
    } finally {
      setAligning(false);
    }
  };

  const runReveal = async (member: CompatibilityMember): Promise<void> => {
    const answers = await window.selfos?.assignmentsRevealRaw(member.assignmentId);
    if (answers) setRevealed((r) => ({ ...r, [member.assignmentId]: answers }));
    else setMessage({ tone: 'warning', text: 'Couldn’t reveal those answers.' });
  };

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.resultHead}>
          <Text weight={500}>{names}</Text>
          <span className={styles.rowBadge}>
            <Lock size={12} aria-hidden="true" className={styles.privacyIcon} />
            {group.bothSubmitted ? 'Both answered' : 'Waiting'}
          </span>
        </div>

        <Stack gap={1}>
          {group.members.map((m) => (
            <Text key={m.assignmentId} size="sm" tone="secondary">
              {m.recipientName}: {m.status === 'submitted' ? 'Answered' : 'Waiting'}
            </Text>
          ))}
        </Stack>

        {!group.bothSubmitted ? (
          <Text tone="secondary">
            {isContextOnly
              ? 'Both people need to answer before their coaches can use this.'
              : 'Both people need to answer before you can align their responses.'}
          </Text>
        ) : isContextOnly ? (
          // Context-only: no report — a private per-person distillation into each coach's context.
          <Stack gap={2}>
            <Text size="sm" tone="secondary">
              Context-only — no report is produced. Each person’s answers privately inform their own
              coach.
            </Text>
            {group.analyzed ? (
              <Banner tone="info">Both coaches updated from these answers.</Banner>
            ) : null}
            {aiReady ? (
              <div>
                <Button variant="secondary" onClick={() => void runDistill()} disabled={aligning}>
                  <Sparkles size={16} aria-hidden="true" />
                  {aligning
                    ? 'Updating…'
                    : group.analyzed
                      ? 'Update both coaches again'
                      : 'Update both coaches'}
                </Button>
              </div>
            ) : null}
          </Stack>
        ) : group.report ? (
          <Stack gap={3}>
            <AlignmentReportView report={group.report} />
            {group.analyzed ? (
              <Banner tone="info">
                Insight drafted from this report. <Link to="/memory">Review it in Memory →</Link>
              </Banner>
            ) : null}
            {externalMembers.length > 0 ? (
              <Stack gap={2}>
                {shared ? (
                  <Banner tone="info">
                    Shared with {externalMembers.map((m) => m.recipientName).join(' & ')}. They can
                    revisit their link to see it.
                  </Banner>
                ) : (
                  <Text size="sm" tone="secondary">
                    {externalMembers.map((m) => m.recipientName).join(' & ')} answered via a link.
                    Share this report so it shows up there too.
                  </Text>
                )}
                <div>
                  <Button variant="secondary" onClick={() => void runShare()} disabled={sharing}>
                    <Send size={16} aria-hidden="true" />
                    {sharing ? 'Sharing…' : shared ? 'Share again' : 'Share results'}
                  </Button>
                </div>
              </Stack>
            ) : null}
          </Stack>
        ) : aiReady ? (
          <div>
            <Button variant="secondary" onClick={() => void runAlign()} disabled={aligning}>
              <Sparkles size={16} aria-hidden="true" />
              {aligning ? 'Aligning…' : 'Generate alignment'}
            </Button>
          </div>
        ) : null}

        {/* Regenerate keeps the report fresh after a re-ask; same button once a report exists. */}
        {group.bothSubmitted && !isContextOnly && group.report && aiReady ? (
          <div>
            <Button variant="secondary" onClick={() => void runAlign()} disabled={aligning}>
              {aligning ? 'Aligning…' : 'Regenerate'}
            </Button>
          </div>
        ) : null}

        {group.canReveal && group.bothSubmitted ? (
          <Stack gap={2}>
            <Banner tone="warning">
              These are the other person’s raw answers. Open them only when you need to, and treat
              them with care.
            </Banner>
            {group.members.map((m) =>
              revealed[m.assignmentId] ? (
                <div key={m.assignmentId}>
                  <Text size="sm" weight={500}>
                    {m.recipientName}
                  </Text>
                  <AnswerList answers={revealed[m.assignmentId] ?? []} />
                </div>
              ) : (
                <div key={m.assignmentId}>
                  <Button variant="secondary" onClick={() => void runReveal(m)}>
                    <Eye size={14} aria-hidden="true" />
                    Reveal {m.recipientName}’s answers
                  </Button>
                </div>
              ),
            )}
          </Stack>
        ) : null}

        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
      </Stack>
    </Card>
  );
}
