/**
 * The secret-storage host (07-mobile-platform §5.1). Device-local, never synced into the vault, never
 * exposed to the renderer in plaintext. Each platform supplies an implementation — Electron `safeStorage`
 * + a `secrets.json` file on desktop, the iOS Keychain on iPhone. The business logic (e.g. the master-key
 * service) depends only on this interface.
 */
export interface SecretStore {
  /** The decrypted secret for `id`, or `null` if none is stored. */
  get(id: string): Promise<string | null>;
  set(id: string, value: string): Promise<void>;
  has(id: string): Promise<boolean>;
  clear(id: string): Promise<void>;
}
