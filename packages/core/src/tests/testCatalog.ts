import { ATTACHMENT } from './instruments/attachment';
import { BIG_FIVE } from './instruments/bigFive';
import { KINK_INTERESTS } from './instruments/kink';
import { SEXUALITY } from './instruments/sexuality';
import { testSummary, type TestDefinition, type TestSummary } from './types';

/**
 * 50-self-assessments §4.2/§5.2 — the curated catalog of self-assessment instruments (CODE, not vault — the
 * `guidedCatalog` pattern). The first battery of four: Big Five (IPIP-120), attachment (ECR-R 36), sexuality
 * & orientation (Kinsey/Klein), and the original kink & intimacy-interests inventory. Adding an instrument is
 * a code change here + new scoring vectors, never a vault edit.
 */
export const TEST_CATALOG: readonly TestDefinition[] = [
  BIG_FIVE,
  ATTACHMENT,
  SEXUALITY,
  KINK_INTERESTS,
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
