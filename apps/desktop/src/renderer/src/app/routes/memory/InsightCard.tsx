import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Flag, ShieldAlert, Trash2 } from 'lucide-react';
import type { Insight, InsightFact } from '@shared/schemas';
import { useInsightStore } from '../../../stores/insightStore';
import {
  Banner,
  Button,
  Card,
  ConfidenceChip,
  IconButton,
  ShareToggle,
  Stack,
  Switch,
  Text,
  Textarea,
} from '../../../design-system/components';
import { provenanceTarget } from './provenance';
import styles from './Memory.module.css';

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

const SOURCE_EYEBROW: Record<Insight['source'], string> = {
  intake: 'Onboarding',
  session: 'Session',
  dream: 'Dream',
  questionnaire: 'Questionnaire',
};

/**
 * One insight on the Memory dashboard (20-memory-dashboard §3.2). For the active person's OWN insights it's
 * fully interactive (review/approve a draft, edit, delete, per-fact share + flag-inaccurate, jump to source);
 * for a RELATED person's shared facts it's read-only (`isOwn = false`) — just their subject + shareable facts
 * + confidence, never an edit/flag/share control (the bridge rejects mutating another's insight anyway).
 * `sourceRemoved` renders "original source removed" instead of a working provenance link (§3.3/§3.7).
 */
