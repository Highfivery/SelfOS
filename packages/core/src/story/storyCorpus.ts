import { listChallenges } from '../challenges';
import { listConversations } from '../conversations/conversationService';
import { listDreams } from '../dreams';
import { listGoals } from '../goals';
import type { FileSystem } from '../host';
import { GOAL_FACT_PREFIX, feedableInsights, listInsightsForPerson } from '../insights';
import { formatIntakeForGeneration, getIntakeSession } from '../intake';
import {
  getPerson,
  listPeople,
  listRelationships,
  listRelatedPeople,
  profileLines,
  relationshipTypesFromSubjectToViewer,
} from '../people';
import { gatherRecipientPriorAnswers } from '../questionnaires';
import {
  factSharedWithViewer,
  type ExclusionItem,
  type InsightSource,
  type StoryCorpusStats,
  type StoryPhotoAnswer,
  type StorySourceRef,
} from '../schemas';
import { getPhotoAnswers, getStoryImageIndex } from './storyService';

/**
 * The Your Story corpus builder (64-your-story §5.1) — the deterministic, AI-free "read EVERYTHING about the
 * subject" pass that feeds the Biographer. It is the ONE place the all-data read lives, and it is scoped
 * STRICTLY to story generation: `buildContext`, coaching, Memory, and every other surface keep their existing
 * shareable-vs-private gates unchanged (the §24 precedent — the all-data read is a story-only exception the
 * owner approved, safe because the draft is private to its subject until they publish, §8.3).
 *
 * The privacy contract (every gate is tested in `storyCorpus.test.ts`):
 *  - The subject's OWN data is read in full — including `restricted` facts (break-glass intake trauma/intimacy)
 *    and locked profile fields — because a truthful biography needs the hard parts and it is the subject's own
 *    book. This is the deliberate difference from `buildContext`, which withholds a person's own restricted
 *    facts from the owner's normal views.
 *  - A `flaggedInaccurate` fact is NEVER included (it's wrong, not private) — dropped everywhere; a
 *    WHOLLY-flagged insight is dropped ENTIRELY (its summary restates the corrected claim), mirroring
 *    `summarizeForContext` (the spec-40 wholly-flagged blocker).
 *  - A muted dream (`informsContext: false`) contributes nothing — neither its narrative nor its insight
 *    (`feedableInsights` drops the insight; the dream filter drops the narrative).
 *  - Test material enters ONLY via the test-sourced Insight (display bands / gentle facts) — raw `TestResult`
 *    files are never read, so the internal `clinicalKey` (spec-51, never-shown) is structurally absent.
 *  - Other people appear only as characters the subject describes, plus the facts those people SHARE to this
 *    viewer through `factSharedWithViewer` (broadcast / per-person / relationship-type-scoped, never
 *    `restricted`, never flagged) — a related person's private data never enters the corpus.
 *  - Together partner material is covered by the subject's own Together wrap-up twin insight (subject = the
 *    subject; asides are excluded from the wrap-up analysis, 58 §3.8), so a partner's private aside is
 *    structurally absent. (Reading own Together asides/agreements/pulse directly for richer sourcing, §5.1, is
 *    a later slice; the twin insight is the v1 path.)
 *  - The exclusion list filters at THIS boundary, so an excluded topic/person/source can never be
 *    reintroduced by a later rewrite (§3.3). A `person` exclusion drops BOTH cross-shared facts about them AND
 *    the subject's own free-text mentions of their name.
 *
 * Resilience (§7): each source is read behind its own guard, so one corrupt/unreadable file degrades that one
 * source (its data is omitted — fail-CLOSED, never leaked) rather than blanking the whole biography.
 */

/** One piece of source material with its provenance — the biographer's citation substrate. */
export interface CorpusItem {
  /** Where it came from (deep-linkable). */
  sourceRef: StorySourceRef;
  /** A short human descriptor for the provenance popover (e.g. "From a coaching session"). */
  label: string;
  /** The material itself (a fact, an answer, a narrative excerpt, a goal). */
  text: string;
  /** The life-area, when known (from LIFE_AREAS) — for organizing the corpus. */
  lifeArea?: string;
  /** An ISO/partial date for chronology, when known. */
  date?: string;
  /** For cross-shared items only: the related person this is about (so a `person` exclusion can drop it). */
  aboutPersonId?: string;
}

/** The assembled corpus fed to the Biographer (§5.2). Host-side only — never crosses IPC, so it lives here
 *  as a plain interface, not in the schemas shim. */
