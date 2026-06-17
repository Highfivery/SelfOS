import { useEffect, useState } from 'react';
import { Brain, Lock, ShieldAlert, Trash2, Unlock } from 'lucide-react';
import type { Insight, InsightFact } from '@shared/schemas';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
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
  const isIntake = insight.source === 'intake';
  const sourceLabel =
    insight.source === 'intake'
      ? 'onboarding'
      : insight.source === 'session'
        ? 'a session'
        : insight.source === 'dream'
          ? 'a dream'
          : 'a questionnaire';

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
              From {sourceLabel} · {formatDate(insight.updatedAt)} ·{' '}
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
                  {fact.restricted ? (
                    <span className={styles.sensitiveTag} title="Sensitive onboarding content">
                      <ShieldAlert size={12} aria-hidden="true" /> sensitive
                    </span>
                  ) : null}
                </div>
              ))}
            </Stack>
            {isIntake ? (
              <Text size="xs" tone="tertiary">
                Sensitive onboarding content (what weighs on you, intimacy) stays private to your
                own coaching — it’s shown here only to you, and never to anyone else.
              </Text>
            ) : null}
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
 * "Memory" — the active person's OWN view of what SelfOS has learned about them (20-memory-dashboard
 * §5.1). The bridge scopes the list to their own insights (+ relationships' shareable facts, rendered in
 * the §5.3 dashboard rebuild — slice 3); this surface shows only their own. Drafts get the inline
 * approve-step (edit the summary, choose which facts are shareable); crisis-flagged insights lead with
 * concern + resources (§8.2).
 */
export function Memory(): JSX.Element {
  const insights = useInsightStore((s) => s.insights);
  const loaded = useInsightStore((s) => s.loaded);
  const load = useInsightStore((s) => s.load);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);

  useEffect(() => {
    void load();
    void loadPeople();
  }, [load, loadPeople]);

  const nameOf = (id: string): string => people.find((p) => p.id === id)?.displayName ?? 'someone';

  // The bridge scopes `insights` to the active person's OWN insights + their relationships' shareable
  // facts (spec 20 §5.1). This surface (the questionnaire-era card list) shows only the person's OWN
  // insights for now; rendering related people's shareable facts under their subject is the §5.3
  // dashboard rebuild (slice 3) — so no half-built related cards or dead controls here (CLAUDE.md §12).
  const ownInsights = insights.filter((insight) => insight.subjectPersonId === activePersonId);

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <Heading level={2}>Memory</Heading>
        <Text tone="secondary">
          What the coach has learned — from questionnaire answers, sessions, dreams, and onboarding.
          Approve an insight to let it inform future sessions.
        </Text>
      </Stack>

      {loaded && ownInsights.length === 0 ? (
        <Card>
          <Stack gap={2} align="center">
            <Brain size={24} aria-hidden="true" />
            <Text tone="secondary">
              Nothing here yet. As you have sessions, log dreams, and answer questionnaires, what
              SelfOS learns about you shows up here.
            </Text>
          </Stack>
        </Card>
      ) : (
        <Stack gap={3}>
          {ownInsights.map((insight) => (
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
