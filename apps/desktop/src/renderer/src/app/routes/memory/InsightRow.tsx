import { ChevronRight } from 'lucide-react';
import type { Insight } from '@shared/schemas';
import { Markdown } from '../../../design-system/components';
import { ConfidenceDots } from './ConfidenceDots';
import type { ConfidenceLevel } from './overview';
import styles from './Memory.module.css';

const SOURCE_EYEBROW: Record<Insight['source'], string> = {
  intake: 'Onboarding',
  session: 'Session',
  dream: 'Dream',
  questionnaire: 'Questionnaire',
  test: 'Self-assessment',
  together: 'Together session',
};

const CONFIDENCE_LEVEL: Record<Insight['confidence'], ConfidenceLevel> = {
  low: 1,
  medium: 2,
  high: 3,
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

/**
 * A single clean insight row in a life-area drill-down (57 §3.2) — the summary (lead) + a meta line
 * (source · date · confidence dots) + a chevron. A button; clicking opens the insight detail (where the
 * edit / correct / scope controls live). No inline controls here — the overview stays scannable.
 */
export function InsightRow({
  insight,
  onOpen,
}: {
  insight: Insight;
  onOpen: () => void;
}): JSX.Element {
  const date = formatDate(insight.provenance.at);
  const lead = insight.summary.trim() || 'Untitled insight';
  return (
    <button
      type="button"
      className={styles.irow}
      onClick={onOpen}
      aria-label={`Open insight: ${lead}`}
    >
      <span className={styles.irowMain}>
        <Markdown inline className={styles.irowLead}>
          {lead}
        </Markdown>
        <span className={styles.irowMeta}>
          <span>{SOURCE_EYEBROW[insight.source]}</span>
          {date ? (
            <>
              <span className={styles.sep} aria-hidden="true">
                ·
              </span>
              <span>{date}</span>
            </>
          ) : null}
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          <ConfidenceDots level={CONFIDENCE_LEVEL[insight.confidence]} />
        </span>
      </span>
      <ChevronRight size={18} aria-hidden="true" className={styles.irowChev} />
    </button>
  );
}
