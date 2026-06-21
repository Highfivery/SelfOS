import type { FileSystem } from '../host';
import { uuid } from '../id';
import { INTAKE_CATALOG } from '../intake/intakeCatalog';
import {
  type IntakeSession,
  type ProfileUpdateSuggestion,
  type RawDepthInvitation,
} from '../schemas';
import { writeEncryptedJson } from '../vault';
import { SCHEMA_VERSION, listProfileSuggestions, suggestionPath } from './profileSuggestionService';

/**
 * Progressive profile building — DEPTH invitations (29-progressive-profile-building). The sibling of the §15
 * freshness suggestions: §15 says "this answer is stale — update it"; §29 says "this area is unexplored — want
 * to go deeper?". Detection is a FREE by-product of the producers' metered analysis passes (no extra AI spend,
 * the §15 / 09 "one marker, free signal" precedent): a producer hands the raw depth deltas its analysis emitted
 * to `recordDepthInvitationsFromAnalysis`, which resolves each to a real UNFILLED `invited` intake section,
 * drops anything targeting a core/filled/recently-declined section, dedups (one per area, newest wins), caps
 * the surface, and inherits `restricted` from the trusted catalog (never the model). A depth invitation is the
 * same persisted `ProfileUpdateSuggestion` record with `kind: 'depth'` — so accept/dismiss/list/IPC/store are
 * reused wholesale (§5.1). It is an INVITATION, never an edit: accepting opens that intake section; nothing is
 * written without the person.
 */

/** Days a dismissed (or skipped, since onboarding) area stays quiet before a strong recurrence may re-invite. */
export const DEPTH_COOLDOWN_DAYS = 60;
/** Max simultaneous PENDING depth invitations — the surface never becomes a checklist of things undone (§3.4). */
export const DEPTH_GLOBAL_CAP = 1;
/** How many times the conversation must circle an unexplored area before the model should offer one (§11). */
export const DEPTH_RECURRENCE_THRESHOLD = 3;

/** The recognizable lead-in for the unfilled-areas context handed to the analysis prompt (§5.2). */
export const DEPTH_CONTEXT_MARKER = 'Profile areas they have not explored yet';

const COOLDOWN_MS = DEPTH_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/** The invited (deep) intake sections — the only sections §29 ever invites (§2; never re-gates core). */
const INVITED_SECTIONS = INTAKE_CATALOG.filter((s) => s.tier === 'invited');

/**
 * Area → invited section for an area-only invitation (§5.3). Several life-areas can route to one section
 * (Money → work-money). Areas with no clean owning invited section (e.g. "Goals & growth", "Other") are absent
 * — those sections (joy-play, story) are only reachable when the model names the `sectionId` directly. This is
 * the single source of truth for 29's routing (distinct from intakeService's per-fact `SECTION_LIFE_AREA`
 * tagging fallback, which serves a different purpose).
 */
const LIFE_AREA_TO_SECTION: Record<string, string> = {
  'Health & body': 'health',
  Relationships: 'relationships',
  'Work & purpose': 'work-money',
  Money: 'work-money',
  Family: 'family',
  'Emotions & patterns': 'weighs',
  Intimacy: 'intimacy',
};

/** The owning life-area of an invited section (for the stored record's `lifeArea`); inverse of the above. */
const SECTION_LIFE_AREA: Record<string, string> = {
  health: 'Health & body',
  relationships: 'Relationships',
  'work-money': 'Work & purpose',
  family: 'Family',
  weighs: 'Emotions & patterns',
  intimacy: 'Intimacy',
};

/** Meta for an unfilled invited section, used to build the prompt context and resolve/gate an invitation. */
export interface InvitedSectionMeta {
  id: string;
  title: string;
  restricted: boolean;
  adult: boolean;
  /** true when the person explicitly SKIPPED it in onboarding (a standing decline within the cooldown, §3.4). */
  skipped: boolean;
}

/**
 * The invited intake sections the person hasn't filled in yet — status `notStarted` or `skipped` (§5.3). A
 * partially-started (`inProgress`) or `complete` section is NOT unfilled. With no session yet, every invited
 * section is unfilled. Pure.
 */
