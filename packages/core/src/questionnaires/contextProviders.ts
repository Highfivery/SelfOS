import type { FileSystem } from '../host';
import { summarizeForContext, type RelatedForContext } from '../insights';
import { getPerson, listPeople } from '../people/peopleService';
import { listRelationships } from '../people/relationshipService';
import { relationshipTypesFromSubjectToViewer } from '../people/relationshipScope';
import { questionnaireTopic } from './questionnaireTopic';

/**
 * The **context-provider registry** (08-questionnaires §5.1) — the extensibility backbone for AI
 * generation + the gap-finder. Generation pulls structured context from every registered provider;
 * `09` (session analysis) registers a session-insight provider, and future features register their own,
 * with **no changes to the generators**.
 *
 * The author configures which subjects feed a generation: their **own** data, an optional **target**
 * person the questionnaire is about, and/or the **relationship** between them. Per the owner's informed §24.5
 * decision, questionnaire TAILORING feeds ALL of the recipient's profile fields (private included) — scoped to
 * questionnaire generation only; coaching context (`buildContext`) keeps the §04/§8.4 shareable-vs-private split.
 * (The `insightsProvider` still routes the recipient's INSIGHT facts through the shareable gate; the recipient's
 * full insight facts reach generation host-side via `recipientKnownData`/`gatherRecipientInsightFacts` instead.)
 */
export interface GenerationContextRequest {
  authorPersonId: string;
  includeAuthor: boolean;
  targetPersonId?: string;
  includeTarget: boolean;
  includeRelationship: boolean;
  /** The questionnaire's type (08 §15.1) — derives a relevance topic so the author's pinned portrait surfaces
   *  the facts relevant to this questionnaire (28 §13.1). Absent ⇒ no topic (core + fill). */
  questionnaireType?: string;
}

export interface ContextProvider {
  id: string;
  label: string;
  /** Contribute a context section for this request, or '' to contribute nothing. */
  gather: (fs: FileSystem, key: Uint8Array, request: GenerationContextRequest) => Promise<string>;
}

const nameOf = (displayName: string, pronouns?: string): string =>
  pronouns ? `${displayName} (${pronouns})` : displayName;

/**
 * The rich profile as POSITIVE tailoring signal (08 §24.4-B1): who this person is — their work, life, and inner
 * world — so questions feel written for their actual life, not generic. Per the owner's informed §24.5 decision
 * this feeds ALL of the recipient's fields (shareable + private), scoped to questionnaire generation only.
 */
function profileLines(person: Awaited<ReturnType<typeof getPerson>>): string[] {
  if (!person) return [];
  const out: string[] = [];
  const push = (label: string, value?: string | null): void => {
    const v = value?.trim();
    if (v) out.push(`  - ${label}: ${v}`);
  };
  const list = (label: string, arr?: readonly string[]): void => {
    if (arr && arr.length > 0) out.push(`  - ${label}: ${arr.join(', ')}`);
  };
  push('occupation', person.occupation);
  push('location', person.location);
  push('gender', person.gender);
  push('birthday', person.birthday);
  push('relationship status', person.relationshipStatus);
  push('parental status', person.parentalStatus);
  push('living situation', person.livingSituation);
  list('languages', person.languages);
  push('ethnicity', person.ethnicity);
  list('interests', person.interests);
  list('values', person.values);
  push('goals', person.goals);
  push('communication style', person.communicationStyle);
  push('faith', person.faith);
  push('sexual orientation', person.sexualOrientation);
  push('relationship style', person.relationshipStyle);
  push('health notes', person.healthNotes);
  list('tags', person.tags);
  push('notes', person.notes);
  return out;
}

const profilesProvider: ContextProvider = {
  id: 'profiles',
  label: 'Profiles',
  gather: async (fs, key, req) => {
    const lines: string[] = [];
    if (req.includeAuthor) {
      const author = await getPerson(fs, key, req.authorPersonId);
      if (author) {
        lines.push(
          `The questionnaire is created by ${nameOf(author.displayName, author.pronouns)}.`,
        );
        const authorLines = profileLines(author);
        if (authorLines.length > 0) lines.push(`About the author:`, ...authorLines);
      }
    }
    if (req.targetPersonId && req.includeTarget) {
      const target = await getPerson(fs, key, req.targetPersonId);
      if (target) {
        lines.push(
          `It is FOR ${nameOf(target.displayName, target.pronouns)} — tailor to who they are:`,
        );
        // Per §24.5 (the owner's informed override), a recipient's full profile — private fields included —
        // feeds questionnaire tailoring. This is questionnaire-generation-scoped; coaching context is unchanged.
        lines.push(...profileLines(target));
      }
    }
    return lines.join('\n');
  },
};

