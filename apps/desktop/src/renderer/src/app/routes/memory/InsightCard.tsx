import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, PencilLine, Trash2 } from 'lucide-react';
import type { Insight, InsightFact, RelationshipType } from '@shared/schemas';
import { useInsightStore } from '../../../stores/insightStore';
import {
  Banner,
  Button,
  Card,
  ConfidenceChip,
  IconButton,
  Markdown,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import { FactSharingControl } from './FactSharingControl';
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
 * One insight on the Memory dashboard (20-memory-dashboard §3.2 + 44 §3.4). For the active person's OWN
 * insights it's interactive; for a RELATED person's shared facts it's read-only (`isOwn = false`).
 *
 * Corrections split by source (44 §3.4): an ONBOARDING (`intake`) insight is what you told SelfOS — you fix
 * it by **editing the answer** (deep-link) or **deleting**, never "flagging." An AI-INFERRED insight
 * (session/dream/questionnaire) keeps the correction toggle, relabelled **"This isn't right about me"** —
 * it drops the fact from the coach at once. Per-fact sharing uses the relationship-type `RelationshipScopePicker`
 * (`FactSharingControl`), replacing the broadcast toggle. `sourceRemoved` renders "original source removed."
 */
export function InsightCard({
  insight,
  subjectName,
  isOwn,
  sourceRemoved,
  availableTypes,
}: {
  insight: Insight;
  subjectName: string;
  isOwn: boolean;
  sourceRemoved?: boolean;
  /** Relationship types present in the person's graph (44 §3.4) — passed to each fact's sharing picker. */
  availableTypes?: RelationshipType[];
}): JSX.Element {
  const navigate = useNavigate();
  const approve = useInsightStore((s) => s.approve);
  const update = useInsightStore((s) => s.update);
  const remove = useInsightStore((s) => s.remove);
  const flag = useInsightStore((s) => s.flag);

  const isIntake = insight.source === 'intake';
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
  // Approve/edit carries only `{id, text, shareable}` — `updateInsight` merges by id, so the server-owned
  // `shareableTypes`/`restricted` stay intact (sharing is set separately via the per-fact picker, §3.4).
  const edit = {
    subjectPersonId: insight.subjectPersonId,
    id: insight.id,
    summary,
    facts: facts.map((f) => ({ id: f.id, text: f.text, shareable: f.shareable })),
  };

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

  const setFactText = (id: string, text: string): void =>
    setFacts((fs) => fs.map((f) => (f.id === id ? { ...f, text } : f)));

  const goToSource = (): void => navigate(prov.to, prov.state ? { state: prov.state } : undefined);

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
            {insight.summary && !editing ? (
              <Markdown className={styles.insightSummary}>{insight.summary}</Markdown>
            ) : null}
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
                  <Markdown
                    inline
                    size="sm"
                    tone="secondary"
                    className={fact.flaggedInaccurate ? styles.flaggedText : undefined}
                  >
                    {fact.text}
                  </Markdown>
                  {fact.flaggedInaccurate ? (
                    <span className={styles.flaggedTag}>marked not right</span>
                  ) : null}
                  {fact.retractedShareAt ? (
                    <span
                      className={styles.flaggedTag}
                      title="This fact was shared, then withdrawn when you marked it"
                    >
                      sharing withdrawn
                    </span>
                  ) : null}
                  <div className={styles.factControls}>
                    {/* A flagged fact is excluded from everyone's context + from outbound sharing, so a
                        sharing picker on it would be misleading — hide it until the flag is cleared. */}
                    {isOwn && !fact.flaggedInaccurate ? (
                      <FactSharingControl
                        insightId={insight.id}
                        subjectPersonId={insight.subjectPersonId}
                        fact={fact}
                        disabled={busy}
                        {...(availableTypes ? { availableTypes } : {})}
                      />
                    ) : null}
                    {/* AI-INFERRED facts can be pushed back on ("this isn't right about me"); ONBOARDING facts
                        are what you told us — you fix them by editing the answer, not flagging (§3.4). */}
                    {isOwn && !isIntake ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={
                          fact.flaggedInaccurate
                            ? `Undo — this is right about me: ${fact.text}`
                            : `This isn’t right about me: ${fact.text}`
                        }
                        onClick={() => void onFlag(fact.id, !fact.flaggedInaccurate)}
                      >
                        {fact.flaggedInaccurate ? 'Undo' : 'Not right'}
                      </Button>
                    ) : null}
                  </div>
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
                  <button type="button" className={styles.provLink} onClick={goToSource}>
                    {prov.label} · {formatDate(insight.provenance.at)}{' '}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </button>
                )}
              </span>
            </div>

            {isOwn ? (
              <div className={styles.actions}>
                {isIntake ? (
                  // Onboarding correction = edit the source answer (§3.4); the portrait re-synthesizes from it.
                  <Button
                    variant="secondary"
                    title="Editing your onboarding answers is how you correct what you told SelfOS"
                    onClick={goToSource}
                  >
                    <PencilLine size={14} aria-hidden="true" /> Edit answer
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
              </div>
            ) : null}
          </>
        )}

        {error ? <Banner tone="warning">{error}</Banner> : null}
      </Stack>
    </Card>
  );
}
