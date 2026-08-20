import { z } from 'zod';

import {
  extractJsonArray,
  extractJsonObject,
  salvageJsonArray,
  tolerantArray,
} from '../ai/jsonSalvage';
import { LIFE_AREAS, type RelationshipType, type SensitivityTier } from '../schemas';
import { runClaude, type AiDeps } from './aiCall';
import { INTIMACY_TYPE, SCENARIO_TYPE, relationshipFraming, SAFETY } from './aiPrompts';
import { QUESTIONNAIRE_TYPE_LIFE_AREAS } from './questionnaireTopic';
import type { TopicStatus } from './topicMap';

/**
 * The **planning pass** (spec 71 §5.5) — decide WHAT ground a questionnaire should open, before generation
 * writes any questions.
 *
 * Why this is a separate call rather than more instructions in the generation prompt: the reported failure was
 * a generation prompt that had grown to 8,412 chars of which roughly HALF was steering, some of it directly
 * contradictory — a candidate feed saying "draw generation PRIMARILY from these" (general life questions) and
 * a coverage block saying "put MOST questions on Friendships", both placed AFTER, and therefore outranking,
 * the unfiltered explicit register (spec 71 §1 D1/D2). The model was arbitrating instructions instead of
 * writing. Splitting the decision out means generation receives only the CHOSEN THREADS + the register + who
 * the recipient is — a short, focused, uncontradicted prompt.
 *
 * The planner emits **threads, not finished questions** (owner decision 2026-08-12). Handing the model a
 * polished stored question is exactly what produced the near-verbatim repeat the member reported; a thread
 * says what ground to open and lets generation write it fresh, at the right tier.
 *
 * FAIL-SAFE: this never hard-fails a draft. On AI-off / over-budget / an unparseable reply it falls back to a
 * deterministic plan derived from the open topics, flagged `degraded`, and generation proceeds.
 */

/**
 * Which life areas a questionnaire of this type + tier may draw ground from (spec 71 §5.5).
 *
 * TIER-AWARE on purpose. `QUESTIONNAIRE_TYPE_LIFE_AREAS` maps intimacy to `['Intimacy', 'Relationships']`,
 * which is right for the gentle tier (connection, closeness) but is precisely how "Friendships" — a
 * Relationships topic — ended up leading an UNFILTERED set. At the explicit tiers the register is about sex,
 * so the ground is Intimacy alone.
 */
export function steeringLifeAreas(type: string, tier: SensitivityTier): readonly string[] {
  const sensitive = type === INTIMACY_TYPE || type === SCENARIO_TYPE;
  if (sensitive && (tier === 'explicit' || tier === 'unfiltered')) return ['Intimacy'];
  const mapped = QUESTIONNAIRE_TYPE_LIFE_AREAS[type];
  return mapped && mapped.length > 0 ? mapped : LIFE_AREAS;
}

/** One piece of ground to open, with the angle to come at it from. */
export interface PlanThread {
  /** An existing topic id when the planner picked known ground; absent when it named something new. */
  topicId?: string;
  label: string;
  lifeArea?: string;
  /** What specifically to ask about — the angle, not a question. */
  angle: string;
}

export interface PlanResult {
  threads: PlanThread[];
  /** True when the AI pass produced no usable plan and the deterministic fallback was used. */
  degraded: boolean;
  usage?: { costUsd: number } | undefined;
}

const ThreadSchema = z.object({
  topicId: z.string().optional(),
  label: z.string().min(1),
  lifeArea: z.string().optional(),
  angle: z.string().catch('').default(''),
});
const THREAD_SENTINEL: z.infer<typeof ThreadSchema> = { label: '', angle: '' };

const PlanSchema = z.object({
  threads: tolerantArray(ThreadSchema, THREAD_SENTINEL, (t) => t.label.trim() !== ''),
});

export const PLAN_SYSTEM = `${SAFETY}

You PLAN a questionnaire: you decide what ground it should open, and you do NOT write the questions. Another pass writes them from your plan.

Return ONLY a JSON object: {"threads": [{"topicId": string (optional — use ONLY an id given to you), "label": string (short name for the ground), "lifeArea": string (optional), "angle": string (one sentence: the specific, concrete angle to come at it from)}]}.

Rules:
- Open ground that is genuinely NEW for this person, or a genuinely fresh angle on ground that is still open. NEVER pick ground listed as already worked through or cooling down.
- You may and SHOULD NAME NEW GROUND that isn't in the list you were given. The list is a starting vocabulary, not a menu — if this person's material points at something it has no name for, invent a label for it. Real ground is often narrower and more specific than any built-in category: a particular dynamic, a recurring situation, a specific act or combination, who initiates, a context or setting, a feeling that keeps showing up around it. Naming a new area is a better answer than stretching an existing one, and it is the main way this gets sharper over time.
- Every thread must fit the questionnaire's stated type and register. Do NOT drift to an unrelated part of their life to find novelty.
- An angle is specific ("what she wants done and how far, and what makes it feel safe rather than scary"), never a restatement of the topic name.
- Prefer ground where past answers were substantive over ground the person keeps skipping.
- Return between 1 and the requested number of threads. Fewer genuinely-new threads is better than padding with ground already worked.`;