export function InsightCard({
  insight,
  subjectName,
  isOwn,
  sourceRemoved,
}: {
  insight: Insight;
  subjectName: string;
  isOwn: boolean;
  sourceRemoved?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const approve = useInsightStore((s) => s.approve);
  const update = useInsightStore((s) => s.update);
  const remove = useInsightStore((s) => s.remove);
  const flag = useInsightStore((s) => s.flag);

  const [editing, setEditing] = useState(isOwn && !insight.approved); // own drafts open in review mode
  const [summary, setSummary] = useState(insight.summary);
  const [facts, setFacts] = useState<InsightFact[]>(insight.facts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Collapse to the read view once a draft becomes approved (the card is reused by `key`, so the initial
  // useState doesn't re-run — sync it here).
  useEffect(() => {
    if (insight.approved) setEditing(false);
  }, [insight.approved]);

  const prov = provenanceTarget(insight);
  const edit = { subjectPersonId: insight.subjectPersonId, id: insight.id, summary, facts };

  const guard = async (fn: () => Promise<unknown>, message: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const onApprove = (): Promise<void> =>
    guard(async () => {
      if (!(await approve(edit))) setError('Couldn’t save that insight. Please try again.');
    }, 'Couldn’t save that insight. Please try again.');
  const onSave = (): Promise<void> =>
    guard(async () => {
      if (await update(edit)) setEditing(false);
      else setError('Couldn’t save your changes. Please try again.');
    }, 'Couldn’t save your changes. Please try again.');
  const onRemove = (): Promise<void> =>
    guard(
      () => remove({ subjectPersonId: insight.subjectPersonId, id: insight.id }),
      'Couldn’t remove that insight. Please try again.',
    );
  const onFlag = (factId: string, flagged: boolean): Promise<void> =>
    guard(
      () => flag({ insightId: insight.id, factId, flagged }),
      'Couldn’t update that. Please try again.',
    );
  const onShare = (factId: string, shareable: boolean): Promise<void> =>
    guard(
      () =>
        update({
          subjectPersonId: insight.subjectPersonId,
          id: insight.id,
          facts: insight.facts.map((f) => (f.id === factId ? { ...f, shareable } : f)),
        }),
      'Couldn’t update sharing. Please try again.',
    );

  const setFactShareable = (id: string, shareable: boolean): void =>
    setFacts((fs) => fs.map((f) => (f.id === id ? { ...f, shareable } : f)));
  const setFactText = (id: string, text: string): void =>
    setFacts((fs) => fs.map((f) => (f.id === id ? { ...f, text } : f)));

  return (
    <Card>
      <Stack gap={3}>
        {insight.crisisFlag ? (
          <Banner tone="danger">
            This may reflect distress. Be gentle — if anyone is in immediate danger, call your local
            emergency number; in the US &amp; Canada call or text <strong>988</strong>.
          </Banner>
        ) : null}

        <div className={styles.head}>
          <div className={styles.headMain}>
            <Text size="xs" tone="tertiary" className={styles.eyebrow}>
              {`${SOURCE_EYEBROW[insight.source]} · ${isOwn ? 'About you' : `About ${subjectName}`}`}
            </Text>
            {insight.summary && !editing ? <Text weight={600}>{insight.summary}</Text> : null}
          </div>
          {isOwn && insight.approved && !editing ? (
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
              {facts.map((fact) => (
                <div key={fact.id} className={styles.factEditRow}>
                  <Switch
                    checked={fact.shareable}
                    aria-label={`${fact.text} — shareable`}
                    onChange={(checked) => setFactShareable(fact.id, checked)}
                  />
                  <Textarea
                    rows={1}
                    value={fact.text}
                    aria-label={`Edit fact: ${fact.text}`}
                    onChange={(event) => setFactText(fact.id, event.target.value)}
                  />
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
            <Stack gap={1}>
              {insight.facts.map((fact) => (
                <div key={fact.id} className={styles.factRow}>
                  {isOwn ? (
                    <IconButton
                      aria-label={
                        fact.flaggedInaccurate
                          ? `Unflag: ${fact.text}`
                          : `Flag as inaccurate: ${fact.text}`
                      }
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onFlag(fact.id, !fact.flaggedInaccurate)}
                    >
                      <Flag
                        size={13}
                        aria-hidden="true"
                        className={fact.flaggedInaccurate ? styles.flagOn : styles.factIcon}
                        fill={fact.flaggedInaccurate ? 'currentColor' : 'none'}
                      />
                    </IconButton>
                  ) : null}
                  <Text
                    size="sm"
                    tone="secondary"
                    className={fact.flaggedInaccurate ? styles.flaggedText : undefined}
                  >
                    {fact.text}
                  </Text>
                  {fact.flaggedInaccurate ? (
                    <span className={styles.flaggedTag}>flagged</span>
                  ) : null}
                  {fact.restricted ? (
                    <span className={styles.sensitiveTag} title="Sensitive onboarding content">
                      <ShieldAlert size={12} aria-hidden="true" /> sensitive
                    </span>
                  ) : null}
                  {isOwn ? (
                    <span className={styles.shareCell}>
                      <ShareToggle
                        shared={fact.shareable}
                        label={fact.text}
                        disabled={busy}
                        onChange={(shared) => void onShare(fact.id, shared)}
                      />
                    </span>
                  ) : null}
                </div>
              ))}
            </Stack>

            <div className={styles.metaRow}>
              <ConfidenceChip
                level={insight.confidence}
                {...(insight.confidenceRationale ? { rationale: insight.confidenceRationale } : {})}
              />
              {insight.categories.map((c) => (
                <span key={c} className={styles.categoryTag}>
                  {c}
                </span>
              ))}
              <span className={styles.provenance}>
                {!isOwn ? (
                  // A related person's insight is scrubbed (no source id) and you can't open their source —
                  // show a plain, non-navigable label, never a wrong-destination link.
                  <Text size="xs" tone="tertiary">
                    {prov.label}
                  </Text>
                ) : sourceRemoved ? (
                  <Text size="xs" tone="tertiary">
                    {prov.label} · original source removed
                  </Text>
                ) : (
                  <button
                    type="button"
                    className={styles.provLink}
                    onClick={() =>
                      navigate(prov.to, prov.state ? { state: prov.state } : undefined)
                    }
                  >
                    {prov.label} · {formatDate(insight.provenance.at)}{' '}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </button>
                )}
              </span>
            </div>

            {isOwn ? (
              <div className={styles.actions}>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </div>
            ) : null}
          </>
        )}

        {error ? <Banner tone="warning">{error}</Banner> : null}
      </Stack>
    </Card>
  );
}
