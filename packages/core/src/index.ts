// @selfos/core — platform-agnostic core shared by the Electron and (future) iOS hosts.
// The shared schema/type surface. Crypto is intentionally NOT re-exported here: it is main/host-only
// and reached via the `@selfos/core/crypto` subpath, never from the renderer.
export * from './schemas';
export * from './capabilities';
export * from './usageTypes';
export * from './appearance';
