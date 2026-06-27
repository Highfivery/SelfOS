import { z } from 'zod';
import {
  classifyParseFailure,
  extractJsonObject,
  salvageJsonObjectArrayField,
  salvageJsonObjectField,
} from '../ai/jsonSalvage';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import {
  IntakeSessionSchema,
  LIFE_AREAS,
  type IntakeAnswerValue,
  matrixRowKey,
  matrixRowLabel,
  type Insight,
  type IntakeSession,
  type IntakeSection,
  type IntakeSynthesisResult,
  type IntakeTurnResult,
  type InsightFact,
  type Person,
  type PersonFieldKey,
  type Question,
  type RelationshipType,
  type UsageEvent,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { buildContext, getPerson, savePerson } from '../people';
import { FORMATTING, PERSONA, SAFETY } from '../conversations/promptBuilder';
import { checkBudget, costOf, recordUsage } from '../usage';
import { getInsight, normalizeCategories, saveInsight } from '../insights';
import { isAnswered, isQuestionVisible, type AnswerMap } from '../questionnaires/answering';
import { activityRowContext, withResolvedActivityRows } from './activityContext';
import { migrateActivityMatrixValue } from '../intimacy/activityRows';
import { defaultScopeForQuestion, effectiveAnswerScope } from './sharingCategory';
import {
  INTAKE_CATALOG,
  buildInterviewerAddendum,
  getIntakeSection,
  type IntakeFormQuestion,
  type IntakeSectionDef,
} from './intakeCatalog';
import { intakeAnswerHashes } from './portraitFreshness';

/**
 * Personal-onboarding intake service (18-personal-onboarding §5/§14). A hybrid, resumable self-onboarding:
 * `submitSectionForm` handles structured **form** sections (instant, NO AI) — it fills the mapped owner-only
 * `Person` fields (sensitive ones locked own-context-only) and persists the answers; `runIntakeTurn` handles
 * **chat** sections + go-deeper, reusing `05`'s streaming + `06`'s metering (`intake.interview`) and storing
 * the transcript UNDER the person (never in Sessions). `synthesizeIntake` distils a section (a light
 * reflection) or the whole intake (the portrait `Insight`, `source: 'intake'`, weaving in BOTH the chat
 * transcripts and the form answers) — metering `intake.synthesize` before parse (`09` pattern). Facts from
 * `restricted` sections are flagged from the trusted catalog (never the model) so they show only to the Owner
 * (`intake.readRestricted`), redacted for everyone else (§8.4). The API key never leaves the host.
 */

const SCHEMA_VERSION = 1;
const intakePath = (personId: string): string => `people/${personId}/intake/session.enc`;

// --- Persistence ---

/** Load the person's intake session, or null if they've never started. */
export async function getIntakeSession(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<IntakeSession | null> {
  const raw = await readEncryptedJson(fs, intakePath(personId), key);
  return raw ? IntakeSessionSchema.parse(raw) : null;
}

function freshSession(personId: string, at: string): IntakeSession {
  return {
    id: uuid(),
    schemaVersion: SCHEMA_VERSION,
    personId,
    status: 'inProgress',
    sections: INTAKE_CATALOG.map(
      (def): IntakeSection => ({
        id: def.id,
        status: 'notStarted',
        restricted: def.restricted,
        messages: [],
        answers: {},
      }),
    ),
    startedAt: at,
    updatedAt: at,
  };
}

/**
 * Load the person's intake session, creating + persisting a fresh one (sections seeded from the catalog) if
 * absent. Also reconciles the section list against the catalog — a section added to the catalog after the
 * session was created is appended (notStarted), so a returning person picks up new sections.
 */
export async function ensureIntakeSession(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
): Promise<IntakeSession> {
  const at = now.toISOString();
  const existing = await getIntakeSession(fs, key, personId);
  if (!existing) {
    const session = freshSession(personId, at);
    await writeEncryptedJson(fs, intakePath(personId), session, key);
    return session;
  }
  const known = new Set(existing.sections.map((s) => s.id));
  const missing = INTAKE_CATALOG.filter((def) => !known.has(def.id));
  if (missing.length === 0) return existing;
  const reconciled: IntakeSession = {
    ...existing,
    sections: [
      ...existing.sections,
      ...missing.map(
        (def): IntakeSection => ({
          id: def.id,
          status: 'notStarted',
          restricted: def.restricted,
          messages: [],
          answers: {},
        }),
      ),
    ],
    updatedAt: at,
  };
  await writeEncryptedJson(fs, intakePath(personId), reconciled, key);
  return reconciled;
}

// --- Streaming markers (chat) ---

const FIELD_MARKER = /\[\[SELFOS:FIELD:([a-zA-Z]+)=([^\]]*)\]\]/g;

/**
 * Strip any hidden `[[SELFOS:FIELD:…]]` markers (+ now-empty trailing lines / an unclosed trailing fragment)
 * from a reply. The redesign fills fields from forms (§14.6), so chat replies no longer carry markers — but the
 * renderer still calls this on the streaming buffer, so it stays a safe no-op-when-clean strip.
 */
export function stripIntakeFieldMarkers(text: string): string {
  return text
    .replace(FIELD_MARKER, '')
    .replace(/\[\[SELFOS:FIELD:[^\]]*$/, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- Form sections (structured answers → profile + intake, §14.6) ---

/** Coerce an answer to a display string (single/text passthrough; multi joined; bool/number stringified). */
function answerToString(value: IntakeAnswerValue | undefined): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) {
    // Object-row arrays (dateList {label,date} / roster {col→value}) → each row's values joined by ", ",
    // rows by "; " (e.g. "Emma, Girl, 7; Liam, Boy, 4") — so the portrait reads them, not "[object Object]".
    if (value.some((it) => it !== null && typeof it === 'object')) {
      return value
        .map((row) =>
          Object.values(row as Record<string, string>)
            .map((v) => String(v).trim())
            .filter(Boolean)
            .join(', '),
        )
        .filter(Boolean)
        .join('; ');
    }
    // String list (multi) → comma-join (preserves the ethnicity/gender etc. string-field behavior).
    return value
      .map((s) => String(s).trim())
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  // A keyed map (matrix row→point, allocation bucket→amount) → "key: value; …" so it never reads
  // "[object Object]" in the portrait. A matrix's points are mapped to their labels by the caller (the
  // synthesis path) when it has them; this is the defensive fallback.
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${String(v).trim()}`)
      .filter((s) => !s.endsWith(': '))
      .join('; ');
  }
  return String(value).trim();
}

/** The display labels for a labelled matrix's points (the N-point `pointLabels`, else the 3-label
 * min/mid/maxLabel fallback) — or null for a plain numbered matrix. */
function matrixLabels(matrix: NonNullable<Question['matrix']>): string[] | null {
  const span = matrix.max - matrix.min + 1;
  if (matrix.pointLabels && matrix.pointLabels.length === span) return matrix.pointLabels;
  const { min, max, minLabel, midLabel, maxLabel } = matrix;
  if (max - min === 2 && minLabel && midLabel && maxLabel) return [minLabel, midLabel, maxLabel];
  return null;
}

/** Map a labelled matrix (the intake activity matrix) answer to readable label text for the synthesis
 * input — "oral: Love it; choking: Hard no" — so the portrait captures the meaning, not "1/5". Falls back to
 * {@link answerToString} for a non-matrix / unlabelled-matrix answer. */
function formatAnswerForSynthesis(q: Question, value: IntakeAnswerValue | undefined): string {
  if (q.type !== 'matrix' || !q.matrix || value === null || typeof value !== 'object') {
    return answerToString(value);
  }
  const labels = matrixLabels(q.matrix);
  if (!labels || Array.isArray(value)) return answerToString(value);
  const { min, rows } = q.matrix;
  // The activity-matrix rows now carry stable keys (46 §4.2) re-resolved from anatomy; a pre-46 answer is keyed
  // by old label strings, so migrate it to stable keys first (idempotent for an already-stable value). A rating
  // stored under a key the current rows no longer include (an "orphaned" key — e.g. a neutral giving row after
  // partner anatomy was added) is appended verbatim so a re-synthesis never silently drops a prior rating. Scope
  // the legacy re-key to the `activities` matrix (the only intake matrix) so a future intake matrix whose row
  // label happens to collide with an intimacy label is never silently re-keyed.
  const map =
    q.id === 'activities'
      ? migrateActivityMatrixValue(value as Record<string, number>)
      : (value as Record<string, number>);
  const labelByKey = new Map(rows.map((r) => [matrixRowKey(r), matrixRowLabel(r)]));
  const orphaned = Object.keys(map).filter((k) => !labelByKey.has(k));
  return [...labelByKey.keys(), ...orphaned]
    .map((key) => {
      const point = map[key];
      if (typeof point !== 'number') return null;
      return `${labelByKey.get(key) ?? key}: ${labels[point - min] ?? point}`;
    })
    .filter((s): s is string => s !== null)
    .join('; ');
}

/** Intake answeredness. The shared `isAnswered` treats a `matrix` as answered only when EVERY row is rated
 * (correct for a short required questionnaire matrix), but the intake's activity matrix is long and
 * optional — a person rates only the rows that apply. So for a matrix the intake counts it answered when ANY
 * row is rated; every other type delegates to the shared check. */
function intakeAnswered(q: Question, value: IntakeAnswerValue | undefined): boolean {
  if (q.type === 'matrix') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).some((v) => typeof v === 'number');
  }
  return isAnswered(q, value);
}

/**
 * Fill the mapped owner-only `Person` fields from a section's clean answers, **grouping by target field** so
 * multiple questions can contribute to ONE field without clobbering (§14.6): a `list` field concatenates
 * (deduped), a `dateList` answer fills `importantDates`, and a plain string field **joins** its contributors
 * in question order (e.g. healthNotes = physical conditions + the "anything else" catch-all). Idempotent —
 * re-submitting a section rebuilds each field from the current answers (never appends a duplicate). A field
 * with any `private` contributor is locked own-context-only. Returns whether the person changed.
 */
function fillPersonFields(
  person: Person,
  def: IntakeSectionDef,
  clean: Record<string, IntakeAnswerValue>,
): boolean {
  if (!def.questions) return false;
  const groups = new Map<PersonFieldKey, IntakeFormQuestion[]>();
  for (const m of def.questions) {
    if (!m.field || clean[m.q.id] === undefined) continue;
    const arr = groups.get(m.field) ?? [];
    arr.push(m); // def.questions order is preserved → stable join order
    groups.set(m.field, arr);
  }
  let changed = false;
  for (const [field, ms] of groups) {
    // Branch precedence: dateList → list → string. Every Person field is single-typed today, so a field
    // never mixes a dateList question with a string/list one; if that ever changes, the dateList branch
    // would win and drop the others — keep one type per target field.
    let next: unknown;
    if (ms.some((m) => m.q.type === 'dateList')) {
      const dates = ms
        .flatMap((m): unknown[] => {
          const v = clean[m.q.id];
          return Array.isArray(v) ? v : [];
        })
        .filter(
          (e): e is { label: string; date: string } =>
            e !== null && typeof e === 'object' && 'label' in e && 'date' in e,
        )
        .map((e) => ({ label: String(e.label).trim(), date: String(e.date).trim() }))
        .filter((e) => e.label && e.date);
      if (dates.length === 0) continue;
      next = dates;
    } else if (ms.some((m) => m.list)) {
      const items = ms
        .flatMap((m) => {
          const v = clean[m.q.id];
          return Array.isArray(v) ? v.map((s) => String(s).trim()) : [];
        })
        .filter(Boolean);
      const dedup = [...new Set(items)];
      if (dedup.length === 0) continue;
      next = dedup;
    } else {
      const parts = ms.map((m) => answerToString(clean[m.q.id])).filter(Boolean);
      if (parts.length === 0) continue;
      next = parts.join('\n');
    }
    (person as Record<string, unknown>)[field] = next;
    changed = true;
    // Sensitive promoted fields (e.g. sexualOrientation/healthNotes) lock own-context-only.
    if (ms.some((m) => m.private)) {
      const locked = new Set(person.privateFields ?? []);
      locked.add(field);
      person.privateFields = [...locked];
    }
  }
  return changed;
}

/**
 * Submit a structured **form** section (§14.6): keep only answers for THIS section's catalog questions that
 * are actually answered (the trust boundary — the renderer can't fill arbitrary fields), persist them under
 * the person, fill any mapped owner-only `Person` fields (sensitive ones locked own-context-only), and mark
 * the section complete. **No AI call** — forms are instant + free; the portrait synthesis later weaves the
 * answers in (restricted ones → restricted facts, §14.8). A chat section is ignored.
 */
export async function submitSectionForm(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  sectionId: string,
  answers: Record<string, IntakeAnswerValue>,
  now: Date,
  /**
   * Per-question relationship-type sharing scopes (43 §3.4/§4). Any answered question NOT named here defaults
   * to its category preset (`defaultScopeForQuestion`), so a person who never touches the chip still shares
   * per the visible default. The resolved scope is stored explicitly on `section.answerSharing`.
   */
  sharing?: Record<string, RelationshipType[]>,
  /**
   * Whether to mark the section **complete** (default `true` — the Continue/Done button). The auto-save passes
   * `false` to persist a **draft** (answers + answerSharing) as the person edits, WITHOUT prematurely completing
   * a first-time section (which is what triggers the portrait flow). A draft just moves `notStarted`→`inProgress`.
   */
  markComplete = true,
): Promise<IntakeSession> {
  const def = getIntakeSection(sectionId);
  const session = await ensureIntakeSession(fs, key, personId, now);
  const section = session.sections.find((s) => s.id === sectionId);
  if (!def || !def.questions || !section) return session; // not a form section
  const at = now.toISOString();

  const byId = new Map(def.questions.map((m) => [m.q.id, m]));
  const clean: Record<string, IntakeAnswerValue> = {};
  for (const [qid, value] of Object.entries(answers)) {
    const m = byId.get(qid);
    if (!m) continue; // ignore anything not in this section's catalog
    if (!intakeAnswered(m.q, value)) continue; // skip blanks / unanswered
    clean[qid] = value;
  }

  const person = await getPerson(fs, key, personId);
  if (person && fillPersonFields(person, def, clean)) {
    await savePerson(fs, key, { ...person, updatedAt: at });
  }

  section.answers = { ...section.answers, ...clean };
  // Resolve + persist a sharing scope for every question the person has ANSWERED *or* explicitly SCOPED (the
  // renderer sends a scope for each question in `sharing`). Persisting an explicit scope for a not-yet-answered
  // question is how "share this whole section with Partner" sticks the MOMENT it's clicked — before anything is
  // filled in (the reported bug: a fresh-section bulk-share saved nothing because it keyed off answers only). It
  // stays safe: an unanswered question has no derived fact, so a scope on it shares nothing until it's answered,
  // at which point the person's pre-set choice (e.g. Partner) is honored instead of silently reverting to the
  // category default. The renderer's choice wins, else a prior stored scope, else the category preset.
  const scopedQids = new Set([...Object.keys(section.answers), ...Object.keys(sharing ?? {})]);
  const nextSharing: Record<string, RelationshipType[]> = {};
  for (const qid of scopedQids) {
    if (!byId.has(qid)) continue; // only this section's catalog questions
    const chosen =
      sharing?.[qid] ?? section.answerSharing?.[qid] ?? defaultScopeForQuestion(sectionId, qid);
    nextSharing[qid] = dedupeTypes(chosen);
  }
  section.answerSharing = nextSharing;
  if (markComplete) {
    if (section.status !== 'skipped') section.status = 'complete';
  } else if (section.status === 'notStarted') {
    // A draft auto-save: the person has started this section, but don't complete it (that's the explicit
    // Continue) and never un-complete an already-complete/skipped one — only nudge notStarted → inProgress.
    section.status = 'inProgress';
  }
  session.updatedAt = at;
  await writeEncryptedJson(fs, intakePath(personId), session, key);
  return session;
}

/** De-dupe a scope, preserving order (the bridge Zod-validates the types themselves). */
function dedupeTypes(types: readonly RelationshipType[]): RelationshipType[] {
  return [...new Set(types)];
}

/**
 * Set (or clear) the sharing scope for ONE already-answered intake question (44-memory-dashboard §3.5).
 * Powers the transparency surface's per-answer `RelationshipScopePicker`: changing the scope updates
 * `section.answerSharing[questionId]` directly, without re-submitting the whole section. An empty `types`
 * clears the scope (own-only). Returns the updated session, or null when the section/answer is gone (so the
 * picker can't scope a phantom answer). It does NOT touch the answer VALUE or the derived portrait FACT —
 * the fact's own `shareableTypes` is edited separately via `insights:update` (§3.4); a later "Refresh
 * memory" re-derives the fact scope from this. The caller (bridge) scopes this to the active person's OWN
 * intake — a person can only change their own sharing.
 */
export async function setIntakeAnswerSharing(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  sectionId: string,
  questionId: string,
  types: readonly RelationshipType[],
  now: Date,
): Promise<IntakeSession | null> {
  const session = await getIntakeSession(fs, key, personId);
  if (!session) return null;
  const section = session.sections.find((s) => s.id === sectionId);
  if (!section || section.answers[questionId] === undefined) return null;
  const nextSharing = { ...(section.answerSharing ?? {}) };
  if (types.length === 0) delete nextSharing[questionId];
  else nextSharing[questionId] = dedupeTypes(types);
  section.answerSharing = nextSharing;
  session.updatedAt = now.toISOString();
  await writeEncryptedJson(fs, intakePath(personId), session, key);
  return session;
}

// --- Budget helper ---

async function overBudget(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
  override: boolean | undefined,
): Promise<boolean> {
  const person = await checkBudget(fs, key, { scope: 'person', personId, now, override });
  const app = await checkBudget(fs, key, { scope: 'app', now, override });
  return person.state === 'over' || app.state === 'over';
}

function buildUsage(
  type: 'intake.interview' | 'intake.synthesize',
  model: string,
  sessionId: string,
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
    type,
    personId,
    sessionId,
    model,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(model, usage),
  };
}

/** Assemble the interviewer system prompt: persona + safety + the person's OWN context + the addendum. */
async function buildIntakeSystem(
  fs: FileSystem,
  key: Uint8Array,
  person: Person,
  sectionId: string,
): Promise<string | null> {
  const def = getIntakeSection(sectionId);
  if (!def) return null;
  const context = await buildContext(fs, key, person.id);
  return [PERSONA, SAFETY, context, buildInterviewerAddendum(person.displayName, def), FORMATTING]
    .filter(Boolean)
    .join('\n\n');
}

// --- Interview turn ---

export interface IntakeTurnDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  sectionId: string;
  userText: string;
  onDelta: (text: string) => void;
  now: Date;
  override?: boolean;
}

/**
 * One adaptive interview turn (§3.2): budget-check, stream the interviewer reply, apply any direct field
 * markers to the profile, append both messages to the section transcript (under the person, never in
 * Sessions), and meter `intake.interview`. The static opener is sourced from the catalog (not stored), so
 * it's prepended to the model messages each turn but never duplicated into the transcript.
 */
export async function runIntakeTurn(deps: IntakeTurnDeps): Promise<IntakeTurnResult> {
  const { fs, key, client, apiKey, model, personId, sectionId, userText, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const def = getIntakeSection(sectionId);
  if (!def) return { ok: false, reason: 'ERROR', message: 'That section could not be found.' };

  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const person = await getPerson(fs, key, personId);
  if (!person) return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };

  const at = now.toISOString();
  const session = await ensureIntakeSession(fs, key, personId, now);
  const section = session.sections.find((s) => s.id === sectionId);
  if (!section) return { ok: false, reason: 'ERROR', message: 'That section could not be found.' };

  const system = await buildIntakeSystem(fs, key, person, sectionId);
  if (!system) return { ok: false, reason: 'ERROR', message: 'That section could not be found.' };

  const messages = [
    { role: 'assistant' as const, content: def.opener },
    ...section.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userText },
  ];

  let result;
  try {
    result = await client.stream(
      { apiKey, model, system, messages, maxTokens: 1024 },
      deps.onDelta,
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The interviewer couldn’t respond. Please try again.',
    };
  }

  // Meter the paid call the moment it returns (06).
  const usage = buildUsage('intake.interview', model, session.id, personId, at, result.usage);
  await recordUsage(fs, key, usage);

  // Chat replies no longer carry field markers (forms fill fields, §14.6); strip defensively anyway.
  const clean = stripIntakeFieldMarkers(result.text);

  section.messages.push({ role: 'user', content: userText, ts: at });
  section.messages.push({ role: 'assistant', content: clean, ts: at });
  if (section.status === 'notStarted') section.status = 'inProgress';
  session.updatedAt = at;
  await writeEncryptedJson(fs, intakePath(personId), session, key);

  return { ok: true, session, usage };
}

// --- Skip ---

/** Skip a whole section (§3.2) — never blocks completion. Returns the updated session. */
export async function skipIntakeSection(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  sectionId: string,
  now: Date,
): Promise<IntakeSession> {
  const session = await ensureIntakeSession(fs, key, personId, now);
  const section = session.sections.find((s) => s.id === sectionId);
  if (section) section.status = 'skipped';
  session.updatedAt = now.toISOString();
  await writeEncryptedJson(fs, intakePath(personId), session, key);
  return session;
}

// --- Synthesis ---

/**
 * Recover a usable portrait from a TRUNCATED reply (fix 2026-06-23, issue #19): on a maximal intake the model
 * can emit a portrait JSON that exceeds the output budget and gets cut off mid-`facts`, so a whole-reply parse
 * fails. But the summary comes FIRST and is almost always intact, and most facts completed — so rather than
 * dead-end the user, pull the `portrait` string + every COMPLETE fact object (skipping the truncated trailing
 * one). Now built on the shared `@selfos/core/ai` salvage helpers (37-ai-output-robustness §5.1) so the
 * gold-standard logic lives in one place. Returns null only if even the summary didn't come through.
 */
function salvageTruncatedPortrait(
  text: string,
): { portrait: string; facts: { text: string; section?: string; lifeArea?: string }[] } | null {
  const portrait = salvageJsonObjectField(text, 'portrait');
  if (!portrait?.trim()) return null;
  const facts = salvageJsonObjectArrayField(text, 'facts').filter(
    (o): o is { text: string; section?: string; lifeArea?: string } =>
      typeof (o as { text?: unknown }).text === 'string',
  );
  return { portrait, facts };
}

const clampUnit = (n: number): number => Math.max(-1, Math.min(1, n));

const ReflectionDraftSchema = z.object({ reflection: z.string() });

// Tolerant by design (fix 2026-06-22): the portrait is the whole point of onboarding, so a single off-spec
// field from the model — a non-numeric `metric`, a malformed fact, a non-array `values` — must NOT discard
// an otherwise-complete portrait. Only `portrait` (a string) is hard-required; every other field falls back
// to a safe default via `.catch`, and empty-text facts (a caught/malformed fact becomes `{text:''}`) are
// dropped downstream. (A TRUNCATED reply is a different failure — the shared extractor returns null, then
// `salvageTruncatedPortrait` recovers the summary + complete facts; if even that fails it's reported
// distinctly as "cut off" via `classifyParseFailure`; the larger output budget makes it rare.)
const PortraitDraftSchema = z.object({
  portrait: z.string(),
  facts: z
    .array(
      z
        .object({
          text: z.string(),
          section: z.string().optional(),
          lifeArea: z.string().optional(),
        })
        .catch({ text: '' }),
    )
    .catch([])
    .default([]),
  metrics: z.record(z.string(), z.number()).catch({}).optional(),
  inferred: z
    .object({
      communicationStyle: z.string().optional().catch(undefined),
      values: z.array(z.string()).optional().catch(undefined),
      goals: z.string().optional().catch(undefined),
      faith: z.string().optional().catch(undefined),
    })
    .catch({})
    .optional(),
  crisisFlag: z.boolean().optional().catch(undefined),
  categories: z.array(z.string()).catch([]).default([]),
});

export interface IntakeSynthesizeDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  sectionId?: string;
  now: Date;
  override?: boolean;
}

const REFLECTION_INSTRUCTION = `Now write a brief, warm reflection (2-3 sentences) on what you've heard \
in this part of the conversation — something that helps the person feel seen. Be faithful to what they \
said; do not invent. This is reflective, not clinical. The reflection may use light Markdown (**bold**, \
*italic*); no tables, images, raw HTML, or code fences. Respond with ONLY a single JSON object: \
{"reflection": "..."}.`;

/** Max facts the synthesis call should PRODUCE for the portrait (28-portrait-synthesis-optimization §pillar-1).
 * The portrait is PINNED into every Session/Dream/Questionnaire context, so an unbounded fact list is a fixed
 * per-call token tax on the user's own key + a diluted signal. We ask for a prioritized, high-signal set and
 * hard-cap the stored facts at this budget. The summary paragraph stays comprehensive (it's cheap). */
const PORTRAIT_FACT_SYNTHESIS_BUDGET = 60;

const PORTRAIT_INSTRUCTION = `Now write the closing portrait of this person from everything they shared \
across the whole intake. Be warm, specific, and faithful — never invent. This is reflective self-knowledge, \
not a clinical assessment.

This portrait is the AI's lasting memory of this person — it personalizes their coaching, dream analysis, and \
everything else across the app. Make the SUMMARY rich and comprehensive; make the FACTS a PRIORITIZED set of \
the most important, reusable details — not an exhaustive dump (the facts are injected into every later \
conversation, so signal beats volume).

The "portrait" prose may use light Markdown for readability — paragraphs (blank line between them), \
**bold**, *italic*, and "-" lists; no tables, images, raw HTML, or code fences. The "facts" stay PLAIN \
text (no Markdown).

Respond with ONLY a single JSON object (no markdown fences) with these keys:
- "portrait": a warm, member-facing "here's what I've come to understand about you" summary, 3-5 rich paragraphs (string)
- "facts": the MOST IMPORTANT, highest-signal memory facts — AT MOST ${PORTRAIT_FACT_SYNTHESIS_BUDGET}. Draw across the \
areas they shared (identity & basics, life now, values, goals, work & money, health, relationships, family, their \
story, joy & play, what weighs on them, and intimacy if shared), but PRIORITIZE what's most useful for ongoing \
coaching — concrete names, preferences, patterns, goals, struggles, history. Prefer FEWER sharp, specific facts over \
many vague or redundant ones. Each: {"text": a short specific fact, "section": the section id it came from, \
"lifeArea": the fact's single life-area from EXACTLY this list: ${LIFE_AREAS.join(', ')}} (array)
- "metrics": optional normalized signals for trends, e.g. {"valence": -1.0..1.0} (object)
- "inferred": optional fields to fill from the whole picture: {"communicationStyle": string, "values": [..], "goals": string, "faith": string}
- "crisisFlag": true ONLY if self-harm, suicide, or acute crisis was disclosed (boolean)
- "categories": 1-2 dominant life-area tags for this person, from EXACTLY this list: ${LIFE_AREAS.join(', ')} (array of strings)`;

/** Per-fact life-area for relevance selection (28 §pillar-2/§4.4). A section that's foundational IDENTITY
 * (basics/life-now/story) maps to undefined ⇒ the always-on CORE; topic-specific sections map to their area.
 * Used only as a fallback when the model didn't tag the fact. The "(sensitive)" sub-block (`<id>-sensitive`)
 * inherits its base section's area. */
const SECTION_LIFE_AREA: Record<string, string> = {
  values: 'Values & beliefs',
  want: 'Goals & growth',
  health: 'Health & body',
  relationships: 'Relationships',
  'work-money': 'Work & purpose',
  'joy-play': 'Other',
  family: 'Family',
  weighs: 'Emotions & patterns',
  intimacy: 'Intimacy',
};

const LIFE_AREA_BY_LOWER = new Map(LIFE_AREAS.map((a) => [a.toLowerCase(), a]));

/** The fact's life-area: the model's value normalized against `LIFE_AREAS` (never trusted raw), else derived
 * from the section id, else undefined (⇒ always-on CORE — never narrowed away). */
function normalizeFactLifeArea(
  modelValue: string | undefined,
  section: string | undefined,
): string | undefined {
  const fromModel = modelValue?.trim().toLowerCase();
  if (fromModel && LIFE_AREA_BY_LOWER.has(fromModel)) return LIFE_AREA_BY_LOWER.get(fromModel);
  if (section) return SECTION_LIFE_AREA[section.replace(/-sensitive$/, '')];
  return undefined;
}

/** All non-empty `chat` section transcripts as model messages for synthesis (labeled with the section id). */
function transcriptMessages(
  session: IntakeSession,
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const def of INTAKE_CATALOG) {
    const section = session.sections.find((s) => s.id === def.id);
    if (!section || section.messages.length === 0) continue;
    out.push({ role: 'user', content: `--- Section: ${def.title} (id: ${def.id}) ---` });
    for (const m of section.messages) out.push({ role: m.role, content: m.content });
  }
  return out;
}

/** The synthetic "(sensitive)" sub-section id/title for a NON-restricted section's per-question `restricted`
 * answers (§14.8). Routing those answers under a distinct labeled block makes the model tag their derived
 * facts with this id, so `sectionRefRestricted` flags them — honoring the per-question flag without a
 * separate onboarding section. The id avoids special chars so the model echoes it reliably. */
const sensitiveSectionId = (id: string): string => `${id}-sensitive`;
const sensitiveSectionTitle = (title: string): string => `${title} — sensitive`;

/** All `form` section structured answers as labeled model messages, so synthesis weaves them into the
 * portrait + facts. A whole **restricted section** is already covered by its section flag; within a
 * **non-restricted** section, the per-question `restricted` answers are split into a "(sensitive)" block so
 * their facts inherit restriction (§14.8). */
function formAnswersMessages(session: IntakeSession): { role: 'user'; content: string }[] {
  const out: { role: 'user'; content: string }[] = [];
  // The intimacy activity matrix's rows are tailored per-person (27 §4.2); re-resolve with the same context
  // the renderer used so the stored answer keys map back to their labels.
  const actCtx = activityRowContext(session);
  for (const def of INTAKE_CATALOG) {
    if (!def.questions) continue;
    const section = session.sections.find((s) => s.id === def.id);
    if (!section || Object.keys(section.answers).length === 0) continue;
    // Drop answers for questions a branch now HIDES (47 §3.3/§7): if a trigger was later cleared/changed,
    // its follow-up's orphaned answer lingers in `section.answers` but must not feed the portrait as if
    // chosen. `isQuestionVisible` re-filters against the current answers, so an orphan is excluded here.
    const answerMap = section.answers as unknown as AnswerMap;
    const normal: string[] = [];
    const sensitive: string[] = [];
    for (const m of def.questions) {
      if (!isQuestionVisible(m.q, answerMap)) continue;
      const q = withResolvedActivityRows(m.q, actCtx);
      const str = formatAnswerForSynthesis(q, section.answers[m.q.id]);
      if (!str) continue;
      const line = `${m.q.prompt}: ${str}`;
      // A per-question restricted answer in a non-restricted section → the sensitive block. (In a restricted
      // section everything is restricted already, so keep it as one block.)
      if (m.restricted && !def.restricted) sensitive.push(line);
      else normal.push(line);
    }
    if (normal.length > 0) {
      out.push({
        role: 'user',
        content: [`--- Section: ${def.title} (id: ${def.id}) ---`, ...normal].join('\n'),
      });
    }
    if (sensitive.length > 0) {
      out.push({
        role: 'user',
        content: [
          `--- Section: ${sensitiveSectionTitle(def.title)} (id: ${sensitiveSectionId(def.id)}) ---`,
          ...sensitive,
        ].join('\n'),
      });
    }
  }
  return out;
}

/** A single rated intimacy act from the onboarding activity matrix (label + the chosen feeling), used to tell
 * generation what's already covered so it goes DEEPER instead of re-asking the rating (08 §19.3). */
export interface CoveredAct {
  label: string;
  rating: string;
}

/** Extract the rated acts from the onboarding `activities` matrix answer (anatomy-resolved labels, migrated
 * legacy keys) as structured {label, rating} — the structured twin of `formatAnswerForSynthesis`'s string. */
function parseCoveredActs(q: Question, value: IntakeAnswerValue | undefined): CoveredAct[] {
  if (q.type !== 'matrix' || !q.matrix || value === null || typeof value !== 'object') return [];
  const labels = matrixLabels(q.matrix);
  if (!labels || Array.isArray(value)) return [];
  const { min, rows } = q.matrix;
  const map = migrateActivityMatrixValue(value as Record<string, number>);
  const labelByKey = new Map(rows.map((r) => [matrixRowKey(r), matrixRowLabel(r)]));
  const out: CoveredAct[] = [];
  for (const [key, point] of Object.entries(map)) {
    if (typeof point !== 'number') continue;
    out.push({ label: labelByKey.get(key) ?? key, rating: labels[point - min] ?? String(point) });
  }
  return out;
}

/**
 * Format a person's completed onboarding answers as AVOID-ONLY known-data grounding for questionnaire
 * generation (08 §19.1). Reuses the SAME per-question formatting + anatomy-resolved matrix labels as synthesis,
 * but returns one text block (every visible answer across every section — incl. restricted ones; the §17.4
 * author-blind boundary makes this safe, the author never sees it) PLUS the set of intimacy acts already rated
 * (so the intimacy framing can go DEEPER instead of re-asking, §19.3). Hidden/orphaned answers are excluded
 * (the §47 cleared-trigger rule), exactly as synthesis does.
 */
export function formatIntakeForGeneration(session: IntakeSession): {
  text: string;
  coveredActs: CoveredAct[];
} {
  const actCtx = activityRowContext(session);
  const lines: string[] = [];
  const coveredActs: CoveredAct[] = [];
  for (const def of INTAKE_CATALOG) {
    if (!def.questions) continue;
    const section = session.sections.find((s) => s.id === def.id);
    if (!section || Object.keys(section.answers).length === 0) continue;
    const answerMap = section.answers as unknown as AnswerMap;
    const sectionLines: string[] = [];
    for (const m of def.questions) {
      if (!isQuestionVisible(m.q, answerMap)) continue;
      const q = withResolvedActivityRows(m.q, actCtx);
      const value = section.answers[m.q.id];
      const str = formatAnswerForSynthesis(q, value);
      if (str) sectionLines.push(`${m.q.prompt}: ${str}`);
      if (m.q.id === 'activities') coveredActs.push(...parseCoveredActs(q, value));
    }
    if (sectionLines.length > 0) {
      lines.push(`From "${def.title}":`, ...sectionLines.map((l) => `  ${l}`));
    }
  }
  return { text: lines.join('\n'), coveredActs };
}

/** The set of section refs (id or title, lowercased) whose facts are `restricted` (§8.4): every restricted
 * SECTION, plus the synthetic "(sensitive)" sub-block of any non-restricted section that has a per-question
 * `restricted` answer (§14.8). Computed once from the trusted catalog. */
const RESTRICTED_SECTION_REFS: ReadonlySet<string> = (() => {
  const refs = new Set<string>();
  for (const d of INTAKE_CATALOG) {
    if (d.restricted) {
      refs.add(d.id.toLowerCase());
      refs.add(d.title.toLowerCase());
    } else if (d.questions?.some((m) => m.restricted)) {
      refs.add(sensitiveSectionId(d.id).toLowerCase());
      refs.add(sensitiveSectionTitle(d.title).toLowerCase());
    }
  }
  return refs;
})();

/** Whether a section ref returned by the model (id or title) maps to a `restricted` fact (§8.4). The flag is
 * decided here from the trusted catalog — never the model — so an intimacy/trauma fact (restricted section)
 * or a sensitive-health fact (the per-question "(sensitive)" sub-block) is caught even when the model echoes
 * the title instead of the id. */
function sectionRefRestricted(ref: string | undefined): boolean {
  if (!ref) return false;
  return RESTRICTED_SECTION_REFS.has(ref.trim().toLowerCase());
}

/** Maps a model-echoed section ref (id or title, normal or "(sensitive)" variant) back to its real catalog
 * section id + whether it's the sensitive sub-block. Built once from the trusted catalog so a fact can be
 * attributed to the answers (and thus the sharing scopes) it derives from (43 §4). */
const SECTION_REF_LOOKUP: ReadonlyMap<string, { id: string; sensitive: boolean }> = (() => {
  const map = new Map<string, { id: string; sensitive: boolean }>();
  for (const d of INTAKE_CATALOG) {
    map.set(d.id.toLowerCase(), { id: d.id, sensitive: false });
    map.set(d.title.toLowerCase(), { id: d.id, sensitive: false });
    map.set(sensitiveSectionId(d.id).toLowerCase(), { id: d.id, sensitive: true });
    map.set(sensitiveSectionTitle(d.title).toLowerCase(), { id: d.id, sensitive: true });
  }
  return map;
})();

function resolveSectionRef(
  ref: string | undefined,
): { id: string; sensitive: boolean } | undefined {
  if (!ref) return undefined;
  return SECTION_REF_LOOKUP.get(ref.trim().toLowerCase());
}

/**
 * The relationship-type scope to tag onto a fact derived from a section (43 §4). Conservative
 * "most-restrictive-of-section": the INTERSECTION of the per-question scopes of the answered questions the
 * fact could draw on, read ONLY from the explicit `section.answerSharing` (the scopes the person SAW + chose).
 * A section with no `answerSharing` (pre-spec / never re-submitted) → `[]` (own-only, no surprise broadcast,
 * 43 §7). The candidate questions match the model's normal-vs-"(sensitive)" split (`formAnswersMessages`):
 * a sensitive sub-block considers only the section's `restricted` questions; a wholly-restricted section all
 * its questions; a normal block the non-restricted questions (so a private sensitive answer can't drag a
 * section's ordinary facts to own-only, and vice-versa).
 */
function factScopeForSection(
  session: IntakeSession,
  ref: { id: string; sensitive: boolean } | undefined,
): RelationshipType[] {
  if (!ref) return [];
  const def = getIntakeSection(ref.id);
  const section = session.sections.find((s) => s.id === ref.id);
  if (!def?.questions || !section) return [];

  const candidates = def.questions.filter((m) => {
    if (ref.sensitive) return m.restricted === true;
    if (def.restricted) return true;
    return m.restricted !== true;
  });

  const answerMap = section.answers as unknown as AnswerMap;
  let intersection: RelationshipType[] | null = null;
  for (const m of candidates) {
    if (section.answers[m.q.id] === undefined) continue; // only answered questions contribute
    if (!isQuestionVisible(m.q, answerMap)) continue; // skip a branch-hidden orphan (47 §3.3/§7)
    // Backfill: an answered question with no explicit `answerSharing` (a portrait synthesized before
    // per-question sharing existed) falls back to its category default — so existing portraits share by
    // default on the next refresh; restricted answers stay Private (their default is []). An explicit
    // choice (incl. an explicit [] = deliberately Private) is honored.
    const scope = effectiveAnswerScope(ref.id, m.q.id, section.answerSharing);
    intersection =
      intersection === null ? [...scope] : intersection.filter((t) => scope.includes(t));
    if (intersection.length === 0) break; // any private answer locks the block (most-restrictive)
  }
  return intersection ?? [];
}

/**
 * Synthesis (§3.5/§11.3). With `sectionId`: a light per-section reflection (best-effort — if AI is
 * unavailable or over budget, the section is still marked complete, just without a reflection). Without a
 * `sectionId`: the richer final portrait — distils the whole intake into the auto-approved portrait
 * `Insight` (`source: 'intake'`), fills inferred fields, and completes the session. Re-synthesizing reuses
 * the insight id and carries each fact's prior sharing choices forward by text (the `09` re-analysis pattern).
 */
export async function synthesizeIntake(deps: IntakeSynthesizeDeps): Promise<IntakeSynthesisResult> {
  return deps.sectionId !== undefined
    ? synthesizeSection(deps, deps.sectionId)
    : synthesizePortrait(deps);
}

async function synthesizeSection(
  deps: IntakeSynthesizeDeps,
  sectionId: string,
): Promise<IntakeSynthesisResult> {
  const { fs, key, client, apiKey, model, personId, now } = deps;
  const at = now.toISOString();
  const session = await ensureIntakeSession(fs, key, personId, now);
  const section = session.sections.find((s) => s.id === sectionId);
  const person = await getPerson(fs, key, personId);

  // Completing a section is structural — it never depends on AI. Mark it complete first, then attempt the
  // (best-effort) reflection. A skipped section that gets here stays skipped only if it has no content.
  if (section && section.status !== 'skipped') section.status = 'complete';

  const overBudgetNow = await overBudget(fs, key, personId, now, deps.override);
  // Reflect only when AI is ready, in budget, and the section has content — else just record completion.
  if (!apiKey || !person || !section || section.messages.length === 0 || overBudgetNow) {
    session.updatedAt = at;
    await writeEncryptedJson(fs, intakePath(personId), session, key);
    return { ok: true, session };
  }

  const system = await buildIntakeSystem(fs, key, person, sectionId);
  if (!system) {
    session.updatedAt = at;
    await writeEncryptedJson(fs, intakePath(personId), session, key);
    return { ok: true, session };
  }

  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system,
        messages: [
          ...section.messages.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: REFLECTION_INSTRUCTION },
        ],
        maxTokens: 400,
      },
      () => {},
    );
  } catch {
    session.updatedAt = at;
    await writeEncryptedJson(fs, intakePath(personId), session, key);
    return { ok: true, session };
  }

  const usage = buildUsage('intake.synthesize', model, session.id, personId, at, result.usage);
  await recordUsage(fs, key, usage);

  // A best-effort section reflection — uses the shared non-throwing extractor (37 §5.2); a miss just skips
  // the reflection (the section still completes), so no honest-failure classification is needed here.
  const reflection = ReflectionDraftSchema.safeParse(extractJsonObject(result.text)).data
    ?.reflection;
  if (reflection) section.reflection = reflection;
  session.updatedAt = at;
  await writeEncryptedJson(fs, intakePath(personId), session, key);
  return { ok: true, session, usage, ...(reflection ? { reflection } : {}) };
}

