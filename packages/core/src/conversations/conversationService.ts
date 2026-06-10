import type { FileSystem } from '../host';
import { ConversationSchema, type Conversation } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

function conversationsDir(personId: string): string {
  return `people/${personId}/conversations`;
}

function conversationPath(personId: string, id: string): string {
  return `${conversationsDir(personId)}/${id}.enc`;
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
}
