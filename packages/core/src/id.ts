/**
 * A random v4 UUID via WebCrypto's `randomUUID` — available in Node ≥20 and the iOS WKWebView, so the
 * business logic stays portable (no `node:crypto`). Used for ids the host owns (people, relationships).
 */
export function uuid(): string {
  return globalThis.crypto.randomUUID();
}
