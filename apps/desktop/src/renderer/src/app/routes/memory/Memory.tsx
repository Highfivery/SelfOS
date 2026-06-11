import { useEffect, useState } from 'react';
import { Brain, Lock, Trash2, Unlock } from 'lucide-react';
import type { Insight, InsightFact } from '@shared/schemas';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import {
  Banner,
  Button,
  Card,
  Heading,
  IconButton,
  Stack,
  Switch,
  Text,
  Textarea,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './Memory.module.css';

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

/** One Insight: provenance + (for drafts) the inline review/approve step, (for approved) view + edit/delete. */
function InsightCard({
  insight,
  subjectName,
}: {
  insight: Insight;
  subjectName: string;
}): JSX.Element {
  const approve = useInsightStore((s) => s.approve);
  const update = useInsightStore((s) => s.update);
  const remove = useInsightStore((s) => s.remove);

  const [editing, setEditing] = useState(!insight.approved); // drafts open in review mode
  const [summary, setSummary] = useState(insight.summary);
  const [facts, setFacts] = useState<InsightFact[]>(insight.facts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Collapse to the read view once an insight becomes approved (the card is reused across reloads by
  // `key`, so the initial `useState` doesn't re-run — sync it here).
  useEffect(() => {
    if (insight.approved) setEditing(false);
  }, [insight.approved]);

  const edit = { subjectPersonId: insight.subjectPersonId, id: insight.id, summary, facts };

  const onApprove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (!(await approve(edit))) setError('Couldn’t save that insight. Please try again.');
    } catch {
      setError('Couldn’t save that insight. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const onSave = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (await update(edit)) setEditing(false);
      else setError('Couldn’t save your changes. Please try again.');
    } catch {
      setError('Couldn’t save your changes. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const onRemove = async (): Promise<void> => {
    setError(null);
    try {
      await remove({ subjectPersonId: insight.subjectPersonId, id: insight.id });
    } catch {
      setError('Couldn’t remove that insight. Please try again.');
    }
  };
  const setFactShareable = (id: string, shareable: boolean): void =>
    setFacts((fs) => fs.map((f) => (f.id === id ? { ...f, shareable } : f)));

  return (
    <Card>
      <Stack gap={3}>
        {insight.crisisFlag ? (
          <Banner tone="danger">
            This response may indicate distress. Lead with care — if anyone is in immediate danger,
            call your local emergency number; in the US &amp; Canada call or text{' '}
            <strong>988</strong>.
          </Banner>
        ) : null}

        <div className={styles.head}>
          <div>
            <Text weight={600}>About {subjectName}</Text>
            <Text size="xs" tone="tertiary">
              From a questionnaire · {formatDate(insight.updatedAt)} ·{' '}
              {insight.approved ? 'approved' : 'awaiting your review'}
            </Text>
          </div>
          {insight.approved ? (
            <IconButton
              aria-label="Delete insight"
              variant="secondary"
              disabled={busy}
              onClick={() => void onRemove()}
            >
              <Trash2 size={16} aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>

        {editing ? (
          <>
            <Textarea
              rows={3}
              value={summary}
              aria-label="Insight summary"
              onChange={(event) => setSummary(event.target.value)}
            />
            <Stack gap={2}>
              <Text size="sm" weight={500}>
                Facts — choose which are safe to share with {subjectName}
              </Text>
              {facts.map((fact) => (
                <div key={fact.id} className={styles.factRow}>
                  <Switch
                    checked={fact.shareable}
                    aria-label={`${fact.text} — shareable`}
                    onChange={(checked) => setFactShareable(fact.id, checked)}
                  />
                  {fact.shareable ? (
                    <Unlock size={14} aria-hidden="true" className={styles.factIcon} />
                  ) : (
                    <Lock size={14} aria-hidden="true" className={styles.factIcon} />
                  )}
                  <Text size="sm">{fact.text}</Text>
                </div>
              ))}
            </Stack>
            <div className={styles.actions}>
              {insight.approved ? (
                <Button variant="primary" onClick={() => void onSave()} disabled={busy}>
                  Save
                </Button>
              ) : (
                <Button variant="primary" onClick={() => void onApprove()} disabled={busy}>
                  Approve
                </Button>
              )}
              {insight.approved ? (
                <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => void onRemove()} disabled={busy}>
                  Discard
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <Text>{insight.summary}</Text>
            <Stack gap={1}>
              {insight.facts.map((fact) => (
                <div key={fact.id} className={styles.factRow}>
                  {fact.shareable ? (
                    <Unlock size={14} aria-hidden="true" className={styles.factIcon} />
                  ) : (
                    <Lock size={14} aria-hidden="true" className={styles.factIcon} />
                  )}
                  <Text size="sm" tone="secondary">
                    {fact.text}
                  </Text>
                </div>
              ))}
            </Stack>
            <div>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          </>
        )}

        {error ? <Banner tone="warning">{error}</Banner> : null}
      </Stack>
    </Card>
  );
}

/**
 * "Memory" — the what-the-coach-knows surface (08-questionnaires §3.7/§13.4). Lists every Insight, with
 * the inline approve-step for drafts (edit the summary, choose which facts are shareable). Crisis-flagged
 * Insights lead with concern + resources (§8.2). The live producer (Analyze on a received answer) wires
 * up with the Inbox/Results in §13.5.
 */
export function Memory(): JSX.Element {
  const insights = useInsightStore((s) => s.insights);
  const loaded = useInsightStore((s) => s.loaded);
  const load = useInsightStore((s) => s.load);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);

  useEffect(() => {
    void load();
    void loadPeople();
  }, [load, loadPeople]);

  const nameOf = (id: string): string => people.find((p) => p.id === id)?.displayName ?? 'someone';

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <Heading level={2}>Memory</Heading>
        <Text tone="secondary">
          What the coach has learned about the people in your life, from questionnaire answers.
          Approve an insight to let it inform future sessions.
        </Text>
      </Stack>

      {loaded && insights.length === 0 ? (
        <Card>
          <Stack gap={2} align="center">
            <Brain size={24} aria-hidden="true" />
            <Text tone="secondary">
              Nothing here yet. When you analyze a questionnaire’s answers, what the coach learns
              shows up here for you to review.
            </Text>
          </Stack>
        </Card>
      ) : (
        <Stack gap={3}>
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              subjectName={nameOf(insight.subjectPersonId)}
            />
          ))}
        </Stack>
      )}

      <CrisisFooter />
    </div>
  );
}
