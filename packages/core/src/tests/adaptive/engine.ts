import { z } from 'zod';

import {
  classifyParseOutcome,
  extractJsonArray,
  salvageLooseStringField,
  extractJsonObject,
  salvageJsonObjectArrayField,
  salvageJsonStringArrayField,
  tolerantArray,
} from '../../ai/jsonSalvage';
import { PERSONA, SAFETY } from '../../conversations/promptBuilder';
import { SKIPPED_ANSWER } from '../../schemas';
import type {
  AdaptiveProfile,
  AdaptiveReading,
  AiFailureReason,
  EroticLexicon,
  LexiconEntry,
} from '../../schemas';
import { runClaude, type AiDeps } from '../../questionnaires/aiCall';
import { hasSayGap, isNameFamily, suppressedTexts, violatesBoundary } from './lexicon';

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

/**
 * 74 §3.6.35 — WHO THESE TWO ARE, in every generating prompt. Owner-directed.
 *
 * Identity and address were asked in the take's first two taps and then read by exactly one thing:
 * `orientation.ts`, to decide which half of the bank a person is shown. No prompt has ever carried them — so
 * the lines, probe and scenario phases each wrote for an unnamed pair and inferred the rest from whichever
 * words happened to get marked. That is survivable for a term the person marked themselves and wrong the
 * moment a phase invents anything: a line "pushing slightly past" what landed has nothing telling it which
 * bodies are in the room, and a question phrased around a term has nothing telling it whose mouth it is in.
 *
 * Identity is the BODY, address is what they like being CALLED, and the two are deliberately separate (a man
 * can want "good girl", §3.6.3) — so they are stated as two different facts and never collapsed. `either`, and
 * an absent answer, are stated as themselves rather than guessed at: fail open, exactly as orientation does.
 */
export function whoBlock(lexicon: EroticLexicon): string {
  const { identity, address } = lexicon;
  if (!identity && !address) return '';
  const body = (value: 'man' | 'woman' | 'either' | undefined): string =>
    value === 'man' ? 'a man' : value === 'woman' ? 'a woman' : 'not stated — do not assume one';
  const called = (value: 'girl' | 'man' | 'either' | undefined): string =>
    value === 'girl'
      ? 'likes being addressed as a girl'
      : value === 'man'
        ? 'likes being addressed as a man'
        : 'has no preference either way about how they are addressed';
  return `WHO THESE TWO ARE — write for these two, never a generic pair:
- The person taking this: ${body(identity?.self)}, and ${called(address?.self)}.
- The person they are with: ${body(identity?.partner)}, and ${called(address?.partner)}.
Never give either of them a body they do not have, and never swap who is saying a line and who is hearing it. \
How someone likes to be ADDRESSED is not their body — take each from the line it is on.`;
}

/** Their boundaries, as a hard negative constraint on anything generated. Belt; `violatesBoundary` is braces. */
function boundaryBlock(lexicon: EroticLexicon): string {
  const banned = suppressedTexts(lexicon);
  if (banned.length === 0) return '';
  return `THEIR HARD NOS — never write any of these, in any form, however well it would fit: ${banned.join(
    ' · ',
  )}.`;
}

/**
 * What they have ANSWERED so far in this take — every reaction, probe answer and scenario pick.
 *
 * The marks say what they like; these say what they told us when asked. Until now each phase saw only the
 * lexicon, so a probe answer three screens back informed nothing: the lines phase couldn't build on what they
 * had just explained, and the scenario couldn't use a preference they had spelled out in their own words.
 * Every generating phase takes this, so the take compounds instead of restarting.
 */
export function answersDigest(
  turns: readonly { phase: string; item: { text: string }; answer?: unknown }[],
): string {
  const lines = turns
    .filter(
      (turn) =>
        turn.answer !== undefined &&
        turn.answer !== null &&
        turn.answer !== '' &&
        // 74 §3.6.35 — a SKIP is not something they told us. It is stamped as a real marker rather than `''`
        // (§3.6.17) so the question stays reachable, and that marker was reaching the model as though the
        // person had answered "skipped". An OFFER — a generated item they have not responded to at all — has
        // no answer and falls out on the `undefined` check above.
        turn.answer !== SKIPPED_ANSWER,
    )
    .slice(-ANSWER_CONTEXT_CAP)
    .map((turn) => {
      const answer = typeof turn.answer === 'string' ? turn.answer : JSON.stringify(turn.answer);
      return `- (${turn.phase}) ${turn.item.text} → ${answer}`;
    });
  if (lines.length === 0) return '';
  return `What they have told us already in this take — build on it, never re-ask it:\n${lines.join('\n')}`;
}

/** How many prior answers reach a prompt. Newest-last, so the freshest context is what survives the cap. */
const ANSWER_CONTEXT_CAP = 24;

