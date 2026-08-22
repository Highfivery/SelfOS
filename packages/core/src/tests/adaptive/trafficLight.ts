import type { EroticLexicon, Insight, TestResult } from '../../schemas';

/**
 * 74 §3.6.40 — the traffic-light check-in, removed from the app, including from what it already wrote.
 *
 * The owner cut `consent:colour` ("colour?") and `consent:green-amber-red` ("green / amber / red") from the
 * Dirty Talk bank (2026-08-22). Cutting the ROWS is handled entirely by the existing machinery: an entry
 * whose family is still in the bank but whose key is gone is derived as retired outright by
 * `retireCutMarks`, which `readLexicon` runs on every read — so the marks, and the suppression they carried,
 * go with the words and no migration row is needed (§3.6.25/§3.6.34).
 *
 * What that does NOT reach is **free text**. Three kinds of it survive a bank cut, because none of it is
 * keyed by a bank entry:
 *
 * 1. **The living lexicon's prose** — `themes`, `wantsToSay`, `voice`, `contexts[].note`. Model-written,
 *    merged across takes by `mergeLexicons`, and with **no control anywhere that can remove an item**: the
 *    only edits the app offers are `removeBoundary`, `clearNameSide` and the nuclear delete-all. A stale
 *    string here is the un-gettable-rid-of preference §3.2 abolished, reached through the synthesis instead
 *    of through the bank — and `wantsToSay` is the worst of them, because it feeds `goalSuggestService` and
 *    becomes a `wants-to-say` fact on the derived Insight.
 * 2. **A past take's report** — `narrative`, `lede`, `readings`, `profile`, and the `turns` of the three AI
 *    phases. The marking phases are safe by construction: `recordMarkingPass` stamps ONE summary turn
 *    ("N entries across M families"), never the words, so no amount of marking history mentions a term.
 *    The probe is the realistic case — its whole job is quoting terms the person marked.
 * 3. **The derived Insight's facts** — rebuilt from the lexicon only when a take completes, so a stale one
 *    persists between takes.
 *
 * **Scope, owner-decided (2026-08-22).** The matcher is deliberately broad — *anything* containing
 * `colour`/`color` — chosen with the trade-off stated: it can drop a true sentence that happens to use the
 * word. Measured before choosing: the word appears exactly ONCE in the whole bank (the row being removed),
 * so nothing structural is at risk; the exposure is prose alone. `green / amber / red` contains neither
 * spelling, so the run itself is matched too, or the second row's own text would survive in prose. Also
 * owner-decided: the scrub covers the person's OWN typed answers, not just model-written text.
 *
 * PURE, and a LEAF: types only, so `insights/` can call it without closing a cycle back through
 * `tests/adaptive` (which imports `insights`).
 */

/**
 * Anything naming the traffic-light check-in.
 *
 * Three alternatives, in the order they matter:
 * - `colour` / `color` anywhere, either spelling — the owner's chosen breadth.
 * - the three lights as a run, in either direction, however they are separated (`green / amber / red`,
 *   `green, amber, red`, `green-amber-red`) — this is what catches the second row, whose text contains
 *   neither spelling of colour.
 * - `traffic light`, the name of the protocol itself.
 */
const TRAFFIC_LIGHT =
  /colou?r|\bgreen\b[^a-z0-9]{1,4}\bamber\b[^a-z0-9]{1,4}\bred\b|\bred\b[^a-z0-9]{1,4}\bamber\b[^a-z0-9]{1,4}\bgreen\b|\btraffic[ -]?lights?\b/i;

/** Whether a string names the traffic-light check-in at all. */
export function mentionsTrafficLight(text: string): boolean {
  return TRAFFIC_LIGHT.test(text);
}