export function unfilledInvitedSections(session: IntakeSession | null): InvitedSectionMeta[] {
  const statusById = new Map((session?.sections ?? []).map((s) => [s.id, s.status]));
  const out: InvitedSectionMeta[] = [];
  for (const def of INVITED_SECTIONS) {
    const status = statusById.get(def.id) ?? 'notStarted';
    if (status !== 'notStarted' && status !== 'skipped') continue;
    out.push({
      id: def.id,
      title: def.title,
      restricted: def.restricted,
      adult: def.adult,
      skipped: status === 'skipped',
    });
  }
  return out;
}

/**
 * Resolve a raw depth delta to a real UNFILLED invited section (§5.1): by the model's `sectionId` if it names a
 * genuine unfilled invited section, else by mapping its `lifeArea` to one. Returns null when it targets a
 * `core` / non-existent / already-filled section — those are dropped (§29 only ever invites `invited` sections).
 */
export function resolveDepthSection(
  raw: RawDepthInvitation,
  unfilled: InvitedSectionMeta[],
): InvitedSectionMeta | null {
  const unfilledById = new Map(unfilled.map((s) => [s.id, s]));
  const byId = raw.sectionId?.trim();
  if (byId && unfilledById.has(byId)) return unfilledById.get(byId) ?? null;
  const area = raw.lifeArea?.trim();
  if (area) {
    const sectionId = LIFE_AREA_TO_SECTION[area];
    if (sectionId && unfilledById.has(sectionId)) return unfilledById.get(sectionId) ?? null;
  }
  return null;
}

/**
 * Record the depth invitations an analysis pass emitted (§5.1). Validates + resolves each against the real
 * unfilled invited sections; applies the §3.4 cadence rules (a skipped section stays a standing decline until
 * the cooldown elapses since onboarding finished; a recently-dismissed or already-accepted area doesn't
 * re-fire; one pending per area, newest wins; a global cap on pending depth cards) and inherits `restricted`
 * from the trusted catalog (never the model). A `core`/filled/hallucinated target is dropped.
 */
export async function recordDepthInvitationsFromAnalysis(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  raw: RawDepthInvitation[],
  sourceKind: ProfileUpdateSuggestion['sourceKind'],
  sourceInsightId: string,
  session: IntakeSession | null,
  now: Date,
): Promise<void> {
  if (raw.length === 0) return;
  const unfilled = unfilledInvitedSections(session);
  if (unfilled.length === 0) return;

  const at = now.toISOString();
  const existing = await listProfileSuggestions(fs, key, personId);
  const depth = existing.filter((s) => s.kind === 'depth');
  // The mutable pending-depth working set (newest-first from listProfileSuggestions), kept honest as we go.
  const pending = depth.filter((s) => s.status === 'pending');
  // The skip-decline anchor: onboarding completion (else last touch). A skipped section is a standing decline
  // until the cooldown elapses from here — only then can a strong recurrence re-invite it (§3.4 / decision).
  const skipAnchor = session?.completedAt ?? session?.updatedAt;
  const skipAnchorMs = skipAnchor ? Date.parse(skipAnchor) : NaN;

  const removePending = async (s: ProfileUpdateSuggestion): Promise<void> => {
    await fs.remove(suggestionPath(personId, s.id));
    const i = pending.indexOf(s);
    if (i >= 0) pending.splice(i, 1);
  };

  for (const r of raw) {
    const section = resolveDepthSection(r, unfilled);
    if (!section) continue; // not an invited / unfilled section — drop (trust boundary)

    // A skipped section is a standing decline until the cooldown elapses since onboarding finished.
    if (
      section.skipped &&
      !Number.isNaN(skipAnchorMs) &&
      now.getTime() - skipAnchorMs < COOLDOWN_MS
    ) {
      continue;
    }
    // No re-nag: a depth invitation for this area dismissed within the cooldown stays quiet.
    const recentlyDismissed = depth.some(
      (s) =>
        s.sectionId === section.id &&
        s.status === 'dismissed' &&
        now.getTime() - Date.parse(s.updatedAt) < COOLDOWN_MS,
    );
    if (recentlyDismissed) continue;
    // Already accepted for this area (it served its purpose / the section is being filled) → don't re-offer.
    if (depth.some((s) => s.sectionId === section.id && s.status === 'accepted')) continue;

    // One pending per area, newest wins: drop any prior PENDING depth invitation for this section.
    for (const stale of pending.filter((s) => s.sectionId === section.id)) {
      await removePending(stale);
    }
    // Global cap: if at/over the cap, drop the OLDEST pending depth invitation (newest wins, §3.4).
    while (pending.length >= DEPTH_GLOBAL_CAP) {
      const oldest = [...pending].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
      if (!oldest) break;
      await removePending(oldest);
    }

    const theme = r.theme.trim();
    const lifeArea = SECTION_LIFE_AREA[section.id];
    const suggestion: ProfileUpdateSuggestion = {
      id: uuid(),
      schemaVersion: SCHEMA_VERSION,
      subjectPersonId: personId,
      kind: 'depth',
      sectionId: section.id,
      ...(lifeArea ? { lifeArea } : {}),
      theme,
      observed: theme, // the schema requires a non-empty `observed`; for depth it mirrors the theme
      rationale: r.rationale.trim(),
      sourceInsightId,
      sourceKind,
      // A restricted-area (trauma/intimacy) invitation is itself restricted — from the trusted catalog, NEVER
      // the model — so its theme/rationale is held under the §8.4 redaction (own-context-only, owner-visible).
      restricted: section.restricted,
      status: 'pending',
      createdAt: at,
      updatedAt: at,
    };
    await writeEncryptedJson(fs, suggestionPath(personId, suggestion.id), suggestion, key);
    pending.push(suggestion);
  }
}

