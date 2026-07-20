import { decrypt, encrypt, hashPin, isEncryptedEnvelope } from '../crypto';
import { uuid } from '../id';
import {
  buildRelayLink,
  generateContentKey,
  generatePin,
  generateRelayToken,
  generateSendKeyPair,
  openResponse,
  sealContent,
  sealImageBytes,
  sealResult,
} from '../relay';
import {
  AssignmentSchema,
  type Assignment,
  type ConsentReceipt,
  type EncryptedEnvelopeData,
  type PrivacyMode,
  type Question,
  type RelayContent,
  type RelayMailbox,
  type RelayResult,
  type RelayStoredResponse,
  type ResponseSet,
} from '../schemas';
import type { FileSystem } from '../host';
import { writeEncryptedJson } from '../vault';
import { assignmentPath, consentPath, snapshotPath } from './paths';
import { getAssignment, getAssignmentSnapshot } from './assignmentService';
import { getQuestionnaireImage } from './imageService';
import { saveResponse } from './responseService';
import { getQuestionnaire, validateQuestionnaire } from './questionnaireService';

/**
 * App-side relay orchestration (08-questionnaires §3.2/§3.5/§5.1) — minting an external send and draining
 * its responses, gluing the pure relay crypto (`@selfos/core/relay`) to the vault and an injected
 * `RelayClient` (the host's HTTP transport, authed by the drain secret). The Cloudflare token + drain
 * secret live host-side and never reach core here; this module only ever sees the endpoint URL.
 */

/** Unclaimed sends expire after this when the sender didn't set an explicit expiry (§11.3). */
export const DEFAULT_RELAY_EXPIRY_DAYS = 60;

/** The transport the host implements over HTTPS (drain-secret authed); core stays network-free + testable. */
export interface RelayClient {
  putMailbox(mailbox: RelayMailbox): Promise<void>;
  putResult(token: string, sealedResult: EncryptedEnvelopeData): Promise<void>;
  drain(token: string): Promise<RelayStoredResponse[]>;
  purge(token: string): Promise<void>;
  revoke(token: string): Promise<void>;
}

export interface CreateRelaySendInput {
  questionnaireId: string;
  senderPersonId: string;
  /** The sending person's display name, shown on the relay when not anonymous (§3.2). */
  senderName: string;
  recipient: { kind: 'external'; displayName?: string; email?: string; phone?: string };
  senderVisibleToRecipient: boolean;
  /** Standard (sender sees raw answers) or Private (break-glass; raw hidden in the UI) — §3.2/§8.4. */
  privacy: PrivacyMode;
  /** The honest disclosure text, DERIVED app-side from privacy/visibility (§8.4) — shown verbatim on the relay. */
  disclosure: string;
  endpointUrl: string;
  expiresAt?: string;
  /**
   * External compatibility (08 §17.12-B): snapshot this personalized **variant** (aligned to the canonical
   * questions by `canonicalId`) instead of the plain definition, and link this send to the compatibility
   * group so the sender's in-app send + this relay send align. Omitted for an ordinary external send.
   */
  variant?: Question[];
  compatibilityGroupId?: string;
}

export interface CreateRelaySendResult {
  assignment: Assignment;
  link: string; // includes the content key in the URL fragment
  pin: string; // 6-digit; shown once to the sender for delivery
}

function defaultExpiry(): string {
  return new Date(Date.now() + DEFAULT_RELAY_EXPIRY_DAYS * 86_400_000).toISOString();
}

/** Build the sealed RelayContent: the as-sent snapshot + the response public key + re-encrypted images. */
async function buildContent(
  fs: FileSystem,
  key: Uint8Array,
  snapshot: RelayContent['questionnaire'],
  publicKey: string,
  senderName: string | null,
  disclosure: string,
  contentKey: string,
): Promise<RelayContent> {
  const images: Record<string, EncryptedEnvelopeData> = {};
  for (const question of snapshot.questions) {
    if (!question.media) continue;
    const bytes = await getQuestionnaireImage(fs, key, question.media.imagePath);
    if (bytes) images[question.media.imagePath] = await sealImageBytes(bytes, contentKey);
  }
  return { schemaVersion: 1, questionnaire: snapshot, publicKey, senderName, disclosure, images };
}

/**
 * Mint the relay link material for one send: a fresh ECDH keypair + content key + PIN, with the
 * sealed-content ciphertext mailbox uploaded. Shared by minting an external send AND attaching a link to an
 * in-app (household) send (08 §17.13). The content key lives only in the returned link's fragment.
 */
