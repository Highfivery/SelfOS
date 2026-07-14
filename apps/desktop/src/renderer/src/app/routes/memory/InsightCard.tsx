import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Flag, Pencil, PencilLine, ShieldAlert, Trash2 } from 'lucide-react';
import type { Insight, InsightFact, RelationshipType } from '@shared/schemas';
import { LIFE_AREAS } from '@shared/schemas';
import { areaIcon } from './lifeAreaIcons';
import { useInsightStore } from '../../../stores/insightStore';
import {
  Banner,
  Button,
  Card,
  Collapsible,
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
  test: 'Self-assessment',
  together: 'Together session',
};

/** Above this many facts, a long insight (the onboarding portrait) groups its facts by life-area so it's
 * scannable instead of one wall of text; shorter insights stay a single flat list. */
const FACT_GROUP_THRESHOLD = 8;

/**
 * Split an insight's facts into life-area groups (44 audit — readability). Only groups a long, multi-area
 * insight (the portrait); otherwise returns one untitled group (a plain list). Facts with no `lifeArea` fall
 * under a trailing "More" group. Order follows the `LIFE_AREAS` taxonomy.
 */
function groupFactsByArea(
  facts: InsightFact[],
  enabled: boolean,
): { area: string | null; facts: InsightFact[] }[] {
  const areas = [...new Set(facts.map((f) => f.lifeArea).filter((a): a is string => Boolean(a)))];
  if (!enabled || facts.length <= FACT_GROUP_THRESHOLD || areas.length < 2) {
    return [{ area: null, facts }];
  }
  const ordered = [
    ...LIFE_AREAS.filter((a) => areas.includes(a)),
    ...areas.filter((a) => !(LIFE_AREAS as readonly string[]).includes(a)),
  ];
  const groups = ordered.map((area) => ({
    area,
    facts: facts.filter((f) => f.lifeArea === area),
  }));
  const noArea = facts.filter((f) => !f.lifeArea);
  if (noArea.length > 0) groups.push({ area: 'More', facts: noArea });
  return groups.filter((g) => g.facts.length > 0);
}

/**
 * One insight on the Memory page (62-memory-insights-redesign, on 20/44/57). For the active person's OWN
 * insights it's **obviously editable in place**: a card-level pencil edits the whole card (summary + facts),
 * and each AI-inferred fact carries a **per-line pencil** that edits just that line inline — read and edit are
 * no longer separate screens (62 §3.3). For a RELATED person's shared facts it's read-only (`isOwn = false`).
 *
 * Corrections split by source (44 §3.4): an ONBOARDING (`intake`) insight is what you told SelfOS — you fix
 * it by **editing the answer** (deep-link) or **deleting**, not by inline editing/flagging. An AI-INFERRED
 * insight keeps inline edit + the per-fact **sharing scope chip** + a **flag** ("this isn't right about me",
 * which drops the fact from the coach at once). `sourceRemoved` renders "original source removed."
 */