/** Fill inferred `Person` fields from synthesis — only ones currently empty (never clobber direct answers). */
async function applyInferredFields(
  fs: FileSystem,
  key: Uint8Array,
  person: Person,
  inferred: z.infer<typeof PortraitDraftSchema>['inferred'],
  now: Date,
): Promise<void> {
  if (!inferred) return;
  const next: Person = { ...person };
  let changed = false;
  const setStr = (
    k: PersonFieldKey & ('communicationStyle' | 'goals' | 'faith'),
    v?: string,
  ): void => {
    if (v?.trim() && !next[k]) {
      next[k] = v.trim();
      changed = true;
    }
  };
  setStr('communicationStyle', inferred.communicationStyle);
  setStr('goals', inferred.goals);
  setStr('faith', inferred.faith);
  if (inferred.values?.length && !(next.values && next.values.length > 0)) {
    next.values = inferred.values.map((v) => v.trim()).filter(Boolean);
    changed = true;
  }
  if (changed) await savePerson(fs, key, { ...next, updatedAt: now.toISOString() });
}

async function synthesizePortrait(deps: IntakeSynthesizeDeps): Promise<IntakeSynthesisResult> {
  const { fs, key, client, apiKey, model, personId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  const person = await getPerson(fs, key, personId);
  if (!person) return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const at = now.toISOString();
  const session = await ensureIntakeSession(fs, key, personId, now);
  const context = await buildContext(fs, key, personId);
  const system = [
    PERSONA,
    SAFETY,
    context,
    `You are completing a warm "getting to know you" onboarding for ${person.displayName}. This is ` +
      `reflective self-knowledge, NOT a clinical assessment, diagnosis, or treatment.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system,
        messages: [
          ...transcriptMessages(session),
          ...formAnswersMessages(session),
          { role: 'user', content: PORTRAIT_INSTRUCTION },
        ],
        // A rich summary + a PRIORITIZED fact set (≤PORTRAIT_FACT_SYNTHESIS_BUDGET). This is a bounded
        // structured-JSON call, so we DISABLE adaptive thinking (the [[adaptive-thinking-shares-maxtokens]]
        // rule + the generationService/reconcileService precedent): otherwise `max_tokens` is the COMBINED
        // thinking+output budget and trimming it could truncate the portrait JSON to empty. With thinking off
        // this is a pure output ceiling. Raised to 16000 (issue #19, 2026-06-23): a MAXIMAL intake (every
        // section answered) drove the model past 8000 and truncated the JSON mid-`facts` — confirmed by the
        // distinct "cut off" message. 16000 gives generous headroom (a compliant response is ~5-6k; you only
        // pay for tokens generated), and `salvageTruncatedPortrait` recovers the summary + complete facts if
        // an extreme case still overruns, so onboarding never dead-ends.
        maxTokens: 16000,
        extendedThinking: false,
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The portrait couldn’t be written. Please try again.',
    };
  }

  // Meter before parse — the tokens were spent even if validation then fails (09).
  const usage = buildUsage('intake.synthesize', model, session.id, personId, at, result.usage);
  await recordUsage(fs, key, usage);

  // Parse resiliently (fix 2026-06-22; 37 §5.2). The shared non-throwing extractor returns null on a
  // truncated/absent object; the tolerant schema then salvages any off-spec optional fields.
  let parsed = PortraitDraftSchema.safeParse(extractJsonObject(result.text));
  if (!parsed.success) {
    // Truncated mid-stream (issue #19): salvage the summary + the facts that DID come through, so a maximal
    // intake completes instead of dead-ending. The larger budget makes this the rare backstop, not the norm.
    const salvaged = salvageTruncatedPortrait(result.text);
    if (salvaged) parsed = PortraitDraftSchema.safeParse(salvaged);
  }
  if (!parsed.success) {
    // Distinct honest reasons (37 §3.2): TRUNCATED (cut off — a retry) vs MALFORMED (unexpected shape).
    const reason = classifyParseFailure(result.text);
    return {
      ok: false,
      reason: reason === 'TRUNCATED' ? 'TRUNCATED' : 'MALFORMED',
      message:
        reason === 'TRUNCATED'
          ? 'The portrait was cut off before it finished. Please try again.'
          : 'The portrait came back in an unexpected shape. Please try again.',
    };
  }
  const draft = parsed.data;

  const insightId = session.insightId ?? uuid();
  // Re-synthesis: carry each prior fact's sharing choices forward, matched by text (robust to reordering).
  const prior = session.insightId ? await getInsight(fs, key, personId, insightId) : null;
  const priorByText = new Map((prior?.facts ?? []).map((f) => [f.text.trim(), f]));

  const facts: InsightFact[] = [];
  // Hard-cap the stored portrait at the synthesis budget (28 §pillar-1) — keep the model's own ordering
  // (it returns the most important first), so a model that ignores the "at most N" instruction can't bloat
  // the pinned, every-call portrait. Empty-text facts are skipped without consuming budget.
  for (const f of draft.facts) {
    if (facts.length >= PORTRAIT_FACT_SYNTHESIS_BUDGET) break;
    const text = f.text.trim();
    if (!text) continue;
    // The `restricted` flag is decided server-side from the (trusted) section catalog — never the AI.
    const restrictedByCatalog = sectionRefRestricted(f.section);
    const carried = priorByText.get(text);
    // The life-area (28 §pillar-2): the model's value normalized, else derived from the section; carry a
    // prior (e.g. reconciled) tag forward on re-synthesis so it isn't lost.
    const lifeArea = normalizeFactLifeArea(f.lifeArea, f.section) ?? carried?.lifeArea;
    // Relationship-type sharing (43 §4): tag the fact from the per-question scopes of its source section.
    // For a `restricted` fact this stays own-only UNLESS the person explicitly opted the answers in (a
    // non-empty intersection) — then the fact is emitted NON-restricted + type-scoped (43 §3.1/§8). For a
    // normal fact the scope is the most-restrictive-of-section. Computed from `answerSharing` only (the seen
    // choices), so a pre-spec section that's merely re-synthesized never surprise-shares (43 §7).
    const scope = factScopeForSection(session, resolveSectionRef(f.section));
    const optedInRestricted = restrictedByCatalog && scope.length > 0;
    const restricted = restrictedByCatalog && !optedInRestricted;
    const shareableTypes = restrictedByCatalog ? (optedInRestricted ? scope : []) : scope;
    facts.push({
      id: uuid(),
      text,
      // Intake facts never broadcast (`shareable: false`) — relationship-type scoping (`shareableTypes`) is
      // the only share path here. Carry a prior owner broadcast/per-person choice forward on re-synthesis.
      shareable: carried?.shareable ?? false,
      ...(carried?.shareableWith && carried.shareableWith.length > 0
        ? { shareableWith: carried.shareableWith }
        : {}),
      ...(shareableTypes.length > 0 ? { shareableTypes } : {}),
      ...(restricted ? { restricted: true } : {}),
      ...(lifeArea ? { lifeArea } : {}),
    });
  }

  const insight: Insight = {
    id: insightId,
    schemaVersion: 1,
    source: 'intake',
    subjectPersonId: personId,
    summary: draft.portrait,
    facts,
    ...(draft.metrics !== undefined
      ? {
          metrics: Object.fromEntries(
            Object.entries(draft.metrics).map(([k, v]) => [k, clampUnit(v)]),
          ),
        }
      : {}),
    confidence: 'medium',
    categories: normalizeCategories(draft.categories), // life-area tags, folded into this same call (no extra spend)
    approved: true, // the portrait auto-enters the person's OWN context (§3.5)
    provenance: { at },
    ...(draft.crisisFlag !== undefined ? { crisisFlag: draft.crisisFlag } : {}),
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
  };
  await saveInsight(fs, key, insight);
  await applyInferredFields(fs, key, person, draft.inferred, now);

  session.status = 'complete';
  session.completedAt = at;
  session.insightId = insightId;
  session.portrait = draft.portrait;
  // Snapshot the answers this portrait was built from, so the app can later show "X% out of date" (§15).
  session.portraitAnswerSig = intakeAnswerHashes(session);
  session.updatedAt = at;
  await writeEncryptedJson(fs, intakePath(personId), session, key);

  return { ok: true, session, portrait: draft.portrait, insightId, usage };
}

// --- Restricted facts (§8.4) ---

/**
 * Redact restricted facts from an insight for viewers WITHOUT `intake.readRestricted` (§8.4) — strips facts
 * flagged `restricted` so a member browsing Memory never sees another person's trauma/intimacy intake. A
 * holder of `intake.readRestricted` (always the Owner — the full-access role; or a non-owner role granted it)
 * sees them directly, un-redacted, in the bridge. The person's OWN coaching context is a different path
 * (`summarizeForContext`) and always keeps them. Returns a shallow copy.
 */
export function redactRestrictedFacts(insight: Insight): Insight {
  if (!insight.facts.some((f) => f.restricted)) return insight;
  return { ...insight, facts: insight.facts.filter((f) => f.restricted !== true) };
}
