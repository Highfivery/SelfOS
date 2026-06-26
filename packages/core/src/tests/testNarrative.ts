import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import type { TestResult, UsageEvent } from '../schemas';
import { costOf, recordUsage } from '../usage';
import type { TestDefinition } from './types';

/**
 * 50-self-assessments §3.3/§6 — the OPTIONAL "what this means for you" narrative. Explicitly user-triggered
 * (never auto-run), metered `test.narrate`, budget-gated by the caller. The input is the DETERMINISTIC subscale
 * scores + bands + the instrument's framing — never the raw item answers. Warm, non-diagnostic, leads with the
 * not-medical framing (and, when crisis-flagged, resources). The narrative MAY name specifics, incl. for a
 * sensitive instrument (50 §11 Q5), while keeping the consensual-adult boundary. Returns plain prose (no JSON →
 * no parse), so a paid call's text is returned as-is; only AI-unavailable/budget/error are typed envelopes.
 */

const NARRATIVE_GUIDANCE = `The person just completed a self-assessment. Below are their deterministic \
subscale scores (already computed — do NOT re-score) with plain descriptor bands. Write a short, warm, \
plain-language reflection (3–5 short paragraphs max) on what the pattern might mean for them day to day.

Rules:
- This is a REFLECTION, not a verdict or a diagnosis. Never pathologize. Frame every trait as self-knowledge.
- You MAY name the specific dimensions and where they lean. Be concrete and kind, not clinical.
- Open by reminding them this is a snapshot of how they answered today, not a label.
- Do NOT invent scores or claim certainty the data doesn't support. Use the bands given.
- End with one gentle, optional next step they could explore — never a prescription.`;

const CRISIS_LEAD = `IMPORTANT: this result is flagged for possible distress. Lead with warmth and concern, \
and point them to professional support and a crisis line before anything else.`;

const ADULT_BOUNDARY = `This is a consensual-adult intimacy self-assessment. Keep everything within consensual \
adults; never reference minors, real non-consent, or illegal acts. Treat their interests as private and valid.`;

const WELLBEING_BOUNDARY = `This is a non-diagnostic WELLBEING REFLECTION, not a clinical screening. Hard rules \
(51-wellbeing-neurodivergence-reflections §8):
- NEVER name a diagnosis or condition (do not say "depression", "anxiety disorder", "ADHD", or "autism"), and \
NEVER say "you have" or "you are". Reflect on patterns and feelings, never label.
- Use the gentle band given; do not invent a severity. Stay warm, plain, and non-pathologizing.
- This is a reflection, not a medical opinion. END by gently encouraging them that talking to a professional — a \
doctor or therapist — can offer support a self-help tool can't.`;

function scoreDigest(def: TestDefinition, result: TestResult): string {
  const labelOf = new Map(def.scoring.subscales.map((sub) => [sub.key, sub.label]));
  // For a WELLBEING result the score's `band` is the INTERNAL clinicalKey (kept for trends/crisis only); it
  // must NEVER reach the model (§8.1 rule 1). Map it to the gentle, non-diagnostic `display` copy; if a band
  // can't be resolved, omit it entirely rather than leak the clinical key. Non-wellbeing descriptor bands
  // ("leans higher") are non-clinical and pass through.
  const gentleBandOf = def.wellbeing
    ? new Map((def.bands ?? []).map((band) => [band.clinicalKey, band.display]))
    : undefined;
  const lines = result.scores.map((score) => {
    const label = labelOf.get(score.key) ?? score.key;
    const bandText = def.wellbeing
      ? score.band && gentleBandOf?.get(score.band)
        ? ` — ${gentleBandOf.get(score.band)}`
        : ''
      : score.band
        ? ` — ${score.band}`
        : '';
    return `- ${label}: ${score.normalized.toFixed(2)}${bandText}`;
  });
  return [
    `Instrument: ${def.title} (${def.instrument})`,
    `Framing: ${def.framing}`,
    '',
    ...lines,
  ].join('\n');
}

export type NarrateResult =
  | { ok: true; text: string; costUsd: number }
  | { ok: false; reason: 'NO_KEY' | 'AI_OFF' | 'BUDGET' | 'ERROR'; message: string };

export interface NarrateDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  aiEnabled: boolean;
  model: string;
  def: TestDefinition;
  result: TestResult;
  personId: string;
  now: Date;
  /** Budget already checked by the caller (the bridge): true = a budget stop, skip the spend. */
  overBudget: boolean;
}

function buildUsage(
  model: string,
  personId: string,
  at: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  },
): UsageEvent {
  return {
    id: uuid(),
    schemaVersion: 1,
    type: 'test.narrate',
    personId,
    model,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(model, usage),
  };
}

export async function narrateResult(deps: NarrateDeps): Promise<NarrateResult> {
  const { fs, key, client, apiKey, aiEnabled, model, def, result, personId, now } = deps;
  if (!aiEnabled)
    return { ok: false, reason: 'AI_OFF', message: 'Turn on AI in Settings to use this.' };
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  if (deps.overBudget)
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };

  const system = [
    PERSONA,
    SAFETY,
    NARRATIVE_GUIDANCE,
    ...(def.sensitive ? [ADULT_BOUNDARY] : []),
    ...(def.wellbeing ? [WELLBEING_BOUNDARY] : []),
    ...(result.crisisFlag ? [CRISIS_LEAD] : []),
  ].join('\n\n');

  const at = now.toISOString();
  let stream;
  try {
    stream = await client.stream(
      {
        apiKey,
        model,
        system,
        messages: [{ role: 'user', content: scoreDigest(def, result) }],
        maxTokens: 700,
        extendedThinking: false, // bounded prose — keep the budget for the output
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The reflection couldn’t be written. Please try again.',
    };
  }

  // Meter BEFORE returning — a paid call is billed even if the text is thin (spec 06 / spec 37).
  const event = buildUsage(model, personId, at, stream.usage);
  await recordUsage(fs, key, event);

  const text = stream.text.trim();
  if (!text)
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The reflection came back empty. Please try again.',
    };
  return { ok: true, text, costUsd: event.costUsd };
}
