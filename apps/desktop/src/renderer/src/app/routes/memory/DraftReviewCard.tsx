import { useLayoutEffect, useRef, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import type { Insight, InsightFact, RelationshipType } from '@shared/schemas';
import {
  Banner,
  Button,
  ConfidenceChip,
  Markdown,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import { useInsightStore } from '../../../stores/insightStore';
import { SOURCE_EYEBROW } from './InsightCard';
import { SharePresetChip } from './SharePresetChip';
import { provenanceTarget } from './provenance';
import { currentSharePreset } from './sharePresets';
import styles from './Memory.module.css';

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

/**
 * One DRAFT insight in the review queue (65 §3.3). Compact + focused: the summary leads (long ones clamp with a
 * measured "Read more"), the paragraph-length facts scroll inside a capped region so the actions stay pinned,
 * and each AI-inferred fact carries an **inline "✕ not right"** (drops it before saving) plus its **own
 * tap-to-cycle share chip** — chosen per item, in LOCAL state, then written all at once at Keep & save (the
 * approve edit carries `{ id, text, shareable, shareableTypes }` per fact). "Edit" reveals inline text editing
 * of the summary + each fact; a `restricted` fact is never offered a share chip (own-only, structurally
 * blocked). Approving/discarding removes the draft from the store, which auto-advances the queue.
 */
export function DraftReviewCard({
  insight,
  aboutName,
  availableTypes,
  partnerName,
}: {
  insight: Insight;
  /** Who a sent-questionnaire draft is ABOUT (#129) — flips the chip to "About <name>". */
  aboutName?: string;
  availableTypes?: RelationshipType[];
  /** The active person's partner's name for the sharing note ("Partner lets <name>'s coach use that item"). */
  partnerName?: string;
}): JSX.Element {
  const approve = useInsightStore((s) => s.approve);
  const remove = useInsightStore((s) => s.remove);

  const [summary, setSummary] = useState(insight.summary);
  const [facts, setFacts] = useState<InsightFact[]>(insight.facts);
  const [editing, setEditing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryOverflows, setSummaryOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = summaryRef.current;
    if (!el) return undefined;
    const measure = (): void => {
      if (summaryOpen || editing) return;
      setSummaryOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [summaryOpen, editing, insight.summary]);

  const prov = provenanceTarget(insight);
  const aboutWhom = aboutName ?? 'you';
  const partner = partnerName ?? 'your partner';

  // Whether any fact is currently shared with a partner-type person — drives the context-aware note.
  const anyPartnerShared = facts.some(
    (f) => !f.restricted && currentSharePreset(f, availableTypes) !== 'private',
  );

  const dropFact = (id: string): void => setFacts((fs) => fs.filter((f) => f.id !== id));
  const setFactText = (id: string, text: string): void =>
    setFacts((fs) => fs.map((f) => (f.id === id ? { ...f, text } : f)));
  const setFactScope = (id: string, types: RelationshipType[]): void =>
    setFacts((fs) =>
      fs.map((f) => (f.id === id ? { ...f, shareable: false, shareableTypes: types } : f)),
    );

  const edit = {
    subjectPersonId: insight.subjectPersonId,
    id: insight.id,
    summary,
    facts: facts.map((f) => ({
      id: f.id,
      text: f.text,
      shareable: f.shareable,
      // Own a sensitive (restricted) fact stays own-only — never send a scope for it (44 §3.4).
      ...(f.restricted ? {} : { shareableTypes: f.shareableTypes ?? [] }),
    })),
  };

  // On success the store's load() drops this draft → the card unmounts (the queue auto-advances). Only a
  // FAILURE (write threw before removal) keeps the card mounted, where its own Banner shows the error.
  const guard = async (fn: () => Promise<unknown>, message: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError(message);
      setBusy(false);
    }
  };

  const onKeep = (): Promise<void> =>
    guard(() => approve(edit), 'Couldn’t save that insight. Please try again.');
  const onDiscard = (): Promise<void> =>
    guard(
      () => remove({ subjectPersonId: insight.subjectPersonId, id: insight.id }),
      'Couldn’t discard that insight. Please try again.',
    );

  return (
    <Stack gap={3}>
      {insight.crisisFlag ? (
        <Banner tone="danger">
          This may reflect distress. Be gentle — if anyone is in immediate danger, call your local
          emergency number; in the US &amp; Canada call or text <strong>988</strong>.
        </Banner>
      ) : null}

      {/* Header: source + who it's about + confidence, then the linked source (65 §3.3). */}
      <div className={styles.reviewHead}>
        <div className={styles.eyebrowRow}>
          <span className={styles.sourcePill}>{SOURCE_EYEBROW[insight.source]}</span>
          <span
            className={`${styles.aboutChip} ${aboutName ? styles.aboutOther : styles.aboutSelf}`}
          >
            About {aboutWhom}
          </span>
          <ConfidenceChip
            level={insight.confidence}
            {...(insight.confidenceRationale ? { rationale: insight.confidenceRationale } : {})}
          />
        </div>
        <Text size="xs" tone="tertiary" className={styles.provStatic}>
          {prov.label} · {formatDate(insight.provenance.at)}
        </Text>
      </div>

      {/* Summary — leads; clamps with a measured "Read more" (or a Textarea in Edit mode). */}
      {editing ? (
        <Textarea
          rows={3}
          value={summary}
          aria-label="Insight summary"
          onChange={(event) => setSummary(event.target.value)}
        />
      ) : summary ? (
        <div>
          <div
            ref={summaryRef}
            className={`${styles.insightSummary} ${summaryOpen ? '' : styles.insightSummaryClamp}`}
          >
            <Markdown>{summary}</Markdown>
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

      {/* Facts scroll inside a capped region so the actions stay pinned (the one intentional inner scroll). */}
      {facts.length > 0 ? (
        <ul className={styles.reviewFacts}>
          {facts.map((fact) => (
            <li key={fact.id} className={styles.reviewFactRow}>
              <div className={styles.reviewFactMain}>
                {editing ? (
                  <Textarea
                    rows={1}
                    value={fact.text}
                    aria-label={`Edit fact: ${fact.text}`}
                    onChange={(event) => setFactText(fact.id, event.target.value)}
                  />
                ) : (
                  <Markdown inline size="sm">
                    {fact.text}
                  </Markdown>
                )}
                {fact.restricted ? (
                  <span
                    className={styles.sensitiveTag}
                    title="Sensitive — only your own coach uses this."
                  >
                    <ShieldAlert size={11} aria-hidden="true" /> private
                  </span>
                ) : null}
              </div>
              <div className={styles.reviewFactActions}>
                {!fact.restricted ? (
                  <SharePresetChip
                    insightId={insight.id}
                    subjectPersonId={insight.subjectPersonId}
                    fact={fact}
                    disabled={busy}
                    onChange={(types) => setFactScope(fact.id, types)}
                    {...(availableTypes ? { availableTypes } : {})}
                  />
                ) : null}
                <button
                  type="button"
                  className={styles.dropFact}
                  aria-label={`Not right — drop: ${fact.text}`}
                  title="Not right — leave this out"
                  disabled={busy}
                  onClick={() => dropFact(fact.id)}
                >
                  <X size={13} aria-hidden="true" /> not right
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Text size="sm" tone="tertiary">
          No details to keep — you can still save the summary, or discard.
        </Text>
      )}

      {anyPartnerShared ? (
        <Text size="xs" tone="tertiary">
          Sharing lets {partner}’s coach draw on that item — never shown to {partner} as raw
          answers. Tap a chip to change who each item can inform.
        </Text>
      ) : null}

      {error ? <Banner tone="warning">{error}</Banner> : null}

      <div className={styles.reviewActions}>
        <Button variant="primary" onClick={() => void onKeep()} disabled={busy}>
          Keep &amp; save
        </Button>
        <Button variant="secondary" onClick={() => setEditing((v) => !v)} disabled={busy}>
          {editing ? 'Done editing' : 'Edit'}
        </Button>
        <span className={styles.reviewActionsSpacer} />
        <Button variant="ghost" onClick={() => void onDiscard()} disabled={busy}>
          Discard
        </Button>
      </div>
    </Stack>
  );
}