/**
 * The unfilled-areas context handed to a producer's analysis prompt (§5.2) so it can OPTIONALLY name one
 * recurring unexplored area in `depthInvitations`. Returns '' when nothing is unfilled (no detection). Lists
 * each section's id + title so the model can name a `sectionId`. Heavier (restricted) sections are flagged so
 * the model only surfaces them on a clear, strong signal.
 */
export function depthDetectionContext(unfilled: InvitedSectionMeta[]): string {
  if (unfilled.length === 0) return '';
  const lines = unfilled.map(
    (s) => `  - ${s.id} ("${s.title}")${s.restricted ? ' [a heavier, sensitive area]' : ''}`,
  );
  return `${DEPTH_CONTEXT_MARKER} (invited profile sections still empty):
${lines.join('\n')}`;
}

/**
 * The JSON-key instruction fragment appended to a producer's analysis prompt (§5.2). The model may name ONE
 * unexplored area the conversation keeps circling (≥ ${DEPTH_RECURRENCE_THRESHOLD} times) — never guessing.
 */
export const DEPTH_INVITATION_INSTRUCTION = `- "depthInvitations": ONLY if this conversation has clearly and \
repeatedly (${DEPTH_RECURRENCE_THRESHOLD}+ times) circled back to ONE of the unexplored profile areas listed \
in your context that the person hasn't filled in — optionally invite them to go deeper (array with AT MOST ONE \
{"sectionId": the exact section id from that list, "theme": the recurring topic in a few words e.g. "your \
father", "rationale": a short, warm human reason e.g. "family has come up a few times"}). Omit or leave empty \
when nothing recurs, when the area is already covered, or for a heavier/sensitive area unless they clearly \
opened that door themselves — do not guess or push.`;

/** The depth-ask context passed to the live session prompt builder (§3.5) — the in-session gentle invitation. */
export interface DepthAskContext {
  sections: InvitedSectionMeta[];
}

/**
 * Build the in-session depth-ask instruction (§3.5) — a guarded, prompt-level invitation appended AFTER
 * persona + safety + context (it steers, never overrides). The coach may weave ONE gentle question into a
 * RELEVANT session, then drop it. Heavier/adult sections are excluded unless gated (the caller filters adult by
 * the 18+ ack); restricted-but-not-adult areas (e.g. difficult experiences) are only raised if the person opens
 * that door. Crisis always takes precedence. Returns '' when there's nothing to invite.
 */
export function depthAskInstruction(ctx: DepthAskContext): string {
  const sections = ctx.sections;
  if (sections.length === 0) return '';
  const titles = sections.map((s) => `"${s.title}"`).join(', ');
  return `There are a few parts of this person's profile they haven't filled in yet: ${titles}. If — and \
ONLY if — this conversation is clearly and naturally about one of those areas, you may gently invite them, at \
MOST ONCE, to share a little more about it (e.g. "we keep coming back to your family — would you want to tell \
me a bit more about them sometime?"). Offer it once; if they don't take it up or say not now, let it go and \
stay with what they came to talk about — never derail the session. Never raise a heavier or sensitive area \
(difficult experiences, intimacy) unless the person clearly opens that door first. This NEVER takes precedence \
over safety: if they express any distress or crisis, drop the invitation entirely and respond with care.`;
}