export function InsightCard({
  insight,
  subjectName,
  isOwn,
  sourceRemoved,
  aboutName,
  availableTypes,
  hideSummary,
}: {
  insight: Insight;
  subjectName: string;
  isOwn: boolean;
  sourceRemoved?: boolean;
  /** Hide the read-mode summary (the portrait's narrative is shown once in the hero — spec 62 §3.4). */
  hideSummary?: boolean;
  /** Who this sent-questionnaire insight is ABOUT — the recipient (#129). When set, the eyebrow reads "From
   * <name>'s answers" instead of "About you," since the facts describe their answers, not the viewer. */
  aboutName?: string;
  /** Relationship types in the person's graph — offered by an AI-inferred fact's sharing picker (44 §3.4). */
  availableTypes?: RelationshipType[];
}): JSX.Element {
  const navigate = useNavigate();
  const approve = useInsightStore((s) => s.approve);
  const update = useInsightStore((s) => s.update);
  const remove = useInsightStore((s) => s.remove);
  const flag = useInsightStore((s) => s.flag);

  const isIntake = insight.source === 'intake';
  const isDraft = isOwn && !insight.approved;
  // Whole-card edit (drafts open here); a single-fact inline edit is tracked separately (62 §3.3).
  const [cardEditing, setCardEditing] = useState(isDraft);
  const [factEditing, setFactEditing] = useState<string | null>(null);
  const [summary, setSummary] = useState(insight.summary);
  const [facts, setFacts] = useState<InsightFact[]>(insight.facts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resync local edit state when the insight actually changes (a save bumps updatedAt; the card is reused by
  // `key` so useState doesn't re-run). A draft becoming approved also closes card-edit.
  useEffect(() => {
    setSummary(insight.summary);
    setFacts(insight.facts);
    if (insight.approved) setCardEditing(false);
    setFactEditing(null);
  }, [insight.updatedAt, insight.approved, insight.summary, insight.facts]);

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
  // Save persists the whole edit (summary + all facts, merge-by-id) — used by both the card editor and a
  // single-fact inline edit (the changed fact is already in `facts` state).
  const onSave = (): Promise<void> =>
    guard(async () => {
      if (await update(edit)) {
        setCardEditing(false);
        setFactEditing(null);
      } else setError('Couldn’t save your changes. Please try again.');
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

  const cancelEdit = (): void => {
    setSummary(insight.summary);
    setFacts(insight.facts);
    setCardEditing(false);
    setFactEditing(null);
  };

  const goToSource = (): void => navigate(prov.to, prov.state ? { state: prov.state } : undefined);

  // A long portrait groups its facts into collapsible life-area sections (44 audit). Sensitive sections (any
  // restricted fact) start COLLAPSED so trauma/intimacy isn't on screen at a glance.
  const factGroups = groupFactsByArea(insight.facts, isOwn);
  const grouped = factGroups.length > 1 || factGroups[0]?.area !== null;

  const eyebrowContext = aboutName
    ? `From ${aboutName}’s answers`
    : isOwn
      ? formatDate(insight.provenance.at)
      : `About ${subjectName}`;

  /** One fact as a read row: text + inline tags + (AI-inferred) the scope chip + a per-line edit pencil; or,
   * when it's the fact being edited, an inline textarea with Save / Cancel (62 §3.3). */
  const renderFact = (fact: InsightFact): JSX.Element => {
    if (factEditing === fact.id) {
      const current = facts.find((f) => f.id === fact.id)?.text ?? fact.text;
      return (
        <li key={fact.id} className={styles.factEditRow}>
          <Textarea
            rows={1}
            value={current}
            autoFocus
            aria-label={`Edit fact: ${fact.text}`}
            onChange={(event) => setFactText(fact.id, event.target.value)}
          />
          <div className={styles.factEditActions}>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void onSave()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
        </li>
      );
    }
    return (
      <li key={fact.id} className={styles.factItem}>
        <span className={styles.factText}>
          <Markdown
            inline
            size="sm"
            className={fact.flaggedInaccurate ? styles.flaggedText : undefined}
          >
            {fact.text}
          </Markdown>
          {fact.flaggedInaccurate ? (
            <span className={styles.inlineTag}>marked not right</span>
          ) : null}
          {fact.retractedShareAt ? (
            <span
              className={styles.inlineTag}
              title="This fact was shared, then withdrawn when you marked it"
            >
              sharing withdrawn
            </span>
          ) : null}
          {isIntake && fact.restricted ? (
            <span
              className={styles.sensitiveTag}
              title="Sensitive — only your own coach uses this."
            >
              <ShieldAlert size={11} aria-hidden="true" /> private
            </span>
          ) : null}
        </span>
        {isOwn && !isIntake ? (
          <span className={styles.factActions}>
            {!fact.flaggedInaccurate ? (
              <FactSharingControl
                insightId={insight.id}
                subjectPersonId={insight.subjectPersonId}
                fact={fact}
                disabled={busy}
                {...(availableTypes ? { availableTypes } : {})}
              />
            ) : null}
            {!fact.flaggedInaccurate ? (
              <IconButton
                variant="ghost"
                aria-label={`Edit: ${fact.text}`}
                disabled={busy}
                onClick={() => {
                  setFacts(insight.facts);
                  setFactEditing(fact.id);
                }}
              >
                <Pencil size={14} aria-hidden="true" />
              </IconButton>
            ) : null}
            <IconButton
              variant="ghost"
              disabled={busy}
              aria-label={
                fact.flaggedInaccurate
                  ? `Undo — this is right about me: ${fact.text}`
                  : `This isn’t right about me: ${fact.text}`
              }
              onClick={() => void onFlag(fact.id, !fact.flaggedInaccurate)}
            >
              {fact.flaggedInaccurate ? (
                <Text size="xs" tone="secondary">
                  Undo
                </Text>
              ) : (
                <Flag size={14} aria-hidden="true" />
              )}
            </IconButton>
          </span>
        ) : null}
      </li>
    );
  };

  const factList = (fs: InsightFact[]): JSX.Element => (
    <ul className={styles.factList}>{fs.map(renderFact)}</ul>
  );

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
            <div className={styles.eyebrowRow}>
              <span className={styles.sourcePill}>{SOURCE_EYEBROW[insight.source]}</span>
              <Text size="xs" tone="tertiary">
                {eyebrowContext}
              </Text>
              <ConfidenceChip
                level={insight.confidence}
                {...(insight.confidenceRationale ? { rationale: insight.confidenceRationale } : {})}
              />
            </div>
            {insight.summary && !cardEditing && !hideSummary ? (
              <Markdown className={styles.insightSummary}>{insight.summary}</Markdown>
            ) : null}
          </div>
          {/* The obvious edit affordance (62 §3.3): a header pencil for an AI-inferred own insight. */}
          {isOwn && insight.approved && !isIntake && !cardEditing ? (
            <IconButton
              aria-label="Edit this insight"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setFacts(insight.facts);
                setSummary(insight.summary);
                setFactEditing(null);
                setCardEditing(true);
              }}
            >
              <Pencil size={16} aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>

        {cardEditing ? (
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
                <>
                  <Button variant="primary" onClick={() => void onSave()} disabled={busy}>
                    Save
                  </Button>
                  <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
                    Cancel
                  </Button>
                  <span className={styles.actionsSpacer} />
                  <IconButton
                    aria-label="Delete insight"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void onRemove()}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </IconButton>
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={() => void onApprove()} disabled={busy}>
                    Approve
                  </Button>
                  <Button variant="secondary" onClick={() => void onRemove()} disabled={busy}>
                    Discard
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            {/* A short insight (session/dream) is a plain list; a long portrait becomes COLLAPSIBLE life-area
                sections — sensitive sections collapsed by default (44 audit). */}
            {!grouped ? (
              factList(factGroups[0]?.facts ?? [])
            ) : (
              <Stack gap={2}>
                {factGroups.map((group) => {
                  const area = group.area ?? 'More';
                  const Icon = areaIcon(area);
                  const sensitive = group.facts.some((f) => f.restricted);
                  return (
                    <Collapsible
                      key={area}
                      defaultOpen={!sensitive}
                      header={
                        <>
                          <Icon size={16} aria-hidden="true" className={styles.factGroupIcon} />
                          <span className={styles.factGroupName}>{area}</span>
                          {sensitive ? (
                            <span className={styles.factGroupPrivate}>private</span>
                          ) : null}
                          <span className={styles.factGroupCount}>{group.facts.length}</span>
                        </>
                      }
                    >
                      {factList(group.facts)}
                    </Collapsible>
                  );
                })}
              </Stack>
            )}

            <div className={styles.metaRow}>
              {insight.categories.map((c) => (
                <span key={c} className={styles.categoryTag}>
                  {c}
                </span>
              ))}
              <span className={styles.provenance}>
                {!isOwn ? (
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

            {isOwn && isIntake ? (
              <div className={styles.actions}>
                {/* Onboarding correction = edit the source answer (§3.4); the portrait re-synthesizes from it. */}
                <Button
                  variant="secondary"
                  title="Editing your onboarding answers is how you correct what you told SelfOS"
                  onClick={goToSource}
                >
                  <PencilLine size={14} aria-hidden="true" /> Edit answer
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
