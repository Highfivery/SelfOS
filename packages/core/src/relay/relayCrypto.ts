import { encrypt, decrypt, encryptBytes, decryptBytes, randomBytes } from '../crypto';
import { fromBase64, toBase64 } from '../encoding';
import {
  RelayContentSchema,
  RelayResponsePayloadSchema,
  SealedResponseSchema,
  type EncryptedEnvelopeData,
  type RelayContent,
  type RelayResponsePayload,
  type SealedResponse,
} from '../schemas';

/**
 * Relay crypto (08-questionnaires §5.1/§8.6) — the zero-knowledge primitives shared by the app (which
 * mints + drains), the relay answering page (which decrypts questions + seals responses), and the Worker
 * (which only ever holds ciphertext). Pure functions over `@selfos/core/crypto` (WebCrypto + scrypt), so
 * the same code runs in Electron, the iOS WKWebView, the Cloudflare Worker, and the relay page.
 *
 * Two independent secrets protect a send:
 *  - a symmetric **content key** carried in the URL **fragment** (never reaches the server) seals the
 *    questionnaire content + author images — confidentiality from the relay host; and
 *  - a per-send **ECDH keypair**: responses are sealed to the public key in the recipient's browser and
 *    can only be opened with the private key, which is wrapped under the vault master key.
 * The 6-digit **PIN** is a separate access gate the Worker enforces (rate-limited) before releasing any
 * ciphertext — so a leaked link alone never even retrieves the sealed content.
 */

// WebCrypto's BufferSource wants an ArrayBuffer-backed view; copy so calls typecheck under both the
// node lib and the DOM lib (same reason cryptoService does — 07-mobile-platform §5.1).
function ab(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

// Return type inferred (not annotated): `SubtleCrypto`/`CryptoKey` are DOM-lib-only names, but core is
// also typechecked under the node lib (cryptoService does the same). `globalThis.crypto` exists in both.
const subtle = () => globalThis.crypto.subtle;

/** An unguessable URL-safe mailbox token (~128 bits, lowercase hex) for `/q/<token>`. */
export function generateRelayToken(): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh symmetric content key for the URL fragment (32 bytes, base64). */
export function generateContentKey(): string {
  return toBase64(randomBytes(32));
}

/** A 6-digit numeric PIN (crypto-random), gating ciphertext release on the relay (§3.4). */
export function generatePin(): string {
  const n = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(n % 1_000_000).padStart(6, '0');
}

/** Seal the questionnaire content (questions, public key, derived disclosure, images) under the content key. */
export async function sealContent(
  content: RelayContent,
  contentKeyB64: string,
): Promise<EncryptedEnvelopeData> {
  return encrypt(JSON.stringify(content), fromBase64(contentKeyB64));
}

/** Open + validate the questionnaire content with the URL-fragment content key (browser side). */
export async function openContent(
  env: EncryptedEnvelopeData,
  contentKeyB64: string,
): Promise<RelayContent> {
  const json = await decrypt(env, fromBase64(contentKeyB64));
  return RelayContentSchema.parse(JSON.parse(json));
}

/** Seal author-image bytes under the content key (§8.6). */
export async function sealImageBytes(
  bytes: Uint8Array,
  contentKeyB64: string,
): Promise<EncryptedEnvelopeData> {
  return encryptBytes(bytes, fromBase64(contentKeyB64));
}

/** Open author-image bytes with the content key (relay page; returns base64 for the data: URL). */
export async function openImageBytes(
  env: EncryptedEnvelopeData,
  contentKeyB64: string,
): Promise<Uint8Array> {
  return decryptBytes(env, fromBase64(contentKeyB64));
}

// ── Per-send ECDH keypair: seal responses to a public key, open with the private key ────────────────

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** Mint a per-send ECDH P-256 keypair. `publicKey` (raw) seals responses; `privateKey` (pkcs8) opens them. */
export async function generateSendKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const rawPub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  return { publicKey: toBase64(rawPub), privateKey: toBase64(pkcs8) };
}

/** Derive a 32-byte AES key from an ECDH shared secret + the ephemeral public key (domain separation). */
async function deriveSealKey(sharedBits: Uint8Array, epkRaw: Uint8Array): Promise<Uint8Array> {
  const material = new Uint8Array(sharedBits.length + epkRaw.length);
  material.set(sharedBits, 0);
  material.set(epkRaw, sharedBits.length);
  return new Uint8Array(await subtle().digest('SHA-256', ab(material)));
}

/**
 * Seal a response (a submission or a decline) to the send public key — runs in the recipient's browser.
 * Generates an ephemeral keypair, ECDHs with the send public key, and AES-GCM-encrypts the payload, so
 * only the holder of the send private key can open it.
 */
export async function sealResponse(
  payload: RelayResponsePayload,
  sendPublicKeyB64: string,
): Promise<SealedResponse> {
  const sendPub = await subtle().importKey(
    'raw',
    ab(fromBase64(sendPublicKeyB64)),
    ECDH,
    false,
    [],
  );
  const eph = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const epkRaw = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const shared = new Uint8Array(
    await subtle().deriveBits({ name: 'ECDH', public: sendPub }, eph.privateKey, 256),
  );
  const aesKey = await deriveSealKey(shared, epkRaw);
  const env = await encrypt(JSON.stringify(payload), aesKey);
  return { epk: toBase64(epkRaw), env };
}

/** Open a sealed response with the send private key (pkcs8 base64) — runs in the app on drain. */
export async function openResponse(
  sealed: SealedResponse,
  sendPrivateKeyB64: string,
): Promise<RelayResponsePayload> {
  const parsed = SealedResponseSchema.parse(sealed);
  const sendPriv = await subtle().importKey(
    'pkcs8',
    ab(fromBase64(sendPrivateKeyB64)),
    ECDH,
    false,
    ['deriveBits'],
  );
  const epkRaw = fromBase64(parsed.epk);
  const ephPub = await subtle().importKey('raw', ab(epkRaw), ECDH, false, []);
  const shared = new Uint8Array(
    await subtle().deriveBits({ name: 'ECDH', public: ephPub }, sendPriv, 256),
  );
  const aesKey = await deriveSealKey(shared, epkRaw);
  const json = await decrypt(parsed.env, aesKey);
  return RelayResponsePayloadSchema.parse(JSON.parse(json));
}

/** Build the recipient link: `<endpoint>/q/<token>#k=<contentKey>` — the content key stays in the fragment. */
export function buildRelayLink(endpointUrl: string, token: string, contentKeyB64: string): string {
  const base = endpointUrl.replace(/\/+$/, '');
  return `${base}/q/${token}#k=${encodeURIComponent(contentKeyB64)}`;
}

/** Parse the content key from a relay link's fragment (`#k=...`), or null if absent. */
export function contentKeyFromFragment(fragment: string): string | null {
  const hash = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(hash);
  return params.get('k');
}
