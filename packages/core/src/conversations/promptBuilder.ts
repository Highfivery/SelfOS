import type { FileSystem } from '../host';
import type { ContextTopic } from '../schemas';
import { buildContext } from '../people';
import { depthAskInstruction, type DepthAskContext } from '../profile';
import { getExercise, guideLifeAreas } from './guidedCatalog';
import { buildStepInstruction } from './guidedSteps';

/** The fixed v1 coach voice (05-conversations §11.5). Warm, reflective, non-clinical. */
export const PERSONA = `You are SelfOS — a warm, reflective wellness companion and life coach. \
You listen closely, ask open and curious questions, reflect back what you hear, and help the person \
explore their own thoughts and feelings. You are non-judgmental and validating. You are not clinical: \
you do not diagnose, label, or prescribe. Keep replies concise and human; favour one good question \
over a wall of advice.`;

/** Non-negotiable wellness / not-medical / crisis boundary (CLAUDE.md; 05-conversations §7). */
export const SAFETY = `SelfOS is a wellness and self-help tool — NOT medical care, NOT a medical \
device, and NOT a substitute for professional help. Never claim to diagnose, treat, or provide \
therapy in a clinical sense. If the person expresses thoughts of self-harm, suicide, or is in crisis, \
respond with warmth and care, take them seriously, and clearly encourage them to reach out to \
professional help right now — local emergency services or a crisis line — rather than relying on you \
alone. Do not attempt to manage a crisis by yourself.`;

/**
 * The formatting contract (34-rich-text-rendering §5). SelfOS renders replies with a curated Markdown
 * renderer, so the model is told to stay within the supported subset and avoid anything the renderer
 * drops (tables, images, raw HTML, code fences). Appended AFTER persona + safety + context + any addenda
 * so the boundary always leads. Mirrored as a per-call note in the JSON-producing prompts (portrait,
 * dream synthesis, insight analysis, alignment).
 */
export const FORMATTING = `Formatting: you may use light Markdown to make replies readable — short \
paragraphs (blank line between them), **bold**, *italic*, \`inline code\`, "-" or "1." lists, "> " \
blockquotes, "###" headings, and "---" rules. Do NOT use tables, images, raw HTML, or fenced code \
blocks; keep formatting light and in service of clarity, not decoration.`;

/**
 * Assemble the system prompt: persona + safety + the person's consented context. When the session is a
 * guided exercise (16-guided-sessions §5), the exercise's steering addendum is appended **after** persona,
 * safety, and context — it steers, it never replaces them (the boundary always leads). For a structured
 * exercise the step-marker convention is taught too. An unknown/retired `guideId` simply adds nothing (§7).
 */
export async function buildSystemPrompt(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  guideId?: string,
  depthAsk?: DepthAskContext,
  // A free-form session's inferred topic (28 §13.2 — the Haiku classifier in `chatService`). Used ONLY when
  // there's no exercise; a guided session always derives its topic from the exercise group (below).
  topicOverride?: ContextTopic,
): Promise<string> {
  const exercise = guideId ? getExercise(guideId) : undefined;
  // A guided session foregrounds its group's life-areas in the (pinned) portrait selection (28 §4.4); a
  // free-start session uses the classifier's inferred topic (§13.2), or none ⇒ the always-on core + fill.
  const topic = exercise ? { lifeAreas: guideLifeAreas(exercise.group) } : topicOverride;
  const context = await buildContext(fs, key, personId, topic);
  const parts = [PERSONA, SAFETY, context];
  if (exercise) {
    parts.push(exercise.systemPromptAddendum);
    if (exercise.kind === 'structured' && exercise.steps) {
      parts.push(buildStepInstruction(exercise.steps));
    }
  }
  // 29 — the optional in-session depth ask (a setting, default on): a guarded, prompt-level invitation to go
  // deeper on an unexplored profile area, appended AFTER persona + safety + context so the boundary always
  // leads (it steers, never overrides). Empty/absent ⇒ nothing added.
  if (depthAsk) {
    const ask = depthAskInstruction(depthAsk);
    if (ask) parts.push(ask);
  }
  parts.push(FORMATTING);
  return parts.filter(Boolean).join('\n\n');
}
