import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Banner, Card, Heading, LineChart, Stack } from '../../../design-system/components';
import type { MoodPoint } from './wellbeing';
import { wellbeingRead } from './wellbeing';
import styles from './Home.module.css';

/**
 * "Wellbeing" — a gentle look at the mood signal from analyzed sessions (09 §14), as a two-series line
 * (valence + energy, −1..1). Framed plainly, never clinically (§7): a deterministic one-line read, a
 * not-medical line, and — if a recent session flagged a concern — a supportive banner leading with
 * resources. Hidden until there are ≥2 analyzed sessions.
 */
export function WellbeingCard({
  points,
  crisis,
}: {
  points: MoodPoint[];
  crisis: boolean;
}): JSX.Element | null {
  const navigate = useNavigate();
  if (points.length < 2) return null;

  const read = wellbeingRead(points);
  const series = [
    { label: 'Mood', points: points.map((p, i) => ({ x: i, y: p.valence })) },
    { label: 'Energy', points: points.map((p, i) => ({ x: i, y: p.energy })) },
  ];

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2}>Wellbeing</Heading>
          <button type="button" className={styles.cardLink} onClick={() => navigate('/sessions')}>
            Your sessions
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>

        {crisis ? (
          <Banner tone="warning">
            Some recent sessions sounded heavy. If things feel like too much, you deserve support
            from someone who can help directly — call or text <strong>988</strong> (US &amp; Canada)
            or your local emergency services.
          </Banner>
        ) : null}

        <LineChart
          series={series}
          yMin={-1}
          yMax={1}
          ariaLabel={`Mood and energy across your last ${points.length} analyzed sessions. ${read}`}
        />

        {read ? <p className={styles.read}>{read}</p> : null}

        <p className={styles.notMedical}>
          A gentle reflection from your sessions — not a diagnosis or medical assessment.
        </p>
      </Stack>
    </Card>
  );
}