async function mintRelay(
  fs: FileSystem,
  key: Uint8Array,
  relay: RelayClient,
  input: {
    snapshot: RelayContent['questionnaire'];
    senderName: string | null; // already resolved: null = anonymous
    disclosure: string;
    endpointUrl: string;
    createdAt: string;
    expiresAt: string;
  },
): Promise<{ relay: NonNullable<Assignment['relay']>; link: string; pin: string }> {
  const token = generateRelayToken();
  const contentKey = generateContentKey();
  const pin = generatePin();
  const { publicKey, privateKey } = await generateSendKeyPair();
  const privateKeyWrapped = JSON.stringify(await encrypt(privateKey, key));
  // Wrap the content key under the master key too, so the sender can later seal an OUTCOME the recipient
  // decrypts with the same fragment key (compatibility report write-back, §17.12-D).
  const contentKeyWrapped = JSON.stringify(await encrypt(contentKey, key));
  const pinHash = await hashPin(pin);
  // Keep the PIN wrapped under the master key too, so the sender can re-show the existing link + PIN later
  // ("Share link", §17.14d) without regenerating. The relay only ever gets the hash.
  const pinWrapped = JSON.stringify(await encrypt(pin, key));
  const content = await buildContent(
    fs,
    key,
    input.snapshot,
    publicKey,
    input.senderName,
    input.disclosure,
    contentKey,
  );
  const sealedContent = await sealContent(content, contentKey);
  const mailbox: RelayMailbox = {
    schemaVersion: 1,
    token,
    sealedContent,
    pinHash,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
  await relay.putMailbox(mailbox);
  return {
    relay: { token, pinHash, publicKey, privateKeyWrapped, contentKeyWrapped, pinWrapped },
    link: buildRelayLink(input.endpointUrl, token, contentKey),
    pin,
  };
}

/**
 * Reconstruct the EXISTING link + PIN for a send from its stored relay material (08 §17.14d) — the link from
 * the token + the wrapped content key, the PIN from the wrapped PIN. No minting, no relay call: this is how
 * "Share link" re-shows a stable link instead of regenerating. Returns null if the send has no relay
 * material, or was minted before `pinWrapped`/`contentKeyWrapped` existed (the caller mints fresh instead).
 */
export async function readRelayLink(
  fs: FileSystem,
  key: Uint8Array,
  assignmentId: string,
  endpointUrl: string,
): Promise<{ link: string; pin: string } | null> {
  const assignment = await getAssignment(fs, key, assignmentId);
  const relay = assignment?.relay;
  if (!relay?.contentKeyWrapped || !relay.pinWrapped) return null;
  const contentKey = await unwrapUnderMasterKey(relay.contentKeyWrapped, key);
  const pin = await unwrapUnderMasterKey(relay.pinWrapped, key);
  return { link: buildRelayLink(endpointUrl, relay.token, contentKey), pin };
}

/**
 * Mint an external (relay) send: snapshot the validated questionnaire, generate a per-send ECDH keypair +
 * content key + PIN, seal the content (incl. images) under the content key, upload the ciphertext mailbox,
 * and persist the Assignment with its relay material (the private key wrapped under the master key). The
 * content key lives only in the returned link's fragment; the PIN is returned once for delivery.
 */
export async function createRelaySend(
  fs: FileSystem,
  key: Uint8Array,
  relay: RelayClient,
  input: CreateRelaySendInput,
): Promise<CreateRelaySendResult> {
  const def = await getQuestionnaire(fs, key, input.questionnaireId);
  if (!def) throw new Error(`Questionnaire not found: ${input.questionnaireId}`);
  // For an external compatibility send (08 §17.12-B) the as-sent snapshot is the recipient's personalized
  // VARIANT, not the plain definition; otherwise it's the definition.
  const questionnaire = input.variant ? { ...def, questions: input.variant } : def;
  const problems = validateQuestionnaire(questionnaire);
  if (problems.length > 0) {
    throw new Error(`Cannot send an incomplete questionnaire: ${problems.join(' ')}`);
  }

  const id = uuid();
  const at = new Date().toISOString();
  // Snapshot first (same crash-ordering rationale as createAssignment): an orphan snapshot is invisible
  // to listAssignments; an assignment with no snapshot would be an unanswerable send.
  await writeEncryptedJson(fs, snapshotPath(id), questionnaire, key);

  // Anonymous sends show "Someone" on the relay (the page renders null as such); a named send shows the
  // sending person's display name (NOT the recipient's, who is the addressee).
  const senderName = input.senderVisibleToRecipient ? input.senderName : null;
  const expiresAt = input.expiresAt ?? defaultExpiry();
  const minted = await mintRelay(fs, key, relay, {
    snapshot: questionnaire,
    senderName,
    disclosure: input.disclosure,
    endpointUrl: input.endpointUrl,
    createdAt: at,
    expiresAt,
  });

  const assignment: Assignment = {
    id,
    schemaVersion: 1,
    questionnaireId: questionnaire.id,
    senderPersonId: input.senderPersonId,
    recipient: input.recipient,
    channel: 'relay',
    privacy: input.privacy,
    senderVisibleToRecipient: input.senderVisibleToRecipient,
    ...(input.compatibilityGroupId ? { compatibilityGroupId: input.compatibilityGroupId } : {}),
    status: 'sent',
    expiresAt,
    relay: minted.relay,
    createdAt: at,
    updatedAt: at,
  };
  await writeEncryptedJson(fs, assignmentPath(id), assignment, key);

  return { assignment, link: minted.link, pin: minted.pin };
}

/**
 * Attach a relay link to an EXISTING in-app (household) send (08 §17.13) so the recipient can answer in
 * their Inbox OR open the link anywhere. Mints relay material for the send's frozen snapshot, uploads the
 * mailbox, and stores `assignment.relay` (+ the shared expiry). Returns the link + PIN, shown once. The
 * sender drains the link the same way as an external send; the first submission (either surface) wins.
 */
export async function attachRelayLink(
  fs: FileSystem,
  key: Uint8Array,
  relay: RelayClient,
  assignmentId: string,
  input: {
    senderName: string;
    senderVisibleToRecipient: boolean;
    disclosure: string;
    endpointUrl: string;
    expiresAt?: string;
  },
): Promise<{ link: string; pin: string }> {
  const assignment = await getAssignment(fs, key, assignmentId);
  if (!assignment) throw new Error(`Assignment not found: ${assignmentId}`);
  const snapshot = await getAssignmentSnapshot(fs, key, assignmentId);
  if (!snapshot) throw new Error(`No snapshot for assignment: ${assignmentId}`);

  const senderName = input.senderVisibleToRecipient ? input.senderName : null;
  const expiresAt = input.expiresAt ?? assignment.expiresAt ?? defaultExpiry();
  const minted = await mintRelay(fs, key, relay, {
    snapshot,
    senderName,
    disclosure: input.disclosure,
    endpointUrl: input.endpointUrl,
    createdAt: assignment.createdAt,
    expiresAt,
  });
  // Re-read across the mailbox upload: `assignment` was read before that network round-trip, and an
  // in-app submit/decline (`updateAssignmentStatus`) can land meanwhile — spreading the stale copy would
  // revert a `submitted` status back to `sent`. Only the relay material is ours.
  const liveForMint = await getAssignment(fs, key, assignmentId);
  // Deleted during the upload: leave it deleted. Re-writing it would restore a send with a LIVE mailbox
  // but no snapshot (deleteSend purged the folder) — the unanswerable state createRelaySend orders its
  // writes to avoid. Throwing (rather than returning) reuses the callers' existing mint-failure path, so
  // the sender sees an honest "no link" instead of one pointing at nothing.
  if (!liveForMint) throw new Error('That send was deleted before its link could be created.');
  const updated: Assignment = {
    ...liveForMint,
    relay: minted.relay,
    expiresAt,
    updatedAt: new Date().toISOString(),
  };
  await writeEncryptedJson(fs, assignmentPath(assignmentId), updated, key);
  return { link: minted.link, pin: minted.pin };
}

/** Unwrap a relay secret (the send private key or the content key) stored under the master key. */
function unwrapUnderMasterKey(wrapped: string, key: Uint8Array): Promise<string> {
  const parsed: unknown = JSON.parse(wrapped);
  if (!isEncryptedEnvelope(parsed)) throw new Error('corrupt relay key material');
  return decrypt(parsed, key);
}

export interface DrainResult {
  assignmentId: string;
  drained: number;
  declined: boolean;
}

/**
 * Drain one relay send: fetch the stored responses, decrypt each with the send private key, persist a
 * ResponseSet (or mark declined) + the ConsentReceipt locally, then purge the relay copy (purge-on-drain,
 * §3.5). Idempotent — re-draining overwrites the same `response.enc`; a crash before purge just re-drains.
 */
export async function drainRelaySend(
  fs: FileSystem,
  key: Uint8Array,
  relay: RelayClient,
  assignmentId: string,
): Promise<DrainResult> {
  const assignment = await getAssignment(fs, key, assignmentId);
  if (!assignment?.relay) throw new Error(`Not a relay send: ${assignmentId}`);

  // First-submission-wins (08 §17.13): a household send can be answered in the Inbox OR via the link. If
  // it's already been answered (submitted/declined in-app), the local answer is authoritative — never let a
  // late relay drain overwrite it.
  if (assignment.status === 'submitted' || assignment.status === 'declined') {
    return { assignmentId, drained: 0, declined: false };
  }

  const stored = await relay.drain(assignment.relay.token);
  if (stored.length === 0) return { assignmentId, drained: 0, declined: false };

  const privateKey = await unwrapUnderMasterKey(assignment.relay.privateKeyWrapped, key);
  let drained = 0;
  let declined = false;
  let nextStatus: Assignment['status'] = assignment.status;
  let declineNote: string | undefined;

  for (const item of stored) {
    const payload = await openResponse(item.sealed, privateKey);
    if (payload.kind === 'decline') {
      declined = true;
      nextStatus = 'declined';
      declineNote = payload.note;
      continue;
    }
    const response: ResponseSet = {
      id: uuid(),
      schemaVersion: 1,
      assignmentId,
      answers: payload.answers,
      submittedAt: payload.submittedAt,
    };
    await saveResponse(fs, key, response);
    if (payload.consent) {
      const consent: ConsentReceipt = {
        schemaVersion: 1,
        assignmentId,
        disclosureShown: payload.consent.disclosureShown,
        senderShown: payload.consent.senderShown,
        ...(payload.consent.ageAttestation
          ? { ageAttestation: payload.consent.ageAttestation }
          : {}),
        at: payload.submittedAt,
      };
      await writeEncryptedJson(fs, consentPath(assignmentId), consent, key);
    }
    drained += 1;
    nextStatus = 'submitted';
  }

  // Same re-read rule across the relay fetch above; only the drained status/note are ours.
  const liveForDrain = await getAssignment(fs, key, assignmentId);
  // Deleted mid-drain → leave it deleted (see attachRelayLink).
  if (!liveForDrain) return { assignmentId, drained: 0, declined: false };
  // Re-check first-wins (08 §17.13) against the CURRENT status: the guard above ran before the relay
  // fetch, so an in-app submit/decline can have landed during it. Writing unconditionally would let a late
  // relay drain overwrite the local answer — the exact thing that guard exists to prevent.
  if (liveForDrain.status === 'submitted' || liveForDrain.status === 'declined') {
    return { assignmentId, drained: 0, declined: false };
  }
  const updated: Assignment = {
    ...liveForDrain,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
    ...(declineNote !== undefined ? { declineNote } : {}),
  };
  await writeEncryptedJson(fs, assignmentPath(assignmentId), updated, key);
  await relay.purge(assignment.relay.token);
  return { assignmentId, drained, declined };
}

/**
 * Push a sealed outcome back to an external send's recipient (08 §17.12-D). Unwraps the stored content key,
 * seals the `RelayResult` under it (so the recipient opens it with the key already in their link fragment),
 * and uploads it to the mailbox. Returns false (no-op) if this send predates the wrapped content key — its
 * outcome write-back is simply unavailable. The relay only ever holds the sealed form.
 */
export async function publishRelayResult(
  fs: FileSystem,
  key: Uint8Array,
  relay: RelayClient,
  assignmentId: string,
  result: RelayResult,
): Promise<boolean> {
  const assignment = await getAssignment(fs, key, assignmentId);
  if (!assignment?.relay?.contentKeyWrapped) return false;
  const contentKey = await unwrapUnderMasterKey(assignment.relay.contentKeyWrapped, key);
  const sealed = await sealResult(result, contentKey);
  await relay.putResult(assignment.relay.token, sealed);
  return true;
}

/** Revoke an external send's relay link (manual revoke + revoke-on-deletion, §3.9) and mark it revoked. */
export async function revokeRelaySend(
  fs: FileSystem,
  key: Uint8Array,
  relay: RelayClient,
  assignmentId: string,
): Promise<void> {
  const assignment = await getAssignment(fs, key, assignmentId);
  if (!assignment?.relay) return;
  await relay.revoke(assignment.relay.token);
  const updated: Assignment = {
    ...AssignmentSchema.parse(assignment),
    status: 'revoked',
    updatedAt: new Date().toISOString(),
  };
  await writeEncryptedJson(fs, assignmentPath(assignmentId), updated, key);
}

/** Best-effort revoke used by deletion (§3.9): revoke the relay link before the send folder is purged. */
export async function revokeRelayForDeletion(
  fs: FileSystem,
  key: Uint8Array,
  relay: RelayClient,
  assignmentId: string,
): Promise<void> {
  const assignment = await getAssignment(fs, key, assignmentId);
  if (assignment?.relay) {
    try {
      await relay.revoke(assignment.relay.token);
    } catch {
      // Deletion proceeds even if the relay is unreachable; the mailbox expires on its own (§11.3).
    }
  }
}
