import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { SharePresetChip } from './SharePresetChip';
import { provenanceTarget } from './provenance';
import styles from './Memory.module.css';

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

export const SOURCE_EYEBROW: Record<Insight['source'], string> = {
  intake: 'Onboarding',
  session: 'Session',
  dream: 'Dream',
  questionnaire: 'Questionnaire',
  test: 'Self-assessment',
  together: 'Together session',
};

/** At or below this many facts, an insight shows its facts inline; above it, they collapse behind a
 * "N things SelfOS noted" disclosure so every card stays a compact, uniform height (65 §3.4). */
const FACT_INLINE_THRESHOLD = 3;

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
 * One insight on the Memory page (62-memory-insights-redesign / 65 §3.4, on 20/44/57). For the active
 * person's OWN insights it's **summary-first and compact**: the plain-language summary leads (long ones clamp
 * with "Read more"), and a heavy fact list **collapses behind a "N things SelfOS noted" disclosure** so every
 * card stays a uniform height. Each AI-inferred fact carries its own **tap-to-change sharing chip in the read
 * view**; editing a fact's text + flagging it ("this isn't right about me") live in **Edit mode** (the header
 * pencil), keeping the read view scannable. The footer balances **confidence (left) · date (right)**. For a
 * RELATED person's shared facts it's read-only (`isOwn = false`).
 *
 * Corrections split by source (44 §3.4): an ONBOARDING (`intake`) insight is what you told SelfOS — you fix it
 * by **editing the answer** (deep-link) or deleting, not by inline editing/flagging. `sourceRemoved` renders
 * "original source removed."
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
  /** Relationship types in the person's graph — offered by an AI-inferred fact's sharing chip (65 §3.4). */
  availableTypes?: RelationshipType[];
}): JSX.Element {
  const navigate = useNavigate();
  const approve = useInsightStore((s) => s.approve);
  const update = useInsightStore((s) => s.update);
  const remove = useInsightStore((s) => s.remove);
  const flag = useInsightStore((s) => s.flag);

  const isIntake = insight.source === 'intake';
  const isDraft = isOwn && !insight.approved;
  const [cardEditing, setCardEditing] = useState(isDraft);
  const [summary, setSummary] = useState(insight.summary);
  const [facts, setFacts] = useState<InsightFact[]>(insight.facts);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryOverflows, setSummaryOverflows] = useState(false);

  // Resync local edit state when the insight actually changes (a save bumps updatedAt; the card is reused by
  // `key` so useState doesn't re-run). Two cases:
  // - NOT editing: pull the whole insight in (the read view reflects background changes).
  // - Editing: a per-fact flag/scope action reloads the insight from the store mid-edit. MERGE that
  //   server-owned per-fact metadata (flag, sharing) into the in-progress edit BY ID — keeping the user's
  //   unsaved `text`/`summary` — and never force-close the editor, so using those controls can't discard
  //   unsaved edits (65 §3.4). The draft→approved close is handled explicitly in onApprove/onSave.
  useEffect(() => {
    if (cardEditing) {
      setFacts((local) =>
        local.map((lf) => {
          const server = insight.facts.find((f) => f.id === lf.id);
          return server ? { ...server, text: lf.text } : lf;
        }),
      );
      return;
    }
    setSummary(insight.summary);
    setFacts(insight.facts);
  }, [insight.updatedAt, insight.summary, insight.facts, cardEditing]);

  // "Read more" appears only when the clamped summary actually hides text — MEASURED (not a char count),
  // re-checked on resize since the card's grid column width changes with the window (65 §3.4, §7).
  useLayoutEffect(() => {
    const el = summaryRef.current;
    if (!el) return undefined;
    const measure = (): void => {
      if (summaryOpen) return; // nothing is clamped while expanded — keep the last collapsed reading
      setSummaryOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [summaryOpen, insight.summary, hideSummary]);

  const prov = provenanceTarget(insight);
  // Approve/edit carries only `{id, text, shareable}` — `updateInsight` merges by id, so the server-owned
  // `shareableTypes`/`restricted` stay intact (sharing is set separately via the per-fact chip, §3.4).
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
      if (await approve(edit)) setCardEditing(false);
      else setError('Couldn’t save that insight. Please try again.');
    }, 'Couldn’t save that insight. Please try again.');
  const onSave = (): Promise<void> =>
    guard(async () => {
      if (await update(edit)) setCardEditing(false);
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

  const cancelEdit = (): void => {
    setSummary(insight.summary);
    setFacts(insight.facts);
    setCardEditing(false);
  };

  const goToSource = (): void => navigate(prov.to, prov.state ? { state: prov.state } : undefined);

  // A long portrait groups its facts into collapsible life-area sections (44 audit). Sensitive sections (any
  // restricted fact) start COLLAPSED so trauma/intimacy isn't on screen at a glance.
  const factGroups = groupFactsByArea(insight.facts, isOwn);
  const grouped = factGroups.length > 1 || factGroups[0]?.area !== null;
  const collapseFacts = insight.facts.length > FACT_INLINE_THRESHOLD;

  const aboutIsOther = Boolean(aboutName) || !isOwn;
  const aboutWhom = aboutName ?? (isOwn ? 'you' : subjectName);

  const sourceEl =
    isOwn && !isIntake && !sourceRemoved ? (
      <button type="button" className={styles.provLink} onClick={goToSource} title={prov.label}>
        <span className={styles.provLabel}>{prov.label}</span>
        <ArrowUpRight size={12} aria-hidden="true" />
      </button>
    ) : (
      <Text size="xs" tone="tertiary" className={styles.provStatic}>
        {prov.label}
        {sourceRemoved ? ' · original source removed' : ''}
      </Text>
    );

  /** One fact as a read row: text + inline tags + (AI-inferred) the tap-to-change sharing chip (65 §3.4). */
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
      {isOwn && !isIntake && !fact.restricted && !fact.flaggedInaccurate ? (
        <span className={styles.factActions}>
          <SharePresetChip
            insightId={insight.id}
            subjectPersonId={insight.subjectPersonId}
            fact={fact}
            disabled={busy}
            {...(availableTypes ? { availableTypes } : {})}
          />
        </span>
      ) : null}
    </li>
  );

  const factList = (fs: InsightFact[]): JSX.Element => (
    <ul className={styles.factList}>{fs.map(renderFact)}</ul>
  );

  // The read-view facts, grouped for a long portrait, flat otherwise.
  const factsBody = !grouped ? (
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
                {sensitive ? <span className={styles.factGroupPrivate}>private</span> : null}
                <span className={styles.factGroupCount}>{group.facts.length}</span>
              </>
            }
          >
            {factList(group.facts)}
          </Collapsible>
        );
      })}
    </Stack>
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

        {/* Header: what produced this + who it's about + the edit pencil; then the linked source. */}
        <div className={styles.head}>
          <div className={styles.headMain}>
            <div className={styles.eyebrowRow}>
              <span className={styles.sourcePill}>{SOURCE_EYEBROW[insight.source]}</span>
              <span
                className={`${styles.aboutChip} ${aboutIsOther ? styles.aboutOther : styles.aboutSelf}`}
                title={`About ${aboutWhom}`}
              >
                About {aboutWhom}
              </span>
            </div>
            <div className={styles.contextRow}>{sourceEl}</div>
          </div>
          {isOwn && insight.approved && !isIntake && !cardEditing ? (
            <IconButton
              aria-label="Edit this insight"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setFacts(insight.facts);
                setSummary(insight.summary);
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
                  {/* Per-fact sharing (full picker for a custom scope) + flag live in Edit mode (65 §3.4). */}
                  {!isIntake && !fact.restricted && !fact.flaggedInaccurate ? (
                    <FactSharingControl
                      insightId={insight.id}
                      subjectPersonId={insight.subjectPersonId}
                      fact={fact}
                      disabled={busy}
                      {...(availableTypes ? { availableTypes } : {})}
                    />
                  ) : null}
                  {!isIntake ? (
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
                  ) : null}
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
            {/* Summary-first: the plain-language takeaway leads; a long one clamps with "Read more". */}
            {insight.summary && !hideSummary ? (
              <div>
                <div
                  ref={summaryRef}
                  className={`${styles.insightSummary} ${
                    summaryOpen ? '' : styles.insightSummaryClamp
                  }`}
                >
                  <Markdown>{insight.summary}</Markdown>
                </div>
                {summaryOverflows || summaryOpen ? (
                  <button
                    type="button"
                    className={styles.readMore}
                    aria-expanded={summaryOpen}
                    onClick={() => setSummaryOpen((v) => !v)}
                  >
                    {summaryOpen ? 'Read less' : 'Read more'}
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* Facts: inline when short; behind a "N things SelfOS noted" disclosure when heavy (65 §3.4). */}
            {insight.facts.length > 0 ? (
              collapseFacts ? (
                <Collapsible
                  header={
                    <span className={styles.factGroupName}>
                      {insight.facts.length} things SelfOS noted
                    </span>
                  }
                >
                  {factsBody}
                </Collapsible>
              ) : (
                factsBody
              )
            ) : null}

            {insight.categories.length > 0 ? (
              <div className={styles.metaRow}>
                {insight.categories.map((c) => (
                  <span key={c} className={styles.categoryTag}>
                    {c}
                  </span>
                ))}
              </div>
            ) : null}

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

            {/* Footer — confidence (left) · date (right); the date moved down from the header (65 §3.4). */}
            <div className={styles.cardFoot}>
              <ConfidenceChip
                level={insight.confidence}
                {...(insight.confidenceRationale ? { rationale: insight.confidenceRationale } : {})}
              />
              <span className={styles.cardFootSpacer} />
              <Text size="xs" tone="tertiary">
                {formatDate(insight.provenance.at)}
              </Text>
            </div>
          </>
        )}

        {error ? <Banner tone="warning">{error}</Banner> : null}
      </Stack>
    </Card>
  );
}