export interface StoryCorpus {
  personName: string;
  /** The subject's own full profile (every populated field, including locked ones — their own book). */
  profile: string[];
  /** Everything else, each carrying provenance. */
  items: CorpusItem[];
}

/** A human label for an insight's origin (for the provenance popover). */
function insightLabel(source: InsightSource): string {
  switch (source) {
    case 'session':
      return 'From a coaching session';
    case 'dream':
      return 'From a dream reflection';
    case 'intake':
      return 'From your onboarding portrait';
    case 'test':
      return 'From a self-reflection you took';
    case 'questionnaire':
      return 'From a questionnaire';
    case 'together':
      return 'From a session with your partner';
    default:
      return 'From your history';
  }
}

/** Run a source read behind a guard so one corrupt/unreadable file omits only that source (fail-closed). */
async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Build the exclusion predicates once (§3.3). `person`/`source` are structural drops; `topic`/`passage` and
 *  the display NAME of each excluded person are text-avoidance phrases applied to both item text and profile
 *  lines, so an excluded person's own-material mentions are dropped too — not just cross-shared facts. */
function makeExclusionFilter(
  exclusions: ExclusionItem[],
  personNames: Map<string, string>,
): {
  keepItem: (item: CorpusItem) => boolean;
  keepProfileLine: (line: string) => boolean;
} {
  const persons = new Set(exclusions.filter((e) => e.kind === 'person').map((e) => e.value));
  const sources = new Set(exclusions.filter((e) => e.kind === 'source').map((e) => e.value));
  // `topic`/`passage` phrases + each excluded person's display name → text-avoidance. A phrase must be ≥ 2
  // chars so a pathological 1-char exclusion can't blank the book (it still errs toward over-removal).
  const phrases = [
    ...exclusions.filter((e) => e.kind === 'topic' || e.kind === 'passage').map((e) => e.value),
    ...[...persons].map((id) => personNames.get(id) ?? '').filter((name) => name.length > 0),
  ]
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length >= 2);
  const hasPhrase = (text: string): boolean => {
    if (phrases.length === 0) return false;
    const lower = text.toLowerCase();
    return phrases.some((p) => lower.includes(p));
  };
  return {
    keepItem: (item) => {
      if (item.aboutPersonId && persons.has(item.aboutPersonId)) return false;
      if (sources.has(item.sourceRef.id)) return false;
      if (hasPhrase(item.text)) return false;
      return true;
    },
    keepProfileLine: (line) => !hasPhrase(line),
  };
}

/**
 * Assemble the subject's complete story corpus. `bookId` scopes the book-local sources (the photo Q&A in
 * `interview.enc`); `exclusions` is the person's saved exclusion list (read from `exclusions.enc` by the
 * caller — an empty list when none). No AI, no writes.
 */
