import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  EmailResponseSchema,
  EmailTokenSchema,
  type EmailResponse,
  type EmailToken,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { readEmailPrefs, setEmailPrefs } from './emailPrefs';

/**
 * The interactive email response layer (67 §3.5/§3.6 / Phase 4). One-click email buttons are opaque relay
 * tokens; a tap is recorded by the relay (only "token T was tapped, and when"); on the next reconcile the
 * app drains the taps and maps each — locally, in the encrypted vault — back to an `EmailResponse` that
 * feeds coaching context + the in-app response history. The relay never learns a token's meaning.
 */

const tokensDir = (personId: string): string => `people/${personId}/email/tokens`;
const tokenPath = (personId: string, token: string): string =>
  `${tokensDir(personId)}/${token}.enc`;
const responsesDir = (personId: string): string => `people/${personId}/email/responses`;
const responsePath = (personId: string, id: string): string =>
  `${responsesDir(personId)}/${id}.enc`;

/**
 * How long a minted token can live locally. Matches the relay's `TAP_TTL_SECONDS` (30 days): once the relay
 * has expired the tap key, an untapped token can never resolve, so an older one is safe to prune. Bounds the
 * local token store + the `drainTaps` payload — each "away" reconcile re-mints re-engagement tokens without
 * removing the superseded ones, so without pruning they'd accumulate forever.
 */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A minimal relay tap-drain transport (the host supplies the concrete `RelayClient.drainTaps`). */
export interface TapDrainer {
  drainTaps(tokens: string[]): Promise<{ token: string; at: string }[]>;
}

/** Persist an opaque token's local meaning so a later tap can be mapped back (67 §4.5). */
export async function mintEmailToken(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  token: EmailToken,
): Promise<void> {
  await writeEncryptedJson(fs, tokenPath(personId, token.token), token, key);
}

/** Read a person's un-drained token map (each pending one-click token). Corrupt/absent files are skipped. */
async function listTokens(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<EmailToken[]> {
  const out: EmailToken[] = [];
  for (const name of await fs.list(tokensDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${tokensDir(personId)}/${name}`, key);
    if (!raw) continue;
    const parsed = EmailTokenSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Read a person's email responses, newest first (67 §3.6 — the own-only in-app history). */
export async function listEmailResponses(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<EmailResponse[]> {
  const out: EmailResponse[] = [];
  for (const name of await fs.list(responsesDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${responsesDir(personId)}/${name}`, key);
    if (!raw) continue;
    const parsed = EmailResponseSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => (a.respondedAt < b.respondedAt ? 1 : -1));
}

/** Edit a response's answer in place (67 §3.6 — the editable-history posture). Stamps `edited`. */
export async function editEmailResponse(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  id: string,
  answer: string,
): Promise<EmailResponse | null> {
  const raw = await readEncryptedJson(fs, responsePath(personId, id), key);
  if (!raw) return null;
  const parsed = EmailResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const next: EmailResponse = { ...parsed.data, answer, edited: true };
  await writeEncryptedJson(fs, responsePath(personId, id), next, key);
  return next;
}

/**
 * Apply a drained response's immediate effect (67 §3.6). Phase 4 wires the concrete one: a `pause` reaction
 * on the re-engagement family is a one-click "email me less" — it turns that family OFF. The richer effects
 * (resurface, de-dup avoid-set, mutual green light, more/less tuning) ride the suggestion engine in Phase 5.
 */
async function applyResponseEffect(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  response: EmailResponse,
  now: Date,
): Promise<void> {
  if (response.answer === 'pause' && response.family === 're-engagement') {
    // Turn off ONLY the re-engagement family. `setEmailPrefs` coerces `intimacyEmailOptIn` off when its
    // `eligibleForIntimacy` arg is false — so pass the current opt-in as eligibility, preserving a
    // legitimately-true intimacy opt-in (a re-engagement pause must not silently disable it in Phase 5).
    const current = await readEmailPrefs(fs, key, personId);
    await setEmailPrefs(
      fs,
      key,
      personId,
      { families: { 're-engagement': false } },
      current?.intimacyEmailOptIn ?? false,
      now,
    );
  }
}

/**
 * Drain the relay tap markers for a person's pending tokens (67 §3.5), map each tap → an `EmailResponse`
 * (writing it to the vault), apply its effect, and delete the consumed token map. A token that maps to
 * nothing (already drained / deleted) is simply skipped. Returns the responses created.
 */
export async function drainEmailTaps(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  relay: TapDrainer,
  now: Date,
): Promise<EmailResponse[]> {
  const all = await listTokens(fs, key, personId);
  // Prune expired tokens (older than the relay's tap TTL — they can never resolve) so the local store and the
  // `drainTaps` payload stay bounded across repeated re-engagement re-mints.
  const nowMs = now.getTime();
  const tokens: EmailToken[] = [];
  for (const t of all) {
    if (nowMs - new Date(t.mintedAt).getTime() > TOKEN_TTL_MS) {
      await fs.remove(tokenPath(personId, t.token));
    } else {
      tokens.push(t);
    }
  }
  if (tokens.length === 0) return [];
  const byToken = new Map(tokens.map((t) => [t.token, t]));
  const taps = await relay.drainTaps(tokens.map((t) => t.token));

  const created: EmailResponse[] = [];
  for (const tap of taps) {
    const token = byToken.get(tap.token);
    if (!token) continue; // a stale/unknown tap → dropped
    const sensitivity =
      token.kind === 'intimacy-reaction' ? ('intimacy' as const) : ('standard' as const);
    const response: EmailResponse = {
      id: uuid(),
      schemaVersion: 1,
      family: token.family,
      ...(token.suggestionId ? { suggestionId: token.suggestionId } : {}),
      ...(token.questionId ? { questionId: token.questionId } : {}),
      kind: token.kind,
      answer: token.answer,
      sensitivity,
      respondedAt: tap.at,
      source: 'relay-tap',
      edited: false,
    };
    await writeEncryptedJson(fs, responsePath(personId, response.id), response, key);
    await applyResponseEffect(fs, key, personId, response, now);
    // The token is consumed — delete every token minted for this SAME email interaction (a tap on one
    // option answers the whole question, so the sibling options are spent too).
    for (const sibling of tokens) {
      if (sibling.interactionId === token.interactionId) {
        await fs.remove(tokenPath(personId, sibling.token));
        byToken.delete(sibling.token);
      }
    }
    created.push(response);
  }
  return created;
}
