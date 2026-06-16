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
import { getAssignment } from './assignmentService';
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

  const token = generateRelayToken();
  const contentKey = generateContentKey();
  const pin = generatePin();
  const { publicKey, privateKey } = await generateSendKeyPair();
  const privateKeyWrapped = JSON.stringify(await encrypt(privateKey, key));
  // Wrap the content key under the master key too, so the sender can later seal an OUTCOME the recipient
  // decrypts with the same fragment key (external compatibility report write-back, §17.12-D).
  const contentKeyWrapped = JSON.stringify(await encrypt(contentKey, key));
  const pinHash = await hashPin(pin);
  // Anonymous sends show "Someone" on the relay (the page renders null as such); a named send shows the
  // sending person's display name (NOT the recipient's, who is the addressee).
  const senderName = input.senderVisibleToRecipient ? input.senderName : null;

  const content = await buildContent(
    fs,
    key,
    questionnaire,
    publicKey,
    senderName,
    input.disclosure,
    contentKey,
  );
  const sealedContent = await sealContent(content, contentKey);
  const expiresAt = input.expiresAt ?? defaultExpiry();
  const mailbox: RelayMailbox = {
    schemaVersion: 1,
    token,
    sealedContent,
    pinHash,
    createdAt: at,
    expiresAt,
  };
  await relay.putMailbox(mailbox);

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
    relay: { token, pinHash, publicKey, privateKeyWrapped, contentKeyWrapped },
    createdAt: at,
    updatedAt: at,
  };
  await writeEncryptedJson(fs, assignmentPath(id), assignment, key);

  return { assignment, link: buildRelayLink(input.endpointUrl, token, contentKey), pin };
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

  const updated: Assignment = {
    ...assignment,
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
