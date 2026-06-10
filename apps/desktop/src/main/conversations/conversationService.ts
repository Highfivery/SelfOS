import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ConversationSchema, type Conversation } from '../../shared/schemas';
import { pathExists } from '../vault/atomic';
import { readEncryptedJson, writeEncryptedJson } from '../crypto/encryptedStore';

function conversationsDir(vaultDir: string, personId: string): string {
  return join(vaultDir, 'people', personId, 'conversations');
}

function conversationPath(vaultDir: string, personId: string, id: string): string {
  return join(conversationsDir(vaultDir, personId), `${id}.enc`);
}

export async function getConversation(
  vaultDir: string,
  key: Buffer,
  personId: string,
  id: string,
): Promise<Conversation | null> {
  const raw = await readEncryptedJson(conversationPath(vaultDir, personId, id), key);
  return raw === null ? null : ConversationSchema.parse(raw);
}

export async function saveConversation(
  vaultDir: string,
  key: Buffer,
  conversation: Conversation,
): Promise<void> {
  await mkdir(conversationsDir(vaultDir, conversation.personId), { recursive: true });
  await writeEncryptedJson(
    conversationPath(vaultDir, conversation.personId, conversation.id),
    conversation,
    key,
  );
}

/** A person's conversations, newest first. */
export async function listConversations(
  vaultDir: string,
  key: Buffer,
  personId: string,
): Promise<Conversation[]> {
  const dir = conversationsDir(vaultDir, personId);
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const conversations: Conversation[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(join(dir, entry.name), key);
    if (raw) conversations.push(ConversationSchema.parse(raw));
  }
  return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteConversation(
  vaultDir: string,
  personId: string,
  id: string,
): Promise<void> {
  await rm(conversationPath(vaultDir, personId, id), { force: true });
}
