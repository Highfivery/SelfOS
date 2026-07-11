import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, PencilLine, ShieldAlert, Trash2 } from 'lucide-react';
import type { Insight, InsightFact, RelationshipType } from '@shared/schemas';
import { LIFE_AREAS } from '@shared/schemas';
import { areaIcon } from './lifeAreaIcons';
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
 * One insight on the Memory dashboard (20-memory-dashboard §3.2 + 44 §3.4). For the active person's OWN
 * insights it's interactive; for a RELATED person's shared facts it's read-only (`isOwn = false`).
 *
 * Corrections split by source (44 §3.4): an ONBOARDING (`intake`) insight is what you told SelfOS — you fix
 * it by **editing the answer** (deep-link) or **deleting**, never "flagging." An AI-INFERRED insight
 * (session/dream/questionnaire) keeps the correction toggle, relabelled **"This isn't right about me"** —
 * it drops the fact from the coach at once. Sharing (44 audit): ONBOARDING facts carry NO per-fact chip (the
 * "wall of Private" the user reported) — their sharing is share-by-default and managed via the answer + the
 * "Manage sharing" panel; an AI-INFERRED fact keeps a discreet per-fact `FactSharingControl` (you still need
 * a way to share a session/dream insight). `sourceRemoved` renders "original source removed."
 */
export function InsightCard({
  insight,
  subjectName,
  isOwn,
  sourceRemoved,
  aboutName,
  availableTypes,
}: {
  insight: Insight;
  subjectName: string;
  isOwn: boolean;
  sourceRemoved?: boolean;
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

  // A long portrait groups its facts into collapsible life-area sections (44 audit). Sensitive sections (any
  // restricted fact) start COLLAPSED so trauma/intimacy isn't on screen at a glance; everything else is open.
  const factGroups = groupFactsByArea(insight.facts, isOwn);
  const grouped = factGroups.length > 1 || factGroups[0]?.area !== null;
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(
    () =>
      new Set(
        factGroups
          .filter((g) => g.area !== null && g.facts.some((f) => f.restricted))
          .map((g) => g.area as string),
      ),
  );
  const toggleArea = (area: string): void =>
    setCollapsedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });

  /** One fact as a clean list row: text + inline tags, plus (AI-inferred only) the sharing + correction. */
  const renderFact = (fact: InsightFact): JSX.Element => (
    <li key={fact.id} className={styles.factItem}>
      <span className={styles.factText}>
        <Markdown
          inline
          size="sm"
          className={fact.flaggedInaccurate ? styles.flaggedText : undefined}
        >
          {fact.text}
        </Markdown>
        {fact.flaggedInaccurate ? <span className={styles.inlineTag}>marked not right</span> : null}
        {fact.retractedShareAt ? (
          <span
            className={styles.inlineTag}
            title="This fact was shared, then withdrawn when you marked it"
          >
            sharing withdrawn
          </span>
        ) : null}
        {isIntake && fact.restricted ? (
          <span className={styles.sensitiveTag} title="Sensitive — only your own coach uses this.">
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
        </span>
      ) : null}
    </li>
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
            <Text size="xs" tone="tertiary" className={styles.eyebrow}>
              {`${SOURCE_EYEBROW[insight.source]} · ${
                aboutName
                  ? `From ${aboutName}’s answers`
                  : isOwn
                    ? 'About you'
                    : `About ${subjectName}`
              }`}
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
            {/* A short insight (session/dream) is a plain list; a long portrait becomes COLLAPSIBLE life-area
                sections — expand on demand so 20+ facts aren't dumped at once, sensitive sections collapsed by
                default (44 audit, confirmed with the user 2026-06-24). */}
            {!grouped ? (
              <ul className={styles.factList}>{(factGroups[0]?.facts ?? []).map(renderFact)}</ul>
            ) : (
              factGroups.map((group) => {
                const area = group.area ?? 'More';
                const Icon = areaIcon(area);
                const sensitive = group.facts.some((f) => f.restricted);
                const open = !collapsedAreas.has(area);
                return (
                  <div key={area} className={styles.factGroup}>
                    <button
                      type="button"
                      className={styles.factGroupHead}
                      aria-expanded={open}
                      onClick={() => toggleArea(area)}
                    >
                      <Icon size={17} aria-hidden="true" className={styles.factGroupIcon} />
                      <span className={styles.factGroupName}>{area}</span>
                      {sensitive ? <span className={styles.factGroupPrivate}>private</span> : null}
                      <span className={styles.factGroupCount}>{group.facts.length}</span>
                      <ChevronDown
                        size={17}
                        aria-hidden="true"
                        className={open ? styles.chevOpen : styles.chev}
                      />
                    </button>
                    {open ? (
                      <ul className={styles.factList}>{group.facts.map(renderFact)}</ul>
                    ) : null}
                  </div>
                );
              })
            )}

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