export function buildPlanUserMessage(input: {
  type: string;
  sensitivity: SensitivityTier;
  count: number;
  brief?: string;
  recipient?: {
    name?: string;
    pronouns?: string;
    relationship?: { type: RelationshipType; closeness?: number };
  };
  statuses: readonly TopicStatus[];
  requestedLabels?: readonly string[];
  feedbackGuidance?: string;
  /** 74 §5.8a — the recipient's hard nos. The plan's `angle` is read by the person on the Explored tab. */
  suppressed?: readonly string[];
  registerNote?: string;
}): string {
  const parts: string[] = [
    `Plan up to ${input.count} threads for a "${input.type}" questionnaire (sensitivity: ${input.sensitivity}).`,
  ];
  const r = input.recipient;
  if (r?.name?.trim()) {
    parts.push(
      `\nIt is FOR ${r.name.trim()}${r.pronouns?.trim() ? ` (${r.pronouns.trim()})` : ''}.`,
    );
  }
  if (r?.relationship)
    parts.push(relationshipFraming(r.relationship.type, r.relationship.closeness));
  if (input.registerNote?.trim()) parts.push(`\n${input.registerNote.trim()}`);
  const focus = input.brief?.trim();
  if (focus) {
    parts.push(
      `\nFOCUS — the whole questionnaire is about: ${focus}\nEvery thread must serve this focus.`,
    );
  }
  if (input.requestedLabels?.length) {
    parts.push(
      `\nThey have EXPLICITLY asked to explore these — lead with them:\n${input.requestedLabels
        .map((l) => `- ${l}`)
        .join('\n')}`,
    );
  }
  const open = input.statuses.filter((s) => s.open);
  const blocked = input.statuses.filter((s) => !s.open);
  if (open.length) {
    parts.push(
      `\nGROUND STILL OPEN (id · label · asked so far · how well past answers landed):\n${open
        .map(
          (s) =>
            `- ${s.topic.topicId} · ${s.topic.label} · asked ${s.stats.askedCount}× · ${
              s.stats.richCount > 0
                ? `${s.stats.richCount} substantive answers`
                : 'no substantive answers yet'
            }`,
        )
        .join('\n')}`,
    );
  }
  if (blocked.length) {
    parts.push(
      `\nOFF-LIMITS THIS TIME — worked through, cooling down, or repeatedly skipped. Do NOT plan a thread on any of these, even from a new angle:\n${blocked
        .map((s) => `- ${s.topic.label}${s.saturatedByQuality ? ' (they keep skipping this)' : ''}`)
        .join('\n')}`,
    );
  }
  // The escape valve, and the point of an emergent vocabulary: when the named map is exhausted the answer is
  // to NAME SOMETHING NEW, never to re-mine. Without this the planner would simply return nothing on a person
  // with a long history — which is how the old engine ended up re-asking instead.
  if (open.length === 0) {
    parts.push(
      `\nEvery named area is worked through or cooling down. You MUST name genuinely NEW ground that is not in the list above — a specific strand of this subject their material points at but that has never been given a name. Do not fall back to any listed area.`,
    );
  }
  if (input.feedbackGuidance?.trim()) parts.push(`\n${input.feedbackGuidance.trim()}`);
  // 74 §5.8a — their hard nos, unconditionally. The planner NAMES the ground and writes the `angle` that is
  // rendered to them on the Explored tab, so a thread must not be built out of a word they ruled out.
  if (input.suppressed?.length) {
    parts.push(
      `\nNEVER name ground, or write an angle, that uses or is about any of the following — these are their hard limits. Do not explain that you are avoiding anything: ${input.suppressed.join(' · ')}.`,
    );
  }
  parts.push(`\nReturn the JSON object with the "threads" array.`);
  return parts.filter((p) => p !== '').join('\n');
}

/**
 * A deterministic plan from the open topics — the fail-safe when the AI pass is unavailable or unusable.
 * Least-worked ground first, so it still steers away from repetition rather than dead-ending the draft.
 */
export function fallbackThreads(statuses: readonly TopicStatus[], count: number): PlanThread[] {
  return statuses
    .filter((s) => s.open)
    .sort((a, b) => a.stats.askedCount - b.stats.askedCount)
    .slice(0, count)
    .map((s) => ({
      topicId: s.topic.topicId,
      label: s.topic.label,
      lifeArea: s.topic.lifeArea,
      angle: '',
    }));
}

/** Plan the ground for one questionnaire. Never throws; never hard-fails a draft. */
export async function planQuestions(
  deps: AiDeps,
  request: Parameters<typeof buildPlanUserMessage>[0],
): Promise<PlanResult> {
  const fallback = (): PlanResult => ({
    threads: fallbackThreads(request.statuses, request.count),
    degraded: true,
  });
  const user = buildPlanUserMessage(request);
  const call = await runClaude(deps, PLAN_SYSTEM, user, 'questionnaire.plan', 1200);
  if (!call.ok) return fallback();
  const parsed = PlanSchema.safeParse(extractJsonObject(call.text));
  let threads = parsed.success ? parsed.data.threads : [];
  if (threads.length === 0) {
    // Tolerate a bare-array reply, and salvage a truncated one (37 §3.1).
    const whole = extractJsonArray(call.text);
    const raw = Array.isArray(whole) ? whole : salvageJsonArray(call.text);
    threads = tolerantArray(ThreadSchema, THREAD_SENTINEL, (t) => t.label.trim() !== '').parse(raw);
  }
  if (threads.length === 0) return { ...fallback(), usage: call.usage };
  // The planner may only reference topic ids it was actually given; a hallucinated id would tag ledger
  // entries against ground that doesn't exist. An unknown id degrades to a NEW topic proposal (by label).
  const known = new Set(request.statuses.map((s) => s.topic.topicId));
  const cleaned: PlanThread[] = threads.slice(0, request.count).map((t) => ({
    ...(t.topicId && known.has(t.topicId) ? { topicId: t.topicId } : {}),
    label: t.label.trim(),
    ...(t.lifeArea?.trim() ? { lifeArea: t.lifeArea.trim() } : {}),
    angle: t.angle.trim(),
  }));
  return { threads: cleaned, degraded: false, usage: call.usage };
}
