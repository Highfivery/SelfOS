import { listConversations } from '../conversations/conversationService';
import type { FileSystem } from '../host';
import { uuid } from '../id';
import type { QuoteCandidate, QuoteSource, QuoteStatus } from '../schemas';
import { listMessages, listSessionsForPerson } from '../together/togetherService';
import { getQuotes, saveQuotes } from './storyService';

/**
 * Quote mining (64-your-story §17.4, #304) — surface the vivid, verbatim lines the person actually SAID, as a
 * review queue the author approves. Nothing is cited until an author approves it; only APPROVED quotes reach
 * the corpus (the single funnel), so a pending/rejected candidate is structurally invisible to generation and
 * export.
 *
 * Privacy is enforced at MINING time, not just at approval: a Together line is mined ONLY when the subject is
 * its author (`authorPersonId === personId`) and it is not a private aside — so a partner's verbatim words
 * never enter the subject's review queue in the first place. Session prose is the subject's own conversation,
 * so its `role:'user'` lines are inherently theirs.
 *
 * The miner is deterministic and AI-free — it proposes candidate lines by simple shape (a first-person
 * statement of a readable length); the author is the quality filter. (A smarter AI-ranked miner is a possible
 * future enhancement; the review-queue model tolerates false positives.)
 */

const MIN_QUOTE_WORDS = 6;
const MAX_QUOTE_WORDS = 60;
/** Cap new candidates per mining run so the queue stays reviewable (newest lines first). */
const MAX_NEW_PER_RUN = 30;
/** First-person markers — a quotable line is the person speaking about themselves/their people. */
const FIRST_PERSON = new Set(['i', "i'm", "i've", "i'd", "i'll", 'my', 'me', 'we', "we're", 'our']);

/** Normalize a line for de-duplication (lowercase, collapse whitespace, drop trailing punctuation). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:'"]+$/, '')
    .trim();
}

/** Split a message into candidate sentences, each kept verbatim (with its terminal punctuation). */
function sentences(content: string): string[] {
  const matched = content.match(/[^.!?]+[.!?]+/g) ?? [];
  const trailing = content.replace(/[^.!?]+[.!?]+/g, '').trim();
  const all = trailing ? [...matched, trailing] : matched.length > 0 ? matched : [content];
  return all.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * A candidate is a readable-length first-person STATEMENT (not a bare question). Verbatim fidelity is kept —
 * we only decide whether a line is quotable, never rewrite it.
 */
export function isQuotable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith('?')) return false; // a bare question is rarely a quotable line
  const words = trimmed.split(/\s+/);
  if (words.length < MIN_QUOTE_WORDS || words.length > MAX_QUOTE_WORDS) return false;
  // Normalize curly apostrophes to straight so "I’m" (U+2019) still matches a first-person marker.
  const lower = words.map((w) =>
    w
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/[^a-z']/g, ''),
  );
  return lower.some((w) => FIRST_PERSON.has(w));
}

/**
 * Mine new candidate quotes from the subject's own sessions + Together lines, append them (as `pending`) to the
 * book's quote store, and return the full list. De-duped against existing candidates (any status — so a
 * rejected line is never re-surfaced) and within the run. Newest lines first, capped per run.
 */
export async function mineQuoteCandidates(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  now: Date,
): Promise<QuoteCandidate[]> {
  const existing = await getQuotes(fs, key, personId, bookId);
  const seen = new Set(existing.map((q) => normalize(q.text)));

  type Found = { text: string; source: QuoteSource; conversationId: string; messageTs: string };
  const found: Found[] = [];

  // Sessions — the subject's own conversations; every `role:'user'` line is theirs. A Together PREP thread
  // (a solo Conversation carrying `togetherSessionId`, 58 §3.7) is confidential scratch space, so it is NOT
  // mined here — the person's shared Together lines are mined separately below, with the aside/partner gates.
  const conversations = await listConversations(fs, key, personId).catch(() => []);
  for (const conversation of conversations) {
    if (conversation.togetherSessionId) continue;
    for (const message of conversation.messages) {
      if (message.role !== 'user') continue;
      for (const sentence of sentences(message.content)) {
        found.push({
          text: sentence,
          source: 'session',
          conversationId: conversation.id,
          messageTs: message.ts,
        });
      }
    }
  }

  // Together — mine ONLY the subject's own, non-aside lines (a partner's words never enter the queue).
  const sessionsList = await listSessionsForPerson(fs, key, personId).catch(() => []);
  for (const session of sessionsList) {
    const messages = await listMessages(fs, key, session.id).catch(() => []);
    for (const message of messages) {
      if (message.role !== 'user') continue;
      if (message.authorPersonId !== personId) continue;
      if (message.privateAside) continue;
      if (message.redacted) continue;
      for (const sentence of sentences(message.content)) {
        found.push({
          text: sentence,
          source: 'together',
          conversationId: session.id,
          messageTs: message.ts,
        });
      }
    }
  }

  // Newest first, keep the quotable + de-duped, cap the run.
  found.sort((a, b) => b.messageTs.localeCompare(a.messageTs));
  const additions: QuoteCandidate[] = [];
  const createdAt = now.toISOString();
  for (const f of found) {
    if (additions.length >= MAX_NEW_PER_RUN) break;
    if (!isQuotable(f.text)) continue;
    const norm = normalize(f.text);
    if (seen.has(norm)) continue;
    seen.add(norm);
    additions.push({
      id: uuid(),
      text: f.text.trim(),
      source: f.source,
      conversationId: f.conversationId,
      messageTs: f.messageTs,
      status: 'pending',
      createdAt,
    });
  }

  if (additions.length > 0) {
    await saveQuotes(fs, key, personId, bookId, [...existing, ...additions]);
    return [...existing, ...additions];
  }
  return existing;
}

/** Approve or reject a candidate (§17.4). Only an approved quote is ever cited. Unknown id → a no-op read. */
export async function setQuoteStatus(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  quoteId: string,
  status: QuoteStatus,
): Promise<QuoteCandidate[]> {
  const items = await getQuotes(fs, key, personId, bookId);
  let changed = false;
  const next = items.map((q) => {
    if (q.id !== quoteId || q.status === status) return q;
    changed = true;
    return { ...q, status };
  });
  if (changed) await saveQuotes(fs, key, personId, bookId, next);
  return next;
}
