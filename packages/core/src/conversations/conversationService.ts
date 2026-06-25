import { getMedia, isAllowedImageMime, MAX_IMAGE_BYTES, storeMedia } from '../media';
import type { FileSystem } from '../host';
import { type AttachmentRef, ConversationSchema, type Conversation } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

function conversationsDir(personId: string): string {
  return `people/${personId}/conversations`;
}

function conversationPath(personId: string, id: string): string {
  return `${conversationsDir(personId)}/${id}.enc`;
}

/** The sibling folder holding a conversation's encrypted image attachments (45 §4.1). */
export function conversationAttachmentsDir(personId: string, conversationId: string): string {
  return `${conversationsDir(personId)}/${conversationId}/attachments`;
}

/** Guard: a path is one of OUR attachment files (45 §4.3) — defense in depth for `getMedia`/`deleteMedia`. */
export function isConversationAttachmentPath(path: string): boolean {
  return (
    /^people\/[^/]+\/conversations\/[^/]+\/attachments\/[^/]+\.enc$/.test(path) &&
    !path.includes('..')
  );
}

export async function getConversation(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  id: string,
): Promise<Conversation | null> {
  const raw = await readEncryptedJson(fs, conversationPath(personId, id), key);
  return raw === null ? null : ConversationSchema.parse(raw);
}

export async function saveConversation(
  fs: FileSystem,
  key: Uint8Array,
  conversation: Conversation,
): Promise<void> {
  await writeEncryptedJson(
    fs,
    conversationPath(conversation.personId, conversation.id),
    conversation,
    key,
  );
}

/** A person's conversations, newest first. */
export async function listConversations(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<Conversation[]> {
  const conversations: Conversation[] = [];
  for (const name of await fs.list(conversationsDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${conversationsDir(personId)}/${name}`, key);
    if (raw) conversations.push(ConversationSchema.parse(raw));
  }
  return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteConversation(
  fs: FileSystem,
  personId: string,
  id: string,
): Promise<void> {
  await fs.remove(conversationPath(personId, id));
  // Purge the sibling attachments folder so no orphaned media is left behind (45 §7; the 08 §13.2 /
  // 13-dream-images §3.3 orphaned-media lesson). `fs.remove` is recursive + a no-op when absent.
  await fs.remove(`${conversationsDir(personId)}/${id}`);
}

/** The result of storing a Session attachment — a ref, or a calm reject (mime/size validated in core). */
export type StoreConversationAttachmentResult =
  | AttachmentRef
  | { ok: false; reason: 'UNSUPPORTED' | 'TOO_LARGE'; message: string };

/**
 * Validate (mime + size) then encrypt + store an image attachment to the conversation's attachments folder,
 * returning an `AttachmentRef` (45 §5.2). The renderer is NOT the trust boundary — mime/size are re-checked
 * here even though the composer also guards them.
 */
export async function storeConversationAttachment(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  conversationId: string,
  bytes: Uint8Array,
  mime: string,
  dims?: { width?: number; height?: number },
): Promise<StoreConversationAttachmentResult> {
  if (!isAllowedImageMime(mime)) {
    return { ok: false, reason: 'UNSUPPORTED', message: 'That file isn’t a supported image.' };
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'TOO_LARGE', message: 'That image is too large.' };
  }
  // Defense in depth: refuse if `personId`/`conversationId` would build a path that escapes the attachments
  // tree (e.g. a traversal id) — so a path guard protects the WRITE too, not only reads (45 §4.3). The bridge
  // already restricts the id to a safe segment; this is the belt-and-suspenders second check.
  const dir = conversationAttachmentsDir(personId, conversationId);
  if (!isConversationAttachmentPath(`${dir}/probe.enc`)) {
    return { ok: false, reason: 'UNSUPPORTED', message: 'Invalid conversation reference.' };
  }
  const { id, path } = await storeMedia(fs, key, dir, bytes);
  return {
    id,
    kind: 'image',
    mime,
    path,
    bytes: bytes.length,
    ...(dims?.width !== undefined ? { width: dims.width } : {}),
    ...(dims?.height !== undefined ? { height: dims.height } : {}),
  };
}

/** Read + decrypt a stored attachment's bytes; null if out-of-bounds, absent, or unreadable (45 §5.2). */
export async function getConversationAttachment(
  fs: FileSystem,
  key: Uint8Array,
  path: string,
): Promise<Uint8Array | null> {
  return getMedia(fs, key, path, isConversationAttachmentPath);
}