const relationshipsProvider: ContextProvider = {
  id: 'relationships',
  label: 'Relationship',
  gather: async (fs, key, req) => {
    // Only the specific author↔target relationship, and only when that source is selected — so the
    // toggles stay clean (the author's whole relationship web isn't pulled in as a side effect).
    if (!req.targetPersonId || !req.includeRelationship) return '';
    const relationships = await listRelationships(fs, key);
    const byId = new Map((await listPeople(fs, key)).map((p) => [p.id, p]));
    const between = relationships.filter(
      (r) =>
        (r.fromPersonId === req.authorPersonId && r.toPersonId === req.targetPersonId) ||
        (r.fromPersonId === req.targetPersonId && r.toPersonId === req.authorPersonId),
    );
    const target = byId.get(req.targetPersonId);
    return between
      .map((r) => {
        const note = r.notes ? ` — ${r.notes}` : ''; // §24.5: recipient relationship notes feed tailoring too
        const close = r.closeness != null ? `, closeness ${r.closeness}/5` : '';
        const since = r.since ? `, since ${r.since}` : '';
        return `Their relationship with ${target?.displayName ?? 'them'}: ${r.type}${close}${since}${note}`;
      })
      .join('\n');
  },
};

const insightsProvider: ContextProvider = {
  id: 'insights',
  label: 'Insights',
  gather: async (fs, key, req) => {
    if (!req.includeAuthor) return '';
    // The author's own approved Insights, plus the **target's shareable** facts when that source is
    // selected. `summarizeForContext` enforces the shareable-vs-private split for the related person —
    // including relationship-type scoping (42), resolved as how the target relates to the author (viewer).
    const author = await getPerson(fs, key, req.authorPersonId);
    let related: RelatedForContext[] = [];
    if (req.targetPersonId && req.includeTarget) {
      const target = await getPerson(fs, key, req.targetPersonId);
      if (target) {
        const grantedTypes = relationshipTypesFromSubjectToViewer(
          target.id,
          req.authorPersonId,
          await listRelationships(fs, key),
        );
        related = [{ id: target.id, displayName: target.displayName, grantedTypes }];
      }
    }
    return summarizeForContext(
      fs,
      key,
      req.authorPersonId,
      related,
      questionnaireTopic(req.questionnaireType),
      author?.displayName,
    );
  },
};

const providers: ContextProvider[] = [];

/** Register a context provider (idempotent by `id`). Used by `09` + future features for extensibility. */
export function registerContextProvider(provider: ContextProvider): void {
  if (!providers.some((p) => p.id === provider.id)) providers.push(provider);
}

export function listContextProviders(): ContextProvider[] {
  return [...providers];
}

export function registerBuiltInContextProviders(): void {
  registerContextProvider(profilesProvider);
  registerContextProvider(relationshipsProvider);
  registerContextProvider(insightsProvider);
}

/** Reset to just the built-ins — for tests that register/exercise providers in isolation. */
export function resetContextProviders(): void {
  providers.length = 0;
  registerBuiltInContextProviders();
}

registerBuiltInContextProviders();

/** Assemble the structured context for a generation/suggestion request from all registered providers. */
export async function gatherGenerationContext(
  fs: FileSystem,
  key: Uint8Array,
  request: GenerationContextRequest,
): Promise<string> {
  const sections = await Promise.all(providers.map((p) => p.gather(fs, key, request)));
  return sections
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .join('\n\n');
}

/**
 * The boilerplate identity lines the profiles provider ALWAYS emits even when the author/target has no
 * substantive data (so a literally-empty `gatherGenerationContext` never happens). Kept here next to the
 * provider that produces them so the coupling lives in one place.
 */
const IDENTITY_PREFIXES = ['The questionnaire is created by', 'It is FOR', 'About the author:'];

/**
 * Whether gathered context has NO substantive signal — only the identity boilerplate (37 §11). The
 * gap-finder uses this for its PRE-CALL empty-state hint: with nothing to work from, say so without
 * spending, instead of calling Claude and then blaming the user's data on a parse miss.
 */
export function isThinContext(context: string): boolean {
  const lines = context
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lines.every((l) => IDENTITY_PREFIXES.some((p) => l.startsWith(p)));
}
