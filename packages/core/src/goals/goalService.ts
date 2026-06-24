import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  GoalSchema,
  LIFE_AREAS,
  effectiveGoalStatus,
  type Goal,
  type GoalStatus,
  type InsightProvenance,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * First-class tracked goals / commitments (39-living-memory §4.1/§5.2). Stored encrypted per subject at
 * `people/<id>/goals/<id>.enc`. Goals are EXTRACTED from session analysis (no extra AI spend — the analysis
 * already returns `goals`; we structure them instead of stringifying onto a fact) and the user sees + closes
 * them in Memory. The coach's follow-up acting on them is spec 40; here we only produce + maintain the data,
 * plus a small bounded "open commitments" grounding line so the coach is AWARE of them (§5.2).
 *
 * Privacy: per-subject only — a goal's `subjectPersonId` is its owner; nothing here ever reads another
 * person's goals. The bridge scopes every `goals:*` channel to the active person (the trust boundary).
 */

function goalsDir(personId: string): string {
  return `people/${personId}/goals`;
}

function goalPath(personId: string, goalId: string): string {
  return `${goalsDir(personId)}/${goalId}.enc`;
}

/** Normalize free goal text for de-dup matching (the `reconcileService` `norm()` precedent). */
const norm = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/^goal:\s*/, '') // tolerate a legacy "Goal: " prefix
    .replace(/\s+/g, ' ');

/** Clamp a model-supplied life-area to the fixed taxonomy (never trust it raw), or undefined. */
function normalizeLifeArea(area: string | undefined): string | undefined {
  if (!area) return undefined;
  const match = LIFE_AREAS.find((a) => a.toLowerCase() === area.trim().toLowerCase());
  return match;
}

const ACTIVE: ReadonlySet<GoalStatus> = new Set(['open', 'inProgress']);

/** A stable key for a provenance, to avoid folding the same origin in twice on a re-analysis. */
function provenanceKey(p: InsightProvenance): string {
  return [p.conversationId ?? '', p.dreamId ?? '', p.assignmentId ?? '', p.at].join('|');
}

export async function saveGoal(fs: FileSystem, key: Uint8Array, goal: Goal): Promise<void> {
  await writeEncryptedJson(fs, goalPath(goal.subjectPersonId, goal.id), goal, key);
}

export async function getGoal(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  goalId: string,
): Promise<Goal | null> {
  const raw = await readEncryptedJson(fs, goalPath(personId, goalId), key);
  return raw ? GoalSchema.parse(raw) : null;
}

