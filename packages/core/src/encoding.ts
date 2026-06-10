/**
 * Portable base64 over `Uint8Array` — works in both Electron's Node main process and the iOS
 * WKWebView via the standard `btoa`/`atob` globals, with no node `Buffer` (07-mobile-platform §5.1).
 * Bytes are 0–255, so the latin1 round-trip through `btoa`/`atob` is lossless.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