/** A compact picture of what the bank already established, so a phase never re-asks what it knows. */
export function lexiconDigest(lexicon: EroticLexicon): string {
  const line = (label: string, entries: LexiconEntry[]): string =>
    entries.length === 0
      ? ''
      : `${label}: ${entries
          .slice(0, CONTEXT_CAP)
          .map((e) => e.text)
          .join(' · ')}`;
  /*
   * 74 §3.6.29 — split by DIRECTION, because a flat list destroys the one thing the take exists to find.
   *
   * This used to be `Math.max(hear, say) >= 3` in a single line labelled "they marked these as landing", so
   * "I want to be called this" and "I want to call them this" arrived indistinguishable — and for a name they
   * are opposite answers (§3.6.8: "good girl" is wrong as something he is called and exactly right as
   * something he calls her). The synthesis prompt then asks for "the role they take, what they want to BE to
   * the other person" and for the hear/say gap, neither of which is answerable from the flattened list. The
   * coach's own block (`buildOwnLexiconBlock`) has always split them; this is the same split, one file over.
   */
  const lovedToHear = lexicon.entries.filter((e) => e.hear >= 3);
  const lovedToSay = lexicon.entries.filter((e) => e.say >= 3);
  // The middle mark is a MILD YES (§3.6.2) — usable, never a favourite. Left out entirely, every one of those
  // taps was write-only for the synthesis, which is the defect §3.6.2 fixed for the coach and missed here.
  const okay = lexicon.entries.filter(
    (e) => (e.hearState === 'okay' || e.sayState === 'okay') && e.hear < 3 && e.say < 3,
  );
  // Re-sourced from the GAP, not the middle mark: `okay` is a mild yes now, so the old `notYet` filter would
  // be permanently empty and this context line would silently stop existing (74 §3.6.2).
  const stuck = lexicon.entries.filter(hasSayGap);
  return [
    line('They want to HEAR these — said to them', lovedToHear),
    line('They want to SAY these — in their own mouth', lovedToSay),
    line('Fine with, not favourites — usable, never lead with them', okay),
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
  /**
   * The ONLY words the probe may quote back. Without this the prompt says "quote their own marked words" and
   * the model picks from the whole lexicon — which, for someone with 246 hard nos, lands on a banned one
   * about half the time, and the question is then discarded for containing it. Every phase billed a call to
   * produce nothing, roughly every other attempt, and it read as the model being broken.
   */
  terms: string[];
  /**
   * 74 §3.6.36 — how each of those words was actually marked, keyed by the word.
   *
   * The quote list was bare text, so the model was handed two terms with no idea which was loved and which
   * was lukewarm, or — the part that produced a nonsense question — which DIRECTION either was marked in.
   * "my big cock" (loved to be CALLED) beside "my beautiful pussy" (lukewarm about SAYING) are not two
   * points on one scale; for a mixed-anatomy couple they are not even about the same person's body.
   */
  termNote?: Record<string, string>;
}

/**
 * What the bank left genuinely unresolved (pure + deterministic). This is the engine's confidence rule: while
 * ambiguities remain, it probes; when they are gone, it stops. Derived from the DATA, never from the model, so
 * the loop terminates on facts rather than on a model's opinion of its own certainty.
 */
export function openAmbiguities(
  lexicon: EroticLexicon,
  /**
   * 74 §3.6.36 — what each family is CALLED, so the split can name the register it is asking about.
   *
   * The question is literally "is it that word specifically, or the register behind it?" and it never said
   * what the register was — the model had two words and had to infer the category they came from. Optional
   * and keyed by family id: the lexicon carries the id, the bank carries the label, and this function stays
   * pure over the lexicon (its whole point is that the loop terminates on data, not on a model's opinion).
   */
  familyLabels: Readonly<Record<string, string>> = {},
): Ambiguity[] {
  const out: Ambiguity[] = [];
  const byFamily = new Map<string, LexiconEntry[]>();
  for (const entry of lexicon.entries) {
    const list = byFamily.get(entry.family);
    if (list) list.push(entry);
    else byFamily.set(entry.family, [entry]);
  }

  /*
   * 1) A family where some landed and some plainly did not — the "is it the register or that word?" question,
   *    which is the single most useful thing a probe can settle (claiming vs contempt).
   *
   *    The contrast is drawn against the MIDDLE mark, never a hard no. It used to name the ruled-out word:
   *    `They loved "baby" but ruled out "sweet girl" — is it that word, or the register?` That is the app
   *    fighting itself twice over. It asks them to justify a boundary, which the probe's own prompt forbids
   *    ("never ask why something is a hard no"); and the question it generates necessarily contains the term
   *    the boundary filter then rejects it for — so the phase billed a call and reported "nothing came back",
   *    every time, for anyone who had ruled anything out. A hard no is settled. There is nothing to probe.
   */
  for (const [family, entries] of byFamily) {
    /*
     * 74 §3.6.36 — a register split is a question about ONE DIRECTION, so it is drawn within one.
     *
     * OWNER-REPORTED: `"my big cock" hit, "my beautiful pussy" only half-did. What's the split?` — which is
     * the model faithfully shortening the premise it was handed. Both lists here were direction-blind
     * (`Math.max(hear, say) >= 3` against `hearState === 'okay' || sayState === 'okay'`), so the contrast
     * could pair a mark made about being CALLED something with a mark made about SAYING something else.
     * That is not a register split; it is two different answers to two different questions.
     *
     * For a mixed-anatomy couple it is worse than incoherent, and that is the reported case: orientation
     * shows a penis name only on the side its owner can HEAR and a vulva name only on the side he can SAY
     * (§3.6.23), so the pair is about two different people's bodies. Comparing within one direction fixes
     * both at once, because orientation has already separated the bodies onto opposite sides.
     *
     * A direction the person was never SHOWN is not an answer (§3.6.6) — `directionAnswered` is what
     * distinguishes "they said okay" from "we never asked", and reading a blank side as a mark is the
     * conflation §3.6.11 exists to prevent.
     */
    for (const side of ['hear', 'say'] as const) {
      const stateOf = (entry: LexiconEntry): 'love' | 'okay' | 'never' | undefined =>
        side === 'hear' ? entry.hearState : entry.sayState;
      const pick = entries.find((entry) => stateOf(entry) === 'love');
      const contrast = pick
        ? entries.find((entry) => entry.key !== pick.key && stateOf(entry) === 'okay')
        : undefined;
      if (!pick || !contrast) continue;
      // Said in the person's own terms, and the direction is IN the sentence — the model reads this as the
      // thing to resolve, so a premise that does not name the direction cannot produce a question that does.
      /*
       * 74 §3.6.39 — and in the terms of the RIGHT register, because "being called" is only true of a name.
       *
       * This was `side === 'hear' ? 'being called' : 'saying'` for all 42 families, so a hear-split drawn from
       * any of the 33 LINE families stated something the person never marked: "they love being called 'suck
       * me'", "'trembling'", "'touch me there'". You are not called those — you hear them. Measured on the
       * owner's own take, live: 4 of 11 derived premises said it, and every one of his hear-splits did.
       *
       * The right wording was already six lines below in `frozen` ("They love hearing …") and the right
       * predicate already in `steer.ts`, whose docstring says why it matters — a name is a vocative. This is
       * §3.6.36 one level down: that fixed WHICH DIRECTION a mark was made in, and left what that direction
       * MEANS for the family it came from.
       */
      const loves =
        side === 'hear' ? (isNameFamily(family) ? 'being called' : 'hearing') : 'saying';
      // Named where the bank told us what it is called; without it the sentence asks about "the register"
      // and leaves the model to guess which one from two words.
      const register = familyLabels[family];
      const behind = register
        ? `the register behind it (${register.replace(/^Names — /, '')})`
        : 'the register behind it';
      out.push({
        id: `split:${family}:${side}`,
        question: `They love ${loves} "${pick.text}" but were only lukewarm about ${loves} "${contrast.text}" — is it that word specifically, or ${behind}?`,
        terms: [pick.text, contrast.text],
        termNote: {
          [pick.text]: `they love ${loves} this`,
          [contrast.text]: `only lukewarm about ${loves} this`,
        },
      });
    }
  }

  // 2) Something they clearly want to hear and cannot say. A preference or a goal? Only they know.
  // BOTH sides must have been asked (74 §3.6.6). Without the guard this reads a side the deck never offered
  // as a refusal — and once seeding stopped filling the unshown side, it fired for essentially every oriented
  // person, putting a FALSE statement in front of them ("rated it 0 to say") whose answer then feeds synthesis.
  const frozen = lexicon.entries.filter(hasSayGap);
  if (frozen.length > 0) {
    out.push({
      id: 'frozen',
      // No longer "rated it 0 to say": there is no 0–4 scale to quote (74 §3.6.26), and a term they ruled
      // out saying is a boundary the probe must never ask them to justify (§3.6.15) — so this fires on the
      // softer gap, and says what they actually marked.
      question: `They love hearing "${frozen[0]!.text}" but only marked saying it "okay" — is that "he can, I can't", or do they want to be able to and freeze?`,
      terms: [frozen[0]!.text],
    });
  }

  /*
   * 74 §3.6.34 — there used to be a third ambiguity here, `cringe`, and it was TWO defects in one.
   *
   * It was `lexicon.entries.filter(hasSayGap)` — byte-identical to `frozen` above, taking the same `[0]` —
   * so it was not a second signal at all. Both fired together, on the same entry, with the same term; the
   * probe consumes one ambiguity per pass and keys `asked` on the id, so the take spent a SECOND billed
   * round re-asking about the identical word, and `ambiguitiesLeft` reported one open gap as two.
   *
   * Its question was also false. It said they "rate themselves near zero on saying it" while `hasSayGap`
   * requires `sayState === 'okay'` — the MIDDLE mark, an explicit mild yes (rating 2, not 0). `frozen`'s own
   * comment six lines up records that it was rewritten away from exactly that phrasing, for exactly that
   * reason; the sibling was fixed and this one was left, which is the §3.6.24 two-comments-disagree tell.
   *
   * One signal, one ambiguity, and the surviving wording is the true one. Measured before the fix: a single
   * row marked love-to-hear / okay-to-say produced THREE ambiguities about that one word.
   */
  return out;
}

/**
 * Why a phase produced nothing — and it matters which, because the two causes are opposite problems.
 *
 * A reply that never parsed is the MODEL's outcome (a refusal, a truncation, prose instead of JSON), and
 * `classifyParseOutcome` already names those. A reply that parsed and then lost everything to
 * `violatesBoundary` is OURS: the app filtered out its own output, which is a very different thing to tell
 * someone — and the one that was indistinguishable. All three phases collapsed both into a bare `degraded`
 * with no message at all, so a real report of "it doesn't work" carried no information about which half was
 * at fault, and there was nothing to diagnose from.
 */
function nothingUsable(
  text: string,
  noun: string,
  parsedSomething: boolean,
): { reason: AiFailureReason; message: string } {
  if (!parsedSomething) return classifyParseOutcome(text, noun);
  return {
    reason: 'MALFORMED',
    message:
      "Everything it wrote touched something you've ruled out, so none of it could be shown. Try again — or" +
      ' take back a hard no you have changed your mind about.',
  };
}

/**
 * When the structured list is exhausted, the take can still ask — grounded in what they marked rather than in
 * a specific unresolved contradiction.
 *
 * The derived ambiguities are finite (three, for a typical take), and running out reported "nothing left it
 * can't work out" for good. But there is always more worth asking: how a register lands in a different
 * moment, what they would want to say rather than hear, what kills it. "As many as it needs based on the
 * data" (owner, 2026-08-18) means the step keeps its depth from the DATA, not from a fixed list.
 */
export function openEndedAmbiguity(lexicon: EroticLexicon): Ambiguity | null {
  /*
   * 74 §3.6.36 — WHICH WAY each of these landed. Same defect as the split above, in the fallback that runs
   * for most later passes: `Math.max(hear, say) >= 3` flattens the two directions into one list, so the
   * model was told "they marked these as landing" and then asked to go deeper on "the direction" — the one
   * fact the list had just thrown away.
   */
  const loved = lexicon.entries
    .filter((entry) => entry.hearState === 'love' || entry.sayState === 'love')
    .slice(0, 4)
    .map((entry) => ({
      text: entry.text,
      way:
        entry.hearState === 'love' && entry.sayState === 'love'
          ? 'both ways'
          : entry.hearState === 'love'
            ? // 74 §3.6.39 — same rule as the split above: only a name is something you are CALLED. The
              // owner's own fallback happened to draw four names, so it read correctly by luck; the first
              // loved LINE to reach this list would have said "landing to be called 'suck me'".
              isNameFamily(entry.family)
              ? 'to be called'
              : 'to hear'
            : 'to say',
    }));
  if (loved.length === 0) return null;
  return {
    id: `open:${loved.length}`,
    question: `They marked ${loved
      .map((l) => `"${l.text}" as landing ${l.way}`)
      .join(
        ', ',
      )}. Go deeper on what that is actually made of — the moment, the register, what would break it.`,
    terms: loved.map((l) => l.text),
    termNote: Object.fromEntries(loved.map((l) => [l.text, `landed ${l.way}`])),
  };
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
  /** Everything they have answered in this take (`answersDigest`). */
  answers = '',
  /** Lines already written in this take — a round that repeats one wastes the slot. */
  writtenBefore: readonly string[] = [],
): Promise<PhaseResult<string[]>> {
  const system = [
    PERSONA,
    SAFETY,
    REGISTER,
    boundaryBlock(lexicon),
    whoBlock(lexicon),
    `Write exactly ${LINES_PER_ROUND} complete lines someone could actually SAY in bed — not topics, not \
questions, the words themselves. Vary the register deliberately across praise, claiming, command, narration, \
degradation, begging and filth, so their reactions tell us which register lands rather than which topic. Draw \
on what already landed for them, and push slightly past it — this round should TEST something, not repeat what \
we know.${
      writtenBefore.length > 0
        ? `\n\nAlready written for them — do not repeat any of these, or a near-variant:\n${writtenBefore
            .slice(-24)
            .map((line) => `- ${line}`)
            .join('\n')}`
        : ''
    } Return ONLY {"lines": string[]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const out = await runClaude(
    deps,
    system,
    [lexiconDigest(lexicon), answers, `This is round ${round}.`].filter(Boolean).join('\n\n'),
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
  /*
   * 74 §3.6.39 — through the shared parser, which until now had NO callers anywhere.
   *
   * `parseLines` was exported with a docstring saying "Exported for tests" and nothing imported it, in this
   * repo or any test — so the production path parsed MORE strictly than the helper written for it, and the
   * tolerant route it offers (a bare top-level array, the shape a model returns about as often as the
   * wrapped one) was dead. One parser, one behaviour, and the salvage below reaches production.
   */
  const written = parseLines(out.text);
  const seen = new Set(writtenBefore.map((line) => line.trim().toLowerCase()));
  const lines = written
    // Belt and braces: the prompt forbids their hard nos, and anything that slips through is dropped here.
    .filter((line) => !violatesBoundary(lexicon, line))
    // …and a line already put to them is a wasted slot, so the ask is enforced rather than requested.
    .filter((line) => !seen.has(line.trim().toLowerCase()))
    .slice(0, LINES_PER_ROUND);
  if (lines.length === 0) {
    return {
      ok: false,
      degraded: true,
      costUsd: out.usage.costUsd,
      ...nothingUsable(out.text, 'lines', written.length > 0),
    };
  }
  return { ok: true, value: lines, degraded: false, costUsd: out.usage.costUsd };
}

/**
 * How many questions one pass asks. Not "one per ambiguity": an ambiguity is where to START, and asking the
 * same narrow thing repeatedly produced two near-identical questions in a row. A pass spans angles — a scene
 * to react to, phrases to choose between, what they'd say, what kills it, what does the most work — so the
 * set is worth the call.
 */
const MAX_PROBE_QUESTIONS = 6;

/**
 * The hard ceiling on a probe question, in words.
 *
 * The prompt asks for under 20 and the model mostly obliges — but a live run produced a 27-word one in a set
 * of six, and "too long" is the exact complaint this rewrite exists to answer. Every other generated thing in
 * this engine is checked in code as well as asked for in the prompt (`violatesBoundary` is the same pattern):
 * an instruction is belt, this is braces.
 *
 * Set above the asked-for 20 so an occasional 21-word question is not thrown away for one word — this drops
 * the ramblers, not the near-misses.
 */
const MAX_PROBE_WORDS = 22;

/** Enough of a set to be worth showing. Below this the cap gives way rather than leaving them a thin pass. */
const MIN_PROBE_QUESTIONS = 3;

const wordCount = (text: string): number => text.trim().split(/\s+/).length;

// ── Phase: probe ───────────────────────────────────────────────────────────────────────────────────

/** One probe question and the answers written for it. */
export interface ProbeQuestion {
  question: string;
  /** 74 §3.6.17 — tappable answers written for THIS question. Empty ⇒ free text only. */
  options: string[];
}

/*
 * `probeTurnId` / `ambiguityOfProbeTurn` / `SKIPPED_ANSWER` live in the crypto-free `schemas.ts` and are
 * re-exported here beside the phase that uses them. The renderer stamps the turn and the bridge reads the
 * ambiguity back off it, so the two halves must be one definition — and the renderer cannot import this
 * module, whose barrel pulls in crypto (the `generationReadiness` precedent).
 */
export {
  probeTurnId,
  ambiguityOfProbeTurn,
  scenarioTurnId,
  contextOfScenarioTurn,
  SKIPPED_ANSWER,
} from '../../schemas';

/**
 * Ask the questions that resolve ONE ambiguity — as many as it genuinely needs, not always exactly one.
 *
 * The count is the model's call within a cap, because how much there is to pin down depends on the marks:
 * a family they split cleanly needs one question, a hear/say gap can need two. Each must stand alone and
 * carry a concrete example, since a question that assumes they remember what they tapped is unanswerable a
 * week later — which is what "makes no sense and doesn't provide enough context or an example" was.
 */
export async function runProbePhase(
  deps: AiDeps,
  lexicon: EroticLexicon,
  ambiguity: Ambiguity,
  /** Questions already put to them in this take — so a second pass asks something NEW. */
  askedBefore: readonly string[] = [],
  /** Everything they have answered in this take (`answersDigest`). */
  answers = '',
): Promise<PhaseResult<ProbeQuestion[]>> {
  const system = [
    PERSONA,
    SAFETY,
    REGISTER,
    boundaryBlock(lexicon),
    whoBlock(lexicon),
    /*
     * 74 §3.6.17 — SHORT, and answerable by tapping. Owner-directed, twice: "the questions are too long, they
     * should be quick to read, short, easy to answer, and specifically about dirty talk."
     *
     * The previous version required the opposite by construction — every question had to restate the marks in
     * plain words and carry a worked example before it asked anything — so paragraphs were the spec, not a
     * drift. That requirement existed to fix "makes no sense and doesn't provide enough context": a bare
     * question about a mark you made twenty minutes ago is unanswerable. The ANSWERS carry that weight now.
     * Concrete options are the context, and reading five of them is faster than reading one paragraph.
     */
    `Write ${MAX_PROBE_QUESTIONS} short questions about the WORDS — what they want said to them, what they \
want to be able to say, and how it should be worded. The ambiguity below is where to start, not the subject.

Every question must be:
- SHORT. Hard limit: 20 words. One line. No preamble, no restating what they marked, no explaining why you \
ask, no setting a scene before the question. A question they have to read twice has already failed, and \
anything over the limit is dropped before they see it.
- About LANGUAGE. Which wording lands, which of two lines is closer, what they'd want to say, what phrasing \
kills it, which word is doing the work. NOT what it says about them as a person — that reading belongs in \
their profile, not in a question they have to answer about themselves mid-test.
- ANSWERABLE BY TAPPING. Give 3–5 answers written for THAT question: real, specific, in their register, and \
meaningfully different from each other — not degrees of the same answer. One may be "depends", "neither", or \
"I'd rather say nothing" where that is genuinely an answer. Options are what carry the concreteness, so put \
the actual words in them: "'good girl'" and "'that's my girl'" are answers; "the first one" is not.

Two questions circling the same point are one question padded out — spread them across different angles.${
      askedBefore.length > 0
        ? `\n\nAlready asked — ask about something else:\n${askedBefore
            .slice(-12)
            .map((q) => `- ${q}`)
            .join('\n')}`
        : ''
    }

You may quote ONLY these words back to them, and no others, and each is listed with how they actually \
marked it — a word they love being CALLED and a word they love SAYING are answers to two different \
questions, and a question that treats them as one scale makes no sense to them:
${ambiguity.terms
  .map((term) =>
    ambiguity.termNote?.[term] ? `- "${term}" — ${ambiguity.termNote[term]}` : `- "${term}"`,
  )
  .join('\n')}
Quoting anything else is wrong — you cannot see which of their other words are off, and \
naming one they have ruled out would be the worst version of this. Never ask them to justify a boundary, never \
ask why something is a hard no, and never NAME one: a hard no is settled and is not a thing to ask about.

Return ONLY {"questions": [{"question": string, "options": string[]}]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const out = await runClaude(
    deps,
    system,
    [lexiconDigest(lexicon), answers, `The ambiguity: ${ambiguity.question}`]
      .filter(Boolean)
      .join('\n\n'),
    'test.adaptive.probe',
    // Six SHORT questions with a handful of short options each. The paragraph version needed 3500 and was
    // still cut off at 2000; this shape is a fraction of that, with room for the JSON wrapper.
    2000,
  );
  if (!out.ok)
    return {
      ok: false,
      degraded: true,
      costUsd: 0,
      ...(out.reason ? { reason: out.reason } : {}),
      ...(out.message ? { message: out.message } : {}),
    };
  // The model writes `["…","…"]` or `[{"question":"…"}, …]` depending on the day. Both are the same payload,
  // and rejecting one of them threw away six good questions for the shape of their wrapper. A question that
  // arrives without options is kept and answered as free text — one missing field is not worth a lost
  // question, and the renderer already has a box for exactly this.
  const questionish = z.union([
    z.string().min(1),
    z.object({
      question: z.string().min(1),
      options: z.array(z.string()).catch([]).default([]),
    }),
  ]);
  const QuestionsSchema = z.object({
    questions: tolerantArray(questionish, '', (v) => v !== ''),
  });
  const parsed = QuestionsSchema.safeParse(extractJsonObject(out.text));
  /*
   * 74 §3.6.39 — salvage the well-formed questions rather than losing the whole pass to one bad element.
   *
   * `tolerantArray` above is already per-element tolerant, but that only helps once the OBJECT parses — the
   * §3.6.34 lesson, in the sibling phase that never got the fix. And this is the phase most exposed to it:
   * its entire job is to quote the person's own marked terms back at them, so the reply is full of nested
   * quotes, and a single unescaped one makes the whole payload invalid JSON.
   *
   * Measured live at the owner's real shape: 2 of 4 open-ended passes came back MALFORMED, every one of them
   * `end_turn` — not truncated, not refused, just one question written with raw inner quotes while the other
   * five escaped theirs correctly. On that captured reply `extractJsonObject` returns null and all six are
   * lost; this recovers 5. A billed call was reporting "the question came back in an unexpected shape".
   */
  const salvagedSet =
    parsed.success && parsed.data.questions.length > 0
      ? parsed.data.questions
      : (QuestionsSchema.safeParse({
          questions: salvageJsonObjectArrayField(out.text, 'questions'),
        }).data?.questions ?? []);
  const asQuestion = (q: z.infer<typeof questionish>): ProbeQuestion =>
    typeof q === 'string'
      ? { question: q, options: [] }
      : { question: q.question, options: q.options };
  /*
   * Salvage a bare question (37 §3.1). Asked for `{"question": …}`, the model sometimes just asks the
   * question — which is the entire payload, in the right words, thrown away for missing its wrapper. Bounded
   * so prose that isn't a question can't slip through: it has to be short and end in a question mark.
   */
  const bare = out.text.trim();
  const salvaged =
    // The whole reply is the question, unwrapped.
    (bare.endsWith('?') && bare.length <= 600 && !bare.includes('{') ? bare : '') ||
    // …or the wrapper is there but its inner quotes were never escaped, which is what half of the live
    // replies look like for a one-string payload.
    (salvageLooseStringField(out.text, 'question') ?? '');
  const written: ProbeQuestion[] =
    salvagedSet.length > 0
      ? salvagedSet.map(asQuestion)
      : salvaged
        ? [{ question: salvaged, options: [] }]
        : [];
  // Every other phase filters what the model wrote; this one didn't, and it is the phase that puts free
  // prose in front of the person. A probe asking about a hard no is exactly what the prompt above forbids
  // ("never ask them to justify a boundary") — the instruction is belt, this is braces. Dropping it degrades
  // the phase, which the caller already handles, rather than showing them the question.
  /*
   * Check the question against everything they have ruled out EXCEPT the words we handed it.
   *
   * A name can be loved one way and ruled out the other (§3.6.8 — "never call me slut" must not stop him
   * calling her slut), and `violatesBoundary` with no direction refuses anything ruled out either way, which
   * is correct for a LINE: we don't know who would be saying it. A probe question is not a line. It DISCUSSES
   * a word the app itself chose precisely because they marked it loved, so refusing to print it means the
   * engine picks a term and then forbids itself from naming it.
   *
   * For someone who marked every one of their loved names in one direction only — the normal shape of the
   * names pass — that was every question, every time, and the phase could never produce anything.
   *
   * Masking the allowed terms keeps the check on everything else: a question that reaches for some OTHER
   * ruled-out word is still dropped.
   */
  const mask = (text: string): string =>
    ambiguity.terms.reduce((t, term) => (term.trim() === '' ? t : t.split(term).join('…')), text);
  const questions = written
    .filter((q) => !violatesBoundary(lexicon, mask(q.question)))
    .map((q) => ({
      question: q.question,
      /*
       * The OPTIONS are prose put in front of them too — the same gap the scenario phase had, where a scene
       * passed through unchecked while its options were filtered. Masked on the same grounds as the question:
       * these answers are ABOUT the words the engine itself chose because they were marked loved, so the
       * check runs on everything except those.
       *
       * A question whose options are all filtered still stands and falls back to free text — losing the way
       * to answer quickly is much better than losing the question.
       */
      options: q.options.filter((o) => o.trim() !== '' && !violatesBoundary(lexicon, mask(o))),
    }))
    .slice(0, MAX_PROBE_QUESTIONS);
  /*
   * Enforce the length. Shortest-first so that if the cap has to give way — a whole pass of verbose
   * questions — they still get the tightest ones rather than an empty step or a wall of prose.
   */
  const short = questions.filter((q) => wordCount(q.question) <= MAX_PROBE_WORDS);
  const shipped =
    short.length >= Math.min(MIN_PROBE_QUESTIONS, questions.length)
      ? short
      : [...questions]
          .sort((a, b) => wordCount(a.question) - wordCount(b.question))
          .slice(0, MAX_PROBE_QUESTIONS);
  if (shipped.length === 0) {
    return {
      ok: false,
      degraded: true,
      costUsd: out.usage.costUsd,
      ...nothingUsable(out.text, 'question', written.length > 0),
    };
  }
  return { ok: true, value: shipped, degraded: false, costUsd: out.usage.costUsd };
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

const SceneSchema = z.object({
  scene: z.string().min(1),
  options: tolerantArray(z.string().min(1), '', (v) => v.trim() !== ''),
});
const SENTINEL_SCENE = { scene: '', options: [] as string[] };
const ScenarioSchema = z.object({
  scenes: tolerantArray(SceneSchema, SENTINEL_SCENE, (v) => v.scene.trim() !== ''),
});

/** How many moments one pass writes. One at a time meant a call per scene and no sense of a set. */
const MAX_SCENES = 5;

export async function runScenarioPhase(
  deps: AiDeps,
  lexicon: EroticLexicon,
  context: AdaptiveContext,
  /** Everything they have answered in this take (`answersDigest`). */
  answers = '',
  /** Moments already written for this take — "write more" must mean MORE, not the same five again. */
  writtenBefore: readonly string[] = [],
): Promise<PhaseResult<ScenarioItem[]>> {
  const system = [
    PERSONA,
    SAFETY,
    REGISTER,
    boundaryBlock(lexicon),
    whoBlock(lexicon),
    `Write ${MAX_SCENES} different short, concrete, explicit moments in the "${context}" context — genuinely \
different situations, not one situation reworded — and for each, 3–4 things that could be SAID in it: real \
lines, meaningfully different from each other in register, one of which may be "nothing, no words". The point \
is to learn what register fits THIS moment, since what lands mid-act is wrong at 2pm.

${
  writtenBefore.length > 0
    ? `\nMoments already written for them — write DIFFERENT ones, not variants of these:\n${writtenBefore
        .slice(-15)
        .map((scene) => `- ${scene}`)
        .join('\n')}\n`
    : ''
}
Return ONLY {"scenes": [{"scene": string, "options": string[]}]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const out = await runClaude(
    deps,
    system,
    [lexiconDigest(lexicon), answers].filter(Boolean).join('\n\n'),
    'test.adaptive.scenario',
    // Five scenes, each with 3–4 lines. At 700 the set was cut off after the first.
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
  /*
   * 74 §3.6.34 — salvage a truncated set rather than losing all five scenes.
   *
   * `SceneSchema` is already per-element tolerant, but that only helps once the OBJECT parses: a reply cut
   * off mid-set fails `extractJsonObject` wholesale and every scene goes with it. A live run against the
   * owner's real shape hit exactly that — one MALFORMED in four, at 3000 tokens for five scenes of 3–4 lines
   * each — and the three complete scenes before the cut were thrown away with the fourth. This is the §37
   * salvage the portrait and the synthesis already use, applied to the one phase that still parsed strictly.
   */
  const parsed = ScenarioSchema.safeParse(extractJsonObject(out.text));
  const written = parsed.success
    ? parsed.data.scenes
    : (ScenarioSchema.safeParse({ scenes: salvageJsonObjectArrayField(out.text, 'scenes') }).data
        ?.scenes ?? []);
  // The SCENE is prose shown to them too, and it used to pass through unchecked while its options were
  // filtered — a scene that sets up a boundary is the same failure as an option that names one. A scene whose
  // options are all filtered is dropped; the others in the set still stand.
  const scenes = written
    .map((s) => ({
      context,
      scene: s.scene,
      options: s.options.filter((o) => !violatesBoundary(lexicon, o)),
    }))
    .filter((s) => s.options.length > 0 && !violatesBoundary(lexicon, s.scene))
    .filter((s) => !writtenBefore.some((prior) => prior.trim() === s.scene.trim()))
    .slice(0, MAX_SCENES);
  if (scenes.length === 0) {
    return {
      ok: false,
      degraded: true,
      costUsd: out.usage.costUsd,
      ...nothingUsable(out.text, 'scene', written.length > 0),
    };
  }
  return { ok: true, value: scenes, degraded: false, costUsd: out.usage.costUsd };
}

// ── Phase: synthesis ───────────────────────────────────────────────────────────────────────────────

const SynthesisSchema = z.object({
  narrative: z.string().catch(''),
  lede: z.string().catch(''),
  readings: tolerantArray(
    z.object({
      kind: z.enum(['pattern', 'gap', 'suggestion']),
      text: z.string().min(1),
      source: z.string().optional(),
    }),
    { kind: 'pattern' as const, text: '' },
    (v) => v.text.trim() !== '',
  ),
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
  lede: string;
  readings: AdaptiveReading[];
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
  /**
   * A bounded digest of what SelfOS already knows about this person from elsewhere — onboarding, sessions,
   * earlier insights. It exists so a reading can be checked against something rather than asserted: without
   * it the model has only the marks, and "why this, probably" would be a guess wearing a citation. Empty is
   * the normal case for a new person, and the prompt says so, so nothing is invented to fill it.
   */
  signals: string[] = [],
): Promise<PhaseResult<SynthesisResult>> {
  const system = [
    PERSONA,
    SAFETY,
    REGISTER,
    boundaryBlock(lexicon),
    whoBlock(lexicon),
    `Write their profile from everything below. Two parts.

NARRATIVE — 6–8 short paragraphs, second person, in their register (frank, using the words THEY use). This is \
the whole point of the test: they have just made hundreds of marks and want to know what it MEANS. A recap of \
their own answers is worthless. Be specific, be interesting, and tell them something they could not have got by \
reading their own list. Cover, in whatever order the data makes true:

1. WHAT LANDS — which register does the work for them, and the distinction underneath it if there is one (being \
claimed vs being demeaned; praised for effort vs for looks; owned vs used). Only if the data says it.
2. WHAT IT SAYS ABOUT THEM SEXUALLY — the actual read. What they seem to be after in bed: the role they take, \
what they want done to them, what they want to be to the other person, where the charge is. Say it frankly and \
in plain words. This is the part they came for; do not retreat into vagueness or wellness language here.
3. THE SHAPE OF WHAT THEY'RE INTO — name it concretely (praise kink, being claimed, degradation, service, \
exhibitionism, taboo roleplay, whatever the marks actually show), and where they sit on it — mild, deep, only \
in certain moments. If several run together, say how they combine, because that combination is the person.
4. THE HEAR/SAY GAP — what they want said to them but can't say back, framed as something to practise, never a \
flaw, and never assumed to be shame unless they said so.
5. WHAT THIS SUGGESTS PRACTICALLY — one or two concrete things to try, in their register, drawn from what they \
marked. A name is an easier first move than a sentence.
6. OFF THE TABLE — stated plainly, without asking why and without arguing.

You MAY interpret — say what a pattern suggests about them — but label it as a reading of what they answered \
("this reads like…", "if that's right…"), never a verdict about who they are. Never pathologize, never moralize, \
never turn a preference into a problem to solve.

LEDE — 2–3 sentences, the single most interesting true thing about them from all of this. It is printed at \
display size at the top of their report, so it must be the finding, not a preamble and not a summary of what \
the test is. Second person, their register, specific.

READINGS — 2–4 keyed blocks answering "why this, probably". Each is {kind, text, source?}. "kind" is one of \
"pattern" (something the marks show that they may not have noticed), "gap" (where it stops, stated without \
judgement) or "suggestion" (one concrete next move). Two to three sentences each, hedged — these are readings, \
not verdicts. "source" names where ELSE in SelfOS this shows, and you may ONLY set it when the signals below \
actually support it; quote or name the real thing (an onboarding answer, a session). If there are no signals, \
or none are relevant, omit "source" — a reading from the marks alone is honest, an invented source is not.

STRUCTURED — registers scored 0..1 (praise, claiming, command, narration, degradation, begging, filth); \
contexts scored 0..1 with a short note (${ADAPTIVE_CONTEXTS.join(', ')}); themes in THEIR words; wantsToSay; \
and voice — one short line on how it should sound (e.g. "low, close, certain. not loud.").

Return ONLY {"narrative": string, "lede": string, "readings": [{"kind": string, "text": string, \
"source": string}], "registers": object, "contexts": object, "themes": string[], "wantsToSay": string[], \
"voice": string}.`,
    signals.length > 0
      ? `What SelfOS already knows about them from elsewhere. Use it only where it genuinely bears on what \
they marked:\n${signals.map((line) => `- ${line}`).join('\n')}`
      : 'There is nothing else on file about them yet, so every reading comes from their marks alone. Do not \
set a source on any reading.',
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
  /*
   * 74 §3.6.18 — say WHICH failure this was.
   *
   * Every sibling phase was given this and the synthesis was missed — and the synthesis is the one the owner
   * reported three times. It returned a bare `degraded` with no reason and no message, so the report printed
   * the same generic sentence whether the model refused, the reply was cut off, or the JSON never parsed.
   * Each repeat report carried no more information than the last, because there was nothing behind it.
   */
  if (!parsed.success) {
    return {
      ok: false,
      degraded: true,
      costUsd: out.usage.costUsd,
      ...classifyParseOutcome(out.text, 'analysis'),
    };
  }
  const data = parsed.data;
  /*
   * A narrative that quotes a boundary back at them is worse than no narrative — but this used to reject the
   * WHOLE thing for a single hit, and the narrative is 6–8 paragraphs. One unlucky word in three thousand
   * discarded the entire analysis, which is what "the psychological analysis didn't come through" was: the
   * model wrote it, and we threw it away. Dropping the offending PARAGRAPH keeps the boundary absolute — no
   * sentence containing it is ever shown — while keeping the rest of the work.
   */
  const narrative = data.narrative
    .split(/\n{2,}/)
    .filter((para) => para.trim() !== '' && !violatesBoundary(lexicon, para))
    .join('\n\n');
  // The lede is the loudest line on the report and the readings sit right under it, so both go through the
  // same filter as the prose — a boundary quoted back at display size is the worst version of that failure.
  const lede = violatesBoundary(lexicon, data.lede) ? '' : data.lede;
  const readings = data.readings
    .filter((r) => !violatesBoundary(lexicon, r.text))
    // A source is a claim about the person's own records; one that names a boundary is dropped with its
    // reading rather than quietly stripped, since the reading was reasoned FROM it.
    .filter((r) => r.source === undefined || !violatesBoundary(lexicon, r.source))
    // With no signals there is nothing a source could honestly cite, so any the model set anyway is dropped
    // rather than shown — the instruction is not the enforcement.
    .map((r) => (signals.length === 0 ? { kind: r.kind, text: r.text } : r));
  // The report LEADS with the lede and the readings; a take that produced those has an analysis, whatever
  // happened to the long prose. Gating on the narrative alone reported a total failure over a good lede and
  // three readings — which is the state the owner kept hitting.
  const gotSomething = narrative !== '' || lede !== '' || readings.length > 0;
  // It WROTE the analysis and our own boundary filter took all of it — which is a completely different thing
  // to tell someone than "the model didn't answer", and the one they can actually act on. `nothingUsable`
  // draws exactly this distinction for the other phases; the synthesis parsed, so this is always our side.
  const filteredOut = !gotSomething
    ? nothingUsable(out.text, 'analysis', true)
    : { reason: undefined, message: undefined };
  return {
    ok: gotSomething,
    ...(filteredOut.reason ? { reason: filteredOut.reason } : {}),
    ...(filteredOut.message ? { message: filteredOut.message } : {}),
    value: {
      narrative,
      lede,
      readings,
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
    degraded: !gotSomething,
    costUsd: out.usage.costUsd,
  };
}

/** Parse a JSON array of strings out of a model reply, salvaging a truncated tail (37). Exported for tests. */
export function parseLines(text: string): string[] {
  const direct = extractJsonArray(text);
  if (Array.isArray(direct)) return direct.filter((x): x is string => typeof x === 'string');
  const obj = LinesSchema.safeParse(extractJsonObject(text));
  if (obj.success && obj.data.lines.length > 0) return obj.data.lines;
  /*
   * 74 §3.6.39 — keep the lines that DID arrive.
   *
   * Same rule the scenario phase got in §3.6.34 and the probe got here: `tolerantArray` inside `LinesSchema`
   * is per-element tolerant, which only helps once the object parses, so a reply cut off mid-array or
   * carrying one bad element lost all six lines. Strings, not objects, so it needs the string twin.
   */
  return salvageJsonStringArrayField(text, 'lines');
}
