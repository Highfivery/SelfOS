import type { LifeArea } from '../../schemas';
import type { TestGroupId } from '../types';
import type { Bank } from './bank';
import type { SpineDimension } from './spine';

/**
 * 74-adaptive-tests §4.2 — the **adaptive** instrument contract. The deterministic sibling is
 * `TestDefinition` (spec 50); the two share the hub, the capability, the 18+ ack, the result→Insight bridge
 * and the Memory integration, and diverge on items, storage, scoring and cost.
 *
 * Adding Fantasy or Sex Sessions is a definition file here plus a bank — not a new engine. That is the whole
 * reason this is an engine rather than one bespoke test.
 */

/** The phases an instrument runs, in order. `bank` is deterministic + free; the rest are metered AI calls. */
export type AdaptivePhaseId = 'bank' | 'split' | 'lines' | 'probe' | 'scenario' | 'synthesis';

export interface AdaptiveTestDefinition {
  id: string;
  kind: 'adaptive';
  group: TestGroupId;
  title: string;
  instrument: string;
  blurb: string;
  framing: string;
  /** An ESTIMATE — an adaptive take has no item count until it is over. */
  estimatedMinutes: number;
  version: number;
  adult: boolean;
  sensitive: boolean;
  /** The Memory life-area the derived Insight is tagged with — drives the relevance gate (50 §5.4). */
  lifeArea: LifeArea;
  /** The inventory the deterministic phases work through. */
  bank: Bank;
  /** The FIXED scored dimensions the synthesis maps onto. It may never invent a key (74 §4.2). */
  spine: readonly SpineDimension[];
  phases: readonly AdaptivePhaseId[];
  /** Topic ids a completed take marks worked-through in the ask ledger (74 §5.6). */
  saturates: readonly string[];
  /** One line for the ledger's `gist` — what this take actually covered. */
  saturationGist: string;
  /** The summary line the derived Insight carries. Second person, matching the rest of Memory. */
  insightSummary: string;
}
