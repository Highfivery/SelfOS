// @selfos/core/crypto — platform-agnostic at-rest crypto + master-key management (host/main-only; never
// imported by the renderer). AES-256-GCM + scrypt over WebCrypto + Uint8Array/portable base64; the master
// key is stored via the SecretStore host and recovery-wrapped into the vault (07-mobile-platform §5.1).
export * from './cryptoService';
export * from './pin';
export * from './masterKey';
export * from './keyRotation';
