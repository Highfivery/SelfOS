import type { LifeArea, Question } from '../schemas';

/**
 * 50-self-assessments §4.2 — the curated `TestDefinition` contract (CODE, not vault — the `guidedCatalog`
 * pattern). Display metadata is importable by the renderer; the scoring spec is consumed by the deterministic
 * engine (`scoring.ts`). Items reuse the questionnaire `Question` shape so we never fork a second item model.
 */

export type TestGroupId = 'personality' | 'relationships' | 'intimacy' | 'wellbeing';

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

  // --- 51-wellbeing-neurodivergence-reflections additions (additive; a spec-50 personality test omits them) ---

  /** This instrument is a wellbeing/neurodivergence reflection (51). Drives the "Reflections & check-ins" hub
   *  group, the stronger non-diagnostic result copy (§3.3/§8.1 — a gentle range from {@link bands}, never the
   *  clinical label), and the always-present professional-help line. Personality tests leave it unset. */
  wellbeing?: boolean;
  /** Item / matrix-row ids that, when answered at/above `atOrAbove`, raise the result's `crisisFlag`
   *  IMMEDIATELY (mid-check-in, §5.2/§8.2) — PHQ-9's item 9 is the canonical case. Deterministic + AI-free.
   *  Multiple allowed. Omitted ⇒ no item-level trigger (only an overall-band trigger, if any, applies). */
  crisisItems?: CrisisItem[];
  /** The internal clinical band thresholds (kept on the result as `clinicalKey`, NEVER shown clinically).
   *  Each maps a raw total ≤ `upToRaw` → an INTERNAL `clinicalKey` + a non-diagnostic `display` copy; the
   *  highest band(s) may set `crisis: true` to raise `crisisFlag` on a high overall score (§5.2). The first
   *  band (ascending `upToRaw`) whose bound covers the raw total wins. */
  bands?: WellbeingBand[];
  /** The required instrument licence attribution shown on intro + result for transparency (§8.1). For
   *  WHO/ARC instruments (ASRS/AQ/RAADS) this carries the mandatory copyright / citation notice. */
  attribution?: string;
  /** The Memory life-area the derived Insight is tagged with (drives grouping + the never-narrow-distress
   *  rules, §5.4). Wellbeing mood/anxiety → 'Emotions & patterns'; ADHD/autism → 'Health & body'. Falls back
   *  to the group default when unset. */
  lifeArea?: LifeArea;
}

/** A crisis trigger: a question id OR a matrix row key that, answered at/above `atOrAbove`, flags the result. */
export interface CrisisItem {
  /** A standalone question id OR a matrix ROW KEY (PHQ-9 item 9 is a matrix row). */
  questionId: string;
  /** The (inclusive) threshold on the item's numeric scale — e.g. 1 on PHQ-9's 0..3 (any non-"Not at all"). */
  atOrAbove: number;
}

/** An internal clinical band → a non-diagnostic display copy (§4.2/§8.1). `clinicalKey` is NEVER shown. */
export interface WellbeingBand {
  /** Inclusive upper bound of the raw total for this band. */
  upToRaw: number;
  /** INTERNAL only — e.g. 'minimal' | 'mild' | 'moderate' | 'moderately-severe' | 'severe'. Drives trends. */
  clinicalKey: string;
  /** The NON-diagnostic, plain-language copy shown to the person (§3.3/§8.1). */
  display: string;
  /** A high overall band that should also raise `crisisFlag` (§5.2) — e.g. PHQ-9 'severe'. */
  crisis?: boolean;
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

  // --- 51 wellbeing display metadata (crypto-free; the renderer never sees the scoring spec) ---
  /** A wellbeing/neurodivergence reflection (51): the hub's "Reflections & check-ins" group + the gentle-range
   *  result handling + the always-present professional-help line. */
  wellbeing: boolean;
  /** The instrument licence attribution shown for transparency (§8.1) — absent for non-wellbeing tests. */
  attribution?: string;
  /** clinicalKey → the non-diagnostic display copy (§3.3/§8.1). The result screen maps a wellbeing result's
   *  internal `band` (clinicalKey) → this gentle sentence; the clinical key itself is never shown. */
  bandDisplays?: Record<string, string>;
  /** Crisis trigger items (§5.2) — the renderer evaluates these mid-check-in to escalate the crisis surface
   *  immediately when PHQ-9 item 9 is answered positive. References question ids / matrix row keys. */
  crisisItems?: CrisisItem[];
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
    wellbeing: def.wellbeing ?? false,
    ...(def.attribution !== undefined ? { attribution: def.attribution } : {}),
    ...(def.bands
      ? {
          bandDisplays: Object.fromEntries(
            def.bands.map((band) => [band.clinicalKey, band.display]),
          ),
        }
      : {}),
    ...(def.crisisItems ? { crisisItems: def.crisisItems } : {}),
  };
}

export const TEST_GROUP_LABELS: Record<TestGroupId, string> = {
  personality: 'Personality',
  relationships: 'Relationships',
  intimacy: 'Intimacy & sexuality',
  wellbeing: 'Reflections & check-ins',
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
