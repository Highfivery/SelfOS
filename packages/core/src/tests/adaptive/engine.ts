import { z } from 'zod';

import { extractJsonArray, extractJsonObject, tolerantArray } from '../../ai/jsonSalvage';
import { PERSONA, SAFETY } from '../../conversations/promptBuilder';
import type { AdaptiveProfile, AiFailureReason, EroticLexicon, LexiconEntry } from '../../schemas';
import { runClaude, type AiDeps } from '../../questionnaires/aiCall';
import { bothSidesAnswered, suppressedTexts, violatesBoundary } from './lexicon';

/**
 * 74-adaptive-tests §5.1/§5.3 — the **adaptive half**: the phases that chase what the bank left ambiguous,
 * and the synthesis that turns the whole take into a profile.
 *
 * DEPTH IS UNCAPPED (owner decision, 74 §5.3). There is no quality cap and no fixed turn count — the engine
 * probes until its confidence rule is satisfied. Three things still bound it, none of them a quality limit:
 *
 * - **The budget.** `runClaude` checks person + app budget before EVERY call (06). An uncapped loop stops the
 *   moment the allowance is reached and the take synthesizes on what it has. Not negotiable.
 * - **A runaway backstop.** {@link MAX_ADAPTIVE_CALLS_BACKSTOP} guards a non-converging loop caused by a parse
 *   failure or a degenerate confidence signal. It should never bind; if it does, that is a bug and the result
 *   is flagged degraded.
 * - **Fail-safe degradation.** A failed phase is SKIPPED, never fatal: a take that reaches synthesis with only
 *   the bank answered still completes with an honest, thinner profile (74 §7).
 */

/**
 * Not a depth cap — a guard against a loop that never converges. The probe loop's real bound is the ambiguity
 * rule (which is data-driven and finite); this is the ceiling the bridge applies on top of it, exported here
 * so the number lives beside the loop it guards.
 */
export const MAX_ADAPTIVE_CALLS_BACKSTOP = 40;

/** How many lines one reaction round offers. */
const LINES_PER_ROUND = 12;

/** How many entries of context the model is given per prompt. Enough to be personal, bounded for tokens. */
const CONTEXT_CAP = 40;

// ── The register ───────────────────────────────────────────────────────────────────────────────────

/**
 * The explicit register for every adaptive-intimacy phase. Establishes the legitimate context FIRST (the
 * `explicitFraming` pattern, 08 §16.5) so the model engages instead of substituting tasteful deflections, then
 * states the boundary that never loosens.
 */
const REGISTER = `CONTEXT: this is a private, 18+ self-assessment inside a personal wellness app, for a \
consenting adult mapping the sexual language they like. Frank, explicit, filthy language is appropriate and \
expected here — it is the SUBJECT of the assessment. Use blunt, plain words for bodies and acts; do not \
soften, do not substitute romantic or tasteful phrasing, and never lecture them about their own preferences.

BOUNDARY (absolute): consensual adults only. Taboo material appears ONLY as pre-agreed, safeworded roleplay \
between adults who both know that is what it is — never minors, never real non-consent, never anything \
illegal. If something they wrote suggests real harm, coercion or an assault rather than a scene, do not treat \
it as erotic material: stop, and say gently that it belongs with a person, not a test.`;

/** Their boundaries, as a hard negative constraint on anything generated. Belt; `violatesBoundary` is braces. */
function boundaryBlock(lexicon: EroticLexicon): string {
  const banned = suppressedTexts(lexicon);
  if (banned.length === 0) return '';
  return `THEIR HARD NOS — never write any of these, in any form, however well it would fit: ${banned.join(
    ' · ',
  )}.`;
}

