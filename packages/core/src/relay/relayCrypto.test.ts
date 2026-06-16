import { describe, expect, it } from 'vitest';
import type { Questionnaire, RelayContent, RelayResponsePayload } from '../schemas';
import {
  buildRelayLink,
  contentKeyFromFragment,
  generateContentKey,
  generatePin,
  generateRelayToken,
  generateSendKeyPair,
  openContent,
  openImageBytes,
  openResponse,
  openResult,
  sealContent,
  sealImageBytes,
  sealResponse,
  sealResult,
} from './relayCrypto';

const questionnaire: Questionnaire = {
  id: 'q1',
  schemaVersion: 1,
  version: 1,
  title: 'How are we doing?',
  type: 'fillTheGaps',
  sensitivity: 'standard',
  questions: [{ id: 'a', type: 'shortText', prompt: 'Hi?', required: false }],
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
};

describe('relay tokens / pins / links', () => {
  it('generates a 6-digit PIN and a 32-hex token', () => {
    expect(generatePin()).toMatch(/^\d{6}$/);
    expect(generateRelayToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('round-trips the content key through a link fragment', () => {
    const key = generateContentKey();
    const link = buildRelayLink('https://relay.example.dev/', 'tok123', key);
    expect(link.startsWith('https://relay.example.dev/q/tok123#k=')).toBe(true);
    const fragment = link.slice(link.indexOf('#'));
    expect(contentKeyFromFragment(fragment)).toBe(key);
  });

  it('returns null when the fragment has no content key', () => {
    expect(contentKeyFromFragment('#nope=1')).toBeNull();
  });
});

describe('content sealing (URL-fragment content key)', () => {
  const content = (publicKey: string): RelayContent => ({
    schemaVersion: 1,
    questionnaire,
    publicKey,
    senderName: 'Sam',
    disclosure: 'Your answers are private.',
    images: {},
  });

  it('seals and opens content with the content key', async () => {
    const key = generateContentKey();
    const { publicKey } = await generateSendKeyPair();
    const env = await sealContent(content(publicKey), key);
    const opened = await openContent(env, key);
    expect(opened.questionnaire.title).toBe('How are we doing?');
    expect(opened.senderName).toBe('Sam');
  });

  it('refuses to open content with the wrong content key', async () => {
    const env = await sealContent(content('pk'), generateContentKey());
    await expect(openContent(env, generateContentKey())).rejects.toThrow();
  });

  it('seals and opens author-image bytes under the content key', async () => {
    const key = generateContentKey();
    const bytes = new Uint8Array([1, 2, 3, 250, 255]);
    const env = await sealImageBytes(bytes, key);
    expect(Array.from(await openImageBytes(env, key))).toEqual([1, 2, 3, 250, 255]);
  });

  it('seals and opens a sender outcome (report) under the content key (§17.12-D)', async () => {
    const key = generateContentKey();
    const env = await sealResult(
      {
        schemaVersion: 1,
        kind: 'report',
        headline: 'How you and Sam line up',
        summary: 'Mostly aligned.',
        items: [{ canonicalId: 'a', prompt: 'Hi?', agreement: 'aligned', note: 'Both warm.' }],
        generatedAt: '2026-06-11T02:00:00.000Z',
      },
      key,
    );
    const opened = await openResult(env, key);
    expect(opened.kind).toBe('report');
    expect(opened.items?.[0]?.agreement).toBe('aligned');
    // The wrong content key can't open it.
    await expect(openResult(env, generateContentKey())).rejects.toThrow();
  });
});

describe('response sealing (per-send ECDH keypair)', () => {
  const submission: RelayResponsePayload = {
    kind: 'submit',
    answers: [{ questionId: 'a', value: 'hello' }],
    submittedAt: '2026-06-11T01:00:00.000Z',
  };

  it('seals a submission to the public key and opens it with the private key', async () => {
    const { publicKey, privateKey } = await generateSendKeyPair();
    const sealed = await sealResponse(submission, publicKey);
    const opened = await openResponse(sealed, privateKey);
    expect(opened).toEqual(submission);
  });

  it('seals and opens a decline (with a note)', async () => {
    const { publicKey, privateKey } = await generateSendKeyPair();
    const decline: RelayResponsePayload = {
      kind: 'decline',
      note: 'Not right now',
      at: '2026-06-11T01:00:00.000Z',
    };
    const sealed = await sealResponse(decline, publicKey);
    expect(await openResponse(sealed, privateKey)).toEqual(decline);
  });

  it('cannot be opened with a different send private key', async () => {
    const a = await generateSendKeyPair();
    const b = await generateSendKeyPair();
    const sealed = await sealResponse(submission, a.publicKey);
    await expect(openResponse(sealed, b.privateKey)).rejects.toThrow();
  });

  it('fails if the sealed ciphertext is tampered with', async () => {
    const { publicKey, privateKey } = await generateSendKeyPair();
    const sealed = await sealResponse(submission, publicKey);
    const tampered = { ...sealed, env: { ...sealed.env, data: `${sealed.env.data}AA` } };
    await expect(openResponse(tampered, privateKey)).rejects.toThrow();
  });
});