/**
 * Split prose into sentences, keeping a continuation attached to the sentence it continues.
 *
 * A naive split on `[.!?]` is actively wrong here, because the thing being removed ENDS IN A QUESTION MARK:
 * "you loved being asked colour? mid-scene, which fits" would split into a matching half and a dangling
 * ", which fits" that survives the filter as a fragment. So a segment that does not begin like a new
 * sentence (a capital, a digit, or an opening quote) is folded back into the previous one.
 */
function sentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  for (const part of parts) {
    if (out.length > 0 && !/^["'“‘([]?[A-Z0-9]/.test(part)) {
      out[out.length - 1] = `${out[out.length - 1]} ${part}`;
      continue;
    }
    out.push(part);
  }
  return out;
}

/**
 * Drop every sentence that names the traffic-light check-in (owner decision: sentence, not paragraph).
 *
 * Paragraph structure is preserved — a report is written in paragraphs and collapsing them would change the
 * shape of the prose as well as its content. A field whose every sentence matches becomes empty; the caller
 * decides what an empty one means, and for `narrative`/`lede`/`voice` that is "absent", which the schema
 * already allows and the report already renders.
 */
export function scrubProse(text: string): string {
  if (!mentionsTrafficLight(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((para) =>
      sentences(para)
        .filter((sentence) => !mentionsTrafficLight(sentence))
        .join(' ')
        .trim(),
    )
    .filter((para) => para !== '')
    .join('\n\n')
    .trim();
}

/** Drop whole list items that name it — a theme or a goal is one string, so there is no sentence to keep. */
export function scrubList(items: readonly string[]): string[] {
  return items.filter((item) => !mentionsTrafficLight(item));
}

/** `undefined` when scrubbing empties the field, so an optional prose field goes absent rather than blank. */
function scrubOptionalProse(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const next = scrubProse(text);
  return next === '' ? undefined : next;
}

/** Whether two optional strings differ — `undefined` and `''` are different states worth noticing. */
function differs(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

/**
 * The living lexicon's free-text fields. Runs inside `resolveLexicon`, which is the single door every read
 * goes through — measured: 7 modules outside this one call `readLexicon` (`chatService`, the books, the
 * emails, questionnaires, challenges, notes and the bridge) — so they all get the cleaned copy, and the one
 * caller that writes back (`orientationForMarking`) persists it.
 */
export function scrubLexiconProse(lexicon: EroticLexicon): {
  lexicon: EroticLexicon;
  changed: boolean;
} {
  const themes = scrubList(lexicon.themes);
  const wantsToSay = scrubList(lexicon.wantsToSay);
  const voice = scrubOptionalProse(lexicon.voice);
  const contexts = Object.fromEntries(
    Object.entries(lexicon.contexts).map(([key, ctx]) => {
      const note = scrubOptionalProse(ctx.note);
      return [key, note === undefined ? { heat: ctx.heat } : { heat: ctx.heat, note }];
    }),
  );
  const changed =
    themes.length !== lexicon.themes.length ||
    wantsToSay.length !== lexicon.wantsToSay.length ||
    differs(voice, lexicon.voice) ||
    differs(contexts, lexicon.contexts);
  if (!changed) return { lexicon, changed: false };
  // Built then deleted, never a conditional spread: `...lexicon` has already carried the OLD `voice` in, so
  // spreading nothing when the scrub empties it leaves the original standing.
  const next: EroticLexicon = { ...lexicon, themes, wantsToSay, contexts };
  if (voice === undefined) delete next.voice;
  else next.voice = voice;
  return { lexicon: next, changed: true };
}

/**
 * A past take, everywhere it can carry the phrase.
 *
 * `turns[].answer` is included on the owner's explicit instruction ("everything, including my own answers"),
 * so a free-text answer the PERSON typed is scrubbed too — a heavier act than editing model output, and
 * recorded as such in §3.6.40. A non-string answer (a mark count, a record, a boolean) can never carry prose
 * and is left exactly as it is; an answer scrubbed to nothing is dropped, which is the same state the schema
 * already uses for "put in front of them, not yet answered", and which `isAnsweredTurn` already handles.
 *
 * Mirrors `healSkippedAnswers`: pure, idempotent, `{ result, changed }`, applied at both read doors.
 */
export function scrubResult(result: TestResult): { result: TestResult; changed: boolean } {
  const next: TestResult = { ...result };
  let changed = false;

  const narrative = scrubOptionalProse(result.narrative);
  if (differs(narrative, result.narrative)) {
    changed = true;
    if (narrative === undefined) delete next.narrative;
    else next.narrative = narrative;
  }

  const lede = scrubOptionalProse(result.lede);
  if (differs(lede, result.lede)) {
    changed = true;
    if (lede === undefined) delete next.lede;
    else next.lede = lede;
  }

  if (result.readings) {
    // A reading whose own text goes entirely is dropped: a keyed reading with no text is not a reading.
    const readings = result.readings
      .map((reading) => {
        const text = scrubProse(reading.text);
        const source = reading.source === undefined ? undefined : scrubProse(reading.source);
        return { ...reading, text, ...(source ? { source } : {}) };
      })
      .filter((reading) => reading.text !== '');
    if (differs(readings, result.readings)) {
      changed = true;
      next.readings = readings;
    }
  }

  if (result.profile) {
    const profile = result.profile;
    const themes = scrubList(profile.themes);
    const wantsToSay = scrubList(profile.wantsToSay);
    const voice = scrubOptionalProse(profile.voice);
    const contexts = Object.fromEntries(
      Object.entries(profile.contexts).map(([key, ctx]) => {
        const note = scrubOptionalProse(ctx.note);
        return [key, note === undefined ? { heat: ctx.heat } : { heat: ctx.heat, note }];
      }),
    );
    if (
      themes.length !== profile.themes.length ||
      wantsToSay.length !== profile.wantsToSay.length ||
      differs(voice, profile.voice) ||
      differs(contexts, profile.contexts)
    ) {
      changed = true;
      // Same trap as the lexicon's: a conditional spread cannot UNSET what `...profile` already carried in.
      const nextProfile = { ...profile, themes, wantsToSay, contexts };
      if (voice === undefined) delete nextProfile.voice;
      else nextProfile.voice = voice;
      next.profile = nextProfile;
    }
  }

  if (result.turns) {
    const turns = result.turns.map((turn) => {
      const text = scrubProse(turn.item.text);
      const options = scrubList(turn.item.options);
      let answer = turn.answer;
      if (typeof answer === 'string') {
        const scrubbed = scrubProse(answer);
        answer = scrubbed === '' ? undefined : scrubbed;
      } else if (Array.isArray(answer)) {
        answer = scrubList(answer);
      }
      const item = { ...turn.item, text, options };
      const out = { ...turn, item };
      if (answer === undefined) delete out.answer;
      else out.answer = answer;
      return out;
    });
    if (differs(turns, result.turns)) {
      changed = true;
      next.turns = turns;
    }
  }

  return changed ? { result: next, changed: true } : { result, changed: false };
}

/**
 * The facts on an adaptive test's derived Insight.
 *
 * Scoped to `source: 'test'` deliberately. Everything else an Insight can be — an onboarding portrait, a
 * session, a dream — is ordinary life data where "colour" is an ordinary word ("her favourite colour"), and
 * running this matcher over it would delete true content for nothing. The test Insight is the only one whose
 * facts are assembled out of the lexicon this change is cleaning.
 */
export function scrubTestInsight(insight: Insight): { insight: Insight; changed: boolean } {
  if (insight.source !== 'test') return { insight, changed: false };
  const facts = insight.facts
    .map((fact) => ({ ...fact, text: scrubProse(fact.text) }))
    .filter((fact) => fact.text !== '');
  if (!differs(facts, insight.facts)) return { insight, changed: false };
  return { insight: { ...insight, facts }, changed: true };
}