/** A compact picture of what the bank already established, so a phase never re-asks what it knows. */
export function lexiconDigest(lexicon: EroticLexicon): string {
  const line = (label: string, entries: LexiconEntry[]): string =>
    entries.length === 0
      ? ''
      : `${label}: ${entries
          .slice(0, CONTEXT_CAP)
          .map((e) => e.text)
          .join(' · ')}`;
  const loved = lexicon.entries.filter(
    (e) => e.state === undefined && Math.max(e.hear, e.say) >= 3,
  );
  // Re-sourced from the GAP, not the middle mark: `okay` is a mild yes now, so the old `notYet` filter would
  // be permanently empty and this context line would silently stop existing (74 §3.6.2).
  const stuck = lexicon.entries.filter(
    (e) => e.state === undefined && bothSidesAnswered(e) && e.hear >= 3 && e.say <= 1,
  );
  return [
    line('They marked these as landing', loved),
    line('They love hearing these but rate themselves low on saying them', stuck),
    lexicon.themes.length > 0 ? `In their words: ${lexicon.themes.join(' · ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Ambiguities: what the bank could not settle ────────────────────────────────────────────────────

export interface Ambiguity {
  id: string;
  /** The question the probe should actually resolve, in plain terms. */
  question: string;
}

/**
 * What the bank left genuinely unresolved (pure + deterministic). This is the engine's confidence rule: while
 * ambiguities remain, it probes; when they are gone, it stops. Derived from the DATA, never from the model, so
 * the loop terminates on facts rather than on a model's opinion of its own certainty.
 */
export function openAmbiguities(lexicon: EroticLexicon): Ambiguity[] {
  const out: Ambiguity[] = [];
  const byFamily = new Map<string, LexiconEntry[]>();
  for (const entry of lexicon.entries) {
    const list = byFamily.get(entry.family);
    if (list) list.push(entry);
    else byFamily.set(entry.family, [entry]);
  }

  // 1) A family they both loved AND drew a line in — the "is it the register or that word?" question, which
  //    is the single most useful thing a probe can settle (claiming vs contempt).
  for (const [family, entries] of byFamily) {
    const loved = entries.filter((e) => e.state === undefined && Math.max(e.hear, e.say) >= 3);
    const refused = entries.filter((e) => e.state === 'never');
    if (loved.length > 0 && refused.length > 0) {
      out.push({
        id: `split:${family}`,
        question: `They loved "${loved[0]!.text}" but ruled out "${refused[0]!.text}" — is it that word specifically, or the register behind it?`,
      });
    }
  }

  // 2) Something they clearly want to hear and cannot say. A preference or a goal? Only they know.
  // BOTH sides must have been asked (74 §3.6.6). Without the guard this reads a side the deck never offered
  // as a refusal — and once seeding stopped filling the unshown side, it fired for essentially every oriented
  // person, putting a FALSE statement in front of them ("rated it 0 to say") whose answer then feeds synthesis.
  const frozen = lexicon.entries.filter(
    (e) => e.state !== 'never' && bothSidesAnswered(e) && e.hear >= 3 && e.say === 0,
  );
  if (frozen.length > 0) {
    out.push({
      id: 'frozen',
      question: `They love hearing "${frozen[0]!.text}" but rated it 0 to say — is that "he can, I can't", or do they want to be able to and freeze?`,
    });
  }

  // 3) Loves to hear it, can't say it — the most coachable signal in the take. Sourced from the gap since
  // the middle mark stopped meaning "cringe" (74 §3.6.2); an empty probe pack is invisible, so a filter that
  // can never match again would have removed this silently.
  const cringe = lexicon.entries.filter(
    (e) => e.state === undefined && bothSidesAnswered(e) && e.hear >= 3 && e.say <= 1,
  );
  if (cringe.length > 0) {
    out.push({
      id: 'cringe',
      question: `They love hearing "${cringe[0]!.text}" but rate themselves near zero on saying it — what stops them?`,
    });
  }

  return out;
}

// ── Phase: line reactions ──────────────────────────────────────────────────────────────────────────

const LinesSchema = z.object({
  lines: tolerantArray(z.string().min(1), '', (v) => v.trim() !== ''),
});

export interface PhaseResult<T> {
  ok: boolean;
  value?: T;
  /** True when the phase could not run (AI off / budget / parse) and the take proceeds without it. */
  degraded: boolean;
  costUsd: number;
  /**
   * 74 §3.6.12 — WHY it could not run, carried instead of discarded.
   *
   * `runClaude` already classifies every failure (NO_KEY / BUDGET / ERROR / REFUSED / TRUNCATED / MALFORMED),
   * and every phase threw that away — so a live call that failed on auth or transport reached the person as
   * "AI isn't set up yet. Set up Claude in Settings → AI", sending them to fix something that was not broken.
   */
  reason?: AiFailureReason;
  /** The classified failure in their words. */
  message?: string;
}

/**
 * Generate the lines they react to. Seeded by what the bank established, so round 2 tests a hypothesis round 1
 * produced rather than offering another dozen strangers' lines.
 */
export async function runLinesPhase(
  deps: AiDeps,
  lexicon: EroticLexicon,
  round: number,
): Promise<PhaseResult<string[]>> {
  const system = [
    PERSONA,
    SAFETY,
    REGISTER,
    boundaryBlock(lexicon),
    `Write exactly ${LINES_PER_ROUND} complete lines someone could actually SAY in bed — not topics, not \
questions, the words themselves. Vary the register deliberately across praise, claiming, command, narration, \
degradation, begging and filth, so their reactions tell us which register lands rather than which topic. Draw \
on what already landed for them, and push slightly past it — this round should TEST something, not repeat what \
we know. Return ONLY {"lines": string[]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const out = await runClaude(
    deps,
    system,
    `${lexiconDigest(lexicon)}\n\nThis is round ${round}.`,
    'test.adaptive.lines',
    1200,
  );
  if (!out.ok)
    return {
      ok: false,
      degraded: true,
      costUsd: 0,
      ...(out.reason ? { reason: out.reason } : {}),
      ...(out.message ? { message: out.message } : {}),
    };
  const parsed = LinesSchema.safeParse(extractJsonObject(out.text));
  const lines = (parsed.success ? parsed.data.lines : [])
    // Belt and braces: the prompt forbids their hard nos, and anything that slips through is dropped here.
    .filter((line) => !violatesBoundary(lexicon, line))
    .slice(0, LINES_PER_ROUND);
  // A reply that parsed to nothing is its own outcome — not a missing key, which is what it used to look like.
  if (lines.length === 0) {
    return {
      ok: false,
      degraded: true,
      costUsd: out.usage.costUsd,
      reason: 'MALFORMED',
      message: 'Nothing usable came back this time — try again.',
    };
  }
  return { ok: true, value: lines, degraded: false, costUsd: out.usage.costUsd };
}

// ── Phase: probe ───────────────────────────────────────────────────────────────────────────────────

/** Ask ONE question that resolves ONE ambiguity. Returns the question text to put in front of them. */
export async function runProbePhase(
  deps: AiDeps,
  lexicon: EroticLexicon,
  ambiguity: Ambiguity,
): Promise<PhaseResult<string>> {
  const system = [
    PERSONA,
    SAFETY,
    REGISTER,
    boundaryBlock(lexicon),
    `Ask ONE short, warm, direct question that settles the ambiguity below. Quote their own marked words back \
to them so it reads as someone paying attention, not a form. Never ask them to justify a boundary, and never \
ask why something is a hard no. Return ONLY {"question": string}.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const out = await runClaude(
    deps,
    system,
    `${lexiconDigest(lexicon)}\n\nThe ambiguity: ${ambiguity.question}`,
    'test.adaptive.probe',
    400,
  );
  if (!out.ok)
    return {
      ok: false,
      degraded: true,
      costUsd: 0,
      ...(out.reason ? { reason: out.reason } : {}),
      ...(out.message ? { message: out.message } : {}),
    };
  const parsed = z.object({ question: z.string().min(1) }).safeParse(extractJsonObject(out.text));
  const raw = parsed.success ? parsed.data.question : '';
  // Every other phase filters what the model wrote; this one didn't, and it is the phase that puts free
  // prose in front of the person. A probe asking about a hard no is exactly what the prompt above forbids
  // ("never ask them to justify a boundary") — the instruction is belt, this is braces. Dropping it degrades
  // the phase, which the caller already handles, rather than showing them the question.
  const question = violatesBoundary(lexicon, raw) ? '' : raw;
  return {
    ok: question !== '',
    ...(question !== '' ? { value: question } : {}),
    degraded: question === '',
    costUsd: out.usage.costUsd,
  };
}

// ── Phase: scenario ────────────────────────────────────────────────────────────────────────────────

/** The contexts a scenario probes. Register is context-dependent — filth mid-act is a disaster at 2pm. */
export const ADAPTIVE_CONTEXTS = [
  'buildUp',
  'during',
  'edge',
  'after',
  'sexting',
  'phone',
] as const;
export type AdaptiveContext = (typeof ADAPTIVE_CONTEXTS)[number];

export interface ScenarioItem {
  context: AdaptiveContext;
  scene: string;
  options: string[];
}

const ScenarioSchema = z.object({
  scene: z.string().min(1),
  options: tolerantArray(z.string().min(1), '', (v) => v.trim() !== ''),
});

export async function runScenarioPhase(
  deps: AiDeps,
  lexicon: EroticLexicon,
  context: AdaptiveContext,
): Promise<PhaseResult<ScenarioItem>> {
  const system = [
    PERSONA,
    SAFETY,
    REGISTER,
    boundaryBlock(lexicon),
    `Write one short, concrete, explicit moment in the "${context}" context, then 3–4 things that could be \
SAID in that moment — real lines, meaningfully different from each other in register, one of which may be \
"nothing, no words". The point is to learn what register fits THIS moment, since what lands mid-act is wrong \
at 2pm. Return ONLY {"scene": string, "options": string[]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const out = await runClaude(deps, system, lexiconDigest(lexicon), 'test.adaptive.scenario', 700);
  if (!out.ok)
    return {
      ok: false,
      degraded: true,
      costUsd: 0,
      ...(out.reason ? { reason: out.reason } : {}),
      ...(out.message ? { message: out.message } : {}),
    };
  const parsed = ScenarioSchema.safeParse(extractJsonObject(out.text));
  if (!parsed.success || parsed.data.options.length === 0) {
    return { ok: false, degraded: true, costUsd: out.usage.costUsd };
  }
  const options = parsed.data.options.filter((o) => !violatesBoundary(lexicon, o));
  // The SCENE is prose shown to them too, and it was passing through unchecked while its options were
  // filtered — a scene that sets up a boundary is the same failure as an option that names one.
  const clean = options.length > 0 && !violatesBoundary(lexicon, parsed.data.scene);
  return {
    ok: clean,
    ...(clean ? { value: { context, scene: parsed.data.scene, options } } : {}),
    degraded: !clean,
    costUsd: out.usage.costUsd,
  };
}

// ── Phase: synthesis ───────────────────────────────────────────────────────────────────────────────

const SynthesisSchema = z.object({
  narrative: z.string().catch(''),
  registers: z.record(z.string(), z.number()).catch({}),
  contexts: z
    .record(z.string(), z.object({ heat: z.number(), note: z.string().optional() }))
    .catch({}),
  themes: tolerantArray(z.string().min(1), '', (v) => v.trim() !== ''),
  wantsToSay: tolerantArray(z.string().min(1), '', (v) => v.trim() !== ''),
  voice: z.string().optional(),
});

export interface SynthesisResult {
  profile: AdaptiveProfile;
  narrative: string;
}

/**
 * The synthesis. Reads the whole take and writes the report + the structured profile. It MAPS onto the
 * instrument's fixed spine and may never invent a dimension key (74 §4.2) — the deterministic scores are
 * computed separately from the lexicon, so a model that ignores the instruction changes the prose, never the
 * numbers.
 */
export async function runSynthesis(
  deps: AiDeps,
  lexicon: EroticLexicon,
  transcript: string,
): Promise<PhaseResult<SynthesisResult>> {
  const system = [
    PERSONA,
    SAFETY,
    REGISTER,
    boundaryBlock(lexicon),
    `Write their profile from everything below. Two parts.

NARRATIVE — 4–6 short paragraphs, second person, in their register (frank, using the words THEY use). Say what \
you actually noticed: which register lands and which doesn't, and the distinction underneath it if there is one \
(being claimed vs being demeaned is a common one, but only say it if the data says it). Name what they want to \
be able to say but freeze on, as a thing to practise rather than a flaw. State plainly what is off the table, \
without asking why and without arguing. You MAY interpret — say what a pattern suggests — but label it as a \
reading of what they answered, never a verdict about who they are. Never pathologize, never moralize.

STRUCTURED — registers scored 0..1 (praise, claiming, command, narration, degradation, begging, filth); \
contexts scored 0..1 with a short note (${ADAPTIVE_CONTEXTS.join(', ')}); themes in THEIR words; wantsToSay; \
and voice — one short line on how it should sound (e.g. "low, close, certain. not loud.").

Return ONLY {"narrative": string, "registers": object, "contexts": object, "themes": string[], \
"wantsToSay": string[], "voice": string}.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const out = await runClaude(
    deps,
    system,
    `${lexiconDigest(lexicon)}\n\nThe rest of the take:\n${transcript}`,
    'test.adaptive.synthesize',
    3000,
  );
  if (!out.ok)
    return {
      ok: false,
      degraded: true,
      costUsd: 0,
      ...(out.reason ? { reason: out.reason } : {}),
      ...(out.message ? { message: out.message } : {}),
    };
  const parsed = SynthesisSchema.safeParse(extractJsonObject(out.text) ?? {});
  if (!parsed.success) return { ok: false, degraded: true, costUsd: out.usage.costUsd };
  const data = parsed.data;
  // A narrative that quotes a boundary back at them is worse than no narrative.
  const narrative = violatesBoundary(lexicon, data.narrative) ? '' : data.narrative;
  return {
    ok: narrative !== '',
    value: {
      narrative,
      profile: {
        registers: data.registers,
        contexts: data.contexts,
        themes: data.themes.filter((t) => !violatesBoundary(lexicon, t)),
        wantsToSay: data.wantsToSay.filter((t) => !violatesBoundary(lexicon, t)),
        // The voice line reaches BOTH the own block and the partner steer, so it goes through the same
        // filter as everything else the model wrote.
        ...(data.voice !== undefined && !violatesBoundary(lexicon, data.voice)
          ? { voice: data.voice }
          : {}),
      },
    },
    degraded: narrative === '',
    costUsd: out.usage.costUsd,
  };
}

/** Parse a JSON array of strings out of a model reply, salvaging a truncated tail (37). Exported for tests. */
export function parseLines(text: string): string[] {
  const direct = extractJsonArray(text);
  if (Array.isArray(direct)) return direct.filter((x): x is string => typeof x === 'string');
  const obj = LinesSchema.safeParse(extractJsonObject(text));
  return obj.success ? obj.data.lines : [];
}
