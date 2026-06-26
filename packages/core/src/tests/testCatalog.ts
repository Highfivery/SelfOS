import { AQ10 } from './instruments/aq10';
import { ASRS } from './instruments/asrs';
import { ATTACHMENT } from './instruments/attachment';
import { BIG_FIVE } from './instruments/bigFive';
import { GAD7 } from './instruments/gad7';
import { KINK_INTERESTS } from './instruments/kink';
import { PHQ9 } from './instruments/phq9';
import { RAADS_R } from './instruments/raadsR';
import { SEXUALITY } from './instruments/sexuality';
import { testSummary, type TestDefinition, type TestSummary } from './types';

/**
 * 50-self-assessments §4.2/§5.2 + 51-wellbeing-neurodivergence-reflections §5.1 — the curated catalog of
 * self-assessment instruments (CODE, not vault — the `guidedCatalog` pattern). The spec-50 battery (Big Five
 * IPIP-120, attachment ECR-R 36, sexuality & orientation Kinsey/Klein, the kink & intimacy-interests
 * inventory) plus the spec-51 wellbeing/neurodivergence reflections (PHQ-9 mood, GAD-7 anxiety, ASRS v1.1
 * focus, AQ-10 + RAADS-R social/sensory). Adding an instrument is a code change here + new scoring vectors,
 * never a vault edit.
 */
export const TEST_CATALOG: readonly TestDefinition[] = [
  BIG_FIVE,
  ATTACHMENT,
  SEXUALITY,
  KINK_INTERESTS,
  // 51 — wellbeing & neurodivergence reflections. NOT adult-gated (§3.1); crisis-routed (§8.2).
  PHQ9,
  GAD7,
  ASRS,
  AQ10,
  RAADS_R,
];

/** One definition by id, or undefined. */
export function getTest(testId: string): TestDefinition | undefined {
  return TEST_CATALOG.find((test) => test.id === testId);
}

/**
 * The catalog's crypto-free display metadata (what `tests:list` returns). When `adultAcknowledged` is false
 * the **adult** instruments are filtered out (the bridge resolves the flag, §3.5) so an un-acked person never
 * receives the sensitive cards/items — withheld at the trust boundary, not just hidden in the UI.
 */
export function listTestSummaries(adultAcknowledged: boolean): TestSummary[] {
  return TEST_CATALOG.filter((test) => adultAcknowledged || !test.adult).map(testSummary);
}
