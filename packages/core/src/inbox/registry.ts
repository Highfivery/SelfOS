import type { FileSystem } from '../host';

/**
 * The **Inbox registry** (08-questionnaires §35) — one cross-domain queue of things that arrived for the
 * signed-in person, assembled from providers rather than hard-wired to one feature.
 *
 * Before this, "your Inbox" meant questionnaires, and every other thing addressed to you announced itself
 * through the notification fan-out instead: a Together invitation, an invitation to add to someone's book, a
 * book someone shared. Those are queue-shaped — they arrive, they wait for you, they are done with — and a
 * bell is a poor home for them, because a dismissed notification is gone whether or not you dealt with the
 * thing behind it.
 *
 * The registry is the extensibility seam (the `contextProviders` pattern, 08 §5.1): a new kind registers a
 * provider and appears in the queue with no change to the Inbox itself.
 *
 * **The queue only ever NAVIGATES.** No entry acts on the person's behalf, and that is a safety property, not
 * a style choice — accepting a Together invitation is also the consent record for the rules of the room, which
 * only the invitation screen shows (58 §3.4). An inline Accept would write that record for a screen the person
 * never saw, and would bypass "Decline quietly", which exists for someone who does not feel able to say no
 * directly (§8.3). Each kind is opened where it lives, and decided there.
 */

export type InboxEntryKind =
  | 'check-in'
  | 'together-invitation'
  | 'contribution-invitation'
  | 'shared-book';

/** One thing waiting for the signed-in person, in any domain. */
export interface InboxEntry {
  /**
   * Stable and kind-scoped (`<kind>:<domain id>`) so two domains can never collide on an id, and so a
   * dismissal recorded against it stays meaningful.
   */
  id: string;
  kind: InboxEntryKind;
  /** What it is, in the person's words. NEVER content they have not been cleared to see — see `openPath`. */
  title: string;
  /** Who it came from, when that is known and may be shown. */
  fromName?: string;
  /** One quiet line of context. Same rule as `title`: never message content. */
  detail?: string;
  /** When it arrived — the queue is one list, newest first (owner, 2026-08-20). */
  at: string;
  /**
   * Where opening it goes. A route, never an action: the queue hands the person to the surface that owns the
   * decision, with that surface's own framing, gates and consent intact.
   *
   * Absent for `check-in`, which is answered in place — the Inbox has always been the answering surface for
   * a questionnaire, and moving that would be a regression dressed as consistency.
   */
  openPath?: string;
  /** Whether the person may remove it from their queue without acting on it. */
  dismissible: boolean;
  /**
   * Whether this still needs the person. The queue LISTS more than it counts: an answered check-in stays,
   * because reviewing and editing your own answers happens here (§56), but nothing is waiting on you for it.
   * The badge and the single "waiting for you" notification both count this and nothing else, which is what
   * keeps one number meaning one thing.
   */
  waiting: boolean;
}

/**
 * What a provider is given. `readAt` is the viewer's DEVICE-LOCAL read progress (bookId → ISO), threaded in
 * because it is the only thing that can tell a book they have already read from one that just arrived — and
 * device state cannot be read from core. Without it every shared book reads as new and never leaves the queue.
 */
export interface InboxContext {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  now: Date;
  readAt: Record<string, string>;
}

export interface InboxProvider {
  kind: InboxEntryKind;
  /** Everything of this kind currently waiting for the person. Must never throw — see `collectInbox`. */
  list: (ctx: InboxContext) => Promise<readonly InboxEntry[]>;
}

const providers: InboxProvider[] = [];

export function registerInboxProvider(provider: InboxProvider): void {
  if (!providers.some((p) => p.kind === provider.kind)) providers.push(provider);
}

export function listInboxProviders(): InboxProvider[] {
  return [...providers];
}

/** Drop every provider — for tests that exercise one in isolation. */
export function resetInboxProviders(): void {
  providers.length = 0;
}

/**
 * The entries that still need the person — the ONE derivation every surface that counts the queue reads.
 * The badge takes its length; the "waiting for you" notification takes its ids for a signature (08 §36).
 * Both go through here rather than re-filtering `waiting` inline, because a second inline copy is exactly
 * how two counts of the same thing come to disagree.
 */
export function waitingEntries(entries: readonly InboxEntry[]): InboxEntry[] {
  return entries.filter((e) => e.waiting);
}

/** How many entries still need the person — the number the nav badge shows. */
export function waitingCount(entries: readonly InboxEntry[]): number {
  return waitingEntries(entries).length;
}

/**
 * Run every provider and return one list, newest first (owner, 2026-08-20 — a single chronological queue
 * reads as "what came in", which is what an inbox is).
 *
 * A provider that throws contributes NOTHING and never takes the queue down with it. That matters more here
 * than in a single-feature list: four domains feed this, and one unreadable book must not cost someone the
 * check-in sitting above it. Dismissed ids are filtered last, so a dismissal survives the entry reappearing
 * from its provider.
 */
export async function collectInbox(
  ctx: InboxContext,
  dismissedIds: readonly string[] = [],
): Promise<InboxEntry[]> {
  const dismissed = new Set(dismissedIds);
  const lists = await Promise.all(
    providers.map(async (p) => {
      try {
        return await p.list(ctx);
      } catch {
        return [] as readonly InboxEntry[];
      }
    }),
  );
  return lists
    .flat()
    .filter((e) => !dismissed.has(e.id))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id.localeCompare(b.id)));
}