export async function buildStoryCorpus(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  exclusions: ExclusionItem[] = [],
): Promise<StoryCorpus> {
  const person = await getPerson(fs, key, personId);
  if (!person) return { personName: '', profile: [], items: [] };

  // Resolve every household person's display name so a `person` exclusion can also avoid their name in text.
  const people = await safely(() => listPeople(fs, key), []);
  const personNames = new Map(people.map((p) => [p.id, p.displayName]));
  const { keepItem, keepProfileLine } = makeExclusionFilter(exclusions, personNames);
  const items: CorpusItem[] = [];
  const add = (item: CorpusItem): void => {
    if (keepItem(item)) items.push(item);
  };

  // 1) Onboarding intake — the richest single source (raw answers across every section, INCLUDING the
  //    restricted "what weighs on you" + intimacy sections; own data, so it's included in full). The
  //    distilled portrait rides in as an insight below; this is the raw material beneath it.
  const intake = await safely(() => getIntakeSession(fs, key, personId), null);
  if (intake) {
    const intakeText = formatIntakeForGeneration(intake).text.trim();
    if (intakeText) {
      add({
        sourceRef: { kind: 'intakeAnswer', id: intake.id },
        label: 'From your onboarding',
        text: intakeText,
        date: intake.completedAt ?? intake.startedAt,
      });
    }
  }

  // 2) The Insight layer — the provenance-tagged spine (sessions, dreams, tests, questionnaires, Together,
  //    the intake portrait — all already distilled + life-area-tagged). Own approved + still-feedable
  //    insights only. INCLUDE restricted facts (own data — the story exception); DROP flagged facts; DROP a
  //    goal-prefixed fact (goals come from `listGoals` below, so they're not double-counted).
  const ownInsights = await safely(
    async () =>
      feedableInsights(
        fs,
        key,
        (await listInsightsForPerson(fs, key, personId)).filter((insight) => insight.approved),
      ),
    [],
  );
  for (const insight of ownInsights) {
    const liveFacts = insight.facts.filter((fact) => !fact.flaggedInaccurate);
    // A WHOLLY-flagged insight (had facts, all now flagged) is dropped ENTIRELY — its summary restates the
    // corrected claim, so it must not reach the Biographer either (mirrors `summarizeForContext`). A MIXED
    // insight keeps its summary + its live facts.
    if (insight.facts.length > 0 && liveFacts.length === 0) continue;
    const label = insightLabel(insight.source);
    const at = insight.provenance.at;
    if (insight.summary.trim()) {
      add({
        sourceRef: { kind: 'insight', id: insight.id, at },
        label,
        text: insight.summary,
        ...(insight.categories[0] ? { lifeArea: insight.categories[0] } : {}),
        date: at,
      });
    }
    for (const fact of liveFacts) {
      if (fact.text.startsWith(GOAL_FACT_PREFIX)) continue; // goals come from listGoals
      add({
        sourceRef: { kind: 'insight', id: insight.id, at },
        label,
        text: fact.text,
        ...(fact.lifeArea ? { lifeArea: fact.lifeArea } : {}),
        date: at,
      });
    }
  }

  // 3) Goals — the person's commitments and where they stand.
  for (const goal of await safely(() => listGoals(fs, key, personId), [])) {
    const due = goal.due ? ` (due ${goal.due})` : goal.horizon ? ` (${goal.horizon})` : '';
    add({
      sourceRef: { kind: 'goal', id: goal.id, at: goal.updatedAt },
      label: 'A goal you set',
      text: `${goal.text} — ${goal.status}${due}`,
      ...(goal.lifeArea ? { lifeArea: goal.lifeArea } : {}),
      date: goal.updatedAt,
    });
  }

  // 4) Challenges — stretch actions taken, with their reflections/outcomes.
  for (const challenge of await safely(() => listChallenges(fs, key, personId), [])) {
    const reflection = challenge.reflection?.trim()
      ? ` Reflection: ${challenge.reflection.trim()}`
      : '';
    const outcome = challenge.outcome ? ` (${challenge.outcome})` : '';
    add({
      sourceRef: { kind: 'challenge', id: challenge.id, at: challenge.updatedAt },
      label: 'A challenge you took on',
      text: `${challenge.action} — ${challenge.status}${outcome}.${reflection}`,
      ...(challenge.lifeArea ? { lifeArea: challenge.lifeArea } : {}),
      date: challenge.agreedAt ?? challenge.updatedAt,
    });
  }

  // 5) Dreams — the raw narratives (the analysis rides in via its insight above). A muted dream
  //    (`informsContext: false`) contributes nothing — the same non-destructive mute as coaching context.
  for (const dream of await safely(() => listDreams(fs, key, personId), [])) {
    if (dream.informsContext === false) continue;
    const title = dream.title?.trim() ? `${dream.title.trim()}: ` : '';
    add({
      sourceRef: { kind: 'dream', id: dream.id, at: dream.dreamDate ?? dream.createdAt },
      label: 'A dream you recorded',
      text: `${title}${dream.narrative}`,
      date: dream.dreamDate ?? dream.createdAt,
    });
  }

  // 6) Raw questionnaire / check-in answers the person gave (their own answers to anything sent to them,
  //    including their auto check-ins — the verbatim material beneath the distilled questionnaire insights).
  //    A single lumped block (per-assignment provenance is a later refinement).
  const priorAnswers = (
    await safely(() => gatherRecipientPriorAnswers(fs, key, personId), '')
  ).trim();
  if (priorAnswers) {
    add({
      sourceRef: { kind: 'response', id: personId },
      label: 'Answers you gave to check-ins',
      text: priorAnswers,
    });
  }

  // 7) Photos the person ANSWERED about (§3.7) — one item per photo the person gave ≥1 answer for, holding its
  //    caption + every answer (the answers are their verbatim, first-person words). This is the §13.6.2 wiring
  //    gap the redesign audit found: §3.7 promised these feed generation, but the corpus never read them. A
  //    photo that was only vision-captioned but never answered contributes NOTHING — a bare AI caption is the
  //    model's guess, not the subject's words, so it's not fed back as "source material". Exclusion-filtered via
  //    `add()` (a `source` exclusion on the imageId drops the photo). Book-scoped via `bookId`.
  const photoAnswers = await safely(() => getPhotoAnswers(fs, key, personId, bookId), []);
  if (photoAnswers.length > 0) {
    const imageIndex = await safely(() => getStoryImageIndex(fs, key, personId, bookId), null);
    const captionOf = new Map((imageIndex?.images ?? []).map((img) => [img.id, img.caption ?? '']));
    const byImage = new Map<string, StoryPhotoAnswer[]>();
    for (const answer of photoAnswers) {
      byImage.set(answer.imageId, [...(byImage.get(answer.imageId) ?? []), answer]);
    }
    for (const [imageId, answers] of byImage) {
      const caption = captionOf.get(imageId)?.trim() ?? '';
      const qa = answers.map((a) => `${a.question} ${a.answer}`.trim()).filter((s) => s.length > 0);
      const text = [caption ? `Photo — ${caption}` : 'A photo I shared', ...qa].join('. ');
      const last = answers[answers.length - 1];
      const at = last?.at;
      add({
        sourceRef: { kind: 'photo', id: imageId, ...(at ? { at } : {}) },
        label: 'From a photo you shared',
        text,
        ...(at ? { date: at } : {}),
      });
    }
  }

  // 8) Other people as characters — ONLY the facts they SHARE to this viewer (§5.1). The single gate
  //    `factSharedWithViewer` (broadcast / per-person / relationship-type-scoped) excludes every restricted
  //    or flagged fact and everything not shared, so a related person's private data never enters the corpus.
  const relationships = await safely(() => listRelationships(fs, key), []);
  for (const related of await safely(() => listRelatedPeople(fs, key, personId), [])) {
    const granted = relationshipTypesFromSubjectToViewer(related.id, personId, relationships);
    const theirInsights = await safely(
      async () =>
        feedableInsights(
          fs,
          key,
          (await listInsightsForPerson(fs, key, related.id)).filter((insight) => insight.approved),
        ),
      [],
    );
    for (const insight of theirInsights) {
      for (const fact of insight.facts) {
        if (!factSharedWithViewer(fact, personId, granted)) continue;
        add({
          sourceRef: { kind: 'insight', id: insight.id, at: insight.provenance.at },
          label: `About ${related.displayName}`,
          text: fact.text,
          ...(fact.lifeArea ? { lifeArea: fact.lifeArea } : {}),
          date: insight.provenance.at,
          aboutPersonId: related.id,
        });
      }
    }
  }

  return {
    personName: person.displayName,
    profile: profileLines(person, 'self').filter(keepProfileLine),
    items,
  };
}

