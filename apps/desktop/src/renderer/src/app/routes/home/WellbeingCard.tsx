import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card, Heading, LineChart, Stack } from '../../../design-system/components';
import type { MoodPoint } from './wellbeing';
import { wellbeingRead } from './wellbeing';
import styles from './Home.module.css';

/**
 * "Wellbeing" — a gentle look at the mood signal from analyzed sessions (09 §14), as a two-series line
 * (valence + energy, −1..1). Framed plainly, never clinically (§7): a deterministic one-line read and a
 * not-medical line. Hidden until there are ≥2 analyzed sessions. The recurring-distress supportive banner
 * lives at the Home level (40 §3.5 `CrisisSupportBanner`) so it can show even without a mood chart.
 */
export function WellbeingCard({ points }: { points: MoodPoint[] }): JSX.Element | null {
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
