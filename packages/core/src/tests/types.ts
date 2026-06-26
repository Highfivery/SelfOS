import type { Question } from '../schemas';

/**
 * 50-self-assessments §4.2 — the curated `TestDefinition` contract (CODE, not vault — the `guidedCatalog`
 * pattern). Display metadata is importable by the renderer; the scoring spec is consumed by the deterministic
 * engine (`scoring.ts`). Items reuse the questionnaire `Question` shape so we never fork a second item model.
 */

export type TestGroupId = 'personality' | 'relationships' | 'intimacy';

/** How a subscale's normalized value maps for charts + `Insight.metrics`: 0..1 (`'unit'`) or −1..1 (`'signed'`). */
export type NormalizeOut = 'unit' | 'signed';

export interface SubscaleSpec {
  /** Stable metric key, e.g. `'bigfive.neuroticism'`, `'ecr.anxiety'`, `'kink.power-exchange'`. */
  key: string;
  /** Human label, e.g. `'Neuroticism'`. */
  label: string;
  /** Combine the item contributions for this subscale into a raw value (§5.1). */
  aggregate: 'sum' | 'mean';
  /**
   * Item ids contributing to this subscale. A `-` prefix means the item is REVERSE-scored on the
   * definition's `scoring.scale` (`min + max − value`) — the classic IPIP/ECR-R correctness pitfall,
   * computed centrally in `scoreTest` and exhaustively tested (§10). An item id is a standalone question id
   * (rating/slider/singleChoice) OR a matrix row key.
   */
  items: string[]; // e.g. ['o1', '-o2', 'o3'] — '-o2' is reverse-keyed
  /** The raw range that maps onto the normalized output (default `'unit'` → 0..1). */
  normalize: { min: number; max: number; out?: NormalizeOut };
  /**
   * Short, non-pathologizing descriptor bands keyed by ascending normalized thresholds (§3.3/§8.1). The first
   * band whose `upTo` ≥ the normalized value wins. Plain labels ("leans toward …"), never a clinical verdict.
   */
  bands?: { upTo: number; label: string }[];
}

export interface ScoringSpec {
  /**
   * The deterministic scorer (§5.1). `'subscales'` covers IPIP + ECR-R + the kink inventory; `'kinsey'`/
   * `'klein'` are the spectrum scorers. No AI is ever involved. All three are pure arithmetic.
   */
  method: 'subscales' | 'kinsey' | 'klein';
  /** The Likert range the items use (e.g. 1..5 for IPIP, 1..7 for ECR-R). Drives reverse-scoring. */
  scale: { min: number; max: number };
  subscales: SubscaleSpec[];
}

export interface TestDefinition {
  /** Stable id, e.g. `'bigfive-ipip-120'`, `'ecr-r'`, `'kinsey-klein'`, `'kink-interests'`. */
  id: string;
  group: TestGroupId;
  title: string; // e.g. 'Big Five personality'
  /** The recognised instrument family, shown as a tag (e.g. 'IPIP', 'ECR-R'). */
  instrument: string;
  blurb: string; // one-line card description
  /** Non-diagnostic framing line shown on intro + result + any narrative (§8.1). */
  framing: string;
  estimatedMinutes: number;
  /** Content version — stamped onto a `TestResult.testVersion` at score time so an old result stays honest. */
  version: number;
  /** 18+ acknowledgement required (kink + sexuality) → gated by the shared ack (§3.5). */
  adult?: boolean;
  /** Sensitive results are written as `restricted` facts + relevance-gated (§3.4/§8.3). */
  sensitive?: boolean;
  /** The instrument's items — the questionnaire `Question` shape (08 §4.2). Mostly Likert (matrix/rating). */
  items: Question[];
  scoring: ScoringSpec;
}

/** Subscale display metadata (label + chart orientation) the result screen needs — never the scoring formula
 * (items / reverse-keys stay host-side). `signed` → a bipolar −1..1 bar; otherwise a 0..1 bar. */
export interface SubscaleMeta {
  key: string;
  label: string;
  signed: boolean;
}

/** Crypto-free display metadata for the catalog (what `tests:list` returns; the renderer never sees scoring). */
export interface TestSummary {
  id: string;
  group: TestGroupId;
  title: string;
  instrument: string;
  blurb: string;
  framing: string;
  estimatedMinutes: number;
  itemCount: number;
  adult: boolean;
  sensitive: boolean;
  /** Subscale labels + orientation so the result screen can render bars/trends without the scoring spec. */
  subscales: SubscaleMeta[];
}

export function testSummary(def: TestDefinition): TestSummary {
  const defaultSigned = def.scoring.method !== 'subscales';
  return {
    id: def.id,
    group: def.group,
    title: def.title,
    instrument: def.instrument,
    blurb: def.blurb,
    framing: def.framing,
    estimatedMinutes: def.estimatedMinutes,
    // The count of answerable items the person actually rates — a matrix's ROWS, not the matrix container
    // (so ECR-R reads "36 statements", not "2"). Branched items are counted (the full inventory size).
    itemCount: def.items.reduce(
      (n, q) => n + (q.type === 'matrix' && q.matrix ? q.matrix.rows.length : 1),
      0,
    ),
    adult: def.adult ?? false,
    sensitive: def.sensitive ?? false,
    subscales: def.scoring.subscales.map((sub) => ({
      key: sub.key,
      label: sub.label,
      signed: (sub.normalize.out ?? (defaultSigned ? 'signed' : 'unit')) === 'signed',
    })),
  };
}

export const TEST_GROUP_LABELS: Record<TestGroupId, string> = {
  personality: 'Personality',
  relationships: 'Relationships',
  intimacy: 'Intimacy & sexuality',
};

/** What `tests:get` returns to the Take screen: the summary + the items to render (never the scoring spec). */
export interface TestForm extends TestSummary {
  items: Question[];
}

export function testForm(def: TestDefinition): TestForm {
  return { ...testSummary(def), items: def.items };
}

/** The renderer-facing narrate result (the deterministic profile always renders; only this needs AI). `costUsd`
 * is present **only for admins** (`budgets.manage`), redacted at the bridge (the 06 admin-only-`$` rule). */
export type TestNarrateResponse =
  | { ok: true; text: string; costUsd?: number }
  | { ok: false; reason: 'NO_KEY' | 'AI_OFF' | 'BUDGET' | 'ERROR'; message: string };
