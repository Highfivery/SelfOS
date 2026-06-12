import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import {
  contentKeyFromFragment,
  openContent,
  sealResponse,
  type RelayKv,
  type RelayEnv,
  drain as kvDrain,
  purge as kvPurge,
  putMailbox as kvPut,
  respond as kvRespond,
  revoke as kvRevoke,
  unlock as kvUnlock,
} from '../relay';
import type { QuestionnaireInput, RelayResponsePayload, RelayStoredResponse } from '../schemas';
import { saveQuestionnaire } from './questionnaireService';
import { getAssignment } from './assignmentService';
import { getResponse } from './responseService';
import { createRelaySend, drainRelaySend, revokeRelaySend, type RelayClient } from './relayService';

const key = generateMasterKey();

function memoryKv(): RelayKv {
  const store = new Map<string, string>();
  return {
    get: (k) => Promise.resolve(store.get(k) ?? null),
    put: (k, v) => {
      store.set(k, v);
      return Promise.resolve();
    },
    delete: (k) => {
      store.delete(k);
      return Promise.resolve();
    },
  };
}

/** A fake Worker: the host's RelayClient backed by the real in-memory mailbox ops (no network/account). */
function fakeRelay(): { client: RelayClient; env: RelayEnv } {
  const env: RelayEnv = {
    kv: memoryKv(),
    nowMs: () => 1_000_000,
    nowIso: () => '2026-06-11T00:00:00.000Z',
  };
  const client: RelayClient = {
    putMailbox: async (mailbox) => {
      await kvPut(env, mailbox);
    },
    drain: async (token) =>
      ((await kvDrain(env, { token })).json as { responses: RelayStoredResponse[] }).responses,
    purge: async (token) => {
      await kvPurge(env, { token });
    },
    revoke: async (token) => {
      await kvRevoke(env, { token });
    },
  };
  return { client, env };
}

const input: QuestionnaireInput = {
  title: 'Outside view',
  type: 'blind-spots',
  sensitivity: 'standard',
  questions: [{ id: 'a', type: 'shortText', prompt: 'How do I come across?', required: true }],
};

/** Simulate the recipient's browser: unlock, decrypt the content, seal a payload, POST it. */
async function answerAsRecipient(
  env: RelayEnv,
  token: string,
  contentKey: string,
  pin: string,
  payload: RelayResponsePayload,
): Promise<void> {
  const unlocked = (await kvUnlock(env, { token, pin })).json as {
    sealedContent: Parameters<typeof openContent>[0];
  };
  const content = await openContent(unlocked.sealedContent, contentKey);
  const sealed = await sealResponse(payload, content.publicKey);
  const res = await kvRespond(env, { token, pin, sealed });
  expect(res.status).toBe(200);
}

describe('relayService', () => {
  it('mints an external send, then drains + decrypts a submitted response with consent', async () => {
    const fs = memFileSystem();
    const { client, env } = fakeRelay();
    const q = await saveQuestionnaire(fs, key, input);

    const { assignment, link, pin } = await createRelaySend(fs, key, client, {
      questionnaireId: q.id,
      senderPersonId: 'p1',
      senderName: 'Sam',
      recipient: { kind: 'external', displayName: 'Alex', email: 'alex@example.com' },
      senderVisibleToRecipient: true,
      privacy: 'private',
      disclosure: 'Your answers are private.',
      endpointUrl: 'https://relay.example.dev',
    });
    expect(assignment.channel).toBe('relay');
    expect(assignment.relay?.token).toBeTruthy();
    expect(pin).toMatch(/^\d{6}$/);

    const token = assignment.relay!.token;
    const contentKey = contentKeyFromFragment(link.slice(link.indexOf('#')))!;
    await answerAsRecipient(env, token, contentKey, pin, {
      kind: 'submit',
      answers: [{ questionId: 'a', value: 'Warm but a little guarded.' }],
      submittedAt: '2026-06-11T01:00:00.000Z',
      consent: { disclosureShown: 'Your answers are private.', senderShown: 'Sam' },
    });

    const result = await drainRelaySend(fs, key, client, assignment.id);
    expect(result).toEqual({ assignmentId: assignment.id, drained: 1, declined: false });

    const response = await getResponse(fs, key, assignment.id);
    expect(response?.answers[0]?.value).toBe('Warm but a little guarded.');
    expect((await getAssignment(fs, key, assignment.id))?.status).toBe('submitted');

    // Purge-on-drain: a second drain finds nothing (idempotent).
    expect((await drainRelaySend(fs, key, client, assignment.id)).drained).toBe(0);
  });

  it('records a decline (with a note) and never writes a ResponseSet', async () => {
    const fs = memFileSystem();
    const { client, env } = fakeRelay();
    const q = await saveQuestionnaire(fs, key, input);
    const { assignment, link, pin } = await createRelaySend(fs, key, client, {
      questionnaireId: q.id,
      senderPersonId: 'p1',
      senderName: 'Sam',
      recipient: { kind: 'external', displayName: 'Alex' },
      senderVisibleToRecipient: false, // anonymous
      privacy: 'private',
      disclosure: 'Private.',
      endpointUrl: 'https://relay.example.dev',
    });
    const contentKey = contentKeyFromFragment(link.slice(link.indexOf('#')))!;
    const unlocked = (await kvUnlock(env, { token: assignment.relay!.token, pin })).json as {
      sealedContent: Parameters<typeof openContent>[0];
    };
    const content = await openContent(unlocked.sealedContent, contentKey);
    expect(content.senderName).toBeNull(); // anonymous send hides the sender

    await answerAsRecipient(env, assignment.relay!.token, contentKey, pin, {
      kind: 'decline',
      note: 'Maybe later',
      at: '2026-06-11T01:00:00.000Z',
    });
    const result = await drainRelaySend(fs, key, client, assignment.id);
    expect(result.declined).toBe(true);
    expect(await getResponse(fs, key, assignment.id)).toBeNull();
    const updated = await getAssignment(fs, key, assignment.id);
    expect(updated?.status).toBe('declined');
    expect(updated?.declineNote).toBe('Maybe later');
  });

  it('revokes a send, marking it revoked and clearing the relay mailbox', async () => {
    const fs = memFileSystem();
    const { client, env } = fakeRelay();
    const q = await saveQuestionnaire(fs, key, input);
    const { assignment, pin } = await createRelaySend(fs, key, client, {
      questionnaireId: q.id,
      senderPersonId: 'p1',
      senderName: 'Sam',
      recipient: { kind: 'external' },
      senderVisibleToRecipient: true,
      privacy: 'private',
      disclosure: 'Private.',
      endpointUrl: 'https://relay.example.dev',
    });
    await revokeRelaySend(fs, key, client, assignment.id);
    expect((await getAssignment(fs, key, assignment.id))?.status).toBe('revoked');
    // The mailbox is gone: a recipient can no longer unlock.
    expect((await kvUnlock(env, { token: assignment.relay!.token, pin })).status).toBe(404);
  });
});