/** List a subject's goals, newest-first by `updatedAt`. Defense-in-depth subject check (the insight precedent). */
export async function listGoals(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<Goal[]> {
  const out: Goal[] = [];
  for (const name of await fs.list(goalsDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${goalsDir(personId)}/${name}`, key);
    if (!raw) continue;
    const goal = GoalSchema.parse(raw);
    if (goal.subjectPersonId === personId) out.push(goal);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

export async function deleteGoal(fs: FileSystem, personId: string, goalId: string): Promise<void> {
  await fs.remove(goalPath(personId, goalId));
}

export interface ExtractGoalsInput {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  goals: string[]; // the raw goal strings the producer's analysis returned
  provenance: InsightProvenance; // where this batch came from (the session/source)
  insightId?: string; // the Insight these goals were extracted from (back-reference)
  lifeArea?: string; // an optional default life-area for the batch
  now: Date;
}

/**
 * Structure a producer's `goals` strings into tracked `Goal`s (39 §4.3). A re-mentioned commitment — an
 * existing OPEN/IN-PROGRESS goal with clearly-equal text — is FOLDED into (provenance appended to
 * `contributingSources`, `lastTouchedAt` bumped) rather than duplicated; only genuinely-new ones create a
 * goal (status `open`). Idempotent on re-analysis (the same origin isn't folded twice). Returns the goals
 * touched/created. No AI call.
 */
export async function extractGoals(input: ExtractGoalsInput): Promise<Goal[]> {
  const { fs, key, personId, goals, provenance, now } = input;
  const at = now.toISOString();
  const lifeArea = normalizeLifeArea(input.lifeArea);

  // Index the subject's ACTIVE goals by normalized text — the de-dup target.
  const activeByText = new Map<string, Goal>();
  for (const g of await listGoals(fs, key, personId)) {
    if (ACTIVE.has(g.status)) activeByText.set(norm(g.text), g);
  }

  const result: Goal[] = [];
  for (const rawText of goals) {
    const text = rawText.trim();
    if (!text) continue;
    const dupKey = norm(text);
    if (!dupKey) continue;

    const match = activeByText.get(dupKey);
    if (match) {
      // Fold the re-mention. Only append this origin if it's not already the primary or a contributing one,
      // so re-analyzing the same session doesn't grow `contributingSources` unboundedly.
      const seen = new Set([
        provenanceKey(match.provenance),
        ...(match.contributingSources ?? []).map(provenanceKey),
      ]);
      const contributing = seen.has(provenanceKey(provenance))
        ? match.contributingSources
        : [...(match.contributingSources ?? []), provenance];
      const folded: Goal = {
        ...match,
        ...(contributing && contributing.length > 0 ? { contributingSources: contributing } : {}),
        lastTouchedAt: at,
        updatedAt: at,
      };
      await saveGoal(fs, key, folded);
      activeByText.set(dupKey, folded);
      result.push(folded);
      continue;
    }

    const goal: Goal = {
      id: uuid(),
      schemaVersion: 1,
      subjectPersonId: personId,
      text,
      status: 'open',
      ...(lifeArea ? { lifeArea } : {}),
      provenance,
      ...(input.insightId ? { insightId: input.insightId } : {}),
      createdAt: at,
      updatedAt: at,
      lastTouchedAt: at,
    };
    await saveGoal(fs, key, goal);
    activeByText.set(dupKey, goal); // two identical goals in ONE batch don't double-create
    result.push(goal);
  }
  return result;
}

/** Set a goal's status (39 §3.1). Bumps `lastTouchedAt` — so marking "Still on it" (→ open/inProgress) clears
 * a derived-stale state. Returns the updated goal, or null if gone. The bridge scopes this to the owner. */
export async function setGoalStatus(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  goalId: string,
  status: GoalStatus,
  now: Date,
): Promise<Goal | null> {
  const goal = await getGoal(fs, key, personId, goalId);
  if (!goal) return null;
  const at = now.toISOString();
  const updated: Goal = { ...goal, status, updatedAt: at, lastTouchedAt: at };
  await saveGoal(fs, key, updated);
  return updated;
}

export interface UpdateGoalPatch {
  text?: string;
  due?: string; // '' clears
  horizon?: string; // '' clears
}

/** Edit a goal's text / due / horizon (39 §3.1). An empty `due`/`horizon` clears it. Bumps `lastTouchedAt`. */
export async function updateGoal(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  goalId: string,
  patch: UpdateGoalPatch,
  now: Date,
): Promise<Goal | null> {
  const goal = await getGoal(fs, key, personId, goalId);
  if (!goal) return null;
  const at = now.toISOString();
  const updated: Goal = { ...goal, updatedAt: at, lastTouchedAt: at };
  if (patch.text !== undefined && patch.text.trim()) updated.text = patch.text.trim();
  if (patch.due !== undefined) {
    if (patch.due.trim()) updated.due = patch.due.trim();
    else delete updated.due;
  }
  if (patch.horizon !== undefined) {
    if (patch.horizon.trim()) updated.horizon = patch.horizon.trim();
    else delete updated.horizon;
  }
  await saveGoal(fs, key, updated);
  return updated;
}

/** How many open commitments to surface to the coach as grounding (bounded like the rest of context). */
const MAX_GOALS_IN_CONTEXT = 8;

/**
 * A small bounded "open commitments" grounding line for the coach (39 §5.2 / §11 Q7). Lists the subject's
 * ACTIVE goals (open/in-progress, incl. ones that read stale) so the coach is AWARE of them — the proactive
 * follow-up/nudging stays spec 40. Per-subject only; returns '' when there are none. Behind the same context
 * bound as the rest of `buildContext`.
 */
export async function summarizeOpenCommitments(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
): Promise<string> {
  const active = (await listGoals(fs, key, personId))
    .filter((g) => ACTIVE.has(g.status))
    .slice(0, MAX_GOALS_IN_CONTEXT);
  if (active.length === 0) return '';
  const lines = ['Open commitments they’ve named (be aware; only bring up gently if relevant):'];
  for (const goal of active) {
    const when = goal.due ? ` (due ${goal.due})` : goal.horizon ? ` (${goal.horizon})` : '';
    const aging = effectiveGoalStatus(goal, now) === 'stale' ? ' — open a while' : '';
    lines.push(`- ${goal.text}${when}${aging}`);
  }
  return lines.join('\n');
}
