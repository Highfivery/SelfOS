import { z } from 'zod';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import {
  IntakeSessionSchema,
  PERSON_FIELD_KEYS,
  type Insight,
  type IntakeSession,
  type IntakeSection,
  type IntakeSynthesisResult,
  type IntakeTurnResult,
  type InsightFact,
  type Person,
  type PersonFieldKey,
  type UsageEvent,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { buildContext, getPerson, savePerson } from '../people';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import { checkBudget, costOf, recordUsage } from '../usage';
import { getInsight, saveInsight } from '../insights';
import {
  INTAKE_CATALOG,
  buildInterviewerAddendum,
  getIntakeSection,
  type IntakeDirectField,
} from './intakeCatalog';

/**
 * Personal-onboarding intake service (18-personal-onboarding §5). An AI-guided, resumable self-interview:
 * `runIntakeTurn` reuses `05`'s streaming + `06`'s metering (`intake.interview`) but stores the transcript
 * UNDER the person (never in Sessions); direct answers fill the owner-only `Person` profile mid-interview
 * via an embedded `[[SELFOS:FIELD:…]]` marker. `synthesizeIntake` distils a section (a light reflection) or
 * the whole intake (the portrait `Insight`, `source: 'intake'`, + inferred field fills) — metering
 * `intake.synthesize` before parse (`09` pattern). Sensitive direct fields lock to own-context-only; facts
 * from `restricted` sections are flagged so they show only to the Owner (`intake.readRestricted`), redacted
 * for everyone else (§8.4). The API key never leaves the host.
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

// --- Field markers (direct auto-fill) ---

const FIELD_MARKER = /\[\[SELFOS:FIELD:([a-zA-Z]+)=([^\]]*)\]\]/g;
const FIELD_KEY_SET = new Set<string>(PERSON_FIELD_KEYS);

/**
 * Strip the hidden `[[SELFOS:FIELD:…]]` markers (+ any now-empty trailing lines) from a reply. Also strips a
 * trailing UNCLOSED marker fragment (e.g. `[[SELFOS:FI`) so a marker arriving in stream chunks never flashes
 * in the live view before its closing `]]` lands (the renderer calls this on the streaming buffer).
 */
export function stripIntakeFieldMarkers(text: string): string {
  return (
    text
      .replace(FIELD_MARKER, '')
      // A trailing, not-yet-closed marker fragment (the prefix has landed, the value is still streaming).
      .replace(/\[\[SELFOS:FIELD:[^\]]*$/, '')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Parse `key → value` from the markers in a reply, keeping only known `Person` field keys. */
function parseFieldMarkers(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of text.matchAll(FIELD_MARKER)) {
    const rawKey = match[1];
    const rawValue = (match[2] ?? '').trim();
    if (rawKey && rawValue && FIELD_KEY_SET.has(rawKey)) out.set(rawKey, rawValue);
  }
  return out;
}

/** Apply one direct field to a person object (mutating a working copy); returns whether it changed. */
function applyField(person: Person, field: IntakeDirectField, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const key = field.key;
  // List fields (interests/values/languages) are captured comma-separated.
  if (field.list) {
    const items = trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return false;
    (person as Record<string, unknown>)[key] = items;
  } else {
    (person as Record<string, unknown>)[key] = trimmed;
  }
  // Sensitive direct fields (e.g. healthNotes) lock to own-context-only (§8.3).
  if (field.private) {
    const locked = new Set(person.privateFields ?? []);
    locked.add(key);
    person.privateFields = [...locked];
  }
  return true;
}

/**
 * Apply the section's direct field markers to the owner-only `Person` profile (§3.4). Only keys declared as
 * `directFields` for THIS section are honored (the AI can't fill arbitrary fields); sensitive ones lock to
 * private. Returns the list of field keys actually filled. Reads + writes the person once.
 */
async function applyDirectFields(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  sectionId: string,
  markers: Map<string, string>,
  now: Date,
): Promise<string[]> {
  const def = getIntakeSection(sectionId);
  if (!def || def.directFields.length === 0 || markers.size === 0) return [];
  const allowed = new Map(def.directFields.map((f) => [f.key as string, f]));
  const person = await getPerson(fs, key, personId);
  if (!person) return [];
  const filled: string[] = [];
  for (const [k, v] of markers) {
    const field = allowed.get(k);
    if (!field) continue;
    if (applyField(person, field, v)) filled.push(k);
  }
  if (filled.length === 0) return [];
  await savePerson(fs, key, { ...person, updatedAt: now.toISOString() });
  return filled;
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
  return [PERSONA, SAFETY, context, buildInterviewerAddendum(person.displayName, def)]
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

  // Direct field markers → the owner-only profile (sensitive ones locked); strip from the saved/shown text.
  const filledFields = await applyDirectFields(
    fs,
    key,
    personId,
    sectionId,
    parseFieldMarkers(result.text),
    now,
  );
  const clean = stripIntakeFieldMarkers(result.text);

  section.messages.push({ role: 'user', content: userText, ts: at });
  section.messages.push({ role: 'assistant', content: clean, ts: at });
  if (section.status === 'notStarted') section.status = 'inProgress';
  session.updatedAt = at;
  await writeEncryptedJson(fs, intakePath(personId), session, key);

  return {
    ok: true,
    session,
    usage,
    ...(filledFields.length > 0 ? { filledFields } : {}),
  };
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

function extractJson(text: string): unknown {
  const stripped = text.replace(/```json/gi, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object in model output');
  return JSON.parse(stripped.slice(start, end + 1));
}

const clampUnit = (n: number): number => Math.max(-1, Math.min(1, n));

const ReflectionDraftSchema = z.object({ reflection: z.string() });

const PortraitDraftSchema = z.object({
  portrait: z.string(),
  facts: z.array(z.object({ text: z.string(), section: z.string().optional() })).default([]),
  metrics: z.record(z.string(), z.number()).optional(),
  inferred: z
    .object({
      communicationStyle: z.string().optional(),
      values: z.array(z.string()).optional(),
      goals: z.string().optional(),
      faith: z.string().optional(),
    })
    .optional(),
  crisisFlag: z.boolean().optional(),
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
said; do not invent. This is reflective, not clinical. Respond with ONLY a single JSON object: \
{"reflection": "..."}.`;

const PORTRAIT_INSTRUCTION = `Now write the closing portrait of this person from everything they shared \
across the whole intake. Be warm, specific, and faithful — never invent. This is reflective self-knowledge, \
not a clinical assessment. Respond with ONLY a single JSON object (no markdown fences) with these keys:
- "portrait": a warm, member-facing 1-2 paragraph "here's what I've come to understand about you" summary (string)
- "facts": structured memory facts to remember about them (array of {"text": short fact, "section": the section id it came from})
- "metrics": optional normalized signals for trends, e.g. {"valence": -1.0..1.0} (object)
- "inferred": optional fields to fill from the whole picture: {"communicationStyle": string, "values": [..], "goals": string, "faith": string}
- "crisisFlag": true ONLY if self-harm, suicide, or acute crisis was disclosed (boolean)`;

/** All non-empty, worked-through section transcripts as model messages for synthesis. */
function transcriptMessages(
  session: IntakeSession,
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const def of INTAKE_CATALOG) {
    const section = session.sections.find((s) => s.id === def.id);
    if (!section || section.messages.length === 0) continue;
    out.push({ role: 'user', content: `--- Section: ${def.title} ---` });
    for (const m of section.messages) out.push({ role: m.role, content: m.content });
  }
  return out;
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

  let reflection: string | undefined;
  try {
    reflection = ReflectionDraftSchema.parse(extractJson(result.text)).reflection;
  } catch {
    reflection = undefined;
  }
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
        messages: [...transcriptMessages(session), { role: 'user', content: PORTRAIT_INSTRUCTION }],
        maxTokens: 2000,
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

  let draft;
  try {
    draft = PortraitDraftSchema.parse(extractJson(result.text));
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The portrait came back in an unexpected shape. Please try again.',
    };
  }

  const insightId = session.insightId ?? uuid();
  // Re-synthesis: carry each prior fact's sharing choices forward, matched by text (robust to reordering).
  const prior = session.insightId ? await getInsight(fs, key, personId, insightId) : null;
  const priorByText = new Map((prior?.facts ?? []).map((f) => [f.text.trim(), f]));

  const facts: InsightFact[] = [];
  for (const f of draft.facts) {
    const text = f.text.trim();
    if (!text) continue;
    // The `restricted` flag is decided server-side from the (trusted) section catalog — never the AI.
    const restricted = f.section ? getIntakeSection(f.section)?.restricted === true : false;
    const carried = priorByText.get(text);
    facts.push({
      id: uuid(),
      text,
      // Intake facts default own-context-only (the safe reading, §8.3 build-decision); the owner can
      // promote per-fact later. Carry forward a prior owner choice on re-synthesis.
      shareable: carried?.shareable ?? false,
      ...(carried?.shareableWith && carried.shareableWith.length > 0
        ? { shareableWith: carried.shareableWith }
        : {}),
      ...(restricted ? { restricted: true } : {}),
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
