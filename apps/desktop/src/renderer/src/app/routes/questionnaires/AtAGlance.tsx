import type { QuestionAggregate, QuestionnaireAggregate } from '@shared/schemas';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Questionnaires.module.css';

/** A horizontal count bar (choice distribution) — the count is shown as text, never colour-only (§9). */
function DistBar({
  label,
  count,
  max,
}: {
  label: string;
  count: number;
  max: number;
}): JSX.Element {
  const width = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className={styles.glanceRow}>
      <span className={styles.glanceLabel}>{label}</span>
      <span className={styles.glanceTrack}>
        <span className={styles.glanceFill} style={{ width: `${width}%` }} />
      </span>
      <span className={styles.glanceValue}>{count}</span>
    </div>
  );
}

/** An average bar within a min→max scale — the value is shown as text. */
function AvgBar({
  label,
  average,
  min,
  max,
}: {
  label: string;
  average: number;
  min: number;
  max: number;
}): JSX.Element {
  const span = max - min;
  const width = span > 0 ? Math.round(((average - min) / span) * 100) : 0;
  return (
    <div className={styles.glanceRow}>
      <span className={styles.glanceLabel}>{label}</span>
      <span className={styles.glanceTrack}>
        <span
          className={styles.glanceFill}
          style={{ width: `${Math.max(0, Math.min(100, width))}%` }}
        />
      </span>
      <span className={styles.glanceValue}>{average}</span>
    </div>
  );
}

type Of<K extends QuestionAggregate['kind']> = Extract<QuestionAggregate, { kind: K }>;

const respondents = (n: number): string => `${n} ${n === 1 ? 'response' : 'responses'}`;

function DistributionBody({ q }: { q: Of<'distribution'> }): JSX.Element {
  const max = Math.max(1, ...q.options.map((o) => o.count));
  return (
    <Stack gap={1}>
      {q.options.map((o) => (
        <DistBar key={o.label} label={o.label} count={o.count} max={max} />
      ))}
    </Stack>
  );
}

function Body({ q }: { q: QuestionAggregate }): JSX.Element {
  switch (q.kind) {
    case 'distribution':
      return <DistributionBody q={q} />;
    case 'average':
      return (
        <Stack gap={1}>
          <AvgBar label="Average" average={q.average} min={q.min} max={q.max} />
          <Text size="sm" tone="tertiary">
            {respondents(q.responseCount)} · scale {q.min}–{q.max}
          </Text>
        </Stack>
      );
    case 'rows':
      return (
        <Stack gap={1}>
          {q.rows.map((r) => (
            <AvgBar key={r.label} label={r.label} average={r.average} min={q.min} max={q.max} />
          ))}
          <Text size="sm" tone="tertiary">
            {respondents(q.responseCount)} · scale {q.min}–{q.max}
          </Text>
        </Stack>
      );
    case 'allocation':
      return (
        <Stack gap={1}>
          {q.rows.map((r) => (
            <div key={r.label} className={styles.glanceRow}>
              <span className={styles.glanceLabel}>{r.label}</span>
              <span className={styles.glanceTrack}>
                <span
                  className={styles.glanceFill}
                  style={{ width: `${Math.max(0, Math.min(100, Math.round(r.average)))}%` }}
                />
              </span>
              <span className={styles.glanceValue}>{r.average}</span>
            </div>
          ))}
          <Text size="sm" tone="tertiary">
            {respondents(q.responseCount)} · average points (of 100)
          </Text>
        </Stack>
      );
    case 'count':
      // Free-text / date / ranking — a bare response count, never the content.
      return (
        <Text size="sm" tone="secondary">
          {respondents(q.responseCount)}
        </Text>
      );
  }
}

function QuestionCard({ q }: { q: QuestionAggregate }): JSX.Element {
  return (
    <Card>
      <Stack gap={2}>
        <Text weight={500}>{q.prompt}</Text>
        <Body q={q} />
      </Stack>
    </Card>
  );
}

/**
 * The cross-recipient "At a glance" band (08-questionnaires §20.7): per-question distributions/averages/
 * counts across everyone. Never the raw written answers — a Private send's categorical selection is only
 * counted, its numeric values fold into the averages (§8.4).
 */
export function AtAGlance({
  aggregate,
}: {
  aggregate: QuestionnaireAggregate;
}): JSX.Element | null {
  if (aggregate.questions.length === 0) return null;
  return (
    <Stack gap={3}>
      <Heading level={3}>At a glance</Heading>
      <Text size="sm" tone="secondary">
        Across everyone who answered — never anyone’s written answers. Private responses aren’t
        included here.
      </Text>
      {aggregate.questions.map((q) => (
        <QuestionCard key={q.questionId} q={q} />
      ))}
    </Stack>
  );
}