/**
 * Deterministic, no-AI counts for the "before you begin" invitation (§13.6.10) — how much material the
 * biographer will draw from, with the span of years it touches. Never any content, just counts + a year range,
 * so it's cheap + safe to show before a book exists. Each source is read behind its own guard (§7 resilience).
 */
export async function getStoryCorpusStats(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<StoryCorpusStats> {
  const conversations = await safely(() => listConversations(fs, key, personId), []);
  const insights = (await safely(() => listInsightsForPerson(fs, key, personId), [])).filter(
    (insight) => insight.approved,
  );
  const dreams = await safely(() => listDreams(fs, key, personId), []);

  // The year span across everything dated — a conversation's createdAt, a dream's dreamDate/createdAt, an
  // insight's provenance timestamp. A malformed/absent date just doesn't widen the span.
  const years: number[] = [];
  const addYear = (iso: string | undefined): void => {
    if (!iso) return;
    // UTC year, so a stored `...T00:00:00.000Z` date resolves to the year it was stored as (not the local
    // year, which would slip to the prior year in any timezone behind UTC).
    const y = new Date(iso).getUTCFullYear();
    if (Number.isFinite(y)) years.push(y);
  };
  for (const c of conversations) addYear(c.createdAt);
  for (const d of dreams) addYear(d.dreamDate ?? d.createdAt);
  for (const i of insights) addYear(i.provenance.at);

  const stats: StoryCorpusStats = {
    conversations: conversations.length,
    reflections: insights.length,
    dreams: dreams.length,
  };
  if (years.length > 0) {
    stats.yearFrom = Math.min(...years);
    stats.yearTo = Math.max(...years);
  }
  return stats;
}

/** Flatten a corpus to a single string (profile + every item) — used by the prompt builder (§5.2) and by
 *  tests asserting a value is present/absent. */
export function corpusText(corpus: StoryCorpus): string {
  return [corpus.personName, ...corpus.profile, ...corpus.items.map((i) => i.text)].join('\n');
}
