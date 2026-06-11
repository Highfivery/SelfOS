import type { FileSystem } from '../host';
import { summarizeForContext } from '../insights';
import { getPerson, listPeople } from '../people/peopleService';
import { listRelationships } from '../people/relationshipService';

/**
 * The **context-provider registry** (08-questionnaires §5.1) — the extensibility backbone for AI
 * generation + the gap-finder. Generation pulls structured context from every registered provider;
 * `09` (session analysis) registers a session-insight provider, and future features register their own,
 * with **no changes to the generators**.
 *
 * The author configures which subjects feed a generation: their **own** data, an optional **target**
 * person the questionnaire is about, and/or the **relationship** between them. A target person's data is
 * limited to **shareable** facts (never their private notes) — the §04/§8.4 shareable-vs-private split,
 * the same rule `buildContext` follows.
 */
export interface GenerationContextRequest {
  authorPersonId: string;
  includeAuthor: boolean;
  targetPersonId?: string;
  includeTarget: boolean;
  includeRelationship: boolean;
}

export interface ContextProvider {
  id: string;
  label: string;
  /** Contribute a context section for this request, or '' to contribute nothing. */
  gather: (fs: FileSystem, key: Uint8Array, request: GenerationContextRequest) => Promise<string>;
}

const nameOf = (displayName: string, pronouns?: string): string =>
  pronouns ? `${displayName} (${pronouns})` : displayName;

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
        if (author.publicNotes) lines.push(`About them: ${author.publicNotes}`);
        if (author.privateNotes) lines.push(`Their own private notes: ${author.privateNotes}`);
        if (author.tags.length > 0) lines.push(`Their tags: ${author.tags.join(', ')}`);
      }
    }
    if (req.targetPersonId && req.includeTarget) {
      const target = await getPerson(fs, key, req.targetPersonId);
      if (target) {
        lines.push(`It is about ${nameOf(target.displayName, target.pronouns)}.`);
        // Shareable facts only — a target person's private notes never feed generation.
        if (target.publicNotes) lines.push(`About ${target.displayName}: ${target.publicNotes}`);
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
        const note = r.publicNotes ? ` — ${r.publicNotes}` : '';
        return `Their relationship with ${target?.displayName ?? 'them'}: ${r.type}${note}`;
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
    // selected. `summarizeForContext` enforces the shareable-vs-private split for the related person.
    let related: { id: string; displayName: string }[] = [];
    if (req.targetPersonId && req.includeTarget) {
      const target = await getPerson(fs, key, req.targetPersonId);
      if (target) related = [{ id: target.id, displayName: target.displayName }];
    }
    return summarizeForContext(fs, key, req.authorPersonId, related);
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
